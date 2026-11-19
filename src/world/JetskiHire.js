// The beach jetski hire by the pier: a timber stand with a striped awning, a "JETSKI HIRE" sign (both faces),
// counter, vest rack and price board, a beach launching dolly, and a float line marking the ski lane on the
// pier side. Models: public/models/jetski-hire.glb and jetski-buoys.glb (tools/jetski/hire_build.py, PBR
// factors only). The skis themselves are src/jetski's rideable ones, parked at src/jetski/spots.js.
import { Vector3 } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { SPOTS } from '../jetski/spots.js';

// world metres; yaw 0 = the model's +Z (the stand's counter) faces world +z, the sea
export const JETSKI_HIRE = {
	stand: { x: 41.0, z: - 54.0, yaw: 0.0, half: [ 1.45, 0.62, 0.8 ] },
	buoys: { x: 50.5, z: - 37.5, yaw: 0.0 }, // eight floats, 3 m apart, running out to sea
};

export async function placeJetskiHire( app ) {
	const base = import.meta.env.BASE_URL, t = app.terrainData, S = JETSKI_HIRE.stand;
	try {
		const [ stand, buoys ] = await Promise.all( [ loadModel( `${ base }models/jetski-hire.glb` ), loadModel( `${ base }models/jetski-buoys.glb` ) ] );
		// sit the deck on the lowest corner so no edge floats; the rest beds into the sand
		const c = Math.cos( S.yaw ), s = Math.sin( S.yaw );
		const y = Math.min( ...[ [ - 1.5, - 0.8 ], [ 1.5, - 0.8 ], [ - 1.5, 0.8 ], [ 1.5, 0.8 ] ].map( ( [ x, z ] ) => t.heightAt( S.x + x * c + z * s, S.z - x * s + z * c ) ) );
		stand.root.position.set( S.x, y, S.z ); stand.root.rotation.y = S.yaw;
		buoys.root.position.set( JETSKI_HIRE.buoys.x, 0, JETSKI_HIRE.buoys.z ); buoys.root.rotation.y = JETSKI_HIRE.buoys.yaw;
		for ( const m of [ stand, buoys ] ) { app.scene.add( m.root ); m.root.updateMatrixWorld( true ); }
		app.colliders?.addBox( new Vector3( S.x, y + S.half[ 1 ], S.z ), new Vector3( ...S.half ), S.yaw, { solid: true, tag: 'jetski-hire' } );
		app.jetskiHire = { root: stand.root, buoys: buoys.root, desk: new HireDesk( app ) };
	} catch ( e ) {
		console.warn( 'jetski hire: models missing', e );
	}
}

// The hire desk: the attendant (src/people/Beach.js keeps his body) sits on a stool behind the counter on
// his phone, stands and waves you over when you come near, and "E · Hire a jetski" at the counter or at one
// of the three beach skis charges HIRE_FEE from the game's money (src/game/GameState.js spend). Once paid he
// gives the safety line, walks out and pushes a ski off, and the jetski's own "Ride jetski" offer comes back.
// Bring it back near the stand and step off: he walks out, ties it up, and the hire is done.
// The gate wraps app.jetskis.offer (Jetski.js stays untouched): unpaid, near the stand or a beach ski, the
// hire offer comes first. ?freeHire skips the fee (other lanes' checks).
export const HIRE_FEE = 20;
// from the stool (inside the east end) out the open back, round the west end to the sea side (stand frame): the
// east end is the counter, where the customer stands, so he never walks through them
const AROUND = [ [ 0.7, - 1.05 ], [ - 1.95, - 1.05 ], [ - 1.95, 1.4 ] ];
const FACE = Math.PI / 2;   // the attendant faces the path down from the village, over the counter (+x)

export class HireDesk {

	constructor( app ) {

		this.app = app;
		this.paid = false; this.rode = false; this.phase = 'idle'; this.waved = 0; this.hires = 0;
		this.free = typeof location !== 'undefined' && /[?&]freeHire\b/.test( location.search );
		const S = JETSKI_HIRE.stand;
		this.counter = new Vector3( S.x + S.half[ 0 ] + 0.7, 0, S.z );   // where you stand to hire: at the counter, the stand's east end
		const js = app.jetskis;
		this.skis = new Set( ( js?.skis || [] ).filter( s => SPOTS.slice( 0, 3 ).some( o => Math.hypot( s.position.x - o.x, s.position.z - o.z ) < 3 ) ) );
		if ( js?.offer ) { const plain = js.offer.bind( js ); js.offer = player => this.offer( player, plain ); }

	}

	at( s ) { const js = this.app.jetskis; return s === js.live ? js.ctl.position : s.position; }

