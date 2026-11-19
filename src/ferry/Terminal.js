import { Vector3, Matrix4, Quaternion, InstancedMesh, Mesh, mergeGeometries } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { terminalPaint } from './TerminalPaint.js';
import { WORLD } from '../world/WorldLayout.js';
import { TERMINAL_SITE } from './terminalSite.js';

// The ferry terminal (tools/ferry/terminal_*.py): a reclaimed flat with the linkspan, the terminal
// building, a covered walkway out along the jetty to the gangway, and a breakwater round the
// harbour basin. Everything it ships is in its own glTF frame (+Z out to sea, the docked ferry's
// bow; +X to the left looking out to sea; +Y up; origin on the docked ferry's stern-ramp hinge
// line at sea level), and WORLD.ferryTerminal places that frame in the world:
//   world = position + rotateY( yaw ) · local, local +Z facing ( sin yaw, 0, cos yaw ).
// The terrain edits and keep-clear zones (terminalSite.js) go in before the world is built
// (applyTerminalSite); the colliders and the model load with the game (Terminal). There are two:
// Tidewater's (WORLD.ferryTerminal) and Joey Island's (WORLD.joeyTerminal), the same site placed twice.
export const PLACES = { tidewater: WORLD.ferryTerminal, joey: WORLD.joeyTerminal };

// Where the docked ferry's model origin sits in the terminal frame (her mooring).
export const BERTH = [ 0, 0, 25.2 ];

// A point [ x, y, z ] in a terminal's frame to the world (Tidewater's unless a placement is given).
export function terminalToWorld( [ x, y, z ], out = new Vector3(), { position: o, yaw } = WORLD.ferryTerminal ) {

	const c = Math.cos( yaw ), s = Math.sin( yaw );
	return out.set( o.x + x * c + z * s, o.y + y, o.z - x * s + z * c );

}

// The site's terrain edits, in the order the site data is written for: fill the flat (raise
// only), cut it level where it runs into a hillside (lower only, with a 1:1 cut face behind it:
// the yard paving is visual and cars drive on the ground, and behind Joey Island's yard the hill
// stood 12 m through the paving), then dredge (lower only: the berth polygon follows the quay
// faces, so it cuts the fill's bank back out in front of the quay walls and keeps the berth deep),
// then raise the breakwater cores; then the keep-clear zones for plants, rocks and debris.
const CUT_BATTER = 1;
export function applyTerminalSite( terrain, site = TERMINAL_SITE, place = WORLD.ferryTerminal ) {

	const { position: o, yaw } = place, c = Math.cos( yaw ), s = Math.sin( yaw ), y = o.y;
	const toWorldXZ = ( [ x, z ] ) => [ o.x + x * c + z * s, o.z - x * s + z * c ];
	for ( const f of site.fill || [] ) terrain.fillPolygon( f.poly.map( toWorldXZ ), y + f.height, f.slope );
	for ( const f of site.fill || [] ) terrain.cutPolygon( f.poly.map( toWorldXZ ), y + f.height, CUT_BATTER );
	for ( const d of site.dredge || [] ) terrain.dredgePolygon( d.poly.map( toWorldXZ ), y + d.depth, d.blend );
	for ( const r of site.ridges || [] ) terrain.ridge( r.line.map( toWorldXZ ), y + r.crest, r.halfWidth, r.slope );
	for ( const c of site.clear || [] ) terrain.addClearZone( c.poly.map( toWorldXZ ) );
	terrain.buildMinMax();

}

// Parked cars (tools/ferry/parked_cars.py: our four car models at about 5k triangles each, wheels 1600 each), one
// instanced mesh per car part across the bays they fill, so the whole car park is a few dozen draws.
// About two bays in three are taken, the mix and the pick fixed by the bay's index.
const PARKED = [ [ 'ParkedWagon', 0.34 ], [ 'ParkedPickup', 0.3 ], [ 'ParkedAster', 0.2 ], [ 'ParkedJeep', 0.16 ] ];
const PARKED_SHARE = 0.66, PAVING = 3.2;
const bayHash = ( i, salt ) => { const x = Math.sin( i * 127.1 + salt * 311.7 ) * 43758.5453; return x - Math.floor( x ); };

