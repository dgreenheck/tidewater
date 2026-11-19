// Each event samples its own approach and heading. A seed makes the event reproducible in tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS, planApproach } from '../src/disasters/Field.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'Two tsunamis with the same settings play out differently', () => {
	const a = new DisasterField( ground ).start( 'tsunami', { ...DEFAULTS.tsunami } );
	const b = new DisasterField( ground ).start( 'tsunami', { ...DEFAULTS.tsunami } );
	assert.ok( Number.isInteger( a.seed ) && Number.isInteger( b.seed ) && a.seed !== b.seed, `each event draws its own seed: ${ a.seed } and ${ b.seed }` );
	assert.ok( a.direction !== b.direction && a.drawdown !== b.drawdown && a.crestWidth !== b.crestWidth, `heading, N-wave and wavelength must differ: ${ JSON.stringify( [ a.direction, a.drawdown, a.crestWidth ] ) } vs ${ JSON.stringify( [ b.direction, b.drawdown, b.crestWidth ] ) }` );
} );

test( 'planApproach gives the panel the same countdown a real start gives for that seed, without a water grid', () => {
	for ( const seed of [ 11, 12, 13 ] ) {
		const config = { ...DEFAULTS.tsunami, intensity: 10, warningLead: 20, seed };
		const plan = planApproach( ground, config );
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', config );
		assert.equal( plan.arrival, e.arrival, `seed ${ seed }: plan ${ plan.arrival } s vs start ${ e.arrival } s` );
		assert.equal( plan.launchDistance, e.launchDistance );
		assert.equal( plan.direction, e.direction );
	}
} );

test( 'Every seed keeps a 60-120 s approach from open water and a drawdown of about 0.5 H', () => {
	for ( const H of [ 2, 10 ] ) for ( const direction of [ - 60, DEFAULTS.tsunami.direction ] ) for ( let seed = 1; seed <= 10; seed ++ ) {
		const p = planApproach( ground, { ...DEFAULTS.tsunami, intensity: H, direction, warningLead: 3, seed } );
		const a = p.direction * Math.PI / 180;
		const sx = DEFAULTS.tsunami.x - Math.cos( a ) * p.launchDistance, sz = DEFAULTS.tsunami.z - Math.sin( a ) * p.launchDistance;
		const where = `H ${ H } m, ${ direction } deg, seed ${ seed }: heading ${ p.direction.toFixed( 1 ) }, source ${ p.launchDistance } m out`;
		assert.ok( p.approach >= 60 && p.approach <= 120, `${ where }: approach ${ p.approach.toFixed( 1 ) } s` );
		assert.ok( ground( sx, sz ) <= - 10, `${ where }: the crest starts in ${ ( - ground( sx, sz ) ).toFixed( 1 ) } m of water` );
		assert.ok( Math.abs( p.direction - direction ) <= 8 && p.drawdown >= 0.45 && p.drawdown <= 0.6, `${ where }: drawdown ${ p.drawdown.toFixed( 2 ) } H` );
	}
} );

test( 'A replay seed must be a 32-bit whole number', () => {
	assert.throws( () => new DisasterField( ground ).start( 'tsunami', { ...DEFAULTS.tsunami, seed: - 1 } ), RangeError );
	assert.throws( () => new DisasterField( ground ).start( 'tsunami', { ...DEFAULTS.tsunami, seed: 1.5 } ), RangeError );
} );
