// The far-field solution approaches the nearshore simulation at the speed of a long wave.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS, planApproach } from '../src/disasters/Field.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
const G = 9.81; // m/s^2
const RING_HALF = 4096; // m: the outer ring's half width (Field.js OUTER_GRID, 257 x 32 m)

// Distance (m) from the target back along the heading to the ring's square edge.
function ringEdge( x, z, cx, cz ) {
	const tx = cx > 0 ? ( x + RING_HALF ) / cx : cx < 0 ? ( x - RING_HALF ) / cx : Infinity;
	const tz = cz > 0 ? ( z + RING_HALF ) / cz : cz < 0 ? ( z - RING_HALF ) / cz : Infinity;
	return Math.min( tx, tz );
}

test( 'Walls the ring cannot hold come in from beyond it for 25-30 s at their bore speed; swells do not', () => {
	for ( const H of [ 320, 3000 ] ) for ( let seed = 1; seed <= 10; seed ++ ) {
		const p = planApproach( ground, { ...DEFAULTS.tsunami, intensity: H, warningLead: 3, seed } );
		const a = p.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
		const sx = DEFAULTS.tsunami.x - cx * p.launchDistance, sz = DEFAULTS.tsunami.z - cz * p.launchDistance;
		// The wall moves as a bore fed from beyond the ring, Stoker (1957), at any height (no longer held to
		// the dam-break front of a reservoir at rest): 732 m/s for 3000 m over 90 m of sea, 106 m/s for 320 m.
		const d = Math.max( 0.5, - ground( sx, sz ) ), dam = Math.sqrt( G * ( d + H ) * ( 2 * d + H ) / ( 2 * d ) );
		const where = `H ${ H } m, seed ${ seed }`;
		assert.ok( Math.abs( p.farField.length / ( 20 * ( d + H ) ) - 1 ) < 1e-9, `${ where }: crest ${ p.farField.length } m long, 20 water depths` );
		assert.ok( p.farField, `${ where }: a wall of ${ H } m over ${ d.toFixed( 0 ) } m of water must come in from beyond the ring` );
		assert.ok( p.farField.time >= 25 && p.farField.time <= 30, `${ where }: far-field approach ${ p.farField.time.toFixed( 1 ) } s` );
		assert.ok( Math.abs( p.farField.speed / dam - 1 ) < 0.01, `${ where }: wall speed ${ p.farField.speed.toFixed( 0 ) } m/s vs bore ${ dam.toFixed( 0 ) } m/s` );
		assert.ok( p.farField.distance > ringEdge( DEFAULTS.tsunami.x, DEFAULTS.tsunami.z, cx, cz ), `${ where }: the wall starts ${ p.farField.distance.toFixed( 0 ) } m out, inside the ring` );
		assert.ok( Math.abs( p.approach - p.farField.time - p.ringApproach ) < 1e-9 && p.arrival === p.warning + p.approach, `${ where }: approach ${ p.approach } = far ${ p.farField.time } + ring ${ p.ringApproach }` );
		assert.equal( p.launchTime, p.warning + p.farField.time );
	}
	// The -60 deg shelf makes a 10 m wave a bore at its source 1 km out, but the ring holds its 60-90 s.
	for ( const H of [ 2, 10 ] ) for ( const direction of [ - 60, DEFAULTS.tsunami.direction ] ) for ( let seed = 1; seed <= 10; seed ++ ) {
		const p = planApproach( ground, { ...DEFAULTS.tsunami, intensity: H, direction, warningLead: 3, seed } );
		assert.equal( p.farField, null, `H ${ H } m, ${ direction } deg, seed ${ seed }: the ring holds this wave's approach (${ p.ringApproach.toFixed( 1 ) } s), no far field` );
		assert.equal( p.launchTime, p.warning );
	}
} );

// The wall's crest (highest water) along the approach ray between `near` and `far` m from the target, and its
// face: the nearest point shoreward of the crest still above half the crest height (m from the target), found
// by the level crossing on 4 m samples. The crest alone moves in whole 32 m cells on the outer ring.
function wallOnRay( field, e, near, far ) {
	const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
	let height = - Infinity, at = 0;
	for ( let s = near; s <= far; s += 4 ) {
		const h = field.waterAt( e.x - cx * s, e.z - cz * s );
		if ( h > height ) { height = h; at = s; }
	}
	let face = at, above = height;
	for ( let s = at - 4; s >= near; s -= 4 ) {
		const h = field.waterAt( e.x - cx * s, e.z - cz * s );
		if ( h < height / 2 ) { face = s + 4 * ( height / 2 - h ) / ( above - h ); break; }
		above = h;
	}
	return { height, distance: at, face };
}

