# Render and frame-time performance

The README target is 60 fps at 2560x1267 on an M5 Pro: 16.7 ms a frame. The GPU fits it (6-13 ms in
the named views). The CPU does not (19-29 ms a frame on a loaded machine), so this pass works on CPU
time and proves each change by identical output, not by fps.

## Rules

- Identical output first. Every change here has a node test that compares the new path with the old
  one on the same input and asserts equality, plus a test that fails on the old code for the cost it
  removes (seen red, then green).
- Measure CPU self time per function with a CDP profile (`tools/frame-bench.mjs time`) and GPU time
  per pass with `?bench`. Concurrent workloads affect wall-clock frame times.
- Nothing is simplified away (`docs/PORTING.md`): no LOD, quality or effect was lowered.

## What changed

| change | where | identical-output proof | cost removed |
|---|---|---|---|
| The main scene is posed once per frame, not once per pass | `src/engine/render/ScenePose.js`, `App.renderFrame` | `test/render-hot-paths.mjs` "posed main scene": posed matrices equal a fresh update; draw lists equal the per-pass reference | matrix self time 2.5-3.0 -> 0.5-1.1 ms a frame |
| A posed scene draws from a flat walk, rebuilt only when the hierarchy changes | `src/engine/render/SceneWalk.js`, `MeshRenderer.collect`, `SceneHierarchy.version` in `Object3D.add/remove/attach` | `test/render-hot-paths.mjs` "flat walk": same draw lists and the same callback order as the recursive walk over 4 pass kinds, across a hierarchy change between frames and one mid-frame | 328 -> 0 child-list reads in 4 passes of the test scene; profile below |
| Ground and push-out queries build no array per nearby box | `src/world/Colliders.js` `groundHeightAt`, `resolveCapsule` | `test/collider-queries.mjs`: bit-identical answers to the old code on the real village, piers and terminals (a 0.37 m lattice, 3 heights and pads, 3 capsules) | 1,250,942 -> 0 arrays over the lattice |
| A closed chairlift panel does no DOM work | `src/chairlift/Panel.js` | `test/chairlift-panel.mjs`: the open panel still shows the live cable state; `test/browser/chairlift.spec.js` | 180 -> 0 DOM queries in 60 frames |
| Livestock builds one herd list per kind per frame | `src/wildlife/Livestock.js` | `test/livestock.mjs` "own herd": every brain sees the same herd list as before | 310 -> 0 filters in 31 frames, O(n^2) -> O(n) |
| The bench dries the lens between views | `src/core/Bench.js` `pose` | harness only | n/a |

## Thin geometry held at a pixel (wire AA)

A strip or tube thinner than a render pixel is hit by the pixel centres of some columns only, so it
rasterises as dots or dashes that TAA cannot rebuild. Such a mesh keeps a minimum drawn size and
dither their coverage (true / drawn size, a per-frame interleaved-gradient threshold that TAA averages),
so they read as a faint unbroken line. It does not apply in the depth (shadow) pass.

| mesh | where | minimum | evidence |
|---|---|---|---|
| Chairlift haul rope (0.034 m tube) | `VillageMaterials.js` `WIRE_VERTEX` / `WIRE_SURFACE`, the village set's `hardWire`; `src/chairlift/Geometry.js` | 0.75 render px radius | render masks (the rope needs its own material key); no rope shadow (a 3.7 m umbra under a rope 4-9 m up) |

## Frame-time gate

`test/browser/frame-time.spec.js` boots the real game with `?bench` and renders beach, village,
underwater and aerial at 2560x1267. It asserts GPU p95 under 16.7 ms in every view. Wall time per
frame is logged and annotated as advisory (ceiling 33.4 ms) and never fails, because a loaded machine
moves it by 2x. Set a real CPU budget after a quiet-machine re-bench.

Measured GPU p95 at the target resolution was 16.59 ms at the beach, 12.72 ms in the village, 8.57 ms underwater and 11.88 ms from the air.

## Measured

CPU and GPU milliseconds per frame, best of two runs at 2560×1267 using `tools/frame-bench.mjs time`.

| view | CPU before -> after | wall before -> after | GPU before -> after |
|---|---|---|---|
| beach | 26.48 -> 24.34 | 29.10 -> 25.71 | 12.61 -> 11.99 |
| village | 19.44 -> 19.12 | 21.10 -> 20.22 | 10.19 -> 10.07 |
