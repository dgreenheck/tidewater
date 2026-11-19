import { test, expect } from '@playwright/test';

const loader = page => page.getByRole( 'status', { name: 'Loading Tidewater' } );

test( 'A lost graphics device stops the loader and offers a focused Reload', async ( { page } ) => {
	await test.step( 'Given a player loading the real island', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await page.waitForFunction( () => window.__app?.gpu?.device, null, { timeout: 60_000 } );
		await expect( loader( page ) ).toBeVisible();
	} );
	await test.step( 'When the browser loses the graphics device', async () => {
		await page.evaluate( () => window.__app.gpu.device.destroy() );
	} );
	const dialog = page.getByRole( 'alertdialog', { name: 'The graphics device was lost' } );
	await test.step( 'Then the loader stops and an alert dialog offers Reload, focused', async () => {
		await expect( dialog ).toBeVisible();
		await expect( loader( page ) ).toBeHidden();
		await expect( dialog.getByRole( 'button', { name: 'Reload', exact: true } ) ).toBeFocused();
		await page.screenshot( { path: `${ process.env.PW_OUT || 'test-results' }/device-lost.png` } );
	} );
	await test.step( 'When the player presses Enter on Reload, Then the island loads again', async () => {
		await Promise.all( [ page.waitForEvent( 'load' ), page.keyboard.press( 'Enter' ) ] );
		await expect( loader( page ) ).toBeVisible();
		await expect( dialog ).toHaveCount( 0 );
	} );
} );
