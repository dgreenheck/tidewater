import { test, expect } from '@playwright/test';

// Given/When/Then on the real island and Joey Island across the strait, with the Tidewater Spirit
// on her scheduled service. Only the free camera is posed from the test (the F-key camera a player
// flies by hand) and a few look-only captures; everything else is the timetable, the autopilot
// and the player's own keys. The passenger scenario uses ?ferryTimetable=short, which shortens
// only the wait at the berth (the game has no player-facing way to speed time up).
const OUT = process.env.PW_OUT || 'test-results';
const board = page => page.getByRole( 'status', { name: 'Ferry departures' } );
// her state, kept on the helm readout whether or not anyone is at the helm (hidden then)
const state = page => page.locator( '[aria-label="Ferry helm"]' );
const telemetryOf = page => page.getByRole( 'status', { name: 'Rally telemetry' } );

async function openIsland( page, query = '' ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=0.5&noAudio${ query }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// Look only: the free camera at `eye` looking at `at` (world [ x, y, z ]).
const look = ( page, eye, at ) => page.evaluate( ( [ eye, at ] ) => {

	const app = window.__app, V = app.camera.position.constructor;
	app.setFreeCam( true );
	app.fly.setPose( new V( ...eye ), Math.atan2( eye[ 0 ] - at[ 0 ], eye[ 2 ] - at[ 2 ] ), Math.atan2( at[ 1 ] - eye[ 1 ], Math.hypot( at[ 0 ] - eye[ 0 ], at[ 2 ] - eye[ 2 ] ) ) );
	app.fly.velocity.set( 0, 0, 0 );

}, [ eye, at ] );

// Mean frame time over `ms` of animation frames.
const frameMs = ( page, ms = 3000 ) => page.evaluate( ms => new Promise( done => {

	const times = []; let last = performance.now();
	const tick = t => { times.push( t - last ); last = t; if ( times.length < 2 || times.reduce( ( a, b ) => a + b, 0 ) < ms ) requestAnimationFrame( tick ); else done( times.slice( 1 ).reduce( ( a, b ) => a + b, 0 ) / ( times.length - 1 ) ); };
	requestAnimationFrame( tick );

} ), ms );

// The car in her frame (x to port, z to her bow, y up from her waterline), its speed, heading and uprightness.
const carInHerFrame = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, ship = app.ferry.ship, V = app.camera.position.constructor;
	const at = new V( s[ 0 ], s[ 1 ], s[ 2 ] ), p = ship.toLocal( at, new V() ), q = new ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] );
	const nose = ship.toLocal( at.clone().add( new V( 0, 0, 1 ).applyQuaternion( q ) ), new V() ).sub( p );
	return { x: p.x, y: p.y, z: p.z, kmh: Math.abs( s[ 7 ] ), heading: Math.atan2( nose.x, nose.z ), up: new V( 0, 1, 0 ).applyQuaternion( q ).y, world: { x: s[ 0 ], y: s[ 1 ], z: s[ 2 ] } };

} );

// The player's hands: W (or S astern) held, A/D tapped to hold her centreline, until `until`.
async function drive( page, { until, key = 'w', timeout = 40_000 } ) {

	const started = Date.now(), astern = key === 's';
	let steer = null, car = await carInHerFrame( page );
	if ( key ) await page.keyboard.down( key );
	const track = [];
	while ( ! until( car ) && Date.now() - started < timeout ) {

		// ahead, steer the nose toward the centreline; astern, the wheel works the other way round
		const err = astern ? Math.atan2( car.x, 18 ) - car.heading : Math.atan2( - car.x, 18 ) - car.heading;
		const want = err > 0.03 ? ( astern ? 'd' : 'a' ) : err < - 0.03 ? ( astern ? 'a' : 'd' ) : null;
		if ( want !== steer ) { if ( steer ) await page.keyboard.up( steer ); if ( want ) await page.keyboard.down( want ); steer = want; }
		await page.waitForTimeout( 50 );
		car = await carInHerFrame( page );
		track.push( car );

	}
	if ( steer ) await page.keyboard.up( steer );
	if ( key ) await page.keyboard.up( key );
	return { car, track };

}

