// ResolutionGovernor under load. A tsunami's CPU solver adds about 12 ms a frame: the frame time
// passes the 18 ms budget whatever the resolution, so stepping the resolution down buys nothing, and every
// step resets the temporal history (the canopy's alpha dither goes blocky until TAA rebuilds it). The
// governor must spend at most one step finding that out, then hold; a GPU-bound load must still step down
// until it fits, and the level must come back once the spike ends.
//
// Frame model: frame ms = max( CPU ms, GPU ms at full Retina x the share of its pixels the level draws ).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { devicePixelRatio: 2 };
const { ResolutionGovernor } = await import( '../src/engine/ResolutionGovernor.js' );

function run( { cpu, gpu, seconds } ) {

	const engine = { width: 2560, height: 1267, renderScale: 2, resize() {} };
	const gov = new ResolutionGovernor( engine );
	let resets = 0;
	gov.onScale = () => { resets ++; }; // the app's hook cuts the camera: a TAA reset
	gov.onChange.push( () => {} );
	const trace = [];
	let t = 0;
	while ( t < seconds ) {

		const lv = gov.levels[ gov.index ], pixels = ( lv.dpr / 2 ) ** 2 * lv.scale ** 2;
		const ms = Math.max( cpu( t ), gpu * pixels );
		gov.update( ms / 1000 );
		t += ms / 1000;
		trace.push( [ t, gov.index ] );

	}
	// a DPR change resizes the output, which restarts the TAA, as does a scale change through onScale
	const steps = gov.steps.length;
	return { gov, steps, resets, trace, downs: gov.steps.filter( s => s.why === 'over budget' ), stepsIn: ( a, b ) => gov.steps.filter( s => s.t >= a && s.t < b ) };

}

test( 'A CPU-bound spike (tsunami solver, +12 ms for 60 s) costs at most one resolution step, then the level returns', () => {

	// 9 ms of CPU, 14 ms of GPU at full Retina: 60 Hz holds until the solver adds 12 ms from 20 s to 80 s
	const r = run( { cpu: t => 9 + ( t > 20 && t < 80 ? 12 : 0 ), gpu: 14, seconds: 140 } );
	const during = r.stepsIn( 20, 80 );
	assert.ok( during.length <= 1, `the spike stepped the resolution ${ during.length } times (each a TAA history reset): ${ JSON.stringify( during.map( s => [ s.t, s.to ] ) ) }` );
	assert.equal( r.gov.index, 0, `back at full Retina 60 s after the spike (level ${ r.gov.index })` );

} );

test( 'A GPU-bound load (40 ms of GPU at full Retina) still steps down until the frame fits', () => {

	const r = run( { cpu: () => 6, gpu: 40, seconds: 40 } );
	const lv = r.gov.levels[ r.gov.index ], pixels = ( lv.dpr / 2 ) ** 2 * lv.scale ** 2;
	assert.ok( 40 * pixels <= 18, `ended at DPR ${ lv.dpr } scale ${ lv.scale }: ${ ( 40 * pixels ).toFixed( 1 ) } ms of GPU, over the 18 ms budget` );
	// (later 'headroom' tries back up to DPR 1.5 fail and come back down with a doubling backoff: by design)
	const first = r.stepsIn( 0, 20 );
	assert.deepEqual( first.map( s => s.to.dpr ), [ 1.5, 1 ], `2 steps down (DPR 2 to 1.5 to 1) fit 40 ms: ${ JSON.stringify( first.map( s => [ s.t, s.why, s.to ] ) ) }` );

} );
