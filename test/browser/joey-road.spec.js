import { test, expect } from '@playwright/test';

// Given/When/Then on the real island and Joey Island. The car starts in Joey's marshalling lanes
// and the player drives it out of the terminal with the keys alone: round in the lanes, out through
// the check-in boom, along the yard road behind the village and out of the gate onto the island
// road. The yard's paving is visual, so the car drives on the terrain: behind the lanes a natural
// hill once stood up to 12 m through the paving, right where the yard road turns for the gate.
const OUT = process.env.PW_OUT || 'test-results';
const telemetryOf = page => page.getByRole( 'status', { name: 'Rally telemetry' } );

// The car in Joey's terminal frame (+z out to sea, +x to the left looking out to sea), its speed,
// its heading (0 faces the sea, positive turns toward +x) and its height above the flat (3.1 m).
const carAtJoey = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, t = app.joeyTerminal, c = Math.cos( t.yaw ), n = Math.sin( t.yaw );
	const dx = s[ 0 ] - t.position.x, dz = s[ 2 ] - t.position.z;
	const V = app.camera.position.constructor, nose = new V( 0, 0, 1 ).applyQuaternion( new app.camera.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] ) );
	const fx = nose.x * c - nose.z * n, fz = nose.x * n + nose.z * c;
	const junction = app.coastalRoute.joeyLink.points[ 0 ];
	return { x: dx * c - dz * n, z: dx * n + dz * c, y: s[ 1 ], kmh: s[ 7 ], heading: Math.atan2( fx, fz ),
		toJunction: Math.hypot( s[ 0 ] - junction.x, s[ 2 ] - junction.z ) };

} );

// The way out, in the terminal frame: round in the lanes beside the queue, out through the boom's
// lane, along the yard road behind the village car park, and out of the gate to the junction.
const WAY_OUT = [
	{ at: [ - 12, - 63 ], kmh: 9 }, { at: [ - 6, - 72 ], kmh: 10 }, { at: [ - 3, - 80 ], kmh: 9 },
	{ at: [ - 3, - 90 ], kmh: 12 }, { at: [ 2, - 102 ], kmh: 14 }, { at: [ 20, - 105 ], kmh: 18 },
	{ at: [ 45, - 105 ], kmh: 18 }, { at: [ 55, - 112 ], kmh: 14 }, { at: [ 55, - 122 ], kmh: 14 },
];

// The player's hands: steer for the next point with A/D, hold the speed with W and S, and back out
// with the lock reversed if the car stalls against something.
async function driveTheWayOut( page, timeout = 120_000 ) {

	const held = new Set(), hold = async ( key, on ) => {

		if ( on && ! held.has( key ) ) { await page.keyboard.down( key ); held.add( key ); }
		if ( ! on && held.has( key ) ) { await page.keyboard.up( key ); held.delete( key ); }

	};
	const track = [];
	let next = 0, car = await carAtJoey( page ), stuck = 0;
	const started = Date.now();
	while ( next < WAY_OUT.length && car.toJunction > 4 && Date.now() - started < timeout ) {

		const { at: [ tx, tz ], kmh } = WAY_OUT[ next ];
		if ( Math.hypot( tx - car.x, tz - car.z ) < 4 ) { next ++; continue; }
		const want = Math.atan2( tx - car.x, tz - car.z ), err = Math.atan2( Math.sin( want - car.heading ), Math.cos( want - car.heading ) );
		stuck = Math.abs( car.kmh ) < 0.5 && held.has( 'w' ) ? stuck + 1 : 0;
		if ( stuck > 30 ) {

			// stalled: reverse a car length on the opposite lock, then carry on
			await hold( 'w', false ); await hold( err > 0 ? 'a' : 'd', false );
			await hold( 's', true ); await hold( err > 0 ? 'd' : 'a', true );
			await page.waitForTimeout( 1_500 );
			await hold( 's', false ); await hold( 'a', false ); await hold( 'd', false );
			stuck = 0;

		} else {

			await hold( 'a', err > 0.04 ); await hold( 'd', err < - 0.04 );
			await hold( 'w', car.kmh < kmh ); await hold( 's', car.kmh > kmh + 6 );

		}
		await page.waitForTimeout( 50 );
		car = await carAtJoey( page );
		track.push( car );

	}
	for ( const key of [ ...held ] ) await hold( key, false );
	await page.keyboard.down( 's' );
	await expect.poll( async () => Math.abs( ( await carAtJoey( page ) ).kmh ), { timeout: 10_000 } ).toBeLessThan( 1 );
	await page.keyboard.up( 's' );
	return { car: await carAtJoey( page ), track };

}

test( 'A car drives out of Joey Island\'s terminal onto the island road on level ground', async ( { page } ) => {

	test.setTimeout( 300_000 );
	let flat;
	await test.step( 'Given a solo player on the real island who starts the Aster RS at the Joey Island terminal', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.keyboard.press( 'Backquote' );
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Joey Island terminal' } );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );
		flat = ( await carAtJoey( page ) ).y;
		const car = await carAtJoey( page );
		console.log( `start in the lanes at terminal ${ car.x.toFixed( 1 ) }, ${ car.z.toFixed( 1 ) }, car y ${ car.y.toFixed( 2 ) }` );

	} );
	let out;
	await test.step( 'When the player drives out of the lanes, through the boom, along the yard road and out of the gate', async () => {

		out = await driveTheWayOut( page );
		await page.screenshot( { path: `${ OUT }/joey-road-junction.png` } );

	} );
	await test.step( 'Then the car reaches the island road\'s junction on all four wheels', async () => {

		const { car } = out;
		console.log( `stopped ${ car.toJunction.toFixed( 1 ) } m from the junction, at terminal ${ car.x.toFixed( 1 ) }, ${ car.z.toFixed( 1 ) }` );
		expect( car.toJunction ).toBeLessThan( 8 );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 5_000 } ).toBe( 4 );

	} );
	await test.step( 'And it never climbed off the flat on the way across the yard', async () => {

		const yard = out.track.filter( p => p.z < - 88 && p.z > - 116 );
		const climb = Math.max( ...yard.map( p => p.y ) ) - flat;
		console.log( `${ yard.length } samples across the yard; highest ${ climb.toFixed( 2 ) } m above the start` );
		expect( yard.length ).toBeGreaterThan( 20 );
		expect( climb ).toBeLessThan( 0.3 );

	} );

} );
