// DisasterField.acceleration runs per body per frame. It built four small objects a call (two drag inputs, two
// drag results, plus their option literals and an array in quadraticDrag); the destruction lane measured 13-16
// minor GCs per 1500 frames at 305 bodies. It now reuses module scratch. This pins that the results are the same,
// bit for bit, as the allocating version (kept below verbatim from the baseline) on real samples: a 10 m tsunami on
// the real island, bodies dry, wading, swimming and afloat, still and moving, in wind and calm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS, clamp } from '../src/disasters/Field.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, quadraticDrag, buoyancy as lift } from '../src/physics/Loads.js';

// The allocating acceleration, verbatim (Field.js in the baseline), as a reference.
function reference( field, p, v, { mass = 80, area = 0.7, volume = 0.08, height = 1.8, buoyancy = true, waterDrag = true, supported = false, dt = 1 / 30 } = {}, out = {} ) {
	const s = field.sample( p.x, p.y, p.z, out ), ground = field.terrain( p.x, p.z ), step = Math.max( 1 / 1000, Math.min( .1, dt ) );
	mass = Math.max( .05, mass ); let ax = supported ? s.ax : 0, ay = supported ? s.ay : 0, az = supported ? s.az : 0;
	const air = { x: s.wx - v.x, y: s.wy - v.y, z: s.wz - v.z }, raw = quadraticDrag( {}, air, { area, dragCoefficient: 1.1 } ), airSpeed = Math.hypot( air.x, air.y, air.z );
	const airRelax = 1 + step * .5 * AIR_DENSITY * 1.1 * area * airSpeed / mass;
	ax += raw.x / mass / airRelax; ay += raw.y / mass / airRelax; az += raw.z / mass / airRelax;
	const wet = s.height > ground + 0.02 ? clamp( ( s.height - p.y + height * .5 ) / height, 0, 1 ) : 0;
	let rawWater = 0;
	if ( wet > 0 ) {
		if ( waterDrag ) { const relative = { x: s.ux - v.x - step * raw.x / mass / airRelax, y: 0, z: s.uz - v.z - step * raw.z / mass / airRelax };
			const water = quadraticDrag( {}, relative, { density: SEA_WATER_DENSITY, area: area * wet } ), speed = Math.hypot( relative.x, relative.z ), waterRelax = 1 + step * .5 * SEA_WATER_DENSITY * area * wet * speed / mass;
			ax += water.x / mass / waterRelax; az += water.z / mass / waterRelax; rawWater = Math.hypot( water.x, water.z ); }
		if ( buoyancy ) ay += lift( volume * wet ) / mass - v.y * wet * 2;
	}
	const length = Math.hypot( ax, ay, az ), k = length > 45 ? 45 / length : 1; s.rawAcceleration = length; s.rawDragForce = Math.hypot( raw.x, raw.y, raw.z ) + rawWater; s.limited = k < 1; s.ax = ax * k; s.ay = ay * k; s.az = az * k; s.wet = wet; return s;
}

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
function flooded() {
	const field = new DisasterField( ground );
	field.ambient = () => ( { x: 7.5, z: - 3.2 } ); // m/s: a fresh breeze
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 10, warningLead: 3, duration: 120, seed: 1 } );
	while ( field.time < e.arrival + 6 ) field.advance( 0.1 );
	return field;
}
const field = flooded();
// Bodies on a 37 x 37 lattice round the village target at four heights each, three velocities, three shapes.
const bodies = [];
for ( let i = - 18; i <= 18; i ++ ) for ( let j = - 18; j <= 18; j ++ ) {
	const x = DEFAULTS.tsunami.x + i * 9, z = DEFAULTS.tsunami.z + j * 9, y0 = Math.max( 0, ground( x, z ) );
	for ( const dy of [ - 0.6, 0.4, 1.2, 4 ] ) for ( const v of [ { x: 0, y: 0, z: 0 }, { x: 3.1, y: - 0.4, z: - 1.7 }, { x: - 9, y: 2, z: 6 } ] )
		bodies.push( { p: { x, y: y0 + dy, z }, v, o: [ undefined, { mass: 1200, area: 4.2, volume: 1.6, height: 1.5, dt: 0.05 }, { mass: 0.3, area: 0.02, volume: 0.0004, height: 0.2, supported: true, waterDrag: false, dt: 0.2 } ][ ( i + j + 30 ) % 3 ] } );
}

test( 'Field.acceleration gives the same result as the allocating version on real flood samples', () => {
	let wet = 0, limited = 0;
	for ( const b of bodies ) {
		const want = reference( field, b.p, b.v, b.o, {} ), got = field.acceleration( b.p, b.v, b.o, {} );
		assert.deepEqual( got, want, `body at (${ b.p.x }, ${ b.p.y.toFixed( 2 ) }, ${ b.p.z })` );
		if ( got.wet > 0 ) wet ++;
		if ( got.limited ) limited ++;
	}
	console.log( JSON.stringify( { samples: bodies.length, wet, limited } ) );
	assert.ok( wet > 500 && wet < bodies.length - 500, `${ wet } of ${ bodies.length } samples wet: both branches must be exercised` );
} );
