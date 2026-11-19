import * as THREE from '../engine/index.js';
import { capsuleContact, adjacent } from '../people/ArticulatedContacts.js';
import { articulatedContact, jointCoordinates } from './JointVelocity.js';

// The player's ragdoll: the car yeet (src/rally/Bailout.js), a big fall on foot, and
// player.ragdoll( impulse, point ) for other systems (a jetski wipe-out, a bump in a crowd).
//
// Bodies: the 14 capsules of player.glb's scene extras `ragdoll` (tools/characters/player.py): a capsule
// from each bone's head towards `to` (radius, length), masses by segment (75 kg, Dempster fractions),
// capsule inertia. The velocity solve uses an articulated tree with one implicit
// internal angular-viscosity step, unilateral limits and point contact impulses.
// Position constraints repair overlap separately; they do not turn geometric
// correction into a limb launch. Fixed-orientation anchor repair preserves COM.
// The base step is at most1/120s. Rotation and near-contact sample travel choose
// smaller steps after every solved impact; force trials preserve accepted time.
// At most192 pieces per frame are allowed. The explicit final-piece protection
// removes measured kinetic energy, records its cause, and consumes the remainder.
// This is a bounded game model, not measured human tissue or an injury predictor.
// The JS world queries include terrain, static colliders, reef, water and moving
// ferry/carrier supports, without requiring the native car world to be loaded.
// Population solver costs are measured separately from renderer frame costs.
//
// Joints: a ball joint at each child's bone head; swing (cone) and twist limits about a neutral pose,
// the idle's first frame with the thighs 35 degrees forward and the upper arms 45 degrees out (so a
// seated driver and flailing arms sit inside the cones); elbows and knees are hinges (axis held within
// `cone` degrees, flexion clamped to `hinge`, the human way only).
// Contacts: two or three spheres per capsule against the ground under them (terrain with its slope,
// walkable boxes, the reef) and the walls near the body, with friction and a small bounce. The sea
// holds each capsule up by how deep it sits (the chest floats highest) and drags it.
// Pose: body rotations (and the pelvis position) go into a one-key clip over every node, laid on the
// SkinnedModel as an ordinary layer, so the get-up crossfades with real clips: once the body has been
// still for SETTLE_T each body turns in the world (BLEND_T) to the lying first frame of getup_back or
// getup_belly, by which way up he lies, and the clip plays out into the idle. A model without those clips straightens
// flat (FLAT_T), rises into the crouch of jump_land (RISE_T) and plays that out. In the sea it fades
// into treading water.

const G = 9.81, SUB = 2, MASS = 75, D2R = Math.PI / 180;
const MAX_ROTATION_STEP = 0.1, CONTACT_TRAVEL = 0.15, MAX_SUBSTEPS = 192;
// PLANE_REACH (m): how far a contact sphere may move across the ground from where its plane was taken
// before the plane is taken again at its new place. The plane is a tangent (height there, normal from
// +-0.25 m differences), so on a creased or curving hillside it parts from the terrain with distance:
// The solver could move a forearm 0.26 m from its plane in one 38-substep frame while the pelvis stayed inside the
// 0.15 m whole-rig refresh, the plane saying 0.8 cm clear and the terrain 8.3 cm deep (tornado seed 1).
// Near the ground a sphere moves at most CONTACT_TRAVEL * r a substep, so this is a few substeps of travel.
const PLANE_REACH = 0.05;
const STILL = Object.freeze( [ 0, 0, 0 ] ), SUPPORT_REACH = Object.freeze( { maxRise: 0.001, maxDrop: 0.001 } );
const FRACTION = { Pelvis: 0.142, Spine: 0.139, Spine2: 0.216, Head: 0.081, UpperArm: 0.028, Forearm: 0.022, Thigh: 0.1, Calf: 0.0465, Foot: 0.0145 };
// buoyancy against weight when fully under (the lungs float the chest; limbs just sink)
const FLOAT = { Pelvis: 1.15, Spine: 1.35, Spine2: 1.6, Head: 1.2 };
const BIAS = { Thigh: [ 'forward', 35 ], UpperArm: [ 'out', 45 ] };
const MU = 0.65, MU_WALL = 0.3, BOUNCE = 0.15, JOINT_VISCOSITY = 1, SPIN_DAMP = 0.6, WATER_DRAG = 2.2, WATER_SPIN = 3;
// DEPEN: the fastest a contact may push a sunk sphere back out (m/s): no launch off a deep overlap
// the sea at speed (thrown off a jetski at 100+ km/h he skims and tumbles across it, then bobs up; he does not
// spear 2 m down). By how deep each body sits: plane (per m): a body sinking into the water is held up by
// C |v| v_down, the jetski's planing pressure, so the faster he goes the harder the surface; skim (per m): a body
// sliding across it is lifted by C (v_h^2 - skimMin^2), so a shallow entry skips like a stone until he slows;
// drag (per m): the water's drag on him grows with the square of his speed (spray, the wave he pushes)
export const ENTRY = { plane: 0.9, skim: 0.012, skimMin: 8, drag: 0.06 };
const DEPEN = 1.5, SETTLE_V = 0.35, SETTLE_W = 1.5, SETTLE_T = 1.0, FLAT_T = 0.5, RISE_T = 0.75, BLEND_T = 0.6, OUT_T = 0.3, SWIM_T = 0.6, EYE = 1.62;

const V = () => ( { x: 0, y: 0, z: 0 } );
const Q = () => ( { x: 0, y: 0, z: 0, w: 1 } );
const smooth = ( x ) => { const t = Math.min( 1, Math.max( 0, x ) ); return t * t * ( 3 - 2 * t ); };
// o = a * b
function qmul( a, b, o ) {

	const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
	o.x = aw * bx + ax * bw + ay * bz - az * by;
	o.y = aw * by - ax * bz + ay * bw + az * bx;
	o.z = aw * bz + ax * by - ay * bx + az * bw;
	o.w = aw * bw - ax * bx - ay * by - az * bz;
	return o;

}

// o = q v q^-1 (s = -1: the inverse rotation)
function rot( q, v, o, s = 1 ) {

	const x = v.x, y = v.y, z = v.z, qx = q.x * s, qy = q.y * s, qz = q.z * s, qw = q.w;
	const tx = 2 * ( qy * z - qz * y ), ty = 2 * ( qz * x - qx * z ), tz = 2 * ( qx * y - qy * x );
	o.x = x + qw * tx + qy * tz - qz * ty;
	o.y = y + qw * ty + qz * tx - qx * tz;
	o.z = z + qw * tz + qx * ty - qy * tx;
	return o;

}

// q += s/2 [w, 0] q, renormalised (a small rotation by the vector w * s)
function turn( q, wx, wy, wz, s ) {

	const qx = q.x, qy = q.y, qz = q.z, qw = q.w, h = 0.5 * s;
	q.x += h * ( wx * qw + wy * qz - wz * qy );
	q.y += h * ( wy * qw + wz * qx - wx * qz );
	q.z += h * ( wz * qw + wx * qy - wy * qx );
	q.w += h * ( - wx * qx - wy * qy - wz * qz );
	const l = 1 / Math.hypot( q.x, q.y, q.z, q.w );
	q.x *= l; q.y *= l; q.z *= l; q.w *= l;

}

function slerp( a, b, t, o ) {

	let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, s = 1;
	if ( d < 0 ) { d = - d; s = - 1; }
	let k0 = 1 - t, k1 = t;
	if ( d < 0.9995 ) { const th = Math.acos( d ), sn = Math.sin( th ); k0 = Math.sin( k0 * th ) / sn; k1 = Math.sin( t * th ) / sn; }
	o.x = a.x * k0 + b.x * k1 * s; o.y = a.y * k0 + b.y * k1 * s; o.z = a.z * k0 + b.z * k1 * s; o.w = a.w * k0 + b.w * k1 * s;
	const l = 1 / Math.hypot( o.x, o.y, o.z, o.w );
	o.x *= l; o.y *= l; o.z *= l; o.w *= l;
	return o;

}

const cross = ( a, b, o ) => { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; o.x = x; o.y = y; o.z = z; return o; };
const dot = ( a, b ) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = ( a ) => { const l = Math.hypot( a.x, a.y, a.z ) || 1; a.x /= l; a.y /= l; a.z /= l; return a; };
const axisAngle = ( a, ang, o ) => { const s = Math.sin( ang / 2 ); o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; o.w = Math.cos( ang / 2 ); return o; };
// rotation whose columns are the unit vectors x, y, z
function basis( x, y, z, o ) {

	const m00 = x.x, m10 = x.y, m20 = x.z, m01 = y.x, m11 = y.y, m21 = y.z, m02 = z.x, m12 = z.y, m22 = z.z, tr = m00 + m11 + m22;
	if ( tr > 0 ) { const s = 0.5 / Math.sqrt( tr + 1 ); o.w = 0.25 / s; o.x = ( m21 - m12 ) * s; o.y = ( m02 - m20 ) * s; o.z = ( m10 - m01 ) * s; } else if ( m00 > m11 && m00 > m22 ) { const s = 2 * Math.sqrt( 1 + m00 - m11 - m22 ); o.w = ( m21 - m12 ) / s; o.x = 0.25 * s; o.y = ( m01 + m10 ) / s; o.z = ( m02 + m20 ) / s; } else if ( m11 > m22 ) { const s = 2 * Math.sqrt( 1 + m11 - m00 - m22 ); o.w = ( m02 - m20 ) / s; o.x = ( m01 + m10 ) / s; o.y = 0.25 * s; o.z = ( m12 + m21 ) / s; } else { const s = 2 * Math.sqrt( 1 + m22 - m00 - m11 ); o.w = ( m10 - m01 ) / s; o.x = ( m02 + m20 ) / s; o.y = ( m12 + m21 ) / s; o.z = 0.25 * s; }
	return o;

}

const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V(), _q1 = Q(), _q2 = Q(), _q3 = Q(), _gq = Q(), _up = new THREE.Vector3( 0, 1, 0 );
// scratch for the solver (no allocation per substep)
const _rp = V(), _rc = V(), _n = V(), _P = V(), _a1 = V(), _a2 = V(), _x = V(), _b1 = V(), _b2 = V(), _an = V(), _aP = V(), _t = V();

export class Ragdoll {

