"""Tidewater: the pet cockatoo, the sourced model fitted to the game's rig contract, with an open wing for flight.

Source: "Sulphur-Crested Cockatoo" by AlexGiardiniere, CC BY 4.0,
https://sketchfab.com/3d-models/sulphur-crested-cockatoo-18fca4e421094c789c63cd78565e38b6 (uid 18fca4e4...).
A copy sits in tools/cockatoo/source/. It is a perched, unrigged mesh (8.8k triangles, one 512 px texture) with
separate shells for each folded wing, the seven crest feathers and the toes. Its UVs and texture ship unchanged.
Its geometry gets a uniform scale and placement, the toes unrolled off the source's rail (step 3), the front quill
shortened, and the skinning the game needs.

How it fits the contract (70 bones: the builder's 68 plus shell_L / shell_R; the builder's clips plus `stretch`):
1. Run cockatoo_build.py in this Blender session. Its armature, pose tables, clips and export settings are reused
   as they are. Its own body is only the weight donor (not exported); its wings are kept (step 5).
2. Place the sourced mesh on the donor's PERCH pose: forward to -Y, then a similarity fit of beak tip, tail tip and
   sole in the side plane, with the soles matched exactly.
3. Weights by shell. Body: blended from the nearest donor vertices (body bones only). Toes: the leg bones of their
   side, after each foot's toes are unrolled off the round rail the source grips onto a shoulder-sized curve
   (--grip-radius, 7 cm), so on the player's shirt the whole toe lies down, roots and claws, not just the claw tips.
   Folded wings: each shell is rigid on its own bone, `shell_L` / `shell_R`; a `stretch` overlay clip swings them out
   and lifts their tips for the perched wing stretch. Crest: each feather shell is rigid on one crest bone in the
   source's raised pose. The front quill grows out of the skull shell as a long hook: its rise above the crown is
   pressed flat (--quill, 15%) and it stays on the head; the small plume behind it bends back on a three-bone chain.
4. Invert the skinning: rest = (sum w M)^-1 posed, so the PERCH clip reproduces the sourced bird (crest lowered)
   and the rest pose is the spread-wing flight pose the clips expect.
5. The open wing is the procedural builder's (arm, ten primaries, eleven secondaries, three tertials, shingled
   coverts, a sulphur wash beneath, on a 2k feather atlas), fitted into the sourced body at the shoulder and
   tinted to the source's white. The game shows one wing at a time: src/player/Cockatoo.js scales `upper_*` (the
   open wing) to nothing while perched (the stretch included) and `shell_*` (the folded shell) to nothing in flight,
   crossing over within the first sixth of the take-off blend so neither is left half-scaled.

  Blender -b -P tools/cockatoo/cockatoo_import.py -- [--src file.glb] [--out public/models/cockatoo.glb] [--render dir]
      [--only a_,e_] [--grip-radius 0.07] [--claw 0.3] [--quill 0.15] [--level 0.6] [--hook 0.003]
"""
import bpy, bmesh, sys, os, math, json, struct
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MY = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(n, d=None): return MY[MY.index(n) + 1] if n in MY else d
SRC = opt('--src', os.path.join(HERE, 'source', 'sulphur-crested-cockatoo-18fca4e4.glb'))
OUT = os.path.join(ROOT, opt('--out', 'public/models/cockatoo.glb'))
RENDER = opt('--render')
SOURCE = {'title': 'Sulphur-Crested Cockatoo', 'author': 'AlexGiardiniere', 'license': 'CC-BY-4.0',
          'url': 'https://sketchfab.com/3d-models/sulphur-crested-cockatoo-18fca4e421094c789c63cd78565e38b6',
          'uid': '18fca4e421094c789c63cd78565e38b6'}

# ============================================================== 1. rig, poses and clips from the builder
BUILDER = os.path.join(HERE, 'cockatoo_build.py')
argv = sys.argv
sys.argv = [argv[0], '--', '--out', os.path.join(bpy.app.tempdir or '/tmp', 'cockatoo_donor.glb')]
G = {'__file__': BUILDER, '__name__': '__cockatoo_build__'}
exec(compile(open(BUILDER).read(), BUILDER, 'exec'), G)
sys.argv = argv
ob, arm, arm_d, ad = G['ob'], G['arm'], G['arm_d'], G['ad']
set_pose, PERCH, GLIDE, OVER, FLAP, flap_pose, VW = G['set_pose'], G['PERCH'], G['GLIDE'], G['OVER'], G['FLAP'], G['flap_pose'], G['VW']
for tr in ad.nla_tracks: tr.mute = True
ad.action = None

def pose_mats(p):
    set_pose(p); bpy.context.view_layer.update()
    return {pb.name: np.array(pb.matrix @ arm_d.bones[pb.name].matrix_local.inverted()) for pb in arm.pose.bones}

def fam(b):
    if b[0] == 'c' and b[1:].isdigit(): return 'crest'
    side = b[-2:] if b.endswith(('_L', '_R')) else ''
    base = b[:-2] if side else b
    if base in ('thigh', 'foot'): return 'leg' + side
    if base in ('upper', 'fore', 'hand', 't') or (base[0] in 'ps' and base[1:].isdigit()): return 'wing' + side
    return 'body'

MP = pose_mats(PERCH)
dg = bpy.context.evaluated_depsgraph_get()
em = ob.evaluated_get(dg).to_mesh(); DP = np.array([v.co[:] for v in em.vertices]); ob.evaluated_get(dg).to_mesh_clear()
DOM = [max(w, key=w.get) for w in VW]
DFAM = np.array([fam(b) for b in DOM])
HEAD = np.array(arm.pose.bones['head'].head[:])

# ============================================================== 2. the sourced mesh, placed on the PERCH pose
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
new = [o for o in bpy.data.objects if o not in before]
src = [o for o in new if o.type == 'MESH'][0]
mw = src.matrix_world.copy(); src.parent = None; src.data.transform(mw); src.matrix_world = Matrix()
for o in new:
    if o is not src: bpy.data.objects.remove(o, do_unlink=True)
src.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))          # beak +X -> -Y
bm = bmesh.new(); bm.from_mesh(src.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)             # glTF splits vertices at UV seams
bm.to_mesh(src.data); bm.free()
try:
    with bpy.context.temp_override(object=src, active_object=src, selected_objects=[src]):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as e: print('COCKATOO normals', e)
src.data.shade_smooth()
me = src.data; n = len(me.vertices)
S = np.array([v.co[:] for v in me.vertices])
E = np.array([e.vertices[:] for e in me.edges])

