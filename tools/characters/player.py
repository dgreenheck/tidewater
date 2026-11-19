# Blender 5.x batch builder for the player character (see README, "Player").
#   blender -b --python player.py -- <workdir> <out.glb> <print_tile.png> [debug_dir]
# workdir holds the Rocketbox files fetched by player.sh (Assets/... layout).
# Rocketbox Male_Adult_01 (m002, MIT) re-dressed: tropical shirt print (texture repaint, position aware),
# tan, stubble, open collar, cargo pockets; modelled bush hat (rigid to the head) and clogs (skinned to
# the feet); locomotion retargeted in place with measured ground speeds; jump clips keyframed here.
import bpy, bmesh, sys, os, math, json, struct
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
W, OUT, PRINT = argv[:3]
DBG = argv[3] if len(argv) > 3 else None
AV = W + '/Assets/Avatars/Adults/Male_Adult_01'
TEX = AV + '/Textures/m002_'
XY = W + '/Assets/Animations/all_animations_max_motextr_xy/m_'
ST = W + '/Assets/Animations/all_animations_max_motextr_static/m_'
# contract clip -> (candidates, target m/s); the candidate nearest the target speed is used
LOCO = {'walk': (['walk_neutral_01', 'walk_neutral_02', 'walk_neutral'], 1.4),
        'run': (['run_slow_01', 'run_neutral_01', 'run_neutral'], 3.6),
        'sprint': (['run_fast_01', 'run_fast_02'], 6.2)}
IDLE = 'idle_neutral_01'
TILE_M = 0.34  # metres of fabric per print tile

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
FPS = 30.0
VL = bpy.context.view_layer
log = lambda *a: print('PLAYER', *a, flush=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, automatic_bone_orientation=False, ignore_leaf_bones=False)
    return [o for o in bpy.data.objects if o not in before]


objs = import_fbx(AV + '/Export/Male_Adult_01.fbx')
arm = next(o for o in objs if o.type == 'ARMATURE')
mesh = next(o for o in objs if o.type == 'MESH')
for o in objs:
    if o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm.name, mesh.name = 'Player', 'PlayerMesh'
BW = lambda n: arm.matrix_world @ arm.data.bones[n].head_local  # rest bone head, world metres

# ------------------------------------------------------------------ numpy image helpers
def px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)

def load(path):
    im = bpy.data.images.load(path); a = px(im).copy(); bpy.data.images.remove(im); return a

def new_img(name, a, colour=True, alpha=False):
    h, w = a.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=alpha)
    if not colour: im.colorspace_settings.name = 'Non-Color'  # before the pixels: a colourspace change regenerates the buffer
    if a.shape[2] == 3: a = np.concatenate([a, np.ones((h, w, 1), np.float32)], 2)
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.pack()
    return im

def save_png(a, path):
    im = new_img('dbg', a); im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)

def half(a): n = a.shape[0] // 2; return a.reshape(n, 2, n, 2, -1).mean((1, 3))

def blur(a, r):  # separable box blur, edge clamp, 2D or 3D
    for ax in (0, 1):
        p = np.concatenate([np.repeat(a.take([0], ax), r + 1, ax), a, np.repeat(a.take([-1], ax), r, ax)], ax)
        c = np.cumsum(p, ax, dtype=np.float64)
        a = ((c.take(range(2 * r + 1, c.shape[ax]), ax) - c.take(range(0, c.shape[ax] - 2 * r - 1), ax)) / (2 * r + 1)).astype(np.float32)
    return a

def mblur(a, m, r):  # blur inside mask m only
    num = blur(a * (m[..., None] if a.ndim == 3 else m), r); den = blur(m.astype(np.float32), r)
    return num / np.maximum(den, 1e-4)[..., None] if a.ndim == 3 else num / np.maximum(den, 1e-4)

def hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1); d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    return h, d / (mx + 1e-6), mx

def ss(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def sample(tile, u, v):  # bilinear, wrapping
    n = tile.shape[0]; x = (u % 1) * n - 0.5; y = (v % 1) * n - 0.5
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int); fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    g = lambda yy, xx: tile[yy % n, xx % n]
    return (g(y0, x0) * (1 - fx) + g(y0, x0 + 1) * fx) * (1 - fy) + (g(y0 + 1, x0) * (1 - fx) + g(y0 + 1, x0 + 1) * fx) * fy

# ------------------------------------------------------------------ slim the sneaker-shaped feet (they sit bare inside the clogs)
mw0 = mesh.matrix_world; imw0 = mw0.inverted(); wco = [mw0 @ v.co for v in mesh.data.vertices]
for sd in (1, -1):
    idx = [i for i, c in enumerate(wco) if c.z < 0.14 and c.x * sd > 0.02 and abs(c.x) < 0.3]
    cx = sum(wco[i].x for i in idx) / len(idx); cy = sum(wco[i].y for i in idx) / len(idx)
    for i in idx:
        c = wco[i]; k = 1 - 0.13 * min(1.0, max(0.0, (0.14 - c.z) / 0.05))
        mesh.data.vertices[i].co = imw0 @ Vector((cx + (c.x - cx) * k, cy + (c.y - cy) * k, c.z))
mesh.data.update()

# ------------------------------------------------------------------ bake rest-pose world position into both UV maps
scene.render.engine = 'CYCLES'; scene.cycles.samples = 1; scene.cycles.use_denoising = False
scene.render.bake.margin = 6
pos_img = {}
for slot in mesh.material_slots:
    kind = slot.material.name.split('_')[-1]
    m = slot.material; m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission'); g = nt.nodes.new('ShaderNodeNewGeometry')
    nt.links.new(g.outputs['Position'], e.inputs['Color']); nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
    im = bpy.data.images.new('pos_' + kind, 2048 if kind != 'opacity' else 64, 2048 if kind != 'opacity' else 64, alpha=True, float_buffer=True)
    im.generated_color = (0, 0, 0, 0)
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; nt.nodes.active = t
    pos_img[kind] = im
VL.update(); [o.select_set(False) for o in scene.objects]
mesh.select_set(True); VL.objects.active = mesh
bpy.ops.object.bake(type='EMIT', use_clear=False)
PB, PH = px(pos_img['body']), px(pos_img['head'])
log('baked position maps', (PB[..., 3] > 0.5).mean().round(3), (PH[..., 3] > 0.5).mean().round(3))

# ------------------------------------------------------------------ body texture: classify, repaint
col = load(TEX + 'body_color.tga')[..., :3]
nrm = load(TEX + 'body_normal.tga')[..., :3]
spec = load(TEX + 'body_specular.tga')[..., 0]
X, Y, Z, cov = PB[..., 0], PB[..., 1], PB[..., 2], PB[..., 3] > 0.5
H, S, V = hsv(col)
skinc = ((H < 0.085) | (H > 0.95)) & (S > 0.15) & (S < 0.75) & (V > 0.3)
khaki = (H >= 0.085) & (H < 0.18) & (S > 0.12) & (S < 0.6) & (V > 0.35)

def first(bins, frac, cond, default):
    for i in range(len(bins) - 2):
        if all(cond(frac[j]) for j in (i, i + 1, i + 2)): return bins[i]
    return default

def fractions(sel, param, bins, test, w=0.005):
    out = []
    for b in bins:
        m = sel & (np.abs(param - b) < w)
        out.append(test[m].mean() if m.sum() > 20 else np.nan)
    return np.array(out)

# arms: parameter along the upper arm from the shoulder joint
arm_s, arm_q = {}, {}
for sd, nm in ((1, 'L'), (-1, 'R')):
    sh, el = BW(f'Bip01 {nm} UpperArm'), BW(f'Bip01 {nm} Forearm')
    d = np.array((el - sh).normalized()); q = np.stack([X - sh.x, Y - sh.y, Z - sh.z], -1)
    arm_s[sd] = q @ d; arm_q[sd] = (q, d)
armsel = {sd: cov & (X * sd > 0.19) & (Z > 0.95) for sd in (1, -1)}
sleeve = {}
for sd in (1, -1):
    bins = np.arange(0.0, 0.3, 0.005)
    fr = fractions(armsel[sd], arm_s[sd], bins, skinc)
    sleeve[sd] = first(bins, fr, lambda f: f > 0.6, 0.13)
legs = cov & (np.abs(X) < 0.25) & (Z < 0.9)
zb = np.arange(0.85, 0.25, -0.005)
z_hem = first(zb, fractions(legs, Z, zb, skinc & ~khaki), lambda f: f > 0.6, 0.52)
zb2 = np.arange(0.35, 0.0, -0.005)
z_shoe = first(zb2, fractions(legs, Z, zb2, skinc), lambda f: f < 0.35, 0.11)
torso = cov & (np.abs(X) < 0.15)
zb3 = np.arange(1.15, 0.8, -0.005)
z_waist = first(zb3, fractions(torso, Z, zb3, khaki), lambda f: f > 0.5, 0.95)
log('regions sleeve', round(sleeve[1], 3), round(sleeve[-1], 3), 'hem', round(z_hem, 3), 'shoe', round(z_shoe, 3), 'waist', round(z_waist, 3))

neck_raw = (Z > 1.40) & skinc & (V > 0.5)  # the darker polo collar trim stays shirt
neckband = neck_raw & (blur(neck_raw.astype(np.float32), 4) > 0.7) & (np.hypot(X, Y - BW('Bip01 Neck').y) < 0.11)  # solid neck skin, not the thin polo stripes
is_arm = {sd: armsel[sd] & (arm_s[sd] > 0.0) for sd in (1, -1)}
wband = cov & (np.abs(X) < 0.25) & (Z > z_hem) & (Z < 1.05)
kh_v = blur(khaki.astype(np.float32), 6); sh_v = blur((~khaki & ~skinc).astype(np.float32), 6)
sk_s = (blur((skinc & ~khaki).astype(np.float32), 3) > 0.6) & (Z < z_hem + 0.06)  # bare knee just above the hem
kh_s = (kh_v >= sh_v) & ~sk_s
# shirt hem: per 10 degree sector around the hips, the highest z where the khaki starts (clean hem line)
ang_t = np.arctan2(X, -Y); sec = ((ang_t + np.pi) / (2 * np.pi) * 36).astype(int) % 36
tb = cov & (np.abs(X) < 0.25) & (Z > 0.8) & (Z < 1.06); Zs, Ks, As = Z[tb], khaki[tb], sec[tb]
hem = np.full(36, z_waist); zs = np.arange(1.05, 0.8, -0.005)
for k in range(36):
    zz, kk = Zs[As == k], Ks[As == k]
    fr = np.array([kk[np.abs(zz - b) < 0.005].mean() if (np.abs(zz - b) < 0.005).sum() > 10 else np.nan for b in zs])
    hem[k] = first(zs, fr, lambda f: f > 0.5, z_waist)
hem = (np.roll(hem, 1) + hem + np.roll(hem, -1)) / 3; hz = hem[sec]
log('hem', hem.min().round(3), hem.max().round(3))
shirt = cov & (Z < 1.575) & (np.abs(X) < 0.25) & ~neckband & ((Z >= 1.05) | (wband & (Z > hz))) | \
        (cov & is_arm[1] & (arm_s[1] < sleeve[1])) | (cov & is_arm[-1] & (arm_s[-1] < sleeve[-1]))
shorts = wband & ~shirt & ~sk_s
shoe = cov & (np.abs(X) < 0.25) & (Z < z_shoe + 0.045)  # sneaker collar included: bare ankle
skin = cov & ~shirt & ~shorts & ~shoe

TAN = np.array([0.94, 0.79, 0.64], np.float32)
def tan(c): return np.clip(c * TAN * 0.98, 0, 1)

new = col.copy()
L = col @ np.array([0.3, 0.59, 0.11], np.float32)
# shirt: print * low-pass fabric shading (the polo stripes are filtered out)
Lb = mblur(L, shirt, 30); shade = np.clip(Lb / np.median(Lb[shirt]), 0.55, 1.15)
tile = load(PRINT)[..., :3]
tile = half(tile)  # match the body texel density (about 1.5 px/mm)
u = np.zeros_like(X); v = np.zeros_like(X)
ang = np.arctan2(X, -Y)
u[:] = ang * 0.16 / TILE_M; v[:] = Z / TILE_M
for sd in (1, -1):
    q, d = arm_q[sd]; e1 = np.cross(d, [0, 1, 0]); e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
    m = is_arm[sd] & (arm_s[sd] > 0.03)
    u[m] = (arm_s[sd][m] / TILE_M) + 0.37 * (sd > 0)
    v[m] = np.arctan2(q[m] @ e2, q[m] @ e1) * 0.055 / TILE_M
pr = sample(tile, u, v) * shade[..., None]
# open camp collar: a V of (tanned) chest skin, a fold shadow along its edge, button placket below
za = 1.365
vw = np.clip((Z - za) / 0.15, 0, None) * 0.085
front = Y < -0.03
V_in = shirt & front & (Z > za) & (Z < 1.485) & (np.abs(X) < vw)
V_edge = shirt & front & (Z > za - 0.004) & (Z < 1.485) & (np.abs(np.abs(X) - vw) < 0.006)
fore = cov & skinc & ((is_arm[1] & (arm_s[1] > sleeve[1] + 0.06)) | (is_arm[-1] & (arm_s[-1] > sleeve[-1] + 0.06))) & (V > 0.45)
skin_ref = np.median(tan(col[fore]), 0) if fore.sum() > 50 else np.array([0.72, 0.52, 0.38])
log('skin_ref', skin_ref.round(3), int(fore.sum()))
new[shirt] = pr[shirt]
new[V_edge] *= 0.62
new[V_in] = (skin_ref * np.clip(shade[V_in], 0.8, 1.05)[:, None]) * (0.85 + 0.15 * ss(0.0, 0.02, vw[V_in] - np.abs(X[V_in])))[:, None]
plk = shirt & front & (Z < za) & (Z > z_waist) & (np.abs(X - 0.012) < 0.0011)
new[plk] *= 0.55
for k in range(6):
    bz = za - 0.035 - k * 0.078
    if bz < z_waist + 0.03: break
    r = np.hypot(X - 0.0, Z - bz)
    b = shirt & front & (Y < -0.05) & (r < 0.0062)
    new[b] = np.array([0.93, 0.9, 0.82]) * np.where(r[b] > 0.0045, 0.72, 1.0)[:, None]
for sd in (1, -1):  # sleeve hem fold
    h = shirt & is_arm[sd] & (arm_s[sd] > sleeve[sd] - 0.018)
    new[h] *= 0.8
# shorts: keep the khaki, add cargo pockets on the outer thighs
for sd, nm in ((1, 'L'), (-1, 'R')):
    a0, a1 = BW(f'Bip01 {nm} Thigh'), BW(f'Bip01 {nm} Calf')
    t = np.clip((a0.z - Z) / (a0.z - a1.z), 0, 1)
    ax_, ay_ = a0.x + (a1.x - a0.x) * t, a0.y + (a1.y - a0.y) * t
    outer = shorts & ((X - ax_) * sd > 0.035) & (np.abs(Y - ay_) < 0.055) & (Z > 0.575) & (Z < 0.705)
    new[outer] *= 0.94
    edge = outer & ((np.abs(np.abs(Y - ay_) - 0.055) < 0.004) | (Z < 0.579) | (Z > 0.701))
    flap = outer & (Z > 0.662)
    new[flap] *= 0.9
    new[outer & (np.abs(Z - 0.662) < 0.003)] *= 0.62
    new[edge] *= 0.78
# skin: tan; feet inside the clogs become bare feet
new[skin] = tan(col[skin])
Ls = mblur(L, shoe, 6); fs = np.clip(Ls / max(np.median(Ls[shoe]), 1e-3), 0.65, 1.1) if shoe.any() else 1
new[shoe] = (skin_ref * (fs[shoe][:, None] if shoe.any() else 1)) * 0.95
nrm[shoe] = (0.5, 0.5, 1.0)
fw = ss(z_shoe + 0.02, z_shoe + 0.045, Z); bl = shoe & (fw > 0)
new[bl] = new[bl] * (1 - fw[bl, None]) + tan(col[bl]) * fw[bl, None]
rough = 0.92 - 0.6 * spec
rough[shirt] = 0.74; rough[shorts] = 0.88; rough[shoe] = 0.6
orm_b = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)

