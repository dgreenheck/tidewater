// Progressive building damage (docs/disaster-damage.md, "buildings fail piece by piece").
// World frame, y up, metres, seconds, newtons, pascals. A building record from structure() is
// split once into the parts a real house loses one at a time: openings, wall panels, roof
// covering sheets, roof structure and masonry. Each part fails on its own load against its own
// scattered capacity, so a house sheds its windows, then roof sheets, then panels; it never
// moves as one block (the old whole-record joint assembly tilted in the flood).
import { AIR_DENSITY, GRAVITY } from '../physics/Loads.js';
import { capacityFactor, CAPACITY_COV, STREAM } from './EventRandom.js';

export const FLOOD_DENSITY = 1100; // kg/m^3, sea water carrying sediment (FEMA P-646 2019, sec. 6.5)
export const FLOOD_CD = 2.0; // drag coefficient for a building face (FEMA P-646 eq. 6-6)
export const SURGE_FACTOR = 1.5; // impulsive leading-edge force over the hydrodynamic force (FEMA P-646 eq. 6-7)
export const SURGE_TIME = 2; // s after first wetting that the leading edge acts (declared)
export const MASONRY_DEPTH = 5; // m flow depth below which masonry stands (Suppasri et al. 2013, Nat. Hazards 66)
export const GCPI_ENCLOSED = .18; // internal pressure coefficient, enclosed (ASCE 7-16 table 26.13-1)
export const GCPI_BREACHED = .55; // partially enclosed, once a window or wall has gone
export const LOAD_DURATION = .05; // s: integral of (utilisation - 1) a part survives (declared duration of load)
export const BAY = 3; // m, wall panel width: one sheathed bay (declared)
// s for the inside to fill once a submerged opening has gone: Torricelli inflow 0.6 A sqrt( 2 g h ) through
// 1 m^2 at 1 m head is 2.7 m^3/s, so a 100 m^2 house takes about 37 s to reach 1 m; a few openings halve it.
export const INTERIOR_FILL = 20;

// Declared expected failure winds inside EF DI 2 (WSEC 2006) and the lane's bands, the external
// pressure coefficient each is calibrated at, and an areal mass (kg/m^2) for the loose piece.
export const KINDS = Object.freeze( {
	opening: { wind: 43, cp: .8, areal: 12, order: 0 }, // DI 2 DOD 3 broken glass, expected 96 mph; 4 mm glass and frame
	wall: { wind: 67.5, cp: .8, areal: 25, order: 1 }, // centre of 61-74 m/s; light timber frame wall
	roofCover: { wind: 43.5, cp: 1.25, areal: 6, order: 2 }, // centre of 38-49 m/s; corrugated steel about 5 kg/m^2
	roofFrame: { wind: 55, cp: 1, areal: 15, order: 3 }, // centre of 50-60 m/s; rafters and battens
	masonry: { wind: 74, cp: .8, areal: 400, order: 4 }, // top of the wall band (declared); 0.18 m stone
} );
const capacityPressure = kind => .5 * AIR_DENSITY * KINDS[ kind ].wind ** 2 * ( KINDS[ kind ].cp + GCPI_ENCLOSED ); // Pa

function bounds( s ) {
	const a = s.pos, lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( let i = 0; i < a.length; i += 3 ) for ( let k = 0; k < 3; k ++ ) { lo[ k ] = Math.min( lo[ k ], a[ i + k ] ); hi[ k ] = Math.max( hi[ k ], a[ i + k ] ); }
	return { lo, hi };
}

