# Characters

The vendors (Joe at the fish stand, Marta at the chandlery) are avatars from the
[Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) library (MIT license,
`public/models/characters/LICENSE-Rocketbox.md`), converted offline to one GLB each
(`public/models/characters/joe.glb`, `marta.glb`): mesh (~7.5k triangles, 80-bone Bip01 skin),
1024² textures and the clips below.

    tools/characters/build.sh [workdir]      # fetch -> textures -> Blender -> public/models/characters/

- `fetch.sh`: one file from the Rocketbox repo (Git LFS media URL, raw fallback).
- `textures.sh`: the 2048² TGA maps to 1024² JPEG / PNG; the specular map becomes the roughness
  channel of an ORM texture (R 1, G roughness = 0.92 - 0.6 × specular, B metalness 0); the opacity
  map (hair, lashes) keeps its alpha.
- `convert.py` (Blender 4.2+, tested with 5.2, run in the background): imports the avatar, builds
  glTF-exportable materials (`body`, `head`, `opacity`), imports each clip FBX and retargets it by
  bone name in world space (the clips' skeleton rests with the arms down, the avatars in a T-pose,
  so local rotations can't be copied): every avatar bone copies its clip bone's world rotation
  (the pelvis also its position) and the result is baked, one NLA track per clip, exported as
  glTF animations.

Clips (the in-place `motextr_static` versions, `m_` for men and `f_` for women): `idle_neutral_01`,
`idle_breathe_01`, `idle_look_around_01`, `gestic_talk_neutral_01`, `gestic_talk_relaxed_01`,
`wave_01`, `gestic_shrug_01`.

Runtime: `engine/loaders/GLTF.js` (loadGLB) and `engine/render/Skinning.js` (SkinnedModel: clip
crossfades, GPU skinning, motion vectors, shadows); `game/Vendor.js` swaps the stand-in figure for
the character once it has loaded. `test/character-smoke.mjs <glb> <out.png> [clip]` renders one
headlessly.

## Player

`public/models/characters/player.glb` is the third-person player: Rocketbox `Adults/Male_Adult_01` (m002,
MIT) re-dressed as an original outdoorsy Aussie in a tropical shirt, khaki cargo shorts, clogs and a felt
bush hat. Mesh, hat and clogs are one skinned mesh (the engine only draws the first skinned mesh node):
14.2k triangles, 5 materials (`body`, `head`, `opacity`, `hat`, `clogs`), 2048² colour maps, about 4.2 MB.

    tools/characters/player.sh [workdir]     # fetch -> print tile -> Blender -> public/models/characters/player.glb

- `player_print.py` (Python 3 + Pillow): the original hibiscus and palm-frond print as a seamless tile.
- `player.py` (Blender 5.x): bakes the rest-pose world position into both UV maps, then repaints by body
  position, not by UV guesswork: shirt (print sampled around the torso and along each sleeve, fabric
  shading low-passed from the polo so its stripes vanish, open camp collar, placket, buttons, hem folds),
  cargo pockets on the shorts, tan, light stubble, and the sneakers become bare feet. Models the hat
  (tapered, creased crown, curled 8.8 cm brim, band; weighted 100 % to `Bip01 Head`) and the clogs
  (shell with ventilation holes, side vents, heel cup and strap; weights copied from the 4 nearest foot
  vertices). Retargets the clips by world rotation as `convert.py` does, but in place: each locomotion
  clip is rotated to face +Z (glTF), its root drift removed, its feet put back on y = 0, then measured.
  Keys `jump_start`, `jump_loop` and `jump_land` itself (Rocketbox has no jump). Patches the scene extras.
- `player_review.py` (Blender, evidence only): Cycles stills and cycle phases on a neutral stage.

Clips (Rocketbox `m_`, 30 fps): `idle` = static `idle_neutral_01`; `walk` = xy `walk_neutral_02`; `run` =
xy `run_neutral`; `sprint` = xy `run_fast_01` (each picked from its candidates by speed and source foot
slip); jumps are keyframed. No turn clips (Rocketbox's turns carry root rotation). The water loops `tread`, `swim` (front crawl) and `swim_under`
(breaststroke pull-out) are keyframed in `player.py` by two-bone IK, drawn upright; extras `swim` holds their pitch and speeds.
The hat has its own `Hat` joint under the head: the swim loops hang it on the upper back.

Scene extras (`gltf.json.scenes[0].extras`): `clipSpeeds` (m/s, the planted-foot speed of the in-place
clip: scale playback by speed / clipSpeed), `bones` (head, neck, pelvis, spine, chest, feet, toes, hands),
`ragdoll` (capsules per bone: `bone`, `to`, `radius`, `length`, `cone` / `twist` limits in degrees,
`hinge` for elbows and knees, `parent`), `heightM` (1.82 m to the top of the hair, without the hat).
