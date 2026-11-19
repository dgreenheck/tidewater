"""Build the Fulmine V10: an original mid-engine supercar at the proportions of a Lamborghini Huracan
EVO (2019): 4.520 m long, 1.933 m wide, 1.165 m tall, 2.620 m wheelbase, 1.668 / 1.620 m track,
245/30 R20 front and 305/30 R20 rear (docs/cars.md, Reference). No badges, no maker's shapes: the class
reads through its proportions (cab-forward, one arc from nose to tail over the glasshouse, low and
wide) and through faceted planes meeting at sharp creases; every line here is drawn for this car.

Built hard-surface (tools/rally/hard_surface.py): a 16-station control cage with creased character
lines (shoulder, rocker, door blade, intake edges, glasshouse), subdivided three times, octagonal
arches cut by boolean, weighted normals. The lofted first version read soft and inflated with a
slab box tail.

Physics twin: rally-physics/src/vehicle.rs supercar() (kind 2): tyre radius 0.336 m (the mean of the
staggered pair), mounts x 0.834 front and 0.81 rear, z 1.31 either side of the root, so the drawn
wheels stand where the simulated ones do.

Frame and contract: see tools/rally/hero_kit.py (Blender Z up, -Y nose; glTF Y up, +Z nose; root on
the ground between the axles; pivots WheelFrontL/R, WheelRearL/R on -X/+X).

Run:     blender --background --factory-startup \\
             --python tools/rally/build_fulmine_v10.py
Review:  add `-- --previews <dir>` for studio renders and a contact sheet (keep them out of git).
Writes:  public/rally/fulmine_v10.glb, assets/rally/fulmine_v10_report.json.
"""
from pathlib import Path
import math, sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_kit import palette, clear_scene, make_wheel, caliper, bucket_seat, steering_wheel, finish, review_renders
from hard_surface import Cage, Surface, finish_shell, ribbon, path, prism, GAP_WIDTH
from blender_primitives import cube, cylinder, line

FILE = "fulmine_v10"
MASS = 1550             # kg, with fluids and fuel (vehicle.rs supercar())
RADIUS = 0.336          # m, tyre radius (vehicle.rs)
WHEELBASE = 2.62        # m
AXLE_Y = WHEELBASE / 2  # m, either side of the root
TRACK_FRONT = 1.668     # m (vehicle.rs mounts x 0.834)
TRACK_REAR = 1.62       # m (vehicle.rs mounts x 0.81)
ARCH_RADIUS = 0.41      # m to the octagon's corners; its flat sides stand 0.379 m out, 4.3 cm off the tread
ARCH_INNER_X = 0.60     # m: the well's inner wall, inboard of the rear tyre's inner face (0.657 m)
PAINT = (0.80, 0.15, 0.012, 1)   # a deep orange, linear RGB
CLEARCOAT = (1.0, 0.04)          # full clear lacquer, nearly mirror smooth (factor, roughness)

FRONT_WHEEL = {"radius": RADIUS, "width": 0.245, "rim_radius": 0.254, "spokes": 10, "twin": False,
               "spoke_mat": "AlloyDark", "lip_mat": "BrightMetal"}   # 20 in forged rim = 0.254 m radius
REAR_WHEEL = dict(FRONT_WHEEL, width=0.305)

