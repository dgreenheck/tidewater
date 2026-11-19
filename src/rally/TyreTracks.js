import { Mesh, BufferGeometry, BufferAttribute, DynamicDrawUsage, Vector3, Quaternion } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';

const CAPACITY = 24000;
const STEP = 0.16;
// Metres of track per uv.y wrap: a whole number of both tread pitches (0.09, 0.18) and of the
// 0.28 m roost scallops, so the shift keeps every pattern in phase while f32 stays precise.
const WRAP = 25.2;
const clamp = ( value, lo, hi ) => Math.max( lo, Math.min( hi, value ) );
const smooth = ( a, b, x ) => { const t = clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };

// Surface kinds match the physics snapshot (state[ 89 + wheel ]): 0 sand, 1 soil/grass, 2 rock,
// 3 asphalt, 4 gravel, 5 wood/prop, 6 water, 7 wet sand (printed as sand with full wetness).
// Per kind: rut depth scale, berm width per side as a fraction of the groove, berm height / depth.
const GROUND = [
	{ depth: 1, berm: 0.36, rise: 0.55 },
	{ depth: 0.6, berm: 0.2, rise: 0.3 },
	{ depth: 0, berm: 0.05, rise: 0 },
	{ depth: 0, berm: 0.05, rise: 0 },
	{ depth: 0.3, berm: 0.14, rise: 0.25 },
];
const HARD = kind => kind === 2 || kind === 3;
const ATTRIBUTES = { position: 3, normal: 3, uv: 2, aMark: 4, aShape: 4, aSlip: 4, aAcross: 3 };

