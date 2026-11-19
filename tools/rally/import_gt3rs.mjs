// Adapt the approved 992 GT3 RS studio rig (4.572 m long, 2.457 m wheelbase).
// Run: node tools/rally/import_gt3rs.mjs <studio-directory>
// The source project's pinned glTF tools are build-time only. The island ships a
// plain GLB, metres, +Y up, +Z forward, origin on the road midway between axles.
import { Matrix4 } from '../../src/engine/math/index.js';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if ( ! process.argv[ 2 ] ) throw new Error( 'Pass the studio directory containing public/gt3rs.glb.' );
const studio = resolve( process.argv[ 2 ] );
const fromStudio = createRequire( join( studio, 'package.json' ) );
const { NodeIO } = fromStudio( '@gltf-transform/core' );
const { ALL_EXTENSIONS } = fromStudio( '@gltf-transform/extensions' );
const { compactPrimitive, dequantize, joinPrimitives, prune, transformPrimitive } = fromStudio( '@gltf-transform/functions' );

const { MeshoptDecoder, MeshoptSimplifier } = await import( fromStudio.resolve( 'meshoptimizer' ) );
await Promise.all( [ MeshoptDecoder.ready, MeshoptSimplifier.ready ] );

const io = new NodeIO().registerExtensions( ALL_EXTENSIONS ).registerDependencies( { 'meshopt.decoder': MeshoptDecoder } );
const doc = await io.read( join( studio, 'public/gt3rs.glb' ) );
await doc.transform( dequantize() );
doc.disposeExtension( 'EXT_meshopt_compression' );
const root = doc.getRoot(), scene = root.getDefaultScene();
const originals = root.listNodes();
const studioMeshes = root.listMeshes();
const named = new Map( originals.map( n => [ n.getName(), n ] ) );
const body = doc.createNode( 'BodyStatic' );
const wing = doc.createNode( 'RearWing' );
const glass = doc.createNode( 'GlassPanels' );
const cabin = doc.createNode( 'InteriorAssembly' );
body.addChild( glass ).addChild( cabin ).addChild( wing );
scene.addChild( body );
const mounts = new Map();
const identity = new Matrix4();

// The solver numbers its negative-X contact first. The maker calls that corner FR.
// The carrier steers with the calliper; only the disc, rim and tyre spin about the cambered axle.
for ( const [ corner, name ] of Object.entries( { FR: 'WheelFrontL', FL: 'WheelFrontR', RR: 'WheelRearL', RL: 'WheelRearR' } ) ) {
	const hub = named.get( 'WheelMount_' + corner );
	const carrier = doc.createNode( name ).setTranslation( hub.getWorldTranslation() );
	const knuckle = doc.createNode( name + 'Camber' ).setRotation( hub.getWorldRotation() );
	const roll = doc.createNode( name + 'Roll' );
	scene.addChild( carrier );
	carrier.addChild( knuckle );
	knuckle.addChild( roll );
	const inverse = new Matrix4().fromArray( hub.getWorldMatrix() ).invert();
	mounts.set( hub, { target: knuckle, inverse } );
	mounts.set( named.get( 'Roll_' + corner ), { target: roll, inverse } );
}

const buckets = new Map();
function batchPart( target, prim ) {
	const key = [ target.getName(), prim.getMaterial().getName(), ...prim.listSemantics().sort() ].join( '/' );
	if ( ! buckets.has( key ) ) buckets.set( key, { target, primitives: [] } );
	buckets.get( key ).primitives.push( prim );
}

