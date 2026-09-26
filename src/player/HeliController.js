import * as THREE from '../engine/index.js';
import { HELI } from '../world/HeliModel.js';
import { SPRAY } from '../fx/Spray.js';

const GRAV = 9.81;
const clamp = THREE.MathUtils.clamp;

const _e = new THREE.Euler( 0, 0, 0, 'YXZ' );
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _spray = new THREE.Vector3();

// Arcade flight model for the single-seat helicopter.
//
// The rotor spools up over a few seconds once the pilot is aboard; lift then holds a climb rate set
// by the collective (Space up, C down, neither: hover). The disc tilts with W / S (nose down /
// up) and A / D (roll), and the tilted lift accelerates the machine that way against linear +
// quadratic drag (~15 m/s cruising, ~20 m/s with Shift); with the stick centred it holds the hover.
// The mouse turns it (Player sets yaw).
// It lands on terrain, walkable colliders (the pier) and the sea; solid colliders push it away.
//
// Frame: `position` is the bottom of the skids; yaw 0 points the nose along -Z, like the player's
// view. tilt > 0 is nose down, roll > 0 is right side down.
export class HeliController {

	constructor( { model, terrain, colliders, query = null, spray = null, position, yaw = 0 } ) {

		this.model = model;
		this.terrain = terrain;
		this.colliders = colliders;
		this.query = query;
		this.spray = spray;

		this.position = new THREE.Vector3().copy( position );
		this.position.y = this.floorAt( this.position.x, this.position.z, this.position.y + 2, 0 );
		this.velocity = new THREE.Vector3();
		this.yaw = yaw;
		this.tilt = 0;
		this.roll = 0;
		this.spool = 0; // rotor speed 0..1
		this.occupied = false;
		this.grounded = true;
		this.waterH = 0;
		this.quaternion = new THREE.Quaternion();
		// set by the pilot each frame: fwd / side / climb in -1..1, boost
		this.controls = { fwd: 0, side: 0, climb: 0, boost: false };

		this.slot = null;
		if ( query ) {

			try {

				this.slot = query.allocate( 'heli', 1 );

			} catch ( e ) {

				// out of query slots: the pilot's own water query stands in while flying
				this.slot = null;

			}

		}

		this.apply();

	}

	get speed() {

		return Math.hypot( this.velocity.x, this.velocity.z );

	}

	// height above whatever is below (for the HUD / prompts)
	get altitude() {

		return this.position.y - this.floorAt( this.position.x, this.position.z, this.position.y + 0.5, this.waterH );

	}

