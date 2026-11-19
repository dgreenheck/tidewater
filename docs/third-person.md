# Third person and the player's own body

On foot (walking, swimming, the fishing boat's deck, the ferry's decks) the player can see
their own character from over the shoulder, or wear it in first person.

## Controls

- **V** switches first / third person on foot. At the fishing boat's helm and the ferry's helm
  V keeps its old job (their own camera toggles).
- The rail on the right has a button for the same switch, named for the view it goes to:
  "Third person" or "First person". It shows only while on foot.
- In third person the mouse orbits (it is the same look as first person), the scroll wheel zooms
  from 1.5 to 8 m, and W moves along the camera's heading.
- The choice is remembered per browser (`localStorage['tidewater.view']`). A new player, or a browser that blocks storage, starts in third person.

## Files

| File | What |
| --- | --- |
| `src/player/Avatar.js` | Loads `models/characters/player.glb`, else `joe.glb`; follows the player; locomotion blend, jumps, swim; folds the head away in first person; `state()` for tests. |
| `src/player/ThirdPersonCamera.js` | The boom: shoulder point 0.4 m right of the head, then straight back 3.5 m (zoom 1.5 to 8 m), pulled in against colliders, terrain and the ferry's boxes. |
| `src/player/Player.js` | `view`, `setView` / `toggleView`, `finishView( dt )` after each on-foot mode placed the first-person camera, `updateAvatar( dt, { attached, hidden } )`. |
| `src/ferry/FerryDeck.js` | `boomHit( origin, dir, maxDist )`: the boom against her solid boxes, in her frame. |
| `src/ui/AppUI.js`, `src/ui/ui.css` | The rail button; the interaction prompt moves right of the character in third person. |
| `src/App.js` | Passes `scene` to the player and calls `player.updateAvatar()` every frame (hidden in the car). |

## How it works

- Every on-foot mode still places the camera at the eyes exactly as before. In third person
  `finishView()` then swings it out: rotation is the view's own (no lag), the pivot height is
  eased (stairs, jumps, swim bob), the boom snaps in when blocked and eases back out. Past a thin
  thing (a pier brace, a stringer, a pile) it pulls in quickly, but at once when the brace would sit
  within `BOOM.lens` (0.9 m) of the lens, and swimming, the waterline lift is cast again so it never
  lifts the lens into a brace (under the pier: 12 of 505 frames inside a brace before, 0 after).
- The character stands at the feet, turned with the ship on the ferry and the boat on the deck.
  In third person it faces the way it moves and keeps its heading standing still; in first
  person it faces the view, stands 0.14 m behind the eyes (more when looking down, so the near
  plane never cuts the shoulders), and its head and neck skin are folded to a point at the base
  of the neck. Its shadow therefore has no head in first person.
- Locomotion is a 1D blend space over ground speed: idle, walk, run, sprint, all sharing one
  stride phase, played at speed / clipSpeed so the feet don't slide. With a walk cycle playing,
  the first-person head bob and the footstep sounds follow the character's footfalls.
- Hidden in the car and at the helms; held (no animation) and hidden beyond 90 m of the camera.
- Cost: about 0.07 ms of CPU per frame (animation, blend, joint upload), measured in
  `test/browser/third-person.spec.js`.

## What player.glb must carry (asset contract)

- glTF Y up, facing +Z, feet on y = 0, in place (no root motion).
- Clips `idle`, `walk`, `run`, `sprint`, `jump_start`, `jump_loop`, `jump_land`; optional `swim`.
  Each locomotion loop is exactly one stride and starts on the same foot (left heel down at
  t = 0): the loops share one phase.
- Scene extras `clipSpeeds { walk, run, sprint }` in m/s (defaults 1.4, 3.8, 6.0) and
  `bones { head, neck, ... }` (node names or indices). Without them the head is found by a node
  name ending in "Head" / "Neck".
- A `swim` clip should keep the eyes near 1.6 m above the feet origin: the swimmer is placed with
  its eyes at the surface.

## Tests

`test/browser/third-person.spec.js`: V and the button on the beach (and the choice remembered),
walking, first person looking down at the legs, the ferry stairs in third person with the camera
kept inside her hull, and the frame-time probe.

## Swimming

`player.glb` carries three water loops, keyed in `tools/characters/player.py` (Rocketbox has none). They are drawn upright
(head up, belly forward) and the game pitches the whole body:

