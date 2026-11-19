import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { Evacuation } from '../src/evacuation/Evacuation.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';

// The character, crabs, ragdolls, cockatoos and crowd ask the collision world for ground and push-out
// hundreds of times a frame. groundHeightAt and resolveCapsule built a new [ lx, lz ] array for every
// box near the query (Colliders._toLocal), which fed the garbage collector every frame (L6 profile,
// 2026-10-05). The fast path must give bit-identical answers on the real village and terminals.
// Isolate canvas rasterization and GPU upload only (as test/prop-clearance.mjs); the world is real.
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
let colliders;
try {

	const terrain = new TerrainData();
	for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
	colliders = new Colliders();
	const scene = new Scene(), village = new Village( { scene, terrain, colliders } );
	new CoastalRoute( terrain );
	new Evacuation( { terrainData: terrain, colliders, scene, village } ).build();

} finally {

	globalThis.document = oldDocument;
	StorageBuffer.prototype.write = oldWrite;

}

// the queries as they were before the fast path (Colliders.js in the baseline), kept as the reference
function referenceGround( C, x, z, maxY, pad = 0 ) {

	let best = - Infinity;
	for ( const b of C.boxes ) {

		if ( ! b.walkable || b.top > maxY ) continue;
		if ( Math.abs( x - b.center.x ) > b.radius + pad + 0.01 || Math.abs( z - b.center.z ) > b.radius + pad + 0.01 ) continue;
		const [ lx, lz ] = C._toLocal( b, x, z );
		if ( Math.abs( lx ) <= b.half.x + pad && Math.abs( lz ) <= b.half.z + pad ) best = Math.max( best, b.top );

	}

	return best;

}

function referenceResolve( C, pos, radius, height, stepHeight = 0.35 ) {

	let hit = false;
	for ( const b of C.boxes ) {

		if ( ! b.solid ) continue;
		if ( pos.y + height < b.bottom || pos.y + stepHeight > b.top ) continue;
		if ( Math.abs( pos.x - b.center.x ) > b.radius + radius || Math.abs( pos.z - b.center.z ) > b.radius + radius ) continue;
		const [ lx, lz ] = C._toLocal( b, pos.x, pos.z );
		const cx = Math.max( - b.half.x, Math.min( b.half.x, lx ) );
		const cz = Math.max( - b.half.z, Math.min( b.half.z, lz ) );
		const dx = lx - cx, dz = lz - cz;
		const d2 = dx * dx + dz * dz;
		if ( d2 >= radius * radius ) continue;
		let nx, nz, pen;
		if ( d2 > 1e-8 ) {

			const d = Math.sqrt( d2 );
			nx = dx / d; nz = dz / d; pen = radius - d;

		} else {

			const px = b.half.x - Math.abs( lx ), pz = b.half.z - Math.abs( lz );
			if ( px < pz ) { nx = Math.sign( lx ) || 1; nz = 0; pen = px + radius; } else { nx = 0; nz = Math.sign( lz ) || 1; pen = pz + radius; }

		}

		const [ wx, wz ] = C._toWorldDir( b, nx, nz );
		pos.x += wx * pen;
		pos.z += wz * pen;
		hit = true;

	}

	for ( const c of C.cylinders ) {

		if ( pos.y + height < c.yMin || pos.y + stepHeight > c.yMax ) continue;
		const dx = pos.x - c.x, dz = pos.z - c.z;
		const r = c.radius + radius;
		const d2 = dx * dx + dz * dz;
		if ( d2 >= r * r ) continue;
		const d = Math.sqrt( d2 ) || 1e-4;
		pos.x = c.x + dx / d * r;
		pos.z = c.z + dz / d * r;
		hit = true;

	}

	return hit;

}

// query points: a 0.37 m lattice over every walkable or solid box of the village, piers and terminals
function lattice() {

	const points = [];
	for ( const b of colliders.boxes ) {

		if ( points.length > 60000 ) break;
		for ( let u = - b.radius - 0.5; u <= b.radius + 0.5; u += 0.37 ) for ( let v = - b.radius - 0.5; v <= b.radius + 0.5; v += 0.91 ) points.push( [ b.center.x + u, b.center.z + v, b.top ] );

	}

	return points;

}

test( 'Ground and push-out queries on the real village give bit-identical answers and build no array per box', () => {

	assert.ok( colliders.boxes.length > 200, `${ colliders.boxes.length } boxes in the real collision world` );
	const toLocal = colliders._toLocal;
	let allocations = 0;
	colliders._toLocal = function ( ...a ) { allocations ++; return toLocal.apply( this, a ); };
	const points = lattice();
	let grounds = 0, hits = 0, mismatches = 0;
	const q = new Vector3(), r = new Vector3();
	for ( const [ x, z, top ] of points ) {

		for ( const [ maxY, pad ] of [ [ top + 0.4, 0 ], [ top - 0.05, 0 ], [ top + 0.08, 0.2 ] ] ) {

			const before = allocations;
			const expected = referenceGround( colliders, x, z, maxY, pad );
			allocations = before;
			const actual = colliders.groundHeightAt( x, z, maxY, pad );
			if ( ! Object.is( actual, expected ) ) mismatches ++;
			if ( expected > - Infinity ) grounds ++;

		}

		for ( const [ radius, height, step ] of [ [ 0.3, 1.75, 0.4 ], [ 0.27, 1.7, 0.35 ], [ 0.25, 1.6, 0 ] ] ) {

			q.set( x, top - 1, z );
			r.copy( q );
			const before = allocations;
			const expectedHit = referenceResolve( colliders, r, radius, height, step );
			allocations = before;
			const hit = colliders.resolveCapsule( q, radius, height, step );
			if ( hit !== expectedHit || ! Object.is( q.x, r.x ) || ! Object.is( q.z, r.z ) ) mismatches ++;
			if ( expectedHit ) hits ++;

		}

	}

	colliders._toLocal = toLocal;
	assert.ok( grounds > 1000 && hits > 1000, `the lattice exercises real decks and walls (${ grounds } grounds, ${ hits } push-outs over ${ points.length } points)` );
	assert.equal( mismatches, 0, `${ mismatches } queries differ from the reference` );
	assert.equal( allocations, 0, `${ allocations } [ lx, lz ] arrays built by ground and push-out queries (expected 0)` );

} );