// The gangway end section's boxes (terminal frame, x 9.5 .. 11.2 across z 8.9 .. 10.5 at the
// walkway's height), and how far its pivot turns to lie in along the walkway.
const GANGWAY = { x: [ 9.4, 11.2 ], z: [ 8.7, 10.7 ], y: 6 };
const GANGWAY_SWUNG = Math.PI / 2;

// The check-in boom gate (tools/ferry/terminal_build.py, pivot BoomGate, authored down): its arm
// spans the lane on the booth's left, 4.4 m from the hinge to the rest post. It lifts for a car
// rolling up slowly on either side and drops once the lane under it has been clear a moment; down,
// it is solid to cars (its own car-physics platform, a little deeper than the arm so any bonnet
// meets it) and to walkers. Traffic can hold it up with openBoom().
const BOOM = {
	arm: { center: [ - 3.15, 4.25, - 83.675 ], half: [ 2.2, 0.06, 0.08 ] },
	car: { center: [ - 3.15, 3.95, - 83.675 ], half: [ 2.25, 0.35, 0.1 ] },
	lane: { x: [ - 6.5, 0.6 ] },       // the gated lane, booth edge to beyond the post
	call: 14, speed: 20,               // lifts for a car within 14 m of it under 20 km/h
	clear: 6, wait: 2.5,               // drops 2.5 s after the lane within 6 m of it is empty
	lift: 2.4, angle: 85 * Math.PI / 180,
};
const CAR_IDS = { tidewater: [ 11, 13 ], joey: [ 12, 14 ] };   // [ linkspan barrier, check-in boom ]

const KINDS = {
	walk: { walkable: true, solid: true, tag: 'terminal' },     // tops you stand on
	solid: { solid: true, tag: 'terminal' },                    // walls, rails, furniture
	car: { walkable: true, solid: true, tag: 'terminal-car' },  // linkspan, yard, lanes
};

export class Terminal {

	constructor( app, name = 'tidewater' ) {

		this.app = app;
		this.name = name;
		this.placement = PLACES[ name ];
		this.position = this.placement.position.clone();
		this.yaw = this.placement.yaw;
		this.parkedMeshes = [];
		this.boomLift = 0;          // the check-in boom: 0 down .. 1 up
		this.boomUp = false;        // lifting (or up) rather than dropping (or down)
		this.boomHold = 0;          // seconds traffic has asked it to stay up
		this.boomClear = 0;         // seconds the lane under it has been empty
		this.stations = {};         // name -> world Vector3 (TicketCounter, GangwayGate, ...)
		this.pivots = {};           // name -> { hinge: world Vector3, axis: world unit Vector3 }
		this.ready = null;          // resolves once the model is in the scene

	}

	toWorld( local, out ) { return terminalToWorld( local, out, this.placement ); }

	// Where the docked ferry's origin lies at this terminal: { x, z, yaw }.
	berth() { const p = this.toWorld( BERTH ); return { x: p.x, z: p.z, yaw: this.yaw }; }

	// Where a car starts at the terminal: in the marshalling lanes, facing the linkspan and the
	// ferry's stern.
	queueSpot() {

		// a free lane beside the queue (the traffic queues in the lanes at x 0.75 and 4.0)
		const at = this.toWorld( [ - 5.85, 3.2, - 60 ] );
		return { x: at.x, z: at.z, yaw: this.yaw };

	}

	// A terminal-frame axis ('x', 'y' or 'z') as a world direction.
	axis( name, out = new Vector3() ) {

		const c = Math.cos( this.yaw ), s = Math.sin( this.yaw );
		return name === 'y' ? out.set( 0, 1, 0 ) : name === 'x' ? out.set( c, 0, - s ) : out.set( s, 0, c );

	}

	// The colliders now (the car physics reads the static boxes once at its init), the model in
	// the background: await `ready` for it.
	async init() {

		const base = import.meta.env.BASE_URL;
		const t0 = performance.now();
		this.ready = Promise.all( [
			loadModel( `${ base }ferry/terminal.glb`, { customize: terminalPaint } ).then( model => this.place( model, t0 ) ),
			loadModel( `${ base }ferry/parked_cars.glb` ).then( model => this.park( model ) ),
		] );
		const data = await fetch( `${ base }ferry/terminal_colliders.json` ).then( r => r.json() );
		this.addColliders( data );

	}

