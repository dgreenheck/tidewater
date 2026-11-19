# Beach disaster response

The 26 people at the main beach interrupt their ordinary activities when a
disaster starts. The response runs independently of camera distance.

- **Tsunami:** swimmers head for shore, then people find a walkable approach
  to the signed green boardwalk. The shore-to-walking handoff waits until both
  feet and physical support meet the walking planner’s depth limit. They climb
  its physical treads and occupy
  separate positions on the real refuge platform.
- **Tornado:** people attempt a clear local direction away from the funnel.
- **Earthquake:** ordinary activities stop and people brace. The shared
  physical model can still destabilize or hit them.

Start a tsunami in **Disasters**, with its default 90-second warning, to watch
the evacuation. A short warning or damaged/flooded route can leave people
exposed. **Stop all disasters** stops the warning without returning people to
their old positions. **Restore island** restores their saved activity and
position, alongside the physical island, so the scenario can be repeated.

Other registered townsfolk receive warning messages; ferry passenger travel
is still owned by the ferry system. This module does not create a new village
population or implement ferry evacuation/boarding decisions.

## Physical movement and loads

`People` owns `EvacuationAI`; `Beach.step` yields its ordinary interpolated
movement to `EvacuationWalker`. The walker advances velocity and gravity, then
resolves the existing live capsule collision world. Route points never set
foot height. Destroyed colliders stop supporting feet immediately.

`Disasters.people` supplies `person.environmentAcceleration` in m/s² and reads
`person.evacuation.velocity` and `grounded`. The walker applies those loads
after motor steering. Ragdolls and physical falls remain owned by Contact /
Tumble / Ragdoll. Voluntary AI movement stops while a knock is active and
resumes from the actual recovered position.

The planner reads actual water heights and broken route sections. People stop
voluntary advance when the route ahead is unsafe; they receive no force or
collision exemption. Reaching the refuge means physical platform contact.
Overtopping or loss of support invalidates that state.

## Explicit game assumptions and bounds

- One A* job advances per frame, with at most 120 node expansions and a
  2,400-node cutoff. Cells are 2 m, segment collision samples at most 0.3 m
  apart, over a bounded main-beach approach area.
- The capsule radius is 0.27 m, height 1.7 m, maximum step 0.4 m, gravity
  9.81 m/s², and movement substep at most 1/30 s. A broadphase using 8 m cells
  retains live collider references and refreshes moving-record locations.
- Four behavior lanes and back-to-front refuge slots reduce queue deadlocks.
  These are not a validated crowd-pressure or evacuation-capacity model.
- Voluntary dry speed is 4.4–4.8 m/s, or 3.2 m/s for the elderly archetype.
  The wading target speed is limited using `v = sqrt(2*m*a/(rho*Cd*A*wet))`,
  with the shared seawater density 1025 kg/m³, Cd=1, adult mass 72 kg,
  projected area 0.7 m² and assumed voluntary acceleration budget 1.8 m/s².
  This is below the shared physical stance threshold of 3.2 m/s². The actual
  current can still exceed that support and trigger a fall.
- Swimming uses a simple upright shoulder-depth support rule and a voluntary
  cap of 0.8 m/s. Detailed strokes, breathing, exhaustion and fatalities are
  outside this model. The existing character animation library supplies
  walking, idle and crouch poses.
- Route hazard sensing runs twice per second, at roughly 3 m intervals plus
  broken structural records and the refuge. Current feet additionally sample
  actual local water each update. No alternate inland route is promised when
  the boardwalk is unusable.

These are bounded interactive game models, not scientific human flood-safety
or evacuation certification.

## Verification

`npm run test:simulation` includes `test/people-evacuation.mjs`. It exercises
actual stair collision, collective arrival, warning/reset, ragdoll handoff,
physical fluid drag, route damage, overtopping, swimmer shore transitions and
collision clearance for the real pier fishing slots. The Node fixture replaces
only the canvas rasterizer needed by route signs.

`npm run test:rally` discovers `test/browser/people-evacuation.spec.js`.
The maintained native Playwright Given/When/Then scenarios use the real local
product and actual Start/Restore/View controls. Browser contexts isolate game
state and only the external Google Fonts stylesheet is mocked. Read-only
observations check actual poses, support, route contacts, water, velocity,
current and displacement.

For a dedicated host:

```sh
PW_PORT=5226 PW_OUT=test-results/local npx playwright test test/browser/people-evacuation.spec.js --workers=1
```