# Stations nose to tail: y (m, -Y is the nose) and the right half section j0..j9 as (x, z) m:
# j0 floor centre, j1 floor edge, j2 rocker crease, j3 waist (widest), j4 shoulder crease, j5 deck
# edge, j6 belt (bottom of the side glass), j7 top of the side glass, j8 roof edge, j9 crown.
# Ahead of the windscreen j6..j9 lie across the bonnet; behind the cabin across the engine cover.
# The crown is one arc: 0.42 m at the nose, 0.87 at the cowl, 1.165 over the seats, 0.785 at the tail.
# Aft of the rear axle the deck drops 3 cm at 1.75 m and 5 cm at the lip, then falls 5.5 cm to the tail:
# at 0.91 / 0.89 / 0.855 m the deck ran long and flat-topped.
# At the arches the bonnet stands 3 cm or more above the cutter's flat top (0.715 m) outboard of 0.60 m.
STATIONS = [
    (-2.31, [(0, 0.20), (0.50, 0.20), (0.58, 0.23), (0.62, 0.30), (0.60, 0.37), (0.55, 0.40), (0.42, 0.41), (0.30, 0.415), (0.18, 0.418), (0, 0.42)]),
    (-2.26, [(0, 0.15), (0.66, 0.15), (0.76, 0.19), (0.82, 0.30), (0.80, 0.42), (0.74, 0.47), (0.56, 0.49), (0.40, 0.495), (0.22, 0.498), (0, 0.50)]),
    (-2.10, [(0, 0.13), (0.78, 0.13), (0.88, 0.17), (0.92, 0.33), (0.90, 0.52), (0.84, 0.58), (0.62, 0.575), (0.44, 0.58), (0.24, 0.583), (0, 0.585)]),
    (-1.80, [(0, 0.12), (0.82, 0.12), (0.90, 0.16), (0.955, 0.38), (0.94, 0.62), (0.87, 0.69), (0.66, 0.665), (0.46, 0.66), (0.26, 0.66), (0, 0.66)]),
    (-1.31, [(0, 0.11), (0.84, 0.11), (0.90, 0.16), (0.966, 0.40), (0.95, 0.70), (0.88, 0.80), (0.68, 0.765), (0.48, 0.75), (0.28, 0.745), (0, 0.745)]),
    # the waist crease (j3) climbs from the front arch to the door blade, then dives into the intake
    (-0.95, [(0, 0.11), (0.84, 0.11), (0.89, 0.16), (0.955, 0.40), (0.94, 0.68), (0.88, 0.77), (0.78, 0.82), (0.66, 0.85), (0.62, 0.86), (0, 0.87)]),
    (-0.55, [(0, 0.11), (0.84, 0.11), (0.89, 0.17), (0.95, 0.44), (0.935, 0.66), (0.87, 0.75), (0.80, 0.85), (0.64, 0.985), (0.60, 1.00), (0, 1.02)]),
    (-0.20, [(0, 0.11), (0.84, 0.11), (0.89, 0.17), (0.945, 0.48), (0.93, 0.66), (0.86, 0.75), (0.80, 0.86), (0.59, 1.10), (0.56, 1.12), (0, 1.145)]),
    (0.15, [(0, 0.11), (0.84, 0.11), (0.89, 0.17), (0.945, 0.52), (0.93, 0.66), (0.865, 0.76), (0.81, 0.87), (0.58, 1.12), (0.55, 1.14), (0, 1.165)]),
    (0.48, [(0, 0.11), (0.84, 0.11), (0.89, 0.17), (0.945, 0.56), (0.93, 0.67), (0.88, 0.77), (0.81, 0.89), (0.58, 1.07), (0.55, 1.09), (0, 1.11)]),
    # the side intake: a scoop 20 cm deep under the haunch, which flares back out to 0.94 m
    (0.72, [(0, 0.11), (0.82, 0.11), (0.88, 0.16), (0.74, 0.36), (0.76, 0.68), (0.90, 0.79), (0.78, 0.90), (0.60, 1.00), (0.46, 1.03), (0, 1.05)]),
    (0.92, [(0, 0.11), (0.84, 0.11), (0.93, 0.16), (0.92, 0.40), (0.95, 0.67), (0.94, 0.80), (0.76, 0.91), (0.58, 0.97), (0.44, 0.99), (0, 1.00)]),
    (1.31, [(0, 0.12), (0.84, 0.12), (0.93, 0.17), (0.966, 0.46), (0.966, 0.69), (0.93, 0.82), (0.72, 0.90), (0.56, 0.925), (0.40, 0.94), (0, 0.945)]),
    (1.75, [(0, 0.15), (0.82, 0.15), (0.92, 0.21), (0.955, 0.48), (0.955, 0.70), (0.91, 0.81), (0.70, 0.845), (0.54, 0.865), (0.38, 0.875), (0, 0.88)]),
    (2.10, [(0, 0.26), (0.78, 0.26), (0.88, 0.30), (0.925, 0.50), (0.925, 0.71), (0.89, 0.80), (0.68, 0.82), (0.52, 0.83), (0.36, 0.835), (0, 0.84)]),
    (2.21, [(0, 0.30), (0.72, 0.30), (0.80, 0.32), (0.86, 0.50), (0.86, 0.70), (0.84, 0.76), (0.66, 0.775), (0.50, 0.78), (0.34, 0.782), (0, 0.785)]),
]
NOSE_Y, TAIL_Y = STATIONS[0][0], STATIONS[-1][0]
LAST = len(STATIONS) - 1