	// player: src/player/Player.js (terrain, colliders, reef, avatar)
	// opts (a townsperson's ragdoll, src/people/Tumble.js; the player passes none): spec, the capsule list in
	// place of the model's own scene extras; sub, substeps a frame in place of SUB
	constructor( player, opts = {} ) {

		this.player = player;
		this.opts = opts;
		this.mass = Math.max( 1, opts.mass ?? MASS );
		this.phase = 'idle';   // 'sim' | 'getup' | 'swim' | 'done' | 'idle'
		this.built = false;
		this.bodies = [];
		this.near = { boxes: [], cylinders: [], _toLocal: player.colliders._toLocal, _toWorldDir: player.colliders._toWorldDir };
		this.trunks = null;    // () => flat [ x, z, radius, bottom, top, ... ] (the rally's palms), set by the yeet
		this.waterY = - Infinity;
		this.focus = new THREE.Vector3();
		this.floorY = 0;
		this.result = { at: new THREE.Vector3(), yaw: 0, water: false };
		this.contacts = [];
		this.plane = [];
		this.safe = new Float64Array( 14 * 7 );
		this.walls = [];
		this.stats = null;
		this.camQ = Q();
		this.standAt = V();
		this._feet = new THREE.Vector3();

	}

	// ------------------------------------------------------------------ setup

	build( avatar ) {

		const m = avatar.model, gltf = m.gltf, json = gltf.json || {};
		const extras = ( json.scenes && json.scenes[ json.scene || 0 ] && json.scenes[ json.scene || 0 ].extras ) || {};
		const spec = this.opts.spec || extras.ragdoll;
		if ( ! Array.isArray( spec ) || ! spec.length ) return false;
		const N = gltf.nodes.length, find = ( n ) => gltf.nodes.findIndex( ( x ) => x.name === n );
		this.model = m;
		this.T = Array.from( { length: N }, V );
		this.Q = Array.from( { length: N }, Q );
		this.S = new Float64Array( N );
		this.sT = m.local.map( ( l ) => Float32Array.from( l.t ) );
		this.sR = m.local.map( ( l ) => Float32Array.from( l.r ) );
		this.sS = m.local.map( ( l ) => Float32Array.from( l.s ) );
		// the neutral pose: the idle's first frame
		const saved = m.layers;
		m.layers = avatar.idle ? [ { ...avatar.idle, time: 0, weight: 1, target: 1 } ] : [];
		m._pose();
		m.layers = saved;
		this.worldOf( m.local );
		const key = ( n ) => n.replace( /^Bip01 /, '' ).replace( /^[LR] /, '' );
		const F = { x: 0, y: 0, z: 1 }; // the character faces +z in model space (Avatar heading)
		this.byNode = new Array( N ).fill( null );
		const bodies = spec.map( ( s, i ) => {

			const node = find( s.bone ), to = s.to ? find( s.to ) : - 1, k = key( s.bone );
			if ( node < 0 ) throw new Error( 'Ragdoll: no bone ' + s.bone );
			const n = { ...this.Q[ node ] }, from = this.T[ node ];
			const tip = to >= 0 ? this.T[ to ] : null, base = this.T[ m.parent[ node ] ];
			const aw = norm( tip ? { x: tip.x - from.x, y: tip.y - from.y, z: tip.z - from.z } : { x: from.x - base.x, y: from.y - base.y, z: from.z - base.z } );
			const ax = rot( n, aw, V(), - 1 ), len = s.length, r = s.radius, mass = this.mass * ( FRACTION[ k ] || 0.02 );
			const Iax = 0.5 * mass * r * r, Ip = mass * ( 3 * r * r + ( len + r ) * ( len + r ) ) / 12;
			const b = {
				name: s.bone, key: k, node, index: i, parentName: s.parent, r, len, m: mass, im: 1 / mass, iAx: 1 / Iax, iPerp: 1 / Ip, ax, N: n,
				float: FLOAT[ k ] || 1, x: V(), q: Q(), v: V(), w: V(), px: V(), pq: Q(), q0: Q(), qt: Q(), o: V(),
				cone: ( s.cone || 0 ) * D2R, twist: ( s.twist || 0 ) * D2R, hinge: s.hinge ? [ s.hinge[ 0 ] * D2R, s.hinge[ 1 ] * D2R ] : null,
				samples: [ - 0.5, 0.5 ].concat( len > 2.5 * r ? [ 0 ] : [] ).map( ( f ) => ( { x: ax.x * len * f, y: ax.y * len * f, z: ax.z * len * f } ) ),
			};
			b.o.x = - ax.x * len / 2; b.o.y = - ax.y * len / 2; b.o.z = - ax.z * len / 2;
			this.byNode[ node ] = b;
			return b;

		} );
		for ( const b of bodies ) {

			b.parent = b.parentName ? bodies.find( ( p ) => p.name === b.parentName ) || null : null;
			b.root = ! b.parent;
			if ( b.root ) continue;
			const p = b.parent, aw = rot( b.N, b.ax, V() );
			// the neutral child axis and a twist reference, biased (thighs forward, arms out)
			const ref = Math.abs( aw.z ) > 0.9 ? { x: 1, y: 0, z: 0 } : F, bw = norm( { x: ref.x - aw.x * dot( aw, ref ), y: ref.y - aw.y * dot( aw, ref ), z: ref.z - aw.z * dot( aw, ref ) } );
			const bias = BIAS[ b.key ], qb = Q();
			if ( bias ) {

				const side = Math.sign( this.T[ b.node ].x - this.T[ bodies[ 0 ].node ].x ) || 1;
				const target = bias[ 0 ] === 'forward' ? F : { x: side, y: 0, z: 0 };
				axisAngle( norm( cross( aw, target, V() ) ), bias[ 1 ] * D2R, qb );

			}

			b.aN = rot( p.N, rot( qb, aw, V() ), V(), - 1 );
			b.bN = rot( p.N, rot( qb, bw, V() ), V(), - 1 );
			b.bC = rot( b.N, bw, V(), - 1 );
			if ( b.hinge ) {

				const ap = rot( p.N, p.ax, V() );
				const hw = norm( cross( ap, b.key === 'Forearm' ? F : { x: 0, y: 0, z: - 1 }, V() ) );
				b.hP = rot( p.N, hw, V(), - 1 );
				b.hC = rot( b.N, hw, V(), - 1 );

			}

		}

		this.bodies = bodies;
		this.pelvis = bodies.find( ( b ) => b.root );
		this.chest = bodies.find( ( b ) => b.key === 'Spine2' ) || this.pelvis;
		this.head = bodies.find( ( b ) => b.key === 'Head' ) || this.chest;
		this.joints = bodies.filter( ( b ) => ! b.root );
		this.selfPairs = [];
		for ( let i = 0; i < bodies.length; i ++ ) for ( let j = i + 1; j < bodies.length; j ++ ) if ( ! adjacent( bodies[ i ], bodies[ j ] ) ) this.selfPairs.push( [ bodies[ i ], bodies[ j ] ] );
		this.fwdChest = rot( this.chest.N, F, V(), - 1 );
		this.eyeLocal = V();
		{ const fw = rot( this.head.N, F, V(), - 1 ), up = rot( this.head.N, { x: 0, y: 1, z: 0 }, V(), - 1 ); for ( const c of [ 'x', 'y', 'z' ] ) this.eyeLocal[ c ] = fw[ c ] * 0.09 + up[ c ] * 0.03; }
		// the one-key clip over every node (rotation and translation), laid on the model as a layer
		this.rv = []; this.tv = [];
		const channels = [];
		for ( let i = 0; i < N; i ++ ) {

			const r = new Float32Array( 4 ), t = new Float32Array( 3 );
			this.rv.push( r ); this.tv.push( t );
			channels.push( { node: i, path: 'rotation', times: new Float32Array( [ 0 ] ), values: r }, { node: i, path: 'translation', times: new Float32Array( [ 0 ] ), values: t } );

		}

		this.layer = { clip: { name: 'ragdoll', duration: 0, channels }, time: 0, weight: 1, target: 1, fade: 1e-3, loop: false, speed: 0, ended: true };
		// the get-up: jump_land from its deepest crouch, then the idle
		const land = m.clips.get( 'jump_land' );
		this.tc = 0;
		if ( land ) {

			const pn = this.pelvis.node, root = m.parent[ pn ], ch = land.channels.find( ( c ) => c.node === pn && c.path === 'translation' );
			if ( ch && root >= 0 ) {

				let low = Infinity;
				for ( let k = 0; k < ch.times.length; k ++ ) {

					const y = this.T[ root ].y + rot( this.Q[ root ], { x: ch.values[ k * 3 ] * this.S[ root ], y: ch.values[ k * 3 + 1 ] * this.S[ root ], z: ch.values[ k * 3 + 2 ] * this.S[ root ] }, _a ).y;
					if ( y < low ) { low = y; this.tc = ch.times[ k ]; }

				}

			}

		}

		this.land = land ? { clip: land, time: this.tc, weight: 0, target: 0, fade: 1e-3, loop: false, speed: 0, ended: true } : null;
		this.playT = land ? Math.max( 0.35, land.duration - this.tc ) : 0.35;
		this.landPlayT = this.playT;
		// the keyed get-ups (player.glb getup_back / getup_belly): each starts lying on its back or belly with the hips
		// at p0 (model space), and ends on the idle's first pose at the model origin
		this.getups = {};
		const root = m.parent[ this.pelvis.node ];
		for ( const name of [ 'getup_back', 'getup_belly' ] ) {

			const clip = m.clips.get( name );
			const ch = clip && clip.channels.find( ( c ) => c.node === this.pelvis.node && c.path === 'translation' );
			if ( ! ch || root < 0 ) continue;
			const v = ch.values, s = this.S[ root ], p0 = rot( this.Q[ root ], { x: v[ 0 ] * s, y: v[ 1 ] * s, z: v[ 2 ] * s }, V() );
			p0.x += this.T[ root ].x; p0.y += this.T[ root ].y; p0.z += this.T[ root ].z;
			this.getups[ name ] = { clip, p0, time: 0, weight: 0, target: 0, fade: 1e-3, loop: false, speed: 0, ended: true };

		}
		this.idle = avatar.idle ? { ...avatar.idle, time: 0, weight: 0, target: 0 } : null;
		const tread = m.clips.get( 'tread' );
		this.tread = tread ? { clip: tread, time: 0, weight: 0, target: 0, fade: 1e-3, loop: true, speed: 1, ended: false } : null;
		this.neckH = avatar.neckH || 1.5;
		// getting up, these joints stay above the ground by these margins (m): knees, ankles, toes, wrists. The toe
		// joint (the ball of the foot) sits 3 to 6 mm up in the idle, so a bigger toe margin lifts him as he stands
		this.lowNodes = [];
		for ( const sd of 'LR' ) for ( const [ n, h ] of [ [ 'Calf', 0.06 ], [ 'Foot', 0.08 ], [ 'Toe0', 0.003 ], [ 'Hand', 0.04 ] ] ) { const i = find( `Bip01 ${ sd } ${ n }` ); if ( i >= 0 ) this.lowNodes.push( [ i, h ] ); }
		this.built = true;
		return true;

	}

