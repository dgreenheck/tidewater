// Real 120 Hz contact forces from the game's shipped WASM. Metres, seconds, newtons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const dt = 1 / 120;
function world( heights = new Float32Array( 25 ), size = 4000, z = 0 ) {
	const p = new RallyPhysics();
	const res = Math.sqrt( heights.length );
	assert.ok( p.set_terrain( heights, res, size, -size / 2 ) );
	assert.ok( p.set_surface_map( new Uint8Array( heights.length ).fill( 3 ) ) );
	assert.ok( p.select_vehicle( 6 ) );
	p.reset( 0, 0.5, z, 0 );
	for ( let i = 0; i < 360; i ++ ) p.advance( dt, 0, 0, 0, 1 );
	return p;
}
function accelerate( p, kmh ) {
	for ( let i = 0; i < 1800; i ++ ) {
		p.advance( dt, 1, 0, 0, 0 );
		if ( p.snapshot()[ 7 ] >= kmh ) return p.snapshot();
	}
	assert.fail( `could not reach ${ kmh } km/h` );
}
const front = s => s[ 35 ] + s[ 45 ];
const rear = s => s[ 55 ] + s[ 65 ];

test( 'RS aerodynamic load reaches its tyres at 200 km/h', () => {
	const p = world();
	try {
		const rest = p.snapshot();
		let s = accelerate( p, 200 ), sum = 0;
		// Average out spring motion and gear changes on a 200 km/h steady run.
		for ( let i = 0; i < 480; i ++ ) {
			const throttle = Math.min( 1, Math.max( 0, 0.24 + ( 200 - s[ 7 ] ) * 0.25 ) );
			p.advance( dt, throttle, 0, 0, 0 );
			s = p.snapshot();
			if ( i >= 240 ) sum += ( front( s ) + rear( s ) - front( rest ) - rear( rest ) ) * ( 200 / s[ 7 ] ) ** 2;
		}
		const load = sum / ( 240 * 9.81 );
		assert.ok( load > 380 && load < 440, `added tyre load at 200 km/h: ${ load.toFixed( 1 ) } kg-equivalent` );
	} finally { p.free(); }
} );

test( 'a held turn at 150 km/h develops more than 1.1 g on dry asphalt in both directions', () => {
	for ( const direction of [ -1, 1 ] ) {
		const p = world();
		try {
			accelerate( p, 150 );
			let g = 0, heading = 0;
			for ( let i = 0; i < 180; i ++ ) {
				p.advance( dt, 0.35, 0, direction, 0 );
				const s = p.snapshot();
				g += -s[ 76 ] * direction / 180;
				heading -= s[ 78 ] * direction * dt;
			}
			assert.ok( g > 1.1 && g < 1.8 && heading > 0.43, `cornering ${ g.toFixed( 2 ) } g, heading change ${ (heading*180/Math.PI).toFixed( 1 ) } degrees` );
		} finally { p.free(); }
	}
} );

test( 'both pedals hold a burnout on the front tyres, then releasing the brake launches the RS', () => {
	const p = world();
	try {
		const park = p.snapshot();
		for ( let i = 0; i < 360; i ++ ) p.advance( dt, 1, 1, 0, 0 );
		const s = p.snapshot(), roll = Math.min( s[ 23 ], s[ 27 ] );
		const creep = Math.hypot( s[ 0 ] - park[ 0 ], s[ 2 ] - park[ 2 ] );
		assert.ok( roll > 12 && creep < 1.5, `rear treads ${ roll.toFixed( 1 ) } m/s, chassis travelled ${ creep.toFixed( 2 ) } m` );
		assert.ok( Math.max( Math.abs( s[ 15 ] ), Math.abs( s[ 19 ] ) ) < 0.5 );
		let lightest = Infinity;
		for ( let i = 0; i < 180; i ++ ) {
			p.advance( dt, 1, 0, 0, 0 );
			lightest = Math.min( lightest, front( p.snapshot() ) / front( park ) );
		}
		assert.ok( p.snapshot()[ 7 ] > 25 && lightest > 0 && lightest < 0.65, `launch ${ p.snapshot()[7].toFixed(1) } km/h, minimum front load ${ (100*lightest).toFixed(1) }%` );
	} finally { p.free(); }
} );

test( 'a powered RS lifts its front wheels over a crest and lands back on its suspension', () => {
	const res = 201, heights = new Float32Array( res * res );
	for ( let row = 0; row < res; row ++ ) {
		const z = row - 100, ramp = z + 52;
		// A 24 m easing section enters a 17% grade. At z=4 m the far side falls away.
		const height = ramp < 0 ? 0 : ramp < 24 ? 0.17 * ramp ** 2 / 48 :
			z < 4 ? 0.17 * ( ramp - 12 ) : Math.max( 0, 7.48 - 0.15 * ( z - 4 ) );
		heights.fill( height, row * res, ( row + 1 ) * res );
	}
	const p = world( heights, res, -82 );
	try {
		let noseUp = 0, airborne = false, landed = false;
		for ( let i = 0; i < 1100; i ++ ) {
			p.advance( dt, 1, 0, 0, 0 );
			const s = p.snapshot(), noseY = 2 * ( s[ 4 ] * s[ 5 ] - s[ 3 ] * s[ 6 ] );
			if ( s[ 2 ] < 0 ) continue;
			if ( noseY > 0.05 && ! s[ 16 ] && ! s[ 20 ] && rear( s ) > 100 ) noseUp += dt;
			if ( noseUp > 0 && s[ 10 ] === 0 ) airborne = true;
			if ( airborne && s[ 10 ] === 4 ) { landed = true; break; }
		}
		assert.ok( noseUp > 0.04 && landed, `front axle clear with rear contact for ${ noseUp.toFixed( 3 ) } s, landed ${ landed }` );
	} finally { p.free(); }
} );

