// The main beach by the pier (townsfolk step 3, docs/people.md): beachgoers in swimwear on towels
// and under umbrellas, swimmers and waders, a beach cricket game, a frisbee pair, shell hunters on
// the tideline, two people fishing off the pier end, and the jetski hire attendant (the desk's flow
// is src/world/JetskiHire.js; this file keeps his body). The second owner of townsfolk after the
// ferry crowd: this file keeps the bodies, places and scripted play; each person has a brain
// (src/people/Brain.js) that picks what they do at their smart object (towel, sand, swim, wade,
// line, stool, and the games' `play`) and reacts to the player, the bird and the jetskis.
// Bodies: public/models/characters/crowd/swim/<cast>.glb (tools/characters/crowd_swim.mjs) where
// built, else the clothed crowd; the fishers and the attendant keep their clothes. Props: the
// Blender models in public/models/beach (tools/beach/props_build.py), simple stand-ins without them.
//   app.beach.update( dt ), app.beach.state(), app.beach.attendant, app.beach.send( p, points, then )
import { Group, Mesh, Vector3, BoxGeometry, CylinderGeometry } from '../engine/index.js';
import { Matrix4 } from '../engine/math/Matrix4.js';
import { Quaternion } from '../engine/math/Quaternion.js';
import { Material, Color } from '../engine/render/Material.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { loadModel } from '../rally/VehicleModel.js';
import { rootMotion } from '../ferry/Crowd.js';
import { pose } from './Pose.js';
import { pickArchetype } from './Brain.js';
import { SmartObject } from './SmartObjects.js';
import { line } from './Lines.js';
import { fadeOptions, fadeCustomize } from './Fade.js';
import { JETSKI_HIRE } from '../world/JetskiHire.js';
import { WORLD } from '../world/WorldLayout.js';

const CAST = [ 'f01', 'm01', 'f03', 'm04', 'f06', 'm07', 'f09', 'm10' ];
const CLIP = { idle: 'idle_neutral_01', look: 'idle_look_around_01', sit: 'sit_chair_idle_neutral_01', talk: 'gestic_talk_neutral_01', wave: 'wave_01',
	point: 'gestic_presentation_right_01', nod: 'gestic_listen_accept_01', phone: 'cell_phone_talk_01', walk: 'walk_neutral_01',
	shrug: 'gestic_shrug_01', laugh: 'gestic_laugh_low', sitLook: 'sit_chair_idle_look_around', sitRelax: 'sit_chair_idle_relaxed_01',
	sitThink: 'sit_chair_gestic_thoughtful', sitYawn: 'sit_chair_idle_yawn', angry: 'idle_angry_01', crouch: 'crouch_idle',
	crouchIn: 'crouch_in', crouchOut: 'crouch_out', lie: 'idle_neutral_01', tread: 'idle_neutral_01' };
const SITTING = new Set( [ 'sit', 'sitLook', 'sitRelax', 'sitThink', 'sitYawn' ] );
const LOW = new Set( [ 'lie', 'sand', 'stool' ] );          // seated for the brain: no standing gestures
const STILL = new Set( [ 'lie', 'sand', 'stool', 'tread' ] ); // animated a third of the frames even near
// hats and sunnies on the head bone (wear): from the head bone's rest origin (the top of the neck), model
// space; `top` is the crown above it (the crowd's heads: men 0.232 m, women 0.217 m, measured on the GLBs).
// The props' manifest puts a hat's origin 0.135 m (sun hat) or 0.115 m (bucket hat) below the crown; on the
// crowd's hair they sat on the eyebrows, so both ride 0.025 m higher. The sunnies' bridge sits 8 mm above and
// 15 mm ahead of the eyes (eye height 0.12 m below the crown, the lenses 0.135 m ahead of the neck: nearer, they
// sank into the face).
const WEAR = { sun_hat: top => [ 0, top - 0.11, 0.005 ], bucket_hat: top => [ 0, top - 0.09, 0.005 ], sunnies: top => [ 0, top - 0.112, 0.135 ] };
const FADES = new Set( [ 'sun_hat', 'bucket_hat', 'sunnies', 'cricket_bat' ] );   // worn or held: they fade with their person (Fade.js)
// SAND.seat: a sand sitter's pelvis bone above the sand under it (Beach.seat)
const SAND = { drop: 0.42, legs: 0.75, seat: 0.15 }, LIE = 0.13, STOOL = 0.2, TREAD = 1.38;   // m, and the knees-up share
// camps along the beach: x, metres back from the tideline; who sits where (kind, dx, dz, yaw) and the gear
const CAMPS = [
	{ x: 6, pole: 0, back: 9, umbrella: 'umbrella_a', gear: [ [ 'esky', 1.2, - 0.9 ], [ 'towel_c', 0, 0.3, 1.57 ] ], people: [ [ 'sand', - 0.55, 0.2, 0.95 ], [ 'sand', 0.55, 0, - 0.95 ] ], archetypes: [ 'friendly', 'friendly' ] },
	{ x: 13, pole: 0, back: 8, umbrella: 'umbrella_b', gear: [ [ 'towel_a', - 0.9, 0 ], [ 'towel_b', 0.9, 0 ], [ 'beach_bag', 2.0, - 0.8 ], [ 'thongs', - 0.9, 1.2 ] ], people: [ [ 'towel', - 0.9, 0, 0 ], [ 'reader', 0.9, 0.1, 0 ] ] },
	{ x: 21, pole: 0.9, back: 9.5, umbrella: 'umbrella_a', gear: [ [ 'towel_d', - 1.8, 0 ], [ 'towel_a', 0, 0 ], [ 'esky', 1.6, - 1.1 ], [ 'sun_hat', 0.5, 1.0 ] ], people: [ [ 'towel', - 1.8, 0, 0 ], [ 'phoner', 0, 0.2, 0 ], [ 'sand', 1.8, 0, 0.3 ] ] },
	{ x: 29, pole: 0.9, back: 8.5, umbrella: 'umbrella_b', gear: [ [ 'towel_b', 0, 0 ], [ 'esky', 1.0, - 0.9 ], [ 'thongs', 0.4, 1.1 ], [ 'book', 0.45, - 0.22, 0.4 ] ], people: [ [ 'reader', 0, 0.1, 0 ] ], bookDown: 0 },
	{ x: 71, pole: 0, back: 9, umbrella: 'umbrella_a', gear: [ [ 'towel_c', - 0.9, 0 ], [ 'towel_d', 0.9, 0 ], [ 'beach_bag', 1.9, - 0.6 ] ], people: [ [ 'towel', - 0.9, 0, 0 ], [ 'towel', 0.9, 0, 0 ] ] },
];
const TOWEL_KIND = { towel: 'towel', reader: 'reader', phoner: 'phoner', sand: 'sand' };
const CRICKET = { x: - 8, back: 13 }, FRISBEE = { x: 66, x2: 75, back: 5 };
const SHELLS = [ [ 2, 33 ], [ 64, 104 ] ], SWIM = [ 16, 23, 30 ], WADE = [ 10.2, 11.1 ];
// Clear of the real bench and fish-cleaning table, including capsule radius.
const FISH = [ [ 54.1, 39.0 ], [ 57.0, 39.0 ] ];
const _v = new Vector3(), _w = new Vector3(), _m = new Matrix4();
const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = a => a[ Math.floor( Math.random() * a.length ) ];
const NEIGHBOUR = 6;   // m: people closer than this never share a body (fill)
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, a ) => Math.max( - a, Math.min( a, v ) );

