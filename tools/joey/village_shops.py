"""Shop fit-outs for tools/joey/village_build.py, run in its namespace (exec) at the start of its interiors section.

Fluorescent troffers and patterned floors for every shop, and the two trading shops modelled piece by piece:
  - Joey Island Tackle & Bait: a rod rack of rods with grips, reel seats, guides and seated reels, a pegboard gondola
    of carded hard-body lures and soft plastics in blister packs, a glass reel cabinet, a till and EFTPOS, line spools
    and boxed reels behind the counter, a bait freezer with glass lids, a live-bait tank, tackle boxes and eskies,
    a fish chart, a bag-limits poster and a mounted fish.
  - Joey Island Gifts: plush joeys, snow globes, stubby holders, mugs, folded and hung tea towels, T-shirts, bucket
    hats, a postcard spinner, a fridge-magnet board and a till.
Colours ride on the vertex colours of the shared palette materials (family() in the builder), so variety costs no
draw calls. Terminal frame, metres; the helpers (box, obox, cyl, blob, text, col, ...) are the builder's.
"""
import colorsys

R = random.Random(1961)           # the fit-outs' own stream, so the builder's layout stream is untouched
_PAINT = {}
def paint(rgb, r=0.5, m=0.0):
    """A plain colour (it folds into a palette material)."""
    key = (tuple(round(c, 3) for c in rgb), r, m)
    if key not in _PAINT: _PAINT[key] = M(f'Col{len(_PAINT)}', key[0], m, r)
    return _PAINT[key]
def hsvc(h, s, v, r=0.5): return paint(colorsys.hsv_to_rgb(h % 1.0, s, v), r)
def clear(name, rgb, alpha, rough=0.05):
    mat = M(name, rgb, 0.0, rough); mat.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = alpha
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'BLENDED'
    if hasattr(mat, 'blend_method'): mat.blend_method = 'BLEND'
    return mat

# patterned surfaces (the pattern is drawn by src/joey/Village.js from the material name)
PAT_VINYL = M('WPatVinyl', (0.5, 0.51, 0.5), 0.0, 0.42)          # 300 mm commercial vinyl tiles, two tones
PAT_BOARDS = M('WPatBoards', (0.62, 0.42, 0.24), 0.0, 0.48)        # timber boards, staggered joints
PAT_PEG = M('WPatPeg', (0.62, 0.52, 0.38), 0.0, 0.8)             # pegboard holes
FLOORS = {'cafe': FLOOR_G, 'tackle': PAT_VINYL, 'gifts': PAT_BOARDS}
BLISTER = clear('BlisterGlass', (0.85, 0.9, 0.92), 0.3)
WATER = clear('TankWaterGlass', (0.08, 0.3, 0.28), 0.5, 0.02)
DOME = clear('GlobeGlassClear', (0.85, 0.92, 0.95), 0.22)
TROF, INK, KRAFT = paint((0.86, 0.86, 0.84), 0.4), paint((0.03, 0.03, 0.035), 0.6), paint((0.62, 0.5, 0.34), 0.8)
PAPER, FELT, EVA = paint((0.9, 0.9, 0.87), 0.7), paint((0.02, 0.02, 0.022), 0.95), paint((0.03, 0.03, 0.03), 0.85)
UP, XP, ZP = Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))

def troffer(x, z):
    """A recessed 1200 x 600 fluorescent troffer: white steel frame, prismatic diffuser, a divider between the tubes."""
    box(I, TROF, x - 0.31, x + 0.31, CEIL_Y - 0.014, CEIL_Y, z - 0.61, z + 0.61)
    box(I, PANEL, x - 0.27, x + 0.27, CEIL_Y - 0.02, CEIL_Y - 0.014, z - 0.57, z + 0.57)
    box(I, TROF, x - 0.02, x + 0.02, CEIL_Y - 0.026, CEIL_Y - 0.02, z - 0.57, z + 0.57)

def panel_text(body, p, size, mat, face, font=FONT_SIGN, extrude=0.0): text(I, body, p, size, mat, face, font, extrude)

def counter(x0, x1, z0, z1, top, cab=None):
    """A shop counter: timber carcass, vertical lining boards and a kick plate on the customer (+x) face, laminate top.
    cab = z where a glass display cabinet (from z0) gives way to the solid counter."""
    zc = cab if cab else z0
    if cab: box(I, TIMBER, x0, x1 - 0.02, FL, 3.55, z0, zc)
    box(I, TIMBER, x0, x1 - 0.02, FL, top, zc, z1)
    box(I, INK, x1 - 0.05, x1 + 0.002, FL, FL + 0.1, z0, z1)
    n = int((z1 - z0) / 0.2)
    for i in range(n):
        z = z0 + (z1 - z0) * i / n; hi = 3.55 if cab and z < zc else top
        box(I, LINING2 if i % 2 else LINING, x1 - 0.02, x1, FL + 0.1, hi, z + 0.004, z + (z1 - z0) / n - 0.004)
    box(I, LAMINATE, x0 - 0.04, x1 + 0.03, top, top + 0.04, zc - (0 if cab else 0.03), z1 + 0.03)
    box(I, TIMBER, x1 + 0.0, x1 + 0.035, top - 0.03, top + 0.04, zc, z1 + 0.03)            # timber nosing

