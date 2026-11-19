# Blender 5.x batch builder for the Tidewater jetski (public/models/jetski.glb + jetski.json).
#   blender -b --factory-startup --python tools/jetski/jetski_build.py -- <repo root>
# An original, unbranded modern 3-seat sit-down personal watercraft ("RIPTIDE RX-300"), modelled from
# lofted sections: deep-V planing hull with lift strakes, reverse chines, topside spray strakes, finned
# sponsons and a rub rail with a brushed insert; dark navy hull, teal deck, raised black mid panels with
# graphics, a gloss black nose cap and front storage hatch, hood seams, side intake vents with fins, a glove
# box lid, a dash cowl with a TFT display under a visor brow, mirrors, handlebars (own pivot) with a badged
# pad; a tiered two-tone seat (bolster crest, carbon-look insert in a sewn groove, piping, seams, grab strap);
# at the stern a pump flange, reverse bucket, steering and reverse rods, ride plate, pump tunnel, bilge
# outlets, black transom band with lettering, edge bumper, reboarding step, chevron swim mat, cleats and
# tow eye. Panel gaps, decals and raised panels are real geometry projected onto the hull (no textures:
# the game's GLB loader is PBR-factor only). The contract (nodes, points, samples, inertia, envelope) is
# asserted at the end of the build, so detail work cannot move it.
# Contract frame (glTF): Y up, +Z forward, +X = rider's left, metres. The origin is on the centreline at
# the static waterline (solved for 350 kg in sea water), level trim, midships.
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
OUT, OUTJ = ROOT + '/public/models/jetski.glb', ROOT + '/public/models/jetski.json'
FONT = ROOT + '/tools/props/fonts/Oswald.ttf'
MASS, RHO = 350.0, 1025.0
bpy.ops.wm.read_factory_settings(use_empty=True)
log = lambda *a: print('JETSKI', *a, flush=True)

def B(p): return Vector((p[0], -p[2], p[1]))          # glTF frame -> Blender (Z up, -Y forward)
def G(v): return (v[0], v[2], -v[1])                  # Blender -> glTF frame
def ss(e0, e1, x): t = min(max((x - e0) / (e1 - e0), 0.0), 1.0); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def interp(tab, z):
    tab = sorted(tab)
    if z <= tab[0][0]: return tab[0][1]
    for (z0, v0), (z1, v1) in zip(tab, tab[1:]):
        if z <= z1: return lerp(v0, v1, ss(0, 1, (z - z0) / (z1 - z0)))
    return tab[-1][1]

# ------------------------------------------------------------------ materials (PBR factors only)
MATS = {}
def mat(name, col, rough, metal=0.0, coat=0.0, emit=None, es=0.0):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if coat: p.inputs['Coat Weight'].default_value = coat; p.inputs['Coat Roughness'].default_value = 0.03
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = es
    m.diffuse_color = (*col, 1); MATS[name] = m
    return name
GEL = mat('Gelcoat_White', (0.80, 0.81, 0.79), 0.14, coat=1.0)
HULLC = mat('Hull_Navy_Gelcoat', (0.006, 0.014, 0.040), 0.12, coat=1.0)
STAIN = mat('Gelcoat_Waterline', (0.13, 0.14, 0.12), 0.55)
SCUFF = mat('Gelcoat_Scuff', (0.16, 0.17, 0.19), 0.62)
DECK = mat('Deck_Teal_Metallic', (0.008, 0.20, 0.235), 0.26, metal=0.3, coat=1.0)
ORANGE = mat('Livery_Orange', (0.93, 0.20, 0.015), 0.22, coat=1.0)
INK = mat('Livery_Teal', (0.02, 0.45, 0.50), 0.25, coat=1.0)
WHITE = mat('Livery_White', (0.86, 0.87, 0.86), 0.25, coat=1.0)
RUBBER = mat('Rubber_Black', (0.018, 0.018, 0.02), 0.78)
PLASTIC = mat('Plastic_Black', (0.028, 0.03, 0.033), 0.42)
TEXB = mat('Textured_Black', (0.021, 0.022, 0.025), 0.68)
GBLACK = mat('Gloss_Black', (0.008, 0.008, 0.010), 0.24, coat=0.3)  # a softer coat: a mirror coat read as white panels under a bright sky
SEAM = mat('Panel_Gap', (0.002, 0.002, 0.003), 0.85)
STEEL = mat('Stainless', (0.63, 0.63, 0.64), 0.16, metal=1.0)
ALU = mat('Aluminium_Cast', (0.52, 0.52, 0.54), 0.45, metal=1.0)
MATG = mat('Mat_Grey', (0.10, 0.11, 0.115), 0.9)
MAT_TEAL = mat('Mat_Teal', (0.01, 0.16, 0.19), 0.85)
VTOP = mat('Vinyl_Black', (0.017, 0.018, 0.02), 0.46)
VSIDE = mat('Vinyl_Light_Grey', (0.135, 0.14, 0.148), 0.64)  # reads light against the charcoal without a silver sheen in game
SEATD = mat('Vinyl_Charcoal', (0.040, 0.043, 0.048), 0.55)
SEATC = mat('Vinyl_Carbon_Insert', (0.035, 0.038, 0.043), 0.74)
PIPE = mat('Vinyl_Teal_Piping', (0.01, 0.20, 0.23), 0.38)
MIRROR = mat('Mirror', (0.92, 0.92, 0.92), 0.02, metal=1.0)
GLASS = mat('Gauge_Glass', (0.004, 0.006, 0.01), 0.04)
TFT = mat('Display_TFT', (0.004, 0.012, 0.022), 0.05, emit=(0.02, 0.09, 0.16), es=1.2)
LCD = mat('Gauge_LCD', (0.05, 0.5, 0.65), 0.3, emit=(0.1, 0.75, 1.0), es=2.5)
LCDW = mat('Gauge_LCD_White', (0.8, 0.85, 0.9), 0.3, emit=(0.85, 0.92, 1.0), es=2.5)
LCDO = mat('Gauge_LCD_Orange', (0.9, 0.3, 0.02), 0.3, emit=(1.0, 0.35, 0.03), es=2.5)
RED = mat('Plastic_Red', (0.50, 0.015, 0.015), 0.38)
GREEN = mat('Plastic_Green', (0.02, 0.35, 0.05), 0.38)
MATL = mat('Mat_Grey_Grip', (0.20, 0.21, 0.22), 0.86)
TRIM = mat('Trim_Graphite', (0.035, 0.038, 0.042), 0.35, coat=0.5)
HOLE = mat('Intake_Dark', (0.006, 0.006, 0.007), 0.7)

# ------------------------------------------------------------------ mesh accumulation
class Acc:
    def __init__(s): s.V, s.F, s.M = [], [], []
    def add(s, V, F, m, fm=None):
        o = len(s.V); s.V += [tuple(v) for v in V]
        for i, f in enumerate(F):
            s.F.append(tuple(o + k for k in f)); s.M.append(fm(i, [V[k] for k in f]) if fm else m)
def loft(rings, closed=False, cap0=False, cap1=False):
    n = len(rings[0]); V = [p for r in rings for p in r]; F = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if closed else n - 1):
            k = (j + 1) % n; F.append((a + j, a + k, b + k, b + j))
    if cap0: F.append(tuple(range(n))[::-1])
    if cap1: F.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return V, F
def frame(t):
    t = Vector(t).normalized(); up = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
    n = t.cross(up).normalized(); return n, n.cross(t).normalized()
