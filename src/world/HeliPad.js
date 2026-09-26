import { Group, Mesh, Vector3 } from '../engine/index.js';
import { GeoKit, mat4, box, cylinder } from './boat/GeoKit.js';
import { createPropMaterial, PAT } from '../game/GameMaterials.js';

// A proper helipad: concrete pad with markings, perimeter lights, and a windsock
export class HeliPad {

	constructor( { position = new Vector3(), yaw = 0 } = {} ) {

		this.group = new Group();
		this.group.name = 'helipad';
		this.group.position.copy( position );
		this.group.rotation.y = yaw;

		const mat = createPropMaterial( 'helipad' );
		const k = new GeoKit();
		const add = ( g, o ) => k.add( 'pad', g, o );

		// pad dimensions
		const padR = 6; // 12m diameter
		const padThick = 0.15;
		const lightR = padR + 0.5;

		// concrete pad (slightly raised)
		const concrete = { color: 0x7a7a7a, rough: 0.85, metal: 0.0, pattern: PAT.concrete };
		add( cylinder( padR, padR, padThick, 48 ), { ...concrete, matrix: mat4( 0, 0.02, 0 ) } );

		// white perimeter ring
		const white = { color: 0xffffff, rough: 0.9, metal: 0.0 };
		add( cylinder( padR, padR, 0.02, 48 ), { ...white, matrix: mat4( 0, 0.08, 0 ) } );
		add( cylinder( padR - 0.5, padR - 0.5, 0.02, 48 ), { ...white, matrix: mat4( 0, 0.08, 0 ) } );

		// H marking in center
		const hStroke = 0.3;
		const hH = 2.5;
		const hW = 2.0;
		// vertical bars
		add( box( hStroke, 0.02, hH ), { ...white, matrix: mat4( - hW / 2 - hStroke / 2, 0.09, 0 ) } );
		add( box( hStroke, 0.02, hH ), { ...white, matrix: mat4( hW / 2 + hStroke / 2, 0.09, 0 ) } );
		// cross bar
		add( box( hW + hStroke, 0.02, hStroke ), { ...white, matrix: mat4( 0, 0.09, 0 ) } );

		// cross marker (for IFR)
		const crossSize = 3;
		const crossStroke = 0.4;
		add( box( crossStroke, 0.02, crossSize ), { ...white, matrix: mat4( 0, 0.1, 0, Math.PI / 2 ) } );
		add( box( crossSize, 0.02, crossStroke ), { ...white, matrix: mat4( 0, 0.1, 0 ) } );

		// perimeter lights (8 around the circle, green)
		const lightMat = { color: 0x00ff00, rough: 0.1, metal: 0.0, emissive: 0x00aa00, emissiveIntensity: 2 };
		for ( let i = 0; i < 8; i ++ ) {
			const a = ( i / 8 ) * Math.PI * 2;
			const x = Math.sin( a ) * lightR;
			const z = Math.cos( a ) * lightR;
			add( cylinder( 0.12, 0.12, 0.15, 12 ), { ...lightMat, matrix: mat4( x, 0.2, z ) } );
			// light glass
			add( cylinder( 0.08, 0.08, 0.05, 12 ), { color: 0x00ff00, rough: 0.0, metal: 0.0, emissive: 0x00ff00, emissiveIntensity: 5, matrix: mat4( x, 0.28, z ) } );
		}

		// windsock pole at one corner
		const poleX = Math.sin( Math.PI / 4 ) * ( padR - 0.8 );
		const poleZ = Math.cos( Math.PI / 4 ) * ( padR - 0.8 );
		add( cylinder( 0.04, 0.04, 4.0, 8 ), { color: 0x666666, rough: 0.4, metal: 0.8, matrix: mat4( poleX, 2.0, poleZ ) } );
		// windsock (orange cone)
		add( cylinder( 0.5, 0.15, 1.2, 12 ), { color: 0xff6600, rough: 0.7, metal: 0.0, matrix: mat4( poleX, 4.2, poleZ, Math.PI / 2 ) } );

		const padMesh = new Mesh( k.merged( 'pad' ), mat );
		padMesh.name = 'helipad-surface';
		padMesh.receiveShadow = true;
		this.group.add( padMesh );

		// slightly flatten terrain under pad (done via TerrainGPU height override in App)
		this.radius = padR + 1;

	}

}