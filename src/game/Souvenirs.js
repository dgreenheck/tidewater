// Souvenirs sold by Bev at Joey Island Gifts (the shopping village on the Joey terminal flat,
// src/joey/Village.js). Buying one takes its price and adds its id to state.souvenirs, which is
// saved with the rest of GameState. Ids are stable save keys: add new items, never rename one.
export const SOUVENIRS = [
	{ id: 'stubby', name: 'Stubby holder', price: 12, blurb: 'Neoprene, with the ferry on the side. Keeps a cold one cold.' },
	{ id: 'magnet', name: 'Fridge magnet', price: 6, blurb: 'A joey peeking out of its mum\'s pouch.' },
	{ id: 'postcards', name: 'Postcard pack', price: 9, blurb: 'Eight views of the island, the jetty and the crossing.' },
	{ id: 'teatowel', name: 'Tea towel', price: 15, blurb: 'Linen, printed with a map of Joey Island.' },
	{ id: 'snowglobe', name: 'Snow globe', price: 22, blurb: 'A kangaroo on the beach in a blizzard. Makes sense.' },
	{ id: 'plushjoey', name: 'Plush joey', price: 28, blurb: 'Soft grey-brown joey in a zip-up pouch.' },
	{ id: 'thongs', name: 'Thongs', price: 18, blurb: 'Rubber flip-flops with the island map on each sole.' },
	{ id: 'buckethat', name: 'Bucket hat', price: 25, blurb: 'Khaki, wide brim, JOEY IS. stitched on the front.' },
	{ id: 'honey', name: 'Island honey', price: 14, blurb: 'Local honey from the hives behind the ferry landing.' },
];

export const SOUVENIR_BY_ID = Object.fromEntries( SOUVENIRS.map( ( s ) => [ s.id, s ] ) );

// [ [ item, count ], ... ] in shop order, for the inventory panel.
export function souvenirCounts( ids = [] ) {

	const n = {};
	for ( const id of ids ) n[ id ] = ( n[ id ] || 0 ) + 1;
	return SOUVENIRS.filter( ( s ) => n[ s.id ] ).map( ( s ) => [ s, n[ s.id ] ] );

}
