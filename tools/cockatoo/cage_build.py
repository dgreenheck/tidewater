"""Domed parrot cage for the beach fish stall counter, built from code (no source mesh).

    blender -b -P tools/cockatoo/cage_build.py -- \
        [--out public/models/birdcage.glb] [--render DIR]

A black powder-coated wire cage sized for a sulphur-crested cockatoo: 3.5 mm wire at 25 mm
centres on 10 mm square corner tubes and 8 x 3 mm flat bands, an arched roof, a sheet-steel skirt
with a pull-out tray, a hinged front door with a spring hook latch, a turned hardwood perch, a swing
with a brass bell, and two stainless cups (seed on the left, water on the right).

Loader rules (src/rally/VehicleModel.js loadModel): untextured GLB, factor-only materials, one mesh
per node with one primitive per material, no compression. All detail is geometry.

Frame contract (glTF / game metres; X right, Y up, +Z front where the door is; Blender: door faces -Y):
  origin at the base centre, feet on y = 0; walls 0.58 x 0.48, y 0.11..0.56; arch top of the free
  space y = 0.56 + 0.265 * sqrt(1 - (x / 0.29)^2); crown handle top y 0.845.
  door    (-0.12, 0.16, 0.243)  hinge line; opens about +Y by a negative angle, fully open -1.9 rad
  latch   (0.135, 0.30, 0.25)   pivot; opens about +Z by +1.0 rad
  swing   (-0.13, 0.75, -0.04)  pivot on a short cross bar hung from the roof; swings about X
  bell    child of swing, ring at (-0.065, 0.32, -0.04) in cage space
  tray    seated origin (0, 0.0115, 0), exported pulled out 0.02 in +Z
  anchor_perch (0.10, 0.264, 0.02), anchor_seed (-0.235, 0.20, -0.14), anchor_water (0.235, 0.20, -0.14),
  anchor_swing (child of swing, seat top centre), anchor_bell (child of bell, bell centre).
"""
import bpy, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(n, d=None): return ARGS[ARGS.index(n) + 1] if n in ARGS else d
OUT = os.path.join(ROOT, arg('--out', 'public/models/birdcage.glb'))
RENDER = arg('--render')
RNG = np.random.default_rng(23)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ============================================================== materials (factors only)
MATDEF = {  # name: (rgb, metallic, roughness, coat, double sided)
    'coat':        ((0.035, 0.035, 0.037), 0.0, 0.55, 0.0, False),
    'coat_scuff':  ((0.052, 0.051, 0.050), 0.0, 0.70, 0.0, False),
    'steel_bare':  ((0.46, 0.47, 0.48), 1.0, 0.40, 0.0, False),
    'rust':        ((0.19, 0.085, 0.035), 0.0, 0.90, 0.0, False),
    'wood':        ((0.50, 0.33, 0.17), 0.0, 0.75, 0.0, False),
    'wood_worn':   ((0.62, 0.45, 0.27), 0.0, 0.55, 0.0, False),
    'brass':       ((0.80, 0.60, 0.25), 1.0, 0.28, 0.0, False),
    'stainless':   ((0.82, 0.82, 0.80), 1.0, 0.20, 0.0, False),
    'paper':       ((0.64, 0.61, 0.54), 0.0, 0.90, 0.0, True),
    'ink':         ((0.07, 0.07, 0.075), 0.0, 0.80, 0.0, True),
    'seed_dark':   ((0.035, 0.032, 0.030), 0.0, 0.50, 0.0, True),
    'seed_stripe': ((0.40, 0.38, 0.34), 0.0, 0.55, 0.0, True),
    'safflower':   ((0.84, 0.80, 0.70), 0.0, 0.60, 0.0, False),
    'water':       ((0.025, 0.035, 0.04), 0.0, 0.05, 1.0, False),
    'rubber':      ((0.02, 0.02, 0.02), 0.0, 0.85, 0.0, False),
    'feather':     ((0.92, 0.92, 0.89), 0.0, 0.80, 0.0, True),
}
MAT = {}
for n, (c, m, r, cc, ds) in MATDEF.items():
    mt = bpy.data.materials.new(n)
    if hasattr(mt, 'use_nodes'): mt.use_nodes = True
    b = mt.node_tree.nodes.get('Principled BSDF')
    if b is None:
        b = mt.node_tree.nodes.new('ShaderNodeBsdfPrincipled'); o = mt.node_tree.nodes.get('Material Output') or mt.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mt.node_tree.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Metallic'].default_value = m
    b.inputs['Roughness'].default_value = r
    if cc: b.inputs['Coat Weight'].default_value = cc; b.inputs['Coat Roughness'].default_value = 0.03
    mt.use_backface_culling = not ds; mt.diffuse_color = (*c, 1)
    MAT[n] = mt

# ============================================================== geometry accumulator
# Coordinates below are game metres, local to the current node (no node carries a rotation).
GEO = {}
NODE = ['birdcage']
def emit(mat, V, F, smooth):
    V = np.asarray(V, float)
    used = sorted({i for f in F for i in f})
    if len(used) != len(V):
        rm = {o: k for k, o in enumerate(used)}; V = V[used]; F = [tuple(rm[i] for i in f) for f in F]
    d = GEO.setdefault(NODE[0], {}).setdefault(mat, {'V': [], 'F': [], 'S': [], 'n': 0})
    d['V'].append(V); d['F'] += [tuple(int(i) + d['n'] for i in f) for f in F]
    d['S'] += [bool(smooth)] * len(F); d['n'] += len(V)

def nz(v):
    v = np.asarray(v, float); n = np.linalg.norm(v, axis=-1, keepdims=True); return v / np.maximum(n, 1e-12)
