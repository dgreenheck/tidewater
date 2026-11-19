// The Tidewater Spirit's scheduled service between Tidewater and Joey Island. The timetable
// loads her at one berth (ramp down, gangway out), casts her off with the prolonged blast, and
// the autopilot sails her across on her own controls (throttles, wheel, bow and stern
// thrusters): out along the berth's axis, across the strait at service speed, a swing to
// stern-to well off the far harbour's mouth, then dynamic positioning down the berth's axis:
// heading held, the thrusters walking her sideways onto the line, the levers backing her in at
// a crawl onto her marks, where the lines come on through the same capture a helmsman uses
// (Ferry.onMarks). Anyone taking her helm has her; when they leave it, the service carries on
// from wherever she is.
import { HULL } from './FerryShip.js';

const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );

export const GATE = 130;       // m out along the berth's axis: where she heads for across the strait
const SWEEP = 60;             // m short of it she sweeps round onto the axis, stern-to
const SWING = [ 0.6, 1.6 ];   // m/s through the swing: squared away .. a right angle or more off
const CLEAR = 60;             // m out along the berth she leaves before turning for the crossing
const CRUISE = 7.8;           // m/s service speed (about 15 knots)
const HOLD = 90;              // m of the berth, and under HOLD_SPEED, where she comes in on positioning
const HOLD_SPEED = 2;
const CREEP = 3.0;            // m/s astern down the axis at most, easing to a crawl on her marks
// m to port of her marks she aims for: her port side lies a metre off the jetty's fender face,
// and the winches haul her the rest of the way once the lines are on
const MARK = - 0.3;
const RAMP_TIME = 12;         // s, as Ferry.js

export class Autopilot {

	constructor() { this.leg = 'depart'; this.from = null; this.to = null; this.lat = 0; this.along = 0; }

	// A passage from wherever she is to berth `to` ({ x, z, yaw }); `from` is the berth she has
	// just left (she runs straight out along it first), or null.
	route( ship, to, from = null ) {

		this.to = to; this.from = from;
		const near = Math.hypot( ship.position.x - to.x, ship.position.z - to.z ) < HOLD && ship.speed < HOLD_SPEED && Math.abs( wrap( to.yaw - ship.yaw ) ) < 0.8;
		this.leg = from && Math.hypot( ship.position.x - from.x, ship.position.z - from.z ) < CLEAR ? 'depart' : near ? 'back' : 'cross';

	}

	gate( b, d = GATE ) { return { x: b.x + Math.sin( b.yaw ) * d, z: b.z + Math.cos( b.yaw ) * d }; }

	steer( ship ) {

		const p = ship.position, to = this.to;
		if ( this.leg === 'depart' ) {

			// straight out along the berth's axis, held on it by the thrusters until she has way on
			const f = this.from, out = ( p.x - f.x ) * Math.sin( f.yaw ) + ( p.z - f.z ) * Math.cos( f.yaw );
			this.position( ship, f, CRUISE, MARK );
			if ( out > CLEAR ) this.leg = 'cross';

		} else if ( this.leg === 'cross' ) {

			const g = this.gate( to ), dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot( dx, dz );
			this.helm( ship, Math.atan2( dx, dz ), clamp( 0.06 * d, 3.5, CRUISE ) );
			if ( d < SWEEP ) this.leg = 'swing';

		} else if ( this.leg === 'swing' ) {

			// a sweeping turn onto the berth's axis heading out, so she lies stern-to well off the
			// harbour's mouth, then her way comes off
			const fx = Math.sin( to.yaw ), fz = Math.cos( to.yaw ), ex = to.x - p.x, ez = to.z - p.z;
			const lat = ex * fz - ez * fx;
			const err = Math.abs( wrap( to.yaw - ship.yaw ) );
			this.helm( ship, to.yaw + clamp( lat / 60, - 0.2, 0.2 ), SWING[ 0 ] + SWING[ 1 ] * Math.min( 1, err / 0.8 ) );
			if ( err < 0.12 ) this.leg = 'back';

		} else {

			// dynamic positioning down the axis: astern at up to CREEP, easing to a crawl on her
			// marks, and holding off while she is not yet on the line or square to it
			const fx = Math.sin( to.yaw ), fz = Math.cos( to.yaw ), px = p.x - to.x, pz = p.z - to.z;
			const along = px * fx + pz * fz, lat = px * fz - pz * fx;
			const off = Math.max( Math.abs( lat - MARK ) - 0.4, 0 ), skew = Math.abs( wrap( to.yaw - ship.yaw ) );
			const ready = clamp( 1.5 - off / Math.max( 1, 0.08 * along ), 0, 1 ) * clamp( 2 - skew / 0.05, 0, 1 );
			const creep = Math.min( CREEP, Math.sqrt( 0.07 * Math.max( 0, along ) ), 0.12 * Math.max( 0, along ) + 0.05 );
			this.position( ship, to, - creep * ready, MARK );
			this.lat = lat; this.along = along;

		}

	}

