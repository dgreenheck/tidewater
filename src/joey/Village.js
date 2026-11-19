import { Vector3, BufferGeometry, BufferAttribute } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { Material } from '../engine/render/Material.js';
import { Vendor } from '../game/Vendor.js';

// The shopping village on the Joey Island terminal flat (tools/joey/village_build.py): a row of four
// shops behind a verandah, a footpath with bollards and a car park off the yard road. It belongs to
// Joey alone (the same terminal model also stands at Tidewater). Its colliders go in before the car
// physics reads the static boxes (App.init), so cars stop against the building and the bollards.
// Two shopkeepers trade: Dazza at Joey Island Tackle & Bait sells the chandlery's gear levels (the
// 'shop' panel) and Bev at Joey Island Gifts sells souvenirs (the 'gifts' panel, src/game/Souvenirs.js).
const KINDS = {
	walk: { walkable: true, solid: true, tag: 'village' },       // footpath, kerbs, shop floors
	solid: { solid: true, tag: 'village' },                     // walls, glazing, fittings, bollards
	car: { walkable: true, solid: true, tag: 'terminal-car' },  // the car park: asphalt to the car physics
};

// World-space weathering for the W* materials: broad blotches, fine grain, and a damp band at the
// foot of walls. Joey's terminal frame sits at world y 0, so the paving is at y 3.2.
const WEATHER = `
	let wp = in.P;
	let broad = sin( wp.x * 0.83 + sin( wp.z * 0.37 ) * 1.9 ) * sin( wp.z * 0.71 + wp.y * 0.53 + sin( wp.x * 0.29 ) );
	let fine = sin( wp.x * 3.1 + wp.y * 2.3 + wp.z * 0.7 ) * sin( wp.z * 2.7 - wp.y * 1.9 + wp.x * 0.4 );
	let grain = fract( sin( dot( floor( wp * 40.0 ), vec3f( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
	let wall = 1.0 - step( 0.6, abs( in.N.y ) );
	let damp = 1.0 - 0.2 * wall * ( 1.0 - smoothstep( 0.0, 0.8, wp.y - 3.3 ) );
	s.albedo = s.albedo * ( 1.0 + 0.12 * broad + 0.06 * fine + 0.1 * ( grain - 0.5 ) ) * damp;
	s.roughness = clamp( s.roughness + 0.06 * broad, 0.05, 1.0 );
`;
// Patterns for the fit-out materials (tools/joey/village_shops.py), drawn in the Joey terminal frame: `jl` is the
// point's terminal-frame (x, z), set up by the prelude that init() writes with the terminal's position and yaw.
const PATTERNS = {
	WPatVinyl: `
	let jtv = floor( jl / 0.3 ); let jfv = fract( jl / 0.3 );
	let jchk = abs( ( jtv.x + jtv.y ) - 2.0 * floor( ( jtv.x + jtv.y ) * 0.5 ) );
	let jhv = fract( sin( dot( jtv, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let jgrout = step( 0.015, jfv.x ) * step( 0.015, jfv.y );
	s.albedo = s.albedo * mix( 0.42, 1.0, jchk ) * ( 0.92 + 0.14 * jhv ) * mix( 0.55, 1.0, jgrout );`,
	WPatBoards: `
	let jbw = jl.x / 0.14; let jbi = floor( jbw );
	let jbl = ( jl.y + fract( sin( jbi * 91.7 ) * 437.5 ) * 1.8 ) / 1.8; let jli = floor( jbl );
	let jhb = fract( sin( jbi * 12.9898 + jli * 78.233 ) * 43758.5453 );
	let jseam = step( 0.035, fract( jbw ) ) * step( 0.006, fract( jbl ) );
	let jfig = 0.5 + 0.5 * sin( jl.y * 37.0 + sin( jl.x * 23.0 + jhb * 6.0 ) * 2.5 );
	s.albedo = s.albedo * ( 0.78 + 0.4 * jhb ) * ( 0.9 + 0.1 * jfig ) * mix( 0.4, 1.0, jseam );`,
	WPatPeg: `
	let jnx = abs( in.N.x * jC - in.N.z * jS );
	let jup = select( vec2f( jl.x, in.P.y ), vec2f( jl.y, in.P.y ), jnx > 0.5 ) / 0.05;
	let jhole = ( 0.5 + 0.5 * cos( jup.x * 6.2832 ) ) * ( 0.5 + 0.5 * cos( jup.y * 6.2832 ) );
	s.albedo = s.albedo * ( 1.0 - 0.75 * smoothstep( 0.8, 0.97, jhole ) );`,
	CeilingTile: `
	let jct = fract( jl / vec2f( 0.6, 1.2 ) );
	let jtee = step( 0.012, jct.x ) * step( 0.006, jct.y ) * step( jct.x, 0.988 ) * step( jct.y, 0.994 );
	let jfis = fract( sin( dot( floor( jl * 60.0 ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let jk = mix( 1.25, 1.0, jtee ) * ( 0.94 + 0.08 * jfis );
	s.albedo = s.albedo * jk; s.emissive = s.emissive * jk;`,
};
// W* materials weather; *Pat* ones and the ceiling tiles draw their pattern; the Pal* palette materials take their
// colour from the vertices (tools/joey/village_build.py family()).
const makeCustomize = ( prelude, made ) => ( source, options ) => {

	const name = source.name || '';
	let surface = options.surface || '';
	if ( PATTERNS[ name ] ) surface = prelude + PATTERNS[ name ] + surface;
	if ( /^W/.test( name ) ) surface = WEATHER + surface;
	return ( made[ name ] = { ...options, surface, vertexColors: /Pal/.test( name ) } );

};
// Indoors the engine's sky ambient has no roof to stop it, so floors and stock came out cold blue. Inside the shops
// the plain materials get a warm fill in proportion to their colour, standing in for the troffers.
const INDOOR = `
	s.emissive = s.emissive + s.albedo * vec3f( 0.36, 0.32, 0.26 );`;
