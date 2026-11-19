import { Vector3 } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { FerryShip } from './FerryShip.js';
import { FerryDeck } from './FerryDeck.js';
import { ferryPaint } from './FerryPaint.js';
import { FerryService } from './FerryService.js';
import { Traffic } from './Traffic.js';
import { Crowd } from './Crowd.js';
import './ferry.css';

// Tidewater's car ferry, the Tidewater Spirit (tools/ferry/ferry_build.py). She runs a scheduled
// service (FerryService.js) between the berths at Tidewater's and Joey Island's terminals
// (Terminal.js), port side to the jetty, unless someone takes her helm; walkers
// board by stepping onto her decks (over the gangway from the terminal), cars ride her vehicle
// deck as a moving platform in the car physics. Blows to the hull add up: a hard
// enough one holes her, and she floods, settles and resets to her mooring.
const HULL_STRENGTH = 8e6;         // J of impact energy to hole her
const PLATFORM = 1;                // the car physics platform id for her vehicle deck
// Berth work. The stern ramp pivot turns about its own X: stowed upright as authored, lowered
// with a little droop so its flaps rest on the linkspan's landing plate.
const RAMP_STOWED = - Math.PI / 2 * 0.98, RAMP_LOWERED = 0.04;
const RAMP_TIME = 12;              // s, stowed to lowered
const GANGWAY_TIME = 5;            // s, the terminal's gangway swinging out or in
// Her frame: the ramp hinge line, and where the flap tips land (the plate top, terminal z -7.79).
const HINGE = { z: - 25.2, y: 2.6 }, TOE = { z: - 25.2 - 7.79, y: 2.10 };
// Lines come on by themselves when she is brought back this close to her marks, this slowly.
const CAPTURE = { range: 1.5, yaw: 3 * Math.PI / 180, speed: 0.4, armed: 5 };
const INBOUND = 250, ASTERN = 150;  // m from the berth: sound one prolonged / three short
const smooth = t => t * t * ( 3 - 2 * t );

const _v = new Vector3(), _w = new Vector3();
const toward = ( value, goal, step ) => value < goal ? Math.min( goal, value + step ) : Math.max( goal, value - step );

// DOM writes only when the value changes (the ferry HUD is refreshed every frame)
function setData( el, key, value ) { if ( el.dataset[ key ] !== value ) el.dataset[ key ] = value; }
function setText( el, value ) { if ( el.textContent !== value ) el.textContent = value; }

export class Ferry {

	constructor( app ) {

		this.app = app;
		this.hull = 0;             // damage, 0 sound .. 1 holed
		this.flood = 0;            // 0 .. 1 while sinking
		this.driven = false;
		this.shake = 0;
		this.ramp = 0;             // stern ramp, 0 stowed .. 1 lowered
		this.rampGoal = 0;
		this.gangway = 0;          // the terminal's gangway, 0 out to her door .. 1 swung in
		this.castingOff = false;   // raising the ramp and swinging the gangway in, then letting go
		this.away = false;         // has left the berth since casting off (arms the capture)
		this.inbound = false;      // has sounded her arrival on this approach
		this.astern = false;       // has sounded going astern for this astern movement
		this.horns = 0;
		this.lastHorn = '';
		this.lastDistance = 0;
		// her berths: { name, label, terminal, x, z, yaw }; `at` is the one she lies at (or last left)
		const terminals = [ [ app.terminal, 'Tidewater' ], [ app.joeyTerminal, 'Joey Island' ] ].filter( ( [ t ] ) => t );
		this.berths = terminals.map( ( [ terminal, label ] ) => ( { name: terminal.name, label, terminal, ...terminal.berth() } ) );
		this.at = this.berths[ 0 ];

	}

	nearestBerth( p = this.ship.position ) {

		let best = this.berths[ 0 ], d = Infinity;
		for ( const b of this.berths ) { const e = Math.hypot( p.x - b.x, p.z - b.z ); if ( e < d ) { d = e; best = b; } }
		return best;

	}