	// Dynamic positioning on berth b's axis: her heading held on the berth's and her way along
	// the axis at `speed` (+ out, - in) by the levers, while the thrusters walk her sideways onto
	// the line `mark` m to port of it (both the same way) and hold the heading (opposite ways).
	position( ship, b, speed, mark ) {

		const fx = Math.sin( b.yaw ), fz = Math.cos( b.yaw ), px = ship.position.x - b.x, pz = ship.position.z - b.z;
		const side = px * fz - pz * fx, drift = ship.velocity.x * fz - ship.velocity.z * fx;
		const want = clamp( 0.12 * ( mark - side ), - 0.5, 0.5 );
		const sway = HULL.SWAY_DRAG * want * Math.abs( want ) + 40000 * want + HULL.MASS * 0.4 * ( want - drift );
		const err = wrap( b.yaw - ship.yaw ), rate = clamp( 0.15 * err, - 0.03, 0.03 );
		const turn = 3.0e8 * rate * Math.abs( rate ) + 1.2e6 * rate + HULL.YAW_INERTIA * 0.6 * ( rate - ship.r );
		ship.thruster = clamp( ( - sway - turn / HULL.THRUSTER_ARM ) / 2 / HULL.THRUSTER, - 1, 1 );
		ship.stern = clamp( ( - sway + turn / HULL.THRUSTER_ARM ) / 2 / HULL.THRUSTER, - 1, 1 );
		ship.wheel = ship.u > 1.5 ? clamp( - 2.5 * err + 30 * ship.r, - 1, 1 ) : 0;
		this.throttle( ship, speed );

	}

	// Wheel, throttles and bow thruster toward a heading and a speed through the water.
	helm( ship, yaw, speed ) {

		const err = wrap( yaw - ship.yaw ), u = ship.u;
		const slow = clamp( 1.5 - Math.abs( u ) / 3, 0, 1 );
		ship.wheel = u > 0.3 || ship.power > 0.05 ? clamp( - 2.5 * err + 30 * ship.r, - 1, 1 ) : 0;
		ship.thruster = clamp( ( - 5 * err + 60 * ship.r ) * slow, - 1, 1 );
		ship.stern = 0;
		this.throttle( ship, speed );

	}

	// The levers for a speed through the water: her drag at that speed, fed forward, and a
	// little more for the difference.
	throttle( ship, speed ) {

		const drag = ( HULL.SURGE_DRAG * speed * Math.abs( speed ) + 900 * speed ) / HULL.THRUST;
		ship.lever = clamp( ( speed < 0 ? drag / 0.6 : drag ) + 0.5 * ( speed - ship.u ), - 1, 1 );

	}

}

export class FerryService {

