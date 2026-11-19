// Other people's cars on the ferry service. At each terminal a queue waits in the marshalling
// lanes (topped up by cars driving in from beyond the boom gate); once her ramp is down at that
// berth the cars that crossed with her drive off first (aft down their lanes, down the ramp, over
// the linkspan and out past the gate, where they go), then the queue drives aboard nose to tail:
// over the linkspan and up her ramp at walking pace, up her centre lane, round at the bow and aft
// down the outer lanes to park facing the stern, ready to drive off at the far side. No car parks
// in her centre lanes; they only drive up them, because both outer lanes fill from the stern and
// the centre is the one lane with no parked car in it. Scripted: each car stops and waits for any
// car ahead of it in the order and gives way to the player's car (app.rally): it stops and waits
// whenever that car's footprint, now or where its velocity takes it over the next LOOK s, comes
// within CLEAR of the road this car is about to drive (playerInWay), and no car starts aboard
// while the player's car is moving through the lanes, over the linkspan or on her deck (SETTLE).
// The timetable holds
// her ramp down until the cars that started are clear (holding()). A boarding car held up by the
// player's car for STUCK seconds gives way: if it has turned at her bow it parks where it stands,
// otherwise it backs out to its place in the queue, with every car boarding behind it, and no
// more cars start aboard at that call (so a player parked in the way never keeps her at the berth).
// Solid: each car near the player's has two kinematic bodies in the car physics (solid()), so the
// player's car stops against it. Aboard, a car's pose is kept in her frame, so it rides with her.
//   ferry.traffic.update( dt ), ferry.traffic.state(), ferry.traffic.holding()
import { Group, Mesh, Vector3, Quaternion, Matrix4, InstancedMesh, mergeGeometries } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { WheelRig } from './trafficWheels.js';

const MODELS = [ 'ParkedAster', 'ParkedJeep', 'ParkedWagon', 'ParkedPickup' ];
// each model's wheel nodes in parked_cars.glb (<model>WheelFrontL ..), fronts first: they steer
const WHEELS = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];
const YARD = 3.2, DECK = 2.6;          // m: the yard's paving (terminal frame), her vehicle deck (her frame)
const LANES = [ 0.75, 4.0 ];           // terminal x of the two marshalling lanes cars queue in
const HEAD = - 48, STEP = 7.5;         // terminal z of the queue's head (a clear apron off the linkspan for cars driving or backing off), and the spacing back from it
const GATE = - 100, CHECK = - 3.15;    // where cars appear and go, beyond the boom gate; its lane (x)
const ARM = - 83.675;                  // terminal z of the check-in boom's arm (Terminal.openBoom lifts it)
const LAND = 4.0, SLOW = 1.6;          // m/s across the yard; through the check-in and when backing
const RAMP = 2.2, DECK_V = 3.2, TURN = 2.4;   // m/s over the linkspan and her ramp; along her deck; round the turn at her bow and into a slot
const GAP = 7.5;                       // m, nose to nose, behind the car ahead
const SIDE = 4.9;                      // her outer lanes' middles (|x|, outboard of the yellow lines); the centre lanes are the player's
// her deck's parking slots [ side, z ], facing aft; aftmost first, so later cars never pass a parked one
const SLOTS = [ - 19.5, - 14, - 4.5, 1, 6.5 ].flatMap( z => [ [ 1, z ], [ - 1, z ] ] );
const PLAYER_OFF = 60;                 // s after her ramp is down that the queue waits for the player's car to drive off
const PLAYER_HOLD = 120;               // s past her timetable she waits for the player's car coming aboard
const MAX_HOLD = 75;                   // s past her timetable after which no more cars start aboard
const STUCK = 15;                      // s held up by the player's car before a boarding car gives way
const NEAR = 250;                      // m from the player's car inside which a car has a solid body
const REACH = 9;                       // m of its own road ahead (backing: behind) a car checks for the player's car
const LOOK = 1.6;                      // s ahead the player's car is predicted along its velocity
const CLEAR = 2.3;                     // m, footprint to road: both cars' half widths and a margin (a lane apart is 3.25)
const PLAYER_HALF = 2.3;               // m, half the player's car's length along its heading
const SETTLE = 3;                      // s the player's car stands still in the lanes or aboard before a car starts aboard
const ID = 1000;                       // car physics remote ids from here, four a car (SharedDrive's players use 1 up)
// Each model fitted with the car physics' collider shapes (rally-physics vehicle.rs): the shape
// (0 the Aster's, 4.10 m long; 1 the Jeep's, 4.16 m and taller), how far the body's origin sits
// above the model's tyres (the player's Aster rests with its origin 0.03 m above the ground), and
// the fore and aft offset of two such bodies that together span the model's length (4.66 m,
// 5.02 m, 4.96 m, 5.56 m, measured from parked_cars.glb). The shapes stand 0.40 m or more off the
// ground, a lip another car's body can ride up onto, so a second pair sits LOW lower to close it.
const LOW = 0.28;
const FIT = { ParkedAster: [ 0, 0.03, 0.28 ], ParkedWagon: [ 0, 0.1, 0.46 ], ParkedJeep: [ 1, - 0.25, 0.4 ], ParkedPickup: [ 1, - 0.3, 0.7 ] };

