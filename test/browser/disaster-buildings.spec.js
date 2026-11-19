// Buildings in a tornado and a tsunami, driven from the Disasters panel with the keyboard
// (docs/disaster-damage.md, buildings). Telemetry is read from the running game; page.evaluate only reads
// state and stages the review cameras for the captures.
import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck } from './gameTime.js';

const OUT = process.env.PW_OUT ?? '/tmp';
const status = page => page.getByRole( 'status', { name: 'Disaster simulation' } );
async function fill( page, field, value ) {
	await field.focus();
	await page.keyboard.press( 'ControlOrMeta+A' );
	await page.keyboard.type( value );
}
async function choose( page, label, option ) {
	await page.getByLabel( label ).focus();
	await page.keyboard.type( option );
	await expect( page.getByLabel( label ) ).toHaveValue( option.toLowerCase() );
}
// Each village building's components by kind, read from the running game, and whether any standing
// part has left its authored place (a house moving as one block would move its standing parts).
const parts = page => page.evaluate( () => {
	const S = window.__app.disasters.structures, out = { moved: 0, jointed: 0, pieces: 0, debris: S.debrisCount };
	for ( const r of S.records ) {
		if ( ! r.progressive ) continue;
		if ( r.active ) out.jointed ++;
		for ( const c of r.components ?? [] ) {
			const k = out[ c.kind ] ??= { n: 0, failed: 0, first: null };
			k.n ++; if ( c.failed ) { k.failed ++; if ( k.first === null || c.failedAt < k.first ) k.first = c.failedAt; }
			else for ( const s of c.spans ) { const a = s.geo.attributes.position.array, rest = s.restPos ?? s.pos; if ( Math.abs( a[ s.start * 3 + 1 ] - rest[ 1 ] ) > .05 || Math.abs( a[ s.start * 3 ] - rest[ 0 ] ) > .05 ) { out.moved ++; break; } }
		}
	}
	for ( const b of S.bodies.values() ) if ( b.piece ) out.pieces ++;
	return out;
} );

test( 'Village buildings lose roofs before walls, piece by piece, under a tornado and then a 2 m tsunami', async ( { page } ) => {
	test.setTimeout( SCENARIO_TIMEOUT_MS );
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	await test.step( 'Given the island and the disaster controls', async () => {
		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio` );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
	} );
	await test.step( 'When I start a tornado and then a 2 m tsunami at the village with the keyboard', async () => {
		await choose( page, 'Disaster type', 'Tornado' );
		await choose( page, 'Target location', 'Village' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tornado/ );
		await choose( page, 'Disaster type', 'Tsunami' );
		await fill( page, page.getByLabel( 'Warning lead time (s)' ), '6' );
		await fill( page, page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ), '2' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tsunami/ );
	} );
	await test.step( 'Then roofs go before walls and no house moves as one block', async () => {
		let last = null;
		await untilGameTimeCheck( page, async () => {
			last = await parts( page );
			expect( last.moved, 'standing parts stay where they were built' ).toBe( 0 );
			expect( last.jointed, 'no village building turned into one jointed assembly' ).toBe( 0 );
			return false;
		}, 40 );
		// Each part records the game time it let go (Structures.js failedAt), so the order is strict, not a tie
		// on one poll (a single poll can report the first roof and the first wall on the same poll).
		const roofAt = last.roofCover?.first ?? Infinity, wallAt = last.wall?.first ?? Infinity;
		console.log( 'building parts', JSON.stringify( last ), 'first roof sheet at', roofAt, 's, first wall panel at', wallAt, 's' );
		expect( roofAt, 'a roof sheet came off within 40 game s' ).toBeLessThan( Infinity );
		expect( roofAt, `the first roof sheet (${ roofAt } s) went strictly before the first wall panel (${ wallAt } s)` ).toBeLessThan( wallAt );
		await page.getByRole( 'button', { name: 'Pause simulation', exact: true } ).click();
		await page.evaluate( () => window.__view( 'village150' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/buildings-150m.png` } );
		await page.evaluate( () => window.__view( 'village' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/buildings-ground.png` } );
		expect( errors ).toEqual( [] );
	} );
} );
