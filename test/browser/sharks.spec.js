import { test, expect } from '@playwright/test';

// Maintained Given/When/Then scenarios on the actual local island. The only mocked
// boundary is an external font CDN. Every When uses a real visible product control;
// state() is a read-only observation of the running simulation, never an action hook.
const OUT = process.env.PW_OUT || 'test-results';
const sharks = page => page.evaluate( () => window.__app.sharks?.state() || null );
async function island( page ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
}

test( 'Watch sharks opens a close observation of living reef sharks without respawning them', async ( { page } ) => {
	const errors = []; page.on( 'pageerror', error => errors.push( error.message ) );
	let before;
	await test.step( 'Given a fresh solo island with its native wildlife', async () => { await island( page ); } );
	await test.step( 'When I choose Watch sharks from World controls', async () => {
		await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
	} );
	await test.step( 'Then three blacktip reef sharks are visible close to the underwater camera', async () => {
		await expect.poll( async () => ( await sharks( page ) )?.observing ).toBe( true );
		before = await sharks( page );
		expect( before.ready ).toBe( true ); expect( before.count ).toBe( 3 );
		expect( before.species ).toBe( 'Carcharhinus melanopterus' );
		expect( before.members.some( m => m.visible && m.lod === 0 ) ).toBe( true );
		const view = await page.evaluate( () => {
			const app = window.__app, m = app.sharks.state().members[ 0 ];
			return { free: app.freeCam, distance: Math.hypot( app.camera.position.x - m.x, app.camera.position.y - m.y, app.camera.position.z - m.z ), y: app.camera.position.y, surface: m.waterHeight };
		} );
		expect( view.free ).toBe( true ); expect( view.distance ).toBeLessThan( 6 ); expect( view.y ).toBeLessThan( view.surface );
		await page.screenshot( { path: `${ OUT }/sharks-underwater.png` } );
	} );
	await test.step( 'And they advance under their own lateral swimming animation, maintaining water and reef clearance', async () => {
		await expect.poll( async () => ( await sharks( page ) ).time - before.time, { timeout: 35_000 } ).toBeGreaterThan( 2.0 );
		const after = await sharks( page );
		expect( Math.hypot( after.members[ 0 ].x - before.members[ 0 ].x, after.members[ 0 ].z - before.members[ 0 ].z ) ).toBeGreaterThan( 0.35 );
		expect( after.members[ 0 ].phase ).not.toBe( before.members[ 0 ].phase );
		for ( const m of after.members ) { expect( m.depth ).toBeGreaterThan( 0.45 ); expect( m.floorClearance ).toBeGreaterThan( 0.6 ); expect( m.speed ).toBeLessThanOrEqual( 2.4 ); }
	} );
	await test.step( 'When I select Watch sharks again then the same three individuals remain', async () => {
		for ( let i = 0; i < 3; i ++ ) await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
		const after = await sharks( page ); expect( after.watchCount ).toBe( 4 ); expect( after.count ).toBe( 3 );
		expect( after.members.map( m => m.id ) ).toEqual( before.members.map( m => m.id ) );
		expect( after.time ).toBeGreaterThan( before.time );
		expect( await page.evaluate( () => window.__app.sharks.group.children.length ) ).toBe( 3 );
	} );
	expect( errors ).toEqual( [] );
} );

