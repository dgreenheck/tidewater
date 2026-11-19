import { test, expect } from '@playwright/test';

// Given/When/Then on the real island: other people's cars and foot passengers on the ferry
// service (src/ferry/Traffic.js, src/ferry/Crowd.js), read through their read-only state() in her
// frame. Only the free camera is posed from the test (the F-key camera a player flies by hand);
// the walk up to a passenger is the player's own keys.
const OUT = process.env.PW_OUT || 'test-results';
const start = async ( page, qs = '' ) => {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=0.5&noAudio${ qs }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

};
const cars = page => page.evaluate( () => window.__app.ferry.traffic?.state() ?? [] );
const people = page => page.evaluate( () => window.__app.ferry.crowd?.state().people ?? [] );
// The free camera at p in her frame ('ship') or the terminal's, facing `turn` off that frame's +z (look only).
const look = ( page, frame, p, turn = 0, pitch = - 0.15 ) => page.evaluate( ( [ frame, p, turn, pitch ] ) => {

	const app = window.__app, V = app.camera.position.constructor, ship = app.ferry.ship;
	const w = frame === 'ship' ? ship.toWorld( new V( ...p ) ) : app.terminal.toWorld( p );
	app.setFreeCam( true );
	app.fly.setPose( w, ( frame === 'ship' ? ship.yaw : app.terminal.yaw ) + turn + Math.PI, pitch );
	app.fly.velocity.set( 0, 0, 0 );

}, [ frame, p, turn, pitch ] );
const frameTime = page => page.evaluate( () => {

	const app = window.__app, people = app.ferry.crowd.state().people;
	return { fps: app.fps, frameMs: 1000 / app.fps, trafficAndCrowdMs: app.ferry.peopleMs, cars: app.ferry.traffic.state().length, people: people.length, drawn: app.scene.children.filter( c => /^Crowd:|^TrafficCar:/.test( c.name ) && c.visible ).length };

} );

test( 'At the Tidewater terminal during loading, other cars queue, drive aboard and park on her deck, and foot passengers walk over the gangway into her', async ( { page } ) => {

	test.setTimeout( 420_000 );
	await test.step( 'Given a solo player on the real island with the ferry on her timetable at Tidewater', async () => {

		await start( page, '&ferryTimetable=short' );

	} );
	await test.step( 'And other cars wait in the marshalling lanes and foot passengers at the gangway gate', async () => {

		await expect.poll( async () => ( await cars( page ) ).filter( c => c.terminal === 'tidewater' && c.state === 'queue' ).length, { timeout: 30_000 } ).toBeGreaterThanOrEqual( 6 );
		await expect.poll( async () => ( await people( page ) ).filter( p => p.terminal === 'tidewater' && p.kind === 'foot' ).length, { timeout: 90_000 } ).toBeGreaterThanOrEqual( 4 );

	} );
	await test.step( 'When her ramp is down and she loads, the cars drive aboard nose to tail', async () => {

		await expect.poll( async () => ( await cars( page ) ).filter( c => c.state === 'board' ).length, { timeout: 90_000, intervals: [ 500 ] } ).toBeGreaterThanOrEqual( 2 );
		await look( page, 'terminal', [ - 16, 16, - 66 ], 0.42, - 0.3 );
		await page.waitForTimeout( 1_500 );
		console.log( 'frame time at the busy moment (loading at Tidewater):', JSON.stringify( await frameTime( page ) ) );
		await page.screenshot( { path: `${ OUT }/crowd-terminal.png` } );

	} );
	await test.step( 'Then they park on her deck in the outer lanes, her centre lane clear', async () => {

		await expect.poll( async () => ( await cars( page ) ).filter( c => c.state === 'parked' ).length, { timeout: 200_000, intervals: [ 1_000 ] } ).toBeGreaterThanOrEqual( 6 );
		const parked = ( await cars( page ) ).filter( c => c.state === 'parked' );
		console.log( 'parked in her frame:', JSON.stringify( parked.map( c => [ c.model, ...c.local ] ) ) );
		for ( const { local: [ x, y, z ] } of parked ) {

			expect( Math.abs( x ) ).toBeGreaterThan( 3 );
			expect( Math.abs( x ) ).toBeLessThan( 5.6 );
			expect( Math.abs( y - 2.6 ) ).toBeLessThan( 0.3 );
			expect( z ).toBeGreaterThan( - 25.2 );
			expect( z ).toBeLessThan( 18.6 );

		}
		await look( page, 'ship', [ 0, 5.4, - 23.5 ], 0, - 0.2 );
		await page.waitForTimeout( 1_000 );
		await page.screenshot( { path: `${ OUT }/crowd-cardeck.png` } );

	} );
	await test.step( 'And foot passengers have walked over the gangway into her', async () => {

		await expect.poll( async () => ( await people( page ) ).filter( p => p.kind === 'foot' && p.aboard && p.local[ 1 ] > 6.5 && p.local[ 1 ] < 10.8 && Math.abs( p.local[ 0 ] ) < 9.4 ).length, { timeout: 60_000 } ).toBeGreaterThanOrEqual( 3 );
		await expect.poll( async () => ( await people( page ) ).filter( p => p.state === 'seated' ).length, { timeout: 60_000 } ).toBeGreaterThanOrEqual( 2 );
		await look( page, 'ship', [ 0, 8.7, 0.8 ], 0, - 0.25 );
		await page.waitForTimeout( 1_000 );
		await page.screenshot( { path: `${ OUT }/crowd-saloon.png` } );

	} );

} );

