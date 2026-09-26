// Gear and upgrade data. The upgrade shop (a vendor by the boathouse) is not built yet; everything
// the game reads goes through gearStats( state.upgrades ), so buying a level is just
// state.upgrades[ key ]++ and the stats follow.
//
// Each track: levels[ 0 ] is what you start with; cost is the price of that level (0 for the first).
import { t } from '../i18n/index.js';

export const UPGRADES = {
	// rod and reel
	line: {
		get name() { return t( 'gear.line.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.line.0' ); }, lineKg: 7 },
			{ cost: 60, get label() { return t( 'gear.line.1' ); }, lineKg: 13 },
			{ cost: 180, get label() { return t( 'gear.line.2' ); }, lineKg: 26 },
			{ cost: 450, get label() { return t( 'gear.line.3' ); }, lineKg: 50 },
		],
	},
	reel: {
		get name() { return t( 'gear.reel.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.reel.0' ); }, reelSpeed: 1.1 },
			{ cost: 90, get label() { return t( 'gear.reel.1' ); }, reelSpeed: 1.6 },
			{ cost: 320, get label() { return t( 'gear.reel.2' ); }, reelSpeed: 2.2 },
		],
	},
	rod: {
		get name() { return t( 'gear.rod.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.rod.0' ); }, castM: 22 },
			{ cost: 75, get label() { return t( 'gear.rod.1' ); }, castM: 32 },
			{ cost: 260, get label() { return t( 'gear.rod.2' ); }, castM: 45 },
		],
	},
	// boat
	hold: {
		get name() { return t( 'gear.hold.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.hold.0' ); }, holdKg: 30 },
			{ cost: 120, get label() { return t( 'gear.hold.1' ); }, holdKg: 70 },
			{ cost: 400, get label() { return t( 'gear.hold.2' ); }, holdKg: 160 },
		],
	},
	fuel: {
		get name() { return t( 'gear.fuel.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.fuel.0' ); }, fuelL: 40 },
			{ cost: 150, get label() { return t( 'gear.fuel.1' ); }, fuelL: 80 },
			{ cost: 380, get label() { return t( 'gear.fuel.2' ); }, fuelL: 150 },
		],
	},
	engine: {
		get name() { return t( 'gear.engine.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.engine.0' ); }, speedMul: 1 },
			{ cost: 300, get label() { return t( 'gear.engine.1' ); }, speedMul: 1.15 },
			{ cost: 700, get label() { return t( 'gear.engine.2' ); }, speedMul: 1.3 },
		],
	},
	fishFinder: {
		get name() { return t( 'gear.fishFinder.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.fishFinder.0' ); }, finder: false },
			{ cost: 250, get label() { return t( 'gear.fishFinder.1' ); }, finder: true },
		],
	},
	lights: {
		get name() { return t( 'gear.lights.name' ); },
		levels: [
			{ cost: 0, get label() { return t( 'gear.lights.0' ); }, deckLights: false },
			{ cost: 140, get label() { return t( 'gear.lights.1' ); }, deckLights: true },
		],
	},
};

export const FUEL_PRICE = 1.5; // $ per litre of diesel at the chandlery
// litres per second at the helm: idle plus a lot more at full rpm (40 L lasts ~25 min flat out)
export function fuelBurn( rpm ) {

	return 0.0025 + 0.024 * rpm * rpm;

}

// next level of a track, or null when maxed
export function nextLevel( upgrades, key ) {

	const lv = UPGRADES[ key ].levels;
	const i = ( upgrades[ key ] | 0 ) + 1;
	return i < lv.length ? { index: i, ...lv[ i ] } : null;

}

export function defaultUpgrades() {

	const u = {};
	for ( const k in UPGRADES ) u[ k ] = 0;
	return u;

}

// merged stats of the current levels
export function gearStats( upgrades ) {

	const s = {};
	for ( const k in UPGRADES ) {

		const lv = UPGRADES[ k ].levels;
		const i = Math.max( 0, Math.min( lv.length - 1, upgrades[ k ] | 0 ) );
		for ( const [ key, v ] of Object.entries( lv[ i ] ) ) if ( key !== 'cost' && key !== 'label' ) s[ key ] = v;

	}

	return s;

}
