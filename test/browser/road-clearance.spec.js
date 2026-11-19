import { test, expect } from '@playwright/test';

// World invariant on the real generated island: nothing solid stands on the road.
// Reads the live route, vegetation records and collision world after the real load;
// only the Google Fonts stylesheet is stubbed.
test( 'No tree trunk, rock or prop stands on or at the edge of any road', async ( { page } ) => {
	await test.step( 'Given the real island has finished generating', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	} );
	let offenders;
	await test.step( 'When every trunk and solid collider is measured against every road segment', async () => {
		offenders = await page.evaluate( () => {
			const app = window.__app, route = app.coastalRoute, found = [];
			const near = ( x, z, radius, what ) => {
				for ( const s of route.segments ) {
					const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, l2 = dx * dx + dz * dz || 1;
					const t = Math.max( 0, Math.min( 1, ( ( x - s.a.x ) * dx + ( z - s.a.z ) * dz ) / l2 ) );
					const gap = Math.hypot( x - s.a.x - dx * t, z - s.a.z - dz * t ) - radius;
					if ( gap < s.path.halfWidth + 1 ) { found.push( `${ what } at (${ x.toFixed( 1 ) }, ${ z.toFixed( 1 ) }) is ${ gap.toFixed( 2 ) } m from the ${ s.path.name } centreline` ); return; }
				}
			};
			const records = app.vegetation?.records || {};
			for ( const r of records.palms || [] ) near( r.x, r.z, 0.2 * ( r.s || 1 ), 'palm' );
			for ( const r of records.trees || [] ) near( r.x, r.z, 0.28 * ( r.s || 1 ), 'tree' );
			for ( const c of app.colliders.cylinders ) near( c.x, c.z, c.radius, `${ c.tag || 'cylinder' } collider` );
			for ( const b of app.colliders.boxes ) {
				if ( ! b.solid || b.tag === 'guardrail' || b.tag === 'rally-car' ) continue;
				near( b.center.x, b.center.z, Math.min( b.half.x, b.half.z ), `${ b.tag || 'box' } collider` );
			}
			return found;
		} );
	} );
	await test.step( 'Then none of them intrudes on the road', async () => { expect( offenders ).toEqual( [] ); } );
} );
