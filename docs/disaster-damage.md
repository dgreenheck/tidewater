# Disaster damage: trees

How a tree answers a tornado, a tsunami or an earthquake: it bends, it snaps, or it uproots, and it
falls about its hinge. Code: `src/disasters/TreeFailure.js` (failure and hinge), `src/disasters/TreeMass.js`
(green-wood mass), `src/disasters/Bodies.js` (wiring), `src/disasters/FallenVegetation.js` (the copied mesh
and the snap cut), `rally-physics/src/disasters.rs` (`set_prop_motion_limits`, `set_prop_crown`).

Every failed tree used to spawn upright as one free body with the density of cork (35 kg per metre of
height, 142 kg/m³ for an 18 m palm), and a gust sent it cartwheeling. fallen palms drew as
flat frond starbursts and bare trunks, because the crown had no support and sank into the terrain.

## Design note

1. **Reference.** EF scale damage indicators (WSEC 2006, used by the US NWS): DI 28 hardwoods are
   uprooted at an expected 41 m/s (91 mph) and snapped at 49 m/s (110 mph); DI 27 softwoods 41 and
   47 m/s. Island broadleaves take 41 m/s uproot and 48 m/s snap. Palms are the most wind-firm urban
   trees in hurricane surveys (Duryea et al. 2007, Arboriculture & Urban Forestry 33(2)): declared 52
   and 58 m/s. Green wood is 600 to 1000 kg/m³ (Wood Handbook FPL-GTR-190, ch. 4): 850 broadleaf, 700
   palm. Root-plate resistance is largely gone by 20 deg of tilt (Coutts 1986, Annals of Botany 58).
   Porous crowns streamline in strong wind (Vollsinger et al. 2005): crown Cd 0.35 on its ellipse.
2. **Source of truth.** Wind, flow, depth and shaking from `DisasterField.sample`; ground from
   `app.terrainData.heightAt`; capacity scatter from `EventRandom` (`STREAM.tree`, `CAPACITY_COV.tree`
   0.35, Nicoll et al. 2006); the authored mesh from the live `VegType` instance buffers.
3. **Budget.** At most 40 tree bodies (`treeLimit`) and 160 copied trees (`TREE_GROUP_LIMIT`), each one
   or two draws. The hinge is a 1-DOF integration per falling tree at 120 Hz on the main thread, no
   allocation per step.
4. **Detail by distance.** Within 300 m of the camera a falling tree becomes a rigid body once it
   passes 60 deg; farther away, or past the body budget, it keeps falling as an animated copy until its
   crown is a crushed crown's height off the ground, then rests. A standing tree that has not failed
   bends: `t.util` (moment over capacity) is computed for a sway shader (not built yet).
5. **Controls.** None of its own: the Disasters panel starts the event (`docs/disasters.md`).
6. **Transitions.** Standing to falling: the copy replaces the instance in the same frame at the same
   pose, so nothing moves until the hinge does. Hinge to body: the body takes the hinge's pose, linear
   and angular velocity (omega x r about the hinge), so nothing jumps (pinned: foot within 0.6 m of
   the hinge). Snap: the stump is a second copy cut below the break and never moves.
7. **Edges.** The failure moment comes from the field, not from the tree's own motion. A body's spin is
   capped at 2 rad/s with 0.5 1/s angular damping in Avian (`MaxAngularSpeed`, `AngularDamping`).
   Non-finite limits and crown sizes are rejected at the bridge. The hinge never swings back (omega >= 0).
8. **Evidence.** `test/tree-failure.mjs` (in `test:simulation`) and `cargo test
   released_tree_spin_is_capped_and_its_crown_props_the_top_off_the_ground`, below.

## Model

- Mass: stem = green density x form factor (0.45 broadleaf, 0.8 palm) x base cylinder; crown 30% of a
  broadleaf, 15% of a palm, as an ellipsoid at the authored crown. The crown counts as buoyant wood, so
  a floating tree's stem floats and its crown drags instead of sinking the top end.
- Capacity: each tree's uproot and snap capacity is the moment its own crown drag makes at the EF wind,
  times an independent lognormal factor per event. The drag area cancels, so every size fails at the EF
  wind on average. The mode is whichever capacity is exceeded more.
- Snap height: peak bending stress of a stem tapering to 40% at the top under a crown load, about 0.3 H,
  +-8% of H for defects, clamped to 15-70% of H. Palms barely taper and break low.
- Hinge: I theta'' = crown drag on the crown's velocity relative to the air x lever + m g d sin theta -
  residual capacity fading to zero by 20 deg (uproot) or 6 deg (snap).
- Body: stem box plus a crown sphere of 0.3 x crown radius (the crushed crown) that holds the top off the
  ground; friction 0.9 so branches snag.

# Disaster damage: buildings fail piece by piece

Earlier behaviour: a house still tilted in the flood as one
whole block, because the old path turned a whole house into jointed members on its first exposed
frame and let the anchor joint rotate the lot.

## Design note

