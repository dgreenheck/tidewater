# COSIER GT3 RS

The factory white-and-red car uses the COSIER studio mesh, red wheels, side graphics, a tinted cabin and Victorian COSIER plates. The body measures 4.572 m long, with a 2.457 m wheelbase and 1.630/1.582 m tracks. The game uses the existing rally camera, WASM suspension, damage, lights, tyres and engine sound.

Choose **COSIER GT3 RS** and **Coastal road** in the vehicle picker. W accelerates, S brakes or reverses, A/D steer, Space applies the rear handbrake and E enters or leaves. Hold W and S together at rest to stage a rear-drive burnout. Release S to launch. J toggles traction and stability assistance. R recovers the car and T repairs it.

## Physics

The rear wheels drive through seven gears with a 4.27 final drive. The reference mass is 1,450 kg and the redline is 9,000 rpm. In assisted driving the front tyres steer relative to the front axle's direction of travel. Above the tyre's peak slip angle, extra steering lock would otherwise scrub speed and widen the turn. High slip on a loaded, dry contact drives tyre noise, rubber deposits and smoke. The studio rig keeps the brake callipers on the steering carriers while the discs and tyres turn on their own axles.

The wing and floor use air-relative speed. The 200 km/h target is 409 kg-equivalent of aerodynamic load. Rear impact damage can detach the foil, uprights and fittings, removing a modelled 40% of total downforce at the rear axle. A flat launch unloads the front springs, and crest geometry can lift the front wheels while the rear still drives. [Porsche technical data](https://newsroom.porsche.com/dam/jcr%3A1d390f77-93c3-49c0-89c7-634f5f02b26a/S22_3515_en.pdf)

## Assets and verification

The game mesh has 232,261 triangles in 189 material and motion batches. The GT3 studio exporter supplies the chassis and suspension hard points. To rebuild, run `node tools/rally/import_gt3rs.mjs PATH_TO_STUDIO` with the studio's dependencies installed. Normal play uses the included distribution asset.

`test/gt3-rs.mjs` checks wheel geometry and acceleration with the shipped physics module. `test/gt3-handling.mjs` measures aero load, steering, burnout, launch, crest contact, power slides and damage. The Playwright driving scenarios use the actual island, AudioContext and physics module.

| Dry-asphalt check | Measured outcome |
|---|---|
| Standing acceleration | 0–100 km/h in 3.37 s |
| Aerodynamic load at 200 km/h | 401 kg-equivalent |
| Corner entry at 150 km/h | 1.15–1.18 g over the first 1.5 s |
| Three-second burnout | 21.0 m/s rear tread speed and 0.35 m chassis travel |
| Rear wing loss at 200 km/h | 1.53 kN less load on the rear axle |
