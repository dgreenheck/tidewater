// Measure the approach from the offshore source to the shore using game time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';

const G = 9.81; // m/s^2
const STEP = 0.1; // s: the game's largest accepted disaster step
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// Points along the approach ray, from the source (s = D) in to the target (s = 0).
function along( e, s ) {
	const a = e.direction * Math.PI / 180;
	return { x: e.x - Math.cos( a ) * s, z: e.z - Math.sin( a ) * s };
}

function gaugeFor( e, H ) {
	// The near-shore gauge is the first point out from the shoreline where the still water is
	// 0.6 H deep (at least 3 m): a 0.3 H drawdown there is water leaving, not the bed showing.
	const want = Math.max( 3, 0.6 * H );
	for ( let s = 0; s < e.launchDistance; s += 2 ) {
		const p = along( e, s );
		if ( - ground( p.x, p.z ) >= want ) return { ...p, s };
	}
	return null;
}

// The shoreline gauge: the first point out from the target with half a metre of still water.
function shoreFor( e ) {
	for ( let s = 0; s < e.launchDistance; s += 2 ) {
		const p = along( e, s );
		if ( - ground( p.x, p.z ) >= 0.5 ) return { ...p, s };
	}
	return along( e, 0 );
}

// 'bore' theory for a crest as tall as the shelf is deep. Until it breaks (H < 0.78 d, McCowan) the crest is a
// right-going simple wave and its top moves on the C+ characteristic, u + c = 3 sqrt( g ( d + H ) ) - 2 sqrt( g d )
// (the source launches it with u = 2 ( sqrt( g ( d + H ) ) - sqrt( g d ) )); once broken it is a Stoker (1957)
// bore. Stoker alone timed a 10 m crest at a gauge in 30-40 m of water 15% late (seeds 1 and 9).
function boreTheory( d, H ) {
	if ( H < 0.78 * d ) return 3 * Math.sqrt( G * ( d + H ) ) - 2 * Math.sqrt( G * d );
	return Math.sqrt( G * ( d + H ) * ( 2 * d + H ) / ( 2 * d ) );
}

// Independent long-wave prediction: integrate ds / sqrt( g ( d + H ) ) from the source to the gauge.
function predictedTravel( e, H, gauge, theory = 'long' ) {
	let t = 0;
	for ( let s = e.launchDistance; s > gauge.s; s -= 2 ) {
		const p = along( e, s - 1 );
		const d = Math.max( 0.5, - ground( p.x, p.z ) );
		t += 2 / ( theory === 'bore' ? boreTheory( d, H ) : Math.sqrt( G * ( d + H ) ) );
	}
	return t;
}

