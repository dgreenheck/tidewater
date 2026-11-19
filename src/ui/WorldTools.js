
const GROUPS = {
	aviation: 'ride', glider: 'ride', chairlift: 'ride',
	windfarm: 'island', livestock: 'island', sharks: 'island',
	evacuation: 'emergency', disasters: 'emergency',
	'shark-bite': 'demo',
};
const GROUP_ORDER = [ 'ride', 'island', 'emergency', 'demo' ];
const GROUP_NAMES = { ride: 'Ride', island: 'Island', emergency: 'Emergency', demo: 'Demo' };
// edge fade inside the pill, px: wide enough to read as "more", narrower than any tool
const FADE = 28;

const STYLE = `
.tw-world-tools{position:fixed;z-index:110;left:var(--tw-edge);top:var(--tw-world-tools-y,100px);display:flex;box-sizing:border-box;max-width:calc(100vw - 2 * var(--tw-edge));padding:calc(3 * var(--tw-u)) calc(4 * var(--tw-u));border-radius:999px;overflow:hidden;font:500 var(--tw-fs-sm) var(--tw-font);color:var(--tw-ink-2);
 background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,0) 40%),var(--tw-glass);border:1px solid var(--tw-line);-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 2px rgba(0,0,0,.25),0 12px 32px -12px rgba(0,0,0,.55)}
.tw-world-scroll{display:flex;align-items:center;gap:calc(2 * var(--tw-u));min-width:0;padding:1px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding:0 ${ FADE }px}
.tw-world-scroll::-webkit-scrollbar{display:none}
.tw-world-scroll.is-more-right{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - ${ FADE }px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - ${ FADE }px),transparent)}
.tw-world-scroll.is-more-left{-webkit-mask-image:linear-gradient(90deg,transparent,#000 ${ FADE }px);mask-image:linear-gradient(90deg,transparent,#000 ${ FADE }px)}
.tw-world-scroll.is-more-left.is-more-right{-webkit-mask-image:linear-gradient(90deg,transparent,#000 ${ FADE }px,#000 calc(100% - ${ FADE }px),transparent);mask-image:linear-gradient(90deg,transparent,#000 ${ FADE }px,#000 calc(100% - ${ FADE }px),transparent)}
.tw-world-group{display:flex;flex:none;align-items:center;gap:calc(2 * var(--tw-u))}
.tw-world-group + .tw-world-group{margin-left:calc(2 * var(--tw-u));padding-left:calc(6 * var(--tw-u));border-left:1px solid var(--tw-line-2)}
.tw-world-eyebrow{flex:none;padding:0 calc(4 * var(--tw-u)) 0 calc(6 * var(--tw-u));font:600 var(--tw-fs-xs) var(--tw-font);letter-spacing:.12em;text-transform:uppercase;color:var(--tw-ink-3);user-select:none}
.tw-world-tools button{flex:none;min-height:calc(26 * var(--tw-u));padding:0 calc(10 * var(--tw-u));border:1px solid transparent;border-radius:999px;background:transparent;color:inherit;font:inherit;line-height:1;white-space:nowrap;cursor:pointer;scroll-snap-align:start;transition:background var(--tw-fast) var(--tw-ease),color var(--tw-fast) var(--tw-ease)}
.tw-world-tools button:hover{background:var(--tw-fill-2);color:var(--tw-ink)}
.tw-world-tools button[aria-expanded=true]{background:rgba(var(--tw-aqua-rgb),.16);border-color:rgba(var(--tw-aqua-rgb),.4);color:var(--tw-ink)}
.tw-world-tools button:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--tw-sun)}
.tw-world-group[data-group=demo] button{color:var(--tw-ink-3);font-size:var(--tw-fs-xs)}
/* A panel is as tall as its content, capped 22 px short of the bottom edge and scrolling inside
   (a fixed bottom stretched the chairlift glass 40 % past its last line). */
.tw-world-panel{position:fixed!important;z-index:111!important;left:var(--tw-edge)!important;right:auto!important;top:var(--tw-world-panel-y,150px)!important;width:calc(360 * var(--tw-u))!important;max-width:calc(100vw - 2 * var(--tw-edge))!important;max-height:calc(100dvh - var(--tw-world-panel-y,150px) - 22px);overflow:auto!important;box-sizing:border-box;padding:var(--tw-5);border-radius:var(--tw-r-lg);scrollbar-width:thin}
.tw-world-panel.tw-glass{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,0) 40%),var(--tw-glass-dense)}
.tw-world-panel :focus-visible{outline:2px solid var(--tw-sun);outline-offset:3px}
.tw-world-panel[hidden]{display:none!important}
body:has(.tw-root.is-starting) .tw-world-tools,body:has(.tw-root.is-starting) .tw-world-panel,body:has(.tw-root.is-photo) .tw-world-tools,body:has(.tw-root.is-photo) .tw-world-panel{display:none!important}
/* The "Take a car" card (.rh, src/rally/DriveHUD.js) shares the bottom-left corner with an open
   panel and showed through under it (the dark strip under the tsunami panel). The
   panel owns the left column while it is open; the card returns when it closes. */
body:has(.tw-world-panel:not([hidden])) .rh{visibility:hidden;pointer-events:none}
/* The evacuation hint describes the walking player ("Shift + W to run"): it leaves with the
   other on-foot chips when AppUI stamps a context without "guidance" (the free camera). */
body:has(.tw-root:not([data-hud-chips~=guidance])) .evac-guidance{visibility:hidden;pointer-events:none}
/* Ferry status and an evacuation warning share the top centre. Reserve separate
   rows while both are present, and keep the controls below the full warning. */
body:has(.disaster-warning:not([hidden])):has(.fy-board:not([hidden])){--tw-world-tools-y:160px;--tw-world-panel-y:210px}
body:has(.fy-board:not([hidden])) .disaster-warning{top:64px;width:max-content;max-width:min(900px,calc(100vw - 40px));box-sizing:border-box}
@media(max-width:700px){
 .tw-root .tw-brand{max-width:calc(100vw - 24px);gap:6px}.tw-root .tw-brand-name{font-size:10px;letter-spacing:.24em}.tw-root .tw-mode{font-size:11px}
 .tw-root .gm-purse{top:54px!important;left:12px!important;right:auto!important;max-width:calc(100vw - 24px);box-sizing:border-box;padding:6px 12px}
 .tw-world-tools{left:12px;top:var(--tw-world-tools-y,106px);max-width:calc(100vw - 24px)}
 .tw-world-panel{left:12px!important;top:var(--tw-world-panel-y,155px)!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - var(--tw-world-panel-y,155px) - 12px);padding:var(--tw-4)}
 body:has(.disaster-warning:not([hidden])){--tw-world-tools-y:202px;--tw-world-panel-y:251px}
 body .disaster-warning{top:98px;left:12px;transform:none;width:calc(100vw - 24px);max-width:calc(100vw - 24px);max-height:96px;overflow:auto;box-sizing:border-box;padding:8px 10px;font-size:11px}
 body:has(.disaster-warning:not([hidden])):has(.fy-board:not([hidden])){--tw-world-tools-y:246px;--tw-world-panel-y:295px}
 body:has(.fy-board:not([hidden])) .disaster-warning{top:140px;width:calc(100vw - 24px);max-width:calc(100vw - 24px)}
 body:has(.disaster-warning:not([hidden])) .fy-board{top:98px;width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;white-space:normal;font-size:11px}
 .tw-root .tw-prompt,.tw-root .tw-prompt.is-third{left:12px;bottom:160px;max-width:calc(100vw - 24px);box-sizing:border-box;white-space:normal;transform:none!important}
 /* Narrow screens: the character fills the lower half, so the hint moves under the tools strip
; it hides while a panel is open, so it never meets the panel. */
 body .evac-guidance,body:has(.tw-root.is-third) .evac-guidance{top:calc(var(--tw-world-tools-y,106px) + 46px);bottom:auto;left:12px;transform:none;max-width:calc(100vw - 24px);text-align:center}
 body:has(.tw-world-panel:not([hidden])) :is(.av-hud,.av-reticle,.gl-hud,.gl-reticle,.evac-guidance,.tw-prompt,.gm-map,.gm-pin,.tw-rail){visibility:hidden;pointer-events:none}
 body:has(.av-hud:not([hidden]),.gl-hud:not([hidden])) :is(.gm-map,.gm-pin,.tw-prompt,.evac-guidance){visibility:hidden;pointer-events:none}
}
`;

