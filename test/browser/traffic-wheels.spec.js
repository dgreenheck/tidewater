import { test, expect } from '@playwright/test';

// Given/When/Then on the real island: other people's cars at the ferry terminal roll on their wheels
// and steer them through their turns (docs/cars.md, Traffic wheels). Red before 2026-10-05: every
// traffic car was one welded mesh and its wheels never turned. Only the free camera is posed from
// the test (the F-key camera a player flies by hand); the cars are driven by the game's own traffic.
const OUT = process.env.PW_OUT || 'test-results';

// Every traffic car driving now: how far along its road it is, and what its wheels did (rad).
const moving = page => page.evaluate( () => {

	const t = window.__app.ferry.traffic;
	return t.cars.filter( c => c.path && c.v > 0.8 ).map( c => ( { id: c.id, s: c.s, v: c.v, state: c.state, rig: c.wheels ? { turned: c.wheels.turned, steer: c.wheels.steer, radius: c.wheels.radius } : null, drawn: t.drawnWheel ? t.drawnWheel( c ) : null } ) );

} );

test( 'Watching the ferry queue, the cars driving aboard turn their wheels and steer them', async ( { page } ) => {

	await test.step( 'Given a solo player on the real island with the ferry and her traffic loaded', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect.poll( () => page.evaluate( () => !! window.__app.ferry?.traffic?.parts ), { timeout: 60_000 } ).toBe( true );

	} );

	await test.step( 'When the player takes the free camera (F) and watches the terminal lanes', async () => {

		await page.keyboard.press( 'f' );
		await expect.poll( () => page.evaluate( () => window.__app.freeCam ) ).toBeTruthy();
		// look only: the free camera posed over the marshalling lanes, facing the linkspan
		await page.evaluate( () => {

			const app = window.__app, t = app.terminal;
			const eye = t.toWorld( [ - 9, 9, - 66 ] ), at = t.toWorld( [ 2.4, 3.6, - 46 ] );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
			app.fly.velocity.set( 0, 0, 0 );

		} );

	} );

	await test.step( 'Then a car on the move turns its wheels once per tyre circumference of road', async () => {

		// the queue starts aboard once her ramp is down: wait for a car to be driving
		await expect.poll( async () => ( await moving( page ) ).length, { timeout: 150_000, intervals: [ 1000 ] } ).toBeGreaterThan( 0 );
		const first = ( await moving( page ) )[ 0 ];
		expect( first.rig, 'the car has a wheel rig' ).not.toBeNull();
		await page.waitForTimeout( 3_000 );
		const later = ( await page.evaluate( () => window.__app.ferry.traffic.cars.map( c => ( { id: c.id, s: c.s, rig: c.wheels ? { turned: c.wheels.turned } : null } ) ) ) ).find( c => c.id === first.id );
		const road = Math.abs( later.s - first.s ), rolled = Math.abs( later.rig.turned - first.rig.turned ) * first.rig.radius;
		console.log( `car ${ first.id } (${ first.state }) drove ${ road.toFixed( 2 ) } m of road; its wheels rolled ${ rolled.toFixed( 2 ) } m` );
		expect( road ).toBeGreaterThan( 1 );
		expect( Math.abs( rolled - road ) ).toBeLessThan( 0.05 * road + 0.05 );

	} );

	await test.step( 'And the wheels drawn on screen are the ones turning, and the front pair steer through a turn', async () => {

		let steered = 0, drawnSpin = 0, drawnSteer = 0;
		for ( let k = 0; k < 40 && ! ( steered > 0.1 && drawnSteer > 0.1 ); k ++ ) {

			for ( const c of await moving( page ) ) {

				if ( ! c.rig || ! c.drawn ) continue;
				steered = Math.max( steered, Math.abs( c.rig.steer ) );
				// the drawn front wheel's yaw against the body follows the rig's steer
				if ( Math.abs( c.rig.steer ) > 0.1 ) drawnSteer = Math.max( drawnSteer, Math.abs( c.drawn.steer ) );
				drawnSpin = Math.max( drawnSpin, Math.abs( c.drawn.spinError ) < 0.02 ? 1 : 0 );

			}
			await page.waitForTimeout( 500 );

		}
		console.log( `largest steer seen ${ steered.toFixed( 3 ) } rad, drawn ${ drawnSteer.toFixed( 3 ) } rad; drawn spin matches the rig: ${ drawnSpin === 1 }` );
		await page.screenshot( { path: `${ OUT }/traffic-wheels-lanes.png` } );
		expect( drawnSpin, 'a drawn wheel sits at the rig\'s spin angle' ).toBe( 1 );
		expect( steered, 'a car on the move steered its front wheels' ).toBeGreaterThan( 0.1 );
		expect( drawnSteer, 'the drawn front wheel turned with it' ).toBeGreaterThan( 0.1 );

	} );

	await test.step( 'And the wheels stay inside their draw budget, and close up a turning car shows its front wheels steered', async () => {

		// cost: each visible car draws one wheel mesh per wheel material (docs/cars.md budget: at most 7)
		const cost = await page.evaluate( () => {

			const t = window.__app.ferry.traffic, seen = t.cars.filter( c => c.group.visible && c.group.wheelMeshes?.length );
			const draws = seen.map( c => c.group.wheelMeshes.length ), tris = m => ( m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count ) / 3;
			return { cars: seen.length, draws: draws.reduce( ( a, b ) => a + b, 0 ), most: Math.max( 0, ...draws ), triangles: seen.reduce( ( n, c ) => n + c.group.wheelMeshes.reduce( ( k, m ) => k + 4 * tris( m ), 0 ), 0 ) };

		} );
		console.log( `cars drawn ${ cost.cars }, wheel draws ${ cost.draws } (most a car ${ cost.most }), wheel triangles ${ Math.round( cost.triangles ) }` );
		expect( cost.most ).toBeLessThanOrEqual( 7 );
		// look only: the free camera off the front quarter of a car turning on its way aboard
		let staged = false;
		for ( let k = 0; k < 60 && ! staged; k ++ ) {

			staged = await page.evaluate( () => {

				const app = window.__app, t = app.ferry.traffic;
				const car = t.cars.find( c => c.path && c.v > 0.5 && c.wheels && Math.abs( c.wheels.steer ) > 0.08 && c.group.visible );
				if ( ! car ) return false;
				const g = car.group, V = app.camera.position.constructor, h = car.heading;
				const at = g.position.clone().add( new V( 0, 0.5, 0 ) ), eye = at.clone().add( new V( Math.sin( h ) * 10 + Math.cos( h ) * 4.5, 2.2, Math.cos( h ) * 10 - Math.sin( h ) * 4.5 ) );
				app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
				app.fly.velocity.set( 0, 0, 0 );
				return true;

			} );
			if ( ! staged ) await page.waitForTimeout( 500 );

		}
		await page.waitForTimeout( 600 );
		await page.screenshot( { path: `${ OUT }/traffic-wheels-closeup.png` } );
		expect( staged, 'a car turning on its way aboard was found to look at' ).toBe( true );

	} );

} );