	// model-space world transforms (T, Q, uniform S) of every node from local TRS arrays
	worldOf( L ) {

		const m = this.model, T = this.T, Qs = this.Q, S = this.S;
		for ( const i of m.order ) {

			const p = m.parent[ i ], l = L[ i ], t = l.t || l, r = l.r, s = l.s;
			const lr = r ? { x: r[ 0 ], y: r[ 1 ], z: r[ 2 ], w: r[ 3 ] } : null;
			if ( p < 0 ) { T[ i ].x = t[ 0 ]; T[ i ].y = t[ 1 ]; T[ i ].z = t[ 2 ]; Object.assign( Qs[ i ], lr ); S[ i ] = s[ 0 ]; continue; }
			const sp = S[ p ];
			rot( Qs[ p ], { x: t[ 0 ] * sp, y: t[ 1 ] * sp, z: t[ 2 ] * sp }, T[ i ] );
			T[ i ].x += T[ p ].x; T[ i ].y += T[ p ].y; T[ i ].z += T[ p ].z;
			qmul( Qs[ p ], lr, Qs[ i ] );
			S[ i ] = sp * s[ 0 ];

		}

	}

	// ------------------------------------------------------------------ start

	// avatar: its pose as last drawn (or opts.pose, a clip name, held at its first frame), placed by the
	// group's position and rotation gp, gq (or with the pelvis at opts.at, facing opts.heading);
	// velocity: the whole body's (world, m/s); opts.impulse, opts.point: a knock (kg m/s at a world point);
	// opts.spin: a tumble (world rad/s).
	start( avatar, gp, gq, velocity, opts = {} ) {

		const m = avatar.model;
		if ( ! m ) return false;
		if ( opts.pose && m.clips.has( opts.pose ) ) {

			m.layers = [ { clip: m.clips.get( opts.pose ), time: 0, weight: 1, target: 1, fade: 1e-3, loop: false, speed: 0, ended: true } ];
			m._pose();

		}

		const snap = m.local.map( ( l ) => ( { t: Float32Array.from( l.t ), r: Float32Array.from( l.r ), s: Float32Array.from( l.s ) } ) );
		if ( ! this.built && ! this.build( avatar ) ) return false;
		for ( let i = 0; i < snap.length; i ++ ) { this.sT[ i ].set( snap[ i ].t ); this.sR[ i ].set( snap[ i ].r ); this.sS[ i ].set( snap[ i ].s ); this.rv[ i ].set( snap[ i ].r ); this.tv[ i ].set( snap[ i ].t ); }
		this.worldOf( snap );
		const g = { x: gq.x, y: gq.y, z: gq.z, w: gq.w }, p0 = { x: gp.x, y: gp.y, z: gp.z };
		if ( opts.at ) {

			if ( opts.heading !== undefined && opts.heading !== null ) axisAngle( { x: 0, y: 1, z: 0 }, opts.heading, g );
			rot( g, this.T[ this.pelvis.node ], _a );
			p0.x = opts.at.x - _a.x; p0.y = opts.at.y - _a.y; p0.z = opts.at.z - _a.z;

		}

		for ( const b of this.bodies ) {

			qmul( g, this.Q[ b.node ], b.q );
			rot( g, this.T[ b.node ], _a );
			rot( b.q, b.ax, _b );
			b.x.x = p0.x + _a.x + _b.x * b.len / 2; b.x.y = p0.y + _a.y + _b.y * b.len / 2; b.x.z = p0.z + _a.z + _b.z * b.len / 2;
			b.v.x = velocity.x; b.v.y = velocity.y; b.v.z = velocity.z;
			b.w.x = b.w.y = b.w.z = 0;

		}

		// never started inside the ground (a seated pose by a low car, a knock on a slope): lift clear of it
		let sunk = 0;
		for ( const b of this.bodies ) for ( const sp of b.samples ) { rot( b.q, sp, _a ); const y = b.x.y + _a.y; sunk = Math.max( sunk, this.ground( b.x.x + _a.x, b.x.z + _a.z, y + 1 ) + b.r - y ); }
		if ( sunk > 0 ) for ( const b of this.bodies ) b.x.y += sunk + 0.02;
		// each joint's anchor on its parent: where the child's bone head sits in the parent's frame
		for ( const b of this.joints ) {

			const p = b.parent;
			rot( b.q, b.o, _a );
			b.rP = rot( p.q, { x: b.x.x + _a.x - p.x.x, y: b.x.y + _a.y - p.x.y, z: b.x.z + _a.z - p.x.z }, V(), - 1 );

		}

		// a pose outside the joint limits (a seated clip, a wild frame) is settled into them before the
		// first step, with no velocity from it (otherwise the corrections would launch the body)
		for ( let k = 0; k < 12; k ++ ) for ( const b of this.joints ) this.solveJoint( b );
		// the head camera's offset: looking the way the body faced
		qmul( g, axisAngle( { x: 0, y: 1, z: 0 }, Math.PI, _q1 ), _q2 );
		this.camOff = qmul( { x: - this.head.q.x, y: - this.head.q.y, z: - this.head.q.z, w: this.head.q.w }, _q2, Q() );
		Object.assign( this.camQ, _q2 );
		// Angular momentum must come from an explicit initial condition or contact.
		// Inherited translation never arms random spin or limb actuators.
		const spin = opts.spin;

		if ( spin ) {

			const c = this.com( _c );
			for ( const b of this.bodies ) {

				b.w.x = spin.x; b.w.y = spin.y; b.w.z = spin.z;
				cross( spin, { x: b.x.x - c.x, y: b.x.y - c.y, z: b.x.z - c.z }, _a );
				b.v.x += _a.x; b.v.y += _a.y; b.v.z += _a.z;

			}

		}

		this.supportedStep = false;
		for ( const b of this.bodies ) b.supported = false;
		this.push( opts.impulse, opts.point );
		this.phase = 'sim';
		this.t = 0; this.rest = 0; this.nearT = 0; this.trunks = opts.trunks || this.trunks;
		this.stats = { substeps: 0, substepsMax: 0, consumedTime: 0, protectionEnergy: 0, protectionCount: 0, protectionLast: null, above40: 0, above70: 0, maxIntegratedAngle: 0, maxNearTravelRatio: 0, forceRetries: 0, maxGeometricTravelRatio: 0, acceptedTime: 0, droppedTime: 0, droppedSteps: 0, protectionTranslationEnergy: 0, protectionRotationEnergy: 0, protectionWorldEnergyChange: 0, protectionSupportWork: 0, protectionBoundExceeded: 0, capped: 0, frames: 0, ms: 0, msMax: 0, nan: 0, clearance: Infinity, swing: 0, twist: 0, hinge: 0, flexMax: 0, simT: 0, settleSpeed: 0, water: false };
		this.focus.set( this.pelvis.x.x, this.pelvis.x.y, this.pelvis.x.z );
		this.floorY = this.ground( this.pelvis.x.x, this.pelvis.x.z, this.pelvis.x.y );
		return true;

	}

	com( o ) {

		o.x = o.y = o.z = 0;
		for ( const b of this.bodies ) { o.x += b.x.x * b.m; o.y += b.x.y * b.m; o.z += b.x.z * b.m; }
		o.x /= this.mass; o.y /= this.mass; o.z /= this.mass;
		return o;

	}

	// a knock while ragdolling (or at the start): 40 % over the whole body, 60 % where it lands
	push( impulse, point ) {

		if ( ! impulse || this.phase === 'idle' && ! this.built ) return;
		for ( const b of this.bodies ) { b.v.x += impulse.x * 0.4 / this.mass; b.v.y += impulse.y * 0.4 / this.mass; b.v.z += impulse.z * 0.4 / this.mass; }
		let k = this.chest, best = Infinity;
		if ( point ) for ( const b of this.bodies ) { const d = ( b.x.x - point.x ) ** 2 + ( b.x.y - point.y ) ** 2 + ( b.x.z - point.z ) ** 2; if ( d < best ) { best = d; k = b; } }
		const J = { x: impulse.x * 0.6, y: impulse.y * 0.6, z: impulse.z * 0.6 };
		k.v.x += J.x * k.im; k.v.y += J.y * k.im; k.v.z += J.z * k.im;
		if ( point ) { this.invI( k, cross( { x: point.x - k.x.x, y: point.y - k.x.y, z: point.z - k.x.z }, J, _a ), _b ); k.w.x += _b.x; k.w.y += _b.y; k.w.z += _b.z; }

	}

	// ------------------------------------------------------------------ XPBD

	// o = I^-1 u (world): capsule inertia about its axis and across it
	invI( b, u, o ) {

		const a = rot( b.q, b.ax, _f ), d = dot( a, u );
		o.x = ( u.x - a.x * d ) * b.iPerp + a.x * d * b.iAx;
		o.y = ( u.y - a.y * d ) * b.iPerp + a.y * d * b.iAx;
		o.z = ( u.z - a.z * d ) * b.iPerp + a.z * d * b.iAx;
		return o;

	}

	// generalised inverse mass at world offset r along unit n (r null: rotation only)
	wPos( b, r, n ) { cross( r, n, _d ); this.invI( b, _d, _e ); return b.im + dot( _d, _e ); }
	wRot( b, n ) { this.invI( b, n, _e ); return dot( n, _e ); }

	// move body b by the correction P (applied at offset r), sign s
	applyPos( b, r, P, s ) {

		b.x.x += P.x * b.im * s; b.x.y += P.y * b.im * s; b.x.z += P.z * b.im * s;
		this.invI( b, cross( r, P, _d ), _e );
		turn( b.q, _e.x, _e.y, _e.z, s );

	}

	applyRot( b, P, s ) { this.invI( b, P, _e ); turn( b.q, _e.x, _e.y, _e.z, s ); }