// stand-in props (the Blender ones replace them when public/models/beach has them)
const mats = new Map();
const mat = ( r, g, b, rough = 0.8 ) => { const k = [ r, g, b, rough ].join(); if ( ! mats.has( k ) ) mats.set( k, new Material( { name: 'beach-prop', uniforms: { tint: [ 'vec3f', new Color( r, g, b ) ], rough: [ 'f32', rough ] }, surface: 's.albedo = mat.tint; s.roughness = mat.rough;' } ) ); return mats.get( k ); };
const part = ( g, geo, m, x, y, z, rx = 0, rz = 0 ) => { const o = new Mesh( geo, m ); o.position.set( x, y, z ); o.rotation.x = rx; o.rotation.z = rz; g.add( o ); return o; };
const STAND_IN = {
	towel: c => g => { part( g, new BoxGeometry( 0.8, 0.012, 1.7 ), mat( ...c ), 0, 0.006, 0 ); part( g, new BoxGeometry( 0.8, 0.014, 0.2 ), mat( 0.95, 0.93, 0.88 ), 0, 0.007, 0.55 ); },
	umbrella: c => g => { part( g, new CylinderGeometry( 0.018, 0.018, 2.1, 8 ), mat( 0.85, 0.85, 0.82, 0.4 ), 0, 1.05, 0 ); part( g, new CylinderGeometry( 0.03, 1.0, 0.32, 16 ), mat( ...c ), 0, 2.02, 0 ); },
	esky: () => g => { part( g, new BoxGeometry( 0.55, 0.32, 0.36 ), mat( 0.93, 0.93, 0.9, 0.5 ), 0, 0.16, 0 ); part( g, new BoxGeometry( 0.56, 0.06, 0.37 ), mat( 0.12, 0.32, 0.7, 0.5 ), 0, 0.35, 0 ); },
	beach_bag: () => g => { part( g, new BoxGeometry( 0.42, 0.32, 0.14 ), mat( 0.86, 0.72, 0.5, 0.95 ), 0, 0.16, 0 ); },
	thongs: () => g => { for ( const x of [ - 0.07, 0.07 ] ) part( g, new BoxGeometry( 0.1, 0.018, 0.26 ), mat( 0.1, 0.35, 0.55, 0.7 ), x, 0.009, 0 ); },
	sun_hat: () => g => { part( g, new CylinderGeometry( 0.2, 0.2, 0.012, 16 ), mat( 0.86, 0.76, 0.52, 0.9 ), 0, 0.006, 0 ); part( g, new CylinderGeometry( 0.09, 0.1, 0.1, 12 ), mat( 0.86, 0.76, 0.52, 0.9 ), 0, 0.06, 0 ); },
	stumps: () => g => { for ( const x of [ - 0.11, 0, 0.11 ] ) part( g, new CylinderGeometry( 0.018, 0.018, 0.71, 6 ), mat( 0.86, 0.78, 0.6, 0.6 ), x, 0.355, 0 ); part( g, new BoxGeometry( 0.24, 0.02, 0.02 ), mat( 0.86, 0.78, 0.6, 0.6 ), 0, 0.72, 0 ); },
	cricket_bat: () => g => { part( g, new CylinderGeometry( 0.016, 0.016, 0.3, 8 ), mat( 0.1, 0.1, 0.1, 0.7 ), 0, - 0.15, 0 ); part( g, new BoxGeometry( 0.108, 0.56, 0.045 ), mat( 0.88, 0.78, 0.58, 0.6 ), 0, - 0.58, 0 ); },
	tennis_ball: () => g => { part( g, new CylinderGeometry( 0.034, 0.034, 0.06, 10 ), mat( 0.8, 0.95, 0.2, 0.8 ), 0, 0.03, 0 ); },
	frisbee: () => g => { part( g, new CylinderGeometry( 0.135, 0.135, 0.025, 20 ), mat( 0.95, 0.4, 0.1, 0.4 ), 0, 0.012, 0 ); },
	stool: () => g => { part( g, new CylinderGeometry( 0.18, 0.18, 0.05, 14 ), mat( 0.45, 0.33, 0.22, 0.7 ), 0, 0.64, 0 ); for ( const [ x, z ] of [ [ 0.12, 0.12 ], [ - 0.12, 0.12 ], [ 0.12, - 0.12 ], [ - 0.12, - 0.12 ] ] ) part( g, new CylinderGeometry( 0.015, 0.015, 0.64, 6 ), mat( 0.3, 0.3, 0.3, 0.5 ), x, 0.32, z ); },
	clipboard: () => g => { part( g, new BoxGeometry( 0.23, 0.31, 0.008 ), mat( 0.55, 0.4, 0.25, 0.7 ), 0, 0, 0 ); part( g, new BoxGeometry( 0.2, 0.26, 0.004 ), mat( 0.96, 0.96, 0.94, 0.9 ), 0, - 0.01, 0.005 ); },
};
const TOWEL_TINT = { towel_a: [ 0.1, 0.45, 0.72 ], towel_b: [ 0.9, 0.55, 0.15 ], towel_c: [ 0.85, 0.25, 0.3 ], towel_d: [ 0.2, 0.6, 0.45 ] };
const UMBRELLA_TINT = { umbrella_a: [ 0.92, 0.9, 0.84 ], umbrella_b: [ 0.12, 0.42, 0.6 ] };

export class Beach {

	constructor( app ) {

		this.app = app;
		this.hub = app.people;
		this.people = [];
		this.bodies = [];     // loaded, not yet placed
		this.props = new Map();
		this.seq = 1000; this.frame = 0; this.loaded = 0;
		this.games = { cricket: null, frisbee: null };
		this.bird = { next: 20, on: null, done: false };
		this.attendant = null;
		this.root = new Group(); this.root.name = 'Beach';
		app.scene.add( this.root );

	}

	// the tideline: the first z (from the dunes out) where the sand goes under the sea
	shore( x ) {

		const t = this.app.terrainData;
		for ( let z = - 95; z < 20; z += 0.5 ) if ( t.heightAt( x, z ) < 0 ) return z;
		return - 42;

	}

	ground( x, z ) { return Math.max( 0, this.app.terrainData.heightAt( x, z ) ); }

