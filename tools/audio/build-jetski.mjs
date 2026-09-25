// Builds the jet ski sounds of public/audio from CC0 Freesound previews (see README.md):
//   node dl.mjs <id:user ...>        (downloads raw/<id>.ogg + raw/<id>.json, prints the licence)
//   node build-jetski.mjs           -> out/*.ogg + jetski-bank.json (slice tables + measured loudness)
// Loops: excerpt, equal-power crossfade at the wrap, loudness-normalised to -23 LUFS integrated.
// Sprites: slices peak-normalised to -1 dBFS; each slice's maximum momentary loudness is measured.
import { decode, writeWav, peak, gain, lufsOf, makeLoop, fade, encode, momentary, SR } from './lib.mjs';
import fs from 'node:fs';

const OUT = 'out', W = 'work';
fs.mkdirSync( OUT, { recursive: true } );
fs.mkdirSync( W, { recursive: true } );
const hp = ( f ) => `highpass=f=${ f }:p=2`;
const bank = {};

// ---------------------------------------------------------------- loops
const LOOPS = {
	// jet ski two-stroke engine at steady RPM (pitch will be shifted by the mixer)
	// 212441:wjauch - Jetski.wav (CC0) - 42.3s
	jetski_engine: { src: 212441, from: 5, len: 10, xf: 0.5, af: hp( 100 ) },
	// water rushing past the hull at speed (bow wave)
	// 438838:craigsmith - G54-03-Light Bow Wave.wav (CC0) - 23.8s
	jetski_rush: { src: 438838, from: 2, len: 10, xf: 0.5, af: hp( 150 ) },
	// gentle lapping at rest / low speed
	// 637206:kyles - boat knocks fiberglass water laps on hull.flac (CC0) - 41.9s
	jetski_lap: { src: 637206, from: 3, len: 12, xf: 0.5, af: hp( 200 ) },
};
for ( const [ name, L ] of Object.entries( LOOPS ) ) {
	if ( L.src === 0 ) {
		console.log( `SKIP ${ name }: no Freesound src ID set` );
		continue;
	}
	const N = Math.round( L.len * SR ), X = Math.round( L.xf * SR );
	const seg = decode( `raw/${ L.src }.ogg`, 1, L.from, L.len + L.xf + 0.05, L.af || '' );
	const loop = makeLoop( seg, N, X );
	writeWav( `${ W }/${ name }.wav`, loop );
	const m = lufsOf( `${ W }/${ name }.wav` );
	gain( loop, 10 ** ( ( - 23 - m.I ) / 20 ) );
	const pk = peak( loop );
	if ( pk > 0.89 ) gain( loop, 0.89 / pk );
	writeWav( `${ W }/${ name }.wav`, loop );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, 64, 1 );
	const M = momentary( decode( `${ OUT }/${ name }.ogg`, 1 ) ).sort( ( a, b ) => a - b );
	bank[ name ] = { file: `${ name }.ogg`, loop: true, lufs: + M[ Math.floor( M.length / 2 ) ].toFixed( 1 ), src: [ L.src ] };
	console.log( `loop   ${ name.padEnd( 14 ) } src ${ L.src }  ${ L.len } s  lufs(before) ${ m.I } -> -23  median M ${ bank[ name ].lufs }` );
}

fs.writeFileSync( 'jetski-bank.json', JSON.stringify( bank, null, 1 ) );
console.log( '\nEdit the src IDs in this file, then run again.' );
console.log( 'After build: cp out/*.ogg ../../public/audio/ and merge jetski-bank.json into src/audio/soundBank.js' );