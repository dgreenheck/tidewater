"""Build the Sandpiper: an original fibreglass beach buggy at the proportions of a Meyers Manx (1964):
about 3.3 m long over the body, 1.6 m over the rear fenders, 2.03 m wheelbase (a shortened
flat-four floor pan), an open tub with no doors, a short windscreen, a roll hoop, the air-cooled
flat four exposed behind the rear axle, chrome nerf bars, and balloon tyres, wider at the back
(docs/cars.md, Reference). No badges, no maker's shapes: every line here is drawn for this car.

Built hard-surface (tools/rally/hard_surface.py), as the Fulmine and the Corsaire are, but soft: a
buggy is a moulded tub, so only the tub's rim and the material edges are creased. The tub is open by
shape, not by missing faces: in the cockpit stations the top of the section drops into a well (j6 the
rim's outer edge, j7 its inner edge, j8 the foot of the inner wall, j9 the floor), so the shell stays a
closed solid and the exact boolean still cuts the arches with liners. The engine bay behind the seats is
a second well between the rear fenders.

Physics twin: rally-physics/src/vehicle.rs buggy() (kind 5): tyre radius 0.345 m, mounts x 0.655 front
and 0.675 rear, z 1.016 either side of the root, so the drawn wheels stand where the simulated ones do.

Frame and contract: see tools/rally/hero_kit.py (Blender Z up, -Y nose; glTF Y up, +Z nose; root on
the ground between the axles; pivots WheelFrontL/R, WheelRearL/R on -X/+X).

Run:     blender --background --factory-startup \\
             --python tools/rally/build_sandpiper.py
Review:  add `-- --previews <dir>` for studio renders and a contact sheet (keep them out of git).
Writes:  public/rally/sandpiper.glb, assets/rally/sandpiper_report.json.
"""
from pathlib import Path
import math, sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_kit import palette, clear_scene, make_wheel, caliper, bucket_seat, steering_wheel, finish, review_renders
from hard_surface import Cage, Surface, finish_shell
from blender_primitives import cube, cylinder, line

FILE = "sandpiper"
MASS = 620              # kg, with fluids and fuel (vehicle.rs buggy())
RADIUS = 0.345          # m, tyre radius (vehicle.rs)
WHEELBASE = 2.032       # m (vehicle.rs mounts z 1.016)
AXLE_Y = WHEELBASE / 2  # m, either side of the root
TRACK_FRONT = 1.31      # m (vehicle.rs mounts x 0.655)
TRACK_REAR = 1.35       # m (vehicle.rs mounts x 0.675)
ARCH_RADIUS = 0.4378    # m to the 24-gon's corners; flats 0.434 m out (as the octagon's were), 9 cm off the tread for 25 cm of travel
ARCH_SIDES = 24         # round arches on a round-fendered tub (the shared octagon read angular; 16 sides still showed 17 cm facets)
ARCH_INNER_X = 0.48     # m: inboard of both tyres' inner faces (0.555 front, 0.545 rear)
PAINT = (0.50, 0.60, 0.02, 1)    # a chartreuse gelcoat, linear RGB
CLEARCOAT = (1.0, 0.10)          # gelcoat: glossy, a little softer than a lacquered supercar

FRONT_WHEEL = {"radius": RADIUS, "width": 0.20, "rim_radius": 0.19, "spokes": 8, "twin": False,
               "spoke_mat": "BrightMetal", "lip_mat": "BrightMetal"}   # 15 in rim: a 15.5 cm balloon sidewall
REAR_WHEEL = dict(FRONT_WHEEL, width=0.26)

