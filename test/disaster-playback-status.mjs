// The Disasters status line names the playback the player is getting. Since L5 (2026-10-05) a
// disaster caps every frame at 25 ms of simulation (SimulationPacing DISASTER_MAX_STEP) in both
// modes, so a loaded machine plays the event in slow motion even in "real time" mode. The line
// used to read only the selected mode and said "Playback real time · 0.62× speed", which
// contradicts itself. It must say the playback is slowed whenever a disaster runs and the
// shown rate is below 1.00.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DisasterControls } from '../src/disasters/Controls.js';

const OBS = {
	active: 'tornado', time: '12.00', destroyed: 0, moved: 0, 'peak-force': 0, 'raw-force': 0,
	water: '0.00', current: '0.00', wind: '40.00', pressure: 980, utilization: '0.10',
	bodies: 0, limited: 0, deferred: 0, 'water-ms': '0.00', cfl: '0.00', 'water-dropped': '0.00',
	'water-error': '0.00', 'wind-work': '0.00',
};

function status( pacing, paused = false ) {

	const el = { innerHTML: '', setAttribute() {} };
	const controls = {
		status: el, warning: { hidden: true }, pause: { textContent: '' },
		owner: {
			paused, field: { events: new Map() }, structures: { joints: new Map() },
			siren: { state: { sources: 0, level: 0, context: 'none' } },
			app: { simulationPacing: pacing },
		},
	};
	DisasterControls.prototype.update.call( controls, OBS );
	return el.innerHTML.match( /Playback [^<]*/ )[ 0 ];

}

test( 'A disaster capped below real time says the playback is slowed, in either mode', () => {

	for ( const mode of [ 'realtime', 'smooth' ] ) {

		const line = status( { mode, active: true, rate: .62 } );
		assert.match( line, /slowed under load · 0\.62× speed/, `mode ${ mode } at 0.62× read "${ line }"` );

	}

} );

test( 'At full speed, or with no disaster running, the line names the selected mode', () => {

	assert.match( status( { mode: 'realtime', active: true, rate: 1 } ), /real time · 1\.00× speed/ );
	assert.match( status( { mode: 'smooth', active: true, rate: 1 } ), /slow under load · 1\.00× speed/ );
	// 0.996 shows as 1.00×: the words must agree with the number the player reads.
	assert.match( status( { mode: 'realtime', active: true, rate: .996 } ), /real time · 1\.00× speed/ );
	assert.match( status( { mode: 'realtime', active: false, rate: .7 } ), /real time/ );
	assert.match( status( { mode: 'realtime', active: true, rate: .62 }, true ), /real time · 0\.00× speed/, 'paused shows 0.00× and no slowdown' );

} );
