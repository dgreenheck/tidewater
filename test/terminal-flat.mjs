import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { applyTerminalSite, terminalToWorld, PLACES } from '../src/ferry/Terminal.js';
import { TERMINAL_SITE } from '../src/ferry/terminalSite.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';

// The island as App builds it: both terminals' site edits, Joey's village site, then the roads.
// The same terminal stands at Tidewater and on Joey Island. Its yard paving is visual only, so a
// car crossing the yard drives on the terrain: the flat has to be level under all of it. Behind
// Joey's yard the natural hillside once stood up to 12 m through the paving, right where the
// road out of the marshalling lanes turns for the island road.
const natural = new TerrainData();
const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
const route = new CoastalRoute( terrain );
const FLAT = TERMINAL_SITE.fill[ 0 ].height, poly = TERMINAL_SITE.fill[ 0 ].poly;
const inside = ( x, z ) => {
	let hit = false;
	for ( let i = 0, j = poly.length - 1; i < poly.length; j = i ++ ) {
		const [ xi, zi ] = poly[ i ], [ xj, zj ] = poly[ j ];
		if ( ( zi > z ) !== ( zj > z ) && x < ( xj - xi ) * ( z - zi ) / ( zj - zi ) + xi ) hit = ! hit;
	}
	return hit;
};
const ground = ( name, x, z ) => { const w = terminalToWorld( [ x, 0, z ], undefined, PLACES[ name ] ); return terrain.heightAt( w.x, w.z ); };

test( 'No ground inside either terminal\'s flat stands above its level', () => {
	for ( const name of Object.keys( PLACES ) ) {
		let worst = - Infinity, at = null;
		for ( let z = - 125; z <= 45; z += 0.5 ) for ( let x = - 40; x <= 100; x += 0.5 ) {
			if ( ! inside( x, z ) ) continue;
			const h = ground( name, x, z );
			if ( h > worst ) { worst = h; at = `${ x }, ${ z }`; }
		}
		assert.ok( worst <= FLAT + 0.05, `${ name }: ground at ${ worst.toFixed( 2 ) } m inside the flat (terminal ${ at }), the flat is ${ FLAT } m` );
	}
} );

// The marshalling lanes' car boxes end at z -92. From there the car crosses the yard on the
// terrain, along the yard road behind the village car park, to the road entry on the flat's
// edge, then out along the link and its bell mouths to the island road's junction.
test( 'At Joey Island the drive from the marshalling lanes to the island road is level', () => {
	const [ ex, ez ] = TERMINAL_SITE.roadEntry.point;
	const legs = [ [ - 3, - 88 ], [ - 3, - 104 ], [ 48, - 104 ], [ ex, - 110 ], [ ex, ez ] ];
	let high = - Infinity, low = Infinity, at = null, samples = 0;
	const check = ( h, where ) => { samples ++; if ( h > high ) { high = h; at = where; } low = Math.min( low, h ); };
	for ( let i = 1; i < legs.length; i ++ ) {
		const [ ax, az ] = legs[ i - 1 ], [ bx, bz ] = legs[ i ], n = Math.ceil( Math.hypot( bx - ax, bz - az ) * 2 );
		for ( let k = 0; k <= n; k ++ ) for ( const across of [ - 2.5, 0, 2.5 ] ) {
			const t = k / n, dx = bx - ax, dz = bz - az, l = Math.hypot( dx, dz );
			const x = ax + dx * t - dz / l * across, z = az + dz * t + dx / l * across;
			if ( inside( x, z ) ) check( ground( 'joey', x, z ), `terminal ${ x.toFixed( 1 ) }, ${ z.toFixed( 1 ) }` );
		}
	}
	for ( const path of [ route.joeyLink, ...route.joeyMouths ] ) for ( const p of path.points ) check( terrain.heightAt( p.x, p.z ), `${ path.name } ${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) }` );
	assert.ok( samples > 300, `only ${ samples } samples on the way out` );
	assert.ok( high <= FLAT + 0.05, `the way out climbs to ${ high.toFixed( 2 ) } m (${ at }), the flat is ${ FLAT } m` );
	assert.ok( low >= FLAT - 0.05, `the way out dips to ${ low.toFixed( 2 ) } m` );
} );

// Wherever the site cuts land back to the flat, the cut face is a bank, not a wall: the same
// rule as the road grading (test/coastal-grade.mjs), 1.4 m per metre or the natural slope.
test( 'The cut behind Joey\'s yard leaves a bank, never a cliff', () => {
	const { res, heights } = terrain, before = natural.heights, walls = [];
	const o = PLACES.joey.position, reach = 160;
	const i0 = Math.floor( ( o.x - reach - terrain.origin ) / terrain.texel ), i1 = Math.ceil( ( o.x + reach - terrain.origin ) / terrain.texel );
	const j0 = Math.floor( ( o.z - reach - terrain.origin ) / terrain.texel ), j1 = Math.ceil( ( o.z + reach - terrain.origin ) / terrain.texel );
	const cut = k => before[ k ] > FLAT + 0.1 && heights[ k ] < before[ k ] - 0.02;
	let faces = 0;
	for ( let j = j0; j < j1; j ++ ) for ( let i = i0; i < i1; i ++ ) {
		const k = j * res + i;
		for ( const n of [ k + 1, k + res ] ) {
			if ( ! cut( k ) && ! cut( n ) ) continue;
			faces ++;
			const step = Math.abs( heights[ k ] - heights[ n ] ), slope = Math.abs( before[ k ] - before[ n ] );
			if ( step > Math.max( 1.4, slope + 0.2 ) ) walls.push( `${ step.toFixed( 2 ) } m at texel (${ i }, ${ j })` );
		}
	}
	assert.equal( walls.length, 0, `${ walls.length } of ${ faces } cut steps are walls, e.g. ${ walls.slice( 0, 5 ).join( '; ' ) }` );
} );
