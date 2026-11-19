import { test, expect } from '@playwright/test';

// Maintained Given/When/Then scenarios on the actual island and WASM simulation.
// Every test gets a fresh browser context/localStorage. There is no backend or
// external service in the driving path and no intercepted product responses.
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, name ) => Number( await telemetry( page ).getAttribute( `data-${ name }` ) );
const position = async page => ( { x: await value( page, 'x' ), z: await value( page, 'z' ) } );
const distance = ( a, b ) => Math.hypot( a.x - b.x, a.z - b.z );
const press = async ( page, key ) => {
	await page.keyboard.down( key );
	await page.waitForTimeout( 160 );
	await page.keyboard.up( key );
};

test.beforeEach( async ( { page } ) => {
	await test.step( 'Given a solo player on the real island with fresh local progress', async () => {
		// The only third-party dependency is typography, outside the driving path.
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		const skip = page.getByRole( 'button', { name: 'Skip', exact: true } );
		await skip.click();
	} );
} );

async function enter( page ) {
	await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
	await expect( telemetry( page ) ).toBeVisible();
	await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
}

test( 'Drive the original Aster on the island, brake, reverse and recover', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	let start;
	await test.step( 'When the player chooses Drive Aster RS', async () => { await enter( page ); start = await position( page ); } );
	await test.step( 'Then the original car is supported by its four wheel contacts', async () => {
		expect( await value( page, 'model-parts' ) ).toBeGreaterThan( 12 );
		expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.9 );
		expect( Math.abs( await value( page, 'ground-clearance' ) ) ).toBeLessThan( 0.25 );
		await page.screenshot( { path: 'test-results/rally-aster-ready.png' } );
	} );
	await test.step( 'When the driver accelerates with W', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 15 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then engine power moves the car across the real island terrain', async () => {
		expect( distance( await position( page ), start ) ).toBeGreaterThan( 3 );
		expect( await value( page, 'gear' ) ).toBeGreaterThan( 0 );
	} );
	await test.step( 'When the driver brakes with S and keeps holding to reverse', async () => {
		await page.keyboard.down( 's' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeLessThan( - 3 );
		await page.keyboard.up( 's' );
	} );
	await test.step( 'Then the real drivetrain selects reverse', async () => { expect( await value( page, 'gear' ) ).toBe( - 1 ); } );
	let stopped;
	await test.step( 'When the driver recovers with R', async () => { stopped = await position( page ); await press( page, 'r' ); } );
	await test.step( 'Then the car is back on its wheels where it was, with zero momentum', async () => {
		await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
		// Recovery keeps the car where the driver left it (the Start at choice resets to a start).
		expect( distance( await position( page ), stopped ) ).toBeLessThan( 4 );
		expect( distance( await position( page ), start ) ).toBeGreaterThan( 1 );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.95 );
		expect( errors ).toEqual( [] );
	} );
} );

