"""Tidewater's car ferry, the Tidewater Spirit: a 50 m aluminium catamaran after Austal's Spirit of
Kangaroo Island (2003, 50.4 m x 17.8 m, 2.5 m draught). Twin slender demi-hulls with knife stems and a
high arched tunnel between them; an open vehicle deck aft (no height limit, for trucks) between two
side wings, each with a passenger corridor inside and a walkway on top; the passenger saloon forward
over the vehicle deck under an overhanging brow; the bridge deckhouse on the saloon roof, flush with
the sides; an open bow deck inside raked cheeks; a tall stern ramp.

Modelled bow toward +Y, starboard +X, Z up, origin on the waterline on the centreline amidships; the
exported root turns it to face glTF +Z like the cars. Animated parts are their own pivot nodes
(SternRamp, RadarX, RadarS, HelmWheelMount/HelmWheel, ThrottlePort/ThrottleStarboard). Run:
  Blender --background --factory-startup --python tools/ferry/ferry_build.py
"""
import sys, math, json
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rally'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_primitives import material, mesh, join_group, groups
from ferry_kit import smoothstep, pivot
import ferry_batch as fb
from ferry_batch import aabb, cyl, fill, rail, sheet

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

# ---- principal dimensions (metres) -------------------------------------------------------
LOA, BEAM = 50.4, 17.8
STERN, BOW = -25.2, 25.2              # transom (the stern ramp hinge line) and the bow deck's front
SIDE = BEAM / 2
HULL_C, HULL_W = 6.7, 2.2             # demi-hull centreline and half width at the waterline
KEEL = -2.5                           # draught
STEM_WL, STEM_TOP, STEM_TOP_Z = 22.6, 25.0, 6.2   # stems: where they cut the waterline, meet the deck edge
DECK1, DECK2, DECK3, ROOF3 = 2.6, 7.0, 10.0, 13.2 # vehicle deck, passenger deck, wing tops and saloon roof, bridge roof
NAVY_LINE = 3.3                       # the boot top
WING_IN = 6.6                         # inner face of the side wings: the vehicle deck is 13.2 m wide
def xs(*v): return sorted(v)                 # min/max pairs for aabb (also used before section 16)
R_AFT = 1.3                           # plan radius of the wings' aft outer corners
SUPER_AFT = 0.5                       # the saloon's aft wall over the vehicle deck
UPPER_AFT = 5.4                       # the bridge deckhouse's aft wall
CHEEK_Y0 = 12.8                       # where the side-wall top leaves the deckhouse and falls to the bow
SALOON_FRONT = 16.6                   # the saloon's front glazing
BROW_Y = 17.2                         # the brow's front edge over it
BOW_ROUND = 19.5                      # the deck edge starts rounding in to the bow here
FWD_BULKHEAD = 18.6                   # forward end of the vehicle deck (the tunnel arches up ahead of it)
SILL2, HEAD2 = 7.5, 9.35              # saloon and wing window band
SILL3, HEAD3 = 11.0, 12.85            # bridge deckhouse window band, right up under the roof
FAIRING = 1.0                         # side fairing round the forward sun deck
DOOR_Y, DOOR_W, DOOR_H = -15.5, 1.5, 2.15         # the side (gangway) doors in both wings
GANGWAY_X = SIDE + 0.42               # the door sill's outer edge, where the terminal gangway lands
LADDER_Y = -18.0
RAMP_W, RAMP_L = 10.0, 7.0
R_UP = 3.0                            # plan radius of the bridge deckhouse's front corners
UP_FRONT = CHEEK_Y0 + R_UP            # the deckhouse front at the window sill
HELM_Y = 14.4                         # the ship's wheel
SLOPE = (SILL3 - DECK2) / (STEM_TOP - CHEEK_Y0)

# ---- materials ---------------------------------------------------------------------------
def glassy(mat, alpha, transmission):
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Alpha'].default_value = alpha
    if 'Transmission Weight' in b.inputs: b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['IOR'].default_value = 1.45
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'BLENDED'
    if hasattr(mat, 'blend_method'): mat.blend_method = 'BLEND'
    return mat

NAVY = material('HullNavy', (0.012, 0.035, 0.19), 0.1, 0.3)
BOTTOM = material('Antifouling', (0.02, 0.07, 0.22), 0.0, 0.6)
WHITE = material('SuperstructureWhite', (0.86, 0.87, 0.86), 0.05, 0.28)
OFFWHITE = material('DeckhouseWhite', (0.78, 0.79, 0.77), 0.05, 0.35)
GLASS = glassy(material('TintedGlass', (0.01, 0.013, 0.017), 0.0, 0.03), 0.72, 0.3)
FRAME = material('WindowFrame', (0.02, 0.02, 0.022), 0.4, 0.35)
DECKGREY = material('NonSlipDeck', (0.22, 0.23, 0.23), 0.0, 0.85)
STEEL = material('PaintedSteel', (0.42, 0.44, 0.45), 0.4, 0.5)
STAINLESS = material('Stainless', (0.72, 0.73, 0.74), 1.0, 0.22)
BLACK = material('StackBlack', (0.015, 0.015, 0.016), 0.2, 0.45)
YELLOW = material('SafetyYellow', (0.9, 0.68, 0.02), 0.0, 0.5)
ORANGE = material('LifebuoyOrange', (0.95, 0.28, 0.03), 0.0, 0.45)
RUBBER = material('FenderRubber', (0.03, 0.03, 0.03), 0.0, 0.8)
INTERIOR = material('VehicleDeckWalls', (0.62, 0.64, 0.65), 0.1, 0.6)
LINING = material('CeilingLining', (0.8, 0.8, 0.78), 0.0, 0.6)
CARPET = material('SaloonCarpet', (0.05, 0.08, 0.13), 0.0, 0.9)
BAND_BLACK = material('BandBlack', (0.008, 0.01, 0.013), 0.0, 0.1)
CEILING_LIGHT = material('CeilingLight', (1.0, 0.96, 0.88), 0.0, 0.3, 3.5)
GOLD = material('SunGold', (0.92, 0.6, 0.15), 0.0, 0.4)
SOFT_NAVY = material('LiverySoftNavy', (0.05, 0.075, 0.19), 0.0, 0.4)
TEAL = material('LiveryTeal', (0.0, 0.42, 0.45), 0.1, 0.3)
BRONZE = material('Bronze', (0.55, 0.36, 0.14), 1.0, 0.3)
RAMP_STEEL = material('RampSteel', (0.1, 0.105, 0.11), 0.5, 0.55)
# Interior surfaces: src/ferry/FerryPaint.js draws their detail at runtime by name (weld seams, rust and scuffs,
# tyre marks and oil, laminate seams, flecked vinyl, the ceiling grid, carpet) and lights them indoors.
CARWALL = material('CarDeckWall', (0.5, 0.53, 0.54), 0.25, 0.55)
CARFLOOR = material('CarDeckFloor', (0.2, 0.21, 0.21), 0.0, 0.8)
VINYL = material('CorridorVinyl', (0.25, 0.28, 0.31), 0.0, 0.55)
LAMWALL = material('CorridorLaminate', (0.66, 0.62, 0.54), 0.0, 0.42)
PIPING = material('SeatPiping', (0.55, 0.57, 0.56), 0.0, 0.6)
ARM = material('ArmrestBlack', (0.025, 0.025, 0.028), 0.0, 0.55)

# ---- the lines: plan, profile and sections -------------------------------------------------
def half_beam(y):
    """Deck-edge half width: full beam aft, rounding in to the bow as a blunt superellipse."""
    if y <= BOW_ROUND: return SIDE
    t = min(1.0, (y - BOW_ROUND) / (BOW - BOW_ROUND))
    return SIDE * max(0.0, 1 - t ** 6) ** (1 / 6)

def hull_top(y):
    """The navy/white boundary: the boot top, rising in a straight rake parallel to the stems to the
    deck edge at the bow."""
    return NAVY_LINE + (DECK2 - NAVY_LINE) * min(1.0, max(0.0, (y - 21.6) / (24.4 - 21.6)))

def hull_wl(y):
    """Demi-hull half width at the waterline: full aft, a fine entry to the stem."""
    if y >= STEM_WL: return 0.0
    s = smoothstep(8.0, STEM_WL, y)
    return HULL_W * (1 - s ** 1.5) ** 0.7

def keel_z(y):
    z = KEEL + 0.35 * smoothstep(-20.0, STERN, y)
    return z * (1 - smoothstep(14.0, STEM_WL, y) ** 0.9)

def stem_z(y):
    return STEM_TOP_Z * min(1.0, max(0.0, (y - STEM_WL) / (STEM_TOP - STEM_WL)))

def tunnel_z(y):
    """The tunnel roof between the hulls: just under the vehicle deck, then arching high under the
    bow ahead of the vehicle deck's forward bulkhead."""
    return 2.2 + 4.3 * smoothstep(FWD_BULKHEAD + 0.3, STEM_TOP, y) ** 0.85

def arch_p(y):
    """Superellipse exponent of the tunnel: square-shouldered aft, a round arch at the bow."""
    return 8.0 - 5.8 * smoothstep(12.0, 22.5, y)

def cheek_top(y):
    """The side-wall top ahead of the deckhouse, falling from its window sill to the bow corner."""
    return SILL3 - (y - CHEEK_Y0) * SLOPE

def roof_z(y):
    """The saloon roof: flat, then the brow sloping down to its front edge between the cheeks."""
    return min(DECK3, cheek_top(y))

def band_top(y):
    """Top of the saloon window band: level, then raked under the falling cheek top."""
    return max(SILL2, min(HEAD2, cheek_top(y) - 0.15))

def top_line(y):
    """Top edge of the white side wall along the ship."""
    if y < SUPER_AFT - 0.3: return DECK3                                       # the wing tops
    if y < UPPER_AFT: return DECK3 + FAIRING * smoothstep(SUPER_AFT - 0.3, SUPER_AFT + 0.6, y)
    if y < CHEEK_Y0: return ROOF3                                              # the deckhouse, flush
    return cheek_top(y)

Y_HEAD = CHEEK_Y0 + (SILL3 - HEAD2 - 0.15) / SLOPE      # where the band's top starts to rake
Y_SILL = CHEEK_Y0 + (SILL3 - SILL2 - 0.17) / SLOPE      # where the band runs out at the bow
Y_BROW0 = CHEEK_Y0 + (SILL3 - DECK3) / SLOPE            # where the saloon roof starts to fall as the brow

def half_section(y):
    """Starboard half of the hull section at y: from the deck edge down the outer side, round the
    keel, up the inner side and over the tunnel arch to the centreline."""
    B, zt, wl = half_beam(y), hull_top(y), hull_wl(y)
    if y < STEM_WL: zb, zref = keel_z(y), 0.0
    else: zb = zref = stem_z(y)
    xo, xi = HULL_C + wl, HULL_C - wl
    pts = []
    for k in range(12):                                   # the outer side, flaring out above the entry
        s = 1 - k / 12
        pts.append((xo + (B - xo) * s ** 1.6, y, zref + (zt - zref) * s))
    for k in range(17):                                   # underwater, a full round bilge
        a = math.pi * k / 16
        c, sn = math.cos(a), math.sin(a)
        pts.append((HULL_C + wl * math.copysign(abs(c) ** 0.75, c), y, zref + (zb - zref) * max(0.0, sn) ** 0.55))
    top, p = max(tunnel_z(y), zref + 0.3), arch_p(y)
    for k in range(1, 27):                                # the inner side and the tunnel arch
        a = math.pi / 2 * k / 26
        pts.append((xi * max(0.0, math.cos(a)) ** (2 / p), y, zref + (top - zref) * max(0.0, math.sin(a)) ** (2 / p)))
    return pts

def full_section(y):
    half = half_section(y)
    return [(-x, yy, z) for x, yy, z in half] + list(reversed(half))[1:]

# ---- 1. hull: the navy shell, demi-hulls and tunnel in one loft ---------------------------
ys = [STERN + i * 0.7 for i in range(int((18.0 - STERN) / 0.7) + 1)]
ys += [ys[-1] + (STEM_TOP - ys[-1]) * i / 70 for i in range(1, 71)]
rings = [full_section(y) for y in ys]
verts, faces = [], []
n = len(rings[0])
for r in rings: verts.extend(r)
for i in range(len(rings) - 1):
    for j in range(n - 1):
        a = i * n + j
        faces.append((a, a + 1, a + n + 1, a + n))
hull_obj = mesh('Hull shell', verts, faces, NAVY, 'Hull', True)
hull_obj.data.materials.append(BOTTOM); hull_obj.data.materials.append(WHITE)
for poly in hull_obj.data.polygons:
    c = poly.center
    if c.z < -0.12: poly.material_index = 1
# Transom: each hull's aft face and the cross-structure between them, up to the vehicle deck.
fill('Hull', NAVY, rings[0] + [(WING_IN, STERN, NAVY_LINE), (WING_IN, STERN, DECK1), (-WING_IN, STERN, DECK1), (-WING_IN, STERN, NAVY_LINE)], (0, -1, 0))
# The front of the bow deck between the stem tops.
fill('Hull', NAVY, rings[-1], (0, 1, 0))
for x in (-HULL_C, HULL_C):
    cyl('Hull', STEEL, (x, STERN + 1.6, -1.7), (x, STERN - 0.35, -1.7), 0.08, 12)     # shafts
    for k in range(4):                                                                # propellers
        a = k * math.pi / 2 + 0.4
        fb.plate('Hull', BRONZE, [(0, -0.12), (0.62, -0.18), (0.72, 0.0), (0.6, 0.16), (0, 0.1)],
                 (x, STERN - 0.2, -1.7), (math.cos(a), 0, math.sin(a)), (0, 1, 0), 0.03)
    aabb('Hull', STEEL, x - 0.04, x + 0.04, STERN - 0.9, STERN - 0.1, -2.35, -1.2)   # rudders

# ---- 2. the white side walls, their window bands and doors --------------------------------
def skin_path():
    """Plan path of the starboard side wall: the wing's aft face, the rounded corner, forward along
    the side and round the bow to the stem top."""
    pts = [(WING_IN + (SIDE - R_AFT - WING_IN) * k / 7, STERN) for k in range(7)]
    for k in range(13):
        a = -math.pi / 2 + math.pi / 2 * k / 12
        pts.append((SIDE - R_AFT + R_AFT * math.cos(a), STERN + R_AFT + R_AFT * math.sin(a)))
    keys = [SUPER_AFT - 0.3, SUPER_AFT + 0.6, UPPER_AFT - 0.002, UPPER_AFT, UPPER_AFT + 0.5, CHEEK_Y0 - 0.002, CHEEK_Y0,
            DOOR_Y - DOOR_W / 2, DOOR_Y + DOOR_W / 2, SALOON_FRONT, Y_HEAD, Y_SILL, BOW_ROUND, Y_BROW0]
    y0 = STERN + R_AFT
    ys_ = [y0 + 0.3 * (i + 1) for i in range(int((STEM_TOP - y0) / 0.3))] + keys + [STEM_TOP]
    ys_ = sorted({round(y, 4) for y in ys_ if y0 < y <= STEM_TOP})
    return pts + [(half_beam(y), y) for y in ys_]

PATH = skin_path()
def on_aft_face(x, y): return y <= STERN + 1e-6 and x < SIDE - R_AFT + 1e-6
def in_door(y): return DOOR_Y - DOOR_W / 2 - 1e-4 < y < DOOR_Y + DOOR_W / 2 + 1e-4

def levels(x, y, door):
    aft = on_aft_face(x, y)
    lo = NAVY_LINE if aft else hull_top(y)
    hi = DECK3 if aft else top_line(y)
    raw = [lo] + ([DECK2, SILL2, DECK2 + DOOR_H] if door else [SILL2]) + [band_top(y), SILL3, HEAD3, hi]
    out = [lo]
    for z in raw[1:-1]: out.append(min(hi, max(out[-1], z)))
    out.append(max(out[-1], hi))
    return out

def region_kinds(door):
    return (['white', 'open', 'open', 'band', 'white', 'upper', 'white'] if door else ['white', 'band', 'white', 'upper', 'white'])

BAND_RUNS = {1: [], -1: []}          # per side: glazed strips, for the frames
for s in (1, -1):
    for i in range(len(PATH) - 1):
        (xa, ya), (xb, yb) = PATH[i], PATH[i + 1]
        door = in_door(ya) and in_door(yb)
        la, lb = levels(xa, ya, door), levels(xb, yb, door)
        xm, ym = (xa + xb) / 2, (ya + yb) / 2
        for k, kind in enumerate(region_kinds(door)):
            a0, a1, b0, b1 = la[k], la[k + 1], lb[k], lb[k + 1]
            if (a1 - a0 < 1e-4 and b1 - b0 < 1e-4) or kind == 'open': continue
            if kind == 'band':
                glazed = band_top(ym) > SILL2 + 0.02 and not (on_aft_face(xm, ym) and xm < 7.25)
                kind = ('glass' if ym < SALOON_FRONT else 'paint') if glazed else 'white'
            if kind == 'upper':
                kind = 'glass' if UPPER_AFT + 0.5 <= ym <= CHEEK_Y0 else 'white'
            P = [(s * xa, ya, a0), (s * xb, yb, b0), (s * xb, yb, b1), (s * xa, ya, a1)]
            if s < 0: P = [P[0], P[3], P[2], P[1]]
            group, mat = {'glass': ('Glazing', GLASS), 'paint': ('Skin', BAND_BLACK)}.get(kind, ('Skin', WHITE))
            fb.quad(group, mat, *P)
            if kind in ('glass', 'paint'): BAND_RUNS[s].append(((xa, ya, a0, a1), (xb, yb, b0, b1)))

# Frames: sill and head rails along every glazed run, and mullions at a steady pitch.
for s in (1, -1):
    runs = BAND_RUNS[s]
    for (xa, ya, a0, a1), (xb, yb, b0, b1) in runs:
        for za, zb in ((a0, b0), (a1, b1)):
            cyl('Glazing', FRAME, (s * (xa + 0.02), ya, za), (s * (xb + 0.02), yb, zb), 0.028, 6)
    acc, pitch = 0.0, 1.42
    for (xa, ya, a0, a1), (xb, yb, b0, b1) in runs:
        seg = math.hypot(xb - xa, yb - ya)
        while acc <= seg:
            f = acc / seg if seg else 0
            x, y = xa + (xb - xa) * f, ya + (yb - ya) * f
            z0, z1 = a0 + (b0 - a0) * f, a1 + (b1 - a1) * f
            if z1 - z0 > 0.25:
                cyl('Glazing', FRAME, (s * (x + 0.02), y, z0), (s * (x + 0.02), y, z1), 0.03, 6)
            acc += pitch
        acc -= seg

# ---- 3. the vehicle deck and the side wings -------------------------------------------------
aabb('Structure', CARFLOOR, -WING_IN, WING_IN, STERN, FWD_BULKHEAD, DECK1 - 0.3, DECK1)
for s in (1, -1):
    xi = s * WING_IN
    # The wing's inner wall to the vehicle deck, full height aft with a doorway to the stairs,
    # and under the saloon forward of it.
    w0, w1 = min(xi, xi + s * 0.12), max(xi, xi + s * 0.12)
    aabb('Structure', CARWALL, w0, w1, STERN, -9.5, DECK1, DECK3)
    aabb('Structure', CARWALL, w0, w1, -8.3, SUPER_AFT, DECK1, DECK3)
    aabb('Structure', CARWALL, w0, w1, -9.5, -8.3, DECK1 + 2.1, DECK3)
    aabb('Structure', CARWALL, w0, w1, SUPER_AFT, FWD_BULKHEAD, DECK1, DECK2 - 0.45)
    # The corridor deck inside the wing and the walkway on top, following the rounded aft corner,
    # open where the stairs come through.
    def wing_slab(z0, z1, y_cut, rects, mat_top, mat_bot):
        outline = [(WING_IN + 0.12, STERN + 0.03)] + [(x_, max(y_, STERN + 0.03)) for x_, y_ in PATH if y_ <= y_cut + 1e-6 and x_ > WING_IN + 0.12] + [(SIDE - 0.03, y_cut), (WING_IN + 0.12, y_cut)]
        inset = [(min(x_, SIDE - 0.03), y_) for x_, y_ in outline]
        fill('Structure', mat_top, [(s * x_, y_, z1) for x_, y_ in inset], (0, 0, 1))
        fill('Interior', mat_bot, [(s * x_, y_, z0) for x_, y_ in inset], (0, 0, -1))
        for x0_, x1_, y0_, y1_ in rects:
            aabb('Structure', mat_top, min(s * x0_, s * x1_), max(s * x0_, s * x1_), y0_, y1_, z0, z1)
    wing_slab(DECK2 - 0.3, DECK2, -19.9, [(7.8, SIDE - 0.03, -19.9, -15.74), (WING_IN + 0.12, SIDE - 0.03, -15.74, -8.2), (7.8, SIDE - 0.03, -8.2, -1.95), (WING_IN + 0.12, SIDE - 0.03, -1.95, SUPER_AFT)], VINYL, INTERIOR)
    wing_slab(DECK3 - 0.3, DECK3, -19.95, [(8.0, SIDE - 0.03, -19.95, -15.74), (WING_IN + 0.12, SIDE - 0.03, -15.74, SUPER_AFT)], DECKGREY, LINING)
