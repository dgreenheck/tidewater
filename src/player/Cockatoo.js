import * as THREE from '../engine/index.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { parseGLB } from '../engine/loaders/GLTF.js';
import { Flyer, FLIGHT } from '../world/wildlife/Flight.js';
import { BIRD } from '../world/wildlife/BirdShapes.js';
import { ON_FOOT } from './Player.js';
import { CAGE } from './BirdCage.js';

// The player's pet sulphur-crested cockatoo (docs/cockatoo.md). It rides his left shoulder, and
// every 40 to 120 s it squawks, takes off and explores: circles, lands on rails, roofs, posts or the
// ground for a while, then flies back and lands on his shoulder again. It never strays far (soft leash
// 18 m, hard 30 m). It flies with the shared bird flight model (Flight.js, profile FLIGHT.cockatoo),
// rides along in the car, circles overhead while he swims, and comes straight back to a whistle (B).
//
//   const bird = new Cockatoo( app, scene );   bird.update( dt );   // after player.updateAvatar
//   window.__app.cockatoo.state();             // read-only readout (mode, distance, crest, lastSquawk)
//
// The model (public/models/cockatoo.glb, built by tools/cockatoo/cockatoo_build.py) has no baked
// animation: its clips are poses (perch, glide, flare, one wing beat, and overlays: crest, beak, head
// looks, preen, tail fan) that are blended here every frame and written into the skinned model's
// rest pose. ?cockatoo=fast shortens every interval (tests); ?cockatoo=off leaves the bird at home.

const URL = ( import.meta.env?.BASE_URL || '/' ) + 'models/cockatoo.glb';
const SOFT = 18, HARD = 30;
const SHOULDER = { clav: 'Bip01 L Clavicle', upper: 'Bip01 L UpperArm', spine: 'Bip01 Spine2', neck: 'Bip01 Neck', rclav: 'Bip01 R Clavicle' };

// ---------------------------------------------------------------- small quaternion kit ([x, y, z, w])
const qmul = ( a, b, o ) => {

	const ax = a[ 0 ], ay = a[ 1 ], az = a[ 2 ], aw = a[ 3 ], bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	o[ 0 ] = aw * bx + ax * bw + ay * bz - az * by; o[ 1 ] = aw * by - ax * bz + ay * bw + az * bx;
	o[ 2 ] = aw * bz + ax * by - ay * bx + az * bw; o[ 3 ] = aw * bw - ax * bx - ay * by - az * bz;
	return o;

};
const qnlerp = ( a, b, t, o ) => {

	const s = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - t : t;
	let x = a[ 0 ] * ( 1 - t ) + b[ 0 ] * s, y = a[ 1 ] * ( 1 - t ) + b[ 1 ] * s, z = a[ 2 ] * ( 1 - t ) + b[ 2 ] * s, w = a[ 3 ] * ( 1 - t ) + b[ 3 ] * s;
	const l = 1 / ( Math.hypot( x, y, z, w ) || 1 );
	o[ 0 ] = x * l; o[ 1 ] = y * l; o[ 2 ] = z * l; o[ 3 ] = w * l;
	return o;

};
const qinv = ( a ) => [ - a[ 0 ], - a[ 1 ], - a[ 2 ], a[ 3 ] ];
const qaxis = ( x, y, z, ang, o = null ) => {

	const s = Math.sin( ang / 2 );
	if ( ! o ) return [ x * s, y * s, z * s, Math.cos( ang / 2 ) ];
	o[ 0 ] = x * s; o[ 1 ] = y * s; o[ 2 ] = z * s; o[ 3 ] = Math.cos( ang / 2 );
	return o;

};
const rotv = ( q, v, o ) => {

	const [ x, y, z, w ] = q, vx = v.x, vy = v.y, vz = v.z;
	const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = - x * vx - y * vy - z * vz;
	return o.set( ix * w + iw * - x + iy * - z - iz * - y, iy * w + iw * - y + iz * - x - ix * - z, iz * w + iw * - z + ix * - y - iy * - x );

};
// rotation taking model axes (x = the bird's left, y = up, z = forward) onto the given orthonormal basis
const qbasis = ( X, Y, Z ) => {

	const m00 = X.x, m01 = Y.x, m02 = Z.x, m10 = X.y, m11 = Y.y, m12 = Z.y, m20 = X.z, m21 = Y.z, m22 = Z.z, tr = m00 + m11 + m22;
	let q;
	if ( tr > 0 ) {

		const s = 0.5 / Math.sqrt( tr + 1 ); q = [ ( m21 - m12 ) * s, ( m02 - m20 ) * s, ( m10 - m01 ) * s, 0.25 / s ];

	} else if ( m00 > m11 && m00 > m22 ) {

		const s = 2 * Math.sqrt( 1 + m00 - m11 - m22 ); q = [ 0.25 * s, ( m01 + m10 ) / s, ( m02 + m20 ) / s, ( m21 - m12 ) / s ];

	} else if ( m11 > m22 ) {

		const s = 2 * Math.sqrt( 1 + m11 - m00 - m22 ); q = [ ( m01 + m10 ) / s, 0.25 * s, ( m12 + m21 ) / s, ( m02 - m20 ) / s ];

	} else {

		const s = 2 * Math.sqrt( 1 + m22 - m00 - m11 ); q = [ ( m02 + m20 ) / s, ( m12 + m21 ) / s, 0.25 * s, ( m10 - m01 ) / s ];

	}

	return q;

};
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );
const sstep = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};
const toward = ( v, t, rate, dt ) => v + ( t - v ) * ( 1 - Math.exp( - rate * dt ) );