# Stations nose to tail: y (m, -Y is the nose) and the right half section j0..j9 as (x, z) m. Outside
# the wells j3 is the waist, j5 the top of the fender hump, j6 the valley between fender and bonnet or
# deck, j9 the crown. The fenders stand 0.81 m or more outboard of 0.48 m over the arches (cutter flat
# top 0.779 m). The well's inner walls stay inboard of 0.48 m, so the arch cutters never open them.
STATIONS = [
    (-1.62, [(0, 0.40), (0.40, 0.40), (0.48, 0.43), (0.52, 0.50), (0.50, 0.56), (0.45, 0.59), (0.34, 0.61), (0.24, 0.62), (0.12, 0.625), (0, 0.63)]),
    (-1.52, [(0, 0.34), (0.55, 0.34), (0.64, 0.38), (0.69, 0.50), (0.68, 0.62), (0.62, 0.68), (0.46, 0.70), (0.32, 0.70), (0.16, 0.705), (0, 0.71)]),
    (-1.30, [(0, 0.32), (0.58, 0.32), (0.70, 0.36), (0.77, 0.52), (0.78, 0.76), (0.72, 0.88), (0.50, 0.84), (0.36, 0.79), (0.18, 0.78), (0, 0.78)]),
    (-1.016, [(0, 0.30), (0.60, 0.30), (0.72, 0.34), (0.79, 0.52), (0.79, 0.78), (0.73, 0.91), (0.50, 0.86), (0.36, 0.81), (0.18, 0.80), (0, 0.80)]),
    (-0.70, [(0, 0.30), (0.60, 0.30), (0.70, 0.34), (0.77, 0.50), (0.77, 0.74), (0.71, 0.85), (0.50, 0.84), (0.36, 0.82), (0.18, 0.815), (0, 0.815)]),
    (-0.50, [(0, 0.30), (0.58, 0.30), (0.66, 0.34), (0.70, 0.48), (0.69, 0.66), (0.65, 0.74), (0.56, 0.80), (0.40, 0.82), (0.20, 0.825), (0, 0.83)]),
    # the cockpit well: rim 0.71 to 0.76 m, floor 0.38 to 0.40 m
    (-0.40, [(0, 0.30), (0.58, 0.30), (0.66, 0.34), (0.69, 0.48), (0.68, 0.62), (0.64, 0.70), (0.60, 0.74), (0.55, 0.74), (0.50, 0.42), (0, 0.40)]),
    (0.00, [(0, 0.30), (0.58, 0.30), (0.66, 0.34), (0.68, 0.46), (0.67, 0.60), (0.63, 0.68), (0.60, 0.71), (0.55, 0.71), (0.50, 0.40), (0, 0.38)]),
    (0.45, [(0, 0.30), (0.58, 0.30), (0.66, 0.34), (0.70, 0.48), (0.70, 0.64), (0.66, 0.72), (0.62, 0.76), (0.57, 0.76), (0.52, 0.42), (0, 0.40)]),
    (0.58, [(0, 0.30), (0.60, 0.30), (0.70, 0.34), (0.76, 0.50), (0.77, 0.72), (0.72, 0.83), (0.52, 0.85), (0.40, 0.84), (0.20, 0.835), (0, 0.835)]),
    # the engine bay well between the rear fenders: floor 0.48 m, inner walls at 0.42 to 0.46 m
    (0.75, [(0, 0.30), (0.60, 0.30), (0.72, 0.34), (0.80, 0.50), (0.81, 0.74), (0.76, 0.88), (0.54, 0.86), (0.46, 0.84), (0.42, 0.50), (0, 0.48)]),
    (1.016, [(0, 0.32), (0.62, 0.32), (0.76, 0.36), (0.80, 0.52), (0.80, 0.78), (0.76, 0.93), (0.56, 0.88), (0.46, 0.86), (0.42, 0.50), (0, 0.48)]),
    (1.35, [(0, 0.34), (0.60, 0.34), (0.74, 0.40), (0.79, 0.52), (0.79, 0.76), (0.74, 0.87), (0.56, 0.84), (0.46, 0.82), (0.42, 0.50), (0, 0.48)]),
    # The tail is a low convex valance, so the flat four shows above it from behind. A U-shaped tail cap
    # (the bay's section) subdivides from its vertex mean, which falls in the notch, and the cap folds
    # across the bay. The fenders fall to it aft of the cutter's back diagonal (0.625 m at y 1.35).
    (1.52, [(0, 0.30), (0.56, 0.30), (0.70, 0.40), (0.74, 0.48), (0.72, 0.54), (0.66, 0.56), (0.56, 0.56), (0.46, 0.555), (0.30, 0.55), (0, 0.55)]),
]
NOSE_Y, TAIL_Y = STATIONS[0][0], STATIONS[-1][0]
LAST = len(STATIONS) - 1
DASH = 5                  # the cockpit's front wall
COCKPIT = (6, 7)          # the well floor
FIREWALL = 9              # the wall behind the seats down into the engine bay
ENGINE_BAY = (10, 11, 12)


