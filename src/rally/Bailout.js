import { Vector3 } from '../engine/index.js';

// Bailing out of a moving car (Y): the driver leaves by the side at the car's own velocity plus a
// sideways jump and a roll, as a real ragdoll (src/player/Ragdoll.js): flies, lands, tumbles and slides
// to a stop, lies still a moment, then gets up and hands back to walking (or treads water). The slow
// motion around it is RallyDrive's (app.warp( bulletTime )). In first person the view rides in his
// tumbling head and eases up to standing eyes as he gets up; in third person the boom follows his pelvis.
// The app skips player.update while this is active, so update() runs the ragdoll frame itself.
const RADIUS = 0.3;
// the pelvis sits about this far under the driver's head in the seat
const SEAT_DROP = 0.62;

export class Bailout {
	constructor( app ) {
		this.app = app;
		this.active = false;
		this.position = new Vector3();
		this.velocity = new Vector3();
		this.spin = new Vector3();
	}

	// from: the driver's head in the car; velocity: the car's; side: unit vector out of the door.
	start( from, velocity, side ) {
		const { player, terrainData: terrain, colliders } = this.app;
		const v = this.velocity.copy( velocity ).addScaledVector( side, 2.5 );
		v.y += 3;
		const planar = Math.hypot( velocity.x, velocity.z );
		// the model faces +z at heading 0: along the travel, or out of the door when stopped
		const heading = planar < 1 ? Math.atan2( side.x, side.z ) : Math.atan2( velocity.x, velocity.z );
		// a sideways roll about the travel, faster the faster the car
		const roll = Math.min( 4, 1 + planar * 0.08 );
		this.spin.set( velocity.x, 0, velocity.z );
		if ( planar < 1 ) this.spin.set( - side.z, 0, side.x );
		this.spin.normalize().multiplyScalar( roll );
		this.position.copy( from ).addScaledVector( side, 0.2 );
		this.position.y -= SEAT_DROP;
		player.rag.trunks = () => this.app.rally?.trunks;
		this.active = player.ragdoll( null, null, { velocity: v, at: this.position, heading, pose: 'ski_sit', spin: this.spin, yeet: true } );
		if ( ! this.active ) {
			// no character to throw (still loading): step out beside the car
			player.position.set( this.position.x, Math.max( terrain.heightAt( this.position.x, this.position.z ), colliders.groundHeightAt( this.position.x, this.position.z, from.y ) ), this.position.z );
			colliders.resolveCapsule( player.position, RADIUS, 1.8 );
			player.mode = 'walk';
			player.velocity.set( 0, 0, 0 );
		}
	}

	// Advances the ragdoll and places the camera; returns true once the driver is on their feet.
	update( dt ) {
		const { player } = this.app;
		if ( player.mode === 'ragdoll' ) player.updateRagdoll( dt );
		return player.mode !== 'ragdoll';
	}

	// Hand over to walking (or swimming): the player already stands where the body came to rest.
	finish() {
		this.active = false;
	}
}
