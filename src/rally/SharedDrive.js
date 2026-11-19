import { Quaternion } from '../engine/index.js';
import { cloneVehicle } from './VehicleModel.js';
import { CarLights } from './CarLights.js';
import { RoomClient } from './RoomClient.js';
import { bindWheels, poseWheel } from './WheelRig.js';
import { VEHICLES } from './Vehicles.js';
import { SocialPanel } from './SocialPanel.js';

// Remote cars are drawn this far in the past (behind the fastest arrival seen from that
// driver), between two real poses stamped with the sender's own clock, so network jitter
// never shows as stutter. A late packet is bridged along the car's own reported velocity.
const DELAY = 110, EXTRAPOLATE = 150, BUFFER = 10;
// Snapshot fields that are states, not quantities: stepped, never blended (93 is the sea
// height, -1000 on land).
const DISCRETE = new Set( [ 8, 10, 16, 20, 24, 28, 74, 75, 80, 89, 90, 91, 92, 93 ] );
const quantise = ( v, i ) => ( i >= 3 && i <= 6 ? Math.round( v * 1e5 ) / 1e5 : Math.round( v * 1e3 ) / 1e3 );

const COLORS = [ '#70e0d1', '#ffb875', '#bda8ff', '#fd91b9', '#91d878', '#8bbfff', '#edcf71', '#e3f0f1' ];
export class SharedDrive {
	constructor( rally ) {
		this.rally = rally;
		this.app = rally.app;
		this.client = new RoomClient( message => this.receive( message ) );
		this.peers = new Map();
		this.room = null;
		this.sendTime = 0;
		this.uiTime = 0;
		this.q = new Quaternion(); this.targetQ = new Quaternion();
		window.addEventListener( 'pagehide', () => this.client.close() );
	}
	async show() {
		if ( ! this.panel ) this.buildUI();
		this.panel.hidden = false;
		this.error.textContent = '';
		try { await this.client.connect(); this.client.send( { type: 'browse' } ); }
		catch ( error ) { this.error.textContent = error.message; }
	}
	async request( type, code ) {
		this.error.textContent = '';
		try { await this.client.connect(); this.client.send( { type, code, name: this.name.value } ); }
		catch ( error ) { this.error.textContent = error.message; }
	}
	receive( message ) {
		if ( message.type === 'error' ) { if ( this.error ) this.error.textContent = message.message; return; }
		if ( message.type === 'lobbies' ) { this.lobbies = message.lobbies; this.renderLobbies(); return; }
		if ( message.type === 'room' || message.type === 'disconnected' ) {
			const old = this.room?.code;
			this.room = message.type === 'room' ? message.room : null;
			const members = new Set( this.room?.players.map( player => player.id ) || [] );
			for ( const id of this.peers.keys() ) if ( ! members.has( id ) ) this.remove( id );
			if ( this.room && this.room.code !== old ) {
				const own = this.room.players.find( p => p.id === this.client.id );
				this.rally.spawnOffset = ( own?.slot || 0 ) * - 8;
				this.rally.reset();
				this.rally.enter();
			}
			if ( ! this.room ) this.rally.spawnOffset = 0;
			this.renderRoom();
			if ( message.type === 'disconnected' && this.error ) this.error.textContent = 'Disconnected. You can keep driving solo or host again.';
			return;
		}
		if ( message.type !== 'state' || ! this.room ) return;
		const allowed = new Set( this.room.players.map( p => p.id ) );
		for ( const player of message.players ) {
			if ( player.id === this.client.id || ! allowed.has( player.id ) || ! VEHICLES[ player.vehicle ] ) continue;
			let peer = this.peers.get( player.id );
			if ( peer && peer.vehicle !== player.vehicle ) { this.remove( player.id ); peer = null; }
			if ( ! peer ) {
				const model = cloneVehicle( this.rally.models[ player.vehicle ] );
				model.root.visible = true;
				this.app.scene.add( model.root );
				peer = { ...player, model, color: COLORS[ player.slot ], wheels: bindWheels( model, VEHICLES[ player.vehicle ] ),
					spin: [ 0, 0, 0, 0 ], visual: Float32Array.from( player.state ), buffer: [] };
				this.peers.set( player.id, peer );
				this.addRow( peer );
			}
			// The server re-sends the latest pose every tick; only a new send time is news.
			const at = Number.isFinite( player.at ) ? player.at : message.at;
			const last = peer.buffer.at( - 1 );
			if ( last && at <= last.at ) continue;
			// Local time minus sender time: the smallest seen is the fastest delivery; let it
			// creep up slowly so a lasting rise in latency is followed.
			const offset = Date.now() - at;
			peer.offset = peer.offset === undefined ? offset : Math.min( offset, peer.offset + 1 );
			peer.buffer.push( { at, state: Float32Array.from( player.state ) } );
			if ( peer.buffer.length > BUFFER ) peer.buffer.shift();
			if ( ! last ) this.app.game.minimap?.setDrivers( [ ...this.peers.values() ] );
		}
	}
	// Blend the two buffered poses around `renderAt` into peer.visual (rotation in this.q).
	// Past the newest pose, only the position moves on, along that pose's own heading and
	// speed, for at most EXTRAPOLATE ms: a timestamp glitch can never fling a car away.
	sample( peer, renderAt ) {
		const buffer = peer.buffer;
		if ( ! buffer.length ) return false;
		let a = buffer[ 0 ], b = buffer[ 0 ];
		for ( let i = 1; i < buffer.length; i ++ ) { a = buffer[ i - 1 ]; b = buffer[ i ]; if ( b.at >= renderAt ) break; }
		const t = b.at > a.at ? Math.max( 0, Math.min( 1, ( renderAt - a.at ) / ( b.at - a.at ) ) ) : 1;
		const s = peer.visual, n = Math.min( s.length, a.state.length, b.state.length );
		for ( let i = 0; i < n; i ++ ) s[ i ] = DISCRETE.has( i ) ? ( t < 0.5 ? a.state[ i ] : b.state[ i ] ) : a.state[ i ] + ( b.state[ i ] - a.state[ i ] ) * t;
		this.q.fromArray( a.state, 3 ); this.targetQ.fromArray( b.state, 3 );
		this.q.slerp( this.targetQ, t ).normalize();
		this.q.toArray( s, 3 );
		const late = Math.min( EXTRAPOLATE, renderAt - b.at ) / 1000;
		if ( late > 0 ) {
			const speed = b.state[ 7 ] / 3.6, climb = b.state.length > 94 ? b.state[ 94 ] : 0;
			const x = 2 * ( b.state[ 3 ] * b.state[ 5 ] + b.state[ 6 ] * b.state[ 4 ] ), z = 1 - 2 * ( b.state[ 3 ] * b.state[ 3 ] + b.state[ 4 ] * b.state[ 4 ] );
			s[ 0 ] = b.state[ 0 ] + x * speed * late; s[ 1 ] = b.state[ 1 ] + climb * late; s[ 2 ] = b.state[ 2 ] + z * speed * late;
		}
		return true;
	}