# islands (union-find over edges)
par = np.arange(n)
def find(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
for a, b in E:
    ra, rb = find(a), find(b)
    if ra != rb: par[ra] = rb
ISL = np.array([find(i) for i in range(n)])
ids, counts = np.unique(ISL, return_counts=True)
BODY_ID = ids[counts.argmax()]

def landmarks(P, skip):
    z0, z1 = P[:, 2].min(), P[:, 2].max()
    head = np.where(~skip & (P[:, 2] > z0 + 0.55 * (z1 - z0)))[0]
    beak = P[head[P[head, 1].argmin()]]
    tail = P[P[:, 1].argmax()]
    front = np.where(P[:, 1] < (beak[1] + tail[1]) / 2)[0]
    sole = P[front[P[front, 2].argmin()]]
    return np.array([[beak[1], beak[2]], [tail[1], tail[2]], [sole[1], sole[2]]])

h = S[:, 2].max() - S[:, 2].min()
top = np.zeros(n, bool)
for i, c in zip(ids, counts):
    m = ISL == i
    if i != BODY_ID and S[m, 2].mean() > S[:, 2].min() + 0.78 * h: top |= m   # crest shells, not the beak
A, B = landmarks(S, top), landmarks(DP, np.zeros(len(DP), bool))
A6, B6 = A[[0, 0, 0, 1, 2, 2]], B[[0, 0, 0, 1, 2, 2]]   # the head matters most (crest, jaw, look pivots), then the feet
ma, mb = A6.mean(0), B6.mean(0); a, b = A6 - ma, B6 - mb
U, D, Vt = np.linalg.svd(b.T @ a); d = np.sign(np.linalg.det(U @ Vt)); Sg = np.diag([1, d])
R2 = U @ Sg @ Vt; sc = (D * np.diag(Sg)).sum() / (a ** 2).sum(); t2 = mb - sc * R2 @ ma
S[:, 1:] = (sc * (R2 @ S[:, 1:].T)).T + t2; S[:, 0] *= sc
S[:, 2] += B[2, 1] - landmarks(S, top)[2, 1]
print('COCKATOO fit scale', round(sc, 4), 'landmarks src', np.round(landmarks(S, top), 3).tolist(), 'donor', np.round(B, 3).tolist())

# ============================================================== 3. weights
def kd_of(mask):
    idx = np.where(mask)[0]; kd = KDTree(len(idx))
    for j, i in enumerate(idx): kd.insert(tuple(DP[i]), j)
    kd.balance(); return kd, idx
KD = {f: kd_of(DFAM == f) for f in set(DFAM)}
kd_all, all_idx = kd_of(np.ones(len(DP), bool))

W = [None] * n; RIGID = [None] * n; FAMV = [''] * n
table = []
# the head is a cluster of thin midline shells: the biggest is the skull, plumes rise above it, the beak sits low
cl = []
for i, c in zip(ids, counts):
    vs = np.where(ISL == i)[0]; cen = S[vs].mean(0)
    if i != BODY_ID and c < 300 and abs(cen[0]) < 0.006 and cen[2] > 0.06: cl.append((int(c), int(i), S[vs, 2].max(), cen[2]))
skull = max(cl)
CRESTI = {i for c, i, zt, zc in cl if i != skull[1] and (zt > skull[2] + 0.01 or zc > skull[3])}
BEAKI = sorted((zc, i) for c, i, zt, zc in cl if i not in CRESTI and i != skull[1])
JAWI = BEAKI[0][1] if len(BEAKI) >= 2 else None
HEADI = {skull[1]} | {i for zc, i in BEAKI if i != JAWI}
print('COCKATOO head cluster skull', skull[1], 'beak', BEAKI, 'jaw', JAWI, 'crest', sorted(CRESTI))
for i, c in zip(ids, counts):
    vs = np.where(ISL == i)[0]; cen = S[vs].mean(0)
    votes = {}
    for v in vs:
        f = DFAM[all_idx[kd_all.find(tuple(S[v]))[1]]]; votes[f] = votes.get(f, 0) + 1
    f = max(votes, key=votes.get)
    # by shape, not by vote: the folded wings are the two big side shells, the crest the thin midline shells on the crown
    if i != BODY_ID and len(vs) >= 300 and abs(cen[0]) > 0.015: f = 'wing_L' if cen[0] > 0 else 'wing_R'
    elif i in CRESTI: f = 'crest'
    elif i in HEADI or (i != BODY_ID and len(vs) < 300 and 0.012 < abs(cen[0]) < 0.03 and cen[2] > 0.06): f = 'head'   # skull, upper beak, eyes
    elif i == JAWI: f = 'jaw'
    elif f.startswith('wing') or f == 'crest': f = 'body'
    for v in vs: FAMV[v] = f
    table.append((int(c), f, np.round(cen, 3).tolist(), {k: v for k, v in votes.items() if v > len(vs) * 0.1}))
for row in sorted(table, key=lambda r: -r[0]): print('COCKATOO island', row)

# the toes: the source grips a round rail, so its toe roots stand 1.6 to 2.7 cm above the claw tips. Each foot's toes
# are unrolled off that rail (a circle fitted to them in the side plane) onto a curve of GRIP_R, about the top of a
# man's shoulder, keeping the point on top of the rail where the tarsus meets them. Arc length along the toe is kept.
GRIP_R = float(opt('--grip-radius', '0.07'))
CLAW = float(opt('--claw', '1.0'))   # how much of the claw hook below the pads is kept (1 = the source's; 0.3 measured no change
# to the in-game resting contact on 2026-09-27: the 2.2 cm claw-to-pad spread there is a foot pitch, not the claw curl)
CZ = {int(i): S[ISL == i, 2].mean() for i in ids}
set_pose(PERCH); bpy.context.view_layer.update()
for sd in ('_L', '_R'):
    tv = np.array([v for v in range(n) if FAMV[v] == 'leg' + sd and CZ[int(ISL[v])] < -0.065])
    if len(tv) < 20: print('COCKATOO toes', sd, 'not found'); continue
    fz = (arm.matrix_world @ arm.pose.bones['foot' + sd].head).z
    Y, Z = S[tv, 1], S[tv, 2]
    (cy, cz, cc), *_ = np.linalg.lstsq(np.c_[2 * Y, 2 * Z, np.ones(len(tv))], Y ** 2 + Z ** 2, rcond=None)
    R0 = math.sqrt(cc + cy ** 2 + cz ** 2)
    rho = np.hypot(Y - cy, Z - cz); th = np.arctan2(Y - cy, Z - cz)
    before = fz - Z.min()
    if not 0.004 < R0 < 0.03: print('COCKATOO toes', sd, 'rail fit off', round(R0, 4)); continue
    th2 = th * R0 / GRIP_R; rho2 = GRIP_R + (rho - R0); cz2 = cz + R0 - GRIP_R
    S[tv, 1] = cy + rho2 * np.sin(th2); S[tv, 2] = cz2 + rho2 * np.cos(th2)
    print('COCKATOO toes', sd, 'verts', len(tv), 'rail centre', np.round([cy, cz], 4).tolist(), 'radius', round(R0, 4),
          'wrap deg', np.round(np.degrees([th.min(), th.max()]), 0).tolist(), 'reach below foot joint', round(before, 4), '->', round(fz - S[tv, 2].min(), 4),
          'toe z span', round(Z.max() - Z.min(), 4), '->', round(S[tv, 2].max() - S[tv, 2].min(), 4))
    # flat perches (a rail, the ground, a deck, the cage dowel): the claw hooks that curled round the source's rail
    # still reach about 1.9 cm below the toe pads, so on a flat top the bird stood on its claw tips with the pads in
    # the air. Everything below the pad line (the 20th percentile of the unrolled toe heights) is pressed back up to
    # CLAW of its depth: the claws still hook, the pads meet the surface.
    zt = S[tv, 2].copy(); zp = np.percentile(zt, 20); low = zt < zp
    was = zp - zt.min()
    S[tv[low], 2] = zp - (zp - zt[low]) * CLAW
    print('COCKATOO claws', sd, 'below pads', round(was, 4), '->', round(zp - S[tv, 2].min(), 4),
          'pads below foot joint', round(fz - zp, 4), 'claws below foot joint', round(fz - S[tv, 2].min(), 4))

# each toe stands level (measured 2026-09-27: in the perch pose, which the game also uses to rest on a rail, the
# ground, a deck or the cage dowel, the toes tilt: the soles ran from 0.9 cm above the contact plane at the back toes
# to 1.5 cm below it under the front toes). The toes of a foot are split by direction round the ankle (two forward,
# two back); each is turned about the toe junction, in its own upright plane, so the lowest line along its underside
# (claw included) is level. The turn ramps in over the first centimetre so the junction does not tear. LEVEL scales
# the turn: the two front toes fall in one group and the inner one's claw hooks mid-toe, so the full fit over-lifts
# them (front claw 1.3 cm above the back one); 0.6 lands claws and pads within a few mm of each other. Then the foot
# pad of the leg shell (it still wraps the front of the source's rail, not unrolled with the toes, 2.3 cm below the
# toe pads: the lowest point on any flat perch) and any claw more than HOOK below the common sole (the median of the
# toes' lowest points) are pressed up to HOOK. PAD in src/player/Cockatoo.js is the ankle's height above that sole.
LEVEL = float(opt('--level', '0.6'))
HOOK = float(opt('--hook', '0.003'))
for sd in ('_L', '_R') if LEVEL > 0 else ():
    tv = np.array([v for v in range(n) if FAMV[v] == 'leg' + sd and CZ[int(ISL[v])] < -0.065])
    if len(tv) < 20: continue
    hd = arm.matrix_world @ arm.pose.bones['foot' + sd].head
    D = S[tv, :2] - np.array([hd.x, hd.y]); r = np.hypot(D[:, 0], D[:, 1]); far = r > 0.008
    U = D / np.maximum(r, 1e-6)[:, None]; so = 1.0 if hd.x > 0 else -1.0
    C = np.array([[0.3 * so, -0.95], [-0.3 * so, -0.95], [0.5 * so, 0.85], [-0.5 * so, 0.85]]); C /= np.linalg.norm(C, axis=1)[:, None]
    for _ in range(25):
        k = np.argmax(U @ C.T, 1)
        for j in range(4):
            m = far & (k == j)
            if m.sum(): C[j] = U[m].sum(0) / np.linalg.norm(U[m].sum(0))
    k = np.argmax(U @ C.T, 1)
    pz = S[tv[r < 0.006], 2].mean() if (r < 0.006).sum() >= 3 else hd.z - 0.012
    for j in range(4):
        m = k == j; mf = m & far
        if mf.sum() < 8: continue
        rf = D[mf] @ C[j]; zf = S[tv[mf], 2] - pz; bins = np.floor(rf / 0.003).astype(int)
        bx = [rf[bins == b_].mean() for b_ in np.unique(bins)]; bz = [zf[bins == b_].min() for b_ in np.unique(bins)]
        if len(bx) < 3: continue
        ang = float(np.clip(-math.atan(np.polyfit(bx, bz, 1)[0]), -math.radians(45), math.radians(45))) * LEVEL
        rho = D[m] @ C[j]; z = S[tv[m], 2] - pz; a = ang * np.clip((r[m] - 0.004) / 0.008, 0, 1)
        rho2 = rho * np.cos(a) - z * np.sin(a)
        S[tv[m], 0] += (rho2 - rho) * C[j][0]; S[tv[m], 1] += (rho2 - rho) * C[j][1]; S[tv[m], 2] = pz + rho * np.sin(a) + z * np.cos(a)
        print('COCKATOO level toe', sd, j, 'dir', np.round(C[j], 2).tolist(), 'verts', int(m.sum()), 'tilt deg', round(math.degrees(ang), 1))
    lows = [S[tv[(k == j) & far], 2].min() for j in range(4) if ((k == j) & far).sum() >= 8]
    lv = np.array([v for v in range(n) if FAMV[v] == 'leg' + sd])
    sole = float(np.median(lows)); zt = S[lv, 2].copy(); lo_ = zt < sole - HOOK
    S[lv[lo_], 2] = sole - HOOK
    print('COCKATOO sole', sd, 'toe lows below ankle', np.round(hd.z - np.array(lows), 4).tolist(), 'sole below ankle', round(hd.z - sole, 4),
          'pressed', int(lo_.sum()), 'of', len(lv), 'leg verts, deepest was', round(sole - zt.min(), 4), '->', round(sole - S[lv, 2].min(), 4))

def blend(v, f, k):
    kd, idx = KD[f]; acc = {}
    for co, j, dist in kd.find_n(tuple(S[v]), k):
        wgt = 1.0 / (dist + 1e-4)
        for bn, val in VW[idx[j]].items(): acc[bn] = acc.get(bn, 0) + val * wgt
    top4 = sorted(acc.items(), key=lambda kv: -kv[1])[:4]; s = sum(x for _, x in top4)
    return {bn: x / s for bn, x in top4 if x / s > 0.02}

for v in range(n):
    f = FAMV[v]
    if f in ('body', 'leg_L', 'leg_R'): W[v] = blend(v, f, 6 if f == 'body' else 4)
    elif f in ('head', 'jaw'): RIGID[v] = f
    elif f.startswith('wing'): RIGID[v] = 'shell' + f[-2:]   # the folded wing shell: rigid on its own bone, shown only while perched
# the head bones move onto the sourced head (orientation kept): look turns, the jaw and the crest pivot where they should
HM = np.array([FAMV[v] in ('head', 'jaw') for v in range(n)])
DH = np.array([b in ('head', 'jaw') for b in DOM])
Dlt = S[HM].mean(0) - DP[DH].mean(0)
print('COCKATOO head offset', np.round(Dlt, 4).tolist())
Rn2, Rh = MP['neck2'][:3, :3], MP['head'][:3, :3]
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in arm_d.edit_bones:
    if eb.name in ('head', 'jaw') or fam(eb.name) == 'crest':
        dl = Vector((Rn2 if eb.name == 'head' else Rh).T @ Dlt); eb.head += dl; eb.tail += dl
bpy.ops.object.mode_set(mode='OBJECT')
MP = pose_mats(PERCH)

# crest: one feather shell per crest bone, fitted in the crest-raised pose
#   each plume goes to the crest bone whose raised angle (side view, from +Y toward +Z) is closest to its own,
#   and that bone's pivot moves onto the plume's root (orientation kept, so the clips' rotations still hold)
CRESTPOSE = {**PERCH, **OVER['crest']}
MC0 = pose_mats(CRESTPOSE)
bang = {}
for b in arm_d.bones:
    if fam(b.name) == 'crest':
        dv = arm.pose.bones[b.name].tail - arm.pose.bones[b.name].head; bang[b.name] = math.degrees(math.atan2(dv.z, dv.y))
kdb = KDTree(n)
nb = 0
for v in range(n):
    if FAMV[v] != 'crest': kdb.insert(tuple(S[v]), v); nb += 1
kdb.balance()
# Each crest shell (some hold two plumes fused at the quill) is rigid on one crest bone, pivoting at its root.
# The raised pose is the source's own crest. The lowered pose is searched: the rotation back about the root that lays
# the shell flattest along the crown and nape without sinking in. The crest overlay is then re-keyed so that it
# raises each bone from that lowered pose back to the source's, so PERCH lies flat and `crest` fans up as modelled.
EADJ = {}
for a_, b_ in E: EADJ.setdefault(int(a_), []).append(int(b_)); EADJ.setdefault(int(b_), []).append(int(a_))
# The front plumes are not separate shells: they grow out of the skull shell itself (the white quill and yellow fork
# that stood up while perched). They are the skull's protrusions above the crown; each is split off and lowered too,
# blended into `head` at its base so the skull does not tear.
SKI = np.where(ISL == skull[1])[0]
EYEC = [S[ISL == i].mean(0) for i, c in zip(ids, counts) if i != BODY_ID and c < 300 and 0.012 < abs(S[ISL == i].mean(0)[0]) < 0.03 and S[ISL == i].mean(0)[2] > 0.06]
SKc = np.mean(EYEC, 0) if len(EYEC) >= 2 else S[SKI].mean(0); SKc[0] = 0.0      # the head's centre: between the eyes
dd = np.linalg.norm(S[SKI] - SKc, axis=1); dome = S[SKI, 2] > SKc[2] - 0.005
r60 = np.percentile(dd[dome], 35)                                               # the crown's radius
THR = np.where((S[SKI, 1] < SKc[1]) & (S[SKI, 2] > SKc[2] + 0.3 * r60), 1.0, 1.3) * r60   # the front plume's quill starts low on the forehead
UPM = dome & (dd > THR)
THRV = {int(v): t_ for v, t_ in zip(SKI, THR)}
print('COCKATOO head centre', np.round(SKc, 4).tolist(), 'eyes', len(EYEC), 'crown radius', round(r60, 4))
UPV = set(int(v) for v in SKI[UPM])
SKV = S[SKI[~UPM]]; SKT = SKV[:, 2].max()
PROF = np.vstack([SKV, S[ISL == BODY_ID]])
comp = {}
for v in UPV:   # connected pieces of the protrusions
    if v in comp: continue
    st = [v]; comp[v] = v
    while st:
        u = st.pop()
        for w_ in EADJ.get(u, []):
            if w_ in UPV and w_ not in comp: comp[w_] = v; st.append(w_)
PIECES = {}
for v, c_ in comp.items(): PIECES.setdefault(c_, []).append(v)
PIECES = [np.array(sorted(q_)) for q_ in PIECES.values() if len(q_) >= 12]
# The big front quill is a long hook off the forehead: no rotation about its root lays it flat (it folds over into a
# curl). Its rise above the crown is pressed down to QS of itself instead, so it lies on the skull (head bone).
QS = float(opt('--quill', '0.15'))
# round 3: the sourced crest (four stubby pale lime shells and two skull plumes) read as green fingers. It is replaced
# by long sulphur-yellow feather cards (below, --new-crest 1): every skull plume is pressed onto the skull like the
# front quill, and the crest shells are dropped from the mesh.
NEWCREST = int(opt('--new-crest', '1'))
if NEWCREST: QS = min(QS, 0.05)   # the pressed quill stood as a knob on the forehead
PRS = []
for vs in [q_ for q_ in PIECES if len(q_) >= 40 or NEWCREST]:
    PRS.append(vs)
    dv = np.linalg.norm(S[vs] - SKc, axis=1); thr = np.array([THRV[int(v)] for v in vs])
    S[vs] = SKc + (S[vs] - SKc) * ((thr + np.maximum(dv - thr, 0) * QS) / dv)[:, None]
    print('COCKATOO front quill pressed flat', len(vs), 'verts, rise', round(float((dv - thr).max()), 4), '->', round(float((dv - thr).max() * QS), 4))
PIECES = [q_ for q_ in PIECES if len(q_) < 40 and not NEWCREST]
# round 4: the pressed plumes still stood as a small knob on the forehead. The crown over them and three rings of
# neighbours is relaxed: each vertex's distance from the skull centre may only drop, toward its neighbours' mean, with
# the outermost ring held, so the knob sinks into the crown and nothing around it inflates (--brow-smooth passes).
BSM = int(opt('--brow-smooth', '12')); PRV = np.unique(np.concatenate(PRS)) if PRS else np.zeros(0, int)
if NEWCREST and BSM and len(PRV):
    reg = set(int(v) for v in PRV); rings = []
    for _ in range(3):
        nxt = {w for u in reg for w in EADJ.get(u, [])} - reg; rings.append(nxt); reg |= nxt
    fixed = rings[-1]; mv_ = [v for v in sorted(reg) if v not in fixed]
    rr = {v: float(np.linalg.norm(S[v] - SKc)) for v in reg}; r0_ = dict(rr)
    for _ in range(BSM):
        for v in mv_:
            nb_ = [w for w in EADJ.get(v, []) if w in rr]
            if nb_: rr[v] = min(rr[v], 0.5 * rr[v] + 0.5 * float(np.mean([rr[w] for w in nb_])))
    for v in mv_: S[v] = SKc + (S[v] - SKc) * (rr[v] / r0_[v])
    print('COCKATOO brow relaxed verts', len(mv_), 'max drop mm', round(1000 * max(r0_[v] - rr[v] for v in mv_), 2))
print('COCKATOO skull r60', round(r60, 4), 'protrusion verts', len(UPV), 'pieces', [len(q_) for q_ in PIECES])
CMIX = {}
def RX(deg):
    c_, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c_, -s_], [0, s_, c_]])
