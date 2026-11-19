import * as THREE from '../engine/index.js';
import { Group, Mesh, BoxGeometry, CylinderGeometry, Color } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { loadModel } from '../rally/VehicleModel.js';
import { SPRAY } from '../fx/Spray.js';
import { JetskiController, skiWakeHead } from './JetskiController.js';
import { JetskiCourse } from './Course.js';
import { Mate } from './Mate.js';
import { JetskiLights } from './JetskiLights.js';

// The jetskis: parked at the beach hire stand and at Joey, ridden with E (src/jetski/JetskiController.js
// is the physics, docs/jetski.md the model and the controls). One ski at a time runs the full physics on
// the GPU water queries (the one you ride, or last rode); the parked ones bob on one query each.
//
// Model contract (public/models/jetski.glb from the model): Y up, +Z forward, metres, origin on
// the centreline at the static waterline; nodes Hull, Bars, Nozzle, Seat, GripL/R, FootL/R, JetOut, Bow,
// SprayL/R. Until it lands a placeholder stand-up ski is built from boxes.

const spotModules = import.meta.glob( './spots.js', { eager: true } );
const DEFAULT_SPOTS = [
	{ name: 'Beach hire 1', x: 22, z: - 38, yaw: 0 },
	{ name: 'Beach hire 2', x: 26, z: - 38, yaw: 0 },
	{ name: 'Beach hire 3', x: 30, z: - 38, yaw: 0 },
	{ name: 'Joey 1', x: - 176, z: 640, yaw: Math.PI },
	{ name: 'Joey 2', x: - 170, z: 640, yaw: Math.PI },
];
const DEG = Math.PI / 180;
// his pelvis in ski_sit (player.glb extras `ski.pelvis`): the rider's origin goes at Seat minus this
const RIDER_PELVIS = [ 0.0364, 0.578, - 0.1438 ];
const sstep = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const PIVOTS = { Seat: [ 0, 0.5, - 0.5 ], GripL: [ 0.3, 0.98, 0.2 ], GripR: [ - 0.3, 0.98, 0.2 ], FootL: [ 0.2, 0.1, - 0.75 ], FootR: [ - 0.2, 0.1, - 0.75 ],
	JetOut: [ 0, - 0.14, - 1.62 ], Bow: [ 0, 0.12, 1.72 ], SprayL: [ 0.5, - 0.12, 0.65 ], SprayR: [ - 0.5, - 0.12, 0.65 ] };

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _he = new THREE.Vector3();
const SKI_BOW = 1.68; // m: the bow tip ahead of the hull origin (the controller's bow contact point)
const _x = new THREE.Vector3( 1, 0, 0 ), _y = new THREE.Vector3( 0, 1, 0 ), _z = new THREE.Vector3( 0, 0, 1 );
const _opts = { spread: 0.6, jitter: 0.1, life: 1.2, sizeJitter: 0.5 };
const ROCKET_OUT = [ 0, 0.446, - 1.915 ]; // jetski_rocket.glb RocketOut (the bell exit) when the node is missing

// The rocket flame: three nested additive cones (white core, orange, a faint red outer), unlit, flickered per
// frame, plus a pool of sparks. The engine has no screen-space distortion, so the heat shimmer is the flicker.
function makeFlame() {

	const g = new Group();
	g.name = 'RocketFlame';
	// velocityWeight 0: an additive glow has no coverage of its own, so it must not claim the motion of its
	// pixels (it wrote alpha 1 and took over the water's and the hull's motion: TAA speckled the nozzle)
	// soft: a gas plume, not a solid cone. Its glow falls off toward the silhouette (Fresnel: edge-on the plume
	// is thin) and down its length (uv.y is 1 at the exit, 0 at the aft end), so no layer reads as a flat wedge
	// (the world normal and the along-the-plume coordinate ride their own varyings: an unlit material's
	// fragment normal is not to be relied on)
	const soft = {
		varyings: { vFlameN: 'vec3f', vFlameAlong: 'f32' },
		vertex: /* wgsl */`o.vFlameN = ( v.model * vec4f( v.normal, 0.0 ) ).xyz; o.vFlameAlong = v.uv.y;`,
		output: /* wgsl */`
	let fn0 = in.vs.vFlameN;
	let ndv = select( 1.0, abs( dot( fn0 * inverseSqrt( max( dot( fn0, fn0 ), 1e-12 ) ), normalize( frame.cameraPos - in.P ) ) ), dot( fn0, fn0 ) > 1e-10 );
	let k = ( 0.25 + 0.75 * ndv * ndv ) * smoothstep( 0.0, 0.75, in.vs.vFlameAlong );
	r.color = vec4f( r.color.rgb * k, r.color.a * k );
`,
	};
	const add = ( c, edge = true ) => new Material( { name: 'rocketFlame', color: new Color( 0, 0, 0 ), emissive: new Color( ...c ), lit: false, transparent: true, blending: 'additive', depthWrite: false, side: 'double', velocityWeight: 0, ...( edge ? soft : {} ) } );
	// a rocket plume, not a beam: a short white-hot core, an orange plume and a faint, see-through red fringe that
	// fade out aft, a soft glow at the bell, and shock diamonds down the core (colours kept low: the layers add, and
	// must not clip to white; the Fresnel and length fade above take most of the outer layers away)
	// each layer is a nest of three dim cones: the overlaps add up toward the axis, so the plume has a soft edge
	// instead of one hard, flat silhouette
	const cones = [];
	for ( const [ r, len, c ] of [ [ 0.055, 0.42, [ 0.42, 0.36, 0.2 ] ], [ 0.095, 0.95, [ 0.3, 0.12, 0.02 ] ], [ 0.14, 1.25, [ 0.05, 0.011, 0.002 ] ], [ 0.17, 0.3, [ 0.07, 0.035, 0.01 ] ] ] ) {

		const holder = new Group(), mat = add( c );
		for ( const f of [ 0.4, 0.7, 1 ] ) {

			const L = len * ( 0.65 + 0.35 * f ), m = new Mesh( new CylinderGeometry( 0.003, r * f, L, 14, 1, true ), mat );
			m.position.y = - L / 2; // base at the exit, the tip aft (-Y, turned down the exhaust line)
			m.layers.set( LAYERS.TRANSPARENT );
			m.castShadow = false;
			holder.add( m );

		}

		g.add( holder );
		cones.push( holder );

	}

	// shock diamonds: pairs of cones base to base, spaced down the core, dimmer and smaller aft
	const diamonds = [];
	for ( let i = 0; i < 4; i ++ ) {

		const k = 1 - i * 0.2, r = 0.034 * k, h = 0.07, holder = new Group();
		for ( const sg of [ 1, - 1 ] ) {

			const m = new Mesh( new CylinderGeometry( 0.002, r, h, 10, 1, true ), add( [ 0.42 * k, 0.34 * k, 0.2 * k ] ) );
			m.position.y = sg * h / 2; m.rotation.x = sg > 0 ? 0 : Math.PI; // wide bases meet at the middle
			m.layers.set( LAYERS.TRANSPARENT ); m.castShadow = false;
			holder.add( m );

		}

		holder.position.y = - 0.16 - 0.2 * i;
		g.add( holder ); diamonds.push( holder );

	}

	const sparkMat = add( [ 1.3, 0.62, 0.14 ], false ), sparkGeo = new BoxGeometry( 0.01, 0.01, 0.07 ); // thin hot streaks, not glowing bricks
	const sparks = [];
	for ( let i = 0; i < 40; i ++ ) {

		const m = new Mesh( sparkGeo, sparkMat );
		m.layers.set( LAYERS.TRANSPARENT ); m.visible = false;
		sparks.push( { m, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 } );

	}

	g.visible = false;
	return { g, cones, diamonds, sparks, next: 0 };

}

function findNode( root, name ) {

	let hit = null;
	root.traverse( ( o ) => { if ( ! hit && o.name === name ) hit = o; } );
	return hit;

}

// a node's position in the ski's frame (GripL/R hang under Bars, JetOut under Nozzle)
function localIn( root, node ) {

	const p = node.position.clone();
	for ( let n = node.parent; n && n !== root; n = n.parent ) p.applyQuaternion( n.quaternion ).add( n.position );
	return p;

}

