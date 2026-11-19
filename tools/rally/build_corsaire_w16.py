"""Build the Corsaire W16: an original mid-engine hypercar at the proportions of a Bugatti Chiron
(2016): 4.544 m long, 2.038 m wide, 1.212 m tall, 2.711 m wheelbase, 1.748 / 1.660 m track, 285/30 R20
front and 355/25 R21 rear (docs/cars.md, Reference). No badges, no maker's shapes: the class reads
through its proportions (long, wide, a teardrop glasshouse well forward of a long engine deck) and
through four signatures drawn for this car: a horseshoe grille, a polished C-shaped line round the
door that is also the leading edge of the side intake, a polished spine along the crown, and quad
exhausts in the middle of a dark diffuser under a full-width lamp bar.

Built hard-surface (tools/rally/hard_surface.py), as the Fulmine is: a 16-station control cage,
subdivided three times, octagonal arches cut by boolean, weighted normals.

The Chiron class reads round and muscular, so this cage carries few
creases (the crown spine, a soft rocker and nose and tail faces) and lets the subdivision round the
flanks: a nose that is round in plan (the corners fall back 0.25 m) around a horseshoe that stands 3 cm
proud, front fenders above a bonnet with a soft centre ridge, high rear haunches either side of a lower
engine deck, a tall tail (0.96 m) rounded in plan. The polished C line is the front lip of the side
intake and the two-tone split: ahead of it and inside it the car is the dark colour, behind it the
bright one (split per face by two_tone(), the C strip covers the step).

Physics twin: rally-physics/src/vehicle.rs hypercar() (kind 3): tyre radius 0.348 m (the mean of the
staggered pair), mounts x 0.874 front and 0.83 rear, z 1.355 either side of the root, so the drawn
wheels stand where the simulated ones do.

Frame and contract: see tools/rally/hero_kit.py (Blender Z up, -Y nose; glTF Y up, +Z nose; root on
the ground between the axles; pivots WheelFrontL/R, WheelRearL/R on -X/+X).

Run:     blender --background --factory-startup \\
             --python tools/rally/build_corsaire_w16.py
Review:  add `-- --previews <dir>` for studio renders and a contact sheet (keep them out of git).
Writes:  public/rally/corsaire_w16.glb, assets/rally/corsaire_w16_report.json.
"""
from pathlib import Path
import math, sys
import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_kit import palette, clear_scene, make_wheel, caliper, bucket_seat, steering_wheel, finish, review_renders
from hard_surface import Cage, Surface, finish_shell, ribbon, path, prism, GAP_WIDTH
from blender_primitives import cube, cylinder, line, groups

FILE = "corsaire_w16"
MASS = 1995             # kg, with fluids and fuel (vehicle.rs hypercar())
RADIUS = 0.348          # m, tyre radius (vehicle.rs)
WHEELBASE = 2.71        # m
AXLE_Y = WHEELBASE / 2  # m, either side of the root
TRACK_FRONT = 1.748     # m (vehicle.rs mounts x 0.874)
TRACK_REAR = 1.66       # m (vehicle.rs mounts x 0.83)
ARCH_RADIUS = 0.425     # m to the cutter's corners; as a 24-gon its flat sides stand 0.421 m out, 7.3 cm off the tread
ARCH_SIDES = 24         # round arches for a round body (the octagon read angular, 16 sides showed facets)
ARCH_INNER_X = 0.60     # m: the well's inner wall, inboard of the rear tyre's inner face (0.65 m)
PAINT = (0.004, 0.010, 0.040, 1)      # nose, bonnet, roof and the door inside the C: a near-black blue
PAINT_SECOND = (0.010, 0.050, 0.30, 1) # haunches, intake surround, deck and tail: a bright blue
SPLIT_Y = 0.50                         # m: the C's rear lip, the intake's leading edge and the roof's end
CLEARCOAT = (1.0, 0.04)          # full clear lacquer, nearly mirror smooth (factor, roughness)

