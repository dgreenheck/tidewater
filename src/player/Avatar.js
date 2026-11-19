import * as THREE from '../engine/index.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { parseGLB } from '../engine/loaders/GLTF.js';
import { loadVest, poseVest } from '../jetski/Vest.js';

// The player's own animated character: seen over the shoulder in third person, and worn in
// first person (head and neck collapsed) so you have legs when you look down and a body shadow.
//
// Model: public/models/characters/player.glb when it exists (asset lane contract: Y up, facing
// +Z, feet on y = 0, in place; clips idle, walk, run, sprint, jump_start, jump_loop, jump_land,
// optional tread, swim, swim_under; scene extras clipSpeeds { walk, run, sprint } m/s, bones { head,
// neck, ... } and swim { pitch, speed { swim, swim_under } }),
// else the vendor avatar joe.glb, which has no walk: it stands in with its idle loop.
//
//   const avatar = new Avatar( scene );
//   avatar.update( dt, frame );    // frame: see Player.updateAvatar()
//   avatar.state();                // { visible, view, clip, speed, locomotion, headHidden, ... }
//
// Locomotion is a 1D blend space over ground speed (idle, walk, run, sprint), all loops sharing one
// normalised stride phase, played at speed / clipSpeed so the feet don't slide. Jumps and the swim
// clips crossfade over it. In the water (swim loops drawn upright): tread when still and swim (front crawl)
// when moving at the surface, blended by speed; swim_under when under. The whole body pitches about the
// neck towards horizontal as he speeds up (along the velocity under water) and hangs in the water by the
// neck: chin at the surface treading, back and head breaking the surface swimming. The engine's crossfade (SkinnedModel.play) is bypassed: the layers are
// weighted here every frame. One skinned mesh; held and hidden beyond CULL metres of the camera.

const BASE = ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/characters/';
export const AVATAR_URLS = [ BASE + 'player.glb', BASE + 'joe.glb' ];
const SPEEDS = { walk: 1.4, run: 3.8, sprint: 6.0 }; // m/s when the model carries no clipSpeeds
const CULL = 90;
const HAT_VEST = 0.028; // m the hat and its cord stand off his back (rest -z) over the ski vest's foam (poseHat; the vest's back is 1.7 cm proud of the hat's rest)
const COLLAPSE = 1e-3; // head joints scaled to a point at the neck (not 0: the normals stay valid)

const _up = new THREE.Vector3( 0, 1, 0 );
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _x = new THREE.Vector3( 1, 0, 0 );
const _qp = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _g = [ 0, 1, 2, 3, 4, 5 ].map( () => new THREE.Vector3() );
// the rod clip for each FishingRod state (third person, extras.rod)
// The hair cards (material "opacity", alpha BLEND) are drawn alpha-cut at 0.5 by the engine, which stair-steps
// their edges up close. Instead each pixel keeps or drops the hair by its coverage against an interleaved-gradient
// dither that moves every frame, and TAA averages that into a soft edge. The ramp is centred on the old 0.5 cut
// (alpha 0.27 to 0.73 goes 0 to 1), so the hair keeps its volume and its shadow.
const HAIR = { surface: /* wgsl */`
	let hairCov = clamp( ( s.alpha - 0.5 ) * 2.2 + 0.5, 0.0, 1.0 );
	let hairPx = in.pixel + f32( frame.frameIndex % 64u ) * 5.588238;
	s.alpha = select( 0.0, 1.0, hairCov > fract( 52.9829189 * fract( dot( hairPx, vec2f( 0.06711056, 0.00583715 ) ) ) ) );
` };
const ROD_CLIP = { idle: 'rod_hold', floating: 'rod_hold', windup: 'rod_windup', flick: 'rod_cast', flying: 'rod_cast', retrieving: 'rod_reel', fighting: 'rod_fight', landing: 'rod_fight' };
const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

async function fetchGLB( url ) {

	let buffer;
	if ( globalThis.__assetFile ) buffer = await globalThis.__assetFile( url );
	else {

		const res = await fetch( url );
		if ( ! res.ok ) return null;
		buffer = await res.arrayBuffer();

	}

	// a missing file can come back as the dev server's index page: check the magic
	if ( ! buffer || buffer.byteLength < 12 || new DataView( buffer ).getUint32( 0, true ) !== 0x46546C67 ) return null;
	return parseGLB( buffer );

}

export class Avatar {

