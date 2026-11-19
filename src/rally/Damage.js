import { Group, Mesh, BufferGeometry, BufferAttribute, Vector3, Quaternion, Matrix4, Color } from '../engine/index.js';
import { G } from '../engine/render/Frame.js';
import { buildDamageRig, hiddenByDamage } from './VehicleModel.js';
import { hardTyreSlip } from './TyreSlip.js';
import { DamageState, LEVELS } from './DamageModel.js';
import { Wreckage } from './Wreckage.js';
import { CarFire, FX } from './CarFire.js';

// Crash damage for the local car on top of the rigid-body physics: every hard hit the
// physics reports (take_impacts) dents the body where it landed, breaks bumpers, lamps,
// plates, glass and the Jeep's spare off as tumbling debris, bends or tears off wheels,
// and hands engine power, pull, toe, springs and lost wheels back through set_damage.
// A holed radiator steams, a wrecked engine smokes and then burns; the sea puts it out.
// Repair (T) restores everything; recover (R) only rights the car.

const WHEEL_NAMES = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];
// Per-vertex crush limit: the car must stay recognisable.
const MAX_DENT = 0.22, KEEP_DENTS = 24;
// Part name: [ hurt to break, reach of a hit (m) ].
const RULES = {
	// Tuned to DamageModel's ZONE_ENERGY: a 30+ km/h nose-in knocks the bumper off, a 25 km/h one only dents it.
	bumperFront: [ 0.2, 1.3 ], bumperRear: [ 0.2, 1.3 ], plateFront: [ 0.16, 1.2 ], plateRear: [ 0.16, 1.2 ],
	lampFrontLeft: [ 0.12, 1.1 ], lampFrontRight: [ 0.12, 1.1 ], lampRearLeft: [ 0.12, 1.1 ], lampRearRight: [ 0.12, 1.1 ], spare: [ 0.2, 1.5 ],
	rearWing: [ 0.13, 1.6 ], // rear crash load reaching the two wing supports
};
const HEALTHY = new Float32Array( [ 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0 ] );
const SOOT = new Color( 0.03, 0.027, 0.025 ), FROST = new Color( 0.85, 0.9, 0.95 );
const _p = new Vector3(), _d = new Vector3(), _v = new Vector3(), _u = new Vector3(), _m = new Matrix4();

function pathOf( node, root ) {
	const path = [];
	for ( let n = node; n && n !== root; n = n.parent ) path.push( n.name || '' );
	return path;
}

// Body bounds in car-local space, from the BodyStatic meshes' boxes.
function bounds( root ) {
	root.updateMatrixWorld( true );
	const inverse = root.matrixWorld.clone().invert();
	const min = new Vector3( Infinity, Infinity, Infinity ), max = new Vector3( - Infinity, - Infinity, - Infinity );
	root.traverse( node => {
		if ( ! node.isMesh || ! pathOf( node, root ).includes( 'BodyStatic' ) ) return;
		if ( ! node.geometry.boundingBox ) node.geometry.computeBoundingBox();
		const box = node.geometry.boundingBox;
		_m.multiplyMatrices( inverse, node.matrixWorld );
		for ( let i = 0; i < 8; i ++ ) {
			_v.set( i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z ).applyMatrix4( _m );
			min.min( _v ); max.max( _v );
		}
	} );
	return { min, max };
}

export class Damage {
	constructor( rally ) {
		this.rally = rally;
		this.app = rally.app;
		this.wreckage = new Wreckage( this.app.scene, this.app.terrainData, () => G.seaLevel.value );
		this.wreckage.environment = () => this.app.disasters?.field;
		this.fx = new CarFire( this.app );
		this.cars = new Map();
		this.tyreSmoke = new Float32Array( 4 );
		this.rate = { steam: 0, smoke: 0, flame: 0, ember: 0, spark: 0 };
		this.last = null;
		this.select();
		// The live model, for the network layer and capture tooling.
		Damage.current = this;
	}

	// The rig and state of the car being driven; built once per vehicle.
	select() {
		const rally = this.rally, key = rally.vehicleKey;
		if ( ! this.cars.has( key ) ) this.cars.set( key, this.build( rally.model ) );
		this.car = this.cars.get( key );
	}

