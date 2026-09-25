import { Vector3 } from '../engine/index.js';
import { boxCollider, prismCollider, transformCollider } from '../world/SolidCollision.js';

// A closed hull below the deck, plus the existing bulwarks / cabin / deck gear.
// Keep this separate from deck walking: its closed hull must not eject a boarded player.
export class BoatCollision {

	constructor( model ) {

		const L = model.lines, port = [], starboard = [];
		for ( let i = 0; i <= 16; i ++ ) {

			const t = i / 16, x = L.sheerX( t ), z = L.sheerZ( t );
			port.push( new Vector3( x, L.deckY, z ) );
			if ( i < 16 ) starboard.push( new Vector3( - x, L.deckY, z ) );

		}

		// Conservative hull envelope, tapered at the bow. Its bottom sits below the canoe body.
		this.hull = prismCollider( [ ...port, ...starboard.reverse() ], L.deckY + 0.55 );
		this.parts = model.colliders.filter( c => c.solid ).map( c => ( { ...c, shape: boxCollider( c.center, c.half ) } ) );
		this.boxes = this.parts.map( p => p.shape );

	}

	deckSolids( feetY, stepHeight ) {

		return this.parts.filter( p => ! p.walkable || p.center.y + p.half.y > feetY + stepHeight + 1e-4 ).map( p => p.shape );

	}

	worldSolids( boat, previous, position ) {

		// The full quaternion includes pitch and roll; yaw-only world boxes drift off the hull.
		if ( previous.distanceToSquared( boat.position ) > 144 && position.distanceToSquared( boat.position ) > 144 ) return [];
		return [ this.hull, ...this.boxes ].map( s => transformCollider( s, boat.position, boat.quaternion ) );

	}

}
