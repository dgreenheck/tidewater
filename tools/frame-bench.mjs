// Frame-time harness around ?bench (src/core/Bench.js): boots the real game in Chromium at the README
// target size, runs __bench.run per view with a CDP CPU profile around each, and can render the
// __bench.shots reference images and diff two tags pixel by pixel (perf changes must keep the frame).
//
// Needs a running dev server: npx vite --host 127.0.0.1 --port 5206 --strictPort
//   node tools/frame-bench.mjs time  --port 5206 --out DIR --tag before [--views beach,pier] [--scale 1] [--runs 3]
//   node tools/frame-bench.mjs shots --port 5206 --out DIR --tag before [--views ...]
//   node tools/frame-bench.mjs diff  --out DIR --a before --b after [--views ...]
// Add --vehicle gt3rs --views rallyFront,rallyRear to review a car at the coastal road start.
// Output: DIR/bench-TAG.json (per view: best-of-runs wall / gpu / cpu ms, passes, top CPU self time),
// DIR/TAG-VIEW.png and .bgra (shots), one summary line per view on stdout.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';

const DEFAULT_VIEWS = [ 'beach', 'pier', 'sunGlitter', 'village', 'underwater', 'aerial', 'palms', 'boatFish' ];
// README Requirements: the M5 Pro target window
const WIDTH = 2560;
const HEIGHT = 1267;

const args = process.argv.slice( 2 );
const mode = args[ 0 ];
const opt = ( name, fallback ) => {

	const i = args.indexOf( '--' + name );
	return i > 0 ? args[ i + 1 ] : fallback;

};
const out = opt( 'out', '.' );
const views = opt( 'views', DEFAULT_VIEWS.join( ',' ) ).split( ',' );
fs.mkdirSync( out, { recursive: true } );

function png( width, height, bgra ) {

	const raw = Buffer.alloc( ( width * 4 + 1 ) * height );
	for ( let y = 0; y < height; y ++ ) {

		const row = y * ( width * 4 + 1 );
		for ( let x = 0; x < width; x ++ ) {

			const s = ( y * width + x ) * 4;
			const d = row + 1 + x * 4;
			raw[ d ] = bgra[ s + 2 ];
			raw[ d + 1 ] = bgra[ s + 1 ];
			raw[ d + 2 ] = bgra[ s ];
			raw[ d + 3 ] = 255;

		}

	}

	const chunk = ( type, data ) => {

		const head = Buffer.alloc( 8 );
		head.writeUInt32BE( data.length, 0 );
		head.write( type, 4 );
		const crc = Buffer.alloc( 4 );
		crc.writeUInt32BE( zlib.crc32( Buffer.concat( [ head.subarray( 4 ), data ] ) ) >>> 0, 0 );
		return Buffer.concat( [ head, data, crc ] );

	};

	const ihdr = Buffer.alloc( 13 );
	ihdr.writeUInt32BE( width, 0 );
	ihdr.writeUInt32BE( height, 4 );
	ihdr[ 8 ] = 8;
	ihdr[ 9 ] = 6;
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', ihdr ), chunk( 'IDAT', zlib.deflateSync( raw ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );

}

function readBgra( file ) {

	const b = fs.readFileSync( file );
	return { width: b.readUInt32LE( 0 ), height: b.readUInt32LE( 4 ), data: b.subarray( 8 ) };

}

if ( mode === 'diff' ) {

	for ( const v of views ) {

		const a = readBgra( path.join( out, opt( 'a' ) + '-' + v + '.bgra' ) );
		const b = readBgra( path.join( out, opt( 'b' ) + '-' + v + '.bgra' ) );
		if ( a.width !== b.width || a.height !== b.height ) {

			console.log( v, 'size differs' );
			continue;

		}

		let changed = 0;
		let max = 0;
		let sum = 0;
		for ( let i = 0; i < a.data.length; i += 4 ) {

			let m = 0;
			for ( let c = 0; c < 3; c ++ ) m = Math.max( m, Math.abs( a.data[ i + c ] - b.data[ i + c ] ) );
			if ( m > 2 ) changed ++;
			max = Math.max( max, m );
			sum += m;

		}

		const n = a.data.length / 4;
		console.log( `${ v }: ${ changed } px of ${ n } differ by > 2 (${ ( 100 * changed / n ).toFixed( 4 ) }%), max ${ max }, mean ${ ( sum / n ).toFixed( 4 ) }` );

	}

	process.exit( 0 );

}

