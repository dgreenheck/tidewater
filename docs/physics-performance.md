# Disaster physics performance recovery

Smooth-play acceptance remains open. This pass preserves the expanded material and human simulation and reduces redundant solver work. Severe village destruction still renders too slowly in the measured scenario; these changes do not establish real-time or scientifically validated disaster physics.

## What changed

The fixed-pose articulated contact solver now skips exactly zero impulses before constructing a response, uses indexed application loops, projects only the required components of effective-mass rows, and reuses a force input buffer. Contact normals and self-pair effective masses are cached only for their current substep. Mutable friction directions are evaluated on every call. Joint coordinates are reused only until an actual angular repair changes either body.

The inner contact iterations keep velocities in a Float64 buffer. Ground, self-contact and angular-limit queries read that current buffer. Velocities are published before observers and wall contacts, wall edits are imported before the final angular solve, and the completed substep publishes all body velocities. Frame-boundary inter-person contacts retain immediate updates.

No body budgets, contact iterations, joint parameters, timestep bounds, force amplitudes, material models, geometry, rendering quality or recovery thresholds were reduced. The initial pass kept the native binary unchanged; the follow-up below also changes native implementation and connection ordering. Existing disclosed force caps and emergency energy protections remain; retaining them is not scientific validation. The 3,000 m wave remains explicitly experimental.

## Matched full-scene measurements

Chromium headless with WebGPU/Metal, Standard 1,440 × 900. Each run uses a fresh context and the ordinary controls: tornado, Village, 100 m/s wind, 180 m radius, 60 s duration, View target. After an eight-second quiet settling period, the event is observed through age 24 s. The table covers actual sampled ages approximately 2.6–24 s. Timing has no video or CPU profiler; a passive frame/time observer and approximately one count snapshot per simulated second are retained.

| Version | Tornado travel | FPS | Simulated seconds / wall second | p95 frame interval |
| --- | ---: | ---: | ---: | ---: |
| Earlier coarse structure/rig baseline | 0 m/s | 22.67 | 0.999 | 64.6 ms |
| Expanded physics, before optimization | 0 m/s | 5.32 | 0.532 | 222.6 ms |
| Optimized expanded physics, run 1 | 0 m/s | 6.75 | 0.675 | 178.4 ms |
| Optimized expanded physics, run 2 | 0 m/s | 7.03 | 0.703 | 167.2 ms |
| Earlier coarse structure/rig baseline | 3 m/s | 19.97 | 1.000 | 71.5 ms |
| Expanded physics, before optimization | 3 m/s | 8.03 | 0.776 | 200.2 ms |
| Optimized expanded physics | 3 m/s | 8.96 | 0.874 | 147.0 ms |

The original baseline was restored to its exact original JavaScript and native binary in a separate checkout: 609 matching files plus an intentional QA Vite configuration difference. It had 87 structural bodies and no material connection graph in these runs; the expanded version had 224 structural bodies. Final native prop counts were 218–219 versus 355–356. Native prop counts exclude the car and structural anchor entities; the final stationary run also had 16 anchors and 430 connection records, of which 326 were broken. A body budget is not a total active solver-body count.

Initial loaded populations were 43–44 and changed with ordinary ferry/crowd activity. Final populations were 43–47. The stationary optimized runs observed 7–15 simultaneously simulated human rigs. The older baseline allows fewer rigs. Thus the historical rows compare integrated capabilities, not equal physical workloads, and full-scene before/after trajectories are not seeded. One moving run that overlapped an unrelated headless browser was excluded and repeated. These short local runs are not sustained performance guarantees.

The existing engine caps accepted frame time at 0.1 s. At fewer than ten frames per second, consuming all accepted physics time does not keep pace with wall time. The rate column exposes that slowdown. Recorded videos are separate verification runs and their container frame rates are not simulation FPS.

## Fixed-workload comparison

A separate CPU fixture uses the same eight authored character rigs, animated starting poses, terrain, shared tornado forces, inter-person contacts and eight simulated seconds in both versions. Three measured repetitions follow one warm-up for each cadence. Final poses, velocities, phases, consumed-time and protection accounting have identical serialized hashes; the recorded sim-phase substep counts also match.

| Accepted cadence | Before median CPU time | After median CPU time | Runtime reduction | Recorded sim-phase substeps |
| --- | ---: | ---: | ---: | ---: |
| 1/60 s | 7,873.95 ms | 6,587.40 ms | 16.34% | 47,864 |
| 0.1 s | 2,367.03 ms | 1,807.74 ms | 23.63% | 11,570 |

The fixture counts substeps only when a rig remains in simulation after an update, excluding transition-out frames; these are not total solver-substep counts. This isolates the solver optimization more closely than the evolving full scene. It excludes rendering and ordinary NPC behavior. The two cadence rows follow different physical trajectories and must not be compared as equivalent-fidelity settings.

## Remaining cost and limits

A separate 1,000 µs CPU-sampling run attributes overlapping stack unions of 31.54% to articulated simulation, 30.63% to native physics, 6.63% to the water solver and 9.02% to render-command work. Articulated mass solves and native contact solves remain prominent individual functions. Inclusive categories must not be added.

A diagnostic timestamp probe captures all compute/render passes in 15 sparse frames, with 43–47 passes per frame and no invalid or overflowed timestamps. Their median observed span is 12.78 ms and maximum 12.93 ms. Apple pass intervals overlap; individual durations are not additive. This span does not fully cover uploads, copies outside the measured pass span, queue delays or presentation, and is not a complete end-to-end GPU timer. Together with the CPU stacks and long frame intervals it supports a CPU bottleneck in this workload. Lowering visual resolution would not remove the dominant simulation work.

This is not proof of an irreducible performance floor. The follow-up below measures batched responses and native manifold costs. A larger parallel simulation design still needs explicit coupled-state publication, time/backpressure handling and conservation tests; moving work off the main thread alone does not prove real-time physics. The present high-force scene remains unsuitable for smooth play.

## Native contact and frame pacing

The vendored Avian contact patch avoids redundant work at stationary endpoints. The optional native comparison feature checks contact responses against the upstream solver. Production WebAssembly excludes the comparison code. The island advances at most three fixed physics steps per frame while a disaster is active. This slows simulation time under load without reducing solver detail.

Use `tools/articulated-benchmark.mjs` and the browser frame-time benchmark to repeat measurements on a particular machine. Compare runs with the same viewport, render scale, camera and event workload.