	async init() {

		const base = import.meta.env.BASE_URL;
		// the props first (small), then the people, a cast at a time
		const names = [ 'towel_a', 'towel_b', 'towel_c', 'towel_d', 'umbrella_a', 'umbrella_b', 'esky', 'beach_bag', 'thongs', 'sun_hat', 'stumps', 'cricket_bat', 'tennis_ball', 'frisbee', 'stool', 'clipboard', 'bucket_hat', 'sunnies', 'book' ];
		await Promise.all( names.map( async n => {

			let root = null;
			if ( n !== 'stool' && n !== 'clipboard' ) try { root = ( await loadModel( `${ base }models/beach/${ n }.glb`, FADES.has( n ) ? { customize: fadeCustomize } : {} ) ).root; } catch { root = null; }
			const make = STAND_IN[ n.replace( /_[ab-d]$/, '' ) ] || STAND_IN[ n ];
			if ( ! root && ! make ) return;   // the worn and dropped extras have no stand-in: missing, they are left off
			if ( ! root ) { root = new Group(); make( TOWEL_TINT[ n ] || UMBRELLA_TINT[ n ] )( root ); root.standIn = true; }
			this.props.set( n, root );

		} ) );
		this.layout();
		this.plan();
		const want = { swim: [], clothed: [ 'm07', 'f06' ] };   // the two fishers keep their clothes
		// the hire attendant first: the swim crowd's m01 in the hire's teal tee (tools/beach/staff_shirt.py)
		try { await this.addBodies( await loadGLB( `${ base }models/beach/attendant.glb` ), 'staff', 1, false, true ); this.fill(); }
		catch ( e ) { console.warn( 'Beach: no attendant body, the clothed m04 stands in', e ); want.clothed.push( 'm04' ); const a = this.slots.find( s => s.role === 'attendant' ); if ( a ) a.cast = 'm04'; }
		for ( const cast of CAST ) for ( const kind of [ 'swim', 'clothed' ] ) {

			const n = kind === 'swim' ? 3 : want.clothed.includes( cast ) ? 1 : 0;
			if ( ! n ) continue;
			let gltf = null, swim = kind === 'swim';
			if ( swim ) try { gltf = await loadGLB( `${ base }models/characters/crowd/swim/${ cast }.glb` ); } catch { gltf = null; }
			if ( ! gltf ) { swim = false; try { gltf = await loadGLB( `${ base }models/characters/crowd/${ cast }.glb` ); } catch ( e ) { console.warn( 'Beach: failed to load', cast, e ); continue; } }
			await this.addBodies( gltf, cast, n, swim, kind === 'clothed' );
			this.fill();
			this.loaded ++;

		}
		this.fill( true );   // whoever is still waiting for a body that does not match a neighbour's

	}