	// rotate p by + and c by - (together by the vector dphi)
	angular( p, c, dx, dy, dz ) {

		const th = Math.hypot( dx, dy, dz );
		if ( th < 1e-7 ) return;
		const n = _an; n.x = dx / th; n.y = dy / th; n.z = dz / th;
		const l = th / ( this.wRot( p, n ) + this.wRot( c, n ) ), P = _aP;
		P.x = n.x * l; P.y = n.y * l; P.z = n.z * l;
		this.applyRot( p, P, 1 );
		this.applyRot( c, P, - 1 );

	}

	solveJoint( c, anchors = true ) {

		const p = c.parent;
		// ball joint: the child's bone head onto its anchor on the parent
		const rp = rot( p.q, c.rP, _rp ), rc = rot( c.q, c.o, _rc );
		const dx = c.x.x + rc.x - p.x.x - rp.x, dy = c.x.y + rc.y - p.x.y - rp.y, dz = c.x.z + rc.z - p.x.z - rp.z, d = Math.hypot( dx, dy, dz );
		if ( anchors && d > 1e-7 ) {

			const n = _n; n.x = dx / d; n.y = dy / d; n.z = dz / d;
			const l = d / ( this.wPos( p, rp, n ) + this.wPos( c, rc, n ) ), P = _P;
			P.x = n.x * l; P.y = n.y * l; P.z = n.z * l;
			this.applyPos( p, rp, P, 1 );
			this.applyPos( c, rc, P, - 1 );

		}

		// Position repair uses the actual coordinate gradient, including its
		// magnitude. The mean anatomical axis is not the derivative at a tilt.
		const count = c.hinge ? 3 : 2;
		let coordinates = null;
		for ( let i = 0; i < count; i ++ ) {
			// Earlier coordinates only invalidate the remaining gradients if they rotate a body.
			const coordinate = ( coordinates ??= jointCoordinates( p, c ) )[ i ]; if ( ! coordinate ) continue;
			const { angle, min, max, n } = coordinate, target = Math.min( max, Math.max( min, angle ) ), error = angle - target;
			if ( Math.abs( error ) < 1e-7 ) continue;
			const inverseMass = this.wRot( p, n ) + this.wRot( c, n ); if ( inverseMass < 1e-12 ) continue;
			const impulse = error / inverseMass, P = _aP; P.x = n.x * impulse; P.y = n.y * impulse; P.z = n.z * impulse;
			this.applyRot( p, P, 1 ); this.applyRot( c, P, - 1 );
			coordinates = null;
		}

	}

	// the ground plane under every contact sphere, once a frame (height, slope normal at where it is now);
	// the substeps read the plane at the sphere's new place, and take it again once the sphere has moved
	// PLANE_REACH from where it was taken (refreshPlane)
	planes() {

		let k = 0;
		for ( const b of this.bodies ) for ( const sp of b.samples ) {

			rot( b.q, sp, _a );
			const pl = this.plane[ k ] || ( this.plane[ k ] = { g: 0, x: 0, z: 0, nx: 0, ny: 1, nz: 0 } );
			k ++;
			this.refreshPlane( pl, b, b.x.x + _a.x, b.x.y + _a.y, b.x.z + _a.z );

		}

	}

	// one sphere's plane, taken at (px, py, pz); allocation-free on terrain (it runs inside the substeps)
	refreshPlane( pl, b, px, py, pz ) {

		// a whole frame's travel above it still counts (a fast fall onto a deck)
		const g = this.ground( px, pz, py + b.r + Math.max( 0, - b.v.y ) / 30 );
		pl.g = g; pl.x = px; pl.z = pz; pl.nx = 0; pl.ny = 1; pl.nz = 0;
		pl.provider = this.groundProvider;
		pl.velocity = pl.provider?.velocityAt( [ px, g, pz ] ) || STILL;
		if ( this.groundProvider ) {
			const support = this.groundProvider.supportAt( [ px, g, pz ], SUPPORT_REACH );
			if ( support ) { pl.nx = support.normal[ 0 ]; pl.ny = support.normal[ 1 ]; pl.nz = support.normal[ 2 ]; }
		}
		if ( this.onTerrain ) {

			const T = this.player.terrain, e = 0.25;
			const nx = T.heightAt( px - e, pz ) - T.heightAt( px + e, pz ), ny = 2 * e, nz = T.heightAt( px, pz - e ) - T.heightAt( px, pz + e );
			const l = Math.hypot( nx, ny, nz ); pl.nx = nx / l; pl.ny = ny / l; pl.nz = nz / l;

		}

	}

	// the highest ground under (x, z) at or below maxY; this.onTerrain says whether it is the terrain's
	ground( x, z, maxY ) {

		const pl = this.player;
		let g = pl.terrain.heightAt( x, z );
		this.onTerrain = true;
		this.groundProvider = null;
		const c = pl.colliders.groundHeightAt.call( this.near, x, z, maxY );
		if ( c > g ) { g = c; this.onTerrain = false; }
		if ( pl.reef && pl.reef.floorHeightAt && maxY < this.waterY ) { const r = pl.reef.floorHeightAt( x, z ); if ( r > g ) { g = r; this.onTerrain = false; } }
		for ( const provider of pl.groundProviders || [] ) {
			const y = provider.groundHeightAt( x, z, maxY );
			if ( y > g ) { g = y; this.onTerrain = false; this.groundProvider = provider; }
		}
		return g;

	}

	// the colliders within reach of the body (a few times a second)
	gather() {

		const C = this.player.colliders, P = this.pelvis.x, reach = 6 + Math.hypot( P.x === P.x ? this.pelvis.v.x : 0, this.pelvis.v.z ) * 0.3;
		const nb = this.near.boxes, nc = this.near.cylinders;
		nb.length = 0; nc.length = 0;
		for ( const b of C.boxes ) if ( Math.abs( b.center.x - P.x ) < b.radius + reach && Math.abs( b.center.z - P.z ) < b.radius + reach ) nb.push( b );
		for ( const c of C.cylinders ) if ( Math.abs( c.x - P.x ) < c.radius + reach && Math.abs( c.z - P.z ) < c.radius + reach ) nc.push( c );
		const t = this.trunks && this.trunks();
		if ( t ) for ( let i = 0; i < t.length; i += 5 ) if ( Math.abs( t[ i ] - P.x ) < reach && Math.abs( t[ i + 1 ] - P.z ) < reach ) nc.push( { x: t[ i ], z: t[ i + 1 ], radius: t[ i + 2 ], yMin: t[ i + 3 ], yMax: t[ i + 4 ] } );

	}

	projectAnchors() {
		// Exact mass-weighted projection at fixed rotations. A connected tree's
		// relative centres are unique; its mass centre supplies the free translation.
		const before = { ...this.com( _c ) };
		for ( const b of this.joints ) {
			const p = b.parent; rot( p.q, b.rP, _a ); rot( b.q, b.o, _b );
			b.x.x = p.x.x + _a.x - _b.x; b.x.y = p.x.y + _a.y - _b.y; b.x.z = p.x.z + _a.z - _b.z;
		}
		const after = this.com( _c ), dx = before.x - after.x, dy = before.y - after.y, dz = before.z - after.z;
		for ( const b of this.bodies ) { b.x.x += dx; b.x.y += dy; b.x.z += dz; }
	}

	kineticEnergy( parts ) {
		let E = 0, translation = 0;
		for ( const b of this.bodies ) {
			rot( b.q, b.ax, _a ); const along = dot( b.w, _a ), w2 = dot( b.w, b.w );
			translation += 0.5 * b.m * dot( b.v, b.v );
			E += 0.5 * b.m * dot( b.v, b.v ) + 0.5 * ( Math.max( 0, w2 - along * along ) / b.iPerp + along * along / b.iAx );
		}
		if ( parts ) { parts.translation = translation; parts.rotation = E - translation; }
		return E;
	}

	integrationStep( remaining, nominalStep ) {
		let h = Math.min( remaining, nominalStep ), k = 0;
		for ( const b of this.bodies ) {
			const spin = Math.hypot( b.w.x, b.w.y, b.w.z );
			if ( spin > 0 ) h = Math.min( h, MAX_ROTATION_STEP / spin );
			for ( const sp of b.samples ) {
				rot( b.q, sp, _a ); const pl = this.plane[ k ++ ], px = b.x.x + _a.x, py = b.x.y + _a.y, pz = b.x.z + _a.z;
				const gap = ( py - b.r - pl.g ) * pl.ny + pl.nx * ( px - pl.x ) + pl.nz * ( pz - pl.z );
				pl.startX = px; pl.startY = py; pl.startZ = pz; pl.startGap = gap;
				pl.referenceVelocity = pl.provider?.velocityAt( [ px, py, pz ] ) || pl.velocity;
				const arm = _a; cross( b.w, arm, _b );
				const vx = b.v.x + _b.x - pl.referenceVelocity[ 0 ], vy = b.v.y + _b.y - pl.referenceVelocity[ 1 ], vz = b.v.z + _b.z - pl.referenceVelocity[ 2 ], speed = Math.hypot( vx, vy, vz );
				const closing = - ( vx * pl.nx + vy * pl.ny + vz * pl.nz );
				if ( speed > 0 && gap < Math.max( 0, closing ) * h + b.r ) h = Math.min( h, CONTACT_TRAVEL * b.r / speed );
			}
		}
		return h;
	}

	measureAdvance( h, geometric, commit = true ) {
		let k = 0, travel = 0;
		for ( const b of this.bodies ) for ( const sp of b.samples ) {
			rot( b.q, sp, _a ); const pl = this.plane[ k ++ ], x = b.x.x + _a.x, y = b.x.y + _a.y, z = b.x.z + _a.z;
			if ( geometric ) {
				this.stats.maxGeometricTravelRatio = Math.max( this.stats.maxGeometricTravelRatio, Math.hypot( x - pl.predictX, y - pl.predictY, z - pl.predictZ ) / b.r );
			} else {
				const gap = ( y - b.r - pl.g ) * pl.ny + pl.nx * ( x - pl.x ) + pl.nz * ( z - pl.z );
				if ( Math.min( pl.startGap, gap ) < b.r ) travel = Math.max( travel, Math.hypot( x - pl.startX - ( pl.referenceVelocity || pl.velocity )[ 0 ] * h, y - pl.startY - ( pl.referenceVelocity || pl.velocity )[ 1 ] * h, z - pl.startZ - ( pl.referenceVelocity || pl.velocity )[ 2 ] * h ) / b.r );
				pl.predictX = x; pl.predictY = y; pl.predictZ = z;
			}
		}
		if ( commit && ! geometric ) this.stats.maxNearTravelRatio = Math.max( this.stats.maxNearTravelRatio, travel );
		return travel;
	}