// Split a saved record (spans carry world positions in s.pos) into components. Returns null when the
// record has no roof covering: it is a deck or a fixture and keeps the jointed member path.
export function buildingComponents( record ) {
	const tagged = record.spans.map( s => ( { s, m: s.member?.material, ...bounds( s ) } ) );
	const roofing = tagged.filter( t => t.m === 'roofMetal' || t.m === 'thatch' );
	if ( ! roofing.length ) return null;
	const eave = Math.min( ...roofing.map( t => t.lo[ 1 ] ) ); // m, lowest roof sheet edge
	const c = record.center, h = record.half, groups = new Map(), loose = [];
	const roofLo = [ Math.min( ...roofing.map( t => t.lo[ 0 ] ) ), Math.min( ...roofing.map( t => t.lo[ 2 ] ) ) ];
	const roofHi = [ Math.max( ...roofing.map( t => t.hi[ 0 ] ) ), Math.max( ...roofing.map( t => t.hi[ 2 ] ) ) ];
	const add = ( key, kind, t, extra ) => { let g = groups.get( key ); if ( ! g ) { g = { kind, spans: [], lo: [ Infinity, Infinity, Infinity ], hi: [ - Infinity, - Infinity, - Infinity ], ...extra }; groups.set( key, g ); } g.spans.push( t.s ); for ( let k = 0; k < 3; k ++ ) { g.lo[ k ] = Math.min( g.lo[ k ], t.lo[ k ] ); g.hi[ k ] = Math.max( g.hi[ k ], t.hi[ k ] ); } return g; };
	const side = t => { const x = ( t.lo[ 0 ] + t.hi[ 0 ] ) / 2 - c.x, z = ( t.lo[ 2 ] + t.hi[ 2 ] ) / 2 - c.z, alongX = Math.abs( z ) / Math.max( .5, h.z ) > Math.abs( x ) / Math.max( .5, h.x ); return alongX ? { n: [ 0, Math.sign( z ) || 1 ], along: 0 } : { n: [ Math.sign( x ) || 1, 0 ], along: 2 }; };
	for ( const t of tagged ) {
		const d = [ t.hi[ 0 ] - t.lo[ 0 ], t.hi[ 1 ] - t.lo[ 1 ], t.hi[ 2 ] - t.lo[ 2 ] ], mid = ( t.lo[ 1 ] + t.hi[ 1 ] ) / 2;
		const thin = Math.min( d[ 0 ], d[ 2 ] ), wide = Math.max( d[ 0 ], d[ 2 ] );
		if ( t.m === 'roofMetal' || t.m === 'thatch' ) {
			// Sheets reaching within 1 m of the roof outline sit in the edge and corner zones (Cp -1.5), the rest in the field (-1.0).
			const edge = t.lo[ 0 ] - roofLo[ 0 ] < 1 || roofHi[ 0 ] - t.hi[ 0 ] < 1 || t.lo[ 2 ] - roofLo[ 2 ] < 1 || roofHi[ 2 ] - t.hi[ 2 ] < 1;
			add( 'cover' + groups.size, 'roofCover', t, { cpe: edge ? 1.5 : 1, area: Math.max( .2, d[ 0 ] * d[ 2 ] ), heavy: t.m === 'thatch' } );
		} else if ( t.m === 'glass' || ( t.m === 'wood' && thin < .15 && wide > .6 && wide < 1.4 && d[ 1 ] > 1.7 && d[ 1 ] < 2.5 ) ) {
			const f = side( t ); add( 'open' + groups.size, 'opening', t, { n: f.n, area: Math.max( .1, wide * d[ 1 ] ) } );
		} else if ( t.m === 'stone' ) {
			// Binned by 3 m cell and by height: a chimney and the pad stones at its foot are separate parts, or
			// the chimney's exposed height carried stones lying in the soil off with it.
			add( 'stone' + Math.floor( ( t.lo[ 0 ] + t.hi[ 0 ] ) / 2 / BAY ) + ':' + Math.floor( ( t.lo[ 2 ] + t.hi[ 2 ] ) / 2 / BAY ) + ':' + ( d[ 1 ] > BAY ? 't' : 'l' ), 'masonry', t, { n: null } );
		} else if ( t.m === 'wood' && mid >= eave - .1 ) {
			add( 'frame' + ( ( t.lo[ 0 ] + t.hi[ 0 ] ) / 2 > c.x ? 1 : 0 ) + ( ( t.lo[ 2 ] + t.hi[ 2 ] ) / 2 > c.z ? 2 : 0 ), 'roofFrame', t, {} );
		} else if ( t.m === 'wood' && ( d[ 1 ] < .15 || ( d[ 0 ] < .4 && d[ 2 ] < .4 && t.lo[ 1 ] < ( record.lo?.y ?? - Infinity ) + 3 ) ) ) {
			loose.push( { t, base: true } ); // floor decking, steps and stilt posts: the platform stays (FEMA P-55 elevated piles survive)
		} else if ( t.m === 'wood' ) {
			const f = side( t ), along = ( t.lo[ f.along ] + t.hi[ f.along ] ) / 2;
			add( 'wall' + f.n.join( ',' ) + ':' + Math.floor( along / BAY ), 'wall', t, { n: f.n } );
		} else loose.push( { t } );
	}
	const list = [ ...groups.values() ];
	for ( const g of list ) {
		const d = [ g.hi[ 0 ] - g.lo[ 0 ], g.hi[ 1 ] - g.lo[ 1 ], g.hi[ 2 ] - g.lo[ 2 ] ];
		g.center = [ ( g.lo[ 0 ] + g.hi[ 0 ] ) / 2, ( g.lo[ 1 ] + g.hi[ 1 ] ) / 2, ( g.lo[ 2 ] + g.hi[ 2 ] ) / 2 ];
		if ( g.kind === 'wall' || g.kind === 'masonry' ) g.area = Math.max( .2, Math.max( d[ 0 ], d[ 2 ] ) * d[ 1 ] );
		if ( g.kind === 'roofFrame' ) g.area = Math.max( .2, d[ 0 ] * d[ 2 ] );
		g.width = Math.max( .1, Math.max( d[ 0 ], d[ 2 ] ) ); // m, the face a flow meets
		g.mass = g.area * ( g.heavy ? 35 : KINDS[ g.kind ].areal ); // kg; thatch 35 kg/m^2
		g.children = [];
	}
	const inside = ( p, g ) => p[ 0 ] >= g.lo[ 0 ] - .3 && p[ 0 ] <= g.hi[ 0 ] + .3 && p[ 1 ] >= g.lo[ 1 ] - .3 && p[ 1 ] <= g.hi[ 1 ] + .3 && p[ 2 ] >= g.lo[ 2 ] - .3 && p[ 2 ] <= g.hi[ 2 ] + .3;
	// A wall panel carries the openings set in it; a roof side carries the sheets on it.
	for ( const g of list ) {
		const owner = g.kind === 'opening' ? list.find( w => w.kind === 'wall' && w.n[ 0 ] === g.n[ 0 ] && w.n[ 1 ] === g.n[ 1 ] && inside( g.center, w ) ) : g.kind === 'roofCover' ? list.find( w => w.kind === 'roofFrame' && inside( g.center, w ) ) : null;
		if ( owner ) owner.children.push( g );
	}
	// The part's own spans end here; the fittings below ride along but do not shape its wall collider.
	for ( const g of list ) g.own = g.spans.length;
	// Fittings (hardware, rope, nets, flags) ride with the nearest part; next to the platform they stay.
	for ( const { t, base } of loose ) {
		if ( base ) continue;
		const p = [ ( t.lo[ 0 ] + t.hi[ 0 ] ) / 2, ( t.lo[ 1 ] + t.hi[ 1 ] ) / 2, ( t.lo[ 2 ] + t.hi[ 2 ] ) / 2 ];
		let best = null, bestD = 1.5; // m: farther than this from any part, the fitting belongs to the platform
		for ( const g of list ) { const dd = Math.hypot( ...[ 0, 1, 2 ].map( k => Math.max( 0, g.lo[ k ] - p[ k ], p[ k ] - g.hi[ k ] ) ) ); if ( dd < bestD ) { bestD = dd; best = g; } }
		if ( best ) best.spans.push( t.s );
	}
	list.sort( ( a, b ) => KINDS[ a.kind ].order - KINDS[ b.kind ].order );
	list.forEach( ( g, i ) => { g.index = i; g.failed = false; g.damage = 0; g.u = 0; } );
	return list;
}