def tube(path, r, seg=10, ry=None, caps=True):
    rings = []; ry = ry or r
    for i, p in enumerate(path):
        t = Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)]); n, u = frame(t)
        rr = r(i / (len(path) - 1)) if callable(r) else r
        rings.append([tuple(Vector(p) + n * rr * math.cos(2 * math.pi * k / seg) + u * (ry if not callable(r) else rr) * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
    return loft(rings, closed=True, cap0=caps, cap1=caps)
def revolve(prof, c, axis, seg=16):  # prof: [(radius, along)], around an axis through c
    a = Vector(axis).normalized(); n, u = frame(a)
    rings = [[tuple(Vector(c) + a * t + (n * math.cos(2 * math.pi * k / seg) + u * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)] for r, t in prof]
    return loft(rings, closed=True, cap0=prof[0][0] > 0, cap1=prof[-1][0] > 0)
def rbox(c, size, r=0.0, rot=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if r > 0: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=2, affect='EDGES', profile=0.5)
    R = rot or Matrix.Identity(3)
    V = [tuple(Vector(c) + R @ v.co) for v in bm.verts]; F = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free(); return V, F
def rotY(d): return Matrix.Rotation(math.radians(d), 3, 'Y')
def rotX(d): return Matrix.Rotation(math.radians(d), 3, 'X')
def rotZ(d): return Matrix.Rotation(math.radians(d), 3, 'Z')

# ------------------------------------------------------------------ hull and deck sections
ZB, ZS = 1.62, -1.60
def yk(z): return -0.25 + 0.39 * max(0.0, (z - 0.10) / (ZB - 0.10)) ** 2.3
def dead(z): return math.radians(21 + 3 * ss(-1.6, 0.0, z) + 20 * max(0.0, (z - 0.25) / (ZB - 0.25)) ** 1.4)
def bch(z): return (0.40 + 0.05 * ss(-1.6, -0.5, z)) * math.sqrt(max(0.0, 1 - (max(0.0, z) / ZB) ** 2.2))
def Bm(z): return (0.572 + 0.028 * ss(-1.6, -0.6, z)) * math.sqrt(max(0.0, 1 - (max(0.0, z + 0.08) / (ZB + 0.08)) ** 2.3))
def ysm(z): return 0.12 + 0.17 * max(0.0, (z - 0.20) / (ZB - 0.20)) ** 2
def hull_half(z):
    b, B_, ys, d = bch(z), Bm(z), ysm(z), dead(z)
    k = yk(z); yc = max(k, min(k + b * math.tan(d), ys - 0.035)); sl = (yc - k) / b if b > 1e-4 else 0
    P = lambda t: (b * t, k + b * t * sl)
    f = 1 - ss(0.7, 1.3, z); pts = [(0.0, k), P(0.18)]
    for ts in (0.36, 0.68):  # lift strakes: a flat running face and a vertical outer face
        w = 0.03 * f; A = P(ts); C = P(min(ts + (w / b if b > 1e-3 else 0), 0.99))
        pts += [A, (C[0], A[1] - 0.001 * f), C, P(ts + 0.15)]
    xq = min(b + 0.035 * (1 - ss(1.0, 1.5, z)), max(b, B_ - 0.012)); yq = yc - 0.004
    pts += [(b, yc), (xq, yq)]
    for s in (0.2, 0.45, 0.7, 0.88):
        pts.append((xq + (B_ - xq) * (1 - (1 - s) ** 2), yq + (ys - yq) * s))
    pts.append((B_, ys))
    return pts
YTOP = [(ZB, 0.31), (1.40, 0.41), (1.10, 0.50), (0.85, 0.565), (0.65, 0.63), (0.47, 0.665), (0.10, 0.665)]
YF, YP = 0.15, 0.205
def deck_half(z):
    B_, ys = Bm(z), ysm(z)
    well = [(B_, ys), (B_ + 0.004, ys + 0.08), (B_ - 0.004, ys + 0.16), (B_ - 0.03, ys + 0.198), (B_ - 0.07, ys + 0.203),
            (B_ - 0.095, ys + 0.18), (B_ - 0.11, YF + 0.06), (B_ - 0.125, YF + 0.012), (B_ - 0.15, YF), (0.35, YF),
            (0.26, YF + 0.004), (0.237, YF + 0.02), (0.226, 0.26), (0.21, 0.33), (0.12, 0.343), (0.0, 0.347)]
    yt = interp(YTOP, z); dome = []
    for i in range(16):
        th = (math.pi / 2) * (i / 15) ** 0.9
        dome.append((B_ * max(math.cos(th), 0) ** (2 / 2.8), ys + (yt - ys) * math.sin(th) ** (2 / 2.8)))
    plat = [(B_, ys), (B_ + 0.003, ys + 0.045), (B_ - 0.012, YP)] + [(lerp(B_ - 0.03, 0.0, i / 12), YP + 0.002 * (i / 12)) for i in range(13)]
    wh, wp = ss(0.20, 0.47, z), 1 - ss(-1.36, -1.17, z); ww = max(0.0, 1 - wh - wp)
    return [(well[i][0] * ww + dome[i][0] * wh + plat[i][0] * wp, well[i][1] * ww + dome[i][1] * wh + plat[i][1] * wp) for i in range(16)]
def section(z):  # closed loop: starboard rail -> keel -> port rail -> deck centre -> starboard rail
    h = hull_half(z); d = deck_half(z)
    return [(-x, y) for x, y in h[::-1]] + h[1:] + d[1:] + [(-x, y) for x, y in d[::-1][1:-1]], len(h)
NST = 96
ZST = [ZS + (ZB - ZS) * (0.5 - 0.5 * math.cos(math.pi * i / (NST - 1))) for i in range(NST)]

def clip_area(poly, w):  # area of the polygon below y = w (Sutherland-Hodgman against one half plane)
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ia, ib = a[1] <= w, b[1] <= w
        if ia: out.append(a)
        if ia != ib:
            t = (w - a[1]) / (b[1] - a[1]); out.append((a[0] + (b[0] - a[0]) * t, w))
    return abs(sum(out[i][0] * out[(i + 1) % len(out)][1] - out[(i + 1) % len(out)][0] * out[i][1] for i in range(len(out)))) / 2 if len(out) > 2 else 0.0
def displaced(w):
    A = [clip_area(section(z)[0], w) for z in ZST]
    return sum((A[i] + A[i + 1]) / 2 * (ZST[i + 1] - ZST[i]) for i in range(NST - 1))
lo, hi = -0.25, 0.3
for _ in range(50):
    mid = (lo + hi) / 2
    if displaced(mid) < MASS / RHO: lo = mid
    else: hi = mid
W = (lo + hi) / 2
log('static waterline (pre-shift y)', round(W, 4), 'displaced m3', round(displaced(W), 4), 'target', round(MASS / RHO, 4))
def S(p): return (p[0], p[1] - W, p[2])  # shift into the contract frame (waterline at y = 0)

hull = Acc(); bars = Acc(); noz = Acc()
rings = []
for z in ZST:
    sec, nh = section(z); rings.append([S((x, y, z)) for x, y in sec])
V, F = loft(rings, closed=True, cap0=True)
NH = 2 * nh - 1  # hull points in each ring
def hull_mat(i, fv):
    n = len(rings[0]); j = i % n if i < (NST - 1) * n else 0
    if i >= (NST - 1) * n: return HULLC  # transom cap
    z = sum(v[2] for v in fv) / len(fv)
    if z > 1.505: return GBLACK  # gloss black nose cap
    if j < NH - 1: return HULLC  # dark lower hull
    di = j - (NH - 1) if j < NH - 1 + 15 else (n - 1 - j) + 1 if j < n - 1 else 0  # deck half index at the face's rail end
    if di == 0: return TEXB  # textured black bumper band above the rub rail
    return DECK
hull.add(V, F, None, hull_mat)

def half_at(z, y, part='hull'):  # outer half-width of the hull topside at height y (contract frame)
    h = [(x, yy - W) for x, yy in hull_half(z)]
    for (x0, y0), (x1, y1) in zip(h, h[1:]):
        if min(y0, y1) <= y <= max(y0, y1) and y1 != y0: return x0 + (x1 - x0) * (y - y0) / (y1 - y0)
    return h[-1][0]

# sponsons, aft on each side at the waterline: a sharp-edged wedge with a flat running face and a keel fin
for sd in (1, -1):
    rr = []; fin = []
    for i in range(24):
        z = lerp(-1.44, -0.70, i / 23); e = ss(0.0, 0.18, i / 23) * (1 - ss(0.82, 1.0, i / 23)) ** 0.5
        xt, xb = half_at(z, 0.045), half_at(z, -0.035)
        rr.append([(sd * (xt - 0.006), 0.045, z), (sd * min(xt + 0.047 * e, 0.617), 0.028, z), (sd * min(xb + 0.064 * e, 0.617), -0.022, z),
                   (sd * min(xb + 0.060 * e, 0.613), -0.034, z), (sd * (xb - 0.006), -0.035, z)])
        if 5 <= i <= 17:
            f = math.sin(math.pi * (i - 5) / 12) ** 0.7; x0 = sd * min(xb + 0.05 * e, 0.603)
            fin.append([(x0 - sd * 0.004, -0.03, z), (x0 + sd * 0.004, -0.03, z), (x0 + sd * 0.002, -0.03 - 0.045 * f, z), (x0 - sd * 0.002, -0.03 - 0.045 * f, z)])
    V, F = loft(rr, closed=True, cap0=True, cap1=True); hull.add(V, F, TEXB)
    V, F = loft(fin, closed=True, cap0=True, cap1=True); hull.add(V, F, TEXB)
    for zb in (-1.30, -1.07, -0.84):  # sponson mounting bolts
        xf = min(lerp(half_at(zb, 0.045) + 0.047, half_at(zb, -0.035) + 0.064, 0.56), 0.617) - 0.003
        V, F = revolve([(0.0, 0.0), (0.009, 0.0), (0.009, 0.004), (0.0, 0.006)], (sd * xf, 0.0, zb), (sd, 0, 0), 8); hull.add(V, F, STEEL)

# topside spray strakes: a sharp wedge along each bow topside, just above the chine
def ycz(z): return min(yk(z) + bch(z) * math.tan(dead(z)), ysm(z) - 0.035) - W
for sd in (1, -1):
    rr = []
    for i in range(40):
        z = lerp(-0.30, 1.30, i / 39); e = ss(0.0, 0.12, i / 39) * (1 - ss(0.72, 1.0, i / 39))
        y = ycz(z) + 0.22 * (ysm(z) - W - ycz(z)) - 0.004
        rr.append([(sd * (half_at(z, y + 0.016) - 0.002), y + 0.016, z), (sd * (half_at(z, y) + 0.013 * e), y - 0.001, z), (sd * (half_at(z, y - 0.004) - 0.002), y - 0.004, z)])
    V, F = loft(rr, closed=True, cap0=True, cap1=True); hull.add(V, F, HULLC)

# rub rail along the hull/deck seam: black rubber with a brushed insert (outer face stays at Bm + 0.019)
for sd in (1, -1):
    path = [(sd * (Bm(z) + 0.006), ysm(z) - W, z) for z in ZST[1:-1] if Bm(z) > 0.02]
    V, F = tube(path, 0.011, seg=8, ry=0.017); hull.add(V, F, RUBBER)
    path = [(sd * (Bm(z) + 0.0155), ysm(z) - W + 0.001, z) for z in ZST[2:-2] if Bm(z) > 0.06]
    V, F = tube(path, 0.0035, seg=6, ry=0.005); hull.add(V, F, ALU)

# seat: sculpted and tiered (driver, bolster crest, passenger), light grey sides, teal piping, black top
# with a carbon-look insert panel set in a sewn groove, transverse seams and a passenger grab strap.
# The driver section (z 0.14 .. -0.36) and the centre crown keep the old heights: the rider clips sit on them.
SEAT_YT = [(0.24, 0.52), (0.14, 0.62), (-0.36, 0.625), (-0.47, 0.692), (-0.58, 0.674), (-1.10, 0.675), (-1.22, 0.58)]
def seat_ring(z, t):
    yt = interp(SEAT_YT, z)
    ws = interp([(0.24, 0.12), (0.12, 0.175), (-0.30, 0.19), (-0.60, 0.205), (-1.12, 0.20), (-1.22, 0.15)], z)
    yb = 0.34; x5 = ws - 0.07; xg = (x5 + 0.06) / 2; gw = 0.0035 * ss(0.0, 0.03, x5 - 0.06); yg = yt + 0.0055
    half = [(ws - 0.035, yb), (ws - 0.018, yb + 0.05), (ws + 0.006, yt - 0.12), (ws + 0.01, yt - 0.075), (ws + 0.009, yt - 0.066),
            (ws - 0.004, yt - 0.045), (ws - 0.03, yt - 0.018), (x5, yt - 0.003),
            (xg + gw, yg), (xg, yg - 0.0045 * (gw > 1e-4)), (xg - gw, yg), (0.06, yt + 0.014), (0.0, yt + 0.018)]
    ring = [(x, y) for x, y in half] + [(-x, y) for x, y in half[::-1][1:-1]]
    return [S((x, y, z)) for x, y in ring]
sz = [lerp(0.24, -1.22, i / 47) for i in range(48)]
V, F = loft([seat_ring(z, 0) for z in sz], closed=True, cap0=True, cap1=True)
NSR = len(seat_ring(0.0, 0))
SEAT_ZONE = {**{k: SEATD for k in (0, 1, 2, 21, 22, 23)}, 3: PIPE, 20: PIPE, **{k: SEAM for k in (8, 9, 14, 15)}, **{k: SEATC for k in (10, 11, 12, 13)}}
hull.add(V, F, None, lambda i, fv: SEAT_ZONE.get(i % NSR, VSIDE) if i < 47 * NSR else SEATD)
def seat_out(z, k0, k1, d):  # seat surface points k0..k1 at station z, pushed out from the seat core by d
    R = seat_ring(z, 0); c = Vector(S((0.0, interp(SEAT_YT, z) - 0.09, z)))
    return [tuple(Vector(p) + (Vector(p) - c).normalized() * d) for p in R[k0:k1 + 1]]
for zs_ in (-0.365, -0.585, -1.10):  # transverse seams at the tier breaks
    V, F = tube(seat_out(zs_, 3, 21, 0.0005), 0.0026, seg=6); hull.add(V, F, SEAM)
rr = [[a0, b0, b1, a1] for a0, b0, a1, b1 in zip(seat_out(-0.775, 1, 23, 0.001), seat_out(-0.775, 1, 23, 0.007), seat_out(-0.825, 1, 23, 0.001), seat_out(-0.825, 1, 23, 0.007))]
V, F = loft(rr, cap0=True, cap1=True); hull.add(V, F, RUBBER)  # passenger grab strap across the seat
for k in (1, 23):
    p = Vector(seat_out(-0.80, k, k, 0.006)[0]); V, F = rbox(p, (0.012, 0.03, 0.058), 0.003); hull.add(V, F, STEEL)
# seat back strap / rear grab handle
V, F = tube([S((0.13 * math.cos(a), 0.60 + 0.07 * math.sin(a), -1.23 - 0.05 * math.sin(a))) for a in [math.pi * k / 16 for k in range(17)]], 0.014, seg=8)
hull.add(V, F, PLASTIC)

# footwell mats (ribbed) and the swim platform mat
for sd in (1, -1):
    x0, x1 = 0.262, None
    zs = [lerp(-0.98, 0.16, i / 12) for i in range(13)]
    rr = []
    for z in zs:
        x1 = Bm(z) - 0.155; rr.append([S((sd * x0, YF + 0.004, z)), S((sd * x1, YF + 0.004, z)), S((sd * x1, YF + 0.012, z)), S((sd * x0, YF + 0.012, z))])
    V, F = loft(rr, closed=True, cap0=True, cap1=True); hull.add(V, F, MATG)
    for r_ in range(6):
        xr = lerp(x0 + 0.02, 0.585 - 0.175, r_ / 5)
        V, F = rbox(S((sd * xr, YF + 0.016, -0.41)), (0.009, 0.008, 1.08)); hull.add(V, F, MAT_TEAL if r_ in (0, 5) else MATG)
V, F = rbox(S((0, YP + 0.006, -1.43)), (0.94, 0.010, 0.29), 0.004); hull.add(V, F, MATG)  # swim platform mat
for zz in (-1.575, -1.285):
    V, F = rbox(S((0, YP + 0.0115, zz)), (0.94, 0.003, 0.012)); hull.add(V, F, MAT_TEAL)
for sd in (1, -1):
    V, F = rbox(S((sd * 0.464, YP + 0.0115, -1.43)), (0.012, 0.003, 0.29)); hull.add(V, F, MAT_TEAL)
for r_ in range(5):  # chevron grip pads
    for c_ in range(14):
        x = lerp(-0.40, 0.40, c_ / 13)
        V, F = rbox(S((x, YP + 0.0125, -1.54 + 0.055 * r_)), (0.042, 0.004, 0.014), 0.0, rotY(28 if x > 0 else -28)); hull.add(V, F, MATL)

# console: gauge pod (visor, glass, LCD bars), steering column boot, mirrors, hood vents
GZ, GY = 0.61, interp(YTOP, 0.61) - W
V, F = rbox((0, GY + 0.015, GZ + 0.03), (0.42, 0.10, 0.24), 0.035, rotX(10)); hull.add(V, F, TEXB)  # dash cowl
RD = rotX(50); UX, VY, NN = Vector((1, 0, 0)), RD @ Vector((0, 1, 0)), RD @ Vector((0, 0, -1))
DC = Vector((0, GY + 0.08, GZ - 0.005))  # display centre; the screen faces up and aft at the rider
def dpart(du, dv, dn, size, m):
    V, F = rbox(DC + UX * du + VY * dv + NN * dn, size, 0.0, RD); hull.add(V, F, m)
V, F = rbox(DC, (0.27, 0.15, 0.03), 0.01, RD); hull.add(V, F, GBLACK)  # bezel
dpart(0, 0, 0.0155, (0.236, 0.114, 0.003), TFT)
for k in range(9):  # rpm bar graph
    h = 0.012 + 0.006 * k; dpart(-0.106 + 0.0095 * k, -0.035 + h / 2, 0.0175, (0.006, h, 0.002), LCDO if k > 6 else LCD)
for k, du in enumerate((-0.008, 0.018)):  # speed digits and unit bar
    dpart(du, 0.004, 0.0175, (0.021, 0.04, 0.002), LCDW)
dpart(0.005, -0.031, 0.0175, (0.045, 0.006, 0.002), LCD)
for k in range(5):  # fuel stack
    dpart(0.086, -0.036 + 0.016 * k, 0.0175, (0.022, 0.009, 0.002), LCDO if k == 0 else LCD)
dpart(0.0, 0.047, 0.0175, (0.20, 0.004, 0.002), LCD)  # status line
V, F = rbox(DC + Vector((0, 0.058, 0.03)), (0.32, 0.014, 0.12), 0.005, rotX(8)); hull.add(V, F, GBLACK)  # visor brow over the display
for sd in (1, -1):
    V, F = rbox(DC + Vector((sd * 0.152, 0.008, 0.018)), (0.014, 0.10, 0.13), 0.004); hull.add(V, F, GBLACK)  # binnacle cheeks
PIV = (0.0, interp(YTOP, 0.47) - W + 0.04, 0.47)
V, F = revolve([(0.0, -0.06), (0.075, -0.06), (0.076, -0.04), (0.074, -0.02), (0.069, 0.0), (0.062, 0.02), (0.054, 0.04), (0.048, 0.058), (0.045, 0.07), (0.0, 0.07)], (PIV[0], PIV[1] - 0.06, PIV[2]), (0, 1, 0), 36)
hull.add(V, F, RUBBER)
for sd in (1, -1):
    a = S((sd * 0.25, 0.60, 0.70)); b = (sd * 0.36, a[1] + 0.07, 0.66); c = (sd * 0.42, a[1] + 0.09, 0.655)
    V, F = tube([a, (sd * 0.31, a[1] + 0.045, 0.68), b], 0.013, seg=8, ry=0.02); hull.add(V, F, PLASTIC)
    V, F = rbox(c, (0.17, 0.065, 0.05), 0.022, rotY(sd * -10) @ rotZ(sd * 6)); hull.add(V, F, PLASTIC)
    V, F = rbox((c[0], c[1], c[2] - 0.026), (0.145, 0.045, 0.004), 0.002, rotY(sd * -10) @ rotZ(sd * 6)); hull.add(V, F, MIRROR)

# stern: venturi, ride plate, intake grate, reboarding step, cleats, tow and bow eyes, grab handles
NZ = (0.0, -0.135, ZS - 0.005)
V, F = revolve([(0.0, 0.20), (0.078, 0.20), (0.076, 0.05), (0.072, 0.0), (0.066, -0.004), (0.0, -0.004)], NZ, (0, 0, 1), 20); hull.add(V, F, PLASTIC)
def vplate(w, top, ins, z0, z1, m):  # transom plate whose lower edge follows the V of the hull bottom
    k, t = yk(ZS) - W, math.tan(dead(ZS)); P = [(-w, top), (w, top), (w, k + w * t + ins), (0, k + ins), (-w, k + w * t + ins)]
    V, F = loft([[(x, y, z0) for x, y in P], [(x, y, z1) for x, y in P]], closed=True, cap0=True, cap1=True); hull.add(V, F, m)
vplate(0.22, 0.03, 0.012, ZS + 0.002, ZS - 0.006, TEXB)  # pump surround
vplate(0.17, 0.0, 0.035, ZS - 0.005, ZS - 0.0075, HOLE)  # recessed pump tunnel
V, F = rbox((0, yk(-1.45) - W - 0.002, -1.49), (0.25, 0.005, 0.34), 0.002); hull.add(V, F, ALU)  # ride plate, lip aft of the transom
for i in range(4):
    for sd in (1, -1):
        V, F = rbox((sd * (0.05 + 0.04 * i), yk(-1.45) - W + (0.05 + 0.04 * i) * math.tan(dead(-1.45)) - 0.006, -1.45), (0.008, 0.004, 0.26), 0.0, rotZ(sd * -22))
        hull.add(V, F, STEEL)
gz0, gz1 = -0.92, -0.50
rr = []
for z in [lerp(gz0, gz1, i / 8) for i in range(9)]:
    k = yk(z) - W; t = math.tan(dead(z)); rr.append([(x, k + abs(x) * t - 0.002, z) for x in (-0.11, -0.055, 0.0, 0.055, 0.11)])
V, F = loft(rr); hull.add(V, F, HOLE)
for x in (-0.09, -0.06, -0.03, 0.0, 0.03, 0.06, 0.09):
    y = yk(-0.71) - W + abs(x) * math.tan(dead(-0.71)) - 0.004
    V, F = rbox((x, y, -0.71), (0.009, 0.009, 0.43), 0.002, rotZ(-22 if x > 0 else 22 if x < 0 else 0)); hull.add(V, F, STEEL)
V, F = rbox((0, YP - W - 0.15, ZS - 0.07), (0.26, 0.016, 0.10), 0.006); hull.add(V, F, PLASTIC)  # step
for sd in (1, -1):
    V, F = rbox((sd * 0.11, YP - W - 0.08, ZS - 0.03), (0.016, 0.15, 0.022), 0.005, rotX(18)); hull.add(V, F, PLASTIC)
    V, F = rbox((sd * 0.44, YP - W + 0.02, -1.53), (0.03, 0.022, 0.13), 0.008); hull.add(V, F, STEEL)  # cleat
    V, F = rbox((sd * 0.44, YP - W + 0.008, -1.53), (0.018, 0.014, 0.05), 0.004); hull.add(V, F, STEEL)
    V, F = tube([S((sd * (Bm(z) - 0.04), ysm(z) + 0.215 + 0.03 * math.sin(math.pi * (z + 1.18) / 0.3), z)) for z in [lerp(-1.18, -0.88, k / 10) for k in range(11)]], 0.012, seg=8)
    hull.add(V, F, PLASTIC)  # side grab handles on the gunwale
V, F = tube([(0.035 * math.cos(a), YP - W + 0.035 * math.sin(a), -1.575) for a in [math.pi * k / 10 for k in range(11)]], 0.007, seg=8); hull.add(V, F, STEEL)
V, F = tube([(0.028 * math.cos(a), yk(ZB - 0.07) - W + 0.02 + 0.028 * math.sin(a), ZB - 0.035) for a in [math.pi * (k / 10 - 1) for k in range(11)]], 0.007, seg=8); hull.add(V, F, STEEL)
V, F = revolve([(0.0, 0.0), (0.035, 0.0), (0.035, 0.012), (0.0, 0.016)], S((0.30, YF + 0.23, -1.10)), (0, 1, 0), 16); hull.add(V, F, STEEL)  # fuel cap
for x in (-0.09, 0.09):  # ride plate bolts
    for zz in (-1.63, -1.36):
        V, F = revolve([(0.0, 0.0), (0.008, 0.0), (0.008, 0.002), (0.0, 0.0025)], (x, yk(-1.45) - W - 0.0045, zz), (0, -1, 0), 8); hull.add(V, F, STEEL)
V, F = revolve([(0.0, 0.0), (0.095, 0.0), (0.095, 0.006), (0.08, 0.009), (0.0, 0.009)], (0, NZ[1], ZS - 0.007), (0, 0, -1), 24); hull.add(V, F, ALU)  # pump flange
for k in range(6):
    a = math.pi / 6 + 2 * math.pi * k / 6
    V, F = revolve([(0.0, 0.0), (0.0065, 0.0), (0.0065, 0.004), (0.0, 0.005)], (0.087 * math.cos(a), NZ[1] + 0.087 * math.sin(a), ZS - 0.015), (0, 0, -1), 6); hull.add(V, F, STEEL)
rr = []  # reverse bucket, raised (forward drive): a flared half shell over the nozzle
for q in range(7):
    zz = lerp(ZS - 0.022, ZS - 0.105, q / 6); fl = 0.014 * (q / 6) ** 1.5; ro, ri = 0.127 + fl, 0.118 + fl
    arc = [math.radians(lerp(18, 162, a_ / 14)) for a_ in range(15)]
    rr.append([(ro * math.cos(a), NZ[1] + ro * math.sin(a), zz) for a in arc] + [(ri * math.cos(a), NZ[1] + ri * math.sin(a), zz) for a in arc[::-1]])
V, F = loft(rr, closed=True, cap0=True, cap1=True); hull.add(V, F, TEXB)
for sd in (1, -1):
    V, F = rbox((sd * 0.127, NZ[1] + 0.035, ZS - 0.03), (0.008, 0.05, 0.06), 0.003); hull.add(V, F, TEXB)  # bucket arms
    V, F = revolve([(0.0, 0.0), (0.011, 0.0), (0.011, 0.006), (0.0, 0.007)], (sd * 0.131, NZ[1] + 0.035, ZS - 0.035), (sd, 0, 0), 8); hull.add(V, F, STEEL)
    V, F = revolve([(0.0, 0.0), (0.018, 0.0), (0.016, 0.012), (0.009, 0.022), (0.0, 0.022)], (sd * 0.20, -0.07, ZS), (0, 0, -1), 10); hull.add(V, F, RUBBER)  # cable boots
    end = (-0.083, NZ[1], ZS - 0.04) if sd < 0 else (0.136, NZ[1] + 0.035, ZS - 0.035)  # steering rod to the nozzle arm, reverse rod to the bucket
    V, F = tube([(sd * 0.20, -0.07, ZS - 0.02), end], 0.0055, seg=8); hull.add(V, F, STEEL)
    V, F = revolve([(0.0, -0.011), (0.009, -0.008), (0.011, 0.0), (0.009, 0.008), (0.0, 0.011)], end, (0, 1, 0), 8); hull.add(V, F, STEEL)  # ball joint
    V, F = revolve([(0.0, 0.0), (0.02, 0.0), (0.02, 0.005), (0.012, 0.007), (0.0, 0.007)], (sd * 0.31, 0.045, ZS), (0, 0, -1), 14); hull.add(V, F, PLASTIC)  # bilge outlet
    V, F = revolve([(0.0, 0.0), (0.0115, 0.0), (0.0115, 0.0075), (0.0, 0.0075)], (sd * 0.31, 0.045, ZS), (0, 0, -1), 12); hull.add(V, F, HOLE)
V, F = tube([(x, YP - W - 0.004, ZS - 0.004) for x in (-0.52, -0.3, 0.0, 0.3, 0.52)], 0.01, seg=8); hull.add(V, F, RUBBER)  # transom edge bumper
for k in range(5):  # grip ribs on the reboarding step
    V, F = rbox((0, YP - W - 0.142 + 0.0005, ZS - 0.106 + 0.018 * k), (0.235, 0.004, 0.007)); hull.add(V, F, RUBBER)

# ------------------------------------------------------------------ handlebars (own pivot, rotates about local Y)
GRIP_Y, GRIP_Z, GRIP_X0, GRIP_X1 = PIV[1] + 0.135, PIV[2] - 0.17, 0.265, 0.405
GL = ((GRIP_X0 + GRIP_X1) / 2, GRIP_Y, GRIP_Z)
V, F = rbox((0, PIV[1] + 0.045, PIV[2] + 0.005), (0.11, 0.10, 0.10), 0.03); bars.add(V, F, PLASTIC)
V, F = rbox((0, PIV[1] + 0.105, PIV[2] - 0.035), (0.30, 0.045, 0.065), 0.02); bars.add(V, F, RUBBER)  # bar pad
V, F = rbox((0, PIV[1] + 0.1285, PIV[2] - 0.035), (0.05, 0.003, 0.028), 0.001); bars.add(V, F, ORANGE)  # pad badge
for sd in (1, -1):
    V, F = rbox((sd * 0.09, PIV[1] + 0.1282, PIV[2] - 0.035), (0.09, 0.0025, 0.006)); bars.add(V, F, PIPE)
for sd in (1, -1):
    path = [(sd * x, GRIP_Y - 0.03 + 0.03 * ss(0, 1, x / GRIP_X0), lerp(PIV[2] - 0.04, GRIP_Z, ss(0, 1, x / GRIP_X0))) for x in [GRIP_X1 * k / 16 for k in range(17)]]
    V, F = tube(path, 0.011, seg=10); bars.add(V, F, STEEL)
    prof = [(0.0, 0.0), (0.019, 0.0)] + [(0.018 + 0.0025 * (k % 2), 0.008 + 0.0115 * k) for k in range(11)] + [(0.021, 0.128), (0.024, 0.132), (0.024, 0.142), (0.0, 0.145)]
    V, F = revolve(prof, (sd * GRIP_X0, GRIP_Y, GRIP_Z), (sd, 0, 0), 14); bars.add(V, F, RUBBER)
    V, F = rbox((sd * (GRIP_X0 - 0.03), GRIP_Y + 0.005, GRIP_Z), (0.05, 0.05, 0.055), 0.012); bars.add(V, F, PLASTIC)  # switch pod
    V, F = revolve([(0.0, 0.0), (0.009, 0.0), (0.009, 0.006), (0.0, 0.008)], (sd * (GRIP_X0 - 0.03), GRIP_Y + 0.03, GRIP_Z + 0.005), (0, 1, 0), 10)
    bars.add(V, F, GREEN if sd > 0 else RED)
    lev = [(sd * (GRIP_X0 + 0.005 + 0.1 * k / 8), GRIP_Y - 0.004 - 0.012 * math.sin(math.pi * k / 8), GRIP_Z + 0.035 + 0.006 * k / 8) for k in range(9)]
    V, F = tube(lev, 0.006, seg=6, ry=0.011); bars.add(V, F, PLASTIC)  # throttle (right) and brake/reverse (left) levers
coil = [(-(GRIP_X0 - 0.03) + 0.011 * math.cos(a), GRIP_Y - 0.015 - 0.05 * a / (8 * math.pi), GRIP_Z - 0.03 - 0.04 * a / (8 * math.pi) + 0.011 * math.sin(a)) for a in [8 * math.pi * k / 96 for k in range(97)]]

# ------------------------------------------------------------------ steering nozzle (own pivot, rotates about local Y)
NP = (0.0, NZ[1], ZS - 0.01)
V, F = revolve([(0.0, 0.0), (0.068, 0.0), (0.066, -0.03), (0.057, -0.08), (0.051, -0.105), (0.048, -0.11), (0.0, -0.11)], NP, (0, 0, 1), 20); noz.add(V, F, PLASTIC)
for sd in (1, -1):
    V, F = rbox((sd * 0.075, NP[1], NP[2] - 0.03), (0.012, 0.035, 0.05), 0.004); noz.add(V, F, STEEL)
V, F = rbox((0, NP[1] + 0.075, NP[2] - 0.04), (0.02, 0.05, 0.08), 0.004); noz.add(V, F, STEEL)

# ------------------------------------------------------------------ objects
def make(name, acc, origin=(0, 0, 0), smooth=38):
    me = bpy.data.meshes.new(name); O = Vector(origin)
    me.from_pydata([B(Vector(v) - O) for v in acc.V], [], acc.F)
    names = sorted(set(acc.M), key=list(MATS).index)
    for n in names: me.materials.append(MATS[n])
    me.polygons.foreach_set('material_index', [names.index(m) for m in acc.M])
    me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(smooth))
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.location = B(O)
    return ob
root = bpy.data.objects.new('Jetski', None); bpy.context.collection.objects.link(root)
H = make('Hull', hull); H.parent = root

# livery decals: geometry projected onto the hull along X (orange swoosh + pinstripe, wordmark, numbers)
FONTD = bpy.data.fonts.load(FONT)
def project(ob, axis='X', off=0.0018, neg=True, pos=True):  # axis in the glTF frame
    ob.matrix_world = Matrix.Identity(4)
    m = ob.modifiers.new('sw', 'SHRINKWRAP'); m.target = H; m.wrap_method = 'PROJECT'
    m.use_project_x, m.use_project_y, m.use_project_z = axis == 'X', axis == 'Z', axis == 'Y'
    m.use_negative_direction = neg; m.use_positive_direction = pos; m.offset = off
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    V = [G(v.co) for v in me.vertices]; F = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob); return V, F
def ribbon(sd, s0, s1, top, bot, n=90, rows=3, off=0.0018):
    V, F = [], []; R = rows + 1
    for i in range(n + 1):
        z = lerp(s0, s1, i / n)
        for j in range(R): V.append(B((sd * 0.9, lerp(bot(z), top(z), j / rows), z)))
        if i: F += [((i - 1) * R + j, (i - 1) * R + j + 1, i * R + j + 1, i * R + j) if sd > 0 else ((i - 1) * R + j, i * R + j, i * R + j + 1, (i - 1) * R + j + 1) for j in range(rows)]
    me = bpy.data.meshes.new('rib'); me.from_pydata(V, [], F); ob = bpy.data.objects.new('rib', me); bpy.context.collection.objects.link(ob)
    return project(ob, off=off)
def text(sd, body, size, z, y, shear=0.2, space=1.0, off=0.0018):
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.font = FONTD; cu.size = size; cu.shear = shear
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3; cu.space_character = space
    ob = bpy.data.objects.new('t', cu); bpy.context.collection.objects.link(ob)
    R = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))) if sd > 0 else Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))
    ob.matrix_world = Matrix.Translation(B((sd * 0.9, y, z))) @ R.to_4x4()
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me.transform(ob.matrix_world); bpy.data.objects.remove(ob)
    o2 = bpy.data.objects.new('t2', me); bpy.context.collection.objects.link(o2); return project(o2, off=off)
