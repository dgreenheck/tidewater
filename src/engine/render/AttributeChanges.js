// Refraction bounds can outlive GPU upload ranges, which are consumed before
// that pass. Track the latest uploaded change per small block of array elements
// for attributes whose bounds are actually queried. No per-frame history grows.
const changes = new WeakMap();
export const ATTRIBUTE_BLOCK = 768;
const sourceOf = attribute => attribute.isInterleavedBufferAttribute ? attribute.data : attribute;

export function trackAttributeChanges( attribute ) {

	const src = sourceOf( attribute ), version = src.version ?? 0;
	let c = changes.get( src );
	if ( ! c || c.array !== src.array || c.length !== src.array.length ) {

		c = { array: src.array, length: src.array.length, version, fullVersion: version,
			blocks: new Float64Array( Math.ceil( src.array.length / ATTRIBUTE_BLOCK ) ) };
		changes.set( src, c );

	} else if ( c.version !== version ) {

		// A bounds query ran before upload, or no renderer observed the changes.
		// Their affected region is unknown: every older bound must be recomputed.
		c.version = c.fullVersion = version;

	}

}

export function recordAttributeChanges( src, previousVersion, ranges ) {

	const c = changes.get( src );
	if ( ! c ) return;
	if ( c.array !== src.array || c.length !== src.array.length ) { changes.delete( src ); return; }
	const version = src.version ?? 0;
	if ( c.version === version ) return;
	if ( c.version !== previousVersion || ! ranges ) c.fullVersion = version;
	else for ( const r of ranges ) {

		if ( r.count <= 0 ) continue;
		const first = Math.max( 0, Math.floor( r.start / ATTRIBUTE_BLOCK ) );
		const end = Math.min( c.blocks.length, Math.ceil( ( r.start + r.count ) / ATTRIBUTE_BLOCK ) );
		c.blocks.fill( version, first, end );

	}
	c.version = version;

}

export function attributeBlocksUnchanged( attribute, previousVersion, blocks ) {

	const src = sourceOf( attribute ), c = changes.get( src ), version = src.version ?? 0;
	if ( ! c || c.array !== src.array || c.version !== version || previousVersion > version || previousVersion < c.fullVersion ) return false;
	for ( let i = 0; i < blocks.length; i ++ ) if ( c.blocks[ blocks[ i ] ] > previousVersion ) return false;
	return true;

}