	constructor( scene, { urls = AVATAR_URLS } = {} ) {

		this.group = new THREE.Group();
		this.group.name = 'PlayerAvatar';
		this.group.visible = false;
		scene.add( this.group );
		this.model = null;
		this.source = null;
		this.loco = [];          // [ { name, v, layer } ] by speed
		this.actions = new Map(); // name -> layer (jumps, swim)
		this.heading = 0;
		this._headingSet = false;
		this.phase = 0;          // stride phase 0..1 shared by the locomotion loops
		this.locoWeight = 0;
		this.actWeight = 0;
		this.act = null;
		this.air = 0;
		this.landT = 0;
		this.speed = 0;
		this.clip = null;
		this.view = 'first';
		this.visible = false;
		this.headHidden = false;
		this._step = false;
		this.bodyPitch = 0;      // radians, 0 upright; swimming pitches the body forward about the neck
		this.swimBlend = 0;      // 0 on land .. 1 in the water (placement crossfade)
		this._off = new THREE.Vector3(); // placement offset eased out after entering / leaving the water
		this._last = null;
		this._wasSwim = false;
		this.ready = this.load( urls ).catch( ( e ) => console.warn( 'Avatar: character failed to load', e ) );

	}

	async load( urls ) {

		for ( const url of urls ) {

			let gltf = null;
			try {

				gltf = await fetchGLB( url );

			} catch ( e ) {

				gltf = null;

			}

			if ( ! gltf || ! gltf.skins.length ) continue;
			this.setup( await SkinnedModel.create( gltf, { materials: ( info ) => info.name === 'opacity' ? HAIR : null } ), gltf, url );
			return;

		}

		console.warn( 'Avatar: no character model found' );

	}