	protectBudget( h, cause = 'substep-budget' ) {
		// Explicit numerical dissipation in the contacted support's rigid frame.
		// A co-moving passenger must not be braked against an arbitrary world frame.
		const worldBefore = this.kineticEnergy(); let scale = 1, translation = 0, rotation = 0;
		let reference = null, closest = Infinity;
		for ( const pl of this.plane ) if ( pl.startGap < closest ) { closest = pl.startGap; reference = pl; }
		const provider = reference?.provider, drift = reference?.velocity || [ 0, 0, 0 ], omega = provider?.angularVelocity?.() || [ 0, 0, 0 ];
		for ( const b of this.bodies ) {
			const flow = provider?.velocityAt( [ b.x.x, b.x.y, b.x.z ] ) || drift;
			b.protectVX = flow[ 0 ]; b.protectVY = flow[ 1 ]; b.protectVZ = flow[ 2 ];
			b.protectWX = omega[ 0 ]; b.protectWY = omega[ 1 ]; b.protectWZ = omega[ 2 ];
			const vx = b.v.x - flow[ 0 ], vy = b.v.y - flow[ 1 ], vz = b.v.z - flow[ 2 ], wx = b.w.x - omega[ 0 ], wy = b.w.y - omega[ 1 ], wz = b.w.z - omega[ 2 ];
			const w = Math.hypot( wx, wy, wz ), v = Math.hypot( vx, vy, vz );
			translation += .5 * b.m * v * v; rot( b.q, b.ax, _a ); const axial = wx * _a.x + wy * _a.y + wz * _a.z;
			rotation += .5 * ( Math.max( 0, w * w - axial * axial ) / b.iPerp + axial * axial / b.iAx );
			if ( w > 0 ) scale = Math.min( scale, Math.max( 0, MAX_ROTATION_STEP / h - Math.hypot( ...omega ) ) / w );
			const travel = v + w * ( b.len / 2 + b.r );
			if ( travel > 0 ) scale = Math.min( scale, CONTACT_TRAVEL * b.r / ( travel * h ) );
		}
		if ( scale >= 1 ) return;
		for ( const b of this.bodies ) {
			b.v.x = b.protectVX + ( b.v.x - b.protectVX ) * scale; b.v.y = b.protectVY + ( b.v.y - b.protectVY ) * scale; b.v.z = b.protectVZ + ( b.v.z - b.protectVZ ) * scale;
			b.w.x = b.protectWX + ( b.w.x - b.protectWX ) * scale; b.w.y = b.protectWY + ( b.w.y - b.protectWY ) * scale; b.w.z = b.protectWZ + ( b.w.z - b.protectWZ ) * scale;
		}
		translation *= 1 - scale * scale; rotation *= 1 - scale * scale;
		const removed = translation + rotation, worldChange = this.kineticEnergy() - worldBefore, supportWork = worldChange + removed;
		this.stats.capped ++; this.stats.protectionCount ++; this.stats.protectionEnergy += removed;
		this.stats.protectionTranslationEnergy += translation; this.stats.protectionRotationEnergy += rotation;
		this.stats.protectionWorldEnergyChange += worldChange; this.stats.protectionSupportWork += supportWork;
		this.stats.protectionLast = { cause, remaining: h, scale, removed, translation, rotation, worldChange, supportWork, support: provider?.id || null };
	}

	integrateForces( h, W ) {
		for ( const b of this.bodies ) {

				b.v.x = b.stepVX; b.v.y = b.stepVY; b.v.z = b.stepVZ; b.w.x = b.stepWX; b.w.y = b.stepWY; b.w.z = b.stepWZ;
				b.v.y -= G * h;
				// The capsule solver owns its water entry/lift law. Shared air and supported
				// ground loads use its actual mass; no second water resistance is added.
				let ux = 0, uz = 0, water = W;
				if ( this.disasterField ) {
					const a = this.disasterField.acceleration( b.x, b.v, { mass: b.m, area: 2 * b.r * ( b.len + 2 * b.r ), height: 2 * b.r, buoyancy: false, waterDrag: false, supported: !! this.supportedStep, dt: h }, {} );
					b.v.x += a.ax * h; b.v.y += a.ay * h; b.v.z += a.az * h;
					ux = a.ux; uz = a.uz; water = a.height;
				}
				const sub = Math.min( 1, Math.max( 0, ( water - ( b.x.y - b.r ) ) / ( 2 * b.r ) ) );
				if ( sub > 0 ) {

					b.v.y += G * b.float * sub * h;
					b.v.x -= ux; b.v.z -= uz;
					const vh2 = b.v.x * b.v.x + b.v.z * b.v.z, sp = Math.sqrt( vh2 + b.v.y * b.v.y );
					if ( b.v.y < 0 ) b.v.y += Math.min( - b.v.y, ENTRY.plane * sub * sp * - b.v.y * h ); // planing: never reversed in a step
					b.v.y += ENTRY.skim * sub * Math.max( 0, vh2 - ENTRY.skimMin * ENTRY.skimMin ) * h;
					const kq = 1 / ( 1 + ENTRY.drag * sub * sp * h );
					b.v.x *= kq; b.v.y *= kq; b.v.z *= kq;
					const k = Math.exp( - WATER_DRAG * sub * h ), kw = Math.exp( - WATER_SPIN * sub * h );
					b.v.x = ux + b.v.x * k; b.v.y *= k; b.v.z = uz + b.v.z * k; b.w.x *= kw; b.w.y *= kw; b.w.z *= kw;

				}

				const kw = Math.exp( - SPIN_DAMP * h );
				b.w.x *= kw; b.w.y *= kw; b.w.z *= kw;
			}

	}

