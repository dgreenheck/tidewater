// Multiplayer presentation: the Drive together panel (lobby, room code chip,
// driver list) and in-world nameplates projected over every remote car.
// Networking and interpolation stay in SharedDrive; this only reads its state.
import { Vector3 } from '../engine/index.js';
import { VEHICLES } from './Vehicles.js';
import { compassWord } from '../game/Guide.js';

const COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="8" height="8" rx="1.8"/><path d="M10.8 3.4A1.6 1.6 0 0 0 9.3 2.6H4.2a1.6 1.6 0 0 0-1.6 1.6v5.1a1.6 1.6 0 0 0 .8 1.5"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ARROW_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l4.6 10.6L8 10.4l-4.6 2.4z"/></svg>';
// Clamp box for off-screen nameplates: clear of the top-left pills and the
// bottom HUD (dock, speedo, minimap) so an edge label never sits on a gauge.
const INSET = { left: 64, right: 72, top: 104, bottom: 290 };
const formatDistance = d => d > 1000 ? `${ ( d / 1000 ).toFixed( 1 ) } km` : `${ Math.round( d ) } m`;

export class SocialPanel {
	constructor( shared ) {
		this.shared = shared;
		this.app = shared.app;
		this.plates = new Map();
		this.v = new Vector3();
	}

	build() {
		const shared = this.shared;
		const panel = this.panel = document.createElement( 'section' );
		panel.className = 'rs tw-glass tw-interactive'; panel.hidden = true;
		panel.setAttribute( 'aria-label', 'Drive together' );
		panel.innerHTML = `
			<header class="rs-head"><span class="rs-live" aria-hidden="true"></span><h2>Drive together</h2><button type="button" class="rs-x" aria-label="Close multiplayer panel">${ CLOSE_ICON }</button></header>
			<div class="rs-lobby">
				<label class="rs-field"><span>Your name</span><input aria-label="Your name" maxlength="20" value="" placeholder="Driver" autocomplete="off" spellcheck="false"></label>
				<button type="button" class="rs-host">Host drive</button>
				<div class="rs-join"><input aria-label="Join code" placeholder="Room code" maxlength="6" autocomplete="off" spellcheck="false"><button type="button">Join drive</button></div>
				<div class="rs-sub">Open drives</div>
				<div class="rs-lobbies"></div>
				<p class="rs-empty">No open drives yet. Host one and share the code.</p>
			</div>
			<div class="rs-room" hidden>
				<div class="rs-code-row"><button type="button" class="rs-code" aria-label="Copy room code"><span class="rs-code-label">Room</span><output aria-label="Room code"></output>${ COPY_ICON }</button><button type="button" class="rs-leave">Leave drive</button></div>
				<div role="region" aria-label="Nearby drivers" class="rs-drivers"></div>
				<p class="rs-waiting">Waiting for other drivers. Share the room code to invite them.</p>
			</div>
			<p class="rs-error" role="status"></p>`;
		const $ = selector => panel.querySelector( selector );
		// SharedDrive's networking lines read these three directly.
		shared.panel = panel; shared.name = $( '[aria-label="Your name"]' ); shared.error = $( '.rs-error' );
		this.rows = shared.rows = $( '.rs-drivers' );
		this.code = $( 'output' ); this.codeLabel = $( '.rs-code-label' );
		$( '.rs-x' ).onclick = () => { panel.hidden = true; };
		$( '.rs-host' ).onclick = () => shared.request( 'create' );
		const joinCode = $( '[aria-label="Join code"]' );
		$( '.rs-join button' ).onclick = () => shared.request( 'join', joinCode.value );
		joinCode.addEventListener( 'input', () => { joinCode.value = joinCode.value.toUpperCase(); } );
		$( '.rs-leave' ).onclick = () => shared.client.send( { type: 'leave' } );
		$( '.rs-code' ).onclick = () => this.copyCode();
		this.layer = document.createElement( 'div' );
		this.layer.className = 'rs-plates';
		const root = this.app.ui.ui.root;
		root.append( panel, this.layer );
		this.renderRoom(); this.renderLobbies();
		requestAnimationFrame( () => this.frame() );
	}