// Hand-off (seed, height): the last analytic frame against the first solver frame, then the solver's wall.
// Measured under the initial conditions (seed 2, real island): 3000 m face 368 m/s over 3 s against 348; 320 m 125 m/s against 106,
// its face slow for the first second while the hump settles. The 25% band holds both. Previously the crest slumped
// (3000 m to about 1430 m in 3 s); with the current solver the ring's boundary feeds the wall's crest in for its whole length
// at the bore's own speed and water speed, and test/tsunami-mega.mjs holds it to 85% of H to the coast.
// Was, with the simple-wave launch: face 408 m/s; with a translating mass flux alone: 464 m/s.
const HANDOFF_SPEED_BAND = 0.25; // fraction of the wall speed, mean over the first 3 s after the hand-off
test( 'The wall stands beyond the ring, then the solver takes it at the same height and speed', () => {
	for ( const [ seed, H ] of [ [ 2, 3000 ], [ 7, 3000 ], [ 4, 320 ] ] ) {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, warningLead: 3, duration: 60, seed } );
		const far = e.farField, where = `H ${ H } m, seed ${ seed }`;
		// Ten seconds after the warning the crest is still beyond the ring, where no solver cell exists.
		while ( field.time < e.warning + 10 - 1e-9 ) field.advance( 0.1 );
		const out = e.launchDistance + far.speed * ( e.launchTime - field.time );
		const seen = wallOnRay( field, e, out - 400, out + 400 );
		assert.ok( Math.abs( seen.height / H - 1 ) < 0.02 && Math.abs( seen.distance - out ) <= 8, `${ where }: at ${ field.time.toFixed( 1 ) } s the wall must stand ${ out.toFixed( 0 ) } m out at ${ H } m; found ${ seen.height.toFixed( 0 ) } m at ${ seen.distance } m` );
		assert.ok( field.waterAt( 0, 0 ) < 1, `${ where }: the village is still dry` );
		while ( field.time + 0.02 < e.launchTime - 1e-9 ) field.advance( 0.02 );
		const before = wallOnRay( field, e, e.launchDistance - 900, e.launchDistance + 600 ), t0 = field.time;
		while ( ! e.launched ) field.advance( 0.02 );
		const after = wallOnRay( field, e, e.launchDistance - 900, e.launchDistance + 600 ), t1 = field.time;
		assert.ok( Math.abs( after.height / before.height - 1 ) < 0.03, `${ where }: crest ${ before.height.toFixed( 0 ) } m before the hand-off, ${ after.height.toFixed( 0 ) } m after` );
		const expected = before.face - far.speed * ( t1 - t0 );
		// Within two outer cells (64 m) at at 348 m/s (measured 19 m for seed 2 and 41 m for seed 7 at 3000 m).
		// at the sustained bore's 732 m/s the 3000 m face landed 97 m (seed 2) and 161 m (seed 7) ahead in the
		// first frame: the fixed-step accumulator kept the calm sea's unspent lag (up to one 0.24 s ring step) and
		// replayed it on the freshly launched wall, 0.13-0.22 s x 732 m/s. Not the inflow band (same jump with the
		// inflow off; the band starts 640 m behind the face). Two outer cells, as under the initial conditions.
		assert.ok( Math.abs( after.face - expected ) <= 64, `${ where }: face ${ before.face.toFixed( 0 ) } m out before, ${ after.face.toFixed( 0 ) } m after ${ ( t1 - t0 ).toFixed( 2 ) } s (expected ${ expected.toFixed( 0 ) } m at ${ far.speed.toFixed( 0 ) } m/s)` );
		while ( field.time < t1 + 3 - 1e-9 ) field.advance( 0.02 );
		const later = wallOnRay( field, e, e.launchDistance - 2400, e.launchDistance + 200 );
		const speed = ( after.face - later.face ) / ( field.time - t1 );
		assert.ok( Math.abs( speed / far.speed - 1 ) < HANDOFF_SPEED_BAND, `${ where }: the solver's wall face ran ${ speed.toFixed( 0 ) } m/s over 3 s after the hand-off vs the wall's ${ far.speed.toFixed( 0 ) } m/s` );
		// Beyond the ring's side the solver has no cells: the wall goes on there, it does not vanish.
		const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
		const along = e.launchDistance + far.speed * ( e.launchTime - field.time ), side = RING_HALF + 1500;
		let wall = - Infinity;
		for ( let s = along - 300; s <= along + 300; s += 4 ) wall = Math.max( wall, field.waterAt( e.x - cx * s - cz * side, e.z - cz * s + cx * side ) );
		assert.ok( wall > 0.98 * H, `${ where }: beyond the ring's side the wall reads ${ wall.toFixed( 0 ) } m` );
		// The village stays dry until the wall has come the whole way in.
		let wetAt = - 1;
		while ( field.time < e.arrival + 30 && field.events.has( 'tsunami' ) ) {
			field.advance( 0.1 );
			if ( field.waterAt( 0, 0 ) > 1 ) { wetAt = field.time; break; }
		}
		assert.ok( wetAt >= e.warning + 25, `${ where }: the village went under ${ ( wetAt - e.warning ).toFixed( 1 ) } s after the warning; the wall needs 25 s and more to come in` );
	}
} );
