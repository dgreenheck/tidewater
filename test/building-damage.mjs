// Progressive building damage on the real village (docs/disaster-damage.md, "buildings fail piece
// by piece"). Terrain, the authored Village, its structure() records and the native WASM bodies are
// real; only canvas rasterisation and GPU upload are stubbed, as in test/prop-clearance.mjs. The
// field is a steady wind or a steady flood so each outcome can be read against the EF bands and
// FEMA P-646. The test reads outcomes from the geometry and the spawned bodies, never from labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { STRUCTURES, StructuralDamage } from '../src/disasters/Structures.js';

const trace = process.env.BUILDING_DAMAGE_TRACE ? ( ...a ) => console.error( ( performance.now() / 1000 ).toFixed( 1 ), ...a ) : () => {};
await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
let terrain, colliders;
try {
	terrain = new TerrainData();
	colliders = new Colliders();
	new Village( { scene: new Scene(), terrain, colliders } );
} finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; }

trace( 'village built' );
// The houses, sheds, boathouse and stall: every record with a roof. Decks keep their own path.
const houses = STRUCTURES.filter( r => ! /pier|boardwalk/i.test( r.name ) && r.spans.some( s => /roofMetal|thatch/.test( s.member?.material ) ) );
const DT = 1 / 20; // s, the duration-of-load window (0.05 s) is one step
const SCALE = Number( process.env.BUILDING_DAMAGE_SCALE ?? 1 ); // shortens every run for profiling only
const sim = new RallyPhysics();
sim.reset( 100, 100, 100, 0 );
let spawnFrame = 0;
const spawns = [];
const wake = sim.wake_prop.bind( sim );
sim.wake_prop = ( ...a ) => { const ok = wake( ...a ); if ( ok ) spawns.push( spawnFrame ); return ok; };
const owner = { runSeed: 1, field: null };
const app = { terrainData: terrain, colliders, rally: { physics: sim, refreshIslandColliders() {}, requestIslandColliders() {} } };
const damage = new StructuralDamage( app, owner );
damage.records = damage.records.filter( r => houses.includes( r ) );
trace( 'damage built' );
const debris = [];
damage.onDebris?.( e => debris.push( e ) );

// The test's own reading of each span: what it is, by authored material and height.
function kindOf( r, s ) {
	const m = s.member?.material;
	if ( m === 'roofMetal' || m === 'thatch' ) return 'roofing';
	if ( m === 'glass' ) return 'glass';
	// A door: a thin upright wood leaf 0.6-1.4 m wide and 1.7-2.5 m tall.
	const [ x0, x1 ] = range( s, 0 ), [ y0, y1 ] = range( s, 1 ), [ z0, z1 ] = range( s, 2 );
	if ( m === 'wood' && Math.min( x1 - x0, z1 - z0 ) < .15 && Math.max( x1 - x0, z1 - z0 ) > .6 && Math.max( x1 - x0, z1 - z0 ) < 1.4 && y1 - y0 > 1.7 && y1 - y0 < 2.5 ) return 'door';
	if ( m === 'stone' ) return 'masonry';
	if ( m !== 'wood' ) return 'fitting';
	const eave = r.eaveY ??= Math.min( ...r.spans.filter( x => /roofMetal|thatch/.test( x.member?.material ) ).map( x => yRange( x )[ 0 ] ) );
	const [ lo, hi ] = yRange( s );
	return ( lo + hi ) / 2 < eave - .1 ? 'wall' : 'frame';
}
function range( s, k ) { let lo = Infinity, hi = - Infinity; const a = s.restPos ?? s.pos; for ( let i = k; i < a.length; i += 3 ) { lo = Math.min( lo, a[ i ] ); hi = Math.max( hi, a[ i ] ); } return [ lo, hi ]; }
function yRange( s ) { let lo = Infinity, hi = - Infinity; const a = s.restPos ?? s.pos; for ( let i = 1; i < a.length; i += 3 ) { lo = Math.min( lo, a[ i ] ); hi = Math.max( hi, a[ i ] ); } return [ lo, hi ]; }
// A span has failed when its vertices left their rest place or a rigid body carries it. Bodies may
// carry merged runs of spans, so coverage is by vertex range inside the same geometry.
const byGeo = new Map();
function covered() {
	const out = new Set(), lists = new Set();
	for ( const b of damage.bodies.values() ) lists.add( b.spans ?? b.member?.spans ?? [] );
	for ( const list of lists ) for ( const t of list ) {
		const sorted = byGeo.get( t.geo );
		if ( ! sorted ) continue;
		let lo = 0, hi = sorted.length;
		while ( lo < hi ) { const mid = ( lo + hi ) >> 1; if ( sorted[ mid ].s.start < t.start ) lo = mid + 1; else hi = mid; }
		for ( let i = lo; i < sorted.length && sorted[ i ].s.start < t.start + t.count; i ++ ) out.add( sorted[ i ] );
	}
	return out;
}
function moved( s ) {
	const a = s.geo.attributes.position.array, rest = s.restPos ?? s.pos;
	for ( let i = 0; i < rest.length; i ++ ) if ( Math.abs( a[ s.start * 3 + i ] - rest[ i ] ) > .05 ) return true;
	return false;
}
const all = () => { const list = houses.flatMap( r => r.spans.map( s => ( { r, s, kind: kindOf( r, s ) } ) ) ); byGeo.clear(); for ( const x of list ) { if ( ! byGeo.has( x.s.geo ) ) byGeo.set( x.s.geo, [] ); byGeo.get( x.s.geo ).push( x ); } for ( const v of byGeo.values() ) v.sort( ( a, b ) => a.s.start - b.s.start ); return list; };