	setup( model, gltf, url ) {

		const json = gltf.json || {};
		const extras = ( json.scenes && json.scenes[ json.scene || 0 ] && json.scenes[ json.scene || 0 ].extras ) || {};
		const names = model.clipNames();
		const has = ( n ) => model.clips.has( n );
		this.source = url.split( '/' ).pop();
		this.idleName = has( 'idle' ) ? 'idle' : has( 'idle_neutral_01' ) ? 'idle_neutral_01' : names.find( ( n ) => /idle/i.test( n ) ) || names[ 0 ];
		const layer = ( name, loop = true, speed = 1 ) => ( { clip: model.clips.get( name ), time: 0, weight: 0, target: 0, fade: 1e-3, loop, speed, ended: false } );
		this.idle = layer( this.idleName );
		const speeds = { ...SPEEDS, ...( extras.clipSpeeds || {} ) };
		this.loco = [ 'walk', 'run', 'sprint' ].filter( has ).map( ( n ) => ( { name: n, v: speeds[ n ], layer: layer( n, true, 0 ) } ) ).sort( ( a, b ) => a.v - b.v );
		this.locoTarget = this.loco.map( () => 0 );
		for ( const [ n, loop ] of [ [ 'jump_start', false ], [ 'jump_loop', true ], [ 'jump_land', false ], [ 'swim', true ], [ 'tread', true ], [ 'swim_under', true ] ] ) if ( has( n ) ) this.actions.set( n, layer( n, loop ) );
		// riding a jetski (src/jetski/Jetski.js rideFrame): the ski clips, blended by weight
		this.rideClips = new Map();
		for ( const n of [ 'ski_sit', 'ski_lean_l', 'ski_lean_r', 'ski_stand', 'ski_tuck' ] ) if ( has( n ) ) this.rideClips.set( n, layer( n ) );
		if ( has( 'walk' ) ) this.rideClips.set( 'walk', layer( 'walk' ) ); // walking the beached ski back off the sand (rideFrame w.walk, walkRate)
		const sx = extras.swim || {};
		this.hasSwim = has( 'tread' ) && has( 'swim' );
		this.swimPitch = THREE.MathUtils.degToRad( sx.pitch || 78 );
		this.swimSpeed = { swim: 1.5, swim_under: 1.3, ...( sx.speed || {} ) };
		this.landDur = has( 'jump_land' ) ? model.clipDuration( 'jump_land' ) : 0;
		this.idle.weight = this.idle.target = 1;
		model.layers = [ this.idle ];

		// first person: the head (and the neck skin) folded to a point at the base of the neck
		const nodes = gltf.nodes, bones = extras.bones || {};
		const find = ( key, re ) => {

			const b = bones[ key ];
			if ( typeof b === 'number' ) return b;
			let i = typeof b === 'string' ? nodes.findIndex( ( n ) => n.name === b ) : - 1;
			if ( i < 0 ) i = nodes.findIndex( ( n ) => re.test( n.name ) );
			return i;

		};

		const head = find( 'head', /(^|[\s_:.])head$/i ), neck = find( 'neck', /(^|[\s_:.])neck$/i );
		const under = ( i, root ) => {

			for ( let n = i; n >= 0; n = model.parent[ n ] ) if ( n === root ) return true;
			return false;

		};

		const joints = model.skin.joints;
		this.hideJoints = head < 0 ? [] : joints.map( ( n, j ) => ( under( n, head ) || n === neck ) ? j : - 1 ).filter( ( j ) => j >= 0 );
		this.anchorNode = neck >= 0 ? neck : head;
		// the hat on its chin cord (extras.hat, tools/characters/player.py): see poseHat
		this.hat = null;
		const hx = extras.hat;
		if ( hx && hx.back ) {

			const jn = ( n ) => joints.indexOf( nodes.findIndex( ( x ) => x.name === n ) );
			const jh = jn( hx.bone ), js = jn( hx.anchor ), jhead = joints.indexOf( head );
			if ( jh >= 0 && js >= 0 && jhead >= 0 ) {

				const V = ( a ) => new THREE.Vector3().fromArray( a ), M = () => new THREE.Matrix4(), Q = () => new THREE.Quaternion();
				const st = V( hx.stow );
				const fold = M().makeTranslation( st.x, st.y, st.z ).multiply( M().makeScale( COLLAPSE, COLLAPSE, COLLAPSE ) ).multiply( M().makeTranslation( - st.x, - st.y, - st.z ) );
				const h = this.hat = { jh, js, jhead, jc: hx.cord ? jn( hx.cord ) : - 1, back: M().fromArray( hx.back ), fold,
					pivot: V( hx.pivot ), lat: V( hx.lateral ).normalize(), nrm: V( hx.normal ).normalize(), centre: V( hx.centre ),
					off: 0, vest: 0, V: M(), lift: 0, liftV: 0, roll: 0, rollV: 0, yaw: 0, v: 0, t: 0, liftSign: 1,
					q: Q(), q2: Q(), q0: Q(), q1: Q(), S: M(), M1: M(), M2: M(), M3: M(), C: M(),
					p0: V( [ 0, 0, 0 ] ), p1: V( [ 0, 0, 0 ] ), s0: V( [ 1, 1, 1 ] ), s1: V( [ 1, 1, 1 ] ),
					c0: V( [ 0, 0, 0 ] ), c1: V( [ 0, 0, 0 ] ), pm: V( [ 0, 0, 0 ] ), pc: V( [ 0, 0, 0 ] ), pv: V( [ 0, 0, 0 ] ), v3: V( [ 0, 0, 0 ] ) };
				// lift turns the lower brim away from the back
				const cb = h.centre.clone().applyMatrix4( h.back ).sub( h.pivot );
				h.liftSign = Math.sign( new THREE.Vector3().crossVectors( h.lat, cb ).dot( h.nrm ) ) || 1;

			}

		}

		this.handNode = find( 'handR', /(^|[\s_:.])r(ight)?[\s_]?hand$/i );
		// fishing (extras.rod): the rod clips laid over the upper body by bone mask (Skinning overlays), and
		// the rod's frame in the hand (grip: dir, up, seat in the hand / index / little finger joints' frame)
		this.rodClips = new Map();
		this.grip = null;
		const rx = extras.rod;
		if ( rx && rx.mask && rx.grip ) {

			const idx = ( n ) => nodes.findIndex( ( x ) => x.name === n );
			const mask = ( ...specs ) => {

				const w = new Float32Array( nodes.length );
				for ( const sp of specs ) for ( const n in sp ) {

					const i = idx( n );
					if ( i >= 0 ) w[ i ] = sp[ n ];

				}

				return w;

			};

			const upper = mask( rx.mask.upper ), both = mask( rx.mask.upper, rx.mask.reelHand || {} );
			for ( const n of rx.clips || [] ) if ( has( n ) ) {

				const l = layer( n, ( rx.loop || [] ).includes( n ) );
				l.crank = ( rx.crank || [] ).includes( n );
				l.mask = l.crank ? both : upper;
				this.rodClips.set( n, l );

			}

			const G = rx.grip, hand = idx( G.hand ), index = idx( G.index ), pinky = idx( G.pinky );
			if ( hand >= 0 && index >= 0 && pinky >= 0 && this.rodClips.size ) this.grip = { hand, index, pinky, dir: G.dir, up: G.up, seat: G.seat, span: G.span };

		}

		for ( const m of model.meshes ) m.name = 'player:' + m.name;
		model.update( 0 );
		// the swimmer hangs from the neck: its rest height, and the eyes above it (head joint + 9 cm)
		const W = model.world;
		this.neckH = neck >= 0 ? W[ neck * 16 + 13 ] : 1.5;
		this.eyeAboveNeck = head >= 0 && neck >= 0 ? W[ head * 16 + 13 ] - W[ neck * 16 + 13 ] + 0.09 : 0.17;
		this.model = model;
		this.group.add( model.group );
		// the ski vest (src/jetski/Vest.js): worn on the ski and after a throw while he is in the water or tumbling
		this.vest = null;
		this.vestOn = false;
		loadVest( 'pfd_rider', model ).then( ( v ) => { this.vest = v; } ).catch( ( e ) => console.warn( 'Avatar: no ski vest', e ) );

	}