// The imprint is a height field in metres over the ribbon (u -1..1 across, uv.y metres along):
// groove, displaced berms, the vehicle's tread stamped into the groove floor, smearing under slide,
// roost scallops under wheelspin and a bulldozed mound where a locked tyre stopped. The ribbon is
// drawn with multiply blending: the output is the ratio of the scene lighting on the imprint to the
// lighting on the flat ground, times a tint, so it relights whatever terrain colour lies beneath.
const SURFACE = /* wgsl */`
let mark = in.vs.vMark;
let shape = in.vs.vShape;
let tyre = in.vs.vSlip;
let kind = mark.z;
let sandW = 1.0 - step( 0.5, kind );
let soilW = step( 0.5, kind ) * ( 1.0 - step( 1.5, kind ) );
let hardW = step( 1.5, kind ) * ( 1.0 - step( 3.5, kind ) );
let gravelW = step( 3.5, kind );
let asphaltW = step( 2.5, kind ) * hardW;
let g = clamp( shape.z, 0.3, 1.0 );
let hw = max( length( in.vs.vAcross ), 0.02 );
let across = in.vs.vAcross / hw;
let along = vec3f( -across.z, 0.0, across.x );
let pitch = max( abs( shape.w ), 0.03 );
let mudTread = step( shape.w, 0.0 );
let slide = clamp( mark.y, 0.0, 1.0 );
let cap = step( tyre.x, -1.5 );
let spin = clamp( tyre.x, 0.0, 1.0 );
let lock = clamp( -tyre.x, 0.0, 1.0 ) * ( 1.0 - cap );
let wet = clamp( tyre.y, 0.0, 1.0 );
let depth = shape.x * mix( 1.0, 0.3, wet );
let rise = shape.y * mix( 1.0, 0.2, wet ) * ( 1.0 + spin * 0.7 + lock * 0.5 );
let outer = max( 1.0 / g, 1.12 );
// tread detail fades once a pitch shrinks to a few pixels (no shimmer at chase distance)
let fw = max( fwidth( in.uv.y ) / pitch, fwidth( in.uv.x ) / g * 3.0 );
let detail = 1.0 - smoothstep( 0.12, 0.4, fw );
let crisp = detail * ( 1.0 - max( slide, lock ) * 0.92 ) * ( 1.0 - spin * 0.6 );
var hs = array<f32, 3>( 0.0, 0.0, 0.0 );
var grooveC = 0.0; var bermC = 0.0; var blockC = 1.0; var streakC = 0.5;
for ( var k = 0; k < 3; k = k + 1 ) {
	let u = in.uv.x + select( 0.0, 0.006 / hw, k == 1 );
	let m = in.uv.y + select( 0.0, 0.006, k == 2 );
	let ug = u / g;
	// crumbled rut walls and a lumpy berm rather than extruded straight edges
	let x = abs( u ) / g + 0.05 * sin( m * 23.0 + sin( m * 7.0 ) * 1.7 );
	let groove = 1.0 - smoothstep( 0.7, 1.0, x );
	let berm = smoothstep( 0.8, 1.08, x ) * ( 1.0 - smoothstep( 1.08, outer, x ) ) * ( 0.8 + 0.2 * sin( m * 9.0 + u * 5.0 ) );
	// Tread stamps (1 = pressed block). Road tyre: four ribs, three straight grooves, angled sipes and
	// slotted shoulders. Mud-terrain: three staggered columns of chunky lugs with wide voids.
	let vm = m / pitch;
	let ribGap = 1.0 - smoothstep( 0.04, 0.1, min( abs( abs( ug ) - 0.45 ), abs( ug ) ) );
	let sp = fract( vm * 2.0 + ug * 0.35 );
	let sipe = 1.0 - smoothstep( 0.05, 0.16, min( sp, 1.0 - sp ) );
	let sq = fract( vm + 0.25 );
	let slot = ( 1.0 - smoothstep( 0.08, 0.16, min( sq, 1.0 - sq ) ) ) * smoothstep( 0.66, 0.74, abs( ug ) );
	let rib = ( 1.0 - ribGap ) * ( 1.0 - sipe * 0.45 ) * ( 1.0 - slot );
	let col = floor( ( ug + 1.0 ) * 1.5 );
	let lp = fract( vm + col * 0.5 + abs( ug ) * 0.3 );
	let lug = smoothstep( 0.04, 0.14, lp ) * ( 1.0 - smoothstep( 0.46, 0.6, lp ) );
	let seam = smoothstep( 0.7, 0.95, abs( fract( ( ug + 1.0 ) * 1.5 ) - 0.5 ) * 2.0 );
	let block = mix( rib, lug * ( 1.0 - seam ), mudTread );
	let streak = 0.5 + 0.5 * sin( u * 41.0 + sin( u * 13.0 ) * 2.2 );
	let sc = fract( m / 0.28 + ug * ug * 0.5 );
	let scoop = smoothstep( 0.0, 0.7, sc ) * ( 1.0 - smoothstep( 0.7, 1.0, sc ) );
	var h = -depth * groove + rise * berm;
	h += ( 1.0 - block ) * depth * 0.14 * crisp * groove * ( 0.6 + 0.4 * sin( m * 2.3 + sin( m * 0.9 ) * 2.0 ) );
	h += ( streak - 0.5 ) * depth * 0.2 * max( slide, lock ) * groove;
	h -= scoop * depth * 0.9 * spin * groove;
	let t = clamp( m / ( hw * 1.1 ), 0.0, 1.0 );
	let mound = shape.y * 2.4 * sin( t * 3.14159 ) * ( 1.0 - smoothstep( 0.5, 1.0, abs( u ) ) );
	hs[ k ] = mix( h * ( 1.0 - hardW ), mound, cap );
	if ( k == 0 ) { grooveC = groove * ( 1.0 - cap ); bermC = mix( berm, mound / max( shape.y * 2.4, 1e-4 ), cap ); blockC = block; streakC = streak; }
}
let dA = clamp( ( hs[ 1 ] - hs[ 0 ] ) / 0.006, -0.45, 0.45 );
let dT = clamp( ( hs[ 2 ] - hs[ 0 ] ) / 0.006, -0.45, 0.45 );
// rubber on hard ground: full width when sliding or spinning, the two loaded shoulders under lock-up
let xg = abs( in.uv.x ) / g;
let sd = ( xg - 0.72 ) * 6.0;
let shoulders = exp( -sd * sd ) + 0.12 * ( 1.0 - smoothstep( 0.6, 0.9, xg ) );
let full = ( 1.0 - smoothstep( 0.78, 1.0, xg ) ) * mix( 0.72 + 0.28 * streakC, 1.0 - 0.35 * xg * xg, spin );
let rubber = mix( full, shoulders, lock * ( 1.0 - slide * 0.7 ) ) * clamp( mark.x, 0.0, 1.0 ) * hardW;
let life = select( select( 1800.0, 90.0, in.P.y < 0.9 ), 35.0, in.P.y < 0.5 ) * mix( 1.0, 0.5, wet );
let age = 1.0 - smoothstep( life * 0.55, life, mat.trackTime - mark.w );
let recycle = 1.0 - smoothstep( 0.8, 0.97, ( mat.trackSerial - tyre.z ) / mat.trackCapacity );
let cover = ( 1.0 - smoothstep( outer * 0.9, outer, xg ) ) * age * recycle * smoothstep( 0.0, 0.1, tyre.w + cap );
let grit = fract( sin( dot( floor( in.P.xz * 65.0 ), vec2f( 127.1, 311.7 ) ) ) * 43758.5453 );
let kicked = step( 1.0 - spin * 0.3, grit ) * ( 1.0 - grooveC * 0.6 );
let damp = mix( vec3f( 0.85, 0.83, 0.8 ), vec3f( 0.70, 0.705, 0.735 ), wet );
let loose = mix( vec3f( 1.05, 1.05, 1.045 ), vec3f( 0.94, 0.94, 0.955 ), wet );
var sandT = mix( mix( vec3f( 1.0 ), loose, bermC ), damp, grooveC * mix( clamp( shape.x / 0.03, 0.4, 1.0 ), 1.0, wet ) );
sandT *= ( 1.0 + 0.1 * kicked ) * ( 1.0 + ( 1.0 - blockC ) * 0.05 * crisp * grooveC );
let soilT = mix( mix( vec3f( 1.0 ), vec3f( 0.88, 0.86, 0.8 ), bermC ), vec3f( 0.6, 0.58, 0.52 ), grooveC );
let gravelT = mix( mix( vec3f( 1.0 ), vec3f( 0.93, 0.92, 0.9 ), bermC ), vec3f( 1.13, 1.11, 1.07 ), grooveC ) * ( 1.0 - 0.22 * kicked );
let hardT = mix( vec3f( 1.0 ), mix( vec3f( 0.55, 0.55, 0.56 ), vec3f( 0.25, 0.26, 0.28 ), asphaltW ), clamp( rubber, 0.0, 1.0 ) );
let tint = sandT * sandW + soilT * soilW + gravelT * gravelW + hardT * hardW;
let N = normalize( in.N );
let base = mix( 0.92, 0.86, hardW );
s.albedo = mix( vec3f( 1.0 ), tint, cover );
s.normal = normalize( N - ( across * dA + along * dT ) * cover );
s.ao = 1.0 - cover * ( clamp( depth * 5.0, 0.0, 0.2 ) * grooveC + 0.08 * smoothstep( 0.6, 0.9, xg ) * ( 1.0 - smoothstep( 0.95, 1.1, xg ) ) ) * ( 1.0 - hardW );
s.roughness = mix( base, mix( mix( base, 0.38, wet * grooveC * sandW ), 0.62, clamp( rubber, 0.0, 1.0 ) * asphaltW ), cover );
s.alpha = 1.0;
`;

