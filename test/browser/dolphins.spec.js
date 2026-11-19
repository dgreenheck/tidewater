import { test, expect } from '@playwright/test';

// Given/When/Then on the real island: a pod of bottlenose dolphins races in and rides the ferry's
// bow waves once the player has her under way. The player boards and drives her exactly as
// ferry.spec.js does (free-camera drop onto her top deck, walk to the wheel, E, L to cast off,
// a touch astern, W). Test hooks:
// the pod is gathered off her bows (app.dolphins.gather) and read back through the read-only
// app.dolphins.state(); the free camera is posed only for the evidence captures.
const OUT = process.env.PW_OUT || 'test-results';
const helm = page => page.getByRole( 'status', { name: 'Ferry helm' } );
const reading = async ( page, key ) => Number( await helm( page ).getAttribute( `data-${ key }` ) );

// members within 15 m ahead of her bows (stems at z +22.6 in her frame), under 3 m deep, moving with her
const riders = page => page.evaluate( () => window.__app.dolphins.state().members.filter( m =>
	m.fz > 21 && m.fz < 22.6 + 15 && Math.abs( m.fx ) < 12 && m.depth < 3 && m.relSpeed < 1.5 ) );

// wait (up to 45 s) for a member breaking the surface (breath or leap), then pose the free camera
// beside it, a little ahead of its motion, and capture
async function surfacing( page, name, riding ) {
	await page.evaluate( ( riding ) => new Promise( ( resolve ) => {
		const app = window.__app, P = app.camera.position.constructor, t0 = performance.now();
		const tick = () => {
			const pod = app.dolphins, ms = pod.brain.members.filter( m => ( m.state === 'breathe' || m.state === 'leap' ) && m.depth < 0.45 && ( ! riding || m.berth >= 0 ) );
			if ( ! ms.length && performance.now() - t0 < 45_000 ) return requestAnimationFrame( tick );
			const m = ms[ 0 ] || pod.brain.members[ 0 ], v = m.velocity, s = Math.hypot( v.x, v.z ) || 1;
			const t = new P( m.position.x + v.x * 0.35, m.water, m.position.z + v.z * 0.35 );
			const side = riding && app.ferry.ship.toLocal( m.position, new P() ).x < 0 ? - 1 : 1;
			const c = new P( t.x + v.x / s * 5 + v.z / s * 7 * side, m.water + 3, t.z + v.z / s * 5 - v.x / s * 7 * side );
			app.setFreeCam( true );
			app.fly.setPose( c, Math.atan2( c.x - t.x, c.z - t.z ), - Math.atan2( 3, Math.hypot( c.x - t.x, c.z - t.z ) ) );
			app.fly.velocity.set( v.x, 0, v.z );
			resolve();
		};
		tick();
	} ), riding );
	await page.waitForTimeout( 250 );
	await page.screenshot( { path: `${ OUT }/${ name }.png` } );
}

async function capture( page, name, pose ) {
	await page.evaluate( pose );
	await page.waitForTimeout( 700 );
	await page.screenshot( { path: `${ OUT }/${ name }.png` } );
}

