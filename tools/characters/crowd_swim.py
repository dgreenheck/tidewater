# Beach swimwear variants of the Rocketbox crowd (public/models/characters/crowd/<name>.glb).
# Nodes, skin, meshes, accessors and animations stay byte-identical: only the three body images
# (colour, normal, ORM) are repainted and the BIN chunk is repacked around them.
# Ordinary Aussie beachwear with modest cover (kids game). The clothed Rocketbox geometry decides what can be
# worn: collars, lapels, hoods, tunic skirts and trouser legs stay in the mesh, so each garment is recast as a
# real beach garment of the same shape (see outfit()): tee or polo -> rashie, shorts -> boardies, trouser legs
# -> swim leggings or boardies over surf leggings, camisole tunic -> swim dress, kameez -> burkini, cardigan ->
# kimono cover-up, hooded jacket -> towelling surf poncho, blazer -> open chambray beach shirt, shoes -> bare feet
# on thongs. Painting trouser legs as bare skin was tried and reads as fat skin-coloured tubes, so it is not used.
#
# How the regions are found: the body primitive is rasterised into texture space, so every texel knows its
# bind-pose 3D point and the bone group that drives it. Each UV island is one clothing piece, classed top /
# bottom / shoe by the bones it rides on (islands that reach the chest are tops). Cuts that are not island
# edges (boardie hems, sleeves) are made in 3D, so both sides of a UV seam get the same paint. Texels that are
# already skin (chromaticity close to the hands) are kept; painted skin (feet) comes from the avatar's own bare
# limbs, else from its hands and face. New paint is dilated 6 px into the gutters.
#
# From the repo root (Blender 4.2+, tested 5.0.1; it has numpy):
#   B=blender
#   $B -b --python tools/characters/crowd_swim.py -- build [f01 m04 ...]      # -> public/models/characters/crowd/swim/
#   $B -b --python tools/characters/crowd_swim.py -- dump [names]             # UV region maps -> $SWIM_LOG
#   $B -b --python tools/characters/crowd_swim.py -- sheet <out.png> <a.glb> [b.glb ...]   # idle frame 20, 3 views
import bpy, sys, os, json, struct, math
import numpy as np

try: ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
except NameError: ROOT = os.getcwd()
SRC = os.path.join(ROOT, 'public/models/characters/crowd')
DST = os.path.join(SRC, 'swim')
LOG = os.environ.get('SWIM_LOG', os.path.join(__import__('tempfile').gettempdir(), 'beach-swim'))
TMP = os.path.join(LOG, 'tmp')
NAMES = ['f01', 'f03', 'f06', 'f09', 'm01', 'm04', 'm07', 'm10']
os.makedirs(TMP, exist_ok=True)

# ---------------------------------------------------------------- GLB io
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    o = 20 + jl
    bl = struct.unpack('<I', b[o:o + 4])[0]
    return j, b[o + 8:o + 8 + bl]

def view_bytes(j, binb, i):
    v = j['bufferViews'][i]; o = v.get('byteOffset', 0)
    return binb[o:o + v['byteLength']]

def acc(j, binb, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    st = v.get('byteStride') or dt.itemsize * n
    if st == dt.itemsize * n: arr = np.frombuffer(binb, dt, a['count'] * n, off).reshape(-1, n)
    else: arr = np.stack([np.frombuffer(binb, dt, n, off + k * st) for k in range(a['count'])])
    arr = arr.astype(np.float64) if dt.kind == 'f' else arr.astype(np.int64)
    if a.get('normalized'): arr = arr / float(np.iinfo(dt).max)
    return arr

def write_glb(path, j, binb, repl):
    """Repack the BIN chunk: every bufferView keeps its bytes except those in repl {view: bytes}."""
    j = json.loads(json.dumps(j)); views = j['bufferViews']
    out = bytearray()
    for i in sorted(range(len(views)), key=lambda i: views[i].get('byteOffset', 0)):
        data = repl.get(i)
        if data is None:
            o = views[i].get('byteOffset', 0); data = binb[o:o + views[i]['byteLength']]
        out += b'\0' * ((-len(out)) % 4)
        views[i]['byteOffset'] = len(out); views[i]['byteLength'] = len(data)
        out += data
    out += b'\0' * ((-len(out)) % 4)
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
    return j

# ---------------------------------------------------------------- images through Blender
def load_px(data, tag):
    p = os.path.join(TMP, tag); open(p, 'wb').write(data)
    im = bpy.data.images.load(p); im.colorspace_settings.name = 'Non-Color'
    W, H = im.size; a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(H, W, 4)

def save_px(px, path, fmt='PNG'):
    H, W = px.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), W, H, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    a = np.ones((H, W, 4), np.float32); a[..., :min(4, px.shape[2])] = px[..., :4]
    im.pixels.foreach_set(np.clip(a, 0, 1).ravel()); im.filepath_raw = path; im.file_format = fmt
    im.save(quality=90) if fmt == 'JPEG' else im.save()
    bpy.data.images.remove(im)

