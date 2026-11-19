// Jetski buoy course off the main beach, Wave Race 64 style (docs/jetski.md "Buoy course").
// Slalom buoys (red: pass on its left, the buoy on your right; yellow: pass on its right), two big
// turn markers, a start / finish gate of two inflatable arches, and two floating kicker ramps the
// hull panels ride up (JetskiController `solids`). Everything bobs on the real surface (FFT + shore +
// wake) through the island's shared WaterQuery (app.query), moored with a line down to the sea floor.
// Models: public/models/jetski_course.glb (tools/jetski/course_build.py).
import * as THREE from '../engine/index.js';
import { Color } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { loadModel } from '../rally/VehicleModel.js';
import { LAYERS } from '../core/SceneRenderer.js';

// the ramp wedge in its own frame: x across, y up from the static waterline, z along the run from the
// nose (z 0, top just under the water) to the lip (z L). Same numbers as course_build.py.
export const RAMP = { L: 4.0, hw: 1.3, y0: - 0.08, y1: 1.0, bot: - 0.25, mass: 700 };

// open water 6 to 12 m deep between the pier (x 54, z < 40), the lobster boat's mooring (64.5, 36.5)
// and the ferry's approach (x 150, z > 325; her crossing is at z 490+ here)
export const COURSE = {
	gate: { x: 0, z: 125, yaw: 0, half: 6.2, gap: 7 }, // two arches `gap` m apart, the line on the first
	marks: [
		{ kind: 'red', x: 4, z: 160, yaw: 0 }, { kind: 'yellow', x: - 4, z: 190, yaw: 0 },
		{ kind: 'red', x: 4, z: 220, yaw: 0 }, { kind: 'yellow', x: - 4, z: 250, yaw: 0 },
		{ kind: 'turn', x: 30, z: 340, yaw: Math.PI / 2, reach: 70 }, // the sweeping turn: keep it on your left
		{ kind: 'red', x: 64, z: 305, yaw: Math.PI }, { kind: 'yellow', x: 56, z: 275, yaw: Math.PI },
		{ kind: 'red', x: 64, z: 245, yaw: Math.PI }, { kind: 'yellow', x: 56, z: 175, yaw: Math.PI },
		{ kind: 'red', x: 64, z: 145, yaw: Math.PI }, { kind: 'yellow', x: 56, z: 115, yaw: Math.PI },
		{ kind: 'turn', x: 30, z: 88, yaw: - Math.PI / 2, reach: 70 },
	],
	ramps: [ { x: 0, z: 279, yaw: 0 }, { x: 60, z: 214, yaw: Math.PI } ], // nose position, run heading
	penalty: 2.0, // s per buoy missed or passed on the wrong side
};

const SAVE_KEY = 'tidewater.jetskiCourse.v1';
const GHOST_HZ = 20;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3( 1, 0, 0 ), _Y = new THREE.Vector3( 0, 1, 0 ), _Z = new THREE.Vector3( 0, 0, 1 ), _down = new THREE.Vector3( 0, - 1, 0 );
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const fmt = ( t ) => t == null ? '-:--.--' : `${ Math.floor( t / 60 ) }:${ ( t % 60 ).toFixed( 2 ).padStart( 5, '0' ) }`;

function nodeNamed( root, name ) {

	let hit = null;
	root.traverse( ( o ) => { if ( ! hit && o.name === name ) hit = o; } );
	return hit;

}

// A floating kicker ramp: heave, pitch and roll on the water plane under its four corners, loaded by the
// ski through the contact. Waterplane stiffness rho g A (and rho g I for the angles); a flat float carries a
// large added mass (strip theory, half of rho pi (W/2)^2 per metre for a surface plate: ~11 t here), so it
// follows the swell (natural period ~2 s) but barely dips in the quarter second a ski takes to cross it.
class Ramp {

	constructor( spec, group ) {

		this.spec = spec;
		this.group = group;
		this.yawQ = new THREE.Quaternion().setFromAxisAngle( _Y, spec.yaw );
		this.fwd = new THREE.Vector3( Math.sin( spec.yaw ), 0, Math.cos( spec.yaw ) );
		this.center = new THREE.Vector3( spec.x, 0, spec.z ).addScaledVector( this.fwd, RAMP.L / 2 );
		this.y = 0; this.vy = 0; this.pitch = 0; this.vp = 0; this.roll = 0; this.vr = 0;
		this.position = new THREE.Vector3(); // the nose at the waterline (the model's origin)
		this.quaternion = new THREE.Quaternion();
		this.inv = new THREE.Quaternion();
		this.load = { fy: 0, tp: 0, tr: 0, n: 0 }; // accumulated from the ski over the frame (N s, N m s)
		const A = RAMP.L * RAMP.hw * 2, rg = 1025 * 9.81, ma = 0.5 * 1025 * Math.PI * RAMP.hw ** 2; // added mass per metre of length
		this.K = { y: rg * A, p: rg * 2 * RAMP.hw * RAMP.L ** 3 / 12, r: rg * RAMP.L * ( 2 * RAMP.hw ) ** 3 / 12 };
		this.I = { y: RAMP.mass + ma * RAMP.L, p: ( RAMP.mass / RAMP.L + ma ) * RAMP.L ** 3 / 12, r: ( RAMP.mass + ma * RAMP.L ) * ( 2 * RAMP.hw ) ** 2 / 24 };
		this.reach2 = 7 * 7;
		this.slope = ( RAMP.y1 - RAMP.y0 ) / RAMP.L;
		this.nTop = new THREE.Vector3( 0, 1, - this.slope ).normalize();
		this.pose();

	}

