// The rod hint ("R Take out the rod") is offered only where a cast reaches open water, in the
// direction the view faces, and never while a disaster warning is live (src/game/CastReach.js;
// ). Driven with the player's own keys from a fresh island:
// W and Shift down the boardwalk onto the pier, the Disasters panel for the tsunami, the chairlift
// guide and W for the base deck. The HUD prompt is read from the page, as the player sees it.
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const errors = new WeakMap();
const PIER_END_Z = 40; // m: src/world/Pier.js zEnd (the pier runs +z from its root at z -64)

test.beforeEach( async ( { page }, info ) => {

	const found = [];
	errors.set( info, found );
	page.on( 'pageerror', e => found.push( e.stack || e.message ) );
	page.on( 'console', m => {

		if ( m.type() === 'error' ) found.push( m.text() );

	} );
	await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=1&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Performance', exact: true } ).click();
	await page.getByRole( 'radiogroup', { name: 'Resolution', exact: true } ).getByRole( 'radio', { name: 'Standard', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Collapse (H)', exact: true } ).click();

} );

test.afterEach( async ( { page }, info ) => {

	await writeFile( info.outputPath( 'runtime-errors.json' ), JSON.stringify( errors.get( info ) || [], null, 2 ) );

} );

// the HUD prompt while it is showing the rod hint (UI.setPrompt toggles .is-on; the text stays in the DOM)
const rodHint = page => page.locator( '.tw-prompt.is-on', { hasText: 'Take out the rod' } );
const where = page => page.evaluate( () => {

	const a = window.__app, p = a.player, d = a.camera.getWorldDirection( p.position.clone() );
	return { mode: p.mode, grounded: p.grounded, position: p.position.toArray(), yaw: p.yaw, view: [ d.x, d.z ], prompt: document.querySelector( '.tw-prompt.is-on' )?.textContent ?? null };

} );

test( 'Rod hint: offered at the pier end facing the sea, withdrawn by a tsunami warning', async ( { page }, info ) => {

	test.setTimeout( 240000 );
	await test.step( 'Given a fresh island, on the boardwalk 7 m inland of the pier root, there is no rod hint', async () => {

		const at = await where( page );
		await writeFile( info.outputPath( 'start.json' ), JSON.stringify( at, null, 2 ) );
		expect( at.mode ).toBe( 'walk' );
		await expect( rodHint( page ) ).toHaveCount( 0 );

	} );
	await test.step( 'When I hold Shift and W from the start, straight down the boardwalk, through the arch and to the pier end', async () => {

		const PIER_X = 55; // m: WORLD.pier.x
		const rows = [];
		await page.keyboard.down( 'ShiftLeft' );
		await page.keyboard.down( 'KeyW' );
		try {

			await expect.poll( async () => {

				const row = await where( page );
				rows.push( row );
				return row.position[ 2 ] > PIER_END_Z - 6 || row.mode !== 'walk';

			}, { timeout: 60000, intervals: [ 50 ] } ).toBe( true );

		} finally {

			await page.keyboard.up( 'KeyW' );
			await page.keyboard.up( 'ShiftLeft' );
			await writeFile( info.outputPath( 'pier-walk.json' ), JSON.stringify( rows, null, 2 ) );

		}

		const at = await where( page );
		const drift = Math.max( ...rows.map( r => Math.abs( r.position[ 0 ] - PIER_X ) ) );
		expect( drift, `held W kept to the pier centreline (largest drift ${ drift.toFixed( 2 ) } m)` ).toBeLessThan( 0.5 );
		expect( at.mode, 'still walking on the pier, not in the sea' ).toBe( 'walk' );
		expect( at.position[ 1 ], 'standing on the deck above the water' ).toBeGreaterThan( 1 );

	} );
	await test.step( 'Then the HUD offers "R Take out the rod" facing the sea', async () => {

		await expect( rodHint( page ) ).toHaveCount( 1, { timeout: 5000 } );
		await page.screenshot( { path: info.outputPath( 'pier-end-hint.png' ) } );

	} );
	await test.step( 'When a tsunami warning starts from the Disasters panel, the hint is withdrawn', async () => {

		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect( page.getByRole( 'alert', { name: 'Disaster validation' } ) ).toBeEmpty();
		await expect( rodHint( page ) ).toHaveCount( 0, { timeout: 5000 } );
		await writeFile( info.outputPath( 'tsunami.json' ), JSON.stringify( await where( page ), null, 2 ) );
		await page.screenshot( { path: info.outputPath( 'pier-end-tsunami.png' ) } );
		expect( errors.get( info ) ).toEqual( [] );

	} );

} );

test( 'Rod hint: not offered on the chairlift base deck, 60 m inland', async ( { page }, info ) => {

	test.setTimeout( 240000 );
	const panel = page.getByRole( 'region', { name: 'Chairlift controls' } );
	await test.step( 'Given I walk to the chairlift base deck with the guide, holding Shift and W', async () => {

		await page.getByRole( 'button', { name: 'Chairlift', exact: true } ).click();
		await expect( panel ).toBeVisible();
		await panel.getByRole( 'button', { name: 'Guide to village base', exact: true } ).click();
		await expect.poll( () => page.evaluate( () => window.__app.chairlift.guiding ) ).toBe( true );
		await page.keyboard.down( 'ShiftLeft' );
		await page.keyboard.down( 'KeyW' );
		try {

			// Walk the last metres, as chairlift.spec.js base() does: one poll takes ~0.5 s under load, and at a
			// sprint the runner passed the exit by 1.02 m before the keys came up. Shift comes up on the last guide
			// leg (index 2) inside 6 m, so the same latency at walking pace (~1.4 m/s) costs under a metre.
			let walking = false;
			await expect.poll( async () => {

				const row = await page.evaluate( () => {

					const a = window.__app, l = a.chairlift;
					return { guiding: l.guiding, index: l.guideIndex, distance: Math.hypot( a.player.position.x - l.site.base.exit.x, a.player.position.z - l.site.base.exit.z ) };

				} );
				if ( ! walking && row.guiding && row.index >= 2 && row.distance < 6 ) {

					walking = true;
					await page.keyboard.up( 'ShiftLeft' );

				}
				return row.guiding;

			}, { timeout: 90000, intervals: [ 50 ] } ).toBe( false );

		} finally {

			await page.keyboard.up( 'KeyW' );
			await page.keyboard.up( 'ShiftLeft' );

		}

		const at = await page.evaluate( () => {

			const a = window.__app, l = a.chairlift;
			return { mode: a.player.mode, distance: Math.hypot( a.player.position.x - l.site.base.exit.x, a.player.position.z - l.site.base.exit.z ) };

		} );
		expect( at.mode ).toBe( 'walk' );
		expect( at.distance ).toBeLessThan( 1 );

	} );
	await test.step( 'Then no "Take out the rod" is offered on the deck', async () => {

		await page.waitForTimeout( 500 );
		await expect( rodHint( page ) ).toHaveCount( 0 );
		await writeFile( info.outputPath( 'base-deck.json' ), JSON.stringify( await where( page ), null, 2 ) );
		await page.screenshot( { path: info.outputPath( 'base-deck-no-hint.png' ) } );
		expect( errors.get( info ) ).toEqual( [] );

	} );

} );
