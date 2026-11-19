# North coast land wind farm

The farm is three operational 5 MW reference turbines. Open **Wind farm** in the World controls rail. **Watch farm** frames the array; **Inspect turbine** approaches the selected nacelle and pitch bearings; **Inspect foundation** shows its ground contact, service platform and switchgear. Farm and individual enable switches, a rotor brake, minimum collective pitch, explicit high-wind restart and a reset act on the physical model. The shared wind controls call `App.setAmbientWind`, so turbines, waves and aircraft use the same environment. Nothing in this subsystem assigns rotor speed from wind speed.

## Reference and boundary of the model

Primary source: Jonkman, Butterfield, Musial and Scott, *Definition of a 5-MW Reference Wind Turbine for Offshore System Development*, NREL/TP-500-38060 (2009), [official OSTI full text](https://www.osti.gov/servlets/purl/947422), [record](https://www.osti.gov/biblio/947422). The full 952,922-byte report was downloaded and its contents verified with `pdftotext` on 2026-10-03. SHA-256: `b4ce1e088368857cb75460af0729411cc64c8a68efe0df4fb0c1324e96a21ff2`.

| Data used | Report location |
|---|---|
| 5 MW, 126 m rotor, 90 m hub, 3/11.4/25 m/s cut-in/rated/cut-out, 6.9/12.1 rpm, 5° tilt, 2.5° precone, 5 m overhang | Table 1-1, pp. 2–3 |
| Each blade: 61.5 m, 17,740 kg, first moment 363,231 kg·m, root second moment 11,776,047 kg·m² | Table 2-2, p. 6 |
| Blade section chord and twist at 17 radial stations | Table 3-1, p. 7 |
| Hub 56,780 kg / 115,926 kg·m², nacelle 240,000 kg, yaw 0.3°/s | Table 4-1, p. 13 |
| 97:1 gearbox, 94.4% efficiency, generator inertia 534.116 kg·m², high-speed brake 28,116.2 N·m and 0.6 s deployment | Table 5-1, p. 14 |
| Tower 87.6 m, 347,460 kg, CM 38.234 m; base/top diameter 6/3.87 m, thickness 0.027/0.019 m | §6 and Table 6-2, pp. 15–16 |
| Peak Cp 0.482 at TSR 7.55, region-2 torque constant and torque/rate limits, pitch rate 8°/s | §7.2 and Table 7-2, pp. 19, 27 |
| First tower fore-aft frequency 0.324 Hz | Table 9-1, p. 30 |

The reference report explicitly leaves start-up, shutdown and protection sequences undefined (§7, p. 16). Those controls here are stated game-model assumptions. The 0.324 Hz mode and original tower are land-based reference properties. The concrete footings and soil capacities below are explicit land-foundation assumptions; they are not specified by the reference turbine report.

This is an inspectable reduced model, not engineering-grade CFD, finite-element stress, seismic hazard, fatigue life, certification, or a substitute for OpenFAST. Published geometry and one aerodynamic operating point do not establish a full validated Cp surface. The visual airfoils use source chord/twist and an approximate thick symmetric section; they do not reproduce the DU/NACA aerodynamic polars.

## Equations and units

Shared SI fluid laws come from `src/physics/Loads.js`: air density 1.225 kg/m³, seawater density 1,025 kg/m³, gravity 9.81 m/s², dynamic pressure `q = rho V² / 2`, drag `F = q Cd A`, and buoyancy `F_b = rho g volume`.

`WindFarm.update` samples the shared disaster field at the hub and supported land foundation. The rotor uses the positive inflow component normal to its yawed, tilted shaft. Crosswind and reverse flow do not receive aligned generation. The engine nacelle and rotor hierarchy uses the same yaw/tilt/pitch angles as the calculation.

- Preconed swept area `A = pi (63 cos 2.5°)² = 12,445.257 m²`.
- `lambda = omega R / V_axial`, with angular velocity in rad/s. The assumed smooth surface is `Cp = 0.482 x exp(1-x) exp(-beta/14°) cos²(beta)`, where `x = lambda / 7.55`; it reaches the source peak and stays below the Betz limit 16/27. Pitch at 90° produces zero driving torque.
- Available wind flux is `0.5 rho A |wind|³` (W). Axial rotor flux is `0.5 rho A V_axial³`. Aerodynamic shaft power is torque times actual rotor velocity. Electrical generation is the generator's mechanical work rate times 0.944. These are separate quantities in the inspector, with cumulative delivered energy in MWh.
- `T_aero = 0.5 rho A R V_axial² (0.482/7.55) exp(1-x) exp(-beta/14°) cos²(beta)`. This is the analytic finite limit of `P/omega`, including at rest; starting torque never invents power at zero rotation.
- Initial shaft inertia is `I = 3 (I_blade_root + 2 r_hub M1 + m_blade r_hub²) cos²(precone) + I_hub + I_generator 97² = 43,784,723.574 kg·m²`.
- `I d(omega)/dt = T_aero - T_generator - T_brake`. Work uses the average of old/new speed during each step. The ledger checks `work_aero = work_generator + work_brake + energy_transferred_to_detached_parts + rotor_kinetic_energy`. Generator conversion loss is separate from delivered electricity.

Generator region 1 has no extraction below 670 high-speed rpm. Region 1.5 interpolates to 871 rpm; region 2 uses NREL's `0.0255764 * generator_rpm²` N·m. The region 2.5 bridge beginning at 1,050 rpm is a declared simplification. Region 3 extracts constant mechanical power, and actual torque is constrained so electrical work remains at or below 5 MW. Pitch feed-forward is solved from the assumed Cp surface, with bounded PI speed correction. This controller is not the NREL baseline DLL.

The rotor starts feathered and braked. Actuator rates are finite. A gust reaching 25 m/s disconnects the generator and latches feather/brake. Restart requires a user action, wind below 20 m/s continuously for five simulation seconds, and rotor speed at or below rated speed. A separate 1.22-times-rated overspeed latch uses the same recovery rule. These thresholds, hysteresis and controller gains are assumptions. A step from 8 to 26 m/s can briefly accelerate the rotor before feathering removes driving torque; the documented 2.73 MN·m brake then dissipates its energy over tens of seconds.

Wake: a Jensen-style expanding top-hat velocity deficit, geometrical disk overlap including crosswind and local hub-elevation separation, and root-sum-square mixing. Each source uses the wind direction sampled at its hub and streamwise `Ct_effective = Ct * max(cos(yaw/tilt misalignment),0)^3`. The cosine projection follows axial dynamic pressure and the projection of thrust onto the streamwise direction. `deficit = (1-sqrt(1-Ct)) [R/(R+k distance)]²`, with assumed `k=0.04` and a retained-speed floor of 15%. The original model and its limitations are described in Jensen's [Risø-M-2411 report, pp. 5–8](https://www.wasp.dk/-/media/sites/wasp/wasp-support/literature/risoe-m-2411-a-note-on-wind-generator-interaction.pdf). Our Ct parameterization, overlap treatment and mixed-wake combination are declared adaptations. The k=0.04 value is uncalibrated for the island’s forested land sites; terrain turbulence is not resolved. Flow within one rotor radius (63 m) downstream is omitted; blade-scale near-wake flow is not resolved. The steady deficit fades smoothly from eight to ten rotor diameters and ends at 1,260 m to bound game cost; real wakes need not disappear there.

The farm registers `applyWakeToAir` with the shared field’s `registerAirModifier`. **Every consumer of `app.disasters.field.sample` receives the wake**, including the glider/aircraft and disaster bodies. The water-stress grid applies it at wet-cell surface elevation inside a cached horizontal bound. The rotor solver alone uses `sampleRaw` followed by disk-averaged wake flow; it does not attenuate an already modified sample. Sources are snapshotted once per farm frame, avoiding turbine order feedback.

A declared deterministic turbulence surrogate adds zero-mean lateral and vertical sinusoids to the slowed stream: lateral amplitude `0.16 * deficit * |raw wind|`, vertical amplitude 0.7 of that, and advecting phase `(speed*time - streamwise_position)/18`. The second phase uses frequency factor 1.37 and height/29. These amplitude/length/phase constants are assumptions, not a validated turbulence spectrum or tornado CFD. The final vector is bounded so `|modified air| <= |raw air|` at every sample. Consequently the local kinetic energy per unit mass, `0.5|V|^2`, never increases through this wake operation. This is a bounded momentum-deficit model, not a globally closed finite-volume atmospheric energy solve. The farm extracts electricity; it does not behave as a powered fan or create extra wind.

The independent five-diameter benchmark with Ct 0.8 and 8 m/s raw flow is 5.74372896 m/s streamwise flow. Mean lateral/vertical perturbation over whole cycles is zero; local perturbation variance is positive. Tests also cover upper/crosswind points outside the disk, the finite distance bound, raw-sample recursion avoidance, real farm registration, lower downstream rotor power, reduced deficit after feathering, and modifier cleanup.

## Loads, response and failure assumptions

Rotating thrust uses `Ct = 0.04 + 0.76 exp(-beta/14°) cos²(beta)`. Yawed axial thrust, tower drag, nacelle drag, supported foundation acceleration, water-current loading and buoyancy have separate recorded terms. Dry land receives no water-current force or buoyancy. If the shared water surface exceeds the lowest footing terrain, current drag acts on the wetted 13 m concrete base, then on the wetted 6 m tower above the platform. The sloping exposed base is conservatively represented as a full cylinder from its lowest terrain edge. Buoyancy uses only wetted exposed volume, with a sealed-volume assumption. Symmetric hydrostatic pressure is not added as a fictitious one-sided horizontal flood force.

The tower mode satisfies `m_eff q'' + c q' + k q = F_rotor + F_nacelle + 0.375 F_tower - m_eff a_ground`, independently in X/Z, using `m_eff = top_mass + 0.236 tower_mass`, `k = m_eff (2 pi 0.324)²`, and assumed damping ratio 0.04. The dynamic restoring-plus-damping reaction actually drives base stress: `M_modal = 90 (k q + c q')`. Residual terms preserve the full static tower distributed-wind moment and source mass moment. This one-mode/90 m lever approximation captures resonant amplification; it is not a complete structural modal model. The visible tower tilts about its anchored base as an approximation to the tip displacement.

Tower base combined stress is `|M|/Z + N/A_steel`, where `Z = pi (D⁴ - (D-2t)⁴)/(32D)`. Foundation moment extends this demand to an assumed anchor plane 2 m below the lowest sampled foundation terrain and includes the moment of each wetted component’s water drag. Failure accumulates only sustained utilization above one: `integral(max(utilization-1,0) dt) >= 2.5 s`, with 0.2/s recovery below the limit. This is a bounded overload rule, not fatigue damage accumulation.

| Component | Geometry / material input | Assumed limit |
|---|---|---|
| Blade root | Source chord/twist/mass; effective composite section modulus 0.16 m³, axial area 0.35 m²; thrust lever 0.64R | 180 MPa combined bending/centrifugal stress |
| Nacelle main bearing | Source hub/nacelle masses; frontal area 18 m², Cd 1.1 | 2.2 MN axial rotor thrust |
| Tower | Source shell diameters/thicknesses; Cd 0.7 | 355 MPa assumed steel yield / 1.5 factor |
| Reinforced concrete footing / soil anchors | Assumed 13 m diameter; anchor plane 2 m below lowest footing terrain; platform 0.45 m above highest terrain; Cd 1.2; fixed support | 320 MN·m moment, 8 MN lateral shear, 40 MN uplift |

Any lost blade disconnects generation. Its parallel-axis inertia and kinetic energy leave the attached rotor reservoir. Nacelle/tower/foundation loss transfers the remaining rotor reservoir. Detached pieces go through `app.disasters.addBody` into the shared Avian rigid-body solver, with angular velocity and tangential release velocity. Their coarse box proxies use geometric centres and uniform rigid inertia, rather than the original distributed material tensor: exact whole-scene fragment energy, fluid forces on moving slender parts and fracture propagation are not calibrated. There is no independent wind-farm debris integrator. At most six pieces per destroyed turbine are requested from the shared 48-external-body budget; unavailable fragments are removed visibly and counted, not given invisible colliders.

Broken tower colliders are removed from the island collision lists and the driving collider map is refreshed. The visible buried concrete footing and its walking contact remain after anchor failure. Reset despawns each shared body, restores original parent/pose and reinstates each collider once. Disaster restoration preserves previously delivered electrical energy; **Reset wind farm** also clears the meter. Settings/energy are session state, not localStorage records or a grid billing ledger.

## Placement and integration

Hub height is 90 m above each local concrete footing, with its yaw bearing at 87.6 m. The entire 6.5 m-radius foundation footprint is sampled; the foundation top sits 0.45 m above its highest terrain and the body extends 2 m below its lowest terrain. Footings, tower collision sections and wind sample heights use the same local elevation. Concrete decks have real walking contact. Land heights and existing roads are never rewritten.

| Turbine | X / Z (m) | Footprint minimum / maximum (m above mean sea) | Footing / hub (m above mean sea) | Minimum all-yaw terrain clearance (m) |
|---|---|---|---|---|
| WT-01 | -440 / -660 | 23.9061 / 27.0258 | 27.4758 / 117.4758 | 24.83 |
| WT-02 | -80 / -730 | 5.6722 / 6.6736 | 7.1236 / 97.1236 | 17.72 |
| WT-03 | 190 / -720 | 66.8611 / 69.2138 | 69.6638 / 159.6638 | 26.28 |

Initialization checks every footing sample is above 3 m, footprint elevation range below 4 m, at least 15 m conservative rotor-to-terrain clearance, live collider clearance, and turbine separation of at least 252 m. Adjacent spacings are 366.7 and 270.2 m. The rotor envelope includes all nacelle yaw directions and the 5 m overhang. The original low-valley candidate at (-100,-690) was rejected because terrain entered the rotor sweep.

Call `prepareWindFarmSites(terrain)` from `src/windfarm/Sites.js` after the CoastalRoute layout and before vegetation scatter. It reserves foundation/platform space, selectively excludes tall crowns where they could enter the blade envelope, and reserves a 2.2 m maintenance foot trail from the circuit at (155,-269) to all turbines. A* penalizes steep slopes; the path follows existing dry terrain and is not a graded construction/haul road. Some foot-trail sections are steep (up to about 71% grade). This access is a game visual, not a civil-engineering road design. Reservations are idempotent and do not change the heightfield. The live browser scenario additionally checks actual scattered tree crowns clear the rotor envelope.

The visuals include source-tapered/twisted airfoil sections, pitch-bearing rings and root bolts, nacelle side louvres, roof hatches and fasteners, rear service deck and ladder, tower flange seams, anchor bolts, access door, platform guardrails and switchgear. Static fittings are merged by material to keep draw calls bounded.

Create `new WindFarm(app)` after `app.disasters`; await `init()`. Call `update(dt)` after the shared field advances. `registerExternal` handles restoration. `state()` exposes SI telemetry. `dispose()` removes panel listeners, geometry/material resources, shared bodies, registry membership and owned colliders. Substeps are at most 1/120 s; each frame accepts at most 0.1 s and records discarded time, so a resumed tab cannot create an unbounded solve or false energy jump.

## Repeatable verification

```sh
node --test test/windfarm.mjs
node tools/windfarm/benchmarks.mjs
# Optional real-app motion recording; requires ffmpeg and isolated port 5211:
node tools/windfarm/capture.mjs
PW_PORT=5209 PW_OUT=test-results/local npx playwright test test/browser/windfarm.spec.js
```

Port 5199 was already held by Docker during delivery; 5209 is the isolated wind-farm product host. The maintained Playwright scenarios verify actual rotor mesh rotation and stopping, plus shared air speed recovering when the farm feathers. They use real user gestures, the actual app, fresh browser storage and only an external Google Fonts mock. All three maintained scenarios run under the repository's normal Playwright discovery. Numerical tests are in the root normal runner.

Benchmarks include the independent 8 m/s published-Cp expectation of 1.7758 MW, rated output within 0.5% at 11.4/16/24 m/s, the published rotor/yaw/actuator constants, Betz bound, torque-work conservation, cut-in/cut-out/restart, actual shared tornado samples, dry-footing/flood contact, actual seed-7 terrain and untouched-height checks, analytic foundation drag/inertial moment, analytical SDOF resonance plus actual amplified failure demand, released inertia/energy transfer, one-hour finite accounting, reset/collider identity and registry cleanup.

The initial buildable zero-output model failed the 8 m/s acceptance test before implementation. The later resonance, released-energy and dry-foundation fixes each failed their unchanged tests in an isolated buildable reversal. The initial UI inverse bypassed farm registration in an isolated copy. The final quake-specific inverse disconnects only supported ground acceleration from turbines; the shared-wake inverse omits only farm wake registration. The same final scenarios, storage reset, font mock and other product paths are retained. A port startup failure is not counted as behavioural red evidence.
