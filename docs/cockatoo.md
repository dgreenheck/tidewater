# The pet cockatoo

The player has a sulphur-crested cockatoo (*Cacatua galerita*). It rides his left shoulder, flies off now and then
to explore, and always comes back. Code: `src/player/Cockatoo.js`. Model: `public/models/cockatoo.glb`.

## Model

- Shipped mesh and texture: "Sulphur-Crested Cockatoo" by AlexGiardiniere (https://sketchfab.com/3d-models/sulphur-crested-cockatoo-18fca4e421094c789c63cd78565e38b6, uid 18fca4e421094c789c63cd78565e38b6),
  CC BY 4.0, used verbatim: 8,778 triangles, one 512 px texture, its geometry and UVs unchanged. The source file is
  `tools/cockatoo/source/sulphur-crested-cockatoo-18fca4e4.glb`. The credit is also written into the GLB (`asset.extras`).
- `tools/cockatoo/cockatoo_import.py` fits it to the rig. It runs `cockatoo_build.py` for the armature, clips and export
  settings, then:
  - places the sourced mesh on the PERCH pose (beak, tail and sole fit, feet on the foot bones);
  - skins it by shell. The body takes the procedural bird's weights. The wings are banded across the tertials,
    secondaries and primaries so they open in flight. Each crest plume is rigid on its own crest bone, with the pivot
    moved to its root. The skull and upper beak are rigid on `head`. The lower beak rides `jaw`, with the hinge moved
    to it;
  - inverts the skinning, so PERCH reproduces the sourced bird and the rest pose is the spread-wing pose.
  - adds an open flight wing, because the source only has a folded one. It is the procedural bird's wing: ten
    primaries that fan into slotted fingers, secondaries and tertials lengthened to a cockatoo's broad chord (about
    24 cm at the secondaries, `--chord 2.0`), layered coverts and a sulphur wash beneath, tinted to the source's white.
    Its root is pulled into the sourced body so there is no gap at the shoulder;
  - puts each folded wing shell on its own bone, `shell_L`/`shell_R`. The game scales `upper_*` to nothing while
    perched and `shell_*` to nothing in flight, crossing over as `flightW` rises (0.02 to 0.3 opens the flight wing,
    0.12 to 0.4 tucks the shell away). `state()` reports `wingScale` and `shellScale`;
  - lowers the crest by search: each crest shell, and the front quill that grows out of the skull shell, gets the
    rotation back about its root that lays it flattest on the crown (the quill bends over a three-bone chain so it
    does not tear). The `crest` clip is re-keyed so it raises each bone from there to the source's own raised crest.
- `tools/cockatoo/cockatoo_build.py` is kept as the fully procedural fallback (no third-party content). Run on its own,
  it overwrites `public/models/cockatoo.glb` with the procedural bird described below.
- Real size: 48 cm beak to tail, about 1 m span.
- A lofted body, neck and head with a tiled plumage texture. A deep hooked two-part beak in dark slate. Dark eyes in a
  bare blue-white eye ring. Grey scaly zygodactyl feet (two toes forward, two back) with dark claws.
- Alpha-cut feather cards (one double-sided material): ten primaries, eleven secondaries and three tertials a wing,
  with greater, median and lesser coverts and a yellow wash under the wing. Twelve tail feathers in a rounded, roofed
  fan with yellow beneath. Ten separate lemon-yellow crest feathers that curl at the tip. Contour feathers over the
  neck and body, pale yellow on the cheeks.
- Rebuild the shipped (sourced) model with its turnaround, or (second line) the procedural fallback:

```sh
blender -b -P tools/cockatoo/cockatoo_import.py -- --render test-results/cockatoo-turn
blender -b -P tools/cockatoo/cockatoo_build.py -- --render test-results/cockatoo-turn
```

## Rig and poses

- 70 bones: `root`, `neck1`, `neck2`, `head`, `jaw`, `tail`, and per side `thigh`, `foot`, `upper`, `fore`, `hand`,
  `p1`-`p10` (one per primary), `s0`-`s3` (secondary groups), `t` (tertials), `r1`-`r6` (tail feathers), plus the
  crest `c0`-`c9` and the folded-shell bones `shell_L`/`shell_R`.
- No baked animation. The clips are poses the game blends every frame: `perch`, `glide`, `flare` (full poses),
  `flap` (one wing beat, 1 s, t = 0.25 is the level glide phase), and overlays `crest`, `beak`, `look_l`, `look_r`,
  `look_up`, `look_down`, `tilt`, `preen`, `tailfan` (deltas on the perch pose).
- Every clip keys every bone. The glTF exporter otherwise fills unkeyed bones from the NLA mix, which put wrong wing
  poses into the overlays.
