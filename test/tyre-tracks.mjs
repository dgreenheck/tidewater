import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../src/engine/index.js';
import { TyreTracks } from '../src/rally/TyreTracks.js';
import { VEHICLES } from '../src/rally/Vehicles.js';

const terrain = rock => ( { res: 16, texel: 1, origin: - 8,
	sand: new Uint8Array( 256 ).fill( rock ? 0 : 255 ), rock: new Float32Array( 256 ).fill( rock ? 1 : 0 ),
	heightAt: () => 2, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) } );
function sample( x, { grounded = true, load = 3000, height = 2, slip = 0 } = {} ) {
	const s = new Float32Array( 69 ); s[ 6 ] = 1;
	for ( let wheel = 0; wheel < 4; wheel ++ ) {
		const v = 13 + wheel * 4, c = 29 + wheel * 10;
		s[ v + 3 ] = Number( grounded ); s[ v + 2 ] = 4;
		s.set( [ x + ( wheel % 2 ? 0.8 : - 0.8 ), height, wheel < 2 ? 1.3 : - 1.3, 0, 1, 0, load, slip, 4, 0 ], c );
	}
	return s;
}
test( 'Only moving, loaded ground contacts create terrain-conforming impressions', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 128 );
	tracks.emit( 'car', sample( 0 ), VEHICLES.aster );
	tracks.emit( 'car', sample( 0 ), VEHICLES.aster ); assert.equal( tracks.count, 0 );
	tracks.emit( 'car', sample( 0.5 ), VEHICLES.aster ); assert.ok( tracks.count > 0 );
	const positions = tracks.attributes.position.array;
	for ( let vertex = 0; vertex < tracks.count * 6; vertex ++ ) assert.ok( Math.abs( positions[ vertex * 3 + 1 ] - 2.012 ) < 0.0001 );
} );
for ( const reason of [ { grounded: false }, { load: 0 }, { height: 3 }, { height: - 0.5 } ] ) test( `No mark on invalid contact ${ JSON.stringify( reason ) }`, () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 128 );
	tracks.emit( 'car', sample( 0, reason ), VEHICLES.aster ); tracks.emit( 'car', sample( 1, reason ), VEHICLES.aster );
	assert.equal( tracks.count, 0 );
} );
test( 'Rock gets skid scuffs only under slip and teleports never draw a connecting stripe', () => {
	const tracks = new TyreTracks( new Scene(), terrain( true ), 128 );
	tracks.emit( 'car', sample( 0 ), VEHICLES.aster ); tracks.emit( 'car', sample( 1 ), VEHICLES.aster ); assert.equal( tracks.count, 0 );
	tracks.emit( 'car', sample( 1, { slip: 0.8 } ), VEHICLES.aster ); tracks.emit( 'car', sample( 2, { slip: 0.8 } ), VEHICLES.aster ); assert.ok( tracks.count > 0 );
	const before = tracks.count;
	tracks.emit( 'car', sample( 100, { slip: 0.8 } ), VEHICLES.aster ); assert.equal( tracks.count, before );
} );

// A car heading along `yaw` (forward = sin, cos), its four contacts at the corners. `rich` builds the
// 96-float snapshot with per-wheel slip ratio, slip angle, surface kind and the submerged fraction.
function car( px, pz, yaw, o = {} ) {
	const { rich = false, grounded = true, load = 3000, height = 2, slip = 0, speed = 8, lateral = 0,
		ratio = 0, angle = 0, kind = 0, submerged = 0 } = o;
	const rolling = o.rolling ?? speed;
	const s = new Float32Array( rich ? 96 : 69 );
	s.set( [ px, height + 0.3, pz, 0, Math.sin( yaw / 2 ), 0, Math.cos( yaw / 2 ) ], 0 );
	const fx = Math.sin( yaw ), fz = Math.cos( yaw ), rx = Math.cos( yaw ), rz = - Math.sin( yaw );
	for ( let wheel = 0; wheel < 4; wheel ++ ) {
		const side = wheel % 2 ? 0.8 : - 0.8, ahead = wheel < 2 ? 1.3 : - 1.3;
		s.set( [ 0.3, 0, rolling, Number( grounded ) ], 13 + wheel * 4 );
		s.set( [ px + rx * side + fx * ahead, height, pz + rz * side + fz * ahead, 0, 1, 0, load, slip, speed, lateral ], 29 + wheel * 10 );
		if ( rich ) { s[ 81 + wheel ] = ratio; s[ 85 + wheel ] = angle; s[ 89 + wheel ] = kind; }
	}
	if ( rich ) s[ 73 ] = submerged;
	return s;
}
const paved = kind => ( { ...terrain( false ), roadSurfaceAt: () => ( { kind } ) } );
// Quad corners as written: vertex 0 start-left, 2 start-right, 1 end-left, 5 end-right.
function quads( tracks ) {
	const p = tracks.attributes.position.array, out = [];
	for ( let q = 0; q < tracks.count; q ++ ) {
		const at = j => [ p[ ( q * 6 + j ) * 3 ], p[ ( q * 6 + j ) * 3 + 2 ] ];
		out.push( { start: [ at( 0 ), at( 2 ) ], end: [ at( 1 ), at( 5 ) ] } );
	}
	return out;
}
const near = ( a, b ) => Math.abs( a[ 0 ] - b[ 0 ] ) < 1e-5 && Math.abs( a[ 1 ] - b[ 1 ] ) < 1e-5;
const span = q => Math.hypot( q.start[ 0 ][ 0 ] - q.start[ 1 ][ 0 ], q.start[ 0 ][ 1 ] - q.start[ 1 ][ 1 ] );
const vertexValues = ( tracks, name, component, from = 0 ) => {
	const attribute = tracks.attributes[ name ], out = [];
	for ( let vertex = from * 6; vertex < tracks.count * 6; vertex ++ ) out.push( attribute.array[ vertex * attribute.itemSize + component ] );
	return out;
};

