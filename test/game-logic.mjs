// Plain-node tests of the fishing game logic (no GPU): bites, the catch fight, inventory, save.
import { FISH, FISH_IDS, fishValue, fishLengthCm } from '../src/game/FishTable.js';
import { habitatAt, pickSpecies, rollWeight, biteDelay } from '../src/game/Bites.js';
import { CatchMinigame } from '../src/game/CatchMinigame.js';
import { GameState, STARTING_MONEY, STARTING_BANK, DAILY_LIMIT, withdrawMessage, randomPin, isPin, isWeakPin } from '../src/game/GameState.js';
import { gearStats, defaultUpgrades, UPGRADES } from '../src/game/Gear.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
let seed = 12345;
const rng = () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

// ---- habitats and species
const spots = {
	sand: { depth: 0, reefDist: 200, pierDist: 200 },
	shallows: { depth: 1.5, reefDist: 200, pierDist: 80 },
	pier: { depth: 4, reefDist: 150, pierDist: 1 },
	reef: { depth: 5, reefDist: - 10, pierDist: 150 },
	deep: { depth: 40, reefDist: 300, pierDist: 400 },
};
for ( const [ name, s ] of Object.entries( spots ) ) {

	const h = habitatAt( s );
	const counts = {};
	for ( let i = 0; i < 2000; i ++ ) {

		const id = pickSpecies( h, 12, rng );
		if ( id ) counts[ id ] = ( counts[ id ] || 0 ) + 1;

	}

	const top = Object.entries( counts ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 5 ).map( ( [ k, v ] ) => `${ k } ${ ( v / 20 ).toFixed( 0 ) }%` ).join( ', ' );
	console.log( `     ${ name }: delay ~${ biteDelay( h, 12, () => 0.5 ).toFixed( 1 ) } s; ${ top || 'nothing' }` );

}
ok( pickSpecies( habitatAt( spots.sand ), 12, rng ) === null, 'nothing bites on dry sand' );
ok( biteDelay( habitatAt( spots.sand ), 12, rng ) === Infinity, 'no bite delay on sand' );
{

	let deepOnly = 0;
	for ( let i = 0; i < 500; i ++ ) if ( [ 'tuna', 'mahi', 'redSnapper', 'grouper', 'barracuda' ].includes( pickSpecies( habitatAt( spots.deep ), 12, rng ) ) ) deepOnly ++;
	ok( deepOnly === 500, 'deep water gives offshore species only' );
	let reefFish = 0;
	for ( let i = 0; i < 500; i ++ ) if ( FISH[ pickSpecies( habitatAt( spots.reef ), 12, rng ) ].habitat.reef ) reefFish ++;
	ok( reefFish > 400, `the reef gives mostly reef fish (${ reefFish / 5 }%)` );

}
{

	let tarponNight = 0, tarponDay = 0;
	for ( let i = 0; i < 4000; i ++ ) {

		if ( pickSpecies( habitatAt( spots.pier ), 22, rng ) === 'tarpon' ) tarponNight ++;
		if ( pickSpecies( habitatAt( spots.pier ), 12, rng ) === 'tarpon' ) tarponDay ++;

	}

	ok( tarponNight > tarponDay * 2, `tarpon bite at night (${ tarponNight } vs ${ tarponDay } by day)` );

}
for ( const id of FISH_IDS ) {

	const w = rollWeight( id, rng );
	if ( w < FISH[ id ].kg[ 0 ] || w > FISH[ id ].kg[ 1 ] ) ok( false, `weight in range for ${ id }` );

}
ok( fishValue( 'redSnapper', 5 ) > fishValue( 'redSnapper', 2 ), 'bigger fish is worth more' );

