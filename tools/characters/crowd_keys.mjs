// Shrink the ferry crowd's GLBs (public/models/characters/crowd/*.glb, built by build_crowd.sh) by
// reducing their animation keys, with no visible change to the motion:
//  - a channel whose keys are all the same collapses to its first key (the engine holds a one-key
//    channel, src/engine/render/Skinning.js sampleChannel);
//  - a LINEAR channel drops every key that the line (nlerp for rotations, the engine's own
//    interpolation) between its kept neighbours already reproduces within a tolerance: 0.05 degrees
//    of rotation, 0.1% of the channel's reach for translations, 1e-4 of scale;
//  - the first and last keys always stay, so clip start and length (and loops) are unchanged;
//  - the walk keeps every key: Crowd.js rootMotion() measures its pelvis travel key by key;
//  - the reduced keys share one buffer view, and equal key arrays (the times, mostly) one accessor
//    (the loader copies each accessor it reads, src/engine/loaders/GLTF.js read(), so sharing is safe).
// Buffers are repacked (images and meshes byte for byte). Run after build_crowd.sh:
//   node tools/characters/crowd_keys.mjs public/models/characters/crowd/*.glb
import fs from 'node:fs';

const ROT_TOL = 0.05 * Math.PI / 180, SCALE_TOL = 1e-4, TRANS_REL = 1e-3, KEEP = /walk/;
const W = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function err( V, w, rot, a, b, i, fi ) {

	// distance between key i and the interpolation of keys a, b at fraction fi
	if ( rot ) {

		let d = 0;
		for ( let c = 0; c < 4; c ++ ) d += V[ a * 4 + c ] * V[ b * 4 + c ];
		const sb = d < 0 ? - fi : fi;
		const q = [ 0, 1, 2, 3 ].map( c => V[ a * 4 + c ] * ( 1 - fi ) + V[ b * 4 + c ] * sb );
		const l = Math.hypot( ...q );
		let dot = 0;
		for ( let c = 0; c < 4; c ++ ) dot += q[ c ] / l * V[ i * 4 + c ];
		return 2 * Math.acos( Math.min( 1, Math.abs( dot ) ) );

	}

	let e = 0;
	for ( let c = 0; c < w; c ++ ) e = Math.max( e, Math.abs( V[ a * w + c ] * ( 1 - fi ) + V[ b * w + c ] * fi - V[ i * w + c ] ) );
	return e;

}

function reduce( T, V, w, rot, tol ) {

	const n = T.length;
	// all keys the same: one key
	let same = true;
	for ( let i = 1; i < n && same; i ++ ) for ( let c = 0; c < w; c ++ ) if ( err( V, w, rot, 0, 0, i, 0 ) > tol ) { same = false; break; }
	if ( same ) return [ 0 ];
	const keep = [ 0 ];
	let s = 0;
	while ( s < n - 1 ) {

		let e = s + 1;
		for ( let c = s + 2; c < n; c ++ ) {

			let ok = true;
			for ( let i = s + 1; i < c && ok; i ++ ) ok = err( V, w, rot, s, c, i, ( T[ i ] - T[ s ] ) / ( T[ c ] - T[ s ] ) ) <= tol;
			if ( ! ok ) break;
			e = c;

		}

		keep.push( e );
		s = e;

	}

	return keep;

}

