// Tree failure is driven by local wind and water loads on the trunk and crown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init,{ RallyPhysics } from '../public/rally/rally_physics.js';
import { Vector3, Group } from '../src/engine/index.js';
import { DisasterBodies } from '../src/disasters/Bodies.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField } from '../src/disasters/Field.js';
import { nativeAngularVelocity } from '../src/disasters/RigidLoads.js';
import { buildPalmNear } from '../src/world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../src/world/vegetation/VegMaterials.js';
import { VegType } from '../src/world/vegetation/InstanceLOD.js';
await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const GROUND = 100; // m, flat test ground
const SPIN_CAP = 2; // rad/s, the declared cap on a released tree (docs/disaster-damage.md)

// Broadleaf records sized like the island canopy (PlantGeometry reference 12.5 m at scale 1).
function canopyRecords( count ) {
	const out = [];
	for ( let i = 0; i < count; i ++ ) {
		const H = 8 + 12 * ( ( i * 7 ) % count ) / count;
		out.push( { x: ( i % 12 ) * 40, y: GROUND, z: Math.floor( i / 12 ) * 40, s: H / 12.5, sy: 1, yaw: i * .37, H, seed: ( i * .618 ) % 1, la: 0, l: 0 } );
	}
	return out;
}
function fixture( { records, kind = 'canopy', camera = new Vector3( 0, GROUND + 2, 0 ), seed = 7 } ) {
	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 25 ).fill( GROUND ), 5, 4000, - 2000 );
	sim.reset( 1500, GROUND + 10, 1500, 0 );
	const { geometry } = buildPalmNear(), type = new VegType( kind, records, { near: [ { geometry, material: createPlantLeafMaterial() } ], fade: [ 100, 110 ] } );
	const vegetation = kind === 'palms' ? { palms: type, records: { palms: records } } : { canopy: type, records: { trees: records } };
	const app = { scene: new Group(), camera: { position: camera }, vegetation, terrainData: { heightAt: () => GROUND }, rally: { physics: sim, supports: [], profile: { mass: 1500 }, requestIslandColliders() {} } };
	const field = new DisasterField( () => GROUND ), owner = { field, runSeed: seed };
	return { sim, type, app, field, owner, bodies: new DisasterBodies( app, owner ) };
}
function director( f ) {
	return { app: f.app, field: f.field, structures: { bodies: new Map() }, bodies: f.bodies, restored: false, limited: 0, peakForce: 0, rawPeakForce: 0, touched: new Set(), bodyOptions: Disasters.prototype.bodyOptions };
}
// One display frame as the director runs it: failure and hinge, loads, native step, pose sync.
function frame( f, d, dt ) {
	f.bodies.update( dt );
	Disasters.prototype.loads.call( d, dt );
	f.sim.advance( dt, 0, 0, 0, 0 );
	f.bodies.sync( f.sim.prop_poses() );
}
function spin( f, b ) {
	const motion = f.sim.disaster_motion();
	for ( let i = 0; i < motion.length; i += 7 ) if ( motion[ i ] === b.id ) {
		const v = new Vector3().fromArray( motion, i + 4 ), com = b.position.clone().add( new Vector3().fromArray( b.centerOfMass ).applyQuaternion( b.quaternion ) );
		return nativeAngularVelocity( f.sim, b.id, com, v ).length();
	}
	return 0;
}
const tilt = q => new Vector3( 0, 1, 0 ).applyQuaternion( q ).angleTo( new Vector3( 0, 1, 0 ) );
const deg = x => ( x * 180 / Math.PI ).toFixed( 1 );

test( 'A 45 m/s wind uproots most broadleaves, snaps some low on the stem and leaves the rest bending; the split moves with the event seed', () => {
	const splits = [];
	for ( const seed of [ 11, 222, 3333, 44444, 555555 ] ) {
		// Camera 5 km away: every failure takes the animated far path, so no native bodies are needed.
		const records = canopyRecords( 120 ), f = fixture( { records, seed, camera: new Vector3( 5000, GROUND, 5000 ) } );
		try {
			f.field.ambient = () => ( { x: 45, z: 0 } );
			const failedAt = new Map();
			for ( let t = 0; t < 12; t += 1 / 30 ) {
				f.bodies.update( 1 / 30 );
				for ( const tree of f.bodies.trees ) if ( tree.mode && ! failedAt.has( tree ) ) failedAt.set( tree, t );
			}
			const n = f.bodies.trees.length, count = mode => f.bodies.trees.filter( t => t.mode === mode ).length;
			const uproot = count( 'uproot' ) / n, snap = count( 'snap' ) / n, bend = 1 - uproot - snap;
			splits.push( [ uproot, snap ] );
			assert.equal( f.bodies.bodies.size, 0, 'trees 5 km from the camera fall as animated instances, never rigid bodies' );
			assert.ok( uproot >= .45 && uproot <= .85, `seed ${seed}: ${( uproot * 100 ).toFixed( 0 )}% uprooted; EF DI 28 expects most hardwoods uprooted at 41 m/s` );
			assert.ok( snap >= .08 && snap <= .4, `seed ${seed}: ${( snap * 100 ).toFixed( 0 )}% snapped; EF DI 28 puts trunk snap at 49 m/s, so a 45 m/s wind snaps only the weak tail` );
			assert.ok( bend >= .03, `seed ${seed}: ${( bend * 100 ).toFixed( 0 )}% still standing and bending; some trees outlast an EF2 wind` );
			for ( const t of f.bodies.trees.filter( t => t.mode === 'snap' ) ) {
				assert.ok( t.cut >= .15 * t.r.H && t.cut <= .7 * t.r.H, `snap at ${t.cut.toFixed( 1 )} m on a ${t.r.H.toFixed( 1 )} m stem` );
				assert.ok( t.stump?.parent === f.app.scene, 'a snapped tree leaves its stump standing' );
			}
			// A tree that gave way at least 5 s before the end has finished falling.
			for ( const t of f.bodies.trees.filter( t => failedAt.get( t ) < 7 ) ) {
				assert.ok( t.theta > 1.2 && t.theta <= Math.PI / 2 + 1e-6, `fallen tree rests at ${deg( t.theta )} deg from vertical, on the ground` );
			}
		} finally { f.bodies.reset(); f.sim.free(); }
	}
	assert.ok( new Set( splits.map( s => s.join() ) ).size >= 3, `the uproot/snap split must vary with the event seed: ${JSON.stringify( splits )}` );
} );