const OUTPUT = /* wgsl */`
var flat = s;
flat.normal = normalize( in.N );
flat.albedo = vec3f( 1.0 );
flat.ao = 1.0;
flat.roughness = mix( 0.92, 0.86, step( 1.5, in.vs.vMark.z ) * ( 1.0 - step( 3.5, in.vs.vMark.z ) ) );
let ground = shadeSurface( flat, in.P, in.V, in.pixel );
// alpha 0: the multiply blend ignores it and the premultiplied motion keeps the ground's velocity
r.color = vec4f( clamp( r.color.rgb / max( ground, vec3f( 1e-4 ) ), vec3f( 0.15 ), vec3f( 2.2 ) ), 0.0 );
`;

// Terrain-conforming contact ribbons, fed only from the actual Avian wheel contacts. The imprint is
// a visual surface effect, not collision deformation. Each wheel prints one continuous strip: every
// quad starts on the previous quad's end edge and follows a tangent-continuous arc between frames.
export class TyreTracks {
	constructor( scene, terrain, capacity = CAPACITY ) {
		this.terrain = terrain;
		this.capacity = capacity;
		this.count = 0;
		this.cursor = 0;
		this.serial = 0;
		this.skids = 0;
		this.time = 0;
		this.previous = new Map();
		this.q = new Quaternion();
		this.normal = new Vector3();
		this.forward = new Vector3();
		this.geometry = new BufferGeometry();
		this.attributes = {};
		for ( const [ name, size ] of Object.entries( ATTRIBUTES ) ) {
			const attribute = new BufferAttribute( new Float32Array( capacity * 6 * size ), size );
			attribute.setUsage( DynamicDrawUsage );
			this.geometry.setAttribute( name, attribute );
			this.attributes[ name ] = attribute;
		}
		this.geometry.setDrawRange( 0, 0 );
		this.material = new Material( {
			name: 'Contact tyre impressions', transparent: true, depthWrite: false, side: 'double', blending: 'multiply', roughness: 0.92,
			attributes: { aMark: 'vec4f', aShape: 'vec4f', aSlip: 'vec4f', aAcross: 'vec3f' },
			varyings: { vMark: 'vec4f', vShape: 'vec4f', vSlip: 'vec4f', vAcross: 'vec3f' },
			uniforms: { trackTime: [ 'f32', 0 ], trackSerial: [ 'f32', 0 ], trackCapacity: [ 'f32', capacity ] },
			vertex: 'o.vMark = v.aMark; o.vShape = v.aShape; o.vSlip = v.aSlip; o.vAcross = v.aAcross;',
			surface: SURFACE,
			output: OUTPUT,
		} );
		this.mesh = new Mesh( this.geometry, this.material );
		this.mesh.name = 'Wheel contact tracks';
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.frustumCulled = false;
		this.mesh.staticVelocity = true;
		this.mesh.castShadow = false;
		scene.add( this.mesh );
	}

