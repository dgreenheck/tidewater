# Island cars

The Vehicle picker offers the Aster RS, Ridgeback 4x4, Petrel GT, Fulmine V10, Corsaire W16, Sandpiper 1600 and COSIER GT3 RS. The GT3 uses its own authored wheelbase, aero and damage rig. [COSIER GT3 RS](gt3-rs.md)

## Reference

Figures are the real car's, from the maker's data unless marked. "Declared" marks a game choice; the
tests in `rally-physics/src/tests.rs` (`NEW_CARS`) hold every declared number to the real outcome.

| | Fulmine V10 | Corsaire W16 | Petrel GT | Sandpiper | Ridgeback 4x4 (existing) |
|---|---|---|---|---|---|
| Drawn from | Lamborghini Huracan EVO (2019) | Bugatti Chiron (2016) | Porsche 911 GT3 (992, 2021, PDK) | Meyers Manx (1964 on), VW Type 1 pan, 1,915 cc flat four | lifted Wrangler-type 4x4, 5.7 L V8 |
| Physics kind | 2 | 3 | 4 | 5 | 1 |
| Mass | 1,422 kg dry (maker); 1,550 kg with fluids and fuel (declared) | 1,995 kg (maker) | 1,435 kg DIN (press release) to 1,479 kg (data sheet); 1,450 kg used | about 545 kg (1,200 lb); 620 kg with a driver | 2,100 kg |
| Engine | 5.2 L V10, 470 kW at 8,000 rpm, 600 Nm at 6,500 | 8.0 L W16 quad-turbo, 1,103 kW at 6,700 rpm, 1,600 Nm 2,000 to 6,000 | 4.0 L flat six, 375 kW at 8,400 rpm, 470 Nm at 6,100 | 1,915 cc dual-carb flat four (94 mm bore, 69 mm crank), about 70 kW at 5,000 rpm, 150 Nm at 3,400 (declared engine specification) | 5.7 L V8 |
| Redline | 8,500 rpm | 6,800 rpm (declared from the power peak) | 9,000 rpm | 5,600 rpm | 5,600 rpm |
| Gearbox | 7-speed dual clutch; 3.13 2.59 1.96 1.57 1.26 1.03 0.87 on 3.62 (declared: 7th at 8,000 rpm gives 325 km/h) | 7-speed dual clutch; 3.25 2.29 1.73 1.32 1.04 0.84 0.69 on 3.09 (declared: 7th at the redline gives 420 km/h) | 7-speed PDK 3.75 2.38 1.72 1.34 1.11 0.96 0.84, final 4.54 (maker) | VW 4-speed 3.80 2.06 1.26 0.89, final 4.125 | 5-speed automatic |
| Drive | all-wheel, rear-biased (35 % front declared) | all-wheel (40 % front declared) | rear | rear, open diff | full-time 4x4 |
| Weight split (front:rear) | 43:57 | 43:57 | 39:61 | about 40:60 (declared, engine behind the axle) | 50:50 |
| Tyres | 245/30 R20, 305/30 R20 | 285/30 R20, 355/25 R21 | 255/35 ZR20, 315/30 ZR21 | 165 R15, 235/75 R15 | mud-terrain, 0.47 m radius |
| Wheelbase | 2.620 m | 2.711 m | 2.457 m | 2.032 m (80 in) | 2.76 m |
| Track (front / rear) | 1.668 / 1.620 m | 1.748 / 1.663 m | 1.601 / 1.553 m | about 1.31 / 1.35 m (VW Type 1) | 2.04 m |
| 0-100 km/h | 2.9 s | 2.4 s | 3.4 s | 6.5 to 8 s (builders' 0-60 mph in 6 to 7 s) | 6.5 to 10 s band |
| Top speed | 325 km/h | 420 km/h with the top-speed key, 380 km/h otherwise (the game governs at 380) | 318 km/h | about 160 km/h (100 mph, governed at 45 m/s) | 160 km/h |
| 100-0 km/h | 31.9 m | 31.3 m | about 31 m (road tests) | drum-era, about 45 m | 28 to 52 m band |

Sources: Lamborghini Huracan EVO technical data (lamborghini.com, 2019 press kit); Bugatti Chiron
press kit (2016); Porsche 911 GT3 PDK technical data,
https://newsroom.porsche.com/dam/jcr:ca1882c7-1588-4a2e-995c-fe19ef1281fc/pag-911-gt3-pdk-en.pdf
(track, ratios, final drive, weight); Meyers Manx, https://en.wikipedia.org/wiki/Meyers_Manx and
https://www.conceptcarz.com/s23823/meyers-manx.aspx (wheelbase, weight); Volkswagen air-cooled
engine, https://en.wikipedia.org/wiki/Volkswagen_air-cooled_engine (1600 twin-port output).

Declared in every new config (`rally-physics/src/vehicle.rs`): spring and damper rates, inertias,
collision boxes, tyre grip multipliers, and `peak_torque`, which is set so the shared torque curve
(it falls to 0.9 at 0.9 x redline) gives the published peak power at the published rpm. One radius
serves all four wheels, so staggered tyres use their mean. The physics origin stays mid-wheelbase
(the models' root, per `assets/rally/asset_report.json`); `com_z` moves the centre of mass back to
the published split. Without it the GT (then the Kestrel GT) launched on half its weight and reached only 240 km/h
in 35 s (red run, `cargo-g1.log`).

Measured in the simulator (`cargo test ... new_cars -- --nocapture`, 2026-10-05):

| | 0-100 km/h | after 35 s flat out | 100-0 km/h | peak lateral |
|---|---|---|---|---|
| Fulmine V10 | 3.03 s | 320 km/h | 33.4 m | 1.04 g |
| Corsaire W16 | 2.76 s | 380 km/h | 32.4 m | 1.09 g |
| Petrel GT (on the concept model's 0.384 m wheels and 2.798 m wheelbase) | 3.78 s | 302 km/h | 33.9 m | |
| Sandpiper (1,915 cc; the 1600 gave 12.71 s and 130 km/h) | 8.49 s | 156 km/h | 45.1 m | 0.79 g |

## Rendering and simulation

The car profiles in `src/rally/Vehicles.js` supply the picker, engine range, camera and wheel dimensions. Their numeric IDs identify the corresponding Rust configurations. All vehicles share the island heightfield, surface map and water queries. Traffic uses the ferry route and draws its wheel angles from distance travelled. Material and model credits are listed in [CREDITS.md](../CREDITS.md).

The controls and handling tests are documented in [Rally physics](rally-physics.md). The browser scenarios in `test/browser/hero-cars.spec.js` exercise the picker, coastal route and four rolling contact patches.