	async init() {

		const base = import.meta.env.BASE_URL;
		const [ model, data ] = await Promise.all( [ loadModel( `${ base }ferry/ferry.glb`, { customize: ferryPaint } ), fetch( `${ base }ferry/ferry_colliders.json` ).then( r => r.json() ) ] );
		this.model = model;
		this.root = model.root;
		this.root.name = 'Ferry';
		// her small interior fittings (the builder's 'Props' group) cast no shadows
		for ( const mesh of model.pivots.get( 'Ferry Props' )?.children || [] ) mesh.castShadow = false;
		this.app.scene.add( this.root );
		this.ship = new FerryShip( this.at );
		this.ship.moor( this.at );
		// The timetable runs from the start: ?ferryService=off keeps her made fast at Tidewater until
		// a player takes her, and ?ferryTimetable=short shortens only its waits at the berths (tests).
		const qs = new URLSearchParams( location.search );
		this.service = new FerryService( this, { short: qs.get( 'ferryTimetable' ) === 'short', enabled: qs.get( 'ferryService' ) !== 'off' } );
		this.deck = new FerryDeck( this, data );
		this.app.player.vessel = this.deck;
		const pivot = name => model.pivots.get( name );
		this.parts = { wheel: pivot( 'HelmWheel' ), port: pivot( 'ThrottlePort' ), starboard: pivot( 'ThrottleStarboard' ), radars: [ pivot( 'RadarX' ), pivot( 'RadarS' ) ].filter( Boolean ), ramp: pivot( 'SternRamp' ) };
		// Her vehicle deck in the car physics: every 'car' box, in her frame (pitch 0), and the
		// stern: a wall across it while the ramp is up, the ramp itself once it is down.
		this.carBoxes = data.boxes.filter( b => b.kind === 'car' ).flatMap( b => [ ...b.center, ...b.half, 0, 0, 0.9 ] );
		this.buildPlatform();
		this.buildHud();
		this.sync();
		// other people's cars and foot passengers on the service (Traffic.js, Crowd.js), in the background
		this.traffic = new Traffic( this.app, this );
		this.crowd = new Crowd( this.app, this );
		this.traffic.init().catch( e => console.warn( 'Traffic: cars failed to load', e ) );
		this.crowd.init();

	}

	update( dt ) {

		if ( ! this.ship ) return;
		const { player, terrainData: terrain, colliders } = this.app;
		const ship = this.ship;
		// Walkers who step onto her decks come aboard.
		if ( player.mode === 'walk' && this.deck.canBoard( player.position ) ) this.deck.board( player, player.position );
		this.service.update( dt );
		if ( ! this.driven && ! this.service.steering ) { ship.lever *= Math.exp( - dt ); ship.thruster = 0; }
		// the stern thruster is the autopilot's alone (no key for it at the helm)
		if ( ! this.service.steering ) ship.stern = 0;
		// A damaged engine room gives less power; a holed hull floods and kills the engines.
		if ( this.hull > 0.5 ) ship.lever = Math.min( ship.lever, 1.4 - this.hull );
		if ( this.flood > 0 ) ship.lever = 0;
		ship.step( dt, { terrain, colliders } );
		for ( const hit of ship.takeImpacts() ) this.impact( hit );
		if ( this.hull >= 1 ) this.sink( dt );
		this.berthing();
		// Publish the current ramp/gangway collision state before its occupants
		// query support. A failed mooring must not leave a one-frame phantom plank.
		this.berthWork( dt );
		const t0 = performance.now();
		this.traffic?.update( dt );
		const pending = this.app.ragdollPool?.prepare( this.crowd?.people ?? [], dt, this.app.disasters?.field );
		if ( pending ) return pending.then( () => this.finishCrowd( dt, t0 ) );
		this.finishCrowd( dt, t0 );
	}

