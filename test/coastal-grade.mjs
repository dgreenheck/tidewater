import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';

// The real island heightfield, graded by the real route: the same data the renderer and
// the car physics use. Grading may cut and fill, but it must never leave a wall.
// The island as the game builds it: both ferry terminals' site edits first (Joey's road leaves
// its terminal's flat), then the roads.
const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
const before = Float32Array.from( terrain.heights );
const route = new CoastalRoute( terrain );
const { res, heights } = terrain;

// Cut and fill run at 1:1 where there is room. Where two legs of the mountain road pass
// close at very different heights the bank between them has to be steeper; 1.4 m per metre
// (about 54 degrees) is the most grading may add. The old nearest-leg grading left 8 m walls.
test( 'Grading never leaves a cliff between neighbouring ground samples', () => {
	const walls = [];
	for ( let z = 1; z < res - 1; z ++ ) for ( let x = 1; x < res - 1; x ++ ) {
		const i = z * res + x;
		for ( const j of [ i + 1, i + res ] ) {
			if ( heights[ i ] === before[ i ] && heights[ j ] === before[ j ] ) continue;
			const step = Math.abs( heights[ i ] - heights[ j ] ), natural = Math.abs( before[ i ] - before[ j ] );
			if ( step > Math.max( 1.4, natural + 0.2 ) ) walls.push( `${ step.toFixed( 2 ) } m at texel (${ x }, ${ z })` );
		}
	}
	assert.equal( walls.length, 0, `${ walls.length } steep steps, e.g. ${ walls.slice( 0, 5 ).join( '; ' ) }` );
} );

test( 'The road surface stays on its graded profile along every path', () => {
	let worst = 0;
	for ( const segment of route.segments ) for ( let t = 0; t <= 1; t += 0.25 ) {
		const x = segment.a.x + ( segment.b.x - segment.a.x ) * t, z = segment.a.z + ( segment.b.z - segment.a.z ) * t;
		const h = segment.a.h + ( segment.b.h - segment.a.h ) * t;
		worst = Math.max( worst, Math.abs( terrain.heightAt( x, z ) - h ) );
	}
	assert.ok( worst < 0.12, `road surface off its profile by ${ worst.toFixed( 3 ) } m` );
} );

// A road whose grade turns sharply is a wall at speed: the hero descent once met flatter
// ground at -17 % to -1 % inside 5 m and stopped cars dead. Compare the grade over the 5 m
// before and after every point: it may change by at most 2 % per metre (a 50 m curve).
test( 'Every crest and sag is a rolling vertical curve, never a kink', () => {
	const kinks = [];
	for ( const path of route.paths ) {
		const p = path.points;
		for ( let i = 0; i < p.length; i ++ ) {
			let a = i, b = i, da = 0, db = 0;
			while ( a > 0 && da < 5 ) { da += Math.hypot( p[ a ].x - p[ a - 1 ].x, p[ a ].z - p[ a - 1 ].z ); a --; }
			while ( b < p.length - 1 && db < 5 ) { db += Math.hypot( p[ b + 1 ].x - p[ b ].x, p[ b + 1 ].z - p[ b ].z ); b ++; }
			if ( da < 4 || db < 4 ) continue;
			const before = ( p[ i ].h - p[ a ].h ) / da, after = ( p[ b ].h - p[ i ].h ) / db, rate = Math.abs( after - before ) / ( ( da + db ) / 2 );
			if ( rate > 0.02 ) kinks.push( `${ path.name } ${ i }: ${ ( before * 100 ).toFixed( 0 ) }% to ${ ( after * 100 ).toFixed( 0 ) }%` );
		}
	}
	assert.equal( kinks.length, 0, `${ kinks.length } kinks, e.g. ${ kinks.slice( 0, 4 ).join( '; ' ) }` );
} );
