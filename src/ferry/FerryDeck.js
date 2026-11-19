import { Vector3, Quaternion, Euler } from '../engine/index.js';

// Being aboard the ferry: walking her decks and stairs in the ship's own frame (so the player
// rides along however she moves), stepping off onto a jetty or gangway, falling overboard, and
// the helm. Colliders come from public/ferry/ferry_colliders.json (ship frame: +Z bow, +Y up).
// STEP: the highest edge a walker steps up onto; above two of her 0.183 m stair risers, so the
// tread after next never reads as a wall against the walker's toes.
const EYE = 1.62, RADIUS = 0.26, HEIGHT = 1.75, STEP = 0.45;
const HELM_REACH = 0.9;
const WHEEL_RATE = 0.7;       // wheel travel per second while A/D is held (-1 .. 1)
const LEVER_RATE = 0.45;      // throttle lever travel per second while W/S is held

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _qa = new Quaternion(), _qb = new Quaternion();
const _e = new Euler( 0, 0, 0, 'YXZ' ), _up = new Vector3( 0, 1, 0 );
const _bo = new Vector3(), _bd = new Vector3(), AXES = [ 'x', 'y', 'z' ];

export class FerryDeck {

	constructor( ferry, data ) {

		this.ferry = ferry;
		this.id = 'ferry';
		this.support = { id: 'ferry', simulationBounds: () => this.simulationBounds(), groundHeightAt: ( ...a ) => this.groundHeightAt( ...a ), supportAt: ( ...a ) => this.supportAt( ...a ),
			world: p => this.world( p ), local: p => this.localPoint( p ), velocityAt: p => this.velocityAt( p ), angularVelocity: () => this.ferry.ship.angularVelocity().toArray(), resolveCapsule: ( ...a ) => this.resolveCapsule( ...a ) };
		ferry.app?.player?.groundProviders?.add( this.support );
		this.boxes = data.boxes.filter( b => b.kind !== 'car' ).map( b => ( {
			walk: b.kind === 'walk', solid: b.kind === 'solid' || b.kind === 'walk',
			center: new Vector3( ...b.center ), half: new Vector3( ...b.half ),
		} ) );
		// The bridge deckhouse's roof (tools/ferry/ferry_build.py: ROOF3 13.2 m over its floor at 10 m, from UPPER_AFT
		// forward) is modelled but has no collider, so the sky test passed inside it (the rod came out indoors), the
		// third-person boom rose through it and the bird took the deckhouse for open sky. It is added here over the
		// deckhouse floor's footprint (the full-width walk box at 10 m aft of nothing but the deckhouse itself).
		for ( const f of this.boxes.filter( b => b.walk && Math.abs( b.center.y + b.half.y - 10 ) < 0.05 && b.half.x > 8 && b.center.z - b.half.z > 5.3 ) ) {

			this.boxes.push( { walk: false, solid: true, center: new Vector3( f.center.x, 13.09, f.center.z ), half: new Vector3( f.half.x + 0.15, 0.11, f.half.z + 0.15 ) } );

		}
		this.walkBoxes = this.boxes.filter( b => b.walk );
		this.stations = Object.fromEntries( Object.entries( data.stations ).map( ( [ k, v ] ) => [ k, new Vector3( ...v ) ] ) );
		this.local = new Vector3();
		this.vel = new Vector3();
		this.yaw = 0;             // view yaw relative to the ship
		this.grounded = true;
		this.bob = 0;
		this.chase = false;
		this.orbit = 0;

	}

	// Highest walkable top under (x, z) in the ship frame at or below maxY; -Infinity if none.
	simulationBounds() {
		// groundHeightAt rejects beyond40m; the rotated capsule-query box fits
		// inside that sphere too. Workers inside this bound use the live provider.
		const p = this.ferry.ship.position;
		return { minX:p.x-40, maxX:p.x+40, minZ:p.z-40, maxZ:p.z+40 };
	}

