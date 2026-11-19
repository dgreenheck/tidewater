import { test, expect } from '@playwright/test';

// Given/When/Then for the cars added in item 7 (docs/cars.md): the player picks each one in the
// Vehicle picker, starts on the coastal road and drives it under W. The car must stand and drive on
// its own four wheels, with its own mass and tyre size, and its drawn wheels must roll with the road
// (whole turns x circumference within 10 % of the distance coasted with W up). Real island, real WASM physics,
// nothing intercepted in the driving path. Add a row here with every new car in Vehicles.js.
const CARS = [
	{ key: 'gt3rs', name: 'COSIER GT3 RS', tag: 'Rear-engine flat-six', mass: 1450, radius: 0.359 },
	{ key: 'gt', name: 'Petrel GT', tag: 'Rear-drive GT', mass: 1450, radius: 0.384 },
	{ key: 'supercar', name: 'Fulmine V10', tag: 'Mid-engine supercar', mass: 1550, radius: 0.336 },
	{ key: 'hypercar', name: 'Corsaire W16', tag: 'Mid-engine hypercar', mass: 1995, radius: 0.348 },
	{ key: 'buggy', name: 'Sandpiper 1600', tag: 'Open-tub beach buggy', mass: 620, radius: 0.345 },
];
const COAST_FROM = 35; // km/h: W is let go here. 45 km/h plus the coast ran past the 40 m straight onto sand
const SPIN_DOWN = 250; // ms after W up before the start is read: launch wheelspin settles to road speed
const COAST_MS = 600; // ms of free rolling measured, about 5.8 m at 35 km/h
const SAMPLE_MS = 100; // ms between coast samples: each sample is one read of the telemetry element
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );
const position = async page => ( { x: await value( page, 'x' ), z: await value( page, 'z' ) } );
// Position, wheel turns, contacts and surface in ONE read, so they come from the same frame: read one by
// one at 35 km/h, each round trip (5 to 20 ms) moves the car 5 to 20 cm against a 5.8 m window.
const frame = page => telemetry( page ).evaluate( el => ( {
	x: Number( el.dataset.x ), z: Number( el.dataset.z ), turns: Number( el.dataset.wheelTurns ),
	grounded: Number( el.dataset.grounded ), surface: el.dataset.surface,
} ) );
const out = name => `${ process.env.PW_OUT || 'test-results' }/${ name }`;

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a solo player on the real island with fresh local progress', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	} );
} );

for ( const car of CARS ) {
	test( `Pick the ${ car.name } and drive it on the coastal road on four rolling wheels`, async ( { page } ) => {
		const errors = [];
		page.on( 'pageerror', e => errors.push( e.message ) );
		await test.step( `When the player picks the ${ car.name } and the coastal road, then presses Drive`, async () => {
			await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( car.key );
			await expect( page.getByText( car.tag, { exact: true } ) ).toBeVisible();
			await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
			await page.getByRole( 'button', { name: `Drive ${ car.name }`, exact: true } ).click();
		} );
		await test.step( `Then the ${ car.name } stands on its own four wheels with its own mass and tyres`, async () => {
			await expect( telemetry( page ) ).toHaveAttribute( 'data-vehicle', car.key );
			await expect.poll( () => value( page, 'grounded' ), { timeout: 15_000 } ).toBe( 4 );
			await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 1 );
			expect( await value( page, 'mass' ) ).toBe( car.mass );
			expect( await value( page, 'wheel-radius' ) ).toBe( car.radius );
			expect( await telemetry( page ).getAttribute( 'data-surface' ) ).toBe( 'asphalt' );
			// Settled: the car has stopped sinking into its springs and creeping (two reads 0.5 s apart
			// within 2 cm). Read before this, the start was taken mid-settle and the road driven came out
			// 3.7 m short of the wheels' 11.6 m on the short run.
			await expect.poll( async () => {
				const a = await position( page );
				await page.waitForTimeout( 500 );
				const b = await position( page );
				return Math.hypot( b.x - a.x, b.z - a.z );
			}, { timeout: 15_000 } ).toBeLessThan( 0.02 );
			await page.screenshot( { path: out( `hero-${ car.key }-rest.png` ) } );
		} );
		const grounded = [], surfaces = [];
		const sample = async () => {
			grounded.push( await value( page, 'grounded' ) );
			surfaces.push( await telemetry( page ).getAttribute( 'data-surface' ) );
		};
		let start, turns0, end, turns;
		await test.step( `When the player holds W along the coastal road to ${ COAST_FROM } km/h, then lets it coast`, async () => {
			await page.keyboard.down( 'w' );
			await expect.poll( async () => {
				await sample();
				return value( page, 'signed-speed' );
			// signed-speed is km/h. Read every 50 ms: at the default back-off (up to 1 s between reads) a
			// loaded run drove 70 m, past the left bend at the end of the straight, and the GT left the
			// road for the beach sand (rolled 53.1 m against 69.6 m driven, grounded 4,4,4,1:
			// in a loaded run).
			}, { timeout: 20_000, intervals: [ 50 ] } ).toBeGreaterThan( COAST_FROM );
			await page.keyboard.up( 'w' );
			await page.waitForTimeout( SPIN_DOWN );
			const first = await frame( page );
			start = first;
			turns0 = first.turns;
			// The roll check holds only on the road (on sand the wheels slip and dig), so every sample must
			// be on asphalt before it counts: a 45 km/h window ended on the beach.
			const t0 = Date.now();
			while ( Date.now() - t0 < COAST_MS ) {
				await page.waitForTimeout( SAMPLE_MS );
				const now = await frame( page );
				expect( now.surface, `surface ${ Date.now() - t0 } ms into the coast` ).toBe( 'asphalt' );
				grounded.push( now.grounded );
				surfaces.push( now.surface );
				end = now;
				turns = now.turns - turns0;
			}
			await page.screenshot( { path: out( `hero-${ car.key }-driving.png` ) } );
		} );
		await test.step( 'Then it drove on four wheels and every wheel rolled with the road', async () => {
			const driven = Math.hypot( end.x - start.x, end.z - start.z ), rolled = turns * 2 * Math.PI * car.radius;
			console.log( `${ car.key }: drove ${ driven.toFixed( 1 ) } m, least-turned wheel rolled ${ rolled.toFixed( 1 ) } m (${ turns.toFixed( 2 ) } turns); grounded samples ${ grounded.join( ',' ) }` );
			expect( driven ).toBeGreaterThan( 4 );
			expect( Math.abs( rolled - driven ) / driven, `rolled ${ rolled.toFixed( 1 ) } m against ${ driven.toFixed( 1 ) } m driven` ).toBeLessThan( 0.1 );
			expect( Math.min( ...grounded ), `grounded samples ${ grounded.join( ',' ) }` ).toBe( 4 );
			expect( surfaces.filter( surface => surface !== 'asphalt' ), `surfaces sampled ${ surfaces.join( ',' ) }` ).toEqual( [] );
			expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.9 );
			expect( errors ).toEqual( [] );
		} );
	} );
}
