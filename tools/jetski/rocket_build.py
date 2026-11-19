# Blender 5.x batch builder for the jetski's rocket booster pod (public/models/jetski_rocket.glb).
#   blender -b --factory-startup --python tools/jetski/rocket_build.py -- <repo root>
# A separate GLB so the jetski contract (jetski.glb nodes, points, samples) cannot move: src/jetski/Jetski.js
# loads it and hangs a clone on every ski. Frame as jetski.glb (glTF: Y up, +Z forward, +X rider's left, metres,
# the ski's origin), so the pod sits on the swim platform (top y 0.205, z -1.29 to -1.58) where it is placed here.
# The pod: a chunky canister (ogive nose, rolled seams, bolt rings, a hazard stripe band and a yellow warning
# plate), four swept fins in an X, a bell nozzle with a throat ring and a heat-tinted liner (Rocket_Liner, lit
# by the game while it burns), two saddle clamps on legs to a bolted base plate. The pod's axis is tipped 9 deg
# (nozzle up) so its thrust line runs through the loaded centre of gravity (the game aims the thrust the same way).
# Nodes: RocketPod (the mesh root), RocketOut (the nozzle exit, local +Z aft: the flame hangs here).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
OUT = ROOT + '/public/models/jetski_rocket.glb'
FONT = ROOT + '/tools/props/fonts/Oswald.ttf'
bpy.ops.wm.read_factory_settings(use_empty=True)
log = lambda *a: print('ROCKET', *a, flush=True)
def B(p): return Vector((p[0], -p[2], p[1]))  # glTF frame -> Blender