// ---- the fight: three players
const policies = {
	careful: ( g ) => g.tension < 0.68 && g.surge < 0.6,
	mash: () => true,
	idle: () => false,
};
const fight = ( species, kg, policy, lineKg = 7, reelSpeed = 1.1 ) => {

	const g = new CatchMinigame( { species, kg, lineKg, reelSpeed, distance: 18, rng } );
	let st = 'fighting';
	for ( let i = 0; i < 60 * 180 && st === 'fighting'; i ++ ) st = g.update( 1 / 60, policy( g ) );
	return { st, t: g.time };

};
const table = {};
for ( const [ species, kg ] of [ [ 'grunt', 0.8 ], [ 'yellowtail', 1.2 ], [ 'jack', 6 ], [ 'redSnapper', 5 ], [ 'tuna', 6 ], [ 'tuna', 13 ], [ 'tarpon', 35 ] ] ) {

	for ( const p of Object.keys( policies ) ) {

		const r = fight( species, kg, policies[ p ] );
		table[ `${ species }/${ p }` ] = r;
		console.log( `     ${ species } ${ kg } kg, ${ p }: ${ r.st } after ${ r.t.toFixed( 1 ) } s` );

	}

}
ok( table[ 'grunt/careful' ].st === 'caught' && table[ 'yellowtail/careful' ].st === 'caught', 'careful reeling lands small fish' );
ok( table[ 'jack/careful' ].st === 'caught', 'careful reeling lands a 6 kg jack on the starter line' );
ok( table[ 'tuna/mash' ].st === 'snapped' && table[ 'tarpon/mash' ].st === 'snapped', 'holding reel on a big fish snaps the line' );
ok( table[ 'tuna/careful' ].st !== 'caught' && fight( 'tuna', 13, policies.careful, 26, 1.6 ).st === 'caught', 'a 13 kg tuna needs the 30 lb line' );
ok( [ 'escaped' ].includes( table[ 'grunt/idle' ].st ), 'never reeling loses the fish' );
ok( fight( 'tarpon', 35, policies.careful ).st !== 'caught', 'a 35 kg tarpon beats the starter line' );
ok( fight( 'tarpon', 35, policies.careful, 50, 2.2 ).st === 'caught', 'the top line and reel land it' );