- The blend is written into the skinned model's rest pose (`SkinnedModel.rest`, no layers), then `model.update(dt)`.

## Behaviour

| State (`state().mode`) | What it does |
| --- | --- |
| `perched` | Standing on his left shoulder: its toes on the shirt over the trapezius, between the neck and the shoulder tip, a little forward of centre, leaning a touch in toward his head. The shirt height is measured every frame on his skinned mesh (a fixed patch of avatar triangles CPU skinned with his own joint matrices), so it rides the bob as he walks and runs; each leg takes up the slope under its own foot and the claws hook 4 mm into the fabric. First person keeps the old rule (further out and back, off the view). Quick head turns, bobbing, preening, sidesteps, a feather rouse, a wing stretch, a crest flick. |
| `exploring` | Every 40 to 120 s it squawks and takes off. It flies to points 6 to 13 m out, lands on perches (the pier rails and huts from `Birds.js`, the ground, or thin rails on the ferry) for 6 to 20 s, hops once or twice, then returns. |
| `flying` | Returning, circling over him while he swims, or heading for the car. The final approach is a braking curve with legs down, a flare and short fast beats, and it tracks his moving shoulder. |
| `riding` | In the car or at a helm it flies to him and rides along out of sight. It reappears on his shoulder, squawking, when he steps out. |

- Flight: the shared model in `src/world/wildlife/Flight.js` with profile `FLIGHT.cockatoo` (4.6 Hz deep beats,
  short glides, 10.5 m/s cruise, agile banking).
- Leash: soft 18 m, hard 30 m. A resting bird leaves when he walks 12 m away, or 8 m if he is running. A teleport
  (free camera, respawn) puts it back on his shoulder.
- On the ferry its perches are in her frame. In flight it flies in the world and keeps up with her.
- First person: it sits further out and back on the shoulder, so it stays out of the forward view and peeks in when
  he looks left.
- Squawks: on take-off, often on landing, at random (15 to 45 s), and when he lands a fish. Each raises the crest and
  opens the beak.

## Keys

- **B**: whistle. It leaves its perch and flies straight back to his shoulder.

## Sound

- `public/audio/cockatoo.ogg`: seven calls sliced from a real recording by `tools/audio/build-cockatoo.mjs`. The bank
  entry is `cockatoo` in `src/audio/soundBank.js`, played by `SoundScape.squawk(position)` (spatialised, `MIX.squawk`).

## Test hooks

