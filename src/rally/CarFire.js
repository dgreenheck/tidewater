import { Mesh, PlaneGeometry, InstancedBufferAttribute, Vector3, Color } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { G } from '../engine/render/Frame.js';
import { mulberry32 } from '../util/Noise.js';

// Steam, smoke, dust, flames, sparks and glass glints for a damaged car: camera-facing
// soft quads in two instanced draws. Smoke, steam and dust are lit and alpha blended so
// they darken at dusk; flames, sparks and shards are additive HDR so they bloom. The
// particles live on the CPU (a few hundred at most) and drift with the frame wind.

export const FX = { STEAM: 0, SMOKE: 1, DUST: 2, FLAME: 3, SPARK: 4, SHARD: 5, EMBER: 6, TYRE: 7 };
const SOFT = 320, GLOW = 320;
// kind: [ life s, start size, end size, rise m/s, drag, gravity, wind share ]
const KINDS = [
	[ 1.3, 0.12, 0.9, 0.8, 1.8, 0, 0.9 ],
	[ 4.2, 0.3, 2.1, 1.7, 0.9, 0, 1 ],
	[ 1.4, 0.25, 1.4, 0.3, 2.5, 0, 0.6 ],
	[ 0.7, 0.34, 0.16, 2.2, 1.4, 0, 0.45 ],
	[ 0.8, 0.035, 0.02, 0, 0.4, 1, 0 ],
	[ 1.1, 0.03, 0.025, 0, 0.3, 1, 0 ],
	[ 2.4, 0.03, 0.015, 1.2, 0.7, 0, 1 ],
	[ 1.9, 0.16, 1.25, 0.7, 1.4, 0, 0.9 ],
];
const _c = new Color();

function material( name, glow ) {
	return new Material( {
		name, lit: ! glow, transparent: true, depthWrite: false, side: 'double',
		blending: glow ? 'additive' : 'normal',
		attributes: { aP: 'vec4f', aC: 'vec4f', aS: 'vec2f' },
		varyings: { vCol: 'vec4f', vUV: 'vec2f', vSeed: 'f32' },
		vertex: /* wgsl */`
	let fxP = v.aP.xyz;
	let fxV = normalize( fxP - frame.cameraPos );
	let fxRight = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), fxV ) + vec3f( 1e-5, 0.0, 0.0 ) );
	let fxUp = cross( fxV, fxRight );
	let fxA = v.aS.y;
	let fxC = v.position.xy;
	let fxR = vec2f( fxC.x * cos( fxA ) - fxC.y * sin( fxA ), fxC.x * sin( fxA ) + fxC.y * cos( fxA ) );
	v.useWorld = true;
	let fxTall = select( 1.0, 1.8, v.aS.x > 9.5 );
	v.worldPos = fxP + ( fxRight * fxR.x + fxUp * fxR.y * fxTall ) * v.aP.w;
	v.worldNormal = -fxV;
	v.prevWorldPos = v.worldPos;
	o.vCol = v.aC;
	o.vUV = fxC;
	o.vSeed = v.aS.x;
`,
		surface: glow ? /* wgsl */`
	let fxQ = in.vs.vUV;
	let fxTip = select( 1.0, 1.0 / max( 0.3, 0.85 - 0.55 * fxQ.y ), in.vs.vSeed > 9.5 );
	let fxR2 = fxQ.x * fxQ.x * fxTip * fxTip + fxQ.y * fxQ.y;
	if ( fxR2 > 1.0 ) { discard; }
	let fxG = exp( -fxR2 * 3.0 ) * ( 1.0 - fxR2 );
	s.albedo = in.vs.vCol.rgb * fxG;
	s.emissive = vec3f( 0.0 );
	s.alpha = in.vs.vCol.w * fxG;
` : /* wgsl */`
	let fxQ = in.vs.vUV;
	let fxR2 = dot( fxQ, fxQ );
	if ( fxR2 > 1.0 ) { discard; }
	let fxN = 0.78 + 0.22 * sin( fxQ.x * 6.1 + in.vs.vSeed * 11.0 ) * sin( fxQ.y * 5.3 + in.vs.vSeed * 7.0 );
	let fxT = 1.0 - fxR2;
	s.albedo = in.vs.vCol.rgb;
	s.alpha = in.vs.vCol.w * fxT * fxT * fxN;
	s.normal = normalize( in.V * 0.6 + vec3f( fxQ.x * 0.5, 1.0, 0.0 ) );
	s.roughness = 1.0;
	s.metalness = 0.0;
	s.specularIntensity = 0.0;
	s.emissive = vec3f( 0.0 );
`,
	} );
}

