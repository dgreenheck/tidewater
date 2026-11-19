// HUD chips per player context. Run: node --test test/hud-context.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hudChips } from '../src/game/HudContext.js';

const cases = [
	// context                                   purse  pin    guidance
	[ 'walking on the beach', { mode: 'walk' }, true, true, true ],
	[ 'swimming', { mode: 'swim' }, true, true, true ],
	[ 'standing on the ferry deck', { mode: 'ferry' }, true, true, true ],
	[ 'free camera while on foot', { mode: 'walk', freeCam: true }, false, false, false ],
	[ 'driving the rally car', { mode: 'walk', driving: true }, false, false, false ],
	[ 'flying the Kestrel', { mode: 'aviation' }, false, false, false ],
	[ 'flying the hang glider', { mode: 'glider' }, false, false, false ],
	[ 'riding the jetski', { mode: 'jetski' }, false, false, false ],
	[ 'aboard the fishing boat (fuel and sonar live in the purse)', { mode: 'boat' }, true, false, false ],
	[ 'free camera from the boat', { mode: 'boat', freeCam: true }, false, false, false ],
	[ 'ragdoll', { mode: 'ragdoll' }, false, false, false ],
];

for ( const [ name, ctx, purse, pin, guidance ] of cases ) {

	test( `HUD chips: ${ name }`, () => {

		const got = hudChips( ctx );
		assert.deepEqual( got, { purse, pin, guidance }, `${ name }: got ${ JSON.stringify( got ) }` );

	} );

}
