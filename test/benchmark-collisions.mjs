// CPU-only collision cost near the real pier; excludes rendering and shader compilation.
import { performance } from 'node:perf_hooks';
import { Vector3, Quaternion } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { Builder } from '../src/world/village/GeoBuilder.js';
import { buildPier } from '../src/world/Pier.js';
import { Rand } from '../src/world/Props.js';
import { mulberry32 } from '../src/util/Noise.js';
import { HullLines } from '../src/world/boat/HullLines.js';
import { BoatModel } from '../src/world/BoatModel.js';
import { BoatWorldCollision } from '../src/player/BoatWorldCollision.js';

const model = { lines: new HullLines() };
model.colliders = BoatModel.prototype._buildColliders.call( model );
const colliders = new Colliders();
buildPier( { B: new Builder(), terrain: { heightAt: () => - 10 }, colliders, rand: new Rand( mulberry32( 42 ) ), lights: [], inst: { add() {} } } );
const collision = new BoatWorldCollision( model, colliders );
const boat = { position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3() };
const old = new Vector3(), q = new Quaternion();
for ( const [ name, x ] of [ [ 'near pier, clear', 64.5 ], [ 'pier contact', 63.2 ] ] ) {
	let contacts = 0;
	const samples = [];
	for ( let i = 0; i < 2500; i ++ ) {
		old.set( x + 0.08, 0, 36.5 ); boat.position.set( x, 0, 36.5 );
		boat.quaternion.identity(); boat.velocity.set( - 8, 0, 1 ); boat.angular.set( 0, 0, 0 );
		const start = performance.now();
		collision.move( boat, old, q );
		const ms = performance.now() - start;
		if ( i >= 500 ) { samples.push( ms ); contacts += collision.stats.contacts; }
	}
	samples.sort( ( a, b ) => a - b );
	console.log( JSON.stringify( { scenario: name, medianMs: +samples[ 1000 ].toFixed( 4 ), p95Ms: +samples[ 1900 ].toFixed( 4 ),
		meanMs: +( samples.reduce( ( a, b ) => a + b, 0 ) / samples.length ).toFixed( 4 ), contacts } ) );
}