def circ(r, n): a = np.arange(n) * 2 * np.pi / n + np.pi / n; return np.stack([r * np.cos(a), r * np.sin(a)], 1)
def rect(hn, hb): return np.array([(-hn, -hb), (hn, -hb), (hn, hb), (-hn, hb)])
def ss(e0, e1, x): t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def sweep(mat, path, prof, up=None, closed=False, cap=True, smooth=True, mitre=False):
    """Sweep a 2D profile (CCW in the N-B plane) along a path. up fixes B (planar paths); else parallel transport."""
    P = [np.asarray(p, float) for p in path]; Q = [P[0]]
    for p in P[1:]:
        if np.linalg.norm(p - Q[-1]) > 1e-7: Q.append(p)
    P = np.array(Q); M = len(P); prof = np.asarray(prof, float); K = len(prof)
    if closed and np.linalg.norm(P[0] - P[-1]) < 1e-7: P = P[:-1]; M -= 1
    prev = np.roll(P, 1, 0) if closed else np.vstack([P[:1], P[:-1]])
    nxt = np.roll(P, -1, 0) if closed else np.vstack([P[1:], P[-1:]])
    d0 = nz(P - prev); d1 = nz(nxt - P)
    if not closed: d0[0] = d1[0]; d1[-1] = d0[-1]
    T = nz(d0 + d1)
    if up is not None:
        u = np.asarray(up, float); B = nz(u - (T @ u)[:, None] * T)
    else:
        B = np.zeros_like(P); a = np.array([0, 1., 0]) if abs(T[0][1]) < 0.9 else np.array([1., 0, 0])
        B[0] = nz(a - (a @ T[0]) * T[0])
        for i in range(1, M): B[i] = nz(B[i - 1] - (B[i - 1] @ T[i]) * T[i])
    N = np.cross(B, T)
    sc = 1.0 / np.clip(np.einsum('ij,ij->i', T, d1), 0.3, 1) if mitre else np.ones(M)
    V = (P[:, None, :] + (prof[None, :, 0:1] * sc[:, None, None]) * N[:, None, :] + prof[None, :, 1:2] * B[:, None, :]).reshape(-1, 3)
    F = []
    for i in range(M if closed else M - 1):
        i2 = (i + 1) % M
        for j in range(K):
            j2 = (j + 1) % K; F.append((i * K + j, i * K + j2, i2 * K + j2, i2 * K + j))
    emit(mat, V, F, smooth)
    if cap and not closed:
        emit(mat, V[:K], [tuple(range(K))[::-1]], False); emit(mat, V[-K:], [tuple(range(K))], False)

def wire(mat, path, r, sides=8, **kw): sweep(mat, path, circ(r, sides), **kw)
def bar(mat, path, hn, hb, up, **kw): sweep(mat, path, rect(hn, hb), up=up, smooth=False, **kw)

def rot_y_to(axis):
    a = nz(axis); y = np.array([0, 1., 0]); c = float(a @ y)
    if c > 0.99999: return np.eye(3)
    if c < -0.99999: return np.diag([1., -1, -1])
    k = nz(np.cross(y, a)); s = math.sqrt(1 - c * c)
    Kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * Kx + (1 - c) * Kx @ Kx

def lathe(mat, prof, center=(0, 0, 0), axis=(0, 1, 0), segs=24, phi=(0, 2 * np.pi), smooth=True):
    """Revolve (r, h) about axis. Walking the profile up the outside gives outward faces."""
    R = rot_y_to(axis); full = abs(phi[1] - phi[0] - 2 * np.pi) < 1e-6; n = segs if full else segs + 1
    ang = phi[0] + (phi[1] - phi[0]) * np.arange(n) / segs; V = []; idx = []
    for r, h in prof:
        if r < 1e-9: idx.append([len(V)] * n); V.append((0, h, 0))
        else: idx.append(list(range(len(V), len(V) + n))); V += [(r * math.cos(a), h, r * math.sin(a)) for a in ang]
    F = []
    for j in range(len(prof) - 1):
        for k in range(segs):
            k2 = (k + 1) % n
            q = []
            for v in (idx[j][k], idx[j + 1][k], idx[j + 1][k2], idx[j][k2]):
                if v not in q: q.append(v)
            if len(q) >= 3: F.append(tuple(q))
    emit(mat, np.array(V) @ R.T + np.asarray(center, float), F, smooth)

def mirror_prof(prof): return [(r, -h) for r, h in prof][::-1]
def ring_prof(r0, r1, h0, h1): return [(r0, h0), (r1, h0), (r1, h1), (r0, h1), (r0, h0)]

def prism(mat, poly, origin, U, V_, w0, w1, smooth=False):
    poly = np.asarray(poly, float); U = np.asarray(U, float); V_ = np.asarray(V_, float); W = np.cross(U, V_)
    base = np.asarray(origin, float) + poly[:, 0:1] * U + poly[:, 1:2] * V_; n = len(poly)
    A = base + w0 * W; Bt = base + w1 * W
    emit(mat, np.vstack([A, Bt]), [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)], smooth)
    emit(mat, Bt, [tuple(range(n))], False); emit(mat, A, [tuple(range(n))[::-1]], False)

def box(mat, c, s):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    prism(mat, [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)], c, (1, 0, 0), (0, 1, 0), -hz, hz)

def patch(mat, c, U, V_, a, b, off=0.0001, n=9):
    """Irregular flat chip or stain lying on a face; the face normal is U x V."""
    U = np.asarray(U, float); V_ = np.asarray(V_, float); W = np.cross(U, V_)
    t = np.sort(np.linspace(0, 2 * np.pi, n, endpoint=False) + RNG.uniform(-0.25, 0.25, n)); rr = RNG.uniform(0.55, 1.0, n)
    pts = np.asarray(c, float) + off * W + (rr * np.cos(t) * a)[:, None] * U + (rr * np.sin(t) * b)[:, None] * V_
    emit(mat, pts, [tuple(range(n))], False)

def sleeve(mat, c, axis, r, h, arc):
    """Partial sleeve just proud of a round wire: a paint chip or a rust freckle."""
    p0 = RNG.uniform(0, 2 * np.pi); lathe(mat, [(r + 0.00008, -h / 2), (r + 0.00008, h / 2)], c, axis, 6, (p0, p0 + arc))

def ellipsoid(c, radii, R, nu, nv, mat, stripe_mat=None, stripes=(), half=False):
    a, b, cc = radii; th = np.linspace(0, np.pi, nu + 1); nphi = nv if not half else nv + 1
    ph = np.linspace(-np.pi / 2, np.pi / 2, nphi) if half else np.linspace(0, 2 * np.pi, nphi, endpoint=False)
    V = [(a, 0, 0)]; rows = []
    for t in th[1:-1]:
        rows.append(list(range(len(V), len(V) + nphi)))
        V += [(a * math.cos(t), b * math.sin(t) * math.cos(p), cc * math.sin(t) * math.sin(p)) for p in ph]
    V.append((-a, 0, 0)); last = len(V) - 1
    Fd, Fs = [], []
    for k in range(nv):
        k2 = (k + 1) % nphi
        Fd.append((0, rows[0][k], rows[0][k2]))
        Fd.append((last, rows[-1][k2], rows[-1][k]))
        for i in range(len(rows) - 1):
            f = (rows[i][k], rows[i + 1][k], rows[i + 1][k2], rows[i][k2])
            (Fs if (k in stripes and stripe_mat) else Fd).append(f)
    V = np.array(V) @ np.asarray(R).T + np.asarray(c, float)
    emit(mat, V, Fd, True)
    if Fs: emit(stripe_mat, V, Fs, True)