# The stern: bulwarks either side of the ramp, and the forward bulkhead of the vehicle deck.
for s in (1, -1):
    aabb('Structure', WHITE, min(s * RAMP_W / 2, s * WING_IN), max(s * RAMP_W / 2, s * WING_IN), STERN, STERN + 0.25, DECK1, DECK1 + 1.3)
aabb('Structure', CARWALL, -WING_IN, WING_IN, FWD_BULKHEAD, FWD_BULKHEAD + 0.15, DECK1, DECK2 - 0.45)

# ---- 4. the saloon, its brow, the forward sun deck and the bow deck -------------------------
aabb('Structure', DECKGREY, -SIDE + 0.02, SIDE - 0.02, SUPER_AFT, SALOON_FRONT, DECK2 - 0.45, DECK2)
aabb('Interior', CARPET, -SIDE + 0.2, SIDE - 0.2, SUPER_AFT + 0.1, SALOON_FRONT - 0.05, DECK2, DECK2 + 0.012)
# The saloon's aft wall over the vehicle deck, glazed to look aft over the cars.
x0, x1 = -WING_IN, WING_IN
aabb('Structure', WHITE, x0, x1, SUPER_AFT - 0.1, SUPER_AFT, DECK2 - 0.45, SILL2)
aabb('Structure', WHITE, x0, x1, SUPER_AFT - 0.1, SUPER_AFT, HEAD2, DECK3)
fb.quad('Glazing', GLASS, (x0, SUPER_AFT - 0.1, SILL2), (x1, SUPER_AFT - 0.1, SILL2), (x1, SUPER_AFT - 0.1, HEAD2), (x0, SUPER_AFT - 0.1, HEAD2))
for k in range(10):
    x = x0 + (x1 - x0) * k / 9
    cyl('Glazing', FRAME, (x, SUPER_AFT - 0.12, SILL2), (x, SUPER_AFT - 0.12, HEAD2), 0.035, 6)
for z in (SILL2, HEAD2):
    cyl('Glazing', FRAME, (x0, SUPER_AFT - 0.12, z), (x1, SUPER_AFT - 0.12, z), 0.03, 6)
# The roof: flat over the saloon, then the brow falling to its edge between the cheeks; a lining
# under it for the saloon ceiling.
rys = [SUPER_AFT] + [Y_BROW0 + (BROW_Y - Y_BROW0) * k / 8 for k in range(9)]
xw = SIDE - 0.22
for i in range(len(rys) - 1):
    y0, y1 = rys[i], rys[i + 1]
    fb.quad('Structure', DECKGREY, (-xw, y0, roof_z(y0)), (xw, y0, roof_z(y0)), (xw, y1, roof_z(y1)), (-xw, y1, roof_z(y1)))
    fb.quad('Interior', LINING, (-xw, y1, roof_z(y1) - 0.3), (xw, y1, roof_z(y1) - 0.3), (xw, y0, roof_z(y0) - 0.3), (-xw, y0, roof_z(y0) - 0.3))
zb = roof_z(BROW_Y)
fb.quad('Structure', WHITE, (-xw, BROW_Y, zb - 0.28), (xw, BROW_Y, zb - 0.28), (xw, BROW_Y, zb), (-xw, BROW_Y, zb))
fb.quad('Structure', WHITE, (-xw, BROW_Y, zb - 0.28), (-xw, SALOON_FRONT, zb - 0.28), (xw, SALOON_FRONT, zb - 0.28), (xw, BROW_Y, zb - 0.28))
# The saloon front: tall dark panes under the brow, a door to the bow deck in the middle.
zf = zb - 0.28
for x0, x1 in ((-xw, -0.8), (0.8, xw)):
    fb.quad('Glazing', GLASS, (x0, SALOON_FRONT, DECK2 + 0.1), (x1, SALOON_FRONT, DECK2 + 0.1), (x1, SALOON_FRONT, zf), (x0, SALOON_FRONT, zf))
fb.quad('Glazing', GLASS, (-0.8, SALOON_FRONT, DECK2 + DOOR_H), (0.8, SALOON_FRONT, DECK2 + DOOR_H), (0.8, SALOON_FRONT, zf), (-0.8, SALOON_FRONT, zf))
for x in [-xw + k * 1.52 for k in range(12)] + [-0.8, 0.8, xw]:
    if abs(x) > xw + 1e-6: continue
    cyl('Glazing', FRAME, (x, SALOON_FRONT + 0.03, DECK2 + 0.05), (x, SALOON_FRONT + 0.03, zf), 0.04, 6)
for z in (DECK2 + 0.1, zf):
    cyl('Glazing', FRAME, (-xw, SALOON_FRONT + 0.03, z), (xw, SALOON_FRONT + 0.03, z), 0.035, 6)
cyl('Glazing', FRAME, (-0.8, SALOON_FRONT + 0.03, DECK2 + DOOR_H), (0.8, SALOON_FRONT + 0.03, DECK2 + DOOR_H), 0.04, 6)
aabb('Structure', WHITE, -SIDE + 0.02, SIDE - 0.02, SALOON_FRONT - 0.12, SALOON_FRONT, DECK2 - 0.1, DECK2 + 0.1)

# Inner faces of the thin side walls (the fairings round the sun deck and the cheeks round the bow
# deck), with the cheek glazing left open so the band reads as a windbreak from inside, and caps.
def inner_face(s, y_from, y_to, bottom, glazed):
    pts = [(x_, y_) for x_, y_ in PATH if y_from - 1e-6 <= y_ <= y_to + 1e-6 and x_ >= SIDE - 2.5]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        ia, ib = xa - 0.22, xb - 0.22
        za0, zb0, za1, zb1 = bottom(ya), bottom(yb), top_line(ya), top_line(yb)
        spans = [(za0, zb0, za1, zb1)]
        if glazed and band_top((ya + yb) / 2) > SILL2 + 0.02:
            spans = [(za0, zb0, min(za1, SILL2), min(zb1, SILL2)), (max(za0, band_top(ya)), max(zb0, band_top(yb)), za1, zb1)]
        for a0, b0, a1, b1 in spans:
            if a1 - a0 < 1e-4 and b1 - b0 < 1e-4: continue
            P = [(s * ia, ya, a0), (s * ia, ya, a1), (s * ib, yb, b1), (s * ib, yb, b0)]
            if s < 0: P = [P[0], P[3], P[2], P[1]]
            fb.quad('Skin', WHITE, *P)
        C = [(s * xa, ya, za1), (s * xb, yb, zb1), (s * ib, yb, zb1), (s * ia, ya, za1)]
        if s < 0: C = [C[0], C[3], C[2], C[1]]
        fb.quad('Skin', WHITE, *C)
for s in (1, -1):
    inner_face(s, SUPER_AFT - 0.3, UPPER_AFT - 0.002, lambda y: DECK3, False)
    inner_face(s, CHEEK_Y0, STEM_TOP, lambda y: DECK2 if y > SALOON_FRONT else roof_z(y), False)

# A white coaming round the bow deck edge, capping the navy bows.
for s in (1, -1):
    ths = [0.6 + 0.4 * k / 30 for k in range(31)]
    pts = []
    for t in ths:
        th = math.pi / 2 * t
        pts.append((s * (SIDE + 0.015) * max(0.0, math.cos(th)) ** (1 / 3), BOW_ROUND + (BOW - BOW_ROUND + 0.015) * max(0.0, math.sin(th)) ** (1 / 3)))
    pts = [p_ for p_ in pts if p_[1] >= 24.3]
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        P = [(xa, ya, DECK2 - 0.28), (xb, yb, DECK2 - 0.28), (xb, yb, DECK2 + 0.06), (xa, ya, DECK2 + 0.06)]
        if s < 0: P = [P[0], P[3], P[2], P[1]]
        fb.quad('Skin', WHITE, *P)
# The bow deck, out to the rounded deck edge.
bow = [(half_beam(y) - 0.02, y) for y in [SALOON_FRONT + (BOW - SALOON_FRONT) * k / 40 for k in range(41)]]
deck_outline = [(x_, y_) for x_, y_ in bow] + [(-x_, y_) for x_, y_ in reversed(bow)]
fill('Structure', DECKGREY, [(x_, y_, DECK2) for x_, y_ in deck_outline], (0, 0, 1))
fill('Structure', DECKGREY, [(x_, y_, DECK2 - 0.35) for x_, y_ in deck_outline], (0, 0, -1))

# ---- 5. the bridge deckhouse: flush sides, a raked, rounded front, the window band, the roof ---
def up_plan(z):
    """Plan of the deckhouse's rounded front at height z: from the port side where it leaves the
    flush wall, round the port corner, across the front and round to the starboard side."""
    rake = 0.6 * min(1.0, max(0.0, (z - SILL3) / (HEAD3 - SILL3)))
    pts = []
    for k in range(17):                                    # port corner
        a = math.pi - math.pi / 2 * k / 16
        pts.append((-SIDE + R_UP + R_UP * math.cos(a), CHEEK_Y0 + R_UP * math.sin(a)))
    for k in range(1, 16):                                 # the front, bulging a little
        t = k / 16
        pts.append((-SIDE + R_UP + (2 * SIDE - 2 * R_UP) * t, UP_FRONT + 0.35 * math.sin(math.pi * t)))
    for k in range(17):                                    # starboard corner
        a = math.pi / 2 - math.pi / 2 * k / 16
        pts.append((SIDE - R_UP + R_UP * math.cos(a), CHEEK_Y0 + R_UP * math.sin(a)))
    return [(x, CHEEK_Y0 + (y - CHEEK_Y0) * (1 - rake / (UP_FRONT + 0.35 - CHEEK_Y0))) for x, y in pts]

UP_LEVELS = [None, SILL3, (SILL3 + HEAD3) / 2, HEAD3, ROOF3]
up_rings = []
for z in UP_LEVELS:
    plan = up_plan(z if z is not None else DECK3)
    up_rings.append([(x, y, (roof_z(y) if z is None else z)) for x, y in plan])
for i in range(len(up_rings) - 1):
    glazed = UP_LEVELS[i] is not None and UP_LEVELS[i] >= SILL3 - 1e-6 and UP_LEVELS[i + 1] <= HEAD3 + 1e-6
    for j in range(len(up_rings[i]) - 1):
        a, b, c, d = up_rings[i][j], up_rings[i][j + 1], up_rings[i + 1][j + 1], up_rings[i + 1][j]
        fb.quad('Glazing' if glazed else 'Skin', GLASS if glazed else WHITE, a, d, c, b)
mid_j = len(up_rings[1]) // 2
for j in list(range(mid_j + 2, len(up_rings[1]), 3)) + list(range(mid_j - 2, -1, -3)):   # window posts, a pane dead ahead
    cyl('Glazing', FRAME, up_rings[1][j], up_rings[3][j], 0.045, 6)
for i in (1, 3):
    for a, b in zip(up_rings[i], up_rings[i][1:]):
        cyl('Glazing', FRAME, a, b, 0.035, 6)
# The roof over the whole deckhouse, and the visor lip round it.
roof_plan = [(-SIDE, UPPER_AFT)] + [(x, y) for x, y, _ in up_rings[-1]] + [(SIDE, UPPER_AFT)]
fill('Structure', WHITE, [(x, y, ROOF3) for x, y in roof_plan], (0, 0, 1))
fill('Interior', LINING, [(x * 0.97, y - 0.05, ROOF3 - 0.3) for x, y in roof_plan], (0, 0, -1))
edge = roof_plan
for (xa, ya), (xb, yb) in zip(edge, edge[1:]):
    dx, dy = xb - xa, yb - ya
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L                               # outward: this outline runs clockwise seen from above
    oa, pa, ob, pb = xa + nx * 0.3, ya + ny * 0.3, xb + nx * 0.3, yb + ny * 0.3
    fb.quad('Structure', WHITE, (xa, ya, ROOF3 + 0.001), (xb, yb, ROOF3 + 0.001), (ob, pb, ROOF3 + 0.001), (oa, pa, ROOF3 + 0.001))
    fb.quad('Structure', WHITE, (oa, pa, ROOF3 - 0.22), (ob, pb, ROOF3 - 0.22), (ob, pb, ROOF3), (oa, pa, ROOF3))
    fb.quad('Structure', WHITE, (xa, ya, ROOF3 - 0.22), (oa, pa, ROOF3 - 0.22), (ob, pb, ROOF3 - 0.22), (xb, yb, ROOF3 - 0.22))
# The aft wall, glazed like the sides, with a door out to the sun deck.
for x0, x1 in ((-SIDE, -0.7), (0.7, SIDE)):
    aabb('Structure', WHITE, x0, x1, UPPER_AFT, UPPER_AFT + 0.12, DECK3, SILL3)
    aabb('Structure', WHITE, x0, x1, UPPER_AFT, UPPER_AFT + 0.12, HEAD3, ROOF3)
    for xa, xb in ((x0, x0 + 0.35), (x1 - 0.35, x1)):
        aabb('Structure', WHITE, xa, xb, UPPER_AFT, UPPER_AFT + 0.12, SILL3, HEAD3)
    fb.quad('Glazing', GLASS, (x0 + 0.35, UPPER_AFT, SILL3), (x0 + 0.35, UPPER_AFT, HEAD3), (x1 - 0.35, UPPER_AFT, HEAD3), (x1 - 0.35, UPPER_AFT, SILL3))
    for k in range(6):
        x = x0 + 0.35 + (x1 - x0 - 0.7) * k / 5
        cyl('Glazing', FRAME, (x, UPPER_AFT - 0.02, SILL3), (x, UPPER_AFT - 0.02, HEAD3), 0.035, 6)
    for z in (SILL3, HEAD3):
        cyl('Glazing', FRAME, (x0 + 0.35, UPPER_AFT - 0.02, z), (x1 - 0.35, UPPER_AFT - 0.02, z), 0.03, 6)
aabb('Structure', WHITE, -0.7, 0.7, UPPER_AFT, UPPER_AFT + 0.12, DECK3 + 2.1, ROOF3)
aabb('Structure', OFFWHITE, -0.82, -0.7, UPPER_AFT - 0.05, UPPER_AFT, DECK3, DECK3 + 2.2)
aabb('Structure', OFFWHITE, 0.7, 0.82, UPPER_AFT - 0.05, UPPER_AFT, DECK3, DECK3 + 2.2)
aabb('Structure', OFFWHITE, -0.82, 0.82, UPPER_AFT - 0.05, UPPER_AFT, DECK3 + 2.1, DECK3 + 2.2)
aabb('Interior', RUBBER, -SIDE + 0.2, SIDE - 0.2, UPPER_AFT + 0.12, CHEEK_Y0 + 3.8, DECK3, DECK3 + 0.02)

# ---- 6. colliders and stations (declared here; filled in as each part is built) -------------
COLLIDERS, stations = [], {}
def col(kind, centre, half): COLLIDERS.append((kind, tuple(centre), tuple(half)))
def colbox(kind, x0, x1, y0, y1, z0, z1):
    col(kind, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2))
def station(name, at): stations[name] = pivot(name, at)

# ---- 7. rails, deck gear and top-side fittings -----------------------------------------------
RAIL_MESH = glassy(material('RailMesh', (0.55, 0.57, 0.58), 0.6, 0.4), 0.3, 0.0)
FROSTED = material('FrostedGlass', (0.46, 0.49, 0.52), 0.0, 0.25)
FLOOD = material('Floodlight', (1.0, 0.97, 0.9), 0.0, 0.3, 2.0)
HYPALON = material('HypalonGrey', (0.23, 0.25, 0.27), 0.0, 0.7)
ROPE_Y = material('RopeYellow', (0.85, 0.62, 0.02), 0.0, 0.8)
ROPE_W = material('RopeWhite', (0.8, 0.8, 0.76), 0.0, 0.8)
RED = material('FireRed', (0.75, 0.04, 0.03), 0.0, 0.4)
MAGENTA = material('LifejacketBox', (0.86, 0.3, 0.05), 0.0, 0.45)   # SOLAS orange GRP (was magenta)

def railing(g, pts, bottom, height=1.1, every=1.5, top_z=None, infill=True):
    """A stainless ship's rail along plan points: posts at a steady pitch, a top rail, two lower
    rails, a toe rail and a mesh infill. bottom is a number or f(x, y) for the deck under each
    point; the top rail sits `height` above it, or level at top_z when given."""
    zb = bottom if callable(bottom) else (lambda x, y: bottom)
    P = [(x, y, zb(x, y)) for x, y in pts]
    T = [(x, y, top_z if top_z is not None else z + height) for x, y, z in P]
    rail(g, STAINLESS, T, 0.03, 8)
    for f in (0.36, 0.7):
        rail(g, STAINLESS, [(x, y, z + (t - z) * f) for (x, y, z), (_, _, t) in zip(P, T)], 0.017, 6)
    rail(g, STAINLESS, [(x, y, z + 0.08) for x, y, z in P], 0.017, 6)
    acc = 0.0
    for (a, ta), (b, tb) in zip(zip(P, T), zip(P[1:], T[1:])):
        seg = math.dist(a[:2], b[:2])
        while acc <= seg:
            f = acc / seg if seg else 0
            x, y = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            z0, z1 = a[2] + (b[2] - a[2]) * f, ta[2] + (tb[2] - ta[2]) * f
            cyl(g, STAINLESS, (x, y, z0), (x, y, z1), 0.024, 8)
            acc += every
        acc -= seg
    if infill:
        verts, faces = [], []
        for i, ((x, y, z), (_, _, t)) in enumerate(zip(P, T)):
            verts += [(x, y, z + 0.1), (x, y, t - 0.05)]
            if i: faces.append((2 * i - 2, 2 * i, 2 * i + 1, 2 * i - 1))
        sheet(g, RAIL_MESH, verts, faces)
    for (x, y, z), (_, _, t) in ((P[0], T[0]), (P[-1], T[-1])):
        cyl(g, STAINLESS, (x, y, z), (x, y, t), 0.03, 8)

def mirror(s, pts): return [(s * x, y) for x, y in pts]

def bow_outline(inset, t0=0.0, t1=1.0, n=40):
    """The rounded bow deck edge (a superellipse), starboard half from the side (t0) to the centre."""
    a, b = SIDE - inset, BOW - BOW_ROUND - inset
    pts = []
    for k in range(n + 1):
        th = math.pi / 2 * (t0 + (t1 - t0) * k / n)
        pts.append((a * max(0.0, math.cos(th)) ** (1 / 3), BOW_ROUND + b * max(0.0, math.sin(th)) ** (1 / 3)))
    return pts

# Wing tops: the outer rail round the aft corner and forward to the fairing, the inner rail over the
# vehicle deck, the aft rail; the sun deck's aft rail over the cars.
for s in (1, -1):
    outer = [(WING_IN + 0.15 + (SIDE - R_AFT - WING_IN - 0.15) * k / 4, STERN + 0.12) for k in range(4)]
    outer += [(SIDE - R_AFT + (R_AFT - 0.12) * math.cos(a), STERN + R_AFT + (R_AFT - 0.12) * math.sin(a)) for a in [-math.pi / 2 + math.pi / 2 * k / 8 for k in range(9)]]
    outer += [(SIDE - 0.12, y) for y in (STERN + R_AFT + 0.5, SUPER_AFT - 0.35)]
    railing('Rails', mirror(s, outer), DECK3)
    railing('Rails', mirror(s, [(WING_IN + 0.1, STERN + 4.4), (WING_IN + 0.1, SUPER_AFT - 0.06)]), DECK3)
    colbox('solid', min(s * (SIDE - 0.18), s * (SIDE - 0.06)), max(s * (SIDE - 0.18), s * (SIDE - 0.06)), STERN + 0.2, SUPER_AFT - 0.3, DECK3, DECK3 + 1.1)
    colbox('solid', min(s * WING_IN, s * (WING_IN + 0.18)), max(s * WING_IN, s * (WING_IN + 0.18)), STERN, SUPER_AFT, DECK3, DECK3 + 1.1)
    colbox('solid', min(s * WING_IN, s * SIDE), max(s * WING_IN, s * SIDE), STERN, STERN + 0.2, DECK3, DECK3 + 1.1)
