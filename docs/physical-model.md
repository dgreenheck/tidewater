# Shared physical model

This document describes the `island-expansion` implementation. Tidewater is a real-time simulation with shared environmental fields and explicit reduced models. Numerical benchmark agreement below establishes particular behaviours; it does not establish predictive accuracy for an actual island, building, aircraft or evacuation plan.

## Units and ownership

Coordinates and lengths are metres; time is seconds; mass is kilograms; linear/angular velocity is m/s and rad/s; force is newtons; moment is N·m; energy is joules; electrical power is watts. `src/physics/Loads.js` supplies gravity 9.81 m/s², reference air density 1.225 kg/m³ and seawater density 1,025 kg/m³. These are fixed modelling inputs.

`DisasterField.sample(x,y,z)` is the common spatial source for ambient plus vortex wind, long-wave height/current and equivalent seismic support acceleration. Bodies use their own mass, area, displacement, shape and attachment model. `App.setAmbientWind` changes both the field and the existing FFT ocean. Boat/jetski and aviation water queries include the long wave once; no adapter adds a second copy of their existing buoyancy.

| System | Solved behaviour | Deliberate reduction |
| --- | --- | --- |
| Tsunami | Nonlinear depth-averaged finite-volume water, wet/dry flow over the heightfield, common CPU/GPU sampling | 8 m cells, imposed offshore pulse, artificial boundary sponge; no breaking-wave overturning, wall-resolved flow, erosion or seabed generation |
| Earthquake | Spatially varying prescribed acceleration; load through actual rigid-body support contacts and structural capacity rules | Ground mesh stays fixed; no elastic crust, soil liquefaction or detailed building finite elements |
| Tornado | Translating prescribed vortex with tangential flow, radial inflow and updraft; local body loads | No atmospheric fluid solver or scientifically assigned EF category |
| Buildings/vegetation/props | Material/area/mass-dependent demand; failed geometry moves with replacement rigid bodies; original colliders are removed transactionally | Coarse assemblies and simple collision shapes, assumed attachment capacities and finite debris budgets |
| Boat/jetski/ferry | Existing craft controls and hydrostatics coupled to shared currents, wind and flood surface | Craft-specific existing idealizations remain; ferry heave and surface attitude are reduced models |
| Fighter/carrier | Force/torque flight, stall transition, moving-deck contact, bounded catapult and work-accounted arrestor; carrier hydrostatics | Fictional aircraft coefficients; cable resultant at centre of mass; carrier has no structural breakup or compartment flooding |
| Wind farm | Aerodynamic and generator torque, rotor inertia, pitch/yaw/brake, power/energy, tower mode and failure | NREL reference parameters combined with assumed Cp surface, wake and foundation capacities; not a certified turbine model |
| Sharks | Finite swimming acceleration, current entrainment, terrain/obstacle avoidance, articulated jaws and swept tooth/target contact | Procedural animal behaviour and assumed contact coefficients; not a calibrated biological bite-force model |
| Hang glider | Unpowered lift/drag, weight-shift moments, finite launch run, stalls, terrain/water/static-proxy contact and controlled beach landing | Fictional polar, three swept contact probes, no thermals or resolved flexible-wing flow |
| Beach people | Warning response, collision-based walking on the actual route, shared wind/current loads, physical falls and debris contacts | Bounded game AI and capsule models, eight full ragdolls with simpler overflow response; no safety certification |
| Goats and cows | Ten native dynamic bodies, force-driven grazing/roaming, shared hazards and native debris/terrain contacts | One whole-body box per animal; animated limbs have no individual contacts and controller/biomechanics parameters are assumed |
| Player in floodwater | Live head-submersion transition, relative current/air drag, bounded voluntary swim propulsion and physical updraft loss of control | Existing reduced buoyancy and 14-capsule rig; assumed 18 m/s updraft control-loss threshold |
| Evacuation route | Physical walking surfaces, warning-linked guidance, elevation and actual sampled flood exposure | Fictional game route; no guaranteed protection under arbitrary disaster inputs |

## Equations, assumptions and measured checks

Relative-flow drag is `F = rho Cd A |u-v| (u-v) / 2`, and dynamic pressure is `q = rho V²/2`. The law is sourced; each object's coefficient and reference area remain separate model inputs. Tests cover zero relative velocity, speed-squared scaling, units and actual boat/jetski invariance when body, air and water velocities receive the same translation. [NASA drag equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/)

Buoyancy is `rho_water g V_sub`. A simple displaced-volume check and the carrier equilibrium test exercise that law. Box/cylinder submergence approximations do not resolve flooding through openings. Opposing hydrostatic wall pressures cancel for uniform water level; the structural model tests that cancellation rather than applying a spurious one-sided load.

