import * as THREE from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { SPRAY } from '../../fx/Spray.js';
import { DolphinBrain } from './DolphinBrain.js';
import { loadTexture } from './WhaleTextures.js';

// Common bottlenose dolphins (Tursiops truncatus), 2.9 m, a pod of six.
//
// Geometry: generated offline by tools/wildlife/dolphin_build.py (anatomy table -> parametric
// lofts: fusiform body with melon and rostrum, falcate dorsal fin, pectoral flippers, notched
// flukes), baked to public/models/dolphin: three levels of detail, shared by every member.
// Rig: as the humpback (Whale.js): a chain of K spine frames from the rostrum to the fluke tips
// plus a joint per flipper, posed on the CPU from the member's motion (DolphinBrain) and applied in
// the vertex shader, twice (this frame and the last) for exact motion vectors. Material uniforms
// belong to a material in this engine and are uploaded once per frame, so each member has its own
// material instance (identical WGSL) holding its rig; the geometry buffers are shared.
// Skin: baked countershading (dark cape, grey flank with a pale blaze, pale belly), rake scars,
// eye, gape and blowhole relief; SceneLighting with full underwater lighting.

const K = 24; // spine frames
const LOD_DIST = [ 22, 75 ];
const MAX_DIST = 900;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _x = new THREE.Vector3( 1, 0, 0 );
const _t = new THREE.Vector3();

const f = ( x ) => {

	const t = String( + x.toFixed( 7 ) );
	return t.includes( '.' ) || t.includes( 'e' ) ? t : t + '.0';

};

export class DolphinPod {

