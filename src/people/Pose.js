// Procedural layers on top of a clip's pose, written into a SkinnedModel's world matrices (model
// space: y up, +z forward) after its update, then the joint matrices rebuilt:
//  - look: yaw shared down the spine, the neck and the head (the chest turns a little, the head
//    most), pitch at the neck and the head (+ looks down: a phone, a book, a doze; - up: a bird);
//  - tuck: seated, both knees swung aside toward model +x (away 1) or -x, the chest leaning away
//    with them, to let someone squeeze past along the row;
//  - knock (src/people/Contact.js): { arms, tilt, legs } 0..1, arms flung out, the upper body leant
//    back (tilt > 0) or forward, the knees raised (sat on the ground after a fall, with the sit clip);
//    stepL / stepR (rad, + back): a stumble's step, one thigh swung back (or forward) at the hip.
// The pitch goes first and the yaw after, so a turned head still nods about its own shoulders.
const YAW = [ [ 'Bip01 Spine1', 0.12 ], [ 'Bip01 Spine2', 0.2 ], [ 'Bip01 Neck', 0.3 ], [ 'Bip01 Head', 0.38 ] ];
const PITCH = [ [ 'Bip01 Neck', 0.45 ], [ 'Bip01 Head', 0.55 ] ];
const THIGHS = [ 'Bip01 L Thigh', 'Bip01 R Thigh' ];
const KNEES = 0.55, LEAN = 0.14;           // rad at a full tuck
const ARMS = [ [ 'Bip01 L UpperArm', 1 ], [ 'Bip01 R UpperArm', - 1 ] ], ARMS_OUT = 1.15, LEGS_UP = 0.8;   // model +x is their left

function rig( m ) {

	if ( m._peopleRig ) return m._peopleRig;
	const find = n => m.gltf.nodes.findIndex( x => x.name === n );
	const under = r => m.order.filter( i => { for ( let j = i; j >= 0; j = m.parent[ j ] ) if ( j === r ) return true; return false; } );
	const at = list => list.map( ( [ n, share ] ) => [ find( n ), share ] ).filter( ( [ i ] ) => i >= 0 ).map( ( [ i, share ] ) => [ i, share, under( i ) ] );
	return ( m._peopleRig = { yaw: at( YAW ), pitch: at( PITCH ), thighs: at( THIGHS.map( n => [ n, 1 ] ) ), spine: at( [ [ 'Bip01 Spine1', 1 ] ] ), arms: at( ARMS ) } );

}

// Rotate the subtree `nodes` by `a` about the model axis `axis` (0 x, 1 y, 2 z) through `root`'s origin.
function spin( W, root, nodes, axis, a ) {

	const c = Math.cos( a ), s = Math.sin( a ), P = [ W[ root * 16 + 12 ], W[ root * 16 + 13 ], W[ root * 16 + 14 ] ];
	const u0 = axis === 1 ? 2 : axis === 0 ? 1 : 0, v0 = axis === 1 ? 0 : axis === 0 ? 2 : 1;
	for ( const i of nodes ) for ( let k = 0; k < 4; k ++ ) {

		const o = i * 16 + k * 4, pu = k === 3 ? P[ u0 ] : 0, pv = k === 3 ? P[ v0 ] : 0, u = W[ o + u0 ] - pu, v = W[ o + v0 ] - pv;
		W[ o + u0 ] = c * u - s * v + pu;
		W[ o + v0 ] = s * u + c * v + pv;

	}

}

export function pose( m, yaw = 0, pitch = 0, tuck = 0, away = 1, knock = null ) {

	const K = knock && ( Math.abs( knock.tilt ) >= 0.01 || knock.arms >= 0.01 || knock.legs >= 0.01 || Math.abs( knock.stepL || 0 ) >= 0.01 || Math.abs( knock.stepR || 0 ) >= 0.01 ) ? knock : null;
	if ( ! K && Math.abs( yaw ) < 0.02 && Math.abs( pitch ) < 0.02 && tuck < 0.02 ) return false;
	const R = rig( m ), W = m.world;
	if ( K ) {

		// arms first (they ride on the spine), then the lean carries them with the chest
		if ( K.legs >= 0.01 ) for ( const [ i, , nodes ] of R.thighs ) spin( W, i, nodes, 0, - LEGS_UP * K.legs );
		R.thighs.forEach( ( [ i, , nodes ], j ) => { const a = j ? K.stepR : K.stepL; if ( Math.abs( a || 0 ) >= 0.01 ) spin( W, i, nodes, 0, a ); } );
		if ( K.arms >= 0.01 ) for ( const [ i, side, nodes ] of R.arms ) spin( W, i, nodes, 2, side * ARMS_OUT * K.arms );
		if ( Math.abs( K.tilt ) >= 0.01 ) for ( const [ i, , nodes ] of R.spine ) spin( W, i, nodes, 0, - K.tilt );

	}
	if ( tuck >= 0.02 ) {

		for ( const [ i, , nodes ] of R.thighs ) spin( W, i, nodes, 1, away * KNEES * tuck );
		for ( const [ i, , nodes ] of R.spine ) spin( W, i, nodes, 2, - away * LEAN * tuck );

	}
	if ( Math.abs( pitch ) >= 0.02 ) for ( const [ i, share, nodes ] of R.pitch ) spin( W, i, nodes, 0, pitch * share );
	if ( Math.abs( yaw ) >= 0.02 ) for ( const [ i, share, nodes ] of R.yaw ) spin( W, i, nodes, 1, yaw * share );
	const J = m.joints, D = m.jointData, ibm = m.skin.inverseBindMatrices, jn = m.skin.joints;
	for ( let j = 0; j < J; j ++ ) {

		const a0 = jn[ j ] * 16, b0 = j * 16;
		for ( let col = 0; col < 4; col ++ ) {

			const b1 = ibm[ b0 + col * 4 ], b2 = ibm[ b0 + col * 4 + 1 ], b3 = ibm[ b0 + col * 4 + 2 ], b4 = ibm[ b0 + col * 4 + 3 ];
			for ( let r = 0; r < 4; r ++ ) D[ b0 + col * 4 + r ] = W[ a0 + r ] * b1 + W[ a0 + 4 + r ] * b2 + W[ a0 + 8 + r ] * b3 + W[ a0 + 12 + r ] * b4;

		}

	}
	m.jointBuffer.write( D );
	return true;

}
