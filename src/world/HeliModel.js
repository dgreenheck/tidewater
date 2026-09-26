import { Group, Mesh, Vector3, CylinderGeometry } from '../engine/index.js';
import { GeoKit, mat4, box, roundedBox, cylinder, rod, sphere } from './boat/GeoKit.js';
import { createPropMaterial, PAT } from '../game/GameMaterials.js';
import { Material } from '../engine/render/Material.js';

// A single-seat open-frame helicopter: skids, a welded tube frame, a bucket seat, an air-cooled
// engine behind it, the mast with a two-blade teetering rotor, and a tail boom with a small tail
// rotor. No cabin.
//
// Frame: origin at the bottom of the skids, centred between them; the nose points along -Z (as the
// player's yaw 0 looks), +Y up. The main rotor spins about the mast (+Y), the tail rotor about +X.
export const HELI = {
	rotorY: 2.28, // hub height
	rotorR: 3.3, // main rotor radius
	mastZ: 0.28,
	tailZ: 3.55, // tail rotor hub
	tailY: 1.2,
	tailR: 0.55,
	seat: new Vector3( 0, 0.98, - 0.35 ), // pilot's hips
	eye: new Vector3( 0, 1.72, - 0.65 ), // pilot's eyes (moved back to see more front)
	skidHalf: 0.78, // skids at x = ±skidHalf
};

const paint = { color: 0xd8a018, rough: 0.38, metal: 0.25 }; // yellow powder coat
const tubeMetal = { color: 0x9aa2a6, rough: 0.32, metal: 0.9, pattern: PAT.machined };
const dark = { color: 0x1e2124, rough: 0.55, metal: 0.4 };
const black = { color: 0x0d0e0f, rough: 0.7, metal: 0.1 };
const engineMetal = { color: 0x5a5e62, rough: 0.45, metal: 0.8 };
const v = ( x, y, z ) => new Vector3( x, y, z );

export class HeliModel {

