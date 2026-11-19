// Built sites keep their ground clear of the camera-following pebble field.
// TerrainData.addClearZone marks a built site free of plants, rocks and debris, and DebrisPlacer honours it for
// every placed item (obs.clear), but the pebble density mask was painted from the terrain alone: the gravel
// path's pebbles and white shell grit sat on the terrain under the chairlift base deck and showed through its
// planks as white dots. Runs the real mask step on the real terrain with the sites reserved in App.js order
// (evacuation, then chairlift, then Debris).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { prepareChairliftSite } from '../src/chairlift/Route.js';
import { prepareEvacuationRoute } from '../src/evacuation/Route.js';
import { DebrisPlacer } from '../src/world/debris/DebrisPlacement.js';
import { Noise2D } from '../src/util/Noise.js';

const terrain = new TerrainData();
prepareEvacuationRoute( terrain );
const site = prepareChairliftSite( terrain, new CoastalRoute( terrain ) );
const maskOf = () => {

	const placer = { T: terrain, noise: new Noise2D( 5150 + 1 ), rocks: null, rockSpots: [] };
	DebrisPlacer.prototype._mask.call( placer );
	return placer.mask;

};

test( 'Pebble mask: no pebble, cobble or grit inside a built site, and the open ground keeps its mask byte for byte', () => {

	const mask = maskOf();
	const zones = terrain.clearZones;
	terrain.clearZones = [];
	const open = maskOf();
	terrain.clearZones = zones;
	const { data, res, texel } = mask;
	let inside = 0, dirty = 0, worst = 0, outsideChanged = 0;
	for ( let j = 0; j < res; j ++ ) for ( let i = 0; i < res; i ++ ) {

		const x = terrain.origin + ( i + 0.5 ) * texel, z = terrain.origin + ( j + 0.5 ) * texel, o = ( j * res + i ) * 4;
		if ( terrain.inClearZone( x, z ) ) {

			inside ++;
			const d = Math.max( data[ o ], data[ o + 1 ], data[ o + 2 ] );
			if ( d > 0 ) dirty ++;
			worst = Math.max( worst, d );

		} else if ( ! terrain.inClearZone( x, z, texel * 1.01 ) ) {

			for ( let c = 0; c < 4; c ++ ) if ( data[ o + c ] !== open.data[ o + c ] ) { outsideChanged ++; break; }

		}

	}
	assert.ok( inside > 100, `the reserved sites cover ${ inside } mask texels` );
	assert.equal( dirty, 0, `${ dirty } of ${ inside } texels inside built sites carry pebbles (densest ${ worst }/255)` );
	assert.equal( outsideChanged, 0, `${ outsideChanged } texels more than one texel outside every site changed` );
	// the base deck itself: the boarding point and 4 m around it read empty
	const b = site.base;
	for ( const [ dx, dz ] of [ [ 0, 0 ], [ 4, 0 ], [ - 4, 0 ], [ 0, 4 ], [ 0, - 4 ] ] ) {

		const i = Math.floor( ( b.x + dx - terrain.origin ) / texel ), j = Math.floor( ( b.z + dz - terrain.origin ) / texel ), o = ( j * res + i ) * 4;
		assert.deepEqual( [ data[ o ], data[ o + 1 ], data[ o + 2 ] ], [ 0, 0, 0 ], `pebble mask at the base deck (${ dx }, ${ dz }) m` );

	}

} );