class Pool {
	constructor( name, capacity, glow ) {
		this.capacity = capacity;
		this.list = [];
		this.free = Array.from( { length: capacity }, () => ( {} ) );
		const geometry = this.geometry = new PlaneGeometry( 2, 2 );
		this.aP = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
		this.aC = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
		this.aS = new InstancedBufferAttribute( new Float32Array( capacity * 2 ), 2 );
		geometry.setAttribute( 'aP', this.aP ); geometry.setAttribute( 'aC', this.aC ); geometry.setAttribute( 'aS', this.aS );
		geometry.instanceCount = 1;
		const mesh = this.mesh = new Mesh( geometry, material( name, glow ) );
		mesh.name = name;
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.renderOrder = glow ? 23 : 22;
		mesh.layers.set( LAYERS.TRANSPARENT );
		mesh.visible = false;
	}
}

export class CarFire {
	constructor( app ) {
		this.app = app;
		this.random = mulberry32( 0x7a3c9f21 );
		this.soft = new Pool( 'CarSmoke', SOFT, false );
		this.glow = new Pool( 'CarFlames', GLOW, true );
		this.pools = [ this.soft, this.glow ];
		app.scene.add( this.soft.mesh );
		app.scene.add( this.glow.mesh );
		this.light = null;
		this.lightPos = new Vector3();
		this.flame = 0;
	}

	get count() { return this.soft.list.length + this.glow.list.length; }

	// darkness 0 white .. 1 black for smoke; heat 0..1 shifts flames from orange to white-yellow.
	emit( kind, position, velocity, count = 1, spread = 0.2, darkness = 0 ) {
		const pool = kind >= FX.FLAME && kind <= FX.EMBER ? this.glow : this.soft;
		for ( let i = 0; i < count; i ++ ) {
			const p = pool.free.pop() || pool.list.shift();
			const random = this.random;
			p.kind = kind; p.age = 0; p.dark = darkness;
			p.life = KINDS[ kind ][ 0 ] * ( 0.75 + random() * 0.5 );
			p.seed = random();
			p.spin = ( random() - 0.5 ) * ( kind === FX.FLAME ? 0.6 : 0.8 );
			p.angle = kind === FX.FLAME ? ( random() - 0.5 ) * 0.5 : random() * 6.283;
			p.x = position.x + ( random() - 0.5 ) * spread;
			p.y = position.y + ( random() - 0.5 ) * spread * 0.5;
			p.z = position.z + ( random() - 0.5 ) * spread;
			p.vx = velocity.x + ( random() - 0.5 ) * spread * 2;
			p.vy = velocity.y + random() * spread;
			p.vz = velocity.z + ( random() - 0.5 ) * spread * 2;
			pool.list.push( p );
		}
	}

	// A burning car lights its surroundings with one flickering local light.
	setFire( level, position ) {
		this.flame = level;
		const lights = this.app.localLights;
		if ( ! lights ) return;
		if ( ! this.light && level > 0 ) this.light = lights.add( { position: this.lightPos, color: new Color( 1.0, 0.42, 0.12 ), intensity: 0, range: 8, kind: 'lantern', flicker: 0.5 } );
		if ( ! this.light ) return;
		if ( position ) this.lightPos.copy( position );
		// Warm and flickering, but a glow on the sand around the car, not floodlighting.
		this.light.intensity = level > 0 ? 2 + level * 7 : 0;
	}

	clear() {
		for ( const pool of this.pools ) while ( pool.list.length ) pool.free.push( pool.list.pop() );
		this.setFire( 0 );
		this.write( this.soft ); this.write( this.glow );
	}