	// ------------------------------------------------------------------ per frame

	// f: { show, pos (feet, world), q (frame rotation), vel (frame), viewHeading (frame),
	//      grounded, vy, swim, view ('first' | 'third'), attached (camera at the eyes), pitch, cam,
//      rag (src/player/Ragdoll.js while ragdolling), headcam (the view rides in his head) }
	update( dt, f ) {

		const m = this.model;
		this.view = f.view;
		const sp = Math.hypot( f.vel.x, f.vel.z );
		this.speed = sp;
		// ragdolling (src/player/Ragdoll.js): the body poses and places the model, then the get-up clips;
		// the head folds away only when the view rides in it (the car yeet in first person)
		if ( m && f.show && f.rag && f.rag.draw( dt, this ) ) {

			this.group.visible = this.visible = true;
			this.poseHat( dt, false, f );
			poseVest( this.vest, m, this.vestOn );
			this.headHidden = !! f.headcam && this.hideJoints.length > 0;
			if ( this.headHidden ) this.collapseHead();
			return;

		}

		if ( ! m || ! f.show ) {

			this.group.visible = this.visible = false;
			this.headHidden = false;
			this._headingSet = false;
			// Hidden vehicle travel is a discontinuity in the drawn body's path.
			// Do not ease a later water entry from its old on-foot world position.
			this._last = null;
			this._off.set( 0, 0, 0 );
			if ( m ) m.hold();
			return;

		}

		if ( f.ride ) {

			this.ride( dt, f );
			return;

		}

		// heading: the way they move (third person); where they look (first person: legs under you)
		let target = this.heading;
		if ( f.view === 'first' && f.attached ) target = f.viewHeading;
		else if ( sp > 0.35 ) target = Math.atan2( f.vel.x, f.vel.z );
		else if ( this._rodReq && this._rodReq.state !== 'stowed' && ! f.swim && this.grip ) target = f.viewHeading; // facing his cast
		if ( ! this._headingSet ) {

			this.heading = f.view === 'first' || sp > 0.35 ? target : f.viewHeading;
			this._headingSet = true;

		}

		const d = Math.atan2( Math.sin( target - this.heading ), Math.cos( target - this.heading ) );
		this.heading += d * ( 1 - Math.exp( - dt * ( f.view === 'first' ? 18 : 9 ) ) );

		const g = this.group;
		const fp = f.view === 'first' && f.attached;
		const swim = !! f.swim && this.hasSwim;
		// in the water the body pitches forward about the neck: towards swimPitch with speed at the surface,
		// along the velocity under water (head first, up or down), a slight lean when drifting
		let pitchT = 0;
		if ( swim ) {

			const v3 = Math.hypot( f.vel.x, f.vel.y, f.vel.z );
			if ( f.floating ) pitchT = this.swimPitch * smooth( 0.15, 1.0, sp );
			else {

				const along = Math.acos( THREE.MathUtils.clamp( f.vel.y / Math.max( v3, 1e-3 ), - 1, 1 ) );
				pitchT = THREE.MathUtils.lerp( 0.5, THREE.MathUtils.clamp( along, 0.35, Math.PI - 0.35 ), smooth( 0.15, 0.8, v3 ) );

			}

		}

		this.bodyPitch += ( pitchT - this.bodyPitch ) * ( 1 - Math.exp( - dt * 3 ) );
		this.swimBlend += ( ( swim ? 1 : 0 ) - this.swimBlend ) * ( 1 - Math.exp( - dt * 4 ) );
		g.quaternion.copy( f.q ).multiply( _q.setFromAxisAngle( _up, this.heading ) );
		if ( swim ) {

			// hang the body from the neck: the eyes at the swimmer's eyes when treading, the back just awash
			// swimming at the surface (neck 3 cm under: the sea is opaque, so his back, head and recovering arms
			// have to break the surface to read), following the swimmer under water
			g.quaternion.multiply( _qp.setFromAxisAngle( _x, this.bodyPitch ) );
			const flat = Math.sin( this.bodyPitch );
			let ny = f.eyeY - this.eyeAboveNeck * Math.cos( this.bodyPitch );
			if ( f.floating ) ny = THREE.MathUtils.lerp( f.eyeY - this.eyeAboveNeck + 0.05, f.waterY - 0.03, Math.min( 1, flat / Math.sin( this.swimPitch ) ) );
			_p.set( f.pos.x, ny, f.pos.z );
			// third person: the body forward a little so the boom frames his back, not his heels
			if ( ! fp ) _p.add( _v.set( 0, 0, 0.35 * flat ).applyAxisAngle( _up, this.heading ) );
			g.position.copy( _p ).sub( _v.set( 0, this.neckH, 0 ).applyQuaternion( g.quaternion ) );

		} else g.position.copy( f.pos );

		// entering or leaving the water the placement jumps (feet vs. neck): ease the difference out
		if ( swim !== this._wasSwim && this._last ) this._off.copy( this._last ).sub( g.position );
		this._wasSwim = swim;
		this._off.multiplyScalar( Math.exp( - dt * 4 ) );
		if ( ! fp ) g.position.add( this._off );
		if ( fp ) {

			// the eyes sit ahead of the neck; looking down, the body steps back further so the near
			// plane never cuts the shoulders and the legs come into view (and the stroking arms, swimming)
			const back = 0.14 + 0.18 * Math.max( 0, - f.pitch ) + 0.16 * this.swimBlend;
			g.position.add( _v.set( 0, 0, - back ).applyQuaternion( _q.setFromAxisAngle( _up, this.heading ).premultiply( f.q ) ) );

		}

		( this._last || ( this._last = new THREE.Vector3() ) ).copy( g.position );

		const far = g.position.distanceToSquared( f.cam.position ) > CULL * CULL;
		g.visible = this.visible = ! far;
		if ( far ) {

			m.hold();
			return;

		}

		this.animate( dt, sp, f );
		m.update( dt );
		// the pivot above is the rest neck; put this frame's posed neck exactly there instead
		if ( swim ) {

			const W = m.world, a = this.anchorNode * 16;
			g.position.add( _v.set( - W[ a + 12 ], this.neckH - W[ a + 13 ], - W[ a + 14 ] ).applyQuaternion( g.quaternion ) );

		}

		if ( ! swim ) this.vestOn = false; // on land the vest comes off
		this.poseHat( dt, swim, f );
		poseVest( this.vest, m, this.vestOn );
		this.headHidden = fp && this.hideJoints.length > 0;
		if ( this.headHidden ) this.collapseHead();

	}

