import { Group, Mesh, BufferGeometry, BufferAttribute, Color, Vector3, Matrix4 } from '../engine/index.js';
import { loadGLB, decodeImage } from '../engine/loaders/GLTF.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';

// Rally's original untextured GLBs retain their complete authored hierarchy,
// materials and wheel pivots. Only the renderer-facing material is adapted.
export async function loadVehicle( name, withPlates = true ) {
	const model = await loadModel( `${ import.meta.env.BASE_URL }rally/${ name }.glb`, { studioMaps: name === 'cosier_gt3rs' } );
	if ( withPlates && PLATES[ name ] ) {
		platePromise ||= loadVehicle( 'cosier_plate', false ).then( paintPlate );
		const plate = await platePromise;
		for ( const [ x, y, z, yaw ] of PLATES[ name ] ) {
			const copy = plate.root.clone();
			copy.position.set( x, y, z ); copy.rotation.y = yaw;
			copy.name = 'LicensePlateMount';
			model.root.add( copy );
		}
	}
	return model;
}

// A rigid GLB (cars, the ferry, the terminal): nodes as named pivots, glTF PBR factors
// mapped to engine materials, alpha-blended ones on the transparent layer. `customize( source,
// options )` may extend a material's options (shader snippets) by its glTF source before it is built.
export async function loadModel( url, { customize = null, studioMaps = false } = {} ) {
	const gltf = await loadGLB( url );
	const materials = await Promise.all( gltf.materials.map( async source => {
		const pbr = source.pbrMetallicRoughness || {};
		const rgba = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
		const coat = source.extensions?.KHR_materials_clearcoat;
		const options = {
			name: source.name,
			color: new Color( ...rgba.slice( 0, 3 ) ),
			emissive: new Color( ...( source.emissiveFactor || [ 0, 0, 0 ] ) ),
			metalness: pbr.metallicFactor ?? 1,
			roughness: pbr.roughnessFactor ?? 1,
			opacity: rgba[ 3 ],
			transparent: source.alphaMode === 'BLEND',
			velocityWeight: source.alphaMode === 'BLEND' ? 0 : 1,
			side: source.doubleSided ? 'double' : 'front',
			surface: coat ? `s.clearcoat = ${ ( coat.clearcoatFactor || 0 ).toFixed( 5 ) }; s.clearcoatRoughness = ${ ( coat.clearcoatRoughnessFactor || 0 ).toFixed( 5 ) };` : '',
		};
		if ( studioMaps ) {
			options.vertexColors = true; // occlusion baked into the studio rig
			options.textures = {};
			if ( pbr.baseColorTexture ) {
				options.textures.carAlbedo = await readMap( gltf, pbr.baseColorTexture, true );
				const sampler = options.textures.carAlbedo.sampler === 'anisoClamp' ? 'smpAnisoClamp' : 'smpAnisoRepeat';
				options.surface += `let decal = textureSample( carAlbedo, ${ sampler }, in.uv ); s.albedo *= decal.rgb; s.alpha *= decal.a;`;
			}
			if ( source.normalTexture ) {
				options.textures.carNormal = await readMap( gltf, source.normalTexture, false );
				const sampler = options.textures.carNormal.sampler === 'anisoClamp' ? 'smpAnisoClamp' : 'smpAnisoRepeat';
				options.surface += `let n = textureSample( carNormal, ${ sampler }, in.uv ).xyz * 2.0 - 1.0; s.normal = perturbNormalByMap( in.P, in.N, in.uv, n );`;
			}
		}
		return new Material( customize ? customize( source, options ) : options );
	} ) );
	const root = new Group(), pivots = new Map();
	let parts = 0;
	const nodes = gltf.nodes.map( source => {
		const node = new Group();
		node.name = source.name;
		node.position.fromArray( source.t );
		if ( /^Wheel(Front|Rear)[LR]$/.test( source.name ) ) node.userData.loadedRadius = source.t[ 1 ];
		node.quaternion.fromArray( source.r );
		node.scale.fromArray( source.s );
		pivots.set( source.name, node );
		for ( const primitive of gltf.meshes[ source.mesh ] || [] ) {
			if ( primitive.mode !== 4 ) throw new Error( 'Rally vehicle requires triangle geometry' );
			const geometry = new BufferGeometry();
			for ( const [ key, attribute ] of Object.entries( primitive.attributes ) ) {
				const target = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', COLOR_0: 'color' }[ key ];
				if ( target ) geometry.setAttribute( target, new BufferAttribute( attribute.array, attribute.itemSize, attribute.normalized ) );
			}
			if ( primitive.indices ) geometry.setIndex( new BufferAttribute( primitive.indices, 1 ) );
			geometry.computeBoundingSphere();
			const material = materials[ primitive.material ];
			const mesh = new Mesh( geometry, material );
			mesh.castShadow = ! material.transparent;
			mesh.layers.set( material.transparent ? LAYERS.TRANSPARENT : LAYERS.OPAQUE );
			node.add( mesh );
			parts ++;
		}
		return node;
	} );
	for ( let i = 0; i < nodes.length; i ++ ) for ( const child of gltf.nodes[ i ].children ) nodes[ i ].add( nodes[ child ] );
	for ( const index of gltf.roots ) root.add( nodes[ index ] );
	return { root, pivots, parts };
}