test( 'Sharks respond to a real tsunami current, freeze on pause and reset with Restore island', async ( { page } ) => {
	test.setTimeout( 240_000 );
	const errors = []; page.on( 'pageerror', error => errors.push( error.message ) );
	let start;
	await test.step( 'Given a fresh island and a tsunami aimed through the shark reef', async () => {
		await island( page ); await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
		start = await sharks( page ); const m = start.members[ 0 ];
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'custom' );
		await page.getByLabel( 'Target X (m)' ).fill( m.x.toFixed( 0 ) );
		await page.getByLabel( 'Target Z (m)' ).fill( m.z.toFixed( 0 ) );
		await page.getByLabel( 'Direction (degrees)' ).fill( '-90' );
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( '4' );
		await page.getByLabel( 'Wave width (m)' ).fill( '45' );
		await page.getByLabel( 'Warning lead time (s)' ).fill( '6' );
		await page.getByLabel( 'Radius (m)' ).fill( '220' );
		await page.getByLabel( 'Duration (s)' ).fill( '70' );
	} );
	await test.step( 'When I start the tsunami', async () => { await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click(); } );
	await test.step( 'Then the shared water current carries sharks and triggers their flee response', async () => {
		await expect.poll( async () => ( await sharks( page ) ).members.some( m => Math.hypot( m.current.x, m.current.z ) > 1.8 && m.mode === 'flee' ), { timeout: 150_000, intervals: [ 500 ] } ).toBe( true );
		const affected = await sharks( page );
		expect( affected.members.every( m => [ m.x, m.y, m.z, m.speed ].every( Number.isFinite ) ) ).toBe( true );
		await page.screenshot( { path: `${ OUT }/sharks-tsunami.png` } );
	} );
	await test.step( 'When I pause then their simulation time and positions remain fixed', async () => {
		await page.getByRole( 'button', { name: 'Pause simulation', exact: true } ).click();
		const frozen = await sharks( page ); await page.waitForTimeout( 700 );
		const after = await sharks( page ); expect( after.time ).toBe( frozen.time );
		expect( after.members.map( m => [ m.x, m.y, m.z ] ) ).toEqual( frozen.members.map( m => [ m.x, m.y, m.z ] ) );
	} );
	await test.step( 'When I restore the island then three calm sharks return with zero disaster current', async () => {
		await page.getByRole( 'button', { name: 'Restore island', exact: true } ).click();
		const restored = await sharks( page );
		expect( restored.time ).toBeLessThan( 0.5 );
		expect( errors ).toEqual( [] );
		await expect.poll( async () => ( await sharks( page ) ).members.every( m => m.panic === 0 && Math.hypot( m.current.x, m.current.z ) < 0.01 ) ).toBe( true );
		expect( ( await sharks( page ) ).count ).toBe( 3 );
		await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
		expect( ( await sharks( page ) ).observing ).toBe( true );
	} );
} );


test( 'Watching sharks preserves active fighter controls and works after leaving aviation', async ( { page } ) => {
 await test.step( 'Given a player at the fighter controls', async () => {
  await island( page );
  await page.getByRole( 'button', { name: 'Aviation', exact: true } ).click();
  await page.getByRole( 'button', { name: 'Enter fighter', exact: true } ).click();
 } );
 await test.step( 'When I choose Watch sharks then the active cockpit keeps control', async () => {
  await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
  await expect( page.getByText( 'Leave the vehicle controls before watching sharks.', { exact: true } ) ).toBeVisible();
  expect( await page.evaluate( () => ( { active: window.__app.aviation.active, mode: window.__app.player.mode, free: window.__app.freeCam } ) ) ).toEqual( { active: true, mode: 'aviation', free: false } );
  expect( ( await sharks( page ) ).observing ).toBe( false );
 } );
 await test.step( 'When I leave aviation and choose Watch sharks then observation opens', async () => {
  await page.getByRole( 'button', { name: 'Leave aviation', exact: true } ).click();
  await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
  expect( ( await sharks( page ) ).observing ).toBe( true );
 } );
} );

