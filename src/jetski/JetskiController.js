import * as THREE from '../engine/index.js';
import {FluidStep} from './FluidStep.js';

// Rigid-body personal watercraft (a 3.3 m, 350 kg performance stand-up / sit-down ski plus its
// rider), six degrees of freedom, fixed 120 Hz substeps. See docs/jetski.md for the model and tuning.
//
//  * Hydrostatics: one water column per hull sample (bottom panel -> deck), the water height from
//    the GPU queries, extrapolated with the water's vertical velocity over the read-back latency and
//    asked for where the sample will be by then (speed lead), as in BoatController. Columns work
//    upside down too (a capsized ski floats on its deck).
//  * Planing: every wetted bottom panel is a lifting surface: p = 1/2 rho C |v| (v . n), along its
//    own normal (deadrise and rocker), so lift, induced drag, lateral chine grip and porpoising damping
//    all come from the same term; an extra Wagner-style slam term on panels entering the water.
//  * Drag: skin friction on the wetted panels, the displacement hump (15-25 km/h), strake cross-flow
//    with a grip stall past ~20 deg of slip (the slide), burying drag when the bow digs in, air drag.
//  * Jet: engine spool (0.4 s), idle creep, momentum thrust rho A Vj (Vj - u) from the nozzle, only
//    while the intake is wet (it over-revs in the air); the nozzle vectors the thrust, so there is no
//    steering without thrust; a reverse bucket for braking and slow astern.
//  * Rider: 85 kg on the seat; his lean moves the centre of gravity (fore / aft, into the turn) and he
//    holds the bank with his body (a bounded roll torque); in the air he can pitch and roll the ski.
//  * Crashes: rolling past ~100 deg, a nose-dive landing or a violent slam throws him off; the lanyard
//    cuts the engine.

const RHO = 1025;
const RHO_AIR = 1.225;
const GRAV = 9.81;
const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const sstep = THREE.MathUtils.smoothstep;
const H = 1 / 120;

// ---- tuning (see docs/jetski.md: measured 0-60 / 0-100 / top speed / turn radius against these)
export const SKI = {
	massSki: 350, massRider: 85,
	massMate: 80, mateSeat: [ 0, 0.67, - 0.88 ], mateCdA: 0.12, // a back-seat passenger (Mate.js): her CoG on the rear saddle (0.46 m behind the rider's), her extra frontal area (mostly in his lee)
	inertia: [ 310, 360, 95 ], // pitch (x), yaw (y), roll (z), kg m^2 with the rider
	addedMass: [ 0.5, 0.35, 0.04 ], // sway, heave, surge (fraction of mass, fully wet)
	addedInertia: [ 0.55, 0.3, 0.25 ], // pitch, yaw, roll
	deckY: 0.34, // deck / gunwale height above the static waterline (top of the water columns)
	lift: 0.62, // planing lift coefficient per panel (flat plate, low aspect ratio)
	slam: 2.4, // extra impact coefficient on panels entering the water
	suction: 0.12, // panels leaving the water (keeps it from skipping like a stone)
	cf: 0.0028, // skin friction coefficient (wetted panels)
	appendage: 0.0027, // m^2: intake grate, ride plate, sponsons and the spray root (drag ~ u^2 while wet)
	strake: 0.95, // lateral lift of keel / chines / sponsons per unit slip (grows with speed)
	crossFlow: 0.6, // lateral cross-flow drag
	slipStall: [ 0.3, 0.55 ], // slip angle (rad) where the strakes lose their grip
	hump: 0.1, // displacement hump drag / weight at its peak
	humpSpeed: 5.4, // m/s (19 km/h)
	humpWidth: 2.0,
	humpTrim: 1500, // bow-up moment over the hump (N m)
	bury: 0.9, // drag coefficient of panels buried past the chine (nose dives)
	airCdA: 0.62, airCdATuck: 0.48,
	nozzleArea: 0.00112, // m^2 effective (rho A Vj^2 = static thrust, ~3.5 kN)
	jetSpeed: 58, // m/s at full rpm
	ram: 1.0, // intake ram recovery (thrust falls with speed)
	idle: 0.14, // idle rpm fraction (creep)
	spoolUp: 0.4, spoolDown: 0.55, spoolAir: 0.14,
	nozzleMax: 20 * DEG, barsMax: 25 * DEG,
	bucketEff: 0.5, reverseThrottle: 0.3,
	riderBank: 40 * DEG, riderRollK: 12000, riderRollD: 850, riderRollMax: 9000,
	riderShift: [ 0.36, 0.22 ], // lateral / fore-aft reach of his weight shift (m)
	popTorque: 3400, popTime: 0.2, airPitch: 900, airRoll: 380,
	chopL: 1.8, chopT: 0.06, // hull filter on the water: chop much shorter than the hull is bridged (m of track, s at rest)
	pushSpeed: 0.45, pushGrip: 0.9, pushGain: 50, groundHold: 0.4, // (pushGain 1/s: stiff enough to hold the pace against the sand's pull) // beached push-off: m/s he walks it back at, the most push as a fraction of its weight (sand friction ~0.45 of the load on the sand), s a contact counts as aground
	primeHold: 0.2, // s: the pump keeps its water this long after the intake leaves the surface
	faceK: 1.0, // how much of the surface rise under a panel moving across a wave face counts as entry (planing on the face)
	heaveFade: [ 4, 14 ], // m/s: heave radiation damping fades as the hull planes (the planing term damps it)
	landBank: 55 * DEG, // landing rolled past this with a hard entry throws him
	landFlat: 14, // m/s: a flat or stern-first landing (nose within 15 deg down, bank within 30 deg) holds up to this entry: he takes it on his legs
	landFast: [ 25, 60, 18 ], // ...rising to [2] m/s between [0] and [1] m/s of speed: a flat hull at rocket speed skims in on a long footprint
	solidK: 6e5, solidC: 1.6e4, solidMu: 0.1, // floating solids (kicker ramps): N/m and N s/m over the whole bottom, wet plastic friction
	jetOut: [ 0, - 0.14, - 1.58 ], intake: [ 0, - 0.26, - 0.35 ],
	seat: [ 0, 0.62, - 0.42 ],
	// the rocket pod (tools/jetski/rocket_build.py, jetski_rocket.glb): thrust at the bell exit, aimed through the
	// centre of gravity (the pod is tipped 9 deg for that), ~6 s of burn that refills over ~20 s, a bow-up kick as it lights
	rocketThrust: 9000, rocketOut: [ 0, 0.446, - 1.915 ], rocketBurn: 6, rocketRefill: 20, rocketKick: 0.3,
	// the rider's roll authority grows with speed: slow, the hull has no dynamic grip for him to lean against
	// (his full 9 kN m at 8 km/h with the bucket down and full lock rolled the ski over)
	lowRoll: [ 3, 9 ], lowRollMin: 1, // (1: off. Not reproduced in game, see docs/jetski.md Rocket; 0.2 is the candidate)
	airHold: [ 1400, 420, 700 ], // airborne attitude hold: N m per rad, N m per rad/s, clamp (N m) (the 56 deg nose-up launch is not reproduced yet)
	// airborne: the pitch (rad, nose up) he holds the ski at for the landing with no input, stern first as riders land,
	// and how much higher (rad) he holds it with the throttle open: he sits back on the bars and the primed pump's thrust,
	// below the centre of gravity, lifts the nose (W is held for speed over a crest, it is not a push on the bars)
	// airMatch: the share of the water's slope under him (along the heading) he matches as he comes down, so the hull meets
	// the face it lands on flat to it instead of slapping it (riders spot the landing), within airMatchMax (rad)
	airTrim: 3 * DEG, airThrottleTrim: 4 * DEG, airMatch: 1, airMatchMax: 20 * DEG,
	// aero (round 4, rocket stability): every term grows with airspeed, so below ~100 km/h they are small.
	// finK: the pod's four fins in an X plus the hull's aft body, as one tail: effective area x lift slope (m^2 per rad),
	// its centre of pressure at finAt (ski frame), 1.5 m behind the centre of gravity, so it weathervanes the nose back
	// into the airflow in pitch and yaw. aeroDamp: pitch / yaw rate damping, N m s per (rad/s x m/s of airspeed).
	// hullAero: the hull tuned as a racing hydroplane: anti-lift, m^2 per rad of angle of attack (a nose-up hull is
	// pushed down, not lifted), and a downforce C.A (m^2), both at hullAt. faceFade: the wave-face term (faceK) fades
	// by [2] between [0] and [1] m/s, where the hull bridges the crests instead of running up each face.
	finK: 2, finAt: [ 0, 0.42, - 1.8 ], aeroDamp: [ 30, 14, 12 ], hullAero: [ 3, 0.6 ], hullAt: [ 0, 0, - 0.1 ],
	faceFade: [ 30, 55, 0.9 ],
	plough: 20, // 1/s: heave damping of the whole ski while its bottom is wet, over the aeroOn band (see the plough in step)
	ploughFace: 0, // how much of the surface rising along the ski's track (running up a face) the plough lets through (1 lets the rocket fly: 0.95 s to 1.4 s flights)
	// the bow's reserve buoyancy: the deck (the top of each panel's water column) rises by bowDeck (m) towards the bow and
	// the flare above the chine adds flare x the panel's area for water more than 0.12 m up the bow, so a face ahead
	// lifts the nose instead of burying it; the nose-dive drag starts past the raised deck (faded out over aeroOn)
	bowDeck: 0, flare: 0, bowFrom: [ 0.2, 1.65 ], // (0, 0: off. 0.3, 0.8 is the candidate, see docs/jetski.md Wave riding)
	aeroOn: [ 26, 42 ], // m/s: the tuned fin and hull terms blend in over this band (above the 30 m/s jet-only top speed), so the
	// ride, the turns and the hops below 95 km/h stay as they were tuned
};