def box(a, r):
    for ax in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(a.ndim)], mode='edge'), axis=ax)
        a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a

def blur(a, r):
    for _ in range(3): a = box(a, r)
    return a

def dilate(img, known, allow, n=6):
    img = img.copy(); known = known.copy()
    for _ in range(n):
        s = np.zeros_like(img); c = np.zeros(known.shape, np.float32)
        for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, d, (0, 1)); s += np.roll(img, d, (0, 1)) * k[..., None]; c += k
        new = (~known) & (c > 0) & allow
        img[new] = s[new] / c[new][:, None]; known |= new
    return img

# ---------------------------------------------------------------- body analysis
TORSO, PELVIS, NECK, HEAD, UPPER, FORE, HAND, THIGH, CALF, FOOT = range(10)
GCOL = np.array([(220, 60, 60), (240, 150, 40), (240, 230, 60), (240, 150, 200), (60, 200, 90), (60, 220, 230),
                 (50, 80, 230), (150, 70, 200), (140, 90, 50), (255, 255, 255)], np.float32) / 255

def norm(n): return ''.join(ch for ch in n.lower() if ch.isalnum())

def jgroup(n):
    s = norm(n)
    for keys, g in ((('finger', 'hand'), HAND), (('fore',), FORE), (('uparm', 'upperarm'), UPPER), (('clavicle',), TORSO),
                    (('toe', 'foot'), FOOT), (('calf',), CALF), (('thigh',), THIGH), (('pelvis',), PELVIS),
                    (('neck',), NECK), (('head',), HEAD)):
        if any(k in s for k in keys): return g
    return TORSO

def raster(uv, idx, attrs, W, H):
    X = uv[:, 0] * W - 0.5; Y = (1 - uv[:, 1]) * H - 0.5   # glTF v runs down, Blender rows run up
    cov = np.zeros((H, W), bool); out = np.zeros((H, W, attrs.shape[1]), np.float32)
    for a, b, c in idx:
        xs = X[[a, b, c]]; ys = Y[[a, b, c]]
        x0 = max(math.ceil(xs.min()), 0); x1 = min(math.floor(xs.max()), W - 1)
        y0 = max(math.ceil(ys.min()), 0); y1 = min(math.floor(ys.max()), H - 1)
        if x1 < x0 or y1 < y0: continue
        d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(d) < 1e-12: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
        l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
        l2 = 1 - l0 - l1
        m = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
        if not m.any(): continue
        out[gy[m], gx[m]] = l0[m, None] * attrs[a] + l1[m, None] * attrs[b] + l2[m, None] * attrs[c]
        cov[gy[m], gx[m]] = True
    return cov, out