// The studio batched the foil's carbon upper skin and three hinge finishes
// together with unrelated cabin parts of the same material. These are separate
// mesh islands: every triangle in this clear volume above the rear deck is wing.
function separateWingHardware( prim ) {
	const pos = prim.getAttribute( 'POSITION' ).getArray();
	const indices = prim.getIndices().getArray(), hardware = [], interior = [];
	const onWing = i => pos[ i * 3 + 1 ] > 1.05 && pos[ i * 3 + 2 ] < -1.72;
	for ( let i = 0; i < indices.length; i += 3 ) {
		const a = indices[ i ], b = indices[ i + 1 ], c = indices[ i + 2 ];
		const match = onWing( a );
		if ( onWing( b ) !== match || onWing( c ) !== match ) throw new Error( 'Wing volume intersects a connected studio surface' );
		( match ? hardware : interior ).push( a, b, c );
	}
	if ( ! hardware.length ) return;
	const foil = prim.clone();
	foil.setIndices( prim.getIndices().clone().setArray( new Uint32Array( hardware ) ) );
	prim.setIndices( prim.getIndices().clone().setArray( new Uint32Array( interior ) ) );
	compactPrimitive( foil );
	compactPrimitive( prim );
	batchPart( wing, foil );
}

let originalTris = 0;
for ( const node of originals ) {
	const mesh = node.getMesh();
	if ( ! mesh ) continue;
	let mount;
	for ( let n = node; n && ! mount; n = n.getParentNode() ) mount = mounts.get( n );
	const matrix = new Matrix4().fromArray( node.getWorldMatrix() ).premultiply( mount?.inverse || identity ).elements;
	for ( const prim of mesh.listPrimitives() ) {
		const material = prim.getMaterial();
		const name = material.getName();
		const count = prim.getIndices().getCount();
		originalTris += count / 3;
		// These internals sit behind opaque bodywork, including from underneath.
		if ( /^(MAT_Pwr_(Battery|Filter|Belt)|MAT_Fluid_Reservoir)$/.test( name ) ) continue;
		const glazing = /^MAT_Glass_(Clear|Tint)$/.test( name );
		const isWing = /^Web_Factory_(Wing_|DRS_)/.test( node.getName() );
		const target = mount?.target || ( isWing ? wing : glazing ? glass : /^Web_Cabin_/.test( node.getName() ) ? cabin : body );
		const keepUV = !! material.getBaseColorTexture();
		for ( const semantic of prim.listSemantics() ) {
			if ( ! [ 'POSITION', 'NORMAL', 'COLOR_0' ].includes( semantic ) && ! ( keepUV && semantic === 'TEXCOORD_0' ) ) prim.setAttribute( semantic, null );
		}
		compactPrimitive( prim );
		transformPrimitive( prim, matrix );
		const pos = prim.getAttribute( 'POSITION' ).getArray();
		const normal = prim.getAttribute( 'NORMAL' ).getArray();
		// Positions stay on original vertices. Limit shell error so adjacent painted
		// panels retain their seam, yet allow hidden/tiny mechanical details to collapse.
		const skin = /Factory_Body|Glass_(Tint|Clear)|Plate_/.test( name );
		const tolerance = skin ? 0.0030 : 0.004; // metre-scaled appearance error, including triangle regularity
		const fraction = skin ? 0.066 : 0.018;
		if ( count > 180 ) {
			// AO changes sharply at panel returns. Reducing on positions alone stretches
			// that dark edge across the white apron. Include baked light and decal UVs.
			const colour = prim.getAttribute( 'COLOR_0' );
			const uv = prim.getAttribute( 'TEXCOORD_0' );
			const directionWeight = skin ? 1.0 : 0.006;
			const weights = [ directionWeight, directionWeight, directionWeight, skin ? 0.05 : 0.004 ];
			if ( uv ) weights.push( 0.006, 0.006 );
			const attributes = new Float32Array( pos.length / 3 * weights.length );
			const c = [], st = [];
			for ( let i = 0; i < pos.length / 3; i ++ ) {
				const at = i * weights.length;
				attributes[ at ] = normal[ i * 3 ];
				attributes[ at + 1 ] = normal[ i * 3 + 1 ];
				attributes[ at + 2 ] = normal[ i * 3 + 2 ];
				attributes[ at + 3 ] = colour ? colour.getElement( i, c )[ 0 ] : 1;
				if ( uv ) {
					uv.getElement( i, st );
					attributes[ at + 4 ] = st[ 0 ];
					attributes[ at + 5 ] = st[ 1 ];
				}
			}
			let [ indices ] = MeshoptSimplifier.simplifyWithAttributes(
				new Uint32Array( prim.getIndices().getArray() ), pos, 3, attributes, weights.length, weights, null,
				3 * Math.max( 32, Math.floor( count * fraction / 3 ) ), tolerance,
				skin ? [ 'LockBorder', 'RegularizeLight', 'PreserveFolds', 'ErrorAbsolute' ] : [ 'Permissive', 'ErrorAbsolute' ],
			);
			// Thousands of individual fins behind the grille and machined fittings inside
			// the cabin shrink below a pixel in chase view. Cluster only those batches.
			const core = name === 'MAT_Radiator_Core';
			const fittings = target === cabin && name === 'MAT_Metal_Alu_Machined';
			if ( ( core || fittings ) && indices.length > 9000 ) {
				const [ clustered ] = MeshoptSimplifier.simplifySloppy( indices, pos, 3, null, 9000, 0.12 );
				if ( clustered.length ) indices = clustered;
			}
			prim.setIndices( doc.createAccessor().setType( 'SCALAR' ).setArray( indices ).setBuffer( root.listBuffers()[ 0 ] ) );
			compactPrimitive( prim );
		}
		if ( target === cabin && /^(MAT_Carbon_Matte|MAT_Metal_Alu_(Black|Machined))$/.test( name ) ) separateWingHardware( prim );
		batchPart( target, prim );
	}
}

