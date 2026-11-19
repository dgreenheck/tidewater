// Island data the car physics needs beyond the heightfield and walker colliders.

// Terrain material per height texel, from the same splat data the renderer uses:
// 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand (firm, near the waterline).
export function terrainMaterialCodes( terrain ) {

	const { res, heights } = terrain;
	const codes = new Uint8Array( res * res );
	for ( let i = 0; i < codes.length; i ++ ) {

		const sand = ( terrain.sand?.[ i ] ?? 255 ) / 255, rock = terrain.rock?.[ i ] ?? 0;
		codes[ i ] = rock > 0.7 && sand < 0.25 ? 2 : sand > 0.3 ? ( heights[ i ] < 0.9 ? 7 : 0 ) : 1;

	}
	return codes;

}

// Palm and tree trunks as solid cylinders for cars only (the walker already steers
// between them). Young palms and banana plants are soft enough to drive through.
export function trunkCylinders( vegetation, terrain ) {

	const out = [];
	const records = vegetation?.records;
	if ( ! records ) return new Float32Array();
	for ( const [ list, radius ] of [ [ records.palms, 0.2 ], [ records.trees, 0.28 ] ] ) {

		for ( const r of list || [] ) {
			if (r.disasterFallen) continue;

			const ground = terrain.heightAt( r.x, r.z );
			out.push( r.x, r.z, radius * ( r.s || 1 ), ground - 0.6, ground + Math.min( 6, r.H || 6 ) );

		}

	}
	return new Float32Array( out );

}

// Camera-only obstacles for the chase boom (never in the car physics): each banana plant as a
// stem cylinder from the ground up through its leaf crown, so the boom comes in front of a plant
// standing between the lens and the car, and its crown (the leaf spread, at leaf height) for a
// small pull when the lens would sit in or just behind the leaves. Flat [ x, z, radius, bottom, top, ... ].
export function cameraPlants( vegetation, terrain ) {

	const stems = [], crowns = [];
	for ( const r of vegetation?.records?.bananas || [] ) {

		const ground = terrain.heightAt( r.x, r.z ), H = r.H || 1.8 * ( r.s || 1 );
		stems.push( r.x, r.z, 0.2 * ( r.s || 1 ), ground - 0.3, ground + 2.0 * H );
		crowns.push( r.x, r.z, 0.9 * H, ground + 0.6 * H, ground + 2.1 * H );

	}
	return { stems: new Float32Array( stems ), crowns: new Float32Array( crowns ) };

}
