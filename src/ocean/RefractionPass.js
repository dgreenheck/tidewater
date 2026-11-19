import { RenderTarget } from '../engine/gpu/Texture.js';
import { LAYERS, DEPTH_FORMAT } from '../engine/render/SceneRenderer.js';
import { FrameUniforms, createViewUniforms, setFrameCamera } from '../engine/render/Frame.js';
import { Box3, Matrix4 } from '../engine/math/index.js';
import { ATTRIBUTE_BLOCK, trackAttributeChanges, attributeBlocksUnchanged } from '../engine/render/AttributeChanges.js';

// Refraction source for the water: the scene below the water surface only, rendered right after the
// opaque pass (same jittered camera, so the temporal resolve treats it like the scene) at a fraction
// of the internal resolution. The water samples it at the end point of its refracted view ray.
//
// The opaque colour copy can't serve for this: wherever something above the water (the pier deck,
// rails, posts, the boat) is in front of the refracted end point, the seabed there was never drawn.
// Faking it from nearby pixels smeared and repeated the seabed next to every rail. Here fragments
// higher than sea level + CLIP_MARGIN are discarded (engine REFRACTION_CLIP define), so those objects
// never enter the image; submerged geometry (seabed, reef, rocks, piles, hull bottoms, fish) is shaded
// with its full material and lighting.
//
// Colour target: rgb = lit colour, a = coverage (0 where nothing below the water was drawn: the water
// then falls back to the opaque copy). Depth: reversed-Z, 0 = nothing.
//
// The view is wider than the screen (a guard band): light bends down into the water, so a refracted
// ray lands on seabed lower on the screen than the pixel it is seen through, and near the bottom edge
// (looking down from the pier or the boat) below the screen. The band holds that seabed, so the water
// never has to invent it (edge rows repeated into streaks, or the image squeezed, bending the shadows).
// GUARD: the extra view in NDC units (1 = half the screen) on each side; the target grows with it so
// the pixel density stays the same. REFRACTION_GUARD: clip-space scale (sx, sy) and centre (cx, cy):
// ndc_refraction = ( ndc_screen - c ) / s (WaterMaterial maps its lookups the same way).
const CLIP_MARGIN = 0.4; // m above sea level (wave troughs and crests move the real surface around it)
const GUARD = { left: 0.15, right: 0.15, bottom: 0.6, top: 0.0 };
export const REFRACTION_GUARD = {
	cx: ( GUARD.right - GUARD.left ) / 2, cy: ( GUARD.top - GUARD.bottom ) / 2,
	sx: 1 + ( GUARD.left + GUARD.right ) / 2, sy: 1 + ( GUARD.top + GUARD.bottom ) / 2,
};
const _guard = new Matrix4().set(
	1 / REFRACTION_GUARD.sx, 0, 0, - REFRACTION_GUARD.cx / REFRACTION_GUARD.sx,
	0, 1 / REFRACTION_GUARD.sy, 0, - REFRACTION_GUARD.cy / REFRACTION_GUARD.sy,
	0, 0, 1, 0,
	0, 0, 0, 1,
);
const _prevVP = new Matrix4();

const _box = new Box3();

export class RefractionPass {

