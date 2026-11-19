// Small things the townsfolk carry in the left hand: a coffee cup, a phone, a book, an esky, a beach
// bag, a fishing rod or a box of chips. Simple procedural meshes, shared geometry and materials.
// Held, a prop follows the hand bone each animated frame, kept upright in the model's frame (a cup
// stays level, a bag hangs). Dropped, it flies a scripted arc and one bounce to the ground and lies
// there, placed relative to the person's place (so aboard it rides with her) until they pick it up.
// A coffee leaves a small stain for a while. Contact.js decides when; this file only moves the props.
import { Group, Mesh, Vector3, BoxGeometry, CylinderGeometry, CircleGeometry } from '../engine/index.js';
import { Material, Color } from '../engine/render/Material.js';
import { fadeCustomize } from './Fade.js';

const mats = new Map(), geos = new Map();
const mat = ( r, g, b, rough = 0.6 ) => {

	const key = [ r, g, b, rough ].join();
	if ( ! mats.has( key ) ) mats.set( key, new Material( fadeCustomize( null, { name: 'person-prop', uniforms: { tint: [ 'vec3f', new Color( r, g, b ) ], rough: [ 'f32', rough ] }, surface: 's.albedo = mat.tint; s.roughness = mat.rough;' } ) ) );   // fades with its holder (Fade.js)
	return mats.get( key );

};
const geo = ( key, make ) => { if ( ! geos.has( key ) ) geos.set( key, make() ); return geos.get( key ); };
const box = ( w, h, d ) => geo( `b${ w },${ h },${ d }`, () => new BoxGeometry( w, h, d ) );
const cyl = ( a, b, h ) => geo( `c${ a },${ b },${ h }`, () => new CylinderGeometry( a, b, h, 12 ) );

// Each kind: its parts [ geometry, material, x, y, z ] about the grip, where it sits below the palm
// (hang), how it lies at rest (rx, rz, lift above the ground) and how far it flies when dropped.
const KINDS = {
	coffee: { parts: () => [ [ cyl( 0.043, 0.034, 0.12 ), mat( 0.93, 0.91, 0.86 ), 0, 0, 0 ], [ cyl( 0.046, 0.041, 0.05 ), mat( 0.45, 0.3, 0.18, 0.8 ), 0, - 0.005, 0 ], [ cyl( 0.045, 0.045, 0.012 ), mat( 0.12, 0.12, 0.12 ), 0, 0.064, 0 ] ], hang: 0.0, rest: [ 0, Math.PI / 2, 0.043 ], fly: 0.8, spill: true },
	phone: { parts: () => [ [ box( 0.075, 0.15, 0.012 ), mat( 0.06, 0.06, 0.07, 0.3 ), 0, 0, 0 ] ], hang: 0.02, rest: [ - Math.PI / 2, 0, 0.006 ], fly: 1.1 },
	book: { parts: () => [ [ box( 0.035, 0.22, 0.155 ), mat( 0.62, 0.12, 0.1 ), 0, 0, 0 ], [ box( 0.03, 0.212, 0.15 ), mat( 0.95, 0.93, 0.85 ), 0.004, 0, 0.004 ] ], hang: 0.06, rest: [ 0, Math.PI / 2, 0.018 ], fly: 0.9 },
	esky: { parts: () => [ [ box( 0.4, 0.26, 0.25 ), mat( 0.92, 0.92, 0.9, 0.5 ), 0, 0, 0 ], [ box( 0.41, 0.05, 0.26 ), mat( 0.1, 0.35, 0.75, 0.5 ), 0, 0.15, 0 ] ], hang: 0.2, rest: [ 0, 0, 0.13 ], fly: 0.45 },
	bag: { parts: () => [ [ box( 0.36, 0.3, 0.12 ), mat( 0.95, 0.55, 0.2, 0.9 ), 0, 0, 0 ], [ box( 0.37, 0.06, 0.125 ), mat( 0.2, 0.55, 0.7, 0.9 ), 0, 0.06, 0 ] ], hang: 0.22, rest: [ 0, Math.PI / 2, 0.06 ], fly: 0.6 },
	rod: { parts: () => [ [ cyl( 0.005, 0.012, 2.1 ), mat( 0.1, 0.12, 0.15, 0.4 ), 0, 0.85, 0 ], [ cyl( 0.03, 0.03, 0.06 ), mat( 0.6, 0.6, 0.62, 0.3 ), 0.03, 0.05, 0 ] ], hang: 0, tilt: 0.55, rest: [ Math.PI / 2, 0, 0.02 ], fly: 0.7 },
	clipboard: { parts: () => [ [ box( 0.23, 0.31, 0.01 ), mat( 0.55, 0.4, 0.25, 0.7 ), 0, 0, 0 ], [ box( 0.2, 0.26, 0.012 ), mat( 0.96, 0.96, 0.94, 0.9 ), 0, - 0.01, 0.002 ] ], hang: 0.12, rest: [ - Math.PI / 2, 0, 0.006 ], fly: 0.9 },
	chips: { parts: () => [ [ box( 0.15, 0.05, 0.1 ), mat( 0.85, 0.15, 0.12 ), 0, 0, 0 ], [ box( 0.13, 0.04, 0.08 ), mat( 0.95, 0.78, 0.3, 0.9 ), 0, 0.035, 0 ] ], hang: - 0.02, rest: [ Math.PI, 0, 0.03 ], fly: 0.8, spill: true },
};
export const PROP_KINDS = Object.keys( KINDS ).filter( k => k !== 'clipboard' );   // the random hand-outs (the clipboard is the hire attendant's)