- `tread` (1.6 s): upright, slight lean, both hands sculling a flat figure eight, egg-beater legs. The hat stays on.
- `swim` (4 s, three 1.33 s arm cycles): front crawl. Hands enter ahead of the head, high-elbow catch, pull under the body,
  push past the hip, high-elbow recovery; body roll about 38 degrees, head counter-rolled and turned to breathe every third
  stroke (left, then right); six-beat flutter kick.
- `swim_under` (2.2 s): breaststroke pull-out. Arms sweep out and back to the thighs, glide, recover under the body into a
  streamline as the frog kick drives, glide.

While swimming the hat tips back off his head onto its cord and hangs pinned to his upper back (a `Hat` joint under the head).

Runtime (`src/player/Avatar.js`, frame data from `Player.updateAvatar()`: `eyeY`, `waterY`, `floating`):

- At the surface `tread` and `swim` blend by horizontal speed (0.15 to 0.9 m/s); under water `swim_under` plays. Each loop
  plays at speed / `extras.swim.speed` (swim 1.5 m/s, swim_under 1.3 m/s). Weights ease at 4/s, so wading in and climbing out
  crossfade with the land clips.
- The body pitches about the neck: towards `extras.swim.pitch` (78 degrees) with speed at the surface, along the velocity
  under water (head first, clamped 20 to 160 degrees), and eases back upright on land. It faces the way he moves.
- The body hangs from the posed neck: treading, the neck 5 cm above the old eye-based spot (water at the chin); swimming at
  the surface, the neck 3 cm under the water so the back, head and recovering arms break the surface (the sea renders
  opaque); under water it follows the swimmer. The jump between feet placement and neck placement is eased out over 0.25 s.
- `f.pos` in swim mode is still the feet of an upright body with its eyes at the swimmer's eyes (the stand-in model uses it).
- First person: the body sits a further 16 cm back while in the water, so the strokes never cut the near plane.
- `avatar.state()` reports `water` (the three loop weights) and `bodyPitchDeg`.

## Ragdoll (src/player/Ragdoll.js)

The player's body goes limp as a real ragdoll in three places: the car yeet (Y, src/rally/Bailout.js), a big
fall on foot (a drop over 3 m, or landing faster than 8.5 m/s), and `app.player.ragdoll( impulse, point, opts )`
for other systems.

- **Thrown:** a velocity-only launch over 6 m/s across the ground (a jetski wipe-out) tumbles head over heels, up to 7 rad/s, and the limbs flail (random kicks every 0.22 s, joint damping 1.5) until he lands, reaches the sea or 2 s pass. Launches with `spin` or an `impulse` (the car yeet, knocks) skip it.
- **Bodies:** the 14 capsules in player.glb's scene extras `ragdoll` (tools/characters/player.py), 75 kg split by
  segment. XPBD rigid bodies in JS, 6 substeps a frame with two joint passes each. Cone and twist limits about
  the idle pose (thighs biased 35 degrees forward, upper arms 45 degrees out); elbows and knees are hinges that
  only bend the human way (forearms may still turn the palm within `twist`).
- **What it hits:** the terrain heightfield with its slope, walkable boxes, walls (box and cylinder colliders),
  the rally's palm trunks, the reef, and the sea (buoyancy by depth, the chest floats highest, and drag). Not cars,
  not the ferry's or the boat's moving decks: `ragdoll()` refuses in the `ferry`, `ferry-helm`, `deck` and `boat` modes.
- **Hand-off:** it starts from the pose as last drawn (or a named clip), at the body's velocity. When the body is
  still for 1 s, each body turns in the world (0.6 s, the short way, so no limb sweeps through the ground) to the
  lying first frame of `getup_back` (sit up, tuck the legs, right hand down, stand) or `getup_belly` (push up, hands
  and knees, kneel, left foot forward, stand), whichever way up he lies. The stand spot is set back so that frame's
  hips land where his are. The clip (1.4 s or 1.87 s) plays out into the idle, then control returns (mode `walk`).
  Both clips are keyed in tools/characters/player.py (GETUPS), and the build log's `getup dips` line reports any
  frame where a knee, ankle, toe or wrist dips under the game's ground margins. A model without them falls back to
  straightening flat and rising through jump_land's crouch. Floating at the surface it fades into treading water
  (mode `swim`). The HUD chip reads Tumbling, then Getting up.
