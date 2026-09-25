import { Vector3 } from '../../engine/index.js';
import { TREE_BASE, TREE_FORK, palmRadius, palmRootLumps, treeRadius, youngPalmRadius } from './TrunkProfiles.js';
import { cylinderCollider } from '../SolidCollision.js';

const CELL = 16;
const V = ( x, y, z ) => new Vector3( x, y, z );

// Index records, not rendered LOD meshes. Build trunk shapes only when approached;
// leaves stay passable and a distant impostor does not change collision behavior.
export class TreeColliders {

	constructor( records ) {

		this.cells = new Map();
		for ( const kind of [ 'trees', 'palms', 'youngPalms' ] ) for ( const record of records[ kind ] || [] ) {

			const entry = { record, kind, solids: null };
			const reach = kind === 'trees' ? record.s : Math.abs( record.l * record.H ) + record.s;
			this.visitCells( record.x - reach, record.z - reach, record.x + reach, record.z + reach, key => {

				if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
				this.cells.get( key ).push( entry );

			} );

		}

	}

	visitCells( x0, z0, x1, z1, visit ) {

		for ( let x = Math.floor( x0 / CELL ); x <= Math.floor( x1 / CELL ); x ++ ) {

			for ( let z = Math.floor( z0 / CELL ); z <= Math.floor( z1 / CELL ); z ++ ) visit( `${ x },${ z }` );

		}

	}

	near( previous, position, radius ) {

		const entries = new Set();
		this.visitCells( Math.min( previous.x, position.x ) - radius, Math.min( previous.z, position.z ) - radius,
			Math.max( previous.x, position.x ) + radius, Math.max( previous.z, position.z ) + radius,
			key => { for ( const entry of this.cells.get( key ) || [] ) entries.add( entry ); } );
		const solids = [];
		for ( const entry of entries ) {

			if ( ! entry.solids ) entry.solids = trunkSolids( entry.record, entry.kind );
			solids.push( ...entry.solids );

		}
		return solids;

	}

}

function trunkSolids( r, kind ) {

	const solids = [], tree = kind === 'trees', young = kind === 'youngPalms';
	const height = tree ? ( TREE_FORK[ 1 ] - TREE_BASE[ 1 ] ) * r.s * r.sy : r.H;
	const n = Math.max( 1, Math.ceil( height / 0.75 ) );
	// Same resting trunk curve as vegPlantDeform; wind is visual, strongest in the crown.
	const point = u => {

		if ( tree ) {

			const x = TREE_FORK[ 0 ] * u * r.s, z = TREE_FORK[ 2 ] * u * r.s;
			return V( r.x + x * Math.cos( r.yaw ) + z * Math.sin( r.yaw ), r.y + ( TREE_BASE[ 1 ] + ( TREE_FORK[ 1 ] - TREE_BASE[ 1 ] ) * u ) * r.s * r.sy,
				r.z - x * Math.sin( r.yaw ) + z * Math.cos( r.yaw ) );

		}
		const curve = r.seed * 7.31 % 1, offset = r.l * ( u + curve * u * ( 1 - u ) ) * r.H;
		return V( r.x + Math.cos( r.la ) * offset, r.y + u * r.H, r.z + Math.sin( r.la ) * offset );

	};
	for ( let i = 0; i < n; i ++ ) {

		const u = i / n;
		// Conservative radius over both ends and the midpoint of this short section,
		// sampled from the same profile (including root flare) as the rendered trunk.
		let radius = 0;
		for ( const f of [ u, ( i + 0.5 ) / n, ( i + 1 ) / n ] ) for ( let j = 0; j < 24; j ++ ) {

			const angle = j * Math.PI / 12;
			const value = tree ? treeRadius( f, angle, { y: TREE_BASE[ 1 ] + ( TREE_FORK[ 1 ] - TREE_BASE[ 1 ] ) * f } )
				: young ? youngPalmRadius( f ) : palmRadius( f ) + palmRootLumps( f, angle );
			radius = Math.max( radius, value * r.s );

		}
		solids.push( cylinderCollider( point( u ), point( ( i + 1 ) / n ), radius ) );

	}
	return solids;

}
