// Driving HUD: the vehicle dock (bottom-left), the speedo cluster (bottom-centre),
// fading key hints and the recover prompt. Pure presentation over RallyDrive
// state; the cluster doubles as the `Rally telemetry` status the specs read.

import { VEHICLES } from './Vehicles.js';

// The tag, idle and redline of each car come from Vehicles.js, the one car table.
const STARTS = { beach: 'Beach', coast: 'Coastal road', town: 'Town backroad', mountain: 'Mountain summit', west: 'West beach entrance', east: 'East beach entrance', ferryRoad: 'Ferry road', ferry: 'Ferry terminal', joey: 'Joey Island terminal', joeyLoop: 'Joey Island road' };
const SURFACES = { sand: 'Sand', soil: 'Soil', rock: 'Rock', asphalt: 'Asphalt', gravel: 'Gravel', wood: 'Boardwalk', water: 'Shallows', 'wet-sand': 'Wet sand', afloat: 'Afloat' };
// Per-wheel physics surface codes s[89..92], in code order.
const WHEEL_SURFACES = [ 'sand', 'soil', 'rock', 'asphalt', 'gravel', 'wood', 'water', 'wet-sand' ];
// The redline zone always fills the last 14% of the dial, like the boat gauge.
const RED = 0.86;
// On foot the dock fades in within NEAR_CAR metres of a drivable car; a summoned dock
// (Backquote) dismisses after a walk of SUMMON_RANGE metres.
const NEAR_CAR = 7, SUMMON_RANGE = 25;
// The start screen offers it until a walk of START_WALK metres or START_TIME seconds of play.
const START_WALK = 4, START_TIME = 60;
// 240 degree dial open at the bottom, where the gear badge sits.
const polar = ( t, r = 50 ) => {
	const a = ( 150 + 240 * t ) * Math.PI / 180;
	return [ 60 + r * Math.cos( a ), 60 + r * Math.sin( a ) ];
};
const ARC = ( () => {
	const [ x0, y0 ] = polar( 0 ), [ x1, y1 ] = polar( 1 );
	return `M${ x0.toFixed( 2 ) } ${ y0.toFixed( 2 ) }A50 50 0 1 1 ${ x1.toFixed( 2 ) } ${ y1.toFixed( 2 ) }`;
} )();
const SOUND_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6.2h2.4L8.4 3.2v9.6L4.9 9.8H2.5z"/><path class="on" d="M10.9 5.7a3.2 3.2 0 0 1 0 4.6M12.8 3.9a5.8 5.8 0 0 1 0 8.2"/><path class="off" d="M10.8 6.3l3.4 3.4M14.2 6.3l-3.4 3.4"/></svg>';
const TOGETHER_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.4" r="2.3"/><path d="M1.8 13.2c.6-2.2 2.1-3.4 4.2-3.4s3.6 1.2 4.2 3.4"/><circle cx="11.5" cy="5.6" r="1.8"/><path d="M11.4 9.6c1.6 0 2.6.9 3 2.6"/></svg>';

export class DriveHUD {
	constructor( rally ) {
		this.rally = rally;
		this.app = rally.app;
		this.shownSpeed = 0; this.shownRev = 0; this.lastSpeed = - 1; this.lastGear = '';
		this.keysOn = true; this.keysHeld = false; this.moving = 0; this.still = 0;
		this.flip = 0; this.sunk = 0; this.surface = ''; this.surfaceTime = 0;
		this.wasActive = false; this.ticksFor = ''; this.last = performance.now(); this.frameTime = 0;
	}

