import { Vector3 } from '../engine/index.js';
import { SPRAY } from '../fx/Spray.js';

// The sea under a car. Five GPU wave queries across the hull footprint are fitted to
// a local plane (height, slope, vertical rate) that the physics floats the hull on.
// Samples over dry land are ignored, so beaches and inland dips never float a car.
// The same state drives spray: a bow wave when the car ploughs in, sheets off wheels
// running through the shallows, and droplets flung by wheels spinning afloat.
const SAMPLES = [ [ 0, 0 ], [ - 1, 1 ], [ 1, 1 ], [ - 1, - 1 ], [ 1, - 1 ] ];
// The hull footprint is each car's `hull` [ width, length ] (m) in Vehicles.js, held to the body
// box in rally-physics/src/vehicle.rs by test/vehicle-parity.mjs. It was a private table here keyed
// by physics id, and the first new car (the Petrel GT, id 4) threw on its missing row every frame.
const _p = new Vector3(), _v = new Vector3(), _f = new Vector3(), _r = new Vector3();

export class CarWater {

	constructor( { query, terrain, spray, physics } ) {

		this.query = query;
		this.terrain = terrain;
		this.spray = spray;
		this.physics = physics;
		this.slot = query ? query.allocate( 'rallyHull', SAMPLES.length ) : - 1;
		this.version = - 1;
		this.plane = null; // { height, slopeX, slopeZ, x, z, time }
		this.rate = 0;
		this.active = false;
		this.carry = 0;
		this.wheelCarry = [ 0, 0, 0, 0 ];
		this.emitted = 0; // particles requested, for telemetry and tests

	}

	// Before the physics step: place the queries under the hull and hand the latest fitted
	// sea surface to the physics (or switch buoyancy off on dry land).
	update( root, forward, profile ) {

		const q = this.query, t = this.terrain;
		const hx = profile.hull[ 0 ] * 0.45, hz = profile.hull[ 1 ] * 0.45;
		_r.set( forward.z, 0, - forward.x ); // car-left in world XZ
		for ( let i = 0; i < SAMPLES.length && q; i ++ ) {

			_p.copy( root.position ).addScaledVector( _r, SAMPLES[ i ][ 0 ] * hx ).addScaledVector( forward, SAMPLES[ i ][ 1 ] * hz );
			q.setPoint( this.slot + i, _p.x, _p.z );

		}
		if ( q && q.cpuValid && q.version !== this.version ) {

			this.version = q.version;
			this.fit( q, t );

		} else if ( ! q || ! q.cpuValid ) {

			// No GPU read-back yet: a flat sea at mean level, still gated by the terrain.
			this.plane = t.heightAt( root.position.x, root.position.z ) < 0.05 ? { height: 0, slopeX: 0, slopeZ: 0, x: root.position.x, z: root.position.z, time: 0 } : null;
			this.rate = 0;

		}
		const p = this.plane;
		this.active = !! p;
		if ( p ) this.physics.set_water( p.height, p.slopeX, p.slopeZ, p.x, p.z, this.rate );
		else this.physics.set_water( NaN, 0, 0, 0, 0, 0 );

	}

	// Least-squares plane through the wet samples, evaluated where the GPU actually sampled.
	fit( q, t ) {

		let n = 0, sx = 0, sz = 0, sh = 0;
		const wet = [];
		for ( let i = 0; i < SAMPLES.length; i ++ ) {

			const j = this.slot + i, x = q.resultInputs[ j * 4 ], z = q.resultInputs[ j * 4 + 1 ], h = q.cpu[ j * 4 ];
			if ( ! Number.isFinite( h ) || t.heightAt( x, z ) > h - 0.02 ) continue;
			wet.push( [ x, z, h ] ); n ++; sx += x; sz += z; sh += h;

		}
		if ( ! n ) { this.plane = null; this.rate = 0; return; }
		const x0 = sx / n, z0 = sz / n, h0 = sh / n;
		// Normal equations for the slopes about the centroid, lightly regularised so two or
		// three wet samples in a line do not invent a steep tilt.
		let xx = 1e-2, zz = 1e-2, xz = 0, xh = 0, zh = 0;
		for ( const [ x, z, h ] of wet ) { const dx = x - x0, dz = z - z0, dh = h - h0; xx += dx * dx; zz += dz * dz; xz += dx * dz; xh += dx * dh; zh += dz * dh; }
		const det = xx * zz - xz * xz;
		const slopeX = ( xh * zz - zh * xz ) / det, slopeZ = ( zh * xx - xh * xz ) / det;
		const time = q.resultTime, old = this.plane;
		if ( old && time > old.time ) {

			// Vertical rate of the sea at a fixed point, not along the car's path.
			const before = old.height + old.slopeX * ( x0 - old.x ) + old.slopeZ * ( z0 - old.z );
			const rate = ( h0 - before ) / Math.max( time - old.time, 1 / 120 );
			this.rate += ( Math.max( - 4, Math.min( 4, rate ) ) - this.rate ) * 0.5;

		}
		this.plane = { height: h0, slopeX, slopeZ, x: x0, z: z0, time };

	}

