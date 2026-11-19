import * as THREE from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';

// Cocky's cage on the counter of Joe's fish stall (public/models/birdcage.glb, built by
// tools/cockatoo/cage_build.py). The player puts the cockatoo in when he is being naughty and Joe
// minds him: the door, its latch, the swing and its bell are animated here, and now and then Joe
// turns to the cage to drop a pinch of seed in the cup, have a chat, or tell him to pipe down.
// Cockatoo.js owns the bird inside (mode 'caged'); this file owns the cage, its E prompt and Joe.
//
//   stand.cage = new BirdCage( { scene, stand } );  cage.update( dt, app );  cage.prompt( player, input, bird )
//   cage.toWorld( local, out ), cage.seatWorld( out ), cage.state()
//
// Cage frame (the GLB's, metres): origin at the bottom of the feet, +Z out the door (to the customers),
// the perch dowel top at y 0.264, the swing seat top 0.41 below its pivot, the seed cup on the left wall.

const URL = ( import.meta.env?.BASE_URL || '/' ) + 'models/birdcage.glb';
// on the counter at its right end (stall local), clear of the spring scale and the front post
export const CAGE_AT = { x: 0.88, z: 0.87, yaw: - 0.05 };
export const CAGE = {
	perchY: 0.264, perchZ: 0.02, perchX: [ 0.02, 0.18 ],
	pivot: [ - 0.13, 0.75, - 0.04 ], seatDrop: 0.41,
	seed: [ - 0.235, 0.2, - 0.14 ], water: [ 0.235, 0.2, - 0.14 ],
	outside: [ 0, 0.168, 0.252 ], barZ: 0.2, climbPitch: - 1.15, climbTop: 0.36, bellPerchX: 0.03,
	feet: [ [ - 0.27, - 0.22 ], [ 0.27, - 0.22 ], [ - 0.27, 0.22 ], [ 0.27, 0.22 ] ],
	half: [ 0.29, 0.24 ], wall: 0.56, arch: 0.265,
};
// where Joe's palm goes when he feeds him: just outside the left wall's bars, over the seed cup (cage frame)
const REACH = [ - 0.315, 0.265, - 0.13 ];
const DOOR_OPEN = - 1.9, LATCH_OPEN = 1.0;
const LINES = {
	feed: [ 'Here you go, Cocky. Sunflower.', 'Bit of seed for you, mate.' ],
	chat: [ 'You behaving in there?', 'Who\'s a good boy then?', 'He\'ll be back for you soon, mate.' ],
	hush: [ 'Pipe down, mate.', 'Oi. Pipe down, mate.' ],
};
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), Y = new THREE.Vector3( 0, 1, 0 );

export class BirdCage {

	constructor( { scene, stand } ) {

		this.stand = stand;
		this.fast = new URLSearchParams( globalThis.location?.search || '' ).get( 'cockatoo' ) === 'fast';
		this.group = new THREE.Group();
		this.group.name = 'BirdCage';
		scene.add( this.group );
		this.loaded = false; this.door = null; this.latch = null; this.swing = null; this.bell = null;
		this.doorT = 0; this.doorWant = 0; this.latchT = 0; this.closeIn = 0;
		this.swingA = 0; this.swingV = 0; this.swingAcc = 0; this.pump = 0; this.bellA = 0; this.bellV = 0; this.rings = 0; this._ringArmed = true;
		this.feetGap = null; this.tend = null; this.tends = []; this.nextTend = this.fast ? 5 : 25 + Math.random() * 30;
		this.joe = { id: 'joe', world: new THREE.Vector3(), posture: 'stand' };
		this.q = [ 0, 0, 0, 1 ];
		this.place();
		this.ready = Promise.all( [ stand.ready, loadModel( URL ) ] ).then( ( [ , m ] ) => {

			this.group.add( m.root );
			const P = m.pivots;
			this.door = P.get( 'door' ) || null; this.latch = P.get( 'latch' ) || null;
			this.swing = P.get( 'swing' ) || null; this.bell = P.get( 'bell' ) || null;
			this.place();
			this.loaded = true;

		} ).catch( ( e ) => { console.warn( 'BirdCage: model failed to load', e ); this.place(); this.loaded = true; } );
		this.seeds = this.makeSeeds(); this.fed = 0;

	}