	tick( dt ) { this.time += dt; this.material.set( 'trackTime', this.time ); }
	reset( key = 'local' ) { this.previous.delete( key ); }

	emit( key, state, profile ) {
		if ( state.length < 69 ) return;
		let wheels = this.previous.get( key );
		if ( ! wheels ) { wheels = [ null, null, null, null ]; this.previous.set( key, wheels ); }
		this.q.fromArray( state, 3 );
		const first = this.serial;
		for ( let wheel = 0; wheel < 4; wheel ++ ) {
			const contact = this.contact( state, wheel );
			wheels[ wheel ] = contact ? this.advance( wheels[ wheel ], contact, state, wheel, profile ) : null;
		}
		this.flush( this.serial - first );
	}

	// One wheel's contact this frame, or null where no print belongs (airborne, unloaded, on a bridge
	// or prop, in water, or rolling freely on asphalt and rock).
	contact( state, wheel ) {
		const i = 29 + wheel * 10, v = 13 + wheel * 4, rich = state.length >= 96;
		const x = state[ i ], y = state[ i + 1 ], z = state[ i + 2 ], load = state[ i + 6 ];
		if ( ! state[ v + 3 ] || load < 120 || y < 0.15 || ! Number.isFinite( x + y + z ) ) return null;
		// floating, or the contact is under the sea surface / swash sheet at the car
		if ( rich && ( state[ 73 ] > 0.45 || ( state[ 93 ] > - 999 && y < state[ 93 ] + 0.02 ) ) ) return null;
		const ground = this.terrain.heightAt( x, z );
		if ( Math.abs( y - ground ) > 0.09 ) return null;
		let kind = rich ? Math.round( state[ 89 + wheel ] ) : this.classify( x, z );
		let wet = 0;
		if ( kind === 7 ) { kind = 0; wet = 1; } else if ( kind === 0 ) wet = smooth( 1.35, 0.55, ground );
		if ( ! ( kind >= 0 && kind <= 4 ) ) return null;
		const speed = Math.abs( state[ i + 8 ] ), lateral = Math.abs( state[ i + 9 ] ), turning = Math.abs( state[ v + 2 ] );
		let ratio, slide, scrub;
		if ( rich ) {
			ratio = clamp( state[ 81 + wheel ], - 1, 1 );
			slide = clamp( state[ i + 7 ], 0, 1 );
			scrub = Math.max( smooth( 0.1, 0.45, Math.abs( ratio ) ), smooth( 0.08, 0.3, Math.abs( state[ 85 + wheel ] ) ), smooth( 0.35, 0.8, slide ) );
		} else {
			// Older snapshots: a stopped wheel on a moving contact is a lock-up.
			const locked = turning < 0.1 && speed > 1;
			ratio = locked ? - 1 : clamp( ( turning - speed ) / Math.max( speed, 1 ), - 1, 1 );
			slide = Math.max( clamp( state[ i + 7 ], 0, 1 ), clamp( lateral / Math.max( speed, 1 ), 0, 1 ), locked ? 1 : 0 );
			scrub = slide < 0.2 ? 0 : Math.max( 0.3, smooth( 0.2, 0.7, slide ) );
		}
		if ( HARD( kind ) && scrub < 0.02 ) return null;
		return { x, z, load, speed, kind, ratio, slide, scrub, wet, locked: ratio < - 0.6 && ! HARD( kind ) };
	}

