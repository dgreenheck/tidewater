import * as THREE from '../engine/index.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { fadeOptions, setFade, fadeCustomize, setGroupFade } from '../people/Fade.js';
import { loadVest, poseVest } from './Vest.js';
import { rootMotion } from '../ferry/Crowd.js';

// Emily, the back-seat mate (docs/jetski.md "Back-seat mate"). She hangs about at the water's edge by the
// beach hire skis. Ride up slow (under 3 km/h) within 8 m of her and G picks her up: she wades out, climbs on
// from the left side and sits on the rear saddle, her hands on your waist. G near the hire beach drops her
// off and she wades back in. A wipeout throws her too: she treads water, then swims back and climbs aboard
// when you stop within 6 m of her.
//
// Body: a crowd cast (the swimwear re-dress when it is there), loaded the way the beach crowd loads them.
// Seated pose: the rider's own ski clips (player.glb ski_sit, ski_lean_l/r, ski_tuck, ski_stand) retargeted
// by bone name onto the crowd rig (both are Bip01 rigs), weighted like the rider's so she leans with the turn,
// ducks on the rocket and rises in the air, then two-bone IK in model space puts her feet on the footwell
// deck and her palms on the rider's waist. Animated every frame (she is right in front of the camera).
// Physics: her 80 kg sits on the rear seat (JetskiController.setPassenger).

export const MATE = {
	name: 'Emily', cast: 'f03',
	mass: 80,                               // kg on the rear seat
	behind: 0.46, up: 0.05,                 // m: her seat point from the ski's Seat pivot (back, up)
	home: [ 40.5, - 40.0 ], homeYaw: 0.15,  // ankle deep at the water's edge by the beach hire skis
	// m pick-up range (she wades or swims out to the ski, so a ski stopped in knee-deep water, where the ski can float, is in
	// reach), m/s slow enough (a coasting hull takes seconds to shed the last few km/h), m swim-back range, m drop-off range
	reach: 16, calm: 5 / 3.6, back: 6, drop: 30,
	call: 40, callEvery: 7,                 // m: she waves a ski in from this far (and calls out once in earshot), s between waves
	side: 1.05,                             // m: the boarding point off the ski's left side, beside her seat
	tread: 1.3,                             // m: feet below the surface treading water, until her chest height is measured on load
	// treading water (no swim clip on the crowd rig: bone overrides in treadPose): rad/s of the sculling hands and
	// the slow leg cycle, and how far the waterline sits below her chest node (m)
	scull: 2.6, cycle: 1.7, chestDip: 0.02,
	// see-through while she hides the rider from the chase camera: her head within `clear` m of the sight line
	// to his head or chest, faded to `ghost` (the people's dither, src/people/Fade.js)
	clear: 0.3, ghost: 0.72,
	climb: 1.4, off: 1.1,                   // s
	waist: 0.155,                           // m: the rider's waist, half its width
};
const CLIP = { idle: 'idle_neutral_01', look: 'idle_look_around_01', walk: 'walk_neutral_01', wave: 'wave_01', laugh: 'gestic_laugh_low' };
const SKI = [ 'ski_sit', 'ski_lean_l', 'ski_lean_r', 'ski_tuck', 'ski_stand' ];
// family-friendly, rare: a cool-down each (s) and a quiet gap between any two of her lines
const LINES = {
	hello: [ 'G\'day! Room for one more?', 60 ], call: [ 'Over here! Give us a lift?', 14 ], aboard: [ 'Righto, let\'s go!', 60 ], bye: [ 'Cheers for the ride!', 60 ],
	woo: [ 'Woo!', 20 ], rocket: [ 'Hang on, hang on!', 40 ], laugh: [ 'Ha ha! What a landing!', 30 ],
	ferry: [ 'Mate, the ferry!', 90 ], dolphins: [ 'Look, dolphins!', 90 ], wet: [ 'I\'m right, mate!', 45 ],
};
const QUIET = 8;
const DEG = Math.PI / 180;
const sstep = THREE.MathUtils.smoothstep;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _h = new THREE.Vector3();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3(), _ax = new THREE.Vector3(), _T2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const _X = new THREE.Vector3( 1, 0, 0 ), _Y = new THREE.Vector3( 0, 1, 0 ), _Z = new THREE.Vector3( 0, 0, 1 );
const POLE = { arm: [ 1, - 0.7, - 0.2 ], leg: [ 0.75, 0.35, 0.6 ] }; // elbows out and down, knees out, up and forward (x by side)

const at = ( W, i, out ) => out.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] );

// rotate the world matrices of `nodes` by q about the point piv (model space)
function turn( W, nodes, piv, q ) {

	const { x, y, z, w } = q;
	const r00 = 1 - 2 * ( y * y + z * z ), r01 = 2 * ( x * y - z * w ), r02 = 2 * ( x * z + y * w );
	const r10 = 2 * ( x * y + z * w ), r11 = 1 - 2 * ( x * x + z * z ), r12 = 2 * ( y * z - x * w );
	const r20 = 2 * ( x * z - y * w ), r21 = 2 * ( y * z + x * w ), r22 = 1 - 2 * ( x * x + y * y );
	for ( const i of nodes ) for ( let k = 0; k < 4; k ++ ) {

		const b = i * 16 + k * 4, px = k === 3 ? piv.x : 0, py = k === 3 ? piv.y : 0, pz = k === 3 ? piv.z : 0;
		const vx = W[ b ] - px, vy = W[ b + 1 ] - py, vz = W[ b + 2 ] - pz;
		W[ b ] = r00 * vx + r01 * vy + r02 * vz + px;
		W[ b + 1 ] = r10 * vx + r11 * vy + r12 * vz + py;
		W[ b + 2 ] = r20 * vx + r21 * vy + r22 * vz + pz;

	}

}