// The player's hands going astern, the careful way: S feathered to keep her under about 10 km/h,
// A/D tapped so the car backs straight down her centreline. Going astern the car swings the other
// way for the same key, so the nose is steered toward the small heading whose reverse closes on x = 0.
async function backOff( page, { until, timeout = 60_000 } ) {

	const started = Date.now();
	let steer = null, reverse = false, car = await carInHerFrame( page );
	const track = [];
	while ( ! until( car ) && Date.now() - started < timeout ) {

		const want = car.kmh > 10 ? false : true;
		if ( want !== reverse ) { if ( want ) await page.keyboard.down( 's' ); else await page.keyboard.up( 's' ); reverse = want; }
		const err = Math.max( - 0.45, Math.min( 0.45, Math.atan2( car.x, 6 ) ) ) - car.heading;
		const turn = err > 0.02 ? 'd' : err < - 0.02 ? 'a' : null;
		if ( turn !== steer ) { if ( steer ) await page.keyboard.up( steer ); if ( turn ) await page.keyboard.down( turn ); steer = turn; }
		await page.waitForTimeout( 50 );
		car = await carInHerFrame( page );
		track.push( car );

	}
	if ( steer ) await page.keyboard.up( steer );
	if ( reverse ) await page.keyboard.up( 's' );
	return { car, track };

}