def hug(L, target):   # sinking in costs most, then floating off the crown, then standing up
    h = []
    for x in L:
        near = PROF[(np.abs(PROF[:, 0] - x[0]) < 0.008) & (np.abs(PROF[:, 1] - x[1]) < 0.005)]
        if len(near): h.append(x[2] - near[:, 2].max())
    h = np.array(h) if h else np.zeros(1)
    ax = L.mean(0) - L[0]; a = math.degrees(math.atan2(ax[2], ax[1]))   # side view: 0 lies straight back (+Y), 90 stands up
    return abs(a - 12.0) / 100.0 + 1.5 * np.maximum(0, 0.001 - h).mean() + np.abs(h - target).mean() + 0.5 * max(0.0, h.max() - 0.03)
shells = []
for i in ids:
    vs = np.where(ISL == i)[0]
    if FAMV[vs[0]] != 'crest': continue
    dsk = np.array([np.min(np.linalg.norm(SKV - x, axis=1)) for x in S[vs]])
    shells.append((S[vs[dsk.argmin()], 1], int(i), vs, S[vs[dsk.argmin()]].copy()))   # the root: where it meets the crown
shells.sort(key=lambda t: t[0])                                                         # front to back
DELV = np.concatenate([t[2] for t in shells]) if NEWCREST and shells else np.zeros(0, int)
if NEWCREST:
    for v in DELV: RIGID[int(v)] = 'head'
    shells = []
LOW, moves = {}, {}
for k, (_, i, vs, root) in enumerate(shells):
    bn = 'c%d' % k
    best = min((hug(np.vstack([root, (RX(ph) @ (S[vs] - root).T).T + root]), 0.004 + 0.0015 * k), ph) for ph in np.arange(0.0, -178.0, -2.0))
    LOW[bn] = best[1]; moves[bn] = (np.linalg.inv(MP['head']) @ np.append(root, 1.0))[:3]
    for v in vs: RIGID[v] = bn
    print('COCKATOO crest shell', i, 'verts', len(vs), '->', bn, 'lowered by', LOW[bn], 'deg, fit', round(best[0], 4))
for k, vs in enumerate(PIECES):   # each quill bends back over three crest bones, so it folds without tearing
    chain = ['c%d' % (len(shells) + 3 * k + j) for j in range(3)]
    dv = np.linalg.norm(S[vs] - SKc, axis=1); root = S[vs[dv.argmin()]].copy()
    best = min((hug(np.vstack([root, (RX(ph) @ (S[vs] - root).T).T + root]), 0.003), ph) for ph in np.arange(0.0, -178.0, -2.0))
    bn = chain[-1]
    for j, cb in enumerate(chain):
        LOW[cb] = best[1] * (j + 1) / 3; moves[cb] = (np.linalg.inv(MP['head']) @ np.append(root, 1.0))[:3]
    for v, d_ in zip(vs, dv):
        t_ = float(np.clip((d_ - THRV[int(v)]) / (0.16 * r60), 0, 1)) * 3; j = min(int(t_), 2); f_ = t_ - j
        lo = 'head' if j == 0 else chain[j - 1]; RIGID[v] = None; CMIX[int(v)] = True
        W[v] = {lo: 1 - f_, chain[j]: f_} if f_ > 1e-3 else {lo: 1.0}
    print('COCKATOO crest skull plume', len(vs), '->', bn, 'lowered by', LOW[bn], 'deg, fit', round(best[0], 4))
if NEWCREST:
    # The crest: the builder's ten long feather cards (two crossed vanes each, white at the quill, sulphur yellow, lemon
    # at the tips, curled forward), on its own crest bones and the same feather atlas as the open wing. They are taken
    # in the builder's PERCH (lowered: laid back along the crown, the yellow tips curling up behind the nape as a
    # wedge), carried with the head onto the sourced skull, each card's quill set 1.5 mm into the crown; the `crest`
    # overlay raises them by the builder's own angles (62 degrees at the front to 147 at the back: a forward fan).
    CL = float(opt('--crest-len', '0.7')); CSP = float(opt('--crest-span', '0.3')); CSH = float(opt('--crest-shift', '-0.012'))
    CI = np.where(DFAM == 'crest')[0]; CBONE = [DOM[i] for i in CI]; CPOS = DP[CI] + Dlt
    SKA = S[SKI]; roots = {}
    for bn in sorted(set(CBONE), key=lambda b: int(b[1:])):
        sel = np.array([b == bn for b in CBONE]); P_ = CPOS[sel]; assert len(P_) == 32   # two crossed cards of 8 rows (L, R)
        root = P_[[0, 1, 16, 17]].mean(0)                                                 # the quill: the base rows' centre
        roots[bn] = root
    ry0 = np.mean([r[1] for r in roots.values()])
    CW = float(opt('--crest-width', '1.6')); CLF, CLB = [float(x) for x in opt('--crest-lens', '0.034,0.062').split(',')]
    # round 5: a fan of separate feathers, not one hook. Round 4 aimed every tip at one shared line 1.2 mm apart and
    # stretched each card to reach it, so the ten tips landed within 11 mm of each other on a strip 4.4 mm wide (one flat
    # banana blade up close). Now each card keeps its own length (short at the front, long at the back, with a small
    # per-card spread), lies back at its own chord rise (--crest-rise front,back degrees), its quill sits across the
    # crown (--crest-rootx, alternating sides), it turns about the vertical through its quill so its tip sits a little
    # off the midline on its own side (--crest-fan metres from the midline, alternating: the small sideways fan), and its curl grows from the
    # short front cards (nearly flat) to the long back ones (the forward hook). The tips come out about 4 to 6 mm apart
    # (build log `crest tip spacing`); the resting set stays a narrow wedge like the reference photos.
    CRA, CRB = [float(x) for x in opt('--crest-rise', '0,14').split(',')]; CURL = float(opt('--crest-curl', '50'))
    CRX = float(opt('--crest-rootx', '0.0035')); CFAN = float(opt('--crest-fan', '0.0024'))
    LJ = [0.0, 0.02, -0.015, 0.02, -0.02, 0.015, -0.02, 0.02, -0.015, 0.0]   # per-card length spread (small: the tips stay evenly stepped)
    XJ = [0.3, 0.65, 1.0, 0.5, 0.9, 0.75, 1.0, 0.55, 0.8, 0.35]              # per-card quill offset across the crown
    AJ = [0.0, 0.6, -0.4, 0.5, -0.6, 0.4, -0.3, 0.6, -0.5, 0.0]              # per-card rise spread, degrees
    CJ = [0.0, 0.10, -0.08, 0.06, -0.10, 0.08, -0.06, 0.10, -0.05, 0.0]      # per-card curl spread
    FJ = [0.4, 0.9, 0.75, 0.6, 0.75, 0.8, 0.8, 0.7, 0.9, 0.5]                  # per-card tip offset off the midline
    TIPS = {}
    for bn, root in roots.items():
        sel = np.array([b == bn for b in CBONE]); P_ = CPOS[sel]; m_ = int(bn[1:]); side_ = 1.0 if root[0] >= 0 else -1.0
        r2 = root.copy(); r2[1] = ry0 + (root[1] - ry0) * CSP + CSH; r2[0] = side_ * CRX * XJ[m_ % 10]
        near = SKA[(np.abs(SKA[:, 0] - r2[0]) < 0.004) & (np.abs(SKA[:, 1] - r2[1]) < 0.004)]
        if len(near): r2[2] = near[:, 2].max() - 0.0015
        P_ = r2 + (P_ - root) * CL
        # each card's own length: 34 mm (front) to 62 mm (back) before the curl, plus its spread (--crest-lens)
        if CLF > 0: P_ = r2 + (P_ - r2) * ((CLF + (CLB - CLF) * m_ / 9) * (1 + LJ[m_ % 10]) / np.linalg.norm(P_ - r2, axis=1).max())
        # the builder laid the vanes flat (width across the head), so from the side the crest read as thin spikes.
        # A real crest feather shows its vane side-on: each row's width turns 90 degrees about the shaft, so the vane
        # lies in the curl plane (a curved blade seen from the side); the two crossed cards keep it solid from the front.
        for c0_ in (0, 16):
            L_, R_ = P_[c0_:c0_ + 16:2].copy(), P_[c0_ + 1:c0_ + 16:2].copy(); C_ = (L_ + R_) / 2; hw = (R_ - L_) / 2
            T_ = np.gradient(C_, axis=0); T_ /= np.linalg.norm(T_, axis=1, keepdims=True)
            hw2 = np.cross(T_, hw) * CW; P_[c0_:c0_ + 16:2] = C_ - hw2; P_[c0_ + 1:c0_ + 16:2] = C_ + hw2
        if CURL:   # round 4: each card's outer half rolls up and forward (--crest-curl degrees in all), so the tip hooks
            for c0_ in (0, 16):
                L_, R_ = P_[c0_:c0_ + 16:2].copy(), P_[c0_ + 1:c0_ + 16:2].copy(); C_ = (L_ + R_) / 2; hw = (R_ - L_) / 2; nr = len(C_)
                wts = np.array([(lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (k / (nr - 1) - 0.45) / 0.55))) for k in range(nr)])
                dph = np.diff(wts, prepend=0.0) * CURL * (0.35 + 0.9 * m_ / 9) * (1 + CJ[m_ % 10]); C2 = C_.copy(); H2 = hw.copy(); ph_ = 0.0
                for k in range(1, nr):
                    ph_ += dph[k]; Rk = RX(ph_); C2[k] = C2[k - 1] + Rk @ (C_[k] - C_[k - 1]); H2[k] = Rk @ hw[k]
                P_[c0_:c0_ + 16:2] = C2 - H2; P_[c0_ + 1:c0_ + 16:2] = C2 + H2
        CPOS[sel] = P_
        # lowered: each feather turns about its quill (side view) so its shaft runs back over the crown, rising 4 degrees
        # at the front to 20 at the back, stacked into one swept-back wedge with the curled yellow tips up behind the
        # head; if the base would sink into the crown it is lifted in 2 degree steps. The raised pose is the builder's
        # (raise = builder angle - ph).
        Pc = CPOS[sel].copy(); dl_ = np.linalg.norm(Pc - r2, axis=1); basev = dl_ < 0.6 * dl_.max()
        def hcost(ph):
            Q_ = (RX(ph) @ (Pc - r2).T).T + r2; hh = []
            for x in Q_[basev]:
                nr = PROF[(np.abs(PROF[:, 0] - x[0]) < 0.006) & (np.abs(PROF[:, 1] - x[1]) < 0.004)]
                if len(nr): hh.append(x[2] - nr[:, 2].max())
            hh = np.array(hh) if hh else np.zeros(1)
            return 3.0 * np.maximum(0, 0.0005 - hh).mean() + np.abs(hh - 0.0025).mean()
        tip_ = int(dl_.argmax()); ch = Pc[tip_] - r2   # no stretch: the card's chord turns to its own rise
        ph = (CRA + (CRB - CRA) * m_ / 9 + AJ[m_ % 10]) - math.degrees(math.atan2(ch[2], ch[1]))
        def lowest(ph):
            Q_ = (RX(ph) @ (Pc - r2).T).T + r2; hh = [x[2] - PROF[(np.abs(PROF[:, 0] - x[0]) < 0.006) & (np.abs(PROF[:, 1] - x[1]) < 0.004), 2].max()
                  for x in ((Q_[0:16:2] + Q_[1:16:2]) / 2)[(basev & (dl_ > 0.012))[0:16:2]] if ((np.abs(PROF[:, 0] - x[0]) < 0.006) & (np.abs(PROF[:, 1] - x[1]) < 0.004)).any()]
            return min(hh) if hh else 1.0
        k_ = 0
        while lowest(ph) < -0.004 and k_ < 80: ph += 0.5; k_ += 1   # the quill may run 4 mm into the crown feathers (round 5: half degree steps, so neighbours do not jump)
        CPOS[sel] = (RX(ph) @ (Pc - r2).T).T + r2
        tv_ = CPOS[sel][int(np.linalg.norm(CPOS[sel] - r2, axis=1).argmax())] - r2; dxy_ = max(1e-6, math.hypot(tv_[0], tv_[1]))
        ya_ = math.atan2(tv_[0], tv_[1]) - math.asin(max(-0.9, min(0.9, (side_ * CFAN * FJ[m_ % 10] - r2[0]) / dxy_))); RZ_ = np.array([[math.cos(ya_), -math.sin(ya_), 0], [math.sin(ya_), math.cos(ya_), 0], [0, 0, 1]])
        CPOS[sel] = (RZ_ @ (CPOS[sel] - r2).T).T + r2   # the small sideways fan: each card turns out about its quill
        TIPS[m_] = CPOS[sel][int(np.linalg.norm(CPOS[sel] - r2, axis=1).argmax())].copy()
        LOW[bn] = ph - (62.0 + m_ * 9.5); moves[bn] = (np.linalg.inv(MP['head']) @ np.append(r2, 1.0))[:3]
        print('COCKATOO crest card', bn, 'verts', int(sel.sum()), 'root vs head centre mm', np.round((r2 - SKc) * 1000, 1).tolist(),
              'length mm', round(float(np.linalg.norm(CPOS[sel] - r2, axis=1).max() * 1000), 1), 'lowered by', round(ph, 2), 'lift steps', k_, 'raise', -LOW[bn])
    tk_ = sorted(TIPS)
    print('COCKATOO crest tip spacing mm', [round(float(np.linalg.norm(TIPS[a] - TIPS[b])) * 1000, 1) for a, b in zip(tk_, tk_[1:])],
          'tips x mm', [round(float(TIPS[k][0]) * 1000, 1) for k in tk_])
    print('COCKATOO crest dropped sourced shell verts', len(DELV), 'crown radius mm', round(r60 * 1000, 1))
