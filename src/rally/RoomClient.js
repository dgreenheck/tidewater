// Same-origin room transport ported from Swift Parking's RoomClient.
export class RoomClient {
	constructor( onMessage ) { this.onMessage = onMessage; this.socket = null; this.id = null; }
	connect() {
		if ( this.socket?.readyState === WebSocket.OPEN ) return Promise.resolve();
		if ( this.connecting ) return this.connecting;
		this.connecting = new Promise( ( resolve, reject ) => {
			const ws = this.socket = new WebSocket( `${ location.protocol === 'https:' ? 'wss:' : 'ws:' }//${ location.host }/rally-ws` );
			let settled = false;
			const timeout = setTimeout( () => { ws.close(); reject( new Error( 'The drive server did not respond. Try again.' ) ); }, 7000 );
			ws.onmessage = event => {
				let message; try { message = JSON.parse( event.data ); } catch { return; }
				if ( message.type === 'hello' ) { this.id = message.id; settled = true; clearTimeout( timeout ); resolve(); }
				this.onMessage( message );
			};
			ws.onerror = () => { clearTimeout( timeout ); reject( new Error( 'Could not connect to the drive server.' ) ); };
			ws.onclose = () => {
				clearTimeout( timeout );
				if ( ! settled ) reject( new Error( 'Connection closed. Try again.' ) );
				if ( this.socket === ws ) { this.connecting = null; this.socket = null; this.onMessage( { type: 'disconnected' } ); }
			};
		} );
		return this.connecting;
	}
	send( message ) { if ( this.socket?.readyState === WebSocket.OPEN ) this.socket.send( JSON.stringify( message ) ); }
	close() { const socket = this.socket; this.socket = null; this.connecting = null; socket?.close(); }
}