	place( model, t0 ) {

		this.loadMs = Math.round( performance.now() - t0 );
		console.info( `[terminal] terminal.glb loaded in ${ this.loadMs } ms` );
		this.model = model;
		this.root = model.root;
		this.root.name = this.name === 'tidewater' ? 'FerryTerminal' : 'JoeyTerminal';
		this.root.position.copy( this.position );
		this.root.rotation.y = this.yaw;
		this.app.scene.add( this.root );
		this.root.updateMatrixWorld( true );
		const arm = model.pivots.get( 'LinkspanBarrier' );
		if ( arm ) {

			// rests raised as shipped; closed (down) is the identity rotation
			this.barrierArm = { node: arm, open: arm.quaternion.clone() };
			if ( this.barrierDown !== false ) arm.quaternion.set( 0, 0, 0, 1 );

		}
		const boom = model.pivots.get( 'BoomGate' );
		if ( boom ) {

			// it lifts about the horizontal across its arm: from the hinge toward the arm's middle,
			// turned up toward the node's +Y
			const mid = new Vector3(), box = new Vector3(), n = { count: 0 };
			boom.traverse?.( o => { if ( ! o.isMesh || o === boom ) return; o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter( box ).applyMatrix4( o.matrix ); mid.add( box ); n.count ++; } );
			if ( n.count ) mid.multiplyScalar( 1 / n.count ); else mid.set( - 1, 0, 0 );
			mid.y = 0;
			const axis = new Vector3().crossVectors( mid.normalize(), new Vector3( 0, 1, 0 ) ).normalize();
			this.boomArm = { node: boom, down: boom.quaternion.clone(), axis, turn: new Quaternion() };

		}

	}

	// A parked model's four wheels (its <model>WheelFrontL .. nodes, parked_cars.py) set at their hubs
	// and merged per material: a parked car's wheels never turn, so they add a draw or three a model
	// rather than one per wheel and material (the traffic in Traffic.js rolls and steers its own).
	parkedWheels( node ) {

		const byMaterial = new Map();
		for ( const pivot of node.children ) {

			if ( pivot.isMesh ) continue;
			pivot.updateMatrix();
			for ( const w of pivot.children ) {

				if ( ! w.isMesh ) continue;
				if ( ! byMaterial.has( w.material ) ) byMaterial.set( w.material, [] );
				byMaterial.get( w.material ).push( [ w, w.geometry.clone().applyMatrix4( pivot.matrix ) ] );

			}

		}
		const out = [];
		for ( const [ material, list ] of byMaterial ) {

			const merged = list.length > 1 ? mergeGeometries( list.map( e => e[ 1 ] ), false ) : null;
			// (wheels whose attributes don't match stay one mesh each)
			for ( const [ w, geometry ] of merged ? [ [ list[ 0 ][ 0 ], merged ] ] : list ) {

				const mesh = new Mesh( geometry, material );
				mesh.castShadow = w.castShadow;
				mesh.layers.mask = w.layers.mask;
				out.push( mesh );

			}

		}
		return out;

	}

	// Fill the car park: for each car model, one instanced mesh per part over the bays it takes.
	park( model, bays = TERMINAL_SITE.parking || [] ) {

		const byModel = new Map( PARKED.map( ( [ name ] ) => [ name, [] ] ) );
		bays.forEach( ( [ x, z, yaw ], i ) => {

			if ( bayHash( i, 1 ) > PARKED_SHARE ) return;
			let pick = bayHash( i, 2 ), name = PARKED[ 0 ][ 0 ];
			for ( const [ n, share ] of PARKED ) { if ( pick < share ) { name = n; break; } pick -= share; }
			byModel.get( name ).push( [ x, z, yaw ] );

		} );
		const group = this.parked = model.root;
		group.name = 'TerminalParkedCars';
		const m = new Matrix4(), q = new Quaternion(), up = new Vector3( 0, 1, 0 ), p = new Vector3(), one = new Vector3( 1, 1, 1 );
		let count = 0;
		for ( const [ name, list ] of byModel ) {

			const node = model.pivots.get( name );
			if ( ! node ) continue;
			node.position.set( 0, 0, 0 );
			for ( const part of [ ...node.children.filter( c => c.isMesh ), ...this.parkedWheels( node ) ] ) {

				part.parent?.remove( part );
				if ( ! list.length ) continue;
				const mesh = new InstancedMesh( part.geometry, part.material, list.length );
				list.forEach( ( [ x, z, yaw ], i ) => mesh.setMatrixAt( i, m.compose( this.toWorld( [ x, PAVING, z ], p ), q.setFromAxisAngle( up, yaw + this.yaw ), one ) ) );
				mesh.castShadow = part.castShadow;
				mesh.receiveShadow = true;
				mesh.layers.mask = part.layers.mask;
				mesh.computeBoundingSphere();
				this.app.scene.add( mesh );
				this.parkedMeshes.push( mesh );

			}
			count += list.length;

		}
		this.parkedCount = count;

	}

