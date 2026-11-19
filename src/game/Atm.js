import { Vector3 } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { checkNotes, withdrawMessage } from './GameState.js';

// Tidewater Community Bank ATMs (public/models/atm.glb, tools/props/atm_build.py): one by Marta's chandlery,
// one on the Joey Island shopfront between the gift shop and the tackle shop. Walk up, "E Use ATM" opens the
// ATM screen: insert the card, key the PIN (GameState.pin, random per game, on the HUD's card chip), then withdraw (GameState.withdraw moves bank to pocket) or check
// the balance. Three wrong PINs and the card is retained for RETAIN_S seconds of play, then handed back.
// While the screen is up it takes every key press first, so WASD, numbers and the game's shortcuts go to the
// ATM and not to the player. Without a DOM (headless) the machines still stand and block, and E says so.
export const PIN_TRIES = 3;
export const RETAIN_S = 60;
export const QUICK_AMOUNTS = [ 20, 50, 100, 200 ];
const USE_RANGE = 1.3; // from the spot in front of the keypad
const FRONT = 0.75; // that spot, metres out from the cabinet

// Tidewater: beside the chandlery counter on its beach side, facing the same way (CHANDLERY in Chandlery.js).
// Joey: on the footpath against the tackle shop window (clear of the bin and bench by the party wall), facing the car park
// (Joey terminal frame, docs/joey-village.md).
export const ATM_SITES = [
	{ id: 'tidewater', name: 'Tidewater, by the chandlery', at: { x: 85.5, z: - 60.5, yaw: - 1.9, side: 4.6, out: 0.1 } },
	{ id: 'joey', name: 'Joey Island shops', joey: { local: [ 38.9, 3.33, - 70.36 ], turn: Math.PI } },
];