function mulberry( seed ) {

	return () => {

		seed = ( seed + 0x6D2B79F5 ) | 0;
		let t = Math.imul( seed ^ ( seed >>> 15 ), 1 | seed );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

async function fetchGLB( url ) {

	let buffer;
	if ( globalThis.__assetFile ) buffer = await globalThis.__assetFile( url );
	else {

		const res = await fetch( url );
		if ( ! res.ok ) return null;
		buffer = await res.arrayBuffer();

	}

	if ( ! buffer || buffer.byteLength < 12 || new DataView( buffer ).getUint32( 0, true ) !== 0x46546C67 ) return null;
	return parseGLB( buffer );

}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();
// per-frame temporaries (update's player point, the roof ray, quaternion scratch; _QI is read only)
const _pw = new THREE.Vector3(), _rf = new THREE.Vector3(), _UP = new THREE.Vector3( 0, 1, 0 );
const _qa = [ 0, 0, 0, 1 ], _qb = [ 0, 0, 0, 1 ], _qc = [ 0, 0, 0, 1 ], _qd = [ 0, 0, 0, 1 ], _qt = [ 0, 0, 0, 1 ], _QI = [ 0, 0, 0, 1 ];
// the lens: in flight the bird is steered off it inside CAM_SOFT and is never nearer than CAM_HARD (m);
// POP: the shrink-and-grow (s) that takes a bird still out back to his shoulder when he goes indoors
const CAM_SOFT = 1.2, CAM_HARD = 0.8, POP = 0.5;

// Where it stands: on the shirt out on the point of his left shoulder, over the top of the deltoid (x: m out
// along his left, z: m forward, both from the left clavicle joint), upright (lean: roll in toward his head, rad).
// Nearer the neck, from behind and from the chase camera his head hid the bird's head and crest and the bird read
// as a white scarf at his collar; out here the crest stands clear of his head from behind and from three-quarters. PAD: how far the toes reach below the bird's foot joints (model space, from
// the mesh: the levelled soles, claws and pads, sit 1.25 cm below them; cockatoo_import.py prints it as "sole below
// ankle"), so a landing arrives at the right height. GRIP: how far the claws
// hook into his shirt. CROUCH: how far it settles on its legs (the tarsi slide up under the belly feathers): a
// little, so it sits on his shoulder with the body up rather than squatting flat along it.
const PERCH = { x: 0.135, z: 0.0, lean: 0.0 };
const PAD = 0.0125, GRIP = 0.004, CROUCH = 0.006;
// SIZE: the model is 36 cm beak to tail (cockatoo_import.py prints "perched length"); a sulphur-crested cockatoo is 45 to
// 50 cm with the tail, so the bird is drawn 1.3x (47 cm). PAD stays in model space; GRIP and CROUCH are world metres.
// In the cage at Joe's he stays 1.0 (the cage was fitted around the 36 cm model: tools/cockatoo/cage_build.py).
const SIZE = 1.3;
const CAGE_STORAGE_SLOT = 'tidewater.cockatoo.v1'; // localStorage, next to the game save: { caged: true } while he is at Joe's

// The skin of his left shoulder: a fixed patch of avatar triangles (shirt over the trapezius, collar, top of the
// deltoid), picked once and CPU skinned each frame with the avatar's own joint matrices, the same ones the
// GPU uses. height() casts down onto it, so the bird's feet meet the rendered shirt while he walks and runs.
class ShoulderPatch {

	// m: the avatar SkinnedModel; O, X, Y, Z: his left clavicle joint and his frame (world) in the current pose
	constructor( m, O, X, Y, Z ) {

		const nodes = m.gltf.nodes, joints = m.skin.joints, head = new Set();
		const mark = ( i ) => { head.add( i ); for ( const c of nodes[ i ].children ) mark( c ); };
		const h = nodes.findIndex( ( n ) => n.name === 'Bip01 Head' );
		if ( h >= 0 ) mark( h ); // hat and hair ride the head: never stand on those
		const src = [], tris = [], p = new THREE.Vector3();
		m.group.updateWorldMatrix( true, false );
		this.m = m;
		for ( const mesh of m.meshes ) {

			const g = mesh.geometry, P = g.getAttribute( 'position' ).array, J = g.getAttribute( 'skinIndex' ).array, Wt = g.getAttribute( 'skinWeight' ).array;
			const I = g.getIndex() ? g.getIndex().array : null, n = P.length / 3;
			const ok = new Uint8Array( n ), slot = new Int32Array( n ).fill( - 1 );
			for ( let v = 0; v < n; v ++ ) {

				let hw = 0;
				for ( let k = 0; k < 4; k ++ ) if ( head.has( joints[ J[ v * 4 + k ] ] ) ) hw += Wt[ v * 4 + k ];
				if ( hw > 0.3 ) continue;
				this.skin( P, J, Wt, v, p ).sub( O );
				const lx = p.dot( X ), ly = p.dot( Y ), lz = p.dot( Z );
				ok[ v ] = lx > - 0.05 && lx < 0.24 && lz > - 0.11 && lz < 0.11 && ly > - 0.1 && ly < 0.18 ? 2 : 1;

			}

			const nt = I ? I.length / 3 : n / 3;
			for ( let t = 0; t < nt; t ++ ) {

				const a = I ? I[ t * 3 ] : t * 3, b = I ? I[ t * 3 + 1 ] : t * 3 + 1, c = I ? I[ t * 3 + 2 ] : t * 3 + 2;
				if ( ! ok[ a ] || ! ok[ b ] || ! ok[ c ] || ok[ a ] + ok[ b ] + ok[ c ] < 4 ) continue;
				for ( const v of [ a, b, c ] ) {

					if ( slot[ v ] < 0 ) { slot[ v ] = src.length; src.push( [ P, J, Wt, v ] ); }
					tris.push( slot[ v ] );

				}

			}

		}

		this.src = src; this.tris = Int32Array.from( tris ); this.w = new Float32Array( src.length * 3 );
		this.count = this.tris.length / 3;

	}

	// vertex v skinned with the avatar's current joint matrices, to world
	skin( P, J, Wt, v, out ) {

		const D = this.m.jointData, px = P[ v * 3 ], py = P[ v * 3 + 1 ], pz = P[ v * 3 + 2 ];
		let x = 0, y = 0, z = 0;
		for ( let k = 0; k < 4; k ++ ) {

			const w = Wt[ v * 4 + k ];
			if ( ! w ) continue;
			const o = J[ v * 4 + k ] * 16;
			x += w * ( D[ o ] * px + D[ o + 4 ] * py + D[ o + 8 ] * pz + D[ o + 12 ] );
			y += w * ( D[ o + 1 ] * px + D[ o + 5 ] * py + D[ o + 9 ] * pz + D[ o + 13 ] );
			z += w * ( D[ o + 2 ] * px + D[ o + 6 ] * py + D[ o + 10 ] * pz + D[ o + 14 ] );

		}

		return out.set( x, y, z ).applyMatrix4( this.m.group.matrixWorld );

	}

	// re-skin the patch in this frame's pose (after the avatar's update)
	update() {

		const p = _pp, w = this.w;
		for ( let i = 0; i < this.src.length; i ++ ) {

			const [ P, J, Wt, v ] = this.src[ i ];
			this.skin( P, J, Wt, v, p );
			w[ i * 3 ] = p.x; w[ i * 3 + 1 ] = p.y; w[ i * 3 + 2 ] = p.z;

		}

		// each triangle's bounding sphere (centre, radius²), so height() skips those its ray passes wide of
		const T = this.tris, B = this.bs || ( this.bs = new Float32Array( T.length / 3 * 4 ) );
		for ( let t = 0, k = 0; t < T.length; t += 3, k += 4 ) {

			const a = T[ t ] * 3, b = T[ t + 1 ] * 3, c = T[ t + 2 ] * 3;
			const cx = ( w[ a ] + w[ b ] + w[ c ] ) / 3, cy = ( w[ a + 1 ] + w[ b + 1 ] + w[ c + 1 ] ) / 3, cz = ( w[ a + 2 ] + w[ b + 2 ] + w[ c + 2 ] ) / 3;
			const ra = ( w[ a ] - cx ) ** 2 + ( w[ a + 1 ] - cy ) ** 2 + ( w[ a + 2 ] - cz ) ** 2;
			const rb = ( w[ b ] - cx ) ** 2 + ( w[ b + 1 ] - cy ) ** 2 + ( w[ b + 2 ] - cz ) ** 2;
			const rc = ( w[ c ] - cx ) ** 2 + ( w[ c + 1 ] - cy ) ** 2 + ( w[ c + 2 ] - cz ) ** 2;
			B[ k ] = cx; B[ k + 1 ] = cy; B[ k + 2 ] = cz; B[ k + 3 ] = Math.max( ra, rb, rc ) * 1.0001 + 1e-10;

		}

	}

	// height of the shirt above point q along unit axis u (negative: q is inside him); null off the patch
	height( q, u ) {

		const w = this.w, T = this.tris, B = this.bs, L = 0.3;
		const ox = q.x + u.x * L, oy = q.y + u.y * L, oz = q.z + u.z * L, dx = - u.x, dy = - u.y, dz = - u.z;
		let best = Infinity;
		for ( let t = 0; t < T.length; t += 3 ) {

			if ( B ) {

				// the ray's line misses the triangle's bounding sphere: it misses the triangle
				const k = t / 3 * 4, cx = B[ k ] - ox, cy = B[ k + 1 ] - oy, cz = B[ k + 2 ] - oz, along = cx * dx + cy * dy + cz * dz;
				if ( cx * cx + cy * cy + cz * cz - along * along > B[ k + 3 ] ) continue;

			}

			const a = T[ t ] * 3, b = T[ t + 1 ] * 3, c = T[ t + 2 ] * 3;
			const e1x = w[ b ] - w[ a ], e1y = w[ b + 1 ] - w[ a + 1 ], e1z = w[ b + 2 ] - w[ a + 2 ];
			const e2x = w[ c ] - w[ a ], e2y = w[ c + 1 ] - w[ a + 1 ], e2z = w[ c + 2 ] - w[ a + 2 ];
			const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
			const det = e1x * px + e1y * py + e1z * pz;
			if ( Math.abs( det ) < 1e-12 ) continue;
			const inv = 1 / det, sx = ox - w[ a ], sy = oy - w[ a + 1 ], sz = oz - w[ a + 2 ];
			const bu = ( sx * px + sy * py + sz * pz ) * inv;
			if ( bu < 0 || bu > 1 ) continue;
			const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
			const bv = ( dx * qx + dy * qy + dz * qz ) * inv;
			if ( bv < 0 || bu + bv > 1 ) continue;
			const d = ( e2x * qx + e2y * qy + e2z * qz ) * inv;
			if ( d > 0 && d < best ) best = d;

		}

		return best === Infinity ? null : L - best;

	}

}

const _pp = new THREE.Vector3(), _q = new THREE.Vector3();

export class Cockatoo {

	constructor( app, scene ) {

		this.app = app;
		const qs = new URLSearchParams( globalThis.location?.search || '' );
		this.off = qs.get( 'cockatoo' ) === 'off';
		this.fast = qs.get( 'cockatoo' ) === 'fast';
		this.rng = mulberry( 20260927 );
		this.group = new THREE.Group();
		this.group.name = 'Cockatoo';
		this.group.visible = false;
		scene.add( this.group );
		this.model = null;
		this.time = 0;
		this.mode = 'perched';    // perched (his shoulder) | flying | resting (a perch while exploring) | riding (in the car) | caged (at Joe's)
		this.cage = null; this.ca = null; this.cageAct = null; this.squawkTimes = []; this.passers = new Map(); this.passerCalls = 0; this.cageLog = [];
		this.pendingCage = loadCaged();
		this.goal = null;         // while flying: explore | return | circle | car
		this.pos = new THREE.Vector3(); // anchor, world: feet when perched, body when flying
		this.q = [ 0, 0, 0, 1 ];
		this.indoors = false; this.indoorT = 0; this.popT = 0; // a roof over his head (checked every 0.25 s)
		this.flyer = new Flyer( BIRD.GULL, 7, this.rng, FLIGHT.cockatoo );
		this.flightW = 0; this.flapW = 0; this.flareW = 0;
		this.spot = null; this.land = null; this.wp = new THREE.Vector3(); this.wpT = 0;
		this.headYaw = 0; this.headPitch = 0; this.lookYaw = 0; this.lookPitch = 0; this.lookT = 0;
		this.crest = 0; this.crestWant = 0; this.beak = 0; this.preen = 0; this.tilt = 0; this.tailFan = 0;
		this.bobT = 0; this.preenT = 0; this.rouseT = 0; this.stretchT = 0; this.shift = 0; this.shiftWant = 0; this.turn = 0; this.turnWant = 0;
		this.squawkT = 0; this.squawks = 0; this.lastSquawk = null;
		this.nextExplore = this.interval( 40, 120, 4, 7 );
		this.nextSquawk = this.interval( 15, 45, 3, 6 );
		this.nextIdle = 2; this.nextShuffle = 4;
		this.trip = null; this.maxDistance = 0; this.snaps = 0; this.dist = 0; this.shoulderDist = null; this.fwdDot = null;
		this._lastCatch = undefined;
		if ( ! this.off ) this.ready = this.load().catch( ( e ) => console.warn( 'Cockatoo: model failed to load', e ) );
		try { app.audio?._want?.( 'cockatoo' ); } catch ( e ) { /* audio not ready: the first squawk loads it */ }

	}

	interval( a, b, fa, fb ) {

		return this.fast ? fa + this.rng() * ( fb - fa ) : a + this.rng() * ( b - a );

	}

	async load() {

		const gltf = await fetchGLB( URL );
		if ( ! gltf || ! gltf.skins.length ) {

			console.warn( 'Cockatoo: no model at', URL );
			return;

		}

		// White plumage stays a warm, soft white: the scanned albedo is balanced a touch toward cream (a sulphur-crested
		// cockatoo's white is not blue-white) and the feathers get a soft sheen, so in blue sky shade (the ferry, the
		// verandas) he reads warm white like the painted rails beside him instead of blue-grey plastic
		const model = await SkinnedModel.create( gltf, { materials: ( info ) => /plumage|wing_/.test( info.name ) ? {
			surface: 's.albedo = s.albedo * vec3f( 1.03, 1.0, 0.9 ); s.sheenColor = vec3f( 0.3, 0.28, 0.24 ); s.sheenRoughness = 0.55;',
		} : null } );
		for ( const m of model.meshes ) m.name = 'cockatoo:' + m.name;
		const nodes = gltf.nodes;
		this.node = ( n ) => nodes.findIndex( ( x ) => x.name === n );
		this.bind = model.rest.map( ( r ) => Array.from( r.r ) );
		const still = ( name ) => {

			const out = new Map(), c = model.clips.get( name );
			if ( c ) for ( const ch of c.channels ) if ( ch.path === 'rotation' ) out.set( ch.node, Array.from( ch.values.slice( 0, 4 ) ) );
			return out;

		};
		this.P = { perch: still( 'perch' ), glide: still( 'glide' ), flare: still( 'flare' ) };
		const flap = model.clips.get( 'flap' );
		this.flapCh = new Map();
		if ( flap ) for ( const ch of flap.channels ) if ( ch.path === 'rotation' ) this.flapCh.set( ch.node, ch );
		this.flapDur = flap ? flap.duration : 1;
		// overlays: deltas against the perch pose, applied on top of whatever the base pose is
		this.O = {};
		for ( const name of [ 'crest', 'beak', 'look_l', 'look_r', 'look_up', 'look_down', 'tilt', 'preen', 'tailfan', 'stretch' ] ) {

			const d = new Map();
			for ( const [ i, q ] of still( name ) ) {

				const r = qmul( qinv( this.P.perch.get( i ) || this.bind[ i ] ), q, [ 0, 0, 0, 0 ] );
				if ( Math.abs( r[ 3 ] ) < 0.99995 ) d.set( i, r ); // only the bones the overlay moves

			}
			this.O[ name ] = d;

		}

		this.animNodes = [ ...new Set( [ ...this.P.perch.keys(), ...this.P.glide.keys(), ...this.flapCh.keys(), ...this.O.stretch.keys() ] ) ];
		this.footL = this.node( 'foot_L' ); this.footR = this.node( 'foot_R' ); this.rootN = this.node( 'root' ); this.headN = this.node( 'head' );
		// two wings: the open flight wing hangs off `upper_*`, the sourced folded wing off `shell_*` (tools/cockatoo/cockatoo_import.py)
		this.wingN = [ 'upper_L', 'upper_R' ].map( this.node ).filter( ( i ) => i >= 0 );
		this.shellN = [ 'shell_L', 'shell_R' ].map( this.node ).filter( ( i ) => i >= 0 );
		this.wingScale = 1; this.shellScale = 1;
		model.layers = [];
		this.model = model;
		this.group.add( model.group );
		this._q = [ 0, 0, 0, 1 ]; this._t = [ 0, 0, 0, 1 ]; this._s = new Float32Array( 4 );
		this.snapToShoulder();

	}

	// ------------------------------------------------------------------ the player

	playerWorld( out ) {

		const app = this.app, p = app.player;
		if ( app.rally?.active && app.rally.model ) return out.copy( app.rally.model.root.position );
		if ( p.mode === 'ferry' && app.ferry?.deck ) return app.ferry.ship.toWorld( app.ferry.deck.local, out );
		if ( p.mode === 'deck' && p.boat ) return p.boat.toWorld( p.deckPos, out );
		return out.copy( p.position );

	}

	// the perch on his left shoulder (world) and the bird's orientation there; null without bones
	shoulder( out ) {

		const av = this.app.player.avatar, m = av && av.model;
		if ( ! m || ! av.visible ) return null;
		if ( ! this.sh || this.sh.model !== m ) {

			const f = ( n ) => m.gltf.nodes.findIndex( ( x ) => x.name === n );
			this.sh = { model: m, clav: f( SHOULDER.clav ), upper: f( SHOULDER.upper ), spine: f( SHOULDER.spine ), neck: f( SHOULDER.neck ), rclav: f( SHOULDER.rclav ) };

		}

		const s = this.sh;
		if ( s.clav < 0 || s.upper < 0 || s.spine < 0 || s.neck < 0 ) return null;
		m.group.updateWorldMatrix( true, false ); // his placement this frame (the scene graph only refreshes at render)
		const W = m.world, M = m.group.matrixWorld;
		const at = ( i, v ) => v.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] ).applyMatrix4( M );
		const clav = at( s.clav, _a ), upper = at( s.upper, _b );
		const neck = at( s.neck, _c ), spine = at( s.spine, _d );
		_Y.subVectors( neck, spine ).normalize().lerp( _X.set( 0, 1, 0 ), 0.5 ).normalize(); // up: his torso, steadied toward world up
		const rc = s.rclav >= 0 ? at( s.rclav, _Z ) : null;
		_X.subVectors( upper, rc || spine ).normalize();                                   // his left
		_Z.crossVectors( _X, _Y ).normalize();                                             // his forward
		_X.crossVectors( _Y, _Z ).normalize();
		const P = this.app.player, js = P.mode === 'jetski' ? this.app.jetskis : null; // riding: the ski's own camera decides
		const first = js ? js.camMode === 'hood' : P.view !== 'third';
		this.shoulderBone = this.shoulderBone || new THREE.Vector3();
		this.shoulderBone.copy( upper );
		this.up = this.up || new THREE.Vector3();
		this.up.copy( _Y );
		// third person: its feet on the shirt over the trapezius, measured on his skinned mesh this frame
		if ( ! first ) {

			if ( ! s.patch ) s.patch = new ShoulderPatch( m, clav, _X, _Y, _Z );
			s.patch.update();
			_q.copy( clav ).addScaledVector( _X, PERCH.x ).addScaledVector( _Z, PERCH.z );
			const h = s.patch.count ? s.patch.height( _q, _Y ) : null;
			if ( h !== null ) {

				out.copy( _q ).addScaledVector( _Y, h );
				// lean a touch in toward his head (a roll about his forward axis)
				const c = Math.cos( PERCH.lean ), n = Math.sin( PERCH.lean );
				_q.copy( _X ).multiplyScalar( c ).addScaledVector( _Y, n );
				_Y.multiplyScalar( c ).addScaledVector( _X, - n );
				_X.copy( _q );
				if ( js ) {

					// riding, he leans forward over the bars; the bird balances upright on the shoulder instead of pitching
					// with him (its head and crest stay clear of his): only that forward lean, a pitch about his left axis, is
					// cancelled, the sideways roll is kept
					_q.set( 0, 1, 0 ).addScaledVector( _X, - _X.y ).normalize();
					_Y.copy( _q ); _Z.crossVectors( _X, _Y ).normalize();

				}
				this.onSkin = true;
				return qbasis( _X, _Y, _Z );

			}

		}

		this.onSkin = false;
		out.lerpVectors( clav, upper, 0.92 ).addScaledVector( _X, 0.015 ).addScaledVector( _Y, 0.07 ).addScaledVector( _Z, - 0.015 );
		// first person: further out and back, so it never blocks the view (it peeks in when he looks left)
		if ( first ) out.addScaledVector( _X, 0.11 ).addScaledVector( _Z, - 0.16 );
		return qbasis( _X, _Y, _Z );

	}

	snapToShoulder() {

		const q = this.shoulder( this.pos );
		if ( ! q ) this.playerWorld( this.pos ).y += 1.5;
		this.mode = 'perched'; this.goal = null; this.land = null; this.spot = null; this.flightW = 0; this.flareW = 0;
		this.snapped = true;

	}

	// ------------------------------------------------------------------ events

	squawk( reason = 'random' ) {

		this.squawkT = 1.3;
		this.squawks ++;
		this.squawkTimes.push( this.time );
		if ( this.squawkTimes.length > 8 ) this.squawkTimes.shift();
		this.lastSquawk = { t: + this.time.toFixed( 2 ), reason, crestPeak: + this.crest.toFixed( 2 ), mode: this.mode };
		this.nextSquawk = this.interval( 15, 45, 3, 6 );
		const a = this.app.audio;
		if ( a && a.squawk ) a.squawk( this.pos );

	}

	whistle() {

		this.whistled = this.time;
		const au = this.app.audio;
		if ( au && au.whistle ) au.whistle( this.app.player && this.app.player.position );
		if ( this.mode === 'perched' ) {

			this.bobT = 1.2;
			return;

		}

		if ( this.mode === 'riding' ) return;
		// in the cage he answers back and stays put
		if ( this.mode === 'caged' ) { this.squawk( 'reply' ); this.bobT = 1; this.lookYaw = 0; this.lookT = 1.5; return; }
		if ( this.mode === 'resting' ) this.takeOff( 'return', false );
		else { this.goal = 'return'; this.land = null; }

	}

	takeOff( goal, loud = true ) {

		const fwd = rotv( this.q, _a.set( 0, 0, 1 ), _b ), f = this.flyer, c = this.app.camera.position;
		let yaw = Math.atan2( fwd.x, fwd.z );
		// off his shoulder right by the lens (first person): away from it, not across it
		const ax = this.pos.x - c.x, az = this.pos.z - c.z;
		if ( ! this.app.freeCam && Math.hypot( ax, this.pos.y - c.y, az ) < CAM_SOFT && Math.hypot( ax, az ) > 1e-3 ) yaw = Math.atan2( ax, az );
		f.place( this.pos.x, this.pos.y + 0.1, this.pos.z, yaw );
		f.speed = 4.5; f.vy = 1.5; f.flap = 1; f.flapWant = 1.25;
		this.mode = 'flying'; this.goal = goal; this.spot = null; this.land = null;
		this.takeoffT = 0.9; this.wpT = 0;
		if ( goal === 'explore' ) this.trip = { start: + this.time.toFixed( 2 ), maxDistance: 0, landedAway: 0, back: null };
		this.exploreLeft = this.interval( 30, 60, 10, 14 );
		this.hops = 1 + Math.floor( this.rng() * 2 );
		if ( loud ) this.squawk( 'takeoff' );

	}

	// ------------------------------------------------------------------ perches while exploring

	pickSpot( player ) {

		const app = this.app, c = [], rng = this.rng;
		const push = ( w, spot ) => {

			const p = spot.local ? app.ferry.ship.toWorld( spot.local, _c ) : spot.pos;
			const d = Math.hypot( p.x - player.x, p.z - player.z );
			if ( d > 5 && d < SOFT - 2 && Math.abs( p.y - player.y ) < 8 ) c.push( { w, spot } );

		};

		if ( app.player.mode === 'ferry' && app.ferry?.deck ) {

			const me = app.ferry.deck.local;
			for ( const b of app.ferry.deck.boxes ) {

				const top = b.center.y + b.half.y;
				if ( Math.min( b.half.x, b.half.z ) < 0.3 && top > me.y - 0.5 && top < me.y + 3 ) push( 3, { local: new THREE.Vector3( b.center.x, top, b.center.z ) } );

			}

		} else {

			const perches = app.wildlife?.birds?.perches || [];
			for ( const p of perches ) if ( ! p.bird && p.kind !== 'boat' ) push( 3, { pos: new THREE.Vector3( p.x, p.y, p.z ) } );
			for ( let k = 0; k < 6; k ++ ) {

				const a = rng() * Math.PI * 2, r = 6 + rng() * 8, x = player.x + Math.sin( a ) * r, z = player.z + Math.cos( a ) * r;
				const y = Math.max( app.terrainData.heightAt( x, z ), app.colliders ? app.colliders.groundHeightAt( x, z, player.y + 4 ) : - Infinity );
				if ( y > 0.25 ) push( 0.6, { pos: new THREE.Vector3( x, y, z ), ground: true } );

			}

		}

		if ( ! c.length ) return null;
		let sum = 0;
		for ( const e of c ) sum += e.w;
		let r = rng() * sum;
		for ( const e of c ) if ( ( r -= e.w ) <= 0 ) return e.spot;
		return c[ c.length - 1 ].spot;

	}

	spotWorld( spot, out ) {

		if ( spot.cage ) return this.cage.toWorld( CAGE.outside, out );
		return spot.local ? this.app.ferry.ship.toWorld( spot.local, out ) : out.copy( spot.pos );

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		if ( ! this.model || dt <= 0 ) return;
		dt = Math.min( dt, 0.1 );
		const cage = this.app.game?.stand?.cage;
		if ( cage ) cage.update( dt, this.app );
		if ( this.pendingCage && cage?.loaded ) { this.pendingCage = false; this.cage = cage; this.mode = 'caged'; this.goal = null; this.enterAt( 'perch' ); }
		const app = this.app, p = app.player, rng = this.rng;
		this.time += dt;
		const player = this.playerWorld( _pw );

		if ( app.input && app.input.hit( 'KeyB' ) && ! app.freeCam ) this.whistle();
		const lc = app.game?.state?.lastCatch;
		if ( this._lastCatch !== undefined && lc && lc !== this._lastCatch ) this.squawk( 'catch' );
		this._lastCatch = lc || null;

		// a ragdoll tumble (src/player/Ragdoll.js, also the car yeet): he takes off squawking and circles
		// until the player is back on his feet, then lands on the shoulder again
		const tumbling = p.mode === 'ragdoll';
		const inCar = !! ( app.rally?.active || ( app.rally?.bailout?.active && ! tumbling ) );
		// on a jetski he stays on the shoulder (the rider is out in the open); thrown off, he circles
		const onSki = p.mode === 'jetski', thrown = p.mode === 'jetski-thrown';
		const riding = inCar || ( ! ON_FOOT.has( p.mode ) && ! onSki && ! thrown && ! tumbling );
		const swim = p.mode === 'swim' || thrown || tumbling;
		const ski = onSki ? app.jetskis?.ctl : null;
		// the wind at speed presses his crest flat (0 below about 45 km/h, 1 by about 80)
		this.wind = ski ? THREE.MathUtils.smoothstep( ski.speed || 0, 12, 22 ) : 0;
		// big air: one excited call per jump
		if ( ski?.airborne && ! ski.boosting && ( ski.airTime || 0 ) > 0.35 && ! this._skiAirCalled ) // (the burn has its own, rarer call) { this._skiAirCalled = true; this.squawk( 'air' ); }
		if ( ! ski?.airborne ) this._skiAirCalled = false;
		// the rocket: he clings on, crest flat and feathers pressed (this.boost, in the overlays); a squawk as it
		// lights and now and then during the burn (at most one every 2.5 s, about one in a 6 s burn)
		this.boost = ski ? ski.boostLevel || 0 : 0;
		if ( ski?.boosting && ! this._skiLit ) this.squawk( 'rocket' );
		else if ( ski?.boosting && this.squawkT <= 0 && this.time - ( this.lastSquawk?.t ?? - 99 ) > 2.5 && this.rng() < dt * 0.25 ) this.squawk( 'rocket-burn' );
		this._skiLit = !! ski?.boosting;

		// in the car (or at a helm): it flies to him and rides along out of sight
		if ( riding && this.mode !== 'riding' && this.mode !== 'caged' && this.goal !== 'car' ) {

			if ( this.mode === 'flying' ) this.goal = 'car';
			else this.takeOff( 'car', false );

		}

		if ( ! riding && this.mode === 'riding' ) {

			this.snapToShoulder();
			this.squawk( 'hello' );

		}

		if ( swim && ( this.mode === 'perched' || this.mode === 'resting' ) ) this.takeOff( 'circle' );

		// indoors (a deck or roof over his head: the ferry's saloon, a roof on the island) it stays on his
		// shoulder: no exploring, and a bird still out pops back to him (a quick shrink and grow) instead of
		// flying in through the walls and past the lens
		if ( ( this.indoorT -= dt ) <= 0 ) { this.indoorT = 0.25; this.indoors = ! swim && ! riding && this.roofed( player ); }
		if ( this.indoors && this.mode !== 'perched' && this.mode !== 'riding' && this.mode !== 'caged' && this.goal !== 'cage' && this.popT <= 0 ) this.popT = POP;
		if ( this.popT > 0 ) {

			const was = this.popT;
			this.popT = Math.max( 0, this.popT - dt );
			if ( was > POP / 2 && this.popT <= POP / 2 && this.mode !== 'perched' && this.mode !== 'riding' ) this.snapToShoulder();

		}

		// hard leash: after a teleport (free camera, respawn) it is simply with him again
		const far = this.pos.distanceTo( player );
		if ( far > HARD + 20 && this.mode !== 'riding' && this.mode !== 'caged' && this.goal !== 'cage' ) {

			this.snaps ++;
			if ( swim ) {

				this.takeOff( 'circle', false );
				this.flyer.place( player.x, player.y + 6, player.z, 0 );

			} else this.snapToShoulder();

		}

		// random calls, the crest and beak with each one
		this.nextSquawk -= dt;
		if ( this.nextSquawk <= 0 && this.mode !== 'riding' ) this.squawk( 'random' );
		this.squawkT = Math.max( 0, this.squawkT - dt );

		let shoulderQ = null;
		if ( this.mode === 'perched' ) shoulderQ = this.perched( dt, player );
		else if ( this.mode === 'resting' ) this.resting( dt, player );
		else if ( this.mode === 'flying' ) this.flying( dt, player, swim, inCar );
		else if ( this.mode === 'caged' ) this.caged( dt, player );
		else if ( this.mode === 'riding' ) {

			this.pos.copy( player ).y += 1;

		}

		this.idle( dt );
		this.pose( dt );
		this.place( dt, shoulderQ );

		this.dist = Math.hypot( this.pos.x - player.x, this.pos.y - ( player.y + 1.2 ), this.pos.z - player.z );
		if ( this.snapped ) this.snapped = false;
		else if ( this.mode !== 'riding' && this.mode !== 'caged' && this.goal !== 'cage' ) this.maxDistance = Math.max( this.maxDistance, this.dist );
		if ( this.trip ) this.trip.maxDistance = Math.max( this.trip.maxDistance, this.dist );
		if ( this.lastSquawk && this.squawkT > 0 ) this.lastSquawk.crestPeak = + Math.max( this.lastSquawk.crestPeak, this.crest ).toFixed( 2 );

	}

	perched( dt, player ) {

		const q = this.shoulder( this.pos );
		if ( ! q ) this.pos.copy( player ).y += 1.5;
		// no exploring off a moving jetski: he holds on
		if ( this.app.player.mode === 'jetski' ) this.nextExplore = Math.max( this.nextExplore, 8 );
		// nor indoors
		if ( this.indoors ) this.nextExplore = Math.max( this.nextExplore, 3 );
		this.nextExplore -= dt;
		if ( this.nextExplore <= 0 && this.flightW < 0.05 ) {

			this.nextExplore = this.interval( 40, 120, 4, 7 );
			this.takeOff( 'explore' );
			return null;

		}

		return q;

	}

	resting( dt, player ) {

		this.spotWorld( this.spot, this.pos );
		this.restT -= dt;
		const d = Math.hypot( this.pos.x - player.x, this.pos.z - player.z );
		// he is walking off: leave early, so a sprinting player never gets near the hard leash
		const pv = this.app.player.velocity, running = pv ? Math.hypot( pv.x, pv.z ) > 2.5 : false;
		if ( d > SOFT - 6 || ( running && d > 8 ) ) this.takeOff( 'return' );
		else if ( this.restT <= 0 ) {

			this.takeOff( this.hops > 0 && this.exploreLeft > 0 ? 'explore' : 'return', this.rng() < 0.6 );
			if ( this.goal === 'explore' ) this.hops --;

		}

	}

	flying( dt, player, swim, inCar ) {

		const f = this.flyer, app = this.app, rng = this.rng;
		this.exploreLeft -= dt;
		this.takeoffT = Math.max( 0, this.takeoffT - dt );
		const dPlayer = Math.hypot( f.x - player.x, f.z - player.z );
		const pv = app.player.velocity, running = pv ? Math.hypot( pv.x, pv.z ) > 2.5 : false;
		if ( this.goal === 'explore' && ( this.exploreLeft <= 0 || dPlayer > SOFT - 4 || ( running && dPlayer > 8 ) ) ) { this.goal = 'return'; this.land = null; }
		if ( this.goal === 'circle' && ! swim ) this.goal = 'return';

		if ( this.land ) return this.landing( dt, player );

		let tx, ty, tz, speed = FLIGHT.cockatoo.speed, power = this.takeoffT > 0 ? 2 : 1, gain = 1.4;
		if ( this.goal === 'explore' ) {

			this.wpT -= dt;
			if ( this.wpT <= 0 || Math.hypot( this.wp.x - f.x, this.wp.z - f.z ) < 3 ) {

				// out to somewhere within the soft leash, now and then down onto a perch
				if ( this.wpT !== 0 && rng() < 0.55 && ( this.spot = this.pickSpot( player ) ) ) {

					this.startLanding( 'spot' );
					return this.landing( dt, player );

				}

				const a = rng() * Math.PI * 2, r = 6 + rng() * 7;
				this.wp.set( player.x + Math.sin( a ) * r, 0, player.z + Math.cos( a ) * r );
				this.wp.y = Math.max( this.groundY( this.wp.x, this.wp.z ), player.y ) + 3 + rng() * 6;
				this.wpT = 3 + rng() * 4;

			}

			tx = this.wp.x; ty = this.wp.y; tz = this.wp.z;

		} else if ( this.goal === 'circle' ) {

			const a = this.time * 0.9;
			tx = player.x + Math.sin( a ) * 6; tz = player.z + Math.cos( a ) * 6; ty = player.y + 6.5; speed = 8.5; gain = 2;

		} else {

			// return (and the car): straight to him, faster the further it is
			tx = player.x; tz = player.z; ty = player.y + 2.5;
			speed = clamp( 8 + dPlayer * 0.25, 8, 13 );
			if ( dPlayer < 9 && this.goal === 'return' ) {

				this.startLanding( 'shoulder' );
				return this.landing( dt, player );

			}

			if ( this.goal === 'car' && Math.hypot( f.x - player.x, f.y - player.y - 1, f.z - player.z ) < 2.5 ) {

				this.mode = 'riding'; this.goal = null; this.group.visible = false; this.flightW = 0;
				return;

			}

		}

		// never beyond the hard leash: pull the target in, and fly back hard near the limit
		if ( dPlayer > SOFT - 4 ) { tx = player.x; tz = player.z; speed = clamp( 12 + ( dPlayer - SOFT + 4 ) * 0.6, 12, 16 ); gain = 3; }
		ty = Math.max( ty, this.groundY( f.x, f.z ) + 1.5 );
		// near the lens (first person, or the boom pulled in): aim off it, harder the nearer it is
		if ( ! app.freeCam ) {

			const c = app.camera.position, dx = f.x - c.x, dy = f.y - c.y, dz = f.z - c.z, d = Math.hypot( dx, dy, dz );
			if ( d < CAM_SOFT && d > 1e-4 ) {

				const w = clamp( ( CAM_SOFT - d ) / ( CAM_SOFT - CAM_HARD ), 0, 1 ), k = 4 / d;
				tx += ( f.x + dx * k - tx ) * w; ty += ( f.y + Math.max( dy, 0.3 * d ) * k - ty ) * w; tz += ( f.z + dz * k - tz ) * w;
				gain = Math.max( gain, 1.4 + 1.6 * w );

			}

		}
		f.steer( dt, tx, ty, tz, speed, power, gain, null );
		if ( f.y < this.groundY( f.x, f.z ) + 0.6 ) { f.y = this.groundY( f.x, f.z ) + 0.6; f.vy = Math.max( f.vy, 0 ); }
		this.clearCamera( f );
		f.legs = toward( f.legs, 0, 3, dt ); f.flare = toward( f.flare, 0, 3, dt );
		f.animate( dt );
		this.pos.set( f.x, f.y, f.z );
		this.flyQ();

	}

	groundY( x, z ) { return Math.max( 0, this.app.terrainData.heightAt( x, z ) ); }

	// never through the lens: in flight it is never nearer the camera than CAM_HARD (after the first moment
	// of a launch off his shoulder, which takeOff aims away from the camera)
	clearCamera( f ) {

		const app = this.app;
		if ( app.freeCam || this.takeoffT > 0.75 ) return; // (the first 0.15 s of a launch off his shoulder)
		const c = app.camera.position, dx = f.x - c.x, dy = f.y - c.y, dz = f.z - c.z, d = Math.hypot( dx, dy, dz );
		if ( d >= CAM_HARD || d < 1e-4 ) return;
		const s = CAM_HARD / d;
		f.x = c.x + dx * s; f.y = c.y + dy * s; f.z = c.z + dz * s;

	}

	// a deck or roof within 8 m over his head (the ferry's own boxes aboard her, the island's colliders ashore)
	roofed( player ) {

		const app = this.app, p = app.player, head = _rf.copy( player );
		head.y += 1.6;
		if ( p.mode === 'ferry' && app.ferry?.deck ) {

			const deck = app.ferry.deck;
			return deck.boomHit ? deck.boomHit( head, _UP, 8 ) < 8 : !! deck.openSky && ! deck.openSky( p );

		}

		if ( p.mode === 'deck' || p.mode === 'boat' ) return false; // the fishing boat is open to the sky
		const C = app.colliders;
		return !! C?.raycast && C.raycast( head, _UP, 8 ) < 8;

	}

	startLanding( kind ) {

		const f = this.flyer;
		this.land = { kind, t: 0, p0: new THREE.Vector3( f.x, f.y, f.z ), v0: new THREE.Vector3( f.vx, f.vy, f.vz ), T: 0 };
		const end = kind === 'shoulder' ? ( this.shoulder( _c ) ? _c : this.playerWorld( _c ).add( _a.set( 0, 1.5, 0 ) ) ) : this.spotWorld( this.spot, _c );
		this.land.T = clamp( this.land.p0.distanceTo( end ) / 5.5, 0.9, 2.2 );

	}

	// the final approach: a braking curve to the perch, legs down, flare, fast short beats; the end
	// point follows a moving target (his shoulder as he walks, a rail on the moving ferry)
	landing( dt, player ) {

		const L = this.land, f = this.flyer;
		L.t += dt;
		let u = clamp( L.t / L.T, 0, 1 );
		let q = null;
		const end = L.kind === 'shoulder' ? ( ( q = this.shoulder( _c ) ) ? _c : this.playerWorld( _c ).add( _a.set( 0, 1.5, 0 ) ) ) : this.spotWorld( this.spot, _c );
		const T = L.T, u2 = u * u, u3 = u2 * u;
		const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = - 2 * u3 + 3 * u2, h11 = u3 - u2;
		const vEnd = _b.set( 0, - 0.4, 0 );
		let nx = h00 * L.p0.x + h10 * T * L.v0.x + h01 * end.x + h11 * T * vEnd.x;
		let ny = h00 * L.p0.y + h10 * T * L.v0.y + h01 * ( end.y + 0.02 ) + h11 * T * vEnd.y;
		let nz = h00 * L.p0.z + h10 * T * L.v0.z + h01 * end.z + h11 * T * vEnd.z;
		// the last of the way onto his shoulder would pass through the lens (first person, or the boom pulled in): it is there
		const lens = this.app.camera.position;
		if ( L.kind === 'shoulder' && u < 1 && ! this.app.freeCam && Math.hypot( nx - lens.x, ny - lens.y, nz - lens.z ) < CAM_HARD ) { u = 1; nx = end.x; ny = end.y + 0.02; nz = end.z; }
		else if ( ! this.app.freeCam ) {

			// down onto a perch from beside him (just off the shoulder): round the lens, not through it
			const dx = nx - lens.x, dy = ny - lens.y, dz = nz - lens.z, d = Math.hypot( dx, dy, dz );
			if ( d < CAM_HARD && d > 1e-4 ) { const k = CAM_HARD / d; nx = lens.x + dx * k; ny = lens.y + dy * k; nz = lens.z + dz * k; }

		}
		const vx = ( nx - f.x ) / dt, vz = ( nz - f.z ) / dt, vy = ( ny - f.y ) / dt;
		const hs = Math.hypot( vx, vz );
		if ( hs > 0.6 && u < 0.85 ) f.yaw = toward( f.yaw, f.yaw + Math.atan2( Math.sin( Math.atan2( vx, vz ) - f.yaw ), Math.cos( Math.atan2( vx, vz ) - f.yaw ) ), 8, dt );
		f.x = nx; f.y = ny; f.z = nz; f.vx = vx; f.vy = vy; f.vz = vz;
		f.speed = Math.max( hs, 1 ); f.gamma = Math.atan2( vy, Math.max( hs, 0.5 ) ) * 0.5; f.bank = toward( f.bank, 0, 4, dt );
		f.flare = sstep( 0.35, 0.85, u ); f.legs = sstep( 0.15, 0.6, u );
		f.flapWant = u > 0.45 ? 1.2 : 0.8; f.hover = sstep( 0.5, 0.95, u );
		f.animate( dt );
		this.pos.set( nx, ny, nz );
		this.flyQ();
		if ( u >= 1 ) {

			this.land = null;
			this.pos.copy( end );
			if ( L.kind === 'cage' ) {

				// on the threshold: in through the door onto the perch
				this.mode = 'caged'; this.goal = null; this.spot = null;
				this.enterAt( 'door' );
				this.cageAct.entering = true;
				this.hopTo( 'perch', 0.55 );
				this.cageAct.then = () => { this.cage.close(); this.cageLog.push( 'in' ); };

			} else if ( L.kind === 'shoulder' ) {

				this.mode = 'perched'; this.goal = null;
				this.nextExplore = this.interval( 40, 120, 4, 7 );
				if ( this.trip ) this.trip.back = + this.time.toFixed( 2 );
				if ( this.hello ) { this.hello = false; this.squawk( 'hello' ); } else if ( this.rng() < 0.7 ) this.squawk( 'landing' );

			} else {

				this.mode = 'resting'; this.goal = null;
				this.restT = this.interval( 6, 20, 2, 3 );
				if ( this.trip ) this.trip.landedAway ++;
				this.restYaw = Math.atan2( player.x - end.x, player.z - end.z ) + ( this.rng() - 0.5 ) * 1.2 - ( this.spot.local ? this.app.ferry.ship.yaw : 0 );

			}

		}

	}

	flyQ() {

		const f = this.flyer;
		const qy = qaxis( 0, 1, 0, f.yaw, _qa ), qp = qaxis( 1, 0, 0, - f.pitch, _qb ), qr = qaxis( 0, 0, 1, - f.bank, _qc );
		qmul( qmul( qy, qp, this._t ), qr, this.q );

	}

	// perched behaviour: head looks (quick parrot saccades), bobbing, preening, shuffles, a rouse
	idle( dt ) {

		const rng = this.rng, still = this.mode === 'perched' || this.mode === 'resting' || ( this.mode === 'caged' && ! this.ca?.hop );
		this.lookT -= dt; this.nextIdle -= dt; this.nextShuffle -= dt;
		if ( this.lookT <= 0 ) {

			this.lookT = 0.6 + rng() * 2.8;
			this.lookYaw = still ? ( rng() - 0.5 ) * 2.2 : ( rng() - 0.5 ) * 0.6;
			this.lookPitch = ( rng() - 0.55 ) * 1.1;
			this.tiltWant = rng() < 0.25 ? ( rng() < 0.5 ? - 1 : 1 ) * ( 0.4 + rng() * 0.6 ) : 0;

		}

		if ( still && this.nextIdle <= 0 ) {

			const r = rng();
			if ( r < 0.3 ) this.preenT = 2 + rng() * 2.5;
			else if ( r < 0.55 ) this.bobT = 1.5 + rng() * 2.5;
			else if ( r < 0.7 ) this.rouseT = 0.7;
			else if ( r < 0.82 ) this.stretchT = 1.1;
			else this.crestWant = 0.35 + rng() * 0.3;
			this.nextIdle = this.fast ? 1.5 + rng() * 3 : 5 + rng() * 12;

		}

		if ( still && this.nextShuffle <= 0 ) {

			this.shiftWant = ( rng() - 0.5 ) * 0.05;
			this.turnWant = ( rng() - 0.5 ) * 0.7;
			this.nextShuffle = 3 + rng() * 8;

		}

		if ( ! still ) { this.preenT = 0; this.bobT = 0; this.stretchT = 0; }
		this.preenT = Math.max( 0, this.preenT - dt ); this.bobT = Math.max( 0, this.bobT - dt );
		this.rouseT = Math.max( 0, this.rouseT - dt ); this.stretchT = Math.max( 0, this.stretchT - dt );
		if ( this.crestWant > 0 && rng() < dt * 0.4 ) this.crestWant = 0;

		this.headYaw = toward( this.headYaw, this.preenT > 0 ? 0 : this.lookYaw, 14, dt );
		this.headPitch = toward( this.headPitch, this.lookPitch + ( this.bobT > 0 ? Math.sin( this.time * 14 ) * 0.5 : 0 ), this.bobT > 0 ? 30 : 14, dt );
		this.tilt = toward( this.tilt, this.tiltWant || 0, 6, dt );
		this.preen = toward( this.preen, this.preenT > 0 ? 1 : 0, 4, dt );
		const sq = this.squawkT > 0;
		const wind = this.mode === 'perched' ? this.wind || 0 : 0, boost = this.mode === 'perched' ? this.boost || 0 : 0;
		const sulk = this.mode === 'caged' && this.cageAct?.kind === 'sulk';
		this.crest = toward( this.crest, sulk ? 0 : ( sq ? 1 : Math.max( this.crestWant || 0, this.rouseT > 0 ? 0.5 : 0 ) ) * ( 1 - 0.8 * wind ) * ( 1 - 0.95 * boost ) * ( this.ca?.crestCap ?? 1 ), sq ? 12 : 3 + 6 * wind + 10 * boost, dt );
		this.beakT = Math.max( 0, ( this.beakT || 0 ) - dt ); // a grab or a knock with the beak (in the cage)
		const open = sq && this.squawkT > 0.45 ? 0.55 + 0.45 * Math.abs( Math.sin( this.time * 17 ) ) : this.beakT > 0 ? 0.45 : 0;
		this.beak = toward( this.beak, open, 25, dt );
		this.tailFan = toward( this.tailFan, ( ( this.rouseT > 0 ? 0.8 : 0 ) + this.flyer.flare * 0.9 + Math.abs( this.flyer.bank ) * 0.5 * this.flightW ) * ( 1 - boost ), 6 + 10 * boost, dt ); // pressed shut in the rocket's wind
		if ( boost > 0.05 ) { this.headPitch = toward( this.headPitch, 0.35 * boost, 8, dt ); this.preen = 0; } // head down into it, no preening
		this.shift = toward( this.shift, this.shiftWant, 5, dt );
		this.turn = toward( this.turn, this.turnWant, 3, dt );

	}

	pose( dt ) {

		const m = this.model, f = this.flyer;
		const flying = this.mode === 'flying';
		const want = flying ? 1 : 0; // the perched stretch lifts the folded shells (the `stretch` overlay), never the flight wing
		const sw = ! flying && this.stretchT > 0 ? Math.sin( Math.PI * this.stretchT / 1.1 ) : 0;
		this.flightW = toward( this.flightW, want, flying ? 9 : 5, dt );
		this.flapW = flying ? clamp( f.flap, 0, 1 ) : 0;
		this.flareW = flying ? f.flare : 0;
		const W = this.flightW, t = ( ( f.phase / ( Math.PI * 2 ) ) % 1 + 1 ) % 1 * this.flapDur;
		const ov = [
			[ 'crest', this.crest ], [ 'beak', this.beak ], [ 'preen', this.preen * ( 1 - W ) ], [ 'tailfan', Math.max( this.tailFan, 0.6 * sw ) ], [ 'stretch', sw ],
			[ 'look_l', clamp( this.headYaw, 0, 1 ) ], [ 'look_r', clamp( - this.headYaw, 0, 1 ) ],
			[ 'look_up', clamp( - this.headPitch, 0, 1 ) + ( this.squawkT > 0.4 ? 0.35 : 0 ) ], [ 'look_down', clamp( this.headPitch, 0, 1 ) ],
			[ 'tilt', Math.abs( this.tilt ) ],
		];
		const q = this._q, tmp = this._t, s = this._s;
		for ( const i of this.animNodes ) {

			const bind = this.bind[ i ];
			q[ 0 ] = bind[ 0 ]; q[ 1 ] = bind[ 1 ]; q[ 2 ] = bind[ 2 ]; q[ 3 ] = bind[ 3 ];
			const pp = this.P.perch.get( i ); if ( pp ) qnlerp( q, pp, 1, q );
			if ( W > 0.001 ) qnlerp( q, this.P.glide.get( i ) || bind, W, q );
			const ch = this.flapCh.get( i );
			if ( ch && this.flapW * W > 0.001 ) {

				sampleRot( ch, t, s );
				qnlerp( q, s, this.flapW * W, q );

			}

			const fl = this.P.flare.get( i );
			if ( fl && this.flareW * W > 0.001 ) qnlerp( q, fl, this.flareW * W, q );
			for ( const [ name, w ] of ov ) {

				if ( w <= 0.001 ) continue;
				const d = this.O[ name ].get( i );
				if ( ! d ) continue;
				const r = name === 'tilt' && this.tilt < 0 ? ( _qt[ 0 ] = - d[ 0 ], _qt[ 1 ] = d[ 1 ], _qt[ 2 ] = - d[ 2 ], _qt[ 3 ] = d[ 3 ], _qt ) : d;
				qnlerp( _QI, r, Math.min( w, 1.2 ), tmp );
				qmul( q, tmp, q );

			}

			m.rest[ i ].r.set( q );

		}

		// each wing is shown only in the pose it was modelled for: the folded shell while perched, the open wing in
		// flight. They cross over as the wings open, the shell tucking into the body as the open wing unfolds from it.
		if ( this.shellN?.length ) {

			this.wingScale = Math.max( 1e-3, sstep( 0.02, 0.12, W ) ); this.shellScale = Math.max( 1e-3, 1 - sstep( 0.06, 0.16, W ) );
			for ( const i of this.wingN ) m.rest[ i ].s.fill( this.wingScale );
			for ( const i of this.shellN ) m.rest[ i ].s.fill( this.shellScale );

		}

		m.update( this.snapped ? 0 : dt );

	}

	// put the model in the world: its feet on the anchor when perched, its body in flight
	place( dt, shoulderQ ) {

		const m = this.model, W = m.world;
		let q;
		if ( this.mode === 'perched' && shoulderQ ) q = shoulderQ;
		else if ( this.mode === 'caged' ) q = this.cageQ();
		else if ( this.mode === 'perched' || this.mode === 'resting' ) {

			const yaw = this.mode === 'resting' ? this.restYaw + ( this.spot?.local ? this.app.ferry.ship.yaw : 0 ) : this.app.player.yaw + Math.PI;
			q = qaxis( 0, 1, 0, yaw, _qd );

		} else q = this.q;
		if ( this.mode !== 'flying' && this.mode !== 'riding' ) {

			// body turn, sidestep and a quick rouse on the perch
			const rouse = this.rouseT > 0 ? Math.sin( this.time * 70 ) * 0.09 * Math.sin( Math.PI * this.rouseT / 0.7 ) : 0;
			q = qmul( q, qmul( qaxis( 0, 1, 0, this.turn, _qa ), qaxis( 0, 0, 1, rouse, _qb ), _qc ), this.q );
			this.q = q;

		}

		const fw = this.flightW;
		const feet = _a.set( ( W[ this.footL * 16 + 12 ] + W[ this.footR * 16 + 12 ] ) / 2, ( W[ this.footL * 16 + 13 ] + W[ this.footR * 16 + 13 ] ) / 2 - PAD, ( W[ this.footL * 16 + 14 ] + W[ this.footR * 16 + 14 ] ) / 2 );
		const body = _b.set( W[ this.rootN * 16 + 12 ], W[ this.rootN * 16 + 13 ], W[ this.rootN * 16 + 14 ] );
		const anchor = feet.lerp( body, this.mode === 'flying' ? fw : 0 );
		anchor.x -= this.mode === 'perched' ? this.shift : 0;
		anchor.y -= this.bobT > 0 && this.mode !== 'flying' ? Math.abs( Math.sin( this.time * 7 ) ) * 0.012 : 0;
		rotv( q, anchor, _c );
		// (popping back to his shoulder indoors: shrunk about its feet)
		const g = this.group, pop = this.popT > 0 ? Math.max( 1e-3, Math.abs( this.popT - POP / 2 ) / ( POP / 2 ) ) : 1;
		const sz = pop * ( this.mode === 'caged' ? 1 : SIZE );
		g.position.set( this.pos.x - _c.x * sz, this.pos.y - _c.y * sz, this.pos.z - _c.z * sz );
		g.scale.setScalar( sz );
		g.quaternion.set( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] );
		g.visible = this.mode !== 'riding';
		if ( ! g.visible ) m.hold();

		// readouts: how it sits on his shoulder
		if ( this.mode === 'perched' && shoulderQ && this.shoulderBone ) {

			this.shoulderDist = this.pos.distanceTo( this.shoulderBone );
			const bf = rotv( q, _c.set( 0, 0, 1 ), _c ), hf = rotv( shoulderQ, _d.set( 0, 0, 1 ), _d );
			this.fwdDot = bf.dot( hf );

		} else { this.shoulderDist = null; this.fwdDot = null; }

		this.footGap = null; this.footGaps = null; this.footLift = null;
		if ( this.mode === 'perched' && shoulderQ && this.onSkin && g.visible ) this.plant( q, g, this.bobT > 0 ? Math.abs( Math.sin( this.time * 7 ) ) * 0.012 : 0 );

	}

	// Both feet on his shirt. The toes are rigid on the foot joints and curl down from them, so what meets the
	// shirt is the underside of each toe and its claw: a few of those points per foot (picked once, the lowest
	// in each direction round the ankle) are cast onto the shoulder patch every frame. The body settles so the
	// feet share the slope, it crouches CROUCH on its legs, each leg takes up its own side (the tarsus slides
	// under the belly feathers, 2 cm out to 3.4 cm in), and the claws hook GRIP into the fabric. footGap reads the lowest toe point of the worse foot
	// against the shirt after all that (+ above the shirt, - sunk in).
	// the lowest toe point of foot i against the shirt (+ above), with the group where it is now
	lowToe( i, q, g ) {

		const W = this.model.world, f = ( i === 0 ? this.footL : this.footR ) * 16, T = this.toes[ i ].pts, patch = this.sh.patch, U = this.up;
		let best = null;
		for ( let n = 0; n < T.length; n += 3 ) {

			const x = T[ n ], y = T[ n + 1 ], z = T[ n + 2 ];
			_d.set( W[ f ] * x + W[ f + 4 ] * y + W[ f + 8 ] * z + W[ f + 12 ], W[ f + 1 ] * x + W[ f + 5 ] * y + W[ f + 9 ] * z + W[ f + 13 ], W[ f + 2 ] * x + W[ f + 6 ] * y + W[ f + 10 ] * z + W[ f + 14 ] );
			const h = patch.height( rotv( q, _d.multiplyScalar( g.scale.x ), _d ).add( g.position ), U );
			if ( h !== null && ( best === null || - h < best ) ) best = - h;

		}

		return best;

	}

	plant( q, g, bob ) {

		const m = this.model, W = m.world, D = m.jointData;
		if ( ! this.toes ) this.toes = [ this.toePoints( this.footL ), this.toePoints( this.footR ) ];
		const bu = rotv( q, _d.set( 0, 1, 0 ), _b ), k = 1 / Math.max( 0.5, bu.dot( this.up ) );
		const gaps = this._gaps || ( this._gaps = [ null, null ] ), lift = this._lift || ( this._lift = [ 0, 0 ] );
		const g0 = this.lowToe( 0, q, g ), g1 = this.lowToe( 1, q, g );
		const n0 = g0 === null ? null : ( g0 + GRIP ) * k, n1 = g1 === null ? null : ( g1 + GRIP ) * k;
		if ( n0 === null && n1 === null ) { gaps[ 0 ] = g0; gaps[ 1 ] = g1; this.footGaps = gaps; return; }
		const mean = ( n0 === null ? n1 : n1 === null ? n0 : ( n0 + n1 ) / 2 ) - bob + CROUCH; // the body keeps its bob: the knees take it
		g.position.addScaledVector( bu, - mean );
		this.settle = mean;
		lift[ 0 ] = n0 === null ? 0 : Math.max( - 0.02, Math.min( 0.034, mean - n0 ) );
		lift[ 1 ] = n1 === null ? 0 : Math.max( - 0.02, Math.min( 0.034, mean - n1 ) );
		for ( let i = 0; i < 2; i ++ ) {

			const f = i === 0 ? this.footL : this.footR, j = this.toes[ i ].joint;
			if ( j < 0 || ! lift[ i ] ) continue;
			W[ f * 16 + 13 ] += lift[ i ]; D[ j * 16 + 13 ] += lift[ i ];

		}
		m.jointBuffer.write( D );
		gaps[ 0 ] = this.lowToe( 0, q, g ); gaps[ 1 ] = this.lowToe( 1, q, g );
		this.footGaps = gaps; this.footLift = lift;
		this.footGap = gaps[ 0 ] === null ? gaps[ 1 ] : gaps[ 1 ] === null ? gaps[ 0 ] : Math.abs( gaps[ 0 ] ) >= Math.abs( gaps[ 1 ] ) ? gaps[ 0 ] : gaps[ 1 ];

	}

	// the contact points of one foot, in its joint's space: the two lowest foot vertices in each of eight
	// directions round the ankle, in the current (perched) pose. The foot is rigid, so they hold in any pose.
	toePoints( f ) {

		const m = this.model, jj = m.skin.joints.indexOf( f ), j = m.gltf.nodes[ f ].children.length ? - 1 : jj;
		const W = m.world, o = f * 16, ibm = m.skin.inverseBindMatrices, sect = [ [], [], [], [], [], [], [], [] ];
		for ( const mesh of m.meshes ) {

			const G = mesh.geometry, P = G.getAttribute( 'position' ).array, J = G.getAttribute( 'skinIndex' ).array, Wt = G.getAttribute( 'skinWeight' ).array;
			for ( let v = 0; v < P.length / 3; v ++ ) {

				let w = 0;
				for ( let n = 0; n < 4; n ++ ) if ( J[ v * 4 + n ] === jj ) w += Wt[ v * 4 + n ];
				if ( w < 0.9 ) continue;
				// joint space = inverse bind * bind position; model space (relative to the joint) through its world matrix
				const b = jj * 16, px = P[ v * 3 ], py = P[ v * 3 + 1 ], pz = P[ v * 3 + 2 ];
				const x = ibm[ b ] * px + ibm[ b + 4 ] * py + ibm[ b + 8 ] * pz + ibm[ b + 12 ];
				const y = ibm[ b + 1 ] * px + ibm[ b + 5 ] * py + ibm[ b + 9 ] * pz + ibm[ b + 13 ];
				const z = ibm[ b + 2 ] * px + ibm[ b + 6 ] * py + ibm[ b + 10 ] * pz + ibm[ b + 14 ];
				const mx = W[ o ] * x + W[ o + 4 ] * y + W[ o + 8 ] * z, my = W[ o + 1 ] * x + W[ o + 5 ] * y + W[ o + 9 ] * z, mz = W[ o + 2 ] * x + W[ o + 6 ] * y + W[ o + 10 ] * z;
				if ( Math.hypot( mx, mz ) < 0.006 ) continue; // the tarsus itself
				sect[ Math.floor( ( Math.atan2( mz, mx ) + Math.PI ) / ( Math.PI / 4 ) ) & 7 ].push( [ my, x, y, z ] );

			}

		}

		const pts = [];
		for ( const S of sect ) S.sort( ( a, b ) => a[ 0 ] - b[ 0 ] ).slice( 0, 2 ).forEach( ( p ) => pts.push( p[ 1 ], p[ 2 ], p[ 3 ] ) );
		return { joint: j, pts: Float32Array.from( pts ) };

	}

	// ------------------------------------------------------------------ the cage at Joe's (src/player/BirdCage.js)

	// off his shoulder, a short flight to the open door, a braking landing on the threshold, in onto the perch;
	// the door swings shut and latches behind him
	toCage( cage ) {

		if ( this.mode !== 'perched' || ! cage.loaded ) return false;
		this.cage = cage;
		cage.open();
		this.takeOff( 'cage', false );
		const f = this.flyer, end = cage.toWorld( CAGE.outside, _c ), d = Math.hypot( end.x - f.x, end.y - f.y, end.z - f.z );
		this.spot = { cage: true };
		this.land = { kind: 'cage', t: 0, p0: new THREE.Vector3( f.x, f.y, f.z ), v0: new THREE.Vector3( ( end.x - f.x ) * 0.6, 1.4, ( end.z - f.z ) * 0.6 ), T: clamp( d / 1.8, 1.1, 1.6 ) };
		this.cageAct = { kind: 'fly', t: 0, T: 99, entering: true };
		saveCaged( true );
		this.cageLog.push( 'put' );
		return true;

	}

	// the door opens, he hops out onto the threshold, flies to the shoulder and says hello
	fromCage() {

		if ( this.mode !== 'caged' || this.cageBusy() ) return false;
		this.cage.open();
		this.cageAct = { kind: 'wait', t: 0, T: 99, exit: true };
		saveCaged( false );
		this.cageLog.push( 'get' );
		return true;

	}

	cageBusy() { return !! ( this.cageAct?.exit || this.cageAct?.entering ); }

	recentSquawks( s ) { let n = 0; for ( const t of this.squawkTimes ) if ( this.time - t < s ) n ++; return n; }

	// Joe at the cage: he watches the seed go in; told to pipe down, he sulks
	onJoe( kind ) {

		if ( this.mode !== 'caged' || this.cageBusy() || this.ca?.hop ) return;
		if ( kind === 'hush' && this.ca.spot === 'perch' ) this.cageAct = { kind: 'sulk', t: 0, T: 7 + this.rng() * 4 };
		else { this.lookYaw = 0.8; this.lookPitch = 0.1; this.lookT = 2.5; this.bobT = 1.2; }

	}

	enterAt( where ) {

		const o = CAGE.outside;
		this.ca = where === 'door' ? { spot: 'door', x: o[ 0 ], y: o[ 1 ], z: o[ 2 ], yaw: Math.PI, pitch: 0, hop: null }
			: { spot: 'perch', x: 0.1, y: CAGE.perchY, z: CAGE.perchZ, yaw: 0, pitch: 0, hop: null };
		this.cageAct = { kind: 'sit', t: 0, T: 2 };
		this.flightW = 0; this.flapW = 0; this.flareW = 0; this.land = null; this.spot = null;
		this.group.visible = true;

	}

	// a short hop (no wings in the cage) to the perch, the swing seat, the front bars or the door threshold
	hopTo( target, T = 0.5, { x = null, after = null, then = null } = {} ) {

		const ca = this.ca, P = CAGE, rng = this.rng;
		let to, yaw = ca.yaw, pitch = 0;
		if ( target === 'perch' ) {

			const px = x ?? P.perchX[ 0 ] + rng() * ( P.perchX[ 1 ] - P.perchX[ 0 ] );
			to = () => [ px, P.perchY, P.perchZ ]; yaw = x !== null ? 0 : rng() < 0.6 ? 0 : Math.PI;

		} else if ( target === 'swing' ) {

			to = () => this.seatLocal(); yaw = rng() < 0.5 ? 0 : Math.PI;

		} else if ( target === 'bars' ) {

			const bx = - 0.05 + rng() * 0.2, by = 0.2 + rng() * 0.06;
			to = () => [ bx, by, P.barZ ]; yaw = 0; pitch = P.climbPitch;

		} else { const o = P.outside; to = () => o; yaw = 0; }

		ca.hop = { from: [ ca.x, ca.y, ca.z ], to, t: 0, T, yaw0: ca.yaw, yawTo: yaw, pitch0: ca.pitch || 0, pitchTo: pitch, spot: target, lift: target === 'bars' ? 0.02 : 0.05 };
		ca.crestCap = 0.25;
		this.cageAct = { kind: 'hop', t: 0, T: 99, after, then, exit: this.cageAct?.exit, entering: this.cageAct?.entering };
		this.cageLog.push( 'hop:' + target );
		if ( this.cageLog.length > 40 ) this.cageLog.shift();

	}

	seatLocal() {

		const P = CAGE, a = this.cage.swingA;
		return [ P.pivot[ 0 ], P.pivot[ 1 ] - P.seatDrop * Math.cos( a ), P.pivot[ 2 ] - P.seatDrop * Math.sin( a ) ];

	}

	// his orientation in the cage: the cage's, tilted with the swing when he is on it, his heading, and pitched
	// nose up against the bars when he climbs
	cageQ() {

		const c = this.cage, ca = this.ca, A = this._cqA || ( this._cqA = [ 0, 0, 0, 1 ] ), B = this._cqB || ( this._cqB = [ 0, 0, 0, 1 ] );
		qmul( c.q, qaxis( 1, 0, 0, ca.spot === 'swing' && ! ca.hop ? c.swingA : 0, _qa ), A );
		qmul( A, qaxis( 0, 1, 0, ca.yaw, _qa ), B );
		return qmul( B, qaxis( 1, 0, 0, ca.pitch || 0, _qa ), _qd );

	}

	caged( dt ) {

		const c = this.cage, ca = this.ca;
		if ( ! c || ! ca ) { this.snapToShoulder(); return; }
		this.clearance();
		if ( ca.hop ) {

			const h = ca.hop;
			h.t += dt;
			const u = clamp( h.t / h.T, 0, 1 ), e = u * u * ( 3 - 2 * u ), to = h.to();
			ca.x = h.from[ 0 ] + ( to[ 0 ] - h.from[ 0 ] ) * e;
			ca.y = h.from[ 1 ] + ( to[ 1 ] - h.from[ 1 ] ) * e + Math.sin( Math.PI * u ) * h.lift;
			ca.z = h.from[ 2 ] + ( to[ 2 ] - h.from[ 2 ] ) * e;
			const dy = Math.atan2( Math.sin( h.yawTo - h.yaw0 ), Math.cos( h.yawTo - h.yaw0 ) );
			ca.yaw = h.yaw0 + dy * sstep( 0, 0.45, u ); ca.pitch = h.pitch0 + ( h.pitchTo - h.pitch0 ) * e;
			if ( u >= 1 ) {

				ca.hop = null; ca.spot = h.spot; ca.crestCap = h.spot === 'swing' || h.spot === 'bars' ? 0.55 : 1;
				const A = this.cageAct;
				this.cageAct = A.after || { kind: 'sit', t: 0, T: 1 + this.rng() * 2, exit: A.exit };
				if ( A.then ) A.then();

			}

		} else this.cageTick( dt );

		if ( this.mode !== 'caged' ) return;
		if ( ca.spot === 'swing' && ! ca.hop ) { const s = this.seatLocal(); ca.x = s[ 0 ]; ca.y = s[ 1 ]; ca.z = s[ 2 ]; }
		c.toWorld( [ ca.x, ca.y, ca.z ], this.pos );
		// puffed up and sulking (the body feathers fluffed out)
		this.fluff = toward( this.fluff || 0, this.cageAct?.kind === 'sulk' ? 1 : 0, 2, dt );
		const rs = this.model.rest[ this.rootN ].s;
		if ( ! this._rootS ) this._rootS = Float32Array.from( rs );
		rs[ 0 ] = this._rootS[ 0 ] * ( 1 + 0.07 * this.fluff ); rs[ 1 ] = this._rootS[ 1 ] * ( 1 + 0.025 * this.fluff ); rs[ 2 ] = this._rootS[ 2 ] * ( 1 + 0.07 * this.fluff );
		this.passersBy( dt );

	}

	cageTick( dt ) {

		const A = this.cageAct, ca = this.ca, c = this.cage, rng = this.rng, P = CAGE;
		A.t += dt;
		c.pump = 0;
		if ( A.exit ) {

			// out: once the door is open, onto the threshold, then off to his shoulder
			if ( c.doorT > 0.85 ) this.hopTo( 'door', ca.spot === 'swing' ? 0.6 : 0.5, { then: () => this.leaveCage() } );
			return;

		}

		switch ( A.kind ) {

			// he pumps with the swing, less as it gets going (a gentle 10 to 15 degrees)
			case 'swinging': c.pump = 3 * Math.sign( c.swingV || 1 ) * Math.max( 0, 1 - Math.abs( c.swingA ) / 0.22 ); this.lookT = 1; this.lookPitch = - 0.1; break;
			case 'bell':
				this.lookYaw = A.side; this.lookPitch = 0.85; this.lookT = 1;
				if ( A.t > A.next ) { A.next += 0.75; c.knock( 9 ); this.beakT = 0.22; this.bells = ( this.bells || 0 ) + 1; }
				break;
			case 'climb':
				this.lookPitch = - 0.3; this.lookT = 1;
				if ( A.t > A.next ) { A.next += 0.7; A.tx = clamp( ca.x + ( rng() - 0.5 ) * 0.05, - 0.06, 0.16 ); A.ty = clamp( ca.y + ( rng() - 0.3 ) * 0.05, 0.19, P.climbTop ); this.beakT = 0.25; }
				ca.x = toward( ca.x, A.tx ?? ca.x, 4, dt ); ca.y = toward( ca.y, A.ty ?? ca.y, 4, dt );
				break;
			case 'sulk': this.lookPitch = 0.45; this.lookYaw = 0; this.lookT = 1; this.nextSquawk = Math.max( this.nextSquawk, 3 ); break;

		}

		if ( A.t < A.T ) return;
		const r = rng(), dwell = ( a, b ) => a + rng() * ( b - a );
		if ( ca.spot === 'perch' ) {

			if ( r < 0.2 ) this.cageAct = { kind: 'sit', t: 0, T: dwell( 3, 6 ) };
			else if ( r < 0.32 ) this.cageAct = { kind: 'sulk', t: 0, T: dwell( 7, 11 ) };
			else if ( r < 0.5 ) this.hopTo( 'swing', 0.55, { after: { kind: 'swinging', t: 0, T: dwell( 4, 7 ) } } );
			else if ( r < 0.64 ) this.hopTo( 'bars', 0.45, { after: { kind: 'climb', t: 0, T: dwell( 3, 5 ), next: 0 } } );
			else if ( r < 0.8 ) this.hopTo( 'perch', 0.35, { x: P.bellPerchX, after: { kind: 'bell', t: 0, T: 2.6, next: 0.4, side: - 0.9 } } );
			else { this.preenT = 3; this.cageAct = { kind: 'preen', t: 0, T: dwell( 3.5, 5 ) }; }

		} else if ( ca.spot === 'swing' ) {

			if ( r < 0.45 ) this.cageAct = { kind: 'swinging', t: 0, T: dwell( 4, 7 ) };
			else if ( r < 0.7 ) this.cageAct = { kind: 'bell', t: 0, T: 2.6, next: 0.4, side: ca.yaw === 0 ? 0.9 : - 0.9 };
			else this.hopTo( 'perch', 0.5 );

		} else if ( ca.spot === 'bars' && r < 0.45 ) this.cageAct = { kind: 'climb', t: 0, T: dwell( 3, 5 ), next: 0 };
		else this.hopTo( 'perch', 0.5 );

	}

	leaveCage() {

		this.ca = null; this.cageAct = null;
		this.fluff = 0;
		if ( this._rootS ) this.model.rest[ this.rootN ].s.set( this._rootS );
		this.mode = 'perched'; // (takeOff reads the pose as it stands on the threshold)
		this.hello = true;
		this.takeOff( 'return', false );
		this.cage.close( 0.9 );
		this.cageLog.push( 'out' );

	}

	// squawks at whoever comes past: the player and the townsfolk, once each until they have been gone a while
	passersBy( dt ) {

		if ( ( this.passT = ( this.passT || 0 ) - dt ) > 0 ) return;
		this.passT = 0.5;
		const list = [ [ 'player', this.app.player.position ] ];
		for ( const q of this.app.people?.list || [] ) if ( q.world ) list.push( [ q.id, q.world ] );
		for ( const [ id, w ] of list ) {

			if ( Math.hypot( w.x - this.pos.x, w.z - this.pos.z ) > 6 ) continue;
			const seen = this.passers.get( id );
			this.passers.set( id, this.time );
			if ( seen !== undefined && this.time - seen < 25 ) continue;
			if ( this.time - ( this._passCall ?? - 99 ) > 4 && this.rng() < 0.8 ) { this._passCall = this.time; this.passerCalls ++; this.squawk( 'passer' ); }

		}

	}

	// the head and the crest tip against the cage's free space (m, + inside), from last frame's placement
	clearance() {

		const W = this.model.world, h = this.headN * 16, g = this.group, c = this.cage;
		if ( ! g.visible ) return;
		const head = _d.set( W[ h + 12 ], W[ h + 13 ], W[ h + 14 ] ).multiplyScalar( g.scale.x ).applyQuaternion( g.quaternion ).add( g.position );
		const up = rotv( this.q, _b.set( 0, 1, 0 ), _b );
		const room = ( p ) => { const l = c.toLocal( p, _a ); return Math.min( CAGE.half[ 0 ] - 0.004 - Math.abs( l.x ), CAGE.half[ 1 ] - 0.004 - Math.abs( l.z ), c.ceiling( l.x ) - 0.004 - l.y ); };
		const outside = this.ca?.spot === 'door' || this.ca?.hop?.spot === 'door' || this.ca?.hop && this.ca.hop.from[ 2 ] > 0.22;
		this.headClear = outside ? null : + room( head ).toFixed( 3 );
		this.crestClear = outside ? null : + room( head.addScaledVector( up, 0.075 ) ).toFixed( 3 );

	}

	// read-only test hook (window.__app.cockatoo.state())
	state() {

		const mode = this.mode === 'resting' ? 'exploring' : this.mode === 'flying' ? ( this.goal === 'explore' ? 'exploring' : 'flying' ) : this.mode;
		const ca = this.ca, cage = this.mode === 'caged' || this.goal === 'cage' ? {
			act: this.cageAct?.kind || null, spot: ca?.spot || null, local: ca ? [ ca.x, ca.y, ca.z ].map( ( v ) => + v.toFixed( 3 ) ) : null,
			headClear: this.headClear ?? null, crestClear: this.crestClear ?? null, passerCalls: this.passerCalls, log: this.cageLog.slice( - 12 ),
		} : null;
		const r = ( v ) => v === null || v === undefined ? null : + v.toFixed( 3 );
		return {
			loaded: !! this.model, fast: this.fast, mode, detail: this.mode, goal: this.goal, landing: this.land ? this.land.kind : null,
			position: { x: r( this.pos.x ), y: r( this.pos.y ), z: r( this.pos.z ) }, visible: this.group.visible,
			distance: r( this.dist ), maxDistance: r( this.maxDistance ), shoulderDist: r( this.shoulderDist ), forwardDot: r( this.fwdDot ), wingScale: r( this.wingScale ), shellScale: r( this.shellScale ),
			footGap: r( this.footGap ), footGaps: this.footGaps ? this.footGaps.map( r ) : null, footLift: this.footLift ? this.footLift.map( r ) : null, settle: this.footGap === null ? null : r( this.settle ), onSkin: !! this.onSkin,
			crest: r( this.crest ), beak: r( this.beak ), squawks: this.squawks, lastSquawk: this.lastSquawk ? { ...this.lastSquawk } : null,
			trip: this.trip ? { ...this.trip, maxDistance: r( this.trip.maxDistance ) } : null, snaps: this.snaps,
			spot: this.spot ? ( this.spot.cage ? 'cage' : this.spot.local ? 'ferry' : this.spot.ground ? 'ground' : 'perch' ) : null, whistled: this.whistled ?? null,
			cage, cageState: this.app.game?.stand?.cage?.state() || null,
		};

	}

}