	// The gangway's end section: out to her port door while she is made fast, swung in along
	// the walkway when she is not. Its deck and rails stand only while it is out; while it is in,
	// a chain closes the walkway's end. `swung` is 0 out (as authored) .. 1 in.
	setGangway( swung ) {

		const out = swung <= 0;
		for ( const { box, walk } of this.gangwayBoxes || [] ) { box.walkable = out && walk; box.solid = out; }
		if ( this.gangwayChain ) this.gangwayChain.solid = ! out;
		const node = this.model?.pivots.get( 'GangwayEnd' );
		if ( node ) node.rotation.y = GANGWAY_SWUNG * swung;

	}

	// The linkspan barrier at the linkspan's land end (terminal_colliders.json `barriers`, arm on
	// the LinkspanBarrier pivot, authored down): down and solid to cars and walkers while the
	// ferry's ramp here is not lowered, raised while it is. In the car physics it is a static
	// platform of its own, added while down.
	setBarrier( down ) {

		const physics = this.app.rally?.physics;
		if ( this.barrierDown === down ) return;
		this.barrierDown = down;
		if ( ! this.barrierBoxes && this.app.rally ) {

			const c = new Vector3(), h = new Vector3();
			this.barrierBoxes = ( this.barriers || [] ).map( b => this.app.colliders.addBox( this.toWorld( b.center, c ), h.set( ...b.half ), this.yaw, { solid: true, tag: 'terminal' } ) );

		}
		for ( const box of this.barrierBoxes || [] ) box.solid = down;
		const arm = this.barrierArm;
		if ( arm ) { if ( down ) arm.node.quaternion.set( 0, 0, 0, 1 ); else arm.node.quaternion.copy( arm.open ); }
		if ( ! physics?.add_platform_pitched ) return;
		const id = CAR_IDS[ this.name ][ 0 ];
		if ( ! down ) { physics.remove_platform( id ); return; }
		const bars = this.barriers?.length ? this.barriers : [ { center: [ 0, 3.8, - 30.6 ], half: [ 4.8, 0.6, 0.15 ] } ];
		physics.add_platform_pitched( id, new Float32Array( bars.flatMap( b => [ ...b.center, ...b.half, 0, 0, 0.9 ] ) ) );
		const h = this.yaw / 2, o = this.position;
		physics.set_platform( id, new Float32Array( [ o.x, o.y, o.z, 0, Math.sin( h ), 0, Math.cos( h ), 0, 0, 0, 0, 0, 0 ] ) );

	}

	// Hold the check-in boom up for `seconds` (a scripted car coming through).
	openBoom( seconds = 6 ) { this.boomHold = Math.max( this.boomHold, seconds ); }