const CSS = `
.atm-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -48%); display: grid; grid-template-columns: 1fr auto; gap: var(--tw-4);
	width: calc(640 * var(--tw-u)); max-width: calc(100vw - 2 * var(--tw-edge)); padding: var(--tw-4); border-radius: var(--tw-r-lg);
	font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); opacity: 0; pointer-events: none; transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-med) var(--tw-ease); }
.atm-panel.is-open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.tw-root.is-photo .atm-panel { display: none; }
.atm-screen { position: relative; min-height: calc(300 * var(--tw-u)); display: flex; flex-direction: column; padding: var(--tw-4) var(--tw-5);
	border-radius: var(--tw-r-md); background: radial-gradient(120% 90% at 30% 0%, #0f4a55 0%, #06262f 55%, #041a21 100%);
	box-shadow: inset 0 0 0 1px rgba(95, 227, 212, 0.22), inset 0 calc(10 * var(--tw-u)) calc(30 * var(--tw-u)) rgba(0, 0, 0, 0.45); overflow: hidden; }
.atm-screen::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
	background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px); }
.atm-bank { display: flex; align-items: center; gap: var(--tw-2); padding-bottom: var(--tw-2); margin-bottom: var(--tw-3); border-bottom: 1px solid rgba(95, 227, 212, 0.25);
	font: 600 var(--tw-fs-sm) var(--tw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tw-aqua); }
.atm-bank i { width: calc(18 * var(--tw-u)); height: calc(18 * var(--tw-u)); border-radius: 50%; background: var(--tw-aqua); color: #06262f; display: grid; place-items: center;
	font: 800 calc(10 * var(--tw-u)) var(--tw-font); font-style: normal; }
.atm-bank span { white-space: nowrap; }
.atm-bank span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis;
	margin-left: auto; color: var(--tw-ink-3); letter-spacing: 0.02em; text-transform: none; font-weight: 500; }
.atm-title { margin: 0 0 var(--tw-1); font-size: calc(19 * var(--tw-u)); font-weight: 600; color: #f2fbfb; }
.atm-sub { margin: 0 0 var(--tw-3); color: var(--tw-ink-2); font-size: var(--tw-fs-md); min-height: 1.3em; }
.atm-msg { margin: var(--tw-2) 0 0; min-height: 1.4em; font-weight: 600; color: var(--tw-sun); }
.atm-msg.is-bad { color: var(--tw-coral); }
.atm-dots { display: flex; gap: var(--tw-3); margin: var(--tw-3) 0; }
.atm-dots span { width: calc(34 * var(--tw-u)); height: calc(42 * var(--tw-u)); border-radius: var(--tw-r-sm); background: rgba(0, 0, 0, 0.35); box-shadow: inset 0 0 0 1px rgba(95, 227, 212, 0.3);
	display: grid; place-items: center; font: 700 calc(22 * var(--tw-u)) var(--tw-mono); color: #f2fbfb; }
.atm-field { margin: var(--tw-3) 0; padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-sm); background: rgba(0, 0, 0, 0.35); box-shadow: inset 0 0 0 1px rgba(95, 227, 212, 0.3);
	font: 700 calc(26 * var(--tw-u)) var(--tw-mono); color: #f2fbfb; min-width: calc(160 * var(--tw-u)); align-self: flex-start; }
.atm-field span { color: var(--tw-ink-4); }
.atm-opts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tw-2) var(--tw-4); margin-top: auto; }
.atm-opt { display: flex; align-items: center; gap: var(--tw-2); padding: var(--tw-2) var(--tw-3); border: 0; border-radius: var(--tw-r-sm); cursor: pointer;
	background: rgba(95, 227, 212, 0.12); color: #f2fbfb; font: 600 var(--tw-fs-md) var(--tw-font); text-align: left; box-shadow: inset 0 0 0 1px rgba(95, 227, 212, 0.28); }
.atm-opt:hover { background: rgba(95, 227, 212, 0.22); }
.atm-opt kbd { flex: none; min-width: calc(18 * var(--tw-u)); padding: 1px 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.4); color: var(--tw-aqua); font: 600 var(--tw-fs-xs) var(--tw-mono); text-align: center; }
.atm-opt.is-right { flex-direction: row-reverse; text-align: right; }
.atm-opt.is-go { background: rgba(60, 200, 110, 0.22); box-shadow: inset 0 0 0 1px rgba(90, 220, 130, 0.5); }
.atm-opt.is-stop { background: rgba(255, 122, 133, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 122, 133, 0.42); }
.atm-busy { display: flex; align-items: center; gap: var(--tw-3); margin: var(--tw-3) 0; color: var(--tw-ink-2); }
.atm-busy::before { content: ''; width: calc(18 * var(--tw-u)); height: calc(18 * var(--tw-u)); border-radius: 50%; border: 2px solid rgba(95, 227, 212, 0.25); border-top-color: var(--tw-aqua);
	animation: atm-spin 0.9s linear infinite; }
@keyframes atm-spin { to { transform: rotate(360deg); } }
.atm-cash { display: flex; gap: 4px; margin: var(--tw-2) 0 var(--tw-3); height: calc(46 * var(--tw-u)); align-items: flex-end; }
.atm-cash b { width: calc(78 * var(--tw-u)); height: calc(38 * var(--tw-u)); border-radius: 3px; animation: atm-note 700ms var(--tw-ease) both;
	background: linear-gradient(90deg, rgba(0, 0, 0, 0.12), transparent 30%, rgba(255, 255, 255, 0.12) 60%, rgba(0, 0, 0, 0.1)), var(--c); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
	display: grid; place-items: center; font: 700 var(--tw-fs-sm) var(--tw-mono); color: rgba(0, 0, 0, 0.55); }
@keyframes atm-note { from { transform: translateY(calc(26 * var(--tw-u))); opacity: 0; } }
.atm-slip { margin: var(--tw-1) 0 var(--tw-3); align-self: center; width: calc(250 * var(--tw-u)); padding: var(--tw-3); background: #f3f0e6; color: #232323; border-radius: 2px;
	font: 500 var(--tw-fs-sm) var(--tw-mono); line-height: 1.5; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4); animation: atm-note 600ms var(--tw-ease) both; }
.atm-slip div { display: flex; justify-content: space-between; gap: var(--tw-2); }
.atm-slip hr { border: 0; border-top: 1px dashed #999; margin: var(--tw-1) 0; }
.atm-slip .is-c { justify-content: center; font-weight: 700; }
.atm-pad { display: grid; grid-template-columns: repeat(3, calc(46 * var(--tw-u))) calc(70 * var(--tw-u)); gap: var(--tw-2); align-content: center; padding: var(--tw-3);
	border-radius: var(--tw-r-md); background: linear-gradient(180deg, #1c2126, #121518); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.atm-pad button { display: grid; place-items: center; padding: 0; outline: none; height: calc(42 * var(--tw-u)); border: 0; border-radius: var(--tw-r-sm); cursor: pointer; font: 700 var(--tw-fs-lg) var(--tw-font); color: #1a1d20;
	background: linear-gradient(180deg, #e9ecee, #b9bec2); box-shadow: 0 2px 0 #6d7277, inset 0 1px 0 rgba(255, 255, 255, 0.7); }
.atm-pad button:focus-visible { box-shadow: 0 0 0 2px var(--tw-aqua); }
.atm-pad button:active { transform: translateY(1px); box-shadow: 0 1px 0 #6d7277; }
.atm-pad button.is-blank { visibility: hidden; }
.atm-pad button.is-dot { position: relative; }
.atm-pad button.is-dot::after { content: ''; position: absolute; left: 50%; bottom: calc(6 * var(--tw-u)); width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: #5d6368; }
.atm-pad .is-cancel, .atm-pad .is-clear, .atm-pad .is-enter { grid-column: 4; font-size: var(--tw-fs-xs); letter-spacing: 0.06em; text-transform: uppercase; }
.atm-pad .is-cancel { background: linear-gradient(180deg, #d8454a, #a52a2f); color: #fff; box-shadow: 0 2px 0 #6a1a1d; }
.atm-pad .is-clear { background: linear-gradient(180deg, #f2cb45, #c99a17); color: #2a2204; box-shadow: 0 2px 0 #7a5d0c; }
.atm-pad .is-enter { background: linear-gradient(180deg, #3fbf6a, #22884a); color: #fff; box-shadow: 0 2px 0 #145430; }
.atm-hint { grid-column: 1 / -1; margin: 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); text-align: center; }
.gm-mk.is-atm > i { background: #a6e07c; color: #173010; font: 800 calc(11 * var(--tw-u)) var(--tw-font); font-style: normal; }
@media (max-width: 640px) { .atm-panel { grid-template-columns: 1fr; } .atm-pad { justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .atm-cash b, .atm-slip, .atm-busy::before { animation: none; } }
`;

