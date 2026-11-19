import { test, expect } from '@playwright/test';

// Given/When/Then on the real island with the Tidewater Spirit made fast at the ferry terminal.
// Only the free camera is posed from the test (the F-key camera a player flies by hand); the rod,
// the cast and the walk are the player's own keys and mouse.
const OUT = process.env.PW_OUT || 'test-results';

async function openIsland( page ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// The rod's state, and the float and the player in her frame (x to port, z to her bow, y up).
const tackle = page => page.evaluate( () => {

	const app = window.__app, ship = app.ferry.ship, rod = app.game.rod, V = app.camera.position.constructor;
	const float = ship.toLocal( rod.bobber.clone(), new V() ), me = ship.toLocal( app.player.position.clone(), new V() );
	return { state: rod.state, equipped: rod.equipped, float: { x: float.x, y: float.y, z: float.z }, me: { x: me.x, y: me.y, z: me.z },
		line: Math.hypot( rod.bobber.x - rod.tip.x, rod.bobber.z - rod.tip.z ), mode: app.player.mode };

} );

// Given: the player dropped from the free camera onto the open after end of her upper deck, on her
// starboard side, looking aft over her stern.
async function onHerAfterDeck( page ) {

	await page.evaluate( () => {

		const app = window.__app, ship = app.ferry.ship;
		app.setFreeCam( true );
		app.fly.setPose( ship.toWorld( new app.camera.position.constructor( - 8.4, 11.8, - 22.5 ) ), ship.yaw, - 0.12 );
		app.fly.velocity.set( 0, 0, 0 );

	} );
	await page.waitForTimeout( 500 );
	await page.keyboard.press( 'f' );
	await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
	await expect.poll( async () => ( await tackle( page ) ).me.y, { timeout: 10_000 } ).toBeGreaterThan( 9.5 );

}

// The player's hand on the mouse: held for `ms`, then let go.
async function cast( page, ms ) {

	const box = page.viewportSize();
	await page.mouse.move( box.width / 2, box.height / 2 );
	await page.mouse.down();
	await page.waitForTimeout( ms );
	await page.mouse.up();

}

test( 'Out on her open after deck, a passenger takes out the rod and casts off her stern into the sea', async ( { page } ) => {

	test.setTimeout( 150_000 );
	await test.step( 'Given a solo player on the real island, standing on the open after end of her upper deck', async () => {

		await openIsland( page );
		await onHerAfterDeck( page );

	} );
	await test.step( 'Then the game offers the rod', async () => {

		await expect( page.getByText( 'Take out the rod', { exact: true } ) ).toBeVisible( { timeout: 10_000 } );

	} );
	await test.step( 'When the player takes out the rod with R, winds up and casts', async () => {

		await page.keyboard.press( 'r' );
		await expect.poll( async () => ( await tackle( page ) ).equipped ).toBe( true );
		await cast( page, 900 );

	} );
	await test.step( 'Then the float lands on the water astern of her, and the line is out', async () => {

		await expect.poll( async () => ( await tackle( page ) ).state, { timeout: 10_000 } ).toBe( 'floating' );
		const t = await tackle( page );
		console.log( `ferry fishing: float at her x ${ t.float.x.toFixed( 1 ) } z ${ t.float.z.toFixed( 1 ) } y ${ t.float.y.toFixed( 2 ) }, line ${ t.line.toFixed( 1 ) } m` );
		expect( t.float.z ).toBeLessThan( - 25.2 );
		expect( t.float.y ).toBeLessThan( 1.5 );
		expect( t.line ).toBeGreaterThan( 4 );
		// the casting tip beside the icon rail, not under it
		await expect( page.locator( '.gm-coach.is-on' ) ).toBeVisible();
		const tip = await page.locator( '.gm-coach.is-on' ).boundingBox(), rail = await page.locator( '.tw-rail' ).boundingBox();
		expect( tip.x + tip.width ).toBeLessThanOrEqual( rail.x );
		await page.screenshot( { path: `${ OUT }/ferry-fishing-cast.png` } );

	} );

} );

test( 'With the float out, a passenger walking forward along her deck tows it behind on the line instead of stretching the line', async ( { page } ) => {

	test.setTimeout( 150_000 );
	let before;
	await test.step( 'Given a passenger on her open after deck with a float out astern of her', async () => {

		await openIsland( page );
		await onHerAfterDeck( page );
		await page.keyboard.press( 'r' );
		await expect.poll( async () => ( await tackle( page ) ).equipped ).toBe( true );
		await cast( page, 500 );
		await expect.poll( async () => ( await tackle( page ) ).state, { timeout: 10_000 } ).toBe( 'floating' );
		before = await tackle( page );

	} );
	await test.step( 'When the player walks forward along her deck, 8 m, with the rod still out', async () => {

		await page.keyboard.down( 's' );
		await expect.poll( async () => ( await tackle( page ) ).me.z, { timeout: 20_000 } ).toBeGreaterThan( before.me.z + 8 );
		await page.keyboard.up( 's' );
		await page.waitForTimeout( 400 );

	} );
	await test.step( 'Then the float has come along behind, on no more line than was cast, still in the water', async () => {

		const t = await tackle( page );
		console.log( `ferry fishing, towed: line cast ${ before.line.toFixed( 1 ) } m, now ${ t.line.toFixed( 1 ) } m; float moved ${ ( t.float.z - before.float.z ).toFixed( 1 ) } m along her, state ${ t.state }` );
		expect( t.state ).toBe( 'floating' );
		expect( t.line ).toBeLessThan( before.line + 1 );
		expect( t.float.z - before.float.z ).toBeGreaterThan( 5 );
		expect( t.float.y ).toBeLessThan( 1.5 );

	} );

} );

test( 'In third person, a passenger takes out the rod and holds it in his right hand, not at the camera', async ( { page } ) => {

	test.setTimeout( 150_000 );
	// The rod's reel seat (where the hand grips it), his right hand, and the camera, in the world.
	const grip = () => page.evaluate( () => {

		const app = window.__app, rod = app.game.rod, a = app.player.avatar, V = app.camera.position.constructor;
		const e = rod.rodMesh.matrix.elements, seat = rod.seatY;
		const at = new V( e[ 12 ] + e[ 4 ] * seat, e[ 13 ] + e[ 5 ] * seat, e[ 14 ] + e[ 6 ] * seat );
		const hand = a?.handWorld?.( new V() ) || null;
		return { seat: at.toArray(), hand: hand && hand.toArray(), cam: app.camera.position.toArray(), view: app.player.view };

	} );
	await test.step( 'Given a solo player in third person on the open after end of her upper deck', async () => {

		await openIsland( page );
		await onHerAfterDeck( page );
		await page.keyboard.press( 'v' );
		await expect.poll( async () => ( await grip() ).view ).toBe( 'third' );

	} );
	await test.step( 'When the player takes out the rod with R', async () => {

		await page.keyboard.press( 'r' );
		await expect.poll( async () => ( await tackle( page ) ).equipped ).toBe( true );
		await page.waitForTimeout( 800 );

	} );
	await test.step( 'Then the reel seat is in his right hand, out in front of the camera with him', async () => {

		const g = await grip();
		const d = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );
		console.log( `rod grip: seat to hand ${ g.hand ? d( g.seat, g.hand ).toFixed( 3 ) : 'no hand' } m, seat to camera ${ d( g.seat, g.cam ).toFixed( 2 ) } m` );
		expect( g.hand ).not.toBeNull();
		expect( d( g.seat, g.hand ) ).toBeLessThan( 0.08 );
		expect( d( g.seat, g.cam ) ).toBeGreaterThan( 1.5 );
		await page.screenshot( { path: `${ OUT }/ferry-fishing-third-person.png` } );

	} );

} );