def patch(fn, nu, nv, axis, off=0.0018, neg=True, pos=True):  # fn(u, v) -> glTF point off the surface, projected along axis
    V = [B(fn(i / nu, j / nv)) for i in range(nu + 1) for j in range(nv + 1)]
    F = [(i * (nv + 1) + j, (i + 1) * (nv + 1) + j, (i + 1) * (nv + 1) + j + 1, i * (nv + 1) + j + 1) for i in range(nu) for j in range(nv)]
    me = bpy.data.meshes.new('pat'); me.from_pydata(V, [], F); ob = bpy.data.objects.new('pat', me); bpy.context.collection.objects.link(ob)
    return project(ob, axis, off, neg, pos)
def relief(VF, d, top, wall):  # raise a projected patch by d into a thin panel: top face plus side walls (the panel gap)
    V, F = VF; n = len(V); d = Vector(d); T = [tuple(Vector(v) + d) for v in V]; ec = {}
    for f in F:
        for a, b in zip(f, f[1:] + f[:1]): ec[(min(a, b), max(a, b))] = ec.get((min(a, b), max(a, b)), 0) + 1
    walls = [(a, b, b + n, a + n) for f in F for a, b in zip(f, f[1:] + f[:1]) if ec[(min(a, b), max(a, b))] == 1]
    nf = len(F); dec.add(list(V) + T, [tuple(k + n for k in f) for f in F] + walls, None, lambda i, fv: top if i < nf else wall)