const _v = new Vector3(), _w = new Vector3(), _u = new Vector3(), _f = new Vector3(), _s = new Float32Array( 8 ), _q = new Quaternion(), _p = new Quaternion(), _up = new Vector3( 0, 1, 0 ), _x = new Vector3( 1, 0, 0 );
const _m = new Matrix4(), _r = new Quaternion(), _one = new Vector3( 1, 1, 1 );
const rand = ( a, b ) => a + Math.random() * ( b - a );
const bySlot = ( a, b ) => a.slot - b.slot;
// is q ahead of p along heading (hx, hz) (length h): in a cone, or a corridor 2.6 m either side (see blocked)
function ahead( p, hx, hz, h, q, gap, cone ) {

	const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot( dx, dz );
	if ( Math.abs( q.y - p.y ) > 2.5 ) return false;
	const along = ( dx * hx + dz * hz ) / h, side = Math.abs( dx * hz - dz * hx ) / h;
	return cone ? ( d < 3.4 && along > - 1 ) || ( d < gap && along > 0.55 * d ) : along > - 1 && along < gap && side < 2.6;

}

export class Traffic {

	constructor( app, ferry ) {

		this.app = app;
		this.ferry = ferry;
		this.cars = [];
		this.pool = new Map( MODELS.map( n => [ n, [] ] ) );
		this.parts = null;              // model name -> [ { geometry, material, castShadow } ]
		this.seq = 0;
		this.held = 0;
		this.playerHeld = 0;           // s her departure has waited for the player's car coming aboard
		this.shut = false;              // a car gave way to the player's car: no more start aboard this call
		this.stops = new Map();         // terminal name -> { want, spawn, boarding, started }
		this.physics = null;            // the car physics the bodies below live in
		this.bodies = new Set();        // ids of the cars with solid bodies in it

	}

	async init() {

		const model = await loadModel( `${ import.meta.env.BASE_URL }ferry/parked_cars.glb` );
		this.parts = new Map( MODELS.map( n => [ n, ( model.pivots.get( n )?.children || [] ).filter( c => c.isMesh ) ] ) );
		this.wheelMeshes( model );
		for ( const b of this.ferry.berths ) {

			const stop = this.stop( b.terminal );
			for ( let i = 0; i < stop.want; i ++ ) this.spawn( b.terminal, true );

		}

	}

	stop( terminal ) {

		let s = this.stops.get( terminal.name );
		if ( ! s ) this.stops.set( terminal.name, s = { want: 6 + Math.floor( Math.random() * 4 ), spawn: rand( 2, 5 ), boarding: false } );
		return s;

	}

	// A car for the queue at `terminal`: in its place already (at start), or driving in from the gate.
	spawn( terminal, placed = false ) {

		// the first free place in the lanes, from the head back
		const taken = new Set( this.cars.filter( c => c.terminal === terminal && ( c.state === 'queue' || c.state === 'back' ) ).map( c => c.at.join() ) );
		let k = 0;
		while ( taken.has( [ LANES[ k % 2 ], YARD, HEAD - STEP * Math.floor( k / 2 ) ].join() ) ) k ++;
		const lane = LANES[ k % 2 ], z = HEAD - STEP * Math.floor( k / 2 );
		const name = MODELS[ Math.floor( Math.random() * MODELS.length ) ];
		const car = { id: ++ this.seq, seq: this.seq, name, group: this.body( name ), terminal, state: 'queue', lane, path: null, s: 0, v: 0, local: null, slot: null, driverIn: true, from: null };
		// in through the check-in lane under the boom, then over to the queue's lane
		car.path = placed ? null : this.route( car, [ [ 'T', CHECK, YARD, GATE, LAND ], [ 'T', CHECK, YARD, ARM - 6, SLOW ], [ 'T', CHECK, YARD, ARM + 4, SLOW ], [ 'T', lane, YARD, ARM + 11, LAND ], [ 'T', lane, YARD, z, LAND ] ] );
		car.at = [ lane, YARD, z ];
		this.cars.push( car );
		this.pose( car );
		return car;

	}