# Station intervals (index of the station ahead) that carry each panel.
FRONT_BUMPER = 0          # nose face: the lower corners are open intakes
HEADLAMP = 1              # the lamp housings sit at the nose corners on the deck edge
WINDSCREEN = (5, 6)       # cowl at -0.95 m to the roof front at -0.20 m
SIDE_GLASS = (5, 6, 7, 8) # -0.95 to 0.48 m: one window from the windscreen pillar to the door blade
ROOF = (7, 8)
REAR_GLASS = 9            # the engine bay window behind the cabin
SIDE_INTAKE = (9, 10)     # door blade at 0.48 m to the rear arch
ENGINE_COVER = (10, 11, 12)
TAIL_LOWER = (13, 14)     # the rear bumper's lower quarter is black, so the haunch is no orange slab
DOOR = (-0.86, 0.46)      # y of the door's front and rear shut lines (the rear one is the intake's lip)


def material_at(i, band):
    """Palette material of cage interval i, band b (hard_surface.py); band None is an end cap."""
    if band is None:
        # Painted tail too: a Graphite tail cap read as one big black panel; the black
        # is now the diffuser panel below the lamps (build_aero).
        return "BodyPaint"
    if band <= 1:
        return "Graphite"                           # undertray and carbon skirts: no paint at the tyre base
    if band == 2:
        return "Graphite" if i == FRONT_BUMPER or i in TAIL_LOWER else "BodyPaint"
    if band in (3, 4) and i in SIDE_INTAKE:
        return "Graphite"
    if band == 3 and i == FRONT_BUMPER:
        return "Graphite"
    if band in (4, 5) and i == HEADLAMP:
        return "Graphite"
    if band == 6 and i in SIDE_GLASS:
        return "Glass"
    if band == 7 and i in SIDE_GLASS:
        return "Graphite"                           # gloss black pillar and roof rail around the glass
    if band == 8:
        if i in WINDSCREEN or i == REAR_GLASS:
            return "Glass"
        if i in ENGINE_COVER:
            return "Graphite"
    return "BodyPaint"


def build_root():
    root = bpy.data.objects.new("FulmineV10", None)
    bpy.context.collection.objects.link(root)
    root["wheel_radius_m"] = RADIUS
    root["wheelbase_m"] = WHEELBASE
    root["mass_kg"] = MASS
    root["description"] = "Fulmine V10: mid-engine supercar, all-wheel drive"
    return root


def build_shell():
    """The creased cage, subdivided and cut; returns the paint shell and a Surface to lay parts on."""
    palette("BodyPaint", PAINT, CLEARCOAT)
    cage = Cage(STATIONS, material_at)
    cage.crease_line(2)                    # rocker: the skirt meets the flank
    cage.crease_line(3)                    # waist: the flank's lower line, rising into the intake
    cage.crease_line(4)                    # shoulder: the one line along the whole car
    cage.crease_line(5, value=0.7)         # deck edge: firm, not knife-sharp
    cage.crease_line(8)                    # roof edge and the bonnet's inner line
    cage.crease_ring(0)                    # nose leading edge
    cage.crease_ring(1, 4, 9)              # bonnet front edge above the lamps
    cage.crease_ring(LAST - 1, 4, 9, 0.8)  # ducktail lip
    cage.crease_ring(LAST)                 # tail panel edge
    cage.crease_ring(9, 2, 6)              # door blade: the intake's leading edge
    arches = [(-AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X), (AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X)]
    shell = cage.build("Body shell", arches)
    surface = Surface(shell)               # before the glass is split off: the wiper lies on it
    finish_shell(shell)
    return surface


def build_lamps(surface):
    """Y-shaped lamp signatures front and rear. Headlamp and TailLamp are the names CarLights drives."""
    head, tail, amber = palette("Headlamp"), palette("TailLamp"), palette("Indicator")
    for side in (1, -1):
        hub = (side * 0.70, -2.17)
        for end in ((side * 0.60, -2.20), (side * 0.80, -2.22), (side * 0.77, -2.12)):
            ribbon("Daytime running Y", path(surface.from_above, hub, end, 8), 0.016, head)
        ribbon("Headlamp lens", path(surface.from_above, (side * 0.58, -2.13), (side * 0.66, -2.115), 6), 0.03, head)
        ribbon("Front indicator", path(surface.from_above, (side * 0.80, -2.18), (side * 0.84, -2.16), 4), 0.014, amber)
        # 4 cm wide: 2.2 cm Y ribbons barely read in daylight at rest. Kept 3 cm or more
        # inside the lowered tail's edge (0.76 m at x 0.84) so the strip does not overhang the cap.
        hub = (side * 0.72, 0.70)
        for end in ((side * 0.58, 0.70), (side * 0.79, 0.73), (side * 0.80, 0.65)):
            ribbon("Rear lamp Y", path(surface.from_behind, hub, end, 6), 0.04, tail)
        ribbon("Rear indicator", path(surface.from_behind, (side * 0.44, 0.665), (side * 0.56, 0.665), 4), 0.02, amber)
    ribbon("Rear lamp bar", path(surface.from_behind, (-0.58, 0.70), (0.58, 0.70), 12), 0.02, tail)


