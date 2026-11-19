import { test, expect } from '@playwright/test';

test.afterEach( async ( { page } ) => { expect( await page.pageErrors() ).toEqual( [] ); } );

test( 'Hold a rear-drive burnout, release onto the coastal road and catch the slide with the driver aids off', async ( { page }, info ) => {
	const dash = page.getByRole( 'status', { name: 'Rally telemetry' } );
	await test.step( 'Given the GT3 is parked on the coastal asphalt with sound enabled', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.6' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rs' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await page.getByRole( 'button', { name: 'Drive COSIER GT3 RS', exact: true } ).click();
		await expect( dash ).toHaveAttribute( 'data-grounded', '4.0000' );
		await expect( dash ).toHaveAttribute( 'data-audio-state', 'playing' );
	} );
	await test.step( 'When the player holds the brake and throttle, the rear tyres spin on the spot and squeal', async () => {
		await page.keyboard.down( 's' );
		await page.keyboard.down( 'w' );
		await expect.poll( () => page.evaluate( () => {
			const r = window.__app.rally, s = r.state;
			return Math.abs( s[ 7 ] ) < 5 && Math.min( s[ 23 ], s[ 27 ] ) > 12 && r.sound.tyres.squeal.gain.gain.value > 0.02;
		} ) ).toBe( true );
		await expect.poll( () => page.evaluate( async () => {
			const r = window.__app.rally;
			const { FX } = await import( '/src/rally/CarFire.js' );
			return r.damage.fx.soft.list.filter( p => p.kind === FX.TYRE ).length >= 16 && r.tracks.skids >= 2;
		} ) ).toBe( true );
		await page.screenshot( { path: info.outputPath( 'burnout.png' ) } );
	} );
	await test.step( 'Then releasing the brake puts the car into motion, and J hands the slide to the driver', async () => {
		await page.keyboard.up( 's' );
		await expect.poll( async () => Number( await dash.getAttribute( 'data-signed-speed' ) ) ).toBeGreaterThan( 25 );
		await page.keyboard.press( 'j' );
		await expect( page.getByRole( 'button', { name: 'Driving aids', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'false' );
		await page.keyboard.down( 'd' );
		await page.keyboard.down( 'Space' );
		await expect.poll( () => page.evaluate( () => Math.abs( window.__app.rally.state[ 78 ] ) ) ).toBeGreaterThan( 0.28 );
		await page.keyboard.up( 'Space' );
		await page.keyboard.up( 'd' );
		await page.keyboard.down( 'a' );
		await expect.poll( () => page.evaluate( () => window.__app.rally.state[ 71 ] ) ).toBeGreaterThan( 0.05 );
		await page.keyboard.up( 'a' );
		await page.keyboard.up( 'w' );
		await page.keyboard.press( 'j' );
		await expect( page.getByRole( 'button', { name: 'Driving aids', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' );
	} );
} );

test( 'A rear impact sheds the GT3 wing and repair restores it', async ( { page }, info ) => {
	await test.step( 'Given the GT3 on the coastal road with a broad crash barrier behind it', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.6&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rs' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await page.getByRole( 'button', { name: 'Drive COSIER GT3 RS', exact: true } ).click();
		await expect( page.getByRole( 'status', { name: 'Rally telemetry' } ) ).toHaveAttribute( 'data-grounded', '4.0000' );
		// Fixture arrangement only. Reverse, collision response, debris and repair use game controls.
		await page.evaluate( () => {
			const r = window.__app.rally, p = r.model.root.position, f = r.forward;
			r.physics.add_boxes( new Float32Array( [ p.x - f.x * 14, p.y + 0.5, p.z - f.z * 14,
				4, 1.2, 0.4, Math.atan2( f.x, f.z ), 0.65 ] ) );
		} );
	} );
	const attached = () => page.evaluate( () => {
		const wing = window.__app.rally.damage.car.rig.parts.get( 'rearWing' );
		return wing ? wing.meshes.some( p => p.mesh.visible ) : true;
	} );
	await test.step( 'When the player reverses into the barrier the wing tears free', async () => {
		await page.keyboard.down( 's' );
		try { await expect.poll( attached, { timeout: 20000 } ).toBe( false ); }
		finally { await page.keyboard.up( 's' ); }
		await expect.poll( () => page.evaluate( () => window.__app.rally.damage.wreckage.count ) ).toBeGreaterThan( 0 );
		await page.screenshot( { path: info.outputPath( 'rear-impact.png' ) } );
	} );
	await test.step( 'Then pressing T restores the wing and clears the detached pieces', async () => {
		await page.keyboard.press( 't' );
		await expect.poll( attached ).toBe( true );
		await expect.poll( () => page.evaluate( () => window.__app.rally.damage.wreckage.count ) ).toBe( 0 );
	} );
} );