	body( name ) {

		const free = this.pool.get( name ).pop();
		if ( free ) { free.visible = true; this.app.scene.add( free ); return free; }
		const g = new Group();
		g.name = 'TrafficCar:' + name;
		for ( const part of this.merged( name ) ) {

			const m = new Mesh( part.geometry, part.material );
			m.castShadow = part.castShadow;
			m.receiveShadow = true;
			g.add( m );

		}
		this.wheelsFor( g, name );
		this.app.scene.add( g );
		return g;

	}

	// A model's parts merged per material and shadow flag (13 to 17 parts come down to a few draws), built once
	// and shared by every car of that model. Parts whose attributes don't match stay separate.
	merged( name ) {

		this._merged = this._merged || new Map();
		let out = this._merged.get( name );
		if ( out ) return out;
		const groups = new Map();
		for ( const part of this.parts.get( name ) || [] ) {

			const key = part.material.uuid + ( part.castShadow ? '+' : '-' ) + Object.keys( part.geometry.attributes ).sort().join() + ( part.geometry.index ? 'i' : 'n' );
			if ( ! groups.has( key ) ) groups.set( key, [] );
			groups.get( key ).push( part );

		}
		out = [];
		for ( const list of groups.values() ) {

			const geometry = list.length > 1 ? mergeGeometries( list.map( p => p.geometry ), false ) : null;
			if ( geometry ) { geometry.computeBoundingSphere?.(); out.push( { geometry, material: list[ 0 ].material, castShadow: list[ 0 ].castShadow } ); }
			else for ( const p of list ) out.push( { geometry: p.geometry, material: p.material, castShadow: p.castShadow } );

		}
		this._merged.set( name, out );
		return out;

	}

	// Each model's wheels (tools/ferry/parked_cars.py): its hubs, its front left wheel's parts (the
	// right hand pair is the same wheel turned half round about Y, as on a real car), the tyre's
	// radius and the wheelbase. Each car draws them as one InstancedMesh per wheel material, four
	// instances, inside its own group (wheelsFor). Not one mesh per model across every car: the
	// engine reprojects an instance with this frame's matrix as last frame's (MeshRenderer: prevModel
	// = draw.prevModel * instance), so wheels of moving cars drawn that way had no motion vectors and
	// left dark TAA trails behind the cars (traffic-wheels-closeup.png, 2026-10-05). In the car's
	// group they move with its tracked matrix; only their own roll goes unblurred.
	wheelMeshes( model ) {

		this.wheelSpec = new Map();
		for ( const name of MODELS ) {

			const hubs = [];
			for ( const suffix of WHEELS ) {

				const pivot = model.pivots.get( name + suffix );
				if ( pivot ) hubs.push( pivot.position.clone() );

			}
			const parts = ( model.pivots.get( name + WHEELS[ 0 ] )?.children || [] ).filter( c => c.isMesh );
			// (a GLB from before 2026-10-05 has no wheel nodes: its cars draw without wheels to turn)
			if ( hubs.length < 4 || ! parts.length ) continue;
			// the tyre's radius: the wheel's half height (its mesh is centred on the hub); the
			// wheelbase from the hubs (fronts first)
			let radius = 0;
			for ( const m of parts ) {

				if ( ! m.geometry.boundingBox ) m.geometry.computeBoundingBox();
				radius = Math.max( radius, m.geometry.boundingBox.max.y, - m.geometry.boundingBox.min.y );

			}
			this.wheelSpec.set( name, { hubs, parts, radius, wheelbase: hubs[ 0 ].z - hubs[ 2 ].z } );

		}

	}

	// A car group's wheels: per wheel material an InstancedMesh of the four, at rest at their hubs.
	wheelsFor( g, name ) {

		const spec = this.wheelSpec?.get( name );
		g.wheelMeshes = [];
		if ( ! spec ) return;
		for ( const part of spec.parts ) {

			const mesh = new InstancedMesh( part.geometry, part.material, 4 );
			mesh.name = 'TrafficWheels:' + name + ':' + part.material.name;
			mesh.castShadow = part.castShadow;
			mesh.receiveShadow = true;
			mesh.layers.mask = part.layers.mask;
			g.add( mesh );
			g.wheelMeshes.push( mesh );

		}
		this.placeWheels( g, spec, 0, 0 );
		for ( const mesh of g.wheelMeshes ) mesh.computeBoundingSphere();

	}