	constructor( ferry, { short = false, enabled = true } = {} ) {

		this.ferry = ferry;
		this.enabled = enabled;
		this.pilot = new Autopilot();
		this.load = short ? 5 : 60;         // s with her ramp down at each berth
		this.phase = 'layover';            // layover (ramp up) | loading | casting | sailing
		this.wait = short ? 4 : 60;        // s until the next thing on the timetable
		this.next = ferry.berths[ 1 ];     // where she sails next
		this.yielded = false;
		this.sailedAt = 0; this.time = 0; this.lastCrossing = 0;

	}

	get steering() { return this.enabled && this.phase === 'sailing' && ! this.ferry.driven; }

	update( dt ) {

		const ferry = this.ferry, ship = ferry.ship;
		this.time += dt;
		if ( ! this.enabled ) return;
		if ( ferry.driven ) { this.yielded = true; return; }
		if ( ferry.flood > 0 ) return;
		if ( this.yielded ) { this.yielded = false; this.resume(); }
		if ( this.phase === 'layover' ) {

			if ( ( this.wait -= dt ) <= 0 && ferry.lowerRamp() ) { this.phase = 'loading'; this.wait = this.load; }

		} else if ( this.phase === 'loading' ) {

			if ( ferry.ramp >= 1 ) this.wait -= dt;
			// other people's cars and foot passengers still boarding or leaving hold her ramp down
			if ( this.wait <= 0 && ! ferry.traffic?.holding() && ! ferry.crowd?.holding() && ferry.castOff() ) this.phase = 'casting';

		} else if ( this.phase === 'casting' ) {

			if ( ! ship.moored && ! ferry.castingOff ) { this.phase = 'sailing'; this.sailedAt = this.time; this.pilot.route( ship, this.next, ferry.at ); }

		} else if ( ship.moored ) {

			this.lastCrossing = this.time - this.sailedAt;
			this.next = ferry.berths.find( b => b !== ferry.at );
			this.phase = 'loading'; this.wait = this.load;
			ferry.lowerRamp();

		} else this.pilot.steer( ship );

	}

	// Back from a player's helm: made fast, the berth cycle goes on; under way, she makes for the
	// nearest berth.
	resume() {

		const ferry = this.ferry, ship = ferry.ship;
		if ( ship.moored ) {

			this.next = ferry.berths.find( b => b !== ferry.at );
			if ( ferry.castingOff ) this.phase = 'casting';
			else if ( ferry.rampGoal > 0 ) { this.phase = 'loading'; this.wait = this.load; }
			else { this.phase = 'layover'; this.wait = Math.max( this.wait, 10 ); }

		} else {

			this.next = ferry.nearestBerth();
			this.phase = 'sailing'; this.sailedAt = this.time;
			this.pilot.route( ship, this.next, null );

		}

	}

	// The departures board line: what she does next, and when.
	board() {

		const ferry = this.ferry, to = this.next.label;
		if ( ferry.driven ) return { text: `${ ferry.ship.moored ? 'Held at the berth' : 'Under way' }: at the helm`, eta: - 1 };
		if ( this.phase === 'sailing' ) return { text: [ 'swing', 'back', 'fill' ].includes( this.pilot.leg ) ? `Arriving at ${ to }` : `Sailing to ${ to }`, eta: - 1 };
		if ( this.phase === 'casting' ) return { text: `Departing for ${ to }`, eta: 0 };
		// her time has come but cars or foot passengers are still coming aboard: say so, don't freeze the clock
		if ( this.phase === 'loading' && this.wait <= 0 && ( ferry.traffic?.holding() || ferry.crowd?.holding() ) ) return { text: `Loading vehicles for ${ to }`, eta: 0 };
		const eta = ( this.phase === 'layover' ? Math.max( 0, this.wait ) + RAMP_TIME + this.load : ( 1 - ferry.ramp ) * RAMP_TIME + Math.max( 0, this.wait ) ) + RAMP_TIME;
		const m = Math.floor( eta / 60 ), s = Math.floor( eta % 60 );
		return { text: `Next sailing to ${ to } ${ m }:${ String( s ).padStart( 2, '0' ) }`, eta };

	}

}