if JAWI is not None:   # the jaw hinges at the back of the lower mandible
    jv = np.where(ISL == JAWI)[0]; hinge = S[jv[S[jv, 1].argmax()]]
    moves['jaw'] = (np.linalg.inv(MP['head']) @ np.append(hinge, 1.0))[:3]
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for bn, r in moves.items():
    eb = arm_d.edit_bones[bn]; dlt = Vector(r) - eb.head; eb.head += dlt; eb.tail += dlt
for sd, sx in (('_L', 1), ('_R', -1)):   # the folded shell's own bone: the game scales it away as the wing opens
    eb = arm_d.edit_bones.new('shell' + sd); eb.head = Vector((0.018 * sx, -0.045, 0.022)); eb.tail = Vector((0.018 * sx, -0.005, 0.022))
    eb.parent = arm_d.edit_bones['root']; eb.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT')
MP = pose_mats(PERCH)
from mathutils import Quaternion
for bn, ph in LOW.items():   # crest overlay = the source's raised crest, reached from the lowered pose
    H = Matrix(MP[arm_d.bones[bn].parent.name][:3, :3].tolist()).to_quaternion()
    OVER['crest'][bn] = H.inverted() @ Quaternion((1, 0, 0), math.radians(-ph)) @ H @ PERCH.get(bn, Quaternion())
CRESTPOSE = {**PERCH, **OVER['crest']}
for tr in list(ad.nla_tracks):
    if tr.name == 'crest': ad.nla_tracks.remove(tr)
if bpy.data.actions.get('crest'): bpy.data.actions.remove(bpy.data.actions['crest'])
G['clip']('crest', [(0, CRESTPOSE), (1, CRESTPOSE)])
# the perched wing stretch: the folded shells swing out from the body and their tips lift, on their own bones
STRETCHPOSE = {**PERCH, **OVER.get('tailfan', {}),
               'shell_L': Quaternion((0, 1, 0), math.radians(-21)) @ Quaternion((1, 0, 0), math.radians(16)),
               'shell_R': Quaternion((0, 1, 0), math.radians(21)) @ Quaternion((1, 0, 0), math.radians(16))}   # round 4: wider, the crossed tips part
G['clip']('stretch', [(0, STRETCHPOSE), (1, STRETCHPOSE)])
for tr in ad.nla_tracks: tr.mute = True
ad.action = None
MC = pose_mats(CRESTPOSE)
for v in range(n):
    if FAMV[v] == 'crest' and RIGID[v] is None: FAMV[v] = 'body'; W[v] = blend(v, 'body', 6)