	simulate( dt ) {

		dt = Math.min( dt, 0.1 );
		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		const prepared = this._preparedSimulation;
		this._preparedSimulation = null;
		if ( prepared?.consume( this, dt ) ) return;
		if ( ( this.nearT -= dt ) <= 0 ) { this.nearT = 0.2; this.gather(); }
		if ( this.disasterField ) this.waterY = this.disasterField.waterAt( this.pelvis.x.x, this.pelvis.x.z );
		this.stats.acceptedTime += dt;
		const nominal = this.opts.sub || SUB;
		const nominalStep = Math.min( dt / nominal, 1 / ( 60 * nominal ) ), B = this.bodies, W = this.waterY;
		let supported = false, low = Infinity, elapsed = 0, s = 0, planeX = this.pelvis.x.x, planeY = this.pelvis.x.y, planeZ = this.pelvis.x.z;
		this.stats.selfContacts = 0;
		this.planes();
		while ( elapsed < dt - 1e-10 ) {
			if ( Math.hypot( this.pelvis.x.x - planeX, this.pelvis.x.y - planeY, this.pelvis.x.z - planeZ ) > 0.15 ) { this.planes(); planeX = this.pelvis.x.x; planeY = this.pelvis.x.y; planeZ = this.pelvis.x.z; }
			const remaining = dt - elapsed, budget = s >= MAX_SUBSTEPS - 1;
			const requested = this.integrationStep( remaining, nominalStep );
			if ( ! Number.isFinite( requested ) || requested <= 0 ) { this.stats.droppedTime += remaining; this.stats.droppedSteps ++; this.stats.droppedLast = { cause: 'invalid-step', remaining }; break; }
			let h = budget ? remaining : requested;
			s ++;



			for ( const b of B ) {
				Object.assign( b.px, b.x ); Object.assign( b.pq, b.q );
				b.stepVX = b.v.x; b.stepVY = b.v.y; b.stepVZ = b.v.z; b.stepWX = b.w.x; b.stepWY = b.w.y; b.stepWZ = b.w.z;
			}
			let retries = 0;
			while ( true ) {
				this.integrateForces( h, W );
				if ( budget ) this.protectBudget( h );
				if ( this.debugStep ) this.debugForcesK = this.kineticEnergy();
				for ( const b of B ) {
					b.x.x = b.px.x + b.v.x * h; b.x.y = b.px.y + b.v.y * h; b.x.z = b.px.z + b.v.z * h;
					Object.assign( b.q, b.pq ); turn( b.q, b.w.x, b.w.y, b.w.z, h );
				}
				const travel = this.measureAdvance( h, false, false );
				if ( budget ) { if ( travel > CONTACT_TRAVEL * ( 1 + 1e-9 ) ) this.stats.protectionBoundExceeded ++; break; }
				if ( travel <= CONTACT_TRAVEL * ( 1 + 1e-9 ) ) break;
				// The field and gravity were evaluated at this tentative h. Retry from
				// the same pose/velocity so a shorter trial never applies them twice.
				for ( const b of B ) { Object.assign( b.x, b.px ); Object.assign( b.q, b.pq ); }
				h *= 0.98 * CONTACT_TRAVEL / travel; retries ++;
				if ( retries > 8 ) {
					this.integrateForces( h, W ); this.protectBudget( h, 'force-refinement' );
					for ( const b of B ) { b.x.x = b.px.x + b.v.x * h; b.x.y = b.px.y + b.v.y * h; b.x.z = b.px.z + b.v.z * h; Object.assign( b.q, b.pq ); turn( b.q, b.w.x, b.w.y, b.w.z, h ); }
					break;
				}
			}
			this.stats.forceRetries += retries;
			this.debugStep?.( 'forces', s );
			for ( const b of B ) {
				const spin = Math.hypot( b.w.x, b.w.y, b.w.z ), speed = Math.hypot( b.v.x, b.v.y, b.v.z );
				if ( spin > 40 ) this.stats.above40 ++; if ( speed > 70 ) this.stats.above70 ++;
				this.stats.maxIntegratedAngle = Math.max( this.stats.maxIntegratedAngle, spin * h );
			}
			this.measureAdvance( h, false );
			this.debugStep?.( 'predict', s );
			for ( const c of this.joints ) this.solveJoint( c );
			// Self overlap repair stays inside the articulated geometric solve.
			// Its correction is not reconstructed as physical limb velocity.
			for ( const [ a, b ] of this.selfPairs || [] ) {
				const c = capsuleContact( a, b ); if ( ! c ) continue;
				const n = c.normal, ra = { x: c.point.x - a.x.x, y: c.point.y - a.x.y, z: c.point.z - a.x.z }, rb = { x: c.point.x - b.x.x, y: c.point.y - b.x.y, z: c.point.z - b.x.z };
				const l = Math.min( DEPEN * h, Math.max( 0, c.penetration - 0.001 ) ) / ( this.wPos( a, ra, n ) + this.wPos( b, rb, n ) );
				const P = { x: n.x * l, y: n.y * l, z: n.z * l };
				this.applyPos( a, ra, P, - 1 ); this.applyPos( b, rb, P, 1 );
				this.stats.selfContacts ++;
			}
			// contacts: spheres along each capsule against the ground under them, and the walls
			let nc = 0, nw = 0, k = 0;
			for ( const b of B ) {

				b.supported = false;
				for ( const sp of b.samples ) {

					rot( b.q, sp, _a );
					const px = b.x.x + _a.x, py = b.x.y + _a.y, pz = b.x.z + _a.z, pl = this.plane[ k ++ ];
					if ( Math.hypot( px - pl.x, pz - pl.z ) > PLANE_REACH ) this.refreshPlane( pl, b, px, py, pz );
					const nx = pl.nx, ny = pl.ny, nz = pl.nz, g = pl.g - ( nx * ( px - pl.x ) + nz * ( pz - pl.z ) ) / ny;
					const pen = g + b.r - py;
					if ( elapsed + h >= dt - 1e-10 && py - b.r - g < low ) low = py - b.r - g;
					if ( pen <= 0 ) continue;

					const ct = this.contacts[ nc ] || ( this.contacts[ nc ] = { b: null, r: V(), n: V(), l: 0, vn: 0 } );
					nc ++;
					ct.b = b; ct.sample = sp; ct.n.x = nx; ct.n.y = ny; ct.n.z = nz;
					ct.r.x = _a.x - nx * b.r; ct.r.y = _a.y - ny * b.r; ct.r.z = _a.z - nz * b.r;
					// the approach speed before this substep (for the bounce)
					cross( b.w, ct.r, _b );
					ct.velocity = pl.velocity;
					ct.vn = nx * ( b.v.x + _b.x - pl.velocity[ 0 ] ) + ny * ( b.v.y + _b.y - pl.velocity[ 1 ] ) + nz * ( b.v.z + _b.z - pl.velocity[ 2 ] );
					const d = pen * ny, w = this.wPos( b, ct.r, ct.n ), l = d / w;
					ct.l = l;
					if ( l > 0 && ny > 0.3 ) b.supported = true;
					_P.x = nx * l; _P.y = ny * l; _P.z = nz * l;
					this.applyPos( b, ct.r, _P, 1 );
					supported = true;

				}

				// walls (the body's middle, as a vertical capsule), every third substep
				if ( s % 3 !== 2 ) continue;
				const f = this._feet.set( b.x.x, b.x.y - b.r, b.x.z ), bx = f.x, bz = f.z;
				let wall = this.player.colliders.resolveCapsule.call( this.near, f, b.r, 2 * b.r, 0 );
				for ( const provider of this.player.groundProviders || [] ) wall = provider.resolveCapsule?.( f, b.r, 2 * b.r, 0 ) || wall;
				if ( wall ) {

					const dx = f.x - bx, dz = f.z - bz, d = Math.hypot( dx, dz );
					if ( d > 1e-6 ) {

						b.x.x += dx; b.x.z += dz;
						const wl = this.walls[ nw ] || ( this.walls[ nw ] = { b: null, x: 0, z: 0 } );
						nw ++;
						wl.b = b; wl.x = dx / d; wl.z = dz / d;

					}

				}

			}

			// Every capsule is connected through joints. Base excitation acts on the
			// whole supported rig, just as native stack support propagates through bodies.
			this.supportedStep = B.some( b => b.supported );
			// a second pass over the joints (the contacts pushed limbs about): limits hold on hard landings
			for ( const c of this.joints ) this.solveJoint( c );
			// Coupled limits can disturb a neighbouring joint. Repair only actual
			// remaining coordinate error, with a bounded three-pass budget.
			for ( let pass = 0; pass < 3; pass ++ ) {
				let repairs = 0;
				for ( const c of this.joints ) if ( jointCoordinates( c.parent, c ).some( a => a.angle < a.min - .5 * D2R || a.angle > a.max + .5 * D2R ) ) { this.solveJoint( c, false ); repairs ++; }
				if ( ! repairs ) break;
			}
			this.projectAnchors();
			for ( let i = 0; i < nc; i ++ ) { const ct = this.contacts[ i ]; rot( ct.b.q, ct.sample, _a ); ct.r.x = _a.x - ct.n.x * ct.b.r; ct.r.y = _a.y - ct.n.y * ct.b.r; ct.r.z = _a.z - ct.n.z * ct.b.r; }
			this.measureAdvance( h, true );
			this.debugStep?.( 'position', s );
			// Split position stabilization does not create physical velocity from
			// geometric error. Forces and passive constraint/contact impulses own
			// velocity; otherwise an overlap correction becomes a next-step kick.


			// Coupled contact iterations: geometric repair does not fund friction.
			const response = articulatedContact( this, { viscosityStep: ( this.opts.jointViscosity ?? JOINT_VISCOSITY ) * h, deferWriteback: true } );
			if ( this.debugStep ) this.debugResponse = response;
			this.debugStep?.( 'base', s );
			for ( let i = 0; i < nc; i ++ ) { const c = this.contacts[ i ]; c.normalImpulse = 0; c.normalMass = null; c.tx = c.ty = c.tz = 0; }
			const self = [];
			for ( const [ a, b ] of this.selfPairs || [] ) {
				const ct = capsuleContact( a, b ); if ( ! ct ) continue;
				self.push( { a, b, n: ct.normal, ra: { x: ct.point.x - a.x.x, y: ct.point.y - a.x.y, z: ct.point.z - a.x.z }, rb: { x: ct.point.x - b.x.x, y: ct.point.y - b.x.y, z: ct.point.z - b.x.z }, impulse: 0 } );
			}
			for ( let iteration = 0; iteration < 8; iteration ++ ) {
				const limitChange = response.limits( h );
				if ( this.debugStep ) { response.writeback(); this.debugStep( 'limits' + iteration, s ); }
				if ( nc === 0 && self.length === 0 && limitChange < 1e-12 ) break;
				for ( let i = 0; i < nc; i ++ ) {
					const ct = this.contacts[ i ], b = ct.b, n = ct.n, sv = ct.velocity || [ 0, 0, 0 ];
					response.pointVelocity( b, ct.r, _b );
					const vn = ( _b.x - sv[ 0 ] ) * n.x + ( _b.y - sv[ 1 ] ) * n.y + ( _b.z - sv[ 2 ] ) * n.z;
					const want = ct.vn < - 2.5 ? - ( this.opts.restitution ?? BOUNCE ) * ct.vn : 0;
					const total = Math.max( 0, ct.normalImpulse + ( want - vn ) / ( ct.normalMass ??= response.wPos( b, ct.r, n ) ) ), Jn = total - ct.normalImpulse;
					ct.normalImpulse = total; response.impulse( b, ct.r, n.x * Jn, n.y * Jn, n.z * Jn );
					response.pointVelocity( b, ct.r, _b );
					const vx = _b.x - sv[ 0 ], vy = _b.y - sv[ 1 ], vz = _b.z - sv[ 2 ], normal = vx * n.x + vy * n.y + vz * n.z;
					const tx = vx - n.x * normal, ty = vy - n.y * normal, tz = vz - n.z * normal, vt = Math.hypot( tx, ty, tz );
					{
						const t = _t; t.x = vt > 1e-6 ? tx / vt : 0; t.y = vt > 1e-6 ? ty / vt : 0; t.z = vt > 1e-6 ? tz / vt : 0;
						const J = vt > 1e-6 ? vt / response.wPos( b, ct.r, t ) : 0;
						let x = ct.tx - t.x * J, y = ct.ty - t.y * J, z = ct.tz - t.z * J;
						const size = Math.hypot( x, y, z ), scale = size > ( this.opts.friction ?? MU ) * total ? ( this.opts.friction ?? MU ) * total / size : 1;
						x *= scale; y *= scale; z *= scale;
						response.impulse( b, ct.r, x - ct.tx, y - ct.ty, z - ct.tz );ct.tx = x;ct.ty = y;ct.tz = z;
					}
				}
				if ( this.debugStep ) { response.writeback(); this.debugStep( 'ground' + iteration, s ); }
				for ( const ct of self ) {
					const { a, b, ra, rb, n } = ct;
					const closing = response.relativeSpeed( a, ra, b, rb, n );
					const total = Math.max( 0, ct.impulse - closing / ( ct.inverseMass ??= response.pairMass( a, ra, b, rb, n ) ) ), J = total - ct.impulse;
					ct.impulse = total; response.pairImpulse( a, ra, b, rb, n.x * J, n.y * J, n.z * J );
				}
			}

			response.writeback();
			for ( let i = 0; i < nw; i ++ ) {

				const wl = this.walls[ i ], v = wl.b.v, vn = v.x * wl.x + v.z * wl.z;
				if ( vn < 0 ) { v.x -= wl.x * vn; v.z -= wl.z * vn; const k = Math.max( 0, 1 + MU_WALL * vn / ( Math.hypot( v.x, v.z ) + 1e-6 ) ); v.x *= k; v.z *= k; }

			}
			if ( nw ) response.readBodies();
			response.limits( h );
			response.writeback();
			this.debugStep?.( 'end', s );
			elapsed += h;
		}

		this.stats.substeps = s; this.stats.substepsMax = Math.max( this.stats.substepsMax, s ); this.stats.consumedTime += elapsed;
		this.lastLow = low;
		this.supported = supported;

	}

	impulse( b, r, jx, jy, jz ) {

		b.v.x += jx * b.im; b.v.y += jy * b.im; b.v.z += jz * b.im;
		this.invI( b, cross( r, { x: jx, y: jy, z: jz }, _d ), _e );
		b.w.x += _e.x; b.w.y += _e.y; b.w.z += _e.z;

	}

