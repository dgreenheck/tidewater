// Crash damage as plain numbers: reported hits to zones, corners and breakable parts,
// the thresholds that turn damage into steam, smoke, fire and lost wheels, the mechanical
// values handed to the physics, and a small serialisable form for the network. No engine
// or DOM imports, so node tests and a remote peer can run it as is.

export const ZONES = [ 'front', 'rear', 'left', 'right', 'roof' ];
// Energy is (delta-v above the 0.8 m/s reporting floor) squared. ZONE_ENERGY fills a zone:
// a 25 km/h nose-in only dents, a 30 to 50 km/h one holes the radiator (steam). One hit adds at
// most HIT_CAP, so a car burns after repeated heavy hits, unless a single one is very heavy
// (delta-v from HEAVY toward HEAVY + 8 m/s lifts the cap to a full zone).
export const ZONE_ENERGY = 220, HIT_CAP = 0.42, HEAVY = 18;
export const CORNER_ENERGY = 220, CORNER_CAP = 0.6;
// A square hit on a hub this hard (about 50 km/h of delta-v) snaps the upright.
export const SNAP = 14;
export const LEVELS = { steam: 0.2, smoke: 0.5, fire: 0.9, crack: 0.25, shatter: 0.6 };
// Seconds for a fire to grow to full, then to finish the engine.
export const FIRE_GROW = 16, FIRE_KILL = 6;
const MAX_TOE = 0.14;

const clamp = ( v, lo = 0, hi = 1 ) => Math.min( hi, Math.max( lo, v ) );
const ramp = ( v, a, b ) => clamp( ( v - a ) / ( b - a ) );
const bits = mask => { let n = 0; for ( ; mask; mask &= mask - 1 ) n ++; return n; };

// dims: { hx, hz, floor, top, wheels: [ [ x, z ] x4 ] } in car-local metres (+Z nose, +X left).
export function zoneWeights( p, d, dims ) {
	const along = p[ 2 ] / dims.hz, across = p[ 0 ] / dims.hx, up = ( p[ 1 ] - dims.floor ) / ( dims.top - dims.floor );
	const side = ramp( Math.abs( across ), 0.55, 0.92 );
	// A face only takes a hit that pushes into it: a glancing scrape along the nose loads the side, not the radiator.
	const w = [
		ramp( along, 0.35, 0.75 ) * Math.max( 0.1, - d[ 2 ] ),
		ramp( - along, 0.35, 0.75 ) * Math.max( 0.1, d[ 2 ] ),
		across > 0 ? side * Math.max( 0.1, - d[ 0 ] ) : 0,
		across < 0 ? side * Math.max( 0.1, d[ 0 ] ) : 0,
		ramp( up, 0.72, 0.92 ) * ( d[ 1 ] < - 0.4 ? 1 : 0.4 ),
	];
	const sum = w.reduce( ( a, b ) => a + b, 0 );
	if ( sum > 0.05 ) return w.map( v => v / Math.max( 1, sum ) );
	// Mid-body hit: the shove says which face took it.
	const ax = Math.abs( d[ 0 ] ), ay = Math.abs( d[ 1 ] ), az = Math.abs( d[ 2 ] );
	const one = [ 0, 0, 0, 0, 0 ];
	if ( ay > ax && ay > az ) one[ 4 ] = 1;
	else if ( az >= ax ) one[ d[ 2 ] < 0 ? 0 : 1 ] = 1;
	else one[ d[ 0 ] < 0 ? 2 : 3 ] = 1;
	return one;
}

// How much of a hit lands on each suspension corner: low hits within ~1 m of the hub.
export function cornerWeights( p, dims ) {
	if ( p[ 1 ] > dims.floor + 0.95 ) return [ 0, 0, 0, 0 ];
	return dims.wheels.map( ( [ x, z ] ) => ramp( 1 - Math.hypot( p[ 0 ] - x, p[ 2 ] - z ) / 1.0, 0, 0.5 ) );
}

export class DamageState {
	// parts: [ { name, anchor: [ x, y, z ], at, radius } ] break where they were actually hit.
	constructor( dims, parts = [] ) {
		this.dims = dims;
		this.parts = parts;
		this.reset();
	}

	reset() {
		this.zones = [ 0, 0, 0, 0, 0 ];
		this.corners = [ 0, 0, 0, 0 ];
		this.toe = [ 0, 0, 0, 0 ];
		this.hurt = this.parts.map( () => 0 );
		this.glass = 0; this.fire = 0; this.burn = 0; this.dead = false; this.doused = false; this.quenched = false;
		this.lost = 0; this.wheelsLost = 0; this.impacts = 0;
		this.steam = 0; this.smoke = 0;
	}

	get body() { return clamp( this.zones.reduce( ( a, b ) => a + b, 0 ) / 2.5 ); }
	get partsLost() { return bits( this.lost ); }
	get wheelCount() { return bits( this.wheelsLost ); }