# ------------------------------------------------------------------ head: tan + stubble
hcol = load(TEX + 'head_color.tga')[..., :3]
hn = load(TEX + 'head_normal.tga')[..., :3]; hsp = load(TEX + 'head_specular.tga')[..., 0]
hX, hY, hZ, hc = PH[..., 0], PH[..., 1], PH[..., 2], PH[..., 3] > 0.5
hh, hs_, hv = hsv(hcol)
hskin = (((hh < 0.1) | (hh > 0.95)) & (hs_ > 0.12) & (hv > 0.2)).astype(np.float32)
hskin = blur(hskin, 2)
hnew = hcol * (1 - hskin[..., None]) + tan(hcol) * hskin[..., None]
lips = (np.abs(hX) < 0.03) & (hZ > 1.598) & (hZ < 1.627) & (hY < -0.112)
lipw = ss(1.15, 0.7, (hX / 0.034) ** 2 + ((hZ - 1.6125) / 0.0175) ** 2) * (hY < -0.1)  # round 6: soft, the old rectangle left a hard box in the stubble
beard = ss(1.535, 1.552, hZ) * (1 - ss(1.628, 1.642, hZ)) * ss(0.0, 0.035, -hY) * hc * (1 - lipw)
beard *= 1 - ss(0.03, 0.06, np.abs(hX)) * ss(1.60, 1.625, hZ)  # keep the upper cheeks clean
rng = np.random.default_rng(3)
grain = blur(rng.random(hZ.shape).astype(np.float32), 1)
a = (0.33 * beard * ss(0.35, 0.65, grain))[..., None]
hnew = hnew * (1 - a) + np.array([0.22, 0.15, 0.1], np.float32) * a
hrough = 0.92 - 0.6 * hsp
orm_h = np.stack([np.ones_like(hrough), hrough, np.zeros_like(hrough)], -1)
# haircut (round 5): a mid skin fade. The Rocketbox hair was alpha cards over a painted scalp (ragged, grey card backs,
# "dismal"). Now the scalp texels are repainted as the fade and a mesh cap (built after the hat, below) carries the
# length, both from hair_fields(). Heights from the brow joint: skin to 6 cm under the brow line, a clipper shadow of
# fine stubble to 1 cm under it, 1-2 cm on the sides (a few mm of volume), 3-5 cm on top in clumps; a crisp line-up at
# the forehead, temples and sideburns and a square neckline. Reference photos: docs/third-person.md.
zBr = BW('Bip01 MMiddleEyebrow').z
hband = hc & (hZ > zBr + 0.04) & (hZ < zBr + 0.10)
HCY = float((hY[hband].min() + hY[hband].max()) / 2); HRY = float((hY[hband].max() - hY[hband].min()) / 2)
emask = hc & (hZ > zBr - 0.055) & (hZ < zBr - 0.005) & (np.abs(hY - HCY) < 0.5 * HRY)
ei = int(np.argmax(np.where(emask, np.abs(hX), -1))); EAR = (float(np.abs(hX.flat[ei])), float(hY.flat[ei]), zBr - 0.03)
log('haircut head: brow z', round(zBr, 3), 'centre y', round(HCY, 3), 'half depth', round(HRY, 3), 'ear x y z', [round(e, 3) for e in EAR])

def hair_fields(X, Y, Z):  # coverage (crisp line-up), fade density, top weight, clump ridges; numpy, world metres
    ax, h = np.abs(X), Z - zBr
    e = lambda d, w=0.0005: ss(-w, w, d)  # round 6: a clipper line-up is crisp (1 mm)
    hl = e(h - (0.055 - 0.006 * np.minimum(ax / 0.05, 1.4) ** 2))  # forehead hairline, slight temple points
    side = e(Y - (EAR[1] - 0.026), 0.0006) * e(h + 0.03)  # temple line 2.6 cm before the ear, down to the sideburn (mid-ear)
    nl = zBr - 0.088 + 0.01 * ss(0.035, 0.065, ax)  # a square neckline, the corners a touch higher
    nape = e(Y - (EAR[1] + 0.022)) * e(Z - nl)  # behind the ear, down to the neckline
    ear = np.clip(1 - (((Y - EAR[1] - 0.004) / 0.027) ** 2 + ((Z - EAR[2]) / 0.038) ** 2), 0, 1) * (ax > 0.045)
    C = np.maximum(hl, np.maximum(side, nape)) * (1 - ss(0.0, 0.15, ear))
    hf = h + 0.008 * np.clip((Y - HCY) / HRY, 0, 1)  # the fade line dips a little towards the back
    dens = ss(-0.062, -0.012, hf) * (1 - 0.35 * ss(0.012, -0.03, h) * (Y < EAR[1] - 0.008))  # the sideburn fades out too
    topw = ss(0.048, 0.076, h)
    qa = X + 0.006 * np.sin(Y * 95 + 1.3)
    clump = (0.5 * np.sin(qa * 2 * np.pi / 0.018 + 2.0 * np.sin(Y * 2 * np.pi / 0.05)) +
             0.3 * np.sin(qa * 2 * np.pi / 0.011 + 1.7 + 1.5 * np.sin(Y * 2 * np.pi / 0.035 + 0.4)) +
             0.2 * np.sin(Y * 2 * np.pi / 0.03 + X * 80))
    return C, dens, topw, clump

# tufts: forward-swept clumps on the top (shared with the mesh cap so the light tips sit on the raised clumps)
_tr = np.random.default_rng(11); _tc = []
while len(_tc) < 70:
    x_, y_ = _tr.uniform(-0.07, 0.07), _tr.uniform(HCY - HRY * 0.85, HCY + HRY * 0.6)
    if (x_ / 0.075) ** 2 + ((y_ - HCY + 0.1 * HRY) / (0.95 * HRY)) ** 2 < 1: _tc.append((x_, y_, _tr.uniform(0.5, 1.0), _tr.uniform(-0.35, 0.35)))
def tufts(X, Y):
    out = np.zeros_like(X)
    for (x_, y_, a_, r_) in _tc:
        dx, dy = X - x_, Y - y_; al = dy * math.cos(r_) + dx * math.sin(r_); ac = dx * math.cos(r_) - dy * math.sin(r_)
        out = np.maximum(out, a_ * np.exp(-(al / 0.022) ** 2 - (ac / 0.0075) ** 2))
    return out
hC, hD, hT, hK = hair_fields(hX, hY, hZ); hC = hC * hc; hU = tufts(hX, hY) * hT
h_t = hZ - zBr
earc = (np.abs(hX) > 0.06) & (((hY - EAR[1] - 0.004) / 0.021) ** 2 + ((hZ - EAR[2]) / 0.032) ** 2 < 1)
face_ = (np.abs(hX) < 0.058) & (hY < EAR[1] - 0.055) & (h_t < 0.012) | (hY < EAR[1] - 0.012) & (h_t < -0.06)  # brows, eyes and the lower face kept
# round 6, the skin under the old painted hair. Round 5 filled it with texel-space box blurs and a hard switch between
# two radii, which left rectangular camo blocks, a flat light band on the forehead and dark wedges at the temples. Now
# (1) the fill is a normalised convolution in 3D (a voxel grid over the head), so nothing mixes across a UV seam and
# nothing has a box edge; (2) only texels that really are old hair are replaced (darker than the skin round them, or
# not skin-coloured), feathered, and the real skin with its pores is kept everywhere else; (3) the fill gets pores,
# normals and roughness back from a mirror-tiled patch of forehead.
def _blur1(g, r, ax):  # box sum along one axis, zero padded
    n = g.shape[ax]; c = np.cumsum(np.pad(g, [(r + 1, r) if i == ax else (0, 0) for i in range(g.ndim)]), axis=ax)
    return np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, np.arange(n), axis=ax)
VC = 0.004
hi_ = np.flatnonzero(hc.ravel()); XYZ_ = np.stack([hX.ravel()[hi_], hY.ravel()[hi_], hZ.ravel()[hi_]], -1)
vlo_ = XYZ_.min(0) - 12 * VC; vdim_ = (np.ceil((XYZ_.max(0) - vlo_) / VC) + 13).astype(int)
vflat_ = np.ravel_multi_index(np.clip(np.round((XYZ_ - vlo_) / VC).astype(int), 0, vdim_ - 1).T, vdim_)
vf_ = (XYZ_ - vlo_) / VC; vi0_ = np.clip(np.floor(vf_).astype(int), 0, vdim_ - 2); vt_ = (vf_ - vi0_).astype(np.float32)
def vconv(w, vals=None, r=3):  # (blurred sum of w, blurred mean of vals weighted by w), sampled back at every head texel
    out = []
    for ch in [w] + ([] if vals is None else [vals[:, k] * w for k in range(vals.shape[1])]):
        g = np.bincount(vflat_, ch, minlength=int(np.prod(vdim_))).reshape(vdim_)
        for _ in range(3):
            for ax in range(3): g = _blur1(g, r, ax)
        s_ = 0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    s_ = s_ + (vt_[:, 0] if dx else 1 - vt_[:, 0]) * (vt_[:, 1] if dy else 1 - vt_[:, 1]) * \
                        (vt_[:, 2] if dz else 1 - vt_[:, 2]) * g[vi0_[:, 0] + dx, vi0_[:, 1] + dy, vi0_[:, 2] + dz]
        out.append(s_)
    return out[0], (None if vals is None else np.stack(out[1:], -1) / np.maximum(out[0], 1e-9)[:, None])
fl_ = lambda a: a.reshape(-1, a.shape[-1])[hi_] if a.ndim == 3 else a.ravel()[hi_]
def unfl(v):
    o = np.zeros(hc.shape + v.shape[1:], np.float32); o.reshape((-1,) + v.shape[1:])[hi_] = v; return o