for ( const pace of [ 0.03, 0.6 ] ) test( `A curved route at ${ pace } m per frame prints continuous strips with shared edges`, () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 4000 );
	const radius = 9;
	for ( let travelled = 0; travelled < 14; travelled += pace ) {
		const turn = travelled / radius;
		tracks.emit( 'car', car( radius * Math.sin( turn ), radius * Math.cos( turn ), turn + Math.PI / 2 ), VEHICLES.aster );
	}
	const all = quads( tracks );
	assert.ok( all.length > 100, `only ${ all.length } quads` );
	let breaks = 0;
	for ( const q of all ) if ( ! all.some( o => o !== q && near( o.end[ 0 ], q.start[ 0 ] ) && near( o.end[ 1 ], q.start[ 1 ] ) ) ) breaks ++;
	assert.equal( breaks, 4, 'one strip per wheel, no kinks or gaps between segments' );
} );

test( 'Imprint width follows the vehicle tread and narrows to the contact patch when the tyre slides sideways', () => {
	const widest = ( profile, sideways ) => {
		const tracks = new TyreTracks( new Scene(), terrain( false ), 256 );
		for ( let step = 0; step <= 10; step ++ ) tracks.emit( 'car', sideways ? car( step * 0.3, 0, 0 ) : car( 0, step * 0.3, 0 ), profile );
		return Math.max( ...quads( tracks ).map( span ) );
	};
	const aster = widest( VEHICLES.aster, false ), jeep = widest( VEHICLES.jeep, false ), sliding = widest( VEHICLES.aster, true );
	assert.ok( aster >= VEHICLES.aster.width - 1e-6, `aster ${ aster }` );
	assert.ok( jeep > aster * 1.4, `jeep ${ jeep } vs aster ${ aster }` );
	assert.ok( sliding < aster * 0.6, `sliding ${ sliding } vs rolling ${ aster }` );
} );

test( 'Asphalt keeps no print while rolling and takes rubber only when the tyre locks', () => {
	const tracks = new TyreTracks( new Scene(), paved( 'asphalt' ), 256 );
	for ( let step = 0; step <= 6; step ++ ) tracks.emit( 'car', car( 0, step * 0.4, 0, { slip: 0.15 } ), VEHICLES.aster );
	assert.equal( tracks.count, 0 );
	for ( let step = 7; step <= 12; step ++ ) tracks.emit( 'car', car( 0, step * 0.4, 0, { rolling: 0 } ), VEHICLES.aster );
	assert.ok( tracks.count > 0 );
	assert.ok( vertexValues( tracks, 'aMark', 2 ).every( kind => kind === 3 ), 'asphalt rubber is surface kind 3' );
	assert.ok( vertexValues( tracks, 'aSlip', 0 ).every( ratio => ratio === - 1 ), 'lock-up is carried as slip ratio -1' );
} );

