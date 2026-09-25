import assert from 'node:assert/strict';
import { Vector3, Quaternion, Euler, PerspectiveCamera } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { prismCollider, transformCollider, resolveSolidMotion } from '../src/world/SolidCollision.js';
import { BoatCollision } from '../src/player/BoatCollision.js';
import { BoatModel } from '../src/world/BoatModel.js';
import { HullLines } from '../src/world/boat/HullLines.js';
import { Player } from '../src/player/Player.js';
import { Builder } from '../src/world/village/GeoBuilder.js';
import { buildBoathouse, buildMarketStall, buildHouse } from '../src/world/village/Buildings.js';
import { Rand } from '../src/world/Props.js';
import { mulberry32 } from '../src/util/Noise.js';

const V = ( x, y, z ) => new Vector3( x, y, z );
const near = ( a, b, eps = 0.002 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } != ${ b }` );
const roof = prismCollider( [ V( - 2, 2.2, - 2 ), V( 2, 2.2, - 2 ), V( 2, 2.2, 2 ), V( - 2, 2.2, 2 ) ], 0.1 );
const move = ( solids, from, to, velocity = to.clone().sub( from ), height = 1.75 ) => {

	const grounded = resolveSolidMotion( solids, from, to, 0.3, height, velocity );
	return { p: to, velocity, grounded };

};

// Jumping through even a thin slab in a single frame must hit its underside.
{
	const { p, velocity, grounded } = move( [ roof ], V( 0, 0, 0 ), V( 0, 3, 0 ), V( 0, 4.6, 0 ) );
	near( p.y + 1.75, 2.1 ); near( p.x, 0 ); near( p.z, 0 );
	near( velocity.y, 0 ); assert.equal( grounded, false );
}
// Open space below the roof stays traversable; falling lands on its top.
{
	const { p } = move( [ roof ], V( - 3, 0, 0 ), V( 3, 0, 0 ) ); near( p.x, 3 ); near( p.y, 0 );
	const landing = move( [ roof ], V( 0, 4, 0 ), V( 0, 0, 0 ) );
	near( landing.p.y, 2.2 ); assert.ok( landing.grounded ); near( landing.velocity.y, 0 );
	const jump = move( [ roof ], landing.p, landing.p.clone().add( V( 0, 0.2, 0 ) ) );
	assert.ok( jump.p.y > 2.3 );
}
// A pitched, yaw-rotated canopy has a pitched underside, not a solid box below it.
{
	const slope = prismCollider( [ V( - 2, 2.4, - 2 ), V( 2, 2.4, - 2 ), V( 2, 3.2, 2 ), V( - 2, 3.2, 2 ) ], 0.08 );
	const q = new Quaternion().setFromAxisAngle( V( 0, 1, 0 ), 0.7 );
	const origin = V( 10, 0, - 5 ), solid = transformCollider( slope, origin, q );
	const { p } = move( [ solid ], origin.clone(), origin.clone().add( V( 0, 2, 0 ) ) );
	const center = p.clone().add( V( 0, 1.75 / 2, 0 ) );
	const underside = solid.planes[ 1 ];
	const support = 0.3 * Math.hypot( underside.n.x, underside.n.z ) + 1.75 / 2 * Math.abs( underside.n.y );
	assert.ok( underside.n.dot( center ) >= underside.d + support - 0.001 );
	const clear = move( [ solid ], V( 7, 0, - 5 ), V( 13, 0, - 5 ) ); near( clear.p.x, 13 );
}

const model = { lines: new HullLines() };
model.colliders = BoatModel.prototype._buildColliders.call( model );
const collision = new BoatCollision( model );
const boat = { model, position: V( 0, 0, 0 ), quaternion: new Quaternion(), speed: 0,
	toWorld( p, out ) { return out.copy( p ).applyQuaternion( this.quaternion ).add( this.position ); },
	getYaw() { return 0; },
};
// Walking/swimming cannot cross the hull, including yaw, pitch and roll.
for ( const angles of [ [ 0, 0, 0 ], [ 0, 1.2, 0 ], [ 0.12, 0.7, 0.2 ] ] ) {
	boat.quaternion.setFromEuler( new Euler( ...angles ) );
	boat.position.set( 8, 0, - 7 );
	const from = boat.toWorld( V( 3, - 0.1, - 2 ), new Vector3() );
	const to = boat.toWorld( V( - 3, - 0.1, - 2 ), new Vector3() );
	const solids = collision.worldSolids( boat, from, to );
	const { p } = move( solids, from, to, to.clone().sub( from ), 1 );
	const local = p.clone().sub( boat.position ).applyQuaternion( boat.quaternion.clone().invert() );
	assert.ok( local.x > 1.2, `crossed hull at ${ angles }: ${ local.x }` );
}
// Deep swimmers can pass below the hull; initial overlap is recovered.
{
	boat.position.set( 0, 0, 0 ); boat.quaternion.identity();
	const from = V( 3, - 3, - 2 ), to = V( - 3, - 3, - 2 );
	const solids = collision.worldSolids( boat, from, to );
	near( move( solids, from, to, V( - 1, 0, 0 ), 1 ).p.x, - 3 );
	const overlap = move( [ collision.hull ], V( 1.3, - 0.2, - 2 ), V( 1.3, - 0.2, - 2 ), V( 0, 0, 0 ), 1 );
	assert.ok( overlap.p.x > 1.5 );
}

function playerAt( colliders, boat = null ) {
	return new Player( { camera: new PerspectiveCamera(),
		input: { down: () => false, hit: () => false, consumeLook: () => ( { x: 0, y: 0 } ) },
		terrain: { heightAt: () => 0 }, colliders,
		query: { allocate: () => 0, setPoint: () => {}, cpuValid: false }, boat } );
}
// Exercise the actual walking and swimming controller, not just the geometry helper.
for ( const mode of [ 'walk', 'swim' ] ) {
	const player = playerAt( new Colliders(), boat );
	player.position.set( 3, 0, - 2 ); player.yaw = 0;
	player.input.down = key => key === 'KeyA';
	player.mode = mode; player.waterH = mode === 'swim' ? 0 : - 10; player.waterMean = - 10;
	player.grounded = true;
	for ( let i = 0; i < 180; i ++ ) player[ mode === 'walk' ? 'updateWalk' : 'updateSwim' ]( 1 / 60 );
	assert.ok( player.position.x > 1.5, `${ mode } crossed hull` );
}
{
	const world = new Colliders(); world.surfaces.push( roof );
	const player = playerAt( world ); player.position.set( 0, 0, 0 );
	player.waterH = - 10; player.waterMean = - 10; player.grounded = true;
	player.input.hit = key => key === 'Space';
	let highest = 0;
	for ( let i = 0; i < 90; i ++ ) { player.updateWalk( 1 / 60 ); highest = Math.max( highest, player.position.y ); }
	assert.ok( highest > 0.2 && highest + 1.75 <= 2.101, `head crossed roof: ${ highest }` );
}
// Cabin roof uses vertical collision while aboard, preserving the open deck.
{
	const player = playerAt( new Colliders(), boat );
	model.exitPoints = []; player.busy = true; player._ashoreT = 100;
	player.deckPos.set( 0, model.lines.deckY, - 0.55 );
	player.input.hit = key => key === 'Space';
	for ( let i = 0; i < 60; i ++ ) {
		player.updateDeck( 1 / 60 );
		assert.ok( player.deckPos.y + 1.75 <= 2.311 );
		near( player.deckPos.x, 0 ); near( player.deckPos.z, - 0.55 );
	}
}
console.log( 'collision geometry and player regressions passed' );

// Build the real procedural structures: the rendered roofs must register collision
// surfaces in world coordinates, including rotated overhangs outside the walls.
for ( const [ build, spec, minimum ] of [
	[ buildBoathouse, { x: 20, z: - 30, yaw: 0.6 }, 2 ],
	[ buildMarketStall, { x: 20, z: - 30, yaw: 0.6, w: 4, d: 2 }, 4 ],
	[ buildHouse, { x: 20, z: - 30, yaw: 0.6, w: 6, d: 5, roof: 'gable', porch: { depth: 2 }, wall: [ 1, 1, 1 ], trim: [ 1, 1, 1 ], accent: [ 1, 1, 1 ] }, 3 ],
] ) {
	const colliders = new Colliders(), B = new Builder();
	build( { B, colliders, terrain: { heightAt: () => 0 }, rand: new Rand( mulberry32( 42 ) ), lights: [], checks: [], inst: { add() {} } }, spec );
	assert.ok( colliders.surfaces.length >= minimum, `${ build.name }: missing roof colliders` );
	for ( const solid of colliders.surfaces ) {
		assert.ok( solid.vertices.every( v => Number.isFinite( v.x + v.y + v.z ) ) );
		const center = solid.vertices.reduce( ( a, b ) => a.add( b ), V( 0, 0, 0 ) ).divideScalar( solid.vertices.length );
		assert.ok( Math.abs( center.x - spec.x ) < 10 && Math.abs( center.z - spec.z ) < 10 );
		const result = move( [ solid ], V( center.x, center.y - 3, center.z ), V( center.x, center.y + 1, center.z ) );
		assert.ok( result.p.y < center.y - 1, `${ build.name }: jumped through roof` );
	}
}
console.log( 'procedural roof registration regressions passed' );

// The exterior hull must not interfere with the explicit boarding/helm modes.
{
	model.boardPoint = V( 0, model.lines.deckY, - 1.75 );
	const player = playerAt( new Colliders(), boat );
	player.position.set( 2, 0, - 1.75 );
	assert.ok( player.nearBoat() );
	player.input.hit = key => key === 'KeyE';
	player.update( 1 / 60 );
	assert.equal( player.mode, 'deck' );
	near( player.deckPos.x, 0 ); near( player.deckPos.z, - 1.75 );
	player.takeHelm(); assert.equal( player.mode, 'boat' ); assert.ok( boat.driven );
	player.leaveHelm(); assert.equal( player.mode, 'deck' ); assert.equal( boat.driven, false );
}
console.log( 'boarding and helm regressions passed' );

// Open Bahama shutters: use the transformed panel, not the wall behind it.
{
	const colliders = new Colliders();
	buildHouse( { B: new Builder(), colliders, terrain: { heightAt: () => 0 }, rand: new Rand( mulberry32( 3 ) ), lights: [], checks: [], inst: { add() {} } },
		{ x: 20, z: - 30, yaw: 0.6, w: 6, d: 5, roof: 'hip', shutters: 'bahama', wall: [ 1, 1, 1 ], trim: [ 1, 1, 1 ], accent: [ 1, 1, 1 ] } );
	const shutters = colliders.surfaces.filter( s => s.tag === 'shutter' );
	assert.ok( shutters.length > 0 );
	for ( const solid of shutters ) {
		const center = solid.vertices.reduce( ( a, b ) => a.add( b ), V( 0, 0, 0 ) ).divideScalar( solid.vertices.length );
		const { p } = move( [ solid ], center.clone().add( V( 0, - 3, 0 ) ), center.clone().add( V( 0, 0.5, 0 ) ) );
		const body = p.clone().add( V( 0, 1.75 / 2, 0 ) );
		assert.ok( solid.planes.some( ( { n, d } ) => n.dot( body ) >= d + 0.3 * Math.hypot( n.x, n.z ) + 1.75 / 2 * Math.abs( n.y ) ) );
		assert.ok( p.distanceTo( center.clone().add( V( 0, 0.5, 0 ) ) ) > 0.1 );
	}
}

const { TreeColliders } = await import( '../src/world/vegetation/TreeColliders.js' );
{
	const trunks = new TreeColliders( {
		trees: [ { x: 0, y: 0, z: 0, s: 1, sy: 1, yaw: 0 } ],
		palms: [ { x: 10, y: 0, z: 0, s: 1, la: 0, l: 0.4, H: 10, seed: 0.3 } ],
	} );
	for ( const [ x, z ] of [ [ 0, 0 ], [ 10.1, 0 ] ] ) {
		const from = V( x, 0, z + 2 ), to = V( x, 0, z - 2 );
		const { p } = move( trunks.near( from, to, 0.3 ), from, to );
		assert.ok( p.z > 0.3, `passed through trunk at ${ x }` );
	}
	// The leaning palm is solid away from its base at head height, with open space beside it.
	const from = V( 11.7, 2, 2 ), to = V( 11.7, 2, - 2 );
	assert.ok( move( trunks.near( from, to, 0.3 ), from, to ).p.z > 0.2 );
	assert.equal( trunks.near( V( 100, 0, 100 ), V( 101, 0, 100 ), 0.3 ).length, 0 );
	const world = new Colliders(); world.trees = trunks;
	const player = playerAt( world ); player.position.set( 0, 0, 2 ); player.yaw = 0;
	player.input.down = k => k === 'KeyW'; player.waterH = - 10; player.waterMean = - 10; player.grounded = true;
	for ( let i = 0; i < 120; i ++ ) {
		player.updateWalk( 1 / 60 );
		assert.ok( Math.hypot( player.position.x, player.position.z ) > 0.7, 'walked through tree core' );
	}
}

const { BoatWorldCollision } = await import( '../src/player/BoatWorldCollision.js' );
function moveBoat( world, from, to, q = new Quaternion() ) {
	const b = { position: to.clone(), quaternion: q.clone(), velocity: to.clone().sub( from ), angular: V( 0, 0, 0 ) };
	new BoatWorldCollision( model, world ).move( b, from, q );
	return b;
}
// A narrow pile between the old seven sample points must stop a sideways impact.
{
	const world = new Colliders(); world.addCylinder( 0, 0.5, 0.15, - 4, 3 );
	const b = moveBoat( world, V( 4, 0, 0 ), V( - 4, 0, 0 ) );
	assert.ok( b.position.x > 1.3, `boat passed pile: ${ b.position.x }` );
	assert.ok( b.velocity.x > - 1, 'impact did not dissipate inward speed' );
	assert.ok( Math.abs( b.angular.y ) > 0, 'off-center pile impact should turn the boat' );
}
// Pier deck above the waterline catches the cabin; empty space below a high bridge stays open.
{
	const world = new Colliders(); world.addBox( V( 0, 2.26, 0 ), V( 0.2, 0.04, 8 ), 0, { tag: 'pierDeck' } );
	assert.ok( moveBoat( world, V( 4, 0, 0 ), V( - 4, 0, 0 ) ).position.x > 1 );
	const high = new Colliders(); high.addBox( V( 0, 5, 0 ), V( 0.2, 0.1, 8 ) );
	near( moveBoat( high, V( 4, 0, 0 ), V( - 4, 0, 0 ) ).position.x, - 4 );
	// Broadside, bow-first and a pitching/rolling boat all keep out of a solid pier edge.
	const wall = new Colliders(); wall.addBox( V( 0, 0, 0 ), V( 0.1, 4, 20 ) );
	for ( const q of [ new Quaternion(), new Quaternion().setFromEuler( new Euler( 0, Math.PI / 2, 0 ) ), new Quaternion().setFromEuler( new Euler( 0.2, 0.6, 0.2 ) ) ] ) {
		assert.ok( moveBoat( wall, V( 6, 0, 0 ), V( - 6, 0, 0 ), q ).position.x > 1 );
	}
}
console.log( 'shutter, tree and boat/pier regressions passed' );

// Exercise the real physics integrator against the real T-shaped pier layout.
{
	const { buildPier } = await import( '../src/world/Pier.js' );
	const { BoatController } = await import( '../src/player/BoatController.js' );
	const { Group } = await import( '../src/engine/index.js' );
	const { PROP, RUDDER } = await import( '../src/world/boat/Running.js' );
	const world = new Colliders(), terrain = { heightAt: () => - 10 };
	buildPier( { B: new Builder(), terrain, colliders: world, rand: new Rand( mulberry32( 42 ) ), lights: [], inst: { add() {} } } );
	const physicsModel = { ...model, propeller: PROP.position, rudder: RUDDER.pivot, hullSamples: model.lines.buildHullSamples( 8 ), group: new Group(), setThrottle() {}, setSteering() {}, setPropellerRPM() {} };
	const controller = new BoatController( { model: physicsModel, colliders: world, terrain, query: { allocate: () => 0, cpuValid: false } } );
	controller.hasWater = true; controller.moored = false;
	controller.position.set( 64.5, 0, 36.5 ); controller.velocity.set( - 8, 0, 0 );
	for ( let i = 0; i < 180; i ++ ) {
		controller.update( 1 / 120 );
		assert.ok( controller.isFinite() );
		assert.ok( controller.position.x > 62, 'boat crossed the pier head during physics update' );
	}
}
console.log( 'real pier physics regression passed' );

// Regression found during review: a roof's slide response must not undo a wall hit.
for ( const dt of [ 1 / 120, 1 / 60, 1 / 20 ] ) {
	const world = new Colliders();
	world.addBox( V( 0, 1.5, 0 ), V( 1, 1.5, 3 ) );
	world.addSurface( [ V( 1, 2.3, - 2 ), V( 3, 1.9, - 2 ), V( 3, 1.9, 2 ), V( 1, 2.3, 2 ) ], 0.05 );
	const p = playerAt( world ); p.position.set( 1.31, 0, 0 );
	p.waterH = p.waterMean = - 10; p.grounded = true;
	p.input.hit = k => k === 'Space';
	for ( let i = 0; i < 180; i ++ ) {
		p.updateWalk( dt );
		assert.ok( p.position.x >= 1.3 - 1e-6, `roof pushed player into wall at dt=${ dt }` );
		assert.ok( p.position.y >= - 1e-5 );
	}
}
// The unified solver keeps step-up movement and blocks a tall wall at the top.
{
	const world = new Colliders();
	for ( let i = 0; i < 4; i ++ ) world.addBox( V( 0, ( i + 1 ) * 0.1, - i * 0.6 ), V( 1, ( i + 1 ) * 0.1, 0.3 ), 0, { walkable: true } );
	world.addBox( V( 0, 1.5, - 3 ), V( 2, 1.5, 0.1 ) );
	const p = playerAt( world ); p.position.set( 0, 0, 1 ); p.yaw = 0;
	p.waterH = p.waterMean = - 10; p.grounded = true; p.input.down = k => k === 'KeyW';
	let highest = 0;
	for ( let i = 0; i < 100; i ++ ) { p.updateWalk( 1 / 60 ); highest = Math.max( highest, p.position.y ); }
	assert.ok( highest >= 0.79, 'steps became impassable' );
	assert.ok( p.position.z >= - 2.6 - 0.002, 'passed the wall after climbing steps' );
}
// Dock impulses remove approaching contact speed, dissipate energy, and leave heave/roll/pitch alone.
const { applyDockImpulse } = await import( '../src/player/BoatWorldCollision.js' );
{
	const b = { mass: 3200, inertia: V( 14600, 15700, 3500 ), velocity: V( - 4, 0.2, 2 ), angular: V( 0.1, 0.3, - 0.2 ) };
	const energy = () => 0.5 * b.mass * ( b.velocity.x ** 2 + b.velocity.z ** 2 ) + 0.5 * b.inertia.y * b.angular.y ** 2;
	const before = energy();
	applyDockImpulse( b, { x: 1, z: 0, px: - 1, pz: 2 }, V( 0, 0, 0 ) );
	assert.ok( energy() <= before );
	assert.ok( b.velocity.x + b.angular.y * 2 >= - 0.05 );
	near( b.velocity.y, 0.2 ); near( b.angular.x, 0.1 ); near( b.angular.z, - 0.2 );
	assert.ok( b.velocity.z > 0, 'glancing impact removed all tangential motion' );
	b.velocity.set( 4, 0.2, 2 ); b.angular.y = 0;
	applyDockImpulse( b, { x: 1, z: 0, px: - 1, pz: 2 }, V( 0, 0, 0 ) );
	near( b.velocity.x, 4 ); near( b.velocity.z, 2 ); near( b.angular.y, 0 );
}
console.log( 'wall/roof, step-up and contact impulse regressions passed' );

// Contact impulses must not add kinetic energy across different impact angles/offsets.
{
	const random = mulberry32( 923 );
	for ( let i = 0; i < 500; i ++ ) {
		const a = random() * Math.PI * 2;
		const b = { mass: 3200, inertia: V( 14600, 15700, 3500 ), velocity: V( random() * 20 - 10, 0, random() * 20 - 10 ), angular: V( 0, random() * 2 - 1, 0 ) };
		const hit = { x: Math.cos( a ), z: Math.sin( a ), px: random() * 3 - 1.5, pz: random() * 8 - 4 };
		const energy = () => 0.5 * b.mass * ( b.velocity.x ** 2 + b.velocity.z ** 2 ) + 0.5 * b.inertia.y * b.angular.y ** 2;
		const before = energy();
		applyDockImpulse( b, hit, V( 0, 0, 0 ) );
		assert.ok( Number.isFinite( energy() ) && energy() <= before + 1e-6, 'dock contact added kinetic energy' );
	}
}
// Powered approach against the actual pier, including lower frame rates and repeated contacts.
{
	const { buildPier } = await import( '../src/world/Pier.js' );
	const { BoatController } = await import( '../src/player/BoatController.js' );
	const { Group } = await import( '../src/engine/index.js' );
	const { PROP, RUDDER } = await import( '../src/world/boat/Running.js' );
	const world = new Colliders(), terrain = { heightAt: () => - 10 };
	buildPier( { B: new Builder(), terrain, colliders: world, rand: new Rand( mulberry32( 42 ) ), lights: [], inst: { add() {} } } );
	for ( const dt of [ 1 / 120, 1 / 60, 1 / 20 ] ) {
		const physicsModel = { ...model, propeller: PROP.position, rudder: RUDDER.pivot, hullSamples: model.lines.buildHullSamples( 8 ), group: new Group(), setThrottle() {}, setSteering() {}, setPropellerRPM() {} };
		const b = new BoatController( { model: physicsModel, colliders: world, terrain, query: { allocate: () => 0, cpuValid: false } } );
		b.position.set( 68.5, 0, 36.5 ); b.quaternion.setFromAxisAngle( V( 0, 1, 0 ), - Math.PI / 2 );
		b.velocity.set( - 8, 0, 0 ); b.hasWater = true; b.moored = false; b.driven = true; b.throttle = b.rpm = 1;
		let contacts = 0;
		for ( let i = 0; i < Math.round( 3 / dt ); i ++ ) {
			b.update( dt ); contacts += b.worldCollision.stats.contacts;
			assert.ok( b.isFinite() );
			assert.ok( b.position.x > 62, `powered boat crossed pier at dt=${ dt }` );
			assert.ok( b.angular.length() < 5, 'impact caused unstable spinning' );
		}
		assert.ok( contacts > 0, 'fixture never reached the pier' );
	}
}
console.log( 'impact energy and sustained pier contact regressions passed' );

// The actual pier has 32 cm treads: the body reaches the next riser before
// its centre reaches the current tread. Walk both ways without jumping.
{
	const { buildPier, PIER } = await import( '../src/world/Pier.js' );
	const world = new Colliders(), terrain = { heightAt: () => 0 };
	const info = buildPier( { B: new Builder(), terrain, colliders: world, rand: new Rand( mulberry32( 42 ) ), lights: [], inst: { add() {} } } );
	for ( const dt of [ 1 / 120, 1 / 60, 1 / 20 ] ) {
		const p = playerAt( world ); p.position.copy( info.stepFoot ); p.yaw = Math.PI;
		p.waterH = p.waterMean = - 10; p.grounded = true; p.input.down = k => k === 'KeyW';
		for ( let i = 0; i < 3 / dt; i ++ ) p.updateWalk( dt );
		assert.ok( p.position.z > PIER.zStart + 1, `pier ascent stopped at ${ JSON.stringify( p.position ) }, dt=${ dt }` );
		near( p.position.y, PIER.deck );
		p.yaw = 0; p.velocity.set( 0, 0, 0 );
		for ( let i = 0; i < 4 / dt; i ++ ) p.updateWalk( dt );
		assert.ok( p.position.z < info.stepFoot.z, 'pier descent stopped' );
		near( p.position.y, 0 );
	}
}

// Reproduce the actual boardwalk-to-pier transition on the island heightmap.
// A drop at the boardwalk end previously disabled stepping and trapped the
// player at z=-64.9451 against the next riser, alternating grounded each frame.
{
	const { TerrainData } = await import( '../src/world/TerrainData.js' );
	const { buildPier, PIER } = await import( '../src/world/Pier.js' );
	const { buildBoardwalk } = await import( '../src/world/village/Boardwalk.js' );
	const terrain = new TerrainData(), world = new Colliders();
	const ctx = { B: new Builder(), terrain, colliders: world, rand: new Rand( mulberry32( 42 ) ), lights: [], checks: [], inst: { add() {} } };
	const { stepFoot: foot } = buildPier( ctx );
	buildBoardwalk( ctx, [ [ foot.x, foot.z + 0.05 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ], [ 44.8, - 100.5 ], [ 42.6, - 107.2 ] ], { width: 1.8, startY: foot.y + 0.24, lightEvery: 70 } );
	for ( const dt of [ 1 / 120, 1 / 60, 1 / 20 ] ) for ( const sprint of [ false, true ] ) {
		const p = playerAt( world ); p.terrain = terrain;
		p.position.set( 55, p.groundAt( 55, - 69, 50 ), - 69 ); p.yaw = Math.PI;
		p.waterH = p.waterMean = - 10; p.grounded = true;
		p.input.down = k => k === 'KeyW' || ( sprint && k === 'ShiftLeft' );
		for ( let i = 0; i < 3 / dt; i ++ ) {
			const before = p.position.clone(); p.updateWalk( dt );
			assert.ok( p.grounded, `lost support at boardwalk/pier join: ${ JSON.stringify( p.position ) }` );
			if ( i * dt > 0.7 ) assert.ok( p.position.z - before.z > ( sprint ? 6 : 2.9 ) * dt, 'forward movement stuttered at a seam or stair' );
		}
		assert.ok( p.position.z > PIER.zStart + 1, `pier entrance blocked at dt=${ dt }` );
		near( p.position.y, PIER.deck );
		p.yaw = 0; p.velocity.set( 0, 0, 0 );
		for ( let i = 0; i < 3 / dt; i ++ ) {
			p.updateWalk( dt );
			assert.ok( p.grounded, 'lost support walking back down pier stairs' );
		}
		assert.ok( p.position.z < foot.z, 'could not return to boardwalk' );
	}
}
// Steps still obey the height limit and need headroom. Jumping never uses
// grounded stepping to gain an extra lift onto a ledge.
for ( const scenario of [ 'tall', 'ceiling', 'jump' ] ) {
	const world = new Colliders(), top = scenario === 'tall' ? 0.6 : 0.3;
	world.addBox( V( 0, top / 2, - 1 ), V( 1, top / 2, 1 ), 0, { walkable: true } );
	if ( scenario === 'ceiling' ) world.addSurface( [ V( - 2, 2.05, - 3 ), V( 2, 2.05, - 3 ), V( 2, 2.05, 2 ), V( - 2, 2.05, 2 ) ], 0.1 );
	const p = playerAt( world ); p.position.set( 0, 0, 1 ); p.yaw = 0;
	p.grounded = true; p.waterH = p.waterMean = - 10; p.input.down = k => k === 'KeyW';
	if ( scenario === 'jump' ) { p.position.set( 0, 0.1, 0.31 ); p.grounded = false; p.velocity.set( 0, 0.5, - 3 ); }
	for ( let i = 0; i < ( scenario === 'jump' ? 1 : 120 ); i ++ ) p.updateWalk( 1 / 60 );
	assert.ok( p.position.z >= 0.3, `${ scenario }: stepped through an obstruction` );
	assert.ok( p.position.y < 0.2 );
}
// A narrow passage with adjoining floor segments should preserve forward slide
// while diagonal input presses the player against the wall.
for ( const dt of [ 1 / 120, 1 / 60, 1 / 20 ] ) {
	const world = new Colliders();
	for ( let i = 0; i < 10; i ++ ) world.addBox( V( 0, 0.1 + i * 0.02, - i ), V( 0.6, 0.1 + i * 0.02, 0.51 ), 0, { walkable: true } );
	for ( const x of [ - 0.7, 0.7 ] ) world.addBox( V( x, 1.5, - 4.5 ), V( 0.1, 1.5, 5.5 ) );
	const p = playerAt( world ); p.position.set( 0, 0.2, 0 ); p.yaw = 0;
	p.grounded = true; p.waterH = p.waterMean = - 10; p.input.down = k => k === 'KeyW' || k === 'KeyD';
	for ( let i = 0; i < 3 / dt; i ++ ) {
		const before = p.position.clone(); p.updateWalk( dt );
		assert.ok( p.position.x <= 0.3001 && p.grounded );
		if ( i * dt > 0.7 ) assert.ok( before.z - p.position.z > 2 * dt, 'wall/floor seam stopped sliding' );
	}
	assert.ok( p.position.z < - 5 );
}
// The camera eases a step; the collision body remains on its support.
{
	const world = new Colliders();
	world.addBox( V( 0, 0.15, - 1 ), V( 1, 0.15, 1 ), 0, { walkable: true } );
	const p = playerAt( world ); p.position.set( 0, 0, 1 ); p.yaw = 0; p.grounded = true;
	p.input.down = k => k === 'KeyW';
	let maxEyeChange = 0;
	for ( let i = 0; i < 75; i ++ ) {
		const y = p.camera.position.y; p.update( 1 / 60 );
		if ( i > 0 ) maxEyeChange = Math.max( maxEyeChange, Math.abs( p.camera.position.y - y ) );
		assert.ok( p.camera.position.y <= p.position.y + 1.62 + 0.4 + 0.035 );
	}
	assert.ok( maxEyeChange < 0.12, `camera snapped by ${ maxEyeChange } on a 30 cm step` );
	near( p.position.y, 0 );
}
console.log( 'generated boardwalk/pier, passage, step clearance and camera regressions passed' );

// Down-step camera easing must stop below a low ceiling, even though the body
// itself fits underneath it.
{
	const world = new Colliders();
	world.addSurface( [ V( - 2, 1.95, - 2 ), V( 2, 1.95, - 2 ), V( 2, 1.95, 2 ), V( - 2, 1.95, 2 ) ], 0.05 );
	const p = playerAt( world ); p.position.set( 0, 0, 0 ); p.grounded = true;
	p.camera.position.y = p._camY = 1.62; p.stepOffset = 0.4;
	p.update( 1 / 60 );
	assert.ok( p.camera.position.y + 0.05 <= 1.9, 'smoothed camera entered ceiling' );
}