dec = Acc()
rail = lambda z: ysm(z) - W
ptop = lambda z: rail(z) + 0.021 + lerp(0.024, 0.135, ss(-1.44, -1.12, z)) * (1 - ss(0.0, 0.98, z))  # black mid panel: square at the
pbot = lambda z: rail(z) + 0.021                                                                     # stern, a spear toward the bow
PR = 0.0032  # mid panel relief; graphics on it sit just above
for sd in (1, -1):
    ycz = lambda z: min(yk(z) + bch(z) * math.tan(dead(z)), ysm(z) - 0.035) - W  # the chine: stripes stay above it
    top = lambda z: ysm(z) - W - 0.022
    bot = lambda z: max(top(z) - 0.022 - 0.045 * math.exp(-((z - 0.05) / 0.5) ** 2) - 0.012 * ss(0.6, 1.3, z), ycz(z) + 0.012)
    tp = lambda z, z1: ss(-1.50, -1.36, z) * (1 - ss(z1 - 0.2, z1, z))  # stripes taper to a point at both ends
    def taper(a, b, z1): return (lambda z: (a(z) + b(z)) / 2 + (a(z) - b(z)) / 2 * tp(z, z1)), (lambda z: (a(z) + b(z)) / 2 - (a(z) - b(z)) / 2 * tp(z, z1))
    relief(ribbon(sd, -1.565, 0.98, ptop, pbot, n=130, rows=6), (sd * PR, 0, 0), TEXB, SEAM)
    tpz = lambda z: ss(-1.22, -0.95, z) * (1 - ss(0.20, 0.58, z))
    V, F = ribbon(sd, -1.22, 0.58, lambda z: ptop(z) - 0.009, lambda z: ptop(z) - 0.009 - 0.011 * tpz(z), n=90, off=0.0018 + PR + 0.0012); dec.add(V, F, ORANGE)
    tpl = lambda z: ss(-1.50, -1.30, z) * (1 - ss(0.35, 0.75, z))
    V, F = ribbon(sd, -1.50, 0.75, lambda z: pbot(z) + 0.016, lambda z: pbot(z) + 0.016 - 0.004 * tpl(z), n=90, off=0.0018 + PR + 0.0012); dec.add(V, F, INK)
    tpp = lambda z: ss(-1.50, -1.36, z) * (1 - ss(0.96, 1.16, z))
    V, F = ribbon(sd, -1.50, 1.16, lambda z: rail(z) - 0.024, lambda z: rail(z) - 0.024 - 0.005 * tpp(z)); dec.add(V, F, INK)  # hull pinstripe
    V, F = text(sd, 'RIPTIDE', 0.092, -0.60, pbot(-0.60) + 0.068, 0.22, 1.05, off=0.0018 + PR + 0.0012); dec.add(V, F, WHITE)
    V, F = text(sd, 'RX-300', 0.045, -1.24, pbot(-1.24) + 0.05, 0.2, off=0.0018 + PR + 0.0012); dec.add(V, F, ORANGE)
    V, F = text(sd, 'TW 4821 QW', 0.052, 1.02, ysm(1.02) - W + 0.085, 0.0, 1.1); dec.add(V, F, WHITE)
    V, F = ribbon(sd, -1.50, 0.22, lambda z: 0.011 - 0.004 * ss(-0.1, 0.22, z), lambda z: -0.004); dec.add(V, F, STAIN)
    vz0, vz1, sl = 0.60, 0.88, 0.07  # side intake vents: textured frame, dark opening, raised fins
    vpt = lambda u, v, e=0.0: (sd * 0.9, rail(lerp(vz0, vz1, u)) + lerp(0.155 - e, 0.245 + e, v), lerp(vz0, vz1, u) + sl * v)
    relief(patch(lambda u, v: vpt(lerp(-0.05, 1.05, u), v, 0.012), 18, 4, 'X'), (sd * 0.0035, 0, 0), TEXB, SEAM)
    V, F = patch(vpt, 16, 4, 'X', off=0.0018 + 0.0036); dec.add(V, F, HOLE)
    for k in range(6):
        u0 = 0.08 + 0.15 * k
        relief(patch(lambda u, v, u0=u0: vpt(u0 + 0.045 * u, v), 1, 4, 'X'), (sd * 0.007, 0, 0), TEXB, TEXB)
