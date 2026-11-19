import { Vector3, Quaternion } from '../engine/index.js';
import { Colliders } from '../world/Colliders.js';
import { loadVehicle } from './VehicleModel.js';
import { CATCH_UP_PHYSICS_STEPS } from '../core/SimulationPacing.js';
import { Bailout } from './Bailout.js';
import { bindWheels, poseWheel } from './WheelRig.js';
import { VEHICLES } from './Vehicles.js';
import { TyreTracks } from './TyreTracks.js';
import { EngineSound } from './EngineSound.js';
import { SharedDrive } from './SharedDrive.js';
import { CarLights } from './CarLights.js';
import { DriveHUD } from './DriveHUD.js';
import { clearSpawn, recoverySpot } from './Spawn.js';
import { CarWater } from './CarWater.js';
import { Damage } from './Damage.js';
import { terrainMaterialCodes, trunkCylinders, cameraPlants } from './WorldPhysics.js';
import './rally.css';

const SURFACE_ASPHALT = 3, SURFACE_WOOD = 5;   // rally-physics Surface codes

const UP = new Vector3( 0, 1, 0 );
const smoothstep = x => { const t = Math.min( 1, Math.max( 0, x ) ); return t * t * ( 3 - 2 * t ); };
// Bailing out: full speed for the shout and the leap, then a fifth speed in the air, easing
// back to full speed around the landing (seconds of unslowed time).
const bulletTime = t => t > 2.6 ? null : t < 1.1 ? 1 - 0.8 * smoothstep( ( t - 0.45 ) / 0.15 ) : 0.2 + 0.8 * smoothstep( ( t - 1.1 ) / 1.5 );
// The walker's old spawn at (18, -60) contains decorative dinghies. The
// vehicle needs a full chassis-sized patch and a clear launch along the beach.
const SPAWN = { x: - 55, z: - 64, yaw: Math.PI / 2 };
// A driftwood box (DebrisPlacement._logCollider: length along x, girth across z, from 10 cm
// under the sand to the top of the piece) as the car meets it. Trunk sections are long for
// their girth and stay whole: thin ones are climbed, big ones (2.6 m and up, 35 to 70 cm
// thick) stop the car. Gnarled branch pieces are short for their spread; their box is the
// spread of thin limbs, which a car rolls over, so the car sees only the thick wood: a low
// bump its tyres climb (LOG_BUMP metres at most) under the middle half of the spread.
const LOG_BUMP = 0.12;
// Lens clearance probes for the chase boom: [ up, sideways ] metres off the lens.
const LENS_EDGES = [ [ 0.5, 0 ], [ 0.1, 0.45 ], [ 0.1, - 0.45 ] ];
const _side = new Vector3(), _probe = new Vector3();
const NEAR_LENS = 3;   // m: a banana crown within this of the lens, along the boom, pulls it in (at most this far)
function carBox( b ) {
	const { center: c, half: h } = b;
	const girth = 2 * h.z / 0.95;
	if ( b.tag !== 'log' || 2 * h.x >= 3 * girth ) return [ c.x, c.y, c.z, h.x, h.y, h.z ];
	const bottom = c.y - h.y, top = Math.min( c.y + h.y, bottom + 0.1 + Math.min( LOG_BUMP, 0.3 * girth ) );
	return [ c.x, ( top + bottom ) / 2, c.z, h.x, ( top - bottom ) / 2, h.z * 0.5 ];
}

export class RallyDrive {
	constructor( app ) {
		this.app = app;
		this.active = false;
		this.assists = true;
		this.vehicleKey = 'aster';
		this.profile = VEHICLES.aster;
		this.spawnOffset = 0;
		this.destination = 'beach';
		this.sound = new EngineSound( app.qs.has( 'noAudio' ) );
		this.spin = [ 0, 0, 0, 0 ];
		// Signed whole turns each drawn wheel has rolled (telemetry: a spec holds the turns to the road driven).
		this.turns = [ 0, 0, 0, 0 ];
		this.forward = new Vector3();
		this.up = new Vector3();
		this.stepPose = new Quaternion();
		this.bailout = new Bailout( app );
		this.coasting = false; this.coastTime = 0;
		this.bailSide = new Vector3(); this.bailHead = new Vector3(); this.bailVelocity = new Vector3();
		this.drawn = new Float32Array( 0 );
		this.cameraTarget = new Vector3();
		this.cameraDesired = new Vector3();
		this.cameraDir = new Vector3();
		this.quaternion = new Quaternion();
		this.cameraReady = false;
		this.cameraYaw = 0;
		this.orbit = { yaw: 0, pitch: 0, idle: 0 };
		this.lastPosition = new Vector3();
		this.velocity = new Vector3();
		this.uiTime = 0;
	}