	pose() {

		this.quaternion.copy( this.yawQ ).multiply( _q.setFromAxisAngle( _X, this.pitch ) ).multiply( _q2.setFromAxisAngle( _Z, this.roll ) );
		this.inv.copy( this.quaternion ).invert();
		this.position.copy( this.center ).setY( this.y ).add( _v.set( 0, 0, - RAMP.L / 2 ).applyQuaternion( this.quaternion ) );
		this.group.position.copy( this.position );
		this.group.quaternion.copy( this.quaternion );
		this.group.updateMatrixWorld( true );

	}

	// corners' water: h[0] nose left, h[1] nose right, h[2] lip left, h[3] lip right
	step( dt, h ) {

		const hm = ( h[ 0 ] + h[ 1 ] + h[ 2 ] + h[ 3 ] ) / 4;
		// the float spans short chop: it takes about 60 % of the corner-to-corner slope
		const run = 0.6 * ( ( h[ 2 ] + h[ 3 ] ) - ( h[ 0 ] + h[ 1 ] ) ) / ( 2 * RAMP.L ), lat = 0.6 * ( ( h[ 0 ] + h[ 2 ] ) - ( h[ 1 ] + h[ 3 ] ) ) / ( 4 * RAMP.hw );
		const L = this.load, K = this.K, I = this.I, z = 0.45;
		const n = Math.max( 1, Math.ceil( dt / ( 1 / 120 ) ) ), hs = dt / n;
		const fy = L.fy / Math.max( dt, 1e-4 ), tp = L.tp / Math.max( dt, 1e-4 ), tr = L.tr / Math.max( dt, 1e-4 );
		for ( let i = 0; i < n; i ++ ) {

			this.vy += ( K.y * ( hm - this.y ) - 2 * z * Math.sqrt( K.y * I.y ) * this.vy + fy ) / I.y * hs;
			this.vp += ( K.p * ( - Math.atan( run ) - this.pitch ) - 2 * z * Math.sqrt( K.p * I.p ) * this.vp + tp ) / I.p * hs;
			this.vr += ( K.r * ( Math.atan( lat ) - this.roll ) - 2 * z * Math.sqrt( K.r * I.r ) * this.vr + tr ) / I.r * hs;
			this.y += this.vy * hs; this.pitch += this.vp * hs; this.roll += this.vr * hs;

		}

		this.y = clamp( this.y, hm - 0.8, hm + 0.8 ); this.pitch = clamp( this.pitch, - 0.5, 0.5 ); this.roll = clamp( this.roll, - 0.5, 0.5 );
		L.fy = 0; L.tp = 0; L.tr = 0; L.n = 0;
		this.pose();

	}

	corner( i, out ) {

		return out.set( i % 2 === 0 ? RAMP.hw : - RAMP.hw, 0, i < 2 ? 0 : RAMP.L ).applyQuaternion( this.yawQ ).add( _w.set( this.spec.x, 0, this.spec.z ) );

	}

	// JetskiController solid: penetration (m) of world point pw, out.n world normal, out.v surface velocity
	probe( pw, out ) {

		const l = _v.copy( pw ).sub( this.position ).applyQuaternion( this.inv );
		if ( l.z < 0 || l.z > RAMP.L || Math.abs( l.x ) > RAMP.hw || l.y < - 0.6 ) return 0; // (the nose takes a keel below the float)
		const top = RAMP.y0 + this.slope * l.z;
		if ( l.y > top ) return 0;
		const pTop = ( top - l.y ) * this.nTop.y, pSide = RAMP.hw - Math.abs( l.x ), pBack = RAMP.L - l.z;
		let pen = pTop;
		out.n.copy( this.nTop );
		// a point just under the deck rides the deck, even near an edge; one well inside came in through a
		// side or the back and is pushed out the nearest way
		if ( pTop > 0.3 && pSide < pen ) { pen = pSide; out.n.set( Math.sign( l.x ), 0, 0 ); }
		if ( pTop > 0.3 && pBack < pen ) { pen = pBack; out.n.set( 0, 0, 1 ); }
		if ( pen > 0.6 ) return 0; // deep inside: not a contact this surface can resolve
		out.n.applyQuaternion( this.quaternion );
		out.v.set( 0, this.vy + this.vp * ( RAMP.L / 2 - l.z ) + this.vr * l.x, 0 );
		out.lz = l.z; out.lx = l.x;
		return pen;

	}

	// the ski's force f (N) at pw pushes back on the ramp for h seconds
	push( f, pw, h, lz, lx ) {

		this.load.fy -= f.y * h;
		this.load.tp -= f.y * h * ( RAMP.L / 2 - lz ); // + pitch dips the lip
		this.load.tr -= f.y * h * lx;
		this.load.n ++;

	}

}

