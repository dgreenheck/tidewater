// Traffic wheel rotation should match the direction and distance each car travels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODELS = [ 'ParkedAster', 'ParkedJeep', 'ParkedWagon', 'ParkedPickup' ];
const WHEELS = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];

function readGlb( path ) {

	const b = readFileSync( path ), len = b.readUInt32LE( 12 );
	return JSON.parse( b.subarray( 20, 20 + len ).toString() );

}

// a wheel node's hub (its translation in the car's frame) and its mesh's half height (the tyre's radius)
function wheelOf( gltf, root, suffix ) {

	const node = ( root.children || [] ).map( i => gltf.nodes[ i ] ).find( n => n.name === root.name + suffix );
	if ( ! node || node.mesh === undefined ) return null;
	let lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const p of gltf.meshes[ node.mesh ].primitives ) {

		const a = gltf.accessors[ p.attributes.POSITION ];
		lo = lo.map( ( v, k ) => Math.min( v, a.min[ k ] ) );
		hi = hi.map( ( v, k ) => Math.max( v, a.max[ k ] ) );

	}
	const hub = node.translation || [ 0, 0, 0 ];
	return { hub, radius: ( hi[ 1 ] - lo[ 1 ] ) / 2, centre: lo.map( ( v, k ) => ( v + hi[ k ] ) / 2 ), rotated: !! node.rotation };

}

