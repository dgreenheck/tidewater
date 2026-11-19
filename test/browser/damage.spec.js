import { test, expect } from '@playwright/test';

// Crash damage on the real island and WASM physics. Every crash is driven on the keyboard:
// a closed loop that holds W and nudges A/D toward the parked support pickup, the way a
// player lines a car up. No product responses are intercepted.
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );
const read = page => telemetry( page ).evaluate( el => Object.fromEntries( Object.entries( el.dataset ).map( ( [ k, v ] ) => [ k, Number( v ) ] ) ) );
// The parked pickup's box collider (RallyDrive.placeSupport) sits side-on to a car coming along the beach.
const PICKUP = { x: - 17, z: - 78 };
// The launch speed is read LAUNCH_M m from the standing start: by distance, not wall-clock time, so a
// loaded machine that steps the car less per second reads the same acceleration.
const LAUNCH_M = 6;

test.setTimeout( 420_000 );

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a solo player on the real island with fresh local progress', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	} );
} );

async function enter( page ) {
	await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	await expect( telemetry( page ) ).toBeVisible();
	await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
}

// Hold W from rest and steer at the pickup until the car is stopped dead by it.
// `launch` is the speed LAUNCH_M m into the throttle from rest, the car's acceleration.
async function attack( page, stopAt = 0 ) {
	let steer = null, launch = null, peak = 0, crashed = false, last = null, from = null;
	const set = async key => {
		if ( steer === key ) return;
		if ( steer ) await page.keyboard.up( steer );
		if ( key ) await page.keyboard.down( key );
		steer = key;
	};
	const start = Date.now();
	await page.keyboard.down( 'w' );
	try {
		while ( Date.now() - start < 14_000 ) {
			const t = await read( page );
			const elapsed = Date.now() - start;
			from ||= { x: t.x, z: t.z };
			if ( launch === null && Math.hypot( t.x - from.x, t.z - from.z ) >= LAUNCH_M ) launch = peak >= t.speed + 3 ? - 1 : t.speed;
			peak = Math.max( peak, t.speed );
			const dx = PICKUP.x - t.x, dz = PICKUP.z - t.z, length = Math.hypot( dx, dz );
			if ( peak > 12 && t.speed < peak * 0.45 ) { crashed = true; break; }
			if ( stopAt && length < stopAt ) break;
			last = t;
			// Driver-right of the heading; positive means the target is to the right.
			const right = ( - dx * t.forwardZ + dz * t.forwardX ) / length;
			// Straight during the launch so it measures the engine, not the steering.
			await set( launch === null ? null : right > 0.06 ? 'd' : right < - 0.06 ? 'a' : null );
			await page.waitForTimeout( 60 );
		}
	} finally {
		await set( null );
		await page.keyboard.up( 'w' );
	}
	// a car that never covers LAUNCH_M (a burning engine) launches no faster than its peak
	if ( launch === null ) launch = crashed ? - 1 : peak;
	return { launch, peak, crashed, x: last?.x, z: last?.z, speed: last?.speed };
}

// S for at least ms, and on until the car is FAR m from the pickup (so a slow, loaded machine that
// steps the car less per wall-clock second still gets the same run-up), at most three times ms.
async function backAway( page, ms = 4000, far = 16 ) {
	const start = Date.now();
	await page.keyboard.down( 's' );
	await page.waitForTimeout( ms );
	while ( Date.now() - start < 3 * ms ) {
		const t = await read( page );
		if ( Math.hypot( PICKUP.x - t.x, PICKUP.z - t.z ) >= far ) break;
		await page.waitForTimeout( 100 );
	}
	await page.keyboard.up( 's' );
	await page.keyboard.down( 'Space' );
	await expect.poll( () => value( page, 'speed' ), { timeout: 20_000 } ).toBeLessThan( 1 );
	await page.keyboard.up( 'Space' );
}