	// Collision impulse at a measured point, including rotational effective mass.
	// The caller applies the equal opposite impulse to its body. No launch speed,
	// upward impulse, or angular velocity is invented here.
	contactImpulse( point, normal, otherVelocity, otherMass, restitution = 0.15 ) {

		let b = this.chest, distance = Infinity;
		for ( const candidate of this.bodies ) {
			const d = ( point.x - candidate.x.x ) ** 2 + ( point.y - candidate.x.y ) ** 2 + ( point.z - candidate.x.z ) ** 2;
			if ( d < distance ) { b = candidate; distance = d; }
		}
		const r = { x: point.x - b.x.x, y: point.y - b.x.y, z: point.z - b.x.z }, spin = cross( b.w, r, V() );
		const closing = ( otherVelocity.x - b.v.x - spin.x ) * normal.x + ( otherVelocity.y - b.v.y - spin.y ) * normal.y + ( otherVelocity.z - b.v.z - spin.z ) * normal.z;
		if ( closing <= 0 ) return 0;
		const J = ( 1 + restitution ) * closing / ( 1 / otherMass + this.wPos( b, r, normal ) );
		this.impulse( b, r, normal.x * J, normal.y * J, normal.z * J );
		this.rest = 0;
		return J;

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		dt = Math.min( dt, 0.1 );

		if ( this.phase === 'sim' ) {

			const t0 = performance.now();
			const safe = this.safe;
			this.bodies.forEach( ( b, i ) => { safe[ i * 7 ] = b.x.x; safe[ i * 7 + 1 ] = b.x.y; safe[ i * 7 + 2 ] = b.x.z; safe[ i * 7 + 3 ] = b.q.x; safe[ i * 7 + 4 ] = b.q.y; safe[ i * 7 + 5 ] = b.q.z; safe[ i * 7 + 6 ] = b.q.w; } );
			this.simulate( dt );
			this.t += dt;
			this.ground( this.pelvis.x.x, this.pelvis.x.z, this.pelvis.x.y );
			const movingSupport = this.supported ? this.groundProvider : null;
			const carriedSpin = movingSupport?.angularVelocity?.() || [ 0, 0, 0 ];
			let e = 0, spin = 0, ok = true;
			for ( const b of this.bodies ) {

				const carried = movingSupport?.velocityAt( [ b.x.x, b.x.y, b.x.z ] ) || [ 0, 0, 0 ];
				e += b.m * ( ( b.v.x - carried[ 0 ] ) ** 2 + ( b.v.y - carried[ 1 ] ) ** 2 + ( b.v.z - carried[ 2 ] ) ** 2 );
				const wx = b.w.x - carriedSpin[ 0 ], wy = b.w.y - carriedSpin[ 1 ], wz = b.w.z - carriedSpin[ 2 ];
				rot( b.q, b.ax, _a );
				const along = wx * _a.x + wy * _a.y + wz * _a.z, w2 = wx * wx + wy * wy + wz * wz;
				// Twice the complete kinetic energy in the support's rigid frame.
				// A small spinning limb also has an explicit 1.5rad/s repose bound;
				// low total mass must not hide a visibly rotating head or hand.
				e += Math.max( 0, w2 - along * along ) / b.iPerp + along * along / b.iAx;
				spin = Math.max( spin, Math.sqrt( w2 ) );
				if ( ! Number.isFinite( b.x.x + b.x.y + b.x.z + b.q.x + b.q.y + b.q.z + b.q.w + b.v.x + b.v.y + b.v.z + b.w.x + b.w.y + b.w.z ) ) ok = false;

			}

			const st = this.stats;
			if ( ! ok ) {

				// never seen; if it happens, put the body back where it was and get up from there
				st.nan ++;
				this.bodies.forEach( ( b, i ) => { const o = i * 7; b.x.x = safe[ o ]; b.x.y = safe[ o + 1 ]; b.x.z = safe[ o + 2 ]; b.q.x = safe[ o + 3 ]; b.q.y = safe[ o + 4 ]; b.q.z = safe[ o + 5 ]; b.q.w = safe[ o + 6 ]; b.v.x = b.v.y = b.v.z = b.w.x = b.w.y = b.w.z = 0; } );
				this.rest = SETTLE_T;

			}

			const speed = Math.sqrt( e / this.mass ), P = this.pelvis.x, wet = P.y < this.waterY + 0.05 && this.waterY > this.ground( P.x, P.z, P.y ) + 0.4;
			st.water = st.water || wet;
			st.restSpeed = speed; st.restSpin = spin;
			// in the sea: still enough, and floated back up to the surface
			const floating = wet && P.y > this.waterY - 0.6;
			this.rest = ( ( this.supported && ! wet ) || floating ) && speed < SETTLE_V * ( wet ? 1.8 : 1 ) && spin < SETTLE_W ? this.rest + dt : 0;
			this.measure();
			this.focus.set( P.x, P.y, P.z );
			this.floorY = Math.max( this.ground( P.x, P.z, P.y ), wet ? this.waterY - 1 : - Infinity );
			if ( this.rest >= SETTLE_T ) this.settle( wet, speed );
			const ms = performance.now() - t0;
			st.frames ++; st.ms += ( ms - st.ms ) * ( st.frames < 10 ? 1 / st.frames : 0.1 ); st.msMax = Math.max( st.msMax, ms ); st.simT = this.t;

		} else if ( this.phase === 'getup' || this.phase === 'swim' ) {

			if ( this.recoverySupport ) {
				const { provider, stand, flat, origin } = this.recoverySupport;
				const write = ( point, local ) => { const p = provider.world( local ); point.x = p[ 0 ]; point.y = p[ 1 ]; point.z = p[ 2 ]; };
				write( this.standAt, stand ); write( this.flatX, flat ); write( this.x0, origin );
				this.result.at.copy( this.standAt );
			}
			this.t += dt;
			const total = this.phase === 'swim' ? SWIM_T : this.upT();
			const k = smooth( ( this.t - FLAT_T * 0.5 ) / ( total - FLAT_T * 0.5 ) ), A = this.standAt;
			this.focus.set( this.flatX.x + ( A.x - this.flatX.x ) * k, this.flatX.y + ( A.y + 1 - this.flatX.y ) * k, this.flatX.z + ( A.z - this.flatX.z ) * k );
			if ( this.t >= total ) this.phase = 'done';

		}

	}

	// the joint angles against their limits (degrees over), and the lowest point against the ground
	measure() {

		const st = this.stats;
		for ( const c of this.joints ) {

			const p = c.parent;
			if ( c.hinge ) {

				const h = rot( p.q, c.hP, _a ), a1 = rot( p.q, p.ax, _b ), a2 = rot( c.q, c.ax, _c );
				const phi = Math.atan2( dot( cross( a1, a2, _d ), h ), dot( a1, a2 ) );
				st.hinge = Math.max( st.hinge, ( Math.max( 0, phi - c.hinge[ 1 ], c.hinge[ 0 ] - phi ) ) / D2R );
				st.flexMax = Math.max( st.flexMax, phi / D2R );
				continue;

			}

			const a1 = rot( p.q, c.aN, V() ), a2 = rot( c.q, c.ax, V() );
			const th = Math.acos( Math.min( 1, Math.max( - 1, dot( a1, a2 ) ) ) );
			st.swing = Math.max( st.swing, ( th - c.cone ) / D2R );
			const n = norm( { x: a1.x + a2.x, y: a1.y + a2.y, z: a1.z + a2.z } ), b1 = rot( p.q, c.bN, V() ), b2 = rot( c.q, c.bC, V() );
			const d1 = dot( b1, n ), d2 = dot( b2, n );
			b1.x -= n.x * d1; b1.y -= n.y * d1; b1.z -= n.z * d1; b2.x -= n.x * d2; b2.y -= n.y * d2; b2.z -= n.z * d2;
			const phi = Math.atan2( dot( cross( b1, b2, _d ), n ), dot( b1, b2 ) );
			st.twist = Math.max( st.twist, ( Math.abs( phi ) - c.twist ) / D2R );

		}

		if ( this.lastLow < st.clearance ) st.clearance = this.lastLow;

	}

	// still: lie flat on the belly or back and get up facing the right way (or tread water)
	settle( wet, speed ) {

		const P = this.pelvis.x, H = this.head.x, st = this.stats;
		st.settleSpeed = speed;
		const d = norm( { x: H.x - P.x, y: 0, z: H.z - P.z } );
		if ( Math.hypot( H.x - P.x, H.z - P.z ) < 0.05 ) { const a = rot( this.chest.q, this.chest.ax, _a ); d.x = a.x; d.z = a.z; norm( d ); }
		const belly = rot( this.chest.q, this.fwdChest, _b ), down = belly.y < 0;
		this.faceDown = down;
		this.standYaw = wet || down ? Math.atan2( d.x, d.z ) : Math.atan2( - d.x, - d.z );
		// on land, the keyed get-up for how he lies: the stand spot is set back so its first (lying) frame puts the
		// hips where his are now
		const gu = this.gu = wet ? null : this.getups[ down ? 'getup_belly' : 'getup_back' ] || null;
		let sx = P.x, sz = P.z;
		if ( gu ) { const o = rot( axisAngle( { x: 0, y: 1, z: 0 }, this.standYaw, Q() ), { x: gu.p0.x, y: 0, z: gu.p0.z }, V() ); sx -= o.x; sz -= o.z; }
		this.playT = gu ? gu.clip.duration : this.landPlayT;
		const gy = this.ground( sx, sz, P.y + 0.5 );
		this.standAt.x = sx; this.standAt.y = wet ? this.waterY : gy; this.standAt.z = sz;
		this.flatX = { x: P.x, y: wet ? P.y : gy + 0.14, z: P.z };
		const zt = { x: 0, y: down ? - 1 : 1, z: 0 }, X = norm( cross( d, zt, V() ) );
		basis( X, d, zt, _q1 );
		for ( const b of this.bodies ) { Object.assign( b.q0, b.q ); qmul( _q1, b.N, b.qt ); }
		this.x0 = { x: P.x, y: P.y, z: P.z };
		this.headEye = this.eye( V() );
		Object.assign( this.lieQ = Q(), this.camQ );
		this.phase = wet ? 'swim' : 'getup';
		this.t = 0;
		this.result.at.set( sx, wet ? this.waterY : gy, sz );
		this.result.yaw = this.standYaw;
		this.result.water = wet;
		this.recoverySupport = ! wet && this.groundProvider ? { provider: this.groundProvider,
			stand: this.groundProvider.local( [ this.standAt.x, this.standAt.y, this.standAt.z ] ),
			flat: this.groundProvider.local( [ this.flatX.x, this.flatX.y, this.flatX.z ] ),
			origin: this.groundProvider.local( [ this.x0.x, this.x0.y, this.x0.z ] ) } : null;
		this.posed = false;

	}

	// the get-up's length: blend into the keyed clip and play it, or straighten, rise into jump_land and play it out
	upT() { return this.gu ? BLEND_T + this.playT : FLAT_T + RISE_T + this.playT; }