// The studio export embeds its vinyl, badges and moulded tyre relief. glTF image
// rows and UVs both start at the top, including the colour maps on the far door.
async function readMap( gltf, info, srgb ) {
	const map = gltf.textures[ info.index ];
	const image = gltf.images[ map.source ];
	const clamp = gltf.json.samplers?.[ map.sampler ]?.wrapS === 33071; // glTF CLAMP_TO_EDGE on the studio decals
	const { data, width, height } = await decodeImage( image.bytes, image.mimeType );
	const texture = new Texture( {
		label: 'carMap' + info.index, width, height, data, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
		mips: true, usage: [ 'sample', 'copyDst' ], sampler: clamp ? 'anisoClamp' : 'anisoRepeat',
	} );
	texture.getGPU();
	generateMipmaps( texture );
	return texture;
}

let platePromise;
const PLATE_TEXT = '@cosier';
const PLATE_FONT = '"DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const INK = '#f4f4f1', FACE = '#1c1c1d', BAND = '#c42421', BEVEL = 0.008;

// The plate's face as one texture on a quad over the flat of its black face: sharp at any distance,
// where modelled glyphs fused. The modelled border, band and lettering are removed from the graph,
// not hidden: the damage rig and remote clones copy every mesh they find, and a copied lettering
// mesh sits 0.1 to 5 mm proud of the texture and doubles every glyph and the border.
function paintPlate( plate ) {
	let face = null;
	const dropped = [];
	plate.root.traverse( m => {
		if ( ! m.isMesh ) return;
		if ( m.material.name === 'PlateBlack' ) face = m;
		else if ( m.material.name === 'PlateWhite' || m.material.name === 'PlateBand' ) dropped.push( m );
	} );
	if ( ! face ) return plate;
	for ( const m of dropped ) m.parent.remove( m );
	const pos = face.geometry.attributes.position.array, lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( let i = 0; i < pos.length; i += 3 ) for ( let k = 0; k < 3; k ++ ) { lo[ k ] = Math.min( lo[ k ], pos[ i + k ] ); hi[ k ] = Math.max( hi[ k ], pos[ i + k ] ); }
	const x0 = lo[ 0 ] + BEVEL, x1 = hi[ 0 ] - BEVEL, y0 = lo[ 1 ] + BEVEL, y1 = hi[ 1 ] - BEVEL, z = hi[ 2 ] + 0.0004;
	const width = 2048, height = 512;
	const texture = new Texture( { label: 'plateFace', width, height, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'anisoClamp', data: drawPlate( width, height, 1000 * ( x1 - x0 ), 1000 * ( y1 - y0 ) ) } );
	texture.getGPU();
	generateMipmaps( texture );
	const material = new Material( {
		name: 'PlateFace', roughness: 0.42, metalness: 0.05, textures: { plateFace: texture },
		surface: 'let c = textureSampleBias( plateFace, smpAnisoClamp, in.uv, -0.6 ); s.albedo = c.rgb; s.roughness = mix( 0.46, 0.34, c.g );',
	} );
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [ x0, y1, z, x1, y1, z, x0, y0, z, x1, y0, z ] ), 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( [ 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1 ] ), 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( [ 0, 0, 1, 0, 0, 1, 1, 1 ] ), 2 ) );
	geometry.setIndex( new BufferAttribute( new Uint16Array( [ 0, 2, 1, 1, 2, 3 ] ), 1 ) );
	geometry.computeBoundingSphere();
	const quad = new Mesh( geometry, material );
	quad.name = 'Plate face';
	quad.castShadow = false;
	quad.layers.set( LAYERS.OPAQUE );
	face.parent.add( quad );
	return plate;
}