LUM = np.array([0.3, 0.59, 0.11], np.float32)
col_ = fl_(hnew); lum_ = col_ @ LUM; beard_ = fl_(beard) > 0.02
zone_ = fl_(hc & (h_t > -0.165) & ~face_).astype(np.float32)  # where old hair may be replaced (the ear too: strands were painted over it)
cand_ = ((fl_(hskin) > 0.7) & (fl_(hv) > 0.35)).astype(np.float32)  # stubbled cheek included, so the sideburn fill matches it
one_ = np.ones_like(lum_); all3_, _ = vconv(one_, r=3); all8_, _ = vconv(one_, r=8)
_, L8_ = vconv(cand_, lum_[:, None], 8)
skin_ = cand_ * (lum_ > 0.86 * L8_[:, 0])  # skin hue and not darker than the skin 3-4 cm round it (the old strands are)
d3_, s3_ = vconv(skin_, col_, 3); d8_, s8_ = vconv(skin_, col_, 8)
w3_ = ss(0.12, 0.45, d3_ / np.maximum(all3_, 1e-9))[:, None]
lf_ = np.where((d8_ / np.maximum(all8_, 1e-9))[:, None] > 1e-3, w3_ * s3_ + (1 - w3_) * s8_, col_[skin_ > 0].mean(0))
kb_ = (zone_ < 0.5) & (cand_ > 0); lf_ = lf_ * float(lum_[kb_].mean() / lum_[kb_ & (skin_ > 0)].mean())  # the bright-skin pick reads light; undo that bias
_, zs_ = vconv(one_, zone_[:, None], 2); zone_ = ss(0.5, 0.9, zs_[:, 0]) * zone_  # ramps in from 0 at the zone's edge (3D), so no line there
hr_ = np.maximum(1 - ss(0.74, 0.92, lum_ / np.maximum(lf_ @ LUM, 1e-4)), 1 - ss(0.3, 0.7, fl_(hskin))) * zone_ * ~beard_
_, hrl_ = vconv(zone_, hr_[:, None], 3)
wf_ = np.maximum(hr_, ss(0.3, 0.55, hrl_[:, 0])) * zone_  # the old hair mass goes whole, stray strands one by one
_, wf3_ = vconv(one_, wf_[:, None], 2)  # feathered over ~1 cm in 3D, so the fill has no edge
Wf = unfl(np.maximum(hr_ * zone_, wf3_[:, 0])) * hc
SK = unfl(skin_)
PQ_ = 96  # the pore donor: forehead skin a couple of cm above the brows
dsc_ = np.where((SK > 0.5) & (hY < HCY - 0.5 * HRY), hX ** 2 + (h_t - 0.024) ** 2, 9.0)
pr0_, pc0_ = np.unravel_index(np.argmin(dsc_), dsc_.shape)
pr0_ = int(np.clip(pr0_ - PQ_ // 2, 0, hc.shape[0] - PQ_)); pc0_ = int(np.clip(pc0_ - PQ_ // 2, 0, hc.shape[1] - PQ_))
pcol_ = hnew[pr0_:pr0_ + PQ_, pc0_:pc0_ + PQ_]
det_ = np.clip(pcol_ / np.maximum(blur(pcol_, 6), 1e-3) - 1, -0.3, 0.3)
# made periodic by cross-fading with itself rolled half a tile (a mirror tile shows its axes as lines)
_tw = np.minimum(np.arange(PQ_) + 0.5, PQ_ - 0.5 - np.arange(PQ_)) / (PQ_ / 2); _tw = np.minimum(_tw[:, None], _tw[None, :])
def seamless(a, detail=False):
    w = _tw if a.ndim == 2 else _tw[..., None]; b = np.roll(a, (PQ_ // 2, PQ_ // 2), (0, 1))
    if not detail: return w * a + (1 - w) * b
    return (w * a + (1 - w) * b) / np.sqrt(w ** 2 + (1 - w) ** 2)
ii_, jj_ = np.arange(hc.shape[0]) % PQ_, np.arange(hc.shape[1]) % PQ_
tile = lambda a: a[ii_][:, jj_]
det_ = seamless(det_, True)
fill_c = unfl(lf_) * (1 + tile(det_))
# the ear: its folds were painted under the old strands; a band-pass of the old luminance (3 mm over 12 mm, darkening
# only) gives the fill its shading back without the strands
hl2_ = hnew @ LUM; bp_ = np.clip(blur(hl2_, 10) / np.maximum(blur(hl2_, 40), 1e-3), 0.5, 1.0) ** 0.55
fill_c = fill_c * (1 - blur(earc.astype(np.float32), 6)[..., None] * (1 - bp_[..., None]))
base = hnew * (1 - Wf[..., None]) + fill_c * Wf[..., None]
_, bl_ = vconv(one_, fl_(beard)[:, None], 2); aB = (0.33 * unfl(bl_[:, 0]) * ss(0.35, 0.65, grain) * Wf)[..., None]
base = base * (1 - aB) + np.array([0.22, 0.15, 0.1], np.float32) * aB  # the cheek stubble carries on up the filled sideburn and thins out
Wn = Wf * (1 - blur(earc.astype(np.float32), 4))  # the ear keeps its own normals (its folds)
hn = hn * (1 - Wn[..., None]) + tile(seamless(hn[pr0_:pr0_ + PQ_, pc0_:pc0_ + PQ_])) * Wn[..., None]
orm_h[..., 1] = orm_h[..., 1] * (1 - Wf) + tile(seamless(orm_h[pr0_:pr0_ + PQ_, pc0_:pc0_ + PQ_, 1])) * Wf
log('skin fill: replaced', int((Wf > 0.5).sum()), 'donor skin frac', round(float(SK[pr0_:pr0_ + PQ_, pc0_:pc0_ + PQ_].mean()), 3),
    'pore std', round(float(det_.std()), 4), 'at', pr0_, pc0_)
# the fade, clipper-graded (round 6): follicles (a fraction ~D of the texels) drawn as short strokes down the head that
# lengthen with D, over the grey-blue shadow clipped stubble casts through the skin; the top is the full hair tone
rng5 = np.random.default_rng(5)
lf = blur(rng5.random(hZ.shape).astype(np.float32), 12); lf = (lf - lf.mean()) / (lf.std() + 1e-6)
g1, g2 = rng5.random(hZ.shape).astype(np.float32), rng5.random(hZ.shape).astype(np.float32)
D_ = hD * hC
fol = ss(1 - 0.6 * D_, 1 - 0.6 * D_ + 0.1, g1)
strk = fol.copy()
for k_ in range(1, 5): strk = np.maximum(strk, np.roll(fol, -k_, axis=0) * ss(0.15 * k_, 0.15 * k_ + 0.25, D_))
under = base * (1 - (D_ ** 1.1)[..., None] * np.array([0.3, 0.28, 0.22], np.float32))
sc_ = hT * (hX + 0.004 * np.sin(hY * 110 + 1.3)) + (1 - hT) * (hZ + 0.4 * (hY - HCY))  # across the strands
per = 0.003 * hT + 0.002 * (1 - hT)
streak = 0.5 + 0.5 * np.sin(2 * np.pi * sc_ / per + 2.5 * lf)
tone = np.clip(0.24 + 0.3 * streak * (0.5 + 0.5 * hT) + 0.22 * hT * (0.5 + 0.5 * hK) + 0.3 * hU + 0.07 * lf, 0, 1)
tone = tone * (1 - 0.3 * (1 - hT) * (1 - strk)) * (1 - 0.35 * hT)  # the top shell is the shadowed gaps under the clumps  # the short sides darker where the stubble is thin
H0, H1 = np.array([0.095, 0.066, 0.044], np.float32), np.array([0.37, 0.25, 0.155], np.float32)
hair_c = H0 + (H1 - H0) * tone[..., None]
a_h = hC * np.clip(np.maximum(0.6 * strk * ss(0.02, 0.4, D_), ss(0.7, 1.0, D_) * (0.7 + 0.3 * strk)), 0, 1)
a_h = np.maximum(a_h, hC * hT)
fade_c = under * (1 - a_h[..., None]) + hair_c * a_h[..., None]
hnew = base * (1 - hC[..., None]) + fade_c * hC[..., None]
orm_h[..., 1] = orm_h[..., 1] * (1 - a_h) + a_h * np.clip(0.72 + 0.1 * hT + 0.08 * (streak - 0.5), 0.4, 1)
flat_n = np.stack([0.5 + 0.08 * (g1 - 0.5), 0.5 + 0.08 * (g2 - 0.5), np.ones_like(g1)], -1)
hn = hn * (1 - a_h[..., None]) + flat_n * a_h[..., None]
# the strand swatch (round 6) for the top clumps (built with the hair mesh), in an empty corner of the head sheet:
# strands along the rows (root at the low rows, tip at the high), dark roots, sun-lightened tips, dark gaps between
Hh_, Wh_ = hc.shape; SW = (int(0.012 * Hh_), int(0.16 * Hh_), int(0.40 * Wh_), int(0.985 * Wh_))
assert (PH[SW[0] - 8:SW[1] + 8, SW[2] - 8:SW[3] + 8, 3] > 0.01).sum() == 0, 'strand swatch overlaps the head UVs'
sh_, sw_ = SW[1] - SW[0], SW[3] - SW[2]; srng = np.random.default_rng(21)
n1_ = blur(srng.random((1, sw_)).astype(np.float32), 1)[0]; n1_ = (n1_ - n1_.min()) / (np.ptp(n1_) + 1e-6)
cl_ = blur(srng.random((1, sw_)).astype(np.float32), 14)[0]; cl_ = (cl_ - cl_.mean()) / (cl_.std() + 1e-6)
rr_ = np.arange(sh_)[:, None]; cc_ = np.arange(sw_)[None, :]
F_ = n1_[(cc_ + np.round(1.6 * np.sin(rr_ * 0.021 + cc_ * 0.011)).astype(int)) % sw_]
sv_ = (rr_ + 0.5) / sh_
st_ = np.clip(0.3 + 0.5 * sv_ ** 0.8 + 0.3 * (F_ - 0.5) + 0.06 * cl_, 0, 1) * (0.7 + 0.3 * ss(0.15, 0.4, F_))
hnew[SW[0]:SW[1], SW[2]:SW[3]] = H0 + (H1 * 1.2 - H0) * st_[..., None]
gx_ = np.gradient(F_, axis=1)
hn[SW[0]:SW[1], SW[2]:SW[3]] = np.stack([np.clip(0.5 + 1.6 * gx_, 0.2, 0.8), np.full_like(F_, 0.5), np.ones_like(F_)], -1)
orm_h[SW[0]:SW[1], SW[2]:SW[3]] = np.stack([0.55 + 0.45 * np.broadcast_to(sv_, F_.shape), 0.66 + 0.14 * (1 - F_), np.zeros_like(F_)], -1)
log('haircut texels: fade', int((hC > 0.5).sum()), 'swatch rows/cols', SW)
# padding (round 6): the head sheets are grown 16 texels past their islands' edges, so mip filtering and the JPEG
# never pull the black surround into the edge texels (a dark jagged line round the neck seam)
def dilate(a, m, n=16):
    m = m.astype(np.float32).copy()
    for _ in range(n):
        num, den = blur(a * m[..., None], 1), blur(m, 1); grow = (den > 0.05) & (m < 0.5)
        a = np.where(grow[..., None], num / np.maximum(den, 1e-6)[..., None], a); m = np.maximum(m, grow.astype(np.float32))
    return a
mpad_ = hc.copy(); mpad_[SW[0]:SW[1], SW[2]:SW[3]] = True
hnew, hn, orm_h = dilate(hnew, mpad_), dilate(hn, mpad_), dilate(orm_h, mpad_)
if DBG:
    os.makedirs(DBG, exist_ok=True); save_png(half(np.stack([hC, hD * hc, hT * hc], -1)), DBG + '/hair_fields.png')
    save_png(np.stack([Wf, SK, hC], -1)[::2, ::2], DBG + '/skin_fill.png')

opac = load(TEX + 'opacity_color.tga')

if DBG:
    os.makedirs(DBG, exist_ok=True)
    save_png(half(new), DBG + '/body_albedo.png'); save_png(half(hnew), DBG + '/head_albedo.png')
    mk = np.zeros_like(col); mk[shirt] = (0.9, 0.2, 0.2); mk[shorts] = (0.8, 0.7, 0.3); mk[shoe] = (0.2, 0.3, 0.9); mk[skin] = (0.9, 0.7, 0.6)
    save_png(half(mk), DBG + '/body_masks.png')

# ------------------------------------------------------------------ materials
def material(name, colour, normal=None, orm=None, rough=None, alpha=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs['BSDF'], o.inputs['Surface'])
    c = nt.nodes.new('ShaderNodeTexImage'); c.image = colour
    nt.links.new(c.outputs['Color'], b.inputs['Base Color'])
    if alpha: nt.links.new(c.outputs['Alpha'], b.inputs['Alpha'])
    if normal:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal; nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if orm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = orm; sp = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    else:
        b.inputs['Roughness'].default_value = rough if rough is not None else 0.8
        b.inputs['Metallic'].default_value = 0.0
    return m

mats = {
    'body': material('body', new_img('player_body_color', new), new_img('player_body_normal', nrm, False), new_img('player_body_orm', half(orm_b), False)),
    'head': material('head', new_img('player_head_color', hnew), new_img('player_head_normal', half(hn), False), new_img('player_head_orm', half(orm_h), False)),
    'opacity': material('opacity', new_img('player_opacity', half(opac), alpha=True), alpha=True, rough=0.6),
}
for slot in mesh.material_slots:
    slot.material = mats[slot.material.name.split('_')[-1]]
for im in list(pos_img.values()): bpy.data.images.remove(im)

# ------------------------------------------------------------------ geometry helpers
def build(name, verts, faces, uvs):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces)
    uv = me.uv_layers.new(name=mesh.data.uv_layers[0].name)
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices): uv.data[li].uv = uvs[vi]
    me.update(); ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob

def bake_mod(ob, kind, **kw):
    md = ob.modifiers.new('m', kind)
    for k, v in kw.items(): setattr(md, k, v)
    VL.update(); dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear(); old = ob.data; ob.data = me; bpy.data.meshes.remove(old)

def tex_img(name, a): return new_img(name, a)

def weld(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6); bm.to_mesh(ob.data); bm.free()

mw = mesh.matrix_world
bverts = np.array([(mw @ v.co)[:] for v in mesh.data.vertices])
vmat = np.zeros(len(bverts), int)
for p in mesh.data.polygons:
    for vi in p.vertices: vmat[vi] = p.material_index
slot_kind = [s.material.name for s in mesh.material_slots]

# ------------------------------------------------------------------ bush hat (felt, pinched crown, wide brim, band)
hv_ = bverts[[slot_kind[k] in ('head', 'opacity') for k in vmat]]
brow = BW('Bip01 MMiddleEyebrow').z
zb_ = brow + 0.036
ring = hv_[(hv_[:, 2] > zb_ - 0.01) & (hv_[:, 2] < zb_ + 0.07)]
cy = (ring[:, 1].min() + ring[:, 1].max()) / 2
rx, ry = np.abs(ring[:, 0]).max() + 0.013, np.abs(ring[:, 1] - cy).max() + 0.013
top = hv_[:, 2].max()
NA = 48
HS = max(0.11, top - zb_ + 0.035)
verts, faces, uvs = [], [], []
def ell(a, sc): return (rx * sc * math.sin(a), cy - ry * sc * math.cos(a))  # a = 0 at the front (-Y)
# crown: side rings then a cap to the centre, with a centre crease and front pinch
TAPER = 0.15  # the crown narrows towards the top, walls to 80 % of the height, then a rounded, creased top
prof = [(p / 9, 1 - TAPER * p / 9, zb_ + 0.8 * HS * p / 9) for p in range(10)] + \
       [(1 + k / 6, (1 - TAPER) * math.cos(k / 6 * math.pi / 2) ** 0.8, zb_ + 0.8 * HS + (0.2 * HS + 0.012) * math.sin(k / 6 * math.pi / 2)) for k in range(1, 7)]
for ri, (p, sc, z) in enumerate(prof):
    for i in range(NA + 1):
        a = 2 * math.pi * i / NA + math.pi
        x, y = ell(a, sc)
        lat = abs(math.sin(a))
        if p > 0.5:
            w = min(1, (p - 0.5) / 0.9)
            pinch = math.exp(-(((a + math.pi) % (2 * math.pi) - math.pi) / 0.55) ** 2) * w
            x *= 1 - 0.2 * pinch
            # round 5: the crease was `z -= ...` on the ring's own z, so it piled up point by point round each ring
            # and the crown's top spiralled down into the head (open crown, seen from above and down his back)
            if p > 1: zz = z - 0.03 * (p - 1) ** 0.5 * max(0, 1 - lat * sc / 0.6) ** 2
        verts.append((x, y, zz if p > 1 else z)); uvs.append((i / NA, 0.5 * ri / (len(prof) - 1)))
C = NA + 1
for r in range(len(prof) - 1):
    for i in range(NA): faces.append((r * C + i, r * C + i + 1, (r + 1) * C + i + 1, (r + 1) * C + i))
crown = build('crown', verts, faces, uvs); weld(crown)
# brim
verts, faces, uvs = [], [], []
B = 0.088
for k in range(7):
    f = k / 6
    for i in range(NA + 1):
        a = 2 * math.pi * i / NA + math.pi
        x, y = ell(a, 1.0)
        nx, ny = math.sin(a) / rx, -math.cos(a) / ry; nl = math.hypot(nx, ny); nx, ny = nx / nl, ny / nl
        z = zb_ - 0.002 + f * f * (0.032 * math.sin(a) ** 2 - 0.012 * math.cos(a) ** 2)
        verts.append((x + nx * B * f, y + ny * B * f, z)); uvs.append((i / NA, 0.5 + 0.4 * f))
for r in range(6):
    for i in range(NA): faces.append((r * C + i, (r + 1) * C + i, (r + 1) * C + i + 1, r * C + i + 1))
brim = build('brim', verts, faces, uvs); weld(brim)
bake_mod(brim, 'SOLIDIFY', thickness=0.0045, offset=-1.0, use_rim=True)
# band
verts, faces, uvs = [], [], []
for k, (dz, sc) in enumerate(((0.0, 1.004), (0.033, 1.004 - TAPER * 0.033 / (0.8 * HS)))):
    for i in range(NA + 1):
        a = 2 * math.pi * i / NA + math.pi; x, y = ell(a, sc + 0.02 / max(rx, ry))
        verts.append((x, y, zb_ + dz)); uvs.append((i / NA, 0.92 + 0.07 * k))
for i in range(NA): faces.append((i, i + 1, C + i + 1, C + i))
band = build('band', verts, faces, uvs); weld(band)
# sweatband (round 4): under the brim the crown's fawn lining showed as a thin tan ring and the hair just below the
# brim line caught the sky as a blue-grey strip. A dark leather band inside the crown, 8 mm in from its wall, from 12 mm
# above the brim line to 12 mm below it, closes that gap (on the band's dark grosgrain texels). It is not in HAT_PTS, so
# the get-up keys (which tilt the hat off the ground by its points) are unchanged.
verts, faces, uvs = [], [], []
SWI = 0.008
for k, dz in enumerate((0.012, -0.012)):
    for i in range(NA + 1):
        a = 2 * math.pi * i / NA + math.pi; x, y = ell(a, 1.0)
        x *= 1 - SWI / rx; y = cy + (y - cy) * (1 - SWI / ry)
        verts.append((x, y, zb_ + dz)); uvs.append((i / NA, 0.93 + 0.05 * k))
for i in range(NA): faces.append((i, i + 1, C + i + 1, C + i))
sweatband = build('sweatband', verts, faces, uvs); weld(sweatband)
bake_mod(sweatband, 'SOLIDIFY', thickness=0.002, offset=0.0, use_rim=True)
inside = hv_[hv_[:, 2] > zb_]
def crown_r(z): return 1 - TAPER * np.clip((z - zb_) / (0.8 * HS), 0, 1)
out = ((inside[:, 0] / (rx * crown_r(inside[:, 2]))) ** 2 + ((inside[:, 1] - cy) / (ry * crown_r(inside[:, 2]))) ** 2) > 1
log('hat brim z', round(zb_, 3), 'crown radii', round(rx, 3), round(ry, 3), 'head verts outside crown', int(out.sum()), 'above top', int((inside[:, 2] > zb_ + HS + 0.005).sum()))
# hat texture: felt (fawn), weathering, grosgrain band
rng = np.random.default_rng(11)
T = 1024
vv, uu = np.mgrid[0:T, 0:T] / T
felt = np.array([0.56, 0.42, 0.27], np.float32)
mott = blur(rng.random((T, T)).astype(np.float32), 24); mott = (mott - mott.mean()) / (mott.std() + 1e-6)
fine = rng.random((T, T)).astype(np.float32) - 0.5
ht = felt * (1 + 0.05 * mott + 0.03 * fine)[..., None]
sweat = ss(0.0, 0.12, 0.12 - vv) * (vv < 0.5)  # crown near the band
ht *= (1 - 0.18 * sweat)[..., None]
brimz = (vv >= 0.5) & (vv < 0.9)
ht[brimz] *= (1 - 0.16 * ss(0.8, 0.9, vv[brimz]))[:, None]
bandz = vv >= 0.9
ht[bandz] = np.array([0.2, 0.13, 0.08]) * (0.85 + 0.15 * (np.sin(vv[bandz] * T * 1.3) > 0))[:, None]
hat_mat = material('hat', tex_img('player_hat', ht), rough=0.92)

# ------------------------------------------------------------------ clogs (ventilated, heel strap), skinned to the feet
clog_col = np.array([0.33, 0.36, 0.22], np.float32)
ct = np.ones((T, T, 3), np.float32) * clog_col * (1 + 0.03 * (rng.random((T, T)) - 0.5))[..., None]
au = np.abs(2 * uu - 1)  # 0 = sole centre, 1 = top centre
def holes(cu, cv, ru, rv):
    d = np.sqrt(((au - cu) / ru) ** 2 + ((vv - cv) / rv) ** 2)
    ct[d < 1.25] *= 1.12; ct[d < 1.0] = clog_col * 0.18
for ri, cv in enumerate((0.62, 0.71, 0.8)):
    for cu in ((1.0, 0.86, 0.72) if ri % 2 == 0 else (0.93, 0.79)):
        holes(cu, cv, 0.03, 0.017)
for cv in (0.5, 0.55, 0.6):
    holes(0.52, cv, 0.03, 0.01)
ct[(au > 0.27) & (au < 0.3)] *= 0.72  # sole line
ct[au < 0.27] *= 0.9
clog_mat = material('clogs', tex_img('player_clogs', ct), rough=0.55)

vg = {}  # body vertex weights for the transfer
for v in mesh.data.vertices: vg[v.index] = [(mesh.vertex_groups[g.group].name, g.weight) for g in v.groups if g.weight > 0.001]
clogs = []
for sd, nm in ((1, 'L'), (-1, 'R')):
    fv = bverts[(bverts[:, 2] < z_shoe + 0.02) & (bverts[:, 0] * sd > 0.02) & (np.abs(bverts[:, 0]) < 0.3)]
    c2 = fv[:, :2] - fv[:, :2].mean(0); w_, e_ = np.linalg.eigh(c2.T @ c2); fwd = e_[:, 1]
    if fwd[1] > 0: fwd = -fwd
    lat = np.array([-fwd[1], fwd[0]])
    along = fv[:, :2] @ fwd; side = fv[:, :2] @ lat
    t0, t1 = along.min() - 0.02, along.max() + 0.012; Lc = t1 - t0; lc = (side.max() + side.min()) / 2
    tb = (along - t0) / Lc
    def shoe_w(t): m = np.abs(tb - t) < 0.05; return (np.abs(side[m] - lc).max() * 2 if m.sum() > 2 else 0.0)
    def shoe_h(t): m = np.abs(tb - t) < 0.05; return (fv[m, 2].max() if m.sum() > 2 else 0.0)
    NT, NU, TOP = 20, 22, 0.52
    verts, faces, uvs = [], [], []
    for i in range(NT + 1):
        t = i / NT
        e = 1.0
        if t > 0.78: e = math.sqrt(max(0.0, 1 - ((t - 0.78) / 0.22) ** 2))
        if t < 0.1: e = math.sqrt(max(0.0, 1 - ((0.1 - t) / 0.1) ** 2))
        wd = max(0.08 + 0.026 * math.sin(math.pi * min(t / 0.72, 1) * 0.5), shoe_w(t) + 0.02) * max(e, 0.0)
        ht_ = (0.058 if t < 0.2 else max(0.06 + 0.022 * ss(0.2, 0.45, t) - 0.03 * ss(0.6, 1.0, t), shoe_h(t) + 0.008 if t > TOP else 0)) * (max(e, 0.9) if t < 0.5 else max(e, 0.25 if t < 1 else 0))  # full heel-cup wall at the back
        A = math.pi
        if t < TOP:  # heel cup: open top, wall height rising towards the vamp
            wall = 0.05 + 0.016 * ss(0.3, TOP, t)
            q_ = 1 - 2 * min(wall, ht_) / max(ht_, 1e-4)
            A = math.acos(max(-1.0, min(1.0, math.copysign(abs(q_) ** 1.6, q_))))
        for j in range(NU + 1):
            uu_ = -1 + 2 * j / NU; a = uu_ * A
            n = 2.6 if math.cos(a) < 0 else 5.0  # rounded upper, boxy sole
            s_, c_ = math.sin(a), math.cos(a)
            lx = wd / 2 * math.copysign(abs(s_) ** (2 / n), s_)
            z = ht_ / 2 - ht_ / 2 * math.copysign(abs(c_) ** (2 / n), c_)
            p = fwd * (t0 + t * Lc) + lat * (lc + lx)
            verts.append((p[0], p[1], z)); uvs.append(((uu_ * A / math.pi + 1) / 2, t))
    for i in range(NT):
        for j in range(NU): faces.append((i * (NU + 1) + j, i * (NU + 1) + j + 1, (i + 1) * (NU + 1) + j + 1, (i + 1) * (NU + 1) + j))
    ob = build(f'clog{nm}', verts, faces, uvs)
    weld(ob)
    bake_mod(ob, 'SOLIDIFY', thickness=0.005, offset=0.0, use_rim=True)
    # heel strap: a ribbon from pivot to pivot around the back of the heel
    tp = 0.36; wp = max(0.08 + 0.026 * math.sin(math.pi * tp / 0.72 * 0.5), shoe_w(tp) + 0.02) / 2 + 0.006
    back = 0.004 + (tp * Lc)
    verts, faces, uvs = [], [], []
    NS = 24
    for k in range(NS + 1):
        ph = math.pi * k / NS
        lx = wp * math.cos(ph); dd = t0 + tp * Lc - back * math.sin(ph); zc = 0.045 + 0.028 * math.sin(ph)
        radial = np.array([math.cos(ph) * lat[0] - math.sin(ph) * fwd[0], math.cos(ph) * lat[1] - math.sin(ph) * fwd[1]])
        base = fwd * dd + lat * (lc + lx)
        for (ro, zo) in ((0, -0.01), (0.004, -0.01), (0.004, 0.01), (0, 0.01)):
            q = base + radial * ro; verts.append((q[0], q[1], zc + zo)); uvs.append((0.02, 0.01))
    for k in range(NS):
        for s in range(4): faces.append((k * 4 + s, k * 4 + (s + 1) % 4, (k + 1) * 4 + (s + 1) % 4, (k + 1) * 4 + s))
    st = build(f'strap{nm}', verts, faces, uvs)
    # weights: inverse distance of the 4 nearest body vertices on this foot
    idx = np.where((bverts[:, 2] < 0.25) & (bverts[:, 0] * sd > 0.0))[0]
    kd = KDTree(len(idx))
    for n_, i_ in enumerate(idx): kd.insert(bverts[i_], n_)
    kd.balance()
    for o_ in (ob, st):
        for v in o_.data.vertices:
            acc = {}
            for (co, n_, dist) in kd.find_n(v.co, 4):
                w8 = 1 / max(dist, 1e-4)
                for g, wt in vg[idx[n_]]: acc[g] = acc.get(g, 0) + wt * w8
            tot = sum(acc.values())
            for g, wt in acc.items():
                gg = o_.vertex_groups.get(g) or o_.vertex_groups.new(name=g); gg.add([v.index], wt / tot, 'REPLACE')
        o_.data.materials.append(clog_mat)
    clogs += [ob, st]
    log('clog', nm, 'length', round(Lc, 3), 'tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'strap', len(st.data.polygons) * 2)
# round 5, the hat down his back (T_REST, rest pose, world): the reference shot had it standing off the back of his head
# on a rigid tether. Now it lies on the shoulder blades: crown out along the back's normal, brim front up at the neck,
# held off the skin by the most any body vertex under the brim stands proud of the fitted back plane, plus the brim's dip
NK_, S2_ = BW('Bip01 Neck'), BW('Bip01 Spine2')
reg_ = bverts[(np.abs(bverts[:, 0]) < 0.13) & (bverts[:, 2] > NK_.z - 0.36) & (bverts[:, 2] < NK_.z - 0.02) & (bverts[:, 1] > S2_.y)]
top_ = {}
for p_ in reg_:
    k_ = (round(p_[2] / 0.01), round(p_[0] / 0.02))
    if k_ not in top_ or p_[1] > top_[k_][1]: top_[k_] = p_
P_ = np.array(list(top_.values())); (a0_, b0_), *_ = np.linalg.lstsq(np.c_[np.ones(len(P_)), P_[:, 2]], P_[:, 1], rcond=None)
NB, UB = Vector((0, 1, -b0_)).normalized(), Vector((0, b0_, 1)).normalized()
XB = (-UB).cross(NB)
R_ = Matrix((XB, -UB, NB)).transposed().to_4x4()
H0_ = Vector((0, cy, zb_)); RB_ = (rx + 0.088, ry + 0.088)
z0_ = NK_.z - 0.035 - UB.z * RB_[1]
PP_ = Vector((0, a0_ + b0_ * z0_, z0_))
d_ = bverts - np.array(PP_[:]); lx_, ly_, lz_ = d_ @ np.array(XB[:]), d_ @ np.array(UB[:]), d_ @ np.array(NB[:])
foot_ = ((lx_ / RB_[0]) ** 2 + (ly_ / RB_[1]) ** 2 < 1.0) & (lz_ > -0.1)
PROT = float(lz_[foot_].max()) if foot_.any() else 0.0
HAT_OFF = max(PROT, 0.0) + 0.012 + 0.008
T_REST = Matrix.Translation(PP_ + NB * HAT_OFF) @ R_ @ Matrix.Translation(-H0_)
ZTH = NK_.z + 0.028  # the throat, where the cord loops round the neck
sl_ = bverts[(np.abs(bverts[:, 2] - ZTH) < 0.006) & (np.abs(bverts[:, 0]) < 0.09)]
NYC, NRY, NRX = float((sl_[:, 1].min() + sl_[:, 1].max()) / 2), float((sl_[:, 1].max() - sl_[:, 1].min()) / 2), float(np.abs(sl_[:, 0]).max())
log('hat on back: back slope', round(b0_, 3), 'proud', round(PROT, 4), 'offset', round(HAT_OFF, 4), 'brim top z', round(NK_.z - 0.035, 3),
    'neck at throat y r', round(NYC, 3), round(NRY, 3), round(NRX, 3))
# the hat has its own joint under the head, pivoting at the back of the band: in the water it tips back off his
# head onto its chin cord and hangs at the nape (the swim clips key it; on land it stays at rest, on the head)
[o.select_set(False) for o in scene.objects]; arm.select_set(True); VL.objects.active = arm
rest_ = {b.name: (b.matrix_local.copy(), b.length) for b in arm.data.bones}
bpy.ops.object.mode_set(mode='EDIT')
IMW_, piv_ = arm.matrix_world.inverted(), Vector((0.0, cy + ry, zb_))
eb_ = arm.data.edit_bones.new('Hat'); eb_.head = IMW_ @ piv_; eb_.tail = IMW_ @ (piv_ + Vector((0, 0, 0.12)))
eb_.parent = arm.data.edit_bones['Bip01 Head']; eb_.use_deform = True
# round 5: the chin cord's neck part has its own joint (under the head, so the hood cam folds it away with the head);
# the game pins it to Spine2 while the hat is down his back and folds it into the crown while the hat is on
ec_ = arm.data.edit_bones.new('HatCord'); ec_.head = IMW_ @ Vector((0, NYC, ZTH)); ec_.tail = IMW_ @ Vector((0, NYC, ZTH + 0.05))
ec_.parent = arm.data.edit_bones['Bip01 Head']; ec_.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT'); arm.select_set(False)
log('hat bone: bones lost', [n for n in rest_ if n not in arm.data.bones],
    'rest changed', [(b.name, round(rest_[b.name][1], 4)) for b in arm.data.bones if b.name in rest_ and
                     max(abs(x - y) for r1, r2 in zip(b.matrix_local, rest_[b.name][0]) for x, y in zip(r1, r2)) > 1e-4][:20])
for o_ in (crown, brim, band, sweatband):  # nothing of the hat hangs below the brim: drop stray vertices (they showed once it moved)
    bm_ = bmesh.new(); bm_.from_mesh(o_.data)
    junk_ = [v for v in bm_.verts if (o_.matrix_world @ v.co).z < zb_ - 0.04]
    if junk_: log('hat stray verts', o_.name, len(junk_), 'lowest z', round(min((o_.matrix_world @ v.co).z for v in junk_), 3))
    bmesh.ops.delete(bm_, geom=junk_, context='VERTS'); bm_.to_mesh(o_.data); bm_.free()
    g = o_.vertex_groups.new(name='Hat'); g.add(list(range(len(o_.data.vertices))), 1.0, 'REPLACE')
    o_.data.materials.append(hat_mat)
# the hat in rest world space (every vertex): the get-up keys tilt the hat back on its joint while it would dig in
HAT_PTS = [o_.matrix_world @ v.co for o_ in (crown, brim, band) for v in o_.data.vertices]
# ------------------------------------------------------------------ haircut mesh (round 5): the fade's volume
# the Rocketbox hair cards go (opacity faces above the brows or behind the eyes; the eyelashes stay). After the hat is
# sized, so the hat and HAT_PTS (the get-up keys) are unchanged.
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
OPI = [i for i, s in enumerate(mesh.material_slots) if s.material and s.material.name == 'opacity']
HDI = [i for i, s in enumerate(mesh.material_slots) if s.material and s.material.name == 'head']
mwi_ = mw.inverted()
bm_ = bmesh.new(); bm_.from_mesh(mesh.data)
cards_ = [f for f in bm_.faces if f.material_index in OPI and ((mw @ f.calc_center_median()).z > brow + 0.02 or (mw @ f.calc_center_median()).y > cy - 0.5 * ry
                                                           or abs((mw @ f.calc_center_median()).x) > 0.05)]  # round 6: + the two temple wisps (the dark triangles)
log('hair cards removed', len(cards_), 'of', sum(f.material_index in OPI for f in bm_.faces))
bmesh.ops.delete(bm_, geom=cards_, context='FACES'); bm_.to_mesh(mesh.data); bm_.free(); mesh.data.update()
# the cap: the scalp faces, subdivided, pushed out along the normal by the length field, tucked under the skin past
# the line-up and down in the fade (the same texels show through, so the edge has no seam), clamped 3.5 mm inside the
# crown, band and sweatband so nothing pokes through the hat
src_ = [(mw @ v.co, [(g.group, g.weight) for g in v.groups]) for v in mesh.data.vertices]
hsel_ = set(vi for p in mesh.data.polygons if p.material_index in HDI for vi in p.vertices)
kd_ = KDTree(len(hsel_))
for vi in hsel_: kd_.insert(src_[vi][0], vi)
kd_.balance()
hb_ = bmesh.new(); hb_.from_mesh(mesh.data)
P0h = np.array([(mw @ v.co)[:] for v in hb_.verts]); Cv_, _, _, _ = hair_fields(P0h[:, 0], P0h[:, 1], P0h[:, 2])
keep_ = (Cv_ > 0.01) & (P0h[:, 2] > brow - 0.075)
drop_ = [f for f in hb_.faces if f.material_index not in HDI or not any(keep_[v.index] for v in f.verts)]
bmesh.ops.delete(hb_, geom=drop_, context='FACES')
bmesh.ops.subdivide_edges(hb_, edges=hb_.edges[:], cuts=4, use_grid_fill=True, smooth=1.0)
hb_.normal_update()
hat_bvh = BVHTree.FromObject(crown, bpy.context.evaluated_depsgraph_get()), BVHTree.FromObject(band, bpy.context.evaluated_depsgraph_get()), \
    BVHTree.FromObject(sweatband, bpy.context.evaluated_depsgraph_get())
Ph_ = np.array([(mw @ v.co)[:] for v in hb_.verts]); Nh_ = np.array([(mw.to_3x3() @ v.normal).normalized()[:] for v in hb_.verts])
C_, D_, T_, K_ = hair_fields(Ph_[:, 0], Ph_[:, 1], Ph_[:, 2]); h_ = Ph_[:, 2] - brow
side_t = (0.0015 + 0.0045 * ss(-0.03, 0.045, h_)) * (0.35 + 0.65 * ss(EAR[1] - 0.026, EAR[1], Ph_[:, 1]))  # thin at the temple line-up
top_t = 0.0042 * (1 + 0.25 * K_) * (0.35 + 0.65 * ss(0.05, 0.1, h_))  # round 6: a thin base under the clumps, it hides the scalp
t_ = (side_t * (1 - T_) + top_t * T_) * ss(0.25, 0.75, D_)
t_ = t_ * C_ - 0.0025 * (1 - C_)
t_ = np.where(t_ < 0.0007, t_ - 0.0025 * (1 - ss(0.0, 0.0007, t_)), t_)
clamped_ = 0
for i_ in range(len(t_)):
    if t_[i_] <= 0: continue
    o_, n_ = Vector(Ph_[i_]), Vector(Nh_[i_])
    for bv_ in hat_bvh:
        hit_ = bv_.ray_cast(o_, n_, t_[i_] + 0.004)
        if hit_[0] is not None and hit_[3] - 0.0035 < t_[i_]: t_[i_] = max(0.0004, hit_[3] - 0.0035); clamped_ += 1
dl_ = hb_.verts.layers.deform.verify()
for i_, v in enumerate(hb_.verts):
    v.co = mwi_ @ Vector(Ph_[i_] + Nh_[i_] * t_[i_])
    acc_ = {}
    for (co_, vi_, dd_) in kd_.find_n(Vector(Ph_[i_]), 3):
        for g_, w8 in src_[vi_][1]: acc_[g_] = acc_.get(g_, 0) + w8 / max(dd_, 1e-4)
    tot_ = sum(acc_.values()); v[dl_].clear()
    for g_, w8 in sorted(acc_.items(), key=lambda kv: -kv[1])[:4]: v[dl_][g_] = w8 / tot_
bmesh.ops.delete(hb_, geom=[f for f in hb_.faces if all(t_[v.index] < 0 for v in f.verts)], context='FACES')
# round 6, the top as clumps of strands. The shell above was a smooth dome ("a clay helmet with a shelf"); it is now
# 3-5 mm (it hides the scalp) and the length is ~260 tapered clumps, 3-5 cm, combed forward from a crown whorl and
# lifting towards the front: they overlap, leave gaps, break the silhouette and end in kan irregular front edge. Each
# clump is walked over the scalp in steps (projected onto it, lifted by its own arc), stops at the hairline or where the
# top gives way to the fade, carries a strip of the strand swatch (dark roots, sun-lightened tips) and is clamped
# 3.5 mm inside the crown, band and sweatband like the shell. All on Bip01 Head.
kvw_ = [mw @ kv.co for kv in mesh.data.vertices]
kscalp_ = BVHTree.FromPolygons(kvw_, [tuple(p.vertices) for p in mesh.data.polygons if p.material_index in HDI])
krng = np.random.default_rng(17)
kcand = np.flatnonzero((T_ > 0.3) & (C_ > 0.6) & (D_ > 0.6)); krng.shuffle(kcand)
kroots = np.zeros((0, 3)); kidx = []
for i_ in kcand:
    if len(kidx) and (((kroots - Ph_[i_]) ** 2).sum(1) < 0.0052 ** 2).any(): continue
    kidx.append(i_); kroots = np.vstack([kroots, Ph_[i_]])
    if len(kidx) >= 380: break
kuv = hb_.loops.layers.uv.values(); kdl = hb_.verts.layers.deform.verify(); khg = mesh.vertex_groups['Bip01 Head'].index
KU = ((SW[2] + 16) / Wh_, (SW[3] - 16) / Wh_); KV = ((SW[0] + 12) / Hh_, (SW[1] - 12) / Hh_)
KW = Vector((0.0, HCY + 0.45 * HRY, zBr + 0.12)); KS = 5; kn = kcl = 0; klen = []
def kfield(q):
    kc_, kd_, kt__, _ = hair_fields(np.array([q[0]]), np.array([q[1]]), np.array([q[2]])); return float(kc_[0]), float(kt__[0])
for i_ in kidx:
    kR, kN, kT0, kth = Vector(Ph_[i_]), Vector(Nh_[i_]), float(T_[i_]), max(float(t_[i_]), 0.0)
    kfr = float(ss(HCY + 0.2 * HRY, HCY - 0.8 * HRY, kR.y))  # 1 at the front of the top
    kd = (kR - KW).normalized() * (1 - 0.8 * kfr) + Vector((0, -1, 0)) * (0.3 + 0.9 * kfr)
    kd = Matrix.Rotation(krng.uniform(-0.45, 0.45), 3, kN) @ kd; kd = (kd - kN * kd.dot(kN)).normalized()
    kL = krng.uniform(0.03, 0.05) * (0.55 + 0.45 * kT0) * (0.8 + 0.2 * kfr)
    kA = (krng.uniform(0.003, 0.008) + 0.006 * kfr) * (0.3 + 0.7 * kT0)
    kw0 = krng.uniform(0.005, 0.009); ktw = krng.uniform(-0.8, 0.8)
    ku0 = krng.uniform(KU[0], KU[1] - 0.013); kdu = 0.008 + 0.004 * krng.random()
    kpts, knrm, kpos = [], [], Vector(kR)
    for k_ in range(KS + 1):
        ks_ = k_ / KS
        kloc, knr, _, _ = kscalp_.find_nearest(kpos)
        if kloc is None: break
        if k_ > 1:
            kc_, kt__ = kfield(kloc)
            if kc_ < 0.5 or kt__ < 0.15: break
        khg_ = kth * 0.6 + kA * (1 - (1 - ks_) ** 2); ktk_ = 0.4 * kw0 * (1 - ks_ ** 1.6)
        for bv_ in hat_bvh:
            hit_ = bv_.ray_cast(kloc, knr, khg_ + ktk_ + 0.006)
            if hit_[0] is not None and hit_[3] - 0.0035 < khg_ + ktk_: khg_ = max(0.0006, hit_[3] - 0.0035 - ktk_); kcl += 1
        kpts.append(kloc + knr * khg_); knrm.append(knr)
        kd = (kd - knr * kd.dot(knr)).normalized(); kpos = kloc + kd * (kL / KS)
    km_ = len(kpts)
    if km_ < 3: continue
    krings = []
    for k_ in range(km_):
        ks_ = k_ / (km_ - 1); kP = kpts[k_]
        ktg = (kpts[min(k_ + 1, km_ - 1)] - kpts[max(k_ - 1, 0)]).normalized()
        kup = (knrm[k_] - ktg * knrm[k_].dot(ktg)).normalized(); kbn = ktg.cross(kup)
        kan = ktw * ks_; kbb = kbn * math.cos(kan) + kup * math.sin(kan); kuu = kup * math.cos(kan) - kbn * math.sin(kan)
        if k_ == km_ - 1: kring = [hb_.verts.new(mwi_ @ (kP + ktg * 0.002))]  # the tip
        else:
            kw_ = kw0 * (1 - 0.85 * ks_ ** 1.5); ktk_ = 0.4 * kw0 * (1 - ks_ ** 1.6)
            kring = [hb_.verts.new(mwi_ @ (kP + ko_)) for ko_ in (kbb * (kw_ / 2), kuu * ktk_, -kbb * (kw_ / 2), -kuu * (0.35 * ktk_))]
        for kv in kring: kv[kdl][khg] = 1.0
        krings.append(kring)
    for k_ in range(km_ - 1):
        ra, rb = krings[k_], krings[k_ + 1]
        for j_ in range(4):
            kj2 = (j_ + 1) % 4
            if len(rb) == 1: kfv, kfuv = (ra[j_], rb[0], ra[kj2]), ((j_, k_), (j_ + 0.5, k_ + 1), (j_ + 1, k_))
            else: kfv, kfuv = (ra[j_], rb[j_], rb[kj2], ra[kj2]), ((j_, k_), (j_, k_ + 1), (j_ + 1, k_ + 1), (j_ + 1, k_))
            fc_ = hb_.faces.new(kfv); fc_.material_index = HDI[0]; fc_.smooth = True
            for lp_, (uj, vk) in zip(fc_.loops, kfuv):
                for ul_ in kuv: lp_[ul_].uv = (ku0 + kdu * uj / 4, KV[0] + (KV[1] - KV[0]) * (0.55 + 0.45 * kfr) * vk / (km_ - 1))  # sun-lightened tips at the front only
    kn += 1; klen.append((kpts[-1] - kpts[0]).length)
log('hair clumps', kn, 'of', len(kidx), 'roots; length mm mean/max', round(1000 * float(np.mean(klen)), 1), round(1000 * float(np.max(klen)), 1),
    'hat clamps', kcl)
hme_ = bpy.data.meshes.new('hair'); hb_.to_mesh(hme_); hb_.free()
hair_ob = bpy.data.objects.new('hair', hme_); scene.collection.objects.link(hair_ob); hair_ob.matrix_world = mw.copy()
for g_ in mesh.vertex_groups: hair_ob.vertex_groups.new(name=g_.name)
for s_ in mesh.material_slots: hme_.materials.append(s_.material)
for p in hme_.polygons: p.use_smooth = True
log('hair cap verts', len(hme_.vertices), 'tris', sum(len(p.vertices) - 2 for p in hme_.polygons), 'top mm max/mean',
    round(1000 * float(t_.max()), 1), round(1000 * float(t_[(T_ > 0.9) & (t_ > 0)].mean()), 1) if ((T_ > 0.9) & (t_ > 0)).any() else 0,
    'side mm', round(1000 * float(t_[(T_ < 0.1) & (t_ > 0) & (D_ > 0.9)].mean()), 1) if ((T_ < 0.1) & (t_ > 0) & (D_ > 0.9)).any() else 0,
    'clamped by the hat', clamped_)
# the chin cord (round 5), in its down-the-back shape: from inside the crown at the sweatband (hidden between brim and
# back), up under the brim's top edge, over the trapezius, round the neck to a loose loop at the throat with a toggle
# bead. The last 12 mm at each end ride the Hat joint (rest = T_REST inverse, so on the head they sit behind the
# sweatband); the rest rides HatCord. Pushed 6 mm off the skin.
bvb_ = BVHTree.FromPolygons([src_[i][0] for i in range(len(src_))], [p.vertices[:] for p in mesh.data.polygons])
def off_skin(q, gap=0.006):
    loc_, nrm_, _, dd_ = bvb_.find_nearest(q)
    if loc_ is not None and (q - loc_).dot(nrm_) < gap: q = loc_ + nrm_ * gap
    return q
TI_ = T_REST.inverted()
def cord_side(s):
    A_ = T_REST @ Vector((s * (rx - 0.012), cy, zb_ - 0.004))
    ring = []
    for k in range(13):
        ph = math.radians(110) * (12 - k) / 12  # back of the neck (110 deg) round to the throat (0)
        sag = -0.018 * max(0.0, 1 - math.degrees(ph) / 60) ** 2 - 0.02 * math.degrees(ph) / 110
        ring.append(Vector((s * (NRX + 0.007) * math.sin(ph), NYC - (NRY + 0.007) * math.cos(ph), ZTH + sag)))
    E_ = ring[0]; n_ = max(2, int((A_ - E_).length / 0.01))
    down = [A_.lerp(E_, j / n_) for j in range(n_)]
    pts = down + ring
    for _ in range(4):
        pts = [pts[0]] + [(pts[j - 1] + pts[j] * 2 + pts[j + 1]) / 4 for j in range(1, len(pts) - 1)] + [pts[-1]]
        pts = [pts[0]] + [off_skin(q) for q in pts[1:]]
    return pts
cl_, cr_ = cord_side(1), cord_side(-1)
path_ = cl_ + cr_[::-1][1:]
arc_ = [0.0]
for j in range(1, len(path_)): arc_.append(arc_[-1] + (path_[j] - path_[j - 1]).length)
L_ = arc_[-1]
cv_, cf_, cw_ = [], [], []
nrm_ = (path_[1] - path_[0]).orthogonal().normalized()
SID = 6
for j, p in enumerate(path_):
    tg_ = (path_[min(j + 1, len(path_) - 1)] - path_[max(j - 1, 0)]).normalized()
    nrm_ = (nrm_ - tg_ * nrm_.dot(tg_)).normalized(); bn_ = tg_.cross(nrm_)
    on_hat = arc_[j] < 0.012 or arc_[j] > L_ - 0.012
    for k in range(SID):
        a_ = 2 * math.pi * k / SID; q = p + (nrm_ * math.cos(a_) + bn_ * math.sin(a_)) * 0.0017
        cv_.append(TI_ @ q if on_hat else q); cw_.append('Hat' if on_hat else 'HatCord')
    if j: cf_ += [((j - 1) * SID + k, (j - 1) * SID + (k + 1) % SID, j * SID + (k + 1) % SID, j * SID + k) for k in range(SID)]
b0i = len(cv_); bc_ = path_[len(cl_) - 1] + Vector((0, -0.002, 0.004))  # the toggle bead on both strands at the throat
for i in range(7):
    th_ = math.pi * i / 6
    for k in range(8):
        a_ = 2 * math.pi * k / 8
        cv_.append(bc_ + Vector((0.0042 * math.sin(th_) * math.cos(a_), 0.0042 * math.sin(th_) * math.sin(a_), 0.0062 * math.cos(th_)))); cw_.append('HatCord')
for i in range(6): cf_ += [(b0i + i * 8 + k, b0i + i * 8 + (k + 1) % 8, b0i + (i + 1) * 8 + (k + 1) % 8, b0i + (i + 1) * 8 + k) for k in range(8)]
cord = build('cord', cv_, cf_, [(0.5, 0.955)] * len(cv_))  # world, like the hat; no weld (indices carry the groups)
for gname in ('Hat', 'HatCord'):
    g = cord.vertex_groups.new(name=gname)
    g.add([i for i, w in enumerate(cw_) if w == gname and i < len(cord.data.vertices)], 1.0, 'REPLACE')
cord.data.materials.append(hat_mat)
log('chin cord length m', round(L_, 3), 'verts', len(cord.data.vertices), 'throat', [round(c, 3) for c in bc_])
with bpy.context.temp_override(active_object=mesh, object=mesh, selected_objects=[mesh, crown, brim, band, sweatband, hair_ob, cord] + clogs,
                               selected_editable_objects=[mesh, crown, brim, band, sweatband, hair_ob, cord] + clogs):
    bpy.ops.object.join()
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
log('mesh tris', tris, 'verts', len(mesh.data.vertices), 'materials', [s.material.name for s in mesh.material_slots])

# ------------------------------------------------------------------ clips
names_ = [b.name for b in arm.data.bones]
def rest_leg(a_obj):  # thigh + shin bone lengths in world metres (pose invariant)
    VL.update(); mwld = a_obj.matrix_world; P = lambda n: mwld @ a_obj.pose.bones[n].head
    return (P('Bip01 L Calf') - P('Bip01 L Thigh')).length + (P('Bip01 L Foot') - P('Bip01 L Calf')).length
LEG = rest_leg(arm)
TOE_REST = BW('Bip01 L Toe0').z

def track(a_obj, bones, f0, f1):
    out = {n: [] for n in bones}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        for n in bones: out[n].append((a_obj.matrix_world @ a_obj.pose.bones[n].head)[:])
    return {n: np.array(v) for n, v in out.items()}

def contact_speed(tr, fwd2):
    """speed of the pelvis relative to the planted toe, along the travel direction, over stance frames"""
    rel, slip = [], []
    for nm in ('L', 'R'):
        toe = tr[f'Bip01 {nm} Toe0']; pel = tr['Bip01 Pelvis']
        st = np.where(toe[:, 2] < toe[:, 2].min() + 0.012)[0]
        st = st[(st > 0) & (st < len(toe) - 1)]
        for f in st:
            rel.append(((pel[f + 1] - toe[f + 1]) - (pel[f - 1] - toe[f - 1]))[:2] @ fwd2 * FPS / 2)
            slip.append(np.linalg.norm((toe[f + 1] - toe[f - 1])[:2]) * FPS / 2)
    return (float(np.median(rel)) if rel else 0.0), (float(np.median(slip)) if slip else 0.0)

def load_clip(path):
    new_ = import_fbx(path)
    a_arm = next((o for o in new_ if o.type == 'ARMATURE'), None)
    act = a_arm.animation_data.action
    return new_, a_arm, act, int(act.frame_range[0]), int(act.frame_range[1])

def drop(new_, act):
    for o in new_:
        data = o.data; bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Armature): bpy.data.armatures.remove(data)
    if act and act.name in bpy.data.actions: bpy.data.actions.remove(act)

TR = ['Bip01 Pelvis', 'Bip01 L Toe0', 'Bip01 R Toe0', 'Bip01 L Foot', 'Bip01 R Foot']
measured = {}
chosen = {}
for clip, (cands, target) in LOCO.items():
    best = None
    for c in cands:
        new_, a_arm, act, f0, f1 = load_clip(XY + c + '.max.fbx')
        s = LEG / rest_leg(a_arm)
        tr = track(a_arm, TR, f0, f1)
        disp = (tr['Bip01 Pelvis'][-1] - tr['Bip01 Pelvis'][0])[:2]
        v_root = np.linalg.norm(disp) / ((f1 - f0) / FPS) * s
        vc, slip = contact_speed(tr, disp / np.linalg.norm(disp))
        measured[c] = dict(root=round(v_root, 3), contact=round(vc * s, 3), slip=round(slip * s, 3), frames=f1 - f0, scale=round(s, 4))
        log('clip', c, measured[c])
        score = abs(v_root - target) + 2 * slip * s  # near the target speed, little foot slip in the source
        measured[c]['score'] = round(score, 3)
        if best is None or score < measured[best]['score']: best = c
        drop(new_, act)
    chosen[clip] = best
log('chosen', chosen)

arm.animation_data_create()
def retarget(name, path, loco):
    new_, a_arm, act, f0, f1 = load_clip(path)
    s = LEG / rest_leg(a_arm)
    mover = bpy.data.objects.new('mover', None); scene.collection.objects.link(mover)
    a_arm.parent = mover
    tr = track(a_arm, TR, f0, f1)
    pel = tr['Bip01 Pelvis']
    th = 0.0
    if loco:
        d = pel[-1] - pel[0]; th = math.atan2(-1, 0) - math.atan2(d[1], d[0])
    R = np.array(Matrix.Rotation(th, 3, 'Z')) * s
    toes = np.concatenate([tr['Bip01 L Toe0'], tr['Bip01 R Toe0']]) @ R.T
    pel_s = pel @ R.T
    gz = TOE_REST - toes[:, 2].min()
    n = len(pel)
    if loco:
        lin = pel_s[0, :2] + (pel_s[-1, :2] - pel_s[0, :2]) * (np.arange(n) / (n - 1))[:, None]
        off = -lin - (pel_s[:, :2] - lin).mean(0)
    else:
        feet = (tr['Bip01 L Toe0'] + tr['Bip01 R Toe0']) / 2 @ R.T
        off = np.repeat(-feet[:, :2].mean(0)[None], n, 0)
    mover.rotation_euler = (0, 0, th); mover.scale = (s, s, s)
    for i, f in enumerate(range(f0, f1 + 1)):
        mover.location = (off[i, 0], off[i, 1], gz); mover.keyframe_insert('location', frame=f)
    cons = []
    for pb in arm.pose.bones:
        if pb.name not in a_arm.pose.bones: continue
        c = pb.constraints.new('COPY_ROTATION'); c.target = a_arm; c.subtarget = pb.name
        c.owner_space = 'WORLD'; c.target_space = 'WORLD'; cons.append(c)
        if pb.name == 'Bip01 Pelvis':
            c2 = pb.constraints.new('COPY_LOCATION'); c2.target = a_arm; c2.subtarget = pb.name
            c2.owner_space = 'WORLD'; c2.target_space = 'WORLD'
    arm.animation_data.action = None
    t1 = track(arm, TR, f0, f1)
    dz = TOE_REST - min(t1['Bip01 L Toe0'][:, 2].min(), t1['Bip01 R Toe0'][:, 2].min())
    for i, f in enumerate(range(f0, f1 + 1)):
        mover.location = (off[i, 0], off[i, 1], gz + dz); mover.keyframe_insert('location', frame=f)
    VL.update(); [o.select_set(False) for o in scene.objects]
    arm.select_set(True); VL.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=True, visual_keying=True, clear_constraints=True,
                     use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    baked = arm.animation_data.action; baked.name = name; baked.use_fake_user = True
    mact = mover.animation_data.action if mover.animation_data else None
    drop(new_, act); bpy.data.objects.remove(mover, do_unlink=True)
    if mact: bpy.data.actions.remove(mact)
    # verify on the avatar: ground contact and in-place stance slip (= the clip's ground speed)
    t2 = track(arm, TR, f0, f1)
    vc, slip = contact_speed(t2, np.array([0.0, -1.0]))
    info = dict(frames=f1 - f0, toe_min=round(float(min(t2['Bip01 L Toe0'][:, 2].min(), t2['Bip01 R Toe0'][:, 2].min())), 4),
                pelvis_xy_drift=round(float(np.linalg.norm((t2['Bip01 Pelvis'][-1] - t2['Bip01 Pelvis'][0])[:2])), 4),
                stance_slip=round(slip, 3), contact=round(vc, 3), ground_fix=round(dz, 4))
    arm.animation_data.action = None
    push(name, baked, f0)
    log('baked', name, os.path.basename(path), info)
    return f0, f1, info

def push(name, action, f0):
    tr_ = arm.animation_data.nla_tracks.new(); tr_.name = name
    st = tr_.strips.new(name, f0, action)
    if hasattr(st, 'action_slot') and action.slots: st.action_slot = action.slots[0]
    tr_.mute = True

clipinfo = {}
f0, f1, clipinfo['idle'] = retarget('idle', ST + IDLE + '.max.fbx', False)
for clip in ('walk', 'run', 'sprint'):
    _, _, clipinfo[clip] = retarget(clip, XY + chosen[clip] + '.max.fbx', True)

# ------------------------------------------------------------------ jump clips, keyframed on the idle's first pose
idle_act = bpy.data.actions['idle']
arm.animation_data.action = idle_act
if hasattr(arm.animation_data, 'action_slot') and idle_act.slots: arm.animation_data.action_slot = idle_act.slots[0]
scene.frame_set(f0); VL.update()
base = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
arm.animation_data.action = None
AXX, AXY = Vector((1, 0, 0)), Vector((0, 1, 0))
IM = arm.matrix_world.inverted()

def rotw(n, axis, deg):
    if not deg: return
    pb = arm.pose.bones[n]; VL.update()
    Mw = arm.matrix_world @ pb.matrix; h = Mw.translation.copy()
    pb.matrix = IM @ (Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-h) @ Mw)
    VL.update()

def pose(dz=0, spine=0, head=0, th=(0, 0), ca=(0, 0), ft=(0, 0), arms=(0, 0), fore=(0, 0), spread=(0, 0)):
    for pb in arm.pose.bones: pb.matrix_basis = base[pb.name]
    VL.update()
    pb = arm.pose.bones['Bip01 Pelvis']; Mw = arm.matrix_world @ pb.matrix; Mw.translation.z += dz; pb.matrix = IM @ Mw; VL.update()
    for n, k in (('Bip01 Spine', 0.4), ('Bip01 Spine1', 0.3), ('Bip01 Spine2', 0.3)): rotw(n, AXX, spine * k)
    rotw('Bip01 Head', AXX, head)
    for i, s_ in enumerate('LR'):
        rotw(f'Bip01 {s_} Thigh', AXX, th[i] - spine * 0.4)
        rotw(f'Bip01 {s_} Calf', AXX, ca[i]); rotw(f'Bip01 {s_} Foot', AXX, ft[i])
        rotw(f'Bip01 {s_} UpperArm', AXX, arms[i]); rotw(f'Bip01 {s_} UpperArm', AXY, -spread[i] if s_ == 'L' else spread[i])
        rotw(f'Bip01 {s_} Forearm', AXX, fore[i])

def key(f):
    for pb in arm.pose.bones:
        pb.keyframe_insert('location', frame=f, group=pb.name)
        pb.keyframe_insert('rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler', frame=f, group=pb.name)

def crouch(dz, a, spine, head, arms, fore, spread=(0, 0)):
    return dict(dz=dz, spine=spine, head=head, th=(-a, -a), ca=(2 * a, 2 * a), ft=(-a, -a), arms=arms, fore=fore, spread=spread)

JUMPS = {
    'jump_start': [(0, {}), (5, crouch(-0.13, 34, 22, -12, (35, 35), (-20, -20))),
                   (10, dict(dz=0.03, spine=6, head=-4, th=(-4, -4), ca=(6, 6), ft=(28, 28), arms=(-50, -50), fore=(-35, -35), spread=(12, 12)))],
    'jump_loop': [(0, dict(spine=10, head=-6, th=(-45, -28), ca=(70, 48), ft=(10, 15), arms=(-20, -15), fore=(-45, -40), spread=(35, 38))),
                  (12, dict(spine=10, head=-6, th=(-30, -42), ca=(50, 66), ft=(15, 10), arms=(-15, -20), fore=(-40, -45), spread=(38, 35))),
                  (24, dict(spine=10, head=-6, th=(-45, -28), ca=(70, 48), ft=(10, 15), arms=(-20, -15), fore=(-45, -40), spread=(35, 38)))],
    'jump_land': [(0, dict(spine=8, th=(-22, -22), ca=(28, 28), ft=(10, 10), arms=(-20, -20), fore=(-40, -40), spread=(35, 35))),
                  (4, crouch(-0.15, 37, 26, -14, (-25, -25), (-40, -40), (20, 20))),
                  (9, crouch(-0.06, 20, 12, -6, (-5, -5), (-20, -20), (8, 8))), (15, {})],
}
for name, keys in JUMPS.items():
    arm.animation_data.action = None
    for f, kw in keys:
        pose(**kw); key(f)
    act = arm.animation_data.action; act.name = name; act.use_fake_user = True
    arm.animation_data.action = None
    push(name, act, 0)
    log('keyed', name, keys[-1][0], 'frames')

# ------------------------------------------------------------------ get-up clips (the ragdoll hands over to these)
# Same base pose and pose() angles as the jumps (+ leans forward, thighs - swing forward, calves + bend the knee,
# feet + point the toes, arms - raise forward). Then the whole body is pitched about the hips (pitch: + onto the
# belly, - onto the back) and each key is snapped down so its lowest contact just touches the ground: back, hips,
# head, knees, elbows and hands by their flesh, the feet by their height in the idle. py pins the hips along the
# facing (m behind where he ends up standing); plant pins those feet where the idle stands them. Each clip ends on
# the idle's first pose. getup_back: sit up, tuck the legs, right hand on the ground, stand. getup_belly: push up,
# onto hands and knees, kneel up, left foot forward, stand.
def BJ(n): return arm.matrix_world @ arm.pose.bones[n].head
pose(); VL.update()
FOOT0 = {s_: BJ(f'Bip01 {s_} Foot').copy() for s_ in 'LR'}; PEL0 = BJ('Bip01 Pelvis').copy()
CONTACT = [('Bip01 Pelvis', 0.12), ('Bip01 Spine2', 0.12), ('Bip01 Head', 0.1)]
for s_ in 'LR':
    CONTACT += [(f'Bip01 {s_} Calf', 0.06), (f'Bip01 {s_} Forearm', 0.045), (f'Bip01 {s_} Hand', 0.04),
                (f'Bip01 {s_} Foot', FOOT0[s_].z), (f'Bip01 {s_} Toe0', BJ(f'Bip01 {s_} Toe0').z)]
log('getup contacts', {n: round(r, 3) for n, r in CONTACT})

HAT_I0, HAT_CLEAR, HAT_TILTS = None, 0.02, []
def hat_low():  # the lowest point of the hat, world z (the ground is z = 0)
    global HAT_I0
    if HAT_I0 is None: HAT_I0 = (arm.matrix_world @ arm.data.bones['Hat'].matrix_local).inverted()
    M = arm.matrix_world @ arm.pose.bones['Hat'].matrix @ HAT_I0
    return min((M @ p).z for p in HAT_PTS)

def gpose(pitch=0, py=None, plant='', hat=False, **kw):
    if hat:  # lying down the brim would cut into the ground. First the head: face down (hat=1) lift the face a little
        # more, on his back (hat=-1) tuck the chin a little; then tip the hat on its joint (pivot at the back of the
        # band), face down back, as a hat pushed up off the forehead, on his back forward over the eyes: the least of
        # both that clears the ground
        for hx in (0, 5, 10, 15, 20):
            dz = gpose(pitch, py, plant, **{**kw, 'head': kw.get('head', 0) - hx * hat})
            hb = arm.pose.bones['Hat']; b0 = hb.matrix_basis.copy(); low0 = hat_low()
            for a in range(0, 31, 3):
                hb.matrix_basis = b0; VL.update(); rotw('Hat', AXX, -a * hat)
                if hat_low() >= HAT_CLEAR: break
            if hat_low() >= HAT_CLEAR: break
        HAT_TILTS.append((round(low0, 3), hx, a, round(hat_low(), 3)))
        return dz
    pose(**kw)
    if pitch: rotw('Bip01 Pelvis', AXX, pitch)
    dy = PEL0.y + py - BJ('Bip01 Pelvis').y if py is not None else \
        sum(FOOT0[s_].y - BJ(f'Bip01 {s_} Foot').y for s_ in plant) / len(plant) if plant else 0.0
    dz = -min(BJ(n).z - r for n, r in CONTACT)
    pb = arm.pose.bones['Bip01 Pelvis']; Mw = arm.matrix_world @ pb.matrix
    Mw.translation.y += dy; Mw.translation.z += dz; pb.matrix = IM @ Mw; VL.update()
    return round(dz, 3)

GETUPS = {
    'getup_back': [
        (0, dict(hat=-1, pitch=-88, py=0.42, head=-4, th=(-2, -2), ca=(6, 4), ft=(15, 15), arms=(10, 10), fore=(-20, -15), spread=(18, 18))),
        (4, dict(hat=-1, pitch=-65, py=0.42, spine=5, head=15, th=(-25, -25), ca=(8, 8), ft=(15, 15), arms=(45, 45), fore=(-70, -70), spread=(20, 20))),
        (8, dict(hat=-1, pitch=-45, py=0.42, spine=10, head=12, th=(-45, -45), ca=(10, 12), ft=(15, 15), arms=(70, 70), fore=(-5, -5), spread=(15, 15))),
        (16, dict(hat=-1, pitch=-15, py=0.42, spine=20, head=5, th=(-105, -100), ca=(140, 125), ft=(-20, -10), arms=(-65, 20), fore=(-30, -5), spread=(10, 20))),
        (24, dict(hat=-1, plant='LR', spine=35, head=-18, th=(-70, -70), ca=(140, 140), ft=(-70, -70), arms=(-105, -55), fore=(-20, -10), spread=(10, 15))),
        (32, dict(hat=-1, plant='LR', **crouch(0, 35, 18, -8, (-40, -30), (-30, -25)))),
        (42, dict(hat=-1, plant='LR'))],
    'getup_belly': [
        (0, dict(hat=True, pitch=88, py=0.0, head=-25, th=(4, 4), ca=(8, 5), ft=(40, 40), arms=(25, 25), fore=(-140, -140), spread=(35, 35))),
        # the push-up and the knees coming under: between the keys the hands swept down through the ground (5.5 cm
        # at frames 4 to 8) and the right shin at 13 to 15, so these in-betweens hold the palms and knees on it
        (3, dict(hat=True, pitch=80, py=0.015, spine=-3, head=-24, th=(12, 12), ca=(8, 6), ft=(40, 40), arms=(0, 0), fore=(-105, -105), spread=(28, 28))),
        (6, dict(hat=True, pitch=67, py=0.035, spine=-7, head=-22, th=(22, 22), ca=(8, 7), ft=(40, 40), arms=(-28, -28), fore=(-45, -45), spread=(18, 18))),
        (9, dict(hat=True, pitch=55, py=0.05, spine=-10, head=-20, th=(30, 30), ca=(8, 8), ft=(40, 40), arms=(-50, -50), fore=(-5, -5), spread=(12, 12))),
        (14, dict(hat=True, pitch=68, py=0.24, spine=-2, head=-30, th=(-25, -25), ca=(50, 50), ft=(48, 48), arms=(-68, -68), fore=(-5, -5), spread=(10, 10))),
        (18, dict(hat=True, pitch=80, py=0.43, spine=5, head=-40, th=(-80, -80), ca=(90, 90), ft=(55, 55), arms=(-85, -85), fore=(-5, -5), spread=(8, 8))),
        (27, dict(hat=True, py=0.43, spine=5, th=(0, 0), ca=(90, 90), ft=(55, 55), arms=(-10, -10), fore=(-30, -30), spread=(10, 10))),
        (31, dict(hat=True, py=0.43, spine=10, head=-3, th=(-70, 5), ca=(140, 90), ft=(40, 50), arms=(-40, -15), fore=(-25, -30), spread=(8, 10))),
        (36, dict(hat=True, plant='L', spine=15, head=-5, th=(-95, 10), ca=(95, 90), ft=(0, 45), arms=(-60, -20), fore=(-20, -30), spread=(8, 10))),
        (44, dict(hat=True, plant='L', spine=12, head=-4, th=(-40, -5), ca=(50, 70), ft=(-10, 0), arms=(-30, -20), fore=(-30, -30), spread=(8, 8))),
        (49, dict(hat=True, plant='L', spine=5, th=(-15, -5), ca=(20, 25), ft=(-5, -20), arms=(-15, -10), fore=(-25, -25), spread=(8, 8))),
        (56, dict(hat=True, plant='LR'))],
}
for name, keys in GETUPS.items():
    arm.animation_data.action = None
    dzs = []
    for f, kw in keys:
        dzs.append(gpose(**kw)); key(f)
    act = arm.animation_data.action; act.name = name; act.use_fake_user = True
    arm.animation_data.action = None
    push(name, act, 0)
    log('keyed', name, keys[-1][0], 'frames, snap dz', dzs)
    if HAT_TILTS: log('hat tilt', name, '(lowest before, head nudge deg, hat tilt deg, lowest after)', HAT_TILTS); HAT_TILTS.clear()
# the game lifts the whole body while a knee, ankle, toe or wrist dips under these margins (Ragdoll.js lowNodes):
# report each clip's worst dip per frame so the keys can be kept clear of it
MARGIN = [(f'Bip01 {s_} {n}', h) for s_ in 'LR' for n, h in (('Calf', 0.06), ('Foot', 0.08), ('Toe0', 0.003), ('Hand', 0.04))]
for name, keys in GETUPS.items():
    act = bpy.data.actions[name]; arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and act.slots: arm.animation_data.action_slot = act.slots[0]
    dips = []
    for f in range(0, keys[-1][0] + 1):
        scene.frame_set(f); VL.update()
        d, n = min((BJ(n).z - h, n) for n, h in MARGIN)
        if d < -0.01: dips.append((f, n.replace('Bip01 ', ''), round(d, 3)))   # anything past 1 cm
        hz = hat_low()
        if hz < 0.0: dips.append((f, 'Hat', round(hz, 3)))
    arm.animation_data.action = None
    log('getup dips', name, 'worst', min((x[2] for x in dips), default=0), dips[:24])

# ------------------------------------------------------------------ swim clips, keyframed on the same base pose
# Drawn upright like the jumps: head up (+Z), belly to -Y (glTF +Z), his left at +X. The game pitches the whole
# body towards horizontal by speed (extras swim.pitch), so in `swim` and `swim_under` "up" is the way he swims
# and "front" is the pool floor. Limbs are placed by two-bone IK with an elbow / knee pole; each upper bone is
# given its full rotation (bone axis + the side its lower bone folds towards, from the idle), so elbows and
# knees only ever bend the human way. Hands take a palm direction (60 % of the twist in the forearm).
UP, FR = Vector((0, 0, 1)), Vector((0, -1, 0))
BK = -FR
PB = arm.pose.bones
SX = {'L': 1.0 if BW('Bip01 L UpperArm').x > 0 else -1.0}; SX['R'] = -SX['L']
OUTV = {s: Vector((SX[s], 0, 0)) for s in 'LR'}

def J(n): return arm.matrix_world @ PB[n].head
def frame_w(n): return (arm.matrix_world @ PB[n].matrix).to_3x3().normalized()
def rotm(n, R):
    if n not in PB: return
    pb = PB[n]; VL.update()
    Mw = arm.matrix_world @ pb.matrix; h = Mw.translation.copy()
    pb.matrix = IM @ (Matrix.Translation(h) @ R.to_4x4() @ Matrix.Translation(-h) @ Mw); VL.update()
def spin(n, axis, deg):
    if deg: rotm(n, Matrix.Rotation(math.radians(deg), 3, Vector(axis).normalized()))
def aim(n, to, d):
    VL.update(); rotm(n, (J(to) - J(n)).normalized().rotation_difference(Vector(d).normalized()).to_matrix())
def basis(a, f):
    a = Vector(a).normalized(); f = Vector(f); f = (f - a * f.dot(a)).normalized()
    return Matrix((a, f, a.cross(f))).transposed()
def dirv(*terms): return sum((Vector(v) * k for v, k in terms), Vector()).normalized()

for pb in PB: pb.matrix_basis = base[pb.name]
VL.update()
LIMB, HAND = {}, {}
for s in 'LR':
    for kind, (u_, l_, e_, fold) in {'arm': ('UpperArm', 'Forearm', 'Hand', FR), 'leg': ('Thigh', 'Calf', 'Foot', BK)}.items():
        un, ln, en = (f'Bip01 {s} {x}' for x in (u_, l_, e_))
        R = frame_w(un).transposed(); a = (J(ln) - J(un)).normalized()
        LIMB[s, kind] = (un, ln, en, R @ a, R @ (fold - a * fold.dot(a)), (J(ln) - J(un)).length, (J(en) - J(ln)).length)
    hn = f'Bip01 {s} Hand'
    fg = next(f'Bip01 {s} Finger{i}' for i in (2, 1, 3, 4) if f'Bip01 {s} Finger{i}' in PB)
    fd = (J(fg) - J(hn)).normalized(); med = -OUTV[s]; R = frame_w(hn).transposed()
    HAND[s] = (hn, R @ fd, R @ (med - fd * med.dot(fd)))
log('swim limbs', {f'{k[0]}{k[1]}': (round(v[5], 3), round(v[6], 3)) for k, v in LIMB.items()},
    'twist bones', [b.name for b in PB if 'Twist' in b.name][:6])

def limb(s, kind, target, pole):
    un, ln, en, al, fl, A, B = LIMB[s, kind]
    S = J(un); d = Vector(target) - S; dn = d.normalized()
    L = min(max(d.length, abs(A - B) + 0.03), (A + B) * 0.998)
    x = (A * A - B * B + L * L) / (2 * L); y = math.sqrt(max(A * A - x * x, 0.0))
    pn = Vector(pole); pn = (pn - dn * pn.dot(dn)).normalized()
    E = S + dn * x + pn * y; H = S + dn * L
    u = (E - S).normalized(); fold = (H - E) - u * (H - E).dot(u)
    if fold.length < 1e-3: fold = -(pn - u * pn.dot(u))
    rotm(un, basis(u, fold) @ basis(al, fl).transposed() @ frame_w(un).transposed())
    aim(ln, en, H - J(ln))

def hand(s, palm, fingers=None, share=0.6):
    un, ln, en = LIMB[s, 'arm'][:3]; hn, fl, pl = HAND[s]
    ax = (J(en) - J(ln)).normalized(); palm = Vector(palm).normalized()
    cur = frame_w(hn) @ pl; cur = (cur - ax * cur.dot(ax)); want = (palm - ax * palm.dot(ax))
    if cur.length > 1e-4 and want.length > 1e-4:
        cur.normalize(); want.normalize()
        spin(ln, ax, math.degrees(math.atan2(cur.cross(want).dot(ax), cur.dot(want))) * share)
    fingers = Vector(fingers).normalized() if fingers is not None else ax
    rotm(hn, basis(fingers, palm) @ basis(fl, pl).transposed() @ frame_w(hn).transposed())

def leg(s, dt_, ds_, df_):  # thigh, shin and foot directions
    aim(f'Bip01 {s} Thigh', f'Bip01 {s} Calf', dt_); aim(f'Bip01 {s} Calf', f'Bip01 {s} Foot', ds_)
    aim(f'Bip01 {s} Foot', f'Bip01 {s} Toe0', df_)

def sag(a):  # a direction in the sagittal plane, `a` degrees from straight down towards the front
    r = math.radians(a); return -UP * math.cos(r) + FR * math.sin(r)

def loop(pts, ph):  # periodic Catmull-Rom through [(phase, value)], phase in [0, 1)
    n = len(pts); ph %= 1.0
    i = max(k for k in range(n) if pts[k][0] <= ph) if ph >= pts[0][0] else n - 1
    p0, p1 = pts[i][0], pts[(i + 1) % n][0] + (1.0 if i == n - 1 else 0.0)
    t = ((ph if ph >= p0 else ph + 1.0) - p0) / (p1 - p0)
    a, b, c, d = (Vector(pts[(i + k) % n][1]) for k in (-1, 0, 1, 2))
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)