1. **Reference.** Wind: the EF scale damage indicators for one- and two-family residences (WSEC 2006,
   "A recommendation for an enhanced Fujita scale", Texas Tech; DI 2). Declared bands for this game,
   inside those indicators: roof covering 38-49 m/s, roof structure 50-60 m/s, exterior walls 61-74
   m/s, broken glass in doors and windows about 43 m/s (DI 2 DOD 3, expected 96 mph). Pressure is
   q = 0.5 rho V^2 (rho 1.225 kg/m^3) times an external coefficient: roof uplift Cp -1.0 over the
   field and -1.5 at eaves, ridge and gable edges (ASCE 7-16 ch. 30 zones 1 to 3), walls +0.8
   windward, -0.7 side, -0.5 leeward (ASCE 7-16 fig. 27.3-1), plus internal pressure GCpi 0.18 while
   the house is enclosed and 0.55 once an opening has broken (ASCE 7-16 table 26.13-1). Water: FEMA
   P-646 (2019) hydrodynamic force F = 0.5 rho_s Cd b h u^2 with rho_s 1100 kg/m^3 (sea water with
   sediment) and Cd 2.0, the impulsive surge at the leading edge 1.5 x the hydrodynamic force (FEMA
   P-646 eq. 6-7), and the hydrostatic push 0.5 rho_s g b h^2 while the interior is still dry. Masonry fails only above about 5 m flow depth (Suppasri et al. 2013, Nat. Hazards 66: 319-341,
   masonry and RC washed away mostly above 5-6 m). Failure order the player should see: windows and
   doors, wall panels one by one, the roof lifting off; never the house moving as one block.
2. **Source of truth.** Wind, water height and flow from `DisasterField.sample` (one sample per
   building per frame at its centre), ground from `TerrainData.heightAt`, capacities scattered per
   event by `EventRandom.capacityFactor` (new stream `STREAM.component`, CAPACITY_COV of the
   building material). The components are the building's own authored spans (`structure()` tags).
3. **Budget.** CPU only: one field sample per exposed house per frame and a loop over its 30 to 60
   components (24 village buildings, about 1000 components, under 0.1 ms). Rigid pieces spawn at
   most 8 per second (burst 8) inside the existing 224-body structure budget; no new draws (the
   pieces move vertices inside the existing merged village batches).
4. **Detail by distance.** Large pieces (mass over 25 kg or longest side over 1.5 m) within 150 m of
   the camera become rigid bodies; smaller or farther pieces collapse their vertices and go to the
   debris hook (`StructuralDamage.onDebris(fn)`) for the tornado's GPU debris renderer to draw. A failed component that waits for a spawn token
   stays drawn in place; it never pops. Reset restores every vertex and collider.
7. **Edges.** Utilisation reads only the field (wind, water, flow), never a piece's own motion. Openings breached before walls are tested in the same frame, so the interior floods and the
   hydrostatic term stops. Non-finite field values give zero load. Wind loads only the height of a
   part above its own ground (`exposed` in `stepComponents`, ground read at the part's centre):
   stilt pad stones sit about 73% in the soil and took the whole 80 m/s core load on their full face
   before this (96 of 98 failed in the node test; 23 of 80 masonry parts in the browser test). Stones are binned by 3 m cell and by height, so a chimney never carries the pad stones at its foot. Colliders: a failed part takes only its own collider. On a record's first failure its shell box
   (the one box over the whole body) is swapped for one slab per wall and masonry part in the shell's
   frame; each failure drops its part's slab. Before this the first rigid piece disabled every
   collider of the house and the walls still standing became walk-through (37 of 43 in the node test). A door or window piece spawns inside its standing wall's slab and is pushed out of it by the solver.
8. **Evidence plan.** `test/building-damage.mjs` on the real village records (TerrainData + Village):
   45 m/s fails roofing before walls; 50 m/s strips the roofs and leaves over 80% of walls standing;
   a 2 m/s, 1.5 m flood breaks the submerged doors and windows and no masonry; the body spawn rate
   stays under its bound; standing pieces never move; after one panel per house fails, the player's
   capsule walking into any standing wall is stopped and a ray through the failed panel passes; an
   80 m/s wind fails no stone more than two thirds buried and over half the masonry standing clear of
   the ground. BDD `test/browser/disaster-buildings.spec.js` reads each part's failure game time
   (`failedAt`) and asserts the first roof sheet goes strictly before the first wall panel.

## Model (buildings)

`src/disasters/BuildingComponents.js` sorts a house's spans into components: openings (glass, and
door-sized wood panels), wall panels (wood below the eave, binned by side and 3 m bay), roof covering
sheets (roofMetal, thatch), roof structure (wood above the eave, one per roof side), masonry (stone)
and fittings (hard, rope, net, flag; they ride with the nearest component). Each component's
capacity is the declared band centre turned into a pressure, times the per-event capacity factor.
A failed roof frame takes its sheets; a failed wall panel takes the openings and fittings inside it.
Houses, sheds, the boathouse and the market stall use this path (`structure(..., {progressive:true})`);
the pier, boardwalks and other decks keep the jointed module path.

## Not done yet

Bend sway in the vegetation shader (reads `t.util`); pre-fractured terminals.
