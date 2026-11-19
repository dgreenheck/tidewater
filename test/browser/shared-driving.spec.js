import { test, expect, chromium } from '@playwright/test';

const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const number = async ( page, key ) => Number( await telemetry( page ).getAttribute( `data-${ key }` ) );
async function island( page, sound = false ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { body: '', contentType: 'text/css' } ) );
	await page.goto( `/?scale=0.5${ sound ? '' : '&noAudio' }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
}

test( 'The Jeep plays its recorded engine, follows RPM and can be muted', async ( { page } ) => {
	await test.step( 'Given a new island session with normal audio enabled', async () => { await island( page, true ); } );
	await test.step( 'When the player enters the Ridgeback 4x4', async () => {
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'jeep' );
		await page.getByRole( 'button', { name: 'Drive Ridgeback 4x4', exact: true } ).click();
	} );
	await test.step( 'Then the real HEMI recording is decoded and playing through Web Audio', async () => {
		await expect( telemetry( page ) ).toHaveAttribute( 'data-audio-recording', 'jeep-hemi.wav' );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-audio-state', 'playing' );
		expect( await number( page, 'audio-gain' ) ).toBeGreaterThan( 0 );
	} );
	const idle = await number( page, 'audio-rate' );
	await test.step( 'When the driver accelerates', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => number( page, 'signed-speed' ) ).toBeGreaterThan( 20 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then the actual source playback rate rises with engine RPM', async () => {
		expect( await number( page, 'audio-rate' ) ).toBeGreaterThan( idle + 0.1 );
	} );
	await test.step( 'When the driver mutes Engine sound', async () => { await page.getByRole( 'button', { name: 'Engine sound', exact: true } ).click(); } );
	await test.step( 'Then the engine gain fades to silence', async () => {
		await expect( page.getByRole( 'button', { name: 'Engine sound', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'false' );
		await expect.poll( () => number( page, 'audio-gain' ) ).toBeLessThan( 0.001 );
	} );
} );

test( 'Two real players share cars, nameplates, distance and direction indicators, minimap markers and clean departure', async ( { browser, baseURL, launchOptions, headless }, info ) => {
	// Use separate browser processes so the two islands have independent graphics devices.
	const guestBrowser = await chromium.launch( { ...launchOptions, headless } );
	const options = { baseURL, viewport: { width: 1440, height: 900 }, permissions: [ 'clipboard-read', 'clipboard-write' ] };
	const contexts = [ await browser.newContext( options ), await guestBrowser.newContext( options ) ];
	const [ host, guest ] = await Promise.all( contexts.map( context => context.newPage() ) );
	try {
		await test.step( 'Given two independent players on the real island and WebSocket server', async () => {
			await island( host ); await island( guest );
			for ( const page of [ host, guest ] ) await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		} );
		await test.step( 'When Alex hosts a drive and Sam joins the same room', async () => {
			await host.getByRole( 'button', { name: 'Drive together', exact: true } ).click();
			await host.getByLabel( 'Your name', { exact: true } ).fill( 'Alex' );
			await host.getByRole( 'button', { name: 'Host drive', exact: true } ).click();
			await expect( host.getByLabel( 'Room code', { exact: true } ) ).toHaveText( /^[A-F0-9]{6}$/ );
			await host.getByRole( 'button', { name: 'Copy room code', exact: true } ).click();
			expect( await host.evaluate( () => navigator.clipboard.readText() ) ).toBe( await host.getByLabel( 'Room code', { exact: true } ).textContent() );
			await guest.getByRole( 'button', { name: 'Drive together', exact: true } ).click();
			await guest.getByLabel( 'Your name', { exact: true } ).fill( 'Sam' );
			await guest.getByRole( 'button', { name: "Join Alex's drive", exact: true } ).click();
		} );
		await test.step( 'Then both receive and render the other car with map and bearing information', async () => {
			await expect.poll( () => number( guest, 'grounded' ) ).toBe( 4 );
			for ( const [ page, name ] of [ [ host, 'Sam' ], [ guest, 'Alex' ] ] ) {
				await expect( page.getByRole( 'region', { name: 'Nearby drivers' } ).getByText( name, { exact: true } ) ).toBeVisible();
				await expect.poll( () => number( page, 'remote-cars' ) ).toBe( 1 );
				await expect( page.getByRole( 'img', { name: `${ name } on minimap`, exact: true } ) ).toBeVisible();
				await expect( page.getByRole( 'img', { name: new RegExp( `Direction to ${ name }:` ) } ) ).toBeVisible();
				await expect( page.getByRole( 'img', { name: `${ name } nameplate`, exact: true } ) ).toContainText( name );
			}
		} );
		await test.step( 'When Sam switches to the COSIER GT3 RS, Alex sees the new car in the same room', async () => {
			await guest.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rs' );
			await expect( host.getByRole( 'region', { name: 'Nearby drivers' } ).getByText( 'COSIER GT3 RS', { exact: true } ) ).toBeVisible();
		} );
		const marker = guest.locator( '[data-driver-name="Alex"]' );
		const before = Number( await marker.getAttribute( 'data-x' ) );
		await test.step( 'When Alex drives forward under the real local physics', async () => {
			await host.locator( '#app canvas' ).click();
			await host.keyboard.down( 'w' );
			await expect.poll( () => number( host, 'signed-speed' ) ).toBeGreaterThan( 18 );
			await host.keyboard.up( 'w' );
		} );
		await test.step( 'Then Sam sees that moving car and updated distance through the real server', async () => {
			await expect.poll( async () => Number( await marker.getAttribute( 'data-x' ) ) ).toBeGreaterThan( before + 3 );
			expect( Number( await marker.getAttribute( 'data-distance' ) ) ).toBeGreaterThan( 3 );
			await guest.screenshot( { path: info.outputPath( 'rally-multiplayer.png' ) } );
		} );
		await test.step( 'When Sam leaves the drive', async () => { await guest.getByRole( 'button', { name: 'Leave drive', exact: true } ).click(); } );
		await test.step( 'Then Alex keeps driving without a ghost car or minimap marker', async () => {
			await expect.poll( () => number( host, 'remote-cars' ) ).toBe( 0 );
			await expect( host.getByRole( 'img', { name: 'Sam on minimap', exact: true } ) ).toHaveCount( 0 );
			await expect( host.getByRole( 'img', { name: 'Sam nameplate', exact: true } ) ).toHaveCount( 0 );
			await expect( host.getByLabel( 'Room code', { exact: true } ) ).toBeVisible();
		} );
	} finally {

		await Promise.all( contexts.map( context => context.close() ) );
		await guestBrowser.close();

	}
} );
