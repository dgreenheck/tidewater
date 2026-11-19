// Surface detail for the ferry terminal flat (public/ferry/terminal.glb, tools/ferry/terminal_build.py).
// The GLB loader reads PBR factors only, so the ground, the asphalt, the armour rock and the verge
// plants get their detail here, worked out from the mesh's own position: the terminal's meshes sit
// under its root with no transform of their own, so v.position is the terminal frame in glTF axes
// (x = terminal x, y = height above the sea, z = -terminal y). The same numbers hold at Tidewater
// and at Joey Island, whatever yaw the flat is placed at.
//
//   SandyGravel  crushed limestone road-base: loose stones, compacted fines, tyre tracks down the
//                car park's aisle, oil drips under the parked cars' engines, and grass whose ragged,
//                soft-edged extent comes from the vertex colour (r grass, g traffic, b weedy fringe)
//   Asphalt      aggregate, patched repairs, oil drips and tyre polish down the queue lanes
//   Rock*        armour stone: granite grain, hairline cracks, rain streaks, small lichen rosettes on the dry
//                tops, a dark wet splash band, a barnacle crust and weed below it
//   Saltbush, Verge*  leafy shrubs and grass tufts
//
// Use with loadModel( url, { customize: terminalPaint } ). perlin3, mx_fractal_noise_float3, sat and
// perturbNormalByHeight come from the engine's common WGSL module.

