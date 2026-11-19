import * as THREE from '../engine/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { HOUSE } from '../world/boat/Wheelhouse.js';
import { Avatar } from './Avatar.js';
import { ThirdPersonCamera } from './ThirdPersonCamera.js';
import { Ragdoll } from './Ragdoll.js';
import { SwimMotor } from './SwimForces.js';
import { swimmingHeadContact } from './SwimHeadContact.js';

const HOUSE_HELM = { x: HOUSE.helmX, z: HOUSE.seatZ };

const EYE = 1.62;
const SWIM_EYE = EYE * 0.1; // eyes above the body's float point while swimming
const RADIUS = 0.3;
const HEIGHT = 1.75;
// water depth (mean level over the feet) where you start swimming / find your feet again
const SWIM_DEPTH = 1.35;
const STAND_DEPTH = 1.1;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler( 0, 0, 0, 'YXZ' );
const _yAxis = new THREE.Vector3( 0, 1, 0 );
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _wish = new THREE.Vector3();
// Walking trip test (updateWalk). The body the field loads matches the walker's own load call:
// 75 kg, 0.7 m² frontal area, 0.075 m³, 1.8 m tall. _atRest stays (0, 0, 0) m/s.
const _walkBody = { mass: 75, area: 0.7, volume: 0.075, height: 1.8, supported: true, dt: 1 / 60 };
const _atRest = new THREE.Vector3();
const _push = {};
const TRIP_PUSH = 3.2; // m/s²: lateral outside push that knocks a standing adult over (declared stance)
const TRIP_UPDRAFT = 18; // m/s: vertical wind that lifts him off his feet
// walking on the boat
const DECK_RADIUS = 0.24;
const DECK_STEP = 0.36; // highest ledge you step up onto
const HELM_REACH = 0.75; // m from the helm seat to take the wheel
// on foot: over the shoulder (the default), or first person (V, or the HUD button); remembered per browser
export const ON_FOOT = new Set( [ 'walk', 'swim', 'deck', 'ferry' ] );
const VIEW_KEY = 'tidewater.view';
// The articulated body can also contact the ferry through its moving support
// provider. The small fishing boat still has its separate deck controller.
// A big fall on foot: a drop over FALL_DROP m, or landing faster
// than HARD_LANDING m/s
const RAG_MODES = new Set( [ 'walk', 'swim', 'ferry', 'rally', 'jetski', 'jetski-thrown' ] );
const FALL_DROP = 3, HARD_LANDING = 8.5;
function loadView() {

	try {

		return localStorage.getItem( VIEW_KEY ) === 'first' ? 'first' : 'third';

	} catch ( e ) {

		return 'third';

	}

}

const _frame = { show: false, pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), viewHeading: 0, grounded: true, vy: 0, swim: false, view: 'first', attached: true, pitch: 0, cam: null };

// First-person walker / swimmer / boat captain.
//   walk : capsule on terrain + walkable colliders, wading slows you down
//   swim : floats with the head at the surface; look down + W (or C) to dive, Space to rise
//   deck : aboard, walking in the boat's frame (it moves and rocks under you); E at the helm
//          takes the wheel, E near a pier / the beach steps ashore
//   boat : at the helm, driving; V toggles helm (1st person) / chase (3rd person) camera, E stands up
export class Player {

	constructor( { camera, input, terrain, colliders, query, boat, reef = null, audio = null, scene = null } ) {

		this.camera = camera;
		this.input = input;
		this.terrain = terrain;
		this.colliders = colliders;
		this.query = query;
		this.boat = boat;
		this.reef = reef;
		this.audio = audio;

		this.mode = 'walk';
		this.camMode = 'third';
		const start = WORLD.start || WORLD.spawn;
		this.position = new THREE.Vector3().copy( start.position );
		// standing on whatever is there (the boardwalk planks), not in it
		this.position.y = Math.max( terrain.heightAt( this.position.x, this.position.z ), colliders ? colliders.groundHeightAt( this.position.x, this.position.z, 50 ) : - Infinity );
		this.velocity = new THREE.Vector3();
		this.groundProviders = new Set();
		this.obstacleProviders = new Set();
		this._swimHeadCenter = null;
		this.groundSupport = null;
		this.supportLocal = null;
		this.yaw = start.yaw;
		this.pitch = - 0.05;
		this.grounded = false;
		this.bob = 0;
		this.stepDist = 0;
		this.waterH = 0;
		this.waterMean = null; // water level low-passed over ordinary waves
		this.swimMotor = new SwimMotor();
		this.wade = 0;
		// eye height easing between modes (critically damped offset from the mode's eye height)
		this.camOff = 0;
		this.camOffV = 0;
		this._camY = null;
		this.floating = true; // swimming at the surface (riding the waves) vs. free under water
		this.slot = query.allocate( 'player', 1 );
		this.prompt = null;
		this.surface = 'sand';

		// boat cameras
		this.orbitYaw = 0;
		this.orbitPitch = 0.22;
		this.orbitDist = 13;
		this.helmYaw = 0;
		this.helmPitch = - 0.05;
		this.camPos = new THREE.Vector3();
		this.camInit = false;
		this.wasUnder = false;

		// on deck: position and heading in the boat frame (+Z forward, yaw 0 looks forward)
		this.deckPos = new THREE.Vector3();
		this.deckVel = new THREE.Vector3();
		this.deckYaw = 0;
		this.deckGrounded = true;
		this._ashore = null; // cached step-ashore target
		this._ashoreT = 0;
		// set by the fishing game: while a line is out the helm / step ashore prompts give way
		this.busy = false;
		this.jetskis = null; // src/jetski/Jetski.js (set by the app)
		this.aviation = null; // src/aviation/Aviation.js (set by the app): walk-up E at the carrier jet

		// the player's own character and the on-foot view
		this.view = loadView();
		this.boom = new ThirdPersonCamera();
		this.eye = new THREE.Object3D();   // the first-person eye pose, kept in third person (the rod aims from it)
		this.thirdPerson = false;
		this.avatar = scene ? new Avatar( scene ) : null;
		this.rag = new Ragdoll( this );
		this.ragHeadCam = false;  // the car yeet in first person: the view rides the tumbling head
		this.airTop = null;       // highest point of this fall (null: not armed, e.g. just dropped from the free camera)
		this._walkEnd = null;
		this._ragFocus = null;
		this._camOut = null; // the camera height this player last left (first person or the boom)

	}

	// ------------------------------------------------------------------ view

	setView( view ) {

		this.view = view === 'third' ? 'third' : 'first';
		try {

			localStorage.setItem( VIEW_KEY, this.view );

		} catch ( e ) {

			// storage blocked: the choice lasts this visit

		}

	}

	toggleView() {

		this.setView( this.view === 'third' ? 'first' : 'third' );

	}

