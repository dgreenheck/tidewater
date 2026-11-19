import { test, expect } from '@playwright/test';

// Given/When/Then on the real island with the Tidewater Spirit moored at the ferry terminal's berth. Only the free
// camera is posed from the test (the F-key camera a player flies by hand); everything after
// the drop is the player's own keys.
const helm = page => page.getByRole( 'status', { name: 'Ferry helm' } );
const reading = async ( page, key ) => Number( await helm( page ).getAttribute( `data-${ key }` ) );

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a solo player on the real island with the ferry moored at the terminal', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	} );
	await test.step( 'And the player drops from the free camera onto the sun deck behind her bridge, facing the bow', async () => {
		await page.evaluate( () => {
			const app = window.__app, ship = app.ferry.ship;
			app.setFreeCam( true );
			app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 0, 12.6, 3 ) ), ship.yaw + Math.PI, - 0.05 );
			app.fly.velocity.set( 0, 0, 0 );
		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
	} );
} );

async function takeTheHelm( page ) {
	await test.step( 'When the player walks forward through the lounge to the wheel', async () => {
		await page.keyboard.down( 'ShiftLeft' ); await page.keyboard.down( 'w' );
		await expect( page.getByText( 'Take the helm', { exact: true } ) ).toBeVisible( { timeout: 20_000 } );
		await page.keyboard.up( 'w' ); await page.keyboard.up( 'ShiftLeft' );
	} );
	await test.step( 'And presses E', async () => { await page.keyboard.press( 'e' ); } );
	await test.step( 'Then the helm readout shows her stopped with a sound hull, her lines on and her ramp up', async () => {
		await expect( helm( page ) ).toBeVisible();
		await expect( helm( page ) ).toContainText( 'Stop' );
		await expect( helm( page ) ).toContainText( 'Sound' );
		await expect( helm( page ).locator( '.fy-lines' ) ).toHaveText( 'On' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Up' );
		await expect( page.getByText( 'At the helm', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'And she still lies exactly on her berth: nothing at the jetty pushed her at rest', async () => {
		const berth = await page.evaluate( async () => {
			const { BERTH } = await import( '/src/ferry/Terminal.js' );
			const p = window.__app.terminal.toWorld( BERTH );
			return { x: p.x, z: p.z };
		} );
		expect( Math.hypot( await reading( page, 'x' ) - berth.x, await reading( page, 'z' ) - berth.z ) ).toBeLessThan( 0.05 );
	} );
	await test.step( 'When the player pushes the throttles with her lines still on', async () => {
		await page.keyboard.down( 'w' ); await page.waitForTimeout( 1200 ); await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then the throttles stay at Stop and she does not stir', async () => {
		await expect( helm( page ) ).toContainText( 'Stop' );
		expect( await reading( page, 'speed' ) ).toBe( 0 );
		await page.screenshot( { path: 'test-results/ferry-helm-moored.png' } );
	} );
}

async function castOff( page ) {
	await test.step( 'When the player casts off with L', async () => { await page.keyboard.press( 'l' ); } );
	await test.step( 'Then the terminal gangway swings in, the lines go and she sounds one prolonged blast', async () => {
		await expect( helm( page ).locator( '.fy-lines' ) ).toHaveText( 'Letting go' );
		await expect( helm( page ).locator( '.fy-lines' ) ).toHaveText( 'Off', { timeout: 15_000 } );
		expect( await reading( page, 'gangway' ) ).toBe( 1 );
		expect( await helm( page ).getAttribute( 'data-horn' ) ).toBe( 'long' );
		expect( await reading( page, 'horns' ) ).toBe( 1 );
	} );
}

test( 'Stepping aboard the moored ferry, the player takes her helm and drives her off the berth', async ( { page } ) => {
	await takeTheHelm( page );
	await castOff( page );
	await test.step( 'When the player backs her off the berth with a touch astern', async () => {
		await page.keyboard.down( 's' ); await page.waitForTimeout( 500 ); await page.keyboard.up( 's' );
	} );
	await test.step( 'Then she sounds three short blasts, going astern close in', async () => {
		await expect.poll( () => helm( page ).getAttribute( 'data-horn' ) ).toBe( 'three' );
		await page.keyboard.press( 'x' );
	} );
	const start = { x: await reading( page, 'x' ), z: await reading( page, 'z' ), yaw: await reading( page, 'yaw' ) };
	await test.step( 'When the player pushes the throttles full ahead', async () => {
		await page.keyboard.down( 'w' ); await page.waitForTimeout( 2600 ); await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then she makes way at more than 3 knots and moves off her mooring', async () => {
		await expect.poll( () => reading( page, 'speed' ), { timeout: 20_000 } ).toBeGreaterThan( 1.6 );
		await expect( helm( page ) ).toContainText( 'Ahead 100%' );
		await expect.poll( async () => Math.hypot( await reading( page, 'x' ) - start.x, await reading( page, 'z' ) - start.z ), { timeout: 10_000 } ).toBeGreaterThan( 5 );
	} );
	await test.step( 'When the player turns the wheel to starboard', async () => {
		await page.keyboard.down( 'd' ); await page.waitForTimeout( 1400 ); await page.keyboard.up( 'd' );
	} );
	await test.step( 'Then the rudder shows starboard and her heading swings to starboard', async () => {
		await expect( helm( page ) ).toContainText( 'stbd' );
		await expect.poll( async () => start.yaw - await reading( page, 'yaw' ), { timeout: 20_000 } ).toBeGreaterThan( 0.1 );
		await page.screenshot( { path: 'test-results/ferry-helm.png' } );
	} );
	await test.step( 'And at the terminal the gangway lies swung in along the walkway, clear of her berth', async () => {
		// look only: the free camera posed over the empty berth, looking at the walkway's end
		await page.evaluate( () => {
			const app = window.__app, eye = app.terminal.toWorld( [ 3, 14, 24 ] ), at = app.terminal.toWorld( [ 11, 7.2, 9.7 ] );
			app.setFreeCam( true );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), - 0.4 );
			app.fly.velocity.set( 0, 0, 0 );
		} );
		await page.waitForTimeout( 1_500 );
		await page.screenshot( { path: 'test-results/terminal-gangway-stowed.png' } );
	} );
} );

test( 'Driving her hard to port off the berth runs her onto the rocks east of the harbour and damages the hull', async ( { page } ) => {
	await takeTheHelm( page );
	await castOff( page );
	const start = { x: await reading( page, 'x' ) };
	await test.step( 'When the player goes full ahead with the wheel hard to port, swinging east across the harbour basin', async () => {
		await page.keyboard.down( 'w' ); await page.waitForTimeout( 2600 ); await page.keyboard.up( 'w' );
		await page.keyboard.down( 'a' ); await page.waitForTimeout( 3000 ); await page.keyboard.up( 'a' );
	} );
	await test.step( 'Then she strikes the rocks east of the berth and the helm readout reports hull damage', async () => {
		await expect.poll( () => reading( page, 'hull' ), { timeout: 120_000, intervals: [ 500 ] } ).toBeGreaterThan( 0.02 );
		// a hard enough blow holes her outright, and the readout says Flooding rather than a percentage
		await expect( helm( page ) ).toContainText( /damage|Flooding/ );
		expect( await reading( page, 'x' ) ).toBeGreaterThan( start.x + 20 );
		await page.screenshot( { path: 'test-results/ferry-aground.png' } );
	} );
} );