	async init() {
		const base = new URL( `${ import.meta.env.BASE_URL }rally/`, document.baseURI ).href;
		// Every drivable car in Vehicles.js is loaded up front, so the picker swaps cars without a wait.
		const keys = Object.keys( VEHICLES );
		const [ module, wagon, pickup, ...cars ] = await Promise.all( [
			import( /* @vite-ignore */ `${ base }rally_physics.js` ),
			loadVehicle( 'support_wagon' ), loadVehicle( 'support_pickup' ),
			...keys.map( key => loadVehicle( VEHICLES[ key ].file ) ),
		] );
		this.models = Object.fromEntries( keys.map( ( key, i ) => [ key, cars[ i ] ] ) );
		const aster = this.models.aster;
		await module.default( { module_or_path: `${ base }rally_physics_bg.wasm` } );
		this.physics = new module.RallyPhysics();
		this.model = aster;
		this.wheels = bindWheels( aster, this.profile );
		const { terrainData: terrain, colliders, scene } = this.app;
		if ( ! this.physics.set_terrain( terrain.heights, terrain.res, terrain.size, terrain.origin ) ) throw new Error( 'Rally terrain collision could not be created' );
		if ( terrain.roads ) this.physics.set_roads( terrain.roads.physicsData() );
		// Sand, wet sand, soil and rock grip from the terrain splat; trunks a car can hit.
		this.physics.set_surface_map( terrainMaterialCodes( terrain ) );
		this.trunks = trunkCylinders( this.app.vegetation, terrain );
		// camera-only: banana plants the chase boom treats as obstacles (never solid to the car)
		( { stems: this.cameraStems, crowns: this.crowns } = cameraPlants( this.app.vegetation, terrain ) );
		this.physics.add_cylinders( this.trunks );
		this.water = new CarWater( { query: this.app.query, terrain, spray: this.app.spray, physics: this.physics } );
		this.placeSupport( wagon, - 5, - 76, - 0.2, 2.5 );
		this.placeSupport( pickup, - 17, - 78, 0.25, 2.8 );
		// Every static box, each with its surface: the terminal's lanes and linkspan are asphalt,
		// piers and boardwalks wood.
		// Loose props and fence panels (src/physics/Props.js) are not static: they wake as bodies near the car.
		const statics = colliders.boxes.filter( b => ( b.solid || b.walkable ) && ! b.prop );
		this.physics.add_surface_boxes( new Float32Array( statics.flatMap( b => [
			...carBox( b ), b.rotY, b.tag.includes( 'pier' ) ? 0.8 : 0.65,
		] ) ), new Uint8Array( statics.map( b => b.tag === 'terminal-car' ? SURFACE_ASPHALT : SURFACE_WOOD ) ) );
		this.physics.add_cylinders( new Float32Array( colliders.cylinders.filter( c => ! c.prop ).flatMap( c => [ c.x, c.z, c.radius, c.yMin, c.yMax ] ) ) );
		// head, tail and brake lights (before the damage rig, which draws the lenses these give each car)
		this.lights = {};
		for ( const key of keys ) {
			const car = this.models[ key ];
			scene.add( car.root );
			car.root.visible = car === aster;
			this.lights[ key ] = new CarLights( this.app.localLights, car.root );
		}
		this.tracks = new TyreTracks( scene, terrain );
		this.damage = new Damage( this );
		this.cameraColliders = new Colliders();
		this.cameraColliders.boxes = colliders.boxes.slice();
		// Roofs have no walking collider: over each building footprint the chase boom also meets
		// its roof and a 0.9 m eave overhang, so the lens never tucks under an eave.
		for ( const b of colliders.boxes ) {
			if ( ! b.solid || b.tag === 'log' || b.half.y < 1.2 || Math.min( b.half.x, b.half.z ) < 1.2 ) continue;
			this.cameraColliders.addBox( new Vector3( b.center.x, b.center.y + b.half.y + 0.6, b.center.z ),
				new Vector3( b.half.x + 0.9, 0.9, b.half.z + 0.9 ), b.rotY, { tag: 'camera-eave' } );
		}
		// Added after exporting the static collision world: the physics car must
		// never collide with its own walking-controller proxy.
		this.walkingProxy = colliders.addBox( new Vector3(), new Vector3( 0.96, 0.8, 2.25 ), SPAWN.yaw, { tag: 'rally-car' } );
		this.reset();
		// Settle the original springs before showing the car or handing over control.
		// 3 s in 25 ms calls: 3 fixed steps each, inside the disaster cap (DISASTER_MAX_STEPS) too.
		for ( let i = 0; i < 120; i ++ ) this.physics.advance( 0.025, 0, 0, 0, 1 );
		this.syncModel( 0 );
		this.shared = new SharedDrive( this );
	}