test( 'A foot passenger greets the player', async ( { page } ) => {

	test.setTimeout( 240_000 );
	await test.step( 'Given a solo player on the real island with the ferry made fast at Tidewater and passengers waiting at the gangway gate', async () => {

		await start( page, '&ferryService=off' );
		await expect.poll( async () => ( await people( page ) ).filter( p => p.state === 'queue' && p.world[ 2 ] ).length, { timeout: 90_000 } ).toBeGreaterThanOrEqual( 2 );

	} );
	await test.step( 'When the player drops onto the covered walkway facing the queue and walks up to it', async () => {

		await look( page, 'terminal', [ 14.6, 8.7, 10.2 ], Math.PI, - 0.1 );
		await page.waitForTimeout( 500 );
		await page.keyboard.press( 'f' );
		await page.waitForTimeout( 1_000 );
		await page.keyboard.down( 'w' );
		await expect.poll( () => page.evaluate( () => {

			const app = window.__app, p = app.player.position;
			return Math.min( ...app.ferry.crowd.state().people.map( q => Math.hypot( q.world[ 0 ] - p.x, q.world[ 2 ] - p.z ) ) );

		} ), { timeout: 10_000, intervals: [ 50 ] } ).toBeLessThan( 2.4 );
		await page.keyboard.up( 'w' );

	} );
	await test.step( 'Then the nearest passenger turns to the player and waves or nods', async () => {

		await expect.poll( async () => ( await people( page ) ).filter( p => [ 'wave_01', 'gestic_listen_accept_01' ].includes( p.clip ) && p.greeted === p.clip ).length, { timeout: 5_000, intervals: [ 100 ] } ).toBeGreaterThanOrEqual( 1 );
		await page.waitForTimeout( 1_200 );
		await page.screenshot( { path: `${ OUT }/crowd-greeting.png` } );

	} );
	await test.step( 'And if the player lingers, talks with the hands or points', async () => {

		await expect.poll( async () => ( await people( page ) ).filter( p => [ 'gestic_talk_neutral_01', 'gestic_presentation_right_01' ].includes( p.greeted ) ).length, { timeout: 20_000, intervals: [ 250 ] } ).toBeGreaterThanOrEqual( 1 );

	} );

} );