def material_at(i, band):
    """Palette material of cage interval i, band b (hard_surface.py); band None is an end cap."""
    if band is None:
        return "BodyPaint"
    if band <= 1:
        return "Graphite"                    # the floor pan and the sills under the tub
    if band in (7, 8) and i == DASH or band == 8 and i in COCKPIT:
        return "Interior"                    # the dash face and the rubber floor mat
    if band in (7, 8) and i == FIREWALL or band == 8 and i in ENGINE_BAY:
        return "Graphite"                    # the firewall and the engine bay floor
    return "BodyPaint"


def build_root():
    root = bpy.data.objects.new("Sandpiper", None)
    bpy.context.collection.objects.link(root)
    root["wheel_radius_m"] = RADIUS
    root["wheelbase_m"] = WHEELBASE
    root["mass_kg"] = MASS
    root["description"] = "Sandpiper: fibreglass beach buggy, air-cooled flat four, rear drive"
    return root


def build_shell():
    palette("BodyPaint", PAINT, CLEARCOAT)
    cage = Cage(STATIONS, material_at)
    cage.crease_line(2, value=0.6)         # the tub's lower edge over the pan
    cage.crease_line(6, 5, 9, 0.9)         # the cockpit rim, outer edge
    cage.crease_line(7, 5, 9, 0.9)         # the cockpit rim, inner edge
    cage.crease_line(6, 9, LAST, 0.9)      # the engine bay rim, outer edge
    cage.crease_line(7, 9, LAST, 0.9)      # the engine bay rim, inner edge
    cage.crease_ring(0, 0, 9, 0.6)         # the nose's edge
    cage.crease_ring(LAST)                 # the tail's edge
    arches = [(-AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X), (AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X)]
    shell = cage.build("Body shell", arches, arch_sides=ARCH_SIDES)
    surface = Surface(shell)
    finish_shell(shell)
    return surface


def build_fittings(surface):
    """Round lamps on the bonnet, tail lamps on the fenders, windscreen, roll hoop, nerf bars, mirrors."""
    bright, graphite = palette("BrightMetal"), palette("Graphite")
    head, tail, amber, glass = palette("Headlamp"), palette("TailLamp"), palette("Indicator"), palette("Glass")
    for side in (1, -1):
        top = surface.from_above(side * 0.40, -1.32)[0]
        cylinder("Headlamp bucket", (side * 0.40, -1.36, top.z + 0.07), 0.085, 0.12, bright, axis="Y", segments=24)
        cylinder("Headlamp", (side * 0.40, -1.425, top.z + 0.07), 0.072, 0.012, head, axis="Y", segments=24)
        cylinder("Tail lamp", (side * 0.60, TAIL_Y + 0.015, 0.46), 0.045, 0.03, tail, axis="Y", segments=16)
        cylinder("Rear indicator", (side * 0.48, TAIL_Y + 0.015, 0.46), 0.024, 0.03, amber, axis="Y", segments=12)
        cylinder("Front indicator", (side * 0.58, NOSE_Y + 0.07, 0.56), 0.024, 0.03, amber, axis="Y", segments=12)
        # back stays from the hoop's shoulders to the engine bay rim
        line("Hoop stay", [(side * 0.45, 0.50, 1.20), (side * 0.47, 0.98, 0.87)], 0.016, bright)
        line("Mirror stalk", [(side * 0.53, -0.44, 1.06), (side * 0.64, -0.46, 1.10)], 0.008, graphite)
        cylinder("Mirror", (side * 0.68, -0.46, 1.10), 0.05, 0.02, bright, axis="Y", segments=16)
    # A short flat screen raked back 20 deg from the cowl, in its frame.
    screen = cube("Windscreen", (0, -0.40, 0.97), (1.04, 0.010, 0.28), glass, 0.004, "GlassPanels")
    screen.rotation_euler.x = -0.35
    line("Windscreen frame", [(-0.53, -0.46, 0.82), (-0.53, -0.35, 1.13), (0.53, -0.35, 1.13), (0.53, -0.46, 0.82)], 0.012, bright)
    line("Roll hoop", [(-0.52, 0.50, 0.74), (-0.50, 0.50, 1.18), (-0.40, 0.50, 1.28), (0.40, 0.50, 1.28),
                       (0.50, 0.50, 1.18), (0.52, 0.50, 0.74)], 0.022, bright)
    line("Front nerf bar", [(-0.46, -1.56, 0.38), (-0.46, -1.70, 0.38), (0.46, -1.70, 0.38), (0.46, -1.56, 0.38)], 0.020, bright)
    line("Rear nerf bar", [(-0.55, 1.48, 0.30), (-0.55, 1.82, 0.30), (0.55, 1.82, 0.30), (0.55, 1.48, 0.30)], 0.020, bright)