	// The four wheels in the car's frame: at the hub, steered (front pair) about the wheel's Y, then
	// rolled about its axle (X). A right hand wheel (k odd) is the left one turned half round: its
	// axle points the other way, so the same roll forward is the opposite angle about it.
	placeWheels( g, spec, steer, spin ) {

		for ( let k = 0; k < 4; k ++ ) {

			const right = k % 2 === 1;
			_r.setFromAxisAngle( _up, ( k < 2 ? steer : 0 ) + ( right ? Math.PI : 0 ) ).multiply( _p.setFromAxisAngle( _x, right ? - spin : spin ) );
			_m.compose( spec.hubs[ k ], _r, _one );
			for ( const mesh of g.wheelMeshes ) mesh.setMatrixAt( k, _m );

		}
		for ( const mesh of g.wheelMeshes ) mesh.instanceMatrix.needsUpdate = true;

	}

	// Every visible car's wheels to its rig's roll and steer, after drive() has moved them.
	drawWheels() {

		if ( ! this.wheelSpec ) return;
		for ( const car of this.cars ) {

			const spec = this.wheelSpec.get( car.name ), g = car.group;
			if ( ! spec || ! g.visible || ! g.wheelMeshes?.length ) continue;
			const rig = car.wheels || ( car.wheels = new WheelRig( spec.radius, spec.wheelbase ) );
			if ( rig.spin === g.drawnSpin && rig.steer === g.drawnSteer ) continue;   // standing: nothing to upload
			g.drawnSpin = rig.spin;
			g.drawnSteer = rig.steer;
			this.placeWheels( g, spec, rig.steer, rig.spin );

		}

	}

	// Test hook: the drawn front left wheel in its car's frame, read back from its instances: its
	// steer, and how far its roll is from the rig's (rad). Null while the car has no wheels drawn.
	drawnWheel( car ) {

		const mesh = car.group.wheelMeshes?.[ 0 ];
		if ( ! mesh || ! car.wheels ) return null;
		const e = _m.fromArray( mesh.instanceMatrix.array, 0 ).elements, steer = Math.atan2( - e[ 2 ], e[ 0 ] );
		const off = Math.atan2( e[ 4 ] * Math.sin( steer ) + e[ 6 ] * Math.cos( steer ), e[ 5 ] ) - car.wheels.spin;
		return { steer, spinError: Math.abs( off - 2 * Math.PI * Math.round( off / ( 2 * Math.PI ) ) ), draws: car.group.wheelMeshes.length };

	}

	// waypoints [ frame 'T' (the car's terminal) | 'S' (her), x, y, z, speed ] into a path
	route( car, points ) { return { points, len: null }; }

	// A waypoint's world position now (her frame follows her).
	world( car, w, out ) { return w[ 0 ] === 'S' ? this.ferry.ship.toWorld( _w.set( w[ 1 ], w[ 2 ], w[ 3 ] ), out ) : car.terminal.toWorld( [ w[ 1 ], w[ 2 ], w[ 3 ] ], out ); }

	board( car, slot ) {

		const [ side, z ] = SLOTS[ slot ], x = car.at[ 0 ], q = car.at[ 2 ], arc = [];
		for ( let k = 0; k <= 8; k ++ ) {

			const t = Math.PI - k * Math.PI / 8;
			arc.push( [ 'S', side * ( 0.5 + 3.7 * Math.cos( t ) ), DECK, 12 + 3.7 * Math.sin( t ), TURN ] );

		}
		car.slot = slot; car.state = 'board'; car.seq = ++ this.seq; car.s = 0; car.from = car.terminal;
		car.path = this.route( car, [ [ 'T', x, YARD, q, LAND ], [ 'T', x, YARD, - 36, LAND ], [ 'T', 0, YARD, - 32, RAMP ], [ 'T', 0, YARD, - 28.25, RAMP ],
			[ 'S', 0, DECK, - 25.2, RAMP ], [ 'S', 0, DECK, 7, DECK_V ], ...arc, [ 'S', side * SIDE, DECK, z, TURN ] ] );

	}

	unload( car, terminal ) {

		// from where she stands: her slot, or where she parked on giving way (settle())
		const [ side ] = SLOTS[ car.slot ], at = car.local;
		car.terminal = terminal; car.state = 'unload'; car.seq = ++ this.seq; car.s = 0;
		car.path = this.route( car, [ [ 'S', at.x, DECK, at.z, TURN ], [ 'S', side * SIDE, DECK, - 20.5, DECK_V ], [ 'S', 0, DECK, - 24.6, TURN ],
			[ 'T', 0, YARD, - 28.25, RAMP ], [ 'T', 0, YARD, - 34, LAND ], [ 'T', CHECK, YARD, - 42, LAND ], [ 'T', CHECK, YARD, ARM + 6, LAND ], [ 'T', CHECK, YARD, ARM - 4, SLOW ], [ 'T', CHECK, YARD, GATE, LAND ] ] );

	}

