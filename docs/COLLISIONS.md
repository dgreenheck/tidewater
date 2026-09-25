# Character and dock collisions

Character movement sweeps an upright cylinder against convex slabs and volumes.
`Colliders.characterSolids()` gathers static boxes, cylinders, roof/shutter slabs,
and nearby tree trunks. `Player` adds the moving boat's transformed solids and
passes the complete set to `resolveSolidMotion()`. Sliding retains all contact
normals, so a ceiling response cannot undo a wall contact. Grounded walking tries
an up/across/down sweep when a ledge blocks progress,
with a 40 cm step limit and a full-body ceiling check. A short downward sweep
keeps support over stairs and boardwalk seams; jumping disables this assistance.
The camera eases the resulting height changes, with its own clearance check when
an offset raises it above the body. Terrain remains a height-field ground query;
deck movement uses the collision sweep in the boat's local frame.

Village roofs and shutters register collision slabs from their rendered vertices.
The fish stand registers each corrugated panel using its rendered dimensions and
transform, with a 4 cm thickness envelope for the corrugations. Tree geometry and
collision share `TrunkProfiles.js`. Trunks use conservative short cylinder
sections, generated lazily through a spatial grid. Leaves and crown wind are
visual; these are collision proxies, not triangle-perfect meshes.

`BoatCollision` supplies the exterior hull envelope and existing cabin/gear boxes.
Boarded players use deck shapes rather than the closed exterior hull. The hull
proxy follows the boat's footprint but simplifies the submerged cross-section.

`BoatWorldCollision` handles contact with fixed docks/piles after each 120 Hz
physics step. It projects hull/cabin volumes into horizontal convex footprints,
rejects pairs with disjoint height ranges, and subdivides translation/rotation to
keep ordinary edge travel under 10 cm per collision step. Preallocated point
buffers and projection axes avoid rebuilding and sorting hulls in the hot loop.
A world revision invalidates the static obstacle cache when boxes/posts are added.

Dock response is deliberately horizontal: inelastic normal impulses use the
contact point, mass, and yaw inertia; Coulomb friction is limited to 0.2 times the
normal impulse. The normal and friction impulses are solved together. Buoyancy
and terrain retain control of heave, pitch and roll. This is a game-oriented dock
solver, not a general 3D rigid-body engine. Strongly tilted contacts are therefore
conservative and deserve playtesting.

## Automated checks

- `npm test`: game logic, collision regressions and headless WebGPU smoke test.
- `npm run build`: production build.
- `node test/benchmark-collisions.mjs`: CPU-only timings against the actual pier
  geometry, including clear and repeated-contact scenarios. This excludes the
  renderer and is not a browser FPS measurement or a timing-sensitive CI test.

Regression coverage includes thin overheads, pitched/rotated roofs and shutters,
wall/ceiling corners, generated boardwalk/pier transitions on the island terrain,
walking/sprinting stairs in both directions, passage sliding, step height and
headroom limits, camera easing, trunks, swimming, boarding/helm transitions,
cabin jumps, rotating hulls, narrow piles, deck clearance, glancing impacts,
contact energy, and powered approaches to the generated pier at 120/60/20 Hz.

## Local playtest

Use normal player mode (F toggles free camera, which intentionally ignores
collisions). Reload the page after code changes.

1. Jump under porch roofs, market roofs and open window shutters. Repeat while
   holding movement toward the wall and at the ends of the overhang. The head
   should stop/slide without entering the wall or being thrown sideways.
2. Walk up and down porch/pier steps, along railings and through ordinary gaps.
   Check that the collision fix has not made normal routes impassable.
3. Walk and sprint into tree trunks, including a leaning palm. Move diagonally
   around them and jump near the roots. Trunks should block; open space beside
   them should remain usable.
4. Swim against both sides, bow and stern of the boat. Board with E, walk the
   deck, jump under the cabin roof, take/leave the helm, and step ashore. Boarding
   should work without clipping, getting stuck or being ejected.
5. Approach the pier slowly, then faster (Shift boosts). Test bow-first,
   stern-first, glancing and sideways contact against the pier head and piles.
   The hull/cabin should stay outside; glancing contact should allow sliding.
6. Turn alongside the pier, reverse away, and repeat in stronger waves using H.
   Watch for jitter, sudden spinning, sinking, snagging and frame-rate drops.
   Also drive away into clear water to check that normal motion feels unchanged.

Record the location, approach direction, keys held and sea state for any failure.