railing('Rails', [(-WING_IN, SUPER_AFT - 0.06), (WING_IN, SUPER_AFT - 0.06)], DECK3, every=1.65)
colbox('solid', -WING_IN, WING_IN, SUPER_AFT - 0.2, SUPER_AFT, DECK3, DECK3 + 1.1)
# The bow rail: round the rounded deck edge, standing on the cheek tops where they fall below it.
th0 = math.asin(max(0.0, min(1.0, ((CHEEK_Y0 + (SILL3 - DECK2 - 1.1) / SLOPE - BOW_ROUND) / (BOW - BOW_ROUND)) ** 3)))
bow_rail = bow_outline(0.14, th0 / (math.pi / 2), 1.0, 36)
bow_rail = [(-x, y) for x, y in bow_rail] + bow_rail[-2::-1]
railing('Rails', bow_rail, lambda x, y: max(DECK2, cheek_top(y) if y < STEM_TOP else DECK2), top_z=DECK2 + 1.1, every=1.4)
for (xa, ya), (xb, yb) in zip(bow_rail, bow_rail[1:]):
    colbox('solid', min(xa, xb) - 0.06, max(xa, xb) + 0.06, min(ya, yb) - 0.06, max(ya, yb) + 0.06, DECK2, DECK2 + 1.1)

# Her diesels exhaust through the transoms: a pair of outlets on each hull, sooty round them.
SOOT = material('Soot', (0.02, 0.02, 0.02), 0.0, 0.9)
for x in (-HULL_C, HULL_C):
    for dx in (-0.55, 0.55):
        cyl('Hull', BLACK, (x + dx, STERN + 0.4, 1.35), (x + dx, STERN - 0.12, 1.35), 0.2, 16)
        fb.annulus('Hull', STEEL, (x + dx, STERN - 0.12, 1.35), (0, -1, 0), 0.19, 0.26, 0.05, 16)
    aabb('Hull', SOOT, x - 1.1, x + 1.1, STERN - 0.035, STERN - 0.03, 1.05, 2.3)
# Stair houses on the wing tops, where the promenade stairs come up (white, a door facing forward), over
# the whole flight so there is headroom from its foot (z -19.9) to its head (z -15.74).
for s in (1, -1):
    X = lambda x: s * x
    # walls and a roof, not a closed box (its floor face capped the stair and it was empty inside)
    for a0, a1, b0, b1, z0_ in ((7.95, 8.0, -19.95, -14.6, DECK3), (6.75, 6.8, -19.95, -14.6, DECK3), (6.75, 8.0, -19.95, -19.9, DECK3),
                                (6.75, 6.95, -14.66, -14.6, DECK3), (7.8, 8.0, -14.66, -14.6, DECK3), (6.75, 8.0, -14.66, -14.6, DECK3 + 2.02),
                                (6.75, 8.0, -19.95, -14.6, DECK3 + 2.3)):
        aabb('Structure', WHITE, min(X(a0), X(a1)), max(X(a0), X(a1)), b0, b1, z0_, DECK3 + 2.35)
    aabb('Structure', WHITE, min(X(6.7), X(8.05)), max(X(6.7), X(8.05)), -20.0, -14.55, DECK3 + 2.35, DECK3 + 2.45)
    # inside: laminate linings, a lined ceiling with a light; the door frame, sill, and the leaf held open inboard
    for a0, a1, b0, b1 in ((6.8, 6.82, -19.9, -14.66), (7.93, 7.95, -19.9, -14.66), (6.8, 7.95, -19.9, -19.88)):
        aabb('Interior', LAMWALL, min(X(a0), X(a1)), max(X(a0), X(a1)), b0, b1, DECK3 - 0.3, DECK3 + 2.3)
    for a0, a1 in ((6.8, 6.95), (7.8, 7.95)):
        aabb('Interior', LAMWALL, min(X(a0), X(a1)), max(X(a0), X(a1)), -14.68, -14.66, DECK3, DECK3 + 2.3)
    aabb('Interior', LAMWALL, min(X(6.8), X(7.95)), max(X(6.8), X(7.95)), -14.68, -14.66, DECK3 + 2.02, DECK3 + 2.3)
    aabb('Interior', LINING, min(X(6.8), X(7.95)), max(X(6.8), X(7.95)), -19.9, -14.66, DECK3 + 2.27, DECK3 + 2.29)
    aabb('Interior', CEILING_LIGHT, min(X(7.1), X(7.65)), max(X(7.1), X(7.65)), -17.6, -16.4, DECK3 + 2.25, DECK3 + 2.27)
    for a0, a1 in ((6.92, 6.96), (7.79, 7.83)):
        aabb('Fittings', STEEL, min(X(a0), X(a1)), max(X(a0), X(a1)), -14.72, -14.56, DECK3, DECK3 + 2.04)
    aabb('Fittings', STEEL, min(X(6.92), X(7.83)), max(X(6.92), X(7.83)), -14.72, -14.56, DECK3 + 2.0, DECK3 + 2.04)
    aabb('Fittings', STEEL, min(X(6.95), X(7.8)), max(X(6.95), X(7.8)), -14.7, -14.56, DECK3, DECK3 + 0.018)
    aabb('Fittings', WHITE, min(X(7.86), X(7.91)), max(X(7.86), X(7.91)), -15.54, -14.74, DECK3 + 0.02, DECK3 + 1.98)
    aabb('Fittings', STEEL, min(X(7.85), X(7.86)), max(X(7.85), X(7.86)), -15.52, -14.76, DECK3 + 0.04, DECK3 + 0.32)
    aabb('Fittings', BLACK, min(X(7.852), X(7.86)), max(X(7.852), X(7.86)), -15.3, -15.0, DECK3 + 1.3, DECK3 + 1.75)
    cyl('Fittings', STEEL, (X(7.86), -15.42, DECK3 + 1.02), (X(7.81), -15.42, DECK3 + 1.02), 0.009, 8)
    cyl('Fittings', STEEL, (X(7.81), -15.42, DECK3 + 1.02), (X(7.81), -15.28, DECK3 + 1.02), 0.011, 8)
    aabb('Fittings', YELLOW, min(X(6.9), X(7.85)), max(X(6.9), X(7.85)), -14.6, -14.55, DECK3 + 2.0, DECK3 + 2.08)
    aabb('Fittings', FLOOD, min(X(7.3), X(7.5)), max(X(7.3), X(7.5)), -14.56, -14.5, DECK3 + 2.15, DECK3 + 2.25)
    # portholes down both long faces, a drip rail under the roof edge, a grab rail on the outboard
    # face, and a louvred vent in the after end
    for xf, out in ((8.0, 1), (6.75, -1)):
        for y in (-18.9, -17.1):
            cyl('Fittings', FRAME, (X(xf), y, DECK3 + 1.62), (X(xf + out * 0.04), y, DECK3 + 1.62), 0.21, 20)
            cyl('Glazing', GLASS, (X(xf + out * 0.04), y, DECK3 + 1.62), (X(xf + out * 0.045), y, DECK3 + 1.62), 0.16, 20)
        aabb('Fittings', STEEL, min(X(xf), X(xf + out * 0.06)), max(X(xf), X(xf + out * 0.06)), -19.95, -14.6, DECK3 + 2.24, DECK3 + 2.28)
    cyl('Fittings', STEEL, (X(8.1), -19.5, DECK3 + 1.05), (X(8.1), -15.1, DECK3 + 1.05), 0.022, 8)
    for y in (-19.5, -17.3, -15.1):
        cyl('Fittings', STEEL, (X(8.0), y, DECK3 + 1.05), (X(8.1), y, DECK3 + 1.05), 0.015, 6)
    aabb('Fittings', FRAME, min(X(7.05), X(7.7)), max(X(7.05), X(7.7)), -19.99, -19.95, DECK3 + 1.55, DECK3 + 2.0)
    for k in range(6):
        z_ = DECK3 + 1.6 + k * 0.07
        aabb('Fittings', STEEL, min(X(7.08), X(7.67)), max(X(7.08), X(7.67)), -20.02, -19.99, z_, z_ + 0.025)
    for x0_, x1_, y0_, y1_ in ((6.7, 8.05, -20.0, -19.9), (6.7, 6.8, -19.95, -14.6), (7.95, 8.05, -19.95, -14.6), (6.7, 6.95, -14.7, -14.55), (7.8, 8.05, -14.7, -14.55)):
        colbox('solid', min(X(x0_), X(x1_)), max(X(x0_), X(x1_)), y0_, y1_, DECK3, DECK3 + 2.35)
    colbox('walk', min(X(6.8), X(7.95)), max(X(6.8), X(7.95)), -15.74, -14.6, DECK3 - 0.3, DECK3)

# Liferaft canisters in their cradles along the wing tops, straps and hydrostatic releases.
for s, ys_ in ((-1, (-11.8, -9.4, -7.0, -4.6)), (1, (-11.8, -9.4))):   # clear of the stair house doors (z -14.6)
    for y in ys_:
        x = s * 7.95
        cyl('Fittings', WHITE, (x, y - 0.68, DECK3 + 0.55), (x, y + 0.68, DECK3 + 0.55), 0.36, 20)
        for b in (-0.4, 0.4):
            fb.torus('Fittings', BLACK, (x, y + b, DECK3 + 0.55), (0, 1, 0), 0.365, 0.018, 20, 5)
        for b in (-0.5, 0.5):
            aabb('Fittings', STEEL, x - 0.4, x + 0.4, y + b - 0.04, y + b + 0.04, DECK3, DECK3 + 0.3)
        aabb('Fittings', RED, x - 0.06, x + 0.06, y - 0.8, y - 0.72, DECK3 + 0.2, DECK3 + 0.38)
        colbox('solid', x - 0.4, x + 0.4, y - 0.75, y + 0.75, DECK3, DECK3 + 0.95)

# The rescue boat on the starboard wing top, launched by a white davit crane at the saloon's corner.
BOAT_X, BOAT_Y = 7.75, -2.9
rib_rings = []
for i in range(25):
    t = i / 24; y = BOAT_Y - 2.4 + 4.8 * t
    w = 0.95 * min(1.0, (1 - t) * 3.2 + 0.25) ** 0.6 * (0.8 + 0.2 * math.sin(math.pi * t))
    keel = DECK3 + 0.72 + 0.25 * max(0, t - 0.7) / 0.3
    rib_rings.append([(BOAT_X + w * math.sin(a) * (0.55 + 0.45 * abs(math.sin(a))), y, keel + 0.55 * (1 - math.cos(a)) ** 0.9) for a in [math.pi * (k / 16 - 0.5) for k in range(17)]])
rv, rf = [], []
for r in rib_rings: rv.extend(r)
for i in range(len(rib_rings) - 1):
    for j in range(16):
        a = i * 17 + j
        rf.append((a, a + 1, a + 18, a + 17))
fb.add('Boat', ORANGE, rv, rf)
collar = [(BOAT_X + 0.95 * math.cos(math.tau * k / 40), BOAT_Y + 0.1 + 2.4 * math.sin(math.tau * k / 40), DECK3 + 1.33) for k in range(41)]
rail('Boat', HYPALON, collar, 0.2, 10)
aabb('Boat', OFFWHITE, BOAT_X - 0.25, BOAT_X + 0.25, BOAT_Y + 0.05, BOAT_Y + 0.55, DECK3 + 1.2, DECK3 + 1.7)
aabb('Boat', BLACK, BOAT_X - 0.2, BOAT_X + 0.2, BOAT_Y + 0.5, BOAT_Y + 0.56, DECK3 + 1.55, DECK3 + 1.85)
aabb('Boat', BLACK, BOAT_X - 0.18, BOAT_X + 0.18, BOAT_Y - 2.75, BOAT_Y - 2.4, DECK3 + 0.9, DECK3 + 1.75)
for y in (BOAT_Y - 1.4, BOAT_Y + 1.4):
    aabb('Boat', STEEL, BOAT_X - 0.7, BOAT_X + 0.7, y - 0.09, y + 0.09, DECK3, DECK3 + 0.8)
colbox('solid', BOAT_X - 1.05, BOAT_X + 1.05, BOAT_Y - 2.6, BOAT_Y + 2.6, DECK3, DECK3 + 1.6)
DAVIT = (7.9, SUPER_AFT + 0.7)
cyl('Boat', WHITE, (DAVIT[0], DAVIT[1], DECK3), (DAVIT[0], DAVIT[1], DECK3 + 1.5), 0.34, 24)
cyl('Boat', WHITE, (DAVIT[0], DAVIT[1], DECK3 + 1.5), (DAVIT[0], DAVIT[1], DECK3 + 1.9), 0.42, 24)
fb.beam('Boat', WHITE, (DAVIT[0], DAVIT[1], DECK3 + 1.85), (BOAT_X, BOAT_Y + 0.3, DECK3 + 5.4), 0.34, 0.42)
fb.beam('Boat', WHITE, (BOAT_X, BOAT_Y + 0.3, DECK3 + 5.4), (BOAT_X, BOAT_Y - 0.1, DECK3 + 5.25), 0.26, 0.3)
cyl('Boat', STAINLESS, (DAVIT[0], DAVIT[1] - 0.3, DECK3 + 1.2), ((DAVIT[0] + BOAT_X) / 2, (DAVIT[1] + BOAT_Y) / 2 + 0.4, DECK3 + 3.4), 0.08, 12)
cyl('Boat', BLACK, (BOAT_X, BOAT_Y - 0.1, DECK3 + 5.1), (BOAT_X, BOAT_Y - 0.1, DECK3 + 1.9), 0.012, 6)
aabb('Boat', YELLOW, BOAT_X - 0.1, BOAT_X + 0.1, BOAT_Y - 0.2, BOAT_Y, DECK3 + 1.8, DECK3 + 2.0)
cyl('Boat', STEEL, (DAVIT[0] - 0.3, DAVIT[1], DECK3 + 1.2), (DAVIT[0] + 0.3, DAVIT[1], DECK3 + 1.2), 0.26, 20)
colbox('solid', DAVIT[0] - 0.45, DAVIT[0] + 0.45, DAVIT[1] - 0.45, DAVIT[1] + 0.45, DECK3, DECK3 + 1.9)

# Flagstaffs at the aft corners and a house flag, lifebuoys on the rails.
for s in (1, -1):
    x, y = s * (SIDE - 0.55), STERN + 0.55
    cyl('Fittings', WHITE, (x, y, DECK3), (x, y, DECK3 + 3.6), 0.04, 10)
    fb.sphere('Fittings', WHITE, (x, y, DECK3 + 3.62), 0.06, 10, 5)
    flag = []
    for i in range(9):
        u = i / 8
        for j in range(5):
            flag.append((x + s * 0.06 * math.sin(u * 4.0) * u, y - 1.1 * u, DECK3 + 3.5 - 0.7 * j / 4))
    fl = [(i * 5 + j, i * 5 + j + 1, (i + 1) * 5 + j + 1, (i + 1) * 5 + j) for i in range(8) for j in range(4)]
    sheet('Livery', TEAL if s > 0 else NAVY, flag, fl)
def lifebuoy(c, axis):
    fb.torus('Fittings', ORANGE, c, axis, 0.3, 0.07, 28, 8)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        ax = Vector(axis).normalized(); u, v = fb._frame(ax)
        p = Vector(c) + (u * math.cos(a) + v * math.sin(a)) * 0.3
        fb.torus('Fittings', WHITE, tuple(p), tuple(u * -math.sin(a) + v * math.cos(a)), 0.075, 0.02, 10, 4)
for s in (1, -1):
    for y in (-21.0, -7.2):
        lifebuoy((s * (SIDE - 0.1), y, DECK3 + 0.7), (1, 0, 0))
    lifebuoy((s * (SIDE + 0.03), 8.2, DECK3 + 0.5), (1, 0, 0))
    aabb('Fittings', BAND_BLACK, min(s * SIDE, s * (SIDE + 0.02)), max(s * SIDE, s * (SIDE + 0.02)), 10.4, 10.95, DECK3 + 0.3, DECK3 + 0.75)
    lifebuoy((s * 4.8, BOW - 0.5, DECK2 + 0.72), (0, 1, 0.0))

# ---- 8. the hull sides: ladders, doors, frosted ports, freeing ports, strake, fairleads -------
for s in (1, -1):
    X = lambda x: s * x
    # Ladders from the wing top down past the windows and the boot top toward the waterline.
    for dy in (-0.23, 0.23):
        cyl('Fittings', STAINLESS, (X(SIDE + 0.2), LADDER_Y + dy, 0.8), (X(SIDE + 0.2), LADDER_Y + dy, DECK3 + 1.1), 0.028, 8)
    for k in range(int((DECK3 + 0.2 - 1.0) / 0.3)):
        z = 1.0 + k * 0.3
        cyl('Fittings', STAINLESS, (X(SIDE + 0.2), LADDER_Y - 0.23, z), (X(SIDE + 0.2), LADDER_Y + 0.23, z), 0.018, 6)
    for z in (1.2, 3.0, 5.0, 7.2, 9.5):
        for dy in (-0.23, 0.23):
            cyl('Fittings', STAINLESS, (X(SIDE), LADDER_Y + dy, z), (X(SIDE + 0.2), LADDER_Y + dy, z), 0.022, 6)
    hoop = [(X(SIDE + 0.2 + 0.2 * (1 - math.cos(a))), LADDER_Y + 0.26 * math.sin(a), DECK3 + 1.1) for a in [math.pi * (k / 10 - 0.5) for k in range(11)]]
    rail('Fittings', STAINLESS, hoop, 0.02, 6)
    # The gangway doors: a raised frame round the opening, the leaf swung in, the sill out to the gangway.
    yd0, yd1 = DOOR_Y - DOOR_W / 2, DOOR_Y + DOOR_W / 2
    for y0_, y1_ in ((yd0 - 0.1, yd0), (yd1, yd1 + 0.1)):
        aabb('Fittings', OFFWHITE, min(X(SIDE - 0.05), X(SIDE + 0.05)), max(X(SIDE - 0.05), X(SIDE + 0.05)), y0_, y1_, DECK2 - 0.05, DECK2 + DOOR_H + 0.1)
    aabb('Fittings', OFFWHITE, min(X(SIDE - 0.05), X(SIDE + 0.05)), max(X(SIDE - 0.05), X(SIDE + 0.05)), yd0 - 0.1, yd1 + 0.1, DECK2 + DOOR_H, DECK2 + DOOR_H + 0.1)
    aabb('Fittings', STEEL, min(X(SIDE - 1.45), X(SIDE - 0.1)), max(X(SIDE - 1.45), X(SIDE - 0.1)), yd0 + 0.02, yd0 + 0.07, DECK2 + 0.02, DECK2 + DOOR_H - 0.05)
    aabb('Fittings', FROSTED, min(X(SIDE - 1.0), X(SIDE - 0.55)), max(X(SIDE - 1.0), X(SIDE - 0.55)), yd0 + 0.07, yd0 + 0.08, DECK2 + 1.3, DECK2 + 1.9)
    # the leaf dressed as a real door: a raised border, glazing both faces in a rubber gasket, kick plates, a lever
    # handle on a rose each side, three hinges on the jamb
    lx0, lx1 = SIDE - 1.45, SIDE - 0.1
    aabb('Fittings', FROSTED, min(X(SIDE - 1.0), X(SIDE - 0.55)), max(X(SIDE - 1.0), X(SIDE - 0.55)), yd0 + 0.01, yd0 + 0.02, DECK2 + 1.3, DECK2 + 1.9)
    for yf, sg in ((yd0 + 0.02, -1), (yd0 + 0.07, 1)):
        yo = yf + sg * 0.008
        for a0, a1, b0, b1 in ((lx0, lx1, DECK2 + 0.02, DECK2 + 0.08), (lx0, lx1, DECK2 + DOOR_H - 0.12, DECK2 + DOOR_H - 0.05),
                               (lx0, lx0 + 0.07, DECK2 + 0.02, DECK2 + DOOR_H - 0.05), (lx1 - 0.07, lx1, DECK2 + 0.02, DECK2 + DOOR_H - 0.05)):
            aabb('Fittings', STEEL, *xs(X(a0), X(a1)), *xs(yf, yo), b0, b1)
        for a0, a1, b0, b1 in ((SIDE - 1.03, SIDE - 0.52, 1.27, 1.3), (SIDE - 1.03, SIDE - 0.52, 1.9, 1.93), (SIDE - 1.03, SIDE - 1.0, 1.27, 1.93), (SIDE - 0.55, SIDE - 0.52, 1.27, 1.93)):
            aabb('Fittings', BLACK, *xs(X(a0), X(a1)), *xs(yf, yf + sg * 0.012), DECK2 + b0, DECK2 + b1)
        aabb('Fittings', STAINLESS, *xs(X(lx0 + 0.08), X(lx1 - 0.08)), *xs(yf, yf + sg * 0.004), DECK2 + 0.09, DECK2 + 0.36)
        hx = X(lx0 + 0.12)
        cyl('Fittings', STAINLESS, (hx, yf, DECK2 + 1.02), (hx, yf + sg * 0.012, DECK2 + 1.02), 0.03, 12)
        cyl('Fittings', STAINLESS, (hx, yf + sg * 0.012, DECK2 + 1.02), (hx, yf + sg * 0.055, DECK2 + 1.02), 0.009, 8)
        cyl('Fittings', STAINLESS, (hx, yf + sg * 0.055, DECK2 + 1.02), (X(lx0 + 0.26), yf + sg * 0.055, DECK2 + 1.02), 0.011, 8)
    for zh in (0.3, 1.05, 1.8):
        cyl('Fittings', STAINLESS, (X(SIDE - 0.09), yd0 + 0.045, DECK2 + zh), (X(SIDE - 0.09), yd0 + 0.045, DECK2 + zh + 0.12), 0.017, 8)
    aabb('Fittings', STEEL, min(X(SIDE - 0.25), X(GANGWAY_X)), max(X(SIDE - 0.25), X(GANGWAY_X)), yd0, yd1, DECK2 - 0.06, DECK2)
    aabb('Fittings', YELLOW, min(X(GANGWAY_X - 0.05), X(GANGWAY_X)), max(X(GANGWAY_X - 0.05), X(GANGWAY_X)), yd0, yd1, DECK2 - 0.06, DECK2 + 0.01)
    # Frosted ports high on the white band (washrooms and stores), each in a raised frame.
    for y in (-21.8, -9.6, -6.9, -3.3, 2.9, 12.6, 19.6):
        pts = [(u + 0.0, v + 6.8) for u, v in fb.rounded_rect(0.46, 0.82, 0.13, 3)]
        fb.plate('Fittings', OFFWHITE, [(v, u) for u, v in fb.rounded_rect(0.56, 0.92, 0.16, 3)], (X(SIDE + 0.001), y, 6.8), (0, 0, 1), (0, 1, 0), 0.035 if s > 0 else -0.035)
        fb.plate('Fittings', FROSTED, [(v, u) for u, v in fb.rounded_rect(0.44, 0.8, 0.12, 3)], (X(SIDE + 0.03), y, 6.8), (0, 0, 1), (0, 1, 0), 0.012 if s > 0 else -0.012)
    # Freeing ports along the boot top, each a dark slot with a white lip; the rubbing strake below.
    for k in range(15):
        y = -24.0 + k * 1.65
        aabb('Hull', OFFWHITE, min(X(SIDE), X(SIDE + 0.03)), max(X(SIDE), X(SIDE + 0.03)), y - 0.25, y + 0.25, NAVY_LINE + 0.06, NAVY_LINE + 0.34)
        aabb('Hull', BLACK, min(X(SIDE), X(SIDE + 0.04)), max(X(SIDE), X(SIDE + 0.04)), y - 0.2, y + 0.2, NAVY_LINE + 0.1, NAVY_LINE + 0.3)
    cyl('Hull', NAVY, (X(SIDE + 0.02), STERN + 0.4, NAVY_LINE - 0.02), (X(SIDE + 0.02), 21.4, NAVY_LINE - 0.02), 0.085, 10)
    # Fairleads and panama chocks at the deck edge near the bow, white.
    for y in (18.3, 22.4):
        zc = max(DECK2, cheek_top(y))
        aabb('Fittings', OFFWHITE, min(X(half_beam(y) - 0.3), X(half_beam(y) + 0.02)), max(X(half_beam(y) - 0.3), X(half_beam(y) + 0.02)), y - 0.35, y + 0.35, zc - 0.05, zc + 0.3)
        aabb('Fittings', BLACK, min(X(half_beam(y) - 0.31), X(half_beam(y) + 0.03)), max(X(half_beam(y) - 0.31), X(half_beam(y) + 0.03)), y - 0.2, y + 0.2, zc + 0.05, zc + 0.2)