def fillet(pts, r, n=4, closed=False):
    P = [np.asarray(p, float) for p in pts]; out = []; m = len(P)
    for i in range(m):
        if not closed and i in (0, m - 1): out.append(P[i]); continue
        a, b, c = P[i - 1], P[i], P[(i + 1) % m]; d0 = nz(b - a); d1 = nz(c - b)
        ang = math.acos(float(np.clip(d0 @ d1, -1, 1)))
        if ang < 1e-3: out.append(b); continue
        t = min(r * math.tan(ang / 2), 0.45 * np.linalg.norm(b - a), 0.45 * np.linalg.norm(c - b))
        p0 = b - d0 * t; p1 = b + d1 * t
        out += [(1 - s) ** 2 * p0 + 2 * (1 - s) * s * b + s * s * p1 for s in np.linspace(0, 1, n + 1)]
    return np.array(out)

def frame_to(n, t):
    """Rotation whose columns are (t, n, t x n): local x along t, local y along n."""
    n = nz(n); t = nz(t - (t @ n) * n); return np.stack([t, n, np.cross(t, n)], 1)

# ============================================================== cage layout
AX, AY, Y0 = 0.29, 0.265, 0.56         # arch half width, rise (near a half circle, as on commercial arch-top cages), spring line
WR = 0.00175                            # wall wire radius (3.5 mm)
def arch_y(x): return Y0 + AY * np.sqrt(np.clip(1 - (np.asarray(x) / AX) ** 2, 0, 1))
def arch_pts(off, n=56):
    ph = np.linspace(0, np.pi, n); nx, ny = np.cos(ph) / AX, np.sin(ph) / AY; nn = np.hypot(nx, ny)
    return np.stack([AX * np.cos(ph) + off * nx / nn, Y0 + AY * np.sin(ph) + off * ny / nn], 1)
def arch_at(x, off):
    ph = math.acos(max(-1, min(1, x / AX))); nx, ny = math.cos(ph) / AX, math.sin(ph) / AY; nn = math.hypot(nx, ny)
    return AX * math.cos(ph) + off * nx / nn, Y0 + AY * math.sin(ph) + off * ny / nn
GRID_X = [s * (0.0125 + 0.025 * k) for k in range(11) for s in (-1, 1)]   # |x| <= 0.2625
GRID_Z = [s * (0.0125 + 0.025 * k) for k in range(9) for s in (-1, 1)]    # |z| <= 0.2125
ROOF_Z = [-0.04 + 0.025 * k for k in range(-7, 11)]                      # -0.215 .. 0.21, one through the swing hook
DOOR_X0, DOOR_X1, DOOR_Y0, DOOR_Y1 = -0.12, 0.12, 0.16, 0.44

NODE[0] = 'birdcage'
# ---- feet: rubber caps under powder-coated cups, coat rubbed through on the cup rims
for fx in (-0.265, 0.265):
    for fz in (-0.215, 0.215):
        lathe('rubber', [(0, 0), (0.0085, 0), (0.0107, 0.0008), (0.0118, 0.0026), (0.012, 0.0050), (0.0112, 0.0060), (0, 0.0060)], (fx, 0, fz), segs=20)
        lathe('coat', [(0, 0.0058), (0.0121, 0.0058), (0.0128, 0.0062), (0.0130, 0.0086), (0.0120, 0.0100), (0, 0.0100)], (fx, 0, fz), segs=20)
        for _ in range(2):
            p0 = RNG.uniform(0, 2 * np.pi); a = RNG.uniform(0.4, 0.9)
            lathe('steel_bare', [(0.01308, 0.0064), (0.01308, 0.0064 + RNG.uniform(0.0012, 0.002))], (fx, 0, fz), segs=5, phi=(p0, p0 + a))

# ---- skirt: 1.2 mm sheet on a rounded plan with a rolled top bead and a slot for the tray
box('coat', (0, 0.01075, 0), (0.583, 0.0015, 0.483))
def plan(hx, hz, r, open_front=None):
    pts = [(hx, hz), (hx, -hz), (-hx, -hz), (-hx, hz)]
    if open_front is None: return fillet([(p[0], 0, p[1]) for p in pts], r, 5, closed=True)
    return fillet([(open_front, 0, hz)] + [(p[0], 0, p[1]) for p in pts] + [(-open_front, 0, hz)], r, 5)
def lift(path, y): p = np.array(path, float); p[:, 1] = y; return p
bar('coat', lift(plan(0.2942, 0.2442, 0.012), 0.0768), 0.0006, 0.0317, (0, 1, 0), closed=True, mitre=True)
bar('coat', lift(plan(0.2942, 0.2442, 0.012, open_front=0.275), 0.0275), 0.0006, 0.0175, (0, 1, 0), mitre=True)
wire('coat', lift(plan(0.2925, 0.2425, 0.011), 0.1085), 0.0025, up=(0, 1, 0), closed=True)
for x0 in (-0.275, 0.275):   # folded slot edges
    box('coat', (x0 + np.sign(x0) * 0.001, 0.0275, 0.2436), (0.002, 0.035, 0.0012))
# scuffs on the sheet (lighter, rubbed satin), mostly low on the front and sides
for _ in range(3):
    patch('coat_scuff', (RNG.uniform(-0.24, 0.24), RNG.uniform(0.055, 0.10), 0.2448), (1, 0, 0), (0, 1, 0), RNG.uniform(0.008, 0.016), RNG.uniform(0.0004, 0.0008))
for sx in (-1, 1):
    patch('coat_scuff', (sx * 0.2948, RNG.uniform(0.04, 0.09), RNG.uniform(-0.2, 0.2)), (0, 0, -sx), (0, 1, 0), RNG.uniform(0.008, 0.015), RNG.uniform(0.0004, 0.0008))

# ---- floor grate (y ~0.105) with rust freckles at a few crossings
wire('coat', lift(plan(0.284, 0.234, 0.01), 0.105), 0.0022, up=(0, 1, 0), closed=True)
for z in GRID_Z: wire('coat', [(-0.284, 0.1035, z), (0.284, 0.1035, z)], 0.0015, 6)
for x in GRID_X: wire('coat', [(x, 0.1065, -0.234), (x, 0.1065, 0.234)], 0.0015, 6)
for _ in range(12):
    x = RNG.choice(GRID_X); z = RNG.choice(GRID_Z)
    if RNG.random() < 0.5: sleeve('rust', (x + RNG.uniform(-0.006, 0.006), 0.1035, z), (1, 0, 0), 0.0015, RNG.uniform(0.002, 0.006), RNG.uniform(1.5, 3.5))
    else: sleeve('rust', (x, 0.1065, z + RNG.uniform(-0.006, 0.006)), (0, 0, 1), 0.0015, RNG.uniform(0.002, 0.006), RNG.uniform(1.5, 3.5))

