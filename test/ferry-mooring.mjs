import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FerryShip } from '../src/ferry/FerryShip.js';

// Made fast at a berth whose heading is a full turn away from how her own (unwrapped) yaw is
// stored, as at Joey Island (220 degrees) after a crossing: the winches must bring her onto her
// marks the short way, with no one-frame spin that would fling cars parked on her deck.
test( 'the winches settle her on a berth a full turn away without a yaw-rate spike', () => {

	const berth = { x: 0, z: 0, yaw: 220 * Math.PI / 180 };
	const ship = new FerryShip( { x: 0.2, z: 0.1, yaw: berth.yaw - 2 * Math.PI + 0.01 } );
	ship.moor( berth );
	let worst = 0;
	for ( let i = 0; i < 60 * 30; i ++ ) { ship.step( 1 / 60, null ); worst = Math.max( worst, Math.abs( ship.r ) ); }
	assert.ok( ship.settled, 'settled on her marks' );
	assert.ok( worst < 0.05, `yaw rate stayed gentle (worst ${ worst.toFixed( 3 ) } rad/s)` );
	assert.ok( Math.abs( Math.atan2( Math.sin( ship.yaw - berth.yaw ), Math.cos( ship.yaw - berth.yaw ) ) ) < 1e-6, 'on the berth heading' );

} );
