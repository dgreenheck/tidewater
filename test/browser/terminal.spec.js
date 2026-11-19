import { test, expect } from '@playwright/test';

// Given/When/Then on the real island with the Tidewater Spirit moored at the ferry terminal's
// berth. Only the free camera is posed from the test (the F-key camera a player flies by hand);
// the walk over the gangway is the player's own keys.
const standing = page => page.evaluate( () => {

	const p = window.__app.player;
	return { mode: p.mode, grounded: p.grounded, onWalkway: p.position.y > 6 };

} );
// How far out on her port side the player is, in her frame (her door sill is at +9.3 m).
const outboard = page => page.evaluate( () => {

	const app = window.__app;
	return app.ferry.ship.toLocal( app.player.position, new app.camera.position.constructor() ).x;

} );

test( 'Walking over the gangway from the terminal, the player boards the moored ferry', async ( { page } ) => {

	await test.step( 'Given a solo player on the real island with the ferry moored at the terminal', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		console.log( `terminal.glb loaded in ${ await page.evaluate( () => window.__app.terminal.loadMs ) } ms, ${ await page.evaluate( () => window.__app.terminal.boxCount ) } boxes` );

	} );
	await test.step( 'And the player drops from the free camera onto the covered walkway by the gangway gate, facing the ferry door', async () => {

		// Her port door sill is 9.3 m out on her port side and 15.5 m aft of her middle; the
		// walkway's landing at the gangway gate is 4.7 m further out along the same line.
		await page.evaluate( () => {

			const app = window.__app, ship = app.ferry.ship;
			app.setFreeCam( true );
			app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 14.0, 8.7, - 15.5 ) ), ship.yaw + Math.PI / 2, - 0.3 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await page.waitForTimeout( 1_000 );
		await expect.poll( () => standing( page ), { timeout: 5_000 } ).toEqual( { mode: 'walk', grounded: true, onWalkway: true } );

	} );
	await test.step( 'When the player walks forward over the gangway', async () => {

		await page.keyboard.down( 'w' );
		await expect.poll( () => outboard( page ), { timeout: 15_000, intervals: [ 50 ] } ).toBeLessThan( 10.9 );
		await page.screenshot( { path: `${ OUT }/terminal-gangway.png` } );

	} );
	await test.step( 'Then "Aboard the Tidewater Spirit" shows', async () => {

		await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible( { timeout: 15_000 } );
		await page.keyboard.up( 'w' );

	} );
	await test.step( 'And from the beach the terminal stands across the water with her alongside', async () => {

		// look only: the free camera posed on the beach, facing the terminal
		await page.evaluate( () => {

			const app = window.__app, eye = new app.camera.position.constructor( 150, 0, - 30 );
			const at = app.terminal ? app.terminal.toWorld( [ 30, 6, - 20 ] ) : app.ferry.ship.position;
			eye.y = Math.max( 0, app.terrainData.heightAt( eye.x, eye.z ) ) + 6;
			app.setFreeCam( true );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), - 0.02 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 2_000 );
		await page.screenshot( { path: `${ OUT }/terminal-from-beach.png` } );

	} );

} );

test( 'Choosing the ferry terminal as the start puts the car in the marshalling lanes, facing the ferry', async ( { page } ) => {

	const telemetry = page.getByRole( 'status', { name: 'Rally telemetry' } );
	const value = async key => Number( await telemetry.getAttribute( `data-${ key }` ) );
	await test.step( 'Given a solo player on the real island in the Aster RS', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();

	} );
	await test.step( 'When the driver chooses the ferry terminal', async () => {

		await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Ferry terminal' } );

	} );
	await test.step( 'Then the car stands on its wheels in the lanes behind the linkspan, facing the ferry', async () => {

		await expect.poll( () => value( 'grounded' ), { timeout: 20_000 } ).toBe( 4 );
		const where = await page.evaluate( () => {

			const app = window.__app, V = app.camera.position.constructor;
			const car = new V( Number( document.querySelector( '[aria-label="Rally telemetry"]' ).dataset.x ), 0, Number( document.querySelector( '[aria-label="Rally telemetry"]' ).dataset.z ) );
			const local = app.ferry.ship.toLocal( car, new V() );
			const t = document.querySelector( '[aria-label="Rally telemetry"]' ).dataset, bow = app.ferry.ship.forward( new V() );
			return { across: local.x, aft: local.z, facing: Number( t.forwardX ) * bow.x + Number( t.forwardZ ) * bow.z };

		} );
		// The lanes run straight astern of her ramp: within a lane width or two of her centreline,
		// from the boom gate (84 m behind her stern ramp hinge) to the linkspan (28 m); her origin
		// is 25.2 m forward of the hinge.
		expect( Math.abs( where.across ) ).toBeLessThan( 12 );
		expect( where.aft ).toBeLessThan( - 25.2 - 28 );
		expect( where.aft ).toBeGreaterThan( - 25.2 - 84 );
		expect( where.facing ).toBeGreaterThan( 0.95 );
		// the lanes are paved: the surface chip reads asphalt, not boardwalk
		await expect( page.locator( '[data-chip="surface"]' ) ).toHaveAttribute( 'data-kind', 'asphalt' );
		await page.screenshot( { path: `${ OUT }/terminal-car-start.png` } );

	} );

} );