# ---- round 3: the lumps on the back are the folded wing shells' inner edges standing 2 to 6 mm proud of the mantle.
# Each shell vertex over an up-facing stretch of body is measured along the body normal; heights between T0 and
# --shell-fit are eased down onto T0 (0.4 mm), so the shell's edge lies on the mantle and its crown is untouched.
FIT = float(opt('--shell-fit', '0.010'))
if FIT:
    def sst(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
    me.calc_loop_triangles(); LT0 = np.array([lt.vertices[:] for lt in me.loop_triangles])
    fn = np.cross(S[LT0[:, 1]] - S[LT0[:, 0]], S[LT0[:, 2]] - S[LT0[:, 0]]); VN = np.zeros_like(S)
    for k in range(3): np.add.at(VN, LT0[:, k], fn)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    bi = np.where(np.array(FAMV) == 'body')[0]; bc_ = S[bi].mean(0)
    if ((S[bi] - bc_) * VN[bi]).sum(1).mean() < 0: VN = -VN   # outward
    kdb2 = KDTree(len(bi))
    for j, v in enumerate(bi): kdb2.insert(tuple(S[v]), j)
    kdb2.balance(); T0 = 0.0004; mvd = []
    for v in [v for v in range(n) if FAMV[v].startswith('wing')]:
        _, j, _ = kdb2.find(tuple(S[v])); b = bi[j]; nb = VN[b]
        if nb[2] < 0.25: continue
        h = float((S[v] - S[b]) @ nb)
        if T0 < h < FIT:
            h2 = h - (h - T0) * (1 - sst(T0, FIT, h)); S[v] = S[v] - (h - h2) * nb; mvd.append(h - h2)
    print('COCKATOO shell fit verts', len(mvd), 'max pull mm', round(1000 * max(mvd or [0]), 2), 'mean mm', round(1000 * float(np.mean(mvd or [0])), 2))
KNB = float(opt('--knob', '0.0008'))
if NEWCREST and KNB:   # round 4: what stood above its ring on the forehead and crown (skull radius over its neighbours' mean)
    rk_ = {v: float(np.linalg.norm(S[v] - SKc)) for v in range(n) if not FAMV[v].startswith(('wing', 'leg', 'crest')) and (JAWI is None or ISL[v] != JAWI)}
    hv_ = [v for v in rk_ if rk_[v] < 1.4 * r60 and S[v, 2] - SKc[2] > 0.35 * r60 and S[v, 1] < SKc[1] + 0.2 * r60]
    seeds = [v for v in hv_ if [w for w in EADJ.get(v, []) if w in rk_] and rk_[v] - np.mean([rk_[w] for w in EADJ[v] if w in rk_]) > KNB]
    if seeds:
        reg = set(seeds); rings = []
        for _ in range(3):
            nxt = {w for u in reg for w in EADJ.get(u, []) if w in rk_} - reg; rings.append(nxt); reg |= nxt
        mv_ = [v for v in reg if v not in rings[-1]]; r0_ = {v: rk_[v] for v in reg}; rr = dict(r0_)
        for _ in range(12):
            for v in mv_:
                nb_ = [w for w in EADJ.get(v, []) if w in rr]
                if nb_: rr[v] = min(rr[v], 0.5 * rr[v] + 0.5 * float(np.mean([rr[w] for w in nb_])))
        for v in mv_: S[v] = SKc + (S[v] - SKc) * (rr[v] / r0_[v])
        print('COCKATOO forehead knob seeds', len(seeds), 'at mm (vs skull centre)', np.round(1000 * (S[seeds] - SKc).mean(0), 1).tolist(),
              'relaxed', len(mv_), 'max drop mm', round(1000 * max(r0_[v] - rr[v] for v in mv_), 2))
# ---- round 4: from behind the folded wings read as two long round tubes standing off the back. Each shell's height
# over the body (along the nearest body normal) is scaled by --wing-flat from a third of the way down its long axis,
# so it lies against the back as a plate; from halfway the tips swing in to the midline and cross it by --wing-cross
# (m), the left over the right (lifted by the right tip's thickness), as the primaries cross over a real bird's tail.
def sstep(a, b, x): t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
WFL = float(opt('--wing-flat', '0.55')); WXC = float(opt('--wing-cross', '0.004'))
def body_frame():
    me.calc_loop_triangles(); LT0 = np.array([lt.vertices[:] for lt in me.loop_triangles])
    fn = np.cross(S[LT0[:, 1]] - S[LT0[:, 0]], S[LT0[:, 2]] - S[LT0[:, 0]]); VN = np.zeros_like(S)
    for k in range(3): np.add.at(VN, LT0[:, k], fn)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    bi = np.where(np.array(FAMV) == 'body')[0]; bc_ = S[bi].mean(0)
    if ((S[bi] - bc_) * VN[bi]).sum(1).mean() < 0: VN = -VN
    kd_ = KDTree(len(bi))
    for j, v in enumerate(bi): kd_.insert(tuple(S[v]), j)
    kd_.balance(); return bi, VN, kd_
if WFL < 1 or WXC:
    bi, VN, kdb3 = body_frame(); TIPD = {}
    for sd in ('_R', '_L'):   # the right first: the left tip is lifted over it
        sv = np.array([v for v in range(n) if FAMV[v] == 'wing' + sd])
        if not len(sv): continue
        X_ = S[sv]; c_ = X_.mean(0); A_ = np.linalg.svd(X_ - c_)[2][0]
        if A_ @ np.array([0, 0.5, -0.87]) < 0: A_ = -A_
        pr = (X_ - c_) @ A_; t_ = (pr - pr.min()) / (pr.max() - pr.min())
        nb_ = np.zeros_like(X_); h_ = np.zeros(len(sv))
        for k, v in enumerate(sv):
            _, j, _ = kdb3.find(tuple(S[v])); b = bi[j]; nb_[k] = VN[b]; h_[k] = (S[v] - S[b]) @ VN[b]
        f_ = 1 - (1 - WFL) * sstep(0.2, 0.45, t_) * sstep(0.1, 0.5, nb_ @ np.array([0.0, 0.8, 0.6]))   # the back, not the flank
        X_ = X_ - (np.maximum(h_, 0) * (1 - f_))[:, None] * nb_
        tip = t_ > 0.9; sg = 1.0 if X_[tip, 0].mean() > 0 else -1.0
        X_[:, 0] -= (X_[tip, 0].mean() + sg * WXC) * sstep(0.5, 1.0, t_)
        hn = h_ * f_; thick = float(hn[t_ > 0.85].max() - hn[t_ > 0.85].min())
        if sd == '_L' and '_R' in TIPD:
            dn = nb_[t_ > 0.8].mean(0); dn[0] = 0.0; dn /= np.linalg.norm(dn)
            X_ += (TIPD['_R'] + 0.0006) * sstep(0.55, 0.8, t_)[:, None] * dn[None, :]
        TIPD[sd] = thick
        print('COCKATOO wing shell', sd, 'verts', len(sv), 'length mm', round(1000 * float(pr.max() - pr.min()), 1), 'height over body mm p90',
              round(1000 * float(np.percentile(h_, 90)), 1), '->', round(1000 * float(np.percentile(hn, 90)), 1), 'tip x mm', round(1000 * float(S[sv][tip, 0].mean()), 1),
              '->', round(1000 * float(X_[tip, 0].mean()), 1), 'tip thickness mm', round(1000 * thick, 1))
        S[sv] = X_
# ---- round 4: the dark sliver past the folded wing's edge (seen from above and behind) is the top of a leg shell: the
# thigh and knee of the big leg island stand past the flank (outside every body and wing vertex at the same height and
# depth). Each such leg vertex is pulled in to 1.5 mm inside that outline, so the flank and the wing cover it.
LIN = float(opt('--leg-in', '0'))   # OFF: it pulled the thighs up to 10 mm and tore the belly (k_feet_side, round 4)
if LIN:
    ev_ = np.array([v for v in range(n) if FAMV[v] == 'body' or FAMV[v].startswith('wing')])
    kde = KDTree(len(ev_))
    for j, v in enumerate(ev_): kde.insert((0.0, float(S[v, 1]), float(S[v, 2])), j)
    kde.balance(); pulled = {}
    for v in [v for v in range(n) if FAMV[v].startswith('leg')]:
        hits_ = kde.find_range((0.0, float(S[v, 1]), float(S[v, 2])), 0.005)
        same = [ev_[j] for _, j, _ in hits_ if S[ev_[j], 0] * S[v, 0] > 0]
        if len(same) < 3: continue
        env = max(abs(S[w, 0]) for w in same)
        if abs(S[v, 0]) > env - LIN:
            d_ = abs(S[v, 0]) - (env - LIN); S[v, 0] -= math.copysign(d_, S[v, 0]); pulled.setdefault(int(ISL[v]), []).append((v, d_))
    for i_, lst in pulled.items():
        P_ = S[[v for v, _ in lst]]
        print('COCKATOO leg sliver island', i_, 'family', FAMV[lst[0][0]], 'island verts', int((ISL == i_).sum()), 'pulled', len(lst), 'max mm', round(1000 * max(d for _, d in lst), 2),
              'y..', np.round(1000 * P_[:, 1].min(), 1), np.round(1000 * P_[:, 1].max(), 1), 'z..', np.round(1000 * P_[:, 2].min(), 1), np.round(1000 * P_[:, 2].max(), 1))
# round 4: the sliver itself (found by casting the m1 camera's rays: `--render dir --only m probe`) is the outer edge
# of each foot (bone foot_L / foot_R, the big leg island, 20 to 21 mm off the midline at the sole), peeking past the
# folded wing's lower edge from above and behind. The foot's outer part beyond 16 mm is drawn in (--foot-in keeps 40%).
FIN = float(opt('--foot-in', '0.4'))
if FIN < 1:
    lv_ = np.array([v for v in range(n) if FAMV[v].startswith('leg')]); zf_ = S[lv_, 2].min()
    fv_ = lv_[(S[lv_, 2] < zf_ + 0.014) & (np.abs(S[lv_, 0]) > 0.016)]
    if len(fv_):
        x0_ = S[fv_, 0].copy(); S[fv_, 0] = np.sign(x0_) * (0.016 + (np.abs(x0_) - 0.016) * FIN)
        print('COCKATOO foot in verts', len(fv_), 'max |x| mm', round(1000 * float(np.abs(x0_).max()), 1), '->', round(1000 * float(np.abs(S[fv_, 0]).max()), 1))
_c = S.mean(0); _a = np.linalg.svd(S - _c)[2][0]; _p = (S - _c) @ _a
print('COCKATOO perched length (beak to tail along the body axis) m', round(float(_p.max() - _p.min()), 4), 'height m', round(float(S[:, 2].max() - S[:, 2].min()), 4))
# ---- round 3: seen from above and behind, the claw of the outer back toe stuck out past the folded wing's edge as a
# dark sliver (it goes with the legs hidden). Each toe shell turns about a vertical axis at its root toward the
# midline by --toe-in degrees, so the claws stay inside the body's outline from above (heights, so the grip, unchanged).
TOEIN = float(opt('--toe-in', '0'))   # OFF: 12 degrees did not move the sliver (it is not these toe shells)
if TOEIN:
    for sd in ('_L', '_R'):
        li = [i for i in ids if FAMV[int(np.where(ISL == i)[0][0])] == 'leg' + sd]
        if len(li) < 2: continue
        big_ = max(li, key=lambda i: int((ISL == i).sum())); tc = S[ISL == big_].mean(0)
        for i in li:
            if i == big_: continue
            vs = np.where(ISL == i)[0]; rt = S[vs[np.linalg.norm(S[vs] - tc, axis=1).argmin()]].copy(); cen = S[vs].mean(0)
            if abs(cen[1] - rt[1]) < 0.004: continue
            a_ = math.radians(TOEIN) * (1 if cen[0] > 0 else -1) * (1 if cen[1] > rt[1] else -1)
            c_, s_ = math.cos(a_), math.sin(a_); d_ = S[vs] - rt
            S[vs] = rt + np.stack([c_ * d_[:, 0] - s_ * d_[:, 1], s_ * d_[:, 0] + c_ * d_[:, 1], d_[:, 2]], 1)
            print('COCKATOO toe in', sd, 'island', int(i), 'verts', len(vs), 'x', round(cen[0], 4), '->', round(S[vs].mean(0)[0], 4))
# ============================================================== 4. invert the skinning into the flight rest pose
REST = np.zeros((n, 3))
for v in range(n):
    p = np.append(S[v], 1.0)
    if RIGID[v]:
        M = (MC if FAMV[v] == 'crest' else MP)[RIGID[v]]; W[v] = {RIGID[v]: 1.0}
    else: M = sum((MC if v in CMIX else MP)[bn] * w for bn, w in W[v].items())   # skull plumes are bound raised
    REST[v] = (np.linalg.inv(M) @ p)[:3]
# ---- round 2: smooth the lumpy back. The source's back and mantle (body shell, facing up in the rest pose, between the
# nape and the rump) carry small modelled lumps that read as a bumpy silhouette. A Taubin smooth (a shrink pass, then an
# inflate pass, so the back does not sink into a dip) relaxes them; the vertices slide by at most a few mm, so the texture
# barely moves;
# a falloff at the region's border blends it into the untouched mesh. Positions only: weights, UVs and topology stay.
SMOOTH = int(opt('--back-smooth', '0')); FEATHER = int(opt('--feather', '1'))   # smoothing OFF by default: measured worse (docs/cockatoo.md, round 2)
me.calc_loop_triangles()
LT = np.array([lt.vertices[:] for lt in me.loop_triangles]); LL = np.array([lt.loops[:] for lt in me.loop_triangles])
def sstep(a, b, x): t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def vnormals(X):
    fn = np.cross(X[LT[:, 1]] - X[LT[:, 0]], X[LT[:, 2]] - X[LT[:, 0]]); vn = np.zeros_like(X)
    for k in range(3): np.add.at(vn, LT[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
if SMOOTH:
    yn, yr = arm_d.bones['neck1'].head_local[1], arm_d.bones['tail'].head_local[1]
    wv = sstep(0.25, 0.55, vnormals(REST)[:, 2]) * sstep(yn, yn + 0.02, REST[:, 1]) * (1 - sstep(yr - 0.02, yr, REST[:, 1]))
    wv *= (ISL == BODY_ID) & np.array([f == 'body' for f in FAMV])
    X = REST.copy(); deg = np.maximum(np.bincount(E.ravel(), minlength=n), 1).astype(float)[:, None]
    for it in range(SMOOTH):
        for lam in (0.5, -0.53):
            nb = np.zeros_like(X); np.add.at(nb, E[:, 0], X[E[:, 1]]); np.add.at(nb, E[:, 1], X[E[:, 0]])
            X += (lam * wv)[:, None] * (nb / deg - X)   # full-vector Taubin: a normal-only step creased the irregular mesh
    mv = np.linalg.norm(X - REST, axis=1); REST = X
    print('COCKATOO back smooth verts', int((wv > 0.01).sum()), 'max move', round(1000 * mv.max(), 2), 'mm mean move',
          round(1000 * mv[wv > 0.01].mean(), 2), 'mm nape/rump y', round(yn, 3), round(yr, 3))
me.vertices.foreach_set('co', REST.ravel()); me.update()
names = [b.name for b in arm_d.bones]
for bn in names: src.vertex_groups.new(name=bn)
for v, w in enumerate(W):
    for bn, val in w.items(): src.vertex_groups[bn].add([v], float(val), 'REPLACE')

# ============================================================== 5. the open wing
# The source has only a folded wing. The open wing is the procedural bird's: ten primaries that fan into slotted
# fingers, eleven secondaries and three tertials, layered coverts and a sulphur wash beneath, all on the wing bones.
# The game shows each wing only in the pose it was made for: `upper` scales to nothing while perched (the open wing
# folds away into the shoulder) and `shell` scales to nothing in flight (the folded shell tucks into the body).
CHORD = float(opt('--chord', '2.0'))
wing = ob.copy(); wing.data = ob.data.copy(); bpy.context.scene.collection.objects.link(wing)
keep = np.array([f.startswith('wing') for f in DFAM])
bm = bmesh.new(); bm.from_mesh(wing.data); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(~keep)[0]], context='VERTS'); bm.to_mesh(wing.data); bm.free()
WV = np.array([v.co[:] for v in wing.data.vertices])
BR = REST[np.array([FAMV[v] == 'body' for v in range(n)])]
sl = BR[(np.abs(BR[:, 1] + 0.045) < 0.012) & (np.abs(BR[:, 2] - 0.030) < 0.010)]
half = np.abs(sl[:, 0]).max() if len(sl) else 0.046
dx = min(0.0, (half - 0.008) - 0.046)                    # the root goes into the sourced body: no gap at the shoulder
ax_ = np.abs(WV[:, 0])
WV[:, 0] += np.sign(WV[:, 0]) * dx * np.clip((0.20 - ax_) / 0.12, 0, 1)
WB = np.array([DOM[i][:-2] for i in np.where(keep)[0]])
KF = np.array([1.0 if (b_[0] == 's' or b_ == 't') else {'p1': 0.8, 'p2': 0.55, 'p3': 0.3}.get(b_, 0.0) for b_ in WB])
Y0 = 0.02   # the coverts end about here: only the flight feathers beyond them lengthen, so the coverts keep their shape
WV[:, 1] = np.where(WV[:, 1] > Y0, Y0 + (WV[:, 1] - Y0) * (1 + (CHORD - 1) * KF), WV[:, 1])   # a cockatoo's broad chord
wing.data.vertices.foreach_set('co', WV.ravel()); wing.data.update()
if NEWCREST:
    crest = ob.copy(); crest.data = ob.data.copy(); bpy.context.scene.collection.objects.link(crest)
    bm = bmesh.new(); bm.from_mesh(crest.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(DFAM != 'crest')[0]], context='VERTS'); bm.to_mesh(crest.data); bm.free()
    CR = np.array([(np.linalg.inv(MP[b]) @ np.append(p_, 1.0))[:3] for p_, b in zip(CPOS, CBONE)])
    assert len(CR) == len(crest.data.vertices)
    crest.data.vertices.foreach_set('co', CR.ravel()); crest.data.update()
