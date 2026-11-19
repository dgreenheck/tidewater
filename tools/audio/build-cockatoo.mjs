// Squawks for the player's pet sulphur-crested cockatoo (src/player/Cockatoo.js, SoundScape.squawk).
// Source: Freesound 783046 "Sulphur Crested Cockatoo" by jacques.devosmalan@gmail.com, CC0 1.0
// (https://freesound.org/s/783046/). A real recording: nothing here is synthesised.
//
//   curl -o raw/783046.mp3 https://cdn.freesound.org/previews/783/783046_7160013-hq.mp3
//   node build-cockatoo.mjs        # -> out/cockatoo.ogg + cockatoo-bank.json
//   cp out/cockatoo.ogg ../../public/audio/   # then copy the entry into src/audio/soundBank.js
//
// Seven calls sliced from the minute-long recording (found with lib.events), high-passed at 350 Hz
// to drop wind rumble, faded, peak-normalised to -1 dBFS; `lufs` is each slice's maximum momentary loudness.
import fs from 'node:fs';
import { SR, decode, fade, gain, peak, writeWav, encode, momentary } from './lib.mjs';

const W = 'work', OUT = 'out';
for ( const d of [ W, OUT ] ) fs.mkdirSync( d, { recursive: true } );
const SRC = 'raw/783046.mp3';
const SLICES = [ [ 32.29, 1.30 ], [ 43.68, 1.30 ], [ 13.10, 0.75 ], [ 23.13, 0.62 ], [ 9.92, 1.10 ], [ 40.10, 1.30 ], [ 27.63, 0.42 ] ];
const GAP = 0.08, parts = [], table = [], lufs = [];
let t = GAP;
for ( const [ st, d ] of SLICES ) {
	const [ x ] = decode( SRC, 1, st - 0.004, d + 0.004, 'highpass=f=350,highpass=f=350' );
	fade( [ x ], Math.round( 0.004 * SR ), Math.round( Math.min( 0.15, d * 0.3 ) * SR ) );
	gain( [ x ], 0.89 / Math.max( peak( [ x ] ), 1e-6 ) );
	parts.push( x );
	table.push( [ + t.toFixed( 4 ), + ( x.length / SR ).toFixed( 4 ) ] );
	t += x.length / SR + GAP;
}
const buf = new Float32Array( Math.ceil( ( t + 0.02 ) * SR ) );
let o = Math.round( GAP * SR );
for ( const x of parts ) { buf.set( x, o ); o += x.length + Math.round( GAP * SR ); }
writeWav( `${ W }/cockatoo.wav`, [ buf ] );
encode( `${ W }/cockatoo.wav`, `${ OUT }/cockatoo.ogg`, 64, 1 );
const y = decode( `${ OUT }/cockatoo.ogg`, 1 );
for ( const [ ts, d ] of table ) lufs.push( + Math.max( ...momentary( [ y[ 0 ].slice( Math.floor( ts * SR ), Math.floor( ( ts + d ) * SR ) ) ] ) ).toFixed( 1 ) );
const bank = { cockatoo: { file: 'cockatoo.ogg', slices: table, lufs } };
fs.writeFileSync( 'cockatoo-bank.json', JSON.stringify( bank ) );
console.log( JSON.stringify( bank ) );