	constructor() {

		this.group = new Group();
		this.group.name = 'helicopter';
		const material = createPropMaterial( 'heliFrame' );
		this.material = material;

		// ---- airframe (static)
		const k = new GeoKit();
		const add = ( g, o ) => k.add( 'body', g, o );
		const S = HELI.skidHalf;

		// skids with upturned toes, and the two cross tubes bent up to the frame
		for ( const sx of [ - S, S ] ) {

			add( rod( v( sx, 0.04, 1.1 ), v( sx, 0.04, - 1.05 ), 0.035, 10 ), tubeMetal );
			add( rod( v( sx, 0.04, - 1.05 ), v( sx, 0.2, - 1.35 ), 0.035, 10 ), tubeMetal );
			for ( const z of [ - 0.65, 0.65 ] ) {

				add( rod( v( sx, 0.04, z ), v( sx * 0.72, 0.42, z ), 0.03, 10 ), tubeMetal );
				add( rod( v( sx * 0.72, 0.42, z ), v( sx * 0.3, 0.6, z ), 0.03, 10 ), tubeMetal );

			}

		}

		add( rod( v( - S * 0.3, 0.6, - 0.65 ), v( S * 0.3, 0.6, - 0.65 ), 0.03, 10 ), tubeMetal );
		add( rod( v( - S * 0.3, 0.6, 0.65 ), v( S * 0.3, 0.6, 0.65 ), 0.03, 10 ), tubeMetal );

		// main frame: two lower longerons, the seat cradle, and an A-frame up to the mast
		for ( const sx of [ - 0.24, 0.24 ] ) {

			add( rod( v( sx, 0.6, - 1.15 ), v( sx, 0.6, 0.85 ), 0.028, 10 ), paint );
			add( rod( v( sx, 0.6, - 1.15 ), v( sx * 0.5, 0.78, - 1.3 ), 0.028, 10 ), paint ); // nose hoop
			add( rod( v( sx, 0.6, 0.15 ), v( sx * 0.35, HELI.rotorY - 0.42, HELI.mastZ ), 0.03, 10 ), paint );
			add( rod( v( sx, 0.6, 0.85 ), v( sx * 0.35, HELI.rotorY - 0.42, HELI.mastZ ), 0.03, 10 ), paint );
			add( rod( v( sx, 0.6, - 0.1 ), v( sx, 1.5, 0.08 ), 0.024, 10 ), paint ); // seat back posts

		}

		add( rod( v( - 0.12, 0.78, - 1.3 ), v( 0.12, 0.78, - 1.3 ), 0.028, 10 ), paint );
		for ( const z of [ - 1.15, - 0.1, 0.15, 0.85 ] ) add( rod( v( - 0.24, 0.6, z ), v( 0.24, 0.6, z ), 0.024, 8 ), paint );
		add( rod( v( - 0.24, 1.5, 0.08 ), v( 0.24, 1.5, 0.08 ), 0.024, 8 ), paint );

		// seat: pan + back, padded
		add( roundedBox( 0.46, 0.08, 0.48, 0.03 ), { ...black, matrix: mat4( 0, HELI.seat.y - 0.08, HELI.seat.z + 0.02 ) } );
		add( roundedBox( 0.46, 0.62, 0.07, 0.03 ), { ...black, matrix: mat4( 0, HELI.seat.y + 0.26, 0.02, - 0.18 ) } );
		add( box( 0.4, 0.3, 0.44 ), { ...dark, matrix: mat4( 0, 0.77, HELI.seat.z + 0.02 ) } ); // seat box / battery
		// foot pegs / pedals, cyclic stick and the collective lever
		add( rod( v( - 0.2, 0.62, - 1.05 ), v( 0.2, 0.62, - 1.05 ), 0.018, 8 ), dark );
		for ( const sx of [ - 0.14, 0.14 ] ) add( roundedBox( 0.09, 0.02, 0.16, 0.008 ), { ...black, matrix: mat4( sx, 0.66, - 1.02, - 0.5 ) } );
		// cyclic stick (animated) - base at (0, 0.62, -0.72), extends up to ~1.18
		this.cyclicStick = new Group();
		this.cyclicStick.position.set( 0, 0.62, - 0.72 );
		const stickGeo = new CylinderGeometry( 0.014, 0.014, 0.56, 8 );
		const stickMat = new Material( { name: 'heliCyclicStick', lit: false, color: 0x1e2124, roughness: 0.7, metalness: 0.1 } );
		const stickMesh = new Mesh( stickGeo, stickMat );
		stickMesh.position.y = 0.28; // center the cylinder
		stickMesh.name = 'heli-cyclic-stick';
		this.cyclicStick.add( stickMesh );
		this.group.add( this.cyclicStick );
		// collective lever (static, on left side)
		add( rod( v( - 0.3, 0.8, - 0.05 ), v( - 0.3, 0.98, - 0.62 ), 0.014, 8 ), dark );
		add( roundedBox( 0.05, 0.05, 0.13, 0.02 ), { ...black, matrix: mat4( - 0.3, 0.99, - 0.66 ) } );
		// a small instrument pod on the nose hoop
		add( roundedBox( 0.22, 0.12, 0.1, 0.02 ), { ...dark, matrix: mat4( 0, 0.9, - 1.24, 0.5 ) } );
		for ( const sx of [ - 0.055, 0.055 ] ) add( cylinder( 0.035, 0.035, 0.012, 16 ), { color: 0xd8dcd0, rough: 0.2, metal: 0.1, matrix: mat4( sx, 0.915, - 1.29, 0.5 + Math.PI / 2 ) } );

		// engine: a flat-twin with finned cylinders, sitting behind the seat; belt drive up to the mast
		const ey = 0.95, ez = 0.52;
		add( roundedBox( 0.34, 0.3, 0.4, 0.04 ), { ...engineMetal, matrix: mat4( 0, ey, ez ) } );
		for ( const sx of [ - 1, 1 ] ) {

			add( cylinder( 0.1, 0.1, 0.26, 16 ), { ...engineMetal, matrix: mat4( sx * 0.3, ey + 0.02, ez, 0, 0, Math.PI / 2 ) } );
			for ( let i = 0; i < 6; i ++ ) add( cylinder( 0.13, 0.13, 0.012, 16 ), { ...engineMetal, matrix: mat4( sx * ( 0.2 + i * 0.038 ), ey + 0.02, ez, 0, 0, Math.PI / 2 ) } );
			add( cylinder( 0.08, 0.08, 0.06, 12 ), { ...dark, matrix: mat4( sx * 0.46, ey + 0.02, ez, 0, 0, Math.PI / 2 ) } );
			// exhaust
			add( rod( v( sx * 0.3, ey - 0.08, ez + 0.1 ), v( sx * 0.18, ey - 0.2, ez + 0.5 ), 0.025, 8 ), { color: 0x6b5a4a, rough: 0.6, metal: 0.7 } );

		}

		add( cylinder( 0.16, 0.16, 0.04, 20 ), { ...dark, matrix: mat4( 0, ey + 0.2, ez - 0.1 ) } ); // drive pulley
		add( roundedBox( 0.05, 0.9, 0.2, 0.02 ), { ...black, matrix: mat4( 0, ey + 0.62, ( ez + HELI.mastZ ) / 2 - 0.05, 0.12 ) } ); // belt guard
		// fuel tank beside the engine
		add( cylinder( 0.13, 0.13, 0.46, 16 ), { ...paint, matrix: mat4( 0.4, 1.3, 0.22, Math.PI / 2 ) } );
		add( cylinder( 0.03, 0.03, 0.04, 10 ), { ...dark, matrix: mat4( 0.4, 1.44, 0.22 ) } );

		// mast + gearbox under the hub
		add( roundedBox( 0.2, 0.2, 0.26, 0.03 ), { ...engineMetal, matrix: mat4( 0, HELI.rotorY - 0.42, HELI.mastZ ) } );
		add( cylinder( 0.04, 0.045, 0.34, 12 ), { ...tubeMetal, matrix: mat4( 0, HELI.rotorY - 0.18, HELI.mastZ ) } );

		// tail boom (tapered tube), braces, fins, the tail rotor gearbox
		const tz = HELI.tailZ, ty = HELI.tailY;
		add( rod( v( 0, ey + 0.1, ez + 0.2 ), v( 0, ty, tz ), 0.06, 12, 0.035 ), paint );
		for ( const sx of [ - 0.24, 0.24 ] ) add( rod( v( sx, 0.6, 0.85 ), v( 0, ty - 0.05, tz - 1.3 ), 0.016, 8 ), tubeMetal );
		add( rod( v( 0, HELI.rotorY - 0.5, HELI.mastZ + 0.1 ), v( 0, ty + 0.03, tz - 1.6 ), 0.014, 8 ), tubeMetal );
		add( box( 0.018, 0.5, 0.34 ), { ...paint, matrix: mat4( 0, ty + 0.18, tz - 0.05, - 0.35 ) } ); // vertical fin
		add( box( 0.018, 0.24, 0.26 ), { ...paint, matrix: mat4( 0, ty - 0.17, tz - 0.06, 0.4 ) } ); // ventral fin + tail guard
		add( box( 0.6, 0.014, 0.2 ), { ...paint, matrix: mat4( 0, ty - 0.02, tz - 0.5 ) } ); // horizontal stabiliser
		add( roundedBox( 0.1, 0.1, 0.12, 0.02 ), { ...engineMetal, matrix: mat4( 0.04, ty, tz ) } );
		// red beacon on the boom
		add( sphere( 0.035, 10, 6 ), { color: 0xa01010, rough: 0.2, metal: 0, matrix: mat4( 0, ty + 0.08, tz - 1.0 ) } );

		const body = new Mesh( k.merged( 'body' ), material );
		body.name = 'heli-frame';
		this.group.add( body );

		// ---- main rotor (spins about the mast)
		const r = new GeoKit();
		const R = HELI.rotorR;
		r.add( 'rotor', cylinder( 0.07, 0.07, 0.1, 16 ), engineMetal );
		r.add( 'rotor', box( 0.5, 0.05, 0.1 ), dark ); // teeter hinge / grips
		for ( const sx of [ - 1, 1 ] ) {

			// blade: thin, with a slight twist baked in as a small pitch, and yellow tips
			r.add( 'rotor', box( R - 0.55, 0.022, 0.17 ), { ...dark, matrix: mat4( sx * ( 0.25 + ( R - 0.55 ) / 2 ), 0.01, 0, sx * 0.04, 0, 0 ) } );
			r.add( 'rotor', box( 0.3, 0.023, 0.17 ), { ...paint, rough: 0.3, matrix: mat4( sx * ( R - 0.15 ), 0.01, 0, sx * 0.04, 0, 0 ) } );

		}

		this.rotor = new Group();
		this.rotor.position.set( 0, HELI.rotorY, HELI.mastZ );
		const rotorMesh = new Mesh( r.merged( 'rotor' ), material );
		rotorMesh.name = 'heli-rotor';
		this.rotor.add( rotorMesh );
		this.group.add( this.rotor );

		// ---- tail rotor (spins about +X, on the right side of the boom)
		const t = new GeoKit();
		t.add( 'tail', cylinder( 0.03, 0.03, 0.06, 10 ), { ...engineMetal, matrix: mat4( 0, 0, 0, 0, 0, Math.PI / 2 ) } );
		for ( const sy of [ - 1, 1 ] ) {

			t.add( 'tail', box( 0.012, HELI.tailR - 0.04, 0.07 ), { ...dark, matrix: mat4( 0, sy * ( HELI.tailR / 2 + 0.02 ), 0 ) } );
			t.add( 'tail', box( 0.013, 0.08, 0.07 ), { ...paint, matrix: mat4( 0, sy * ( HELI.tailR - 0.04 ), 0 ) } );

		}

		this.tailRotor = new Group();
		this.tailRotor.position.set( 0.13, HELI.tailY, HELI.tailZ );
		const tailMesh = new Mesh( t.merged( 'tail' ), material );
		tailMesh.name = 'heli-tail-rotor';
		this.tailRotor.add( tailMesh );
		this.group.add( this.tailRotor );

		this.rotorAngle = 0;
		this.tailAngle = 0;

	}

