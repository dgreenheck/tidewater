// Jetski spawn spots (the model lane's data for src/jetski): world metres, sea level y = 0, yaw 0 = bow to
// world +z (out to sea on the main beach). Main beach: three skis moored in knee-deep water (terrain about
// -0.45 to -0.55 m, the ski draws 0.27 m) west of the pier, beside the hire stand (src/world/JetskiHire.js)
// and inside its float line. Joey Island: two in the terminal's dredged basin inside the breakwater hook,
// bows out to sea (the terminal's yaw, 220 deg).
export const SPOTS = [
	{ name: 'Beach hire 1', x: 38.0, z: - 32.5, yaw: 0.10 },
	{ name: 'Beach hire 2', x: 42.0, z: - 32.0, yaw: - 0.06 },
	{ name: 'Beach hire 3', x: 46.0, z: - 32.5, yaw: 0.16 },
	{ name: 'Joey 1', x: - 251.6, z: 624.1, yaw: 3.78 },
	{ name: 'Joey 2', x: - 247.0, z: 629.5, yaw: 3.85 }, // (was - 261.6, 624.6: under the Joey pier walkway)
];
export default SPOTS;
