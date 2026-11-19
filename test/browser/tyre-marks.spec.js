import { test, expect } from '@playwright/test';

// Given/When/Then scenarios for the tyre marks on the real island, real WASM physics and the real
// renderer. Only the Google Fonts stylesheet is stubbed; nothing in the driving path is intercepted.
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a solo player on the real island with fresh local progress', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	} );
} );

async function drive( page, vehicle = 'aster', start = 'beach' ) {
	if ( start !== 'beach' ) await page.getByLabel( 'Start at', { exact: true } ).selectOption( start );
	if ( vehicle !== 'aster' ) await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( vehicle );
	await page.getByRole( 'button', { name: vehicle === 'jeep' ? 'Drive Ridgeback 4x4' : 'Drive Aster RS', exact: true } ).click();
	await expect( telemetry( page ) ).toBeVisible();
	await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
}

for ( const vehicle of [ 'aster', 'jeep' ] ) test( `The ${ vehicle } launches hard on beach sand and brakes to a stop, printing its tyre impressions`, async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	let settled;
	await test.step( `Given the ${ vehicle } resting on the beach sand`, async () => {
		await drive( page, vehicle );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'sand' );
		settled = await value( page, 'track-segments' );
	} );
	await test.step( 'When the driver floors it from rest and then brakes to a stop', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 28 );
		await page.keyboard.up( 'w' );
		// Held S stops the car and holds it for half a second before reverse engages.
		await page.keyboard.down( 's' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeLessThan( 2 );
		await page.keyboard.up( 's' );
	} );
	await test.step( 'Then all four loaded contacts have printed continuous marks along the route', async () => {
		await expect.poll( () => value( page, 'track-segments' ) ).toBeGreaterThan( settled + 80 );
		expect( errors ).toEqual( [] );
		await page.screenshot( { path: `test-results/tracks/tyre-marks-sand-${ vehicle }.png` } );
	} );
} );

test( 'Cruising on the coastal asphalt leaves it clean until the handbrake locks the tyres into a skid', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	await test.step( 'Given the Aster on the coastal road asphalt', async () => {
		await drive( page, 'aster', 'coast' );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );
	let clean;
	await test.step( 'When the driver eases up to speed with gentle throttle', async () => {
		clean = await value( page, 'track-segments' );
		const deadline = Date.now() + 30_000;
		while ( await value( page, 'signed-speed' ) < 30 && Date.now() < deadline ) {
			await page.keyboard.down( 'w' );
			await page.waitForTimeout( 110 );
			await page.keyboard.up( 'w' );
			await page.waitForTimeout( 90 );
		}
		expect( await value( page, 'signed-speed' ) ).toBeGreaterThan( 30 );
	} );
	await test.step( 'Then rolling tyres leave no rubber on the asphalt', async () => {
		clean = await value( page, 'track-segments' );
		const surfaces = [];
		const deadline = Date.now() + 600;
		while ( Date.now() < deadline ) {
			surfaces.push( await telemetry( page ).getAttribute( 'data-surface' ) );
			await page.waitForTimeout( 100 );
		}
		surfaces.push( await telemetry( page ).getAttribute( 'data-surface' ) );
		expect( surfaces.filter( surface => surface !== 'asphalt' ), `surfaces sampled ${ surfaces.join( ',' ) }` ).toEqual( [] );
		expect( await value( page, 'track-segments' ) ).toBe( clean );
	} );
	let skid = clean;
	await test.step( 'When the driver pulls the handbrake at speed', async () => {
		await page.keyboard.down( 'Space' );
		await expect.poll( async () => {
			if ( await telemetry( page ).getAttribute( 'data-surface' ) === 'asphalt' ) skid = await value( page, 'track-segments' );
			return value( page, 'speed' );
		}, { intervals: [ 50 ] } ).toBeLessThan( 2 );
		await page.keyboard.up( 'Space' );
	} );
	await test.step( 'Then the locked tyres have laid skid marks on the asphalt', async () => {
		// Stopped on the road: marks may still be landing, so poll as before. Slid off: only the
		// marks counted while it read asphalt.
		if ( await telemetry( page ).getAttribute( 'data-surface' ) === 'asphalt' ) await expect.poll( () => value( page, 'track-segments' ) ).toBeGreaterThan( clean + 12 );
		else expect( skid, 'segments laid while the car read asphalt' ).toBeGreaterThan( clean + 12 );
		expect( errors ).toEqual( [] );
		await page.screenshot( { path: 'test-results/tracks/tyre-marks-asphalt-skid.png' } );
	} );
} );