def body(s, o, u, f, R=Matrix.Identity(3)): return R @ (OUTV[s] * o + UP * u + FR * f)
def wrapd(a, b): d = (a - b) % 1.0; return d - 1.0 if d > 0.5 else d
def reset():
    for pb in PB: pb.matrix_basis = base[pb.name]
    VL.update()
def roll_body(deg, pelvis=0.55):  # about the long axis; the chest takes the rest
    spin('Bip01 Pelvis', UP, deg * pelvis)
    for n in ('Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2'): spin(n, UP, deg * (1 - pelvis) / 3)
def lean(deg):
    for n, k in (('Bip01 Spine', 0.4), ('Bip01 Spine1', 0.3), ('Bip01 Spine2', 0.3)): spin(n, AXX, deg * k)

# front crawl: one arm's path from the hand's entry (out, up, front of the shoulder, metres), elbow pole, palm
CRAWL = [(0.00, (0.05, 0.46, 0.14)), (0.12, (0.04, 0.58, 0.07)), (0.25, (0.07, 0.36, 0.31)), (0.38, (-0.07, 0.04, 0.31)),
         (0.50, (0.05, -0.40, 0.16)), (0.58, (0.07, -0.49, 0.03)), (0.70, (0.16, -0.26, -0.12)), (0.85, (0.24, 0.08, -0.10)),
         (0.95, (0.16, 0.34, -0.04))]
