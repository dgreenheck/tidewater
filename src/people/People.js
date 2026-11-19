// The townsfolk hub (app.people): everyone with a brain, the spatial grid and event bus, the
// smart objects, the speech bubbles, and the detail-by-distance rules. Owners (Crowd.js now, the
// beach crowd next) keep their people's bodies and routes; they register each person here and
// keep three fields current on it: world (feet, Vector3), yaw, posture ('sit' | 'stand' | 'walk'),
// plus head (a Vector3 at eye height, for mates to look at) and can( clipKey ) if clips vary.
// Detail by distance from the camera (p.lod, read by the owner for its animation rate):
//   near (< 25 m): brain at 2 to 5 Hz, staggered; full-rate animation
//   mid (25 to 80 m): brain at 1 Hz; animation every third frame
//   far (> 80 m): no brain, no events, animation frozen
// Each poll (5 Hz) turns the world into events: the ferry horn, the cockatoo flying or landed
// nearby, the player running, jetskis under way, a car driven close. The player's own approach,
// look and squeeze-past are sensed by each brain from the context this hub builds for it.
//   app.people.add( person, { archetype } ), .remove( person ), .say( person, text, key ),
//   .bus.emit / .bus.on, .objects, .charge( ms ), .update( dt ), .state()
import { Vector3 } from '../engine/index.js';
import { Brain, pickArchetype, SEEN } from './Brain.js';
import { Grid, Bus } from './Perception.js';
import { SmartObjects } from './SmartObjects.js';
import { Speech } from './Speech.js';
import { Contact } from './Contact.js';
import { EvacuationAI } from './EvacuationAI.js';
import { setFade, setGroupFade } from './Fade.js';

export const LOD = { near: 25, far: 80 };
const POLL = 0.2, CLOSE = 1.9, FADE = 0.85;   // FADE: how far an occluder fades (Fade.js), a ghost stays   // s between polls; m, a seated person's knees to the player
const _near = [];
const _d = new Vector3(), _l = new Vector3(), _c = new Vector3();

// People CPU meter: smoothed ms plus the peak of the last 2 s (PEAK_FRAMES at 60 fps), kept in a ring of
// numbers scanned by a loop. The push, shift and Math.max( ...window ) it replaced left 2.9 KB of heap a frame
// (test/frame-garbage.mjs).
const PEAK_FRAMES = 120;
export function cpuMeter() { return { ms: 0, peak: 0, hub: 0, window: new Float64Array( PEAK_FRAMES ), filled: 0, at: 0 }; }
export function trackPeak( c, ms ) {

	const w = c.window;
	w[ c.at ] = ms;
	c.at = ( c.at + 1 ) % PEAK_FRAMES;
	if ( c.filled < PEAK_FRAMES ) c.filled ++;
	let peak = - Infinity;
	for ( let i = 0; i < c.filled; i ++ ) if ( w[ i ] > peak ) peak = w[ i ];
	c.peak = peak;

}

export class People {

	constructor( app ) {

		this.app = app;
		this.list = [];
		this.t = 0;
		this.grid = new Grid( 8 );
		this.bus = new Bus( this );
		this.objects = new SmartObjects();
		this.speech = new Speech( app );
		this.evacuation = new EvacuationAI( this );
		this.contact = new Contact( this );    // bumps: the player and the rally car against people (Contact.js)
		if ( app.player ) app.player.people = this;
		this.player = { on: false, pos: new Vector3(), head: new Vector3(), last: new Vector3(), speed: 0, aboard: false, bird: null };
		this.src = { horns: null, bird: 0, run: 0, car: 0, ski: new Map() };
		this.poll = 0;
		this.cost = 0;
		this.cpu = cpuMeter();
		this.ctx = { posture: 'stand', mate: null, player: null };
		this.seen = { d: 0, dy: 0, looking: false, speed: 0, side: 0, head: this.player.head, bird: null };

	}

	add( person, { archetype } = {} ) {

		person.brain = new Brain( person, archetype || pickArchetype(), this );
		person.lod = 'near';
		this.list.push( person );
		return person.brain;

	}

	remove( person ) {

		this.objects.release( person );
		this.speech.drop( person );
		this.contact.release( person );
		const i = this.list.indexOf( person );
		if ( i >= 0 ) this.list.splice( i, 1 );

	}

	say( person, text, key, urgent = false ) { return this.speech.say( person, text, key, this.t, urgent ); }

	// Another system's share of the people CPU this frame (Crowd.update: routes, animation, pose).
	charge( ms ) { this.cost += ms; }

