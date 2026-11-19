# Jetski

Rideable jetskis: three at the Tidewater beach hire stand and two at Joey (`src/jetski/spots.js`
from the model, the built-in `DEFAULT_SPOTS` in `src/jetski/Jetski.js` otherwise).

| File | What |
| --- | --- |
| `src/jetski/JetskiController.js` | the physics (rigid body, 6 DOF, 120 Hz substeps), `SKI` tuning table, `defaultHull()`, wake footprint |
| `src/jetski/Jetski.js` | skis in the world, riding / getting off / crashes, chase and hood cameras, spray, HUD |
| `src/ocean/WakeSim.js` | second pressure source (`wakeSki`), the window follows the ridden ski |
| `src/audio/SoundScape.js` | `jetski_idle` / `jetski_run` loops pitched with rpm, `jetskiSlap()` |
| `tools/audio/build-jetski.mjs` | builds the loops from Freesound 36169 (moxobna, CC0) |

## Controls

W throttle (ramped over ~0.25 s), S brake, then slow reverse (reverse bucket), A / D steer (the nozzle:
no thrust, no steering), Shift tuck (weight forward, less air drag), Space lean back, a tap pops the bow.
In the air Shift noses down (W too, at 30 %, because it is held for speed), S / Space nose up, A / D roll. With no
input the rider soaks up the pitch and roll the ski left the face with and holds the nose about 6 deg up for the landing. C chase / hood camera, E get off. A
standard gamepad works through `RallyDrive.gamepad()` (stick steers, triggers throttle / brake).
On foot or swimming within ~3 m: E rides, climbs aboard from the water, or rights a capsized ski.

## Physics model

### Extreme-current integration correction (QA)

The original explicit panel update could amplify relative-flow energy and become non-finite in a 100 m/s current within twelve 120 Hz steps. `FluidStep.js` now solves all passive point resistances together using `(M + h K) twistNext = M twist + h (externalWrench + fluidTargets)`. The matrix includes the declared, rotated added mass and inertia; each resistance contributes a positive rank-one `k [n, r cross n] [n, r cross n]^T`. This accounts for the rotational effective mass and interaction of the hull panels. There is no new velocity cap, and the old 20 rad/s angular clamp was removed.

Panel flow uses shared current and queried vertical water motion. Radiation damping acts normal to the free surface; crossing a steep surface is no longer counted as an extra vertical fluid velocity for a deeply submerged hull. The previous hull-aero `+k v_y` term added energy and now opposes cross-flow. Hydrostatic, contact, rider, drive and empirical downforce terms remain separate external loads. Coefficients are still tuned assumptions; the model is not a validated craft response at hundreds of metres per second. The shallow-water field has no resolved breaking-wave or three-dimensional vertical circulation.

Maintained `test/jetski-fluid.mjs` exercises actual `step`, query/update and the evolving 257-grid 3,000 m field. The unchanged old-source selection fails five physical assertions and passes the calm riding check; the correction passes all six. The field fixture samples 2,784.62 m water height and 307.35 m/s current, with finite physical advection. Calm flat-water 0–60 km/h remains 3.73 s and 0–100 remains 9.57 s; twenty-second speed changes from 107.87 to 107.93 km/h. Existing equal body/current/wind translation checks also pass. These CPU results are supplemented by the integration lane's actual 3,000 m UI run: 86 event observations across 13.0166 simulated seconds plus Restore, all observed native/craft/parked-ski/NPC values finite and zero browser errors. Jetski peak speed was 202.652 m/s and angular speed 28.757 rad/s; Restore returned within 5 m of the pre-event neighbourhood. Evidence is `task/output/playwright/gameplay-recovery/jetski-coupled-extreme/tsunami`. This closes the demonstrated NaN path; it does not claim real-world extreme-craft fidelity or resolve the separately tracked NPC stability issue.

- **Mass**: 350 kg ski plus an 85 kg rider. His weight sits on the seat and shifts sideways into the
  turn (0.28 m) and fore and aft on tuck or lean back (0.22 m), so the centre of gravity moves.
- **Hull filter**: each grid point's height and slope pass a two-stage moving average along its own track
  (`chopL` 1.8 m of track, `chopT` 0.06 s at rest), so the 3.3 m hull bridges chop shorter than itself and still
  rides the swell (2 m chop cut to about a seventh, 18 m waves kept at ~90 %). The query is asked that much further
  ahead to make up the delay.
- **Water**: a 3 x 3 grid of GPU water queries under the ski, asked for where the grid will be after the
  read-back latency, extrapolated with the local surface rate as in `BoatController`, and interpolated
  to every hull panel. The island's query had 64 slots, all taken by the time the mate asked for hers (the ridden
  ski has 9, the parked skis 4); it has 128 since 2026-09-27 (`MAX_QUERIES` in `src/ocean/WaterQuery.js`, one 64-wide
  workgroup per 64 slots in use), so late allocators get a real slot. A ski with no slot bobs analytically.
- **Hydrostatics**: one water column per panel, from the panel to the deck. Columns work upside down, so a
  capsized ski floats on its deck. Panel areas are scaled so the loaded ski floats with its origin on the
  static waterline. Heave damping works against the water's own vertical motion.
- **Planing**: every wet panel pushes along its own normal with `p = 1/2 rho C_L |v| (v . n)`.
  Deadrise and bow rocker are in the normals. This one term gives lift, induced drag, chine grip and
  porpoising damping. The panel velocity is taken relative to the local surface: the surface rise under a panel
  running up a face (`v . grad h`, `faceK`) adds angle of attack, so a face throws the ski up and a crest that
  drops away faster than gravity leaves it in the air. A slam term, `1/2 rho C_s A vi^2`, acts on panels entering
  the water, by the immersion rate `vi` (not `v . n`, which fired on every skimming bow panel at speed). It is
  capped so it cannot reverse the entry in one step. Heave radiation damping fades out between 4 and 14 m/s.