CRAWL_POLE = [(0.00, (0.6, 0.0, -0.8)), (0.25, (0.8, 0.3, -0.5)), (0.38, (1.0, 0.0, -0.2)), (0.50, (0.3, 0.0, -1.0)),
              (0.70, (0.4, 0.1, -1.0)), (0.85, (0.5, 0.2, -1.0))]
CRAWL_PALM = [(0.00, (0.5, 0.0, 0.8)), (0.12, (0.1, 0.0, 1.0)), (0.25, (0.0, -0.6, 0.4)), (0.38, (0.0, -1.0, 0.1)),
              (0.50, (0.0, -0.7, -0.3)), (0.58, (-1.0, -0.2, 0.0)), (0.75, (-0.8, 0.0, -0.3)), (0.92, (0.4, 0.0, 0.5))]
CYCLE = 40  # frames per arm cycle (1.33 s); the loop holds 3, breathing every third stroke, left then right
def crawl(g):  # g = loop phase in cycles, 0..3
    reset()
    ph = {'L': g % 1.0, 'R': (g + 0.5) % 1.0}
    roll = 38 * math.sin(2 * math.pi * (ph['L'] - 0.35)) * SX['L']
    breathe = {'L': math.exp(-(wrapd(g / 3, 1.62 / 3) * 3 / 0.13) ** 2), 'R': math.exp(-(wrapd(g / 3, 0.12 / 3) * 3 / 0.13) ** 2)}
    roll_body(roll)
    Rr = Matrix.Rotation(math.radians(roll), 3, UP)
    turn = -roll * 0.75 + 72 * (breathe['L'] * SX['L'] + breathe['R'] * SX['R'])
    spin('Bip01 Neck', UP, turn * 0.4); spin('Bip01 Head', UP, turn * 0.6)
    for s in 'LR':
        S = J(f'Bip01 {s} UpperArm')
        o, u, f = loop(CRAWL, ph[s]); po, pu, pf = loop(CRAWL_POLE, ph[s]); qo, qu, qf = loop(CRAWL_PALM, ph[s])
        reach = max(0.0, 1 - abs(wrapd(ph[s], 0.1)) / 0.2)  # the shoulder reaches with the arm
        spin(f'Bip01 {s} Clavicle', UP.cross(OUTV[s]), -9 * reach)
        S = J(f'Bip01 {s} UpperArm')
        limb(s, 'arm', S + body(s, o, u, f, Rr), body(s, po, pu, pf, Rr))
        hand(s, body(s, qo, qu, qf, Rr))
        k = 3 * g + (0.0 if s == 'L' else 0.5)  # six-beat flutter kick from the hip
        a_t = 9 * math.sin(2 * math.pi * k); bend = 4 + 14 * (1 + math.cos(2 * math.pi * (k + 0.2))) / 2
        Rp = Matrix.Rotation(math.radians(roll * 0.55), 3, UP)
        leg(s, Rp @ sag(a_t), Rp @ sag(a_t - bend), Rp @ sag(a_t - bend + 24))