- **Camera:** third person follows the pelvis on a smoothed boom (never more than 0.5 m behind). First person switches
  to that boom for the tumble, except the car yeet, where the view rides in his head and eases up to standing eyes.
- **The cockatoo** takes off squawking and circles while `player.mode === 'ragdoll'`, and lands back after the get-up.
- **Cost:** about 0.15 to 0.35 ms a frame while active, nothing when idle.

### The API

```js
// impulse: kg m/s (world), at a world point (null: the chest; off the centre of mass it spins him)
app.player.ragdoll( impulse, point, {
	velocity,  // the body's velocity (default: his own)
	at,        // place the pelvis here (world), facing `heading` (model yaw), posed as clip `pose`
	heading, pose,
	spin,      // a tumble (world rad/s)
	yeet,      // first person keeps the view in his head
} ); // -> false where it cannot (no character yet, aboard the ferry or the boat)
```

Already ragdolling, a second call adds its impulse. `app.player.rag.state()` reports the phase, the pelvis and the
run's stats (ms, joint limit excess in degrees, lowest clearance, NaN count).

**Jetski (Jetski.throwRider):** in `throwRider( kind )`, replace `p.mode = 'jetski-thrown';` with

```js
if ( ! p.ragdoll( null, null, { velocity: vel } ) ) p.mode = 'jetski-thrown';
```

(the rider leaves from the pose he was drawn in on the ski, at `vel`; `updateThrown` must only run while
`p.mode === 'jetski-thrown'`). **Townsfolk bumps:** `app.player.ragdoll( push, contactPoint )` with `push` about
40 to 80 kg m/s for a shove, 150 or more for a knock-down.

## Get-up clips: the hat clears the ground

`tools/characters/player.py` keys `getup_back` and `getup_belly` through `gpose(..., hat=1|-1)`. At every key it measures the lowest point of the hat (every crown, brim and band vertex, carried on the `Hat` joint) and, while that sits under 2 cm above the ground, first nudges the head (face down: face lifted a little more; on the back: chin tucked a little) and then tips the hat on its joint (face down: back, off the forehead; on the back: forward, over the eyes), the least of both that clears. The build log prints `hat tilt <clip> (lowest before, head nudge deg, hat tilt deg, lowest after)` per key, and the dips report lists any frame where the hat is below the ground. Current result: belly frame 0 tilts the hat back 9 degrees (0.002 m to 0.026 m); back frame 0 tucks the chin 15 degrees and tips the hat 18 degrees (-0.026 m to 0.021 m). Every other clip is byte-identical.

## Hair edges, belly get-up hands, rod on the ferry (defects round 2)

- Hair: the hair cards (material `opacity`, alpha BLEND) were drawn as a hard 0.5 alpha cut. `Avatar.js` now passes a
  `HAIR` surface snippet through `SkinnedModel.create( gltf, { materials } )`: coverage is ramped around the old cut
  (alpha 0.27 to 0.73 maps to 0 to 1) and tested against an interleaved-gradient dither that moves every frame
  (`frame.frameIndex`), so TAA averages the edge. No engine change. Static and walking close-ups showed no speckle.
- Belly get-up: between keys 0 and 9 the hands swept down through the ground (5.5 cm, frames 4 to 8) and the right
  shin at 13 to 15. `player.py` GETUPS `getup_belly` now has in-betweens at frames 3, 6 and 14 (each snapped like the
  others). The `getup dips` report now lists anything past 1 cm; getup_belly reports none. Only that clip changed.
- Rod on the ferry: aboard at deck local y 10 with open sky, R equips and `rod_hold` plays at full weight in third
  person (`avatar.rodClip === 'rod_hold'`). Note `FerryDeck.openSky` casts up from the camera, and it passes inside
  the enclosed room at local y 10, whose ceiling is not a solid box.

## Character round 3

