import { Vector3, Color } from '../engine/index.js';
import { G } from '../engine/render/Frame.js';

// Car lamps: two headlight spots that light the road ahead, a red tail glow behind, and brake lights
// that flare while the brake is held, with the lamp lenses glowing to match. Head and tail lights come
// on from dusk on the island lamps' ramp (src/materials/LocalLights.js); brake lenses glow day and night.
// Lenses are found by material name (the Aster's Headlamp and TailLamp, the Jeep's LEDLens and RearLED).
// Each car draws its own copies of those materials, so one car's brake lights never light another's.
const HEAD = /headlamp|ledlens/i, TAIL = /taillamp|rearled/i;
const HEAD_GLOW = new Color( 1.0, 0.93, 0.8 ), TAIL_GLOW = new Color( 1.0, 0.04, 0.02 );
export const LAMPS = {
	headLens: 16, tailLens: 3, brakeLens: 12, // emissive added to the lenses (tail and brake: red)
	head: 420, headRange: 60, headInner: 9, headOuter: 24, headAim: - 0.05, // spot per headlight (degrees, aim in rad)
	tail: 0.45, brake: 3, tailRange: 4.5, // red point light behind the car; brake multiplies it up
};
const smooth = ( x, a, b ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };
const base = new WeakMap(); // lens material -> its emissive with the lamp off
const _v = new Vector3();

export class CarLights {

	// lights: the app's LocalLights; root: the car's model root (+z forward, unit scale, a scene child)
	constructor( lights, root ) {

		this.lights = lights;
		this.root = root;
		this.brake = 0;
		this.glow = 0;
		this.copies = new Map(); // shared material -> this car's copy
		this.lenses = [];
		this.scanIn = 0;
		this.measure();
		const cone = ( deg ) => Math.cos( deg * Math.PI / 180 );
		this.heads = this.headAt.map( () => lights.add( {
			position: new Vector3(), dir: new Vector3(), color: new Color( 1.0, 0.9, 0.78 ), intensity: LAMPS.head, range: LAMPS.headRange,
			cosInner: cone( LAMPS.headInner ), cosOuter: cone( LAMPS.headOuter ), kind: 'carHead', enabled: false,
		} ) );
		this.tail = lights.add( { position: new Vector3(), color: new Color( 1.0, 0.05, 0.03 ), intensity: LAMPS.tail, range: LAMPS.tailRange, kind: 'carTail', enabled: false, scale: 1 } );
		this.scan();

	}

	// lamp positions in the car's frame, from the lens vertices: one headlight per side at the front of its
	// lenses, the tail glow just behind the middle of the rear lenses
	measure() {

		const root = this.root;
		root.updateMatrixWorld( true );
		const inv = root.matrixWorld.clone().invert();
		const side = [ { n: 0, sum: new Vector3(), front: - Infinity }, { n: 0, sum: new Vector3(), front: - Infinity } ];
		const tail = { n: 0, sum: new Vector3(), back: Infinity };
		root.traverse( ( mesh ) => {

			if ( ! mesh.isMesh || ! mesh.material ) return;
			const name = mesh.material.name || '', head = HEAD.test( name );
			if ( ! head && ! TAIL.test( name ) ) return;
			const pos = mesh.geometry.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) {

				_v.set( pos.getX( i ), pos.getY( i ), pos.getZ( i ) ).applyMatrix4( mesh.matrixWorld ).applyMatrix4( inv );
				if ( head ) {

					const s = side[ _v.x > 0 ? 0 : 1 ];
					s.n ++; s.sum.add( _v ); s.front = Math.max( s.front, _v.z );

				} else {

					tail.n ++; tail.sum.add( _v ); tail.back = Math.min( tail.back, _v.z );

				}

			}

		} );
		this.headAt = side.filter( ( s ) => s.n ).map( ( s ) => s.sum.divideScalar( s.n ).setZ( s.front + 0.05 ) );
		if ( ! this.headAt.length ) this.headAt = [ new Vector3( 0.6, 0.7, 2 ), new Vector3( - 0.6, 0.7, 2 ) ];
		this.tailAt = tail.n ? tail.sum.divideScalar( tail.n ).setZ( tail.back - 0.15 ) : new Vector3( 0, 0.8, - 2.1 );

	}

	// give every drawn lens this car's own material (the damage rig and remote clones add meshes later)
	scan() {

		this.root.traverse( ( mesh ) => {

			if ( ! mesh.isMesh || ! mesh.material ) return;
			const m = mesh.material, name = m.name || '';
			const kind = HEAD.test( name ) ? 'head' : TAIL.test( name ) ? 'tail' : null;
			if ( ! kind || this.lenses.some( ( l ) => l.material === m ) ) return;
			let copy = this.copies.get( m );
			if ( ! copy ) {

				copy = m.clone();
				copy.name = name;
				base.set( copy, ( base.get( m ) || m.emissive ).clone() );
				this.copies.set( m, copy );
				this.lenses.push( { material: copy, kind } );

			}

			mesh.material = copy;

		} );

	}

	// lit: someone is driving (the lamps are on); brake: 0 to 1
	update( dt, lit, brake = 0 ) {

		if ( ( this.scanIn -= dt ) <= 0 ) {

			this.scan();
			this.scanIn = 1;

		}

		const on = lit ? smooth( G.night.value, 0.15, 0.75 ) : 0;
		this.brake += ( ( lit ? brake : 0 ) - this.brake ) * ( 1 - Math.exp( - dt / 0.05 ) );
		this.glow = on;
		for ( const { material, kind } of this.lenses ) {

			const b = base.get( material ), e = material.emissive;
			const k = kind === 'head' ? LAMPS.headLens * on : LAMPS.tailLens * on + LAMPS.brakeLens * this.brake;
			const c = kind === 'head' ? HEAD_GLOW : TAIL_GLOW;
			e.setRGB( b.r + c.r * k, b.g + c.g * k, b.b + c.b * k );

		}

		const root = this.root, q = root.quaternion;
		const show = on > 0 && root.visible !== false;
		this.heads.forEach( ( s, i ) => {

			s.enabled = show;
			if ( ! show ) return;
			s.position.copy( this.headAt[ i ] ).applyQuaternion( q ).add( root.position );
			s.dir.set( 0, Math.sin( LAMPS.headAim ), Math.cos( LAMPS.headAim ) ).applyQuaternion( q );

		} );
		this.tail.enabled = show;
		if ( show ) {

			this.tail.position.copy( this.tailAt ).applyQuaternion( q ).add( root.position );
			this.tail.scale = 1 + ( LAMPS.brake - 1 ) * this.brake;

		}

	}

	debug() {

		return { glow: + this.glow.toFixed( 2 ), brake: + this.brake.toFixed( 2 ), lenses: this.lenses.map( ( l ) => l.kind ), heads: this.heads.map( ( s ) => s.enabled && s.position.toArray().map( ( v ) => + v.toFixed( 2 ) ) ), tailAt: this.tailAt.toArray().map( ( v ) => + v.toFixed( 2 ) ) };

	}

	dispose() {

		const gone = new Set( [ ...this.heads, this.tail ] );
		this.lights.sources = this.lights.sources.filter( ( s ) => ! gone.has( s ) );

	}

}