	constructor( { scene, terrain, query = null, spray = null, vessels = null, count = 6, url = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/dolphin/' } ) {

		this.scene = scene;
		this.spray = spray;
		this.vessels = vessels; // the app: ferry.ship and boatCtl are read lazily
		this.url = url;
		this.ready = false;
		this.enabled = true;
		this.group = new THREE.Group();
		this.group.name = 'Dolphins';
		this.brain = new DolphinBrain( { terrain, query, count } );
		this.bodies = [];

	}

	async load() {

		if ( this._loading ) return this._loading;
		this._loading = ( async () => {

			const [ manifest, bin ] = await Promise.all( [
				fetch( this.url + 'bottlenose.json' ).then( ( r ) => r.json() ),
				fetch( this.url + 'bottlenose.bin' ).then( ( r ) => r.arrayBuffer() ),
			] );
			this.manifest = manifest;
			[ this.albedoTex, this.heightTex ] = await Promise.all( [
				loadTexture( this.url + manifest.textures.albedo, true ),
				loadTexture( this.url + manifest.textures.height, false ),
			] );
			this._setupRest( manifest );
			this.geometries = manifest.levels.map( ( lv ) => {

				const geo = new THREE.BufferGeometry();
				geo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( bin, lv.position, lv.vertices * 3 ), 3 ) );
				geo.setAttribute( 'normal', new THREE.BufferAttribute( new Int16Array( bin, lv.normal, lv.vertices * 3 ), 3, true ) );
				geo.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( bin, lv.uv, lv.vertices * 2 ), 2 ) );
				geo.setAttribute( 'uv1', new THREE.BufferAttribute( new Float32Array( bin, lv.uv1, lv.vertices * 2 ), 2 ) );
				geo.setAttribute( 'rig', new THREE.BufferAttribute( new Float32Array( bin, lv.rig, lv.vertices * 4 ), 4 ) );
				geo.setIndex( new THREE.BufferAttribute( new Uint32Array( bin, lv.index, lv.indices ), 1 ) );
				geo.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 2.4 );
				geo.boundingBox = new THREE.Box3( new THREE.Vector3( - 2.4, - 2.4, - 2.4 ), new THREE.Vector3( 2.4, 2.4, 2.4 ) );
				geo.name = 'Dolphin_' + lv.name;
				return geo;

			} );
			for ( const m of this.brain.members ) this.bodies.push( new DolphinBody( this, m ) );
			this.scene.add( this.group );
			this.ready = true;
			this.update( 0, null );

		} )();
		return this._loading;

	}

	_setupRest( m ) {

		const zHead = m.snoutZ + 0.05;
		const zTail = m.notchZ - 0.12; // past the fluke tips
		this.zHead = zHead;
		this.dz = ( zHead - zTail ) / ( K - 1 );
		const cz = m.centerline.z, cy = m.centerline.y; // z descending
		const ycAt = ( z ) => {

			if ( z >= cz[ 0 ] ) return cy[ 0 ];
			for ( let i = 1; i < cz.length; i ++ ) if ( z >= cz[ i ] ) return cy[ i - 1 ] + ( cy[ i ] - cy[ i - 1 ] ) * ( z - cz[ i - 1 ] ) / ( cz[ i ] - cz[ i - 1 ] );
			return cy[ cy.length - 1 ];

		};

		this.rest = [];
		for ( let k = 0; k < K; k ++ ) {

			const z = zHead - k * this.dz;
			this.rest.push( { z, y: ycAt( z ) } );

		}

		this.rootIndex = Math.round( zHead / this.dz ); // frame nearest to z = 0
		this.tailLen = - m.notchZ; // root -> notch
		this.flukeD = - m.flukeRootZ; // root -> fluke insertion
		this.brain.body = [ zHead, m.notchZ / 2, m.notchZ ]; // snout, mid-body, notch: the jetski clearance points
		this.pecRoot = [ m.pectoral.left.origin, m.pectoral.right.origin ].map( ( o ) => new THREE.Vector3( ...o ) );
		this.blowLocal = new THREE.Vector3( ...m.blowhole );

	}

	// the pod's own frame of reference for tests and tools: read-only snapshot
	state() {

		const ship = this.vessels && this.vessels.ferry && this.vessels.ferry.ship;
		return {
			ready: this.ready, mode: this.brain.mode, water: this.brain.water,
			members: this.brain.members.map( ( m ) => {

				const o = { x: m.position.x, y: m.position.y, z: m.position.z, depth: m.depth, speed: m.velocity.length(), state: m.state, berth: m.berth, boat: m.boat, ski: m.ski, visible: this.bodies[ m.i ] ? this.bodies[ m.i ].lod >= 0 : false };
				if ( ship ) {

					const l = ship.toLocal( m.position, _v );
					o.fx = l.x; o.fz = l.z; o.relSpeed = Math.hypot( m.velocity.x - ship.velocity.x, m.velocity.z - ship.velocity.z );

				}

				return o;

			} ),
			ski: this.brain.skiStats,
		};

	}

	// test and debug hook: put the pod around (x, z)
	gather( x, z ) {

		this.brain.gather( x, z );
		return this.state();

	}

	update( dt, camera ) {

		if ( ! this.ready ) return;
		this.group.visible = this.enabled;
		if ( ! this.enabled ) return;
		const app = this.vessels;
		const ferry = app && app.ferry && app.ferry.ship || null;
		const boat = app && app.boatCtl || null;
		// the player's jetski while he rides it (not capsized)
		const js = app && app.jetskis, ski = js && js.ctl && js.riding && ! js.ctl.capsized ? js.ctl : null;
		const t0 = performance.now();
		this.brain.update( dt, { ferry, boat, ski } );
		for ( const b of this.bodies ) b.update( dt, camera );
		this.cpuMs = performance.now() - t0; // brain + rig posing, for the profiler

	}

	// shared material code; each member gets its own instance (its rig uniforms)
	createMaterial( body ) {

		const m = this.manifest;
		const [ h0, h1 ] = m.textures.heightRange;
		const pl = this.pecRoot[ 0 ], pr = this.pecRoot[ 1 ];
		const mat = new Material( {
			name: 'Dolphin',
			roughness: 0.4, metalness: 0,
			underwaterLighting: 'full',
			uniforms: {
				dolphinPos: [ `vec4f[${ 2 * K }]`, body.uPos ],
				dolphinRot: [ `vec4f[${ 2 * K }]`, body.uRot ],
				dolphinFlip: [ 'vec4f[4]', body.uFlip ],
				dolphinWater: [ 'f32', 0 ],
				dolphinWet: [ 'f32', 0 ],
			},
			textures: { dolphinAlbedoTex: this.albedoTex, dolphinHeightTex: this.heightTex },
			attributes: { rig: 'vec4f' },
			modules: [ this._rigModule( pl, pr ) ],
			vertex: /* wgsl */`
	let hRel = textureSampleLevel( dolphinHeightTex, smpLinearClamp, v.uv, 0.0 );
	let p = v.position + v.normal * ( ( hRel.r * 0.99611 + hRel.g * 0.00389 ) * ${ f( h1 - h0 ) } + ${ f( h0 ) } );
	let cur = dolphinPose( p, v.normal, v.rig, 0 );
	v.useWorld = true;
	v.worldPos = cur.world;
	v.worldNormal = cur.normal;
#if !PASS_DEPTH
	v.prevWorldPos = dolphinPose( p, v.normal, v.rig, ${ K } ).world;
#endif
`,
			surface: /* wgsl */`
	let above = smoothstep( -0.1, 0.2, in.P.y - mat.dolphinWater );
	let film = above * mat.dolphinWet;
	s.specularIntensity = mix( 0.45, 1.0, above );
	let uvA = in.uv;
	let dux = dpdx( uvA ); let duy = dpdy( uvA );
	let dpx = dpdx( in.P ); let dpy = dpdy( in.P );
	let albedo = textureSample( dolphinAlbedoTex, smpAnisoClamp, uvA );
	s.albedo = albedo.rgb;
	// smooth rubbery skin, glossier with a fresh wet film out of the water
	s.roughness = mix( albedo.a, albedo.a * 0.55, film );
	let t0 = textureSample( dolphinHeightTex, smpAnisoClamp, uvA );
	let t1 = textureSample( dolphinHeightTex, smpAnisoClamp, uvA + dux );
	let t2 = textureSample( dolphinHeightTex, smpAnisoClamp, uvA + duy );
	let hh0 = ( t0.r * 0.99611 + t0.g * 0.00389 ) * ${ f( h1 - h0 ) };
	let dhx = ( ( t1.r * 0.99611 + t1.g * 0.00389 ) * ${ f( h1 - h0 ) } - hh0 ) * 1.6;
	let dhy = ( ( t2.r * 0.99611 + t2.g * 0.00389 ) * ${ f( h1 - h0 ) } - hh0 ) * 1.6;
	let N = in.N;
	let r1 = cross( dpy, N ); let r2 = cross( N, dpx );
	let det = dot( dpx, r1 );
	let grad = ( r1 * dhx + r2 * dhy ) * sign( det );
	s.normal = normalize( abs( det ) * N - grad );
`,
		} );
		return mat;

	}

	_rigModule( pl, pr ) {

		return new ShaderModule( {
			name: 'dolphinRig',
			code: /* wgsl */`
struct DolphinPosed { world: vec3f, normal: vec3f };

fn dolphinRotateQ( q: vec4f, v: vec3f ) -> vec3f { return v + cross( q.xyz, cross( q.xyz, v ) + v * q.w ) * 2.0; }

fn dolphinRotAxis( ax: vec3f, ang: f32, v: vec3f ) -> vec3f {
	let c = cos( ang ); let s = sin( ang );
	return v * c + cross( ax, v ) * s + ax * ( dot( ax, v ) * ( 1.0 - c ) );
}

fn dolphinPose( p: vec3f, n: vec3f, rig: vec4f, o: i32 ) -> DolphinPosed {
	let part = rig.y;
	let isL = part > 0.5 && part < 1.5;
	let isR = part > 1.5 && part < 2.5;
	let fo = select( 0, 2, o != 0 );
	let fl = select( mat.dolphinFlip[ fo + 1 ], mat.dolphinFlip[ fo ], isL );
	let root = select( vec3f( ${ f( pr.x ) }, ${ f( pr.y ) }, ${ f( pr.z ) } ), vec3f( ${ f( pl.x ) }, ${ f( pl.y ) }, ${ f( pl.z ) } ), isL );
	let ang = fl.w * ( rig.z * 0.35 + 0.8 ) * select( 0.0, 1.0, isL || isR );
	let pp = root + dolphinRotAxis( fl.xyz, ang, p - root );
	let fi = clamp( ( ${ f( this.zHead ) } - rig.x ) / ${ f( this.dz ) }, 0.0, ${ f( K - 1.001 ) } );
	let i0 = i32( floor( fi ) ); let t = fract( fi );
	let P0 = mat.dolphinPos[ i0 + o ]; let P1 = mat.dolphinPos[ i0 + o + 1 ];
	let Q0 = mat.dolphinRot[ i0 + o ]; let Q1 = mat.dolphinRot[ i0 + o + 1 ];
	let q = normalize( mix( Q0, Q1, t ) );
	let yc = mix( P0.w, P1.w, t );
	let off = vec3f( pp.x, pp.y - yc, pp.z - rig.x );
	var r: DolphinPosed;
	r.world = mix( P0.xyz, P1.xyz, t ) + dolphinRotateQ( q, off );
	r.normal = dolphinRotateQ( q, dolphinRotAxis( fl.xyz, ang, n ) );
	return r;
}
`,
		} );

	}

}