	// spin the rotors: rps = main rotor revolutions per second (the tail turns ~5x faster)
	spin( dt, rps ) {

		// the drawn rate is capped well below the real ~8 rev/s: at full speed the blades would
		// alias into a slow crawl at 60 fps
		const w = Math.min( rps, 1 ) * Math.PI * 2 * 2.6;
		this.rotorAngle = ( this.rotorAngle + w * dt ) % ( Math.PI * 2 );
		this.tailAngle = ( this.tailAngle + w * 2.3 * dt ) % ( Math.PI * 2 );
		this.rotor.rotation.y = - this.rotorAngle; // counter-clockwise seen from above
		this.tailRotor.rotation.x = this.tailAngle;

	}

	// update cyclic stick position based on helicopter tilt/roll
	// tilt > 0 = nose down -> stick forward (negative X rotation)
	// roll > 0 = right side down -> stick right (positive Z rotation)
	updateStick( tilt, roll ) {
		if ( this.cyclicStick ) {
			// stick pivots at its base (0.62 height), so we rotate the group
			// forward tilt = stick tilts forward (negative X)
			// right roll = stick tilts right (positive Z)
			this.cyclicStick.rotation.x = - tilt * 0.8;
			this.cyclicStick.rotation.z = roll * 0.8;
		}
	}

}