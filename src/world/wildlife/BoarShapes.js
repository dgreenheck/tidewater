import * as THREE from '../../engine/index.js';

// Anatomical rest mesh: metres, +z forward, y=0 soles. Bone tags: -1 torso/neck, 0..3 legs,
// 4 head, 5 tail, 6/7 right/left ear. The fur pass samples the actual coat-bearing triangles.
export const BOAR_PART = { COAT: 0, EAR: 1, NOSE: 2, HOOF: 3, TUSK: 4, EYE: 5, BRISTLE: 6, NOSTRIL: 7, SKIN: 9 };

// z, section height, half width, dorsal radius, ventral radius.
export const BOAR_BODY_STATIONS = [
	[ - 0.704, 0.610, 0.018, 0.038, 0.040 ], [ - 0.654, 0.628, 0.128, 0.128, 0.131 ],
	[ - 0.555, 0.640, 0.217, 0.174, 0.198 ], [ - 0.410, 0.634, 0.259, 0.210, 0.237 ],
	[ - 0.240, 0.624, 0.291, 0.253, 0.267 ], [ - 0.060, 0.632, 0.311, 0.281, 0.284 ],
	[ 0.125, 0.639, 0.319, 0.298, 0.294 ], [ 0.245, 0.635, 0.307, 0.291, 0.290 ],
	[ 0.365, 0.610, 0.278, 0.255, 0.245 ], [ 0.455, 0.578, 0.245, 0.213, 0.202 ],
	[ 0.545, 0.536, 0.213, 0.221, 0.165 ], [ 0.625, 0.492, 0.189, 0.173, 0.140 ],
	[ 0.710, 0.455, 0.153, 0.128, 0.104 ], [ 0.815, 0.421, 0.121, 0.101, 0.075 ],
	[ 0.925, 0.403, 0.106, 0.075, 0.058 ], [ 1.077, 0.397, 0.105, 0.065, 0.058 ],
];
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const bell = ( x, c, w ) => Math.exp( - ( ( ( x - c ) / w ) ** 2 ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const normalize = ( v ) => { const n = Math.hypot( ...v ); return v.map( ( x ) => x / Math.max( n, 1e-12 ) ); };
const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];
const sub = ( a, b ) => a.map( ( x, k ) => x - b[ k ] );
const addScaled = ( p, v, s ) => p.map( ( x, k ) => x + v[ k ] * s );

// Nonuniform cubic Hermite sections give continuous tangents without a conical station loft.
function section( stations, z ) {
	const zz = clamp( z, stations[ 0 ][ 0 ], stations.at( - 1 )[ 0 ] );
	let i = 0;
	while ( i < stations.length - 2 && zz > stations[ i + 1 ][ 0 ] ) i ++;
	const a = stations[ i ], b = stations[ i + 1 ];
	const before = stations[ Math.max( 0, i - 1 ) ], after = stations[ Math.min( stations.length - 1, i + 2 ) ];
	const dz = b[ 0 ] - a[ 0 ], t = ( zz - a[ 0 ] ) / dz, t2 = t * t, t3 = t2 * t;
	return [ zz, ...a.slice( 1 ).map( ( value, j ) => {
		const k = j + 1, ma = ( b[ k ] - before[ k ] ) / ( b[ 0 ] - before[ 0 ] ), mb = ( after[ k ] - a[ k ] ) / ( after[ 0 ] - a[ 0 ] );
		return ( 2 * t3 - 3 * t2 + 1 ) * value + ( t3 - 2 * t2 + t ) * ma * dz + ( - 2 * t3 + 3 * t2 ) * b[ k ] + ( t3 - t2 ) * mb * dz;
	} ) ];
}
function bodyPoint( z, angle ) {
	const [ zz, cy, w, up, down ] = section( BOAR_BODY_STATIONS, z ), co = Math.cos( angle ), si = Math.sin( angle ), s = Math.sign( co );
	let x = co * w, y = cy + si * ( si > 0 ? up : down );
	// Shoulder shield, haunch, flank hollow and a dorsal scapular ridge.
	x += co * ( 0.018 * bell( zz, 0.18, 0.17 ) + 0.012 * bell( zz, - 0.48, 0.13 ) - 0.012 * bell( zz, - 0.30, 0.13 ) ) * ( 1 - si * si );
	y += 0.007 * bell( zz, 0.16, 0.15 ) * Math.max( 0, si ) ** 6;
	// Masseter and cheekbone, a raised supraorbital brow, and the recessed orbit below it.
	x += s * 0.018 * bell( zz, 0.595, 0.105 ) * bell( si, - 0.13, 0.5 );
	x += s * 0.010 * bell( zz, 0.57, 0.10 ) * bell( si, 0.78, 0.17 );
	y += 0.012 * bell( zz, 0.56, 0.065 ) * bell( si, 0.80, 0.14 );
	const socket = bell( zz, 0.589, 0.037 ) * bell( si, 0.60, 0.125 );
	x -= s * 0.012 * socket; y -= 0.003 * socket;
	y += 0.013 * bell( zz, 0.765, 0.135 ) * Math.max( 0, si ) ** 10;
	x += s * 0.006 * bell( zz, 0.91, 0.13 ) * bell( si, - 0.42, 0.32 );
	return [ x, y, zz ];
}
export function sampleBoarBody( z, angle ) {
	const position = bodyPoint( z, angle );
	const angular = sub( bodyPoint( z, angle + 0.0001 ), bodyPoint( z, angle - 0.0001 ) );
	const along = sub( bodyPoint( z + 0.0001, angle ), bodyPoint( z - 0.0001, angle ) );
	return { position, normal: normalize( cross( angular, along ) ) };
}

export function buildBoar() {
	const p = [], tags = [], idx = [], surfaces = {}, noseSeams = [];
	const vertex = ( point, part = 0, bone = - 1 ) => { const i = p.length / 3; p.push( ...point ); tags.push( part, bone ); return i; };
	const ringStrip = ( base, rows, sides ) => {
		for ( let i = 0; i < rows - 1; i ++ ) for ( let j = 0; j < sides; j ++ ) {
			const a = base + i * sides + j, b = base + i * sides + ( j + 1 ) % sides;
			idx.push( a, b, a + sides, b, b + sides, a + sides );
		}
	};
	const cap = ( base, sides, point, part, bone, end ) => {
		const c = vertex( point, part, bone );
		for ( let j = 0; j < sides; j ++ ) { const a = base + j, b = base + ( j + 1 ) % sides; idx.push( c, end ? a : b, end ? b : a ); }
	};
	const loft = ( rings, part = 0, bone = - 1, sides = 16, square = 1, caps = true ) => {
		const base = p.length / 3;
		for ( const [ c, u, v ] of rings ) for ( let j = 0; j < sides; j ++ ) {
			const a = j / sides * Math.PI * 2, co = Math.sign( Math.cos( a ) ) * Math.abs( Math.cos( a ) ) ** square, si = Math.sign( Math.sin( a ) ) * Math.abs( Math.sin( a ) ) ** square;
			vertex( c.map( ( x, k ) => x + u[ k ] * co + v[ k ] * si ), part, bone );
		}
		ringStrip( base, rings.length, sides );
		if ( caps ) {
			cap( base, sides, rings[ 0 ][ 0 ], part, bone, false );
			cap( base + ( rings.length - 1 ) * sides, sides, rings.at( - 1 )[ 0 ], part, bone, true );
		}
		return { start: base, count: p.length / 3 - base };
	};
	const tube = ( stations, part, bone, sides = 10, flutes = 0 ) => {
		const base = p.length / 3;
		const rings = stations.map( ( a, i ) => {
			const c = a.slice( 0, 3 ), t = normalize( sub( stations[ Math.min( stations.length - 1, i + 1 ) ].slice( 0, 3 ), stations[ Math.max( 0, i - 1 ) ].slice( 0, 3 ) ) );
			const u = normalize( cross( Math.abs( t[ 1 ] ) > 0.9 ? [ 1, 0, 0 ] : [ 0, 1, 0 ], t ) ), v = cross( t, u );
			return [ c, u.map( ( x ) => x * a[ 3 ] ), v.map( ( x ) => x * a[ 3 ] * ( a[ 4 ] || 1 ) ) ];
		} );
		const result = loft( rings, part, bone, sides );
		if ( flutes ) for ( let i = 0; i < rings.length; i ++ ) for ( let j = 0; j < sides; j ++ ) {
			const o = ( base + i * sides + j ) * 3, c = rings[ i ][ 0 ], relief = 1 + flutes * Math.cos( j / sides * Math.PI * 10 + i * 0.11 );
			for ( let k = 0; k < 3; k ++ ) p[ o + k ] = c[ k ] + ( p[ o + k ] - c[ k ] ) * relief;
		}
		return result;
	};
	const smoothPath = ( points, steps ) => {
		const stations = points.map( ( a, i ) => [ i, ...a ] );
		return Array.from( { length: steps }, ( _, i ) => section( stations, i / ( steps - 1 ) * ( points.length - 1 ) ).slice( 1 ) );
	};
	const profileLoft = ( stations, rows, sides, part, bone ) => {
		const rings = Array.from( { length: rows }, ( _, i ) => section( stations, lerp( stations[ 0 ][ 0 ], stations.at( - 1 )[ 0 ], i / ( rows - 1 ) ) ) );
		const base = p.length / 3;
		for ( const [ z, y, w, up, down ] of rings ) for ( let j = 0; j < sides; j ++ ) {
			const a = j / sides * Math.PI * 2, si = Math.sin( a ); vertex( [ w * Math.cos( a ), y + si * ( si > 0 ? up : down ), z ], part, bone );
		}
		ringStrip( base, rows, sides );
		cap( base, sides, [ 0, rings[ 0 ][ 1 ], rings[ 0 ][ 0 ] ], part, bone, false );
		cap( base + ( rows - 1 ) * sides, sides, [ 0, rings.at( - 1 )[ 1 ], rings.at( - 1 )[ 0 ] ], part, bone, true );
		return { start: base, count: p.length / 3 - base };
	};

	// Continuous trunk/skull; its anterior rim continues into the soft nose pad.
	const BODY_ROWS = 72, BODY_SIDES = 40, bodyBase = p.length / 3;
	for ( let i = 0; i < BODY_ROWS; i ++ ) for ( let j = 0; j < BODY_SIDES; j ++ ) vertex( bodyPoint( lerp( - 0.704, 1.077, i / ( BODY_ROWS - 1 ) ), j / BODY_SIDES * Math.PI * 2 ) );
	ringStrip( bodyBase, BODY_ROWS, BODY_SIDES );
	cap( bodyBase, BODY_SIDES, [ 0, 0.61, - 0.708 ], 0, - 1, false );
	surfaces.body = { start: bodyBase, count: BODY_ROWS * BODY_SIDES, rows: BODY_ROWS, sides: BODY_SIDES };
	// Deep rounded mandible and cheek; the upper surface is buried in the maxilla.
	surfaces.jaw = profileLoft( [
		[ 0.455, 0.447, 0.125, 0.067, 0.030 ], [ 0.535, 0.422, 0.178, 0.073, 0.073 ],
		[ 0.625, 0.390, 0.158, 0.057, 0.071 ], [ 0.745, 0.367, 0.124, 0.050, 0.047 ],
		[ 0.885, 0.359, 0.096, 0.038, 0.028 ], [ 1.040, 0.362, 0.074, 0.027, 0.018 ],
	], 20, 24, 0, 4 );

	// Muscular upper limbs, bony wrists/hocks and tapered pasterns preserve the pose landmarks.
	surfaces.legs = [];
	for ( let bone = 0; bone < 4; bone ++ ) {
		const s = bone % 2 ? - 1 : 1, front = bone < 2, z = front ? 0.245 : - 0.43;
		const stations = front ? [
			[ 0.075, 0.22, z + 0.025, 0.042, 0.048 ], [ 0.125, 0.22, z + 0.014, 0.049, 0.052 ],
			[ 0.185, 0.219, z - 0.005, 0.042, 0.047 ], [ 0.275, 0.218, z - 0.036, 0.056, 0.062 ],
			[ 0.375, 0.212, z - 0.025, 0.071, 0.086 ], [ 0.475, 0.200, z - 0.012, 0.089, 0.112 ],
			[ 0.580, 0.175, z - 0.005, 0.112, 0.134 ], [ 0.690, 0.145, z - 0.01, 0.100, 0.105 ],
		] : [
			[ 0.075, 0.22, z - 0.012, 0.039, 0.047 ], [ 0.130, 0.22, z - 0.020, 0.045, 0.052 ],
			[ 0.190, 0.220, z - 0.012, 0.041, 0.054 ], [ 0.280, 0.220, z + 0.055, 0.058, 0.064 ],
			[ 0.375, 0.213, z + 0.079, 0.086, 0.102 ], [ 0.480, 0.193, z + 0.028, 0.104, 0.135 ],
			[ 0.590, 0.157, z - 0.002, 0.099, 0.133 ], [ 0.665, 0.140, z - 0.008, 0.072, 0.102 ],
		];
		const rings = Array.from( { length: 19 }, ( _, i ) => {
			const [ y, x, zz, rx, rz ] = section( stations, lerp( stations[ 0 ][ 0 ], stations.at( - 1 )[ 0 ], i / 18 ) );
			return [ [ s * x, y, zz ], [ rx, 0, 0 ], [ 0, 0, - rz ] ];
		} );
		surfaces.legs.push( loft( rings, 0, bone, 16 ) );
		const footZ = z + ( front ? 0.043 : 0.012 ), footX = s * 0.22;
		for ( const toe of [ - 1, 1 ] ) {
			const hp = [ [ 0, 0.029, 0.062 ], [ 0.007, 0.034, 0.068 ], [ 0.020, 0.036, 0.071 ], [ 0.041, 0.034, 0.067 ], [ 0.064, 0.029, 0.055 ], [ 0.083, 0.022, 0.044 ], [ 0.091, 0.015, 0.034 ] ];
			loft( hp.map( ( [ y, rx, rz ] ) => [ [ footX + toe * 0.037, y, footZ + ( 0.04 - y ) * 0.14 ], [ rx, 0, 0 ], [ 0, 0, - rz ] ] ), BOAR_PART.HOOF, bone, 16, 0.66 );
			loft( [ [ 0.078, 0.003, 0.005 ], [ 0.090, 0.010, 0.014 ], [ 0.110, 0.013, 0.017 ], [ 0.123, 0.007, 0.010 ] ].map( ( [ y, rx, rz ] ) => [ [ footX + toe * 0.036, y, footZ - 0.071 + ( y - 0.1 ) * 0.5 ], [ rx, 0, 0 ], [ 0, 0, - rz ] ] ), BOAR_PART.HOOF, bone, 8 );
		}
	}

	// Convex rooting pad and perforated nostril surface, with dark wells behind the openings.
	const noseHeight = ( x, y ) => 1.095 - 0.006 * ( ( x / 0.103 ) ** 2 + ( ( y - 0.397 ) / 0.063 ) ** 2 );
	loft( [ [ 1.064, 0.105, 0.063 ], [ 1.080, 0.108, 0.066 ], [ 1.089, 0.103, 0.063 ] ].map( ( [ z, x, y ] ) => [ [ 0, 0.397, z ], [ x, 0, 0 ], [ 0, y, 0 ] ] ), BOAR_PART.NOSE, 4, 40, 1, false );
	for ( const s of [ - 1, 1 ] ) {
		const N = 32, rows = 7, base = p.length / 3, cx = s * 0.047, cy = 0.408;
		for ( let row = 0; row < rows; row ++ ) for ( let j = 0; j < N; j ++ ) {
			const a = j / N * Math.PI * 2, dx = Math.cos( a ), dy = Math.sin( a ) * 0.75;
			const ax = 0.103, ay = 0.063, yy = cy - 0.397;
			const A = dx * dx / ( ax * ax ) + dy * dy / ( ay * ay ), B = 2 * ( cx * dx / ( ax * ax ) + yy * dy / ( ay * ay ) ), C = cx * cx / ( ax * ax ) + yy * yy / ( ay * ay ) - 1;
			let reach = ( - B + Math.sqrt( Math.max( 0, B * B - 4 * A * C ) ) ) / ( 2 * A );
			if ( dx * s < 0 ) reach = Math.min( reach, - cx / dx );
			const t = row / ( rows - 1 ), innerX = cx + dx * 0.0175, innerY = cy + dy * 0.016;
			const x = lerp( innerX, cx + dx * reach, t ), y = lerp( innerY, cy + dy * reach, t );
			const vi = vertex( [ x, y, noseHeight( x, y ) ], BOAR_PART.NOSE, 4 );
			if ( Math.abs( x ) < 1e-6 ) noseSeams.push( vi );
		}
		for ( let i = 0; i < rows - 1; i ++ ) for ( let j = 0; j < N; j ++ ) {
			const a = base + i * N + j, b = base + i * N + ( j + 1 ) % N; idx.push( a, a + N, b, b, a + N, b + N );
		}
		const well = p.length / 3;
		for ( let row = 0; row < 4; row ++ ) for ( let j = 0; j < N; j ++ ) {
			const a = j / N * Math.PI * 2, t = row / 3;
			vertex( [ cx + Math.cos( a ) * lerp( 0.0175, 0.010, t ), cy + Math.sin( a ) * lerp( 0.012, 0.007, t ), lerp( noseHeight( cx + Math.cos( a ) * 0.0175, cy + Math.sin( a ) * 0.012 ), 1.065, t ) ], BOAR_PART.NOSTRIL, 4 );
		}
		// Ring order travels backwards into the snout, making these normals face into the well.
		ringStrip( well, 4, N );
		cap( well + 3 * N, N, [ cx, cy, 1.065 ], BOAR_PART.NOSTRIL, 4, true );

		// Small wet corneal dome, inset orbital socket and thick almond-shaped eyelids.
		const eye = sampleBoarBody( 0.589, s > 0 ? Math.asin( 0.60 ) : Math.PI - Math.asin( 0.60 ) );
		const normal = normalize( [ s * 0.93, 0.25, 0.24 ] ), u = normalize( sub( [ 0, 0, 1 ], normal.map( ( x ) => x * normal[ 2 ] ) ) ), v = cross( normal, u );
		const centre = addScaled( eye.position, normal, 0.0015 ), eyeBase = p.length / 3, sides = 24;
		for ( let ring = 1; ring <= 5; ring ++ ) for ( let j = 0; j < sides; j ++ ) {
			const a = j / sides * Math.PI * 2, r = ring / 5;
			let point = addScaled( centre, u, Math.cos( a ) * 0.0185 * r );
			point = addScaled( point, v, Math.sign( Math.sin( a ) ) * Math.abs( Math.sin( a ) ) ** 1.35 * 0.0105 * r );
			vertex( addScaled( point, normal, 0.006 * ( 1 - r * r ) ), BOAR_PART.EYE, 4 );
		}
		for ( let i = 0; i < 4; i ++ ) for ( let j = 0; j < sides; j ++ ) { const a = eyeBase + i * sides + j, b = eyeBase + i * sides + ( j + 1 ) % sides; idx.push( a, a + sides, b, b, a + sides, b + sides ); }
		cap( eyeBase, sides, addScaled( centre, normal, 0.006 ), BOAR_PART.EYE, 4, true );
		const eyelid = [];
		for ( let j = 0; j <= 32; j ++ ) {
			const a = j / 32 * Math.PI * 2;
			let point = addScaled( centre, u, Math.cos( a ) * 0.0202 );
			point = addScaled( point, v, Math.sign( Math.sin( a ) ) * Math.abs( Math.sin( a ) ) ** 1.22 * 0.0126 );
			point = addScaled( point, normal, 0.001 );
			eyelid.push( [ ...point, 0.0023 + Math.max( 0, - Math.sin( a ) ) * 0.0017 ] );
		}
		tube( eyelid, BOAR_PART.SKIN, 4, 6 );
		// Low fleshy lip roll and a short recessed mouth corner, not an exposed mouth wire.
		tube( smoothPath( [ [ s * 0.150, 0.386, 0.66, 0.004 ], [ s * 0.123, 0.369, 0.77, 0.0045 ], [ s * 0.099, 0.358, 0.91, 0.003 ], [ s * 0.081, 0.364, 1.027, 0.0015 ] ], 16 ), BOAR_PART.SKIN, 4, 8 );
		tube( smoothPath( [ [ s * 0.143, 0.377, 0.718, 0.0014 ], [ s * 0.118, 0.364, 0.813, 0.0012 ], [ s * 0.099, 0.356, 0.922, 0.0010 ], [ s * 0.081, 0.362, 1.02, 0.0005 ] ], 16 ), BOAR_PART.NOSTRIL, 4, 6 );
		// Rear-set lower canines sweep out/up with lightly fluted dentine and asymmetric wear.
		const wear = s > 0 ? 1 : 0.94, tusk = [];
		for ( let i = 0; i < 19; i ++ ) {
			const t = i / 18, q = 1 - t, a = [ s * 0.126, 0.367, 0.795 ], b = [ s * 0.211, 0.346, 0.784 ], c = [ s * 0.247, 0.447, 0.844 ], d = [ s * 0.213, 0.367 + 0.172 * wear, 0.884 ];
			tusk.push( [ ...a.map( ( x, k ) => q ** 3 * x + 3 * q * q * t * b[ k ] + 3 * q * t * t * c[ k ] + t ** 3 * d[ k ] ), 0.026 * ( 1 - t ) ** 0.77 + 0.0006, 0.8 ] );
		}
		tube( tusk, BOAR_PART.TUSK, 4, 12, 0.022 );
		tube( smoothPath( [ [ s * 0.141, 0.402, 0.787, 0.017 ], [ s * 0.181, 0.405, 0.80, 0.013 ], [ s * 0.197, 0.386, 0.80, 0.003 ] ], 10 ), BOAR_PART.TUSK, 4, 10, 0.018 );

		// A rounded leaf-shaped ear with a true concave concha, thick skin and rounded rim.
		{
		const bone = s > 0 ? 6 : 7, rows = 15, columns = 15, base = p.length / 3;
		const earNormal = normalize( [ s * 0.50, 0.02, 0.87 ] ), across = normalize( [ s * 0.80, - 0.39, - 0.45 ] );
		const earPoint = ( t, w, back = false ) => {
			const width = section( [ [ 0, 0.042 ], [ 0.22, 0.080 ], [ 0.5, 0.071 ], [ 0.77, 0.043 ], [ 1, 0.003 ] ], t )[ 1 ];
			const centre = [ s * ( 0.160 + 0.153 * t ), 0.683 + 0.234 * t, 0.482 - 0.012 * t + 0.021 * Math.sin( Math.PI * t ) ];
			let point = addScaled( centre, across, w * width );
			return addScaled( point, earNormal, - 0.031 * ( 1 - w * w ) * Math.sin( Math.PI * t ) ** 0.7 - ( back ? 0.011 + 0.004 * Math.sin( Math.PI * t ) : 0 ) );
		};
		for ( const back of [ false, true ] ) for ( let i = 0; i < rows; i ++ ) for ( let j = 0; j < columns; j ++ ) vertex( earPoint( i / ( rows - 1 ), j / ( columns - 1 ) * 2 - 1, back ), back ? 0 : BOAR_PART.EAR, bone );
		const frontCount = rows * columns;
		for ( let layer = 0; layer < 2; layer ++ ) for ( let i = 0; i < rows - 1; i ++ ) for ( let j = 0; j < columns - 1; j ++ ) {
			const a = base + layer * frontCount + i * columns + j, b = a + 1, c = a + columns, d = c + 1, flip = ( s < 0 ) !== ( layer === 1 );
			idx.push( ...( flip ? [ a, c, b, b, c, d ] : [ a, b, c, b, d, c ] ) );
		}
		const boundary = [];
		for ( let j = 0; j < columns; j ++ ) boundary.push( j );
		for ( let i = 1; i < rows; i ++ ) boundary.push( i * columns + columns - 1 );
		for ( let j = columns - 2; j >= 0; j -- ) boundary.push( ( rows - 1 ) * columns + j );
		for ( let i = rows - 2; i > 0; i -- ) boundary.push( i * columns );
		for ( let i = 0; i < boundary.length; i ++ ) {
			const a = base + boundary[ i ], b = base + boundary[ ( i + 1 ) % boundary.length ], c = a + frontCount, d = b + frontCount;
			idx.push( ...( s > 0 ? [ a, c, b, b, c, d ] : [ a, b, c, b, d, c ] ) );
		}
		const rim = [];
		for ( const w of [ - 1, 1 ] ) {
			const path = [];
			for ( let i = 0; i < 19; i ++ ) { const t = i / 18; path.push( [ ...earPoint( t, w ), 0.0047 * ( 1 - t ) + 0.0017 ] ); }
			rim.push( tube( path, 0, bone, 6 ) );
		}
		surfaces[ s > 0 ? 'earRight' : 'earLeft' ] = { start: base, count: frontCount * 2, backStart: base + frontCount, backCount: frontCount, rim };
		}
	}

	// Flexible tapered tail. Fine groomed fur supplies its tuft and the mane; no dorsal spikes.
	surfaces.tail = tube( smoothPath( [ [ 0, 0.664, - 0.68, 0.024 ], [ 0.015, 0.625, - 0.753, 0.020 ], [ 0.035, 0.515, - 0.827, 0.012 ], [ 0.066, 0.42, - 0.862, 0.009 ], [ 0.104, 0.373, - 0.872, 0.012 ], [ 0.127, 0.350, - 0.866, 0.0015 ] ], 24 ), 0, 5, 10 );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( p, 3 ) );
	geometry.setAttribute( 'aBoar', new THREE.Float32BufferAttribute( tags, 2 ) );
	geometry.setIndex( idx ); geometry.computeVertexNormals(); geometry.computeBoundingBox();
	// Both half-pad charts meet on this anatomical midline with the same smooth normal.
	for ( const i of noseSeams ) geometry.attributes.normal.array.set( normalize( [ 0.012 * p[ i * 3 ] / 0.103 ** 2, 0.012 * ( p[ i * 3 + 1 ] - 0.397 ) / 0.063 ** 2, 1 ] ), i * 3 );
	return { geometry, vertices: p.length / 3, triangles: idx.length / 3, surfaces };
}