The water equations evolve depth and both horizontal discharges. Hydrostatic reconstruction balances the terrain source. The small-amplitude long-wave relation is `c=sqrt(g h)`. Three-grid tests in 10 m water measured 9.90959, 9.90960 and 9.90929 m/s against 9.90454 m/s. Dry-bed Ritter mean-depth error decreased 0.1435 → 0.1246 → 0.1005 m as cell spacing halved. This is numerical convergence evidence; a published beach/runup calibration has not been performed. [Clawpack shallow-water equations](https://www.clawpack.org/riemann_book/html/Shallow_water.html), [NOAA propagation](https://www.noaa.gov/jetstream/tsunamis/tsunami-propagation), [hydrostatic reconstruction](https://epubs.siam.org/doi/10.1137/S1064827503431090)

Aircraft lift and induced drag use `L=q S CL` and `CD=CD0+CL²/(pi e AR)`. A synthetic independent example at 70 m/s gives 97,240.5 N lift and 9,063.7152 N drag for its declared inputs. The fictional Kestrel's coefficient curves, thrust and capacities are assumptions. Its maintained tests include takeoff, turning, stall, moving-deck support, swept wire capture/rejection, cable work and water impact. [NASA lift](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/), [NASA induced drag](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/)

The turbine uses published NREL 5 MW reference dimensions, inertias, rated settings and actuator values, with a separately declared simplified aerodynamic curve and single tower mode. Independent resonance comparison produced 0.0295871 m against the linear analytical 0.0295889 m at 0.001g; failure demand includes the amplified modal reaction. A torque/energy ledger and inertia removal on blade release prevent duplicate rotor energy accounting. Fragment box inertia is still an approximation. [NREL/TP-500-38060](https://www.osti.gov/servlets/purl/947422)

The farm's reduced wake model changes the shared air field once per consumer, including the glider and water-surface stress. Its Jensen-style deficit, geometric overlap and root-sum-square combination use explicitly assumed land-site expansion and turbulence parameters. The final local wind magnitude is bounded by the original wind magnitude; this is not a global atmospheric momentum solve. The rotor solver reads the raw field and applies its disk-averaged wake once. See the [wake equations, source and limitations](windfarm.md).

The unpowered glider uses the same lift/drag laws with a declared fictional 118 kg, 15.8 m² wing. Its independent neutral-polar balance gives 12.820070462 m/s and L/D 9.758383973; the energy check closes aerodynamic work and gravitational potential with the integrator. There is no added thermal or artificial ridge lift. The summit footpath is geometry with live colliders, not a player-position animation. See [glider controls and model](glider.md).

Beach characters use their actual supported/free state and declared adult/child masses. The warning AI cannot exempt them from water, wind, broken treads or falling debris. Eight full articulated rigs are budgeted; overflow uses the existing simpler physical fall/animation model. Route sensing, swimmer support, voluntary speed and stance thresholds remain gameplay assumptions. See [people response and bounds](people-evacuation.md).

Structural mass densities, root strength, anchor capacities, damping, mooring limits and the damage accumulation rule are declared assumptions in the subsystem documents. Labels such as timber or masonry are not claims of engineering calibration. The ground-excitation relation follows the supported-system convention, while this implementation retains a fixed terrain mesh. [OpenSees uniform excitation](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/pattern/uniformExcitationPattern.html)

## Stability and performance contracts

The shared water domain is 257 × 257 cells over 2,048 m, centred on the island. CFL substeps preserve the chosen stability constraint; substep exhaustion is recorded as omitted time. The heightfield resolution cannot resolve individual walls. Rigid bodies and coupled carrier/aircraft use 120 Hz stepping, with discarded render time reported by their adapters.

Maximum simultaneous replacement budgets are 88 structural pieces, 40 uprooted plants, 24 parked vehicles, 80 loose props and 48 external pieces. Demand above allocation limits is deferred, with original geometry/collision retained. Generic debris caps are 45 m/s² applied acceleration, 2 MN force and 2 MN·m torque; counters distinguish capped applied load from raw demand. These caps constrain the simulation and are not physical laws. Terrain, rocks, slabs and excluded infrastructure remain intact.

Uprooted plants preserve the original near-detail meshes, per-instance shape and foliage masks. Their rest shape is transformed by the rigid body; foliage still has the original visual wind deformation. Materials are shared between fallen plants, with three vertex buffers and 14 attributes for the palm path, within baseline WebGPU limits. Restore releases replacement resources without disposing live vegetation resources. No individual leaf or branch fracture is solved.

Simulation pause freezes physical time and state while rendering continues to converge temporal antialiasing. Stop removes disaster forcing and the laboratory wave immediately while momentum/damage remain. Restore returns affected geometry, colliders and captured feature states. It does not erase the player's economy/save. Audio requires a real browser gesture and respects siren mute, volume and global mute.

## Reproducible verification

`npm run test:simulation` runs the maintained analytical, integration and asset checks; `npm run test:physics` runs native rigid-body tests. `npm test` also runs existing craft/game/engine checks and all maintained Playwright scenarios against the real local application. Browser scenarios use fresh contexts and actual controls; external font requests are the only mocked boundary.

Subsystem source, control instructions, assumptions and exact tests: [disasters](disasters.md), [aviation](aviation.md), [hang glider](glider.md), [wind farm](windfarm.md), [sharks](sharks.md), [evacuation](evacuation.md), [people](people-evacuation.md), [tornado visuals](tornado-visuals.md), [livestock](livestock.md), [player water response](player-water.md). Final command results and runtime measurements belong in [simulation verification](simulation-verification.md); don't infer a passing result simply because a test is listed here.
