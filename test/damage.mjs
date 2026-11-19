import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/index.js';
import { DamageState, zoneWeights, cornerWeights, LEVELS, STATE_LENGTH } from '../src/rally/DamageModel.js';
import { makePiece, stepPiece } from '../src/rally/Wreckage.js';

// The Aster's body box and wheel hubs in car-local metres (+Z nose, +X driver-left).
const DIMS = { hx: 0.95, hz: 2.3, floor: 0.1, top: 1.35, wheels: [ [ - 0.79, 1.35 ], [ 0.79, 1.35 ], [ - 0.79, - 1.3 ], [ 0.79, - 1.3 ] ] };
const PARTS = [
	{ name: 'bumperFront', anchor: [ 0, 0.4, 2.2 ], at: 0.35, radius: 1.3 },
	{ name: 'lampRearLeft', anchor: [ 0.65, 0.8, - 2.1 ], at: 0.2, radius: 1.1 },
];
const NOSE = [ 0, 0.5, 2.3 ], BACKWARD = [ 0, 0, - 1 ];
const heaviest = w => w.indexOf( Math.max( ...w ) );
const flat = { heightAt: () => 0, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) };
const beach = { heightAt: ( x, z ) => 2 - x * 0.05, normalAt: ( x, z, out ) => out.set( 0.05, 1, 0 ).normalize() };

test( 'hits land in the zone they struck: nose, tail, driver-left, driver-right, roof', () => {
	assert.equal( heaviest( zoneWeights( NOSE, BACKWARD, DIMS ) ), 0 );
	assert.equal( heaviest( zoneWeights( [ 0, 0.5, - 2.3 ], [ 0, 0, 1 ], DIMS ) ), 1 );
	assert.equal( heaviest( zoneWeights( [ 0.95, 0.6, 0 ], [ - 1, 0, 0 ], DIMS ) ), 2 );
	assert.equal( heaviest( zoneWeights( [ - 0.95, 0.6, 0 ], [ 1, 0, 0 ], DIMS ) ), 3 );
	assert.equal( heaviest( zoneWeights( [ 0, 1.35, 0 ], [ 0, - 1, 0 ], DIMS ) ), 4 );
	assert.deepEqual( cornerWeights( [ 0, 1.3, 0 ], DIMS ), [ 0, 0, 0, 0 ] );
	assert.ok( cornerWeights( [ 0.9, 0.35, 1.4 ], DIMS )[ 1 ] > 0.9 );
} );

test( 'heavy nose hits escalate steam, then smoke, then fire; the sea puts it out', () => {
	const st = new DamageState( DIMS, PARTS );
	st.hit( NOSE, BACKWARD, 0.9 ); st.tick( 0.1 );
	assert.equal( st.steam, 0, 'a tap does nothing visible' );
	st.hit( NOSE, BACKWARD, 12 ); st.tick( 0.1 );
	assert.ok( st.steam > 0 && st.smoke === 0 && st.fire === 0, 'one heavy hit holes the radiator' );
	assert.ok( st.mechanical().engine < 0.8, 'and costs engine power' );
	st.hit( NOSE, BACKWARD, 12 ); st.tick( 0.1 );
	assert.ok( st.smoke > 0 && st.fire === 0, 'two heavy hits smoke' );
	st.hit( NOSE, BACKWARD, 12 ); st.tick( 0.1 );
	assert.ok( st.fire > 0, 'three heavy hits burn' );
	for ( let t = 0; t < 30; t += 0.1 ) st.tick( 0.1 );
	assert.equal( st.fire, 1 );
	assert.equal( st.mechanical().engine, 0, 'a fire left burning kills the engine' );
	st.tick( 0.1, 0.5 );
	assert.equal( st.fire, 0 ); assert.ok( st.quenched );
	st.tick( 0.1 );
	assert.equal( st.fire, 0, 'a doused car does not reignite on its own' );
} );

test( 'parts break where they were hit, landings are ignored, and a severe hub hit tears a wheel off', () => {
	const st = new DamageState( DIMS, PARTS );
	st.hit( [ 0, 0.1, 0 ], [ 0, 1, 0 ], 5 );
	assert.equal( st.impacts, 0, 'bottoming out on landing is suspension, not damage' );
	const nose = st.hit( NOSE, BACKWARD, 11 );
	assert.deepEqual( nose.broken, [ 0 ], 'the nose hit drops the front bumper, not a rear lamp' );
	assert.equal( st.partsLost, 1 );
	// About 58 km/h of delta-v square on the hub.
	const corner = st.hit( [ 0.9, 0.35, 1.4 ], [ - 1, 0, 0 ], 16 );
	assert.deepEqual( corner.wheels, [ 1 ] );
	const m = st.mechanical();
	assert.equal( m.wheels[ 9 ], 1, 'front-right in physics order is gone' );
	const bent = new DamageState( DIMS, PARTS );
	bent.hit( [ 0.9, 0.35, 1.4 ], [ - 1, 0, 0 ], 6 );
	const b = bent.mechanical();
	assert.ok( b.wheels[ 1 ] !== 0 && b.wheels[ 5 ] < 1 && b.wheels[ 9 ] === 0, 'a lighter corner hit bends toe and softens the spring' );
	assert.ok( b.pull !== 0 );
	st.reset();
	assert.deepEqual( [ ...st.mechanical().wheels ], [ 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0 ] );
	assert.equal( st.mechanical().engine, 1 );
} );

