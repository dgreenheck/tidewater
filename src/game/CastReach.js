// When to offer the rod: the "R Take out the rod" hint (Game.prompt). The R key itself works
// everywhere (FishingRod); this only decides whether the hint is worth showing.
//
// The old rule keyed on the floor under the player's feet ('wood', 'wetsand', 'water'), so every timber
// deck counted as "by the water": the hint showed on the chairlift base deck, 60 m inland, and on the
// summit launch deck, 300 m above the sea. It also showed through a live tsunami
// warning, when the only thing the player should do is leave the shore.
//
// Now: open water must lie within casting reach ahead, read from the shared terrain heights
// (TerrainData.heightAt, the same surface the ocean floor, the rod's line and the boats use) against
// the shared sea level, and no disaster warning or event may be live (DisasterField.events: a
// tsunami's warning phase is part of its event). The boat deck and a fishable ferry keep their rule.
//
// Frame: world metres, y up; forward is ( -sin yaw, 0, -cos yaw ), as Player.js moves. The cone faces the
// camera's horizontal heading (cameraHeading), because that is where FishingRod casts.
// Cost: at most RAYS x STEPS = 21 heightAt calls a frame while walking with the rod away; no allocation.

export const CAST_REACH = 30; // m: decided reach of the cone (the starter rod casts 22 m, FishingRod.castM, plus line drift)
const NEAR = 4; // m: first sample; nearer water is under the player's own feet (a wading start still finds water ahead)
const STEPS = 7; // samples per ray, NEAR .. CAST_REACH (4.3 m apart: narrower than any channel worth casting into)
const RAYS = 3; // centre and both edges of the cone
const HALF_CONE = 0.44; // rad (25 deg): a cast goes where the player faces, give or take a turn of the head
const OPEN_DEPTH = 0.5; // m below sea level: swash and wet sand are not open water

// Is there open water within CAST_REACH m ahead of ( x, z ) facing yaw?
export function waterAhead( terrain, x, z, yaw, seaLevel = 0 ) {

	const floor = seaLevel - OPEN_DEPTH;
	for ( let r = 0; r < RAYS; r ++ ) {

		const a = yaw + ( r - 1 ) * HALF_CONE;
		const fx = - Math.sin( a ), fz = - Math.cos( a );
		for ( let i = 0; i < STEPS; i ++ ) {

			const d = NEAR + ( CAST_REACH - NEAR ) * i / ( STEPS - 1 );
			if ( terrain.heightAt( x + fx * d, z + fz * d ) < floor ) return true;

		}

	}

	return false;

}

// The view's horizontal heading as a yaw (same convention as Player.js: forward = ( -sin, 0, -cos )),
// from a camera world direction d. FishingRod's flick aims along the camera's horizontal direction,
// not the body (FishingRod.js "toward where you aim"), so in third person, with the view orbited away
// from the body, the hint must look where the cast will go. NaN when the view is (near) vertical:
// there is no heading to read and the caller falls back to the body yaw.
const MIN_HORIZONTAL = 1e-3; // |d.xz| below this (view within 0.06 deg of vertical) carries no heading
export function cameraHeading( d ) {

	return Math.hypot( d.x, d.z ) < MIN_HORIZONTAL ? NaN : Math.atan2( - d.x, - d.z );

}

// A disaster warning or event is live (the evacuation comes first).
export function hazardLive( disasters ) {

	return !! disasters?.field && disasters.field.events.size > 0;

}

// p: the player ({ mode, position, yaw, vessel }); heading: the view's yaw from cameraHeading (the way
// the cast will go), NaN or omitted for the body yaw. Positional arguments: it runs every frame.
export function rodHint( p, terrain, seaLevel = 0, disasters = null, heading = NaN ) {

	if ( hazardLive( disasters ) ) return false;
	if ( p.mode === 'deck' ) return true;
	if ( p.mode === 'ferry' ) return !! p.vessel?.fishable?.( p );
	const yaw = Number.isNaN( heading ) ? p.yaw : heading;
	return p.mode === 'walk' && waterAhead( terrain, p.position.x, p.position.z, yaw, seaLevel );

}
