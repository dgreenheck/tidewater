// The rod hint ("R Take out the rod") is offered only where a cast can reach open water, and never
// while a disaster warning or event is live. Real terrain, the real
// chairlift survey, the real pier and the real disaster field; no hard-coded positions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { prepareChairliftSite } from '../src/chairlift/Route.js';
import { PIER } from '../src/world/Pier.js';
import { DisasterField } from '../src/disasters/Field.js';
import { rodHint, cameraHeading } from '../src/game/CastReach.js';

const terrain = new TerrainData();
const site = prepareChairliftSite( terrain, new CoastalRoute( terrain ) );
const SEA = 0; // m: G.seaLevel's value in play
const calm = { field: new DisasterField() };
const YAWS = Array.from( { length: 8 }, ( _, i ) => i * Math.PI / 4 );
// standing on a timber deck (the decks report 'wood', the floor the old rule keyed on)
const walker = ( x, z, yaw ) => ( { mode: 'walk', surface: 'wood', position: { x, y: terrain.heightAt( x, z ), z }, yaw } );
const offered = ( p, disasters = calm ) => rodHint( p, terrain, SEA, disasters );

test( 'no rod hint on the summit deck or the chairlift base deck, whichever way the player faces', () => {

	for ( const [ name, at ] of [ [ 'summit', site.summit ], [ 'base', site.base ] ] ) {

		const s = site.sample( at.distance, {} );
		for ( const yaw of YAWS ) {

			assert.equal( offered( walker( s.x, s.z, yaw ) ), false, `${ name } deck at ${ s.x.toFixed( 1 ) }, ${ s.z.toFixed( 1 ) } (ground ${ terrain.heightAt( s.x, s.z ).toFixed( 1 ) } m) facing yaw ${ yaw.toFixed( 2 ) } offered the rod` );

		}

	}

} );

test( 'the rod hint shows at the pier end facing the sea, and hides there while a tsunami warning is live', () => {

	const seaward = Math.sign( PIER.zEnd - PIER.zStart );
	const z = PIER.zEnd - seaward * 1.0;
	// forward is ( -sin yaw, 0, -cos yaw ) (Player.js), so facing +z is yaw pi
	const yaw = seaward > 0 ? Math.PI : 0;
	const p = walker( PIER.x, z, yaw );
	assert.ok( terrain.heightAt( PIER.x, z + seaward * 10 ) < SEA - 1, 'the pier end stands over water' );
	assert.equal( offered( p ), true, 'pier end facing the sea: the hint must show' );

	const field = new DisasterField();
	field.start( 'tsunami' );
	assert.ok( field.events.size > 0, 'a tsunami warning is live' );
	assert.equal( offered( p, { field } ), false, 'pier end during a tsunami warning: evacuation comes first, no rod hint' );

} );

test( 'the rod hint faces where the cast goes: the camera\'s horizontal heading, not the body', () => {

	// FishingRod's flick aims along the camera's horizontal direction (FishingRod.js, "toward where you
	// aim"), so in third person, with the view orbited away from the body, the hint has to read the view.
	// on the pier 10 m out from its root, over dry sand: open water lies seaward within reach, none landward
	const seaward = Math.sign( PIER.zEnd - PIER.zStart );
	const z = PIER.zStart + seaward * 10;
	assert.ok( terrain.heightAt( PIER.x, z ) > SEA, 'the spot is over dry sand' );
	const seaYaw = seaward > 0 ? Math.PI : 0, landYaw = seaYaw + Math.PI;
	// a camera pitched 20 deg down, looking along +z or -z
	const look = s => ( { x: 0, y: - Math.sin( 0.35 ), z: s * Math.cos( 0.35 ) } );
	const toSea = cameraHeading( look( seaward ) ), toLand = cameraHeading( look( - seaward ) );
	const body = yaw => walker( PIER.x, z, yaw );
	assert.equal( rodHint( body( seaYaw ), terrain, SEA, calm, toLand ), false, 'body faces the sea, view faces the beach: the cast would land on the sand, no hint' );
	assert.equal( rodHint( body( landYaw ), terrain, SEA, calm, toSea ), true, 'body faces the beach, view faces the sea: the cast reaches open water, hint shows' );
	assert.equal( rodHint( body( seaYaw ), terrain, SEA, calm, toSea ), true, 'first person, body and view agree on the sea' );
	// a camera looking straight down has no horizontal heading: the body yaw decides
	assert.ok( Number.isNaN( cameraHeading( { x: 0, y: - 1, z: 0 } ) ), 'a vertical view gives no heading' );
	assert.equal( rodHint( body( seaYaw ), terrain, SEA, calm, cameraHeading( { x: 0, y: - 1, z: 0 } ) ), true, 'vertical view: falls back to the body yaw' );

} );
