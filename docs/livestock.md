# Island goats and cows

The Animals tool opens observation controls for six goats and four cows. Watching moves only the free camera. It preserves the animals' current location and declines while the player controls a vehicle. The herds graze, pause, walk, turn, maintain spacing, and seek reachable higher ground when a tsunami warning begins. Strong local wind, shaking or rising water changes their behaviour, but does not make them safe from the simulated loads.

`Livestock.init()` runs after the disaster director and island colliders exist. `Livestock.update(dt)` runs immediately before `Disasters.before(dt)`. The director's external `after` callback follows the native physics step and synchronizes visual animation and the player's walking collider. All ten animals remain native dynamic bodies in ordinary weather. There is no separate decorative movement path.

## Physical model and limits

The common field supplies air velocity, water level/current, buoyancy and support-gated ground acceleration. Existing native rigid-body contacts handle terrain, cars, props and debris. Each animal has one oriented box with a declared mass, projected area and displacement volume. The skin has twelve animated joints, but individual hooves, legs, horns and head are not collision bodies. This is a bounded whole-body model, not measured animal biomechanics.

| Assumed quantity | Goat | Cow |
| --- | ---: | ---: |
| Body mass | 55 kg | 550 kg |
| Box half extents X/Y/Z | 0.24 / 0.45 / 0.64 m | 0.43 / 0.72 / 1.12 m |
| Projected drag area | 0.72 m² | 2.7 m² |
| Displacement volume | mass / 950 kg/m³ | mass / 950 kg/m³ |
| Walking target speed | 1.05 m/s | 0.85 m/s |
| Fleeing target speed | 3.2 m/s | 2.5 m/s |
| Maximum ground motor force | 0.9 × mass × g | 0.9 × mass × g |
| Maximum stance/turn torque | mass × g × 0.32 m | mass × g × 0.52 m |

The ground motor turns toward a goal before stepping forward. Its assumed 0.62g forward feed-forward counters the native box's 0.6 contact friction; lateral braking is bounded to 65% of the box's passive tipping force (mass × g × lateral half-width / half-height). Forward effort is also limited by geometry and the 0.9-weight total traction cap. Effort decreases as the body leans. It never writes the body's velocity or position.

Balance uses actual native angular velocity from two point-velocity observations. Body-axis box inertia is rotated into the world frame before converting angular acceleration into torque. Assumed roll/pitch PD gains are 100 s⁻² and 20 s⁻¹; yaw gains are 12 s⁻² and 6 s⁻¹. The gains include the held frame interval through 1 / (1 + damping × dt + stiffness × dt²). Roll/pitch consumes stance torque first; yaw uses the remaining magnitude budget.

A supported tipped animal stops walking and attempts to rise through finite torque and a virtual leg-extension force. That upward force is at most 45% of its weight, tapers to zero by up·ground-normal = 0.9, and is always less than gravity. An inverted body's deterministic recovery axis follows its length. Recovery is disabled without solved native support and when water depth exceeds 55% of body height. This is an assumed whole-body stance actuator, not a simulated leg joint or measured muscle force. Wind, water and impacts can still overpower it. Unsupported animals receive no balance torque or recovery force. External wind, current, gravity and contacts continue. The shared dispatcher rejects non-finite loads and caps the combined force and torque at its existing 2 MN and 2 MNm operational limits.

The player walking collider is a yaw box while upright and a conservative rotated bounding box after a major fall. Native vehicle/debris contacts continue to use the oriented physical box. Grazing head and foot placement are animation approximations; skin animation does not displace terrain or solve individual hoof forces.

Habitat selection evaluates dry terrain, full footprint slope, static boxes/cylinders, actual tree trunks, road shoulder clearance and existing plant density. Decorative leaf envelopes help choose clear grazing and observation space; they do not introduce invisible solid physics colliders. No vegetation is removed or hidden. Navigation uses bounded sampled lookahead and local goal selection, not a complete island path planner. New moving debris can block an animal physically even when its navigation plan has not anticipated it.

The shared external-body budget is 48. This feature consumes ten slots. It fails visibly if the herd cannot obtain physical bodies rather than quietly creating immune decorations.

## Pause, Stop and Restore

Pause freezes the native bodies, animation phase and accumulated travel. Stop ends the disaster field while keeping current animal state. Restore recreates all ten native bodies from the snapshot taken before Start activates the field, including position, orientation, linear/angular velocity, behavioural state and animation layers. Walking colliders synchronize immediately. A failed Start discards partial capture, and a second experiment captures a fresh baseline. Restore does not affect game currency or saves.

## Original assets

`tools/wildlife/livestock_build.py` authors the meshes, vertex coats, twelve-joint skeletons and Idle/Walk/Graze/Alert clips in Blender. Editable files are `assets/livestock/goat.blend` and `cow.blend`; runtime assets are `public/models/livestock/*.glb`. Continuous skin joins, separate eyes, horizontal goat pupils, horn ridges, cloven hooves, beard and tail details are original geometry. Each animal draws one skinned mesh; immutable geometry is shared by species. No third-party animal artwork or model is used.

Regenerate with:

```sh
blender --background --factory-startup --python tools/wildlife/livestock_build.py
```

## Verification

`test/livestock.mjs` exercises production habitat/control/watch/reset methods and the shipped native WASM. It verifies support-only finite traction, angular velocity recovery, real walking, wind motion, repeated snapshots/restores, paused callbacks, immediate collider restoration, toppled collider bounds, road/foliage clearance and control ownership. `test/livestock-assets.mjs` validates the complete rigs and samples the production skinning matrices to verify grazing muzzles reach the grass. Only GPU upload transport is isolated in the skin calculation test.

`test/livestock-balance.mjs` adds heading-rotation invariance, bounded turning and support/flood gates, real native side/inverted recovery and airborne free fall, plus ten-body 60-second roaming on production island terrain and vegetation at frame intervals 1/30 s and 0.1 s. It reconstructs terrain, village, evacuation stairs and plant scatter; only GPU upload/rasterization and model drawing are isolated.

`test/browser/livestock.spec.js` contains maintained real-product Given/When/Then scenarios for observing both herds, native roaming/animation, actual vortex response, pause, repeated Restore and cockpit ownership. Browser contexts have fresh local storage. Only the external font CDN is mocked; observations of native poses and skin state are read-only. The model scripts are included in `test:simulation`, and Playwright discovers the scenarios in the normal browser suite.
