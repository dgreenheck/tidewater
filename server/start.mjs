import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachMultiplayer } from './multiplayer.mjs';

const root = fileURLToPath( new URL( '../dist/', import.meta.url ) );
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };
const handler = async ( request, response ) => {
	if ( request.method !== 'GET' && request.method !== 'HEAD' ) { response.writeHead( 405 ); response.end(); return; }
	try {
		const pathname = decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname );
		let path = resolve( root, `.${ pathname }` );
		if ( path !== resolve( root ) && ! path.startsWith( resolve( root ) + sep ) ) { response.writeHead( 403 ); response.end(); return; }
		if ( ( await stat( path ) ).isDirectory() ) path = resolve( path, 'index.html' );
		const data = await readFile( path );
		response.writeHead( 200, { 'Content-Type': types[ extname( path ) ] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length } );
		response.end( request.method === 'HEAD' ? undefined : data );
	} catch { response.writeHead( 404 ); response.end( 'Not found' ); }
};
const secure = process.env.HTTPS_CERT && process.env.HTTPS_KEY;
const server = secure ? httpsServer( { cert: await readFile( process.env.HTTPS_CERT ), key: await readFile( process.env.HTTPS_KEY ) }, handler ) : httpServer( handler );
const close = attachMultiplayer( server );
const host = process.env.HOST || '127.0.0.1', port = Number( process.env.PORT || 5189 );
server.listen( port, host, () => console.log( `Tidewater shared driving: ${ secure ? 'https' : 'http' }://${ host }:${ port }` ) );
for ( const signal of [ 'SIGINT', 'SIGTERM' ] ) process.on( signal, () => { close(); server.close( () => process.exit( 0 ) ); } );