print('COCKATOO wing body half-width', round(half, 4), 'root shift', round(dx, 4), 'span', round(WV[:, 0].max() - WV[:, 0].min(), 3),
      'chord', round(WV[np.abs(WV[:, 0] - 0.15) < 0.01, 1].max() - WV[np.abs(WV[:, 0] - 0.15) < 0.01, 1].min(), 3),
      'body top at shoulder', round(BR[(np.abs(BR[:, 1] + 0.045) < 0.012) & (np.abs(BR[:, 0]) < 0.01), 2].max(), 4))
def albedo(m):
    return [nd.image for nd in (m.node_tree.nodes if m and m.node_tree else []) if nd.type == 'TEX_IMAGE' and nd.image and nd.image.colorspace_settings.name == 'sRGB']
def white_of(img):   # the plumage white: the brightest tenth by darkest channel (yellow and grey fall out)
    px = np.array(img.pixels[:]).reshape(-1, 4); px = px[px[:, 3] > 0.5]; mn = px[:, :3].min(1)
    return px[mn >= np.percentile(mn, 90), :3].mean(0)
SRCW = white_of(albedo(src.data.materials[0])[0])
for m in wing.data.materials:
    if m is None: continue
    m.name = {'plumage': 'wing_arm', 'feathers': 'wing_feathers'}.get(m.name, 'wing_' + m.name)
    for img in (albedo(m) if m.name in ('wing_arm', 'wing_feathers') else []):
        tint = np.clip(SRCW / white_of(img), 0.7, 1.2)
        px = np.array(img.pixels[:]).reshape(-1, 4); px[:, :3] = np.clip(px[:, :3] * tint, 0, 1)
        img.pixels = px.ravel().tolist(); img.update(); img.pack()
        print('COCKATOO wing tint', img.name, np.round(tint, 3).tolist(), 'source white', np.round(SRCW, 3).tolist())
if NEWCREST:   # round 3: the crest slot of the feather atlas, lifted from pale lemon to sulphur (saturation x1.4 on the yellow)
    for im in [im for im in bpy.data.images if 'feathers_col' in im.name]:
        wx, hy = im.size; px_ = np.array(im.pixels[:]).reshape(hy, wx, 4); x0_, x1_ = wx * 512 // 1024, wx * 640 // 1024
        c_ = px_[:, x0_:x1_, :3]; lm_ = (c_ @ np.array([0.2126, 0.7152, 0.0722]))[..., None]; yw = np.clip((c_[..., 0:1] - c_[..., 2:3] - 0.05) / 0.1, 0, 1)
        SUL = np.array([0.98, 0.84, 0.25]); CSUL = float(opt('--crest-lum', '0.66'))   # round 4: sulphur into white, no olive
        tg_ = SUL[None, None, :] * (np.maximum(lm_, CSUL) / float(SUL @ np.array([0.2126, 0.7152, 0.0722])))
        px_[:, x0_:x1_, :3] = np.clip(c_ * (1 - yw) + tg_ * yw, 0, 1); im.pixels.foreach_set(px_.astype(np.float32).ravel())
        print('COCKATOO crest atlas', im.name, im.size[:], 'yellow texels', int((yw > 0.5).sum()), 'mean', np.round(px_[:, x0_:x1_, :3][yw[..., 0] > 0.5].mean(0), 3).tolist())
bpy.data.objects.remove(ob, do_unlink=True)