for ( const file of process.argv.slice( 2 ) ) {

	const glb = fs.readFileSync( file );
	const jlen = glb.readUInt32LE( 12 );
	const json = JSON.parse( glb.subarray( 20, 20 + jlen ).toString() );
	const bin = glb.subarray( 20 + jlen + 8, 20 + jlen + 8 + glb.readUInt32LE( 20 + jlen ) );
	const view = ( acc ) => {

		const a = json.accessors[ acc ], bv = json.bufferViews[ a.bufferView ];
		const off = ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 );
		return new Float32Array( bin.buffer.slice( bin.byteOffset + off, bin.byteOffset + off + a.count * W[ a.type ] * 4 ) );

	};
	// new data per accessor (animation samplers only), everything else copied as it is
	const replaced = new Map();
	let before = 0, after = 0;
	for ( const an of json.animations || [] ) {

		if ( KEEP.test( an.name ) ) continue;
		const outOwner = new Map();
		for ( const ch of an.channels ) outOwner.set( ch.sampler, ch.target.path );
		an.samplers.forEach( ( smp, si ) => {

			if ( smp.interpolation && smp.interpolation !== 'LINEAR' ) return;
			const path = outOwner.get( si );
			if ( ! path || path === 'weights' ) return;
			const T = view( smp.input ), V = view( smp.output ), w = path === 'rotation' ? 4 : 3;
			let reach = 0;
			for ( let i = 0; i < V.length; i ++ ) reach = Math.max( reach, Math.abs( V[ i ] ) );
			const tol = path === 'rotation' ? ROT_TOL : path === 'scale' ? SCALE_TOL : Math.max( 1e-6, TRANS_REL * reach );
			const keep = reduce( T, V, w, path === 'rotation', tol );
			before += T.length * ( 1 + w );
			after += keep.length * ( 1 + w );
			const nT = new Float32Array( keep.map( k => T[ k ] ) ), nV = new Float32Array( keep.length * w );
			keep.forEach( ( k, j ) => { for ( let c = 0; c < w; c ++ ) nV[ j * w + c ] = V[ k * w + c ]; } );
			// samplers may share an input accessor: give each its own
			const ti = json.accessors.push( { ...json.accessors[ smp.input ], count: keep.length, min: [ nT[ 0 ] ], max: [ nT[ nT.length - 1 ] ] } ) - 1;
			const oi = json.accessors.push( { ...json.accessors[ smp.output ], count: keep.length } ) - 1;
			delete json.accessors[ oi ].min; delete json.accessors[ oi ].max;
			replaced.set( ti, nT ); replaced.set( oi, nV );
			smp.input = ti; smp.output = oi;

		} );

	}

	// repack: every accessor still used gets a tightly packed view (images/views without accessors copied)
	const used = new Set();
	const mark = ( i ) => { if ( i !== undefined ) used.add( i ); };
	for ( const m of json.meshes || [] ) for ( const p of m.primitives ) { Object.values( p.attributes ).forEach( mark ); mark( p.indices ); for ( const t of p.targets || [] ) Object.values( t ).forEach( mark ); }
	for ( const s of json.skins || [] ) mark( s.inverseBindMatrices );
	for ( const an of json.animations || [] ) for ( const s of an.samplers ) { mark( s.input ); mark( s.output ); }
	const chunks = [], views = [], accMap = new Map(), accessors = [];
	let off = 0;
	const put = ( bytes, bv ) => {

		const pad = ( 4 - ( off % 4 ) ) % 4;
		if ( pad ) { chunks.push( Buffer.alloc( pad ) ); off += pad; }
		chunks.push( bytes );
		views.push( { ...bv, buffer: 0, byteOffset: off, byteLength: bytes.length } );
		off += bytes.length;
		return views.length - 1;

	};
	const viewMap = new Map(), animDedupe = new Map(), animChunks = [];
	let animOff = 0;
	for ( const [ i, a ] of json.accessors.entries() ) {

		if ( ! used.has( i ) ) continue;
		let bytes;
		const bv = json.bufferViews[ a.bufferView ];
		if ( replaced.has( i ) ) {

			// reduced keys share one view (accessor offsets), and equal arrays one accessor
			const b = Buffer.from( replaced.get( i ).buffer ), key = a.type + b.toString( 'base64' );
			if ( ! animDedupe.has( key ) ) {

				animDedupe.set( key, accessors.push( { ...a, bufferView: - 1, byteOffset: animOff } ) - 1 );
				animChunks.push( b );
				animOff += b.length;

			}

			accMap.set( i, animDedupe.get( key ) );
			continue;

		} else if ( bv.byteStride ) {

			// interleaved or strided views are copied whole, once
			if ( ! viewMap.has( a.bufferView ) ) viewMap.set( a.bufferView, put( bin.subarray( bv.byteOffset || 0, ( bv.byteOffset || 0 ) + bv.byteLength ), { byteStride: bv.byteStride, target: bv.target } ) );
			accMap.set( i, accessors.push( { ...a, bufferView: viewMap.get( a.bufferView ) } ) - 1 );
			continue;

		} else {

			const size = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[ a.componentType ] * W[ a.type ] * a.count;
			const o = ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 );
			bytes = bin.subarray( o, o + size );

		}

		const nb = { target: bv.target };
		if ( nb.target === undefined ) delete nb.target;
		const v = put( bytes, nb );
		accMap.set( i, accessors.push( { ...a, bufferView: v, byteOffset: undefined } ) - 1 );

	}

	if ( animChunks.length ) {

		const v = put( Buffer.concat( animChunks ), {} );
		for ( const a of accessors ) if ( a.bufferView === - 1 ) a.bufferView = v;

	}

	for ( const im of json.images || [] ) if ( im.bufferView !== undefined ) {

		const bv = json.bufferViews[ im.bufferView ];
		im.bufferView = put( bin.subarray( bv.byteOffset || 0, ( bv.byteOffset || 0 ) + bv.byteLength ), {} );

	}

	const remap = ( i ) => accMap.get( i );
	for ( const m of json.meshes || [] ) for ( const p of m.primitives ) {

		for ( const k in p.attributes ) p.attributes[ k ] = remap( p.attributes[ k ] );
		if ( p.indices !== undefined ) p.indices = remap( p.indices );
		for ( const t of p.targets || [] ) for ( const k in t ) t[ k ] = remap( t[ k ] );

	}

	for ( const s of json.skins || [] ) if ( s.inverseBindMatrices !== undefined ) s.inverseBindMatrices = remap( s.inverseBindMatrices );
	for ( const an of json.animations || [] ) for ( const s of an.samplers ) { s.input = remap( s.input ); s.output = remap( s.output ); }
	json.accessors = accessors;
	json.bufferViews = views;
	const binOut = Buffer.concat( [ ...chunks, Buffer.alloc( ( 4 - ( off % 4 ) ) % 4 ) ] );
	json.buffers = [ { byteLength: binOut.length } ];
	let js = Buffer.from( JSON.stringify( json ) );
	js = Buffer.concat( [ js, Buffer.alloc( ( 4 - ( js.length % 4 ) ) % 4, 0x20 ) ] );
	const head = Buffer.alloc( 12 );
	head.writeUInt32LE( 0x46546c67, 0 ); head.writeUInt32LE( 2, 4 ); head.writeUInt32LE( 12 + 8 + js.length + 8 + binOut.length, 8 );
	const jh = Buffer.alloc( 8 ); jh.writeUInt32LE( js.length, 0 ); jh.writeUInt32LE( 0x4e4f534a, 4 );
	const bh = Buffer.alloc( 8 ); bh.writeUInt32LE( binOut.length, 0 ); bh.writeUInt32LE( 0x004e4942, 4 );
	const out = Buffer.concat( [ head, jh, js, bh, binOut ] );
	fs.writeFileSync( file, out );
	console.log( `${ file }: ${ ( glb.length / 1e6 ).toFixed( 2 ) } MB -> ${ ( out.length / 1e6 ).toFixed( 2 ) } MB (animation floats ${ before } -> ${ after })` );

}
