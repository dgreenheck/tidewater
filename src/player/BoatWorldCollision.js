import { Quaternion, Vector3 } from '../engine/index.js';
import { BoatCollision } from './BoatCollision.js';

const SKIN = 1e-4;
const CONTACT_FRICTION = 0.2;
const MAX_EDGE_TRAVEL = 0.1;

// Dock contact is horizontal: convex hull/cabin footprints with a vertical
// overlap gate, not a general 3D rigid-body solver. Terrain and buoyancy still
// own heave, pitch and roll. Normal and friction impulses affect surge/sway/yaw.
export class BoatWorldCollision {

	constructor( model, colliders ) {

		const shape = new BoatCollision( model );
		this.parts = [ shape.hull, ...shape.boxes ].map( solid => ( {
			solid, projection: projection( solid.vertices.length ),
		} ) );
		this.world = colliders;
		this.obstacles = [];
		this.candidates = [];
		this.revision = - 1;
		this.target = new Vector3();
		this.rotation = new Quaternion();
		this.offset = new Vector3();
		this.com = new Vector3();
		this.best = { depth: 0, x: 0, z: 0, px: 0, pz: 0 };
		this.hit = { depth: 0, x: 0, z: 0, px: 0, pz: 0 };
		this.stats = { steps: 0, contacts: 0, pairs: 0 };

	}