// Hull samples when the model lane's public/models/jetski.json is not there: six stations along a
// 3.3 m hull, a keel pad and a 22 deg deadrise chine panel each side, rocker at the bow, and the two
// sponsons aft. p: panel centre (m, +X port, +Y up, +Z forward, origin at the static waterline).
export function defaultHull() {

	const s = [];
	const beta = 22 * DEG, dz = 0.56;
	const keelY = ( z ) => { const b = sstep( z, 0.1, 1.65 ); return - 0.27 + 0.2 * b * b; };
	for ( const z of [ 1.36, 0.8, 0.24, - 0.32, - 0.88, - 1.44 ] ) {

		const b = sstep( z, 0.1, 1.65 );
		const k = keelY( z ), kp = ( keelY( z + 0.05 ) - keelY( z - 0.05 ) ) / 0.1;
		const hb = 0.53 - 0.25 * b * b, kw = 0.3 - 0.08 * b;
		s.push( { p: [ 0, k, z ], area: kw * dz, kind: 'bottom', n: [ 0, - 1, kp ] } );
		const xc = ( kw / 2 + hb ) / 2;
		for ( const sg of [ 1, - 1 ] ) s.push( { p: [ sg * xc, k + Math.tan( beta ) * ( xc - kw / 2 ), z ], area: ( hb - kw / 2 ) * dz, kind: 'chine', n: [ sg * Math.tan( beta ), - 1, kp ] } );

	}

	for ( const sg of [ 1, - 1 ] ) s.push( { p: [ sg * 0.6, - 0.06, - 1.15 ], area: 0.07, kind: 'sponson', n: [ sg * 1.0, - 0.35, 0 ] } );
	return { samples: s, lengthM: 3.3, beamM: 1.2, massKg: 350 };

}

// Pressure head (m) of the ski on the wake sim, in the ski frame (x port, z forward). Scheduled from
// speed only (see WakeSim: a pose-dependent source closes a delayed feedback loop). The controller
// adds most of it back to its own water heights so it does not sit in its own hole.
export function skiWakeHead( speed ) {

	const hump = Math.exp( - ( ( ( speed - 5 ) / 2.5 ) ** 2 ) );
	return 0.07 + 0.06 * hump - 0.03 * sstep( speed, 8, 18 );

}

export function skiWakeShape( x, z, speed ) {

	const zc = - 0.25 - 0.45 * sstep( speed, 3, 12 ); // the footprint moves aft onto the plane
	const q = ( x / 0.6 ) ** 2 + ( ( z - zc ) / 1.45 ) ** 2;
	return q < 1 ? ( 1 - q ) * ( 1 - q ) : 0;

}

const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _com = new THREE.Vector3();
const _sp = new THREE.Vector3(), _sv = new THREE.Vector3(), _sr = new THREE.Vector3(), _sf = new THREE.Vector3(), _hit = { n: new THREE.Vector3(), v: new THREE.Vector3(), lz: 0, lx: 0 };
const _p = new THREE.Vector3(), _pd = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _vp = new THREE.Vector3(), _vl = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(), _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();
const _invQ = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3( 0, 1, 0 );
const _waterVelocity=new THREE.Vector3(),_surfaceNormal=new THREE.Vector3();

export class JetskiController {

	constructor( { query = null, terrain, colliders = null, vessels = null, hull = null, maxSlots = 24, solids = null } ) {

		this.query = query;
		this.terrain = terrain;
		this.colliders = colliders;
		this.vessels = vessels; // () => [ { a: Vector3, b: Vector3, r } ] capsules to keep clear of (boat, ferry)
		this.solids = solids; // () => [ { position, reach2, probe( pw, out ), push( f, pw, h, lz, lx ) } ] surfaces the hull panels ride on (Course.js ramps)
		this.onSolid = 0; // hull panels on a solid this step
		this.hullSource = hull && hull.samples && hull.samples.length ? 'jetski.json' : 'default';
		hull = this.hullSource === 'jetski.json' ? hull : defaultHull();
		const src = hull.samples.slice( 0, 64 );
		// the water is queried on a small grid under the hull (3 x 3 when the slots allow, 2 x 2 at least) and
		// interpolated to every panel: the 64 GPU query slots are shared with the whole island
		const nq = maxSlots >= 9 ? 3 : 2;
		this.gridX = nq === 3 ? [ - 0.45, 0, 0.45 ] : [ - 0.45, 0.45 ];
		this.gridZ = nq === 3 ? [ 1.2, - 0.1, - 1.4 ] : [ 1.0, - 1.2 ];
		this.qpts = [];
		for ( const z of this.gridZ ) for ( const x of this.gridX ) this.qpts.push( new THREE.Vector3( x, - 0.2, z ) );
		this.massSki = hull.massKg || SKI.massSki;
		this.mass = this.massSki + SKI.massRider;
		this.skiCog = new THREE.Vector3().fromArray( hull.cog || [ 0, - 0.02, - 0.42 ] );
		this.inertia = new THREE.Vector3().fromArray( hull.inertia || SKI.inertia );
		this.samples = src.map( ( s ) => {

			const p = new THREE.Vector3().fromArray( s.p );
			let n;
			if ( s.n ) n = new THREE.Vector3().fromArray( s.n );
			else if ( s.kind === 'sponson' ) n = new THREE.Vector3( Math.sign( p.x ), - 0.35, 0 );
			else if ( s.kind === 'chine' ) n = new THREE.Vector3( Math.sign( p.x ) * 0.4, - 1, 0 );
			else n = new THREE.Vector3( 0, - 1, 0 );
			return { p, n: n.normalize(), area: s.area, kind: s.kind || 'bottom', wetPrev: 0 };

		} );
		// static trim: scale the panel areas so the loaded ski floats with its origin on the waterline
		let vol = 0;
		for ( const s of this.samples ) vol += s.area * Math.max( - s.p.y, 0 );
		const k = ( this.mass / RHO ) / Math.max( vol, 1e-3 );
		// a hull file whose panels do not add up to a plausible waterplane falls back to the built-in hull
		if ( this.hullSource === 'jetski.json' && ( k < 0.5 || k > 2 || Math.max( ...src.map( ( s ) => s.p[ 2 ] ) ) < 1.0 ) ) {

			const alt = new JetskiController( { query, terrain, colliders, vessels, hull: null, maxSlots, solids } );
			alt.hullSource = `default (jetski.json rejected: area scale ${ k.toFixed( 2 ) }, forebody to z = ${ Math.max( ...src.map( ( s ) => s.p[ 2 ] ) ).toFixed( 2 ) } m: it cannot plane without bow panels)`;
			return alt;

		}

		for ( const s of this.samples ) s.area *= k;
		this.areaScale = k;
		let wp = 0;
		for ( const s of this.samples ) wp += s.area;
		this.waterplane = wp;

		this.slot = query ? query.allocate( 'jetskiHull', this.qpts.length ) : - 1;
		const n = this.qpts.length;
		this.hq = new Float32Array( n );
		this.waterH = new Float32Array( n );
		this.waterV = new Float32Array( n );
		this.waterOff = new Float32Array( n );
		this.hEff = new Float32Array( n );
		this.qx = new Float32Array( n );
		this.qz = new Float32Array( n );
		this.gx = new Float32Array( n );
		this.gz = new Float32Array( n );
		this.h1 = new Float32Array( n ); this.hRaw = new Float32Array( n ); // track filter stage 1, last raw read
		this.sgx = new Float32Array( n ); this.sgz = new Float32Array( n ); // filtered surface slope (the face under the hull)
		this.depth = new Float32Array( this.samples.length );
		this.hasWater = false;
		this._age = 0;
		this._acc = 0;

		this.position = new THREE.Vector3();
		this.quaternion = new THREE.Quaternion();
		this.velocity = new THREE.Vector3();
		this.angular = new THREE.Vector3();
		this.com = new THREE.Vector3();

		// controls (targets from setInput, smoothed here)
		this.input = { throttle: 0, brake: 0, steer: 0, tuck: 0, back: 0, pop: false, boost: 0 };
		// rocket: fuel 0..1, lit while X is held and there is fuel (boosting: read by Jetski.js, the cockatoo)
		this.fuel = 1; this.boosting = false; this.boostLevel = 0; this._boostLatch = false; this.rocketForce = 0; this.subSteps = 1; this.rollT = 0;
		this.throttle = 0; this.brake = 0; this.steer = 0; this.bucket = 0;
		this.leanLat = 0; this.leanFwd = 0;
		this.rpm = 0; this.rev = 0; this.engineOn = false;
		this.driven = false; // rider aboard
		this.wakeComp = 0; // 0..1: how much of its own wake depression to add back (the wake's output level)

		// outputs
		this.speed = 0; this.forwardSpeed = 0; this.thrust = 0; this.prime = 0;
		this.wetFraction = 1; this.airTime = 0; this.airborne = false; this.maxAirHeight = 0; this.lastAir = null;
		this.bank = 0; this.pitchAngle = 0; this.slip = 0; this.yawRate = 0;
		this.events = []; // { type: 'slam' | 'land' | 'hit' | 'crash', ... } drained by the owner
		this.capsized = false; this._rolled = 0;
		this.righting = 0;
		this._popT = 0;
		this.stats = { steps: 0, ms: 0 };
		this.drag = { friction: 0, hump: 0, air: 0, induced: 0 };
		this.fluidStep=new FluidStep();

	}