FRONT_WHEEL = {"radius": RADIUS, "width": 0.285, "rim_radius": 0.254, "spokes": 5, "twin": True,
               "spoke_mat": "BrightMetal", "lip_mat": "BrightMetal"}   # 20 in rim = 0.254 m radius
REAR_WHEEL = dict(FRONT_WHEEL, width=0.355, rim_radius=0.267)          # 21 in rim

# Stations nose to tail: y (m, -Y is the nose) and the right half section j0..j9 as (x, z) m (j3 waist,
# j4 shoulder, j5 deck edge, j6 belt or fender top, j7 top of the side glass, j8 roof edge or the deck
# valley, j9 crown). The bonnet has no valley between the fenders and the ridge: with one (2.5 cm) its
# highlights broke into lobes (v1 to v4 top view). The crown: 0.63 m at the nose (a high round nose, not a wedge's blade), 0.93 at the cowl, 1.212 over the seats, the deck at
# about 1.0 m between haunches 3 to 5 cm higher, a tail 0.96 m tall. The nose narrows from 0.99 to 0.57 m
# half width over its last 0.52 m, so the plan is round, not a blunt wedge. Without creases the
# subdivided surface sits a few cm inside this cage, so at the arches the fenders stand 9 cm or more above
# the cutter's flat top (0.741 m) outboard of 0.60 m.
STATIONS = [
    (-2.24, [(0, 0.11), (0.42, 0.11), (0.52, 0.15), (0.57, 0.33), (0.56, 0.45), (0.51, 0.54), (0.41, 0.59), (0.29, 0.612), (0.15, 0.625), (0, 0.63)]),
    (-2.18, [(0, 0.11), (0.66, 0.11), (0.75, 0.15), (0.80, 0.32), (0.79, 0.50), (0.74, 0.60), (0.58, 0.645), (0.42, 0.66), (0.22, 0.668), (0, 0.672)]),
    (-2.02, [(0, 0.12), (0.80, 0.12), (0.89, 0.15), (0.94, 0.33), (0.94, 0.57), (0.89, 0.69), (0.72, 0.735), (0.50, 0.737), (0.26, 0.741), (0, 0.745)]),
    (-1.72, [(0, 0.12), (0.86, 0.12), (0.94, 0.15), (0.99, 0.37), (0.985, 0.67), (0.94, 0.79), (0.80, 0.845), (0.58, 0.836), (0.30, 0.836), (0, 0.842)]),
    (-1.355, [(0, 0.11), (0.88, 0.11), (0.94, 0.15), (1.00, 0.40), (0.995, 0.70), (0.95, 0.83), (0.82, 0.875), (0.60, 0.862), (0.30, 0.86), (0, 0.866)]),
    (-1.00, [(0, 0.11), (0.88, 0.11), (0.93, 0.16), (0.99, 0.42), (0.98, 0.70), (0.93, 0.80), (0.84, 0.87), (0.72, 0.90), (0.67, 0.91), (0, 0.93)]),
    (-0.60, [(0, 0.11), (0.88, 0.11), (0.93, 0.17), (0.99, 0.45), (0.975, 0.70), (0.92, 0.80), (0.85, 0.90), (0.68, 1.04), (0.63, 1.06), (0, 1.09)]),
    (-0.20, [(0, 0.11), (0.88, 0.11), (0.93, 0.17), (0.985, 0.47), (0.97, 0.70), (0.91, 0.80), (0.84, 0.91), (0.62, 1.15), (0.58, 1.175), (0, 1.205)]),
    (0.15, [(0, 0.11), (0.88, 0.11), (0.93, 0.17), (0.985, 0.45), (0.97, 0.70), (0.905, 0.81), (0.85, 0.92), (0.61, 1.16), (0.57, 1.18), (0, 1.212)]),
    (0.50, [(0, 0.11), (0.88, 0.11), (0.93, 0.17), (0.985, 0.42), (0.97, 0.71), (0.92, 0.84), (0.86, 0.95), (0.62, 1.10), (0.56, 1.12), (0, 1.15)]),
    # the side intake behind the C: the waist and shoulder tuck 18 cm in, the haunch flares back out
    (0.80, [(0, 0.11), (0.86, 0.11), (0.92, 0.16), (0.80, 0.36), (0.80, 0.70), (0.93, 0.87), (0.86, 0.97), (0.64, 1.04), (0.48, 1.05), (0, 1.08)]),
    (1.00, [(0, 0.11), (0.88, 0.11), (0.96, 0.16), (0.97, 0.40), (1.00, 0.70), (0.99, 0.87), (0.87, 0.995), (0.64, 0.995), (0.44, 0.97), (0, 1.01)]),
    (1.355, [(0, 0.12), (0.88, 0.12), (0.97, 0.17), (1.00, 0.46), (1.01, 0.72), (0.99, 0.89), (0.86, 1.015), (0.64, 1.00), (0.42, 0.955), (0, 0.99)]),
    (1.80, [(0, 0.16), (0.86, 0.16), (0.96, 0.22), (0.995, 0.48), (0.995, 0.74), (0.965, 0.885), (0.85, 0.99), (0.62, 0.975), (0.42, 0.945), (0, 0.97)]),
    (2.14, [(0, 0.28), (0.80, 0.28), (0.90, 0.31), (0.94, 0.50), (0.945, 0.74), (0.92, 0.87), (0.80, 0.945), (0.60, 0.95), (0.40, 0.94), (0, 0.955)]),
    (2.24, [(0, 0.33), (0.70, 0.33), (0.78, 0.35), (0.82, 0.50), (0.83, 0.74), (0.81, 0.855), (0.72, 0.92), (0.54, 0.93), (0.38, 0.925), (0, 0.94)]),
]
NOSE_Y, TAIL_Y = STATIONS[0][0], STATIONS[-1][0]
LAST = len(STATIONS) - 1