// The ghost's rider: a seated figure from primitives on the jetski contract's pivots (ski frame, +z bow,
// +x the rider's left): pelvis on the Seat, hands on GripL/GripR, feet on FootL/FootR, leaning into the bars.
function ghostRider( mat ) {

	const V = ( x, y, z ) => new THREE.Vector3( x, y, z ), up = V( 0, 1, 0 ), g = new THREE.Group();
	g.name = 'ghostRider';
	const ball = ( p, r ) => { const m = new THREE.Mesh( new THREE.SphereGeometry( r, 16, 10 ), mat ); m.position.copy( p ); g.add( m ); };
	const limb = ( a, b, r0, r1 = r0 ) => {

		const d = b.clone().sub( a ), m = new THREE.Mesh( new THREE.CylinderGeometry( r1, r0, d.length(), 12, 1, true ), mat );
		m.position.copy( a ).addScaledVector( d, 0.5 );
		m.quaternion.setFromUnitVectors( up, d.normalize() );
		g.add( m );

	};
	const pelvis = V( 0, 0.86, - 0.16 ), chest = V( 0, 1.3, 0.02 ), neck = V( 0, 1.44, 0.08 ), head = V( 0, 1.6, 0.12 );
	limb( pelvis, chest, 0.17, 0.2 ); ball( pelvis, 0.17 ); ball( chest, 0.2 );
	limb( chest, neck, 0.07 ); ball( head, 0.13 );
	for ( const sx of [ 1, - 1 ] ) {

		const sh = V( 0.2 * sx, 1.36, 0.03 ), el = V( 0.3 * sx, 1.08, 0.2 ), hand = V( 0.335 * sx, 0.87, 0.3 );
		const hip = V( 0.11 * sx, 0.84, - 0.1 ), knee = V( 0.27 * sx, 0.9, 0.24 ), foot = V( 0.355 * sx, 0.22, 0.08 );
		limb( sh, el, 0.065, 0.06 ); limb( el, hand, 0.055, 0.05 ); ball( sh, 0.075 ); ball( el, 0.06 ); ball( hand, 0.055 );
		limb( hip, knee, 0.095, 0.08 ); limb( knee, foot, 0.075, 0.06 ); ball( knee, 0.08 ); ball( foot, 0.07 );

	}
	return g;

}

export class JetskiCourse {

	constructor( app, jetskis ) {

		this.app = app;
		this.jetskis = jetskis;
		this.buoys = [];
		this.arches = [];
		this.ramps = [];
		this.lines = [];
		this.solids = [];
		this.ready = false;
		this.race = { on: false, t: 0, next: 0, penalties: 0, missed: [], laps: [], best: null, last: null, rec: [], recT: 0, flagT: 0, prevS: null };
		this.ghost = null; // { data: Float32Array [t x y z qx qy qz qw]*, n }
		this.metrics = { laps: 0, lastLap: null, penalties: 0, judged: [] };

	}

	async init() {

		const app = this.app;
		const base = import.meta.env.BASE_URL || '/';
		const model = await loadModel( `${ base }models/jetski_course.glb` );
		const src = ( n ) => { const o = nodeNamed( model.root, n ); if ( ! o ) throw new Error( `jetski_course.glb: no ${ n }` ); return o; };
		const add = ( o ) => { const c = o.clone( true ); c.position.set( 0, 0, 0 ); c.quaternion.set( 0, 0, 0, 1 ); app.scene.add( c ); return c; };
		const lineSrc = src( 'MooringLine' ), flashSrc = src( 'BuoyFlash' );
		// a missed buoy strobes: its shell lit a hot white-amber (the glb's flash shell is the red buoy's own red,
		// so on a red buoy nothing showed), a glow pulsing round it and rings running out over the water: it
		// reads from 30 m and more. Unlit, additive, no motion of their own (velocityWeight 0: TAA keeps the water's)
		const strobe = new Material( { name: 'buoyStrobe', color: new Color( 0, 0, 0 ), emissive: new Color( 3.2, 2.5, 1.5 ), lit: false } );
		const glowGeo = new THREE.SphereGeometry( 1, 24, 14 ), ringGeo = new THREE.TorusGeometry( 1, 0.05, 6, 64 );
		const fxMesh = ( geo, name, soft ) => {

			const mat = new Material( { name, color: new Color( 0, 0, 0 ), emissive: new Color( 0, 0, 0 ), lit: false, transparent: true, blending: 'additive', depthWrite: false, side: 'front', velocityWeight: 0,
				...( soft ? { output: `
	let nv = abs( dot( normalize( s.normal ), normalize( in.V ) ) );
	r.color = vec4f( mat.emissive * nv * nv * nv, 1.0 );` } : {} ) } );
			const m = new THREE.Mesh( geo, mat );
			m.layers.set( LAYERS.TRANSPARENT ); m.castShadow = false; m.visible = false; app.scene.add( m );
			return m;

		};
		const line = ( ax, az, draft ) => { const g = add( lineSrc ); const l = { g, anchor: null, ax, az, draft }; this.lines.push( l ); return l; };
		for ( const m of COURSE.marks ) {

			const g = add( src( m.kind === 'red' ? 'BuoyRed' : m.kind === 'yellow' ? 'BuoyYellow' : 'BuoyTurn' ) );
			const flash = add( flashSrc );
			if ( m.kind === 'turn' ) flash.scale.setScalar( 1.72 );
			flash.visible = false;
			flash.traverse( ( o ) => { if ( o.material ) o.material = strobe; } );
			const glow = fxMesh( glowGeo, 'buoyGlow', true ), ring = fxMesh( ringGeo, 'buoyRing', false );
			ring.rotation.x = Math.PI / 2;
			const f = new THREE.Vector3( Math.sin( m.yaw ), 0, Math.cos( m.yaw ) );
			const bo = { m, g, flash, glow, ring, f, left: new THREE.Vector3( f.z, 0, - f.x ), y: 0, vy: 0, tilt: new THREE.Quaternion(), flashT: 0, line: line( 0.7, 0.4, m.kind === 'turn' ? 0.42 : 0.38 ), draft: m.kind === 'turn' ? 0.35 : 0.3, off: new THREE.Vector3(), ov: new THREE.Vector3() };
			// a soft bumper for the ski (JetskiController.contacts): an inflatable float that gives, is shoved aside
			// on its mooring and pushed under (it bobs back up); 25 kg plus the water it carries
			bo.bump = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: m.kind === 'turn' ? 0.55 : 0.45, top: 0, soft: true, k: 26000, c: 2500,
				onHit: ( f, pw, h ) => { bo.ov.x -= f.x * h / 60; bo.ov.z -= f.z * h / 60; bo.vy -= Math.hypot( f.x, f.z ) * h / 120; bo.hits = ( bo.hits || 0 ) + 1; } };
			this.buoys.push( bo );

		}

