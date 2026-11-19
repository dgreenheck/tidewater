// Foot passengers and the traffic cars' drivers on the ferry service, so her terminals and her
// decks aren't empty. Rocketbox people (tools/characters/build_crowd.sh: public/models/characters/
// crowd/*.glb, MIT) walk simple waypoint routes, in the terminal's frame ashore and in hers aboard
// (so they ride with her): foot passengers come out of the hall past the ticket counter, round the
// yard path, up the stair tower and along the covered walkway to wait in pairs at the gangway gate,
// chatting (one talks with her hands, the other nods); with her gangway out and the service
// loading they file over it through her port door, to a saloon seat or up to the sun deck's rail,
// and at the far side they walk off into that terminal's hall and go. Drivers get out beside their
// parked cars, climb the wing stairs to the saloon or the sun deck and come back down to their cars
// as she swings for the far berth. People near the player who see the player looking at them
// turn their head and chest (on the skeleton), wave or nod, then talk with their hands or point if
// the player lingers; walkers pause to do it; a cool-down keeps it from looping.
// Everyone has a townsfolk brain (src/people, docs/people.md): the brain senses the player and the
// events around them, chooses what they do at their seat, queue spot or rail (smart objects the
// crowd registers), and asks for gestures, head looks, a tuck of the knees and speech bubbles; this
// file keeps the bodies, the routes and the service's orchestration.
//   ferry.crowd.update( dt ), ferry.crowd.state(), ferry.crowd.holding()
import { Group, Vector3 } from '../engine/index.js';
import { pose } from '../people/Pose.js';
import { People } from '../people/People.js';
import { SmartObject } from '../people/SmartObjects.js';
import { fadeOptions } from '../people/Fade.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';

const CAST = [ 'f01', 'm01', 'f03', 'm04', 'f06', 'm07', 'f09', 'm10' ];
const CLIP = { idle: 'idle_neutral_01', look: 'idle_look_around_01', sit: 'sit_chair_idle_neutral_01', talk: 'gestic_talk_neutral_01', wave: 'wave_01',
	point: 'gestic_presentation_right_01', nod: 'gestic_listen_accept_01', phone: 'cell_phone_talk_01', walk: 'walk_neutral_01',
	shrug: 'gestic_shrug_01', laugh: 'gestic_laugh_low', sitLook: 'sit_chair_idle_look_around', sitRelax: 'sit_chair_idle_relaxed_01',
	sitThink: 'sit_chair_gestic_thoughtful', sitYawn: 'sit_chair_idle_yawn',
	angry: 'idle_angry_01', crouch: 'crouch_idle', crouchIn: 'crouch_in', crouchOut: 'crouch_out' };   // bumps (src/people/Contact.js); the women's set has no crouch in or out
const SITTING = new Set( [ 'sit', 'sitLook', 'sitRelax', 'sitThink', 'sitYawn' ] );
const PER_CAST = 4;                    // instances of each avatar: 32 people at most
const QUEUE = 12;                      // waiting at each gangway gate at most
// Terminal frame: the hall by the ticket counter, out of its door, round the yard path to the stair
// tower, up it, along the covered walkway to the gangway gate (the queue), over the gangway.
const IN = [ [ 37.4, 3.35, - 16.2 ], [ 30.2, 3.35, - 7.4 ], [ 28.0, 3.35, - 6.8 ], [ 22.4, 3.36, - 8.5 ], [ 22.4, 3.36, - 33.4 ], [ 14.87, 3.2, - 33.4 ],
	[ 14.87, 3.2, - 32.2 ], [ 14.87, 3.98, - 29.75 ], [ 11.4, 3.98, - 29.9 ], [ 11.4, 3.98, - 32.55 ], [ 14.2, 5.95, - 32.55 ], [ 14.87, 6.34, - 32.3 ],
	[ 14.87, 7.0, - 29.9 ], [ 14.6, 7.0, - 28.4 ] ];