# treading water: upright, slight lean, both hands sculling a flat figure eight, egg-beater legs
TREAD = 48
def tread(g):
    reset(); lean(7); spin('Bip01 Head', AXX, -9)
    c, sn = math.cos(2 * math.pi * g), math.sin(2 * math.pi * g)
    for s in 'LR':
        S = J(f'Bip01 {s} UpperArm')
        limb(s, 'arm', S + body(s, 0.26 + 0.10 * sn, -0.25 + 0.02 * c, 0.26 + 0.04 * math.sin(4 * math.pi * g)), body(s, 0.7, -0.2, -0.7))
        hand(s, body(s, 0.35 * c, -1.0, 0.0), body(s, 0.3, 0.0, 1.0))
        e = 2 * math.pi * (g + (0.0 if s == 'L' else 0.5)) * SX[s]
        H = J(f'Bip01 {s} Thigh')
        limb(s, 'leg', H + body(s, 0.24 + 0.09 * math.cos(e), -0.56 + 0.03 * math.sin(e), 0.08 + 0.10 * math.sin(e)), body(s, 0.5, 0.0, 0.9))
        aim(f'Bip01 {s} Foot', f'Bip01 {s} Toe0', body(s, 0.6, -0.15, 0.6))

# underwater breaststroke pull-out: arms sweep out and back to the thighs, glide, recover under the body into
# a streamline as the frog kick drives, glide
UNDER = 66
BR_HAND = [(0.00, (-0.09, 0.55, -0.02)), (0.08, (0.20, 0.48, 0.08)), (0.18, (0.30, 0.18, 0.22)), (0.26, (0.18, -0.08, 0.26)),
           (0.34, (0.04, -0.50, 0.10)), (0.46, (0.03, -0.52, 0.07)), (0.58, (-0.05, -0.14, 0.24)), (0.66, (-0.10, 0.22, 0.29)),
           (0.76, (-0.09, 0.53, 0.02)), (0.90, (-0.09, 0.55, -0.02))]