def build_shut_lines(surface):
    gap = palette("Rubber")
    for side in (1, -1):
        def flank(y, z, side=side):
            return surface.from_side(y, z, side)
        for y in DOOR:
            ribbon("Door shut line", path(flank, (y, 0.20), (y, 0.80), 14), GAP_WIDTH, gap)
        ribbon("Door sill line", path(flank, (DOOR[0], 0.20), (DOOR[1], 0.20), 16), GAP_WIDTH, gap)
        ribbon("Luggage lid side line", path(surface.from_above, (side * 0.56, -2.06), (side * 0.56, -1.00), 16), GAP_WIDTH, gap)
    ribbon("Luggage lid line", path(surface.from_above, (-0.56, -1.00), (0.56, -1.00), 12), GAP_WIDTH, gap)
    ribbon("Luggage lid front line", path(surface.from_above, (-0.56, -2.06), (0.56, -2.06), 12), GAP_WIDTH, gap)


def build_aero(surface):
    """Splitter with angular inlets, intake blades, diffuser strakes, hexagonal exhausts and the
    slatted engine cover."""
    graphite, dark, bright = palette("Graphite"), palette("AlloyDark"), palette("BrightMetal")
    # inside the nose's plan: corners at 0.90 m stood 10 cm out of the tapering nose (v11 render)
    prism("Front splitter", [(-0.55, -2.34), (0.55, -2.34), (0.76, -2.25), (0.84, -2.08), (-0.84, -2.08), (-0.76, -2.25)],
          0.085, 0.105, graphite)
    for side in (1, -1):
        blade = cube("Intake blade", (side * 0.45, NOSE_Y + 0.025, 0.24), (0.40, 0.03, 0.014), dark, 0.004)
        blade.rotation_euler.y = side * 0.32         # angled up and out: the inlets read as arrows
        for k in range(3):                         # fins across the side intake, inside its mouth
            p, n = surface.from_side(0.62 + k * 0.10, 0.52, side)
            fin = cube("Side intake fin", tuple(p - n * 0.03), (0.06, 0.012, 0.22), dark, 0.003)
            fin.rotation_euler.z = side * 0.5
    for k in range(5):   # short: 16 cm strakes hung below the floor like a comb (v11 render)
        cube("Diffuser strake", (-0.50 + k * 0.25, 2.06, 0.25), (0.012, 0.32, 0.09), graphite, 0.003)
    # The black zone of the tail: a diffuser panel 21 cm tall under the plate, carrying the exhausts;
    # at the bottom it meets the rocker corner (0.80 m, 0.32 m), so it stays inside the tail outline.
    cube("Rear diffuser panel", (0, TAIL_Y + 0.012, 0.415), (1.60, 0.02, 0.21), graphite, 0.004)
    for side in (1, -1):
        cylinder("Exhaust tip", (side * 0.17, TAIL_Y + 0.025, 0.44), 0.075, 0.07, bright, axis="Y", segments=6)
        cylinder("Exhaust bore", (side * 0.17, TAIL_Y + 0.026, 0.44), 0.062, 0.074, graphite, axis="Y", segments=6)
    for k in range(8):                             # slats across the engine cover, 0.12 m apart
        y = 0.80 + k * 0.12
        top = surface.from_above(0, y)[0]
        ahead, behind = surface.from_above(0, y - 0.05)[0], surface.from_above(0, y + 0.05)[0]
        slat = cube("Engine cover slat", (0, y, top.z + 0.004), (0.74, 0.04, 0.010), dark, 0.003)
        slat.rotation_euler.x = math.atan2(behind.z - ahead.z, 0.10)


