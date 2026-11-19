# Blender 5.x batch builder for the neon ski vest (a personal flotation device) worn on the jetski:
# public/models/jetski_pfd.glb, two top-level nodes, pfd_rider (fitted to public/models/characters/player.glb) and
# pfd_mate (fitted to public/models/characters/crowd/swim/f03.glb).
#   blender -b --factory-startup --python tools/jetski/pfd_build.py -- <repo root> [--render <dir>]
# Frame: each node's transform is its wearer's 'Bip01 Spine2' joint at rest, the product of the glTF node TRS from the
# scene root down to that joint (equal to the inverse of the joint's inverse bind matrix). It carries the rig's 0.01
# scale, so the vest's vertices are centimetres of the joint's own frame. Worn: vest matrix = the joint's world matrix.
# Node extras repeat it: bone, joint (index into skin.joints), jointNode (node index), restPos, restQuat (x, y, z, w),
# restScale, all in the model space of the wearer's glTF scene.
# Fit: rays from a point inside the chest find the rest-pose skin; the shell's inner face bridges hollows and sits
# GAP off the torso (arms excluded, YGAP over the shoulders); quilted foam TF thick on the front and back, TS at the sides and
# over the shoulders, thinning to its edges, which roll into a round binding. Mirror-symmetric about the body's midplane.
# The hem curves up under the arms and where the two front panels meet at the zip; the back neckline scoops under long hair.
# --render <dir>: Eevee contact sheets of both wearers and of the fit checks (seated clip, hat down the back).
import bpy, bmesh, sys, os, math, json, struct
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
RENDER = argv[argv.index('--render') + 1] if '--render' in argv else None
OUT = ROOT + '/public/models/jetski_pfd.glb'
WEARERS = [('pfd_rider', 'public/models/characters/player.glb'), ('pfd_mate', 'public/models/characters/crowd/swim/f03.glb')]
BONE = 'Bip01 Spine2'
bpy.ops.wm.read_factory_settings(use_empty=True)
log = lambda *a: print('PFD', *a, flush=True)
TAU = 2 * math.pi
NT, NV = 48, 16                 # shell grid: columns round the body (4 per foam channel), rows hem to neckline
DT = TAU / NT
GAP, TF, TS = 0.017, 0.034, 0.020   # skin to shell; foam front and back; foam at the sides and over the shoulders
GD, ZD, RB = 0.012, 0.006, 0.0065   # channel groove depth; extra depth of the zip channel; bulge of the bound edges
STRAP, NGAP = 0.05, 0.022           # shoulder strap width; neckline off the neck
HOLE_T, SE = math.radians(41), 2.0  # arm hole half-width round the body (front half); its superellipse exponent
HCLR = 0.025                        # the back neckline under hair hanging over the back (the collar's height and 5 mm)
HEM_SIDE, HEM_ZIP = 0.016, 0.011    # hem rise under the arms; at the zip
# per wearer: shoulder strap width, arm hole back half-width, shell gap over the shoulders, back neckline under the hair
# (se_top: superellipse exponent of the arm hole's upper half, squarer gives a narrower strap over the shoulder; hair: scoop the back under it)
TUNE = {'pfd_rider': dict(strap=0.05, ab=math.radians(38), ygap=0.012, se_top=2.8, hair=False), 'pfd_mate': dict(strap=0.04, ab=math.radians(31), ygap=0.009, se_top=2.2, hair=True)}
CM = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)  # glTF (Y up) to Blender (Z up)
CM4 = np.eye(4); CM4[:3, :3] = CM
smooth = lambda x: (lambda c: c * c * (3 - 2 * c))(min(max(x, 0.0), 1.0))
wrap = lambda a: (a + math.pi) % TAU - math.pi

# ------------------------------------------------------------------ glTF rig reading and skinning (numpy)
def mat_trs(t, r, s):
    x, y, z, w = np.asarray(r, float) / np.linalg.norm(r)
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.asarray(s, float)[None, :]; M[:3, 3] = t; return M

