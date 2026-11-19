import { BufferGeometry, BufferAttribute, Mesh, Group, Vector3 } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { Texture } from '../engine/gpu/Texture.js';
import { ShaderModule } from '../engine/gpu/Shader.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';

// Coastal road dressing: a photo-textured, sun-bleached seal with patch repairs,
// crack sealing and crisp markings; sandy shoulders and beach tracks that fade
// into the island; galvanised W-beam barrier on the drops; white guide posts.
// Poly Haven asphalt_02 (CC0), see CREDITS.md.
const SURFACES = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'rally/surfaces/';
const SIZE = 1024;

const roadNoise = new ShaderModule( { name: 'coastalRoadNoise', code: /* wgsl */`
fn crHash( p: vec2f ) -> f32 { var q = fract( vec3f( p.x, p.y, p.x ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
fn crNoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let w = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( crHash( i ), crHash( i + vec2f( 1.0, 0.0 ) ), w.x ), mix( crHash( i + vec2f( 0.0, 1.0 ) ), crHash( i + vec2f( 1.0, 1.0 ) ), w.x ), w.y );
}
fn crFbm( p: vec2f ) -> f32 { return crNoise( p ) * 0.5 + crNoise( p * 2.03 + 17.1 ) * 0.3 + crNoise( p * 4.11 + 41.7 ) * 0.2; }
// Antialiased band |x| < w; thin bands fade by coverage instead of aliasing.
fn crLine( x: f32, w: f32 ) -> f32 { let f = max( fwidth( x ), 1e-5 ); return clamp( ( w - abs( x ) ) / f + 0.5, 0.0, 1.0 ) * min( 1.0, 2.0 * w / f ); }
fn crBox( p: vec2f, h: vec2f ) -> f32 { return crLine( p.x, h.x ) * crLine( p.y, h.y ); }
// Tangent-space normal onto the surface without stored tangents (screen derivatives).
fn crPerturb( N: vec3f, P: vec3f, uv: vec2f, t: vec3f ) -> vec3f {
	let dp1 = dpdx( P ); let dp2 = dpdy( P ); let duv1 = dpdx( uv ); let duv2 = dpdy( uv );
	let a = cross( dp2, N ); let b = cross( N, dp1 );
	let T = a * duv1.x + b * duv2.x; let B = a * duv1.y + b * duv2.y;
	let m = inverseSqrt( max( max( dot( T, T ), dot( B, B ) ), 1e-12 ) );
	return normalize( T * m * t.x + B * m * t.y + N * t.z );
}
// Sun-bleached beach sand with a little aggregate showing through.
fn crSand( P: vec3f, lum: f32 ) -> vec3f {
	let n = crNoise( P.xz * 0.35 ) * 0.6 + crNoise( P.xz * 2.7 ) * 0.4;
	return vec3f( 0.66, 0.6, 0.47 ) * ( 0.86 + n * 0.2 + ( lum - 0.4 ) * 0.25 );
}
// Inland verge: dry grass over sandy soil, so the shoulder melts into the hills.
fn crSoil( P: vec3f, lum: f32 ) -> vec3f {
	let n = crNoise( P.xz * 0.4 ) * 0.6 + crNoise( P.xz * 3.1 ) * 0.4;
	let grass = mix( vec3f( 0.075, 0.085, 0.035 ), vec3f( 0.055, 0.075, 0.03 ), crNoise( P.xz * 0.9 + 3.7 ) );
	return mix( vec3f( 0.15, 0.115, 0.075 ), grass, smoothstep( 0.3, 0.6, n ) ) * ( 0.9 + ( lum - 0.4 ) * 0.3 );
}
` } );

// Photo texture sampling shared by every road surface; flat stand-ins until the images arrive.
const SAMPLE = ( scale, ground = 'crSand( P, lum )' ) => /* wgsl */`
let u = in.uv.x; let au = abs( u ); let along = in.uv.y; let P = in.P;
let tuv = vec2f( u, along ) * ${ scale.toFixed( 6 ) };
let photo = mix( vec3f( 0.2, 0.2, 0.19 ), textureSample( roadAlbedo, smpAniso4Repeat, tuv ).rgb, mat.texReady );
let nr = mix( vec4f( 0.5, 0.5, 1.0, 0.8 ), textureSample( roadNormal, smpAniso4Repeat, tuv ), mat.texReady );
let lum = dot( photo, vec3f( 0.3, 0.59, 0.11 ) );
let nm = nr.xyz * 2.0 - 1.0;
let sandC = ${ ground };
let shoulder = sandC * mix( vec3f( 1.0 ), vec3f( 0.8, 0.78, 0.76 ), smoothstep( 0.35, 0.6, lum ) * 0.6 * ( 1.0 - smoothstep( 3.3, 4.2, au ) ) );
`;

// Pull the ribbon toward the camera along the view ray: no screen movement, but
// it stays above the graded terrain at every LOD and view distance.
const LIFT = ( base, slope ) => /* wgsl */`
let toCam = frame.cameraPos - v.position; let camD = length( toCam );
v.position += toCam * ( min( ${ base } + camD * ${ slope }, camD * 0.5 ) / max( camD, 0.001 ) );
`;

// W-beam cross-section: ( depth behind the rail face, height from the beam centre ), top to bottom.
const W_BEAM = [ [ 0.083, 0.156 ], [ 0.045, 0.148 ], [ 0.004, 0.118 ], [ 0.0, 0.088 ], [ 0.012, 0.052 ], [ 0.05, 0.022 ],
	[ 0.05, - 0.022 ], [ 0.012, - 0.052 ], [ 0.0, - 0.088 ], [ 0.004, - 0.118 ], [ 0.045, - 0.148 ], [ 0.083, - 0.156 ] ];
const BEAM_HEIGHT = 0.55, TERMINAL = 6, POST_SPACING = 2;