	// On a jetski: the body placed at the foot tray in the ski's frame (f.ride: pos, q, clip weights w),
	// posed with the ski clips (the idle pose until the model lane's clips land).
	ride( dt, f ) {

		const m = this.model, g = this.group, r = f.ride;
		g.position.copy( r.pos );
		g.quaternion.copy( r.q );
		this._headingSet = false;
		this._wasSwim = false;
		this._off.set( 0, 0, 0 );
		( this._last || ( this._last = new THREE.Vector3() ) ).copy( g.position );
		g.visible = this.visible = true;
		const layers = [];
		for ( const n in r.w ) {

			const l = this.rideClips && this.rideClips.get( n );
			if ( l && r.w[ n ] > 1e-3 ) { l.weight = l.target = r.w[ n ]; if ( n === 'walk' ) l.speed = r.walkRate || 1; layers.push( l ); }

		}

		if ( ! layers.length ) { this.idle.weight = this.idle.target = 1; layers.push( this.idle ); }
		m.layers = layers;
		this.clip = layers[ 0 ].clip.name;
		m.update( dt );
		this.vestOn = true;
		this.poseHat( dt, false, f );
		poseVest( this.vest, m, true );
		this.headHidden = !! r.hideHead && this.hideJoints.length > 0;
		if ( this.headHidden ) this.collapseHead();

	}

