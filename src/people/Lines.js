// What the townsfolk say: a line per context (the event or the moment), by archetype, with `any`
// as the fallback for every archetype. Keep them short (a bubble is one line) and local. Add a
// context here and name it in a reaction (Brain.js REACT) or call hub.say( person, key ) directly.
// docs/people.md lists the contexts and who uses them.
export const LINES = {
	// the beach (src/people/Beach.js) and the jetski hire (src/world/JetskiHire.js)
	'cricket-shot': { any: [ 'Shot!', 'Get in!', 'Run!', 'Too easy.' ] },
	howzat: { any: [ 'Howzat!', "Owzat! You're out!", 'Caught it!' ] },
	'hire-wave': { any: [ 'Jetski, mate? Twenty bucks.', 'Wanna go for a spin? Twenty bucks.', "G'day! Ski hire's open." ] },
	'hire-safety': { any: [ 'Stay outside the flags, mate.', 'Stay outside the flags and have fun.', 'Outside the flags, and mind the swimmers.' ] },
	'hire-broke': { any: [ "It's twenty bucks, mate. Come back with some cash.", 'Twenty bucks a ski. Sell a few fish first.' ] },
	'hire-back': { any: [ "Good ride? I'll tie her up.", 'Back in one piece. Legend.', "Cheers, I'll tie her up." ] },
	'cocky-photo': { any: [ 'Ha! Hold still, I want a photo.', 'Look at you, cheeky bird!', 'Say cheese, Cocky.' ] },
	'cocky-shoo': { any: [ 'Oi! Shoo!', 'Go on, off you go.', 'Not on me, mate!' ] },
	'cocky-chip': { any: [ 'Want a chip, mate?', 'Here ya go, one chip.', 'Just the one, cheeky.' ] },
	greet: {
		any: [ "G'day.", 'How ya going?', 'Morning!', 'Hiya.' ],
		friendly: [ "G'day!", 'How ya going?', 'Lovely day for it.', 'Hey there!' ],
		grumpy: [ "Yeah, g'day.", 'Mm.', 'Can I help you?' ],
		shy: [ 'Oh. Hi.', 'Hello...' ],
		larrikin: [ "G'day legend!", 'How ya goin, mate?', 'Oi oi!' ],
		elderly: [ 'Hello, love.', 'Lovely morning.', "G'day to you." ],
		kid: [ 'Hi!', 'Hello!', 'Hey!' ],
	},
	'greet-again': {
		any: [ 'Hello again!', 'Back again?', 'Oh, hi again.' ],
		grumpy: [ 'You again.', 'Still here?' ],
		larrikin: [ 'Oi, my mate!', 'Back for more?' ],
	},
	chat: {
		any: [ 'Boat on time today?', 'Nice day for a crossing.', 'Been out to Joey Island?', 'Water looks good.' ],
		grumpy: [ "Boat's late again.", 'Too many tourists.' ],
		shy: [ 'Nice day...' ],
		larrikin: [ 'Heard the fish are biting.', "Reckon it'll rain? Nah." ],
		elderly: [ 'I remember when this was all bush.', 'Mind the sun, love.' ],
	},
	squeeze: {
		any: [ 'Sorry mate.', 'Excuse me.', 'Oh, sorry!' ],
		friendly: [ 'Sorry mate.', 'Oops, sorry!', 'Go for it.' ],
		grumpy: [ 'Watch it.', 'Mind the feet.', 'Oi, careful.' ],
		shy: [ 'Oh, sorry.', 'Sorry...' ],
		larrikin: [ 'Squeeze on through!', 'All good, mate.' ],
		elderly: [ 'Oh, excuse me, love.', 'Plenty of room.' ],
	},
	'squeeze-again': {
		any: [ 'Sorry, again.', 'Oh, again?' ],
		grumpy: [ 'Watch it!', 'For crying out loud.' ],
		larrikin: [ 'Doing laps, are ya?' ],
	},
	'bird-shoulder': {
		any: [ 'Is that a cocky?', 'Nice bird!', 'Does he talk?' ],
		grumpy: [ 'Keep that bird off me.' ],
		larrikin: [ 'Ha! A cocky on ya shoulder!', 'Does he swear?' ],
		elderly: [ 'Oh, what a lovely bird.' ],
		kid: [ 'A BIRD!' ],
	},
	bird: {
		any: [ 'Look, a cocky!', 'Nice bird!' ],
		grumpy: [ 'Bloody cockies.' ],
		larrikin: [ 'Oi, cocky!' ],
		shy: [ 'Oh! A bird.' ],
	},
	horn: {
		any: [ "That's us.", 'Here we go.' ],
		grumpy: [ 'Loud enough?' ],
		larrikin: [ 'Toot toot!' ],
		elderly: [ 'Oh! Gave me a fright.' ],
	},
	jetski: {
		any: [ 'Look at him go.', "Bit fast, isn't he?" ],
		grumpy: [ 'Bloody hoons.' ],
		larrikin: [ 'Send it!' ],
	},
	running: {
		any: [ 'Whoa, careful!', "Where's the fire?" ],
		grumpy: [ 'No running!' ],
		larrikin: [ "Go on, you'll make it!" ],
	},
	car: {
		any: [ 'Whoa!' ],
		grumpy: [ 'Slow down!' ],
	},
	// bumps (src/people/Contact.js)
	nudge: {
		any: [ 'Oh, sorry.', 'Excuse me.', 'Pardon me.' ],
		friendly: [ 'Oh, sorry!', 'Whoops, my fault.' ],
		grumpy: [ 'Watch it, mate.', 'Do you mind?', 'Eyes up, mate.' ],
		shy: [ 'Oh! Sorry...', 'Sorry.' ],
		larrikin: [ 'Easy, tiger!', 'Oi, personal space!' ],
		elderly: [ 'Oh! Careful, love.', 'Mind yourself, dear.' ],
		kid: [ 'Hey!' ],
	},
	bumped: {
		any: [ 'Whoa!', 'Steady on!' ],
		friendly: [ 'Whoa, steady!', 'Oops, nearly went over!' ],
		grumpy: [ "Oi! Watch where you're going!", 'Hey! Look out!' ],
		shy: [ 'Oh!' ],
		larrikin: [ 'Whoa! Nearly had me!', 'Ha! Steady on, mate!' ],
		elderly: [ 'Oh my! Careful!' ],
	},
	fell: {
		any: [ 'Oof!', 'Whoa!' ],
		grumpy: [ 'Oh, for crying out loud!' ],
		larrikin: [ 'Whoops-a-daisy!' ],
		elderly: [ 'Oh dear, oh dear.' ],
	},
	getup: {
		any: [ "I'm right. No harm done.", 'Watch it next time.' ],
		friendly: [ "Ha, I'm OK! No worries.", 'All good, all good.' ],
		grumpy: [ 'Unbelievable.', "Watch where you're going, mate!", 'Some people...' ],
		shy: [ "I'm fine... I'm fine.", 'Oh... OK.' ],
		larrikin: [ 'Ha! Ten points for style!', 'Nailed the landing!' ],
		elderly: [ 'Oh, my old bones.', 'In my day we said sorry.' ],
	},
	spill: {
		any: [ 'My coffee!', 'Aw, my coffee.' ],
		grumpy: [ 'That was a fresh coffee!' ],
		larrikin: [ 'Ha! Coffee on the floor!' ],
	},
	flinch: {
		any: [ 'Whoa, careful!', 'Hey!' ],
		grumpy: [ 'Do you mind?', 'Watch it!' ],
		shy: [ 'Oh!' ],
		larrikin: [ 'Oi, easy!' ],
		elderly: [ 'Goodness me!' ],
	},
	oi: {
		any: [ 'Oi!', 'Whoa!' ],
		grumpy: [ 'Oi! Watch it!' ],
		larrikin: [ 'Whoa! Ha, missed me!' ],
		elderly: [ 'Oh my word!' ],
		shy: [ 'Eek!' ],
	},
	dunked: {
		any: [ 'Oi!', 'Ya drongo!', 'Cold! Cold! Cold!' ],
		grumpy: [ 'Oi! Ya drongo!', 'Oh, you absolute galah!' ],
		larrikin: [ 'Cowabunga!', 'Water was lovely, thanks!' ],
		elderly: [ 'Oh my word! Cold!' ],
		shy: [ 'Oh! Oh, it is cold.' ],
	},
	ashore: {
		any: [ 'Well, that woke me up.', 'Dripping wet. Thanks, mate.' ],
		grumpy: [ 'Unbelievable. Soaked.' ],
		larrikin: [ 'Ten out of ten, would swim again!' ],
	},
	'oi-after': {
		any: [ 'Oi! Slow down!', 'Car park, mate! Slow down!' ],
		grumpy: [ 'Learn to drive!', 'Oi! Slow down!' ],
		larrikin: [ 'Ha! Too slow!', 'Missed me by a mile!' ],
		elderly: [ 'Young people these days!' ],
	},
	wary: {
		any: [ "Oh, it's you again.", 'Keep your distance, mate.' ],
		grumpy: [ 'Not you again.', 'Stay over there.' ],
		shy: [ 'Um... hi.' ],
	},
};

// A line for `key` in `type`'s voice, not one of `recent` (the person's last few) where it can help.
export function line( key, type, recent = [] ) {

	const set = LINES[ key ];
	if ( ! set ) return null;
	const pool = set[ type ] || set.any;
	const fresh = pool.filter( l => ! recent.includes( l ) );
	const from = fresh.length ? fresh : pool;
	return from[ Math.floor( Math.random() * from.length ) ];

}