// RGBA8 pixels of the face (W x H millimetres), laid out in millimetres from its top left.
function drawPlate( width, height, W, H ) {
	const canvas = new OffscreenCanvas( width, height ), g = canvas.getContext( '2d', { willReadFrequently: true } );
	g.scale( width / W, height / H );
	g.fillStyle = FACE; g.fillRect( 0, 0, W, H );
	g.strokeStyle = INK; g.lineWidth = 6;
	g.beginPath(); g.roundRect( 3, 3, W - 6, H - 6, 4 ); g.stroke();
	g.fillStyle = BAND;
	g.beginPath(); g.roundRect( 13, 7, 86, H - 14, 2.5 ); g.fill();
	g.fillStyle = INK;
	for ( let k = 0; k < 12; k ++ ) {
		const a = k * Math.PI / 6, cx = 56 + 25 * Math.cos( a ), cy = 47.5 - 25 * Math.sin( a );
		g.beginPath();
		for ( let i = 0; i < 10; i ++ ) { const r = i % 2 ? 1.9 : 4.6, b = - Math.PI / 2 + i * Math.PI / 5; g.lineTo( cx + r * Math.cos( b ), cy + r * Math.sin( b ) ); }
		g.closePath(); g.fill();
	}
	fitText( g, 'TW', 56, 117.5, 70, 27 );
	fitText( g, PLATE_TEXT, ( 121 + 656 ) / 2, ( 26 + 123 ) / 2, 656 - 121, 123 - 26 );
	return new Uint8Array( g.getImageData( 0, 0, width, height ).data.buffer );
}

// Bold white lettering scaled (never stretched) to its ink box and centred on it by its inked bounds.
function fitText( g, text, cx, cy, w, h ) {
	g.font = `bold 100px ${ PLATE_FONT }`;
	const m = g.measureText( text ), iw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, ih = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
	const s = Math.min( w / iw, h / ih );
	g.save();
	g.translate( cx, cy ); g.scale( s, s );
	g.textBaseline = 'alphabetic'; g.textAlign = 'left';
	g.fillText( text, - ( m.actualBoundingBoxRight - m.actualBoundingBoxLeft ) / 2, ( m.actualBoundingBoxAscent - m.actualBoundingBoxDescent ) / 2 );
	g.restore();
}
const PLATES = {
	aster_rs: [ [ 0, 0.532, - 2.27, Math.PI ], [ 0, 0.41, 2.29, 0 ] ],
	// Over the plates built into the Jeep's bumpers (rear one beside the spare wheel).
	black_jeep: [ [ - 0.55, 0.79, - 2.373, Math.PI ], [ 0, 0.79, 2.413, 0 ] ],
	// From the import's plate report (assets/rally/asset_report.json plates_gltf_xyz_yaw).
	concept_gt: [ [ 0, 0.315, - 2.007, Math.PI ], [ 0, 0.41, 2.337, 0 ] ],
	// From assets/rally/fulmine_v10_report.json plates_gltf_xyz_yaw (tools/rally/build_fulmine_v10.py).
	fulmine_v10: [ [ 0, 0.6, - 2.218, Math.PI ], [ 0, 0.26, 2.316, 0 ] ],
	// From assets/rally/corsaire_w16_report.json (tools/rally/build_corsaire_w16.py).
	corsaire_w16: [ [ 0, 0.66, - 2.248, Math.PI ], [ 0, 0.26, 2.246, 0 ] ],
	// From assets/rally/sandpiper_report.json (tools/rally/build_sandpiper.py): under the valance, on the nose.
	sandpiper: [ [ 0, 0.4, - 1.528, Math.PI ], [ 0, 0.5, 1.626, 0 ] ],
	support_wagon: [ [ 0, 0.695, - 2.493, Math.PI ] ],
	support_pickup: [ [ 0, 0.452, - 2.798, Math.PI ] ],
};

export function cloneVehicle( model ) {
	// A remote car never inherits the local car's damage: leave the rig out, show the originals.
	const rigs = model.root.children.filter( child => child.userData.damageRig );
	for ( const rig of rigs ) model.root.remove( rig );
	const root = model.root.clone(), pivots = new Map();
	for ( const rig of rigs ) model.root.add( rig );
	const show = ( a, b ) => {
		if ( hiddenByDamage.has( a ) ) b.visible = true;
		a.children.forEach( ( child, i ) => b.children[ i ] && show( child, b.children[ i ] ) );
	};
	if ( rigs.length ) show( model.root, root );
	root.traverse( node => { if ( node.name ) pivots.set( node.name, node ); } );
	return { root, pivots, parts: model.parts };
}

// Damage rig: the local car's breakable copy. Each mesh `assign.kind` accepts is hidden on
// the shared model and redrawn from owned position/normal arrays (dents never reach the
// loaded GLB or remote clones), split by triangle into one mesh per named part. The rig
// hangs under the car root; cloneVehicle leaves it out and shows the originals again.
export const hiddenByDamage = new WeakSet();