	build() {
		const root = this.root = document.createElement( 'section' );
		root.className = 'rh';
		root.setAttribute( 'aria-label', 'Island driving' );
		const cars = Object.entries( VEHICLES ).map( ( [ value, car ] ) => `<option value="${ value }">${ car.name }</option>` ).join( '' );
		const starts = Object.entries( STARTS ).map( ( [ value, name ] ) => `<option value="${ value }">${ name }</option>` ).join( '' );
		root.innerHTML = `
			<div class="rh-dock tw-glass tw-interactive">
				<div class="rh-eyebrow">Take a car</div>
				<label class="rh-pick rh-car"><span class="rh-label">Vehicle</span><select aria-label="Vehicle">${ cars }</select></label>
				<p class="rh-tag"><span></span> <span></span></p>
				<label class="rh-pick rh-start"><span class="rh-label">Start at</span><select aria-label="Start at">${ starts }</select></label>
				<button type="button" class="rh-go">Drive Aster RS</button>
				<div class="rh-acts">
					<button type="button" class="rh-chip rh-drive-only" data-act="aids" aria-label="Driving aids" aria-pressed="true" aria-keyshortcuts="J"><kbd>J</kbd><span>Aids on</span></button>
					<button type="button" class="rh-chip rh-drive-only" data-act="recover" aria-label="Recover car" aria-keyshortcuts="R"><kbd>R</kbd>Recover</button>
					<button type="button" class="rh-chip rh-drive-only" data-act="repair" aria-label="Repair car" aria-keyshortcuts="T"><kbd>T</kbd>Repair</button>
					<button type="button" class="rh-chip rh-drive-only" data-act="leave" aria-label="Leave car" aria-keyshortcuts="E"><kbd>E</kbd>Leave</button>
					<button type="button" class="rh-chip rh-icon rh-drive-only rh-sound" aria-label="Engine sound" aria-pressed="false">${ SOUND_ICON }</button>
					<button type="button" class="rh-chip rh-share" aria-label="Drive together">${ TOGETHER_ICON }<span>Drive together</span></button>
				</div>
			</div>
			<div class="rh-keys" role="note" aria-label="Driving keys" hidden>
				<span><kbd>W</kbd>Throttle</span> <span><kbd>S</kbd>Brake · reverse</span> <span><kbd>A</kbd><kbd>D</kbd>Steer</span>
				<span><kbd>Space</kbd>Handbrake</span> <span><kbd>Y</kbd>Yeet</span> <span><kbd>F</kbd>Free cam</span> <span><kbd>K</kbd>Hide keys</span>
			</div>
			<div class="rh-cluster tw-glass" role="status" aria-label="Rally telemetry" aria-live="off" hidden>
				<i class="rh-pedal is-brake"><b></b></i>
				<div class="rh-dial">
					<svg viewBox="0 0 120 112" aria-hidden="true">
						<defs><linearGradient id="rh-rev" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3fc0d6"/><stop offset=".62" stop-color="#5fe3d4"/><stop offset="1" stop-color="#ffb86b"/></linearGradient></defs>
						<path class="rh-arc-bg" d="${ ARC }"/>
						<path class="rh-arc-red" d="${ ARC }" pathLength="100" stroke-dasharray="${ ( 1 - RED ) * 100 } 100" stroke-dashoffset="${ - RED * 100 }"/>
						<path class="rh-arc-val" d="${ ARC }" pathLength="100" stroke-dasharray="0 100"/>
						<g class="rh-ticks"></g>
						<circle class="rh-head" r="3.2"/>
					</svg>
					<div class="rh-read"><span class="rh-speed">0</span> <span class="rh-unit">km/h</span></div>
					<div class="rh-gear"><span class="rh-vh">Gear </span><b>N</b></div>
				</div>
				<i class="rh-pedal is-throttle"><b></b></i>
				<div class="rh-chips"><span data-chip="hand" hidden>Handbrake</span> <span data-chip="tc" hidden>TC</span> <span data-chip="abs" hidden>ABS</span> <span data-chip="surface" hidden></span> <span data-chip="damage" hidden></span></div>
			</div>
			<div class="rh-recover tw-glass" role="status" aria-live="polite" hidden><kbd>R</kbd><span><strong>Press R to recover</strong><small></small></span></div>`;
		const $ = selector => root.querySelector( selector );
		this.dock = $( '.rh-dock' ); this.go = $( '.rh-go' ); this.tag = root.querySelectorAll( '.rh-tag span' );
		this.vehicle = $( '[aria-label="Vehicle"]' ); this.start = $( '[aria-label="Start at"]' );
		this.aids = $( '[data-act="aids"]' ); this.aidsLabel = this.aids.querySelector( 'span' );
		this.sound = $( '.rh-sound' ); this.keys = $( '.rh-keys' ); this.cluster = $( '.rh-cluster' );
		this.speed = $( '.rh-speed' ); this.gearBox = $( '.rh-gear' ); this.gear = $( '.rh-gear b' );
		this.val = $( '.rh-arc-val' ); this.head = $( '.rh-head' ); this.ticks = $( '.rh-ticks' );
		this.brake = $( '.is-brake b' ); this.throttle = $( '.is-throttle b' );
		this.chips = Object.fromEntries( [ ...root.querySelectorAll( '[data-chip]' ) ].map( el => [ el.dataset.chip, el ] ) );
		this.recover = $( '.rh-recover' ); this.recoverWhy = $( '.rh-recover small' );
		this.recoverKey = $( '.rh-recover kbd' ); this.recoverText = $( '.rh-recover strong' );

		const rally = this.rally, input = this.app.input, canvas = this.app.engine.domElement;
		// Picking a car or a start moves the car away; keep the dock here while the player chooses.
		const hold = () => { if ( ! rally.active ) this.summonAt = { x: this.app.player.position.x, z: this.app.player.position.z }; };
		this.vehicle.addEventListener( 'change', () => { hold(); rally.selectVehicle( this.vehicle.value ); } );
		this.start.addEventListener( 'change', () => {
			hold(); rally.destination = this.start.value; rally.reset(); input.keys.clear(); input.pressed.clear(); canvas.focus();
		} );
		this.go.addEventListener( 'click', () => rally.enter() );
		this.aids.addEventListener( 'click', () => { rally.toggleAssists(); canvas.focus(); } );
		$( '[data-act="recover"]' ).addEventListener( 'click', () => { rally.recover(); canvas.focus(); } );
		$( '[data-act="leave"]' ).addEventListener( 'click', () => rally.leave() );
		$( '[data-act="repair"]' ).addEventListener( 'click', () => { rally.repair(); canvas.focus(); } );
		addEventListener( 'keydown', event => {
			if ( event.code === 'KeyT' && ! event.repeat && rally.active && ! this.app.freeCam && ! event.target?.closest?.( 'input, select, textarea' ) ) rally.repair();
		} );
		this.sound.addEventListener( 'click', () => {
			if ( rally.sound.disabled ) return;
			rally.sound.toggle( rally.vehicleKey ); rally.refreshUI(); canvas.focus();
		} );
		$( '.rh-share' ).addEventListener( 'click', () => rally.shared.show() );
		addEventListener( 'keydown', event => this.onKey( event ) );
		this.app.ui.ui.root.append( root );
		requestAnimationFrame( time => this.frame( time ) );
		return root;
	}