- **Drag**: skin friction on the wet panels, plus appendage and spray-root drag (intake grate, ride plate,
  sponsons). The displacement hump peaks near 19 km/h and carries a bow-up moment. Burying drag acts on panels deeper
  than the chine (nose dives), and air drag on the rider and ski.
- **Lateral**: strake lift grows with speed times slip. It stalls between 17 and 31 deg of slip, so the ski slides.
  Cross-flow drag adds to it. The flat pad and ride plate aft grip little, so the forward strakes carve.
- **Jet**: rpm spools in about 0.4 s and idles at 14 % (creep). Thrust is `rho A Vj (Vj - u)`, with
  `Vj = 58 m/s x rpm` and A = 0.00112 m^2 (about 3.8 kN static). It only acts while the intake is wet (the pump keeps its water for `primeHold` 0.2 s after a hop). In the air the
  engine runs up unloaded, and the audio over-revs. The nozzle vectors the thrust by up to 20 deg. The bucket
  reverses it at 50 % efficiency.
- **Rider**: he holds a bank into the turn with a bounded roll torque (up to 40 deg, 9 kN m, the abstraction for his
  body english against the hull's roll stiffness). Coasting he barely leans (10 % of the lean without the jet
  pushing), so the ski barely carves. In the air he can pitch and roll the ski.
- **Crashes**: he is thrown off in any of these cases:
  - a roll past 100 deg lasting 0.25 s;
  - a landing with more than 5 m/s normal entry while more than 32 deg nose down;
  - a landing with more than 9 m/s entry at any pitch (11.5 m/s when it is flat-ish: nose within 15 deg down, bank within 30 deg);
  - a landing rolled past 55 deg with more than 3.5 m/s entry;
  - a spin-out above 50 km/h;
  - a hit on a solid at more than 9 m/s.

  The lanyard cuts the engine, and he flies ballistic into the water and swims.
- **Contacts**: the terrain (penalty spring, sliding friction, and a positional clamp past 0.22 m, so it cannot
  tunnel), pier piles (`Colliders.resolveCapsule`), the lobster boat and the ferry's two demi-hulls (capsules).
  The ski can run under the ferry's bridge deck between the hulls. Floating solids (`solids`, the course's kicker ramps)
  are ridden by the hull panels: a penalty along the surface normal (6e5 N/m over the whole bottom, spread by panel area),
  damped, wet-plastic friction 0.1, the reaction pushed back into the ramp. Riding a ramp is not air.

## Measured

Headless: `skisim.mjs` (flat water, a 2 m x 40 m swell, and a sea of three swells plus chop down to 1.6 m that matches
the game's: height std 0.41 m, slope rms 0.16). In game: `skiverify2.mjs`, Playwright on :5311, typical sea (height
std 0.26 to 0.41 m, slope rms 0.14 to 0.16; it changes between runs).

| | flat water | in game |
| --- | --- | --- |
| 0 to 60 km/h | 3.70 s | 3.9 to 4.2 s |
| 0 to 100 km/h | 9.53 s | |
| top speed | 108.5 km/h | 97.9 km/h (sea std 0.36 m), 80.7 in the roughest run (std 0.41 m, one landing wipeout) |
| slams (vi > 2.2 m/s) in a 22 s run | | 28 to 123 (was 598) |
| turn, throttle held | 7.4 m radius at 40 km/h, bank 23 deg | 7.4 m radius at 35 km/h, bank 24 deg |
| same, throttle off | 92 m radius, bank 3 deg | 44 m radius at 35 km/h (the sea turns it too) |
| air (sea, full throttle) | best 1.08 s, 1.22 m clear of the water | best 0.66 s, 0.59 m clear |
| reverse | -4.0 m/s | -4.75 m/s |
| frame / physics | | 16.5 ms riding, physics about 0.1 ms per frame |

Crash cycle in game: thrown at speed, swims, climbs aboard, rides away at 55 km/h. Capsized: `Right the jetski`, E,
upright (up.y 0.99), climbs aboard, rides away at 50 km/h. Ferry: full throttle into the side, it stops 3.5 m from
the demi-hull centre line (capsule radius 2.0 m). Audio: the idle loop runs 0.98x at idle up to 1.78x, the run loop
fades in (gain 0 to 1.06) and runs 0.79x to 1.19x with rpm, and both fall back on release.

## Tuning notes

- Acceleration and top speed trade through `nozzleArea`, `jetSpeed` (static thrust against thrust at speed)
  and `appendage` (the top end). `cf` stays at a plausible skin friction.
- Turn radius comes from the strake grip distribution along the hull, relative to the centre of gravity.
  With the grip aft, the ski weathervanes and will not turn. The rider leaning forward in a carve wets the forward strakes.
- A hull file whose panels stop short of the bow cannot rise over the hump. The model’s `jetski.json`
  stops at z = 0.85 m, so it is rejected and `defaultHull()` is used (`state().slots.hullSource` says which).
- Parked skis get the parked query slots in order (not by spot index), and a stale result (asked for another ski) is
  skipped, so all four parked skis ride the real surface.

## Buoy course (`src/jetski/Course.js`, `tools/jetski/course_build.py`)

Wave Race 64 style, off the main beach: open water 6 to 12 m deep between the pier (x 54, z < 40), the lobster boat's
mooring (64.5, 36.5) and the ferry's approach (x 150, z > 325). Ride out from the hire; there is no teleport.

- **Layout**: gate at (0, 125) heading +z, two inflatable arches 7 m apart (the line is on the first, 6.2 m either side).
  Out: slalom red (4, 160), yellow (-4, 190), red (4, 220), yellow (-4, 250), ramp 1 (nose (0, 279), lip 4 m on), the
  big turn marker (30, 340). Back (heading -z): red (64, 305), yellow (56, 275), red (64, 245), ramp 2 (nose (60, 214)),
  yellow (56, 175), red (64, 145), yellow (56, 115), the hairpin marker (30, 88), and up through the gate. 12 buoys,
  about 700 m a lap.
