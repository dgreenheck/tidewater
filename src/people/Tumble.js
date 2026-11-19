// Knocked flat (Contact.js, a 'tumble'): the player's own ragdoll (src/player/Ragdoll.js) on a townsperson.
// Crowd models and player.glb are both Bip01 rigs under the same 0.01 armature, so:
//  - the capsules are player.glb's scene extras `ragdoll`, every radius and length scaled by the person's
//    size (their idle's pelvis height against the player's idle);
//  - the get-ups are the player's keyed getup_back and getup_belly, retargeted by bone name (as
//    src/jetski/Mate.js does the ski clips): the rotations as they are, the pelvis translation scaled the same.
// Each model keeps its Ragdoll once built (a one-key clip over its nodes). At most MAX run at once;
// the current full58-person population fits. Missing rigs or a future excess use an explicitly
// reported capsule fallback, not a claimed articulated body. Adaptive steps share the player solver and its measured protection ledger.
// The owner (Crowd.js, Beach.js) puts the person's groups at the origin while one runs and calls
// Contact.rag() in place of its own update and pose; the ragdoll draws the model's group in the world.
import { Ragdoll } from '../player/Ragdoll.js';
import { capsuleContact, solveCapsules, collideWalker } from './ArticulatedContacts.js';
import { Matrix4, Quaternion, Vector3 } from '../engine/index.js';

export const MAX = 64;  // all 26 beach + up to 32 ferry people fit; every active rig has 14 bodies
const SUB = 2, GETUPS = [ 'getup_back', 'getup_belly' ], CLIPS = [ ...GETUPS, 'tread', 'swim' ];   // tread and swim: overboard (Contact.js)
const PELVIS = 'Bip01 Pelvis';
const cache = new WeakMap();   // the cast's glTF nodes -> { clips, k }

// The actual pelvis height in model metres. A clip's local translation can be
// almost zero because its armature already carries the complete standing height.
// Measure the parent-transformed first pose without changing the rendered model.
function hips( m, clip ) {

	const pn = m.gltf.nodes.findIndex( x => x.name === PELVIS );
	if ( pn < 0 ) return 0;
	const chain = []; for ( let n = pn; n >= 0; n = m.parent[ n ] ) chain.unshift( n );
	const world = new Matrix4(), local = new Matrix4();
	for ( const n of chain ) {
		const rest = m.rest[ n ], value = ( path, fallback, size ) => {
			const ch = clip?.channels.find( c => c.node === n && c.path === path );
			return ch ? Array.from( ch.values.subarray( 0, size ) ) : fallback;
		};
		local.compose( new Vector3( ...value( 'translation', rest.t, 3 ) ), new Quaternion( ...value( 'rotation', rest.r, 4 ) ), new Vector3( ...value( 'scale', rest.s, 3 ) ) );
		world.multiply( local );
	}
	return world.elements[ 13 ];

}

function retarget( src, dst, k ) {

	const dn = dst.gltf.nodes, sn = src.gltf.nodes, map = sn.map( n => dn.findIndex( d => d.name === n.name ) );
	const out = new Map();
	for ( const name of CLIPS ) {

		const a = src.clips.get( name );
		if ( ! a ) continue;
		const channels = a.channels.filter( ch => map[ ch.node ] >= 0 && ( ch.path === 'rotation' || ( ch.path === 'translation' && sn[ ch.node ].name === PELVIS ) ) )
			.map( ch => ( { ...ch, node: map[ ch.node ], values: ch.path === 'translation' ? ch.values.map( v => v * k ) : ch.values } ) );
		out.set( name, { ...a, name, channels } );

	}
	return out;

}

export class Tumbles {

	constructor( hub ) {

		this.hub = hub;
		this.live = new Set();
		this.count = 0;
		this.ms = 0;
		this.contacts = { self: 0, people: 0, player: 0, maxPenetration: 0, ms: 0 };
		// the ground the ragdoll meets is the player's (terrain, walkable boxes, walls), whatever he is doing now
		const P = () => hub.app.player;
		this.world = { get terrain() { return P().terrain; }, get colliders() { return P().colliders; }, get groundProviders() { return P().groundProviders; }, reef: null };

	}

	// the player's rig, when it has the capsules and the get-ups
	src() {

		const a = this.hub.app.player?.avatar, m = a?.model, json = m?.gltf?.json;
		const spec = json?.scenes?.[ json.scene || 0 ]?.extras?.ragdoll;
		return m && Array.isArray( spec ) && GETUPS.every( n => m.clips.has( n ) ) && m.clips.has( 'idle' ) ? { m, spec } : null;

	}

	can( p ) { return this.live.size < MAX && !! p.model?.gltf && !! p.clipOf?.( 'idle' ) && !! this.src(); }

	rig( p ) {

		const m = p.model;
		if ( m._tumble ) return m._tumble;
		const S = this.src(), idle = m.clips.get( p.clipOf( 'idle' ) );
		let c = cache.get( m.gltf.nodes );
		if ( ! c ) {

			const k = hips( m, idle ) / ( hips( S.m, S.m.clips.get( 'idle' ) ) || 1 ) || 1;
			c = { k, clips: retarget( S.m, m, k ) };
			cache.set( m.gltf.nodes, c );

		}
		for ( const [ n, clip ] of c.clips ) if ( ! m.clips.has( n ) ) { m.clips.set( n, clip ); m.clipSet?.add( n ); }
		const spec = S.spec.map( s => ( { ...s, radius: s.radius * c.k, length: s.length * c.k } ) );
		// Internal angular viscosity1 N m s/rad is an assumed reduced tissue law.
		// The implicit coupled solve dissipates relative angular motion.
		const rd = new Ragdoll( this.world, { spec, sub: SUB, jointViscosity: 1, mass: p.brain?.type === 'kid' ? 35 : 72 } );
		const avatar = { model: m, group: m.group, neckH: 1.5 * c.k, idle: { clip: idle, time: 0, weight: 0, target: 0, fade: 1e-3, loop: true, speed: 1, ended: false } };
		return ( m._tumble = { rd, avatar, k: c.k } );

	}