// World-space wear for the W* materials, in the machine's own frame (so each ATM gets its own copy):
// a dirt and salt band at the foot, drip streaks under the ledges, blotchy powder coat, hairline brushing
// on the steel and a polished, grubby patch round the keypad and card reader where hands go.
function wear( site, name ) {

	const c = Math.cos( site.yaw ), s = Math.sin( site.yaw ), p = site.position;
	const head = `
	let atmP = in.P - vec3f( ${ p.x.toFixed( 3 ) }, ${ p.y.toFixed( 3 ) }, ${ p.z.toFixed( 3 ) } );
	let atmX = atmP.x * ${ c.toFixed( 5 ) } - atmP.z * ${ s.toFixed( 5 ) };
	let atmZ = atmP.x * ${ s.toFixed( 5 ) } + atmP.z * ${ c.toFixed( 5 ) };
	let atmH = atmP.y;
	let atmHash = fract( sin( dot( floor( atmP * 90.0 ), vec3f( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
	let atmBroad = sin( atmX * 9.0 + sin( atmH * 5.0 ) * 1.3 ) * sin( atmH * 7.0 + atmZ * 6.0 );
	let atmFoot = 1.0 - smoothstep( 0.05, 0.42, atmH );
	let atmCol = floor( atmX * 70.0 );
	let atmDrip = step( 0.78, fract( sin( atmCol * 91.7 ) * 437.5 ) ) * smoothstep( 0.95, 0.55, atmH ) * smoothstep( 0.1, 0.3, atmH );
	let atmHands = ( 1.0 - smoothstep( 0.0, 0.14, abs( atmH - 1.1 ) ) ) * step( 0.2, atmZ );
	s.albedo = s.albedo * ( 1.0 - 0.42 * atmFoot * ( 0.6 + 0.4 * atmHash ) ) * ( 1.0 - 0.10 * atmDrip ) * ( 1.0 - 0.08 * atmHands );
	s.albedo = s.albedo + vec3f( 0.05, 0.05, 0.045 ) * atmFoot * step( 0.965, atmHash );
	s.roughness = clamp( s.roughness + 0.18 * atmFoot - 0.12 * atmHands, 0.05, 1.0 );`;
	if ( /Steel/.test( name ) ) return head + `
	let atmLine = fract( sin( floor( atmH * 1400.0 + sin( atmX * 4.0 ) * 3.0 ) * 12.9898 ) * 43758.5453 );
	s.albedo = s.albedo * ( 0.9 + 0.16 * atmLine + 0.05 * atmBroad );
	s.roughness = clamp( s.roughness + 0.1 * ( atmLine - 0.5 ) + 0.05 * atmBroad, 0.05, 1.0 );`;
	return head + `
	s.albedo = s.albedo * ( 1.0 + 0.1 * atmBroad + 0.06 * ( atmHash - 0.5 ) );`;

}

export class AtmNetwork {

	constructor( game ) {

		this.game = game;
		this.app = game.app;
		this.sites = [];
		this.open = false;
		this.site = null;
		this.screen = 'welcome';
		this.pin = '';
		this.tries = 0;
		this.retainT = 0; // seconds until a retained card comes back
		this.amount = 0;
		this.entry = '';
		this.msg = null;
		this.day = 0; // game days since the session began (the daily limit's day)
		this._hour = this.app.settings?.timeOfDay;
		this._anim = [];
		this._v = new Vector3();
		for ( const def of ATM_SITES ) {

			const site = this.resolve( def );
			if ( site ) this.sites.push( site );

		}

		for ( const site of this.sites ) this.addCollider( site );
		this.ready = Promise.all( this.sites.map( ( s ) => this.loadSite( s ) ) );
		this._onKey = ( e ) => this.onKey( e );

	}

