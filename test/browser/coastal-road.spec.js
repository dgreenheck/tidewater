import { test, expect } from '@playwright/test';
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, key ) => Number( await telemetry( page ).getAttribute( `data-${ key }` ) );
test.beforeEach( async ( { page } ) => {
	await test.step( 'Given the real island, road and original vehicle physics in an isolated session', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' ); await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( page.getByRole( 'dialog' ) ).toBeHidden();
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	} );
} );

test( 'The graded coastal loop supports a car on real asphalt with a continuous route', async ( { page } ) => {
	await test.step( 'When the driver chooses Coastal road', async () => { await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' ); } );
	await test.step( 'Then the car rests on the paved loop with a drivable grade', async () => {
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
		expect( await value( page, 'road-length' ) ).toBeGreaterThan( 280 );
		expect( await value( page, 'road-max-grade' ) ).toBeLessThan( 0.13 );
		await page.screenshot( { path: 'test-results/rally-coastal-road.png' } );
	} );
	const x = await value( page, 'x' );
	await test.step( 'When the player accelerates along the road', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 20 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then tyre contact moves the car along the visible asphalt', async () => {
		expect( await value( page, 'x' ) ).toBeGreaterThan( x + 3 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );
} );

test( 'The surface chip names what the tyres touch, even while the car drops onto the road', async ( { page } ) => {
	const chip = page.locator( '[data-chip="surface"]' );
	await test.step( 'Given the car at rest on the paved coastal loop', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect( chip ).toHaveText( 'Asphalt' );
	} );
	await test.step( 'When the driver moves to the town backroad, another paved start, and the car settles onto it', async () => {
		// Every surface the chip names, frame by frame, from the move onwards.
		await page.evaluate( () => {
			const el = document.querySelector( '[data-chip="surface"]' );
			window.__chipSeen = [];
			const watch = () => { window.__chipSeen.push( el.textContent ); if ( window.__chipSeen.length < 600 ) requestAnimationFrame( watch ); };
			watch();
		} );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await page.waitForTimeout( 500 );
	} );
	await test.step( 'Then the chip only ever says Asphalt: wheels in the air do not vote for sand', async () => {
		const seen = await page.evaluate( () => [ ...new Set( window.__chipSeen ) ] );
		expect( seen ).toEqual( [ 'Asphalt' ] );
	} );
} );

for ( const access of [ 'west', 'east' ] ) test( `The ${ access } beach entrance connects paved road, gravel and driveable sand`, async ( { page } ) => {
	await test.step( `When the driver starts at the ${ access } beach entrance`, async () => { await page.getByLabel( 'Start at', { exact: true } ).selectOption( access ); } );
	await test.step( 'Then the entrance begins on the supported paved road', async () => {
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );
	await test.step( 'When the driver follows the entrance onto the beach', async () => {
		// A human would brake on this downhill access. Control speed throughout,
		// rather than letting gravity accelerate a coasting car into the surf.
		let sawGravel = false, surface = 'asphalt';
		const deadline = Date.now() + 25_000;
		while ( surface !== 'sand' && Date.now() < deadline ) {
			const speed = await value( page, 'speed' );
			await page.keyboard[ speed < 10 ? 'down' : 'up' ]( 'w' );
			await page.keyboard[ speed > 14 ? 'down' : 'up' ]( 's' );
			await page.waitForTimeout( 50 );
			surface = await telemetry( page ).getAttribute( 'data-surface' );
			sawGravel ||= surface === 'gravel';
		}
		await page.keyboard.up( 'w' );
		expect( sawGravel ).toBe( true );
		expect( surface ).toBe( 'sand' );
		await page.keyboard.down( 's' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeLessThan( 2 );
		await page.keyboard.up( 's' );
	} );
	await test.step( 'Then the vehicle is on dry sand with tyre contact and beach marks', async () => {
		expect( await value( page, 'y' ) ).toBeGreaterThan( 0.7 );
		expect( await value( page, 'grounded' ) ).toBeGreaterThan( 2 );
		expect( await value( page, 'track-segments' ) ).toBeGreaterThan( 10 );
		await page.screenshot( { path: `test-results/rally-${ access }-beach-entrance.png` } );
	} );
} );

test( 'A steel guardrail on the seaward drop keeps a car on the road', async ( { page } ) => {
	await test.step( 'Given the car on the coastal road beside the seaward barrier', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	} );
	// The route plans the barrier from the graded terrain; read that real geometry.
	const car = { x: await value( page, 'x' ), z: await value( page, 'z' ), fx: await value( page, 'forward-x' ), fz: await value( page, 'forward-z' ) };
	const rail = await page.evaluate( ( { x, z } ) => {
		const runs = window.__app.coastalRoute.guardrails || [];
		const near = runs.flatMap( run => run.points.map( p => ( { run, d: Math.hypot( p.x - x, p.z - z ), p } ) ) ).sort( ( a, b ) => a.d - b.d )[ 0 ];
		return near ? { distance: near.d, x: near.p.x, z: near.p.z, points: near.run.points.map( p => [ p.x, p.z, p.nx, p.nz ] ) } : null;
	}, car );
	expect( rail, 'a guardrail run is planned beside the coastal spawn' ).not.toBeNull();
	expect( rail.distance ).toBeLessThan( 6 );
	// Signed distance of the car centre past the rail face (negative = road side).
	const past = ( x, z ) => {
		let best = null;
		for ( const [ px, pz, nx, nz ] of rail.points ) { const d = Math.hypot( x - px, z - pz ); if ( ! best || d < best.d ) best = { d, s: ( x - px ) * nx + ( z - pz ) * nz }; }
		return best.s;
	};
	const steer = ( rail.x - car.x ) * - car.fz + ( rail.z - car.z ) * car.fx > 0 ? 'd' : 'a';
	const samples = [];
	await test.step( 'When the driver steers into the rail under full power', async () => {
		await page.keyboard.down( 'w' ); await page.keyboard.down( steer );
		const deadline = Date.now() + 6_000;
		while ( Date.now() < deadline ) {
			samples.push( { past: past( await value( page, 'x' ), await value( page, 'z' ) ), speed: await value( page, 'speed' ) } );
			await page.waitForTimeout( 80 );
		}
		await page.keyboard.up( steer ); await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then the car stays on the road side of the rail and the impact scrubs its speed', async () => {
		const furthest = Math.max( ...samples.map( s => s.past ) );
		expect( furthest, 'car centre never crosses the rail face' ).toBeLessThan( 0 );
		// A nose-in hit leaves the centre about half a car length (2 m) short of the face.
		const contact = samples.findIndex( s => s.past > - 2.6 );
		expect( contact, `the car reached the rail (closest ${ furthest.toFixed( 2 ) } m)` ).toBeGreaterThan( - 1 );
		const peak = Math.max( ...samples.slice( 0, contact + 1 ).map( s => s.speed ) );
		const after = Math.min( ...samples.slice( contact ).map( s => s.speed ) );
		expect( peak ).toBeGreaterThan( 8 );
		expect( after ).toBeLessThan( peak * 0.6 );
		await page.screenshot( { path: 'test-results/rally-guardrail-stop.png' } );
	} );
} );

test( 'The full circuit is one continuous graded road', async ( { page } ) => {
	// Sample the live route and the graded heightfield the car actually drives on.
	const route = await test.step( 'When the mountain circuit is sampled every half metre on the loaded island', async () => page.evaluate( () => {
		const app = window.__app, r = app.coastalRoute, t = app.terrainData, circuit = r.paths.find( p => p.name === 'circuit' );
		if ( ! circuit ) return null;
		const pts = circuit.points, length = pts.at( - 1 ).distance, samples = [];
		for ( let s = 0, k = 0; s <= length; s += 0.5 ) {
			while ( k < pts.length - 2 && pts[ k + 1 ].distance < s ) k ++;
			const a = pts[ k ], b = pts[ k + 1 ], f = Math.min( 1, Math.max( 0, ( s - a.distance ) / ( b.distance - a.distance ) ) );
			const x = a.x + ( b.x - a.x ) * f, z = a.z + ( b.z - a.z ) * f;
			samples.push( { h: a.h + ( b.h - a.h ) * f, surface: t.roadSurfaceAt( x, z )?.kind || 'none', ground: t.heightAt( x, z ) } );
		}
		const onLoop = p => r.segments.filter( g => g.path === r.loop ).map( g => r.project( g, p.x, p.z ) ).sort( ( a, b ) => a.distance - b.distance )[ 0 ];
		const ends = [ pts[ 0 ], pts.at( - 1 ) ].map( p => { const q = onLoop( p ); return { gap: q.distance, step: Math.abs( q.h - p.h ) }; } );
		// The start must survive the car's start search unmoved: at most 0.7 m of fall across its footprint.
		const spawn = r.spawn( 'mountain' ), index = pts.findIndex( p => p.x === spawn.x && p.z === spawn.z );
		const corners = [ [ - 2.7, - 1.3 ], [ - 2.7, 1.3 ], [ 2.7, - 1.3 ], [ 2.7, 1.3 ] ].map( ( [ a, b ] ) => t.heightAt( spawn.x + a, spawn.z + b ) );
		const later = pts.find( p => index >= 0 && p.distance > pts[ index ].distance + 40 );
		return { length, maxGrade: r.circuitMaxGrade, samples, ends, spawn: { ...spawn, onCircuit: index >= 0, footprint: Math.max( ...corners ) - Math.min( ...corners ), fall: later ? pts[ index ].h - later.h : 0 } };
	} ) );
	await test.step( 'Then every sample is asphalt, graded without steps and flush with the rendered ground', async () => {
		expect( route, 'the route has a circuit path' ).not.toBeNull();
		expect( route.length ).toBeGreaterThan( 1000 );
		expect( route.maxGrade ).toBeLessThanOrEqual( 0.185 );
		expect( route.samples.filter( s => s.surface !== 'asphalt' ).length, 'samples off the asphalt' ).toBe( 0 );
		const steps = route.samples.slice( 1 ).map( ( s, i ) => Math.abs( s.h - route.samples[ i ].h ) );
		expect( Math.max( ...steps ), 'largest height step between half-metre samples' ).toBeLessThanOrEqual( 0.15 );
		const metre = route.samples.slice( 2 ).map( ( s, i ) => Math.abs( s.h - route.samples[ i ].h ) );
		expect( Math.max( ...metre ), 'largest rise or fall over one metre' ).toBeLessThanOrEqual( 0.185 );
		expect( Math.max( ...route.samples.map( s => Math.abs( s.ground - s.h ) ) ), 'rendered terrain against the road profile' ).toBeLessThanOrEqual( 0.2 );
	} );
	await test.step( 'Then both ends join the coastal loop flush and on its centreline', async () => {
		for ( const end of route.ends ) { expect( end.gap ).toBeLessThan( 1 ); expect( end.step ).toBeLessThan( 0.05 ); }
	} );
	await test.step( 'Then a mountain start sits on the circuit facing down the hero descent', async () => {
		expect( route.spawn.onCircuit ).toBe( true );
		expect( route.spawn.footprint, 'fall across the car footprint at the mountain start' ).toBeLessThan( 0.7 );
		expect( route.spawn.fall, 'the circuit 40 m on from the mountain start is lower' ).toBeGreaterThan( 3 );
		const start = page.getByLabel( 'Start at', { exact: true } );
		if ( ( await start.locator( 'option' ).evaluateAll( options => options.map( o => o.value ) ) ).includes( 'mountain' ) ) {
			await start.selectOption( 'mountain' );
			await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
			await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
			expect( Math.hypot( await value( page, 'x' ) - route.spawn.x, await value( page, 'z' ) - route.spawn.z ), 'car placed at the mountain start' ).toBeLessThan( 3 );
		}
	} );
} );