	// on the counter boards: the height under each foot is read off the stall mesh itself, and the cage
	// takes the plane of its four feet, so it sits on the (slightly out of true) counter without a gap
	place() {

		const s = this.stand.group, yaw = s.rotation.y, a = CAGE_AT;
		const mesh = s.children.find( ( c ) => c.isMesh || c.geometry );
		const top = ( x, z ) => ( mesh ? surfaceY( mesh.geometry, x, z, 0.95, 1.12 ) : null ) ?? 1.045;
		const c = Math.cos( a.yaw ), n = Math.sin( a.yaw );
		const ys = CAGE.feet.map( ( [ fx, fz ] ) => top( a.x + fx * c + fz * n, a.z - fx * n + fz * c ) );
		const y0 = ( ys[ 0 ] + ys[ 1 ] + ys[ 2 ] + ys[ 3 ] ) / 4;
		const roll = Math.atan2( ( ys[ 1 ] + ys[ 3 ] - ys[ 0 ] - ys[ 2 ] ) / 2, 0.54 );
		const pitch = - Math.atan2( ( ys[ 2 ] + ys[ 3 ] - ys[ 0 ] - ys[ 1 ] ) / 2, 0.44 );
		// the feet as placed against the boards under them (+ above), mm
		this.feetGap = CAGE.feet.map( ( [ fx, fz ], i ) => + ( ( y0 + fx * Math.sin( roll ) - fz * Math.sin( pitch ) - ys[ i ] ) * 1000 ).toFixed( 1 ) );
		const g = this.group;
		_v.set( a.x, y0, a.z ).applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), yaw ).add( s.position );
		g.position.copy( _v );
		g.quaternion.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), yaw + a.yaw )
			.multiply( _q.setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), pitch ) )
			.multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), roll ) );
		this.q = [ g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w ];
		this.yaw = yaw + a.yaw;

	}

	// cage local -> world
	toWorld( l, out ) { return out.set( l[ 0 ] ?? l.x, l[ 1 ] ?? l.y, l[ 2 ] ?? l.z ).applyQuaternion( this.group.quaternion ).add( this.group.position ); }

	toLocal( w, out ) { return out.copy( w ).sub( this.group.position ).applyQuaternion( _q.copy( this.group.quaternion ).invert() ); }

	// the top of the swing seat (it moves with the swing), world
	seatWorld( out ) {

		const p = CAGE.pivot, a = this.swingA;
		return this.toWorld( [ p[ 0 ], p[ 1 ] - CAGE.seatDrop * Math.cos( a ), p[ 2 ] - CAGE.seatDrop * Math.sin( a ) ], out );

	}

	// top of the free space at x (under the dome's arch)
	ceiling( x ) { return CAGE.wall + CAGE.arch * Math.sqrt( Math.max( 0, 1 - ( x / CAGE.half[ 0 ] ) ** 2 ) ); }

	open() { this.doorWant = 1; this.closeIn = 0; }

	close( after = 0 ) { if ( after > 0 ) this.closeIn = after; else { this.doorWant = 0; this.closeIn = 0; } }

	// the bird pumping the swing or knocking the bell with his beak
	push( v ) { this.swingV += v; }

	knock( v ) { this.bellV += v; }

	// ------------------------------------------------------------------ the E prompt at the counter

	// Nearer the cage's end of the counter than Joe's spot, the cage takes E: put him in from the shoulder, or get
	// him out. Anywhere else along the counter, E is still Talk to Joe. true when it claimed the prompt.
	prompt( p, input, bird ) {

		if ( ! this.loaded || ! bird?.model || p.mode !== 'walk' ) return false;
		const g = this.group.position, pos = p.position;
		const dCage = Math.hypot( pos.x - g.x, pos.z - g.z );
		if ( dCage > 1.8 || Math.abs( pos.y - g.y ) > 2.2 ) return false;
		// along the counter (stall local x): nearer the cage's end than Joe's spot (Joe stands at x 0.2)
		const S = this.stand.group, s = S.rotation.y, lx = ( pos.x - S.position.x ) * Math.cos( s ) - ( pos.z - S.position.z ) * Math.sin( s );
		if ( lx < ( 0.2 + CAGE_AT.x ) / 2 ) return false;
		let text = null, run = null;
		if ( bird.mode === 'caged' && bird.cageBusy() === false ) { text = 'Get Cocky'; run = () => bird.fromCage(); }
		else if ( bird.mode === 'perched' && bird.flightW < 0.05 && ! bird.popT ) { text = 'Put Cocky in the cage'; run = () => bird.toCage( this ); }
		if ( ! text ) return false;
		if ( ! p.prompt ) p.prompt = { key: 'E', text };
		if ( input && input.hit( 'KeyE' ) ) run();
		return true;

	}

	// ------------------------------------------------------------------ per frame

	update( dt, app ) {

		if ( dt <= 0 ) return;
		dt = Math.min( dt, 0.1 );
		// the door: the latch lifts, then the door swings out; shutting, the door swings to and the latch drops
		if ( this.closeIn > 0 && ( this.closeIn -= dt ) <= 0 ) this.doorWant = 0;
		if ( this.doorWant > 0 ) {

			this.latchT = Math.min( 1, this.latchT + dt * 5 );
			if ( this.latchT > 0.8 ) this.doorT = Math.min( 1, this.doorT + dt * 1.6 );

		} else {

			this.doorT = Math.max( 0, this.doorT - dt * 1.9 );
			if ( this.doorT <= 0 ) this.latchT = Math.max( 0, this.latchT - dt * 6 );

		}

		const e = this.doorT * this.doorT * ( 3 - 2 * this.doorT );
		if ( this.door ) this.door.rotation.y = DOOR_OPEN * e;
		if ( this.latch ) this.latch.rotation.z = LATCH_OPEN * this.latchT * this.latchT * ( 3 - 2 * this.latchT );

		// the swing: a damped pendulum (0.41 m), pumped by the bird; the bell under it swings on its ring
		const w2 = 9.81 / CAGE.seatDrop, v0 = this.swingV;
		this.swingV += ( - w2 * Math.sin( this.swingA ) - 0.5 * this.swingV + this.pump ) * dt;
		this.swingA = THREE.MathUtils.clamp( this.swingA + this.swingV * dt, - 0.45, 0.45 );
		this.swingAcc = ( this.swingV - v0 ) / dt;
		this.bellV += ( - 380 * this.bellA - 3.5 * this.bellV - this.swingAcc * 0.8 ) * dt;
		this.bellA = THREE.MathUtils.clamp( this.bellA + this.bellV * dt, - 0.7, 0.7 );
		if ( Math.abs( this.bellV ) > 3 && this._ringArmed ) { this.rings ++; this._ringArmed = false; }
		if ( Math.abs( this.bellV ) < 1 ) this._ringArmed = true;
		if ( this.swing ) this.swing.rotation.x = this.swingA;
		if ( this.bell ) this.bell.rotation.x = this.bellA;

		this.updateSeeds( dt );
		this.updateJoe( dt, app );

	}

	// ------------------------------------------------------------------ Joe minds him

	updateJoe( dt, app ) {

		const bird = app.cockatoo, v = this.stand.vendor, p = app.player;
		this.joe.world.copy( v.position );
		const near = p && Math.hypot( p.position.x - v.position.x, p.position.z - v.position.z ) < 30;
		const T = this.tend;
		if ( T ) {

			T.t += dt;
			if ( T.kind === 'feed' && ! T.dropped && T.t > 1.3 ) { T.dropped = true; this.dropSeed(); }
			if ( ! T.said && T.t > 0.5 ) T.said = app.people ? app.people.say( this.joe, T.line, 'joe-' + T.kind ) : false;
			if ( T.kind === 'feed' ) this.updateReach( T, v );
			if ( T.t > T.T ) this.endTend();
			return;

		}

		if ( ! bird || bird.mode !== 'caged' || ! near || v.talking ) return;
		this.nextTend -= dt;
		const noisy = bird.recentSquawks( 8 ) >= 2;
		if ( this.nextTend > 0 && ! ( noisy && this.nextTend < ( this.fast ? 4 : 20 ) ) ) return;
		const kind = this.nextKind || ( noisy ? 'hush' : Math.random() < 0.55 ? 'feed' : 'chat' );
		this.nextKind = null; // (test hook: cage.nextKind = 'feed'; cage.nextTend = 0)
		const list = LINES[ kind ];
		this.tend = { kind, t: 0, T: kind === 'feed' ? 4.2 : 3.2, line: list[ Math.floor( Math.random() * list.length ) ], dropped: false, said: false };
		this.tends.push( { kind, line: this.tend.line, t: + ( app.cockatoo.time || 0 ).toFixed( 1 ) } );
		if ( this.tends.length > 10 ) this.tends.shift();
		// he turns to the cage (the seed cup), with a gesture: the talking hands, a shrug at the noise, or (feed)
		// a calm idle under the reach overlay (updateReach)
		v.lookOverride = this.toWorld( kind === 'feed' ? CAGE.seed : [ 0, 0.4, 0 ], new THREE.Vector3() );
		if ( v.clips ) { this._idle = v.clips.idle; v.clips.idle = kind === 'hush' ? 'gestic_shrug_01' : kind === 'feed' ? 'idle_neutral_01' : 'gestic_talk_relaxed_01'; }
		bird.onJoe?.( kind );

	}

	endTend() {

		const v = this.stand.vendor;
		if ( this.tend?.layer ) { this.tend.layer.target = 0; this.tend.layer.fade = 0.6; }
		v.lookOverride = null;
		if ( v.clips && this._idle ) v.clips.idle = this._idle;
		this.tend = null;
		this.nextTend = this.fast ? 6 + Math.random() * 4 : 35 + Math.random() * 45;

	}

	// ------------------------------------------------------------------ Joe's reach (feed)
	// A procedural overlay on Joe's skinned model (a masked layer, engine/render/Skinning.js): the spine
	// leans in and the left arm is solved by two-bone IK, so his palm comes down over the seed cup just
	// outside the bars. Solved once, on the pose he is in as he turns (for the yaw he turns to), then held
	// at weight 1 while the calm idle carries on underneath; it fades out before he turns back.
	updateReach( T, v ) {

		const c = v.character;
		if ( ! c ) return;
		if ( T.reach === undefined && T.t > 0.2 ) {

			T.reach = this.reachPose( v, c ) || null;
			if ( T.reach ) T.layer = { clip: T.reach.clip, time: 0, weight: 0, target: 0.999, fade: 0.75, loop: true, speed: 0, ended: false, mask: T.reach.mask };

		}

		const L = T.layer;
		if ( ! L ) return;
		// (target < 1: never the model's current clip, never an onClipEnd; a play() elsewhere zeroes every
		// target, so it is set again each frame, and put back if it had faded out and been dropped)
		L.target = T.t < T.T - 1.25 ? 0.999 : 0;
		L.fade = L.target ? 0.75 : 0.9;
		if ( L.target && ! c.layers.includes( L ) ) c.layers.push( L );
		if ( L.weight < 0.9 ) return;
		// measured: the palm (between the wrist and the middle finger's root) and the middle fingertip to the cup
		const I = T.reach.I, W = c.world, g = v.group, f = v.figure, cup = this.toWorld( CAGE.seed, _w );
		const world = ( i, j, k ) => _v.set( W[ i * 16 + 12 ] * ( 1 - k ) + W[ j * 16 + 12 ] * k, W[ i * 16 + 13 ] * ( 1 - k ) + W[ j * 16 + 13 ] * k, W[ i * 16 + 14 ] * ( 1 - k ) + W[ j * 16 + 14 ] * k )
			.multiplyScalar( c.group.scale.x ).applyAxisAngle( Y, g.rotation.y + f.rotation.y ).add( g.position );
		const palm = world( I.hand, I.fing, 0.5 ).distanceTo( cup ) * 100, tip = world( I.fing, I.tip, 1.6 ).distanceTo( cup ) * 100;
		const R = this.reach = this.reach && this.reach.n === this.fed + ( T.dropped ? 0 : 1 ) ? this.reach : { n: this.fed + ( T.dropped ? 0 : 1 ), palmCm: 99, tipCm: 99 };
		R.palmCm = Math.min( R.palmCm, + palm.toFixed( 1 ) ); R.tipCm = Math.min( R.tipCm, + tip.toFixed( 1 ) );
		R.lean = + T.reach.lean.toFixed( 2 ); R.clamped = T.reach.clamped;

	}

	reachPose( v, c ) {

		const nodes = c.gltf?.nodes, W = c.world;
		if ( ! nodes || ! W ) return null;
		const at = ( n ) => nodes.findIndex( ( x ) => x.name === 'Bip01 ' + n );
		const I = { spine: at( 'Spine' ), clav: at( 'L Clavicle' ), up: at( 'L UpperArm' ), fore: at( 'L Forearm' ), hand: at( 'L Hand' ), fing: at( 'L Finger2' ), tip: at( 'L Finger21' ), neck: at( 'Neck' ) };
		if ( Object.values( I ).some( ( i ) => i < 0 ) || c.parent[ I.up ] !== I.clav || c.parent[ I.fore ] !== I.up ) return null;
		const M = new THREE.Matrix4(), sc = new THREE.Vector3();
		const pos = ( i ) => new THREE.Vector3( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] );
		const rot = ( i ) => { const q = new THREE.Quaternion(); M.fromArray( W, i * 16 ).decompose( new THREE.Vector3(), q, sc ); return q; };
		// the palm target in model space, for the yaw Vendor.update turns him to (the cup, clamped to 1.1 rad)
		const g = v.group, cup = this.toWorld( CAGE.seed, new THREE.Vector3() );
		let want = Math.atan2( cup.x - g.position.x, cup.z - g.position.z ) - g.rotation.y;
		want = Math.max( - 1.1, Math.min( 1.1, Math.atan2( Math.sin( want ), Math.cos( want ) ) ) );
		const tgt = this.toWorld( REACH, new THREE.Vector3() ).sub( g.position ).applyAxisAngle( Y, - ( g.rotation.y + want ) ).divideScalar( c.group.scale.x || 1 );
		const sp = pos( I.spine ), U0 = pos( I.up ), F0 = pos( I.fore ), H0 = pos( I.hand ).lerp( pos( I.fing ), 0.5 );
		const a = F0.distanceTo( U0 ), b = H0.distanceTo( F0 );
		// lean: about the horizontal axis square to the target, the least that brings the palm in reach (8 to 30 deg)
		const fw = tgt.clone().sub( sp ).setY( 0 ).normalize(), axis = new THREE.Vector3( fw.z, 0, - fw.x );
		const R = new THREE.Quaternion(), lean = ( p ) => p.clone().sub( sp ).applyQuaternion( R ).add( sp );
		let th = 0.14;
		for ( ; th < 0.52; th += 0.02 ) { R.setFromAxisAngle( axis, th ); if ( tgt.distanceTo( lean( U0 ) ) < ( a + b ) * 0.95 ) break; }
		th = Math.min( th, 0.52 ); R.setFromAxisAngle( axis, th );
		const U = lean( U0 ), F = lean( F0 ), H = lean( H0 );
		// two-bone IK, the elbow out to his left side and down
		const d = Math.min( tgt.distanceTo( U ), ( a + b ) * 0.999 ), dir = tgt.clone().sub( U ).normalize(), T0 = U.clone().addScaledVector( dir, d );
		const side = U.clone().sub( lean( pos( I.neck ) ) ).setY( 0 ).normalize(), pole = side.multiplyScalar( 0.7 ).add( new THREE.Vector3( 0, - 1, 0 ) );
		const perp = pole.addScaledVector( dir, - pole.dot( dir ) ).normalize();
		const cosA = Math.max( - 1, Math.min( 1, ( a * a + d * d - b * b ) / ( 2 * a * d ) ) );
		const E = U.clone().addScaledVector( dir, a * cosA ).addScaledVector( perp, a * Math.sqrt( 1 - cosA * cosA ) );
		const q1 = new THREE.Quaternion().setFromUnitVectors( F.clone().sub( U ).normalize(), E.clone().sub( U ).normalize() );
		const H1 = H.clone().sub( F ).applyQuaternion( q1 ).add( E );
		const q2 = new THREE.Quaternion().setFromUnitVectors( H1.clone().sub( E ).normalize(), T0.clone().sub( E ).normalize() );
		const qUp = q1.clone().multiply( R ).multiply( rot( I.up ) ), qFore = q2.clone().multiply( q1 ).multiply( R ).multiply( rot( I.fore ) );
		const qClav = R.clone().multiply( rot( I.clav ) ), qSpine = R.clone().multiply( rot( I.spine ) );
		const loc = { [ I.spine ]: rot( c.parent[ I.spine ] ).invert().multiply( qSpine ), [ I.up ]: qClav.invert().multiply( qUp ), [ I.fore ]: qUp.clone().invert().multiply( qFore ) };
		const mask = new Float32Array( nodes.length ), channels = [];
		for ( const i of [ I.spine, I.up, I.fore ] ) { const q = loc[ i ]; mask[ i ] = 1; channels.push( { node: i, path: 'rotation', times: new Float32Array( [ 0 ] ), values: new Float32Array( [ q.x, q.y, q.z, q.w ] ) } ); }
		return { clip: { name: 'joe_reach', duration: 1e6, channels }, mask, I, lean: th, clamped: tgt.distanceTo( U ) > a + b };

	}

	// a pinch of sunflower seed dropped into the cup (from his fingers, just inside the bars)
	makeSeeds() {

		const geo = new THREE.BoxGeometry( 0.004, 0.0025, 0.009 ), mat = new Material( { name: 'seed', color: new THREE.Color( 0.08, 0.075, 0.07 ), roughness: 0.6, metalness: 0 } );
		const out = [];
		for ( let i = 0; i < 7; i ++ ) {

			const m = new THREE.Mesh( geo, mat );
			m.layers.set( LAYERS.OPAQUE );
			m.visible = false;
			this.group.add( m );
			out.push( { m, y: 0, vy: 0, x: 0, z: 0, live: false } );

		}

		return out;

	}

	dropSeed() {

		const c = CAGE.seed;
		this.seeds.forEach( ( s, i ) => {

			s.x = c[ 0 ] - 0.02 + ( Math.random() - 0.5 ) * 0.025; s.z = c[ 2 ] + ( Math.random() - 0.5 ) * 0.03;
			s.y = c[ 1 ] + 0.07 + i * 0.01; s.vy = 0; s.live = true; s.floor = c[ 1 ] - 0.012 + Math.random() * 0.006;
			s.m.rotation.set( Math.random() * 3, Math.random() * 3, Math.random() * 3 );
			s.m.visible = true;

		} );
		this.fed ++;

	}

	updateSeeds( dt ) {

		for ( const s of this.seeds ) {

			if ( ! s.live ) continue;
			s.vy -= 9.81 * dt; s.y += s.vy * dt;
			if ( s.y <= s.floor ) { s.y = s.floor; s.vy = 0; s.t = ( s.t || 0 ) + dt; if ( s.t > 6 ) { s.live = false; s.t = 0; s.m.visible = false; } }
			s.m.position.set( s.x, s.y, s.z );

		}

	}

	state() {

		const r = ( x ) => + x.toFixed( 3 );
		return {
			loaded: this.loaded, model: !! this.door, position: this.group.position.toArray().map( r ), yaw: r( this.yaw ), feetGapMm: this.feetGap,
			door: this.doorT <= 0 ? ( this.latchT <= 0 ? 'latched' : 'shut' ) : this.doorT >= 1 ? 'open' : this.doorWant ? 'opening' : 'closing',
			doorT: r( this.doorT ), latchT: r( this.latchT ), swing: r( this.swingA ), bell: r( this.bellA ), rings: this.rings, fed: this.fed,
			tend: this.tend ? { kind: this.tend.kind, t: r( this.tend.t ), said: this.tend.said, reachW: this.tend.layer ? r( this.tend.layer.weight ) : null } : null, tends: this.tends.slice(), reach: this.reach || null,
		};

	}

}

