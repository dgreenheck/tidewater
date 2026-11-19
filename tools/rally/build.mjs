import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const run = ( command, args, env = process.env ) => {
	const result = spawnSync( command, args, { cwd: root, stdio: 'inherit', env } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) process.exit( result.status || 1 );
};

const candidates = process.env.WASM_BINDGEN ? [ process.env.WASM_BINDGEN ] : [
	'wasm-bindgen', ...( process.env.RALLY_DIR ? [ resolve( process.env.RALLY_DIR, 'target/tools/bin/wasm-bindgen' ) ] : [] ),
];
const bindgen = candidates.find( command => {
	const result = spawnSync( command, [ '--version' ], { encoding: 'utf8' } );
	return result.status === 0 && result.stdout.trim() === 'wasm-bindgen 0.2.114';
} );
if ( ! bindgen ) throw new Error( 'Install wasm-bindgen-cli 0.2.114, or set WASM_BINDGEN to its executable. See docs/rally-integration.md.' );

// Rust panic locations are embedded even in release builds. Use stable package
// and dependency paths, including when Cargo reads the checkout via a symlink.
const cargoHome = process.env.CARGO_HOME || resolve( homedir(), '.cargo' );
const existing = process.env.CARGO_ENCODED_RUSTFLAGS?.split( '\x1f' ) ?? ( process.env.RUSTFLAGS || '' ).split( /\s+/ ).filter( Boolean );
const flags = [ ...existing, `--remap-path-prefix=${ homedir() }=home`,
	`--remap-path-prefix=${ realpathSync( cargoHome ) }=cargo`,
	`--remap-path-prefix=${ realpathSync( root ) }=.`, `--remap-path-prefix=${ resolve( root ) }=.` ];
run( 'cargo', [ 'build', '--locked', '--manifest-path', 'rally-physics/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release', '-j', '6' ],
	{ ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join( '\x1f' ) } );
const target = resolve( root, process.env.CARGO_TARGET_DIR || 'rally-physics/target' );
run( bindgen, [ '--target', 'web', '--remove-name-section', '--remove-producers-section', '--out-dir', 'public/rally', '--out-name', 'rally_physics',
	resolve( target, 'wasm32-unknown-unknown/release/tidewater_rally_physics.wasm' ) ] );
run( process.execPath, [ 'tools/distribution-assets.mjs', 'pack', 'physics' ] );
console.log( 'Built the Rally physics module in public/rally.' );