# ============================================================== 5b. feather detail on the sourced body (round 2)
# The source body has one 512 px albedo and no normal map, so up close it reads soft and flat. This adds a 1k
# tangent-space normal map of shingled contour feathers (rounded tips in overlapping rows, fine oblique barbs, a faint
# rachis) laid along the feather flow (away from the bill, bending back and down the neck, flanks and breast; along each
# crest feather; along the folded wing), and multiplies the bicubic-upscaled albedo by a few percent of the same pattern
# (under-lip shade and tip edges a touch darker and cooler, the rachis a hair brighter), normalised so every local mean,
# and so every region's colour, is unchanged. The pattern lives in 3D on the perched mesh and is read out per texel, so
# it runs on across UV seams; gradients are taken one texel step along each chart's own UV axes (no cross-seam taps).
NSTR = float(opt('--nrm-strength', '0.8'))
def feather_layer(img, TW=1024, K=12, seed=7):
    rng = np.random.default_rng(seed)
    buf = np.zeros(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', buf); UV = buf.reshape(-1, 2)
    Q = S[LT] * 1000.0; PUV = UV[LL] * TW - 0.5; VNS = vnormals(S); TI = ISL[LT[:, 0]]   # mm, perched; texel centres
    lm = landmarks(S, top) * 1000.0; H = np.array([0.0, lm[0, 0], lm[0, 1]]); TP = np.array([0.0, lm[1, 0], lm[1, 1]])
    AX = (TP - H) / np.linalg.norm(TP - H); LB = np.linalg.norm(TP - H)
    FA = np.array(FAMV); beak = {i for _, i in BEAKI}; kind, ROOT, CAX = {}, {}, {}; LEGI = set()
    for i in ids:
        vs = np.where(ISL == i)[0]; fu, fc = np.unique(FA[vs], return_counts=True); maj = fu[fc.argmax()]
        if maj.startswith('leg'): LEGI.add(i)
        if i in beak: kind[i] = None
        elif i in CRESTI:
            kind[i] = 'crest'; P_ = S[vs] * 1000.0; sk = S[ISL == skull[1]].mean(0) * 1000.0
            ROOT[i] = P_[np.linalg.norm(P_ - sk, axis=1).argmin()]; tip = P_[np.linalg.norm(P_ - ROOT[i], axis=1).argmax()]
            CAX[i] = (tip - ROOT[i]) / np.linalg.norm(tip - ROOT[i])
        elif i in (BODY_ID, skull[1]): kind[i] = 'radial'
        else:
            P_ = S[vs] * 1000.0; ax = np.linalg.svd(P_ - P_.mean(0), full_matrices=False)[2][0]
            kind[i] = 'axis'; CAX[i] = ax * np.sign(ax @ AX or 1.0)
    def unit(a): return a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-9)
    def flow(P, N, i):
        if kind[i] == 'radial':
            r = P - H; d = np.linalg.norm(r, axis=1, keepdims=True); f = r / d + 0.8 * sstep(30, 100, d) * AX
        elif kind[i] == 'crest': f = P - ROOT[i]
        else: f = np.broadcast_to(CAX[i], P.shape).copy()
        return unit(f - (f * N).sum(1, keepdims=True) * N)
    def spacing(P, i):   # feather spacing in mm: small on the head, larger on the body, largest on the tail and wing
        r = np.interp(((P - H) @ AX) / LB, [0.0, 0.12, 0.28, 0.7, 1.0], [3.0, 3.4, 6.0, 6.5, 9.0])
        return r * (1.3 if kind[i] == 'axis' else 1.0)
    # rasterise the triangles in UV
    tri_of = -np.ones((TW, TW), np.int64); bary = np.zeros((TW, TW, 3)); hits = np.zeros((TW, TW), np.int32)
    for t in range(len(LT)):
        p = PUV[t]; x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0); x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), TW - 1)
        d = (p[1, 0] - p[0, 0]) * (p[2, 1] - p[0, 1]) - (p[2, 0] - p[0, 0]) * (p[1, 1] - p[0, 1])
        if x1 < x0 or y1 < y0 or abs(d) < 1e-9 or kind.get(TI[t]) is None: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        l1 = ((xs - p[0, 0]) * (p[2, 1] - p[0, 1]) - (p[2, 0] - p[0, 0]) * (ys - p[0, 1])) / d
        l2 = ((p[1, 0] - p[0, 0]) * (ys - p[0, 1]) - (xs - p[0, 0]) * (p[1, 1] - p[0, 1])) / d
        l0 = 1 - l1 - l2; ins = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
        tri_of[ys[ins], xs[ins]] = t; bary[ys[ins], xs[ins]] = np.stack([l0, l1, l2], -1)[ins]; hits[ys[ins], xs[ins]] += 1
    d1, d2 = PUV[:, 1] - PUV[:, 0], PUV[:, 2] - PUV[:, 0]; e1, e2 = Q[:, 1] - Q[:, 0], Q[:, 2] - Q[:, 0]
    det = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]; det = np.where(np.abs(det) < 1e-9, 1e-9, det)[:, None]
    JX = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / det; JY = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / det   # mm per texel step
    COV = tri_of >= 0; ys, xs = np.where(COV); tt = tri_of[ys, xs]; bc = bary[ys, xs]
    SHI = sorted({int(ISL[v]) for v in range(n) if FAMV[v].startswith('wing')}); SHM = np.zeros(COV.shape)
    SHM[ys, xs] = np.isin(TI[tt], SHI).astype(float)
    P = (Q[tt] * bc[:, :, None]).sum(1); N = unit((VNS[LT[tt]] * bc[:, :, None]).sum(1))
    TXS = np.sqrt(np.linalg.norm(np.cross(JX, JY), axis=1))
    # albedo: bicubic 2x per axis (Keys, a = -0.5) up to TW
    px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)[..., :3]
    def up(a, ax):
        m_ = a.shape[ax]; x = (np.arange(TW) + 0.5) * m_ / TW - 0.5; i0 = np.floor(x).astype(int); t_ = x - i0; o = 0
        for k in (-1, 0, 1, 2):
            dd = np.abs(t_ - k); w = np.where(dd <= 1, 1.5 * dd ** 3 - 2.5 * dd ** 2 + 1, np.where(dd < 2, -0.5 * dd ** 3 + 2.5 * dd ** 2 - 4 * dd + 2, 0))
            sh = [1, 1, 1]; sh[ax] = TW; o = o + np.take(a, np.clip(i0 + k, 0, m_ - 1), axis=ax) * w.reshape(sh)
        return o
    UP = np.clip(up(up(px, 0), 1), 0, 1)
    # round 3: the source painted the thighs tan and the tail tip blue-grey. The thigh feathers go white like the body
    # (the grey scaled tarsus and toes keep their colour); the tail tip goes white, with a pale sulphur wash beneath.
    # Luminance is kept, so the painted shading stays. The leg islands are rasterised now, so the white thighs also
    # get the feather relief (the grey scales stay masked out by value).
    u_ = UP[ys, xs]; LW = np.array([0.2126, 0.7152, 0.0722]); lum = u_ @ LW; wl = SRCW @ LW
    legt = np.isin(TI[tt], list(LEGI)).astype(float)
    LGV = S[np.isin(ISL, list(LEGI))]; kdl = KDTree(len(LGV))
    for j, q_ in enumerate(LGV): kdl.insert(tuple(q_), j)
    kdl.balance(); dleg = np.array([kdl.find(tuple(q_ / 1000.0))[2] for q_ in P])
    near = np.maximum(legt, sstep(0.045, 0.02, dleg))
    tanw = near * sstep(0.02, 0.06, u_[:, 0] - u_[:, 2]) * sstep(0.012, 0.035, u_[:, 0] - u_[:, 1]) * sstep(0.28, 0.40, u_.max(1))
    lt_ = lum[tanw > 0.5].mean() if (tanw > 0.5).any() else 1.0
    thigh = (SRCW * 0.98)[None, :] * np.clip(lum / lt_, 0.8, 1.06)[:, None]
    prj = ((P - H) @ AX) / LB
    tl_ = prj > 0.9; print('COCKATOO tail tip albedo mean', np.round(u_[tl_].mean(0), 3).tolist() if tl_.any() else None, 'white', np.round(SRCW, 3).tolist())
    tailw = 0.85 * (1 - legt) * sstep(0.74, 0.88, prj)
    TLF = float(opt('--tail-lift', '0.93')); WARM = np.array([1.0, 0.975, 0.925]); WARM = WARM / (WARM @ LW)   # round 4
    neutral = np.maximum(lum, TLF * wl)[:, None] * (SRCW / wl)[None, :] * WARM[None, :]   # the shade lifted to a warm white
    under = (1 - legt) * sstep(0.62, 0.80, prj) * sstep(-0.15, -0.6, N[:, 2])
    PALE = np.array([1.0, 0.94, 0.66]); pale = lum[:, None] * (PALE / (PALE @ LW))[None, :]
    nu = u_ * (1 - tanw)[:, None] + thigh * tanw[:, None]
    nu = nu * (1 - tailw)[:, None] + neutral * tailw[:, None]
    nu = nu * (1 - 0.3 * under)[:, None] + pale * (0.3 * under)[:, None]
    if NEWCREST and len(PRV):   # round 4: the yellow stain the old crest left on the forehead and crown goes to white
        Pm = P / 1000.0; rel = Pm - SKc; dsk = np.linalg.norm(rel, axis=1)
        brow = (1 - legt) * sstep(1.35 * r60, 1.1 * r60, dsk) * sstep(0.002, 0.009, rel[:, 2]) * sstep(0.015, 0.05, u_[:, 0] - u_[:, 2])
        nu = nu * (1 - brow)[:, None] + (np.maximum(lum, 0.9 * wl)[:, None] * (SRCW / wl)[None, :]) * brow[:, None]
        print('COCKATOO brow stain texels', int((brow > 0.5).sum()))
    UP[ys, xs] = np.clip(nu, 0, 1)
    print('COCKATOO recolour thigh texels', int((tanw > 0.5).sum()), 'tan lum', round(float(lt_), 3), 'tail tip texels', int((tailw > 0.5).sum()),
          'under-tail wash texels', int((under > 0.5).sum()))
    V = UP.max(-1); FM = sstep(0.42, 0.62, V)   # plumage only: the grey beak, feet and the dark eye get no feathers
    # feathers: dart-thrown centres per island, each with its own frame, size, rank (front rows lie on top) and lift
    A_SH, A_B, A_R, ANG = 0.2, 0.018, 0.025, math.radians(38)
    NRM = np.zeros((TW, TW, 3)); NRM[..., 2] = 1; FAC = np.ones((TW, TW, 3)); nfeat = 0
    def fh(u, v, rho, R, PB, ho):   # one feather's height (mm) at its local (u along, v across) coordinates
        bar = np.cos(2 * np.pi * (-u * math.sin(ANG) + np.abs(v) * math.cos(ANG)) / PB)
        return (A_SH * np.clip(rho, 0, 1) ** 1.3 + ho + A_B * bar * sstep(0.15, 0.5, np.abs(v)) * (1 - sstep(0.8, 0.97, rho))
                + A_R * np.exp(-(v / 0.28) ** 2) * (1 - sstep(0.6, 0.9, rho))), bar
    for i in [i for i in ids if kind.get(i)]:
        sel = np.where(TI[tt] == i)[0]
        if not len(sel): continue
        PB = max(1.0, 3.2 * float(np.median(TXS[tt[sel]])))
        if kind[i] == 'crest':
            Pq, Nq = P[sel], N[sel]; side = unit(np.cross(Nq, CAX[i]))
            def hc(X_):
                dd = X_ - ROOT[i]; u = dd @ CAX[i]; v = ((dd - u[:, None] * CAX[i]) * side).sum(1)
                bar = np.cos(2 * np.pi * (-u * math.sin(ANG) + np.abs(v) * math.cos(ANG)) / PB)
                return 1.2 * A_B * bar * sstep(0.1, 0.4, np.abs(v)) + A_R * np.exp(-(v / 0.25) ** 2), bar, v
            h0, bar, v = hc(Pq); hx = hc(Pq + JX[tt[sel]])[0]; hy = hc(Pq + JY[tt[sel]])[0]
            m = 1 + (0.02 * np.exp(-(v / 0.25) ** 2) + 0.008 * bar)[:, None] * np.ones(3)
        else:
            tl = np.where(TI == i)[0]; q = Q[tl]; ar = 0.5 * np.linalg.norm(np.cross(q[:, 1] - q[:, 0], q[:, 2] - q[:, 0]), axis=1)
            nc = int(min(200000, 5 * ar.sum() / 3.0 ** 2)) + 8
            pick = rng.choice(len(tl), nc, p=ar / ar.sum()); b = rng.random((nc, 2)); fl = b.sum(1) > 1; b[fl] = 1 - b[fl]
            bb = np.stack([1 - b.sum(1), b[:, 0], b[:, 1]], 1); cp = (q[pick] * bb[:, :, None]).sum(1)
            cn = unit((VNS[LT[tl[pick]]] * bb[:, :, None]).sum(1)); rr = spacing(cp, i)
            cell = rr.max(); keys = np.floor(cp / cell).astype(int); grid = {}; keep = []
            for j in range(nc):
                kx, ky, kz = keys[j]; ok_ = True
                for ox in (-1, 0, 1):
                    for oy in (-1, 0, 1):
                        for oz in (-1, 0, 1):
                            for k2 in grid.get((kx + ox, ky + oy, kz + oz), ()):
                                if math.dist(cp[j], cp[k2]) < rr[j]: ok_ = False; break
                            if not ok_: break
                        if not ok_: break
                    if not ok_: break
                if ok_: keep.append(j); grid.setdefault((kx, ky, kz), []).append(j)
            C = cp[keep]; Nc = cn[keep]; F = flow(C, Nc, i); th = rng.uniform(-0.14, 0.14, len(C))[:, None]
            F = unit(F * np.cos(th) + np.cross(Nc, F) * np.sin(th)); Sd = np.cross(Nc, F); R = rr[keep] * rng.uniform(0.9, 1.1, len(C))
            G = (np.linalg.norm(C - H, axis=1) if kind[i] == 'radial' else C @ CAX[i]) + rng.normal(0, 0.25, len(C)) * R
            HO = rng.uniform(0, 0.03, len(C)); nfeat += len(C)
            if kind[i] == 'axis':   # folded wing: coverts near the shoulder, long flight feathers toward the tip
                t_ = C @ CAX[i]; t_ = (t_ - t_.min()) / max(np.ptp(t_), 1e-6); EL = np.interp(t_, [0, 0.35, 1], [1.6, 2.2, 4.2]); WD = np.interp(t_, [0, 1], [1.05, 1.25])
            else:   # body: the tail's rectrices are long too
                EL = np.interp(((C - H) @ AX) / LB, [0, 0.8, 0.97], [1.6, 1.6, 3.2]); WD = np.full(len(C), 1.05)
            kd = KDTree(len(C))
            for j, c in enumerate(C): kd.insert(tuple(c), j)
            kd.balance(); kk = min(K, len(C))
            cand = np.array([[j for _, j, _ in kd.find_n(tuple(p_), kk)] for p_ in P[sel]])
            def hs(X_, cd):
                dd = X_[:, None, :] - C[cd]; u = (dd * F[cd]).sum(-1); v = (dd * Sd[cd]).sum(-1); Rc = R[cd]
                rho = np.sqrt((u / (EL[cd] * Rc)) ** 2 + (v / (WD[cd] * Rc)) ** 2); sc = np.where(rho < 1, G[cd], np.inf)
                o = np.argsort(sc, 1)[:, :2]; ar_ = np.arange(len(X_))
                none = ~np.isfinite(sc[ar_, o[:, 0]]); o[none, 0] = rho[none].argmin(1)
                g = lambda a_, k: a_[ar_, o[:, k]]
                h1, bar = fh(g(u, 0), g(v, 0), g(rho, 0), g(Rc, 0), PB, HO[g(cd, 0)])
                h2 = np.where(g(rho, 1) < 1, fh(g(u, 1), g(v, 1), g(rho, 1), g(Rc, 1), PB, HO[g(cd, 1)])[0], 0.0)
                e = sstep(0.86, 1.0, g(rho, 0))
                return (1 - e) * h1 + e * h2, g(rho, 0), e, g(v, 0), bar
            h0 = np.zeros(len(sel)); hx = np.zeros(len(sel)); hy = np.zeros(len(sel)); m = np.ones((len(sel), 3))
            for c0 in range(0, len(sel), 60000):
                cs = slice(c0, c0 + 60000); s_ = sel[cs]; cd = cand[cs]
                h0[cs], rho, e, v, bar = hs(P[s_], cd); hx[cs] = hs(P[s_] + JX[tt[s_]], cd)[0]; hy[cs] = hs(P[s_] + JY[tt[s_]], cd)[0]
                dark = (0.035 * (1 - sstep(0.35, 0.8, rho)) + 0.02 * 4 * e * (1 - e))[:, None] * np.array([1.0, 0.97, 0.86])
                m[cs] = 1 - dark + (0.022 * np.exp(-(v / 0.3) ** 2) * (1 - sstep(0.6, 0.9, rho)) + 0.006 * bar)[:, None]
        s_ = sel; gx = (hx - h0) / np.linalg.norm(JX[tt[s_]], axis=1); gy = (hy - h0) / np.linalg.norm(JY[tt[s_]], axis=1)
        fm = FM[ys[s_], xs[s_]][:, None]
        NRM[ys[s_], xs[s_]] = unit((1 - fm) * np.array([0, 0, 1.0]) + fm * unit(np.stack([-gx, -gy, np.ones_like(gx)], 1)))
        FAC[ys[s_], xs[s_]] = 1 + fm * (m - 1)
    def box(a, r):
        c = np.cumsum(np.cumsum(np.pad(a, [(r + 1, r), (r + 1, r)] + [(0, 0)] * (a.ndim - 2)), 0), 1)
        return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]
    cw = COV[..., None].astype(float); FAC = np.where(COV[..., None], FAC / np.maximum(box(FAC * cw, 24) / np.maximum(box(cw, 24), 1e-9), 1e-3), 1.0)
    def dilate(a, cov, it=6):   # carry the edge texels into the gutter so bilinear and mip taps never see a seam
        a = a.copy(); cov = cov.copy()
        for _ in range(it):
            s = np.zeros_like(a); c = np.zeros(cov.shape)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy or dx: s += np.roll(a * cov[..., None], (dy, dx), (0, 1)); c += np.roll(cov, (dy, dx), (0, 1))
            nw = ~cov & (c > 0); a[nw] = s[nw] / c[nw][:, None]; cov = cov | nw
        return a, cov
    NRM = unit(dilate(NRM, COV)[0]); FAC = dilate(FAC, COV)[0]
    COL = np.clip(UP * FAC, 0, 1)
    sat = (V - UP.min(-1)) / np.maximum(V, 1e-6); used = np.ones_like(COV)   # whole image: the beak and feet regions too
    for nm_, rg in (('white', (sat < 0.15) & (V > 0.6)), ('yellow', (sat > 0.25) & (V > 0.5)), ('grey', V < 0.45), ('all', np.ones_like(V, bool))):
        r_ = rg & used; print('COCKATOO albedo region', nm_, 'texels', int(r_.sum()), 'mean shift %', np.round(100 * (COL[r_].mean(0) / UP[r_].mean(0) - 1), 3).tolist(),
                             'vs 512 source %', np.round(100 * (COL[r_].mean(0) / px.reshape(-1, 3).mean(0) - 1), 1).tolist() if nm_ == 'all' else '')
    print('COCKATOO feather layer tex', TW, 'covered', int(COV.sum()), 'overlap', int((hits > 1).sum()), 'feathers', nfeat, 'texel mm median',
          round(float(np.median(TXS)), 3), 'islands', {str(k): v for k, v in kind.items() if v}, 'normal tilt deg p50/p99',
          np.round(np.degrees(np.arccos(np.clip(np.percentile(NRM[COV][:, 2], [50, 1]), -1, 1))), 1).tolist())
    def save(name, arr, fmt, ext, noncolor):
        pth = os.path.join(bpy.app.tempdir or '/tmp', name + ext); im = bpy.data.images.new(name, TW, TW, alpha=False)
        if noncolor: im.colorspace_settings.name = 'Non-Color'
        im.pixels.foreach_set(np.concatenate([arr, np.ones((TW, TW, 1))], -1).astype(np.float32).ravel())
        im.filepath_raw = pth; im.file_format = fmt
        try: im.save(filepath=pth, quality=92)
        except TypeError: im.save()
        bpy.data.images.remove(im); im = bpy.data.images.load(pth); im.name = name; im.pack()
        if noncolor: im.colorspace_settings.name = 'Non-Color'
        back = np.array(im.pixels[:]).reshape(TW, TW, 4)[..., :3]
        print('COCKATOO feather image', name, fmt, 'bytes', os.path.getsize(pth), 'round-trip rms', round(float(np.sqrt(((back - arr) ** 2).mean())), 4))
        return im
    SRL = float(opt('--shell-relief', '1.8'))   # round 4: the folded wing's feather edges in relief, not a smooth tube
    NRM = unit(NRM * np.array([NSTR, NSTR, 1.0]) * np.stack([1 + (SRL - 1) * SHM, 1 + (SRL - 1) * SHM, np.ones_like(SHM)], -1))   # round 3: strength baked in (src/engine ignores normalTexture.scale)
    return save('body_feather_col', COL, 'JPEG', '.jpg', False), save('body_feather_nrm', NRM * 0.5 + 0.5, 'PNG', '.png', True)
