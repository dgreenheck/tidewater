import { Vector3 } from '../engine/index.js';
import { sunDirectionFromTime } from './Sky.js';

// The game clock. `rate` (settings.timeSpeed) is game hours per real second through daylight, dawn and
// dusk; once the sun is well below the horizon (deep night, past the twilight glow) the clock runs
// NIGHT_X times faster, so the evening colours linger and the dark hours pass quickly.
// At DAY_RATE the sun is up for about 50 real minutes, each twilight lasts about 3 minutes and deep
// night about 8 (test/day-clock.mjs measures it).
export const DAY_RATE = 0.0042; // game hours per real second in daylight
export const NIGHT_X = 5;
export const START_HOUR = 9.5; // a new session starts mid-morning

// sun height (sin of its elevation) where deep night starts and where it is fully fast
const DEEP_FROM = 0.2, DEEP_TO = 0.34;
const _sun = new Vector3();

// how many times faster than `rate` the clock runs at `hour`: 1 by day and in twilight, NIGHT_X in deep night
export function clockFactor( hour ) {

	const below = - sunDirectionFromTime( hour, undefined, undefined, _sun ).y;
	const t = Math.min( 1, Math.max( 0, ( below - DEEP_FROM ) / ( DEEP_TO - DEEP_FROM ) ) );
	return 1 + ( NIGHT_X - 1 ) * t * t * ( 3 - 2 * t );

}

// the hour after `dt` real seconds at `rate` game hours per real second (0 holds the clock)
export function advanceClock( hour, rate, dt ) {

	if ( ! rate ) return hour;
	return ( hour + dt * rate * clockFactor( hour ) + 24 ) % 24;

}