# ---- corner tubes, flat bands
for sx in (-1, 1):
    for sz in (-1, 1):
        box('coat', (sx * 0.29, 0.3365, sz * 0.24), (0.010, 0.453, 0.010))
bar('coat', [(0.29, 0.1145, 0.24), (0.29, 0.1145, -0.24), (-0.29, 0.1145, -0.24), (-0.29, 0.1145, 0.24)], 0.0015, 0.004, (0, 1, 0), closed=True, mitre=True)
bar('coat', [(0.124, 0.33, 0.24), (0.29, 0.33, 0.24), (0.29, 0.33, -0.24), (-0.29, 0.33, -0.24), (-0.29, 0.33, 0.24), (-0.124, 0.33, 0.24)], 0.0015, 0.004, (0, 1, 0), mitre=True)
for sx in (-1, 1):
    bar('coat', [(sx * 0.29, 0.56, -0.245), (sx * 0.29, 0.56, 0.245)], 0.0015, 0.004, (0, 1, 0))
for sz in (-1, 1):   # arched front and back top bands, 8 mm radial in the panel plane
    ap = arch_pts(0.001, 64); bar('coat', [(x, y, sz * 0.24) for x, y in ap], 0.004, 0.0015, (0, 0, 1))

# ---- wall wires
for x in GRID_X:
    top = float(arch_y(x)) + 0.001
    wire('coat', [(x, 0.11, -0.24), (x, top, -0.24)], WR)
    if DOOR_X0 < x < DOOR_X1:
        wire('coat', [(x, 0.11, 0.24), (x, 0.1545, 0.24)], WR); wire('coat', [(x, 0.444, 0.24), (x, top, 0.24)], WR)
    else: wire('coat', [(x, 0.11, 0.24), (x, top, 0.24)], WR)
for z in GRID_Z:
    for sx in (-1, 1): wire('coat', [(sx * 0.29, 0.11, z), (sx * 0.29, 0.56, z)], WR)
# ---- roof: arches across X, stiffener rods along Z on top, crown handle
for z in ROOF_Z: wire('coat', [(x, y, z) for x, y in arch_pts(WR, 38)], WR)
for x in (-0.2, -0.1, 0.0, 0.1, 0.2):
    sx_, sy_ = arch_at(x, 2 * WR + 0.0018); wire('coat', [(sx_, sy_, -0.24), (sx_, sy_, 0.24)], 0.0018)
for z in (-0.028, 0.028): box('coat', (0, Y0 + AY + 0.009, z), (0.005, 0.009, 0.009))
th = np.linspace(0, np.pi, 24); wire('coat', [(0, Y0 + AY + 0.0085 + 0.0095 * math.sin(t), 0.028 * math.cos(t)) for t in th], 0.002)
# the swing's hanger: a U of wire hooked over the roof wire at z -0.04, its cross bar (along X) 8.5 mm over the pivot
SWING_BAR = 0.75 + 0.0085
wire('coat', fillet([(-0.152, float(arch_y(-0.152)) + WR, -0.04), (-0.152, SWING_BAR, -0.04), (-0.108, SWING_BAR, -0.04), (-0.108, float(arch_y(-0.108)) + WR, -0.04)], 0.004, 4), WR)
# ---- door opening frame, threshold, hinge rod, latch pin and bracket
for x in (DOOR_X0, DOOR_X1): box('coat', (x, 0.30, 0.24), (0.008, 0.292, 0.003))
box('coat', (0, 0.44, 0.24), (0.248, 0.008, 0.003))
wire('coat', [(-0.128, 0.1565, 0.2415), (0.128, 0.1565, 0.2415)], 0.0025)
wire('coat', [(-0.12, 0.158, 0.243), (-0.12, 0.442, 0.243)], 0.002)
for y in (0.158, 0.442): lathe('coat', [(0, -0.0012), (0.0026, -0.0012), (0.0026, 0.0012), (0, 0.0012)], (-0.12, y, 0.243), segs=10)
box('coat', (0.136, 0.30, 0.2425), (0.009, 0.016, 0.002))
wire('coat', [(0.135, 0.30, 0.2415), (0.135, 0.30, 0.2521)], 0.0011, 8)
lathe('coat', [(0, 0.2521), (0.0021, 0.2521), (0.0018, 0.2530), (0, 0.2534)], (0.135, 0.30, 0), axis=(0, 0, 1), segs=12)   # rivet head just in front of the coil

# ---- perch: turned dowel, worn lighter band on top, bolts, washers and wing nuts outside the walls
PZ, PY, PR = 0.02, 0.25, 0.014
half = [(0, -0.2872), (0.0122, -0.2872), (0.0136, -0.2862), (0.014, -0.2845), (0.014, -0.2700), (0.0127, -0.2688), (0.0127, -0.2664), (0.014, -0.2652)]
lathe('wood', half + mirror_prof(half), (0, PY, PZ), (1, 0, 0), segs=20)
nx_, na_ = 44, 7; xs = np.linspace(-0.22, 0.25, nx_); Vw = []
for x in xs:
    hw = 0.62 * ss(-0.22, -0.12, x) * ss(0.25, 0.17, x) * (0.8 + 0.2 * ss(0.0, 0.1, x)) + 1e-4
    Vw += [(x, PY + (PR + 0.00004) * math.cos(a), PZ + (PR + 0.00004) * math.sin(a)) for a in np.linspace(-hw, hw, na_)]
emit('wood_worn', Vw, [(i * na_ + j, i * na_ + j + 1, (i + 1) * na_ + j + 1, (i + 1) * na_ + j) for i in range(nx_ - 1) for j in range(na_ - 1)], True)
for s in (-1, 1):
    wire('steel_bare', [(s * 0.284, PY, PZ), (s * 0.2946, PY, PZ)], 0.003, 8)
    wp = ring_prof(0.0032, 0.0075, 0.2918, 0.2930); lathe('steel_bare', wp if s > 0 else mirror_prof(wp), (0, PY, PZ), (1, 0, 0), segs=16)
    np_ = ring_prof(0.0029, 0.0048, 0.2930, 0.2948); lathe('steel_bare', np_ if s > 0 else mirror_prof(np_), (0, PY, PZ), (1, 0, 0), segs=8, smooth=False)
    ear = [(0.004, -0.0022), (0.0095, -0.0029), (0.0118, -0.0016), (0.0121, 0.0008), (0.0106, 0.0027), (0.0045, 0.0021)]
    for e in (ear, [(-a, b) for a, b in ear][::-1]):
        if s > 0: prism('steel_bare', e, (0, PY, PZ), (0, 1, 0), (0, 0, 1), 0.2932, 0.2946)
        else: prism('steel_bare', e, (0, PY, PZ), (0, 1, 0), (0, 0, 1), -0.2946, -0.2932)

