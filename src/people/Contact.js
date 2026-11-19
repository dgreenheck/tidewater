// Bumps (app.people.contact): the player, or the rally car, against the townsfolk. Everyone with a
// body in the hub's grid has a capsule. Player.js calls player() after its walker moves (walk mode
// ashore, her decks through FerryDeck, the boat's deck), which pushes the walker out of it, so you
// can't walk through anyone, and grades the knock by the approach speed and its direction:
//   nudge    a brush (under 1 m/s toward them): they sidestep, turn to you, "oh, sorry" or "watch it, mate"
//   stagger  a walk-in: a shove along the contact normal by momentum (your 75 kg against theirs, a little
//            bounce): a stumble of one or two steps back, arms out for balance, the upper body rocking
//            (Pose.js knock layer), and you stop against them (your walker keeps only its rebound)
//   tumble   a jog or a sprint (over 4 m/s; a frail one at a brisk walk), on open ground: a real ragdoll
//            (Tumble.js, the player's Ragdoll.js on their rig), launched by the knock, then up through the
//            keyed get-up, a glare, a laugh or a shrug and a line. What they held flies off (Props.js); they
//            go and pick it up. At most Tumble.MAX at once: past that it is the fall
//   fall     a kid (knocked by the grown-up player), or no ragdoll free: back onto the bum (the sit clip
//            lowered to the ground, knees up), then up through a crouch, and the same line and fetch
//   flinch   seated: a lean back and a complaint, never a fall
//   overboard a tumble at her rail or a pier's edge, pushed out over the water (adults only, at most WET
//            in the sea at once): the ragdoll goes over and into the sea (a splash), floats up, treads water
//            with a line, then swims (p.knock.sw, below) for the nearest shore or low ramp, wades out, has a
//            word, and goes back to their place (on foot when the way is dry land, else once out of sight)
//   The swimmer hook (the lifebuoy, the liferaft): swimmers() lists { p, at, target, state }; rescue( p,
//   target ) sends one to a world point, where they tread water until moved on (state 'tread', waiting).
//   jump     the rally car close at car-park speed: a jump back out of its way, or a comic fall
//   dive     the car fast: an early leap clear, from its speed and heading, and a fall
// Queues, gangways and her rails are narrow footing: a stagger at most, and every step is clamped
// to walkable ground by the owner's canStand(). Nobody is ever run over: whoever is still inside
// the car's footprint is put outside it at once.
// The knock is a timeline here; the owner (Crowd.js) calls body() each frame after it places the
// person (p.base, their place) and applies the result: p.off (world), drop, clip, pose, hold.
import { Vector3 } from '../engine/index.js';
import { Prop, PROP_KINDS, stain } from './Props.js';
import { Tumbles } from './Tumble.js';
import { collideWalker } from './ArticulatedContacts.js';
import { SwimMotor } from '../player/SwimForces.js';
import { SPRAY } from '../fx/Spray.js';

const PLAYER_R = 0.3, BODY_R = 0.27, SEAT_R = 0.28, KNEES = 0.4, FLINCH = { r: 1.75, speed: 2.2 };   // m from the seat (the row in front of their knees), m/s
const GRADE = { shove: 1.0, tumble: 4.0 };          // m/s toward them (a walk is 3.0, a jog 4.5, a sprint 6.2)
const FRAIL = { elderly: - 0.4, shy: - 0.3, larrikin: 0.6, kid: 0.3 };   // on the tumble: the elderly go down at a jog (3.6), a walk only staggers them
const SEA = 0, WET = 2, SWIM = 1.0, WADE = 1.1;       // m the sea; in the water at once; m/s a swimmer; m deep they walk from
const MASS = { player: 75, adult: 72, kid: 35 }, BOUNCE = 0.2, DECEL = 2.6;   // kg; the knock's restitution; m/s2 their feet stop a shove
const DROP = 0.42;                                  // m: the sit clip's seat down to the ground
const CAR = { slow: 20, w: 1.05, l: 2.45, warn: 1.3 };   // km/h a jump turns to a dive; half width, half length; s of warning
const FETCH = 1.0, BACK = 0.9, AWAY = 2.4;          // m/s to a dropped thing, m/s back to their place; m the wary keep
const EVENT = { nudge: 'nudged', stagger: 'bumped', fall: 'fell', tumble: 'fell', flinch: 'flinch', jump: 'car-near', dive: 'car-near' };

const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * ( 3 - 2 * x );
const out1 = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - ( 1 - x ) * ( 1 - x );
const hump = ( x, a, b ) => x <= a || x >= b ? 0 : Math.sin( Math.PI * ( x - a ) / ( b - a ) );
const dur = ( p, key, def ) => { const c = p.clipOf?.( key ); return c && p.model.clipSet.has( c ) ? p.model.clipDuration( c ) : def; };
const _near = [], _l = new Vector3(), _q = new Vector3(), _w = new Vector3(), _want = new Vector3(), _ro = new Vector3(), _rd = new Vector3(), _sp = new Vector3(), _sv = new Vector3();

export class Contact {

	constructor( hub ) {

		this.hub = hub;
		this.prev = new Vector3(); this.prevOn = false; this.prevAboard = false;
		this.out = { hold: false, drop: 0, tilt: 0, arms: 0, legs: 0, face: null, walk: false, lockYaw: false };
		this.log = [];
		this.stains = [];
		this.count = { nudge: 0, stagger: 0, fall: 0, tumble: 0, flinch: 0, jump: 0, dive: 0, pickup: 0 };
		this.tumbles = new Tumbles( hub );
		this.wet = new Set();

	}

	// A random thing to carry (or `kind`), in the left hand.
	give( p, kind = PROP_KINDS[ Math.floor( Math.random() * PROP_KINDS.length ) ] ) {

		this.release( p );
		p.item = new Prop( kind );
		p.model.group.add( p.item.group );
		return p.item;

	}

