// Per-frame disaster bookkeeping must not allocate. At t 4 s of the default tornado 305 bodies are
// awake (L5 diagnosis 2026-10-05) and two loops touch every one of them every frame:
// - Disasters.loads spread each body record twice ({...record,supported} then {...opts,dt}), built
//   a sample, a context literal and a growing array, then copied it into a new Float32Array;
// - Bodies.sync built two or three Vector3 per vehicle or part-built body to find its base.
// That garbage is the young-generation churn behind the frame hitches. The tests run the real
// functions for many frames and count minor (scavenge) collections inside the loop: with nothing
// allocated per body there is nothing to scavenge. They also pin the output, so the rewrite is
// proved to send the same forces and draw the same poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceObserver, performance, constants } from 'node:perf_hooks';
import { Vector3, Quaternion, Matrix4 } from '../src/engine/index.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterBodies } from '../src/disasters/Bodies.js';

const BODIES = 305;

async function minorCollections( run ) {

	const entries = [];
	const observer = new PerformanceObserver( ( list ) => { for ( const e of list.getEntries() ) entries.push( e ); } );
	observer.observe( { entryTypes: [ 'gc' ] } );
	const t0 = performance.now();
	run();
	const t1 = performance.now();
	await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
	observer.disconnect();
	return entries.filter( ( e ) => e.startTime >= t0 && e.startTime <= t1 && e.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR ).length;

}

function loadsOwner() {

	const records = new Map();
	const motion = new Float32Array( 7 * ( BODIES + 1 ) );
	motion[ 0 ] = - 1;
	for ( let k = 0; k < BODIES; k ++ ) {

		const id = 100000 + k;
		// Masses are not whole numbers, as in the game, so a boxed store would show. A structure body record with the fields Structures.fractureLegacy and fracture give it.
		records.set( id, { id, kind: 'structure', name: 'House ' + k, origin: new Vector3(), position: new Vector3(), quaternion: new Quaternion(),
			spans: [], half: new Vector3( 2, 1.5, 3 ), mass: 400.5 + k, area: 18, volume: 2, height: 3, foundationCut: 0, material: 'timber',
			memberIndex: k, joints: [], anchor: null, damage: 0, scatterIndex: k, anchorFactor: 1, dragCoefficient: 1.1 } );
		motion.set( [ id, k, 2, - k, 4 + k % 5, 0, 1 ], 7 * ( k + 1 ) );

	}

	const supportedIds = new Float64Array( [ 100000, 100001 ] );
	const last = { loads: new Float32Array( 7 * ( BODIES + 1 ) ), n: 0 };
	const seen = new Array( BODIES + 1 );
	const self = {
		restored: false, peakForce: 0, rawPeakForce: 0, limited: 0, touched: new Set(),
		bodyOptions: Disasters.prototype.bodyOptions,
		structures: { bodies: records }, bodies: { bodies: new Map() },
		field: {
			// Constant 2 m/s^2 along +x and the dt/supported the loop passed; writes only into out.
			acceleration( p, v, opts, out ) {

				seen[ ( p.x | 0 ) + ( opts.mass === 1500 ? 0 : 1 ) ] = opts;
				out.ax = 2; out.ay = 0; out.az = opts.supported ? 1 : 0; out.wx = 0; out.wy = 0; out.wz = 0; out.ux = 0; out.uz = 0;
				out.rawAcceleration = 2; out.rawDragForce = opts.dt * 1000; out.limited = false;
				return out;

			},
		},
		app: { rally: { profile: { mass: 1500 }, state: [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 ], physics: {
			disaster_supported: () => supportedIds,
			disaster_motion: () => motion,
			set_fluid_velocity() {},
			set_disaster_loads( a ) { last.loads.set( a ); last.n = a.length; },
		} } },
	};
	return { self, records, last, seen };

}

