import { GPU } from '../gpu/GPU.js';

// One whole-hierarchy matrix update per frame for a scene whose pose is final.
//
// Every pass that draws the main scene used to call scene.updateMatrixWorld() itself: the shadow
// caster check, the opaque pass, the refraction pass and the water + transparent pass. That is four
// full walks of the scene graph per frame, each recomposing every local matrix and multiplying every
// world matrix, although nothing moves between those passes (no draw callback writes a transform:
// they pick LODs, ranges and instances). At 2560x1267 on a loaded M5 Pro the repeats cost about
// 2.5 ms of CPU per frame (updateMatrixWorld + multiplyMatrices self time, ?bench beach view).
//
// App.renderFrame poses the main scene once, after the simulation and the camera are final and
// before the first pass. Passes ask posed() and skip their own update for that scene in that frame.
// Any other scene (the fish portrait, the impostor bakes) still updates in every pass: those move
// objects between renders inside one frame.
export function poseScene( scene ) {

	scene.updateMatrixWorld();
	scene.userData.posedFrame = GPU.frame;

}

export function posed( scene ) {

	return scene.userData.posedFrame === GPU.frame;

}
