import test from 'node:test';
import assert from 'node:assert/strict';
import { ChairliftPanel } from '../src/chairlift/Panel.js';

// The chairlift panel refreshed its buttons, slider and status text every frame even while closed:
// two DOM queries over every button, a template string and a textContent write per frame for a
// panel nobody can see (L6 profile, 2026-10-05). Closed, it must not touch the DOM; open, it must
// still show the live cable state.
function panelWith( open ) {

	let queries = 0;
	const output = { textContent: '' }, input = { disabled: false }, button = { dataset: { action: 'call' }, disabled: false };
	const panel = {
		querySelectorAll: () => { queries ++; return [ button ]; },
		querySelector: ( s ) => { queries ++; return s === 'output' ? output : input; },
	};
	const lift = {
		app: { disasters: { paused: true } }, active: false, guiding: false, site: { length: 1234 },
		transport: { reason: 'Running', speed: 2.5, chairs: [ 1, 2, 3 ], docking: null, cruise: 2.5 },
	};
	const ui = Object.assign( Object.create( ChairliftPanel.prototype ), { lift, panel, tool: { isOpen: open } } );
	return { ui, output, button, queries: () => queries };

}

test( 'A closed chairlift panel does no DOM work per frame; an open one shows the live cable state', () => {

	const closed = panelWith( false );
	for ( let i = 0; i < 60; i ++ ) closed.ui.update( 1 / 60 );
	assert.equal( closed.queries(), 0, `${ closed.queries() } DOM queries in 60 frames with the panel closed (expected 0)` );

	const open = panelWith( true );
	open.ui.update( 1 / 60 );
	assert.match( open.output.textContent, /Cable 2\.50 m\/s · 3 chairs/, 'the open panel shows the cable speed and chair count' );
	assert.equal( open.button.disabled, true, 'controls are disabled while a disaster pauses the world' );

} );
