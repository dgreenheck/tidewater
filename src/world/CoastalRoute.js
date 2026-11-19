import { WORLD } from './WorldLayout.js';
import { TERMINAL_SITE } from '../ferry/terminalSite.js';
import { shapeDistance, CUT_SHOULDER } from './TerrainData.js';

// A graded coastal loop west of the village, and a mountain circuit that forks off
// it behind the town, climbs the hills and dives back into it. All points are metres.
// The same modified heightfield is consumed by rendering and real car physics.
const CONTROL = [ [ - 116, - 93 ], [ - 102, - 83 ], [ - 76, - 82 ], [ - 47, - 86 ], [ - 26, - 97 ],
	[ - 21, - 121 ], [ - 23, - 147 ], [ - 36, - 166 ], [ - 65, - 175 ], [ - 96, - 169 ], [ - 115, - 150 ], [ - 126, - 124 ] ];
// Grade limits: the loop keeps its gentle 10.5 %, the circuit climbs at up to 12 %
// and the hero descent drops at up to 17.5 %.
const LOOP_GRADE = 0.105, CLIMB = 0.12, DESCENT = 0.175;
// Vertical curves on the circuit: grades are averaged over REACH points (about 15 m) either
// side, so the grade changes by well under 1 % per metre and fast crests and sags roll.
const REACH = 18;
// The mountain circuit in driving order (the loop's own direction). It forks off the
// east straight where the loop bears right into its south-east corner, and merges back
// onto the west end of the south straight. A third value sets the grade limit from that point on.
const FORK = [ - 21, - 133 ], MERGE = [ - 97, - 168 ];
const CIRCUIT = [
	// town backroad, behind the back row of houses (>= 12 m from every house centre)
	[ - 15, - 158 ], [ - 4, - 173 ], [ 18, - 178 ], [ 42, - 178 ], [ 66, - 179 ], [ 90, - 178 ], [ 112, - 180 ], [ 134, - 180 ], [ 154, - 184 ],
	// sweeping right-hander into the east valley, then switchbacks up the hill face
	[ 174, - 188 ], [ 191, - 199 ], [ 190, - 216 ], [ 170, - 227 ],
	[ 140, - 226 ], [ 112, - 223 ], [ 84, - 225 ],
	[ 69, - 229 ], [ 64, - 237 ], [ 73, - 243 ],
	[ 98, - 246 ], [ 122, - 249 ], [ 142, - 253 ],
	[ 155, - 259 ], [ 155, - 269 ], [ 141, - 274 ],
	// over the spur and west along the ridge: crests and dips
	[ 115, - 269 ], [ 90, - 266 ], [ 62, - 263 ], [ 35, - 258 ], [ 8, - 258 ],
	[ - 18, - 263 ], [ - 42, - 266 ], [ - 68, - 263 ], [ - 96, - 258 ], [ - 122, - 256 ],
	// summit hairpin, the hero descent across the hill face, a sharp hairpin at the
	// bottom and a run-out back onto the loop's south straight
	[ - 143, - 253, DESCENT ], [ - 151, - 244, DESCENT ], [ - 143, - 235, DESCENT ],
	[ - 116, - 240, DESCENT ], [ - 90, - 241, DESCENT ], [ - 64, - 239, DESCENT ], [ - 40, - 236, DESCENT ], [ - 20, - 232, DESCENT ],
	[ - 4, - 228, DESCENT ], [ 2, - 216, DESCENT ], [ - 8, - 204, DESCENT ],
	[ - 28, - 202, DESCENT ], [ - 52, - 198, DESCENT ], [ - 74, - 189, DESCENT ] ];
// The ferry road in driving order: off the circuit where it runs east behind the town, down
// the bay's east shore at the foot of the headland (landward of the surf), through a cutting
// in the knoll above the beach, over the sand spit on an embankment and straight into the
// ferry terminal's road entry (TERMINAL_SITE.roadEntry placed at WORLD.ferryTerminal),
// heading +Z. Its last 15 m run straight and the last 12 m sit level on the reclaimed
// flat's fill, the ground the car drives on (the terminal's paving is visual only).
// test/ferry-road.mjs pins the entry to the terminal's own site data.
// The circuit climbs east at about 7 % where the ferry road leaves it, so the road's first
// span is held to 2 %: the crest over the junction rolls instead of kinking into the descent.
const FERRY_FORK = [ 161, - 185 ], FERRY_JUNCTION = 0.02, FERRY_ENTRY = [ 205, 183.8 ], FERRY_FLAT = 3.1, FERRY_STRAIGHT = 15, FERRY_LEVEL = 12;
const FERRY = [ [ 176, - 176 ], [ 182, - 155 ], [ 186, - 125 ], [ 189, - 90 ], [ 188, - 60 ], [ 190, - 30 ], [ 195, 0 ], [ 199, 35 ],
	[ 200, 65 ], [ 200, 95 ], [ 201, 122 ], [ 205, 150 ] ];
// Joey Island's ring road in driving order. +Z is south: the loop leaves the terminal junction
// south-west round the island's west end, runs east along the ocean (south) coast on a bench
// above the beaches, north up the east shore, round the bay head and west along the strait
// (north) shore, then back behind the terminal flat to the junction. The junction sits
// JOEY_STUB metres straight out from the terminal's road entry (TERMINAL_SITE.roadEntry placed
// at WORLD.joeyTerminal); a level link runs from it into the yard and the loop crosses it at a
// T, level for JOEY_LEVEL metres either side. Its bell mouth: on each side of the link a
// turning lane of JOEY_MOUTH metres radius, whose outer edge is the kerb line. Bends keep a radius of about 35 m or more, so a
// car takes every one at 40 to 60 km/h. The ring's seam (its first point) sits mid south coast.
const JOEY_LOOP = [ [ - 151, 796.1 ], [ - 154.6, 814.7 ], [ - 149.7, 832.9 ], [ - 137.3, 847.2 ], [ - 117, 862 ], [ - 95, 873 ], [ - 72, 874 ],
	[ - 50, 866 ], [ - 25, 865 ], [ 0, 870 ], [ 25, 874 ], [ 50, 875 ], [ 75, 877 ], [ 100, 876 ], [ 125, 875 ], [ 150, 873 ], [ 175, 875 ], [ 200, 876 ], [ 225, 876 ],
	[ 250, 872 ], [ 272, 864 ], [ 290, 850 ], [ 300, 830 ], [ 304, 808 ], [ 312, 788 ], [ 320, 772 ], [ 322, 750 ], [ 317.3, 732.5 ], [ 304.5, 719.7 ], [ 287, 715 ],
	[ 265, 719 ], [ 240, 721 ], [ 215, 718 ], [ 190, 712 ], [ 165, 709 ], [ 140, 707 ], [ 120, 703 ], [ 100, 703 ], [ 75, 704 ], [ 50, 704 ], [ 25, 704 ], [ 0, 707 ],
	// behind the flat, 12 m back from its edge (grading never touches the flat itself)
	[ - 25, 710 ], [ - 48, 712 ], [ - 63.9, 717.3 ], [ - 81.5, 732 ], [ - 96.8, 744.9 ], [ - 112.1, 757.8 ], [ - 125.2, 768.7 ] ];
