import { WORLD } from '../WorldLayout.js';
import { mulberry32 } from '../../util/Noise.js';
import { TAU, clamp, smooth, angleDiff, approach, qGround } from './Kit.js';
import { boarCycleLength } from './BoarPose.js';

// A single small inland sounder keeps simulation and draw cost modest for browser play.
const ACTIVE = 110, DRAW = 100, CELL = 16;
const MIN_GROUND = 2.25, MAX_SLOPE = 0.52;
const BODY_RADIUS = 1.05;

// Small resident sounders around the upper beach and inland meadow. Their circular clearance
// encloses the whole adult, including the snout, so turning cannot sweep through a trunk.
// Static obstacles are indexed once; only nearby ground animals do any per-frame work.
export class Boars {

	constructor( { terrain, village = null, colliders = null, vegetation = null, seed = 8317 } ) {

		this.terrain = terrain;
		this.rng = mulberry32( seed );
		this.obstacles = new Map();
		this.agents = [];
		this.indexObstacles( village, colliders, vegetation );
		this.place( vegetation );

	}

	indexObstacles( village, colliders, vegetation ) {

		const add = ( obstacle, x, z, radius ) => {

			const pad = radius + BODY_RADIUS * 1.2;
			for ( let ix = Math.floor( ( x - pad ) / CELL ); ix <= Math.floor( ( x + pad ) / CELL ); ix ++ ) {

				for ( let iz = Math.floor( ( z - pad ) / CELL ); iz <= Math.floor( ( z + pad ) / CELL ); iz ++ ) {

					const key = `${ ix },${ iz }`;
					let cell = this.obstacles.get( key );
					if ( ! cell ) this.obstacles.set( key, cell = [] );
					cell.push( obstacle );

				}

			}

		};
		for ( const box of colliders?.boxes ?? [] ) {

			if ( box.solid || box.walkable ) add( { box }, box.center.x, box.center.z, box.radius );

		}
		for ( const c of colliders?.cylinders ?? [] ) add( { x: c.x, z: c.z, r: c.radius, bottom: c.yMin, top: c.yMax }, c.x, c.z, c.radius );
		for ( const f of village?.getFootprints?.() ?? [] ) add( { x: f.x, z: f.z, r: f.r }, f.x, f.z, f.r );
		for ( const [ kind, radius ] of [ [ 'trees', 0.38 ], [ 'palms', 0.26 ] ] ) {

			for ( const p of vegetation?.records?.[ kind ] ?? [] ) {

				const r = radius * ( p.s ?? 1 );
				add( { x: p.x, z: p.z, r }, p.x, p.z, r );

			}

		}

	}

	clear( x, z, y, radius ) {

		const obstacles = this.obstacles.get( `${ Math.floor( x / CELL ) },${ Math.floor( z / CELL ) }` );
		if ( ! obstacles ) return true;
		for ( const o of obstacles ) {

			if ( o.box ) {

				const b = o.box;
				if ( ! b.walkable && ( b.top < y - 0.2 || b.bottom > y + 1.3 ) ) continue;
				const dx = x - b.center.x, dz = z - b.center.z;
				const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
				const ex = Math.max( 0, Math.abs( lx ) - b.half.x ), ez = Math.max( 0, Math.abs( lz ) - b.half.z );
				if ( ex * ex + ez * ez < radius * radius ) return false;

			} else {

				if ( o.top < y - 0.2 || o.bottom > y + 1.3 ) continue;
				if ( Math.hypot( x - o.x, z - o.z ) < o.r + radius ) return false;

			}

		}
		return true;

	}

	ground( x, z, radius ) {

		const T = this.terrain, y = T.heightAt( x, z );
		if ( ! Number.isFinite( y ) || y < MIN_GROUND || y > 65 ) return NaN;
		// Footprint probes reject a bank even when a central normal averages both faces away.
		for ( let i = 0; i < 8; i ++ ) {

			const a = i * TAU / 8;
			const h = T.heightAt( x + Math.sin( a ) * radius, z + Math.cos( a ) * radius );
			if ( ! Number.isFinite( h ) || h < MIN_GROUND || Math.abs( h - y ) > radius * MAX_SLOPE ) return NaN;

		}
		return this.clear( x, z, y, radius ) ? y : NaN;

	}