	release( p ) {

		const it = p.item;
		if ( ! it ) return;
		it.group.parent?.remove( it.group );
		p.item = null;

	}

	// Each animated frame after the pose: a held prop follows the hand.
	hand( p ) { if ( p.item?.state === 'held' ) p.item.hold( p.model ); }

	// The player's walker after it moved (Player.update). `deck`: FerryDeck aboard her (its local is hers).
	player( pl, dt, deck = null ) {

		const H = this.hub, t = H.t, ship = H.app.ferry?.ship, aboard = !! deck && pl.mode === 'ferry' && !! ship;
		const cur = aboard ? ship.toLocal( pl.position, _l ) : _l.copy( pl.position );
		const ok = this.prevOn && this.prevAboard === aboard && dt > 0;
		let vx = ok ? ( cur.x - this.prev.x ) / dt : 0, vz = ok ? ( cur.z - this.prev.z ) / dt : 0;
		if ( Math.hypot( vx, vz ) > 12 ) vx = vz = 0;     // a teleport, not an approach
		let pushed = false;
		_near.length = 0;
		const speed = Math.hypot( vx, vz );
		for ( const p of H.grid.near( pl.position.x, pl.position.z, 1.4, _near ) ) {

			if ( ! p.world ) continue;
			if ( p.knock?.rag?.rd.phase === 'sim' ) continue; // actual segment contacts run in Tumbles.collide
			const dy = pl.position.y - p.world.y;
			if ( dy < - 0.8 || dy > 1.5 ) continue;
			// seated: the benches keep you off their knees, so running close past them is the knock
			if ( p.posture === 'sit' && speed > FLINCH.speed && ! p.knock && t >= ( p.bumpUntil || 0 ) && Math.hypot( p.world.x - pl.position.x, p.world.z - pl.position.z ) < FLINCH.r ) {

				this.start( p, 'flinch', 0, 0, 0.4 );
				continue;

			}
			// seated, the body you can reach is their knees, a little in front of the seat
			const sit = p.posture === 'sit', r = PLAYER_R + ( sit ? SEAT_R : BODY_R ), kx = sit ? Math.sin( p.yaw || 0 ) * KNEES : 0, kz = sit ? Math.cos( p.yaw || 0 ) * KNEES : 0;
			let dx = p.world.x + kx - pl.position.x, dz = p.world.z + kz - pl.position.z, d = Math.hypot( dx, dz );
			if ( d >= r ) continue;
			const nx = d < 1e-6 ? Math.sin( pl.yaw || 0 ) : dx / d, nz = d < 1e-6 ? Math.cos( pl.yaw || 0 ) : dz / d;             // world, from the player to them
			pl.position.x -= nx * ( r - d ); pl.position.z -= nz * ( r - d );
			pushed = true;
			if ( p.knock || t < ( p.bumpUntil || 0 ) ) continue;
			// the approach, in the walker's frame (hers aboard): the same normal, rotated with her
			const q = aboard ? ship.toLocal( _w.set( p.world.x + kx, p.world.y, p.world.z + kz ), _q ) : _q.set( p.world.x + kx, p.world.y, p.world.z + kz ), lx = q.x - cur.x, lz = q.z - cur.z, ll = Math.hypot( lx, lz ) || 1;
			const vn = ( vx * lx + vz * lz ) / ll, across = ( vx * lz - vz * lx ) / ll;
			const fwdX = Math.sin( p.yaw || 0 ), fwdZ = Math.cos( p.yaw || 0 ), front = - ( fwdX * nx + fwdZ * nz );   // 1: you came at their face
			const adj = FRAIL[ p.brain.type ] || 0, footing = p.footing ? p.footing() : 'open', kid = p.brain.type === 'kid';
			let kind = null;
			if ( sit ) kind = vn > 0.6 ? 'flinch' : null;   // slower is the squeeze past (Brain.sense)
			else if ( vn >= GRADE.tumble + adj && footing === 'open' ) kind = ! kid ? 'tumble' : front > - 0.3 ? 'fall' : 'stagger';
			else if ( vn >= GRADE.shove ) kind = 'stagger';
			else if ( vn > 0.25 || p.posture === 'walk' ) kind = 'nudge';
			const over = ! sit && ! kid && vn >= GRADE.tumble + adj && footing !== 'open' && this.overSide( p, nx, nz );
			if ( over ) kind = 'tumble';
			if ( ! kind ) continue;
			// the knock along the normal, 1D with a little bounce: the speed they carry off, the speed you keep
			const mp = MASS.player, mn = kid ? MASS.kid : MASS.adult, vOut = ( 1 + BOUNCE ) * mp * vn / ( mp + mn ), vKeep = Math.max( 0, ( mp - BOUNCE * mn ) * vn / ( mp + mn ) );
			if ( kind !== 'nudge' && kind !== 'flinch' && kind !== 'tumble' && ! aboard && pl.velocity ) {

				const ux = lx / ll, uz = lz / ll, cut = pl.velocity.x * ux + pl.velocity.z * uz - vKeep;
				if ( cut > 0 ) { pl.velocity.x -= ux * cut; pl.velocity.z -= uz * cut; }

			}
			// a nudge steps aside, off the line you came on; the rest go straight back
			let ox = nx, oz = nz;
			if ( kind === 'nudge' ) { const s = across >= 0 ? - 1 : 1; ox = nx * 0.5 + nz * s; oz = nz * 0.5 - nx * s; const l = Math.hypot( ox, oz ); ox /= l; oz /= l; }
			const physical = kind === 'tumble' ? { position: p.world.clone(), velocity: ( p._bv || new Vector3() ).clone(), mass: mn, supported: true } : null;
			this.start( p, kind, ox, oz, Math.min( 1, Math.max( 0.2, ( vn - 1 ) / 5 ) ), null, front, vOut, over, physical );
			if ( p.knock?.rag && kind === 'tumble' ) {
				// The broad upright overlap selects the reaction, but its radial
				// correction is replaced by contact against the actual physical limbs.
				pl.position.x += nx * ( r - d ); pl.position.z += nz * ( r - d );
				let incoming = pl.velocity.clone();
				if ( aboard ) incoming = ship.toWorld( _w.copy( deck.local ).add( deck.vel ), new Vector3() ).sub( ship.toWorld( deck.local, new Vector3() ) ).add( ship.velocityAt( pl.position, new Vector3() ) );
				const before = incoming.clone(), contacts = collideWalker( p.knock.rag.rd, pl, { velocity: incoming, restitution: BOUNCE } );
				pl.velocity.copy( incoming );
				if ( aboard ) {
					const delta = incoming.clone().sub( before ), localDelta = ship.toLocal( _w.copy( pl.position ).add( delta ), new Vector3() ).sub( ship.toLocal( pl.position, new Vector3() ) );
					deck.vel.add( localDelta );
				}
				p.knock.contacts = contacts;
				p.knock.impulse = contacts.reduce( ( sum, c ) => sum + c.impulse, 0 );
			}
			this.last = { id: p.id, kind: p.knock?.kind, vn: + vn.toFixed( 2 ), vOut: + vOut.toFixed( 2 ), vKeep: + vKeep.toFixed( 2 ), front: + front.toFixed( 2 ), far: p.knock?.far };

		}
		if ( pushed && aboard ) ship.toLocal( pl.position, deck.local );
		( aboard ? ship.toLocal( pl.position, this.prev ) : this.prev.copy( pl.position ) );
		this.prevOn = true; this.prevAboard = aboard;

	}