# The bow face: two mooring openings between the stem tops.
for x in (-3.4, 3.4):
    aabb('Hull', BLACK, x - 0.3, x + 0.3, STEM_TOP - 0.02, STEM_TOP + 0.02, DECK2 - 0.45, DECK2 - 0.15)
    aabb('Hull', NAVY, x - 0.38, x + 0.38, STEM_TOP - 0.01, STEM_TOP + 0.05, DECK2 - 0.52, DECK2 - 0.45)

# ---- 9. the bow deck: winches, capstans, bitts, lines, the outside stair up to the brow -------
for s in (1, -1):
    X = lambda x: s * x
    # Mooring winch: a white drum with its line wound on, on a base, with a brake band.
    wx, wy = X(3.2), 20.4
    aabb('BowGear', STEEL, wx - 0.75, wx + 0.75, wy - 0.55, wy + 0.55, DECK2, DECK2 + 0.25)
    cyl('BowGear', WHITE, (wx - 0.55, wy, DECK2 + 0.75), (wx + 0.55, wy, DECK2 + 0.75), 0.3, 28)
    for k in range(9):
        cyl('BowGear', ROPE_W, (wx - 0.5 + k * 0.115, wy, DECK2 + 0.75), (wx - 0.4 + k * 0.115, wy, DECK2 + 0.75), 0.36 + 0.02 * (k % 2), 20)
    for dx in (-0.6, 0.6):
        cyl('BowGear', WHITE, (wx + dx - 0.035, wy, DECK2 + 0.75), (wx + dx + 0.035, wy, DECK2 + 0.75), 0.55, 32)
        aabb('BowGear', WHITE, wx + dx - 0.05 + (0.12 if dx > 0 else -0.12), wx + dx + 0.05 + (0.12 if dx > 0 else -0.12), wy - 0.3, wy + 0.3, DECK2 + 0.2, DECK2 + 0.8)
        fb.torus('BowGear', BLACK, (wx + dx + (0.06 if dx > 0 else -0.06), wy, DECK2 + 0.75), (1, 0, 0), 0.5, 0.025, 32, 6)
    gx = wx + (0.95 if wx > 0 else -0.95)
    aabb('BowGear', WHITE, gx - 0.25, gx + 0.25, wy - 0.35, wy + 0.35, DECK2 + 0.2, DECK2 + 0.95)
    cyl('BowGear', STEEL, (gx - 0.2, wy, DECK2 + 1.1), (gx + 0.2, wy, DECK2 + 1.1), 0.2, 20)
    cyl('BowGear', BLACK, (gx, wy - 0.35, DECK2 + 0.6), (gx, wy - 0.55, DECK2 + 0.6), 0.09, 12)
    colbox('solid', wx - 0.75, wx + 0.75, wy - 0.6, wy + 0.6, DECK2, DECK2 + 1.35)
    # Capstan and the bitts.
    cx, cy = X(2.2), 23.2
    cyl('BowGear', STEEL, (cx, cy, DECK2), (cx, cy, DECK2 + 0.55), 0.28, 24, r1=0.24)
    cyl('BowGear', BLACK, (cx, cy, DECK2 + 0.55), (cx, cy, DECK2 + 0.62), 0.32, 24)
    colbox('solid', cx - 0.35, cx + 0.35, cy - 0.35, cy + 0.35, DECK2, DECK2 + 0.6)
    for bx, by in ((X(5.6), 23.2), (X(6.9), 18.4)):
        for dy in (-0.3, 0.3):
            cyl('BowGear', BLACK, (bx, by + dy, DECK2), (bx, by + dy, DECK2 + 0.5), 0.14, 16)
            cyl('BowGear', BLACK, (bx, by + dy, DECK2 + 0.5), (bx, by + dy, DECK2 + 0.55), 0.18, 16)
        aabb('BowGear', BLACK, bx - 0.25, bx + 0.25, by - 0.5, by + 0.5, DECK2, DECK2 + 0.05)
        colbox('solid', bx - 0.25, bx + 0.25, by - 0.5, by + 0.5, DECK2, DECK2 + 0.55)
    fb.coil('BowGear', ROPE_Y, (X(4.4), 21.9, DECK2), 0.42, 4, 0.032, 3)
    fb.coil('BowGear', ROPE_Y, (X(1.3), 21.0, DECK2), 0.35, 3, 0.03, 2)
aabb('BowGear', STEEL, -0.8, 0.8, 19.0, 20.1, DECK2, DECK2 + 0.12)                # forepeak hatch
aabb('BowGear', MAGENTA, -SIDE + 0.25, -SIDE + 0.55, 17.4, 18.2, DECK2 + 0.9, DECK2 + 1.7)
aabb('BowGear', RED, SIDE - 0.5, SIDE - 0.25, 17.6, 18.1, DECK2 + 0.8, DECK2 + 1.5)
# The outside stair on the port side, from the bow deck up along the cheek to the brow top.
ST_X0, ST_X1 = -SIDE + 0.3, -SIDE + 1.25
st_n, st_top_y = 14, BROW_Y + 0.1
st_rise = (roof_z(BROW_Y) - DECK2) / st_n
for k in range(st_n):
    y = st_top_y + (st_n - k - 0.5) * 0.28
    z = DECK2 + (k + 1) * st_rise
    aabb('BowGear', STEEL, ST_X0, ST_X1, y - 0.15, y + 0.15, z - 0.04, z)
    aabb('BowGear', YELLOW, ST_X0, ST_X1, y - 0.16, y - 0.13, z - 0.012, z)
    colbox('walk', ST_X0, ST_X1, y - 0.14, y + 0.14, DECK2, z)
for x in (ST_X1,):
    rail('BowGear', STAINLESS, [(x, st_top_y + st_n * 0.28, DECK2 + 1.0), (x, st_top_y, roof_z(BROW_Y) + 1.0)], 0.025, 8)
    for k in range(4):
        f = k / 3
        y = st_top_y + st_n * 0.28 * (1 - f)
        z = DECK2 + (roof_z(BROW_Y) - DECK2) * f
        cyl('BowGear', STAINLESS, (x, y, z), (x, y, z + 1.0), 0.022, 8)
for x0_, x1_, y0_, y1_ in ((ST_X0, ST_X1, st_top_y - 1.2, st_top_y),):
    colbox('walk', x0_, x1_, y0_, y1_, DECK2, roof_z(BROW_Y))

# ---- 10. the vehicle deck: lanes, lashing points, lights, hose cabinets ---------------------
for x in (-3.3, 0.0, 3.3):
    aabb('CarDeck', YELLOW, x - 0.06, x + 0.06, STERN + 1.2, FWD_BULKHEAD - 1.0, DECK1, DECK1 + 0.006)
for x in (-4.95, -1.65, 1.65, 4.95):
    for k in range(4):
        y = -18.0 + k * 9.0
        pts = [(x - 0.3, y), (x + 0.3, y), (x + 0.3, y + 1.0), (x + 0.6, y + 1.0), (x, y + 1.7), (x - 0.6, y + 1.0), (x - 0.3, y + 1.0)]
        fb.plate('CarDeck', OFFWHITE, pts, (0, 0, DECK1 + 0.001), (1, 0, 0), (0, 1, 0), 0.005)
for x in (-5.8, -3.3, -0.8, 0.8, 3.3, 5.8):
    for k in range(18):
        y = STERN + 1.8 + k * 2.4
        if y > FWD_BULKHEAD - 1.0: break
        cyl('CarDeck', STEEL, (x, y, DECK1), (x, y, DECK1 + 0.012), 0.07, 10)
for s in (1, -1):
    X = lambda x: s * x
    for k in range(11):
        y = STERN + 2.5 + k * 4.0
        if y > FWD_BULKHEAD - 1.0: break
        aabb('CarDeck', FLOOD, min(X(WING_IN - 0.06), X(WING_IN)), max(X(WING_IN - 0.06), X(WING_IN)), y - 0.4, y + 0.4, DECK1 + 3.2, DECK1 + 3.35)
        if k % 3 == 1 and y + 2.6 < FWD_BULKHEAD:
            aabb('CarDeck', RED, min(X(WING_IN - 0.25), X(WING_IN)), max(X(WING_IN - 0.25), X(WING_IN)), y + 1.2, y + 1.9, DECK1 + 1.1, DECK1 + 2.0)
    cyl('CarDeck', YELLOW, (X(WING_IN - 0.35), STERN + 1.0, DECK1 + 0.6), (X(WING_IN - 0.35), FWD_BULKHEAD - 1.0, DECK1 + 0.6), 0.06, 8)
    for k in range(12):
        y = STERN + 1.0 + k * (FWD_BULKHEAD - STERN - 2.0) / 11
        cyl('CarDeck', YELLOW, (X(WING_IN - 0.35), y, DECK1 + 0.6), (X(WING_IN), y, DECK1 + 0.6), 0.04, 6)
    # Under the saloon: beams and lights on the vehicle deck ceiling.
for k in range(10):
    y = SUPER_AFT + 0.8 + k * 1.9
    if y > FWD_BULKHEAD - 0.4: break
    aabb('CarDeck', STEEL, -WING_IN, WING_IN, y - 0.12, y + 0.12, DECK2 - 0.9, DECK2 - 0.45)
    for x in (-4.4, -1.5, 1.5, 4.4):
        aabb('CarDeck', FLOOD, x - 0.6, x + 0.6, y + 0.8, y + 0.95, DECK2 - 0.5, DECK2 - 0.46)
# Vehicle deck colliders: the deck for cars and walkers, its walls, the bulkhead, the stern bulwarks.
colbox('walk', -WING_IN, WING_IN, STERN, FWD_BULKHEAD, DECK1 - 0.3, DECK1)
colbox('car', -WING_IN, WING_IN, STERN, FWD_BULKHEAD, DECK1 - 0.3, DECK1)
for s in (1, -1):
    # The wing walls for cars run unbroken; walkers get their own walls with the stair doors (section 11).
    colbox('car', min(s * WING_IN, s * (WING_IN + 0.3)), max(s * WING_IN, s * (WING_IN + 0.3)), STERN, FWD_BULKHEAD, DECK1, DECK1 + 3.9)
    for kind in ('car', 'solid'):
        colbox(kind, min(s * RAMP_W / 2, s * WING_IN), max(s * RAMP_W / 2, s * WING_IN), STERN, STERN + 0.25, DECK1, DECK1 + 1.3)
    colbox('car', -WING_IN, WING_IN, FWD_BULKHEAD, FWD_BULKHEAD + 0.3, DECK1, DECK2 - 0.45)
colbox('solid', -WING_IN, WING_IN, FWD_BULKHEAD, FWD_BULKHEAD + 0.3, DECK1, DECK2 - 0.45)

# ---- 11. inside the wings: corridor, stairs from the vehicle deck and up to the wing top ------
LOW_Y0, LOW_Y1 = -8.2, -1.95           # stair from the vehicle deck to the corridor, rising forward
UP_Y0 = -19.9                          # stair from the corridor to the wing top, rising forward
RISE1, RISE2 = (DECK2 - DECK1) / 24, (DECK3 - DECK2) / 16
TREAD = material('StairTread', (0.3, 0.31, 0.32), 0.3, 0.6)
def flight(s, x0, x1, y0, z0, steps, rise, going=0.26):
    y1_, z1_ = y0 + steps * going, z0 + steps * rise
    for xs in (x0, x1):
        fb.hexa('Interior', STEEL, [(s * (xs - 0.02), y0, z0), (s * (xs + 0.02), y0, z0), (s * (xs + 0.02), y1_, z1_ - 0.25), (s * (xs - 0.02), y1_, z1_ - 0.25),
                                   (s * (xs - 0.02), y0, z0 + 0.3), (s * (xs + 0.02), y0, z0 + 0.3), (s * (xs + 0.02), y1_, z1_ + 0.05), (s * (xs - 0.02), y1_, z1_ + 0.05)])
    for k in range(steps):
        y = y0 + (k + 0.5) * going
        z = z0 + (k + 1) * rise
        aabb('Interior', TREAD, min(s * x0, s * x1), max(s * x0, s * x1), y - going / 2, y + going / 2, z - 0.05, z)
        lo, hi = min(s * x0, s * x1), max(s * x0, s * x1)
        aabb('Interior', TREAD, lo, hi, y - going / 2, y - going / 2 + 0.012, z - rise, z - 0.04)             # riser
        aabb('Props', STAINLESS, lo, hi, y - going / 2 - 0.004, y - going / 2 + 0.045, z - 0.04, z + 0.004)  # aluminium nosing
        aabb('Props', YELLOW, lo + 0.03, hi - 0.03, y - going / 2 + 0.006, y - going / 2 + 0.03, z + 0.004, z + 0.006)
        colbox('walk', min(s * x0, s * x1), max(s * x0, s * x1), y - going / 2, y + going / 2, z0, z)
    rail('Interior', STAINLESS, [(s * (x1 - 0.05), y0, z0 + 0.95), (s * (x1 - 0.05), y0 + steps * going, z0 + steps * rise + 0.95)], 0.025, 8)
    return y0 + steps * going
