import { FISH, fishValue, fishLengthCm } from './FishTable.js';
import { defaultUpgrades, gearStats, nextLevel, UPGRADES, FUEL_PRICE } from './Gear.js';
import { SOUVENIR_BY_ID } from './Souvenirs.js';

const SAVE_KEY = 'tidewater.save.v1';
// pocket money he starts with (a jetski hire is $20); saves from before it get it once (the `purse` flag)
export const STARTING_MONEY = 80;
// his savings account (the ATMs in Atm.js); saves from before it get the opening balance once (the `bank` field)
export const STARTING_BANK = 1000;
// the most the ATMs pay out in one game day
export const DAILY_LIMIT = 1000;

// Can an ATM pay `amount` out? Whole dollars, at least $20, in $20 and $50 notes (so $10, $30 and odd
// amounts are out). Returns null when it can, else the reason: 'invalid', 'min', 'multiple' or 'notes'.
export function checkNotes( amount ) {

	if ( typeof amount !== 'number' || ! Number.isInteger( amount ) || amount <= 0 ) return 'invalid';
	if ( amount < 20 ) return 'min';
	if ( amount % 10 !== 0 ) return 'multiple';
	for ( let fifties = Math.floor( amount / 50 ); fifties >= 0; fifties -- ) if ( ( amount - fifties * 50 ) % 20 === 0 ) return null;
	return 'notes';

}

// the bank card's 4 digit PIN: random per game and kept in the save. Weak PINs are drawn again: a digit
// used three or more times (0000, 1112) and straight runs up or down (1234, 9876).
export function isWeakPin( pin ) {

	const d = [ ...pin ].map( Number ), count = new Map();
	for ( const x of d ) count.set( x, ( count.get( x ) || 0 ) + 1 );
	if ( Math.max( ...count.values() ) >= 3 ) return true;
	const step = d[ 1 ] - d[ 0 ];
	return Math.abs( step ) === 1 && d.every( ( x, i ) => i === 0 || x - d[ i - 1 ] === step );

}

export const isPin = ( pin ) => typeof pin === 'string' && /^[0-9]{4}$/.test( pin ) && ! isWeakPin( pin );

export function randomPin( random = Math.random ) {

	for ( ;; ) {

		const pin = String( Math.floor( random() * 10000 ) ).padStart( 4, '0' );
		if ( isPin( pin ) ) return pin;

	}

}

const dollars = ( n ) => `$${ Math.max( 0, n ).toLocaleString( 'en-AU' ) }`;

// what the ATM screen says for each refusal (`info`: { bank, left } at the time)
export function withdrawMessage( reason, amount, info = {} ) {

	switch ( reason ) {

		case 'min': return 'Minimum withdrawal is $20';
		case 'multiple': return 'Amount must be a multiple of $10';
		case 'notes': return `Unable to dispense ${ dollars( amount ) }. Notes available: $20 and $50`;
		case 'funds': return `Insufficient funds. Available balance ${ dollars( info.bank ?? 0 ) }`;
		case 'limit': return `Exceeds your daily limit of ${ dollars( DAILY_LIMIT ) }. ${ dollars( info.left ?? 0 ) } left today`;
		default: return 'Please enter an amount in whole dollars';

	}

}

// Everything the player owns: wallet, the fish in the cooler / hold, the fish log and the gear
// levels. Saved to localStorage (per browser) after every change; storage can be missing or throw
// (private windows, blocked site data), so every access is guarded and the game runs without it.
export class GameState {

	constructor( storage = safeStorage() ) {

		this.storage = storage;
		this.money = STARTING_MONEY;
		this.bank = STARTING_BANK;
		this.pin = randomPin(); // the ATM card's PIN (the HUD shows it)
		// taken out of the bank on game day `day` (kept for the session only; Game counts the days)
		this.withdrawn = { day: 0, total: 0 };
		this.inventory = []; // { id, species, kg, cm, value, caughtAt (game hours), record }
		this.log = {}; // species -> { count, bestKg, bestCm }
		// the last addFish: { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept } (the catch card)
		this.lastCatch = null;
		this.upgrades = defaultUpgrades();
		this.fuel = null; // litres left (null = full tank)
		this.souvenirs = []; // souvenir ids (Souvenirs.js), in the order bought
		this._nextId = 1;
		this.listeners = new Set();

	}

