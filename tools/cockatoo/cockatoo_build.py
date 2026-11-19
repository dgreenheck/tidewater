"""Sulphur-crested cockatoo (Cacatua galerita): the player's pet, built from code.

    blender -b -P tools/cockatoo/cockatoo_build.py -- \
        [--out public/models/cockatoo.glb] [--render DIR]

No source mesh. A lofted body and head, a hooked two-part beak, dark eyes in a bare blue-white
eye ring, zygodactyl grey feet, and a few hundred alpha-cut feather cards: ten primaries, eleven
secondaries and three tertials a wing with their coverts, twelve tail feathers, eight separate
yellow crest feathers and contour feathers all over the body. Every texture is painted here with
numpy. Real size: 48 cm beak to tail, about 1 m span.

Rig: one bone per primary, per tail feather and per crest feather, grouped secondaries, a jaw.
Poses ship as glTF clips the game blends itself (src/player/Cockatoo.js):
  perch, glide, flare (full poses), flap (one wing beat, 1 s), and overlays crest, beak, look_l,
  look_r, look_up, look_down, tilt, preen, tailfan.
Pose deltas are written in each bone's rest frame with world axes (Blender: -Y forward, +Z up,
+X the bird's left), then converted to bone space, so the tables below read like the anatomy.
"""
import bpy, math, os, sys, json, struct
import numpy as np
from mathutils import Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d=None): return ARGS[ARGS.index(n) + 1] if n in ARGS else d
OUT = os.path.join(ROOT, arg('--out', 'public/models/cockatoo.glb'))
RENDER = arg('--render')
TEX = os.path.join(bpy.app.tempdir or '/tmp', 'cockatoo_tex')
os.makedirs(TEX, exist_ok=True)
RNG = np.random.default_rng(11)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ============================================================== textures (painted in numpy)
def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def nrm(h, k):
    gy, gx = np.gradient(h)
    n = np.dstack((-gx * k, -gy * k, np.ones_like(h)))
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5

WHITE = np.array([0.90, 0.90, 0.875])
SULPHUR = np.array([0.97, 0.88, 0.30])
LEMON = np.array([0.99, 0.96, 0.66])
CRESTY = np.array([0.97, 0.90, 0.36])

def plumage(N=512):
    y, x = np.mgrid[0:N, 0:N].astype(np.float64) + 0.5
    W, H = N / 8, N / 12
    row = np.floor(y / H)
    xs = x + (row % 2) * W / 2
    u = (xs % W) / W - 0.5
    v = (y % H) / H
    h = (v + 0.6 * (2 * u) ** 2) % 1.0            # rows of rounded feather tips, pointing +v (tailward)
    cell = (np.floor(xs / W) * 7 + row * 13) % 17
    tint = 1 + (cell / 17 - 0.5) * 0.035
    barbs = np.sin(2 * np.pi * (v * 9 - np.abs(u) * 5 + h * 3))
    shade = (1 - 0.06 * np.exp(-h / 0.05)) * (0.975 + 0.025 * barbs) * tint
    rgb = WHITE[None, None, :] * shade[..., None]
    rgb[..., 2] *= 0.99 + 0.02 * h                 # a cool edge on each tip
    height = h ** 0.7 + 0.04 * barbs
    rough = np.full_like(h, 0.82)
    return rgb, np.ones_like(h), height, rough