// sample a rotation channel at time t (linear keys, nlerp)
function sampleRot( ch, t, out ) {

	const T = ch.times, V = ch.values, n = T.length;
	if ( n === 1 || t <= T[ 0 ] ) { out.set( V.subarray( 0, 4 ) ); return; }
	if ( t >= T[ n - 1 ] ) { out.set( V.subarray( ( n - 1 ) * 4, n * 4 ) ); return; }
	let k = 0;
	while ( k < n - 2 && T[ k + 1 ] <= t ) k ++;
	const f = ( t - T[ k ] ) / ( T[ k + 1 ] - T[ k ] );
	qnlerp( V.subarray( k * 4, k * 4 + 4 ), V.subarray( k * 4 + 4, k * 4 + 8 ), f, out );

}

// the caged state survives a reload (localStorage next to the game save; storage can be missing or throw)
function loadCaged() {

	try { return JSON.parse( globalThis.localStorage?.getItem( CAGE_STORAGE_SLOT ) || 'null' )?.caged === true; } catch ( e ) { return false; }

}

function saveCaged( caged ) {

	try { globalThis.localStorage?.setItem( CAGE_STORAGE_SLOT, JSON.stringify( { caged, at: 'joe' } ) ); } catch ( e ) { /* no storage: he is on the shoulder after a reload */ }

}