	update( dt ) {

		if ( ! this.parts ) return;
		const ferry = this.ferry, ship = ferry.ship, service = ferry.service, at = ferry.at?.terminal;
		const open = ship.moored && ferry.ramp >= 1 && ! ferry.castingOff && service.enabled && service.phase === 'loading';
		if ( open && service.wait <= 0 ) this.held += dt; else if ( ! open ) { this.held = 0; this.shut = false; }
		this.boarding = open && this.playerBoarding( at );
		// the player's car on the move in the lanes, over the linkspan or aboard: no car starts aboard
		// until it has stood still for SETTLE s (cars already on their way give way to it: blocked())
		const astir = open && this.playerBoarding( at ) && Math.abs( this.app.rally.state[ 7 ] ) > 1;
		this.playerStill = astir ? 0 : ( this.playerStill ?? SETTLE ) + dt;
		this.rampDownFor = open ? ( this.rampDownFor || 0 ) + dt : 0;
		// (only the time she waits for the player alone counts against PLAYER_HOLD)
		if ( this.boarding && service.wait <= 0 && ! this.trafficHolding() ) this.playerHeld += dt; else if ( ! open ) this.playerHeld = 0;
		for ( const b of ferry.berths ) {

			const t = b.terminal, stop = this.stop( t ), mine = open && t === at;
			// arrivals: aboard from the other side drive off first, once their drivers are back in
			const aboard = this._aboard || ( this._aboard = [] );
			aboard.length = 0;
			for ( const c of this.cars ) if ( c.state === 'parked' && c.from !== t ) aboard.push( c );
			if ( mine ) for ( const c of aboard.sort( bySlot ) ) if ( c.driverIn ) this.unload( c, t );
			// the player driving off counts as an arrival too: the queue waits for them (up to PLAYER_OFF s)
			const playerOff = mine && this.playerAboard() && this.rampDownFor < PLAYER_OFF;
			const unloading = this.cars.some( c => c.state === 'unload' && c.terminal === t && c.s < 60 ) || ( mine && aboard.length ) || playerOff;
			// the queue drives aboard behind them, while slots are free and her timetable allows
			if ( mine && ! unloading && this.held < MAX_HOLD && ! this.shut && this.playerStill > SETTLE ) {

				const used = new Set( this.cars.filter( c => c.slot !== null && ( c.state === 'parked' || c.state === 'board' ) ).map( c => c.slot ) );
				const queue = this.cars.filter( c => c.terminal === t && c.state === 'queue' && ! c.path ).sort( ( a, b ) => a.at[ 2 ] === b.at[ 2 ] ? a.at[ 0 ] - b.at[ 0 ] : b.at[ 2 ] - a.at[ 2 ] );
				const last = this.cars.filter( c => c.state === 'board' ).sort( ( a, b ) => b.seq - a.seq )[ 0 ];
				const free = SLOTS.findIndex( ( s, i ) => ! used.has( i ) );
				if ( queue.length && free >= 0 && ( ! last || last.s > 6 ) ) this.board( queue[ 0 ], free );

			}
			// top the queue up while she is away or boarding elsewhere
			let waiting = 0;
			for ( const c of this.cars ) if ( c.terminal === t && c.state === 'queue' ) waiting ++;
			if ( ! mine && waiting < stop.want && ( stop.spawn -= dt ) <= 0 ) { this.spawn( t ); stop.spawn = rand( 3, 6 ); }

		}

		for ( const car of this.cars ) {

			this.drive( car, dt );
			// the check-in boom lifts for a car coming up to it in its lane, either way
			if ( car.path && car.world ) {

				const t = car.terminal, dx = car.world.x - t.position.x, dz = car.world.z - t.position.z, c = Math.cos( t.yaw ), s = Math.sin( t.yaw );
				if ( Math.abs( dx * c - dz * s - CHECK ) < 2.5 && Math.abs( dx * s + dz * c - ARM ) < 16 ) t.openBoom?.( 6 );

			}

		}
		this.solid();
		// the gone go back to the pool (compacted in place: no new array each frame)
		let keep = 0;
		for ( const car of this.cars ) {

			if ( car.state !== 'gone' ) { this.cars[ keep ++ ] = car; continue; }
			car.group.visible = false;
			this.app.scene.remove( car.group );
			this.pool.get( car.name ).push( car.group );

		}
		this.cars.length = keep;
		this.drawWheels();

	}

