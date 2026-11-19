# Transported tornado dust, mist and condensate

`TornadoVisuals(app, field)` adds one cloud mesh and one small-litter mesh to the scene. `update(dt)` reads the active tornado; `clear()` removes emission and drawn instances. `Disasters` owns these calls, so pause, stop and restore share the physical-load lifecycle. This replaces the separate 36-step condensation volume. There is no independent upper optical tube.

## Grain transport

`TornadoParticles` holds a fixed pool of 1,280 aerosol parcels and 64 leaf/wood flecks. An aerosol is a statistical cloud containing many equal spherical mineral grains or water droplets. Its physical grain diameter, in metres, sets aerodynamic response. Its separate metre-scale optical radius describes the cloud, not a giant physical grain.

Carrier air comes from `DisasterField.sample`, including registered wake modifiers. Relative-air drag uses Schiller–Naumann spherical-particle drag. [NASA Ames' supplement, equation 4](https://www.nas.nasa.gov/assets/nas/pdf/staff/Shariff_K_Making_aircraft_vortices_visible_water_spray_supplemental.pdf) states the correlation and its approximately 5% accuracy below Reynolds number 800. The constant drag coefficient 0.44 above Reynolds number 1,000 follows the [OpenFOAM Foundation implementation](https://cpp.openfoam.org/v13/SchillerNaumann_8C_source.html). These are empirical spherical-grain assumptions. Droplet breakup and resolved grain shape are omitted.

The existing `AerosolDynamics.js` integrator is unchanged. Gravity, air buoyancy and drag are integrated together using a frozen-rate exponential update, including displacement. It is exact for constant linear Stokes drag and constant carrier velocity. At finite Reynolds number, reevaluation at intervals no longer than 1/60 second gives a first-order approximation. The existing 100-micrometre, 20 m/s, 0.1-second benchmark has displacement errors of 4.31%, 2.18% and 1.09% at 60, 120 and 240 Hz against an independent fine-step RK4 reference.

Evaporation changes the physical droplet diameter used by the next drag step. Optical cloud radius and shading noise do not enter the grain drag law. Flecks retain the shared `DisasterField.acceleration`, mass/area response and gravity; their visual spin and terrain contact are approximations. Large debris, cars, trees and structural pieces retain their native rigid-body solver.

## Reduced liquid lifecycle and entrainment

`TornadoPlume.js` adds an explicit one-way closure. It does not solve atmospheric vapour, pressure or heat. [Kumar, Schumacher and Shaw, equation 26](https://arxiv.org/pdf/1112.5012) uses `r dr/dt = K (RH - 1)`. For diameter `d = 2r`, the implemented constant-step solution is:

```text
d_next² = max(0, d² - 8 K (1 - RH) dt)
grain mass = density × π d³ / 6
cloud liquid mass = droplet number × grain mass
nominal extinction area = droplet number × Qext × π d² / 4
```

`K` has units m²/s and `RH` is dimensionless. The factor eight follows from the radius law; a diameter-squared coefficient must not be substituted unchanged. The default `K = 5e-11 m²/s`, source `RH = 1`, ambient `RH = 0.84` and geometric extinction efficiency `Qext = 2` are assumed reduced-model parameters. The paper supplies physical rationale, not calibration for this island. Supersaturated growth, temperature dependence, ventilation corrections and vapour feedback are not simulated. Evaporated liquid transfers to a counted, unrendered vapour reservoir. Mineral grains do not evaporate.

Entrainment speed is `u_e = alpha × |sampled air velocity|`, in m/s. The assumed dimensionless `alpha` varies smoothly from 0.035 to 0.16 with height. The [particle-laden plume experiments](https://arxiv.org/abs/2109.01240) motivate an entrainment closure but do not establish these tornado coefficients. Cloud radius grows through positive entrainment and diffusion:

```text
R_next = sqrt((R + u_e dt)² + 4 D dt)
unmixed_fraction_next = unmixed_fraction × (R / R_next)³
RH_cloud = RH_ambient + (RH_source - RH_ambient) × unmixed_fraction
```

`D` is an assumed diffusivity in m²/s: 0.8–2.0 times radius scale for ground clouds and 2.0–4.0 times scale for condensate. The split is exact for either constant diffusion alone or constant entrainment alone, and first order when both act together. Ambient humidity approaches 0.84 smoothly away from the moist core and aloft. The old nominal volume height, `130 × radius / 100` metres, is only a continuous mixing scale. It does not clip particles, velocity or optical radius. Parcels can rise above it and become dilute or evaporate there.

Two smooth curl modes give nearby parcels the same unresolved eddy velocity, independent of IDs and birth cohorts. Their assumed event-wide amplitude is bounded by the intensity parameter; this is prescribed subgrid motion, not a new atmospheric fluid solve or feedback to the shared field. Its amplitude does not track every local wake deficit. The combined prescribed carrier is not claimed to be globally divergence free.

## Source and matter accounting

Ground sources still depend on actual local horizontal air speed. The assumed thresholds are 6 m/s for soil and 12 m/s for spray. Elevated condensate requires an actual updraft. Its source cross-section opens gradually with height; the source spans 8–120 times the radius scale in metres and then travels freely. Condensate starts at 8–28 micrometres; spray and mineral grain sizes are unchanged. Source cloud radius also grows gradually with source height, representing larger moist volumes aloft. These are appearance-oriented source assumptions, not a soil erosion, sea-spray or thermodynamic nucleation solver.

A shared smooth three-dimensional moisture pattern is sampled at each condensate birth. Neighbouring births see nearby values; IDs do not choose the moisture. The prescribed source pattern moves upward at 0.22 times the intensity parameter. A cloud retains its source moisture, humidity (0.94–1) and number-loading weight (0.16–2.36), then entrainment dilutes that source state. This is a heterogeneous prescribed source, not resolved vapour transport or a measured nucleation law.

Each cloud gains grain number smoothly over its first 0.6 second. Added source mass and extinction use its current representative diameter. This keeps the statistical source budget explicit, but does not resolve multiple droplet ages within a parcel. Mineral and spray number remain inferred from assumed optical loading. Condensate instead uses an explicit assumed mean liquid-water content of 0.06 g/m³ (6e-5 kg/m³). Its mean optical cloud volume is 4πR³/3, nominal liquid mass is concentration times that volume times shared updraft/moisture loading, and droplet number is nominal mass divided by physical droplet mass. Extinction then follows droplet number and diameter. This optical volume is a reduced statistical representation, not a resolved thermodynamic cell. Reported kilograms are model quantities, not measured atmospheric loading or water removed from the sea.

Randomized 7–14-second pool lifetimes bound memory and runtime. The former emission demand filled the 1,280-slot pool and stopped ground dust emission: the actual mineral birth rate at event seconds 6/7/8 was 0/1/6 after 273 at second 4. The revised actual birth rate is capped at capacity/14 per second, multiplied only by the event envelope. Intensity goes into a statistical source weight, not an extra multiplier above that capacity bound:

```text
weight = (14 / 5) × clamp(intensity / 75, 0.15, 1.5)
represented radius = base radius × cube_root(weight)
represented volume = base volume × weight
```

Condensate mass uses that represented volume once, so mean source concentration stays unchanged. Mineral/spray extinction uses the base cloud area times the statistical weight once. This preserves intended homogeneous-source mass/extinction flux while reducing the number of represented births. With heterogeneous source positions, moisture and grain sizes, the equality is a statistical sampling approximation, not an exact identity for every realized time interval. The source still has the same fixed maximum storage, with no forced early slot reuse or position discontinuity. During the final 35% of a cloud's life, its population transfers smoothly to a counted, unrendered far-field reservoir. This retirement is a computational boundary; it does not destroy mineral matter or represent mineral evaporation. Terrain and water encounters transfer the remaining cloud into deposited matter.

For each material, `snapshot().budget` exposes source, live, exported and deposited mass in kg and nominal extinction area in m². Liquid additionally reports evaporated mass and extinction. The balances are:

```text
source dust = live dust + exported dust + deposited dust
source liquid = live liquid + exported liquid + deposited liquid + evaporated liquid
```

The same balance applies to nominal extinction area with the corresponding evaporation term. Spreading lowers projected density while preserving grain number and nominal extinction. During the last two seconds of an event, a decreasing duration-only factor exports the remaining represented population smoothly. The rising startup envelope never enters this retirement factor. At natural expiry any residual population is exported, the meshes disappear and `completedBudget` retains the final balance until an explicit clear or new event. `clear()` resets event and completed budgets, as intended for Stop/Restore.

## Shared optics and motion history

Dust, spray and condensate use the same far-to-near instanced soft-cloud path at every height. Its radial kernel is `exp(-3.4 q) × (1 - smoothstep(0.62, 1, q))`, where `q` is squared normalized billboard radius. The radial integral is `π R² × 0.274597137431334`; dividing extinction area by this accounts for the kernel's projected density. Two existing 3D noise reads use a shared advected world coordinate, so nearby clouds contain coherent optical irregularity instead of independent noise that averages into a smooth column. This modulation is normalized approximately in the ensemble, not exactly per cloud. The nominal CPU extinction budget is therefore not an exact per-frame rendered flux integral.

Beer–Lambert transmittance uses `1 - exp(-opticalDepth)` and premultiplies colour once. Opaque scene depth clips a soft cloud chord, avoiding a hard billboard centre-plane seam. This follows the depth-soft particle principle in [NVIDIA GPU Gems 3, chapter 23](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles). Transparent water is absent from the opaque depth buffer. Cloud ordering, lighting, multiple scattering and the planar density projection remain optical approximations.

Motion history includes world position, cloud radius, rotation and previous camera-facing orientation. A reused pool slot starts with matching current and previous values. After GPU submission prior values settle to current values, so paused renders do not reuse the last moving frame's particle velocity. Stop and restore draw zero instances until another event starts.

## Cost and verification

The fixed pools use two draws, at most 3,328 triangles, zero volume ray steps and 262,144 bytes of static noise texels. No density grid is rebuilt per frame. Removing the volume reduces one draw and ray marching, while greater cloud radius can increase overdraw. Actual cost requires controlled browser measurement; triangle count alone does not predict it.

`app.disasters.tornadoVisuals.snapshot()` exposes the budget, evaporation count, maximum cloud radius, liquid-cloud count, source/deposition/expiry counts and real poses. A parcel exposes `diameter`, `initialDiameter`, `liquidFraction` (remaining mass fraction per droplet), `grainMass`, `number`, `cloudMass`, `extinctionArea`, `relativeHumidity`, `mixedFraction`, `sourceMoisture`, `sourceHumidity`, `sourceLoading`, `id` and `cycle`. `completedBudget` retains the final accounted natural-expiry balance. These are observations for verification, not user-facing controls.

```sh
node --test test/tornado-visuals.mjs test/tornado-aerosols.mjs test/tornado-plume.mjs
PW_PORT=5210 PW_RENDER_SCALE=1 PW_OUT=test-results/local npx playwright test test/browser/disasters.spec.js -g 'Tornado:' --workers=1
```

The final plume and director selection passes 25/25; the normal simulation suite also includes grain transport and the other aerosol regressions. Exact tests against buildable original particle and volume modules pass 12 unchanged/analytic cases and fail five intended production expectations: liquid evaporation, entrainment spreading, spatially shared eddies, matter budgets and a single optical population. The final source cases also fail against candidate1 behavior and pass unchanged on candidate2: they check actual upper emission geometry and statistical grain population before metadata. Separate cases cover continuous spatial moisture and the real Field.advance → TornadoVisuals.update duration crossing with both mass and area budgets. Candidate3 adds exact concentration-to-mass/extinction injection, the independently calculated constant-source weighting fixture, and actual continuous ground emission over 54 seconds at both 1/60-second and 0.1-second steps. The unchanged production seeding and steady-source tests fail against candidate2 for wrong seeded liquid mass and measured pool starvation, then pass in candidate3. Tests retain size-dependent grain transport, analytical settling, finite-Re convergence, shared wake response, deposition, pause, reset and submitted motion history.

The staged full-pool flat-terrain diagnostic uses the actual field at 100 m/s, 180 m radius and zero translation. Candidate3 emits 72–74 mineral clouds per second after startup across the 55-second observation, and retains roughly 197–224 visible low clouds at 6–18 seconds instead of the former 99 at second 8. Across 80–320 m, no sampled row's peak unmodulated opacity falls below 0.1. At 8/12/16 seconds, the minimum row peak across 0–80 m is 0.441/0.368/0.299. These orthographic kernel estimates exclude GPU noise, camera, lighting and scene depth; they are not visual acceptance. Visible particles remain free to rise beyond the old fixed volume height.

Candidate1 passed the actual UI lifecycle BDD and GPU compilation, but was rejected after all five wide and five detail frames were inspected: it removed the old high chimney while leaving a narrow, weak middle column. Candidate2 added a broader heterogeneous source, but its ten full frames still showed intermittent detached upper puffs and a weak ground connection. Candidate3 addresses the measured under-loaded condensate inventory and demonstrated finite-pool starvation. It does not change validated shared air, physical grain drag or native debris forces.

The root identified a separate transparent-cloud temporal-accumulation defect in an actual GPU translation/spreading fixture. Settled particle transforms alone did not prevent a stale silhouette against opaque background depth. The scoped correction adds a cloud-coverage reactive mask: current and previous coverage reject stale temporal history without modifying shared water mask channels. The root owns that renderer coupling and its maintained actual GPU regression. It is a temporal reconstruction approximation, not another particle force or optical-mass term.

All five wide and five detail candidate3 frames were inspected. They show a stronger continuous lower connection and varying soft cloud width; upper tips form changing lobes. The near-horizon connection remains thinner, and some upper haze is still smooth. Both actual capture summaries report zero renderer/page errors, settled pause-history error zero and Restore returning to ten native bodies with zero broken structures. The integrated ordinary-UI lifecycle test passes: the same captured liquid cohorts shrink while rising, dry grains retain their diameter, Pause preserves poses and submitted motion history, and Stop/Restore/restart clears and recreates the plume. The final full frame and continuous motion were independently inspected. The main current limitations are smooth upper haze, transparent layering and the reduced statistical source, not an independently moving optical tube.

The production GPU fixture measures about 5.986 screen pixels of motion per frame across 4,568 samples. Eight frames after exposure, its plume-history error is zero; Stop clears 6,533 observed coverage pixels. A stack of 160 faint overlapping clouds still marks the reactive mask, and 2,162 water-mask samples remain unchanged. All twelve complete diagnostic frames were inspected. At 1,440×900 the reactive history adds about 5.18 MB, one mask copy and up to eighteen mask reads per output pixel. This protects plume edges from stale history but costs bandwidth; pool size and triangle count do not establish full-scene FPS.
