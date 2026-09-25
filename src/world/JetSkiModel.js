import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from '../engine/index.js';
import { box, cylinder, prepare, mergePrepared, sphere, mat4 } from './boat/GeoKit.js';
import { createPropMaterial, PAT } from '../game/GameMaterials.js';
import { loadGLB, decodeImage } from '../engine/loaders/GLTF.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { standard } from '../materials/Materials.js';

// A compact personal watercraft built from the same PBR prop material as the village gameplay props.
// Its anchors and waterplane are deliberately compatible with BoatController so it shares the ocean,
// grounding and collision rules used by the lobster boat.
//
// Model frame: +Z forward, +Y up, +X port. y = 0 is the DESIGN WATERLINE (flat hull bottom at rest).
export class JetSkiModel {

	constructor() {

		this.group = new Group();
		this.group.name = 'JetSki';
		this.material = createPropMaterial( 'jetSki' );
		const parts = [];
		const add = ( geometry, color, rough, metal, pattern, matrix ) => parts.push( prepare( geometry, { color, rough, metal, pattern, matrix } ) );

		// Visual geometry shifted so y=0 = waterline (flat hull bottom at rest).
		// Draft ~0.05 m: hull bottom at y = -0.05, deck at y ~0.22-0.5. Foot wells well above water.
		const Y = 0.27; // vertical offset: raises hull bottom from -0.185 → +0.085; visual waterline at ~y=0.05

		// Hull, raised nose and rub rail: small enough to sit visibly in the shore chop.
		add( box( 0.82, 0.25, 2.35 ), 0x0b5466, 0.28, 0.08, PAT.rusty, mat4( 0, - 0.06 + Y, 0 ) );
		add( sphere( 0.54, 18, 10 ), 0x0e7182, 0.26, 0.08, PAT.rusty, mat4( 0, 0.07 + Y, 0.74, 0, 0, 0, 0.88, 0.38, 1.05 ) );
		add( box( 0.62, 0.16, 1.04 ), 0x11363f, 0.68, 0, PAT.rubber, mat4( 0, 0.22 + Y, - 0.18, - 0.08 ) );
		add( box( 0.42, 0.27, 0.38 ), 0xdce7dc, 0.2, 0.12, PAT.plain, mat4( 0, 0.36 + Y, 0.26, - 0.18 ) );
		add( cylinder( 0.025, 0.025, 0.44, 10 ), 0x22282a, 0.42, 0.35, PAT.machined, mat4( 0, 0.56 + Y, 0.32, Math.PI / 2 ) );
		add( cylinder( 0.035, 0.035, 0.72, 10 ), 0x172225, 0.6, 0.08, PAT.rubber, mat4( 0, 0.58 + Y, 0.32, Math.PI / 2 ) );
		add( cylinder( 0.08, 0.08, 0.1, 12 ), 0xffd15a, 0.22, 0.08, PAT.plain, mat4( 0, 0.1 + Y, 1.26, Math.PI / 2 ) );
		add( cylinder( 0.09, 0.09, 0.14, 12 ), 0x283235, 0.24, 0.65, PAT.machined, mat4( 0, - 0.12 + Y, - 1.22, Math.PI / 2 ) );

		this.mesh = new Mesh( mergePrepared( parts ), this.material );
		this.mesh.name = 'jet-ski-body';
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.group.add( this.mesh );
		this.ready = this.loadAuthenticModel();

		this.handlebars = new Group();
		this.handlebars.position.set( 0, 0.58 + Y, 0.32 );
		this.group.add( this.handlebars );

		// Hull samples matching the visual waterplane (flat bottom at y ≈ -0.05, chines at y ≈ 0.05).
		// Real jet ski waterplane ~2.4 m² at rest. Four sponsons, each 0.6 m² = 2.4 m² total.
		// Sample Y = 0.0 (design waterline). Bottom at -0.05. Area 0.6 each.
		this.hullSamples = [
			{ position: new Vector3( - 0.38, 0.0, - 0.85 ), area: 0.60, bottomY: - 0.05 },
			{ position: new Vector3( 0.38, 0.0, - 0.85 ), area: 0.60, bottomY: - 0.05 },
			{ position: new Vector3( - 0.38, 0.0, 0.65 ), area: 0.60, bottomY: - 0.05 },
			{ position: new Vector3( 0.38, 0.0, 0.65 ), area: 0.60, bottomY: - 0.05 },
		];

		// Hydrostatics for a ~430 kg jet ski + rider:
		// - COM low (below waterline) for stability
		// - COB at waterline → righting moment when heeled
		// - Inertia scaled to a small, light craft
		this.hydro = {
			suggestedMass: 430,
			centerOfMass: new Vector3( 0, - 0.03, - 0.1 ),  // low, slightly aft of center
			centerOfBuoyancy: new Vector3( 0, 0.0, 0.0 ),   // at waterline
			inertia: new Vector3( 120, 180, 80 ), // pitch, yaw, roll (kg·m²) — much smaller than boat
		};
		this.propeller = new Vector3( 0, - 0.05, - 1.1 );
		this.rudder = { z: - 1.0 };
		// Rider eye height: seated on a PWC, straddling the seat (~0.3m above waterline),
		// eyes ~0.55m above seat = ~0.85m above waterline. Model settles at ~-0.175m.
		this.helmEye = new Vector3( 0, 0.85 + Y, 0.0 );
		this.throttle = 0;
		this.steer = 0;
		this.rpm = 0;

	}