		const G = COURSE.gate, gf = new THREE.Vector3( Math.sin( G.yaw ), 0, Math.cos( G.yaw ) ), gl = new THREE.Vector3( gf.z, 0, - gf.x );
		for ( let k = 0; k < 2; k ++ ) {

			const g = add( src( 'Arch' ) );
			const at = new THREE.Vector3( G.x, 0, G.z ).addScaledVector( gf, k * G.gap );
			// the arch's span runs along its own x: turn it across the course
			const legs = [ at.clone().addScaledVector( gl, 6.5 ), at.clone().addScaledVector( gl, - 6.5 ) ];
			// the arch legs are hard bumpers (an inflated tube at 0.2 bar, 0.5 m across, anchored)
			this.arches.push( { g, at, yaw: G.yaw, y: 0, legs, lines: [ line( 1.2, 0, 0.3 ), line( - 1.2, 0, 0.3 ) ], bumps: legs.map( ( p ) => ( { a: p.clone(), b: p.clone(), r: 0.5, top: 6 } ) ) } );

		}

		for ( const r of COURSE.ramps ) {

			const ramp = new Ramp( r, add( src( 'Ramp' ) ) );
			ramp.lines = [ line( 0, 0, 0.2 ), line( 0, 0, 0.2 ) ];
			this.ramps.push( ramp );
			this.solids.push( ramp );

		}

		// on the island's shared water query (128 slots since the island filled the first 64): one dispatch and
		// one readback for everything, the course's points fixed in the water
		this.q = app.query;
		this.slot = this.q.allocate( 'course', this.buoys.length + 2 * this.arches.length + 4 * this.ramps.length );
		const pts = this.pts = [];
		for ( const b of this.buoys ) pts.push( [ b.m.x, b.m.z ] );
		for ( const a of this.arches ) for ( const p of a.legs ) pts.push( [ p.x, p.z ] );
		for ( const r of this.ramps ) for ( let i = 0; i < 4; i ++ ) { r.corner( i, _v ); pts.push( [ _v.x, _v.z ] ); }
		for ( let i = 0; i < pts.length; i ++ ) this.q.setPoint( this.slot + i, pts[ i ][ 0 ], pts[ i ][ 1 ] );
		this.terrain = app.terrainData;

		// the ghost: a translucent copy of the ski
		// (its own load of the model: a clone of the live ski shares its meshes, and the live ski went see-through)
		const skiModel = await loadModel( `${ base }models/jetski.glb` ).catch( () => null );
		if ( skiModel ) {

			// unlit, a soft ice-blue body and a bright Fresnel rim: the silhouette reads against blue water and
			// white foam alike. Depth tested and depth written, so only its nearest surface shows (no see-through
			// muddle of the hull's insides) and it sits behind buoys, ramps and the live ski properly.
			const gm = new Material( { name: 'jetskiGhost', lit: false, transparent: true, depthWrite: true, side: 'front',
				color: new Color( 0.45, 0.85, 1.0 ), opacity: 0.22,
				output: `
	let nv = abs( dot( normalize( s.normal ), normalize( in.V ) ) );
	let rim = pow( 1.0 - clamp( nv, 0.0, 1.0 ), 2.2 );
	r.color = vec4f( mat.color * ( 0.55 + 2.6 * rim ), clamp( mat.opacity + 0.7 * rim, 0.0, 0.9 ) );` } );
			const gg = new THREE.Group();
			gg.add( skiModel.root );
			skiModel.root.traverse( ( o ) => { if ( o.material ) o.material = Array.isArray( o.material ) ? o.material.map( () => gm ) : gm; } );
			gg.add( ghostRider( gm ) );
			gg.name = 'jetski:ghost';
			gg.visible = false;
			app.scene.add( gg );
			this.ghostGroup = gg;

		}