	build( model ) {
		const box = bounds( model.root ), root = model.root;
		const bumperTop = box.min.y + ( box.max.y - box.min.y ) * 0.42;
		const rig = buildDamageRig( model, {
			kind( mesh, path ) {
				if ( path.some( n => n.startsWith( 'Wheel' ) || n === 'InteriorAssembly' ) ) return null;
				if ( path.includes( 'RearWing' ) ) return 'rearWing';
				if ( path.includes( 'RearSpare' ) ) return 'spare';
				const name = mesh.material.name || '';
				if ( path.includes( 'LicensePlateMount' ) || /plate/i.test( name ) ) return 'plate';
				if ( /lamp|led|lens|indicator|light/i.test( name ) ) return 'lamp';
				// By material only: GlassPanels also carries painted roof and pillars, which must stay on.
				if ( mesh.material.transparent || /glass|window/i.test( name ) ) return 'glass';
				return 'body';
			},
			part( kind, c, n ) {
				const front = c.z > 0, side = c.x > 0 ? 'Left' : 'Right';
				if ( kind === 'spare' || kind === 'rearWing' ) return kind;
				// The Aster's roof skin is thin and its pillars slim: the tinted greenhouse is what makes it read
				// as a closed car. Laminated screens (facing fore or aft) craze and stay; side windows burst.
				if ( kind === 'glass' ) return Math.abs( n.z ) > Math.abs( n.x ) ? 'screen' : 'glass';
				if ( kind === 'plate' ) return front ? 'plateFront' : 'plateRear';
				if ( kind === 'lamp' ) return ( front ? 'lampFront' : 'lampRear' ) + side;
				if ( c.y < bumperTop && c.z > box.max.z - 0.42 ) return 'bumperFront';
				if ( c.y < bumperTop && c.z < box.min.z + 0.42 ) return 'bumperRear';
				return null;
			},
			own: ( material, kind ) => kind === 'glass' || /paint/i.test( material.name || '' ),
		} );
		const wheels = WHEEL_NAMES.map( name => {
			const pivot = model.pivots.get( name );
			_v.setFromMatrixPosition( pivot.matrixWorld ).applyMatrix4( _m.copy( root.matrixWorld ).invert() );
			return [ _v.x, _v.z ];
		} );
		const dims = { hx: Math.max( box.max.x, - box.min.x ), hz: Math.max( box.max.z, - box.min.z ), floor: box.min.y, top: box.max.y, wheels, box };
		// Append the wing after the original parts so their saved damage-mask bits keep their meanings.
		const names = [ ...rig.parts.keys() ].filter( name => RULES[ name ] && name !== 'rearWing' );
		const wingBit = rig.parts.has( 'rearWing' ) ? 1 << names.length : 0;
		if ( wingBit ) names.push( 'rearWing' );
		const parts = names.map( name => ( { name, anchor: rig.parts.get( name ).anchor.toArray(), at: RULES[ name ][ 0 ], radius: RULES[ name ][ 1 ] } ) );
		const materials = rig.materials.map( ( { material, kind } ) => ( { material, kind, color: material.color.clone(), roughness: material.roughness, opacity: material.opacity } ) );
		return { model, rig, dims, names, wingBit, state: new DamageState( dims, parts ), dents: [], materials, look: - 1 };
	}

	get state() { return this.car.state; }