	setThrottle( value ) { this.throttle = value; }
	setSteering( value ) { this.steer = value; this.handlebars.rotation.y = value * 0.5; }
	setPropellerRPM( value ) { this.rpm = value; }
	update() {}

	async loadAuthenticModel() {

		try {

			const base = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' );
			const gltf = await loadGLB( base + 'models/vehicles/jetski-cm21.glb' );
			const primitive = gltf.meshes.flat().find( ( item ) => item.attributes.POSITION );
			if ( ! primitive ) throw new Error( 'model has no drawable geometry' );
			const geo = new BufferGeometry();
			const attributes = primitive.attributes;
			geo.setAttribute( 'position', new BufferAttribute( toFloat( attributes.POSITION ), 3 ) );
			if ( attributes.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( toFloat( attributes.NORMAL ), 3 ) );
			if ( attributes.TEXCOORD_0 ) geo.setAttribute( 'uv', new BufferAttribute( toFloat( attributes.TEXCOORD_0 ), 2 ) );
			if ( primitive.indices ) geo.setIndex( new BufferAttribute( primitive.indices, 1 ) );
			geo.computeBoundingSphere();

			const gltfMaterial = gltf.materials[ primitive.material ] || {};
			const baseTexture = gltfMaterial.pbrMetallicRoughness?.baseColorTexture;
			let texture = null;
			if ( baseTexture ) {

				const image = gltf.images[ gltf.textures[ baseTexture.index ].source ];
				const pixels = await decodeImage( image.bytes, image.mimeType );
				texture = new Texture( { label: 'jetski-cm21-albedo', width: pixels.width, height: pixels.height, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ], data: pixels.data, sampler: 'anisoRepeat' } );
				texture.getGPU();
				generateMipmaps( texture );

			}
			const material = standard( {
				name: 'jetSkiCm21', roughness: 0.28, metalness: 0.04, side: 'double',
				textures: texture ? { jetSkiAlbedo: texture } : {},
				defines: { HAS_JETSKI_ALBEDO: texture ? 1 : 0 },
				surface: /* wgsl */`
#if HAS_JETSKI_ALBEDO
	let albedo = textureSample( jetSkiAlbedo, smpAnisoRepeat, in.uv );
	s.albedo *= albedo.rgb;
	s.alpha *= albedo.a;
#endif`,
			} );
			const authentic = new Mesh( geo, material );
			authentic.name = 'jet-ski-cm21';
			authentic.castShadow = true;
			authentic.receiveShadow = true;
			const sourceAxis = new Group();
			sourceAxis.rotation.x = - Math.PI / 2;
			sourceAxis.add( authentic );
			this.authenticGroup = new Group();
			this.authenticGroup.rotation.y = - Math.PI / 2;
			this.authenticGroup.scale.setScalar( 0.14 );
			this.authenticGroup.add( sourceAxis );
			this.group.add( this.authenticGroup );
			this.mesh.visible = false;

		} catch ( error ) {

			console.warn( 'JetSkiModel: authentic model failed to load; keeping procedural fallback', error );

		}

	}

}

function toFloat( attribute ) {

	if ( attribute.array instanceof Float32Array ) return attribute.array;
	const out = new Float32Array( attribute.array.length );
	const divisor = attribute.normalized ? ( attribute.componentType === 5121 ? 255 : attribute.componentType === 5123 ? 65535 : 1 ) : 1;
	for ( let i = 0; i < out.length; i ++ ) out[ i ] = attribute.array[ i ] / divisor;
	return out;

}