const spot = k => [ k % 2 ? 15.05 : 14.25, 7.0, 6.2 - 1.3 * Math.floor( k / 2 ) ];
const GANGWAY = [ [ 'T', 14.6, 7.0, 8.7 ], [ 'T', 13.2, 7.0, 9.7 ], [ 'T', 11.12, 7.0, 9.7 ], [ 'S', 9.32, 7.0, - 15.5 ], [ 'S', 7.7, 7.0, - 15.5 ] ];
// Her frame: saloon seats (facing forward) and the sun deck's rail (facing out), per side (+ port).
const BENCHES = [ [ 2.4, 3.6 ], [ 6.0, 7.0 ] ], ROWS = [ 3, 5, 7, 9, 11, 13 ];   // two seats a bench, x; rows, z
const RAILS = [ 2, 3.5, 5, 9, 11, 13 ];
const toSeat = ( side, [ x, z ] ) => { const a = x < 5 ? 1.2 : 4.8; return [ [ 'S', side * 7.7, 7.0, - 1.0 ], [ 'S', side * 4.8, 7.0, 1.8 ], [ 'S', side * a, 7.0, 1.8 ], [ 'S', side * a, 7.0, z - 0.7 ], [ 'S', side * x, 7.0, z - 0.7 ], [ 'S', side * x, 7.0, z ] ]; };
const toRail = ( side, z ) => [ [ 'S', side * 7.7, 7.0, - 12.5 ], [ 'S', side * 7.4, 10.0, - 15.0 ], [ 'S', side * 7.75, 10.0, - 12 ], [ 'S', side * 7.75, 10.0, 0.2 ], [ 'S', side * 7.9, 10.0, z ], [ 'S', side * 8.2, 10.0, z ] ];
// a driver from beside the car to the wing stair door and up it into the corridor
const fromCar = ( side, z ) => [ [ 'S', side * 3.6, 2.6, z ], [ 'S', side * 3.6, 2.6, - 8.9 ], [ 'S', side * 6.9, 2.6, - 8.9 ], [ 'S', side * 7.25, 2.6, - 8.1 ], [ 'S', side * 7.25, 7.0, - 1.6 ], [ 'S', side * 7.7, 7.0, - 1.0 ] ];

const _v = new Vector3(), _w = new Vector3(), _d = new Vector3(), _c = new Vector3();
const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = a => a[ Math.floor( Math.random() * a.length ) ];
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, a ) => Math.max( - a, Math.min( a, v ) );

export class Crowd {

	constructor( app, ferry ) {

		this.app = app;
		this.ferry = ferry;
		this.people = [];
		this.free = [];                 // idle instances { model, cast, walk }
		this.loaded = 0;
		this.seq = 0;
		this.stops = new Map();
		this.frame = 0;
		this.hub = app.people || ( app.people = new People( app ) );
		// her seats (benches of two, per side) and her sun deck rail, as smart objects
		for ( const side of [ 1, - 1 ] ) {

			for ( const z of ROWS ) for ( const pair of BENCHES ) this.hub.objects.add( new SmartObject( { kind: 'seat', tag: side, slots: pair.map( ( x, i ) => ( { x, z, mates: [ 1 - i ] } ) ) } ) );
			this.hub.objects.add( new SmartObject( { kind: 'rail', tag: side, slots: RAILS.map( ( z, i ) => ( { z, mates: [ i - 1, i + 1 ].filter( j => j >= 0 && j < RAILS.length && Math.abs( RAILS[ j ] - z ) <= 1.6 ) } ) ) } ) );

		}

	}