function run( seed, sample, seconds ) {
	damage.reset();
	owner.runSeed = seed;
	owner.field = { terrain: ( x, z ) => terrain.heightAt( x, z ), waterAt: ( x, z ) => sample( x, 0, z ).height, sample };
	trace( 'reset' );
	spawns.length = 0; debris.length = 0;
	const spans = all(), first = new Map(), perFrame = new Map();
	const t0 = performance.now();
	for ( let frame = 0; frame < seconds * SCALE / DT; frame ++ ) {
		spawnFrame = frame;
		damage.update( DT );
		sim.advance( DT, 0, 0, 0, 0 );
		damage.sync( sim.prop_poses() );
		trace( 'frame', frame, damage.bodies.size );
		const held = covered();
		for ( const x of spans ) {
			if ( first.has( x ) || ! ( held.has( x ) || moved( x.s ) ) ) continue;
			first.set( x, frame * DT );
			if ( x.kind === 'wall' ) { const k = x.r.name + ':' + frame; perFrame.set( k, ( perFrame.get( k ) ?? 0 ) + 1 ); }
		}
	}
	console.log( `seed ${ seed }: ${ ( seconds * SCALE ).toFixed( 1 ) } game s in ${ ( ( performance.now() - t0 ) / 1000 ).toFixed( 1 ) } s, ${ damage.bodies.size } bodies` );
	const of = kind => spans.filter( x => x.kind === kind ), failed = list => list.filter( x => first.has( x ) );
	const earliest = list => Math.min( Infinity, ...failed( list ).map( x => first.get( x ) ) );
	const walls = of( 'wall' ), roofing = of( 'roofing' );
	const wallSpans = new Map(); for ( const x of walls ) wallSpans.set( x.r.name, ( wallSpans.get( x.r.name ) ?? 0 ) + 1 );
	let blockShare = 0; for ( const [ k, n ] of perFrame ) blockShare = Math.max( blockShare, n / wallSpans.get( k.split( ':' )[ 0 ] ) );
	return { spans, first, walls, roofing, of, failed, earliest, blockShare, spawns: spawns.slice(), debris: debris.length };
}
const wind = V => ( x, y, z ) => ( { height: - 100, wx: V, wy: 0, wz: 0, ux: 0, uz: 0, ax: 0, ay: 0, az: 0, shake: 0 } );
const share = ( a, b ) => a.length / Math.max( 1, b.length );

test( 'A 45 m/s wind fails roofing before walls on the real village houses, across seeds', () => {
	assert.ok( houses.length >= 20, `village houses with roofs: ${ houses.length }` );
	for ( const seed of [ 11, 22, 33 ] ) {
		const o = run( seed, wind( 45 ), 12 );
		const roof = share( o.failed( o.roofing ), o.roofing ), wall = share( o.failed( o.walls ), o.walls );
		assert.ok( roof > .2, `seed ${ seed }: 45 m/s is inside the 38-49 m/s roof covering band, but only ${ ( roof * 100 ).toFixed( 0 ) }% of roofing spans failed` );
		assert.ok( o.earliest( o.roofing ) < o.earliest( o.walls ), `seed ${ seed }: first roofing failure at ${ o.earliest( o.roofing ).toFixed( 2 ) } s, first wall at ${ o.earliest( o.walls ).toFixed( 2 ) } s` );
		assert.ok( wall < .05, `seed ${ seed }: ${ ( wall * 100 ).toFixed( 0 ) }% of wall spans failed at 45 m/s, below the 61-74 m/s wall band` );
	}
} );