class Body:
    def __init__(self, path):
        j, binb = self.j, self.bin = read_glb(path)
        mats = [m.get('name') for m in j['materials']]
        node = next(n for n in j['nodes'] if 'mesh' in n and 'skin' in n)
        mesh = j['meshes'][node['mesh']]; skin = j['skins'][node['skin']]
        self.names = names = [j['nodes'][k].get('name', '') for k in skin['joints']]
        ibm = acc(j, binb, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        jp = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
        allp = np.concatenate([acc(j, binb, p['attributes']['POSITION']) for p in mesh['primitives']])
        self.Hgt = allp[:, 1].max() - allp[:, 1].min(); u = self.u = self.Hgt / 1.75
        tex = {k: j['textures'][j['materials'][mats.index('body')][s1][s2]['index'] if s2 else j['materials'][mats.index('body')][s1]['index']]['source']
               for k, s1, s2 in (('color', 'pbrMetallicRoughness', 'baseColorTexture'), ('orm', 'pbrMetallicRoughness', 'metallicRoughnessTexture'), ('normal', 'normalTexture', None))}
        self.img_view = {k: j['images'][i]['bufferView'] for k, i in tex.items()}
        self.px = {k: load_px(view_bytes(j, binb, v), f'{os.path.basename(path)}_{k}.jpg') for k, v in self.img_view.items()}
        hi = j['materials'][mats.index('head')]['pbrMetallicRoughness']['baseColorTexture']['index']
        self.head_px = load_px(view_bytes(j, binb, j['images'][j['textures'][hi]['source']]['bufferView']), f'{os.path.basename(path)}_head.jpg')
        prim = next(p for p in mesh['primitives'] if p.get('material') == mats.index('body'))
        A = prim['attributes']
        pos = acc(j, binb, A['POSITION']); uv = acc(j, binb, A['TEXCOORD_0'])
        J = acc(j, binb, A['JOINTS_0']); Wt = acc(j, binb, A['WEIGHTS_0'])
        idx = acc(j, binb, prim['indices']).reshape(-1, 3)
        jg = np.array([jgroup(n) for n in names])
        gw = np.zeros((len(pos), 10))
        for k in range(4): np.add.at(gw, (np.arange(len(pos)), jg[J[:, k]]), Wt[:, k])
        H, W = self.px['color'].shape[:2]
        self.cov, out = raster(uv, idx, np.concatenate([pos, gw], 1), W, H)
        self.uvinfo = (uv.min(0), uv.max(0), len(idx), W, H)
        P = out[..., :3]; self.G = np.argmax(out[..., 3:], -1)
        # frame: forward from foot to toe, lateral across, heights from the joints
        def J1(sfx): return next((jp[i] for i, n in enumerate(names) if norm(n).endswith(sfx)), None)
        pel = J1('pelvis'); f = (J1('ltoe0') - J1('lfoot')) + (J1('rtoe0') - J1('rfoot')); f[1] = 0; f /= np.linalg.norm(f)
        L = np.cross([0, 1, 0], f); c0 = pel * [1, 0, 1]
        self.F, self.L, self.c0 = f, L, c0
        def lf(p): d = p - c0; return d @ L, d @ f
        self.y = P[..., 1]; self.lat, self.fwd = lf(P)
        K = {k: J1(k) for k in ('lthigh', 'rthigh', 'lcalf', 'rcalf', 'lfoot', 'rfoot', 'lupperarm', 'rupperarm', 'lforearm', 'rforearm', 'lhand', 'rhand', 'neck', 'head', 'pelvis')}
        self.K = K
        self.y_hip = (K['lthigh'][1] + K['rthigh'][1]) / 2; self.y_knee = (K['lcalf'][1] + K['rcalf'][1]) / 2
        self.y_sh = (K['lupperarm'][1] + K['rupperarm'][1]) / 2; self.y_neck = K['neck'][1]
        self.sh_lat = (abs(lf(K['lupperarm'])[0]) + abs(lf(K['rupperarm'])[0])) / 2
        c = self.cov
        m = c & (self.G == PELVIS) & (np.abs(self.lat) < 0.06 * u)
        self.y_crotch = np.percentile(self.y[m], 1) if m.sum() > 20 else self.y_hip - 0.08 * u
        fm = c & (self.G == FOOT); self.y_sole = np.percentile(self.y[fm], 0.5) if fm.any() else allp[:, 1].min()
        # arm parameter: 0 shoulder, 1 elbow, 2 wrist (side picked by lateral sign)
        side = np.sign(self.lat); self.side = side
        t = np.full(self.y.shape, -1.0)
        for s in ('l', 'r'):
            S, E, Wr = K[s + 'upperarm'], K[s + 'forearm'], K[s + 'hand']
            m = c & (side == np.sign(lf(S)[0]))
            a = ((P - S) @ (E - S)) / ((E - S) @ (E - S)); b = 1 + ((P - E) @ (Wr - E)) / ((Wr - E) @ (Wr - E))
            t[m] = np.where(a < 1, a, b)[m]
        self.t = t
        # angle round the leg axis: 0 outer side, +pi/2 front
        ang = np.zeros(self.y.shape)
        for s in ('l', 'r'):
            Hj, Kj = np.array(lf(K[s + 'thigh'])), np.array(lf(K[s + 'calf']))
            m = side == np.sign(Hj[0])
            fr = np.clip((self.y - self.y_hip) / (self.y_knee - self.y_hip), 0, 1)[..., None]
            cc = Hj + fr * (Kj - Hj)
            ang[m] = np.arctan2(self.fwd - cc[..., 1], (self.lat - cc[..., 0]) * np.sign(Hj[0]))[m]
        self.ang = ang
        # skin from the hands (same texture, same bake), roughness from the hands' ORM
        hm = c & (self.G == HAND); col = self.px['color'][..., :3]
        Lh = col[hm] @ [0.3, 0.59, 0.11]; lo, hi2 = np.percentile(Lh, [25, 85])
        sel = col[hm][(Lh >= lo) & (Lh <= hi2)]
        self.skin = np.median(sel, 0); self.skin_rough = float(np.median(self.px['orm'][..., 1][hm]))
        hp = self.head_px; hh, ww = hp.shape[:2]
        self.head_skin = np.median(hp[int(hh * .35):int(hh * .65), int(ww * .35):int(ww * .65), :3].reshape(-1, 3), 0)

    def summary(self):
        u = self.u
        return (f'H={self.Hgt:.3f} uv={self.uvinfo} hip={self.y_hip:.3f} knee={self.y_knee:.3f} sh={self.y_sh:.3f} neck={self.y_neck:.3f} '
                f'crotch={self.y_crotch:.3f} sole={self.y_sole:.3f} shlat={self.sh_lat:.3f} fwd={np.round(self.F, 2)} '
                f'skin={np.round(self.skin * 255)} head={np.round(self.head_skin * 255)} skinR={self.skin_rough:.2f} '
                f'groups={np.bincount(self.G[self.cov], minlength=10).tolist()}')

# ---------------------------------------------------------------- outfits
# Garments follow the geometry: each UV island is one clothing piece, classed by the bone group most of it
# rides on (top, bottom, shoe). Tops stay tops (rashies, a swim dress, a burkini tunic, a wetsuit), trouser
# legs become swim leggings or long boardies, shorts become boardies, shoes become bare feet on thongs.
# Texels that are already skin (bare arms, calves, necklines) are kept as they are.
SKIN, LYCRA, BOARD, RASH, SOLE, WET, TOWEL, LINEN = 1, 2, 3, 4, 5, 6, 7, 8
SHADE = {SKIN: 0.3, LYCRA: 0.4, BOARD: 0.7, RASH: 0.4, SOLE: 0.3, WET: 0.4, TOWEL: 0.8, LINEN: 0.7}   # baked fold/AO shading kept
FLAT = {SKIN: 1.0, LYCRA: 0.8, BOARD: 0.35, RASH: 0.85, SOLE: 0.5, WET: 0.7, TOWEL: 0.2, LINEN: 0.7}   # normal map flattening
ROUGH = {LYCRA: 0.7, BOARD: 0.82, RASH: 0.68, SOLE: 0.7, WET: 0.62, TOWEL: 0.95, LINEN: 0.9}

def rgb(c): return np.array(c, np.float32) / 255

def roll_or(m, n=1):
    for _ in range(n):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m

def islands(cov):
    """4-connected UV islands (max-label propagation over the coverage closed by 1 px)"""
    H, W = cov.shape; dom = roll_or(cov)
    lab = np.where(dom, np.arange(H * W).reshape(H, W), -1)
    while True:
        new = lab
        for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = np.roll(lab, d, (0, 1)); new = np.where(dom & (n > new), n, new)
        if (new == lab).all(): break
        lab = new
    return np.where(cov, lab, -1)

class Paint:
    def __init__(s, B, cuffs=False):
        s.B = B; sh = B.y.shape; g = B.G; c = B.cov
        col0 = B.px['color'][..., :3]
        s.L0 = col0 @ np.array([0.3, 0.59, 0.11], np.float32)
        s.sat = col0.max(-1) - col0.min(-1)
        # skin model from the hands: Mahalanobis distance in RGB
        # skin test: chromaticity close to the hands' (mid-tone texels) and a similar brightness
        hs = col0[c & (g == HAND)]; Lh = hs @ [0.3, 0.59, 0.11]; a, b = np.percentile(Lh, [25, 85])
        hm = hs[(Lh >= a) & (Lh <= b)]; ch = hm / hm.sum(1, keepdims=True); rh, gh = np.median(ch[:, 0]), np.median(ch[:, 1])
        sm = np.maximum(col0.sum(-1), 1e-3); r, gg = col0[..., 0] / sm, col0[..., 1] / sm; Lm = np.median(hm @ [0.3, 0.59, 0.11])
        tight = (np.abs(r - rh) < 0.035) & (np.abs(gg - gh) < 0.022) & (s.L0 > 0.55 * Lm) & (s.L0 < 1.45 * Lm)
        loose = (np.abs(r - rh) < 0.055) & (np.abs(gg - gh) < 0.034) & (s.L0 > 0.5 * Lm) & (s.L0 < 1.6 * Lm)   # hairy or shadowed skin
        k0 = c & tight & ~np.isin(g, [HAND, FOOT])
        keep = roll_or(k0 & ~roll_or(~k0)) & k0     # opening: drop specks, keep real skin areas as seeds
        for _ in range(4): keep = keep | (roll_or(keep) & loose & c & ~np.isin(g, [HAND, FOOT]))   # grow into nearby darker skin only
        s.keep = keep
        ks = col0[s.keep & np.isin(g, [UPPER, FORE, CALF])]
        L = hs @ [0.3, 0.59, 0.11]; lo, hi = np.percentile(L, [15, 50])
        s.skin = np.median(ks, 0) if len(ks) > 1500 else 0.5 * (np.median(hs[(L >= lo) & (L <= hi)], 0) + B.head_skin)   # no bare limbs: hands and face
        # islands by majority bone group
        lab = islands(c); s.lab = lab
        ids, inv = np.unique(lab[c], return_inverse=True)
        cnt = np.zeros((len(ids), 10)); np.add.at(cnt, (inv, g[c]), 1)
        maj = np.argmax(cnt, 1)
        topf = cnt[:, [TORSO, NECK, HEAD, UPPER, FORE]].sum(1) / cnt.sum(1)
        hi = np.zeros(len(ids)); np.add.at(hi, inv, (B.y[c] > B.y_hip + 0.2 * B.u).astype(float))
        maj = np.where(((topf >= 0.3) | (hi / cnt.sum(1) > 0.05)) & np.isin(maj, [PELVIS, THIGH, CALF]), TORSO, maj)   # long tunics reach the chest: tops
        cls = np.full(sh, -1); cls[c] = maj[inv]
        s.TOP = c & np.isin(cls, [TORSO, NECK, HEAD, UPPER, FORE])
        s.BOT = c & np.isin(cls, [PELVIS, THIGH, CALF])
        s.SHOE = c & (cls == FOOT)
        s.n_islands = len(ids)
        s.kind = np.zeros(sh, np.int8); s.col = np.zeros(sh + (3,), np.float32)
        # hand islands are never touched; hand-weighted texels in sleeve islands are cuffs only on long sleeves
        s.cls = cls; s.cuffs = cuffs; s.rep = c & ~s.keep & (cls != HAND) & (cuffs | (g != HAND))
        s.put(s.rep, SKIN, s.skin * 255)
        # shoes -> bare feet on thongs
        s.feet = s.SHOE | (c & (g == FOOT) & ~s.BOT)
    def put(s, m, k, c, force=False):
        m = m & (s.B.cov & (s.cls != HAND) & (s.cuffs | (s.B.G != HAND)) if force else s.rep); s.kind[m] = k; s.col[m] = rgb(c) if np.max(c) > 1.5 else np.asarray(c, np.float32)
    def soles(s, c):
        B = s.B; s.put(s.feet, SKIN, s.skin * 255); s.put(s.feet & (B.y < B.y_sole + 0.022 * B.u), SOLE, c)

def outfit(name, B):
    p = Paint(B, cuffs=name in ('f06', 'f09', 'm04', 'm07', 'm10')); u = B.u; y = B.y; T, Bo = p.TOP & ~p.feet, p.BOT & ~p.feet
    knee = B.y_knee + 0.05 * u
    stripe = np.abs(B.ang) < 0.24
    sl = np.abs(B.lat) > B.sh_lat + 0.02 * u   # clean sleeve cut: a plane just outside the shoulder joint (T-pose bind)
    light = p.L0 > 0.5; grey = (p.sat < 0.12) & (p.L0 > 0.3); vivid = p.sat > 0.22
    if name == 'm01':    # polo -> light grey short-sleeve zip-neck rashie, cargo shorts -> plain navy boardies
        p.put(T & (~np.isin(B.G, [UPPER, FORE]) | (B.t < 0.8)), RASH, (196, 200, 206)); p.put(T & sl & (B.t < 0.8), RASH, (32, 42, 74)); p.put(Bo & (y > B.y_knee - 0.10 * u), BOARD, (32, 42, 74)); p.soles((30, 30, 34))
    elif name == 'm04':  # leather jacket + trousers -> black steamer wetsuit with a blue chest band, hood -> beach towel
        # hooded jacket -> hooded towelling surf poncho in broad stripes, trousers -> black steamer legs
        band = np.floor((y - B.y_hip) / (0.07 * u)) % 3
        for i, cc in enumerate(((40, 62, 128), (236, 234, 226), (236, 150, 40))): p.put(T & (band == i), TOWEL, cc, force=True)
        p.put(Bo, WET, (24, 24, 26))
        p.soles((40, 70, 150))
    elif name == 'm07':  # blazer + shirt -> royal blue long-sleeve zip rashie (navy front panel); jeans -> colour-block boardies over black surf leggings
        p.put(T, LINEN, (178, 200, 222)); p.put(T & (p.sat > 0.1), RASH, (24, 34, 70), force=True)   # open chambray shirt over a navy rashie
        m = Bo & (y >= knee); w = y[m].max() if m.any() else B.y_hip
        p.put(Bo & (y < knee), LYCRA, (34, 36, 44)); p.put(m, BOARD, (0, 118, 128))
        p.put(m & (y < knee + 0.30 * (w - knee)) & (y > knee + 0.20 * (w - knee)), BOARD, (236, 234, 226))
        p.put(m & (np.abs(B.ang) < 0.5), BOARD, (226, 116, 44)); p.soles((25, 25, 25))
    elif name == 'm10':  # track jacket -> red long-sleeve rashie keeping the white sleeve stripes; trackies -> olive boardies (black side stripe) over surf leggings
        p.put(T, RASH, (236, 186, 40)); p.put(T & sl, RASH, (30, 42, 80))
        m = Bo & (y >= knee); p.put(Bo & (y < knee), LYCRA, (34, 36, 44)); p.put(m, BOARD, (92, 102, 68)); p.put(m & stripe, BOARD, (36, 36, 36))
        p.soles((150, 40, 40))
    elif name == 'f01':  # shirt -> sky blue short-sleeve zip-neck rashie; jeans -> navy boardshorts (white band) over black swim leggings
        wb = B.y_knee + 0.14 * u; m = Bo & (y >= wb)
        p.put(T, RASH, (92, 168, 212)); p.put(T & sl, RASH, (236, 236, 232)); p.put(Bo & (y < wb), LYCRA, (34, 36, 44)); p.put(m, BOARD, (32, 44, 80)); p.soles((220, 90, 120))
    elif name == 'f03':  # camisole tunic -> coral one-piece swim dress (square neck, straps, flared skirt); trousers -> navy swim leggings
        c0 = B.px['color'][..., :3]; p.put(T & (c0[..., 2] > c0[..., 1] + 0.04), LYCRA, (214, 84, 72))   # the purple top only, not the tattoo
        p.put(Bo, LYCRA, (30, 40, 72)); p.soles((240, 200, 60))
    elif name == 'f06':  # kameez + trousers + headscarf -> teal burkini tunic, navy leggings, white swim hijab (head maps untouched)
        p.put(T, LYCRA, (0, 116, 126)); p.put(Bo, LYCRA, (28, 38, 70)); p.soles((40, 40, 44))
    elif name == 'f09':  # cardigan -> navy open long-sleeve rash jacket; blouse -> teal and white striped tankini top; trousers -> coral boardshorts over leggings
        p.put(T, LINEN, (232, 226, 212))   # open cardigan -> light kimono cover-up
        tk = T & light; p.put(tk, LYCRA, (30, 42, 78)); p.put(tk & (np.floor(y / (0.03 * u)) % 2 == 0), LYCRA, (236, 236, 230))
        wb = B.y_knee + 0.14 * u; p.put(Bo & (y < wb), LYCRA, (34, 36, 44)); p.put(Bo & (y >= wb), BOARD, (214, 92, 80))
        p.soles((250, 250, 250))
    print('PAINT', name, 'islands', p.n_islands, 'keep', int(p.keep.sum()), 'top', int(T.sum()), 'bot', int(Bo.sum()), 'feet', int(p.feet.sum()), 'skin', np.round(p.skin * 255))
    return p

def repaint(B, p):
    col0 = B.px['color'][..., :3]; nrm0 = B.px['normal'][..., :3]; orm0 = B.px['orm'][..., :3]
    L = col0 @ np.array([0.3, 0.59, 0.11], np.float32)
    shade = np.clip(blur(L, 3) / np.maximum(blur(L, 14), 0.02), 0.8, 1.08)   # broad folds and AO, not prints or stripes
    k = p.kind; ch = k > 0
    pw = np.zeros(k.shape, np.float32); fl = np.zeros(k.shape, np.float32); ro = np.zeros(k.shape, np.float32)
    for kk in SHADE:
        m = k == kk; pw[m] = SHADE[kk]; fl[m] = FLAT[kk]; ro[m] = ROUGH.get(kk, B.skin_rough)
    col = np.where(ch[..., None], p.col * (shade ** pw)[..., None], col0)
    nrm = np.where(ch[..., None], nrm0 * (1 - fl[..., None]) + np.array([0.5, 0.5, 1.0], np.float32) * fl[..., None], nrm0)
    orm = orm0.copy(); orm[..., 1] = np.where(ch, ro, orm0[..., 1])
    allow = ~B.cov   # grow the new paint into the gutters only, never over untouched islands
    return [dilate(a, ch, allow, 6) for a in (col, nrm, orm)]

# ---------------------------------------------------------------- modes
def dump(names):
    for n in names:
        B = Body(os.path.join(SRC, n + '.glb')); print('BODY', n, B.summary())
        c = B.px['color'][..., :3]
        g = np.where(B.cov[..., None], 0.35 * c + 0.65 * GCOL[B.G], c * 0.3)
        band = (np.floor((B.y - B.y_sole) / (0.05 * B.u)) % 2)[..., None]
        g = np.where(B.cov[..., None], g * (0.85 + 0.15 * band), g)
        save_px(np.concatenate([c, g], 1), os.path.join(LOG, f'{n}_uv.png'))

def build(names):
    os.makedirs(DST, exist_ok=True)
    for n in names:
        src = os.path.join(SRC, n + '.glb'); B = Body(src); print('BODY', n, B.summary())
        p = outfit(n, B); col, nrm, orm = repaint(B, p)
        repl = {}
        for key, img in (('color', col), ('normal', nrm), ('orm', orm)):
            f = os.path.join(TMP, f'{n}_{key}_swim.jpg'); save_px(img, f, 'JPEG'); repl[B.img_view[key]] = open(f, 'rb').read()
        out = os.path.join(DST, n + '.glb'); write_glb(out, B.j, B.bin, repl)
        save_px(np.concatenate([B.px['color'][..., :3], col], 1), os.path.join(LOG, f'{n}_tex.png'))
        # proof: everything but the three body images is unchanged
        j2, b2 = read_glb(out)
        same_json = all(B.j.get(k) == j2.get(k) for k in B.j if k not in ('bufferViews', 'buffers'))
        same_views = all((view_bytes(B.j, B.bin, i) == view_bytes(j2, b2, i)) != (i in repl) for i in range(len(B.j['bufferViews'])))
        strip = lambda v: {k: x for k, x in v.items() if k not in ('byteOffset', 'byteLength')}
        same_meta = all(strip(a) == strip(b) for a, b in zip(B.j['bufferViews'], j2['bufferViews']))
        print('WROTE', out, os.path.getsize(out), 'json_same', same_json, 'views_same_except_3_images', same_views, 'view_meta_same', same_meta,
              'painted', {kk: int((p.kind == kk).sum()) for kk in SHADE})

def sheet(out, glbs):
    from mathutils import Vector
    tiles = []; TW, TH = 360, 720
    for gi, g in enumerate(glbs):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        bpy.ops.import_scene.gltf(filepath=g)
        arm = next(o for o in sc.objects if o.type == 'ARMATURE'); mesh = next(o for o in sc.objects if o.type == 'MESH')
        ad = arm.animation_data or arm.animation_data_create()
        for tr in ad.nla_tracks: tr.mute = True
        act = next((a for a in bpy.data.actions if a.name.startswith('idle_neutral_01')), None)
        if act:
            ad.action = act
            try:
                if getattr(ad, 'action_slot', None) is None and len(act.slots): ad.action_slot = act.slots[0]
            except Exception as e: print('slot', e)
        sc.frame_set(20)
        dg = bpy.context.evaluated_depsgraph_get(); ev = mesh.evaluated_get(dg)
        bb = [mesh.matrix_world @ Vector(c) for c in ev.bound_box]
        zmin = min(v.z for v in bb); zmax = max(v.z for v in bb)
        cx = sum(v.x for v in bb) / 8; cy = sum(v.y for v in bb) / 8
        pb = {norm(b.name): b for b in arm.pose.bones}
        fw = Vector((0, 0, 0))
        for s in 'lr': fw += (arm.matrix_world @ pb[f'bip01{s}toe0'].head) - (arm.matrix_world @ pb[f'bip01{s}foot'].head)
        fw.z = 0; fw.normalize()
        print('POSE', os.path.basename(g), 'action', ad.action.name if ad.action else None, 'h', round(zmax - zmin, 3))
        w = bpy.data.worlds.new('w'); sc.world = w
        try: w.use_nodes = True
        except Exception: pass
        bg = w.node_tree.nodes.get('Background'); bg.inputs[0].default_value = (0.62, 0.66, 0.72, 1); bg.inputs[1].default_value = 0.8
        for ang, en, rot in ((35, 2.6, 50), (-120, 0.8, 30)):
            ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = en; ld.angle = math.radians(20)
            lo = bpy.data.objects.new('sun', ld); sc.collection.objects.link(lo)
            d = fw.copy(); d.rotate(__import__('mathutils').Euler((0, 0, math.radians(ang)))); d.z = math.tan(math.radians(rot))
            lo.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = (zmax - zmin) * 1.08
        co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co); sc.camera = co
        for e in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
            try: sc.render.engine = e; break
            except TypeError: pass
        try: sc.eevee.taa_render_samples = 32
        except Exception: pass
        sc.render.resolution_x, sc.render.resolution_y = TW, TH
        sc.view_settings.view_transform = 'Standard'
        for vi, ang in enumerate((0, 35, 180)):
            d = fw.copy(); d.rotate(__import__('mathutils').Euler((0, 0, math.radians(ang))))
            c = Vector((cx, cy, (zmin + zmax) / 2))
            co.location = c + d * 6 + Vector((0, 0, 0.3)); co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()
            f = os.path.join(TMP, f'tile_{gi}_{vi}.png'); sc.render.filepath = f
            bpy.ops.render.render(write_still=True); tiles.append(f)
    ims = []
    for f in tiles:
        im = bpy.data.images.load(f); a = np.empty(TW * TH * 4, np.float32); im.pixels.foreach_get(a); ims.append(a.reshape(TH, TW, 4))
    per = 6   # two avatars (front, three-quarter, back) per row
    rows = [np.concatenate(ims[i:i + per] + [np.ones_like(ims[0])] * (per - len(ims[i:i + per])), 1) for i in range(0, len(ims), per)]
    save_px(np.concatenate(rows[::-1], 0), out)   # Blender rows run bottom-up: first row on top
    print('SHEET', out, len(tiles))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
mode = argv[0] if argv else 'build'
if mode == 'build': build(argv[1:] or NAMES)
elif mode == 'dump': dump(argv[1:] or NAMES)
elif mode == 'sheet': sheet(argv[1], argv[2:])