// swing `nodes` about piv so the direction `from` points along `to` (k of the way)
function aim( W, nodes, piv, from, to, k ) {

	_ax.crossVectors( from, to );
	const s = _ax.length();
	if ( s < 1e-7 || k <= 0 ) return;
	turn( W, nodes, piv, _qa.setFromAxisAngle( _ax.multiplyScalar( 1 / s ), Math.atan2( s, from.dot( to ) ) * k ) );

}

// two-bone IK: limb L (a upper, b lower, c end) reaches T, bending toward the pole hint, k of the way
function reach( W, L, T, pole, k ) {

	const A = at( W, L.a, _A ), B = at( W, L.b, _B ), C = at( W, L.c, _C );
	const la = B.distanceTo( A ), lb = C.distanceTo( B );
	const dv = _d.subVectors( T, A );
	let d = dv.length();
	if ( d < 1e-4 ) return;
	dv.multiplyScalar( 1 / d );
	d = Math.min( Math.max( d, Math.abs( la - lb ) + 1e-3 ), ( la + lb ) * 0.9995 );
	const x = ( la * la - lb * lb + d * d ) / ( 2 * d ), h = Math.sqrt( Math.max( la * la - x * x, 0 ) );
	const bend = _p.subVectors( B, A );
	bend.addScaledVector( dv, - bend.dot( dv ) );
	if ( bend.lengthSq() > 1e-8 ) bend.normalize();
	bend.addScaledVector( pole, 1.5 );
	bend.addScaledVector( dv, - bend.dot( dv ) );
	if ( bend.lengthSq() < 1e-8 ) return;
	bend.normalize();
	const Bn = _n.copy( A ).addScaledVector( dv, x ).addScaledVector( bend, h );
	aim( W, L.A, A, _u1.subVectors( B, A ), _u2.subVectors( Bn, A ), k );
	const B2 = at( W, L.b, _B ), C2 = at( W, L.c, _C );
	aim( W, L.B, B2, _u1.subVectors( C2, B2 ), _u2.subVectors( T, B2 ), k );

}

// the joint matrices from the (edited) world matrices, as src/people/Pose.js does
function upload( m ) {

	const J = m.joints, D = m.jointData, W = m.world, ibm = m.skin.inverseBindMatrices, jn = m.skin.joints;
	for ( let j = 0; j < J; j ++ ) {

		const a0 = jn[ j ] * 16, b0 = j * 16;
		for ( let col = 0; col < 4; col ++ ) {

			const b1 = ibm[ b0 + col * 4 ], b2 = ibm[ b0 + col * 4 + 1 ], b3 = ibm[ b0 + col * 4 + 2 ], b4 = ibm[ b0 + col * 4 + 3 ];
			for ( let r = 0; r < 4; r ++ ) D[ b0 + col * 4 + r ] = W[ a0 + r ] * b1 + W[ a0 + 4 + r ] * b2 + W[ a0 + 8 + r ] * b3 + W[ a0 + 12 + r ] * b4;

		}

	}
	m.jointBuffer.write( D );

}

// the rider's ski clips (player.glb) onto the crowd rig, by bone name: rotations, and the pelvis translation
function retarget( src, dst, pelvisT ) {

	const map = src.nodes.map( n => dst.nodes.findIndex( d => d.name === n.name ) );
	const out = new Map();
	for ( const name of SKI ) {

		const a = src.animations.find( x => x.name === name );
		if ( ! a ) continue;
		const channels = a.channels.filter( ch => map[ ch.node ] >= 0 && ( ch.path === 'rotation' || ( pelvisT && ch.path === 'translation' && src.nodes[ ch.node ].name === 'Bip01 Pelvis' ) ) )
			.map( ch => ( { ...ch, node: map[ ch.node ] } ) );
		out.set( name, { ...a, name, channels } );

	}
	return out;

}

export class Mate {

	constructor( app, jetskis ) {

		this.app = app;
		this.js = jetskis;
		this.name = MATE.name;
		this.ready = false;
		this.failed = false;
		this.enabled = true;
		this.mode = 'ashore';
		this.ski = null;
		this.t = 0;
		this.u = 0;
		this.sag = 0; this.sagV = 0; this.vyPrev = 0;
		this.airT = 0;
		this.cool = {}; this.quietUntil = 0; this.said = [];
		this.person = { id: 'emily', name: MATE.name, world: new THREE.Vector3(), head: new THREE.Vector3(), posture: 'stand' };
		this.root = new THREE.Group();
		this.root.name = 'mate:' + MATE.name;
		this.from = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
		this.seat = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
		this.goal = new THREE.Vector3();
		this.yaw = MATE.homeYaw;
		this.gap = { hands: [ null, null ], feet: [ null, null ] };
		this.slot = - 1; this.afloat = false; this.fade = 0; this.fadeOn = true; this.treadOn = true;
		this._wq = {};

	}