FRONT_BUMPER = (0, 1)     # nose corners: open intakes either side of the grille
HEADLAMP = 1              # the lamp housings at the nose corners on the deck edge
WINDSCREEN = (5, 6)       # cowl at -1.00 m to the roof front at -0.20 m
SIDE_GLASS = (5, 6, 7, 8) # -1.00 to 0.50 m
REAR_GLASS = 9            # the engine bay window behind the cabin
SIDE_INTAKE = (9, 10)     # behind the C line, 0.50 m to the rear arch
ENGINE_COVER = (10, 11, 12)
TAIL_LOWER = (14,)        # the rear corners' lower quarter, round into the diffuser
# (y, z) m on the flank, open to the nose: the polished C. Its back is the intake's leading edge (station
# SPLIT_Y) from 0.45 to 0.75 m, with an 8 cm corner at the top and a 22 cm sweep at the bottom; drawn
# inside the intake it read as two loose lines.
def c_line():
    top = [(-0.98, 0.80), (-0.50, 0.835), (0.0, 0.85), (0.42, 0.85)]
    corner = [(0.42 + 0.08 * math.sin(a), 0.77 + 0.08 * math.cos(a)) for a in (math.pi / 2 * k / 4 for k in range(1, 5))]
    sweep = [(0.28 + 0.22 * math.cos(a), 0.45 - 0.185 * math.sin(a)) for a in (math.pi / 2 * k / 6 for k in range(7))]
    return top + corner + sweep + [(0.0, 0.265), (-0.70, 0.265), (-0.80, 0.28)]


C_LINE = c_line()


