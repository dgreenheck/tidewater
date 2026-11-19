# High-ground evacuation boardwalk

The signed timber route starts beside the village market at **(47, -108)** and
climbs north to the hillside refuge at **(47, -246)**. It is 138 m long from the
entrance to the refuge centre. The 3.8 m deck leaves about 3.4 m between the
handrails. Four hundred and fifty timber treads rise no more than 0.18 m each.

The refuge is an 8 × 6 m platform at **41.91 m above sea level**, on natural ground
at 37.64 m. Its height is sampled from the real terrain after the coastal road
has been graded. No hill or terrain surface is moved to manufacture the refuge.
The footbridge over the coastal road has at least 5.2 m clearance below its
stringers and no supports across the carriageway.

Choose **Evacuation → Face evacuation route**, then hold **Shift + W** to run.
The first action turns the player's view toward the entrance. At the entrance,
the same action faces the climb. It does not move the player. Green rails, tread
noses, large directional signs, elevation signs, lamps, bridge trusses, timber
posts, footings, fasteners, landings and refuge benches mark the whole route.
During a tsunami warning, the green lamp sequence flows uphill. The default
warning lead is 90 seconds; the route alone takes about 22 seconds at normal
running speed, with additional time needed to reach the entrance and steer.

## Integration

1. Import `prepareEvacuationRoute` from `src/evacuation/Route.js` and call it with
   `terrainData` after `CoastalRoute` is constructed, before vegetation and rocks
   are scattered. It adds three clearance polygons and caches the route. It does
   not alter terrain heights.
2. Import `Evacuation` from `src/evacuation/Evacuation.js`, construct it with the
   app and await `init()` after the village/player/local lights exist, before
   `RallyDrive.init()` and `new Disasters(...)`. The colliders are then included
   in the physics snapshot and the timber sections in `StructuralDamage`.
3. Call `app.evacuation.update(dt)` in the regular update. `state()` exposes the
   measured progress, warning, flood depth, refuge position and damaged sections.
   `faceRoute()` rotates the on-foot player only. It declines if the free camera
   or a vehicle is active. `route` and `refuge` are public geometry descriptions.

`Route.js` plans from terrain heights. `Evacuation.js` builds five material
batches and actual walkable treads/rail colliders. `Signs.js` draws a local sign
atlas without network fonts. `Panel.js` uses the shared WorldTools rail and a
small live guidance overlay.

## Water and damage

This is ordinary collision geometry. The player uses the same feet contact,
gravity, run input, water queries and disaster forces as elsewhere. There is no
route movement override, automatic transport, refuge immunity or water clamp.
The refuge message depends on actually standing inside the platform at its deck
height. A flood above that deck is reported as flooded.

Each roughly six-metre section, including its signs and rails, is tagged through
the existing `structure()` registry. The shared timber load/capacity and damage
model can fracture it into rigid assemblies, remove its static walkable and
solid colliders, and restore its original geometry and colliders when **Restore
island** is selected. The platform is also a tagged timber structure. It is not
indestructible.

The shared model uses assumed timber anchor strength and coarse assembly
fracture. It is not a joint-by-joint structural model. The 8 m shallow-water grid
does not resolve individual posts, deck obstruction, local scour or wave
overturning. Existing disaster body budgets can defer fractures. These limits
are inherited from the disaster system, rather than hidden by the route.

## Verification

Run `node --test test/evacuation.mjs` for terrain clearance, road headroom, actual
player-controller traversal, finite stair rises and a real severe shallow-water
event. The latter measured an entrance water peak of about 14.93 m against the
roughly 4 m entrance deck, while the refuge grid cells remained dry. It also
checks that an overtopped refuge is reported as flooded.

Run `PW_PORT=5210 PW_OUT=test-results/local npx playwright test
test/browser/evacuation.spec.js --workers=1` against an isolated real product.
The maintained Given/When/Then scenarios use actual buttons and Shift + W to
run from the original village spawn to the refuge during the normal warning,
and trigger a short-warning severe wave to verify damage and restoration.
Only the external Google Fonts stylesheet is mocked. Read-only browser
observations inspect physical poses, support and the geometry restored by the
real disaster controls. The normal simulation and browser runners include these
tests.
