// Disaster scenarios wait on game time, not wall time.
//
// While a disaster runs, every subsystem gets at most 25 ms of simulated time per frame
// (DISASTER_MAX_STEP in src/core/SimulationPacing.js, one rally-physics advance of 3 fixed
// steps). Below 40 fps the event plays in slow motion instead of the physics dropping time.
// A wall-clock budget then measures how loaded the machine is, not the physics: at load 120
// on the 18-core Mac a tornado frame took 300 ms or more, so 60 wall seconds were 5 game
// seconds and the specs failed on base and head alike (lane 2026-10-05).
//
// Each wait keeps the budget the spec always had, in game seconds of the disaster clock
// (Disasters.field.time) counted from the start of the wait. On a quiet machine a game
// second is a wall second, so the assertions are unchanged; under load they take longer.
//
// Every read happens between frames. App.frame awaits the ferry and ragdoll workers in the
// middle of a frame (src/App.js, _frame then finishFrame), after Disasters.before has
// stepped the water and before the ocean culling bounds follow it. A read inside that gap
// sees this frame's flood surface next to last frame's bounds; the frame that draws the
// water has both (test/browser/disaster-materials.spec.js, Extreme tsunami, failed this
// way on base the baseline at load 117: bound 25.0 m for a 2875 m surface).

// Wall-clock cap for one wait: only a hang should reach it.
export const WALL_CAP_MS = 600_000;
// A whole disaster scenario under load: boot plus three or four game-time waits.
export const SCENARIO_TIMEOUT_MS = 1_200_000;

// Runs `probe` (a page function with no closure, returning a JSON value) between frames and
// returns [ value, disaster clock in game seconds ] read in the same task.
function sample( page, probe, arg ) {

	return page.evaluate( async ( { source, arg } ) => {

		await new Promise( ( resolve ) => {

			const check = () => window.__app.simulationPending ? setTimeout( check, 4 ) : resolve();
			check();

		} );
		const value = ( 0, eval )( `(${ source })` )( arg );
		return [ value, window.__app.disasters.field.time ];

	}, { source: probe.toString(), arg } );

}

// One read of `probe` between frames.
export async function atFrameBoundary( page, probe, arg ) {

	return ( await sample( page, probe, arg ) )[ 0 ];

}

// Polls `probe` until it returns truthy or `budget` game seconds pass on the disaster clock.
// Returns { value, elapsed } so the caller asserts on the value and reports the game time.
export async function untilGameTime( page, probe, budget, arg ) {

	const deadline = Date.now() + WALL_CAP_MS;
	let [ value, start ] = await sample( page, probe, arg );
	let elapsed = 0;
	while ( ! value && elapsed <= budget && Date.now() < deadline ) {

		await page.waitForTimeout( 250 );
		let now;
		[ value, now ] = await sample( page, probe, arg );
		elapsed = now - start;

	}
	return { value, elapsed };

}

// The same wait for a check that runs in the test, such as a locator read of the status panel.
export async function untilGameTimeCheck( page, check, budget ) {

	const clock = () => 0;
	const deadline = Date.now() + WALL_CAP_MS;
	const start = ( await sample( page, clock ) )[ 1 ];
	let value = await check();
	let elapsed = 0;
	while ( ! value && elapsed <= budget && Date.now() < deadline ) {

		await page.waitForTimeout( 250 );
		value = await check();
		elapsed = ( await sample( page, clock ) )[ 1 ] - start;

	}
	return { value, elapsed };

}
