// One water field for everyone: a ragdoll stepped in the worker must see the same tsunami water as the
// main thread, out to the 8 km outer ring. Before the earlier implementation the snapshot copied only the 2 km inner grid
// (src/player/workers/RigSnapshot.js captureField), so a body beyond 1 km of the origin saw a flat sea
// in the worker while the approaching crest stood over it on the main thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { captureField, restoreField } from '../src/player/workers/RigSnapshot.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'A body beyond the inner grid sees the approaching tsunami in the worker as on the main thread', () => {
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 10, warningLead: 3, seed: 7 } );
	for ( let t = 0; t < 4; t += 0.1 ) field.advance( 0.1 ); // past the warning: the crest is launched
	assert.ok( e.launched, 'the wave is launched' );
	// The crest line, measured on the live field (never a hard-coded spot): the source along the ray.
	const a = e.direction * Math.PI / 180;
	const source = { x: e.x - Math.cos( a ) * e.launchDistance, z: e.z - Math.sin( a ) * e.launchDistance };
	assert.ok( ! field.water.contains( source.x, source.z ), `the source must lie outside the 2 km inner grid for this check (${ source.x.toFixed( 0 ) }, ${ source.z.toFixed( 0 ) })` );
	const live = field.sampleRaw( source.x, 0, source.z, {} );
	assert.ok( live.height > 0.3 * e.intensity, `the main thread sees the crest there: ${ live.height.toFixed( 2 ) } m` );
	const worker = restoreField( structuredClone( captureField( field ) ), ground ).sampleRaw( source.x, 0, source.z, {} );
	assert.ok( Math.abs( worker.height - live.height ) < 1e-4 && Math.abs( worker.ux - live.ux ) < 1e-4 && Math.abs( worker.uz - live.uz ) < 1e-4,
		`the worker must see the same water: worker ${ worker.height.toFixed( 3 ) } m, ${ worker.ux.toFixed( 3 ) } m/s vs main ${ live.height.toFixed( 3 ) } m, ${ live.ux.toFixed( 3 ) } m/s` );
} );

// The mega wall comes in analytically from beyond the 8 km ring (Field.farFieldAt) for 25-30 s before any
// solver cell holds it, and runs on beyond the ring's sides after the hand-off. A body out there (a boat, a
// swimmer) is stepped in the worker, so the worker's field must draw the same wall: the snapshot carries the
// event (e.farField, e.launchTime, e.launched) and the clock it is placed by.
test( 'A body beyond the ring sees the far-field wall in the worker as on the main thread', () => {
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 3000, warningLead: 3, seed: 2 } );
	assert.ok( e.farField, 'a 3000 m wall comes in from beyond the ring' );
	const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
	const check = ( phase, x, z ) => {
		const live = field.sampleRaw( x, 0, z, {} );
		assert.ok( live.height > 0.9 * e.intensity, `${ phase }: the main thread sees the wall at (${ x.toFixed( 0 ) }, ${ z.toFixed( 0 ) }): ${ live.height.toFixed( 0 ) } m` );
		const worker = restoreField( structuredClone( captureField( field ) ), ground ).sampleRaw( x, 0, z, {} );
		assert.ok( Math.abs( worker.height - live.height ) < 1e-6 && Math.abs( worker.ux - live.ux ) < 1e-6 && Math.abs( worker.uz - live.uz ) < 1e-6,
			`${ phase }: the worker must see the same wall: ${ worker.height.toFixed( 1 ) } m, ${ worker.ux.toFixed( 1 ) } m/s vs main ${ live.height.toFixed( 1 ) } m, ${ live.ux.toFixed( 1 ) } m/s` );
	};
	// Ten seconds after the warning the crest is still kilometres beyond the ring: a body at the crest.
	while ( field.time < e.warning + 10 ) field.advance( 0.1 );
	const out = field.farCrest( e ) - 50; // m from the target: just shoreward of the crest line, on the face
	check( 'far phase', e.x - cx * out, e.z - cz * out );
	// After the hand-off the wall goes on beyond the ring's side, 1.5 km past it.
	while ( ! e.launched ) field.advance( 0.1 );
	field.advance( 0.1 );
	const along = field.farCrest( e ) + 200, side = 4096 + 1500;
	check( 'beyond the side', e.x - cx * along - cz * side, e.z - cz * along + cx * side );
} );