if FEATHER:
    SRCIMG = albedo(src.data.materials[0])[0]; FCOL, FNRM = feather_layer(SRCIMG)
src.name = 'cockatoo'; me.name = 'cockatoo'
src.parent = arm; mod = src.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
mat = me.materials[0]; mat.name = 'plumage'
if FEATHER:   # the feather albedo replaces the source's in place; the normal map goes in through a tangent-space Normal Map
    nt = mat.node_tree; bsdf = [nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED'][0]
    for nd in nt.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image == SRCIMG: nd.image = FCOL
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = FNRM; tn.interpolation = 'Linear'
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.space = 'TANGENT'; nmap.uv_map = me.uv_layers[0].name; nmap.inputs['Strength'].default_value = 1.0
    nt.links.new(tn.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    print('COCKATOO plumage textures', [nd.image.name for nd in nt.nodes if nd.type == 'TEX_IMAGE' and nd.image])
MSH = float(opt('--mirror-shift', '4.5'))   # round 3: texels at 1k
if MSH:
    buf = np.zeros(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', buf); UVL = buf.reshape(-1, 2)
    LVI = np.zeros(len(me.loops), int); me.loops.foreach_get('vertex_index', LVI)
    bigi = [i for i, c in zip(ids, counts) if c >= 300]
    big = np.isin(ISL, bigi) & ~np.array([f.startswith('leg') for f in FAMV])
    tp = np.clip((S[:, 0] - 0.004) / 0.010, 0, 1); tp = tp * tp * (3 - 2 * tp) * big
    UVL = UVL + tp[LVI][:, None] * (np.array([MSH, 0.6 * MSH]) / 1024.0)
    me.uv_layers[0].data.foreach_set('uv', UVL.ravel()); print('COCKATOO mirror shift loops', int((tp[LVI] > 0.5).sum()), 'of', len(LVI))
if NEWCREST and len(DELV):
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[int(v)] for v in DELV], context='VERTS'); bm.to_mesh(me); bm.free()
    crest.data.uv_layers[0].name = me.uv_layers[0].name; crest.parent = arm
wing.data.uv_layers[0].name = me.uv_layers[0].name
for o in bpy.context.selected_objects: o.select_set(False)
wing.select_set(True); src.select_set(True); bpy.context.view_layer.objects.active = src
if NEWCREST: crest.select_set(True)
bpy.ops.object.join()
for im in bpy.data.images:
    if im.size[0] > 2048 or im.size[1] > 2048: im.scale(min(im.size[0], 2048), min(im.size[1], 2048))
    if 'feathers_orm' in im.name and im.size[0] > 512: im.scale(512, 512)   # roughness is flat: no need for 2k
    if 'feathers_nrm' in im.name and im.size[0] > 1024: im.scale(1024, 1024)   # barb relief reads at 1k; the colour carries 2k

# ============================================================== export (the builder's settings and post-process)
for tr in ad.nla_tracks: tr.mute = False
ad.action = None; set_pose({})
kw = dict(G['kw']); kw['filepath'] = OUT
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props or k == 'filepath'})
with open(OUT, 'rb') as fh: data = fh.read()
jl = struct.unpack_from('<I', data, 12)[0]
js = json.loads(data[20:20 + jl]); rest = data[20 + jl:]
for m in js.get('materials', []):
    if m.get('name') == 'wing_feathers': m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5   # alpha-cut feather cards
    else: m['alphaMode'] = 'OPAQUE'; m.pop('alphaCutoff', None)
    m['doubleSided'] = True
clips = [a['name'] for a in js.get('animations', [])]
js['scenes'][0].setdefault('extras', {})['cockatoo'] = {'species': 'Cacatua galerita', 'length_m': 0.48, 'clips': clips, 'source': SOURCE}
js['asset']['extras'] = {'title': SOURCE['title'], 'author': SOURCE['author'], 'license': SOURCE['license'], 'source': SOURCE['url']}
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + len(rest)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + rest
with open(OUT, 'wb') as fh: fh.write(out)
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print('COCKATOO out', OUT, 'verts', n, 'tris', tris, 'bones', len(names), 'joints', len(js['skins'][0]['joints']),
      'anims', clips, 'rest length', round(REST[:, 1].max() - REST[:, 1].min(), 3), 'span', round(REST[:, 0].max() - REST[:, 0].min(), 3), 'bytes', len(out))

# ============================================================== turnaround renders (optional)
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    for tr in ad.nla_tracks: tr.mute = True
    ad.action = None
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'; scn.cycles.samples = 32; scn.cycles.use_denoising = True; scn.cycles.device = 'CPU'
    scn.cycles.transparent_max_bounces = 128; scn.cycles.max_bounces = 16   # the wing's stacked alpha-cut cards: 8 transparent bounces ran out at grazing angles and drew black lines
    scn.render.resolution_x = 640; scn.render.resolution_y = 640
    world = bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.42, 0.52, 0.62, 1); bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.2; sun.data.angle = 0.1
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35)); scn.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 50; scn.collection.objects.link(cam); scn.camera = cam
    def shot(name, pose, target, az, el, dist, opened=False, lens=50):
        set_pose(pose)
        for sd in ('_L', '_R'):   # what the game does: the open wing only in flight, the folded shell only perched
            arm.pose.bones['upper' + sd].scale = (1, 1, 1) if opened else (1e-3,) * 3
            arm.pose.bones['shell' + sd].scale = (1e-3,) * 3 if opened else (1, 1, 1)
        for b_ in HIDE: arm.pose.bones[b_].scale = (1e-3,) * 3
        bpy.context.view_layer.update()
        t = Vector(target); cam.data.lens = lens
        c = t + Vector((math.sin(math.radians(az)) * math.cos(math.radians(el)), -math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * dist
        cam.location = c; cam.rotation_euler = (t - c).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(RENDER, name + '.png'); bpy.ops.render.render(write_still=True)
    set_pose(PERCH); bpy.context.view_layer.update()
    tgt = (arm.matrix_world @ arm.pose.bones['neck1'].head) * 0.4 + (arm.matrix_world @ arm.pose.bones['root'].head) * 0.6
    hd = arm.matrix_world @ arm.pose.bones['head'].head
    squawk = {**PERCH, **OVER['crest'], **OVER['beak']}
    ONLY = opt('--only'); HIDE = []
    SHOTS = [('a_perch_front34', PERCH, tgt, 35, 8, 0.8, False), ('b_perch_side', PERCH, tgt, 90, 8, 0.8, False),
             ('c_perch_back34', PERCH, tgt, 150, 8, 0.8, False), ('d_squawk_crest', squawk, tgt, 60, 5, 0.7, False),
             ('d2_head_side', PERCH, hd, 90, 10, 0.32, False), ('d3_head_front34', PERCH, hd, 30, 12, 0.32, False),
             ('i_preen', {**PERCH, **OVER['preen']}, tgt, 40, 10, 0.8, False),
             ('e_glide_below', GLIDE, (0, 0.0, 0.0), 25, -30, 1.4, True), ('f_glide_above', GLIDE, (0, 0.0, 0.0), 200, 35, 1.4, True),
             ('e2_glide_front_below', GLIDE, (0, 0.0, 0.0), 0, -18, 1.25, True), ('e3_wing_root', GLIDE, (0.06, -0.02, 0.02), 60, 25, 0.5, True)]
    SHOTS += [('g_flap_%d' % k, {**GLIDE, **flap_pose(FLAP[k][1])}, (0, 0.0, 0.0), 20, 10, 1.4, True) for k in range(4)]
    SHOTS += [('h_flare', G['FLARE'], (0, 0.0, 0.0), 60, 5, 1.4, True)]
    # the perched wing stretch at its peak (the `stretch` overlay: folded shells out and up, the open wing hidden)
    ft = (arm.matrix_world @ arm.pose.bones['foot_L'].head) * 0.5 + (arm.matrix_world @ arm.pose.bones['foot_R'].head) * 0.5
    SHOTS += [('j_stretch_back', STRETCHPOSE, tgt, 160, 25, 0.8, False), ('j2_stretch_side', STRETCHPOSE, tgt, 70, 10, 0.8, False),
              ('e4_lead_close', GLIDE, (0.17, -0.05, 0.03), 10, -25, 0.35, True), ('f2_coverts_above', GLIDE, (0.13, -0.03, 0.03), 200, 55, 0.42, True),
              ('s1_back_sym', PERCH, tgt, 180, 18, 0.8, False), ('s2_front_sym', PERCH, tgt, 0, 8, 0.8, False),
              ('s3_top_sym', PERCH, tgt, 180, 70, 0.8, False), ('d2_head_side', PERCH, hd, 90, 10, 0.32, False), ('f3_glide_back', GLIDE, (0, 0.0, 0.0), 180, 20, 1.4, True),
              ('k_feet_side', PERCH, ft - Vector((0, 0, 0.015)), 90, 2, 0.2, False), ('k2_feet_front', PERCH, ft - Vector((0, 0, 0.015)), 25, 8, 0.22, False)]
    for nm, pose, target, az, el, dist, opened in SHOTS:
        if not ONLY or any(nm.startswith(o) for o in ONLY.split(',')): shot(nm, pose, target, az, el, dist, opened)
    # round 2 close-ups of the plumage (only with --only m...): the back from above-behind, the head and crest 3/4, the side
    crt = (arm.matrix_world @ arm.pose.bones['c5'].head) if 'c5' in arm.pose.bones else hd   # the crest close-ups aim at its middle quill
    back = (arm.matrix_world @ arm.pose.bones['root'].head) * 0.5 + (arm.matrix_world @ arm.pose.bones['neck1'].head) * 0.5
    for nm, pose, target, az, el, dist in [('m1_back_close', PERCH, back, 150, 35, 0.3), ('m2_head_close34', PERCH, hd, 35, 12, 0.2),
                                           ('m3_side_close', PERCH, tgt, 90, 5, 0.45),
                                           ('m4_head_top', PERCH, crt, 200, 72, 0.2), ('m5_crest_raised34', CRESTPOSE, crt, 35, 12, 0.24),
                                           ('m6_head_side', PERCH, crt, 90, 8, 0.2)]:
        if ONLY and any(nm.startswith(o) for o in ONLY.split(',')):
            scn.cycles.samples = 96; shot(nm, pose, target, az, el, dist)
            if nm == 'm1_back_close' and 'probe' in MY:   # round 4: the leg faces this camera sees (the dark sliver)
                dg = bpy.context.evaluated_depsgraph_get(); fr = cam.data.view_frame(scene=scn); M3 = cam.matrix_world.to_3x3(); seen = {}
                for iy in range(90):
                    for ix in range(120):
                        u, v_ = ix / 119, iy / 89; top = fr[3].lerp(fr[0], u); bot = fr[2].lerp(fr[1], u); d_ = (M3 @ top.lerp(bot, v_)).normalized()
                        ok, loc, nrm, fi, obh, _ = scn.ray_cast(dg, cam.location, d_)
                        if not ok or obh is None or obh.type != 'MESH': continue
                        pv_ = obh.data.polygons[fi].vertices[:]; gn = {obh.vertex_groups[g.group].name for g in obh.data.vertices[pv_[0]].groups if g.weight > 0.3}
                        if any(g_.startswith(('thigh', 'tarsus', 'shin', 'foot', 'toe', 'claw')) for g_ in gn):
                            e_ = seen.setdefault((obh.name, fi), [0, tuple(round(1000 * x, 1) for x in loc), sorted(gn), pv_[:]]); e_[0] += 1
                for k_, e_ in sorted(seen.items(), key=lambda kv: -kv[1][0])[:12]: print('COCKATOO m1 leg face', k_, 'rays', e_[0], 'at mm', e_[1], 'groups', e_[2], 'verts', e_[3])
    if ONLY and 'n' in ONLY.split(','):   # round 3 diagnosis: the m1 view again with the legs hidden
        scn.cycles.samples = 64; HIDE = ['thigh_L', 'thigh_R']; shot('n1_back_nolegs', PERCH, back, 150, 35, 0.3); HIDE = []
        shot('n2_back_legs_zoom', PERCH, back + Vector((0.03, 0.03, -0.03)), 150, 35, 0.12)