const f = x => { const s = String( + x.toPrecision( 7 ) ); return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0'; };

// the four rows of bays beside the hall: where each row's engines sit (terminal x)
const NOSES = [ - 53.0, - 56.0, - 73.5, - 76.5 ];
const oilRow = ( x, i ) => `
	let ho${ i } = fract( sin( kb * 17.13 + ${ f( x ) } * 3.71 ) * 43758.5453 );
	let od${ i } = length( vec2f( q.x - ( ${ f( x ) } ), dyb ) ) + perlin3( vec3f( q * 2.3, ${ f( i + 0.5 ) } ) ) * 0.2;
	oil = max( oil, step( 0.4, ho${ i } ) * ( 1.0 - smoothstep( 0.2 + 0.35 * ho${ i }, 0.45 + 0.45 * ho${ i }, od${ i } ) ) * ( 0.45 + 0.5 * ho${ i } ) );`;

const ground = mask => /* wgsl */`
	let tp = in.vs.vLocal;
	let q = vec2f( tp.x, - tp.z );
	let m = ${ mask };
	let near = 1.0 - smoothstep( 0.03, 0.12, length( fwidth( q ) ) );
	let broad = mx_fractal_noise_float3( vec3f( q * 0.06, 1.7 ), 3, 2.0, 0.5 );
	let mid = perlin3( vec3f( q * 0.7, 4.1 ) );
	let fine = perlin3( vec3f( q * 3.1, 7.3 ) );
	var col = vec3f( 0.34, 0.31, 0.255 ) * ( 0.84 + 0.3 * broad + 0.07 * mid );
	let g1 = perlin3( vec3f( q * 13.0, 0.5 ) );
	let g2 = perlin3( vec3f( q * 29.0 + vec2f( 7.3, 1.1 ), 2.5 ) );
	let g3 = perlin3( vec3f( q * 5.5, 8.5 ) ) * 0.5 + 0.5;
	let stone = smoothstep( 0.12, 0.42, g1 * 0.65 + g2 * 0.35 ) * near;
	col = mix( col, col * mix( 0.72, 1.28, g3 ), stone );
	col = col * ( 1.0 + ( 0.12 * g2 + 0.1 * fine ) * near );
	// far detail that holds from the air: compacted and loose zones, silt dried where puddles stood, weed clumps
	let zone = mx_fractal_noise_float3( vec3f( q * 0.16, 3.3 ), 3, 2.0, 0.5 );
	col = col * ( 0.8 + 0.4 * zone );
	col = mix( col, col * 0.78, smoothstep( 0.25, 0.55, perlin3( vec3f( q * 0.03, 2.2 ) ) ) * 0.6 );   // damp, darker fines
	let pud = smoothstep( 0.28, 0.42, perlin3( vec3f( q * 0.09, 6.6 ) ) + 0.15 * mid );
	col = mix( col, col * 0.74 + vec3f( 0.015, 0.014, 0.01 ), pud * 0.55 );
	let wc = smoothstep( 0.5, 0.68, perlin3( vec3f( q * 0.8, 12.0 ) ) ) * smoothstep( 0.1, 0.5, perlin3( vec3f( q * 0.05, 13.0 ) ) );
	let wob = perlin3( vec3f( 3.0, q.y * 0.045, 1.0 ) ) * 0.9;
	let ax = abs( abs( q.x + 64.75 + wob ) - 0.85 );
	let ax2 = abs( abs( q.x + 63.9 - wob * 0.7 ) - 0.8 );
	let inAisle = smoothstep( - 61.0, - 57.0, q.y ) * ( 1.0 - smoothstep( 30.0, 33.5, q.y ) );
	let track = max( 1.0 - smoothstep( 0.1, 0.28, ax ), 0.6 * ( 1.0 - smoothstep( 0.08, 0.22, ax2 ) ) ) * inAisle * ( 0.7 + 0.3 * mid );
	let traffic = sat( m.g + track );
	col = mix( col, vec3f( 0.215, 0.2, 0.18 ) * ( 0.88 + 0.22 * broad ), traffic * 0.55 );
	col = mix( col, col * 0.72, track * 0.5 );
	let kb = round( ( q.y + 52.0 ) / 2.7 ); let dyb = q.y + 52.0 - kb * 2.7;
	var oil = 0.0;${ NOSES.map( oilRow ).join( '' ) }
	oil = oil * step( - 54.0, q.y ) * step( q.y, 16.0 ) * ( 1.0 - step( - 8.5, q.y ) * step( q.y, - 0.5 ) ) * step( - 80.0, q.x ) * step( q.x, - 49.0 );
	col = mix( col, vec3f( 0.045, 0.043, 0.04 ), oil * 0.8 );
	let gn = mx_fractal_noise_float3( vec3f( q * 0.42, 5.0 ), 3, 2.0, 0.5 );
	let gm = sat( ( m.r + gn * 0.45 - 0.5 ) * 3.5 ) * ( 1.0 - traffic * 0.8 );
	let gv = perlin3( vec3f( q * 0.09, 9.0 ) ) * 0.5 + 0.5;
	var gcol = mix( vec3f( 0.105, 0.14, 0.05 ), vec3f( 0.27, 0.24, 0.12 ), smoothstep( 0.25, 0.8, gv ) );
	gcol = mix( gcol, vec3f( 0.06, 0.1, 0.035 ), sat( perlin3( vec3f( q * 0.55, 2.0 ) ) ) * 0.55 );
	let bl = perlin3( vec3f( q * vec2f( 23.0, 19.0 ), 3.3 ) ) * 0.5 + 0.5;    // smooth blade-scale tone (a hashed cell grid read as rows of dashes)
	gcol = mix( gcol, vec3f( 0.32, 0.28, 0.16 ), sat( ( broad - 0.05 ) * 2.0 ) * 0.5 );
	gcol = gcol * mix( 1.0, 0.8 + 0.35 * bl, near );
	let wm = sat( ( m.b + mid * 0.6 - 0.75 ) * 3.0 ) * step( 0.5, 0.25 * g2 + 0.25 * fine + 0.5 );
	col = mix( col, gcol * 0.85, max( gm, wm * 0.8 ) );
	col = mix( col, gcol * 0.8, wc * ( 1.0 - traffic ) * 0.85 );
	s.albedo = col;
	s.roughness = clamp( 0.93 - 0.1 * traffic - 0.45 * oil - 0.2 * pud, 0.3, 1.0 );
	let hgt = ( stone * 0.005 + g1 * 0.003 * near + mid * 0.006 ) * ( 1.0 - gm ) + gm * bl * 0.01 * near;
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( hgt ), dpdy( hgt ), 1.0 );
`;

const ASPHALT = /* wgsl */`
	let ap = in.vs.vLocal;
	let aq = vec2f( ap.x, - ap.z );
	let anear = 1.0 - smoothstep( 0.03, 0.1, length( fwidth( aq ) ) );
	let ab = mx_fractal_noise_float3( vec3f( aq * 0.08, 3.3 ), 3, 2.0, 0.5 );
	let agg = fract( sin( dot( floor( aq * 45.0 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	var ac = s.albedo * ( 0.85 + 0.3 * ab ) * mix( 1.0, 0.75 + 0.55 * agg, anear * 0.6 );
	let pc = floor( aq / 6.0 ); let ph = fract( sin( dot( pc, vec2f( 7.13, 157.3 ) ) ) * 43758.5453 );
	// patched asphalt: saw-cut repairs of mixed sizes, newer ones black with a tar-sealed edge, older ones grey and ravelled
	let pw = vec2f( 0.2 + 0.18 * fract( ph * 7.7 ), 0.14 + 0.2 * fract( ph * 13.1 ) );
	let pd = max( abs( fract( aq.x / 6.0 ) - 0.5 ) - pw.x, abs( fract( aq.y / 6.0 ) - 0.5 ) - pw.y );
	let pin = step( 0.6, ph ) * step( pd, 0.0 );
	let pedge = step( 0.6, ph ) * ( 1.0 - smoothstep( 0.004, 0.012, abs( pd ) ) );
	ac = mix( ac, mix( ac * 1.3 + vec3f( 0.025 ), ac * 0.5, step( 0.8, ph ) ), pin );
	ac = mix( ac, vec3f( 0.02, 0.02, 0.022 ), pedge * 0.8 );
	// crack sealing: meandering tar lines, faded out where they would go sub-pixel
	let crk = abs( perlin3( vec3f( aq * 0.22, 4.4 ) ) + 0.25 * perlin3( vec3f( aq * 1.3, 8.8 ) ) );
	let cfw = fwidth( crk );
	let seal = ( 1.0 - smoothstep( 0.004, 0.006 + cfw * 1.5, crk ) ) * smoothstep( 0.0, 0.2, perlin3( vec3f( aq * 0.05, 1.2 ) ) ) * ( 1.0 - smoothstep( 0.02, 0.05, cfw ) );
	ac = mix( ac, vec3f( 0.018, 0.018, 0.02 ), seal * 0.75 );
	let lx = aq.x + 9.0 - 1.65; let li = round( lx / 3.3 ); let ld = lx - li * 3.3;
	let inLanes = step( 0.0, li ) * step( li, 6.0 ) * smoothstep( - 81.0, - 78.0, aq.y ) * ( 1.0 - smoothstep( - 44.0, - 42.5, aq.y ) );
	let drip = ( 1.0 - smoothstep( 0.08, 0.3, abs( ld + perlin3( vec3f( aq * 0.9, 2.0 ) ) * 0.08 ) ) ) * sat( perlin3( vec3f( aq * vec2f( 1.4, 0.35 ), 6.0 ) ) * 1.5 + 0.35 ) * inLanes;
	let polish = ( 1.0 - smoothstep( 0.12, 0.3, abs( abs( ld ) - 0.78 ) ) ) * inLanes;
	ac = mix( ac, ac * 0.45, drip * 0.8 );
	// oil where engines idle in the queue, one stain per car length, and polished wheel paths
	let cyq = floor( ( aq.y + 81.0 ) / 5.4 ); let chq = fract( sin( li * 31.7 + cyq * 7.31 ) * 43758.5453 );
	let soq = vec2f( ld + ( chq - 0.5 ) * 0.4, fract( ( aq.y + 81.0 ) / 5.4 ) * 5.4 - 1.6 - chq * 0.8 );
	let stain = ( 1.0 - smoothstep( 0.25 + 0.3 * chq, 0.55 + 0.45 * chq, length( soq * vec2f( 1.0, 0.7 ) ) + perlin3( vec3f( aq * 1.7, 3.0 ) ) * 0.18 ) ) * step( 0.3, chq ) * inLanes;
	ac = mix( ac, ac * 0.4, stain * 0.75 );
	ac = mix( ac, ac * 0.68 + vec3f( 0.004 ), polish * 0.85 );
	// gully grates down the lanes every 13.5 m: a galvanised frame round dark slots
	let gyq = aq.y - round( aq.y / 13.5 ) * 13.5;
	let gbx = max( abs( ld ) - 0.28, abs( gyq ) - 0.45 );
	let grate = step( gbx, 0.0 ) * inLanes;
	let gfr = step( - 0.045, gbx );
	let gsl = step( 0.45, fract( gyq / 0.05 ) );
	ac = mix( ac, mix( vec3f( 0.012, 0.012, 0.013 ), vec3f( 0.2, 0.2, 0.19 ), max( gfr, gsl * 0.7 ) ), grate );
	s.albedo = ac;
	s.roughness = clamp( s.roughness - 0.25 * drip - 0.22 * polish - 0.3 * stain - 0.3 * grate * gfr, 0.3, 1.0 );
`;

const ROCK = /* wgsl */`
	let rp = in.vs.vLocal;
	let rfw = length( fwidth( rp ) );
	let rnear = 1.0 - smoothstep( 0.012, 0.05, rfw );
	let rb = mx_fractal_noise_float3( rp * 0.55, 3, 2.0, 0.5 );
	let rm = perlin3( rp * 2.6 + vec3f( 3.1 ) );
	let rf = perlin3( rp * 9.0 + vec3f( 1.7 ) );
	let up = sat( in.N.y );
	var rc = s.albedo * ( 0.8 + 0.4 * rb + 0.1 * rm );
	rc = mix( vec3f( dot( rc, vec3f( 0.3333 ) ) ), rc, 0.8 );
	let g1 = perlin3( rp * 47.0 );
	let g2 = perlin3( rp * 61.0 + vec3f( 9.3 ) );
	rc = mix( rc, rc * 0.55, sat( ( g1 - 0.36 ) * 5.0 ) * rnear * 0.8 );
	rc = mix( rc, rc * 1.3 + vec3f( 0.02 ), sat( ( g2 - 0.4 ) * 5.0 ) * rnear * 0.55 );
	rc = rc * ( 1.0 + 0.08 * rf * rnear );
	let ck = 1.0 - smoothstep( 0.0, 0.035, abs( perlin3( rp * vec3f( 0.9, 1.6, 0.9 ) + vec3f( 11.0 ) ) ) );
	let ck2 = ( 1.0 - smoothstep( 0.0, 0.025, abs( perlin3( rp * 2.7 + vec3f( 4.0 ) ) ) ) ) * sat( rm * 2.0 );
	// iso-lines of noise close into loops: break them into short runs so a crack never draws a lasso
	let crack = max( ck * 0.8, ck2 * 0.6 ) * rnear * sat( perlin3( rp * 1.3 + vec3f( 23.0 ) ) * 3.0 + 0.1 );
	rc = mix( rc, rc * 0.45, crack );
	let streak = sat( perlin3( rp * vec3f( 3.5, 0.3, 3.5 ) + vec3f( 2.0 ) ) * 1.6 ) * ( 1.0 - up );
	rc = rc * ( 1.0 - 0.22 * streak ) * ( 0.76 + 0.24 * sat( in.N.y * 0.5 + 0.6 ) );
	let wl = rp.y + perlin3( rp * vec3f( 1.3, 0.4, 1.3 ) ) * 0.25 + rf * 0.05;
	let dry = smoothstep( 2.0, 2.8, wl );
	let colony = sat( ( mx_fractal_noise_float3( rp * 0.7 + vec3f( 5.0 ), 2, 2.0, 0.5 ) + 0.1 ) * 3.0 );
	let lspot = perlin3( rp * 7.5 + vec3f( 17.0 ) ) + 0.35 * perlin3( rp * 19.0 );
	let lich = sat( ( lspot - 0.3 ) * 7.0 ) * colony * sat( up * 1.5 - 0.1 ) * dry;
	rc = mix( rc, vec3f( 0.36, 0.38, 0.32 ) * ( 0.88 + 0.25 * rf ), lich * 0.42 );
	let ospot = perlin3( rp * 11.0 + vec3f( 31.0 ) ) + 0.3 * perlin3( rp * 27.0 );
	let orange = sat( ( ospot - 0.45 ) * 8.0 ) * colony * up * dry * smoothstep( 0.1, 0.4, perlin3( rp * 0.35 + vec3f( 8.0 ) ) );
	rc = mix( rc, vec3f( 0.46, 0.28, 0.09 ), orange * 0.4 );
	let wet = 1.0 - smoothstep( 1.0, 1.6, wl );
	rc = mix( rc, rc * 0.42, wet );
	let bz = ( 1.0 - smoothstep( 0.55, 1.05, wl ) ) * smoothstep( - 0.5, 0.05, wl );
	let bc = perlin3( rp * 38.0 ) * 0.6 + perlin3( rp * 83.0 + vec3f( 5.0 ) ) * 0.4;
	let bd = sat( ( bc - 0.05 ) * 4.0 );
	let bcov = bz * sat( 0.55 + 0.7 * perlin3( rp * 1.7 + vec3f( 2.0 ) ) );
	rc = mix( rc, mix( vec3f( 0.2, 0.195, 0.18 ), vec3f( 0.5, 0.48, 0.43 ), mix( 0.45, bd, rnear ) ), bcov * 0.75 );
	// weed at the waterline: olive and brown mats in patches, strands hanging down the fall line, slick
	let wpatch = sat( perlin3( rp * vec3f( 1.6, 0.7, 1.6 ) + vec3f( 41.0 ) ) * 2.0 + 0.55 );
	let strands = sat( perlin3( rp * vec3f( 8.0, 0.9, 8.0 ) + vec3f( 5.0 ) ) * 1.6 + 0.5 );
	let weed = ( 1.0 - smoothstep( - 0.15, 0.3 + 0.35 * wpatch * strands, wl ) ) * mix( 0.6, 1.0, wpatch );
	rc = mix( rc, mix( vec3f( 0.028, 0.04, 0.018 ), vec3f( 0.085, 0.075, 0.028 ), strands * wpatch ), weed * 0.85 );
	// surface relief: lumps, ridged fracture ledges, pits and crack grooves, so the faces read rough and
	// craggy under the sun; the finer terms fade out before they alias
	let rmid = 1.0 - smoothstep( 0.02, 0.09, rfw );
	let ridge = 1.0 - abs( perlin3( rp * 1.9 + vec3f( 7.0 ) ) );
	let ridge2 = 1.0 - abs( perlin3( rp * 4.3 + vec3f( 13.0 ) ) );
	let pit = smoothstep( 0.3, 0.6, perlin3( rp * 13.0 + vec3f( 3.0 ) ) ) * rnear;
	rc = rc * ( 1.0 - 0.3 * pit ) * ( 0.9 + 0.1 * ridge );
	// wind-blown sand caught on the ledges and in the hollows of the dry stones low on the bank
	let sandK = smoothstep( 0.5, 0.85, up ) * smoothstep( 0.45, 0.7, perlin3( rp * 0.9 + vec3f( 19.0 ) ) * 0.6 + 0.5 - rb * 0.5 )
		* smoothstep( 1.3, 1.8, wl ) * ( 1.0 - smoothstep( 2.3, 3.2, wl ) );
	rc = mix( rc, vec3f( 0.5, 0.43, 0.31 ) * ( 0.9 + 0.2 * g2 * rnear ), sandK * 0.9 );
	s.albedo = rc;
	s.roughness = clamp( mix( mix( 0.9 - 0.08 * lich, 0.24, wet * ( 1.0 - 0.5 * bcov ) ), 0.16, weed * 0.8 ), 0.15, 1.0 );
	s.roughness = mix( s.roughness, 0.95, sandK );
	var rh = rb * 0.08 + rm * 0.035 + ridge * ridge * 0.03 + ridge2 * ridge2 * 0.012 * rmid + rf * 0.01 * rmid
		- crack * 0.015 - pit * 0.006 + bcov * bd * 0.004 * rnear;
	rh = rh * ( 1.0 - 0.75 * sandK ) * ( 1.0 - 0.5 * weed );
	// fine derivatives: a relief this strong shades in 2x2 blocks with the coarse ones
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdxFine( rh ), dpdyFine( rh ), 1.0 );
`;

const SALTBUSH = /* wgsl */`
	let sp = in.vs.vLocal;
	let leaf = perlin3( sp * 9.0 ) * 0.5 + 0.5;
	let clump = perlin3( sp * 2.5 ) * 0.5 + 0.5;
	var sb = mix( vec3f( 0.1, 0.12, 0.08 ), vec3f( 0.36, 0.39, 0.31 ), leaf * 0.6 + clump * 0.3 );
	sb = sb * ( 0.6 + 0.55 * sat( in.N.y * 0.5 + 0.5 ) );
	s.albedo = sb;
	s.roughness = 0.85;
	let sh = leaf * 0.05 + clump * 0.04;
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( sh ), dpdy( sh ), 1.0 );
`;

const TUFT = /* wgsl */`
	let gp = in.vs.vLocal;
	let gt = sat( ( gp.y - 3.2 ) / 0.45 );
	let gh = fract( sin( dot( floor( gp.xz * 1.3 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	s.albedo = mix( s.albedo * 0.7, s.albedo * mix( 1.1, 1.7, gh ), gt );
	s.normal = normalize( mix( s.normal, vec3f( 0.0, 1.0, 0.0 ), 0.85 ) );
	s.roughness = 0.8;
`;

// Corrugated steel shed cladding: the profile's light and shade, laps every 760 mm, rain streaks, rust at the laps and
// the foot, dirt splashed up from the apron and a chalky oxidation bloom.
const SHED = /* wgsl */`
	let cp = in.vs.vLocal;
	let cn = abs( normalize( cross( dpdx( cp ), dpdy( cp ) ) ) );
	let cu = select( cp.x, cp.z, cn.x > cn.z );
	let ch = cp.y - 3.2;
	let wall = 1.0 - smoothstep( 0.6, 0.85, cn.y );
	let cnear = 1.0 - smoothstep( 0.01, 0.04, length( fwidth( cp ) ) );
	let cor = sin( cu * 6.2832 / 0.076 );
	var cc = s.albedo * ( 0.93 + 0.07 * cor * cnear ) * ( 0.94 + 0.12 * perlin3( cp * 0.6 ) );
	let lw = max( 0.012, length( fwidth( cp ) ) * 0.9 );
	let lap = 1.0 - smoothstep( lw * 0.5, lw * 1.5, abs( fract( cu / 0.76 + 0.5 ) - 0.5 ) * 0.76 );
	cc = cc * ( 1.0 - 0.3 * lap * wall );
	let streak = sat( mx_fractal_noise_float3( vec3f( cu * 3.0, ch * 0.3, 1.0 ), 3, 2.0, 0.5 ) * 2.5 - 0.4 ) * wall;
	cc = mix( cc, cc * 0.62 + vec3f( 0.04, 0.035, 0.025 ), streak * 0.85 );
	let foot = ( 1.0 - smoothstep( 0.0, 0.5 + 0.3 * perlin3( vec3f( cu * 2.0, 0.0, 4.0 ) ), ch ) ) * wall;
	cc = mix( cc, vec3f( 0.16, 0.1, 0.06 ), foot * 0.8 );
	let rust = sat( perlin3( vec3f( cu * 4.0, ch * 1.2, 7.0 ) ) * 3.0 - 1.2 ) * sat( lap * 0.8 + foot ) * wall;
	cc = mix( cc, vec3f( 0.28, 0.12, 0.04 ), rust * 0.7 );
	cc = mix( cc, cc + vec3f( 0.05 ), sat( perlin3( cp * 1.7 ) * 2.0 - 0.6 ) * 0.4 );
	s.albedo = cc;
	s.roughness = sat( s.roughness + rust * 0.3 + streak * 0.1 );
	let chh = cor * 0.004 * cnear;
	s.normal = perturbNormalByHeight( in.P, s.normal, dpdx( chh ), dpdy( chh ), 1.0 );
`;

// Indoors the sky ambient left the hall's ceiling a dark green-grey: a warm fill (as FerryPaint) stands in for the
// panel lights, strongest on the down faces, and the ceiling gets its 600 by 1200 tile grid.
const CEIL = /* wgsl */`
	let lp = in.vs.vLocal;
	let down = sat( - in.N.y );
	let tc = fract( vec2f( lp.x / 0.6, lp.z / 1.2 ) );
	let tee = 1.0 - step( 0.02, tc.x ) * step( tc.x, 0.98 ) * step( 0.01, tc.y ) * step( tc.y, 0.99 );
	let th = fract( sin( dot( floor( vec2f( lp.x / 0.6, lp.z / 1.2 ) ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	s.albedo = s.albedo * mix( 1.0, mix( 0.9 + 0.08 * th, 1.08, tee ), step( 0.7, down ) );
	s.emissive = s.emissive + s.albedo * vec3f( 0.36, 0.32, 0.26 ) * ( 0.25 + 0.75 * down );
`;

const SURFACES = {
	ShedCladding: SHED,
	Ceiling: CEIL,
	WallLining: `s.emissive = s.emissive + s.albedo * vec3f( 0.36, 0.32, 0.26 ) * 0.3;`,
	SandyGravel: ground( 'in.color.rgb' ),
	CrestGravel: ground( 'vec3f( 0.0, 0.35, 0.0 )' ),
	Asphalt: ASPHALT,
	// ground markings worn by tyres and weather (the buildings' white paint stands above y 3.3 and is left alone)
	PaintWhite: /* wgsl */`
	let wp = in.vs.vLocal;
	let wq = vec2f( wp.x, - wp.z );
	let wgd = 1.0 - step( 3.3, wp.y );
	let wear = smoothstep( 0.35, 0.8, perlin3( vec3f( wq * 1.3, 5.5 ) ) * 0.5 + 0.5 + perlin3( vec3f( wq * 7.0, 1.5 ) ) * 0.2 );
	let wgr = fract( sin( dot( floor( wq * 60.0 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	s.albedo = mix( s.albedo, mix( vec3f( 0.09, 0.09, 0.095 ), s.albedo * 0.8, step( 0.55, wgr ) * 0.6 ), wear * 0.6 * wgd );
	s.roughness = clamp( s.roughness + 0.1 * wgd * wear, 0.0, 1.0 );`,
	Saltbush: SALTBUSH,
	VergeTuft: TUFT,
	VergeWeed: TUFT,
};

// loadModel customize hook: extends a material's options by its glTF name.
export function terminalPaint( source, options ) {

	const name = source.name || '';
	const surface = SURFACES[ name ] || ( /^(Rock(Grey|Tan|Pale|Dark|Rust|[A-D])|WetRock)$/.test( name ) ? ROCK : null );
	if ( ! surface ) return options;
	options.varyings = { ...( options.varyings || {} ), vLocal: 'vec3f' };
	options.vertex = `${ options.vertex || '' }\n\to.vLocal = v.position;`;
	options.surface = `${ options.surface || '' }\n${ surface }`;
	if ( name === 'SandyGravel' ) options.vertexColors = true;
	if ( /^Verge/.test( name ) ) options.side = 'double';
	return options;

}
