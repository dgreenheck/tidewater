// An event draws a fresh seed. Explicit seeds give tests and bug reports reproducible conditions.

// Independent streams, so adding draws to one element never shifts another element's values.
export const STREAM=Object.freeze({ particles:1, anchor:2, member:3, tree:4, track:5, component:6 });

// Scatter of capacity around the nominal value, as a coefficient of variation (sd / mean).
// Declared game values inside the published ranges:
// - timber and light-frame anchorage and members 0.25: nail and strap connection capacities in
//   light-frame fragility work are lognormal with COV about 0.2 to 0.3 (Ellingwood et al. 2004,
//   J. Struct. Eng. 130(12)); graded lumber bending strength COV is 0.2 to 0.35 (Wood Handbook
//   FPL-GTR-190, ch. 5 and 7).
// - masonry 0.30: unreinforced masonry tensile and bond strength scatter widely (JCSS
//   Probabilistic Model Code, part 3; COV 0.2 to 0.4).
// - steel 0.07: structural steel yield strength (JCSS Probabilistic Model Code, part 3.02).
// - trees 0.35: critical turning moment against stem mass leaves about 30 to 40% scatter
//   (Nicoll et al. 2006, Can. J. For. Res. 36: 1871-1883).
export const CAPACITY_COV=Object.freeze({ timber:.25, light:.25, masonry:.30, steel:.07, tree:.35 });

// A fresh seed for one event. crypto is in every browser and in Node 19+.
export function freshSeed() {
 const out=new Uint32Array( 1 );
 globalThis.crypto.getRandomValues( out );
 return out[ 0 ];
}

// 32-bit avalanche hash of ( seed, stream, index ) (murmur3 finaliser). Stateless and
// allocation-free, so a per-frame caller can ask for the same draw again without storing it.
export function hash32( seed, stream, index ) {
 let x=( seed ^ Math.imul( stream, 0x9e3779b1 ) ^ Math.imul( index + 1, 0x85ebca77 ) ) >>> 0;
 x=Math.imul( x ^ ( x >>> 16 ), 0x85ebca6b );
 x=Math.imul( x ^ ( x >>> 13 ), 0xc2b2ae35 );
 return ( x ^ ( x >>> 16 ) ) >>> 0;
}

// Uniform in [0, 1).
export function uniform( seed, stream, index ) {
 return hash32( seed, stream, index ) / 4294967296;
}

// Standard normal by Box-Muller from two independent uniforms, cut at +-3 sd so a single draw
// can never make a house of paper or of granite.
export function normal( seed, stream, index ) {
 const u=Math.max( 1e-9, uniform( seed, stream, 2 * index ) ), v=uniform( seed, stream, 2 * index + 1 );
 const z=Math.sqrt( -2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );
 return Math.max( -3, Math.min( 3, z ) );
}

// Lognormal capacity factor with mean 1 and the given COV, so the population average keeps the
// nominal capacity that the calibrated tests and EF bands were tuned on. No seed: nominal (1).
export function capacityFactor( seed, stream, index, cov ) {
 if ( seed === undefined || seed === null || ! ( cov > 0 ) ) return 1;
 const sigma=Math.sqrt( Math.log( 1 + cov * cov ) );
 return Math.exp( sigma * normal( seed, stream, index ) - sigma * sigma / 2 );
}