	finishCrowd( dt, t0 ) {
		this.crowd?.update( dt );
		this.peopleMs = 0.95 * ( this.peopleMs || 0 ) + 0.05 * ( performance.now() - t0 );
		this.sync();
		const [ radarX, radarS ] = this.parts.radars;
		if ( radarX ) radarX.rotation.y += dt * 2.6;
		if ( radarS ) radarS.rotation.y -= dt * 3.4;
		if ( this.parts.wheel ) this.parts.wheel.rotation.z = - this.ship.wheel * Math.PI * 3;
		if ( this.parts.port ) this.parts.port.rotation.x = this.ship.lever * 0.6;
		if ( this.parts.starboard ) this.parts.starboard.rotation.x = this.ship.lever * 0.6;
		if ( this.platform ) {

			const s = this.ship, p = s.position, q = s.quaternion, v = s.velocity;
			this.app.rally.physics.set_platform( PLATFORM, new Float32Array( [ p.x, p.y - this.flood * 3.2, p.z, q.x, q.y, q.z, q.w, v.x, 0, v.z, 0, s.r, 0 ] ) );

		}
		if ( this.shake > 0 ) this.shake = Math.max( 0, this.shake - dt * 2 );
		this.updateHud();

	}

	// ---------------------------------------------------------------- lines, ramp, gangway, signals

	// L at the helm: cast off when made fast, make fast when brought onto the berth.
	lines() {

		if ( this.ship.moored ) this.castOff();
		else if ( this.onMarks() ) this.makeFast();
		else this.app.game?.toast?.( 'Too far off the berth to make fast', 2500 );

	}

	// Casting off raises the ramp and swings the gangway in first; the lines go once both are clear.
	castOff() {

		if ( ! this.ship.moored || this.castingOff ) return false;
		if ( this.rampGoal > 0 && ! this.raiseRamp() ) return false;
		this.castingOff = true;
		if ( this.driven ) this.app.game?.toast?.( this.ramp > 0 ? 'Raising the ramp to cast off' : 'Casting off', 2500 );
		return true;

	}

	makeFast() {

		this.at = this.nearestBerth();
		this.ship.moor( this.at );
		this.castingOff = false;
		this.away = false;
		this.app.game?.toast?.( `Lines on: made fast at ${ this.at.label }`, 2500 );

	}

	// Near enough her marks, slowly enough, for the lines to go on.
	onMarks() {

		const s = this.ship, b = this.nearestBerth(), turn = Math.atan2( Math.sin( s.yaw - b.yaw ), Math.cos( s.yaw - b.yaw ) );
		return Math.hypot( s.position.x - b.x, s.position.z - b.z ) < CAPTURE.range && Math.abs( turn ) < CAPTURE.yaw && s.speed < CAPTURE.speed;

	}

	toggleRamp() { if ( this.rampGoal > 0 ) this.raiseRamp(); else this.lowerRamp(); }

	lowerRamp() {

		if ( ! this.ship.moored || this.castingOff ) { this.app.game?.toast?.( 'Make fast before lowering the ramp', 2500 ); return false; }
		this.rampGoal = 1;
		return true;

	}

	raiseRamp() {

		if ( this.carOnRamp() ) { this.app.game?.toast?.( 'A car is on the ramp: it stays down', 2500 ); return false; }
		this.rampGoal = 0;
		return true;

	}

	// The car on her ramp or the linkspan's end (her frame: aft of her deck, over the plate).
	carOnRamp() {

		const s = this.app.rally?.state;
		if ( ! s ) return false;
		const p = this.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		return Math.abs( p.x ) < 7 && p.z < HINGE.z + 2 && p.z > TOE.z - 4 && p.y > 0.5 && p.y < 6;

	}

