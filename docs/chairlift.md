# Summit chairlift

The Chairlift world control connects the western village edge to the summit
landing and hang-glider launch. **Guide to village base** turns the walking view
along the approach; hold W to walk there. On a boarding platform, **Call a chair**,
wait beside the boarding mark, then **Board chair**. The occupied chair stops at
the other terminal automatically. **E** exits only at a stopped, dry, intact
terminal. Summit guides lead along the guarded connector to the launch or back
to the upper terminal.

While riding, **Space** stops or resumes the drive, **C** changes between the seat
and chase views, and the mouse looks around. Cable speed is adjustable from
0.5 to 5 m/s. Other activity controls cannot detach an occupied rider. Repeated
calls retain an already stopped chair, including while its swing settles.
**Reset empty lift** is available after exiting; **Restore island** restores the
captured transport and occupancy state together with damaged supports.

Seats follow cable arc length and swing as pendulums under gravity, drive
acceleration and the shared wind. The seated avatar is attached by its posed
pelvis; the default eye follows its actual posed head. Towers, foundations,
terminal platforms, rails and the guarded summit connector have traversal
geometry. Grass scattering respects the reserved platform floors.

This is a reduced transport model. Cable sag is prescribed; the drive and
terminal brakes are idealized. Support damage or terminal flooding stops
service, but the prescribed cable continues to restrain the seats. There is no
elastic cable, derailment, cable-break or native seat-collision simulation.

Verification lives in `test/chairlift*.mjs`, `test/grass-clearance.mjs` and
`test/browser/chairlift.spec.js`. The maintained real-control browser journeys
cover the supported approach, both camera modes, occupied pause/Restore,
activity ownership, portrait controls, complete ascent, summit connector,
return boarding, descent and grounded exit. Geometry checks include actual
posed avatar clearance and head/torso camera rays. Run CPU checks with
`node --test test/chairlift*.mjs test/grass-clearance.mjs`; the normal Playwright
runner discovers both chairlift journeys.

## Haul rope rendering

The haul rope is a 0.034 m, 6-sided tube in the village hard material's rope branch (vdata.w = 2 + radius),
drawn with the wire variant (`hardWire` in the village material set): its drawn radius is held at 0.75
render px or more with a coverage dither, so past ~75 m (2560x1267) it reads as a faint continuous line
instead of dots. Before the baseline it never drew at all (its material key, 'rope', is a GeoBuilder batch, not
a village material). It casts no shadow: under the 0.53 deg sun a 0.034 m rope's umbra is 3.7 m long and
the rope runs 4-9 m up, and the cascade texels drew it as a hard dashed line. See
`docs/render-performance.md`, "Thin geometry held at a pixel".
