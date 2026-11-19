import { dynamicPressure, SEA_WATER_DENSITY } from '../../physics/Loads.js';
import { SharkBite } from './SharkBite.js';

// Blacktip reef shark locomotion. Metres, seconds, radians; no renderer or wall clock.
// Size/anatomy: Florida Museum Carcharhinus melanopterus profile. Coefficients below
// are explicit control-model assumptions, not measured species performance or CFD.
export const SHARK = Object.freeze( {
	length: 1.5, cruiseSpeed: 0.85, burstSpeed: 2.4, mass: 10,
	step: 1 / 60, maxAcceleration: 1.1, dragCoefficient: 0.25, frontalArea: 0.055,
	maxTurnRate: 0.8, turnAcceleration: 1.6, lateralAcceleration: 1.2,
	currentResponse: 0.8, verticalAcceleration: 0.65, verticalSpeed: 0.75,
	surfaceClearance: 0.5, floorClearance: 0.65, habitatDepth: 2.5,
} );

const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const finite = ( x, fallback = 0 ) => Number.isFinite( x ) ? x : fallback;
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const random = seed => () => {
	seed = ( seed + 0x6D2B79F5 ) | 0;
	let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
	t ^= t + Math.imul( t ^ t >>> 7, 61 | t );
	return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;
};

export class SharkBrain {
	constructor( { terrain = null, waterAt = () => ( {} ), count = 3, seed = 7319,
		home = { x: - 78, z: 72 }, route = null, initial = null } = {} ) {
		this.terrain = terrain;
		this.waterAt = waterAt;
		this.seed = seed;
		this.count = clamp( Math.trunc( finite( count, 3 ) ), 1, 8 );
		this.home = { x: finite( home.x ), z: finite( home.z ) };
		this.route = route?.map( p => ( { x: p.x, z: p.z } ) ) ?? null;
		this.initial = initial?.map( p => ( { ...p } ) ) ?? null;
		this.bite = new SharkBite();
		this.reset();
	}

	floorAt( x, z ) { return finite( this.terrain?.heightAt( x, z ), - 30 ); }
	water( x, z, i = 0 ) {
		const w = this.waterAt( x, z, this.time, i ) || {};
		return { height: finite( w.height ), ux: clamp( finite( w.ux ), - 35, 35 ),
			uz: clamp( finite( w.uz ), - 35, 35 ), disturbance: Math.max( 0, finite( w.disturbance ) ) };
	}

	reset() {
		this.bite.reset();
		this.time = 0; this.accumulator = 0; this.droppedTime = 0;
		const rand = random( this.seed );
		this.members = Array.from( { length: this.count }, ( _, i ) => {
			const initial = this.initial?.[ i ];
			let x = initial?.x ?? this.home.x + i * 4;
			let z = initial?.z ?? this.home.z + i * 2;
			// Spawn/reset alone may place an individual. Updates only integrate bounded motion.
			if ( ! initial ) {
				let found = false;
				for ( let ring = 0; ring <= 24 && ! found; ring ++ ) {
					for ( let j = 0; j < Math.max( 1, ring * 8 ); j ++ ) {
						const a = j * Math.PI * 2 / Math.max( 1, ring * 8 );
						const sx = x + Math.sin( a ) * ring * 2, sz = z + Math.cos( a ) * ring * 2;
						if ( this.water( sx, sz, i ).height - this.floorAt( sx, sz ) > 4 ) { x = sx; z = sz; found = true; break; }
					}
				}
			}
			const w = this.water( x, z, i );
			const preferredDepth = 2.0 + i * 0.35 + rand() * 0.3;
			const y = initial?.y ?? clamp( w.height - preferredDepth, this.floorAt( x, z ) + SHARK.floorClearance + 0.2, w.height - SHARK.surfaceClearance - 0.2 );
			const yaw = initial?.yaw ?? 0.75 + rand() * 0.3;
			const speed = initial?.speed ?? SHARK.cruiseSpeed;
			return { id: i, x, y, z, vx: Math.sin( yaw ) * speed, vy: 0, vz: Math.cos( yaw ) * speed,
				yaw, yawRate: 0, pitch: 0, bank: 0, speed, acceleration: 0,
				currentX: 0, currentZ: 0, waterHeight: w.height, depth: w.height - y,
				floorClearance: y - this.floorAt( x, z ), preferredDepth,
				length: 1.5 - i * 0.08, phase: rand() * Math.PI * 2, tailHz: 0.9,
				waypoint: i % ( this.route?.length || 12 ), routePhase: rand() * 0.3,
				jawAngle: 0, jawVelocity: 0, bitePhase: 'idle', impulseX: 0, impulseY: 0, impulseZ: 0,
				panic: 0, mode: 'cruise', blocked: false, thrust: 0, drag: 0,
				spawnX: x, spawnZ: z, travelled: 0 };
		} );
		return this.state();
	}

