// Per-frame garbage in the expansion systems. Each test runs the real system on real data and
// measures the heap it leaves behind per frame once warm, after a full collection before every frame
// so no scavenge hides an allocation. A garbage-collector pause on a 60 fps frame was 0.7-6.7 ms of
// CPU in the L6 profiles. Each test also pins the output bit for bit: the fingerprint is the SHA-256
// of the JSON state (JSON prints the shortest round-trip form of every double), measured on the
// allocating code in the baseline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Session } from 'node:inspector/promises';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { prepareChairliftSite } from '../src/chairlift/Route.js';
import { LiftTransport } from '../src/chairlift/Transport.js';
import { Group } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { DisasterField } from '../src/disasters/Field.js';
import { WindFarm } from '../src/windfarm/WindFarm.js';
import { Sharks } from '../src/world/marine/Sharks.js';
import { JetskiLights } from '../src/jetski/JetskiLights.js';
import { cpuMeter, trackPeak } from '../src/people/People.js';
import { Vector3, Mesh, BoxGeometry, PerspectiveCamera } from '../src/engine/index.js';
import { G } from '../src/engine/render/Frame.js';

v8.setFlagsFromString( '--expose-gc' );
const gc = vm.runInNewContext( 'gc' );
const print = value => createHash( 'sha256' ).update( JSON.stringify( value ) ).digest( 'hex' ).slice( 0, 16 );
const median = list => list.sort( ( a, b ) => a - b )[ list.length >> 1 ];

// Heap bytes one frame leaves behind (median of `frames` single-frame samples, minus an empty frame).
function bytesPerFrame( frame, frames = 41 ) {

	const sample = fn => {

		const list = [];
		for ( let i = 0; i < frames; i ++ ) {

			gc();
			const before = v8.getHeapStatistics().used_heap_size;
			fn( i );
			list.push( v8.getHeapStatistics().used_heap_size - before );

		}
		return median( list );

	};
	for ( let i = 0; i < 400; i ++ ) frame( i ); // warm the optimising compiler first
	return sample( frame ) - sample( () => {} );

}

const terrain = new TerrainData(), roads = new CoastalRoute( terrain ), site = prepareChairliftSite( terrain, roads );

// A gusting wind that varies along the line and in time; reuses `out` like the real field does.
function gusts() {

	let time = 0;
	return {
		tick( dt ) { time += dt; },
		sample( x, y, z, out = {} ) {

			out.wx = 7 + 3 * Math.sin( x * 0.013 + time * 0.9 );
			out.wy = 0.4 * Math.sin( z * 0.021 - time * 1.7 );
			out.wz = - 2 + 2.5 * Math.cos( ( x + z ) * 0.008 + time * 0.6 );
			return out;

		},
	};

}

test( 'Chairlift transport: a frame allocates nothing and the swinging chairs move bit for bit as before', async () => {

	const t = new LiftTransport( site ), field = gusts(), steps = [ 1 / 60, 1 / 30, 1 / 144, 0.1, 1 / 60 ];
	t.chairs[ 3 ].occupied = true;
	t.start();
	let frame = 0;
	const advance = () => {

		const dt = steps[ frame ++ % steps.length ];
		field.tick( dt );
		t.advance( dt, field );

	};
	for ( let i = 0; i < 1200; i ++ ) advance();
	assert.ok( t.requestDock( site.summit, 3 ) );
	for ( let i = 0; i < 1800; i ++ ) advance();
	assert.equal( print( t.snapshot() ), '348389eda0caa921', 'the 20 chairs, their swing and the docking must match the allocating code exactly' );
	// 280,880 heap bytes a frame in the baseline; about 16,000 after. Measured by the sampling profiler and attributed to
	// Transport.js: the used-heap difference (bytesPerFrame) read 158,464 B once under a parallel npm test while it
	// read under 32,768 alone twice, because other work on the machine shifts when V8 collects
	const bytes = await sampledBytesPerFrame( () => t.advance( 1 / 60, field ), 'src/chairlift/Transport.js', 4000 );
	assert.ok( bytes < 32768, `one 60 Hz transport frame (2 substeps x 20 chairs) allocated ${ bytes.toFixed( 0 ) } bytes in Transport.js` );

} );