	placeSupport( model, x, z, yaw, halfLength ) {
		const { terrainData: terrain, colliders, scene } = this.app;
		model.root.position.set( x, terrain.heightAt( x, z ), z );
		// Align parked wheels with the local terrain plane.
		const normal = new Vector3( terrain.heightAt( x - 1, z ) - terrain.heightAt( x + 1, z ), 2,
			terrain.heightAt( x, z - 1 ) - terrain.heightAt( x, z + 1 ) ).normalize();
		model.root.quaternion.setFromUnitVectors( UP, normal ).multiply( new Quaternion().setFromAxisAngle( UP, yaw ) );
		scene.add( model.root );
		const collider = colliders.addBox( new Vector3( x, model.root.position.y + 0.85, z ), new Vector3( 1, 0.85, halfLength ), yaw, { tag: 'parked-rally-car' } );
		(this.supports ||= []).push({model,collider,halfLength});
	}

	// The nearest drivable car within `radius` metres of `pos` (flat distance, within a
	// storey vertically), or null. Only the selected car (one of Vehicles.js) can be
	// driven today; the support wagon and pickup are parked props. Extend the list here
	// when more drivable cars are placed around the island.
	nearCar( pos, radius = 7 ) {
		if ( this.active || ! this.model || ! pos ) return null;
		let best = null;
		for ( const [ key, model ] of [ [ this.vehicleKey, this.model ] ] ) {
			const car = model.root.position;
			if ( ! model.root.visible || Math.abs( pos.y - car.y ) > 3 ) continue;
			const distance = Math.hypot( pos.x - car.x, pos.z - car.z );
			if ( distance < radius && ( ! best || distance < best.distance ) ) best = { key, model, distance };
		}
		return best;
	}

	// A new start is a fresh car; recover passes keepDamage so a wreck stays a wreck.
	reset( keepDamage = false ) {
		if ( ! keepDamage ) this.damage?.repair();
		const terrain = this.app.terrainData;
		const preferred = this.destination === 'beach' ? { ...SPAWN, x: SPAWN.x + this.spawnOffset }
			: this.destination === 'ferry' && this.app.terminal ? this.app.terminal.queueSpot()
				: this.destination === 'joey' && this.app.joeyTerminal ? this.app.joeyTerminal.queueSpot()
				: terrain.roads.spawn( this.destination );
		const spawn = clearSpawn( terrain, this.app.colliders, { ...preferred, trunks: this.trunks }, this.peerPositions() );
		this.place( spawn );
	}

	// Standard-mapping gamepad: left stick steers, right/left triggers are throttle/brake,
	// A or right bumper is the handbrake, Y recovers and B bails out (on press). Null without a pad.
	gamepad() {
		const pads = navigator.getGamepads?.() || [];
		const pad = [ ...pads ].find( p => p && p.connected && p.mapping === 'standard' ) || [ ...pads ].find( p => p && p.connected );
		if ( ! pad ) return null;
		const button = i => pad.buttons[ i ]?.value ?? ( pad.buttons[ i ]?.pressed ? 1 : 0 );
		const x = pad.axes[ 0 ] || 0, dead = 0.12;
		const recover = button( 3 ) > 0.5 && ! this.padRecover;
		this.padRecover = button( 3 ) > 0.5;
		const yeet = button( 1 ) > 0.5 && ! this.padYeet;
		this.padYeet = button( 1 ) > 0.5;
		return { steer: Math.abs( x ) < dead ? 0 : Math.sign( x ) * ( Math.abs( x ) - dead ) / ( 1 - dead ),
			throttle: button( 7 ), brake: button( 6 ), handbrake: button( 0 ) > 0.5 || button( 5 ) > 0.5, recover, yeet };
	}