- Ferry open sky: the bridge deckhouse roof (ferry_build.py ROOF3 13.2 m) had no collider, so `FerryDeck.openSky` passed inside the deckhouse and the rod came out indoors. `FerryDeck` now adds a solid roof box over the deckhouse floor's footprint (constructor). Measured: sun deck (local 0, 10, 2.2) fishable, rod_hold on R; deckhouse (0, 10, 10.5) and lower saloon (0, 7, 8.55) refused, rod stays stowed. The roof also stops the third-person boom rising through it and the bird's `roofed()` sees it.
- Jetski perch: `Cockatoo.shoulder()` cancels the rider's forward lean (pitch about his left axis) while `player.mode === 'jetski'`; the roll is kept. Foot gap stays -0.3 / -0.4 cm.
- Joe's ice: `StallKit` ice shading is neutral grey-white, each facet clear (dark wet body) or frosted, clearcoat roughness 0.015. `FishStand.crushedIce` heaps chunks up the fish flanks (under-fish cut r < 0.55, heap 2 cm peaking at r 0.85).

## Ragdoll water entry (2026-09-27)

`Ragdoll.ENTRY`: thrown into the sea at speed he skims and tumbles across it and bobs up. Per body, by how deep it
sits: planing (C |v| v_down, never reversing the sink in a step), skim (C (v_h^2 - 8^2), a shallow entry skips) and a
quadratic drag. Thrown at 46 m/s (rag-probe set-up): pelvis depth 2.80 -> 0.46 m, head 2.34 -> 0.77 m, skips 1 -> 3,
head clear of the surface 3.52 -> 2.23 s after entry, treading 5.60 -> 4.25 s. The third-person ragdoll camera stays
0.35 m above the sea at the focus (`Player.updateRagdoll`; it went 2 m under before). `player.ragWaterCam = false`
turns the clamp off for comparisons.

## Non-finite guards (2026-09-27)

- `Player.keepFinite()` runs at the top of `update()` (a NaN set from outside, such as a probe teleport to `x - u * d`
  with a zero-length `u`) and again after the walk / swim step and the people contact push. A non-finite position goes
  back to the last good one with zero velocity, logged once; `waterMean` restarts from `waterH` if it went non-finite.
  It happens in the same frame, so no NaN pose is drawn and the upscaler history is never touched.
- `ThirdPersonCamera.apply()` ends with the same check: its eased pivot height `y` and boom length `dist` ease from
  their last value, so a NaN in `y` stayed for good (53/54 black frames in the red probe). This frame falls back to
  the eyes; `y` and `dist` are set up again.
- Probe note: the beach3 walk-to divided by the camera-to-player offset, which is zero in first person (the default
  view now), so it teleported the player to NaN. Measure the offset in third person or guard the length.

## Hat down his back and the skin fade (round 5, player-hat-hair)

