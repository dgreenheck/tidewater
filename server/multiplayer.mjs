// Port of Swift Parking's same-origin WebSocket rooms: directory, room codes,
// host migration, bounded messages and heartbeat. Free driving retains each
// owner's real Avian simulation; the server owns identity and room membership.
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID, randomBytes } from 'node:crypto';

export const MAX_PLAYERS = 8;
// Car snapshot lengths: 96 from the current physics module, 69 from older open tabs.
export const SNAPSHOT_LENGTHS = [ 96, 69 ];
const cleanName = value => String( value ?? 'Driver' ).replace( /\p{C}/gu, '' ).trim().slice( 0, 20 ) || 'Driver';
export function validPose( message ) {
	const s = message.state;
	if ( ! [ 'aster', 'jeep', 'gt3rs' ].includes( message.vehicle ) || ! Array.isArray( s ) || ! SNAPSHOT_LENGTHS.includes( s.length ) ) return false;
	if ( ! s.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) < 1e6 ) ) return false;
	if ( Math.abs( s[ 0 ] ) > 1030 || Math.abs( s[ 2 ] ) > 1030 || s[ 1 ] < - 110 || s[ 1 ] > 700 || Math.abs( s[ 7 ] ) > 320 ) return false;
	const q = Math.hypot( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] );
	return q > 0.95 && q < 1.05 && Number.isInteger( s[ 8 ] ) && s[ 8 ] >= - 1 && s[ 8 ] <= ( message.vehicle === 'gt3rs' ? 7 : 6 ) && s[ 10 ] >= 0 && s[ 10 ] <= 4;
}

export function attachMultiplayer( server ) {
	const wss = new WebSocketServer( { noServer: true, maxPayload: 8192 } );
	const clients = new Map(), rooms = new Map();
	const send = ( player, message ) => {
		if ( player.ws.readyState === WebSocket.OPEN && player.ws.bufferedAmount < 262144 ) player.ws.send( JSON.stringify( message ) );
	};
	const summary = room => ( { code: room.code, host: room.host, players: [ ...room.players.values() ].map( p => ( { id: p.id, name: p.name, slot: p.slot } ) ) } );
	const directory = () => ( { type: 'lobbies', lobbies: [ ...rooms.values() ].map( summary ) } );
	const publish = () => { for ( const player of clients.values() ) send( player, directory() ); };
	const broadcast = ( room, message ) => { for ( const player of room.players.values() ) send( player, message ); };
	const roomUpdate = room => broadcast( room, { type: 'room', room: summary( room ) } );
	const leave = player => {
		const room = rooms.get( player.room );
		player.room = null; player.state = null;
		if ( ! room ) return;
		room.players.delete( player.id );
		if ( ! room.players.size ) rooms.delete( room.code );
		else { if ( room.host === player.id ) room.host = room.players.keys().next().value; roomUpdate( room ); }
		publish();
	};
	const upgrade = ( request, socket, head ) => {
		if ( request.url?.split( '?' )[ 0 ] !== '/rally-ws' ) return;
		if ( request.headers.origin ) {
			try { if ( new URL( request.headers.origin ).host !== request.headers.host ) { socket.destroy(); return; } }
			catch { socket.destroy(); return; }
		}
		if ( clients.size >= 256 ) { socket.destroy(); return; }
		wss.handleUpgrade( request, socket, head, ws => wss.emit( 'connection', ws ) );
	};
	server.on( 'upgrade', upgrade );
	wss.on( 'connection', ws => {
		const player = { id: randomUUID(), ws, name: 'Driver', room: null, state: null, vehicle: 'aster', slot: 0 };
		clients.set( player.id, player );
		ws.alive = true;
		ws.on( 'pong', () => { ws.alive = true; } );
		ws.on( 'error', () => {} );
		ws.on( 'close', () => { leave( player ); clients.delete( player.id ); } );
		send( player, { type: 'hello', id: player.id } ); send( player, directory() );
		let count = 0, windowAt = Date.now();
		ws.on( 'message', raw => {
			if ( Date.now() - windowAt > 1000 ) { windowAt = Date.now(); count = 0; }
			if ( ++ count > 60 ) return;
			let m; try { m = JSON.parse( raw ); } catch { return; }
			if ( ! m || typeof m !== 'object' || Array.isArray( m ) ) return;
			const error = message => send( player, { type: 'error', message } );
			if ( m.type === 'browse' ) { send( player, directory() ); return; }
			if ( m.type === 'leave' ) { leave( player ); send( player, { type: 'room', room: null } ); return; }
			if ( m.type === 'create' ) {
				if ( rooms.size >= 30 ) { error( 'All drives are busy. Try again shortly.' ); return; }
				leave( player ); player.name = cleanName( m.name ); player.slot = 0;
				let code; do { code = randomBytes( 3 ).toString( 'hex' ).toUpperCase(); } while ( rooms.has( code ) );
				const room = { code, host: player.id, players: new Map( [ [ player.id, player ] ] ) };
				player.room = code; rooms.set( code, room ); roomUpdate( room ); publish(); return;
			}
			if ( m.type === 'join' ) {
				const target = rooms.get( String( m.code ?? '' ).trim().toUpperCase() );
				if ( ! target ) { error( 'That drive has closed. Check the room code.' ); return; }
				if ( player.room === target.code ) { roomUpdate( target ); return; }
				if ( target.players.size >= MAX_PLAYERS ) { error( 'That drive is full (8 drivers).' ); return; }
				leave( player ); player.name = cleanName( m.name );
				const occupied = new Set( [ ...target.players.values() ].map( p => p.slot ) );
				player.slot = Array.from( { length: MAX_PLAYERS }, ( _, i ) => i ).find( slot => ! occupied.has( slot ) );
				player.room = target.code; target.players.set( player.id, player ); roomUpdate( target ); publish(); return;
			}
			if ( m.type === 'pose' && rooms.has( player.room ) && validPose( m ) ) {
				// IDs and names come from this connection, never a client payload.
				player.state = m.state; player.vehicle = m.vehicle; player.receivedAt = Date.now();
				// The sender's own clock orders and spaces its poses for interpolation.
				player.sent = Number.isFinite( m.sent ) && Math.abs( m.sent ) < 1e14 ? m.sent : null;
			}
		} );
	} );
	const timer = setInterval( () => {
		for ( const room of rooms.values() ) broadcast( room, { type: 'state', at: Date.now(), players: [ ...room.players.values() ]
			.filter( p => p.state ).map( p => ( { id: p.id, name: p.name, slot: p.slot, vehicle: p.vehicle, at: p.sent ?? p.receivedAt, state: p.state } ) ) } );
	}, 50 );
	timer.unref();
	const heartbeat = setInterval( () => {
		for ( const ws of wss.clients ) { if ( ! ws.alive ) ws.terminate(); else { ws.alive = false; ws.ping(); } }
	}, 10000 );
	heartbeat.unref();
	return () => {
		clearInterval( timer ); clearInterval( heartbeat ); server.off( 'upgrade', upgrade );
		for ( const ws of wss.clients ) ws.terminate();
		wss.close();
	};
}