hw = lambda z: interp([(0.80, 0.19), (0.85, 0.245), (1.02, 0.225), (1.22, 0.16), (1.40, 0.05)], z)  # front storage hatch
relief(patch(lambda u, v: ((u * 2 - 1) * hw(lerp(0.80, 1.40, v)), 1.3, lerp(0.80, 1.40, v)), 18, 30, 'Y', pos=False), (0, 0.003, 0), GBLACK, SEAM)
for sd in (1, -1):  # hood seams: the hood top panel (with the hatch) is a separate moulding from the side panels
    hs = lambda z: min(hw(z) + 0.075, Bm(z) - 0.10)
    V, F = patch(lambda u, v: (sd * (hs(lerp(0.60, 1.44, u)) + 0.005 * v), 1.3, lerp(0.60, 1.44, u)), 60, 1, 'Y', off=0.0022, pos=False); dec.add(V, F, SEAM)
V, F = rbox((0, interp(YTOP, 0.815) - W + 0.009, 0.815), (0.08, 0.01, 0.022), 0.003); dec.add(V, F, TEXB)  # hatch latch
relief(patch(lambda u, v: (lerp(-0.13, 0.13, u), lerp(0.505, 0.575, v), 0.262), 12, 4, 'Z', neg=True, pos=False), (0, 0, -0.003), TEXB, SEAM)  # glove box lid
def text_flat(body, size, pos, shear=0.2):  # flat lettering on the transom plane, reading from astern
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.font = FONTD; cu.size = size; cu.shear = shear
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3
    ob = bpy.data.objects.new('t', cu); bpy.context.collection.objects.link(ob)
    ob.matrix_world = Matrix.Translation(B(pos)) @ Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0))).to_4x4()
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); me.transform(ob.matrix_world)
    bpy.data.objects.remove(ob); return [G(v.co) for v in me.vertices], [tuple(p.vertices) for p in me.polygons]
