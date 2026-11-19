import * as THREE from '../../engine/index.js';

// A pod of common bottlenose dolphins (Tursiops truncatus): roaming a loose route along the island's
// coast in 8 to 30 m of water, surfacing to breathe every 20 to 40 s (rise, arch, roll the back and
// fin over, dive), porpoising when they travel fast, and racing in to ride the bow waves of the
// ferry (both stems of the catamaran) and of the fishing boat when they are under way. The player's
// jetski too: at a pace they can hold (up to about 33 km/h) two to four race in to ride off its bow,
// porpoise abreast and leap its wake behind, cutting across in a sharp turn; faster, they drop back
// into the wake leaping and give up; stopped, one or two circle it and come up to breathe beside it.
//
// Each member is a steered point mass: its velocity eases toward a goal (school spot, bow-wave
// berth) and its heading, pitch and bank come from its own motion. A path history (one entry per
// update, stamped with travelled distance) lets the body follow its track through turns, surfacing
// arcs and leaps (Dolphin.js _pose). Kinematics: tail beat 1 to 3 Hz rising with speed, cruise
// 2 to 3 m/s, bursts to 9 m/s; bow-riders glide in the pressure field with few fluke beats.

const G = 9.81;
const CRUISE = 2.2;             // m/s, pod travel along the coast
const SPRINT = 5.4;             // m/s, a fast travel spell (porpoising)
const CONTOUR = - 15;           // m, the route follows the 15 m depth contour
const STEM_X = 6.7, STEM_Z = 22.6; // ferry stems in her frame (waterline), +Z bow
// bow-wave berths per stem: [ x outboard of the stem, z ahead of the stem, depth of the root ]
const BERTHS = [ [ 0.3, 2.2, 0.9 ], [ 2.0, 0.7, 1.5 ], [ - 1.9, 3.8, 2.1 ] ];
const RIDE_RANGE = 400, BOAT_RANGE = 300;
const ROOT_TOP = 0.29;          // the back above the rig root, m
// the player's jetski (JetskiController, while he rides it)
const SKI_TOP = 9.2;            // m/s (33 km/h): the fastest pace a dolphin holds; faster, they drop back
const SKI_JOIN = 2.5;           // m/s: under way enough to be worth riding
const SKI_STOP = 0.8;           // m/s: stopped, idling or drifting
const HULL_X = 0.6, HULL_Z = 1.65, HULL_D = 0.35, HULL_UP = 0.9; // ski hull: half beam, half length, draft, freeboard, m
const GIRTH = 0.25;             // m, a dolphin's body radius at the points checked for clearance
const KEEP = 1.2;               // m of clear water steered for between a dolphin and the hull

