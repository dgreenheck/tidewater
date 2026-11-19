# Rally in Tidewater

The island renderer hosts the original Aster RS model and a Rust vehicle controller in
WebAssembly. Avian 0.5.0 and Bevy 0.18.0 run without a second renderer. Vehicle forces
execute at 120 Hz with eight solver substeps.

Since 25 September 2026 the controller is Tidewater's own (`rally-physics/src/controller.rs`):
a combined-slip tyre model, driveline, assists, buoyancy and damage hooks, documented in
`docs/rally-physics.md`. It started from Rally's controller; Rally still supplies the car
meshes and `driving/input.rs` (`DriveIntent`), whose SHA-256 hashes are in
`rally-physics/source-manifest.json`. The original Rally checkout is not modified.

## Integration notes

- Avian's `SpatialQuery` contains a mutable pipeline resource even for a raycast.
  A standalone Bevy `SystemState<SpatialQuery>` must use `get_mut(world_mut())`.

- With Bevy defaults disabled, explicitly enable `keyboard` and `gamepad` to
  compile the original input module. The general `std` feature does not export
  those input types. Browser intent enters through the bridge, without a second
  keyboard event loop or window.
- The cars use metres, Y up and +Z nose. Driver-right is -X in the car's local
  frame. Preserve the controller's corrected negative-Y right steering.
- Terrain samples live at texel centres, not at the heightmap domain edges.
  The collision field must preserve the half-texel shift and X/Z orientation.
  An asymmetric real-Avian raycast regression checks this boundary.
- Wheel visuals use the original pivot names, suspension lengths, steering and
  rolling speeds. Do not move the chassis onto an analytically sampled surface
  or inject steering yaw; those would bypass the physical simulation.
- The historical walking spawn `(18, -60)` is not clear for a car: decorative
  dinghies support its chassis. The car starts farther west on the dry beach;
  acceptance must prove four loaded wheel contacts on the actual full scene.

- Hiding a mesh is not enough to take it off a car: the damage rig
  (`buildDamageRig` in `src/rally/VehicleModel.js`) copies the model's meshes into
  its own dentable pieces, so a hidden mesh would come back drawn on the rig (the
  plate lettering showed twice). Remove the mesh from the model (as `paintPlate`
  does for PlateWhite and PlateBand), and the rig also skips any mesh with
  `visible === false`. The damage smoke and fire do not depend on rig meshes:
  they follow the front zone (`DamageState`, smoke from 0.5, fire from 0.9).
- The yeet ragdoll starts outside the car's walking box: its start is moved out
  of the door by the box half-width plus 0.15 m (`RallyDrive`, `walkingProxy.half.x
  + 0.15`). Started inside it, the walking collider shoved the body out and it flew
  20 to 90 m.
- The chase boom meets camera-only obstacles that the car never does: roofs and a
  0.9 m eave over each building, palm and tree trunks, and banana plants (a stem
  cylinder up through the crown, plus a pull of at most 3 m where the leaf spread
  sits at the lens; `cameraPlants` in `WorldPhysics.js`).
- The driving key strip is placed by measurement, not a width breakpoint:
  `DriveHUD.fitKeys` keeps it in the top row when it fits between the brand and
  mode pill and the purse, and drops it below (`.rh-keys.is-below`) otherwise.
- Ferry traffic gives way to the player's car (`src/ferry/Traffic.js`): a scripted
  car stops while the player's footprint, now or where its velocity takes it in
  the next 1.6 s, comes within 2.3 m of the car's next 9 m of road, and no car
  starts aboard while the player's car is moving in the lanes or aboard.

## Car lights

`src/rally/CarLights.js` gives each drivable car (every row of `src/rally/Vehicles.js`) and every remote car in shared driving:

- two headlight spot lights at the front of the headlamp lenses, aimed slightly down the road (`LAMPS.head`, 60 m range, 9 to 24 degree cone);
- a small red point light behind the car for the tail lights, three times brighter while braking;
- glowing lenses: the Aster's `Headlamp` and `TailLamp` materials, the Jeep's `LEDLens` and `RearLED`. Each car draws its own copies of those materials, so one car's brake lights never light another's.

Head and tail lights come on from dusk on the island lamps' ramp (`smooth( G.night, 0.15, 0.75 )`, the same as `src/materials/LocalLights.js`) while someone drives the car or it coasts after a bail-out; brake lenses glow day and night under the brake key or trigger. Remote cars have no pedal data, so their brake lights follow deceleration (over 3 m/s² while moving). The spots share LocalLights' eight nearest-to-camera slots with the island lamps.