	place( x, y, z, yaw ) {

		this.position.set( x, y, z );
		this.quaternion.setFromAxisAngle( _yAxis, yaw );
		this.velocity.set( 0, 0, 0 );
		this.angular.set( 0, 0, 0 );
		this.hasWater = false;
		this.capsized = false;
		this._rolled = 0;
		this.airborne = false;
		this.airTime = 0;
		for ( const sm of this.samples ) { sm.dPrev = undefined; sm.wetPrev = 0; }

	}

	toWorld( local, out ) { return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position ); }

	forward( out ) { return out.set( 0, 0, 1 ).applyQuaternion( this.quaternion ); }

	getYaw() { const f = this.forward( _v ); return Math.atan2( f.x, f.z ); }

	// throttle / brake 0..1, steer -1..1 (+ left), tuck / back 0..1, pop: edge (Space tapped)
	setInput( i ) {

		Object.assign( this.input, i );

	}

	queueQueries() {

		const q = this.query;
		if ( ! q || this.slot < 0 ) return;
		const lead = q.latency + 2 / ( this.speed / SKI.chopL + 1 / SKI.chopT ); // + the track filter's delay
		for ( let i = 0; i < this.qpts.length; i ++ ) {

			this.toWorld( this.qpts[ i ], _v ).addScaledVector( this.velocity, lead );
			q.setPoint( this.slot + i, _v.x, _v.z );

		}

	}

	// as BoatController.readQueries: local rate of the surface under each sample (the part from moving
	// across the slope removed), used to extrapolate between read-backs; steps blended out
	readQueries() {

		const q = this.query;
		if ( ! q || ! q.cpuValid || q.version === this._qVersion ) return;
		const dt = q.resultTime - ( this._qTime ?? q.resultTime );
		this._qVersion = q.version;
		this._qTime = q.resultTime;
		const c = q.cpu, pts = q.resultInputs;
		for ( let i = 0; i < this.qpts.length; i ++ ) {

			const k = ( this.slot + i ) * 4;
			let h = c[ k ];
			if ( ! Number.isFinite( h ) ) h = this.hasWater ? this.waterH[ i ] : 0;
			const nx = Number.isFinite( c[ k + 1 ] ) ? c[ k + 1 ] : 0, nz = Number.isFinite( c[ k + 2 ] ) ? c[ k + 2 ] : 0;
			const ny = Math.sqrt( Math.max( 1 - nx * nx - nz * nz, 0.05 ) );
			const gx = - nx / ny, gz = - nz / ny;
			let w = 0, a = 1;
			if ( this.hasWater && dt > 1e-4 ) {

				const dx = pts[ k ] - this.qx[ i ], dz = pts[ k + 1 ] - this.qz[ i ];
				w = ( h - this.hRaw[ i ] - 0.5 * ( ( gx + this.gx[ i ] ) * dx + ( gz + this.gz[ i ] ) * dz ) ) / dt;
				// the hull bridges chop shorter than itself: a two-stage moving average along each point's track
				// (the swell passes, 2 m chop is cut to about a third; the lead in queueQueries makes up the delay)
				a = 1 - Math.exp( - Math.hypot( dx, dz ) / SKI.chopL - dt / SKI.chopT );

			}

			if ( ! this.hasWater ) { this.h1[ i ] = h; this.waterH[ i ] = h; this.sgx[ i ] = gx; this.sgz[ i ] = gz; this.waterV[ i ] = 0; }
			this.h1[ i ] += ( h - this.h1[ i ] ) * a;
			const hs = this.waterH[ i ] + ( this.h1[ i ] - this.waterH[ i ] ) * a;
			this.waterOff[ i ] = this.hasWater ? this.hEff[ i ] - hs : 0;
			this.waterV[ i ] += ( clamp( w, - 4, 4 ) - this.waterV[ i ] ) * Math.min( a, 0.5 );
			this.waterH[ i ] = hs;
			this.hEff[ i ] = hs + this.waterOff[ i ];
			this.hRaw[ i ] = h;
			this.sgx[ i ] += ( gx - this.sgx[ i ] ) * a; this.sgz[ i ] += ( gz - this.sgz[ i ] ) * a;
			this.qx[ i ] = pts[ k ]; this.qz[ i ] = pts[ k + 1 ];
			this.gx[ i ] = gx; this.gz[ i ] = gz;

		}

		this._age = 0;
		this.hasWater = true;

	}

	// bilinear in the ski frame over the query grid (a little extrapolation to the bow, stern and sponsons)
	gridAt( a, x, z ) {

		const X = this.gridX, Z = this.gridZ, nx = X.length, nz = Z.length;
		const fx = ( x - X[ 0 ] ) / ( X[ nx - 1 ] - X[ 0 ] ) * ( nx - 1 ), fz = ( z - Z[ 0 ] ) / ( Z[ nz - 1 ] - Z[ 0 ] ) * ( nz - 1 );
		const ix = clamp( Math.floor( fx ), 0, nx - 2 ), iz = clamp( Math.floor( fz ), 0, nz - 2 );
		const tx = clamp( fx - ix, - 0.4, 1.4 ), tz = clamp( fz - iz, - 0.4, 1.4 );
		const i0 = iz * nx + ix, i1 = i0 + nx;
		return ( a[ i0 ] * ( 1 - tx ) + a[ i0 + 1 ] * tx ) * ( 1 - tz ) + ( a[ i1 ] * ( 1 - tx ) + a[ i1 + 1 ] * tx ) * tz;

	}

	update( dt ) {

		const t0 = performance.now();
		this.readQueries();
		if ( ! this.hasWater ) return;
		dt = Math.min( dt, 0.1 );
		const I = this.input;

		// throttle is ramped (a keyboard W builds over ~0.25 s), the bars follow the hands
		const ramp = ( cur, tgt, up, down ) => cur + clamp( tgt - cur, - dt / down, dt / up );
		const on = this.driven && this.engineOn;
		this.throttle = ramp( this.throttle, on ? I.throttle : 0, 0.25, 0.12 );
		this.brake = ramp( this.brake, on ? I.brake : 0, 0.2, 0.12 );
		this.steer += ( ( this.driven ? I.steer : 0 ) - this.steer ) * ( 1 - Math.exp( - dt / 0.09 ) );
		this.bucket = ramp( this.bucket, this.brake > 0.05 ? 1 : 0, 0.3, 0.3 );
		const u = this.forwardSpeed;
		// his weight: into the turn (more of it with speed), forward on tuck, back on Space
		// a coasting ski barely carves: without the jet pushing he has nothing to lean against
		const drive = sstep( this.rpm, SKI.idle + 0.06, 0.5 );
		const latT = this.driven ? I.steer * ( 0.35 + 0.65 * sstep( Math.abs( u ), 3, 12 ) ) * ( 0.1 + 0.9 * drive ) : 0;
		this.leanLat += ( latT - this.leanLat ) * ( 1 - Math.exp( - dt / 0.22 ) );
		// (carving he also leans forward: the bow and the forward chines bite, which is what makes it turn)
		const fwdT = this.driven ? clamp( I.tuck - I.back + 1.0 * Math.abs( I.steer ) * sstep( Math.abs( u ), 6, 14 ) * drive, - 1, 1 ) : 0;
		this.leanFwd += ( fwdT - this.leanFwd ) * ( 1 - Math.exp( - dt / 0.18 ) );
		if ( I.pop && this.driven ) this._popT = SKI.popTime;
		I.pop = false;

		// engine: spools after the throttle; unloaded (intake out of the water) it runs up fast
		const lever = on ? Math.max( this.throttle, this.brake * ( Math.abs( u ) > 2 ? 1 : SKI.reverseThrottle ) ) : 0;
		const target = on ? SKI.idle + ( 1 - SKI.idle ) * Math.min( 1, lever * ( this.prime < 0.5 ? 1.15 : 1 ) ) : 0;
		const tau = target > this.rpm ? ( this.prime < 0.5 ? SKI.spoolAir : SKI.spoolUp ) : SKI.spoolDown * ( on ? 1 : 2.5 );
		this.rpm += ( target - this.rpm ) * ( 1 - Math.exp( - dt / tau ) );
		this.rev = Math.min( 1.08, this.rpm * ( 1 + 0.08 * ( 1 - this.prime ) ) );

		// rocket: X held lights it while there is fuel; run dry, it flames out and waits for X to be let go
		const wantBoost = on && I.boost > 0.5;
		if ( ! wantBoost ) this._boostLatch = false;
		const lit = wantBoost && ! this._boostLatch && this.fuel > 0;
		if ( lit && ! this.boosting ) { this.events.push( { type: 'ignite' } ); this._popT = SKI.rocketKick; }
		if ( lit ) {

			this.fuel = Math.max( 0, this.fuel - dt / SKI.rocketBurn );
			if ( this.fuel <= 0 ) { this._boostLatch = true; this.events.push( { type: 'flameout' } ); }

		} else this.fuel = Math.min( 1, this.fuel + dt / SKI.rocketRefill );
		this.boosting = lit && this.fuel > 0;
		this.boostLevel += ( ( this.boosting ? 1 : 0 ) - this.boostLevel ) * ( 1 - Math.exp( - dt / ( this.boosting ? 0.08 : 0.2 ) ) );

		// substeps: 120 Hz, split in two past 24 m/s (or lit) and in three past 45 m/s: the planing and slam terms are
		// stiff in speed, and the hull moves 0.58 m per 120 Hz step at 70 m/s (more than a pile's width)
		const sub = this.subSteps = this.speed > 45 ? 3 : this.speed > 24 || this.boosting ? 2 : 1;
		this._acc += dt;
		let steps = 0;
		while ( this._acc >= H && steps < 12 ) {

			for ( let k = 0; k < sub; k ++ ) this.step( H / sub );
			this._acc -= H;
			steps ++;

		}

		if ( ! this.isFinite() ) {

			this.velocity.set( 0, 0, 0 );
			this.angular.set( 0, 0, 0 );
			this.quaternion.identity();
			this.position.y = 0;

		}

		this.stats.steps = steps;
		this.stats.ms = this.stats.ms * 0.9 + ( performance.now() - t0 ) * 0.1;

	}

	// a back-seat passenger (kg, 0 = solo): the mass and the pitch / yaw / roll inertia about the ski's CoG grow
	// with her on the rear saddle. The panel areas stay trimmed for the solo ski, so two-up she floats lower.
	setPassenger( kg ) {

		kg = Math.max( 0, kg || 0 );
		if ( Math.abs( kg - ( this.massMate || 0 ) ) < 0.05 ) return;
		this.inertia0 ??= this.inertia.clone();
		this.massMate = kg;
		this.mass = this.massSki + SKI.massRider + kg;
		const dy = SKI.mateSeat[ 1 ] - this.skiCog.y, dz = SKI.mateSeat[ 2 ] - this.skiCog.z;
		this.inertia.set( this.inertia0.x + kg * ( dy * dy + dz * dz ), this.inertia0.y + kg * dz * dz, this.inertia0.z + kg * dy * dy );

	}

	step( h ) {

		const S = SKI, m = this.mass;
        const env=this.environment?.sample(this.position.x,this.position.y,this.position.z);
        const flow=new THREE.Vector3(env?.ux??0,0,env?.uz??0),airVelocity=new THREE.Vector3(env?.wx??0,env?.wy??0,env?.wz??0);
        const airRelative=this.velocity.clone().sub(airVelocity),airSpeed=airRelative.length();
		this._h = h;
		// centre of gravity with the rider where his weight is
		const mr = S.massRider, mp = this.massMate || 0, ps = S.mateSeat; // (the passenger leans half as far as the rider)
		const sy = S.seat[ 1 ] - 0.1 * Math.abs( this.leanLat ) - 0.06 * Math.max( this.leanFwd, 0 );
		this.com.set(
			( this.skiCog.x * this.massSki + ( this.driven ? this.leanLat * S.riderShift[ 0 ] : 0 ) * mr + ( this.driven ? 0.5 * this.leanLat * S.riderShift[ 0 ] : 0 ) * mp ) / m,
			( this.skiCog.y * this.massSki + ( this.driven ? sy : 0.1 ) * mr + ps[ 1 ] * mp ) / m,
			( this.skiCog.z * this.massSki + ( this.driven ? S.seat[ 2 ] + this.leanFwd * S.riderShift[ 1 ] : - 0.3 ) * mr + ps[ 2 ] * mp ) / m,
		);
		const F = _F.set( 0, - m * GRAV, 0 );
		const T = _T.set( 0, 0, 0 );
		this.disasterDt = h;
		this.disasterForces?.( this, F, T );
		const comW = this.toWorld( this.com, _com );
		const fluid=this.fluidStep.begin(comW);
		const invQ = _invQ.copy( this.quaternion ).invert();
		const addAt = ( f, pw ) => { F.add( f ); T.add( _r.copy( pw ).sub( comW ).cross( f ) ); };

		const fwd = this.forward( _fwd );
		const side = _side.set( 1, 0, 0 ).applyQuaternion( this.quaternion );
		const up = _up.set( 0, 1, 0 ).applyQuaternion( this.quaternion );
		_vl.copy( this.velocity ).sub(flow).applyQuaternion( invQ );
		const u = this.forwardSpeed = _vl.z;
		this.speed = this.velocity.length();
		const au = Math.abs( u );

		this._age = Math.min( this._age + h, 0.12 );
		const blend = Math.exp( - h / 0.06 );
		const self = this.wakeComp * skiWakeHead( this.speed ) * 0.8;

		for ( let j = 0; j < this.qpts.length; j ++ ) {

			this.waterOff[ j ] *= blend;
			this.hEff[ j ] = this.hq[ j ] = this.waterH[ j ] + this.waterV[ j ] * this._age + this.waterOff[ j ];

		}

		let wet = 0, total = 0, maxSlam = 0, slamZ = 0, fric = 0, liftX = 0, dMax = - Infinity;
		const heaveD = 1 - 0.85 * sstep( au, S.heaveFade[ 0 ], S.heaveFade[ 1 ] );
		const faceK = S.faceK * ( 1 - S.faceFade[ 2 ] * sstep( au, S.faceFade[ 0 ], S.faceFade[ 1 ] ) );
		const cfH = 0.5 * RHO * S.cf;
		const bowR = 1 - sstep( au, S.aeroOn[ 0 ], S.aeroOn[ 1 ] ); // the bow's reserve fades over the rocket band (its hops and turns are tuned without it)
		for ( let i = 0; i < this.samples.length; i ++ ) {

			const s = this.samples[ i ];
			let hw = this.gridAt( this.hq, s.p.x, s.p.z );
			const wv = this.gridAt( this.waterV, s.p.x, s.p.z );
			const sx = this.gridAt( this.sgx, s.p.x, s.p.z ), sz = this.gridAt( this.sgz, s.p.x, s.p.z );
			if ( self > 0 ) hw += self * skiWakeShape( s.p.x, s.p.z, this.speed );
			const pb = this.toWorld( s.p, _p );
			// the water column from the panel to the deck above it (either way up)
			const bowK = sstep( s.p.z, S.bowFrom[ 0 ], S.bowFrom[ 1 ] ) * bowR;
			_v.set( s.p.x, S.deckY + S.bowDeck * bowK, s.p.z );
			const pd = this.toWorld( _v, _pd );
			const low = pb.y < pd.y ? pb : pd, high = pb.y < pd.y ? pd : pb;
			const span = Math.max( high.y - low.y, 0.05 );
			const d = hw - pb.y;
			this.depth[ i ] = d;
			if ( d > dMax ) dMax = d;
			total += s.area;
			const sub = clamp( hw - low.y, 0, span );
			const rate = ( d - ( s.dPrev ?? d ) ) / h; // immersion rate: the surface rising into the panel or the panel dropping in
			s.dPrev = d;
			if ( sub <= 0 ) { s.wetPrev = 0; continue; }
			const wetK = Math.min( 1, sub / 0.1 );
			wet += s.area * wetK;
			_c1.copy( low ).lerp( high, 0.5 * sub / span );
			_vp.copy( this.angular ).cross( _r.copy( _c1 ).sub( comW ) ).add( this.velocity ).sub(flow);
			// the surface under the panel rises with the water's own motion and as the panel runs up a face
			_waterVelocity.copy(flow);_waterVelocity.y=wv*.7;
			// Radiation acts normal to the actual free surface. Track speed across a
			// steep height field is not an additional vertical fluid velocity.
			_surfaceNormal.set(-sx*faceK,1,-sz*faceK).normalize();
			// buoyancy (vertical: the column) + heave damping against the water's motion (fades on the plane)
			_f.set( 0, RHO * GRAV * s.area * sub * ( 1 + S.flare * bowK * clamp( ( sub - 0.12 ) / 0.2, 0, 1 ) ), 0 );
			const normalSpeed=_vp.dot(_surfaceNormal)-wv*.7*_surfaceNormal.y;
			fluid.point((1500+700*Math.abs(normalSpeed))*s.area*wetK*heaveD,_c1,_surfaceNormal,_waterVelocity);
			addAt( _f, _c1 );

			// ---- hydrodynamics of the panel itself (only while its face is in the water)
			if ( d <= 0 ) { s.wetPrev = 0; continue; }
			const aw = s.area * Math.min( 1, d / 0.1 );
			_vp.copy( this.angular ).cross( _r.copy( pb ).sub( comW ) ).add( this.velocity ).sub(flow);
			_vp.y -= wv * 0.7; // actual relative fluid velocity, including local vertical water motion
			const n = _n.copy( s.n ).applyQuaternion( this.quaternion );
			const vn = _vp.dot( n ), vm = _vp.length();
			// planing pressure along the panel normal: lift, induced drag, chine grip, pitch damping
			let panelK=0.5*RHO*(vn>0?S.lift:S.suction)*aw*vm;
			let pn=panelK*vn;
			// slam: the panel entering the water fast (Wagner): the momentum of the added mass it hits
			// (by the immersion rate, not v . n: a panel skimming at speed over a steady surface is planing, not slamming)
			const vi = Math.min( rate, vn + 1 );
			if ( vi > 1.2 && vn > 0 && s.wetPrev < 0.5 ) {

				let ps = 0.5 * RHO * S.slam * aw * vi * vi;
				ps = Math.min( ps, 0.6 * ( m / this.samples.length ) * vi / h ); // never reverse it in a step
				// The impact resistance enters the same coupled solve. Its
				// effective point mass includes translation and rotation.
				panelK+=ps/Math.max(vn,1e-6);pn+=ps;
				if ( vi > maxSlam ) { maxSlam = vi; slamZ = s.p.z; }

			}

			s.wetPrev = Math.min( 1, d / 0.05 );
			fluid.point(panelK,pb,n,_waterVelocity);
			liftX += pn * ( - n.dot( fwd ) );
			// skin friction on the wetted panel (tangential flow)
			_t.copy( _vp ).addScaledVector( n, - vn );
			const vt = _t.length();
			if ( vt > 1e-3 ) {

				const ff = cfH * aw * vt * vt * ( s.kind === 'sponson' ? 2 : 1 );
				fric += ff;
				fluid.point(ff/vt,pb,_t.multiplyScalar(1/vt),_waterVelocity);

			}

			// strakes / chine edges / keel: lateral lift ~ u * slip (grows with speed), stalls past
			// ~20 deg of slip (the ski slides), plus cross-flow drag
			_a.copy( _vp ).applyQuaternion( invQ );
			const us = Math.abs( _a.z ), ws = _a.x;
			const slip = Math.atan2( Math.abs( ws ), Math.max( us, 0.5 ) );
			const grip = S.strake * ( 1 - 0.7 * sstep( slip, S.slipStall[ 0 ], S.slipStall[ 1 ] ) ) * ( s.kind === 'sponson' ? 1.6 : s.kind === 'chine' ? 1 : 0.8 ) * ( s.p.z < - 1.2 ? 0.1 : s.p.z < - 0.6 ? 0.35 : 1 ); // (the flat pad and ride plate aft barely grip: the strakes forward carve)
			fluid.point(.5*RHO*aw*(grip*us+S.crossFlow*Math.abs(ws)),pb,side,_waterVelocity);
			// buried past the chine (nose-dive): the deck pushes water
			const buryAt = 0.3 + S.bowDeck * bowK;
			if ( d > buryAt ) {

				const bd = 0.5 * RHO * S.bury * s.area * Math.min( 1, ( d - buryAt ) / 0.2 );
				fluid.isotropic(bd*vm,pb,_waterVelocity);

			}

		}

		const wetF = this.wetFraction = total > 0 ? wet / total : 0;
		const wetD = Math.min( 1, wetF * 2 );
		this.drag.friction = fric; this.drag.induced = liftX;

		// ---- the plough (rocket speeds): a hull that comes down at 200 km/h buries its spray sheet and loses its
		// heave into the water (added mass, spray, the wave it makes); it does not bounce back off its own trim lift
		// (measured before this term: 93 % of the landing sink speed came back as the next take-off, so it flew 80 %
		// of the time). A vertical damper on the whole ski as it rises off the water (faster than the water's own rise),
		// by how much of the bottom is wet, over the aeroOn band only: the ride and the hops below 95 km/h are as tuned.
		const pk = S.plough * sstep( au, S.aeroOn[ 0 ], S.aeroOn[ 1 ] ) * wetD;
		if ( pk > 0 ) {

			// the surface under the ski rises with the water's own motion and as the ski runs up a face: rising with it is
			// riding the wave, only rising faster than it (a take-off) is damped
			let wv = 0, gx = 0, gz = 0;
			const nq = Math.max( 1, this.qpts.length );
			for ( let j = 0; j < this.qpts.length; j ++ ) { wv += this.waterV[ j ]; gx += this.sgx[ j ]; gz += this.sgz[ j ]; }
			const rise = ( wv + S.ploughFace * ( this.velocity.x * gx + this.velocity.z * gz ) ) / nq;
			if(this.velocity.y>rise){_waterVelocity.copy(flow);_waterVelocity.y=rise;fluid.point(m*pk,comW,_yAxis,_waterVelocity);} // rising only: the landing itself is the slam's

		}

		// ---- displacement hump (the ski pushes a bow wave until it is up on the plane) + the bow
		// rising over it
		const hump = S.hump * m * GRAV * Math.exp( - ( ( ( au - S.humpSpeed ) / S.humpWidth ) ** 2 ) ) * wetD * Math.sign( u );
		this.drag.hump = Math.abs( hump );
		if(au>1e-8)fluid.point(Math.abs(hump)/au,comW,fwd,flow);
		const humpT = S.humpTrim * Math.exp( - ( ( ( au - S.humpSpeed * 0.9 ) / S.humpWidth ) ** 2 ) ) * wetD;
		T.addScaledVector( side, - humpT );

		const app = 0.5 * RHO * S.appendage * u * au * wetD;
		this.drag.appendage = Math.abs( app );
		fluid.point(.5*RHO*S.appendage*au*wetD,this.toWorld(_v.set(0,-.22,-1.2),_c2),fwd,flow);

		// ---- air drag (rider + ski)
		const cda = ( this.driven ? S.airCdA - ( S.airCdA - S.airCdATuck ) * Math.max( this.leanFwd, 0 ) : 0.35 ) + S.mateCdA * ( this.massMate || 0 ) / S.massMate;
		fluid.isotropic(.5*RHO_AIR*cda*airSpeed,comW,airVelocity);
		this.drag.air = 0.5 * RHO_AIR * cda * airSpeed * airSpeed;

		// ---- jet: thrust only with the intake in the water; the nozzle vectors it (no thrust, no steering)
		const ip = this.toWorld( _v.fromArray( S.intake ), _c2 );
		let di = - 1;
		{

			// water depth at the intake: nearest keel samples
			let best = Infinity;
			for ( let i = 0; i < this.samples.length; i ++ ) {

				const s = this.samples[ i ];
				if ( s.kind !== 'bottom' ) continue;
				const dz = Math.abs( s.p.z - S.intake[ 2 ] );
				if ( dz < best ) { best = dz; di = this.depth[ i ] + ( s.p.y - S.intake[ 1 ] ); }

			}

		}

		// the pump stays full for a moment when the hull hops off a crest (it ventilates after ~0.15 s out)
		const primeT = sstep( di, - 0.02, 0.08 ) * ( up.y > 0.2 ? 1 : 0 );
		this.prime = primeT >= this.prime ? primeT : this.prime + ( primeT - this.prime ) * ( 1 - Math.exp( - h / S.primeHold ) );
		const vj = S.jetSpeed * this.rpm;
		let thrust = RHO * S.nozzleArea * vj * ( vj - S.ram * Math.max( u, 0 ) );
		thrust = Math.max( thrust, - 40 ) * this.prime;
		const delta = this.steer * S.nozzleMax;
		const jo = this.toWorld( _v.fromArray( S.jetOut ), _c3 );
		// forward: (-sin d, 0, cos d) in the ski frame; the bucket turns it astern (steering keeps its sense)
		const fwdT = thrust * ( 1 - this.bucket );
		const revT = RHO * S.nozzleArea * vj * vj * S.bucketEff * this.bucket * this.prime;
		_v.set( - Math.sin( delta ) * ( fwdT + 0.6 * revT ), - 0.12 * revT, Math.cos( delta ) * fwdT - revT );
		this.thrust = fwdT - revT;
		addAt( _v.applyQuaternion( this.quaternion ), jo );

		// ---- the rocket pod: thrust from the bell exit, aimed through the centre of gravity (no moment of its own;
		// the kick as it lights is the rider popping the bow). It burns in the air too.
		this.rocketForce = 0;
		if ( this.boosting ) {

			const ro = _v.fromArray( S.rocketOut );
			this.rocketForce = S.rocketThrust * Math.min( 1, this.boostLevel * 1.5 );
			_c2.copy( this.com ).sub( ro ); _c2.x = 0;
			_c2.normalize().multiplyScalar( this.rocketForce ).applyQuaternion( this.quaternion );
			addAt( _c2, this.toWorld( ro, _c3 ) );

		}

		// ---- aero: the pod's fins and the hull as air surfaces (still air; see SKI.finK). A finned rocket's weathervane:
		// the fins' normal force against the cross-flow at finAt, behind the centre of gravity, turns the nose back into
		// the airflow; the fins' own motion as the ski pitches or yaws adds damping. The hull: anti-lift and downforce.
		{

			const ae = sstep( airSpeed, S.aeroOn[ 0 ], S.aeroOn[ 1 ] );
			const fw = this.toWorld( _v.fromArray( S.finAt ), _c2 );
			_vp.copy( this.angular ).cross( _r.copy( fw ).sub( comW ) ).add( airRelative ).applyQuaternion( invQ );
			const vf = _vp.length();
			if ( ae > 0 && vf > 1 ) {

				const k = 0.5 * RHO_AIR * S.finK * vf * ae; // q alpha = 1/2 rho v^2 (v_perp / v)
				fluid.point(k,fw,side,airVelocity);fluid.point(k,fw,up,airVelocity);

			}

			const va = airSpeed, ha = S.hullAero, airLocal=airRelative.clone().applyQuaternion(invQ);
			if ( ae > 0 && va > 1 ) {

				const fy=-.5*RHO_AIR*ae*ha[1]*airLocal.z*Math.abs(airLocal.z);
				// The old +k*v_y term was anti-damping. Hull cross-flow
				// resistance opposes local motion; empirical downforce stays explicit.
				fluid.point(.5*RHO_AIR*ae*ha[0]*va,this.toWorld(_v.fromArray(S.hullAt),_c3),up,airVelocity);
				addAt( _f.set( 0, fy, 0 ).applyQuaternion( this.quaternion ), this.toWorld( _v.fromArray( S.hullAt ), _c3 ) );
				_a.copy( this.angular ).applyQuaternion( invQ );
				fluid.angular(S.aeroDamp[0]*va*ae,side);fluid.angular(S.aeroDamp[1]*va*ae,up);fluid.angular(S.aeroDamp[2]*va*ae,fwd);

			}

		}

		// ---- the rider: holds the bank with his body into the turn; pop; air control
		const bank = this.bank = Math.asin( clamp( side.y, - 1, 1 ) );
		this.pitchAngle = Math.asin( clamp( fwd.y, - 1, 1 ) );
		_a.copy( this.angular ).applyQuaternion( invQ );
		this.yawRate = _a.y;
		this.slip = Math.atan2( _vl.x, Math.max( Math.abs( u ), 0.5 ) );
		const tl = _c1.set( 0, 0, 0 ); // local torque
		if ( this.driven && up.y > 0.3 ) {

			if ( wetF > 0.04 ) {

				const want = - this.leanLat * S.riderBank * ( 0.25 + 0.75 * sstep( au, 2, 10 ) );
				const rmax = S.riderRollMax * ( S.lowRollMin + ( 1 - S.lowRollMin ) * sstep( au, S.lowRoll[ 0 ], S.lowRoll[ 1 ] ) );
				tl.z = this.rollT = clamp( ( want - bank ) * S.riderRollK - _a.z * S.riderRollD, - rmax, rmax );
				if ( this._popT > 0 ) tl.x -= S.popTorque;

			} else {

				// airborne: Shift (and W, lightly: it is held for speed) noses down, S / Space up; A / D roll a
				// little. With no input his body soaks up the pitch and roll he left the face with and holds the
				// nose a touch up for the landing (bounded: he cannot stop a real over-rotation)
				const I = this.input;
				const pin = clamp( I.tuck, 0, 1 ) - clamp( I.brake + I.back, 0, 1 );
				const hold = 1 - Math.min( 1, Math.abs( pin ) + Math.abs( I.steer ) );
				let gf = 0;
				if ( S.airMatch > 0 ) {

					const fh = Math.hypot( fwd.x, fwd.z ) || 1, nq = Math.max( 1, this.qpts.length );
					for ( let j = 0; j < this.qpts.length; j ++ ) gf += ( this.sgx[ j ] * fwd.x + this.sgz[ j ] * fwd.z ) / fh;
					gf = clamp( Math.atan( gf / nq ) * S.airMatch, - S.airMatchMax, S.airMatchMax );

				}

				const ah = S.airHold, trim = S.airTrim + S.airThrottleTrim * clamp( I.throttle, 0, 1 ) + gf;
				// (+x torque is nose down: below the trim he pushes the nose up, above it he lets it down)
				tl.x += S.airPitch * pin + clamp( ( this.pitchAngle - trim ) * ah[ 0 ] * hold - _a.x * ah[ 1 ], - ah[ 2 ], ah[ 2 ] );
				tl.z += - S.airRoll * I.steer + clamp( - bank * 900 * hold - _a.z * 160, - 400, 400 );

			}

		}

		this._popT = Math.max( 0, this._popT - h );
		// porpoising: a little extra pitch-rate damping from the wetted bottom
		fluid.angular(90*wetD,side);
		T.add( tl.applyQuaternion( this.quaternion ) );

		// ---- contacts: terrain, piles, vessels
		this.contacts( F, T, comW );
		this.solidContacts( F, T, comW, h );

		// Coupled implicit resistance; hydrostatic, contact and drive forces remain
		// explicit external loads. No velocity or angular-speed cap is needed.
		const am=S.addedMass,ai=S.addedInertia,In=this.inertia;
		fluid.solve(h,this.quaternion,
		 [m*(1+am[0]*wetD),m*(1+am[1]*wetD),m*(1+am[2]*wetD)],
		 [In.x*(1+ai[0]*wetD),In.y*(1+ai[1]*wetD),In.z*(1+ai[2]*wetD)],
		 this.velocity,this.angular,F,T);
		comW.addScaledVector( this.velocity, h );
		const w = this.angular, ang = w.length() * h;
		if ( ang > 1e-8 ) {

			_dq.setFromAxisAngle( _v.copy( w ).normalize(), ang );
			this.quaternion.premultiply( _dq ).normalize();

		}

		// righting a capsized ski (E from the water): he rolls it back over by hand
		if ( this.righting > 0 ) {

			this.righting = Math.max( 0, this.righting - h );
			const yaw = this.getYaw();
			_q.setFromAxisAngle( _yAxis, yaw );
			this.quaternion.slerp( _q, 1 - Math.exp( - h / 0.35 ) );
			this.angular.multiplyScalar( 0.9 );

		}

		this.position.copy( comW ).sub( _v.copy( this.com ).applyQuaternion( this.quaternion ) );

		// ---- events: air time, landings, slams, crashes
		// the hardest panel entry across the whole touchdown (the bow can hit a step before the hull counts as wet)
		this._airSlam = this.airborne ? Math.max( this._airSlam || 0, maxSlam ) : maxSlam;
		const air = wetF < 0.015 && this.onSolid === 0; // riding up a ramp is not air
		if ( air ) {

			if ( ! this.airborne ) { this.airborne = true; this.airTime = 0; this._airY0 = this.position.y; this._airPeak = this.position.y; this._airV0 = this.speed; this._airClr = 0; }
			this._airClr = Math.max( this._airClr, - dMax ); // clearance: the lowest point of the hull above the water under it
			this.airTime += h;
			this._airPeak = Math.max( this._airPeak, this.position.y );

		} else if ( this.airborne ) {

			this.airborne = false;
			if ( this.airTime > 0.12 ) {

				const land = { type: 'land', noseIn: this.pitchAngle < - 14 * DEG, air: this.airTime, height: this._airClr, rise: this._airPeak - this._airY0, vn: this._airSlam, pitch: this.pitchAngle, speedBefore: this._airV0, speed: this.speed };
				this.lastAir = land;
				this.maxAirHeight = Math.max( this.maxAirHeight, land.height );
				this.events.push( land );
				// nose-dive or a flat drop from high: he is thrown
				if ( this.driven && ( ( this._airSlam > 5 && this.pitchAngle < - 32 * DEG ) || this._airSlam > ( this.pitchAngle > - 15 * DEG && Math.abs( this.bank ) < 30 * DEG ? S.landFlat + ( S.landFast[ 2 ] - S.landFlat ) * sstep( this.speed, S.landFast[ 0 ], S.landFast[ 1 ] ) : 9 ) || ( this._airSlam > 3.5 && Math.abs( this.bank ) > S.landBank ) ) ) this.crash( 'landing', maxSlam );

			}

		}

		if ( maxSlam > 1.8 ) this.events.push( { type: 'slam', vn: maxSlam, z: slamZ } );

		if ( up.y < Math.cos( 100 * DEG ) ) this._rolled += h;
		else this._rolled = 0;
		if ( this._rolled > 0.25 ) {

			if ( this.driven ) this.crash( 'roll', 1 );
			this.capsized = true;

		} else if ( up.y > 0.6 ) this.capsized = false;
		// spinning out at speed (slip past ~75 deg above 50 km/h) throws him too
		if ( this.driven && au < 4 && this.speed > 14 && Math.abs( this.slip ) > 1.3 && wetF > 0.1 ) this.crash( 'spin', this.speed / 20 );

	}

	crash( kind, strength ) {

		this.driven = false;
		this.engineOn = false; // lanyard
		this.throttle = 0;
		this.brake = 0;
		this.events.push( { type: 'crash', kind, strength } );

	}

	isFinite() {

		const ok = ( v ) => Number.isFinite( v.x ) && Number.isFinite( v.y ) && Number.isFinite( v.z );
		return ok( this.position ) && ok( this.velocity ) && ok( this.angular ) && ok(this.quaternion) && Number.isFinite( this.quaternion.w );

	}

	// floating solids the hull panels ride on (Course.js kicker ramps): a stiff penalty along the surface normal,
	// damped, with wet-plastic friction, spread over the panels by area; the reaction goes back to the solid
	solidContacts( F, T, comW, h ) {

		this.onSolid = 0;
		const list = this.solids ? this.solids() : null;
		if ( ! list || ! list.length ) return;
		const S = SKI, hit = _hit;
		for ( const sd of list ) {

			if ( sd.position.distanceToSquared( this.position ) > sd.reach2 ) continue;
			for ( const s of this.samples ) {

				const pw = this.toWorld( s.p, _sp );
				const pen = sd.probe( pw, hit );
				if ( pen <= 0 ) continue;
				const w = s.area / this.waterplane;
				const vp = _sv.copy( this.angular ).cross( _sr.copy( pw ).sub( comW ) ).add( this.velocity ).sub( hit.v );
				const vn = vp.dot( hit.n );
				const fn = ( S.solidK * pen - S.solidC * vn ) * w;
				if ( fn <= 0 ) continue;
				const f = _sf.copy( hit.n ).multiplyScalar( fn );
				vp.addScaledVector( hit.n, - vn ); // sliding
				const vt = vp.length();
				if ( vt > 1e-3 ) f.addScaledVector( vp, - S.solidMu * fn * Math.min( vt / 0.3, 1 ) / vt );
				F.add( f );
				T.add( _sr.cross( f ) );
				sd.push( f, pw, h, hit.lz, hit.lx );
				this.onSolid ++;

			}

		}

	}

	contacts( F, T, comW ) {

		const pts = this._cp || ( this._cp = [
			[ 0, 0.05, 1.68 ], [ 0, - 0.27, 1.0 ], [ 0, - 0.27, - 0.3 ], [ 0, - 0.25, - 1.5 ],
			[ 0.55, - 0.08, 0.8 ], [ - 0.55, - 0.08, 0.8 ], [ 0.58, - 0.05, - 1.45 ], [ - 0.58, - 0.05, - 1.45 ],
			[ 0.5, 0.34, 1.2 ], [ - 0.5, 0.34, 1.2 ], [ 0.5, 0.34, - 1.5 ], [ - 0.5, 0.34, - 1.5 ], [ 0, 1.0, 0.3 ],
		].map( ( a ) => new THREE.Vector3().fromArray( a ) ) );
		const pw = _c1, vp = _c2, f = _c3, r = _r;
		let lift = 0;
		for ( const lp of pts ) {

			this.toWorld( lp, pw );
			const g = this.terrain.heightAt( pw.x, pw.z );
			const pen = g - pw.y;
			if ( pen <= 0 ) continue;
			vp.copy( this.angular ).cross( r.copy( pw ).sub( comW ) ).add( this.velocity );
			const fn = Math.max( pen * 90000 - Math.min( vp.y, 0 ) * 6000, 0 );
			// sliding friction on sand / rock (mu ~0.45 of the normal load), capped by what stops it in a step
			const vh = Math.hypot( vp.x, vp.z );
			const ff = vh > 1e-3 ? Math.min( 0.45 * fn, this.mass * vh / H * 0.1 ) / vh : 0;
			f.set( - vp.x * ff, fn, - vp.z * ff );
			F.add( f );
			T.add( r.copy( pw ).sub( comW ).cross( f ) );
			lift = Math.max( lift, pen );
			if ( - vp.y > 4 ) this.events.push( { type: 'hit', what: 'ground', v: - vp.y } );

		}

		// beached (the hull on the ground, the intake dry, all but stopped): S has him walk it back off the sand
		// stern first at a slow push (pushSpeed), until the intake is wet again; the push beats the sand's friction
		// (at most pushGrip of the weight, rider and mate included) and puts no turn on the hull
		// (the hull rocks on and off the sand from one substep to the next: aground counts for groundHold s after a contact)
		const I = this.input;
		this.groundAge = lift > 0 ? 0 : ( this.groundAge ?? 1 ) + H;
		this.beached = this.driven && this.groundAge < SKI.groundHold && this.prime < 0.5 && this.speed < 1.2;
		this.pushing = this.beached && I.brake > 0.5 && I.throttle < 0.1;
		if ( this.pushing ) {

			const back = _c1.set( 0, 0, - 1 ).applyQuaternion( this.quaternion ).setY( 0 );
			if ( back.lengthSq() > 1e-4 ) {

				back.normalize();
				const vb = this.velocity.x * back.x + this.velocity.z * back.z;
				F.addScaledVector( back, clamp( this.mass * ( SKI.pushSpeed - vb ) * SKI.pushGain, 0, this.mass * 9.81 * SKI.pushGrip ) );

			}

		}

		// never tunnel: a deep penetration is resolved positionally
		if ( lift > 0.22 ) {

			this.position.y += lift - 0.22;
			comW.y += lift - 0.22;
			if ( this.velocity.y < 0 ) this.velocity.y *= 0.2;

		}

		const outline = this._ol || ( this._ol = [
			[ 0, 0.2, 1.65 ], [ 0.6, 0.2, 0.5 ], [ - 0.6, 0.2, 0.5 ], [ 0.6, 0.2, - 0.8 ], [ - 0.6, 0.2, - 0.8 ], [ 0.5, 0.2, - 1.6 ], [ - 0.5, 0.2, - 1.6 ],
		].map( ( a ) => new THREE.Vector3().fromArray( a ) ) );
		const tmp = _pd;
		// c: the capsule hit (soft ones, the course buoys: their own stiffness and damping, no hard stop, and the
		// reaction goes back to them through onHit)
		const push = ( dx, dz, c = null ) => {

			vp.copy( this.angular ).cross( r.copy( pw ).sub( comW ) ).add( this.velocity );
			const len = Math.hypot( dx, dz ) || 1, nx = dx / len, nz = dz / len;
			const vn = vp.x * nx + vp.z * nz; // < 0: moving into it
			const soft = !! ( c && c.soft );
			if ( vn < - 3 ) this.events.push( { type: 'hit', what: soft ? 'buoy' : 'solid', v: - vn } );
			const fn = Math.max( 0, len * ( soft ? c.k : 120000 ) - Math.min( vn, 0 ) * ( soft ? c.c : 9000 ) );
			const fr = soft ? 20 : 300;
			f.set( nx * fn - vp.x * fr, 0, nz * fn - vp.z * fr );
			F.add( f );
			T.add( r.copy( pw ).sub( comW ).cross( f ) );
			if ( soft ) { if ( c.onHit ) c.onHit( f, pw, this._h || H ); return; }
			// hard stop: a big overlap is resolved positionally and the approach speed killed
			if ( len > 0.15 ) {

				this.position.x += nx * ( len - 0.15 ); this.position.z += nz * ( len - 0.15 );
				comW.x += nx * ( len - 0.15 ); comW.z += nz * ( len - 0.15 );
				const vv = this.velocity.x * nx + this.velocity.z * nz;
				if ( vv < 0 ) { this.velocity.x -= vv * nx * 1.3; this.velocity.z -= vv * nz * 1.3; }

			}

		};

		const caps = this.vessels ? this.vessels() : null;
		for ( const lp of outline ) {

			this.toWorld( lp, pw );
			if ( this.colliders ) {

				tmp.copy( pw );
				tmp.y -= 0.9;
				if ( this.colliders.resolveCapsule( tmp, 0.2, 1.6, 0 ) ) push( tmp.x - pw.x, tmp.z - pw.z );

			}

			if ( caps ) for ( const c of caps ) {

				// distance to the segment a-b in plan
				const ax = c.a.x, az = c.a.z, bx = c.b.x - ax, bz = c.b.z - az;
				const tt = clamp( ( ( pw.x - ax ) * bx + ( pw.z - az ) * bz ) / Math.max( bx * bx + bz * bz, 1e-6 ), 0, 1 );
				const qx = pw.x - ( ax + bx * tt ), qz = pw.z - ( az + bz * tt );
				const dd = Math.hypot( qx, qz );
				if ( dd < c.r && pw.y < c.top ) push( qx / Math.max( dd, 1e-3 ) * ( c.r - dd ), qz / Math.max( dd, 1e-3 ) * ( c.r - dd ), c );

			}

		}

	}

	telemetry() {

		const r1 = ( v, k = 100 ) => Math.round( v * k ) / k;
		return {
			kmh: r1( this.speed * 3.6, 10 ), u: r1( this.forwardSpeed ), rpm: r1( this.rev ), throttle: r1( this.throttle ), brake: r1( this.brake ),
			steer: r1( this.steer ), bank: r1( this.bank / DEG, 10 ), pitch: r1( this.pitchAngle / DEG, 10 ), slip: r1( this.slip / DEG, 10 ),
			yawRate: r1( this.yawRate, 1000 ), passenger: Math.round( this.massMate || 0 ), mass: Math.round( this.mass ), wet: r1( this.wetFraction ), beached: !! this.beached, pushing: !! this.pushing, prime: r1( this.prime ), thrust: Math.round( this.thrust ),
			air: this.airborne, onSolid: this.onSolid, airTime: r1( this.airTime ), lastAir: this.lastAir, maxAirHeight: r1( this.maxAirHeight ),
			driven: this.driven, engineOn: this.engineOn, capsized: this.capsized, y: r1( this.position.y ), ms: r1( this.stats.ms, 1000 ),
			fuel: r1( this.fuel ), boosting: this.boosting, boost: r1( this.boostLevel ), rocketN: Math.round( this.rocketForce ), subSteps: this.subSteps, rollT: Math.round( this.rollT ),
			drag: { friction: Math.round( this.drag.friction ), hump: Math.round( this.drag.hump ), air: Math.round( this.drag.air ), induced: Math.round( this.drag.induced ) },
		};

	}

}