TB = [(-0.53, 0.193), (0.53, 0.193), (0.552, 0.13), (0.505, 0.098), (-0.505, 0.098), (-0.552, 0.13)]  # black transom band
V, F = loft([[(x, y, ZS - 0.001) for x, y in TB], [(x, y, ZS - 0.0035) for x, y in TB]], closed=True, cap0=True, cap1=True); dec.add(V, F, TEXB)
V, F = text_flat('RIPTIDE', 0.058, (-0.33, 0.146, ZS - 0.0045)); dec.add(V, F, WHITE)
V, F = text_flat('RX-300', 0.05, (0.33, 0.146, ZS - 0.0045)); dec.add(V, F, ORANGE)
D = make('Livery', dec, smooth=60)
# fold decals into the hull mesh
me = H.data; bm = bmesh.new(); bm.from_mesh(me); bm2 = bmesh.new(); bm2.from_mesh(D.data)
off = len(me.materials); remap = {}
for i, m in enumerate(D.data.materials):
    j = next((k for k, mm in enumerate(me.materials) if mm == m), None)
    if j is None: me.materials.append(m); j = len(me.materials) - 1
    remap[i] = j
vm = [bm.verts.new(v.co) for v in bm2.verts]
for f in bm2.faces:
    try: nf = bm.faces.new([vm[v.index] for v in f.verts]); nf.material_index = remap[f.material_index]; nf.smooth = True
    except ValueError: pass