	// Signals and the lines coming on by themselves as she is brought onto her marks.
	berthing() {

		const s = this.ship, p = s.position, MOORING = this.nearestBerth();
		const d = Math.hypot( p.x - MOORING.x, p.z - MOORING.z );
		if ( ! s.moored ) {

			// One prolonged blast nearing the berth inbound; three short going astern close in.
			if ( d > INBOUND + 50 ) this.inbound = false;
			const closing = s.velocity.x * ( MOORING.x - p.x ) + s.velocity.z * ( MOORING.z - p.z ) > 0;
			if ( ! this.inbound && d < INBOUND && this.lastDistance >= INBOUND && closing ) { this.inbound = true; this.horn( 'long' ); }
			if ( s.lever < 0 && ! this.astern && d < ASTERN ) { this.astern = true; this.horn( 'three' ); }
			if ( d > CAPTURE.armed ) this.away = true;
			if ( this.away && this.onMarks() ) this.makeFast();

		}
		if ( s.lever >= 0 ) this.astern = false;
		this.lastDistance = d;

	}

	// The ramp and the gangway move toward where the lines say; the car physics follows the ramp.
	berthWork( dt ) {

		const moored = this.ship.moored;
		if ( ! moored ) this.rampGoal = 0;
		const gangwayGoal = moored && ! this.castingOff ? 0 : 1;
		const rampWas = this.ramp, gangwayWas = this.gangway;
		this.ramp = toward( this.ramp, this.rampGoal, dt / RAMP_TIME );
		this.gangway = toward( this.gangway, gangwayGoal, dt / GANGWAY_TIME );
		const moving = this.ramp !== rampWas || this.gangway !== gangwayWas;
		if ( this.parts.ramp ) this.parts.ramp.rotation.x = RAMP_STOWED + ( RAMP_LOWERED - RAMP_STOWED ) * smooth( this.ramp );
		// the gangway and the linkspan barrier at the terminal she lies at; the other's stowed and down
		for ( const b of this.berths ) {

			b.terminal.setGangway?.( b === this.at ? smooth( this.gangway ) : 1 );
			b.terminal.setBarrier?.( ! ( b === this.at && moored && this.ramp >= 1 ) );
			b.terminal.updateBoom?.( dt );

		}
		if ( ( this.ramp >= 1 ) !== this.platformLowered ) this.buildPlatform();
		this.whine( moving );
		if ( this.castingOff && this.ramp === 0 && this.gangway === 1 ) {

			this.castingOff = false;
			this.away = false;
			this.ship.castOff();
			this.horn( 'long' );
			this.app.game?.toast?.( 'Lines cast off', 2500 );

		}

	}

	// Her car deck in the car physics, rebuilt as the ramp comes fully down or starts up. Her
	// transom is solid below the deck either way; above it the stowed ramp closes the stern.
	buildPlatform() {

		const physics = this.app.rally?.physics;
		const lowered = this.platformLowered = this.ramp >= 1;
		const T = 0.15, transom = [ 0, 0.5, HINGE.z - T, 6.6, 1.5, T, 0, 0, 0.9 ];
		let stern = [ 0, 5.1, HINGE.z - T, 6.6, 2.5, T, 0, 0, 0.9 ];
		if ( lowered ) {

			// One box pitched down from the hinge to the plate, its top flush with her deck at
			// the hinge and with the plate at the toe, running on 0.4 m under the plate.
			const run = HINGE.z - TOE.z, rise = HINGE.y - TOE.y, pitch = Math.atan2( rise, run );
			const half = ( Math.hypot( run, rise ) + 0.4 ) / 2;
			stern = [ 0, HINGE.y - half * Math.sin( pitch ) - T * Math.cos( pitch ), HINGE.z - half * Math.cos( pitch ) + T * Math.sin( pitch ), 5.0, T, half, 0, - pitch, 0.9 ];

		}
		this.platformBoxes = [ ...this.carBoxes, ...transom, ...stern ];
		this.platform = !! physics?.add_platform_pitched?.( PLATFORM, new Float32Array( this.platformBoxes ) );

	}