def material_at(i, band):
    """Palette material of cage interval i, band b (hard_surface.py); band None is an end cap."""
    if band is None:
        return "BodyPaint"                          # the grille, plate and diffuser are laid on the caps
    if band <= 1:
        return "Graphite"                           # undertray and skirts: no paint at the tyre base
    if band == 2:
        return "Graphite" if i in FRONT_BUMPER or i in TAIL_LOWER else "BodyPaint"
    if band in (3, 4) and i in SIDE_INTAKE:
        return "Graphite"
    if band == 3 and i == FRONT_BUMPER[0]:
        return "Graphite"
    if band in (4, 5) and i == HEADLAMP:
        return "Graphite"
    if band == 6 and i in SIDE_GLASS:
        return "Glass"
    if band == 7 and i in SIDE_GLASS:
        return "Graphite"                           # black pillar and roof rail around the glass
    if band == 8:
        if i in WINDSCREEN or i == REAR_GLASS:
            return "Glass"
        if i in ENGINE_COVER:
            return "Graphite"
    return "BodyPaint"


def build_root():
    root = bpy.data.objects.new("CorsaireW16", None)
    bpy.context.collection.objects.link(root)
    root["wheel_radius_m"] = RADIUS
    root["wheelbase_m"] = WHEELBASE
    root["mass_kg"] = MASS
    root["description"] = "Corsaire W16: mid-engine hypercar, all-wheel drive"
    return root


def build_shell():
    palette("BodyPaint", PAINT, CLEARCOAT)
    palette("BodyPaintSecond", PAINT_SECOND, CLEARCOAT)
    cage = Cage(STATIONS, material_at)
    # Few creases: the waist, shoulder, deck edge and roof edge are left round (the Fulmine creases all
    # four, and with them the first Corsaire read as the same wedge). Glass, intakes and lamp housings
    # still get crisp outlines, because every edge between two materials is creased (hard_surface.py).
    cage.crease_line(2, value=0.6)         # rocker: a soft sill edge
    cage.crease_line(9, 0, 5, 0.4)         # a soft ridge down the bonnet into the horseshoe
    cage.crease_line(9, 5)                 # the spine over the roof and the engine deck
    cage.crease_ring(0, value=0.5)         # nose face: a soft edge round the horseshoe's panel
    cage.crease_ring(LAST - 1, 4, 9, 0.4)  # deck lip
    cage.crease_ring(LAST, 0, 4, 0.6)      # tail face: a firm lower edge over the diffuser,
    cage.crease_ring(LAST, 4, 9, 0.3)      # and a top edge that rolls over into the deck
    cage.crease_ring(9, 2, 6)              # the intake's leading edge, under the C line
    arches = [(-AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X), (AXLE_Y, RADIUS, ARCH_RADIUS, ARCH_INNER_X)]
    shell = cage.build("Body shell", arches, arch_sides=ARCH_SIDES)
    two_tone(shell)
    surface = Surface(shell)
    finish_shell(shell)
    return surface


def two_tone(shell):
    """Paint behind the C line in the second colour. A face is behind it when its centre lies aft of
    SPLIT_Y, or, below 0.45 m, aft of the C's bottom sweep. The step this leaves follows the subdivided
    faces (about 4 cm), under the 4.5 cm C strip; the top of the car splits at the roof's end."""
    data = shell.data
    first = data.materials.find("BodyPaint")
    data.materials.append(palette("BodyPaintSecond"))
    second = len(data.materials) - 1
    for poly in data.polygons:
        if poly.material_index != first:
            continue
        x, y, z = poly.center
        split = SPLIT_Y
        if z < 0.45 and abs(x) > 0.70:
            split = 0.28 + 0.22 * math.sqrt(max(0.0, 1 - ((0.45 - max(z, 0.265)) / 0.185) ** 2))
        if y >= split:
            poly.material_index = second


def fan(name, hits, centre, mat, lift):
    """A flat filled outline laid on the paint: the grille. Outline counter-clockwise seen from outside."""
    verts = [tuple(centre[0] + centre[1] * lift)] + [tuple(p + n * lift) for p, n in hits]
    m = len(hits)
    faces = [(0, 1 + k, 1 + (k + 1) % m) for k in range(m)]
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    groups.setdefault("BodyStatic", []).append(obj)
    return obj