test( 'calibration: scrapes only dent, a proper nose-in steams, fire takes repeated heavy hits or one very heavy one', () => {
	const kmh = v => v / 3.6;
	// A glancing 40 km/h rail scrape: several sideways shoves along the nose corner.
	const scrape = new DamageState( DIMS, PARTS );
	for ( let i = 0; i < 4; i ++ ) scrape.hit( [ 0.85, 0.5, 1.9 ], [ - 0.94, 0, - 0.34 ], 5 );
	assert.ok( scrape.zones[ 0 ] < LEVELS.steam, `scrapes load the side, not the radiator (front ${ scrape.zones[ 0 ] })` );
	assert.ok( scrape.zones[ 2 ] > scrape.zones[ 0 ], 'the scraped side takes the damage' );
	const bump = new DamageState( DIMS, PARTS );
	bump.hit( NOSE, BACKWARD, kmh( 25 ) );
	assert.ok( bump.zones[ 0 ] > 0 && bump.zones[ 0 ] < LEVELS.steam, `25 km/h nose-in dents only (front ${ bump.zones[ 0 ] })` );
	const proper = new DamageState( DIMS, PARTS );
	proper.hit( NOSE, BACKWARD, kmh( 38 ) );
	assert.ok( proper.zones[ 0 ] >= LEVELS.steam && proper.zones[ 0 ] < LEVELS.smoke, `38 km/h nose-in steams (front ${ proper.zones[ 0 ] })` );
	proper.hit( NOSE, BACKWARD, kmh( 45 ) );
	assert.ok( proper.zones[ 0 ] < LEVELS.fire, 'two heavy hits do not burn' );
	assert.deepEqual( proper.wheelsLost, 0, 'nose-on hits leave the wheels on' );
	const huge = new DamageState( DIMS, PARTS );
	huge.hit( NOSE, BACKWARD, kmh( 95 ) );
	assert.ok( huge.zones[ 0 ] >= LEVELS.fire, 'one very heavy hit can' );
} );

test( 'the damage state round-trips through its serialised array', () => {
	const st = new DamageState( DIMS, PARTS );
	st.hit( NOSE, BACKWARD, 12 ); st.hit( [ 0.9, 0.35, 1.4 ], [ - 1, 0, 0 ], 13 ); st.tick( 1 );
	const data = st.serialize();
	assert.equal( data.length, STATE_LENGTH );
	const copy = new DamageState( DIMS, PARTS );
	assert.ok( copy.apply( data ) );
	assert.deepEqual( copy.serialize(), data );
	assert.equal( copy.apply( [ 2 ] ), false );
	assert.ok( copy.glass >= 0 && LEVELS.shatter > LEVELS.crack );
} );

test( 'debris falls, bounces and settles flat on the sand without drifting', () => {
	const p = makePiece( { position: new Vector3( 0, 3, 0 ), velocity: new Vector3( 2, 1, 0 ), spin: new Vector3( 4, 2, 1 ), rest: 0.03, radius: 0.5 } );
	for ( let i = 0; i < 400; i ++ ) stepPiece( p, 1 / 60, flat, - 10 );
	assert.ok( p.sleep, 'settled' );
	assert.ok( Math.abs( p.pos.y - 0.03 ) < 0.08, `resting on the ground at ${ p.pos.y }` );
	assert.ok( p.pos.x > 0.2 && p.pos.x < 4, `slid a little, then stopped at ${ p.pos.x }` );
	assert.ok( [ p.pos.x, p.pos.y, p.pos.z ].every( Number.isFinite ) );
} );

test( 'a lost wheel rolls on, topples onto its side and lies flat', () => {
	const p = makePiece( { position: new Vector3( 0, 2.5, 0 ), velocity: new Vector3( 0, 0, 8 ), rest: 0.12, radius: 0.34, wheel: { radius: 0.34, width: 0.12 } } );
	let upright = 0;
	for ( let i = 0; i < 900; i ++ ) { stepPiece( p, 1 / 60, beach, - 10 ); if ( p.wheel.lean < 0.2 ) upright = p.pos.z; }
	assert.ok( upright > 3, `rolled ${ upright } m upright first` );
	assert.equal( p.wheel.lean, Math.PI / 2, 'fell over' );
	assert.ok( Math.abs( p.pos.y - ( beach.heightAt( p.pos.x, p.pos.z ) + 0.12 ) ) < 0.03, 'lying on its side on the sand' );
} );

test( 'a piece that lands in the sea floats, then sinks', () => {
	const sea = { heightAt: () => - 5, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) };
	const p = makePiece( { position: new Vector3( 0, 1, 0 ), rest: 0.05, radius: 0.4, floats: 3 } );
	for ( let i = 0; i < 120; i ++ ) stepPiece( p, 1 / 60, sea, 0 );
	assert.ok( Math.abs( p.pos.y ) < 0.15, `bobbing at the surface: ${ p.pos.y }` );
	for ( let i = 0; i < 600; i ++ ) stepPiece( p, 1 / 60, sea, 0 );
	assert.ok( p.pos.y < - 1, `sinking: ${ p.pos.y }` );
} );