// ---------------------------------------------------------------- driving aboard

const helm = page => page.getByRole( 'status', { name: 'Ferry helm' } );
const telemetryOf = page => page.getByRole( 'status', { name: 'Rally telemetry' } );

const OUT = process.env.PW_OUT || 'test-results';

async function openIsland( page, query = '' ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=0.5&noAudio${ query }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// Dropped from the free camera onto her sun deck, the player walks forward to the wheel and takes it.
async function takeHerHelm( page ) {

	await page.evaluate( () => {

		const app = window.__app, ship = app.ferry.ship;
		app.setFreeCam( true );
		app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 0, 12.6, 3 ) ), ship.yaw + Math.PI, - 0.05 );
		app.fly.velocity.set( 0, 0, 0 );

	} );
	await page.waitForTimeout( 500 );
	await page.keyboard.press( 'f' );
	await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
	await page.keyboard.down( 'ShiftLeft' ); await page.keyboard.down( 'w' );
	await expect( page.getByText( 'Take the helm', { exact: true } ) ).toBeVisible( { timeout: 20_000 } );
	await page.keyboard.up( 'w' ); await page.keyboard.up( 'ShiftLeft' );
	await page.keyboard.press( 'e' );
	await expect( helm( page ) ).toBeVisible();

}

// The car in her frame (x to port, z to her bow, y up from her waterline), its speed and heading.
const carInHerFrame = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, ship = app.ferry.ship, V = app.camera.position.constructor;
	const at = new V( s[ 0 ], s[ 1 ], s[ 2 ] ), p = ship.toLocal( at, new V() );
	const nose = ship.toLocal( at.clone().add( new V( 0, 0, 1 ).applyQuaternion( new ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] ) ) ), new V() ).sub( p );
	return { x: p.x, y: p.y, z: p.z, kmh: Math.abs( s[ 7 ] ), heading: Math.atan2( nose.x, nose.z ) };

} );

// The player's hands: W held (or not), A/D tapped to hold her centreline, until `done`.
async function driveDownTheLanes( page, { until, throttle = true, timeout = 40_000 } ) {

	const started = Date.now();
	let steer = null, car = await carInHerFrame( page );
	if ( throttle ) await page.keyboard.down( 'w' );
	const track = [];
	while ( ! until( car ) && Date.now() - started < timeout ) {

		const err = Math.atan2( - car.x, 18 ) - car.heading;
		const want = err > 0.03 ? 'a' : err < - 0.03 ? 'd' : null;
		if ( want !== steer ) { if ( steer ) await page.keyboard.up( steer ); if ( want ) await page.keyboard.down( want ); steer = want; }
		await page.waitForTimeout( 50 );
		car = await carInHerFrame( page );
		track.push( car );

	}
	if ( steer ) await page.keyboard.up( steer );
	if ( throttle ) await page.keyboard.up( 'w' );
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

// Off the start screen and away from the car the dock is hidden on foot: the player summons
// it with the "get me a car" key (Backquote), as a player on her deck would.
async function summonTheDock( page ) {

	await page.keyboard.press( 'Backquote' );
	await expect( page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ) ).toBeVisible();

}

async function startAtTheTerminal( page ) {

	await summonTheDock( page );
	await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Ferry terminal' } );
	await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );

}