test( 'Free camera parks the car and returns to driving before keyboard exit', async ( { page } ) => {
	await test.step( 'Given the player is in the Aster with its springs settled', async () => { await enter( page ); } );
	const start = await position( page );
	await test.step( 'When the driver switches to free camera with F', async () => { await press( page, 'f' ); } );
	await test.step( 'Then the camera mode offers a return to the car', async () => {
		await expect( page.getByRole( 'status' ).getByText( 'Free camera', { exact: true } ) ).toBeVisible();
		await expect( page.getByText( 'Return to car', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'When the player moves the free camera forward', async () => {
		await page.keyboard.down( 'w' );
		await page.waitForTimeout( 600 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then camera input has not accelerated the parked car', async () => {
		expect( await value( page, 'speed' ) ).toBeLessThan( 2 );
		expect( distance( await position( page ), start ) ).toBeLessThan( 0.5 );
	} );
	await test.step( 'When the player returns with F and leaves with E', async () => {
		await press( page, 'f' );
		await expect( page.getByText( 'Driving · Aster RS', { exact: true } ) ).toBeVisible();
		await press( page, 'e' );
	} );
	await test.step( 'Then the player is walking and the driving HUD is closed', async () => {
		await expect( telemetry( page ) ).toBeHidden();
		await expect( page.getByText( 'Walking', { exact: true } ) ).toBeVisible();
	} );
} );

test( 'Arrow-key steering turns in the driver’s direction and the handbrake stops the car', async ( { page } ) => {
	await test.step( 'Given the player has entered the Aster', async () => { await enter( page ); } );
	for ( const [ key, sign ] of [ [ 'ArrowRight', 1 ], [ 'ArrowLeft', - 1 ] ] ) {
		await press( page, 'r' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		const fx = await value( page, 'forward-x' ), fz = await value( page, 'forward-z' );
		let turn = 0;
		await test.step( `When the driver accelerates and steers ${ key }`, async () => {
			await page.keyboard.down( 'ArrowUp' );
			await expect.poll( () => value( page, 'speed' ) ).toBeGreaterThan( 12 );
			await page.keyboard.down( key );
			await expect.poll( async () => {
				turn = - fz * await value( page, 'forward-x' ) + fx * await value( page, 'forward-z' );
				return Math.abs( turn );
			} ).toBeGreaterThan( 0.10 );
			await page.keyboard.up( key );
			await page.keyboard.up( 'ArrowUp' );
		} );
		await test.step( 'Then the first physical turn follows the requested direction', async () => { expect( turn * sign ).toBeGreaterThan( 0.1 ); } );
	}
	await test.step( 'When the driver holds the handbrake', async () => {
		await page.keyboard.down( 'Space' );
		await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
		await page.keyboard.up( 'Space' );
	} );
} );

test( 'Leave the car, return to walking and re-enter without conflicting controls', async ( { page } ) => {
	await test.step( 'Given the player is driving the Aster', async () => { await enter( page ); } );
	await test.step( 'When the driver checks the controls and returns to the car', async () => {
		await page.keyboard.press( 'F1' );
		const help = page.getByRole( 'dialog', { name: 'Controls' } );
		await expect( help ).toBeVisible();
		await help.getByRole( 'button', { name: 'Close', exact: true } ).click();
		await expect( help ).toBeHidden();
	} );
	await test.step( 'When the driver chooses Leave car', async () => { await page.getByRole( 'button', { name: 'Leave car', exact: true } ).click(); } );
	await test.step( 'Then walking and the fishing controls are available again', async () => {
		await expect( telemetry( page ) ).toBeHidden();
		await expect( page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ) ).toBeVisible();
		await expect( page.getByText( 'Walking', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'When the player re-enters the car', async () => { await enter( page ); } );
	await test.step( 'Then the car remains ready with its four loaded wheels', async () => { expect( await value( page, 'grounded' ) ).toBe( 4 ); } );
} );

test( 'Loaded tyres leave sand impressions along the driven route', async ( { page } ) => {
	await test.step( 'Given the Aster is resting on clear island sand', async () => { await enter( page ); } );
	await test.step( 'When the driver crosses the sand and stops with the handbrake', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 25 );
		await page.keyboard.up( 'w' );
		await page.keyboard.down( 'Space' );
		await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
		await page.keyboard.up( 'Space' );
	} );
	await test.step( 'Then actual wheel contacts have generated visible terrain-conforming tracks', async () => {
		await expect.poll( () => value( page, 'track-segments' ) ).toBeGreaterThan( 60 );
		expect( await value( page, 'track-width' ) ).toBeGreaterThan( 0.19 );
		expect( await value( page, 'track-width' ) ).toBeLessThan( 0.3 );
		await page.screenshot( { path: 'test-results/rally-tyre-tracks.png' } );
	} );
} );

test( 'Choose the Blender-built Ridgeback 4x4 and drive with its own suspension and wider tyres', async ( { page } ) => {
	await test.step( 'Given the vehicle card introduces the Aster as a rear-drive coupe', async () => {
		await expect( page.getByText( 'RWD coupe', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'When the player chooses the Ridgeback 4x4 and starts driving', async () => {
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'jeep' );
		await expect( page.getByText( 'Lifted 4x4', { exact: true } ) ).toBeVisible();
		await page.getByRole( 'button', { name: 'Drive Ridgeback 4x4', exact: true } ).click();
	} );
	await test.step( 'Then the lifted 4x4 is supported by four wheels with its own mass and tyre size', async () => {
		await expect( telemetry( page ) ).toHaveAttribute( 'data-vehicle', 'jeep' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect.poll( () => value( page, 'speed' ) ).toBeLessThan( 2 );
		expect( await value( page, 'mass' ) ).toBe( 2100 );
		expect( await value( page, 'wheel-radius' ) ).toBe( 0.47 );
		expect( await value( page, 'model-parts' ) ).toBeGreaterThan( 20 );
		await page.screenshot( { path: 'test-results/rally-ridgeback.png' } );
	} );
	const start = await position( page );
	await test.step( 'When the player accelerates the 4x4 across the beach', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'signed-speed' ) ).toBeGreaterThan( 18 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then the 4x4 moves under power and leaves wider contact tracks', async () => {
		expect( distance( await position( page ), start ) ).toBeGreaterThan( 3 );
		await expect.poll( () => value( page, 'track-segments' ) ).toBeGreaterThan( 30 );
		expect( await value( page, 'track-width' ) ).toBeGreaterThan( 0.34 );
		expect( await value( page, 'up-y' ) ).toBeGreaterThan( 0.8 );
	} );
	await test.step( 'When the driver switches back to the Aster', async () => {
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'aster' );
	} );
	await test.step( 'Then the original car and its tuning are restored', async () => {
		await expect( telemetry( page ) ).toHaveAttribute( 'data-vehicle', 'aster' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		expect( await value( page, 'mass' ) ).toBe( 1250 );
	} );
} );

test( 'The driving HUD reads live speed and gear, tucks its key hints away and brings them back with K', async ( { page } ) => {
	const keys = page.getByRole( 'note', { name: 'Driving keys' } );
	const sound = page.getByRole( 'button', { name: 'Engine sound', exact: true } );
	await test.step( 'Given the player is walking beside the Aster with audio off for the session', async () => {
		await expect( page.getByText( 'RWD coupe', { exact: true } ) ).toBeVisible();
		await expect( telemetry( page ) ).toBeHidden();
	} );
	await test.step( 'When the player gets in', async () => { await enter( page ); } );
	await test.step( 'Then a speedo cluster shows the parked car, the driving keys and a muted engine chip', async () => {
		await expect( telemetry( page ) ).toContainText( /\b0 km\/h/ );
		await expect( keys ).toBeVisible();
		await expect( sound ).toHaveAttribute( 'aria-pressed', 'false' );
		await expect( sound ).toHaveAccessibleDescription( 'Audio is off for this session' );
	} );
	await test.step( 'When the driver laps a tight circle on the sand for several seconds', async () => {
		await page.keyboard.down( 'w' );
		await page.keyboard.down( 'a' );
		await expect( keys ).toBeHidden( { timeout: 20_000 } );
	} );
	await test.step( 'Then the cluster shows the moving speed in a forward gear', async () => {
		await expect( telemetry( page ) ).toContainText( /\b[1-9]\d* km\/h/ );
		await expect( telemetry( page ).getByText( /^Gear [1-6]$/ ) ).toBeVisible();
		await page.screenshot( { path: 'test-results/rally-hud-driving.png' } );
	} );
	await test.step( 'When the driver presses K while still moving', async () => { await press( page, 'k' ); } );
	await test.step( 'Then the key hints return', async () => {
		await expect( keys ).toBeVisible();
		await page.keyboard.up( 'w' );
		await page.keyboard.up( 'a' );
	} );
	await test.step( 'When the driver leaves with E', async () => { await press( page, 'e' ); } );
	await test.step( 'Then the cluster closes and the vehicle card offers the drive again', async () => {
		await expect( telemetry( page ) ).toBeHidden();
		await expect( keys ).toBeHidden();
		await expect( page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ) ).toBeVisible();
	} );
} );

// Narrow desktop windows: the key hints sit top centre only when that row has room.
for ( const [ width, height ] of [ [ 960, 540 ], [ 700, 800 ], [ 1280, 720 ] ] ) test( `In a ${ width }x${ height } window the driving key hints overlap no other top-bar panel`, async ( { page } ) => {
	const keys = page.getByRole( 'note', { name: 'Driving keys' } );
	await test.step( `Given the player's window is ${ width } by ${ height }`, async () => { await page.setViewportSize( { width, height } ); } );
	await test.step( 'When the player gets in the Aster', async () => { await enter( page ); } );
	await test.step( 'Then the key hints show in full, on screen, clear of the stats, brand and purse panels', async () => {
		await expect( keys ).toBeVisible();
		await page.waitForTimeout( 600 );
		const clash = await page.evaluate( () => {
			const rect = el => el.getBoundingClientRect();
			const k = rect( document.querySelector( '.rh-keys' ) );
			const panels = [ ...document.querySelectorAll( '.tw-tl > *, .gm-purse' ) ].filter( el => el.checkVisibility( { opacityProperty: true, visibilityProperty: true } ) && rect( el ).width > 0 );
			const hits = panels.filter( el => { const r = rect( el ); return r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top; } ).map( el => el.className );
			if ( k.left < 0 || k.right > innerWidth ) hits.push( `off screen ${ Math.round( k.left ) }..${ Math.round( k.right ) }` );
			return hits;
		} );
		expect( clash ).toEqual( [] );
		await page.screenshot( { path: `test-results/rally-keys-${ width }.png` } );
	} );
} );

for ( const [ width, height ] of [ [ 700, 800 ], [ 820, 700 ], [ 960, 540 ] ] ) test( `In a ${ width }x${ height } window the driving dock, speedo and map sit side by side without covering each other`, async ( { page } ) => {
	await test.step( `Given the player's window is ${ width } by ${ height }`, async () => { await page.setViewportSize( { width, height } ); } );
	await test.step( 'When the player gets in the Aster', async () => { await enter( page ); await page.waitForTimeout( 900 ); } );
	await test.step( 'Then every dock button, the speedo cluster and the map are fully clear of one another', async () => {
		const clash = await page.evaluate( () => {
			const panels = [ ...document.querySelectorAll( '.rh-dock button, .rh-dock select, .rh-cluster, .gm-map' ) ].filter( el => el.checkVisibility( { opacityProperty: true, visibilityProperty: true } ) );
			const name = el => el.getAttribute( 'aria-label' ) || el.className || el.tagName;
			const hits = [];
			panels.forEach( ( a, i ) => panels.slice( i + 1 ).forEach( b => {
				if ( a.contains( b ) || b.contains( a ) ) return;
				const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
				if ( r.left < s.right - 1 && r.right > s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1 ) hits.push( `${ name( a ) } / ${ name( b ) }` );
			} ) );
			return hits;
		} );
		expect( clash ).toEqual( [] );
		await page.screenshot( { path: `test-results/rally-dock-${ width }.png` } );
	} );
} );

test( 'At speed on a 120 Hz display the car and chase camera move evenly every frame, with no judder', async ( { page } ) => {
	await test.step( 'Given a 120 Hz display whose frame times wobble by up to a millisecond, as real ones do', async () => {
		// The display is hardware: its refresh cadence is the mocked boundary. Every frame of the
		// real game is given that cadence and the drawn car and camera are recorded after it.
		await page.evaluate( () => {
			const app = window.__app, frame = app.frame.bind( app );
			let n = 0; window.__motion = null;
			app.frame = ( dt, t ) => {
				const d = 1 / 120 + ( ( n ++ * 7919 ) % 11 - 5 ) * 0.0002;
				const result = frame( d, t );
				const car = app.rally.model.root.position, cam = app.camera.position;
				window.__motion?.push( [ d, car.x, car.y, car.z, Math.abs( app.rally.state[ 7 ] ) / 3.6, cam.distanceTo( car ) ] );
				return result;
			};
		} );
	} );
	await test.step( 'And the driver is in the Aster on the straight town backroad', async () => {
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
	} );
	await test.step( 'When the driver accelerates past 60 km/h', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ], timeout: 30_000 } ).toBeGreaterThan( 60 );
		await page.evaluate( () => { window.__motion = []; } );
		await expect.poll( () => page.evaluate( () => window.__motion.length ), { intervals: [ 50 ] } ).toBeGreaterThan( 150 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'Then every frame the drawn car moves its speed times the frame time, and the camera holds its distance', async () => {
		const motion = await page.evaluate( () => window.__motion );
		const ratios = [], camera = [];
		for ( let i = 1; i < motion.length; i ++ ) {
			const [ d, x, y, z, v, cam ] = motion[ i ], [ , px, py, pz, , pcam ] = motion[ i - 1 ];
			ratios.push( Math.hypot( x - px, y - py, z - pz ) / ( v * d ) );
			camera.push( Math.abs( cam - pcam ) );
		}
		const uneven = ratios.filter( r => r < 0.8 || r > 1.2 ).length;
		expect( uneven, `frames off an even pace: ${ ratios.map( r => r.toFixed( 2 ) ).slice( 0, 24 ).join( ' ' ) }` ).toBe( 0 );
		expect( Math.max( ...camera ), 'largest frame-to-frame change in camera distance, m' ).toBeLessThan( 0.02 );
	} );
} );

test( 'Y yeets the driver out of the moving car to tumble along the ground, while the empty car rolls on', async ( { page } ) => {
	const scene = () => page.evaluate( () => {
		const app = window.__app, cam = app.camera, up = { x: 0, y: 1, z: 0 };
		const q = cam.quaternion, x = q._x ?? q.x, y = q._y ?? q.y, z = q._z ?? q.z, w = q._w ?? q.w;
		// The camera's own up vector (the view's roll) from its quaternion.
		const upY = 1 - 2 * ( x * x + z * z );
		return { view: app.player.view, t: performance.now(), game: app.gameTime, cx: cam.position.x, cy: cam.position.y, cz: cam.position.z, upY, driving: app.rally.active, mode: app.player.mode,
			ground: app.terrainData.heightAt( cam.position.x, cam.position.z ), carSpeed: Math.abs( app.rally.state[ 7 ] ), carX: app.rally.state[ 0 ], carZ: app.rally.state[ 2 ] };
	} );
	let bail;
	await test.step( 'Given the driver is flat out along the straight town backroad, in first person', async () => {
		// The view rides the tumbling head only in first person (Player.js ragHeadCam); third person
		// has been the default since 25f6bd8, so the player picks first person with V on foot first.
		await press( page, 'v' );
		expect( ( await scene() ).view ).toBe( 'first' );
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ], timeout: 30_000 } ).toBeGreaterThan( 55 );
	} );
	await test.step( 'When the driver presses Y', async () => {
		bail = await scene();
		await page.keyboard.up( 'w' );
		await press( page, 'y' );
	} );
	let yeetAt;
	await test.step( 'Then, once the shout is out, the world drops into slow motion with the driver in the air', async () => {
		yeetAt = Date.now();
		await expect( telemetry( page ) ).toBeHidden();
		await page.waitForTimeout( 550 );
		const a = await scene(); await page.waitForTimeout( 300 ); const b = await scene();
		expect( ( b.game - a.game ) / ( ( b.t - a.t ) / 1000 ), 'game seconds per real second' ).toBeLessThan( 0.45 );
	} );
	await test.step( 'And the driver is out of the car and flying on down the road at about the car\'s speed', async () => {
		const a = await scene(); await page.waitForTimeout( 250 ); const b = await scene();
		const speed = Math.hypot( b.cx - a.cx, b.cz - a.cz ) / ( b.game - a.game );
		expect( a.driving ).toBe( false );
		expect( speed, 'driver speed, m/s of game time' ).toBeGreaterThan( bail.carSpeed / 3.6 * 0.5 );
	} );
	await test.step( 'And the view rolls with the tumbling body, low along the ground', async () => {
		let rolled = false, low = false;
		for ( let i = 0; i < 40 && ! ( rolled && low ); i ++ ) {
			const s = await scene();
			rolled ||= s.upY < 0.5; low ||= s.cy - s.ground < 0.8;
			await page.waitForTimeout( 50 );
		}
		expect( rolled, 'the horizon rolled past 60 degrees' ).toBe( true );
		expect( low, 'the view came down to the ground' ).toBe( true );
	} );
	await test.step( 'And the empty car rolls on without its driver, no handbrake', async () => {
		expect( ( await scene() ).carSpeed ).toBeGreaterThan( 15 );
	} );
	await test.step( 'And time eases back up to full speed as the driver lands, within about three seconds', async () => {
		await page.waitForTimeout( Math.max( 0, 3300 - ( Date.now() - yeetAt ) ) );
		const a = await scene(); await page.waitForTimeout( 300 ); const b = await scene();
		expect( ( b.game - a.game ) / ( ( b.t - a.t ) / 1000 ), 'game seconds per real second' ).toBeGreaterThan( 0.9 );
	} );
	await test.step( 'Then the driver comes to rest well down the road and stands up on foot', async () => {
		await expect.poll( async () => ( await scene() ).mode, { timeout: 15_000 } ).toBe( 'walk' );
		const end = await scene();
		expect( Math.hypot( end.cx - bail.cx, end.cz - bail.cz ), 'metres from where the driver bailed' ).toBeGreaterThan( 8 );
		expect( end.upY, 'standing upright' ).toBeGreaterThan( 0.95 );
		expect( end.cy - end.ground, 'eye height' ).toBeGreaterThan( 1.2 );
	} );
} );

