import * as THREE from '../engine/index.js';
import { prismCollider, boxCollider, cylinderCollider, transformCollider } from './SolidCollision.js';

// Lightweight collision world for the character controller and boat.
// Boxes are oriented around Y only. Walkable boxes (decks, floors, stairs) act as ground.
export class Colliders {

	constructor() {

		this.revision = 0;
		this.boxes = [];
		this.cylinders = [];
		this.surfaces = [];

	}

	// center: world center, half: half extents (x, y, z) in the box's local frame, rotY: yaw (radians)
	addBox( center, half, rotY = 0, { walkable = false, solid = true, tag = '' } = {} ) {

		const b = {
			center: center.clone(), half: half.clone(), rotY,
			cos: Math.cos( rotY ), sin: Math.sin( rotY ),
			walkable, solid, tag,
			top: center.y + half.y, bottom: center.y - half.y,
			radius: Math.hypot( half.x, half.z ),
		};
		this.boxes.push( b );
		this.revision ++;
		return b;

	}

	// Convex surface slab (roofs, shutters): thickness extends below the top face.
	addSurface( points, thickness ) {

		const roof = prismCollider( points, thickness );
		this.surfaces.push( roof );
		return roof;

	}

	addCylinder( x, z, radius, yMin, yMax, { tag = '' } = {} ) {

		const c = { x, z, radius, yMin, yMax, tag };
		this.cylinders.push( c );
		this.revision ++;
		return c;

	}

	// All character obstacles participate in one sweep, so sliding off a roof cannot
	// push the character back through a wall resolved by an earlier, separate pass.
	// margin includes the extra reach of a step-up/down trial in the broad phase.
	characterSolids( previous, position, radius, height, margin = 0 ) {

		const reach = previous.distanceTo( position ) + radius + margin + 0.01;
		const solids = [ ...this.surfaces, ...( this.trees?.near( previous, position, reach ) || [] ) ];
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			if ( b.bottom > Math.max( previous.y, position.y ) + height + reach || b.top < Math.min( previous.y, position.y ) - reach ) continue;
			if ( Math.abs( previous.x - b.center.x ) > b.radius + reach || Math.abs( previous.z - b.center.z ) > b.radius + reach ) continue;
			if ( ! b.shape ) b.shape = transformCollider( boxCollider( new THREE.Vector3(), b.half ), b.center,
				new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), b.rotY ) );
			solids.push( b.shape );

		}
		for ( const c of this.cylinders ) {

			if ( Math.abs( previous.x - c.x ) > c.radius + reach || Math.abs( previous.z - c.z ) > c.radius + reach ) continue;
			if ( ! c.shape ) c.shape = cylinderCollider( new THREE.Vector3( c.x, c.yMin, c.z ), new THREE.Vector3( c.x, c.yMax, c.z ), c.radius );
			solids.push( c.shape );

		}
		return solids;

	}

	_toLocal( b, x, z ) {

		const dx = x - b.center.x, dz = z - b.center.z;
		return [ dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos ];

	}

	// Highest walkable surface under (x, z) not higher than maxY.
	groundHeightAt( x, z, maxY, pad = 0 ) {

		let best = - Infinity;
		for ( const b of this.boxes ) {

			if ( ! b.walkable || b.top > maxY ) continue;
			if ( Math.abs( x - b.center.x ) > b.radius + pad + 0.01 || Math.abs( z - b.center.z ) > b.radius + pad + 0.01 ) continue;
			const [ lx, lz ] = this._toLocal( b, x, z );
			if ( Math.abs( lx ) <= b.half.x + pad && Math.abs( lz ) <= b.half.z + pad ) best = Math.max( best, b.top );

		}

		return best;

	}

	// Segment/ray against boxes (XZ-plane rotated) for camera occlusion; returns distance or Infinity.
	raycast( origin, dir, maxDist ) {

		let best = maxDist;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			const ox = origin.x - b.center.x, oz = origin.z - b.center.z, oy = origin.y - b.center.y;
			const lox = ox * b.cos - oz * b.sin, loz = ox * b.sin + oz * b.cos;
			const ldx = dir.x * b.cos - dir.z * b.sin, ldz = dir.x * b.sin + dir.z * b.cos;
			let tmin = 0, tmax = best;
			const slab = ( o, d, h ) => {

				if ( Math.abs( d ) < 1e-8 ) return Math.abs( o ) <= h;
				let t1 = ( - h - o ) / d, t2 = ( h - o ) / d;
				if ( t1 > t2 ) { const t = t1; t1 = t2; t2 = t; }
				tmin = Math.max( tmin, t1 );
				tmax = Math.min( tmax, t2 );
				return tmin <= tmax;

			};

			if ( slab( lox, ldx, b.half.x ) && slab( oy, dir.y, b.half.y ) && slab( loz, ldz, b.half.z ) ) best = Math.min( best, tmin );

		}

		return best;

	}

}