for s in (1, -1):
    X = lambda x: s * x
    # Corridor floor colliders round the two stairwells, the outer passage beside them.
    colbox('walk', min(X(WING_IN + 0.12), X(SIDE - 0.1)), max(X(WING_IN + 0.12), X(SIDE - 0.1)), STERN + 0.3, UP_Y0, DECK2 - 0.3, DECK2)
    colbox('walk', min(X(7.8), X(SIDE - 0.1)), max(X(7.8), X(SIDE - 0.1)), UP_Y0, LOW_Y1, DECK2 - 0.3, DECK2)
    colbox('walk', min(X(WING_IN + 0.12), X(SIDE - 0.1)), max(X(WING_IN + 0.12), X(SIDE - 0.1)), UP_Y0 + 16 * 0.26, LOW_Y0, DECK2 - 0.3, DECK2)
    colbox('walk', min(X(WING_IN + 0.12), X(SIDE - 0.1)), max(X(WING_IN + 0.12), X(SIDE - 0.1)), LOW_Y1, SUPER_AFT, DECK2 - 0.3, DECK2)
    # Wing top walkway colliders, leaving the upper stair's hatch open inside the stair house.
    colbox('walk', min(X(WING_IN), X(SIDE)), max(X(WING_IN), X(SIDE)), STERN, -19.95, DECK3 - 0.3, DECK3)
    colbox('walk', min(X(8.0), X(SIDE)), max(X(8.0), X(SIDE)), -19.95, -14.6, DECK3 - 0.3, DECK3)
    colbox('walk', min(X(WING_IN), X(SIDE)), max(X(WING_IN), X(SIDE)), -14.6, SUPER_AFT, DECK3 - 0.3, DECK3)
    # The stairs: up from a door in the vehicle deck wall, and on up into the stair house.
    flight(s, WING_IN + 0.14, 7.75, LOW_Y0, DECK1, 24, RISE1)
    flight(s, WING_IN + 0.14, 7.75, UP_Y0, DECK2, 16, RISE2)
    colbox('walk', min(X(WING_IN - 0.05), X(7.8)), max(X(WING_IN - 0.05), X(7.8)), LOW_Y0 - 1.4, LOW_Y0, DECK1 - 0.3, DECK1)
    aabb('Fittings', YELLOW, min(X(WING_IN - 0.03), X(WING_IN)), max(X(WING_IN - 0.03), X(WING_IN)), LOW_Y0 - 1.4, LOW_Y0, DECK1 + 2.1, DECK1 + 2.2)
    # Walls for walkers: the outer skin with the door gap, the inner wall with the stair door.
    colbox('solid', min(X(SIDE - 0.1), X(SIDE + 0.05)), max(X(SIDE - 0.1), X(SIDE + 0.05)), STERN, DOOR_Y - DOOR_W / 2, DECK2, DECK3)
    colbox('solid', min(X(SIDE - 0.1), X(SIDE + 0.05)), max(X(SIDE - 0.1), X(SIDE + 0.05)), DOOR_Y + DOOR_W / 2, SUPER_AFT, DECK2, DECK3)
    colbox('solid', min(X(WING_IN - 0.05), X(WING_IN + 0.12)), max(X(WING_IN - 0.05), X(WING_IN + 0.12)), STERN, LOW_Y0 - 1.3, DECK1, DECK3)
    colbox('solid', min(X(WING_IN - 0.05), X(WING_IN + 0.12)), max(X(WING_IN - 0.05), X(WING_IN + 0.12)), LOW_Y0 - 0.1, SUPER_AFT, DECK1, DECK3)
    colbox('solid', min(X(WING_IN - 0.05), X(WING_IN + 0.12)), max(X(WING_IN - 0.05), X(WING_IN + 0.12)), LOW_Y0 - 1.3, LOW_Y0 - 0.1, DECK1 + 2.1, DECK3)
    colbox('solid', min(X(WING_IN), X(SIDE)), max(X(WING_IN), X(SIDE)), STERN, STERN + 0.15, DECK2, DECK3)
    colbox('solid', min(X(WING_IN - 0.05), X(WING_IN + 0.12)), max(X(WING_IN - 0.05), X(WING_IN + 0.12)), SUPER_AFT, FWD_BULKHEAD, DECK1, DECK2 - 0.45)
    # The stairwell from the car deck: a lined, lit shaft inside the wing, floored at the door, with
    # the flight rising forward along its outboard wall to the corridor.
    W0, W1, Y0, Y1 = WING_IN + 0.12, 7.86, LOW_Y0 - 1.45, LOW_Y1
    aabb('Interior', TREAD, min(X(W0), X(W1)), max(X(W0), X(W1)), Y0, LOW_Y0, DECK1 - 0.05, DECK1 + 0.01)
    aabb('Interior', LINING, min(X(7.8), X(W1)), max(X(7.8), X(W1)), Y0, Y1, DECK1, DECK2 - 0.3)
    aabb('Interior', LINING, min(X(W0), X(W1)), max(X(W0), X(W1)), Y0 - 0.06, Y0, DECK1, DECK2 - 0.3)
    aabb('Interior', LINING, min(X(W0), X(W1)), max(X(W0), X(W1)), Y1, Y1 + 0.06, DECK1, DECK2 - 0.3)
    aabb('Interior', LINING, min(X(W0), X(W1)), max(X(W0), X(W1)), LOW_Y0, Y1, DECK1 - 0.05, DECK1)
    colbox('solid', min(X(7.8), X(W1)), max(X(7.8), X(W1)), Y0, Y1, DECK1, DECK2 - 0.3)
    colbox('solid', min(X(W0), X(W1)), max(X(W0), X(W1)), Y0 - 0.06, Y0, DECK1, DECK2 - 0.3)
    rail('Interior', STAINLESS, [(X(7.72), LOW_Y0, DECK1 + 0.95), (X(7.72), LOW_Y1, DECK2 + 0.95)], 0.025, 8)
    for yl in (LOW_Y0 - 0.7, LOW_Y0 + 2.5, LOW_Y0 + 5.0):
        aabb('Interior', CEILING_LIGHT, min(X(7.76), X(7.8)), max(X(7.76), X(7.8)), yl - 0.3, yl + 0.3, DECK1 + 2.3 + ( yl - LOW_Y0 ) * 0.7, DECK1 + 2.42 + ( yl - LOW_Y0 ) * 0.7)
        aabb('Interior', STAINLESS, min(X(7.765), X(7.8)), max(X(7.765), X(7.8)), yl - 0.33, yl + 0.33, DECK1 + 2.27 + ( yl - LOW_Y0 ) * 0.7, DECK1 + 2.45 + ( yl - LOW_Y0 ) * 0.7)
    aabb('Interior', material('ExitSign', (0.02, 0.5, 0.2), 0.0, 0.3, 0.45), min(X(WING_IN - 0.04), X(WING_IN - 0.02)), max(X(WING_IN - 0.04), X(WING_IN - 0.02)), LOW_Y0 - 1.1, LOW_Y0 - 0.3, DECK1 + 2.3, DECK1 + 2.55)
    # The door sill out to the gangway, walkable.
    colbox('walk', min(X(SIDE - 0.3), X(GANGWAY_X)), max(X(SIDE - 0.3), X(GANGWAY_X)), DOOR_Y - DOOR_W / 2, DOOR_Y + DOOR_W / 2, DECK2 - 0.3, DECK2)
    # Ceiling lights down the corridor.
    for k in range(13):
        y = STERN + 1.5 + k * 1.95
        if y > SUPER_AFT - 0.5: break
        aabb('Interior', CEILING_LIGHT, min(X(7.6), X(8.2)), max(X(7.6), X(8.2)), y - 0.3, y + 0.3, DECK3 - 0.33, DECK3 - 0.31)
    # Benches along the corridor windows.
    for y in (-23.0, -12.8, -10.8, -8.6):
        aabb('Interior', CARPET, min(X(SIDE - 0.65), X(SIDE - 0.1)), max(X(SIDE - 0.65), X(SIDE - 0.1)), y - 0.8, y + 0.8, DECK2, DECK2 + 0.45)
        colbox('solid', min(X(SIDE - 0.65), X(SIDE - 0.1)), max(X(SIDE - 0.65), X(SIDE - 0.1)), y - 0.8, y + 0.8, DECK2, DECK2 + 0.45)
        # three cushions with piped edges on a dark plinth
        aabb('Props', ARM, min(X(SIDE - 0.62), X(SIDE - 0.1)), max(X(SIDE - 0.62), X(SIDE - 0.1)), y - 0.78, y + 0.78, DECK2, DECK2 + 0.12)
        aabb('Props', PIPING, min(X(SIDE - 0.665), X(SIDE - 0.645)), max(X(SIDE - 0.665), X(SIDE - 0.645)), y - 0.8, y + 0.8, DECK2 + 0.43, DECK2 + 0.45)
        for yc in (y - 0.27, y + 0.27):
            aabb('Props', ARM, min(X(SIDE - 0.655), X(SIDE - 0.1)), max(X(SIDE - 0.655), X(SIDE - 0.1)), yc - 0.008, yc + 0.008, DECK2 + 0.3, DECK2 + 0.453)

# ---- 12. the saloon: seats in rows, the kiosk, lounges, washrooms --------------------------
FABRIC = material('SeatFabric', (0.03, 0.06, 0.16), 0.0, 0.8)
HEADREST = material('HeadrestTeal', (0.0, 0.32, 0.34), 0.0, 0.6)
LAMINATE = material('CounterLaminate', (0.85, 0.83, 0.78), 0.0, 0.3)
TEAK = material('Teak', (0.13, 0.055, 0.02), 0.0, 0.38)
FRIDGE = material('FridgeGlow', (0.7, 0.85, 1.0), 0.0, 0.2, 1.0)
MENU = material('MenuBoard', (0.9, 0.55, 0.15), 0.0, 0.3, 1.2)
SCREEN_DARK = material('ScreenGlass', (0.01, 0.012, 0.015), 0.2, 0.08)
SHELL = material('SeatShell', (0.1, 0.11, 0.12), 0.0, 0.45)
SIGN_WHITE = material('SignWhite', (0.88, 0.88, 0.86), 0.0, 0.45)
SLATE = material('MenuSlate', (0.02, 0.022, 0.025), 0.0, 0.5)
SEAT_PLATES = []
def pillow(g, mat, O, M, c, w, d, h, r, e, caps=(True, True)):
    """A moulded or upholstered part: a rounded-rectangle section (w across local x, h up local z, corner radius r)
    swept d along local y, both ends eased in over e so every edge is rounded. Placed at O + M @ (c + v)."""
    ring = []
    for cx, cz, a0 in ((w / 2 - r, h / 2 - r, 0.0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi), (w / 2 - r, -h / 2 + r, 1.5 * math.pi)):
        for k in range(4):
            t = a0 + (math.pi / 2) * k / 3
            ring.append((cx + r * math.cos(t), cz + r * math.sin(t)))
    m = len(ring); C = Vector(c); verts = []
    prof = [(0.0, 0.55), (1.0, 0.0)]
    rows = [(-d / 2 + e * t, k) for t, k in prof] + [(d / 2 - e * t, k) for t, k in reversed(prof)]
    for yv, k in rows:
        sx, sz = (w - 2 * r * k) / w, (h - 2 * r * k) / h
        verts += [O + M @ (C + Vector((x * sx, yv, z * sz))) for x, z in ring]
    faces = []
    for j in range(len(rows) - 1):
        for i in range(m):
            i2 = (i + 1) % m
            faces.append((j * m + i, (j + 1) * m + i, (j + 1) * m + i2, j * m + i2))
    verts += [O + M @ (C + Vector((0, -d / 2, 0))), O + M @ (C + Vector((0, d / 2, 0)))]
    c0, c1, last = len(verts) - 2, len(verts) - 1, (len(rows) - 1) * m
    for i in range(m):
        i2 = (i + 1) % m
        if caps[0]: faces.append((c0, i, i2))
        if caps[1]: faces.append((c1, last + i2, last + i))
    fb.add(g, mat, verts, faces)
def seat_unit(x, y):
    """Three moulded ferry seats on a stainless beam: an upholstered pan with a waterfall front, a contoured back in a
    moulded shell with a rolled lip and a grab handle for the row behind, a teal headrest, padded armrests on bent tube."""
    aabb('Seats', STAINLESS, x - 0.81, x + 0.81, y - 0.25, y + 0.25, DECK2 + 0.19, DECK2 + 0.25)
    for leg in (-0.7, 0.7):
        aabb('Seats', STAINLESS, x + leg - 0.03, x + leg + 0.03, y - 0.22, y + 0.22, DECK2, DECK2 + 0.2)
        aabb('Seats', STAINLESS, x + leg - 0.06, x + leg + 0.06, y - 0.26, y + 0.26, DECK2, DECK2 + 0.012)
    I3 = Matrix.Identity(3); M = Matrix.Rotation(math.radians(-8), 3, 'X'); Mp = Matrix.Rotation(math.radians(4), 3, 'X')
    for k in range(3):
        sx = x - 0.54 + k * 0.54
        fb.box('Seats', SHELL, (sx, y + 0.02, DECK2 + 0.27), (0.48, 0.48, 0.04))
        pillow('Seats', FABRIC, Vector((sx, y + 0.03, DECK2 + 0.335)), Mp, (0, 0, 0), 0.47, 0.48, 0.11, 0.045, 0.06)
        B = Vector((sx, y - 0.25, DECK2 + 0.72))
        pillow('Seats', FABRIC, B, M, (0, 0.005, -0.03), 0.46, 0.1, 0.64, 0.06, 0.04, caps=(False, True))   # rear end is inside the shell
        pillow('Seats', SHELL, B, M, (0, -0.058, 0.02), 0.52, 0.035, 0.76, 0.07, 0.015)
        pillow('Seats', HEADREST, B, M, (0, 0.03, 0.31), 0.42, 0.1, 0.17, 0.055, 0.035, caps=(False, True))
        fb.rail('Props', STAINLESS, [B + M @ Vector(v) for v in ((-0.15, -0.06, 0.36), (-0.15, -0.12, 0.39), (0.15, -0.12, 0.39), (0.15, -0.06, 0.36))], 0.012, 8)
        fb.box('Props', SIGN_WHITE, B + M @ Vector((0, -0.077, 0.05)), (0.13, 0.004, 0.06), rx=math.radians(-8))
        SEAT_PLATES.append((B + M @ Vector((0, -0.081, 0.05)), sx))
    for k in range(4):
        xa = x - 0.81 + k * 0.54
        pillow('Props', ARM, Vector((xa, y - 0.01, DECK2 + 0.575)), I3, (0, 0, 0), 0.075, 0.42, 0.05, 0.024, 0.04)
        fb.rail('Seats', STAINLESS, [Vector(v) for v in ((xa, y - 0.2, DECK2 + 0.25), (xa, y - 0.2, DECK2 + 0.55))] , 0.016, 8)
        fb.rail('Seats', STAINLESS, [Vector(v) for v in ((xa, y + 0.13, DECK2 + 0.25), (xa, y + 0.19, DECK2 + 0.4), (xa, y + 0.16, DECK2 + 0.55))], 0.016, 8)
    colbox('solid', x - 0.82, x + 0.82, y - 0.35, y + 0.28, DECK2, DECK2 + 1.1)
for r in range(11):
    y = 3.1 + r * 0.95
    for x in (-6.5, -3.0, 3.0, 6.5):
        seat_unit(x, y)
# Forward lounge: sofas facing the big front windows; tables.
OAK = material('OakLaminate', (0.3, 0.19, 0.1), 0.0, 0.35)
Mb = Matrix.Rotation(math.radians(12), 3, 'X')           # backs recline toward the stern (they face the bow windows)
for x in (-5.6, -1.9, 1.9, 5.6):
    # A banquette: a dark plinth behind stainless kick plates, an upholstered base with three seat and three back
    # cushions, oak-laminate arms and back panel, a laminate capping rail with stainless edge trim along its top.
    aabb('Seats', ARM, x - 1.4, x + 1.4, 14.5, 15.36, DECK2, DECK2 + 0.14)
    for y0_, y1_ in ((15.36, 15.365), (14.455, 14.46)):
        aabb('Seats', STAINLESS, x - 1.4, x + 1.4, y0_, y1_, DECK2 + 0.005, DECK2 + 0.135)
    aabb('Seats', FABRIC, x - 1.4, x + 1.4, 14.52, 15.42, DECK2 + 0.14, DECK2 + 0.3)
    aabb('Seats', FABRIC, x - 1.4, x + 1.4, 14.52, 14.66, DECK2 + 0.3, DECK2 + 0.94)
    aabb('Seats', OAK, x - 1.47, x + 1.47, 14.46, 14.52, DECK2 + 0.14, DECK2 + 0.98)
    aabb('Seats', LAMINATE, x - 1.49, x + 1.49, 14.44, 14.72, DECK2 + 0.98, DECK2 + 1.01)
    for y0_, y1_ in ((14.434, 14.44), (14.72, 14.726)):
        aabb('Seats', STAINLESS, x - 1.49, x + 1.49, y0_, y1_, DECK2 + 0.975, DECK2 + 1.013)
    for xe in (-1.0, 1.0):
        aabb('Seats', OAK, *xs(x + xe * 1.4, x + xe * 1.47), 14.52, 15.42, DECK2 + 0.14, DECK2 + 0.6)
        aabb('Seats', LAMINATE, *xs(x + xe * 1.395, x + xe * 1.49), 14.52, 15.44, DECK2 + 0.6, DECK2 + 0.63)
        aabb('Seats', STAINLESS, *xs(x + xe * 1.49, x + xe * 1.496), 14.44, 15.44, DECK2 + 0.595, DECK2 + 0.633)
    for k in range(3):
        xc = x + (k - 1) * 0.933
        pillow('Seats', FABRIC, Vector((xc, 15.03, DECK2 + 0.36)), Matrix.Identity(3), (0, 0, 0), 0.925, 0.78, 0.12, 0.045, 0.05, caps=(False, True))
        pillow('Seats', FABRIC, Vector((xc, 14.76, DECK2 + 0.68)), Mb, (0, 0, 0), 0.925, 0.14, 0.5, 0.05, 0.04, caps=(False, True))
    # the table in front: laminate top with a teak edge band on two stainless pedestals
    fb.box('Seats', LAMINATE, (x, 15.95, DECK2 + 0.72), (1.2, 0.5, 0.03))
    for y0_, y1_ in ((15.69, 15.7), (16.2, 16.21)):
        aabb('Seats', TEAK, x - 0.61, x + 0.61, y0_, y1_, DECK2 + 0.695, DECK2 + 0.738)
    for xe in (-0.61, 0.6):
        aabb('Seats', TEAK, x + xe, x + xe + 0.01, 15.69, 16.21, DECK2 + 0.695, DECK2 + 0.738)
    for xp in (-0.38, 0.38):
        cyl('Seats', STAINLESS, (x + xp, 15.95, DECK2 + 0.02), (x + xp, 15.95, DECK2 + 0.705), 0.035, 12)
        cyl('Seats', BLACK, (x + xp, 15.95, DECK2), (x + xp, 15.95, DECK2 + 0.02), 0.17, 16)
    colbox('solid', x - 1.45, x + 1.45, 14.5, 15.45, DECK2, DECK2 + 1.0)
# The kiosk and cafe on the port side aft, washrooms to starboard aft.
aabb('Interior', LAMINATE, -6.2, -2.4, 1.2, 2.0, DECK2, DECK2 + 1.05)
aabb('Interior', TEAK, -6.3, -2.3, 1.15, 2.1, DECK2 + 1.05, DECK2 + 1.1)
aabb('Interior', STAINLESS, -5.6, -4.9, 0.75, 1.15, DECK2 + 1.1, DECK2 + 1.65)
aabb('Interior', SLATE, -6.0, -2.6, 0.62, 0.66, DECK2 + 1.95, DECK2 + 2.5)
colbox('solid', -6.3, -2.3, 0.6, 2.1, DECK2, DECK2 + 1.1)
aabb('Interior', LINING, 2.4, 6.3, 0.62, 2.4, DECK2, DECK3 - 0.3)
for y in (0.9, 1.7):
    aabb('Interior', STEEL, 2.36, 2.4, y - 0.35, y + 0.35, DECK2 + 0.02, DECK2 + 2.05)
colbox('solid', 2.4, 6.3, 0.62, 2.4, DECK2, DECK3 - 0.3)
for x in (-3.0, 3.0):
    for y in (6.0, 11.0):
        aabb('Interior', SCREEN_DARK, x - 0.6, x + 0.6, y - 0.04, y + 0.04, DECK3 - 0.95, DECK3 - 0.28)
for k in range(8):
    for x in (-5.5, -1.8, 1.8, 5.5):
        aabb('Interior', CEILING_LIGHT, x - 1.2, x + 1.2, 1.4 + k * 1.9, 1.55 + k * 1.9, DECK3 - 0.32, DECK3 - 0.3)
# Saloon colliders: the floor, its outer walls, the glazed front with the bow door, the aft wall.
colbox('walk', -SIDE + 0.1, SIDE - 0.1, SUPER_AFT, SALOON_FRONT, DECK2 - 0.3, DECK2)
for s in (1, -1):
    colbox('solid', min(s * (SIDE - 0.1), s * (SIDE + 0.05)), max(s * (SIDE - 0.1), s * (SIDE + 0.05)), SUPER_AFT, SALOON_FRONT, DECK2, DECK3)
    colbox('solid', min(s * 0.8, s * SIDE), max(s * 0.8, s * SIDE), SALOON_FRONT - 0.1, SALOON_FRONT + 0.1, DECK2, roof_z(SALOON_FRONT))
colbox('solid', -WING_IN, WING_IN, SUPER_AFT - 0.12, SUPER_AFT, DECK2, DECK3)
# The sun deck on the saloon roof and the bow deck, for walkers.
colbox('walk', -SIDE + 0.25, SIDE - 0.25, SUPER_AFT, UPPER_AFT, DECK3 - 0.3, DECK3)
for s in (1, -1):
    colbox('solid', min(s * (SIDE - 0.25), s * SIDE), max(s * (SIDE - 0.25), s * SIDE), SUPER_AFT - 0.3, UPPER_AFT, DECK3, DECK3 + FAIRING)
colbox('walk', -SIDE + 0.25, SIDE - 0.25, SALOON_FRONT, BOW_ROUND + 0.5, DECK2 - 0.3, DECK2)
for k in range(8):
    y0_ = BOW_ROUND + 0.5 + k * 0.62
    colbox('walk', -half_beam(y0_ + 0.62) + 0.25, half_beam(y0_ + 0.62) - 0.25, y0_, y0_ + 0.62, DECK2 - 0.3, DECK2)
for s in (1, -1):
    for k in range(10):
        y0_ = SALOON_FRONT + k * (BOW_ROUND + 1.8 - SALOON_FRONT) / 10
        y1_ = y0_ + (BOW_ROUND + 1.8 - SALOON_FRONT) / 10
        colbox('solid', min(s * (half_beam(y1_) - 0.25), s * half_beam(y1_)), max(s * (half_beam(y1_) - 0.25), s * half_beam(y1_)), y0_, y1_, DECK2, max(DECK2 + 1.1, cheek_top(y1_)))

# ---- 13. the bridge deckhouse inside: the lounge aft, the bridge forward ---------------------
RUBBERFLOOR = material('BridgeFloor', (0.05, 0.055, 0.06), 0.0, 0.8)
CONSOLE = material('ConsoleGrey', (0.16, 0.17, 0.18), 0.2, 0.45)
BRASS = material('Brass', (0.8, 0.5, 0.17), 1.0, 0.3)       # warm: a yellower F0 turns olive under the blue sky
SCREEN_RADAR = material('ScreenRadar', (0.05, 0.55, 0.3), 0.0, 0.2, 1.6)
SCREEN_CHART = material('ScreenChart', (0.1, 0.3, 0.75), 0.0, 0.2, 1.4)
LEATHER = material('ChairLeather', (0.05, 0.05, 0.055), 0.0, 0.5)
BRIDGE_BULKHEAD = 10.5
for x0, x1 in ((-SIDE + 0.1, -0.6), (0.6, SIDE - 0.1)):
    aabb('Interior', LINING, x0, x1, BRIDGE_BULKHEAD - 0.06, BRIDGE_BULKHEAD + 0.06, DECK3, ROOF3 - 0.3)
aabb('Interior', LINING, -0.6, 0.6, BRIDGE_BULKHEAD - 0.06, BRIDGE_BULKHEAD + 0.06, DECK3 + 2.1, ROOF3 - 0.3)
# Upper lounge: benches along the sides under the windows, tables.
for s in (1, -1):
    for k in range(2):
        y = 6.6 + k * 2.1
        fb.box('Interior', FABRIC, (s * 8.2, y, DECK3 + 0.25), (1.1, 1.7, 0.5))
        fb.box('Interior', FABRIC, (s * 8.72, y, DECK3 + 0.75), (0.2, 1.7, 0.6))
        cyl('Interior', LAMINATE, (s * 7.0, y, DECK3 + 0.7), (s * 7.0, y, DECK3 + 0.74), 0.42, 24)
        cyl('Interior', STAINLESS, (s * 7.0, y, DECK3), (s * 7.0, y, DECK3 + 0.7), 0.05, 10)
        colbox('solid', min(s * 7.6, s * SIDE), max(s * 7.6, s * SIDE), y - 0.85, y + 0.85, DECK3, DECK3 + 0.5)
        colbox('solid', min(s * 6.55, s * 7.45), max(s * 6.55, s * 7.45), y - 0.45, y + 0.45, DECK3, DECK3 + 0.74)
