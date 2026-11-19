// Verify the shallow-water solver against physical outcomes on the island.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';

const G = 9.81; // m/s^2
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'A plane crest keeps its height across 1.2 km of 90 m deep sea (numerical diffusion)', () => {
	// sigma 32 m is 4 cells, the outer ring's coarsest crest. Linear long waves keep their height; any
	// loss here is the scheme. First order kept 0.34 m of 1 m after 40 s, second order 0.73 m.
	const w = new WaterGrid( () => - 90, { n: 257, dx: 8, sponge: false, friction: false } );
	w.launch( { x: 0, z: 0, direction: 0, intensity: 1, width: 32, radius: 1e9, crestHalfLength: 1e9, launchDistance: 700 } );
	for ( let s = 0; s < 400; s ++ ) w.advance( 0.1 );
	let peak = 0;
	for ( let k = 0; k < w.h.length; k ++ ) peak = Math.max( peak, w.h[ k ] - 90 );
	assert.ok( peak >= 0.65, `crest after 40 s (about 1.2 km) must keep 0.65 m of 1 m, kept ${ peak.toFixed( 3 ) } m` );
	assert.equal( w.stats.positivityCorrection, 0 );
} );

test( 'The nested pair holds the real island sea exactly at rest, wet and dry', () => {
	const outer = new WaterGrid( ground, { n: 257, dx: 32, fixedStep: true } );
	const inner = new WaterGrid( ground, { n: 257, dx: 8, fixedStep: true, parent: outer } );
	for ( let s = 0; s < 30; s ++ ) {
		outer.advance( 0.1 );
		inner.advance( 0.1 );
	}
	let eta = 0, q = 0;
	for ( const w of [ outer, inner ] ) {
		for ( let k = 0; k < w.h.length; k ++ ) {
			if ( w.h[ k ] > 0 ) eta = Math.max( eta, Math.abs( w.h[ k ] + w.bed[ k ] ) );
			q = Math.max( q, Math.abs( w.qx[ k ] ), Math.abs( w.qz[ k ] ) );
		}
	}
	assert.ok( inner.stats.steps > 0 && outer.stats.steps > 0, 'both grids stepped' );
	assert.ok( eta < 1e-9 && q < 1e-9, `still sea must stay still: |eta| ${ eta }, |q| ${ q }` );
} );

test( 'Solitary-wave run-up on a 1:5 plane beach falls inside the Synolakis band and grows with H', () => {
	const d = 10, cot = 5, dx = 1.4, n = 257; // m, -, m
	const toe = 280, shore = toe + d * cot; // m
	const bed = x => x < toe ? - d : - d + ( x - toe ) / cot;
	const runs = [];
	for ( const ratio of [ 0.03, 0.04 ] ) { // H / d, both under the 1:5 breaking limit 0.288 tan(b)^(10/9) = 0.048
		const H = ratio * d, k = Math.sqrt( 3 * H / ( 4 * d ** 3 ) ), x0 = toe - 2.2 / k, c = Math.sqrt( G * ( d + H ) );
		// Grid centre at x = ( n - 1 ) dx / 2, so cell i sits at x = i dx (the wall at x = 0).
		const w = new WaterGrid( ( x ) => bed( x ), { n, dx, x: ( n - 1 ) * dx / 2, sponge: false, friction: false } );
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {
			const p = j * n + i, x = i * dx, b = w.bed[ p ], eta = H / Math.cosh( k * ( x - x0 ) ) ** 2;
			w.h[ p ] = Math.max( 0, - b + ( b < 0 ? eta : 0 ) );
			w.qx[ p ] = w.h[ p ] > 0 && b < 0 ? w.h[ p ] * c * eta / ( d + eta ) : 0;
			w.qz[ p ] = 0;
		}
		w.pack();
		let R = 0, peakAt = 0;
		const end = ( shore - x0 ) / c + 12;
		while ( w.time < end ) {
			w.advance( 0.1 );
			for ( let p = 0; p < n; p ++ ) { // one row: the bed varies in x only
				if ( w.bed[ p ] > 0 && w.h[ p ] > 1e-3 && w.bed[ p ] + w.h[ p ] > R ) { R = w.bed[ p ] + w.h[ p ]; peakAt = w.time; }
			}
			if ( R > 0 && w.time > peakAt + 4 ) break; // run-up has peaked and drawn down
		}
		const law = 2.831 * Math.sqrt( cot ) * ratio ** 1.25 * d;
		runs.push( { ratio, R, law } );
		assert.ok( Math.abs( R / law - 1 ) <= 0.2, `run-up ${ R.toFixed( 3 ) } m must be within 20% of Synolakis ${ law.toFixed( 3 ) } m at H/d ${ ratio }` );
	}
	assert.ok( runs[ 1 ].R > runs[ 0 ].R, `run-up must grow with H: ${ JSON.stringify( runs ) }` );
} );

test( 'The 3000 m wall overruns the summit and every field stays finite', () => {
	let summit = - Infinity, sx = 0, sz = 0;
	for ( let z = - 1000; z <= 1000; z += 4 ) for ( let x = - 1000; x <= 1000; x += 4 ) {
		const y = ground( x, z );
		if ( y > summit ) { summit = y; sx = x; sz = z; }
	}
	assert.ok( summit > 300, `the island summit is about 305 m, found ${ summit.toFixed( 1 ) } m` );
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 3000, warningLead: 3, duration: 60 } );
	let wetAt = - 1;
	while ( field.time < 3 + e.approach + 30 && field.events.has( 'tsunami' ) ) {
		field.advance( 0.1 );
		if ( field.waterAt( sx, sz ) > summit + 1 ) { wetAt = field.time; break; }
	}
	for ( const w of [ field.water, field.outer ] ) {
		for ( const key of [ 'h', 'qx', 'qz' ] ) assert.ok( w[ key ].every( Number.isFinite ), `${ key } stays finite` );
		assert.ok( w.pixels.every( Number.isFinite ), 'the packed field stays finite' );
	}
	assert.ok( wetAt > 0, `the ${ summit.toFixed( 1 ) } m summit at (${ sx }, ${ sz }) must go under; water there ${ field.waterAt( sx, sz ).toFixed( 1 ) } m at ${ field.time.toFixed( 1 ) } s` );
} );