# ---- cups: stainless bowls in wire ring holders hooked on the side walls (seed left, water right)
BOWL = [(0, 0.160), (0.028, 0.160), (0.0325, 0.1612), (0.0345, 0.1635), (0.0482, 0.1968), (0.0492, 0.1978), (0.0495, 0.1990),
        (0.0490, 0.2000), (0.0480, 0.2004), (0.0470, 0.2000), (0.0464, 0.1990), (0.0462, 0.1978), (0.0335, 0.1646),
        (0.0315, 0.1624), (0.027, 0.1616), (0, 0.1616)]
def cup(cx, cz, side):
    lathe('stainless', BOWL, (cx, 0, cz), segs=36)
    wire('coat', [(cx + 0.0469 * math.cos(a), 0.19, cz + 0.0469 * math.sin(a)) for a in np.linspace(0, 2 * np.pi, 33)[:-1]], 0.0015, 6, up=(0, 1, 0), closed=True)
    for zw in (-0.1125, -0.1625):
        d = nz(np.array([side * 0.29 - cx, 0, zw - cz])); p0 = np.array([cx, 0.19, cz]) + 0.0469 * d
        loop = [(side * 0.29 - side * 0.0034 * math.cos(a), 0.19 + 0.0006 * a, zw + 0.0034 * math.sin(a)) for a in np.linspace(0, 1.8 * np.pi, 14)]
        wire('coat', [tuple(p0), (side * 0.29 - side * 0.0034, 0.19, zw - 0.0)] + loop[1:], 0.0013, 6)
SEEDC, WATERC = (-0.235, -0.14), (0.235, -0.14)
cup(SEEDC[0], SEEDC[1], -1); cup(WATERC[0], WATERC[1], 1)
# water: a glossy dark surface with a small meniscus, 8 mm under the rim
lathe('water', [(0.0446, 0.1927), (0.0436, 0.1919), (0.040, 0.1915), (0, 0.1915)], (WATERC[0], 0, WATERC[1]), segs=36)
# seeds: a mixed-seed mound with striped sunflower seeds and a few pale safflower seeds on top
def mound(r): return 0.1945 + 0.0125 * (1 - (r / 0.046) ** 2)
lathe('seed_dark', [(0.0458, 0.1940), (0.035, mound(0.035)), (0.024, mound(0.024)), (0.012, mound(0.012)), (0, mound(0))], (SEEDC[0], 0, SEEDC[1]), segs=24)
for i in range(118):
    r = 0.043 * math.sqrt(RNG.random()); a = RNG.uniform(0, 2 * np.pi); x, z = r * math.cos(a), r * math.sin(a)
    slope = 2 * 0.0125 * r / 0.046 ** 2; n = nz(np.array([math.cos(a) * slope, 1, math.sin(a) * slope]) + RNG.normal(0, 0.25, 3))
    R = frame_to(n, RNG.normal(0, 1, 3)); c = (SEEDC[0] + x, mound(r) + RNG.uniform(0.0005, 0.0022), SEEDC[1] + z)
    if i % 8 == 7: ellipsoid(c, (0.0034, 0.0021, 0.0026), R, 5, 8, 'safflower')
    elif i % 5 < 2: ellipsoid(c, (0.0052, 0.0016, 0.0026), R, 6, 10, 'seed_dark')
    else: ellipsoid(c, (0.0055, 0.0016, 0.0028), R, 6, 10, 'seed_dark', 'seed_stripe', (2, 7))

# ============================================================== door (node origin on the hinge line)
NODE[0] = 'door'
DZ = 0.001
bar('coat', fillet([(0.006, 0.004, DZ), (0.241, 0.004, DZ), (0.241, 0.280, DZ), (0.006, 0.280, DZ)], 0.004, 3, closed=True), 0.004, 0.0015, (0, 0, 1), closed=True, mitre=True)
bar('coat', [(0.006, 0.17, DZ), (0.241, 0.17, DZ)], 0.004, 0.0015, (0, 0, 1))
for k in range(9): wire('coat', [(0.0325 + 0.025 * k, 0.004, DZ), (0.0325 + 0.025 * k, 0.280, DZ)], WR)
for y in (0.03, 0.25):   # hinge loops: door wire wrapped round the rod, rubbed to bare steel
    wire('steel_bare', [(0.009, y - 0.003, DZ)] + [(0.0034 * math.cos(a), y + 0.0009 * a, 0.0034 * math.sin(a)) for a in np.linspace(0, 2.2 * np.pi, 22)] + [(0.009, y + 0.009, DZ)], 0.0011, 6)
# chipped coat on the free edge where the latch rides and fingers pull
for yy, a, b in ((0.129, 0.0011, 0.0032), (0.141, 0.0008, 0.0016), (0.266, 0.0009, 0.0018)):
    patch('steel_bare', (0.2438, yy, DZ + 0.0015), (1, 0, 0), (0, 1, 0), a, b, n=11)
for yy in (0.124, 0.137):
    patch('steel_bare', (0.245, yy, DZ), (0, 1, 0), (0, 0, 1), 0.0022, 0.0009, n=11)

# ============================================================== latch (node origin at the pivot)
NODE[0] = 'latch'
coil = [(0.0026 * math.cos(a), 0.0026 * math.sin(a), -0.0045 + 0.0004 * a) for a in np.linspace(-0.35, 4 * np.pi - 1.75, 30)]
hook = [coil[-1], (-0.0012, -0.008, 0.0005), (-0.0015, -0.0165, 0.0005)] + [tuple(p) for p in fillet([(-0.0015, -0.0165, 0.0005), (-0.003, -0.023, 0.0005), (-0.020, -0.0245, 0.0005), (-0.0265, -0.020, 0.0005), (-0.0265, -0.011, 0.0005)], 0.004, 4)][1:]
wire('coat', coil + hook[1:], 0.0009, 6)
wire('coat', [coil[0], (0.007, -0.004, -0.0045), (0.012, -0.0058, -0.0035)], 0.0009, 6)
TAB = [(0.0105, -0.0085), (0.0175, -0.0115), (0.0215, -0.0105), (0.0222, -0.0075), (0.0195, -0.0045), (0.0115, -0.0035)]
prism('coat', TAB[:2] + [(0.0175, -0.0045)] + TAB[5:], (0, 0, 0), (1, 0, 0), (0, 1, 0), -0.0042, -0.0030)
prism('steel_bare', [(0.0175, -0.0115), (0.0215, -0.0105), (0.0222, -0.0075), (0.0195, -0.0045), (0.0175, -0.0045)], (0, 0, 0), (1, 0, 0), (0, 1, 0), -0.0042, -0.0030)