	update( dt ) {

		const t0 = performance.now(), app = this.app;
		this.t += dt;
		this.contact.tumbles.collide( dt );
		// Owners can draw a physical fall instead of their animated pose, and
		// inter-person contacts can redraw it again. Attach worn props only after
		// that final skeleton pose so hats and glasses follow the rendered head.
		for ( const p of this.list ) if ( p.wear ) app.beach?.wearAt( p );
		this.evacuation.update( dt );
		const cam = app.camera.position, dir = app.camera.getWorldDirection( _d );
		this.watchPlayer( dt );
		this.grid.clear();
		for ( const p of this.list ) if ( p.world ) this.grid.add( p );
		if ( ( this.poll -= dt ) <= 0 ) { this.poll = POLL; this.sense(); }
		this.contact.cars();
		this.close();
		for ( const p of this.list ) {

			if ( ! p.world ) continue;
			const d2 = p.world.distanceToSquared( cam );
			p.lod = d2 < LOD.near * LOD.near ? 'near' : d2 < LOD.far * LOD.far ? 'mid' : 'far';
			const b = p.brain;
			if ( p.evacuation ) { b.inbox.length = 0; continue; }
			if ( p.lod === 'far' ) { b.inbox.length = 0; continue; }
			if ( this.t < b.next ) continue;
			b.next = this.t + ( p.lod === 'near' ? 0.2 + Math.random() * 0.3 : 0.9 + Math.random() * 0.2 );
			b.think( this.t, this.context( p, cam, dir ) );

		}
		// see-through (Fade.js): whoever stood between the camera and the player in the last 0.15 s
		for ( const p of this.list ) {

			const f = p.fade || 0, want = this.t - ( p.occludedAt ?? - 9 ) < 0.15 ? FADE : 0;
			if ( f === want ) continue;
			p.fade = Math.abs( want - f ) < 0.02 ? want : f + ( want - f ) * ( 1 - Math.exp( - dt * 12 ) );
			const q = Math.round( p.fade * 50 ) / 50;
			setFade( p.model, q );
			// and what they wear or hold: a hat, sunnies, the bat, a book, a phone
			if ( p.item ) setGroupFade( p.item.group, q );
			if ( p.bat ) setGroupFade( p.bat, q );
			if ( p.wear ) for ( const w of p.wear ) setGroupFade( w.g, q );

		}
		this.speech.update( this.t, app.camera );
		// people CPU per frame: this hub plus what the owners charged, averaged, with the peak of the last 2 s
		const own = performance.now() - t0, ms = own + this.cost;
		this.cost = 0;
		const c = this.cpu;
		c.ms += ( ms - c.ms ) * 0.05;
		c.hub += ( own - c.hub ) * 0.05;
		trackPeak( c, ms );

	}

	context( p, cam, dir ) {

		const ctx = this.ctx, P = this.player;
		ctx.posture = p.posture || 'stand';
		const mate = this.objects.mateOf( p );
		ctx.mate = mate && mate.posture !== 'walk' ? mate : null;   // still walking in: not there yet
		ctx.player = null;
		if ( ! P.on ) return ctx;
		const s = this.seen, dx = P.pos.x - p.world.x, dz = P.pos.z - p.world.z;
		const ex = p.world.x - cam.x, ey = p.world.y + 1.5 - cam.y, ez = p.world.z - cam.z, e = Math.hypot( ex, ey, ez ) || 1;
		s.d = Math.hypot( dx, dz ); s.dy = P.pos.y - p.world.y; s.speed = P.speed; s.bird = P.bird;
		s.looking = ( ex * dir.x + ey * dir.y + ez * dir.z ) / e > SEEN;
		// the player to the person's model +x (their left, facing +z) or -x
		const yaw = p.yaw || 0;
		s.side = dx * Math.cos( yaw ) - dz * Math.sin( yaw );
		ctx.player = s;
		return ctx;

	}

	// ThirdPersonCamera, each frame: people standing across the line from the lens `a` to the player's
	// head `b` fade out (Fade.js) instead of the boom pulling in. Returns how many.
	occlude( a, b ) {

		const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
		if ( L2 < 0.04 ) return 0;
		const L = Math.sqrt( L2 );
		let n = 0;
		_near.length = 0;
		for ( const p of this.grid.near( ( a.x + b.x ) / 2, ( a.z + b.z ) / 2, L / 2 + 1, _near ) ) {

			if ( ! p.world || ! p.model ) continue;
			const f = ( ( p.world.x - a.x ) * dx + ( p.world.z - a.z ) * dz ) / L2;
			if ( f < 0 || f > 1 - 0.45 / L ) continue;   // behind the lens, or the player's own spot
			// the sight lines to the player's head and to their chest (a high chase camera looks down past the
			// head of someone who still hides the player's body)
			const ex = a.x + dx * f - p.world.x, ez = a.z + dz * f - p.world.z, y = a.y + ( b.y - a.y ) * f, yc = y - 0.8 * f;
			if ( ex * ex + ez * ez < 0.25 && y > p.world.y - 0.3 && yc < Math.max( p.head.y + 0.25, p.world.y + 0.5 ) ) { p.occludedAt = this.t; n ++; }

		}
		return n;

	}

