import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { applyTerminalSite, terminalToWorld } from '../src/ferry/Terminal.js';
import { TERMINAL_SITE } from '../src/ferry/terminalSite.js';

// The island as the game builds it: the terminal's site edits first, then the roads. The
// ferry road must meet the terminal's own road entry, from its generated site data.
const terrain = new TerrainData();
applyTerminalSite( terrain );
const route = new CoastalRoute( terrain );
const road = route.paths.find( path => path.name === 'ferryRoad' );
const { point: [ ex, ez ], height, yaw } = TERMINAL_SITE.roadEntry;
const entry = terminalToWorld( [ ex, height, ez ] ), heading = yaw + WORLD.ferryTerminal.yaw;
const degrees = r => r * 180 / Math.PI;

test( 'The ferry road arrives at the terminal road entry, level and heading into the yard', () => {
	assert.ok( road, 'no ferry road on the island' );
	const pts = road.points, end = pts.at( - 1 ), back = pts.findLast( p => end.distance - p.distance >= 10 );
	assert.ok( Math.hypot( end.x - entry.x, end.z - entry.z ) < 0.5, `ends at (${ end.x.toFixed( 2 ) }, ${ end.z.toFixed( 2 ) }), entry (${ entry.x }, ${ entry.z })` );
	assert.ok( Math.abs( end.h - entry.y ) <= 0.1 + 1e-9, `ends at ${ end.h.toFixed( 3 ) } m, entry paving ${ entry.y } m` );
	// The paving is visual only: the car drives on the flat's fill, so the road lands on that.
	const flat = TERMINAL_SITE.fill[ 0 ].height;
	assert.ok( Math.abs( end.h - flat ) < 0.01, `ends at ${ end.h.toFixed( 3 ) } m, the flat the car drives on is ${ flat } m` );
	const turn = Math.abs( Math.atan2( Math.sin( Math.atan2( end.x - back.x, end.z - back.z ) - heading ), Math.cos( Math.atan2( end.x - back.x, end.z - back.z ) - heading ) ) );
	assert.ok( degrees( turn ) < 5, `arrives ${ degrees( turn ).toFixed( 1 ) } degrees off the entry heading` );
	for ( const p of pts.filter( q => end.distance - q.distance <= 10 ) ) {
		assert.ok( Math.abs( ( p.x - end.x ) * Math.cos( heading ) - ( p.z - end.z ) * Math.sin( heading ) ) < 0.05, 'the last 10 m are not straight' );
		assert.ok( Math.abs( p.h - end.h ) < 0.01, `the last 10 m are not level: ${ p.h.toFixed( 3 ) } m` );
	}
} );

test( 'The ferry road stays on dry ground at a drivable grade', () => {
	const pts = road.points;
	const low = pts.reduce( ( a, p ) => p.h < a.h ? p : a );
	assert.ok( low.h >= 1.6, `dips to ${ low.h.toFixed( 2 ) } m at (${ low.x.toFixed( 0 ) }, ${ low.z.toFixed( 0 ) })` );
	let steep = 0;
	for ( let i = 1; i < pts.length; i ++ ) steep = Math.max( steep, Math.abs( pts[ i ].h - pts[ i - 1 ].h ) / Math.hypot( pts[ i ].x - pts[ i - 1 ].x, pts[ i ].z - pts[ i - 1 ].z ) );
	assert.ok( steep <= 0.125, `grade reaches ${ ( steep * 100 ).toFixed( 1 ) } %` );
	assert.ok( Math.abs( route.ferryRoadMaxGrade - steep ) < 1e-9, 'the route reports another grade' );
	assert.ok( route.ferryRoadLength > 350, `only ${ route.ferryRoadLength } m long` );
	assert.equal( road.kind, 'asphalt' ); assert.equal( road.halfWidth, 2.7 );
} );

test( 'The ferry road leaves the mountain circuit on the circuit\'s own asphalt and height', () => {
	const start = road.points[ 0 ], q = route.closest( start.x, start.z, segment => segment.path === route.circuit );
	assert.ok( q.distance < 0.5, `starts ${ q.distance.toFixed( 2 ) } m off the circuit` );
	assert.ok( Math.abs( q.h - start.h ) < 0.05, `starts ${ ( start.h - q.h ).toFixed( 2 ) } m off the circuit's height` );
} );

test( 'The car physics, the ground and the plants all see the ferry road', () => {
	for ( const p of road.points ) {
		assert.equal( terrain.roadSurfaceAt( p.x, p.z )?.kind, 'asphalt', `no asphalt at (${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) })` );
		assert.ok( Math.abs( terrain.heightAt( p.x, p.z ) - p.h ) < 0.12, `ground off the road profile at (${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) })` );
		// Vegetation, rocks and debris keep clear of the seal, shoulder and barrier line.
		assert.ok( terrain.pathDistance( p.x, p.z ) < - 6, `plants allowed on the ferry road at (${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) })` );
	}
	const data = route.physicsData(), rows = data.length / 6;
	assert.equal( rows, route.segments.length );
	assert.ok( route.segments.filter( segment => segment.path === road ).length === road.points.length - 1, 'the physics misses ferry road segments' );
} );
