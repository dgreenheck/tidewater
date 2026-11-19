import { Group, Mesh, BufferGeometry, BufferAttribute, Sphere, SphereGeometry, Vector3 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { G } from '../../engine/render/Frame.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { SharkBrain } from './SharkBrain.js';
import { JAW } from './SharkBite.js';
import { CARRIER } from '../../aviation/Constants.js';

// obstacles() scratch: the ferry's five hull stations (m along its keel), its local and world points, the carrier's local point
const FERRY_STATIONS = [ - 19, - 10, 0, 10, 19 ];
const _shipLocal = new Vector3(), _shipWorld = new Vector3(), _carrierLocal = [ 0, 0, 0 ];

const baseURL = ( import.meta.env?.BASE_URL || '/' ) + 'models/shark/';
const rig = new ShaderModule( { name: 'SharkLateralSwim', code: /* wgsl */`
fn sharkJaw( p: vec3f, weight: f32, angle: f32 ) -> vec3f {
 if ( weight < -0.5 ) { return p + vec3f( 0.0, -0.004, 0.010 ) * angle / 0.65; }
 if ( weight < 0.5 ) { return p; }
 let pivot = vec3f( 0.0, -0.063, 0.302 ); let d = p - pivot;
 return pivot + vec3f( d.x, cos( angle ) * d.y - sin( angle ) * d.z, sin( angle ) * d.y + cos( angle ) * d.z );
}
fn sharkJawNormal( n: vec3f, weight: f32, angle: f32 ) -> vec3f {
 if ( weight < 0.5 ) { return n; }
 return vec3f( n.x, cos( angle ) * n.y - sin( angle ) * n.z, sin( angle ) * n.y + cos( angle ) * n.z );
}
// Posterior travelling wave: x is lateral, y is dorsal. The caudal fin stays vertical.
fn sharkBend( p: vec3f, phase: f32, turn: f32 ) -> vec3f {
	let u = clamp( ( 0.24 - p.z ) / 1.2, 0.0, 1.0 );
	let lateral = 0.095 * u * u * sin( phase - u * 5.0 ) + 0.045 * turn * u * u;
	return p + vec3f( lateral, 0.0, 0.0 );
}
fn sharkNormal( p: vec3f, n: vec3f, phase: f32, turn: f32 ) -> vec3f {
	let u = clamp( ( 0.24 - p.z ) / 1.2, 0.0, 1.0 );
	let slope = -( 0.095 * ( 2.0 * u * sin( phase - u * 5.0 ) - 5.0 * u * u * cos( phase - u * 5.0 ) ) + 0.09 * turn * u ) / 1.2;
	return normalize( vec3f( n.xy, n.z - slope * n.x ) );
}
` } );

export class Sharks {
	constructor( { scene, terrain, reef = null, query = null, vessels = null, count = 3, seed = 7319, url = baseURL } ) {
		this.scene = scene; this.terrain = terrain; this.reef = reef; this.query = query; this.app = vessels;
		this.url = url; this.ready = false; this.enabled = true; this.observing = false; this.bodies = [];
		this.group = new Group(); this.group.name = 'Blacktip reef sharks';
		this.slot = query ? query.allocate( 'sharks', count ) : - 1;
		this.waterEpoch = - Infinity;
		this.brain = new SharkBrain( { count, seed,
			terrain: { heightAt: ( x, z ) => Math.max( terrain?.heightAt( x, z ) ?? - 30, reef?.floorHeightAt( x, z ) ?? - Infinity ) },
			waterAt: ( x, z, time, id ) => this.waterAt( x, z, id ),
		} );
	}

	waterAt( x, z, id ) {
		const m = this.brain?.members[ id ];
		const field = this.app?.disasters?.field;
		const s = field?.sample( x, m?.y ?? - 2, z ) || {};
		let height = ( G.seaLevel.value || 0 ) + ( s.height || 0 );
		const q = this.query, slot = this.slot + id;
		if ( q?.cpuValid && q.resultTime > this.waterEpoch ) {
			// Query results already contain FFT + shore + wake + disaster height. Never add
			// the disaster anomaly again. A newly allocated/stale distant slot uses CPU water.
			const px = q.resultInputs[ slot * 4 ], pz = q.resultInputs[ slot * 4 + 1 ];
			if ( Math.hypot( px - x, pz - z ) < 4 ) height = q.get( slot ).height;
		}
		return { height, ux: s.ux || 0, uz: s.uz || 0,
			disturbance: Math.max( s.shake || 0, Math.hypot( s.ax || 0, s.ay || 0, s.az || 0 ) ) };
	}

	async load() {
		if ( this.loading ) return this.loading;
		this.loading = ( async () => {
			const fetchOK = async name => { const r = await fetch( this.url + name ); if ( ! r.ok ) throw new Error( `Shark asset ${ name }: ${ r.status }` ); return r; };
			const [ manifest, bin ] = await Promise.all( [ fetchOK( 'blacktip.json' ).then( r => r.json() ), fetchOK( 'blacktip.bin' ).then( r => r.arrayBuffer() ) ] );
			if ( ! manifest.jaw || manifest.jaw.maxAngle !== JAW.maxAngle ) throw new Error( 'Shark asset is missing its articulated jaw rig.' );
			this.manifest = manifest;
			this.geometries = manifest.levels.map( lv => {
				const geo = new BufferGeometry(); geo.name = 'Blacktip ' + lv.name;
				for ( const [ key, size ] of [ [ 'position', 3 ], [ 'normal', 3 ], [ 'color', 4 ], [ 'uv', 2 ] ] ) geo.setAttribute( key, new BufferAttribute( new Float32Array( bin, lv[ key ], lv.vertices * size ), size ) );
				geo.setIndex( new BufferAttribute( new Uint32Array( bin, lv.index, lv.indices ), 1 ) );
				geo.boundingSphere = new Sphere( new Vector3( 0, 0, - 0.2 ), 1.15 );
				return geo;
			} );
			for ( const m of this.brain.members ) {
				const material = new Material( { name: 'Blacktip skin', vertexColors: true, roughness: 0.48,
					underwaterLighting: 'full', modules: [ rig ],
					varyings: { sharkRest: 'vec3f' },
					uniforms: { sharkJawAngle: [ 'f32', 0 ], sharkPreviousJawAngle: [ 'f32', 0 ], skinTint: [ 'vec3f', new Vector3( 1 + m.id * 0.012, 1 - m.id * 0.008, 0.98 + m.id * 0.01 ) ], sharkPhase: [ 'f32', m.phase ], sharkPreviousPhase: [ 'f32', m.phase ], sharkTurn: [ 'f32', 0 ], sharkPreviousTurn: [ 'f32', 0 ] },
					vertex: /* wgsl */`
	o.sharkRest = v.position;
	let jaw = sharkJaw( v.position, v.uv.y, mat.sharkJawAngle );
	let previousJaw = sharkJaw( v.position, v.uv.y, mat.sharkPreviousJawAngle );
	let position = sharkBend( jaw, mat.sharkPhase, mat.sharkTurn );
	let previous = sharkBend( previousJaw, mat.sharkPreviousPhase, mat.sharkPreviousTurn );
	let normal = sharkNormal( jaw, sharkJawNormal( v.normal, v.uv.y, mat.sharkJawAngle ), mat.sharkPhase, mat.sharkTurn );
	v.useWorld = true;
	v.worldPos = ( v.model * vec4f( position, 1.0 ) ).xyz;
	v.worldNormal = normalize( ( v.model * vec4f( normal, 0.0 ) ).xyz );
	v.prevWorldPos = ( v.prevModel * vec4f( previous, 1.0 ) ).xyz;
`,
					surface: /* wgsl */`
	// Body-space variation travels with the fish. Sub-millimetre aggregate skin
	// grain fades below pixel size, avoiding noisy distant scales or shimmer.
	let p = in.vs.sharkRest;
	let cloud = 0.5 + 0.5 * sin( p.z * 27.0 + sin( p.y * 41.0 ) ) * sin( p.x * 69.0 + p.y * 31.0 );
	let footprint = max( length( dpdx( p ) ), length( dpdy( p ) ) );
	let grainWeight = 1.0 - smoothstep( 0.00035, 0.002, footprint );
	let denticles = sin( p.z * 4200.0 + sin( p.x * 1000.0 ) ) * sin( p.y * 3500.0 + p.x * 5700.0 );
	let skin = smoothstep( 0.28, 0.40, in.uv.x );
	s.albedo *= mix( vec3f( 1.0 ), mat.skinTint * ( 0.98 + 0.04 * cloud ), skin );
	s.roughness = clamp( in.uv.x + skin * ( 0.03 * ( cloud - 0.5 ) + 0.055 * denticles * grainWeight ), 0.10, 0.68 );
	s.specularIntensity = mix( 0.65, 0.40, skin );
	s.clearcoat = 0.20 * ( 1.0 - skin ); s.clearcoatRoughness = 0.10;
`,
				} );
				const mesh = new Mesh( this.geometries[ 0 ], material );
				mesh.name = `Blacktip reef shark ${ m.id + 1 }`; mesh.layers.set( LAYERS.OPAQUE ); mesh.castShadow = true;
				mesh.scale.setScalar( m.length / 1.5 ); this.group.add( mesh );
				this.bodies.push( { mesh, material, lod: 0, phase: m.phase, turn: 0, jaw: 0 } );
			}
			this.targetMesh = new Mesh( new SphereGeometry( 1, 24, 16 ), new Material( {
                name: 'Harmless weighted rubber practice target', color: 0xf5b844, roughness: 0.62, underwaterLighting: 'full',
                surface: 's.albedo = mix( vec3f( 0.95, 0.54, 0.05 ), vec3f( 0.12, 0.16, 0.20 ), step( 0.77, fract( in.uv.y * 6.0 ) ) );',
            } ) );
            this.targetMesh.name = 'Shark practice target'; this.targetMesh.layers.set( LAYERS.OPAQUE ); this.targetMesh.visible = false;
            this.scene.add( this.targetMesh );
            this.scene.add( this.group ); this.ready = true; this.update( 0, null );
		} )();
		return this.loading;
	}

	// Everything a shark steers round this frame. The list and its records are reused every frame (SharkBrain only
	// reads them inside update): a fresh list, an object per obstacle and a Vector3 per ferry station left 3.9-9.1 KB
	// of heap a frame (test/frame-garbage.mjs). The carrier's world() / velocityAt() still allocate their own arrays.
	obstacles() {
		const list = this._obstacles ??= [], pool = this._obstaclePool ??= [];
		let n = 0;
		const put = ( x, z, radius, bottom, top, vx, vz ) => {
			const o = pool[ n ] ??= { x: 0, z: 0, radius: 0, bottom: 0, top: 0, vx: 0, vz: 0 };
			o.x = x; o.z = z; o.radius = radius; o.bottom = bottom; o.top = top; o.vx = vx; o.vz = vz;
			list[ n ++ ] = o;
		};
		const app = this.app;
		if ( app ) {
			const add = ( body, radius, bottom, top = 1 ) => {
				if ( ! body?.position ) return;
				put( body.position.x, body.position.z, radius, bottom, top, body.velocity?.x || 0, body.velocity?.z || 0 );
			};
			add( app.boatCtl, 2.8, - 1.1 );
			add( app.jetskis?.riding ? app.jetskis.ctl : null, 1.8, - 0.7 );
			// A short chain follows a long vessel's actual footprint instead of a huge circle.
			const ship = app.ferry?.ship;
			if ( ship ) for ( const z of FERRY_STATIONS ) {
				const p = ship.toWorld( _shipLocal.set( 0, 0, z ), _shipWorld );
				put( p.x, p.z, 10, - 3, 2, ship.velocity?.x || 0, ship.velocity?.z || 0 );
			}
			const carrier = app.aviation?.carrier || app.carrier;
			if ( carrier?.world && carrier?.velocityAt ) {
				// CarrierPhysics uses numeric arrays and a full rigid-body pose. Protect the
				// 320 m hull with overlapping sections; rotational point velocity matters.
				const end = CARRIER.length / 2 - CARRIER.hullBeam / 2;
				for ( let i = 0; i < 9; i ++ ) {
					_carrierLocal[ 0 ] = 0; _carrierLocal[ 1 ] = - CARRIER.draft / 2; _carrierLocal[ 2 ] = - end + 2 * end * i / 8;
					const p = carrier.world( _carrierLocal );
					const v = carrier.velocityAt( p );
					put( p[ 0 ], p[ 2 ], CARRIER.hullBeam / 2 + 2, p[ 1 ] - CARRIER.draft / 2 - 1, p[ 1 ] + CARRIER.draft / 2 + 1, v[ 0 ], v[ 2 ] );
				}
			}
			const p = app.player;
			if ( p?.mode === 'swim' ) add( p, 1.1, p.position.y - 1, p.position.y + 1 );
		}
		list.length = n;
		return list;
	}

	update( dt, camera ) {
		if ( ! this.ready ) return;
		this.group.visible = this.enabled; if ( ! this.enabled ) return;
		const start = performance.now();
		for ( const m of this.brain.members ) this.query?.setPoint( this.slot + m.id, m.x, m.z );
		this.brain.update( dt, { obstacles: this.obstacles(), paused: !! this.app?.disasters?.paused } );
		for ( const m of this.brain.members ) {
			const b = this.bodies[ m.id ];
			const distance = camera ? Math.hypot( camera.position.x - m.x, camera.position.y - m.y, camera.position.z - m.z ) : 0;
			b.lod = distance < 16 ? 0 : distance < 50 ? 1 : distance < 220 ? 2 : - 1;
			b.mesh.visible = b.lod >= 0;
			if ( b.lod >= 0 ) b.mesh.geometry = this.geometries[ b.lod ];
			b.mesh.position.set( m.x, m.y, m.z );
			b.mesh.rotation.set( - m.pitch, m.yaw, m.bank, 'YXZ' );
			b.material.set( 'sharkPreviousPhase', b.phase ); b.material.set( 'sharkPreviousTurn', b.turn );
			b.material.set( 'sharkPhase', m.phase ); b.material.set( 'sharkTurn', m.yawRate );
			b.material.set( 'sharkPreviousJawAngle', b.jaw ); b.material.set( 'sharkJawAngle', m.jawAngle );
			b.phase = m.phase; b.turn = m.yawRate; b.jaw = m.jawAngle;
		}
		const bite = this.brain.bite, target = bite.target;
        this.targetMesh.visible = this.enabled && target.visible;
        this.targetMesh.position.set( target.position.x, target.position.y, target.position.z );
        this.targetMesh.scale.set( target.radius * ( 1 + target.compression * 0.5 ), target.radius * ( 1 - target.compression ), target.radius * ( 1 + target.compression * 0.5 ) );
        if ( bite.contactCount > ( this.shownContacts || 0 ) ) {
            const j = bite.lastContact.impulse;
            this.notice( `Bite contact · target recoils (${ Math.hypot( j.x, j.y, j.z ).toFixed( 2 ) } N·s).` );
        }
        this.shownContacts = bite.contactCount;
        if ( [ 'miss', 'cancelled' ].includes( bite.result ) && this.shownResultCycle !== bite.cycle ) {
            this.notice( bite.result === 'miss' ? 'Bite missed · target stayed clear of the teeth.' : 'Bite demonstration stopped · strong water disturbance.' );
            this.shownResultCycle = bite.cycle;
        }
        const input = this.app?.input;
        if ( ! this.app?.freeCam || input?.locked || input?.mouseDown || [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space' ].some( k => input?.down( k ) ) ) this.biteFollow = false;
        if ( this.biteFollow ) this.biteCamera();
        if ( this.observing && ! this.app?.freeCam ) this.observing = false;
		this.cpuMs = performance.now() - start;
	}

	// Player action, deliberately separate from reset/spawn. It does not move the animals.
	watch( { silent = false } = {} ) {
		const app = this.app;
		if ( ! this.ready || ! app ) return false;
		if ( app.chairlift?.active || app.rally?.active || app.jetskis?.riding || app.player?.mode === 'boat' || app.player?.mode === 'ferry-helm' || app.aviation?.active || app.glider?.active ) {
			this.notice( 'Leave the vehicle controls before watching sharks.' ); return false;
		}
		const m = this.brain.members[ 0 ], side = new Vector3( Math.cos( m.yaw ), 0, - Math.sin( m.yaw ) );
		const eye = new Vector3( m.x + side.x * 2.5 + Math.sin( m.yaw ) * 0.8, m.y + 0.12, m.z + side.z * 2.5 + Math.cos( m.yaw ) * 0.8 );
		eye.y = Math.max( eye.y, this.brain.floorAt( eye.x, eye.z ) + 0.6 );
		app.setFreeCam( true );
		app.fly.setPose( eye, Math.atan2( eye.x - m.x, eye.z - m.z ), - Math.atan2( eye.y - m.y, Math.hypot( eye.x - m.x, eye.z - m.z ) ) );
		app.fly.velocity.set( 0, 0, 0 ); app.cameraCut();
		this.biteFollow = false; this.observing = true; this.watchCount = ( this.watchCount || 0 ) + 1;
		if ( ! silent ) this.notice( 'Blacktip reef sharks · 1.3–1.5 m · F to dive, WASD to explore.' );
		return true;
	}

    notice( message ) {
        // UI.toast already refreshes a repeated message. Dismissing it first would
        // briefly duplicate its fading DOM and stack two identical notices.
        if ( this.noticeMessage !== message ) this.dismissNotice?.();
        this.noticeMessage = message;
        this.dismissNotice = this.app?.ui?.ui?.toast( message );
    }

    demonstrateBite() {
        if ( ! this.watch( { silent: true } ) ) return false;
        if ( ! this.brain.beginBite() ) { this.notice( 'Wait for the current bite to finish and for calm water.' ); return false; }
        this.shownResultCycle = -1; this.biteFollow = true; this.biteCamera(); this.app.cameraCut();
        this.notice( 'Shark bite demo · harmless floating target · move or drag to leave the close-up.' );
        return true;
    }

    biteCamera() {
        const app = this.app, m = this.brain.members[ 0 ];
        const side = new Vector3( Math.cos( m.yaw ), 0, - Math.sin( m.yaw ) );
        const eye = new Vector3( m.x + side.x * 1.65 + Math.sin( m.yaw ) * 0.8, m.y - 0.10, m.z + side.z * 1.65 + Math.cos( m.yaw ) * 0.8 );
        eye.y = Math.max( eye.y, this.brain.floorAt( eye.x, eye.z ) + 0.4 );
        const aim = new Vector3( m.x + Math.sin( m.yaw ) * 0.20, m.y - 0.045, m.z + Math.cos( m.yaw ) * 0.20 );
        app.fly.setPose( eye, Math.atan2( eye.x - aim.x, eye.z - aim.z ), - Math.atan2( eye.y - aim.y, Math.hypot( eye.x - aim.x, eye.z - aim.z ) ) );
        app.fly.velocity.set( 0, 0, 0 );
    }

	reset() {
		this.waterEpoch = G.time.value; this.biteFollow = false; this.shownContacts = 0;
		this.brain.reset(); this.observing = false; this.update( 0, this.app?.camera );
		return this.state();
	}
	resetDisasterEffects() { return this.reset(); }
	state() {
		const s = this.brain.state();
		return { ...s, ready: this.ready, jawRigReady: !! this.manifest?.jaw, species: 'Carcharhinus melanopterus', observing: this.observing,
			watchCount: this.watchCount || 0, cpuMs: this.cpuMs || 0,
			members: s.members.map( m => ( { ...m, renderJawAngle: this.bodies[ m.id ]?.material.uniforms.sharkJawAngle.value ?? 0, visible: ( this.bodies[ m.id ]?.lod ?? - 1 ) >= 0, lod: this.bodies[ m.id ]?.lod ?? - 1 } ) ),
			triangles: this.manifest?.levels.map( lv => lv.indices / 3 ) || [] };
	}
}
