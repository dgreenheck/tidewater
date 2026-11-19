// The starting path uses the island terrain, village and walking controller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';

const RADIUS = 0.3, HEIGHT = 1.75, STEP = 0.4; // m: Player.js capsule and the step it climbs (resolveCapsule)
const REACH = 30; // m: the straight walk the start must give

// Isolate canvas rasterization and GPU upload only (as test/collider-queries.mjs); the world is real.
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
const terrain = new TerrainData();
const colliders = new Colliders();
try {

	for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
	new Village( { scene: new Scene(), terrain, colliders } );
	new CoastalRoute( terrain );

} finally {

	globalThis.document = oldDocument;
	StorageBuffer.prototype.write = oldWrite;

}

const floor = ( x, z, maxY ) => Math.max( terrain.heightAt( x, z ), colliders.groundHeightAt( x, z, maxY ) );

test( 'the start stands on the boardwalk on the entrance arch centreline', () => {

	const { x, z } = WORLD.start.position;
	const arch = colliders.boxes.find( b => b.tag === 'pierArch' );
	assert.ok( arch, 'no pierArch collider in the built village' );
	assert.ok( Math.abs( x - arch.center.x ) < 0.05, `start x ${ x } is ${ ( x - arch.center.x ).toFixed( 2 ) } m off the arch centreline x ${ arch.center.x }` );
	// the whole capsule footprint is on planks (a walkable box above the sand), not half off the edge
	for ( const [ dx, dz ] of [ [ 0, 0 ], [ - RADIUS, 0 ], [ RADIUS, 0 ], [ 0, - RADIUS ], [ 0, RADIUS ] ] ) {

		const deck = colliders.groundHeightAt( x + dx, z + dz, 50 ), sand = terrain.heightAt( x + dx, z + dz );
		assert.ok( deck > sand, `start footprint ${ ( x + dx ).toFixed( 2 ) }, ${ ( z + dz ).toFixed( 2 ) } is off the boardwalk (deck ${ deck }, sand ${ sand.toFixed( 2 ) })` );

	}

} );

test( `held W from the start walks ${ REACH } m straight down the boardwalk and through the arch without touching a collider`, () => {

	const { x: x0, z: z0 } = WORLD.start.position, yaw = WORLD.start.yaw;
	const fx = - Math.sin( yaw ), fz = - Math.cos( yaw ); // Player.js forward for yaw (CastReach cameraHeading convention)
	const p = new Vector3( x0, floor( x0, z0, 50 ), z0 ), q = new Vector3();
	for ( let s = 0; s <= REACH; s += 0.05 ) {

		p.x = x0 + fx * s;
		p.z = z0 + fz * s;
		p.y = floor( p.x, p.z, p.y + STEP );
		q.copy( p );
		colliders.resolveCapsule( q, RADIUS, HEIGHT, STEP );
		const push = Math.hypot( q.x - p.x, q.z - p.z );
		assert.ok( push < 1e-3, `held W from the start (${ x0 }, ${ z0 }) hits a collider ${ s.toFixed( 2 ) } m along, at ${ p.x.toFixed( 2 ) }, ${ p.y.toFixed( 2 ) }, ${ p.z.toFixed( 2 ) } (pushed ${ push.toFixed( 2 ) } m)` );

	}
	assert.ok( p.y > WORLD.pier.deckHeight - 0.05, `the walk ends at y ${ p.y.toFixed( 2 ) }, not on the pier deck (${ WORLD.pier.deckHeight } m)` );

} );