function releaseInput( app ) {

	document.exitPointerLock?.();
	const input = app.input;
	input?.keys?.clear();
	input?.pressed?.clear();
	if ( input ) {

		input.mouseDown = false;
		input.rightDown = false;
		input.consumeLook?.();

	}

}

// Arrow keys walk the strip; the focused tool is kept inside the visible part of the pill.
function stripKeys( state, e ) {

	const buttons = [ ...state.scroll.querySelectorAll( 'button' ) ];
	const i = buttons.indexOf( document.activeElement );
	if ( i < 0 ) return;
	let to = - 1;
	if ( e.key === 'ArrowRight' ) to = Math.min( buttons.length - 1, i + 1 );
	else if ( e.key === 'ArrowLeft' ) to = Math.max( 0, i - 1 );
	else if ( e.key === 'Home' ) to = 0;
	else if ( e.key === 'End' ) to = buttons.length - 1;
	else if ( e.key === 'Escape' ) {

		e.preventDefault();
		state.closeAll();
		return;

	}

	if ( to < 0 ) return;
	e.preventDefault();
	buttons[ to ].focus( { preventScroll: true } );
	buttons[ to ].scrollIntoView( { inline: 'nearest', block: 'nearest' } );

}

function registry( app ) {

	if ( app.worldTools ) return app.worldTools;
	const style = document.createElement( 'style' );
	style.textContent = STYLE;
	document.head.append( style );
	const rail = document.createElement( 'nav' );
	rail.className = 'tw-world-tools';
	rail.setAttribute( 'aria-label', 'World controls' );
	const scroll = document.createElement( 'div' );
	scroll.className = 'tw-world-scroll';
	rail.append( scroll );
	document.body.append( rail );
	const state = {
		rail, scroll, groups: new Map(), tools: new Map(),
		closeAll() {

			for ( const tool of this.tools.values() ) tool.close( false );

		},
		// the edge fade shows on whichever side still has tools out of view
		fades() {

			const more = scroll.scrollWidth - scroll.clientWidth;
			scroll.classList.toggle( 'is-more-left', scroll.scrollLeft > 1 );
			scroll.classList.toggle( 'is-more-right', more - scroll.scrollLeft > 1 );

		},
	};
	app.worldTools = state;
	rail.addEventListener( 'pointerdown', e => e.stopPropagation() );
	rail.addEventListener( 'keydown', e => {

		e.stopPropagation();
		stripKeys( state, e );

	} );
	scroll.addEventListener( 'scroll', () => state.fades(), { passive: true } );
	if ( typeof ResizeObserver !== 'undefined' ) new ResizeObserver( () => state.fades() ).observe( scroll );
	return state;

}