- **Hat in the water.** `Avatar.poseHat()` writes the Hat joint's matrix after the pose, the same way `collapseHead` does. In the swim mode (treading, surface crawl, under water) the hat comes off his head over 0.35 s. It then hangs down his back: `Spine2 joint x sway x extras.hat.back`. `back` is the rest-space move from the head to the shoulder blades, built in `tools/characters/player.py` as `T_REST`: crown out along the fitted back plane's normal, brim front up at the neck, held off the skin by the most any vertex under the brim stands proud, plus the brim's dip.
- **Sway.** A damped spring on lift (away from the back only) and roll (about the back's normal). It is driven by turning, slowing down and a slow bob while he moves, and pivots on the brim's top edge (`extras.hat.pivot`).
- **Out of the water.** The hat goes back on over 0.55 s, including on the jetski and in the ragdoll get-up. The crown's centre travels along an arc out behind the head (so it never cuts through the skull) while the rotation slerps. Once the hat is on, the clip's own Hat keys are left alone, so the get-up tilts still apply. The hood cam still folds Hat and HatCord away with the head.
- **Chin cord.** A new joint, `HatCord`, sits under `Bip01 Head`. The cord runs from inside the crown at the sweatband, between the brim and the back, over the trapezius, and round the neck to a loose loop with a toggle bead at the throat. Its last 12 mm at each end ride the Hat joint; the rest rides HatCord. HatCord follows Spine2 while the hat is down its back, and is folded to a point inside the crown (`extras.hat.stow`) while the hat is on.
- **Blender clips.** `swim` and `swim_under` key the same pose (`hat_back()`); the game overrides it live.
- **Build probe.** The build logs `hat probe`: body vertices inside the hat per clip (tread 0, swim 3, swim_under 1 at the worst frame) and the minimum gap under the brim.
- **Crown fix.** The crease was `z -= ...` on the ring's own z, so it piled up point by point round each ring and the crown's top spiralled down into the head. That left the crown open from above, which is what you see when the hat is down his back. The get-up keys did not change.
- **Haircut.** A mid skin fade from `hair_fields()` (one function for the texels and the mesh), with heights taken from the brow joint:
  - skin to 6 cm under the brow line;
  - a clipper shadow of stubble dots to 1 cm under it;
  - 1 to 2 cm on the sides (about 3.5 mm of volume, a little skin showing through);
  - a textured top with forward-swept tufts and clump ridges, 11 mm mean and 19 mm maximum volume;
  - a crisp forehead and temple line-up with a faded sideburn, and a square neckline.
- **How the hair is built.** The Rocketbox hair cards are gone (the eyelashes stay). The old painted strands on the scalp, temples and nape are refilled from the surrounding skin, because they pass a hue test for skin, so nothing is kept by colour. The volume is a subdivided scalp shell pushed out along the normal. It is tucked 2.5 mm under the skin past the line-up and down in the fade, so the same texels show through and there is no seam. It is clamped 3.5 mm inside the crown, band and sweatband (123 vertices clamped), so no hair pokes through the hat.

## Haircut and skin, round 6 (player-hair2)

Requirement: the player needs a proper fade haircut; the round 5 hair read as dull. The review of round 5 found a clay-helmet top with a hard shelf, camo-block skin patches, a flat light band on the forehead and dark triangles at the temples.

- **Skin fill.** Round 5 filled the old painted hair with texel-space box blurs, and a hard switch between two radii left rectangles. The fill is now a normalised convolution in 3D (a 4 mm voxel grid over the head, about 1.5 and 4 cm wide), so it never mixes texels across a UV seam and has no box edges. Only texels that really are old hair are replaced: darker than 0.74 to 0.92 of the skin round them, or the dense old hair mass. The zone ramps in from its own edge in 3D, and the real skin keeps its pores. The fill gets pores, normals and roughness back from a 96-texel forehead patch, tiled periodically by cross-fading it with itself rolled half a tile (a mirror tile shows its axes as lines). A bias fix undoes the light read of the bright-skin pick. The fill takes in the stubbled cheek, and the stubble carries on up the filled sideburn.
- **Ear.** Old strands were painted over the ear, so it is in the fill. It keeps its own normals, and a band-pass of the old luminance (3 mm over 12 mm, darkening only) gives back its fold shading.
- **Temple triangles.** These were two leftover Rocketbox hair-card faces (opacity material, |x| > 5 cm), now removed with the rest (494 of 494).
- **Mouth box.** The rectangular lips mask cut the beard stubble in a hard box. It is now a soft ellipse.
- **The fade, clipper-graded.** Follicles (a fraction of about D of the texels) are drawn as short strokes down the head that lengthen as D rises, over a grey-blue stubble shadow. The line-up is 1 mm crisp at the forehead and temples.
- **The top.** The shell is only 3 to 5 mm now; it hides the scalp. The length comes from about 350 tapered clumps, 3 to 5 cm long, combed forward from a crown whorl and lifting towards the front. Each clump is walked over the scalp, stops at the hairline or where the fade starts, and is clamped 3.5 mm inside the crown, band and sweatband (0 clamps needed). All clumps ride `Bip01 Head`. They use a strand swatch painted into an empty corner of the head sheet (asserted empty): dark roots, sun-lightened tips at the front only, dark gaps between strands, roughness 0.66 to 0.8. The head sheets are padded 16 texels past their islands' edges so mips and JPEG never pull in the black.
- **Cost.** 32,966 tris, up from 21,446. The GLB is 4.3 MB. All 22 clips, 82 joints and the extras are byte-identical to round 5 (`glbdiff.py`).
- **Reference photos.** Still owed. Round 5's code comment points here, but no URLs were ever recorded. Two or three Commons or CC photos of a men's mid skin fade (side and back) should be linked here and matched side by side.
- **Debug hook.** `player.debugPlace( x, y, z, mode )` (in `Player.js`, for probes and captures only) puts him in `walk` or `swim` the way `finishRagdoll` does. It zeroes the velocity, re-reads the water level and resets the camera easing; `update()` then applies the usual depth rules. Probe gotchas:
  - his forward is (-sin yaw, -cos yaw);
  - `setFreeCam( true )` takes the keys, and leaving it hands the free camera's yaw and pitch to him.
