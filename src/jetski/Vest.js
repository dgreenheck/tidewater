import { loadModel } from '../rally/VehicleModel.js';
import { G } from '../engine/render/Frame.js';

// The ski vest (a neon high-vis personal flotation device: public/models/jetski_pfd.glb, built by
// tools/jetski/pfd_build.py) on its wearer. Each of its two nodes (pfd_rider for the player's rig, pfd_mate for
// Emily's) is the wearer's 'Bip01 Spine2' frame at rest, its vertices centimetres under the rig's 0.01 scale. Worn,
// the node's matrix is that joint's posed matrix in the wearer's model space (SkinnedModel.world, the scale
// included), written each frame after the pose. Rigid: the foam does not bend with the spine above Spine2.
// The retroreflective tape (material PFD_Reflective) glows from dusk with G.night.
//   const v = await loadVest( 'pfd_rider', model, { customize } );   poseVest( v, model, worn );
export const VEST = { url: ( import.meta.env?.BASE_URL || '/' ) + 'models/jetski_pfd.glb', bone: 'Bip01 Spine2', tape: 3.2 };

export async function loadVest( name, model, opts = {} ) {

	const nodes = model?.gltf?.nodes || [];
	const j = nodes.findIndex( ( n ) => n.name === VEST.bone );
	if ( j < 0 ) return null;
	const { root } = await loadModel( VEST.url, opts );
	const node = root.getObjectByName( name );
	if ( ! node ) return null;
	node.removeFromParent?.();
	node.matrixAutoUpdate = false;
	node.visible = false;
	const tape = [];
	node.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		o.castShadow = true;
		if ( /PFD_Reflective/.test( o.material?.name || '' ) ) tape.push( o );

	} );
	model.group.add( node );
	return { node, j, tape, worn: false };

}

export function poseVest( v, model, worn ) {

	if ( ! v || ! model ) return;
	v.worn = !! worn;
	v.node.visible = v.worn;
	if ( ! v.worn ) return;
	v.node.matrix.fromArray( model.world, v.j * 16 );
	// (a fade gives each mesh its own material copy: read the mesh's current one)
	const k = VEST.tape * G.night.value;
	for ( const o of v.tape ) o.material.emissive?.setRGB( k, k, k );

}
