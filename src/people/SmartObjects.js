// Smart objects: places that advertise what people can do at them. An object has slots (a seat, a
// queue spot, a place at the rail); a person claims a slot, the activities the slot's kind lists are
// what their brain chooses between while they are there, and they release it when they leave.
// Positions stay with the owner (Crowd.js keeps its routes and frames): an object only knows its
// slots, which slots are neighbours (a bench's other seat, the queue pair, the next place at the
// rail) and who is in each.
//   objects.add( new SmartObject( { kind, slots, tag } ) ), objects.claim( kind, filter, who ),
//   objects.release( who ), objects.mateOf( who ), ACTIVITIES
const camp = ( b, kind ) => b.person?.slotDef?.kind === kind;   // the beach's camps (Beach.js): towel, reader, phoner, sand
const talking = m => m?.brain?.activity?.name === 'talk' || m?.brain?.activity?.name === 'sitChat';

// Activity table. `at`: the slot kinds that offer it; `clip`: the body's clip key (the owner maps
// it to a real clip, and falls back where an avatar lacks it); `hold`: seconds, [ min, max ];
// `pitch`: the head bowed (rad) for phone, book and doze; `mate`: needs a neighbour in the next
// slot; `score( brain, mate )`: the utility before the decider's noise.
export const ACTIVITIES = {
	// sitting (ferry seats, benches)
	sit: { at: [ 'seat', 'camp', 'stool' ], clip: 'sit', hold: [ 8, 18 ], score: () => 0.42 },
	sitLook: { at: [ 'seat', 'camp', 'stool' ], clip: 'sitLook', hold: [ 5, 9 ], score: b => 0.12 + 0.45 * b.mood.curiosity },
	phone: { at: [ 'seat', 'stool' ], clip: 'sit', pitch: 0.55, hold: [ 10, 25 ], score: b => 0.18 + 0.35 * ( 1 - b.mood.sociability ) },
	read: { at: [ 'seat' ], clip: 'sit', pitch: 0.45, hold: [ 15, 35 ], score: b => 0.1 + 0.4 * ( 1 - b.traits.energy ) },
	doze: { at: [ 'seat', 'camp' ], clip: 'sitRelax', pitch: 0.3, hold: [ 20, 45 ], score: b => 1.1 * ( 0.55 - b.mood.energy ) },
	yawn: { at: [ 'seat', 'camp', 'stool' ], clip: 'sitYawn', hold: [ 4, 6 ], score: b => 0.35 * ( 0.8 - b.mood.energy ) },
	sitChat: { at: [ 'seat', 'camp' ], clip: 'sitThink', hold: [ 6, 12 ], mate: true, score: ( b, m ) => 0.75 * b.mood.sociability * ( talking( m ) ? 1.3 : 1 ) },
	// standing (the gangway queue, chat spots, the rail)
	wait: { at: [ 'queue', 'spot', 'rail', 'wade' ], clip: 'idle', hold: [ 4, 9 ], score: () => 0.35 },
	lookAround: { at: [ 'queue', 'spot', 'rail', 'wade', 'line' ], clip: 'look', hold: [ 4, 8 ], score: b => 0.1 + 0.4 * b.mood.curiosity },
	phoneCall: { at: [ 'queue', 'spot', 'rail' ], clip: 'phone', hold: [ 6, 14 ], score: b => 0.1 + 0.3 * ( 1 - b.mood.sociability ) },
	lookOut: { at: [ 'rail' ], clip: 'idle', pitch: 0.12, hold: [ 8, 18 ], score: () => 0.55 },
	talk: { at: [ 'queue', 'spot', 'rail', 'wade', 'line' ], clip: 'talk', hold: [ 4, 8 ], mate: true, score: ( b, m ) => b.mood.sociability * b.traits.chat * ( talking( m ) ? 0.25 : 1.2 ) },
	listen: { at: [ 'queue', 'spot', 'rail', 'wade', 'line' ], clip: 'nod', hold: [ 3, 6 ], mate: true, score: ( b, m ) => 0.55 * b.mood.sociability * ( talking( m ) ? 1.5 : 0.4 ) },
	laugh: { at: [ 'queue', 'spot', 'rail', 'wade', 'line' ], clip: 'laugh', hold: [ 2, 4 ], mate: true, score: ( b, m ) => 0.5 * b.traits.humour * ( talking( m ) ? 1 : 0.3 ) },
	shrug: { at: [ 'queue', 'spot', 'rail' ], clip: 'shrug', hold: [ 2, 3 ], mate: true, score: b => 0.2 * ( 1 - b.traits.warmth ) },
	// the beach (src/people/Beach.js): a camp's towel or sand, the water, a line off the pier, the hire stool, the games
	sunbake: { at: [ 'camp' ], clip: 'lie', hold: [ 25, 60 ], score: b => camp( b, 'towel' ) ? 0.75 + 0.4 * ( 1 - b.mood.energy ) : camp( b, 'phoner' ) || camp( b, 'reader' ) ? 0.3 : - 1 },
	campRead: { at: [ 'camp' ], clip: 'sit', pitch: 0.45, hold: [ 20, 40 ], score: b => camp( b, 'reader' ) ? 0.8 : - 1 },
	campPhone: { at: [ 'camp' ], clip: 'sit', pitch: 0.55, hold: [ 12, 25 ], score: b => camp( b, 'phoner' ) ? 0.75 : - 1 },
	tread: { at: [ 'swim' ], clip: 'tread', hold: [ 30, 60 ], score: () => 1 },
	fish: { at: [ 'line' ], clip: 'idle', pitch: 0.2, hold: [ 15, 35 ], score: () => 0.7 },
	play: { at: [ 'cricket', 'frisbee', 'shells' ], clip: 'idle', hold: [ 60, 120 ], score: () => 1 },
};