	update( dt ) {
		const wind = G.windDir.value, windSpeed = G.windSpeed.value * 0.6;
		const terrain = this.app.terrainData;
		for ( const pool of this.pools ) {
			const list = pool.list;
			let alive = 0;
			for ( const p of list ) {
				p.age += dt;
				if ( p.age >= p.life ) { pool.free.push( p ); continue; }
				const [ , , , rise, drag, gravity, share ] = KINDS[ p.kind ];
				const k = Math.exp( - dt * drag );
				p.vx = p.vx * k + wind.x * windSpeed * share * ( 1 - k );
				p.vz = p.vz * k + wind.y * windSpeed * share * ( 1 - k );
				p.vy = gravity ? p.vy - 9.81 * dt : p.vy * k + rise * ( 1 - k );
				p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
				p.angle += p.spin * dt;
				if ( gravity ) {
					const h = terrain.heightAt( p.x, p.z );
					if ( p.y < h ) { p.y = h; p.vy *= - 0.25; p.vx *= 0.5; p.vz *= 0.5; }
				}
				list[ alive ++ ] = p;
			}
			list.length = alive;
			this.write( pool );
		}
	}

	write( pool ) {
		const list = pool.list, P = pool.aP.array, C = pool.aC.array, S = pool.aS.array;
		for ( let i = 0; i < list.length; i ++ ) {
			const p = list[ i ], t = p.age / p.life, [ , s0, s1 ] = KINDS[ p.kind ];
			P[ i * 4 ] = p.x; P[ i * 4 + 1 ] = p.y; P[ i * 4 + 2 ] = p.z;
			P[ i * 4 + 3 ] = s0 + ( s1 - s0 ) * Math.sqrt( t );
			let a;
			switch ( p.kind ) {
				case FX.STEAM: _c.setRGB( 0.9, 0.92, 0.94 ); a = 0.28 * ( 1 - t ) * Math.min( 1, t * 6 ); break;
				case FX.SMOKE: {
					// Sooty at the source, greyer and thinner as the column rises and spreads: never one dark disc.
					const g = 0.55 - 0.5 * p.dark * ( 1 - 0.6 * t );
					_c.setRGB( g, g * 0.97, g * 0.94 ); a = ( 0.3 + 0.3 * p.dark ) * ( 1 - t ) ** 1.6 * Math.min( 1, t * 5 ); break;
				}
				case FX.TYRE: _c.setRGB( 0.67, 0.69, 0.70 ); a = 0.40 * ( 1 - t ) * Math.min( 1, t * 12 ); break;
				case FX.DUST: _c.setRGB( 0.78, 0.7, 0.55 ); a = 0.38 * ( 1 - t ) * Math.min( 1, t * 10 ); break;
				case FX.FLAME: {
					// White-yellow core cooling to orange and deep red as it rises.
					const heat = 1 - t;
					// Kept under the bloom's blow-out so the tongues stay orange, and gone before they shrink to dots.
					// Low per-tongue energy: a dozen overlap at the base, and the sum must stay orange-yellow, not white.
					_c.setRGB( 1.0, 0.34 + 0.3 * heat * heat, 0.04 + 0.05 * heat * heat ); a = Math.min( 1, t * 6 ) * ( 1 - t ) * 0.42; break;
				}
				case FX.EMBER: _c.setRGB( 4.5, 1.4, 0.25 ); a = ( 1 - t ) * ( 0.35 + 0.65 * Math.abs( Math.sin( p.age * 9 + p.seed * 20 ) ) ); break;
				case FX.SPARK: _c.setRGB( 9, 4.2, 1.2 ); a = 1 - t; break;
				default: _c.setRGB( 3, 3.4, 3.8 ); a = ( 1 - t ) * ( 0.4 + 0.6 * Math.abs( Math.sin( p.age * 30 + p.seed * 40 ) ) );
			}
			C[ i * 4 ] = _c.r; C[ i * 4 + 1 ] = _c.g; C[ i * 4 + 2 ] = _c.b; C[ i * 4 + 3 ] = a;
			S[ i * 2 ] = p.kind === FX.FLAME ? p.seed + 10 : p.seed; S[ i * 2 + 1 ] = p.angle;
		}
		pool.geometry.instanceCount = Math.max( 1, list.length );
		pool.mesh.visible = list.length > 0;
		pool.aP.needsUpdate = true; pool.aC.needsUpdate = true; pool.aS.needsUpdate = true;
	}
}