// Placeholder: a stand-up ski built from boxes (white hull, blue deck stripe, black mat, bars on a pole).
function placeholder() {

	const mat = ( c, rough = 0.35, metal = 0 ) => new Material( { name: 'jetski', color: new Color( ...c ), metalness: metal, roughness: rough } );
	const white = mat( [ 0.92, 0.92, 0.9 ] ), blue = mat( [ 0.05, 0.22, 0.75 ] ), yellow = mat( [ 0.98, 0.72, 0.05 ] ), black = mat( [ 0.03, 0.03, 0.035 ], 0.8 ), steel = mat( [ 0.6, 0.6, 0.62 ], 0.3, 1 );
	const root = new Group();
	const box = ( parent, m, [ w, h, d ], [ x, y, z ], rx = 0 ) => {

		const mesh = new Mesh( new BoxGeometry( w, h, d ), m );
		mesh.position.set( x, y, z );
		mesh.rotation.x = rx;
		mesh.castShadow = true;
		mesh.layers.set( LAYERS.OPAQUE );
		parent.add( mesh );
		return mesh;

	};

	const hull = new Group(); hull.name = 'Hull'; root.add( hull );
	box( hull, white, [ 1.04, 0.36, 2.6 ], [ 0, - 0.1, - 0.25 ] );
	box( hull, white, [ 0.84, 0.3, 0.8 ], [ 0, 0.0, 1.3 ], - 0.32 );
	box( hull, yellow, [ 1.06, 0.1, 2.62 ], [ 0, 0.12, - 0.25 ] );
	box( hull, blue, [ 0.86, 0.1, 0.82 ], [ 0, 0.2, 1.24 ], - 0.32 );
	box( hull, black, [ 0.62, 0.05, 1.2 ], [ 0, 0.2, - 0.8 ] );
	box( hull, blue, [ 0.7, 0.32, 0.5 ], [ 0, 0.32, 0.55 ], - 0.25 );
	const pole = box( hull, black, [ 0.1, 0.1, 0.9 ], [ 0, 0.62, 0.35 ], 1.05 );
	pole.name = 'Pole';
	const bars = new Group(); bars.name = 'Bars'; bars.position.set( 0, 0.98, 0.2 ); root.add( bars );
	const bar = new Mesh( new CylinderGeometry( 0.018, 0.018, 0.66, 8 ), steel );
	bar.rotation.z = Math.PI / 2; bar.castShadow = true; bar.layers.set( LAYERS.OPAQUE ); bars.add( bar );
	const nozzle = new Group(); nozzle.name = 'Nozzle'; nozzle.position.set( 0, - 0.14, - 1.55 ); root.add( nozzle );
	const noz = new Mesh( new CylinderGeometry( 0.06, 0.07, 0.2, 10 ), steel );
	noz.rotation.x = Math.PI / 2; noz.layers.set( LAYERS.OPAQUE ); nozzle.add( noz );
	for ( const [ n, p ] of Object.entries( PIVOTS ) ) {

		const g = new Group(); g.name = n; g.position.fromArray( p ); root.add( g );

	}

	return root;

}

export class Jetskis {

	constructor( app ) {

		this.app = app;
		this.skis = [];
		this.live = null; // the ski with the full physics
		this.camMode = 'chase';
		this.shake = 0;
		this.camPos = new THREE.Vector3();
		this.camYaw = 0;
		this.lookYaw = 0; this.lookPitch = 0;
		this.camInit = false;
		this.thrown = null;
		this.placeholder = true;
		this.metrics = { slams: 0, landings: 0, crashes: 0, hits: 0, lastLanding: null };

	}

	async init() {

		const app = this.app;
		const base = import.meta.env.BASE_URL || '/';
		let proto = null, hull = null;
		try {

			const [ model, json, rocket ] = await Promise.all( [
				loadModel( `${ base }models/jetski.glb` ),
				fetch( `${ base }models/jetski.json` ).then( ( r ) => r.ok ? r.json() : null ).catch( () => null ),
				loadModel( `${ base }models/jetski_rocket.glb` ).catch( () => null ), // the rocket pod (tools/jetski/rocket_build.py)
			] );
			this.podProto = rocket ? rocket.root : null;
			proto = model.root;
			hull = json;
			this.placeholder = false;

		} catch ( e ) {

			proto = placeholder();

		}

		const mod = spotModules[ './spots.js' ];
		const spots = ( mod && ( mod.default || mod.SPOTS || mod.spots || Object.values( mod ).find( Array.isArray ) ) ) || DEFAULT_SPOTS;
		const q = app.query;
		const hullSlots = 9; // a 3 x 3 water grid under the ridden ski (see JetskiController)
		const free = 64 - q.count;
		const parkedSlots = Math.max( 0, Math.min( spots.length, free - hullSlots ) );
		this.parkedSlot = parkedSlots > 0 ? q.allocate( 'jetskiParked', parkedSlots ) : - 1;
		this.nParked = parkedSlots;
		this.ctl = new JetskiController( {
			query: q, terrain: app.terrainData, colliders: app.colliders, hull, maxSlots: Math.min( hullSlots, 64 - q.count ),
			vessels: () => this.vesselCapsules(),
			solids: () => this.course?.ready ? this.course.solids : null,
		} );
		for ( let i = 0; i < spots.length; i ++ ) {

			const spot = mod ? { ...spots[ i ] } : this.settle( spots[ i ] ); // the model lane's spots are placed by hand
			const group = i === 0 ? proto : proto.clone( true );
			group.name = 'jetski:' + spot.name;
			if ( this.podProto ) group.add( i === 0 ? this.podProto : this.podProto.clone( true ) ); // the pod stays on every ski
			app.scene.add( group );
			const ski = {
				i, name: spot.name, group, spot,
				position: new THREE.Vector3( spot.x, 0, spot.z ), quaternion: new THREE.Quaternion().setFromAxisAngle( _y, spot.yaw ),
				bars: findNode( group, 'Bars' ), nozzle: findNode( group, 'Nozzle' ), pivots: {},
			};
			for ( const n of Object.keys( PIVOTS ) ) {

				const node = findNode( group, n );
				ski.pivots[ n ] = node ? localIn( group, node ) : new THREE.Vector3().fromArray( PIVOTS[ n ] );

			}

			const ro = findNode( group, 'RocketOut' );
			ski.pivots.RocketOut = ro ? localIn( group, ro ) : new THREE.Vector3().fromArray( ROCKET_OUT );

			ski.barsQ = ski.bars ? ski.bars.quaternion.clone() : null;
			ski.nozzleQ = ski.nozzle ? ski.nozzle.quaternion.clone() : null;
			this.skis.push( ski );

		}

		this.makeLive( this.skis[ 0 ] );
		this.flame = makeFlame();
		app.scene.add( this.flame.g );
		for ( const s of this.flame.sparks ) app.scene.add( s.m );
		this.hud = new JetskiHUD();
		this.course = new JetskiCourse( app, this ); // the buoy course and kicker ramps off the beach (Course.js)
		try { await this.course.init(); } catch ( e ) { console.warn( 'jetski course:', e ); this.course = null; }
		if ( app.wake ) app.wake.ski = this;
		this.mate = new Mate( app, this ); // Emily, the back-seat mate by the hire skis (Mate.js; loads once the rider's clips are in)

	}

	// a nominal spot moved to the nearest water 0.7-2.5 m deep, bow pointing away from the shore
	settle( s ) {

		const t = this.app.terrainData;
		const depth = ( x, z ) => - t.heightAt( x, z );
		let best = null, bd = Infinity;
		for ( let r = 0; r <= 90; r += 3 ) for ( let a = 0; a < 16; a ++ ) {

			const x = s.x + r * Math.cos( a * Math.PI / 8 ), z = s.z + r * Math.sin( a * Math.PI / 8 );
			const d = depth( x, z );
			if ( d < 0.7 || d > 2.5 ) continue;
			if ( r < bd ) { bd = r; best = { x, z }; }

		}

		if ( ! best ) return { ...s };
		const e = 2;
		const gx = t.heightAt( best.x + e, best.z ) - t.heightAt( best.x - e, best.z ), gz = t.heightAt( best.x, best.z + e ) - t.heightAt( best.x, best.z - e );
		const yaw = Math.hypot( gx, gz ) > 0.02 ? Math.atan2( - gx, - gz ) : s.yaw;
		return { name: s.name, x: best.x, z: best.z, yaw };

	}