# ============================================================== swing (node origin at the pivot)
NODE[0] = 'swing'
RW = SWING_BAR - 0.75                           # hanger cross bar centre above the pivot
hr = WR + 0.0011 + 0.0003
top = [(0, RW + hr * math.sin(a), hr * math.cos(a)) for a in np.radians(np.linspace(-50, 235, 20))]
bot = [(0, -0.06 + 0.0029 * math.sin(a), 0.0029 * math.cos(a)) for a in np.radians(np.linspace(90, -250, 22))]
wire('coat', top + [(0, 0.0, -0.0018), (0, -0.030, 0), (0, -0.054, 0)] + bot, 0.0011, 6)
wire('coat', fillet([(-0.075, -0.4305, 0), (-0.075, -0.06, 0), (0.075, -0.06, 0), (0.075, -0.4305, 0)], 0.007, 5), 0.0015, 6)
for x in (-0.075, 0.075):
    lathe('brass', [(0, -0.0024), (0.0017, -0.0017), (0.0024, 0), (0.0017, 0.0017), (0, 0.0024)], (x, -0.4318, 0), segs=10)
    lathe('coat', ring_prof(0.0015, 0.0034, -0.4102, -0.4094), (x, 0, 0), segs=10)
seat = [(0, -0.08), (0.0078, -0.08), (0.0088, -0.079), (0.009, -0.0775)]
lathe('wood', seat + mirror_prof(seat), (0, -0.419, 0), (1, 0, 0), segs=16)
wire('steel_bare', [(0.065 + 0.0018 * math.cos(a), -0.4272 + 0.0018 * math.sin(a), 0) for a in np.linspace(0, 2 * np.pi, 13)[:-1]], 0.0005, 5, up=(0, 0, 1), closed=True)
wire('steel_bare', [(0.065, -0.4254, 0), (0.065, -0.419, 0)], 0.0006, 5)

NODE[0] = 'bell'
wire('steel_bare', [(0, 0.0028 * math.sin(a), 0.0028 * math.cos(a)) for a in np.linspace(0, 2 * np.pi, 15)[:-1]], 0.00055, 5, up=(1, 0, 0), closed=True)
wire('brass', [(0.0019 * math.cos(a), -0.0028 + 0.0019 * math.sin(a), 0) for a in np.linspace(0, 2 * np.pi, 13)[:-1]], 0.0007, 6, up=(0, 0, 1), closed=True)
lathe('brass', [(0, -0.0068), (0.0045, -0.0072), (0.0068, -0.0095), (0.0078, -0.0140), (0.0086, -0.0190), (0.0098, -0.0232), (0.0104, -0.0250),
                (0.0110, -0.0253), (0.0112, -0.0247), (0.0108, -0.0235), (0.0096, -0.0200), (0.0090, -0.0167), (0.0093, -0.0161), (0.0089, -0.0155),
                (0.0085, -0.0120), (0.0076, -0.0082), (0.0058, -0.0058), (0.0032, -0.0047), (0, -0.0044)], segs=28)
wire('steel_bare', [(0, -0.007, 0), (0, -0.0248, 0)], 0.0004, 5)
lathe('brass', [(0, -0.0298), (0.0018, -0.0291), (0.0026, -0.0272), (0.0018, -0.0253), (0, -0.0246)], segs=12)

# ============================================================== tray (seated origin (0, 0.0115, 0))
NODE[0] = 'tray'
box('coat', (0, 0.0005, 0.0055), (0.536, 0.001, 0.475))
for sx in (-1, 1): box('coat', (sx * 0.2676, 0.009, 0.0055), (0.0008, 0.018, 0.475))
box('coat', (0, 0.009, -0.2316), (0.536, 0.018, 0.0008))
box('coat', (0, 0.0165, 0.24475), (0.544, 0.033, 0.0015))
wire('coat', [(-0.272, 0.0335, 0.2448), (0.272, 0.0335, 0.2448)], 0.0016)
wire('coat', fillet([(-0.03, 0.017, 0.2455), (-0.03, 0.017, 0.2575), (0.03, 0.017, 0.2575), (0.03, 0.017, 0.2455)], 0.006, 5), 0.0022)
for x in (-0.03, 0.03): box('coat', (x, 0.017, 0.2462), (0.012, 0.012, 0.0006))
for x in (-0.012, 0.004, 0.019): sleeve('steel_bare', (x, 0.017, 0.2575), (1, 0, 0), 0.0022, RNG.uniform(0.006, 0.012), 1.6)
for _ in range(7): patch('rust', (RNG.uniform(-0.26, 0.26), RNG.uniform(0.004, 0.03), 0.2455), (1, 0, 0), (0, 1, 0), RNG.uniform(0.0008, 0.0022), RNG.uniform(0.0008, 0.0018), 0.00012)
for _ in range(4): sleeve('rust', (RNG.uniform(-0.26, 0.26), 0.0335, 0.2448), (1, 0, 0), 0.0016, RNG.uniform(0.002, 0.004), 2.0)
for _ in range(4): patch('coat_scuff', (RNG.uniform(-0.2, 0.2), RNG.uniform(0.008, 0.028), 0.2455), (1, 0, 0), (0, 1, 0), RNG.uniform(0.01, 0.025), RNG.uniform(0.0006, 0.0014))
# newspaper: crumpled height field on the pan, turning up the lip and over it; ink sits 0.3 mm proud
CR = [(RNG.normal(0, 1, 2), RNG.uniform(25, 70), RNG.uniform(0, 6.3), RNG.uniform(0.0002, 0.00042)) for _ in range(7)]
PU0, PU1, PZ0, PZF = -0.262, 0.262, -0.226, 0.2348
def paper_h(u, z):
    u = np.asarray(u, float); z = np.asarray(z, float); h = np.zeros(np.broadcast(u, z).shape)
    for d, k, p, a in CR: d = d / np.linalg.norm(d); h = h + a * (1 + np.sin(k * (d[0] * u + d[1] * z) + p))
    h = h + 0.0011 * np.exp(-((z - 0.012) / 0.009) ** 2)
    q = ((u - PU0) + 0.8 * (z - PZ0)) / 0.125
    return 0.0014 + h * ss(PZF, PZF - 0.03, z) + 0.027 * np.clip(1 - q, 0, 1) ** 2.2