const port = opt( 'port', '5206' );
const query = '?bench' + ( opt( 'scale' ) ? '&scale=' + opt( 'scale' ) : '' ) + ( opt( 'q' ) ? '&' + opt( 'q' ) : '' );
const browser = await chromium.launch( { args: [ '--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling' ] } );
const page = await browser.newPage( { viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 } );
const shots = new Map();
await page.route( 'http://127.0.0.1:5190/**', async ( route ) => {

	shots.set( new URL( route.request().url() ).pathname.slice( 1 ), route.request().postDataBuffer() );
	await route.fulfill( { status: 200, body: 'ok' } );

} );
page.on( 'pageerror', ( e ) => console.log( 'pageerror', String( e ).slice( 0, 200 ) ) );
await page.goto( `http://127.0.0.1:${ port }/${ query }` );
await page.waitForFunction( () => window.__bench, null, { timeout: 240_000 } );

const vehicle = opt( 'vehicle' );
if ( vehicle ) {
	await page.evaluate( key => {
		const rally = window.__app.rally;
		if ( ! Object.hasOwn( rally.models, key ) ) throw new Error( 'Unknown review vehicle: ' + key );
		rally.destination = 'coast';
		if ( rally.vehicleKey === key ) rally.reset();
		else rally.selectVehicle( key );
		// Both cars start the same comparison at their static ride height.
		for ( let i = 0; i < 120; i ++ ) rally.physics.advance( 0.025, 0, 0, 0, 1 );
		rally.syncModel( 0 );
	}, vehicle );
}

if ( mode === 'shots' ) {

	const tag = opt( 'tag', 'shot' );
	await page.evaluate( ( [ v, t ] ) => window.__bench.shots( v, { tag: t } ), [ views, tag ] );
	for ( const [ name, body ] of shots ) {

		fs.writeFileSync( path.join( out, name ), body );
		const w = body.readUInt32LE( 0 );
		const h = body.readUInt32LE( 4 );
		fs.writeFileSync( path.join( out, name.replace( /\.bgra$/, '.png' ) ), png( w, h, body.subarray( 8 ) ) );
		console.log( 'shot', name, w + 'x' + h );

	}

} else {

	const cdp = await page.context().newCDPSession( page );
	await cdp.send( 'Profiler.enable' );
	await cdp.send( 'Profiler.setSamplingInterval', { interval: 250 } );
	const runs = Number( opt( 'runs', '1' ) );
	const result = {};
	for ( const v of views ) {

		let best = null;
		const self = new Map();
		for ( let r = 0; r < runs; r ++ ) {

			await cdp.send( 'Profiler.start' );
			const res = ( await page.evaluate( ( name ) => window.__bench.run( { views: [ name ], warm: 60, frames: 120 } ), v ) )[ v ];
			const { profile } = await cdp.send( 'Profiler.stop' );
			const byId = new Map( profile.nodes.map( ( n ) => [ n.id, n ] ) );
			for ( let i = 0; i < profile.samples.length; i ++ ) {

				const f = byId.get( profile.samples[ i ] ).callFrame;
				const key = `${ f.functionName || '(anon)' } ${ f.url.replace( /^.*\/src\//, 'src/' ).replace( /\?.*$/, '' ) }:${ f.lineNumber + 1 }`;
				self.set( key, ( self.get( key ) || 0 ) + profile.timeDeltas[ i ] / 1000 / runs );

			}

			if ( ! best || res.gpu < best.gpu ) best = { ...res, wallRuns: [], gpuRuns: [] };
			( result[ v ] ??= { wallRuns: [], gpuRuns: [], cpuRuns: [] } );
			result[ v ].wallRuns.push( res.wall );
			result[ v ].gpuRuns.push( res.gpu );
			result[ v ].cpuRuns.push( res.cpu );

		}

		// CPU self time per measured frame (warm + measured frames were profiled: 180 frames)
		const top = [ ...self ].filter( ( [ k ] ) => ! k.startsWith( '(idle)' ) && ! k.startsWith( '(program)' ) ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 25 ).map( ( [ k, ms ] ) => [ k, + ( ms / 180 ).toFixed( 3 ) ] );
		Object.assign( result[ v ], { gpu: best.gpu, gpuMedian: best.gpuMedian, wall: Math.min( ...result[ v ].wallRuns ), cpu: Math.min( ...result[ v ].cpuRuns ), passes: best.passes, cpuTop: top } );
		console.log( `${ v }: wall ${ result[ v ].wall } gpu ${ best.gpu } cpu ${ result[ v ].cpu } | runs wall ${ result[ v ].wallRuns.join( '/' ) } gpu ${ result[ v ].gpuRuns.join( '/' ) }` );

	}

	fs.writeFileSync( path.join( out, 'bench-' + opt( 'tag', 'run' ) + '.json' ), JSON.stringify( result, null, 1 ) );

}

await browser.close();
