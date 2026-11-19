import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';

// Exercise the shipped WASM, not a JS replacement or native-only code path.
await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const advance = ( sim, seconds, input = [ 0, 0, 0, 0 ] ) => {
	for ( let i = 0; i < Math.round( seconds * 120 ); i ++ ) sim.advance( 1 / 120, ...input );
};
const world = () => {
	const sim = new RallyPhysics();
	assert.equal( sim.set_terrain( new Float32Array( 25 ), 5, 200, - 100 ), true );
	sim.reset( 0, 0.45, 0, 0 );
	advance( sim, 3 );
	return sim;
};

test( 'Rally-supplied input module and car meshes match the recorded snapshot', async () => {
	const manifest = JSON.parse( await readFile( new URL( '../rally-physics/source-manifest.json', import.meta.url ), 'utf8' ) );
	assert.ok( Object.keys( manifest.sha256 ).length >= 4 );
	for ( const [ source, expected ] of Object.entries( manifest.sha256 ) ) {
		const destination = source.endsWith( '.glb' ) ? `public/rally/${ basename( source ) }` : `rally-physics/src/driving/${ basename( source ) }`;
		const data = await readFile( new URL( `../${ destination }`, import.meta.url ) );
		assert.equal( createHash( 'sha256' ).update( data ).digest( 'hex' ), expected, destination );
	}
} );

test( 'The WASM bridge settles on a real imported terrain and reset clears motion', () => {
	const sim = world();
	try {
		assert.equal( sim.snapshot()[ 10 ], 4 );
		assert.ok( Math.abs( sim.snapshot()[ 1 ] ) < 0.07 );
		advance( sim, 3, [ 1, 0, 0, 0 ] );
		assert.ok( sim.snapshot()[ 7 ] > 20 );
		assert.ok( sim.snapshot()[ 2 ] > 10 );
		sim.reset( 12, 0.45, - 7, 0 );
		advance( sim, 3 );
		const s = sim.snapshot();
		assert.ok( Math.abs( s[ 0 ] - 12 ) < 0.02 && Math.abs( s[ 2 ] + 7 ) < 0.02 );
		assert.ok( Math.abs( s[ 7 ] ) < 0.1 );
		assert.equal( s[ 10 ], 4 );
	} finally { sim.free(); }
} );

for ( const shape of [ 'box', 'cylinder' ] ) test( `Imported ${ shape } collisions block the moving chassis`, () => {
	const sim = world();
	try {
		if ( shape === 'box' ) sim.add_boxes( new Float32Array( [ 0, 2, 12, 8, 2, 0.5, 0, 0.65 ] ) );
		else sim.add_cylinders( new Float32Array( [ 0, 12, 2, 0, 4 ] ) );
		advance( sim, 5, [ 1, 0, 0, 0 ] );
		const s = sim.snapshot();
		assert.ok( s[ 2 ] > 5 && s[ 2 ] < 10, `car crossed the obstacle: z=${ s[ 2 ] }` );
		assert.ok( Math.abs( s[ 7 ] ) < 3, `car did not stop: ${ s[ 7 ] } km/h` );
	} finally { sim.free(); }
} );

test( 'Invalid terrain and non-finite frame input are rejected without corrupting the body', () => {
	const sim = world();
	try {
		assert.equal( sim.set_terrain( new Float32Array( 3 ), 5, 200, - 100 ), false );
		assert.equal( sim.set_terrain( new Float32Array( 25 ).fill( NaN ), 5, 200, - 100 ), false );
		const before = Array.from( sim.snapshot() );
		sim.advance( NaN, 1, 0, 0, 0 );
		sim.reset( Infinity, 0, 0, 0 );
		assert.deepEqual( Array.from( sim.snapshot() ), before );
	} finally { sim.free(); }
} );

test( 'Road grip acts at real wheel contacts and does not change nearby sand', () => {
	const run = ( roads ) => {
		const sim = world();
		try {
			assert.equal( sim.set_roads( new Float32Array( roads ) ), true );
			advance( sim, 2, [ 1, 0, 0, 0 ] );
			assert.equal( sim.snapshot()[ 10 ], 4 );
			return sim.snapshot()[ 7 ];
		} finally { sim.free(); }
	};
	const sand = run( [] );
	const asphalt = run( [ 0, - 50, 0, 50, 2.7, 0.95 ] );
	const beside = run( [ 10, - 50, 10, 50, 2.7, 0.95 ] );
	assert.ok( asphalt > sand * 1.15, `road traction did not increase acceleration: ${ asphalt } vs ${ sand }` );
	assert.ok( Math.abs( beside - sand ) < 0.01, 'road grip leaked onto adjacent sand' );
} );

test( 'The shipped module reports the full 96-value car snapshot', () => {
	const sim = world();
	try {
		const s = sim.snapshot();
		assert.equal( s.length, 96 );
		assert.ok( s.every( Number.isFinite ) );
		assert.equal( s[ 8 ], 0, 'parked shows neutral' );
		for ( let wheel = 0; wheel < 4; wheel ++ ) assert.equal( s[ 89 + wheel ], 0, 'terrain without a map is sand' );
	} finally { sim.free(); }
} );

test( 'A car over deep water floats upright on the measured sea surface', () => {
	const sim = new RallyPhysics();
	try {
		assert.equal( sim.set_terrain( new Float32Array( 25 ).fill( - 8 ), 5, 200, - 100 ), true );
		sim.set_water( 0, 0, 0, 0, 0, 0 );
		sim.reset( 0, 1, 0, 0 );
		advance( sim, 12 );
		const s = sim.snapshot();
		assert.equal( s[ 10 ], 0, 'no seabed contact' );
		assert.ok( s[ 73 ] > 0.1 && s[ 73 ] < 0.9, `submerged ${ s[ 73 ] }` );
		assert.ok( Math.abs( s[ 94 ] ) < 0.2, `vertical speed ${ s[ 94 ] }` );
		sim.set_water( NaN, 0, 0, 0, 0, 0 );
		advance( sim, 2 );
		assert.equal( sim.snapshot()[ 73 ], 0, 'disabling the sea removes buoyancy' );
	} finally { sim.free(); }
} );

test( 'Terrain material codes reach the wheel contacts; wrong-sized maps are rejected', () => {
	const sim = world();
	try {
		assert.equal( sim.set_surface_map( new Uint8Array( 3 ) ), false );
		assert.equal( sim.set_surface_map( new Uint8Array( 25 ).fill( 7 ) ), true );
		advance( sim, 0.5 );
		for ( let wheel = 0; wheel < 4; wheel ++ ) assert.equal( sim.snapshot()[ 89 + wheel ], 7 );
	} finally { sim.free(); }
} );