bm.to_mesh(me); bm.free(); bm2.free(); bpy.data.objects.remove(D)
me.set_sharp_from_angle(angle=math.radians(38))

BARS = make('Bars', bars, PIV, smooth=40); BARS.parent = root
NOZ = make('Nozzle', noz, NP, smooth=40); NOZ.parent = root
def empty(name, p, parent=root, pivot=(0, 0, 0), rz=0.0):
    e = bpy.data.objects.new(name, None); e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.05
    bpy.context.collection.objects.link(e); e.parent = parent; e.location = B(Vector(p) - Vector(pivot)); e.rotation_euler = (0, 0, rz)
    return e
SEAT = S((0.0, 0.625 + 0.115, -0.17))
GRIPL, GRIPR = (GL[0], GL[1], GL[2]), (-GL[0], GL[1], GL[2])
FOOTL, FOOTR = S((0.355, YF + 0.012, 0.06)), S((-0.355, YF + 0.012, 0.06))
JET = (0.0, NP[1], NP[2] - 0.11)
BOW = (0.0, ysm(ZB) - W, ZB)
SPZ = 0.80; SPL = (half_at(SPZ, 0.0), 0.0, SPZ); SPR = (-SPL[0], 0.0, SPZ)
empty('Seat', SEAT); empty('FootL', FOOTL); empty('FootR', FOOTR); empty('Bow', BOW); empty('SprayL', SPL); empty('SprayR', SPR)
empty('GripL', GRIPL, BARS, PIV); empty('GripR', GRIPR, BARS, PIV)
empty('JetOut', JET, NOZ, NP, rz=math.pi)  # local +Z (glTF) points aft