	// n bodies of one cast (the first owns the textures, the rest share them)
	async addBodies( gltf, cast, n, swim, clothed ) {

		const walk = rootMotion( gltf ), maps = new Map();
		const bare = { ...gltf, materials: gltf.materials.map( m => ( { ...m, normalTexture: undefined, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, baseColorTexture: undefined, metallicRoughnessTexture: undefined } } ) ) };
		for ( let i = 0; i < n; i ++ ) {

			const model = await SkinnedModel.create( i ? bare : gltf, { materials: info => i ? fadeOptions( info, { textures: maps.get( info.name ) } ) : ( maps.set( info.name, info.textures ), fadeOptions( info ) ) } );
			for ( const m of model.materials ) m.underwaterLighting = 'lite';
			model.clipSet = new Set( model.clipNames() );
			this.bodies.push( { model, cast, walk, swim, clothed } );

		}

	}

	// the hire stand's deck: its root sits on the lowest corner (src/world/JetskiHire.js), the boards 0.131 m up
	deckY() { const S = JETSKI_HIRE.stand, t = this.app.terrainData; return this._deck ??= Math.min( ...[ [ - 1.5, - 0.8 ], [ 1.5, - 0.8 ], [ - 1.5, 0.8 ], [ 1.5, 0.8 ] ].map( ( [ x, z ] ) => t.heightAt( S.x + x, S.z + z ) ) ) + 0.131; }

	// the floor under a walker: the sand, or the stand's deck inside its footprint (the attendant's way out)
	floor( x, z ) { const S = JETSKI_HIRE.stand; return Math.abs( x - S.x ) < 1.4 && Math.abs( z - S.z ) < 0.75 ? this.deckY() : this.app.terrainData.heightAt( x, z ); }

	// the places: towels and camps, the cricket pitch, the frisbee pair, the tideline, the water, the pier end, the stool
	layout() {

		const S = x => this.shore( x ), put = ( n, x, z, yaw = 0, y = null, rx = 0 ) => { const src = this.props.get( n ); if ( ! src ) return null; const g = src.clone( true ); g.position.set( x, y ?? this.ground( x, z ), z ); g.rotation.y = yaw; g.rotation.x = rx; this.root.add( g ); g.updateMatrixWorld( true ); return g; };
		this.slots = [];
		for ( const c of CAMPS ) {

			const z0 = S( c.x ) - c.back;
			const U = this.props.get( c.umbrella ), ux = c.x + ( c.pole ?? 0 ), uz = z0 - 1.3;
			// behind and between them (c.pole). The Blender umbrella leans 16 degrees toward +z (the sea) itself and its pole
			// is sunk 0.2 m; the stand-in is tipped the same way here
			put( c.umbrella, ux, uz, 0, this.ground( ux, uz ) - ( U?.standIn ? 0 : 0.2 ), U?.standIn ? 0.18 : 0 );
			for ( const [ n, dx, dz, yaw ] of c.gear ) put( n, c.x + dx, z0 + dz, yaw ?? rand( - 0.12, 0.12 ) );
			const obj = this.hub.objects.add( new SmartObject( { kind: 'camp', tag: 'beach', slots: c.people.map( ( _, i ) => ( { i, mates: c.people.length > 1 ? [ i ? i - 1 : 1 ] : [] } ) ) } ) );
			c.people.forEach( ( [ kind, dx, dz, yaw ], i ) => this.slots.push( { role: 'camp', kind: TOWEL_KIND[ kind ], obj, i, at: new Vector3( c.x + dx, 0, z0 + dz ), yaw, archetype: c.archetypes?.[ i ], bookDown: c.bookDown === i } ) );

		}
		// beach cricket along the beach: stumps at the batter's end, an esky at the bowler's
		const cz = S( CRICKET.x ) - CRICKET.back, cx = CRICKET.x;
		put( 'stumps', cx - 6.2, cz, Math.PI / 2 ); put( 'esky', cx + 5.4, cz, Math.PI / 2 );
		const cricket = this.hub.objects.add( new SmartObject( { kind: 'cricket', tag: 'beach', slots: [ 0, 1, 2, 3 ].map( i => ( { i, mates: [] } ) ) } ) );
		const C = this.games.cricket = { t: rand( 0, 4 ), x: cx, z: cz, ball: put( 'tennis_ball', cx + 5, cz ), bat: null, who: {}, out: 0 };
		[ [ 'batter', cx - 5.7, cz, Math.PI / 2 ], [ 'bowler', cx + 7.5, cz, - Math.PI / 2 ], [ 'keeper', cx - 7.4, cz, Math.PI / 2 ], [ 'fielder', cx - 0.5, cz - 6.5, Math.PI * 0.85 ] ]
			.forEach( ( [ role, x, z, yaw ], i ) => this.slots.push( { role, kind: 'cricket', obj: cricket, i, at: new Vector3( x, 0, z ), yaw, archetype: role === 'batter' ? 'larrikin' : null } ) );
		// a frisbee pair east of the pier
		const fz = S( FRISBEE.x ) - FRISBEE.back, fz2 = S( FRISBEE.x2 ) - FRISBEE.back - 1;
		const fr = this.hub.objects.add( new SmartObject( { kind: 'frisbee', tag: 'beach', slots: [ { mates: [ 1 ] }, { mates: [ 0 ] } ] } ) );
		this.games.frisbee = { t: 0, disc: put( 'frisbee', FRISBEE.x, fz ), from: 0 };
		this.slots.push( { role: 'frisbee', kind: 'frisbee', obj: fr, i: 0, at: new Vector3( FRISBEE.x, 0, fz ), yaw: Math.atan2( FRISBEE.x2 - FRISBEE.x, fz2 - fz ) } );
		this.slots.push( { role: 'frisbee', kind: 'frisbee', obj: fr, i: 1, at: new Vector3( FRISBEE.x2, 0, fz2 ), yaw: Math.atan2( FRISBEE.x - FRISBEE.x2, fz - fz2 ) } );
		// shell hunters on the wet sand
		const sh = this.hub.objects.add( new SmartObject( { kind: 'shells', tag: 'beach', slots: SHELLS.map( ( _, i ) => ( { i, mates: [] } ) ) } ) );
		SHELLS.forEach( ( [ a, b ], i ) => { const x = rand( a, b ); this.slots.push( { role: 'shells', kind: 'shells', obj: sh, i, at: new Vector3( x, 0, S( x ) - 1.2 ), yaw: Math.PI / 2, range: [ a, b ], archetype: i ? null : 'elderly' } ); } );
		// swimmers out past the break (1.4 m and deeper), two wading and chatting in the shallows
		const deep = ( x, d ) => { const s = S( x ); for ( let z = s; z < s + 45; z += 0.5 ) if ( this.app.terrainData.heightAt( x, z ) < - d ) return z; return s + 12; };
		const sw = this.hub.objects.add( new SmartObject( { kind: 'swim', tag: 'beach', slots: SWIM.map( ( _, i ) => ( { i, mates: [] } ) ) } ) );
		SWIM.forEach( ( x, i ) => this.slots.push( { role: 'swim', kind: 'swim', obj: sw, i, at: new Vector3( x, 0, deep( x, 1.45 ) + rand( 0, 3 ) ), yaw: Math.PI + rand( - 0.5, 0.5 ) } ) );
		const wd = this.hub.objects.add( new SmartObject( { kind: 'wade', tag: 'beach', slots: [ { mates: [ 1 ] }, { mates: [ 0 ] } ] } ) );
		const wz = deep( 10.6, 0.4 );
		this.slots.push( { role: 'wade', kind: 'wade', obj: wd, i: 0, at: new Vector3( WADE[ 0 ], 0, wz ), yaw: 1.3 } );
		this.slots.push( { role: 'wade', kind: 'wade', obj: wd, i: 1, at: new Vector3( WADE[ 1 ], 0, wz + 0.35 ), yaw: - 1.6 } );
		// two lines out off the pier end (clothed), facing the sea
		const ln = this.hub.objects.add( new SmartObject( { kind: 'line', tag: 'pier', slots: [ { mates: [ 1 ] }, { mates: [ 0 ] } ] } ) );
		FISH.forEach( ( [ x, z ], i ) => { const y = this.app.colliders?.groundHeightAt?.( x, z, 6 ); this.slots.push( { role: 'fish', kind: 'line', obj: ln, i, at: new Vector3( x, Number.isFinite( y ) && y > 1 ? y : WORLD.pier.deckHeight, z ), yaw: 0, clothed: true, deck: true } ); } );
		// The hire stand has a solid collision envelope. Seat its attendant just
		// behind it on supported sand, with a clear capsule exit toward the village.
		const H = JETSKI_HIRE.stand, sx = H.x + 0.65, sz = H.z - H.half[ 2 ] - 0.7, deck = this.ground( sx, sz );
		put( 'stool', sx, sz, Math.PI / 2, deck );
		const st = this.hub.objects.add( new SmartObject( { kind: 'stool', tag: 'hire', slots: [ { mates: [] } ] } ) );
		this.slots.push( { role: 'attendant', kind: 'stool', obj: st, i: 0, at: new Vector3( sx - 0.05, this.ground( sx - 0.05, sz ), sz ), yaw: Math.PI / 2, clothed: true, deck: false, cast: 'staff', archetype: 'friendly' } );

	}

	// who goes where, decided once the slots are laid out: each swim slot is promised a cast (three bodies
	// each) that none of its neighbours has, so the casts can load in any order without twins side by side
	plan() {

		const left = new Map( CAST.map( c => [ c, 3 ] ) );
		for ( const s of this.slots ) {

			if ( s.cast || s.clothed ) continue;
			const near = new Set( this.slots.filter( o => o !== s && o.want && Math.hypot( o.at.x - s.at.x, o.at.z - s.at.z ) < NEIGHBOUR ).map( o => o.want ) );
			const open = CAST.filter( c => left.get( c ) > 0 ), free = open.filter( c => ! near.has( c ) ), pool = free.length ? free : open;
			if ( ! pool.length ) break;
			const most = Math.max( ...pool.map( c => left.get( c ) ) );
			s.want = pick( pool.filter( c => left.get( c ) === most ) );
			left.set( s.want, left.get( s.want ) - 1 );

		}

	}

	// place bodies as they load: the clothed roles take the clothed bodies (their cast where named)
	// and never the same body as a neighbour's (within NEIGHBOUR m: a camp, or the camp next door): plan() gives
	// each crowd slot its cast up front and a slot waits for that cast; the last pass (`last`, once everything
	// has loaded) takes what is left, still keeping clear of a neighbour's body where it can.
	fill( last = false ) {

		for ( const s of [ ...this.slots ].sort( ( a, b ) => !! b.cast - !! a.cast ) ) {   // named casts first (the attendant)

			if ( s.who ) continue;
			const ok = b => ( s.clothed ? b.clothed : ! b.clothed ) && ( ! s.cast || b.cast === s.cast );
			const use = c => this.people.filter( p => p.cast === c ).length;
			const beside = c => this.slots.some( o => o !== s && o.who?.cast === c && Math.hypot( o.at.x - s.at.x, o.at.z - s.at.z ) < NEIGHBOUR );
			let options = this.bodies.filter( b => ok( b ) && ( last || ! s.want || b.cast === s.want ) );
			if ( ! s.cast ) { const apart = options.filter( b => ! beside( b.cast ) ); if ( apart.length || ! last ) options = apart; }
			if ( ! options.length ) continue;
			const least = Math.min( ...options.map( b => use( b.cast ) ) ), body = pick( options.filter( b => use( b.cast ) === least ) );
			this.bodies.splice( this.bodies.indexOf( body ), 1 );
			s.who = this.spawn( body, s );

		}

	}

	spawn( body, s ) {

		const outer = new Group(), tilt = new Group();
		outer.name = 'Beach:' + body.cast + ':' + s.role;
		tilt.add( body.model.group ); outer.add( tilt ); this.root.add( outer );
		const y = s.deck ? s.at.y : s.kind === 'swim' ? 0 : this.app.terrainData.heightAt( s.at.x, s.at.z );
		const p = { ...body, group: outer, tilt, id: ++ this.seq, role: s.role, slotDef: s, home: new Vector3( s.at.x, y, s.at.z ), world: new Vector3( s.at.x, y, s.at.z ), yaw: s.yaw, face: s.yaw,
			look: 0, pitch: 0, acc: Math.random() * 0.1, lie: 0, sit: 0, path: null, pace: rand( 1.1, 1.4 ), mode: 'stand', beat: null, off: null };
		p.posture = 'stand'; p.head = new Vector3(); p.can = key => p.model.clipSet.has( CLIP[ key ] ); p.clipOf = key => CLIP[ key ];   // clip keys for bumps (Contact.js)
		p.base = new Vector3(); p.based = false; p.clipOf = key => CLIP[ key ];
		// a knock's step: on the pier's planks or the stand's deck, the boards (clamped at the rail); on the sand, the sand
		p.canStand = ( w, base ) => p.evacuation ? this.hub.evacuation.walker.canStand( w, base ) : s.kind !== 'swim' && ( s.deck ? this.hub.contact.boards( w, base ) : this.app.terrainData.heightAt( w.x, w.z ) > - 0.4 && Math.abs( this.app.terrainData.heightAt( w.x, w.z ) - base.y ) < 0.5 );
		p.footing = () => LOW.has( p.mode ) ? 'seat' : s.deck || s.role === 'attendant' ? 'narrow' : 'open';
		p.model.play( CLIP.idle, { fade: 0.01, from: Math.random() * p.model.clipDuration( CLIP.idle ) } );
		p.model.onClipEnd = () => { p.gesture = null; };
		this.hub.add( p, { archetype: s.archetype || pickArchetype() } );
		s.obj.claim( s.i, p );
		p.mode = { camp: s.kind === 'sand' ? 'sand' : 'lie', swim: 'tread', stool: 'stool' }[ s.role === 'camp' ? 'camp' : s.kind ] || 'stand';
		if ( s.kind === 'reader' && ! s.bookDown ) this.hub.contact.give( p, 'book' );   // bookDown: theirs lies open on the towel
		// hats and sunnies on a few: the attendant's sunnies, a bucket hat on the bowler and the frisbee thrower, a sun
		// hat on the elderly shell hunter and a wader, sunnies on the phoner and the frisbee catcher; the sand sitters
		// take turns (a sun hat, a bucket hat, bare-headed) so two of one cast side by side never match
		const sand = s.kind === 'sand' ? [ 'sun_hat', 'bucket_hat', null ][ p.id % 3 ] : null;
		const kit = s.role === 'attendant' || s.kind === 'phoner' || ( s.role === 'frisbee' && s.i === 1 ) ? 'sunnies'
			: s.role === 'bowler' || ( s.role === 'frisbee' && s.i === 0 ) ? 'bucket_hat'
				: ( s.role === 'shells' && s.i === 0 ) || ( s.role === 'wade' && s.i === 1 ) ? 'sun_hat' : sand;
		if ( kit ) this.wear( p, kit );
		if ( s.kind === 'phoner' || s.role === 'attendant' ) this.hub.contact.give( p, 'phone' );
		if ( s.role === 'fish' ) this.hub.contact.give( p, 'rod' );
		if ( s.role === 'shells' && Math.random() < 0.5 ) this.hub.contact.give( p, 'bag' );
		if ( s.role === 'batter' ) { const bat = this.props.get( 'cricket_bat' ).clone( true ); p.model.group.add( bat ); p.bat = bat; }
		if ( s.role === 'attendant' ) { this.attendant = p; p.stool = p.home.clone(); }
		if ( s.role === 'shells' ) { p.range = s.range; p.dir = Math.random() < 0.5 ? 1 : - 1; p.stopIn = rand( 4, 9 ); }
		if ( s.role === 'swim' ) p.drift = rand( 0, 6.28 );
		this.people.push( p );
		this.hub.evacuation.register( p );
		return p;

	}

	// walk someone along points (world, feet; y from the sand), then call `then`
	send( p, points, then = null ) { p.beat = null; p.gesture = null; p.path = [ p.world.clone(), ...points.map( v => v.clone() ) ]; p.s = 0; p.then = then; p.mode = 'stand'; }

	// a scripted clip for a while (a push, tying up, a crouch for a shell), then `then`
	beat( p, key, secs, then = null ) { p.beat = { key, until: this.hub.t + secs, then }; const clip = CLIP[ key ]; if ( p.model.clipSet.has( clip ) ) p.model.play( clip, { fade: 0.3, loop: key !== 'crouchIn' } ); }

	// a one-shot clip that always plays from its start (SkinnedModel.play hands back the same clip's ended
	// layer, which would never end again and hold the walk), with a timer in case the end is missed
	gest( p, key ) {

		const clip = CLIP[ key ] || key, m = p.model;
		if ( ! m.clipSet.has( clip ) ) return false;
		const L = m.play( clip, { fade: 0.25, loop: false } );
		L.time = 0; L.ended = false; L.loop = false;
		p.gesture = clip; p.gestureEnd = this.hub.t + m.clipDuration( clip ) + 0.4;
		return true;

	}

	// put someone somewhere at once (their place and their knock base both)
	moveTo( p, v ) { p.world.copy( v ); p.base.copy( v ); }

	say( p, key, urgent = false ) { const text = line( key, p.brain.type, p.brain.said ); if ( text ) this.hub.say( p, text, key, urgent ); }

	update( dt ) {

		if ( ! this.people.length ) return;
		const t0 = performance.now(), app = this.app, cam = app.camera.position, dir = app.camera.getWorldDirection( _w );
		this.frame ++;
		if ( ! this.people.some( p => p.evacuation ) ) {
			this.cricket( dt ); this.frisbee( dt ); this.cocky( dt );
			app.jetskiHire?.desk?.update( dt );
		}
		for ( const p of this.people ) this.step( p, dt, cam, dir );
		this.hub.charge( performance.now() - t0 );

	}

	step( p, dt, cam, dir ) {

		const m = p.model, b = p.brain, t = this.hub.t, knocked = !! p.knock;
		if ( p.based ) p.world.copy( p.base );
		const evacuating = this.hub.evacuation.step( p, dt );
		const standing = ! LOW.has( p.mode ) && p.mode !== 'tread';
		if ( ! evacuating && b.gesture && ! p.gesture && ! knocked && ! p.beat && ! p.path ) {   // on the beach a walker keeps walking (an errand, a shell hunt)

			if ( standing && this.gest( p, b.gesture.clip ) && b.gesture.greet ) p.greeted = p.gesture;
			b.gesture = null;

		}
		if ( p.gesture && t > ( p.gestureEnd ?? 0 ) ) p.gesture = null;
		if ( p.beat && t >= p.beat.until ) { const then = p.beat.then; p.beat = null; then?.(); }
		// walking (the shell hunters, the bowler's run-up, the attendant)
		if ( ! evacuating && p.path && ! p.gesture && ! knocked ) {

			const P = p.path, a = P[ 0 ], c = P[ 1 ], seg = Math.hypot( c.x - a.x, c.z - a.z );
			p.s += p.pace * dt;
			if ( p.s >= seg ) { p.s -= seg; P.shift(); }
			if ( P.length < 2 ) { p.world.copy( P[ 0 ] ); p.path = null; p.world.y = this.floor( p.world.x, p.world.z ); const then = p.then; p.then = null; then?.(); }
			else {

				const f = seg > 1e-4 ? Math.min( 1, p.s / seg ) : 1;
				p.world.copy( a ).lerp( c, f ); p.world.y = this.floor( p.world.x, p.world.z );
				if ( seg > 0.05 ) p.heading = Math.atan2( c.x - a.x, c.z - a.z );
				if ( m.current !== CLIP.walk ) m.play( CLIP.walk, { fade: 0.3, speed: Math.min( 1.7, Math.max( 0.6, p.pace / p.walk ) ) } );

			}

		}
		if ( ! evacuating && p.role === 'shells' ) this.shells( p, dt );
		p.base.copy( p.world ); p.based = true;
		const K = this.hub.contact.body( p, dt );
		if ( ! evacuating && ! p.path && ! p.gesture && ! p.knock && ! K?.walk && ! p.beat ) this.idle( p );
		p.posture = p.evacuation?.moving || p.path || K?.walk ? 'walk' : LOW.has( p.mode ) ? 'sit' : 'stand';
		// facing: the way they walk, else their place's way, turned to what the brain looks at (lying: the head only)
		let want = p.evacuation?.moving || p.path ? p.heading ?? p.face : p.face;
		const target = b.target && t < b.lookUntil ? b.target : null;
		let look = 0, pitch = p.path ? 0 : b.activity?.pitch || 0;
		if ( target && p.mode !== 'tread' ) {

			const dx = target.x - p.world.x, dz = target.z - p.world.z, to = Math.atan2( dx, dz );
			if ( p.mode !== 'lie' ) pitch = clamp( Math.atan2( p.head.y - target.y, Math.hypot( dx, dz ) || 1 ), 0.6 );
			if ( standing && t < b.engagedUntil && ! p.beat ) want = to;
			look = clamp( wrap( to - p.yaw ), p.mode === 'lie' ? 0.7 : 1.1 );

		}
		if ( K ) { if ( K.lockYaw ) want = p.yaw; else if ( K.face !== null && K.face !== undefined ) want = K.face; }
		const k = 1 - Math.exp( - dt * 4 );
		if ( ! LOW.has( p.mode ) ) p.yaw += wrap( want - p.yaw ) * ( 1 - Math.exp( - dt * 5 ) ); else p.yaw = p.face;
		p.look += ( look - p.look ) * k; p.pitch += ( pitch - p.pitch ) * k;
		// lying down and sitting up ease over about a second
		p.lie += ( ( p.mode === 'lie' ? 1 : 0 ) - p.lie ) * ( 1 - Math.exp( - dt * 3 ) );
		p.sit += ( ( p.mode === 'sand' ? 1 : 0 ) - p.sit ) * ( 1 - Math.exp( - dt * 3 ) );
		const g = p.group;
		g.position.copy( p.world );
		if ( p.mode === 'tread' ) g.position.y = - TREAD + 0.04 * Math.sin( t * 1.3 + p.id );
		else g.position.y += p.lie * LIE - p.sit * this.seat( p ) + ( p.mode === 'stool' ? STOOL : 0 ) - ( K?.drop || 0 );
		g.rotation.y = p.yaw;
		p.tilt.rotation.x = - Math.PI / 2 * p.lie;
		// knocked flat (Contact.js tumble): the ragdoll draws the model in the world, so the groups sit at the origin
		if ( K?.rag ) { g.position.set( 0, 0, 0 ); g.rotation.y = 0; p.tilt.rotation.x = 0; g.visible = true; p.acc = 0; this.hub.contact.rag( p, dt ); if ( p.bat ) this.batAt( p ); return; }
		// the eyes, for mates' looks and the bubbles
		const hy = p.mode === 'tread' ? 0.25 - g.position.y : p.mode === 'stool' ? 1.2 + STOOL : 1.6 - 0.8 * p.sit;
		// lying, the feet go 0.85 m toward the sea so the body lies along the towel
		const sy = Math.sin( p.yaw ), cy = Math.cos( p.yaw );
		g.position.x += sy * 0.85 * p.lie; g.position.z += cy * 0.85 * p.lie;
		if ( p.lie > 0.5 ) p.head.set( g.position.x - sy * 1.55, g.position.y + 0.3, g.position.z - cy * 1.55 );
		else p.head.copy( g.position ).y += hy;
		// detail by distance (p.lod from the hub): hidden past 90 m, frozen far, a third of the frames mid or behind, still ones every other frame
		const d2 = p.world.distanceToSquared( cam );
		g.visible = d2 < 90 * 90;
		p.acc += dt;
		if ( ! g.visible ) { p.acc = 0; return; }   // SkinnedModel.settle() holds the pose on draw
		if ( p.lod === 'far' ) { p.acc = 0; return; }
		const ahead = ( p.world.x - cam.x ) * dir.x + ( p.world.y - cam.y ) * dir.y + ( p.world.z - cam.z ) * dir.z;
		const every = p.lod === 'mid' || ahead < - 2 ? ( STILL.has( p.mode ) ? 6 : 3 ) : STILL.has( p.mode ) && ! p.gesture ? 3 : 1;
		if ( ( this.frame + p.id ) % every ) return;
		m.update( p.acc * ( p.mode === 'lie' ? 0.35 : 1 ) );
		p.acc = 0;
		const legs = Math.max( K?.legs || 0, p.sit * SAND.legs );
		pose( m, p.look, p.pitch, 0, 1, legs > 0.01 || K ? { legs, arms: K?.arms || 0, tilt: K?.tilt || 0, stepL: K?.stepL || 0, stepR: K?.stepR || 0 } : null );
		if ( p.item ) this.hub.contact.hand( p );
		if ( p.bat ) this.batAt( p );
		if ( p.wear ) this.wearAt( p );

	}

	// a hat or sunnies on the head bone: placed once against the rest pose (upright, facing +z), then carried by
	// the head's matrix each animated frame; it fades with the person (People.js, Fade.js setGroupFade)
	wear( p, n ) {

		const src = this.props.get( n ), m = p.model, h = m.gltf.nodes.findIndex( q => q.name === 'Bip01 Head' );
		if ( ! src || src.standIn || h < 0 ) return;
		const R = new Matrix4(), M = new Matrix4(), q = new Quaternion(), t = new Vector3(), sc = new Vector3();
		for ( let i = h; i >= 0; i = m.parent[ i ] ) R.premultiply( M.compose( t.fromArray( m.rest[ i ].t ), q.fromArray( m.rest[ i ].r ), sc.fromArray( m.rest[ i ].s ) ) );
		const e = R.elements, o = WEAR[ n ]( p.cast[ 0 ] === 'f' ? 0.217 : 0.232 );
		const L = R.clone().invert().multiply( M.makeTranslation( e[ 12 ] + o[ 0 ], e[ 13 ] + o[ 1 ], e[ 14 ] + o[ 2 ] ) );
		const g = src.clone( true );
		g.name = 'Wear:' + n; m.group.add( g );
		( p.wear ||= [] ).push( { g, L, h, n } );

	}

	wearAt( p ) {

		const W = p.model.world;
		for ( const w of p.wear ) { _m.fromArray( W, w.h * 16 ).multiply( w.L ).decompose( w.g.position, w.g.quaternion, w.g.scale ); }

	}

	// the brain's activity as a clip: towels lie down or sit up, the sand and the stool sit, the water treads
	idle( p ) {

		const m = p.model, a = p.brain.activity;
		if ( p.role === 'camp' && p.slotDef.kind !== 'sand' ) p.mode = a?.clip === 'lie' ? 'lie' : 'sand';
		let key;
		if ( p.mode === 'lie' || p.mode === 'tread' ) key = p.mode;
		else if ( LOW.has( p.mode ) ) key = a && SITTING.has( a.clip ) ? a.clip : 'sit';
		else if ( p.role === 'keeper' ) key = 'crouch';
		else key = a && ! SITTING.has( a.clip ) && CLIP[ a.clip ] ? a.clip : 'idle';
		let clip = CLIP[ key ];
		if ( ! m.clipSet.has( clip ) ) clip = CLIP[ SITTING.has( key ) ? 'sit' : 'idle' ];
		if ( m.current !== clip ) m.play( clip, { fade: 0.6, from: key === 'sit' ? Math.random() * 10 : 0 } );

	}

	// how far a sand sitter drops: the chair-sit clips hold the pelvis at chair height, so the model goes down
	// until the pelvis bone sits SAND.seat above the sand under the pelvis itself (not under the feet: the beach
	// slopes, and the casts' hips differ by a few cm, so a fixed drop left some sitting on air). Last frame's pose
	// (model-local) serves; mid-blend (the pelvis still high) or with no pelvis bone the fixed drop stands.
	seat( p ) {

		const m = p.model, W = m.world;
		if ( m._pelvis === undefined ) m._pelvis = m.gltf.nodes.findIndex( n => n.name === 'Bip01 Pelvis' );
		const i = m._pelvis, ly = i < 0 ? 1 : W[ i * 16 + 13 ];
		if ( p.mode !== 'sand' || ! ( ly > 0.35 && ly < 0.75 ) ) return SAND.drop;
		const lx = W[ i * 16 + 12 ], lz = W[ i * 16 + 14 ], s = Math.sin( p.yaw ), c = Math.cos( p.yaw );
		const x = p.world.x + c * lx + s * lz, z = p.world.z - s * lx + c * lz;
		return Math.min( 0.6, Math.max( 0.3, p.world.y + ly - SAND.seat - this.floor( x, z ) ) ) || SAND.drop;

	}

	// the bat in the batter's hands: grounded at the crease, lifted as the ball comes, swung through
	batAt( p ) {

		const C = this.games.cricket, bt = p.bat, s = C.swing ?? 0;
		bt.position.set( - 0.12, 0.92 - 0.05 * s, 0.28 );
		bt.rotation.x = 0.35 - 2.2 * s; bt.rotation.z = 0.25;

	}

	// Beach cricket: the bowler runs in and bowls, one bounce to the batter, a swing, the ball skied to
	// the fielder (a catch: "Howzat!", else a throw back), the bowler walks back to the mark.
	cricket( dt ) {

		const C = this.games.cricket, W = C && this.who( 'cricket' );
		if ( ! W?.bowler || ! W.batter ) return;
		const bw = W.bowler, bat = W.batter, fl = W.fielder, t0 = C.t, ball = C.ball;
		C.t += dt;
		const T = C.t, x = C.x, z = C.z, y0 = this.ground( x, z );
		const arc = ( a, b, h, f ) => _v.copy( a ).lerp( b, f ).setY( a.y + ( b.y - a.y ) * f + 4 * h * f * ( 1 - f ) );
		const hand = ( p, up = 1.5 ) => new Vector3( p.world.x, p.world.y + up, p.world.z );
		if ( t0 === 0 || T < t0 ) return;
		if ( t0 < 0.01 && ! bw.path ) { this.send( bw, [ new Vector3( x + 5.2, 0, z ) ] ); bw.pace = 2.3; }
		if ( t0 < 2.2 && T >= 2.2 ) { bw.face = - Math.PI / 2; this.gest( bw, 'point' ); }
		C.swing = T > 2.9 && T < 3.5 ? Math.sin( Math.PI * ( T - 2.9 ) / 0.6 ) : T > 2.3 && T < 2.9 ? - 0.25 * ( T - 2.3 ) / 0.6 : 0;
		const release = hand( bw, 1.9 ), bounce = new Vector3( x - 2.8, y0 + 0.04, z ), bat0 = new Vector3( x - 5.4, y0 + 0.7, z + 0.2 );
		C.catch = C.catch ?? Math.random() < 0.35;
		if ( T < 2.2 ) ball.position.copy( hand( bw, 1.3 ) );
		else if ( T < 2.75 ) ball.position.copy( arc( release, bounce, 0.15, ( T - 2.2 ) / 0.55 ) );
		else if ( T < 3.15 ) ball.position.copy( arc( bounce, bat0, 0.25, ( T - 2.75 ) / 0.4 ) );
		else if ( fl && T < 4.9 ) { ball.position.copy( arc( bat0, hand( fl, 1.7 ), 5.5, ( T - 3.15 ) / 1.75 ) ); if ( t0 < 3.15 ) this.say( bat, C.catch ? 'cricket-shot' : 'cricket-shot', false ); }
		else if ( fl && T < 6.4 ) { if ( t0 < 4.9 ) { this.gest( fl, C.catch ? 'wave' : 'point' ); if ( C.catch ) { this.say( fl, 'howzat', false ); C.out ++; } } ball.position.copy( arc( hand( fl, 1.7 ), hand( bw, 1.4 ), 2.2, ( T - 4.9 ) / 1.5 ) ); }
		else if ( T < 10 ) { ball.position.copy( hand( bw, 1.3 ) ); if ( t0 < 6.4 ) { this.send( bw, [ new Vector3( x + 7.5, 0, z ) ], () => { bw.face = - Math.PI / 2; } ); bw.pace = 1.3; } }
		else { C.t = 0.001; C.catch = null; }
		ball.updateMatrixWorld?.( true );

	}

	// Frisbee: a flat spinning arc from one to the other, a reach up to catch, a pause, back again.
	frisbee( dt ) {

		const F = this.games.frisbee, W = F && this.who( 'frisbee' );
		const A = W?.[ 0 ], B = W?.[ 1 ];
		if ( ! A || ! B ) return;
		const t0 = F.t; F.t += dt;
		const [ from, to ] = F.from ? [ B, A ] : [ A, B ];
		const T = F.t, fly = 1.7;
		if ( t0 === 0 ) this.gest( from, 'point' );
		const a = _v.set( from.world.x, from.world.y + 1.2, from.world.z ), b = new Vector3( to.world.x, to.world.y + 1.45, to.world.z ), f = Math.min( 1, T / fly );
		F.disc.position.copy( a ).lerp( b, f ); F.disc.position.y += 4 * 0.9 * f * ( 1 - f );
		F.disc.rotation.y += dt * 14; F.disc.rotation.z = 0.12 * Math.sin( f * 3 );
		if ( t0 < fly - 0.35 && T >= fly - 0.35 ) this.gest( to, 'wave' );
		if ( T > fly + 1.3 ) { F.t = 0; F.from ^= 1; }
		F.disc.updateMatrixWorld?.( true );

	}

	// the shell hunters: along the tideline and back, now and then down to pick one up
	shells( p, dt ) {

		if ( p.path || p.beat || p.knock || p.gesture ) return;
		p.stopIn -= dt;
		if ( p.stopIn <= 0 ) { p.stopIn = rand( 5, 11 ); this.beat( p, p.model.clipSet.has( CLIP.crouchIn ) ? 'crouchIn' : 'crouch', 2.2, () => { p.face = p.heading ?? p.face; } ); return; }
		let x = p.world.x + p.dir * rand( 3, 6 );
		if ( x < p.range[ 0 ] || x > p.range[ 1 ] ) { p.dir = - p.dir; x = p.world.x + p.dir * 4; }
		p.pace = rand( 0.75, 0.95 );
		this.send( p, [ new Vector3( x, 0, this.shore( x ) - rand( 0.8, 1.6 ) ) ] );

	}

	// Now and then (rarely) Cocky, out exploring, drops onto a sunbaker's knee or a sitter's shoulder
	// (read and steered through app.cockatoo's own landing: spot + startLanding). The person laughs and
	// takes a photo, shoos him off, or (a larrikin) offers him a chip.
	cocky( dt ) {

		const c = this.app.cockatoo, B = this.bird, t = this.hub.t;
		if ( ! c ) return;
		if ( B.on ) {

			const p = B.on;
			if ( c.mode === 'resting' && c.spot === B.spot && ! B.reacted ) {

				B.reacted = true;
				const kind = p.brain.type === 'larrikin' ? 'chip' : p.brain.type === 'grumpy' || p.brain.type === 'shy' ? 'shoo' : 'photo';
				B.kind = kind;
				p.brain.target = c.pos; p.brain.lookUntil = t + 6;
				if ( kind === 'chip' ) this.hub.contact.give( p, 'chips' );
				if ( kind === 'photo' && p.item?.kind !== 'phone' ) this.hub.contact.give( p, 'phone' );
				this.say( p, 'cocky-' + kind, true );
				this.hub.bus.emit( 'bird-landed', c.pos, 7 );
				if ( kind === 'shoo' ) B.shooAt = t + 2.5;

			}
			if ( B.shooAt && t > B.shooAt && c.mode === 'resting' ) { B.shooAt = 0; c.takeOff?.( 'explore' ); }
			if ( ( c.mode !== 'resting' && c.mode !== 'flying' ) || ( c.mode === 'flying' && ! c.land && ( B.reacted || c.spot !== B.spot ) ) ) { if ( B.kind === 'photo' || B.kind === 'chip' ) this.hub.contact.release( p ); B.on = null; B.next = t + rand( 40, 90 ); }
			return;

		}
		if ( t < B.next || c.mode !== 'flying' || c.goal !== 'explore' || c.land || ! c.startLanding ) return;
		B.next = t + 1;
		if ( Math.random() > ( this.app.forceCocky ? 1 : 0.08 ) ) return;
		const pl = this.app.player.position;
		const options = this.people.filter( p => ( p.mode === 'lie' || p.mode === 'sand' ) && ! p.knock && p.lod === 'near' && Math.hypot( p.world.x - pl.x, p.world.z - pl.z ) > 4 && Math.hypot( p.world.x - pl.x, p.world.z - pl.z ) < 20 );
		if ( ! options.length ) return;
		const p = pick( options ), sy = Math.sin( p.yaw ), cy = Math.cos( p.yaw ), f = p.group.position;
		// lying: the knee, 0.5 m up the body from the feet; sitting: a raised knee in front
		const pos = p.mode === 'lie' ? new Vector3( f.x - sy * 0.5, f.y + 0.14, f.z - cy * 0.5 ) : new Vector3( p.world.x + sy * 0.32, p.world.y - SAND.drop + 0.95, p.world.z + cy * 0.32 );
		B.spot = { pos, person: p }; B.on = p; B.reacted = false; B.shooAt = 0;
		c.spot = B.spot; c.startLanding( 'spot' );

	}

	who( kind ) {

		const out = {};
		for ( const p of this.people ) if ( p.slotDef.kind === kind ) { out[ p.role ] = p; out[ p.slotDef.i ] = p; }
		return out;

	}

	state() {

		return {
			loaded: this.loaded, count: this.people.length, props: [ ...this.props ].map( ( [ n, r ] ) => n + ( r.standIn ? ':stand-in' : '' ) ),
			swim: this.people.filter( p => p.swim ).length,
			cricket: this.games.cricket && { t: + this.games.cricket.t.toFixed( 2 ), out: this.games.cricket.out, ball: this.games.cricket.ball.position.toArray().map( v => + v.toFixed( 2 ) ) },
			frisbee: this.games.frisbee && { t: + this.games.frisbee.t.toFixed( 2 ), disc: this.games.frisbee.disc.position.toArray().map( v => + v.toFixed( 2 ) ) },
			bird: { on: this.bird.on?.id ?? null, kind: this.bird.kind || null, next: + this.bird.next.toFixed( 1 ) },
			people: this.people.map( p => ( { id: p.id, cast: p.cast, swim: p.swim, role: p.role, mode: p.mode, clip: p.model.current, lod: p.lod, posture: p.posture, fade: + ( p.fade || 0 ).toFixed( 2 ),
				activity: p.brain.activity?.name || null, type: p.brain.type, item: p.item ? p.item.kind : null, knock: p.knock?.kind || null, evacuation: p.evacuation?.phase || null, world: p.world.toArray().map( v => + v.toFixed( 2 ) ), gesture: p.gesture || null, path: p.path ? p.path.length : 0, beat: p.beat?.key || null } ) ),
		};

	}

}