	// world position and yaw of a site; the Joey one waits for the Joey terminal
	resolve( def ) {

		const app = this.app;
		if ( def.at ) {

			const a = def.at, c = Math.cos( a.yaw ), s = Math.sin( a.yaw );
			// local +x along the counter, +z out the front: side metres along it, out metres forward
			const x = a.x + a.side * c + a.out * s, z = a.z - a.side * s + a.out * c;
			return { id: def.id, name: def.name, position: new Vector3( x, app.terrainData.heightAt( x, z ), z ), yaw: a.yaw };

		}

		const v = app.joeyVillage, t = app.joeyTerminal;
		if ( ! v || ! t || typeof v.toWorld !== 'function' ) return null;
		const p = v.toWorld( def.joey.local );
		return { id: def.id, name: def.name, position: new Vector3( p.x, p.y, p.z ), yaw: v.yaw + def.joey.turn, far: 350 };

	}

	addCollider( site ) {

		const col = this.app.colliders;
		if ( ! col ) return;
		const c = Math.cos( site.yaw ), s = Math.sin( site.yaw ), dz = 0.04; // the cabinet and keypad ledge span z -0.30..0.38
		col.addBox( new Vector3( site.position.x + dz * s, site.position.y + 0.9, site.position.z + dz * c ), new Vector3( 0.33, 0.9, 0.35 ), site.yaw, { solid: true, tag: 'atm' } );

	}

	async loadSite( site ) {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		try {

			const model = await loadModel( `${ base }models/atm.glb`, {
				customize: ( source, options ) => /^W/.test( source.name || '' ) ? { ...options, surface: wear( site, source.name ) + ( options.surface || '' ) } : options,
			} );
			model.root.position.copy( site.position );
			model.root.rotation.y = site.yaw;
			this.app.scene.add( model.root );
			model.root.updateMatrixWorld( true );
			site.model = model;
			site.card = model.pivots.get( 'Card' );
			site.notes = model.pivots.get( 'Notes' );
			site.shutter = model.pivots.get( 'Shutter' );
			site.rest = {};
			for ( const k of [ 'card', 'notes', 'shutter' ] ) if ( site[ k ] ) site.rest[ k ] = site[ k ].position.clone();
			if ( site.card ) site.card.visible = false;
			if ( site.notes ) site.notes.visible = false;

		} catch ( e ) {

			console.warn( 'atm: model missing', e );

		}

	}

	// the spot in front of the keypad
	front( site, out = this._v ) {

		return out.set( site.position.x + Math.sin( site.yaw ) * FRONT, site.position.y, site.position.z + Math.cos( site.yaw ) * FRONT );

	}

	near( p ) {

		for ( const s of this.sites ) {

			const f = this.front( s );
			if ( Math.hypot( p.position.x - f.x, p.position.z - f.z ) < USE_RANGE && Math.abs( p.position.y - f.y ) < 1.5 ) return s;

		}

		return null;

	}

	// ---- per frame, after the traders (their prompts come first)
	update( dt, inp, p ) {

		const app = this.app;
		this.markers();
		const h = app.settings?.timeOfDay;
		if ( Number.isFinite( h ) && Number.isFinite( this._hour ) && this._hour > 18 && h < 6 ) this.day ++;
		this._hour = h;
		if ( this.retainT > 0 ) {

			this.retainT = Math.max( 0, this.retainT - dt );
			if ( this.retainT === 0 ) {

				this.tries = 0;
				this.game.toast( 'The bank has returned your card' );

			}

		}

		for ( const s of this.sites ) if ( s.model && s.far ) s.model.root.visible = app.camera.position.distanceToSquared( s.position ) < s.far * s.far;
		this.animate( dt );
		if ( this.open ) {

			if ( p.mode !== 'walk' ) this.close();
			return;

		}

		if ( p.mode !== 'walk' || p.prompt || app.freeCam || this.game.fight ) return;
		const site = this.near( p );
		if ( ! site ) return;
		p.prompt = { key: 'E', text: this.retainT > 0 ? `ATM · card retained, back in ${ Math.ceil( this.retainT ) } s` : 'Use ATM' };
		if ( inp.hit( 'KeyE' ) ) this.use( site );

	}

