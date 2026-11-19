import { test, expect } from '@playwright/test';

// Given/When/Then on the real island: the player's own character, seen over the shoulder
// (third person) or worn as a body under the first-person camera. Setup only opens the island
// (and, aboard the ferry, poses the free camera the way terminal.spec.js does); every view
// switch, step and look is the player's own keys, mouse and the on-screen button.

const OUT = process.env.PW_OUT || 'test-results';

async function openIsland( page, { again = false } = {} ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	// the guided tour's Skip shows on the first visit only
	if ( ! again ) await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// Where the camera sits against the player's head (feet + 1.62 m; aboard the ferry, in her frame).
const view = page => page.evaluate( () => {

	const app = window.__app, p = app.player, V = app.camera.position.constructor;
	const head = p.mode === 'ferry' ? app.ferry.ship.toWorld( new V( 0, 1.62, 0 ).add( app.ferry.deck.local ) ) : new V( 0, 1.62, 0 ).add( p.position );
	const cam = app.camera.position, fwd = new V( 0, 0, - 1 ).applyQuaternion( app.camera.quaternion );
	const toHead = head.clone().sub( cam );
	const avatar = p.avatar && p.avatar.state ? p.avatar.state() : null;
	return {
		mode: p.mode, dist: toHead.length(), ahead: toHead.dot( fwd ), above: cam.y - head.y, pitch: p.pitch,
		feet: { x: p.position.x, z: p.position.z }, avatar,
	};

} );

test( 'On the beach, the player switches to a third-person view of their own character with V and the on-screen button, and it is remembered', async ( { page } ) => {

	test.setTimeout( 300_000 );
	// Third person has been the default view since 25f6bd8 ("third person by default"): a fresh
	// player starts over the shoulder, V goes to their eyes, and V again comes back.
	await test.step( 'Given a player on foot on the beach, in the default third-person view', async () => {

		await openIsland( page );
		const v = await view( page );
		expect( v.mode ).toBe( 'walk' );
		expect( v.avatar.view ).toBe( 'third' );
		expect( v.dist ).toBeGreaterThan( 1.5 );

	} );
	await test.step( 'When they press V, the view goes to their eyes', async () => {

		await page.keyboard.press( 'v' );
		await page.waitForTimeout( 600 );
		const v = await view( page );
		expect( v.dist ).toBeLessThan( 0.3 );
		await expect( page.getByRole( 'button', { name: 'Third person' } ) ).toBeVisible();

	} );
	await test.step( 'When they press V again', async () => {

		await page.keyboard.press( 'v' );
		await page.waitForTimeout( 600 );

	} );
	await test.step( 'Then the camera sits behind and above them, 1.5 to 8 m from their head, and their character is drawn', async () => {

		const v = await view( page );
		console.log( `third person: ${ JSON.stringify( v ) }` );
		expect( v.dist ).toBeGreaterThan( 1.5 );
		expect( v.dist ).toBeLessThan( 8 );
		expect( v.ahead ).toBeGreaterThan( 1 );
		expect( v.above ).toBeGreaterThan( 0 );
		expect( v.avatar.visible ).toBe( true );
		expect( v.avatar.view ).toBe( 'third' );
		await expect( page.getByRole( 'button', { name: 'First person' } ) ).toBeVisible();
		await page.screenshot( { path: `${ OUT }/third-person-beach.png` } );

	} );
	await test.step( 'When they hold W, the character walks (or its idle stand-in plays) and moves off', async () => {

		const before = await view( page );
		await page.keyboard.down( 'w' );
		await page.waitForTimeout( 1500 );
		const v = await view( page );
		await page.screenshot( { path: `${ OUT }/third-person-walking.png` } );
		await page.keyboard.up( 'w' );
		console.log( `walking: ${ JSON.stringify( v.avatar ) }` );
		expect( Math.hypot( v.feet.x - before.feet.x, v.feet.z - before.feet.z ) ).toBeGreaterThan( 2 );
		expect( v.avatar.speed ).toBeGreaterThan( 2 );
		// player.glb walks (walk / run / sprint by speed); joe.glb has no walk and stands in with its idle
		expect( v.avatar.locomotion ? v.avatar.clips.loco : [ v.avatar.clips.idle ] ).toContain( v.avatar.clip );
		expect( v.dist ).toBeGreaterThan( 1.5 );
		expect( v.dist ).toBeLessThan( 8 );

	} );
	await test.step( 'When they click the on-screen "First person" button, the view returns to their eyes with their body under it, head hidden', async () => {

		await page.getByRole( 'button', { name: 'First person' } ).click();
		await page.waitForTimeout( 300 );
		const v = await view( page );
		expect( v.dist ).toBeLessThan( 0.3 );
		expect( v.avatar.visible ).toBe( true );
		expect( v.avatar.headHidden ).toBe( true );
		await expect( page.getByRole( 'button', { name: 'Third person' } ) ).toBeVisible();

	} );
	await test.step( 'And dragging the mouse down to look at their feet shows their legs and shadow', async () => {

		const box = await page.locator( 'canvas' ).first().boundingBox();
		await page.mouse.move( box.x + box.width / 2, box.y + 30 );
		await page.mouse.down();
		await page.mouse.move( box.x + box.width / 2, box.y + box.height - 30, { steps: 16 } );
		await page.mouse.up();
		await page.waitForTimeout( 400 );
		const v = await view( page );
		expect( v.pitch ).toBeLessThan( - 0.9 );
		await page.screenshot( { path: `${ OUT }/first-person-legs.png` } );

	} );
	await test.step( 'When they click "Third person" and come back to the island later, it opens in third person', async () => {

		await page.getByRole( 'button', { name: 'Third person' } ).click();
		await openIsland( page, { again: true } );
		await page.waitForTimeout( 600 );
		const v = await view( page );
		expect( v.avatar.view ).toBe( 'third' );
		expect( v.dist ).toBeGreaterThan( 1.5 );
		await expect( page.getByRole( 'button', { name: 'First person' } ) ).toBeVisible();

	} );

} );

test( 'In third person, a player walks from the ferry car deck through the stair door and up to the passenger corridor, the camera never leaving her hull', async ( { page } ) => {

	test.setTimeout( 300_000 );
	const aboard = () => page.evaluate( () => {

		const app = window.__app, p = app.ferry.deck.local;
		return { mode: app.player.mode, x: p.x, y: p.y, z: p.z };

	} );
	await test.step( 'Given a solo player on the real island with the ferry made fast at the terminal', async () => {

		await openIsland( page );

	} );
	await test.step( 'And the player is dropped from the free camera onto her car deck, facing the stair door in the port wing wall', async () => {

		await page.evaluate( () => {

			const app = window.__app, ship = app.ferry.ship;
			app.setFreeCam( true );
			app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 5.0, 4.4, - 8.9 ) ), ship.yaw - Math.PI / 2, - 0.1 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
		await expect.poll( async () => ( await aboard() ).y, { timeout: 5_000 } ).toBeLessThan( 2.8 );

	} );
	await test.step( 'When, in the default third-person view, they walk through the door and up the stairs toward her bow', async () => {

		// third person is the default (25f6bd8): no V press, which would now go to first person
		expect( ( await view( page ) ).avatar.view ).toBe( 'third' );
		// every frame from here: where the camera is in her frame and how far it is from the head
		await page.evaluate( () => {

			const app = window.__app, V = app.camera.position.constructor, t = window.__camTrack = { maxX: 0, maxZ: 0, minDist: 99, maxDist: 0, frames: 0 };
			const tick = () => {

				if ( ! window.__camTrack ) return;
				const c = app.ferry.ship.toLocal( app.camera.position.clone(), new V() ), l = app.ferry.deck.local;
				const d = Math.hypot( c.x - l.x, c.y - l.y - 1.62, c.z - l.z );
				t.maxX = Math.max( t.maxX, Math.abs( c.x ) ); t.maxZ = Math.max( t.maxZ, Math.abs( c.z ) );
				t.minDist = Math.min( t.minDist, d ); t.maxDist = Math.max( t.maxDist, d ); t.frames ++;
				requestAnimationFrame( tick );

			};
			requestAnimationFrame( tick );

		} );
		await page.keyboard.down( 'w' );
		await expect.poll( async () => ( await aboard() ).x, { timeout: 10_000 } ).toBeGreaterThan( 6.9 );
		await page.keyboard.up( 'w' );
		// facing outboard, D steps her way toward the bow: up the flight (the axes follow the camera)
		await page.keyboard.down( 'd' );
		await expect.poll( async () => ( await aboard() ).y, { timeout: 20_000 } ).toBeGreaterThan( 4.5 );
		await page.screenshot( { path: `${ OUT }/third-person-ferry-stairs.png` } );
		await expect.poll( async () => ( await aboard() ).y, { timeout: 20_000 } ).toBeGreaterThan( 6.9 );
		await page.keyboard.up( 'd' );

	} );
	await test.step( 'Then they stand in the passenger corridor, seen from behind, and the camera stayed inside her hull all the way', async () => {

		const at = await aboard();
		const v = await view( page );
		const track = await page.evaluate( () => { const t = window.__camTrack; window.__camTrack = null; return t; } );
		console.log( `after the stairs: ${ JSON.stringify( at ) } camera: ${ JSON.stringify( track ) } view: ${ JSON.stringify( { dist: v.dist, avatar: v.avatar } ) }` );
		expect( at.mode ).toBe( 'ferry' );
		expect( Math.abs( at.y - 7.0 ) ).toBeLessThan( 0.15 );
		expect( at.x ).toBeGreaterThan( 6.6 );
		expect( at.x ).toBeLessThan( 8.9 );
		expect( v.avatar.view ).toBe( 'third' );
		expect( v.avatar.visible ).toBe( true );
		expect( track.frames ).toBeGreaterThan( 30 );
		expect( track.maxX ).toBeLessThan( 9.8 );
		expect( track.maxZ ).toBeLessThan( 27 );
		expect( track.maxDist ).toBeLessThan( 8 );
		await page.screenshot( { path: `${ OUT }/third-person-ferry-corridor.png` } );

	} );

} );

test( 'Frame time: the character in third person on the beach, against the same frames without it', async ( { page } ) => {

	test.setTimeout( 240_000 );
	await openIsland( page );
	await page.keyboard.press( 'v' );
	await page.waitForTimeout( 1500 );
	// rAF frame time and the character's own CPU time (animation, blend, joint upload), 240 frames each
	const perf = await page.evaluate( async () => {

		const a = window.__app.player.avatar, orig = a.update.bind( a );
		let cpu = 0, calls = 0, hide = false;
		a.update = ( dt, f ) => {

			const t0 = performance.now();
			orig( dt, hide ? { ...f, show: false } : f );
			cpu += performance.now() - t0;
			calls ++;

		};
		const frames = n => new Promise( res => {

			let last = performance.now(), sum = 0, k = 0;
			const tick = () => { const t = performance.now(); sum += t - last; last = t; if ( ++ k < n ) requestAnimationFrame( tick ); else res( sum / n ); };
			requestAnimationFrame( tick );

		} );
		const withMs = await frames( 240 ), withCpu = cpu / calls;
		hide = true; cpu = 0; calls = 0;
		await frames( 30 );
		const withoutMs = await frames( 240 );
		a.update = orig;
		return { withMs, withoutMs, avatarCpuMs: withCpu };

	} );
	console.log( 'AVATAR_PERF', JSON.stringify( perf ) );
	expect( perf.avatarCpuMs ).toBeLessThan( 1.5 );

} );