	toWorld( local, out ) {

		return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position );

	}

	// highest of terrain, walkable colliders below maxY, and the sea surface
	floorAt( x, z, maxY, water ) {

		let g = Math.max( this.terrain.heightAt( x, z ), water );
		if ( this.colliders ) g = Math.max( g, this.colliders.groundHeightAt( x, z, maxY ) );
		return g;

	}

	// floor under the four skid ends (so it doesn't sink its toes into a slope)
	skidFloor( maxY ) {

		const s = Math.sin( this.yaw ), c = Math.cos( this.yaw ), S = HELI.skidHalf, p = this.position;
		let g = - Infinity;
		for ( const [ lx, lz ] of [ [ - S, - 1.0 ], [ S, - 1.0 ], [ - S, 1.0 ], [ S, 1.0 ] ] ) {

			// yaw about +Y: x' = x cos + z sin, z' = -x sin + z cos
			g = Math.max( g, this.floorAt( p.x + lx * c + lz * s, p.z - lx * s + lz * c, maxY, this.waterH ) );

		}

		return g;

	}

	queueQuery() {

		if ( this.slot !== null ) this.query.setPoint( this.slot, this.position.x, this.position.z );

	}

	readWater( fallback ) {

		const q = this.query;
		if ( this.slot !== null && q && q.cpuValid ) {

			const h = q.cpu[ this.slot * 4 ];
			if ( Number.isFinite( h ) ) return h;

		}

		return fallback ?? this.waterH;

	}

	update( dt, waterFallback ) {

		dt = Math.min( dt, 0.05 );
		this.waterH = this.readWater( this.occupied ? waterFallback : undefined );
		const c = this.occupied ? this.controls : { fwd: 0, side: 0, climb: 0, boost: false };

		// rotor: ~4 s to flying speed, winds down slower
		if ( this.occupied ) this.spool = Math.min( 1, this.spool + dt / 4 );
		else this.spool = Math.max( 0, this.spool - dt / 7 );
		const lift = this.spool * this.spool;

		// disc tilt follows the stick; level on the ground
		const maxTilt = c.boost ? 0.42 : 0.28;
		const flying = ! this.grounded || lift > 0.9;
		const tTilt = flying && ! this.grounded ? c.fwd * maxTilt : 0;
		const tRoll = flying && ! this.grounded ? c.side * maxTilt * 0.8 : 0;
		const kt = 1 - Math.exp( - dt * 3 );
		this.tilt += ( tTilt - this.tilt ) * kt;
		this.roll += ( tRoll - this.roll ) * kt;

		// vertical: lift holds the commanded climb rate (it can't beat gravity until spooled up)
		const v = this.velocity;
		const vyTarget = c.climb * ( c.boost ? 6 : 3.5 );
		let ay = lift * ( GRAV + clamp( ( vyTarget - v.y ) * 2.2, - 7, 7 ) ) - GRAV;
		if ( ! this.occupied ) ay = lift * GRAV * 0.9 - GRAV;
		// a little ground cushion just above the pad
		const alt = this.position.y - this.skidFloor( this.position.y + 0.5 );
		if ( alt < 1.5 && v.y < 0 ) ay += lift * ( 1.5 - alt ) * 1.2;

		// horizontal: the tilted lift vector, in the heading frame
		const sy = Math.sin( this.yaw ), cy = Math.cos( this.yaw );
		const aF = GRAV * Math.tan( this.tilt ) * lift, aS = GRAV * Math.tan( this.roll ) * lift;
		// forward (-sin, -cos), right (cos, -sin)
		let ax = - sy * aF + cy * aS;
		let az = - cy * aF - sy * aS;
		// stick centred: the (assisted) pilot holds the hover, bleeding off the drift
		const hs = Math.hypot( v.x, v.z );
		const hold = this.occupied && c.fwd === 0 && c.side === 0 ? 0.45 * lift : 0;
		ax -= v.x * ( 0.12 + hold + 0.005 * hs );
		az -= v.z * ( 0.12 + hold + 0.005 * hs );
		v.x += ax * dt;
		v.z += az * dt;
		v.y += ay * dt;
		v.y -= v.y * 0.15 * dt;

		const p = this.position;
		p.addScaledVector( v, dt );
		p.y = Math.min( p.y, 400 );

		// obstacles (houses, pier piles, the stalls): push the airframe out, bleed off the speed
		if ( this.colliders ) {

			_p.copy( p );
			if ( this.colliders.resolveCapsule( _p, 1.0, 2.4, 0.3 ) ) {

				_v.set( _p.x - p.x, 0, _p.z - p.z );
				const n = _v.length();
				if ( n > 1e-5 ) {

					_v.divideScalar( n );
					const into = v.x * _v.x + v.z * _v.z;
					if ( into < 0 ) { v.x -= _v.x * into * 1.3; v.z -= _v.z * into * 1.3; }

				}

				p.x = _p.x;
				p.z = _p.z;

			}

		}

		// ground / sea
		const floor = this.skidFloor( p.y + 0.5 );
		if ( p.y <= floor ) {

			p.y = floor;
			this.landingSpeed = Math.max( 0, - v.y );
			if ( v.y < 0 ) v.y = 0;
			this.grounded = true;
			const f = Math.exp( - dt * 5 );
			v.x *= f;
			v.z *= f;

		} else {

			// on the sea the passing waves drop away under the skids: still landed within a hand's breadth
			const onSea = floor <= this.waterH + 1e-3;
			this.grounded = p.y - floor < ( onSea ? 0.35 : 0.03 ) && v.y < 1;

		}

		this.model.spin( dt, this.spool );
		this.downwash();
		this.apply();

	}

	// mist blown off the water under the rotor when hovering low over the sea
	downwash() {

		if ( ! this.spray || this.spool < 0.5 ) return;
		const p = this.position;
		const over = p.y - this.waterH;
		if ( this.terrain.heightAt( p.x, p.z ) > this.waterH - 0.3 || over > 7 ) return;
		const k = ( this.spool - 0.5 ) * 2 * ( 1 - over / 7 );
		if ( k < 0.05 ) return;
		_spray.set( p.x, this.waterH + 0.1, p.z );
		this.spray.emit( _spray, _v.set( 0, 0.8, 0 ), Math.round( 14 * k ), 0.07, SPRAY.MIST, { spread: 3.5 * k + 0.8, jitter: 2.6, life: 1.6 } );

	}

	apply() {

		this.quaternion.setFromEuler( _e.set( - this.tilt, this.yaw, - this.roll ) );
		const g = this.model.group;
		g.position.copy( this.position );
		g.quaternion.copy( this.quaternion );
		g.updateMatrixWorld( true );

	}

}