		this.load();
		this.ready = true;

	}

	storage() {

		try { return this.app.game?.state?.storage || ( typeof localStorage !== 'undefined' ? localStorage : null ); } catch ( e ) { return null; }

	}

	load() {

		try {

			const raw = this.storage()?.getItem( SAVE_KEY );
			if ( ! raw ) return;
			const j = JSON.parse( raw );
			if ( Number.isFinite( j.best ) ) this.race.best = j.best;
			if ( Array.isArray( j.ghost ) && j.ghost.length >= 16 ) this.ghost = { data: Float32Array.from( j.ghost ), n: Math.floor( j.ghost.length / 8 ) };

		} catch ( e ) { /* a bad save: start clean */ }

	}

	save() {

		try {

			const g = this.ghost ? Array.from( this.ghost.data, ( v, i ) => i % 8 === 0 ? Math.round( v * 100 ) / 100 : Math.round( v * 1000 ) / 1000 ) : null;
			this.storage()?.setItem( SAVE_KEY, JSON.stringify( { best: this.race.best, ghost: g } ) );

		} catch ( e ) { /* storage full or blocked */ }

	}

	// ---------------------------------------------------------------- per frame

	update( dt ) {

		if ( ! this.ready ) return;
		dt = Math.min( dt, 1 / 20 );
		const q = this.q, t = this.terrain;
		const cam = this.app.camera.position;
		const near = Math.hypot( cam.x - 30, cam.z - 220 ) < 700;
		if ( ! near ) return;
		// (the shared query is dispatched once a frame by the app: the points only need to be there)
		for ( let i = 0; i < this.pts.length; i ++ ) q.setPoint( this.slot + i, this.pts[ i ][ 0 ], this.pts[ i ][ 1 ] );
		const has = q.cpuValid && q.resultInputs[ this.slot * 4 ] === Math.fround( this.pts[ 0 ][ 0 ] ); // (a result from before the course had its slots reads 0)
		const H = ( i ) => { const h = q.cpu[ ( this.slot + i ) * 4 ]; return has && Number.isFinite( h ) ? h : 0; };
		const N = ( i, out ) => { const k = ( this.slot + i ) * 4; const nx = has ? q.cpu[ k + 1 ] || 0 : 0, nz = has ? q.cpu[ k + 2 ] || 0 : 0; return out.set( nx, 1, nz ).normalize(); };
		let k = 0;
		const now = performance.now() / 1000;
		for ( const b of this.buoys ) {

			// a light float: it follows the surface within ~0.15 s and leans with it (the line holds it back a little)
			const h = H( k );
			b.vy += ( ( h - b.y ) * 180 - b.vy * 16 ) * dt; b.y += b.vy * dt;
			b.tilt.slerp( _q.setFromUnitVectors( _Y, N( k, _v ).lerp( _Y, 0.35 ).normalize() ), 1 - Math.exp( - dt * 6 ) );
			k ++;
			// shoved by the ski: back on its mooring (a spring), water drag, never further than the line allows
			b.ov.addScaledVector( b.off, - 5 * dt ).multiplyScalar( Math.exp( - 2.2 * dt ) );
			b.off.addScaledVector( b.ov, dt );
			if ( b.off.lengthSq() > 6.25 ) { b.off.setLength( 2.5 ); b.ov.multiplyScalar( 0.5 ); }
			b.g.position.set( b.m.x + b.off.x, b.y - b.draft + 0.3, b.m.z + b.off.z );
			b.bump.a.set( b.g.position.x, 0, b.g.position.z ); b.bump.b.copy( b.bump.a ); b.bump.top = b.y + 1.3;
			b.g.quaternion.copy( b.tilt ).multiply( _q.setFromAxisAngle( _Y, b.m.yaw + 0.3 * Math.sin( now * 0.21 + b.m.x ) ) );
			b.g.updateMatrixWorld( true );
			b.flashT = Math.max( 0, b.flashT - dt );
			const on = b.flashT > 0, ph = 2.0 - b.flashT; // (s since the miss)
			b.flash.visible = on && Math.floor( ph * 6 ) % 2 === 0;
			b.glow.visible = b.ring.visible = on;
			if ( b.flash.visible ) { b.flash.position.copy( b.g.position ); b.flash.quaternion.copy( b.g.quaternion ); b.flash.updateMatrixWorld( true ); }
			if ( on ) {

				// two pulses a second: the glow swells and dies, a ring runs out to ~6 m over the water
				const u = ( ph * 2 ) % 1, fade = THREE.MathUtils.smoothstep( b.flashT, 0, 0.4 ), big = b.m.kind === 'turn' ? 1.7 : 1, p = b.g.position;
				b.glow.position.set( p.x, p.y + 0.5 * big, p.z ); b.glow.scale.setScalar( big * ( 1.0 + 0.8 * u ) );
				b.glow.material.emissive.setRGB( 1.6, 1.0, 0.4 ).multiplyScalar( ( 1 - u ) * ( b.flash.visible ? 1 : 0.45 ) * fade );
				const rr = big * ( 0.8 + 5.2 * u );
				b.ring.position.set( p.x, b.y + 0.08, p.z ); b.ring.scale.set( rr, rr, 1 );
				b.ring.material.emissive.setRGB( 1.4, 1.0, 0.5 ).multiplyScalar( ( 1 - u ) * ( 1 - u ) * fade );
				b.glow.updateMatrixWorld( true ); b.ring.updateMatrixWorld( true );

			}
			this.moor( b.line, b.g, - 0.34 );

		}

		for ( const a of this.arches ) {

			const h0 = H( k ), h1 = H( k + 1 ); k += 2;
			const ym = ( h0 + h1 ) / 2;
			a.y += ( ym - a.y ) * ( 1 - Math.exp( - dt * 3 ) );
			a.g.position.set( a.at.x, a.y - 0.05, a.at.z );
			// the span along the course's left axis, tilted by the water under the two legs
			a.g.quaternion.setFromAxisAngle( _Y, a.yaw ).multiply( _q.setFromAxisAngle( _Z, clamp( Math.atan2( h0 - h1, 13 ), - 0.08, 0.08 ) ) );
			a.g.updateMatrixWorld( true );
			for ( let j = 0; j < 2; j ++ ) this.moor( a.lines[ j ], a.g, - 0.3, j ? - 6.5 : 6.5 );
			for ( const bp of a.bumps ) bp.top = a.y + 6;

		}

		for ( const r of this.ramps ) {

			const hc = [ H( k ), H( k + 1 ), H( k + 2 ), H( k + 3 ) ]; k += 4;
			r.step( dt, hc );
			this.moor( r.lines[ 0 ], r.group, - 0.2, RAMP.hw - 0.2, 0.1 );
			this.moor( r.lines[ 1 ], r.group, - 0.2, - RAMP.hw + 0.2, 0.1 );

		}

		this.updateRace( dt );
		this.updateGhost();
		this.hudUpdate( dt );

	}

	// what the ski can hit near a point (Jetskis.vesselCapsules): buoys (soft) and arch legs (hard) within 40 m
	bumpers( p ) {

		const out = this._bumps || ( this._bumps = [] );
		out.length = 0;
		if ( ! this.ready ) return out;
		for ( const b of this.buoys ) if ( Math.abs( b.bump.a.x - p.x ) < 40 && Math.abs( b.bump.a.z - p.z ) < 40 ) out.push( b.bump );
		for ( const a of this.arches ) for ( const bp of a.bumps ) if ( Math.abs( bp.a.x - p.x ) < 40 && Math.abs( bp.a.z - p.z ) < 40 ) out.push( bp );
		return out;

	}

	// a mooring line from a point under the float straight down (a little upstream) to the sea floor
	moor( l, g, y, x = 0, z = 0 ) {

		const top = _v.set( x, y, z ).applyQuaternion( g.quaternion ).add( g.position );
		if ( ! l.anchor ) { const gx = top.x + 0.8, gz = top.z + 0.5; l.anchor = new THREE.Vector3( gx, this.terrain.heightAt( gx, gz ), gz ); }
		const d = _w.copy( l.anchor ).sub( top );
		const len = d.length();
		l.g.position.copy( top );
		l.g.quaternion.setFromUnitVectors( _down, d.divideScalar( Math.max( len, 1e-3 ) ) );
		l.g.scale.set( 1, len, 1 );
		l.g.updateMatrixWorld( true );

	}

	// ---------------------------------------------------------------- race

	gateS( p ) {

		const G = COURSE.gate;
		return { s: ( p.x - G.x ) * Math.sin( G.yaw ) + ( p.z - G.z ) * Math.cos( G.yaw ), lat: ( p.x - G.x ) * Math.cos( G.yaw ) - ( p.z - G.z ) * Math.sin( G.yaw ) };

	}

	updateRace( dt ) {

		const js = this.jetskis, c = js.ctl, R = this.race, mode = this.app.player.mode;
		const onSki = mode === 'jetski' || mode === 'jetski-thrown' || ( mode === 'swim' && R.on );
		const p = c.position;
		if ( R.on ) {

			R.t += dt;
			R.recT += dt;
			if ( R.recT >= 1 / GHOST_HZ ) { R.recT -= 1 / GHOST_HZ; R.rec.push( R.t, p.x, p.y, p.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w ); }
			if ( ! onSki || Math.hypot( p.x - 30, p.z - 220 ) > 450 || R.t > 600 ) { R.on = false; R.rec = []; }

		}

		R.flagT = Math.max( 0, R.flagT - dt );
		if ( mode !== 'jetski' && ! R.on ) { R.prevS = null; return; }
		// the gate line: crossed forward between the arch legs
		const gs = this.gateS( p );
		if ( R.prevS != null && R.prevS < 0 && gs.s >= 0 && Math.abs( gs.lat ) < COURSE.gate.half ) this.crossGate();
		R.prevS = gs.s;
		if ( ! R.on ) return;
		// the next mark, and the one after it (skipping a mark counts it missed)
		for ( let look = 0; look < 2 && R.next < this.buoys.length; look ++ ) {

			const b = this.buoys[ R.next + look ];
			if ( ! b ) break;
			const rel = _v.set( p.x - b.m.x, 0, p.z - b.m.z );
			const s = rel.dot( b.f ), lat = rel.dot( b.left );
			const prev = b.prevS;
			b.prevS = s;
			if ( prev == null || ! ( prev < 0 && s >= 0 ) || Math.abs( lat ) > ( b.m.reach || 30 ) ) continue;
			if ( look === 1 ) this.judge( this.buoys[ R.next ], null );
			// red: he passes on its left (lat > 0); yellow and the turn markers: on its right
			this.judge( b, b.m.kind === 'red' ? lat > 0 : lat < 0, lat );
			break;

		}

	}

	judge( b, ok, lat = null ) {

		const R = this.race;
		R.next = this.buoys.indexOf( b ) + 1;
		this.metrics.judged.push( { i: this.buoys.indexOf( b ), kind: b.m.kind, ok: !! ok, lat: lat == null ? null : + lat.toFixed( 1 ), t: + R.t.toFixed( 2 ) } );
		if ( this.metrics.judged.length > 40 ) this.metrics.judged.shift();
		if ( ok ) return;
		R.penalties ++;
		this.metrics.penalties ++;
		b.flashT = 2.0;
		R.penT = 1.6;
		this.app.audio?.jetskiSlap?.( 0.4 );

	}

	crossGate() {

		const R = this.race;
		if ( R.on && R.next >= this.buoys.length - 2 ) {

			for ( let i = R.next; i < this.buoys.length; i ++ ) this.judge( this.buoys[ i ], false );
			const lap = R.t + R.penalties * COURSE.penalty;
			const best = R.best == null || lap < R.best;
			R.last = { time: lap, raw: R.t, penalties: R.penalties, best };
			R.laps.push( R.last );
			this.metrics.laps ++;
			this.metrics.lastLap = { time: + lap.toFixed( 2 ), raw: + R.t.toFixed( 2 ), penalties: R.penalties, best };
			if ( best ) {

				R.best = lap;
				this.ghost = { data: Float32Array.from( R.rec ), n: R.rec.length / 8 };
				this.save();

			}

			R.flagT = 3.5;

		}

		// a new lap (a crossing mid-lap restarts it)
		R.on = true; R.t = 0; R.next = 0; R.penalties = 0; R.rec = []; R.recT = 0;
		for ( const b of this.buoys ) b.prevS = null;

	}

	updateGhost() {

		const g = this.ghostGroup, G = this.ghost, R = this.race;
		if ( ! g ) return;
		const show = !! ( G && R.on && G.n > 1 && R.t <= G.data[ ( G.n - 1 ) * 8 ] );
		g.visible = show;
		if ( ! show ) return;
		const d = G.data;
		let i = Math.min( Math.floor( R.t * GHOST_HZ ), G.n - 2 );
		while ( i > 0 && d[ i * 8 ] > R.t ) i --;
		while ( i < G.n - 2 && d[ ( i + 1 ) * 8 ] < R.t ) i ++;
		const a = i * 8, b = a + 8, u = clamp( ( R.t - d[ a ] ) / Math.max( d[ b ] - d[ a ], 1e-3 ), 0, 1 );
		g.position.set( d[ a + 1 ] + ( d[ b + 1 ] - d[ a + 1 ] ) * u, d[ a + 2 ] + ( d[ b + 2 ] - d[ a + 2 ] ) * u, d[ a + 3 ] + ( d[ b + 3 ] - d[ a + 3 ] ) * u );
		_q.set( d[ a + 4 ], d[ a + 5 ], d[ a + 6 ], d[ a + 7 ] ); _q2.set( d[ b + 4 ], d[ b + 5 ], d[ b + 6 ], d[ b + 7 ] );
		g.quaternion.copy( _q ).slerp( _q2, u );
		g.updateMatrixWorld( true );

	}

	// ---------------------------------------------------------------- HUD (inside the jetski HUD, same glass)

	hudUpdate( dt ) {

		const root = this.jetskis.hud?.root;
		if ( ! root ) return;
		if ( ! this.el ) {

			const st = document.createElement( 'style' );
			st.textContent = `
.jh-top { position: fixed; left: 50%; top: calc(var(--tw-edge, 18px) + 44px); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 20; color: var(--tw-ink, #eef6fa); font: 500 12px/1.3 var(--tw-font, system-ui, sans-serif); }
.jh-top[hidden] { display: none; }
.jh-race { display: grid; grid-template-columns: repeat(3, auto); align-items: baseline; column-gap: 18px; padding: 8px 16px; border-radius: var(--tw-r-lg, 14px); }
.jh-race[hidden], .jh-flag[hidden] { display: none; }
.jh-race div { display: flex; align-items: baseline; gap: 6px; }
.jh-race b { font: 600 20px/1 var(--tw-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.jh-race .jh-best b, .jh-race .jh-buoys b { font-size: 15px; color: var(--tw-ink-2, rgba(230,240,245,0.85)); }
.jh-top .jh-label { color: var(--tw-ink-2, rgba(230,240,245,0.7)); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.jh-race .jh-pen { grid-column: 1 / -1; justify-content: center; color: #ffb86b; font-weight: 600; letter-spacing: 0.04em; }
.jh-race .jh-pen[hidden] { display: none; }
.jh-flag { display: flex; align-items: center; gap: 12px; padding: 6px 14px 6px 6px; border-radius: 10px; background: rgba(6, 16, 24, 0.72); font: 600 13px/1.2 var(--tw-font, system-ui, sans-serif); }
.jh-flag i { width: 44px; height: 26px; border-radius: 4px; background: repeating-conic-gradient(#f4f6f7 0 25%, #101216 0 50%) 0 0 / 13px 13px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35); }
.jh-flag span { font-variant-numeric: tabular-nums; }
`;
			document.head.appendChild( st );
			const el = this.el = document.createElement( 'div' );
			el.className = 'jh-race tw-glass';
			el.setAttribute( 'role', 'timer' );
			el.setAttribute( 'aria-label', 'Lap timer' );
			el.hidden = true;
			el.innerHTML = '<div><span class="jh-label">Lap</span><b class="jh-lap">0:00.00</b></div><div class="jh-best"><span class="jh-label">Best</span><b>-:--.--</b></div><div class="jh-buoys"><span class="jh-label">Buoys</span><b>0/12</b></div><div class="jh-pen" hidden>Missed buoy +2.0 s</div>';
			const flag = this.flagEl = document.createElement( 'div' );
			flag.className = 'jh-flag';
			flag.setAttribute( 'role', 'status' );
			flag.hidden = true;
			flag.innerHTML = '<i aria-hidden="true"></i><span></span>';
			// top centre, clear of the prompt pill and the speed panel at the bottom
			const top = this.topEl = document.createElement( 'section' );
			top.className = 'jh-top';
			top.setAttribute( 'aria-label', 'Jetski race' );
			top.append( el, flag );
			document.body.appendChild( top );
			this.lapEl = el.querySelector( '.jh-lap' ); this.bestEl = el.querySelector( '.jh-best b' ); this.buoyEl = el.querySelector( '.jh-buoys b' ); this.penEl = el.querySelector( '.jh-pen' );

		}

		const R = this.race;
		R.penT = Math.max( 0, ( R.penT || 0 ) - dt );
		this.topEl.hidden = root.hidden;
		const near = Math.hypot( this.jetskis.ctl.position.x - 30, this.jetskis.ctl.position.z - 220 ) < 260;
		const show = R.on || R.flagT > 0 || near;
		this.el.hidden = ! show;
		if ( show ) {

			const lapT = R.on ? R.t + R.penalties * COURSE.penalty : ( R.last ? R.last.time : 0 );
			this.lapEl.textContent = fmt( lapT );
			this.bestEl.textContent = fmt( R.best );
			this.buoyEl.textContent = `${ R.on ? R.next - R.penalties : 0 }/${ this.buoys.length }`;
			this.penEl.hidden = ! ( R.penT > 0 );
			if ( R.penT > 0 ) this.penEl.textContent = `Missed buoy  +${ ( R.penalties * COURSE.penalty ).toFixed( 1 ) } s`;

		}

		this.flagEl.hidden = ! ( R.flagT > 0 && R.last );
		if ( R.flagT > 0 && R.last ) this.flagEl.querySelector( 'span' ).textContent = `Lap ${ fmt( R.last.time ) }${ R.last.penalties ? `  (${ R.last.penalties } missed)` : '' }${ R.last.best ? '  ·  Best lap' : '' }`;

	}

	state() {

		const R = this.race;
		return {
			ready: this.ready, on: R.on, t: + R.t.toFixed( 2 ), next: R.next, penalties: R.penalties, best: R.best == null ? null : + R.best.toFixed( 2 ), metrics: this.metrics,
			ghost: this.ghost ? { n: this.ghost.n, visible: !! this.ghostGroup?.visible, at: this.ghostGroup ? this.ghostGroup.position.toArray().map( ( v ) => + v.toFixed( 2 ) ) : null } : null,
			ramps: this.ramps.map( ( r ) => ( { y: + r.y.toFixed( 3 ), pitch: + ( r.pitch * 57.3 ).toFixed( 2 ), roll: + ( r.roll * 57.3 ).toFixed( 2 ) } ) ),
			buoysY: this.buoys.slice( 0, 3 ).map( ( b ) => + b.y.toFixed( 3 ) ), queryValid: !! this.q?.cpuValid,
		};

	}

}