	// The ramp's and gangway's hydraulics: a strained electric whine over a low pump.
	whine( on ) {

		const audio = this.app.audio, ctx = audio?.ctx;
		if ( on && ! this.hum && ctx && audio.aboveOut ) {

			const out = ctx.createGain(); out.gain.value = 0;
			const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 700; filter.Q.value = 2.5;
			filter.connect( out ).connect( audio.aboveOut );
			const oscs = [ [ 'sawtooth', 93, 0.5 ], [ 'square', 372, 0.18 ], [ 'sine', 1116, 0.08 ] ].map( ( [ type, f, g ] ) => {

				const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = f;
				const gain = ctx.createGain(); gain.gain.value = g;
				osc.connect( gain ).connect( filter ); osc.start();
				return osc;

			} );
			const wobble = ctx.createOscillator(), depth = ctx.createGain();
			wobble.frequency.value = 5.5; depth.gain.value = 6;
			wobble.connect( depth ); for ( const osc of oscs ) depth.connect( osc.frequency );
			wobble.start();
			this.hum = { out, oscs: [ ...oscs, wobble ] };

		}
		if ( ! this.hum ) return;
		const distance = _v.copy( this.ship.position ).setY( 4 ).distanceTo( this.app.camera.position );
		this.hum.out.gain.setTargetAtTime( on ? 0.22 / ( 1 + distance / 40 ) : 0, ctx.currentTime, on ? 0.3 : 0.15 );
		if ( ! on ) { for ( const osc of this.hum.oscs ) osc.stop( ctx.currentTime + 1 ); this.hum = null; }

	}

	sync() {

		const ship = this.ship;
		this.root.position.copy( ship.position );
		this.root.position.y -= this.flood * 3.2;
		this.root.quaternion.copy( ship.quaternion );
		if ( this.flood > 0 ) this.root.rotateZ( this.flood * 0.14 ).rotateX( - this.flood * 0.05 );
		this.root.updateMatrixWorld( true );

	}

	// ---------------------------------------------------------------- helm, horn, damage

	onHelm( on ) {

		this.driven = on;
		this.hud.hidden = ! on;
		if ( on ) this.app.audio?.resume?.();

	}

	impact( { energy, speed } ) {

		const share = energy / HULL_STRENGTH;
		if ( share < 0.002 ) return;
		this.hull = Math.min( 1, this.hull + share );
		this.shake = Math.min( 1.5, this.shake + share * 6 + 0.1 );
		this.crunch( Math.min( 1, share * 8 + 0.15 ) );
		if ( share > 0.02 ) this.app.game?.toast?.( this.hull >= 1 ? 'Hull breached: she is taking on water' : speed > 2 ? 'Hard impact: hull damaged' : 'Hull scraped', 2500 );

	}

	// Holed: she floods over about a minute, settling by the stern and listing, then resets.
	sink( dt ) {

		this.flood = Math.min( 1, this.flood + dt / 60 );
		if ( this.flood < 1 ) return;
		const { player } = this.app;
		if ( player.mode === 'ferry' || player.mode === 'ferry-helm' ) { this.deck.overboard( player ); this.onHelm( false ); }
		this.at = this.berths[ 0 ];
		this.ship = new FerryShip( this.at );
		this.ship.moor( this.at );
		this.hull = 0; this.flood = 0;
		this.ramp = this.rampGoal = 0; this.castingOff = false;
		this.app.game?.toast?.( 'The Tidewater Spirit has been refloated at her mooring', 3500 );

	}