def build_mirrors(surface):
    """Slim mirrors on stalks from the door top, glass facing back."""
    paint, graphite, bright = palette("BodyPaint"), palette("Graphite"), palette("BrightMetal")
    for side in (1, -1):
        base = surface.from_side(-0.66, 0.80, side)[0]
        housing = (base.x + side * 0.12, base.y - 0.02, base.z + 0.07)   # 0.17 m out read as antennae
        line("Mirror stalk", [tuple(base), (housing[0] - side * 0.05, housing[1] + 0.01, housing[2] - 0.01)], 0.010, graphite)
        body = cube("Mirror housing", housing, (0.15, 0.06, 0.045), paint, 0.016)
        body.rotation_euler.z = side * 0.08
        cube("Mirror glass", (housing[0], housing[1] + 0.031, housing[2]), (0.13, 0.004, 0.034), bright, 0.002)
    base, tip = surface.from_above(0.10, -0.90)[0], surface.from_above(0.55, -0.80)[0]
    line("Wiper arm", [tuple(base), tuple(tip)], 0.006, graphite)


def build_cabin():
    """What shows through the glass: tub floor, dash and binnacle, console, two buckets, a wheel on the
    right (Tidewater drives on the left, so right-hand drive; the car's right is -X), door cards, the
    headliner and the bulkhead behind the seats, so no inside face of the paint shows."""
    trim, seat = palette("Interior"), palette("SeatFabric")
    cube("Cabin floor", (0, -0.20, 0.17), (1.50, 1.70, 0.04), trim, 0.01, "InteriorAssembly")
    dash = cube("Dashboard", (0, -0.78, 0.68), (1.50, 0.40, 0.14), trim, 0.04, "InteriorAssembly")
    dash.rotation_euler.x = 0.15
    cube("Instrument binnacle", (-0.37, -0.62, 0.78), (0.32, 0.14, 0.08), trim, 0.03, "InteriorAssembly")
    cube("Centre console", (0, -0.25, 0.32), (0.24, 1.05, 0.22), trim, 0.03, "InteriorAssembly")
    for x in (-0.37, 0.37):
        bucket_seat(x, 0.02, 0.18, seat)
    steering_wheel(-0.37, -0.50, 0.74, 0.35, trim, palette("Graphite"))
    for side in (1, -1):
        # inboard of the shell: at x 0.84 its top stood out through the belt as a dark strip (v11 render)
        cube("Door card", (side * 0.76, -0.20, 0.50), (0.03, 1.30, 0.56), trim, 0.01, "InteriorAssembly")
    cube("Headliner", (0, 0.12, 1.10), (1.04, 0.62, 0.02), trim, 0.01, "InteriorAssembly")
    cube("Rear bulkhead", (0, 0.52, 0.62), (1.50, 0.06, 0.56), trim, 0.01, "InteriorAssembly")
    cube("Engine", (0, 0.95, 0.62), (0.80, 0.70, 0.36), palette("Graphite"), 0.03, "InteriorAssembly")


def wheel_centres():
    return {"WheelFrontL": (-1, (-TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelFrontR": (1, (TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelRearL": (-1, (-TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1),
            "WheelRearR": (1, (TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1)}


def build_wheels(root):
    for name, (side, centre, spec, trailing) in wheel_centres().items():
        make_wheel(root, name, side, centre, spec)
        caliper(side, centre, spec, trailing)


def main():
    clear_scene()
    root = build_root()
    surface = build_shell()
    build_lamps(surface)
    build_shut_lines(surface)
    build_aero(surface)
    build_mirrors(surface)
    build_cabin()
    build_wheels(root)
    # [x, y, z, yaw] in glTF car space for src/rally/VehicleModel.js PLATES (glTF z = -Blender y).
    rear_plate = surface.from_behind(0, 0.60)[0]
    front_plate = surface.from_front(0, 0.26)[0]
    plates = [[0.0, 0.60, round(-(rear_plate.y + 0.008), 3), math.pi],
              [0.0, 0.26, round(-(front_plate.y - 0.006), 3), 0]]
    finish(root, FILE, RADIUS, WHEELBASE, (TRACK_FRONT + TRACK_REAR) / 2, plates,
           {"length_m": round(TAIL_Y - NOSE_Y, 3), "mass_kg": MASS})
    review_renders(FILE, [("front34", (4.4, -5.8, 1.9), 50), ("rear34", (-4.6, 5.6, 2.1), 50),
                          ("side", (30.0, 0.0, 0.6), 200), ("top", (0.0, 0.0, 30.0), 110),
                          ("front", (0.0, -30.0, 0.6), 300), ("cabin", (1.3, -2.4, 3.2), 40)])


main()
