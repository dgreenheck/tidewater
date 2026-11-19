// The wheel pivots roll about their own axles as the vehicle moves.

// rad (35 deg) at the road wheels at full lock: a family car's, e.g. a 2.64 m Golf turning in 10.9 m
// kerb to kerb (tan( 35 deg ) * 5.3 m ~ the wheelbase)
export const MAX_LOCK = 0.61;
// rad/s at the road wheels: about one turn of the steering wheel a second through a 15:1 rack,
// a driver's unhurried hand; it is also what keeps the wheels from snapping at a path's corner
export const STEER_RATE = 0.9;
// m, s: the pure pursuit look ahead, max( LOOK_MIN, speed * LOOK_TIME ). A driver looks a car's
// length or so ahead at walking pace; it also sets how early the wheels turn in before a corner.
export const LOOK_MIN = 3.5, LOOK_TIME = 1.2;

const TAU = Math.PI * 2;
const wrap = a => a - TAU * Math.round( a / TAU );
const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

// The point `ahead` m along a polyline path (points { x, z }, segment lengths seg) from distance s,
// clamped to the path's ends, into out.
export function pointAlong( pts, seg, s, out ) {

	let i = 0, r = Math.max( 0, s );
	while ( i < seg.length - 1 && r > seg[ i ] ) r -= seg[ i ++ ];
	const a = pts[ i ], b = pts[ i + 1 ], f = seg[ i ] > 0 ? clamp( r / seg[ i ], 0, 1 ) : 1;
	out.x = a.x + ( b.x - a.x ) * f;
	out.z = a.z + ( b.z - a.z ) * f;
	return out;

}

const _look = { x: 0, z: 0 };

export class WheelRig {

	constructor( radius, wheelbase ) {

		this.radius = radius;          // m, the tyre's rolling radius
		this.wheelbase = wheelbase;    // m, front axle to rear
		this.spin = 0;                 // rad, every wheel's roll angle, wrapped to -PI .. PI
		this.turned = 0;               // rad, the total rolled (unwrapped: forward positive)
		this.steer = 0;                // rad, the front wheels' angle

	}

	// The car moved ds m (negative backing) along its path this step, to `at` on its road at path
	// distance s with heading `heading`. Roll by the arc, and steer toward the pure pursuit angle for
	// a point LOOK ahead along the road (behind, backing): tan( steer ) = 2 L sin( alpha ) / look,
	// the bicycle model's steer for the arc through that point, reversed when backing (the yaw rate
	// is speed * tan( steer ) / L, so the same arc backward needs the opposite lock).
	follow( pts, seg, s, at, heading, ds, dt ) {

		const roll = ds / this.radius;
		this.turned += roll;
		this.spin = wrap( this.spin + roll );
		if ( ds === 0 ) return;         // standing: the driver holds the wheel where it is
		const dir = ds < 0 ? - 1 : 1, speed = Math.abs( ds ) / Math.max( dt, 1e-6 );
		const look = Math.max( LOOK_MIN, speed * LOOK_TIME );
		pointAlong( pts, seg, s + dir * look, _look );
		const dx = _look.x - at.x, dz = _look.z - at.z, d = Math.hypot( dx, dz );
		// (within 0.3 m of the path's end there is no line to follow: keep the wheel straight)
		const alpha = d < 0.3 ? 0 : wrap( Math.atan2( dx, dz ) - heading - ( dir < 0 ? Math.PI : 0 ) );
		const want = clamp( dir * Math.atan( 2 * this.wheelbase * Math.sin( alpha ) / Math.max( d, look ) ), - MAX_LOCK, MAX_LOCK );
		const step = STEER_RATE * dt;
		this.steer += clamp( want - this.steer, - step, step );

	}

}