	vesselCapsules() {

		const out = this._caps || ( this._caps = [ 0, 1, 2 ].map( () => ( { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, top: 0 } ) ) );
		const app = this.app;
		let n = 0;
		const b = app.boatCtl;
		if ( b ) {

			b.toWorld( _v.set( 0, 0, - 3.8 ), out[ n ].a ); b.toWorld( _v.set( 0, 0, 3.9 ), out[ n ].b );
			out[ n ].r = 1.35; out[ n ].top = b.position.y + 2.2; n ++;

		}

		const ship = app.ferry?.ship;
		if ( ship ) for ( const x of [ - 6.7, 6.7 ] ) {

			ship.toWorld( _v.set( x, 0, - 24 ), out[ n ].a ); ship.toWorld( _v.set( x, 0, 21 ), out[ n ].b );
			out[ n ].r = 2.0; out[ n ].top = ship.position.y + 2.6; n ++;

		}

		// (the three cached capsules stay; the list handed out is rebuilt: n of them plus the course's bumpers)
		const all = this._capList || ( this._capList = [] );
		all.length = 0;
		for ( let i = 0; i < n; i ++ ) all.push( out[ i ] );
		// the buoy course: arch legs (hard) and buoys (soft: they give and bob, Course.bumpers)
		const cb = this.course?.ready ? this.course.bumpers( this.ctl.position ) : null;
		if ( cb ) for ( const bp of cb ) all.push( bp );
		return all;

	}

	makeLive( ski ) {

		const c = this.ctl;
		if ( this.live && this.live !== ski ) {

			this.live.position.copy( c.position );
			this.live.quaternion.copy( c.quaternion );

		}

		this.live = ski;
		const e = new THREE.Euler().setFromQuaternion( ski.quaternion, 'YXZ' );
		c.place( ski.position.x, ski.position.y, ski.position.z, e.y );

	}

	get riding() { return this.app.player.mode === 'jetski'; }

	// really in the air: airborne and the hull clear of the sea (a ski sat on the sand in the shallows reads airborne too)
	get aloft() { return this.ctl.airborne && this.ctl.position.y > this.waterLevel() - 0.05; }

	// E prompt on foot / swimming: ride, climb aboard from the stern, or right a capsized ski
	offer( player ) {

		if ( performance.now() - ( this.leftAt || - 1e9 ) < 500 ) return null;
		let best = null, bd = 3.2;
		for ( const s of this.skis ) {

			const p = s === this.live ? this.ctl.position : s.position;
			const d = Math.hypot( p.x - player.position.x, p.z - player.position.z );
			if ( d < bd && Math.abs( p.y - player.position.y ) < 2.5 ) { bd = d; best = s; }

		}

		if ( ! best ) return null;
		if ( best === this.live && this.ctl.capsized ) {

			if ( this.ctl.righting > 0 ) return null;
			return { text: 'Right the jetski', act: () => { this.ctl.righting = 1.4; this.app.audio?.splash?.( 0.7, this.ctl.position ); } };

		}

		return { text: player.mode === 'swim' ? 'Climb aboard jetski' : 'Ride jetski', act: () => this.mount( best ) };

	}

	mount( ski ) {
		if ( this.app.chairlift?.active ) return this.app.chairlift.message( 'Exit the chairlift at a terminal before boarding a jetski.' );

		const app = this.app, p = app.player, c = this.ctl;
		if ( ski !== this.live ) this.makeLive( ski );
		c.driven = true;
		c.engineOn = true;
		c.capsized = false;
		p.mode = 'jetski';
		p.velocity.set( 0, 0, 0 );
		// a throw left unfinished (mounted again before he splashed down) must not keep him drawn in the air in his
		// tumble, with the camera on that spot instead of the ski (rideFrame and camera read this.thrown)
		this.thrown = null;
		this.camInit = false;
		this.restFov ??= app.camera.fov;
		this.hud.show( true );

	}

	dismount() {

		const app = this.app, p = app.player, c = this.ctl;
		this.leftAt = performance.now(); // the same E must not offer the ski straight back this frame
		c.driven = false;
		c.engineOn = false; // the lanyard comes off with him
		const side = _s.set( 1, 0, 0 ).applyQuaternion( c.quaternion ).setY( 0 ).normalize();
		const out = _v.copy( c.position ).addScaledVector( side, 1.1 );
		const water = this.waterLevel();
		const ground = p.groundAt( out.x, out.z, water + 1.5 );
		if ( water - ground < 1.1 ) {

			p.position.set( out.x, Math.max( ground, water - 1.1 ), out.z );
			p.mode = 'walk';

		} else {

			p.waterH = p.waterMean = water;
			p.position.set( out.x, water - 0.2, out.z );
			p.mode = 'swim';
			app.audio?.splash?.( 0.5, p.position );

		}

		p.velocity.set( 0, 0, 0 );
		p.yaw = Math.atan2( side.x, side.z ); // looking back at the ski
		p._camY = null;
		this.leaveView();

	}

	// the sea surface at the live ski (its filtered centre query), not the ski itself: a capsized or
	// nose-dived ski sits below it
	waterLevel() {

		const c = this.ctl;
		return c.hasWater && Number.isFinite( c.waterH[ 4 ] ) ? c.waterH[ 4 ] : c.position.y;

	}

	leaveView() {

		const cam = this.app.camera;
		if ( this.restFov ) { cam.fov = this.restFov; cam.updateProjectionMatrix(); }
		this.hud.show( false );

	}

	// thrown off: flies with the ski's momentum, then swims
	throwRider( kind ) {

		const app = this.app, p = app.player, c = this.ctl;
		this.leftAt = performance.now();
		const seat = c.toWorld( _v.set( 0, 0.9, - 0.3 ), new THREE.Vector3() );
		const vel = c.velocity.clone().multiplyScalar( 0.8 ).add( _w.set( 0, 2.5 + 0.08 * c.speed, 0 ) );
		this.thrown = { pos: seat, vel, spin: new THREE.Quaternion().copy( c.quaternion ), rate: Math.min( 4 + c.speed * 0.3, 12 ), kind, t: 0 };
		// the ragdoll (src/player/Ragdoll.js, docs/third-person.md "Ragdoll") takes him, limbs flailing, and hands
		// him to swim mode once he settles in the sea; the scripted tumble (updateThrown) is the fallback
		if ( ! p.ragdoll( null, null, { velocity: vel } ) ) p.mode = 'jetski-thrown';
		p.prompt = null; // not 'Get off' while he flies
		// and gone now, not faded out over the throw (the prompt's CSS fade would hang it mid-screen as he flies)
		const ui = app.ui?.ui, pe = ui?.promptEl;
		if ( pe ) { pe.style.transition = 'none'; ui.setPrompt( null ); void pe.offsetWidth; pe.style.transition = ''; }
		this.metrics.crashes ++;
		this.mate?.throw(); // the back-seat mate goes too, on her own arc
		this.shake = 1;
		app.ui?.ui?.toast?.( 'Wiped out! Swim back and press E' );

	}

	updateThrown( dt ) {

		const app = this.app, p = app.player, th = this.thrown;
		th.t += dt;
		th.vel.y -= 9.81 * dt;
		th.vel.multiplyScalar( Math.exp( - dt * 0.15 ) );
		th.pos.addScaledVector( th.vel, dt );
		th.spin.premultiply( _q.setFromAxisAngle( _x.set( 1, 0, 0 ).applyQuaternion( th.spin ), th.rate * dt ) );
		const water = this.waterLevel();
		const ground = app.terrainData.heightAt( th.pos.x, th.pos.z );
		p.position.copy( th.pos );
		if ( th.pos.y < ground + 0.3 && ground > water - 1.1 ) {

			p.position.y = ground;
			p.mode = 'walk';

		} else if ( th.pos.y < water ) {

			p.waterH = p.waterMean = water;
			p.position.set( th.pos.x, water - 0.3, th.pos.z );
			p.mode = 'swim';
			this.burst( th.pos, 2.2, 1 );
			app.audio?.splash?.( 1, th.pos );

		}

		if ( p.mode !== 'jetski-thrown' ) {

			p.velocity.set( 0, 0, 0 );
			p._camY = null;
			const cp = this.ctl.position; // facing the ski: his camera sits behind him, clear of it
			p.yaw = Math.hypot( cp.x - p.position.x, cp.z - p.position.z ) > 0.5 ? Math.atan2( cp.x - p.position.x, cp.z - p.position.z ) : this.camYaw + Math.PI;
			this.thrown = null;
			this.leaveView();

		}

	}