	async load() {

		if ( this._loading || this.failed ) return;
		const av = this.app.player?.avatar?.model;
		if ( ! av || ! av.gltf.animations.some( a => a.name === 'ski_sit' ) ) return; // her seat pose is the rider's clips
		this._loading = true;
		try {

			const base = import.meta.env.BASE_URL || '/';
			let gltf = null;
			this.swim = true;
			try { gltf = await loadGLB( `${ base }models/characters/crowd/swim/${ MATE.cast }.glb` ); } catch { gltf = null; }
			if ( ! gltf ) { this.swim = false; gltf = await loadGLB( `${ base }models/characters/crowd/${ MATE.cast }.glb` ); }
			const walk = rootMotion( gltf );
			this.walkSpeed = walk > 0.4 ? walk : 1.3; // (a second strip of a shared glTF reads 0)
			const m = this.model = await SkinnedModel.create( gltf, { materials: info => fadeOptions( info ) } );
			loadVest( 'pfd_mate', m, { customize: fadeCustomize } ).then( ( v ) => { this.vest = v; } ).catch( () => {} ); // (src/jetski/Vest.js)
			for ( const mm of m.materials ) mm.underwaterLighting = 'lite';
			const nodes = gltf.nodes, find = n => nodes.findIndex( x => x.name === n );
			const under = r => m.order.filter( i => { for ( let j = i; j >= 0; j = m.parent[ j ] ) if ( j === r ) return true; return false; } );
			const limb = ( s, a, b, c, tip ) => { const ia = find( `Bip01 ${ s } ${ a }` ), ib = find( `Bip01 ${ s } ${ b }` ), ic = find( `Bip01 ${ s } ${ c }` ); return ia < 0 || ib < 0 || ic < 0 ? null : { a: ia, b: ib, c: ic, tip: find( `Bip01 ${ s } ${ tip }` ), A: under( ia ), B: under( ib ), side: s === 'L' ? 1 : - 1 }; };
			this.rig = {
				arms: [ limb( 'L', 'UpperArm', 'Forearm', 'Hand', 'Finger2' ), limb( 'R', 'UpperArm', 'Forearm', 'Hand', 'Finger2' ) ],
				legs: [ limb( 'L', 'Thigh', 'Calf', 'Foot', 'Toe0' ), limb( 'R', 'Thigh', 'Calf', 'Foot', 'Toe0' ) ],
				pelvis: find( 'Bip01 Pelvis' ), head: find( 'Bip01 Head' ),
			};
			// the ski clips, with the pelvis translation unless it lands the hips somewhere silly (other units)
			const lay = ( clip ) => ( { clip, time: 0, weight: 0, target: 0, fade: 1e-3, loop: true, speed: 1, ended: false } );
			const sitPelvis = ( clips ) => { m.layers = [ Object.assign( lay( clips.get( 'ski_sit' ) ), { weight: 1, target: 1 } ) ]; m.update( 0 ); return at( m.world, this.rig.pelvis, new THREE.Vector3() ); };
			let clips = retarget( av.gltf, gltf, true );
			let pel = sitPelvis( clips );
			if ( ! ( pel.y > 0.4 && pel.y < 0.8 ) ) { clips = retarget( av.gltf, gltf, false ); pel = sitPelvis( clips ); }
			this.pelvisSit = pel;
			this.L = {};
			for ( const [ n, c ] of clips ) this.L[ n ] = lay( c );
			for ( const [ k, n ] of Object.entries( CLIP ) ) if ( m.clips.has( n ) ) this.L[ k ] = Object.assign( lay( m.clips.get( n ) ), { loop: k !== 'wave' && k !== 'laugh' } );
			// never a bind-pose frame: the idle is evaluated before she is ever drawn
			this.w = { idle: 1 };
			for ( const l of Object.values( this.L ) ) l.weight = l.target = 0;
			this.L.idle.weight = this.L.idle.target = 1;
			m.layers = [ this.L.idle ];
			m.update( 0 );
			// her chest (the waterline when she treads water) and her own sea height (one water-query slot)
			const chest = find( 'Bip01 Spine2' ) >= 0 ? find( 'Bip01 Spine2' ) : find( 'Bip01 Spine1' );
			if ( chest >= 0 ) { const y = at( m.world, chest, new THREE.Vector3() ).y; if ( y > 0.9 && y < 1.6 ) this.treadDepth = y - MATE.chestDip; }
			try { this.slot = this.app.query.allocate( 'mate', 1 ); } catch ( e ) { this.slot = - 1; console.warn( 'Mate: no water-query slot, she reads the ski\'s sea height', e ); }
			this.root.add( m.group );
			this.placeHome();
			this.app.scene.add( this.root );
			this.ready = true;

		} catch ( e ) {

			console.warn( 'Mate: failed to load', e );
			this.failed = true;

		}

	}

	placeHome() {

		const [ x, z ] = MATE.home;
		this.root.position.set( x, this.floor( x, z ), z );
		this.root.quaternion.setFromAxisAngle( _Y, this.yaw );

	}

	// feet height at x, z: on the bottom in the shallows, treading water past her depth (sea: the water there)
	floor( x, z, sea = this.js.waterLevel() ) { return Math.max( this.app.terrainData.heightAt( x, z ), sea - ( this.treadDepth || MATE.tread ) ); }

	// the sea where she is: her own query slot (the live ski's level reads a wave crest 20 m away), the
	// ski's level until the slot has read back
	seaHere() {

		const q = this.app.query;
		if ( this.slot < 0 || ! q ) return this.js.waterLevel();
		const h = q.get( this.slot, this._wq ).height;
		return Number.isFinite( h ) && h !== 0 ? h : this.js.waterLevel();

	}