	// Along its path at up to the waypoint's speed, stopping for the car ahead and the player's.
	drive( car, dt ) {

		const P = car.path;
		if ( P ) {

			// the waypoints in the world now (reused per path: her frame moves them every frame)
			const n = P.points.length;
			if ( ! P.pts || P.pts.length !== n ) { P.pts = P.points.map( () => new Vector3() ); P.seg = new Float64Array( Math.max( 0, n - 1 ) ); }
			const pts = P.pts, seg = P.seg;
			for ( let k = 0; k < n; k ++ ) this.world( car, P.points[ k ], pts[ k ] );
			let len = 0;
			for ( let k = 0; k < n - 1; k ++ ) { const l = pts[ k + 1 ].distanceTo( pts[ k ] ); seg[ k ] = l; len += l; }
			let i = 0, s = car.s;
			while ( i < seg.length - 1 && s > seg[ i ] ) s -= seg[ i ++ ];
			// the segment's speed, easing down to a stop at the path's end (backing out: its start)
			const back = car.state === 'back', by = this.blocked( car, pts, seg, i, len ), s0 = car.s;
			const want = by ? 0 : Math.min( back ? SLOW : P.points[ i + 1 ][ 4 ], 0.15 + 1.4 * Math.sqrt( Math.max( 0, back ? car.s : len - car.s ) ) );
			car.braking = want < car.v - 0.05 || want === 0;
			car.v = want < car.v ? Math.max( want, car.v - 4 * dt ) : Math.min( want, car.v + 1.5 * dt );
			car.s = back ? Math.max( 0, car.s - car.v * dt ) : Math.min( len, car.s + car.v * dt );
			car.shore = seg[ 0 ] + ( seg[ 1 ] || 0 );   // along a boarding route: the lanes' end, short of the linkspan
			// held up by the player's car standing still (not just a slow car ahead in the procession):
			// count it, and give way once it has been too long
			const still = Math.abs( this.app.rally?.state?.[ 7 ] ?? 0 ) < 3;
			car.stuck = by === 'player' && still && car.state === 'board' ? ( car.stuck || 0 ) + dt : 0;
			if ( car.stuck > STUCK ) this.giveWay( car );
			else if ( back ? car.s <= 0.02 : car.s >= len - 0.02 ) this.arrive( car );
			else {

				// pose on the segment, from its endpoints in the world
				const f = seg[ i ] > 0 ? Math.min( 1, s / seg[ i ] ) : 1, a = pts[ i ], b = pts[ i + 1 ];
				car.world = ( car.world || new Vector3() ).copy( a ).lerp( b, f );
				car.heading = Math.atan2( b.x - a.x, b.z - a.z );
				car.grade = Math.atan2( b.y - a.y, Math.hypot( b.x - a.x, b.z - a.z ) );
				car.local = P.points[ i ][ 0 ] === 'S' && P.points[ i + 1 ][ 0 ] === 'S' ? this.ferry.ship.toLocal( car.world, car.local || new Vector3() ) : null;
				if ( car.local ) car.localYaw = car.heading - this.ferry.ship.yaw;
				// its wheels roll by the road it covered and steer for the road ahead (trafficWheels.js)
				car.wheels?.follow( pts, seg, car.s, car.world, car.heading, car.s - s0, dt );

			}

		}
		this.pose( car );

	}

	arrive( car ) {

		const ship = this.ferry.ship;
		car.path = null; car.v = 0; car.braking = false;
		if ( car.state === 'board' ) {

			const [ side, z ] = SLOTS[ car.slot ];
			car.state = 'parked';
			car.local = new Vector3( side * SIDE, DECK, z );
			car.localYaw = Math.PI;
			car.driverIn = true;

		} else if ( car.state === 'unload' ) car.state = 'gone';
		else if ( car.state === 'back' ) { car.state = 'queue'; car.slot = null; car.local = null; car.from = null; }
		else if ( car.state === 'queue' ) car.local = null;
		void ship;

	}

	// Held up by the player's car for STUCK seconds: this car and every car boarding behind it give
	// way, and no more start aboard at this call. One that has turned at her bow (facing aft, in her
	// frame) parks where it stands; one still on its way up backs out to its place in the queue.
	giveWay( car ) {

		this.shut = true;
		const ship = this.ferry.ship;
		for ( const c of this.cars ) {

			if ( c.state !== 'board' || c.seq < car.seq ) continue;
			c.stuck = 0;
			if ( c.local && Math.cos( c.heading - ship.yaw ) < 0 ) {

				c.path = null; c.v = 0; c.braking = false; c.state = 'parked'; c.driverIn = true;
				c.local = ship.toLocal( c.world, c.local ); c.local.y = DECK;
				c.localYaw = c.heading - ship.yaw;

			} else c.state = 'back';

		}

	}