	use( site ) {

		if ( this.retainT > 0 ) {

			this.game.toast( `Card retained. Please contact your branch (${ Math.ceil( this.retainT ) } s)` );
			return;

		}

		if ( ! this.game.hud || typeof document === 'undefined' ) {

			this.game.toast( 'ATM: this machine needs the screen (no HUD)' );
			return;

		}

		this.site = site;
		this.open = true;
		this.pin = '';
		this.entry = '';
		this.msg = null;
		this.screen = 'welcome';
		const hud = this.game.hud;
		hud.toggleInventory( false );
		hud.closeStand();
		this.build();
		this.shut( false );
		this.el.classList.add( 'is-open' );
		// held keys stop, and from here on every key press is the ATM's
		const inp = this.app.input;
		inp.keys.clear();
		inp.pressed.clear();
		window.addEventListener( 'keydown', this._onKey, true );
		if ( document.pointerLockElement ) document.exitPointerLock?.();
		this.render();

	}

	close() {

		if ( ! this.open ) return;
		if ( this.screen === 'cash' ) this.takeCash( true ); // walking off with the notes still out: they're his
		this.open = false;
		window.removeEventListener( 'keydown', this._onKey, true );
		this.el?.classList.remove( 'is-open' );
		this.shut( true );
		const s = this.site;
		if ( s?.card ) s.card.visible = false;
		if ( s?.notes ) s.notes.visible = false;
		if ( s?.shutter && s.rest.shutter ) s.shutter.position.copy( s.rest.shutter );
		this._anim.length = 0;
		this.site = null;

	}

	// ---- the panel
	// Takes the closed panel out of the accessibility tree and Tab order, or puts it back.
	shut( closed ) {

		if ( ! this.el ) return;
		this.el.inert = closed;
		if ( closed ) this.el.setAttribute( 'aria-hidden', 'true' );
		else this.el.removeAttribute( 'aria-hidden' );

	}

	build() {

		if ( this.el ) return;
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = document.createElement( 'div' );
		this.el.className = 'atm-panel tw-glass tw-interactive';
		this.el.setAttribute( 'role', 'dialog' );
		this.el.setAttribute( 'aria-label', 'ATM' );
		// Closed, the panel only fades to opacity 0, so it stays in the page: inert and
		// aria-hidden keep the invisible ATM out of the accessibility tree and out of Tab
		// focus (it was the second "dialog" every strict dialog lookup tripped over).
		this.shut( true );
		this.el.innerHTML = `<div class="atm-screen" aria-live="polite"></div><div class="atm-pad" aria-label="PIN pad"></div><p class="atm-hint">Keys 0 to 9 · Enter confirms · Backspace clears · Esc cancels</p>`;
		this.scr = this.el.firstChild;
		const pad = this.el.querySelector( '.atm-pad' );
		const keys = [ '1', '2', '3', 'Cancel', '4', '5', '6', 'Clear', '7', '8', '9', 'Enter', '', '0', '', '' ];
		for ( const k of keys ) {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.textContent = k;
			if ( ! k ) b.className = 'is-blank';
			else if ( k === '5' ) b.className = 'is-dot';
			else if ( k.length > 1 ) b.className = 'is-' + k.toLowerCase();
			if ( k ) b.onclick = () => b.blur() || this.key( k === 'Cancel' ? 'Escape' : k === 'Clear' ? 'Backspace' : k );
			if ( ! k ) b.tabIndex = - 1;
			pad.append( b );

		}

		this.el.addEventListener( 'click', ( e ) => {

			const b = e.target.closest( '[data-act]' );
			if ( b ) this.act( b.dataset.act );

		} );
		( this.app.ui.ui.root ).append( this.el );

	}

	onKey( e ) {

		if ( ! this.open ) return;
		e.preventDefault();
		e.stopPropagation();
		if ( e.repeat ) return;
		const k = /^(Digit|Numpad)[0-9]$/.test( e.code ) ? e.code.slice( - 1 ) : e.code === 'NumpadEnter' ? 'Enter' : e.code === 'Delete' ? 'Backspace' : e.code === 'KeyE' ? 'E' : e.key;
		this.key( k );

	}