prof = [(z, None) for z in np.linspace(PZ0, PZF, 60)]
prof += [(0.2348 + 0.008 * math.cos(a), 0.0094 + 0.008 * math.sin(a)) for a in np.linspace(-np.pi / 2, 0, 6)[1:]]
prof += [(0.2428, y) for y in np.linspace(0.0094, 0.0335, 5)[1:]]
prof += [(0.2448 + 0.002 * math.cos(a), 0.0335 + 0.002 * math.sin(a)) for a in np.linspace(np.pi, 0, 7)[1:]]
prof += [(0.2468, -f) for f in (0.34, 0.67, 1.0)]   # hangs down the lip by a torn, uneven length
us = np.linspace(PU0, PU1, 44); PV = []
for u in us:
    L = max(0.0006, -0.002 + 0.011 * (0.5 + 0.5 * math.sin(23 * u + 1.3)) * (0.6 + 0.4 * math.sin(57 * u)) + RNG.uniform(0, 0.0015))
    PV += [(u, float(paper_h(u, z)) if y is None else (0.0335 + y * L if y < 0 else y), z) for z, y in prof]
m = len(prof)
emit('paper', PV, [(i * m + j, i * m + j + 1, (i + 1) * m + j + 1, (i + 1) * m + j) for i in range(len(us) - 1) for j in range(m - 1)], True)
def ink(u0, u1, z0, z1, mat='ink', lift_=0.0005):
    z0, z1 = -z1, -z0   # page coordinates: the page top (headline) lies toward the tray lip
    n = max(1, int(math.ceil((u1 - u0) / 0.012))); uu = np.linspace(u0, u1, n + 1)
    V = [(u, float(paper_h(u, z)) + lift_, z) for u in uu for z in (z0, z1)]
    emit(mat, V, [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(n)], False)
ink(-0.25, 0.25, -0.2155, -0.2145); ink(-0.25, 0.25, -0.1805, -0.1797)
for row, (z0, z1) in enumerate(((-0.2115, -0.2005), (-0.1985, -0.1875))):   # headline, letter blocks
    u = -0.245 if row == 0 else -0.23
    while u < (0.23 if row == 0 else 0.12):
        for _ in range(int(RNG.integers(3, 8))):
            w = RNG.uniform(0.004, 0.0075); ink(u, u + w, z0 + RNG.uniform(0, 0.0012), z1 - (0.0025 if RNG.random() < 0.25 else 0)); u += w + 0.0014
        u += 0.007
PH = (0.05, 0.242, -0.172, -0.078)   # photo block: dark frame, pale sky over a dark headland
ink(PH[0], PH[1], PH[2], PH[3]); ink(PH[0] + 0.004, PH[1] - 0.004, PH[2] + 0.004, PH[2] + 0.052, 'paper', 0.0007)
for i in range(14):
    u0 = PH[0] + 0.004 + i * 0.015; ink(u0, u0 + 0.015, PH[2] + 0.052 - 0.004 * math.sin(i / 13 * math.pi) * (1 + (i % 3) * 0.4), PH[2] + 0.053, 'ink', 0.0009)
for k in range(3): ink(PH[0], PH[1] - RNG.uniform(0, 0.08), PH[3] + 0.004 + 0.0028 * k, PH[3] + 0.0052 + 0.0028 * k)
COLS = [(-0.25 + 0.1 * c, -0.25 + 0.1 * c + 0.092) for c in range(5)]
for c, (u0, u1) in enumerate(COLS):
    z = -0.176; nl = 0; para = int(RNG.integers(6, 16))
    while z < 0.222:
        if u1 > PH[0] and u0 < PH[1] and z < PH[3] + 0.013: z = PH[3] + 0.0135; continue
        if RNG.random() < 0.03: ink(u0, u1 - RNG.uniform(0.01, 0.04), z, z + 0.0021); z += 0.0045; continue   # subhead
        nl += 1; end = u1 - (RNG.uniform(0.02, 0.07) if nl == para else RNG.uniform(0, 0.002))
        ink(u0, end, z, z + 0.00115); z += 0.0027
        if nl == para: nl = 0; para = int(RNG.integers(6, 16)); z += 0.0015
# husks (split, empty shells) and one small white feather on the paper
for i in range(9):
    u, z = RNG.uniform(-0.2, 0.22), RNG.uniform(-0.04, 0.2); yaw = RNG.uniform(0, 2 * np.pi)
    n = np.array([0, 1., 0]) if i % 3 else np.array([0, -1., 0])
    R = frame_to(n, np.array([math.cos(yaw), 0, math.sin(yaw)]))
    ellipsoid((u, float(paper_h(u, z)) + (0.0012 if n[1] < 0 else 0.0002), z), (0.0055, 0.0012, 0.0027), R, 6, 6, 'seed_dark', 'seed_stripe', (1, 4), half=True)
FU, FZ, FY = 0.0, 0.10, 0.0
d = nz(np.array([math.cos(0.6), 0, math.sin(0.6)])); pp = np.array([-d[2], 0, d[0]]); L = 0.052
ts = np.linspace(0, 1, 14)
def fpt(t, s):
    base = np.array([FU, 0, FZ]) + d * (t - 0.5) * L
    p = base + pp * s + d * abs(s) * 0.35
    return (p[0], float(paper_h(p[0], p[2])) + 0.0006 + 0.004 * max(0, t - 0.6) ** 2 * 6 + 0.9 * s * s, p[2])
wire('feather', [fpt(t, 0) for t in np.linspace(-0.12, 1, 16)], 0.00035, 5)
for side in (-1, 1):
    Vf = []; Ff = []
    for i, t in enumerate(ts):
        w = 0.0085 * math.sin(math.pi * min(1, t * 1.12) ** 0.75) + 0.002
        jag = RNG.uniform(0.6, 1.0) if t < 0.3 else RNG.uniform(0.92, 1.0)
        Vf += [fpt(t, side * w * f * (jag if f == 1 else 1)) for f in (0.03, 0.4, 0.75, 1.0)]
    for i in range(len(ts) - 1):
        for j in range(3):
            q = (i * 4 + j, i * 4 + j + 1, (i + 1) * 4 + j + 1, (i + 1) * 4 + j); Ff.append(q if side > 0 else q[::-1])
    emit('feather', Vf, Ff, True)