def till(x0, x1, top, z):
    """Cash drawer, POS screen facing the keeper (-x) with a customer display, receipt printer, and an EFTPOS
    terminal on a swivel stand at the customer edge, tilted up toward the customer (+x)."""
    y = top + 0.04
    box(I, INK, x0 + 0.05, x0 + 0.47, y, y + 0.1, z - 0.22, z + 0.22)
    box(I, paint((0.2, 0.2, 0.21), 0.5), x0 + 0.47, x0 + 0.475, y + 0.02, y + 0.08, z - 0.2, z + 0.2)
    cyl(I, GALV, (x0 + 0.26, y + 0.1, z), (x0 + 0.26, y + 0.24, z), 0.012, 6)
    obox(I, INK, (x0 + 0.26, y + 0.34, z), (0.018, 0, 0), (0, 0.11, 0), (0, 0, 0.16))
    obox(I, SCREEN, (x0 + 0.241, y + 0.34, z), (0.002, 0, 0), (0, 0.095, 0), (0, 0, 0.145))
    obox(I, SCREEN, (x0 + 0.279, y + 0.31, z), (0.002, 0, 0), (0, 0.03, 0), (0, 0, 0.07))
    box(I, PAPER, x0 + 0.08, x0 + 0.24, y, y + 0.1, z + 0.28, z + 0.44)
    box(I, INK, x0 + 0.1, x0 + 0.22, y + 0.1, y + 0.105, z + 0.3, z + 0.42)
    obox(I, PAPER, (x0 + 0.16, y + 0.135, z + 0.36), (0.0005, 0, 0), (0, 0.03, 0), (0, 0, 0.035))
    ex, ez = x1 - 0.14, z + 0.62
    cyl(I, GALV, (ex, y, ez), (ex, y + 0.05, ez), 0.03, 8)
    n = Vector((0.5, 0.866, 0)); a = Vector((0.866, -0.5, 0)); c = Vector((ex, y + 0.1, ez))
    obox(I, INK, c, a * 0.085, ZP * 0.042, n * 0.014)
    obox(I, SCREEN, c + n * 0.0145 - a * 0.042, a * 0.03, ZP * 0.03, n * 0.001)
    obox(I, paint((0.25, 0.25, 0.27), 0.6), c + n * 0.0145 + a * 0.035, a * 0.036, ZP * 0.032, n * 0.001)
    for k in range(12):
        kc = c + n * 0.016 + a * (0.012 + 0.016 * (k // 3)) + ZP * (-0.02 + 0.02 * (k % 3))
        obox(I, RED if k == 9 else YELLOW if k == 10 else paint((0.1, 0.35, 0.12), 0.5) if k == 11 else PAPER, kc, a * 0.006, ZP * 0.007, n * 0.002)

def spinning_reel(p, axis, out, body, spool, s=1.0):
    """A spinning reel: foot from p along `out`, gearbox, rotor cup and line spool along `axis`, a handle and knob."""
    p, a, o = Vector(p), Vector(axis).normalized(), Vector(out).normalized(); sd = a.cross(o).normalized()
    obox(I, body, p + o * 0.03 * s, a * 0.02 * s, o * 0.03 * s, sd * 0.005 * s)
    c = p + o * 0.075 * s
    obox(I, body, c, a * 0.032 * s, o * 0.026 * s, sd * 0.022 * s)
    cyl(I, body, c + a * 0.03 * s, c + a * 0.062 * s, 0.03 * s, 10, 0.026 * s)
    cyl(I, spool, c + a * 0.062 * s, c + a * 0.095 * s, 0.024 * s, 10)
    cyl(I, STAINLESS, c + sd * 0.022 * s, c + sd * 0.068 * s + o * 0.02 * s, 0.004 * s, 4)
    obox(I, INK, c + sd * 0.07 * s + o * 0.034 * s, sd * 0.008 * s, o * 0.015 * s, a * 0.008 * s)

REEL_BODY = [paint((0.02, 0.02, 0.025), 0.35, 0.6), paint((0.55, 0.42, 0.12), 0.3, 0.9), paint((0.5, 0.52, 0.55), 0.3, 0.9),
             paint((0.25, 0.03, 0.03), 0.35, 0.6), paint((0.03, 0.08, 0.25), 0.35, 0.6)]
LINE = [paint((0.9, 0.85, 0.05), 0.5), paint((0.05, 0.45, 0.12), 0.5), paint((0.85, 0.85, 0.85), 0.4), paint((0.8, 0.2, 0.05), 0.5),
        paint((0.1, 0.3, 0.6), 0.5)]
def shop_rod(b, t, blank, grip, reel, out):
    """A rod standing butt-down: butt cap, grip, reel seat, fore grip, a tapered blank and four guides, and a reel."""
    b, t = Vector(b), Vector(t); d = (t - b).normalized(); L = (t - b).length
    o = Vector(out); o = (o - d * o.dot(d)).normalized(); sd = o.cross(d)
    cyl(I, INK, b, b + d * 0.02, 0.017, 8)
    cyl(I, grip, b + d * 0.02, b + d * 0.38, 0.016, 7, 0.013)
    cyl(I, STAINLESS, b + d * 0.38, b + d * 0.47, 0.012, 8)
    cyl(I, grip, b + d * 0.47, b + d * 0.58, 0.013, 7, 0.0105)
    cyl(I, blank, b + d * 0.58, t, 0.0085, 6, 0.0022, caps=False)
    for k in range(4):
        u = 0.58 + (L - 0.6) * (0.12 + 0.86 * (k / 3) ** 1.3); p = b + d * u; r = 0.017 * (1 - 0.55 * k / 3)
        obox(I, STAINLESS, p + o * 0.007, o * 0.007, d * 0.004, sd * 0.0015)
        q = p + o * (r + 0.013); cyl(I, STAINLESS, q - d * 0.002, q + d * 0.002, r, 6, caps=False)
    if reel: spinning_reel(b + d * 0.425, d, o, reel[0], reel[1])

def fish_shape(mat, c, L, h, u, v, g=I):
    """A flat fish in the plane of unit vectors u (nose) and v (up): body, forked tail, a dorsal fin."""
    c, u, v = Vector(c), Vector(u), Vector(v); pts = []
    for k in range(12):
        a = 2 * math.pi * k / 12; x = math.cos(a); y = math.sin(a) * (1 - 0.45 * max(0.0, -x))
        pts.append(c + u * (x * L * 0.36 + L * 0.06) + v * (y * h * 0.5))
    add(g, mat, pts, [tuple(range(12))])
    add(g, mat, [c - u * L * 0.28, c - u * L * 0.5 + v * h * 0.42, c - u * L * 0.42, c - u * L * 0.5 - v * h * 0.42], [(0, 1, 2, 3)])
    add(g, mat, [c + u * L * 0.12 + v * h * 0.4, c - u * L * 0.06 + v * h * 0.62, c - u * L * 0.18 + v * h * 0.38], [(0, 1, 2)])

def carded(p, side, kind):
    """A peg hook out of the board at p (side = +1/-1 along x) with a card hanging on it: a hard-body lure in a
    blister, or a soft-plastic bag of worms with a header card; one more card behind it on the hook."""
    x, y, z = p; s = side
    obox(I, GALV, (x + s * 0.075, y, z), (0.075, 0, 0), (0, 0.003, 0), (0, 0, 0.003))
    box(I, hsvc(R.random(), 0.5, 0.5, 0.6), x + s * 0.02, x + s * 0.024, y - 0.17, y + 0.012, z - 0.045, z + 0.045)
    cx = x + s * 0.05
    if kind == 'lure':
        box(I, hsvc(R.choice((0.0, 0.08, 0.58, 0.62, 0.3)), 0.75, 0.55, 0.55), cx - 0.002, cx + 0.002, y - 0.18, y + 0.012, z - 0.048, z + 0.048)
        body = R.choice([paint((0.75, 0.9, 0.1), 0.25), paint((0.9, 0.3, 0.5), 0.25), paint((0.72, 0.74, 0.76), 0.2, 0.9),
                         paint((0.8, 0.6, 0.15), 0.2, 0.9), paint((0.1, 0.3, 0.7), 0.25), paint((0.9, 0.45, 0.05), 0.25)])
        cyl(I, body, (cx + s * 0.012, y - 0.15, z), (cx + s * 0.012, y - 0.07, z), 0.012, 6, 0.007)
        obox(I, BLISTER, (cx + s * 0.013, y - 0.105, z), (0.016, 0, 0), (0, 0.06, 0), (0, 0, 0.03))
    else:
        h = R.random()
        box(I, hsvc(h, 0.25, 0.8, 0.35), cx - 0.004, cx + 0.004, y - 0.19, y - 0.03, z - 0.045, z + 0.045)
        box(I, PAPER, cx - 0.005, cx + 0.005, y - 0.03, y + 0.012, z - 0.047, z + 0.047)
        worm = hsvc(h + R.uniform(-0.05, 0.05), 0.8, 0.5, 0.4)
        for k in (-1, 1): obox(I, worm, (cx + s * 0.006, y - 0.11, z + k * 0.014), (0.002, 0, 0), (0, 0.065, 0.006 * k), (0, 0, 0.005))

def fit_tackle():
    # the counter: a glass reel cabinet at the customer end, then the till
    cx0, cx1, cz0, cz1, top = 39.5, 40.2, -67.8, -63.8, 4.35
    counter(cx0, cx1, cz0, cz1, top, cab=-66.0)
    box(I, FELT, cx0 + 0.02, cx1 - 0.04, 3.55, 3.57, cz0 + 0.02, -66.02)
    for (x, z) in ((cx0 + 0.012, cz0 + 0.012), (cx1 - 0.032, cz0 + 0.012), (cx0 + 0.012, -66.012), (cx1 - 0.032, -66.012)):
        box(I, STAINLESS, x - 0.012, x + 0.012, 3.55, top + 0.04, z - 0.012, z + 0.012)
    box(I, GLASS, cx1 - 0.03, cx1 - 0.022, 3.57, top + 0.03, cz0 + 0.024, -66.024)
    box(I, GLASS, cx0 + 0.004, cx0 + 0.012, 3.57, top + 0.03, cz0 + 0.024, -66.024)
    box(I, GLASS, cx0, cx1 - 0.02, 3.57, top + 0.03, cz0 + 0.004, cz0 + 0.012)
    box(I, GLASS, cx0, cx1 - 0.02, top + 0.03, top + 0.04, cz0, -66.0)
    box(I, GLASS, cx0 + 0.02, cx1 - 0.04, 3.95, 3.958, cz0 + 0.03, -66.03)
    box(I, FRIDGE_GLOW, cx0 + 0.06, cx1 - 0.08, top + 0.018, top + 0.028, cz0 + 0.05, -66.05)
    for lvl, y in enumerate((3.57, 3.958)):
        for j in range(4):
            z = cz0 + 0.24 + 0.44 * j + (0.1 if lvl else 0)
            spinning_reel((cx0 + 0.36, y, z), (0, 0, 1), (0, 1, 0), R.choice(REEL_BODY), R.choice(REEL_BODY), R.uniform(1.0, 1.35))
            box(I, PAPER, cx0 + 0.5, cx0 + 0.56, y, y + 0.035, z + 0.1, z + 0.14)
    till(cx0, cx1, top, -65.1)
    col('solid', cx0 - 0.04, cx1 + 0.03, FL, top + 0.04, cz0 - 0.03, cz1 + 0.03)
    # behind the counter: line spools and boxed reels on shelving along the side wall
    box(I, MDF, 37.1, 37.14, FL, 5.45, -68.0, -61.0)
    for z in (-68.0, -65.7, -63.3, -61.0): box(I, MDF, 37.1, 37.52, FL, 5.45, z - 0.015, z + 0.015)
    for y in (3.5, 4.1, 4.65, 5.2): box(I, MDF, 37.1, 37.52, y - 0.025, y, -68.0, -61.0)
    for y in (4.65,):
        z = -67.9
        while z < -61.2:
            r = R.uniform(0.04, 0.06); m = R.choice(LINE)
            cyl(I, m, (37.2, y + r, z + r), (37.33, y + r, z + r), r * 0.9, 7)
            cyl(I, R.choice((INK, PAPER, RED)), (37.33, y + r, z + r), (37.345, y + r, z + r), r, 7)
            z += 2 * r + R.uniform(0.02, 0.05)
    for y, z in ((3.5, -67.9), (4.1, -67.9)):
      while z < -61.3:
        w = R.uniform(0.12, 0.16); h = R.uniform(0.1, 0.14); m = R.choice(REEL_BODY[:1] + [NAVY, RED, TEAL])
        box(I, m, 37.16, 37.46, y, y + h, z, z + w); box(I, PAPER, 37.46, 37.462, y + h * 0.3, y + h * 0.7, z + 0.02, z + w - 0.02)
        z += w + R.uniform(0.02, 0.06)
    for k in range(14):
        z = -67.8 + 0.47 * k; box(I, hsvc(R.random(), 0.3, 0.6, 0.7), 37.18, 37.4, 5.2, 5.2 + R.uniform(0.05, 0.1), z, z + 0.18)
    col('solid', 37.1, 37.52, FL, 5.45, -68.0, -60.9)
    # bait freezer: a hollow chest with a stainless rim and two sliding glass lids over the packs of bait
    fx0, fx1, fz0, fz1 = 37.4, 38.95, -69.55, -68.8
    box(I, INK, fx0 + 0.03, fx1 - 0.03, FL, FL + 0.08, fz0 + 0.03, fz1 - 0.03)
    for (a, b, c, d) in ((fx0, fx1, fz0, fz0 + 0.06), (fx0, fx1, fz1 - 0.06, fz1), (fx0, fx0 + 0.06, fz0, fz1), (fx1 - 0.06, fx1, fz0, fz1)):
        box(I, FREEZER, a, b, FL + 0.08, 4.18, c, d); box(I, STAINLESS, a, b, 4.18, 4.2, c, d)
    box(I, paint((0.8, 0.86, 0.9), 0.6), fx0 + 0.06, fx1 - 0.06, FL + 0.08, 3.9, fz0 + 0.06, fz1 - 0.06)
    for k in range(12):
        x = fx0 + 0.14 + 0.24 * (k % 6) + R.uniform(-0.03, 0.03); z = fz0 + 0.22 + 0.3 * (k // 6) + R.uniform(-0.03, 0.03)
        kind = R.choice(((0.1, 0.3, 0.7), (0.75, 0.1, 0.1), (0.9, 0.5, 0.35), (0.85, 0.85, 0.8)))
        obox(I, paint(kind, 0.35), (x, 3.93, z), (0.1, 0, 0), (0, 0.03, 0), (0, 0, 0.065))
        obox(I, PAPER, (x, 3.962, z), (0.06, 0, 0), (0, 0.002, 0), (0, 0, 0.04))
    box(I, GLASS, fx0 + 0.06, (fx0 + fx1) / 2 + 0.05, 4.2, 4.208, fz0 + 0.02, fz1 - 0.02)
    box(I, GLASS, (fx0 + fx1) / 2 - 0.05, fx1 - 0.06, 4.21, 4.218, fz0 + 0.02, fz1 - 0.02)
    for x in (fx0 + 0.12, fx1 - 0.12): box(I, INK, x - 0.05, x + 0.05, 4.215, 4.235, fz1 - 0.1, fz1 - 0.06)
    box(I, NAVY, 37.62, 38.73, 3.66, 4.06, fz1, fz1 + 0.006)
    panel_text('FROZEN BAIT', ((fx0 + fx1) / 2, 3.86, fz1 + 0.008), 0.1, ORANGE, 'N')
    col('solid', fx0, fx1, FL, 4.24, fz0, fz1)
    # live-bait tank on a galvanised stand in the front corner, aerated, with a few baitfish
    tx0, tx1, tz0, tz1, ty = 44.35, 45.6, -69.6, -68.75, FL + 0.72
    for x in (tx0 + 0.03, tx1 - 0.03):
        for z in (tz0 + 0.03, tz1 - 0.03): box(I, GALV, x - 0.02, x + 0.02, FL, ty, z - 0.02, z + 0.02)
    box(I, GALV, tx0, tx1, ty - 0.04, ty, tz0, tz1); box(I, GALV, tx0 + 0.03, tx1 - 0.03, FL + 0.15, FL + 0.17, tz0 + 0.03, tz1 - 0.03)
    box(I, INK, tx0 + 0.15, tx0 + 0.4, FL + 0.17, FL + 0.3, tz0 + 0.2, tz0 + 0.4)
    box(I, paint((0.3, 0.27, 0.22), 0.95), tx0 + 0.015, tx1 - 0.015, ty, ty + 0.04, tz0 + 0.015, tz1 - 0.015)
    box(I, WATER, tx0 + 0.02, tx1 - 0.02, ty + 0.04, ty + 0.42, tz0 + 0.02, tz1 - 0.02)
    for (a, b, c, d) in ((tx0, tx1, tz0, tz0 + 0.01), (tx0, tx1, tz1 - 0.01, tz1), (tx0, tx0 + 0.01, tz0, tz1), (tx1 - 0.01, tx1, tz0, tz1)):
        box(I, GLASS, a, b, ty, ty + 0.5, c, d); box(I, INK, a, b, ty + 0.5, ty + 0.52, c, d)
    for k in range(9):
        c = Vector((R.uniform(tx0 + 0.15, tx1 - 0.15), ty + R.uniform(0.1, 0.36), R.uniform(tz0 + 0.12, tz1 - 0.12))); a = R.uniform(0, math.pi)
        obox(I, paint((0.62, 0.66, 0.66), 0.25, 0.8), c, Vector((math.cos(a), 0, math.sin(a))) * 0.05, UP * 0.013, Vector((-math.sin(a), 0, math.cos(a))) * 0.006)
    hose = paint((0.75, 0.82, 0.8), 0.3)
    cyl(I, hose, (tx0 + 0.27, FL + 0.3, tz0 + 0.3), (tx0 + 0.3, ty + 0.56, tz0 + 0.3), 0.004, 4)
    cyl(I, hose, (tx0 + 0.3, ty + 0.56, tz0 + 0.3), (tx0 + 0.35, ty + 0.06, tz0 + 0.35), 0.004, 4)
    for k in range(6): obox(I, PAPER, (tx0 + 0.35 + R.uniform(-0.02, 0.02), ty + 0.08 + 0.055 * k, tz0 + 0.35), (0.005, 0, 0), (0, 0.005, 0), (0, 0, 0.005))
    box(I, YELLOW, tx0 + 0.02, tx0 + 0.03, ty + 0.52, ty + 0.7, tz0 + 0.12, tz1 - 0.12)
    panel_text('LIVE BAIT', (tx0 + 0.015, ty + 0.61, (tz0 + tz1) / 2), 0.075, NAVY, '-X')
    col('solid', tx0, tx1, FL, ty + 0.72, tz0, tz1)
    # the rod rack along the side wall: a timber butt plinth and a top rail, rods resting in it, most with reels
    RX = 45.52
    box(I, TIMBER, RX - 0.2, 45.77, FL, FL + 0.14, -68.4, -62.9); box(I, TIMBER, RX - 0.02, 45.77, 5.3, 5.36, -68.4, -62.9)
    blanks = [paint((0.02, 0.02, 0.025), 0.3, 0.4), paint((0.03, 0.1, 0.32), 0.3, 0.4), paint((0.35, 0.04, 0.03), 0.3, 0.4),
              paint((0.55, 0.48, 0.3), 0.35), paint((0.8, 0.8, 0.78), 0.3), paint((0.1, 0.18, 0.08), 0.3, 0.4)]
    for i in range(20):
        z = -68.2 + 0.265 * i; L = R.uniform(1.95, 2.5)
        base = Vector((RX - 0.1, FL + 0.14, z)); tip = base + Vector((0.16, L, R.uniform(-0.05, 0.05)))
        reel = (R.choice(REEL_BODY), R.choice(LINE)) if R.random() < 0.65 else None
        shop_rod(base, tip, R.choice(blanks), CORK if R.random() < 0.55 else EVA, reel, (-1, 0, 0))
        box(I, INK, RX - 0.02, RX + 0.02, 5.36, 5.37, z - 0.02, z + 0.02)
    col('solid', RX - 0.3, 45.8, FL, 5.8, -68.45, -62.85)
    # fish chart and a mounted mulloway on the side wall past the rods; the bag-limits poster on the back wall
    wx = 45.765
    box(I, paint((0.62, 0.76, 0.84), 0.7), wx - 0.006, wx, 4.1, 5.35, -62.65, -60.75)
    box(I, NAVY, wx - 0.009, wx - 0.006, 5.18, 5.33, -62.63, -60.77)
    panel_text('FISH OF JOEY ISLAND', (wx - 0.011, 5.255, -61.7), 0.065, WHITE, '-X')
    spp = [(0.72, 0.25, 0.25), (0.38, 0.3, 0.2), (0.8, 0.72, 0.52), (0.55, 0.57, 0.6), (0.2, 0.38, 0.4), (0.52, 0.58, 0.45),
           (0.45, 0.42, 0.34), (0.3, 0.34, 0.46), (0.58, 0.5, 0.18)]
    for k, rgb in enumerate(spp):
        zc = -62.3 + 0.6 * (k % 3); yc = 4.95 - 0.36 * (k // 3)
        fish_shape(paint(rgb, 0.5), (wx - 0.01, yc, zc), 0.46, 0.15, (0, 0, 1), (0, 1, 0))
        box(I, INK, wx - 0.011, wx - 0.009, yc - 0.13, yc - 0.115, zc - 0.14, zc + 0.14)
        box(I, RED, wx - 0.011, wx - 0.009, yc - 0.16, yc - 0.148, zc - 0.07, zc + 0.07)
    box(I, TIMBER, 43.2, 44.9, 5.32, 5.86, BZ - WT - 0.02, BZ - WT)
    blob(I, paint((0.48, 0.44, 0.36), 0.35, 0.5), (44.08, 5.6, BZ - WT - 0.06), (0.52, 0.12, 0.045), ICO1)
    fish_shape(paint((0.4, 0.37, 0.3), 0.4), (44.0, 5.6, BZ - WT - 0.07), 1.35, 0.3, (-1, 0, 0), (0, 1, 0))
    obox(I, INK, (43.68, 5.63, BZ - WT - 0.104), (0.012, 0, 0), (0, 0.012, 0), (0, 0, 0.004))
    box(I, PAPER, 40.95, 42.35, 5.1, 6.0, BZ - WT - 0.006, BZ - WT)
    box(I, RED, 40.97, 42.33, 5.8, 5.98, BZ - WT - 0.009, BZ - WT - 0.006)
    panel_text('BAG & SIZE LIMITS', (41.65, 5.89, BZ - WT - 0.011), 0.075, WHITE, 'S')
    for k in range(7):
        y = 5.7 - 0.08 * k; box(I, INK, 41.05, 41.05 + R.uniform(0.5, 0.75), y, y + 0.018, BZ - WT - 0.009, BZ - WT - 0.006)
        box(I, INK, 42.0, 42.22, y, y + 0.018, BZ - WT - 0.009, BZ - WT - 0.006)
    # back wall shelving: eskies, tackle boxes, bags of sinkers and burley
    shelving(40.8, 45.2, -60.62, BZ - WT, levels=(3.55, 4.1, 4.62), stock=False, face=1, tall=5.02)   # back panel on the wall side
    x = 40.9
    while x < 44.7:
        w = R.uniform(0.5, 0.62); m = R.choice((PAPER, paint((0.1, 0.3, 0.65), 0.4), paint((0.8, 0.12, 0.08), 0.4)))
        box(I, m, x, x + w, 3.55, 3.85, -60.58, -60.26); box(I, PAPER if m is not PAPER else paint((0.1, 0.3, 0.65), 0.4), x - 0.01, x + w + 0.01, 3.85, 3.9, -60.59, -60.25)
        box(I, INK, x + w * 0.35, x + w * 0.65, 3.9, 3.93, -60.44, -60.4); x += w + R.uniform(0.04, 0.1)
    x = 40.9
    while x < 44.8:
        w = R.uniform(0.3, 0.4); m = R.choice((paint((0.2, 0.45, 0.25), 0.3), paint((0.3, 0.32, 0.34), 0.4), paint((0.15, 0.25, 0.5), 0.3), paint((0.6, 0.5, 0.1), 0.35)))
        box(I, m, x, x + w, 4.1, 4.24, -60.56, -60.3); box(I, paint((0.05, 0.05, 0.05), 0.5), x, x + w, 4.24, 4.255, -60.565, -60.295)
        box(I, m, x, x + w, 4.255, 4.29, -60.56, -60.3)
        for e in (0.25, 0.75): box(I, INK, x + w * e - 0.015, x + w * e + 0.015, 4.21, 4.27, -60.572, -60.56)
        x += w + R.uniform(0.03, 0.08)
    x = 40.9
    while x < 44.9:
        w = R.uniform(0.14, 0.24); box(I, R.choice((KRAFT, paint((0.7, 0.7, 0.72), 0.5, 0.6), paint((0.25, 0.4, 0.2), 0.8))), x, x + w, 4.62, 4.62 + R.uniform(0.12, 0.26), -60.52, -60.36); x += w + R.uniform(0.02, 0.06)
    # the pegboard gondola: carded lures and soft plastics on hooks both sides, a header, stock in the base
    box(I, PAT_PEG, 42.9, 43.6, 3.62, 5.25, -66.52, -62.28)
    box(I, MDF, 42.8, 43.7, FL + 0.08, 3.62, -66.6, -62.2); box(I, INK, 42.83, 43.67, FL, FL + 0.08, -66.57, -62.23)
    for z in (-66.6, -62.2): box(I, MDF, 42.84, 43.66, FL, 5.3, z - 0.035, z + 0.035)
    box(I, NAVY, 42.86, 43.64, 5.3, 5.5, -65.7, -63.1)
    panel_text('LURES & PLASTICS', (42.855, 5.4, -64.4), 0.12, WHITE, '-X'); panel_text('LURES & PLASTICS', (43.645, 5.4, -64.4), 0.12, WHITE, '+X')
    for side, fx in ((-1, 42.9), (1, 43.6)):
        for r in range(5):
            for j in range(8):
                carded((fx, 5.14 - 0.27 * r, -66.25 + 0.52 * j + (0.13 if r % 2 else 0)), side, 'lure' if r < 3 else 'soft')
    col('solid', 42.8, 43.7, FL, 5.5, -66.6, -62.2)
    station('TackleDoor', (41.3, PATH, -71.0)); station('TackleKeeper', (38.7, FL, -66.0)); station('TackleCounter', (39.85, 4.39, -65.8))

def plush_joey(x, y, z, col_, s=1.0):
    """A plush joey sitting on a shelf, facing the shop (-z): body, head, snout, ears, eyes, pouch, feet and tail."""
    pale = PLUSH_IN
    blob(I, col_, (x, y + 0.1 * s, z), (0.07 * s, 0.1 * s, 0.06 * s), ICO1)
    blob(I, col_, (x, y + 0.235 * s, z - 0.01 * s), (0.05 * s, 0.05 * s, 0.048 * s), ICO1)
    obox(I, col_, (x, y + 0.225 * s, z - 0.055 * s), (0.022 * s, 0, 0), (0, 0.02 * s, 0), (0, 0, 0.022 * s))
    obox(I, INK, (x, y + 0.232 * s, z - 0.078 * s), (0.01 * s, 0, 0), (0, 0.007 * s, 0), (0, 0, 0.003 * s))
    for e in (-1, 1):
        obox(I, col_, (x + e * 0.03 * s, y + 0.3 * s, z), Vector((0.014, 0, 0)) * s, Vector((e * 0.01, 0.04, 0)) * s, Vector((0, 0, 0.006)) * s)
        obox(I, INK, (x + e * 0.02 * s, y + 0.25 * s, z - 0.046 * s), (0.006 * s, 0, 0), (0, 0.006 * s, 0), (0, 0, 0.002 * s))
        obox(I, col_, (x + e * 0.035 * s, y + 0.015 * s, z - 0.06 * s), (0.02 * s, 0, 0), (0, 0.015 * s, 0), (0, 0, 0.05 * s))
    obox(I, pale, (x, y + 0.08 * s, z - 0.057 * s), (0.04 * s, 0, 0), (0, 0.045 * s, 0), (0, 0, 0.005 * s))
    cyl(I, col_, (x, y + 0.03 * s, z + 0.05 * s), (x + 0.03 * s, y + 0.005 * s, z + 0.16 * s), 0.018 * s, 5, 0.008 * s)

def fit_gifts():
    gx0, gx1, cz0, cz1, top = 30.9, 31.6, -67.8, -63.8, 4.3
    counter(gx0, gx1, cz0, cz1, top)
    till(gx0, gx1, top, -64.7)
    cyl(I, DOME, (gx0 + 0.35, top + 0.04, -66.9), (gx0 + 0.35, top + 0.26, -66.9), 0.07, 10)              # lolly jar
    for k in range(10): obox(I, hsvc(R.random(), 0.8, 0.8, 0.3), (gx0 + 0.35 + R.uniform(-0.04, 0.04), top + 0.06 + 0.015 * k, -66.9 + R.uniform(-0.04, 0.04)), (0.012, 0, 0), (0, 0.008, 0), (0, 0, 0.012))
    cyl(I, GALV, (gx0 + 0.35, top + 0.04, -67.45), (gx0 + 0.35, top + 0.36, -67.45), 0.006, 4)              # keyring stand
    obox(I, GALV, (gx0 + 0.35, top + 0.36, -67.45), (0.004, 0, 0), (0, 0.004, 0), (0, 0, 0.14))
    for k in range(7): obox(I, hsvc(R.random(), 0.6, 0.7, 0.4), (gx0 + 0.35, top + 0.3, -67.57 + 0.04 * k), (0.004, 0, 0), (0, 0.03, 0), (0, 0, 0.012))
    col('solid', gx0 - 0.04, gx1 + 0.03, FL, top + 0.04, cz0 - 0.03, cz1 + 0.03)
    # fridge-magnet board behind the counter: a steel sheet in a timber frame, magnets in loose rows
    box(I, paint((0.72, 0.73, 0.72), 0.35, 0.7), 28.62, 28.65, 3.9, 5.3, -68.4, -61.0)
    for (a, b, c, d) in ((3.87, 3.9, -68.43, -60.97), (5.3, 5.33, -68.43, -60.97), (3.9, 5.3, -68.43, -68.4), (3.9, 5.3, -61.0, -60.97)):
        box(I, TIMBER, 28.62, 28.67, a, b, c, d)
    for r in range(8):
        for k in range(10):
            y = 4.0 + 0.16 * r + R.uniform(-0.02, 0.02); z = -68.2 + 0.72 * k + R.uniform(-0.1, 0.25)
            if z > -61.12: continue
            m1, m2 = hsvc(R.random(), 0.6, 0.75, 0.3), hsvc(R.random(), 0.3, 0.9, 0.3)
            if R.random() < 0.4: cyl(I, m1, (28.65, y, z), (28.66, y, z), R.uniform(0.022, 0.032), 8)
            else:
                w, h = R.uniform(0.035, 0.055), R.uniform(0.025, 0.04)
                box(I, m1, 28.65, 28.658, y - h, y + h, z - w, z + w); box(I, m2, 28.658, 28.661, y - h * 0.6, y + h * 0.4, z - w * 0.8, z + w * 0.8)
    # back wall: six bays of shelving with plush joeys, snow globes, stubby holders, mugs, tea towels, hats and thongs
    for j in range(6):
        x0_ = 29.0 + 1.2 * j; box(I, MDF, x0_, x0_ + 1.15, FL, 5.5, BZ - WT - 0.03, BZ - WT)      # open bay: back panel,
        for xs in (x0_, x0_ + 1.13): box(I, MDF, xs, xs + 0.02, FL, 5.5, -60.62, BZ - WT)        # gables and a plinth
        box(I, MDF, x0_, x0_ + 1.15, FL, FL + 0.12, -60.62, BZ - WT)
        for y in (3.9, 4.55, 5.2):
            box(I, MDF, x0_, x0_ + 1.15, y - 0.025, y, -60.62, BZ - WT)
            if j == 0:
                for q in range(3): plush_joey(x0_ + 0.2 + 0.37 * q, y, -60.4, R.choice((PLUSH, PLUSH, paint((0.55, 0.44, 0.32), 0.95))), R.uniform(0.95, 1.15))
            elif j == 1:
                for q in range(3):
                    px = x0_ + 0.2 + 0.37 * q; pz = -60.42
                    cyl(I, R.choice((TIMBER, INK, NAVY)), (px, y, pz), (px, y + 0.05, pz), 0.065, 10, 0.058)
                    box(I, PAPER, px - 0.05, px + 0.05, y + 0.05, y + 0.06, pz - 0.05, pz + 0.05)
                    obox(I, R.choice((RED, PAPER, ORANGE)), (px, y + 0.1, pz), (0.012, 0, 0), (0, 0.04, 0), (0, 0, 0.012))
                    obox(I, PLUSH, (px + 0.025, y + 0.08, pz), (0.018, 0, 0), (0, 0.022, 0), (0, 0, 0.01))
                    blob(I, DOME, (px, y + 0.13, pz), (0.075, 0.075, 0.075), ICO1)
            elif j == 2:
                for q in range(4):
                    px = x0_ + 0.16 + 0.27 * q; pz = -60.42; m = hsvc(R.random(), 0.7, 0.55, 0.9); n = R.randint(2, 3)
                    cyl(I, m, (px, y, pz), (px, y + 0.11 * n, pz), 0.045, 10)
                    for k in range(n): cyl(I, hsvc(R.random(), 0.2, 0.9, 0.9), (px, y + 0.11 * k + 0.035, pz), (px, y + 0.11 * k + 0.075, pz), 0.047, 10, caps=False)
                    disc(I, INK, (px, y + 0.11 * n + 0.001, pz), 0.036, 0.036, 8)
            elif j == 3:
                for q in range(4):
                    px = x0_ + 0.17 + 0.27 * q; pz = -60.42; m = R.choice((PAPER, NAVY, TEAL, paint((0.75, 0.62, 0.35), 0.3)))
                    cyl(I, m, (px, y, pz), (px, y + 0.1, pz), 0.042, 10); disc(I, INK, (px, y + 0.101, pz), 0.036, 0.036, 8)
                    obox(I, m, (px + 0.052, y + 0.05, pz), (0.012, 0, 0), (0, 0.03, 0), (0, 0, 0.006))
            elif j == 4:
                for q in range(3):
                    px = x0_ + 0.2 + 0.37 * q; pz = -60.42; base = hsvc(R.random(), 0.15, 0.85, 0.9); band = hsvc(R.random(), 0.7, 0.5, 0.9)
                    for k in range(R.randint(3, 5)):
                        dx = R.uniform(-0.01, 0.01); box(I, base, px - 0.14 + dx, px + 0.14 + dx, y + 0.028 * k, y + 0.028 * k + 0.026, pz - 0.1, pz + 0.1)
                        box(I, band, px - 0.141 + dx, px + 0.141 + dx, y + 0.028 * k + 0.008, y + 0.028 * k + 0.016, pz - 0.101, pz + 0.101)
            else:
                if y > 5.0:
                    for q in range(3):
                        px = x0_ + 0.2 + 0.37 * q; pz = -60.42; m = R.choice((KRAFT, NAVY, paint((0.35, 0.4, 0.3), 0.9)))
                        cyl(I, m, (px, y + 0.03, pz), (px, y + 0.13, pz), 0.08, 10, 0.07); cyl(I, m, (px, y, pz), (px, y + 0.03, pz), 0.14, 12, 0.13)
                else:
                    for q in range(3):
                        px = x0_ + 0.2 + 0.37 * q; pz = -60.42; m = hsvc(R.random(), 0.7, 0.55, 0.7)
                        for e in (-1, 1):
                            box(I, m, px + e * 0.05 - 0.04, px + e * 0.05 + 0.04, y, y + 0.02, pz - 0.13, pz + 0.13)
                            obox(I, INK, (px + e * 0.05, y + 0.035, pz - 0.05), (0.035, 0, 0), (0, 0.015, 0), (0, 0, 0.004))
    col('solid', 29.0, 36.2, FL, 5.5, -60.62, BZ - WT)
    # postcard spinner: a wire tower of four faces, each with two columns of cards in pockets
    sp = (35.6, -67.2)
    cyl(I, GALV, (sp[0], FL, sp[1]), (sp[0], FL + 1.8, sp[1]), 0.015, 6); cyl(I, INK, (sp[0], FL, sp[1]), (sp[0], FL + 0.03, sp[1]), 0.24, 12)
    obox(I, NAVY, (sp[0], FL + 1.86, sp[1]), (0.16, 0, 0), (0, 0.06, 0), (0, 0, 0.16))
    for k in range(4):
        a = k * math.pi / 2; u = Vector((math.cos(a), 0, math.sin(a))); n = Vector((-u.z, 0, u.x))
        for e in (-1, 1): cyl(I, GALV, Vector((sp[0], FL + 0.45, sp[1])) + n * 0.13 + u * e * 0.15, Vector((sp[0], FL + 1.75, sp[1])) + n * 0.13 + u * e * 0.15, 0.003, 4)
        for r in range(6):
            for c in range(2):
                p = Vector((sp[0], FL + 0.58 + 0.19 * r, sp[1])) + n * 0.125 + u * (-0.075 + 0.15 * c)
                obox(I, PAPER, p, u * 0.06, UP * 0.08, n * 0.002)
                sky = hsvc(0.55 + R.uniform(-0.03, 0.03), R.uniform(0.3, 0.6), 0.85, 0.5); ground = R.choice((paint((0.8, 0.7, 0.45), 0.6), paint((0.1, 0.35, 0.45), 0.5), paint((0.2, 0.4, 0.15), 0.7)))
                obox(I, sky, p + n * 0.0025 + UP * 0.025, u * 0.054, UP * 0.045, n * 0.0005)
                obox(I, ground, p + n * 0.0025 - UP * 0.045, u * 0.054, UP * 0.025, n * 0.0005)
                obox(I, GALV, p + n * 0.004 - UP * 0.05, u * 0.062, UP * 0.022, n * 0.001)
    col('solid', sp[0] - 0.25, sp[0] + 0.25, FL, FL + 1.9, sp[1] - 0.25, sp[1] + 0.25)
    # side wall: tea towels hung on a rail, then T-shirts on hangers
    cyl(I, GALV, (36.72, 5.05, -68.5), (36.72, 5.05, -65.7), 0.012, 6)
    for i in range(7):
        z = -68.3 + 0.38 * i; base = hsvc(R.random(), 0.12, 0.88, 0.9); band = hsvc(R.random(), 0.7, 0.5, 0.9)
        box(I, base, 36.7, 36.712, 4.3, 5.07, z - 0.16, z + 0.16)
        for y in (4.4, 4.95): box(I, band, 36.695, 36.7, y, y + 0.04, z - 0.16, z + 0.16)
        box(I, hsvc(R.random(), 0.6, 0.6, 0.9), 36.695, 36.7, 4.58, 4.78, z - 0.08, z + 0.08)
    box(I, GALV, 36.35, 36.4, 5.0, 5.03, -65.2, -61.5)
    for i in range(10):
        z = -65.0 + 0.36 * i; m = hsvc(R.random(), R.uniform(0.2, 0.7), R.uniform(0.3, 0.85), 0.9)
        cyl(I, GALV, (36.375, 5.03, z), (36.375, 4.98, z), 0.004, 4)
        obox(I, INK, (36.375, 4.97, z), (0.2, -0.03, 0), (0, 0.006, 0), (0, 0, 0.006))
        box(I, m, 36.18, 36.57, 4.28, 4.96, z - 0.012, z + 0.012)
        for e in (-1, 1): obox(I, m, (36.375 + e * 0.24, 4.84, z), (0.06, 0, 0), (0.03 * e, 0.1, 0), (0, 0, 0.011))
        box(I, hsvc(R.random(), 0.6, 0.8, 0.8), 36.3, 36.45, 4.62, 4.8, z - 0.0135, z - 0.012)
    col('solid', 36.0, 36.8, FL, 5.1, -68.6, -61.4)
    # the centre table: folded tea towels, stubby holders and island honey
    box(I, TIMBER, 34.0, 35.6, 4.11, 4.15, -64.6, -62.6)
    for x in (34.05, 35.51):
        for z in (-64.55, -62.69): box(I, TIMBER, x, x + 0.04, FL, 4.11, z, z + 0.04)
    box(I, TIMBER, 34.05, 35.55, 3.6, 3.62, -64.55, -62.65)
    for i in range(4):
        base = hsvc(R.random(), 0.15, 0.85, 0.9); band = hsvc(R.random(), 0.7, 0.5, 0.9)
        for j in range(R.randint(3, 6)):
            dx, dz = R.uniform(-0.012, 0.012), R.uniform(-0.012, 0.012); y = 4.15 + 0.022 * j
            box(I, base, 34.12 + 0.36 * i + dx, 34.4 + 0.36 * i + dx, y, y + 0.02, -64.4 + dz, -64.1 + dz)
            box(I, band, 34.119 + 0.36 * i + dx, 34.401 + 0.36 * i + dx, y + 0.007, y + 0.013, -64.401 + dz, -64.099 + dz)
    for i in range(8):
        px, pz = 34.2 + 0.2 * (i % 4), -63.72 + 0.26 * (i // 4); m = hsvc(R.random(), 0.7, 0.5, 0.9)
        cyl(I, m, (px, 4.15, pz), (px, 4.26, pz), 0.045, 10); cyl(I, PAPER, (px, 4.19, pz), (px, 4.22, pz), 0.047, 10, caps=False)
        disc(I, INK, (px, 4.261, pz), 0.036, 0.036, 8)
    honey = M('HoneyJar', (0.8, 0.45, 0.04), 0, 0.15)
    for i in range(6):
        px, pz = 35.0 + 0.1 * (i % 3), -63.6 + 0.3 * (i // 3)
        cyl(I, honey, (px, 4.15, pz), (px, 4.28, pz), 0.04, 10); cyl(I, paint((0.75, 0.6, 0.2), 0.3, 0.9), (px, 4.28, pz), (px, 4.3, pz), 0.042, 10)
        cyl(I, PAPER, (px, 4.19, pz), (px, 4.24, pz), 0.041, 10, caps=False)
    col('solid', 34.0, 35.6, FL, 4.3, -64.6, -62.6)
    station('GiftDoor', (32.8, PATH, -71.0)); station('GiftKeeper', (30.2, FL, -66.0)); station('GiftCounter', (31.25, 4.34, -65.8))