	classify( x, z ) {
		const t = this.terrain, road = t.roadSurfaceAt?.( x, z )?.kind;
		if ( road === 'asphalt' ) return 3;
		if ( road === 'gravel' ) return 4;
		const gridX = clamp( Math.floor( ( x - t.origin ) / t.texel ), 0, t.res - 1 );
		const gridZ = clamp( Math.floor( ( z - t.origin ) / t.texel ), 0, t.res - 1 );
		const sand = ( t.sand?.[ gridZ * t.res + gridX ] ?? 255 ) / 255, rock = t.rock?.[ gridZ * t.res + gridX ] ?? 0;
		return rock > 0.7 && sand < 0.25 ? 2 : sand > 0.3 ? 0 : 1;
	}

	advance( old, c, state, wheel, profile ) {
		if ( ! old ) return { x: c.x, z: c.z, edge: null, lock: 0 };
		const dx = c.x - old.x, dz = c.z - old.z, distance = Math.hypot( dx, dz );
		if ( distance > 4 ) return { x: c.x, z: c.z, edge: null, lock: 0 }; // teleport / reset
		if ( distance < 0.08 ) {
			if ( ! old.stamped && c.kind === 3 && c.speed < 0.8 && c.ratio > 0.6 && Math.abs( state[ 15 + wheel * 4 ] ) > 4 ) {
				// Standing burnout. Deposit the loaded footprint once at this patch;
				// new strip geometry belongs to the distance travelled after release.
				const steer = state[ 14 + wheel * 4 ];
				this.forward.set( Math.sin( steer ), 0, Math.cos( steer ) ).applyQuaternion( this.q );
				const norm = Math.hypot( this.forward.x, this.forward.z ) || 1;
				const tx = this.forward.x / norm, tz = this.forward.z / norm;
				const target = this.target( c, profile ), half = target.patch * 0.5;
				const a = this.edge( c.x - tx * half, c.z - tz * half, tx, tz, null, target, 1, 0, 1 );
				const b = this.edge( c.x + tx * half, c.z + tz * half, tx, tz, null, target, 1, target.patch, 1 + target.patch );
				this.segment( a, b, c.kind, profile.tread );
				old.stamped = true;
			}
			// A tyre that ploughed to a stop locked bulldozes a mound of sand ahead of itself.
			if ( old.lock > 0.6 && old.edge && c.speed < 0.4 ) { this.mound( old.edge, c ); old.lock = 0; }
			return old;
		}
		const cx = dx / distance, cz = dz / distance;
		let edge = old.edge, tx = cx, tz = cz, dot = 1;
		if ( edge ) {
			dot = edge.tx * cx + edge.tz * cz;
			if ( dot > 0.5 ) { tx = edge.tx; tz = edge.tz; } else { edge = null; dot = 1; } // reversing or a hard kink
		}
		// Quadratic arc from the previous end tangent: tangent-continuous at every frame joint.
		const reach = distance / ( 2 * dot ), kx = old.x + tx * reach, kz = old.z + tz * reach;
		const steer = state[ 13 + wheel * 4 + 1 ];
		this.forward.set( Math.sin( steer ), 0, Math.cos( steer ) ).applyQuaternion( this.q );
		const target = this.target( c, profile );
		if ( ! edge ) edge = this.edge( old.x, old.z, tx, tz, null, target, 1, 0, 0 );
		const pieces = Math.ceil( distance / STEP ), pitch = ( profile.tread || 0.09 ) * ( profile.treadPattern === 'mud' ? - 1 : 1 );
		for ( let piece = 1; piece <= pieces; piece ++ ) {
			const s = piece / pieces, r = 1 - s;
			const bx = r * r * old.x + 2 * s * r * kx + s * s * c.x, bz = r * r * old.z + 2 * s * r * kz + s * s * c.z;
			let gx = r * ( kx - old.x ) + s * ( c.x - kx ), gz = r * ( kz - old.z ) + s * ( c.z - kz );
			const length = Math.hypot( gx, gz ) || 1; gx /= length; gz /= length;
			if ( edge.along >= WRAP ) edge = { ...edge, along: edge.along - WRAP };
			const step = Math.hypot( bx - edge.x, bz - edge.z );
			const next = this.edge( bx, bz, gx, gz, edge, target, 1 / ( pieces - piece + 1 ), edge.along + step, edge.strip + step );
			this.segment( edge, next, c.kind, pitch );
			edge = next;
		}
		return { x: c.x, z: c.z, edge, lock: c.locked ? old.lock + distance : 0 };
	}