test( 'A 50 m/s pass strips the roofs and leaves over 80% of the walls standing, and no house goes as one block', () => {
	const o = run( 44, wind( 50 ), 15 );
	const roof = share( o.failed( o.roofing ), o.roofing ), standing = 1 - share( o.failed( o.walls ), o.walls );
	assert.ok( roof >= .9, `50 m/s is above the roof covering band: ${ ( roof * 100 ).toFixed( 0 ) }% of roofing spans failed` );
	assert.ok( standing > .8, `${ ( standing * 100 ).toFixed( 0 ) }% of wall spans stand at 50 m/s` );
	assert.ok( o.blockShare <= .4, `a house lost ${ ( o.blockShare * 100 ).toFixed( 0 ) }% of its wall spans in one frame: it went as one block` );
	// Standing spans have not moved at all: the house is not tilting as a whole.
	for ( const x of o.spans ) if ( ! o.first.has( x ) ) assert.equal( moved( x.s ), false, `${ x.r.name } ${ x.kind } span moved while standing` );
	assert.ok( o.debris > 0, `small lifted pieces reach the debris hook (${ o.debris } events)` );
} );

test( 'The body spawn rate stays bounded while the roofs come off', () => {
	const o = run( 55, wind( 50 ), 10 );
	const perFrame = new Map(); for ( const f of o.spawns ) perFrame.set( f, ( perFrame.get( f ) ?? 0 ) + 1 );
	let window = 0; for ( const f of perFrame.keys() ) window = Math.max( window, o.spawns.filter( g => g >= f && g < f + 1 / DT ).length );
	assert.ok( o.spawns.length > 0, 'large pieces near the player become rigid bodies' );
	assert.ok( Math.max( 0, ...perFrame.values() ) <= 8, `${ Math.max( ...perFrame.values() ) } bodies spawned in one frame` );
	assert.ok( window <= 16, `${ window } bodies spawned inside one second (bound: 8/s with a burst of 8)` );
} );

test( 'A 2 m/s, 1.5 m flood takes the submerged doors and windows and no masonry', () => {
	const depth = 1.5, flow = 2; // m, m/s
	// The water rises like a bore front, to full depth over 3 s (the game's tsunami never appears in one step).
	let clock = 0;
	const flood = ( x, y, z ) => ( { height: terrain.heightAt( x, z ) + depth * Math.min( 1, ( clock += y === 0 ? 0 : DT / houses.length ) / 3 ), wx: 0, wy: 0, wz: 0, ux: flow, uz: 0, ax: 0, ay: 0, az: 0, shake: 0 } );
	const o = run( 66, flood, 8 );
	const submerged = [ ...o.of( 'glass' ), ...o.of( 'door' ) ].filter( x => { const c = x.r.center; return yRange( x.s )[ 0 ] < terrain.heightAt( c.x, c.z ) + depth - .3; } );
	const masonry = o.failed( o.of( 'masonry' ) );
	assert.ok( submerged.length > 0, `some village doors or windows sit under a 1.5 m flood (doors ${ o.of( 'door' ).length }, windows ${ o.of( 'glass' ).length })` );
	assert.equal( o.failed( submerged ).length, submerged.length, `${ o.failed( submerged ).length } of ${ submerged.length } submerged doors and windows broke` );
	assert.equal( masonry.length, 0, `${ masonry.length } masonry spans failed in a 1.5 m flood (masonry fails only above about 5 m)` );
	assert.ok( o.blockShare <= .4, `a house lost ${ ( o.blockShare * 100 ).toFixed( 0 ) }% of its wall spans in one frame` );
	for ( const x of o.spans ) if ( ! o.first.has( x ) ) assert.equal( moved( x.s ), false, `${ x.r.name } ${ x.kind } span moved while standing` );
} );

// The player's capsule (src/player/Player.js RADIUS, HEIGHT, step 0.4 m) walks from 3 m outside a wall
// panel straight at the house centre, 5 cm a step. Returns how far (m) its centre ended on the outside of
// the panel's centre, along the approach: positive is stopped outside, negative is through the wall.
function walkInto( r, c ) {
	const dx = c.center[ 0 ] - r.center.x, dz = c.center[ 2 ] - r.center.z, L = Math.hypot( dx, dz ) || 1, ux = dx / L, uz = dz / L;
	const pos = new Vector3( c.center[ 0 ] + ux * 3, 0, c.center[ 2 ] + uz * 3 );
	for ( let i = 0; i < 120; i ++ ) { pos.x -= ux * .05; pos.z -= uz * .05; pos.y = terrain.heightAt( pos.x, pos.z ); colliders.resolveCapsule( pos, .3, 1.75, .4 ); }
	return ( pos.x - c.center[ 0 ] ) * ux + ( pos.z - c.center[ 2 ] ) * uz;
}