	// Down they go from where they stand (p.group's place and yaw): the body moving at `v`, knocked by the
	// impulse J (N s) at `point`, both world. Null when there is no room for another or no rig.
	start( p, v, J, point ) {

		if ( ! this.can( p ) ) return null;
		const r = this.rig( p ), y = p.yaw || 0, g = p.group.position;
		r.rd.waterY = - Infinity;
		if ( ! r.rd.start( r.avatar, { x: g.x, y: g.y, z: g.z }, { x: 0, y: Math.sin( y / 2 ), z: 0, w: Math.cos( y / 2 ) }, v, { impulse: J, point, spin: { x: 0, y: 0, z: 0 } } ) ) return null;
		this.live.add( p );
		this.count ++;
		return r;

	}

	// Up again (or afloat): the model's group back under the person's, the idle (or the tread) on
	end( p, r, wet = false ) {

		this.live.delete( p );
		r.rd.phase = 'idle';
		r.rd.disasterField = null;
		const g = p.model.group;
		g.position.set( 0, 0, 0 ); g.quaternion.set( 0, 0, 0, 1 );
		const m = p.model, idle = wet && r.rd.tread ? r.rd.tread : r.rd.idle || r.avatar.idle;   // the get-up's own layer, already running
		idle.weight = idle.target = 1;
		m.layers = [ idle ];

	}

	// All owners have advanced before People.update. Resolve nearby articulated
	// pairs once here, including the player's rig or ordinary walking capsule.
	collide( dt ) {

		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		const start = performance.now(), stats = this.contacts;
		stats.self = stats.people = stats.player = 0; stats.maxPenetration = 0;
		const entries = [ ...this.live ].filter( p => p.knock?.rag?.rd.phase === 'sim' ).map( p => ( { p, rd: p.knock.rag.rd } ) );
		const player = this.hub.app.player;
		if ( player?.mode === 'ragdoll' && player.rag.phase === 'sim' ) entries.push( { p: null, rd: player.rag } );
		const budgets = new Map( entries.map( e => [ e.rd, 0.035 ] ) );
		const record = ( c, kind ) => { if ( c ) { stats[ kind ] ++; stats.maxPenetration = Math.max( stats.maxPenetration, c.penetration ); } };
		for ( let i = 0; i < entries.length; i ++ ) {
			const A = entries[ i ].rd;
			stats.self += A.stats.selfContacts || 0;
			for ( let j = i + 1; j < entries.length; j ++ ) {
				const B = entries[ j ].rd;
				if ( Math.hypot( A.pelvis.x.x - B.pelvis.x.x, A.pelvis.x.y - B.pelvis.x.y, A.pelvis.x.z - B.pelvis.x.z ) > 4 ) continue;
				for ( const a of A.bodies ) for ( const b of B.bodies ) {
					if ( ! capsuleContact( a, b ) ) continue;
					const c = solveCapsules( A, a, B, b, { project: false } ); record( c, 'people' );
					if ( ! c ) continue;
					// A split correction translates the whole rig, preserving every
					// anchor and inertia orientation. All pairs share this frame budget.
					const wa = 1 / A.mass, wb = 1 / B.mass, fa = wa / ( wa + wb ), fb = 1 - fa;
					const distance = Math.min( Math.max( 0, c.penetration - 0.002 ) * 0.4, budgets.get( A ) / fa, budgets.get( B ) / fb );
					for ( const [ rig, sign, fraction ] of [ [ A, - 1, fa ], [ B, 1, fb ] ] ) {
						const step = distance * fraction;
						for ( const body of rig.bodies ) { body.x.x += c.normal.x * step * sign; body.x.y += c.normal.y * step * sign; body.x.z += c.normal.z * step * sign; }
						budgets.set( rig, Math.max( 0, budgets.get( rig ) - step ) );
					}
				}
			}
		}
		if ( player && [ 'walk', 'ferry', 'swim' ].includes( player.mode ) ) {
			for ( const { rd } of entries ) {
				if ( Math.hypot( rd.pelvis.x.x - player.position.x, rd.pelvis.x.y - player.position.y, rd.pelvis.x.z - player.position.z ) > 3 ) continue;
				for ( const contact of collideWalker( rd, player ) ) record( contact, 'player' );
			}
			if ( player.mode === 'ferry' && player.vessel ) player.vessel.ferry.ship.toLocal( player.position, player.vessel.local );
		}
		for ( const { p, rd } of entries ) {
			// Split corrections preserve the complete articulated configuration.
			rd.focus.set( rd.pelvis.x.x, rd.pelvis.x.y, rd.pelvis.x.z );
			if ( p ) { p.world.copy( rd.focus ); rd.draw( 0, p.knock.rag.avatar ); }
		}
		stats.ms = performance.now() - start;

	}

	state() {

		const out = [];
		for ( const p of this.live ) { const r = p.model._tumble.rd; out.push( { id: p.id, phase: r.phase, t: + r.t.toFixed( 2 ), ms: + ( r.stats?.ms || 0 ).toFixed( 3 ), at: [ r.focus.x, r.focus.y, r.focus.z ].map( x => + x.toFixed( 2 ) ) } ); }
		return { live: out, count: this.count, capacity: MAX, bodies: out.length * 14, joints: out.length * 13,
			fallback: this.hub.list?.filter( p => p.knock?.physical && ! p.knock.rag ).length || 0, contacts: { ...this.contacts } };

	}

}
