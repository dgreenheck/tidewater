# Player water transitions and environmental swimming

The player uses the same disaster water query as the rendered sea. The GPU query includes the tsunami displacement; its CPU readback is asynchronous. The previous transition consulted only a four-second mean, which delayed swimming while a fast crest already covered the head.

Walking now enters swimming when the live water is above the 1.62 m eye height, or when the sustained depth exceeds 1.35 m and the live depth remains above 1.1 m. The mean still rejects ordinary shallow passing waves. Swimming can stand when both mean and live depth permit it, or when the water retreats below 0.35 m. These are controller thresholds, not human survival criteria.

The mode change converts the stored feet position to the swimming float point by 1.458 m, preserving the visible body pose. It does not place the body at the new flood surface. Existing surface-following and neutral-diving behavior still owns vertical buoyancy.

## Environmental loads and voluntary swimming

`Disasters.people()` supplies the real shared field to the player. `SwimMotor` samples that field at the torso center using the complete world velocity, including stroke and drift. Field buoyancy is disabled for this controller to avoid counting it twice. Environmental drag remains the shared quadratic law, `F = rho Cd A |u-v| (u-v)/2`, with its held-step relaxation and 45 m/s² load limit.

The swimmer assumptions are mass 75 kg, effective streamlined projected area 0.18 m², height 1.8 m and nominal volume 0.075 m³. Water drag uses Cd 1; air drag uses Cd 1.1. Density is the existing model's 1025 kg/m³ water and 1.225 kg/m³ air. These are game approximations, not measured individual anatomy or physiological limits.

Voluntary normal/sprint command speeds remain 1.5/2.5 m/s. An input-history command follows the existing response rate of 3/s. Propulsion is its requested acceleration plus the opposing drag calculated in still fluid at the prior command velocity. This calibration uses the same held-step drag sequence as the field. The actual current and body velocity never enter the calibration. Propulsion magnitude is limited to 7.5 m/s², and integration uses substeps no longer than 1/60 s. This bounds total unconstrained acceleration to 52.5 m/s² before the separate surface/collision constraints. Releasing a command retains its short actuator decay, after which passive drift has zero propulsion.

The surface controller releases an exposed swimmer to the existing articulated ragdoll when local upward wind exceeds 18 m/s, matching the NPC loss-of-control threshold. This is an assumed controller limit, not a calculation that wind lift exceeds body weight. The 14 physical capsules inherit the measured velocity with zero injected spin; subsequent air, current, buoyancy and contact forces belong to the existing ragdoll.

## Wading and the trip test

Entering calm water should preserve the walking or swimming state.

- **Reference.** People lose their footing in moving water, not in still water. Flume tests on adults (Abt et al. 1989; Jonkman and Penning-Rowsell 2008) put the loss of footing at a depth times current of roughly 0.6 to 2 m²/s. Still water has a current of 0, so it never knocks anyone down, however fast they wade.
- **Source of truth.** The shared `DisasterField.acceleration` (`src/disasters/Field.js`), the same law the swimmer and the NPCs use. No private drag.
- **The defect.** The walk trip test passed the walker's own velocity to the field and tripped above 3.2 m/s² of horizontal load. The field's drag is relative, `|u - v|`, so in calm sea (u = 0) the load was his own wading drag: 2.8 m/s through 16 cm read 3.24 m/s², sprinting tripped at 4 cm, and W rebuilt the speed within 0.1 s of every recovery. `Disasters.people()` sets the field every frame, so this fired on ordinary beach walks. NPCs had the same test.
- **The rule.** The real wading drag still acts on velocity. The trip, and the NPC tip, read a second sample of the same body at rest: the push of the water, wind, updraft or quake on a body standing still. Calm water and still air push 0. A 2 m/s current over 0.6 m pushes about 6 m/s² and trips; that is 1.2 m²/s, inside the reference band. The 3.2 m/s² stance and the 18 m/s updraft stay declared game thresholds.
- **Transitions.** No get-up grace was added: with the root fix the player wades to knee depth and sprints back out with no ragdoll frame, so nothing re-trips in calm water. In a real current he can be knocked down again after he stands, which is what a current does.
- **Budget.** One extra `acceleration` call for the player and one per NPC each frame, into reused scratch objects (no allocation). CPU only; no GPU work changes.
- **Evidence.** `test/player-flood.mjs` "Walking and sprinting through calm shallow sea..." (0.3 and 0.16 m walking, 0.06 and 0.4 m sprinting, 2 s of W each: mode stays walk, moves over 3 m) was red before the fix: the 0.3 m walk went walk, ragdoll at 4.03 m/s² of its own drag. "A 2 m/s current at 0.6 m still knocks the standing walker..." stays green. `test/disaster-people.mjs` "Calm-sea waders never tip..." was red (a 0.8 m wader at 1.4 m/s tipped) and the 2 m/s current case still tips. `test/browser/player-flood.spec.js` "Wading into the calm sea to knee depth and sprinting back out never trips the player" holds W from the beach to knee depth, then Shift and S back onto the sand; before the fix it logged 1164 ragdoll frames.

## Restore and repeated events

The disaster snapshot also saves water height/mean, floating and grounding state, fall history, wading state and the input-history command. Restore reinstates them and fences only the player's CPU query until two new result versions arrive. `WaterQuery` allows one pending readback, so this excludes a possible completion of the removed crest and then accepts a newly computed sample. Other query slots are unchanged. A fresh subsequent wave can trigger swimming again.

## Hire attendant placement

The hire stand intentionally has one solid collision envelope. The previous stool position was inside it: the real capsule resolver moved a standing body 1.07 m in one update and the resulting velocity caused a quiet-warning tumble. The stool and person are now 1.5 m inland of the stand center, on sampled sand with a clear inland capsule exit. The stand collision and disaster contacts are retained.

## Verification

`test/player-flood.mjs` runs the production player, director snapshot/restore and field with synthetic keyboard/GPU transport. It covers live head submersion, body continuity, low-wave hysteresis, calm surface/sprint/diving, passive current, relative-energy decay, co-moving fluid invariance, cross-current control bounds, wind, timestep refinement, invalid dt, the actual GLB articulated updraft handoff and stale-readback Restore/repeat. Only GPU buffer writes are isolated in the articulated model case.

`test/people-evacuation.mjs` includes actual hire collision-envelope support and exit coverage. `test/browser/player-flood.spec.js` uses the actual disaster controls in a fresh local browser context for flooding and repeated Restore, the attendant's calm warning, and the swimmer's tornado handoff. It replaces only the external Google Fonts stylesheet; observations of internal positions/mode/forces are read-only.

The legacy `test/life-player.mjs` fixture passes its baseline swimming checks but fails later at boat boarding: it expects immediate helm mode although the current product boards the deck, and its boat has no `model.colliders`. This separate unchanged fixture failure is not used as evidence for these changes.