	// What stops this car ('car' | 'player' | null): a car ahead of it in the order within the gap
	// (a cone along its way; backing out, the cars backing out behind it) or close by, or the
	// player's car in or crossing its way (playerInWay). Nothing behind it stops it.
	blocked( car, pts, seg, i, len ) {

		const a = pts[ i ], b = pts[ i + 1 ], back = car.state === 'back', k = back ? - 1 : 1;
		const hx = k * ( b.x - a.x ), hz = k * ( b.z - a.z ), h = Math.hypot( hx, hz ) || 1;
		const p = car.world || a;
		for ( const o of this.cars ) {

			if ( o === car || ! o.world || ! o.path ) continue;
			if ( back ? o.state === 'back' && o.seq > car.seq : o.seq < car.seq ) if ( ahead( p, hx, hz, h, o.world, GAP, true ) ) return 'car';

		}
		return this.playerInWay( car, pts, seg, len, p ) ? 'player' : null;

	}

	// The player's car in this car's way: its footprint (a segment PLAYER_HALF either side of its
	// centre along its heading), now and where its present velocity takes it over the next LOOK s,
	// within CLEAR of this car's road from 1 m ahead of its middle to REACH m on, sampled along
	// the path so the turn at her bow counts (backing out: the road behind it). A player parked a
	// lane over, or tailing this car, never stops it; one driving at its road stops it early.
	playerInWay( car, pts, seg, len, p ) {

		const rally = this.app.rally, st = rally?.state;
		if ( ! st || Math.hypot( st[ 0 ] - p.x, st[ 2 ] - p.z ) > REACH + PLAYER_HALF + LOOK * 45 ) return false;
		const f = rally.forward, fl = f ? Math.hypot( f.x, f.z ) : 0;
		const fx = fl > 1e-3 ? f.x / fl * PLAYER_HALF : 0, fz = fl > 1e-3 ? f.z / fl * PLAYER_HALF : 0;
		const vx = rally.velocity?.x || 0, vz = rally.velocity?.z || 0, moving = Math.hypot( vx, vz ) > 0.3;
		const back = car.state === 'back';
		for ( let d = 1; d <= REACH; d += 1 ) {

			// the point d m along its road
			let at = back ? car.s - d : car.s + d;
			if ( at < 0 || at > len ) break;
			let k = 0;
			while ( k < seg.length - 1 && at > seg[ k ] ) at -= seg[ k ++ ];
			_u.copy( pts[ k ] ).lerp( pts[ k + 1 ], seg[ k ] > 0 ? Math.min( 1, at / seg[ k ] ) : 1 );
			if ( Math.abs( _u.y - st[ 1 ] ) > 2.5 ) continue;
			for ( let t = 0; t <= LOOK + 1e-6; t += moving ? 0.4 : LOOK + 1 ) {

				const cx = st[ 0 ] + vx * t, cz = st[ 2 ] + vz * t;
				// distance from the road point to the footprint segment
				const ex = _u.x - ( cx - fx ), ez = _u.z - ( cz - fz ), L2 = 4 * ( fx * fx + fz * fz );
				const w = L2 > 0 ? Math.max( 0, Math.min( 1, ( ex * 2 * fx + ez * 2 * fz ) / L2 ) ) : 0;
				if ( Math.hypot( ex - w * 2 * fx, ez - w * 2 * fz ) < CLEAR ) return true;

			}

		}
		return false;

	}

	// Solid bodies for the cars near the player's car: kinematic, posed where each car is drawn
	// (four per car: fore and aft, and a pair LOW under them; fitted by FIT), so the player's car stops against them instead of
	// passing through. Parked cars aboard ride with her pose each frame at no speed of their own.
	// Bodies go when a car leaves the radius or the service; none until the car physics is up.
	solid() {

		const physics = this.app.rally?.physics, s = this.app.rally?.state;
		if ( physics !== this.physics ) { this.physics = physics; this.bodies.clear(); }
		if ( ! physics || ! s ) return;
		for ( const car of this.cars ) {

			const g = car.group, id = ID + 4 * car.id;
			if ( car.state === 'gone' || ! car.world || Math.hypot( g.position.x - s[ 0 ], g.position.z - s[ 2 ] ) > NEAR ) {

				if ( this.bodies.delete( car.id ) ) for ( let j = 0; j < 4; j ++ ) physics.remove_remote( id + j );
				continue;

			}
			const [ kind, lift, reach ] = FIT[ car.name ], q = g.quaternion;
			_u.set( 0, lift, 0 ).applyQuaternion( q ).add( g.position );
			_f.set( 0, 0, reach ).applyQuaternion( q );
			_s[ 3 ] = q.x; _s[ 4 ] = q.y; _s[ 5 ] = q.z; _s[ 6 ] = q.w;
			_s[ 7 ] = car.path ? ( car.state === 'back' ? - car.v : car.v ) * 3.6 : 0;
			_w.set( 0, - LOW, 0 ).applyQuaternion( q );
			for ( let j = 0; j < 4; j ++ ) {

				const k = j & 1 ? - 1 : 1, low = j > 1 ? 1 : 0;
				_s[ 0 ] = _u.x + k * _f.x + low * _w.x; _s[ 1 ] = _u.y + k * _f.y + low * _w.y; _s[ 2 ] = _u.z + k * _f.z + low * _w.z;
				physics.update_remote( id + j, kind, _s );

			}
			this.bodies.add( car.id );

		}

	}

