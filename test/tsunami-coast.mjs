// "Coastal flooding detected" is the warning banner's claim that this tsunami has come ashore at the coast it
// warns about (src/disasters/Controls.js warning; src/evacuation/Route.js reads the same e.coastReached).
// In the regression, the Surge 2 m from seed 7 read "Coastal flooding detected · crest estimate 103 s" right at launch.
// The plane crest spans the whole grid (planApproach crestHalfLength), and on the -90 deg heading its source line
// lies just north of Joey Island (launchDistance 1052 m, the islet's north beach about 1000-1040 m back along the
// ray, ground 0.00-0.25 m), so that beach takes 0.3-1.3 m of the Gaussian's forward tail at 2-6 m/s within 1 s of
// the launch (the Joey terminal car park), 900 m from the village and 104 s before the crest gets there.
// The detector counted any wet land in the grid (stats.inundatedArea > 0). It must fire when the bore reaches
// the target's own shore: land within the event's radius of the target, at the arrival the countdown promised.
// Band: the beach floods on the crest's rising limb (a Gaussian front at least 6 x 32 m wide, CREST_CELLS), which
// reaches the shoreline well before the peak the countdown times (Surge seed 7: first village land wet at 74.9 s,
// the peak due at 98 s). So the flag is held to the front: within 15% of the countdown (the
// planApproach band, test/tsunami-approach.mjs) of the first time the sea at the target's shoreline rises
// INUNDATION_DEPTH above datum, never in the first half of the approach, and no later than the crest band.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { INUNDATION_DEPTH } from '../src/disasters/WaterGrid.js';

const STEP = 0.1; // s: the game's largest accepted disaster step
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// The shoreline on the approach ray: the first point out from the target with half a metre of still water
// (test/tsunami-approach.mjs shoreFor).
function shoreFor( e ) {
	const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
	for ( let s = 0; s < e.launchDistance; s += 2 ) if ( ground( e.x - cx * s, e.z - cz * s ) <= - 0.5 ) return { x: e.x - cx * s, z: e.z - cz * s };
	return null;
}

// The disasters.spec Tsunami control run (Fishing village target (40, -115) as Controls.target sets it, Surge 2 m,
// 6 s lead, radius 180 m, seed 7) and the default config's Severe 10 m (DEFAULTS.tsunami at (40, -25), seed 1, a
// shelf-edge source in test/tsunami-approach.mjs).
for ( const [ name, H, x, z, radius, seed ] of [ [ 'Surge', 2, 40, - 115, 180, 7 ], [ 'Severe', 10, DEFAULTS.tsunami.x, DEFAULTS.tsunami.z, DEFAULTS.tsunami.radius, 1 ] ] ) {
	test( `${ name } ${ H } m (seed ${ seed }): coastal flooding is reported when the bore reaches the village shore, not at launch`, () => {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x, z, intensity: H, warningLead: 6, radius, duration: 90, seed } );
		const shore = shoreFor( e );
		assert.ok( shore && Math.hypot( shore.x - x, shore.z - z ) < radius, 'the shoreline on the ray lies inside the watched radius' );
		const launch = e.launchTime ?? e.warning; // s
		const approach = e.arrival - launch; // s: the countdown at launch
		const sea = {};
		let front = null; // s after launch: the sea at the shoreline first INUNDATION_DEPTH above datum
		const step = () => {
			field.advance( STEP );
			if ( front === null && e.launched && field.water.sample( shore.x, shore.z, sea ).height > INUNDATION_DEPTH ) front = e.time - launch;
		};
		while ( e.time < launch + 1 ) step();
		assert.ok( e.launched, 'the crest launched' );
		assert.equal( e.coastReached, undefined, `coast flagged ${ ( e.firstImpact - launch ).toFixed( 1 ) } s after launch with the crest ${ ( e.arrival - e.time ).toFixed( 0 ) } s out (${ field.water.stats.inundatedArea } m^2 wet land in the grid)` );
		while ( ( ! e.coastReached || front === null ) && e.time < e.arrival + 0.5 * approach ) step();
		assert.ok( e.coastReached, `the village shore never flooded by ${ ( e.time - launch ).toFixed( 0 ) } s after launch` );
		assert.ok( front !== null, 'the sea at the shoreline never rose' );
		const flood = e.firstImpact - launch;
		const report = `village land wet ${ flood.toFixed( 1 ) } s after launch, sea front at the shoreline ${ front.toFixed( 1 ) } s, countdown ${ approach.toFixed( 1 ) } s`;
		console.log( `${ name } ${ H } m seed ${ seed }: ${ report }` );
		assert.ok( flood >= 0.5 * approach, `${ report }: flagged in the first half of the approach` );
		assert.ok( Math.abs( flood - front ) <= 0.15 * approach, `${ report }: the flag must follow the front within 15% of the countdown` );
		assert.ok( flood <= 1.15 * approach, `${ report }: later than the crest band` );
	} );
}
