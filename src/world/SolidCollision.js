import { Vector3 } from '../engine/index.js';

const SKIN = 1e-4;

// Convex solids use outward planes n.dot(p) <= d. The character is the same
// upright cylinder proxy (radius in XZ, feet at y).
export function prismCollider( points, thickness ) {

	const normal = new Vector3();
	for ( let i = 0; i < points.length; i ++ ) {

		const a = points[ i ], b = points[ ( i + 1 ) % points.length ];
		normal.x += ( a.y - b.y ) * ( a.z + b.z );
		normal.y += ( a.z - b.z ) * ( a.x + b.x );
		normal.z += ( a.x - b.x ) * ( a.y + b.y );

	}

	normal.normalize();
	if ( normal.y < 0 ) normal.negate();
	const vertices = points.map( p => p.clone() );
	vertices.push( ...points.map( p => p.clone().addScaledVector( normal, - thickness ) ) );
	const center = new Vector3();
	for ( const p of points ) center.add( p );
	center.divideScalar( points.length );
	const planes = [ { n: normal, d: normal.dot( points[ 0 ] ) },
		{ n: normal.clone().negate(), d: - normal.dot( points[ 0 ] ) + thickness } ];
	for ( let i = 0; i < points.length; i ++ ) {

		const a = points[ i ], b = points[ ( i + 1 ) % points.length ];
		const n = new Vector3().subVectors( b, a ).cross( normal ).normalize();
		if ( n.lengthSq() < 1e-8 ) continue;
		if ( n.dot( center.clone().sub( a ) ) > 0 ) n.negate();
		planes.push( { n, d: n.dot( a ) } );

	}

	return withBounds( { planes, vertices } );

}

export function boxCollider( center, half ) {

	return prismCollider( [
		new Vector3( center.x - half.x, center.y + half.y, center.z - half.z ),
		new Vector3( center.x + half.x, center.y + half.y, center.z - half.z ),
		new Vector3( center.x + half.x, center.y + half.y, center.z + half.z ),
		new Vector3( center.x - half.x, center.y + half.y, center.z + half.z ),
	], half.y * 2 );

}

// Circumscribed polygonal trunk / post, including inclined stems.
export function cylinderCollider( start, end, radius ) {

	const axis = end.clone().sub( start ).normalize();
	const side = new Vector3( 1, 0, 0 );
	if ( Math.abs( axis.x ) > 0.9 ) side.set( 0, 0, 1 );
	side.addScaledVector( axis, - side.dot( axis ) ).normalize();
	const across = new Vector3().crossVectors( axis, side );
	const points = [], r = radius / Math.cos( Math.PI / 12 );
	for ( let i = 0; i < 12; i ++ ) {

		const a = i * Math.PI / 6;
		points.push( end.clone().addScaledVector( side, r * Math.cos( a ) ).addScaledVector( across, r * Math.sin( a ) ) );

	}

	return prismCollider( points, start.distanceTo( end ) );

}

export function transformCollider( solid, position, quaternion ) {

	return withBounds( {
		planes: solid.planes.map( p => {

			const n = p.n.clone().applyQuaternion( quaternion );
			return { n, d: p.d + n.dot( position ) };

		} ),
		vertices: solid.vertices.map( v => v.clone().applyQuaternion( quaternion ).add( position ) ),
	} );

}

function withBounds( solid ) {

	solid.min = new Vector3( Infinity, Infinity, Infinity );
	solid.max = new Vector3( - Infinity, - Infinity, - Infinity );
	for ( const p of solid.vertices ) { solid.min.min( p ); solid.max.max( p ); }
	return solid;

}

function sweep( solid, start, end, radius, height ) {

	const { min, max } = solid;
	if ( Math.min( start.x, end.x ) - radius > max.x || Math.max( start.x, end.x ) + radius < min.x ||
		Math.min( start.z, end.z ) - radius > max.z || Math.max( start.z, end.z ) + radius < min.z ||
		Math.min( start.y, end.y ) - height / 2 > max.y || Math.max( start.y, end.y ) + height / 2 < min.y ) return null;

	let enter = 0, exit = 1, normal = null, inside = true;
	let nearest = Infinity, escape = null;
	for ( const { n, d } of solid.planes ) {

		const support = radius * Math.hypot( n.x, n.z ) + height * 0.5 * Math.abs( n.y );
		const a = n.dot( start ) - d - support, b = n.dot( end ) - d - support;
		if ( a > 0 ) inside = false;
		if ( - a < nearest ) { nearest = - a; escape = n; }
		if ( a > 0 && b >= a ) return null;
		if ( a <= 0 && b <= 0 ) continue;
		const t = a / ( a - b );
		if ( a > b ) {

			if ( t >= enter ) { enter = t; normal = n; }

		} else exit = Math.min( exit, t );
		if ( enter > exit ) return null;

	}

	if ( inside ) return { t: 0, normal: escape, depth: nearest + SKIN };
	return normal && enter <= 1 ? { t: enter, normal, depth: SKIN } : null;

}

// Sweep the complete movement, including thin roofs, then slide along the hit
// plane. Starting overlaps (e.g. a rocking boat) are pushed out as well.
export function resolveSolidMotion( solids, previous, position, radius, height, velocity ) {

	const start = previous.clone(); start.y += height / 2;
	const end = position.clone(); end.y += height / 2;
	let grounded = false;
	const normals = [];
	for ( let iter = 0; iter < 8; iter ++ ) {

		let first = null;
		for ( const solid of solids ) {

			const hit = sweep( solid, start, end, radius, height );
			if ( hit && ( ! first || hit.t < first.t ) ) first = hit;

		}

		if ( ! first ) { start.copy( end ); break; }
		const { normal: n, t, depth } = first;
		const rest = end.clone().sub( start ).multiplyScalar( 1 - t );
		start.lerp( end, t ).addScaledVector( n, depth );
		if ( ! normals.some( p => p.dot( n ) > 0.9999 ) ) normals.push( n );
		clipToContacts( rest, normals );
		if ( velocity ) clipToContacts( velocity, normals );
		if ( n.y > 0.5 ) grounded = true;
		end.copy( start ).add( rest );

	}

	position.copy( start ); position.y -= height / 2;
	return grounded;

}

// Keep earlier contact constraints when a later hit changes the sliding direction.
// Two blocking planes permit motion along their crease; three can stop it entirely.
function clipToContacts( motion, normals ) {

	const original = motion.clone();
	for ( let i = 0; i < normals.length; i ++ ) {

		const n = normals[ i ];
		if ( motion.dot( n ) >= - 1e-8 ) continue;
		motion.copy( original ).addScaledVector( n, - Math.min( 0, original.dot( n ) ) );
		for ( let j = 0; j < normals.length; j ++ ) {

			if ( j === i || motion.dot( normals[ j ] ) >= - 1e-8 ) continue;
			const crease = new Vector3().crossVectors( n, normals[ j ] );
			const lengthSq = crease.lengthSq();
			if ( lengthSq < 1e-8 ) { motion.set( 0, 0, 0 ); return; }
			motion.copy( crease ).multiplyScalar( original.dot( crease ) / lengthSq );
			if ( normals.some( p => motion.dot( p ) < - 1e-8 ) ) { motion.set( 0, 0, 0 ); return; }

		}

	}

}
