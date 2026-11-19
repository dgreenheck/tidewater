// Marine paint for the ferry in the game, matching the look of the Cycles review renders
// (tools/ferry/ferry_paint.py): a glossy topcoat whose colour drifts a little, grime streaking
// down the sides, blotchy gloss, scum and weed staining in the wet band at the waterline, and
// the aluminium plating dishing faintly between the frames. All of it is worked out from the
// mesh's own position (the ferry's meshes sit under her root with no transform of their own:
// local x across her, local y up from the waterline, local z = -metres toward the bow), so the
// streaks ride with her however she moves.
//
// Use with loadModel( url, { customize: ferryPaint } ). The snippets use perlin3, the fractal noise
// and perturbNormalByHeight from the engine's common WGSL module, which every mesh shader includes.

// name -> [ grime colour (linear), streak amount, plate dishing (m), waterline staining, gloss wander ]
const PAINTS = {
	SuperstructureWhite: [ [ 0.42, 0.40, 0.35 ], 0.22, 0.0035, 0, 0.12 ],
	DeckhouseWhite: [ [ 0.42, 0.40, 0.35 ], 0.18, 0.002, 0, 0.12 ],
	HullNavy: [ [ 0.03, 0.04, 0.07 ], 0.2, 0.004, 1, 0.1 ],
	Antifouling: [ [ 0.03, 0.05, 0.06 ], 0.1, 0.0015, 1, 0.1 ],
	BandBlack: [ [ 0.05, 0.05, 0.05 ], 0.1, 0.0015, 0, 0.05 ],
	LiveryTeal: [ [ 0.42, 0.40, 0.35 ], 0.15, 0.0035, 0, 0.1 ],
	SunGold: [ [ 0.42, 0.40, 0.35 ], 0.15, 0.0035, 0, 0.1 ],
	LiverySoftNavy: [ [ 0.03, 0.04, 0.07 ], 0.15, 0.0035, 0, 0.1 ],
};