# ============================================================== objects, export
NODES = [  # name, parent, translation (game, parent local)
    ('birdcage', None, (0, 0, 0)), ('door', 'birdcage', (-0.12, 0.16, 0.243)), ('latch', 'birdcage', (0.135, 0.30, 0.25)),
    ('swing', 'birdcage', (-0.13, 0.75, -0.04)), ('bell', 'swing', (0.065, -0.43, 0.0)), ('tray', 'birdcage', (0, 0.0115, 0.02)),
    ('anchor_perch', 'birdcage', (0.10, 0.264, 0.02)), ('anchor_seed', 'birdcage', (SEEDC[0], 0.20, SEEDC[1])),
    ('anchor_water', 'birdcage', (WATERC[0], 0.20, WATERC[1])), ('anchor_swing', 'swing', (0.0, -0.41, 0.0)), ('anchor_bell', 'bell', (0, -0.016, 0)),
]
OBJ = {}; TRIS = 0
def gl2b(p): return (p[0], -p[2], p[1])
for name, parent, loc in NODES:
    parts = GEO.get(name)
    if parts:
        me = bpy.data.meshes.new(name + '_mesh'); Vs = []; Fs = []; mi = []; sm = []; off = 0
        for k, (mn, d) in enumerate(sorted(parts.items())):
            V = np.vstack(d['V']); Vs.append(V); Fs += [tuple(i + off for i in f) for f in d['F']]
            mi += [k] * len(d['F']); sm += d['S']; off += len(V); me.materials.append(MAT[mn])
        V = np.vstack(Vs); me.from_pydata(np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1).tolist(), [], Fs)
        me.polygons.foreach_set('material_index', mi); me.polygons.foreach_set('use_smooth', sm); me.update(); me.validate()
        TRIS += sum(len(p.vertices) - 2 for p in me.polygons)
        ob = bpy.data.objects.new(name, me)
    else:
        ob = bpy.data.objects.new(name, None); ob.empty_display_size = 0.01
    bpy.context.scene.collection.objects.link(ob)
    if parent: ob.parent = OBJ[parent]
    ob.location = gl2b(loc); OBJ[name] = ob
print('CAGE tris', TRIS, 'meshes', sum(1 for n in GEO), 'materials', len(MAT))

kw = dict(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT', export_image_format='NONE',
          export_texcoords=False, export_normals=True, export_tangents=False, export_vertex_color='NONE', export_attributes=False,
          export_draco_mesh_compression_enable=False, export_animations=False, export_skins=False, export_morph=False,
          export_cameras=False, export_lights=False, export_extras=False, use_selection=False)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props or k == 'filepath'})
print('CAGE wrote', OUT, os.path.getsize(OUT), 'bytes')

# ============================================================== renders (optional; nothing below is exported)
if RENDER:
    os.makedirs(RENDER, exist_ok=True); scn = bpy.context.scene
    scn.render.engine = 'CYCLES'; scn.cycles.samples = 96; scn.cycles.use_denoising = True
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
        for dv in pr.devices: dv.use = True
        scn.cycles.device = 'GPU'
    except Exception as e: print('CAGE gpu fallback', e)
    scn.render.resolution_x = scn.render.resolution_y = 1000
    world = bpy.data.worlds.new('w'); scn.world = world
    if hasattr(world, 'use_nodes'): world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.62, 0.63, 0.65, 1); bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2.6; sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(42), math.radians(8), math.radians(-30)); scn.collection.objects.link(sun)
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'AREA')); key.data.energy = 60; key.data.size = 1.2
    key.location = (-1.2, -1.4, 1.6); key.rotation_euler = (math.radians(50), 0, math.radians(-40)); scn.collection.objects.link(key)
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True if hasattr(gm, 'use_nodes') else None; gb = gm.node_tree.nodes['Principled BSDF']
    gb.inputs['Base Color'].default_value = (0.46, 0.43, 0.39, 1); gb.inputs['Roughness'].default_value = 0.85
    gme = bpy.data.meshes.new('ground'); gme.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)]); gme.materials.append(gm)
    ground = bpy.data.objects.new('ground', gme); scn.collection.objects.link(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.clip_start = 0.005; scn.collection.objects.link(cam); scn.camera = cam
    from mathutils import Vector
    def look(name, eye, target, lens=50):
        e = Vector(gl2b(eye)); t = Vector(gl2b(target)); cam.data.lens = lens
        cam.location = e; cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(RENDER, name + '.png'); bpy.ops.render.render(write_still=True); print('CAGE render', name)
    def orbit(az, el, dist, target):
        a, e = math.radians(az), math.radians(el)
        return (target[0] + dist * math.sin(a) * math.cos(e), target[1] + dist * math.sin(e), target[2] + dist * math.cos(a) * math.cos(e))
    only = arg('--only')
    shots = {
        'cage_front34': lambda: look('cage_front34', orbit(35, 16, 1.75, (0, 0.40, 0)), (0, 0.40, 0)),
        'cage_ref_match': lambda: look('cage_ref_match', orbit(-38, 6, 1.6, (0.02, 0.36, 0)), (0.02, 0.36, 0)),
        # matches the Commons reference (File:543 71 Hostinné, Czech Republic - panoramio (9).jpg, a commercial
        # arch-top parrot cage, CC BY-SA 3.0 ariannesmidt): front right, camera at about mid height
        'cage_ref_arch': lambda: look('cage_ref_arch', orbit(17, 3, 1.55, (0, 0.42, 0)), (0, 0.42, 0), 42),
        'cage_closeup_door': lambda: look('cage_closeup_door', orbit(28, 12, 0.42, (0.03, 0.30, 0.245)), (0.03, 0.30, 0.245)),
        'cage_inside': lambda: look('cage_inside', (0.06, 0.47, 0.215), (-0.04, 0.27, -0.12), 18),
    }
    def tray_shot():
        OBJ['tray'].location = gl2b((0, 0.0115, 0.30)); look('cage_tray', orbit(12, 48, 0.62, (0, 0.03, 0.34)), (0, 0.03, 0.34))
        OBJ['tray'].location = gl2b((0, 0.0115, 0.02))
    def open_shot():
        OBJ['door'].rotation_euler = (0, 0, -1.9); OBJ['latch'].rotation_euler = (0, -1.0, 0)
        look('cage_door_open', orbit(32, 14, 1.1, (-0.02, 0.32, 0.1)), (-0.02, 0.32, 0.1))
        OBJ['door'].rotation_euler = (0, 0, 0); OBJ['latch'].rotation_euler = (0, 0, 0)
    shots['cage_tray'] = tray_shot; shots['cage_door_open'] = open_shot
    for k, f in shots.items():
        if not only or k in only.split(','): f()