// One frame of loads on a record's standing components. s is the field sample at the record centre
// (wind wx wy wz, water surface height, flow ux uz, ground shake in m/s^2), ground the terrain height
// under it, seed the event seed. fail( component ) is called for each part that lets go this frame,
// children included, in failure order. Returns the largest utilisation.
export function stepComponents( record, s, ground, dt, seed, anchorG, fail ) {
	const list = record.components;
	const V2 = finite( s.wx ) ** 2 + finite( s.wy ) ** 2 + finite( s.wz ) ** 2, q = .5 * AIR_DENSITY * V2, Vh = Math.hypot( finite( s.wx ), finite( s.wz ) ) || 1;
	const level = Number.isFinite( s.height ) ? s.height : - Infinity, u2 = finite( s.ux ) ** 2 + finite( s.uz ) ** 2, uh = Math.sqrt( u2 ) || 1;
	if ( level > ground + .05 ) record.wetTime = ( record.wetTime ?? 0 ) + dt;
	const surge = record.wetTime > 0 && record.wetTime < SURGE_TIME ? SURGE_FACTOR : 1, gcpi = record.breached ? GCPI_BREACHED : GCPI_ENCLOSED;
	const shake = finite( s.shake ), cov = CAPACITY_COV[ record.material ] ?? CAPACITY_COV.timber;
	let peak = 0;
	for ( const c of list ) {
		if ( c.failed ) continue;
		if ( c.factor === undefined || c.seed !== seed ) { c.seed = seed; c.factor = capacityFactor( seed, STREAM.component, record.scatterIndex * 4096 + c.index, cov ); }
		const capacity = capacityPressure( c.kind ) * c.area * c.factor; // N
		// Wind loads only the height standing clear of the soil, read at the part's own ground (c.ground) when
		// the record set it. Without this a stilt pad stone 73% in the ground took the 80 m/s core wind on its
		// whole face and flew (browser test: 23 of 80 masonry parts failed under the tornado).
		const tall = c.hi[ 1 ] - c.lo[ 1 ], exposed = tall > 0 ? Math.min( 1, Math.max( 0, ( c.hi[ 1 ] - ( c.ground ?? ground ) ) / tall ) ) : 1;
		let load; // N
		if ( c.kind === 'roofCover' || c.kind === 'roofFrame' ) load = q * ( ( c.cpe ?? 1 ) + gcpi ) * c.area * exposed;
		else {
			// Walls and openings: windward +0.8, side -0.7, leeward -0.5 (ASCE 7-16 fig. 27.3-1), worst-case internal sign.
			const facing = c.n ? - ( c.n[ 0 ] * finite( s.wx ) + c.n[ 1 ] * finite( s.wz ) ) / Vh : 1;
			load = q * ( ( facing > .5 ? .8 : facing < - .5 ? .5 : .7 ) + gcpi ) * c.area * exposed;
			const wet = Math.min( Math.max( 0, level - c.lo[ 1 ] ), c.hi[ 1 ] - c.lo[ 1 ] ); // m of this part under water
			if ( wet > 0 && ( c.kind !== 'masonry' || level - ground > MASONRY_DEPTH ) ) {
				const into = c.n ? Math.max( 0, - ( c.n[ 0 ] * finite( s.ux ) + c.n[ 1 ] * finite( s.uz ) ) / uh ) : 1;
				load += .5 * FLOOD_DENSITY * FLOOD_CD * c.width * wet * u2 * into * surge; // FEMA P-646 eq. 6-6, 6-7
				// Hydrostatic push while the inside is still dry: rho g b integral of depth over the wet height.
				if ( ! ( record.wetTime - record.floodedAt > INTERIOR_FILL ) ) load += FLOOD_DENSITY * GRAVITY * c.width * wet * ( level - c.lo[ 1 ] - wet / 2 );
			}
		}
		let u = load / capacity;
		// Ground shaking racks walls, frames and masonry against the old whole-house anchor capacity in g.
		if ( shake > 0 && c.kind !== 'opening' && c.kind !== 'roofCover' ) u = Math.max( u, shake / ( anchorG * GRAVITY * c.factor ) );
		c.u = u; peak = Math.max( peak, u );
		c.damage = Math.max( 0, c.damage + dt * ( u > 1 ? u - 1 : - .2 ) );
		if ( c.damage >= LOAD_DURATION ) release( record, c, level, fail );
	}
	return peak;
}
function release( record, c, level, fail ) {
	if ( c.failed ) return;
	c.failed = true;
	if ( c.kind === 'opening' || c.kind === 'wall' ) { record.breached = true; if ( c.lo[ 1 ] < level && record.floodedAt === undefined ) record.floodedAt = record.wetTime ?? 0; }
	fail( c );
	for ( const child of c.children ) release( record, child, level, fail );
}
const finite = x => Number.isFinite( x ) ? x : 0;
