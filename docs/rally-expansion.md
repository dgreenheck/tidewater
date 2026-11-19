# Driving expansion

Requested additions: contact-driven tyre marks, a lifted black Jeep built in
Blender, custom number plates, recorded Jeep engine audio from Swift Parking,
shared multiplayer driving, direction/distance indicators and minimap players.
Also requested: a graded coastal road loop with entrances onto the sand.

## Physics adapter

Superseded on 25 September 2026: the string-patched copy of Rally's controller
(`build.rs` over a byte-for-byte `physics.rs`) was replaced by Tidewater's own controller,
`rally-physics/src/controller.rs`, described in `docs/rally-physics.md`. The paragraph
below about the vehicle bundle still applies.

Rust 2024 return-position `impl Trait` captures reference parameters by default.
The owned vehicle bundle uses `impl Bundle + use<>` so it does not borrow the
temporary configuration passed by an upstream test fixture.

The Jeep uses a 2,100 kg body, 0.47 m tyres, 2.76 m wheelbase, 2.04 m track,
0.98 m centre of mass, 39 kN/m springs, 5.1 kN·s/m dampers and four driven wheels.
This is the existing rigid-body/four-ray suspension approximation, not a
deformable chassis or a complete linked-axle/driveline simulation.

## Acceptance baseline

The new actual-product browser scenarios failed before implementation: no tyre
segments after driving over sand, and no vehicle selector/Black Jeep. The
existing four island-driving scenarios were green before this expansion.

Minimap anchors have zero dimensions by design. Accessible image roles belong
on the visible marker glyph, not the positioning anchor, so semantic bounds
match the visible marker.

The first multiplayer screenshot exposed a guest spawn sitting on a log. The
four-contact acceptance assertion reproduced it (3 contacts). Spawn placement
now checks the whole car footprint, dry terrain, props and other cars. The
unchanged two-browser scenario then passed with four contacts for both cars.

## Coastal loop

The 323 m closed circuit sits west of the village and avoids the houses and pier.
The original heightfield is graded before scenery generation and is shared by
rendering and Avian collision. Maximum route grade is about 10.51%; maximum local
earthwork is under 1 m. Vegetation, rocks and debris respect the route clearance.
Asphalt has a slight crown, aggregate, faded lines, gravel shoulders and guideposts.
Two gravel ramps blend down into the original beach. The minimap uses this same
route data. Asphalt overrides gravel at the junctions, including tyre friction.

The coastal browser scenario first failed because the Start at selector did not
exist. The implemented loop passes real car support and acceleration checks.
Both access scenarios traverse asphalt, gravel and sand with actual wheel contact.
The initial west-ramp test held full throttle to 60 km/h, then slid past the sand
into the sea on the handbrake. A subsequent coasting approach was also susceptible
to downhill acceleration. The fixture now actively controls speed at 10–14 km/h
with throttle and service brake, retaining the dry-sand/contact assertions. This fixture correction
is not claimed as a physics fix. Screenshots wait for the welcome guide to finish
fading; recovery refreshes the HUD immediately so old wheel contacts are not shown.

## Audio and networking

Recorded audio is copied from Swift Parking: its Dodge Ram
HEMI V8 for the Jeep and BMW M4 inline-six for the Aster. Source records and credits
are under `public/rally/audio/`. They are licensed game recordings, not recordings
of the exact fictional vehicles. Playback pitch/filter/gain respond to real RPM,
throttle and camera distance. Browser interaction unlocks playback; the sound
button and world mute are respected.

The local WebSocket room stack is adapted from Swift Parking. It validates poses,
limits payloads/rates/capacity, isolates rooms, migrates hosts, and cleans up
departed cars and map markers. Car simulation remains client-owned, with local
kinematic proxies for remote cars. This is shared free driving, not synchronized
deformable damage or a competitive authoritative physics server. Two isolated
browser contexts exercise the actual server without intercepted product messages.

Tyre effects use real loaded contact points, normals, slip and velocity, with
profile-sized swept footprints and tread blocks. They skip air, water, props and
teleports; asphalt/rock require slip. A bounded 24,000-segment history fades near
the wet shoreline faster than dry sand. They do not modify terrain collision.

## Joey Island ring road

- `route.joeyLoop` (src/world/CoastalRoute.js `buildJoeyLoop`, control points `JOEY_LOOP`): a closed two-lane sealed ring round Joey Island's main body, 1136 m. +Z is south, so from the terminal it runs south-west round the island's west end, east along the ocean coast on a bench above the beaches, north up the east shore, round the bay head and west along the strait shore, then back behind the terminal flat 12 m clear of its edge. The eastern peninsula has no road yet.
- Junction: `JOEY_STUB` (6 m) straight out from the Joey terminal's road entry (`TERMINAL_SITE.roadEntry` placed at `WORLD.joeyTerminal`, about (-143.4, 776.4)). `route.joeyLink` runs level at 3.1 m (the flat the car drives on) from the junction into the yard; the ring crosses it at a T and stays level for 12 m either side. Two `joeyMouth` turning lanes (9 m radius, one each side of the link) make the bell mouth, so a car turning in or out stays on the seal; their outer edge is the kerb line. The yard road out of the marshalling lanes runs on the terrain: the site's cut (`TerrainData.cutPolygon`) levels the flat where it runs into the hill behind the lanes, and Joey's grading keeps a 1.5-texel shoulder round the flat so the ring's banks never reach the paving. `test/terminal-flat.mjs` pins the level way out, and `test/browser/joey-road.spec.js` drives it with the player's keys, from the lanes through the check-in boom to the junction.
- Profile: the same `spline()` and `profile()` as the circuit and the ferry road, grade limit 10 % (max 9.95 %), floor 1.6 m over the low spots. Tightest bend about 33 m radius (the south-east corner), so every bend takes 40 to 60 km/h. Deepest cut 9.5 m, behind the flat's south-east corner; highest fill 5.4 m on the east shore.
- Grading runs per island (`grade( segments, keep )`): `maxEarthwork` keeps meaning Tidewater's, `joeyEarthwork` is Joey's (13.6 m including batters). Joey's grading never touches texels inside the terminal site's fill polygon, so the yard, its paving and the village on the flat stay exactly as the site built them. test/coastal-grade.mjs now applies both terminal sites first, as App.js does.
- Guardrails: every road except Tidewater's coast loop uses the hill rule (a verge falling 1.4 m by 10 m or 2.2 m by 16 m, or the outside of a tight bend), so the ring has steel on the seaward drops and guide posts elsewhere.
- Meshing (src/world/CoastalRoad.js): the ring is drawn like the coast loop (texture and dashes repeat a whole number of times round it), its edge line open across the bell mouth; the link and the mouths are cut away on the ring's seal, and the link runs 5 m on under the yard's paving. The minimap draws every path, so it shows the ring.
- Start option: 'Joey Island road' (`STARTS.joeyLoop`, `spawn( 'joeyLoop' )`), on the ocean coast at (25, 874) facing east along the ring.
- Checked in game (27 September, scripted driver on W/A/D/S from the yard road inside the terminal, out through the bell mouth, one full lap and back in): 116.8 s at up to 48 km/h, 2777 of 2777 samples on asphalt, the car upright throughout (lowest up 0.994), steepest measured climb 9.98 % over 10 m, stopped 2.0 m from the road entry. The widest line, 3.25 m off the ring's centreline, was on the bell mouth's seal turning back into the yard.