	beginBite() {
		const m = this.members[ 0 ];
		if ( m.panic > 0 ) return false;
		return this.bite.start( m );
	}

	state() {
		return { time: this.time, count: this.members.length, droppedTime: this.droppedTime,
			bite: this.bite.state(), members: this.members.map( m => ( { ...m, current: { x: m.currentX, z: m.currentZ } } ) ) };
	}

	update( dt, { obstacles = [], paused = false } = {} ) {
		if ( paused || ! Number.isFinite( dt ) || dt <= 0 ) return;
		// A suspended browser cannot fast-forward wildlife through the shore on resume.
		this.droppedTime += Math.max( 0, dt - 0.25 );
		this.accumulator += Math.min( dt, 0.25 );
		while ( this.accumulator + 1e-10 >= SHARK.step ) {
			this.accumulator -= SHARK.step;
			this.time += SHARK.step;
			const target = this.bite.target;
			this.bite.advanceTarget( SHARK.step, this.water( target.position.x, target.position.z ), this.floorAt( target.position.x, target.position.z ) );
			for ( const m of this.members ) this.stepMember( m, SHARK.step, obstacles );
		}
	}

	goal( m ) {
		if ( this.route?.length ) return this.route[ m.waypoint ];
		const a = m.waypoint / 12 * Math.PI * 2 + m.routePhase;
		return { x: m.spawnX + Math.sin( a ) * 19, z: m.spawnZ + Math.cos( a ) * 14 };
	}

