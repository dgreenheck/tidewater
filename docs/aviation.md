# Aviation

The fictional 320 m Tidewater carrier sits at `(820,0,-940)`, heading east. The Kestrel is an unarmed, 17,000 kg deck fighter with a 48 m² wing and 13.6 m span. All model and solver coordinates use metres, +Y up and +Z nose. In this right-handed frame, +X is the chase camera’s left; keyboard roll/rudder and displayed bank account for that convention. Compass headings use island north (−Z).

## Design: one-key launch and flight feel (2026-10-05)

- **Reference.** A C-13 steam catapult strokes about 94 m to about 150 kt (77 m/s) in about 2.5 s, and carrier jets launch nose-up from an extended nose strut. A fly-by-wire fighter (F/A-18 class) limits load to 7.5 g and holds AoA clear of the stall, rolls about 180 deg/s at speed, and flies coordinated: sideslip near zero, turn rate g tan(bank) / V in a level turn. The Kestrel's own numbers stay declared fiction.
- **Real outcome.** Catapult released within 4.5 s of W; climbing at 15 m/s or more 3 s after release; never below deck height; hands over at 150 m with gear up. Hands-off 45 deg bank: sideslip under 1 deg, turn rate within 15% of g tan(bank) / V. Full back stick at 70, 150 and 220 m/s: no stall, never over 7.5 g. Roll at least 150 deg/s at 150 m/s.
- **Source of truth.** Gravity and air density from `src/physics/Loads.js`; water from `WaterQuery` slot 10; terrain from `TerrainData.heightAt`; keys from the shared input (`FIGHTER_KEYS` in `src/aviation/Aviation.js`).
- **Budget.** No new draw, mesh, dispatch or readback. CPU: a few scalar terms per 120 Hz step.
- **Detail by distance.** Unchanged: the jet simulates whenever it exists; the walk-up prompt checks one 9 m radius.
- **Controls.** E enters (walk-up prompt at the jet) and leaves. On the catapult W launches; S cancels while the engine spools. Airborne W/S throttle, arrows pitch and roll, A/D rudder. G gear, H hook, V flaps, B brake (Space holds it), C view, R reset. Every HUD button shows its key.
- **Transitions.** Hold W to launch, then Catapult (spool about 1.1 s, stroke about 2.5 s), Rotating (10 deg AoA, wings level), Climbing (15 deg path), Climbing, gear up (gear at deck + 15 m with positive climb; flaps up at 110 m/s), You have control (150 m, or at once on any stick input after leaving the deck). The nose strut retracts over 1.2 s after lift-off. The chase camera smooths its direction (4/s) and roll (2.5/s), so nothing snaps.
- **Edges.** The limiter acts on commanded load and AoA, not on a force the jet makes itself. The level-turn load fades to 0 g at knife edge and -1 g inverted, so neutral stick never pulls toward the ground. Below 30 m/s or on the gear the law falls back to plain rate commands. Gear or flaps taken by hand end the launch housekeeping for them.
- **Evidence plan.** `test/aviation-flight-feel.mjs` and `test/aviation-controls.mjs` (red then green); BDD "walk up to the jet, press E and hold W" in `test/browser/aviation.spec.js`; captures of the prompt, catapult, handover and turn.

Use **Aviation** in the World controls rail. **Visit carrier** gives an orbit view, drag to inspect. **Inspection view** offers whole-carrier, flight-deck, bridge and fighter close-ups through the same live scene. **Walk flight deck** places an ordinary walker on the moving deck. The deck supports walking and jumping, and coarse collision volumes block the island, parked aircraft bodies and landing gear. **Walk flight deck** sets you down 12 m from the jet on the catapult. Walk up to it and press **E** (or choose **Enter fighter**). Press or hold **W** and the jet launches itself: full power, brake off, catapult, rotate, climb out, gear and flaps up. It hands you control at 150 m, or at once if you touch the stick after leaving the deck.

**Start landing approach** places the jet 620 m behind the recovery threshold at 68 m/s and approximately 3.5° descent, with landing flaps and gear. It computes an initial wind correction and trim, then runs the same force/contact solver as every other flight. Lower the hook yourself. It does not teleport to a completed landing or use a success timer. A hook-up pass cannot capture a wire. A bad descent, bank, heading, island strike or gear-up deck impact damages the aircraft. Aircraft collision uses three gear probes, terrain and simplified carrier deck/island volumes; it does not provide arbitrary scenery mesh collision or flexible-wing contact. **Reset aircraft** is an explicit recovery action.