	// The cast in the background: the first instance of each avatar decodes its maps, the rest share them.
	init() {

		const base = import.meta.env.BASE_URL;
		( async () => {

			for ( const cast of CAST ) {

				try {

					const gltf = await loadGLB( `${ base }models/characters/crowd/${ cast }.glb` );
					const walk = rootMotion( gltf );
					const maps = new Map();
					const bare = { ...gltf, materials: gltf.materials.map( m => ( { ...m, normalTexture: undefined, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, baseColorTexture: undefined, metallicRoughnessTexture: undefined } } ) ) };
					for ( let i = 0; i < PER_CAST; i ++ ) {

						const model = await SkinnedModel.create( i ? bare : gltf, { materials: info => i ? fadeOptions( info, { textures: maps.get( info.name ) } ) : ( maps.set( info.name, info.textures ), fadeOptions( info ) ) } );
						for ( const m of model.materials ) m.underwaterLighting = 'lite';
						model.clipSet = new Set( model.clipNames() );
						this.free.push( { model, cast, walk } );

					}
					this.loaded ++;

				} catch ( e ) { console.warn( 'Crowd: failed to load', cast, e ); }

			}

		} )();

	}

	stop( t ) {

		let s = this.stops.get( t.name );
		if ( ! s ) {

			this.stops.set( t.name, s = { spawn: 0, want: 8 + Math.floor( Math.random() * 4 ), filled: false, next: 0 } );
			// the gangway gate queue: spots in pairs, side by side (a smart object; the pair chat)
			s.queue = this.hub.objects.add( new SmartObject( { kind: 'queue', tag: t, slots: Array.from( { length: QUEUE }, ( _, k ) => ( { k, mates: [ k ^ 1 ] } ) ) } ) );

		}
		return s;

	}

	take() {

		if ( ! this.free.length ) return null;
		// the avatar least in use, so the same face is seldom seen twice in one place
		const use = c => this.people.filter( p => p.cast === c ).length;
		const least = Math.min( ...this.free.map( b => use( b.cast ) ) ), options = this.free.filter( b => use( b.cast ) === least );
		const body = options[ Math.floor( Math.random() * options.length ) ];
		this.free.splice( this.free.indexOf( body ), 1 );
		const group = new Group();
		group.name = 'Crowd:' + body.cast;
		group.add( body.model.group );
		this.app.scene.add( group );
		return { ...body, group };

	}

	add( p ) {

		p.id = ++ this.seq; p.s = 0; p.pace = rand( 1.2, 1.5 ); p.yaw = p.yaw ?? 0; p.look = 0; p.pitch = 0; p.tuck = 0; p.acc = 0;
		p.posture = 'walk'; p.head = new Vector3(); p.can = key => p.model.clipSet.has( CLIP[ key ] );
		// for bumps (src/people/Contact.js): their place before any knock, clip keys, where a step may go, how much room
		p.base = new Vector3(); p.based = false; p.clipOf = key => CLIP[ key ];
		p.canStand = ( w, base ) => this.canStand( p, w, base ); p.footing = () => this.footing( p );
		p.recoverAt = world => this.recoverAt( p, world );
		p.model.play( CLIP.idle, { fade: 0.01, from: Math.random() * p.model.clipDuration( CLIP.idle ) } );
		p.model.onClipEnd = () => { p.gesture = null; };
		this.hub.add( p );
		// something in hand: foot passengers often, drivers now and then (a coffee or the phone)
		if ( Math.random() < ( p.kind === 'foot' ? 0.55 : 0.3 ) ) this.hub.contact.give( p, p.kind === 'foot' ? undefined : pick( [ 'coffee', 'phone' ] ) );
		this.people.push( p );
		return p;

	}

	// A foot passenger for `terminal`'s gate queue: out of the hall and along the route, or in place.
	spawnFoot( terminal, placed ) {

		const queue = this.stop( terminal ).queue, k = queue.free()[ 0 ];   // the front-most free spot
		if ( k === undefined ) return;
		const body = this.take();
		if ( ! body ) return;
		const q = spot( k );
		const p = this.add( { ...body, kind: 'foot', terminal, spot: k, state: placed ? 'queue' : 'in', path: placed ? null : [ ...IN.map( w => [ 'T', ...w ] ), [ 'T', ...q ] ], at: [ 'T', ...q ] } );
		queue.claim( k, p );
		if ( placed ) this.idle( p );

	}

	spawnDriver( car ) {

		const body = this.take();
		if ( ! body ) return;
		const side = Math.sign( car.local.x ) || 1, z = car.local.z;
		car.driverIn = false;
		const p = this.add( { ...body, kind: 'driver', car, side, terminal: car.terminal, state: 'board', aboard: true } );
		// path and out are one array, as before this file moved onto the brain (see docs/people.md, forks)
		p.path = p.out = [ ...fromCar( side, z ), ...this.place( p, side, 0.35 ) ];
		p.at = p.out[ p.out.length - 1 ];

	}

	// On her: a seat or the rail, from her port door.
	aboard( p ) { return this.place( p, 1, 0.3 ); }

	// A seat or a place at her rail on `side`, claimed from the smart objects, and the route to it.
	place( p, side, railChance ) {

		const objects = this.hub.objects, mine = o => o.tag === side;
		const s = ( Math.random() >= railChance && objects.claim( 'seat', mine, p ) ) || objects.claim( 'rail', mine, p ) || objects.claim( 'seat', mine, p );
		p.side = side;
		p.seat = s && s.x !== undefined ? [ s.x, s.z ] : null;
		return p.seat ? toSeat( side, p.seat ) : toRail( side, s ? s.z : pick( RAILS ) );

	}

	update( dt ) {

		if ( ! this.free.length && ! this.people.length ) return;
		const t0 = performance.now();
		const ferry = this.ferry, ship = ferry.ship, service = ferry.service, app = this.app;
		const moored = ship.moored && ferry.gangway === 0 && ! ferry.castingOff;
		const boarding = moored && service.enabled && service.phase === 'loading';
		const here = ferry.at?.terminal;
		for ( const b of ferry.berths ) {

			const t = b.terminal, stop = this.stop( t );
			if ( ! stop.filled && this.free.length >= 6 ) { stop.filled = true; for ( let i = 0; i < 6; i ++ ) this.spawnFoot( t, true ); }
			const queued = this.people.filter( p => p.terminal === t && p.kind === 'foot' && ! p.aboard );
			if ( stop.filled && ! ( boarding && t === here ) && queued.length < stop.want && ( stop.spawn -= dt ) <= 0 ) { this.spawnFoot( t, false ); stop.spawn = rand( 3, 7 ); }
			// boarding: the queue files over the gangway, the front pairs first
			if ( boarding && t === here && ( stop.next -= dt ) <= 0 ) {

				const p = queued.filter( p => p.state === 'queue' ).sort( ( a, b ) => a.spot - b.spot )[ 0 ];
				if ( p ) {

					const q = spot( p.spot );
					p.state = 'board'; p.aboard = true; p.from = t; p.s = 0; p.pair = null;
				this.hub.objects.release( p );
					p.out = [ ...GANGWAY.slice( 3 ), ...this.aboard( p ) ];
					p.path = [ [ 'T', ...q ], ...GANGWAY, ...p.out.slice( 2 ) ];
					p.at = p.path[ p.path.length - 1 ];
					stop.next = rand( 0.7, 1.4 );

				}

			}

		}

		// drivers out of the cars parked aboard at this berth; back to them before the far berth
		const traffic = ferry.traffic;
		for ( const car of traffic?.cars || [] ) if ( car.state === 'parked' && car.driverIn && car.from === here && ! car.driven && moored ) { car.driven = true; this.spawnDriver( car ); }
		// drivers go back down once she is swinging for the far berth (or lies at it)
		const bound = service.phase === 'sailing' && [ 'swing', 'back', 'fill' ].includes( service.pilot.leg ) ? service.next.terminal : ship.moored ? here : null;
		for ( const p of this.people ) {

			if ( p.state === 'seated' || p.state === 'stand' ) {

				const back = p.kind === 'driver' ? !! bound && bound !== p.car.from : moored && here && here !== p.from && service.phase === 'loading';
				if ( back ) {

					p.state = 'leave'; p.s = 0; p.seat = null;
					this.hub.objects.release( p );
					p.path = [ ...p.out ].reverse();
					if ( p.kind === 'foot' ) p.path.push( ...[ ...GANGWAY.slice( 0, 3 ) ].reverse(), ...[ ...IN ].reverse().map( w => [ 'T', ...w ] ) );
					p.terminal = here || p.terminal;
					p.model.play( CLIP.walk, { fade: 0.3 } );

				}

			}

		}

		this.frame ++;
		// whoever is down on the ground (Contact.js): walkers wait rather than walk through them
		this.fallen = this.people.filter( q => q.knock && ( q.knock.kind === 'fall' || q.knock.kind === 'dive' ) && q.world );
		const cam = app.camera.position, dir = app.camera.getWorldDirection( _d );
		for ( const p of this.people ) this.step( p, dt, cam, dir );
		for ( const p of this.people.filter( p => p.state === 'gone' ) ) {

			if ( p.car ) p.car.driverIn = true;
			this.hub.remove( p );
			this.app.scene.remove( p.group );
			p.group.remove( p.model.group );
			p.model.hold();
			this.free.push( { model: p.model, cast: p.cast, walk: p.walk } );

		}
		this.people = this.people.filter( p => p.state !== 'gone' );
		this.hub.charge( performance.now() - t0 );

	}

	world( p, w, out ) { if ( w[ 0 ] === 'W' ) return out.set( w[ 1 ], w[ 2 ], w[ 3 ] ); return w[ 0 ] === 'S' ? this.ferry.ship.toWorld( _w.set( w[ 1 ], w[ 2 ], w[ 3 ] ), out ) : p.terminal.toWorld( [ w[ 1 ], w[ 2 ], w[ 3 ] ], out ); }

	gangwayConnected( p ) {

		const f = this.ferry;
		if ( ! f.ship.moored || f.castingOff || f.gangway !== 0 || f.at?.terminal !== p.terminal ) return false;
		// Mooring state alone is insufficient after hull displacement in a flood.
		const a = this.world( p, GANGWAY[ 2 ], new Vector3() ), b = this.world( p, GANGWAY[ 3 ], new Vector3() );
		return Math.hypot( a.x - b.x, a.z - b.z ) < 4 && Math.abs( a.y - b.y ) < 0.45;

	}

	recoverAt( p, world ) {

		const deck = this.ferry.deck, local = this.ferry.ship.toLocal( world, new Vector3() );
		const aboard = !! deck?.supportAt( world, { maxRise: 0.2, maxDrop: 0.25 } );
		const oldPath = p.path;
		p.path = null; p.s = 0; p.world.copy( world ); p.base.copy( world ); p.off?.set( 0, 0, 0 );
		p.local = aboard ? local : null; p.aboard = aboard;
		p.at = aboard ? [ 'S', ...local.toArray() ] : [ 'W', ...world.toArray() ];
		p.state = aboard ? 'stand' : 'displaced';
		// A displaced passenger never reconnects to an obsolete mixed-frame path.
		// A wholly onboard route can be resumed from the physically reached place.
		if ( aboard && oldPath?.length && oldPath.every( point => point[ 0 ] === 'S' ) ) p.path = [ p.at.slice(), ...oldPath.slice( 1 ) ];

	}

	step( p, dt, cam, dir ) {

		const ship = this.ferry.ship, m = p.model, b = p.brain, t = this.hub.t, knocked = !! p.knock;
		if ( p.based ) p.world.copy( p.base );   // their place, without last frame's knock offset
		// the brain's gesture: a one-shot clip (walkers pause for it); seated, none that would stand them up; none while knocked
		if ( b.gesture && ! p.gesture && ! knocked ) {

			const clip = p.state === 'seated' ? null : CLIP[ b.gesture.clip ];
			if ( clip && m.clipSet.has( clip ) ) { m.play( clip, { fade: 0.35, loop: false } ); p.gesture = clip; if ( b.gesture.greet ) p.greeted = clip; }
			b.gesture = null;

		}
		const standing = p.state === 'queue' || p.state === 'stand' || ( knocked && p.state !== 'seated' );
		// walking: along the path, pausing for a gesture (a path of one point is already there)
		if ( p.path && p.path.length < 2 ) this.arrive( p );
		if ( p.path && ! p.gesture && ! knocked ) {

			const P = p.path;
			let a = this.world( p, P[ 0 ], new Vector3() ), b = this.world( p, P[ 1 ], new Vector3() ), seg = a.distanceTo( b );
			const hx = Math.sin( p.heading ?? 0 ), hz = Math.cos( p.heading ?? 0 );
			let wait = this.fallen.length > 0 && !! p.world && this.fallen.some( q => q !== p && q.world.distanceToSquared( p.world ) < 1.2 && ( q.world.x - p.world.x ) * hx + ( q.world.z - p.world.z ) * hz > 0 );
			if ( P[ 0 ][ 0 ] !== P[ 1 ][ 0 ] && ! this.gangwayConnected( p ) ) {
				wait = true;
				if ( p.s > 0 && ! this.hub.contact.boards( p.world, p.base ) && ! this.ferry.deck?.supportAt( p.world ) ) this.hub.contact.environment?.( p );
			}
			if ( ! wait ) p.s += p.pace * dt;
			while ( ! wait && p.path && p.s >= seg ) {

				p.s -= seg;
				P.shift();
				if ( P.length < 2 ) this.arrive( p );
				else {
					a = this.world( p, P[ 0 ], a ); b = this.world( p, P[ 1 ], b ); seg = a.distanceTo( b );
					if ( P[ 0 ][ 0 ] !== P[ 1 ][ 0 ] && ! this.gangwayConnected( p ) ) { p.s = 0; wait = true; }
				}

			}
			if ( p.path ) {

				const f = seg > 1e-4 ? Math.min( 1, p.s / seg ) : 1;
				// A disconnected bridge cannot drag an in-progress passenger through
				// open water as its remote endpoint moves away.
				if ( ! wait || P[ 0 ][ 0 ] === P[ 1 ][ 0 ] ) p.world = ( p.world || new Vector3() ).copy( a ).lerp( b, f );
				if ( seg > 0.05 && Math.hypot( b.x - a.x, b.z - a.z ) > 0.05 ) p.heading = Math.atan2( b.x - a.x, b.z - a.z );
				p.local = P[ 0 ][ 0 ] === 'S' && P[ 1 ][ 0 ] === 'S' ? ship.toLocal( p.world, p.local || new Vector3() ) : null;
				if ( wait ) { if ( m.current !== CLIP.idle ) m.play( CLIP.idle, { fade: 0.3 } ); }
				else if ( m.current !== CLIP.walk ) m.play( CLIP.walk, { fade: 0.3, speed: Math.min( 1.6, Math.max( 0.6, p.pace / p.walk ) ) } );

			}

		} else if ( knocked && p.local ) {

			ship.toWorld( p.local, p.world );

		} else if ( ! p.path ) {

			// in place: at a queue spot (terminal frame) or aboard (hers)
			p.local = p.at[ 0 ] === 'S' ? _v.set( p.at[ 1 ], p.at[ 2 ], p.at[ 3 ] ).clone() : null;
			p.world = this.world( p, p.at, p.world || new Vector3() );

		}
		if ( ! p.world ) p.world = this.world( p, p.path ? p.path[ 0 ] : p.at, new Vector3() );
		// a knock (Contact.js): the offset from their place, the clips, the pose layer; the route waits
		p.base.copy( p.world ); p.based = true;
		const K = this.hub.contact.body( p, dt );
		if ( ! p.path && ! p.gesture && ! p.knock && ! K?.walk ) this.idle( p, dt );
		p.posture = ( p.path && ! p.gesture && ! p.knock ) || K?.walk ? 'walk' : p.state === 'seated' ? 'sit' : 'stand';
		// facing: the way they walk, their spot's way (a partner's or the rail's), turned to what the brain looks at
		const frameYaw = p.local || ( p.path ? false : p.at[ 0 ] === 'S' ) ? ship.yaw : p.terminal.yaw;
		let want = p.path && ! p.gesture ? p.heading ?? frameYaw : frameYaw + ( p.face || 0 );
		const target = b.target && t < b.lookUntil ? b.target : null;
		let look = 0, pitch = p.path ? 0 : b.activity?.pitch || 0;
		if ( target || p.gesture ) {

			let to = p.toward ?? want;
			if ( target ) {

				const dx = target.x - p.world.x, dz = target.z - p.world.z;
				p.toward = to = Math.atan2( dx, dz );
				pitch = clamp( Math.atan2( p.world.y + ( p.state === 'seated' ? 1.2 : 1.6 ) - target.y, Math.hypot( dx, dz ) || 1 ), 0.6 );

			}
			if ( ( standing && ( ! target || t < b.engagedUntil ) ) || ( p.path && p.gesture ) ) want = to;
			look = clamp( wrap( to - p.yaw ), 1.1 );

		}
		if ( K ) { if ( K.lockYaw ) want = p.yaw; else if ( K.face !== null ) want = K.face; }
		const k = 1 - Math.exp( - dt * 4 );
		p.yaw += wrap( want - p.yaw ) * ( 1 - Math.exp( - dt * 5 ) );
		p.look += ( look - p.look ) * k;
		p.pitch += ( pitch - p.pitch ) * k;
		p.tuck += ( ( p.state === 'seated' ? b.tuck : 0 ) - p.tuck ) * ( 1 - Math.exp( - dt * 6 ) );
		p.group.position.copy( p.world );
		if ( K?.drop ) p.group.position.y -= K.drop;
		p.group.rotation.y = p.yaw;
		// knocked flat (Contact.js tumble): the ragdoll draws the model in the world, so the group sits at the origin
		if ( K?.rag ) { p.group.position.set( 0, 0, 0 ); p.group.rotation.y = 0; p.group.visible = true; p.acc = 0; this.hub.contact.rag( p, dt ); return; }
		p.head.copy( p.world ).y += p.state === 'seated' ? 1.2 : 1.6 - ( K?.drop ? 1.65 * K.drop : 0 );   // sat on the ground: the head about 0.9 m up
		// detail by distance (the hub's p.lod): near every frame, mid a third of the frames, far frozen; hidden past 90 m
		const d2 = p.world.distanceToSquared( cam );
		p.group.visible = d2 < 90 * 90;
		p.acc += dt;
		if ( ! p.group.visible ) { p.acc = 0; return; }   // SkinnedModel.settle() holds the pose on draw
		if ( p.lod === 'far' ) { p.acc = 0; return; }
		// behind the camera (their shadows can still show), a third of the frames too
		const ahead = ( p.world.x - cam.x ) * dir.x + ( p.world.y - cam.y ) * dir.y + ( p.world.z - cam.z ) * dir.z;
		if ( ( p.lod === 'mid' || ahead < - 2 ) && ( this.frame + p.id ) % 3 ) return;
		m.update( p.acc );
		p.acc = 0;
		pose( m, p.look, p.pitch, p.tuck, b.away, K );
		if ( p.item ) this.hub.contact.hand( p );

	}

	// Walkable, for a knock's step (Contact.js): aboard, never out past her rail; ashore, the planks under
	// them (the pier, the terminal), never through a rail or off an edge.
	canStand( p, w, base ) {

		const ship = this.ferry.ship;
		if ( p.local || ( ! p.path && p.at[ 0 ] === 'S' ) ) {

			const deck = this.ferry.deck, q = ship.toLocal( w, _c );
			if ( ! deck ) return false;
			const g = deck.groundAt( q.x, q.z, q.y + 0.45 );
			if ( ! Number.isFinite( g ) || Math.abs( q.y - g ) > 0.45 ) return false;
			for ( const box of deck.boxes ) {
				if ( ! box.solid || box.center.y + box.half.y <= q.y + 0.45 || box.center.y - box.half.y >= q.y + 1.7 ) continue;
				if ( Math.abs( q.x - box.center.x ) < box.half.x + 0.27 && Math.abs( q.z - box.center.z ) < box.half.z + 0.27 ) return false;
			}
			return true;

		}
		return this.hub.contact.boards( w, base );

	}

	// Room to go over: seated, narrow (the gate queue, over the gangway, her rail: a stagger at most) or open.
	footing( p ) {

		if ( p.state === 'seated' ) return 'seat';
		if ( p.state === 'queue' || p.state === 'stand' ) return 'narrow';
		if ( p.path && p.path.some( w => w[ 0 ] === 'T' ) && p.path.some( w => w[ 0 ] === 'S' ) ) return 'narrow';
		return 'open';

	}

	// What someone standing or sitting does: the clip of their brain's activity (sitting ones while
	// seated, standing ones otherwise, the plain idle where an avatar lacks the clip); the pairs at
	// the gate half turn to each other, at the rail they face out.
	idle( p, dt = 0 ) {

		const m = p.model, a = p.brain.activity;
		const use = key => { let clip = CLIP[ key ]; if ( ! m.clipSet.has( clip ) ) clip = CLIP[ SITTING.has( key ) ? 'sit' : 'idle' ]; if ( m.current !== clip && ! p.gesture ) m.play( clip, { fade: 0.6, from: key === 'sit' ? Math.random() * 10 : 0 } ); };
		if ( p.seat && p.at[ 0 ] === 'S' ) { p.state = 'seated'; p.face = 0; p.posture = 'sit'; use( a && SITTING.has( a.clip ) ? a.clip : 'sit' ); return; }
		if ( p.state === 'queue' ) {

			const mate = this.hub.objects.mateOf( p );
			p.face = mate?.state === 'queue' ? ( p.spot % 2 ? - 0.9 : 0.9 ) : 0;

		} else if ( p.at[ 0 ] === 'S' ) {

			p.state = 'stand';
			p.face = Math.sign( p.at[ 1 ] ) * Math.PI / 2;

		} else return;
		use( a && ! SITTING.has( a.clip ) ? a.clip : 'idle' );

	}

	arrive( p ) {

		p.path = null; p.s = 0; p.chat = 0;
		if ( p.state === 'in' ) p.state = 'queue';
		else if ( p.state === 'leave' ) { if ( p.kind === 'driver' ) p.car.driverIn = true; p.state = 'gone'; }
		else if ( p.state === 'board' ) p.state = p.seat ? 'seated' : 'stand';
		if ( p.state !== 'gone' ) this.idle( p );

	}

	// Hold her while foot passengers are crossing the gangway (either way).
	holding() {

		return this.people.some( p => ( p.state === 'board' || p.state === 'leave' ) && p.kind === 'foot' && p.path && p.path.some( w => w[ 0 ] === 'T' ) && p.path.some( w => w[ 0 ] === 'S' ) );

	}

	// Read-only: everyone, what they are doing and where (aboard: in her frame).
	state() {

		const ship = this.ferry.ship;
		return {
			loaded: this.loaded,
			people: this.people.map( p => {

				const l = ship.toLocal( p.world || p.group.position, new Vector3() );
				return { id: p.id, cast: p.cast, kind: p.kind, state: p.state, terminal: p.terminal.name, aboard: !! p.aboard && !! ( p.local || ( ! p.path && p.at[ 0 ] === 'S' ) ),
					clip: p.model.current, greeted: p.greeted || null, look: + p.look.toFixed( 2 ), pitch: + p.pitch.toFixed( 2 ), tuck: + p.tuck.toFixed( 2 ), yaw: + p.yaw.toFixed( 3 ),
					lod: p.lod, posture: p.posture, knock: p.knock?.kind || null, item: p.item ? p.item.kind + ':' + p.item.state : null, off: p.off ? + p.off.length().toFixed( 2 ) : 0, slot: p.slot ? p.slot.obj.kind + ':' + p.slot.i : null, brain: p.brain.state(),
					world: [ p.world?.x, p.world?.y, p.world?.z ].map( v => + ( v ?? 0 ).toFixed( 2 ) ), local: [ l.x, l.y, l.z ].map( v => + v.toFixed( 2 ) ) };

			} ),
		};

	}

}