	deep( x, z ) { return this.app.terrainData.heightAt( x, z ) < this.js.waterLevel() - MATE.tread + 0.05; }

	// world point in a ski's frame
	skiPoint( ski, x, y, z, out ) { return out.set( x, y, z ).applyQuaternion( ski.group.quaternion ).add( ski.group.position ); }

	// the boarding point: off the ski's left side, beside her seat, on the bottom or treading
	boardPoint( ski, out ) {

		const S = ski.pivots.Seat;
		this.skiPoint( ski, MATE.side, 0, S.z - MATE.behind, out );
		out.y = this.floor( out.x, out.z );
		return out;

	}

	// her seat: the root so her pelvis sits behind the Seat pivot, leant with the rider on the live ski
	seatPose( out ) {

		const ski = this.ski, S = ski.pivots.Seat, c = this.js.ctl;
		this.skiPoint( ski, S.x - this.pelvisSit.x, S.y + MATE.up - this.sag - this.pelvisSit.y, S.z - MATE.behind - this.pelvisSit.z, out.pos );
		out.q.copy( ski.group.quaternion );
		if ( this.onLive() ) out.q.multiply( _q.setFromAxisAngle( _Z, - c.leanLat * 11 * DEG ) ).multiply( _q2.setFromAxisAngle( _X, c.leanFwd * 9 * DEG ) );
		return out;

	}

	onLive() { return this.ski && this.ski === this.js.live && this.app.player.mode === 'jetski'; }

	flat( a, b ) { return Math.hypot( a.x - b.x, a.z - b.z ); }

	// the G action while riding, and its prompt text
	action() {

		if ( ! this.ready || ! this.enabled ) return null;
		const js = this.js, c = js.ctl;
		if ( c.capsized ) return null;
		const near = this.mode === 'ashore' && this.flat( c.position, this.root.position ) < MATE.reach;
		if ( c.speed > MATE.calm ) return near ? { key: 'S', text: `Slow down to pick up ${ this.name }`, go: null } : null;
		if ( near ) return { text: `Pick up ${ this.name }`, go: () => { this.ski = js.live; this.go( 'wade', 'home' ); } };
		if ( this.mode === 'aboard' && this.ski === js.live && Math.hypot( c.position.x - MATE.home[ 0 ], c.position.z - MATE.home[ 1 ] ) < MATE.drop )
			return { text: `Drop ${ this.name } off`, go: () => this.go( 'off' ) };
		return null;

	}

	prompt() { const a = this.action(); return a ? { key: a.key || 'G', text: `${ a.text }   ·   E  Get off` } : null; }

	key() { const a = this.action(); if ( a?.go ) a.go(); }

	go( mode, abort = null ) {

		this.mode = mode;
		this.u = 0;
		this.abort = abort;
		this.from.pos.copy( this.root.position );
		this.from.q.copy( this.root.quaternion );
		if ( mode === 'off' ) this.boardPoint( this.ski, this.goal );

	}

	// crash: thrown off with the ski's momentum (Jetskis.throwRider)
	throw() {

		if ( ! this.ready || ( this.mode !== 'aboard' && this.mode !== 'climb' ) ) return;
		const c = this.js.ctl, side = _v.set( 1, 0, 0 ).applyQuaternion( c.quaternion );
		const pel = at( this.model.world, this.rig.pelvis, _w ).applyQuaternion( this.root.quaternion ).add( this.root.position );
		this.fly = {
			pos: pel.clone(), axis: side.clone().setY( 0 ).normalize(), spin: this.root.quaternion.clone(),
			vel: c.velocity.clone().multiplyScalar( 0.75 ).addScaledVector( side, ( Math.random() - 0.5 ) * 2 ).add( _t.set( 0, 2.2 + 0.05 * c.speed, 0 ) ),
			rate: Math.min( 3 + c.speed * 0.25, 9 ),
		};
		this.mode = 'thrown';
		this.u = 0;

	}

	// the controller's events, before Jetskis.handleEvents clears them
	event( e ) {

		if ( this.mode !== 'aboard' || ! this.onLive() ) return;
		if ( e.type === 'land' ) {

			this.sagV += Math.min( e.vn, 8 ) * 0.09;
			if ( e.air > 0.8 || e.vn > 4.5 ) this.say( 'laugh' );

		} else if ( e.type === 'ignite' ) this.say( 'rocket' );

	}

	say( key ) {

		const L = LINES[ key ], t = this.t, hub = this.app.people;
		if ( ! L || ! hub?.say || t < this.quietUntil || t < ( this.cool[ key ] || 0 ) ) return false;
		// her call carries across the water: its bubble shows out to the range she calls from (+ 8 m: the chase camera behind the ski)
		const said = key === 'call' && hub.speech?.say ? hub.speech.say( this.person, L[ 0 ], 'mate-' + key, hub.t, false, MATE.call + 8 ) : hub.say( this.person, L[ 0 ], 'mate-' + key );
		if ( ! said ) return false;
		this.quietUntil = t + QUIET;
		this.cool[ key ] = t + L[ 1 ];
		this.said.push( { t: + t.toFixed( 1 ), key, text: L[ 0 ] } );
		if ( this.said.length > 12 ) this.said.shift();
		return true;

	}

