import test from 'node:test';
import assert from 'node:assert/strict';
import { SharkBrain, SHARK } from '../src/world/marine/SharkBrain.js';
import { Sharks } from '../src/world/marine/Sharks.js';
import { G } from '../src/engine/render/Frame.js';
import { SharkBite, JAW, BITE_TEETH, segmentSphereTime } from '../src/world/marine/SharkBite.js';
import { readFileSync } from 'node:fs';
import { CarrierPhysics } from '../src/aviation/CarrierPhysics.js';

const flat = { heightAt: () => - 20 };
const straight = { terrain: flat, count: 1, route: [ { x: 0, z: 1e12 } ], initial: [ { x: 0, y: - 2.5, z: 0, yaw: 0 } ] };
const run = ( brain, seconds, context ) => { for ( let i = 0; i < seconds * 60; i ++ ) brain.update( 1 / 60, context ); return brain.state(); };
const near = ( actual, expected, tolerance, label ) => assert.ok( Math.abs( actual - expected ) < tolerance, `${ label }: ${ actual } vs ${ expected } (±${ tolerance })` );

test( 'constant current follows the independent closed-form entrainment displacement', () => {
	const still = new SharkBrain( straight );
	const flowing = new SharkBrain( { ...straight, waterAt: () => ( { ux: 1.2 } ) } );
	const t = 5, tau = 0.8, u = 1.2;
	const a = run( still, t ).members[ 0 ], b = run( flowing, t ).members[ 0 ];
	// dV/dt=(u-V)/tau with V(0)=0: x=u[t-tau(1-exp(-t/tau))].
	near( b.x - a.x, u * ( t - tau * ( 1 - Math.exp( - t / tau ) ) ), 1e-8, 'current displacement' );
	near( b.current.x, u * ( 1 - Math.exp( - t / tau ) ), 1e-10, 'water entrainment velocity' );
	near( a.speed, b.speed, 1e-12, 'propulsion independent of current' );
} );

test( 'quadratic drag converges to the specified relative-water cruise speed with bounded acceleration', () => {
	const brain = new SharkBrain( { ...straight, initial: [ { ...straight.initial[ 0 ], speed: 0 } ] } );
	let previous = 0;
	for ( let i = 0; i < 1800; i ++ ) {
		brain.update( 1 / 60 );
		const m = brain.state().members[ 0 ];
		assert.ok( Math.abs( m.speed - previous ) <= 1.1 / 60 + 1e-10 ); previous = m.speed;
	}
	const m = brain.state().members[ 0 ];
	near( m.speed, 0.85, 1e-6, 'terminal speed' );
	near( m.thrust, m.drag, 1e-5, 'steady thrust balances drag' );
} );

test( 'a right-angle route change respects yaw speed and angular acceleration limits', () => {
	const brain = new SharkBrain( { ...straight, route: [ { x: 1e6, z: 0 } ] } );
	let previous = brain.state().members[ 0 ];
	for ( let i = 0; i < 300; i ++ ) {
		brain.update( 1 / 60 ); const m = brain.state().members[ 0 ];
		assert.ok( Math.abs( m.yawRate ) <= 0.8 + 1e-10 );
		assert.ok( Math.abs( m.yawRate - previous.yawRate ) <= 1.6 / 60 + 1e-10 );
		assert.ok( Math.abs( m.yaw - previous.yaw ) <= 0.8 / 60 + 1e-10 );
		assert.ok( Math.abs( m.bank ) < 0.28 ); previous = m;
	}
	assert.ok( previous.x > 2 && previous.yaw > 1.4 );
} );

test( 'a submerged shark follows gentle variable sea level with seabed and surface clearance', () => {
	const brain = new SharkBrain( { ...straight, terrain: { heightAt: () => - 5 }, waterAt: ( x, z, t ) => ( { height: 0.45 * Math.sin( t * 0.15 ) } ) } );
	for ( let i = 0; i < 600 * 60; i ++ ) {
		brain.update( 1 / 60 ); const m = brain.members[ 0 ];
		assert.ok( m.depth >= 0.5 - 1e-6, `surface clearance ${ m.depth }` );
		assert.ok( m.floorClearance >= 0.65 - 1e-6, `floor clearance ${ m.floorClearance }` );
		assert.ok( Math.abs( m.vy ) <= 0.75 + 1e-10 );
	}
} );