	async copyCode() {
		const code = this.code.textContent;
		if ( ! code ) return;
		try { await navigator.clipboard.writeText( code ); this.codeLabel.textContent = 'Copied'; }
		catch { getSelection().selectAllChildren( this.code ); this.codeLabel.textContent = 'Selected'; }
		clearTimeout( this.copyTimer );
		this.copyTimer = setTimeout( () => { this.codeLabel.textContent = 'Room'; }, 1600 );
	}

	renderRoom() {
		const panel = this.panel, room = this.shared.room;
		panel.querySelector( '.rs-lobby' ).hidden = !! room;
		panel.querySelector( '.rs-room' ).hidden = ! room;
		panel.classList.toggle( 'is-live', !! room );
		this.code.textContent = room?.code || '';
		if ( room ) panel.hidden = false;
		this.updateRows();
	}

	renderLobbies() {
		const list = this.panel.querySelector( '.rs-lobbies' ); list.replaceChildren();
		const rooms = ( this.shared.lobbies || [] ).filter( room => room.code !== this.shared.room?.code );
		for ( const room of rooms ) {
			const host = room.players.find( p => p.id === room.host ), name = host?.name || 'Driver';
			const full = room.players.length >= 8;
			const button = document.createElement( 'button' ); button.type = 'button'; button.className = 'rs-lobby-row';
			button.setAttribute( 'aria-label', `Join ${ name }'s drive` );
			button.innerHTML = '<span class="rs-host-name"></span><span class="rs-count"></span><span class="rs-cue"></span>';
			button.children[ 0 ].textContent = `${ name }'s drive`;
			button.children[ 1 ].textContent = `${ room.players.length }/8`;
			button.children[ 2 ].textContent = full ? 'Full' : 'Join';
			button.disabled = full;
			button.onclick = () => this.shared.request( 'join', room.code ); list.append( button );
		}
		this.panel.querySelector( '.rs-empty' ).hidden = rooms.length > 0;
		this.panel.querySelector( '.rs-sub' ).hidden = false;
	}

	addRow( peer ) {
		const row = peer.row = document.createElement( 'div' ); row.className = 'rs-driver';
		row.dataset.driverName = peer.name; row.style.setProperty( '--driver-color', peer.color );
		const arrow = peer.arrow = document.createElement( 'span' ); arrow.className = 'rs-bearing'; arrow.setAttribute( 'role', 'img' );
		arrow.innerHTML = ARROW_ICON;
		const who = document.createElement( 'span' ); who.className = 'rs-who';
		const name = document.createElement( 'strong' ); name.textContent = peer.name;
		const car = document.createElement( 'small' ); car.textContent = VEHICLES[ peer.vehicle ]?.name || '';
		who.append( name, car );
		const distance = peer.distance = document.createElement( 'span' ); distance.className = 'rs-distance';
		row.append( arrow, who, distance ); this.rows.append( row );
	}

	updateRows() {
		const rally = this.shared.rally, own = rally.model.root.position, forward = rally.forward;
		for ( const peer of this.shared.peers.values() ) {
			if ( ! peer.row ) this.addRow( peer );
			const p = peer.model.root.position, dx = p.x - own.x, dz = p.z - own.z;
			const distance = Math.hypot( dx, dz );
			const angle = Math.atan2( - forward.z * dx + forward.x * dz, forward.x * dx + forward.z * dz );
			peer.arrow.style.transform = `rotate(${ angle }rad)`;
			peer.arrow.setAttribute( 'aria-label', `Direction to ${ peer.name }: ${ compassWord( own.x, own.z, p.x, p.z ) }` );
			peer.distance.textContent = formatDistance( distance );
			peer.row.dataset.x = p.x.toFixed( 3 ); peer.row.dataset.z = p.z.toFixed( 3 ); peer.row.dataset.distance = distance.toFixed( 2 );
		}
		this.panel.querySelector( '.rs-waiting' ).hidden = this.shared.peers.size > 0;
	}