test( 'A near tree hinges at its base, is released as a body past 60 deg without a jump, and then never spins above the cap', () => {
	const f = fixture( { records: [ { x: 0, y: GROUND, z: 0, s: 1.1, sy: 1, yaw: .4, H: 14, seed: .3, la: 0, l: 0 } ] } ), d = director( f );
	try {
		f.field.ambient = () => ( { x: 70, z: 0 } );
		let released = null;
		for ( let t = 0; t < 10 && ! released; t += 1 / 60 ) {
			frame( f, d, 1 / 60 );
			const tree = f.bodies.trees[ 0 ];
			released = [ ...f.bodies.bodies.values() ].find( b => b.kind === 'tree' ) ?? null;
			if ( ! released && tree.mode ) assert.ok( ! ( tree.theta > Math.PI / 3 + .05 ), `still hinged at ${deg( tree.theta )} deg` );
		}
		assert.ok( released, 'a 70 m/s wind fells the tree' );
		const tree = f.bodies.trees[ 0 ];
		assert.ok( tilt( released.quaternion ) >= Math.PI / 3 - .02, `released at ${deg( tilt( released.quaternion ) )} deg, not upright` );
		const foot = new Vector3( 0, - released.half.y, 0 ).applyQuaternion( released.quaternion ).add( released.position );
		const pivot = new Vector3( 0, tree.cut, 0 ).add( new Vector3( tree.r.x, tree.r.y, tree.r.z ) );
		assert.ok( foot.distanceTo( pivot ) < .6, `the released stem starts at its hinge: foot ${foot.distanceTo( pivot ).toFixed( 2 )} m away` );
		let peak = 0;
		f.field.ambient = () => ( { x: 45, z: 0 } );
		for ( let t = 0; t < 4; t += 1 / 60 ) {
			// A tornado gust kicks the crown: 6 rad/s about the vertical.
			if ( Math.abs( t - 1 ) < 1e-6 || ( t > 1 && t < 1 + 1 / 60 ) ) f.sim.set_prop_angular_velocity( released.id, new Float32Array( [ 0, 6, 0 ] ) );
			frame( f, d, 1 / 60 );
			if ( t > 1 ) peak = Math.max( peak, spin( f, released ) );
		}
		assert.ok( peak <= SPIN_CAP + .05, `released tree spun at ${peak.toFixed( 2 )} rad/s; the cap is ${SPIN_CAP} rad/s` );
	} finally { f.bodies.reset(); f.sim.free(); }
} );

test( 'A fallen palm floats low and near-horizontal in a 2 m/s, 1.5 m flood like green wood, and rests on its crown on dry ground', () => {
	for ( const flood of [ true, false ] ) {
		const f = fixture( { kind: 'palms', records: [ { x: 0, y: GROUND, z: 0, s: 1.4, sy: 1, yaw: .7, H: 18, seed: .34, la: 0, l: 0 } ] } ), d = director( f );
		try {
			f.field.ambient = () => ( { x: 80, z: 0 } );
			let body = null;
			for ( let t = 0; t < 12 && ! body; t += 1 / 60 ) { frame( f, d, 1 / 60 ); body = [ ...f.bodies.bodies.values() ][ 0 ] ?? null; }
			assert.ok( body, 'an 80 m/s wind fells the palm' );
			const density = body.mass / body.volume;
			assert.ok( density >= 600 && density <= 900, `released palm density ${density.toFixed( 0 )} kg/m3; green wood is 600 to 900` );
			if ( flood ) f.field.water = { sample: ( x, z, out = {} ) => Object.assign( out, { height: GROUND + 1.5, ux: 2, uz: 0, depth: 1.5 } ) };
			f.field.ambient = () => ( flood ? { x: 45, z: 0 } : { x: 0, z: 0 } );
			for ( let t = 0; t < 14; t += 1 / 60 ) frame( f, d, 1 / 60 );
			const fromHorizontal = Math.abs( Math.PI / 2 - tilt( body.quaternion ) );
			assert.ok( fromHorizontal < .35, `${flood ? 'floating' : 'grounded'} palm lies ${deg( fromHorizontal )} deg off horizontal` );
			const crown = new Vector3( 0, body.crownCentre, 0 ).applyQuaternion( body.quaternion ).add( body.position );
			if ( flood ) {
				const stem = body.position.y - ( GROUND + 1.5 );
				assert.ok( stem < .1 && stem > - 1.2, `green stem axis ${stem.toFixed( 2 )} m from the surface: it floats low, not like a cork` );
			} else assert.ok( crown.y - GROUND >= .8 * body.crownSupport, `crown centre ${( crown.y - GROUND ).toFixed( 2 )} m above ground: the crushed crown holds it up (support ${body.crownSupport?.toFixed( 2 )} m)` );
		} finally { f.bodies.reset(); f.sim.free(); }
	}
} );
