import { test, expect } from '@playwright/test';
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, key ) => Number( await telemetry( page ).getAttribute( `data-${ key }` ) );
const out = process.env.PW_OUT || 'test-results';
test.beforeEach( async ( { page } ) => {
	await test.step( 'Given the real island, its roads, the ferry terminal and the original vehicle physics in an isolated session', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' ); await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( page.locator( '.gm-guide-card[role=dialog]' ) ).toBeHidden();
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	} );
} );

test( 'The ferry road carries a car from the circuit down to the terminal', async ( { page } ) => {
	await test.step( 'When the driver chooses Ferry road', async () => { await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'ferryRoad' ); } );
	await test.step( 'Then the car rests on the ferry road\'s asphalt, on a drivable grade all the way to the terminal', async () => {
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
		await expect( page.locator( '[data-chip="surface"]' ) ).toHaveText( 'Asphalt' );
		expect( await value( page, 'ferry-road-length' ) ).toBeGreaterThan( 350 );
		const grade = await value( page, 'ferry-road-max-grade' );
		expect( grade ).toBeGreaterThan( 0 );
		expect( grade ).toBeLessThan( 0.13 );
	} );
	const [ x, z ] = [ await value( page, 'x' ), await value( page, 'z' ) ];
	await test.step( 'When the driver holds the throttle', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 25 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then the car has moved down the road toward the terminal, still on its asphalt', async () => {
		const [ x1, z1 ] = [ await value( page, 'x' ), await value( page, 'z' ) ];
		expect( Math.hypot( x1 - x, z1 - z ) ).toBeGreaterThan( 5 );
		expect( z1 ).toBeGreaterThan( z + 3 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );
	// Evidence only: the view down the road into the terminal's road entry, the joint with the
	// terminal's paving close up, and the junction seen from the circuit.
	const views = [ [ 'ferry-road-to-terminal', 'ferryRoad', 55 ], [ 'ferry-road-terminal-joint', 'ferryRoad', 16 ], [ 'ferry-road-junction', 'circuit', - 22 ] ];
	for ( const [ file, path, back ] of views ) {
		await page.evaluate( ( [ path, back ] ) => {
			const route = window.__app.coastalRoute, pts = route[ path ].points;
			// back > 0: metres before the ferry road's end; back < 0: metres before the ferry road's junction on the circuit
			const at = back > 0 ? pts.at( - 1 ).distance - back : route.closest( route.ferryRoad.points[ 0 ].x, route.ferryRoad.points[ 0 ].z, s => s.path === route.circuit ).segment.a.distance + back;
			const i = pts.findIndex( p => p.distance >= at ), p = pts[ i ], next = pts[ i + 1 ];
			window.__app.rally.place( { x: p.x, z: p.z, yaw: Math.atan2( next.x - p.x, next.z - p.z ) } );
		}, [ path, back ] );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ out }/${ file }.png` } );
	}
} );