test( 'every traffic car model has four wheels of its own, hubs where a real car has them', () => {

	const gltf = readGlb( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	for ( const name of MODELS ) {

		const root = gltf.nodes.find( n => n.name === name );
		assert.ok( root, `${ name } is in parked_cars.glb` );
		const w = Object.fromEntries( WHEELS.map( s => [ s, wheelOf( gltf, root, s ) ] ) );
		for ( const s of WHEELS ) assert.ok( w[ s ], `${ name }${ s } is a separate wheel node with its own mesh (got none: the wheels are welded to the body)` );
		for ( const s of WHEELS ) {

			const { hub, radius, centre, rotated } = w[ s ];
			// a passenger car or light truck tyre: 195/65 R15 is 0.32 m, 265/70 R17 is 0.39 m, 35x12.5 R17 is 0.45 m
			assert.ok( radius > 0.28 && radius < 0.5, `${ name }${ s } tyre radius ${ radius.toFixed( 3 ) } m inside 0.28 .. 0.50 m` );
			// tyre on the ground: the hub stands one radius up (the root sits on the ground)
			assert.ok( Math.abs( hub[ 1 ] - radius ) < 0.04, `${ name }${ s } hub ${ hub[ 1 ].toFixed( 3 ) } m up for a ${ radius.toFixed( 3 ) } m tyre` );
			// the mesh centred on its hub, or it wobbles as it spins about its axle
			assert.ok( Math.hypot( centre[ 1 ], centre[ 2 ] ) < 0.02, `${ name }${ s } mesh centre ${ centre.map( v => v.toFixed( 3 ) ).join( ', ' ) } off its axle` );
			assert.ok( ! rotated, `${ name }${ s } pivot has identity rotation, so its local X is the axle` );

		}
		const wheelbase = w.WheelFrontL.hub[ 2 ] - w.WheelRearL.hub[ 2 ], track = w.WheelFrontR.hub[ 0 ] - w.WheelFrontL.hub[ 0 ];
		// a Golf is 2.64 m, a Hilux double cab 3.09 m; tracks 1.5 .. 1.8 m to the tyre centres
		assert.ok( wheelbase > 2.3 && wheelbase < 3.4, `${ name } wheelbase ${ wheelbase.toFixed( 2 ) } m (nose +Z, front axle ahead)` );
		assert.ok( track > 1.35 && track < 2.15, `${ name } track ${ track.toFixed( 2 ) } m (L on -X)` );

	}

} );

// The drive-in route from beyond the boom gate, through the check-in lane and over to a queue lane
// (src/ferry/Traffic.js spawn(): CHECK - 3.15, GATE - 100, ARM - 83.675, LANES[ 1 ] 4.0, HEAD - 48),
// terminal frame, metres. Its dogleg at the check-in is the one corner every arriving car drives.
const ROUTE = [ [ - 3.15, - 100 ], [ - 3.15, - 89.675 ], [ - 3.15, - 79.675 ], [ 4.0, - 72.675 ], [ 4.0, - 48 ] ];

function drive( rig, route, v, dt, back = false ) {

	const pts = route.map( ( [ x, z ] ) => ( { x, z } ) ), seg = new Float64Array( pts.length - 1 );
	let len = 0;
	for ( let k = 0; k < seg.length; k ++ ) { seg[ k ] = Math.hypot( pts[ k + 1 ].x - pts[ k ].x, pts[ k + 1 ].z - pts[ k ].z ); len += seg[ k ]; }
	const log = [], at = { x: 0, z: 0 };
	let s = back ? len : 0;
	while ( back ? s > 0 : s < len ) {

		const ds = Math.min( v * dt, back ? s : len - s ) * ( back ? - 1 : 1 );
		s += ds;
		// the pose the traffic AI gives the car (its point and heading on the segment)
		let i = 0, r = s;
		while ( i < seg.length - 1 && r > seg[ i ] ) r -= seg[ i ++ ];
		const a = pts[ i ], b = pts[ i + 1 ], f = Math.min( 1, r / seg[ i ] );
		at.x = a.x + ( b.x - a.x ) * f;
		at.z = a.z + ( b.z - a.z ) * f;
		const heading = Math.atan2( b.x - a.x, b.z - a.z );
		rig.follow( pts, seg, s, at, heading, ds, dt );
		log.push( { s, z: at.z, steer: rig.steer, spin: rig.spin } );

	}
	return { log, len };

}

test( 'a traffic car\'s wheels turn once per tyre circumference and steer through the check-in dogleg', async () => {

	const { WheelRig, MAX_LOCK } = await import( '../src/ferry/trafficWheels.js' );
	const radius = 0.34, wheelbase = 2.64;
	const rig = new WheelRig( radius, wheelbase );
	const { log, len } = drive( rig, ROUTE, 4.0, 1 / 60 );
	const revs = rig.turned / ( 2 * Math.PI ), want = len / ( 2 * Math.PI * radius );
	assert.ok( Math.abs( revs - want ) < 0.005 * want, `${ revs.toFixed( 2 ) } wheel revolutions over ${ len.toFixed( 1 ) } m, a ${ radius } m tyre turns ${ want.toFixed( 2 ) }` );
	const straight = log.filter( e => e.z < - 94 );
	assert.ok( straight.every( e => Math.abs( e.steer ) < 0.01 ), `wheels straight on the straight lane, worst ${ Math.max( ...straight.map( e => Math.abs( e.steer ) ) ).toFixed( 3 ) } rad` );
	// into the dogleg toward +X (a positive yaw): the front wheels steer positive before the corner, then back
	const into = log.filter( e => e.z > - 86 && e.z < - 79.675 ), out = log.filter( e => e.z > - 79.675 && e.z < - 66 );
	const maxIn = Math.max( ...into.map( e => e.steer ) ), minOut = Math.min( ...out.map( e => e.steer ) );
	assert.ok( maxIn > 0.12, `steers into the dogleg before its corner: ${ maxIn.toFixed( 3 ) } rad` );
	assert.ok( minOut < - 0.12, `steers back out of it: ${ minOut.toFixed( 3 ) } rad` );
	assert.ok( log.every( e => Math.abs( e.steer ) <= MAX_LOCK + 1e-9 ), 'never past full lock' );
	assert.ok( Math.abs( log.at( - 1 ).steer ) < 0.05, `straight again in the queue lane: ${ log.at( - 1 ).steer.toFixed( 3 ) } rad` );

} );

test( 'backing out, the wheels roll backward', async () => {

	const { WheelRig } = await import( '../src/ferry/trafficWheels.js' );
	const rig = new WheelRig( 0.41, 3.09 );
	const { len } = drive( rig, ROUTE.slice( 3 ), 1.6, 1 / 60, true );
	assert.ok( Math.abs( rig.turned + len / 0.41 ) < 0.01 * len / 0.41, `turned ${ rig.turned.toFixed( 2 ) } rad backing ${ len.toFixed( 1 ) } m` );

} );