test( 'Driving aboard: with her ramp lowered from the helm, the player drives from the lanes over the linkspan onto her vehicle deck', async ( { page } ) => {

	test.setTimeout( 240_000 );
	// her timetable on: the traffic gives way to the player's car and no car starts aboard while it is on the move
	await test.step( 'Given a solo player on the real island with the ferry made fast at the terminal', async () => {

		await openIsland( page );

	} );
	await test.step( 'And the player at her helm lowers her stern ramp with R', async () => {

		await takeHerHelm( page );
		await expect( helm( page ).locator( '.fy-lines' ) ).toHaveText( 'On' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Up' );
		await page.keyboard.press( 'r' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Lowering' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Down', { timeout: 20_000 } );
		// Where her flap tips land, measured off the ramp mesh (terminal frame, yaw 0).
		const fit = await page.evaluate( () => {

			const app = window.__app, o = app.terminal.position, V = app.camera.position.constructor, v = new V();
			let tip = Infinity, hinge = - Infinity;
			const points = [];
			app.ferry.parts.ramp.traverse( m => {

				const pos = m.isMesh && m.geometry.attributes.position;
				if ( ! pos ) return;
				for ( let i = 0; i < pos.count; i ++ ) { v.fromBufferAttribute( pos, i ).applyMatrix4( m.matrixWorld ); points.push( [ v.y - o.y, v.z - o.z ] ); }

			} );
			for ( const [ , z ] of points ) { tip = Math.min( tip, z ); hinge = Math.max( hinge, z ); }
			const underTip = Math.min( ...points.filter( ( [ , z ] ) => z < tip + 0.2 ).map( ( [ y ] ) => y ) );
			return { tip: tip.toFixed( 3 ), underTip: underTip.toFixed( 3 ), hinge: hinge.toFixed( 3 ) };

		} );
		console.log( `ramp down: flap tips at terminal z ${ fit.tip }, their underside at y ${ fit.underTip } (plate top 2.10, z -8.85 .. -7.05); hinge end z ${ fit.hinge }` );
		await page.screenshot( { path: `${ OUT }/ferry-helm-ramp-down.png` } );

	} );
	await test.step( 'And leaves the helm with E and starts the Aster RS at the ferry terminal', async () => {

		await page.keyboard.press( 'e' );
		await expect( helm( page ) ).toBeHidden();
		await startAtTheTerminal( page );

	} );
	await test.step( 'When the player holds W down the lanes to the linkspan, coasts down it and over her ramp, and brakes aboard', async () => {

		await driveDownTheLanes( page, { until: car => car.z > - 58 } );
		await driveDownTheLanes( page, { until: car => car.z > - 22, throttle: false } );
		await page.keyboard.down( 's' );
		await expect.poll( async () => ( await carInHerFrame( page ) ).kmh, { timeout: 15_000, intervals: [ 100 ] } ).toBeLessThan( 1 );
		await page.keyboard.up( 's' );

	} );
	await test.step( 'Then the car rests on her vehicle deck, on all four wheels', async () => {

		await page.waitForTimeout( 1_000 );
		await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 5_000 } ).toBe( 4 );
		const car = await carInHerFrame( page );
		console.log( `car aboard at her x ${ car.x.toFixed( 2 ) }, z ${ car.z.toFixed( 2 ) }, y ${ car.y.toFixed( 3 ) }` );
		expect( Math.abs( car.x ) ).toBeLessThan( 6.6 );
		expect( car.z ).toBeGreaterThan( - 25 );
		expect( car.z ).toBeLessThan( 18 );
		expect( Math.abs( car.y - 2.6 ) ).toBeLessThan( 0.3 );
		await page.screenshot( { path: `${ OUT }/terminal-car-aboard.png` } );

	} );
	await test.step( 'And from beside her stern the ramp lies on the linkspan plate', async () => {

		// look only: the free camera posed off her starboard quarter
		await page.evaluate( () => {

			const app = window.__app, eye = app.terminal.toWorld( [ - 13, 14, - 17 ] ), at = app.terminal.toWorld( [ 0, 2.3, - 3 ] );
			app.setFreeCam( true );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), - 0.5 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 1_500 );
		await page.screenshot( { path: `${ OUT }/terminal-ramp-down.png` } );

	} );

} );

