import { test, expect } from '@playwright/test';

// Given/When/Then on the real island, ocean wave queries and WASM car physics.
// Fresh browser state per test; only the Google Fonts stylesheet is stubbed.
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );
const pose = async page => ( { x: await value( page, 'x' ), y: await value( page, 'y' ), z: await value( page, 'z' ) } );

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given the Aster parked on the beach of the real island', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	} );
} );

// The beach spawn faces along the shore (+x); the sea lies to the driver's right (+z).
// Drive some way along the beach first, so a recovery near the car differs from the spawn,
// then aim for the sea like a driver would: steer toward +z, correcting as the car turns.
async function driveIntoTheSea( page ) {
	const start = await pose( page );
	await page.keyboard.down( 'w' );
	await expect.poll( async () => ( await pose( page ) ).x - start.x, { timeout: 20_000, intervals: [ 50 ] } ).toBeGreaterThan( 25 );
	const deadline = Date.now() + 30_000;
	let steer = '';
	// Past the waterline (about z -45) and over water deeper than a metre.
	while ( await value( page, 'z' ) < - 25 && Date.now() < deadline ) {
		const fx = await value( page, 'forward-x' ), fz = await value( page, 'forward-z' );
		const want = fz > 0.94 ? '' : fx > 0 ? 'd' : 'a';
		if ( want !== steer ) { if ( steer ) await page.keyboard.up( steer ); if ( want ) await page.keyboard.down( want ); steer = want; }
		await page.waitForTimeout( 50 );
	}
	if ( steer ) await page.keyboard.up( steer );
	await page.keyboard.up( 'w' );
	expect( await value( page, 'z' ) ).toBeGreaterThan( - 25 );
	return start;
}

test( 'A car driven into the sea floats on the waves instead of being reset', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	let start;
	await test.step( 'When the driver follows the beach, turns toward the sea and drives into deep water', async () => { start = await driveIntoTheSea( page ); } );
	const heights = [];
	let last;
	await test.step( 'And lets the car drift for ten seconds', async () => {
		for ( let i = 0; i < 40; i ++ ) { await page.waitForTimeout( 250 ); last = await pose( page ); heights.push( last.y ); }
	} );
	await test.step( 'Then it is still out in the water, afloat and moving with the swell', async () => {
		expect( last.z ).toBeGreaterThan( - 35 );
		expect( last.y ).toBeLessThan( 0.3 );
		expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.7 );
		expect( Math.max( ...heights ) - Math.min( ...heights ) ).toBeGreaterThan( 0.02 );
		await expect( page.getByText( /Car recovered/ ) ).toHaveCount( 0 );
		expect( await value( page, 'submerged' ) ).toBeGreaterThan( 0.1 );
		await expect( page.getByText( 'Press R to recover', { exact: true } ) ).toBeVisible();
		await page.screenshot( { path: 'test-results/rally-afloat.png' } );
	} );
	await test.step( 'When the driver presses R', async () => {
		await page.keyboard.down( 'r' ); await page.waitForTimeout( 160 ); await page.keyboard.up( 'r' );
	} );
	await test.step( 'Then the car is recovered upright onto dry ground near where it was', async () => {
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		const recovered = await pose( page );
		expect( recovered.y ).toBeGreaterThan( 0.5 );
		expect( Math.hypot( recovered.x - last.x, recovered.z - last.z ) ).toBeLessThan( 60 );
		expect( Math.hypot( recovered.x - start.x, recovered.z - start.z ) ).toBeGreaterThan( 15 );
		expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.9 );
		expect( errors ).toEqual( [] );
	} );
} );
