import { test, expect } from '@playwright/test';

// Given/When/Then on the real island with the Tidewater Spirit made fast at the ferry terminal and
// the player's Aster RS parked on her vehicle deck. Setting the car down on her deck is the only
// pose from the test; getting out, walking and getting back in are the player's own keys.
const OUT = process.env.PW_OUT || 'test-results';
const telemetryOf = page => page.getByRole( 'status', { name: 'Rally telemetry' } );

async function openIsland( page ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// The player and the car in her frame (x to port, y up from her waterline, z to her bow).
const scene = page => page.evaluate( () => {

	const app = window.__app, ship = app.ferry.ship, s = app.rally.state, V = app.camera.position.constructor;
	const car = ship.toLocal( new V( s[ 0 ], s[ 1 ], s[ 2 ] ), new V() ), me = ship.toLocal( app.player.position.clone(), new V() );
	return { mode: app.player.mode, driving: app.rally.active, car: { x: car.x, y: car.y, z: car.z }, me: { x: me.x, y: me.y, z: me.z } };

} );

async function parkedAboard( page ) {

	await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Ferry terminal' } );
	await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );
	await page.evaluate( () => {

		const app = window.__app, ship = app.ferry.ship, p = ship.toWorld( new app.camera.position.constructor( 1.5, 3.1, - 6 ) );
		app.rally.physics.reset( p.x, p.y, p.z, ship.yaw );

	} );
	await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 10_000 } ).toBe( 4 );
	await page.waitForTimeout( 1_000 );
	const s = await scene( page );
	expect( Math.abs( s.car.y - 2.6 ) ).toBeLessThan( 0.8 );

}

test( 'A driver parked on her vehicle deck gets out with E and stands on her car deck beside the car', async ( { page } ) => {

	test.setTimeout( 150_000 );
	await test.step( 'Given a solo player in the Aster RS, parked on the moored ferry\'s vehicle deck', async () => {

		await openIsland( page );
		await parkedAboard( page );

	} );
	await test.step( 'When the driver gets out with E', async () => {

		await page.keyboard.press( 'e' );
		await page.waitForTimeout( 1_000 );

	} );
	await test.step( 'Then the player stands aboard her, on her car deck, next to the car', async () => {

		const s = await scene( page );
		console.log( `out of the car: ${ JSON.stringify( s ) }` );
		expect( s.driving ).toBe( false );
		expect( s.mode ).toBe( 'ferry' );
		expect( Math.abs( s.me.y - 2.6 ) ).toBeLessThan( 0.2 );
		expect( Math.hypot( s.me.x - s.car.x, s.me.z - s.car.z ) ).toBeLessThan( 3.5 );
		await page.screenshot( { path: `${ OUT }/car-aboard-out.png` } );

	} );

} );

test( 'Walking back up to the car on her deck, the player gets in with E', async ( { page } ) => {

	test.setTimeout( 150_000 );
	await test.step( 'Given a player who got out of the Aster RS on her vehicle deck and walked a few paces off', async () => {

		await openIsland( page );
		await parkedAboard( page );
		await page.keyboard.press( 'e' );
		await expect.poll( async () => ( await scene( page ) ).mode ).toBe( 'ferry' );
		// a few paces: S held until the player stands over 3.2 m off, then let go
		// (a fixed 900 ms left it a frame or two either side of 3 m, at about 3 m/s)
		const off = async () => { const s = await scene( page ); return Math.hypot( s.me.x - s.car.x, s.me.z - s.car.z ); };
		const t0 = Date.now();
		await page.keyboard.down( 's' );
		await expect.poll( off, { timeout: 5_000, intervals: [ 50 ] } ).toBeGreaterThan( 3.2 );
		await page.keyboard.up( 's' );
		console.log( `walked off: ${ ( await off() ).toFixed( 2 ) } m from the car after ${ Date.now() - t0 } ms of S` );
		expect( await off() ).toBeGreaterThan( 3.0 );
		await expect( page.getByText( 'Get in', { exact: true } ) ).toBeHidden();

	} );
	await test.step( 'When the player walks back to the driver\'s door', async () => {

		await page.keyboard.down( 'w' );
		await expect( page.getByText( 'Get in', { exact: true } ) ).toBeVisible( { timeout: 10_000 } );
		await page.keyboard.up( 'w' );

	} );
	await test.step( 'And gets in with E', async () => {

		await page.keyboard.press( 'e' );

	} );
	await test.step( 'Then the player is driving the Aster RS again, still on her deck', async () => {

		await expect.poll( async () => ( await scene( page ) ).driving ).toBe( true );
		const s = await scene( page );
		expect( s.mode ).toBe( 'rally' );
		expect( Math.abs( s.car.y - 2.6 ) ).toBeLessThan( 0.8 );

	} );

} );