	emit( count, size, kind, options ) {
		this.spray.emit( _p, _f, count, size, kind, options );
		this.emitted += Math.round( count );
	}

	// After the physics step: spray from the hull and wheels.
	splash( dt, state, root, forward, profile ) {

		if ( ! this.spray || ! this.active || state.length < 96 ) return;
		// [ width, length ] (m) from Vehicles.js. This line still read the removed HULL table after // and the ReferenceError stopped the car's update the first frame spray ran (car-aboard.spec red).
		const [ hullWidth, hullLength ] = profile.hull;
		const submerged = state[ 73 ], speed = state[ 95 ], sink = - state[ 94 ], level = state[ 93 ];
		const up = _v.set( 0, 1, 0 );
		// Bow wave and entry slam.
		const bow = Math.max( 0, speed - 1.2 ) * Math.min( 1, submerged * 4 ) + Math.max( 0, sink - 0.8 ) * 2;
		if ( bow > 0 && level > - 100 ) {

			this.carry += bow * dt * 30;
			const count = Math.floor( this.carry );
			if ( count > 0 ) {

				this.carry -= count;
				_p.copy( root.position ).addScaledVector( forward, hullLength * 0.5 ); _p.y = level + 0.05;
				_f.copy( forward ).multiplyScalar( speed * 0.55 ).addScaledVector( up, 1.6 + speed * 0.35 + Math.max( 0, sink ) * 0.8 );
				this.emit( Math.min( 80, count * 3 ), 0.025, SPRAY.DROPLET, { spread: 1.4 + speed * 0.12, jitter: hullWidth * 0.35, life: 1.5 } );
				if ( bow > 2 ) this.emit( Math.min( 20, count ), 0.18, SPRAY.SPRAY, { spread: 1.8, jitter: hullWidth * 0.4, life: 1.8, sizeJitter: 0.7 } );

			}

		}
		// Wheels: sheets off tyres running through the shallows, roost from spinning tyres afloat.
		// Rate-based (particles per second from ground or wheel speed) so the shared spray pool
		// never floods, with a few big blobs among the droplets so it reads from the chase camera.
		for ( let w = 0; w < 4; w ++ ) {

			const wheelSpeed = state[ 13 + w * 4 + 2 ], grounded = state[ 13 + w * 4 + 3 ] > 0.5, surface = state[ 89 + w ];
			const c = 29 + w * 10, ground = state[ c + 8 ];
			const wading = grounded && surface === 6 && ground > 1.5;
			const paddling = ! grounded && Math.abs( wheelSpeed ) > 3 && submerged > 0.05;
			if ( ! wading && ! paddling ) { this.wheelCarry[ w ] = 0; continue; }
			this.wheelCarry[ w ] += dt * ( wading ? 22 * ground : 14 * Math.abs( wheelSpeed ) );
			const count = Math.floor( this.wheelCarry[ w ] );
			if ( count < 1 ) continue;
			this.wheelCarry[ w ] -= count;
			if ( wading ) {

				_p.set( state[ c ], level + 0.03, state[ c + 2 ] );
				_r.set( forward.z, 0, - forward.x ).multiplyScalar( w % 2 ? 1 : - 1 );
				_f.copy( forward ).multiplyScalar( ground * 0.35 ).addScaledVector( _r, 0.8 + ground * 0.18 ).addScaledVector( up, 1.2 + ground * 0.22 );
				this.emit( Math.min( 30, count ), 0.03, SPRAY.DROPLET, { spread: 0.9, jitter: 0.12, life: 1.2 } );
				if ( ground > 5 ) this.emit( Math.max( 1, Math.round( count / 8 ) ), 0.14, SPRAY.SPRAY, { spread: 0.8, jitter: 0.1, life: 1.1, sizeJitter: 0.6 } );

			} else {

				_p.set( state[ 0 ], level + 0.05, state[ 2 ] ).addScaledVector( forward, ( w < 2 ? 1 : - 1 ) * hullLength * 0.32 );
				_f.copy( forward ).multiplyScalar( - Math.sign( wheelSpeed ) * Math.min( 6, Math.abs( wheelSpeed ) * 0.4 ) ).addScaledVector( up, 2.2 );
				this.emit( Math.min( 20, count ), 0.03, SPRAY.DROPLET, { spread: 0.8, jitter: 0.15, life: 1.1 } );

			}

		}

	}

}