## Car dock

The start screen offer ends for good on the first walk of 4 m, a drive, the free camera, any
other mode or a teleport, or 60 s after the intro guide closes (`DriveHUD.offered`).

The "Take a car" dock (`src/rally/DriveHUD.js`, styles in `src/rally/rally.css`) is not a
permanent panel:

- Driving: always shown, as the compact chip strip (Recover, Repair, Leave, sound, Drive together).
- On foot (`walk` or `ferry` mode) it shows only:
  - on the start screen, until the first walk of about 4 m or the first drive (`hud.fresh`);
  - within 7 m of a drivable car, tested by `rally.nearCar( pos, radius )`, which returns the
    nearest drivable car (`{ key, model, distance }`) or null. Only the selected car (any row of
    `src/rally/Vehicles.js`) is drivable; the support wagon and pickup are props. Add new drivable cars
    to `nearCar`;
  - when summoned with the unlisted Backquote key (on foot or in free camera). Pressing it again,
    walking 25 m from the summon spot or getting in dismisses it. It is deliberately left out of
    every key legend, prompt and the help.
- Changing Vehicle or Start at moves the car away, so the dock stays put for that choice (the same
  25 m rule as a summon).
- It fades in and out (200 ms opacity and a short rise, `.is-away`, made `inert`), with no motion
  under `prefers-reduced-motion`.
- It stays hidden (`dock.hidden`) during a bail-out and in `jetski`, `jetski-thrown`, `ragdoll` and
  `ferry-helm`, as before. "Drive" from a summoned dock enters the car wherever it is parked (the
  Start at spot until the player picks another), including from the ferry deck.

## Rebuild and refresh

The prebuilt browser module and original GLB assets are included in `public/rally`.
`npm ci` and `npm run dev` are sufficient for playing; Rust is only needed when
rebuilding the module or running its native tests.

```sh
# Once, if the Rust browser toolchain is not already installed:
rustup target add wasm32-unknown-unknown
cargo install --locked wasm-bindgen-cli --version 0.2.114
npx playwright install chromium

# Refresh from a Rally checkout (set RALLY_DIR, or pass its path after --):
npm run sync:rally
npm run build:rally
npm test
npm run build
```

The build script accepts `WASM_BINDGEN=/path/to/wasm-bindgen`; it also finds the
Rally checkout's own tool at `$RALLY_DIR/target/tools/bin/wasm-bindgen` when
there is no matching version on PATH. Sync reads the Rally checkout, copies the
physics/input and car files, extracts the original vehicle bundle, and refreshes
the source hashes. It never writes to the original project. Changes to the source
Rally module layout fail explicitly so the adapter can be reviewed.

## Scope

This is an island driving integration: the Aster and lifted Jeep are drivable, the two support
vehicles are parked, and the original fishing/boat game remains available on foot.
It does not import Rally's roads, missions or renderer. The island's existing
static boxes/cylinders and full-resolution heightfield supply collision, plus car-only
palm and tree trunks and the road's guardrails. Grip comes from the surface under each
wheel contact (asphalt, gravel, dry and wet sand, soil, rock, wood, water); see
`docs/rally-physics.md`. Cars float in the sea instead of being reset.

## Acceptance

`test/browser/rally.spec.js` binds native Playwright tests to explicit
Given/When/Then steps. The host is the actual local game on port 5190 with
fresh browser persistence. Terrain, WebGPU rendering, WASM and car physics are
real. Only the unrelated Google Fonts stylesheet is replaced with empty CSS.
Actions use the visible driving button and genuine browser keyboard events;
assertions read the driver's accessible telemetry, not internal game hooks.

The original three scenarios were executed against the buildable baseline and
all failed at the absent Drive Aster RS button. The first integrated run failed
the four-wheel support assertion because the car spawned on dinghies; the same
scenarios passed after moving the spawn. The free-camera scenario separately
failed on the missing “Return to car” prompt before its copy was corrected.

Scope HUD text locators to their status element: labels such as “Free camera”
also appear in the hidden controls help. A strict-locator failure is a fixture
error, not behavioural negative evidence.

`npm test` includes the native Rally regressions, a real-Avian asymmetric terrain
raycast, checks of the actual shipped WASM (terrain support, reset, imported box
and cylinder collision, invalid inputs), original fishing/engine tests and all
eleven real-game browser scenarios across driving, tyre effects, vehicle selection,
recorded audio, shared driving and both coastal entrances. No test scripts are
opt-in-only gates. See `rally-expansion.md` for the added assets and scene work.
