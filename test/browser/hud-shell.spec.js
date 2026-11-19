// The world-tool panel shell and the HUD cards around it:
// a panel is as tall as its content and scrolls inside the viewport when longer, nothing peeks
// out under it, the strip fades instead of cutting a tool name, and the evacuation hint never
// sits on the third-person character. Driven with the player's own clicks and keys.
import { test, expect } from '@playwright/test';

const PANEL_GAP = 22; // px, the shell's clearance to the bottom edge (WorldTools.js .tw-world-panel)

const ready = async page => {

	await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=.6&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

};

const openPanel = page => page.locator( '.tw-world-panel:not([hidden])' );

// the open panel's box, its content's last pixel row and what the browser finds just under it
const shellBox = page => openPanel( page ).evaluate( panel => {

	const r = panel.getBoundingClientRect();
	let last = r.top;
	for ( const child of panel.children ) last = Math.max( last, child.getBoundingClientRect().bottom );
	const under = document.elementsFromPoint( r.left + 120, Math.min( r.bottom + 3, innerHeight - 1 ) )
		.map( el => el.className && typeof el.className === 'string' ? el.className : el.tagName );
	return { top: r.top, bottom: r.bottom, last, pad: parseFloat( getComputedStyle( panel ).paddingBottom ), scrolls: panel.scrollHeight > panel.clientHeight + 1, under };

} );

const overlaps = ( a, b ) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test( 'A world panel is as tall as its content, scrolls inside the viewport when longer, and nothing shows under it', async ( { page }, info ) => {

	await ready( page );
	for ( const [ width, height ] of [ [ 1440, 900 ], [ 768, 1024 ], [ 390, 844 ] ] ) {

		await page.setViewportSize( { width, height } );
		const gap = width <= 700 ? 12 : PANEL_GAP;
		await test.step( `When I open the short Chairlift panel at ${ width } px`, async () => {

			await page.getByRole( 'button', { name: 'Chairlift', exact: true } ).click();
			await expect( openPanel( page ) ).toBeVisible();

		} );
		await test.step( 'Then the glass ends at the last line and no other card sits under it', async () => {

			const box = await shellBox( page );
			expect( box.bottom - box.last, `glass below the last line at ${ width }: ${ ( box.bottom - box.last ).toFixed( 0 ) } px, padding ${ box.pad }` ).toBeLessThanOrEqual( box.pad + 2 );
			expect( box.bottom ).toBeLessThanOrEqual( height - gap + 1 );
			expect( box.under.filter( c => /^(tw-boat|tw-depth|gm-|av-|gl-|evac-|rh\b)/.test( c ) ), `under the panel at ${ width }: ${ box.under.join( ', ' ) }` ).toEqual( [] );
			await page.screenshot( { path: info.outputPath( `shell-chairlift-${ width }.png` ) } );

		} );
		await test.step( 'When I open the long Disasters panel instead', async () => {

			await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
			await expect( openPanel( page ) ).toHaveCount( 1 );

		} );
		await test.step( 'Then the panel stays inside the viewport and scrolls its own content', async () => {

			const box = await shellBox( page );
			expect( box.bottom, `panel bottom at ${ width }` ).toBeLessThanOrEqual( height - gap + 1 );
			expect( box.scrolls, `the disasters panel scrolls at ${ width }` ).toBe( true );
			expect( box.under.filter( c => /^(tw-boat|tw-depth|gm-|av-|gl-|evac-|rh\b)/.test( c ) ), `under the panel at ${ width }: ${ box.under.join( ', ' ) }` ).toEqual( [] );
			await page.screenshot( { path: info.outputPath( `shell-disasters-${ width }.png` ) } );

		} );
		await test.step( 'And the tools strip fades at an edge instead of cutting a tool name', async () => {

			const strip = page.locator( '.tw-world-scroll' );
			const more = await strip.evaluate( el => el.scrollWidth > el.clientWidth + 1 );
			if ( more ) await expect( strip ).toHaveClass( /is-more-(left|right)/ );

		} );
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await expect( openPanel( page ) ).toHaveCount( 0 );

	}

} );

test( 'The evacuation hint stays clear of the third-person character', async ( { page }, info ) => {

	test.setTimeout( 180000 );
	const guidance = page.getByRole( 'status', { name: 'Evacuation guidance' } );
	await test.step( 'Given I am walking in third person', async () => {

		await ready( page );
		expect( await page.evaluate( () => window.__app.player.view ) ).toBe( 'third' );

	} );
	await test.step( 'When a tsunami warning starts and I close the laboratory', async () => {

		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'pier' );
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( '18' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await expect( openPanel( page ) ).toHaveCount( 0 );
		await expect( guidance ).toContainText( 'Follow green', { timeout: 30000 } );

	} );
	await test.step( 'Then the hint card does not cover the character', async () => {

		// the character's screen box: a 0.9 m x 2 m x 0.9 m box around the player, projected
		const body = await page.evaluate( () => {

			const app = window.__app, p = app.player.position, V = p.constructor;
			let x0 = Infinity, y0 = Infinity, x1 = - Infinity, y1 = - Infinity;
			for ( const dx of [ - 0.45, 0.45 ] ) for ( const dy of [ - 1, 1 ] ) for ( const dz of [ - 0.45, 0.45 ] ) {

				const v = new V( p.x + dx, p.y + dy, p.z + dz ).project( app.camera );
				const sx = ( v.x + 1 ) / 2 * innerWidth, sy = ( 1 - v.y ) / 2 * innerHeight;
				x0 = Math.min( x0, sx ); x1 = Math.max( x1, sx ); y0 = Math.min( y0, sy ); y1 = Math.max( y1, sy );

			}
			return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

		} );
		const card = await guidance.boundingBox();
		await page.screenshot( { path: info.outputPath( 'guidance-third-person.png' ) } );
		expect( overlaps( card, body ), `hint ${ JSON.stringify( card ) } over the character ${ JSON.stringify( body ) }` ).toBe( false );
		expect( card.x ).toBeGreaterThanOrEqual( 0 );
		expect( card.x + card.width ).toBeLessThanOrEqual( 1440 );

	} );

} );

test( 'The aviation panel wears the shared panel shell', async ( { page }, info ) => {

	await ready( page );
	await page.getByRole( 'button', { name: 'Aviation', exact: true } ).click();
	const title = page.locator( '.av-panel h2' );
	await expect( title ).toHaveText( 'Flight deck' );
	expect( await title.evaluate( el => getComputedStyle( el ).fontFamily ) ).toContain( 'Inter' );
	expect( await page.locator( 'style' ).evaluateAll( styles => styles.some( s => s.textContent.includes( '.av-panel h2' ) ) ), 'the panel injects its own typography' ).toBe( false );
	await page.screenshot( { path: info.outputPath( 'aviation-panel-1440.png' ) } );

} );