# ------------------------------------------------------------------ hydro samples, mass properties, export
samples = []
for z in (-1.40, -0.95, -0.50, -0.05, 0.40, 0.85):
    b, d, k = bch(z), dead(z), yk(z) - W
    for t in (-0.72, -0.25, 0.25, 0.72):
        x = t * b; y = k + abs(x) * min(math.tan(d), (ysm(z) - 0.035 - W - k) / b)
        n = Vector((math.copysign(math.sin(d), x), -math.cos(d), 0)).normalized()
        samples.append(dict(p=[round(x, 3), round(y, 3), z], n=[round(n.x, 3), round(n.y, 3), 0.0], area=round(0.45 * b * 0.5 / math.cos(d), 4), kind='bottom'))
for z in (-0.90, 0.30):
    for sd in (1, -1):
        b = bch(z); yc = min(yk(z) + b * math.tan(dead(z)), ysm(z) - 0.035) - W
        samples.append(dict(p=[round(sd * (b + 0.035), 3), round(yc, 3), z], n=[round(sd * 0.98, 3), -0.2, 0.0], area=0.06, kind='chine'))
for sd in (1, -1):
    samples.append(dict(p=[round(sd * (half_at(-1.07, -0.03) + 0.06), 3), -0.03, -1.07], n=[round(sd * 0.5, 3), -0.866, 0.0], area=0.045, kind='sponson'))
bpy.context.view_layer.update()
def bbox(objs):
    P = [G(o.matrix_world @ Vector(c)) for o in objs for c in o.bound_box]
    return [round(min(p[i] for p in P), 3) for i in range(3)], [round(max(p[i] for p in P), 3) for i in range(3)]
mmin, mmax = bbox([H, BARS, NOZ])  # measured, detail included
ENV = ([-0.619, -0.257, -1.72], [0.619, 0.88, 1.632])  # contract envelope (the first build's bbox): lengths and inertia derive from it,
assert all(abs(a - b) <= 0.01 for a, b in zip(mmin + mmax, ENV[0] + ENV[1])), ('detail grew the envelope', mmin, mmax)  # so detail can't nudge them
bmin, bmax = ENV
log('BBOX measured', mmin, mmax)
L_, W_, H_ = bmax[2] - bmin[2], bmax[0] - bmin[0], bmax[1] - bmin[1]
inertia = [round(0.65 * MASS / 12 * (0.75 ** 2 + L_ ** 2)), round(0.65 * MASS / 12 * (W_ ** 2 + L_ ** 2)), round(0.65 * MASS / 12 * (W_ ** 2 + 0.75 ** 2))]
r3 = lambda p: [round(float(c), 4) for c in p]
info = dict(samples=samples, lengthM=round(L_, 3), beamM=round(W_, 3), heightM=round(H_, 3), massKg=MASS, inertia=inertia,
            cog=[0.0, -0.06, -0.18], waterline='y = 0 is the static waterline at 350 kg in sea water (1025 kg/m3), level trim',
            frame='glTF: Y up, +Z forward, +X = rider left, metres; origin on the centreline, static waterline, midships',
            nodes={'Hull': 'body mesh', 'Bars': 'handlebar pivot, steer about local Y (+ = left), about +-25 deg',
                   'Nozzle': 'steering nozzle pivot, about local Y, about +-20 deg', 'GripL/GripR': 'children of Bars',
                   'JetOut': 'child of Nozzle, local +Z points aft'},
            points=dict(Seat=r3(SEAT), GripL=r3(GRIPL), GripR=r3(GRIPR), FootL=r3(FOOTL), FootR=r3(FOOTR), JetOut=r3(JET), Bow=r3(BOW),
                        SprayL=r3(SPL), SprayR=r3(SPR), barsPivot=r3(PIV), nozzlePivot=r3(NP)),
            notes='samples: planing bottom grid (6 stations x 4, real deadrise), chines and sponsons; n = outward surface normal, area = m2 of hull surface each point stands for',
            bboxMin=bmin, bboxMax=bmax)
CONTRACT = dict(Seat=[0.0, 0.742, -0.17], GripL=[0.335, 0.842, 0.3], GripR=[-0.335, 0.842, 0.3], FootL=[0.355, 0.164, 0.06],
                FootR=[-0.355, 0.164, 0.06], JetOut=[0.0, -0.135, -1.72], Bow=[0.0, 0.292, 1.62], SprayL=[0.3215, 0.0, 0.8],
                SprayR=[-0.3215, 0.0, 0.8], barsPivot=[0.0, 0.707, 0.47], nozzlePivot=[0.0, -0.135, -1.61])
for k_, v_ in CONTRACT.items():  # the physics lane and the rider clips are pinned to these; detail must never move them
    assert all(abs(a - b) < 6e-4 for a, b in zip(info['points'][k_], v_)), ('contract moved', k_, info['points'][k_], v_)
assert len(samples) == 30 and inertia == [224, 242, 40] and info['cog'] == [0.0, -0.06, -0.18], ('contract moved', len(samples), inertia)
json.dump(info, open(OUTJ, 'w'), indent=1)
root.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_cameras=False,
                          export_lights=False, export_animations=False, export_extras=True)
tris = sum(len(p.vertices) - 2 for o in (H, BARS, NOZ) for p in o.data.polygons)
log('EXPORTED', OUT, os.path.getsize(OUT), 'bytes, tris', tris, 'dims LxWxH', round(L_, 3), round(W_, 3), round(H_, 3))
log('POINTS', json.dumps(info['points']))
log('BBOX', bmin, bmax, 'samples', len(samples), 'inertia', inertia)