test( 'One failed wall panel opens only its own wall: a capsule walking into a standing wall of the same house is stopped', () => {
	damage.reset();
	owner.runSeed = 7;
	owner.field = { terrain: ( x, z ) => terrain.heightAt( x, z ), waterAt: () => - 100, sample: wind( 0 ) };
	damage.update( DT ); // still air: every record builds its components and nothing fails
	// Given: the walls the intact house stops a walker at (within 0.8 m of the panel, not a porch or a stair first).
	const cases = [];
	for ( const r of damage.records ) {
		const walls = ( r.components ?? [] ).filter( c => c.kind === 'wall' );
		const stops = walls.filter( c => { const d = walkInto( r, c ); return d > 0 && d < .8; } );
		if ( stops.length >= 2 ) cases.push( { r, failed: stops[ 0 ], standing: stops.slice( 1 ) } );
	}
	assert.ok( cases.length >= 10, `houses whose walls stop a walker: ${ cases.length }` );
	// When one panel per house fails and its piece is let go (a rigid body near the player, or debris).
	for ( const { r, failed } of cases ) { failed.failed = true; r.onFail( failed ); }
	for ( let frame = 0; frame < 1.5 / DT; frame ++ ) { damage.update( DT ); sim.advance( DT, 0, 0, 0, 0 ); damage.sync( sim.prop_poses() ); }
	let through = 0, open = 0;
	const names = [];
	for ( const { r, failed, standing } of cases ) {
		for ( const c of standing ) { const d = walkInto( r, c ); if ( d <= 0 ) { through ++; names.push( `${ r.name } panel ${ c.center.map( v => v.toFixed( 1 ) ) } (${ d.toFixed( 2 ) } m; failed panel ${ failed.center.map( v => v.toFixed( 1 ) ) })` ); } }
		// The failed panel's own collider is gone: a horizontal ray at its mid height, from 3 m out toward the
		// house centre, now passes its plane (a walker may still meet a stone foundation below the hole).
		const dx = failed.center[ 0 ] - r.center.x, dz = failed.center[ 2 ] - r.center.z, L = Math.hypot( dx, dz ) || 1;
		const hit = colliders.raycast( new Vector3( failed.center[ 0 ] + dx / L * 3, failed.center[ 1 ], failed.center[ 2 ] + dz / L * 3 ), new Vector3( - dx / L, 0, - dz / L ), 6 );
		if ( hit > 3.1 ) open ++;
	}
	const total = cases.reduce( ( n, x ) => n + x.standing.length, 0 );
	assert.equal( through, 0, `${ through } of ${ total } standing wall panels let a walker through after one panel of the house failed: ${ names.join( '; ' ) }` );
	assert.equal( open, cases.length, `the failed panel's own wall opened in ${ open } of ${ cases.length } houses` );
} );

test( 'An 80 m/s core wind takes masonry standing above the ground and never a buried foundation stone', () => {
	const o = run( 77, wind( 80 ), 4 );
	const mid = ( s, k ) => { const [ a, b ] = range( s, k ); return ( a + b ) / 2; };
	const ground = x => terrain.heightAt( mid( x.s, 0 ), mid( x.s, 2 ) );
	// Share of a span's height below the terrain at its centre: stilt pad stones sit about 73% in the soil,
	// stone foundation walls 37-51% (half their face takes the wind, so a weak one may go at 80 m/s),
	// chimneys a few per cent.
	const sunk = x => { const [ a, b ] = yRange( x.s ); return ( ground( x ) - a ) / Math.max( .01, b - a ); };
	const masonry = o.of( 'masonry' ), buried = masonry.filter( x => sunk( x ) > 2 / 3 ), above = masonry.filter( x => sunk( x ) < .1 );
	assert.ok( buried.length > 0 && above.length > 0, `village masonry: ${ buried.length } spans more than two thirds buried, ${ above.length } standing clear of the ground` );
	assert.equal( o.failed( buried ).length, 0, `${ o.failed( buried ).length } of ${ buried.length } masonry spans more than two thirds buried failed in the wind: ${ o.failed( buried ).map( x => `${ x.r.name } sunk ${ sunk( x ).toFixed( 2 ) } part ${ ( x.r.components.find( c => c.spans.includes( x.s ) ) ?? {} ).kind } y ${ yRange( x.s ).map( v => v.toFixed( 2 ) ) }` ).join( '; ' ) }` );
	assert.ok( share( o.failed( above ), above ) > .5, `80 m/s is above the 74 m/s masonry band: ${ o.failed( above ).length } of ${ above.length } above-ground masonry spans failed` );
} );