	addPlate( peer ) {
		const el = document.createElement( 'div' ); el.className = 'rs-plate';
		el.setAttribute( 'role', 'img' ); el.setAttribute( 'aria-label', `${ peer.name } nameplate` );
		el.style.setProperty( '--driver-color', peer.color );
		el.innerHTML = `<span class="rs-plate-tag"><i></i><b></b><span></span></span><span class="rs-plate-arrow">${ ARROW_ICON }</span>`;
		el.querySelector( 'b' ).textContent = peer.name;
		this.layer.append( el );
		const plate = { el, distance: el.querySelector( '.rs-plate-tag > span' ), arrow: el.querySelector( '.rs-plate-arrow' ), text: '' };
		this.plates.set( peer.id, plate );
		return plate;
	}

	// Per frame so labels stay glued to the cars; clamps to the screen edge with
	// an arrow when a driver is off screen or behind the camera.
	frame() {
		requestAnimationFrame( () => this.frame() );
		const peers = this.shared.peers;
		for ( const [ id, plate ] of this.plates ) if ( ! peers.has( id ) ) { plate.el.remove(); this.plates.delete( id ); }
		if ( ! peers.size ) return;
		const camera = this.app.camera, width = this.layer.clientWidth, height = this.layer.clientHeight;
		if ( ! width || ! height ) return;
		// The camera may have moved since the last render; refresh its view matrix first.
		camera.updateMatrixWorld();
		const own = this.shared.rally.model.root.position, v = this.v;
		const left = INSET.left, right = width - INSET.right, top = INSET.top, bottom = height - INSET.bottom;
		const cx = ( left + right ) / 2, cy = ( top + bottom ) / 2;
		for ( const peer of peers.values() ) {
			const plate = this.plates.get( peer.id ) || this.addPlate( peer );
			const p = peer.model.root.position;
			v.set( p.x, p.y + ( VEHICLES[ peer.vehicle ]?.plate ?? 1.7 ), p.z ).applyMatrix4( camera.matrixWorldInverse );
			// Clip-space w decides in front or behind, whatever the engine's view-axis convention.
			const e = camera.projectionMatrix.elements;
			const clipX = e[ 0 ] * v.x + e[ 4 ] * v.y + e[ 8 ] * v.z + e[ 12 ], clipY = e[ 1 ] * v.x + e[ 5 ] * v.y + e[ 9 ] * v.z + e[ 13 ];
			const clipW = e[ 3 ] * v.x + e[ 7 ] * v.y + e[ 11 ] * v.z + e[ 15 ], ahead = clipW > 0.05;
			let x, y, dx, dy;
			if ( ahead ) {
				x = ( clipX / clipW * 0.5 + 0.5 ) * width; y = ( 0.5 - clipY / clipW * 0.5 ) * height;
			} else {
				// Behind the camera: point the way the driver would have to turn.
				dx = clipX; dy = - clipY;
				if ( Math.hypot( dx, dy ) < 1e-3 ) dy = 1;
				x = cx + dx * 1e5; y = cy + dy * 1e5;
			}
			const inside = ahead && x > left && x < right && y > top && y < bottom;
			if ( ! inside ) {
				dx = x - cx; dy = y - cy;
				const scale = Math.min( ( right - left ) / 2 / Math.max( Math.abs( dx ), 1e-6 ), ( bottom - top ) / 2 / Math.max( Math.abs( dy ), 1e-6 ) );
				x = cx + dx * scale; y = cy + dy * scale;
				plate.arrow.style.transform = `rotate(${ Math.atan2( dy, dx ) + Math.PI / 2 }rad)`;
			}
			plate.el.classList.toggle( 'is-edge', ! inside );
			plate.el.dataset.onscreen = inside ? '1' : '0';
			const distance = Math.hypot( p.x - own.x, p.z - own.z );
			plate.el.style.transform = `translate3d(${ x.toFixed( 1 ) }px, ${ y.toFixed( 1 ) }px, 0)`;
			plate.el.style.setProperty( '--near', Math.max( 0.78, Math.min( 1, 1.08 - distance / 400 ) ).toFixed( 3 ) );
			const text = formatDistance( distance );
			if ( text !== plate.text ) { plate.distance.textContent = text; plate.text = text; }
		}
	}
}