class Builder {
	constructor( colors = false ) { this.positions = []; this.normals = []; this.uvs = []; this.indices = []; this.extra = []; this.colors = colors ? [] : null; }
	vertex( x, y, z, nx, ny, nz, u, v, extra = 0, color = null ) {
		this.positions.push( x, y, z ); this.normals.push( nx, ny, nz ); this.uvs.push( u, v ); this.extra.push( ...[].concat( extra ) );
		if ( this.colors ) this.colors.push( ...color );
		return this.positions.length / 3 - 1;
	}
	// Wind each triangle to agree with its vertex normal, so front-face culling and
	// double-sided normal flips always see the intended outside.
	triangle( a, b, c ) {
		const p = this.positions, n = this.normals;
		const ux = p[ b * 3 ] - p[ a * 3 ], uy = p[ b * 3 + 1 ] - p[ a * 3 + 1 ], uz = p[ b * 3 + 2 ] - p[ a * 3 + 2 ];
		const vx = p[ c * 3 ] - p[ a * 3 ], vy = p[ c * 3 + 1 ] - p[ a * 3 + 1 ], vz = p[ c * 3 + 2 ] - p[ a * 3 + 2 ];
		const dot = ( uy * vz - uz * vy ) * n[ a * 3 ] + ( uz * vx - ux * vz ) * n[ a * 3 + 1 ] + ( ux * vy - uy * vx ) * n[ a * 3 + 2 ];
		if ( dot < 0 ) this.indices.push( a, c, b ); else this.indices.push( a, b, c );
	}
	quad( a, b, c, d ) { this.triangle( a, b, c ); this.triangle( a, c, d ); }
	// Box on local axes t (along), up, n (out), half sizes ht, hu, hn.
	box( cx, cy, cz, tx, tz, nx, nz, ht, hu, hn, uv = [ - 1, - 1 ], color = null ) {
		const axes = [ [ tx, 0, tz, ht ], [ 0, 1, 0, hu ], [ nx, 0, nz, hn ] ], c = [ cx, cy, cz ];
		for ( let f = 0; f < 3; f ++ ) for ( const sign of [ - 1, 1 ] ) {
			const [ N, U, V ] = [ axes[ f ], axes[ ( f + 1 ) % 3 ], axes[ ( f + 2 ) % 3 ] ];
			const corner = ( a, b ) => this.vertex( ...[ 0, 1, 2 ].map( k => c[ k ] + N[ k ] * N[ 3 ] * sign + U[ k ] * U[ 3 ] * a + V[ k ] * V[ 3 ] * b ), N[ 0 ] * sign, N[ 1 ] * sign, N[ 2 ] * sign, uv[ 0 ], uv[ 1 ], 0, color );
			this.quad( corner( - 1, - 1 ), corner( 1, - 1 ), corner( 1, 1 ), corner( - 1, 1 ) );
		}
	}
	geometry( extraNames = null ) {
		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( this.positions ), 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( new Float32Array( this.normals ), 3 ) );
		g.setAttribute( 'uv', new BufferAttribute( new Float32Array( this.uvs ), 2 ) );
		const names = extraNames ? [].concat( extraNames ) : [];
		names.forEach( ( name, k ) => g.setAttribute( name, new BufferAttribute( new Float32Array( this.extra.filter( ( _, i ) => i % names.length === k ) ), 1 ) ) );
		if ( this.colors ) g.setAttribute( 'color', new BufferAttribute( new Float32Array( this.colors ), 3 ) );
		g.setIndex( this.indices ); g.computeBoundingSphere();
		return g;
	}
}

