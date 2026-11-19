// The disaster status refresh runs every 100 ms for as long as a disaster or its wreckage is
// live. It used to read the native motion list and print it into one string, 7 numbers with
// toFixed(4) per awake body, whether or not the Disasters panel was open (305 bodies at t 4 s
// of the default tornado: about 2,100 toFixed calls and a 25 kB string ten times a second,
// L5 diagnosis 2026-10-05). Nobody can read the pose while the panel is closed, so the
// refresh skips it; with the panel open the string is exactly what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Disasters } from '../src/disasters/Disasters.js';

const BODIES = 305;

function owner( hidden ) {

	const motion = new Float32Array( 7 * BODIES );
	for ( let i = 0; i < motion.length; i ++ ) motion[ i ] = Math.sin( i ) * 40;
	const calls = { motion: 0 };
	const updates = [];
	const self = {
		nextMetricsAt: 0, paused: false, restored: false, peakForce: 0, rawPeakForce: 0, limited: 0, waterMs: 0,
		touched: new Set(),
		siren: { update() {} },
		ui: { panel: { hidden }, config: () => ( { x: 40, z: - 115 } ), update: ( obs ) => updates.push( obs ) },
		field: {
			time: 4, water: null, events: new Map( [ [ 'tornado', {} ] ] ),
			terrain: () => 0, sample: () => ( { height: 0, ux: 0, uz: 0, wx: 30, wy: 2, wz: 10 } ),
		},
		app: { rally: { physics: {
			disaster_motion() { calls.motion ++; return motion; },
			prop_count: () => BODIES,
		} } },
		structures: { records: [], deferred: 0 },
		bodies: { fallenCount: 0, deferred: 0 },
	};
	return { self, calls, updates, motion };

}

test( 'With the Disasters panel closed the 10 Hz status refresh builds no per-body pose string', () => {

	const { self, calls, updates } = owner( true );
	Disasters.prototype.refresh.call( self, false );
	assert.equal( updates.length, 1, 'the refresh still runs (the tsunami warning and siren live in it)' );
	assert.equal( calls.motion, 0, `read the ${ BODIES }-body motion list ${ calls.motion } time(s) for a closed panel` );
	assert.equal( updates[ 0 ].pose, '', `built a ${ String( updates[ 0 ].pose ).length }-character pose string for a closed panel` );

} );

test( 'With the panel open the pose string is unchanged: every body, 7 numbers at 4 decimals', () => {

	const { self, calls, updates, motion } = owner( false );
	Disasters.prototype.refresh.call( self, false );
	assert.equal( calls.motion, 1 );
	assert.equal( updates[ 0 ].pose, Array.from( motion ).map( ( x ) => x.toFixed( 4 ) ).join( ',' ) );

} );