	// one key from the keyboard or the on-screen pad
	key( k ) {

		const scr = this.screen;
		if ( k === 'Escape' ) return this.act( scr === 'other' ? 'amount' : 'cancel' );
		if ( k === 'E' ) k = 'Enter';
		if ( scr === 'pin' ) {

			if ( /^[0-9]$/.test( k ) && this.pin.length < 4 ) this.pin += k;
			else if ( k === 'Backspace' ) this.pin = '';
			else if ( k === 'Enter' ) return this.checkPin();
			this.msg = null;
			return this.render();

		}

		if ( scr === 'other' ) {

			if ( /^[0-9]$/.test( k ) && this.entry.length < 4 && ! ( this.entry === '' && k === '0' ) ) this.entry += k;
			else if ( k === 'Backspace' ) this.entry = '';
			else if ( k === 'Enter' ) return this.request( Number( this.entry || 0 ) );
			this.msg = null;
			return this.render();

		}

		// the menus: a number picks the option with that number, Enter the first
		const opts = this.options();
		const pick = k === 'Enter' ? opts.find( ( o ) => o.enter ) || opts[ 0 ] : opts.find( ( o ) => o.key === k );
		if ( pick ) this.act( pick.act );

	}

	options() {

		switch ( this.screen ) {

			case 'welcome': return [ { key: '1', act: 'insert', label: 'Insert card', go: true, enter: true }, { key: '2', act: 'cancel', label: 'Cancel', stop: true } ];
			case 'menu': return [ { key: '1', act: 'withdraw', label: 'Withdrawal', enter: true }, { key: '2', act: 'balance', label: 'Balance' }, { key: '3', act: 'cancel', label: 'Cancel', stop: true } ];
			case 'amount': return [
				...QUICK_AMOUNTS.map( ( a, i ) => ( { key: String( i + 1 ), act: 'take:' + a, label: '$' + a } ) ),
				{ key: '5', act: 'other', label: 'Other amount' }, { key: '6', act: 'cancel', label: 'Cancel', stop: true } ];
			case 'balance': return [ { key: '1', act: 'withdraw', label: 'Withdrawal', enter: true }, { key: '2', act: 'cancel', label: 'Finish', stop: true } ];
			case 'card': return [ { key: '1', act: 'takecard', label: 'Take card', go: true, enter: true } ];
			case 'cash': return [ { key: '1', act: 'takecash', label: 'Take cash', go: true, enter: true } ];
			case 'receipt': return [ { key: '1', act: 'slip', label: 'Print receipt', go: true }, { key: '2', act: 'noslip', label: 'No receipt', enter: true } ];
			case 'slip': case 'retained': case 'bye': return [ { key: '1', act: 'done', label: 'Done', enter: true } ];
			default: return [];

		}

	}

	act( a ) {

		const s = this.site;
		if ( a === 'done' ) return this.close();
		if ( a === 'cancel' ) {

			if ( [ 'welcome', 'retained', 'bye', 'slip' ].includes( this.screen ) ) return this.close();
			this.amount = 0;
			this.after = 'bye';
			return this.go( 'card' );

		}

		switch ( a ) {

			case 'insert':
				this.go( 'reading' );
				this.sfx( 'click' );
				this.slide( s.card, s.rest.card, 0.07, - 0.08, 0.7, () => {

					if ( s.card ) s.card.visible = false;
					if ( this.screen === 'reading' ) this.go( 'pin' );

				} );
				return;
			case 'withdraw': return this.go( 'amount' );
			case 'balance': return this.go( 'balance' );
			case 'other': this.entry = ''; return this.go( 'other' );
			case 'amount': return this.go( 'amount' );
			case 'takecard':
				if ( s.card ) s.card.visible = false;
				if ( this.amount > 0 ) {

					this.go( 'counting' );
					this.later( 1.1, () => this.dispense() );
					return;

				}

				return this.go( this.after || 'bye' );
			case 'takecash': return this.takeCash();
			case 'slip': this.sfx( 'click' ); return this.go( 'slip' );
			case 'noslip': return this.go( 'bye' );

		}

		if ( a.startsWith( 'take:' ) ) this.request( Number( a.slice( 5 ) ) );

	}

	checkPin() {

		if ( this.pin.length < 4 ) {

			this.msg = { text: 'Please enter your 4 digit PIN', bad: true };
			return this.render();

		}

		if ( this.pin === this.game.state.pin ) {

			this.tries = 0;
			this.pin = '';
			return this.go( 'menu' );

		}

		this.tries ++;
		this.pin = '';
		const left = PIN_TRIES - this.tries;
		if ( left > 0 ) {

			this.msg = { text: `Incorrect PIN, ${ left } ${ left === 1 ? 'try' : 'tries' } left`, bad: true };
			return this.render();

		}

		this.retainT = RETAIN_S;
		this.go( 'retained' );

	}

	// check an amount against the notes, the balance and today's limit; on to the card and cash if it's good
	request( amount ) {

		const st = this.game.state;
		const reason = checkNotes( amount ) || ( amount > st.bank ? 'funds' : amount > st.leftToday( this.day ) ? 'limit' : null );
		if ( reason ) {

			this.msg = { text: withdrawMessage( reason, amount, { bank: st.bank, left: st.leftToday( this.day ) } ), bad: true };
			return this.render();

		}

		this.amount = amount;
		this.after = 'receipt';
		this.go( 'card' );

	}