// The walk comes with its root motion (the Rocketbox static set has no walks): the pelvis's travel
// over the cycle is taken out, so they walk on the spot, and its pace (m/s at speed 1) is returned.
export function rootMotion( gltf ) {

	const pelvis = gltf.nodes.findIndex( n => n.name === 'Bip01 Pelvis' );
	const clip = gltf.animations.find( a => a.name === CLIP.walk );
	const ch = clip?.channels.find( c => c.node === pelvis && c.path === 'translation' );
	if ( ! ch ) return 1.3;
	const T = ch.times, V = ch.values, n = T.length, t0 = T[ 0 ], span = T[ n - 1 ] - t0 || 1;
	const d = [ 0, 1, 2 ].map( c => V[ ( n - 1 ) * 3 + c ] - V[ c ] );
	for ( let i = 0; i < n; i ++ ) for ( let c = 0; c < 3; c ++ ) V[ i * 3 + c ] -= d[ c ] * ( T[ i ] - t0 ) / span;
	// the pelvis's parent's scale (the armature's units) to metres
	let s = 1;
	for ( let i = gltf.nodes.findIndex( x => x.children?.includes( pelvis ) ); i >= 0; i = gltf.nodes.findIndex( x => x.children?.includes( i ) ) ) s *= gltf.nodes[ i ].s[ 0 ];
	return Math.hypot( ...d ) * s / span;

}