	animate( dt, sp, f ) {

		const L = this.loco, T = this.locoTarget;
		// locomotion targets (1D blend space) and the stride rate that keeps the feet planted
		let rate = 0;
		T.fill( 0 );
		if ( L.length && sp > 0.15 && ! f.swim ) {

			if ( sp <= L[ 0 ].v ) {

				T[ 0 ] = Math.min( 1, sp / L[ 0 ].v * 1.6 );
				rate = Math.max( 0.55, sp / L[ 0 ].v );

			} else {

				let i = 0;
				while ( i < L.length - 1 && sp > L[ i + 1 ].v ) i ++;
				if ( i === L.length - 1 ) {

					T[ i ] = 1;
					rate = Math.min( 1.6, sp / L[ i ].v );

				} else {

					const t = ( sp - L[ i ].v ) / ( L[ i + 1 ].v - L[ i ].v );
					T[ i ] = 1 - t;
					T[ i + 1 ] = t;
					rate = sp / ( L[ i ].v * ( 1 - t ) + L[ i + 1 ].v * t );

				}

			}

		}

		// jumps and swimming over the top
		let act = null;
		const swimT = this._swimT || ( this._swimT = { tread: 0, swim: 0, swim_under: 0 } );
		if ( f.swim && this.hasSwim ) {

			// the water loops blend by speed; each plays at the rate the swimmer moves
			act = 'water';
			const v3 = Math.hypot( f.vel.x, f.vel.y, f.vel.z );
			const under = ! f.floating && this.actions.has( 'swim_under' );
			const move = smooth( 0.15, 0.9, sp );
			swimT.tread = under ? 0 : 1 - move;
			swimT.swim = under ? 0 : move;
			swimT.swim_under = under ? 1 : 0;
			this.actions.get( 'swim' ).speed = THREE.MathUtils.clamp( sp / this.swimSpeed.swim, 0.6, 1.8 );
			if ( under ) this.actions.get( 'swim_under' ).speed = THREE.MathUtils.clamp( v3 / this.swimSpeed.swim_under, 0.45, 1.8 );

		} else if ( f.swim ) act = this.actions.has( 'swim' ) ? 'swim' : null;
		else if ( ! f.grounded ) {

			this.air += dt;
			if ( f.vy > 0.5 && this.air < 0.35 && this.actions.has( 'jump_start' ) ) act = 'jump_start';
			else if ( this.air > 0.12 && this.actions.has( 'jump_loop' ) ) act = 'jump_loop';
			else if ( this.act === 'jump_start' ) act = 'jump_start';

		} else {

			if ( this.air > 0.3 && this.landDur ) this.landT = this.landDur;
			this.air = 0;

		}

		if ( ! act && this.landT > 0 ) {

			this.landT -= dt;
			if ( sp < 2 ) act = 'jump_land';

		}

		if ( act !== this.act && act && act !== 'water' ) {

			const l = this.actions.get( act );
			l.time = 0;
			l.ended = false;

		}

		this.act = act;
		const k = 1 - Math.exp( - dt * 10 );
		const kw = 1 - Math.exp( - dt * 4 ); // into and out of the water loops, and between them
		let actSum = 0;
		for ( const [ name, l ] of this.actions ) {

			const water = name in swimT;
			const t = act === 'water' ? ( water ? swimT[ name ] : 0 ) : ( name === act ? 1 : 0 );
			l._w = ( l._w || 0 ) + ( t - ( l._w || 0 ) ) * ( water || act === 'water' ? kw : k );
			actSum += l._w;

		}

		this.actWeight = Math.min( 1, actSum );

		let sum = 0, cyc = 0;
		for ( let i = 0; i < L.length; i ++ ) {

			const l = L[ i ].layer;
			l._w = ( l._w || 0 ) + ( T[ i ] - ( l._w || 0 ) ) * k;
			sum += l._w;
			cyc += l._w / Math.max( 1e-3, l.clip.duration );

		}

		this.locoWeight = Math.min( 1, sum );
		// the shared stride phase (every loop is one stride, left foot down at 0)
		if ( sum > 1e-3 ) {

			const before = this.phase;
			this.phase = ( this.phase + dt * rate * cyc / sum ) % 1;
			if ( f.grounded && this.locoWeight > 0.5 && ( this.phase < before || ( before < 0.5 && this.phase >= 0.5 ) ) ) this._step = true;

		}

		const layers = [];
		const locoShare = 1 - this.actWeight;
		const idleW = Math.max( 0, 1 - sum ) * locoShare;
		this.idle.weight = this.idle.target = Math.max( idleW, 1e-3 );
		layers.push( this.idle );
		let best = this.idle, bestW = idleW;
		for ( const e of L ) {

			const l = e.layer, w = l._w * locoShare;
			if ( w < 1e-3 ) continue;
			l.time = this.phase * l.clip.duration;
			l.weight = l.target = w;
			layers.push( l );
			if ( w > bestW ) { best = l; bestW = w; }

		}

		for ( const l of this.actions.values() ) {

			const w = l._w;
			if ( w < 1e-3 ) continue;
			l.weight = l.target = w;
			layers.push( l );
			if ( w > bestW ) { best = l; bestW = w; }

		}

		// fishing, third person on land: the clip for the rod's state over the upper body (the legs keep
		// idling or walking); the crank clips play at the reel's crank angle
		const req = this._rodReq;
		this._rodReq = null;
		const want = req && this.rodClips.size && ! f.swim && f.view !== 'first' ? ROD_CLIP[ req.state ] || null : null;
		if ( want !== this.rodClip ) {

			const l = want && this.rodClips.get( want );
			if ( l && ! l.loop ) {

				l.time = 0;
				l.ended = false;

			}

			this.rodClip = want;

		}

		const kr = 1 - Math.exp( - dt * ( want === 'rod_cast' ? 30 : 10 ) );
		const ov = this._rodOv || ( this._rodOv = [] );
		ov.length = 0;
		for ( const [ n, l ] of this.rodClips ) {

			l._w = ( l._w || 0 ) + ( ( n === want ? 1 : 0 ) - ( l._w || 0 ) ) * kr;
			if ( l._w < 1e-3 ) {

				l._w = 0;
				continue;

			}

			if ( l.crank && req ) {

				l.speed = 0;
				l.time = ( ( req.crank / ( 2 * Math.PI ) ) % 1 + 1 ) % 1 * l.clip.duration;

			}

			ov.push( l );

		}

		// laid in order, so each takes share s: weight = s / ( 1 - the later shares )
		let later = 0;
		for ( let i = ov.length - 1; i >= 0; i -- ) {

			const l = ov[ i ];
			l.weight = l.target = Math.min( 1, l._w / Math.max( 1e-3, 1 - later ) );
			later = Math.min( 0.999, later + l._w );

		}

		for ( const l of ov ) layers.push( l );
		this.model.layers = layers;
		this.clip = best.clip.name;

	}