test( 'shore avoidance steers before contact and swept motion never tunnels through a cliff', () => {
	const brain = new SharkBrain( { ...straight, terrain: { heightAt: ( x, z ) => z < 9 ? - 6 : 3 } } );
	let previous = brain.state().members[ 0 ], min = Infinity, maxZ = 0;
	for ( let i = 0; i < 80 * 60; i ++ ) {
		brain.update( 1 / 60 ); const m = brain.state().members[ 0 ];
		min = Math.min( min, m.floorClearance ); maxZ = Math.max( maxZ, m.z );
		assert.ok( Math.hypot( m.x - previous.x, m.y - previous.y, m.z - previous.z ) < 0.04, 'no relocation snap' );
		previous = m;
	}
	assert.ok( min >= 0.65 ); assert.ok( maxZ < 8.5 );
	assert.ok( Math.abs( previous.x ) > 1, 'turns away from land' );
} );

test( 'a hull on the route is avoided without a teleport or penetration', () => {
	const brain = new SharkBrain( straight );
	const obstacles = [ { x: 0, z: 8, radius: 2, bottom: - 4, top: 1, vx: 0, vz: 0 } ];
	let separation = Infinity, lateral = 0;
	for ( let i = 0; i < 30 * 60; i ++ ) {
		brain.update( 1 / 60, { obstacles } ); const m = brain.members[ 0 ];
		separation = Math.min( separation, Math.hypot( m.x, m.z - 8 ) ); lateral = Math.max( lateral, Math.abs( m.x ) );
	}
	assert.ok( separation >= 2.45, `clearance ${ separation }` ); assert.ok( lateral > 2 );
} );

test( 'intense water disturbance causes finite bounded acceleration flee, then recovery', () => {
	let intense = true;
	const brain = new SharkBrain( { ...straight, waterAt: () => intense ? { ux: 3, disturbance: 1 } : {} } );
	let previous = brain.state().members[ 0 ];
	for ( let i = 0; i < 240; i ++ ) {
		brain.update( 1 / 60 ); const m = brain.state().members[ 0 ];
		assert.equal( m.mode, 'flee' ); assert.ok( m.speed <= 2.4 );
		assert.ok( Math.abs( m.speed - previous.speed ) <= 1.1 / 60 + 1e-10 ); previous = m;
	}
	assert.ok( previous.speed > 2 ); assert.ok( previous.x > 5 );
	intense = false;
	assert.equal( run( brain, 12 ).members[ 0 ].mode, 'cruise' );
} );

test( 'fixed stepping is repeatable across render cadence, pause and seed reset', () => {
	const a = new SharkBrain( { terrain: flat, seed: 18 } ), b = new SharkBrain( { terrain: flat, seed: 18 } );
	for ( let i = 0; i < 900; i ++ ) a.update( 1 / 30 );
	for ( let i = 0; i < 4320; i ++ ) b.update( 1 / 144 );
	assert.deepEqual( a.state().members, b.state().members );
	const expected = a.state();
	a.update( 10, { paused: true } ); assert.deepEqual( a.state(), expected );
	a.reset(); run( a, 30 ); assert.deepEqual( a.state().members, expected.members );
	const copy = a.state(); copy.members[ 0 ].x = NaN;
	assert.ok( Number.isFinite( a.state().members[ 0 ].x ), 'telemetry is a snapshot' );
} );

test( 'one simulated hour stays finite, populated and within its ordinary reef habitat', () => {
	const brain = new SharkBrain( { terrain: flat, seed: 819, waterAt: ( x, z, t ) => ( { height: Math.sin( t * 0.1 ) * 0.2, ux: Math.sin( t * 0.09 ) * 0.2, uz: 0.1 } ) } );
	for ( let i = 0; i < 3600 * 60; i ++ ) {
		brain.update( 1 / 60 );
		if ( i % 600 === 0 ) for ( const m of brain.members ) {
			for ( const [ key, value ] of Object.entries( m ) ) if ( typeof value === 'number' ) assert.ok( Number.isFinite( value ), key );
			assert.ok( Math.hypot( m.x - m.spawnX, m.z - m.spawnZ ) < 55 );
			assert.ok( m.depth > 0.5 && m.floorClearance > 0.65 );
		}
	}
	assert.equal( brain.state().count, 3 );
	assert.equal( SHARK.length, 1.5 );
} );

