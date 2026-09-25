// Resting trunk profiles shared by rendering and collision. Crown wind remains visual.
const smooth = ( a, b, x ) => { const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };

export const PALM_H = 10; // geometry trunk height (the shader uses the per-instance height)

export const palmRadius = ( u ) => {

	const y = u * PALM_H;
	let r = 0.155 + 0.045 * ( 1 - u ) + 0.19 * Math.exp( - Math.max( y, 0 ) / 0.42 );
	r *= 1 + 0.05 * Math.sin( y * 1.7 ) * ( 1 - u ); // slight irregularity
	r += 0.07 * smooth( 0.955, 0.99, u ) - 0.1 * smooth( 0.995, 1.02, u ); // leaf-base boot
	return r;

};

// buttress roots: lumps around the flared base, fading out within the first ~0.6 m
export const palmRootLumps = ( u, a ) => {

	const y = Math.max( u * PALM_H, 0 );
	const k = Math.exp( - y / 0.3 );
	return k * ( 0.16 * Math.max( 0, Math.sin( a * 5 + 0.7 ) ) + 0.08 * Math.sin( a * 11 + 2.1 ) );

};

export const TREE_BASE = [ 0, - 0.5, 0 ];
export const TREE_FORK = [ 0.15, 3.7, - 0.05 ];

export function treeRadius( f, a, c ) {

	const y = c.y, r = 0.34 - 0.1 * f;
	const fin = Math.pow( Math.max( 0, Math.cos( 4 * a + 0.4 ) ), 4 ) * Math.exp( - Math.max( y, 0 ) / 0.8 );
	return r * ( 1 + 0.9 * fin + 0.25 * Math.exp( - Math.max( y + 0.3, 0 ) / 0.5 ) );

}

export const youngPalmRadius = u => 0.16 - 0.07 * u;