	// walk (or swim) toward the goal; true on arrival
	walk( dt, goal, speed ) {

		const r = this.root.position, dx = goal.x - r.x, dz = goal.z - r.z, d = Math.hypot( dx, dz );
		const step = Math.min( d, speed * dt );
		if ( d > 1e-3 ) { r.x += dx / d * step; r.z += dz / d * step; this.turnTo( Math.atan2( dx, dz ), dt ); }
		r.y = this.floor( r.x, r.z, this.seaHere() );
		return d < 0.2;

	}

	turnTo( yaw, dt ) {

		let d = yaw - this.yaw;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		this.yaw += d * ( 1 - Math.exp( - dt * 6 ) );
		this.root.quaternion.setFromAxisAngle( _Y, this.yaw );

	}

	update( dt ) {

		if ( ! this.ready ) { this.load(); return; }
		const js = this.js, app = this.app, c = js.ctl, p = app.player, want = {};
		this.afloat = false;
		if ( this.slot >= 0 ) app.query.setPoint( this.slot, this.root.position.x, this.root.position.z );
		this.root.visible = this.enabled;
		if ( ! this.enabled ) { c.setPassenger?.( 0 ); return; }
		const t0 = performance.now();
		this.t += dt;
		let ik = 0, kg = 0;
		const speedOK = c.speed < MATE.calm;
		switch ( this.mode ) {

			case 'ashore': {

				// watching the hire skis; turns to a ski that pulls up and waves it in once
				const d = this.flat( c.position, this.root.position );
				const seen = js.riding && ! c.capsized && d < MATE.call;
				if ( seen ) this.turnTo( Math.atan2( c.position.x - this.root.position.x, c.position.z - this.root.position.z ), dt );
				else this.turnTo( MATE.homeYaw, dt );
				// a ski in sight: she waves it over every few seconds and calls out (the bubble shows once the camera is in
				// earshot), until it is in reach; in reach she asks for the lift once
				if ( seen && d > MATE.reach && ! ( this.waveT > 0 ) && this.t - ( this.calledAt ?? - 1e9 ) > MATE.callEvery ) { this.calledAt = this.t; this.waveT = 2.2; this.say( 'call' ); }
				if ( seen && d < MATE.reach && ! this.waved ) { this.waved = true; this.waveT = 2.2; this.say( 'hello' ); }
				if ( d > MATE.reach + 6 ) this.waved = false;
				this.waveT = Math.max( 0, ( this.waveT || 0 ) - dt );
				const look = Math.sin( this.t * 0.35 ) > 0.6 ? 1 : 0;
				if ( this.waveT > 0 && this.L.wave ) want.wave = 1; else if ( look && this.L.look ) want.look = 1; else want.idle = 1;
				this.root.position.y = this.floor( this.root.position.x, this.root.position.z );
				this.person.posture = 'stand';
				break;

			}
			case 'wade': {

				// out to the ski's boarding point; back where she came from if it drives off
				const ski = this.ski, goal = this.boardPoint( ski, this.goal );
				if ( ! speedOK && c.speed > MATE.calm * 2 && ski === js.live || this.flat( goal, this.root.position ) > 30 ) { this.go( this.abort || 'home' ); break; }
				const swim = this.deep( this.root.position.x, this.root.position.z );
				this.afloat = swim;
				if ( this.walk( dt, goal, swim ? 0.9 : Math.min( this.walkSpeed, 1.3 ) ) ) this.go( 'climb' );
				if ( swim ) want.idle = 1; else { want.walk = 1; this.L.walk.speed = 1.3 / this.walkSpeed; }
				break;

			}
			case 'climb': {

				this.u = Math.min( 1, this.u + dt / MATE.climb );
				const u = this.u, s = this.seatPose( this.seat );
				const up = sstep( u, 0, 0.6 ), across = sstep( u, 0.25, 1 );
				this.root.position.set( THREE.MathUtils.lerp( this.from.pos.x, s.pos.x, across ), THREE.MathUtils.lerp( this.from.pos.y, s.pos.y, up ) + 0.25 * Math.sin( Math.PI * across ), THREE.MathUtils.lerp( this.from.pos.z, s.pos.z, across ) );
				this.root.quaternion.slerpQuaternions( this.from.q, s.q, sstep( u, 0.1, 0.8 ) );
				const e = sstep( u, 0.15, 0.85 );
				want.idle = 1 - e; want.ski_stand = e * ( 1 - e ) * 2; want.ski_sit = e;
				ik = sstep( u, 0.55, 1 );
				kg = MATE.mass * sstep( u, 0.3, 1 );
				if ( u >= 1 ) { this.mode = 'aboard'; this.say( 'aboard' ); }
				this.person.posture = 'sit';
				break;

			}
			case 'aboard': {

				this.ride( dt, want );
				ik = this.js?.ctl?.pushing ? 0 : 1; kg = MATE.mass; // (while he walks the ski off the sand she sits on alone)
				this.person.posture = 'sit';
				break;

			}
			case 'off': {

				this.u = Math.min( 1, this.u + dt / MATE.off );
				const u = this.u, s = this.seatPose( this.seat ), goal = this.boardPoint( this.ski, this.goal );
				const down = sstep( u, 0.4, 1 ), across = sstep( u, 0, 0.75 );
				this.root.position.set( THREE.MathUtils.lerp( s.pos.x, goal.x, across ), THREE.MathUtils.lerp( s.pos.y, goal.y, down ) + 0.2 * Math.sin( Math.PI * across ), THREE.MathUtils.lerp( s.pos.z, goal.z, across ) );
				this.yaw = Math.atan2( MATE.home[ 0 ] - goal.x, MATE.home[ 1 ] - goal.z );
				this.root.quaternion.slerpQuaternions( s.q, _q.setFromAxisAngle( _Y, this.yaw ), sstep( u, 0.2, 0.9 ) );
				const e = sstep( u, 0.1, 0.8 );
				want.ski_sit = 1 - e; want.ski_stand = e * ( 1 - e ) * 2; want.idle = e;
				ik = 1 - sstep( u, 0, 0.4 );
				kg = MATE.mass * ( 1 - sstep( u, 0, 0.7 ) );
				if ( u >= 1 ) { this.mode = 'home'; this.say( 'bye' ); }
				break;

			}
			case 'home': {

				_h.set( MATE.home[ 0 ], 0, MATE.home[ 1 ] );
				const swim = this.deep( this.root.position.x, this.root.position.z );
				this.afloat = swim;
				if ( this.walk( dt, _h, swim ? 0.9 : Math.min( this.walkSpeed, 1.3 ) ) ) { this.mode = 'ashore'; this.ski = null; this.waved = true; this.calledAt = this.t + 20; }
				if ( swim ) want.idle = 1; else { want.walk = 1; this.L.walk.speed = 1.3 / this.walkSpeed; }
				this.person.posture = 'stand';
				break;

			}
			case 'thrown': {

				const f = this.fly, water = js.waterLevel();
				this.u += dt;
				f.vel.y -= 9.81 * dt;
				f.vel.multiplyScalar( Math.exp( - dt * 0.15 ) );
				f.pos.addScaledVector( f.vel, dt );
				f.spin.premultiply( _q.setFromAxisAngle( f.axis, f.rate * dt ) );
				this.root.quaternion.copy( f.spin );
				this.root.position.copy( f.pos ).sub( _v.copy( this.pelvisSit ).applyQuaternion( f.spin ) );
				want.ski_stand = 1;
				const ground = app.terrainData.heightAt( f.pos.x, f.pos.z );
				if ( f.pos.y < water || f.pos.y < ground + 0.5 ) {

					js.burst( f.pos, 1.8, 0.8 );
					app.audio?.splash?.( 0.8, f.pos );
					this.yaw = Math.atan2( c.position.x - f.pos.x, c.position.z - f.pos.z );
					this.root.quaternion.setFromAxisAngle( _Y, this.yaw );
					this.root.position.set( f.pos.x, this.floor( f.pos.x, f.pos.z ), f.pos.z );
					this.mode = 'tread'; // (on the bottom in the shallows, afloat past her depth: she waits for the ski either way)
					this.u = 0;
					this.fly = null;

				}
				break;

			}
			case 'tread': {

				// waits in the water; swims to the ski when you stop close by
				this.u += dt;
				const r = this.root.position;
				this.afloat = this.deep( r.x, r.z );
				r.y = this.floor( r.x, r.z, this.seaHere() ) + ( this.afloat ? 0.035 * Math.sin( this.t * MATE.cycle * 2 ) : 0 ); // each leg stroke lifts her a touch
				this.turnTo( Math.atan2( c.position.x - r.x, c.position.z - r.z ), dt );
				if ( this.u > 1.6 && this.u < 1.7 ) this.say( 'wet' );
				const ski = this.ski;
				if ( ski === js.live && js.riding && speedOK && this.flat( this.boardPoint( ski, this.goal ), r ) < MATE.back ) this.go( 'wade', 'tread' );
				want.idle = 1;
				break;

			}

		}

		// the physics: her weight on the rear seat of the ski she is on, when it is the live one
		c.setPassenger?.( this.ski === js.live ? kg : 0 );
		this.animate( dt, want, ik );
		this.cpu = ( this.cpu || 0 ) + ( performance.now() - t0 - ( this.cpu || 0 ) ) * 0.05; // ms a frame, smoothed

	}