test('the real carrier pose becomes a finite long hull obstacle with angular point velocity',()=>{
 const carrier=new CarrierPhysics({position:[200,3,40],yaw:0});
 carrier.velocity=[1,0,-2];carrier.omega=[0,.01,0];
 const obstacles=Sharks.prototype.obstacles.call({app:{aviation:{carrier}}});
 assert.ok(obstacles.length>=7,'carrier uses several overlapping hull sections');
 assert.ok(obstacles.every(o=>[o.x,o.z,o.radius,o.bottom,o.top,o.vx,o.vz].every(Number.isFinite)),'carrier array pose is adapted');
 assert.ok(Math.max(...obstacles.map(o=>o.z))-Math.min(...obstacles.map(o=>o.z))>=270,'fore and aft hull are protected');
 assert.ok(Math.max(...obstacles.map(o=>o.vx))-Math.min(...obstacles.map(o=>o.vx))>2.5,'turning carrier point velocities differ');
});


test( 'Restore ignores GPU water issued before reset instead of spawning sharks in the old crest', () => {
 const oldTime = G.time.value;
 try {
  G.time.value = 100;
  let anomaly = 3;
  const query = { allocate: () => 0, cpuValid: true, resultTime: 90,
   resultInputs: new Float32Array( [ - 78, 72, 0, 0 ] ), get: () => ( { height: 7 } ) };
  const sharks = new Sharks( { scene: {}, terrain: flat, count: 1, query, vessels: { disasters: { field: { sample: () => ( { height: anomaly } ) } } } } );
  assert.equal( sharks.state().members[ 0 ].waterHeight, 7, 'combined query height is not added to the disaster height twice' );
  anomaly = 0;
  const restored = sharks.reset().members[ 0 ];
  assert.equal( restored.waterHeight, 0 ); assert.ok( restored.y < - 0.5 );
  query.resultTime = 101;
  assert.equal( sharks.waterAt( - 78, 72, 0 ).height, 7, 'fresh post-reset queries resume' );
 } finally { G.time.value = oldTime; }
} );