test( 'a handbrake entry can be held in a power slide and caught on the opposite steering lock', () => {
	const p = world();
	try {
		p.set_assists( false );
		let s = accelerate( p, 55 ), held = 0, longest = 0, countersteered = false;
		for ( let i = 0; i < 330; i ++ ) {
			const slide = ( s[ 87 ] + s[ 88 ] ) / 2;
			const drifting = i < 180;
			// A test driver feeds in opposite lock as rear slip exceeds 15 degrees
			// and eases the throttle to straighten. Only the public pedals and rack are driven.
			const target = drifting ? 0.26 : 0;
			const steer = i < 20 ? 1 : Math.max( -1, Math.min( 1, 0.24 + 3.6 * ( target - slide ) + 0.22 * s[ 78 ] ) );
			p.advance( dt, i < 20 ? 0.4 : drifting ? 0.55 : 0.18, 0, steer, Number( i >= 9 && i < 23 ) );
			s = p.snapshot();
			if ( i > 23 && drifting ) {
				held = slide > 0.14 && slide < 0.65 && s[ 7 ] > 22 ? held + dt : 0;
				longest = Math.max( longest, held );
				if ( steer < -0.1 && s[ 71 ] > 0.015 ) countersteered = true;
			}
		}
		assert.ok( longest > 0.8 && countersteered && Math.abs( s[ 87 ] ) < 0.06 && s[ 7 ] > 30,
			`controlled slide ${ longest.toFixed( 2 ) } s, exit slip ${ ( s[ 87 ] * 180 / Math.PI ).toFixed( 1 ) } degrees at ${ s[ 7 ].toFixed( 1 ) } km/h` );
	} finally { p.free(); }
} );

test( 'a rear impact releases the authored wing and costs measurable aerodynamic tyre load', async () => {
	const { loadModel } = await import( '../src/rally/VehicleModel.js' );
	const { Damage } = await import( '../src/rally/Damage.js' );
	const bytes = await readFile( new URL( '../public/rally/cosier_gt3rs.glb', import.meta.url ) );
	globalThis.__assetFile = () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	const p = world();
	try {
		const model = await loadModel( 'gt3rs' );
		const car = Damage.prototype.build( model );
		const result = car.state.hit( [ 0, 1.0, -2.18 ], [ 0, 0, 1 ], 9 );
		assert.ok( result.broken.some( i => car.names[ i ] === 'rearWing' ), '32 km/h rear impact left the wing attached' );
		const rig = car.rig.parts.get( 'rearWing' );
		assert.ok( rig.anchor.y > 0.95 && rig.anchor.z < -1.4, 'detaching the wing must leave the cabin intact' );
		const damage = Object.assign( Object.create( Damage.prototype ), { car, rally: { physics: p } } );
		damage.detach( 'rearWing', false );
		let hanging = 0;
		const { Vector3 } = await import( '../src/engine/index.js' );
		const point = new Vector3();
		model.root.updateMatrixWorld( true );
		model.root.traverseVisible( mesh => {
			if ( ! mesh.isMesh ) return;
			const positions = mesh.geometry.attributes.position;
			for ( const index of mesh.geometry.index.array ) {
				point.fromBufferAttribute( positions, index ).applyMatrix4( mesh.matrixWorld );
				if ( point.y > 1.08 && point.z < -1.75 ) hanging ++;
			}
		} );
		assert.equal( hanging, 0, 'wing foil and fittings must clear the air above the rear deck together' );
		const steady = () => {
			let s = p.snapshot(), sum = 0;
			for ( let i = 0; i < 480; i ++ ) {
				p.advance( dt, Math.max( 0, Math.min( 1, 0.24 + ( 200 - s[ 7 ] ) * 0.25 ) ), 0, 0, 0 );
				s = p.snapshot();
				if ( i >= 240 ) sum += rear( s ) * ( 200 / s[ 7 ] ) ** 2;
			}
			return sum / 240;
		};
		accelerate( p, 200 );
		const intactLoad = steady();
		damage.applyMechanical();
		const lostLoad = intactLoad - steady();
		assert.ok( lostLoad > 800, `rear load reduction with the wing off: ${ lostLoad.toFixed( 0 ) } N` );
	} finally {
		delete globalThis.__assetFile;
		p.free();
	}
} );
