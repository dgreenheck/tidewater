// Jetski engine loops for the ridden personal watercraft (src/jetski, SoundScape jetski bed).
// Source: Freesound 36169 "jetski.wav" by moxobna, CC0 1.0 (https://freesound.org/s/36169/).
// A real recording: nothing here is synthesised. The mixer pitches the loops with rpm.
//
//   node dl.mjs 36169:moxobna        # -> raw/36169.ogg (+ licence json: CC0)
//   node build-jetski.mjs            # -> out/jetski_idle.ogg, out/jetski_run.ogg + jetski-bank.json
//   cp out/jetski_*.ogg ../../public/audio/   # then copy the entries into src/audio/soundBank.js
//
// Loops: excerpt, equal-power crossfade at the wrap, loudness-normalised to -23 LUFS integrated;
// `lufs` in the bank is the median momentary loudness (same as build-fishing.mjs).
import fs from 'node:fs';
import { SR, decode, writeWav, makeLoop, lufsOf, gain, peak, encode, momentary } from './lib.mjs';

const W = 'work', OUT = 'out';
for ( const d of [ W, OUT ] ) fs.mkdirSync( d, { recursive: true } );
const LOOPS = {
	// low throttle burble (the quiet stretch of the recording)
	jetski_idle: { src: 36169, from: 25.2, len: 3.6, xf: 0.4 },
	// wide open: the pump howl and the hull on the water (the loudest steady stretch)
	jetski_run: { src: 36169, from: 43.2, len: 3.6, xf: 0.4 },
};
const bank = {};
for ( const [ name, L ] of Object.entries( LOOPS ) ) {
	const N = Math.round( L.len * SR ), X = Math.round( L.xf * SR );
	const seg = decode( `raw/${ L.src }.ogg`, 1, L.from, L.len + L.xf + 0.05, 'highpass=f=45' );
	const loop = makeLoop( seg, N, X );
	writeWav( `${ W }/${ name }.wav`, loop );
	const m = lufsOf( `${ W }/${ name }.wav` );
	gain( loop, 10 ** ( ( - 23 - m.I ) / 20 ) );
	const pk = peak( loop );
	if ( pk > 0.89 ) gain( loop, 0.89 / pk );
	writeWav( `${ W }/${ name }.wav`, loop );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, 64, 1 );
	const y = decode( `${ OUT }/${ name }.ogg`, 1 );
	const M = momentary( y ).filter( Number.isFinite ).sort( ( a, b ) => a - b );
	bank[ name ] = { file: `${ name }.ogg`, loop: true, lufs: + M[ Math.floor( M.length / 2 ) ].toFixed( 1 ) };
}
fs.writeFileSync( 'jetski-bank.json', JSON.stringify( bank ) );
console.log( JSON.stringify( bank ) );