const _v = new THREE.Vector3();
const _g = new THREE.Vector3();
const _gv = new THREE.Vector3();
const _l = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function mulberry32( a ) {

	return () => {

		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul( a ^ a >>> 15, 1 | a );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );

class Member {

	constructor( i, rand ) {

		this.i = i;
		this.rand = rand;
		this.position = new THREE.Vector3();
		this.velocity = new THREE.Vector3();
		this.quaternion = new THREE.Quaternion();
		this.yaw = 0; this.pitch = 0; this.roll = 0; this.rollTarget = 0; this.rollT = 0; this.yawRate = 0;
		this.strokePhase = rand() * 6.28; this.strokeAmp = 0.12; this.arch = 0; this.headPitch = 0; this.follow = 0.9;
		this.water = 0; this.wetAge = 100;
		this.cruiseDepth = 1.8 + rand() * 2.2;
		this.state = 'swim'; // swim | breathe | leap
		this.seqT = 0; this.seqDur = 1.6; this.air = false;
		this.breathT = 4 + rand() * 30;
		this.leapT = 3 + rand() * 8;
		this.puffDue = false; this.splashes = 0;
		this.offset = new THREE.Vector3( ( rand() - 0.5 ) * 16, 0, ( rand() - 0.5 ) * 20 ); // spot in the school
		this.phase = rand() * 100;
		this.berth = - 1; this.boat = false; this.rideT = 0;
		// jetski: role (null | bow | side | wake | drop | circle), side of the ski (+1 / -1), timers
		this.ski = null; this.skiRole = null; this.side = 1; this.peelT = 0; this.skiT = 0; this.withT = 0; this.spSum = 0;
		this.dropT = 0; this.dropMax = 10; this.crossT = 0; this.circA = 0; this.circR = 8; this.circDir = 1;
		this.HN = 512;
		this.hArc = new Float64Array( this.HN );
		this.hQ = new Float32Array( this.HN * 4 );
		this.hHead = - 1; this.hCount = 0; this.arc = 0;

	}

	get depth() { return this.water - this.position.y; }

	get backDepth() { return this.water - ( this.position.y + ROOT_TOP ); }

	orient() {

		this.quaternion.setFromEuler( _e.set( - this.pitch, this.yaw, this.roll, 'YXZ' ) );

	}

	record() {

		const h = this.hHead = ( this.hHead + 1 ) % this.HN;
		this.hArc[ h ] = this.arc;
		const q = this.quaternion;
		this.hQ[ h * 4 ] = q.x; this.hQ[ h * 4 + 1 ] = q.y; this.hQ[ h * 4 + 2 ] = q.z; this.hQ[ h * 4 + 3 ] = q.w;
		this.hCount = Math.min( this.hCount + 1, this.HN );

	}

	// a straight run-in along the current heading (spawn, gather)
	resetHistory() {

		this.hHead = - 1; this.hCount = 0;
		this.orient();
		const a = this.arc;
		for ( let i = 40; i >= 0; i -- ) { this.arc = a - i * 0.1; this.record(); }
		this.arc = a;

	}

	// orientation the root had `d` metres of travel ago
	pathRotation( d, out ) {

		const target = this.arc - d;
		const N = this.HN, H = this.hHead;
		let lo = 0, hi = this.hCount - 1;
		const arcAt = ( k ) => this.hArc[ ( H - k + N ) % N ];
		if ( target >= arcAt( 0 ) ) return this._q( H, out );
		if ( target <= arcAt( hi ) ) return this._q( ( H - hi + N ) % N, out );
		while ( hi - lo > 1 ) {

			const m = ( lo + hi ) >> 1;
			if ( arcAt( m ) > target ) lo = m; else hi = m;

		}

		const a0 = arcAt( lo ), a1 = arcAt( hi );
		const t = ( a0 - target ) / Math.max( a0 - a1, 1e-9 );
		this._q( ( H - lo + N ) % N, out );
		return out.slerp( this._q( ( H - hi + N ) % N, _q ), t );

	}

	_q( idx, out ) {

		const Q = this.hQ;
		return out.set( Q[ idx * 4 ], Q[ idx * 4 + 1 ], Q[ idx * 4 + 2 ], Q[ idx * 4 + 3 ] );

	}

	// pectorals: held out and down, working as hydroplanes (pitch) and in turns (bank)
	flipperRotation( side, out ) {

		const sg = side === 0 ? 1 : - 1;
		const turn = clamp( this.yawRate * 0.18, - 0.3, 0.3 );
		_e.set( 0.12 * clamp( this.pitch, - 1, 1 ) + 0.03 * Math.sin( this.strokePhase ), 0, sg * ( 0.05 + sg * turn ), 'XYZ' );
		return out.setFromEuler( _e );

	}

}

export class DolphinBrain {

	constructor( { terrain, query = null, count = 6, seed = 20260926 } ) {

		this.terrain = terrain;
		this.query = query;
		this.rand = mulberry32( seed );
		this.members = [];
		for ( let i = 0; i < count; i ++ ) this.members.push( new Member( i, mulberry32( seed + 101 * ( i + 1 ) ) ) );
		this.mode = 'roam'; // roam | ride
		this.time = 0;
		this.cooldown = 0; this.boatCooldown = 0;
		this.rideT = 0; this.swapT = 8;
		this.travel = CRUISE; this.sprint = false; this.surgeT = 40 + this.rand() * 60;
		this.anchor = new THREE.Vector3();
		this.water = 0; this.boatWater = 0;
		this.slot = query ? query.allocate( 'dolphins', 2 ) : - 1; // pod anchor, boat bow
		// jetski: body points along the heading from the root (snout, mid, notch; Dolphin.js sets them
		// from the model), the ski's water level, heading and turn, and a record for tests and tools
		this.body = [ 0.7, - 0.9, - 2.1 ];
		this.skiCooldown = 0; this.stopT = 0; this.fastT = 0; this.skiTurn = 0; this.turnCD = 0; this.skiW = 0; this.skiF = new THREE.Vector3( 0, 0, 1 ); this.skiPos = new THREE.Vector3();
		this.skiStats = { joins: 0, joined: 0, maxRiders: 0, rides: [], minClear: Infinity, minClearH: Infinity, cuts: 0, circles: 0, leapsNear: 0, breathsNear: 0 };
		this._buildRoute();
		this.u = this.rand() * this.length;
		this.gather( ...this._routePoint( this.u ) );

	}

	// ---------------------------------------------------------------- coastal route

	_buildRoute() {

		const t = this.terrain;
		const h = ( x, z ) => { const y = t ? t.heightAt( x, z ) : - 50; return Number.isFinite( y ) ? y : - 50; };
		let sx = 0, sz = 0, n = 0;
		for ( let x = - 3000; x <= 3000; x += 60 ) for ( let z = - 3000; z <= 3000; z += 60 ) if ( h( x, z ) > 0 ) { sx += x; sz += z; n ++; }
		const cx = n ? sx / n : 0, cz = n ? sz / n : 0;
		const N = 60, R = [];
		for ( let i = 0; i < N; i ++ ) {

			const a = i / N * Math.PI * 2, dx = Math.sin( a ), dz = Math.cos( a );
			let r = 3000;
			for ( ; r > 30; r -= 5 ) if ( h( cx + dx * r, cz + dz * r ) > CONTOUR ) break;
			R.push( r + 10 );

		}

		for ( let pass = 0; pass < 3; pass ++ ) {

			const S = R.slice();
			for ( let i = 0; i < N; i ++ ) R[ i ] = ( S[ ( i + N - 2 ) % N ] + S[ ( i + N - 1 ) % N ] + S[ i ] + S[ ( i + 1 ) % N ] + S[ ( i + 2 ) % N ] ) / 5;

		}

		const pts = R.map( ( r, i ) => new THREE.Vector3( cx + Math.sin( i / N * Math.PI * 2 ) * r, 0, cz + Math.cos( i / N * Math.PI * 2 ) * r ) );
		const curve = new THREE.CatmullRomCurve3( pts, true, 'centripetal', 0.5 );
		curve.arcLengthDivisions = 3000;
		this.length = curve.getLength();
		const m = Math.ceil( this.length );
		this.rN = m;
		this.rPos = new Float64Array( ( m + 1 ) * 2 );
		const p = new THREE.Vector3();
		for ( let i = 0; i <= m; i ++ ) {

			curve.getPointAt( i / m, p );
			this.rPos[ i * 2 ] = p.x; this.rPos[ i * 2 + 1 ] = p.z;

		}

		this.center = [ cx, cz ];

	}

	_routePoint( u ) {

		const f = ( ( u / this.length ) % 1 + 1 ) % 1 * this.rN;
		const i = Math.min( Math.floor( f ), this.rN - 1 ), t = f - i;
		const P = this.rPos;
		return [ P[ i * 2 ] + ( P[ i * 2 + 2 ] - P[ i * 2 ] ) * t, P[ i * 2 + 1 ] + ( P[ i * 2 + 3 ] - P[ i * 2 + 1 ] ) * t ];

	}

	_routeYaw( u ) {

		const [ x0, z0 ] = this._routePoint( u - 2 ), [ x1, z1 ] = this._routePoint( u + 2 );
		return Math.atan2( x1 - x0, z1 - z0 );

	}

	_nearestU( x, z ) {

		let best = 0, bd = Infinity;
		const P = this.rPos;
		for ( let i = 0; i <= this.rN; i += 2 ) {

			const d = ( P[ i * 2 ] - x ) ** 2 + ( P[ i * 2 + 1 ] - z ) ** 2;
			if ( d < bd ) { bd = d; best = i; }

		}

		return best / this.rN * this.length;

	}

	floorAt( x, z ) {

		const y = this.terrain ? this.terrain.heightAt( x, z ) : - 50;
		return Number.isFinite( y ) ? y : - 50;

	}

	// place the whole pod around (x, z) (spawn; test and debug hook), roaming on from the nearest
	// point of the coastal route
	gather( x, z ) {

		this.mode = 'roam';
		this.u = this._nearestU( x, z );
		this.anchor.set( x, 0, z );
		const yaw = this._routeYaw( this.u );
		for ( const m of this.members ) {

			_v.copy( m.offset ).applyAxisAngle( _l.set( 0, 1, 0 ), yaw );
			m.position.set( x + _v.x, this.water - m.cruiseDepth, z + _v.z );
			m.position.y = Math.max( m.position.y, this.floorAt( m.position.x, m.position.z ) + 0.8 );
			m.velocity.set( Math.sin( yaw ) * CRUISE, 0, Math.cos( yaw ) * CRUISE );
			m.yaw = yaw; m.pitch = 0; m.roll = 0;
			m.state = 'swim'; m.air = false; m.berth = - 1; m.boat = false;
			m.resetHistory();

		}

	}

	// ---------------------------------------------------------------- per frame

	update( dt, { ferry = null, boat = null, ski = null } = {} ) {

		dt = Math.min( dt, 0.1 );
		if ( dt <= 0 ) return;
		this.time += dt;
		this._water( dt, ferry, boat );
		this._decide( dt, ferry, boat );
		if ( ski ) {

			ski.forward( this.skiF ); this.skiF.y = 0; this.skiF.normalize();
			this.skiPos.copy( ski.position );
			const h = ski.hasWater && ski.waterH && Number.isFinite( ski.waterH[ 4 ] ) ? ski.waterH[ 4 ] : ski.position.y;
			this.skiW += ( h - this.skiW ) * Math.min( 1, dt * 5 );

		}

		this._skiDecide( dt, ski );
		for ( const m of this.members ) this._steer( m, dt, ferry, boat, ski );

	}

	// sea level from the GPU water query (1 to 3 frames old): the pod's anchor and the boat's bow
	_water( dt, ferry, boat ) {

		const q = this.query;
		if ( ! q || this.slot < 0 ) return;
		if ( this.mode === 'ride' && ferry ) ferry.toWorld( _l.set( 0, 0, STEM_Z + 2 ), _v ); else _v.copy( this.anchor );
		q.setPoint( this.slot, _v.x, _v.z );
		if ( boat ) { boat.forward( _f ); q.setPoint( this.slot + 1, boat.position.x + _f.x * 5, boat.position.z + _f.z * 5 ); }
		if ( q.cpuValid ) {

			const k = Math.min( 1, dt * 5 );
			const h = q.get( this.slot ).height;
			if ( Number.isFinite( h ) ) this.water += ( h - this.water ) * k;
			if ( boat ) { const hb = q.get( this.slot + 1 ).height; if ( Number.isFinite( hb ) ) this.boatWater += ( hb - this.boatWater ) * k; }

		}

	}

	_decide( dt, ferry, boat ) {

		const r = this.rand;
		this.cooldown -= dt; this.boatCooldown -= dt;
		if ( this.mode === 'roam' ) {

			this.surgeT -= dt;
			if ( this.surgeT < 0 ) { this.sprint = ! this.sprint; this.surgeT = this.sprint ? 12 + r() * 12 : 50 + r() * 70; }
			this.travel += ( ( this.sprint ? SPRINT : CRUISE ) - this.travel ) * Math.min( 1, dt * 0.4 );
			this.u += this.travel * dt;
			const [ rx, rz ] = this._routePoint( this.u );
			_v.set( rx - this.anchor.x, 0, rz - this.anchor.z );
			const d = _v.length(), step = ( this.travel + 1.2 ) * dt;
			if ( d > step ) _v.multiplyScalar( step / d );
			this.anchor.add( _v );
			if ( ferry && ferry.speed > 3 && this.cooldown <= 0 && Math.hypot( ferry.position.x - this.anchor.x, ferry.position.z - this.anchor.z ) < RIDE_RANGE ) this._startRide();
			// the fishing boat at speed: one or two peel off to ride her bow wave
			if ( boat && boat.speed > 4 && this.boatCooldown <= 0 && Math.hypot( boat.position.x - this.anchor.x, boat.position.z - this.anchor.z ) < BOAT_RANGE ) {

				const riders = this.members.filter( ( m ) => ! m.boat ).sort( ( a, b ) => a.position.distanceToSquared( boat.position ) - b.position.distanceToSquared( boat.position ) ).slice( 0, 1 + ( r() < 0.5 ? 1 : 0 ) );
				riders.forEach( ( m, k ) => { m.boat = true; m.berth = k; m.rideT = 30 + r() * 60; } );
				this.boatCooldown = 150 + r() * 90;

			}

			for ( const m of this.members ) if ( m.boat && ( ( m.rideT -= dt ) < 0 || ! boat || boat.speed < 2.5 ) ) { m.boat = false; m.berth = - 1; }

		} else {

			this.rideT -= dt;
			this.anchor.copy( ferry ? ferry.position : this.anchor );
			if ( ! ferry || this.rideT < 0 || ferry.speed < 2 ) this._endRide();
			else if ( ( this.swapT -= dt ) < 0 ) {

				// two riders swap places in the bow wave
				this.swapT = 6 + r() * 8;
				const a = this.members[ Math.floor( r() * this.members.length ) ], b = this.members[ Math.floor( r() * this.members.length ) ];
				if ( a !== b ) [ a.berth, b.berth ] = [ b.berth, a.berth ];

			}

		}

	}

	_startRide() {

		this.mode = 'ride';
		this.rideT = 60 + this.rand() * 120;
		this.swapT = 6;
		this.members.forEach( ( m, i ) => { m.berth = i % 6; m.boat = false; m.breathT = Math.min( m.breathT, 6 + this.rand() * 14 ); } );

	}

	_endRide() {

		this.mode = 'roam';
		this.cooldown = 80 + this.rand() * 60;
		let x = 0, z = 0;
		for ( const m of this.members ) { x += m.position.x; z += m.position.z; m.berth = - 1; }
		this.anchor.set( x / this.members.length, 0, z / this.members.length );
		this.u = this._nearestU( this.anchor.x, this.anchor.z );
		this.travel = CRUISE;

	}

	// ---------------------------------------------------------------- the player's jetski
	// Who goes with the ski and how. Roles: 'bow' (in the pressure wave just off either side of the
	// bow), 'side' (porpoising abreast), 'wake' (behind, leaping across the wake arms), 'drop' (the ski
	// is faster than a dolphin: falling back in the wake, leaping, until they give up), 'circle' (the
	// ski has stopped: a slow curious circle and a breath beside it).
	_skiDecide( dt, ski ) {

		const r = this.rand, S = this.skiStats;
		this.skiCooldown -= dt; this.turnCD -= dt;
		let n = 0;
		for ( const m of this.members ) if ( m.ski ) n ++;
		if ( ! ski || this.mode !== 'roam' ) {

			for ( const m of this.members ) if ( m.ski ) this._skiLeave( m, ski ? 'ferry' : 'ski gone' );
			this.stopT = 0; this.fastT = 0;
			return;

		}

		const sp = Math.hypot( ski.velocity.x, ski.velocity.z ), px = ski.position.x, pz = ski.position.z;
		this.stopT = sp < SKI_STOP ? this.stopT + dt : 0;
		this.fastT = sp > SKI_TOP + 0.3 ? this.fastT + dt : 0;
		this.skiTurn += ( ( ski.yawRate || 0 ) - this.skiTurn ) * Math.min( 1, dt * 4 );
		const deep = this.water - this.floorAt( px, pz ) > 3.5; // never into the shallows after it
		const near = ( m ) => ( m.position.x - px ) ** 2 + ( m.position.z - pz ) ** 2;
		if ( ! n ) {

			if ( this.skiCooldown > 0 || ! deep ) return;
			const dPod = Math.hypot( px - this.anchor.x, pz - this.anchor.z );
			if ( dPod > RIDE_RANGE ) return;
			let k = 0, roles = null;
			// under way at a pace they can hold (or racing past close by: they give chase)
			if ( sp > SKI_JOIN && ( sp < SKI_TOP || dPod < 80 ) ) { k = 2 + Math.floor( r() * 3 ); roles = [ 'bow', 'bow', 'side', 'wake' ]; }
			else if ( this.stopT > 2 && dPod < 160 ) { k = 1 + ( r() < 0.5 ? 1 : 0 ); roles = [ 'circle', 'circle' ]; }
			if ( ! k ) return;
			const go = this.members.filter( ( m ) => ! m.boat && near( m ) < 250 * 250 ).sort( ( a, b ) => near( a ) - near( b ) ).slice( 0, k );
			if ( ! go.length ) return;
			go.forEach( ( m, i ) => this._skiJoin( m, roles[ i ], i, ski, sp >= SKI_TOP ) );
			S.joins ++; S.joined = go.length; S.maxRiders = Math.max( S.maxRiders, go.length );
			if ( roles[ 0 ] === 'circle' ) S.circles ++;
			return;

		}

		let circling = 0;
		for ( const m of this.members ) {

			if ( ! m.ski ) continue;
			const d = Math.sqrt( near( m ) );
			m.skiT += dt; m.spSum += sp * dt;
			if ( d < 14 ) m.withT += dt;
			m.crossT -= dt;
			// the harder the pace, the sooner they tire of it
			m.rideT -= dt * ( 1 + 1.5 * clamp( ( sp - 4 ) / ( SKI_TOP - 4 ), 0, 1 ) );
			if ( m.ski === 'drop' ) {

				m.dropT += dt;
				if ( sp < SKI_TOP - 0.6 && d < 40 ) { m.ski = m.skiRole; m.dropT = 0; } // it slowed: back in
				else if ( m.dropT > m.dropMax || d > 90 ) { this._skiLeave( m, 'outpaced' ); continue; }

			} else if ( this.fastT > 1 && m.ski !== 'circle' ) { m.ski = 'drop'; m.dropT = 0; m.dropMax = 7 + r() * 7; m.leapT = Math.min( m.leapT, 0.8 + r() * 1.5 ); }
			if ( m.ski === 'circle' && sp > SKI_JOIN ) m.ski = m.skiRole === 'circle' ? 'side' : m.skiRole;
			if ( m.rideT < 0 || d > 300 || ! deep ) { this._skiLeave( m, m.rideT < 0 ? 'tired' : d > 300 ? 'lost it' : 'shallows' ); continue; }
			if ( m.ski === 'circle' ) circling ++;

		}

		// the ski stops: one or two stay and circle it, curious; the rest go back to the pod
		if ( this.stopT > 2 && ! circling ) {

			const w = this.members.filter( ( m ) => m.ski ).sort( ( a, b ) => near( a ) - near( b ) );
			const keep = Math.min( w.length, 1 + ( r() < 0.5 ? 1 : 0 ) );
			w.forEach( ( m, i ) => { if ( i < keep ) this._skiCircle( m, i, ski ); else this._skiLeave( m, 'ski stopped' ); } );
			if ( keep ) S.circles ++;

		}

		// a sharp turn: riders on the outside cut across to the inside (ahead of the bow, behind the stern)
		if ( Math.abs( this.skiTurn ) > 0.55 && sp > 3 && this.turnCD <= 0 ) {

			const inside = this.skiTurn > 0 ? 1 : - 1;
			for ( const m of this.members ) if ( ( m.ski === 'bow' || m.ski === 'side' ) && m.side !== inside ) { m.side = inside; m.crossT = 1.8; S.cuts ++; }
			this.turnCD = 3;

		}

	}

	_skiJoin( m, role, i, ski, fast ) {

		const r = this.rand;
		m.skiRole = role; m.ski = fast && role !== 'circle' ? 'drop' : role;
		m.side = i % 2 ? - 1 : 1; m.rideT = 50 + r() * 60; m.skiT = 0; m.withT = 0; m.spSum = 0;
		m.dropT = 0; m.dropMax = 7 + r() * 7; m.crossT = 0; m.boat = false; m.berth = - 1;
		if ( role === 'circle' ) this._skiCircle( m, i, ski );

	}

	_skiCircle( m, i, ski ) {

		m.ski = 'circle'; m.skiRole = m.skiRole || 'circle';
		m.circR = 7 + 2.5 * i; m.circDir = i % 2 ? - 1 : 1;
		m.circA = Math.atan2( m.position.x - ski.position.x, m.position.z - ski.position.z );
		m.rideT = Math.max( m.rideT, 30 + this.rand() * 30 );
		m.breathT = Math.min( m.breathT, 3 + this.rand() * 6 ); // come up to breathe beside it

	}

	_skiLeave( m, why ) {

		const R = this.skiStats.rides;
		R.push( { role: m.skiRole, dur: + m.skiT.toFixed( 1 ), alongside: + m.withT.toFixed( 1 ), kmh: + ( m.spSum / Math.max( m.skiT, 1e-3 ) * 3.6 ).toFixed( 1 ), why } );
		if ( R.length > 24 ) R.shift();
		m.ski = null; m.skiRole = null; m.crossT = 0;
		const f = this.skiF, P = this.skiPos;
		m.side = ( m.position.x - P.x ) * f.z - ( m.position.z - P.z ) * f.x >= 0 ? 1 : - 1; m.peelT = 3;
		if ( ! this.members.some( ( o ) => o.ski ) ) this.skiCooldown = 30 + this.rand() * 30;

	}

	// goal and pace for a member with the ski (sets _g, _gv; returns [ depth, maxSpeed, accel ])
	_skiGoal( m, dt, ski ) {

		const f = this.skiF, px = ski.position.x, pz = ski.position.z;
		const wob = Math.sin( this.time * 0.5 + m.phase ), wob2 = Math.sin( this.time * 0.31 + m.phase * 1.7 );
		if ( m.ski === 'circle' ) {

			const w = 2.1;
			m.circA += m.circDir * w / m.circR * dt;
			_g.set( px + Math.sin( m.circA ) * m.circR, 0, pz + Math.cos( m.circA ) * m.circR );
			_gv.set( Math.cos( m.circA ), 0, - Math.sin( m.circA ) ).multiplyScalar( m.circDir * w );
			return [ 1.5 + 0.4 * wob2, 3.5, 1.4 ];

		}

		let ahead, lat, depth;
		if ( m.ski === 'bow' ) { ahead = 5.3 + 0.5 * wob2 + ( m.crossT > 0 ? 2.4 : 0 ); lat = m.side * ( 1.7 + 0.3 * wob ); depth = 1.15 + 0.2 * wob2; }
		else if ( m.ski === 'side' ) { ahead = m.crossT > 0 ? - 6 : 0.6 + 1.2 * wob2; lat = m.side * ( 3.4 + 0.5 * wob ); depth = 1.2; }
		else if ( m.ski === 'wake' ) { ahead = - 9.5 - 2 * wob2; lat = m.side * 2.6; depth = 1.3; }
		else { ahead = - 10; lat = m.side * 2.4; depth = 1.1; } // drop
		// in the ski's path ahead of it (it is coming up on them): step aside off its track first
		const rx = m.position.x - px, rz = m.position.z - pz, al = rx * f.x + rz * f.z, ac = rx * f.z - rz * f.x;
		if ( m.ski !== 'bow' && al > 2 && Math.abs( ac ) < 5 ) { m.side = ac >= 0 ? 1 : - 1; ahead = al; lat = m.side * 6; depth = Math.max( depth, 1.6 ); }
		_g.set( px + f.x * ahead + f.z * lat, 0, pz + f.z * ahead - f.x * lat );
		_gv.copy( ski.velocity ); _gv.y = 0;
		// racing in from astern or abeam: aim where the ski will be (never lead one it is coming at)
		const dd = Math.hypot( _g.x - m.position.x, _g.z - m.position.z );
		const astern = ( m.position.x - px ) * f.x + ( m.position.z - pz ) * f.z < 0;
		if ( dd > 20 && astern ) _g.addScaledVector( _gv, Math.min( dd / SKI_TOP, 6 ) );
		return [ depth, SKI_TOP, 2.2 ];

	}

	// clear water between a dolphin and the ski's hull: the least over its snout, mid-body and
	// notch (horizontal and full), and the push away from the hull when it is too close
	_skiClear( m, ski, push ) {

		const f = this.skiF, sy = Math.sin( m.yaw ), cy = Math.cos( m.yaw ), sp = Math.sin( m.pitch );
		let best = Infinity, bestH = Infinity, ax = 0, az = 0;
		for ( const o of this.body ) {

			const hx = m.position.x + sy * o - ski.position.x, hz = m.position.z + cy * o - ski.position.z;
			const y = m.position.y + sp * o;
			const lz = hx * f.x + hz * f.z, lx = hx * f.z - hz * f.x; // along the ski, across it
			const dx = Math.max( Math.abs( lx ) - HULL_X, 0 ), dz = Math.max( Math.abs( lz ) - HULL_Z, 0 );
			const dy = Math.max( this.skiW - HULL_D - y, y - ( this.skiW + HULL_UP ), 0 );
			const h = Math.hypot( dx, dz ) - GIRTH, c = Math.hypot( dx, dz, dy ) - GIRTH;
			if ( c < best ) best = c;
			if ( h < bestH ) { bestH = h; ax = lx >= 0 ? 1 : - 1; az = dz > dx ? ( lz >= 0 ? 1 : - 1 ) : 0; }

		}

		if ( push ) {

			// where the root will be relative to the ski within the next 1.2 s (both moving): inside
			// the body's length plus KEEP of the hull, dodge out across the ski's line (or off its
			// ends) and go under it
			const hx = m.position.x - ski.position.x, hz = m.position.z - ski.position.z;
			const rvx = m.velocity.x - ski.velocity.x, rvz = m.velocity.z - ski.velocity.z, rv2 = rvx * rvx + rvz * rvz;
			const tc = rv2 > 1e-4 ? clamp( - ( hx * rvx + hz * rvz ) / rv2, 0, 1.6 ) : 0;
			let h = Infinity, bx = 1, bz = 0;
			for ( const o of this.body ) {

				const qx = hx + sy * o + rvx * tc, qz = hz + cy * o + rvz * tc;
				const lz = qx * f.x + qz * f.z, lx = qx * f.z - qz * f.x;
				const dx = Math.max( Math.abs( lx ) - HULL_X, 0 ), dz = Math.max( Math.abs( lz ) - HULL_Z, 0 );
				const hh = Math.hypot( dx, dz );
				if ( hh < h ) { h = hh; bx = lx >= 0 ? 1 : - 1; bz = dz > dx ? ( lz >= 0 ? 1 : - 1 ) : 0; }

			}

			const R = KEEP + GIRTH + 0.6;
			push.w = h;
			if ( h < R ) {

				const k = ( R - h ) * 4;
				push.x += ( f.z * bx + f.x * bz ) * k; push.z += ( - f.x * bx + f.z * bz ) * k;
				push.y = ( R - h ) * 1.2;

			}

		}

		return [ best, bestH ];

	}

	// goal and pace for one member, then the swim: velocity eased toward the goal, vertical plan,
	// breaths, leaps, rolls, stroke
	_steer( m, dt, ferry, boat, ski ) {

		const r = m.rand;
		let depth, maxSpeed, accel, riding = false, skiR = null;
		if ( m.boat && boat ) {

			boat.forward( _f );
			const lat = m.berth === 0 ? 1.1 : - 1.1;
			_g.set( boat.position.x + _f.x * 6.2 + _f.z * lat, 0, boat.position.z + _f.z * 6.2 - _f.x * lat );
			_gv.copy( boat.velocity ); _gv.y = 0;
			m.water = this.boatWater;
			depth = 0.8 + 0.3 * Math.sin( this.time * 0.4 + m.phase );
			maxSpeed = Math.min( 10.5, boat.speed + 5 ); accel = 2.5; riding = true;

		} else if ( this.mode === 'ride' && ferry && m.berth >= 0 ) {

			const b = BERTHS[ m.berth % 3 ], sg = m.berth < 3 ? 1 : - 1;
			const wob = Math.sin( this.time * 0.5 + m.phase ), wob2 = Math.sin( this.time * 0.31 + m.phase * 1.7 );
			ferry.toWorld( _l.set( sg * ( STEM_X + b[ 0 ] + 0.4 * wob ), 0, STEM_Z + b[ 1 ] + 0.8 * wob2 ), _g );
			_gv.copy( ferry.velocity ); _gv.y = 0;
			m.water = this.water;
			depth = b[ 2 ] + 0.35 * wob2;
			maxSpeed = Math.min( 10.5, ferry.speed + 5 ); accel = 2.2; riding = true;

		} else if ( m.ski && ski ) {

			[ depth, maxSpeed, accel ] = this._skiGoal( m, dt, ski );
			m.water = this.skiW;
			skiR = m.ski;
			riding = skiR === 'bow' && Math.hypot( ski.velocity.x, ski.velocity.z ) > 3; // gliding in the bow wave

		} else {

			const yaw = this._routeYaw( this.u );
			const t = this.time * 0.07 + m.phase;
			_v.set( m.offset.x + 3 * Math.sin( t ), 0, m.offset.z + 4 * Math.sin( t * 0.7 + 1 ) ).applyAxisAngle( _l.set( 0, 1, 0 ), yaw );
			_g.copy( this.anchor ).add( _v );
			_gv.set( Math.sin( yaw ), 0, Math.cos( yaw ) ).multiplyScalar( this.travel );
			m.water = this.water;
			depth = m.cruiseDepth;
			maxSpeed = 7.5; accel = 1.2;
			// just left the jetski: peel off outward at its pace first, then home (never back across its bow)
			if ( m.peelT > 0 && ski ) {

				m.peelT -= dt;
				const f = this.skiF;
				_g.copy( m.position ); _gv.set( ski.velocity.x * 0.7 + f.z * m.side * 3, 0, ski.velocity.z * 0.7 - f.x * m.side * 3 );
				m.water = this.skiW; accel = 2.5;

			}

		}

		// horizontal: goal velocity plus a pull onto the goal, capped
		const p = m.position, v = m.velocity;
		_v.set( _g.x - p.x, 0, _g.z - p.z );
		const dist = _v.length();
		const far = ( riding || ( skiR && skiR !== 'circle' ) ) && dist > 22;
		_v.multiplyScalar( riding || skiR ? ( skiR === 'circle' ? 0.6 : 0.9 ) : 0.35 ).add( _gv );
		let sp = _v.length();
		if ( sp > maxSpeed ) _v.multiplyScalar( maxSpeed / sp );
		// never into the ski's hull: clear water steered for round it (any member, not only riders)
		let nearSki = false, holdDown = 0;
		if ( ski && ( m.position.x - ski.position.x ) ** 2 + ( m.position.z - ski.position.z ) ** 2 < 400 ) {

			nearSki = true;
			_l.set( 0, 0, 0 );
			const [ c, ch ] = this._skiClear( m, ski, _l );
			const S = this.skiStats;
			if ( c < S.minClear ) {

				const hx = p.x - ski.position.x, hz = p.z - ski.position.z, f = this.skiF;
				S.minClear = c;
				S.minAt = { role: m.ski || 'pod', state: m.state, t: + this.time.toFixed( 1 ), along: + ( hx * f.x + hz * f.z ).toFixed( 2 ), across: + ( hx * f.z - hz * f.x ).toFixed( 2 ), depth: + ( this.skiW - p.y ).toFixed( 2 ), hd: + wrap( m.yaw - Math.atan2( f.x, f.z ) ).toFixed( 2 ), dodge: + ( _l.w ?? - 1 ).toFixed( 2 ) };

			}
			if ( ch < S.minClearH ) S.minClearH = ch;
			_v.x += _l.x; _v.z += _l.z; holdDown = _l.y;
			if ( _l.y > 0 ) accel = Math.max( accel, 4 ); // a quick dodge
			if ( Math.min( ch, _l.w ) < KEEP ) { m.breathT = Math.max( m.breathT, 0.5 ); m.leapT = Math.max( m.leapT, 0.5 ); } // no breath or leap under the hull

		}

		sp = _v.length();
		if ( sp > 10.5 ) _v.multiplyScalar( 10.5 / sp ); // the dodge on top of the pace, to a burst's limit
		if ( m.state !== 'leap' || ! m.air ) {

			const k = Math.min( 1, dt * accel );
			v.x += ( _v.x - v.x ) * k; v.z += ( _v.z - v.z ) * k;

		}

		const hs = Math.hypot( v.x, v.z );
		const floor = this.floorAt( p.x, p.z );

		// ---- breaths, leaps and rolls
		m.breathT -= dt; m.leapT -= dt;
		if ( m.state === 'swim' ) {

			if ( m.breathT < 0 && m.depth < 1.3 ) {

				m.state = 'breathe'; m.seqT = 0; m.seqDur = clamp( 4.2 / Math.max( hs, 1 ), 0.8, 2.2 ); m.puffDue = true;
				m.y0 = p.y - m.water;
				m.breathT = riding || skiR ? 12 + r() * 13 : 20 + r() * 20;
				if ( nearSki ) this.skiStats.breathsNear ++;

			} else if ( m.leapT < 0 && m.depth > 0.9 && m.water - floor > 4 && ( hs > 4.2 || far ) ) {

				// porpoising: racing in to a bow, fast travel, or clearing the bow wave now and then
				// with the ski: abreast, in the wake and dropping back they leap often (across the wake arms)
				const leapy = skiR === 'side' || skiR === 'wake' || skiR === 'drop';
				if ( far || ( ! riding && ! skiR && this.sprint ) || r() < ( leapy ? 0.85 : 0.35 ) ) {

					m.state = 'leap'; m.air = false; m.seqT = 0;
					if ( skiR === 'wake' || skiR === 'drop' ) m.side = - m.side;

				}

				m.leapT = far ? 1.5 + r() * 2 : skiR === 'drop' ? 1.2 + r() * 2 : leapy ? 2.5 + r() * 4 : riding ? 14 + r() * 20 : 3 + r() * 6;

			}

		}

		if ( riding && ! far ) {

			m.rollT -= dt;
			if ( m.rollT < 0 ) { m.rollTarget = m.rollTarget === 0 && r() < 0.45 ? ( r() < 0.5 ? 1 : - 1 ) * ( 1.0 + 0.5 * r() ) : 0; m.rollT = m.rollTarget ? 2 + r() * 2 : 4 + r() * 8; }

		} else m.rollTarget = 0;

		// ---- vertical
		let archT = 0;
		if ( m.state === 'breathe' ) {

			// a rolling surfacing: the head rises and the blowhole clears, the back arches over, down
			m.seqT += dt;
			const T = m.seqDur, s = clamp( m.seqT / T, 0, 1 );
			const start = Math.min( m.y0, - 0.9 ), peak = riding ? - 0.02 : - 0.1;
			const yRel = start + ( peak - start ) * Math.sin( Math.PI * s ) - 0.35 * s;
			const dy = ( ( peak - start ) * Math.cos( Math.PI * s ) * Math.PI - 0.35 ) / T;
			const vyT = dy + ( m.water + yRel - p.y ) * 5;
			v.y += ( vyT - v.y ) * Math.min( 1, dt * 10 );
			archT = - 0.05 * Math.sin( Math.PI * s ) * ( s > 0.35 ? 1 : 0.3 );
			if ( s >= 1 ) m.state = 'swim';

		} else if ( m.state === 'leap' ) {

			if ( ! m.air ) {

				v.y += ( 5.2 - v.y ) * Math.min( 1, dt * 3.5 );
				m.seqT += dt;
				if ( p.y > m.water - 0.35 ) { m.air = true; m.splashes ++; if ( nearSki ) this.skiStats.leapsNear ++; }
				if ( m.seqT > 2.5 ) m.state = 'swim';

			} else {

				v.y -= G * dt;
				archT = - 0.03;
				if ( p.y < m.water - 0.25 && v.y < 0 ) { m.air = false; m.state = 'swim'; m.splashes ++; }

			}

		} else {

			// a breath is due: come up under the surface first
			const yT = Math.max( m.water - ( m.breathT < 0 ? Math.min( depth, 1.0 ) : depth ) - holdDown, floor + 0.9 );
			const vyT = clamp( ( yT - p.y ) * 1.2, holdDown > 0 ? - 3.5 : - 2, 2 ); // a dodge dives fast
			v.y += ( vyT - v.y ) * Math.min( 1, dt * ( holdDown > 0 ? 6 : 3 ) );

		}

		p.addScaledVector( v, dt );
		if ( p.y < floor + 0.6 ) { p.y = floor + 0.6; v.y = Math.max( v.y, 0 ); }

		// ---- orientation from the motion
		if ( hs > 0.2 ) {

			const dy = wrap( Math.atan2( v.x, v.z ) - m.yaw ), mx = 2.6 * dt;
			const step = clamp( dy, - mx, mx );
			m.yaw += step;
			m.yawRate += ( step / dt - m.yawRate ) * Math.min( 1, dt * 4 );

		}

		const pT = clamp( Math.atan2( v.y, Math.max( hs, 0.6 ) ), - 1.2, 1.2 );
		m.pitch += ( pT - m.pitch ) * ( m.air ? 1 : Math.min( 1, dt * 6 ) );
		const bank = clamp( - m.yawRate * 0.3, - 0.6, 0.6 );
		m.roll += ( m.rollTarget + bank - m.roll ) * Math.min( 1, dt * 1.6 );
		m.arch += ( archT - m.arch ) * Math.min( 1, dt * 5 );
		m.orient();
		m.arc += v.length() * dt;
		m.record();

		// ---- stroke: beat rises with speed; gliding in a bow wave, a flick now and then
		const s3 = v.length();
		let ampT = 0.13 + 0.012 * s3, f = 0.7 + 0.3 * s3;
		if ( riding && ! far && m.state === 'swim' ) { const beat = Math.max( 0, Math.sin( this.time * 0.9 + m.phase ) ) ** 6; ampT = 0.03 + 0.12 * beat; f = 1.6; }
		if ( m.air ) { ampT = 0.03; f = 1.0; }
		m.strokeAmp += ( ampT - m.strokeAmp ) * Math.min( 1, dt * 2 );
		m.strokePhase += Math.PI * 2 * f * dt;
		m.wetAge = m.backDepth < 0.05 ? m.wetAge + dt : 0;

	}

}