let triangles = 0;
for ( const { target, primitives } of buckets.values() ) {
	const batch = primitives.length === 1 ? primitives[ 0 ] : joinPrimitives( primitives );
	// The studio AO bake is 8-bit. Restore that precision after simplification.
	// RGBA8 maps directly to a WebGPU vertex format and costs four bytes per vertex.
	const ao = batch.getAttribute( 'COLOR_0' );
	if ( ao ) {
		const packed = new Uint8Array( ao.getCount() * 4 );
		const colour = [];
		for ( let i = 0; i < ao.getCount(); i ++ ) {
			ao.getElement( i, colour );
			for ( let c = 0; c < 3; c ++ ) packed[ i * 4 + c ] = Math.round( colour[ c ] * 255 );
			packed[ i * 4 + 3 ] = 255;
		}
		batch.setAttribute( 'COLOR_0', doc.createAccessor().setType( 'VEC4' ).setNormalized( true )
			.setArray( packed ).setBuffer( root.listBuffers()[ 0 ] ) );
	}
	const mesh = target.getMesh() || doc.createMesh( target.getName() );
	target.setMesh( mesh.addPrimitive( batch ) );
	triangles += batch.getIndices().getCount() / 3;
}
for ( const [ from, to ] of Object.entries( {
	MAT_LED_Optic: 'HeadlampLED', MAT_Tail_LED: 'TailLampLED',
	MAT_Factory_Body_Clearcoat: 'BodyPaint', MAT_Factory_Body_with_GT3_RS_Vinyl: 'BodyPaintVinyl',
} ) ) root.listMaterials().find( m => m.getName() === from ).setName( to );
for ( const node of originals ) node.dispose();
for ( const mesh of studioMeshes ) mesh.dispose();
await doc.transform( prune() );
root.getAsset().generator = 'Tidewater tools/rally/import_gt3rs.mjs (generated, do not edit by hand)';
const output = fileURLToPath( new URL( '../../public/rally/cosier_gt3rs.glb', import.meta.url ) );
await io.write( output, doc );
execFileSync( process.execPath, [ fileURLToPath( new URL( '../distribution-assets.mjs', import.meta.url ) ), 'pack', 'gt3' ] );
console.log( `${ originalTris } studio triangles -> ${ triangles } game triangles in ${ buckets.size } batches` );
