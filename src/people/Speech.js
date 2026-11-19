// Speech bubbles: a DOM overlay, one small glass bubble (the HUD's .tw-glass look and ui.css tokens)
// anchored above a person's head, fading in and out. Rare by design: at most two on screen, a
// global gap between any two, and only for people near the camera; each brain has its own
// cool-down on top (Brain.speak). A bubble keeps clear of the HUD's glass panels (the minimap, the icon
// rail, the purse, the prompts and keys: every .tw-glass box, read from the DOM): nudged beside or above a
// panel it would sit under, its tail still pointing at the head, and hidden while the head is under one.
//   speech.say( person, text, key, t ) -> bool, speech.update( t, camera ), speech.state()
import { Vector3 } from '../engine/index.js';

const TOP = 110;   // px: a bubble's foot never higher than this (the HUD pills sit above)
const CSS = `
.pp-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 4; }
.pp-bubble { position: absolute; left: 0; top: 0; padding: calc(6 * var(--tw-u, 1px)) calc(11 * var(--tw-u, 1px)); border-radius: var(--tw-r-lg, 16px);
	font: 500 var(--tw-fs-md, 12.5px)/1.3 var(--tw-font, system-ui, sans-serif); color: var(--tw-ink, #eef6f8); white-space: nowrap; letter-spacing: 0.01em; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
	opacity: 0; transition: opacity 220ms ease; will-change: transform, opacity; }
.pp-bubble.pp-on { opacity: 1; transition-duration: 90ms; }   /* in fast (readable at once), out at the base 220 ms */
.pp-bubble::after { content: ''; position: absolute; left: calc(50% + var(--pp-tail, 0px)); top: 100%; margin-left: calc(-6 * var(--tw-u, 1px));
	border: calc(6 * var(--tw-u, 1px)) solid transparent; border-top-color: var(--tw-glass, rgba(12, 18, 26, 0.62)); }
`;
const MAX = 2, GAP = 2.2, RANGE = 24, CLEAR = 8, NUDGE = 150;   // px: the gap kept from a panel, the farthest a bubble moves off its head
const _v = new Vector3(), _d = new Vector3();

export class Speech {

	constructor( app ) { this.app = app; this.live = []; this.log = []; this.nextAt = 0; this.el = null; }

	mount() {

		if ( this.el || typeof document === 'undefined' ) return;
		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = document.createElement( 'div' );
		this.el.className = 'pp-layer';
		document.body.append( this.el );

	}

	// `urgent` (a bump's line): past the gap and the cap, and it replaces the person's own bubble.
	// `range` (m): how far from the camera the line is still shown (a call across the beach carries further)
	say( person, text, key, t, urgent = false, range = RANGE ) {

		const own = this.live.find( b => b.who === person );
		if ( ! urgent && ( this.live.length >= MAX || t < this.nextAt || own ) ) return false;
		if ( own ) own.until = t;
		if ( ! person.world || person.world.distanceTo( this.app.camera.position ) > range ) return false;
		this.mount();
		if ( ! this.el ) return false;
		const el = document.createElement( 'div' );
		el.className = 'pp-bubble tw-glass';
		el.textContent = text;
		el.dataset.key = key;
		this.el.append( el );
		this.live.push( { who: person, text, key, el, until: t + 2.4 + 0.045 * text.length, w: el.offsetWidth, h: el.offsetHeight } );
		this.rectAt = 0;   // a fresh look at the panels (a prompt may have come up since)
		this.nextAt = t + GAP;
		this.log.push( { t: + t.toFixed( 2 ), id: person.id, key, text } );
		if ( this.log.length > 30 ) this.log.shift();
		return true;

	}

	drop( person ) { for ( const b of this.live ) if ( b.who === person ) b.until = - 1; }