	// After the mode placed the camera at the eyes: swing it out over the shoulder in third person.
	finishView( dt ) {

		const onFoot = ON_FOOT.has( this.mode );
		const wheel = onFoot ? this.input.consumeWheel() : 0;
		this.thirdPerson = onFoot && this.view === 'third';
		if ( this.thirdPerson ) {

			this.eye.position.copy( this.camera.position );
			this.eye.quaternion.copy( this.camera.quaternion );
			this.boom.apply( this, dt, wheel, { deferSwim: !! this.avatar } );

		} else this.boom.reset();
		this._camOut = this.camera.position.y;

	}

	// The character, every frame (also while the car or the free camera has the view).
	updateAvatar( dt, { attached = true, hidden = false } = {} ) {

		const a = this.avatar;
		if ( ! a ) return;
		const f = _frame;
		const riding = this.mode === 'jetski' || this.mode === 'jetski-thrown';
		// ragdolling (also out of the car: the app hides him while the bailout runs) he is always drawn
		f.rag = this.mode === 'ragdoll' ? this.rag : null;
		f.headcam = this.ragHeadCam;
		if ( f.rag ) hidden = false;
		f.show = ! hidden && ( ON_FOOT.has( this.mode ) || riding || !! f.rag );
		f.ride = riding && this.jetskis ? this.jetskis.rideFrame() : null;
		f.view = this.view;
		f.attached = attached;
		f.pitch = this.pitch;
		f.cam = this.camera;
		f.swim = this.mode === 'swim';
		if ( this.mode === 'ferry' && this.vessel ) {

			// her frame: feet on her deck, turned with her
			const d = this.vessel, ship = d.ferry.ship;
			ship.toWorld( d.local, f.pos );
			f.q.copy( ship.quaternion );
			f.vel.copy( d.vel );
			f.viewHeading = d.yaw;
			f.grounded = d.grounded;
			f.vy = d.vel.y;

		} else if ( this.mode === 'deck' ) {

			const b = this.boat;
			b.toWorld( this.deckPos, f.pos );
			f.q.copy( b.quaternion );
			f.vel.copy( this.deckVel );
			f.viewHeading = this.deckYaw;
			f.grounded = this.deckGrounded;
			f.vy = this.deckVel.y;

		} else {

			f.pos.copy( this.position );
			// swimming, f.pos is the feet of an upright body with its eyes at the swimmer's eyes (the stand-in
			// model treads like that); the swim clips hang the body from the neck by eyeY and waterY instead
			if ( f.swim ) f.pos.y += SWIM_EYE - EYE;
			f.eyeY = this.position.y + SWIM_EYE;
			f.waterY = this.waterH;
			f.floating = this.floating;
			f.q.identity();
			f.vel.copy( this.velocity );
			f.viewHeading = this.yaw + Math.PI;
			f.grounded = this.grounded;
			f.vy = this.velocity.y;

		}

		a.update( dt, f );
		if ( this.mode === 'swim' && f.show && a.visible && Number.isFinite( dt ) && dt > 0 && this.obstacleProviders.size ) {

			// The actual swim pose puts the skull ahead of the upright body.
			// Resolve it once after posing, then carry both the physical anchor and
			// whole displayed body by the same correction. Water/animation add no force.
			a.group.updateMatrixWorld( true );
			const head = swimmingHeadContact( this, this.position, 0 );
			if ( head ) {

				if ( this._swimHeadCenter && this._swimHeadCenter.distanceTo( head.center ) < 2.5 ) head.previousCenter.copy( this._swimHeadCenter );
				const feet = this.position.clone(); feet.y -= EYE - SWIM_EYE;
				const before = feet.clone();
				for ( const obstacle of this.obstacleProviders ) obstacle.resolveCapsule?.( feet, RADIUS, HEIGHT, { velocity: this.velocity, dt, previous: before, head, headOnly: true } );
				const correction = feet.sub( before );
				this.position.add( correction ); a.group.position.add( correction ); a._last?.add( correction );
				this._swimHeadCenter = head.center.clone();
				a.group.updateMatrixWorld( true );

			} else this._swimHeadCenter = null;

		} else if ( this.mode !== 'swim' || ! f.show || ! a.visible ) this._swimHeadCenter = null;

		// A nearby floating wreck must be framed against this displayed pose,
		// including the physical correction above, rather than last frame's skin.
		// The deferred search runs once and never changes the movement heading.
		if ( this.boom?.swimPending ) {

			this.boom.swimPending = false;
			if ( attached && f.show && a.visible && this.thirdPerson ) {

				this.boom.apply( this, dt, 0, { currentPose: true } );
				this._camOut = this.camera.position.y;

			}

		}

	}

	// ------------------------------------------------------------------ ragdoll (src/player/Ragdoll.js)

	// Throw him down as a ragdoll: impulse (kg m/s, world; 75 kg body) at a world point (null: the chest).
	// opts: velocity (the body's, default his own), at (pelvis, world) + heading (model yaw) + pose (a clip
	// name) to place him (the car yeet), spin (world rad/s), yeet (first person keeps the view in his head;
	// otherwise the camera goes third person on the pelvis until he is up). Already ragdolling, the impulse
	// is added. Returns false where it cannot (no character yet, aboard the ferry or the boat).
	ragdoll( impulse = null, point = null, opts = {} ) {

		const a = this.avatar;
		if ( this.mode === 'ragdoll' ) {

			this.rag.push( impulse, point );
			return true;

		}

		if ( ! a || ! a.model || ! RAG_MODES.has( this.mode ) ) return false;
		if ( ! this.rag.start( a, a.group.position, a.group.quaternion, opts.velocity || this.velocity, { ...opts, impulse, point } ) ) return false;
		this.ragFrom = this.mode;
		this.mode = 'ragdoll';
		this.ragHeadCam = !! opts.yeet && this.view === 'first';
		this.prompt = null;
		this.grounded = false;
		this._ragFocus = null;
		return true;

	}