test( 'With her ramp up, a car driven down the linkspan stops at the linkspan barrier and never reaches her vehicle deck', async ( { page } ) => {

	test.setTimeout( 180_000 );
	await test.step( 'Given a solo player on the real island with the ferry made fast and her ramp up', async () => {

		await openIsland( page );
		// (the helm readout is hidden with no one at the helm; its state is kept current regardless)
		const state = page.locator( '[aria-label="Ferry helm"]' );
		expect( await state.getAttribute( 'data-lines' ) ).toBe( 'on' );
		expect( Number( await state.getAttribute( 'data-ramp' ) ) ).toBe( 0 );

	} );
	await test.step( 'And the player starts the Aster RS at the ferry terminal', async () => {

		await startAtTheTerminal( page );

	} );
	let run;
	await test.step( 'When the player holds W down the lanes and on down the linkspan toward her stern', async () => {

		run = await driveDownTheLanes( page, { until: car => car.z > - 24 || ( car.z > - 40 && car.kmh < 2 ), timeout: 30_000 } );
		await page.waitForTimeout( 3_000 );
		run.track.push( await carInHerFrame( page ) );

	} );
	await test.step( 'Then the car stops at the linkspan barrier, short of her stern, and never gets onto her deck', async () => {

		const furthest = Math.max( ...run.track.map( c => c.z ) );
		const aboard = run.track.filter( c => c.z > - 25.2 && c.y > 2.3 ).length;
		const end = run.track[ run.track.length - 1 ];
		console.log( `ramp up: furthest z ${ furthest.toFixed( 2 ) }, ended at z ${ end.z.toFixed( 2 ) } y ${ end.y.toFixed( 2 ) }` );
		expect( furthest ).toBeLessThan( - 25.2 );
		expect( aboard ).toBe( 0 );
		await page.screenshot( { path: `${ OUT }/terminal-ramp-up-stop.png` } );

	} );

} );

// ---------------------------------------------------------------- the check-in boom gate

// The car in the terminal's frame (x to the left looking out to sea, z out to sea, y up from sea
// level), its speed and heading, and how far the check-in boom is lifted (0 down .. 1 up).
const carAtCheckIn = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, t = app.terminal;
	const c = Math.cos( t.yaw ), n = Math.sin( t.yaw ), dx = s[ 0 ] - t.position.x, dz = s[ 2 ] - t.position.z;
	const q = new app.ferry.ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] );
	const nose = new app.camera.position.constructor( 0, 0, 1 ).applyQuaternion( q );
	return { x: dx * c - dz * n, y: s[ 1 ], z: dx * n + dz * c, kmh: Math.abs( s[ 7 ] ), heading: Math.atan2( nose.x * c - nose.z * n, nose.x * n + nose.z * c ), boom: t.boomLift ?? 0 };

} );

// The boom spans the lane to the left of the booth, 83.7 m behind the linkspan hinge; the lane's
// centre is 3.2 m left of the booth's.
const GATE_Z = - 83.7, GATE_LANE = - 3.2;