	// The hood view rides at his eyes, in the ski's frame and eased: his posed neck (the avatar's anchor joint, this
	// frame's ride frame) plus the eye height above it and a little forward. The cockatoo's first-person perch (out
	// and back from his shoulder, Cockatoo.shoulder) is then behind the lens, as it is walking in first person.
	hoodEye( dt, out ) {

		const c = this.ctl, av = this.app.player?.avatar, m = av?.model, a = av?.anchorNode ?? - 1;
		const h = this._hood || ( this._hood = new THREE.Vector3( 0, 1.55, - 0.55 ) );
		if ( m && a >= 0 ) {

			const W = m.world, rf = this.rideFrame();
			_he.set( W[ a * 16 + 12 ], W[ a * 16 + 13 ] + ( av.eyeAboveNeck || 0.17 ), W[ a * 16 + 14 ] + 0.07 ).applyQuaternion( rf.q ).add( rf.pos )
				.sub( c.position ).applyQuaternion( _hq.copy( c.quaternion ).invert() );
			h.lerp( _he, 1 - Math.exp( - dt * 10 ) );

		}
		return out.copy( h );

	}

	// what the avatar does on the ski (Avatar.update: frame.ride)
	rideFrame() {

		const c = this.ctl;
		const out = this._ride || ( this._ride = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), w: {}, hideHead: false } );
		if ( this.thrown ) {

			out.pos.copy( this.thrown.pos ).addScaledVector( _u.set( 0, 1, 0 ).applyQuaternion( this.thrown.spin ), - 1.0 );
			out.q.copy( this.thrown.spin );
			out.w = { ski_stand: 1 };
			out.hideHead = false;
			return out;

		}

		const ski = this.live;
		if ( c.pushing ) {

			// pushing it off the beach: he stands on the sand at the bow, facing it, and walks it back stern first
			c.toWorld( _v.set( 0, 0, SKI_BOW + 0.42 ), out.pos );
			out.pos.y = Math.max( this.app.terrainData.heightAt( out.pos.x, out.pos.z ), this.waterLevel() - 0.9 );
			_w.set( 0, 0, 1 ).applyQuaternion( c.quaternion );
			out.q.setFromAxisAngle( _y, Math.atan2( - _w.x, - _w.z ) );
			out.w = { walk: 1 };
			out.walkRate = THREE.MathUtils.clamp( Math.hypot( c.velocity.x, c.velocity.z ) / 1.4, 0.2, 1 );
			out.hideHead = false;
			return out;

		}
		const seat = _v.copy( ski.pivots.Seat ).sub( _w.fromArray( RIDER_PELVIS ) );
		c.toWorld( seat, out.pos );
		// his body leans into the turn and forward on a tuck (about his feet)
		_q.setFromAxisAngle( _z, - c.leanLat * 14 * DEG ); // (more and his hands leave the grips: the ski's bank carries the rest)
		_q2.setFromAxisAngle( _x, c.leanFwd * 12 * DEG );
		out.q.copy( c.quaternion ).multiply( _q ).multiply( _q2 );
		const tuck = Math.max( c.leanFwd, 0.6 * c.boostLevel ), air = this.aloft ? 1 : 0; // (he tucks behind the bars on the rocket)
		const lean = c.leanLat;
		out.w = {
			ski_sit: Math.max( 0.001, 1 - tuck - Math.abs( lean ) - air ),
			ski_lean_l: Math.max( 0, lean ) * ( 1 - air ), ski_lean_r: Math.max( 0, - lean ) * ( 1 - air ),
			ski_tuck: tuck * ( 1 - air ), ski_stand: air,
		};
		out.hideHead = this.camMode === 'hood';
		out.walkRate = 1;
		return out;

	}

	audioState() {

		const c = this.ctl;
		if ( ! c ) return null;
		const s = this._as || ( this._as = {} );
		s.on = c.engineOn; s.rpm = c.rev; s.speed = c.speed; s.air = c.airborne; s.boost = c.boostLevel;
		s.x = c.position.x; s.y = c.position.y; s.z = c.position.z;
		return s;

	}

	update( dt ) {

		const app = this.app, p = app.player, c = this.ctl;
		if ( ! c ) return;
		const inp = app.input;
		const riding = p.mode === 'jetski' && ! app.freeCam;
		if ( riding ) {

			const pad = app.rally?.gamepad?.();
			let steer = ( inp.down( 'KeyA' ) ? 1 : 0 ) - ( inp.down( 'KeyD' ) ? 1 : 0 );
			let throttle = inp.down( 'KeyW' ) ? 1 : 0, brake = inp.down( 'KeyS' ) ? 1 : 0;
			if ( pad ) {

				if ( Math.abs( pad.steer ) > 0.05 ) steer = - pad.steer;
				throttle = Math.max( throttle, pad.throttle );
				brake = Math.max( brake, pad.brake );

			}

			const tuck = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 1 : 0;
			const back = inp.down( 'Space' ) ? 1 : 0;
			c.setInput( { throttle, brake, steer, tuck, back, pop: inp.hit( 'Space' ), boost: inp.down( 'KeyX' ) ? 1 : 0 } );
			if ( inp.hit( 'KeyC' ) ) this.camMode = this.camMode === 'chase' ? 'hood' : 'chase';
			if ( inp.hit( 'KeyE' ) ) this.dismount();
			else if ( inp.hit( 'KeyG' ) ) this.mate?.key(); // pick up or drop off the back-seat mate

		} else c.setInput( { throttle: 0, brake: 0, steer: 0, tuck: 0, back: 0, pop: false, boost: 0 } );

		c.wakeComp = app.wake && ! app.wake.sleeping ? app.wake.uAmount.value : 0;
		c.update( dt );
		c.queueQueries();
		this.handleEvents();

		// the live ski's pose, bars and nozzle
		const ski = this.live;
		ski.group.position.copy( c.position );
		ski.group.quaternion.copy( c.quaternion );
		ski.position.copy( c.position );
		ski.quaternion.copy( c.quaternion );
		if ( ski.bars ) ski.bars.quaternion.copy( ski.barsQ ).multiply( _q.setFromAxisAngle( _y, c.steer * 25 * DEG ) );
		if ( ski.nozzle ) ski.nozzle.quaternion.copy( ski.nozzleQ ).multiply( _q.setFromAxisAngle( _y, - c.steer * 20 * DEG ) );
		ski.group.updateMatrixWorld( true );
		// its lamps from dusk while he rides it (or has just been thrown off it)
		this.lamps ??= new JetskiLights( app.localLights, app.waterMaterial );
		this.lamps.update( ski, p.mode === 'jetski' || p.mode === 'jetski-thrown', app.camera );
		this.parked( dt );
		this.spray( dt );
		this.rocketFx( dt );

		if ( p.mode === 'jetski-thrown' && this.thrown ) this.updateThrown( dt );
		if ( p.mode === 'jetski' ) {

			// keep the walker with the ski (audio, queries, what he sees when he gets off)
			c.toWorld( _v.copy( ski.pivots.FootL ).add( ski.pivots.FootR ).multiplyScalar( 0.5 ), p.position );
			p.prompt = c.beached ? { key: 'S', text: 'Push off   ·   E  Get off' } : this.mate?.prompt() || { key: 'E', text: 'Get off   ·   C  camera' };

		}

		this.mate?.update( dt ); // every frame: she sits right in front of the camera

		if ( ( p.mode === 'jetski' || p.mode === 'jetski-thrown' ) && ! app.freeCam ) this.camera( dt );
		// the spray thins between the chase camera and her (Spray.setFocus): she always reads through her own
		// plume and the rocket's fan, at any speed; side-on and wide views keep all of it
		if ( app.spray && app.spray.setFocus ) {

			if ( p.mode === 'jetski' && ! app.freeCam && this.camMode === 'chase' && ! this.thrown ) app.spray.setFocus( _v.copy( c.position ).setY( c.position.y + 0.95 ), 1.4 );
			else app.spray.setFocus( null );

		}
		this.hud.update( c, p.mode === 'jetski' && ! app.freeCam ); // the free camera shows no ski HUD
		this.course?.update( dt );

	}

	handleEvents() {

		const c = this.ctl, app = this.app, m = this.metrics;
		let slam = 0, slamZ = 0;
		for ( const e of c.events ) {

			this.mate?.event( e );
			if ( e.type === 'slam' && e.vn > slam ) { slam = e.vn; slamZ = e.z; }
			else if ( e.type === 'land' ) {

				m.landings ++;
				m.lastLanding = { air: + e.air.toFixed( 2 ), height: + e.height.toFixed( 2 ), vn: + e.vn.toFixed( 2 ), pitch: + ( e.pitch / DEG ).toFixed( 1 ), speedBefore: + ( e.speedBefore * 3.6 ).toFixed( 1 ), speedAfter: + ( e.speed * 3.6 ).toFixed( 1 ) };
				const k = clamp( e.vn / 6, 0.3, 1.5 ) * ( e.noseIn ? 1.4 : 1 );
				this.burst( e.noseIn ? c.toWorld( _v.set( 0, 0, 1.3 ), _w ) : c.position, k * 1.6, k );
				this.shake = Math.max( this.shake, 0.3 * k );
				app.audio?.splash?.( clamp( 0.45 + e.vn / 10, 0, 1 ), c.position );
				app.audio?.jetskiSlap?.( clamp( e.vn / 8, 0, 1 ) );

			} else if ( e.type === 'hit' ) {

				m.hits ++;
				this.shake = Math.max( this.shake, clamp( e.v / 8, 0.2, 1 ) );
				app.audio?.jetskiSlap?.( clamp( e.v / 8, 0, 1 ) );
				if ( e.what === 'solid' && e.v > 9 && c.driven ) c.crash( 'impact', e.v / 10 );

			} else if ( e.type === 'ignite' ) {

				m.ignitions = ( m.ignitions || 0 ) + 1;
				this.shake = Math.max( this.shake, 0.7 ); // the kick: a camera jolt and an FOV punch
				this.kick = 1;

			} else if ( e.type === 'flameout' ) {

				m.flameouts = ( m.flameouts || 0 ) + 1;
				this.puff();
				this.shake = Math.max( this.shake, 0.25 );

			} else if ( e.type === 'crash' ) {

				m.lastCrash = { kind: e.kind, strength: + ( e.strength || 0 ).toFixed( 2 ), kmh: + ( c.speed * 3.6 ).toFixed( 1 ) };
				if ( app.player.mode === 'jetski' ) this.throwRider( e.kind );

			}

		}

		c.events.length = 0;
		if ( slam > 2.2 ) {

			m.slams ++;
			const k = clamp( ( slam - 2 ) / 5, 0, 1 );
			this.burst( c.toWorld( _v.set( 0, 0, clamp( slamZ, - 1, 1.4 ) ), _w ), 0.6 + k, k * 0.6 );
			this.shake = Math.max( this.shake, 0.15 * k );
			if ( ( this._slapT = ( this._slapT || 0 ) - 1 ) <= 0 ) { app.audio?.jetskiSlap?.( 0.3 + 0.7 * k ); this._slapT = 6; }

		} else this._slapT = Math.max( 0, ( this._slapT || 0 ) - 1 );

	}

	// a splash thrown up around a point (landings, slams, him hitting the water)
	burst( at, size, k ) {

		const sp = this.app.spray;
		if ( ! sp ) return;
		const v = this.ctl.velocity;
		// a crown: two sheets thrown out sideways and a short white burst, not a column (the chase camera
		// sits a few metres behind: a tall burst hides the ski)
		_u.copy( at ); _u.y = this.ctl.position.y + 0.05;
		_s.set( 1, 0, 0 ).applyQuaternion( this.ctl.quaternion ).setY( 0 ).normalize();
		_opts.jitter = 0.25 * size; _opts.to = null;
		for ( const sg of [ 1, - 1 ] ) {

			_f.copy( v ).multiplyScalar( 0.55 ).addScaledVector( _s, sg * ( 2.2 + 3 * k ) ); _f.y = 1.4 + 2.2 * k;
			_opts.spread = 0.6 + 0.8 * k; _opts.life = 0.9;
			sp.emit( _u, _f, 30 + 70 * k, 0.14 + 0.05 * k, SPRAY.SHEET, _opts );
			_opts.life = 1.2;
			sp.emit( _u, _f, 80 + 180 * k, 0.006, SPRAY.DROPLET, _opts );

		}

		// (fewer, smaller clouds thrown wider, and more drops: a burst of torn water, not white puffs sitting
		// along the hull; the mist is a thin veil spread over the splash, not a ball of cotton wool)
		_f.set( v.x * 0.5, 1.6 + 2.4 * k, v.z * 0.5 );
		_opts.spread = 1.3 + 1.6 * k; _opts.life = 0.9;
		sp.emit( _u, _f, 24 + 70 * k, 0.06 + 0.025 * k, SPRAY.SPRAY, _opts );
		_opts.spread = 2.4 + 2 * k; _opts.life = 1.0;
		sp.emit( _u, _f, 120 + 260 * k, 0.005, SPRAY.DROPLET, _opts );
		_opts.spread = 1.6; _opts.life = 1.4; _opts.jitter = 0.6 * size;
		sp.emit( _u, _f.multiplyScalar( 0.4 ), 4 + 9 * k, 0.2 + 0.08 * k, SPRAY.MIST, _opts );

	}

	// the rooster tail (the jet hitting the water behind), chine sheets (outside of a carve), wash
	spray( dt ) {

		const sp = this.app.spray, c = this.ctl, ski = this.live;
		if ( ! sp || c.speed < 1 ) return;
		this._segF = ( this._segF || 0 ) + 1;
		const v = c.velocity, sp1 = c.speed;
		const fwd = _f.set( 0, 0, 1 ).applyQuaternion( c.quaternion );
		const side = _s.set( 1, 0, 0 ).applyQuaternion( c.quaternion );
		_opts.sizeJitter = 0.6;
		// rooster tail: grows with thrust and speed, only with the jet in the water
		// (the rocket keeps it going where the jet runs out of pump: the hull is flying on the water)
		const k = clamp( c.thrust / 1800, 0, 1.3 ) * c.prime * sstep( sp1, 3, 14 );
		if ( k > 0.02 ) {

			// the jet leaves the transom at about half its own speed relative to the ski, tipped up off the
			// water: in the world it nearly hangs still at speed, so the ski draws it out into a long, low arc
			// behind it (peak ~1.7 m some 15 m back), well under the chase camera
			c.toWorld( _v.copy( ski.pivots.JetOut ), _u );
			_u.addScaledVector( fwd, - 0.25 - 0.02 * sp1 );
			_u.y = c.position.y + 0.02;
			const rel = 6 + 0.45 * 58 * c.rpm, kk = Math.min( k, 1 );
			_w.copy( v ).addScaledVector( fwd, - rel );
			_w.y = 2.4 + 3.4 * kk;
			_opts.spread = 0.3 + 0.012 * sp1; _opts.jitter = 0.22; _opts.life = 1.0; _opts.to = this.segFrom( 'jet', _u ); // (ragged, not a painted stripe)
			sp.emit( _u, _w, dt * 520 * k, 0.07 + 0.0015 * sp1, SPRAY.SPRAY, _opts );
			// (under the rocket its own plume carries the water: fewer drops here, room in the ring for it)
			sp.emit( _u, _w, dt * 900 * k * ( 1 - 0.6 * c.boostLevel ), 0.005, SPRAY.DROPLET, _opts );
			_opts.life = 1.6; _opts.spread = 0.5;
			_w.y *= 0.5;
			sp.emit( _u, _w, dt * 28 * k, 0.2, SPRAY.MIST, _opts );

		} else this.segFrom( 'jet', null );

		// the rocket blasting the water behind her: a rooster tail the height of a house. Each parcel of it
		// leaves the water nearly still in the world and climbs straight up where she was, so from the side it
		// is a long arc climbing behind her (steep off the transom, ~10 m high some 1.3 s of travel back) that
		// hangs as a veil of mist and rains back down as drops. From the chase camera it is a fan of white
		// water climbing out from under the bell either side of the view.
		// She is airborne 30 to 68 % of a burn, skipping crest to crest, so the blast still reaches the water
		// from a few metres up: it holds 1.3 s after she leaves the water, then fades over ~0.8 s, and the
		// plume builds up over ~0.6 s of burn (and sags over ~1.5 s) instead of collapsing on every hop.
		const water = this.waterLevel(), hUp = c.position.y - water;
		if ( c.wetFraction > 0.02 || hUp < 1.5 ) this._rtHold = 1.3; else this._rtHold = Math.max( 0, ( this._rtHold || 0 ) - dt );
		this._rtWet = this._rtHold > 0 ? 1 : ( this._rtWet || 0 ) * Math.exp( - dt / 0.8 );
		const blast = this._rtWet * sstep( - hUp, - 7, - 2 ); // (the bell's blast weakens with height over the water)
		const rtTarget = c.boostLevel * blast * sstep( sp1, 4, 20 );
		this._rtBuild = ( this._rtBuild || 0 ) + ( rtTarget - ( this._rtBuild || 0 ) ) * ( 1 - Math.exp( - dt / ( rtTarget > ( this._rtBuild || 0 ) ? 0.6 : 1.5 ) ) );
		const kr = this._rtBuild;
		if ( kr > 0.02 ) {

			c.toWorld( _v.copy( ski.pivots.JetOut ), _u );
			_u.addScaledVector( fwd, - 0.6 );
			_u.y = Math.min( c.position.y, water ) + 0.05; // (on the water under her, also from the air)
			// (a crawling ski throws no rooster tail, whatever the build: the plume scales with speed at once)
			const sf = sstep( sp1, 8, 30 ), kq = kr * sf, to = this.segFrom( 'rt', _u ), wy = ( 9 + 8 * kr ) * ( 0.5 + 0.5 * sf ); // ~10 m peak built up
			// carried along at ~0.3 of her speed (the stern wave she drags): steep off the transom, not a flat arc
			// (0.55: at 150 km/h a parcel carried at 0.3 of her speed shot past the chase camera, 9 m back, in 0.28 s,
			// before it had even faded in; at 0.55 the fan stands up behind her, and is over the camera by ~0.4 s)
			const carry = 0.3 + 0.25 * sstep( sp1, 25, 42 ); // (slower, it stays 0.3: the plume would wall off the chase view)
			_opts.jitter = 0.3; _opts.to = to;
			// the root: a glassy sheet of water torn up off the surface, turning white as it climbs
			_w.copy( v ).multiplyScalar( carry ).addScaledVector( fwd, - 2 ); _w.y = wy * 0.75;
			_opts.spread = 1.2; _opts.life = 0.5;
			sp.emit( _u, _w, dt * 160 * kq, 0.3, SPRAY.SHEET, _opts );
			// the fan: a core thrown straight up and two wings thrown out and a little lower, white water that
			// breaks into clumps and drops as it climbs (dense spray) and drops that rain back down
			// Past ~130 km/h the wings are thrown out harder with her speed (a fixed 6.5 m/s against 38 m/s of carry
			// was a narrow white jet from the chase camera), and a lower outer pair opens the fan either side of her.
			const fan = sstep( sp1, 35, 70 ), wing = 3.5 + 3 * kr + 0.22 * Math.max( 0, sp1 - 30 ) * fan;
			for ( const [ lat, up, n ] of [ [ 0, 1, 300 ], [ 1, 0.8 - 0.15 * fan, 210 ], [ - 1, 0.8 - 0.15 * fan, 210 ], [ 1.7, 0.45, 150 * fan ], [ - 1.7, 0.45, 150 * fan ] ] ) {

				if ( n <= 0 ) continue;
				_w.copy( v ).multiplyScalar( carry ).addScaledVector( fwd, - 2 ).addScaledVector( side, lat * wing );
				_w.y = wy * up;
				_opts.spread = 2.2; _opts.life = 2.4;
				sp.emit( _u, _w, dt * n * kq, 0.2 + 0.15 * kr, SPRAY.SPRAY, _opts );
				if ( lat ) continue;
				// (one request for all the drops: the spray takes 32 requests a frame, shared with every emitter)
				_opts.spread = 4.0; _opts.life = 3.4;
				sp.emit( _u, _w, dt * 640 * kq, 0.006, SPRAY.DROPLET, _opts );

			}

			// the veil it leaves hanging: mist up the column where the plume will stand (it fades in over ~1 s,
			// by when the water thrown up here has climbed and been carried on ~0.3 s of her travel)
			// (laid along the path she covered since the last frame, not a column a frame: at 200 km/h that was a row
			// of separate puffs 1 to 3 m apart; the column's height is in the jitter)
			_v.copy( _u ).addScaledVector( fwd, carry * sp1 ); _v.y += 2 + 2.5 * kr;
			_opts.to = this.segFrom( 'rtv', _v );
			_w.set( v.x * 0.05, 1.0, v.z * 0.05 );
			// (thinner and wider than it was: 80 a second stood over the course like a bank of cloud for 5 s)
			_opts.spread = 1.5; _opts.life = 4.0; _opts.jitter = 1.6 + 1.4 * kr;
			sp.emit( _v, _w, dt * 45 * kq, 0.8 + 0.4 * kr, SPRAY.MIST, _opts );

		} else { this.segFrom( 'rt', null ); this.segFrom( 'rtv', null ); }

		// chine sheets, harder on the outside of the turn
		const r = c.yawRate;
		for ( const sg of [ 1, - 1 ] ) {

			const piv = sg > 0 ? ski.pivots.SprayL : ski.pivots.SprayR, key = sg > 0 ? 'cL' : 'cR';
			c.toWorld( piv, _u );
			if ( _u.y > c.position.y + 0.15 || sp1 < 4 || c.wetFraction < 0.05 ) { this.segFrom( key, null ); continue; }
			const out = 1 + 2.2 * clamp( - sg * r * 1.2, 0, 1 ) - 0.6 * clamp( sg * r * 1.2, 0, 1 );
			const a = sstep( sp1, 4, 22 ) * out * ( 1 + 1.5 * c.boostLevel ); // (lit: long spray streaks off the chines)
			_u.y = c.position.y + 0.02;
			_w.copy( v ).multiplyScalar( 0.75 ).addScaledVector( side, sg * ( 1.2 + 0.14 * sp1 ) * out );
			_w.y = 0.8 + 0.1 * sp1 * Math.min( out, 1.8 );
			_opts.spread = 0.4 + 0.02 * sp1; _opts.jitter = 0.12; _opts.life = 0.55; _opts.to = this.segFrom( key, _u );
			sp.emit( _u, _w, dt * 110 * a, 0.12 + 0.004 * sp1, SPRAY.SHEET, _opts );
			// the sheet tears into drops (capped: at rocket speed they would fill the spray ring) and a mist
			_opts.life = 0.9 + 0.4 * c.boostLevel;
			sp.emit( _u, _w, dt * 500 * Math.min( a, 1.4 ), 0.005, SPRAY.DROPLET, _opts );
			_opts.life = 1.8; _opts.spread = 0.8;
			_w.multiplyScalar( 0.5 );
			sp.emit( _u, _w, dt * 14 * Math.min( a, 2 ), 0.3 + 0.004 * sp1, SPRAY.MIST, _opts );

		}

		_opts.to = null; _opts.sizeJitter = 0.5;

	}

	// the start of the path an emitter covered since the last frame, or null (a ski at 60 m/s moves a metre
	// a frame: one burst per frame drew her spray as rows of separate strokes). at null: the emitter is off.
	segFrom( key, at ) {

		const P = this._segP || ( this._segP = {} );
		let e = P[ key ];
		if ( ! at ) { if ( e ) e.f = - 1; return null; }
		if ( ! e ) e = P[ key ] = { p: new THREE.Vector3(), f: - 1, q: new THREE.Vector3() };
		const ok = e.f === this._segF - 1 && e.p.distanceToSquared( at ) < 64;
		e.q.copy( e.p ); e.p.copy( at ); e.f = this._segF;
		return ok ? e.q : null;

	}

	// the rocket: flame cones flickering at the bell exit (aimed down the exhaust line), sparks, a smoke trail
	rocketFx( dt ) {

		const F = this.flame, c = this.ctl, ski = this.live;
		if ( ! F ) return;
		const b = c.boostLevel;
		// exhaust: from the centre of gravity out through the bell (the thrust line), in the ski frame
		_v.copy( ski.pivots.RocketOut ).sub( c.com ); _v.x = 0; _v.normalize();
		F.g.visible = b > 0.03;
		if ( F.g.visible ) {

			c.toWorld( ski.pivots.RocketOut, F.g.position );
			F.g.quaternion.copy( c.quaternion ).multiply( _q.setFromUnitVectors( _w.set( 0, - 1, 0 ), _v ) );
			// flicker: each layer breathes in length and width every frame, the plume more than the core
			for ( let i = 0; i < F.cones.length; i ++ ) {

				const fl = 1 + ( 0.12 + 0.14 * i ) * ( Math.random() * 2 - 1 ), wd = b * ( 0.88 + 0.24 * Math.random() );
				F.cones[ i ].scale.set( wd, b * fl, wd );

			}

			const sd = 0.92 + 0.16 * Math.random(); // the diamonds hold station, flickering in size
			for ( let i = 0; i < F.diamonds.length; i ++ ) {

				const d = F.diamonds[ i ], on = b * ( 0.7 + 0.5 * Math.random() );
				d.position.y = ( - 0.16 - 0.2 * i ) * sd * b;
				d.scale.set( on, on, on );

			}

			F.g.updateMatrixWorld( true );

		}

		// sparks: shot down the exhaust, falling
		const ex = _s.copy( _v ).applyQuaternion( c.quaternion );
		if ( b > 0.3 ) for ( let n = Math.random() < dt * 60 ? 2 : 0; n > 0; n -- ) {

			const s = F.sparks[ F.next = ( F.next + 1 ) % F.sparks.length ];
			c.toWorld( ski.pivots.RocketOut, s.p );
			s.v.copy( c.velocity ).addScaledVector( ex, 14 + 10 * Math.random() ).add( _u.set( Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5 ).multiplyScalar( 5 ) );
			s.life = 0.35 + 0.35 * Math.random();

		}

		for ( const s of F.sparks ) {

			if ( s.life <= 0 ) { if ( s.m.visible ) s.m.visible = false; continue; }
			s.life -= dt;
			s.v.y -= 9.81 * dt;
			s.p.addScaledVector( s.v, dt );
			s.m.visible = s.life > 0;
			s.m.position.copy( s.p );
			s.m.quaternion.setFromUnitVectors( _z, _u.copy( s.v ).normalize() );
			s.m.updateMatrixWorld( true );

		}

		// the smoke trail: thick white exhaust left hanging in the air behind her
		const sp = this.app.spray;
		if ( sp && b > 0.05 ) {

			c.toWorld( ski.pivots.RocketOut, _u ).addScaledVector( ex, 0.5 );
			_f.copy( c.velocity ).multiplyScalar( 0.15 ).addScaledVector( ex, 6 ); _f.y += 1.2;
			_opts.spread = 1.2; _opts.jitter = 0.3; _opts.life = 3.2; _opts.to = null;
			sp.emit( _u, _f, dt * 70 * b, 0.45 + 0.25 * b, SPRAY.MIST, _opts );
			_opts.life = 1.2; _opts.spread = 0.8;
			sp.emit( _u, _f, dt * 60 * b, 0.12, SPRAY.SPRAY, _opts );

		}

	}

	// the flameout: a dirty puff out of the bell as the fuel runs dry
	puff() {

		const sp = this.app.spray, c = this.ctl;
		if ( ! sp ) return;
		c.toWorld( this.live.pivots.RocketOut, _u );
		_f.copy( c.velocity ).multiplyScalar( 0.4 ); _f.y += 1.5;
		_opts.spread = 2.2; _opts.jitter = 0.4; _opts.life = 2.6; _opts.to = null;
		sp.emit( _u, _f, 60, 0.7, SPRAY.MIST, _opts );
		_opts.life = 1.0; _opts.spread = 3;
		sp.emit( _u, _f, 80, 0.14, SPRAY.SPRAY, _opts );

	}

	// parked skis bob on the swell (one query each: height + slope)
	parked( dt ) {

		const q = this.app.query;
		let j = 0;
		for ( const s of this.skis ) {

			if ( s === this.live ) continue;
			const k = this.parkedSlot >= 0 && j < this.nParked ? this.parkedSlot + j : - 1;
			j ++;
			if ( k >= 0 ) {

				q.setPoint( k, s.position.x, s.position.z );
				if ( q.cpuValid && Math.abs( q.resultInputs[ k * 4 ] - s.position.x ) + Math.abs( q.resultInputs[ k * 4 + 1 ] - s.position.z ) < 1 ) {

					const h = q.cpu[ k * 4 ], nx = q.cpu[ k * 4 + 1 ], nz = q.cpu[ k * 4 + 2 ];
					if ( Number.isFinite( h ) ) s.position.y += ( h - 0.02 - s.position.y ) * ( 1 - Math.exp( - dt * 4 ) );
					const yaw = new THREE.Euler().setFromQuaternion( s.quaternion, 'YXZ' ).y;
					if ( Number.isFinite( nx ) && Number.isFinite( nz ) ) {

						_q.setFromAxisAngle( _y, yaw );
						_q2.setFromUnitVectors( _y, _v.set( nx * 0.6, 1, nz * 0.6 ).normalize() );
						s.quaternion.slerp( _q.premultiply( _q2 ), 1 - Math.exp( - dt * 3 ) );

					}

				}

			} else s.position.y = 0.025 * Math.sin( performance.now() / 1000 * 1.2 + s.i * 1.7 ) - 0.02; // no query slot: a cheap analytic bob

			s.group.position.copy( s.position );
			s.group.quaternion.copy( s.quaternion );

		}

	}

	camera( dt ) {

		const app = this.app, cam = app.camera, c = this.ctl, inp = app.input;
		const look = inp.consumeLook();
		inp.consumeWheel?.();
		this.shake *= Math.exp( - dt * 5 );
		const yawSki = c.getYaw();
		if ( ! this.camInit ) { this.camYaw = yawSki; this.lookYaw = 0; this.lookPitch = 0; }
		// the camera swings after the ski's heading (lag on yaw), the mouse looks around for a while
		let d = yawSki - this.camYaw;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		this.camYaw += d * ( 1 - Math.exp( - dt / 0.32 ) );
		this.lookYaw = this.lookYaw - look.x * 0.003;
		this.lookPitch = clamp( this.lookPitch + look.y * 0.002, - 0.3, 0.6 );
		if ( Math.abs( look.x ) + Math.abs( look.y ) < 0.5 ) { this.lookYaw *= Math.exp( - dt / 1.2 ); this.lookPitch *= Math.exp( - dt / 1.2 ); }
		const sp = c.speed;
		const water = this.waterLevel();
		const target = this.thrown ? _u.copy( this.thrown.pos ) : _u.copy( c.position ).add( _w.set( 0, 0.95, 0 ) );
		if ( this.camMode === 'hood' && ! this.thrown && ! c.pushing ) {

			const eye = c.toWorld( this.hoodEye( dt, _v ), _w );
			const f = _f.set( 0, 0, 1 ).applyQuaternion( c.quaternion );
			const flat = _s.set( f.x, 0, f.z ).normalize();
			f.lerp( flat, 0.55 ).normalize();
			cam.position.copy( eye );
			cam.lookAt( _v.copy( eye ).addScaledVector( f, 10 ) );
			cam.quaternion.multiply( _q.setFromAxisAngle( _z, c.bank * 0.45 ) );

		} else {

			const yaw = this.camYaw + this.lookYaw;
			const bk = c.boostLevel;
			// two-up the camera rides a little higher, so the mate on the back seat does not hide the rider
			const two = this.mate?.mode === 'aboard' && this.mate.ski === this.live ? 0.35 : 0;
			const dist = 4.6 + 0.06 * sp + 1.6 * bk, height = 1.55 + two + 0.048 * sp + 0.5 * bk + ( c.airborne ? 0.4 : 0 ) + this.lookPitch * dist;
			const want = _v.set( target.x - Math.sin( yaw ) * dist, target.y + height, target.z - Math.cos( yaw ) * dist );
			want.y = Math.max( want.y, water + 0.6 );
			if ( ! this.camInit ) this.camPos.copy( want );
			// feed the ski's own motion forward past 22 m/s: the lag is a pull-back up to there, not 8 m at 250 km/h
			this.camPos.addScaledVector( c.velocity, dt * sstep( sp, 22, 40 ) );
			const kh = 1 - Math.exp( - dt * 9 ), kv = 1 - Math.exp( - dt * 4 );
			this.camPos.x += ( want.x - this.camPos.x ) * kh;
			this.camPos.z += ( want.z - this.camPos.z ) * kh;
			this.camPos.y += ( want.y - this.camPos.y ) * kv;
			this.camPos.y = Math.max( this.camPos.y, water + 0.45, app.terrainData.heightAt( this.camPos.x, this.camPos.z ) + 0.7 ); // never under the land
			if ( app.colliders ) { _s.copy( this.camPos ); _s.y -= 0.3; if ( app.colliders.resolveCapsule( _s, 0.35, 0.6, 0 ) ) { this.camPos.x = _s.x; this.camPos.z = _s.z; } } // nor inside a pile or a wall
			cam.position.copy( this.camPos );
			const aim = _w.copy( target ).add( _s.set( Math.sin( yaw ), 0, Math.cos( yaw ) ).multiplyScalar( 3 ) );
			cam.lookAt( aim );
			// horizon level-ish: a touch of the ski's bank
			cam.quaternion.multiply( _q.setFromAxisAngle( _z, c.bank * 0.12 ) );

		}

		this.shake = Math.max( this.shake, 0.09 * c.boostLevel ); // the rocket shakes the whole ride
		this.kick = ( this.kick || 0 ) * Math.exp( - dt * 4 );
		if ( this.shake > 0.01 ) cam.position.add( _v.set( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).multiplyScalar( this.shake * 0.22 ) );
		this.camInit = true;
		const base = this.restFov || cam.fov;
		cam.fov = base + 14 * sstep( sp, 6, 30 ) + 6 * c.boostLevel + 6 * this.kick;
		cam.updateProjectionMatrix();
		this.keepCamFinite();

	}

	// A non-finite pose (a NaN in the ski's state or in camPos, which the chase eases from and so would keep
	// for good) never reaches the renderer: a NaN frame renders black, and the temporal upscaler's history
	// keeps it (white sea, black trees, speckled clouds). Back to the last good pose, the chase set up again
	// next frame, the history dropped.
	keepCamFinite() {

		const cam = this.app.camera, P = cam.position, Q = cam.quaternion, C = this.camPos;
		const g = this._camGood ??= { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: cam.fov, ok: false };
		if ( Number.isFinite( P.x + P.y + P.z + Q.x + Q.y + Q.z + Q.w + cam.fov + C.x + C.y + C.z ) ) {

			g.p.copy( P ); g.q.copy( Q ); g.fov = cam.fov; g.ok = true;
			return true;

		}
		if ( ! this._camNanWarned ) {

			this._camNanWarned = true;
			console.warn( 'Jetski camera: non-finite pose, set up again', { ski: this.ctl.position.toArray(), camPos: C.toArray() } );

		}
		if ( g.ok ) { P.copy( g.p ); Q.copy( g.q ); cam.fov = g.fov; cam.updateProjectionMatrix(); C.copy( g.p ); }
		this.camInit = false;
		this.shake = 0; this.kick = 0; this.lookYaw = 0; this.lookPitch = 0;
		this.app.cameraCut?.();
		return false;

	}

	state() {

		return { ...this.ctl.telemetry(), mode: this.app.player.mode, camMode: this.camMode, live: this.live?.name, placeholder: this.placeholder,
			spots: this.skis.map( ( s ) => ( { name: s.name, x: + s.spot.x.toFixed( 1 ), z: + s.spot.z.toFixed( 1 ), yaw: + s.spot.yaw.toFixed( 2 ) } ) ),
			slots: { hull: this.ctl.qpts.length, panels: this.ctl.samples.length, hullSource: this.ctl.hullSource, areaScale: + this.ctl.areaScale.toFixed( 2 ), parked: this.nParked, used: this.app.query.count }, metrics: this.metrics, mate: this.mate?.state() || null, wakeHead: + skiWakeHead( this.ctl.speed ).toFixed( 3 ), course: this.course?.state() || null };

	}

}