	// The rally car (every frame, from People.update): an early warning along its heading, and nobody left inside it.
	cars() {

		const H = this.hub, r = H.app.rally, st = r && ( r.active || r.coasting ) && r.state;
		if ( ! st ) return;
		if ( r.active ) this.prevOn = false;     // the walker's first step after the drive is not an approach (an empty car coasting is not driving)
		const v = st[ 7 ] / 3.6, sp = Math.abs( v ), dir = v < 0 ? - 1 : 1;
		const fx = 2 * ( st[ 3 ] * st[ 5 ] + st[ 6 ] * st[ 4 ] ), fz = 1 - 2 * ( st[ 3 ] * st[ 3 ] + st[ 4 ] * st[ 4 ] ), fl = Math.hypot( fx, fz ) || 1;
		const ux = fx / fl, uz = fz / fl;
		_near.length = 0;
		for ( const p of H.grid.near( st[ 0 ], st[ 2 ], 3 + sp * CAR.warn + CAR.l, _near ) ) {

			if ( ! p.world || p.posture === 'sit' || Math.abs( p.world.y - st[ 1 ] ) > 2 ) continue;
			const dx = p.world.x - st[ 0 ], dz = p.world.z - st[ 2 ];
			const along = ( dx * ux + dz * uz ) * dir, across = dx * uz - dz * ux;   // ahead the way it goes; to its right
			const inside = Math.abs( along ) < CAR.l + 0.3 && Math.abs( across ) < CAR.w + 0.3;
			const coming = sp > 0.8 && along > 0 && along < CAR.l + 1 + sp * CAR.warn && Math.abs( across ) < CAR.w + 0.9;
			if ( ! inside && ! coming ) continue;
			const side = across >= 0 ? 1 : - 1, nx = uz * side, nz = - ux * side;
			if ( inside && p.off ) {

				// never under it: out past its side now, where they can stand (else past its end)
				const need = CAR.w + 0.35 - Math.abs( across );
				_w.copy( p.world ).addScaledVector( _want.set( nx, 0, nz ), need );
				if ( ! p.canStand || p.canStand( _w, p.base ) ) p.off.addScaledVector( _want, need );
				else p.off.addScaledVector( _want.set( ux * dir, 0, uz * dir ), CAR.l + 0.35 - along );

			}
			if ( ! p.knock || p.knock.kind === 'nudge' || p.knock.kind === 'stagger' ) {

				const kind = sp * 3.6 > CAR.slow ? 'dive' : inside && sp > 1.5 && ( p.footing ? p.footing() : 'open' ) === 'open' ? 'fall' : 'jump';
				this.start( p, kind, nx, nz, 0.8, new Vector3( st[ 0 ], st[ 1 ] + 1, st[ 2 ] ), 1 );

			}

		}

	}

	// v: the speed the knock gave them (m/s, along n), for the shove's distance and the tumble's launch
	start( p, kind, nx, nz, s = 0.5, at = null, front = 1, v = 0, over = false, physical = null ) {

		const t = this.hub.t, b = p.brain;
		if ( ! p.off ) p.off = new Vector3();
		const narrow = p.footing && p.footing() !== 'open';
		if ( narrow && ! over && ! physical && ( kind === 'fall' || kind === 'dive' || kind === 'tumble' ) ) kind = kind === 'dive' ? 'jump' : 'stagger';
		if ( kind === 'tumble' && ! this.tumbles.can( p ) ) kind = front > - 0.3 ? 'fall' : 'stagger';
		const k = p.knock = { kind, physical, over, t0: t, nx, nz, s, v, stage: 0, off0: p.off.clone(), front, said: false, up: false, fetch: null, pick: 0 };
		if ( kind === 'tumble' && ! this.tumble( p, k ) ) k.kind = kind = front > - 0.3 ? 'fall' : 'stagger';
		if ( kind === 'stagger' && v > 0 ) {

			// the shove: they carry v off and their feet stop it at DECEL, in one or two steps
			k.far = Math.min( 1.3, Math.max( 0.25, v * v / ( 2 * DECEL ) ) );
			k.go = Math.min( 0.9, Math.max( 0.35, 2 * k.far / v ) );
			k.steps = k.far < 0.45 ? 1 : 2;

		}
		p.bumpUntil = t + 1.5;
		this.count[ kind ] ++;
		this.log.push( { t: + t.toFixed( 2 ), id: p.id, kind, s: + s.toFixed( 2 ) } );
		if ( this.log.length > 12 ) this.log.shift();
		b.gesture = null;
		b.bump( t, kind === 'nudge' ? 0.1 : kind === 'flinch' ? 0.3 : kind === 'stagger' ? 0.5 : 0.8, EVENT[ kind ], at );

	}