	refresh() {

		if ( this.world.revision === this.revision ) return;
		this.revision = this.world.revision;
		this.obstacles.length = 0;
		for ( const b of this.world.boxes ) {

			if ( ! b.solid ) continue;
			const p = projection( 4 );
			let i = 0;
			for ( const [ x, z ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

				p.points[ i ++ ].set( b.center.x + x * b.half.x * b.cos + z * b.half.z * b.sin, 0,
					b.center.z - x * b.half.x * b.sin + z * b.half.z * b.cos );

			}
			updateBounds( p, b.bottom, b.top );
			this.obstacles.push( p );

		}
		for ( const c of this.world.cylinders ) {

			const p = projection( 12 ), r = c.radius / Math.cos( Math.PI / 12 );
			for ( let i = 0; i < 12; i ++ ) p.points[ i ].set( c.x + r * Math.cos( i * Math.PI / 6 ), 0, c.z + r * Math.sin( i * Math.PI / 6 ) );
			updateBounds( p, c.yMin, c.yMax );
			this.obstacles.push( p );

		}

	}

	move( boat, previousPosition, previousQuaternion ) {

		this.refresh();
		const target = this.target.copy( boat.position ), rotation = this.rotation.copy( boat.quaternion );
		const offset = this.offset.set( 0, 0, 0 );
		const angle = 2 * Math.acos( Math.min( 1, Math.abs( previousQuaternion.dot( rotation ) ) ) );
		const travel = previousPosition.distanceTo( target ) + angle * 6;
		if ( ! Number.isFinite( travel ) ) return; // BoatController resets invalid physics states.
		const steps = Math.min( 256, Math.max( 1, Math.ceil( travel / MAX_EDGE_TRAVEL ) ) );
		const candidates = this.candidates;
		candidates.length = 0;
		for ( const b of this.obstacles ) {

			if ( b.maxX >= Math.min( previousPosition.x, target.x ) - 7 && b.minX <= Math.max( previousPosition.x, target.x ) + 7 &&
				b.maxZ >= Math.min( previousPosition.z, target.z ) - 7 && b.minZ <= Math.max( previousPosition.z, target.z ) + 7 ) candidates.push( b );

		}
		this.stats.steps = 0; this.stats.contacts = 0; this.stats.pairs = 0;
		if ( candidates.length === 0 ) return;
		for ( let step = 1; step <= steps; step ++ ) {

			this.stats.steps ++;
			boat.position.copy( previousPosition ).lerp( target, step / steps ).add( offset );
			boat.quaternion.slerpQuaternions( previousQuaternion, rotation, step / steps );
			for ( let iter = 0; iter < 8; iter ++ ) {

				const best = this.best;
				best.depth = 0;
				for ( const part of this.parts ) {

					const a = part.projection;
					let bottom = Infinity, top = - Infinity;
					for ( let i = 0; i < a.points.length; i ++ ) {

						const p = a.points[ i ].copy( part.solid.vertices[ i ] ).applyQuaternion( boat.quaternion ).add( boat.position );
						bottom = Math.min( bottom, p.y ); top = Math.max( top, p.y );

					}
					updateBounds( a, bottom, top );
					for ( const b of candidates ) {

						this.stats.pairs ++;
						if ( overlap( a, b, this.hit ) && this.hit.depth > best.depth ) {

							best.depth = this.hit.depth; best.x = this.hit.x; best.z = this.hit.z;
							contactPoint( a, b, best );

						}

					}

				}
				if ( best.depth === 0 ) break;
				const depth = best.depth + SKIN;
				boat.position.x += best.x * depth; boat.position.z += best.z * depth;
				offset.x += best.x * depth; offset.z += best.z * depth;
				this.com.copy( boat.com || ZERO ).applyQuaternion( boat.quaternion ).add( boat.position );
				applyDockImpulse( boat, best, this.com );
				this.stats.contacts ++;

			}

		}

	}

}

const ZERO = new Vector3();

// A prism's projected hull edges are a subset of its cap edges and extrusion
// edges. Testing all of those axes avoids allocating/sorting a new 2D hull.
function projection( count ) {

	const points = Array.from( { length: count }, () => new Vector3() );
	return { points, bottom: 0, top: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

}

function updateBounds( p, bottom, top ) {

	p.bottom = bottom; p.top = top;
	p.minX = p.minZ = Infinity; p.maxX = p.maxZ = - Infinity;
	for ( const v of p.points ) {

		p.minX = Math.min( p.minX, v.x ); p.maxX = Math.max( p.maxX, v.x );
		p.minZ = Math.min( p.minZ, v.z ); p.maxZ = Math.max( p.maxZ, v.z );

	}

}

function overlap( a, b, out ) {

	if ( a.top <= b.bottom || a.bottom >= b.top || a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ ) return false;
	out.depth = Infinity;
	for ( let shape = 0; shape < 2; shape ++ ) {

		const points = shape === 0 ? a.points : b.points;
		// Boat vertices are two parallel caps. Static obstacles have just one ring.
		const cap = shape === 0 ? points.length / 2 : points.length;
		for ( let i = 0; i < cap + ( shape === 0 ? 1 : 0 ); i ++ ) {

			const p = i === cap ? points[ 0 ] : points[ i ];
			const q = i === cap ? points[ cap ] : points[ ( i + 1 ) % cap ];
			let nx = q.z - p.z, nz = p.x - q.x;
			const length = Math.hypot( nx, nz );
			if ( length < 1e-8 ) continue;
			nx /= length; nz /= length;
			let a0 = Infinity, a1 = - Infinity, b0 = Infinity, b1 = - Infinity;
			for ( const v of a.points ) { const d = v.x * nx + v.z * nz; a0 = Math.min( a0, d ); a1 = Math.max( a1, d ); }
			for ( const v of b.points ) { const d = v.x * nx + v.z * nz; b0 = Math.min( b0, d ); b1 = Math.max( b1, d ); }
			if ( a1 <= b0 || a0 >= b1 ) return false;
			const negative = a1 - b0, positive = b1 - a0;
			const depth = Math.min( negative, positive ), sign = negative < positive ? - 1 : 1;
			if ( depth < out.depth ) { out.depth = depth; out.x = nx * sign; out.z = nz * sign; }

		}

	}
	return true;

}

function contactPoint( a, b, hit ) {

	const nx = hit.x, nz = hit.z, tx = - nz, tz = nx;
	let an = Infinity, bn = - Infinity;
	for ( const p of a.points ) an = Math.min( an, p.x * nx + p.z * nz );
	for ( const p of b.points ) bn = Math.max( bn, p.x * nx + p.z * nz );
	let a0 = Infinity, a1 = - Infinity, b0 = Infinity, b1 = - Infinity;
	for ( const p of a.points ) if ( p.x * nx + p.z * nz <= an + 1e-3 ) {

		const t = p.x * tx + p.z * tz; a0 = Math.min( a0, t ); a1 = Math.max( a1, t );

	}
	for ( const p of b.points ) if ( p.x * nx + p.z * nz >= bn - 1e-3 ) {

		const t = p.x * tx + p.z * tz; b0 = Math.min( b0, t ); b1 = Math.max( b1, t );

	}
	const t = ( Math.max( a0, b0 ) + Math.min( a1, b1 ) ) / 2, n = ( an + bn ) / 2;
	hit.px = nx * n + tx * t; hit.pz = nz * n + tz * t;

}

// Inelastic contact against a fixed dock. Effective mass includes the moment arm:
// J = -v_contact / (1/m + (r cross n)^2 / I). Friction is capped by mu * J.
// Only approaching contact velocity is removed; separating motion is untouched.
export function applyDockImpulse( boat, hit, com ) {

	const mass = boat.mass || 3200, inertia = boat.inertia?.y || 15700;
	const invM = 1 / mass, invI = 1 / inertia;
	const rx = hit.px - com.x, rz = hit.pz - com.z;
	const vx = boat.velocity.x + boat.angular.y * rz, vz = boat.velocity.z - boat.angular.y * rx;
	const vn = vx * hit.x + vz * hit.z;
	if ( vn >= 0 ) return;
	const arm = rz * hit.x - rx * hit.z;
	const tx = - hit.z, tz = hit.x, tangentArm = rz * tx - rx * tz;
	const vt = vx * tx + vz * tz;
	const kn = invM + arm * arm * invI, kt = invM + tangentArm * tangentArm * invI;
	const coupling = arm * tangentArm * invI, determinant = kn * kt - coupling * coupling;
	// Solve both constraints together: a separate friction impulse can otherwise
	// reintroduce inward normal velocity through its yaw moment.
	let jn = ( - vn * kt + vt * coupling ) / determinant;
	let jt = ( - vt * kn + vn * coupling ) / determinant;
	if ( jn < 0 || Math.abs( jt ) > CONTACT_FRICTION * jn ) {

		const ratio = - Math.sign( vt || - jt ) * CONTACT_FRICTION;
		jn = - vn / ( kn + ratio * coupling );
		jt = ratio * jn;

	}
	boat.velocity.x += ( hit.x * jn + tx * jt ) * invM;
	boat.velocity.z += ( hit.z * jn + tz * jt ) * invM;
	boat.angular.y += ( arm * jn + tangentArm * jt ) * invI;

}