// One member: its rig uniforms, material instance and three LOD meshes (shared geometry).
class DolphinBody {

	constructor( pod, member ) {

		this.pod = pod;
		this.m = member;
		this.uPos = new Array( 2 * K ).fill( 0 ).map( () => new THREE.Vector4() );
		this.uRot = new Array( 2 * K ).fill( 0 ).map( () => new THREE.Vector4( 0, 0, 0, 1 ) );
		this.uFlip = [ 0, 0, 0, 0 ].map( () => new THREE.Vector4( 1, 0, 0, 0 ) );
		this.pos = []; this.rot = [];
		for ( let k = 0; k < K; k ++ ) { this.pos.push( new THREE.Vector3() ); this.rot.push( new THREE.Quaternion() ); }
		this._hasPrev = false;
		this.material = pod.createMaterial( this );
		this.uWater = this.material.uniforms.dolphinWater;
		this.uWet = this.material.uniforms.dolphinWet;
		this.meshes = pod.geometries.map( ( geo ) => {

			const mesh = new THREE.Mesh( geo, this.material );
			mesh.name = geo.name + '_' + member.i;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.layers.set( LAYERS.OPAQUE );
			mesh.visible = false;
			mesh.matrixAutoUpdate = false;
			mesh.frustumCulled = false; // shared geometry: bounds cannot follow each member (culled by hand below)
			pod.group.add( mesh );
			return mesh;

		} );
		this.lod = - 1;
		this._splashes = member.splashes;
		this._dropAcc = 0;

	}