	// on the saddle: the rider's clips at the rider's weights (a touch less lean, more duck on the rocket)
	ride( dt, want ) {

		const c = this.js.ctl, live = this.onLive();
		// the ski's heave and the landings: a damped spring she sinks into
		const vy = c.velocity.y;
		if ( live && dt > 0 ) this.sagV += Math.max( - 0.6, Math.min( 0.6, ( this.vyPrev - vy ) * 0.35 ) ) * ( c.airborne ? 0 : 1 );
		this.vyPrev = vy;
		this.sagV += ( - 110 * this.sag - 13 * this.sagV ) * dt;
		this.sag = Math.max( - 0.03, Math.min( 0.09, this.sag + this.sagV * dt ) );
		const s = this.seatPose( this.seat );
		this.root.position.copy( s.pos );
		this.root.quaternion.copy( s.q );
		const lean = live ? c.leanLat * 0.85 : 0, air = live && this.js.aloft ? 0.35 : 0;
		const tuck = live ? Math.min( 1, Math.max( 0.7 * c.leanFwd, 0.9 * c.boostLevel ) + Math.max( 0, this.sag ) * 3 ) : 0;
		want.ski_sit = Math.max( 0.001, 1 - tuck - Math.abs( lean ) - air );
		want.ski_lean_l = Math.max( 0, lean ) * ( 1 - air ); want.ski_lean_r = Math.max( 0, - lean ) * ( 1 - air );
		want.ski_tuck = tuck * ( 1 - air ); want.ski_stand = air;
		if ( ! live ) return;
		// her lines: air, the ferry, dolphins
		this.airT = this.js.aloft ? this.airT + dt : 0;
		if ( this.airT > 0.4 && this.airT - dt <= 0.4 ) this.say( 'woo' );
		const pos = c.position, ship = this.app.ferry?.ship;
		if ( ship && this.flat( ship.position, pos ) < 70 ) this.say( 'ferry' );
		const dol = this.app.dolphins?.brain?.members;
		if ( dol && ( this._dolT = ( this._dolT || 0 ) - dt ) <= 0 ) {

			this._dolT = 0.5;
			for ( const m of dol ) if ( m.position && this.flat( m.position, pos ) < 35 ) { this.say( 'dolphins' ); break; }

		}

	}