test( 'A passenger rides the scheduled ferry from Tidewater to Joey Island', async ( { page } ) => {

	test.setTimeout( 420_000 );
	await test.step( 'Given a solo player on the real island, with Joey Island and its terminal across the strait', async () => {

		await openIsland( page, '&ferryTimetable=short' );
		const berth = await page.evaluate( () => { const b = window.__app.joeyTerminal?.berth(); return b && { x: b.x, z: b.z }; } );
		expect( berth ).not.toBeNull();
		// look only: from above Tidewater's terminal toward Joey Island, with and without its terminal drawn
		await look( page, [ 190, 40, 250 ], [ - 150, 10, 700 ] );
		await page.waitForTimeout( 2_000 );
		const withJoey = await frameMs( page );
		await page.evaluate( () => { const t = window.__app.joeyTerminal; t.root.visible = false; for ( const m of t.parkedMeshes ) m.visible = false; } );
		const without = await frameMs( page );
		await page.evaluate( () => { const t = window.__app.joeyTerminal; t.root.visible = true; for ( const m of t.parkedMeshes ) m.visible = true; } );
		console.log( `frame time looking across the strait: ${ withJoey.toFixed( 1 ) } ms with Joey's terminal, ${ without.toFixed( 1 ) } ms without` );
		await page.screenshot( { path: `${ OUT }/crossing-joey-from-tidewater.png` } );

	} );
	await test.step( 'And the player drops from the free camera onto her sun deck while she lies at Tidewater', async () => {

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
	await test.step( 'Then the departures board aboard shows the next sailing to Joey Island', async () => {

		await expect( board( page ) ).toBeVisible();
		await expect( board( page ) ).toContainText( /Next sailing to Joey Island \d+:\d\d|Loading vehicles for Joey Island|Departing for Joey Island/ );
		await page.screenshot( { path: `${ OUT }/crossing-aboard-departures.png` } );

	} );
	let sailed = 0;
	await test.step( 'When the player waits aboard: she loads, raises her ramp, casts off with one prolonged blast and sails', async () => {

		// (her ramp stays down while the traffic queue drives aboard: about 100 s with a full queue)
		await expect( board( page ) ).toContainText( 'Sailing to Joey Island', { timeout: 180_000 } );
		sailed = Date.now();
		expect( await state( page ).getAttribute( 'data-lines' ) ).toBe( 'off' );
		expect( await state( page ).getAttribute( 'data-horn' ) ).toBe( 'long' );

	} );
	await test.step( 'Then she crosses the strait and makes fast at Joey Island through the berth capture, hull sound', async () => {

		// her track, every 10 s of the way, for the record
		const started = Date.now();
		while ( ! ( await board( page ).textContent() ).includes( 'Arriving at Joey Island' ) && Date.now() - started < 150_000 ) {

			const at = await page.evaluate( () => { const f = window.__app.ferry, s = f.ship; return `${ f.service.pilot.leg } at ${ s.position.x.toFixed( 0 ) }, ${ s.position.z.toFixed( 0 ) } heading ${ ( s.yaw * 180 / Math.PI ).toFixed( 0 ) } speed ${ s.speed.toFixed( 1 ) } lever ${ s.lever.toFixed( 2 ) } hull ${ f.hull.toFixed( 3 ) } grounded ${ s.grounded }`; } );
			console.log( `  ${ ( ( Date.now() - sailed ) / 1000 ).toFixed( 0 ) } s: ${ at }` );
			await page.waitForTimeout( 10_000 );

		}
		await expect( board( page ) ).toContainText( 'Arriving at Joey Island' );
		await page.screenshot( { path: `${ OUT }/crossing-arriving-aboard.png` } );
		await expect.poll( () => state( page ).getAttribute( 'data-berth' ), { timeout: 150_000, intervals: [ 500 ] } ).toBe( 'joey' );
		const crossing = Number( await board( page ).getAttribute( 'data-crossing' ) );
		console.log( `crossing, lines off at Tidewater to lines on at Joey Island: ${ crossing.toFixed( 1 ) } s game time, ${ ( ( Date.now() - sailed ) / 1000 ).toFixed( 1 ) } s wall` );
		expect( await state( page ).getAttribute( 'data-lines' ) ).toBe( 'on' );
		expect( Number( await state( page ).getAttribute( 'data-hull' ) ) ).toBeLessThan( 0.02 );

	} );
	await test.step( 'And she lowers her ramp onto Joey Island\'s linkspan', async () => {

		await expect.poll( async () => Number( await state( page ).getAttribute( 'data-ramp' ) ), { timeout: 30_000 } ).toBe( 1 );

	} );
	await test.step( 'And the player is still aboard her', async () => {

		const where = await page.evaluate( () => {

			const app = window.__app, p = app.ferry.ship.toLocal( app.player.position, new app.camera.position.constructor() );
			return { mode: app.player.mode, x: p.x, y: p.y, z: p.z };

		} );
		console.log( `passenger at Joey Island: ${ where.mode }, her frame ${ where.x.toFixed( 1 ) }, ${ where.y.toFixed( 1 ) }, ${ where.z.toFixed( 1 ) }` );
		expect( where.mode ).toBe( 'ferry' );
		expect( Math.abs( where.x ) ).toBeLessThan( 9 );
		expect( Math.abs( where.z ) ).toBeLessThan( 25 );
		await page.screenshot( { path: `${ OUT }/crossing-at-joey-aboard.png` } );

	} );
	await test.step( 'And from off her quarter she lies at Joey Island\'s terminal with her ramp down', async () => {

		const [ eye, at ] = await page.evaluate( () => { const t = window.__app.joeyTerminal, e = t.toWorld( [ - 30, 22, 60 ] ), a = t.toWorld( [ 0, 3, 5 ] ); return [ [ e.x, e.y, e.z ], [ a.x, a.y, a.z ] ]; } );
		await look( page, eye, at );
		await page.waitForTimeout( 2_000 );
		await page.screenshot( { path: `${ OUT }/crossing-arrived-joey.png` } );

	} );

} );

test( 'A car crosses on the ferry: driven aboard at Tidewater, it rides the crossing and drives off at Joey Island', async ( { page } ) => {

	test.setTimeout( 600_000 );
	await test.step( 'Given a solo player on the real island who starts the Aster RS at the ferry terminal', async () => {

		await openIsland( page );
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Ferry terminal' } );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );

	} );
	await test.step( 'And the departures board at the terminal shows the next sailing to Joey Island', async () => {

		await expect( board( page ) ).toContainText( /Next sailing to Joey Island \d+:\d\d|Loading vehicles for Joey Island/ );
		await page.screenshot( { path: `${ OUT }/crossing-car-lanes.png` } );

	} );
	await test.step( 'And she lowers her ramp for loading', async () => {

		await expect.poll( async () => Number( await state( page ).getAttribute( 'data-ramp' ) ), { timeout: 150_000, intervals: [ 500 ] } ).toBe( 1 );

	} );
	await test.step( 'When the player drives down the lanes, over the linkspan and her ramp, and brakes aboard', async () => {

		await drive( page, { until: car => car.z > - 58 } );
		// on up her ramp under power, well onto her deck, before braking
		await drive( page, { until: car => car.z > - 12 } );
		await page.keyboard.down( 's' );
		await expect.poll( async () => ( await carInHerFrame( page ) ).kmh, { timeout: 15_000, intervals: [ 100 ] } ).toBeLessThan( 1 );
		await page.keyboard.up( 's' );

	} );
	let parked;
	await test.step( 'Then the car rests on her vehicle deck on all four wheels', async () => {

		await page.waitForTimeout( 1_000 );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 5_000 } ).toBe( 4 );
		parked = await carInHerFrame( page );
		console.log( `parked aboard at her x ${ parked.x.toFixed( 2 ) }, z ${ parked.z.toFixed( 2 ) }, heading ${ parked.heading.toFixed( 3 ) }` );
		// fully on her deck, clear of her stern and her forward bulkhead, near her centreline
		expect( parked.z ).toBeGreaterThan( - 18 );
		expect( parked.z ).toBeLessThan( 16 );
		expect( Math.abs( parked.x ) ).toBeLessThan( 3 );
		expect( Math.abs( parked.y - 2.6 ) ).toBeLessThan( 0.3 );

	} );
	const track = [];
	await test.step( 'When the timetable runs: she raises her ramp, casts off, crosses and makes fast at Joey Island', async () => {

		const started = Date.now();
		while ( await state( page ).getAttribute( 'data-berth' ) !== 'joey' && Date.now() - started < 420_000 ) {

			track.push( await carInHerFrame( page ) );
			await page.waitForTimeout( 1_000 );

		}
		expect( await state( page ).getAttribute( 'data-berth' ) ).toBe( 'joey' );

	} );
	await test.step( 'Then the car stayed put on her deck the whole way: under 0.5 m of drift, never tipped', async () => {

		const drift = Math.max( ...track.map( c => Math.hypot( c.x - parked.x, c.z - parked.z ) ) );
		const upright = Math.min( ...track.map( c => c.up ) );
		console.log( `car through the crossing: ${ track.length } samples, drift ${ drift.toFixed( 3 ) } m, least upright ${ upright.toFixed( 3 ) }` );
		expect( drift ).toBeLessThan( 0.5 );
		expect( upright ).toBeGreaterThan( 0.95 );

	} );
	await test.step( 'When her ramp is down at Joey Island and the player backs the car off her stern, down the ramp and the linkspan', async () => {

		await expect.poll( async () => Number( await state( page ).getAttribute( 'data-ramp' ) ), { timeout: 30_000 } ).toBe( 1 );
		await backOff( page, { until: car => car.z < - 62, timeout: 60_000 } );
		await page.waitForTimeout( 1_500 );

	} );
	await test.step( 'Then the car stands on Joey Island\'s terminal flat, on land', async () => {

		const car = await carInHerFrame( page );
		const land = await page.evaluate( ( { x, z } ) => {

			const app = window.__app, t = app.joeyTerminal, o = t.position;
			return { fromTerminal: Math.hypot( x - o.x, z - o.z ), seabed: app.terrainData.heightAt( x, z ) };

		}, car.world );
		console.log( `car ashore at Joey Island: ${ land.fromTerminal.toFixed( 1 ) } m from the terminal origin, ground ${ land.seabed.toFixed( 2 ) } m, car y ${ car.world.y.toFixed( 2 ) }` );
		expect( car.z ).toBeLessThan( - 55 );
		expect( land.fromTerminal ).toBeLessThan( 90 );
		expect( land.seabed ).toBeGreaterThan( 1 );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 5_000 } ).toBe( 4 );
		await page.screenshot( { path: `${ OUT }/crossing-car-ashore-joey.png` } );

	} );

} );