test( 'Under way at the helm, a pod of dolphins comes in and rides the ferry\'s bow waves', async ( { page } ) => {
	test.setTimeout( 360_000 );
	await test.step( 'Given a solo player on the real island with the ferry moored at the terminal', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' + ( process.env.DOLPHIN_PERF ? '&profile' : '' ) );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	} );
	await test.step( 'And a pod of bottlenose dolphins roaming the water off her bows', async () => {
		const pod = await page.evaluate( () => {
			const app = window.__app, ship = app.ferry.ship;
			const p = ship.toWorld( new app.camera.position.constructor( 0, 0, 170 ) );
			return app.dolphins.gather( p.x, p.z );
		} );
		expect( pod.members.length ).toBeGreaterThanOrEqual( 5 );
		expect( pod.mode ).toBe( 'roam' );
		await page.waitForTimeout( 6000 );
		// evidence: the pod roaming, from just above the water and from under it
		await surfacing( page, 'dolphins-roaming-surfacing', false );
		await capture( page, 'dolphins-roaming', () => {
			const app = window.__app, s = app.dolphins.state(), m = s.members.slice().sort( ( a, b ) => a.depth - b.depth )[ 0 ];
			app.setFreeCam( true );
			const P = app.camera.position.constructor;
			app.fly.setPose( new P( m.x + 9, s.water + 2.2, m.z + 9 ), Math.atan2( 9, 9 ), - 0.2 );
			app.fly.velocity.set( 0, 0, 0 );
		} );
		await capture( page, 'dolphins-roaming-underwater', () => {
			const app = window.__app, s = app.dolphins.state();
			let x = 0, z = 0; for ( const m of s.members ) { x += m.x; z += m.z; }
			x /= s.members.length; z /= s.members.length;
			const P = app.camera.position.constructor;
			app.fly.setPose( new P( x + 14, s.water - 2.5, z ), Math.PI / 2, 0.02 );
			app.fly.velocity.set( 0, 0, 0 );
		} );
	} );
	await test.step( 'And the player drops from the free camera onto the sun deck behind her bridge, facing the bow', async () => {
		await page.evaluate( () => {
			const app = window.__app, ship = app.ferry.ship;
			app.setFreeCam( true );
			app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 0, 12.6, 3 ) ), ship.yaw + Math.PI, - 0.05 );
			app.fly.velocity.set( 0, 0, 0 );
		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'When the player walks forward through the lounge to the wheel and presses E', async () => {
		await page.keyboard.down( 'ShiftLeft' ); await page.keyboard.down( 'w' );
		await expect( page.getByText( 'Take the helm', { exact: true } ) ).toBeVisible( { timeout: 20_000 } );
		await page.keyboard.up( 'w' ); await page.keyboard.up( 'ShiftLeft' );
		await page.keyboard.press( 'e' );
		await expect( helm( page ) ).toBeVisible();
	} );
	await test.step( 'Then no dolphin is riding her bows while she lies at her berth', async () => {
		expect( ( await riders( page ) ).length ).toBe( 0 );
	} );
	await test.step( 'When the player casts off with L and backs her off the berth with a touch astern', async () => {
		await page.keyboard.press( 'l' );
		await expect( helm( page ).locator( '.fy-lines' ) ).toHaveText( 'Off', { timeout: 15_000 } );
		await page.keyboard.down( 's' ); await page.waitForTimeout( 500 ); await page.keyboard.up( 's' );
		await page.keyboard.press( 'x' );
	} );
	await test.step( 'When the player pushes the throttles full ahead', async () => {
		await page.keyboard.down( 'w' ); await page.waitForTimeout( 2600 ); await page.keyboard.up( 'w' );
		await expect( helm( page ) ).toContainText( 'Ahead 100%' );
	} );
	await test.step( 'Then she is under way at more than 3 m/s', async () => {
		await expect.poll( () => reading( page, 'speed' ), { timeout: 60_000, intervals: [ 500 ] } ).toBeGreaterThan( 3 );
	} );
	await test.step( 'And within 90 s at least two dolphins ride within 15 m ahead of her bows, under 3 m deep, moving with her', async () => {
		await expect.poll( async () => ( await riders( page ) ).length, { timeout: 90_000, intervals: [ 1000 ] } ).toBeGreaterThanOrEqual( 2 );
		expect( await page.evaluate( () => window.__app.dolphins.state().mode ) ).toBe( 'ride' );
	} );
	await test.step( 'Evidence: the pod in her bow waves, from above her starboard bow and from under the water', async () => {
		await surfacing( page, 'dolphins-bow-riding-surfacing', true );
		await capture( page, 'dolphins-bow-riding', () => {
			const app = window.__app, ship = app.ferry.ship, P = app.camera.position.constructor;
			const c = ship.toWorld( new P( 11, 9, 36 ) ), t = ship.toWorld( new P( 3, 0, 24 ) );
			app.setFreeCam( true );
			app.fly.setPose( c, Math.atan2( c.x - t.x, c.z - t.z ), - 0.5 );
			app.fly.velocity.copy( ship.velocity );
		} );
		await capture( page, 'dolphins-bow-riding-underwater', () => {
			const app = window.__app, ship = app.ferry.ship, P = app.camera.position.constructor;
			const c = ship.toWorld( new P( 16, - 2.2, 29 ) ), t = ship.toWorld( new P( 0, - 1.5, 25 ) );
			app.fly.setPose( c, Math.atan2( c.x - t.x, c.z - t.z ), 0.0 );
			app.fly.velocity.copy( ship.velocity );
		} );
	} );
	if ( process.env.DOLPHIN_PERF ) await test.step( 'Measurement: frame and GPU time with and without the pod in view', async () => {
		const perf = await page.evaluate( async () => {
			const app = window.__app, ship = app.ferry.ship, P = app.camera.position.constructor;
			const c = ship.toWorld( new P( 14, - 2.0, 30 ) ), t = ship.toWorld( new P( 0, - 1.5, 25 ) );
			app.fly.setPose( c, Math.atan2( c.x - t.x, c.z - t.z ), 0.0 );
			app.fly.velocity.copy( ship.velocity );
			const frames = ( n ) => new Promise( ( res ) => { let k = 0; const tick = () => ( ++ k > n ? res() : requestAnimationFrame( tick ) ); requestAnimationFrame( tick ); } );
			const sample = async () => {
				const dt = [], gpu = [], cpu = []; let last = performance.now();
				for ( let i = 0; i < 150; i ++ ) {
					await frames( 1 );
					const now = performance.now(); dt.push( now - last ); last = now;
					const r = app.profiler && app.profiler.result;
					if ( r ) gpu.push( ( r.render || 0 ) + ( r.compute || 0 ) );
					cpu.push( app.dolphins.enabled ? app.dolphins.cpuMs : 0 );
				}
				const med = ( a ) => a.length ? a.slice().sort( ( x, y ) => x - y )[ a.length >> 1 ] : null;
				const mean = ( a ) => a.length ? a.reduce( ( x, y ) => x + y, 0 ) / a.length : null;
				return { frameMedian: med( dt.slice( 20 ) ), frameMean: mean( dt.slice( 20 ) ), p90: dt.slice( 20 ).sort( ( x, y ) => x - y )[ Math.floor( ( dt.length - 20 ) * 0.9 ) ], gpuComputeMedian: med( gpu.slice( 20 ) ), cpuMean: mean( cpu ), visible: app.dolphins.state().members.filter( m => m.visible ).length };
			};
			await frames( 30 );
			const on1 = await sample();
			app.dolphins.enabled = false;
			await frames( 30 );
			const off = await sample();
			app.dolphins.enabled = true;
			await frames( 30 );
			const on2 = await sample();
			const top = app.profiler && app.profiler.result ? app.profiler.result.items.slice( 0, 6 ).map( ( x ) => x.name + ' ' + x.ms.toFixed( 2 ) ) : [];
			return { profiler: !! ( app.profiler && app.profiler.enabled ), on1, off, on2, top };
		} );
		console.log( 'DOLPHIN_PERF', JSON.stringify( perf ) );
		await page.screenshot( { path: `${ OUT }/dolphins-perf-view.png` } );
	} );
} );