	remove( id ) {
		const peer = this.peers.get( id ); if ( ! peer ) return;
		peer.lights?.dispose();
		this.app.scene.remove( peer.model.root );
		this.rally.tracks.reset( id ); this.rally.physics.remove_remote( peer.slot + 1 );
		peer.row?.remove(); this.peers.delete( id );
		this.app.game.minimap?.setDrivers( [ ...this.peers.values() ] );
	}
	update( dt ) {
		this.sendTime += dt; this.uiTime += dt;
		if ( this.room && this.sendTime >= 0.05 ) {
			this.sendTime %= 0.05;
			// A monotonic send time: a system clock stepping back never freezes this car for others.
			this.client.send( { type: 'pose', vehicle: this.rally.vehicleKey, sent: performance.timeOrigin + performance.now(), state: Array.from( this.rally.state, quantise ) } );
		}
		const now = Date.now();
		for ( const peer of this.peers.values() ) {
			if ( ! this.sample( peer, now - ( peer.offset ?? 0 ) - DELAY ) ) continue;
			const s = peer.visual;
			peer.model.root.position.fromArray( s ); peer.model.root.quaternion.copy( this.q );
			// lamps on while driven; brake lights from the car slowing (the pedals are not sent)
			peer.lights ??= new CarLights( this.app.localLights, peer.model.root );
			const speed = Math.abs( s[ 7 ] ), slowing = dt > 0 && peer.speed !== undefined ? ( peer.speed - speed ) / dt : 0;
			peer.speed = speed;
			peer.lights.update( dt, true, slowing > 3 && speed > 0.5 ? 1 : 0 );
			const profile = VEHICLES[ peer.vehicle ];
			for ( let wheel = 0; wheel < 4; wheel ++ ) {
				const index = 13 + wheel * 4;
				peer.spin[ wheel ] = ( peer.spin[ wheel ] + s[ index + 2 ] / peer.wheels[ wheel ].radius * dt ) % ( Math.PI * 2 );
				poseWheel( peer.wheels[ wheel ], profile.mount - s[ index ], s[ index + 1 ], peer.spin[ wheel ] );
			}
			this.rally.physics.update_remote( peer.slot + 1, profile.id, s );
			this.rally.tracks.emit( peer.id, s, profile );
		}
		if ( this.uiTime > 0.1 ) { this.updateRows(); this.uiTime = 0; }
	}
	// Presentation lives in SocialPanel; these stay as the hooks the networking code calls.
	buildUI() {
		this.ui = new SocialPanel( this );
		this.ui.build();
	}
	renderRoom() { this.ui?.renderRoom(); }
	renderLobbies() { this.ui?.renderLobbies(); }
	addRow( peer ) { this.ui?.addRow( peer ); }
	updateRows() { this.ui?.updateRows(); }
}
