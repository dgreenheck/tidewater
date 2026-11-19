// The game's car table (src/rally/Vehicles.js) and the physics configs (rally-physics/src/vehicle.rs)
// describe the same cars twice. Vehicles.js places the model's wheels (radius, mount), sizes the tyre
// marks (width), labels the picker (mass) and scales the rev gauge (idle, redline); the Rust config
// moves the car. A car whose two copies disagree draws its wheels off the ground the physics drives
// on, or shows a redline the engine never reaches. This test reads both files and holds every car in
// VEHICLES to its physics kind, so a new car cannot land with one copy stale.
//   node --test test/vehicle-parity.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VEHICLES } from '../src/rally/Vehicles.js';

const rust = readFileSync( new URL( '../rally-physics/src/vehicle.rs', import.meta.url ), 'utf8' );
const count = Number( rust.match( /pub const COUNT:u8=(\d+);/ )[ 1 ] );
const arms = rust.match( /match kind \{([^}]*)\}/ )[ 1 ];
const kinds = new Map( [ ...arms.matchAll( /(\d+)=>Self::(\w+)\(\)/g ) ].map( m => [ Number( m[ 1 ] ), m[ 2 ] ] ) );
const fallback = arms.match( /_=>Self::(\w+)\(\)/ )[ 1 ];

// One constructor's numbers: `pub fn <name>()->Self { Self { mass:..., ... } }`.
function config( name ) {
	const body = rust.match( new RegExp( `pub fn ${ name }\\(\\)->Self \\{([\\s\\S]*?)\\n    \\}` ) )[ 1 ];
	const number = key => Number( body.match( new RegExp( `\\b${ key }:(-?[\\d.]+)` ) )[ 1 ] );
	const mount = Number( body.match( /mounts:\[Vec3::new\(-?[\d.]+,([\d.]+),/ )[ 1 ] );
	const box = body.match( /body:Vec3::new\(([\d.]+),[\d.]+,([\d.]+)\)/ );
	return { mass: number( 'mass' ), radius: number( 'radius' ), width: number( 'width' ), mount, idle: number( 'idle' ), redline: number( 'redline' ), hull: [ Number( box[ 1 ] ), Number( box[ 2 ] ) ] };
}

test( 'every car in the picker is a physics kind the bridge accepts', () => {
	for ( const [ key, car ] of Object.entries( VEHICLES ) ) {
		assert.ok( Number.isInteger( car.id ) && car.id >= 0 && car.id < count, `${ key }: id ${ car.id } outside 0..${ count - 1 }` );
	}
} );

test( 'each car draws its wheels and its rev gauge from its own physics config', () => {
	for ( const [ key, car ] of Object.entries( VEHICLES ) ) {
		const physics = config( kinds.get( car.id ) ?? fallback );
		for ( const field of [ 'mass', 'radius', 'width', 'mount', 'idle', 'redline' ] ) {
			assert.equal( car[ field ], physics[ field ], `${ key } ${ field }: Vehicles.js ${ car[ field ] }, vehicle.rs ${ physics[ field ] }` );
		}
		// CarWater samples the sea under this footprint; a car with no row threw every frame.
		assert.deepEqual( car.hull, physics.hull, `${ key } hull: Vehicles.js ${ car.hull }, vehicle.rs body ${ physics.hull }` );
	}
} );