	offer( player, plain ) {

		const o = plain( player );
		if ( this.paid || this.free ) return o;
		const P = player.position, atDesk = Math.hypot( P.x - this.counter.x, P.z - this.counter.z ) < 3.2;
		const atSki = !! o && [ ...this.skis ].some( s => { const q = this.at( s ); return Math.hypot( q.x - P.x, q.z - P.z ) < 3.3; } );
		if ( ! atDesk && ! atSki ) return o;
		return { text: `Hire a jetski  ·  $${ HIRE_FEE }`, act: () => this.pay() };

	}

	pay() {

		const app = this.app, g = app.game?.state, beach = app.beach, a = beach?.attendant;
		if ( ! g || ! g.spend( HIRE_FEE ) ) { if ( a ) beach.say( a, 'hire-broke', true ); this.phase = 'broke'; return false; }
		this.paid = true; this.rode = false; this.hires ++;
		if ( ! a ) return true;
		beach.say( a, 'hire-safety', true );
		// he takes the clipboard, walks round to the nearest ski and pushes it off the sand
		const P = app.player.position;
		let ski = null, bd = Infinity;
		for ( const s of this.skis ) { const q = this.at( s ), d = Math.hypot( q.x - P.x, q.z - P.z ); if ( d < bd ) { bd = d; ski = s; } }
		if ( ! ski ) return true;
		this.phase = 'push';
		beach.hub.contact.give( a, 'clipboard' );
		const q = this.at( ski );
		beach.send( a, [ ...this.around(), new Vector3( q.x - 0.6, 0, q.z - 1.9 ) ], () => {

			a.face = 0;
			beach.beat( a, a.model.clipSet.has( 'crouch_in' ) ? 'crouchIn' : 'crouch', 1.6, () => this.home() );

		} );
		return true;

	}

	around() { const S = JETSKI_HIRE.stand; return AROUND.map( ( [ x, z ] ) => new Vector3( S.x + x, 0, S.z + z ) ); }

	// back to the stool and the phone
	home() {

		const beach = this.app.beach, a = beach.attendant;
		this.phase = this.phase === 'tie' ? 'idle' : this.phase === 'push' ? 'out' : this.phase;
		beach.send( a, [ ...this.around().reverse(), a.stool.clone() ], () => { beach.moveTo( a, a.stool ); a.face = FACE; a.mode = 'stool'; beach.hub.contact.give( a, 'phone' ); } );

	}

	update() {

		const app = this.app, beach = app.beach, a = beach?.attendant, js = app.jetskis, pl = app.player;
		if ( ! a || ! pl || a.knock ) return;
		const t = beach.hub.t, P = pl.position, d = Math.hypot( P.x - a.world.x, P.z - a.world.z );
		// he waves you over: on foot, near, not hired yet, once in a while
		if ( ! this.paid && pl.mode === 'walk' && d < 10 && d > 2.2 && t > this.waved && a.mode === 'stool' && ! a.path && ! a.beat ) {

			this.waved = t + 40;
			beach.moveTo( a, new Vector3( a.stool.x + 0.25 * Math.sin( FACE ), a.stool.y, a.stool.z + 0.25 * Math.cos( FACE ) ) );   // up off the stool, still behind the counter
			a.mode = 'stand';
			beach.hub.contact.give( a, 'clipboard' );
			beach.beat( a, 'wave', 2.6, () => { beach.moveTo( a, a.stool ); a.mode = 'stool'; beach.hub.contact.give( a, 'phone' ); } );
			a.brain.target = beach.hub.player.head; a.brain.lookUntil = t + 4; a.brain.engagedUntil = t + 3;
			beach.say( a, 'hire-wave' );

		}
		if ( this.paid && js?.riding ) this.rode = true;
		// brought back near the stand and stepped off: he ties it up and the hire is done
		if ( this.paid && this.rode && ! js?.riding && this.phase !== 'tie' && js?.live && ! a.path && ! a.beat ) {

			const q = js.ctl.position, S = JETSKI_HIRE.stand;
			if ( Math.abs( q.x - S.x ) < 14 && q.z < S.z + 32 ) {

				this.phase = 'tie';
				beach.say( a, 'hire-back', true );
				beach.hub.contact.give( a, 'clipboard' );
				beach.send( a, [ ...this.around(), new Vector3( q.x - 1.1, 0, q.z - 0.6 ) ], () => {

					a.face = Math.PI / 2;
					beach.beat( a, 'crouch', 2.6, () => { this.paid = false; this.rode = false; this.home(); } );

				} );

			}

		}

	}

	state() { return { paid: this.paid, rode: this.rode, phase: this.phase, hires: this.hires, free: this.free, skis: this.skis.size }; }

}