	// One reported hit. Returns what changed so the renderer can dent, drop parts and spark.
	hit( p, d, severity ) {
		const energy = Math.max( 0, severity - 0.8 ) ** 2;
		const out = { energy, broken: [], wheels: [], shatter: false, crack: false };
		// Landing on the wheels shoves the body straight up: suspension, not crash damage.
		if ( energy <= 0 || ( d[ 1 ] > 0.6 && severity < 9 ) ) return out;
		this.impacts ++;
		const share = Math.min( HIT_CAP + ( 1 - HIT_CAP ) * ramp( severity, HEAVY, HEAVY + 8 ), energy / ZONE_ENERGY );
		const w = zoneWeights( p, d, this.dims );
		for ( let i = 0; i < 5; i ++ ) this.zones[ i ] = clamp( this.zones[ i ] + share * w[ i ] );
		const cw = cornerWeights( p, this.dims );
		for ( let i = 0; i < 4; i ++ ) {
			if ( cw[ i ] <= 0 || this.wheelsLost & ( 1 << i ) ) continue;
			this.corners[ i ] = clamp( this.corners[ i ] + Math.min( CORNER_CAP, energy / CORNER_ENERGY ) * cw[ i ], 0, 1 );
			// Bent toward the shove; a severe square hit on the hub snaps the upright.
			this.toe[ i ] = clamp( this.toe[ i ] - d[ 0 ] * cw[ i ] * share * 0.6, - 1, 1 );
			if ( severity >= SNAP && cw[ i ] > 0.5 ) this.corners[ i ] = 1;
			if ( this.corners[ i ] >= 1 ) { this.wheelsLost |= 1 << i; out.wheels.push( i ); }
		}
		this.parts.forEach( ( part, i ) => {
			if ( this.lost & ( 1 << i ) ) return;
			const r = Math.hypot( p[ 0 ] - part.anchor[ 0 ], p[ 1 ] - part.anchor[ 1 ], p[ 2 ] - part.anchor[ 2 ] ) / ( part.radius || 1.2 );
			this.hurt[ i ] += share * ( r < 1 ? ( 1 - r * r ) ** 2 : 0 );
			if ( this.hurt[ i ] >= part.at ) { this.lost |= 1 << i; out.broken.push( i ); }
		} );
		const before = this.glass;
		this.glass = clamp( this.glass + share * ( 0.8 * w[ 0 ] + 0.6 * w[ 4 ] + 0.4 * ( w[ 2 ] + w[ 3 ] ) + 0.35 * w[ 1 ] ) );
		out.crack = before < LEVELS.crack && this.glass >= LEVELS.crack;
		out.shatter = before < LEVELS.shatter && this.glass >= LEVELS.shatter;
		if ( severity >= 6 ) this.doused = false;
		return out;
	}

	// Heat and fire over time. submerged is the physics snapshot's s[73]: sea water puts a fire out.
	tick( dt, submerged = 0 ) {
		const front = this.zones[ 0 ];
		this.quenched = false;
		this.steam = front >= LEVELS.steam ? clamp( 0.35 + ( front - LEVELS.steam ) / 0.3 ) : 0;
		this.smoke = front >= LEVELS.smoke ? clamp( 0.3 + ( front - LEVELS.smoke ) / 0.4 ) : 0;
		if ( submerged > 0.3 && this.fire > 0 ) { this.fire = 0; this.burn = 0; this.doused = true; this.quenched = true; }
		if ( this.fire === 0 && ! this.doused && front >= LEVELS.fire ) this.fire = 0.05;
		if ( this.fire > 0 ) {
			this.fire = Math.min( 1, this.fire + dt / FIRE_GROW );
			if ( this.fire >= 1 && ( this.burn += dt ) >= FIRE_KILL ) this.dead = true;
		}
	}

	// Values for RallyPhysics.set_damage( engine, pull, wheels ).
	mechanical() {
		// A crumpled front costs up to 60% of the power; only fire takes the rest.
		let engine = 1 - Math.min( 0.6, Math.max( 0, this.zones[ 0 ] - 0.05 ) * 1.2 );
		engine *= 1 - 0.8 * this.fire;
		if ( this.dead ) engine = 0;
		const wheels = new Float32Array( 12 );
		for ( let i = 0; i < 4; i ++ ) {
			const lost = ( this.wheelsLost >> i ) & 1, c = this.corners[ i ];
			wheels[ i ] = lost ? 0 : clamp( this.toe[ i ], - 1, 1 ) * MAX_TOE * ( 0.4 + 0.6 * c );
			wheels[ 4 + i ] = lost ? 1 : Math.max( 0.2, 1 - 0.55 * c );
			wheels[ 8 + i ] = lost;
		}
		// Unequal front toe drags the car to one side; positive pulls left.
		const pull = clamp( ( wheels[ 0 ] + wheels[ 1 ] ) * 0.6, - 0.2, 0.2 );
		return { engine: clamp( engine ), pull, wheels };
	}

	// [ version, zones x5, corners x4, toe x4, glass, fire, burn, lost mask, wheels mask, flags ]
	serialize() {
		return [ 1, ...this.zones, ...this.corners, ...this.toe, this.glass, this.fire, this.burn, this.lost, this.wheelsLost, ( this.dead ? 1 : 0 ) | ( this.doused ? 2 : 0 ) ];
	}

	apply( a ) {
		if ( ! a || a[ 0 ] !== 1 || a.length < STATE_LENGTH ) return false;
		this.zones = a.slice( 1, 6 ); this.corners = a.slice( 6, 10 ); this.toe = a.slice( 10, 14 );
		[ this.glass, this.fire, this.burn, this.lost, this.wheelsLost ] = a.slice( 14, 19 );
		this.dead = !! ( a[ 19 ] & 1 ); this.doused = !! ( a[ 19 ] & 2 );
		this.tick( 0 );
		return true;
	}
}
export const STATE_LENGTH = 20;