class Rig:
    def __init__(s, path):
        b = open(path, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
        s.J = json.loads(b[20:20 + n]); o = 20 + n; s.bin = b[o + 8:o + 8 + struct.unpack('<I', b[o:o + 4])[0]]
        N = s.N = s.J['nodes']; assert not any('matrix' in x for x in N)
        s.par = {c: i for i, x in enumerate(N) for c in x.get('children', [])}
        s.rest = [(np.array(x.get('translation', [0, 0, 0]), float), np.array(x.get('rotation', [0, 0, 0, 1]), float),
                   np.array(x.get('scale', [1, 1, 1]), float)) for x in N]
        s.node = {x.get('name'): i for i, x in enumerate(N)}
        sk = s.J['skins'][0]; s.joints = sk['joints']
        s.ibm = s.acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1).astype(float)
        s.names = [N[j].get('name') or '' for j in s.joints]; s.ji = {m: k for k, m in enumerate(s.names)}
        s.mesh_node = next(i for i, x in enumerate(N) if 'skin' in x and 'mesh' in x)
        s.prims = []
        for pr in s.J['meshes'][N[s.mesh_node]['mesh']]['primitives']:
            a = pr['attributes']; w = s.acc(a['WEIGHTS_0']).astype(float)
            s.prims.append(dict(name=s.J['materials'][pr['material']]['name'], P=s.acc(a['POSITION']).astype(float), J=s.acc(a['JOINTS_0']).astype(int),
                                W=w / np.maximum(w.sum(1, keepdims=True), 1e-9), I=s.acc(pr['indices']).reshape(-1, 3).astype(int)))
        s.W0 = s.worlds(s.rest)
    def acc(s, i):
        a = s.J['accessors'][i]; bv = s.J['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}[a['componentType']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]; it = np.dtype(dt).itemsize
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', nc * it)
        raw = np.frombuffer(s.bin, np.uint8, count=st * (a['count'] - 1) + nc * it, offset=off)
        out = raw[np.arange(a['count'])[:, None] * st + np.arange(nc * it)[None, :]].copy().view(dt).reshape(a['count'], nc)
        return out.astype(float) / np.iinfo(dt).max if a.get('normalized') else out
    def worlds(s, T):
        W = [None] * len(s.N)
        def w(i):
            if W[i] is None: W[i] = (w(s.par[i]) if i in s.par else np.eye(4)) @ mat_trs(*T[i])
            return W[i]
        for i in range(len(s.N)): w(i)
        return W
    def jw(s, W, name): return W[s.joints[s.ji[name]]]
    def skin(s, W, pr):
        M = np.stack([W[j] @ s.ibm[k] for k, j in enumerate(s.joints)]); Ph = np.c_[pr['P'], np.ones(len(pr['P']))]; out = np.zeros((len(Ph), 4))
        for c in range(pr['J'].shape[1]): out += pr['W'][:, c:c + 1] * np.einsum('nij,nj->ni', M[pr['J'][:, c]], Ph)
        return out[:, :3]
    def pose(s, anim, frac=0.0, src=None):
        # node world matrices of a clip at a fraction of its length; src: another rig whose clip drives this rig's
        # rotations by node name (the Rocketbox skeletons share joint names and axes)
        g = src or s; A = next(a for a in g.J['animations'] if a['name'] == anim)
        T = [tuple(v.copy() for v in r) for r in s.rest]
        for ch in A['channels']:
            nm = g.N[ch['target']['node']].get('name'); path = ch['target']['path']
            if nm not in s.node or (src is not None and path != 'rotation') or path not in ('translation', 'rotation', 'scale'): continue
            sm = A['samplers'][ch['sampler']]; ti = g.acc(sm['input']).ravel().astype(float); out = g.acc(sm['output']).astype(float)
            if sm.get('interpolation') == 'CUBICSPLINE': out = out.reshape(len(ti), 3, -1)[:, 1]
            k = int(np.argmin(np.abs(ti - (ti[0] + frac * (ti[-1] - ti[0])))))
            i = s.node[nm]; t0, r0, s0 = T[i]
            T[i] = (out[k], r0, s0) if path == 'translation' else (t0, out[k], s0) if path == 'rotation' else (t0, r0, out[k])
        return s.worlds(T)

ARMK = ('UpperArm', 'Forearm', 'ForeArm', 'Hand', 'Finger')
def body_arrays(rig, W, keep=('body', 'head')):
    armj = np.array([any(k in m for k in ARMK) for m in rig.names], float); hatj = np.array([m in ('Hat', 'HatCord') for m in rig.names], float)
    hd_ = rig.node['Bip01 Head']; under = lambda i: i == hd_ or (i in rig.par and under(rig.par[i]))
    headj = np.array([under(j) and rig.names[k] not in ('Hat', 'HatCord') for k, j in enumerate(rig.joints)], float)
    V, F, AW, HW = [], [], [], []; off = 0
    for pr in rig.prims:
        if pr['name'] not in keep: continue
        V.append(rig.skin(W, pr)); F.append(pr['I'] + off); off += len(pr['P'])
        AW.append((pr['W'] * armj[pr['J']]).sum(1)); HW.append((pr['W'] * hatj[pr['J']]).sum(1) + 2 * (pr['W'] * headj[pr['J']]).sum(1))
    return np.concatenate(V), np.concatenate(F), np.concatenate(AW), np.concatenate(HW)

def ray_seg(o, d, a, b):
    # closest approach of the ray o + t d and the segment a..b: (t, distance)
    u = b - a; w = o - a; A_, B_, C_, D_, E_ = d @ d, d @ u, u @ u, d @ w, u @ w; den = A_ * C_ - B_ * B_
    s = float(np.clip((A_ * E_ - B_ * D_) / den, 0, 1)) if den > 1e-12 else 0.0
    t = (B_ * s - D_) / A_; return t, float(np.linalg.norm(o + d * t - a - u * s))

# ------------------------------------------------------------------ geometry helpers (model space, metres)
MATN = ['PFD_Shell', 'PFD_Strap', 'PFD_Buckle', 'PFD_Zip', 'PFD_Reflective']
SHELL, STRAPM, BUCKLE, ZIP, REFL = range(5)
def sweep(bm, pts, nrms, prof, mi, taper=None):
    # a closed tube: the profile [(b, n)] swept along pts, n along the surface normal, b across the path
    n = len(pts); rings = []
    for k in range(n):
        P = Vector(pts[k]); N = Vector(nrms[k]).normalized(); T = Vector(pts[min(k + 1, n - 1)]) - Vector(pts[max(k - 1, 0)])
        T = (T - N * T.dot(N)).normalized(); B = N.cross(T); sc = taper[k] if taper else 1.0
        rings.append([bm.verts.new(P + B * (b * sc) + N * (m * sc)) for b, m in prof])
    fs = []
    for k in range(n - 1):
        for q in range(len(prof)):
            q1 = (q + 1) % len(prof); fs.append(bm.faces.new([rings[k][q], rings[k][q1], rings[k + 1][q1], rings[k + 1][q]]))
    fs += [bm.faces.new(rings[0]), bm.faces.new(rings[-1])]
    for f in fs: f.material_index = mi
    return fs
def box(bm, c, T, B, N, size, mi, bev=0.0, seg=1):
    T, B, N = Vector(T).normalized(), Vector(B).normalized(), Vector(N).normalized(); c = Vector(c)
    vs = [bm.verts.new(c + T * (sx * size[0] / 2) + B * (sy * size[1] / 2) + N * (sz * size[2] / 2)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    fs = [bm.faces.new([vs[i] for i in q]) for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))]
    if bev > 0:
        edges = list({e for f in fs for e in f.edges})
        res = bmesh.ops.bevel(bm, geom=vs + edges, offset=bev, segments=seg, affect='EDGES', profile=0.5)
        fs = fs + list(res['faces'])
    for f in bm.faces:
        if f in fs or any(v in vs for v in f.verts): f.material_index = mi
    return fs
PROF_RECT = lambda w, n0, n1: [(-w / 2, n0), (w / 2, n0), (w / 2, n1), (-w / 2, n1)]
PROF_TAPE = lambda w: [(-w / 2, 0.0024), (w / 2, 0.0024), (0.0, -0.005)]  # flat face out, a keel sunk into the foam
PROF_WEB = lambda w, n0, n1: (lambda c: [(-w / 2, n0), (w / 2, n0), (w / 2, n1 - c), (w / 2 - c, n1), (-w / 2 + c, n1), (-w / 2, n1 - c)])(min(0.0012, (n1 - n0) / 2))  # webbing, rounded outer corners

# ------------------------------------------------------------------ fit one vest
def fit(rig, tag):
    TU = TUNE[tag]
    # HW: 1 per unit of hat weight, 2 per unit of head weight; hair is head-weighted skin below the neck joint
    W = rig.W0; V, Fc, AW, HW = body_arrays(rig, W); hair = (HW >= 1.0) & (V[:, 1] < rig.jw(W, 'Bip01 Neck')[1, 3] + 0.03)
    # the fit sees the torso and neck only: the head (face, skull, hair) and the hat are left out
    okv = HW < 0.5; log(tag, 'head, hair and hat vertices left out of the fit', int((~okv).sum()), 'of them hair below the neck joint', int(hair.sum()))
    jp = lambda m: rig.jw(W, m)[:3, 3].copy()
    S2, NK, SP, LUA, RUA, LCL = jp(BONE), jp('Bip01 Neck'), jp('Bip01 Spine'), jp('Bip01 L UpperArm'), jp('Bip01 R UpperArm'), jp('Bip01 L Clavicle')
    UP = np.array([0, 1.0, 0]); FW = np.array([0, 0, np.sign(jp('Bip01 L Toe0')[2] - jp('Bip01 L Foot')[2])]); LF = np.array([np.sign(LUA[0] - S2[0]), 0, 0])
    hd = lambda th: FW * math.cos(th) + LF * math.sin(th)
    dr = lambda th, ph: hd(th) * math.cos(ph) + UP * math.sin(ph)
    ring = (AW > 0.3) & (AW < 0.7) & okv & (np.abs(V[:, 0] - S2[0]) < abs(LUA[0] - S2[0]) + 0.04) & (V[:, 1] > S2[1] - 0.3)
    y_ap = float(np.percentile(V[ring, 1], 3)) if ring.sum() > 20 else float(LUA[1] - 0.09)
    y_hem = max(float(SP[1]) + 0.02, y_ap - 0.27); yc = y_ap - 0.02
    sl = (AW < 0.1) & okv & (np.abs(V[:, 1] - yc) < 0.015) & (np.abs(V[:, 0] - S2[0]) < 0.04)
    C = np.array([S2[0], yc, (V[sl, 2].min() + V[sl, 2].max()) / 2])
    ns = (AW < 0.1) & ((HW < 0.5) | (HW >= 1.0)) & ~hair & (np.abs(V[:, 1] - (NK[1] + 0.06)) < 0.008) & (np.hypot(V[:, 0] - NK[0], V[:, 2] - NK[2]) < 0.12)
    NC = V[ns][:, [0, 2]].mean(0); rn_ = np.hypot(V[ns, 0] - NC[0], V[ns, 2] - NC[1]); an_ = np.floor((np.arctan2(V[ns, 0] - NC[0], V[ns, 2] - NC[1]) + math.pi) / TAU * 12)
    RN = float(np.median([rn_[an_ == k].max() for k in range(12) if (an_ == k).any()]))  # the neck at mid height, robust to hair over a few sectors
    rho = lambda p: math.hypot(p[0] - NC[0], p[2] - NC[1]); yV0 = float(NK[1]) - 0.10
    # the fit meshes: the body primitive, and of the head primitive only the neck (inside a cylinder round it), so hair
    # hanging over the nape and shoulders does not push the shell out
    nbody = len(next(p_ for p_ in rig.prims if p_['name'] == 'body')['P']); isb = np.arange(len(V)) < nbody
    fitv = okv & (isb | ((np.hypot(V[:, 0] - NC[0], V[:, 2] - NC[1]) < RN + 0.012) & (V[:, 1] > NK[1] - 0.08)))
    Vv = [Vector(v) for v in V]; fa = Fc[fitv[Fc].all(1)]; ft = fa[(AW[fa] <= 0.5).all(1)]
    bvh_all = BVHTree.FromPolygons(Vv, fa.tolist(), all_triangles=True); bvh_t = BVHTree.FromPolygons(Vv, ft.tolist(), all_triangles=True)
    log(tag, 'fit vertices', int(fitv.sum()), 'of', len(V))
    yV = lambda th: yV0 + 0.4 * smooth(abs(wrap(th)) / math.radians(52)) if abs(wrap(th)) < math.radians(52) else 9.0
    # the hem: level front and back, up HEM_SIDE under the arms, rounded up HEM_ZIP where the two front panels meet at the zip
    hemy = lambda th: y_hem + HEM_SIDE * smooth((abs(math.sin(th)) - 0.3) / 0.6) + HEM_ZIP * smooth(1 - abs(wrap(th)) / (DT * 1.7))
    # long hair hanging over the back (head-primitive vertices left out of the fit, below the neck, well out from it): the back
    # neckline stays HCLR under its tips, column by column (never under the armpits' height), behind the arm holes only
    HO = V[~isb & (AW < 0.5) & ~fitv & (V[:, 1] < NK[1] + 0.02)]; HO = HO[np.hypot(HO[:, 0] - NC[0], HO[:, 2] - NC[1]) > RN + 0.06]
    haz = np.arctan2((HO - C) @ LF, (HO - C) @ FW); capy = np.full(NT, 9.0); tcu = abs(math.atan2((LUA - C) @ LF, (LUA - C) @ FW))
    for i in range(NT if TU['hair'] else 0):
        s_ = np.abs(wrap(haz - i * DT)) < DT * 1.5
        if abs(wrap(i * DT)) > tcu + TU['ab'] + 1.5 * DT and s_.any(): capy[i] = max(float(HO[s_, 1].min()) - HCLR, y_ap - 0.015)
    capy = np.minimum(capy, np.roll(capy[::-1], 1))  # the lower of each column and its mirror: the vest stays symmetric
    log(tag, 'back neckline under the hair (y per column)', [round(float(x), 3) for x in capy if x < 9])
    fa_ = jp('Bip01 L Forearm') - LUA
    log(tag, 'landmarks: facing', FW, 'left', LF, 'armpit y', round(y_ap, 3), 'hem y', round(y_hem, 3), 'centre', C.round(3), 'neck y', round(float(NK[1]), 3),
        'neck radius', round(RN, 3), 'upper arm below horizontal deg', round(math.degrees(math.asin(-fa_[1] / np.linalg.norm(fa_))), 1))
    def hit(o, d, bvh=bvh_all):
        l, n, i, t = bvh.ray_cast(Vector(o), Vector(d)); return None if l is None else np.array(l)
    def bis(f, lo, hi, n=24):
        for _ in range(n):
            m = (lo + hi) / 2
            if f(m): lo = m
            else: hi = m
        return lo
    ph_hem = np.array([bis(lambda ph: (lambda h: h is None or h[1] < hemy(i * DT))(hit(C, dr(i * DT, ph))), -1.35, 0.4) for i in range(NT)])
    def top(th):
        # march up from the chest to the first ray that fails the neckline test (a bisection alone could settle on the jaw)
        ok = lambda ph: (lambda h: h is not None and rho(h) >= RN + NGAP and h[1] <= min(yV(th), NK[1] + 0.03, capy[int(round(th / DT)) % NT]))(hit(C, dr(th, ph)))
        ph = 0.15
        while ph < 1.5 and ok(ph + 0.02): ph += 0.02
        return bis(ok, ph, ph + 0.02, 12)
    ph_top = np.array([top(i * DT) for i in range(NT)])
    # the neckline as a smooth run of heights round the neck (a min filter, then averaging), back to ray elevations
    yt = np.array([(lambda h: NK[1] if h is None else h[1])(hit(C, dr(i * DT, ph_top[i]))) for i in range(NT)])
    yt = np.minimum(yt, np.minimum(np.roll(yt, 1), np.roll(yt, -1)))
    for _ in range(3): yt = (np.roll(yt, 1) + 2 * yt + np.roll(yt, -1)) / 4
    yt = np.minimum(yt, capy)  # the smoothing does not lift the neckline back into the hair
    ph_top = np.array([bis(lambda ph: (lambda h: h is not None and h[1] < yt[i])(hit(C, dr(i * DT, ph))), 0.15, ph_top[i] + 0.02) for i in range(NT)])
    pint = lambda arr, th: (lambda x: arr[int(math.floor(x)) % NT] * (1 - (x - math.floor(x))) + arr[(int(math.floor(x)) + 1) % NT] * (x - math.floor(x)))((th % TAU) / DT)
    phi = lambda th, v: pint(ph_hem, th) + (pint(ph_top, th) - pint(ph_hem, th)) * v
    VS = 1 - (1 - np.linspace(0, 1, NV)) ** 1.3  # rows closer together towards the neckline (the shoulder straps)
    holes = []
    for U in (LUA, RUA):
        tc = math.atan2((U - C) @ LF, (U - C) @ FW); h0, h1 = pint(ph_hem, tc), pint(ph_top, tc)
        pa = bis(lambda ph: (lambda h: h is None or h[1] < y_ap - 0.035)(hit(C, dr(tc, ph))), h0, h1); va = (pa - h0) / (h1 - h0)
        pts = [p for p in (hit(C, dr(tc, h0 + (h1 - h0) * v)) for v in np.linspace(0, 1, 41)) if p is not None]
        L = sum(np.linalg.norm(b - a) for a, b in zip(pts, pts[1:])); vt = min(VS[NV - 3] - 0.01, 1 - TU['strap'] / L)
        holes.append(dict(tc=tc, vc=(va + vt) / 2, af=HOLE_T, ab=TU['ab'], av=(vt - va) / 2, vt=vt))
        log(tag, 'arm hole: centre deg', round(math.degrees(tc), 1), 'v', round(va, 3), 'to', round(vt, 3), 'column length', round(L, 3))
    # the two holes made mirror images (their mean), so the vest is symmetric
    for k_ in ('vc', 'av', 'vt'): holes[0][k_] = holes[1][k_] = (holes[0][k_] + holes[1][k_]) / 2
    t_ = (abs(holes[0]['tc']) + abs(holes[1]['tc'])) / 2; holes[0]['tc'], holes[1]['tc'] = math.copysign(t_, holes[0]['tc']), math.copysign(t_, holes[1]['tc'])
    hnorm = lambda x, y: (lambda se: (abs(x) ** se + abs(y) ** se) ** (1 / se))(TU['se_top'] if y > 0 else SE)
    hw = lambda h, d: h['ab'] if d * h['tc'] > 0 else h['af']  # the back half of a hole is narrower (covers the back)
    hn = lambda th, v, h: (lambda d: hnorm(d / hw(h, d), (v - h['vc']) / h['av']))(wrap(th - h['tc']))
    ks = {(i, j) for i in range(NT) for j in range(NV - 1) if min(hn((i + .5) * DT, (VS[j] + VS[j + 1]) / 2, h) for h in holes) > 1}
    cells_of = {}
    for i in range(NT):
        for j in range(NV - 1):
            for q in ((i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)): cells_of.setdefault(q, []).append((i, j))
    used = sorted(q for q, cs in cells_of.items() if any(c in ks for c in cs))
    TH, VP = {}, {}
    for q in used:
        th, v = q[0] * DT, VS[q[1]]
        if any(c not in ks for c in cells_of[q]):
            h = min(holes, key=lambda h: hn(th, v, h)); n = hn(th, v, h); th = h['tc'] + wrap(th - h['tc']) / n; v = h['vc'] + (v - h['vc']) / n
        TH[q], VP[q] = th, v
    # even out the arm hole outline: each vertex on it moves towards the middle of its two neighbours along the
    # outline, then back onto the superellipse (dense rows near the strap otherwise leave small zigzags)
    snapped = {q for q in used if any(c not in ks for c in cells_of[q])}; ec0, hb = {}, {}
    for (i, j) in ks:
        c = [(i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)]
        for k in range(4): ec0.setdefault(frozenset((c[k], c[(k + 1) % 4])), []).append((i, j))
    for e, cs in ec0.items():
        a_, b_ = tuple(e)
        if len(cs) == 1 and a_ in snapped and b_ in snapped: hb.setdefault(a_, []).append(b_); hb.setdefault(b_, []).append(a_)
    for _ in range(6):
        new = {}
        for q, ns_ in hb.items():
            if len(ns_) != 2: continue
            h = min(holes, key=lambda h: hn(TH[q], VP[q], h)); xy = lambda m: (lambda d: np.array([d / hw(h, d), (VP[m] - h['vc']) / h['av']]))(wrap(TH[m] - h['tc']))
            p_ = 0.5 * xy(q) + 0.25 * (xy(ns_[0]) + xy(ns_[1])); n_ = hnorm(p_[0], p_[1])
            new[q] = (h['tc'] + p_[0] / n_ * hw(h, p_[0]), h['vc'] + p_[1] / n_ * h['av'])
        for q, (th, v) in new.items(): TH[q], VP[q] = th, v
    D = {q: dr(TH[q], phi(TH[q], VP[q])) for q in used}
    us = set(used); nb = {q: [m for m in (((q[0] + 1) % NT, q[1]), ((q[0] - 1) % NT, q[1]), (q[0], q[1] + 1), (q[0], q[1] - 1)) if m in us] for q in used}
    r = {}
    for q in used:
        l, n_, i_, t = bvh_all.ray_cast(Vector(C), Vector(D[q])); r[q] = t if l is not None else float('nan')
    miss = sum(1 for q in used if math.isnan(r[q]))
    for _ in range(40):
        bad = [q for q in used if math.isnan(r[q])]
        if not bad: break
        for q in bad:
            g = [r[m] for m in nb[q] if not math.isnan(r[m])]
            if g: r[q] = float(np.mean(g))
    mq = lambda q: ((NT - q[0]) % NT, q[1]); mp = lambda p: p - 2 * ((p - C) @ LF) * LF  # mirror grid point; mirror position
    for q in used:
        if mq(q) in r: r[q] = r[mq(q)] = max(r[q], r[mq(q)])
    yoke = lambda q: VP[q] > min(h['vt'] for h in holes) - 0.06 and abs(math.sin(TH[q])) > 0.5
    def chord_fill(r):
        P = {q: C + D[q] * r[q] for q in used}; out = dict(r)
        for q in used:
            i, j = q; best = r[q]
            # round the body only over the shoulders (a strap lies along the slope from the neck, it does not bridge it)
            for a, b in [(((i - k) % NT, j), ((i + k) % NT, j)) for k in (1, 2, 3)] + ([] if yoke(q) else [((i, j - k), (i, j + k)) for k in (1, 2)]):
                if a in P and b in P:
                    t, dd = ray_seg(C, D[q], P[a], P[b])
                    if dd < 0.012 and t > best: best = t
            out[q] = best
        return out
    r = chord_fill(chord_fill(r)); P = {q: C + D[q] * (r[q] + 0.010) for q in used}
    for q in used:
        if q[1] == 0: P[q][1] = hemy(TH[q])  # the hem on its curve
    vtop = min(h['vt'] for h in holes)
    gapq = {q: TU['ygap'] if VP[q] > vtop - 0.04 and abs(math.sin(TH[q])) > 0.5 else GAP for q in used}
    def push(P):
        # out along the direction away from the nearest torso point until GAP clear (keeps the hem at its height)
        out = dict(P)
        for q in used:
            l, n_, i_, dd = bvh_t.find_nearest(Vector(P[q]), 0.2)
            if l is None: continue
            l, n_ = np.array(l), np.array(n_); sd = dd if (P[q] - l) @ n_ >= 0 else -dd
            g = (P[q] - l) / dd if sd > 1e-4 else n_
            if q[1] == 0: g = np.array([g[0], 0.0, g[2]]) / max(math.hypot(g[0], g[2]), 1e-6)  # the hem keeps its height
            if sd < gapq[q]: out[q] = P[q] + g * (gapq[q] - sd)
        return out
    def lap(P):
        out = {}
        for q in used:
            m = [x for x in nb[q] if x[1] == q[1]] if q[1] in (0, NV - 1) else nb[q]
            out[q] = P[q] + 0.4 * (np.mean([P[x] for x in m], 0) - P[q]) if m else P[q]
        return out
    for _ in range(6): P = lap(push(P))
    P = {q: (P[q] + mp(P[mq(q)])) / 2 if mq(q) in P else P[q] for q in used}
    for _ in range(4): P = push(P)
    I = P
    def normal(q):
        g = lambda m: I[m] if m in us else I[q]
        i, j = q; a = g(((i + 1) % NT, j)) - g(((i - 1) % NT, j)); b = g((i, j + 1)) - g((i, j - 1)); n_ = np.cross(a, b)
        n_ = n_ if n_ @ D[q] > 0 else -n_; return n_ / np.linalg.norm(n_)
    Nn = {q: normal(q) for q in used}
    for _ in range(3):  # averaged with the grid neighbours: edge vertices (one-sided differences) otherwise zigzag the outer face
        Nn = {q: (lambda v_: v_ / np.linalg.norm(v_))(2 * Nn[q] + sum((Nn[m] for m in nb[q]), np.zeros(3))) for q in used}
    sw = lambda th: smooth((abs(math.sin(th)) - 0.70) / 0.25)
    groove = lambda th: (0.5 + 0.5 * math.cos(TAU * (((th % TAU) / DT / 4.0) % 1.0))) ** 4
    ec_ = {}
    for (i, j) in ks:
        c = [(i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)]
        for k in range(4): ec_.setdefault(frozenset((c[k], c[(k + 1) % 4])), []).append((i, j))
    bd = {q: 0 for e, cs in ec_.items() if len(cs) == 1 for q in e}; fr_ = list(bd)
    for k in (1, 2):  # grid steps from the outline: the foam thins towards its edges
        nx_ = []
        for q in fr_:
            for m in nb[q]:
                if m not in bd: bd[m] = k; nx_.append(m)
        fr_ = nx_
    thick = {q: (TF + (TS - TF) * sw(TH[q])) * (0.6, 0.86, 1.0)[min(bd.get(q, 2), 2)] for q in used}
    dep = {q: GD * (1 - sw(TH[q])) * groove(TH[q]) + ZD * max(0.0, 1 - abs(wrap(TH[q])) / (DT * 0.9)) for q in used}
    for q in used:
        if q[1] in (0, NV - 1) or q in snapped: dep[q] *= 0.25  # channel seams stop short of the bound edges: an even outline
    O = {q: I[q] + Nn[q] * (thick[q] - dep[q]) for q in used}; E = {q: I[q] + Nn[q] * thick[q] for q in used}
    ecount = {}
    for (i, j) in ks:
        c = [(i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)]
        for k in range(4): ecount.setdefault(frozenset((c[k], c[(k + 1) % 4])), []).append((i, j))
    bedges = [tuple(e) for e, cs in ecount.items() if len(cs) == 1]; bverts = {q for e in bedges for q in e}
    # the binding: a half round from the inner face to the outer, bulging RB out across the outline (normal to it, smoothed along it)
    mid = {q: (I[q] + O[q]) / 2 for q in used}; badj, ex = {}, {}
    for a, b in bedges: badj.setdefault(a, []).append(b); badj.setdefault(b, []).append(a)
    for q in bverts:
        inn = np.mean([mid[m] for m in nb[q] if m not in bverts] or [mid[m] for m in nb[q]], 0)
        e = np.cross(mid[badj[q][1]] - mid[badj[q][0]], Nn[q]) if len(badj.get(q, [])) == 2 else mid[q] - inn
        e = e if e @ (mid[q] - inn) >= 0 else -e; e = e - Nn[q] * (e @ Nn[q]); ex[q] = e / max(np.linalg.norm(e), 1e-9)
    for _ in range(2):
        ex = {q: (lambda v_: v_ / max(np.linalg.norm(v_), 1e-9))(2 * ex[q] + sum((ex[m] for m in badj.get(q, [])), np.zeros(3))) for q in bverts}
    RIM = {q: [mid[q] - Nn[q] * (math.cos(a) * ((O[q] - I[q]) @ Nn[q]) / 2) + ex[q] * (RB * math.sin(a)) for a in np.radians([30, 60, 90, 120, 150])] for q in bverts}
    # ---- the shell: inner and outer faces of the kept cells, edges bound round in strap black
    bm = bmesh.new(); vi = {q: bm.verts.new(Vector(I[q])) for q in used}; vo = {q: bm.verts.new(Vector(O[q])) for q in used}
    vr = {q: [bm.verts.new(Vector(p)) for p in RIM[q]] for q in bverts}; shell = []
    for (i, j) in ks:
        c = [(i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)]
        for vv in (vi, vo):
            try: f = bm.faces.new([vv[m] for m in c]); f.material_index = SHELL; shell.append(f)
            except ValueError: pass
    for a, b in bedges:
        ca, cb = [vi[a]] + vr[a] + [vo[a]], [vi[b]] + vr[b] + [vo[b]]
        for k in range(len(ca) - 1):
            try: f = bm.faces.new([ca[k], cb[k], cb[k + 1], ca[k + 1]]); f.material_index = STRAPM; shell.append(f)
            except ValueError: pass
    bmesh.ops.recalc_face_normals(bm, faces=shell)
    okf = [[q for q in c] for c in ([(i, j), ((i + 1) % NT, j), ((i + 1) % NT, j + 1), (i, j + 1)] for (i, j) in ks)]
    oidx = {q: k for k, q in enumerate(used)}
    bvh_out = BVHTree.FromPolygons([Vector(O[q]) for q in used], [[oidx[q] for q in c] for c in okf])
    bvh_env = BVHTree.FromPolygons([Vector(E[q]) for q in used], [[oidx[q] for q in c] for c in okf])
    bvh_in = BVHTree.FromPolygons([Vector(I[q]) for q in used], [[oidx[q] for q in c] for c in okf])
    def cast(bvh, o, d):
        l, n_, i_, t = bvh.ray_cast(Vector(o), Vector(d))
        if l is None: return None
        n_ = np.array(n_); return np.array(l), (n_ if n_ @ d > 0 else -n_)
    def unkink(run):
        # a band ends where its path turns by more than 35 degrees in one step (a ray grazing an edge)
        pts = [p for p, n_ in run]; lo, hi, m = 0, len(run), len(run) // 2
        bend = lambda k: (lambda u, w: u @ w / (np.linalg.norm(u) * np.linalg.norm(w) + 1e-12))(pts[k] - pts[k - 1], pts[k + 1] - pts[k]) < math.cos(math.radians(35))
        for k in range(max(m, 1), len(run) - 1):
            if bend(k): hi = k + 1; break
        for k in range(min(m, len(run) - 2), 0, -1):
            if bend(k): lo = k; break
        return run[lo:hi]
    def runs(samples, kink=True):
        # unbroken runs of hits; a run loses its sample next to a miss, so a band stops short of an edge
        out, cur, after_miss = [], [], False
        for k, s_ in enumerate(samples + ['end']):
            if s_ is None or s_ == 'end':
                if after_miss: cur = cur[1:]
                if s_ is None: cur = cur[:-1]
                cur = unkink(cur) if kink and len(cur) > 2 else cur
                if len(cur) > 2: out.append(cur)
                cur, after_miss = [], s_ is None
            else: cur.append(s_)
        return out
    hpath = lambda bvh, h, t0, t1, st: runs([cast(bvh, np.array([C[0], h, C[2]]), hd(th)) for th in np.arange(t0, t1 + 1e-6, st) + 0.0015], bvh is bvh_env)  # webbing only: tape follows the channels
    ppath = lambda bvh, t0, t1, st, v: runs([cast(bvh, C, dr(th, phi(th, v))) for th in np.arange(t0, t1 + 1e-6, st) + 0.0015], False)  # over the shoulder: bends
    parts = {}
    def band(rs, prof, mi, key):
        for run in sorted(rs, key=len)[-1:]:
            ns_ = [n_ for p, n_ in run]; ns_ = [ns_[1]] + ns_[1:-1] + [ns_[-2]]  # the end rings take their neighbour's normal (no twisted ends)
            ns_ = [(ns_[max(k - 1, 0)] + 2 * ns_[k] + ns_[min(k + 1, len(ns_) - 1)]) / 4 for k in range(len(ns_))]
            sweep(bm, [p for p, n_ in run], ns_, prof, mi); parts[key] = parts.get(key, 0) + 1
    # ---- webbing: three front straps with side-release buckles on the zip line, a side strap under each arm
    yz = yV0; fy = lambda f: y_hem + (yz - y_hem) * f
    for f_ in (0.16, 0.45, 0.74):
        h = fy(f_); band(hpath(bvh_env, h, -math.radians(72), math.radians(72), DT), PROF_WEB(0.025, 0.0006, 0.0048), STRAPM, 'front straps')
        c0 = cast(bvh_env, np.array([C[0], h, C[2]]), hd(0.0))
        if c0:
            P0, N0 = c0; T0 = LF - N0 * (LF @ N0); T0 /= np.linalg.norm(T0); B0 = np.cross(N0, T0)
            # side-release buckle: the female housing, its two squeeze latches, the male body, its webbing bar past a slot
            box(bm, P0 + T0 * 0.017 + N0 * 0.0085, T0, B0, N0, (0.034, 0.030, 0.012), BUCKLE, bev=0.0028, seg=2)
            for sg in (-1, 1): box(bm, P0 + T0 * 0.021 + B0 * (sg * 0.0158) + N0 * 0.0085, T0, B0, N0, (0.014, 0.0045, 0.009), BUCKLE, bev=0.0012, seg=2)
            box(bm, P0 - T0 * 0.011 + N0 * 0.0075, T0, B0, N0, (0.022, 0.027, 0.009), BUCKLE, bev=0.0024, seg=2)
            box(bm, P0 - T0 * 0.0285 + N0 * 0.0068, T0, B0, N0, (0.0055, 0.031, 0.0075), BUCKLE, bev=0.0018, seg=2)
    ys = y_hem + 0.5 * (y_ap - 0.035 - y_hem)
    for h in holes:
        band(hpath(bvh_env, ys, h['tc'] - math.radians(26), h['tc'] + math.radians(26), DT / 2), PROF_WEB(0.025, 0.0006, 0.0048), STRAPM, 'side straps')
        c0 = cast(bvh_env, np.array([C[0], ys, C[2]]), hd(h['tc']))
        if c0:
            P0, N0 = c0; T0 = np.cross(UP, N0); T0 /= np.linalg.norm(T0); B0 = np.cross(N0, T0)
            box(bm, P0 + N0 * 0.0062, T0, B0, N0, (0.022, 0.033, 0.0065), BUCKLE, bev=0.002, seg=2)  # ladder-lock adjuster, two bars
            for sg in (-1, 1): box(bm, P0 + T0 * (sg * 0.0075) + N0 * 0.0098, T0, B0, N0, (0.004, 0.031, 0.0025), BUCKLE, bev=0.0008)
    # ---- retroreflective tape: two bands on the front and the back, one over each shoulder strap
    for f_ in (0.305, 0.60):
        h = fy(f_)
        for t0, t1 in ((math.radians(8), math.radians(58)), (-math.radians(58), -math.radians(8))):
            band(hpath(bvh_out, h, t0, t1, DT / 2), PROF_TAPE(0.025), REFL, 'tape')
        band(hpath(bvh_out, h, math.radians(118), math.radians(242), DT / 2), PROF_TAPE(0.025), REFL, 'tape')
    for h in holes:
        band(ppath(bvh_out, h['tc'] - math.radians(30), h['tc'] + math.radians(30), DT / 2, (h['vt'] + 1) / 2), PROF_TAPE(0.022), REFL, 'tape')
    # ---- zip down the front channel, slider and pull at the top
    zc = [q for q in used if q[0] == 0]; zc.sort(key=lambda q: q[1])
    zprof = [(-0.008, -0.002), (0.008, -0.002), (0.008, 0.0006), (0.003, 0.0006), (0.003, 0.0028), (-0.003, 0.0028), (-0.003, 0.0006), (-0.008, 0.0006)]
    sweep(bm, [O[q] for q in zc], [Nn[q] for q in zc], zprof, ZIP)
    qt, qd = zc[-2], zc[-4]; down = O[qd] - O[qt]; down /= np.linalg.norm(down); Nz = Nn[qt]; Tz = np.cross(Nz, down)
    box(bm, O[qt] + down * 0.01 + Nz * 0.0045, Tz, down, Nz, (0.013, 0.02, 0.007), ZIP, bev=0.0022, seg=2)
    box(bm, O[qt] + down * 0.032 + Nz * 0.0062, Tz, down, Nz, (0.010, 0.028, 0.0028), ZIP, bev=0.0011, seg=2)
    # ---- padded collar round the back of the neck, a webbing grab loop under it
    cps, cns = [], []
    for th in np.arange(math.radians(118), math.radians(242) + 1e-6, DT):
        a, b, c = cast(bvh_in, C, dr(th, phi(th, 0.97))), cast(bvh_out, C, dr(th, phi(th, 0.97))), cast(bvh_out, C, dr(th, phi(th, 0.88)))
        if a and b and c:
            m = (a[0] + b[0]) / 2; e = m - (c[0] + a[0]) / 2; e -= b[1] * (e @ b[1]); e /= np.linalg.norm(e)
            cps.append(m + e * 0.012 + UP * 0.004); cns.append(b[1])
    nc_ = len(cps); tp = [0.35 + 0.65 * math.sin(math.pi * k / (nc_ - 1)) ** 0.6 for k in range(nc_)]
    sweep(bm, cps, cns, [(0.019 * math.cos(t), 0.014 * math.sin(t)) for t in np.linspace(0, TAU, 8, endpoint=False)], SHELL, taper=tp)
    # grab loop: webbing arched 2.6 cm off the back under the collar, its ends flat on the foam under bar-tacked patches
    ga = cast(bvh_out, C, dr(math.pi, phi(math.pi, 0.95))); gb = None
    for v in np.linspace(0.9, 0.4, 26):  # the lower end 7 cm down the back from the upper one
        gb = cast(bvh_out, C, dr(math.pi, phi(math.pi, v)))
        if ga is None or gb is None or np.linalg.norm(gb[0] - ga[0]) >= 0.07: break
    if ga and gb:
        pa, na = ga; pb_, nb_ = gb; nm_ = (na + nb_) / 2; nm_ /= np.linalg.norm(nm_); lat = np.cross(pb_ - pa, nm_); lat /= np.linalg.norm(lat)
        lp = [pa + nm_ * 0.0015 - (pb_ - pa) * 0.12] + [pa + (pb_ - pa) * (0.5 - 0.5 * math.cos(s_)) + nm_ * (0.0015 + 0.026 * math.sin(s_)) for s_ in np.linspace(0, math.pi, 13)] + [pb_ + nm_ * 0.0015 + (pb_ - pa) * 0.12]
        tg = [lp[min(k + 1, len(lp) - 1)] - lp[max(k - 1, 0)] for k in range(len(lp))]
        sweep(bm, lp, [np.cross(t_, lat) for t_ in tg], PROF_WEB(0.024, -0.0013, 0.0013), STRAPM)
        for e_, p_ in ((-1, pa), (1, pb_)): box(bm, p_ + (pb_ - pa) * (0.07 * e_) + nm_ * 0.0022, lat, pb_ - pa, nm_, (0.028, 0.012, 0.0032), STRAPM, bev=0.001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    # ---- checks (model space)
    sv = {v: k for k, v in enumerate({v for f in shell for v in f.verts})}
    bvh_shell = BVHTree.FromPolygons([v.co.copy() for v in sorted(sv, key=sv.get)], [[sv[v] for v in f.verts] for f in shell])
    bvh_vest = BVHTree.FromBMesh(bm)
    def inside(P):
        cnt, dmax, at = 0, 0.0, []
        for p in P:
            l, n_, i_, dd = bvh_shell.find_nearest(Vector(p), 0.06)
            if l is not None and (Vector(p) - l).dot(n_) < 0:
                cnt += 1; dmax = max(dmax, dd); d_ = p - C
                at.append((round(math.degrees(math.atan2(d_ @ LF, d_ @ FW))), round(float(d_[1]), 3), round(dd, 3)))
        return cnt, round(dmax, 4), at[::max(1, len(at) // 5)][:5]
    gaps = np.array([bvh_t.find_nearest(Vector(I[q]), 0.3)[3] or 0.3 for q in used])
    log(tag, 'shell: vertices', len(used), 'cells', len(ks), 'ray misses filled', miss, 'inner gap to torso p5/p50/p95/max',
        np.percentile(gaps, [5, 50, 95, 100]).round(4), 'triangles', tris, 'parts', parts, 'hem y', [round(min(I[q][1] for q in used if q[1] == 0), 3), round(max(I[q][1] for q in used if q[1] == 0), 3)],
        'neckline y', [round(min(I[q][1] for q in used if q[1] == NV - 1), 3), round(max(I[q][1] for q in used if q[1] == NV - 1), 3)])
    log(tag, 'rest: torso verts inside vest', inside(V[(AW < 0.5) & fitv]), 'left-out neck and hair verts inside', inside(V[(AW < 0.5) & okv & ~fitv])[:2], 'arm verts inside', inside(V[(AW >= 0.5) & okv]))
    ins_ = [k for k in np.where((AW < 0.5) & ~fitv)[0] if (lambda l: l[0] is not None and (Vector(V[k]) - l[0]).dot(l[1]) < 0)(bvh_shell.find_nearest(Vector(V[k]), 0.06))]
    log(tag, 'left-out verts inside the shell: count', len(ins_), '(body prim, y - neck y, rho - neck radius, azimuth deg)', [(bool(isb[k]), round(float(V[k, 1] - NK[1]), 3), round(rho(V[k]) - RN, 3), round(math.degrees(math.atan2((V[k] - C) @ LF, (V[k] - C) @ FW)))) for k in ins_[::max(1, len(ins_) // 8)]])
    foot = hit(LCL + LF * 0.135 + UP * 0.3, -UP)
    if foot is not None:
        l, n_, i_, dd = bvh_vest.find_nearest(Vector(foot), 1.0); vp = np.array(l)
        log(tag, 'perch point (left shoulder, clavicle + 13.5 cm)', foot.round(3), 'nearest vest point', vp.round(3), 'distance', round(dd, 4),
            'lateral gap', round(float(abs(foot[0] - C[0]) - abs(vp[0] - C[0])), 4), 'vest above the perch skin', round(float(vp[1] - foot[1]), 4))
    J = rig.jw(W, BONE); info = dict(bm=bm, J=J, tris=tris, C=C, FW=FW, LF=LF, UP=UP, inside=inside, bvh_vest=bvh_vest, V=V, F=Fc, AW=AW, okv=okv, fitv=fitv, NK=NK, shell=bvh_shell)
    return info

def seat_checks(rig, tag, fitd, clips, src=None):
    S2r = rig.jw(rig.W0, BONE); res = {}
    for anim, frac in clips:
        try: Wp = rig.pose(anim, frac, src)
        except StopIteration: continue
        V, F, AW, HW = body_arrays(rig, Wp); M = S2r @ np.linalg.inv(rig.jw(Wp, BONE)); Vq = V @ M[:3, :3].T + M[:3, 3]
        res[(anim, frac)] = Vq; log(tag, 'pose', anim, frac, 'arm verts inside vest (count, max depth m)', fitd['inside'](Vq[(AW >= 0.5) & (HW < 0.5)]))
        hv = Vq[(AW < 0.5) & ~fitd['fitv'] & (Vq[:, 1] < fitd['NK'][1] + 0.08)]
        if anim == 'ski_sit' and len(hv):
            log(tag, 'pose', anim, frac, 'left-out head, hair and neck verts inside vest', fitd['inside'](hv)[:2], 'nearest vest distance', round(min((fitd['bvh_vest'].find_nearest(Vector(p), 0.3)[3] or 0.3) for p in hv), 4))
    return res

# ------------------------------------------------------------------ build, export, verify
mats = []
for nm, col, rough in (('PFD_Shell', (0.679, 1.0, 0.0137), 0.55), ('PFD_Strap', (0.016, 0.016, 0.018), 0.8), ('PFD_Buckle', (0.028, 0.028, 0.03), 0.4),
                       ('PFD_Zip', (0.01, 0.01, 0.011), 0.45), ('PFD_Reflective', (0.5, 0.52, 0.54), 0.3)):
    m = bpy.data.materials.new(nm)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = 0.0; m.diffuse_color = (*col, 1); mats.append(m)
rigs, fits, objs = {}, {}, []
for name, rel in WEARERS:
    rig = rigs[name] = Rig(ROOT + '/' + rel); fd = fits[name] = fit(rig, name); J = fd['J']; Ji = np.linalg.inv(J)
    bm = fd['bm']
    for v in bm.verts: v.co = Vector(CM @ (Ji[:3, :3] @ np.array(v.co) + Ji[:3, 3]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(48))
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.matrix_world = Matrix((CM4 @ J @ CM4.T).tolist())
    loc, rot, sc = Matrix(J.tolist()).decompose()
    k = rig.ji[BONE]; ob['bone'] = BONE; ob['joint'] = k; ob['jointNode'] = rig.joints[k]; ob['wearer'] = rel
    ob['restPos'] = [round(x, 6) for x in loc]; ob['restQuat'] = [round(x, 7) for x in (rot.x, rot.y, rot.z, rot.w)]; ob['restScale'] = [round(x, 7) for x in sc]
    log(name, 'chest joint', BONE, 'skin joint index', k, 'node index', rig.joints[k], 'max |J @ IBM - I|', float(np.abs(J @ rig.ibm[k] - np.eye(4)).max()),
        'restPos', list(ob['restPos']), 'restQuat', list(ob['restQuat']), 'restScale', list(ob['restScale']))
    objs.append(ob)
for o in bpy.context.scene.objects: o.select_set(o in objs)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, use_selection=True, export_apply=True, export_extras=True,
                          export_cameras=False, export_lights=False, export_animations=False, export_skins=False)
log('EXPORTED', OUT, os.path.getsize(OUT))
chk = Rig.__new__(Rig); b_ = open(OUT, 'rb').read(); n_ = struct.unpack('<I', b_[12:16])[0]; chk.J = json.loads(b_[20:20 + n_])
for i in chk.J['scenes'][0]['nodes']:
    nd = chk.J['nodes'][i]; m_ = chk.J['meshes'][nd['mesh']]; J = rigs[nd['name']].jw(rigs[nd['name']].W0, BONE)
    Mx = mat_trs(nd.get('translation', [0, 0, 0]), nd.get('rotation', [0, 0, 0, 1]), nd.get('scale', [1, 1, 1]))
    log('glb node', i, nd['name'], 'max |node matrix - joint rest world|', float(np.abs(Mx - J).max()), 'triangles',
        sum(chk.J['accessors'][p['indices']]['count'] // 3 for p in m_['primitives']), 'materials', [chk.J['materials'][p['material']]['name'] for p in m_['primitives']],
        'extras', sorted(nd.get('extras', {}).keys()))
alt = Rig(ROOT + '/public/models/characters/crowd/f03.glb')
log('crowd/f03.glb', BONE, 'joint', alt.ji[BONE], 'node', alt.joints[alt.ji[BONE]], 'max |J - swim J|', float(np.abs(alt.jw(alt.W0, BONE) - rigs['pfd_mate'].jw(rigs['pfd_mate'].W0, BONE)).max()))
pr, pm = rigs['pfd_rider'], rigs['pfd_mate']
SKI = [(a, f) for a in ('ski_sit', 'ski_lean_l', 'ski_lean_r', 'ski_tuck', 'ski_stand') for f in (0.0, 0.5)]
seat_r = seat_checks(pr, 'pfd_rider', fits['pfd_rider'], SKI + [('tread', 0.0), ('swim', 0.0), ('swim', 0.5)])
seat_m = seat_checks(pm, 'pfd_mate', fits['pfd_mate'], SKI, src=pr)
seat_m.update(seat_checks(pm, 'pfd_mate', fits['pfd_mate'], [('sit_chair_idle_neutral_01', 0.0)]))
hat = next(p_ for p_ in pr.prims if p_['name'] == 'hat'); S2r = pr.jw(pr.W0, BONE)
Hr = pr.skin(pr.W0, hat); log('pfd_rider hat on head: verts inside vest', fits['pfd_rider']['inside'](Hr), 'nearest vest distance',
                              round(min(fits['pfd_rider']['bvh_vest'].find_nearest(Vector(p), 2.0)[3] for p in Hr[::7]), 4))
best = (-1, None)
for a_, f_ in (('tread', 0.0), ('tread', 0.5), ('swim', 0.0), ('swim', 0.5), ('swim_under', 0.0), ('getup_back', 0.0)):
    try: W_ = pr.pose(a_, f_)
    except StopIteration: continue
    D_ = S2r @ np.linalg.inv(pr.jw(W_, BONE)) @ pr.jw(W_, 'Hat') @ np.linalg.inv(pr.jw(pr.W0, 'Hat')); c0 = Hr.mean(0); mv = float(np.linalg.norm(D_[:3, :3] @ c0 + D_[:3, 3] - c0))
    log('pfd_rider hat moved off its rest place (relative to the chest joint) in', a_, f_, round(mv, 3))
    if mv > best[0]: best = (mv, (a_, f_))
Wt = pr.pose(*best[1]); log('hat check pose', best[1]); Mt = S2r @ np.linalg.inv(pr.jw(Wt, BONE)); Ht = pr.skin(Wt, hat) @ Mt[:3, :3].T + Mt[:3, 3]
log('pfd_rider hat down the back (tread): verts inside vest', fits['pfd_rider']['inside'](Ht), 'nearest vest distance',
    round(min(fits['pfd_rider']['bvh_vest'].find_nearest(Vector(p), 2.0)[3] for p in Ht[::7]), 4))
HAT_D = S2r @ np.linalg.inv(pr.jw(Wt, BONE)) @ pr.jw(Wt, 'Hat') @ np.linalg.inv(pr.jw(pr.W0, 'Hat'))
# the in-game hat down the back (extras.hat.back on the rest hat, no sway) and the chin cord (its rest place, as in the water)
hx_ = next(s_['extras']['hat'] for s_ in pr.J['scenes'] if 'hat' in s_.get('extras', {})); BK = np.array(hx_['back'], float).reshape(4, 4).T
wc_ = (hat['W'] * (hat['J'] == pr.ji['HatCord'])).sum(1); frd = fits['pfd_rider']
def sdist(P):
    out = []
    for p in P:
        l, n_, i_, dd = frd['bvh_vest'].find_nearest(Vector(p), 0.5); l2, n2, i2, d2 = frd['shell'].find_nearest(Vector(p), 0.5)
        if l is None: continue
        out.append(-d2 if (l2 is not None and (Vector(p) - l2).dot(n2) < 0) else dd)
    return np.array(out)
Hb = (np.c_[Hr[wc_ < 0.5], np.ones(int((wc_ < 0.5).sum()))] @ BK.T)[:, :3]; Hc = Hr[wc_ >= 0.5]
nbk = np.linalg.inv(S2r)[:3, :3] @ -frd['FW']; nbk /= np.linalg.norm(nbk)
for nm_, P_ in (('hat down the back (extras.hat.back, no sway)', Hb), ('chin cord (HatCord verts at rest)', Hc)):
    d_ = sdist(P_); log('pfd_rider', nm_, 'verts', len(P_), 'signed distance to the vest cm (negative: inside the foam) min/p5/median', (np.percentile(d_, [0, 5, 50]) * 100).round(2) if len(d_) else None, 'inside', int((d_ < 0).sum()))
log('pfd_rider back outward normal: model rest space', (-frd['FW']).round(4), 'Spine2 joint frame', nbk.round(4))

# ------------------------------------------------------------------ renders (optional)
if RENDER:
    os.makedirs(RENDER, exist_ok=True); sc = bpy.context.scene
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=OUT); vest = {o.name: o for o in bpy.data.objects if o.name in ('pfd_rider', 'pfd_mate')}
    groups = {}
    for name, rel in WEARERS:
        before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=ROOT + '/' + rel); new = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in new if o.type == 'ARMATURE'); v = vest[name]; mw = v.matrix_world.copy()
        for o in new:
            if o.animation_data: o.animation_data_clear()
        for pb_ in arm.pose.bones: pb_.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        v.parent = arm; v.parent_type = 'BONE'; v.parent_bone = BONE; v.matrix_world = mw; bpy.context.view_layer.update()
        rig = rigs[name]; allv = np.concatenate([rig.skin(rig.W0, p_) for p_ in rig.prims]); dg = bpy.context.evaluated_depsgraph_get(); bv = []
        for o in new:
            if o.type == 'MESH' and not o.name.startswith('Ico'):
                ev = o.evaluated_get(dg); me = ev.to_mesh(); bv += [CM.T @ np.array(o.matrix_world @ x.co) for x in me.vertices]; ev.to_mesh_clear()
        bv = np.array(bv); pb = arm.pose.bones[BONE]; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0.4, 0.2, 0.1); bpy.context.view_layer.update()
        Dm = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ arm.matrix_world.inverted()
        err = max(abs(a - b) for ra, rb in zip(v.matrix_world, Dm @ mw) for a, b in zip(ra, rb))
        pb.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
        log(name, 'Blender import: body bbox min/max', bv.min(0).round(3), bv.max(0).round(3), 'numpy rest skin', allv.min(0).round(3), allv.max(0).round(3),
            'vest keeps its place on bone parenting', max(abs(a - b) for ra, rb in zip(v.matrix_world, mw) for a, b in zip(ra, rb)) < 1e-5, 'follows a posed chest bone, max err', round(err, 6))
        groups[name] = dict(objs=new + [v], arm=arm)
    rig_arm = groups['pfd_rider']['arm']
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=ROOT + '/public/models/cockatoo.glb'); bird = [o for o in bpy.data.objects if o not in before]
    fr = fits['pfd_rider']; dg = bpy.context.evaluated_depsgraph_get(); bpts = []
    for o in bird:
        if o.type == 'MESH' and o.name.startswith('Ico'): o.hide_render = True
        if o.type == 'MESH' and not o.name.startswith('Ico'):
            ev = o.evaluated_get(dg); me = ev.to_mesh(); bpts += [np.array(o.matrix_world @ x.co) for x in me.vertices]; ev.to_mesh_clear()
    for o in bird:
        if o.animation_data: o.animation_data_clear()
    bpts = np.array(bpts); cx_ = (bpts.max(0) + bpts.min(0)) / 2; cen = bpts[(np.abs(bpts[:, 0] - cx_[0]) < 0.03) & (np.abs(bpts[:, 1] - cx_[1]) < 0.05)]
    low = cen[cen[:, 2] < cen[:, 2].min() + 0.012].mean(0)  # the feet: lowest points under the middle of the body (the tail hangs lower)
    Vr = fr['V']; LCL = pr.jw(pr.W0, 'Bip01 L Clavicle')[:3, 3]
    l_, n_, i_, t_ = BVHTree.FromPolygons([Vector(x) for x in Vr], fr['F'].tolist(), all_triangles=True).ray_cast(Vector(LCL + fr['LF'] * 0.135 + fr['UP'] * 0.3), Vector(-fr['UP']))
    foot = CM @ np.array(l_); Fb = CM @ fr['FW']; ang = math.atan2(Fb[1], Fb[0]) - math.atan2(-1, 0)
    emp = bpy.data.objects.new('bird', None); bpy.context.collection.objects.link(emp)
    for o in bird:
        if o.parent is None: o.parent = emp
    emp.matrix_world = Matrix.Translation(Vector(foot)) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Scale(1.3, 4) @ Matrix.Translation(Vector(-low))
    groups['pfd_rider']['objs'] += bird + [emp]; bpy.context.view_layer.update()
    log('bird: feet (Blender)', np.round(foot, 3), 'model lowest point', np.round(low, 3), 'extent', np.round(bpts.max(0) - bpts.min(0), 3), 'objects', [o.name for o in bird][:6])
    clay = bpy.data.materials.new('clay'); clay.diffuse_color = (0.55, 0.5, 0.46, 1)
    try: clay.use_nodes = True
    except Exception: pass
    clay.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.55, 0.5, 0.46, 1)
    def claymesh(nm, Vq, F):
        me = bpy.data.meshes.new(nm); me.from_pydata([tuple(CM @ x) for x in Vq], [], F.tolist()); me.materials.append(clay); me.shade_smooth()
        o = bpy.data.objects.new(nm, me); bpy.context.collection.objects.link(o); return o
    Fr_ = body_arrays(pr, pr.W0)[1]; Fm_ = body_arrays(pm, pm.W0)[1]
    clays = {'rider_sit': claymesh('rider_sit', seat_r[('ski_sit', 0.0)], Fr_), 'rider_tuck': claymesh('rider_tuck', seat_r[('ski_tuck', 0.0)], Fr_),
             'mate_sit': claymesh('mate_sit', seat_m[('ski_sit', 0.0)], Fm_)}
    try: sc.render.engine = 'BLENDER_EEVEE'
    except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 560, 700; sc.view_settings.view_transform = 'Standard'
    try: sc.eevee.taa_render_samples = 24
    except Exception: pass
    wd = bpy.data.worlds.new('w'); sc.world = wd
    try: wd.use_nodes = True
    except Exception: pass
    if wd.node_tree: bg = wd.node_tree.nodes.get('Background'); bg.inputs[0].default_value = (0.5, 0.56, 0.62, 1); bg.inputs[1].default_value = 0.9
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
    for nm, e, d in (('key', 3.2, (0.5, -1.0, 0.8)), ('fill', 1.2, (-0.8, 0.9, 0.4))):
        L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'SUN')); L.data.energy = e; bpy.context.collection.objects.link(L)
        L.rotation_euler = Vector(d).to_track_quat('Z', 'Y').to_euler()
    everything = [o for o in bpy.data.objects if o.type in ('MESH', 'ARMATURE', 'EMPTY')]
    def show(objs):
        for o in everything: o.hide_render = o not in objs or o.name.startswith('Ico')
    def shoot(path, fd, dirv, zoff=0.12, scale=0.95, target=None):
        t = Vector(CM @ fd['C']) + Vector((0, 0, zoff)) if target is None else target; d = Vector(dirv).normalized()
        cam.location = t + d * 3.0; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); cam.data.ortho_scale = scale
        sc.render.filepath = path; bpy.ops.render.render(write_still=True); return path
    def sheet(paths, out, cols=2):
        ims = [bpy.data.images.load(p) for p in paths]; w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
        A = np.ones((rows * h, cols * w, 4), np.float32)
        for k, im in enumerate(ims):
            px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px); r_, c_ = divmod(k, cols)
            A[(rows - 1 - r_) * h:(rows - r_) * h, c_ * w:(c_ + 1) * w] = px.reshape(h, w, 4)
        img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True); img.pixels.foreach_set(A.ravel()); img.filepath_raw = out; img.file_format = 'PNG'; img.save()
        log('SHEET', out)
    for name, tag in (('pfd_rider', 'rider'), ('pfd_mate', 'mate')):
        fd = fits[name]; Fb, Lb = Vector(CM @ fd['FW']), Vector(CM @ fd['LF']); up = Vector((0, 0, 0.25)); show(groups[name]['objs'])
        ps = [shoot(f'{RENDER}/{tag}_{v}.png', fd, d) for v, d in (('front', Fb + up * 0.3), ('34', Fb + Lb + up), ('side', Lb + up * 0.3), ('back', -Fb + up * 0.3))]
        sheet(ps, f'{RENDER}/sheet_{tag}.png')
    fd = fits['pfd_rider']; Fb, Lb = Vector(CM @ fd['FW']), Vector(CM @ fd['LF']); up = Vector((0, 0, 0.25))
    pbh = rig_arm.pose.bones['Hat']; Db = Matrix((CM4 @ HAT_D @ CM4.T).tolist())
    pbh.matrix = rig_arm.matrix_world.inverted() @ Db @ rig_arm.matrix_world @ pbh.bone.matrix_local; bpy.context.view_layer.update()
    show(groups['pfd_rider']['objs']); ck = [shoot(f'{RENDER}/check_hat_back.png', fd, -Fb - Lb + up * 1.5)]
    ck.append(shoot(f'{RENDER}/check_hat_side.png', fd, -Lb + up * 0.2))
    show([vest['pfd_rider'], clays['rider_sit']]); ck.append(shoot(f'{RENDER}/check_rider_sit.png', fd, Fb + Lb + up))
    show([vest['pfd_rider'], clays['rider_tuck']]); ck.append(shoot(f'{RENDER}/check_rider_tuck.png', fd, Fb - Lb + up))
    fm = fits['pfd_mate']; show([vest['pfd_mate'], clays['mate_sit']]); ck.append(shoot(f'{RENDER}/check_mate_sit.png', fm, Vector(CM @ fm['FW']) + Vector(CM @ fm['LF']) + up))
    pbh.matrix_basis = Matrix.Identity(4); show(groups['pfd_rider']['objs'])
    ck.append(shoot(f'{RENDER}/check_bird_top.png', fd, Fb * 0.5 + Lb + up * 3.0, zoff=0.2, scale=0.6))
    ck.append(shoot(f'{RENDER}/check_loop_rider.png', fd, -Fb - Lb * 0.8 + up * 0.6, zoff=0.14, scale=0.45))
    fm = fits['pfd_mate']; Fm, Lm = Vector(CM @ fm['FW']), Vector(CM @ fm['LF']); show(groups['pfd_mate']['objs'])
    ck.append(shoot(f'{RENDER}/check_mate_back34.png', fm, -Fm + Lm * 0.8 + up * 0.6, zoff=0.12, scale=0.5))
    ck.append(shoot(f'{RENDER}/check_mate_shoulder.png', fm, Fm * 0.3 + Lm + up * 0.2, zoff=0.1, scale=0.5))
    sheet(ck, f'{RENDER}/sheet_checks.png', cols=3)
    sheet([f'{RENDER}/{t}_{v}.png' for t in ('rider', 'mate') for v in ('front', '34', 'back')], f'{RENDER}/sheet_final.png', cols=3)