	pathClear( a, x, z ) {

		const dx = x - a.x, dz = z - a.z, d = Math.hypot( dx, dz );
		// A dozen adults need only a tiny local scan. Test the whole proposed segment,
		// so a target beyond a resting neighbour cannot send the boar through its body.
		for ( const other of this.agents ) {

			if ( other === a ) continue;
			const t = d > 0 ? clamp( ( ( other.x - a.x ) * dx + ( other.z - a.z ) * dz ) / ( d * d ), 0, 1 ) : 0;
			if ( Math.hypot( a.x + dx * t - other.x, a.z + dz * t - other.z ) < BODY_RADIUS * ( a.size + other.size ) ) return false;

		}
		const steps = Math.max( 1, Math.ceil( d / 0.35 ) );
		let previous = a.y;
		for ( let i = 1; i <= steps; i ++ ) {

			const y = this.ground( a.x + dx * i / steps, a.z + dz * i / steps, BODY_RADIUS * a.size );
			if ( ! Number.isFinite( y ) || Math.abs( y - previous ) > MAX_SLOPE * d / steps + 0.02 ) return false;
			previous = y;

		}
		return true;

	}

	place( vegetation ) {

		const rng = this.rng, v = WORLD.village.center;
		const anchors = [ { x: v.x + 55, z: v.z - 55 } ];
		const plants = [ ...( vegetation?.records?.palms ?? [] ), ...( vegetation?.records?.trees ?? [] ), ...( vegetation?.records?.shrubs ?? [] ) ];
		for ( let group = 0; group < anchors.length; group ++ ) {

			const anchor = anchors[ group ];
			const nearby = plants.filter( p => Math.hypot( p.x - anchor.x, p.z - anchor.z ) < 22 );
			let placed = 0;
			for ( let attempt = 0; attempt < 180 && placed < 3; attempt ++ ) {

				// Vegetation edges offer shelter; the open meadow is also habitat when no plants
				// were supplied (e.g. a simplified terrain) or a dense grove has no safe floor.
				const plant = nearby.length && attempt < 80 ? nearby[ Math.floor( rng() * nearby.length ) ] : null;
				const center = plant || anchor, angle = rng() * TAU;
				const range = plant ? 3 + rng() * 7 : 2 + rng() * ( attempt < 100 ? 10 : 22 );
				const x = center.x + Math.sin( angle ) * range, z = center.z + Math.cos( angle ) * range;
				const size = 0.88 + rng() * 0.22;
				const y = this.ground( x, z, BODY_RADIUS * size );
				if ( ! Number.isFinite( y ) || this.agents.some( a => Math.hypot( x - a.x, z - a.z ) < 3 ) ) continue;
				const a = {
					x, y, z, home: { x: anchor.x, z: anchor.z }, group, size, scale: size, seed: rng(),
					yaw: rng() * TAU, q: [ 0, 0, 0, 1 ], pq: [ 0, 0, 0, 1 ],
					state: placed % 2 ? 'root' : 'idle', t: 1 + rng() * 5, alarm: 0, retry: 0,
					tx: x, tz: z, speed: 0, phase: rng() * TAU, stride: 0, root: placed % 2 ? 0.8 : 0,
					active: false, sx: 0, sz: 0,
				};
				this.orient( a );
				this.remember( a );
				this.agents.push( a );
				placed ++;

			}

		}

	}

	remember( a ) {

		a.px = a.x; a.py = a.y; a.pz = a.z;
		a.pScale = a.scale; a.pPhase = a.phase; a.pStride = a.stride; a.pRoot = a.root;
		for ( let i = 0; i < 4; i ++ ) a.pq[ i ] = a.q[ i ];

	}

	orient( a ) {

		const e = 0.45, T = this.terrain;
		a.sx = ( T.heightAt( a.x + e, a.z ) - T.heightAt( a.x - e, a.z ) ) / ( 2 * e );
		a.sz = ( T.heightAt( a.x, a.z + e ) - T.heightAt( a.x, a.z - e ) ) / ( 2 * e );
		const length = Math.hypot( a.sx, 1, a.sz );
		qGround( a.q, a.yaw, - a.sx / length, 1 / length, - a.sz / length );

	}

	pickTarget( a, viewer = null ) {

		const rng = this.rng;
		const away = viewer ? Math.atan2( a.x - viewer.x, a.z - viewer.z ) : 0;
		for ( let attempt = 0; attempt < 10; attempt ++ ) {

			let angle, distance;
			if ( viewer ) {

				// Try forward first, then fan out along the obstacle. Never choose a route
				// toward the viewer just because the direct escape route was blocked.
				angle = away + ( attempt === 0 ? 0 : ( attempt % 2 ? 1 : - 1 ) * ( 0.25 + 0.12 * attempt ) );
				distance = attempt < 5 ? 5 + rng() * 4 : 2 + rng() * 2;

			} else {

				angle = rng() * TAU;
				distance = 2 + rng() * 7;
				if ( Math.hypot( a.x - a.home.x, a.z - a.home.z ) > 18 ) angle = Math.atan2( a.home.x - a.x, a.home.z - a.z ) + ( rng() - 0.5 );

			}
			const x = a.x + Math.sin( angle ) * distance, z = a.z + Math.cos( angle ) * distance;
			if ( ! this.pathClear( a, x, z ) ) continue;
			a.tx = x; a.tz = z;
			return true;

		}
		a.tx = a.x; a.tz = a.z;
		return false;

	}