	// Disaster fractures ask here instead of rebuilding inline. A tornado frame could break a
	// house and fell trees together, and each rebuild walks every trunk, box and cylinder on the
	// island and rebuilds the BVH, so the requests coalesce into one rebuild before the next step.
	requestIslandColliders() {
		this.islandCollidersStale = true;
	}

	refreshIslandColliders() {
		this.islandCollidersStale = false;
		const {colliders}=this.app;
		this.physics.clear_island_statics();
		this.trunks=trunkCylinders(this.app.vegetation,this.app.terrainData);
		this.physics.add_cylinders(this.trunks);
		const boxes=colliders.boxes.filter(b=>(b.solid||b.walkable)&&!b.prop&&b!==this.walkingProxy);
		this.physics.add_surface_boxes(new Float32Array(boxes.flatMap(b=>[...carBox(b),b.rotY,b.tag.includes("pier")?0.8:0.65])),new Uint8Array(boxes.map(b=>b.tag==="terminal-car"?SURFACE_ASPHALT:SURFACE_WOOD)));
		this.physics.add_cylinders(new Float32Array(colliders.cylinders.filter(c=>!c.prop&&c.yMax>c.yMin).flatMap(c=>[c.x,c.z,c.radius,c.yMin,c.yMax])));
	}

	peerPositions() { return [ ...( this.shared?.peers.values() || [] ) ].map( peer => peer.model.root.position ); }

	place( spot ) {
		const terrain = this.app.terrainData;
		this.physics.reset( spot.x, terrain.heightAt( spot.x, spot.z ) + 0.45, spot.z, spot.yaw );
		this.coasting = false;
		this.spin.fill( 0 );
		this.tracks?.reset();
		this.cameraReady = false;
		this.syncModel( 0 );
		this.refreshUI();
	}

	// Back on four wheels on the nearest clear dry ground, keeping the heading: after a
	// roll, when stuck, or when afloat. Falls back to the chosen start if nothing is clear.
	recover( automatic = false ) {
		const position = this.model.root.position;
		const spot = Number.isFinite( position.x + position.z ) && recoverySpot( this.app.terrainData, this.app.colliders, position, this.forward, this.peerPositions(), this.trunks );
		if ( spot ) this.place( spot ); else this.reset( true );
		if ( automatic ) this.app.game.toast( 'Car recovered' );
	}

	selectVehicle( key ) {
		if ( ! VEHICLES[ key ] || key === this.vehicleKey ) return;
		this.model.root.visible = false;
		this.vehicleKey = key;
		this.profile = VEHICLES[ key ];
		this.model = this.models[ key ];
		this.model.root.visible = true;
		this.damage?.select();
		this.wheels = bindWheels( this.model, this.profile );
		this.physics.select_vehicle( this.profile.id );
		this.walkingProxy.half.fromArray( this.profile.proxy );
		this.walkingProxy.radius = Math.hypot( this.walkingProxy.half.x, this.walkingProxy.half.z );
		this.reset();
		this.app.input.keys.clear();
		this.app.input.pressed.clear();
		this.refreshUI();
		if ( this.active ) this.sound.resume( key );
		this.app.engine.domElement.focus();
	}

	repair() {
		this.damage?.repair();
		this.refreshUI();
	}

	toggleAssists() {
		this.assists = ! this.assists;
		this.physics.set_assists( this.assists );
		this.refreshUI();
	}

	enter() {
		if ( this.app.chairlift?.active ) return this.app.chairlift.message( 'Exit the chairlift at a terminal before driving.' );
		const { game, input, player, ui } = this.app;
		if ( game.fight || game.landing || game.hud?.invOpen || game.hud?.standOpen ) return;
		game.rod.equip( false );
		game.bite = null;
		this.app.freeCam = false;
		this.active = true;
		this.coasting = false;
		player.mode = 'rally';
		player.prompt = null;
		player.velocity.set( 0, 0, 0 );
		input.keys.clear();
		input.pressed.clear();
		input.consumeLook();
		this.cameraReady = false;
		this.refreshUI();
		this.app.engine.domElement.focus();
		if ( ui ) ui.ui.setPrompt( null );
		this.app.audio?.resume();
		this.sound.resume( this.vehicleKey );
	}