test( 'a swept tooth detects the independently calculated first sphere contact and misses a clear path', () => {
 const time = segmentSphereTime( { x: -1, y: 0.05, z: 0 }, { x: 1, y: 0.05, z: 0 }, 0.1 );
 near( time, ( 1 - Math.sqrt( 0.1 ** 2 - 0.05 ** 2 ) ) / 2, 1e-12, 'first contact time' );
 assert.equal( segmentSphereTime( { x: -1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 }, 0.1 ), null );
 assert.equal( segmentSphereTime( { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.1 ), 0 );
} );

test( 'the actual swim controller opens, bites, releases and repeats with joint limits and equal opposite impulse', () => {
 const brain = new SharkBrain( straight );
 for ( let cycle = 1; cycle <= 2; cycle ++ ) {
  assert.equal( brain.beginBite(), true );
  const phases = new Set(); let peak = 0, previous = 0, contact;
  for ( let i = 0; i < 300; i ++ ) {
   const oldContacts = brain.bite.contactCount;
   brain.update( 1 / 60 ); const m = brain.members[ 0 ]; phases.add( m.bitePhase ); peak = Math.max( peak, m.jawAngle );
   assert.ok( m.jawAngle >= 0 && m.jawAngle <= 0.65 );
   assert.ok( Math.abs( m.jawVelocity ) <= 2.2 + 1e-12 );
   assert.ok( Math.abs( m.jawAngle - previous ) <= 2.2 / 60 + 1e-8 ); previous = m.jawAngle;
   if ( brain.bite.contactCount > oldContacts ) {
    contact = brain.bite.lastContact;
    const magnitude = Math.hypot( contact.impulse.x, contact.impulse.y, contact.impulse.z );
    const expected = Math.min( 0.25, 1.2 * contact.relativeSpeed / ( 1 / contact.targetMass + 1 / 10 ) );
    near( magnitude, expected, 1e-12, 'two-mass contact impulse' );
    for ( const key of [ 'x', 'y', 'z' ] ) near( contact.impulse[ key ] + contact.bodyImpulse[ key ], 0, 1e-12, 'pair momentum' );
    assert.ok( Math.hypot( ...Object.values( brain.bite.target.velocity ) ) > 0.01 );
   }
  }
  assert.ok( peak > 0.60 ); assert.ok( contact );
  assert.ok( [ 'opening', 'open', 'closing', 'grip', 'release', 'recover', 'idle' ].every( p => phases.has( p ) ) );
  assert.equal( brain.bite.contactCount, cycle ); assert.equal( brain.bite.phase, 'idle' ); assert.equal( brain.members[ 0 ].jawAngle, 0 );
 }
 brain.reset(); assert.equal( brain.bite.contactCount, 0 ); assert.equal( brain.bite.cycle, 0 ); assert.equal( brain.bite.target.visible, false );
 assert.equal( brain.members[ 0 ].jawAngle, 0 );
} );

test( 'a target near the mouth but clear of the teeth is a miss without invented contact impulse', () => {
 const bite = new SharkBite(), pose = { x: 0, y: 0, z: 0, yaw: 0, length: 1.5 };
 bite.start( pose, { position: { x: 0.076, y: -0.073, z: 0.454 }, radius: 0.012 } );
 const phases = new Set();
 for ( let i = 0; i < 400; i ++ ) { bite.advanceTarget( 1 / 60, {}, -20 ); bite.step( 1 / 60, pose ); phases.add( bite.phase ); }
 assert.ok( phases.has( 'closing' ), 'a closing attempt actually occurred' );
 assert.equal( bite.result, 'miss' ); assert.equal( bite.contactCount, 0 ); assert.equal( bite.lastContact, null );
 assert.deepEqual( bite.target.velocity, { x: 0, y: 0, z: 0 } );
} );

test( 'the shipped jaw weights, hinge and tooth tips agree with the physical contact rig in every LOD', () => {
 const manifest = JSON.parse( readFileSync( new URL( '../public/models/shark/blacktip.json', import.meta.url ) ) );
 const bytes = readFileSync( new URL( '../public/models/shark/blacktip.bin', import.meta.url ) );
 assert.deepEqual( manifest.jaw.pivot, [ JAW.pivot.x, JAW.pivot.y, JAW.pivot.z ] ); assert.equal( manifest.jaw.maxAngle, JAW.maxAngle );
 assert.equal( manifest.jaw.lowerToothTips.length, BITE_TEETH.length );
 BITE_TEETH.forEach( ( tooth, i ) => [ 'x', 'y', 'z' ].forEach( ( key, j ) => near( tooth[ key ], manifest.jaw.lowerToothTips[ i ][ j ], 1e-10, 'tooth centre' ) ) );
 for ( const lod of manifest.levels ) {
  const counts = { '-1': 0, '0': 0, '1': 0 };
  for ( let i = 0; i < lod.vertices; i ++ ) { const weight = bytes.readFloatLE( lod.uv + i * 8 + 4 ); assert.ok( weight in counts ); counts[ weight ] ++; }
  assert.ok( counts[ 1 ] > 200 && counts[ -1 ] > 100 && counts[ 0 ] > 500, lod.name );
 }
} );


test( 'a floating bite target follows independent quadratic-drag velocity and displacement in shared current', () => {
 const bite = new SharkBite(), pose = { x: 0, y: -2, z: 0, yaw: 0, length: 1.5 };
 bite.start( pose );
 const u = 1.2, seconds = 5, radius = 0.036;
 // Neutral sphere mass = rho 4/3 pi r^3; drag/mass = 3 Cd/(8r) |v-u|(v-u).
 const k = 3 * 0.47 / ( 8 * radius );
 for ( let i = 0; i < seconds * 60; i ++ ) bite.advanceTarget( 1 / 60, { ux: u, uz: 0 }, -20 );
 near( bite.target.velocity.x, u - u / ( 1 + k * u * seconds ), 1e-12, 'target entrainment velocity' );
 near( bite.target.position.x, u * seconds - Math.log( 1 + k * u * seconds ) / k, 1e-12, 'target current displacement' );
 assert.equal( bite.contactCount, 0 ); assert.equal( bite.target.velocity.y, 0 );
} );

test( 'an active bite freezes on pause and strong shared-water disturbance cancels it without a contact', () => {
 let disturbed = false;
 const brain = new SharkBrain( { ...straight, waterAt: () => disturbed ? { ux: 3, disturbance: 1 } : {} } );
 assert.equal( brain.beginBite(), true ); run( brain, 0.5 );
 const frozen = brain.state();
 assert.ok( frozen.bite.angle > 0.4 ); assert.equal( frozen.bite.contactCount, 0 );
 brain.update( 10, { paused: true } ); assert.deepEqual( brain.state(), frozen );
 disturbed = true; run( brain, 2 );
 const cancelled = brain.state();
 assert.equal( cancelled.bite.result, 'cancelled' ); assert.equal( cancelled.bite.phase, 'idle' );
 assert.equal( cancelled.bite.contactCount, 0 ); assert.equal( cancelled.bite.lastContact, null );
 assert.equal( cancelled.members[ 0 ].mode, 'flee' ); assert.equal( cancelled.members[ 0 ].jawAngle, 0 );
} );