test( 'Aviation carrier: the hull water points and deck velocities answer into the caller arrays, bit for bit as the allocating maths', async () => {

	const { CarrierPhysics } = await import( '../src/aviation/CarrierPhysics.js' );
	const { add, sub, cross, rotate, poseQ } = await import( '../src/aviation/Math.js' );
	const c = new CarrierPhysics();
	// heeled 2 degrees, trimmed 1 degree, yawing and heaving, so every term of rotate() and the cross product is live
	c.quaternion = poseQ( 1.3, 0.017, 0.035 );
	c.omega = [ 0.012, - 0.021, 0.006 ]; // rad/s
	c.velocity = [ 1.2, 0.1, - 0.4 ]; // m/s
	c.position = [ 820.25, - 0.37, - 939.5 ]; // m
	const point = [ 0, 0, 0 ], speed = [ 0, 0, 0 ];
	for ( const local of c.samples ) {

		assert.deepEqual( c.world( local, point ), add( c.position, rotate( c.quaternion, local ) ), `hull sample ${ local } lands where the allocating world() put it` );
		const deck = add( c.velocity, cross( rotate( c.quaternion, c.omega ), sub( point, c.position ) ) );
		assert.deepEqual( c.velocityAt( point, speed ), deck, `deck velocity at ${ point } matches the allocating velocityAt()` );

	}
	// Aviation.queueQueries asks the 10 hull points every frame and CarrierPhysics.step every 1/120 s step: rotate()
	// built 8 arrays per point (L6 profile, aviation carrier)
	const bytes = await sampledBytesPerFrame( () => {

		for ( let i = 0; i < c.samples.length; i ++ ) c.velocityAt( c.world( c.samples[ i ], point ), speed );

	}, 'src/aviation/CarrierPhysics.js', 4000 );
	assert.ok( bytes < 16, `10 hull points and their deck velocities allocated ${ bytes.toFixed( 0 ) } bytes in CarrierPhysics.js` );

} );

test( 'Wind farm: a frame allocates no wake snapshot and every rotor turns bit for bit as before', async () => {

	const heights = { heightAt: () => 10 }, field = new DisasterField( heights.heightAt ), ambient = { x: 8, z: 0 };
	field.ambient = () => ambient;
	const app = { scene: new Group(), colliders: new Colliders(), terrainData: heights, rally: { refreshIslandColliders() {} },
		disasters: { paused: false, field, registerExternal: () => () => {} } };
	const farm = await new WindFarm( app ).init( { panel: false } );
	for ( let i = 0; i < 2400; i ++ ) farm.update( 0.05 );
	const state = farm.turbines.map( t => [ t.angle, t.yaw, t.pitch, t.wakeFactor, t.deflectionX, t.deflectionZ ] );
	assert.equal( print( { state, sources: farm.wakeSources, bounds: farm.airBounds } ), '3c48317751bbeed2', 'rotors, wake sources and wake bounds must match the allocating code exactly' );
	const bytes = bytesPerFrame( () => farm.update( 1 / 60 ) );
	// 106,648-327,264 bytes a frame in the baseline (JIT state); about 23,000 after, mostly outside the farm loop.
	assert.ok( bytes < 49152, `one wind farm frame (3 turbines) left ${ bytes } heap bytes` );

} );

// Per-frame allocation checks: the shark obstacle list, the jetski lamp arcs and the people CPU peak, each a per-frame call.
test( 'Sharks: the per-frame obstacle list allocates nothing and lists the same craft, ferry and swimmer as before', () => {

	const body = ( x, z, vx, vz ) => ( { position: new Vector3( x, 0.2, z ), velocity: new Vector3( vx, 0, vz ) } );
	const ship = { velocity: new Vector3( 3, 0, - 1 ), toWorld( local, out = new Vector3() ) { return out.set( local.x * 0.8 + 400, local.y, local.z * 0.6 - local.x * 0.8 - 250 ); } };
	// the carrier answers into its own arrays here: CarrierPhysics allocates its own (aviation, not this list)
	const cw = [ 0, 0, 0 ], cv = [ 0, 0, 0 ];
	const carrier = {
		world( l ) { cw[ 0 ] = 900 + l[ 2 ] * 0.1; cw[ 1 ] = l[ 1 ] + 0.5; cw[ 2 ] = - 300 + l[ 2 ]; return cw; },
		velocityAt( p ) { cv[ 0 ] = 0.1 * p[ 2 ]; cv[ 1 ] = 0; cv[ 2 ] = 5; return cv; },
	};
	const app = { boatCtl: body( 10, 20, 1, 2 ), jetskis: { riding: true, ctl: body( - 30, 40, 4, - 1 ) }, ferry: { ship }, aviation: { carrier },
		player: { mode: 'swim', position: new Vector3( 5, - 0.6, 7 ) } };
	const sharks = Object.create( Sharks.prototype );
	sharks.app = app;
	const bytes = bytesPerFrame( () => sharks.obstacles() );
	assert.equal( print( sharks.obstacles() ), '20a72af375eeb1ae', 'boat, jetski, 5 ferry stations, 9 carrier sections and the swimmer, as the allocating code listed them' );
	// 9,136 bytes a call before the fix (a fresh list, an object per obstacle, a Vector3 per ferry station)
	assert.ok( bytes < 512, `one shark obstacle list left ${ bytes } heap bytes` );

} );