	// The rig inherits the observed body velocity. An actual contact supplies its
	// point impulse separately; neither an upward kick nor automatic spin is added.
	tumble( p, k ) {

		const g = p.group.position, bv = p._bv || _q.set( 0, 0, 0 );
		const vel = k.physical?.velocity ?? { x: bv.x + k.nx * k.v, y: bv.y, z: bv.z + k.nz * k.v };
		this.drop( p, k );
		k.rag = this.tumbles.start( p, vel, null, null );
		if ( k.rag ) { k.rag.rd.disasterField = this.hub.app.disasters?.field; k.rag.rd.waterY = k.rag.rd.disasterField?.waterAt(g.x,g.z) ?? SEA; }
		if ( k.rag && k.over ) this.wet.add( p );
		return !! k.rag;

	}

	// Environmental falls inherit their measured velocity. Forces, including subsequent
	// debris impulses, determine the motion; no scripted throw is added to a disaster.
	environment( p, velocity = p.evacuation?.velocity ?? p._bv ) {
		if ( p.knock?.rag && ! p.knock.sw && p.knock.rag.rd.phase !== 'idle' ) { const r=p.knock.rag.rd;if(r.phase!=='sim'){r.phase='sim';r.t=0;r.rest=0;p.knock.up=false;}return p.knock; }
		if ( p.knock?.physical ) return p.knock;
		velocity = p.knock?.sw?.velocity || velocity;
		const mass = p.brain?.type === 'kid' ? 35 : 72;
		const physical = { position: p.world.clone(), velocity: velocity?.clone?.() ?? new Vector3(velocity?.x??0,velocity?.y??0,velocity?.z??0), mass, supported: !!p.evacuation?.grounded };
		// A mild animation cannot keep control once an external load topples it.
		if(p.knock){p.knock=null;p.bumpUntil=0;}
		this.start(p,'tumble',1,0,.7,null,1,0,false,physical);
		return p.knock;
	}

	// Missing/unloaded skeletons, or a future population above the explicit64-rig
	// capacity, retain a physical72/35kg capsule. Its animated limbs are not an
	// articulated ragdoll; Tumbles.state exposes the fallback count separately.
	environmentBody( p, k, dt, O ) {
		const b=k.physical,F=this.hub.app.disasters?.field,P=this.hub.app.player,C=this.hub.app.colliders;
		if(!b||k.rag)return;
		const count=Math.max(1,Math.ceil(dt/(1/120))),h=dt/count;
		for(let i=0;i<count;i++){
			const center=_q.copy(b.position).add(_l.set(0,.85,0));
			const a=F?.acceleration(center,b.velocity,{mass:b.mass,area:.7,volume:b.mass/1000,height:1.7,supported:b.supported,dt:h},{})??{ax:0,ay:0,az:0};
			b.velocity.x+=a.ax*h;b.velocity.y+=(a.ay-9.81)*h;b.velocity.z+=a.az*h;
			const oldY=b.position.y;b.position.addScaledVector(b.velocity,h);
			const walker=this.hub.evacuation?.walker,local=walker?.at(b.position.x,b.position.z)??C;
			const floor=walker?walker.ground(b.position.x,b.position.z,Math.max(oldY,b.position.y)+.35):P.groundAt(b.position.x,b.position.z,Math.max(oldY,b.position.y)+.35);
			b.supported=b.position.y<=floor+.001;
			if(b.supported){b.position.y=floor;b.velocity.y=Math.max(0,b.velocity.y);const speed=Math.hypot(b.velocity.x,b.velocity.z),friction=Math.max(0,1-.6*9.81*h/Math.max(1e-6,speed));b.velocity.x*=friction;b.velocity.z*=friction;}
			const x=b.position.x,z=b.position.z;if(local.resolveCapsule(b.position,.27,1.7,.35)){if(Math.abs(b.position.x-x)>.0001)b.velocity.x=0;if(Math.abs(b.position.z-z)>.0001)b.velocity.z=0;}
		}
		_want.copy(b.position).sub(p.base);O.free=true;
	}

	// A body into the sea: the island's spray (thrown droplets, a burst of spray, mist over it) and the big splash
	splash( at, s ) {

		const A = this.hub.app, SEA = A.disasters?.field.waterAt(at.x,at.z) ?? 0, S = A.spray, k = Math.min( 1.4, Math.max( 0.35, s ) );
		if ( S ) {

			_sp.set( at.x, SEA + 0.05, at.z );
			S.emit( _sp, _sv.set( 0, 4 * Math.sqrt( k ), 0 ), Math.round( 150 * k ), 0.03 + 0.02 * k, SPRAY.DROPLET, { spread: 1.8 + 1.4 * k, jitter: 0.3, life: 1.4 } );
			S.emit( _sp, _sv.set( 0, 2.6 * Math.sqrt( k ), 0 ), Math.round( 45 * k ), 0.1 + 0.1 * k, SPRAY.SPRAY, { spread: 1.1 + k, jitter: 0.35, life: 1.2, sizeJitter: 0.6 } );
			S.emit( _sp, _sv.set( 0, 0.9, 0 ), 12, 0.35, SPRAY.MIST, { spread: 0.8, jitter: 0.5, life: 2, sizeJitter: 0.5 } );

		}
		A.audio?.splash?.( 0.55 + 0.3 * Math.min( 1, s ), at );
		this.log.push( { t: + this.hub.t.toFixed( 2 ), kind: 'splash', s: + s.toFixed( 2 ) } );

	}

