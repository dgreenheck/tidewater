// The townsfolk brain: one per person. A personality archetype (traits, fixed), moods (drift with
// time and events), a short memory of the player, and a utility decider the hub (People.js) runs at
// 2 to 5 Hz near the camera and 1 Hz further out, staggered. Each think it (1) senses the player
// directly (close, looking, squeezing past), (2) takes the most telling event heard since the last
// think (Perception.js bus), (3) keeps or re-chooses its activity from the slot's smart object.
// It never moves the body itself: the owner (Crowd.js) reads its outputs each frame:
//   target / lookUntil   where the head looks (a live Vector3: the player's head, a bird, a mate)
//   engagedUntil         turn the body to the target too (standing)
//   gesture              { clip, greet } a one-shot clip key to play, cleared by the owner
//   activity             { name, clip, pitch } the looping clip key and head bow for the activity
//   tuck, away           seated: knees swung aside (0..1) toward model +x (away = 1) or -x
import { line } from './Lines.js';
import { ACTIVITIES } from './SmartObjects.js';

// warmth: friendliness; chat: talkativeness; bold: big gestures; patience; energy; curiosity;
// humour; weight: how common (0: not cast yet, the kids wait for child avatars on the beach).
export const ARCHETYPES = {
	friendly: { warmth: 0.9, chat: 0.8, bold: 0.6, patience: 0.8, energy: 0.65, curiosity: 0.6, humour: 0.5, wave: 0.7, weight: 3 },
	grumpy: { warmth: 0.2, chat: 0.35, bold: 0.6, patience: 0.2, energy: 0.45, curiosity: 0.2, humour: 0.1, wave: 0.1, weight: 1.5 },
	shy: { warmth: 0.55, chat: 0.15, bold: 0.1, patience: 0.8, energy: 0.45, curiosity: 0.5, humour: 0.3, wave: 0.2, weight: 1.5 },
	larrikin: { warmth: 0.85, chat: 0.9, bold: 0.95, patience: 0.5, energy: 0.9, curiosity: 0.8, humour: 0.95, wave: 0.85, weight: 1.5 },
	kid: { warmth: 0.8, chat: 0.7, bold: 0.85, patience: 0.2, energy: 1, curiosity: 1, humour: 0.8, wave: 0.9, weight: 0 },
	elderly: { warmth: 0.8, chat: 0.7, bold: 0.35, patience: 0.9, energy: 0.25, curiosity: 0.5, humour: 0.4, wave: 0.55, weight: 1 },
};

// How an event heard on the bus is taken: salience (0..1), seconds the head follows it, the line
// context and the base chance of saying it, standing gestures and their chance, annoyance added.
export const REACT = {
	'player-run': { sal: 0.5, look: 1.6, line: 'running', speak: 0.12, annoy: 0.15 },
	'bird-near': { sal: 0.8, look: 3, line: 'bird', speak: 0.3, gestures: [ 'point', 'laugh' ], gesture: 0.35 },
	'bird-landed': { sal: 0.9, look: 3.5, line: 'bird', speak: 0.35, gestures: [ 'point' ], gesture: 0.4 },
	jetski: { sal: 0.45, look: 2.5, line: 'jetski', speak: 0.08, annoy: 0.1 },
	horn: { sal: 0.75, look: 2.2, line: 'horn', speak: 0.12 },
	car: { sal: 0.6, look: 1.8, line: 'car', speak: 0.15, annoy: 0.2, gestures: [ 'shrug' ], gesture: 0.2 },
	// bumps (Contact.js through Brain.bump): always taken, always a word (force skips the cool-down)
	nudged: { sal: 1, look: 2, line: 'nudge', speak: 0.9, force: true },
	bumped: { sal: 1, look: 2.5, line: 'bumped', speak: 1.2, force: true, annoy: 0.25 },
	fell: { sal: 1, look: 3, line: 'fell', speak: 1.5, force: true, annoy: 0.45 },
	flinch: { sal: 1, look: 2, line: 'flinch', speak: 1.2, force: true, annoy: 0.2 },
	'car-near': { sal: 1, look: 2.5, line: 'oi', speak: 1.5, force: true, annoy: 0.3 },
	// hooks for the next lanes: 'missed-ferry', 'chat-open' (E to chat)
};

export const NEAR = 3, SEEN = 0.8;       // m, and how square the camera must look at someone
const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = a => a[ Math.floor( Math.random() * a.length ) ];
const clamp = v => Math.max( 0, Math.min( 1, v ) );

export function pickArchetype() {

	const all = Object.entries( ARCHETYPES ), total = all.reduce( ( s, [ , a ] ) => s + a.weight, 0 );
	let r = Math.random() * total;
	for ( const [ k, a ] of all ) if ( ( r -= a.weight ) <= 0 ) return k;
	return 'friendly';

}

export class Brain {

	constructor( person, type, hub ) {

		const T = this.traits = ARCHETYPES[ type ] || ARCHETYPES.friendly, j = () => rand( - 0.15, 0.15 );
		this.person = person; this.hub = hub; this.type = type;
		this.mood = { energy: clamp( T.energy + j() ), sociability: clamp( T.chat + j() ), curiosity: clamp( T.curiosity + j() ), patience: T.patience, annoyance: 0 };
		this.memory = { friendly: 0, ignored: 0, annoyed: 0, bumped: 0, lastPass: - 1e9 };   // of the player
		this.inbox = [];
		this.next = Math.random() * 0.5; this.last = 0;                     // staggered thinks
		this.activity = null; this.until = 0;
		this.target = null; this.lookUntil = 0; this.engagedUntil = 0; this.reactUntil = 0;
		this.gesture = null; this.tuck = 0; this.away = 1; this.tuckUntil = 0;
		this.greets = 0; this.nearT = 0; this.coolUntil = rand( 0, 2 ); this.passUntil = 0;
		this.closeAt = - 1e9; this.closeSide = 0; this.passAt = - 1e9;   // set each frame by the hub (People.close)
		this.sayUntil = rand( 2, 6 ); this.said = []; this.spokeToPlayer = false; this.lastEvent = null;

	}

	hear( e ) { if ( this.inbox.length < 6 ) this.inbox.push( e ); }

	lookAt( v, until ) { this.target = v; this.lookUntil = Math.max( this.lookUntil, until ); }

	think( t, ctx ) {

		const dt = Math.min( 2, t - this.last );
		this.last = t;
		this.drift( dt );
		if ( t > this.lookUntil ) this.target = null;
		if ( ctx.player ) this.sense( t, dt, ctx.player, ctx );
		this.tuck = t < this.tuckUntil ? 1 : 0;
		if ( this.inbox.length ) {

			let best = null, u = 0;
			const dozing = this.activity?.name === 'doze' ? 0.35 : 1;
			for ( const e of this.inbox ) {

				const r = REACT[ e.type ];
				const v = r ? r.sal * ( 0.5 + this.mood.curiosity ) * dozing + Math.random() * 0.2 : 0;
				if ( v > u ) { u = v; best = e; }

			}
			this.inbox.length = 0;
			if ( best && u > 0.45 ) this.react( t, best, ctx );

		}
		if ( ctx.posture === 'walk' ) this.activity = null;
		else if ( t >= this.until ) this.choose( t, ctx );
		// a chat (seated, in the queue, at the rail): the head to the neighbour while it lasts
		if ( this.activity && ACTIVITIES[ this.activity.name ].mate && ctx.mate?.head && ! this.target ) this.lookAt( ctx.mate.head, this.until );

	}

	drift( dt ) {

		const M = this.mood, T = this.traits;
		M.annoyance *= Math.exp( - dt * ( 0.01 + 0.05 * T.patience ) );
		M.energy = clamp( M.energy + dt * ( this.activity?.name === 'doze' ? 0.01 : - 0.0015 ) );
		M.sociability = clamp( M.sociability + ( T.chat - 0.4 * M.annoyance - M.sociability ) * dt * 0.01 );
		M.curiosity = clamp( M.curiosity + ( T.curiosity - M.curiosity ) * dt * 0.02 );
		M.patience = clamp( T.patience - 0.5 * M.annoyance );

	}

	// The player, sensed directly: squeezing past a seat, or close by and looking at them.
	sense( t, dt, P, ctx ) {

		const T = this.traits, M = this.mood, stand = ctx.posture !== 'sit';
		// seated with the player in front of their knees: tucked in while they are there, a word if they come past
		if ( ! stand && t - this.closeAt < 0.35 ) {

			this.tuckUntil = t + 0.9; this.away = this.closeSide > 0 ? - 1 : 1;
			this.lookAt( P.head, t + 1.2 );
			if ( t - this.passAt < 0.6 && t >= this.passUntil ) {

				const again = t - this.memory.lastPass < 60;
				this.passUntil = t + 8; this.memory.lastPass = t;
				if ( T.patience < 0.4 || ( again && M.patience < 0.7 ) ) { this.memory.annoyed ++; M.annoyance = clamp( M.annoyance + 0.3 ); }
				this.speak( t, again ? 'squeeze-again' : 'squeeze', ( again ? 0.35 : 0.6 ) * ( 0.5 + T.chat + M.annoyance ) );

			}

		}
		// someone seated greets a player who stops by, not one squeezing past (that is the line above)
		const near = P.d < NEAR && Math.abs( P.dy ) < 1.9 && P.looking && ( stand || ( P.speed < 0.5 && t - this.closeAt > 1 ) );
		if ( near ) {

			this.nearT += dt;
			// the player holds their eye, unless something else just caught it (a bird, the horn)
			if ( t >= this.reactUntil ) { this.lookAt( P.head, t + 1 ); this.engagedUntil = t + 1; }
			if ( t < this.coolUntil || this.greets >= 2 || this.gesture ) return;
			if ( this.greets === 0 ) {

				// a wave or a nod, and perhaps a word (the bird on their shoulder, if they are curious)
				this.greets = 1;
				if ( stand ) this.gesture = { clip: Math.random() < T.wave ? 'wave' : 'nod', greet: true };
				const key = this.keepAway ? 'wary' : P.bird && Math.random() < 0.3 + 0.5 * M.curiosity ? 'bird-shoulder' : this.memory.friendly > 0 ? 'greet-again' : 'greet';
				if ( this.memory.ignored < 2 ) this.spokeToPlayer = this.speak( t, key, ( 0.25 + 0.6 * T.chat ) * ( key === 'bird-shoulder' ? 1.3 : 1 ) );

			} else if ( this.nearT > ( this.type === 'shy' ? 4 : 2.5 ) ) {

				// the player stays: a word with the hands, or a point
				this.greets = 2; this.coolUntil = t + 15; this.memory.friendly ++;
				if ( stand ) this.gesture = { clip: Math.random() < 0.6 ? 'talk' : 'point', greet: true };
				this.speak( t, 'chat', 0.2 + 0.5 * T.chat );

			}

		} else if ( this.nearT > 0 || this.greets ) {

			// they walked off: spoken to and gone at once is being ignored
			if ( this.greets === 1 && this.spokeToPlayer && this.nearT < 1.5 ) this.memory.ignored ++;
			if ( this.greets ) this.coolUntil = Math.max( this.coolUntil, t + 8 );
			this.greets = 0; this.nearT = 0; this.spokeToPlayer = false;

		}

	}

	react( t, e, ctx ) {

		const r = REACT[ e.type ], T = this.traits, M = this.mood;
		this.lastEvent = e.type;
		this.reactUntil = t + r.look * rand( 0.8, 1.3 );
		this.target = e.at; this.lookUntil = this.reactUntil;
		if ( r.annoy ) M.annoyance = clamp( M.annoyance + r.annoy * ( 1 - T.patience ) * 2 );
		M.curiosity = clamp( M.curiosity + 0.05 );
		if ( r.gestures && ctx.posture === 'stand' && ! this.gesture && Math.random() < r.gesture * ( 0.5 + T.bold ) ) this.gesture = { clip: pick( r.gestures ) };
		this.speak( t, r.line, r.speak * ( 0.4 + T.chat + 0.5 * M.annoyance ), r.force );

	}

	// A knock (Contact.js), 0..1, taken as `event` (a REACT row) from `at` (the player's head by default).
	// A real bump is remembered: the cooler sorts keep their distance from you after it (keepAway).
	bump( t, strength = 0.5, event = 'bumped', at = null ) {

		if ( event !== 'nudged' ) this.memory.bumped ++;
		this.mood.annoyance = clamp( this.mood.annoyance + strength * ( 1 - this.traits.patience ) );
		this.keepAway = this.memory.bumped > 0 && this.traits.warmth < 0.6;
		this.react( t, { type: event, at: at || this.hub.player.head }, { posture: this.person.posture } );
		this.engagedUntil = this.reactUntil;

	}

	choose( t, ctx ) {

		const p = this.person, kind = p.slot?.obj.kind || ( ctx.posture === 'sit' ? 'seat' : 'spot' ), mate = ctx.mate;
		let best = null, u = - Infinity;
		for ( const name in ACTIVITIES ) {

			const a = ACTIVITIES[ name ];
			if ( ! a.at.includes( kind ) || ( a.mate && ! mate ) || ( p.can && ! p.can( a.clip ) ) ) continue;
			const v = a.score( this, mate ) + Math.random() * 0.3 - ( name === this.activity?.name ? 0.25 : 0 );
			if ( v > u ) { u = v; best = name; }

		}
		if ( ! best ) return;
		const a = ACTIVITIES[ best ];
		this.activity = { name: best, clip: a.clip, pitch: a.pitch || 0 };
		this.until = t + rand( a.hold[ 0 ], a.hold[ 1 ] );

	}

	// A line in this person's voice, if the dice, their cool-down and the hub's (two on screen) allow.
	speak( t, key, chance, force = false ) {

		if ( ( t < this.sayUntil && ! force ) || Math.random() > chance ) return false;
		const text = line( key, this.type, this.said );
		if ( ! text || ! this.hub.say( this.person, text, key, force ) ) return false;
		this.said.push( text );
		if ( this.said.length > 4 ) this.said.shift();
		this.sayUntil = t + rand( 14, 28 ) * ( 1.4 - this.traits.chat );
		return true;

	}

	state() {

		const r = v => + v.toFixed( 2 );
		return { type: this.type, activity: this.activity?.name ?? null, mood: Object.fromEntries( Object.entries( this.mood ).map( ( [ k, v ] ) => [ k, r( v ) ] ) ),
			memory: { friendly: this.memory.friendly, ignored: this.memory.ignored, annoyed: this.memory.annoyed, bumped: this.memory.bumped }, keepAway: !! this.keepAway, tuck: this.tuck, looking: !! this.target, event: this.lastEvent, said: this.said.at( - 1 ) ?? null };

	}

}