# The console: a desk following the front windows, its top sloping toward the helmsman.
def inset_plan(z, d):
    plan = up_plan(z)
    out = []
    for i, (x, y) in enumerate(plan):
        a, b = plan[max(0, i - 1)], plan[min(len(plan) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        out.append((x + dy / L * d, y - dx / L * d))
    return [(x, y) for x, y in out if y > BRIDGE_BULKHEAD + 1.2]
CZ = DECK3 + 0.95
outer_c, inner_c = inset_plan(CZ, 0.25), inset_plan(CZ, 1.15)
m = min(len(outer_c), len(inner_c))
outer_c, inner_c = outer_c[:m], inner_c[:m]
# Each bay is a closed solid, not two loose sheets: a lone single-sided sheet puts its own lit face in the shadow
# map and its sloping top shadowed itself into rows of dashes.
for (oa, ob), (ia, ib) in zip(zip(outer_c, outer_c[1:]), zip(inner_c, inner_c[1:])):
    ring, tops = [ia, ib, ob, oa], [CZ, CZ, CZ + 0.17, CZ + 0.17]
    if sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(ring, ring[1:] + ring[:1])) < 0: ring, tops = ring[::-1], tops[::-1]
    fb.hexa('Bridge', CONSOLE, [(x, y, DECK3) for x, y in ring] + [(x, y, zt) for (x, y), zt in zip(ring, tops)])
mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(outer_c, inner_c)]
kinds = [SCREEN_CHART, SCREEN_RADAR, SCREEN_DARK, SCREEN_CHART, SCREEN_RADAR, SCREEN_CHART, SCREEN_DARK, SCREEN_RADAR]
for k, kind in enumerate(kinds):
    i = int(len(mid) * (0.12 + 0.76 * k / (len(kinds) - 1)))
    (x0, y0), (x1, y1) = mid[i], mid[min(i + 1, len(mid) - 1)]
    h = math.atan2(y1 - y0, x1 - x0)
    fb.box('Bridge', CONSOLE, (x0, y0, CZ + 0.38), (0.64, 0.05, 0.44), rz=h, rx=math.radians(-18))
    fb.box('Bridge', kind, (x0 - math.sin(h) * 0.03, y0 + math.cos(h) * -0.03, CZ + 0.38), (0.58, 0.02, 0.38), rz=h, rx=math.radians(-18))
for x, y in mid[::3]:
    colbox('solid', x - 0.45, x + 0.45, y - 0.45, y + 0.45, DECK3, CZ + 0.2)
cyl('Bridge', BRASS, (0, HELM_Y + 1.0, CZ + 0.1), (0, HELM_Y + 1.0, CZ + 0.32), 0.16, 32)
fb.torus('Bridge', BRASS, (0, HELM_Y + 1.0, CZ + 0.34), (0, 0, 1), 0.13, 0.03, 32, 8)
aabb('Bridge', CONSOLE, -1.8, 1.8, HELM_Y + 0.4, HELM_Y + 1.2, ROOF3 - 0.64, ROOF3 - 0.3)
for k in range(5):
    aabb('Bridge', BLACK, -1.4 + k * 0.7 - 0.25, -1.4 + k * 0.7 + 0.25, HELM_Y + 0.38, HELM_Y + 0.41, ROOF3 - 0.6, ROOF3 - 0.36)
    aabb('Bridge', SCREEN_CHART if k % 2 else SCREEN_RADAR, -1.4 + k * 0.7 - 0.22, -1.4 + k * 0.7 + 0.22, HELM_Y + 0.37, HELM_Y + 0.38, ROOF3 - 0.57, ROOF3 - 0.39)
aabb('Bridge', TEAK, -4.45, -2.75, BRIDGE_BULKHEAD + 0.4, BRIDGE_BULKHEAD + 1.35, DECK3 + 0.9, DECK3 + 0.95)
aabb('Bridge', CONSOLE, -4.4, -2.8, BRIDGE_BULKHEAD + 0.45, BRIDGE_BULKHEAD + 1.3, DECK3, DECK3 + 0.9)
colbox('solid', -4.45, -2.75, BRIDGE_BULKHEAD + 0.4, BRIDGE_BULKHEAD + 1.35, DECK3, DECK3 + 0.95)
for s in (-1, 1):
    x, y = s * 2.3, HELM_Y - 0.1
    cyl('Bridge', STAINLESS, (x, y, DECK3), (x, y, DECK3 + 0.7), 0.06, 12)
    cyl('Bridge', STAINLESS, (x, y, DECK3), (x, y, DECK3 + 0.06), 0.3, 20)
    fb.box('Bridge', LEATHER, (x, y, DECK3 + 0.75), (0.56, 0.52, 0.12))
    fb.box('Bridge', LEATHER, (x, y - 0.26, DECK3 + 1.1), (0.52, 0.12, 0.62))
    for a in (-1, 1):
        fb.box('Bridge', LEATHER, (x + a * 0.3, y, DECK3 + 0.92), (0.07, 0.42, 0.06))
    colbox('solid', x - 0.3, x + 0.3, y - 0.35, y + 0.3, DECK3, DECK3 + 1.3)
# The ship's wheel on its own pivot, the pedestal, and the twin throttles on theirs.
WHEEL = (0.0, HELM_Y, DECK3 + 1.02)
cyl('Bridge', STAINLESS, (0, HELM_Y + 0.25, DECK3), (0, HELM_Y + 0.25, DECK3 + 0.96), 0.14, 24)
cyl('Bridge', STAINLESS, (0, HELM_Y + 0.25, DECK3), (0, HELM_Y + 0.25, DECK3 + 0.08), 0.34, 28)
cyl('Bridge', STAINLESS, (0, HELM_Y + 0.29, DECK3 + 1.02), (0, HELM_Y + 0.05, DECK3 + 1.02), 0.1, 20)
W = 'P:HelmWheel'
fb.torus(W, TEAK, WHEEL, (0, 1, 0), 0.5, 0.035, 72, 10)
fb.torus(W, BRASS, WHEEL, (0, 1, 0), 0.2, 0.02, 48, 8)
cyl(W, BRASS, (0, HELM_Y + 0.08, WHEEL[2]), (0, HELM_Y - 0.08, WHEEL[2]), 0.08, 24)
for k in range(8):
    a = k * math.tau / 8
    c, sn = math.cos(a), math.sin(a)
    cyl(W, BRASS, (c * 0.07, HELM_Y, WHEEL[2] + sn * 0.07), (c * 0.5, HELM_Y, WHEEL[2] + sn * 0.5), 0.018, 8)
    cyl(W, TEAK, (c * 0.53, HELM_Y, WHEEL[2] + sn * 0.53), (c * 0.68, HELM_Y, WHEEL[2] + sn * 0.68), 0.03, 10)
    fb.sphere(W, TEAK, (c * 0.7, HELM_Y, WHEEL[2] + sn * 0.7), 0.036, 10, 5)
colbox('solid', -0.2, 0.2, HELM_Y + 0.05, HELM_Y + 0.45, DECK3, DECK3 + 1.24)
aabb('Bridge', CONSOLE, 0.7, 1.2, HELM_Y + 0.08, HELM_Y + 0.52, DECK3, DECK3 + 1.0)
aabb('Bridge', STAINLESS, 0.72, 1.18, HELM_Y + 0.09, HELM_Y + 0.51, DECK3 + 1.0, DECK3 + 1.07)
colbox('solid', 0.7, 1.2, HELM_Y + 0.08, HELM_Y + 0.52, DECK3, DECK3 + 1.0)
KNOB_R = material('KnobRed', (0.7, 0.05, 0.03), 0.0, 0.3)
KNOB_G = material('KnobGreen', (0.05, 0.5, 0.12), 0.0, 0.3)
for name, x, knob in (('ThrottlePort', 0.83, KNOB_R), ('ThrottleStarboard', 1.07, KNOB_G)):
    g = f'P:{name}'
    cyl(g, STAINLESS, (x, HELM_Y + 0.3, DECK3 + 1.08), (x, HELM_Y + 0.3, DECK3 + 1.38), 0.018, 8)
    cyl(g, knob, (x - 0.045, HELM_Y + 0.3, DECK3 + 1.4), (x + 0.045, HELM_Y + 0.3, DECK3 + 1.4), 0.04, 16)
for k in range(3):
    aabb('Bridge', CEILING_LIGHT, -1.8 + k * 1.8 - 0.25, -1.8 + k * 1.8 + 0.25, HELM_Y - 1.5, HELM_Y - 1.0, ROOF3 - 0.33, ROOF3 - 0.31)
# Wipers on the front panes, parked along the bottom of each pane with the motor boss at one end.
for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
    t = (x + SIDE - R_UP) / (2 * SIDE - 2 * R_UP)
    y0 = UP_FRONT + 0.35 * math.sin(math.pi * t) + 0.05
    cyl('Glazing', BLACK, (x - 0.55, y0, SILL3 + 0.07), (x + 0.5, y0, SILL3 + 0.07), 0.01, 6)
    cyl('Glazing', BLACK, (x - 0.6, y0, SILL3 + 0.05), (x - 0.6, y0 + 0.05, SILL3 + 0.05), 0.03, 10)
# Bridge deckhouse colliders: its floor, walls, the bulkhead with its door, the front.
colbox('walk', -SIDE + 0.15, SIDE - 0.15, UPPER_AFT, UP_FRONT - 0.2, DECK3 - 0.3, DECK3)
for s in (1, -1):
    colbox('solid', min(s * (SIDE - 0.1), s * (SIDE + 0.05)), max(s * (SIDE - 0.1), s * (SIDE + 0.05)), UPPER_AFT, CHEEK_Y0, DECK3, ROOF3)
    colbox('solid', min(s * 0.7, s * SIDE), max(s * 0.7, s * SIDE), UPPER_AFT, UPPER_AFT + 0.15, DECK3, ROOF3)
    colbox('solid', min(s * 0.6, s * SIDE), max(s * 0.6, s * SIDE), BRIDGE_BULKHEAD - 0.08, BRIDGE_BULKHEAD + 0.08, DECK3, ROOF3)
    for k in range(6):
        a = math.pi / 2 * k / 6
        x = s * (SIDE - R_UP + (R_UP - 0.2) * math.cos(a))
        y = CHEEK_Y0 + (R_UP - 0.2) * math.sin(a)
        colbox('solid', x - 0.4, x + 0.4, y - 0.4, y + 0.4, DECK3, ROOF3)
colbox('solid', -SIDE + R_UP, SIDE - R_UP, UP_FRONT - 0.1, UP_FRONT + 0.3, DECK3, ROOF3)

# ---- 14. the roof: mast, radars, searchlight, horn, domes, whips, navigation lights ---------
MAST_Y = 9.6
cyl('Mast', WHITE, (0, MAST_Y, ROOF3), (0, MAST_Y, ROOF3 + 3.6), 0.14, 16, r1=0.1)
cyl('Mast', WHITE, (0, MAST_Y, ROOF3 + 3.6), (0, MAST_Y, ROOF3 + 6.8), 0.08, 12, r1=0.05)
aabb('Mast', WHITE, -0.35, 0.35, MAST_Y - 0.35, MAST_Y + 0.35, ROOF3, ROOF3 + 0.3)
for z, w in ((ROOF3 + 3.0, 1.3), (ROOF3 + 4.9, 0.8)):
    cyl('Mast', WHITE, (-w, MAST_Y, z), (w, MAST_Y, z), 0.05, 10)
    for x in (-w, w):
        cyl('Mast', WHITE, (x, MAST_Y, z), (0, MAST_Y, z - 0.6), 0.025, 6)
RED_LIGHT = material('AllRoundRed', (0.9, 0.05, 0.03), 0.0, 0.3, 2.5)
WHITE_LIGHT = material('AllRoundWhite', (1.0, 1.0, 0.95), 0.0, 0.3, 3.0)
for z in (ROOF3 + 5.3, ROOF3 + 6.2):
    cyl('Mast', RED_LIGHT, (0.0, MAST_Y + 0.22, z - 0.12), (0.0, MAST_Y + 0.22, z + 0.12), 0.08, 12)
    aabb('Mast', WHITE, -0.05, 0.05, MAST_Y + 0.05, MAST_Y + 0.15, z - 0.03, z + 0.03)
cyl('Mast', WHITE_LIGHT, (0, MAST_Y, ROOF3 + 6.8), (0, MAST_Y, ROOF3 + 7.05), 0.07, 12)
for x in (-1.25, 1.25):
    cyl('Mast', WHITE_LIGHT, (x, MAST_Y + 0.12, ROOF3 + 3.05), (x, MAST_Y + 0.12, ROOF3 + 3.25), 0.06, 10)
    cyl('Mast', BLACK, (x, MAST_Y, ROOF3 + 3.05), (x, MAST_Y, ROOF3 + 4.6), 0.012, 6)
cyl('Mast', BLACK, (0.3, MAST_Y + 0.5, ROOF3 + 3.9), (0.3, MAST_Y + 1.2, ROOF3 + 3.9), 0.14, 16, r1=0.2)
cyl('Mast', BLACK, (0.3, MAST_Y + 0.15, ROOF3 + 3.9), (0.3, MAST_Y + 0.5, ROOF3 + 3.9), 0.06, 10)
# Radar scanners on their own pivots: the big one on a bracket off the mast, a small one forward.
def radar(name, centre, length):
    g = f'P:{name}'
    fb.box(g, OFFWHITE, (centre[0], centre[1], centre[2] + 0.2), (length, 0.24, 0.28))
    cyl(g, OFFWHITE, (centre[0], centre[1], centre[2] - 0.05), (centre[0], centre[1], centre[2] + 0.08), 0.12, 16)
aabb('Mast', WHITE, -0.45, 0.45, MAST_Y + 0.3, MAST_Y + 1.6, ROOF3 + 2.2, ROOF3 + 2.32)
cyl('Mast', WHITE, (0, MAST_Y + 0.1, ROOF3 + 1.4), (0, MAST_Y + 1.4, ROOF3 + 2.2), 0.05, 8)
cyl('Mast', OFFWHITE, (0, MAST_Y + 1.0, ROOF3 + 2.32), (0, MAST_Y + 1.0, ROOF3 + 2.6), 0.24, 20)
cyl('Mast', WHITE, (0, 12.6, ROOF3), (0, 12.6, ROOF3 + 1.2), 0.12, 16)
cyl('Mast', OFFWHITE, (0, 12.6, ROOF3 + 1.2), (0, 12.6, ROOF3 + 1.45), 0.22, 20)
radar_nodes = {'RadarX': ((0, MAST_Y + 1.0, ROOF3 + 2.62), 3.0), 'RadarS': ((0, 12.6, ROOF3 + 1.47), 2.0)}
for name, (c, length) in radar_nodes.items(): radar(name, c, length)
# Searchlight, satellite domes, GPS mushroom, whips, the loudhailer, vents on the roof.
SEARCH = material('SearchlightTeal', (0.25, 0.4, 0.42), 0.4, 0.4)
cyl('Mast', SEARCH, (-1.6, 14.0, ROOF3 + 0.5), (-1.6, 14.45, ROOF3 + 0.5), 0.25, 20)
cyl('Mast', FLOOD, (-1.6, 14.45, ROOF3 + 0.5), (-1.6, 14.48, ROOF3 + 0.5), 0.22, 20)
aabb('Mast', SEARCH, -1.72, -1.48, 14.1, 14.35, ROOF3, ROOF3 + 0.3)
for x, y in ((-3.0, 7.0), (3.0, 7.0)):
    cyl('Mast', WHITE, (x, y, ROOF3), (x, y, ROOF3 + 0.35), 0.12, 12)
    fb.sphere('Mast', OFFWHITE, (x, y, ROOF3 + 0.62), 0.4, 20, 10)
cyl('Mast', WHITE, (1.8, 12.4, ROOF3), (1.8, 12.4, ROOF3 + 0.4), 0.04, 8)
fb.sphere('Mast', OFFWHITE, (1.8, 12.4, ROOF3 + 0.45), 0.1, 12, 6, squash=0.5)
for x, y, h in ((-4.5, 6.0, 4.2), (-2.2, 8.0, 5.5), (2.0, 8.4, 3.4), (4.8, 6.4, 4.0), (6.2, 11.0, 3.0), (-6.4, 11.0, 3.6), (-0.9, 13.6, 2.6)):
    cyl('Mast', BLACK if h > 3.5 else WHITE, (x, y, ROOF3), (x, y, ROOF3 + h), 0.014, 6, r1=0.008)
    cyl('Mast', BLACK, (x, y, ROOF3), (x, y, ROOF3 + 0.25), 0.05, 8)
cyl('Mast', WHITE, (0.9, 13.9, ROOF3), (0.9, 13.9, ROOF3 + 0.3), 0.08, 10)
fb.box('Mast', WHITE, (0.9, 14.05, ROOF3 + 0.35), (0.45, 0.35, 0.3))
for x, y in ((-5.5, 8.5), (5.5, 8.5), (0, 6.2)):
    aabb('Mast', OFFWHITE, x - 0.35, x + 0.35, y - 0.25, y + 0.25, ROOF3, ROOF3 + 0.45)
    aabb('Mast', BLACK, x - 0.3, x + 0.3, y + 0.25, y + 0.26, ROOF3 + 0.08, ROOF3 + 0.4)
# Sidelights on the front corners of the roof, the stern light and the deck floodlights.
for s, colour in ((-1, (0.95, 0.05, 0.03)), (1, (0.05, 0.9, 0.2))):
    y = CHEEK_Y0 + R_UP * 0.7
    x = s * (SIDE - R_UP + R_UP * 0.7 - 0.3)
    aabb('Mast', material(f'Sidelight{s}', colour, 0.0, 0.3, 3.0), x - 0.1, x + 0.1, y - 0.15, y + 0.15, ROOF3 + 0.05, ROOF3 + 0.3)
    aabb('Mast', BLACK, min(x - s * 0.12, x - s * 0.16), max(x - s * 0.12, x - s * 0.16), y - 0.3, y + 0.3, ROOF3, ROOF3 + 0.35)
    aabb('Fittings', FLOOD, min(s * (SIDE - 0.3), s * (SIDE - 0.1)), max(s * (SIDE - 0.3), s * (SIDE - 0.1)), STERN + 0.2, STERN + 0.45, DECK3 + 3.7, DECK3 + 3.85)
    aabb('Fittings', FLOOD, min(s * 7.4, s * 7.8), max(s * 7.4, s * 7.8), SUPER_AFT + 0.1, SUPER_AFT + 0.25, DECK3 + 0.85, DECK3 + 0.98)
# the stern light on a post at the middle of the sun deck's after rail, shining astern over the vehicle deck (not in
# the stern opening: the ramp lowers out of it, and a light there hangs in the air in front of every car)
cyl('Fittings', STEEL, (0, SUPER_AFT - 0.1, DECK3 + 1.1), (0, SUPER_AFT - 0.1, DECK3 + 1.4), 0.03, 8)
aabb('Fittings', BLACK, -0.1, 0.1, SUPER_AFT - 0.08, SUPER_AFT - 0.02, DECK3 + 1.38, DECK3 + 1.58)
aabb('Fittings', WHITE_LIGHT, -0.08, 0.08, SUPER_AFT - 0.2, SUPER_AFT - 0.08, DECK3 + 1.4, DECK3 + 1.56)