	_pose() {

		const b = this.m, pod = this.pod, rest = pod.rest, ri = pod.rootIndex;
		const P = this.uPos, R = this.uRot;
		for ( let k = 0; k < K; k ++ ) { P[ K + k ].copy( P[ k ] ); R[ K + k ].copy( R[ k ] ); }
		const Qr = b.quaternion, rots = this.rot;
		const L = pod.tailLen, fd = pod.flukeD;
		for ( let k = 0; k < K; k ++ ) {

			const z = rest[ k ].z;
			const q = rots[ k ];
			if ( z >= 0 ) {

				// head and chest: stiff, a little recoil against the stroke
				const recoil = - b.strokeAmp * 0.12 * Math.sin( b.strokePhase + 0.6 ) * Math.min( 1, z / 0.8 );
				q.copy( Qr ).multiply( _q.setFromAxisAngle( _x, recoil + b.headPitch * Math.min( 1, z / 0.6 ) ) );

			} else {

				const d = - z;
				b.pathRotation( d, _q2 );
				q.copy( Qr ).slerp( _q2, b.follow );
				// dorso-ventral stroke: a travelling wave growing toward the flukes (posterior third)
				const u = Math.min( d / L, 1.1 );
				const env = u * u * 1.15 + 0.04 * u;
				const ph = b.strokePhase - d * 2.6;
				let beta = b.strokeAmp * env * ( Math.sin( ph ) + 0.18 * Math.sin( 2 * ph ) );
				// the flukes lead the tail stock (angle of attack)
				if ( d > fd ) beta += b.strokeAmp * 1.7 * Math.sin( ph + 1.35 ) * Math.min( 1, ( d - fd ) / 0.2 );
				beta += b.arch * 3.0 * Math.min( d / 1.2, 1 );
				q.multiply( _q.setFromAxisAngle( _x, beta ) );

			}

		}

		const pos = this.pos;
		pos[ ri ].copy( b.position ).add( _v.set( 0, rest[ ri ].y, rest[ ri ].z ).applyQuaternion( rots[ ri ] ) );
		for ( let k = ri - 1; k >= 0; k -- ) {

			_q.copy( rots[ k ] ).slerp( rots[ k + 1 ], 0.5 );
			pos[ k ].copy( pos[ k + 1 ] ).add( _v.set( 0, rest[ k ].y - rest[ k + 1 ].y, rest[ k ].z - rest[ k + 1 ].z ).applyQuaternion( _q ) );

		}

		for ( let k = ri + 1; k < K; k ++ ) {

			_q.copy( rots[ k ] ).slerp( rots[ k - 1 ], 0.5 );
			pos[ k ].copy( pos[ k - 1 ] ).add( _v.set( 0, rest[ k ].y - rest[ k - 1 ].y, rest[ k ].z - rest[ k - 1 ].z ).applyQuaternion( _q ) );

		}

		for ( let k = 0; k < K; k ++ ) {

			P[ k ].set( pos[ k ].x, pos[ k ].y, pos[ k ].z, rest[ k ].y );
			const q = rots[ k ];
			if ( k > 0 && q.x * R[ k - 1 ].x + q.y * R[ k - 1 ].y + q.z * R[ k - 1 ].z + q.w * R[ k - 1 ].w < 0 ) R[ k ].set( - q.x, - q.y, - q.z, - q.w );
			else R[ k ].set( q.x, q.y, q.z, q.w );

		}

		const F = this.uFlip;
		F[ 2 ].copy( F[ 0 ] ); F[ 3 ].copy( F[ 1 ] );
		for ( let s = 0; s < 2; s ++ ) {

			b.flipperRotation( s, _q );
			const ang = 2 * Math.acos( Math.min( 1, Math.abs( _q.w ) ) );
			const sgn = _q.w < 0 ? - 1 : 1;
			const sn = Math.sqrt( Math.max( 1e-12, 1 - _q.w * _q.w ) );
			F[ s ].set( _q.x / sn * sgn, _q.y / sn * sgn, _q.z / sn * sgn, ang );
			if ( ang < 1e-5 ) F[ s ].set( 1, 0, 0, 0 );

		}

		if ( ! this._hasPrev ) {

			for ( let k = 0; k < K; k ++ ) { P[ K + k ].copy( P[ k ] ); R[ K + k ].copy( R[ k ] ); }
			F[ 2 ].copy( F[ 0 ] ); F[ 3 ].copy( F[ 1 ] );
			this._hasPrev = true;

		}

	}

