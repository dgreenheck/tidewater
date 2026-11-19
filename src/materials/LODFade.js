import { ShaderModule } from '../engine/gpu/Shader.js';

// Screen-door cross-fade between levels of detail (and for anything that appears or disappears
// with distance), so nothing switches over in one frame.
//
// Both levels are drawn during a transition band. Each discards the pixels where the dither
// threshold says it isn't visible: the incoming level keeps the pixels below `fade`, the outgoing one
// the pixels at or above the SAME threshold, so together they cover every pixel exactly once (no
// holes, no double-drawn pixels). The threshold is interleaved gradient noise (Jimenez 2014) moved
// every frame: every 3x3 block holds the whole threshold range (the TAA clip box sees both levels)
// and it never repeats as a regular grid, so the TAA resolves it into a smooth blend. (It was a
// Bayer 4x4 pattern shifted on a 16-frame cycle: the TAA kept the regular grid, which read as
// stippled, dotted foliage edges and tree lines.)
//
// fade: 0..1, the share of this level that is visible (the same value for both levels of one
// instance: ramp it with distance across the band on the CPU or in the vertex stage).
//
// WGSL (lodFadeModule):
//   fn bayer4( pixel: vec2f ) -> f32                 threshold in (0, 1) for a fragment coordinate
//   fn lodFadeVisible( pixel: vec2f, fade: f32, outgoing: bool ) -> bool
// In a surface / shadow snippet: `if ( ! lodFadeVisible( in.pixel, fade, false ) ) { discard; }`
// (Nothing is discarded at fade >= 1 (incoming) or fade <= 0 (outgoing).)

export const lodFadeModule = new ShaderModule( {
	name: 'lodFade',
	code: /* wgsl */`
// dither threshold in (0, 1) for a fragment coordinate: interleaved gradient noise, offset every
// frame along the direction Jimenez gives for temporal IGN (the name is kept for the callers)
fn bayer4( pixel: vec2f ) -> f32 {
	let f = f32( frame.frameIndex % 64u );
	let p = floor( pixel ) + f * 5.588238;
	return clamp( fract( 52.9829189 * fract( dot( p, vec2f( 0.06711056, 0.00583715 ) ) ) ), 0.001, 0.999 );
}

fn lodFadeVisible( pixel: vec2f, fade: f32, outgoing: bool ) -> bool {
	let t = bayer4( pixel );
	return select( ( t < fade ), ( t >= fade ), outgoing );
}
`,
} );

// Fade factor across a distance band [start, end] (0 before, 1 after), for the level that takes over
// at `end`. Use on the CPU when bucketing instances.
export function bandFade( dist, start, end ) {

	const t = ( dist - start ) / Math.max( end - start, 1e-6 );
	return t <= 0 ? 0 : t >= 1 ? 1 : t * t * ( 3 - 2 * t );

}