	// clip weights eased toward `want`, the clips evaluated, then IK: feet on the deck, palms on the rider's waist
	animate( dt, want, ik ) {

		const m = this.model, L = this.L, k = 1 - Math.exp( - dt * 10 ), layers = [];
		for ( const n in L ) {

			const l = L[ n ], w = want[ n ] || 0;
			l.weight = l.target = Math.abs( w - l.weight ) < 1e-3 ? w : l.weight + ( w - l.weight ) * ( this.mode === 'climb' || this.mode === 'off' || this.mode === 'thrown' ? 1 : k );
			if ( l.weight > 1e-3 ) layers.push( l );
			else if ( n === 'wave' || n === 'laugh' ) l.time = 0;

		}
		if ( ! layers.length ) { L.idle.weight = L.idle.target = 1; layers.push( L.idle ); }
		m.layers = layers;
		const cam = this.app.camera.position, far = this.root.position.distanceToSquared( cam ) > 150 * 150;
		this.root.visible = ! far;
		if ( far ) { m.hold(); return; }
		m.update( dt );
		const W = m.world, R = this.rig;
		if ( this.mode === 'thrown' ) {

			// arms flung out as she flies (model +x is her left)
			for ( const a of R.arms ) if ( a ) turn( W, a.A, at( W, a.a, _A ), _q.setFromAxisAngle( _Z, a.side * 1.1 ) );
			upload( m );

		} else if ( this.afloat && this.treadOn && ik < 0.5 ) {

			this.treadPose( W );
			upload( m );

		} else if ( ik > 1e-3 && this.ski ) {

			this.limbs( W, ik );
			upload( m );

		}
		poseVest( this.vest, m, this.wearsVest() );
		// the eyes (speech bubbles) and the feet (the hub's range test)
		at( W, R.head, this.person.head ).applyQuaternion( this.root.quaternion ).add( this.root.position );
		this.person.world.copy( this.root.position );
		this.occlude( dt );

	}

	// treading water, upright with her chest at the waterline: the hands scull out to the sides just under the
	// surface (a slow figure of eight: the upper arm out and swept fore and aft, the elbow bent forward, the forearm
	// turning with it) and the legs cycle slowly under her, knees bent, the two legs half a stroke apart.
	// Model space: +x her left, +y up, +z forward; turns about Z lift an arm out to its side, about X swing a limb fore and aft.
	treadPose( W ) {

		const R = this.rig, t = this.t, ws = MATE.scull * t, wc = MATE.cycle * t;
		for ( const a of R.arms ) {

			if ( ! a ) continue;
			const s = a.side, sw = Math.sin( ws + ( s > 0 ? 0 : Math.PI ) * 0.15 );
			turn( W, a.A, at( W, a.a, _A ), _q.setFromAxisAngle( _Z, s * ( 1.05 + 0.08 * sw ) ) );          // out, just under the surface
			turn( W, a.A, at( W, a.a, _A ), _q.setFromAxisAngle( _Y, - s * ( 0.35 + 0.3 * sw ) ) );         // swept forward and back
			turn( W, a.B, at( W, a.b, _B ), _q.setFromAxisAngle( _X, - 0.75 - 0.25 * Math.cos( ws ) ) );   // elbow bent, hands ahead
			turn( W, a.B, at( W, a.b, _B ), _q.setFromAxisAngle( _Y, - s * 0.35 * Math.cos( ws ) ) );      // the forearm sculls in and out

		}
		for ( const g of R.legs ) {

			if ( ! g ) continue;
			const ph = wc + ( g.side > 0 ? 0 : Math.PI );
			turn( W, g.A, at( W, g.a, _A ), _q.setFromAxisAngle( _X, - ( 0.5 + 0.3 * Math.sin( ph ) ) ) );          // thigh forward
			turn( W, g.A, at( W, g.a, _A ), _q.setFromAxisAngle( _Z, g.side * 0.12 ) );                         // knees a little apart
			turn( W, g.B, at( W, g.b, _B ), _q.setFromAxisAngle( _X, 0.95 + 0.45 * Math.sin( ph + 1.2 ) ) );     // knee bent, the foot back

		}

	}