	pose( car ) {

		const g = car.group, ship = this.ferry.ship;
		if ( car.state === 'parked' || ( ! car.path && car.local ) ) {

			// aboard: her frame, riding with her
			ship.toWorld( car.local, g.position );
			g.quaternion.copy( ship.quaternion ).multiply( _q.setFromAxisAngle( _up, car.localYaw ) );
			car.world = ( car.world || new Vector3() ).copy( g.position );

		} else if ( ! car.path ) {

			car.terminal.toWorld( car.at, g.position );
			g.quaternion.setFromAxisAngle( _up, car.terminal.yaw );
			car.world = ( car.world || new Vector3() ).copy( g.position );

		} else if ( car.world ) {

			g.position.copy( car.world );
			g.quaternion.setFromAxisAngle( _up, car.heading ).multiply( _p.setFromAxisAngle( _x, - car.grade ) );

		}
		g.visible = g.position.distanceToSquared( this.app.camera.position ) < 400 * 400;

	}

	// Hold her ramp down: a car is driving on or off at her berth (or queued to, within MAX_HOLD),
	// or backing out over her deck, ramp or linkspan. A car that gave way to the player's car no
	// longer holds her once it is back in the lanes, and the queue stops holding her at that call.
	// The player driving through the marshalling lanes or over the linkspan and her ramp toward her
	// deck, not yet stopped aboard: the crew waits for them, up to PLAYER_HOLD seconds past her time.
	playerBoarding( t ) {

		const rally = this.app.rally, s = rally?.state;
		if ( ! t || ! s || ! rally.active ) return false;
		const c = Math.cos( t.yaw ), n = Math.sin( t.yaw ), dx = s[ 0 ] - t.position.x, dz = s[ 2 ] - t.position.z;
		const x = dx * c - dz * n, z = dx * n + dz * c;
		if ( x > - 12 && x < 10 && z > - 95 && z < - 8 ) return true;   // the lanes and the linkspan, to her ramp's toe
		const l = this.ferry.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		// on her ramp or deck and still moving, or standing in her after end where the ramp can't rise over it
		return Math.abs( l.x ) < 6.6 && l.z > - 36 && l.z < 16 && Math.abs( l.y - DECK ) < 2 && ( Math.abs( s[ 7 ] ) > 1 || l.z < - 18 );

	}

	// The player in the driver's seat of a car on her vehicle deck.
	playerAboard() {

		const rally = this.app.rally, s = rally?.state;
		if ( ! s || ! rally.active ) return false;
		const l = this.ferry.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		return Math.abs( l.x ) < 6.6 && l.z > - 26 && l.z < 16 && Math.abs( l.y - DECK ) < 1.5;

	}

	holding() {

		return this.trafficHolding() || ( !! this.boarding && this.playerHeld < PLAYER_HOLD );

	}

	// Her ramp held for the traffic alone: cars driving on or off, or queued within MAX_HOLD.
	trafficHolding() {

		const t = this.ferry.at?.terminal;
		return this.cars.some( c => ( c.state === 'board' ) || ( c.state === 'back' && c.s > c.shore ) || ( c.state === 'unload' && c.s < 45 ) || ( c.state === 'parked' && c.from !== t ) ) ||
			( ! this.shut && this.held < MAX_HOLD && this.cars.some( c => c.terminal === t && c.state === 'queue' && ! c.path ) && this.cars.filter( c => c.state === 'parked' || c.state === 'board' ).length < SLOTS.length );

	}

	// Read-only: every car, where it is and what it is doing (aboard: in her frame).
	state() {

		const ship = this.ferry.ship;
		return this.cars.map( c => {

			const l = ship.toLocal( c.world || c.group.position, new Vector3() );
			return { id: c.id, model: c.name, state: c.state, terminal: c.terminal.name, slot: c.slot, braking: !! c.braking, v: + c.v.toFixed( 2 ), local: [ l.x, l.y, l.z ].map( v => + v.toFixed( 2 ) ) };

		} );

	}

}
