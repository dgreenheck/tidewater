import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit snapshot refresh. Reads Rally and writes only inside Tidewater.
// Rally supplies the car meshes and its input intent module. The vehicle controller
// is Tidewater's own (rally-physics/src/controller.rs) and is never overwritten.
const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const given = process.argv[ 2 ] || process.env.RALLY_DIR;
if ( ! given ) throw new Error( 'Pass the Rally checkout as the first argument, or set RALLY_DIR.' );
const source = resolve( given );
const files = [ 'src/driving/input.rs', 'assets/vehicles/aster_rs.glb', 'assets/vehicles/support_wagon.glb', 'assets/vehicles/support_pickup.glb' ];
const contents = await Promise.all( files.map( path => readFile( resolve( source, path ) ) ) );
if ( ! contents[ 0 ].toString().includes( 'pub struct DriveIntent' ) ) {
	throw new Error( 'The Rally input module changed. Review the controller bridge before refreshing its snapshot.' );
}
await mkdir( resolve( root, 'rally-physics/src/driving' ), { recursive: true } );
await mkdir( resolve( root, 'public/rally' ), { recursive: true } );
for ( const [ index, path ] of files.entries() ) {
	const destination = path.endsWith( '.glb' ) ? `public/rally/${ basename( path ) }` : `rally-physics/src/driving/${ basename( path ) }`;
	await copyFile( resolve( source, path ), resolve( root, destination ) );
}
const manifest = { source: 'Rally',
	snapshot: new Date().toISOString().slice( 0, 10 ),
	sha256: Object.fromEntries( files.map( ( path, i ) => [ path, createHash( 'sha256' ).update( contents[ i ] ).digest( 'hex' ) ] ) ) };
await writeFile( resolve( root, 'rally-physics/source-manifest.json' ), JSON.stringify( manifest, null, 2 ) + '\n' );
console.log( 'Refreshed Rally input and model snapshots. Run npm run build:rally, then npm test.' );