BR_POLE = [(0.00, (0.6, 0.0, -0.7)), (0.18, (0.8, 0.3, -0.4)), (0.34, (0.2, 0.0, -1.0)), (0.50, (0.3, 0.0, -1.0)),
           (0.62, (0.8, 0.0, -0.6)), (0.76, (0.6, 0.0, -0.7))]
BR_PALM = [(0.00, (0.1, 0.0, 1.0)), (0.08, (0.7, 0.0, 0.4)), (0.18, (0.3, -0.7, 0.3)), (0.26, (0.0, -1.0, 0.2)),
           (0.34, (-1.0, -0.2, 0.0)), (0.46, (-1.0, 0.0, 0.0)), (0.58, (-0.2, 0.0, -1.0)), (0.66, (-0.8, 0.0, -0.3)),
           (0.78, (-0.6, 0.0, 0.6))]
BR_FOOT = [(0.00, (-0.05, -0.95, 0.0)), (0.52, (-0.05, -0.95, 0.0)), (0.62, (0.14, -0.40, -0.12)), (0.69, (0.38, -0.60, -0.04)),
           (0.77, (-0.04, -0.95, 0.0))]
def under(g):
    reset(); spin('Bip01 Head', AXX, 6)
    for s in 'LR':
        S = J(f'Bip01 {s} UpperArm')
        limb(s, 'arm', S + body(s, *loop(BR_HAND, g)), body(s, *loop(BR_POLE, g)))
        hand(s, body(s, *loop(BR_PALM, g)))
        H = J(f'Bip01 {s} Thigh')
        rec = max(0.0, 1 - abs(wrapd(g, 0.64)) / 0.1)  # knees open and feet turn out through the kick
        limb(s, 'leg', H + body(s, *loop(BR_FOOT, g)), body(s, 0.1 + 0.6 * rec, 0.0, 1.0))
        aim(f'Bip01 {s} Foot', f'Bip01 {s} Toe0', dirv((sag(22), 1 - rec), (body(s, 0.8, -0.1, -0.2), rec * 1.2)))

# swimming, the hat hangs on its cord down his back (T_REST, built with the hat), pinned to Spine2 (not the head, which
# turns), the cord's neck part too; the game does the same live (Avatar.poseHat, extras hat) and adds lag and sway
HAT_REL = CORD_REL = None
if 'Hat' in PB and 'HatCord' in PB:
    S2R_ = arm.matrix_world @ arm.data.bones['Bip01 Spine2'].matrix_local
    HAT_REST_W = arm.matrix_world @ arm.data.bones['Hat'].matrix_local
    HAT_REL = S2R_.inverted() @ T_REST @ HAT_REST_W
    CORD_REL = S2R_.inverted() @ (arm.matrix_world @ arm.data.bones['HatCord'].matrix_local)
def hat_back():
    if HAT_REL is None: return
    S2w = arm.matrix_world @ PB['Bip01 Spine2'].matrix
    PB['Hat'].matrix = IM @ (S2w @ HAT_REL); VL.update()
    PB['HatCord'].matrix = IM @ (S2w @ CORD_REL); VL.update()
def hat_probe(name, fn, cycles, n=16):  # body vertices inside the hat (brim slab or crown) with it down his back
    if HAT_REL is None: return
    gi = {mesh.vertex_groups[g].index for g in ('Hat', 'HatCord')}
    body_i = np.array([all(g.group not in gi or g.weight < 0.5 for g in v.groups) for v in mesh.data.vertices])
    worst, gap = 0, 1.0
    for j in range(n):
        fn(cycles * j / n); hat_back()
        dg = bpy.context.evaluated_depsgraph_get(); ev = mesh.evaluated_get(dg); me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); ev.to_mesh_clear()
        co = co.reshape(-1, 3)[body_i]
        Mi = np.array(((arm.matrix_world @ PB['Hat'].matrix) @ HAT_REST_W.inverted()).inverted() @ mesh.matrix_world)
        L = co @ Mi[:3, :3].T + Mi[:3, 3]
        rr = (L[:, 0] / (rx + 0.088)) ** 2 + ((L[:, 1] - cy) / (ry + 0.088)) ** 2
        rc = (L[:, 0] / rx) ** 2 + ((L[:, 1] - cy) / ry) ** 2
        ins = ((rr < 1) & (L[:, 2] > zb_ - 0.014) & (L[:, 2] < zb_ + 0.01)) | ((rc < 1) & (L[:, 2] > zb_) & (L[:, 2] < zb_ + HS))
        worst = max(worst, int(ins.sum()))
        under_ = (rr < 1) & (L[:, 2] < zb_ - 0.014) & (L[:, 2] > zb_ - 0.12)
        if under_.any(): gap = min(gap, float((zb_ - 0.012 - L[under_, 2]).min()))
    log('hat probe', name, 'body verts inside the hat (worst frame)', worst, 'min gap under the brim mm', round(1000 * gap, 1))

def key_loop(name, frames, fn, cycles=1.0, step=2, hat=True):
    arm.animation_data.action = None; last = {}
    for f in list(range(0, frames, step)) + [frames]:
        fn(cycles * f / frames)
        if hat: hat_back()
        for pb in PB:
            q = pb.rotation_quaternion.copy()
            if pb.name in last and last[pb.name].dot(q) < 0: q.negate(); pb.rotation_quaternion = q
            last[pb.name] = q
        key(f)
    act = arm.animation_data.action; act.name = name; act.use_fake_user = True
    arm.animation_data.action = None
    push(name, act, 0)
    log('keyed', name, frames, 'frames')

key_loop('tread', TREAD, tread, hat=False)  # head and hat stay above water treading
key_loop('swim', 3 * CYCLE, crawl, cycles=3.0)
key_loop('swim_under', UNDER, under)
hat_probe('tread', tread, 1.0); hat_probe('swim', crawl, 3.0, 24); hat_probe('swim_under', under, 1.0)

# ------------------------------------------------------------------ jetski riding clips (the ski is tools/jetski/jetski_build.py)
# Drawn upright on the ski's contract geometry (public/models/jetski.json, glTF frame: +Z = the ski's and his
# front, +X = his left, Y up). In ski_sit the pelvis is on `Seat`; the wrists hold `GripL`/`GripR` (the bars
# steered +-STEER degrees in the leans), the ankles stand over `FootL`/`FootR`. The hat stays on the head.
SKI = json.load(open(os.path.join(os.path.dirname(os.path.abspath(OUT)), '..', 'jetski.json')))['points']
STEER = 25.0
def gB(p): return Vector((p[0], -p[2], p[1]))
def bG(v): return [round(float(v.x), 4), round(float(v.z), 4), round(float(-v.y), 4)]
reset()
P0 = J('Bip01 Pelvis').copy()
SEATV = Vector(SKI['Seat'])
PEL = Vector((P0.x, P0.y, SKI['Seat'][1] - SKI['FootL'][1]))  # the footwell soles are his ground (model y = 0)
WRIST, ANKLE = Vector((0.0, 0.03, -0.075)), Vector((0.0, 0.078, -0.045))  # from the grip centre / the sole point (glTF)
def ski_pt(n, steer=0.0, d=(0, 0, 0)):
    p = Vector(SKI[n])
    if steer and n.startswith('Grip'):
        pv = Vector(SKI['barsPivot']); p = pv + Matrix.Rotation(math.radians(steer), 3, 'Y') @ (p - pv)
    return PEL + gB(p + Vector(d) - SEATV)
def place_pelvis(p):
    pb = PB['Bip01 Pelvis']; Mw = arm.matrix_world @ pb.matrix; Mw.translation = p; pb.matrix = IM @ Mw; VL.update()
def ride(g, lift=0.0, fwd=0.0, lean_f=12.0, roll=0.0, steer=0.0, head=-8.0, look=0.0, bob=0.01, elbow=(0.8, -0.5, -0.25),
         knee=(0.6, 0.35, 1.0), inside=0.0):
    reset()
    b = bob * math.sin(2 * math.pi * g)
    place_pelvis(PEL + gB((0.0022 * roll, lift + b, fwd)))
    for n, k in (('Bip01 Pelvis', 0.25), ('Bip01 Spine', 0.3), ('Bip01 Spine1', 0.25), ('Bip01 Spine2', 0.2)):
        spin(n, BK, roll * k * SX['L'])
    lean(lean_f + 3 * b / max(bob, 1e-3) * (bob > 0.02))
    spin('Bip01 Neck', UP, look * 0.4 * SX['L']); spin('Bip01 Head', UP, look * 0.6 * SX['L'])
    spin('Bip01 Head', AXX, head - 0.5 * lean_f); spin('Bip01 Head', BK, -roll * 0.5 * SX['L'])
    for s in 'LR':
        sg = 1 if s == 'L' else -1
        limb(s, 'arm', ski_pt('Grip' + s, steer) + gB(WRIST), body(s, *elbow))
        hand(s, dirv((-UP, 1.0), (FR, 0.3), (-OUTV[s], 0.15)), dirv((FR, 1.0), (OUTV[s], 0.4), (-UP, 0.3)))
        up_ = inside if sg * roll > 0 else 0.0  # the inside knee comes up: heel lifts and slides back
        limb(s, 'leg', ski_pt('Foot' + s, d=(0, 0.035 * up_, -0.07 * up_)) + gB(ANKLE), body(s, knee[0], knee[1] + 0.4 * up_, knee[2]))
        aim(f'Bip01 {s} Foot', f'Bip01 {s} Toe0', dirv((FR, 1.0), (OUTV[s], 0.18), (-UP, 0.3 + 0.5 * up_)))
SKI_CLIPS = {
    'ski_sit': dict(),
    'ski_lean_l': dict(roll=17, steer=STEER, look=24, lean_f=16, inside=1.0, bob=0.006),
    'ski_lean_r': dict(roll=-17, steer=-STEER, look=-24, lean_f=16, inside=1.0, bob=0.006),
    'ski_stand': dict(lift=0.14, fwd=0.10, lean_f=42, head=-20, bob=0.03, elbow=(0.9, -0.3, -0.2), knee=(0.45, 0.2, 1.0)),
    'ski_tuck': dict(lift=0.02, fwd=-0.06, lean_f=58, head=-36, bob=0.004, elbow=(1.0, -0.1, -0.1)),
}
for name, kw in SKI_CLIPS.items():
    key_loop(name, 48, lambda g, kw=kw: ride(g, **kw), step=4, hat=False)