	// Walkable planks for a knock's step from `base` to `w` (the pier, the terminal, the hire stand): a floor
	// within a step of theirs, and nothing solid across the way at knee height (a rail, a bench, crates).
	// Their own spot inside a box (leaning on a table) does not pin them: only a face ahead counts.
	boards( w, base ) {

		const P = this.hub.app.player, C = this.hub.app.colliders;
		if ( ! P?.groundAt ) return true;
		const g = P.groundAt( w.x, w.z, base.y + 0.4 );
		if ( ! ( Math.abs( g - base.y ) < 0.35 ) ) return false;
		const dx = w.x - base.x, dz = w.z - base.z, l = Math.hypot( dx, dz ), reach = l + BODY_R;
		if ( l < 1e-3 || ! C?.raycast ) return true;
		const h = C.raycast( _ro.set( base.x, base.y + 0.45, base.z ), _rd.set( dx / l, 0, dz / l ), reach );
		return h >= reach - 1e-3 || h < 0.02;

	}

	// Over the side from here, pushed along n: a step or two that way is off their footing, and the sea is under it
	overSide( p, nx, nz ) {

		const P = this.hub.app.player, w = p.world;
		if ( this.wet.size >= WET || ! p.canStand || ! P?.groundAt ) return false;
		for ( const d of [ 0.9, 1.6 ] ) if ( p.canStand( _l.set( w.x + nx * d, w.y, w.z + nz * d ), p.base ) ) return false;
		return P.groundAt( w.x + nx * 2.4, w.z + nz * 2.4, w.y - 0.5 ) < SEA - 0.3;

	}

	// In the sea after the ragdoll floated up: treading water, a line
	dunk( p, k, R, a ) {

		const field = this.hub.app.disasters?.field, water = field?.waterAt( R.at.x, R.at.z ) ?? SEA, neck = 1.5 * ( p.model._tumble?.k ?? 1 );
		const mass = p.brain?.type === 'kid' ? 35 : 72, height = p.brain?.type === 'kid' ? 1.25 : 1.7;
		const velocity = new Vector3();
		if ( k.rag ) for ( const b of k.rag.rd.bodies ) velocity.addScaledVector( new Vector3( b.v.x, b.v.y, b.v.z ), b.m / mass );
		k.sw = { p, at: new Vector3( R.at.x, water - neck + 0.05, R.at.z ), velocity, motor: new SwimMotor( { mass, volume: mass / 1000, height, area: 0.18 * ( height / 1.8 ) ** 2 } ), target: null, state: 'tread', t0: a, waiting: false };
		k.physical = null;
		k.up = true; k.upAt = a;
		p.yaw = R.yaw;
		this.wet.add( p );
		this.count.dunk = ( this.count.dunk || 0 ) + 1;
		p.brain.speak( this.hub.t, 'dunked', 1, true );
		if ( p.item && p.item.state !== 'held' ) { this.release( p ); k.fetch = null; }   // it went over too

	}

	// The nearest dry land or low ramp a swimmer can walk up (24 bearings, 3 m steps, 120 m)
	shore( at ) {

		const P = this.hub.app.player, SEA = this.hub.app.disasters?.field.waterAt(at.x,at.z) ?? 0;
		let best = null, bd = 120;
		for ( let i = 0; i < 24; i ++ ) {

			const b = i / 24 * Math.PI * 2, dx = Math.sin( b ), dz = Math.cos( b );
			for ( let d = 3; d < bd; d += 3 ) {

				const x = at.x + dx * d, z = at.z + dz * d;
				if ( P.groundAt( x, z, SEA + 0.6 ) > SEA + 0.05 ) { bd = d; best = new Vector3( x + dx * 1.5, SEA, z + dz * 1.5 ); break; }

			}

		}
		return best;

	}

	clip( p, name ) {

		const m = p.model;
		if ( ! m.clips.has( name ) ) return false;
		if ( m.current !== name ) m.play( name, { fade: 0.4 } );
		return true;

	}