	// Y (B on a pad): jump out of the moving car. The driver tumbles along the ground at the
	// car's speed (see Bailout) and the empty car rolls on until it stops.
	yeet() {
		if ( ! this.active || this.bailout.active ) return;
		const { input } = this.app, root = this.model.root;
		const side = this.bailSide.crossVectors( this.up, this.forward ).normalize();
		// Out past the door, clear of the car's own walking box: a ragdoll started inside it is
		// thrown out of it by the box resolve while the car drags it along, and flew 20 to 90 m.
		const out = ( this.walkingProxy?.half.x ?? 0.96 ) + 0.15;
		const head = this.bailHead.copy( root.position ).addScaledVector( side, out ).addScaledVector( this.up, 1.0 );
		const velocity = this.bailVelocity.set( this.velocity.x, this.state[ 94 ] ?? 0, this.velocity.z );
		this.active = false;
		this.app.freeCam = false;
		this.coasting = true; this.coastTime = 0;
		this.restoreLens();
		this.bailout.start( head, velocity, side );
		if ( this.app.settings.bailShout !== false ) this.sound.yeet( !! this.app.audio?.muted );
		this.app.warp?.( bulletTime );
		input.keys.clear();
		input.pressed.clear();
		input.consumeLook();
		this.refreshUI();
	}

	leave() {
		const { player, terrainData: terrain, colliders, input } = this.app;
		this.active = false;
		this.leftAt = performance.now();
		this.restoreLens();
		this.app.freeCam = false;
		// Safe dry ground next to the car, falling back to the beach after a dunk.
		const car = this.model.root.position;
		let exit = new Vector3( car.x, car.y, car.z );
		for ( const side of [ - 1, 1 ] ) {
			const trial = new Vector3( side * 2.2, 0, 0 ).applyQuaternion( this.model.root.quaternion ).add( car );
			trial.y = Math.max( terrain.heightAt( trial.x, trial.z ), colliders.groundHeightAt( trial.x, trial.z, car.y + 2 ) );
			if ( trial.y > 0.8 ) { exit = trial; break; }
		}
		if ( exit.y < 0.8 ) exit.set( SPAWN.x - 3, terrain.heightAt( SPAWN.x - 3, SPAWN.z ), SPAWN.z );
		colliders.resolveCapsule( exit, 0.3, 1.8 );
		player.position.copy( exit );
		player.mode = 'walk';
		player.grounded = true;
		player.yaw = Math.atan2( - this.forward.x, - this.forward.z );
		player.pitch = - 0.1;
		player.velocity.set( 0, 0, 0 );
		input.keys.clear();
		input.pressed.clear();
		input.consumeLook();
		this.refreshUI();
		this.app.engine.domElement.focus();
	}

	update( dt ) {
		if ( ! this.physics ) return;
		if ( this.islandCollidersStale ) this.refreshIslandColliders();
		if ( ! this.panel && this.app.ui ) this.buildUI();
		const { input, player, game } = this.app;
		const controls = this.active && ! this.app.freeCam && input.enabled && ! game.guide?.open && ! game.hud?.invOpen && ! game.hud?.standOpen;
		const pad = controls ? this.gamepad() : null;
		if ( controls && ( input.hit( 'KeyR' ) || pad?.recover ) ) this.recover();
		if ( controls && input.hit( 'KeyE' ) ) this.leave();
		if ( controls && input.hit( 'KeyJ' ) ) this.toggleAssists();
		if ( controls && ( input.hit( 'KeyY' ) || pad?.yeet ) ) this.yeet();
		const down = code => controls && this.active && input.down( code );
		// Keyboard is all-or-nothing; a gamepad adds analog steering and pedals on top.
		const keySteer = Number( down( 'KeyD' ) || down( 'ArrowRight' ) ) - Number( down( 'KeyA' ) || down( 'ArrowLeft' ) );
		const throttle = Math.max( down( 'KeyW' ) || down( 'ArrowUp' ) ? 1 : 0, pad?.throttle || 0 );
		const brake = Math.max( down( 'KeyS' ) || down( 'ArrowDown' ) ? 1 : 0, pad?.brake || 0 );
		const steer = keySteer || pad?.steer || 0;
		// A car its driver has jumped from rolls on, off the handbrake, until it stops.
		if ( this.coasting && ( this.active || ( ( this.coastTime += dt ) > 1 && Math.abs( this.state[ 7 ] ) < 2 ) ) ) this.coasting = false;
		const handbrake = ! this.coasting && ( ! controls || ! this.active || down( 'Space' ) || pad?.handbrake ) ? 1 : 0;
		this.water?.update( this.model.root, this.forward, this.profile );
		// 3 steps a frame only while a disaster runs; otherwise the 0.1 s catch-up (SimulationPacing).
		this.physics.set_max_steps( this.app.simulationPacing?.physicsSteps ?? CATCH_UP_PHYSICS_STEPS );
		this.physics.advance( dt, throttle, brake, steer, handbrake );
		this.syncModel( dt );
		for ( const [ key, lights ] of Object.entries( this.lights || {} ) ) lights.update( dt, key === this.vehicleKey && ( this.active || this.coasting ), brake );
		this.damage?.update( dt );
		this.water?.splash( dt, this.drawn, this.model.root, this.forward, this.profile );
		this.tracks.tick( dt );
		this.tracks.emit( 'local', this.drawn, this.profile );
		this.sound.update( this.state, throttle, this.active, !! this.app.audio?.muted,
			this.model.root.position.distanceTo( this.app.camera.position ) );
		this.shared?.update( dt );
		const position = this.model.root.position;
		// The sea floats cars now; only a car that has left the world entirely is rescued.
		if ( ! Number.isFinite( position.x + position.y + position.z ) || position.y < - 40 || Math.abs( position.x ) > 1010 || Math.abs( position.z ) > 1010 ) {
			this.recover( true );
		}
		if ( this.active ) {
			player.position.copy( position );
			player.mode = 'rally';
			player.yaw = Math.atan2( - this.forward.x, - this.forward.z );
			if ( ! this.app.freeCam ) this.updateCamera( dt );
		} else if ( this.bailout.active && ! this.app.freeCam && this.bailout.update( dt ) ) {
			this.bailout.finish();
		}
		this.uiTime += dt;
		if ( this.uiTime > 0.1 ) { this.refreshUI(); this.uiTime = 0; }
	}