	// A ship's horn: two detuned low saws through a resonant horn filter, loud and far.
	horn( kind = 'long' ) {

		this.horns ++;
		this.lastHorn = kind;
		const audio = this.app.audio, ctx = audio?.ctx;
		if ( ! ctx || ! audio.aboveOut ) return;
		const blasts = kind === 'three' ? [ 0, 1.4, 2.8 ] : [ 0 ];
		const length = kind === 'long' ? 5.0 : 1.0;
		const distance = _v.copy( this.ship.position ).setY( 12 ).distanceTo( this.app.camera.position );
		const level = 0.55 / ( 1 + distance / 120 );
		for ( const at of blasts ) {

			const start = ctx.currentTime + at, end = start + length;
			const out = ctx.createGain(); out.gain.value = 0;
			out.gain.setTargetAtTime( level, start, 0.08 );
			out.gain.setTargetAtTime( 0, end, 0.25 );
			const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 6;
			filter.connect( out ).connect( audio.aboveOut );
			for ( const [ f, g ] of [ [ 110, 0.5 ], [ 110.8, 0.5 ], [ 220.5, 0.25 ] ] ) {

				const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
				const gain = ctx.createGain(); gain.gain.value = g;
				osc.connect( gain ).connect( filter );
				osc.start( start ); osc.stop( end + 1.5 );

			}

		}

	}

	// Impact noise: a low filtered burst, heavier with the blow.
	crunch( weight ) {

		const audio = this.app.audio, ctx = audio?.ctx;
		if ( ! ctx || ! audio.aboveOut ) return;
		const length = 0.4 + weight * 1.2, buffer = ctx.createBuffer( 1, Math.floor( ctx.sampleRate * length ), ctx.sampleRate ), d = buffer.getChannelData( 0 );
		for ( let i = 0; i < d.length; i ++ ) d[ i ] = ( Math.random() * 2 - 1 ) * Math.exp( - i / d.length * 5 );
		const source = ctx.createBufferSource(); source.buffer = buffer;
		const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 280 + weight * 400;
		const gain = ctx.createGain(); gain.gain.value = 0.4 + weight * 0.6;
		source.connect( filter ).connect( gain ).connect( audio.aboveOut );
		source.start();

	}

	// ---------------------------------------------------------------- the helm readout

	buildHud() {

		const hud = this.hud = document.createElement( 'section' );
		hud.className = 'fy-helm tw-glass';
		hud.setAttribute( 'role', 'status' );
		hud.setAttribute( 'aria-label', 'Ferry helm' );
		hud.hidden = true;
		hud.innerHTML = `
			<div class="fy-read"><span class="fy-speed">0.0</span><small>knots</small></div>
			<div class="fy-read"><span class="fy-heading">000</span><small>heading</small></div>
			<div class="fy-read"><span class="fy-rudder">0</span><small>rudder</small></div>
			<div class="fy-read"><span class="fy-lever">Stop</span><small>throttles</small></div>
			<div class="fy-read fy-hull-read"><span class="fy-hull">Sound</span><small>hull</small></div>
			<div class="fy-read fy-lines-read"><span class="fy-lines">On</span><small>lines</small></div>
			<div class="fy-read"><span class="fy-ramp">Up</span><small>ramp</small></div>
			<p class="fy-keys"><span class="fy-keyrow"><span><kbd>A</kbd><kbd>D</kbd> wheel</span> · <span><kbd>W</kbd><kbd>S</kbd> throttles</span> · <span><kbd>X</kbd> stop</span> · <span><kbd>C</kbd> centre</span> · <span><kbd>Shift</kbd>+<kbd>A</kbd><kbd>D</kbd> thruster</span></span><span class="fy-keyrow"><span><kbd>L</kbd> lines</span> · <span><kbd>R</kbd> ramp</span> · <span><kbd>H</kbd> horn</span> · <span><kbd>V</kbd> view</span> · <span><kbd>E</kbd> leave</span></span></p>`;
		( document.querySelector( '.tw-root' ) || document.body ).appendChild( hud );
		// the departures board: what the service does next, near a terminal or aboard
		const board = this.board = document.createElement( 'section' );
		board.className = 'fy-board tw-glass';
		board.setAttribute( 'role', 'status' );
		board.setAttribute( 'aria-label', 'Ferry departures' );
		board.hidden = true;
		board.innerHTML = '<small>Tidewater Spirit</small><span class="fy-board-line"></span>';
		( document.querySelector( '.tw-root' ) || document.body ).appendChild( board );
		this.boardLine = board.querySelector( '.fy-board-line' );
		const $ = s => hud.querySelector( s );
		this.read = { speed: $( '.fy-speed' ), heading: $( '.fy-heading' ), rudder: $( '.fy-rudder' ), lever: $( '.fy-lever' ), hull: $( '.fy-hull' ), hullRead: $( '.fy-hull-read' ), lines: $( '.fy-lines' ), linesRead: $( '.fy-lines-read' ), ramp: $( '.fy-ramp' ) };

	}