test( 'A 96-float snapshot drives classification from the physics slip ratio and surface fields', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 512 );
	const drive = ( from, to, o ) => { for ( let step = from; step <= to; step ++ ) tracks.emit( 'car', car( 0, step * 0.4, 0, { rich: true, ...o } ), VEHICLES.aster ); };
	// The terrain under the car is sand, but the physics reports asphalt and a freely rolling tyre.
	drive( 0, 5, { kind: 3, ratio: 0.03, angle: 0.02, slip: 0.3 } );
	assert.equal( tracks.count, 0 );
	drive( 6, 10, { kind: 3, ratio: - 1, rolling: 0 } );
	const locked = tracks.count;
	assert.ok( locked > 0 );
	assert.ok( vertexValues( tracks, 'aMark', 2 ).every( kind => kind === 3 ) );
	tracks.reset( 'car' );
	drive( 20, 26, { kind: 0, ratio: 0.7, rolling: 14 } );
	assert.ok( tracks.count > locked );
	assert.ok( vertexValues( tracks, 'aSlip', 0, locked ).every( ratio => Math.abs( ratio - 0.7 ) < 1e-6 ), 'wheelspin ratio reaches the shader' );
	assert.ok( vertexValues( tracks, 'aMark', 2, locked ).every( kind => kind === 0 ) );
	const printed = tracks.count;
	for ( const o of [ { kind: 6 }, { kind: 5 }, { kind: 0, submerged: 0.8 } ] ) { tracks.reset( 'car' ); drive( 40, 46, o ); }
	assert.equal( tracks.count, printed, 'water, wooden props and a floating car keep no print' );
	tracks.reset( 'car' ); drive( 60, 64, { kind: 7 } );
	assert.ok( tracks.count > printed, 'wet sand prints' );
	assert.ok( vertexValues( tracks, 'aMark', 2, printed ).every( kind => kind === 0 ), 'wet sand is printed as sand' );
	assert.ok( vertexValues( tracks, 'aSlip', 1, printed ).every( wet => wet === 1 ), 'with full wetness' );
} );

test( 'A tyre locked into a slide on sand leaves a bulldozed mound where it stops', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 256 );
	for ( let step = 0; step <= 8; step ++ ) tracks.emit( 'car', car( 0, step * 0.25, 0, { rich: true, ratio: - 1, rolling: 0, speed: 6 } ), VEHICLES.jeep );
	const sliding = tracks.count;
	tracks.emit( 'car', car( 0, 2.01, 0, { rich: true, ratio: 0, rolling: 0, speed: 0 } ), VEHICLES.jeep );
	assert.equal( tracks.count, sliding + 4, 'one mound per locked wheel' );
	assert.ok( vertexValues( tracks, 'aSlip', 0, sliding ).every( ratio => ratio <= - 1.5 ) );
} );

test( 'Each emit uploads only the quads it wrote, also across the ring wrap', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 64 );
	for ( let step = 0; step < 12; step ++ ) {
		const ranges = tracks.attributes.position.updateRanges, from = ranges.length, cursor = tracks.cursor;
		tracks.emit( 'car', car( 0, step * 0.5, 0 ), VEHICLES.aster );
		const written = ( tracks.cursor - cursor + 64 ) % 64, added = ranges.slice( from );
		assert.ok( added.length <= 2, `${ added.length } ranges for one emit` );
		assert.equal( added.reduce( ( sum, range ) => sum + range.count, 0 ), written * 18 );
	}
	assert.equal( tracks.count, 64 );
} );

test( 'Resetting a car starts a fresh strip instead of bridging to the recovery point', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 256 );
	tracks.emit( 'car', car( 0, 0, 0 ), VEHICLES.aster ); tracks.emit( 'car', car( 0, 0.5, 0 ), VEHICLES.aster );
	const before = tracks.count;
	tracks.reset( 'car' ); tracks.emit( 'car', car( 0, 3, 0 ), VEHICLES.aster );
	assert.equal( tracks.count, before );
	assert.ok( quads( tracks ).every( q => Math.hypot( q.end[ 0 ][ 0 ] - q.start[ 0 ][ 0 ], q.end[ 0 ][ 1 ] - q.start[ 0 ][ 1 ] ) < 0.5 ) );
} );

test( 'stationary spinning rear tyres leave two contact patches without filling the ring buffer', () => {
	const tracks = new TyreTracks( new Scene(), terrain( false ), 128 );
	const s = new Float32Array( 96 );
	s.set( sample( 0 ) );
	s[ 93 ] = -1000;
	for ( let w = 0; w < 4; w ++ ) {
		s[ 89 + w ] = 3;
		s[ 37 + w * 10 ] = 0;
		s[ 15 + w * 4 ] = w < 2 ? 0 : 16;
		s[ 81 + w ] = w < 2 ? 0 : 16 / 3;
		s[ 36 + w * 10 ] = w < 2 ? 0 : 1;
	}
	for ( let i = 0; i < 120; i ++ ) tracks.emit( 'rs', s, VEHICLES.gt3rs );
	assert.equal( tracks.count, 2, 'one bounded rubber patch at each rear contact' );
	const p = tracks.attributes.position.array;
	const length = Math.abs( p[ 2 ] - p[ 5 ] );
	assert.ok( length >= 0.04 && length < 0.24, `rubber contact length ${ length.toFixed( 3 ) } m` );
} );