KINDS = {  # outer, inner vane half-width, tip start, pointed, barbs, downy base, tint
    'prim':   (0.36, 0.92, 0.70, 0.15, 150, 0.0, 'none'),
    'prim_u': (0.36, 0.92, 0.70, 0.15, 150, 0.0, 'under'),
    'sec':    (0.62, 0.92, 0.80, 0.0, 120, 0.0, 'none'),
    'sec_u':  (0.62, 0.92, 0.80, 0.0, 120, 0.0, 'under'),
    'crest':  (0.44, 0.52, 0.42, 0.85, 110, 0.10, 'crest'),
    'cov':    (0.80, 0.92, 0.52, 0.0, 60, 0.18, 'none'),
    'cov_u':  (0.80, 0.92, 0.52, 0.0, 60, 0.22, 'under'),
    'cont':   (0.88, 0.88, 0.40, 0.0, 34, 0.40, 'none'),
    'cont_y': (0.88, 0.88, 0.40, 0.0, 34, 0.40, 'cheek'),
    'cont_b': (0.80, 0.80, 0.48, 0.2, 30, 0.45, 'none'),
    'cov2':   (0.72, 0.92, 0.60, 0.0, 80, 0.14, 'none'),
    'cov2_u': (0.72, 0.92, 0.60, 0.0, 80, 0.18, 'ucov'),
}
A = 2048   # the feather atlas: 2k so each primary's vane gets ~14 px per barb and a crisp shaft
SLOTS = {  # x0, y0, w, h in atlas pixels (y up from the bottom)
    'prim': (0, 0, 128, 1024), 'prim_u': (128, 0, 128, 1024), 'sec': (256, 0, 128, 1024), 'sec_u': (384, 0, 128, 1024),
    'crest': (512, 0, 128, 1024), 'cov': (640, 0, 128, 512), 'cov_u': (640, 512, 128, 512),
    'cont': (768, 0, 128, 256), 'cont_y': (768, 256, 128, 256), 'cont_b': (768, 512, 128, 256),
    'cov2': (896, 0, 128, 512), 'cov2_u': (896, 512, 128, 512),
}
SLOTS = {k: tuple(v * A // 1024 for v in t) for k, t in SLOTS.items()}   # laid out for 1k, scaled to the atlas

def feather(w, h, kind, seed):
    outer, inner, tp, pointy, nb, fluff, tint = KINDS[kind]
    rng = np.random.default_rng(seed)
    t, u = np.mgrid[0:h, 0:w].astype(np.float64)
    t = (t + 0.5) / h
    s = ((u + 0.5) / w - 0.5) * 2
    a = np.abs(s)
    side = np.where(s < 0, outer, inner)
    grow = sm(0.015, 0.16, t) ** 0.6
    x = np.clip((t - tp) / (1 - tp), 0, 1)
    tip = np.sqrt(np.clip(1 - x ** 2, 0, 1)) * (1 - pointy) + np.clip(1 - x, 0, 1) ** 0.9 * pointy
    width = side * grow * tip * 0.97
    phase = (t * h - a * (w / 2) * 0.9) * nb / h
    bid = np.floor(phase) + np.where(s < 0, 5000, 0)
    r = (np.sin(bid * 12.9898) * 43758.5453) % 1.0
    edge = width - a
    notch = (edge < 0.22 * width) & (r > 0.9) & ((phase % 1) < 0.3)   # a few vane splits: the cards share a slot, so many line up into a grid
    alpha = sm(0.0, 0.04, edge) * (~notch)
    if fluff > 0:
        dens = sm(0.0, fluff, t)
        alpha *= (rng.random(t.shape) < 0.25 + 0.75 * dens)
    rw = 0.055 * (1 - t * 0.85) + 0.012
    rach = (a < rw) & (t < 0.985)
    alpha = np.maximum(alpha, rach * 1.0)
    barb = np.sin(2 * np.pi * (phase % 1))
    fine = np.sin(2 * np.pi * (phase * 3.0 % 1))   # barbules between the barbs
    shade = 0.915 + 0.055 * barb + 0.018 * fine - 0.035 * (1 - np.clip(a / np.maximum(width, 1e-3), 0, 1)) - 0.05 * sm(0.55, 1.0, a / np.maximum(width, 1e-3))
    col = np.broadcast_to(WHITE, t.shape + (3,)).copy()
    if tint == 'under':
        m = np.where(s > 0, 0.92, 0.62) * (1 - sm(0.45, 0.93, t)) * (0.85 + 0.15 * barb)   # sulphur over most of the vane
        col = col * (1 - m[..., None]) + SULPHUR * m[..., None]
    elif tint == 'ucov':
        m = 0.75 * (1 - sm(0.3, 0.95, t))
        col = col * (1 - m[..., None]) + SULPHUR * m[..., None]
    elif tint == 'cheek':
        m = 0.55 * (1 - sm(0.55, 1.0, t))
        col = col * (1 - m[..., None]) + LEMON * m[..., None]
    elif tint == 'crest':
        y = CRESTY * (1 - sm(0.7, 1.0, t))[..., None] + LEMON * sm(0.7, 1.0, t)[..., None]
        base = sm(0.05, 0.22, t)[..., None]
        col = WHITE * (1 - base) + y * base
        col = col * np.where(s < 0, 1.02, 0.98)[..., None]
    col = col * shade[..., None]
    shaft = np.array([0.80, 0.78, 0.70]) if tint in ('none', 'cheek') else np.array([0.86, 0.80, 0.52])
    col[rach] = shaft if tint != 'crest' else np.array([0.97, 0.86, 0.35])
    hl = rach & (s > 0) & (a < rw * 0.45)                                       # the lit ridge of the shaft
    col[hl] = np.minimum(col[hl] * 1.12, 1.0)
    height = np.where(alpha > 0.5, 0.45 + 0.16 * barb + 0.04 * fine + 0.25 * (1 - np.clip(a / np.maximum(width, 1e-3), 0, 1)), 0)
    height = np.where(rach, 1.0, height)
    rough = np.where(rach, 0.5, 0.78)
    return np.clip(col, 0, 1), np.clip(alpha, 0, 1), height, rough

def atlas():
    rgb = np.zeros((A, A, 3)); al = np.zeros((A, A)); hh = np.zeros((A, A)); ro = np.full((A, A), 0.8)
    for i, (k, (x0, y0, w, h)) in enumerate(SLOTS.items()):
        c, a, ht, r = feather(w, h, k, i + 3)
        rgb[y0:y0 + h, x0:x0 + w] = c; al[y0:y0 + h, x0:x0 + w] = a; hh[y0:y0 + h, x0:x0 + w] = ht; ro[y0:y0 + h, x0:x0 + w] = r
    # bleed colour into the cut-out texels so mips never pull in black fringes
    m = al > 0.5
    fill = rgb[m].mean(axis=0)
    rgb[~m] = fill
    return rgb, al, hh, ro

def bare(N=512):
    y, x = np.mgrid[0:N, 0:N].astype(np.float64) + 0.5
    u, v = x / N, y / N
    rgb = np.zeros((N, N, 3)); ro = np.zeros((N, N)); hh = np.zeros((N, N))
    n1 = np.sin(u * 900) * np.sin(v * 37 + np.sin(u * 60)) * 0.5 + 0.5
    # beak: dark slate horn, fine lengthwise striations, a little lighter and worn at the tip
    B = (u < 0.5) & (v < 0.5)
    bv = v / 0.5
    tone = 0.85 + 0.1 * np.sin(u * 2 * np.pi * 34 + np.sin(v * 40)) * 0.5 + 0.08 * sm(0.7, 1.0, bv)
    rgb[B] = (np.array([0.15, 0.15, 0.17])[None, :] * tone[B][:, None])
    ro[B] = 0.55; hh[B] = 0.5 + 0.05 * np.sin(u[B] * 2 * np.pi * 34)
    # eye ring: bare skin, white with a blue tinge, fine wrinkles
    R = (u >= 0.5) & (v < 0.5)
    rgb[R] = np.array([0.82, 0.87, 0.94])[None, :] * (0.92 + 0.08 * n1[R])[:, None]
    ro[R] = 0.55; hh[R] = n1[R] * 0.6
    # eye: dark brown iris round a black pupil (sphere v: 1 at the front pole)
    E = (u >= 0.5) & (u < 0.75) & (v >= 0.5) & (v < 0.75)
    ev = (v - 0.5) / 0.25
    iris = np.array([0.20, 0.11, 0.06]) * 0.8
    col = np.where((ev > 0.93)[..., None], np.array([0.02, 0.02, 0.02]), iris)
    col = np.where((ev < 0.78)[..., None], np.array([0.10, 0.10, 0.10]), col)
    rgb[E] = col[E]; ro[E] = 0.06; hh[E] = 0.5
    # feet: grey scaly skin (scutes), and dark claws
    F = (u < 0.5) & (v >= 0.5)
    fu, fv = u * 16, v * 44
    sc = np.minimum(np.abs((fu + 0.5 * (np.floor(fv) % 2)) % 1 - 0.5), np.abs(fv % 1 - 0.5)) * 2
    rgb[F] = np.array([0.47, 0.46, 0.48])[None, :] * (0.75 + 0.25 * sm(0.05, 0.35, sc[F]))[:, None]
    ro[F] = 0.72; hh[F] = sm(0.0, 0.3, sc[F])
    C = (u >= 0.75) & (v >= 0.5) & (v < 0.75)
    rgb[C] = np.array([0.08, 0.08, 0.09]); ro[C] = 0.3; hh[C] = 0.5
    rest = ~(B | R | E | F | C)
    rgb[rest] = np.array([0.4, 0.4, 0.42]); ro[rest] = 0.6
    return rgb, np.ones((N, N)), hh, ro

def image(name, rgb, alpha, colour=True):
    h, w = rgb.shape[:2]
    px = np.dstack((rgb, alpha)).astype(np.float32)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(TEX, name + '.png')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    if not colour: img.colorspace_settings.name = 'Non-Color'
    return img

def texset(name, fn, nk):
    rgb, al, hh, ro = fn()
    c = image(name + '_col', rgb, al)
    n = image(name + '_nrm', nrm(hh, nk), np.ones_like(al), False)
    orm = np.dstack((np.ones_like(ro), ro, np.zeros_like(ro)))
    o = image(name + '_orm', orm, np.ones_like(al), False)
    return c, n, o

def material(name, texs, clip=False, double=False):
    c, n, o = texs
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = c
    nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    if clip:
        r = nt.nodes.new('ShaderNodeMath'); r.operation = 'ROUND'
        nt.links.new(tc.outputs['Alpha'], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs['Alpha'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = n
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = o
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    m.use_backface_culling = not double
    return m

MAT_PLUMAGE = material('plumage', texset('plumage', plumage, 1.3))
MAT_FEATHERS = material('feathers', texset('feathers', atlas, 6.0), clip=True, double=True)   # per-texel slopes halve at 2k
MAT_BARE = material('bare', texset('bare', bare, 2.0))

# ============================================================== geometry
V, VW, F, FUV, FM = [], [], [], [], []
def addv(p, w):
    V.append((float(p[0]), float(p[1]), float(p[2]))); VW.append(w); return len(V) - 1
def addf(idx, uvs, m):
    F.append(list(idx)); FUV.append(list(uvs)); FM.append(m)

def mirror_from(v0, f0):
    """Mirror everything built since (v0, f0) across x = 0, _L bones -> _R."""
    remap = {}
    for i in range(v0, len(V)):
        x, y, z = V[i]
        w = {k.replace('_L', '_R'): val for k, val in VW[i].items()}
        remap[i] = addv((-x, y, z), w)
    n = len(F)
    for j in range(f0, n):
        idx = [remap[i] for i in F[j]][::-1]
        addf(idx, FUV[j][::-1], FM[j])

def rot(v, axis, ang):
    return Quaternion(axis, ang) @ Vector(v)

def card(base, dirL, nrmv, L, W, slot, w, segs=3, curl=0.0, taper=1.0, cpow=0.0):
    """A feather card from base along dirL, face normal nrmv, curling toward the normal by curl (rad)."""
    dirL = Vector(dirL).normalized(); n = Vector(nrmv)
    n = (n - dirL * n.dot(dirL)).normalized()
    dirW = n.cross(dirL).normalized()
    x0, y0, sw, sh = SLOTS[slot]
    u0, u1 = x0 / A, (x0 + sw) / A
    pts, d = [Vector(base)], dirL.copy()
    cw = [((k + 1) / segs) ** cpow for k in range(segs)]
    for k in range(segs):
        d = rot(d, dirW, -curl * cw[k] / sum(cw))   # rotate toward the normal (cpow > 0: curl gathers at the tip)
        pts.append(pts[-1] + d * (L / segs))
    Ls, Rs = [], []
    for k, p in enumerate(pts):
        t = k / segs
        ww = W * (1 - (1 - taper) * t) * 0.5
        Ls.append(addv(p - dirW * ww, w)); Rs.append(addv(p + dirW * ww, w))
    for k in range(segs):
        va, vb = (y0 + sh * k / segs) / A, (y0 + sh * (k + 1) / segs) / A
        addf((Ls[k], Ls[k + 1], Rs[k + 1], Rs[k]), ((u0, va), (u0, vb), (u1, vb), (u1, va)), 1)

def catmull(keys, n):
    K = np.array(keys, dtype=float); m = len(K); out = []
    for k in range(n):
        p = k / (n - 1) * (m - 1); i = min(int(p), m - 2); f = p - i
        P0, P1, P2, P3 = K[max(i - 1, 0)], K[i], K[i + 1], K[min(i + 2, m - 1)]
        out.append(0.5 * (2 * P1 + (-P0 + P2) * f + (2 * P0 - 5 * P1 + 4 * P2 - P3) * f * f + (-P0 + 3 * P1 - 3 * P2 + P3) * f ** 3))
    return np.array(out)

# body + neck + head, beak tip (-Y) to vent (+Y): y, half-width, half-height, centre z
BODY = [(-0.212, 0.004, 0.004, 0.034), (-0.206, 0.019, 0.022, 0.035), (-0.195, 0.030, 0.034, 0.038),
        (-0.178, 0.038, 0.042, 0.042), (-0.160, 0.040, 0.045, 0.043), (-0.142, 0.036, 0.042, 0.038),
        (-0.125, 0.031, 0.036, 0.030), (-0.108, 0.034, 0.038, 0.020), (-0.088, 0.046, 0.049, 0.008),
        (-0.060, 0.057, 0.061, -0.002), (-0.025, 0.061, 0.064, -0.006), (0.015, 0.058, 0.060, -0.006),
        (0.050, 0.047, 0.050, -0.004), (0.080, 0.032, 0.036, -0.002), (0.100, 0.020, 0.022, 0.000),
        (0.114, 0.006, 0.008, 0.001)]
PROF = catmull(BODY, 72)
def prof(y):
    return tuple(np.interp(y, PROF[:, 0], PROF[:, i]) for i in (1, 2, 3))

SPINE = [('head', -0.165), ('neck2', -0.128), ('neck1', -0.098), ('root', -0.02), ('tail', 0.1)]
def spine_w(y):
    if y <= SPINE[0][1]: return {SPINE[0][0]: 1.0}
    for (a, ya), (b, yb) in zip(SPINE, SPINE[1:]):
        if y <= yb:
            f = (y - ya) / (yb - ya); f = f * f * (3 - 2 * f)
            return {a: 1 - f, b: f} if 0 < f < 1 else {a if f <= 0 else b: 1.0}
    return {SPINE[-1][0]: 1.0}

NU = 40
def body_point(i, j):
    y, a, b, c = PROF[i]; th = 2 * math.pi * j / NU
    return Vector((a * math.sin(th), y, c - b * math.cos(th))), th

rings = []
for i in range(len(PROF)):
    y = PROF[i][0]
    rings.append([addv(body_point(i, j)[0], spine_w(y)) for j in range(NU)])
y0 = PROF[0][0]
front = addv((0, y0 - 0.001, PROF[0][3]), spine_w(y0)); back = addv((0, PROF[-1][0] + 0.002, PROF[-1][3]), spine_w(PROF[-1][0]))
TILE = 0.128
for i in range(len(PROF) - 1):
    va, vb = (PROF[i][0] - y0) / TILE, (PROF[i + 1][0] - y0) / TILE
    for j in range(NU):
        j1 = (j + 1) % NU; ua, ub = j / NU * 2, (j + 1) / NU * 2
        addf((rings[i][j], rings[i + 1][j], rings[i + 1][j1], rings[i][j1]), ((ua, va), (ua, vb), (ub, vb), (ub, va)), 0)
for j in range(NU):
    j1 = (j + 1) % NU
    addf((front, rings[0][j], rings[0][j1]), ((j / NU * 2, -0.01), (j / NU * 2, 0), ((j + 1) / NU * 2, 0)), 0)
    e = len(PROF) - 1; ve = (PROF[e][0] - y0) / TILE
    addf((back, rings[e][j1], rings[e][j]), ((j / NU * 2, ve + 0.01), ((j + 1) / NU * 2, ve), (j / NU * 2, ve)), 0)

# eyes: glossy dark eyeball in a raised ring of bare blue-white skin
EY = -0.176
ea, eb, ec = prof(EY)
EZ = ec + 0.008
EX = ea * math.sqrt(1 - ((EZ - ec) / eb) ** 2)
EYE = Vector((EX - 0.0021, EY, EZ))
v0, f0 = len(V), len(F)
axis = Vector((math.cos(math.radians(20)), -math.sin(math.radians(20)), 0.08)).normalized()
def frame_of(ax):
    t1 = ax.cross(Vector((0, 0, 1))).normalized(); t2 = ax.cross(t1).normalized(); return t1, t2
t1, t2 = frame_of(axis)
NE, NS = 18, 10
er = 0.0064
sph = [[addv(EYE + (axis * math.cos(math.pi * (1 - k / NS)) + (t1 * math.cos(2 * math.pi * j / NE) + t2 * math.sin(2 * math.pi * j / NE)) * math.sin(math.pi * (1 - k / NS))) * er, {'head': 1.0}) for j in range(NE)] for k in range(NS + 1)]
for k in range(NS):
    for j in range(NE):
        j1 = (j + 1) % NE
        va, vb = 0.5 + 0.25 * k / NS, 0.5 + 0.25 * (k + 1) / NS
        ua, ub = 0.5 + 0.25 * j / NE, 0.5 + 0.25 * (j + 1) / NE
        addf((sph[k][j], sph[k][j1], sph[k + 1][j1], sph[k + 1][j]), ((ua, va), (ub, va), (ub, vb), (ua, vb)), 2)
ring_r = [(0.0060, 0.0030), (0.0070, 0.0026), (0.0077, 0.0015), (0.0086, -0.0004)]
surf = Vector((EX, EY, EZ))
rr = [[addv(surf + axis * off + (t1 * math.cos(2 * math.pi * j / NE) + t2 * math.sin(2 * math.pi * j / NE)) * r, {'head': 1.0}) for j in range(NE)] for r, off in ring_r]
for k in range(len(ring_r) - 1):
    for j in range(NE):
        j1 = (j + 1) % NE
        ua, ub = 0.5 + 0.5 * j / NE, 0.5 + 0.5 * (j + 1) / NE
        va, vb = 0.5 * k / 3, 0.5 * (k + 1) / 3
        addf((rr[k][j], rr[k + 1][j], rr[k + 1][j1], rr[k][j1]), ((ua, va), (ua, vb), (ub, vb), (ub, va)), 2)
mirror_from(v0, f0)

# beak: a deep hooked upper mandible over a scoop-shaped lower one
def bez(P0, P1, P2, t):
    return ((1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1])
def beak_part(P0, P1, P2, wf, hf, under, bone, n=16, m=16):
    grid = []
    for k in range(n + 1):
        t = k / n
        y, z = bez(P0, P1, P2, t); y2, z2 = bez(P0, P1, P2, min(1, t + 0.01)); y1, z1 = bez(P0, P1, P2, max(0, t - 0.01))
        T = Vector((0, y2 - y1, z2 - z1)).normalized(); N = Vector((0, T.z, -T.y))
        if N.z < 0 and t < 0.3: N = -N
        wx, hz = wf(t), hf(t)
        row = []
        for j in range(m):
            ph = 2 * math.pi * j / m; c = math.cos(ph)
            off = hz * c * (1 if c > 0 else under)
            xx = wx * math.sin(ph) * (1 if c > 0 else 0.8)
            row.append(addv((xx, y + N.y * off, z + N.z * off), {bone: 1.0}))
        grid.append(row)
    for k in range(n):
        for j in range(m):
            j1 = (j + 1) % m
            ua, ub = 0.5 * j / m, 0.5 * (j + 1) / m
            va, vb = 0.5 * k / n, 0.5 * (k + 1) / n
            addf((grid[k][j], grid[k][j1], grid[k + 1][j1], grid[k + 1][j]), ((ua, va), (ub, va), (ub, vb), (ua, vb)), 2)
    tip = addv(Vector(V[grid[n][0]]) * 0.5 + Vector(V[grid[n][m // 2]]) * 0.5, {bone: 1.0})
    for j in range(m):
        addf((grid[n][j], grid[n][(j + 1) % m], tip), ((0, 0.49), (0.01, 0.49), (0.005, 0.5)), 2)
beak_part((-0.195, 0.043), (-0.232, 0.047), (-0.222, 0.001), lambda t: 0.0150 * (1 - t) ** 0.5 + 0.0012, lambda t: 0.019 * (1 - t) ** 0.8 + 0.0018, 0.45, 'head')
beak_part((-0.193, 0.022), (-0.212, 0.005), (-0.219, 0.017), lambda t: 0.0135 * (1 - t) ** 0.45 + 0.002, lambda t: 0.013 * (1 - t) ** 0.7 + 0.003, 0.8, 'jaw')

# legs and zygodactyl feet (two toes forward, two back), grey and scaly, dark claws
def tube(path, radii, bone, region, m=10):
    uo, vo, uw, vh = region
    rows = []
    for k, (p, r) in enumerate(zip(path, radii)):
        p = Vector(p)
        a = Vector(path[min(k + 1, len(path) - 1)]) - Vector(path[max(k - 1, 0)])
        a.normalize()
        s1 = a.cross(Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))).normalized(); s2 = a.cross(s1)
        rows.append([addv(p + (s1 * math.cos(2 * math.pi * j / m) + s2 * math.sin(2 * math.pi * j / m)) * r, {bone: 1.0}) for j in range(m)])
    n = len(rows)
    for k in range(n - 1):
        for j in range(m):
            j1 = (j + 1) % m
            ua, ub = uo + uw * j / m, uo + uw * (j + 1) / m
            va, vb = vo + vh * k / (n - 1), vo + vh * (k + 1) / (n - 1)
            addf((rows[k][j], rows[k][j1], rows[k + 1][j1], rows[k + 1][j]), ((ua, va), (ub, va), (ub, vb), (ua, vb)), 2)
    tip = addv(Vector(path[-1]) + (Vector(path[-1]) - Vector(path[-2])).normalized() * radii[-1] * 0.6, {bone: 1.0})
    for j in range(m):
        addf((rows[-1][j], rows[-1][(j + 1) % m], tip), ((uo, vo + vh), (uo + 0.01, vo + vh), (uo, vo + vh)), 2)
    cap = addv(Vector(path[0]) - (Vector(path[1]) - Vector(path[0])).normalized() * radii[0] * 0.5, {bone: 1.0})
    for j in range(m):
        addf((rows[0][(j + 1) % m], rows[0][j], cap), ((uo, vo), (uo + 0.01, vo), (uo, vo)), 2)

HIP = Vector((0.022, 0.030, -0.040)); ANK = Vector((0.026, 0.024, -0.080)); FOOT = Vector((0.026, 0.022, -0.093))
v0, f0 = len(V), len(F)
tube([ANK + Vector((0, 0, 0.012)), ANK, (ANK + FOOT) / 2, FOOT], [0.0062, 0.0058, 0.0054, 0.0056], 'foot_L', (0.0, 0.5, 0.5, 0.2))
TOES = [((-0.30, -1, -0.05), 0.026), ((0.32, -1, -0.05), 0.031), ((-0.34, 1, -0.05), 0.021), ((0.42, 1, -0.05), 0.033)]
for d, L in TOES:
    d = Vector(d).normalized(); side = d.cross(Vector((0, 0, 1))).normalized()
    pts = [FOOT.copy()]; dd = d.copy()
    for k in range(5):
        dd = rot(dd, side, -math.radians(9)); pts.append(pts[-1] + dd * (L / 5))
    tube(pts, [0.0045, 0.0042, 0.0038, 0.0034, 0.0031, 0.0029], 'foot_L', (0.0, 0.7, 0.5, 0.3))
    cl = [pts[-1]]; cd = dd.copy()
    for k in range(3):
        cd = rot(cd, side, -math.radians(22)); cl.append(cl[-1] + cd * 0.0033)
    tube(cl, [0.0026, 0.0019, 0.0011, 0.0004], 'foot_L', (0.75, 0.5, 0.25, 0.25), m=8)
# feathered "trousers" over the thighs
for k in range(9):
    ang = 2 * math.pi * k / 9
    base = HIP + Vector((math.cos(ang) * 0.013, math.sin(ang) * 0.013, 0.004))
    card(base, Vector((math.cos(ang) * 0.25, math.sin(ang) * 0.25, -1)), Vector((math.cos(ang), math.sin(ang), 0)), 0.036, 0.022, 'cont_b', {'thigh_L': 1.0}, segs=2, curl=-0.35)
mirror_from(v0, f0)

# wings (left, then mirrored): arm, flight feathers with their coverts and yellow-washed undersides
S = Vector((0.046, -0.050, 0.030)); E = Vector((0.118, -0.048, 0.030)); Wr = Vector((0.212, -0.050, 0.030)); Tp = Vector((0.290, -0.046, 0.030))
def arm_w(x):
    marks = [('upper_L', (S.x + E.x) / 2), ('fore_L', (E.x + Wr.x) / 2), ('hand_L', (Wr.x + Tp.x) / 2)]
    for (a, xa), (b, xb) in zip(marks, marks[1:]):
        if x <= xb:
            j = E.x if a == 'upper_L' else Wr.x
            f = min(1, max(0, (x - (j - 0.012)) / 0.024))
            return {a: 1 - f, b: f} if 0 < f < 1 else {a if f <= 0 else b: 1.0}
    return {'hand_L': 1.0}
PRIM, SEC, TERT = [], [], []
GC = []   # upper greater coverts: built once the flight feathers are, so each can rest on them
v0, f0 = len(V), len(F)
# the arm: a flattened leading edge, shoulder to wing tip
NA = 28; rows = []
for k in range(NA + 1):
    x = S.x + (Tp.x - S.x) * k / NA
    chord = np.interp(x, [S.x, E.x, Wr.x, Tp.x], [0.050, 0.044, 0.030, 0.016]); th = np.interp(x, [S.x, Wr.x, Tp.x], [0.016, 0.009, 0.005])
    yc = np.interp(x, [S.x, E.x, Wr.x, Tp.x], [S.y, E.y, Wr.y, Tp.y]) - 0.006
    rows.append([addv((x, yc + chord / 2 - chord / 2 * math.cos(2 * math.pi * j / 12), S.z + th / 2 * math.sin(2 * math.pi * j / 12)), arm_w(x)) for j in range(12)])
for k in range(NA):
    for j in range(12):
        j1 = (j + 1) % 12
        va, vb = k / NA * 2.3, (k + 1) / NA * 2.3
        addf((rows[k][j], rows[k + 1][j], rows[k + 1][j1], rows[k][j1]), ((j / 12, va), (j / 12, vb), ((j + 1) / 12, vb), ((j + 1) / 12, va)), 0)
UP = Vector((0, 0, 1)); DN = Vector((0, 0, -1))
for i in range(1, 11):  # primaries: P1 by the wrist .. P10 at the tip
    ang = math.radians(78 - (i - 1) * 70 / 9)
    base = Vector((0.214 + (i - 1) / 9 * 0.072, -0.041, 0.0255 + (10 - i) * 0.0005))
    L = 0.9 * [0.150, 0.158, 0.166, 0.175, 0.185, 0.193, 0.200, 0.203, 0.198, 0.178][i - 1]
    d = Vector((math.cos(ang), math.sin(ang), 0)); b = 'p%d_L' % i
    PRIM.append((b, base.copy(), d.copy(), ang))
    card(base, d, UP, L, 0.040, 'prim', {b: 1.0}, segs=4, curl=-0.10)
    card(base - Vector((0, 0, 0.0011)), d, UP, L * 0.99, 0.039, 'prim_u', {b: 1.0}, segs=4, curl=-0.10)
    GC.append((base + Vector((0, 0, 0.0035)) - d * 0.008, d, 0.072, 0.034, {b: 1.0}, -0.06))
    card(base - Vector((0, 0, 0.0038)) - d * 0.006, d, DN, 0.066, 0.034, 'cov2_u', {b: 1.0}, segs=2, curl=0.06)
for j in range(1, 12):  # secondaries: S1 by the wrist .. S11 by the elbow, in four groups
    ang = math.radians(84 + (j - 1) * 1.2)
    base = Vector((0.206 - (j - 1) / 10 * 0.088, -0.036, 0.0305 + j * 0.0002))
    d = Vector((math.cos(ang), math.sin(ang), 0)); g = min((j - 1) // 3, 3); b = 's%d_L' % g
    SEC.append((b, base.copy(), d.copy(), ang))
    card(base, d, UP, 0.142 - (j - 1) * 0.001, 0.050, 'sec', {b: 1.0}, segs=3, curl=-0.06)
    card(base - Vector((0, 0, 0.0011)), d, UP, 0.140 - (j - 1) * 0.001, 0.049, 'sec_u', {b: 1.0}, segs=3, curl=-0.06)
    GC.append((base + Vector((0, 0, 0.0038)) - d * 0.006, d, 0.066, 0.040, {b: 1.0}, -0.05))
    card(base - Vector((0, 0, 0.004)) - d * 0.004, d, DN, 0.060, 0.040, 'cov2_u', {b: 1.0}, segs=2, curl=0.05)
for k in range(1, 4):  # tertials
    ang = math.radians(98 + k * 4)
    base = Vector((0.112 - (k - 1) * 0.022, -0.034, 0.0335 + k * 0.0004))
    d = Vector((math.cos(ang), math.sin(ang), 0))
    TERT.append(('t_L', base.copy(), d.copy(), ang))
    card(base, d, UP, 0.125 - k * 0.006, 0.046, 'sec', {'t_L': 1.0}, segs=3, curl=-0.05)
    card(base - Vector((0, 0, 0.0011)), d, UP, 0.122 - k * 0.006, 0.045, 'sec_u', {'t_L': 1.0}, segs=3, curl=-0.05)
    GC.append((base + Vector((0, 0, 0.004)), d, 0.06, 0.04, {'t_L': 1.0}, -0.05))
# median, lesser and marginal coverts: three shingled rows that follow the arm's top, each feather its own length,
# width, angle, roll and curl so the rows never line up into planks; the front rows lie on top. Under the arm the
# underwing coverts start right at the leading edge (and a marginal row wraps it), so no slit shows from below.
CRNG = np.random.default_rng(11)
def arm_at(x):
    th = np.interp(x, [S.x, Wr.x, Tp.x], [0.016, 0.009, 0.005]); yc = np.interp(x, [S.x, E.x, Wr.x, Tp.x], [S.y, E.y, Wr.y, Tp.y]) - 0.006
    return yc, S.z + th / 2, S.z - th / 2
ROWS = [  # slot, back from the leading edge, length, width, spacing, lift, curl, x from shoulder
    ('cov', 0.013, 0.046, 0.027, 0.0066, 0.0006, -0.12, 0.004),
    ('cov', 0.007, 0.032, 0.022, 0.0056, 0.0016, -0.16, 0.002),
    ('cont', 0.001, 0.022, 0.018, 0.0046, 0.0026, -0.30, 0.000)]
# Each row rests on what is under it (the greater coverts, the row behind, the arm) and never crosses it: a covert
# that started above a layer and dived through it drew a crease line along the whole span, shadowed in its wedge.
# So each feather's curl is solved so its tip lies a hair above that layer, and it is lifted if its body would dip in.
def under_tris(fa, fb):
    """The near-horizontal triangles of faces fa..fb: the layers a covert row can rest on."""
    T = []
    for j in range(fa, fb):
        f = F[j]
        for tri in ((f[0], f[1], f[2]), (f[0], f[2], f[3])) if len(f) == 4 else ((f[0], f[1], f[2]),):
            P = np.array([V[i] for i in tri])
            nz = np.cross(P[1] - P[0], P[2] - P[0]); ln = np.linalg.norm(nz)
            if ln > 1e-14 and abs(nz[2]) / ln > 0.2: T.append(P)
    return np.array(T)
def surf_z(T, x, y):
    """The highest of those layers straight under (x, y), or None."""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    v0x, v0y, v1x, v1y = c[:, 0] - a[:, 0], c[:, 1] - a[:, 1], b[:, 0] - a[:, 0], b[:, 1] - a[:, 1]
    v2x, v2y = x - a[:, 0], y - a[:, 1]
    den = v0x * v1y - v1x * v0y; ok = np.abs(den) > 1e-14; den = np.where(ok, den, 1.0)
    u = (v2x * v1y - v1x * v2y) / den; v = (v0x * v2y - v2x * v0y) / den
    ins = ok & (u >= 0) & (v >= 0) & (u + v <= 1)
    return float((a[:, 2] + u * (c[:, 2] - a[:, 2]) + v * (b[:, 2] - a[:, 2]))[ins].max()) if ins.any() else None
def card_line(base, d, nv, L, curl, segs=3, cpow=1.0):
    """The centre line and width axis that card() builds."""
    dirL = Vector(d).normalized(); n = Vector(nv); n = (n - dirL * n.dot(dirL)).normalized(); dirW = n.cross(dirL).normalized()
    pts, dd = [Vector(base)], dirL.copy(); cw = [((k + 1) / segs) ** cpow for k in range(segs)]
    for k in range(segs):
        dd = rot(dd, dirW, -curl * cw[k] / sum(cw)); pts.append(pts[-1] + dd * (L / segs))
    return pts, dirW
def rest_on(T, base, d, nv, L, W, curl, gap, segs=3, cpow=1.0):
    """(curl, extra lift) so the tip rests gap above the layer under it and no part of the card dips into it."""
    def clear(c, lift, tip):
        pts, dw = card_line(Vector(base) + Vector((0, 0, lift)), d, nv, L, c, segs, cpow)
        qs = [pts[-1] + dw * W * s for s in (-0.25, 0.0, 0.25)] if tip else pts[1:-1]
        cl = [q.z - z for q in qs for z in (surf_z(T, q.x, q.y),) if z is not None]
        return min(cl) if cl else None
    lift = 0.0
    for _ in range(2):
        if clear(curl, lift, True) is None: break
        lo, hi = -0.9, 0.25
        if clear(hi, lift, True) < gap: curl = hi; lift += gap - clear(hi, lift, True)
        elif clear(lo, lift, True) > gap: curl = lo
        else:
            for _ in range(16):
                mid = (lo + hi) / 2
                if clear(mid, lift, True) < gap: lo = mid
                else: hi = mid
            curl = hi
        body = clear(curl, lift, False)
        if body is None or body >= 0.0003: break
        lift += 0.0003 - body
    return curl, lift
# the greater coverts lie on the flight feathers: their tips a hair above them, not hovering a few mm up (a
# hovering row cast one unbroken shadow along the span where the coverts end)
T = under_tris(f0 + NA * 12, len(F))   # the flight feathers (not the arm, which the coverts start under)
for n, (gb, gd, gL, gW, gw, gcurl) in enumerate(GC):
    curl, up = rest_on(T, gb, gd, UP, gL, gW, gcurl, 0.0004 + 0.0003 * (n % 3), segs=2, cpow=0.0)
    card(gb + Vector((0, 0, up)), gd, UP, gL, gW, 'cov2', gw, segs=2, curl=curl)
for slot, back, L0, W0, dx, lift, curl0, xs in ROWS:
    x = S.x + xs + CRNG.uniform(0, dx)
    T = under_tris(f0, len(F))   # everything on this wing so far, not this row's own feathers
    while x < Tp.x - 0.006:
        w = arm_w(x); b = max(w, key=w.get); yc, zt, zb = arm_at(x)
        k = float(np.interp(x, [S.x, Wr.x, Tp.x], [1.0, 0.78, 0.5]))
        ang = math.radians(6 + CRNG.normal(0, 5)); d = Vector((math.sin(ang), math.cos(ang), -0.05)).normalized()
        nv = rot(UP, d, CRNG.normal(0, 0.10))
        base = Vector((x, yc + back + CRNG.normal(0, 0.0012), zt + lift + CRNG.uniform(0, 0.0005)))
        L = L0 * k * CRNG.uniform(0.85, 1.15); Wd = W0 * min(1.0, k + 0.2) * CRNG.uniform(0.85, 1.12)
        cu = CRNG.uniform(0.7, 1.3)
        curl, up = rest_on(T, base, d, nv, L, Wd, curl0 * cu, 0.0004 + 0.0008 * (cu - 0.7) / 0.6)
        card(base + Vector((0, 0, up)), d, nv, L, Wd, slot, {b: 1.0}, segs=3, curl=curl, cpow=1.0)
        x += dx * CRNG.uniform(0.8, 1.2)
x = S.x + 0.004
while x < Tp.x - 0.004:
    w = arm_w(x); b = max(w, key=w.get); yc, zt, zb = arm_at(x)
    card((x, yc + 0.002, zb - 0.0004), (0.1, 1, 0), DN, 0.047 * CRNG.uniform(0.9, 1.1), 0.030, 'cov_u', {b: 1.0}, segs=2, curl=-0.04)
    card((x + 0.003, yc - 0.0015, (zt + zb) / 2), (0.1, 1, -0.9), Vector((0, -0.7, -1)), 0.018, 0.020, 'cont', {b: 1.0}, segs=2, curl=-0.25)
    x += 0.007
for k in range(3):  # alula
    card((0.212 + k * 0.004, -0.054, 0.034 + k * 0.001), (1, -0.25 + k * 0.2, 0), UP, 0.034 + k * 0.006, 0.014, 'cov', {'hand_L': 1.0}, segs=2, curl=-0.1)
# flank feathers that tuck the wing root into the body
for k in range(6):
    card((0.040 + k * 0.002, -0.07 + k * 0.012, 0.028 - k * 0.002), (0.25, 1, -0.05), Vector((1, 0, 0.5)), 0.05, 0.03, 'cont_b', {'root': 1.0}, segs=2, curl=-0.2)
mirror_from(v0, f0)

# tail: twelve rectrices (yellow wash beneath), upper and under tail coverts
RECT = []
v0, f0 = len(V), len(F)
for n in range(1, 7):
    ang = math.radians((n - 1) * 2.5)
    base = Vector((0.003 + (n - 1) * 0.0034, 0.092, 0.004 - (n - 1) * 0.0024))
    d = Vector((math.sin(ang), math.cos(ang), 0)); b = 'r%d_L' % n
    RECT.append((b, base.copy(), d.copy()))
    tn = rot(UP, d, math.radians(4 + (n - 1) * 7))   # a rounded, roofed tail: outer feathers lower and tilted
    card(base, d, tn, 0.185 - (n - 1) * 0.004, 0.038, 'sec', {b: 1.0}, segs=4, curl=-0.10)
    card(base - tn * 0.0011, d, tn, 0.183 - (n - 1) * 0.004, 0.037, 'sec_u', {b: 1.0}, segs=4, curl=-0.10)
for k in range(4):
    card((0.004 + k * 0.006, 0.066, 0.016 - k * 0.001), (k * 0.08, 1, -0.02), UP, 0.078, 0.036, 'cov2', {'tail': 1.0}, segs=2, curl=-0.1)
    card((0.004 + k * 0.006, 0.070, -0.012 + k * 0.001), (k * 0.1, 1, 0.05), DN, 0.072, 0.036, 'cov2_u', {'tail': 1.0}, segs=2, curl=0.1)
mirror_from(v0, f0)

# crest: eight separate long yellow feathers along the crown, curling at the tips
CREST = []
for mm in range(10):
    y = -0.194 + mm * 0.0054; a_, b_, c_ = prof(y)
    base = Vector(((-1) ** mm * 0.0022, y, c_ + b_ - 0.003))
    e = math.radians(-12 + mm * 0.8)
    d = Vector((0, math.cos(e), math.sin(e))); n = Vector((0, -math.sin(e), math.cos(e)))
    L = 0.062 + mm * 0.0102; b = 'c%d' % mm
    CREST.append((b, base.copy(), d.copy()))
    for tw in (-0.35, 0.35):
        card(base, d, rot(n, d, tw), L, 0.022 + mm * 0.0008, 'crest', {b: 1.0}, segs=7, curl=1.45, taper=0.55, cpow=2.2)

# contour feathers over the whole body: small on the head, larger on the back and breast
eye_c = Vector((EX, EY, EZ)); eye_m = Vector((-EX, EY, EZ))
for i in range(3, len(PROF) - 3, 2):
    y = PROF[i][0]
    for j in range(18):
        jj = (j + (i % 4) * 0.5) * NU / 18
        th = 2 * math.pi * jj / NU
        yv, a_, b_, c_ = PROF[i]
        p = Vector((a_ * math.sin(th), yv, c_ - b_ * math.cos(th)))
        q = Vector((PROF[i + 1][1] * math.sin(th), PROF[i + 1][0], PROF[i + 1][3] - PROF[i + 1][2] * math.cos(th)))
        nn = Vector((math.sin(th) / max(a_, 1e-3), 0, -math.cos(th) / max(b_, 1e-3))).normalized()
        T = (q - p).normalized()
        if (p - eye_c).length < 0.013 or (p - eye_m).length < 0.013: continue
        if y < -0.135: continue   # the head stays smooth, as in life
        if y < -0.14: L, W = 0.015, 0.012
        elif y < -0.10: L, W = 0.019, 0.015
        else: L, W = 0.030, 0.023
        cheek = -0.188 < y < -0.150 and abs(math.sin(th)) > 0.55 and p.z < EZ - 0.004
        lift = 0.12
        card(p - nn * 0.0015, T * math.cos(lift) + nn * math.sin(lift), nn, L, W, 'cont_y' if cheek else 'cont', spine_w(y), segs=2, curl=-0.2)

# ============================================================== mesh object
me = bpy.data.meshes.new('cockatoo')
me.from_pydata(V, [], F)
for m in (MAT_PLUMAGE, MAT_FEATHERS, MAT_BARE): me.materials.append(m)
me.polygons.foreach_set('material_index', FM)
me.polygons.foreach_set('use_smooth', [True] * len(F))
uv = me.uv_layers.new(name='UVMap')
flat = [c for f in FUV for uvp in f for c in uvp]
uv.data.foreach_set('uv', flat)
me.update(); me.validate()
ob = bpy.data.objects.new('cockatoo', me)
bpy.context.scene.collection.objects.link(ob)

# ============================================================== armature
BONES = [('root', (0, 0.03, 0), (0, -0.05, 0), None),
         ('neck1', (0, -0.07, 0.010), (0, -0.100, 0.020), 'root'), ('neck2', (0, -0.100, 0.020), (0, -0.130, 0.032), 'neck1'),
         ('head', (0, -0.130, 0.032), (0, -0.190, 0.042), 'neck2'), ('jaw', (0, -0.192, 0.024), (0, -0.220, 0.014), 'head'),
         ('tail', (0, 0.090, 0.002), (0, 0.130, 0.002), 'root'),
         ('thigh_L', tuple(HIP), tuple(ANK), 'root'), ('foot_L', tuple(ANK), tuple(FOOT), 'thigh_L'),
         ('upper_L', tuple(S), tuple(E), 'root'), ('fore_L', tuple(E), tuple(Wr), 'upper_L'), ('hand_L', tuple(Wr), tuple(Tp), 'fore_L')]
for b, base, d, ang in PRIM: BONES.append((b, tuple(base), tuple(base + d * 0.04), 'hand_L'))
for g in range(4):
    mem = [s for s in SEC if s[0] == 's%d_L' % g]; base = sum((s[1] for s in mem), Vector()) / len(mem); d = sum((s[2] for s in mem), Vector()).normalized()
    BONES.append(('s%d_L' % g, tuple(base), tuple(base + d * 0.04), 'fore_L'))
base = sum((t[1] for t in TERT), Vector()) / 3; d = sum((t[2] for t in TERT), Vector()).normalized()
BONES.append(('t_L', tuple(base), tuple(base + d * 0.04), 'upper_L'))
for b, base, d in RECT: BONES.append((b, tuple(base), tuple(base + d * 0.04), 'tail'))
for b, base, d in CREST: BONES.append((b, tuple(base), tuple(base + d * 0.03), 'head'))
ALL = []
for name, h, t, p in BONES:
    ALL.append((name, h, t, p))
    if name.endswith('_L'):
        ALL.append((name[:-2] + '_R', (-h[0], h[1], h[2]), (-t[0], t[1], t[2]), p[:-2] + '_R' if p and p.endswith('_L') else p))
arm_d = bpy.data.armatures.new('rig'); arm = bpy.data.objects.new('rig', arm_d)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, p in ALL:
    eb = arm_d.edit_bones.new(name); eb.head = h; eb.tail = t; eb.roll = 0
for name, h, t, p in ALL:
    if p: arm_d.edit_bones[name].parent = arm_d.edit_bones[p]
bpy.ops.object.mode_set(mode='OBJECT')
groups = {}
for i, w in enumerate(VW):
    for b, val in w.items():
        groups.setdefault((b, round(val, 4)), []).append(i)
for (b, val), idx in groups.items():
    vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
    vg.add(idx, val, 'REPLACE')
for name, *_ in ALL:
    if not ob.vertex_groups.get(name): ob.vertex_groups.new(name=name)
ob.parent = arm
mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm

# ============================================================== poses (world-axis deltas per bone)
def R(ax, deg): return Quaternion({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[ax], math.radians(deg))
I = Quaternion()
PA = {b: math.degrees(a) for b, _, _, a in PRIM}
SA = {'s%d_L' % g: sum(math.degrees(s[3]) for s in SEC if s[0] == 's%d_L' % g) / len([s for s in SEC if s[0] == 's%d_L' % g]) for g in range(4)}
TA = sum(math.degrees(t[3]) for t in TERT) / 3
WING = ['upper_L', 'fore_L', 'hand_L', 't_L'] + list(PA) + list(SA)

def wing_pose(up, fore, hand, fan=0.0, sfan=0.0, twist=0.0):
    p = {'upper_L': up, 'fore_L': fore, 'hand_L': hand, 't_L': I}
    for b, a in PA.items(): p[b] = R('Z', -a * fan)
    for b, a in SA.items(): p[b] = R('Z', sfan)
    return p

PERCH = {'root': R('X', -52), 'neck1': R('X', 26), 'neck2': R('X', 16), 'head': R('X', 12), 'tail': R('X', -12),
         'thigh_L': R('X', 52), 'foot_L': I,
         'upper_L': R('Y', 74) @ R('Z', 82), 'fore_L': R('Z', -168), 'hand_L': R('Z', 176), 't_L': R('Z', 4 - TA)}
for b, a in PA.items(): PERCH[b] = R('Z', -a + 1.5)
for b, a in SA.items(): PERCH[b] = R('Z', 172 - a - 1.0)
GLIDE = {'head': R('X', 4), 'upper_L': R('Y', -6), 'fore_L': R('Z', -4), 'hand_L': R('Z', 6), 'thigh_L': R('X', 72), 'foot_L': R('X', 40)}
FLARE = {'root': R('X', -38), 'neck1': R('X', 20), 'neck2': R('X', 10), 'head': R('X', 6), 'tail': R('X', -25),
         'upper_L': R('Y', -30) @ R('Z', -22), 'fore_L': R('Z', -6), 'hand_L': R('Z', 8), 'thigh_L': R('X', 8), 'foot_L': R('X', -20)}
for b, a in PA.items(): FLARE[b] = R('Z', a * 0.08)
for n in range(1, 7): FLARE['r%d_L' % n] = R('Z', -(n - 1) * 5.5)
FLAP = [  # one beat, t = 0 top of the upstroke, 0.25 level (the glide phase), 0.5 bottom, 0.75 flexed upstroke
    (0.00, {'upper_L': R('Y', -60) @ R('Z', 6), 'fore_L': R('Z', -6), 'hand_L': R('Z', 12) @ R('Y', -8)}),
    (0.25, {'upper_L': R('X', 6) @ R('Y', -4) @ R('Z', -8), 'fore_L': R('Z', -4), 'hand_L': R('Z', 4) @ R('X', 8)}),
    (0.50, {'upper_L': R('X', 4) @ R('Y', 50) @ R('Z', -14), 'fore_L': R('Z', -2), 'hand_L': R('Z', -4) @ R('Y', -10)}),
    (0.75, {'upper_L': R('X', -10) @ R('Y', 8) @ R('Z', 20), 'fore_L': R('Z', -50), 'hand_L': R('Z', 64), 'fan': 0.35, 'sfan': 22}),
    (1.00, None)]
FLAP[4] = (1.0, FLAP[0][1])
def flap_pose(p):
    q = {'t_L': I}
    for k in ('upper_L', 'fore_L', 'hand_L'): q[k] = p[k]
    for b, a in PA.items(): q[b] = R('Z', -a * p.get('fan', 0))
    for b in SA: q[b] = R('Z', p.get('sfan', 0))
    return q
def over(base, d): return {k: base.get(k, I) @ v for k, v in d.items()}
OVER = {
    'crest': {'c%d' % m: R('X', 62 + m * 9.5) for m in range(10)},
    'beak': {'jaw': R('X', 26), 'head': PERCH['head'] @ R('X', -6)},
    'look_l': over(PERCH, {'neck2': R('Z', 34), 'head': R('Z', 32)}),
    'look_r': over(PERCH, {'neck2': R('Z', -34), 'head': R('Z', -32)}),
    'look_up': over(PERCH, {'neck2': R('X', -18), 'head': R('X', -22)}),
    'look_down': over(PERCH, {'neck2': R('X', 22), 'head': R('X', 26)}),
    'tilt': over(PERCH, {'head': R('Y', 30)}),
    'preen': over(PERCH, {'neck1': R('Z', 45) @ R('X', 18), 'neck2': R('Z', 55) @ R('X', 22), 'head': R('Z', 45) @ R('Y', 35) @ R('X', 15)}),
    'tailfan': {'r%d_L' % n: R('Z', -(n - 1) * 6.5) for n in range(1, 7)},
}

def mirrored(p):
    out = dict(p)
    for k, q in p.items():
        if k.endswith('_L'): out[k[:-2] + '_R'] = Quaternion((q.w, q.x, -q.y, -q.z))
    return out

def set_pose(p, full=True):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        if full: pb.rotation_quaternion = I
    for k, D in mirrored(p).items():
        Rb = arm_d.bones[k].matrix_local.to_quaternion()
        arm.pose.bones[k].rotation_quaternion = Rb.inverted() @ D @ Rb

ad = arm.animation_data_create()
scn = bpy.context.scene; scn.render.fps = 24
def clip(name, frames, bones=None):
    act = bpy.data.actions.new(name); act.use_fake_user = True; ad.action = act
    for fr, p in frames:
        set_pose(p)
        keys = [pb.name for pb in arm.pose.bones] if bones is None else [k for k in mirrored({b: I for b in bones})]
        for k in keys: arm.pose.bones[k].keyframe_insert('rotation_quaternion', frame=fr, group=k)
    tr = ad.nla_tracks.new(); tr.name = name
    tr.strips.new(name, int(frames[0][0]), act)
    ad.action = None
clip('perch', [(0, PERCH), (1, PERCH)])
clip('glide', [(0, GLIDE), (1, GLIDE)])
clip('flare', [(0, FLARE), (1, FLARE)])
# every clip keys every bone (the exporter would otherwise fill unkeyed bones from the NLA mix):
# overlays sit on the perch pose, the wing beat on the glide pose
clip('flap', [(round(t * 24), {**GLIDE, **flap_pose(p)}) for t, p in FLAP])
for k, p in OVER.items(): clip(k, [(0, {**PERCH, **p}), (1, {**PERCH, **p})])
set_pose({})

# ============================================================== export
kw = dict(filepath=OUT, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
          export_optimize_animation_size=False, export_optimize_animation_keep_anim_armature=True, export_skins=True,
          export_yup=True, export_apply=False, export_materials='EXPORT', export_image_format='AUTO', export_def_bones=False,
          export_anim_single_armature=True, export_reset_pose_bones=True, export_extras=True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props or k == 'filepath'})

# alpha-tested, double-sided feathers (the engine reads alphaMode / doubleSided from the file)
with open(OUT, 'rb') as fh: data = fh.read()
jl = struct.unpack_from('<I', data, 12)[0]
js = json.loads(data[20:20 + jl]); rest = data[20 + jl:]
for m in js.get('materials', []):
    if m.get('name') == 'feathers': m.update(alphaMode='MASK', alphaCutoff=0.5, doubleSided=True)
    else: m['alphaMode'] = 'OPAQUE'; m.pop('alphaCutoff', None); m['doubleSided'] = False
js['scenes'][0].setdefault('extras', {})['cockatoo'] = {'species': 'Cacatua galerita', 'length_m': 0.48, 'clips': ['perch', 'glide', 'flare', 'flap'] + list(OVER)}
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + len(rest)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + rest
with open(OUT, 'wb') as fh: fh.write(out)
dg = bpy.context.evaluated_depsgraph_get(); set_pose(PERCH); ad.action = None
for tr in ad.nla_tracks: tr.mute = True
bpy.context.view_layer.update(); em = ob.evaluated_get(dg).to_mesh()
P = np.array([v.co[:] for v in em.vertices]); ob.evaluated_get(dg).to_mesh_clear()
for ax in (1, 2):
    for i in (int(P[:, ax].argmin()), int(P[:, ax].argmax())):
        print('EXTREME axis', ax, P[i].round(3), VW[i], 'rest', np.round(V[i], 3))
print('COCKATOO verts', len(V), 'faces', len(F), 'bones', len(ALL), 'anims', [a['name'] for a in js.get('animations', [])], 'bytes', len(out))

# ============================================================== turnaround renders (optional)
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    for tr in ad.nla_tracks: tr.mute = True   # the clips must not override the posed renders
    ad.action = None
    scn.render.engine = 'CYCLES'; scn.cycles.samples = 48; scn.cycles.use_denoising = True; scn.cycles.device = 'CPU'
    scn.render.resolution_x = 640; scn.render.resolution_y = 640
    world = bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.42, 0.52, 0.62, 1); bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.2; sun.data.angle = 0.1
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35)); scn.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 50; scn.collection.objects.link(cam); scn.camera = cam
    def shot(name, pose, target, az, el, dist):
        set_pose(pose); bpy.context.view_layer.update()
        t = Vector(target)
        c = t + Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)), -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * dist
        cam.location = c; cam.rotation_euler = (t - c).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(RENDER, name + '.png'); bpy.ops.render.render(write_still=True)
    set_pose(PERCH); bpy.context.view_layer.update()
    tgt = (arm.matrix_world @ arm.pose.bones['neck1'].head) * 0.4 + (arm.matrix_world @ arm.pose.bones['root'].head) * 0.6
    squawk = dict(PERCH); squawk.update(OVER['crest']); squawk.update(OVER['beak'])
    for nm, az in (('turn_front34', 35), ('turn_side', 90), ('turn_back34', 150), ('turn_front', 0)):
        shot(nm, PERCH, tgt, az, 8, 0.8)
    shot('turn_squawk', squawk, tgt, 60, 5, 0.7)
    shot('turn_glide', GLIDE, (0, 0.0, 0.0), 25, -30, 1.4)