test( 'Crashing the Aster dents and breaks it, costs power, steams, smokes and burns until repaired', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	let first = null;
	await test.step( 'Given the driver is in the Aster on the beach with the support pickup parked ahead', async () => {
		await enter( page );
	} );
	await test.step( 'And the driver lines up a run-up at the pickup and stops', async () => {
		await attack( page, 16 );
		await page.keyboard.down( 'Space' );
		await expect.poll( () => value( page, 'speed' ), { timeout: 20_000 } ).toBeLessThan( 1 );
		await page.keyboard.up( 'Space' );
		// Reversing further than this can beach the car on driftwood; 3 s gives a 30 km/h-plus nose-in.
		await backAway( page, 3000 );
	} );
	let afterFirst;
	await test.step( 'When the driver accelerates from rest and drives hard into the pickup until the front is smashed', async () => {
		// Run-ups on sand vary, so a driver rams again (at most four runs) until the nose is properly hit.
		for ( let run = 0; run < 4; run ++ ) {
			const attempt = await attack( page );
			first ||= attempt;
			expect( attempt.crashed, JSON.stringify( attempt ) ).toBe( true );
			await page.waitForTimeout( 1500 );
			afterFirst = await read( page );
			console.log( 'crash', run, JSON.stringify( attempt ), 'front', afterFirst.damageFront );
			if ( afterFirst.damageFront > 0.2 ) break;
			await backAway( page, 3000 );
		}
		expect( first.launch ).toBeGreaterThan( 0 );
		await page.screenshot( { path: 'test-results/damage/first-crash.png' } );
	} );
	await test.step( 'Then the front is dented, parts are off, the radiator steams and the engine has lost power', async () => {
		expect( afterFirst.damageFront ).toBeGreaterThan( 0.2 );
		expect( afterFirst.damageBody ).toBeGreaterThan( 0 );
		expect( afterFirst.dents ).toBeGreaterThan( 0 );
		expect( afterFirst.partsLost ).toBeGreaterThan( 0 );
		expect( afterFirst.debris ).toBeGreaterThan( 0 );
		expect( afterFirst.steam ).toBeGreaterThan( 0 );
		expect( await value( page, 'damage-engine' ) ).toBeLessThan( 1 );
		await expect( page.locator( '[data-chip="damage"]' ) ).toBeVisible();
	} );
	let sawSmoke = false;
	await test.step( 'When the driver keeps ramming the pickup', async () => {
		for ( let hit = 0; hit < 10; hit ++ ) {
			sawSmoke ||= await value( page, 'smoke' ) > 0;
			if ( await value( page, 'fire' ) > 0 ) break;
			await backAway( page, 4000, 20 );
			const ram = await attack( page );
			await page.waitForTimeout( 800 );
			console.log( 'ram', hit, JSON.stringify( ram ), 'front', ( await read( page ) ).damageFront, 'smoke', await value( page, 'smoke' ), 'fire', await value( page, 'fire' ) );
		}
	} );
	await test.step( 'Then black smoke comes first and then the engine bay catches fire', async () => {
		expect( sawSmoke ).toBe( true );
		await expect.poll( () => value( page, 'fire' ), { timeout: 15_000 } ).toBeGreaterThan( 0 );
		await page.waitForTimeout( 2500 );
		await page.screenshot( { path: 'test-results/damage/fire.png' } );
	} );
	await test.step( 'And the burning car accelerates measurably slower than it did before the crashes', async () => {
		await backAway( page, 3000 );
		await expect.poll( () => value( page, 'fire' ), { timeout: 20_000 } ).toBeGreaterThan( 0.5 );
		const burning = await attack( page );
		console.log( 'burning launch', JSON.stringify( burning ), 'healthy launch', first.launch );
		expect( burning.launch ).toBeGreaterThan( - 1 );
		expect( burning.launch ).toBeLessThan( first.launch * 0.8 );
	} );
	await test.step( 'When the fire burns on, Then the engine dies and throttle no longer moves the car', async () => {
		await expect.poll( () => value( page, 'damage-engine' ), { timeout: 40_000 } ).toBe( 0 );
		await page.keyboard.down( 'Space' );
		await expect.poll( () => value( page, 'speed' ), { timeout: 20_000 } ).toBeLessThan( 1 );
		await page.keyboard.up( 'Space' );
		await page.keyboard.down( 'w' );
		await page.waitForTimeout( 2000 );
		await page.keyboard.up( 'w' );
		expect( await value( page, 'speed' ) ).toBeLessThan( 2 );
	} );
	await test.step( 'When the driver presses T to repair', async () => {
		await expect( page.getByRole( 'button', { name: 'Repair car' } ) ).toBeVisible();
		await page.keyboard.press( 't' );
	} );
	await test.step( 'Then the car is restored: no damage, debris, smoke or fire, and full power', async () => {
		await expect.poll( () => value( page, 'damage-engine' ) ).toBe( 1 );
		const t = await read( page );
		expect( [ t.damageBody, t.partsLost, t.wheelsLost, t.debris, t.steam, t.smoke, t.fire ] ).toEqual( [ 0, 0, 0, 0, 0, 0, 0 ] );
		// Recover first: the repaired car is back on clear ground, as a driver would do after a wreck.
		await page.keyboard.press( 'r' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await backAway( page, 3000 );
		const again = await attack( page );
		console.log( 'repaired launch', JSON.stringify( again ), 'healthy launch', first.launch );
		expect( again.launch ).toBeGreaterThan( first.launch * 0.85 );
	} );
	expect( errors ).toEqual( [] );
} );
