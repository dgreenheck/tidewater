// See-through people: someone standing between the third-person camera and the player fades out on
// a fine dither instead of the boom pulling in (ThirdPersonCamera asks app.people.occlude
// each frame; People.update eases each person's fade). Every crowd and beach material carries a
// `fade` uniform, 0 solid to 1 gone. Pixels drop out by interleaved gradient noise shifted every frame
// (Jimenez 2014), so the TAA resolve averages it into a smooth see-through (a fixed 4 x 4 Bayer read as a
// coarse checkerboard it could not resolve). No sorting and no blending, and the depth stays right. Opaque materials become alpha-tested (MASK) for this.
//   SkinnedModel.create( gltf, { materials: info => fadeOptions( info, { textures } ) } )
//   setFade( model, 0.8 )
export const FADE_SURFACE = /* wgsl */`
	if ( mat.fade > 0.001 ) {
		if ( interleavedGradientNoise( floor( in.pixel ) + f32( frame.frameIndex % 64u ) * 5.588238 ) < mat.fade ) { s.alpha = 0.0; }
	}
`;

export function fadeOptions( info, extra = {} ) {

	const opaque = ( info.alphaMode || 'OPAQUE' ) === 'OPAQUE';
	return { ...extra, uniforms: { fade: [ 'f32', 0 ] }, surface: FADE_SURFACE, ...( opaque ? { alphaMode: 'MASK', alphaCutoff: 0.5 } : {} ) };

}

export function setFade( model, f ) {

	if ( ! model || model._fade === f ) return;
	model._fade = f;
	for ( const m of model.materials ) m.set( 'fade', f );

}

// A plain (not skinned) material's options with the same fade: loadModel( url, { customize: fadeCustomize } ),
// or a procedural prop's own Material. Opaque ones are alpha-tested so the dither can drop pixels.
export function fadeCustomize( source, o ) {

	return { ...o, uniforms: { ...( o.uniforms || {} ), fade: [ 'f32', 0 ] }, surface: ( o.surface || '' ) + FADE_SURFACE, ...( o.transparent ? {} : { alphaTest: 0.5 } ) };

}

// What someone wears or holds (a hat, sunnies, the bat, a book or phone) fades with them. Its meshes share
// their materials with every other copy, so the first fade gives each mesh its own copy (Material.clone keeps
// the fade uniform); a part without the uniform (a stand-in) is hidden once the fade passes 0.3 instead.
export function setGroupFade( group, f ) {

	if ( ! group || group._fade === f ) return;
	if ( ! group._fadeMats ) {

		const mats = [], bare = [];
		group.traverse( o => { if ( ! o.material ) return; if ( o.material.uniforms?.fade ) { o.material = o.material.clone(); mats.push( o.material ); } else bare.push( o ); } );
		group._fadeMats = mats; group._bare = bare;

	}
	group._fade = f;
	for ( const m of group._fadeMats ) m.set( 'fade', f );
	for ( const o of group._bare ) o.visible = f <= 0.3;

}
