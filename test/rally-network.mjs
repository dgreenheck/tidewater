import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachMultiplayer, validPose } from '../server/multiplayer.mjs';

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) );
async function until( client, predicate ) {
	for ( let i = 0; i < 250; i ++ ) { const message = client.messages.find( predicate ); if ( message ) return message; await sleep( 10 ); }
	throw new Error( 'Timed out waiting for the real room server' );
}
async function connect( url ) {
	const ws = new WebSocket( url ), messages = [];
	ws.on( 'message', raw => messages.push( JSON.parse( raw ) ) );
	const client = { ws, messages, send: message => ws.send( JSON.stringify( message ) ) };
	client.id = ( await until( client, m => m.type === 'hello' ) ).id;
	return client;
}
const pose = ( length = 96 ) => { const s = Array( length ).fill( 0 ); s[ 0 ] = - 55; s[ 1 ] = 2; s[ 2 ] = - 64; s[ 6 ] = 1; return { type: 'pose', vehicle: 'aster', state: s }; };

test( 'Room server relays only validated owner snapshots inside a room and migrates the host', async () => {
	const server = createServer(), close = attachMultiplayer( server ), clients = [];
	await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	try {
		const url = `ws://127.0.0.1:${ server.address().port }/rally-ws`;
		const [ host, guest, other ] = await Promise.all( [ 0, 1, 2 ].map( () => connect( url ) ) );
		clients.push( host, guest, other );
		host.send( { type: 'create', name: 'Alex' } );
		const room = ( await until( host, m => m.type === 'room' && m.room ) ).room;
		guest.send( { type: 'join', name: 'Sam', code: room.code } );
		await until( host, m => m.room?.players.length === 2 );
		other.send( { type: 'create', name: 'Other room' } );
		await until( other, m => m.type === 'room' && m.room );
		const bad = pose(); bad.state[ 0 ] = 999999; host.send( bad );
		await sleep( 100 );
		assert.ok( ! guest.messages.some( m => m.type === 'state' && m.players.some( p => p.state[ 0 ] === 999999 ) ) );
		const message = pose(); message.id = guest.id; message.vehicle = 'gt3rs'; message.state[ 8 ] = 7; host.send( message );
		const received = await until( guest, m => m.type === 'state' && m.players.some( p => p.id === host.id ) );
		assert.equal( received.players[ 0 ].name, 'Alex' );
		assert.equal( received.players[ 0 ].vehicle, 'gt3rs' );
		assert.equal( received.players[ 0 ].state[ 8 ], 7 );
		assert.equal( received.players[ 0 ].state[ 0 ], - 55 );
		assert.ok( ! other.messages.some( m => m.type === 'state' && m.players.some( p => p.id === host.id ) ) );
		host.ws.close();
		const migrated = await until( guest, m => m.type === 'room' && m.room?.host === guest.id );
		assert.equal( migrated.room.players.length, 1 );
		guest.send( { type: 'leave' } );
		await until( guest, m => m.type === 'room' && m.room === null );
	} finally { clients.forEach( client => client.ws.close() ); close(); await new Promise( resolve => server.close( resolve ) ); }
} );

test( 'Invalid vehicles, rotations, huge positions and non-finite values cannot enter a shared snapshot', () => {
	assert.equal( validPose( pose() ), true );
	assert.equal( validPose( pose( 69 ) ), true, 'a tab still running the previous physics module' );
	for ( const mutate of [ m => m.vehicle = 'unknown', m => m.state[ 0 ] = NaN, m => m.state[ 1 ] = 900, m => m.state[ 6 ] = 0, m => m.state[ 7 ] = 900, m => m.state = [], m => m.state.push( 0 ), m => m.state[ 95 ] = Infinity ] ) {
		const m = pose(); mutate( m ); assert.equal( validPose( m ), false );
	}
} );

test( 'Remote cars are drawn between buffered poses, step discrete fields and bridge late packets along their own velocity', async () => {
	const { Quaternion } = await import( '../src/engine/index.js' );
	const { SharedDrive } = await import( '../src/rally/SharedDrive.js' );
	// Heading +x (yaw 90 degrees) at 36 km/h.
	const pose = ( x, gear ) => { const s = new Float32Array( 96 ); s[ 0 ] = x; s[ 4 ] = Math.SQRT1_2; s[ 6 ] = Math.SQRT1_2; s[ 7 ] = 36; s[ 8 ] = gear; return s; };
	const self = { q: new Quaternion(), targetQ: new Quaternion() };
	const at = ( peer, time ) => { SharedDrive.prototype.sample.call( self, peer, time ); return [ peer.visual[ 0 ], peer.visual[ 8 ] ]; };
	const near = ( [ x, gear ], [ ex, egear ], note ) => { assert.ok( Math.abs( x - ex ) < 1e-4, `${ note }: x ${ x }` ); assert.equal( gear, egear, note ); };
	const peer = { visual: new Float32Array( 96 ), buffer: [ { at: 1000, state: pose( 0, 1 ) }, { at: 1050, state: pose( 1, 2 ) } ] };
	near( at( peer, 1025 ), [ 0.5, 2 ], 'halfway between arrivals; gear steps, never blends' );
	near( at( peer, 1010 ), [ 0.2, 1 ], 'early in the interval' );
	near( at( peer, 1100 ), [ 1.5, 2 ], 'a late packet is bridged at the car\'s own 10 m/s' );
	near( at( peer, 5000 ), [ 2.5, 2 ], 'the bridge stops after 150 ms' );
	near( at( peer, 900 ), [ 0, 1 ], 'before the first pose it holds the first pose' );
	// Two poses that reached the server 2 ms apart must not fling the car (review 1, finding 1).
	const glitch = { visual: new Float32Array( 96 ), buffer: [ { at: 1000, state: pose( 0, 2 ) }, { at: 1002, state: pose( 1, 2 ) } ] };
	near( at( glitch, 1100 ), [ 1.98, 2 ], 'bounded by the reported speed, not the 2 ms spacing' );
} );