- `window.__app.cockatoo.state()` (read-only): `mode`, `detail`, `goal`, `landing`, `position`, `distance`,
  `maxDistance`, `shoulderDist` (to the left upper-arm bone, about 0.09 m), `forwardDot`, `footGap` (m, lowest toe point of the worse foot against his shirt: + above, - sunk in; about -0.004 by design, null off the shoulder or in first person), `footGaps` and `footLift` (per foot, left then right), `settle` (the body's settle this frame), `onSkin`, `crest`, `beak`, `squawks`,
  `lastSquawk` (`reason`, `crestPeak`), `trip` (`maxDistance`, `landedAway`, `back`), `snaps`, `spot`.
- `?cockatoo=fast` shortens every interval (take-off after 4 to 7 s, rests of 2 to 3 s, squawks every 3 to 6 s).
- `?cockatoo=off` leaves the bird at home.

## Credits

- Model: [Sulphur-Crested Cockatoo](https://sketchfab.com/3d-models/sulphur-crested-cockatoo-18fca4e421094c789c63cd78565e38b6) by [AlexGiardiniere](https://sketchfab.com/AlexGiardiniere), Sketchfab, CC BY 4.0.
- Squawks: [Sulphur Crested Cockatoo](https://freesound.org/s/783046/) by jacques.devosmalan@gmail.com, Freesound, CC0 1.0.
- Model reference photos (not shipped): Wikimedia Commons "Cacatua galerita -Sydney -upper body -crest-8-3c.jpg"
  (CC BY-SA 2.0) and "Sulphur-crested cockatoo (Cacatua galerita galerita) Sydney.jpg" (CC BY-SA 4.0).

## Plumage colour in shade and texture detail

The body is the Sketchfab scan's single 512 x 512 texture (the source GLB has nothing larger; the import does not downsize it). `src/player/Cockatoo.js` passes a `materials` option to `SkinnedModel.create` that balances the plumage and wing albedo a touch toward cream (x 1.03, 1.0, 0.9) and adds a soft feather sheen, so in blue skylight shade (the ferry deck) he reads warm white rather than blue-grey. Close-up feather detail is still limited by the 512 scan; a detail layer (tiled feather albedo and normal in UV space, or a rebake at 2k) is the next step.

## Shoulder perch out on the shoulder point (defects round 2)

`Cockatoo.js` PERCH moved from the trapezius by the neck (x 0.08, z 0.012, lean 0.07 in toward the head) to the point
of the shoulder over the deltoid (x 0.135, z 0, lean 0), and CROUCH from 0.014 to 0.006 so he sits up on his legs.
Nearer the neck the man's head hid the bird's head and crest from behind and he read as a white scarf at the collar.
PAD (0.0125) and GRIP are unchanged, so the feet still sit on the CPU-skinned shoulder patch. Still open: seated on
the jetski the rider leans forward and the bird's frame leans with the shoulder, so from the seat quarter he reads
as a diagonal white band. A full world-up basis was tried and tipped him outward on land, so it was reverted.

## Feather detail and back smoothing (round 2)

What: the sourced body material `plumage` had one 512 px albedo and no normal map, so up close he read soft and flat.
`cockatoo_import.py` step 5b (`feather_layer`) now bakes two 1024 px images in the source's own UV space:
`body_feather_nrm` (PNG, tangent space, OpenGL +Y, wired through a Normal Map node at strength 0.8, so the GLB carries
`normalTexture` scale 0.8) and `body_feather_col` (JPEG q92), which replaces the source albedo in place.

How: about 1,500 feather centres are dart-thrown over the perched mesh, per UV island. Each feather gets a frame along
the feather flow: away from the bill, bending back and down the neck, flanks and breast (radial from the beak tip,
blended into the beak-to-tail axis); along each crest feather (root to tip); along the folded wing's long axis. Spacing
is about 3 mm on the head, 6 to 6.5 mm on the body and 9 mm at the tail. On the folded wing the feathers lengthen
toward the tip, so the coverts give way to long flight-feather edges. Front rows lie on top, so the exposed tips make
soft scallops. Barbs run at 38 degrees off a faint rachis. Crest feathers get barbs and a rachis only. The height is
evaluated in 3D and read out per texel, with gradients taken one texel step along each chart's own UV axes, so the
pattern runs on across UV seams and the gutters are dilated 6 texels. The albedo is a bicubic 2x upscale times a few
percent of the same pattern (under-lip shade and tip edges darker and a touch cooler, rachis a hair brighter),
normalised by its local mean. Region mean shift: white, yellow and whole image under 0.05 percent, grey under
0.25 percent. The grey beak, feet and dark eye are masked out by albedo value and by island. Cost: +364 KB of GLB.
Geometry, UVs, skin, the rig, every clip and the asset and scene extras are byte-identical (checked by parsing both
GLBs).

Back smoothing: a Taubin smooth of the body's back and mantle (up-facing in rest, nape to rump) is in the script
behind `--back-smooth N`, but it is OFF by default. Both variants tried made the back lumpier in close-up renders.
Normal-only creased the irregular mesh. Full-vector left a knob at the nape border and sank the mantle, so the folded
wing shells' inner edges stood proud. The lumps are those shell edges sitting on the mantle, not mesh noise. The
likely fix is to fit the shells' inner edges to the body (open).

Rebuild: `Blender -b --factory-startup -P tools/cockatoo/cockatoo_import.py --` (add `--feather 0 --back-smooth 0`
for the pre-round-2 GLB, byte-identical to it). Close-ups: `--render <dir> --only m` renders `m1_back_close`,
`m2_head_close34` and `m3_side_close` at 96 samples.

## Round 3 (character defects)

- Crest: the sourced crest (four stubby pale lime shells and two skull plumes) is gone. The skull plumes are pressed onto
  the skull (`--quill` capped at 0.05), the crest shells are deleted before the join. The crest is now the builder's ten
  feather cards on bones c0..c9, on the open wing's feather atlas (`wing_feathers`, alpha cut): carried with the head,
  each quill 1.5 mm into the crown (`--crest-shift -0.012`, `--crest-len 0.7`), each vane turned 90 degrees about its
  shaft so it shows side-on (a curved blade from the side, not a spike). PERCH lays them back at 4 to 20 degrees (the
  shaft may run 4 mm into the crown feathers), and `crest` raises them to the builder's forward fan. The atlas crest
  slot is lifted to sulphur (yellow saturation x1.4). Off switch: `--new-crest 0`.
- Thighs: tan texels on the leg shells and within 2 to 4.5 cm of them go to the plumage white (luminance kept), and the
  leg shells get the feather relief (grey scales masked by value). Tail: the tail tip albedo was already white
  (mean 0.893, 0.887, 0.857); its blue look is sky light on the shaded underside. The underside of the tail gets a pale
  sulphur wash (30 percent) and dark shading at the tip is lifted to 86 percent of the white.
- Back: the folded shells' inner edges are eased onto the mantle (`--shell-fit 0.010`, 246 verts, up to 2.5 mm).
- Mirror: +X side UVs of the body and shells shift 4.5 by 2.7 texels at 1k, faded in 4 to 14 mm off the midline.
- Normal map: the engine ignores `normalTexture.scale` (src/engine/render/Skinning.js reads only the texture), so the
  0.8 strength is baked into `body_feather_nrm` and the material strength is 1.0.
- The dark sliver past the folded wing (above and behind): a leg part (it goes with the legs hidden), but not the four
  toe shells (`--toe-in 12` did not move it; the switch is left at 0). Open.

## Round 4 (character defects)

- Crest at rest is one hook: the ten cards' roots gather to 30 percent of their spread (`--crest-span 0.3`), the set is
  36 mm (front) to 52 mm (back) (`--crest-lens`), the vanes are 1.9x wider so they overlap (`--crest-width`), the
  outer half of each card rolls up and forward 50 degrees (`--crest-curl`), and each card turns and stretches so its
  tip lands 1.2 mm down the back card's chord (12 degrees rise) from the one behind (`--crest-hook 12,0.0012`). The
  `crest` clip still raises them to the builder's forward fan. Colour: the atlas crest slot is sulphur (0.98, 0.84,
  0.25) at each texel's luminance, floored at 0.66, so the base goes sulphur into white, not olive (`--crest-lum`).
- Forehead: the pressed plumes and three rings round them are relaxed (skull radius may only drop, `--brow-smooth 12`,
  max 7.1 mm), then any vertex standing 0.8 mm above its ring on the forehead and crown is relaxed too (`--knob`), and
  yellow texels over the forehead and crown go to the plumage white. The small feathered cere over the bill is the
  source's and stays.
- Folded wings: each shell's height over the back (not the flank) is scaled to 55 percent from a third of the way down
  (`--wing-flat`), the tips swing in and cross the midline by 4 mm, the left over the right (`--wing-cross`). The
  shells' feather relief is 1.8x (`--shell-relief`). `stretch` swings them 21 degrees out and 16 up (was 15 and 14).
- The dark sliver past the wing edge: found by casting the m1 camera's rays (`--render dir --only m probe`): the outer
  edge of each foot (bone `foot_L` / `foot_R`, big leg island, 20 to 22.6 mm off the midline). The part beyond 16 mm is
  drawn in to 40 percent (`--foot-in 0.4`, 126 verts, 22.6 -> 18.6 mm). `--leg-in` (an outline pull on the thighs) is
  OFF: it tore the belly.
- Tail tip: shade lifted to 93 percent of the white and warmed (1.0, 0.975, 0.925), so it reads warm white in shade.
- Size: the perched model is 36 cm beak to tail; src/player/Cockatoo.js draws it 1.3x (47 cm, SIZE), except in the cage.
- Symmetric views for the mirror check: `s1_back_sym`, `s2_front_sym`, `s3_top_sym`; flight from behind: `f3_glide_back`.

## Round 5 (crest fan)

- Up close the round 4 crest read as one flat yellow blade: every card was turned and stretched (x0.6 to x1.6) to put
  its tip 1.2 mm down one shared line, so the ten tips landed within about 11 mm of each other, on quills 2.2 mm either
  side of the midline. `--crest-hook` is gone.
- Now each card keeps its own length, 34 mm (front) to 62 mm (back) with a small per-card spread (`--crest-lens
  0.034,0.062`, no stretch), and lies back at its own chord rise, 0 degrees (front) to 14 (back) plus a small spread
  (`--crest-rise 0,14`). The quills sit up to 3.5 mm either side of the midline, alternating (`--crest-rootx 0.0035`),
  and each card turns about the vertical through its quill so its tip sits up to 2.4 mm off the midline on its own side
  (`--crest-fan 0.0024`). The curl grows from the short front cards (about 18 degrees) to the long back ones (about 62,
  `--crest-curl 50` times 0.35 to 1.25, with a per-card spread), so the back of the set hooks up and forward. The vanes
  are 1.6x wide (`--crest-width`), so the separate feather ends show. Half degree lift steps keep neighbours from
  jumping when a card has to clear the crown.
- Build log: `crest tip spacing mm [5.4, 4.7, 8.1, 4.2, 8.1, 5.4, 6.2, 4.7, 5.3]` (c2 to c3 and c4 to c5 are wider: the
  front three cards lift about 25 degrees to clear the crown, the next two about 13). Card lengths 37 to 55 mm.
- The `crest` clip keeps the builder's raised angles (62 degrees at the front to 147.5 at the back, `LOW = ph - (62 +
  9.5 m)`), so it still fans from up-and-back to up-and-forward. Atlas colour unchanged (sulphur into a white base).
- Close-up renders: `--render <dir> --only m2,m4,m5,m6` adds `m4_head_top`, `m5_crest_raised34` and `m6_head_side`,
  aimed at the c5 quill.