	// Every frame (a grid query, a handful of people): whoever sits within CLOSE of the player, so a
	// brain at 2 Hz still catches someone squeezing past at a walk; the first moment thinks at once.
	close() {

		const P = this.player;
		if ( ! P.on ) return;
		_near.length = 0;
		for ( const p of this.grid.near( P.pos.x, P.pos.z, CLOSE, _near ) ) {

			if ( p.posture !== 'sit' || Math.abs( P.pos.y - p.world.y ) > 1.5 ) continue;
			const b = p.brain, yaw = p.yaw || 0;
			if ( this.t - b.closeAt > 0.5 ) b.next = this.t;
			b.closeAt = this.t;
			b.closeSide = ( P.pos.x - p.world.x ) * Math.cos( yaw ) - ( P.pos.z - p.world.z ) * Math.sin( yaw );
			if ( P.speed > 0.3 ) b.passAt = this.t;

		}

	}

	// The player's feet, head and speed (in her frame aboard, so her own way doesn't count).
	watchPlayer( dt ) {

		const app = this.app, pl = app.player, P = this.player;
		P.on = !! pl && ! app.freeCam && ! app.rally?.active && ! app.rally?.bailout?.active;
		if ( ! P.on ) { P.speed = 0; return; }
		const ship = app.ferry?.ship, aboard = !! ship && ( pl.mode === 'ferry' || pl.mode === 'deck' );
		const cur = aboard ? ship.toLocal( pl.position, _l ) : _l.copy( pl.position );
		// across the ground only: a drop or a jump is not running
		// (a jump of a metre in a frame is a teleport, a drop from the free camera or a boarding: not running)
		const step = Math.hypot( cur.x - P.last.x, cur.z - P.last.z );
		P.speed = aboard === P.aboard && dt > 0 && step < 1 ? P.speed * 0.6 + 0.4 * step / dt : 0;
		P.last.copy( cur );
		P.aboard = aboard;
		P.pos.copy( pl.position );
		P.head.copy( pl.position ); P.head.y += 1.6;
		P.bird = app.cockatoo?.mode === 'perched' ? 'perched' : null;

	}

	// The world's event sources, polled.
	sense() {

		const app = this.app, t = this.t, S = this.src, P = this.player;
		const f = app.ferry;
		if ( f ) {

			if ( S.horns !== null && f.horns !== S.horns ) this.bus.emit( 'horn', f.ship.toWorld( _c.set( 0, 14, 0 ), new Vector3() ), 600 );   // her horn, up on her mast
			S.horns = f.horns;

		}
		const c = app.cockatoo;
		if ( c?.pos && ( c.mode === 'flying' || c.mode === 'resting' ) && t > S.bird ) { S.bird = t + 1.5; this.bus.emit( c.mode === 'resting' ? 'bird-landed' : 'bird-near', c.pos, 7 ); }
		if ( P.on && P.speed > 4 && t > S.run ) { S.run = t + 2; this.bus.emit( 'player-run', P.pos, 9 ); }
		for ( const s of app.jetskis?.skis || [] ) {

			const at = s.group?.position || s.position, v = Math.abs( s.ctl?.speed ?? s.speed ?? s.state?.speed ?? 0 );
			if ( at && v > 4 && t > ( S.ski.get( s ) || 0 ) ) { S.ski.set( s, t + 3 ); this.bus.emit( 'jetski', at, 30 ); }

		}
		const r = app.rally, st = r?.active && r.state;
		if ( st && Math.abs( st[ 7 ] ) > 8 && t > S.car ) { S.car = t + 2; this.bus.emit( 'car', new Vector3( st[ 0 ], st[ 1 ], st[ 2 ] ), 8 ); }

	}

	state() {

		const lod = { near: 0, mid: 0, far: 0 };
		for ( const p of this.list ) lod[ p.lod ] ++;
		return { count: this.list.length, lod, cpu: { ms: + this.cpu.ms.toFixed( 3 ), peak: + this.cpu.peak.toFixed( 3 ), hub: + this.cpu.hub.toFixed( 3 ) }, player: { on: this.player.on, speed: + this.player.speed.toFixed( 2 ), aboard: this.player.aboard, bird: this.player.bird },
			speech: this.speech.state(), events: this.bus.log.slice( - 10 ), objects: this.objects.state(), contact: this.contact.state(), evacuation: this.evacuation.state() };

	}

}