	// On foot the dock only shows on the start screen (before the first walk or drive),
	// next to a drivable car (rally.nearCar) or when summoned; driving always shows it.
	offered( active, blocked ) {
		const app = this.app, p = app.player, pos = p.position, onFoot = p.mode === 'walk' || p.mode === 'ferry';
		// The start screen ends for good on the first walk of START_WALK metres, a drive, the
		// free camera, any other mode or a teleport, or START_TIME seconds after the intro.
		if ( this.fresh !== false ) {
			this.origin ??= { x: pos.x, z: pos.z };
			const now = performance.now();
			// the clock waits out the loader and the intro guide
			if ( ! this.shownAt || app.game?.guide?.open || document.getElementById( 'loader' )?.checkVisibility?.() ) this.shownAt = now;
			this.fresh = ! active && ! app.freeCam && p.mode === 'walk' && now - this.shownAt < START_TIME * 1000
				&& Math.hypot( pos.x - this.origin.x, pos.z - this.origin.z ) < START_WALK;
		}
		if ( this.summonAt && ( active || blocked || ! ( onFoot || app.freeCam )
			|| Math.hypot( pos.x - this.summonAt.x, pos.z - this.summonAt.z ) > SUMMON_RANGE ) ) this.summonAt = null;
		return active || ( ! blocked && ( this.fresh || !! this.summonAt || ( onFoot && !! this.rally.nearCar( pos, NEAR_CAR ) ) ) );
	}