	eye( o ) { const H = this.head; rot( H.q, this.eyeLocal, o ); o.x += H.x.x; o.y += H.x.y; o.z += H.x.z; return o; }

	// ------------------------------------------------------------------ drawing (Avatar.update)

	draw( dt, avatar ) {

		const m = avatar.model, g = avatar.group, L = [];
		if ( this.phase === 'sim' ) {

			const P = this.pelvis.x;
			g.position.set( P.x, P.y, P.z );
			g.quaternion.set( 0, 0, 0, 1 );
			this.writePose( g.position, g.quaternion );
			this.layer.weight = 1; L.push( this.layer );

		} else if ( this.phase === 'getup' ) {

			const A = this.standAt, t = this.t, gu = this.gu;
			g.position.set( A.x, A.y, A.z );
			g.quaternion.setFromAxisAngle( _up, this.standYaw );
			if ( gu ) {

				// each body turns (in the world, the short way) from how it settled to how the clip's lying first frame
				// holds it, so no limb sweeps through the ground as a joint-angle blend would; then the clip plays
				if ( ! this.posed ) { this.aimClip( gu, g ); this.posed = true; }
				if ( t < BLEND_T ) {

					const s = smooth( t / BLEND_T ), P = this.pelvis.x, F = this.flatX;
					for ( const b of this.bodies ) slerp( b.q0, b.qt, s, b.q );
					P.x = this.x0.x + ( F.x - this.x0.x ) * s; P.y = this.x0.y + ( F.y - this.x0.y ) * s; P.z = this.x0.z + ( F.z - this.x0.z ) * s;
					this.writePose( g.position, g.quaternion );
					this.layer.weight = 1; L.push( this.layer );

				} else {

					const play = Math.min( gu.clip.duration, t - BLEND_T );
					const out = this.idle ? smooth( ( play - ( this.playT - OUT_T ) ) / OUT_T ) : 0;
					gu.time = play; gu.weight = 1 - out;
					if ( gu.weight > 1e-4 ) L.push( gu );
					if ( this.idle && out > 0 ) { this.idle.weight = out; L.push( this.idle ); }

				}

			} else if ( t < FLAT_T || ! this.posed ) {

				// roll flat on the belly or back, limbs gathered in
				const s = smooth( t / FLAT_T ), P = this.pelvis.x;
				for ( const b of this.bodies ) slerp( b.q0, b.qt, s, b.q );
				P.x = this.x0.x + ( this.flatX.x - this.x0.x ) * s; P.y = this.x0.y + ( this.flatX.y - this.x0.y ) * s; P.z = this.x0.z + ( this.flatX.z - this.x0.z ) * s;
				this.writePose( g.position, g.quaternion );
				this.posed = t >= FLAT_T;

			}

			if ( ! gu ) {

				const r = smooth( ( t - FLAT_T ) / RISE_T ), play = Math.max( 0, t - FLAT_T - RISE_T );
				const out = this.idle ? smooth( ( play - ( this.playT - OUT_T ) ) / OUT_T ) : 0;
				this.layer.weight = 1 - r;
				if ( this.layer.weight > 1e-4 ) L.push( this.layer );
				if ( this.land ) { this.land.time = this.tc + play; this.land.weight = r * ( 1 - out ); if ( this.land.weight > 1e-4 ) L.push( this.land ); }
				if ( this.idle && out > 0 ) { this.idle.weight = out; L.push( this.idle ); }

			}
			if ( ! L.length ) { this.layer.weight = 1; L.push( this.layer ); }

		} else if ( this.phase === 'swim' ) {

			const A = this.standAt;
			g.position.set( A.x, this.waterY - this.neckH + 0.05, A.z );
			g.quaternion.setFromAxisAngle( _up, this.standYaw );
			if ( ! this.posed ) { this.writePose( g.position, g.quaternion ); this.posed = true; }
			const w = this.tread ? smooth( this.t / SWIM_T ) : 0;
			this.layer.weight = 1 - w; L.push( this.layer );
			if ( this.tread && w > 0 ) { this.tread.weight = w; L.push( this.tread ); }

		} else return false;

		for ( const l of L ) l.target = l.weight;
		m.layers = L;
		m.update( dt );
		if ( this.phase === 'getup' ) {

			// mid-blend (lying legs folding into the crouch) knees and feet would pass through the ground:
			// lift the whole body just enough
			let lift = 0;
			for ( const [ i, h ] of this.lowNodes ) lift = Math.max( lift, h - m.world[ i * 16 + 13 ] );
			g.position.y += lift;
			this.lift = Math.max( this.lift || 0, lift );

		}

		return true;

	}

	// the keyed get-up's first frame, posed alone with the avatar group g at the stand spot: each body's world
	// rotation there (qt) and where the pelvis body sits (flatX)
	aimClip( gu, g ) {

		const m = this.model, w = m.world, gq = { x: g.quaternion.x, y: g.quaternion.y, z: g.quaternion.z, w: g.quaternion.w }, gp = g.position;
		gu.time = 0; gu.weight = gu.target = 1; m.layers = [ gu ]; m.update( 0 );
		for ( const b of this.bodies ) {

			const o = b.node * 16;
			basis( norm( { x: w[ o ], y: w[ o + 1 ], z: w[ o + 2 ] } ), norm( { x: w[ o + 4 ], y: w[ o + 5 ], z: w[ o + 6 ] } ), norm( { x: w[ o + 8 ], y: w[ o + 9 ], z: w[ o + 10 ] } ), _q1 );
			qmul( gq, _q1, b.qt );
			if ( b === this.pelvis ) {

				rot( gq, { x: w[ o + 12 ], y: w[ o + 13 ], z: w[ o + 14 ] }, _a ); rot( b.qt, b.o, _b );
				this.flatX = { x: gp.x + _a.x - _b.x, y: gp.y + _a.y - _b.y, z: gp.z + _a.z - _b.z };

			}

		}

	}

	// body poses -> the one-key clip, relative to the avatar group at gp, gq
	writePose( gp, gq ) {

		const m = this.model, T = this.T, Qs = this.Q, S = this.S, gi = _gq;
		gi.x = - gq.x; gi.y = - gq.y; gi.z = - gq.z; gi.w = gq.w;
		for ( const i of m.order ) {

			const p = m.parent[ i ], b = this.byNode[ i ], lt = this.sT[ i ], lr = this.sR[ i ];
			if ( p < 0 ) { T[ i ].x = lt[ 0 ]; T[ i ].y = lt[ 1 ]; T[ i ].z = lt[ 2 ]; Qs[ i ].x = lr[ 0 ]; Qs[ i ].y = lr[ 1 ]; Qs[ i ].z = lr[ 2 ]; Qs[ i ].w = lr[ 3 ]; S[ i ] = this.sS[ i ][ 0 ]; continue; }
			const sp = S[ p ], qp = Qs[ p ];
			S[ i ] = sp * this.sS[ i ][ 0 ];
			if ( b ) {

				qmul( gi, b.q, Qs[ i ] );
				qmul( { x: - qp.x, y: - qp.y, z: - qp.z, w: qp.w }, Qs[ i ], _q1 );
				const rv = this.rv[ i ];
				rv[ 0 ] = _q1.x; rv[ 1 ] = _q1.y; rv[ 2 ] = _q1.z; rv[ 3 ] = _q1.w;
				if ( b.root ) {

					rot( b.q, b.o, _a );
					rot( gi, { x: b.x.x + _a.x - gp.x, y: b.x.y + _a.y - gp.y, z: b.x.z + _a.z - gp.z }, T[ i ] );
					rot( qp, { x: T[ i ].x - T[ p ].x, y: T[ i ].y - T[ p ].y, z: T[ i ].z - T[ p ].z }, _b, - 1 );
					const tv = this.tv[ i ];
					tv[ 0 ] = _b.x / sp; tv[ 1 ] = _b.y / sp; tv[ 2 ] = _b.z / sp;
					continue;

				}

			} else qmul( qp, { x: lr[ 0 ], y: lr[ 1 ], z: lr[ 2 ], w: lr[ 3 ] }, Qs[ i ] );
			rot( qp, { x: lt[ 0 ] * sp, y: lt[ 1 ] * sp, z: lt[ 2 ] * sp }, T[ i ] );
			T[ i ].x += T[ p ].x; T[ i ].y += T[ p ].y; T[ i ].z += T[ p ].z;

		}

	}

	// the first-person view through the tumbling head (the car yeet); eases up to standing eyes at the end
	headCam( pos, quat, dt ) {

		if ( this.phase === 'sim' ) {

			this.eye( pos );
			const floor = this.ground( pos.x, pos.z, pos.y + 0.3 ) + 0.12;
			if ( pos.y < floor ) pos.y = floor;
			qmul( this.head.q, this.camOff, _q2 );
			slerp( this.camQ, _q2, 1 - Math.exp( - dt * 12 ), this.camQ );

		} else if ( this.headEye ) {

			const total = this.phase === 'swim' ? SWIM_T : this.upT(), k = smooth( this.t / total ), A = this.standAt;
			const top = this.phase === 'swim' ? 0.25 : EYE;
			pos.x = this.headEye.x + ( A.x - this.headEye.x ) * k; pos.y = this.headEye.y + ( A.y + top - this.headEye.y ) * k; pos.z = this.headEye.z + ( A.z - this.headEye.z ) * k;
			axisAngle( { x: 0, y: 1, z: 0 }, this.standYaw + Math.PI, _q2 );
			slerp( this.lieQ, _q2, k, this.camQ );

		}

		quat.set( this.camQ.x, this.camQ.y, this.camQ.z, this.camQ.w );

	}

	state() {

		const P = this.pelvis ? this.pelvis.x : null, st = this.stats;
		const r1 = ( x ) => Math.round( x * 10 ) / 10;
		return {
			phase: this.phase, t: r1( this.t || 0 ), rest: r1( this.rest || 0 ), faceDown: !! this.faceDown,
			pelvis: P ? [ r1( P.x ), Math.round( P.y * 100 ) / 100, r1( P.z ) ] : null,
			stats: st && { ...st, ms: Math.round( st.ms * 1000 ) / 1000, msMax: Math.round( st.msMax * 1000 ) / 1000, clearanceCm: Math.round( st.clearance * 1000 ) / 10, swing: r1( st.swing ), twist: r1( st.twist ), hinge: r1( st.hinge ), flexMax: r1( st.flexMax ) },
		};

	}

}
