// Every drivable car's glass must draw as tinted see-through glass. The game's GLB loader
// (src/rally/VehicleModel.js loadModel) reads only baseColorFactor and alphaMode BLEND: a glTF
// material with neither is opaque white. The Petrel GT's import kept the source model's own
// "Glass" (KHR_materials_transmission only, no colour, opaque), so its windscreen, rear glass and
// roof glazing drew as a flat white slab. This test reads each car's real GLB and
// holds every material on its GlassPanels node to the importer's Glass palette entry: blended,
// mostly transparent, dark tinted.
//   node --test test/vehicle-glass.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VEHICLES } from '../src/rally/Vehicles.js';

const MAX_ALPHA = 0.9;        // above this the glass reads as a solid panel
const MAX_LUMINANCE = 0.25;   // linear; the palette's Glass is 0.07, the bug was 1.0 (white)

function gltfJson( file ) {
	const bytes = readFileSync( new URL( `../public/rally/${ file }.glb`, import.meta.url ) );
	const length = bytes.readUInt32LE( 12 );
	return JSON.parse( bytes.subarray( 20, 20 + length ).toString( 'utf8' ) );
}

for ( const [ key, car ] of Object.entries( VEHICLES ) ) {
	test( `${ car.name } (${ car.file }.glb) has tinted see-through glass`, () => {
		const gltf = gltfJson( car.file );
		const node = gltf.nodes.find( n => n.name === 'GlassPanels' );
		assert.ok( node && node.mesh != null, `${ key }: no GlassPanels mesh` );
		for ( const primitive of gltf.meshes[ node.mesh ].primitives ) {
			const m = gltf.materials[ primitive.material ];
			const [ r, g, b, a ] = m.pbrMetallicRoughness?.baseColorFactor ?? [ 1, 1, 1, 1 ];
			const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			assert.equal( m.alphaMode, 'BLEND', `${ key }: glass material "${ m.name }" is ${ m.alphaMode ?? 'OPAQUE' }` );
			assert.ok( a < MAX_ALPHA, `${ key }: glass "${ m.name }" alpha ${ a.toFixed( 2 ) }` );
			assert.ok( luminance < MAX_LUMINANCE, `${ key }: glass "${ m.name }" luminance ${ luminance.toFixed( 2 ) } (white slab)` );
		}
	} );
}