	updateBoard() {

		const board = this.board, service = this.service, { text } = service.board(), mode = this.app.player.mode, cam = this.app.camera.position;
		setData( board, 'phase', service.phase );
		setData( board, 'leg', service.phase === 'sailing' ? service.pilot.leg : '' );
		setData( board, 'crossing', service.lastCrossing.toFixed( 1 ) );
		if ( this.boardLine.textContent !== text ) this.boardLine.textContent = text;
		const aboard = mode === 'ferry' || mode === 'ferry-helm';
		const hidden = ! service.enabled || ( ! aboard && ! this.berths.some( b => Math.hypot( cam.x - b.x, cam.z - b.z ) < 300 ) );
		if ( board.hidden !== hidden ) board.hidden = hidden;

	}

	updateHud() {

		const ship = this.ship, r = this.read, hud = this.hud, set = setData, text = setText;
		// State for tests and tools, kept current whether or not the readout shows.
		set( hud, 'speed', ship.speed.toFixed( 3 ) );
		set( hud, 'hull', this.hull.toFixed( 3 ) );
		set( hud, 'x', ship.position.x.toFixed( 2 ) );
		set( hud, 'z', ship.position.z.toFixed( 2 ) );
		set( hud, 'yaw', ship.yaw.toFixed( 4 ) );
		set( hud, 'lines', ship.moored ? 'on' : 'off' );
		set( hud, 'ramp', this.ramp.toFixed( 3 ) );
		set( hud, 'gangway', this.gangway.toFixed( 3 ) );
		set( hud, 'horns', String( this.horns ) );
		set( hud, 'horn', this.lastHorn );
		set( hud, 'berth', ship.moored ? this.at.name : '' );
		this.updateBoard();
		if ( hud.hidden ) return;
		const knots = ship.speed * 1.9438 * Math.sign( ship.u || 1 );
		const heading = ( ( Math.atan2( Math.sin( ship.yaw ), - Math.cos( ship.yaw ) ) * 180 / Math.PI ) + 360 ) % 360;
		const rudder = Math.round( ship.rudder * 180 / Math.PI );
		const lever = Math.round( ship.lever * 100 );
		text( r.speed, knots.toFixed( 1 ) );
		text( r.heading, String( Math.round( heading ) ).padStart( 3, '0' ) );
		text( r.rudder, rudder === 0 ? '0' : `${ Math.abs( rudder ) }° ${ rudder > 0 ? 'stbd' : 'port' }` );
		text( r.lever, lever === 0 ? 'Stop' : `${ lever > 0 ? 'Ahead' : 'Astern' } ${ Math.abs( lever ) }%` );
		text( r.hull, this.flood > 0 ? 'Flooding' : this.hull < 0.02 ? 'Sound' : `${ Math.round( this.hull * 100 ) }% damage` );
		set( r.hullRead, 'level', this.flood > 0 || this.hull > 0.5 ? 'bad' : this.hull > 0.02 ? 'hurt' : '' );
		text( r.lines, this.castingOff ? 'Letting go' : ! ship.moored ? 'Off' : ship.settled ? 'On' : 'Hauling in' );
		set( r.linesRead, 'level', ship.moored ? 'on' : '' );
		text( r.ramp, this.ramp === this.rampGoal ? ( this.ramp >= 1 ? 'Down' : 'Up' ) : this.rampGoal > this.ramp ? 'Lowering' : 'Raising' );

	}

}