	dispense() {

		const s = this.site;
		if ( ! this.open || this.screen !== 'counting' ) return;
		this.go( 'cash' );
		this.sfx( 'dispense' );
		if ( s.shutter ) this.slide( s.shutter, s.rest.shutter, 0, - 0.004, 0.25, null, - 0.03 );
		if ( s.notes ) {

			s.notes.position.copy( s.rest.notes );
			s.notes.visible = true;
			this.slide( s.notes, s.rest.notes, 0, 0.075, 0.8 );

		}

	}

	takeCash( quiet = false ) {

		const s = this.site, st = this.game.state;
		const r = st.withdraw( this.amount, this.day );
		if ( s?.notes ) s.notes.visible = false;
		if ( s?.shutter && s.rest.shutter ) s.shutter.position.copy( s.rest.shutter );
		this.took = r.ok ? this.amount : 0;
		if ( r.ok ) {

			if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
			this.game.toast( `Cash out · $${ this.amount } (bank $${ st.bank.toLocaleString( 'en-AU' ) })` );

		}

		this.amount = 0;
		if ( ! quiet ) this.go( 'receipt' );

	}

	go( screen ) {

		this.screen = screen;
		this.msg = null;
		const s = this.site;
		if ( screen === 'card' && s?.card ) {

			// the card comes back out of the reader
			s.card.visible = true;
			this.sfx( 'click' );
			this.slide( s.card, s.rest.card, - 0.08, 0, 0.6 );

		}

		this.render();

	}

	// ---- the moving bits on the model: slide `obj` along its local z (and y) from rest + z0 to rest + z1
	slide( obj, rest, z0, z1, secs, done = null, dy = 0 ) {

		if ( ! obj || ! rest ) {

			if ( done ) this.later( secs, done );
			return;

		}

		if ( obj === this.site?.card ) obj.visible = true;
		this._anim = this._anim.filter( ( a ) => a.obj !== obj );
		this._anim.push( { obj, rest, z0, z1, dy, t: 0, secs, done } );

	}

	later( secs, done ) {

		this._anim.push( { obj: null, t: 0, secs, done } );

	}

	animate( dt ) {

		if ( ! this._anim.length ) return;
		const fin = [];
		for ( const a of this._anim ) {

			a.t = Math.min( a.secs, a.t + dt );
			const k = a.secs > 0 ? a.t / a.secs : 1, e = k * k * ( 3 - 2 * k );
			if ( a.obj ) a.obj.position.set( a.rest.x, a.rest.y + a.dy * e, a.rest.z + a.z0 + ( a.z1 - a.z0 ) * e );
			if ( a.t >= a.secs ) fin.push( a );

		}

		this._anim = this._anim.filter( ( a ) => ! fin.includes( a ) );
		for ( const a of fin ) if ( a.done ) a.done();

	}

	sfx( kind ) {

		const au = this.app.audio;
		if ( ! au ) return;
		if ( kind === 'dispense' && au.coin ) au.coin();
		else if ( au[ kind ] ) au[ kind ]();

	}