export function buildDamageRig( model, assign ) {
	const root = model.root;
	root.updateMatrixWorld( true );
	const inverse = root.matrixWorld.clone().invert(), centroid = new Vector3(), facing = new Vector3(), edge = new Vector3();
	const corner = [ new Vector3(), new Vector3(), new Vector3() ];
	const group = new Group();
	group.name = 'DamageRig';
	group.userData.damageRig = true;
	const sources = [], parts = new Map(), owned = new Map(), meshes = [];
	root.traverse( node => { if ( node.isMesh ) meshes.push( node ); } );
	for ( const mesh of meshes ) {
		const path = [];
		for ( let n = mesh; n && n !== root; n = n.parent ) path.push( n.name || '' );
		// A mesh the model does not draw stays undrawn: the rig must not resurrect it.
		if ( ! mesh.visible ) continue;
		const kind = assign.kind( mesh, path ), geometry = mesh.geometry, position = geometry.attributes.position;
		if ( ! kind || ! position ) continue;
		const normal = geometry.attributes.normal, count = position.count;
		const rel = new Matrix4().multiplyMatrices( inverse, mesh.matrixWorld );
		const pos = new BufferAttribute( new Float32Array( position.array ), 3 );
		const nor = normal ? new BufferAttribute( new Float32Array( normal.array ), 3 ) : null;
		const index = geometry.index ? geometry.index.array : Uint32Array.from( { length: count }, ( _, i ) => i );
		const src = { kind, rel, relInverse: rel.clone().invert(), pos, nor, base: new Float32Array( position.array ), baseNormal: normal ? new Float32Array( normal.array ) : null,
			index, sphere: geometry.boundingSphere, scale: new Vector3().setFromMatrixScale( rel ).x || 1 };
		sources.push( src );
		const buckets = new Map(), P = src.base;
		for ( let t = 0; t < index.length; t += 3 ) {
			for ( let k = 0; k < 3; k ++ ) { const v = index[ t + k ] * 3; corner[ k ].set( P[ v ], P[ v + 1 ], P[ v + 2 ] ).applyMatrix4( rel ); }
			centroid.copy( corner[ 0 ] ).add( corner[ 1 ] ).add( corner[ 2 ] ).multiplyScalar( 1 / 3 );
			// Car-local face normal, so one glass primitive can split into screens and side windows.
			facing.subVectors( corner[ 1 ], corner[ 0 ] ).cross( edge.subVectors( corner[ 2 ], corner[ 0 ] ) ).normalize();
			const part = assign.part( kind, centroid, facing ) || '';
			let bucket = buckets.get( part );
			if ( ! bucket ) buckets.set( part, bucket = { list: [], sum: new Vector3(), n: 0 } );
			bucket.list.push( index[ t ], index[ t + 1 ], index[ t + 2 ] );
			bucket.sum.add( centroid ); bucket.n ++;
		}
		let material = mesh.material;
		if ( assign.own?.( material, kind ) ) {
			if ( ! owned.has( material ) ) owned.set( material, { material: material.clone(), kind } );
			material = owned.get( material ).material;
		}
		for ( const [ part, { list, sum, n } ] of buckets ) {
			const piece = new BufferGeometry();
			for ( const [ key, attribute ] of Object.entries( geometry.attributes ) ) piece.setAttribute( key, key === 'position' ? pos : key === 'normal' && nor ? nor : attribute );
			piece.setIndex( new BufferAttribute( count > 65535 ? new Uint32Array( list ) : new Uint16Array( list ), 1 ) );
			piece.computeBoundingSphere();
			const sub = new Mesh( piece, material );
			rel.decompose( sub.position, sub.quaternion, sub.scale );
			sub.castShadow = mesh.castShadow;
			sub.receiveShadow = mesh.receiveShadow;
			sub.layers.set( material.transparent ? LAYERS.TRANSPARENT : LAYERS.OPAQUE );
			group.add( sub );
			if ( ! part ) continue;
			let entry = parts.get( part );
			if ( ! entry ) parts.set( part, entry = { name: part, meshes: [], sum: new Vector3(), n: 0, anchor: new Vector3() } );
			entry.meshes.push( { mesh: sub, source: src, index: list } );
			entry.sum.add( sum ); entry.n += n;
			entry.anchor.copy( entry.sum ).multiplyScalar( 1 / entry.n );
		}
		mesh.visible = false;
		hiddenByDamage.add( mesh );
	}
	root.add( group );
	return { group, sources, parts, materials: [ ...owned.values() ] };
}