def raised_rim(name, hits, centre, width, height, mat):
    """A polished frame standing `height` proud of the paint round a closed outline of surface hits:
    top face, inner and outer walls (sunk 1 cm into the body so no gap shows at a grazing view)."""
    verts, faces = [], []
    m = len(hits)
    for p, n in hits:
        out = (p - centre) - n * (p - centre).dot(n)
        out.normalize()
        verts += [tuple(p - n * 0.01), tuple(p + n * height), tuple(p + out * width + n * height),
                  tuple(p + out * width - n * 0.01)]
    for k in range(m):
        a, b = 4 * k, 4 * ((k + 1) % m)
        for s in range(3):
            faces.append((a + s, b + s, b + s + 1, a + s + 1))
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    groups.setdefault("BodyStatic", []).append(obj)
    return obj


def build_grille(surface):
    """The horseshoe, the car's centre of gravity in the face: a rounded top whose sides fall in to a
    narrow flat foot, 36 cm wide and 27 cm tall, a dark mesh with vertical bars in a 3 cm polished frame
    that stands 3 cm proud of the nose (laid flat at 1.4 cm wide, it read as a badge)."""
    graphite, bright = palette("Graphite"), palette("BrightMetal")
    outline = [(0.18 * math.cos(math.pi * k / 12), 0.43 + 0.10 * math.sin(math.pi * k / 12)) for k in range(13)]
    outline += [(-0.175, 0.37), (-0.15, 0.31), (-0.10, 0.27), (-0.05, 0.26), (0.05, 0.26), (0.10, 0.27), (0.15, 0.31), (0.175, 0.37)]
    hits = [surface.from_front(x, z) for x, z in outline]
    centre = surface.from_front(0, 0.40)
    fan("Grille", hits, centre, graphite, 0.003)
    raised_rim("Grille surround", hits, centre[0], 0.03, 0.03, bright)
    for x in (-0.12, -0.06, 0.0, 0.06, 0.12):
        top = 0.43 + 0.10 * math.sqrt(max(0.0, 1 - (x / 0.18) ** 2)) - 0.01
        foot = 0.275 if abs(x) < 0.08 else 0.30
        ribbon("Grille bar", path(surface.from_front, (x, foot), (x, top), 6), 0.008, bright, lift=0.012)


def build_lamps(surface):
    """Four small lamps in a rising diagonal at each front corner, a full-width bar at the tail."""
    head, tail, amber = palette("Headlamp"), palette("TailLamp"), palette("Indicator")
    for side in (1, -1):
        for k in range(4):
            x, y = side * (0.60 + 0.055 * k), -2.11 + 0.035 * k
            ribbon("Headlamp", path(surface.from_above, (x - side * 0.022, y), (x + side * 0.022, y), 3), 0.035, head)
        ribbon("Daytime running line", path(surface.from_above, (side * 0.58, -2.15), (side * 0.80, -2.12), 8), 0.010, head)
        ribbon("Front indicator", path(surface.from_above, (side * 0.82, -2.10), (side * 0.86, -2.06), 4), 0.014, amber)
        ribbon("Rear indicator", path(surface.from_behind, (side * 0.56, 0.79), (side * 0.68, 0.79), 4), 0.02, amber)
    # one bar 1.6 m long and 3.5 cm tall, 4 cm or more inside the tail's top edge
    ribbon("Rear lamp bar", path(surface.from_behind, (-0.70, 0.84), (0.70, 0.84), 24), 0.04, tail)


def along(points, step=0.025):
    """The polyline resampled every `step` m: a strip laid on hits 14 cm apart cut the chord under the
    bulging waist, and the C's back curve vanished into the paint (v2 side render)."""
    out = []
    for (y0, z0), (y1, z1) in zip(points, points[1:]):
        n = max(1, int(math.hypot(y1 - y0, z1 - z0) / step))
        out += [(y0 + (y1 - y0) * t / n, z0 + (z1 - z0) * t / n) for t in range(n)]
    return out + [points[-1]]