	advance( a, dt, viewer ) {

		const distance = viewer ? Math.hypot( a.x - viewer.x, a.z - viewer.z ) : Infinity;
		const scared = distance < 8 + Math.min( 4, Math.max( 0, viewer?.speed || 0 ) ) * 0.8;
		a.t -= dt;
		a.retry -= dt;
		a.alarm = scared ? 3.5 : Math.max( 0, a.alarm - dt );
		if ( scared && a.state !== 'flee' ) {

			a.state = 'flee';
			a.retry = 0;
			a.tx = a.x; a.tz = a.z;

		}
		if ( a.state === 'flee' ) {

			if ( a.alarm <= 0 ) {

				a.state = 'idle'; a.t = 2 + this.rng() * 3;

			} else if ( a.retry <= 0 && Math.hypot( a.tx - a.x, a.tz - a.z ) < 1 ) {

				this.pickTarget( a, viewer );
				a.retry = 0.6;

			}

		} else if ( a.t <= 0 || ( a.state === 'wander' && Math.hypot( a.tx - a.x, a.tz - a.z ) < 0.3 ) ) {

			if ( a.state !== 'wander' && this.pickTarget( a ) ) {

				a.state = 'wander'; a.t = 15;

			} else {

				a.state = this.rng() < 0.72 ? 'root' : 'idle'; a.t = 3 + this.rng() * 7;

			}

		}

		const moving = a.state === 'flee' || a.state === 'wander';
		const dx = a.tx - a.x, dz = a.tz - a.z, remaining = Math.hypot( dx, dz );
		const want = moving && remaining > 0.1 ? ( a.state === 'flee' ? 3.1 + a.seed * 0.6 : 0.52 + a.seed * 0.28 ) : 0;
		a.speed += clamp( want - a.speed, - dt * 8, dt * 5 );
		let traveled = 0;
		if ( a.speed > 0.001 && remaining > 0.001 ) {

			const distance = Math.min( remaining, a.speed * dt );
			const x = a.x + dx / remaining * distance, z = a.z + dz / remaining * distance;
			if ( this.pathClear( a, x, z ) ) {

				a.x = x; a.z = z; a.y = this.terrain.heightAt( x, z );
				a.yaw += angleDiff( Math.atan2( dx, dz ), a.yaw ) * approach( a.state === 'flee' ? 9 : 4, dt );
				traveled = distance;

			} else {

				a.speed = 0; a.tx = a.x; a.tz = a.z;
				if ( a.state !== 'flee' ) { a.state = 'idle'; a.t = 1 + this.rng() * 2; }

			}

		}
		// The stance trajectory moves backward exactly as far as the body travels forward.
		// Drive follows actual movement (already acceleration-limited above), and the shader
		// shares this cycle length. Adding an idle clock during locomotion would cause skating.
		a.stride = dt > 0 ? clamp( traveled / dt / 3.7, 0, 1 ) : a.stride;
		if ( traveled > 0 ) a.phase += traveled / ( a.size * Math.max( 0.0001, boarCycleLength( a.stride ) ) ) * TAU;
		else a.phase += dt * ( a.state === 'root' ? 1.35 : 0.45 );
		a.root += ( ( a.state === 'root' ? 1 : 0 ) - a.root ) * approach( 4, dt );
		this.orient( a );

	}

	update( dt, viewer, batch, camera, blobs = null ) {

		dt = Number.isFinite( dt ) ? clamp( dt, 0, 0.1 ) : 0;
		const cp = camera.position;
		// Viewer y is feet height (also for Wildlife's free camera). Boats and airborne
		// observers never alarm animals underneath them.
		if ( viewer && ( viewer.mode === 'boat' || ! Number.isFinite( viewer.x + viewer.y + viewer.z ) || Math.abs( viewer.y - this.terrain.heightAt( viewer.x, viewer.z ) ) > 3 ) ) viewer = null;
		for ( const a of this.agents ) {

			const distance = Math.hypot( a.x - cp.x, a.y - cp.y, a.z - cp.z );
			if ( distance > ACTIVE ) { a.active = false; continue; }
			const fresh = ! a.active;
			this.remember( a );
			this.advance( a, dt, viewer );
			a.active = true;
			a.scale = a.size * smooth( DRAW, DRAW - 25, distance );
			if ( fresh ) this.remember( a );
			if ( a.scale <= 0 ) continue;
			batch.write( a, distance );
			if ( blobs ) blobs.add( a.x, a.y, a.z, a.scale * 0.68, 0.12, 0.55, a.sx, a.sz );

		}

	}

}