	// The hat on its chin cord, written into the joint matrices after the pose (like collapseHead). In the water it
	// comes off his head and hangs down his back: Spine2's joint x a sway about the brim's top edge x extras.hat.back
	// (the rest-space move from the head to the shoulder blades, crown out, brim up at the neck). The sway is a damped
	// spring on lift (away from the back only) and roll (about the back's normal), driven by turning, slowing and a
	// slow bob while he moves. Out of the water it goes back on: the crown's centre along an arc out behind the head,
	// the rotation slerped; once on, the clip's own hat pose (the get-up tilts) is left alone. The cord's neck part
	// (HatCord) rides Spine2 while the hat is down and is folded to a point inside the crown while it is on.
	poseHat( dt, water, f ) {

		const h = this.hat, m = this.model;
		if ( ! h || ! m ) return;
		const D = m.jointData, J = ( j, M ) => M.fromArray( D, j * 16 );
		h.off = THREE.MathUtils.clamp( h.off + Math.sign( ( water ? 1 : 0 ) - h.off ) * dt / ( water ? 0.35 : 0.55 ), 0, 1 );
		const w = h.off * h.off * ( 3 - 2 * h.off );
		if ( w > 0 ) {

			const dtc = THREE.MathUtils.clamp( dt, 1e-3, 0.05 );
			const yaw = this.heading || 0, dy = Math.atan2( Math.sin( yaw - h.yaw ), Math.cos( yaw - h.yaw ) ) / dtc;
			h.yaw = yaw;
			const v = f && f.vel ? Math.hypot( f.vel.x, f.vel.y || 0, f.vel.z ) : 0, acc = ( v - h.v ) / dtc;
			h.v = v;
			h.t += dtc;
			const bob = Math.min( 1, v / 1.5 );
			const liftT = THREE.MathUtils.clamp( 0.04 + 0.05 * Math.max( 0, - acc ) + 0.05 * bob * ( 0.5 + 0.5 * Math.sin( h.t * 5.2 ) ), 0, 0.3 );
			const rollT = THREE.MathUtils.clamp( - 0.15 * dy + 0.07 * bob * Math.sin( h.t * 2.6 ), - 0.3, 0.3 );
			h.liftV += ( 40 * ( liftT - h.lift ) - 8 * h.liftV ) * dtc;
			h.lift = Math.max( 0, h.lift + h.liftV * dtc );
			h.rollV += ( 30 * ( rollT - h.roll ) - 7 * h.rollV ) * dtc;
			h.roll += h.rollV * dtc;
			h.q.setFromAxisAngle( h.lat, h.liftSign * h.lift ).multiply( h.q2.setFromAxisAngle( h.nrm, h.roll ) );
			h.S.makeRotationFromQuaternion( h.q );
			h.S.setPosition( h.pv.copy( h.pivot ).sub( h.v3.copy( h.pivot ).applyMatrix4( h.S ) ) );
			// over the ski vest the hat rides out on the foam, off his back (rest -z, HAT_VEST m, eased)
			h.vest += ( ( this.vestOn ? HAT_VEST : 0 ) - h.vest ) * ( 1 - Math.exp( - dtc * 8 ) );
			h.V.makeTranslation( 0, 0, - h.vest );
			const B = J( h.js, h.M1 ).multiply( h.S ).multiply( h.V ).multiply( h.back );
			if ( w < 1 ) {

				const A = J( h.jhead, h.M2 );
				const c0 = h.c0.copy( h.centre ).applyMatrix4( A ), c1 = h.c1.copy( h.centre ).applyMatrix4( B );
				A.decompose( h.p0, h.q0, h.s0 );
				B.decompose( h.p1, h.q1, h.s1 );
				const out = h.v3.copy( h.nrm ).transformDirection( J( h.js, h.M3 ) );
				const mid = h.pm.copy( c0 ).add( c1 ).multiplyScalar( 0.5 ).addScaledVector( out, 0.22 );
				mid.y += 0.06;
				const a = 1 - w;
				const c = h.pc.copy( c0 ).multiplyScalar( a * a ).addScaledVector( mid, 2 * a * w ).addScaledVector( c1, w * w );
				h.q0.slerp( h.q1, w );
				B.makeRotationFromQuaternion( h.q0 );
				B.setPosition( c.sub( h.v3.copy( h.centre ).applyQuaternion( h.q0 ) ) );

			}

			B.toArray( D, h.jh * 16 );

		}

		if ( h.jc >= 0 ) {

			const C = h.C.copy( J( h.jh, h.M2 ) ).multiply( h.fold );
			const wc = THREE.MathUtils.clamp( ( w - 0.5 ) * 2, 0, 1 );
			if ( wc > 0 ) {

				const S2 = J( h.js, h.M3 ).multiply( h.V ).elements, e = C.elements;
				for ( let i = 0; i < 16; i ++ ) e[ i ] += ( S2[ i ] - e[ i ] ) * wc;

			}

			C.toArray( D, h.jc * 16 );

		}

		m.jointBuffer.write( D );

	}