// Past this far from the camera the village and its shopkeepers are hidden (nothing of it shows from Tidewater).
const FAR = 350;

// Terrain edits in the Joey terminal frame (applyTerminalSite): the ground under the car park, footpath and
// shops sits 0.3 m below the slabs so no ground cover shows through them, and plants and rocks keep off.
const FOOTPRINT = [ [ 10.8, - 94.9 ], [ 47.2, - 94.9 ], [ 47.2, - 59.4 ], [ 10.8, - 59.4 ] ];
export const JOEY_VILLAGE_SITE = { dredge: [ { poly: FOOTPRINT, depth: 2.9, blend: 0.6 } ], clear: [ { poly: [ [ 10.4, - 98.6 ], [ 47.6, - 98.6 ], [ 47.6, - 59.0 ], [ 10.4, - 59.0 ] ] } ] };

const KEEPERS = [
	{ at: 'TackleKeeper', name: 'Dazza · Joey Island Tackle & Bait', kind: 'shop', avatar: 'm04',
		greeting: 'G\'day. Rods, reels, line and bait. What are you chasing?',
		look: { shirt: 0x2f4a5a, trousers: 0x3a3a34, apron: 0x1e3a4a, hat: 0x2c3a44, hair: 0x4a3a2a, skin: 0x8a6446 } },
	{ at: 'GiftKeeper', name: 'Bev · Joey Island Gifts', kind: 'gifts', avatar: 'f03',
		greeting: 'Something to remember the island by?',
		look: { shirt: 0xb0624a, trousers: 0x3a4050, apron: 0xd9c9a0, hat: 0x6a5a40, hair: 0x9a8a78, skin: 0x9a7456 } },
];

export class JoeyVillage {

	constructor( app, terminal ) {

		this.app = app;
		this.terminal = terminal;
		this.yaw = terminal.yaw;
		this.root = null;
		this.stations = {};
		this.vendors = [];
		this.boxCount = 0;

	}

	toWorld( local, out ) { return this.terminal.toWorld( local, out ); }

	// The colliders and shopkeepers now, the model in the background: await `ready` for it.
	async init() {

		const base = import.meta.env.BASE_URL;
		const t0 = performance.now();
		const o = this.terminal.position, c = Math.cos( this.yaw ), s = Math.sin( this.yaw ), f = v => v.toFixed( 6 );
		const prelude = `
	let jC = ${ f( c ) }; let jS = ${ f( s ) };
	let jd = in.P.xz - vec2f( ${ f( o.x ) }, ${ f( o.z ) } );
	let jl = vec2f( jd.x * jC - jd.y * jS, jd.x * jS + jd.y * jC );`;
		this.made = {};       // material name -> the options it was made with (for the indoor copies)
		this.ready = Promise.all( [ loadModel( `${ base }joey/village.glb`, { customize: makeCustomize( prelude, this.made ) } ), this.terminal.ready ] )
			.then( ( [ model ] ) => this.place( model, t0 ) )
			.catch( e => console.error( '[village] village.glb failed to load', e ) );
		this.data = await fetch( `${ base }joey/village_colliders.json` ).then( r => r.json() );
		this.addColliders( this.data );
		this.addKeepers();

	}

	place( model, t0 ) {

		this.loadMs = Math.round( performance.now() - t0 );
		console.info( `[village] village.glb loaded in ${ this.loadMs } ms` );
		this.root = model.root;
		this.root.name = 'JoeyVillage';
		this.root.position.copy( this.terminal.position );
		this.root.rotation.y = this.yaw;
		this.app.scene.add( this.root );
		this.root.updateMatrixWorld( true );
		// The shop interiors, glass and lights stay out of the shadow pass: the shell's roof and walls shade them.
		// Plain interior materials swap to an indoor copy with the warm fill (one copy per material).
		const indoor = {};
		this.root.traverse( m => {

			if ( ! m.isMesh ) return;
			const inside = /^Village In/.test( m.parent?.name || '' ), name = m.material?.name || '';
			if ( inside || /Glass|Light|Tube|Lamp|Glow|Screen/.test( name ) ) m.castShadow = false;
			if ( inside && /Pal|Pat/.test( name ) && this.made[ name ] ) {

				indoor[ name ] ||= new Material( { ...this.made[ name ], name: `${ name } indoor`, surface: this.made[ name ].surface + INDOOR } );
				m.material = indoor[ name ];

			}

		} );
		this.vergeCut = this.clearVerge();

	}