// The player's Aster RS, started at the ferry terminal from the menu.
const driveFromTheTerminal = async page => {

	await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	await page.getByLabel( 'Start at', { exact: true } ).selectOption( { label: 'Ferry terminal' } );
	await expect.poll( async () => Number( await page.locator( '[aria-label="Rally telemetry"]' ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );

};
// The player's car in the terminal's frame (x across the lanes, z toward her linkspan), and its speed.
const inTheLanes = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, t = app.terminal;
	const c = Math.cos( t.yaw ), n = Math.sin( t.yaw ), dx = s[ 0 ] - t.position.x, dz = s[ 2 ] - t.position.z;
	return { x: dx * c - dz * n, y: s[ 1 ], z: dx * n + dz * c, kmh: Math.abs( s[ 7 ] ) };

} );
// The player's car in her frame (x to port, z to her bow), its speed and heading.
const inHerFrame = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, ship = app.ferry.ship, V = app.camera.position.constructor;
	const at = new V( s[ 0 ], s[ 1 ], s[ 2 ] ), p = ship.toLocal( at, new V() );
	const nose = ship.toLocal( at.clone().add( new V( 0, 0, 1 ).applyQuaternion( new ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] ) ) ), new V() ).sub( p );
	return { x: p.x, y: p.y, z: p.z, kmh: Math.abs( s[ 7 ] ), heading: Math.atan2( nose.x, nose.z ) };

} );
test( "A player's car driven into a queued traffic car stops against it instead of passing through", async ( { page } ) => {

	test.setTimeout( 240_000 );
	let target;
	await test.step( 'Given a solo player in the Aster RS at the Tidewater terminal, with other cars queued in the marshalling lanes', async () => {

		await start( page, '&ferryService=off' );
		await driveFromTheTerminal( page );
		await expect.poll( async () => ( await cars( page ) ).filter( c => c.terminal === 'tidewater' && c.state === 'queue' ).length, { timeout: 30_000 } ).toBeGreaterThanOrEqual( 6 );

	} );
	await test.step( 'And the Aster stands 11 m behind the last car queued in the right-hand lane, in the same lane, facing it', async () => {

		// the last queued car in the lane at x 4.0 (terminal frame), and its model's length fore and aft of its origin
		target = await page.evaluate( () => {

			const app = window.__app, t = app.terminal, traffic = app.ferry.traffic;
			const lane = traffic.cars.filter( c => c.terminal === t && c.state === 'queue' && ! c.path && c.at[ 0 ] === 4.0 ).sort( ( a, b ) => a.at[ 2 ] - b.at[ 2 ] );
			const car = lane[ 0 ], boxes = {};
			for ( const [ name, parts ] of traffic.parts ) {

				const b = { min: [ Infinity, Infinity, Infinity ], max: [ - Infinity, - Infinity, - Infinity ] };
				for ( const m of parts ) {

					m.geometry.computeBoundingBox();
					const g = m.geometry.boundingBox;
					[ 'x', 'y', 'z' ].forEach( ( k, i ) => { b.min[ i ] = Math.min( b.min[ i ], g.min[ k ] ); b.max[ i ] = Math.max( b.max[ i ], g.max[ k ] ); } );

				}
				boxes[ name ] = { min: b.min.map( v => + v.toFixed( 2 ) ), max: b.max.map( v => + v.toFixed( 2 ) ) };

			}
			const p = t.toWorld( [ 4.0, 3.2, car.at[ 2 ] - 11 ] );
			app.rally.place( { x: p.x, z: p.z, yaw: t.yaw } );
			return { id: car.id, model: car.name, z: car.at[ 2 ], tail: car.at[ 2 ] + boxes[ car.name ].min[ 2 ], yard: p.y, boxes };

		} );
		await expect.poll( async () => Number( await page.locator( '[aria-label="Rally telemetry"]' ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );
		await page.waitForTimeout( 1_500 );
		const rest = await inTheLanes( page );
		console.log( `traffic models (group-local boxes): ${ JSON.stringify( target.boxes ) }` );
		console.log( `target ${ target.model } #${ target.id } at z ${ target.z }, tail z ${ target.tail.toFixed( 2 ) }; the Aster at rest: x ${ rest.x.toFixed( 2 ) } z ${ rest.z.toFixed( 2 ) }, origin ${ ( rest.y - target.yard ).toFixed( 3 ) } m above the yard` );
		expect( rest.z + 2.05 ).toBeLessThan( target.tail - 4 );

	} );
	const track = [];
	await test.step( 'When the player holds W straight at it', async () => {

		const started = Date.now();
		let car = await inTheLanes( page ), moving = false;
		await page.keyboard.down( 'w' );
		while ( Date.now() - started < 7_000 ) {

			await page.waitForTimeout( 50 );
			car = await inTheLanes( page );
			track.push( car );
			moving = moving || car.kmh > 8;
			if ( car.z + 2.05 > target.tail + 3 ) break;

		}
		await page.keyboard.up( 'w' );
		await page.waitForTimeout( 800 );
		track.push( await inTheLanes( page ) );

	} );
	await test.step( "Then the Aster stops against the traffic car: its nose never passes the other car's tail", async () => {

		const furthest = Math.max( ...track.map( c => c.z ) ), fastest = Math.max( ...track.map( c => c.kmh ) );
		console.log( `nose furthest z ${ ( furthest + 2.05 ).toFixed( 2 ) } against tail z ${ target.tail.toFixed( 2 ) }; ${ fastest.toFixed( 0 ) } km/h at most` );
		await page.screenshot( { path: `${ OUT }/crowd-traffic-solid.png` } );
		expect( fastest ).toBeGreaterThan( 8 );
		expect( furthest + 2.05 ).toBeLessThan( target.tail + 0.3 );
		// and it never rides up onto the other car
		const highest = Math.max( ...track.map( c => c.y ) ) - target.yard;
		console.log( `highest the Aster's origin rose above the yard: ${ highest.toFixed( 3 ) } m` );
		expect( highest ).toBeLessThan( 0.3 );
		const still = ( await cars( page ) ).find( c => c.id === target.id );
		expect( still.state ).toBe( 'queue' );

	} );

} );

test( "With the player's car parked aboard in the traffic's way, she still sails", async ( { page } ) => {

	test.setTimeout( 480_000 );
	const helm = page.locator( '[aria-label="Ferry helm"]' );
	// any script error over the loading cycle (a throw inside the ferry's frame skips her ramp and
	// platforms, which can strand cars; see Crowd.step's one-point path)
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	await test.step( 'Given a solo player in the Aster RS at the Tidewater terminal, with the ferry on her short timetable', async () => {

		await start( page, '&ferryTimetable=short' );
		await driveFromTheTerminal( page );

	} );
	let parked;
	await test.step( 'And the player has parked the Aster aboard her, moored with her ramp up, in her centre lane where boarding cars drive up it', async () => {

		// (placed like the menu's "Start at", but on her deck: rally.place drops onto the terrain)
		await page.evaluate( () => {

			const app = window.__app, ship = app.ferry.ship, p = ship.toWorld( new app.camera.position.constructor( 0, 2.6, - 15 ) );
			app.rally.physics.reset( p.x, p.y + 0.45, p.z, ship.yaw );

		} );
		await expect.poll( async () => Number( await page.locator( '[aria-label="Rally telemetry"]' ).getAttribute( 'data-grounded' ) ), { timeout: 20_000 } ).toBe( 4 );
		await page.waitForTimeout( 1_500 );
		parked = await inHerFrame( page );
		console.log( `parked in her frame: x ${ parked.x.toFixed( 2 ) } y ${ parked.y.toFixed( 2 ) } z ${ parked.z.toFixed( 2 ) } heading ${ parked.heading.toFixed( 2 ) }; ramp ${ await helm.getAttribute( 'data-ramp' ) }` );
		expect( Math.abs( parked.x ) ).toBeLessThan( 1.6 );
		expect( Math.abs( parked.y - 2.6 ) ).toBeLessThan( 0.3 );
		expect( Math.abs( parked.heading ) ).toBeLessThan( 0.2 );

	} );
	await test.step( 'When she lowers her ramp for loading and the queued cars start aboard', async () => {

		await expect.poll( async () => Number( await helm.getAttribute( 'data-ramp' ) ), { timeout: 150_000, intervals: [ 500 ] } ).toBe( 1 );
		await expect.poll( async () => ( await cars( page ) ).filter( c => c.state === 'board' ).length, { timeout: 30_000 } ).toBeGreaterThanOrEqual( 1 );

	} );
	await test.step( 'Then a boarding car held up behind it gives way, and she casts off from Tidewater all the same', async () => {

		const started = Date.now();
		let log = [];
		while ( await helm.getAttribute( 'data-berth' ) === 'tidewater' && Date.now() - started < 150_000 ) {

			await page.waitForTimeout( 2_000 );
			const c = await cars( page );
			log.push( `${ Math.round( ( Date.now() - started ) / 1000 ) }s ${ c.filter( k => [ 'board', 'back' ].includes( k.state ) ).map( k => `${ k.state }@${ k.local[ 2 ] }/${ k.v }` ).join( ',' ) } ramp ${ await helm.getAttribute( 'data-ramp' ) }` );

		}
		console.log( log.slice( - 12 ).join( '\n' ) );
		expect( await helm.getAttribute( 'data-berth' ) ).not.toBe( 'tidewater' );
		await page.screenshot( { path: `${ OUT }/crowd-traffic-sails.png` } );
		expect( errors, errors.join( '\n' ) ).toEqual( [] );

	} );
	await test.step( 'And the Aster has stayed where it was parked, riding with her, not shoved by the cars beside it', async () => {

		const now = await inHerFrame( page );
		console.log( `drift in her frame: ${ Math.hypot( now.x - parked.x, now.z - parked.z ).toFixed( 3 ) } m` );
		expect( Math.hypot( now.x - parked.x, now.z - parked.z ) ).toBeLessThan( 0.5 );

	} );

} );