	update( t, camera ) {

		if ( ! this.live.length ) return;
		// the canvas rect and the HUD panels, read twice a second and on each new bubble (reading them every
		// frame forces a layout); a panel covering much of the screen (a menu) is not a HUD panel
		if ( ! this.rect || t > this.rectAt ) {

			const canvas = this.app.renderer?.domElement || this.app.canvas || document.querySelector( 'canvas' );
			this.rect = canvas?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
			this.panels = [ ...document.querySelectorAll( '.tw-glass' ) ].filter( e => ! e.classList.contains( 'pp-bubble' ) && ( e.checkVisibility?.( { opacityProperty: true, visibilityProperty: true } ) ?? true ) )
				.map( e => e.getBoundingClientRect() ).filter( q => q.width > 0 && q.height > 0 && q.width * q.height < 0.3 * innerWidth * innerHeight );
			this.rectAt = t + 0.5;

		}
		const r = this.rect;
		const dir = camera.getWorldDirection( _d );
		for ( const b of [ ...this.live ] ) {

			if ( t > b.until + 0.3 || ! b.who.world ) { b.el.remove(); this.live.splice( this.live.indexOf( b ), 1 ); continue; }
			b.el.classList.toggle( 'pp-on', t < b.until );
			// just over the head (the owner's head point: lower when seated or sat on the ground after a fall)
			if ( b.who.head ) _v.copy( b.who.head ).y += 0.3;
			else { _v.copy( b.who.world ); _v.y += b.who.posture === 'sit' ? 1.4 : 1.9; }
			const ahead = ( _v.x - camera.position.x ) * dir.x + ( _v.y - camera.position.y ) * dir.y + ( _v.z - camera.position.z ) * dir.z;
			_v.project( camera );
			// someone right in front of you (a bump) has their head near the top edge: the bubble stays in
			// the frame, held under the HUD's top row, instead of going off the top
			const show = ahead > 0.3 && Math.abs( _v.x ) < 1.05 && _v.y > - 1.05;
			const x = r.left + ( _v.x + 1 ) / 2 * r.width, y = Math.max( r.top + TOP, r.top + ( 1 - _v.y ) / 2 * r.height );
			const at = show && this.place( b, x, y, r );
			b.el.style.visibility = at ? '' : 'hidden';
			if ( ! at ) continue;
			b.el.style.setProperty( '--pp-tail', `${ Math.max( 14 - b.w / 2, Math.min( b.w / 2 - 14, x - at[ 0 ] ) ).toFixed( 1 ) }px` );
			b.el.style.transform = `translate(${ at[ 0 ].toFixed( 1 ) }px, ${ at[ 1 ].toFixed( 1 ) }px) translate(-50%, calc(-100% - 8px))`;

		}

	}

	// Where a bubble whose tail tip is at ( x, y ) goes: [ x, y ] of its foot, moved clear of the HUD panels and
	// inside the canvas, or null to hide it (its head under a panel, or no clear spot within NUDGE px).
	place( b, x, y, r ) {

		const P = this.panels || [], w = b.w || 160, h = b.h || 30, C = CLEAR;
		if ( P.some( q => x > q.left && x < q.right && y > q.top && y < q.bottom ) ) return null;
		const hit = ( bx, by ) => P.find( q => bx - w / 2 < q.right + C && bx + w / 2 > q.left - C && by - 8 - h < q.bottom + C && by - 2 > q.top - C );
		let bx = Math.max( r.left + w / 2 + C, Math.min( r.left + r.width - w / 2 - C, x ) ), by = y;
		for ( let k = 0; k < 4; k ++ ) {

			const q = hit( bx, by );
			if ( ! q ) break;
			// the smallest move off it: left, right or up (down would cover the head)
			const l = q.left - C - ( bx + w / 2 ), rt = q.right + C - ( bx - w / 2 ), up = q.top - C - ( by - 2 );
			if ( - up <= Math.min( - l, rt ) ) by += up; else if ( - l <= rt ) bx += l; else bx += rt;

		}
		const inside = bx - w / 2 >= r.left && bx + w / 2 <= r.left + r.width && by - 8 - h >= r.top;
		return inside && ! hit( bx, by ) && Math.hypot( bx - x, by - y ) <= NUDGE ? [ bx, by ] : null;

	}

	state() { return { live: this.live.map( b => ( { id: b.who.id, key: b.key, text: b.text } ) ), log: this.log.slice( - 12 ) }; }

}
