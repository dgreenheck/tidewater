# Blacktip reef sharks

Three **Carcharhinus melanopterus** patrol the reef at 1.50, 1.42 and 1.34 m total length. Choose **Watch sharks** in World controls for a close underwater view. This moves the free camera, not the animals. WASD explores the water; F returns to the player. Watching is refused while actively driving a vehicle or holding the ferry helm. Choose **Shark bite demo** for a moving close-up: the lead shark opens its jaws, approaches a harmless neutrally buoyant rubber target, closes on it, transfers a contact impulse, releases and closes again. Moving or dragging leaves the tracking camera. Repeating the action reuses the same three sharks and one target.

The [Florida Museum species profile](https://www.floridamuseum.ufl.edu/discover-fish/species-profiles/blacktip-reef-shark/) describes a short rounded snout, grey/brown upper body, pale underside, black fin tips with pale borders, and adults generally below 1.6 m. These references guide the authored anatomy. The island combines fauna from several regions; this is an illustrative Indo-Pacific species, not a claim that the existing Caribbean reef assemblage is geographically exact.

## Editable model

- `assets/shark/blacktip-reef.blend`: named editable body, two dorsal fins, paired pectoral and pelvic fins, anal fin, unequal vertical caudal lobes, layered iris/pupil/eyelids, nostril recesses with skin flaps, five raised gill flaps and recessed slits per side, small head sensory pores, and a subterminal mouth with shaped lips, a real cavity, gums and 100 small teeth in the nearest mesh. Named lower-jaw hinge and upper-palate controls have an editable 65-frame open/contact/release/close animation; frame 1 is the closed rest pose. Studio lights and camera are included.
- The generator can also write an interchange export with the same named controls and jaw animation.
- `public/models/shark/blacktip.json` and `.bin`: the same authoring geometry in the engine's packed format, with vertex-painted countershading per-vertex roughness and rigid jaw weights. The runtime adds subtle individual skin tint and body-space roughness variation that fades below pixel size; the eyes have a separate glossy finish.
- `tools/wildlife/shark_build.py`: reproducible Blender generator. Run `blender --background --factory-startup --python tools/wildlife/shark_build.py` from the repository root. `--no-render` omits the five studio PNGs, including an open-jaw review.

The three mesh levels contain approximately 53.0k, 16.5k and 4.1k triangles. All sharks share the geometry; each uses one draw per render pass. Distance selects the level at 16 and 50 m; beyond 220 m the body is culled. A posterior travelling wave displaces the body and vertical tail laterally. Pitch and bank come from motion, and the shader supplies the previous body and jaw pose for motion vectors. All three levels keep the lower-jaw and upper-palate articulation; the middle level reduces tooth rows, and the far level omits the individual teeth. The animal never uses a dolphin's vertical fluke stroke.

## Physical contract and assumptions

`SharkBrain` is a fixed-step control model at 60 Hz, independent of the renderer and wall clock. Its explicit engineering assumptions are:

| Quantity | Value |
| --- | --- |
| Nominal mass | 10 kg |
| Relative-water cruise / burst speed | 0.85 / 2.4 m/s |
| Frontal area / drag coefficient | 0.055 m² / 0.25 |
| Propulsion acceleration limit | 1.1 m/s² |
| Turn rate / angular acceleration limit | 0.8 rad/s / 1.6 rad/s² |
| Lateral acceleration limit | 1.2 m/s² |
| Water-current entrainment time constant | 0.8 s |
| Vertical speed / acceleration limit | 0.75 m/s / 0.65 m/s² |
| Root clearance below water / above terrain | 0.50 / 0.65 m |

None of the speed, force, mass or response coefficients above is presented as a measured performance range for this species. The shared SI `dynamicPressure` function gives drag and feed-forward thrust using `F = ρ Cd A v² / 2`. Bounded acceleration changes the relative-water speed. Steering changes direction with bounded angular rate and acceleration.

Ambient flow is superimposed through an exact first-order entrainment solution, `dc/dt=(u-c)/τ`; its integrated displacement is also exact for a constant sampled current. This is a reduced propulsion/entrainment model, not fish-muscle biomechanics, added-mass hydrodynamics or full fluid–structure CFD. It does not apply a second buoyancy force on top of the depth controller.

Each individual samples the GPU ocean query for the combined FFT, shore, wake and disaster surface. The query already contains the disaster anomaly, so it is never added twice. CPU current and disturbance come from the same disaster field. A reset rejects GPU samples issued before that reset until a fresh query arrives. Unavailable or distant old GPU samples fall back to mean sea level plus the local disaster anomaly. Reef solid heights supplement terrain heights. Look-ahead steering and swept contact prevent movement through land and hulls without repositioning the shark. Spawn/reset alone may place individuals. Swimmers are avoided, not attacked.

Current above 1.8 m/s or disturbance above 0.65 triggers a temporary faster escape toward deeper water. It recovers after eight quiet seconds. The population is fixed; repeated watching creates no meshes or individuals. Ordinary patrol remains near its reef home; strong currents can transport an animal away and may outrun swimming authority. Current input is limited to ±35 m/s per axis. A frame gap above 0.25 s drops excess simulation time, reported in `state().droppedTime`. Abrupt drawdown can briefly expose an animal rather than teleporting it below the surface. Reef/hull clearance is a conservative body-envelope approximation, not contact between every triangle.

## Jaw animation and contact

The lower jaw rotates about the authored hinge with a 0.65 rad (37.2°) opening limit, 2.2 rad/s maximum angular speed and 10 rad/s² drive acceleration. The upper palate moves forward 10 mm and down 4 mm at full opening. Opening, holding open, closing, contact hold, release and recovery are coordinated with the existing swimming and steering controller. These dimensions and drive parameters are transparent animation assumptions, not measured bite kinematics or force for this species.

Contact uses 25 lower tooth-tip paths swept against the moving target sphere at the same 60 Hz step. The render mesh and physical contact rig share the hinge and tooth coordinates. A near-mouth target is not automatically a hit: only a swept overlap during closing with positive approach speed counts. A miss completes without a contact impulse. The target uses a 36 mm radius, sea-water-equivalent mass (about 0.20 kg), quadratic drag with assumed Cd 0.47 and the same sampled ambient current. It has no attraction spring or scripted motion toward the teeth.

At contact, the solver uses `J = (1 + e) v / (1/m_target + 1/m_shark)` with assumed restitution 0.2 and a 0.25 N·s impulse cap. The target receives that impulse and the shark receives the equal opposite impulse, then hydrodynamic damping dissipates their response. The contact toast reports the actual impulse. Strong disturbance cancels the demonstration. Restore island resets the jaw, target and contact history. There is no attack on people or graphic injury.

This is a bounded actuated demonstration, not a measured bite-force model. It approximates teeth with 2.5 mm contact radii, does not solve every tooth triangle or tissue deformation, and the short contact hold does not attach the target to the jaw. The target remains free to recoil.

## Inspection and reset

`app.sharks.state()` returns a copy containing positions, velocity, depth, clearance, relative-water speed, entrained current, thrust, drag, yaw rate, phase, mode, visibility and population, plus jaw angle/velocity/phase, the actual render-jaw uniform, target position/velocity, contact count and the last measured contact impulse. `reset()` and `resetDisasterEffects()` restore the deterministic seed. The disaster pause freezes shark time and motion. Restore island uses the same reset hook.

`node --test test/sharks.mjs` checks analytical current displacement, drag balance, turn limits, changing water level, shore/hull clearance, flee/recovery, fixed-step cadence, reset, one simulated hour, independent swept-contact intersections, real jaw cycles and limits, momentum exchange, a true missed bite, shipped asset/hinge/weight consistency, target-current drag, and pause/cancellation during a bite. `PW_PORT=5198 PW_OUT=test-results/local npx playwright test test/browser/sharks.spec.js` executes the real Watch sharks, tsunami/pause/restore, active-fighter and hang-glider control guards, and jaw-open/contact/repeat/reset journeys. Only the external font CDN is mocked; product actions use real controls and telemetry is read-only.