	// Each frame: lift the boom for the player's car rolling up to it slowly, drop it once the lane
	// has been clear a moment, and keep its colliders in step (solid only while it is down).
	updateBoom( dt ) {

		const rally = this.app.rally, s = rally?.state;
		let calling = false, under = false;
		if ( s ) {

			const c = Math.cos( this.yaw ), n = Math.sin( this.yaw ), dx = s[ 0 ] - this.position.x, dz = s[ 2 ] - this.position.z;
			const x = dx * c - dz * n, gap = Math.abs( dx * n + dz * c - BOOM.arm.center[ 2 ] );
			const inLane = x > BOOM.lane.x[ 0 ] && x < BOOM.lane.x[ 1 ] && Math.abs( s[ 1 ] - this.position.y - PAVING ) < 3;
			calling = rally.active && inLane && gap < BOOM.call && Math.abs( s[ 7 ] ) < BOOM.speed;
			under = inLane && gap < BOOM.clear;

		}
		this.boomHold = Math.max( 0, this.boomHold - dt );
		this.boomClear = under || this.boomHold > 0 ? 0 : this.boomClear + dt;
		if ( calling || this.boomHold > 0 ) this.boomUp = true;
		else if ( this.boomClear > BOOM.wait ) this.boomUp = false;
		const was = this.boomLift;
		this.boomLift = Math.min( 1, Math.max( 0, this.boomLift + ( this.boomUp ? dt : - dt ) / BOOM.lift ) );
		const arm = this.boomArm;
		if ( arm && ( this.boomLift !== was || ! arm.posed ) ) {

			const k = this.boomLift, eased = k * k * ( 3 - 2 * k );
			arm.node.quaternion.copy( arm.down ).multiply( arm.turn.setFromAxisAngle( arm.axis, BOOM.angle * eased ) );
			arm.posed = true;

		}
		this.setBoomSolid( this.boomLift < 0.12 );

	}

	// Down: a walker box and a car-physics platform across the lane; up: neither.
	setBoomSolid( solid ) {

		if ( this.boomSolid === solid ) return;
		const physics = this.app.rally?.physics;
		if ( ! physics?.add_platform_pitched ) return;      // not until the car physics has its static boxes
		this.boomSolid = solid;
		if ( ! this.boomBox ) {

			const { center, half } = BOOM.arm;
			this.boomBox = this.app.colliders.addBox( this.toWorld( center ), new Vector3( half[ 0 ], half[ 1 ] + 0.25, half[ 2 ] ), this.yaw, { solid: true, tag: 'terminal' } );

		}
		this.boomBox.solid = solid;
		const id = CAR_IDS[ this.name ][ 1 ];
		if ( ! solid ) { physics.remove_platform( id ); return; }
		const { center, half } = BOOM.car;
		physics.add_platform_pitched( id, new Float32Array( [ ...center, ...half, 0, 0, 0.6 ] ) );
		const h = this.yaw / 2, o = this.position;
		physics.set_platform( id, new Float32Array( [ o.x, o.y, o.z, 0, Math.sin( h ), 0, Math.cos( h ), 0, 0, 0, 0, 0, 0 ] ) );

	}

	// Boxes are axis aligned in the terminal frame, so in the world they turn with its yaw.
	addColliders( { boxes = [], stations = {}, pivots = {}, barriers = [] } ) {

		const { colliders } = this.app;
		const center = new Vector3(), half = new Vector3();
		this.gangwayBoxes = [];
        this.disasterColliders=[];
		for ( const b of boxes ) {

			const box = colliders.addBox( this.toWorld( b.center, center ), half.set( ...b.half ), this.yaw, KINDS[ b.kind ] || KINDS.solid );
			const [ x, y, z ] = b.center;
            if (!(x>GANGWAY.x[0]&&x<GANGWAY.x[1]&&z>GANGWAY.z[0]&&z<GANGWAY.z[1]&&y>GANGWAY.y)) this.disasterColliders.push(box);
			if ( x > GANGWAY.x[ 0 ] && x < GANGWAY.x[ 1 ] && z > GANGWAY.z[ 0 ] && z < GANGWAY.z[ 1 ] && y > GANGWAY.y ) this.gangwayBoxes.push( { box, walk: b.kind === 'walk' } );

		}
		this.boxCount = boxes.length;
		// the barriers' walker boxes go in later (setBarrier), after the car physics has taken the
		// static boxes: it would keep them solid for good
		this.barriers = barriers;
		// A chain across the walkway's end while the gangway is swung in (not solid until then).
		this.gangwayChain = colliders.addBox( this.toWorld( [ 11.22, 7.6, 9.7 ], center ), half.set( 0.05, 0.6, 0.8 ), this.yaw, { solid: false, tag: 'terminal' } );
		for ( const [ name, p ] of Object.entries( stations ) ) this.stations[ name ] = this.toWorld( p );
		for ( const [ name, { hinge, axis } ] of Object.entries( pivots ) ) this.pivots[ name ] = { hinge: this.toWorld( hinge ), axis: this.axis( axis ) };

	}

}