	// Joey's copy of the terminal model covers the free flat the village now stands on with its own ground: a sandy
	// gravel sheet on a 1 m grid at the yard paving's height (3.2, level with the car park asphalt, so the two z-fought
	// and whole 1 m triangles of beige won through the asphalt in a staircase), and a scrubby verge 15 mm above it
	// (tools/ferry/terminal_build.py verge()). Their small faces over the site come out here; Tidewater's copy keeps them.
	clearVerge() {

		const root = this.terminal.root;
		if ( ! root ) return 0;
		root.updateMatrixWorld( true );
		const o = this.terminal.position, c = Math.cos( this.yaw ), s = Math.sin( this.yaw ), v = new Vector3();
		const site = i => {

			const dx = v.x - o.x, dz = v.z - o.z, x = dx * c - dz * s, z = dx * s + dz * c;
			return x > 10.4 && x < 47.6 && z > - 98.8 && z < - 58.8;

		};
		let cut = 0;
		root.traverse( mesh => {

			const g = mesh.geometry;
			if ( ! mesh.isMesh || ! /^(Verge|Saltbush|SandyGravel)/.test( mesh.material?.name || '' ) || ! g?.index ) return;
			const pos = g.attributes.position, idx = g.index.array, keep = [];
			for ( let t = 0; t < idx.length; t += 3 ) {

				// small faces only (a stray big one would leave a hole off the site); `vergeKept` counts any left
				let hit = false, x0 = Infinity, x1 = - Infinity, z0 = Infinity, z1 = - Infinity;
				for ( let k = 0; k < 3; k ++ ) {

					v.fromBufferAttribute( pos, idx[ t + k ] ).applyMatrix4( mesh.matrixWorld );
					hit = site() || hit;
					x0 = Math.min( x0, v.x ); x1 = Math.max( x1, v.x ); z0 = Math.min( z0, v.z ); z1 = Math.max( z1, v.z );

				}
				if ( hit && x1 - x0 < 4 && z1 - z0 < 4 ) cut ++;
				else { keep.push( idx[ t ], idx[ t + 1 ], idx[ t + 2 ] ); if ( hit ) this.vergeKept = ( this.vergeKept || 0 ) + 1; }

			}
			if ( keep.length === idx.length ) return;
			const next = new BufferGeometry();       // a fresh geometry, so no uploaded index buffer is reused
			for ( const [ name, attribute ] of Object.entries( g.attributes ) ) next.setAttribute( name, attribute );
			next.setIndex( new BufferAttribute( pos.count < 65536 ? new Uint16Array( keep ) : new Uint32Array( keep ), 1 ) );
			next.computeBoundingSphere();
			mesh.geometry = next;

		} );
		console.info( `[village] ${ cut } verge triangles cleared off the village site` );
		return cut;

	}

	// Hide the village and its shopkeepers when the camera is far off (App calls this every frame).
	update( camera ) {

		if ( ! this.root ) return;
		const c = this.centre || ( this.centre = this.toWorld( [ 29, 5, - 78 ] ) );
		const near = camera.position.distanceToSquared( c ) < FAR * FAR;
		if ( near === this.shown ) return;
		this.shown = near;
		this.root.visible = near;
		for ( const k of this.vendors ) k.group.visible = near;

	}

	// Boxes are axis aligned in the terminal frame, so in the world they turn with its yaw.
	addColliders( { boxes = [], stations = {} } ) {

		const { colliders } = this.app;
		const center = new Vector3(), half = new Vector3();
		this.disasterColliders=boxes.map(b=>colliders.addBox( this.toWorld( b.center, center ), half.set( ...b.half ), this.yaw, KINDS[ b.kind ] || KINDS.solid ));
		this.boxCount = boxes.length;
		for ( const [ name, p ] of Object.entries( stations ) ) this.stations[ name ] = this.toWorld( p );

	}

	// Behind each counter, facing the shop floor (terminal +x); they turn to a customer who comes up.
	addKeepers() {

		const game = this.app.game;
		if ( ! game ) return;
		const base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';
		for ( const k of KEEPERS ) {

			const at = this.stations[ k.at ];
			if ( ! at ) continue;
			const vendor = new Vendor( {
				name: k.name, kind: k.kind, position: at, yaw: this.yaw + Math.PI / 2, radius: 3.6, greeting: k.greeting, look: k.look,
				character: { url: `${ base }models/characters/crowd/${ k.avatar }.glb`, idle: 'idle_neutral_01', talk: 'gestic_talk_neutral_01', greet: 'wave_01' },
			} );
			this.app.scene.add( vendor.group );
			game.vendors.push( vendor );
			this.vendors.push( vendor );

		}

	}

}
