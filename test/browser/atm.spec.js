import { test, expect } from '@playwright/test';

// Given/When/Then on the real island at the Tidewater ATM by the chandlery. Only the free camera
// is posed from the test (the F-key camera a player flies by hand); the player walks, uses and
// leaves the ATM with their own keys. Closed, the ATM panel only fades out, so it used to stay in
// the accessibility tree as an invisible second dialog that screen readers and Tab could reach.
const atm = page => page.getByRole( 'dialog', { name: 'ATM' } );

test( 'The ATM is a dialog only while it is in use', async ( { page } ) => {

	await test.step( 'Given a solo player on the real island, standing in front of the Tidewater ATM', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.evaluate( () => {

			const app = window.__app, site = app.game.atm.sites.find( s => s.id === 'tidewater' ), V = app.camera.position.constructor;
			// 1.6 m out from the machine along its front (+z in its frame), at eye height, facing it
			const out = new V( Math.sin( site.yaw ), 0, Math.cos( site.yaw ) );
			app.setFreeCam( true );
			app.fly.setPose( site.position.clone().addScaledVector( out, 1.6 ).add( new V( 0, 1.7, 0 ) ), site.yaw, - 0.1 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );

	} );
	await test.step( 'Then no ATM dialog is exposed before the player uses it', async () => {

		await expect( page.getByText( 'Use ATM', { exact: true } ) ).toBeVisible( { timeout: 15_000 } );
		await expect( atm( page ) ).toHaveCount( 0 );

	} );
	await test.step( 'When the player presses E at the machine', async () => {

		await page.keyboard.press( 'e' );

	} );
	await test.step( 'Then the ATM opens as a dialog with its PIN pad', async () => {

		await expect( atm( page ) ).toBeVisible();
		await expect( atm( page ) ).toContainText( 'Insert card' );
		await expect( atm( page ).getByLabel( 'PIN pad' ) ).toBeVisible();
		await page.screenshot( { path: test.info().outputPath( 'atm-open.png' ) } );

	} );
	await test.step( 'When the player presses Escape, Then the ATM leaves the accessibility tree and Tab never lands in it', async () => {

		await page.keyboard.press( 'Escape' );
		await expect( atm( page ) ).toHaveCount( 0 );
		for ( let i = 0; i < 12; i ++ ) {

			await page.keyboard.press( 'Tab' );
			expect( await page.evaluate( () => !! document.activeElement?.closest( '.atm-panel' ) ) ).toBe( false );

		}

	} );

} );
