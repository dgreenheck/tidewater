// The HUD is context-aware: the card PIN and the purse belong to the walking
// player, and leave the screen in the free camera. Driven with the player's own keys.
import { test, expect } from '@playwright/test';

test( 'Card PIN and purse leave the screen in the free camera and return on foot', async ( { page }, info ) => {

	const pin = page.getByLabel( /^Card PIN/ );
	const purse = page.locator( '.gm-purse' );
	await test.step( 'Given I am walking on the beach with the HUD up', async () => {

		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=.6&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( pin ).toBeVisible();
		await expect( purse ).toBeVisible();

	} );
	await test.step( 'When I press F for the free camera', async () => {

		await page.keyboard.press( 'f' );
		await expect( page.locator( '.tw-mode' ) ).toHaveText( /Free camera/ );

	} );
	await test.step( 'Then the PIN and the purse are off the screen', async () => {

		await expect( pin ).toBeHidden();
		await expect( purse ).toBeHidden();
		await page.screenshot( { path: info.outputPath( 'hud-freecam.png' ) } );

	} );
	await test.step( 'When I press F again to walk', async () => {

		await page.keyboard.press( 'f' );
		await expect( page.locator( '.tw-mode' ) ).toHaveText( /Walking/ );

	} );
	await test.step( 'Then both chips are back', async () => {

		await expect( pin ).toBeVisible();
		await expect( purse ).toBeVisible();

	} );

} );

test( 'The world tools strip opens a panel from the keyboard and groups the tools', async ( { page }, info ) => {

	const tools = page.getByRole( 'navigation', { name: 'World controls' } );
	await test.step( 'Given I am on the beach', async () => {

		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=.6&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( tools ).toBeVisible();

	} );
	await test.step( 'Then the tools sit in named groups with the demo last', async () => {

		const groups = tools.getByRole( 'group' );
		await expect( groups ).toHaveCount( 4 );
		await expect( groups.nth( 0 ) ).toHaveAccessibleName( 'Ride' );
		await expect( groups.nth( 3 ) ).toHaveAccessibleName( 'Demo' );
		await expect( groups.nth( 3 ).getByRole( 'button' ) ).toHaveText( [ 'Shark bite demo' ] );

	} );
	await test.step( 'When I focus the strip and walk to Wind farm with the arrow keys and press Enter', async () => {

		await tools.getByRole( 'button', { name: 'Aviation', exact: true } ).focus();
		await page.keyboard.press( 'ArrowRight' );
		await page.keyboard.press( 'ArrowRight' );
		await page.keyboard.press( 'ArrowRight' );
		await expect( tools.getByRole( 'button', { name: 'Wind farm', exact: true } ) ).toBeFocused();
		await page.keyboard.press( 'Enter' );

	} );
	await test.step( 'Then the wind farm panel is open, and Escape closes it and returns focus', async () => {

		const panel = page.getByRole( 'region', { name: 'Wind farm controls' } );
		await expect( panel ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'tools-windfarm-open.png' ) } );
		await page.keyboard.press( 'Escape' );
		await expect( panel ).toBeHidden();
		await expect( tools.getByRole( 'button', { name: 'Wind farm', exact: true } ) ).toBeFocused();

	} );

} );