	// the chase camera looks past her at the rider: while her head sits on the sight line to his head or chest she
	// fades to see-through (the people's dither), and back as the line clears
	occlude( dt ) {

		let want = 0;
		const rider = this.fadeOn && this.onLive() && ( this.mode === 'ride' || this.mode === 'aboard' ) ? this.app.player.avatar?.model : null;
		if ( rider ) {

			const cam = this.app.camera.position, rf = this.js.rideFrame(), H = this.person.head;
			const ih = this._rh ?? ( this._rh = rider.gltf.nodes.findIndex( n => n.name === 'Bip01 Head' ) );
			const ic = this._rs ?? ( this._rs = rider.gltf.nodes.findIndex( n => n.name === 'Bip01 Spine' ) );
			for ( const i of [ ih, ic ] ) {

				if ( i < 0 ) continue;
				at( rider.world, i, _t ).applyQuaternion( rf.q ).add( rf.pos );
				_d.copy( _t ).sub( cam );
				const L2 = _d.lengthSq(), u = L2 > 1e-6 ? _p.copy( H ).sub( cam ).dot( _d ) / L2 : - 1;
				if ( u <= 0.05 || u >= 1 ) continue;
				const miss = _p.copy( cam ).addScaledVector( _d, u ).distanceTo( H );
				want = Math.max( want, MATE.ghost * ( 1 - sstep( miss, MATE.clear, MATE.clear + 0.15 ) ) );

			}

		}
		this.fade += ( want - this.fade ) * ( 1 - Math.exp( - dt * 10 ) );
		setFade( this.model, this.fade < 0.02 ? 0 : + this.fade.toFixed( 2 ) );
		if ( this.vest ) setGroupFade( this.vest.node, this.fade < 0.02 ? 0 : + this.fade.toFixed( 2 ) );

	}

	// the ski vest: on the ski (climbing on and off it too), thrown, and in the water
	wearsVest() {

		return [ 'climb', 'aboard', 'ride', 'off', 'thrown', 'tread' ].includes( this.mode ) || ( !! this.afloat && this.mode !== 'ashore' );

	}

	// model space from world
	local( v ) { return v.sub( this.root.position ).applyQuaternion( _qi.copy( this.root.quaternion ).invert() ); }

	world( v ) { return v.applyQuaternion( this.root.quaternion ).add( this.root.position ); }

	limbs( W, k ) {

		const ski = this.ski, S = ski.pivots.Seat, R = this.rig, rider = this.onLive() && this.mode !== 'off' && ! this.js?.ctl?.pushing ? this.app.player.avatar?.model : null;
		const zs = S.z - MATE.behind;
		// feet: on the footwell deck either side, a little ahead of her hips
		for ( const g of R.legs ) {

			if ( ! g ) continue;
			const T = this.local( this.skiPoint( ski, g.side * 0.34, ski.pivots.FootL.y + 0.085, zs + 0.2, _t ) );
			reach( W, g, T, _w.set( g.side * POLE.leg[ 0 ], POLE.leg[ 1 ], POLE.leg[ 2 ] ).normalize(), k );
			this.gap.feet[ g.side > 0 ? 0 : 1 ] = + ( at( W, g.c, _v ).distanceTo( T ) * 100 ).toFixed( 1 );

		}
		// hands: on the rider's waist (the rider's Bip01 Spine, a hand's width up, either flank); with no rider, the seat strap
		for ( const g of R.arms ) {

			if ( ! g ) continue;
			if ( rider ) {

				const rf = this.js.rideFrame(), i = this._rs ?? ( this._rs = rider.gltf.nodes.findIndex( n => n.name === 'Bip01 Spine' ) );
				at( rider.world, i, _t );
				_t.x += g.side * MATE.waist; _t.y += 0.07;
				this.local( _t.applyQuaternion( rf.q ).add( rf.pos ) );

			} else this.local( this.skiPoint( ski, g.side * 0.11, S.y + 0.05, zs + 0.3, _t ) );
			// the wrist goes a palm short of the waist: two passes, the palm offset measured after the first
			const T = _h.copy( _t );
			reach( W, g, T, _w.set( g.side * POLE.arm[ 0 ], POLE.arm[ 1 ], POLE.arm[ 2 ] ).normalize(), k );
			if ( g.tip >= 0 ) {

				const palm = at( W, g.c, _v ).lerp( at( W, g.tip, _A ), 0.5 ).sub( at( W, g.c, _B ) );
				reach( W, g, _T2.copy( _t ).sub( palm ), _w.set( g.side * POLE.arm[ 0 ], POLE.arm[ 1 ], POLE.arm[ 2 ] ).normalize(), k );
				const pc = at( W, g.c, _v ).lerp( at( W, g.tip, _A ), 0.5 );
				this.gap.hands[ g.side > 0 ? 0 : 1 ] = + ( pc.distanceTo( _t ) * 100 ).toFixed( 1 );

			}

		}

	}

	state() {

		const r = this.root.position;
		return { name: this.name, ready: this.ready, failed: this.failed, enabled: this.enabled, cast: MATE.cast, swim: this.swim, mode: this.mode, ski: this.ski?.name || null,
			pos: [ + r.x.toFixed( 2 ), + r.y.toFixed( 2 ), + r.z.toFixed( 2 ) ], mass: this.js.ctl.massMate || 0, sag: + this.sag.toFixed( 3 ),
			gapCm: this.gap, afloat: this.afloat, fade: + this.fade.toFixed( 2 ), sea: + this.seaHere().toFixed( 2 ), treadDepth: this.treadDepth || MATE.tread, cpuMs: + ( this.cpu || 0 ).toFixed( 3 ), clips: this.model ? this.model.layers.map( l => l.clip.name + ':' + l.weight.toFixed( 2 ) ) : [], said: this.said.slice( - 8 ) };

	}

}