// the highest surface of a mesh's triangles over (x, z), within [lo, hi] (local); null if none
function surfaceY( geo, x, z, lo, hi ) {

	const P = geo.getAttribute( 'position' ).array, I = geo.index ? geo.index.array : null, n = I ? I.length : P.length / 3;
	let best = null;
	for ( let t = 0; t < n; t += 3 ) {

		const a = ( I ? I[ t ] : t ) * 3, b = ( I ? I[ t + 1 ] : t + 1 ) * 3, c = ( I ? I[ t + 2 ] : t + 2 ) * 3;
		const ay = P[ a + 1 ], by = P[ b + 1 ], cy = P[ c + 1 ];
		if ( ay < lo || by < lo || cy < lo || ay > hi || by > hi || cy > hi ) continue;
		const ax = P[ a ], az = P[ a + 2 ], bx = P[ b ], bz = P[ b + 2 ], cx = P[ c ], cz = P[ c + 2 ];
		const d = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
		if ( Math.abs( d ) < 1e-9 ) continue;
		const u = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / d, v = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / d;
		if ( u < 0 || v < 0 || u + v > 1 ) continue;
		const y = u * ay + v * by + ( 1 - u - v ) * cy;
		if ( best === null || y > best ) best = y;

	}

	return best;

}