test( 'Shark bite demo opens detailed jaws, contacts the floating target and resets repeatably', async ( { page } ) => {
 test.setTimeout( 180_000 );
 const errors = []; page.on( 'pageerror', e => errors.push( e.message ) );
 await test.step( 'Given a fresh island with sharks and a harmless floating practice target', async () => { await island( page ); } );
 await test.step( 'When I choose Shark bite demo', async () => {
  await page.getByRole( 'button', { name: 'Shark bite demo', exact: true } ).click();
 } );
 await test.step( 'Then the jaw opens visibly within its joint limit', async () => {
  await expect.poll( async () => ( await sharks( page ) ).members[ 0 ].jawAngle, { timeout: 20_000, intervals: [ 50 ] } ).toBeGreaterThan( 0.4 );
  const s = await sharks( page );
  expect( s.members[ 0 ].jawAngle ).toBeLessThanOrEqual( 0.65 );
  expect( s.jawRigReady ).toBe( true );
  expect( s.members[ 0 ].renderJawAngle ).toBeCloseTo( s.members[ 0 ].jawAngle, 5 );
  expect( s.bite.target.visible ).toBe( true );
  expect( s.bite.target.radius ).toBeGreaterThan( 0.02 );
  await page.screenshot( { path: `${ OUT }/shark-jaw-open.png` } );
 } );
 await test.step( 'And a closing tooth contacts the target and transfers a real impulse', async () => {
  await expect.poll( async () => ( await sharks( page ) ).bite.contactCount, { timeout: 35_000, intervals: [ 100 ] } ).toBe( 1 );
  const s = await sharks( page ); const hit = s.bite.lastContact;
  expect( hit.targetId ).toBe( 'practice-target' );
  expect( Math.hypot( hit.impulse.x, hit.impulse.y, hit.impulse.z ) ).toBeGreaterThan( 0.001 );
  expect( hit.relativeSpeed ).toBeGreaterThan( 0 );
  expect( s.bite.result ).toBe( 'hit' );
  await expect.poll( async () => ( await sharks( page ) ).bite.phase, { timeout: 20_000 } ).toBe( 'idle' );
  expect( ( await sharks( page ) ).members[ 0 ].jawAngle ).toBeLessThan( 0.025 );
  await page.screenshot( { path: `${ OUT }/shark-jaw-closed.png` } );
 } );
 await test.step( 'When I repeat the demonstration then the same bounded population completes a second bite', async () => {
  await page.getByRole( 'button', { name: 'Shark bite demo', exact: true } ).click();
  await expect.poll( async () => ( await sharks( page ) ).bite.contactCount, { timeout: 35_000 } ).toBe( 2 );
  const s = await sharks( page ); expect( s.count ).toBe( 3 ); expect( s.bite.targetCount ).toBe( 1 );
  expect( s.bite.cycle ).toBe( 2 );
 } );
 await test.step( 'When I restore the island then jaws, contacts and the target return to rest', async () => {
  await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
  await page.getByRole( 'button', { name: 'Restore island', exact: true } ).click();
  const s = await sharks( page ); expect( s.bite.phase ).toBe( 'idle' ); expect( s.bite.contactCount ).toBe( 0 );
  expect( s.members[ 0 ].jawAngle ).toBe( 0 ); expect( s.bite.target.visible ).toBe( false );
 } );
 expect( errors ).toEqual( [] );
} );


test( 'Shark observation preserves an active hang glider until the player leaves its controls', async ( { page } ) => {
 const errors = []; page.on( 'pageerror', e => errors.push( e.message ) );
 await test.step( 'Given a pilot launching the hang glider', async () => {
  await island( page );
  await page.getByRole( 'button', { name: 'Hang glider', exact: true } ).click();
  await page.getByRole( 'button', { name: 'Launch glider', exact: true } ).click();
  await expect.poll( () => page.evaluate( () => window.__app.glider.active ) ).toBe( true );
 } );
 await test.step( 'When I choose each shark observation action then glider controls remain active', async () => {
  for ( const action of [ 'Watch sharks', 'Shark bite demo' ] ) {
   await page.getByRole( 'button', { name: action, exact: true } ).click();
   await expect( page.getByText( 'Leave the vehicle controls before watching sharks.', { exact: true } ) ).toBeVisible();
   expect( await page.evaluate( () => ( { active: window.__app.glider.active, mode: window.__app.player.mode, free: window.__app.freeCam } ) ) ).toEqual( { active: true, mode: 'glider', free: false } );
   expect( ( await sharks( page ) ).observing ).toBe( false );
   expect( ( await sharks( page ) ).bite.cycle ).toBe( 0 );
  }
 } );
 await test.step( 'When I leave the glider and choose Watch sharks then observation opens', async () => {
  await page.getByRole( 'button', { name: 'Leave glider', exact: true } ).click();
  await page.getByRole( 'button', { name: 'Watch sharks', exact: true } ).click();
  expect( ( await sharks( page ) ).observing ).toBe( true );
 } );
 expect( errors ).toEqual( [] );
} );