const ARC = 0.55, BOUNCE = 0.28, STAIN = 30;   // s in the air, s for the bounce, s a stain lasts
const _p = new Vector3(), _f = new Vector3();

export class Prop {

	constructor( kind ) {

		const K = this.def = KINDS[ kind ];
		this.kind = kind;
		this.group = new Group();
		this.group.name = 'PersonProp:' + kind;
		for ( const [ g, m, x, y, z ] of K.parts() ) { const mesh = new Mesh( g, m ); mesh.position.set( x, y, z ); this.group.add( mesh ); }
		this.state = 'held';
		this.rel = new Vector3();       // on the ground: from the person's place (their feet before any knock)
		this.from = new Vector3(); this.to = new Vector3(); this.t0 = 0; this.spin = 0;

	}

	// Held: at the palm of the left hand (the wrist plus a hand's length along the fingers), upright.
	hold( m ) {

		if ( m._handL === undefined ) m._handL = m.gltf.nodes.findIndex( n => n.name === 'Bip01 L Hand' );
		const h = m._handL, W = m.world;
		if ( h < 0 ) return;
		_f.set( W[ h * 16 ], W[ h * 16 + 1 ], W[ h * 16 + 2 ] ).normalize();
		const g = this.group;
		g.position.set( W[ h * 16 + 12 ], W[ h * 16 + 13 ], W[ h * 16 + 14 ] ).addScaledVector( _f, 0.08 );
		g.position.y -= this.def.hang;
		g.rotation.set( this.def.tilt || 0, 0, 0 );

	}

	// Let go at world `at`, flung along ( nx, nz ); `ground` is the floor's height there.
	drop( at, nx, nz, base, t ) {

		const fly = this.def.fly * ( 0.8 + Math.random() * 0.4 );
		this.state = 'air'; this.t0 = t; this.spin = ( Math.random() < 0.5 ? - 1 : 1 ) * ( 1 + Math.random() );
		this.from.copy( at ).sub( base );
		this.to.set( this.from.x + nx * fly, this.def.rest[ 2 ], this.from.z + nz * fly );
		this.nx = nx; this.nz = nz;

	}

	// In the air or on the ground: where it is now, from the person's place. Returns true on landing.
	fly( base, t ) {

		const g = this.group, a = ( t - this.t0 ) / ARC, R = this.def.rest;
		let landed = false;
		if ( a < 1 ) {

			_p.lerpVectors( this.from, this.to, a );
			_p.y += 4 * 0.35 * a * ( 1 - a );
			g.rotation.set( R[ 0 ] * a + this.spin * a * 3, a * 2 * this.spin, R[ 1 ] * a );

		} else {

			const b = Math.min( 1, ( t - this.t0 - ARC ) / BOUNCE );
			if ( this.state === 'air' && b >= 1 ) { this.state = 'ground'; landed = true; }
			_p.copy( this.to ).addScaledVector( _f.set( this.nx, 0, this.nz ), 0.15 * b );
			_p.y += 4 * 0.07 * b * ( 1 - b );
			g.rotation.set( R[ 0 ], this.spin * 2 + b * 0.6 * this.spin, R[ 1 ] );
			if ( landed ) this.rel.copy( _p );

		}
		if ( this.state === 'ground' ) _p.copy( this.rel );
		g.position.copy( base ).add( _p );
		return landed;

	}

}

// A coffee's stain where it landed: a flat dark disc, shrinking away over its last few seconds.
export function stain( scene, at ) {

	const disc = new Mesh( geo( 'stain', () => new CircleGeometry( 0.17, 16 ) ), mat( 0.22, 0.14, 0.08, 0.3 ) );
	disc.rotation.x = - Math.PI / 2;
	disc.position.copy( at );
	disc.scale.set( 0.4, 0.4, 0.4 );
	scene.add( disc );
	return { mesh: disc, t: 0, life: STAIN };

}