	// The unlisted "get me a car" key (Backquote): summons the dock on foot or in free
	// camera; again, a walk of SUMMON_RANGE or getting in dismisses it.
	summon() {
		const app = this.app, p = app.player;
		if ( this.summonAt ) this.summonAt = null;
		else if ( ! this.rally.active && ( p.mode === 'walk' || p.mode === 'ferry' || app.freeCam ) ) this.summonAt = { x: p.position.x, z: p.position.z };
		this.rally.refreshUI();
	}

	onKey( event ) {
		if ( event.code === 'Backquote' && ! event.repeat && ! event.target?.closest?.( 'input, select, textarea' ) ) this.summon();
		if ( event.code !== 'KeyK' || event.repeat || ! this.rally.active || event.target?.closest?.( 'input, select, textarea' ) ) return;
		this.keysOn = ! this.keysOn; this.keysHeld = ! this.keysOn; this.moving = 0;
		this.keys.classList.toggle( 'is-off', ! this.keysOn );
		this.dock.classList.toggle( 'is-quiet', ! this.keysOn );
	}

	// Runs from RallyDrive.refreshUI: every 0.1 s and right after enter/leave/reset.
	refresh() {
		const rally = this.rally, s = rally.state, app = this.app;
		if ( ! this.root || ! s ) return;
		const now = performance.now(), dt = Math.min( 0.5, ( now - this.last ) / 1000 );
		this.last = now;
		const active = rally.active, profile = rally.profile, car = profile;
		const driving = active && ! app.freeCam, speed = Math.abs( s[ 7 ] );
		this.dock.classList.toggle( 'is-driving', active );
		// Nothing to choose while the driver is still tumbling from a bail-out, or tumbling at all.
		const blocked = this.dock.hidden = !! rally.bailout?.active || app.player.mode === 'ferry-helm'
			|| app.player.mode === 'jetski' || app.player.mode === 'jetski-thrown' || app.player.mode === 'ragdoll';
		const offered = this.offered( active, blocked );
		this.dock.classList.toggle( 'is-away', ! offered );
		this.dock.inert = ! offered;
		if ( this.aidsOn !== rally.assists ) {
			this.aidsOn = rally.assists;
			this.aids.setAttribute( 'aria-pressed', String( rally.assists ) );
			this.aidsLabel.textContent = rally.assists ? 'Aids on' : 'Aids off';
		}
		this.go.hidden = active;
		this.go.textContent = `Drive ${ profile.name }`;
		this.go.disabled = !! ( app.game.fight || app.game.landing );
		this.tag[ 0 ].textContent = car.tag;
		this.tag[ 1 ].textContent = `${ profile.mass.toLocaleString( 'en' ) } kg`;
		if ( this.vehicle.value !== rally.vehicleKey ) this.vehicle.value = rally.vehicleKey;
		if ( this.start.value !== rally.destination ) this.start.value = rally.destination;
		if ( this.ticksFor !== rally.vehicleKey ) this.buildTicks( car );
		this.cluster.hidden = ! active;
		// Driving keys mean nothing while W/A/S/D fly the free camera.
		this.keys.hidden = ! driving;
		// the strip's row, rechecked twice a second (the mode pill and purse change width) and when it shows
		if ( driving && ( ( this.fitIn = ( this.fitIn ?? 0 ) - dt ) <= 0 || ! this.keys.dataset.fit ) ) { this.fitIn = 0.5; this.fitKeys(); }

		if ( active && ! this.wasActive ) { this.keysOn = true; this.keysHeld = false; this.moving = this.still = 0; this.surface = ''; }
		this.wasActive = active;
		if ( active ) {
			if ( speed > 3 ) { this.moving += dt; this.still = 0; } else this.still += dt;
			// Hints tuck away after ~6 s of real driving and come back once parked.
			if ( this.keysOn && this.moving > 6 ) this.keysOn = false;
			if ( ! this.keysOn && ! this.keysHeld && this.still > 3 ) { this.keysOn = true; this.moving = 0; }
		}
		this.keys.classList.toggle( 'is-off', ! this.keysOn );
		this.dock.classList.toggle( 'is-quiet', active && ! this.keysOn );

		const submerged = s[ 73 ] ?? 0;
		// In the air the chip keeps the last surface the tyres touched.
		const kind = submerged > 0.05 ? 'afloat' : this.wheelSurface( s ) || this.surface || app.terrainData.roadSurfaceAt?.( s[ 0 ], s[ 2 ] )?.kind || 'sand';
		if ( kind !== this.surface ) { this.surface = kind; this.surfaceTime = 0; }
		this.surfaceTime += dt;
		const chips = this.chips;
		chips.surface.textContent = SURFACES[ kind ] || kind;
		chips.surface.dataset.kind = kind;
		chips.surface.hidden = kind !== 'afloat' && this.surfaceTime > 3.5;
		const input = app.input, held = code => driving && input.down( code );
		chips.hand.hidden = ! ( driving && ( s[ 72 ] ?? Number( held( 'Space' ) ) ) > 0.5 );
		chips.tc.hidden = ! ( ( s[ 74 ] ?? 0 ) > 0.5 );
		chips.abs.hidden = ! ( ( s[ 75 ] ?? 0 ) > 0.5 );
		const damage = rally.damage?.summary();
		chips.damage.hidden = ! damage;
		if ( damage && chips.damage.textContent !== damage.text ) chips.damage.textContent = damage.text;
		if ( damage ) chips.damage.dataset.level = damage.level;

		this.flip = rally.up.y < 0.3 ? this.flip + dt : 0;
		// Afloat (no wheel on the seabed) and barely moving: the wheels only paddle.
		// (the swell alone drifts a floating car at 2 to 4 km/h, so allow up to 6, and a bobbing
		// hull brushing the seabed with one wheel is still adrift: decay, never reset, with
		// hysteresis so the prompt does not flicker)
		const adrift = submerged > 0.12 && s[ 10 ] <= 1 && speed < 6;
		this.sunk = adrift ? this.sunk + dt : Math.max( 0, this.sunk - dt * 2 );
		this.shownAdrift = this.sunk > 4 || ( this.shownAdrift && this.sunk > 2 );
		const stuck = driving && ( this.flip > 1.5 || this.shownAdrift );
		this.recover.hidden = ! stuck;
		if ( stuck ) {
			this.recoverWhy.textContent = this.flip > 1.5 ? 'The car is on its roof' : 'The car is adrift';
			// A driver on a gamepad is told the pad's button (Y recovers there).
			const key = rally.gamepad?.() ? 'Y' : 'R';
			if ( this.recoverKey.textContent !== key ) { this.recoverKey.textContent = key; this.recoverText.textContent = `Press ${ key } to recover`; }
		}

		const sound = rally.sound, on = sound.enabled && ! sound.disabled;
		this.sound.setAttribute( 'aria-pressed', String( on ) );
		this.sound.classList.toggle( 'is-muted', ! on );
		if ( sound.disabled ) this.sound.setAttribute( 'aria-disabled', 'true' );
		this.sound.title = sound.disabled ? 'Audio is off for this session' : on ? 'Mute engine' : 'Unmute engine';
		this.writeTelemetry( s );
	}