	groundAt( x, z, maxY ) {

		let g = - Infinity;
		for ( const b of this.walkBoxes ) {

			if ( Math.abs( x - b.center.x ) > b.half.x || Math.abs( z - b.center.z ) > b.half.z ) continue;
			const top = b.center.y + b.half.y;
			if ( top <= maxY && top > g ) g = top;

		}
		return g;

	}

	world( p ) { return this.ferry.ship.toWorld( Array.isArray( p ) ? new Vector3( ...p ) : p, new Vector3() ).toArray(); }
	localPoint( p ) { return this.ferry.ship.toLocal( Array.isArray( p ) ? new Vector3( ...p ) : p, new Vector3() ).toArray(); }
	velocityAt( p ) { return this.ferry.ship.velocityAt( Array.isArray( p ) ? new Vector3( ...p ) : p, new Vector3() ).toArray(); }

	groundHeightAt( x, z, maxY = Infinity ) {

		const ship = this.ferry.ship, n = new Vector3( 0, 1, 0 ).applyQuaternion( ship.quaternion );
		if ( n.y < 0.55 || Math.hypot( x - ship.position.x, z - ship.position.z ) > 40 ) return - Infinity;
		let best = - Infinity;
		for ( const b of this.walkBoxes ) {
			const c = ship.toWorld( new Vector3( b.center.x, b.center.y + b.half.y, b.center.z ), new Vector3() );
			const y = c.y - ( n.x * ( x - c.x ) + n.z * ( z - c.z ) ) / n.y;
			if ( y > maxY || y <= best ) continue;
			const local = ship.toLocal( new Vector3( x, y, z ), new Vector3() );
			if ( Math.abs( local.x - b.center.x ) <= b.half.x + 1e-6 && Math.abs( local.z - b.center.z ) <= b.half.z + 1e-6 ) best = y;
		}
		return best;

	}

	supportAt( feet, { maxRise = 0.45, maxDrop = 0.25 } = {} ) {

		const p = Array.isArray( feet ) ? feet : feet.toArray(), height = this.groundHeightAt( p[ 0 ], p[ 2 ], p[ 1 ] + maxRise );
		if ( ! Number.isFinite( height ) || p[ 1 ] - height > maxDrop ) return null;
		const at = [ p[ 0 ], height, p[ 2 ] ];
		return { provider: this.support, height, normal: new Vector3( 0, 1, 0 ).applyQuaternion( this.ferry.ship.quaternion ).toArray(), velocity: this.velocityAt( at ), local: this.localPoint( at ) };

	}

	resolveCapsule( world, radius = 0.3, height = 1.75, stepHeight = 0.4 ) {

		const p = this.ferry.ship.toLocal( world, new Vector3() );
		if ( Math.abs( p.x ) > 12 || Math.abs( p.z ) > 30 || p.y < - 1 || p.y > 16 ) return false;
		let hit = false;
		for ( let pass = 0; pass < 2; pass ++ ) for ( const b of this.boxes ) {
			if ( ! b.solid || b.center.y + b.half.y <= p.y + stepHeight || b.center.y - b.half.y >= p.y + height ) continue;
			const dx = p.x - b.center.x, dz = p.z - b.center.z, px = b.half.x + radius - Math.abs( dx ), pz = b.half.z + radius - Math.abs( dz );
			if ( px <= 0 || pz <= 0 ) continue;
			if ( px < pz ) p.x += ( Math.sign( dx ) || 1 ) * px; else p.z += ( Math.sign( dz ) || 1 ) * pz;
			hit = true;
		}
		if ( hit ) this.ferry.ship.toWorld( p, world );
		return hit;

	}

	// A walker at `world` (feet) steps aboard if a deck lies right under their feet.
	canBoard( world ) {

		const p = this.ferry.ship.toLocal( world, _v );
		if ( Math.abs( p.x ) > 9.8 || Math.abs( p.z ) > 27 ) return false;
		const g = this.groundAt( p.x, p.z, p.y + 0.45 );
		return g > - Infinity && p.y - g < 0.6;

	}

	board( player, world ) {

		this.ferry.ship.toLocal( world, this.local );
		this.vel.set( 0, 0, 0 );
		this.yaw = player.yaw - this.ferry.ship.yaw - Math.PI;
		this.grounded = true;
		player.vessel = this;
		player.mode = 'ferry';
		player.velocity.set( 0, 0, 0 );
		player._camY = null;

	}

	// ---------------------------------------------------------------- walking

	walk( player, dt ) {

		const inp = player.input, ship = this.ferry.ship;
		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		player.pitch = Math.max( - 1.5, Math.min( 1.5, player.pitch - look.y * 0.0022 ) );
		const sy = Math.sin( this.yaw ), cy = Math.cos( this.yaw );
		const wish = _w.set( 0, 0, 0 );
		if ( inp.down( 'KeyW' ) ) wish.add( _v.set( sy, 0, cy ) );
		if ( inp.down( 'KeyS' ) ) wish.sub( _v.set( sy, 0, cy ) );
		if ( inp.down( 'KeyD' ) ) wish.add( _v.set( - cy, 0, sy ) );
		if ( inp.down( 'KeyA' ) ) wish.sub( _v.set( - cy, 0, sy ) );
		if ( wish.lengthSq() > 0 ) wish.normalize();
		// the island walker's pace (Player.js): 3 m/s, 6.2 sprinting
		const speed = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ? 6.2 : 3.0, k = 1 - Math.exp( - 12 * dt ), v = this.vel;
		v.x += ( wish.x * speed - v.x ) * k;
		v.z += ( wish.z * speed - v.z ) * k;
		if ( player.environment ) {
			const feet = ship.toWorld( this.local, new Vector3() ), carrier = ship.velocityAt( feet, new Vector3() );
			const worldVelocity = ship.toWorld( this.local.clone().add( v ), new Vector3() ).sub( feet ).add( carrier );
			const load = player.walkLoad = player.environment.acceleration( feet.clone().add( new Vector3( 0, 0.9, 0 ) ), worldVelocity,
				{ mass: 75, area: 0.7, volume: 0.075, height: 1.8, supported: this.grounded, dt }, {} );
			const acceleration = new Vector3( load.ax, load.ay, load.az );
			worldVelocity.addScaledVector( acceleration, dt ); player.velocity.copy( worldVelocity );
			if ( ( this.grounded && Math.hypot( load.ax, load.az ) > 3.2 ) || load.wy > 18 || load.height - feet.y > 1.75 ) {
				if ( player.ragdoll( null, null, { velocity: worldVelocity, spin: { x: 0, y: 0, z: 0 } } ) ) { player.rag.disasterField = player.environment; player.rag.waterY = load.height; return; }
			}
			const localAcceleration = ship.toLocal( feet.clone().add( acceleration ), new Vector3() ).sub( this.local );
			v.addScaledVector( localAcceleration, dt );
		}
		if ( this.grounded && inp.hit( 'Space' ) ) { v.y = 3.2; this.grounded = false; }
		v.y -= 9.81 * dt;
		const p = this.local, oldX = p.x, oldZ = p.z;
		p.addScaledVector( v, dt );
		// Walls and furniture: push out of solid boxes you can't step onto.
		for ( let iter = 0; iter < 2; iter ++ ) for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			const top = b.center.y + b.half.y, bottom = b.center.y - b.half.y;
			if ( top <= p.y + STEP || bottom >= p.y + HEIGHT ) continue;
			const ex = b.half.x + RADIUS, ez = b.half.z + RADIUS, dx = p.x - b.center.x, dz = p.z - b.center.z;
			if ( Math.abs( dx ) >= ex || Math.abs( dz ) >= ez ) continue;
			const px = ex - Math.abs( dx ), pz = ez - Math.abs( dz );
			if ( px < pz ) { p.x += Math.sign( dx || ( oldX - b.center.x ) || 1 ) * px; v.x = 0; }
			else { p.z += Math.sign( dz || ( oldZ - b.center.z ) || 1 ) * pz; v.z = 0; }

		}
		const g = this.groundAt( p.x, p.z, p.y + STEP );
		if ( p.y <= g ) { p.y = g; if ( v.y < 0 ) v.y = 0; this.grounded = true; }
		else this.grounded = p.y - g < 0.04;
		const moved = Math.hypot( p.x - oldX, p.z - oldZ );
		if ( this.grounded ) {

			this.bob += moved * 2.4;
			player.stepDist = ( player.stepDist || 0 ) + moved;
			if ( player.stepDist > 0.6 ) { player.stepDist = 0; player.audio?.footstep( 'wood' ); }

		}
		ship.toWorld( p, player.position );
		player.yaw = ship.yaw + Math.PI + this.yaw;
		// Off the edge of her decks: onto whatever the world has there, or into the sea.
		if ( g === - Infinity || p.y < - 0.5 ) {

			const world = player.groundAt( player.position.x, player.position.z, player.position.y + 0.45 );
			if ( world > player.position.y - 0.7 ) { this.leave( player, world ); return; }
			if ( p.y < - 0.5 ) { this.overboard( player ); return; }

		}
		// The helm.
		const helm = this.stations.HelmStation;
		if ( helm && Math.hypot( p.x - helm.x, p.z - helm.z ) < HELM_REACH && Math.abs( p.y - helm.y ) < 0.5 ) {

			player.prompt = { key: 'E', text: 'Take the helm' };
			if ( inp.hit( 'KeyE' ) ) { this.takeHelm( player ); return; }

		}
		this.camera( player, _v.set( p.x, p.y + EYE + Math.sin( this.bob ) * 0.02, p.z ) );

	}

	leave( player, groundY ) {

		player.mode = 'walk';
		player.position.y = groundY;
		player.velocity.set( 0, 0, 0 );
		player.grounded = true;
		player._camY = null;

	}

	overboard( player ) {

		const ship = this.ferry.ship, velocity = ship.toWorld( this.local.clone().add( this.vel ), new Vector3() ).sub( ship.toWorld( this.local, new Vector3() ) ).add( ship.velocityAt( player.position, new Vector3() ) );
		const water = player.environment?.waterAt( player.position.x, player.position.z ) ?? player.waterH;
		player.resumeOnFoot( { position: player.position.toArray(), velocity: velocity.toArray(), yaw: player.yaw, pitch: player.pitch, waterHeight: water, grounded: false } );

	}

	// The camera rides the ship: her heading fully, her roll and pitch half-stabilised.
	camera( player, eyeLocal ) {

		const ship = this.ferry.ship, cam = player.camera;
		ship.toWorld( eyeLocal, cam.position );
		// A blow to the hull shakes everyone aboard.
		const shake = this.ferry.shake * 0.09;
		if ( shake > 0 ) cam.position.add( _w.set( ( Math.random() - 0.5 ) * shake, ( Math.random() - 0.5 ) * shake, ( Math.random() - 0.5 ) * shake ) );
		player._camY = cam.position.y;
		_qa.setFromAxisAngle( _up, ship.yaw );
		_q.slerpQuaternions( ship.quaternion, _qa, 0.55 );
		cam.quaternion.copy( _q ).multiply( _qb.setFromAxisAngle( _up, Math.PI ) ).multiply( _qa.setFromEuler( _e.set( player.pitch, this.yaw, 0 ) ) );

	}

	// Out on an open deck: nothing of her overhead within 8 m of the player's eye.
	openSky( player ) { return this.boomHit( player.camera.position, _up, 8 ) >= 8; }

	// Somewhere to fish from: an open deck above the vehicle deck (down there the wing walls stand between you and the sea).
	fishable( player ) { return this.local.y > 6 && this.openSky( player ); }

	// The third-person camera's boom against her walls, decks and stairs (every solid box): the
	// distance along dir from origin (world) to the first box it enters, or maxDist. A box the
	// head is already inside (a low door head) doesn't count.
	boomHit( origin, dir, maxDist ) {

		const ship = this.ferry.ship;
		const o = ship.toLocal( _bo.copy( origin ), _bo );
		const d = ship.toLocal( _bd.copy( origin ).addScaledVector( dir, maxDist ), _bd ).sub( o );
		let best = 1;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			let t0 = 0, t1 = best, hit = true;
			for ( const a of AXES ) {

				const oo = o[ a ] - b.center[ a ], dd = d[ a ], h = b.half[ a ];
				if ( Math.abs( dd ) < 1e-9 ) {

					if ( Math.abs( oo ) > h ) { hit = false; break; }
					continue;

				}

				let ta = ( - h - oo ) / dd, tb = ( h - oo ) / dd;
				if ( ta > tb ) { const t = ta; ta = tb; tb = t; }
				t0 = Math.max( t0, ta );
				t1 = Math.min( t1, tb );
				if ( t0 > t1 ) { hit = false; break; }

			}

			if ( hit && t0 > 0 ) best = t0;

		}

		return best * maxDist;

	}

	// ---------------------------------------------------------------- the helm

	takeHelm( player ) {

		const helm = this.stations.HelmStation;
		this.local.copy( helm );
		this.vel.set( 0, 0, 0 );
		this.yaw = 0;
		player.pitch = - 0.08;
		player.mode = 'ferry-helm';
		this.ferry.onHelm( true );

	}

	leaveHelm( player ) {

		player.mode = 'ferry';
		this.ferry.onHelm( false );

	}

	helm( player, dt ) {

		const inp = player.input, ship = this.ferry.ship;
		const look = inp.consumeLook();
		const shift = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const steer = Number( inp.down( 'KeyD' ) || inp.down( 'ArrowRight' ) ) - Number( inp.down( 'KeyA' ) || inp.down( 'ArrowLeft' ) );
		// Shift with A/D works the bow thruster; otherwise A/D turn the wheel, which stays put.
		if ( shift ) { ship.thruster = steer; }
		else { ship.thruster = 0; ship.wheel = Math.max( - 1, Math.min( 1, ship.wheel + steer * WHEEL_RATE * dt ) ); }
		const lever = Number( inp.down( 'KeyW' ) || inp.down( 'ArrowUp' ) ) - Number( inp.down( 'KeyS' ) || inp.down( 'ArrowDown' ) );
		ship.lever = Math.max( - 1, Math.min( 1, ship.lever + lever * LEVER_RATE * dt ) );
		if ( inp.hit( 'KeyX' ) ) ship.lever = 0;
		if ( inp.hit( 'KeyC' ) ) ship.wheel = 0;
		if ( inp.hit( 'KeyH' ) ) this.ferry.horn( 'long' );
		// Berth work: R lowers or raises the stern ramp, L casts off or makes fast.
		if ( inp.hit( 'KeyR' ) ) this.ferry.toggleRamp();
		if ( inp.hit( 'KeyL' ) ) this.ferry.lines();
		if ( inp.hit( 'KeyV' ) ) this.chase = ! this.chase;
		if ( inp.hit( 'KeyE' ) ) { this.leaveHelm( player ); return; }
		ship.toWorld( this.local, player.position );
		player.yaw = ship.yaw + Math.PI;
		if ( this.chase ) {

			// Chase view: behind and above her, the mouse swings it round.
			this.orbit -= look.x * 0.003;
			const yaw = ship.yaw + this.orbit, cam = player.camera;
			const back = _w.set( - Math.sin( yaw ), 0, - Math.cos( yaw ) );
			cam.position.copy( ship.position ).addScaledVector( back, 70 ).setY( 26 );
			cam.lookAt( _v.copy( ship.position ).setY( 6 ).addScaledVector( back, - 12 ) );
			player._camY = cam.position.y;

		} else {

			this.yaw = Math.max( - 1.4, Math.min( 1.4, this.yaw - look.x * 0.0022 ) );
			player.pitch = Math.max( - 0.9, Math.min( 0.6, player.pitch - look.y * 0.0022 ) );
			// The helmsman stands a pace behind the wheel and looks over it.
			this.camera( player, _v.set( this.local.x, this.local.y + EYE + 0.08, this.local.z - 0.35 ) );

		}

	}

}