	get stats() {

		return gearStats( this.upgrades );

	}

	get holdKg() {

		let kg = 0;
		for ( const f of this.inventory ) kg += f.kg;
		return kg;

	}

	get holdValue() {

		let v = 0;
		for ( const f of this.inventory ) v += f.value;
		return v;

	}

	// room in the cooler / hold for a fish of `kg`?
	fits( kg ) {

		return this.holdKg + kg <= this.stats.holdKg + 1e-6;

	}

	// store a caught fish; returns the entry, or null when the hold is full (it is logged either way).
	// A record beats an earlier catch of the species; the first one of a species is a new species.
	addFish( species, kg, timeOfDay = 12 ) {

		kg = Math.round( kg * 100 ) / 100;
		const cm = Math.round( fishLengthCm( species, kg ) );
		const logEntry = this.log[ species ] || ( this.log[ species ] = { count: 0, bestKg: 0 } );
		const newSpecies = logEntry.count === 0;
		const prevBestKg = logEntry.bestKg, prevBestCm = logEntry.bestCm ?? ( prevBestKg > 0 ? Math.round( fishLengthCm( species, prevBestKg ) ) : 0 );
		const record = ! newSpecies && kg > prevBestKg;
		logEntry.count ++;
		if ( kg > prevBestKg ) {

			logEntry.bestKg = kg;
			logEntry.bestCm = cm;

		}

		const value = fishValue( species, kg );
		const kept = this.fits( kg );
		this.lastCatch = { species, kg, cm, value, newSpecies, record, prevBestKg, prevBestCm, kept };
		if ( ! kept ) {

			this.save();
			this.emit();
			return null;

		}

		const f = { id: this._nextId ++, species, kg, cm, value, caughtAt: timeOfDay, record };
		this.inventory.push( f );
		this.save();
		this.emit();
		return f;

	}

	// sell the given fish ids (all when omitted); returns the money made
	sell( ids = null ) {

		const keep = [], sold = [];
		for ( const f of this.inventory ) ( ids === null || ids.includes( f.id ) ? sold : keep ).push( f );
		let total = 0;
		for ( const f of sold ) total += f.value;
		this.inventory = keep;
		this.money += total;
		this.save();
		this.emit();
		return { total, count: sold.length };

	}

	release( id ) {

		this.inventory = this.inventory.filter( ( f ) => f.id !== id );
		this.save();
		this.emit();

	}

	// spend money (upgrade shop); false when it can't be afforded
	spend( amount ) {

		if ( amount > this.money ) return false;
		this.money -= amount;
		this.save();
		this.emit();
		return true;

	}

	balance() {

		return this.bank;

	}

	// how much more the ATMs will pay out on game day `day`
	leftToday( day = 0 ) {

		return DAILY_LIMIT - ( this.withdrawn.day === day ? this.withdrawn.total : 0 );

	}

	// take cash out at an ATM on game day `day`: bank to pocket. Returns { ok, reason, amount }, where the
	// reason is checkNotes' or 'funds' (more than the balance) or 'limit' (past the daily limit)
	withdraw( amount, day = 0 ) {

		const bad = checkNotes( amount );
		if ( bad ) return { ok: false, reason: bad, amount };
		if ( amount > this.bank ) return { ok: false, reason: 'funds', amount };
		if ( amount > this.leftToday( day ) ) return { ok: false, reason: 'limit', amount };
		if ( this.withdrawn.day !== day ) this.withdrawn = { day, total: 0 };
		this.withdrawn.total += amount;
		this.bank -= amount;
		this.money += amount;
		this.save();
		this.emit();
		return { ok: true, reason: null, amount };

	}

	// buy a souvenir at the gift shop; returns the item, or null when unknown or unaffordable
	buySouvenir( id ) {

		const item = SOUVENIR_BY_ID[ id ];
		if ( ! item || item.price > this.money ) return null;
		this.money -= item.price;
		this.souvenirs.push( id );
		this.save();
		this.emit();
		return item;

	}