export class SmartObject {

	// slots: [ { ...owner data, mates: [ slot indices ] } ]; tag: the owner's key (a terminal, a side)
	constructor( { kind, slots, tag = null } ) {

		this.kind = kind;
		this.tag = tag;
		this.slots = slots.map( s => ( { mates: [], ...s, who: null } ) );

	}

	free() { const out = []; this.slots.forEach( ( s, i ) => { if ( ! s.who ) out.push( i ); } ); return out; }

	claim( i, who ) {

		const s = this.slots[ i ];
		if ( ! s || s.who ) return null;
		who.slot?.obj.release( who );
		s.who = who;
		who.slot = { obj: this, i };
		return s;

	}

	release( who ) {

		if ( who.slot?.obj !== this ) return;
		this.slots[ who.slot.i ].who = null;
		who.slot = null;

	}

	mate( i ) { for ( const j of this.slots[ i ].mates ) if ( this.slots[ j ]?.who ) return this.slots[ j ].who; return null; }

}

export class SmartObjects {

	constructor() { this.list = []; }

	add( o ) { this.list.push( o ); return o; }

	// A free slot of `kind` (objects passing `filter( obj )`), at random, claimed for `who`.
	claim( kind, filter, who ) {

		const options = [];
		for ( const o of this.list ) if ( o.kind === kind && ( ! filter || filter( o ) ) ) for ( const i of o.free() ) options.push( [ o, i ] );
		if ( ! options.length ) return null;
		const [ o, i ] = options[ Math.floor( Math.random() * options.length ) ];
		return o.claim( i, who );

	}

	release( who ) { who.slot?.obj.release( who ); }

	mateOf( who ) { return who.slot ? who.slot.obj.mate( who.slot.i ) : null; }

	state() { return this.list.map( o => ( { kind: o.kind, tag: o.tag?.name ?? o.tag, used: o.slots.filter( s => s.who ).length, slots: o.slots.length } ) ); }

}