	// ---- the screen
	render() {

		if ( ! this.scr ) return;
		const st = this.game.state, money = ( n ) => '$' + Number( n ).toLocaleString( 'en-AU' );
		const where = this.site ? this.site.name : '';
		let body = '';
		switch ( this.screen ) {

			case 'welcome': body = `<h2 class="atm-title">Welcome</h2><p class="atm-sub">Please insert your card</p>`; break;
			case 'reading': body = `<h2 class="atm-title">Reading your card</h2><div class="atm-busy">One moment please</div>`; break;
			case 'pin': body = `<h2 class="atm-title">Enter your PIN</h2><p class="atm-sub">Cover the keypad, then press Enter</p>
				<div class="atm-dots">${ [ 0, 1, 2, 3 ].map( ( i ) => `<span>${ i < this.pin.length ? '•' : '' }</span>` ).join( '' ) }</div>`; break;
			case 'menu': body = `<h2 class="atm-title">Select a transaction</h2><p class="atm-sub">Savings account</p>`; break;
			case 'amount': body = `<h2 class="atm-title">Withdrawal from savings</h2><p class="atm-sub">Select an amount · notes available: $20 and $50</p>`; break;
			case 'other': body = `<h2 class="atm-title">Enter amount</h2><p class="atm-sub">Multiples of $10 · minimum $20 · then Enter</p>
				<div class="atm-field">$${ this.entry || '<span>0</span>' }</div>`; break;
			case 'balance': body = `<h2 class="atm-title">Account balance</h2><p class="atm-sub">Savings account</p>
				<div class="atm-field">${ money( st.bank ) }</div><p class="atm-sub">Available to withdraw today: ${ money( Math.min( st.bank, st.leftToday( this.day ) ) ) }</p>`; break;
			case 'card': body = `<h2 class="atm-title">Please take your card</h2><p class="atm-sub">${ this.amount > 0 ? `Your cash (${ money( this.amount ) }) will follow` : 'Thank you' }</p>`; break;
			case 'counting': body = `<h2 class="atm-title">Counting your cash</h2><div class="atm-busy">Please wait</div>`; break;
			case 'cash': body = `<h2 class="atm-title">Please take your cash</h2><div class="atm-cash">${ this.notes( this.amount ) }</div>`; break;
			case 'receipt': body = `<h2 class="atm-title">Would you like a receipt?</h2><p class="atm-sub">${ this.took ? `${ money( this.took ) } withdrawn` : '' }</p>`; break;
			case 'slip': body = `<div class="atm-slip"><div class="is-c">TIDEWATER COMMUNITY BANK</div><div><span>${ where }</span></div><hr>
				<div><span>${ new Date().toLocaleDateString( 'en-AU' ) }</span><span>${ this.clock() }</span></div><div><span>Card</span><span>**** 4471</span></div>
				<div><span>Withdrawal</span><span>${ money( this.took || 0 ) }</span></div><div><span>Fee</span><span>$0.00</span></div><hr>
				<div><span>Available balance</span><span>${ money( st.bank ) }</span></div></div>`; break;
			case 'retained': body = `<h2 class="atm-title">Too many incorrect PINs</h2><p class="atm-sub">Card retained. Please contact your branch.</p>`; break;
			case 'bye': body = `<h2 class="atm-title">Thank you</h2><p class="atm-sub">Thank you for banking with Tidewater Community Bank</p>`; break;

		}

		const opts = this.options().map( ( o, i ) => `<button type="button" class="atm-opt${ i % 2 ? ' is-right' : '' }${ o.go ? ' is-go' : '' }${ o.stop ? ' is-stop' : '' }" data-act="${ o.act }"><kbd>${ o.key }</kbd><span>${ o.label }</span></button>` ).join( '' );
		const msg = this.msg ? `<p class="atm-msg${ this.msg.bad ? ' is-bad' : '' }" role="alert">${ this.msg.text }</p>` : '<p class="atm-msg"></p>';
		this.scr.innerHTML = `<div class="atm-bank"><i>T</i><span>Tidewater Community Bank</span><span>ATM</span></div>${ body }${ msg }<div class="atm-opts">${ opts }</div>`;

	}

	// the notes an ATM would pay: as many fifties as leave a multiple of twenty
	notes( amount ) {

		let f = Math.floor( amount / 50 );
		while ( f > 0 && ( amount - f * 50 ) % 20 ) f --;
		const t = ( amount - f * 50 ) / 20, out = [];
		for ( let i = 0; i < Math.min( f, 6 ); i ++ ) out.push( `<b style="--c:#d8b24a;animation-delay:${ out.length * 90 }ms">50</b>` );
		for ( let i = 0; i < Math.min( t, 6 ); i ++ ) out.push( `<b style="--c:#d0674c;animation-delay:${ out.length * 90 }ms">20</b>` );
		return out.join( '' );

	}

	clock() {

		const h = this.app.settings?.timeOfDay ?? 12, hh = Math.floor( h ), mm = Math.floor( ( h - hh ) * 60 );
		return `${ String( hh ).padStart( 2, '0' ) }:${ String( mm ).padStart( 2, '0' ) }`;

	}

	// $ markers on the minimap while an ATM is on the map (none on the rim: they'd crowd it)
	markers() {

		const mm = this.game.minimap;
		if ( ! mm || this._marked || ! mm.marks || ! Array.isArray( mm.markers ) || typeof document === 'undefined' ) return;
		this._marked = true;
		if ( ! this.el ) this.build();
		for ( const s of this.sites ) {

			const el = document.createElement( 'div' );
			el.className = 'gm-mk is-atm';
			el.innerHTML = '<b></b><i>$</i>';
			el.title = `ATM · ${ s.name }`;
			mm.marks.append( el );
			const app = this.app;
			mm.markers.push( { id: 'atm:' + s.id, el, arrow: el.firstChild, pos: () => ( { x: s.position.x, z: s.position.z } ),
				hideWhen: () => Math.hypot( app.player.position.x - s.position.x, app.player.position.z - s.position.z ) > ( mm.radiusM || 60 ) * 0.92 } );

		}

	}

}