// Bytes a frame allocated under functions of `file`, by V8's sampling heap profiler, counting objects a scavenge
// already freed. bytesPerFrame cannot see a few hundred bytes under its noise; this attributes each allocation.
async function sampledBytesPerFrame( frame, file, frames = 20000 ) {

	for ( let i = 0; i < 2000; i ++ ) frame( i );
	const session = new Session();
	session.connect();
	await session.post( 'HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true } );
	for ( let i = 0; i < frames; i ++ ) frame( i );
	const { profile } = await session.post( 'HeapProfiler.stopSampling' );
	session.disconnect();
	let total = 0;
	const walk = ( node, inside ) => {

		const here = inside || node.callFrame.url.endsWith( file );
		if ( here ) total += node.selfSize;
		for ( const child of node.children ) walk( child, here );

	};
	walk( profile.head, false );
	return total / frames;

}

test( 'Jetski lamps: a night frame allocates nothing and every lens, halo and glare lights as before', async () => {

	globalThis.innerHeight ??= 1267;
	G.night.value = 1;
	const lights = new JetskiLights( null, null ), ski = { group: new Mesh( new BoxGeometry( 3, 1, 1.2 ) ) };
	const camera = new PerspectiveCamera( 60, 2, 0.1, 1000 );
	camera.position.set( 12, 3, - 20 );
	lights.update( ski, true, camera );
	const snap = () => [ 'port', 'star', 'stern', 'head' ].map( k => { const l = lights.lamps[ k ]; return [ k, l.lens.visible, l.halo.visible, l.glare.visible,
		l.halo.scale.x, l.glare.scale.x, l.lens.material.emissive.r, l.halo.material.emissive.g, l.glare.material.emissive.b ]; } );
	let t = 0;
	// the camera circles the ski at 40 m, so each arc lights and fades in turn
	const frame = () => { t += 0.05; camera.position.set( 40 * Math.sin( t ), 3, 40 * Math.cos( t ) ); lights.update( ski, true, camera ); };
	const prints = [];
	for ( let i = 0; i < 130; i ++ ) { frame(); if ( i % 13 === 0 ) prints.push( snap() ); }
	assert.equal( print( prints ), '55276291afcfb4b3', 'the lamps must light exactly as the allocating code lit them' );
	// about 600 sampled bytes a frame before the fix (Object.entries of the lamps and its pairs, an arcs object, an inArc
	// closure); about 70 after, the heap numbers of a few double fields
	const bytes = await sampledBytesPerFrame( frame, 'src/jetski/JetskiLights.js' );
	assert.ok( bytes < 160, `one jetski lamp frame allocated ${ bytes.toFixed( 0 ) } bytes in JetskiLights.js` );

} );

test( 'People CPU meter: the 2 s peak allocates nothing and matches the max of the last 120 frames', () => {

	const c = cpuMeter(), seen = [];
	for ( let i = 0; i < 500; i ++ ) {

		const ms = ( i * 7919 % 1000 ) / 100 + ( i > 300 ? 5 : 0 );
		seen.push( ms );
		trackPeak( c, ms );
		assert.equal( c.peak, Math.max( ...seen.slice( - 120 ) ), `peak after ${ i + 1 } frames` );

	}
	let k = 0;
	const bytes = bytesPerFrame( () => trackPeak( c, ( k ++ * 7919 % 1000 ) / 100 ) );
	// 2,944 bytes a frame before the fix (push, shift and Math.max( ...window ))
	assert.ok( bytes < 512, `one people CPU sample left ${ bytes } heap bytes` );

} );