	syncModel( dt ) {
		const s = this.state = this.physics.snapshot();
		const root = this.model.root;
		// Physics runs whole fixed steps, so a frame can get none or two: draw the car between
		// its last two steps (RallyPhysics.blend) and it moves evenly at any frame rate.
		const blend = this.physics.blend?.();
		if ( blend ) {
			const a = blend[ 7 ];
			root.position.set( blend[ 0 ] + ( s[ 0 ] - blend[ 0 ] ) * a, blend[ 1 ] + ( s[ 1 ] - blend[ 1 ] ) * a, blend[ 2 ] + ( s[ 2 ] - blend[ 2 ] ) * a );
			root.quaternion.fromArray( blend, 3 ).slerp( this.stepPose.fromArray( s, 3 ), a );
		} else {
			root.position.fromArray( s, 0 );
			root.quaternion.fromArray( s, 3 );
		}
		// Marks and spray follow the drawn car: the snapshot with the drawn pose and contacts.
		if ( this.drawn.length !== s.length ) this.drawn = new Float32Array( s.length );
		const drawn = this.drawn;
		drawn.set( s );
		const ox = root.position.x - s[ 0 ], oy = root.position.y - s[ 1 ], oz = root.position.z - s[ 2 ];
		root.position.toArray( drawn, 0 );
		root.quaternion.toArray( drawn, 3 );
		if ( drawn.length >= 69 ) for ( let w = 0; w < 4; w ++ ) { const i = 29 + w * 10; drawn[ i ] += ox; drawn[ i + 1 ] += oy; drawn[ i + 2 ] += oz; }
		this.forward.set( 0, 0, 1 ).applyQuaternion( root.quaternion );
		this.up.set( 0, 1, 0 ).applyQuaternion( root.quaternion );
		for ( let i = 0; i < 4; i ++ ) {
			const offset = 13 + i * 4;
			const angle = s[ offset + 2 ] / this.wheels[ i ].radius * dt;
			this.spin[ i ] = ( this.spin[ i ] + angle ) % ( Math.PI * 2 );
			this.turns[ i ] += angle / ( Math.PI * 2 );
			poseWheel( this.wheels[ i ], this.profile.mount - s[ offset ], s[ offset + 1 ], this.spin[ i ] );
		}
		const proxy = this.walkingProxy;
		if ( proxy ) {
			proxy.center.copy( root.position ); proxy.center.y += proxy.half.y;
			proxy.rotY = Math.atan2( this.forward.x, this.forward.z );
			proxy.cos = Math.cos( proxy.rotY ); proxy.sin = Math.sin( proxy.rotY );
			proxy.top = proxy.center.y + proxy.half.y; proxy.bottom = proxy.center.y - proxy.half.y;
		}
	}