const f = x => { const s = String( + x.toPrecision( 7 ) ); return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0'; };

function paintSurface( [ grime, streaks, dish, waterline, gloss ] ) {

	return /* wgsl */`
	let p = in.vs.vLocal;
	let along = - p.z;
	// Colour drift, then grime streaks: noise stretched tall so it runs down the plating, and
	// only on steep faces (decks and roofs stay clean of it).
	let drift = perlin3( p * 0.08 ) * 0.5 + 0.5;
	var col = s.albedo * mix( 0.965, 1.03, drift );
	let streak = mx_fractal_noise_float3( vec3f( p.x * 1.4, p.y * 0.3, along * 1.4 ), 4, 2.0, 0.55 );
	let patchy = perlin3( p * 0.12 + vec3f( 3.1, 0.0, 7.7 ) ) * 0.5 + 0.5;
	let steep = 1.0 - smoothstep( 0.55, 0.85, abs( in.N.y ) );
	let grime = sat( ( streak - 0.02 ) * 4.0 ) * sat( patchy * 1.6 - 0.35 ) * ${ f( streaks ) } * steep;
	col = mix( col, vec3f( ${ grime.map( f ).join( ', ' ) } ), grime );
	// Scum and weed in the wet band at the waterline, with a ragged top edge.
	let edge = 0.37 + perlin3( p * 2.5 ) * 0.18;
	let wet = ${ f( waterline ) } * ( 1.0 - smoothstep( edge - 0.06, edge + 0.06, p.y ) );
	col = mix( col, vec3f( 0.035, 0.04, 0.025 ), wet * 0.85 );
	s.albedo = col;
	// Gloss: a little blotchy everywhere, dull where it is grimy or wet.
	s.roughness = sat( s.roughness + ( perlin3( p * 0.9 ) * 0.5 ) * ${ f( gloss ) } + grime * 0.35 + wet * 0.3 );
	// Plating dished between the frames (1.2 m) and longitudinals (0.45 m), unevenly.
	let fr = 0.5 - 0.5 * cos( along * ${ f( 2 * Math.PI / 1.2 ) } );
	let lg = 0.5 - 0.5 * cos( p.y * ${ f( 2 * Math.PI / 0.45 ) } );
	let h = - fr * lg * ${ f( dish ) } * ( 0.35 + perlin3( p * 0.35 ) * 0.5 + 0.5 );
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( h ), dpdy( h ), 1.0 );
`;

}

// Her interiors (tools/ferry/ferry_build.py sections 10 to 16). The GLB carries flat colours only, so the
// detail is drawn here from the mesh's own position: `p` in her frame (x across, y up, z = - metres to the
// bow), `along` toward the bow, `nl` the face's normal in her frame (from the position's derivatives), `u`
// the coordinate along a wall, and a hash. Every snippet sits in its own block so their names never clash.
const LOCAL = `
	let p = in.vs.vLocal;
	let along = - p.z;
	let nl = abs( normalize( cross( dpdx( p ), dpdy( p ) ) ) );
	let u = select( p.x, along, nl.x > nl.z );
	let lev = smoothstep( 0.7, 0.9, nl.y );`;
const hash = v => `fract( sin( dot( ${ v }, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 )`;
// Indoors the engine's sky ambient reaches every face and nothing lights a ceiling, so they came out cold
// blue and black: a warm fill in proportion to the colour stands in for the strip lights (as Village.js).
const indoor = k => `s.emissive = s.emissive + s.albedo * vec3f( 0.36, 0.32, 0.26 ) * ${ k };`;
const INTERIOR = {
	// Painted steel: plates welded on 2.4 m by 1.8 m courses, a dark dado with scuffs from bumpers, rust at
	// the foot and bleeding from the seams, grime running down. Under the saloon it is lit.
	CarDeckWall: `
	let h = p.y - 2.6;
	let steep = 1.0 - lev;
	let sv = abs( fract( ( u + 0.6 ) / 2.4 + 0.5 ) - 0.5 ) * 2.4;
	let sh = abs( fract( h / 1.8 + 0.5 ) - 0.5 ) * 1.8;
	let bead = 1.0 - smoothstep( 0.004, 0.014, min( sv, sh ) );
	var col = s.albedo * mix( 0.93, 1.05, perlin3( p * 0.35 ) * 0.5 + 0.5 );
	let dado = ( 1.0 - step( 1.1, h ) ) * steep;
	col = mix( col, vec3f( 0.13, 0.15, 0.16 ), dado );
	col = mix( col, vec3f( 0.75, 0.6, 0.05 ), ( 1.0 - smoothstep( 0.0, 0.03, abs( h - 1.1 ) ) ) * steep );
	col = col * ( 1.0 - 0.28 * bead );
	let n = mx_fractal_noise_float3( vec3f( u * 1.7, h * 2.5, p.x * 0.5 ), 4, 2.0, 0.55 );
	let foot = ( 1.0 - smoothstep( 0.04, 0.3 + n * 0.3, h ) ) * sat( n * 2.5 + 0.55 ) * steep;
	let below = fract( h / 1.8 ) * 1.8;
	let runs = ( 1.0 - smoothstep( 0.0, 0.35, 1.8 - below ) ) * sat( mx_fractal_noise_float3( vec3f( u * 7.0, h * 0.5, 0.0 ), 3, 2.0, 0.5 ) * 3.0 - 1.1 ) * step( 1.2, h ) * steep;
	let rust = sat( foot + runs * 0.5 );
	col = mix( col, vec3f( 0.2, 0.085, 0.03 ) * ( 0.7 + 0.6 * n ), rust );
	let scuff = smoothstep( 0.45, 0.7, perlin3( vec3f( u * 2.2, h * 9.0, 0.0 ) ) ) * ( 1.0 - smoothstep( 0.02, 0.08, abs( h - 0.45 ) - 0.15 ) ) * steep;
	col = mix( col, vec3f( 0.025, 0.025, 0.028 ), scuff * 0.8 );
	let streak = sat( ( mx_fractal_noise_float3( vec3f( u * 1.6, h * 0.25, 0.0 ), 4, 2.0, 0.55 ) - 0.05 ) * 3.0 ) * 0.25 * steep * step( 1.1, h );
	col = mix( col, vec3f( 0.2, 0.19, 0.17 ), streak );
	// exhaust soot gathers under the deckhead where she is covered; the gloss white in the sun is a shade off pure white
	col = col * ( 1.0 - 0.32 * smoothstep( 2.2, 3.9, h ) * step( 0.5, along ) * steep ) * select( 1.0, 0.9, along <= 0.5 );
	s.albedo = col;
	s.roughness = sat( s.roughness + rust * 0.3 + scuff * 0.2 - bead * 0.1 );
	let hb = bead * 0.0025 - rust * 0.0008;
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( hb ), dpdy( hb ), 1.0 );
	${ indoor( 'select( 0.05, 0.2, along > 0.5 )' ) }`,
	// Steel deck under paint: speckle, polished dark tyre tracks down the lanes, oil where cars stand.
	CarDeckFloor: `
	let g = ${ hash( 'floor( vec2f( p.x, along ) * 90.0 )' ) };
	var col = s.albedo * ( 0.88 + 0.22 * g ) * mix( 0.88, 1.1, perlin3( vec3f( p.x, 0.0, along ) * 0.22 ) * 0.5 + 0.5 );
	let lx = abs( fract( ( p.x - 1.65 ) / 3.3 + 0.5 ) - 0.5 ) * 3.3;
	let wheel = 1.0 - smoothstep( 0.06, 0.2, abs( lx - 0.78 ) );
	let tn = sat( perlin3( vec3f( p.x * 1.5, 0.0, along * 0.12 ) ) * 0.9 + 0.55 ) * ( 0.75 + 0.25 * perlin3( vec3f( p.x * 30.0, 0.0, along * 0.6 ) ) );
	let tyre = wheel * tn * step( abs( p.x ), 6.5 ) * lev;
	col = col * ( 1.0 - 0.5 * tyre );
	let cell = vec2f( floor( ( p.x + 6.6 ) / 3.3 ), floor( along / 4.8 ) );
	let hc = ${ hash( 'cell' ) };
	let hd = ${ hash( 'cell + vec2f( 3.7, 1.3 )' ) };
	let c = vec2f( ( cell.x + 0.5 ) * 3.3 - 6.6 + ( hc - 0.5 ) * 0.5, ( cell.y + 0.5 ) * 4.8 + ( hd - 0.5 ) * 2.0 );
	let d = length( vec2f( p.x, along ) - c ) + perlin3( vec3f( p.x * 3.0, 0.0, along * 3.0 ) ) * 0.12;
	let oil = ( 1.0 - smoothstep( 0.18 + 0.3 * hd, 0.3 + 0.35 * hd, d ) ) * step( 0.4, hc ) * lev;
	col = mix( col, vec3f( 0.03, 0.03, 0.026 ), oil * 0.75 );
	s.albedo = col;
	s.roughness = sat( s.roughness - tyre * 0.3 - oil * 0.45 );
	${ indoor( 'select( 0.0, 0.3, along > 0.5 )' ) }`,
	// Laminate panels 1.2 m wide with dark joints, a darker lower half under a dado line, vinyl skirting.
	CorridorLaminate: `
	let hd = select( p.y - 7.0, p.y - 2.6, p.y < 6.95 );
	let jw = max( 0.005, length( fwidth( p ) ) * 0.9 );
	let pu = abs( fract( u / 1.2 + 0.5 ) - 0.5 ) * 1.2;
	let joint = 1.0 - smoothstep( jw * 0.5, jw * 1.5, pu );
	let tone = fract( sin( floor( u / 1.2 + 0.5 ) * 12.9898 ) * 43758.5453 );
	let linen = perlin3( vec3f( u * 38.0, p.y * 38.0, 0.0 ) ) * 0.5 + perlin3( vec3f( u * 85.0, p.y * 5.0, 1.0 ) ) * 0.5;
	let grain = perlin3( vec3f( u * 1.4 + perlin3( vec3f( u * 0.7, p.y * 2.5, 2.0 ) ) * 0.7, p.y * 48.0, 3.0 ) );
	var col = s.albedo * ( 0.97 + 0.035 * linen ) * ( 0.96 + 0.06 * tone );
	let oak = vec3f( 0.34, 0.235, 0.14 ) * ( 0.84 + 0.26 * grain ) * ( 0.92 + 0.12 * tone );
	col = select( oak, col, hd > 1.0 );
	col = mix( col, col * 0.55, 1.0 - smoothstep( jw * 0.5, jw * 1.5, abs( hd - 2.15 ) ) );
	let scuff = smoothstep( 0.35, 0.7, perlin3( vec3f( u * 2.3, hd * 7.0, 5.0 ) ) ) * ( 1.0 - smoothstep( 0.1, 0.45, hd ) );
	col = mix( col, col * 0.62, scuff * 0.6 );
	col = mix( col, col * 0.45, step( 0.955, hd ) * step( hd, 0.98 ) );
	col = mix( col, vec3f( 0.6, 0.61, 0.62 ) * ( 0.9 + 0.2 * perlin3( vec3f( u * 60.0, 0.0, 9.0 ) ) ), step( 0.98, hd ) * step( hd, 1.035 ) );
	col = mix( col, vec3f( 0.07, 0.075, 0.08 ), 1.0 - step( 0.1, hd ) );
	let screw = 1.0 - smoothstep( 0.004, 0.007, length( vec2f( pu - 0.045, abs( hd - 1.6 ) - 0.5 ) ) );
	col = col * ( 1.0 - 0.6 * joint ) * ( 1.0 - 0.4 * screw );
	s.albedo = col;
	s.roughness = select( 0.35, s.roughness, hd > 1.0 );
	let lh = - joint * 0.002 + step( 0.98, hd ) * step( hd, 1.035 ) * 0.003;
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( lh ), dpdy( lh ), 1.0 );
	${ indoor( '0.45' ) }`,
	// Welded sheet vinyl, flecked, with a seam every 2 m.
	CorridorVinyl: `
	let g = ${ hash( 'floor( vec2f( p.x, along ) * 110.0 )' ) };
	var col = s.albedo * ( 0.94 + 0.08 * perlin3( vec3f( p.x, 0.0, along ) * 0.6 ) );
	col = mix( col, vec3f( 0.75, 0.74, 0.7 ), step( 0.93, g ) * 0.6 );
	col = mix( col, vec3f( 0.05, 0.05, 0.06 ), step( g, 0.05 ) * 0.6 );
	col = col * ( 1.0 - 0.3 * ( 1.0 - smoothstep( 0.002, 0.005, abs( fract( along / 2.0 + 0.5 ) - 0.5 ) * 2.0 ) ) );
	s.albedo = col;
	s.roughness = sat( s.roughness + 0.1 * perlin3( p * 2.0 ) );
	${ indoor( '0.8' ) }`,
	StairTread: `
	let g = ${ hash( 'floor( vec2f( p.x, along ) * 120.0 )' ) };
	s.albedo = s.albedo * ( 0.85 + 0.2 * g ) * mix( 1.0, 0.8, step( 0.5, fract( along * 30.0 ) ) * lev );
	${ indoor( '0.7' ) }`,
	// Ceilings: a 600 by 1200 tile grid in white tees; walls of the same lining get panel joints and a skirting.
	CeilingLining: `
	let tc = fract( vec2f( p.x / 0.6, along / 1.2 ) );
	let tee = 1.0 - step( 0.015, tc.x ) * step( tc.x, 0.985 ) * step( 0.008, tc.y ) * step( tc.y, 0.992 );
	let th = ${ hash( 'floor( vec2f( p.x / 0.6, along / 1.2 ) )' ) };
	let fis = ${ hash( 'floor( vec2f( p.x, along ) * 70.0 )' ) };
	let tile = mix( ( 0.9 + 0.06 * th ) * ( 0.95 + 0.06 * fis ), 1.12, tee );
	let hd = select( p.y - 7.0, p.y - 2.6, p.y < 6.95 );
	let joint = 1.0 - smoothstep( 0.003, 0.006, abs( fract( u / 1.2 + 0.5 ) - 0.5 ) * 1.2 );
	let wall = mix( 1.0 - 0.4 * joint, 0.15, 1.0 - step( 0.1, hd ) );
	s.albedo = s.albedo * select( wall, tile, nl.y > 0.7 );
	${ indoor( '1.0' ) }`,
	VehicleDeckWalls: `${ indoor( '0.6' ) }`,
	// Carpet: a navy ground with a teal diamond lattice and gold dots, fibre speckle, flattened where people walk.
	SaloonCarpet: `
	// a 0.3 m repeat (real ferry carpet runs 20 to 40 cm), lines fading to their average where they go sub-pixel
	let cq = vec2f( p.x, along ) / 0.3;
	let cc = fract( cq ) - 0.5;
	let cw = min( 1.0, length( fwidth( cq ) ) * 2.5 );
	let dia = abs( cc.x ) + abs( cc.y );
	let ring = mix( 1.0 - smoothstep( 0.03, 0.055, abs( dia - 0.34 ) ), 0.22, cw ) * lev;
	let inner = mix( 1.0 - smoothstep( 0.018, 0.035, abs( dia - 0.12 ) ), 0.1, cw ) * lev;
	let dotc = mix( 1.0 - smoothstep( 0.05, 0.08, length( cc - vec2f( 0.5, 0.5 ) * sign( cc ) ) ), 0.06, cw ) * lev;
	let fib = ${ hash( 'floor( vec2f( p.x, along ) * 240.0 )' ) };
	var col = s.albedo * ( 0.82 + 0.34 * fib );
	col = mix( col, vec3f( 0.0, 0.2, 0.22 ), ring * 0.75 );
	col = mix( col, vec3f( 0.02, 0.13, 0.15 ), inner * 0.6 );
	col = mix( col, vec3f( 0.42, 0.28, 0.07 ), dotc * 0.8 );
	col = col * ( 0.9 + 0.16 * ( perlin3( vec3f( p.x * 0.7, 3.0, along * 0.7 ) ) * 0.5 + 0.5 ) );
	let aisle = ( 1.0 - smoothstep( 0.4, 1.2, abs( p.x ) ) ) + ( 1.0 - smoothstep( 0.3, 0.8, abs( abs( p.x ) - 4.75 ) ) );
	col = col * ( 1.0 + 0.12 * aisle * ( perlin3( vec3f( p.x * 2.0, 0.0, along * 0.5 ) ) * 0.5 + 0.5 ) );
	s.albedo = col;
	${ indoor( '0.9' ) }`,
	// Woven upholstery.
	SeatFabric: `
	let wv = ${ hash( 'floor( vec2f( u, p.y ) * 260.0 )' ) };
	s.albedo = s.albedo * ( 0.88 + 0.2 * wv ) * ( 0.95 + 0.08 * perlin3( p * 4.0 ) );
	${ indoor( '0.75' ) }`,
	HeadrestTeal: `
	let wv = ${ hash( 'floor( vec2f( u, p.y ) * 260.0 )' ) };
	s.albedo = s.albedo * ( 0.9 + 0.16 * wv );
	${ indoor( '0.6' ) }`,
	SeatShell: indoor( '0.6' ),
	SeatPiping: indoor( '0.6' ),
	CounterLaminate: indoor( '0.6' ),
	Teak: indoor( '0.8' ),
	CurtainFabric: `
	s.albedo = s.albedo * ( 0.8 + 0.2 * ( 0.5 + 0.5 * sin( u * 90.0 ) ) );
	${ indoor( '0.6' ) }`,
};

// loadModel customize hook: extends a material's options by its glTF name.
export function ferryPaint( source, options ) {

	const paint = PAINTS[ source.name ], inside = INTERIOR[ source.name ];
	if ( ! paint && ! inside ) return options;
	options.varyings = { ...( options.varyings || {} ), vLocal: 'vec3f' };
	options.vertex = `${ options.vertex || '' }\n\to.vLocal = v.position;`;
	const snippet = paint ? paintSurface( paint ) : `{${ LOCAL }\n${ inside }\n\t}`;
	options.surface = `${ options.surface || '' }\n${ snippet }`;
	return options;

}