// The sealed road shared by the loop and the circuit. openings: WGSL that raises open
// (edge line gaps at the beach entrances) or gap (the loop's side of a circuit merge,
// where the circuit's own ribbon carries the seal and shoulder).
const ASPHALT = ( L, period, openings ) => /* wgsl */`
let blotch = crFbm( P.xz * 0.045 );
// sun-bleached coastal seal: desaturated, warmed, blotchy at 20-60 m so the photo never tiles
var road = mix( vec3f( lum ), photo, 0.6 ) * vec3f( 1.05, 1.0, 0.93 ) * ( 0.74 + blotch * 0.4 );
var rough = mix( 0.8, 0.96, nr.a );
let w1 = ( au - 0.62 ) / 0.3; let w2 = ( au - 2.02 ) / 0.3;
let wheel = exp( - w1 * w1 ) + exp( - w2 * w2 );
road *= 1.0 - wheel * 0.13; rough -= wheel * 0.1;
// rectangular repairs: darker asphalt patches and the odd pale concrete slab, edges sealed
let cell = floor( along / 14.0 ); let lane = select( - 1.0, 1.0, u > 0.0 );
let h1 = crHash( vec2f( cell, lane * 7.0 ) ); let h2 = crHash( vec2f( cell + 3.1, lane * 5.0 ) ); let h3 = crHash( vec2f( cell - 9.7, lane ) );
let pc = ( cell + 0.25 + h2 * 0.5 ) * 14.0; let pl = 1.2 + h3 * 3.0;
let pu0 = 0.2 + h2 * 0.7; let pu1 = min( pu0 + 0.8 + h1 * 1.4, 2.5 );
let valid = step( h1, 0.45 ) * step( 9.0, pc ) * step( pc, ${ ( L - 9 ).toFixed( 3 ) } );
// each repair sits a little askew with hand-cut, wandering edges
let pa = ( h3 - 0.5 ) * 0.12; let q0 = vec2f( along - pc, au - ( pu0 + pu1 ) * 0.5 );
let pq = vec2f( q0.x * cos( pa ) - q0.y * sin( pa ), q0.x * sin( pa ) + q0.y * cos( pa ) ) + ( vec2f( crNoise( P.xz * 1.9 ), crNoise( P.xz * 1.9 + 7.3 ) ) - 0.5 ) * 0.1;
let patchOuter = valid * crBox( pq, vec2f( pl, ( pu1 - pu0 ) * 0.5 ) );
let patchInner = valid * crBox( pq, vec2f( pl - 0.07, ( pu1 - pu0 ) * 0.5 - 0.07 ) );
let concrete = step( 0.88, h3 );
road = mix( road, mix( road * vec3f( 0.8, 0.8, 0.82 ), vec3f( 0.3, 0.295, 0.275 ) * ( 0.8 + lum * 0.5 ), concrete ), patchInner );
// the sealed joint is a broken, feathered bitumen line, not a drawn outline
let sealBand = max( patchOuter - patchInner, 0.0 ) * smoothstep( 0.25, 0.7, crNoise( P.xz * 3.7 + 2.0 ) );
road = mix( road, vec3f( 0.075, 0.072, 0.068 ), sealBand * 0.7 * ( 1.0 - concrete * 0.6 ) );
rough = mix( rough, mix( 0.86, 0.9, concrete ), patchInner );
// bitumen crack sealing: meandering longitudinal cracks and the odd transverse joint
let warp = vec2f( crNoise( P.xz * 0.19 ), crNoise( P.xz * 0.19 + 5.3 ) ) * 2.6;
let crack = crLine( crNoise( P.xz * 0.47 + warp ) - 0.5, 0.014 ) * smoothstep( 0.5, 0.72, crNoise( P.xz * 0.085 + 11.0 ) );
let jc = floor( along / 17.0 );
let tj = along - ( jc * 17.0 + 8.5 ) + ( crNoise( vec2f( u * 1.3, jc * 3.7 ) ) - 0.5 ) * 0.6;
let joint = crLine( tj, 0.012 ) * step( 0.5, crHash( vec2f( jc, 3.0 ) ) );
let seal = max( crack, joint ) * ( 1.0 - patchInner ) * step( au, 2.6 );
road = mix( road, vec3f( 0.03, 0.03, 0.032 ), seal * 0.85 ); rough = mix( rough, 0.5, seal );
// oil and rubber drips down the middle of each lane
let o1 = ( au - 1.35 ) / 0.4;
let oil = smoothstep( 0.6, 0.82, crNoise( vec2f( u * 2.3, along * 0.6 ) ) ) * exp( - o1 * o1 ) * ( 0.5 + 0.5 * crNoise( P.xz * 0.11 ) );
road *= 1.0 - oil * 0.45; rough -= oil * 0.25;
// markings: continuous worn edge lines (open at the beach entrances), 3 m centre dashes
let fa = max( fwidth( along ), 1e-4 );
let dp = along - floor( along / ${ period.toFixed( 5 ) } ) * ${ period.toFixed( 5 ) };
let centreLine = crLine( u, 0.05 ) * clamp( ( 1.5 - abs( dp - 1.5 ) ) / fa + 0.5, 0.0, 1.0 );
var open = 0.0; var gap = 0.0;
${ openings }
let edgeLine = crLine( au - 2.47, 0.06 ) * ( 1.0 - max( open, gap ) );
let paint = max( centreLine, edgeLine ) * ( 0.7 + 0.3 * smoothstep( 0.18, 0.5, lum + ( crNoise( P.xz * 2.9 ) - 0.5 ) * 0.35 ) );
road = mix( road, vec3f( 0.8, 0.8, 0.76 ), paint ); rough = mix( rough, 0.62, paint );
// ravelled seal edge, then wind-blown sand lodging in the texture's cavities first
let fu = max( fwidth( u ), 1e-4 );
var paved = clamp( ( 2.72 + ( crNoise( vec2f( along * 1.1, 0.0 ) + P.xz * 0.8 ) - 0.5 ) * 0.16 - au ) / max( fu, 0.035 ) + 0.5, 0.0, 1.0 );
paved = max( paved, gap );
let reach = 3.05 - in.vs.vDrift * 0.3 + ( crFbm( vec2f( along * 0.3, u * 0.6 ) + P.xz * 0.04 ) - 0.5 ) * 0.7;
let cover = smoothstep( reach - 0.5, reach + 0.3, au ) + smoothstep( 0.72, 0.9, crNoise( vec2f( along * 0.07, u * 1.8 ) ) ) * 0.3 * in.vs.vDrift;
let sand = clamp( cover * 1.6 - ( lum - 0.25 ) * 1.2, 0.0, 1.0 ) * clamp( cover * 3.0, 0.0, 1.0 ) * paved * ( 1.0 - gap );
s.albedo = mix( mix( shoulder, road, paved ), sandC, sand );
s.roughness = mix( mix( 0.95, rough, paved ), 0.96, sand );
let k = mix( mix( 0.45, 1.0, paved ), 0.35, max( paint * paved, sand ) );
s.normal = crPerturb( normalize( s.normal ), P, tuv, normalize( vec3f( nm.x * k, - nm.y * k, max( nm.z, 0.2 ) ) ) );
s.alpha = mix( 1.0 - smoothstep( 3.0, 3.85, au ) + ( crNoise( P.xz * 7.0 ) * 0.65 + crNoise( P.xz * 1.7 ) * 0.35 - 0.5 ) * 0.9, 1.0 - step( 2.75, au ), gap );
`;

async function pixels( url ) {
	const bitmap = await createImageBitmap( await ( await fetch( url ) ).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } );
	const canvas = new OffscreenCanvas( bitmap.width, bitmap.height ), context = canvas.getContext( '2d', { willReadFrequently: true } );
	context.drawImage( bitmap, 0, 0 ); bitmap.close && bitmap.close();
	return context.getImageData( 0, 0, SIZE, SIZE ).data;
}