	update( dt ) {
		const rally = this.rally, physics = rally.physics;
		if ( rally.model !== this.car.model ) this.select();
		// One crash arrives as several contact impulses over a few physics steps. Their delta-v
		// adds up; energy (its square) does not, so they merge into one hit before it counts.
		const hits = physics.take_impacts();
		for ( let i = 0; i + 7 < hits.length; i += 8 ) {
			const c = this.pending ||= { p: [ 0, 0, 0 ], d: [ 0, 0, 0 ], severity: 0, scenery: 0, age: 0, span: 0 }, s = hits[ i + 6 ];
			for ( let k = 0; k < 3; k ++ ) { c.p[ k ] += hits[ i + k ] * s; c.d[ k ] += hits[ i + 3 + k ] * s; }
			c.severity += s; c.scenery = Math.max( c.scenery, hits[ i + 7 ] ); c.age = 0;
		}
		// Flush 0.12 s after the last impulse, or at the latest 0.25 s after the first: grinding
		// along a rail or wedged between props must not pile up into one enormous hit.
		const crash = this.pending;
		if ( crash ) crash.span += dt;
		if ( crash && ( ( crash.age += dt ) > 0.12 || crash.span > 0.25 ) ) {
			this.pending = null;
			const length = Math.hypot( ...crash.d ) || 1;
			this.lastHit = crash.severity;
			this.hit( crash.p.map( v => v / crash.severity ), crash.d.map( v => v / length ), crash.severity, crash.scenery );
		}
		this.state.tick( dt, rally.state?.[ 73 ] ?? 0 );
		this.applyMechanical();
		this.applyLook();
		this.emit( dt );
		// The same contact that squeals makes a pale plume at the wheel, even
		// with the chassis stationary. Sand and airborne wheels return zero.
		const s = rally.drawn;
		for ( let w = 0; w < 4; w ++ ) {
			const scrub = hardTyreSlip( s, w );
			this.tyreSmoke[ w ] += Math.max( 0, scrub - 0.35 ) * dt * 30; // puffs/s
			const count = Math.floor( this.tyreSmoke[ w ] );
			if ( ! count ) continue;
			this.tyreSmoke[ w ] -= count;
			const patch = _p.fromArray( s, 29 + w * 10 );
			patch.y += 0.07;
			this.fx.emit( FX.TYRE, patch, _u.set( 0, 0.25, 0 ), count, 0.18 );
		}
		this.wreckage.update( dt );
		this.fx.update( dt );
	}

	// Car-local point and push direction, severity as delta-v (m/s), scenery flag.
	hit( point, direction, severity, scenery = 1, effects = true ) {
		const car = this.car, out = car.state.hit( point, direction, severity );
		if ( out.energy <= 0 ) return out;
		this.dent( point, direction, out.energy );
		car.dents.push( [ ...point, ...direction, out.energy ] );
		if ( car.dents.length > KEEP_DENTS ) car.dents.shift();
		if ( ! effects ) return out;
		const root = car.model.root, world = this.toWorld( _p.fromArray( point ) );
		if ( out.energy > 12 ) {
			_d.fromArray( direction ).applyQuaternion( root.quaternion ).multiplyScalar( - 2.5 ).add( this.carVelocity( _u ).multiplyScalar( 0.4 ) );
			_d.y += 1.8;
			this.fx.emit( FX.SPARK, world, _d, Math.min( 36, 6 + out.energy / 5 ), 0.9 );
			if ( scenery && point[ 1 ] < car.dims.floor + 0.6 ) this.fx.emit( FX.DUST, world, _d.set( 0, 0.6, 0 ), 6, 0.8 );
		}
		for ( const i of out.broken ) this.detach( car.names[ i ], true );
		for ( const i of out.wheels ) this.dropWheel( i, true );
		if ( out.crack ) this.crack();
		if ( out.shatter ) this.shatter( true );
		return out;
	}

	toWorld( v ) { const root = this.car.model.root; return v.applyQuaternion( root.quaternion ).add( root.position ); }

	carVelocity( out ) { return out.copy( this.rally.forward ).multiplyScalar( ( this.rally.state?.[ 7 ] ?? 0 ) / 3.6 ); }