// Speed / RPM / throttle readout (bottom centre, in the HUD's glass style) and the key hints.
class JetskiHUD {

	build() {

		const style = document.createElement( 'style' );
		style.textContent = `
.jh { position: fixed; left: 50%; width: max-content; max-width: calc(100vw - 32px); bottom: var(--tw-edge, 18px); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 20; color: var(--tw-ink, #eef6fa); font: 500 12px/1.3 var(--tw-font, system-ui, sans-serif); }
.jh[hidden] { display: none; }
.jh-panel { display: grid; grid-template-columns: auto 170px; align-items: center; column-gap: 16px; row-gap: 4px; padding: 8px 16px; border-radius: var(--tw-r-lg, 14px); }
.jh-speed { grid-row: span 3; display: flex; align-items: baseline; gap: 4px; min-width: 92px; justify-content: flex-end; }
.jh-speed b { font: 600 34px/1 var(--tw-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.jh-speed span, .jh-label { color: var(--tw-ink-2, rgba(230,240,245,0.7)); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.jh-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; }
.jh-bar { height: 6px; border-radius: 3px; background: rgba(170, 215, 235, 0.16); overflow: hidden; }
.jh-bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, #3fc0d6, #5fe3d4 62%, #ffb86b); }
.jh-bar.jh-thr i { background: #9fd8ff; }
.jh-bar.jh-fuel i { background: linear-gradient(90deg, #ff6a3d, #ffb454); }
.jh-bar.jh-fuel.lit i { background: linear-gradient(90deg, #ff8a3d, #ffe08a); box-shadow: 0 0 8px rgba(255, 170, 80, 0.8); }
.jh-keys { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; padding: 5px 12px; border-radius: 10px; font-size: 11px; color: var(--tw-ink-2, rgba(230,240,245,0.75)); background: rgba(6, 16, 24, 0.62); }
.jh-keys kbd { display: inline-block; min-width: 16px; margin-right: 4px; padding: 1px 4px; border: 1px solid rgba(200, 230, 240, 0.35); border-bottom-width: 2px; border-radius: 4px; font: 600 10px/1.3 var(--tw-mono, ui-monospace, monospace); text-align: center; color: var(--tw-ink, #eef6fa); }
@media (max-width: 520px) { .jh-panel { grid-template-columns: auto 110px; } .jh-keys { display: none; } }
/* the prompt pill (Get off) sits 16 px over the speed panel and key legend, not on top of them */
:root:has(.jh:not([hidden])) .tw-prompt { bottom: calc(var(--tw-edge, 18px) + var(--jh-h, 110px) + 16px); }
`;
		document.head.appendChild( style );
		const root = this.root = document.createElement( 'section' );
		root.className = 'jh';
		root.setAttribute( 'aria-label', 'Jetski telemetry' );
		root.hidden = true;
		root.innerHTML = `
			<div class="jh-panel tw-glass" role="status" aria-live="off">
				<div class="jh-speed"><b>0</b><span>km/h</span></div>
				<div class="jh-row"><span class="jh-label">RPM</span><div class="jh-bar jh-rpm"><i></i></div></div>
				<div class="jh-row"><span class="jh-label">Throttle</span><div class="jh-bar jh-thr"><i></i></div></div>
				<div class="jh-row"><span class="jh-label">Rocket</span><div class="jh-bar jh-fuel"><i></i></div></div>
			</div>
			<div class="jh-keys" role="note" aria-label="Jetski keys">
				<span><kbd>W</kbd>Throttle</span><span><kbd>S</kbd>Brake · reverse</span><span><kbd>A</kbd><kbd>D</kbd>Steer</span>
				<span><kbd>Shift</kbd>Tuck</span><span><kbd>Space</kbd>Lean back · pop</span><span><kbd>X</kbd>Rocket</span><span><kbd>C</kbd>Camera</span><span><kbd>G</kbd>Mate on · off</span><span><kbd>E</kbd>Get off</span>
			</div>`;
		document.body.appendChild( root );
		// its height (panel + key legend, which wraps on narrow screens) lifts the prompt pill above it
		// and the legend's own height lifts the card PIN chip (GameHUD .gm-pin) over the legend row
		if ( typeof ResizeObserver === 'function' ) new ResizeObserver( () => {

			if ( ! root.offsetHeight ) return;
			const s = document.documentElement.style, keys = root.querySelector( '.jh-keys' );
			s.setProperty( '--jh-h', root.offsetHeight + 'px' );
			s.setProperty( '--jh-keys-h', ( keys?.offsetHeight || 0 ) + 'px' );

		} ).observe( root );
		this.speedEl = root.querySelector( '.jh-speed b' );
		this.rpmEl = root.querySelector( '.jh-rpm i' );
		this.thrEl = root.querySelector( '.jh-thr i' );
		this.fuelBar = root.querySelector( '.jh-fuel' );
		this.fuelEl = this.fuelBar.querySelector( 'i' );
		this.lit = false;
		this.shown = 0;

	}

	show( on ) {

		if ( ! this.root ) this.build();
		this.root.hidden = ! on;

	}

	update( c, on ) {

		if ( ! this.root ) return;
		if ( ! on ) { if ( ! this.root.hidden ) this.root.hidden = true; return; }
		if ( this.root.hidden ) this.root.hidden = false;
		const kmh = Math.round( c.speed * 3.6 );
		if ( kmh !== this.shown ) { this.speedEl.textContent = String( kmh ); this.shown = kmh; }
		this.rpmEl.style.width = `${ ( Math.min( c.rev, 1 ) * 100 ).toFixed( 1 ) }%`;
		this.thrEl.style.width = `${ ( Math.max( c.throttle, c.brake ) * 100 ).toFixed( 1 ) }%`;
		this.fuelEl.style.width = `${ ( c.fuel * 100 ).toFixed( 1 ) }%`;
		if ( c.boosting !== this.lit ) { this.lit = c.boosting; this.fuelBar.classList.toggle( 'lit', this.lit ); }

	}

}