test( 'The chase camera lens widens as speed builds and settles back when the car stops', async ( { page } ) => {
	const fov = () => page.evaluate( () => window.__app.camera.fov );
	let rest;
	await test.step( 'Given the driver is parked in the Aster on the straight town backroad', async () => {
		await page.getByRole( 'button', { name: 'Drive Aster RS', exact: true } ).click();
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await page.waitForTimeout( 800 );
		rest = await fov();
	} );
	await test.step( 'When the driver accelerates hard past 80 km/h', async () => {
		await page.keyboard.down( 'w' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ], timeout: 30_000 } ).toBeGreaterThan( 80 );
		await page.waitForTimeout( 600 );
	} );
	await test.step( 'Then the view is clearly wider than at rest', async () => {
		expect( await fov() - rest, 'degrees wider' ).toBeGreaterThan( 4 );
		await page.keyboard.up( 'w' );
	} );
	await test.step( 'When the driver brakes to a stop, Then the lens settles back to its resting width', async () => {
		await page.keyboard.down( 's' );
		await expect.poll( () => value( page, 'speed' ), { intervals: [ 50 ] } ).toBeLessThan( 1 );
		await page.keyboard.up( 's' );
		await expect.poll( async () => Math.abs( await fov() - rest ), { timeout: 5000 } ).toBeLessThan( 0.5 );
	} );
} );