test( 'The minimap shows Joey Island and its terminal when a player starts there', async ( { page } ) => {

	await test.step( 'Given a solo player on the real island in the Aster RS', async () => {

		await openIsland( page, '&ferryService=off' );
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();

	} );
	await test.step( 'When the driver starts at the Joey Island terminal', async () => {

		await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Joey Island terminal' } );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );

	} );
	await test.step( 'Then the minimap under the car shows land, not a blank disc', async () => {

		const map = page.getByRole( 'group', { name: 'Island minimap' } );
		await expect( map ).toBeVisible();
		// the pixels of the baked map around the car's own spot (the map turns about it)
		const probe = () => map.evaluate( el => {

			const canvas = el.querySelector( 'canvas' ), ctx = canvas.getContext( '2d' );
			const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
			// the car sits at the centre of the round window; map that point into canvas pixels
			const m = new DOMMatrix( getComputedStyle( canvas ).transform ).inverse();
			const p = m.transformPoint( new DOMPoint( r.width / 2 - ( c.left - r.left ) + ( c.left - r.left ), r.height / 2 ) );
			const px = Math.round( p.x ), py = Math.round( p.y );
			if ( px < 2 || py < 2 || px > canvas.width - 3 || py > canvas.height - 3 ) return { inside: false, alpha: 0 };
			const d = ctx.getImageData( px - 2, py - 2, 5, 5 ).data;
			let alpha = 0, green = 0;
			for ( let i = 0; i < d.length; i += 4 ) { alpha += d[ i + 3 ]; green += d[ i + 1 ] - d[ i + 2 ]; }
			return { inside: true, alpha: alpha / 25, landish: green / 25 };

		} );
		await expect.poll( async () => ( await probe() ).alpha, { timeout: 20_000 } ).toBeGreaterThan( 200 );
		const at = await probe();
		console.log( `minimap under the car at Joey Island: ${ JSON.stringify( at ) }` );
		expect( at.inside ).toBe( true );
		await page.screenshot( { path: `${ OUT }/crossing-minimap-joey.png` } );

	} );

} );