def build_engine():
    """The air-cooled flat four in the open bay: case, four finned barrels, heads, fan shroud and its
    round housing, a chrome air cleaner, the transaxle ahead and twin pipes out the back."""
    alloy, graphite, bright = palette("AlloyDark"), palette("Graphite"), palette("BrightMetal")
    cube("Transaxle", (0, 0.86, 0.56), (0.30, 0.26, 0.18), graphite, 0.03)
    cube("Engine case", (0, 1.18, 0.62), (0.34, 0.40, 0.22), alloy, 0.03)
    for side in (1, -1):
        for k in range(2):
            cylinder("Cylinder barrel", (side * 0.26, 1.09 + 0.18 * k, 0.62), 0.065, 0.15, alloy, axis="X", segments=16)
            for f in range(4):                     # cooling fins
                cylinder("Barrel fin", (side * (0.21 + f * 0.033), 1.09 + 0.18 * k, 0.62), 0.078, 0.008, alloy, axis="X", segments=16)
        cube("Cylinder head", (side * 0.37, 1.18, 0.62), (0.08, 0.38, 0.15), graphite, 0.015)
        line("Exhaust pipe", [(side * 0.30, 1.30, 0.58), (side * 0.22, 1.48, 0.60), (side * 0.20, 1.76, 0.60)], 0.022, bright)
    cube("Fan shroud", (0, 1.16, 0.81), (0.46, 0.34, 0.16), graphite, 0.04)
    cylinder("Fan housing", (0, 1.34, 0.82), 0.11, 0.06, bright, axis="Y", segments=24)
    cylinder("Carburettor", (0, 1.10, 0.92), 0.03, 0.08, graphite, axis="Z", segments=12)
    cylinder("Air cleaner", (0, 1.10, 0.98), 0.11, 0.07, bright, axis="Z", segments=24)


def build_cabin():
    """Two low buckets on the tub floor, a wheel on the right (the car's right is -X), a gear lever."""
    trim, seat = palette("Interior"), palette("SeatFabric")
    for x in (-0.28, 0.28):
        bucket_seat(x, 0.12, 0.40, seat)
    steering_wheel(-0.28, -0.22, 0.86, 0.45, trim, palette("Graphite"))
    line("Gear lever", [(0, -0.05, 0.40), (0, -0.02, 0.62)], 0.010, palette("BrightMetal"), "InteriorAssembly")


def wheel_centres():
    return {"WheelFrontL": (-1, (-TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelFrontR": (1, (TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelRearL": (-1, (-TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1),
            "WheelRearR": (1, (TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1)}


def main():
    clear_scene()
    root = build_root()
    surface = build_shell()
    build_fittings(surface)
    build_engine()
    build_cabin()
    for name, (side, centre, spec, trailing) in wheel_centres().items():
        make_wheel(root, name, side, centre, spec)
        caliper(side, centre, spec, trailing)
    # [x, y, z, yaw] in glTF car space for src/rally/VehicleModel.js PLATES (glTF z = -Blender y).
    rear_plate = surface.from_behind(0, 0.40)[0]
    front_plate = surface.from_front(0, 0.50)[0]
    plates = [[0.0, 0.40, round(-(rear_plate.y + 0.008), 3), math.pi],
              [0.0, 0.50, round(-(front_plate.y - 0.006), 3), 0]]
    finish(root, FILE, RADIUS, WHEELBASE, (TRACK_FRONT + TRACK_REAR) / 2, plates,
           {"length_m": round(TAIL_Y - NOSE_Y, 3), "mass_kg": MASS})
    review_renders(FILE, [("front34", (3.6, -4.6, 2.0), 50), ("rear34", (-3.8, 4.6, 2.2), 50),
                          ("side", (30.0, 0.0, 0.7), 200), ("top", (0.0, 0.0, 30.0), 110),
                          ("front", (0.0, -30.0, 0.7), 300), ("cabin", (1.2, -1.8, 2.8), 40)])


main()
