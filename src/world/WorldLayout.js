import * as THREE from '../engine/index.js';

// Shared world layout. Coordinates in meters, y up, sea level y = 0.
// The open ocean lies to the south (+z); the island to the north (-z).
// Sun rises in the east (+x) and sets in the west (-x).

// The pier's centreline. Its entrance arch posts stand at PIER_X +- pileOff (Pier.js), so the arch is centred
// on it and the start (below) is placed on it.
const PIER_X = 55; // m

export const WORLD = {
	terrainSize: 2048, // heightmap domain, centered at origin
	terrainRes: 2048,

	// Central sandy beach inside the bay, shoreline near z ≈ -42 at x = 0.
	beach: { xMin: - 150, xMax: 170 },

	pier: {
		x: PIER_X,
		zStart: - 64, // on dry sand
		zEnd: 40, // end of pier (~4 m depth)
		deckHeight: 2.3, // deck surface above sea level
		width: 2.6,
		headWidth: 14, // T-shaped platform at the end
		headDepth: 7,
	},

	// Where the boat is moored: east side of the pier head, bow pointing south.
	boatDock: { position: new THREE.Vector3( 64.5, 0, 36.5 ), heading: 0 },

	village: { center: new THREE.Vector3( 40, 0, - 118 ), radius: 95 },

	reef: { center: new THREE.Vector3( - 78, 0, 58 ), radius: 58 },

	spawn: { position: new THREE.Vector3( 18, 0, - 60 ), yaw: Math.PI }, // kept clear of rocks, plants and debris
	// where the player starts: on the boardwalk up from the pier foot, looking down it toward the pier.
	// x is the entrance arch's centreline: at x 53.6 (before the fix) held W walked into the arch's west post
	// (PIER_X - pileOff) and stopped at z -64.2. z -71 is where the curving boardwalk still
	// holds the whole 0.3 m capsule on its planks at that x (its centre bends west to 53.5 by z -77), 7.4 m
	// short of the arch. test/start-walk.mjs walks it 30 m straight onto the pier against the real colliders.
	start: { position: new THREE.Vector3( PIER_X, 0, - 71 ), yaw: Math.PI },

	// The ferry terminal (src/ferry/Terminal.js): where its glTF frame's origin (the docked ferry's
	// stern-ramp hinge line at sea level) sits, and its yaw (0: the berth opens south, out to sea).
	ferryTerminal: { position: new THREE.Vector3( 150, 0, 300 ), yaw: 0 },
	// Joey Island's terminal across the strait: the same terminal, its berth opening north-west
	// (yaw 220 degrees), its fill on the island's north-west corner; bow to bow 445 m from Tidewater's.
	joeyTerminal: { position: new THREE.Vector3( - 176, 0, 652 ), yaw: 220 * Math.PI / 180 },

	// Incoming swell direction (unit, travel direction)
	swellDir: new THREE.Vector2( - 0.12, - 1 ).normalize(),
};