// Groups sit in a fixed order whatever order the systems register in.
function groupFor( state, id ) {

	const key = GROUPS[ id ] || 'island';
	let group = state.groups.get( key );
	if ( group ) return group;
	group = document.createElement( 'div' );
	group.className = 'tw-world-group';
	group.dataset.group = key;
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-label', GROUP_NAMES[ key ] );
	const eyebrow = document.createElement( 'span' );
	eyebrow.className = 'tw-world-eyebrow';
	eyebrow.setAttribute( 'aria-hidden', 'true' );
	eyebrow.textContent = GROUP_NAMES[ key ];
	group.append( eyebrow );
	state.groups.set( key, group );
	const order = GROUP_ORDER.indexOf( key );
	const next = [ ...state.scroll.children ].find( g => GROUP_ORDER.indexOf( g.dataset.group ) > order );
	state.scroll.insertBefore( group, next || null );
	return group;

}

/** Register a panel or immediate action; repeated registration by id is safe. */
export function addWorldTool( app, { id, label, panel = null, onOpen = null, onClose = null, onActivate = null } ) {

	if ( ! /^[a-z][a-z0-9-]*$/.test( id ) ) throw new Error( 'World tool id must be a stable lowercase identifier' );
	const state = registry( app );
	if ( state.tools.has( id ) ) return state.tools.get( id );
	const button = document.createElement( 'button' );
	button.type = 'button';
	button.textContent = label;
	button.dataset.worldTool = id;
	let open = false;
	const tool = {
		button, panel,
		get isOpen() {

			return open;

		},
		open() {

			state.closeAll();
			releaseInput( app );
			button.scrollIntoView( { inline: 'nearest', block: 'nearest' } );
			if ( ! panel ) {

				onActivate?.();
				return;

			}

			open = true;
			panel.hidden = false;
			button.setAttribute( 'aria-expanded', 'true' );
			panel.focus( { preventScroll: true } );
			onOpen?.();

		},
		close( focus = false ) {

			if ( ! panel || ! open ) return;
			open = false;
			panel.hidden = true;
			button.setAttribute( 'aria-expanded', 'false' );
			if ( panel.contains( document.activeElement ) ) document.activeElement.blur();
			onClose?.();
			if ( focus ) button.focus();

		},
		toggle() {

			if ( open ) this.close();
			else this.open();

		},
	};
	if ( panel ) {

		panel.hidden = true;
		panel.tabIndex = - 1;
		panel.classList.add( 'tw-world-panel', 'tw-glass', 'tw-shell' );
		panel.id ||= `tw-world-panel-${ id }`;
		button.setAttribute( 'aria-controls', panel.id );
		button.setAttribute( 'aria-expanded', 'false' );
		panel.addEventListener( 'pointerdown', e => e.stopPropagation() );
		panel.addEventListener( 'keydown', e => {

			e.stopPropagation();
			if ( e.key === 'Escape' ) {

				e.preventDefault();
				tool.close( true );

			}

		} );
		if ( ! panel.isConnected ) document.body.append( panel );

	}

	button.addEventListener( 'click', () => tool.toggle() );
	groupFor( state, id ).append( button );
	state.tools.set( id, tool );
	state.fades();
	return tool;

}
