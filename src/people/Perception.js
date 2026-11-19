// Cheap spatial queries and the event bus. The grid is a spatial hash of everyone's feet (x, z),
// rebuilt each frame (a few dozen people: an array per cell, reused). The bus delivers an event
// to every person within its radius, scaled by their hearing (a near-deaf elder hears less), into
// their brain's inbox; the brain takes the most telling one at its next think. Subscribers (on)
// see every event too, for the next lanes (a life moment waiting on the horn, the bump lane).
//   bus.emit( type, at, radius, data ), bus.on( type | '*', fn ), grid.near( x, z, r, out )
export class Grid {

	constructor( cell = 8 ) { this.cell = cell; this.cells = new Map(); this.used = []; }

	clear() { for ( const a of this.used ) a.length = 0; this.used.length = 0; }

	key( ix, iz ) { return ix * 73856093 ^ iz * 19349663; }

	add( p ) {

		const k = this.key( Math.floor( p.world.x / this.cell ), Math.floor( p.world.z / this.cell ) );
		let a = this.cells.get( k );
		if ( ! a ) this.cells.set( k, a = [] );
		if ( ! a.length ) this.used.push( a );
		a.push( p );

	}

	near( x, z, r, out = [] ) {

		const c = this.cell, x0 = Math.floor( ( x - r ) / c ), x1 = Math.floor( ( x + r ) / c ), z0 = Math.floor( ( z - r ) / c ), z1 = Math.floor( ( z + r ) / c );
		for ( let i = x0; i <= x1; i ++ ) for ( let k = z0; k <= z1; k ++ ) {

			const a = this.cells.get( this.key( i, k ) );
			if ( a ) for ( const p of a ) if ( ( p.world.x - x ) ** 2 + ( p.world.z - z ) ** 2 <= r * r ) out.push( p );

		}
		return out;

	}

}

const HEARING = { elderly: 0.7, kid: 1.2 };
const _near = [];

export class Bus {

	constructor( hub ) { this.hub = hub; this.subs = new Map(); this.log = []; }

	on( type, fn ) { if ( ! this.subs.has( type ) ) this.subs.set( type, [] ); this.subs.get( type ).push( fn ); return () => { const a = this.subs.get( type ); a.splice( a.indexOf( fn ), 1 ); }; }

	emit( type, at, radius, data = null ) {

		const hub = this.hub, e = { type, at, radius, data, t: hub.t };
		// a wide event (the horn) scans everyone; a local one asks the grid
		_near.length = 0;
		const who = radius > 60 ? hub.list : hub.grid.near( at.x, at.z, radius, _near );
		let heard = 0;
		for ( const p of who ) {

			if ( ! p.world || ! p.brain || p.lod === 'far' ) continue;
			const r = radius * ( HEARING[ p.brain.type ] ?? 1 );
			if ( ( p.world.x - at.x ) ** 2 + ( p.world.z - at.z ) ** 2 > r * r ) continue;
			p.brain.hear( e );
			heard ++;

		}
		this.log.push( { type, t: + hub.t.toFixed( 2 ), heard } );
		if ( this.log.length > 20 ) this.log.shift();
		for ( const fn of this.subs.get( type ) || [] ) fn( e );
		for ( const fn of this.subs.get( '*' ) || [] ) fn( e );
		return heard;

	}

}