	// Push vertices along the shove with a smooth falloff; cumulative but clamped per vertex.
	dent( point, direction, energy ) {
		const depth = Math.min( 0.17, 0.017 * Math.sqrt( energy ) ), reach = 0.35 + 0.045 * Math.sqrt( energy );
		for ( const src of this.car.rig.sources ) {
			const p = _p.fromArray( point ).applyMatrix4( src.relInverse );
			const d = _d.fromArray( direction ).transformDirection( src.relInverse );
			const r = reach / src.scale, sphere = src.sphere;
			if ( sphere && p.distanceTo( sphere.center ) > sphere.radius + r ) continue;
			const P = src.pos.array, B = src.base, count = P.length / 3, r2 = r * r, cap = MAX_DENT / src.scale, push = depth / src.scale;
			const touched = src.touched || ( src.touched = new Uint8Array( count ) );
			let any = false;
			for ( let i = 0; i < count; i ++ ) {
				const o = i * 3, dx = B[ o ] - p.x, dy = B[ o + 1 ] - p.y, dz = B[ o + 2 ] - p.z, q = dx * dx + dy * dy + dz * dz;
				if ( q >= r2 ) continue;
				const t = 1 - q / r2, noise = 0.72 + 0.28 * Math.sin( B[ o ] * 23.1 + B[ o + 1 ] * 17.3 + B[ o + 2 ] * 29.7 );
				let x = P[ o ] - B[ o ] + d.x * push * t * t * noise, y = P[ o + 1 ] - B[ o + 1 ] + d.y * push * t * t * noise, z = P[ o + 2 ] - B[ o + 2 ] + d.z * push * t * t * noise;
				const length = Math.hypot( x, y, z );
				if ( length > cap ) { const k = cap / length; x *= k; y *= k; z *= k; }
				P[ o ] = B[ o ] + x; P[ o + 1 ] = B[ o + 1 ] + y; P[ o + 2 ] = B[ o + 2 ] + z;
				touched[ i ] = 1; any = true;
			}
			if ( ! any ) continue;
			src.pos.needsUpdate = true;
			if ( src.nor ) this.renormal( src );
		}
	}

	// Recompute normals only where vertices moved, blended from the authored ones by crush depth.
	renormal( src ) {
		const P = src.pos.array, B = src.base, N = src.nor.array, N0 = src.baseNormal, index = src.index, touched = src.touched;
		const acc = new Float32Array( N.length );
		for ( let t = 0; t < index.length; t += 3 ) {
			const a = index[ t ], b = index[ t + 1 ], c = index[ t + 2 ];
			if ( ! ( touched[ a ] | touched[ b ] | touched[ c ] ) ) continue;
			const ax = P[ b * 3 ] - P[ a * 3 ], ay = P[ b * 3 + 1 ] - P[ a * 3 + 1 ], az = P[ b * 3 + 2 ] - P[ a * 3 + 2 ];
			const bx = P[ c * 3 ] - P[ a * 3 ], by = P[ c * 3 + 1 ] - P[ a * 3 + 1 ], bz = P[ c * 3 + 2 ] - P[ a * 3 + 2 ];
			const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
			for ( const v of [ a, b, c ] ) { acc[ v * 3 ] += nx; acc[ v * 3 + 1 ] += ny; acc[ v * 3 + 2 ] += nz; }
		}
		for ( let i = 0; i < touched.length; i ++ ) {
			if ( ! touched[ i ] ) continue;
			const o = i * 3;
			let x = acc[ o ], y = acc[ o + 1 ], z = acc[ o + 2 ];
			const length = Math.hypot( x, y, z );
			if ( length < 1e-12 ) continue;
			const flip = x * N0[ o ] + y * N0[ o + 1 ] + z * N0[ o + 2 ] < 0 ? - 1 : 1;
			const k = Math.min( 1, Math.hypot( P[ o ] - B[ o ], P[ o + 1 ] - B[ o + 1 ], P[ o + 2 ] - B[ o + 2 ] ) * src.scale / 0.03 );
			x = N0[ o ] * ( 1 - k ) + x / length * flip * k; y = N0[ o + 1 ] * ( 1 - k ) + y / length * flip * k; z = N0[ o + 2 ] * ( 1 - k ) + z / length * flip * k;
			const n = Math.hypot( x, y, z ) || 1;
			N[ o ] = x / n; N[ o + 1 ] = y / n; N[ o + 2 ] = z / n;
		}
		src.nor.needsUpdate = true;
	}