	// every frame while ragdolling (Player.update, or the car's Bailout while the app skips the player)
	updateRagdoll( dt ) {

		const r = this.rag, inp = this.input, cam = this.camera;
		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );
		r.waterY = this.waterH;
		r.update( dt );
		const f = r.focus;
		this.query.setPoint( this.slot, f.x, f.z );
		this.waterH = this.waterHeight();
		this.position.set( f.x, r.floorY, f.z );
		if ( this.ragHeadCam ) {

			r.headCam( cam.position, cam.quaternion, dt );
			this.thirdPerson = false;
			this.boom.reset();

		} else {

			// third person (first person switches to it for the tumble): a smoothed boom on the pelvis
			if ( ! this._ragFocus ) this._ragFocus = f.clone();
			else {

				// eased, but never more than half a metre behind (a fast fall stays in frame)
				const k = this._ragFocus.lerp( f, 1 - Math.exp( - dt * 8 ) ).distanceTo( f );
				if ( k > 0.5 ) this._ragFocus.lerp( f, 1 - 0.5 / k );

			}
			cam.position.copy( this._ragFocus );
			cam.position.y += 0.45;
			cam.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0 ) );
			this.eye.position.copy( cam.position );
			this.eye.quaternion.copy( cam.quaternion );
			this.thirdPerson = true;
			this.boom.apply( this, dt, inp.consumeWheel() );
			// never under the sea while he tumbles across it (the boom keeps its own clearance off the ground)
			if ( this.ragWaterCam !== false ) cam.position.y = Math.max( cam.position.y, this.waterH + 0.35 );

		}

		this._camOut = cam.position.y;
		if ( r.phase === 'done' ) this.finishRagdoll();

	}

	// back on his feet (or treading water) where the body came to rest
	finishRagdoll() {

		const r = this.rag, res = r.result, p = this.position;
		p.copy( res.at );
		if ( res.water ) {

			this.mode = 'swim';
			p.y = this.waterH - SWIM_EYE + 0.1;

		} else {

			this.mode = 'walk';
			this.grounded = true;
			this.colliders.resolveCapsule( p, RADIUS, HEIGHT, 0.4 );

		}

		this.velocity.set( 0, 0, 0 );
		this.yaw = res.yaw - Math.PI;
		if ( this.ragHeadCam ) this.pitch = 0;
		this.ragHeadCam = false;
		this.airTop = p.y;
		this._walkEnd = null;
		this._camY = null;
		r.phase = 'idle';
		if ( this.avatar ) { this.avatar.heading = res.yaw; this.avatar._headingSet = true; }

	}

	// DEBUG HOOK for probes and captures only (the game never calls it): put him at (x, y, z) in 'walk' or 'swim' the way
	// the game lands him there (finishRagdoll's placement: on the ground through the capsule, or floating at the
	// surface), with the velocity zeroed, the low-passed water level re-read on the next frame and the camera easing
	// reset. y is only a hint on land. Returns the mode; update() then keeps or changes it by the usual depth rules.
	debugPlace( x, y, z, mode = 'walk' ) {

		const p = this.position;
		p.set( x, y, z );
		this.velocity.set( 0, 0, 0 );
		if ( mode === 'swim' ) {

			this.mode = 'swim';
			this.floating = true;
			p.y = this.waterH - SWIM_EYE + 0.1;

		} else {

			this.mode = 'walk';
			this.grounded = true;
			p.y = this.groundAt( x, z, y + 2 );
			this.colliders.resolveCapsule( p, RADIUS, HEIGHT, 0.4 );

		}

		this.waterMean = null;
		this.airTop = p.y;
		this._walkEnd = null;
		this._camY = null;
		return this.mode;

	}

	// view direction in world space (for casting); works in every mode
	getViewDir( out ) {

		return out.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );

	}

	// ------------------------------------------------------------------ helpers

	captureWaterState() {

		return { waterH: this.waterH, waterMean: this.waterMean, floating: this.floating,
			grounded: this.grounded, airTop: this.airTop, wade: this.wade, wasUnder: this.wasUnder,
			command: this.swimMotor.command.clone() };

	}

	restoreWaterState( state ) {

		if ( ! state ) return;
		for ( const key of [ 'waterH', 'waterMean', 'floating', 'grounded', 'airTop', 'wade', 'wasUnder' ] ) this[ key ] = state[ key ];
		this.swimMotor.command.copy( state.command );
		this.swimMotor.load = {};
		// WaterQuery permits one pending readback. Discard that removed crest and
		// wait for a fresh result, without altering the other bodies' query slots.
		this._waterFence = { version: ( this.query.version || 0 ) + 2, height: this.waterH };
		this._camY = null;
		this._walkEnd = null;
		// Vessel poses may be restored after the player. Discard the old carry
		// history now; the completed reset or next walk reacquires actual support.
		this.groundSupport = null; this.supportLocal = null; this._supportWorld = null;
		// Restore replaces the pose; the old swim segment is no longer movement.
		this._swimHeadCenter = null;

	}

	waterHeight() {

		const q = this.query;
		if ( this._waterFence ) {

			if ( ! q.cpuValid || q.version < this._waterFence.version ) return this._waterFence.height;
			this._waterFence = null;

		}
		if ( ! q.cpuValid ) return 0;
		const h = q.cpu[ this.slot * 4 ];
		return Number.isFinite( h ) ? h : this.waterH || 0;

	}

	groundAt( x, z, maxY ) {

		let g = this.terrain.heightAt( x, z );
		const c = this.colliders.groundHeightAt( x, z, maxY );
		if ( c > g ) g = c;
		if ( this.reef && this.reef.floorHeightAt ) g = Math.max( g, this.reef.floorHeightAt( x, z ) );
		for ( const provider of this.groundProviders ) g = Math.max( g, provider.groundHeightAt( x, z, maxY ) );
		return g;

	}

	// Moving supports carry a planted foot by their actual transform. Velocity is
	// world velocity, so jumps and physical reactions inherit the deck's motion.
	refreshGroundSupport() {

		let support = null;
		if ( this.grounded ) for ( const provider of this.groundProviders ) {

			const s = provider.supportAt( this.position, { maxRise: 0.06, maxDrop: 0.08 } );
			if ( s && ( ! support || s.height > support.height ) ) support = s;

		}
		this.groundSupport = support;
		this.supportLocal = support?.local?.slice() || null;
		this._supportWorld = support ? this.position.clone() : null;

	}

	resumeOnFoot( { position, velocity = [ 0, 0, 0 ], yaw = this.yaw, pitch = this.pitch, waterHeight = 0, grounded = false, provider = null } ) {

		this.position.fromArray( position ); this.velocity.fromArray( velocity );
		this.yaw = yaw; this.pitch = pitch;
		this.waterH = this.waterMean = Number.isFinite( waterHeight ) ? waterHeight : 0;
		this._waterFence = { version: ( this.query.version || 0 ) + 2, height: this.waterH };
		const floor = this.groundAt( this.position.x, this.position.z, this.position.y + 0.3 );
		// Aircraft exit adapters supply actual feet. A deep-water exit must not
		// be mistaken for standing; swim stores a float point 1.458m above feet.
		this.mode = ! grounded && this.waterH - floor > SWIM_DEPTH && this.position.y < this.waterH + 0.3 ? 'swim' : 'walk';
		if ( this.mode === 'swim' ) this.position.y += EYE - SWIM_EYE;
		this.grounded = grounded && this.mode === 'walk'; this.floating = true;
		this.swimMotor.reset(); this.groundSupport = null; this.supportLocal = null;
		this._swimHeadCenter = null;
		if ( provider ) this.groundProviders.add( provider );
		this.refreshGroundSupport();
		this._camY = null; this._walkEnd = null; this.airTop = this.position.y;
		this.camOff = this.camOffV = this.bob = this.stepDist = 0;
		this.keepFinite( 'activity exit' );
		return this.mode;

	}

	nearBoat() {

		if ( ! this.boat ) return false;
		const bp = this.boat.toWorld( this.boat.model.boardPoint, _v );
		const d = Math.hypot( bp.x - this.position.x, bp.z - this.position.z );
		const dy = Math.abs( bp.y - this.position.y );
		return d < 4.2 && dy < 3.2;

	}

	// A non-finite position (a NaN teleport, a zero-length push or ground normal) must not reach the camera, the
	// water query (the low-passed waterMean would keep it for good) or the renderer's temporal history: he goes
	// back to where he last stood, still, logged once. Same frame, so no NaN pose is ever drawn.
	keepFinite( where ) {

		const p = this.position, v = this.velocity;
		if ( Number.isFinite( p.x + p.y + p.z ) ) {

			if ( Number.isFinite( v.x + v.y + v.z ) ) ( this._good ??= new THREE.Vector3() ).copy( p );
			else v.set( 0, 0, 0 );
			return true;

		}
		if ( ! this._nanWarned ) {

			this._nanWarned = true;
			console.warn( `Player: non-finite position (${ where }), back to the last good one`, { at: p.toArray(), good: this._good?.toArray() } );

		}
		if ( this._good ) p.copy( this._good ); else p.set( Number.isFinite( p.x ) ? p.x : 0, Number.isFinite( p.y ) ? p.y : 2, Number.isFinite( p.z ) ? p.z : 0 );
		v.set( 0, 0, 0 );
		this._camY = null;
		return false;

	}

	// ------------------------------------------------------------------ update

	update( dt ) {

		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		dt = Math.min( dt, 0.1 );
		if ( this.mode !== 'swim' ) this.swimMotor.reset();
		const inp = this.input;
		this.keepFinite( 'set from outside' );
		this.query.setPoint( this.slot, this.position.x, this.position.z );
		this.waterH = this.waterHeight();
		this.waterMean = this.waterMean === null || ! Number.isFinite( this.waterMean ) ? this.waterH : this.waterMean + ( this.waterH - this.waterMean ) * ( 1 - Math.exp( - dt / 4 ) );
		// on a jetski: src/jetski/Jetski.js drives him, the ski and the camera
		if ( this.mode === 'jetski' || this.mode === 'jetski-thrown' ) return;
		if ( this.mode === 'ragdoll' ) {

			this.updateRagdoll( dt );
			return;

		}

		this.prompt = null;
		// V: first / third person on foot (the helms keep V for their own cameras)
		if ( ON_FOOT.has( this.mode ) && inp.hit( 'KeyV' ) ) this.toggleView();

		// Aboard the ferry: her decks and helm are walked in her own frame (src/ferry/FerryDeck.js).
		if ( this.mode === 'ferry' || this.mode === 'ferry-helm' ) {

			if ( this.vessel ) this.vessel[ this.mode === 'ferry' ? 'walk' : 'helm' ]( this, dt );
			// people have bodies: pushed out of theirs, and a bump graded (src/people/Contact.js)
			if ( this.mode === 'ferry' && this.vessel ) this.people?.contact.player( this, dt, this.vessel );
			this.finishView( dt );
			return;

		}

		if ( this.mode === 'boat' ) {

			this.updateBoat( dt );
			return;

		}

		if ( this.mode === 'deck' ) {

			this.updateDeck( dt );
			this.finishView( dt );
			return;

		}

		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );

		// (not with a line out or a fish in hand: E belongs to the fishing then)
		if ( this.nearBoat() && ! this.busy ) {

			this.prompt = { key: 'E', text: 'Board boat' };
			if ( inp.hit( 'KeyE' ) ) {

				this.boardBoat();
				return;

			}

		}

		// jetskis (src/jetski/Jetski.js): ride one, climb aboard from the water, right a capsized one
		if ( this.jetskis && ! this.busy && ! this.prompt ) {

			const o = this.jetskis.offer( this );
			if ( o ) {

				this.prompt = { key: 'E', text: o.text };
				if ( inp.hit( 'KeyE' ) ) {

					o.act();
					return;

				}

			}

		}

		// the carrier fighter (src/aviation/Aviation.js): E beside the jet climbs in
		if ( this.aviation && ! this.busy && ! this.prompt ) {

			const o = this.aviation.offer( this );
			if ( o ) {

				this.prompt = { key: 'E', text: o.text };
				if ( inp.hit( 'KeyE' ) ) {

					o.act();
					return;

				}

			}

		}

		const prevMode = this.mode;
		if ( this.mode === 'walk' ) { this.updateWalk( dt ); if ( this.mode === 'walk' ) this.people?.contact.player( this, dt ); }
		else this.updateSwim( dt );
		if ( this.mode === 'ragdoll' ) return;
		this.keepFinite( this.mode );

		// camera. Wading out of your depth, finding your feet again or climbing out on a ladder
		// changes the eye height: ease the view there (critically damped) instead of jumping
		const eye = this.position.clone();
		if ( this.mode === 'walk' ) eye.y += EYE + Math.sin( this.bob ) * 0.035 * ( 1 - 0.6 * this.wade );
		else eye.y += SWIM_EYE;
		if ( this._camY === null || this.camera.position.y !== this._camOut ) {

			// something else drove the camera since our last frame (free camera, boat): start fresh
			this.camOff = 0;
			this.camOffV = 0;

		} else if ( this.mode !== prevMode ) {

			this.camOff = this._camY - eye.y;

		}

		const w = 6, e = Math.exp( - w * dt ), j = ( this.camOffV + w * this.camOff ) * dt;
		this.camOff = ( this.camOff + j ) * e;
		this.camOffV = ( this.camOffV - w * j ) * e;
		eye.y += this.camOff;
		this.camera.position.copy( eye );
		this._camY = this.camera.position.y;
		this.camera.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, 0 ) );
		this.finishView( dt );

	}

	updateWalk( dt ) {

		const inp = this.input;
		const carrierVelocity = new THREE.Vector3();
		const carried = !! ( this.grounded && this.groundSupport && this.supportLocal );
		if ( carried ) {

			const provider = this.groundSupport.provider, world = provider.world( this.supportLocal );
			this.position.add( _v.fromArray( world ).sub( this._supportWorld ) );
			carrierVelocity.fromArray( provider.velocityAt( this.position.toArray() ) );
			this.velocity.y = carrierVelocity.y;
		} else { this.groundSupport = null; this.supportLocal = null; }
		_fwd.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
		_right.set( - _fwd.z, 0, _fwd.x );
		const wish = new THREE.Vector3();
		if ( inp.down( 'KeyW' ) ) wish.add( _fwd );
		if ( inp.down( 'KeyS' ) ) wish.sub( _fwd );
		if ( inp.down( 'KeyD' ) ) wish.add( _right );
		if ( inp.down( 'KeyA' ) ) wish.sub( _right );
		if ( wish.lengthSq() > 0 ) wish.normalize();

		const depth = this.waterH - this.position.y; // water depth at the feet
		const wade = THREE.MathUtils.clamp( depth / 1.2, 0, 1 );
		this.wade = wade;
		const sprint = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const speed = ( sprint ? 6.2 : 3.0 ) * THREE.MathUtils.lerp( 1, 0.42, wade );
		const accel = this.grounded ? 35 : 2.5;
		const dx = wish.x * speed + carrierVelocity.x - this.velocity.x, dz = wish.z * speed + carrierVelocity.z - this.velocity.z;
		const change = Math.min( 1, accel * dt / ( Math.hypot( dx, dz ) || 1 ) );
		this.velocity.x += dx * change; this.velocity.z += dz * change;
		// The shared field acts after the finite walking motor. Loss of support
		// transfers this measured velocity to the articulated body without a kick.
		if ( this.environment ) {

			const load = this.walkLoad = this.environment.acceleration( _v.copy( this.position ).add( _v2.set( 0, 0.9, 0 ) ), this.velocity,
				{ mass: 75, area: 0.7, volume: 0.075, height: 1.8, supported: this.grounded, dt }, {} );
			this.velocity.x += load.ax * dt; this.velocity.y += load.ay * dt; this.velocity.z += load.az * dt;
			// The trip reads the fluid's own push: the same body sampled at rest. The load above is
			// relative to his velocity, so in calm sea it is his own wading drag (2.8 m/s through
			// 16 cm read 3.24 m/s² against the 3.2 m/s² line), and W rebuilt that speed within
			// 0.1 s of every recovery: the wading ragdoll loop. At rest, calm water and still air
			// push 0; a current, wind, updraft or quake still pushes and still trips.
			_walkBody.supported = this.grounded;
			_walkBody.dt = dt;
			const push = this.environment.acceleration( _v, _atRest, _walkBody, _push );
			if ( ( this.grounded && Math.hypot( push.ax, push.az ) > TRIP_PUSH ) || push.wy > TRIP_UPDRAFT ) {

				if ( this.ragdoll( null, null, { velocity: this.velocity, spin: { x: 0, y: 0, z: 0 } } ) ) {
					this.rag.disasterField = this.environment; this.rag.waterY = this.waterH;
					this.groundSupport = null; this.supportLocal = null; return;
				}

			}

		}

		if ( this.grounded && inp.hit( 'Space' ) && depth < 0.9 ) {

			this.velocity.y = 4.6 + carrierVelocity.y;
			this.grounded = false;
			this.groundSupport = null; this.supportLocal = null;

		}

		this.velocity.y -= 9.81 * dt;
		// water drag while wading
		if ( depth > 0 && ! this.environment ) this.velocity.multiplyScalar( Math.exp( - dt * depth * 0.8 ) );

		const p = this.position;
		const old = p.clone();
		// moved by something else since last frame (the free camera, a respawn): no fall counted from there
		if ( this._walkEnd && old.distanceToSquared( this._walkEnd ) > 4 ) this.airTop = null;
		const vyIn = this.velocity.y, wasGrounded = this.grounded;
		// Input edges, motor, field and gravity belong to the accepted frame once.
		// Sweep its displacement through short contact queries so a slow frame
		// cannot skip several real treads or cross a thin wall in one projection.
		const travel = this.velocity.clone(); if ( carried ) travel.sub( carrierVelocity );
		const steps = Math.max( 1, Math.ceil( dt * 60 ), Math.ceil( travel.length() * dt / 0.15 ) ), h = dt / steps;
		for ( let step = 0; step < steps; step ++ ) {

			const keepStep = this.grounded && this.velocity.y - carrierVelocity.y <= 0;
			p.addScaledVector( this.velocity, h );
			// The provider's full transform already carried us above, including a
			// jump frame. Subtract its velocity exactly once across this whole sweep.
			if ( carried ) p.addScaledVector( carrierVelocity, - h );
			this.colliders.resolveCapsule( p, RADIUS, HEIGHT, 0.4 );
			for ( const provider of this.groundProviders ) provider.resolveCapsule?.( p, RADIUS, HEIGHT, 0.4 );
			const g = this.groundAt( p.x, p.z, p.y + 0.45 );
			// Supported walking can follow a small downward step. An intentional
			// jump, rising body or unsupported ledge keeps its airborne velocity.
			if ( p.y <= g || ( keepStep && p.y - g <= 0.4 ) ) {

				p.y = g;
				// The carried transform is already applied. Remove downward motion
				// relative to it, so later queries cannot lift us off a sinking deck.
				if ( this.velocity.y < carrierVelocity.y ) this.velocity.y = carrierVelocity.y;
				this.grounded = true;

			} else this.grounded = p.y - g < 0.06;
		}
		this.refreshGroundSupport();
		if ( this.groundSupport ) this.velocity.y = this.groundSupport.velocity[ 1 ];
		else if ( this.grounded && this.velocity.y < 0 ) this.velocity.y = 0;

		// a big fall: the ragdoll takes over in the air once the drop passes FALL_DROP, or on a hard landing
		( this._walkEnd || ( this._walkEnd = new THREE.Vector3() ) ).copy( p );
		if ( this.airTop !== null ) {

			const drop = this.airTop - p.y, landed = this.grounded && ! wasGrounded;
			if ( ( ! this.grounded && drop > FALL_DROP && vyIn < - 6 ) || ( landed && vyIn < - HARD_LANDING ) ) {

				if ( this.ragdoll( null, null, { velocity: _v.set( this.velocity.x, vyIn, this.velocity.z ) } ) ) return;

			}

		}

		this.airTop = this.grounded ? p.y : this.airTop === null ? null : Math.max( this.airTop, p.y );

		// head bob + footsteps
		const moved = Math.hypot( p.x - old.x, p.z - old.z );
		// with a walk cycle playing, the bob and the footfalls follow the character's own feet
		// (head lowest as each foot lands); the stand-in avatar has none: bob by distance
		const phase = this.avatar ? this.avatar.stepPhase() : null;
		if ( this.grounded ) {

			if ( phase !== null ) this.bob = phase * Math.PI * 4 - Math.PI / 2;
			else this.bob += moved * 2.4;
			this.stepDist += moved;
			const stride = sprint ? 0.9 : 0.62;
			if ( phase !== null ? this.avatar.takeStep() : this.stepDist > stride ) {

				this.stepDist = 0;
				this.surface = this.surfaceType( depth );
				if ( this.audio ) this.audio.footstep( this.surface );

			}

		}

		// The mean rejects passing chest waves, but cannot delay a crest above the
		// head. Both modes use the same visible body pose: walk stores feet, swim
		// stores the float point. Rising flood never teleports the body to its crest.
		const liveDepth = this.waterH - p.y;
		if ( ( this.waterMean - p.y > SWIM_DEPTH && liveDepth > STAND_DEPTH ) || liveDepth > EYE ) {

			const wadedIn = this.grounded;
			this.mode = 'swim';
			p.y += EYE - SWIM_EYE;
			this.grounded = false;
			this.floating = true;
			this.swimMotor.reset();
			this.velocity.y = wadedIn ? 0 : Math.max( this.velocity.y * 0.3, - 2.5 );
			if ( this.audio ) this.audio.splash( wadedIn ? 0.2 : 0.5, p );

		}

	}

	surfaceType( depth ) {

		const p = this.position;
		if ( depth > 0.12 ) return 'water';
		const onWood = this.colliders.groundHeightAt( p.x, p.z, p.y + 0.1 ) > this.terrain.heightAt( p.x, p.z ) + 0.05;
		if ( onWood ) return 'wood';
		const h = this.terrain.heightAt( p.x, p.z );
		if ( h < 0.6 ) return 'wetsand';
		if ( h > 3.6 ) return 'grass';
		return 'sand';

	}

	updateSwim( dt ) {

		const inp = this.input;
		const p = this.position;
		const surfaceY = this.waterH;
		const previousFeet = p.clone(); previousFeet.y -= EYE - SWIM_EYE;
		// look-relative movement (diving follows the view)
		_fwd.set( 0, 0, - 1 ).applyEuler( _e.set( this.pitch, this.yaw, 0 ) );
		_right.set( - Math.cos( this.yaw ), 0, Math.sin( this.yaw ) ).negate();
		const wish = new THREE.Vector3();
		if ( inp.down( 'KeyW' ) ) wish.add( _fwd );
		if ( inp.down( 'KeyS' ) ) wish.sub( _fwd );
		if ( inp.down( 'KeyD' ) ) wish.add( _right );
		if ( inp.down( 'KeyA' ) ) wish.sub( _right );
		if ( inp.down( 'Space' ) ) wish.y += 1;
		if ( inp.down( 'KeyC' ) || inp.down( 'ControlLeft' ) ) wish.y -= 1;
		if ( wish.lengthSq() > 0 ) wish.normalize();

		const atSurface = this.floating && p.y > surfaceY - 0.45;
		// at the surface W along a level view keeps you on top; looking down dives
		if ( atSurface && wish.y > - 0.25 && ! inp.down( 'KeyC' ) ) wish.y = Math.max( wish.y, 0 );

		const sprint = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const speed = sprint ? 2.5 : 1.5;
		this.swimMotor.advance( this, wish.multiplyScalar( speed ), dt );
		// The same assumed loss-of-control threshold as other exposed people.
		// Release the surface constraint; the articulated solver takes the measured
		// velocity and computes its own subsequent air/water forces without a kick.
		if ( ( this.swimMotor.load.wy > 18 || ( this.floating && surfaceY - p.y > 2 ) ) && this.ragdoll( null, null, { velocity: this.velocity, spin: { x: 0, y: 0, z: 0 } } ) ) {

			this.rag.disasterField = this.environment;
			this.rag.waterY = surfaceY;
			return;

		}


		// A swimmer at the surface floats with the head riding the waves; one who dives stays where
		// they swim to (neutral buoyancy, nothing pulls them back up) until they swim up to the
		// surface again.
		const eyeTarget = surfaceY - SWIM_EYE + 0.1; // eyes ~10 cm above the water; waves still wash over
		const diving = inp.down( 'KeyC' ) || ( inp.down( 'KeyW' ) && this.pitch < - 0.35 ) || wish.y < - 0.1;
		if ( diving ) this.floating = false;
		else if ( p.y > eyeTarget - 0.15 ) this.floating = true;
		if ( this.floating ) {

			// Assumed surface buoyancy/drag controller, acceleration bounded to one
			// g. Its displacement is integrated from velocity, including a sudden
			// crest or trough; water height never teleports the body to the surface.
			const a = THREE.MathUtils.clamp( ( eyeTarget - p.y ) * 16 - this.velocity.y * 8, - 9.81, 9.81 );
			this.velocity.y += a * dt;

		}

		p.addScaledVector( this.velocity, dt );
		this.colliders.resolveCapsule( p, RADIUS, 1.0, 0 );
		if ( this.obstacleProviders.size ) {

			// Dynamic wreck geometry uses an upright body envelope at actual feet;
			// this swim controller stores a float anchor 1.458m above that origin.
			const feet = p.clone(); feet.y -= EYE - SWIM_EYE;
			for ( const obstacle of this.obstacleProviders ) obstacle.resolveCapsule?.( feet, RADIUS, HEIGHT, { velocity: this.velocity, dt, previous: previousFeet } );
			p.copy( feet ); p.y += EYE - SWIM_EYE;

		}
		const g = this.groundAt( p.x, p.z, p.y + 0.3 );
		if ( p.y < g + 0.25 ) p.y = g + 0.25;

		// strokes / bubbles
		this.stepDist += this.velocity.length() * dt;
		if ( this.stepDist > 1.3 ) {

			this.stepDist = 0;
			if ( this.audio ) this.audio.swimStroke();

		}

		const under = this.camera.position.y < surfaceY - 0.05;
		if ( under !== this.wasUnder && this.audio ) {

			if ( under ) this.audio.submerge();
			else this.audio.emerge();

		}

		this.wasUnder = under;

		// The live level vetoes a stale mean while the flood is rising. A retreat
		// below the knees can restore standing immediately, including island reset.
		if ( ( this.waterMean - g < STAND_DEPTH && surfaceY - g < SWIM_DEPTH ) || surfaceY - g < 0.35 ) {

			this.mode = 'walk';
			p.y = g;
			this.velocity.set( this.velocity.x, 0, this.velocity.z );

		}

		// ladders on the pier: climb out when swimming into them
		if ( this.colliders.boxes ) {

			for ( const b of this.colliders.boxes ) {

				if ( b.tag !== 'ladder' ) continue;
				if ( Math.hypot( b.center.x - p.x, b.center.z - p.z ) < 1.1 ) {

					this.prompt = { key: 'Space', text: 'Climb ladder' };
					if ( inp.down( 'Space' ) || inp.down( 'KeyW' ) ) {

						const top = this.colliders.groundHeightAt( b.center.x, b.center.z, 10 );
						if ( top > p.y ) {

							p.y += dt * 1.6;
							if ( p.y > top - 1.0 ) {

								// step onto the deck
								const deck = WORLD.pier.deckHeight;
								p.set( b.center.x - Math.sign( b.center.x - WORLD.pier.x ) * 1.2, deck, b.center.z );
								this.mode = 'walk';
								this.velocity.set( 0, 0, 0 );

							}

						}

					}

					break;

				}

			}

		}

	}

	// ------------------------------------------------------------------ boat

	// step aboard from the pier / beach / water: onto the cockpit sole at the boarding point
	boardBoat() {

		const b = this.boat;
		this.mode = 'deck';
		this.deckPos.copy( b.model.boardPoint );
		this.deckVel.set( 0, 0, 0 );
		// keep looking where you looked (relative to the boat)
		this.deckYaw = this.yaw - ( b.getYaw() + Math.PI );
		this.deckGrounded = true;
		this._ashore = null;
		this._ashoreT = 0;
		this.velocity.set( 0, 0, 0 );
		this._camY = null;
		this.deckToWorld();

	}

	// sit down at the helm and drive (the old "enter boat")
	takeHelm() {

		this.mode = 'boat';
		this.boat.driven = true;
		this.boat.moored = false;
		this.helmYaw = 0;
		this.helmPitch = - 0.05;
		this.orbitYaw = this.boat.getYaw() + Math.PI;
		this.camInit = false;
		if ( this.audio ) this.audio.engineStart();

	}

	// get up from the helm: stand beside the seat, looking forward
	leaveHelm() {

		const b = this.boat;
		b.driven = false;
		b.throttle = 0;
		this.mode = 'deck';
		this.deckPos.set( HOUSE_HELM.x + 0.45, b.model.lines.deckY, HOUSE_HELM.z - 0.1 );
		this.deckVel.set( 0, 0, 0 );
		this.deckYaw = this.helmYaw;
		this.pitch = this.helmPitch;
		this.deckGrounded = true;
		this._camY = null;
		if ( this.audio ) this.audio.engineStop();
		this.deckToWorld();

	}

	// enterBoat() kept for callers: straight to the helm
	enterBoat() {

		this.boardBoat();
		this.takeHelm();

	}

	// target: an ashoreTarget() spot; side: +1 / -1 jumps overboard on the starboard / port side
	exitBoat( target = null, side = 0 ) {

		const b = this.boat;
		const wasDriving = b.driven;
		b.driven = false;
		b.throttle = 0;
		// the exit point closest to something walkable (pier deck / sand)
		let best = side ? null : this.ashoreTarget();

		const dock = WORLD.boatDock.position;
		if ( b.position.distanceTo( dock ) < 14 && b.speed < 1.5 ) {

			b.moored = true;
			b.mooring.anchor.set( b.position.x, 0, b.position.z );
			b.mooring.heading = b.getYaw();

		}

		if ( target ) best = target;
		if ( best ) {

			this.position.set( best.out.x, best.g, best.out.z );
			this.mode = 'walk';

		} else {

			const w = b.toWorld( new THREE.Vector3( 2.2 * ( side || 1 ), 0, 0 ), new THREE.Vector3() );
			// (the boat floats at the water line: the walker's water height is stale while aboard)
			this.waterH = this.waterMean = b.position.y;
			this.position.set( w.x, b.position.y - 0.2, w.z );
			this.mode = 'swim';
			if ( this.audio ) this.audio.splash( 0.8, this.position );

		}

		this.velocity.set( 0, 0, 0 );
		this.yaw = b.getYaw() + Math.PI;
		this._camY = null;
		if ( this.audio && wasDriving ) this.audio.engineStop();

	}

	// best walkable spot next to the boat (pier deck / sand / shallows), or null. Looks straight out
	// from the rail at each exit point (square to the hull, a few reaches: the boat swings on its
	// mooring) for ground from a little below the rail up to a pier deck a climb above it.
	ashoreTarget() {

		const b = this.boat;
		const water = this.query.cpuValid ? this.query.cpu[ 0 ] : 0;
		// the boat's starboard (local +x) direction in the world, level
		const sx = _v2.set( 1, 0, 0 ).applyQuaternion( b.quaternion ).setY( 0 ).normalize();
		const rx = sx.x, rz = sx.z;
		let best = null, bestScore = Infinity;
		for ( const ep of b.model.exitPoints ) {

			const w = b.toWorld( ep, new THREE.Vector3() );
			const sgn = Math.sign( ep.x ) || 1;
			for ( const reach of [ 0.9, 1.4, 2.0 ] ) {

				const out = new THREE.Vector3( w.x + rx * sgn * reach, w.y, w.z + rz * sgn * reach );
				const g = this.groundAt( out.x, out.z, w.y + 2.5 );
				const up = g - w.y;
				if ( up > 1.7 || up < - 1.2 || g < water - 0.3 ) continue;
				const score = Math.abs( up ) + reach * 0.2;
				if ( score < bestScore ) { bestScore = score; best = { out, g, ep }; }

			}

		}

		return best;

	}

	// ------------------------------------------------------------------ deck

	// camera base orientation on the boat: its heading, with roll and pitch half stabilised
	deckBase( out ) {

		const b = this.boat;
		_qa.setFromAxisAngle( _yAxis, b.getYaw() + Math.PI );
		_qb.copy( b.quaternion ).multiply( _qc.setFromAxisAngle( _yAxis, Math.PI ) );
		return out.slerpQuaternions( _qb, _qa, 0.55 );

	}

	// world position / heading of the player from the deck state (feet)
	deckToWorld() {

		const b = this.boat;
		b.toWorld( this.deckPos, this.position );
		this.yaw = b.getYaw() + Math.PI + this.deckYaw;

	}

	// highest walkable box top under the point (boat frame), not above maxY; the sole otherwise
	deckGroundAt( x, z, maxY ) {

		const L = this.boat.model.lines;
		let g = L.deckY;
		for ( const c of this.boat.model.colliders ) {

			if ( ! c.walkable ) continue;
			if ( Math.abs( x - c.center.x ) > c.half.x || Math.abs( z - c.center.z ) > c.half.z ) continue;
			const top = c.center.y + c.half.y;
			if ( top <= maxY && top > g ) g = top;

		}

		return g;

	}

	updateDeck( dt ) {

		const inp = this.input;
		const b = this.boat;
		const L = b.model.lines;
		const look = inp.consumeLook();
		this.deckYaw -= look.x * 0.0022;
		this.pitch = THREE.MathUtils.clamp( this.pitch - look.y * 0.0022, - 1.5, 1.5 );

		// movement in the boat frame (camera base looks along +Z at deckYaw 0)
		const sy = Math.sin( this.deckYaw ), cy = Math.cos( this.deckYaw );
		_fwd.set( sy, 0, cy );
		_right.set( - cy, 0, sy );
		_wish.set( 0, 0, 0 );
		if ( inp.down( 'KeyW' ) ) _wish.add( _fwd );
		if ( inp.down( 'KeyS' ) ) _wish.sub( _fwd );
		if ( inp.down( 'KeyD' ) ) _wish.add( _right );
		if ( inp.down( 'KeyA' ) ) _wish.sub( _right );
		if ( _wish.lengthSq() > 0 ) _wish.normalize();
		const speed = ( inp.down( 'ShiftLeft' ) ? 2.6 : 1.6 );
		const k = 1 - Math.exp( - 12 * dt );
		const v = this.deckVel;
		v.x += ( _wish.x * speed - v.x ) * k;
		v.z += ( _wish.z * speed - v.z ) * k;
		if ( this.deckGrounded && inp.hit( 'Space' ) ) {

			v.y = 3.2;
			this.deckGrounded = false;

		}

		v.y -= 9.81 * dt;
		const p = this.deckPos;
		const oldX = p.x, oldZ = p.z;
		p.addScaledVector( v, dt );

		// walls: push out of the solid boxes you can't step onto (boat frame, axis aligned)
		for ( let iter = 0; iter < 2; iter ++ ) for ( const c of b.model.colliders ) {

			if ( ! c.solid ) continue;
			const top = c.center.y + c.half.y, bot = c.center.y - c.half.y;
			if ( top <= p.y + DECK_STEP || bot >= p.y + HEIGHT ) continue;
			const ex = c.half.x + DECK_RADIUS, ez = c.half.z + DECK_RADIUS;
			const dx = p.x - c.center.x, dz = p.z - c.center.z;
			if ( Math.abs( dx ) >= ex || Math.abs( dz ) >= ez ) continue;
			const px = ex - Math.abs( dx ), pz = ez - Math.abs( dz );
			if ( px < pz ) { p.x += Math.sign( dx || ( oldX - c.center.x ) || 1 ) * px; v.x = 0; }
			else { p.z += Math.sign( dz || ( oldZ - c.center.z ) || 1 ) * pz; v.z = 0; }

		}

		// stay inside the hull (the bulwarks, plus a margin fore and aft)
		p.z = THREE.MathUtils.clamp( p.z, L.zAft + L.shell + DECK_RADIUS, 4.0 );
		const halfIn = Math.max( 0.15, L.halfBreadth( L.tAtSheerZ( p.z ), Math.max( p.y, L.deckY ) ) - L.shell - DECK_RADIUS );
		p.x = THREE.MathUtils.clamp( p.x, - halfIn, halfIn );

		const g = this.deckGroundAt( p.x, p.z, p.y + DECK_STEP );
		if ( p.y <= g ) {

			p.y = g;
			if ( v.y < 0 ) v.y = 0;
			this.deckGrounded = true;

		} else this.deckGrounded = p.y - g < 0.04;

		// footsteps on the deck
		const moved = Math.hypot( p.x - oldX, p.z - oldZ );
		if ( this.deckGrounded ) {

			this.bob += moved * 2.4;
			this.stepDist += moved;
			if ( this.stepDist > 0.6 ) {

				this.stepDist = 0;
				if ( this.audio ) this.audio.footstep( 'wood' );

			}

		}

		this.deckToWorld();

		// prompts: take the helm, or step ashore
		const hx = HOUSE_HELM.x, hz = HOUSE_HELM.z;
		const nearHelm = Math.hypot( p.x - hx, p.z - hz ) < HELM_REACH && ! this.busy;
		this._ashoreT -= dt;
		if ( this._ashoreT <= 0 ) {

			this._ashoreT = 0.25;
			this._ashore = b.speed < 2.5 ? this.ashoreTarget() : null;

		}

		if ( nearHelm ) {

			this.prompt = { key: 'E', text: 'Take the helm' };
			if ( inp.hit( 'KeyE' ) ) {

				this.takeHelm();
				return;

			}

		} else if ( ! this.busy ) {

			// at the rail: step ashore where there is ground on that side, else jump into the sea
			const ep = this._ashore && this._ashore.ep;
			const atRail = b.model.exitPoints.some( ( e ) => Math.hypot( p.x - e.x, p.z - e.z ) < 1.3 );
			if ( ep && Math.hypot( p.x - ep.x, p.z - ep.z ) < 1.3 ) {

				this.prompt = { key: 'E', text: 'Step ashore' };
				if ( inp.hit( 'KeyE' ) ) {

					this.exitBoat( this._ashore );
					return;

				}

			} else if ( atRail ) {

				this.prompt = { key: 'E', text: 'Jump overboard' };
				if ( inp.hit( 'KeyE' ) ) {

					this.exitBoat( null, Math.sign( p.x ) || 1 );
					return;

				}

			}

		}

		// camera: eye above the feet, following the boat's motion
		const eyeL = _v.set( p.x, p.y + EYE + Math.sin( this.bob ) * 0.02, p.z );
		b.toWorld( eyeL, this.camera.position );
		this._camY = this.camera.position.y;
		this.deckBase( _q );
		this.camera.quaternion.copy( _q ).multiply( _qa.setFromEuler( _e.set( this.pitch, this.deckYaw, 0 ) ) );

	}

	updateBoat( dt ) {

		const inp = this.input;
		const b = this.boat;
		const look = inp.consumeLook();
		const wheel = inp.consumeWheel();

		if ( inp.hit( 'KeyV' ) ) this.camMode = this.camMode === 'first' ? 'third' : 'first';
		if ( inp.hit( 'KeyE' ) ) {

			this.leaveHelm();
			return;

		}

		let throttle = 0;
		if ( inp.down( 'KeyW' ) ) throttle = inp.down( 'ShiftLeft' ) ? 1 : 0.7;
		if ( inp.down( 'KeyS' ) ) throttle = - 0.6;
		let steer = 0;
		if ( inp.down( 'KeyA' ) ) steer += 1;
		if ( inp.down( 'KeyD' ) ) steer -= 1;
		b.setInput( throttle, steer, dt );
		this.prompt = { key: 'E', text: 'Leave helm   ·   V  camera' };

		// keep the player attached (for audio / queries)
		b.toWorld( b.model.helmEye, this.position );
		this.position.y -= EYE;

		if ( this.camMode === 'first' ) {

			this.helmYaw = THREE.MathUtils.clamp( this.helmYaw - look.x * 0.0022, - 2.2, 2.2 );
			this.helmPitch = THREE.MathUtils.clamp( this.helmPitch - look.y * 0.0022, - 1.2, 1.0 );
			const eye = b.toWorld( b.model.helmEye, new THREE.Vector3() );
			this.camera.position.copy( eye );
			// head partially stabilises against roll and pitch (feels natural, less nausea)
			const boatQ = b.quaternion;
			const yawOnly = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), b.getYaw() + Math.PI );
			const base = new THREE.Quaternion().slerpQuaternions( boatQ.clone().multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI ) ), yawOnly, 0.55 );
			const local = new THREE.Quaternion().setFromEuler( _e.set( this.helmPitch, this.helmYaw, 0 ) );
			this.camera.quaternion.copy( base ).multiply( local );

		} else {

			this.orbitYaw -= look.x * 0.003;
			this.orbitPitch = THREE.MathUtils.clamp( this.orbitPitch + look.y * 0.003, - 0.05, 1.2 );
			this.orbitDist = THREE.MathUtils.clamp( this.orbitDist * ( 1 + wheel * 0.08 ), 6, 40 );
			// gently swing behind the boat when moving
			if ( b.speed > 2 && Math.abs( look.x ) < 0.5 ) {

				const behind = b.getYaw() + Math.PI;
				let d = behind - this.orbitYaw;
				d = Math.atan2( Math.sin( d ), Math.cos( d ) );
				this.orbitYaw += d * ( 1 - Math.exp( - dt * 0.8 ) );

			}

			const target = b.toWorld( new THREE.Vector3( 0, 1.4, 0 ), new THREE.Vector3() );
			const off = new THREE.Vector3(
				Math.sin( this.orbitYaw ) * Math.cos( this.orbitPitch ),
				Math.sin( this.orbitPitch ),
				Math.cos( this.orbitYaw ) * Math.cos( this.orbitPitch )
			).multiplyScalar( this.orbitDist );
			const want = target.clone().add( off );
			want.y = Math.max( want.y, this.waterH + 0.7 );
			if ( ! this.camInit ) {

				this.camPos.copy( want );
				this.camInit = true;

			}

			this.camPos.lerp( want, 1 - Math.exp( - dt * 6 ) );
			this.camera.position.copy( this.camPos );
			this.camera.lookAt( target );

		}

	}

}