	// Continuous per-edge values for this contact.
	target( c, profile ) {
		const ground = GROUND[ c.kind ], hard = HARD( c.kind ), sinkage = profile.sinkage ?? 0.025;
		const pressure = clamp( c.load / ( profile.mass * 9.81 / 4 ), 0.35, 1.6 );
		const bite = 1 + clamp( c.ratio, 0, 1 ) * 0.45 + clamp( - c.ratio, 0, 1 ) * 0.4;
		return {
			strength: hard ? c.scrub : pressure, slide: c.slide, ratio: c.ratio, wet: c.wet,
			depth: sinkage * ground.depth * Math.pow( pressure, 0.8 ) * bite,
			rise: sinkage * ground.depth * ground.rise * pressure,
			bermFrac: ground.berm * ( c.kind === 0 ? 1 - 0.65 * c.wet : 1 ),
			width: profile.width, patch: clamp( c.load / ( profile.pressure * profile.width ), 0.04, 0.23 ),
		};
	}

	// An edge across the strip at centre (x, z) with travel tangent (tx, tz). Values move `s` of the
	// way from `from` to `to`, so every property changes smoothly along the strip.
	edge( x, z, tx, tz, from, to, s, along, strip ) {
		const lerp = key => from ? from[ key ] + ( to[ key ] - from[ key ] ) * s : to[ key ];
		// A sideways sliding tyre sweeps its patch length, not its tread width.
		const cos = Math.abs( this.forward.x * tx + this.forward.z * tz ), sin = Math.sqrt( Math.max( 0, 1 - cos * cos ) );
		const slide = lerp( 'slide' ), bermFrac = lerp( 'bermFrac' );
		const hw = ( cos * to.width + sin * to.patch + slide * 0.02 ) / 2 * ( 1 + 2 * bermFrac ), ax = tz, az = - tx;
		const e = { x, z, tx, tz, ax, az, hw, g: 1 / ( 1 + 2 * bermFrac ), along, strip, slide, bermFrac, time: this.time,
			strength: lerp( 'strength' ), ratio: lerp( 'ratio' ), wet: lerp( 'wet' ), depth: lerp( 'depth' ), rise: lerp( 'rise' ) };
		e.left = this.ground( x - ax * hw, z - az * hw );
		e.right = this.ground( x + ax * hw, z + az * hw );
		return e;
	}