	stepMember( m, dt, obstacles ) {
		const previousPose = { ...m };
		const w = this.water( m.x, m.z, m.id ), oldX = m.x, oldY = m.y, oldZ = m.z;
		m.waterHeight = w.height;
		const strong = Math.hypot( w.ux, w.uz ) > 1.8 || w.disturbance > 0.65;
		m.panic = strong ? 8 : Math.max( 0, m.panic - dt );
		if ( m.id === 0 && strong ) this.bite.cancel();
		const feeding = m.id === 0 && this.bite.active && this.bite.result === 'pending';
		let goal = feeding ? this.bite.target.position : this.goal( m );
		if ( ! feeding && Math.hypot( goal.x - m.x, goal.z - m.z ) < 3 ) {
			m.waypoint = ( m.waypoint + 1 ) % ( this.route?.length || 12 ); goal = this.goal( m );
		}
		let dx = goal.x - m.x, dz = goal.z - m.z, len = Math.hypot( dx, dz ) || 1;
		dx /= len; dz /= len;
		let hazard = false;
		const avoid = ( ox, oz, radius, ovx = 0, ovz = 0 ) => {
			// Predict a hull's closest approach while this shark can still turn.
			const rx = ox - m.x, rz = oz - m.z;
			const rvx = ovx - m.vx, rvz = ovz - m.vz;
			const t = clamp( - ( rx * rvx + rz * rvz ) / ( rvx * rvx + rvz * rvz || 1 ), 0, 3 );
			const px = rx + rvx * t, pz = rz + rvz * t;
			const d = Math.hypot( px, pz ), range = radius + 5;
			if ( d < range ) {
				const weight = ( 1 - d / range ) * 8;
				// Keep a consistent port-side turn for head-on or exactly overlapping approaches.
				const ax = d > 0.01 ? - px / d : - Math.cos( m.yaw );
				const az = d > 0.01 ? - pz / d : Math.sin( m.yaw );
				dx += ax * weight - Math.cos( m.yaw ) * weight * 0.35;
				dz += az * weight + Math.sin( m.yaw ) * weight * 0.35;
				hazard = true;
			}
		};
		for ( const o of obstacles ) {
			if ( ! Number.isFinite( o.x ) || ! Number.isFinite( o.z ) ) continue;
			if ( Number.isFinite( o.bottom ) && m.y < o.bottom - 1.0 ) continue;
			if ( Number.isFinite( o.top ) && m.y > o.top + 1.0 ) continue;
			avoid( o.x, o.z, Math.max( 0.4, finite( o.radius, 1 ) ), finite( o.vx ), finite( o.vz ) );
		}
		for ( const other of this.members ) if ( other !== m && Math.abs( other.y - m.y ) < 1.0 && ( ! feeding || Math.hypot( other.x - m.x, other.z - m.z ) < 2 ) ) avoid( other.x, other.z, 0.5, other.vx, other.vz );
		// A ring ahead of the body senses both shallow water and rising submerged terrain.
		const look = 5 + m.speed * 3 + Math.hypot( m.currentX, m.currentZ ) * 2;
		for ( const angle of [ - 0.9, - 0.45, 0, 0.45, 0.9 ] ) {
			const a = m.yaw + angle, sx = Math.sin( a ), sz = Math.cos( a );
			const floor = this.floorAt( m.x + sx * look, m.z + sz * look );
			if ( w.height - floor < SHARK.habitatDepth || floor > m.y - SHARK.floorClearance ) {
				dx -= sx * 3.2; dz -= sz * 3.2; hazard = true;
			}
		}
		if ( m.panic > 0 ) {
			// Flee towards deeper water, with a small cross-current escape component.
			const gx = this.floorAt( m.x - 4, m.z ) - this.floorAt( m.x + 4, m.z );
			const gz = this.floorAt( m.x, m.z - 4 ) - this.floorAt( m.x, m.z + 4 );
			const g = Math.hypot( gx, gz );
			if ( g > 0.05 ) { dx += gx / g * 4; dz += gz / g * 4; }
			dx += w.uz * 0.3; dz -= w.ux * 0.3;
		}
		const desiredYaw = Math.atan2( dx, dz );
		const maxTurn = Math.min( SHARK.maxTurnRate, SHARK.lateralAcceleration / Math.max( m.speed, 0.2 ) );
		const desiredRate = clamp( wrap( desiredYaw - m.yaw ) * 1.6, - maxTurn, maxTurn );
		m.yawRate += clamp( desiredRate - m.yawRate, - SHARK.turnAcceleration * dt, SHARK.turnAcceleration * dt );
		m.yawRate = clamp( m.yawRate, - maxTurn, maxTurn );
		m.yaw = wrap( m.yaw + m.yawRate * dt );
		m.mode = m.panic > 0 ? 'flee' : hazard ? 'avoid' : feeding ? 'bite' : 'cruise';
		const targetSpeed = m.panic > 0 ? SHARK.burstSpeed : hazard ? 0.62 : feeding ? ( Math.hypot( goal.x - m.x, goal.z - m.z ) > 1.15 ? 0.85 : 0.45 ) : SHARK.cruiseSpeed;
		m.thrust = dynamicPressure( targetSpeed, SEA_WATER_DENSITY ) * SHARK.dragCoefficient * SHARK.frontalArea;
		m.drag = dynamicPressure( m.speed, SEA_WATER_DENSITY ) * SHARK.dragCoefficient * SHARK.frontalArea;
		m.acceleration = clamp( ( m.thrust - m.drag ) / SHARK.mass, - SHARK.maxAcceleration, SHARK.maxAcceleration );
		const oldSpeed = m.speed;
		m.speed = clamp( m.speed + m.acceleration * dt, 0, SHARK.burstSpeed );
		const speed = ( oldSpeed + m.speed ) * 0.5;
		// Closed-form entrainment. Integrating the same exponential gives displacement,
		// so constant-current tests have a genuinely independent analytic expectation.
		const decay = Math.exp( - dt / SHARK.currentResponse );
		const cx = w.ux * dt + ( m.currentX - w.ux ) * SHARK.currentResponse * ( 1 - decay );
		const cz = w.uz * dt + ( m.currentZ - w.uz ) * SHARK.currentResponse * ( 1 - decay );
		m.currentX = w.ux + ( m.currentX - w.ux ) * decay;
		m.currentZ = w.uz + ( m.currentZ - w.uz ) * decay;
		const floor = this.floorAt( m.x, m.z );
		const low = floor + SHARK.floorClearance + 0.25, high = w.height - SHARK.surfaceClearance - 0.25;
		const targetY = low <= high ? clamp( feeding ? this.bite.target.position.y + 0.073 : w.height - m.preferredDepth - ( m.panic > 0 ? 0.65 : 0 ), low, high ) : ( low + high ) * 0.5;
		let desiredVY = clamp( ( targetY - m.y ) * 1.0, - SHARK.verticalSpeed, SHARK.verticalSpeed );
		// Braking-distance envelopes start before contact with either boundary.
		const riseRoom = Math.max( 0, w.height - SHARK.surfaceClearance - m.y );
		const fallRoom = Math.max( 0, m.y - floor - SHARK.floorClearance );
		desiredVY = clamp( desiredVY, - Math.sqrt( 2 * SHARK.verticalAcceleration * fallRoom ), Math.sqrt( 2 * SHARK.verticalAcceleration * riseRoom ) );
		const oldVY = m.vy;
		m.vy += clamp( desiredVY - m.vy, - SHARK.verticalAcceleration * dt, SHARK.verticalAcceleration * dt );
		let nx = m.x + Math.sin( m.yaw ) * speed * dt + cx;
		let nz = m.z + Math.cos( m.yaw ) * speed * dt + cz;
		let ny = m.y + ( oldVY + m.vy ) * 0.5 * dt;
		// Equal/opposite target-contact impulse decays through a small added drag term.
		const impulseIntegral = SHARK.currentResponse * ( 1 - decay );
		nx += m.impulseX * impulseIntegral; ny += m.impulseY * impulseIntegral; nz += m.impulseZ * impulseIntegral;
		m.impulseX *= decay; m.impulseY *= decay; m.impulseZ *= decay;
		// Sweep at <= 20 cm intervals. On contact advance only to the last safe point;
		// no teleport/reposition recovery, and a hard shore cannot be tunneled through.
		const distance = Math.hypot( nx - m.x, ny - m.y, nz - m.z );
		const steps = Math.max( 1, Math.ceil( distance / 0.2 ) );
		let fraction = 0;
		for ( let k = 1; k <= steps; k ++ ) {
			const t = k / steps, x = oldX + ( nx - oldX ) * t, z = oldZ + ( nz - oldZ ) * t, y = oldY + ( ny - oldY ) * t;
			let safe = true;
			for ( const ahead of [ - 0.7, 0, 0.55 ] ) {
				if ( y - this.floorAt( x + Math.sin( m.yaw ) * ahead, z + Math.cos( m.yaw ) * ahead ) < SHARK.floorClearance - 1e-6 ) safe = false;
			}
			for ( const o of obstacles ) if ( Number.isFinite( o.x ) && Number.isFinite( o.z ) &&
				( ! Number.isFinite( o.bottom ) || y > o.bottom - 0.35 ) && ( ! Number.isFinite( o.top ) || y < o.top + 0.35 ) &&
				Math.hypot( x - o.x, z - o.z ) < finite( o.radius, 1 ) + 0.45 ) safe = false;
			if ( ! safe ) break;
			fraction = t;
		}
		m.blocked = fraction < 1;
		m.x = oldX + ( nx - oldX ) * fraction; m.z = oldZ + ( nz - oldZ ) * fraction;
		// Surface constraint only stops new upward movement; fast drawdown is physically
		// allowed to expose a fish temporarily rather than snapping it below the water.
		if ( ny > w.height - SHARK.surfaceClearance && ny > oldY ) ny = Math.max( oldY, w.height - SHARK.surfaceClearance );
		m.y = oldY + ( ny - oldY ) * fraction;
		m.vx = ( m.x - oldX ) / dt; m.vz = ( m.z - oldZ ) / dt;
		if ( m.blocked ) { m.vy = 0; m.mode = 'avoid'; }
		m.depth = w.height - m.y; m.floorClearance = m.y - this.floorAt( m.x, m.z );
		m.pitch += ( Math.atan2( m.vy, Math.max( m.speed, 0.2 ) ) - m.pitch ) * ( 1 - Math.exp( - dt * 3 ) );
		m.bank += ( clamp( - Math.atan2( m.speed * m.yawRate, 9.81 ), - 0.28, 0.28 ) - m.bank ) * ( 1 - Math.exp( - dt * 3 ) );
		m.tailHz = 0.65 + m.speed / m.length * 0.65;
		m.phase = ( m.phase + dt * m.tailHz * Math.PI * 2 ) % ( Math.PI * 2 );
		m.travelled += Math.hypot( m.x - oldX, m.y - oldY, m.z - oldZ );
		if ( m.id === 0 ) {
			const contact = this.bite.step( dt, m, previousPose, SHARK.mass );
			if ( contact ) { m.impulseX += contact.bodyImpulse.x / SHARK.mass; m.impulseY += contact.bodyImpulse.y / SHARK.mass; m.impulseZ += contact.bodyImpulse.z / SHARK.mass; }
		}
	}
}
