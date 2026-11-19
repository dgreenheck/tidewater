// The player's whistle that calls the pet cockatoo back (B: src/player/Cockatoo.js whistle(), SoundScape.whistle).
// Source: Freesound 551960 "come_here_whistle.wav" by mael46, CC0 1.0 (https://freesound.org/s/551960/).
// A real human whistle: nothing here is synthesised.
//
//   curl -o raw/551960.mp3 https://cdn.freesound.org/previews/551/551960_8655650-hq.mp3
//   node build-whistle.mjs         # -> out/whistle.ogg + whistle-bank.json
//   cp out/whistle.ogg ../../public/audio/   # then copy the entry into src/audio/soundBank.js
//
// Four two-note calls (a high note near 3 kHz falling to a held note near 2.0 to 2.4 kHz), found by a pitch and
// level track of the recording. High-passed at 600 Hz to drop breath rumble, faded, peak-normalised to -1 dBFS;
// `lufs` is each slice's maximum momentary loudness.
import fs from 'node:fs';
import { SR, decode, fade, gain, peak, writeWav, encode, momentary } from './lib.mjs';

const W = 'work', OUT = 'out';
for ( const d of [ W, OUT ] ) fs.mkdirSync( d, { recursive: true } );
const SRC = 'raw/551960.mp3';
const SLICES = [ [ 2.42, 0.96 ], [ 4.66, 0.74 ], [ 8.96, 0.82 ], [ 15.18, 0.88 ] ];
const GAP = 0.08, parts = [], table = [], lufs = [];
let t = GAP;
for ( const [ st, d ] of SLICES ) {
	const [ x ] = decode( SRC, 1, st, d, 'highpass=f=600' );
	fade( [ x ], Math.round( 0.01 * SR ), Math.round( 0.06 * SR ) );
	gain( [ x ], 0.89 / Math.max( peak( [ x ] ), 1e-6 ) );
	parts.push( x );
	table.push( [ + t.toFixed( 4 ), + ( x.length / SR ).toFixed( 4 ) ] );
	t += x.length / SR + GAP;
}
const buf = new Float32Array( Math.ceil( ( t + 0.02 ) * SR ) );
let o = Math.round( GAP * SR );
for ( const x of parts ) { buf.set( x, o ); o += x.length + Math.round( GAP * SR ); }
writeWav( `${ W }/whistle.wav`, [ buf ] );
encode( `${ W }/whistle.wav`, `${ OUT }/whistle.ogg`, 64, 1 );
const y = decode( `${ OUT }/whistle.ogg`, 1 );
for ( const [ ts, d ] of table ) lufs.push( + Math.max( ...momentary( [ y[ 0 ].slice( Math.floor( ts * SR ), Math.floor( ( ts + d ) * SR ) ) ] ) ).toFixed( 1 ) );
const bank = { whistle: { file: 'whistle.ogg', slices: table, lufs } };
fs.writeFileSync( 'whistle-bank.json', JSON.stringify( bank ) );
console.log( JSON.stringify( bank ) );