| Control | Action |
| --- | --- |
| E | Enter the jet (beside it); leave the jet or inspection |
| W on the catapult; S while spooling | Launch; cancel the launch |
| W / S (airborne) | Throttle up; down |
| Down; Up | Pull up; push down |
| Left; Right | Roll left; right |
| A; D | Rudder left; right (alone, it banks about 35 deg and turns) |
| G | Landing gear |
| V | Retracted, takeoff, landing flaps |
| H | Arrestor hook |
| B; held Space | Toggle brake; hold brake |
| C | Chase/cockpit camera |
| R | Reset aircraft |

The HUD carries one row of buttons, each showing its key (Gear G, Hook H, Flaps V, Brake B, View C, Reset R, Leave E). The panel holds the destinations plus the numeric throttle, flap and inspection fields. The live instruments show airspeed in m/s, world altitude in metres, vertical velocity, throttle, flight state and landing aid. **Inspect forces** expands dynamic pressure, angle of attack, bank, lift, drag, thrust, load factor, contact count, deck-relative impact velocity, cable force/work and carrier hydrostatic loads. A parked aircraft in a 7 m/s wind correctly has 7 m/s airspeed. `data-deck-speed` is the separate relative ground speed used for stopping assertions.

## Model assets

Run from the checkout:

```sh
blender -b --python tools/aviation/build.py -- --root .
```

The generator creates editable `assets/aviation/carrier.blend` and `fighter.blend`, studio preview PNGs, and `public/aviation/*.glb` plus JSON statistics. It is self-contained, with no model/texture downloads. Authored game vertices are converted to Blender `(x,-z,y)` and exported with glTF Y-up, preserving the solver frame. Repeated meshes are merged by material and animated pivot. Tiny hinge and service fittings reuse their assembly finishes to control draw submissions. Add `--asset fighter` or `--asset carrier` to rebuild one model, and `--no-render` for export only.

The carrier includes a lofted, waterline-banded hull, polygonal flight deck, angled landing lane, four arresting cables, two catapult tracks and blast deflectors, elevators, tie-down eyes, scuppers, bridge windows and doors, stepped island, rotating radar array, radomes, antenna farm, safety nets, catwalks, galleries, lifeboats, davits, canisters and mooring fittings. The detail pass adds framed/wiper-equipped windows, supported bridge galleries, ladders and vent banks, a concave dish radar, full net cross-cables, launch shuttle and rail hardware, arrestor sheave housings, warning stencils, fire lockers, four service tractors/power carts and six helmeted crew as scale references. Geometry totals 142,288 triangles and 19 mesh batches, with a roughly 6.00 MB GLB. Its underwater hull extends 11 m below the rest waterline.

The fighter includes lofted fuselage, rounded airfoil cross-sections, leading-edge extensions, intake lips and recessed ducts, twin petal exhausts, canted tail fins, transparent canopy, seat/harness/instruments, struts/scissor links/tyres/hubs, panel seams, navigation lamps and hook. The detail pass adds genuinely recessed intake and nozzle walls/turbine rings, canopy bows and windscreen divider, three cockpit displays with bezels/softkeys, side-console switches, seat guides/handles, skin joints/access covers, wing walk lines/stencils, tail livery, brake hoses, wheel lugs and separated flap/aileron gaps. Geometry totals 30,240 triangles and 41 mesh batches, about 1.20 MB. Animated pivots: `GearNose`, `GearLeft`, `GearRight`, `AileronL/R`, `FlapL/R`, `ElevatorL/R`, `RudderL/R`, `ArrestorHook`. Three parked copies reuse geometry/materials but require their own draw submissions.

## Physical model and provenance

The solver is fixed-step at 120 Hz. Semi-implicit linear/angular integration uses force/torque and the body inertia tensor, including `omega × Iomega`. Unit quaternions carry orientation. Shared gravity and density constants come from `src/physics/Loads.js`.

The sourced aerodynamic laws are `q = rho V_air²/2`, `L=q S CL` and `D=q S CD`, with `CD=CD0+CL²/(pi e AR)` for the attached-flow induced term. NASA explicitly says coefficients generally require experiment; these laws do not validate the fictional coefficient choices. Sources: [NASA lift equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/) and [NASA induced drag](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/).

Declared assumptions:

- Mass 17,000 kg; span 13.6 m; area 48 m²; chord 3.8 m; inertia `[130000,190000,52000] kg m²`.
- Sea-level density 1.225 kg/m³ with exponential 8,500 m scale height. Gravity 9.81 m/s² and water density 1,025 kg/m³ are shared constants.
- Attached lift `CL=.15 + .65 flaps + 4.3 alpha`; stall at about 17.8° plus up to 2.3° flap allowance; smooth transition to `1.05 sin(2 alpha)`. No full separated-flow or Mach-dependent coefficient tables.
- Drag includes `CD0=.026`, flap/gear increments, induced drag, separated-flow penalty and a simple transonic rise beginning Mach .68. Upper operating envelope is an educational subsonic approximation, not calibrated performance.
- Maximum thrust 140 kN, 0.6 s spool response, declared altitude/speed lapse. A fly-by-wire command law (declared) turns stick into commanded load factor, capped at 7.3 g and 0.85 of the stall AoA. Neutral stick holds the flight path through a bank (cos(path) / cos(bank)). Body rates track the turn rate of the velocity vector, and the yaw channel drives sideslip to zero. Control torque authority still falls with dynamic pressure. Pitch stiffness about the commanded AoA is 0.25 per rad (was 0.065). Full-stick roll is 180 deg/s above 9 kPa.
- Three landing gear contacts use 620 kN/m springs, 90 kN·s/m dampers and .42 m nominal travel. Friction depends on normal load and brake input. Contact velocity includes carrier rotation and translation.
- The jet sits 6 deg nose-up on a 0.736 m nose-strut extension, so it leaves the bow climbing. Level, it left at 0 deg pitch with lift 0.62 of weight and sank 13 m in 8 s.
- Catapult force ≤450 kN over a 95 m stroke, with a 78 m/s release limit. Engines still contribute separately. It does not assign launch velocity or teleport beyond the deck.
- Hook capture requires gear support, a lowered hook, a swept crossing of an actual wire, acceptable lateral/height bounds, and a relative speed between 18 and 105 m/s. The planar hydraulic cable approximation applies its resultant at the aircraft centre of mass, omitting hook-induced pitching torque. Its two anchor branches act in the moving deck plane, with tension only during outward payout and work integrated using midpoint deck-relative speed. It is limited to 650 kN, 115 m payout and 65 MJ, with work recorded in joules. Brake and throttle cut follow actual capture. Work-energy follows [Newton's second law](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/newtons-laws-of-motion/); the hardware capacities are assumptions.
- Water contact cuts the engine. Implicit quadratic water drag dissipates translational momentum. Initially 20 m³ of sealed volume progressively floods with a 32 s decay time, so the damaged jet briefly floats and sinks. This is not damage-specific watertight compartment modelling.

The carrier is an 85 million kg rigid body. Ten water stations drive equilibrium displacement, heave and surface slope. `B=rho_water g V_sub`, with 8,500 m² waterplane area and declared transverse/longitudinal metacentric heights 3.2/170 m. Damping, inertias, drag areas and a station-keeping spring are explicit assumptions. Air pressure and water-relative current loads cause drift/heel. Earthquake ground acceleration is not added to an unsupported floating ship. Aircraft contacts and cable forces use the moving carrier as an external support; their equal-and-opposite reactions are not fed back into the 85 million kg ship solver. Global aircraft/ship momentum is therefore not a conserved quantity in this approximation. There is no carrier structural break-up or flooding model. Service vehicles and helmeted crew in the authored carrier asset are static visual scale/detail elements, not independently simulated vehicles or people.

## Shared water and disasters

The adapter reserves eleven `WaterQuery` samples, ten hull points and the aircraft. Readback is asynchronous with the existing 1–3 frame latency; the aircraft sample leads by reported query age. GPU query height already includes the disaster water anomaly and is never added twice. If slots cannot be reserved, the explicit fallback is the shared field's water height, not another system's slot.

`app.disasters.field.sample(x,y,z)` supplies ambient plus disaster wind and water current. Aviation must not add ambient wind again. Carrier and jet use water-relative and air-relative velocities respectively. A crash sends a bounded crest/depression through `field.water.addImpulse(x,z,12,strength)` when that grid exists. Here `strength` is surface displacement in metres, ≤.25 m, not impulse in N·s. It is a local visual/height coupling, not a full conservative hull/SWE momentum exchange. The shared field currently ignores impulses outside its finite grid.

Global disaster pause freezes the App frame and therefore both aircraft and carrier. `resetDisasterEffects()` restores the actual captured aircraft/carrier state from the first event, including whether the user was piloting or inspecting. A restored active aviation session reasserts its player mode, pose and camera ownership after the disaster service restores its own world snapshot. The adapter takes this snapshot through the shared disaster registration boundary. Carrier and aircraft advance together within each 120 Hz substep. Excess render-frame time beyond .2 s is explicitly accumulated in `aviation.discardedTime`. Explicit `reset()` returns the aircraft to the launch position. Stopping a disaster removes its forcing; the separate flight trajectory persists.

## Integration

`new Aviation(app); await aviation.init()` runs before render precompilation, after the disaster field exists. `update(dt)` runs after the ferry/rally/props, and `updateCamera(dt)` after the ordinary player/fly guards. `active` includes both carrier inspection and piloting; `pilot` identifies actual aircraft controls. Ordinary fly/player updates and the avatar are suppressed while active. Root integrates F/T/L and UI H shortcut ownership. `leave()` clears active first. A parked/arrested/damaged aircraft exits beside its actual position when local support or water is reachable; an unsupported airborne exit rescues the player to their entry point. `Player.resumeOnFoot` restores local water sampling and walking/swimming state without discarding ferry capability. `App.setFreeCam(true)` can safely leave aviation first. `CarrierDeck` registers with `Player.groundProviders`; it vertically intersects the current tilted deck plane, clips to the physical deck polygon, and supplies carrier-local position and point velocity for support carry. Collision volumes are coarse capsule proxies, not full hull/aircraft mesh collision; ordinary walkers can still step off the deck.

## Verification

```sh
node --test test/aviation-physics.mjs test/aviation-assets.mjs test/aviation-gameplay.mjs
PW_PORT=5197 PW_OUT=test-results/local npx playwright test test/browser/aviation.spec.js
```

The pure suite includes a synthetic NASA-law benchmark (`V70m/s, area27m², CL1.2, CD0.03, e.8, AR7`: `q3001.25Pa`, lift97,240.5N, drag9,063.7152N), exact Archimedes equilibrium, changing water slopes/current/wind, moving-deck support, real bounded takeoff/bank, 620 m approach and arrest, wind-corrected approach, failed gear/hook/descent cases, flooded crash, timestep partition invariance and gust extremes. Production adapter tests verify moving-deck co-stepping at 120/30/10 Hz and restoration of the captured flying state. A paired cable/no-cable production step independently infers the cable impulse from velocity change and closes the displayed work to within 0.00001 J. The GLB tests load both assets through the actual engine parser and check finite geometry, physical scale, axes, pivots and declared triangle/draw/byte budgets. These are equation and simulator acceptance checks, not real-airframe validation.

The maintained native Playwright scenarios use fresh contexts/localStorage and only mock external font loading. Actions go through visible product buttons, inputs and actual keyboard events. The first buildable absent-feature red loaded the island and failed at the missing Aviation entry point. An isolated production inverse zeroing lift made five unchanged pure scenarios fail in the expected way (including takeoff/landing ditching); the checkout implementation was never reversed.

The browser suite also covers the inspection presets and repeated event groups: an on-foot quake is restored, then the user enters the fighter, starts earthquake plus tornado, restores, operates the aircraft and leaves. Its pre-fix run reproduced `pilot=true` with `player.mode=walk`; the fixed path restores consistent aviation ownership.


The maintained `test/aviation-controls.mjs` regression projects actual integrated displacement onto chase-camera right. It reproduced reversed Right/E inputs before the adapter fix, then passed Right/E and Left/Q at two world headings. The real-key carrier launch/bank browser scenario also passed with a required clockwise compass change after Right.

The gameplay recovery tests add real-module regressions for tilted deck support, island/parked-body collision, local landed/ditched exits and rejected glider launch ownership. `test/browser/aviation-recovery.spec.js` uses ordinary keys to leave, walk and jump on the carrier and to land/crash/exit the glider.

### Flight feel evidence (2026-10-05)

Red on the old code, green after, same tests: `node --test test/aviation-flight-feel.mjs test/aviation-controls.mjs`.

| Check | Old code | Now |
| --- | --- | --- |
| Lowest point in the 8 s after the catapult | 11.0 m below deck height | above deck height, climbing |
| Hands-off 45 deg bank | 3.05 deg sideslip | under 1 deg, turn rate within 15% of g tan(bank) / V |
| Full back stick, 70 m/s | 89.9 deg AoA, stalled | under 0.85 of stall AoA, under 7.5 g (also 150 and 220 m/s) |
| Full roll stick, 150 m/s | 66 deg/s | 150 deg/s or more |
| W for 1 s airborne | throttle stayed 40%, nose pushed down | throttle 90% or more, no pitch |
| One W press on the catapult | no launch | launched, 70 m/s or more, above the deck in 7 s |
| Chase camera through a vertical pull | 71 m off the 20 m chase point | within 4 m, up never flips |

BDD red: "walk up to the jet, press E and hold W" failed on the old code (no "Fly the jet" prompt); it passes now.