	// A part leaves the car as one debris piece built from its current (dented) triangles.
	detach( name, fling ) {
		const car = this.car, entry = car.rig.parts.get( name );
		if ( ! entry ) return;
		const positions = [], normals = [], indices = [], groups = [];
		for ( const { mesh, source, index } of entry.meshes ) {
			mesh.visible = false;
			if ( ! fling ) continue;
			const map = new Map(), P = source.pos.array, N = source.nor?.array, start = indices.length;
			for ( const v of index ) {
				if ( ! map.has( v ) ) {
					map.set( v, positions.length / 3 );
					_v.fromArray( P, v * 3 ).applyMatrix4( source.rel ); positions.push( _v.x, _v.y, _v.z );
					if ( N ) { _u.fromArray( N, v * 3 ).transformDirection( source.rel ); normals.push( _u.x, _u.y, _u.z ); } else normals.push( 0, 1, 0 );
				}
				indices.push( map.get( v ) );
			}
			groups.push( { material: mesh.material, start, count: indices.length - start } );
		}
		if ( ! fling || ! positions.length ) return;
		const min = new Vector3( Infinity, Infinity, Infinity ), max = min.clone().negate();
		for ( let i = 0; i < positions.length; i += 3 ) { _v.fromArray( positions, i ); min.min( _v ); max.max( _v ); }
		const centre = min.clone().add( max ).multiplyScalar( 0.5 ), half = max.clone().sub( min ).multiplyScalar( 0.5 );
		for ( let i = 0; i < positions.length; i += 3 ) { positions[ i ] -= centre.x; positions[ i + 1 ] -= centre.y; positions[ i + 2 ] -= centre.z; }
		const object = new Group();
		object.name = `Debris ${ name }`;
		const position = new BufferAttribute( new Float32Array( positions ), 3 ), normal = new BufferAttribute( new Float32Array( normals ), 3 );
		// Positions twice over, the second half with normals flipped, for one-sided materials' back faces.
		const mirrored = { position: new BufferAttribute( new Float32Array( [ ...positions, ...positions ] ), 3 ), normal: new BufferAttribute( new Float32Array( [ ...normals, ...normals.map( v => - v ) ] ), 3 ) };
		for ( const { material, start, count } of groups ) {
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', position ); geometry.setAttribute( 'normal', normal );
			geometry.setIndex( new BufferAttribute( new Uint32Array( indices.slice( start, start + count ) ), 1 ) );
			geometry.computeBoundingSphere();
			// The body's own material, so paint stays paint and chrome stays chrome. A one-sided panel gets a
			// reversed copy of its faces with flipped normals, so an upside-down piece is lit from the right side.
			if ( material.side !== 'double' ) {
				const front = indices.slice( start, start + count ), both = new Uint32Array( front.length * 2 ), base = positions.length / 3;
				both.set( front );
				for ( let t = 0; t < front.length; t += 3 ) { both[ front.length + t ] = front[ t ] + base; both[ front.length + t + 1 ] = front[ t + 2 ] + base; both[ front.length + t + 2 ] = front[ t + 1 ] + base; }
				geometry.setAttribute( 'position', mirrored.position ); geometry.setAttribute( 'normal', mirrored.normal );
				geometry.setIndex( new BufferAttribute( both, 1 ) );
			}
			// A torn-off lamp is dead: same lens, no glow from its baked emissive.
			let look = material;
			if ( name.startsWith( 'lamp' ) && material.emissive ) {
				this.deadLamps ||= new Map();
				if ( ! this.deadLamps.has( material ) ) { const dead = material.clone(); dead.emissive = new Color( 0, 0, 0 ); this.deadLamps.set( material, dead ); }
				look = this.deadLamps.get( material );
			}
			const mesh = new Mesh( geometry, look );
			// Thin panels flat on the sand self-shadow into a hatch; they take the world's shadow instead.
			mesh.castShadow = false;
			mesh.receiveShadow = true;
			mesh.layers.mask = entry.meshes[ 0 ].mesh.layers.mask;
			object.add( mesh );
		}
		const root = car.model.root, extents = [ half.x, half.y, half.z ], thin = extents.indexOf( Math.min( ...extents ) );
		const out = _u.set( centre.x, 0, centre.z ).normalize().applyQuaternion( root.quaternion );
		const velocity = this.carVelocity( new Vector3() ).multiplyScalar( 0.6 ).addScaledVector( out, 1.2 + Math.random() * 1.6 );
		velocity.y += 1.5 + Math.random() * 1.5;
		this.wreckage.add( object, {
			position: this.toWorld( centre.clone() ), quaternion: root.quaternion, velocity,
			spin: new Vector3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).multiplyScalar( 9 ),
			mass: Math.max(.25,24*Math.max(half.x*half.y,half.x*half.z,half.y*half.z)), area: 4*Math.max(half.x*half.y,half.x*half.z,half.y*half.z),
			rest: Math.max( 0.015, extents[ thin ] ), radius: Math.max( ...extents ), thin: new Vector3().setComponent( thin, 1 ), floats: 10,
		} );
		if ( name.startsWith( 'lamp' ) ) this.fx.emit( FX.SHARD, this.toWorld( centre.clone() ), velocity, 18, 0.35 );
	}

	dropWheel( i, fling ) {
		const car = this.car, pivot = car.model.pivots.get( WHEEL_NAMES[ i ] ), root = car.model.root;
		if ( ! pivot || ! pivot.visible ) return;
		pivot.updateWorldMatrix( true, false );
		const world = new Vector3().setFromMatrixPosition( pivot.matrixWorld );
		pivot.visible = false;
		hiddenByDamage.add( pivot );
		if ( ! fling ) return;
		const copy = pivot.clone();
		copy.visible = true; copy.position.set( 0, 0, 0 ); copy.quaternion.identity();
		const object = new Group();
		object.name = `Debris ${ WHEEL_NAMES[ i ] }`;
		object.add( copy );
		const out = _u.set( Math.sign( car.dims.wheels[ i ][ 0 ] ) || 1, 0, 0 ).applyQuaternion( root.quaternion );
		const velocity = this.carVelocity( new Vector3() ).addScaledVector( out, 2.4 );
		velocity.y += 1.6;
		this.wreckage.add( object, { position: world, velocity, rest: 0.12, radius: this.rally.profile.radius, wheel: { radius: this.rally.profile.radius, width: 0.12 }, mass:22, area:Math.PI*this.rally.profile.radius**2, floats: 40 } );
		this.fx.emit( FX.SPARK, world, velocity, 20, 0.5 );
	}

	glassMeshes() { return this.car.rig.parts.get( 'glass' )?.meshes || []; }

	crack() {
		for ( const entry of this.car.materials ) if ( entry.kind === 'glass' ) {
			// Cracked, not whited out: the tint still reads as glass.
			entry.material.color = entry.color.clone().lerp( FROST, 0.18 );
			entry.material.roughness = Math.max( entry.roughness, 0.35 );
			entry.material.opacity = Math.min( 1, entry.opacity + 0.06 );
		}
	}

	shatter( fling ) {
		// What is left of the glass is crazed white: the screens hang on in their frames.
		for ( const entry of this.car.materials ) if ( entry.kind === 'glass' ) {
			entry.material.color = entry.color.clone().lerp( FROST, 0.32 );
			entry.material.roughness = Math.max( entry.roughness, 0.6 );
			entry.material.opacity = Math.min( 1, entry.opacity + 0.1 );
		}
		for ( const { mesh } of this.glassMeshes() ) {
			// Only see-through panes burst; opaque trim and paint that share the glass node stay.
			if ( ! mesh.visible || ! mesh.material.transparent ) continue;
			mesh.visible = false;
			if ( ! fling ) continue;
			const sphere = mesh.geometry.boundingSphere;
			_p.copy( sphere.center ).applyMatrix4( _m.compose( mesh.position, mesh.quaternion, mesh.scale ) );
			this.fx.emit( FX.SHARD, this.toWorld( _p ), this.carVelocity( _d ).multiplyScalar( 0.5 ).setY( 1.2 ), 40, 0.9 );
		}
	}

	applyMechanical() {
		const m = this.state.mechanical(), last = this.last;
		const wingAttached = !( this.state.lost & this.car.wingBit );
		if ( ! last || last.wingAttached !== wingAttached ) this.rally.physics.set_rear_wing( wingAttached );
		m.wingAttached = wingAttached;
		if ( last && last.wingAttached === wingAttached && Math.abs( last.engine - m.engine ) < 0.005 && Math.abs( last.pull - m.pull ) < 1e-4 && last.wheels.every( ( v, i ) => Math.abs( v - m.wheels[ i ] ) < 1e-4 ) ) return;
		this.rally.physics.set_damage( m.engine, m.pull, m.wheels );
		this.last = m;
	}

	// Soot and grime on the paint as the car burns and crumples.
	applyLook() {
		const st = this.state, k = Math.min( 0.85, 0.6 * st.fire + 0.35 * Math.max( 0, st.zones[ 0 ] - 0.4 ) + 0.1 * st.body );
		if ( Math.abs( k - this.car.look ) < 0.01 ) return;
		this.car.look = k;
		for ( const entry of this.car.materials ) if ( entry.kind !== 'glass' ) {
			entry.material.color = entry.color.clone().lerp( SOOT, k );
			entry.material.roughness = entry.roughness + ( 0.85 - entry.roughness ) * k;
		}
	}

	emit( dt ) {
		const st = this.state, dims = this.car.dims, rate = this.rate;
		const bay = this.toWorld( _p.set( 0, dims.floor + ( dims.top - dims.floor ) * 0.6, dims.box.max.z * 0.55 ) );
		const drift = this.carVelocity( _u ).multiplyScalar( 0.3 );
		const count = ( key, perSecond ) => { rate[ key ] += dt * perSecond; const n = Math.floor( rate[ key ] ); rate[ key ] -= n; return n; };
		const up = ( y, v = _d ) => v.copy( drift ).setY( y );
		let n;
		const grille = this.toWorld( ( this.grilleAt ||= new Vector3() ).set( 0, dims.floor + ( dims.top - dims.floor ) * 0.5, dims.box.max.z * 0.85 ) );
		if ( ( n = count( 'steam', 24 * st.steam * ( 1 - st.smoke * 0.5 ) ) ) ) this.fx.emit( FX.STEAM, grille, up( 0.5, _v ), n, 0.3 );
		const dark = Math.min( 1, ( st.zones[ 0 ] - LEVELS.smoke ) / 0.4 + st.fire );
		if ( ( n = count( 'smoke', 24 * st.smoke + 20 * st.fire ) ) ) this.fx.emit( FX.SMOKE, _v.copy( bay ).setY( bay.y + 0.3 + st.fire * 0.6 ), up( 1.4 ), n, 0.5 + st.fire * 0.5, dark );
		if ( ( n = count( 'flame', 46 * st.fire ) ) ) this.fx.emit( FX.FLAME, bay, up( 1.4 ), n, 0.3 + 0.8 * st.fire );
		if ( ( n = count( 'ember', 10 * st.fire ) ) ) this.fx.emit( FX.EMBER, bay, up( 1.8 ), n, 0.6 + 0.6 * st.fire );
		if ( ( n = count( 'spark', 7 * st.fire ) ) ) this.fx.emit( FX.SPARK, bay, up( 3 ), n, 0.6 );
		if ( st.quenched ) this.fx.emit( FX.STEAM, bay, up( 1.5 ), 60, 1.2 );
		this.fx.setFire( st.fire, st.fire > 0 ? _v.copy( bay ).setY( bay.y + 0.7 ) : null );
	}

    captureDisasterState() {
        return {cars:[...this.cars.entries()].map(([key,car])=>({key,car,
            state:structuredClone(Object.fromEntries(Object.entries(car.state).filter(([k])=>k!=='dims'&&k!=='parts'))),dents:structuredClone(car.dents),
            sources:car.rig.sources.map(src=>({src,pos:src.pos.array.slice(),normal:src.nor?.array.slice(),touched:src.touched?.slice()})),
            visible:[...car.rig.parts.values()].flatMap(entry=>entry.meshes.map(({mesh})=>({mesh,visible:mesh.visible}))),
            wheels:WHEEL_NAMES.map(name=>car.model.pivots.get(name)).filter(Boolean).map(pivot=>({pivot,visible:pivot.visible})),
            materials:car.materials.map(entry=>({material:entry.material,color:entry.material.color.clone(),roughness:entry.material.roughness,opacity:entry.material.opacity}))
        })),wreckage:this.wreckage.captureDisasterState()};
    }

    restoreDisasterState(snapshot) {
        for(const saved of snapshot?.cars??[]){const car=saved.car;Object.assign(car.state,structuredClone(saved.state));car.dents=structuredClone(saved.dents);car.look=-1;
            for(const {src,pos,normal,touched} of saved.sources){src.pos.array.set(pos);src.pos.needsUpdate=true;if(src.nor&&normal){src.nor.array.set(normal);src.nor.needsUpdate=true;}if(src.touched&&touched)src.touched.set(touched);}
            for(const {mesh,visible}of saved.visible)mesh.visible=visible;for(const {pivot,visible}of saved.wheels)pivot.visible=visible;
            for(const {material,color,roughness,opacity}of saved.materials){material.color=color.clone();material.roughness=roughness;material.opacity=opacity;}
        }
        this.wreckage.restoreDisasterState(snapshot?.wreckage);this.fx.clear();this.pending=null;this.lastHit=0;this.last=null;this.rally.physics.take_impacts();this.applyMechanical();
    }

	repair() {
		for ( const car of this.cars.values() ) {
			for ( const src of car.rig.sources ) {
				src.pos.array.set( src.base ); src.pos.needsUpdate = true;
				if ( src.nor ) { src.nor.array.set( src.baseNormal ); src.nor.needsUpdate = true; }
				src.touched?.fill( 0 );
			}
			for ( const entry of car.rig.parts.values() ) for ( const { mesh } of entry.meshes ) mesh.visible = true;
			for ( const name of WHEEL_NAMES ) { const pivot = car.model.pivots.get( name ); if ( pivot ) pivot.visible = true; }
			for ( const entry of car.materials ) { entry.material.color = entry.color.clone(); entry.material.roughness = entry.roughness; entry.material.opacity = entry.opacity; }
			car.state.reset(); car.dents.length = 0; car.look = - 1;
		}
		this.wreckage.clear();
		this.fx.clear();
		this.pending = null; this.lastHit = 0;
		this.rally.physics.take_impacts();
		this.rally.physics.set_damage( 1, 0, HEALTHY );
		this.rally.physics.set_rear_wing( true );
		this.tyreSmoke.fill( 0 );
		this.last = null;
	}

	telemetry() {
		const st = this.state, z = st.zones;
		return {
			'damage-engine': this.state.mechanical().engine, 'damage-body': st.body, 'damage-front': z[ 0 ], 'damage-rear': z[ 1 ],
			'damage-left': z[ 2 ], 'damage-right': z[ 3 ], 'damage-roof': z[ 4 ], 'damage-glass': st.glass, 'wheels-lost': st.wheelCount,
			'parts-lost': st.partsLost, debris: this.wreckage.count, dents: this.car.dents.length, impacts: st.impacts,
			steam: st.steam, smoke: st.smoke, fire: st.fire, particles: this.fx.count, 'last-hit': this.lastHit || 0,
		};
	}

	// The cluster's one-line damage chip, or null while the car is sound.
	summary() {
		const st = this.state, engine = st.mechanical().engine;
		if ( st.body < 0.02 && engine > 0.99 && ! st.wheelCount ) return null;
		if ( st.fire > 0 ) return { text: engine <= 0 ? 'Engine dead' : 'Engine fire', level: 'fire' };
		if ( st.wheelCount ) return { text: st.wheelCount > 1 ? `${ st.wheelCount } wheels lost` : 'Wheel lost', level: 'bad' };
		if ( st.smoke > 0 ) return { text: 'Engine smoking', level: 'bad' };
		if ( st.steam > 0 ) return { text: 'Overheating', level: 'warn' };
		return { text: `Damage ${ Math.round( st.body * 100 ) }%`, level: 'warn' };
	}

	// Networking: [ ...DamageState.serialize(), dent count, dents x 7 floats (point, push, energy) ].
	serialize() {
		const car = this.car;
		return [ ...car.state.serialize(), car.dents.length, ...car.dents.flat() ];
	}

	apply( data ) {
		const st = this.state, head = data.slice( 0, 20 );
		const dents = [];
		// (the count comes from the network: never replay more dents than a car keeps)
		for ( let i = 21; i + 6 < data.length && dents.length < Math.min( data[ 20 ], KEEP_DENTS ); i += 7 ) dents.push( data.slice( i, i + 7 ) );
		this.repair();
		if ( ! st.apply( head ) ) return false;
		const car = this.car;
		for ( const [ x, y, z, dx, dy, dz, energy ] of dents ) { this.dent( [ x, y, z ], [ dx, dy, dz ], energy ); car.dents.push( [ x, y, z, dx, dy, dz, energy ] ); }
		car.names.forEach( ( name, i ) => { if ( st.lost & ( 1 << i ) ) this.detach( name, false ); } );
		for ( let i = 0; i < 4; i ++ ) if ( st.wheelsLost & ( 1 << i ) ) this.dropWheel( i, false );
		if ( st.glass >= LEVELS.crack ) this.crack();
		if ( st.glass >= LEVELS.shatter ) this.shatter( false );
		return true;
	}
}
