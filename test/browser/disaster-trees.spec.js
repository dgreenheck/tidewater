// Trees in a tornado and a tsunami, driven from the Disasters panel with the keyboard
// (docs/disaster-damage.md). Telemetry is read from the running game; page.evaluate only reads
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
const trees = page => page.evaluate( () => window.__app.disasters.bodies.trees.filter( t => t.mode || t.util > .3 ).map( t => ( {
	mode: t.mode ?? 'bend', util: t.util, cut: t.cut, H: t.r.H, stump: Boolean( t.stump?.parent ),
	// Crown intact: every copied mesh draws the whole authored index buffer, never a stand-in.
	intact: ! t.group || t.group.children.every( ( m, i ) => m.geometry.index.count === t.type.near.meshes[ i ].geometry.index.count ),
} ) ) );

test( 'Trees bend, snap or uproot with their crowns intact under a tornado and then a 2 m tsunami', async ( { page } ) => {
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
	await test.step( 'Then trees fall, snap or bend, and every fallen tree keeps its whole crown', async () => {
		const r = await untilGameTimeCheck( page, async () => ( await trees( page ) ).some( t => t.mode !== 'bend' ), 60 );
		expect( r.value, `a tree gave way within 60 game s (waited ${ r.elapsed.toFixed( 1 ) } s)` ).toBeTruthy();
		await untilGameTimeCheck( page, async () => false, 8 );
		const seen = await trees( page );
		for ( const t of seen ) {
			expect( [ 'bend', 'snap', 'uproot' ] ).toContain( t.mode );
			expect( t.intact, `${ t.mode } tree keeps its authored crown mesh` ).toBe( true );
			if ( t.mode === 'snap' ) {
				expect( t.stump, 'a snapped tree leaves its stump standing' ).toBe( true );
				expect( t.cut / t.H ).toBeGreaterThanOrEqual( .15 );
				expect( t.cut / t.H ).toBeLessThanOrEqual( .7 );
			}
		}
		console.log( 'tree modes', JSON.stringify( seen.reduce( ( n, t ) => ( n[ t.mode ] = ( n[ t.mode ] ?? 0 ) + 1, n ), {} ) ) );
		await page.getByRole( 'button', { name: 'Pause simulation', exact: true } ).click();
		await page.evaluate( () => window.__view( 'village150' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/trees-150m.png` } );
		await page.evaluate( () => window.__view( 'village' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/trees-ground.png` } );
		expect( errors ).toEqual( [] );
	} );
} );