	constructor( { meshRenderer, scene, camera, sceneRenderer, scale = 0.5 } ) {

		this.meshRenderer = meshRenderer;
		this.scene = scene;
		this.camera = camera;
		this.sceneRenderer = sceneRenderer;
		this.scale = scale;
		this.enabled = true;
		this.guard = REFRACTION_GUARD;
		// the wider view: the main camera with the guard applied to its projection (culling uses it),
		// drawn with its own frame block
		this._camera = Object.create( camera );
		this._camera.projectionMatrix = new Matrix4();
		this.block = createViewUniforms( 'refraction' );
		this.target = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], depth: DEPTH_FORMAT, label: 'refraction' } );
		this.texture = this.target.texture;
		this.depthTexture = this.target.depthTexture;
		this._clearColors = [ [ 0, 0, 0, 0 ] ];
		// plants never reach under the water (underwaterLighting 'none'); objects whose world bounding box
		// stays above the clip height (houses, roofs, the vendors, most props, instanced batches whose
		// instances all do) are skipped before drawing.
		this._filter = ( o ) => {

			const m = o.material;
			if ( m.underwaterLighting === 'none' || m.isWaterMaterial ) return false;
			if ( o.isInstancedMesh ) return this._instancedMinY( o ) < this._clipY;
			if ( ! o.geometry.attributes.position ) return true;
			return minimumWorldY( this._localBox( o ), o.matrixWorld ) < this._clipY;

		};

		// local bounds of the part of the geometry an object draws (merged batches like the village draw
		// ranges of one shared geometry: the whole geometry's bounds would include the pier piles)
		this._boxes = new WeakMap();
		this._instBoxes = new WeakMap();

		this._clipY = 0;
		this._defines = { REFRACTION_CLIP: 1, REFRACTION_CLIP_MARGIN: CLIP_MARGIN };

	}

	// lowest world y of an instanced mesh's instances (cached until its instances change)
	_instancedMinY( o ) {

		const im = o.instanceMatrix;
		let c = this._instBoxes.get( o );
		if ( ! c || c.version !== ( im.version || 0 ) || c.count !== o.count || c.array !== im.array ) {

			o.computeBoundingBox();
			c = { version: im.version || 0, count: o.count, array: im.array, box: o.boundingBox.clone() };
			this._instBoxes.set( o, c );

		}

		return c.count ? minimumWorldY( c.box, o.matrixWorld ) : Infinity;

	}

	_localBox( o ) {

		const g = o.geometry, pos = g.attributes.position, index = g.index;
		const dr = g.drawRange || { start: 0, count: Infinity };
		const idx = index?.array, indexVersion = index?.version || 0;
		const version = pos.version ?? pos.data?.version ?? 0;
		const array = pos.array, stride = pos.isInterleavedBufferAttribute ? pos.data.stride : pos.itemSize;
		const offset = pos.isInterleavedBufferAttribute ? pos.offset : 0;
		let c = this._boxes.get( o );
		const sameTopology = c && c.geometry === g && c.start === dr.start && c.count === dr.count &&
			c.index === index && c.indexArray === idx && c.indexVersion === indexVersion && c.positionCount === pos.count &&
			c.stride === stride && c.offset === offset && c.normalized === pos.normalized;
		if ( sameTopology && c.position === pos && c.array === pos.array && c.version === version ) return c.box;
		if ( sameTopology && c.position === pos && c.array === array && attributeBlocksUnchanged( pos, c.version, c.blocks ) ) {

			c.version = version;
			return c.box;

		}

		if ( ! sameTopology ) {

			const n = idx ? idx.length : pos.count;
			const start = Math.max( 0, dr.start );
			const end = Math.max( start, Math.min( n, start + ( dr.count ?? Infinity ) ) );
			// Triangle batches repeat each vertex several times. Membership only changes with
			// topology; moving fragments need one position read per distinct drawn vertex.
			const vertices = idx ? Uint32Array.from( new Set( idx.subarray( start, end ) ) ) : null;
			const blocks = new Set();
			if ( vertices ) for ( const vertex of vertices ) {

				const at = vertex * stride + offset;
				blocks.add( Math.floor( at / ATTRIBUTE_BLOCK ) );
				blocks.add( Math.floor( ( at + 2 ) / ATTRIBUTE_BLOCK ) );

			} else for ( let b = Math.floor( ( start * stride + offset ) / ATTRIBUTE_BLOCK ); b <= Math.floor( ( ( end - 1 ) * stride + offset + 2 ) / ATTRIBUTE_BLOCK ) && end > start; b ++ ) blocks.add( b );
			c = { geometry: g, start: dr.start, count: dr.count, index, indexArray: idx,
				indexVersion, positionCount: pos.count, vertices, first: start, end, box: new Box3(),
				stride, offset, normalized: pos.normalized, blocks: Uint32Array.from( blocks ) };
			this._boxes.set( o, c );

		}

		const vertices = c.vertices, end = vertices ? vertices.length : c.end;
		let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = - Infinity, maxY = - Infinity, maxZ = - Infinity;
		for ( let i = vertices ? 0 : c.first; i < end; i ++ ) {

			const v = vertices ? vertices[ i ] : i, at = v * stride + offset;
			const x = pos.normalized ? pos.getX( v ) : array[ at ];
			const y = pos.normalized ? pos.getY( v ) : array[ at + 1 ];
			const z = pos.normalized ? pos.getZ( v ) : array[ at + 2 ];
			minX = Math.min( minX, x ); minY = Math.min( minY, y ); minZ = Math.min( minZ, z );
			maxX = Math.max( maxX, x ); maxY = Math.max( maxY, y ); maxZ = Math.max( maxZ, z );

		}

		c.box.min.set( minX, minY, minZ ); c.box.max.set( maxX, maxY, maxZ );
		c.position = pos; c.array = array; c.version = version;
		trackAttributeChanges( pos );
		return c.box;

	}

	render( seaLevel ) {

		const sr = this.sceneRenderer;
		const g = this.guard;
		const w = Math.max( 1, Math.round( sr.width * this.scale * g.sx ) ), h = Math.max( 1, Math.round( sr.height * this.scale * g.sy ) );
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );
		this._clipY = seaLevel + CLIP_MARGIN;
		const rt = this.target;
		// this frame's camera (with its jitter, so the temporal resolve sees the seabed as in the scene)
		// through the guard band
		const F = FrameUniforms.fields;
		const cam = this._camera;
		cam.projectionMatrix.multiplyMatrices( _guard, this.camera.projectionMatrix );
		_prevVP.multiplyMatrices( _guard, F.prevViewProjNoJitter.value );
		setFrameCamera( cam, w, h, {
			jitterX: F.jitter.value.x / g.sx * w / 2, jitterY: F.jitter.value.y / g.sy * h / 2,
			prevViewProj: _prevVP, prevCameraPos: F.prevCameraPos.value, block: this.block,
		} );
		this.meshRenderer.render( this.scene, {
			label: 'refraction',
			kind: 'color',
			camera: cam,
			frameBlock: this.block,
			colorViews: [ rt.texture.view() ],
			colorFormats: rt.formats,
			clearColors: this._clearColors,
			depthView: rt.depthTexture.view(),
			depthFormat: DEPTH_FORMAT,
			clearDepth: 0,
			layerMask: this.enabled ? 1 << LAYERS.OPAQUE : 0,
			filter: this._filter,
			defines: this._defines,
		} );

	}

}

// Only the bottom of the transformed AABB decides eligibility. For an affine
// object transform its extremal corner is selected directly, in the same
// arithmetic order as Vector3.applyMatrix4. General projective matrices retain
// the eight-corner path.
export function minimumWorldY( box, matrix ) {

	if ( box.isEmpty() ) return Infinity;
	const e = matrix.elements, a = box.min, b = box.max;
	if ( e[ 3 ] !== 0 || e[ 7 ] !== 0 || e[ 11 ] !== 0 || e[ 15 ] !== 1 ||
		! Number.isFinite( a.x + a.y + a.z + b.x + b.y + b.z ) ) return _box.copy( box ).applyMatrix4( matrix ).min.y;
	return e[ 1 ] * ( e[ 1 ] < 0 ? b.x : a.x ) + e[ 5 ] * ( e[ 5 ] < 0 ? b.y : a.y ) + e[ 9 ] * ( e[ 9 ] < 0 ? b.z : a.z ) + e[ 13 ];

}