export class CoastalRoad {
	constructor( scene, terrain, route, colliders = null ) {
		this.group = new Group(); this.group.name = 'Coastal road';
		this.guardrails = route.guardrails || [];
		const loop = route.loop, L = route.length, circuit = route.circuit, ferry = route.ferryRoad;
		const ramps = route.paths.filter( path => path.kind === 'gravel' );
		const loopSegments = route.segments.filter( segment => segment.path === loop );
		// Each beach entrance: where it leaves the loop, on which side, and the loop's normal there.
		this.junctions = ramps.map( ramp => {
			const j = ramp.points[ 0 ], q = loopSegments.map( segment => route.project( segment, j.x, j.z ) ).sort( ( a, b ) => a.distance - b.distance )[ 0 ];
			const k = ramp.points[ Math.min( 4, ramp.points.length - 1 ) ];
			return { x: j.x, z: j.z, nx: q.nx, nz: q.nz, along: q.segment.a.distance + Math.min( 1, Math.max( 0, q.raw ) ) * q.segment.length, side: Math.sign( ( k.x - j.x ) * q.nx + ( k.z - j.z ) * q.nz ) || 1 };
		} );

		this.albedo = new Texture( { label: 'coastalAsphaltAlbedo', width: SIZE, height: SIZE, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ] } );
		this.normalRough = new Texture( { label: 'coastalAsphaltNormalRough', width: SIZE, height: SIZE, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst' ] } );
		const textures = { roadAlbedo: this.albedo, roadNormal: this.normalRough };
		const materials = [];
		const surfaceMaterial = o => { const m = new Material( { modules: [ roadNoise ], textures, uniforms: { texReady: [ 'f32', 0 ] }, side: 'double', ...o } ); materials.push( m ); return m; };

		// A value per point and side of a road, sampled along the road's own normal.
		const perSide = ( path, fn ) => path.points.map( ( p, i ) => {
			const pts = path.points, a = pts[ i === 0 ? ( path.closed ? pts.length - 2 : 0 ) : i - 1 ], b = pts[ i === pts.length - 1 ? ( path.closed ? 1 : i ) : i + 1 ];
			const l = Math.hypot( b.x - a.x, b.z - a.z ), nx = ( b.z - a.z ) / l, nz = - ( b.x - a.x ) / l;
			return [ - 1, 1 ].map( side => fn( p, nx * side, nz * side ) );
		} );
		const soften = rows => { for ( let pass = 0; pass < 8; pass ++ ) rows = rows.map( ( r, i ) => r.map( ( v, k ) => ( rows[ Math.max( 0, i - 2 ) ][ k ] + 2 * v + rows[ Math.min( rows.length - 1, i + 2 ) ][ k ] ) / 4 ) ); return rows; };
		// Seaward sand drift: heavier where the verge falls to the beach.
		const driftOf = path => perSide( path, ( p, nx, nz ) => Math.min( 1, Math.max( 0.15, 0.25 + ( p.h - terrain.heightAt( p.x + nx * 16, p.z + nz * 16 ) - 0.2 ) * 0.7 ) ) );
		// How sandy the island is beside the road (its own sand cover): verges are beach
		// sand on the coast and by the town, grass and soil inland and in the hills.
		const sandCover = ( x, z ) => ( terrain.sand[ Math.floor( ( z - terrain.origin ) / terrain.texel ) * terrain.res + Math.floor( ( x - terrain.origin ) / terrain.texel ) ] || 0 ) / 255;
		const sandyOf = path => soften( perSide( path, ( p, nx, nz ) => { const t = Math.min( 1, Math.max( 0, ( Math.max( sandCover( p.x + nx * 5, p.z + nz * 5 ), sandCover( p.x + nx * 9, p.z + nz * 9 ) ) - 0.1 ) / 0.5 ) ); return t * t * ( 3 - 2 * t ); } ) );
		const strip = ( builder, path, offsets, lift, extra = null ) => {
			const pts = path.points, count = offsets.length, base = builder.positions.length / 3, normal = new Vector3();
			for ( let i = 0; i < pts.length; i ++ ) {
				const p = pts[ i ], a = pts[ i === 0 ? ( path.closed ? pts.length - 2 : 0 ) : i - 1 ], b = pts[ i === pts.length - 1 ? ( path.closed ? 1 : i ) : i + 1 ];
				const length = Math.hypot( b.x - a.x, b.z - a.z ), nx = ( b.z - a.z ) / length, nz = - ( b.x - a.x ) / length;
				for ( let j = 0; j < count; j ++ ) {
					const offset = offsets[ j ], x = p.x + nx * offset, z = p.z + nz * offset;
					terrain.normalAt( x, z, normal );
					builder.vertex( x, terrain.heightAt( x, z ) + lift, z, normal.x, normal.y, normal.z, offset, p.distance, extra ? extra( i, offset, x, z ) : 0 );
					if ( i && j < count - 1 ) { const c = base + ( i - 1 ) * count + j, d = base + i * count + j; builder.quad( c, d, d + 1, c + 1 ); }
				}
			}
		};
		const add = ( geometry, material, shadow = false ) => { const mesh = new Mesh( geometry, material ); mesh.staticVelocity = true; mesh.castShadow = shadow; this.group.add( mesh ); return mesh; };

		// Loop: seal, then a shoulder that dissolves into the island's own ground by 3.85 m.
		// Edges are alpha-tested, not blended: blended verges darkened to a brown band.
		const scale = Math.round( L * 0.23 ) / L, period = L / Math.round( L / 12 ), OFFSETS = Array.from( { length: 19 }, ( _, j ) => ( j / 18 * 2 - 1 ) * 3.9 );
		const ground = 'mix( crSoil( P, lum ), crSand( P, lum ), in.vs.vSandy )';
		const verge = { aDrift: 'f32', aSandy: 'f32' }, vergeOut = { vDrift: 'f32', vSandy: 'f32' };
		// The circuit shares asphalt with the loop at both ends, and the ferry road with the
		// circuit where it leaves it: over each merge the parent road's edge line and shoulder
		// open on the branch's side, and the branch's ribbon is cut away wherever it lies on
		// the parent's seal or far shoulder.
		const onLoop = ( x, z ) => route.closest( x, z, segment => segment.path === loop );
		const onCircuit = ( x, z ) => route.closest( x, z, segment => segment.path === circuit );
		const mergeOf = ( points, onParent ) => {
			const alongs = []; let side = 1;
			for ( const p of points ) {
				const q = onParent( p.x, p.z ); if ( ! q || q.distance > 7.7 ) break;
				alongs.push( q.segment.a.distance + Math.min( 1, Math.max( 0, q.raw ) ) * q.segment.length );
				if ( q.distance > 0.5 ) side = Math.sign( ( p.x - q.x ) * q.nx + ( p.z - q.z ) * q.nz ) || 1;
			}
			return { a0: Math.min( ...alongs ) - 1, a1: Math.max( ...alongs ) + 1, side };
		};
		const gapOf = m => `gap = max( gap, clamp( min( along - ${ m.a0.toFixed( 3 ) }, ${ m.a1.toFixed( 3 ) } - along ) / fa + 0.5, 0.0, 1.0 ) * step( 0.0, u * ${ m.side.toFixed( 1 ) } ) );`;
		const merges = this.merges = [ 0, 1 ].map( end => mergeOf( end ? circuit.points.slice().reverse() : circuit.points, onLoop ) );
		const ferryMerge = this.ferryMerge = mergeOf( ferry.points, onCircuit );
		const entrances = this.junctions.map( j => `open = max( open, clamp( ( 6.0 - min( abs( along - ${ j.along.toFixed( 3 ) } ), ${ L.toFixed( 3 ) } - abs( along - ${ j.along.toFixed( 3 ) } ) ) ) / fa + 0.5, 0.0, 1.0 ) * step( 0.0, u * ${ j.side.toFixed( 1 ) } ) );` ).concat( merges.map( gapOf ) ).join( '\n' );
		const loopDrift = driftOf( loop ), loopSandy = sandyOf( loop ), core = new Builder();
		strip( core, loop, OFFSETS, 0.01, ( i, offset ) => { const k = offset < 0 ? 0 : 1; return [ loopDrift[ i ][ k ], loopSandy[ i ][ k ] ]; } );
		add( core.geometry( [ 'aDrift', 'aSandy' ] ), surfaceMaterial( { name: 'Coastal asphalt', roughness: 0.9, alphaTest: 0.5, attributes: verge, varyings: vergeOut,
			vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy;\n' + LIFT( '0.012', '0.002' ), surface: SAMPLE( scale, ground ) + ASPHALT( L, period, entrances ) } ) );

		// Mountain circuit: the same seal, patches and markings.
		const CL = route.circuitLength, circuitDrift = driftOf( circuit ), circuitSandy = sandyOf( circuit ), ribbon = new Builder();
		strip( ribbon, circuit, OFFSETS, 0.01, ( i, offset, x, z ) => {
			const k = offset < 0 ? 0 : 1, q = onLoop( x, z ), m = merges[ circuit.points[ i ].distance < CL / 2 ? 0 : 1 ];
			const far = q && Math.sign( ( x - q.x ) * q.nx + ( z - q.z ) * q.nz ) !== m.side ? 1 : 0;
			return [ circuitDrift[ i ][ k ] * ( 0.4 + 0.6 * circuitSandy[ i ][ k ] ), circuitSandy[ i ][ k ], q ? q.distance : 99, far ];
		} );
		add( ribbon.geometry( [ 'aDrift', 'aSandy', 'aLoopD', 'aFar' ] ), surfaceMaterial( { name: 'Mountain circuit asphalt', roughness: 0.9, alphaTest: 0.5,
			attributes: { ...verge, aLoopD: 'f32', aFar: 'f32' }, varyings: { ...vergeOut, vLoopD: 'f32', vFar: 'f32' },
			vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy; o.vLoopD = v.aLoopD; o.vFar = v.aFar;\n' + LIFT( '0.012', '0.002' ),
			surface: SAMPLE( 0.23, ground ) + ASPHALT( CL, 12, gapOf( ferryMerge ) ) + /* wgsl */`
s.alpha = select( s.alpha, 0.0, in.vs.vLoopD < 2.72 || ( in.vs.vLoopD < 3.9 && in.vs.vFar > 0.5 ) );
` } ) );

		// Ferry road: the same seal, patches and markings, off the circuit and down the east shore.
		// The ribbon runs 5 m on past the terminal's road entry, under the terminal's paving (a
		// few centimetres higher), so no strip of bare ground shows across the joint.
		const tail = ferry.points.at( - 1 ), before = ferry.points.at( - 2 ), run = Math.hypot( tail.x - before.x, tail.z - before.z );
		const drawn = { ...ferry, points: [ ...ferry.points, { ...tail, x: tail.x + ( tail.x - before.x ) / run * 5, z: tail.z + ( tail.z - before.z ) / run * 5, distance: tail.distance + 5 } ] };
		const FL = route.ferryRoadLength, ferryDrift = driftOf( drawn ), ferrySandy = sandyOf( drawn ), ferryRibbon = new Builder();
		strip( ferryRibbon, drawn, OFFSETS, 0.01, ( i, offset, x, z ) => {
			const k = offset < 0 ? 0 : 1, q = onCircuit( x, z );
			const far = q && Math.sign( ( x - q.x ) * q.nx + ( z - q.z ) * q.nz ) !== ferryMerge.side ? 1 : 0;
			return [ ferryDrift[ i ][ k ] * ( 0.4 + 0.6 * ferrySandy[ i ][ k ] ), ferrySandy[ i ][ k ], q ? q.distance : 99, far ];
		} );
		add( ferryRibbon.geometry( [ 'aDrift', 'aSandy', 'aLoopD', 'aFar' ] ), surfaceMaterial( { name: 'Ferry road asphalt', roughness: 0.9, alphaTest: 0.5,
			attributes: { ...verge, aLoopD: 'f32', aFar: 'f32' }, varyings: { ...vergeOut, vLoopD: 'f32', vFar: 'f32' },
			vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy; o.vLoopD = v.aLoopD; o.vFar = v.aFar;\n' + LIFT( '0.012', '0.002' ),
			surface: SAMPLE( 0.23, ground ) + ASPHALT( FL, 12, '' ) + /* wgsl */`
s.alpha = select( s.alpha, 0.0, in.vs.vLoopD < 2.72 || ( in.vs.vLoopD < 3.9 && in.vs.vFar > 0.5 ) );
` } ) );

		// Joey Island's ring: the same seal, patches and markings, closed like the coast loop (its
		// texture and dashes repeat a whole number of times round it). Across the T at the junction
		// its edge line opens on the link's side, where the bell mouth's kerb lines take over; the
		// link carries no edge lines of its own. The link's and the mouths' ribbons are cut away on
		// the ring's seal (and the link's); the link runs 5 m on past the terminal's road entry,
		// under the yard's paving, like the ferry road.
		const joey = route.joeyLoop, link = route.joeyLink, JL = route.joeyLoopLength;
		const onJoey = ( x, z ) => route.closest( x, z, segment => segment.path === joey );
		const jq = onJoey( link.points[ 0 ].x, link.points[ 0 ].z ), jAlong = jq.segment.a.distance + Math.min( 1, Math.max( 0, jq.raw ) ) * jq.segment.length;
		const lk = link.points.at( - 1 ), joeyT = this.joeyT = { a0: jAlong - 7.3, a1: jAlong + 7.3, side: Math.sign( ( lk.x - jq.x ) * jq.nx + ( lk.z - jq.z ) * jq.nz ) || 1 };
		const joeyDrift = driftOf( joey ), joeySandy = sandyOf( joey ), joeyRibbon = new Builder();
		strip( joeyRibbon, joey, OFFSETS, 0.01, ( i, offset ) => { const k = offset < 0 ? 0 : 1; return [ joeyDrift[ i ][ k ] * ( 0.4 + 0.6 * joeySandy[ i ][ k ] ), joeySandy[ i ][ k ] ]; } );
		add( joeyRibbon.geometry( [ 'aDrift', 'aSandy' ] ), surfaceMaterial( { name: 'Joey Island road asphalt', roughness: 0.9, alphaTest: 0.5, attributes: verge, varyings: vergeOut,
			vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy;\n' + LIFT( '0.012', '0.002' ),
			surface: SAMPLE( Math.round( JL * 0.23 ) / JL, ground ) + ASPHALT( JL, JL / Math.round( JL / 12 ), gapOf( joeyT ) ) } ) );
		const linkTail = link.points.at( - 1 ), linkBefore = link.points.at( - 2 ), linkRun = Math.hypot( linkTail.x - linkBefore.x, linkTail.z - linkBefore.z );
		const linkDrawn = { ...link, points: [ ...link.points, { ...linkTail, x: linkTail.x + ( linkTail.x - linkBefore.x ) / linkRun * 5, z: linkTail.z + ( linkTail.z - linkBefore.z ) / linkRun * 5, distance: linkTail.distance + 5 } ] };
		const linkDrift = driftOf( linkDrawn ), linkSandy = sandyOf( linkDrawn ), linkRibbon = new Builder();
		strip( linkRibbon, linkDrawn, OFFSETS, 0.01, ( i, offset, x, z ) => {
			const k = offset < 0 ? 0 : 1, q = onJoey( x, z ), far = q && Math.sign( ( x - q.x ) * q.nx + ( z - q.z ) * q.nz ) !== joeyT.side ? 1 : 0;
			return [ linkDrift[ i ][ k ] * ( 0.4 + 0.6 * linkSandy[ i ][ k ] ), linkSandy[ i ][ k ], q ? q.distance : 99, far ];
		} );
		add( linkRibbon.geometry( [ 'aDrift', 'aSandy', 'aLoopD', 'aFar' ] ), surfaceMaterial( { name: 'Joey Island junction asphalt', roughness: 0.9, alphaTest: 0.5,
			attributes: { ...verge, aLoopD: 'f32', aFar: 'f32' }, varyings: { ...vergeOut, vLoopD: 'f32', vFar: 'f32' },
			vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy; o.vLoopD = v.aLoopD; o.vFar = v.aFar;\n' + LIFT( '0.012', '0.002' ),
			surface: SAMPLE( 0.23, ground ) + ASPHALT( linkTail.distance + 5, 12, 'gap = 1.0;' ) + /* wgsl */`
s.alpha = select( s.alpha, 0.0, in.vs.vLoopD < 2.72 || ( in.vs.vLoopD < 3.9 && in.vs.vFar > 0.5 ) );
` } ) );

		const onLink = ( x, z ) => route.closest( x, z, segment => segment.path === link );
		for ( const mouth of route.joeyMouths ) {
			const m0 = mouth.points[ 0 ], lq = onLink( m0.x, m0.z ), linkSide = Math.sign( ( m0.x - lq.x ) * lq.nx + ( m0.z - lq.z ) * lq.nz ) || 1;
			const mouthDrift = driftOf( mouth ), mouthSandy = sandyOf( mouth ), mouthRibbon = new Builder();
			strip( mouthRibbon, mouth, OFFSETS, 0.01, ( i, offset, x, z ) => {
				const k = offset < 0 ? 0 : 1, q = onJoey( x, z ), l = onLink( x, z ), dq = q ? q.distance : 99, dl = l ? l.distance : 99;
				const far = dq <= dl ? Math.sign( ( x - q.x ) * q.nx + ( z - q.z ) * q.nz ) !== joeyT.side : Math.sign( ( x - l.x ) * l.nx + ( z - l.z ) * l.nz ) !== linkSide;
				return [ mouthDrift[ i ][ k ] * ( 0.4 + 0.6 * mouthSandy[ i ][ k ] ), mouthSandy[ i ][ k ], Math.min( dq, dl ), far ? 1 : 0 ];
			} );
			add( mouthRibbon.geometry( [ 'aDrift', 'aSandy', 'aLoopD', 'aFar' ] ), surfaceMaterial( { name: 'Joey Island junction mouth asphalt', roughness: 0.9, alphaTest: 0.5,
				attributes: { ...verge, aLoopD: 'f32', aFar: 'f32' }, varyings: { ...vergeOut, vLoopD: 'f32', vFar: 'f32' },
				vertex: 'o.vDrift = v.aDrift; o.vSandy = v.aSandy; o.vLoopD = v.aLoopD; o.vFar = v.aFar;\n' + LIFT( '0.012', '0.002' ),
				surface: SAMPLE( 0.23, ground ) + ASPHALT( mouth.points.at( - 1 ).distance, 12, '' ) + /* wgsl */`
s.alpha = select( s.alpha, 0.0, in.vs.vLoopD < 2.72 || ( in.vs.vLoopD < 3.9 && in.vs.vFar > 0.5 ) );
` } ) );
		}

		// Beach tracks: compacted sand and gravel with wheel ruts, dissolving in beyond the
		// asphalt, out at the sides and into the open beach at the bottom.
		for ( const [ index, ramp ] of ramps.entries() ) {
			const j = this.junctions[ index ], length = ramp.points.at( - 1 ).distance, builder = new Builder();
			strip( builder, ramp, Array.from( { length: 11 }, ( _, k ) => ( k / 10 * 2 - 1 ) * 3.2 ), 0.02, false );
			add( builder.geometry(), surfaceMaterial( { name: `Coastal ${ ramp.name } beach track`, roughness: 0.97, alphaTest: 0.5, vertex: LIFT( '0.03', '0.0024' ), surface: SAMPLE( 0.29 ) + /* wgsl */`
let t = along / ${ length.toFixed( 4 ) };
let r1 = ( au - 0.82 ) / 0.26; let rut = exp( - r1 * r1 ) * ( 1.0 - smoothstep( 0.55, 1.0, t ) * 0.6 );
let gravel = smoothstep( 0.38, 0.62, lum ) * ( 1.0 - smoothstep( 0.2, 0.85, t ) ) * ( 1.0 - smoothstep( 1.4, 2.4, au ) );
s.albedo = mix( sandC * ( 0.95 - rut * 0.22 ), sandC * vec3f( 0.66, 0.63, 0.6 ), gravel * 0.9 );
s.roughness = 0.97 - rut * 0.07;
let k = 0.5 + gravel * 0.4; let slope = - r1 * rut * 0.5 * sign( u );
s.normal = crPerturb( normalize( s.normal ), P, tuv, normalize( vec3f( nm.x * k + slope, - nm.y * k, max( nm.z, 0.2 ) ) ) );
let n = crFbm( P.xz * 0.5 ) - 0.5;
let sides = 1.0 - smoothstep( 1.9 + n * 0.6, 2.9 + n * 0.3, au );
let tail = ( 1.0 - smoothstep( ${ ( length - 10 ).toFixed( 3 ) }, ${ ( length - 1.5 ).toFixed( 3 ) }, along + n * 4.0 ) ) * ( 1.0 - smoothstep( ${ ( length - 1.2 ).toFixed( 3 ) }, ${ ( length - 0.1 ).toFixed( 3 ) }, along ) );
let head = smoothstep( 2.9, 3.7, abs( dot( P.xz - vec2f( ${ j.x.toFixed( 4 ) }, ${ j.z.toFixed( 4 ) } ), vec2f( ${ j.nx.toFixed( 5 ) }, ${ j.nz.toFixed( 5 ) } ) ) ) + n * 0.4 );
s.alpha = sides * tail * head + ( crNoise( P.xz * 7.0 ) * 0.65 + crNoise( P.xz * 1.7 ) * 0.35 - 0.5 ) * 0.9;
` } ) );
		}

		// Galvanised W-beam on steel posts with blockouts; both ends flare away and bury.
		const steel = new Builder(), railBoxes = [];
		for ( const run of this.guardrails ) {
			const pts = run.points, dist = [ 0 ];
			for ( let k = 1; k < pts.length; k ++ ) dist.push( dist[ k - 1 ] + Math.hypot( pts[ k ].x - pts[ k - 1 ].x, pts[ k ].z - pts[ k - 1 ].z ) );
			const total = dist.at( - 1 );
			const frames = pts.map( ( p, k ) => {
				const q = pts[ Math.max( 0, k - 1 ) ], r = pts[ Math.min( pts.length - 1, k + 1 ) ], l = Math.hypot( r.x - q.x, r.z - q.z );
				const e0 = Math.min( 1, Math.min( dist[ k ], total - dist[ k ] ) / TERMINAL ), e = e0 * e0 * ( 3 - 2 * e0 ), flare = ( 1 - e0 ) * ( 1 - e0 ) * 0.9;
				const bury = Math.min( p.road, p.ground ) - 0.26;
				return { x: p.x + p.nx * flare, z: p.z + p.nz * flare, y: bury + ( p.road + BEAM_HEIGHT - bury ) * e, tx: ( r.x - q.x ) / l, tz: ( r.z - q.z ) / l, nx: p.nx, nz: p.nz, s: dist[ k ], e, road: p.road, ground: p.ground };
			} );
			for ( const back of [ 0, 0.003 ] ) {
				const base = steel.positions.length / 3;
				for ( const f of frames ) for ( let i = 0; i < W_BEAM.length; i ++ ) {
					const [ d, h ] = W_BEAM[ i ], [ d0, h0 ] = W_BEAM[ Math.max( 0, i - 1 ) ], [ d1, h1 ] = W_BEAM[ Math.min( W_BEAM.length - 1, i + 1 ) ];
					const l = Math.hypot( h1 - h0, d1 - d0 ), sign = back ? - 1 : 1, nd = ( h1 - h0 ) / l * sign, nh = - ( d1 - d0 ) / l * sign;
					steel.vertex( f.x + f.nx * ( d + back ), f.y + h, f.z + f.nz * ( d + back ), f.nx * nd, nh, f.nz * nd, f.s, i / ( W_BEAM.length - 1 ) );
				}
				for ( let k = 0; k < frames.length - 1; k ++ ) for ( let i = 0; i < W_BEAM.length - 1; i ++ ) {
					const a = base + k * W_BEAM.length + i, b = a + W_BEAM.length; steel.quad( a, b, b + 1, a + 1 );
				}
			}
			for ( let s = 1; s < total; s += POST_SPACING ) {
				const f = frames.reduce( ( best, frame ) => Math.abs( frame.s - s ) < Math.abs( best.s - s ) ? frame : best );
				if ( f.e < 0.3 ) continue;
				const top = f.y + 0.1, bottom = Math.min( f.ground, f.road ) - 0.35;
				steel.box( f.x + f.nx * 0.158, f.y, f.z + f.nz * 0.158, f.tx, f.tz, f.nx, f.nz, 0.075, 0.1, 0.075 );
				steel.box( f.x + f.nx * 0.283, ( top + bottom ) / 2, f.z + f.nz * 0.283, f.tx, f.tz, f.nx, f.nz, 0.075, ( top - bottom ) / 2, 0.05 );
			}
			// Solid collision behind the face, in short yawed boxes that follow curve and grade.
			for ( let k = 0; k < frames.length - 1; k += 2 ) {
				const a = frames[ k ], b = frames[ Math.min( frames.length - 1, k + 2 ) ], mid = frames[ Math.min( frames.length - 1, k + 1 ) ];
				if ( Math.min( a.e, b.e ) < 0.45 ) continue;
				const length = Math.hypot( b.x - a.x, b.z - a.z ), cx = ( a.x + b.x ) / 2 + mid.nx * 0.43, cz = ( a.z + b.z ) / 2 + mid.nz * 0.43;
				railBoxes.push( [ new Vector3( cx, ( a.road + b.road ) / 2 + 0.35, cz ), new Vector3( 0.45, 0.55, length / 2 + 0.06 ), Math.atan2( b.x - a.x, b.z - a.z ) ] );
			}
		}
		if ( steel.positions.length ) add( steel.geometry(), new Material( { name: 'Galvanised W-beam guardrail', modules: [ roadNoise ], side: 'front', roughness: 0.4, metalness: 0.8, surface: /* wgsl */`
let beam = step( 0.0, in.uv.y ); let v = clamp( in.uv.y, 0.0, 1.0 ); let P = in.P;
let mottle = crFbm( P.xz * 3.1 + vec2f( P.y * 2.3, 0.0 ) );
let oxide = smoothstep( 0.58, 0.8, crFbm( P.xz * 0.7 + vec2f( P.y * 1.3, 4.0 ) ) );
var albedo = vec3f( 0.6, 0.62, 0.63 ) * ( 0.9 + mottle * 0.2 );
var metal = 0.8; var rough = 0.34 + mottle * 0.14;
albedo = mix( albedo, vec3f( 0.74, 0.74, 0.71 ), oxide * 0.7 ); metal = mix( metal, 0.15, oxide * 0.8 ); rough = mix( rough, 0.8, oxide );
// post bolts in the centre valley, lap joints every 4 m, sand grime and weep streaks low down
let m = ( in.uv.x - 1.0 ) - floor( ( in.uv.x - 1.0 ) / 2.0 ) * 2.0; let dpost = min( m, 2.0 - m );
let r = length( vec2f( dpost, ( v - 0.5 ) * 0.31 ) );
let bolt = beam * ( 1.0 - smoothstep( 0.011, 0.018, r ) ); let ring = beam * smoothstep( 0.014, 0.018, r ) * ( 1.0 - smoothstep( 0.018, 0.026, r ) );
let lm = ( in.uv.x - 3.16 ) - floor( ( in.uv.x - 3.16 ) / 4.0 ) * 4.0;
let lap = beam * crLine( min( lm, 4.0 - lm ), 0.0025 );
let grime = beam * smoothstep( 0.6, 1.0, v ) * crNoise( vec2f( in.uv.x * 1.3, v * 4.0 ) );
let streak = beam * smoothstep( 0.5, 1.0, v ) * exp( - dpost * dpost / 0.004 ) * 0.35;
albedo = mix( albedo, vec3f( 0.5, 0.45, 0.36 ), grime * 0.45 ) * ( 1.0 - streak * 0.4 ) * ( 1.0 - ring * 0.5 ) * ( 1.0 - lap * 0.6 );
albedo = mix( albedo, vec3f( 0.36, 0.36, 0.35 ), bolt ) * mix( 0.7, 1.0, beam );
s.albedo = albedo; s.metalness = mix( metal, 0.3, grime * 0.5 ); s.roughness = mix( rough, 0.75, grime * 0.6 );
let valley = ( v - 0.5 ) / 0.12;
s.ao = 1.0 - beam * 0.22 * exp( - valley * valley );
` } ), true );
		if ( colliders ) for ( const [ center, half, rotY ] of railBoxes ) colliders.addBox( center, half, rotY, { tag: 'guardrail' } );
		this.railColliders = railBoxes.length;

		// White guide posts with red (keep-left) and white reflectors wherever there is no barrier.
		const posts = new Builder( true ), railed = new Set( this.guardrails.flatMap( run => run.points.flatMap( p => [ - 3, 0, 3 ].map( o => `${ run.path }:${ run.side }:${ p.index + o }` ) ) ) );
		const postsAlong = ( path, skip ) => {
			const pts = path.points, n = path.closed ? pts.length - 1 : pts.length;
			for ( let i = path.closed ? 0 : 12; i < ( path.closed ? n : n - 12 ); i += 25 ) {
				const p = pts[ i ], a = pts[ ( i + n - 1 ) % n ], b = pts[ ( i + 1 ) % n ], l = Math.hypot( b.x - a.x, b.z - a.z );
				const tx = ( b.x - a.x ) / l, tz = ( b.z - a.z ) / l;
				if ( skip( p ) ) continue;
				for ( const side of [ - 1, 1 ] ) {
					if ( railed.has( `${ path.name }:${ side }:${ i }` ) ) continue;
					const nx = tz * side, nz = - tx * side, x = p.x + nx * 4.0, z = p.z + nz * 4.0, ground = terrain.heightAt( x, z );
					posts.box( x, ground + 0.4, z, tx, tz, nx, nz, 0.035, 0.6, 0.06, [ - 1, - 1 ], [ 0.82, 0.82, 0.78 ] );
					for ( const face of [ - 1, 1 ] ) {
						const red = face === - side;
						posts.box( x + tx * face * 0.041, ground + 0.86, z + tz * face * 0.041, tx, tz, nx, nz, 0.006, 0.07, 0.04, [ - 1, - 1 ], red ? [ 0.62, 0.035, 0.025 ] : [ 0.9, 0.9, 0.86 ] );
					}
				}
			}
		};
		const nearRoad = ( p, other, reach ) => ( route.closest( p.x, p.z, segment => segment.path === other ) || { distance: Infinity } ).distance < reach;
		postsAlong( loop, p => this.junctions.some( j => Math.hypot( j.x - p.x, j.z - p.z ) < 11 ) || nearRoad( p, circuit, 10 ) );
		postsAlong( circuit, p => nearRoad( p, loop, 12 ) || nearRoad( p, ferry, 10 ) );
		postsAlong( ferry, p => nearRoad( p, circuit, 12 ) );
		postsAlong( joey, p => nearRoad( p, link, 12 ) );
		if ( posts.positions.length ) add( posts.geometry(), new Material( { name: 'Roadside guide posts', color: 0xffffff, roughness: 0.55, side: 'front' } ), true );

		scene.add( this.group );
		this.ready = this.loadTextures( materials );
	}

	async loadTextures( materials ) {
		try {
			const [ albedo, normal, rough ] = await Promise.all( [ 'diff', 'nor_gl', 'rough' ].map( map => pixels( `${ SURFACES }asphalt_02_${ map }_1k.jpg` ) ) );
			for ( let i = 0; i < SIZE * SIZE; i ++ ) normal[ i * 4 + 3 ] = rough[ i * 4 ];
			for ( const [ texture, data ] of [ [ this.albedo, albedo ], [ this.normalRough, normal ] ] ) {
				texture.upload( new Uint8Array( data.buffer, data.byteOffset, data.byteLength ) ); generateMipmaps( texture );
			}
			for ( const material of materials ) material.set( 'texReady', 1 );
		} catch ( error ) {
			// Keep the procedural stand-in surface; the road stays drivable and legible.
			console.warn( 'CoastalRoad: asphalt textures unavailable', error );
		}
	}
}