def build_lines(surface):
    """The polished C round the door, the spine along the crown and the shut lines."""
    bright, gap = palette("BrightMetal"), palette("Rubber")
    for side in (1, -1):
        hits = [surface.from_side(y, z, side) for y, z in along(C_LINE)]
        ribbon("C line", hits, 0.045, bright, lift=0.0012)   # covers the two-tone step (two_tone())
        ribbon("Door shut line", path(lambda y, z, side=side: surface.from_side(y, z, side), (-0.86, 0.30), (-0.86, 0.80), 14), GAP_WIDTH, gap)
        ribbon("Luggage lid side line", path(surface.from_above, (side * 0.58, -2.04), (side * 0.58, -1.06), 16), GAP_WIDTH, gap)
    ribbon("Luggage lid line", path(surface.from_above, (-0.58, -1.06), (0.58, -1.06), 12), GAP_WIDTH, gap)
    ribbon("Spine", path(surface.from_above, (0, -0.18), (0, 2.12), 48), 0.022, bright, lift=0.0012)


def build_aero(surface):
    graphite, dark, bright = palette("Graphite"), palette("AlloyDark"), palette("BrightMetal")
    # the lip under the nose: its top meets the nose's underside (0.11 m); 10 cm below it, it read as a
    # loose plate
    prism("Front splitter", [(-0.40, -2.28), (0.40, -2.28), (0.70, -2.21), (0.86, -2.04), (-0.86, -2.04), (-0.70, -2.21)],
          0.09, 0.112, graphite)
    for side in (1, -1):
        blade = cube("Intake blade", (side * 0.50, NOSE_Y + 0.02, 0.26), (0.26, 0.03, 0.012), dark, 0.004)
        blade.rotation_euler.y = side * 0.25
        for k in range(3):                         # fins across the side intake, inside its mouth
            p, n = surface.from_side(0.62 + k * 0.10, 0.60, side)
            fin = cube("Side intake fin", tuple(p - n * 0.04), (0.05, 0.012, 0.30), dark, 0.003)
            fin.rotation_euler.z = side * 0.5
    # The tail's black zone: a diffuser panel under the plate (the rest of the tail is paint: a black
    # tail panel read as one dark slab on the Fulmine), quad exhausts at its centre.
    cube("Rear diffuser panel", (0, TAIL_Y + 0.012, 0.465), (1.40, 0.02, 0.27), graphite, 0.004)
    for k in range(5):
        cube("Diffuser strake", (-0.50 + k * 0.25, 2.08, 0.27), (0.012, 0.30, 0.10), graphite, 0.003)
    for x in (-0.075, 0.075):
        for z in (0.41, 0.51):
            cylinder("Exhaust tip", (x, TAIL_Y + 0.03, z), 0.042, 0.07, bright, axis="Y", segments=16)
            cylinder("Exhaust bore", (x, TAIL_Y + 0.031, z), 0.034, 0.074, graphite, axis="Y", segments=16)
    for side in (1, -1):                           # louvres either side of the spine on the engine deck
        for k in range(6):
            y = 1.02 + k * 0.12
            top = surface.from_above(side * 0.22, y)[0]
            ahead, behind = surface.from_above(side * 0.22, y - 0.05)[0], surface.from_above(side * 0.22, y + 0.05)[0]
            slat = cube("Engine cover slat", (side * 0.22, y, top.z + 0.004), (0.30, 0.04, 0.010), dark, 0.003)
            slat.rotation_euler.x = math.atan2(behind.z - ahead.z, 0.10)


def build_mirrors(surface):
    paint, graphite, bright = palette("BodyPaint"), palette("Graphite"), palette("BrightMetal")
    for side in (1, -1):
        base = surface.from_side(-0.72, 0.86, side)[0]
        housing = (base.x + side * 0.12, base.y - 0.02, base.z + 0.07)
        line("Mirror stalk", [tuple(base), (housing[0] - side * 0.05, housing[1] + 0.01, housing[2] - 0.01)], 0.010, graphite)
        body = cube("Mirror housing", housing, (0.16, 0.06, 0.05), paint, 0.018)
        body.rotation_euler.z = side * 0.08
        cube("Mirror glass", (housing[0], housing[1] + 0.031, housing[2]), (0.14, 0.004, 0.038), bright, 0.002)
    base, tip = surface.from_above(0.10, -0.95)[0], surface.from_above(0.58, -0.85)[0]
    line("Wiper arm", [tuple(base), tuple(tip)], 0.006, graphite)


