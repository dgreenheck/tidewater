import { Group, Mesh, Vector3, BufferGeometry, BufferAttribute } from '../engine/index.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, torus, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';
import { Vendor } from './Vendor.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { standard } from '../materials/Materials.js';

// Open sand on the west side of the yellow stilt house, ten metres from its centre.
export const ROADHOUSE = { x: 27.2, z: - 72.4, yaw: 0.12 };
export const DRINKS = {
	limeSoda: { name: 'Lime soda', price: 3, color: 0x9fdf8c, note: 'Cold, bright, and easy.' },
	gingerBeer: { name: 'Ginger beer', price: 5, color: 0xc78a45, note: 'Spiced and served over ice.' },
	coconutWater: { name: 'Coconut water', price: 4, color: 0xe8e5cf, note: 'Fresh and chilled.' },
};

export class Roadhouse {

	constructor( { scene, terrain, colliders, material = null } ) {

		const y = terrain.heightAt( ROADHOUSE.x, ROADHOUSE.z );
		this.material = material || createPropMaterial( 'roadhouse' );
		this.group = new Group();
		this.group.name = 'RoadhouseBar';
		this.group.position.set( ROADHOUSE.x, y, ROADHOUSE.z );
		this.group.rotation.y = ROADHOUSE.yaw;
		scene.add( this.group );
		const shell = new Mesh( buildRoadhouse(), this.material );
		shell.name = 'RoadhouseBarShell';
		shell.castShadow = true;
		this.group.add( shell );
		this.loadBottleCollection();

		// Nia works behind the counter, forward of the back-bar shelving so she never clips through it.
		const local = new Vector3( 0, 0, - 0.25 ).applyAxisAngle( new Vector3( 0, 1, 0 ), ROADHOUSE.yaw );
		const vx = ROADHOUSE.x + local.x, vz = ROADHOUSE.z + local.z;
		this.vendor = new Vendor( {
			name: 'Nia · Roadhouse', kind: 'bar', position: new Vector3( vx, terrain.heightAt( vx, vz ), vz ), yaw: ROADHOUSE.yaw,
			radius: 3.1, greeting: 'Cold drinks, good shade. What are you having?', idle: 'Come by when you need a cold drink.',
			material: this.material,
			character: { url: ( ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) + 'models/characters/nia.glb', idle: 'idle_neutral_01', talk: 'gestic_talk_neutral_01', greet: 'wave_01' },
			look: { shirt: 0x5b7664, trousers: 0x2d3434, apron: 0x8b5438, hat: 0xb9855c, hair: 0x2a1d16, skin: 0x9c6548 },
		} );
		scene.add( this.vendor.group );
		this.served = null;
		this.pickupPosition = new Vector3();
		if ( colliders ) {

			colliders.addBox( new Vector3( ROADHOUSE.x, y + 1.1, ROADHOUSE.z ), new Vector3( 2.0, 1.1, 1.1 ), ROADHOUSE.yaw, { tag: 'roadhouse' } );

		}

	}

	async loadBottleCollection() {

		try {

			const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
			const gltf = await loadGLB( base + 'models/props/roadhouse-bottles-ankitimation.glb' );
			const display = new Group();
			display.name = 'RoadhouseBottleCollection';
			// 16 varied bottle bodies, selected from the 87-mesh source instead of drawing its full set.
			const picks = [ 0, 2, 6, 10, 14, 18, 22, 26, 30, 34, 40, 44, 48, 54, 60, 66 ];
			for ( let i = 0; i < picks.length; i ++ ) {

				const primitive = gltf.meshes[ picks[ i ] ]?.find( ( item ) => item.attributes.POSITION );
				if ( ! primitive ) continue;
				const geometry = bottleGeometry( primitive );
				const bounds = geometryBounds( geometry );
				const factor = gltf.materials[ primitive.material ]?.pbrMetallicRoughness?.baseColorFactor || [ 0.24, 0.34, 0.25, 1 ];
				const material = standard( { color: rgbHex( factor ), roughness: 0.16, metalness: 0.02, transparent: factor[ 3 ] < 0.99, opacity: Math.max( 0.55, factor[ 3 ] ?? 1 ), side: 'double' } );
				const bottle = new Mesh( geometry, material );
				// Normalize each source item independently: Sketchfab's collection mixes
				// bottle and glass meshes authored at different scales. This gives them a
				// believable 24–35 cm height in Tidewater instead of relying on one scale.
				const targetHeight = 0.24 + ( i % 4 ) * 0.035;
				const scale = targetHeight / Math.max( bounds.height, 0.001 );
				const x = - 1.25 + ( i % 8 ) * 0.36, y = i < 8 ? 1.6 : 2.01;
				bottle.position.set( x - bounds.cx * scale, y - bounds.minY * scale, - 0.57 - bounds.cz * scale );
				bottle.scale.setScalar( scale );
				bottle.castShadow = true;
				display.add( bottle );

			}
			this.group.add( display );

		} catch ( error ) {

			console.warn( 'Roadhouse: bottle collection failed to load', error );

		}

	}