test( 'Disaster loads for 305 bodies stay under 20 minor collections in 1500 frames (the spread path ran about 80) and send the same forces', async () => {

	const { self, records, last, seen } = loadsOwner();
	const loads = Disasters.prototype.loads;
	// Warm up past the baseline JIT, which boxes every double it computes: the game runs this every frame.
	for ( let f = 0; f < 400; f ++ ) loads.call( self, 1 / 60 );
	const firstOptions = seen.slice();
	// Output: id then force (mass x acceleration) and zero torque, the supported flag and dt reach the field.
	assert.equal( last.n, 7 * ( BODIES + 1 ) );
	assert.deepEqual( Array.from( last.loads.subarray( 0, 7 ) ), [ - 1, 3000, 0, 1500, 0, 0, 0 ], 'the car (supported, 1500 kg)' );
	assert.deepEqual( Array.from( last.loads.subarray( 7, 14 ) ), [ 100000, 801, 0, 400.5, 0, 0, 0 ], 'a supported body gets the supported acceleration' );
	assert.deepEqual( Array.from( last.loads.subarray( 21, 28 ) ), [ 100002, 805, 0, 0, 0, 0, 0 ] );
	assert.equal( self.rawPeakForce, Math.hypot( 3000, 1500 ), 'raw peak force is the car: 1500 kg x hypot(2, 1) m/s^2' );

	const collections = await minorCollections( () => { for ( let f = 0; f < 1500; f ++ ) loads.call( self, 1 / 60 ); } );
	// Residual: V8's Math.hypot builtin allocates its argument array, three calls per body, and
	// swapping it for a square root changes the last bit of the forces. 13 to 16 measured; 79 to 81 before.
	assert.ok( collections <= 20, `1500 frames of loads for ${ BODIES } bodies ran ${ collections } minor collections` );
	assert.ok( seen.every( ( o, i ) => o === firstOptions[ i ] ), 'each body keeps one options object across frames' );

	// The field reads the live record: a body that loses mass mid-event gets the new force next frame.
	records.get( 100002 ).mass = 50;
	loads.call( self, 1 / 30 );
	assert.equal( last.loads[ 22 ], 100, 'force after the record changed mass' );
	assert.equal( seen[ 3 ].dt, 1 / 30, 'the frame dt reaches the field' );

} );

test( 'Bodies.sync for 305 vehicles and part-built bodies causes no minor collections and draws the same poses', async () => {

	const bodies = new Map();
	const drawn = new Matrix4();
	const poses = new Float32Array( 10 * BODIES );
	for ( let k = 0; k < BODIES; k ++ ) {

		const q = new Quaternion().setFromAxisAngle( new Vector3( 1, 2, 3 ).normalize(), k * .01 );
		poses.set( [ k, k * 3, 1 + k * .01, - k, q.x, q.y, q.z, q.w, 0, 0 ], 10 * k );
		const parts = k % 2 ? [ { i: k, mesh: { instanceMatrix: {}, setMatrixAt( i, m ) { if ( i === 7 ) drawn.copy( m ); } } } ] : null;
		bodies.set( k, { kind: 'vehicle', half: new Vector3( 1, .85, 2.2 ), position: new Vector3(), quaternion: new Quaternion(),
			root: k % 2 ? null : { position: new Vector3(), quaternion: new Quaternion() }, parts } );

	}

	const self = { bodies };
	const sync = DisasterBodies.prototype.sync;
	for ( let f = 0; f < 200; f ++ ) sync.call( self, poses );
	// Output: the drawn base is the body centre less half its height along the body's own up.
	for ( const k of [ 6, 7 ] ) {

		const b = bodies.get( k );
		const base = new Vector3( 0, - b.half.y, 0 ).applyQuaternion( b.quaternion ).add( new Vector3().fromArray( poses, 10 * k + 1 ) );
		const at = k === 6 ? b.root.position : new Vector3().setFromMatrixPosition( drawn );
		assert.ok( at.distanceTo( base ) < 1e-6, `body ${ k } drawn at ${ at.toArray() } want ${ base.toArray() }` );

	}

	const collections = await minorCollections( () => { for ( let f = 0; f < 15000; f ++ ) sync.call( self, poses ); } );
	assert.ok( collections <= 1, `15000 frames of sync for ${ BODIES } bodies ran ${ collections } minor collections` );


} );