// ---- inventory, wallet, save round trip
const mem = new Map();
const storage = { getItem: ( k ) => mem.get( k ) ?? null, setItem: ( k, v ) => mem.set( k, v ) };
const s = new GameState( storage );
ok( s.stats.holdKg === 30, 'cooler holds 30 kg' );
ok( s.money === 80 && STARTING_MONEY === 80, 'a new game starts with $80 in his pocket' );
const a = s.addFish( 'grunt', 0.84, 9.5 );
const b = s.addFish( 'yellowtail', 1.31, 10 );
ok( a && b && s.inventory.length === 2, 'fish go into the cooler' );
ok( s.addFish( 'tarpon', 40, 22 ) === null && s.log.tarpon.count === 1, 'a fish too big for the hold is logged but not kept' );
const value = s.holdValue;
const sale = s.sell( [ a.id ] );
ok( sale.count === 1 && s.money === STARTING_MONEY + a.value && s.inventory.length === 1, 'selling one fish pays for it' );
s.upgrades.hold = 1;
const s2 = new GameState( storage );
s.save();
ok( s2.load() && s2.money === s.money && s2.inventory.length === 1 && s2.log.grunt.bestKg === 0.84 && s2.stats.holdKg === 70, 'save / load round trip' );
ok( s2.addFish( 'grunt', 0.5 ).id > b.id, 'ids keep counting after a load' );
// ---- lengths and the catch card's record logic
{

	let sane = true;
	for ( const id of FISH_IDS ) {

		const f = FISH[ id ];
		const lo = fishLengthCm( id, f.kg[ 0 ] ), hi = fishLengthCm( id, f.kg[ 1 ] );
		if ( ! ( lo > 5 && hi < 200 && hi > lo && typeof f.sci === 'string' ) ) sane = false;

	}

	ok( sane, 'every species has a scientific name and a plausible, increasing length (5–200 cm)' );
	ok( Math.abs( fishLengthCm( 'mahi', 10 ) - 108 ) < 3 && Math.abs( fishLengthCm( 'grunt', 0.84 ) - 36 ) < 2, 'length-weight: a 10 kg mahi ~108 cm, a 0.84 kg grunt ~36 cm' );
	const m = new Map();
	const st = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	const c1 = st.addFish( 'jack', 3.2 ), i1 = st.lastCatch;
	ok( c1 && i1.newSpecies && ! i1.record && c1.cm === i1.cm && i1.cm > 50, 'first of a species: new species, not a record, length stored' );
	st.addFish( 'jack', 2.1 );
	const i2 = st.lastCatch;
	ok( ! i2.newSpecies && ! i2.record && i2.prevBestKg === 3.2 && st.log.jack.bestKg === 3.2, 'a smaller one: no record, best unchanged' );
	st.addFish( 'jack', 4.05 );
	const i3 = st.lastCatch;
	ok( i3.record && i3.prevBestKg === 3.2 && i3.prevBestCm === i1.cm && st.log.jack.bestKg === 4.05 && st.log.jack.bestCm === i3.cm, 'a bigger one: new record, previous best reported, log updated' );
	st.addFish( 'tarpon', 40 );
	ok( st.lastCatch.kept === false && st.lastCatch.newSpecies, 'a fish that does not fit: logged, card says released' );
	// a save from before lengths: inventory and log get lengths on load
	const old = { v: 1, money: 5, inventory: [ { id: 1, species: 'grunt', kg: 0.84, value: 6, caughtAt: 9 } ], log: { grunt: { count: 1, bestKg: 0.84 } }, upgrades: {}, fuel: null, nextId: 2 };
	const st2 = new GameState( { getItem: () => JSON.stringify( old ), setItem: () => {} } );
	ok( st2.load() && st2.inventory[ 0 ].cm === 36 && st2.log.grunt.bestCm === 36, 'old saves load with lengths filled in' );
	ok( st2.money === 5 + STARTING_MONEY, 'a save from before the starting purse gets the $80 once' );
	const again = new GameState( { getItem: () => JSON.stringify( st2.toJSON() ), setItem: () => {} } );
	ok( again.load() && again.money === st2.money, 'the starting purse is only paid once' );
	st2.reset();
	ok( st2.money === STARTING_MONEY, 'a reset starts again with $80' );

}
ok( new GameState( { getItem: () => { throw new Error( 'blocked' ); }, setItem: () => { throw new Error( 'blocked' ); } } ).load() === false, 'blocked storage does not throw' );
ok( s.spend( 1e9 ) === false, 'cannot spend more than you have' );
ok( Object.keys( defaultUpgrades() ).length === Object.keys( UPGRADES ).length && gearStats( defaultUpgrades() ).finder === false, 'gear stats' );
{

	const m = new Map();
	const st = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	st.money = 100;
	ok( st.buy( 'reel' ) && st.upgrades.reel === 1 && st.money === 10 && st.stats.reelSpeed === 1.6, 'buying the reel upgrade' );
	ok( st.buy( 'reel' ) === null && st.upgrades.reel === 1, 'cannot buy what you cannot afford' );
	ok( st.fuelL === 40 && st.burn( 30 ) === 10 && st.refuelCost() === 45, 'fuel burns and costs to refill' );
	st.money = 20;
	ok( st.refuel() === 13 && st.money === 0 && Math.abs( st.fuelL - 23 ) < 1e-6, 'refuel stops when the money runs out' );
	st.money = 1000;
	ok( st.buy( 'fuel' ) && st.fuelL === 80, 'a new tank comes full' );
	ok( st.buy( 'fishFinder' ) && st.stats.finder === true && st.buy( 'fishFinder' ) === null, 'fish finder: one level' );

}
{

	// souvenirs from the Joey Island gift shop: bought with money, kept in the save
	const m = new Map();
	const st = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	st.money = 30;
	ok( st.buySouvenir( 'stubby' ) && st.money === 18 && st.souvenirs.join() === 'stubby', 'buying a souvenir takes its price and keeps it' );
	ok( st.buySouvenir( 'plushjoey' ) === null && st.money === 18, 'cannot buy a souvenir you cannot afford' );
	ok( st.buySouvenir( 'nope' ) === null, 'unknown souvenirs are not sold' );
	const st2 = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: () => {} } );
	ok( st2.load() && st2.souvenirs.join() === 'stubby' && st2.money === 18, 'souvenirs persist in the save' );
	st2.reset();
	ok( st2.souvenirs.length === 0, 'reset clears souvenirs' );

}
{

	// the bank account behind the ATM: $1,000 to start, notes of $20 and $50, a $1,000 daily limit
	const m = new Map();
	const store = { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) };
	const st = new GameState( store );
	ok( STARTING_BANK === 1000 && DAILY_LIMIT === 1000 && st.bank === 1000 && st.balance() === 1000, 'a new game has $1,000 in the bank' );
	let changes = 0;
	st.onChange( () => changes ++ );
	const w = st.withdraw( 100 );
	ok( w.ok && st.money === STARTING_MONEY + 100 && st.bank === 900 && changes === 1, 'withdrawing $100 moves it from the bank to his pocket' );
	ok( JSON.parse( m.get( 'tidewater.save.v1' ) ).bank === 900, 'a withdrawal is saved' );
	const before = [ st.money, st.bank ];
	const r = ( a ) => st.withdraw( a ).reason;
	ok( r( 30 ) === 'notes' && r( 10 ) === 'min' && r( 15 ) === 'min' && r( 25 ) === 'multiple' && r( 105 ) === 'multiple', '$30 cannot be made from 20s and 50s; under $20 and odd amounts are refused' );
	ok( r( 0 ) === 'invalid' && r( - 20 ) === 'invalid' && r( 20.5 ) === 'invalid' && r( NaN ) === 'invalid' && r( '40' ) === 'invalid', 'only whole positive dollars' );
	ok( st.money === before[ 0 ] && st.bank === before[ 1 ], 'a refused withdrawal changes nothing' );
	ok( st.withdraw( 70 ).ok && st.withdraw( 20 ).ok && st.withdraw( 90 ).ok && st.withdraw( 50 ).ok && st.bank === 670, '$20, $50, $70 and $90 can all be paid out' );
	ok( r( 700 ) === 'funds' && st.bank === 670, 'cannot take out more than the balance' );
	st.bank = 5000;
	ok( r( 1000 ) === 'limit' && st.withdraw( 670 ).ok && r( 20 ) === 'limit', 'the daily limit counts everything taken out today' );
	ok( st.withdraw( 1000, 1 ).ok && st.withdraw( 20, 1 ).reason === 'limit', 'a new game day brings a new daily limit' );
	ok( withdrawMessage( 'notes', 30 ) === 'Unable to dispense $30. Notes available: $20 and $50' &&
		withdrawMessage( 'multiple', 25 ) === 'Amount must be a multiple of $10' &&
		withdrawMessage( 'funds', 700, { bank: 670 } ) === 'Insufficient funds. Available balance $670' &&
		withdrawMessage( 'limit', 20, { left: 0 } ) === 'Exceeds your daily limit of $1,000. $0 left today' &&
		withdrawMessage( 'min', 10 ) === 'Minimum withdrawal is $20', 'each refusal has its own message' );
	const again = new GameState( store );
	ok( again.load() && again.bank === st.bank && again.money === st.money, 'the bank balance persists in the save' );
	again.reset();
	ok( again.bank === STARTING_BANK, 'a reset puts $1,000 back in the bank' );
	const old = new Map( [ [ 'tidewater.save.v1', JSON.stringify( { v: 1, purse: true, money: 12, inventory: [], log: {} } ) ] ] );
	const s3 = new GameState( { getItem: ( k ) => old.get( k ) ?? null, setItem: ( k, v ) => old.set( k, v ) } );
	ok( s3.load() && s3.bank === 1000 && s3.money === 12, 'a save from before the bank gets $1,000 once' );
	s3.withdraw( 200 );
	const s4 = new GameState( { getItem: ( k ) => old.get( k ) ?? null, setItem: () => {} } );
	ok( s4.load() && s4.bank === 800 && s4.money === 212, 'the opening balance is only paid once' );
	// the card PIN: random per game, 4 digits, never a weak one, kept in the save
	const m0 = new Map(), g0 = new GameState( { getItem: ( k ) => m0.get( k ) ?? null, setItem: ( k, v ) => m0.set( k, v ) } );
	g0.withdraw( 20 );
	ok( isPin( g0.pin ) && JSON.parse( m0.get( 'tidewater.save.v1' ) ).pin === g0.pin, 'a new game has a random 4 digit PIN, saved with the game' );
	ok( [ '0000', '7777', '1112', '1234', '9876', '0123', '3210' ].every( isWeakPin ) && ! isWeakPin( '7291' ) && ! isWeakPin( '1357' ), 'repeated digits and straight runs are weak' );
	const pins = new Set();
	for ( let i = 0; i < 400; i ++ ) pins.add( randomPin() );
	ok( pins.size > 300 && [ ...pins ].every( isPin ), 'PINs vary from game to game and are never weak' );
	const seq = [ 0.1234, 0.0000, 0.5555, 0.7291 ];
	ok( randomPin( () => seq.shift() ) === '7291', 'a weak draw is drawn again' );
	const again2 = new GameState( store );
	ok( again2.load() && again2.pin === again.pin, 'the PIN persists in the save' );
	ok( s3.pin && isPin( s3.pin ) && JSON.parse( old.get( 'tidewater.save.v1' ) ).pin === s3.pin, 'a save without a PIN gets a new random one, saved straight away' );
	ok( s4.pin === s3.pin, 'and keeps it on the next load' );
	const before2 = again2.pin;
	let fresh = 0;
	for ( let i = 0; i < 5; i ++ ) { again2.reset(); if ( again2.pin !== before2 ) fresh ++; }
	ok( fresh >= 4 && isPin( again2.pin ), 'a new game draws a new PIN' );

}
console.log( `value check ${ value }` );
console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );
