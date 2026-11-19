// Rocket booster roar for the jetski's rocket pod (src/jetski, SoundScape jetski bed, layered on the engine).
// Source: Freesound 515123 "Rocket Thrust 01" by LilMati, CC0 1.0 (https://freesound.org/s/515123/).
// A real recording: nothing here is synthesised. The mixer fades it in while the pod burns.
//
//   node dl.mjs 515123:LilMati      # -> raw/515123.ogg (+ licence json: CC0)
//   node build-rocket.mjs           # -> out/rocket_roar.ogg + rocket-bank.json
//   cp out/rocket_roar.ogg ../../public/audio/   # then copy the entry into src/audio/soundBank.js
//
// The loop is the steadiest loud 3.6 s stretch of the burn (picked by its RMS level: loud, and the
// least variation), equal-power crossfaded at the wrap, loudness-normalised to -23 LUFS integrated.
import fs from 'node:fs';
import { SR, decode, writeWav, makeLoop, lufsOf, gain, peak, encode, momentary, env, db } from './lib.mjs';

const W = 'work', OUT = 'out', SRC = 515123, LEN = 3.6, XF = 0.4;
for ( const d of [ W, OUT ] ) fs.mkdirSync( d, { recursive: true } );
const all = decode( `raw/${ SRC }.ogg`, 1 );
const M = Array.from( env( all[ 0 ], SR / 10 ), db ); // RMS level, 10 values per second
const per = 10, dur = all[ 0 ].length / SR;
let best = null;
for ( let t = 4; t + LEN + XF < dur - 2; t += 0.5 ) {
	const w = M.slice( Math.floor( t * per ), Math.floor( ( t + LEN + XF ) * per ) ).filter( Number.isFinite );
	if ( w.length < 4 ) continue;
	const mean = w.reduce( ( a, b ) => a + b, 0 ) / w.length;
	const sd = Math.sqrt( w.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / w.length );
	const score = mean - 3 * sd;
	if ( ! best || score > best.score ) best = { t, mean, sd, score };
}
console.log( 'window', JSON.stringify( best ) );
const bank = {};
const name = 'rocket_roar';
const N = Math.round( LEN * SR ), X = Math.round( XF * SR );
const seg = decode( `raw/${ SRC }.ogg`, 1, best.t, LEN + XF + 0.05, 'highpass=f=35' );
const loop = makeLoop( seg, N, X );
writeWav( `${ W }/${ name }.wav`, loop );
const m = lufsOf( `${ W }/${ name }.wav` );
gain( loop, 10 ** ( ( - 23 - m.I ) / 20 ) );
const pk = peak( loop );
if ( pk > 0.89 ) gain( loop, 0.89 / pk );
writeWav( `${ W }/${ name }.wav`, loop );
encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, 64, 1 );
const y = decode( `${ OUT }/${ name }.ogg`, 1 );
const Mo = momentary( y ).filter( Number.isFinite ).sort( ( a, b ) => a - b );
bank[ name ] = { file: `${ name }.ogg`, loop: true, lufs: + Mo[ Math.floor( Mo.length / 2 ) ].toFixed( 1 ), from: best.t };
fs.writeFileSync( 'rocket-bank.json', JSON.stringify( bank ) );
console.log( JSON.stringify( bank ) );
