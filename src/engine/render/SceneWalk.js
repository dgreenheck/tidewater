import { SceneHierarchy } from '../scene/Object3D.js';

// A flat, pre-order list of the nodes of a scene that hold a mesh or have one below them.
//
// MeshRenderer.collect used to walk the whole scene graph recursively in every pass: the shadow
// cascades, the opaque pass, refraction, water and transparent, 3-5 walks a frame over every node,
// bones and anchors included. That walk was 2.8-3.0 ms of CPU self time per frame at 2560x1267
// (beach and village views, CDP profile, L6 2026-10-05). The hierarchy does not change between the
// passes of a frame, and usually not between frames, so the list is built once and reused until an
// add, remove or attach anywhere moves SceneHierarchy.version.
//
// end[ i ] is the index just past node i's subtree, so an invisible node skips its whole subtree,
// exactly as the recursive walk returns before its children. Visibility, layers, materials and the
// draw callbacks are still read live, in the same order, in every pass. Subtrees with no mesh are
// left out: the recursive walk does nothing in them.
const _walks = new WeakMap();

export function flatWalk( scene ) {

	let walk = _walks.get( scene );
	if ( walk && walk.version === SceneHierarchy.version ) return walk;
	if ( ! walk ) {

		walk = { version: - 1, nodes: [], end: new Int32Array( 1024 ), count: 0 };
		_walks.set( scene, walk );

	}

	walk.count = 0;
	append( walk, scene );
	walk.nodes.length = walk.count;
	walk.version = SceneHierarchy.version;
	return walk;

}

// Appends o and its mesh-bearing descendants. A subtree with no mesh appends nothing.
function append( walk, o ) {

	const at = walk.count;
	if ( at >= walk.end.length ) {

		const grown = new Int32Array( walk.end.length * 2 );
		grown.set( walk.end );
		walk.end = grown;

	}

	walk.nodes[ at ] = o;
	walk.count = at + 1;
	let keep = o.isMesh === true;
	for ( const child of o.children ) if ( append( walk, child ) ) keep = true;
	if ( ! keep ) {

		walk.count = at;
		return false;

	}

	walk.end[ at ] = walk.count;
	return true;

}