	// Fold the head joints (and the neck skin) to a point at the base of the neck; re-upload.
	collapseHead() {

		const m = this.model, D = m.jointData, W = m.world, a = this.anchorNode * 16;
		const tx = W[ a + 12 ], ty = W[ a + 13 ], tz = W[ a + 14 ];
		for ( const j of this.hideJoints ) {

			const o = j * 16;
			for ( let c = 0; c < 12; c ++ ) D[ o + c ] *= COLLAPSE;
			D[ o + 12 ] = tx;
			D[ o + 13 ] = ty;
			D[ o + 14 ] = tz;

		}

		m.jointBuffer.write( D );

	}

	// Third person with the rod out: FishingRod.update() tells the rod's state and crank angle every frame
	// (its clip goes over the upper body next update) and gets back the rod's frame off the posed right
	// hand, world: out.pos the reel seat, out.dir along the rod, out.up its side away from the reel. Null
	// without the rod clips, hidden or in the water.
	holdRod( state, crank, out ) {

		const r = this._rodReqObj || ( this._rodReqObj = { state: '', crank: 0 } );
		r.state = state;
		r.crank = crank;
		this._rodReq = r;
		const m = this.model, G = this.grip;
		if ( ! m || ! G || ! this.visible || this.swimBlend > 0.5 ) return null;
		m.group.updateMatrixWorld();
		const W = m.world, M = m.group.matrixWorld;
		const P = ( i, v ) => v.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] ).applyMatrix4( M );
		const h = P( G.hand, _g[ 0 ] ), I = P( G.index, _g[ 1 ] ), K = P( G.pinky, _g[ 2 ] );
		const b = _g[ 3 ].subVectors( I, K ), sc = b.length() / G.span;
		const a = _g[ 4 ].addVectors( I, K ).multiplyScalar( 0.5 ).sub( h ).normalize();
		b.addScaledVector( a, - b.dot( a ) ).normalize();
		const n = _g[ 5 ].crossVectors( a, b );
		const comb = ( c, v ) => v.set( 0, 0, 0 ).addScaledVector( a, c[ 0 ] ).addScaledVector( b, c[ 1 ] ).addScaledVector( n, c[ 2 ] );
		comb( G.dir, out.dir ).normalize();
		comb( G.up, out.up ).normalize();
		comb( G.seat, out.pos ).multiplyScalar( sc ).add( h );
		return out;

	}

	// His right hand in the world (the rod's grip in third person), or null.
	handWorld( out ) {

		const m = this.model, i = this.handNode;
		if ( ! m || ! ( i >= 0 ) ) return null;
		const W = m.world;
		m.group.updateMatrixWorld();
		return out.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] ).applyMatrix4( m.group.matrixWorld );

	}

	// ------------------------------------------------------------------ for the player / tests

	// stride phase 0..1 while a locomotion loop carries the body, else null (the stand-in has none)
	stepPhase() {

		return this.model && this.visible && this.loco.length && this.locoWeight > 0.5 ? this.phase : null;

	}

	// true once per footfall of the playing loop
	takeStep() {

		const s = this._step;
		this._step = false;
		return s;

	}

	state() {

		return {
			loaded: !! this.model, source: this.source, visible: this.visible, view: this.view,
			clip: this.clip, speed: Math.round( this.speed * 100 ) / 100, locomotion: this.loco.length > 0,
			headHidden: this.headHidden, hat: this.hat ? Math.round( this.hat.off * 100 ) / 100 : null, heading: this.heading, rod: this.rodClip || null,
			bodyPitchDeg: Math.round( THREE.MathUtils.radToDeg( this.bodyPitch ) * 10 ) / 10,
			water: Object.fromEntries( [ 'tread', 'swim', 'swim_under' ].filter( ( n ) => this.actions.has( n ) ).map( ( n ) => [ n, Math.round( this.actions.get( n )._w * 100 ) / 100 || 0 ] ) ),
			clips: { idle: this.idleName || null, loco: this.loco.map( ( e ) => e.name ), actions: [ ...this.actions.keys() ] },
		};

	}

}