- **Rules**: red, pass on its left (the buoy on your right); yellow and the two turn markers, pass on its right. A buoy
  passed on the wrong side, skipped, or left when you finish flashes and costs 2 s. Crossing the gate starts a lap; crossing
  it with at most the last two marks left finishes it (a checkered flag in the HUD), earlier restarts it.
- **HUD**: lap time (penalties included), best lap, buoys, a missed-buoy line, top centre in the jetski HUD's glass.
  Best lap and its ghost persist in localStorage (`tidewater.jetskiCourse.v1`, the storage GameState uses).
- **Ghost**: the ski pose at 20 Hz; the best lap replays as a translucent ski and rider (its own load of `jetski.glb`, plus a
  seated rider built from primitives on the contract pivots Seat, GripL/R, FootL/R). Unlit ice blue with a bright Fresnel rim,
  depth tested and depth written, so only its nearest surface shows (`Course.js` `ghostRider`, material `jetskiGhost`).
- **Floating**: the island's shared `WaterQuery` (`app.query`, 128 slots: the course takes 24 from slot 64, no dispatch or readback of its own): one point per buoy, two per arch, four per ramp,
  so everything rides the real surface (FFT, shore, wake). Buoys follow within ~0.15 s and lean with the surface;
  mooring lines run to the sea floor. Ramps: heave, pitch and roll on the corners' water plane (60 % of the corner slope),
  waterplane stiffness, strip-theory added mass (~11 t): natural period ~2 s, so a ski crossing in 0.25 s barely dips it.
- **Ramps**: 4.0 m, 2.6 m wide, top from 0.08 m under the water to 1.0 m (1.25 m wedge over a 0.25 m draft, 15 deg),
  grippy dark deck with ribs, HDPE yellow sides with the print, orange bullnose edges, foam float band.
- **Models**: `jetski_course.glb` (30 k tris): `BuoyRed`, `BuoyYellow`, `BuoyTurn`, `Arch`, `Ramp`, `MooringLine`, `BuoyFlash`.
  Inflatable PVC with weld seams and chambers, light gloss (coat), brand-free "TIDEWATER BAY" print, checkered banner.

Measured (Playwright :5371, scratch `cverify.mjs`, typical sea, autopilot on analog steer, throttle off in the air):

| ramp, speed at the nose | air | clearance | notes |
| --- | --- | --- | --- |
| 1, 57 to 59 km/h, centred | 1.06 to 1.22 s | 1.98 to 2.51 m | exit vy 4.6 m/s (15 deg) |
| 2, 59 km/h, centred | 0.80 s | 1.37 m | |
| 1 and 2, 73 to 74 km/h | 1.11 to 1.49 s | 2.1 to 3.55 m | |
| 1, 81 km/h | 1.20 s | 2.05 m | rolled landing wipeout |
| off-centre 2 to 5 m, or off a swell first | 0.5 to 0.8 s | 0.2 to 0.9 m | half the hull misses the deck |

The autopilot tops out near 80 km/h in this sea, so 90 at the nose was not reached. Frame on the course 16.6 ms
(p95 16.7, vsync). Wake: the ski's water queries include the wake (`WaterQuery.heightModule` adds `wakeDisplacement`). The ferry is a
WakeSim source (see the polish round below).

## Rocket (X)

Requirement: a rocket booster mode. A rocket pod rides on the swim platform of every ski.

- **Pod**: `tools/jetski/rocket_build.py` builds `public/models/jetski_rocket.glb` (6.5 k tris), a separate GLB, so the
  jetski contract cannot move. Nodes `RocketPod` and `RocketOut` (the bell exit, (0, 0.446, -1.915) in the ski frame).
  Red canister with a white ogive nose, rolled seams and bolt ring, a hazard stripe band, a yellow DANGER / ROCKET BOOST
  plate, four black fins in an X, a steel bell nozzle, two saddle clamps on legs to bolted feet. It is tipped 9 deg (nozzle up)
  so its thrust line runs through the loaded centre of gravity. `Jetski.js` hangs a clone on every ski.
- **Controls**: hold X (free on the ski; `FerryDeck` uses X only at the ferry helm). About 6 s of burn (`rocketBurn`), refills
  over about 20 s (`rocketRefill`) while unlit. Run dry, it flames out and waits for X to be let go. HUD: a Rocket bar under
  Throttle, and X in the key hints.