// Highest water surface (m above datum) over dry land in each run, by direction and H, one entry per seed.
const runUp = new Map();
// Measure the approach from the offshore source to the shore using game time.
for ( const [ name, H, direction, theory, seeds ] of [ [ 'Surge', 2, - 60, 'long', [ 3 ] ], [ 'Severe', 10, - 60, 'bore', [ 1, 9 ] ], [ 'Surge', 2, DEFAULTS.tsunami.direction, null, [ 4 ] ] ] ) for ( const seed of seeds ) {
	test( `${ name } ${ H } m tsunami from ${ direction } deg (seed ${ seed }) on the real island: drawdown first, a 60-120 s approach, arrival on time`, () => {
		const warning = 3; // s
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, direction, warningLead: warning, duration: 60, seed } );
		const source = along( e, e.launchDistance );
		assert.ok( ground( source.x, source.z ) < - 5, `source must be in open water, ground ${ ground( source.x, source.z ).toFixed( 1 ) } m` );
		const gauge = gaugeFor( e, H );
		assert.ok( gauge, 'a near-shore gauge exists on the approach ray' );
		// The timing gauge sits halfway out, and at least three crest widths in front of the source, where the
		// crest passes as a clean pulse. Inside that the initial crest already stands 0.3 H high at t 0 (a 2 m
		// crest "arrived" in 25 s against 34 s), and at the near-shore gauge the beach's reflection and set-up merge
		// with it (81 s there against 68 s at the shore). A source too close for that is timed at the shoreline.
		const shore = shoreFor( e );
		let timing = null;
		for ( let s = Math.min( e.launchDistance / 2, e.launchDistance - 3 * e.crestWidth ); s >= gauge.s; s -= 2 ) {
			const p = along( e, s );
			if ( - ground( p.x, p.z ) >= Math.max( 3, 0.6 * H ) ) { timing = { ...p, s }; break; }
		}
		timing ??= shore;
		const predicted = predictedTravel( e, H, timing, theory ?? 'long' );
		// Measure the approach from the offshore source to the shore using game time.
		assert.ok( e.approach >= 60 && e.approach <= 120, `the crest must be seen coming for 60-120 s, countdown ${ e.approach.toFixed( 1 ) } s over ${ e.launchDistance.toFixed( 0 ) } m` );

		let land = 0, crestAt = - 1, crestMax = 0, shoreCrestAt = - 1, shoreCrestMax = 0, low = 0, lowAt = - 1, firstHigh = - 1, peak = - Infinity, peakAt = - 1, shorePeak = - Infinity, shorePeakAt = - 1, shoreRise = - 1;
		const end = warning + Math.max( predicted, e.approach ) * 1.3 + 15;
		while ( field.time < end && field.events.has( 'tsunami' ) ) {
			field.advance( STEP );
			if ( ! field.water ) break; // the event ended inside this step
			if ( ! e.launched ) continue;
			const eta = field.water.sample( gauge.x, gauge.z ).height; // m above datum
			assert.ok( Number.isFinite( eta ), 'gauge height stays finite' );
			const t = field.time - warning;
			if ( eta < low ) { low = eta; lowAt = t; }
			if ( firstHigh < 0 && eta > 0.1 * H ) firstHigh = t;
			if ( eta > peak ) { peak = eta; peakAt = t; }
			// The first crest: the top of the first excursion above 0.3 H (later peaks are reflections and edge waves).
			const passing = field.gridAt( timing.x, timing.z ).sample( timing.x, timing.z ).height;
			if ( passing > 0.3 * H && ( crestAt < 0 || t - crestAt < 2 ) && passing > crestMax ) { crestMax = passing; crestAt = t; }
			const run = field.water.sample( shore.x, shore.z ).height;
			if ( run > shorePeak ) { shorePeak = run; shorePeakAt = t; }
			if ( run > 0.3 * H && ( shoreCrestAt < 0 || t - shoreCrestAt < 2 ) && run > shoreCrestMax ) { shoreCrestMax = run; shoreCrestAt = t; }
			// The front reaches the shore when the water there first rises 0.1 H above datum.
			if ( shoreRise < 0 && run > 0.1 * H ) shoreRise = t;
			const w = field.water;
			for ( let k = 0; k < w.h.length; k ++ ) if ( w.bed[ k ] > 0 && w.h[ k ] > 0.05 && w.bed[ k ] + w.h[ k ] > land ) land = w.bed[ k ] + w.h[ k ];
		}
		const report = JSON.stringify( { H, seed, heading: e.direction, drawdown: e.drawdown, land, approach: e.approach, D: e.launchDistance, gaugeDepth: - ground( gauge.x, gauge.z ), timingAt: timing.s, troughLead: e.troughLead, low, lowAt, firstHigh, peak, peakAt, crestAt, shoreCrestAt, predicted, countdown: e.arrival - warning, shorePeak, shorePeakAt, shoreRise } );
		console.log( report );
		runUp.set( `${ direction }:${ H }`, [ ...( runUp.get( `${ direction }:${ H }` ) ?? [] ), land ] );
		// First order left 0.13 H (2 m) and 0.065 H (10 m) of the 0.5 H source trough at this gauge.
		assert.ok( low <= - 0.3 * H, `the sea must draw back at least 0.3 H first: lowest ${ low.toFixed( 2 ) } m ${ report }` );
		assert.ok( lowAt >= 0 && ( firstHigh < 0 || lowAt < firstHigh ), `drawdown must come before any rise: ${ report }` );
		assert.ok( peak > 0.3 * H, `a crest must still arrive: peak ${ peak.toFixed( 2 ) } m ${ report }` );
		if ( theory ) assert.ok( Math.abs( crestAt - predicted ) <= 0.15 * predicted, `first crest arrival ${ crestAt.toFixed( 1 ) } s must be within 15% of the ${ theory } celerity prediction ${ predicted.toFixed( 1 ) } s` );
		// The countdown is to the crest reaching the shore (the drawdown and the first rise come before it).
		assert.ok( shoreCrestAt > 0 && Math.abs( e.arrival - warning - shoreCrestAt ) <= 0.15 * shoreCrestAt, `warning countdown ${ ( e.arrival - warning ).toFixed( 1 ) } s must be within 15% of the first crest at the shoreline ${ shoreCrestAt.toFixed( 1 ) } s ${ report }` );
	} );
}

test( 'Run-up grows with the crest height on the same coast, for every seed', () => {
	const small = runUp.get( '-60:2' ) ?? [], large = runUp.get( '-60:10' ) ?? [];
	assert.ok( small.length && large.length && Math.min( ...small ) > 0 && Math.min( ...large ) > Math.max( ...small ), `run-up must rise with H: 2 m gave ${ small.map( v => v.toFixed( 2 ) ) } m, 10 m gave ${ large.map( v => v.toFixed( 2 ) ) } m` );
} );