	// buy the next level of an upgrade track; returns the new level entry or null
	buy( key ) {

		if ( ! UPGRADES[ key ] ) return null;
		const next = nextLevel( this.upgrades, key );
		if ( ! next || next.cost > this.money ) return null;
		this.money -= next.cost;
		this.upgrades[ key ] = next.index;
		if ( key === 'fuel' ) this.fuel = null; // a new tank comes full
		this.save();
		this.emit();
		return next;

	}

	get fuelL() {

		return this.fuel === null ? this.stats.fuelL : Math.min( this.fuel, this.stats.fuelL );

	}

	// burn litres (no save: that happens when the boat stops or at the next sale / purchase)
	burn( litres ) {

		this.fuel = Math.max( 0, this.fuelL - litres );
		return this.fuel;

	}

	refuelCost() {

		return Math.ceil( ( this.stats.fuelL - this.fuelL ) * FUEL_PRICE );

	}

	// fill up as far as the money goes; returns litres bought
	refuel() {

		const missing = this.stats.fuelL - this.fuelL;
		const litres = Math.min( missing, Math.floor( this.money / FUEL_PRICE ) );
		if ( litres <= 0 ) return 0;
		this.money -= Math.ceil( litres * FUEL_PRICE );
		this.fuel = this.fuelL + litres;
		if ( this.fuel >= this.stats.fuelL - 1e-3 ) this.fuel = null;
		this.save();
		this.emit();
		return litres;

	}

	onChange( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	emit() {

		for ( const fn of this.listeners ) fn( this );

	}

	toJSON() {

		return { v: 1, purse: true, money: this.money, bank: this.bank, pin: this.pin, inventory: this.inventory, log: this.log, upgrades: this.upgrades, fuel: this.fuel, souvenirs: this.souvenirs, nextId: this._nextId };

	}

	fromJSON( d ) {

		if ( ! d || d.v !== 1 ) return false;
		this.money = ( Number.isFinite( d.money ) ? d.money : 0 ) + ( d.purse ? 0 : STARTING_MONEY );
		this.bank = Number.isFinite( d.bank ) ? d.bank : STARTING_BANK;
		// a save without a PIN gets a new random one (load() saves it straight away)
		this.pinMinted = ! isPin( d.pin );
		this.pin = this.pinMinted ? randomPin() : d.pin;
		this.inventory = Array.isArray( d.inventory ) ? d.inventory.filter( ( f ) => f && FISH[ f.species ] && Number.isFinite( f.kg ) ) : [];
		// saves from before lengths were recorded
		for ( const f of this.inventory ) if ( ! Number.isFinite( f.cm ) ) f.cm = Math.round( fishLengthCm( f.species, f.kg ) );
		this.log = d.log && typeof d.log === 'object' ? d.log : {};
		for ( const [ k, v ] of Object.entries( this.log ) ) if ( FISH[ k ] && v && v.bestKg > 0 && ! Number.isFinite( v.bestCm ) ) v.bestCm = Math.round( fishLengthCm( k, v.bestKg ) );
		this.upgrades = { ...defaultUpgrades(), ...( d.upgrades || {} ) };
		this.fuel = Number.isFinite( d.fuel ) ? d.fuel : null;
		this.souvenirs = Array.isArray( d.souvenirs ) ? d.souvenirs.filter( ( id ) => SOUVENIR_BY_ID[ id ] ) : [];
		this._nextId = Math.max( d.nextId | 0, ...this.inventory.map( ( f ) => f.id + 1 ), 1 );
		return true;

	}

	save() {

		if ( ! this.storage ) return;
		try {

			this.storage.setItem( SAVE_KEY, JSON.stringify( this.toJSON() ) );

		} catch ( e ) { /* storage full or blocked: keep playing */ }

	}

	load() {

		if ( ! this.storage ) return false;
		try {

			const raw = this.storage.getItem( SAVE_KEY );
			const ok = raw ? this.fromJSON( JSON.parse( raw ) ) : false;
			if ( ok && this.pinMinted ) this.save();
			return ok;

		} catch ( e ) {

			return false;

		}

	}

	reset() {

		this.money = STARTING_MONEY;
		this.bank = STARTING_BANK;
		this.pin = randomPin();
		this.withdrawn = { day: 0, total: 0 };
		this.inventory = [];
		this.log = {};
		this.upgrades = defaultUpgrades();
		this.fuel = null;
		this.souvenirs = [];
		this.save();
		this.emit();

	}

}

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}