	// The swimmer: tread, swim for the target (the shore, or where rescue() sent them), wade out, a word, home
	swimming( p, k, a, O, dt ) {

		const S = k.sw, P = this.hub.app.player, SEA = this.hub.app.disasters?.field.waterAt(S.at.x,S.at.z) ?? 0, e = a - S.t0, neck = 1.5 * ( p.model._tumble?.k ?? 1 );
		O.free = true; O.lockYaw = S.state === 'tread';
		const command = new Vector3();
		if ( S.state === 'tread' ) {

			this.clip( p, 'tread' );
			if ( e > 2.5 && ! S.waiting ) { S.target = S.target || this.shore( S.at ); S.t0 = a; if ( S.target ) S.state = 'swim'; }

		} else if ( S.state === 'swim' || S.state === 'wade' ) {

			const dx = S.target.x - S.at.x, dz = S.target.z - S.at.z, d = Math.hypot( dx, dz ), g = P.groundAt( S.at.x, S.at.z, SEA + 0.6 );
			S.state = g > SEA - WADE ? 'wade' : 'swim';
			if ( S.state === 'wade' ) { this.clip( p, 'walk_neutral_01' ) || this.play( p, 'walk', { fade: 0.4 } ); O.walk = true; } else this.clip( p, 'swim' );
			const sp = Math.min( d / Math.max( dt, 1e-6 ), S.state === 'wade' ? 0.9 : SWIM );
			if ( d > 1e-3 ) { command.set( dx / d * sp, 0, dz / d * sp ); O.face = Math.atan2( dx, dz ); }
			if ( g > SEA + 0.02 ) { S.state = 'out'; S.t0 = a; this.wet.delete( p ); p.brain.speak( this.hub.t, 'ashore', 1, true ); this.play( p, p.brain.keepAway || p.brain.traits.humour < 0.4 ? 'angry' : 'shrug', { fade: 0.3, loop: false } ); }
			else if ( d < 0.3 ) { S.state = 'tread'; S.waiting = true; S.target = null; S.t0 = a; }

		} else if ( e > 3 ) {

			// Recovery keeps the reached shore. No offscreen jump across the sea.
			this.wet.delete( p );
			p.swim = null;
			p.recoverAt?.( S.at );
			_want.copy( S.at ).sub( p.base ); p.knock = null; return;

		}
		p.swim = S;
		const g = P.groundAt( S.at.x, S.at.z, SEA + 0.6 );
		S.velocity ||= new Vector3();
		S.motor ||= new SwimMotor( { mass: p.brain?.type === 'kid' ? 35 : 72 } );
		if ( S.state !== 'out' ) {
			const body = { position: S.at.clone().add( _q.set( 0, neck - 0.05, 0 ) ), velocity: S.velocity, environment: this.hub.app.disasters?.field };
			S.motor.advance( body, command, dt );
			const targetY = S.state === 'wade' ? Math.max( g, SEA - WADE ) : SEA - neck + 0.05;
			S.velocity.y += Math.max( - 9.81, Math.min( 9.81, ( targetY - S.at.y ) * 16 - S.velocity.y * 8 ) ) * dt;
			S.at.addScaledVector( S.velocity, dt );
			if ( S.at.y < g ) { S.at.y = g; S.velocity.y = Math.max( 0, S.velocity.y ); }
			this.hub.app.colliders?.resolveCapsule( S.at, BODY_R, 1.7, 0.3 );
		} else S.at.y = g;
		_want.set( S.at.x - p.base.x, S.at.y - p.base.y, S.at.z - p.base.z );

	}

	// dry land all the way from a to b (ten samples)
	dry( a, b ) {

		const P = this.hub.app.player;
		for ( let i = 1; i <= 10; i ++ ) { const f = i / 10; if ( P.groundAt( a.x + ( b.x - a.x ) * f, a.z + ( b.z - a.z ) * f, Math.max( a.y, b.y ) + 0.6 ) < SEA + 0.02 ) return false; }
		return true;

	}

	seen( at ) {

		const c = this.hub.app.camera, E = c.matrixWorld.elements, dx = at.x - c.position.x, dy = at.y - c.position.y, dz = at.z - c.position.z, d = Math.hypot( dx, dy, dz ) || 1;
		return d < 80 && - ( E[ 8 ] * dx + E[ 9 ] * dy + E[ 10 ] * dz ) / d > 0.35;

	}

	swimmers() { return [ ...this.wet ].map( p => p.knock?.sw ).filter( Boolean ); }

	rescue( p, target ) {

		const S = p.knock?.sw;
		if ( ! S || S.state === 'out' ) return false;
		S.target = target.clone ? target.clone() : { x: target.x, y: SEA, z: target.z }; S.state = 'swim'; S.waiting = false;
		return true;

	}

	// The owner's frame while the ragdoll has them (K.rag): the person's groups at the origin (the owner's
	// part), then the body drawn in the world and the head for the bubbles and the looks.
	rag( p, dt ) {

		const r = p.knock?.rag;
		if ( ! r ) return false;
		r.rd.draw( dt, r.avatar );
		r.rd.eye( p.head );
		return true;

	}

	play( p, key, opts ) {

		const clip = p.clipOf?.( key ), m = p.model;
		if ( ! clip || ! m.clipSet.has( clip ) ) return false;
		if ( m.current !== clip ) m.play( clip, opts );
		return true;

	}

	// Each frame, for every person, after the owner put them at their place (p.base = p.world):
	// adds p.off to p.world and returns what to do with the body, or null when there is nothing.
	body( p, dt ) {

		const k = p.knock, O = this.out, t = this.hub.t, o = p.off, it = p.item;
		// the place's own velocity (a walk, her deck under way): a knock carries it on
		const bp = p._bp || ( p._bp = p.base.clone() ), bv = p._bv || ( p._bv = new Vector3() );
		if ( dt > 0 ) { bv.copy( p.base ).sub( bp ).multiplyScalar( 1 / dt ); if ( bv.lengthSq() > 10000 ) bv.set( 0, 0, 0 ); }
		bp.copy( p.base );
		if ( it && it.state !== 'held' && it.fly( p.base, t ) && it.def.spill ) this.spill( p, it );
		this.fade( dt );
		if ( ! k && ( ! o || ( o.lengthSq() < 1e-6 && ! p.brain.keepAway ) ) ) return null;
		O.hold = !! k; O.drop = 0; O.tilt = 0; O.arms = 0; O.legs = 0; O.stepL = 0; O.stepR = 0; O.face = null; O.walk = false; O.lockYaw = false; O.rag = false; O.free = false;
		_want.copy( o );
		if ( k ) { this.knock( p, k, t - k.t0, O, dt ); this.environmentBody(p,k,dt,O); }
		else this.settle( p, dt, O );
		// every step onto walkable ground only (the gangway, the walkway's edge, her rail)
		if ( O.free || ! p.canStand || _want.distanceToSquared( o ) < 1e-8 || p.canStand( _w.copy( p.base ).add( _want ), p.base ) ) o.copy( _want );
		p.world.add( o );
		return O;

	}

	knock( p, k, a, O, dt ) {

		const b = p.brain, n = _w.set( k.nx, 0, k.nz ), fwd = k.front > - 0.3 ? 1 : - 1;
		switch ( k.kind ) {

			case 'nudge':
				_want.copy( k.off0 ).addScaledVector( n, 0.45 * out1( a / 0.45 ) );
				if ( p.posture === 'walk' || a < 0.1 ) this.play( p, 'idle', { fade: 0.25 } );
				if ( a > 0.8 ) p.knock = null;
				return;
			case 'flinch':
				O.tilt = 0.22 * hump( a, 0, 0.9 ); O.arms = 0.35 * hump( a, 0, 0.9 ); O.hold = false;
				b.tuckUntil = this.hub.t + 0.3;
				if ( a > 0.95 ) p.knock = null;
				return;
			case 'stagger':
			case 'jump': {

				const jump = k.kind === 'jump', far = jump ? 1.2 : k.far ?? 0.35 + 0.4 * k.s, go = jump ? 0.35 : k.go ?? 0.4;
				_want.copy( k.off0 ).addScaledVector( n, far * out1( a / go ) );
				O.lockYaw = a < go + 0.3;
				if ( a < 0.1 ) this.play( p, 'idle', { fade: 0.12 } );
				if ( jump || ! k.steps ) { O.arms = hump( a, 0, 1.1 ); O.tilt = 0.3 * fwd * hump( a, 0, 0.9 ); }
				else {

					// arms out for balance, the upper body rocking back and forth as it dies away, a step or two back
					const rock = ( 1 - Math.exp( - 14 * a ) ) * Math.exp( - 2.2 * a ) * Math.cos( 6.5 * a );
					O.tilt = fwd * 0.36 * Math.min( 1, 0.4 + far ) * rock;
					O.arms = hump( a, 0, go + 0.9 ) * ( 0.8 + 0.2 * Math.sin( 11 * a ) );
					const st = a / go * k.steps, lift = st < k.steps ? 0.5 * fwd * Math.sin( Math.PI * ( st % 1 ) ) : 0;
					if ( Math.floor( st ) % 2 ) O.stepR = lift; else O.stepL = lift;

				}
				if ( a > go + 0.7 && ! k.up ) { k.up = true; this.after( p, k ); }
				if ( a > ( jump ? 3.2 : go + 1.8 ) ) p.knock = null;
				return;

			}
			case 'tumble': {

				const r = k.rag, rd = r.rd;
				O.lockYaw = true;
				if ( k.sw ) return this.swimming( p, k, a, O, dt );
				if ( ! k.up ) {

					rd.waterY = this.hub.app.disasters?.field.waterAt(rd.focus.x,rd.focus.z) ?? SEA;
					rd.update( dt );
					if ( ! k.splashed && rd.phase === 'sim' && rd.pelvis.x.y < rd.waterY + 0.25 && rd.pelvis.v.y < - 1 ) { k.splashed = true; this.splash( rd.pelvis.x, Math.min( 1.4, - rd.pelvis.v.y / 5 ) ); }
					if ( rd.phase === 'sim' || rd.phase === 'getup' || rd.phase === 'swim' ) { _want.set( rd.focus.x - p.base.x, rd.focus.y - p.base.y, rd.focus.z - p.base.z ); O.rag = true; O.free = true; return; }
					// on their feet (or it gave up): where the get-up left them, facing its way
					const R = rd.result;
					this.tumbles.end( p, r, R.water );
					if ( R.water ) { this.dunk( p, k, R, a ); return this.swimming( p, k, a, O, dt ); }
					p.recoverAt?.( R.at );
					_want.set( R.at.x - p.base.x, R.at.y - p.base.y, R.at.z - p.base.z );
					p.yaw = R.yaw; k.up = true; k.upAt = a; k.upT = + ( a ).toFixed( 2 );
					this.after( p, k );
					return;

				}
				if ( a < k.upAt + 2.2 ) return;
				return this.fetch( p, k, a, O, dt );

			}
			case 'fall':
			case 'dive': {

				// back (or clear of the car) and down onto the bum, a moment there, then up through a crouch
				const step = k.kind === 'dive' ? 2.2 : 0.55, go = k.kind === 'dive' ? 0.45 : 0.3;
				if ( ! k.up ) _want.copy( k.off0 ).addScaledVector( n, step * out1( a / go ) + 0.25 * ease( ( a - go ) / 0.4 ) );   // up again: the fetch moves them from where they are
				O.lockYaw = a < 3.4;
				if ( a < go ) { O.arms = ease( a / go ); O.tilt = 0.35 * ease( a / go ); if ( a < 0.1 ) this.play( p, 'idle', { fade: 0.12 } ); return; }
				if ( k.stage === 0 ) { k.stage = 1; this.play( p, 'sit', { fade: 0.3 } ); this.drop( p, k ); }
				if ( a < 2.6 ) { const d = ease( ( a - go ) / 0.4 ); O.drop = DROP * d; O.legs = d; O.tilt = 0.35 - 0.08 * d; O.arms = 1 - 0.6 * d; return; }
				if ( a < 3.3 ) {

					if ( k.stage === 1 ) { k.stage = 2; this.play( p, 'crouch', { fade: 0.6 } ); }
					const u = 1 - ease( ( a - 2.6 ) / 0.6 );
					O.drop = DROP * u; O.legs = u; O.tilt = 0.27 * u; O.arms = 0.4 * u;
					return;

				}
				if ( k.stage === 2 ) { k.stage = 3; if ( ! this.play( p, 'crouchOut', { fade: 0.25, loop: false } ) ) this.play( p, 'idle', { fade: 0.9 } ); k.upAt = a + Math.min( 1.4, dur( p, 'crouchOut', 0.9 ) ); }
				if ( a < k.upAt ) return;
				if ( ! k.up ) { k.up = true; this.after( p, k ); }
				if ( a < k.upAt + 2.2 ) return;
				return this.fetch( p, k, a, O, dt );

			}

		}

	}

	// Up again: a glare, a laugh or a shrug by personality, and a line (a spilt coffee gets its own).
	after( p, k ) {

		if ( p.evacuation ) { k.fetch=null;return; }
		const b = p.brain, T = b.traits, t = this.hub.t;
		const key = b.keepAway ? 'angry' : T.humour > 0.7 ? 'laugh' : 'shrug';
		if ( ! this.play( p, key, { fade: 0.3, loop: false } ) ) this.play( p, 'shrug', { fade: 0.3, loop: false } );
		const car = k.kind === 'jump' || k.kind === 'dive';
		const ctx = car ? 'oi-after' : k.spilt ? 'spill' : k.kind === 'fall' || k.kind === 'tumble' ? 'getup' : null;
		if ( ctx ) b.speak( t, ctx, 1, true );
		if ( b.target ) b.engagedUntil = t + 1.5;

	}

	// Knocked down with something in hand: it flies off the way they fell.
	drop( p, k ) {

		const it = p.item;
		if ( ! it || it.state !== 'held' ) return;
		it.hold( p.model );
		// the hand in the world: the model's frame turned by their yaw, at their feet
		const L = it.group.position, c = Math.cos( p.yaw || 0 ), sn = Math.sin( p.yaw || 0 );
		const at = _q.set( L.x * c + L.z * sn, L.y, - L.x * sn + L.z * c ).add( p.group.position );
		p.model.group.remove( it.group );
		this.hub.app.scene.add( it.group );
		it.drop( at, k.nx, k.nz, p.base, this.hub.t );
		k.fetch = it; k.spilt = !! it.def.spill && it.kind === 'coffee';

	}

	spill( p, it ) {

		if ( it.kind !== 'coffee' ) return;
		const s = stain( this.hub.app.scene, _q.copy( p.base ).add( it.rel ).setY( p.base.y + 0.012 ) );
		const ship = this.hub.app.ferry?.ship;
		if ( p.local && ship ) s.local = ship.toLocal( s.mesh.position, new Vector3() );
		this.stains.push( s );

	}

	fade( dt ) {

		if ( ! this.stains.length || this.fadeT === this.hub.t ) return;
		this.fadeT = this.hub.t;
		const ship = this.hub.app.ferry?.ship;
		for ( const s of this.stains ) {

			s.t += dt;
			const k = Math.min( 1, s.t / 0.6 ) * Math.min( 1, ( s.life - s.t ) / 5 );
			s.mesh.scale.set( 0.4 + 0.6 * k, 1, 0.4 + 0.6 * k );
			if ( s.local && ship ) ship.toWorld( s.local, s.mesh.position );
			if ( s.t > s.life ) s.mesh.parent?.remove( s.mesh );

		}
		this.stains = this.stains.filter( s => s.t <= s.life );

	}

	// Over to what they dropped, down for it (a crouch), back up, and home.
	fetch( p, k, a, O, dt ) {

		if ( p.evacuation ) { p.knock=null;return; }
		const it = k.fetch;
		if ( ! it || it !== p.item || it.state === 'held' ) { p.knock = null; return; }
		if ( it.state === 'air' ) return;
		const tx = it.rel.x - 0.3 * k.nx, tz = it.rel.z - 0.3 * k.nz, dx = tx - _want.x, dz = tz - _want.z, d = Math.hypot( dx, dz );
		if ( ! k.pick ) {

			if ( d > 0.06 ) {

				const s = Math.min( d, FETCH * dt );
				_want.x += dx / d * s; _want.z += dz / d * s;
				O.face = Math.atan2( dx, dz ); O.walk = true;
				this.play( p, 'walk', { fade: 0.3 } );
				return;

			}
			k.pick = a;
			O.face = Math.atan2( it.rel.x - _want.x, it.rel.z - _want.z );
			if ( ! this.play( p, 'crouchIn', { fade: 0.2, loop: false } ) ) this.play( p, 'crouch', { fade: 0.5 } );

		}
		O.lockYaw = true;
		const down = Math.min( 1.1, dur( p, 'crouchIn', 0.9 ) );
		if ( a - k.pick > down && it.state === 'ground' ) {

			// in hand again
			this.hub.app.scene.remove( it.group );
			p.model.group.add( it.group );
			it.state = 'held';
			this.count.pickup ++;
			this.log.push( { t: + this.hub.t.toFixed( 2 ), id: p.id, kind: 'pickup', item: it.kind } );
			if ( ! this.play( p, 'crouchOut', { fade: 0.25, loop: false } ) ) this.play( p, 'idle', { fade: 0.8 } );

		}
		if ( a - k.pick > down + 1.2 ) p.knock = null;

	}

	// No knock: back to their place (a walk when it is far), or clear of the player if they are wary.
	settle( p, dt, O ) {

		const P = this.hub.player;
		if ( p.brain.keepAway && P.on ) {

			const dx = p.base.x + _want.x - P.pos.x, dz = p.base.z + _want.z - P.pos.z, d = Math.hypot( dx, dz );
			if ( d < AWAY && Math.abs( P.pos.y - p.base.y ) < 1.5 && _want.length() < 1 ) {

				const s = Math.min( AWAY - d, 0.8 * dt );
				_want.x += dx / ( d || 1 ) * s; _want.z += dz / ( d || 1 ) * s;
				return;

			}

		}
		const d = _want.length();
		if ( d < 1e-3 ) { _want.set( 0, 0, 0 ); return; }
		if ( d > 0.3 && p.posture !== 'walk' && ! p.path ) {

			_want.multiplyScalar( Math.max( 0, d - BACK * dt ) / d );
			O.walk = true; O.face = Math.atan2( - _want.x, - _want.z );
			this.play( p, 'walk', { fade: 0.3 } );
			return;

		}
		_want.multiplyScalar( Math.exp( - dt * 1.5 ) );

	}

	state() {

		return { count: { ...this.count }, log: this.log.slice( - 8 ), stains: this.stains.length, last: this.last || null, tumbles: this.tumbles.state() };

	}

}