# ---- 15. livery: the name on the white, the island it serves, a sun-and-waves emblem --------
FONTS = Path('/System/Library/Fonts/Supplemental')
def tidy_glyphs(obj):
    """Weld a converted text's caps to its sides, drop the zero-area slivers the font's collinear points leave, and
    turn every glyph's faces outward. Returns (faces before, faces after, faces turned)."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(obj.data); n0 = len(bm.faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update(); ref = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.normal_update()
    turned = sum(1 for f, n in zip(bm.faces, ref) if f.normal.dot(n) < 0)
    for f in bm.faces: f.smooth = True
    bm.to_mesh(obj.data); bm.free()
    try: obj.data.set_sharp_from_angle(angle=math.radians(35))   # faces and walls stay crisp, vertices shared
    except Exception as err: print('FERRY glyph sharp skipped', err)
    return n0, len(obj.data.polygons), turned
def lettering(group, text, loc, size, mat, rotation, font, extrude=0.012, space=1.0, res=None, align='CENTER', quiet=False, tidy=True):
    data = bpy.data.curves.new(text[:20], 'FONT'); data.body = text
    data.align_x = align; data.align_y = 'CENTER'; data.size = size; data.extrude = extrude
    if res: data.resolution_u = res
    data.space_character = space
    if font.exists(): data.font = bpy.data.fonts.load(str(font), check_existing=True)
    data.materials.append(mat)
    obj = bpy.data.objects.new(text[:20], data); bpy.context.collection.objects.link(obj)
    obj.location = loc; obj.rotation_euler = rotation
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH'); obj.select_set(False); groups.setdefault(group, []).append(obj)
    if not tidy: return obj    # flat lettering: the weld and sliver pass eats its thin fill triangles
    a, b, t = tidy_glyphs(obj)
    if not quiet: print(f'FERRY lettering {text!r} {font.name}: faces {a} -> {b} (slivers dropped {a - b}), faces turned outward {t}')
    return obj
def side_rot(s): return (math.pi / 2, 0, math.pi / 2 if s > 0 else -math.pi / 2)
def emblem_shape(outline, s, depth, mat):
    x = s * (SIDE + depth)
    pts = outline if s > 0 else outline[::-1]
    fill('Livery', mat, [(x, y, z) for y, z in pts], (s, 0, 0))
def wave_band(y0, y1, mid, amp, thick, phase, n=90):
    top, bottom = [], []
    for k in range(n + 1):
        y = y0 + (y1 - y0) * k / n
        taper = math.sin(math.pi * k / n) ** 0.6
        z = mid + amp * math.sin(2 * math.pi * (y - phase) / 5.2)
        top.append((y, z + thick * taper / 2)); bottom.append((y, z - thick * taper / 2))
    return top + bottom[::-1]
for s in (1, -1):
    lettering('Livery', 'TIDEWATER', (s * (SIDE + 0.012), -17.6, 5.0), 2.9, NAVY, side_rot(s), FONTS / 'Arial Narrow Bold Italic.ttf')
    lettering('Livery', 'Joey Island', (s * (SIDE + 0.012), -6.4, 4.45), 1.15, SOFT_NAVY, side_rot(s), FONTS / 'Arial Italic.ttf')
    lettering('Livery', 'TIDEWATER SPIRIT', (s * (SIDE + 0.006), 20.6, 5.95), 0.32, BLACK, side_rot(s), FONTS / 'Arial Bold.ttf', 0.004, 1.15)
    SUN_Y, SUN_Z, SUN_R = 8.4, 5.2, 1.5
    emblem_shape([(SUN_Y + SUN_R * math.cos(math.pi * k / 40), SUN_Z + SUN_R * math.sin(math.pi * k / 40)) for k in range(41)], s, 0.004, GOLD)
    for r in range(7):
        a = math.pi * (r + 0.5) / 7
        ca, sa = math.cos(a), math.sin(a)
        emblem_shape([(SUN_Y + 1.75 * ca - 0.11 * sa, SUN_Z + 1.75 * sa + 0.11 * ca), (SUN_Y + 2.25 * ca, SUN_Z + 2.25 * sa), (SUN_Y + 1.75 * ca + 0.11 * sa, SUN_Z + 1.75 * sa - 0.11 * ca)], s, 0.004, GOLD)
    emblem_shape(wave_band(-1.0, 17.5, 5.05, 0.36, 1.05, 2.0), s, 0.008, NAVY)
    emblem_shape(wave_band(-2.0, 16.5, 4.15, 0.26, 0.6, 0.1), s, 0.012, TEAL)
lettering('Livery', 'TIDEWATER', (0, UP_FRONT + 0.35 + 0.012, DECK3 + 0.5), 0.72, NAVY, (math.pi / 2, 0, math.pi), FONTS / 'Arial Narrow Bold Italic.ttf')
# Her name and home port across the saloon's aft wall, read from astern over the car deck.
lettering('Livery', 'TIDEWATER SPIRIT', (0, SUPER_AFT - 0.112, (HEAD2 + DECK3) / 2 + 0.04), 0.5, NAVY, (math.pi / 2, 0, 0), FONTS / 'Arial Black.ttf', 0.01, 1.08)
lettering('Livery', 'TIDEWATER', (0, SUPER_AFT - 0.112, SILL2 - 0.3), 0.32, NAVY, (math.pi / 2, 0, 0), FONTS / 'Arial Black.ttf', 0.01, 1.08)

# Stations the game uses.
station('HelmStation', (0.0, HELM_Y - 0.6, DECK3))
station('GangwayDoor', (-GANGWAY_X, DOOR_Y, DECK2))
station('GangwayDoorStarboard', (GANGWAY_X, DOOR_Y, DECK2))
station('RampTop', (0.0, STERN, DECK1))
station('CarDeck', (0.0, -10.0, DECK1))
station('SaloonCentre', (0.0, 8.0, DECK2))
station('ViewingDeck', (0.0, 3.0, DECK3))
station('BowDeck', (0.0, 22.0, DECK2))

# ---- 16. interior fit-out: the vehicle deck, the wing corridors and stairs, the saloon -----------
# Small props go in the 'Props' group, which the game draws without shadows (src/ferry/Ferry.js); the
# surfaces' detail (weld seams, rust, tyre marks, laminate seams, ceiling grid, carpet) is FerryPaint.js.
PR = 'Props'
SIGN_GLOW = material('SignGlowWhite', (0.95, 0.97, 0.95), 0.0, 0.3, 1.2)
SIGN_GREEN = material('SignGreen', (0.0, 0.36, 0.15), 0.0, 0.4, 0.2)
DRAIN = material('DrainGrate', (0.035, 0.035, 0.04), 0.5, 0.6)
DUCT = material('GalvanisedDuct', (0.58, 0.6, 0.61), 0.85, 0.42)
DOORGREY = material('DoorGrey', (0.36, 0.38, 0.39), 0.3, 0.5)
CURTAIN = material('CurtainFabric', (0.5, 0.42, 0.3), 0.0, 0.9)
CASE = glassy(material('CaseGlass', (0.55, 0.6, 0.6), 0.0, 0.05), 0.22, 0.6)
ARIAL_B, ARIAL = FONTS / 'Arial Bold.ttf', FONTS / 'Arial.ttf'
def text(t, loc, size, mat, rot, font=ARIAL_B, res=None, align='CENTER'):
    # flat lettering (the materials are double-sided), coarse curves when it is small: signs stay cheap
    obj = lettering(PR, t, loc, size, mat, rot, font, extrude=0.0, res=res or (2 if size < 0.08 else 3), align=align, quiet=True, tidy=False)
    # face every glyph triangle to the lettering's own +Z, which the rotation points out of the board
    import bmesh
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
        f.smooth = True                                   # coplanar: same shading, shared vertices in the GLB
    bm.to_mesh(obj.data); bm.free()
    return obj
def xs(*v): return sorted(v)
def wall_sign(fx, n, y, z, w, h, board, t, tmat, size, border=None, extruded=False):
    """A board on a wall facing n (+1/-1 along X), its front face at x = fx, lettered."""
    aabb(PR, board, *xs(fx - n * 0.04, fx), y - w / 2, y + w / 2, z - h / 2, z + h / 2)   # 40 mm: the lettering's back stays inside
    if border:
        e = 0.03
        for y0, y1, z0, z1 in ((y - w / 2, y + w / 2, z + h / 2 - e, z + h / 2), (y - w / 2, y + w / 2, z - h / 2, z - h / 2 + e),
                               (y - w / 2, y - w / 2 + e, z - h / 2, z + h / 2), (y + w / 2 - e, y + w / 2, z - h / 2, z + h / 2)):
            aabb(PR, border, *xs(fx, fx + n * 0.003), y0, y1, z0, z1)
    if extruded:   # 20 mm and tidied (the muster signs' flat fills lost the E's and T's bars), front face 3 mm proud
        lettering(PR, t, (fx - n * 0.017, y, z), size, tmat, side_rot(n), ARIAL_B, extrude=0.02, res=3, quiet=True)
    else:
        text(t, (fx + n * 0.003, y, z), size, tmat, side_rot(n))

# The vehicle deck walls: frames every 2.4 m and two stringers, clear of the fittings on them.
BUSY = [(-11.0, -8.0)]                                     # the stair door and its leaf held open
for k in range(11):
    y = STERN + 2.5 + k * 4.0
    if y > FWD_BULKHEAD - 1.0: break
    BUSY.append((y - 0.5, y + 0.5))                        # floodlight
    if k % 3 == 1: BUSY.append((y + 1.1, y + 2.7))         # hose cabinet and extinguisher
def clear_of(y0, y1): return all(y1 < a or y0 > b for a, b in BUSY)
for s in (1, -1):
    X = lambda x: s * x
    y = STERN + 1.2
    while y < FWD_BULKHEAD - 0.3:
        if clear_of(y - 0.1, y + 0.1):
            top = DECK3 - 0.15 if y < SUPER_AFT else DECK2 - 0.9
            aabb('CarDeck', CARWALL, *xs(X(WING_IN - 0.09), X(WING_IN)), y - 0.05, y + 0.05, DECK1 + 0.1, top)
            aabb('CarDeck', CARWALL, *xs(X(WING_IN - 0.02), X(WING_IN)), y - 0.16, y + 0.16, DECK1, DECK1 + 0.12)   # bracket at the foot
        y += 2.4
    for z, spans in ((DECK1 + 2.75, ((STERN + 0.3, -9.9), (-7.9, FWD_BULKHEAD - 0.2))), (DECK1 + 5.0, ((STERN + 0.3, SUPER_AFT),))):
        for y0, y1 in spans:
            aabb('CarDeck', CARWALL, *xs(X(WING_IN - 0.08), X(WING_IN)), y0, y1, z - 0.04, z + 0.04)
    # The fire main along the wall on brackets.
    cyl(PR, RED, (X(WING_IN - 0.17), STERN + 0.4, DECK1 + 3.0), (X(WING_IN - 0.17), FWD_BULKHEAD - 0.3, DECK1 + 3.0), 0.055, 8)
    for k in range(18):
        yb = STERN + 1.8 + k * 2.4
        if yb > FWD_BULKHEAD - 0.5: break
        aabb(PR, STEEL, *xs(X(WING_IN - 0.24), X(WING_IN)), yb - 0.03, yb + 0.03, DECK1 + 2.9, DECK1 + 2.94)
    # Hose cabinets get their lettering and an extinguisher beside them.
    for k in range(11):
        y = STERN + 2.5 + k * 4.0
        if y > FWD_BULKHEAD - 1.0: break
        if k % 3 == 1 and y + 2.6 < FWD_BULKHEAD:
            text('FIRE HOSE', (X(WING_IN - 0.252), y + 1.55, DECK1 + 1.82), 0.075, SIGN_WHITE, side_rot(-s))
            aabb(PR, STAINLESS, *xs(X(WING_IN - 0.27), X(WING_IN - 0.25)), y + 1.75, y + 1.8, DECK1 + 1.4, DECK1 + 1.6)
            ye = y + 2.35
            aabb(PR, STEEL, *xs(X(WING_IN - 0.04), X(WING_IN)), ye - 0.07, ye + 0.07, DECK1 + 0.85, DECK1 + 1.5)
            cyl(PR, RED, (X(WING_IN - 0.14), ye, DECK1 + 0.9), (X(WING_IN - 0.14), ye, DECK1 + 1.42), 0.085, 10)
            cyl(PR, BLACK, (X(WING_IN - 0.14), ye, DECK1 + 1.42), (X(WING_IN - 0.14), ye, DECK1 + 1.52), 0.03, 6)
            wall_sign(X(WING_IN - 0.02), -s, ye, DECK1 + 1.75, 0.3, 0.18, RED, 'EXTINGUISHER', SIGN_WHITE, 0.032)
    # Signs, bolted to the frames.
    fx = X(WING_IN - 0.11)
    for y in (-20.5, -3.5, 12.0):
        wall_sign(fx, -s, y, DECK1 + 2.2, 1.1, 0.34, SIGN_WHITE, 'NO SMOKING', RED, 0.15, border=RED)
    for y in (-13.0, 5.0):
        wall_sign(fx, -s, y, DECK1 + 2.2, 2.3, 0.55, YELLOW, 'PASSENGERS MUST NOT REMAIN\nON THE VEHICLE DECK', BLACK, 0.12, border=BLACK)
    wall_sign(fx, -s, -7.2, DECK1 + 1.75, 1.2, 0.38, SIGN_GREEN, 'STAIRS TO\nPASSENGER DECKS', SIGN_GLOW, 0.085)
    text('EXIT', (X(WING_IN - 0.043), LOW_Y0 - 0.7, DECK1 + 2.425), 0.17, SIGN_GLOW, side_rot(-s))
    # The stair door: yellow jambs, the steel leaf held open against the wall with its kick plate and vision port.
    for y0, y1 in ((-9.58, -9.5), (-8.3, -8.22)):
        aabb(PR, YELLOW, *xs(X(WING_IN - 0.04), X(WING_IN)), y0, y1, DECK1, DECK1 + 2.1)
    aabb(PR, DOORGREY, *xs(X(WING_IN - 0.08), X(WING_IN - 0.03)), -10.8, -9.62, DECK1 + 0.03, DECK1 + 2.05)
    aabb(PR, STAINLESS, *xs(X(WING_IN - 0.084), X(WING_IN - 0.08)), -10.78, -9.64, DECK1 + 0.06, DECK1 + 0.36)
    aabb(PR, GLASS, *xs(X(WING_IN - 0.085), X(WING_IN - 0.08)), -10.4, -10.0, DECK1 + 1.35, DECK1 + 1.75)
    aabb(PR, STAINLESS, *xs(X(WING_IN - 0.12), X(WING_IN - 0.08)), -9.8, -9.72, DECK1 + 0.95, DECK1 + 1.12)
    # Deck drains along the wall.
    for j in range(7):
        y = -22.0 + 6.0 * j
        x0, x1 = xs(X(WING_IN - 0.68), X(WING_IN - 0.42))
        aabb(PR, DRAIN, x0, x1, y - 0.3, y + 0.3, DECK1, DECK1 + 0.006)
        for b in range(6):
            yb = y - 0.25 + b * 0.1
            aabb(PR, STEEL, x0 + 0.015, x1 - 0.015, yb - 0.012, yb + 0.012, DECK1 + 0.006, DECK1 + 0.011)
# Lashing points: a dark socket and a cross bar in each.
for x in (-5.8, -3.3, -0.8, 0.8, 3.3, 5.8):
    for k in range(18):
        y = STERN + 1.8 + k * 2.4
        if y > FWD_BULKHEAD - 1.0: break
        cyl(PR, BLACK, (x, y, DECK1 + 0.012), (x, y, DECK1 + 0.015), 0.045, 8)
        aabb(PR, STEEL, x - 0.05, x + 0.05, y - 0.012, y + 0.012, DECK1 + 0.012, DECK1 + 0.022)
# Lane numbers, painted near the stern and under the saloon.
for i, x in enumerate((-4.95, -1.65, 1.65, 4.95)):
    for y in (-21.2, 12.8):
        text(str(i + 1), (x, y, DECK1 + 0.004), 1.1, SIGN_WHITE, (0, 0, 0), res=4)
# The deckhead under the saloon: sprinkler mains with heads between the beams, cable trays, vent ducts.
YS0, YS1 = SUPER_AFT + 0.2, FWD_BULKHEAD - 0.2
for x in (-2.9, 2.9):
    cyl(PR, RED, (x, YS0, DECK2 - 1.0), (x, YS1, DECK2 - 1.0), 0.045, 8)
    for k in range(10):
        yb = SUPER_AFT + 0.8 + k * 1.9
        if yb > FWD_BULKHEAD - 0.4: break
        aabb(PR, STEEL, x - 0.06, x + 0.06, yb - 0.02, yb + 0.02, DECK2 - 1.05, DECK2 - 0.9)
        yh = yb + 0.95
        if yh < YS1:
            cyl(PR, RED, (x, yh, DECK2 - 1.0), (x, yh, DECK2 - 1.14), 0.016, 6)
            cyl(PR, STAINLESS, (x, yh, DECK2 - 1.14), (x, yh, DECK2 - 1.18), 0.035, 8)
for x in (0.0, -5.4, 5.4):
    aabb(PR, STEEL, x - 0.18, x + 0.18, YS0, YS1, DECK2 - 0.985, DECK2 - 0.96)
    aabb(PR, BLACK, x - 0.13, x + 0.13, YS0, YS1, DECK2 - 0.96, DECK2 - 0.925)
for s in (1, -1):
    aabb('CarDeck', DUCT, *xs(s * 5.8, s * 6.42), YS0, YS1, DECK2 - 1.3, DECK2 - 0.95)
    k = 0
    while YS0 + 0.6 + k * 1.2 < YS1:
        y = YS0 + 0.6 + k * 1.2
        aabb(PR, DUCT, *xs(s * 5.78, s * 6.44), y - 0.02, y + 0.02, DECK2 - 1.32, DECK2 - 0.94)
        if k % 3 == 1: aabb(PR, BLACK, *xs(s * 5.79, s * 5.8), y - 0.25, y + 0.25, DECK2 - 1.28, DECK2 - 1.02)   # grille
        k += 1

# The wing corridors and stairs: laminate linings, sills, handrails, doors, safety signs.
for s in (1, -1):
    X = lambda x: s * x
    # The inboard wall, lined from the car deck door up through the stair shaft and along the corridor.
    li = xs(X(WING_IN + 0.12), X(WING_IN + 0.14))
    aabb('Interior', LAMWALL, *li, STERN + 0.3, SUPER_AFT - 0.1, DECK2, DECK3 - 0.3)
    aabb('Interior', LAMWALL, *li, -8.28, LOW_Y1, DECK1, DECK2)
    aabb('Interior', LAMWALL, *li, LOW_Y0 - 1.45, -8.28, DECK1 + 2.12, DECK2)
    # The outboard wall below the windows and above them, with a sill board and head trim.
    lo = xs(X(SIDE - 0.06), X(SIDE - 0.04))
    for y0, y1 in ((STERN + R_AFT, DOOR_Y - DOOR_W / 2 - 0.1), (DOOR_Y + DOOR_W / 2 + 0.1, 16.4)):
        aabb('Interior', LAMWALL, *lo, y0, y1, DECK2, SILL2)
        aabb(PR, LAMINATE, *xs(X(SIDE - 0.22), X(SIDE - 0.04)), y0, y1, SILL2 - 0.03, SILL2)
    for y0, y1 in ((STERN + R_AFT, DOOR_Y - DOOR_W / 2 - 0.1), (DOOR_Y + DOOR_W / 2 + 0.1, 12.4)):
        aabb('Interior', LAMWALL, *lo, y0, y1, HEAD2, DECK3 - 0.3)
        aabb(PR, LAMINATE, *xs(X(SIDE - 0.1), X(SIDE - 0.04)), y0, y1, HEAD2, HEAD2 + 0.04)
    # The gangway door's frame inside.
    for y0, y1 in ((DOOR_Y - DOOR_W / 2 - 0.1, DOOR_Y - DOOR_W / 2), (DOOR_Y + DOOR_W / 2, DOOR_Y + DOOR_W / 2 + 0.1)):
        aabb(PR, STAINLESS, *xs(X(SIDE - 0.1), X(SIDE - 0.03)), y0, y1, DECK2, DECK2 + DOOR_H + 0.08)
    aabb(PR, STAINLESS, *xs(X(SIDE - 0.1), X(SIDE - 0.03)), DOOR_Y - DOOR_W / 2 - 0.1, DOOR_Y + DOOR_W / 2 + 0.1, DECK2 + DOOR_H, DECK2 + DOOR_H + 0.08)
    # Handrails on brackets along the inboard wall, and up the wall side of both flights.
    for y0, y1 in ((STERN + 0.8, UP_Y0 - 0.3), (UP_Y0 + 16 * 0.26 + 0.3, LOW_Y0 - 0.3), (LOW_Y1 + 0.3, SUPER_AFT - 1.2)):
        rail(PR, STAINLESS, [(X(WING_IN + 0.21), y0, DECK2 + 0.92), (X(WING_IN + 0.21), y1, DECK2 + 0.92)], 0.022, 8)
        n = max(1, int((y1 - y0) / 1.2))
        for k in range(n + 1):
            yb = y0 + (y1 - y0) * k / n
            aabb(PR, STAINLESS, *xs(X(WING_IN + 0.14), X(WING_IN + 0.21)), yb - 0.015, yb + 0.015, DECK2 + 0.9, DECK2 + 0.93)
    for y0, z0, z1 in ((LOW_Y0, DECK1, DECK2), (UP_Y0, DECK2, DECK3)):
        rail(PR, STAINLESS, [(X(WING_IN + 0.21), y0 + 0.1, z0 + 0.9), (X(WING_IN + 0.21), y0 + (24 if z0 == DECK1 else 16) * 0.26 - 0.1, z1 + 0.9)], 0.022, 8)
    # Door into the saloon at the corridor's forward end: a transom, jambs and a leaf held open with its kick plate.
    aabb('Interior', LAMWALL, *xs(X(WING_IN + 0.14), X(SIDE - 0.04)), SUPER_AFT - 0.1, SUPER_AFT, DECK2 + 2.1, DECK3 - 0.3)
    for xa, xb in ((WING_IN + 0.14, WING_IN + 0.22), (SIDE - 0.12, SIDE - 0.04)):
        aabb(PR, STAINLESS, *xs(X(xa), X(xb)), SUPER_AFT - 0.12, SUPER_AFT, DECK2, DECK2 + 2.12)
    aabb(PR, LAMINATE, *xs(X(WING_IN + 0.14), X(WING_IN + 0.18)), SUPER_AFT - 1.02, SUPER_AFT - 0.14, DECK2 + 0.02, DECK2 + 2.06)
    aabb(PR, STAINLESS, *xs(X(WING_IN + 0.18), X(WING_IN + 0.184)), SUPER_AFT - 1.0, SUPER_AFT - 0.16, DECK2 + 0.04, DECK2 + 0.3)
    aabb(PR, GLASS, *xs(X(WING_IN + 0.18), X(WING_IN + 0.186)), SUPER_AFT - 0.8, SUPER_AFT - 0.36, DECK2 + 1.1, DECK2 + 1.8)
    # Ceilings: the wing slabs' deck boxes share the lining's plane (and won), so a lining sheet just under them,
    # in the corridor round the upper stair's hatch and over the landing at the foot of the lower stair.
    for x0, x1, y0, y1 in ((8.0, SIDE - 0.03, -19.95, -15.74), (WING_IN + 0.12, SIDE - 0.03, -15.74, SUPER_AFT)):
        aabb('Interior', LINING, *xs(X(x0), X(x1)), y0, y1, DECK3 - 0.32, DECK3 - 0.305)
    aabb('Interior', LINING, *xs(X(WING_IN + 0.12), X(7.86)), LOW_Y0 - 1.45, LOW_Y0, DECK2 - 0.32, DECK2 - 0.305)
    # A panelled guard round the car-deck stair's hatch in the corridor floor (visual only, no collider): laminate
    # panels from the shaft lining up to 0.95 m, stainless kick plates both faces, a teak capping rail.
    for x0_, x1_, y0_, y1_ in ((7.8, 7.86, LOW_Y0 - 0.06, LOW_Y1 - 0.3), (WING_IN + 0.14, 7.86, LOW_Y0 - 0.06, LOW_Y0)):
        aabb('Interior', LAMWALL, *xs(X(x0_), X(x1_)), y0_, y1_, DECK2 - 0.3, DECK2 + 0.95)
        aabb(PR, TEAK, *xs(X(x0_ - 0.025), X(x1_ + 0.025)), y0_ - 0.025, y1_ + 0.025, DECK2 + 0.95, DECK2 + 0.99)
        aabb(PR, STAINLESS, *xs(X(x0_ - 0.004), X(x1_ + 0.004)), y0_ - 0.004, y1_ + 0.004, DECK2, DECK2 + 0.15)
    # Safety: the muster station, a lifejacket locker, the fire and safety plan, and the way up from the car deck.
    fi = X(WING_IN + 0.16)
    wall_sign(fi, s, -11.9, DECK2 + 2.0, 1.25, 0.32, SIGN_GREEN, 'MUSTER STATION ' + ('A' if s < 0 else 'B'), SIGN_GLOW, 0.1, extruded=True)
    aabb('Interior', SIGN_WHITE, *xs(X(WING_IN + 0.14), X(WING_IN + 0.52)), -23.7, -22.3, DECK2, DECK2 + 0.95)
    aabb(PR, ORANGE, *xs(X(WING_IN + 0.14), X(WING_IN + 0.54)), -23.72, -22.28, DECK2 + 0.95, DECK2 + 0.99)
    colbox('solid', *xs(X(WING_IN + 0.12), X(WING_IN + 0.54)), -23.72, -22.28, DECK2, DECK2 + 1.0)
    text('LIFEJACKETS', (X(WING_IN + 0.523), -23.0, DECK2 + 0.6), 0.085, BLACK, side_rot(s))
    wall_sign(fi, s, -23.0, DECK2 + 1.6, 1.0, 0.26, SIGN_GREEN, 'LIFEJACKETS', SIGN_GLOW, 0.1)
    # The plan: the hull, the saloon, the corridors, escape routes and where you stand.
    py, pz, pw, ph = -13.9, DECK2 + 1.5, 1.0, 0.66
    aabb(PR, SIGN_WHITE, *xs(fi, fi + s * 0.015), py - pw / 2, py + pw / 2, pz - ph / 2, pz + ph / 2)
    f2 = fi + s * 0.015
    def plan(y0, y1, z0, z1, mat, d=0.002): aabb(PR, mat, *xs(f2, f2 + s * d), py + y0, py + y1, pz + z0, pz + z1)
    for z0, z1 in ((-0.14, -0.13), (0.13, 0.14)): plan(-0.4, 0.28, z0, z1, SOFT_NAVY)
    plan(-0.41, -0.4, -0.14, 0.14, SOFT_NAVY)
    for sg in (1, -1):
        fb.box(PR, SOFT_NAVY, (f2 + s * 0.001, py + 0.34, pz + sg * 0.07), (0.002, 0.16, 0.01), rx=-sg * math.radians(62))
    plan(-0.02, 0.26, -0.1, 0.1, TEAL, 0.0025)
    for z0, z1 in ((-0.12, -0.1), (0.1, 0.12)): plan(-0.38, -0.02, z0, z1, GOLD, 0.0025)
    for z0, z1 in ((-0.114, -0.106), (0.106, 0.114)): plan(-0.37, 0.0, z0, z1, SIGN_GREEN, 0.003)
    plan(-0.24, -0.22, -0.122, -0.098, RED, 0.004)
    text('FIRE AND SAFETY PLAN  DECK 2', (f2 + s * 0.002, py, pz + 0.27), 0.036, BLACK, side_rot(s), font=ARIAL_B)
    text('YOU ARE HERE', (f2 + s * 0.002, py - 0.23, pz - 0.2), 0.03, RED, side_rot(s), font=ARIAL_B)
    text('ESCAPE ROUTE', (f2 + s * 0.002, py + 0.2, pz - 0.2), 0.03, SIGN_GREEN, side_rot(s), font=ARIAL_B)
    # The stair shaft from the car deck: a sign facing whoever comes through the door.
    wall_sign(X(7.78), -s, -8.95, DECK1 + 1.45, 1.22, 0.44, SIGN_GREEN, 'PASSENGER DECK\nMUSTER STATIONS', SIGN_GLOW, 0.1, extruded=True)

# The saloon: linings, sills, curtains, the aft wall lined, luggage racks, the kiosk fitted out, seat numbers.
for s in (1, -1):
    X = lambda x: s * x
    for j in range(5):
        y = 1.3 + j * 2.84
        if y > 12.2: break
        for d, dx in ((-0.1, 0.0), (0.0, 0.03), (0.1, 0.0)):
            aabb(PR, CURTAIN, *xs(X(SIDE - 0.2 - dx), X(SIDE - 0.1 - dx)), y + d - 0.06, y + d + 0.06, SILL2 + 0.1, HEAD2 - 0.02)
        aabb(PR, CURTAIN, *xs(X(SIDE - 0.25), X(SIDE - 0.08)), y - 0.17, y + 0.17, SILL2 + 0.75, SILL2 + 0.82)   # tie-back
    aabb(PR, STAINLESS, *xs(X(SIDE - 0.18), X(SIDE - 0.12)), SUPER_AFT + 0.2, 12.4, HEAD2 - 0.03, HEAD2)
for z0, z1 in ((DECK2, SILL2), (HEAD2, DECK3 - 0.3)):
    aabb('Interior', LAMWALL, -WING_IN, WING_IN, SUPER_AFT, SUPER_AFT + 0.02, z0, z1)
aabb(PR, LAMINATE, -WING_IN, WING_IN, SUPER_AFT, SUPER_AFT + 0.16, SILL2 - 0.03, SILL2)
# Luggage racks against the aft wall between the kiosk and the washrooms.
for x0, x1 in ((-1.9, -0.05), (0.05, 1.9)):
    for x in (x0, x1):
        for y in (0.56, 0.96):
            aabb(PR, STAINLESS, x - 0.02, x + 0.02, y - 0.02, y + 0.02, DECK2, DECK2 + 1.0)
    for z in (DECK2 + 0.1, DECK2 + 0.55):
        aabb(PR, STEEL, x0, x1, 0.54, 0.98, z - 0.02, z)
    rail(PR, STAINLESS, [(x0, 0.98, DECK2 + 1.0), (x1, 0.98, DECK2 + 1.0)], 0.02, 6)
for (x, z, w, d, h, mat) in ((-1.5, DECK2 + 0.1, 0.45, 0.28, 0.62, SOFT_NAVY), (-0.9, DECK2 + 0.1, 0.4, 0.26, 0.55, RED), (-0.45, DECK2 + 0.55, 0.5, 0.3, 0.3, BLACK),
                             (0.6, DECK2 + 0.1, 0.46, 0.3, 0.64, TEAL), (1.3, DECK2 + 0.55, 0.55, 0.32, 0.34, CURTAIN), (1.45, DECK2 + 0.1, 0.36, 0.24, 0.5, BLACK)):
    fb.box(PR, mat, (x, 0.76, z + h / 2), (w, d, h))
colbox('solid', -1.95, 1.95, SUPER_AFT, 1.02, DECK2, DECK2 + 1.0)
# The kiosk: a battened counter front, pastry case, till, a back counter under the espresso machine, drinks chillers, the menu.
for i in range(19):
    x = -6.1 + i * 0.2
    aabb(PR, TEAK, x - 0.085, x + 0.085, 2.0, 2.025, DECK2 + 0.12, DECK2 + 1.0)
aabb(PR, STAINLESS, -6.2, -2.4, 2.0, 2.02, DECK2, DECK2 + 0.12)
aabb(PR, STAINLESS, -3.95, -2.85, 1.3, 1.9, DECK2 + 1.1, DECK2 + 1.16)
aabb(PR, CASE, -3.93, -2.87, 1.32, 1.88, DECK2 + 1.16, DECK2 + 1.5)
for i in range(6):
    cyl(PR, GOLD, (-3.75 + (i % 3) * 0.33, 1.48 + (i // 3) * 0.25, DECK2 + 1.16), (-3.75 + (i % 3) * 0.33, 1.48 + (i // 3) * 0.25, DECK2 + 1.21), 0.07, 10)
aabb(PR, BLACK, -5.25, -4.9, 1.35, 1.65, DECK2 + 1.1, DECK2 + 1.17)
fb.box(PR, SCREEN_DARK, (-5.07, 1.45, DECK2 + 1.3), (0.3, 0.02, 0.22), rx=math.radians(20))
aabb('Interior', LAMINATE, -6.2, -4.05, 0.62, 1.15, DECK2, DECK2 + 1.1)
aabb(PR, BLACK, -5.58, -4.92, 1.15, 1.16, DECK2 + 1.45, DECK2 + 1.62)
for gx in (-5.4, -5.1):
    cyl(PR, STAINLESS, (gx, 1.16, DECK2 + 1.38), (gx, 1.26, DECK2 + 1.38), 0.035, 8)
aabb(PR, BLACK, -5.58, -4.92, 1.15, 1.3, DECK2 + 1.1, DECK2 + 1.13)
for i in range(5):
    cyl(PR, SIGN_WHITE, (-5.5 + i * 0.12, 0.95, DECK2 + 1.65), (-5.5 + i * 0.12, 0.95, DECK2 + 1.75), 0.04, 8)
cyl(PR, BLACK, (-4.6, 0.9, DECK2 + 1.1), (-4.6, 0.9, DECK2 + 1.42), 0.08, 10)
cyl(PR, CASE, (-4.6, 0.9, DECK2 + 1.42), (-4.6, 0.9, DECK2 + 1.6), 0.07, 10)
for k in range(3):
    x0, x1 = -3.9 + k * 0.62, -3.35 + k * 0.62
    aabb('Interior', BLACK, x0, x1, 0.62, 0.64, DECK2, DECK2 + 1.9)
    aabb('Interior', FRIDGE, x0 + 0.03, x1 - 0.03, 0.64, 0.66, DECK2 + 0.1, DECK2 + 1.62)
    for xa, xb in ((x0, x0 + 0.03), (x1 - 0.03, x1)):
        aabb(PR, BLACK, xa, xb, 0.62, 1.05, DECK2, DECK2 + 1.9)
    aabb(PR, BLACK, x0, x1, 0.62, 1.05, DECK2, DECK2 + 0.1)
    aabb(PR, TEAL, x0, x1, 0.62, 1.05, DECK2 + 1.62, DECK2 + 1.9)
    for j, zs in enumerate((0.1, 0.48, 0.86, 1.24)):
        aabb(PR, STAINLESS, x0 + 0.03, x1 - 0.03, 0.66, 1.0, DECK2 + zs, DECK2 + zs + 0.015)
        for b in range(5):
            mat = (RED, TEAL, GOLD, ORANGE, SIGN_WHITE)[(b + j + k) % 5]
            bx = x0 + 0.08 + b * (x1 - x0 - 0.16) / 4
            cyl(PR, mat, (bx, 0.9, DECK2 + zs + 0.015), (bx, 0.9, DECK2 + zs + 0.25), 0.032, 8)
            cyl(PR, mat, (bx, 0.9, DECK2 + zs + 0.25), (bx, 0.9, DECK2 + zs + 0.31), 0.013, 6)
    text('COLD DRINKS', ((x0 + x1) / 2, 1.053, DECK2 + 1.76), 0.055, SIGN_WHITE, (math.pi / 2, 0, math.pi))
MENU_ROT = (math.pi / 2, 0, math.pi)
text('TIDEWATER KIOSK', (-4.3, 0.664, DECK2 + 2.4), 0.075, MENU, MENU_ROT)
for x_name, x_price, names, prices in ((-2.75, -3.8, 'FLAT WHITE\nCAPPUCCINO\nLONG BLACK\nHOT CHOCOLATE', '4.80\n4.80\n4.20\n4.50'),
                                       (-3.9, -4.95, 'PIE OF THE DAY\nSAUSAGE ROLL\nTOASTIE\nFISH AND CHIPS', '7.50\n5.50\n8.00\n14.50'),
                                       (-5.05, -5.9, 'SOFT DRINKS\nWATER\nICE CREAM\nSNACKS', '4.00\n3.50\n4.50\n2.50')):
    text(names, (x_name, 0.664, DECK2 + 2.13), 0.042, SIGN_GLOW, MENU_ROT, align='LEFT')
    text(prices, (x_price, 0.664, DECK2 + 2.13), 0.042, MENU, MENU_ROT, align='RIGHT')
# Seat numbers on a plate on the back of every seat: rows A (front) to K, seats 1 to 12 from port.
units = sorted({round(sx, 2) for _, sx in SEAT_PLATES})
for c, sx in SEAT_PLATES:
    row = chr(ord('A') + 10 - round((c.y + 0.08 * math.cos(math.radians(8)) + 0.25 - 3.1) / 0.95))
    text(f'{row}{units.index(round(sx, 2)) + 1}', tuple(c), 0.036, BLACK, (math.radians(82), 0, 0), res=2)

# ---- 8. the stern ramp on its hinge -------------------------------------------------------
RAMP = 'P:SternRamp'
aabb(RAMP, RAMP_STEEL, -RAMP_W / 2, RAMP_W / 2, STERN - RAMP_L, STERN, DECK1 - 0.3, DECK1)
for k in range(22):
    y = STERN - 0.4 - k * 0.3
    aabb(RAMP, RAMP_STEEL, -RAMP_W / 2 + 0.3, RAMP_W / 2 - 0.3, y - 0.03, y + 0.03, DECK1, DECK1 + 0.03)
for s in (1, -1):
    aabb(RAMP, YELLOW, min(s * (RAMP_W / 2 - 0.25), s * RAMP_W / 2), max(s * (RAMP_W / 2 - 0.25), s * RAMP_W / 2), STERN - RAMP_L, STERN, DECK1, DECK1 + 0.2)
    for k in range(4):
        xk = s * (1.0 + k * 1.1)
        cyl(RAMP, RAMP_STEEL, (xk - 0.3, STERN, DECK1 - 0.15), (xk + 0.3, STERN, DECK1 - 0.15), 0.16, 16)
for k in range(9):                                          # stiffeners on the outer face
    x = -RAMP_W / 2 + 0.6 + k * (RAMP_W - 1.2) / 8
    aabb(RAMP, RAMP_STEEL, x - 0.08, x + 0.08, STERN - RAMP_L + 0.1, STERN - 0.2, DECK1 - 0.55, DECK1 - 0.3)
# Toe flaps: a thinner run-on continuing the ramp deck, hinged in five leaves; their underside sits
# 0.19 m below the deck line, which is what the terminal's landing plate is set for.
for k in range(5):
    x0 = -RAMP_W / 2 + 0.1 + k * (RAMP_W - 0.2) / 5
    fb.hexa(RAMP, RAMP_STEEL, [(x0 + 0.02, STERN - RAMP_L, DECK1 - 0.19), (x0 + (RAMP_W - 0.2) / 5 - 0.02, STERN - RAMP_L, DECK1 - 0.19),
                              (x0 + (RAMP_W - 0.2) / 5 - 0.02, STERN - RAMP_L - 0.8, DECK1 - 0.19), (x0 + 0.02, STERN - RAMP_L - 0.8, DECK1 - 0.19),
                              (x0 + 0.02, STERN - RAMP_L, DECK1), (x0 + (RAMP_W - 0.2) / 5 - 0.02, STERN - RAMP_L, DECK1),
                              (x0 + (RAMP_W - 0.2) / 5 - 0.02, STERN - RAMP_L - 0.8, DECK1 - 0.13), (x0 + 0.02, STERN - RAMP_L - 0.8, DECK1 - 0.13)])
    cyl(RAMP, RAMP_STEEL, (x0 + 0.3, STERN - RAMP_L, DECK1 - 0.12), (x0 + (RAMP_W - 0.2) / 5 - 0.3, STERN - RAMP_L, DECK1 - 0.12), 0.07, 10)

# ---- pivots and export ---------------------------------------------------------------------
fb.flush(smooth_groups={'Hull': 35.0, 'Boat': 35.0, 'Seats': 50.0, 'Props': 50.0, 'Fittings': 50.0})
def pivot_of(name, at, parent=None):
    return pivot(name, at, [o for o in groups.pop(f'P:{name}', []) if o], parent)
ramp_pivot = pivot_of('SternRamp', (0, STERN, DECK1))
ramp_pivot.rotation_euler.x = -math.pi / 2 * 0.98          # stowed, closing the stern
mount = pivot('HelmWheelMount', WHEEL)
wheel = pivot_of('HelmWheel', WHEEL, mount)
mount.rotation_euler.x = math.radians(-14)                 # the wheel leans back toward the helmsman
throttles = [pivot_of(name, (x, HELM_Y + 0.3, DECK3 + 1.08)) for name, x in (('ThrottlePort', 0.83), ('ThrottleStarboard', 1.07))]
radars = [pivot_of(name, c) for name, (c, _) in radar_nodes.items()]
root = bpy.data.objects.new('TidewaterFerry', None); bpy.context.collection.objects.link(root)
root['length'] = LOA; root['beam'] = BEAM
for name, objects in list(groups.items()):
    objects = [o for o in objects if o and o.name in bpy.data.objects]
    if not objects: continue
    joined = join_group(f'Ferry {name}', objects)
    joined.parent = root
for node in [ramp_pivot, mount, *throttles, *radars, *stations.values()]:
    node.parent = root
root.rotation_euler.z = math.pi     # bow toward glTF +Z, like the cars
bpy.ops.object.select_all(action='DESELECT')
for obj in [root] + list(root.children_recursive): obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/ferry/ferry.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/ferry/ferry.blend'))
# Colliders in the ferry's glTF frame (the exported root turns the model to face +Z):
# model (x, y, z) -> game (-x, z, y); half extents (hx, hy, hz) -> (hx, hz, hy).
out = {'frame': 'ferry local, metres: +Z bow, +Y up, origin on the waterline amidships',
       'boxes': [{'kind': k, 'center': [round(-c[0], 3), round(c[2], 3), round(c[1], 3)], 'half': [round(h[0], 3), round(h[2], 3), round(h[1], 3)]} for k, c, h in COLLIDERS],
       'stations': {n: [round(-p.location.x, 3), round(p.location.z, 3), round(p.location.y, 3)] for n, p in stations.items()}}
(ROOT / 'public/ferry/ferry_colliders.json').write_text(json.dumps(out, indent=1))
print(f'FERRY colliders {len(COLLIDERS)}')
tris = sum(len(p.vertices) - 2 for o in root.children_recursive if o.type == 'MESH' for p in o.data.polygons)
print(f'FERRY triangles {tris}')
