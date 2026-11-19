import { test, expect } from '@playwright/test';

// Given/When/Then with a standard-mapping gamepad. The controller is hardware, so the
// browser's Gamepad API is the mocked boundary: a virtual pad whose stick and triggers the
// test moves. Everything behind navigator.getGamepads() is the real game and WASM physics.
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );
const pad = ( page, { stick = 0, throttle = 0, brake = 0 } = {} ) => page.evaluate( ( [ stick, throttle, brake ] ) => {
	window.__pad.axes[ 0 ] = stick; window.__pad.buttons[ 7 ].value = throttle; window.__pad.buttons[ 6 ].value = brake;
}, [ stick, throttle, brake ] );

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a player with a connected gamepad in the Aster on the straight town backroad', async () => {
		await page.addInitScript( () => {
			const buttons = Array.from( { length: 17 }, () => ( { pressed: false, touched: false, value: 0 } ) );
			window.__pad = { id: 'Virtual racing pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [ 0, 0, 0, 0 ], buttons };
			navigator.getGamepads = () => [ window.__pad, null, null, null ];
		} );
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	} );
} );

// Yaw change over a fixed time at a steady speed, with the stick held at `stick`.
async function turnWith( page, stick ) {
	await pad( page, { throttle: 0.6 } );
	await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeGreaterThan( 30 );
	await pad( page, { throttle: 0.25 } );
	const fx = await value( page, 'forward-x' ), fz = await value( page, 'forward-z' );
	await pad( page, { stick, throttle: 0.25 } );
	await page.waitForTimeout( 900 );
	const turn = - fz * await value( page, 'forward-x' ) + fx * await value( page, 'forward-z' );
	await pad( page, { brake: 1 } );
	await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeLessThan( 2 );
	await pad( page );
	return turn;
}

test( 'The right trigger drives, the left trigger brakes, and the stick steers in proportion', async ( { page } ) => {
	// A light touch stays well inside the tyres' grip; at full lock grip (and stability
	// control) caps the yaw, so compare a light touch with full lock.
	let half, full;
	await test.step( 'When the driver squeezes the throttle and nudges the stick lightly right', async () => { half = await turnWith( page, 0.3 ); } );
	await test.step( 'And, back at the start of the straight, repeats it with the stick fully right', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'beach' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		full = await turnWith( page, 1 );
	} );
	await test.step( 'Then both turns go right, and full lock turns clearly harder than the light touch', async () => {
		expect( half ).toBeGreaterThan( 0.02 );
		expect( full ).toBeGreaterThan( half * 1.3 );
	} );
} );

test( 'A holds the handbrake and Y recovers the car to rest', async ( { page } ) => {
	const button = ( index, value ) => page.evaluate( ( [ index, value ] ) => { const b = window.__pad.buttons[ index ]; b.value = value; b.pressed = value > 0.5; }, [ index, value ] );
	await test.step( 'When the driver gets up to speed on the right trigger', async () => {
		await pad( page, { throttle: 0.7 } );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeGreaterThan( 35 );
		await pad( page );
	} );
	await test.step( 'And holds A', async () => { await button( 0, 1 ); } );
	await test.step( 'Then the handbrake is on and the car slows', async () => {
		await expect( page.getByText( 'Handbrake', { exact: true } ) ).toBeVisible();
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeLessThan( 25 );
		await button( 0, 0 );
	} );
	await test.step( 'When the driver speeds up again and presses Y', async () => {
		await pad( page, { throttle: 0.7 } );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeGreaterThan( 20 );
		await pad( page );
		await button( 3, 1 ); await page.waitForTimeout( 200 ); await button( 3, 0 );
	} );
	await test.step( 'Then the car is back at rest on its four wheels at once (coasting would take many seconds)', async () => {
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ], timeout: 1000 } ).toBeLessThan( 2 );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	} );
} );