	// world position of a rest-frame point (CPU copy of the vertex shader, flippers excluded)
	toWorld( local, out ) {

		const pod = this.pod;
		const fi = THREE.MathUtils.clamp( ( pod.zHead - local.z ) / pod.dz, 0, K - 1.001 );
		const i = Math.floor( fi ), t = fi - i;
		const r0 = pod.rest[ i ], r1 = pod.rest[ i + 1 ];
		const yc = r0.y + ( r1.y - r0.y ) * t;
		_q.copy( this.rot[ i ] ).slerp( this.rot[ i + 1 ], t );
		out.set( local.x, local.y - yc, 0 ).applyQuaternion( _q );
		_t.copy( this.pos[ i ] ).lerp( this.pos[ i + 1 ], t );
		return out.add( _t );

	}

	update( dt, camera ) {

		const b = this.m;
		this._pose();
		this.uWater.value = b.water;
		this.uWet.value = Math.exp( - b.wetAge / 8 );
		let lod = 0, visible = true;
		if ( camera ) {

			const d = camera.position.distanceTo( b.position );
			const camUnder = camera.position.y < b.water;
			const cur = this._lod ?? 0;
			lod = cur;
			while ( lod < 2 && d > LOD_DIST[ lod ] * 1.08 ) lod ++;
			while ( lod > 0 && d < LOD_DIST[ lod - 1 ] * 0.92 ) lod --;
			this._lod = lod;
			if ( d > MAX_DIST ) visible = false;
			if ( camUnder && d > 70 ) visible = false; // lost in the blue
			if ( ! camUnder && b.backDepth > 3.5 && d > 60 ) visible = false;

		}

		for ( let i = 0; i < this.meshes.length; i ++ ) this.meshes[ i ].visible = visible && i === lod;
		this.lod = visible ? lod : - 1;
		if ( dt > 0 ) this._effects( dt );

	}