// Given: the car on the yard's approach, in the gated lane, facing the gate.
async function carOnTheApproach( page, back = 24 ) {

	await page.evaluate( ( [ x, z ] ) => {

		const app = window.__app, t = app.terminal;
		const p = t.toWorld( [ x, 3.2, z ] );
		app.rally.place( { x: p.x, z: p.z, yaw: t.yaw } );

	}, [ GATE_LANE, GATE_Z - back ] );
	await expect.poll( async () => Number( await telemetryOf( page ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );
	await page.waitForTimeout( 800 );

}

// The player's hands up the gated lane: W held, or feathered to stay under `maxKmh`; A/D tapped to
// hold the lane's centre line.
async function driveUpTheLane( page, { until, maxKmh = Infinity, timeout = 30_000 } ) {

	const started = Date.now();
	let steer = null, gas = false, car = await carAtCheckIn( page );
	const track = [];
	while ( ! until( car ) && Date.now() - started < timeout ) {

		const want = car.kmh < maxKmh;
		if ( want !== gas ) { if ( want ) await page.keyboard.down( 'w' ); else await page.keyboard.up( 'w' ); gas = want; }
		const err = Math.atan2( - ( car.x - GATE_LANE ), 12 ) - car.heading;
		const turn = err > 0.03 ? 'a' : err < - 0.03 ? 'd' : null;
		if ( turn !== steer ) { if ( steer ) await page.keyboard.up( steer ); if ( turn ) await page.keyboard.down( turn ); steer = turn; }
		await page.waitForTimeout( 50 );
		car = await carAtCheckIn( page );
		track.push( car );

	}
	if ( steer ) await page.keyboard.up( steer );
	if ( gas ) await page.keyboard.up( 'w' );
	return { car, track };

}

test( 'A car driven hard at the check-in boom gate stops against the arm instead of passing through it', async ( { page } ) => {

	test.setTimeout( 150_000 );
	await test.step( 'Given a solo player in the Aster RS on the yard approach, 24 m short of the lowered check-in boom', async () => {

		await openIsland( page );
		await startAtTheTerminal( page );
		await carOnTheApproach( page );
		expect( ( await carAtCheckIn( page ) ).boom ).toBe( 0 );

	} );
	let run;
	await test.step( 'When the player floors it straight at the boom', async () => {

		// (off the gas once the car has come to rest near the arm, or is through)
		let flying = false;
		run = await driveUpTheLane( page, { until: car => car.z > GATE_Z + 6 || ( flying = flying || car.kmh > 25, flying && car.kmh < 3 && car.z > GATE_Z - 10 ), timeout: 8_000 } );
		run.track.push( await carAtCheckIn( page ) );

	} );
	await test.step( 'Then the car hits the arm at speed and stops short of it: it never gets through the gate', async () => {

		const furthest = Math.max( ...run.track.map( c => c.z ) );
		const fastest = Math.max( ...run.track.filter( c => c.z > GATE_Z - 10 ).map( c => c.kmh ) );
		console.log( `boom gate, flat out: furthest z ${ furthest.toFixed( 2 ) }, ${ fastest.toFixed( 0 ) } km/h near the arm; ${ run.track.filter( c => c.z > GATE_Z - 8 ).map( c => `${ c.z.toFixed( 1 ) }@${ c.kmh.toFixed( 0 ) }/${ c.boom.toFixed( 1 ) }` ).join( ' ' ) }` );
		expect( fastest ).toBeGreaterThan( 25 );
		expect( furthest ).toBeLessThan( GATE_Z - 1.2 );
		await page.screenshot( { path: `${ OUT }/terminal-boom-stop.png` } );

	} );

} );

test( 'Rolling up slowly to the check-in, the boom lifts, the car drives through into the lanes and the boom comes down behind it', async ( { page } ) => {

	test.setTimeout( 150_000 );
	await test.step( 'Given a solo player in the Aster RS on the yard approach, 24 m short of the lowered check-in boom', async () => {

		await openIsland( page );
		await startAtTheTerminal( page );
		await carOnTheApproach( page );
		expect( ( await carAtCheckIn( page ) ).boom ).toBe( 0 );

	} );
	let run;
	await test.step( 'When the player creeps up the lane under 15 km/h and on past the booth', async () => {

		run = await driveUpTheLane( page, { maxKmh: 15, until: car => car.z > GATE_Z + 9, timeout: 30_000 } );

	} );
	await test.step( 'Then the boom was up as the car went under it, and the car is through into the lanes', async () => {

		const under = run.track.filter( c => Math.abs( c.z - GATE_Z ) < 2.5 );
		console.log( `boom gate, creeping: ended z ${ run.car.z.toFixed( 2 ) }, boom under the car ${ under.map( c => c.boom.toFixed( 2 ) ).join( ' ' ) }` );
		expect( run.car.z ).toBeGreaterThan( GATE_Z + 9 );
		expect( under.length ).toBeGreaterThan( 0 );
		expect( Math.min( ...under.map( c => c.boom ) ) ).toBeGreaterThan( 0.9 );
		await page.screenshot( { path: `${ OUT }/terminal-boom-through.png` } );

	} );
	await test.step( 'And once the car is clear, the boom comes back down', async () => {

		await expect.poll( async () => ( await carAtCheckIn( page ) ).boom, { timeout: 12_000 } ).toBe( 0 );

	} );

} );

test( 'Driving off: with her ramp down, a car parked on her deck backs off her stern, down the ramp and the linkspan onto the terminal', async ( { page } ) => {

	test.setTimeout( 300_000 );
	await test.step( 'Given the Aster RS driven aboard over her lowered ramp and stopped on her deck', async () => {

		await openIsland( page );
		await takeHerHelm( page );
		await page.keyboard.press( 'r' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Down', { timeout: 20_000 } );
		await page.keyboard.press( 'e' );
		await expect( helm( page ) ).toBeHidden();
		await startAtTheTerminal( page );
		await driveDownTheLanes( page, { until: car => car.z > - 58 } );
		await driveDownTheLanes( page, { until: car => car.z > - 22, throttle: false } );
		// parked a little askew, the way a driver leaves it
		// (the wheel straightened before S stops the car and turns into reverse, or it backs round on full lock)
		await page.keyboard.down( process.env.PARK_SIDE || 'd' ); await page.keyboard.down( 's' );
		await expect.poll( async () => Math.abs( ( await carInHerFrame( page ) ).kmh ), { timeout: 15_000, intervals: [ 50 ] } ).toBeLessThan( 5 );
		await page.keyboard.up( process.env.PARK_SIDE || 'd' );
		await expect.poll( async () => Math.abs( ( await carInHerFrame( page ) ).kmh ), { timeout: 15_000, intervals: [ 100 ] } ).toBeLessThan( 1 );
		await page.keyboard.up( 's' );
		await page.waitForTimeout( 1_500 );
		console.log( `parked at her x ${ ( await carInHerFrame( page ) ).x.toFixed( 2 ) }, heading ${ ( await carInHerFrame( page ) ).heading.toFixed( 3 ) }` );

	} );
	let track;
	await test.step( 'When the player holds S', async () => {

		( { track } = await backOff( page, { until: car => car.z < - 62 } ) );

	} );
	await test.step( 'Then the car backs off her stern, down the ramp and up the linkspan onto the terminal', async () => {

		const car = await carInHerFrame( page );
		const stuck = track.filter( c => c.z > - 27 && c.z < - 21 && c.kmh < 0.5 ).length;
		console.log( `backing off: car at her x ${ car.x.toFixed( 2 ) }, z ${ car.z.toFixed( 2 ) }, y ${ car.y.toFixed( 2 ) }, max |x| ${ Math.max( ...track.map( c => Math.abs( c.x ) ) ).toFixed( 2 ) }; ${ stuck } samples stopped at her stern; min z ${ Math.min( ...track.map( c => c.z ) ).toFixed( 2 ) }` );
		await page.screenshot( { path: `${ OUT }/terminal-car-backing-off.png` } );
		expect( car.z ).toBeLessThan( - 55 );
		expect( car.y ).toBeGreaterThan( 2.9 );

	} );

} );

test( 'From the car deck, a player walks through the stair door and up the stairs to the passenger corridor', async ( { page } ) => {

	test.setTimeout( 240_000 );
	// Where the player stands in her frame (x to port, y up from her waterline, z to her bow).
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
	await test.step( 'When the player walks through the door and up the stairs toward her bow', async () => {

		await page.keyboard.down( 'w' );
		await expect.poll( async () => ( await aboard() ).x, { timeout: 10_000 } ).toBeGreaterThan( 6.9 );
		await page.keyboard.up( 'w' );
		await page.screenshot( { path: `${ OUT }/ferry-stairwell-foot.png` } );
		// facing outboard, D steps her way toward the bow: up the flight
		await page.keyboard.down( 'd' );
		await expect.poll( async () => ( await aboard() ).y, { timeout: 20_000 } ).toBeGreaterThan( 6.9 );
		await page.keyboard.up( 'd' );

	} );
	await test.step( 'Then the player stands in the passenger corridor on her passenger deck, still aboard', async () => {

		const at = await aboard();
		console.log( `after the stairs: ${ JSON.stringify( at ) }` );
		expect( at.mode ).toBe( 'ferry' );
		expect( Math.abs( at.y - 7.0 ) ).toBeLessThan( 0.15 );
		expect( at.x ).toBeGreaterThan( 6.6 );
		expect( at.x ).toBeLessThan( 8.9 );
		await page.screenshot( { path: `${ OUT }/ferry-stairs-corridor.png` } );

	} );

} );

test( 'From her promenade deck, a player climbs the outside stairs to her top deck and walks aft to her stern rail', async ( { page } ) => {

	test.setTimeout( 240_000 );
	// Where the player stands in her frame (x to port, y up from her waterline, z to her bow).
	const aboard = () => page.evaluate( () => {

		const app = window.__app, p = app.ferry.deck.local;
		return { mode: app.player.mode, x: p.x, y: p.y, z: p.z };

	} );
	await test.step( 'Given a solo player on the real island with the ferry made fast at the terminal', async () => {

		await openIsland( page );

	} );
	await test.step( 'And the player is dropped from the free camera onto the after end of her port promenade, at the foot of the outside stairs, facing her bow', async () => {

		await page.evaluate( () => {

			const app = window.__app, ship = app.ferry.ship;
			app.setFreeCam( true );
			app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 7.25, 8.8, - 21.2 ) ), ship.yaw + Math.PI, - 0.1 );
			app.fly.velocity.set( 0, 0, 0 );

		} );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
		await expect.poll( async () => ( await aboard() ).y, { timeout: 5_000 } ).toBeLessThan( 7.2 );

	} );
	await test.step( 'When the player walks up the stairs and out of the stair house door onto her top deck', async () => {

		// (off W a pace through the door, clear of its jambs)
		await page.keyboard.down( 'w' );
		await expect.poll( async () => ( await aboard() ).z, { timeout: 15_000, intervals: [ 50 ] } ).toBeGreaterThan( - 14.0 );
		await page.keyboard.up( 'w' );

	} );
	await test.step( 'Then the player stands on her top deck', async () => {

		const at = await aboard();
		console.log( `top of the outside stairs: x ${ at.x.toFixed( 2 ) }, y ${ at.y.toFixed( 2 ) }, z ${ at.z.toFixed( 2 ) }` );
		expect( at.mode ).toBe( 'ferry' );
		expect( at.y ).toBeCloseTo( 10.0, 1 );

	} );
	await test.step( 'When the player steps outboard of the stair house and backs aft along her top deck to the stern rail', async () => {

		await page.keyboard.down( 'a' );
		await expect.poll( async () => ( await aboard() ).x, { timeout: 5_000, intervals: [ 50 ] } ).toBeGreaterThan( 8.3 );
		await page.keyboard.up( 'a' );
		await page.keyboard.down( 's' );
		await expect.poll( async () => ( await aboard() ).z, { timeout: 15_000 } ).toBeLessThan( - 23.5 );
		await page.keyboard.up( 's' );

	} );
	await test.step( 'Then the player is out on the open after end of her top deck, at her stern', async () => {

		const at = await aboard();
		console.log( `stern rail: x ${ at.x.toFixed( 2 ) }, y ${ at.y.toFixed( 2 ) }, z ${ at.z.toFixed( 2 ) }` );
		expect( at.y ).toBeCloseTo( 10.0, 1 );
		expect( at.z ).toBeLessThan( - 23.5 );
		await page.screenshot( { path: `${ OUT }/ferry-top-deck-stern.png` } );

	} );

} );