	// Distance along a ray to the first palm or tree trunk (the car-only trunk cylinders; or the
	// list given, such as the banana stems), so the chase camera comes in front of a trunk instead
	// of hiding the car behind it.
	trunkHit( origin, dir, length, t = this.trunks ) {
		let best = Infinity;
		if ( ! t ) return best;
		const flat = Math.hypot( dir.x, dir.z );
		if ( flat < 1e-4 ) return best;
		const dx = dir.x / flat, dz = dir.z / flat;
		for ( let i = 0; i < t.length; i += 5 ) {
			const ox = t[ i ] - origin.x, oz = t[ i + 1 ] - origin.z, r = t[ i + 2 ] + 0.3;
			const along = ox * dx + oz * dz;
			if ( along < 0 || along > length * flat + r ) continue;
			const side = ox * dz - oz * dx;
			if ( Math.abs( side ) > r ) continue;
			const d = ( along - Math.sqrt( r * r - side * side ) ) / flat, y = origin.y + dir.y * d;
			if ( d > 0 && d < best && y > t[ i + 3 ] && y < t[ i + 4 ] ) best = d;
		}
		return best;
	}

	// Chase camera: follows the car's heading on the ground plane, leaning toward the
	// direction of travel in a slide, pulling back with speed. Mouse or drag orbits it;
	// it settles back behind the car when the mouse rests.
	updateCamera( dt ) {
		const { camera, terrainData: terrain, input } = this.app;
		const position = this.model.root.position;
		if ( ! this.cameraReady ) { this.lastPosition.copy( position ); this.velocity.set( 0, 0, 0 ); }
		else if ( dt > 0 ) this.velocity.lerp( this.cameraDir.subVectors( position, this.lastPosition ).divideScalar( dt ), 1 - Math.exp( - dt * 10 ) );
		this.lastPosition.copy( position );
		const planar = Math.hypot( this.velocity.x, this.velocity.z );
		let heading = Math.atan2( this.forward.x, this.forward.z );
		if ( this.up.y < 0.3 ) heading = this.cameraYaw; // on its side or roof: hold the view
		const forwardSpeed = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
		if ( planar > 4 && forwardSpeed > 0 ) {
			const travel = Math.atan2( this.velocity.x, this.velocity.z );
			const slip = Math.atan2( Math.sin( travel - heading ), Math.cos( travel - heading ) );
			heading += slip * 0.45 * Math.min( 1, ( planar - 4 ) / 6 );
		}
		const look = input.consumeLook();
		const orbit = this.orbit;
		if ( look.x || look.y ) { orbit.yaw -= look.x * 0.004; orbit.pitch = Math.max( - 0.25, Math.min( 0.9, orbit.pitch + look.y * 0.003 ) ); orbit.idle = 0; }
		else if ( ( orbit.idle += dt ) > 1.5 ) { const k = 1 - Math.exp( - dt * 2.5 ); orbit.yaw -= orbit.yaw * k; orbit.pitch -= orbit.pitch * k; }
		if ( ! this.cameraReady ) this.cameraYaw = heading;
		else this.cameraYaw += Math.atan2( Math.sin( heading - this.cameraYaw ), Math.cos( heading - this.cameraYaw ) ) * ( 1 - Math.exp( - dt * 5 ) );
		const yaw = this.cameraYaw + orbit.yaw;
		const pull = 1 + Math.min( 1, planar / 40 ) * 0.22;
		const distance = this.profile.camera * pull, height = this.profile.cameraHeight * pull;
		const ahead = this.cameraDir.set( Math.sin( yaw ), 0, Math.cos( yaw ) );
		this.cameraTarget.copy( position ).addScaledVector( UP, 1.0 ).addScaledVector( ahead, 1.5 );
		this.cameraDesired.copy( position ).addScaledVector( ahead, - distance * Math.cos( orbit.pitch ) ).addScaledVector( UP, height + distance * Math.sin( orbit.pitch ) );
		this.cameraDesired.y = Math.max( this.cameraDesired.y, terrain.heightAt( this.cameraDesired.x, this.cameraDesired.z ) + 1.0 );
		this.cameraDir.subVectors( this.cameraDesired, this.cameraTarget );
		const length = this.cameraDir.length();
		this.cameraDir.normalize();
		const hit = this.boomHit( length );
		if ( hit < length ) this.cameraDesired.copy( this.cameraTarget ).addScaledVector( this.cameraDir, Math.max( 1, hit - 0.4 ) );
		if ( this.cameraReady ) camera.position.lerp( this.cameraDesired, 1 - Math.exp( - dt * 9 ) );
		else camera.position.copy( this.cameraDesired );
		camera.position.y = Math.max( camera.position.y, terrain.heightAt( camera.position.x, camera.position.z ) + 0.6 );
		camera.lookAt( this.cameraTarget );
		// The lens widens as speed builds (up to 12 degrees by 160 km/h) so pace reads on screen.
		this.restFov ??= camera.fov;
		const wide = this.restFov + 12 * Math.min( 1, planar / 44 ) ** 1.3;
		camera.fov = this.cameraReady ? camera.fov + ( wide - camera.fov ) * ( 1 - Math.exp( - dt * 3 ) ) : wide;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld();
		this.cameraReady = true;
	}