	serve( key ) {

		const drink = DRINKS[ key ];
		if ( ! drink ) return false;
		if ( this.served ) this.group.remove( this.served.group );
		const group = new Group();
		group.name = 'ServedDrink:' + key;
		group.position.set( 0, 1.05, - 0.18 ); // begins on Nia's side of the counter
		const mesh = new Mesh( buildDrink( drink.color ), this.material );
		mesh.castShadow = true;
		group.add( mesh );
		this.group.add( group );
		this.served = { key, group, t: 0, ready: false };
		return true;

	}

	update( dt, player ) {

		this.vendor.update( dt, player );
		if ( ! this.served ) return;
		const s = this.served;
		if ( ! s.ready ) {

			s.t = Math.min( 1, s.t + dt / 0.75 );
			const e = s.t * s.t * ( 3 - 2 * s.t );
			s.group.position.set( 0.22 * e, 1.05, - 0.18 + 0.88 * e );
			if ( s.t >= 1 ) s.ready = true;

		}
		this.pickupPosition.set( s.group.position.x, 0, s.group.position.z ).applyAxisAngle( new Vector3( 0, 1, 0 ), ROADHOUSE.yaw ).add( this.group.position );

	}

	canCollect( p ) {

		return !! this.served?.ready && Math.hypot( p.x - this.pickupPosition.x, p.z - this.pickupPosition.z ) < 1.35;

	}

	collect() {

		if ( ! this.served?.ready ) return null;
		const key = this.served.key;
		this.group.remove( this.served.group );
		this.served = null;
		return key;

	}

}

function buildRoadhouse() {

	const P = [], add = ( g, o ) => P.push( prepare( g, o ) );
	const wood = ( color = 0x5b3824 ) => ( { color, rough: 0.92, pattern: PAT.wood } );
	const woodX = ( color = 0x69442b ) => ( { color, rough: 0.9, pattern: PAT.woodX } );
	// raised posts, back wall and a broad counter; deliberately open to the beach.
	// Matched to Joe's 2.6 m stall: the bar is modestly wider, but shares its counter height and roof line.
	for ( const x of [ - 1.75, 1.75 ] ) for ( const z of [ - 1.0, 1.0 ] ) add( box( 0.18, 2.55, 0.18 ), { ...wood( 0x4a3023 ), matrix: mat4( x, 1.275, z, 0.02, 0, 0 ) } );
	for ( let y = 0; y < 4; y ++ ) add( box( 3.35, 0.36, 0.07 ), { ...woodX( [ 0x78523b, 0x5a3929, 0x6b4732, 0x4f3225 ][ y ] ), matrix: mat4( 0, 0.28 + y * 0.36, - 0.93, 0, 0, ( y % 2 ? 0.006 : - 0.006 ) ) } );
	for ( const z of [ - 0.15, 0.78 ] ) add( box( 3.05, 0.07, 0.38 ), { ...woodX( 0x4b3022 ), matrix: mat4( 0, z < 0 ? 1.53 : 1.94, - 0.78 ) } );
	// counter, lower front and a weathered corrugated roof.
	add( box( 3.55, 0.14, 0.7 ), { ...woodX( 0x714b2e ), matrix: mat4( 0, 1.04, 0.52 ) } );
	add( box( 3.3, 0.82, 0.12 ), { ...woodX( 0x3e2a21 ), matrix: mat4( 0, 0.42, 0.82 ) } );
	for ( let i = - 4; i <= 4; i ++ ) add( box( 0.44, 0.07, 2.45 ), { color: 0x285c5c, rough: 0.75, pattern: PAT.rusty, matrix: mat4( i * 0.44, 2.54, 0, 0, 0.04, 0 ) } );
	// Joinery and braces keep this small bar feeling like a real weathered beach structure,
	// with the same hand-built construction language as Joe's fishing stall.
	for ( const z of [ - 1.0, 1.0 ] ) add( box( 3.72, 0.12, 0.1 ), { ...wood( 0x4a3023 ), matrix: mat4( 0, 2.44, z ) } );
	for ( const x of [ - 1.75, 1.75 ] ) {

		add( rod( new Vector3( x, 0.98, - 0.92 ), new Vector3( x, 2.32, - 0.92 ), 0.035, 8 ), { ...wood( 0x563727 ) } );
		add( rod( new Vector3( x, 0.98, - 0.92 ), new Vector3( x, 2.32, - 0.28 ), 0.035, 8 ), { ...wood( 0x563727 ) } );

	}
	// A shallow timber header gives the customer side a strong, hand-built service opening.
	add( box( 3.26, 0.22, 0.07 ), { ...woodX( 0x553526 ), matrix: mat4( 0, 2.24, 1.02 ) } );
	// Back bar: deep timber shelves for the credited, imported Ankitimation bottle collection.
	for ( const sy of [ 1.54, 1.95, 2.36 ] ) {

		add( box( 3.05, 0.07, 0.28 ), { ...woodX( 0x3c281e ), matrix: mat4( 0, sy, - 0.76 ) } );
		for ( const x of [ - 1.47, 1.47 ] ) add( box( 0.07, 0.36, 0.1 ), { ...wood( 0x4a3023 ), matrix: mat4( x, sy + 0.18, - 0.84 ) } );

	}
	// Counter service details: limes in a bowl, a metal shaker, folded towel, and a real ice chest.
	add( torus( 0.24, 0.022, 8, 20 ), { color: 0x9f7650, rough: 0.82, matrix: mat4( - 1.34, 1.17, 0.38 ) } );
	for ( let i = 0; i < 7; i ++ ) add( sphere( 0.07, 10, 8 ), { color: i % 3 ? 0xa9bd48 : 0xd8a936, rough: 0.68, matrix: mat4( - 1.48 + ( i % 4 ) * 0.1, 1.18 + ( i > 3 ? 0.07 : 0 ), 0.33 + ( i >> 2 ) * 0.1 ) } );
	add( cylinder( 0.085, 0.11, 0.34, 18 ), { color: 0xaeb9b8, rough: 0.2, metal: 0.75, matrix: mat4( - 0.55, 1.22, 0.36 ) } );
	add( cylinder( 0.065, 0.085, 0.08, 18 ), { color: 0xcbd2d0, rough: 0.18, metal: 0.8, matrix: mat4( - 0.55, 1.43, 0.36 ) } );
	add( box( 0.43, 0.025, 0.27 ), { color: 0xe3d8bd, rough: 0.9, pattern: PAT.cloth, matrix: mat4( 0.1, 1.14, 0.36, 0, 0.12, 0 ) } );
	add( box( 0.88, 0.46, 0.58 ), { color: 0x47798a, rough: 0.5, pattern: PAT.rusty, matrix: mat4( 1.12, 1.25, 0.18 ) } );
	add( box( 0.94, 0.07, 0.64 ), { color: 0xe4e5df, rough: 0.55, matrix: mat4( 1.12, 1.52, 0.18 ) } );
	return mergePrepared( P );

}