SKI_EXTRAS = {
    'clips': list(SKI_CLIPS), 'pelvis': bG(PEL),
    'seat': [0.0, 0.0, 0.0], **{k[0].lower() + k[1:]: bG(gB(Vector(SKI[k]) - SEATV)) for k in ('GripL', 'GripR', 'FootL', 'FootR')},
    'steerDeg': {n: kw.get('steer', 0.0) for n, kw in SKI_CLIPS.items()},
    'pelvisOffset': {n: [0.0022 * kw.get('roll', 0), kw.get('lift', 0.0), kw.get('fwd', 0.0)] for n, kw in SKI_CLIPS.items()},
    'notes': 'glTF model space, metres. pelvis = the Bip01 Pelvis position in ski_sit. seat/grip/foot = the jetski.json points '
             'minus Seat, i.e. relative to the seated pelvis in the ski frame. Pin him with model origin = Seat - pelvis (ski '
             'frame, no rotation). Leans assume the Bars node steered by steerDeg (+ = left); pelvisOffset is baked into each clip.',
    'source': 'original, keyframed in tools/characters/player.py on tools/jetski contract points',
}

# ------------------------------------------------------------------ fishing rod clips (the rod and reel are src/game/FishingRod.js)
# Upper-body overlays drawn on the idle's first pose. The game lays them over the legs (idle / walk) with the
# per-bone mask in extras rod.mask: Spine1 up and the rod arm, plus the reel arm in the crank clips. Spine (the
# thighs hang from it) is never keyed away from the idle. The rod sits in his right hand in a pistol grip on the
# reel stem: along d, the reel below it (-u), his palm to his midline. The rod's frame rides the posed hand
# (extras rod.grip: along the rod, its up side and the seat, in the frame of the hand, index and little finger
# joints), so the game takes the rod's aim from the pose. elev / side as FishingRod.js POSES: up from level,
# towards his left, radians. The reel hand holds the crank knob (FishingRod.js crank handle: axis BODY_Y along
# the rod, REEL_Z below it, arm CRANK_R, knob KNOB_X to the left); rod_reel and rod_fight are one crank turn
# from crank angle 0, played by the reel's crank angle.
SEAT_Y, BODY_Y, REEL_Z, CRANK_R, KNOB_X = 0.405, 0.327, -0.092, 0.052, -0.058
GRIP_F, GRIP_U, GRIP_X = 0.065, 0.035, -0.022  # wrist to seat: along the hand, rod up, his right
FING = {s: [[b for b in (f'Bip01 {s} Finger{i}', f'Bip01 {s} Finger{i}1', f'Bip01 {s} Finger{i}2') if b in PB] for i in range(5)]
        for s in 'LR'}
IDX = next(b for b in ('Bip01 R Finger1', 'Bip01 R Finger2') if b in PB)
PNK = next(b for b in ('Bip01 R Finger4', 'Bip01 R Finger3') if b in PB)
def rod_axes(elev, side, R=Matrix.Identity(3)):
    Rr = R @ Matrix.Rotation(side, 3, FR.cross(OUTV['L'])) @ Matrix.Rotation(elev, 3, FR.cross(UP))
    d, u = (Rr @ FR).normalized(), (Rr @ UP).normalized()
    return d, u, d.cross(u).normalized()
def curl(s, deg, thumb):
    hn, fl, pl = HAND[s]; Fh = frame_w(hn); ax = (Fh @ fl).cross(Fh @ pl).normalized()
    for i, chain in enumerate(FING[s]):
        for k, b in enumerate(chain): spin(b, ax, (thumb if i == 0 else deg) * (0.8, 1.0, 0.7)[k])
def knob(seat, d, u, x, a):
    return seat + x * KNOB_X + d * (BODY_Y - SEAT_Y - CRANK_R * math.cos(a)) + u * (REEL_Z - CRANK_R * math.sin(a))
def rod_pose(elev, side, seat, pole, yaw=0.0, bend=0.0, head=0.0, crank=None):
    reset()
    for n in ('Bip01 Spine1', 'Bip01 Spine2'): spin(n, AXX, bend * 0.5); spin(n, UP, yaw * 0.5 * SX['L'])
    spin('Bip01 Head', UP, -0.6 * yaw * SX['L']); spin('Bip01 Head', AXX, head - 0.6 * bend)
    Rt = Matrix.Rotation(math.radians(yaw * SX['L']), 3, UP) @ Matrix.Rotation(math.radians(bend), 3, AXX)
    d, u, x = rod_axes(elev, side, Rt)
    f, p = (d - 0.15 * u).normalized(), (-x + 0.15 * u).normalized()
    S = J('Bip01 R UpperArm')
    limb('R', 'arm', S + body('R', *seat, Rt) - GRIP_F * f - GRIP_U * u - GRIP_X * x, body('R', *pole, Rt))
    hand('R', p, f); curl('R', 78, 28)
    st = J('Bip01 R Hand') + GRIP_F * f + GRIP_U * u + GRIP_X * x
    if crank is not None:
        fl_ = (d - 0.2 * u).normalized()
        limb('L', 'arm', knob(st, d, u, x, crank) - 0.035 * x - 0.065 * fl_, body('L', 0.5, -0.7, -0.4, Rt))
        hand('L', x, fl_); curl('L', 50, 25)
    return st, d, u
def grip_consts(st, d, u):
    H, I, P = J('Bip01 R Hand'), J(IDX), J(PNK)
    a = ((I + P) / 2 - H).normalized(); b = I - P; b = (b - a * b.dot(a)).normalized(); n = a.cross(b)
    q = lambda v: [round(float(v.dot(a)), 5), round(float(v.dot(b)), 5), round(float(v.dot(n)), 5)]
    return dict(dir=q(d), up=q(u), seat=q(st - H), span=round(float((I - P).length), 5))
def tween(keys, t):  # smoothstep between [(frame, kwargs)], numbers and tuples
    i = max(k for k in range(len(keys)) if keys[k][0] <= t) if t > keys[0][0] else 0
    if i >= len(keys) - 1: return keys[-1][1]
    (f0_, a), (f1_, b) = keys[i], keys[i + 1]; s = ss(0.0, 1.0, (t - f0_) / (f1_ - f0_))
    mix = lambda p, q: tuple(mix(x_, y_) for x_, y_ in zip(p, q)) if isinstance(p, tuple) else p + (q - p) * s
    return {k: mix(a.get(k, 0.0), b.get(k, 0.0)) for k in a}
HOLD = dict(elev=0.46, side=0.22, seat=(-0.06, -0.30, 0.30), pole=(0.5, -0.6, -0.5))
BACK = dict(elev=2.0, side=0.12, seat=(0.05, 0.28, 0.18), pole=(0.8, -0.1, 0.55), yaw=-12.0, bend=-4.0, head=-2.0)
WINDUP = [(0, HOLD | dict(yaw=0.0, bend=0.0, head=0.0)),
          (6, dict(elev=1.2, side=0.18, seat=(0.0, -0.05, 0.32), pole=(0.7, -0.4, 0.2), yaw=-6.0, bend=-2.0, head=-1.0)),
          (14, BACK), (18, BACK)]
CAST = [(0, BACK), (3, dict(elev=1.35, side=0.1, seat=(0.02, 0.26, 0.34), pole=(0.8, -0.2, 0.5), yaw=-4.0, bend=0.0, head=-1.0)),
        (6, dict(elev=0.25, side=0.06, seat=(-0.05, 0.03, 0.5), pole=(0.6, -0.5, 0.1), yaw=8.0, bend=6.0, head=-4.0)),
        (12, dict(elev=0.22, side=0.02, seat=(-0.08, -0.08, 0.48), pole=(0.5, -0.6, -0.1), yaw=6.0, bend=4.0, head=-3.0)),
        (18, dict(elev=0.22, side=0.02, seat=(-0.08, -0.08, 0.48), pole=(0.5, -0.6, -0.1), yaw=6.0, bend=4.0, head=-3.0))]
REEL = dict(elev=0.4, side=0.18, seat=(-0.06, -0.28, 0.32), pole=(0.5, -0.6, -0.5))
FIGHT = dict(elev=0.9, side=0.12, seat=(-0.05, -0.22, 0.24), pole=(0.5, -0.6, -0.4), bend=-10.0, head=-6.0)
GRIPS = []
def rod_hold(g):
    kw = dict(HOLD); kw['seat'] = (HOLD['seat'][0], HOLD['seat'][1] + 0.008 * math.sin(2 * math.pi * g), HOLD['seat'][2])
    GRIPS.append(grip_consts(*rod_pose(**kw)))
key_loop('rod_hold', 60, rod_hold, step=10, hat=False)
key_loop('rod_windup', 18, lambda g: GRIPS.append(grip_consts(*rod_pose(**tween(WINDUP, g * 18)))), step=2, hat=False)
key_loop('rod_cast', 18, lambda g: GRIPS.append(grip_consts(*rod_pose(**tween(CAST, g * 18)))), step=1, hat=False)
key_loop('rod_reel', 24, lambda g: GRIPS.append(grip_consts(*rod_pose(**REEL, crank=2 * math.pi * g))), step=2, hat=False)
key_loop('rod_fight', 24, lambda g: GRIPS.append(grip_consts(*rod_pose(**FIGHT, crank=2 * math.pi * g))), step=2, hat=False)
spread = max(max(abs(g_[k][i] - GRIPS[0][k][i]) for k in ('dir', 'up', 'seat') for i in range(3)) for g_ in GRIPS)
log('rod grip', GRIPS[0], 'max spread over', len(GRIPS), 'keys', round(spread, 5), 'fingers', FING['R'])
def arm_chain(s): c = PB[f'Bip01 {s} Clavicle']; return [c.name] + [b.name for b in c.children_recursive]
ROD_EXTRAS = {
    'clips': ['rod_hold', 'rod_windup', 'rod_cast', 'rod_reel', 'rod_fight'], 'loop': ['rod_hold', 'rod_reel', 'rod_fight'],
    'crank': ['rod_reel', 'rod_fight'],
    'mask': {'upper': {'Bip01 Spine1': 0.6, 'Bip01 Spine2': 0.85, 'Bip01 Neck': 0.7, 'Bip01 Head': 0.7, **{b: 1.0 for b in arm_chain('R')}},
             'reelHand': {b: 1.0 for b in arm_chain('L')}},
    'grip': {'hand': 'Bip01 R Hand', 'index': IDX, 'pinky': PNK, **GRIPS[0]},
    'notes': 'upper-body overlays: blend each clip over the playing pose per bone by mask.upper (and mask.reelHand in the crank '
             'clips). The crank clips are one turn of the reel handle from crank angle 0 (FishingRod.js crank). grip: with a = hand '
             'to the index / little finger joints midpoint, b = little to index finger across it, n = a x b, the rod runs along '
             'dir, its up side (away from the reel) is up and its seat (SEAT_Y on the rod) is at hand + seat, in (a, b, n) '
             'components, metres at span = |index - little|.',
    'source': 'original, keyframed in tools/characters/player.py on the FishingRod.js reel geometry',
}
reset()
for pb in arm.pose.bones: pb.matrix_basis = Matrix()
for a in list(bpy.data.actions):
    if not a.use_fake_user: bpy.data.actions.remove(a)

# ------------------------------------------------------------------ export + extras
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=86,
    export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_optimize_animation_size=True, export_def_bones=False,
    export_morph=False, export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
)

def seg(a, b): return round(float((BW(b) - BW(a)).length), 3)
def cap(bone, to, r, cone, twist, hinge=None, parent=None):
    d = dict(bone=bone, to=to, radius=r, length=seg(bone, to) if to else 0.2, cone=cone, twist=twist, parent=parent)
    if hinge: d['hinge'] = hinge
    return d
rag = [cap('Bip01 Pelvis', 'Bip01 Spine', 0.13, 0, 0), cap('Bip01 Spine', 'Bip01 Spine2', 0.12, 30, 20, parent='Bip01 Pelvis'),
       cap('Bip01 Spine2', 'Bip01 Neck', 0.14, 25, 20, parent='Bip01 Spine'), cap('Bip01 Head', None, 0.1, 45, 60, parent='Bip01 Spine2')]
rag[-1]['length'] = 0.14
for s_ in 'LR':
    rag += [cap(f'Bip01 {s_} UpperArm', f'Bip01 {s_} Forearm', 0.05, 85, 70, parent='Bip01 Spine2'),
            cap(f'Bip01 {s_} Forearm', f'Bip01 {s_} Hand', 0.04, 5, 80, hinge=[0, 145], parent=f'Bip01 {s_} UpperArm'),
            cap(f'Bip01 {s_} Thigh', f'Bip01 {s_} Calf', 0.075, 70, 30, parent='Bip01 Pelvis'),
            cap(f'Bip01 {s_} Calf', f'Bip01 {s_} Foot', 0.055, 5, 10, hinge=[0, 140], parent=f'Bip01 {s_} Thigh'),
            cap(f'Bip01 {s_} Foot', f'Bip01 {s_} Toe0', 0.045, 30, 10, parent=f'Bip01 {s_} Calf')]
speeds = {'idle': 0.0}
for c in ('walk', 'run', 'sprint'): speeds[c] = clipinfo[c]['stance_slip']  # planted-foot speed of the in-place clip
extras = {
    'clipSpeeds': speeds,
    'bones': {'head': 'Bip01 Head', 'neck': 'Bip01 Neck', 'pelvis': 'Bip01 Pelvis', 'spine': 'Bip01 Spine', 'chest': 'Bip01 Spine2',
              'footL': 'Bip01 L Foot', 'footR': 'Bip01 R Foot', 'toeL': 'Bip01 L Toe0', 'toeR': 'Bip01 R Toe0',
              'handL': 'Bip01 L Hand', 'handR': 'Bip01 R Hand'},
    'ragdoll': rag,
    'ragdollNotes': 'capsule from bone head towards "to" (length m, radius m); cone and twist are joint limits in degrees about the parent; hinge = [min, max] flexion for elbows and knees',
    'source': {'avatar': 'Microsoft Rocketbox Adults/Male_Adult_01 (MIT)', 'clips': {c: chosen.get(c, IDLE) for c in ('walk', 'run', 'sprint')} | {'idle': IDLE},
               'hat_clogs_print_jumps': 'original, made in tools/characters/player.py'},
    'heightM': round(float(bverts[:, 2].max()), 3),
    'swim': {'clips': ['tread', 'swim', 'swim_under'], 'pitch': 78, 'speed': {'swim': 1.5, 'swim_under': 1.3},
             'notes': 'loops drawn upright (head up, belly forward); the game pitches the body by speed: swim (front crawl, '
                      '3 arm cycles, breathing every third stroke) towards pitch degrees, swim_under (breaststroke pull-out) along '
                      'the velocity; tread is played upright. speed = m/s at which a loop plays at 1x',
             'source': 'original, keyframed in tools/characters/player.py'},
}
extras['ski'] = SKI_EXTRAS
extras['rod'] = ROD_EXTRAS
# the hat down his back in the game (Avatar.poseHat): bind-space (glTF, Y up) numbers; back = the rest-space move from
# the head to the shoulder blades, applied after the Spine2 joint; pivot = the brim's top edge there (the cord pulls
# at it), lateral / normal = its sway axes; centre = the crown's middle on the head (the put-back path); stow = where
# HatCord folds to while the hat is on (inside the crown)
Cg_ = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
gl_ = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
Tg_ = Cg_ @ T_REST @ Cg_.inverted()
extras['hat'] = {'bone': 'Hat', 'cord': 'HatCord', 'anchor': 'Bip01 Spine2',
                 'back': [round(Tg_[r][c], 6) for c in range(4) for r in range(4)],
                 'pivot': gl_(T_REST @ Vector((0, cy - ry - 0.088, zb_))), 'lateral': gl_(XB), 'normal': gl_(NB),
                 'centre': gl_(Vector((0, cy, zb_ + 0.5 * HS))), 'stow': gl_(Vector((0, cy, zb_ + 0.6 * HS))),
                 'notes': 'in the water the hat hangs down his back on its chin cord (Avatar.poseHat); matrices column-major'}
b = open(OUT, 'rb').read()
magic, ver, _ = struct.unpack('<4sII', b[:12]); jl = struct.unpack('<I', b[12:16])[0]
js = json.loads(b[20:20 + jl]); rest_ = b[20 + jl:]
js['scenes'][js.get('scene', 0)].setdefault('extras', {}).update(extras)
nj = json.dumps(js, separators=(',', ':')).encode(); nj += b' ' * ((4 - len(nj) % 4) % 4)
open(OUT, 'wb').write(struct.pack('<4sII', magic, ver, 20 + len(nj) + len(rest_)) + struct.pack('<I4s', len(nj), b'JSON') + nj + rest_)
acc = js['accessors']
tri = sum(acc[p['indices']]['count'] // 3 for m in js['meshes'] for p in m['primitives'])
anims = {a['name']: round(max(acc[s['input']]['max'][0] for s in a['samplers']), 3) for a in js['animations']}
log('EXPORTED', OUT, os.path.getsize(OUT), 'tris', tri, 'anims', anims)
log('images', [(i.get('name'), i.get('mimeType'), js['bufferViews'][i['bufferView']]['byteLength']) for i in js['images']])
log('EXTRAS', json.dumps({k: extras[k] for k in ('clipSpeeds', 'bones', 'heightM')}))
log('CLIPINFO', json.dumps(clipinfo), json.dumps(measured))