MATS = {}
def mat(name, col, rough, metal=0.0, coat=0.0, emit=None, es=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if coat: p.inputs['Coat Weight'].default_value = coat; p.inputs['Coat Roughness'].default_value = 0.05
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = es
    MATS[name] = m; return m
RED = mat('Rocket_Red', (0.62, 0.04, 0.02), 0.28, coat=0.8)
WHITE = mat('Rocket_White', (0.82, 0.82, 0.80), 0.3, coat=0.6)
BLACK = mat('Rocket_Black', (0.015, 0.015, 0.018), 0.55)
YEL = mat('Rocket_Yellow', (0.92, 0.62, 0.02), 0.4)
ALU = mat('Rocket_Alu', (0.62, 0.63, 0.65), 0.32, metal=1.0)
STEEL = mat('Rocket_Steel', (0.22, 0.21, 0.2), 0.45, metal=1.0)
LINER = mat('Rocket_Liner', (0.18, 0.12, 0.1), 0.5, metal=0.8)  # heat-blued liner, emissive in game while burning

PARTS = []
def obj(name, V, F, m, smooth=True):
    me = bpy.data.meshes.new(name); me.from_pydata([B(v) for v in V], [], F); me.update()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.data.materials.append(m)
    PARTS.append(ob); return ob

def lathe(name, prof, m, seg=28, cap0=False, cap1=False):  # prof: [(r, z)] around +Z (pod axis)
    V, F = [], []
    for r, z in prof:
        for k in range(seg):
            a = 2 * math.pi * k / seg; V.append((r * math.sin(a), r * math.cos(a), z))
    for i in range(len(prof) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg; F.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
    if cap0: F.append(tuple(range(seg))[::-1])
    if cap1: F.append(tuple((len(prof) - 1) * seg + k for k in range(seg)))
    return obj(name, V, F, m)

def box(name, c, s, m, rz=0.0):
    V, F = [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    ca, sa = math.cos(rz), math.sin(rz)
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                x, y = dx * s[0] / 2, dy * s[1] / 2
                V.append((c[0] + x * ca - y * sa, c[1] + x * sa + y * ca, c[2] + dz * s[2] / 2))
    return obj(name, V, F, m, smooth=False)

R0, ZF, ZA = 0.12, 0.13, -0.19  # canister radius, forward and aft ends (pod frame, origin mid canister)
# canister: ogive nose (white), red body with rolled seams, aft skirt
nose = [(R0 * math.cos(0.5 * math.pi * t) ** 0.7 if t < 1 else 0.0, ZF + 0.13 * t) for t in [i / 10 for i in range(11)]]
lathe('Nose', [(R0, ZF)] + nose[1:], WHITE)
lathe('Body', [(R0, ZA + 0.03), (R0, ZF)], RED)
for z in (ZF - 0.004, -0.03, ZA + 0.034):  # rolled seams / bolt rings
    lathe('Seam', [(R0 - 0.001, z - 0.008), (R0 + 0.006, z - 0.005), (R0 + 0.006, z + 0.005), (R0 - 0.001, z + 0.008)], ALU, seg=36)
lathe('Skirt', [(R0, ZA + 0.03), (R0 + 0.004, ZA + 0.02), (R0 + 0.004, ZA), (0.07, ZA - 0.01)], STEEL, cap1=False)
for k in range(12):  # bolt heads on the forward ring
    a = 2 * math.pi * (k + 0.5) / 12
    lathe('Bolt', [(0.0, 0), (0.007, 0), (0.007, 0.006), (0.0, 0.006)], STEEL, seg=6)
    PARTS[-1].matrix_world = Matrix.Translation(B(((R0 + 0.006) * math.sin(a), (R0 + 0.006) * math.cos(a), -0.03))) @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'X')
# hazard stripe band: alternating yellow / black slanted segments proud of the body
N = 20
for k in range(N):
    a0, a1 = 2 * math.pi * k / N, 2 * math.pi * (k + 1) / N
    V = []
    for z, sh in ((0.045, 0.0), (0.095, 0.12)):
        for a in (a0 + sh, a1 + sh):
            V.append(((R0 + 0.0015) * math.sin(a), (R0 + 0.0015) * math.cos(a), z))
    obj('Hazard', V, [(0, 1, 3, 2)], YEL if k % 2 else BLACK)
# fins: four swept plates in an X at the aft end
for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    P = [(R0, ZA + 0.13), (R0, ZA + 0.0), (R0 + 0.095, ZA - 0.03), (R0 + 0.095, ZA + 0.03)]
    V = []
    for s in (-0.006, 0.006):
        for r, z in P:
            V.append((r * math.sin(a) + s * math.cos(a), r * math.cos(a) - s * math.sin(a), z))
    obj('Fin', V, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], BLACK, smooth=False)
# bell nozzle: throat ring then a parabolic bell, dark steel outside, the liner inside
bell = [(0.052 + 0.045 * (t ** 0.6), ZA - 0.03 - 0.17 * t) for t in [i / 8 for i in range(9)]]
lathe('ThroatRing', [(0.07, ZA - 0.01), (0.075, ZA - 0.02), (0.075, ZA - 0.035), (0.052, ZA - 0.04)], STEEL)
lathe('Bell', [(r + 0.006, z) for r, z in bell], STEEL)
lathe('Liner', [(r, z) for r, z in bell][::-1] + [(0.02, ZA - 0.03)], LINER)
lathe('Lip', [(bell[-1][0], bell[-1][1]), (bell[-1][0] + 0.008, bell[-1][1] - 0.004), (bell[-1][0] + 0.006, bell[-1][1] + 0.004)], ALU)
# saddle clamps (straps); their legs and the bolted base plates are built in the ski frame after the tilt
STRAPS = (0.07, -0.04)
for z in STRAPS:
    lathe('Strap', [(R0 + 0.004, z - 0.016), (R0 + 0.011, z - 0.016), (R0 + 0.011, z + 0.016), (R0 + 0.004, z + 0.016)], ALU, seg=32)
# warning plate on the left flank: yellow plate, black border, black lettering
ang = math.radians(70)
def onflank(u, v, off):  # u along the axis, v up the curve (m); off: out from the plate
    a = ang - v / R0; r = R0 + 0.003 + off
    return (r * math.sin(a), r * math.cos(a), u)
def plate(name, u0, u1, v0, v1, off, m, nu=6, nv=4):
    V = [onflank(u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv, off) for i in range(nu + 1) for j in range(nv + 1)]
    F = [(i * (nv + 1) + j, i * (nv + 1) + j + 1, (i + 1) * (nv + 1) + j + 1, (i + 1) * (nv + 1) + j) for i in range(nu) for j in range(nv)]
    return obj(name, V, F, m)
plate('WarnBorder', -0.168, -0.042, -0.035, 0.035, 0.0, BLACK)
plate('WarnPlate', -0.163, -0.047, -0.03, 0.03, 0.0008, YEL)
try:
    fnt = bpy.data.fonts.load(FONT)
    for body, v, sz in (('DANGER', 0.012, 0.024), ('ROCKET BOOST', -0.014, 0.014)):
        cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.font = fnt; cu.size = sz; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
        ob = bpy.data.objects.new('t', cu); bpy.context.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); bpy.data.objects.remove(ob)
        # wrap the flat letters (x along the text, y up) onto the flank, reading bow to stern from the left side
        V = []
        for vx in me.vertices:
            V.append(onflank(-0.105 - vx.co.x, v + vx.co.y, 0.0016))
        F = [tuple(p.vertices) for p in me.polygons]
        obj('WarnText', V, F, BLACK, smooth=False)