	// Most grounded wheels agree on the surface they touch; null with every wheel in the air
	// (an airborne wheel's code is a default, not ground) or before the physics exposes codes.
	wheelSurface( s ) {
		if ( s.length < 93 ) return null;
		const count = new Map();
		for ( let w = 0; w < 4; w ++ ) if ( s[ 16 + w * 4 ] > 0.5 ) { const code = Math.round( s[ 89 + w ] ); count.set( code, ( count.get( code ) || 0 ) + 1 ); }
		if ( ! count.size ) return null;
		const [ code ] = [ ...count ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ];
		return WHEEL_SURFACES[ code ] || null;
	}

	writeTelemetry( s ) {
		const rally = this.rally, app = this.app, el = this.cluster;
		const values = { x: s[ 0 ], y: s[ 1 ], z: s[ 2 ], speed: Math.abs( s[ 7 ] ), 'signed-speed': s[ 7 ], gear: s[ 8 ],
			grounded: s[ 10 ], 'model-parts': rally.model.parts, 'up-y': rally.up.y, 'forward-x': rally.forward.x, 'forward-z': rally.forward.z,
			'ground-clearance': s[ 1 ] - app.terrainData.heightAt( s[ 0 ], s[ 2 ] ), rpm: s[ 9 ], slide: s[ 12 ],
			submerged: s[ 73 ] ?? 0, 'stability-control': s[ 74 ] ?? 0, abs: s[ 75 ] ?? 0, 'lateral-g': s[ 76 ] ?? 0,
			'yaw-rate': s[ 78 ] ?? 0, 'water-level': s[ 93 ] ?? - 1000 };
		for ( const [ key, value ] of Object.entries( values ) ) el.setAttribute( `data-${ key }`, Number( value ).toFixed( 4 ) );
		for ( const [ key, value ] of Object.entries( rally.damage?.telemetry() || {} ) ) el.setAttribute( `data-${ key }`, Number( value ).toFixed( 4 ) );
		el.dataset.vehicle = rally.vehicleKey;
		el.dataset.mass = rally.profile.mass;
		el.dataset.wheelRadius = rally.profile.radius;
		el.dataset.trackSegments = rally.tracks.count;
		el.dataset.trackSkids = rally.tracks.skids ?? 0;
		el.dataset.trackWidth = rally.profile.width;
		// The least-turned wheel (a free-rolling front one): all four turn when this one does.
		const turns = rally.turns;
		el.dataset.wheelTurns = Math.min( Math.abs( turns[ 0 ] ), Math.abs( turns[ 1 ] ), Math.abs( turns[ 2 ] ), Math.abs( turns[ 3 ] ) ).toFixed( 3 );
		el.dataset.audioRecording = rally.sound.recording || '';
		el.dataset.audioState = rally.sound.state;
		el.dataset.audioRate = rally.sound.source?.playbackRate.value || 0;
		el.dataset.audioGain = rally.sound.gain?.gain.value || 0;
		el.dataset.remoteCars = rally.shared?.peers.size || 0;
		el.dataset.surface = app.terrainData.roadSurfaceAt?.( s[ 0 ], s[ 2 ] )?.kind || 'sand';
		el.dataset.wheelSurface = this.wheelSurface( s ) || '';
		el.dataset.roadLength = app.coastalRoute?.length || 0;
		el.dataset.roadMaxGrade = app.coastalRoute?.maxGrade || 0;
		el.dataset.ferryRoadLength = app.coastalRoute?.ferryRoadLength || 0;
		el.dataset.ferryRoadMaxGrade = app.coastalRoute?.ferryRoadMaxGrade || 0;
	}