	ground( x, z ) {
		this.terrain.normalAt( x, z, this.normal );
		const lift = this.terrain.roadSurfaceAt?.( x, z ) ? 0.025 : 0.012;
		return [ x, this.terrain.heightAt( x, z ) + lift, z, this.normal.x, this.normal.y, this.normal.z ];
	}

	mound( edge, c ) {
		const length = edge.hw * 1.1, groove = edge.hw * 2 * edge.g;
		this.forward.set( edge.tx, 0, edge.tz );
		const end = this.edge( edge.x + edge.tx * length, edge.z + edge.tz * length, edge.tx, edge.tz, null,
			{ ...edge, width: groove, patch: groove, ratio: - 2 }, 1, length, edge.strip + length );
		this.segment( { ...edge, along: 0, ratio: - 2 }, end, c.kind, 1 );
	}

	segment( a, b, kind, pitch ) {
		const corners = [ [ a, a.left, - 1 ], [ a, a.right, 1 ], [ b, b.left, - 1 ], [ b, b.right, 1 ] ];
		const first = this.cursor * 6, serial = this.serial, at = this.attributes;
		for ( let j = 0; j < 6; j ++ ) {
			const [ e, p, u ] = corners[ [ 0, 2, 1, 1, 2, 3 ][ j ] ], vertex = first + j;
			at.position.array.set( [ p[ 0 ], p[ 1 ], p[ 2 ] ], vertex * 3 );
			at.normal.array.set( [ p[ 3 ], p[ 4 ], p[ 5 ] ], vertex * 3 );
			at.uv.array.set( [ u, e.along ], vertex * 2 );
			at.aMark.array.set( [ e.strength, e.slide, kind, e.time ], vertex * 4 );
			at.aShape.array.set( [ e.depth, e.rise, e.g, pitch ], vertex * 4 );
			at.aSlip.array.set( [ e.ratio, e.wet, serial, e.strip ], vertex * 4 );
			at.aAcross.array.set( [ e.ax * e.hw, 0, e.az * e.hw ], vertex * 3 );
		}
		if ( HARD( kind ) ) this.skids ++;
		this.serial ++;
		this.cursor = ( this.cursor + 1 ) % this.capacity;
		this.count = Math.min( this.count + 1, this.capacity );
	}

	// One contiguous upload per emit (two when the ring wraps), never the whole buffer.
	flush( written ) {
		if ( ! written ) return;
		const n = Math.min( written, this.capacity ), start = ( this.cursor - n + this.capacity ) % this.capacity;
		const spans = start + n <= this.capacity ? [ [ start, n ] ] : [ [ start, this.capacity - start ], [ 0, start + n - this.capacity ] ];
		for ( const attribute of Object.values( this.attributes ) ) {
			for ( const [ quad, quads ] of spans ) attribute.addUpdateRange( quad * 6 * attribute.itemSize, quads * 6 * attribute.itemSize );
			attribute.needsUpdate = true;
		}
		this.material.set( 'trackSerial', this.serial );
		this.geometry.setDrawRange( 0, this.count * 6 );
	}
}