- **Physics**: 9 kN (`rocketThrust`) at the bell exit through the rigid body, aimed from the bell through the centre of gravity
  (no moment of its own). It burns in the air too. Lighting it pops the bow for 0.3 s (`rocketKick`, the rider's pop torque).
  Substeps: 2 per 120 Hz step past 24 m/s or while lit, 3 past 45 m/s (0.19 m of travel per substep at 70 m/s).
  `boosting` (bool) and `boostLevel` (0..1) on the controller are for the cockatoo and the audio.
- **Aero stability** (round 4): the pod's fins and the hull are air surfaces, so she stays upright at 250+ km/h without
  cutting thrust. All terms blend in between 26 and 42 m/s (`aeroOn`), above the 30 m/s jet-only top speed, so the ride,
  the turns and the hops below about 95 km/h are unchanged (headless: 0 to 100 km/h 9.52 s, top 108.2 km/h, turn radius 7.5 m,
  as before).
  - Fins (`finK` 2 m^2 per rad, at `finAt` (0, 0.42, -1.8), 1.5 m behind the centre of gravity): a finned rocket's weathervane.
    Their normal force against the cross-flow, `1/2 rho_air finK |v| v_perp`, turns the nose back into the airflow in pitch
    and yaw, and the fins' own motion as she rotates adds damping. The value stands for the four fins plus the hull's aft body.
  - Aero damping (`aeroDamp` [30, 14, 12] (was [22, 14, 8] to round 4): pitch, yaw, roll, N m s per rad/s per m/s of airspeed): about 1.5 kN m s per rad/s
    in pitch at 250 km/h.
  - Hull (`hullAero` [3, 0.6] at `hullAt`): tuned like a racing hydroplane. A nose-up hull is pushed down (anti-lift, 3 m^2 per rad),
    plus a downforce of C.A 0.6 m^2 (1.2 kN at 250 km/h).
  - Wave faces: the face term (`faceK`) fades by 90 % between 30 and 55 m/s (`faceFade`), where the hull bridges the crests
    instead of running up each face.
  - Landings: a flat one (nose within 15 deg down, bank within 30 deg) holds up to 11.5 m/s of entry, rising to 18 m/s between
    25 and 60 m/s of speed (`landFast`): at rocket speed a flat hull skims in on a long footprint. Nose-down and rolled
    landings still throw him, and hard steering at full speed still wipes him out.
- **Effects**: a plume, not a beam. A short blue-white core, a yellow then an orange plume that fades out aft, and a soft glow
  at the bell. Each layer is a nest of three dim additive cones, so the overlaps build toward the axis and the edge stays soft.
  Four shock diamonds down the core. Each layer flickers in length and width every frame. Thin hot sparks, a white smoke
  trail (mist), a rocket rooster tail (thrown up at 11.5 m/s, about 6.7 m, and left hanging behind her; it drops off as
  she lifts off a crest and returns on touchdown), longer chine streaks, the chase camera pulled back 1.6 m and up 0.5 m,
  FOV +6 deg, a steady shake, a jolt and FOV punch on ignition, a puff on flameout. The camera feeds the
  ski's motion forward past 22 m/s, stays 0.7 m over the terrain and is pushed out of pier piles.
- **Cockatoo**: he clings on through a burn (perched, on his skin at 279 km/h). Crest flat, tail shut, head down into it. One squawk as it
  lights, and now and then during the burn (at most one per 2.5 s). The air squawk waits until the burn ends.
- **Sound**: `rocket_roar` (Freesound 515123 "Rocket Thrust 01", LilMati, CC0; `tools/audio/build-rocket.mjs`) layered on the
  engine loops in the SoundScape jetski bed while lit.

Measured, round 4 (in game: Playwright :5447, scratch `r4verify.mjs`, typical sea, W and X held from rest for 8 s; headless:
scratch `rsim.mjs`, the roughest sea, std 0.41 m, random headings):

| | before (round 3) | round 4 |
| --- | --- | --- |
| wipeouts, straight full burn, in game | nearly every run | 2 of 10 (both rolled landings, bank past 80 deg, at 283 and 308 km/h) |
| wipeouts, straight full burn, headless | 10 of 10 | 0 of 20 |
| top speed in one burn, in game | 269 km/h | 216 to 309, median 262 km/h |
| airborne share of a burn run | 115 to 337 frames per burn | 30 to 68 % of frames: big hops, and they land |
| pitch during a burn | +50 to -43 deg (swinging about 70 deg) | +19 to -13 deg |
| hard steer (full lock 1.5 s at ~280 km/h), headless | | 8 of 20 wipe out: still possible |
| physics while lit | 0.36 ms average, 0.54 ms max | 0.45 ms average, 1.7 ms max (2 to 3 substeps); frame 17.4 ms (p95 16.8) |
| burn / refill | 5.98 s to empty; 20 s to full | unchanged |

**16 kN**: headless, 12 of 20 burns wiped out (flat and rolled landings at 430 to 500 km/h), and 12 kN wiped out 8 of 20. Stable
9 kN already reaches 260 to 300 km/h, so the thrust stays at 9 kN.

Round 4 bug fixes:
- **Rider in the air with no ski** (and the same bug seen when reversing): `mount()` left `thrown` set when he got back on
  before his throw finished, so `rideFrame` kept drawing him in his tumble at that spot and the camera followed it
  (in game it sat 124 m from the ski). `mount()` clears it now; after a throw and a remount the camera sits 4.4 m behind the ski.
- **Get off prompt**: hidden in the same frame as the throw (opacity 0 at once), not faded out over the throw.
- **Free camera**: the jetski HUD (speed panel, key legend) is hidden. The F Walk prompt is the free camera's own: F leaves
  him walking.
- **Reverse**: 8 s astern reaches 4.2 m/s, bow up 7.7 deg, hull 0.26 m over the static waterline, rider upright and lit from
  the front. The upside-down, back-lit rider was the stale throw above.
- **Low-speed capsize**: not reproduced. At 9 to 15 km/h, S+A, S+D, W+S+A, W+S+D and W+A held 4.5 s gave at most 23.7 deg of
  bank. `lowRollMin` stays 1 (off).
- **Nose-up ramp launches**: not reproduced. Ramp hits at 40, 73 and a boosted 193 km/h left at most 11.6 deg nose-up in the air
  and landed between -7 and +18 deg. `airHold` is unchanged.

Slice 2 fixes with it:
- **Buoys and arch legs** (`Course.bumpers`): buoys are soft bumpers (26 kN/m, 2.5 kN s/m, no hard stop). The ski shoves them
  aside on their mooring (up to 2.5 m, spring back) and pushes them under (they bob). Straight at the first red at 40 km/h: 4
  contacts, the buoy moved 1.4 m and dipped (vy -0.34 m/s), the ski lost 2 km/h, no crash. Arch legs are hard capsules
  (0.5 m radius, a hit over 9 m/s throws him).
- **Joey 2** moved from (-261.6, 624.6), under the Joey pier walkway, to open water at (-247.0, 629.5).
- **Low-speed capsize**: see round 4 above.

## Polish round (2026-09-27)

Scratch harness `jpolish.mjs` (Playwright :5373, no-HMR vite, typical sea).

- **Ghost**: a translucent ski and rider, readable at chase distance and close up (`cap/ghost-close.png`, `cap/ghost-chase-2.png`).
- **Clean lap**: the scripted lap ran without a wipeout, 59.4 s raw (67.4 s with 4 missed buoys: the autopilot line, not the
  rules), and its ghost (1187 poses) replayed on the next lap (`cap2/ghost-close.png`).
- **Prompt**: the prompt pill is lifted over the jetski HUD by its measured height (`--jh-h`, a ResizeObserver on `.jh`), 16 px clear.
  Measured gap 16.1 px; with the old rule, -4.8 px (it overlapped the panel).
- **Rocket stability**: `aeroDamp` pitch 22 to 30 and roll 8 to 12. Headless (`rsim.mjs`, N = 20): straight 0 to 1 wipeouts
  (a flat landing at 308 km/h), steer 8 to 3. In game (`r4verify.mjs boost10`): 2 of 10 flagged, one a genuine rolled landing
  (bank 84 deg at 201 km/h) and one a roll at 2 km/h on placement (pitch -88 deg: the harness, not a burn). Tops 201 to 310 km/h,
  physics 0.39 ms average, frame 16.5 ms.
- **Rooster tail**: `_rtHold` holds the blast 0.9 s after she leaves the water (or while within 1.2 m of it), then fades over 0.6 s;
  the blast weakens with height (none past 6 m); `_rtBuild` builds the plume over ~0.8 s and sags over ~1.5 s; it is thrown from the
  water under her, up to ~8.6 m. Measured build 0.44 at 248 km/h: the plume is still not house-high in the chase captures
  (`cap3/rooster-chase-*.png`). Open.
- **Ferry wake** (`WakeSim.js` `wakeFerry`): a pressure patch under each demi-hull (45 m by 4.4 m, 13.4 m apart, fine entry and
  run, `ferryHead` 1.2 m at speed, faded in over 0.3 to 3 m/s) and the wash of her two jets. She is a source while under way
  within 230 m of the window. At 7.78 m/s (15.1 kn): the water level at a stopped ski 45 m abeam ranged -0.87 to +0.80 m as she
  passed, but the typical sea alone gives the same range (std 0.315 m against 0.333 m), so the wake height is not isolated yet.
  Crossing 40 m behind her at 63 km/h: 0.48 s of air, 0.09 m of clearance, no wipeout. Needs a calm-sea measurement.
- **Ramps with centreline pursuit**: dead centre within 1.4 m on 3 of 4 runs, but the autopilot reached only 51 to 64 km/h at the
  nose in this sea (not 75 or 90). Air 0.5 to 0.9 s, 0.4 to 1.5 m. The ramp 1 run at 90 was thrown off a swell before the ramp.
- **Ragdoll hook**: `throwRider` hands him to `player.ragdoll( null, null, { velocity } )` and falls back to the scripted tumble.
  A boosted crash at 167 km/h: ragdoll at 0.12 s, swim at 6.3 s, "Climb aboard jetski", E remounts.
- **Rear seat**: from behind (`cap3/seat-behind.png`), the grey cylinder is the passenger seat itself: a tall round bolster that
  reads as a tank. Not changed yet (a `jetski_build.py` rebuild).

## Back-seat mate

Emily (`src/jetski/Mate.js`) waits ankle deep at the water's edge by the beach hire skis (`MATE.home`, 40.5, -40). She is a female crowd cast (`f03`, the swimwear re-dress in `models/characters/crowd/swim/` when it is there, the plain cast otherwise), loaded the way the beach crowd loads them (`SkinnedModel.create` with `fadeOptions`). She is not registered with the people hub (no brain, no LOD skipping): she is animated every frame and speaks through `app.people.say`.

- **G** while riding under 5 km/h within 16 m of her (`MATE.reach`, `MATE.calm`; she stands ankle deep, 7 to 9 m inshore of the hire skis, so an 8 m range left the hire skis at its edge and the only way in was to beach the ski; a coasting hull also takes seconds to shed the last few km/h). Inside 16 m but faster, the prompt reads `S Slow down to pick up Emily`. From 40 m (`MATE.call`) she turns to a ski that is being ridden, waves it over every 7 s and calls `Over here! Give us a lift?` (the bubble shows once the camera is within the speech range, 24 m in src/people/Speech.js). In reach she: the prompt reads `Pick up Emily · E Get off`. She wades out to a point 1.05 m off the ski's left side, beside her seat, and climbs on in 1.4 s. Her weight ramps onto the ski as she climbs.
- **G** under 5 km/h within 30 m of her spot: `Drop Emily off`. She climbs off the left side in 1.1 s and wades back to her spot.
- **Wipeout** (`throwRider`): she goes on her own ballistic arc with a tumble and a splash, then waits in the water (on the bottom in the shallows). Stop the ski within 6 m of her and she swims to it and climbs back on. Ride off and she waits.

Seat and pose: her pelvis sits 0.46 m behind the `Seat` pivot and 0.05 m higher. The pose is the rider's own ski clips (`ski_sit`, `ski_lean_l/r`, `ski_tuck`, `ski_stand` from player.glb) retargeted by bone name onto the crowd rig (both are Bip01 rigs; rotations plus the pelvis translation). They are weighted like the rider's: she leans with the turn (0.85 of his lean), ducks on the rocket (tuck 0.9 x boost) and half rises in the air. A damped spring (`sag`) sinks her into heave and landings. Then two-bone IK in model space puts her ankles on the footwell deck (0.34 m either side, 0.2 m ahead of her hips) and her palms on the rider's waist (his `Bip01 Spine`, 7 cm up, 0.155 m either side). With no rider aboard her hands rest on the seat strap. There is never a bind-pose frame: the idle is evaluated before she is first drawn and a clip always carries weight.

Physics (`JetskiController.setPassenger( kg )`, `SKI.massMate` 80 kg): her mass sits at `SKI.mateSeat` [0, 0.67, -0.88] (0.46 m behind the rider's CoG). The pitch, yaw and roll inertia grow by m r² about the ski's CoG, and the air drag gains `mateCdA` 0.12 m² (mostly in the rider's lee). The panel areas stay trimmed for the solo ski, so two-up she floats lower. Measured in game, same open-water lane, full throttle from rest for 26 s:

| | mass | 0-60 km/h | top speed | draft change | launch pitch (max, first 4 s) |
| --- | --- | --- | --- | --- | --- |
| solo | 435 kg | 4.39 s | 88.7 km/h | 0 | 16.0 deg (8.6 in an earlier run) |
| two-up | 515 kg | 6.53 s | 82.5 km/h | about 2.5 cm lower | 16.0 deg (13.5 in an earlier run) |

The sea state (swell) moves these numbers from run to run; the top speed is the peak over the run.

Lines (family friendly, rare): an 8 s quiet gap between any two of hers, and a cool-down each. `Woo!` after 0.4 s of real air, `Hang on, hang on!` on the rocket's ignition, `Ha ha! What a landing!` after a big landing, `Mate, the ferry!` within 70 m of her, `Look, dolphins!` within 35 m of one, plus `G'day! Room for one more?` as you pull up, `Righto, let's go!` aboard, `Cheers for the ride!` dropped off and `I'm right, mate!` in the water after a wipeout.

Two-up the chase camera rides 0.35 m higher so she does not hide the rider. The rider's stand pose now needs real air (`Jetskis.aloft`: airborne with the hull above the sea), not a ski sat on the sand in the shallows.

## Rocket rooster tail, spray and the missed-buoy strobe

- Rocket rooster tail (`Jetski.spray`): builds while the bell's blast reaches the water. It holds 1.3 s after she leaves the water (wet or under 1.5 m up), fades over 0.8 s and weakens with height (gone by 7 m up). It builds over ~0.6 s of burn and sags over ~1.5 s, and scales at once with speed (`sstep( speed, 8, 30 )`), so a crawling ski throws none. It is made of a glassy SHEET root (0.5 s), a fanned core and two wings of dense SPRAY (life 2.4 s, up to ~17 m/s up, carried at 0.3 of her speed up to 90 km/h, rising to 0.55 by 150 km/h so the fan stands up behind her in the chase view instead of passing the camera before it has faded in; dense spray fades in over at most 0.06 s), one DROPLET request that rains back down (3.4 s) and a MIST veil laid up the column where the plume will stand (5 s).
- Measured on the fixed open-water spawn (554, 230, heading 1.178 rad): mean build 0.999 at 237 km/h, against 0.44 before. The old shortfall came from the airborne fraction (she is off the water 50 to 70 % of a burn at 190 to 240 km/h) together with the 0.9 s hold and the 1.2 m height cut. Pinned at 246 km/h she flies (mean 9.4 m up, 100 % airborne), so above ~240 km/h the plume comes and goes with her hops. That is physical.
- Every ski emitter (jet rooster, rocket rooster, chine sheets) emits along the segment she covered since the last frame (`Jetski.segFrom`). One burst per frame drew the spray as rows of separate strokes at speed.
- The spray CPU ring is 16384 (`Spray` cpuCapacity). A particle is overwritten after that many more are emitted, so the ring must hold a few seconds of everything emitted. At full rocket the ski emits ~4.2k to 6.6k particles/s (ring age 2.5 to 3.9 s). With the old 8192 ring it was 1.1 s, which cut the 2.4 s plume off before it peaked. Chine droplets are capped (`500 * min( a, 1.4 )`) and the jet rooster's drops thin out under the rocket. The spray takes 32 requests a frame, shared by all emitters, and the ski uses up to 27 of them.
- Spray sprites (`Spray.js`): dense spray and sheets stretch along their motion by at most 2x their size, tumble up to about 45 deg off it, are soft-edged, and are gone into drops by half their life.
- Rocket flame materials have `velocityWeight: 0`. An additive glow has no coverage of its own and must not claim the motion of the hull or water behind it.
- Missed buoy (`Course.update` / `judge`): the BuoyFlash shell strobes a hot white-amber (`buoyStrobe`) at 3 Hz for 2 s. The glb's own flash was the red buoy's own red, so nothing showed. A soft additive glow swells and dies twice a second, and a ring runs out to ~6 m over the water.

## Plough (rocket speeds, 2026-09-27)

Held at rocket speed the ski used to fly: 93 % of each landing's sink speed came back as the next take-off (trim lift
off the planing panels), so on the headless speed-hold sim (a scratch script,
fuel topped up, rsim's sea) it was airborne 67 / 81 / 84 % of the time at 150 / 200 / 246 km/h, mean height 0.94 /
1.34 / 1.75 m, peaks to 8 m. `SKI.plough` (1/s) damps the whole ski's rise off the water (faster than the water's own
rise), by how much of the bottom is wet, over the `aeroOn` band only, so nothing below 95 km/h changes. At 20:
52 / 69 / 71 % airborne, mean 0.46 / 0.62 / 0.69 m, peaks 2.1 / 2.6 / 3.1 m, longest hop under 1 s; rsim straight
0/20 and steer 1/20 wipeouts (were 1/20 and 3/20). Two-up (hsim MATE=1): 1/6 wipeouts at each speed (were 0/6).
The airborne flag counts any moment with under 1.5 % of the bottom wet, so skimming counts as air.
Rising only matters: a symmetric damper at 30 dug the hull in and rolled it in turns (steer 13/20).

## Emily in the water and on the back seat (2026-09-27)

- Her own sea: one water-query slot (`mate`); treading water she reads the sea where she is, not the ski's level. Her chest node (`Bip01 Spine2`, measured on load, 1.26 m) sets the waterline.
- Treading pose (`Mate.treadPose`, no swim clip on the crowd rig): hands sculling out to the sides just under the
  surface, elbows bent, legs cycling slowly half a stroke apart, a small lift with each stroke. `MATE.scull`, `cycle`.
- The chase camera: while her head sits within `MATE.clear` of the sight line to the rider's head or chest she fades
  to `MATE.ghost` on the people's dither (`setFade`).

## Camera NaN and Emily's sea slot (2026-09-27)

- The "black sky over white sea" frames (ski-mate r5-08, ski-people cmp-i3) were the probe, not the game. Its view
  hook read `window.__view`, which is the game's own DebugViews jump function (`src/core/DebugViews.js`), so it was
  always truthy: the hook took it for a pose, `s.dist` / `s.up` were undefined and it wrote NaN into the camera after
  `camera()` had set a good one. Probes must use another name (the nan-cam probe uses `window.__nv`). A NaN frame
  renders black and the temporal upscaler keeps it in its history: white sea, black trees, speckled clouds.
- `keepCamFinite()` runs at the end of `camera()`: a non-finite camera position, quaternion, FOV or `camPos` (which
  the chase eases from, so a NaN there stayed for good: 52/52 frames in the red probe) goes back to the last good
  pose, the chase is set up again next frame (`camInit = false`) and `app.cameraCut()` drops the upscaler history.
  Warned once.
- Emily's `mate` slot had been silently failing (`allocate` threw, the catch kept `slot = -1`) so `seaHere()` read the
  ski's level: her sea minus the ski's was 0.000 in every sample. With 128 slots she gets slot 64; the failure path
  now warns. Treading 14 m from the ski her sea differs from it by -0.33 to +0.36 m and her chest stays within
  -0.01 to +0.05 m of her own waterline.
- The course (`Course.js`) still runs its own `WaterQuery` from when the 64 were full; it could move back to the
  shared one (one dispatch and one readback fewer).

## Jetski FX round 2 (2026-09-27)

- **Rocket flame** (`Jetski.js` `makeFlame`): a white-hot core (0.42, 0.36, 0.2), an orange plume and a faint red fringe
  (0.05, 0.011, 0.002). Every cone fades toward its silhouette (Fresnel on its own world-normal varying, 0.25 + 0.75 n.v^2)
  and down its length (uv.y, 1 at the bell exit), so no layer reads as a flat wedge. Sparks keep the plain additive material.
- **Rooster veil**: the mist veil is laid along the path covered since the last frame (`segFrom( 'rtv' )`), not as one
  column a frame (a row of separate puffs at 200 km/h). Wings thrown out at 3.5 + 3 kr m/s.
- **Spray edges** (`Spray.js`): the depth and water fades are never sharper than ~4 px; the drop swarm has a round envelope
  and takes the smooth fibre noise under ~40 px across (the dots aliased into stair steps at half resolution); the mist
  envelope has a zero-slope edge.
- **Ferry wake** (`WakeSim.js` `wakeFerry`): ferryShape (2.4, 1.8, 0.6, 3.2), ferryHead 1.45, ferryWash 0.5. Measured on a
  calm sea (probe override: local wind 1.2 m/s, swell 0.02) after 30 s at 7.3 m/s: wave envelope edge at 16 deg each side
  (the 35 % edge sits just inside the 19.5 deg cusp line), envelope peaks 0.4 to 0.76 m, 40 to 85 m aft of the bow. Each
  jet's wash spreads (1 + 0.06 m per m aft) and breaks into lace fixed in the water, sparser aft, gone by ~60 m. The wedge
  is in the field but still hard to read from above; the foam patches render with hard edges (WaterSurface foam, not here).
- **Probe trap**: pinning her speed by overwriting `ctl.velocity` every frame sinks her (hUp -1.1 to -1.5 m, the camera
  ends up under water). Let the rocket accelerate her instead.

## Spray, wake and course FX (round 3)

- **Rider through the spray.** `Spray.setFocus( point, radius )` (src/fx/Spray.js) takes the rider the camera
  follows. The spray render thins every particle in a cone from the eye to her (and nearer than her) to a veil
  (x0.12 for clouds, sheets and mist, x0.4 for clear drops). Side-on and wide views have nothing of the plume on
  that line and keep all of it. `Jetskis.update` sets it every frame in the chase camera and clears it
  otherwise (hood camera, thrown, free camera, off the ski). All spray also fades softly over the last 6 m
  before the eye (clear drops over the last 1.2 m).
- **Rocket fan.** Past ~130 km/h the fan's wings are thrown out harder with her speed (`wing = 3.5 + 3 kr +
  0.22 (v - 30) fan`), and a lower outer pair opens either side of her. At 250 km/h the chase view shows a
  fan to either side with the column behind, not a narrow white jet. The hanging veil is 45 a second for 4 s.
- **No cotton wool.** Dense spray (kind 3) is streaked finer, its envelope counts for less and it erodes
  harder (per particle), so it tears into drops by a third of its life. Mist is a grainy, thin veil with no
  lumpy outline. The crash crown throws fewer, smaller clouds wider, more drops and a thin mist.
- **Wake foam (src/ocean/WakeSim.js `wakeFragment`).** The simulated foam is compressed (`1 - exp(-1.1 f)`,
  at most 0.95) so a thick patch no longer saturates the surface's foam coverage (which drew it as a flat white
  cut-out with a crisp rim), then eroded by noise fixed in the water where it is thin. Whitecaps break along
  the wave crests (height 0.08 to 0.4 m, slope over 0.02, broken into lengths). The wave relief is drawn up to
  2.2x steeper where it is a real wave, for display only: the height the ski rides and jumps is untouched.
  A darker trough needs the surface shader (src/ocean/WaterSurface.js), which this file cannot reach.
- **Course buoys (tools/jetski/course_build.py).** Inflatable racing markers: 8 welded PVC gores with seam
  ridges, pillowed panels, welded base and dome seams, a printed band and pinstripe (no sponsor, no text), wet
  gloss above the waterline, a scum and tide line at it, a Boston valve on the dome, webbing handles and a
  stainless tie-down ring under the ballast. Same size and outline; colliders unchanged. The mooring line is a
  three-strand laid rope. Triangles: red / yellow 5288 (was 5560), turn 6088 (was 6040), line 1320 (was 28).

## Wave riding

Headless: `wsim.mjs` (scratch) rides N = 20 passes of 30 s into a head swell (0.85, 0.5, 0.3 m at 38, 26, 16 m, +-25 deg,
plus chop) at full throttle, at 0.6 throttle and at full throttle with the bars swung every 2.4 s. Per crest met: did the
bow deck (0, `deckY`, 1.45) go under, time under, airtime per crest, wipeouts, and the entry speed of every landing.

In the air (no Shift, S or Space) the rider holds the pitch: a spring of `airHold[0]` N m per rad towards the trim, damped by
`airHold[1]`, bounded at `airHold[2]` (+x torque is nose down). The trim is `airTrim` (+3 deg, stern first), plus
`airThrottleTrim` (+4 deg) with the throttle open (he sits back on the bars; the primed pump's thrust is below the centre of
gravity), plus `airMatch` x the water's slope along the heading under the ski (within `airMatchMax`): he spots the face he
will land on and meets it flat. A flat or stern-first landing (nose within 15 deg down, bank within 30 deg) holds up to an
entry of `landFlat` (14 m/s): he takes it on his legs.

| Full throttle into the swell | bow under per crest | air per crest | worst pitch | wipeouts |
|---|---|---|---|---|
| Before (the hold spring pushed away from the trim) | 0.0 % | 0.49 s | -81 deg | 16/20 |
| Hold spring restoring, trim +3 / +4 deg | 0.0 % | 0.66 s | -14 deg | 18/20 (flat landings at 11.5 to 15 m/s) |
| Plus `landFlat` 14 and `airMatch` 1 (shipped) | 0.0 % | 0.56 s | -17 deg | 2/20 |

0.6 throttle stays 0/20. `rsim` straight 0/20, steer 0/20 (was 1/20); `hsim` longest flight 0.95, 0.95, 1.02 s at 150, 200,
246 km/h (was 1.02, 0.88, 0.95). The slalom case (bars swung every 2.4 s at full throttle) is 16/20 (was 20/20): steering
in the air hands the pitch to him, and those land nose down.

- `bowDeck` 0.3, `flare` 0.8 (reserve buoyancy at the bow) on top: 6/20. Off (0, 0).
- `ploughFace` 1 (the plough lets the ski rise with the surface along its track) lets the rocket fly: longest flight 0.95 to
  1.40 s. Off (0).

## Lamps, the ski vest and the beach push-off

**Lamps** (`src/jetski/JetskiLights.js`, `SKI_LAMPS`). From dusk (`G.night`), while the ski is ridden or just after a throw:
- A headlamp spot under the bow takes one of the eight local-light slots and lights the ski and rider. The sea does not take local lights, so the same spot feeds the water material's `headPos` / `headDir` / `headCol` uniforms (`src/ocean/WaterMaterial.js`, above-water branch). There it lights the foam and the water body ahead as a pool, with a GGX glint on each wave facing back along the beam. `pool` is the fraction of the lamp's intensity used on the water. With `headPos.w` at 0 the term is skipped.
- Navigation lights are a lens, a white-hot core halo (at least `haloPx`) and a coloured glare (at least `glarePx`, faded in from `glareNear` to `glareFar` m). Each shows only over its own arc of the camera's bearing: the sidelights from dead ahead to 112.5 deg on their own side, the stern light 67.5 deg either side of dead astern, and the headlamp lens over the forward half. The port lamp's halo and glare are multiplied by `RED_LIFT`, because red reads darker than green at the same value. Checked at 150 to 200 m: green from starboard, red from port-forward, white from dead astern.
- The stern light sits on a mast: a black pole in a deck socket on the transom centreline, with the lens in a white housing on top. It is at least `mast` m tall and clears the rocket pod's top by `mastClear`, which is 0.465 m on the current model, so the pod and the rider never hide it from astern. The mast shows with the lamps.

**Ski vest** (`src/jetski/Vest.js`; model `public/models/jetski_pfd.glb` from `tools/jetski/pfd_build.py`). It is a neon high-vis PFD:
- quilted foam panels with bound, rounded edges and a curved hem;
- 25 mm webbing with side-release buckles and ladder-lock adjusters;
- a zip, a collar and a webbing grab loop;
- retroreflective tape (`PFD_Reflective`).

The nodes `pfd_rider` and `pfd_mate` are each wearer's `Bip01 Spine2` rest frame, in centimetres under the rig's 0.01 scale. Worn, each node's matrix is that joint's posed model-space matrix (`SkinnedModel.world`), written every frame after the pose. The tape's emissive follows `G.night` (`VEST.tape`).
- The rider (`Avatar`) wears it on the ski and after a throw while ragdolling or swimming. It comes off on land.
- Emily (`Mate.wearsVest`) wears it while climbing on or off, aboard, thrown, treading water or afloat. It fades with her.
- In the water his hat hangs down his back. While he wears the vest, the hat and its chin cord stand `HAT_VEST` (2.8 cm) off his back, along rest -z, so they sit on the foam instead of in it (`Avatar.poseHat`).

**Hood camera.** It rides at his eyes: the posed neck, plus the eye height and 7 cm forward, in the ski's frame and eased (`Jetskis.hoodEye`). The cockatoo's first-person perch, out and back from the shoulder, is then behind the lens.

**Beached push-off** (`JetskiController.contacts`).
- **When it applies.** The hull counts as aground for `groundHold` s after any ground contact. With the rider aboard, the intake dry (`prime < 0.5`) and the ski below 1.2 m/s, the prompt reads "S Push off".
- **What S does.** Holding S pushes the hull stern first, flat, along its own axis. The push holds `pushSpeed` (0.45 m/s): a stiff drive with gain `pushGain`, capped at `pushGrip` of the weight, which beats the sand's friction of about 0.45 of the load. It puts no turn on the hull.
- **When it stops.** It ends when the intake is wet again. From there S is reverse thrust as before.
- **The rider.** While pushing he stands on the sand at the bow, facing the ski, and walks it back (`rideFrame`, walk clip at the ski's pace). Emily stays seated on her own.
- **Measured, two-up.** A ski run up the sand at 16 km/h moved 3.48 m in 10.0 s before the intake was wet (about 0.35 m/s).