	// a short explosive puff from the blowhole, splashes where it leaves and re-enters the water,
	// water streaming off the flukes in the air
	_effects( dt ) {

		const b = this.m, spray = this.pod.spray;
		if ( ! spray ) return;
		if ( b.puffDue && b.state === 'breathe' ) {

			const p = this.toWorld( this.pod.blowLocal, _v2 );
			if ( p.y > b.water + 0.02 ) {

				b.puffDue = false;
				p.y += 0.05;
				const vel = new THREE.Vector3( b.velocity.x * 0.6, 3.4, b.velocity.z * 0.6 );
				spray.emit( p, vel, 16, 0.07, SPRAY.SPRAY, { spread: 1.1, jitter: 0.3, life: 0.9, sizeJitter: 0.6 } );
				spray.emit( p, vel.clone().multiplyScalar( 0.6 ), 8, 0.28, SPRAY.MIST, { spread: 0.9, jitter: 0.4, life: 1.6, sizeJitter: 0.5 } );
				spray.emit( p, vel, 18, 0.012, SPRAY.DROPLET, { spread: 1.4, jitter: 0.3, life: 1.1 } );

			}

		}

		if ( b.splashes !== this._splashes ) {

			this._splashes = b.splashes;
			const p = _v2.copy( b.position ); p.y = b.water + 0.05;
			for ( let k = 0; k < 3; k ++ ) {

				const vel = new THREE.Vector3( b.velocity.x * 0.3 + ( Math.random() - 0.5 ) * 2, 2.6 + Math.random() * 2, b.velocity.z * 0.3 + ( Math.random() - 0.5 ) * 2 );
				spray.emit( p, vel, 12, 0.14, SPRAY.SPRAY, { spread: 1.4, jitter: 0.5, life: 1.3, sizeJitter: 0.7 } );
				spray.emit( p, vel, 20, 0.016, SPRAY.DROPLET, { spread: 1.8, jitter: 0.4, life: 1.3 } );

			}

		}

		if ( b.air ) {

			this._dropAcc += dt * 40;
			const n = Math.floor( this._dropAcc );
			this._dropAcc -= n;
			if ( n > 0 ) {

				const p = this.toWorld( _v.set( 0, this.pod.rest[ K - 1 ].y, this.pod.manifest.notchZ ), _v2 );
				spray.emit( p, new THREE.Vector3( 0, - 0.5, 0 ), 3 * n, 0.012, SPRAY.DROPLET, { spread: 0.3, jitter: 0.1, life: 1.0 } );

			}

		}

	}

}