const JOEY_GRADE = 0.1, JOEY_STUB = 6, JOEY_LEVEL = 12, JOEY_MOUTH = 9, JOEY_FLAT = 3.1, JOEY_SEAM = [ 150, 873 ], JOEY_START = [ 25, 874 ];
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const smooth = x => { const t = clamp( x, 0, 1 ); return t * t * ( 3 - 2 * t ); };
const distance = ( a, b ) => Math.hypot( a.x - b.x, a.z - b.z );
const CELL = 16;
// Face of the steel barrier, metres from the road centreline: a 1.2 m sealed
// shoulder beyond the 2.7 m lane edge, and clear of the 3.1 m spawn footprint.
export const RAIL_OFFSET = 3.9;

export class CoastalRoute {
	constructor( terrain ) {
		this.terrain = terrain;
		const points = [];
		for ( let i = 0; i < CONTROL.length; i ++ ) {
			const [ a, b, c, d ] = [ - 1, 0, 1, 2 ].map( offset => CONTROL[ ( i + offset + CONTROL.length ) % CONTROL.length ] );
			const steps = Math.ceil( Math.hypot( c[ 0 ] - b[ 0 ], c[ 1 ] - b[ 1 ] ) );
			for ( let j = 0; j < steps; j ++ ) {
				const t = j / steps;
				const at = axis => 0.5 * ( 2 * b[ axis ] + ( - a[ axis ] + c[ axis ] ) * t + ( 2 * a[ axis ] - 5 * b[ axis ] + 4 * c[ axis ] - d[ axis ] ) * t * t + ( - a[ axis ] + 3 * b[ axis ] - 3 * c[ axis ] + d[ axis ] ) * t * t * t );
				const x = at( 0 ), z = at( 1 ); points.push( { x, z, h: terrain.heightAt( x, z ) } );
			}
		}
		for ( let pass = 0; pass < 12; pass ++ ) {
			const heights = points.map( ( p, i ) => ( points[ ( i + points.length - 2 ) % points.length ].h + 2 * points[ ( i + points.length - 1 ) % points.length ].h + 4 * p.h + 2 * points[ ( i + 1 ) % points.length ].h + points[ ( i + 2 ) % points.length ].h ) / 10 );
			points.forEach( ( p, i ) => { p.h = Math.max( 1.6, heights[ i ] ); } );
		}
		// Limit both directions around the closed loop, never introducing a steep
		// height step at the seam. Gentle crown handles crossfall on the road bed.
		for ( let pass = 0; pass < 100; pass ++ ) for ( let i = 0; i < points.length; i ++ ) {
			const a = points[ i ], b = points[ ( i + 1 ) % points.length ], limit = distance( a, b ) * LOOP_GRADE;
			if ( Math.abs( a.h - b.h ) > limit ) { const middle = ( a.h + b.h ) / 2, sign = Math.sign( b.h - a.h ); a.h = middle - sign * limit / 2; b.h = middle + sign * limit / 2; }
		}
		points.push( { ...points[ 0 ] } );
		this.loop = { name: 'coast', kind: 'asphalt', halfWidth: 2.7, points, closed: true };
		this.paths = [ this.loop ]; this.segments = []; this.grid = new Map();
		this.indexPath( this.loop );
		const ramps = [ [ 'west', - 106, - 84, - 97, - 64 ], [ 'east', - 43, - 87, - 30, - 62 ] ];
		for ( const [ name, x, z, endX, endZ ] of ramps ) {
			const join = this.closest( x, z ), start = { x: join.x, z: join.z, h: join.h };
			const end = { x: endX, z: endZ, h: terrain.heightAt( endX, endZ ) };
			const count = Math.ceil( distance( start, end ) ), ramp = [];
			for ( let i = 0; i <= count; i ++ ) {
				const t = i / count;
				ramp.push( { x: start.x + ( end.x - start.x ) * t, z: start.z + ( end.z - start.z ) * t, h: start.h + ( end.h - start.h ) * smooth( t ) } );
			}
			const path = { name, kind: 'gravel', halfWidth: 2.0, points: ramp, closed: false };
			this.paths.push( path ); this.indexPath( path );
		}
		this.circuit = this.buildCircuit();
		this.paths.push( this.circuit ); this.indexPath( this.circuit );
		this.ferryRoad = this.buildFerryRoad();
		this.paths.push( this.ferryRoad ); this.indexPath( this.ferryRoad );
		this.joeyLoop = this.buildJoeyLoop();
		for ( const path of [ this.joeyLoop, this.joeyLink, ...this.joeyMouths ] ) { this.paths.push( path ); this.indexPath( path ); }
		this.joeyLoopLength = this.joeyLoop.points.at( - 1 ).distance;
		this.length = this.loop.points.at( - 1 ).distance;
		this.circuitLength = this.circuit.points.at( - 1 ).distance;
		this.ferryRoadLength = this.ferryRoad.points.at( - 1 ).distance;
		// maxGrade keeps meaning the coastal loop and its beach tracks; the circuit and the
		// ferry road report their own.
		const gradeOf = list => Math.max( ...list.map( segment => Math.abs( segment.b.h - segment.a.h ) / segment.length ) );
		this.maxGrade = gradeOf( this.segments.filter( segment => segment.path === this.loop || segment.path.kind === 'gravel' ) );
		this.circuitMaxGrade = gradeOf( this.segments.filter( segment => segment.path === this.circuit ) );
		this.ferryRoadMaxGrade = gradeOf( this.segments.filter( segment => segment.path === this.ferryRoad ) );
		this.joeyLoopMaxGrade = gradeOf( this.segments.filter( segment => segment.path === this.joeyLoop ) );
		// Earthworks per island, each over its own box of texels; maxEarthwork keeps meaning Tidewater's.
		const joey = segment => segment.path.island === 'joey';
		this.maxEarthwork = this.grade( this.segments.filter( segment => ! joey( segment ) ) );
		// Joey's grading leaves the terminal site alone: the flat carries the yard and the village
		// (the game applies the site before the roads). A shoulder round it is kept too (the
		// width of TerrainData.cutPolygon's level shoulder: a ground read blends texels up to a
		// diagonal away), so the ring's banks behind the yard run out from beyond it and their toe
		// never stands on the paving. Only the link and its bell mouths cross the shoulder, graded
		// as road at the flat's own height.
		const { position: o, yaw } = WORLD.joeyTerminal, c = Math.cos( yaw ), s = Math.sin( yaw );
		const flats = TERMINAL_SITE.fill.map( f => f.poly.map( ( [ x, z ] ) => [ o.x + x * c + z * s, o.z - x * s + z * c ] ) );
		const shoulder = CUT_SHOULDER * terrain.texel;
		this.joeyEarthwork = this.grade( this.segments.filter( joey ), ( x, z ) => flats.some( poly => {
			const d = shapeDistance( poly, true, x, z );
			return d <= 0 || ( d <= shoulder && ! this.gradeAt( x, z )?.road );
		} ) );
		this.guardrails = this.planGuardrails();
		const originalPathDistance = terrain.pathDistance.bind( terrain );
		terrain.pathDistance = ( x, z ) => Math.min( originalPathDistance( x, z ), this.clearance( x, z ) );
		terrain.roadSurfaceAt = ( x, z ) => this.surfaceAt( x, z );
		terrain.roads = this;
	}
	// Hermite spline through the circuit's control points, leaving and rejoining the
	// loop on the loop's own tangent so both junctions are seamless in plan and height.
	buildCircuit() {
		const loop = this.loop.points, n = loop.length - 1;
		const nearest = ( [ x, z ] ) => loop.slice( 0, n ).reduce( ( best, p, i ) => Math.hypot( p.x - x, p.z - z ) < Math.hypot( loop[ best ].x - x, loop[ best ].z - z ) ? i : best, 0 );
		const tangent = i => { const a = loop[ ( i + n - 1 ) % n ], b = loop[ ( i + 1 ) % n ], l = distance( a, b ); return [ ( b.x - a.x ) / l, ( b.z - a.z ) / l ]; };
		const fork = nearest( FORK ), merge = nearest( MERGE );
		const control = [ [ loop[ fork ].x, loop[ fork ].z, CLIMB ], ...CIRCUIT.map( ( [ x, z, limit ] ) => [ x, z, limit || CLIMB ] ), [ loop[ merge ].x, loop[ merge ].z, DESCENT ] ];
		const points = this.spline( control, tangent( fork ), tangent( merge ) );
		this.profile( points, this.loop );
		return { name: 'circuit', kind: 'asphalt', halfWidth: 2.7, points, closed: false, pad: 26 };
	}
	// The ferry road: a spur off the circuit built the same way, leaving on the circuit's own
	// tangent and height, never below 1.6 m (embankments over the shore's low spots), and
	// arriving straight and level at the terminal's road entry.
	buildFerryRoad() {
		const pts = this.circuit.points, [ fx, fz ] = FERRY_FORK, [ ex, ez ] = FERRY_ENTRY;
		const fork = pts.reduce( ( best, p, i ) => Math.hypot( p.x - fx, p.z - fz ) < Math.hypot( pts[ best ].x - fx, pts[ best ].z - fz ) ? i : best, 1 );
		const a = pts[ fork - 1 ], b = pts[ fork + 1 ], l = distance( a, b );
		const control = [ [ pts[ fork ].x, pts[ fork ].z, FERRY_JUNCTION ], ...FERRY, [ ex, ez - FERRY_STRAIGHT ], [ ex, ez ] ].map( ( [ x, z, limit ] ) => [ x, z, limit || CLIMB ] );
		const points = this.spline( control, [ ( b.x - a.x ) / l, ( b.z - a.z ) / l ], [ 0, 1 ] );
		for ( let i = points.length - 1, run = 0; i > 0 && run <= FERRY_LEVEL; run += distance( points[ i ], points[ i - 1 ] ), i -- ) points[ i ].hold = FERRY_FLAT;
		this.profile( points, this.circuit, 1.6 );
		return { name: 'ferryRoad', kind: 'asphalt', halfWidth: 2.7, points, closed: false, pad: 26 };
	}
	// Joey Island's ring (see JOEY_LOOP): a spline from the junction round the island and back,
	// leaving and returning along the same tangent, profiled like the other roads with the
	// junction held level at the flat's height, then turned so its seam sits mid south coast.
	// Also builds the level link from the junction straight into the terminal yard (this.joeyLink).
	buildJoeyLoop() {
		const { position: o, yaw } = WORLD.joeyTerminal, { point: [ tx, tz ], yaw: entryYaw } = TERMINAL_SITE.roadEntry;
		const c = Math.cos( yaw ), s = Math.sin( yaw ), entry = { x: o.x + tx * c + tz * s, z: o.z - tx * s + tz * c };
		// out of the yard is the entry heading reversed; the loop runs across it, to the left
		const heading = entryYaw + yaw, dx = - Math.sin( heading ), dz = - Math.cos( heading );
		const junction = [ entry.x + dx * JOEY_STUB, entry.z + dz * JOEY_STUB ];
		const control = [ junction, ...JOEY_LOOP, junction ].map( ( [ x, z ] ) => [ x, z, JOEY_GRADE ] );
		const points = this.spline( control, [ - dz, dx ], [ - dz, dx ] );
		points.pop();
		const n = points.length;
		for ( let i = 0, run = 0; run <= JOEY_LEVEL; run += distance( points[ i ], points[ i + 1 ] ), i ++ ) points[ i ].hold = JOEY_FLAT;
		for ( let i = n - 1, run = 0; run <= JOEY_LEVEL; run += distance( points[ i ], points[ i - 1 ] ), i -- ) points[ i ].hold = JOEY_FLAT;
		this.profile( points, null, 1.6 );
		const seam = points.reduce( ( best, p, i ) => Math.hypot( p.x - JOEY_SEAM[ 0 ], p.z - JOEY_SEAM[ 1 ] ) < Math.hypot( points[ best ].x - JOEY_SEAM[ 0 ], points[ best ].z - JOEY_SEAM[ 1 ] ) ? i : best, 0 );
		const ring = [ ...points.slice( seam ), ...points.slice( 0, seam ) ];
		ring.push( { ...ring[ 0 ] } );
		// The link, junction to entry like the ferry road (off its parent, into the yard), level throughout.
		const steps = Math.ceil( JOEY_STUB * 1.2 ), link = [];
		for ( let i = 0; i <= steps; i ++ ) {
			const x = junction[ 0 ] - dx * JOEY_STUB * i / steps, z = junction[ 1 ] - dz * JOEY_STUB * i / steps;
			link.push( { x, z, h: JOEY_FLAT, ground: this.terrain.heightAt( x, z ), limit: JOEY_GRADE, pin: 1, hold: JOEY_FLAT, bank: 6 } );
		}
		this.joeyLink = { name: 'joeyLink', island: 'joey', kind: 'asphalt', halfWidth: 2.7, points: link, closed: false, pad: 26 };
		// The bell mouth: a quarter turn each side, from the ring JOEY_MOUTH metres along into the
		// link JOEY_MOUTH metres out (under the yard's paving), so turning cars stay on the seal.
		this.joeyMouths = [ - 1, 1 ].map( side => {
			const [ tx, tz ] = [ - dz * side, dx * side ];
			const start = [ junction[ 0 ] + tx * JOEY_MOUTH, junction[ 1 ] + tz * JOEY_MOUTH, JOEY_GRADE ], end = [ junction[ 0 ] - dx * JOEY_MOUTH, junction[ 1 ] - dz * JOEY_MOUTH, JOEY_GRADE ];
			const arc = this.spline( [ start, end ], [ - tx, - tz ], [ - dx, - dz ] );
			for ( const p of arc ) Object.assign( p, { h: JOEY_FLAT, hold: JOEY_FLAT, pin: 1, bank: 6 } );
			return { name: 'joeyMouth', island: 'joey', side, kind: 'asphalt', halfWidth: 2.7, points: arc, closed: false, pad: 26 };
		} );
		return { name: 'joeyLoop', island: 'joey', kind: 'asphalt', halfWidth: 2.7, points: ring, closed: true, pad: 26 };
	}
	// Hermite spline through control points [ x, z, grade limit ], leaving along the unit
	// tangent start and arriving along end, a point about every 0.83 m on the natural ground.
	spline( control, start, end ) {
		const terrain = this.terrain, last = control.length - 1;
		const slope = control.map( ( c, k ) => {
			if ( k > 0 && k < last ) return [ ( control[ k + 1 ][ 0 ] - control[ k - 1 ][ 0 ] ) / 2, ( control[ k + 1 ][ 1 ] - control[ k - 1 ][ 1 ] ) / 2 ];
			const [ tx, tz ] = k ? end : start, o = control[ k ? k - 1 : 1 ], l = Math.hypot( o[ 0 ] - c[ 0 ], o[ 1 ] - c[ 1 ] );
			return [ tx * l, tz * l ];
		} );
		const points = [];
		for ( let k = 0; k < last; k ++ ) {
			const b = control[ k ], c = control[ k + 1 ], steps = Math.ceil( Math.hypot( c[ 0 ] - b[ 0 ], c[ 1 ] - b[ 1 ] ) * 1.2 );
			for ( let j = 0; j < steps + ( k === last - 1 ? 1 : 0 ); j ++ ) {
				const t = j / steps, t2 = t * t, t3 = t2 * t;
				const w = [ 2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, - 2 * t3 + 3 * t2, t3 - t2 ];
				const at = axis => w[ 0 ] * b[ axis ] + w[ 1 ] * slope[ k ][ axis ] + w[ 2 ] * c[ axis ] + w[ 3 ] * slope[ k + 1 ][ axis ];
				const x = at( 0 ), z = at( 1 ), ground = terrain.heightAt( x, z );
				points.push( { x, z, h: ground, ground, limit: b[ 2 ] } );
			}
		}
		return points;
	}
	// The vertical profile of a road that leaves (and may rejoin) a parent road. Follow the
	// smoothed ground, then take the parent's own height wherever the two roads share asphalt,
	// so no junction has a step; points carrying a hold height are fixed at it.
	profile( points, parent, floor = - Infinity ) {
		for ( let pass = 0; pass < 30; pass ++ ) {
			const heights = points.map( ( p, i ) => { const at = o => points[ clamp( i + o, 0, points.length - 1 ) ].h; return ( at( - 2 ) + 2 * at( - 1 ) + 4 * p.h + 2 * at( 1 ) + at( 2 ) ) / 10; } );
			points.forEach( ( p, i ) => { p.h = Math.max( floor, heights[ i ] ); } );
		}
		for ( const p of points ) {
			const q = this.closest( p.x, p.z );
			p.pin = q && q.path === parent ? 1 - smooth( ( q.distance - 2 ) / 10 ) : 0;
			if ( p.pin > 0 ) p.h += ( q.h - p.h ) * p.pin;
			if ( p.hold !== undefined ) { p.pin = 1; p.h = p.hold; }
		}
		// Per-span grade limit, symmetric like the loop's, then a few vertical-curve
		// smoothing passes and an exact sweep each way; pinned junction points never move.
		const fixed = p => p.pin > 0.999;
		const limitPass = () => {
			for ( let i = 0; i < points.length - 1; i ++ ) {
				const a = points[ i ], b = points[ i + 1 ], limit = distance( a, b ) * a.limit;
				if ( Math.abs( a.h - b.h ) <= limit || ( fixed( a ) && fixed( b ) ) ) continue;
				const sign = Math.sign( b.h - a.h );
				if ( fixed( a ) ) b.h = a.h + sign * limit; else if ( fixed( b ) ) a.h = b.h - sign * limit;
				else { const middle = ( a.h + b.h ) / 2; a.h = middle - sign * limit / 2; b.h = middle + sign * limit / 2; }
			}
		};
		for ( let pass = 0; pass < 400; pass ++ ) limitPass();
		for ( let pass = 0; pass < 8; pass ++ ) {
			const heights = points.map( ( p, i ) => { const at = o => points[ clamp( i + o, 0, points.length - 1 ) ].h; return fixed( p ) ? p.h : ( at( - 2 ) + 2 * at( - 1 ) + 4 * p.h + 2 * at( 1 ) + at( 2 ) ) / 10; } );
			points.forEach( ( p, i ) => { p.h = heights[ i ]; } );
			limitPass();
		}
		// Vertical curves: smooth the grade itself with a distance-weighted running mean (three
		// passes, about 15 m either side), so crests and sags roll instead of kinking; a capped
		// descent meeting flatter ground left a sag that stopped a fast car dead. A mean of capped
		// grades stays capped (each clamped to its own section's limit), and each run between
		// fixed junction points keeps its end heights.
		const smoothGrades = ( s, e ) => {
			const n = e - s;
			if ( n < 3 ) return;
			const length = [], grade = [];
			for ( let i = s; i < e; i ++ ) { length.push( distance( points[ i ], points[ i + 1 ] ) ); grade.push( ( points[ i + 1 ].h - points[ i ].h ) / length.at( - 1 ) ); }
			for ( let pass = 0; pass < 3; pass ++ ) {
				const mean = grade.map( ( g, i ) => {
					let sum = 0, weight = 0;
					for ( let k = Math.max( 0, i - REACH ); k <= Math.min( n - 1, i + REACH ); k ++ ) { sum += grade[ k ] * length[ k ]; weight += length[ k ]; }
					return sum / weight;
				} );
				grade.splice( 0, n, ...mean.map( ( g, i ) => { const cap = points[ s + i ].limit * 0.995; return clamp( g, - cap, cap ); } ) );
			}
			let rise = 0, total = 0;
			for ( let i = 0; i < n; i ++ ) { rise += grade[ i ] * length[ i ]; total += length[ i ]; }
			const fix = ( points[ e ].h - points[ s ].h - rise ) / total;
			for ( let i = 0; i < n; i ++ ) points[ s + i + 1 ].h = points[ s + i ].h + ( grade[ i ] + fix ) * length[ i ];
		};
		for ( let i = 1; i < points.length; i ++ ) { const a = points[ i - 1 ], b = points[ i ], l = distance( a, b ) * a.limit * 0.995; if ( ! fixed( b ) ) b.h = clamp( b.h, a.h - l, a.h + l ); }
		for ( let i = points.length - 2; i >= 0; i -- ) { const a = points[ i ], b = points[ i + 1 ], l = distance( a, b ) * a.limit * 0.995; if ( ! fixed( a ) ) a.h = clamp( a.h, b.h - l, b.h + l ); }
		// The sweeps above cap every grade; round the corners they leave (see smoothGrades).
		for ( let s = 0, e = 1; e < points.length; e ++ ) if ( fixed( points[ e ] ) || e === points.length - 1 ) { smoothGrades( s, e ); s = e; }
		// Cut and fill batter: about 6 to 8 m in the hills, wider where the road sits deep
		// in a cutting or high on an embankment, so the banks keep a natural slope.
		const banks = points.map( p => clamp( 2.5 + 1.7 * Math.abs( p.h - p.ground ), 6, 20 ) );
		points.forEach( ( p, i ) => { p.bank = Math.max( ...banks.slice( Math.max( 0, i - 12 ), i + 13 ) ); } );
	}
	indexPath( path ) {
		let accumulated = 0; path.points[ 0 ].distance = 0;
		const pad = path.pad || 8;
		for ( let i = 0; i < path.points.length - 1; i ++ ) {
			const a = path.points[ i ], b = path.points[ i + 1 ], length = distance( a, b );
			const segment = { a, b, length, path, first: i === 0, last: i === path.points.length - 2 };
			accumulated += length; b.distance = accumulated; this.segments.push( segment );
			for ( let x = Math.floor( ( Math.min( a.x, b.x ) - pad ) / CELL ); x <= Math.floor( ( Math.max( a.x, b.x ) + pad ) / CELL ); x ++ ) {
				for ( let z = Math.floor( ( Math.min( a.z, b.z ) - pad ) / CELL ); z <= Math.floor( ( Math.max( a.z, b.z ) + pad ) / CELL ); z ++ ) {
					const key = `${ x },${ z }`; if ( ! this.grid.has( key ) ) this.grid.set( key, [] ); this.grid.get( key ).push( segment );
				}
			}
		}
	}
	near( x, z ) { return this.grid.get( `${ Math.floor( x / CELL ) },${ Math.floor( z / CELL ) }` ) || []; }
	project( segment, x, z ) {
		const { a, b, length } = segment, dx = b.x - a.x, dz = b.z - a.z;
		const raw = ( ( x - a.x ) * dx + ( z - a.z ) * dz ) / ( length * length );
		const t = clamp( raw, 0, 1 ), px = a.x + dx * t, pz = a.z + dz * t;
		return { x: px, z: pz, h: a.h + ( b.h - a.h ) * t, distance: Math.hypot( x - px, z - pz ),
			path: segment.path, nx: dz / length, nz: - dx / length, raw, segment };
	}
	closest( x, z, filter = null ) {
		let best = null;
		for ( const segment of this.near( x, z ) ) {
			if ( filter && ! filter( segment ) ) continue;
			const p = this.project( segment, x, z ); if ( ! best || p.distance < best.distance ) best = p;
		}
		return best;
	}
	// Plants, rocks and logs keep clear of the sealed shoulder, barrier and its flared ends.
	clearance( x, z ) { const p = this.closest( x, z ); return p ? p.distance - p.path.halfWidth - ( p.path.kind === 'asphalt' ? 3.4 : 1.6 ) : Infinity; }
	surfaceAt( x, z ) {
		let gravel = null;
		for ( const segment of this.near( x, z ) ) {
			const p = this.project( segment, x, z );
			if ( p.distance > p.path.halfWidth ) continue;
			if ( ! p.path.closed && ( ( segment.first && p.raw < 0 ) || ( segment.last && p.raw > 1 ) ) ) continue;
			if ( p.path.kind === 'asphalt' ) return { kind: 'asphalt', grip: 0.95 };
			gravel = { kind: 'gravel', grip: 0.76 };
		}
		return gravel;
	}
	// The graded ground at a texel: every stretch of road within reach pulls the ground
	// toward its own height, weighted by its batter blend, so where two legs of the circuit
	// pass close by at different heights the ground between them blends instead of
	// jumping at the midline. Returns the nearest projection (for the road surface and
	// paint) and the blended target height and strength, or null out of reach.
	gradeAt( wx, wz ) {
		const legs = [];
		for ( const segment of this.near( wx, wz ) ) {
			const p = this.project( segment, wx, wz ), { a, b } = segment;
			const bank = a.bank ? a.bank + ( b.bank - a.bank ) * clamp( p.raw, 0, 1 ) : 3.5;
			const width = p.path.halfWidth, blend = 1 - smooth( ( p.distance - width - 0.5 ) / bank );
			if ( blend <= 0 ) continue;
			p.blend = blend; p.along = a.distance + clamp( p.raw, 0, 1 ) * segment.length;
			p.target = p.h + 0.035 * ( 1 - clamp( p.distance / width, 0, 1 ) );
			legs.push( p );
		}
		if ( ! legs.length ) return null;
		legs.sort( ( l, m ) => l.distance - m.distance );
		// One projection per stretch of road: the same path more than 25 m further along is
		// another leg (a switchback), not the same bend.
		const picked = [];
		for ( const p of legs ) {
			const same = picked.some( q => {
				if ( q.path !== p.path ) return false;
				const d = Math.abs( q.along - p.along ), length = p.path.points.at( - 1 ).distance;
				return ( p.path.closed ? Math.min( d, length - d ) : d ) < 25;
			} );
			if ( ! same ) picked.push( p );
		}
		const nearest = picked[ 0 ];
		// On the seal and its shoulder the nearest road rules, so every road keeps its profile.
		if ( nearest.distance < nearest.path.halfWidth + 0.5 ) return { nearest, target: nearest.target, blend: nearest.blend, road: true };
		let sum = 0, weighted = 0, strongest = 0;
		for ( const p of picked ) { sum += p.blend; weighted += p.blend * p.target; strongest = Math.max( strongest, p.blend ); }
		return { nearest, target: weighted / sum, blend: strongest, road: false };
	}
	// Carve the roads in `segments` into the heightfield over their own box; returns the deepest cut
	// or fill. Texels where keep( x, z ) is true are never graded or relaxed.
	grade( segments = this.segments, keep = null ) {
		const terrain = this.terrain, bounds = { x0: Infinity, z0: Infinity, x1: - Infinity, z1: - Infinity };
		for ( const segment of segments ) for ( const point of [ segment.a, segment.b ] ) {
			const margin = point.bank ? point.bank + 4 : 8;
			bounds.x0 = Math.min( bounds.x0, point.x - margin ); bounds.x1 = Math.max( bounds.x1, point.x + margin );
			bounds.z0 = Math.min( bounds.z0, point.z - margin ); bounds.z1 = Math.max( bounds.z1, point.z + margin );
		}
		let earthwork = 0;
		// (plus room for cut slopes to run out beyond the batters)
		const texel = v => Math.floor( ( v - terrain.origin ) / terrain.texel ), room = 24;
		const x0 = Math.max( 1, texel( bounds.x0 ) - room ), x1 = Math.min( terrain.res - 2, texel( bounds.x1 ) + 1 + room );
		const z0 = Math.max( 1, texel( bounds.z0 ) - room ), z1 = Math.min( terrain.res - 2, texel( bounds.z1 ) + 1 + room );
		const w = x1 - x0 + 1, graded = new Uint8Array( w * ( z1 - z0 + 1 ) ); // 1 graded ground, 2 road surface
		const original = Float32Array.from( terrain.heights );
		for ( let z = z0; z <= z1; z ++ ) {
			for ( let x = x0; x <= x1; x ++ ) {
				const wx = terrain.origin + ( x + 0.5 ) * terrain.texel, wz = terrain.origin + ( z + 0.5 ) * terrain.texel;
				if ( keep && keep( wx, wz ) ) { graded[ ( z - z0 ) * w + x - x0 ] = 3; continue; }
				const g = this.gradeAt( wx, wz ); if ( ! g ) continue;
				const p = g.nearest, { a } = p.segment, asphalt = p.path.kind === 'asphalt', width = p.path.halfWidth;
				const index = z * terrain.res + x;
				terrain.heights[ index ] = original[ index ] + ( g.target - original[ index ] ) * g.blend;
				graded[ ( z - z0 ) * w + x - x0 ] = g.road ? 2 : 1;
				// Paint the terrain's brown worn-path layer only under opaque road, so the
				// see-through verges and track edges show the island's own ground, and let
				// it die away with the beach tracks instead of ending in a painted cap.
				const along = a.distance + clamp( p.raw, 0, 1 ) * p.segment.length;
				const tail = asphalt ? 1 : 1 - smooth( ( along - p.path.points.at( - 1 ).distance + 10 ) / 10 );
				const paint = Math.min( p.blend, 1 - smooth( ( p.distance - width + ( asphalt ? - 0.1 : 0.5 ) ) / 0.5 ) ) * tail;
				terrain.path[ index ] = Math.max( terrain.path[ index ], 255 * paint );
				terrain.rock[ index ] *= 1 - g.blend;
			}
		}
		// Cut faces and embankments no steeper than 1:1: relax graded ground (never the road
		// surface) until no neighbour pair steps more than a metre per texel. Ground that
		// moves hands the constraint on to its neighbours, so a deep cutting's slope runs out
		// into the hillside as far as it needs; untouched natural ground stays as it was.
		const limit = terrain.texel, h = terrain.heights, res = terrain.res, zn = z1 - z0 + 1;
		for ( let pass = 0; pass < 300; pass ++ ) {
			let moved = 0;
			for ( let z = z0; z <= z1; z ++ ) for ( let x = x0; x <= x1; x ++ ) {
				const k = ( z - z0 ) * w + x - x0;
				if ( graded[ k ] !== 1 ) continue;
				const i = z * res + x;
				// Each pair may be as steep as 1:1 or as steep as nature made it, never steeper.
				let lo = - Infinity, hi = Infinity;
				for ( const j of [ i - 1, i + 1, i - res, i + res ] ) {
					const allowed = Math.max( limit, Math.abs( original[ i ] - original[ j ] ) );
					lo = Math.max( lo, h[ j ] - allowed ); hi = Math.min( hi, h[ j ] + allowed );
				}
				const next = lo > hi ? ( lo + hi ) * 0.5 : Math.min( hi, Math.max( lo, h[ i ] ) );
				if ( Math.abs( next - h[ i ] ) <= 1e-3 ) continue;
				h[ i ] = next; moved ++;
				if ( x > x0 && ! graded[ k - 1 ] ) graded[ k - 1 ] = 1;
				if ( x < x1 && ! graded[ k + 1 ] ) graded[ k + 1 ] = 1;
				if ( z > z0 && ! graded[ k - w ] ) graded[ k - w ] = 1;
				if ( z < z1 && z - z0 + 1 < zn && ! graded[ k + w ] ) graded[ k + w ] = 1;
			}
			if ( ! moved ) break;
		}
		// The relaxation holds each texel to its four neighbours only, so a cut face or batter comes
		// out as a staircase of texels along any diagonal, and its crease with the natural slope reads
		// as a row of dark steps (the steep-slope scree). Round it off with a few 3x3 passes over the
		// moved ground and the natural texels touching it, never within a texel of the road surface or
		// of kept ground (the road mesh sits on those heights).
		const mv = new Uint8Array( graded.length );
		for ( let z = z0; z <= z1; z ++ ) for ( let x = x0; x <= x1; x ++ ) {
			const k = ( z - z0 ) * w + x - x0, i = z * res + x;
			mv[ k ] = graded[ k ] === 1 && Math.abs( h[ i ] - original[ i ] ) > 0.02 ? 1 : 0;
		}
		const soft = [];
		for ( let z = z0 + 1; z < z1; z ++ ) for ( let x = x0 + 1; x < x1; x ++ ) {
			const k = ( z - z0 ) * w + x - x0;
			let near = 0, blocked = false;
			for ( let dz = - 1; dz <= 1; dz ++ ) for ( let dx = - 1; dx <= 1; dx ++ ) {
				const n = k + dz * w + dx;
				if ( graded[ n ] >= 2 ) blocked = true;
				near |= mv[ n ];
			}
			if ( near && ! blocked ) soft.push( z * res + x );
		}
		const next = new Float32Array( soft.length );
		for ( let pass = 0; pass < 3; pass ++ ) {
			for ( let s = 0; s < soft.length; s ++ ) {
				const i = soft[ s ];
				next[ s ] = ( 4 * h[ i ] + 2 * ( h[ i - 1 ] + h[ i + 1 ] + h[ i - res ] + h[ i + res ] ) + h[ i - res - 1 ] + h[ i - res + 1 ] + h[ i + res - 1 ] + h[ i + res + 1 ] ) / 16;
			}
			// written in turn and held to the same 1:1 (or natural) limit against the neighbours as
			// they stand, so the rounding never opens a step the relaxation had closed
			for ( let s = 0; s < soft.length; s ++ ) {
				const i = soft[ s ];
				let lo = - Infinity, hi = Infinity;
				for ( const j of [ i - 1, i + 1, i - res, i + res ] ) {
					const allowed = Math.max( limit, Math.abs( original[ i ] - original[ j ] ) );
					lo = Math.max( lo, h[ j ] - allowed ); hi = Math.min( hi, h[ j ] + allowed );
				}
				if ( lo <= hi ) h[ i ] = Math.min( hi, Math.max( lo, next[ s ] ) );
			}
		}
		for ( let z = z0; z <= z1; z ++ ) for ( let x = x0; x <= x1; x ++ ) {
			const i = z * res + x;
			earthwork = Math.max( earthwork, Math.abs( h[ i ] - original[ i ] ) );
		}
		terrain.buildMinMax();
		return earthwork;
	}
	// Steel W-beam where the verge falls away: embankments, the seaward drop to the
	// beach, the outside of bends, and on the circuit the outside of every tight corner
	// and hairpin. Returns runs of rail-face points per side of each asphalt road; the
	// beach entrances and the circuit's junctions stay open and stubs too short for two
	// terminals are dropped. Open roads do not wrap.
	planGuardrails() {
		const terrain = this.terrain, runs = [];
		const ramps = this.segments.filter( segment => segment.path.kind === 'gravel' );
		for ( const path of this.paths.filter( p => p.kind === 'asphalt' ) ) {
			// The coast loop's gentle-island rule is its own; every other road (Joey's ring too) uses the hill rule.
			const pts = path.points, closed = path.closed, coastal = path === this.loop, n = closed ? pts.length - 1 : pts.length;
			const at = i => closed ? pts[ ( ( i % n ) + n ) % n ] : pts[ clamp( i, 0, n - 1 ) ];
			const tangent = i => { const a = at( i - 1 ), b = at( i + 1 ), l = distance( a, b ); return [ ( b.x - a.x ) / l, ( b.z - a.z ) / l ]; };
			const runsOf = ( flags, value ) => {
				const out = [];
				if ( ! closed ) {
					for ( let i = 0; i < n; i ++ ) {
						if ( flags[ i ] !== value || ( i > 0 && flags[ i - 1 ] === value ) ) continue;
						let length = 0; while ( i + length < n && flags[ i + length ] === value ) length ++; out.push( [ i, length ] );
					}
					return out;
				}
				const start = flags.findIndex( ( f, i ) => f === value && flags[ ( i + n - 1 ) % n ] !== value );
				if ( start < 0 ) return flags[ 0 ] === value ? [ [ 0, n ] ] : [];
				for ( let k = 0; k < n; k ++ ) {
					const i = ( start + k ) % n; if ( flags[ i ] !== value || flags[ ( i + n - 1 ) % n ] === value ) continue;
					let length = 0; while ( length < n && flags[ ( i + length ) % n ] === value ) length ++; out.push( [ i, length ] );
				}
				return out;
			};
			for ( const side of [ - 1, 1 ] ) {
				const want = [], blocked = [], frame = [];
				for ( let i = 0; i < n; i ++ ) {
					const p = pts[ i ], [ tx, tz ] = tangent( i ), nx = tz * side, nz = - tx * side;
					const x = p.x + nx * RAIL_OFFSET, z = p.z + nz * RAIL_OFFSET;
					// The island is gentle, so judge the fall of the verge well beyond the
					// graded embankment: the beach frontage drops about a metre by 16 m.
					const [ d10, d16 ] = [ 10, 16 ].map( o => p.h - terrain.heightAt( p.x + nx * o, p.z + nz * o ) ), drop = Math.max( d10, d16 );
					const [ ax, az ] = tangent( i - 8 ), [ bx, bz ] = tangent( i + 8 ), turn = ( bx - ax ) * nx + ( bz - az ) * nz;
					const outer = turn < - 0.3, tight = ! coastal && turn < - 0.6, inside = ! coastal && turn > 0.6;
					const rampBlocked = path === this.loop && ramps.some( segment => { const q = this.project( segment, x, z ); return ! ( segment.first && q.raw < 0 ) && q.distance < segment.path.halfWidth + 5; } );
					// Another road on this side (junction gores, or a far leg of the same road): keep the barrier off it.
					const roadBlocked = this.near( x, z ).some( segment => {
						if ( segment.path.kind !== 'asphalt' || ( segment.path === path && Math.abs( segment.a.distance - p.distance ) < 60 ) ) return false;
						const q = this.project( segment, x, z ), own = this.project( segment, p.x, p.z );
						if ( ( segment.first && q.raw < 0 ) || ( segment.last && q.raw > 1 ) ) return false;
						return q.distance < segment.path.halfWidth + 5 && q.distance < own.distance;
					} );
					blocked[ i ] = rampBlocked || roadBlocked;
					want[ i ] = ! blocked[ i ] && ( coastal ? d10 > 0.62 || d16 > 0.95 || ( outer && d10 > 0.35 ) : ( d10 > 1.4 || d16 > 2.2 || tight ) && ! inside );
					frame[ i ] = { x, z, nx, nz, road: p.h, ground: terrain.heightAt( x, z ), index: i, drop, path: path.name };
				}
				for ( const [ i, length ] of runsOf( want, false ) ) {
					if ( length >= 14 || ( ! closed && ( i === 0 || i + length === n ) ) ) continue;
					if ( Array.from( { length }, ( _, k ) => blocked[ ( i + k ) % n ] ).some( Boolean ) ) continue;
					for ( let k = 0; k < length; k ++ ) want[ ( i + k ) % n ] = true;
				}
				for ( const [ i, length ] of runsOf( want, true ) ) if ( length >= 30 ) runs.push( { side, path: path.name, points: Array.from( { length }, ( _, k ) => frame[ ( i + k ) % n ] ) } );
			}
		}
		return runs;
	}
	// Named starts. The circuit offers the town backroad and the mountain summit, facing
	// down the hero descent; everything else starts on the loop or a beach track.
	spawn( name ) {
		const facing = ( path, index ) => {
			const i = Math.max( 0, Math.min( path.points.length - 2, index ) ), point = path.points[ i ], next = path.points[ i + 1 ];
			return { x: point.x, z: point.z, yaw: Math.atan2( next.x - point.x, next.z - point.z ) };
		};
		if ( name === 'town' || name === 'mountain' ) {
			const pts = this.circuit.points;
			if ( name === 'town' ) return facing( this.circuit, pts.findIndex( p => p.x > 28 ) );
			// The flattest car footprint around the summit hairpin (the start search rejects
			// more than 0.7 m of fall across a 5.4 x 2.6 m box along the car's heading), facing the descent.
			// Scored like clearSpawn: the footprint along the car's heading at each point.
			const top = Math.max( 30, pts.findIndex( p => p.limit === DESCENT ) ), level = ( p, k ) => {
				const next = pts[ Math.min( pts.length - 1, k + 1 ) ], yaw = Math.atan2( next.x - p.x, next.z - p.z ), fx = Math.sin( yaw ), fz = Math.cos( yaw );
				const h = [ [ - 2.7, - 1.3 ], [ - 2.7, 1.3 ], [ 2.7, - 1.3 ], [ 2.7, 1.3 ] ].map( ( [ along, side ] ) => this.terrain.heightAt( p.x + fx * along + fz * side, p.z + fz * along - fx * side ) );
				return Math.max( ...h ) - Math.min( ...h );
			};
			const window = pts.slice( top - 30, top + 30 ).map( ( p, k ) => ( { k: top - 30 + k, fall: level( p, top - 30 + k ) } ) );
			return facing( this.circuit, window.reduce( ( best, c ) => c.fall + Math.abs( c.k - top ) * 0.002 < best.fall + Math.abs( best.k - top ) * 0.002 ? c : best ).k );
		}
		// The ferry road starts out of the junction's bend, 25 m clear of the circuit, on the
		// straight that runs down to the shore, facing the terminal.
		if ( name === 'ferryRoad' ) return facing( this.ferryRoad, this.ferryRoad.points.findIndex( p => ! ( this.closest( p.x, p.z, segment => segment.path === this.circuit )?.distance < 25 ) ) );
		// Joey Island's road starts on the south coast, facing along the ring (east).
		if ( name === 'joeyLoop' ) {
			const pts = this.joeyLoop.points, d = p => Math.hypot( p.x - JOEY_START[ 0 ], p.z - JOEY_START[ 1 ] );
			return facing( this.joeyLoop, pts.reduce( ( best, p, i ) => d( p ) < d( pts[ best ] ) ? i : best, 0 ) );
		}
		const path = this.paths.find( p => p.name === name ) || this.loop;
		const index = path === this.loop ? this.loop.points.findIndex( point => point.x > - 90 && point.x < - 85 && point.z > - 85 ) : 0;
		return facing( path, Math.max( 0, index ) );
	}
	physicsData() { return new Float32Array( this.segments.flatMap( s => [ s.a.x, s.a.z, s.b.x, s.b.z, s.path.halfWidth, s.path.kind === 'asphalt' ? 0.95 : 0.76 ] ) ); }
}