	buildTicks( car ) {
		this.ticksFor = this.rally.vehicleKey;
		const max = car.redline / RED;
		let lines = '';
		for ( let rpm = 500; rpm < max; rpm += 500 ) {
			const major = rpm % 1000 === 0, t = rpm / max;
			const [ x0, y0 ] = polar( t, major ? 41 : 43.5 ), [ x1, y1 ] = polar( t, 46 );
			lines += `<line${ major ? ' class="maj"' : '' }${ rpm >= car.redline ? ' data-red=""' : '' } x1="${ x0.toFixed( 2 ) }" y1="${ y0.toFixed( 2 ) }" x2="${ x1.toFixed( 2 ) }" y2="${ y1.toFixed( 2 ) }"/>`;
		}
		this.ticks.innerHTML = lines;
	}

	// Per-frame gauge motion so the needle and digits glide instead of ticking at 10 Hz.
	frame( time ) {
		requestAnimationFrame( next => this.frame( next ) );
		const rally = this.rally, s = rally.state;
		const dt = Math.min( 0.1, Math.max( 0, ( time - ( this.frameTime || time ) ) / 1000 ) );
		this.frameTime = time;
		if ( ! s || ! rally.active ) return;
		const car = rally.profile, k = 1 - Math.exp( - dt * 14 );
		this.shownSpeed += ( Math.abs( s[ 7 ] ) - this.shownSpeed ) * k;
		this.shownRev += ( Math.min( 1, Math.max( 0, s[ 9 ] * RED / car.redline ) ) - this.shownRev ) * k;
		const speed = Math.round( this.shownSpeed );
		if ( speed !== this.lastSpeed ) { this.speed.textContent = speed; this.lastSpeed = speed; }
		const gear = s[ 8 ] < 0 ? 'R' : s[ 8 ] === 0 ? 'N' : String( s[ 8 ] );
		if ( gear !== this.lastGear ) {
			this.gear.textContent = gear; this.lastGear = gear;
			this.gearBox.classList.remove( 'is-shift' ); void this.gearBox.offsetWidth; this.gearBox.classList.add( 'is-shift' );
		}
		this.gearBox.dataset.gear = gear;
		this.val.setAttribute( 'stroke-dasharray', `${ ( this.shownRev * 100 ).toFixed( 2 ) } 100` );
		const [ x, y ] = polar( this.shownRev );
		this.head.setAttribute( 'cx', x.toFixed( 2 ) ); this.head.setAttribute( 'cy', y.toFixed( 2 ) );
		this.cluster.classList.toggle( 'is-redline', s[ 9 ] >= car.redline * 0.97 );
		const input = this.app.input, driving = ! this.app.freeCam, held = code => driving && input.down( code );
		const throttle = s[ 69 ] ?? Number( held( 'KeyW' ) || held( 'ArrowUp' ) );
		const brake = s[ 70 ] ?? Number( held( 'KeyS' ) || held( 'ArrowDown' ) );
		this.throttle.style.transform = `scaleY(${ throttle.toFixed( 3 ) })`;
		this.brake.style.transform = `scaleY(${ brake.toFixed( 3 ) })`;
	}

	// The key strip sits centred in the top row when it fits between what is up there at its left
	// (the brand and mode pill) and at its right (the purse), with a gap each side; otherwise it
	// drops below that row (rally.css .rh-keys.is-below). Measured, not a width breakpoint: the
	// pill and purse change width with the vehicle and the cooler.
	fitKeys() {
		const keys = this.keys, width = innerWidth, mid = width / 2, half = keys.offsetWidth / 2, gap = 12;
		if ( ! half ) return;
		let left = 0, right = width;
		for ( const el of document.querySelectorAll( '.tw-brand, .tw-mode, .gm-purse' ) ) {
			const r = el.getBoundingClientRect();
			if ( ! r.width || r.top > 100 ) continue;
			if ( r.left + r.right < width ) left = Math.max( left, r.right ); else right = Math.min( right, r.left );
		}
		const below = mid - half < left + gap || mid + half > right - gap;
		keys.classList.toggle( 'is-below', below );
		keys.dataset.fit = below ? 'below' : 'top';
	}
}
