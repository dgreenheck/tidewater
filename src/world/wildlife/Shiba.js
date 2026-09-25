import { Group, Vector3 } from '../../engine/index.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { SkinnedModel } from '../../engine/render/Skinning.js';
import { STAND } from '../../game/FishStand.js';

// A friendly beach dog close to the pier approach. The source model is authored in centimetres,
// hence the 0.01 scale when it is placed in Tidewater's metre-based world.
// Clear sand at the right side of Joe's stall, just beside (not on) the long crate.
// Align the dog with the boardwalk/pier route rather than aiming across it.
const _shibaOffset = new Vector3( 3.15, 0, 0.15 ).applyAxisAngle( new Vector3( 0, 1, 0 ), STAND.yaw );
const _shibaSpot = new Vector3( STAND.x + _shibaOffset.x, 0, STAND.z + _shibaOffset.z );
export const SHIBA = { x: _shibaSpot.x, z: _shibaSpot.z, yaw: 5 * Math.PI / 12 };
const REST_POSES = [ '0|standing_0', '0|sitting_0' ];
const CLOSE_TRICKS = [ '0|shake_0', '0|rollover_0' ];
const DISTANT_BEHAVIORS = [ ...REST_POSES, '0|play_dead_0' ];

export class Shiba {

	constructor( { scene, terrain } ) {

		this.position = new Vector3( SHIBA.x, terrain.heightAt( SHIBA.x, SHIBA.z ), SHIBA.z );
		this.group = new Group();
		this.group.name = 'ShibaInu';
		this.group.position.copy( this.position );
		this.group.rotation.y = SHIBA.yaw;
		scene.add( this.group );
		this.model = null;
		this.behaviorTimer = 5.5;
		this.reallyCloseRangeSq = 3 * 3;
		this.reallyClose = false;
		this.hasGreetedPlayer = false;
		this.visibleRangeSq = 75 * 75;
		this.ready = this.load();

	}

	async load() {

		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		const model = await SkinnedModel.create( await loadGLB( base + 'models/characters/shiba-inu-quander.glb' ) );
		for ( const material of model.materials ) material.underwaterLighting = 'lite';
		// The bind-pose bounds cover this compact animal well enough. Unlike the generic character
		// default, allow normal frustum culling so panning away from the beach skips its draw/shadows.
		for ( const mesh of model.meshes ) mesh.frustumCulled = true;
		model.group.scale.set( 0.01, 0.01, 0.01 );
		this.model = model;
		model.onClipEnd = () => this.playRestPose();
		this.playRestPose( '0|standing_0', 0.01 );
		model.update( 0 );
		this.group.add( model.group );

	}

	nextBehaviorDelay() {

		// Keep all repeat behavior unhurried, whether the player is near or away.
		return 55 + Math.random() * 10;

	}

	playRestPose( pose = REST_POSES[ Math.floor( Math.random() * REST_POSES.length ) ], fade = 0.4 ) {

		this.model.play( pose, { fade, loop: true, from: pose === '0|standing_0' ? 3.4 : 0 } );
		this.behaviorTimer = this.nextBehaviorDelay();

	}

	playCloseTrick() {

		const action = CLOSE_TRICKS[ Math.floor( Math.random() * CLOSE_TRICKS.length ) ];
		this.model.play( action, { fade: 0.35, loop: false } );

	}

	update( dt, viewer = null ) {

		if ( ! this.model ) return;
		const d2 = viewer ? ( viewer.x - this.position.x ) ** 2 + ( viewer.z - this.position.z ) ** 2 : Infinity;
		if ( d2 > this.visibleRangeSq ) {

			this.group.visible = false;
			this.model.hold();
			return;

		}
		this.group.visible = true;
		const reallyClose = d2 <= this.reallyCloseRangeSq;
		const enteredCloseRange = reallyClose && ! this.reallyClose;
		if ( reallyClose !== this.reallyClose ) {

			this.reallyClose = reallyClose;

		}
		// The dog's first close encounter is an immediate friendly trick. Once it has completed,
		// the normal one-minute cooldown applies before any further animation can begin.
		if ( enteredCloseRange && ! this.hasGreetedPlayer ) {

			this.hasGreetedPlayer = true;
			this.playCloseTrick();

		}
		// Shake and roll over are only allowed while the player remains really close. If they leave midway,
		// blend back to an ordinary standing or sitting pose instead of finishing it at a distance.
		if ( ! reallyClose && CLOSE_TRICKS.includes( this.model.current ) ) this.playRestPose();
		if ( REST_POSES.includes( this.model.current ) ) {

			this.behaviorTimer -= dt;
			if ( this.behaviorTimer <= 0 ) {

				if ( reallyClose ) {

					this.playCloseTrick();

				} else {

					const behavior = DISTANT_BEHAVIORS[ Math.floor( Math.random() * DISTANT_BEHAVIORS.length ) ];
					if ( REST_POSES.includes( behavior ) ) this.playRestPose( behavior );
					else this.model.play( behavior, { fade: 0.35, loop: false } );

				}

			}

		}
		// Keep the pose uploaded, but do not spend CPU animating a character that cannot be seen.
		if ( d2 > 3600 ) this.model.hold();
		else this.model.update( dt );

	}

}
