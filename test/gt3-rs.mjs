import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { VEHICLES } from '../src/rally/Vehicles.js';
import { loadModel } from '../src/rally/VehicleModel.js';
import { bindWheels, poseWheel } from '../src/rally/WheelRig.js';
import { Vector3 } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';

const asset = path => readFile( new URL( '../public/rally/' + path, import.meta.url ) );
await init( { module_or_path: await asset( 'rally_physics_bg.wasm' ) } );

test( 'the RS launches on asphalt with four tyres under its measured 2.457 m wheelbase', async () => {
	const sim = new RallyPhysics();
	try {
		sim.set_terrain( new Float32Array( 25 ), 5, 400, - 200 );
		sim.set_roads( new Float32Array( [ 0, - 190, 0, 190, 5, 1 ] ) );
		const car = VEHICLES.gt3rs;
		if ( car ) sim.select_vehicle( car.id );
		sim.reset( 0, 0.45, 0, 0 );
		for ( let i = 0; i < 360; i ++ ) sim.advance( 1 / 120, 0, 0, 0, 1 );
		const s = sim.snapshot();
		assert.equal( s[ 10 ], 4 );
		const span = s[ 31 ] - s[ 51 ];
		assert.ok( Math.abs( span - 2.457 ) < 0.005, `ground contacts are ${ span.toFixed( 3 ) } m apart` );
		const bytes = await asset( car.file + '.glb' );
		const model = parseGLB( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );
		for ( const [ i, name ] of [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ].entries() ) {
			const carrier = model.nodes.find( n => n.name === name );
			const error = Math.hypot( carrier.t[ 0 ] - s[ 29 + i * 10 ], carrier.t[ 2 ] - s[ 31 + i * 10 ] );
			assert.ok( error < 0.015, `${ name } is ${ error.toFixed( 3 ) } m from its contact patch` );
		}
		let steps = 0;
		while ( steps < 720 && sim.snapshot()[ 7 ] < 100 ) {
			sim.advance( 1 / 120, 1, 0, 0, 0 );
			steps ++;
		}
		const seconds = steps / 120;
		console.log( `RS: 0–100 km/h in ${ seconds.toFixed( 2 ) } s, wheelbase ${ span.toFixed( 3 ) } m` );
		assert.ok( seconds >= 3 && seconds <= 4.6, `0–100 km/h took ${ seconds.toFixed( 2 ) } s` );
	} finally {
		sim.free();
	}
} );

test( 'the imported disc and tyre roll while the brake calliper stays on its steered hub', async () => {
	const car = VEHICLES.gt3rs;
	const bytes = await asset( car.file + '.glb' );
	globalThis.__assetFile = () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	try {
		const model = await loadModel( car.file );
		const rig = bindWheels( model, car );
		const wheel = rig[ 0 ];
		const point = material => {
			let sample;
			wheel.carrier.traverse( mesh => {
				if ( mesh.material?.name === material ) {
					sample = new Vector3().fromBufferAttribute( mesh.geometry.attributes.position, 0 ).applyMatrix4( mesh.matrixWorld );
				}
			} );
			assert.ok( sample, `missing ${ material } on imported hub` );
			return sample;
		};
		const set = spin => {
			poseWheel( wheel, car.radius - 0.025, 0.25, spin );
			model.root.updateMatrixWorld( true );
		};
		set( 0 );
		const tyre = point( 'MAT_Rubber_Tyre' ), disc = point( 'MAT_Brake_Ceramic' ), brake = point( 'MAT_Caliper_Black' );
		set( Math.PI / 2 );
		assert.ok( tyre.distanceTo( point( 'MAT_Rubber_Tyre' ) ) > 0.30, 'a quarter turn must carry the tread at least 0.30 m' );
		assert.ok( disc.distanceTo( point( 'MAT_Brake_Ceramic' ) ) > 0.05, 'the brake disc must rotate with the tyre' );
		const slip = brake.distanceTo( point( 'MAT_Caliper_Black' ) );
		assert.ok( slip < 0.0001, `calliper slipped ${ slip.toFixed( 4 ) } m around the disc` );
		assert.equal( bindWheels( model, car )[ 0 ].radius, wheel.radius, 'reselecting a compressed wheel keeps its original rolling radius' );
	} finally {
		delete globalThis.__assetFile;
	}
} );