function buildDrink( color ) {

	const P = [], add = ( g, o ) => P.push( prepare( g, o ) );
	add( cylinder( 0.105, 0.075, 0.25, 18 ), { color: 0xd5e5e2, rough: 0.15, metal: 0.05, matrix: mat4( 0, 0.125, 0 ) } );
	add( cylinder( 0.085, 0.065, 0.19, 18 ), { color, rough: 0.18, matrix: mat4( 0, 0.13, 0 ) } );
	add( sphere( 0.048, 10, 8 ), { color: 0xc9d45c, rough: 0.5, matrix: mat4( 0.06, 0.25, 0 ) } );
	add( rod( new Vector3( - 0.035, 0.23, 0 ), new Vector3( - 0.075, 0.38, 0.02 ), 0.008, 8 ), { color: 0xe8e2d0, rough: 0.35 } );
	return mergePrepared( P );

}

function bottleGeometry( primitive ) {

	const geo = new BufferGeometry(), at = primitive.attributes;
	geo.setAttribute( 'position', new BufferAttribute( toFloat( at.POSITION ), 3 ) );
	if ( at.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( toFloat( at.NORMAL ), 3 ) );
	if ( at.TEXCOORD_0 ) geo.setAttribute( 'uv', new BufferAttribute( toFloat( at.TEXCOORD_0 ), 2 ) );
	if ( primitive.indices ) geo.setIndex( new BufferAttribute( primitive.indices, 1 ) );
	geo.computeBoundingSphere();
	return geo;

}

function toFloat( attribute ) {

	if ( attribute.array instanceof Float32Array ) return attribute.array;
	const out = new Float32Array( attribute.array.length );
	const divisor = attribute.normalized ? ( attribute.componentType === 5121 ? 255 : attribute.componentType === 5123 ? 65535 : 1 ) : 1;
	for ( let i = 0; i < out.length; i ++ ) out[ i ] = attribute.array[ i ] / divisor;
	return out;

}

function geometryBounds( geometry ) {

	const a = geometry.attributes.position.array;
	let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = - Infinity, maxY = - Infinity, maxZ = - Infinity;
	for ( let i = 0; i < a.length; i += 3 ) {

		minX = Math.min( minX, a[ i ] ); maxX = Math.max( maxX, a[ i ] );
		minY = Math.min( minY, a[ i + 1 ] ); maxY = Math.max( maxY, a[ i + 1 ] );
		minZ = Math.min( minZ, a[ i + 2 ] ); maxZ = Math.max( maxZ, a[ i + 2 ] );

	}
	return { cx: ( minX + maxX ) * 0.5, minY, cz: ( minZ + maxZ ) * 0.5, height: maxY - minY };

}

function rgbHex( color ) {

	return ( Math.round( color[ 0 ] * 255 ) << 16 ) | ( Math.round( color[ 1 ] * 255 ) << 8 ) | Math.round( color[ 2 ] * 255 );

}