test( 'With her stern ramp lowered, nothing of hers hangs in the air over the ramp entry that a driver goes through', async ( { page } ) => {

	test.setTimeout( 180_000 );
	await test.step( 'Given a solo player on the real island with the ferry made fast at the terminal', async () => {

		await openIsland( page );

	} );
	await test.step( 'When the player at her helm lowers her stern ramp', async () => {

		await takeHerHelm( page );
		await page.keyboard.press( 'r' );
		await expect( helm( page ).locator( '.fy-ramp' ) ).toHaveText( 'Down', { timeout: 20_000 } );

	} );
	await test.step( 'Then no part of her model sits in the clear space a car drives through at her stern opening', async () => {

		// the opening: across her ramp (|x| < 4.8), from 0.3 m over her car deck to 3.5 m, and 3 m either
		// side of the hinge line (z -25.2); the ramp itself (and its side rails) is left out
		const inside = await page.evaluate( () => {

			const app = window.__app, ship = app.ferry.ship, V = app.camera.position.constructor, v = new V(), l = new V();
			const found = [], ramp = new Set();
			app.ferry.parts.ramp?.traverse( o => ramp.add( o ) );
			app.ferry.root.traverse( o => {

				const pos = o.isMesh && ! ramp.has( o ) && o.geometry?.attributes?.position;
				if ( ! pos ) return;
				o.updateMatrixWorld();
				for ( let i = 0; i < pos.count; i ++ ) {

					ship.toLocal( v.fromBufferAttribute( pos, i ).applyMatrix4( o.matrixWorld ), l );
					if ( Math.abs( l.x ) < 4.8 && l.y > 2.9 && l.y < 6.1 && l.z > - 28.2 && l.z < - 22.2 ) { found.push( `${ o.parent?.name }/${ o.name } at ${ l.x.toFixed( 2 ) }, ${ l.y.toFixed( 2 ) }, ${ l.z.toFixed( 2 ) }` ); return; }

				}

			} );
			return found;

		} );
		console.log( `in the stern opening: ${ inside.length ? inside.join( '; ' ) : 'nothing' }` );
		expect( inside ).toEqual( [] );

	} );

} );
