// The browser specs replay one tsunami through the real panel: they set window.__app.disasters.nextSeed
// (internal plumbing, never in any UI) and press Start. Disasters.start must consume it once, for both
// the event's own seed (the tsunami plan: heading, approach, arrival) and the run's capacity scatter
// (runSeed, read by Structures and MaterialMembers), then go back to a fresh crypto seed per event.
// Real island terrain: the plan a seed gives is checked against planApproach on the same ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField, DEFAULTS, planApproach } from '../src/disasters/Field.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
const SURGE = { ...DEFAULTS.tsunami, intensity: 2, warningLead: 6 }; // the spec's Surge 2 m at the village

// The real Disasters.start on a host with only what start touches: no renderer, siren or vessels.
function host( field, defer = () => false ) {
	return {
		app: { deferSimulationChange: defer },
		vesselSnapshots: [],
		field,
		siren: { arm: () => Promise.resolve() },
		refresh() {},
		start: Disasters.prototype.start,
	};
}

test( 'A one-shot nextSeed fixes the event seed and the run seed, then the next event is fresh', () => {
	const field = new DisasterField( ground ), d = host( field ), seed = 3141592653;
	d.nextSeed = seed;
	d.start( 'tsunami', SURGE );
	const e = field.events.get( 'tsunami' ), plan = planApproach( ground, { ...SURGE, seed } );
	assert.equal( d.runSeed, seed, `runSeed ${d.runSeed}` );
	assert.equal( e.seed, seed, `event seed ${e.seed}` );
	assert.equal( d.nextSeed, null, 'the hook is consumed' );
	// The physical event is the one that seed plans: heading, source distance and crest arrival.
	assert.equal( e.direction, plan.direction );
	assert.equal( e.launchDistance, plan.launchDistance );
	assert.equal( e.arrival, plan.arrival, `arrival ${e.arrival} s against the plan's ${plan.arrival} s` );
	field.stop();
	d.start( 'tsunami', SURGE );
	const again = field.events.get( 'tsunami' );
	assert.notEqual( d.runSeed, seed, 'a calm start after the hook draws a fresh run seed' );
	assert.notEqual( again.seed, seed, 'and a fresh event seed' );
} );

test( 'A start deferred to the frame boundary keeps the hook until it really starts', () => {
	let queued = null;
	const field = new DisasterField( ground );
	const d = host( field, fn => { if ( queued ) return false; queued = fn; return true; } );
	d.nextSeed = 77;
	d.start( 'tornado', { intensity: 65, radius: 100, duration: 3 } );
	assert.equal( field.events.size, 0, 'deferred: nothing started yet' );
	assert.equal( d.nextSeed, 77, 'deferred: the hook is still armed' );
	queued();
	assert.equal( d.runSeed, 77 );
	assert.equal( field.events.get( 'tornado' ).seed, 77, 'the tornado track replays from the same seed' );
	assert.equal( d.nextSeed, null );
} );