except Exception as e:
    log('text skipped', e)

# tip the canister 9 deg (nozzle up) and place it over the platform, then stand it on legs
TILT, MOUNT, DECK = math.radians(9), (0.0, 0.385, -1.53), 0.205 + 0.003  # glTF: canister centre; the platform mat top
M = Matrix.Translation(B(MOUNT)) @ Matrix.Rotation(TILT, 4, 'X')
for o in PARTS: o.matrix_world = M @ o.matrix_world
def G(v): return (v.x, v.z, -v.y)
for z in STRAPS:
    c = G(M @ B((0, -(R0 + 0.008), z)))  # the strap's underside, ski frame
    for sx in (-1, 1):
        box('Leg', (sx * 0.07, (c[1] + DECK) / 2 + 0.006, c[2]), (0.018, c[1] - DECK + 0.004, 0.03), ALU)
    box('Foot', (0, DECK + 0.006, c[2]), (0.24, 0.012, 0.05), STEEL)
    for sx in (-1, 1):
        lathe('BaseBolt', [(0.0, 0), (0.009, 0), (0.009, 0.008), (0.0, 0.008)], STEEL, seg=6)
        PARTS[-1].matrix_world = Matrix.Translation(B((sx * 0.1, DECK + 0.012, c[2]))) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
bpy.ops.object.select_all(action='DESELECT')
for o in PARTS: o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
pod = bpy.context.view_layer.objects.active; pod.name = 'RocketPod'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
EX = G(M @ B((0, 0, bell[-1][1])))
# RocketOut: the bell exit, local +Z aft
out = bpy.data.objects.new('RocketOut', None); bpy.context.collection.objects.link(out)
out.parent = pod; out.matrix_parent_inverse = Matrix.Identity(4)
out.location = B(EX)
log('RocketOut glTF', *[round(v, 3) for v in EX])
bb = [pod.matrix_world @ Vector(c) for c in pod.bound_box]
log('bbox glTF y', round(min(v.z for v in bb), 3), round(max(v.z for v in bb), 3), 'z', round(min(-v.y for v in bb), 3), round(max(-v.y for v in bb), 3))
log('tris', sum(len(p.vertices) - 2 for p in pod.data.polygons))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_cameras=False,
                          export_lights=False, export_animations=False, export_extras=True)
log('EXPORTED', OUT, os.path.getsize(OUT))