def build_cabin():
    """Two seats in a leather-and-dark cabin, right-hand drive (the car's right is -X), door cards inside
    the belt, headliner and bulkhead so no inside face of the paint shows through the glass."""
    trim, seat = palette("Interior"), palette("SeatFabric")
    cube("Cabin floor", (0, -0.20, 0.17), (1.56, 1.80, 0.04), trim, 0.01, "InteriorAssembly")
    dash = cube("Dashboard", (0, -0.82, 0.72), (1.56, 0.40, 0.14), trim, 0.04, "InteriorAssembly")
    dash.rotation_euler.x = 0.15
    cube("Instrument binnacle", (-0.38, -0.66, 0.82), (0.32, 0.14, 0.08), trim, 0.03, "InteriorAssembly")
    cube("Centre console", (0, -0.25, 0.34), (0.26, 1.10, 0.24), trim, 0.03, "InteriorAssembly")
    for x in (-0.38, 0.38):
        bucket_seat(x, 0.05, 0.18, seat)
    steering_wheel(-0.38, -0.52, 0.78, 0.36, trim, palette("Graphite"))
    for side in (1, -1):
        cube("Door card", (side * 0.79, -0.20, 0.52), (0.03, 1.36, 0.58), trim, 0.01, "InteriorAssembly")
    cube("Headliner", (0, 0.12, 1.15), (1.10, 0.66, 0.02), trim, 0.01, "InteriorAssembly")
    cube("Rear bulkhead", (0, 0.55, 0.64), (1.56, 0.06, 0.60), trim, 0.01, "InteriorAssembly")
    cube("Engine", (0, 1.05, 0.64), (0.86, 0.80, 0.38), palette("Graphite"), 0.03, "InteriorAssembly")


def wheel_centres():
    return {"WheelFrontL": (-1, (-TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelFrontR": (1, (TRACK_FRONT / 2, -AXLE_Y, RADIUS), FRONT_WHEEL, 1),
            "WheelRearL": (-1, (-TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1),
            "WheelRearR": (1, (TRACK_REAR / 2, AXLE_Y, RADIUS), REAR_WHEEL, -1)}


def main():
    clear_scene()
    root = build_root()
    surface = build_shell()
    build_grille(surface)
    build_lamps(surface)
    build_lines(surface)
    build_aero(surface)
    build_mirrors(surface)
    build_cabin()
    for name, (side, centre, spec, trailing) in wheel_centres().items():
        make_wheel(root, name, side, centre, spec)
        caliper(side, centre, spec, trailing)
    # [x, y, z, yaw] in glTF car space for src/rally/VehicleModel.js PLATES (glTF z = -Blender y).
    rear_plate = surface.from_behind(0, 0.66)[0]
    front_plate = surface.from_front(0, 0.26)[0]
    plates = [[0.0, 0.66, round(-(rear_plate.y + 0.008), 3), math.pi],
              [0.0, 0.26, round(-(front_plate.y - 0.006), 3), 0]]
    finish(root, FILE, RADIUS, WHEELBASE, (TRACK_FRONT + TRACK_REAR) / 2, plates,
           {"length_m": round(TAIL_Y - NOSE_Y, 3), "mass_kg": MASS})
    review_renders(FILE, [("front34", (4.6, -6.0, 2.0), 50), ("rear34", (-4.8, 5.8, 2.2), 50),
                          ("side", (30.0, 0.0, 0.6), 200), ("top", (0.0, 0.0, 30.0), 110),
                          ("front", (0.0, -30.0, 0.6), 300), ("cabin", (1.3, -2.4, 3.2), 40)])


main()