	// How far the boom can reach from the car towards the lens: the centre line (buildings and
	// trunks) and three more rays to just above and beside the lens, so an eave over it or a
	// wall at its side pulls it in before the lens is under or inside them. Foliage is not in
	// the way, except a banana plant's: its stem through its crown stops the boom like a trunk, and
	// its leaf spread within NEAR_LENS of the lens pulls the lens in front of it (crownHit).
	boomHit( length ) {
		const target = this.cameraTarget, dir = this.cameraDir;
		let best = Math.min( this.cameraColliders.raycast( target, dir, length ), this.trunkHit( target, dir, length ),
			this.trunkHit( target, dir, length, this.cameraStems ), this.crownHit( target, dir, length ) );
		_side.set( dir.z, 0, - dir.x ).normalize();
		for ( const [ up, side ] of LENS_EDGES ) {
			_probe.copy( dir ).multiplyScalar( length ).addScaledVector( UP, up ).addScaledVector( _side, side );
			const reach = _probe.length();
			const hit = this.cameraColliders.raycast( target, _probe.divideScalar( reach ), reach );
			if ( hit < reach ) best = Math.min( best, hit / reach * length );
		}
		return best;
	}

	// Where the boom's last NEAR_LENS m runs through a banana crown (a cylinder of its leaf spread,
	// between its leaf heights): the lens comes in to where it enters, but never more than NEAR_LENS,
	// so leaves at the lens never fill the frame and a crown far down the boom never yanks it.
	crownHit( origin, dir, length ) {
		const c = this.crowns;
		let best = Infinity;
		if ( ! c ) return best;
		const flat = Math.hypot( dir.x, dir.z );
		if ( flat < 1e-4 ) return best;
		const dx = dir.x / flat, dz = dir.z / flat, reach = length * flat, from = length - NEAR_LENS;
		for ( let i = 0; i < c.length; i += 5 ) {
			const ox = c[ i ] - origin.x, oz = c[ i + 1 ] - origin.z, r = c[ i + 2 ];
			const along = ox * dx + oz * dz;
			if ( along + r < from * flat || along - r > reach ) continue;
			const side = ox * dz - oz * dx;
			if ( Math.abs( side ) > r ) continue;
			const half = Math.sqrt( r * r - side * side );
			let d0 = Math.max( 0, along - half ) / flat, d1 = Math.min( reach, along + half ) / flat;
			// the part of that span between the leaf heights
			const a = ( c[ i + 3 ] - origin.y ) / dir.y, b = ( c[ i + 4 ] - origin.y ) / dir.y;
			if ( Math.abs( dir.y ) > 1e-4 ) { d0 = Math.max( d0, Math.min( a, b ) ); d1 = Math.min( d1, Math.max( a, b ) ); }
			else if ( origin.y < c[ i + 3 ] || origin.y > c[ i + 4 ] ) continue;
			if ( d1 > from && d0 < d1 ) best = Math.min( best, Math.max( d0, from ) );
		}
		return best;
	}

	// Out of the car the lens goes back to its own width.
	restoreLens() {
		if ( this.restFov === undefined ) return;
		this.app.camera.fov = this.restFov;
		this.app.camera.updateProjectionMatrix();
	}

	buildUI() {
		// All HUD markup, styling and per-frame gauge motion live in DriveHUD.
		this.hud = new DriveHUD( this );
		this.panel = this.hud.build();
		this.refreshUI();
	}

	refreshUI() {
		if ( ! this.panel || ! this.state ) return;
		this.hud.refresh();
	}
}
