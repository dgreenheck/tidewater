// Check a whole vehicle footprint, rather than trusting a walker's point spawn.
// Candidates are tried nearest first on a square grid of `step` metres, `radius` out.
// `preferred.trunks` (x, z, radius, bottom, top records) also keeps cars off tree trunks.
export function clearSpawn( terrain, colliders, preferred, peers = [], { radius = 18, step = 3 } = {} ) {
	const offsets = [];
	const yaw = Number.isFinite( preferred.yaw ) ? preferred.yaw : 0, fx = Math.sin( yaw ), fz = Math.cos( yaw );
	const n = Math.round( radius / step );
	for ( let x = - n; x <= n; x ++ ) for ( let z = - n; z <= n; z ++ ) offsets.push( [ x * step, z * step ] );
	offsets.sort( ( a, b ) => a[ 0 ] ** 2 + a[ 1 ] ** 2 - b[ 0 ] ** 2 - b[ 1 ] ** 2 );
	for ( const [ dx, dz ] of offsets ) {
		const x = preferred.x + dx, z = preferred.z + dz, height = terrain.heightAt( x, z );
		// Footprint corners along the car's own heading: 2.7 m fore and aft, 1.3 m either side.
		const heights = [ [ - 2.7, - 1.3 ], [ - 2.7, 1.3 ], [ 2.7, - 1.3 ], [ 2.7, 1.3 ] ].map( ( [ along, side ] ) =>
			terrain.heightAt( x + fx * along + fz * side, z + fz * along - fx * side ) );
		if ( Math.min( ...heights ) < 1 || Math.max( ...heights ) - Math.min( ...heights ) > 0.7 ) continue;
		if ( peers.some( peer => Math.hypot( peer.x - x, peer.z - z ) < 6 ) ) continue;
		let blocked = false;
		for ( const box of colliders.boxes ) {
			if ( box.tag === 'rally-car' || ! box.solid || box.top < height + 0.08 || box.bottom > height + 2.7 ) continue;
			// Paving a car drives onto (a walkable surface a hand's breadth above the ground) is not in the way.
			if ( box.walkable && box.top < height + 0.35 ) continue;
			const [ lx, lz ] = colliders._toLocal( box, x, z );
			if ( Math.hypot( Math.max( 0, Math.abs( lx ) - box.half.x ), Math.max( 0, Math.abs( lz ) - box.half.z ) ) < 3.1 ) { blocked = true; break; }
		}
		if ( blocked || colliders.cylinders.some( c => c.yMax > height + 0.08 && c.yMin < height + 2.7 && Math.hypot( c.x - x, c.z - z ) < c.radius + 3.1 ) ) continue;
		if ( preferred.trunks && blockedByTrunk( preferred.trunks, x, z ) ) continue;
		return { ...preferred, x, z };
	}
	throw new Error( 'No clear dry vehicle spawn near the selected location' );
}

function blockedByTrunk( trunks, x, z ) {
	for ( let i = 0; i < trunks.length; i += 5 ) if ( Math.hypot( trunks[ i ] - x, trunks[ i + 1 ] - z ) < trunks[ i + 2 ] + 3.1 ) return true;
	return false;
}

// Put a stranded, stuck or capsized car back on its wheels on the nearest clear, dry,
// level ground, keeping its heading. The search widens from a few metres (a car on its
// roof on the road) out to the shore (a car afloat); null if nothing is clear.
export function recoverySpot( terrain, colliders, position, forward, peers = [], trunks = null ) {
	const yaw = Math.atan2( forward.x, forward.z );
	const preferred = { x: position.x, z: position.z, yaw: Number.isFinite( yaw ) ? yaw : 0, trunks };
	for ( const [ radius, step ] of [ [ 6, 1.5 ], [ 30, 3 ], [ 90, 5 ], [ 240, 8 ] ] ) {
		try { return clearSpawn( terrain, colliders, preferred, peers, { radius, step } ); } catch { /* widen the search */ }
	}
	return null;
}
