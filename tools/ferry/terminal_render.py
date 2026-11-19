"""Review renders of the ferry terminal with the ferry docked: opens assets/ferry/terminal.blend, undoes the
export turn (so views use the terminal frame: +Y out to sea), imports public/ferry/ferry.glb and docks it with
its model origin at terminal (0, 25.2, 0), lowers its stern ramp (DROOP = 0.04 rad, the same droop the build
script sizes the landing plate for), prints the fit checks and renders named views with Cycles. The 'topdown'
view matches the straight-down aerial reference and also writes a side-by-side PNG (render left, reference right).
Run:
  Blender --background assets/ferry/terminal.blend --python tools/ferry/terminal_render.py -- OUT_DIR [view ...]
Views: overview beach island road topdown jetty landing gangway gangwayup linkspan ramptoe building buildingwest breakwater
       breakwaterout yard slipway armour counter cafe
The sea is tools/ferry/sea_stage.py (render only). The context land is the real island around the site
(assets/ferry/site_terrain.json) with the terrain edits the game applies (the build's site data, kept in the .blend);
the parked and queued cars are the game's own car GLBs from public/rally; the stone, gravel, scrub and surf shaders
are render-only upgrades of the exported flat colours.
"""
REF = __import__('pathlib').Path(__import__('os').environ.get('SEALINK_REF', 'sealink-ref-4.jpg'))
DROOP, LAND, PLATE_Y = 0.04, 2.10, (-8.85, -7.05)
import sys, math, json, random
from tempfile import gettempdir
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = Path(args[0] if args else Path(gettempdir()) / 'terminal-renders'); out.mkdir(parents=True, exist_ok=True)
wanted = args[1:] or ['overview', 'topdown', 'jetty', 'gangway', 'linkspan', 'building', 'breakwater']

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices: d.use = True
scene.cycles.device = 'GPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -1.7

world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
nodes = world.node_tree.nodes; links = world.node_tree.links
sky = nodes.new('ShaderNodeTexSky')
try:
    sky.sky_type = 'NISHITA'
except TypeError:
    pass
sky.sun_elevation = math.radians(28); sky.sun_rotation = math.radians(215)
links.new(sky.outputs['Color'], nodes['Background'].inputs['Color'])
nodes['Background'].inputs['Strength'].default_value = 0.4
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(62), 0, math.radians(215 - 180)))
sun = bpy.context.object; sun.data.energy = 5.5; sun.data.angle = math.radians(0.8)
sun.data.color = (1.0, 0.93, 0.82)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import sea_stage as SS
from sea_stage import mixc, mrange, math_op, noise

# ---- the sea: a real wind sea, calmer inside the hooked breakwater (render only) ---------------------
SITE = json.loads(scene['tw_site'])          # the build's site data in this frame (fill, dredge, ridges, bays)
BW = [tuple(p) for p in SITE['bw']]
COVE = BW + [(-40.0, 158.0), (34.0, 96.0), (34.0, -32.0), (-92.0, -32.0)]
def spline(pts, step):       # the build script's Catmull-Rom centreline, so the wash follows the real waterline
    P = [Vector((x, y, 0.0)) for x, y in pts]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]; n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return [(v.x, v.y) for v in out] + [BW[-1]]
BWC = spline(BW, 1.0)
TOE_W = [3.0 + min(4.6, 3.1 + 0.11 * i) * 1.5 for i in range(len(BWC))]     # CW + crest(i) * BS
SS.build(COVE, centre=(-40.0, 100.0), shallow_at=(-80.0, -30.0), inner=0.4, feather=45.0, toe_line=BWC, toe_w=TOE_W)

# ---- context land (render only): the island around the site with the game's terrain edits -------------------
def island_material():
    """Dry grass and coastal scrub above about +1 m, sand at the waterline, a darker seabed, bare rock where steep."""
    mat = bpy.data.materials.new('IslandGround'); mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(P, sep.inputs[0]); z = sep.outputs['Z']
    nrm = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], nrm.inputs[0]); up = nrm.outputs['Z']
    col = mixc(nt, mrange(nt, noise(nt, P, 0.012, 4), 0.4, 0.62), (0.15, 0.145, 0.075, 1), (0.06, 0.085, 0.035, 1))
    col = mixc(nt, mrange(nt, noise(nt, P, 0.35, 6, 0.65), 0.5, 0.6), col, (0.025, 0.045, 0.02, 1))        # scrub clumps
    col = mixc(nt, mrange(nt, noise(nt, P, 0.03, 5, 0.6), 0.5, 0.6, 0.0, 0.85), col, (0.03, 0.05, 0.025, 1))  # scrub stands
    col = mixc(nt, mrange(nt, noise(nt, P, 0.08, 5), 0.6, 0.7, 0.0, 0.7), col, (0.2, 0.15, 0.1, 1))           # bare soil
    col = mixc(nt, mrange(nt, noise(nt, P, 2.5, 3), 0.3, 0.7, 0.0, 0.25), col, (0.3, 0.27, 0.17, 1))          # grass grain
    sand = mixc(nt, mrange(nt, noise(nt, P, 0.4, 4), 0.4, 0.6), (0.5, 0.45, 0.34, 1), (0.41, 0.36, 0.26, 1))
    col = mixc(nt, mrange(nt, z, 1.5, 0.8), col, sand)                                                          # beach sand
    col = mixc(nt, mrange(nt, z, -0.2, -1.2), col, (0.2, 0.19, 0.14, 1))                                        # wet sand, weed
    rock = mixc(nt, mrange(nt, noise(nt, P, 0.9, 6), 0.4, 0.6), (0.09, 0.085, 0.075, 1), (0.25, 0.23, 0.2, 1))
    col = mixc(nt, mrange(nt, up, 0.84, 0.68), col, rock)                                                       # steep: rock
    nt.links.new(col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.95
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; bump.inputs['Distance'].default_value = 0.08
    nt.links.new(noise(nt, P, 1.8, 8, 0.7), bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return mat

def terrain():
    d = json.loads((ROOT / 'assets/ferry/site_terrain.json').read_text()); nx, ny, st, pad = d['nx'], d['ny'], d['step'], 100
    Z = np.pad(np.array(d['h'], float).reshape(ny, nx), pad, mode='edge')      # 200 m of skirt beyond the sampled box
    X, Y = np.meshgrid(d['x0'] + st * (np.arange(nx + 2 * pad) - pad), d['y0'] + st * (np.arange(ny + 2 * pad) - pad))
    far = np.maximum.reduce([d['x0'] - X, X - d['x0'] - st * (nx - 1), d['y0'] - Y, Y - d['y0'] - st * (ny - 1), 0 * X])
    Z = Z + np.clip(far / 60.0, 0, 1) * (Z > 1.0) * (4.0 * np.sin(X * 0.021 + 1.3) * np.cos(Y * 0.017 + 0.4) + 2.0 * np.sin(X * 0.053 - Y * 0.041))
    fade = np.clip(far / (st * pad), 0.0, 1.0); fade = fade * fade * (3 - 2 * fade)   # past the sampled box the land slopes
    Z = np.where(Z > -2.0, Z - (Z + 2.0) * fade, Z)                               # under the sea (the island is not sampled there)
    for f in SITE['fill']:                                  # the game's edits, in its order: fill, dredge, ridges
        ins = SS._inside(X, Y, f['poly']); dd = SS._edge_dist(X, Y, f['poly'])
        Z = np.maximum(Z, np.where(ins, f['height'], f['height'] + (Z - f['height']) * np.clip(dd / f['slope'], 0.0, 1.0)))
    for g in SITE['dredge']:
        ins = SS._inside(X, Y, g['poly']); dd = SS._edge_dist(X, Y, g['poly'])
        Z = np.minimum(Z, np.where(ins, g['depth'], g['depth'] + (Z - g['depth']) * np.clip(dd / g['blend'], 0.0, 1.0)))
    for r in SITE['ridges']:
        dd = SS._edge_dist(X, Y, r['line'], closed=False)
        Z = np.maximum(Z, r['crest'] - np.maximum(dd - r['halfWidth'], 0.0) / r['slope'])
    ins = SS._inside(X, Y, SITE['fill'][0]['poly']); Z = np.where(ins, np.minimum(Z, 3.12), Z)   # under the GLB's ground
    h, w = Z.shape
    verts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    idx = np.arange(h * w).reshape(h, w)
    faces = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    me = bpy.data.meshes.new('ContextLand'); me.from_pydata(verts.tolist(), [], faces.tolist()); me.update()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new('ContextLand', me); bpy.context.collection.objects.link(ob)
    me.materials.append(island_material())
    print(f'LAND site terrain {len(verts)} vertices, z {Z.min():.1f} .. {Z.max():.1f}')

def scrub_material(name, mat=None):
    """Coastal scrub and dry grass with bare soil, sand low on the east beach, grey rock low on the west shore."""
    mat = mat or bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(P, sep.inputs[0]); x, z = sep.outputs['X'], sep.outputs['Z']
    col = mixc(nt, mrange(nt, noise(nt, P, 0.012, 4), 0.4, 0.62), (0.15, 0.145, 0.075, 1), (0.06, 0.085, 0.035, 1))
    col = mixc(nt, mrange(nt, noise(nt, P, 0.35, 6, 0.65), 0.5, 0.6), col, (0.025, 0.045, 0.02, 1))        # scrub clumps
    col = mixc(nt, mrange(nt, noise(nt, P, 0.03, 5, 0.6), 0.5, 0.6, 0.0, 0.85), col, (0.03, 0.05, 0.025, 1))  # scrub stands
    col = mixc(nt, mrange(nt, noise(nt, P, 0.08, 5), 0.6, 0.7, 0.0, 0.7), col, (0.2, 0.15, 0.1, 1))           # bare soil
    col = mixc(nt, mrange(nt, noise(nt, P, 2.5, 3), 0.3, 0.7, 0.0, 0.25), col, (0.3, 0.27, 0.17, 1))          # grass grain
    sandy = math_op(nt, 'MULTIPLY', mrange(nt, z, 3.6, 2.9), mrange(nt, x, 100.0, 140.0))
    col = mixc(nt, sandy, col, (0.5, 0.45, 0.34, 1))
    rocky = math_op(nt, 'MULTIPLY', mrange(nt, z, 3.0, 1.6), mrange(nt, x, -150.0, -175.0))
    col = mixc(nt, rocky, col, mixc(nt, mrange(nt, noise(nt, P, 0.9, 6), 0.4, 0.6), (0.09, 0.085, 0.075, 1), (0.25, 0.23, 0.2, 1)))
    nt.links.new(col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.95
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; bump.inputs['Distance'].default_value = 0.08
    nt.links.new(noise(nt, P, 1.8, 8, 0.7), bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return mat
terrain()

# ---- render-only material upgrades for the exported flat colours -------------------------------------
def rock_material(mat, core=False):
    """Quarried stone: noisy colour and grain, dark crevices (AO), lichen above the splash zone, a dark wet band
    and green-brown weed from about -0.6 to +0.9 m, rough dry and glossy wet."""
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']; base = tuple(b.inputs['Base Color'].default_value)
    geo = nt.nodes.new('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(P, sep.inputs[0]); z = sep.outputs['Z']
    col = mixc(nt, 1.0, base, mrange(nt, noise(nt, P, 1.3, 8, 0.66), 0.28, 0.72, 0.5, 1.45), 'MULTIPLY')
    col = mixc(nt, 1.0, col, mrange(nt, noise(nt, P, 24.0, 2), 0.35, 0.65, 0.8, 1.12), 'MULTIPLY')
    band = mrange(nt, noise(nt, P, 3.2, 4), 0.62, 0.7, 0.0, 0.35)                                          # mineral veins
    col = mixc(nt, band, col, (0.34, 0.32, 0.29, 1))
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.8; ao.samples = 8
    col = mixc(nt, 1.0, col, mrange(nt, ao.outputs['AO'], 0.15, 1.0, 0.22, 1.0), 'MULTIPLY')
    if not core:
        vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 3.2; nt.links.new(P, vor.inputs['Vector'])
        spots = math_op(nt, 'MULTIPLY', mrange(nt, vor.outputs['Distance'], 0.3, 0.12), mrange(nt, noise(nt, P, 0.7, 3), 0.46, 0.56))
        lichen = math_op(nt, 'MULTIPLY', spots, mrange(nt, z, 1.9, 3.2, 0.0, 0.85))
        col = mixc(nt, lichen, col, mixc(nt, mrange(nt, noise(nt, P, 0.5, 2), 0.4, 0.6), (0.46, 0.36, 0.17, 1), (0.36, 0.37, 0.3, 1)))
    wet = mrange(nt, z, 1.05, 0.62)
    col = mixc(nt, wet, col, mixc(nt, 1.0, col, (0.3, 0.3, 0.3, 1), 'MULTIPLY'))
    weed = math_op(nt, 'MULTIPLY', math_op(nt, 'MULTIPLY', mrange(nt, z, 0.9, 0.45), mrange(nt, z, -0.75, -0.4)),
                   mrange(nt, noise(nt, P, 1.1, 6, 0.6), 0.42, 0.54))
    col = mixc(nt, weed, col, mixc(nt, mrange(nt, noise(nt, P, 0.35, 2), 0.4, 0.6), (0.03, 0.045, 0.012, 1), (0.06, 0.045, 0.018, 1)))
    nt.links.new(col, b.inputs['Base Color'])
    nt.links.new(mrange(nt, wet, 0.0, 1.0, 0.9, 0.22, False), b.inputs['Roughness'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.55; bump.inputs['Distance'].default_value = 0.05
    nt.links.new(math_op(nt, 'ADD', noise(nt, P, 4.5, 10, 0.62), math_op(nt, 'MULTIPLY', noise(nt, P, 30.0, 2), 0.25)), bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])

def gravel_material(mat, scale=7.0, contrast=1.0):
    """Crushed-rock gravel: voronoi stones with their own tones, fines between them, domed bump."""
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']; base = tuple(b.inputs['Base Color'].default_value)
    geo = nt.nodes.new('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = scale; vor.inputs['Randomness'].default_value = 0.9
    nt.links.new(P, vor.inputs['Vector'])
    tone = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(vor.outputs['Color'], tone.inputs[0])
    col = mixc(nt, 1.0, base, mrange(nt, tone.outputs[0], 0.0, 1.0, 1.0 - 0.45 * contrast, 1.0 + 0.7 * contrast, False), 'MULTIPLY')
    col = mixc(nt, mrange(nt, vor.outputs['Distance'], 0.32, 0.5, 0.0, 0.6 * contrast), col, (0.07, 0.065, 0.055, 1))
    col = mixc(nt, 1.0, col, mrange(nt, noise(nt, P, 0.15, 3), 0.35, 0.65, 0.75, 1.15), 'MULTIPLY')
    nt.links.new(col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.93
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.7 * contrast; bump.inputs['Distance'].default_value = 0.04
    nt.links.new(mrange(nt, vor.outputs['Distance'], 0.0, 0.5, 1.0, 0.0), bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])

def foam_material(mat, most):
    """Broken surf lace instead of a flat white band."""
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    geo = nt.nodes.new('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    lace = math_op(nt, 'MULTIPLY', mrange(nt, noise(nt, P, 0.5, 10, 0.72), 0.44, 0.62, 0.0, most), mrange(nt, noise(nt, P, 3.0, 4), 0.3, 0.55))
    nt.links.new(lace, b.inputs['Alpha']); b.inputs['Base Color'].default_value = (0.86, 0.9, 0.92, 1); b.inputs['Roughness'].default_value = 0.6

for m in list(bpy.data.materials):
    if not m.use_nodes or 'Principled BSDF' not in m.node_tree.nodes: continue
    if m.name.split('.')[0] in ('RockGrey', 'RockTan', 'RockPale', 'RockDark', 'RockRust', 'WetRock'): rock_material(m)
    elif m.name.split('.')[0] in ('ArmourGaps', 'RockCore'): rock_material(m, core=True)
    elif m.name.startswith('CrestGravel'): gravel_material(m, 7.0, 1.0)
    elif m.name.startswith('SandyGravel'): gravel_material(m, 9.0, 0.45)
    elif m.name.startswith('Grass'): scrub_material('Grass', m)
    elif m.name.startswith('SurfFoamThin'): foam_material(m, 0.55)
    elif m.name.startswith('SurfFoam'): foam_material(m, 0.95)
surf = bpy.data.objects.get('Terminal Surf')
if surf: surf.location.z += 0.28          # ride over most of the wave troughs; the lace shader breaks it up

# ---- dock the ferry ---------------------------------------------------------------------
root = bpy.data.objects['TidewaterTerminal']; root.rotation_euler.z = 0.0
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/ferry/ferry.glb'))
new = [o for o in bpy.data.objects if o not in before]
froot = next(o for o in new if o.name.startswith('TidewaterFerry'))
froot.rotation_mode = 'XYZ'; froot.rotation_euler = (0, 0, 0); froot.location = (0, 25.2, 0)
ramp = next(o for o in new if o.name.startswith('SternRamp'))
ramp.rotation_mode = 'XYZ'; ramp.rotation_euler = (DROOP, 0, 0)
bpy.context.view_layer.update()

def wverts(objs):
    for o in objs:
        if o.type == 'MESH':
            mw = o.matrix_world
            for v in o.data.vertices: yield mw @ v.co
hinge = ramp.matrix_world.translation
print(f'FIT ramp hinge {tuple(round(c, 3) for c in hinge)} (want (0, 0, 2.6))')
rv = list(wverts(ramp.children_recursive)) + list(wverts([ramp]))
low = min(rv, key=lambda v: v.z)
on_plate = [v for v in rv if PLATE_Y[0] <= v.y <= PLATE_Y[1] and abs(v.x) <= 4.75]
pen = min(v.z for v in on_plate) - LAND if on_plate else None
print(f'FIT ramp lowest {tuple(round(c, 3) for c in low)}; toe tip y {round(min(v.y for v in rv), 3)}; '
      f'lowest over plate minus plate top ({LAND}) = {round(pen, 3) if pen is not None else "n/a"}')
body = [v for v in rv if v.y > PLATE_Y[1] and abs(v.x) <= 4.75]
print(f'FIT ramp body lowest (y > plate end) {round(min(v.z for v in body), 3)}; flap underside by y: ' + ', '.join(
    f'{y0}:{round(min((v.z for v in on_plate if y0 - 0.1 <= v.y < y0 + 0.1), default=99), 3)}' for y0 in (-7.1, -7.3, -7.5, -7.7)))
ferry_mesh = [o for o in new if o.type == 'MESH' and o not in ramp.children_recursive and o is not ramp]
door = [v for v in wverts(ferry_mesh) if abs(v.y - 9.7) < 0.75 and 6.9 < v.z < 7.1]
fx = min(v.x for v in door) if door else None
gang = bpy.data.objects['GangwayEnd']
gv = list(wverts(gang.children_recursive))
gx = max(v.x for v in gv)
print(f'FIT ferry port side at the door sill (z 7.0, y 9.7) min x {round(fx, 3) if fx is not None else "n/a"}; gangway lip max x {round(gx, 3)}; '
      f'gap {round(fx - gx, 3) if fx is not None else "n/a"}; gangway floor z {round(max(v.z for v in gv if v.z < 7.05), 3)}')
ferry_all = list(wverts(ferry_mesh))
side = [v for v in ferry_all if 0.5 < v.z < 4.0]
print(f'FIT ferry extents x [{min(v.x for v in ferry_all):.2f}, {max(v.x for v in ferry_all):.2f}] '
      f'y [{min(v.y for v in ferry_all):.2f}, {max(v.y for v in ferry_all):.2f}] z [{min(v.z for v in ferry_all):.2f}, {max(v.z for v in ferry_all):.2f}]; '
      f'hull min x below z 4 {min(v.x for v in side):.2f} (jetty fender face -9.5)')

# ---- the game's cars in the bays and the check-in lanes (render only; the GLB ships the bays empty) ------------
def car_kind(stem):
    path = ROOT / 'public/rally' / f'{stem}.glb'
    if not path.exists(): return None
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=str(path)); bpy.context.view_layer.update()
    new = [o for o in bpy.data.objects if o not in before]; vs = list(wverts(new))
    lo = Vector([min(v[k] for v in vs) for k in range(3)]); hi = Vector([max(v[k] for v in vs) for k in range(3)])
    col = bpy.data.collections.new(f'Car {stem}'); col.instance_offset = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)
    for o in new:
        for c in list(o.users_collection): c.objects.unlink(o)
        col.objects.link(o)
    print(f'CAR {stem} size x {hi.x - lo.x:.2f} y {hi.y - lo.y:.2f} z {hi.z - lo.z:.2f} (the importer turns the bow, glTF +Z, to -Y)')
    return col
kinds = [k for k in (car_kind(s) for s in ('aster_rs', 'black_jeep', 'support_wagon', 'support_pickup')) if k]
crng = random.Random(7)
def park(x, y, hd, z):
    e = bpy.data.objects.new('ParkedCar', None); e.instance_type = 'COLLECTION'; e.instance_collection = crng.choice(kinds)
    e.location = (x, y, z); e.rotation_euler = (0.0, 0.0, hd + math.pi / 2); bpy.context.collection.objects.link(e)
if kinds:
    bays = [b for b in SITE['parking'] if crng.random() < 0.62]
    for x, y, hd in bays: park(x + crng.uniform(-0.12, 0.12), y + crng.uniform(-0.08, 0.08), hd + crng.uniform(-0.03, 0.03), 3.2)
    queued = [q for q in SITE['lanes'] if crng.random() < 0.7]
    for x, y in queued: park(x, y, math.pi / 2, 3.225)
    print(f'CARS {len(bays)} parked of {len(SITE["parking"])} bays, {len(queued)} queued, {len(kinds)} models')

def camera(name, location, target, lens=35):
    data = bpy.data.cameras.new(name); data.lens = lens; data.clip_end = 5000
    cam = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(cam)
    cam.location = location
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    return cam

views = {
    'overview': ((60, -215, 150), (-55, 70, 0), 33),
    'beach': ((90, -180, 25), (-30, -20, 3), 30),
    'island': ((130, 170, 130), (-70, -70, 0), 28),
    'road': ((-10, -138, 34), (-24, -100, 3), 30),
    'jetty': ((-38, 96, 13), (-13, 30, 4.5), 28),
    'landing': ((-44, 47, 4.0), (-57, 60, 1.6), 30),
    'gangway': ((-12.6, 21.0, 4.8), (-9.9, 9.7, 7.7), 24),
    'gangwayup': ((-26, 22, 17), (-10.5, 9.7, 8.0), 30),
    'linkspan': ((-9, -42, 9.5), (0, -9, 2.6), 28),
    'ramptoe': ((4.6, -14.8, 4.3), (0, -7.6, 2.3), 30),
    'building': ((-6, -48, 9), (-33, -12, 5), 26),
    'buildingwest': ((-82, -42, 13), (-40, -12, 5), 28),
    'breakwater': ((-68, 118, 15), (-112, 136, 2), 28),
    'breakwaterout': ((-178, 128, 24), (-124, 138, 2), 28),
    'yard': ((32, -104, 26), (0, -60, 3), 28),
    'slipway': ((30, -2, 9), (14, -17, 1.5), 28),
    'armour': ((-92, 126, 6.5), (-110, 138, 1.5), 30),
    'counter': ((-33.0, -18.5, 5.0), (-40.5, -18.5, 4.4), 20),
    'cafe': ((-36.5, -13.0, 5.3), (-26.0, -30.0, 4.3), 18),
}
FILL = {'counter': ((-36, -18.5, 6.7), 2500), 'cafe': ((-30, -24, 6.7), 3000)}
bpy.ops.object.light_add(type='AREA', location=(0, 0, -50))
fill = bpy.context.object; fill.data.energy = 0; fill.data.size = 8.0; fill.data.color = (1.0, 0.95, 0.88)
import numpy as np
for name in wanted:
    at, energy = FILL.get(name, ((0, 0, -50), 0))
    fill.location = at; fill.data.energy = energy
    if name == 'topdown':
        data = bpy.data.cameras.new(name); data.type = 'ORTHO'; data.ortho_scale = 191.0; data.clip_end = 5000
        cam = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(cam)
        cam.location = (-32.0, 59.0, 400.0); cam.rotation_euler = (0.0, 0.0, math.atan2(0.6, -0.8))
        scene.camera = cam; scene.render.resolution_x, scene.render.resolution_y = 1600, 1034
    else:
        location, target, lens = views[name]
        scene.camera = camera(name, location, target, lens); scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.filepath = str(out / f'terminal-{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)
    if name == 'topdown' and REF.exists():
        ren = bpy.data.images.load(scene.render.filepath); ref = bpy.data.images.load(str(REF))
        ref.scale(1600, 1034)
        a = np.empty(1600 * 1034 * 4, np.float32); ren.pixels.foreach_get(a)
        b = np.empty(1600 * 1034 * 4, np.float32); ref.pixels.foreach_get(b)
        both = np.concatenate([a.reshape(1034, 1600, 4), b.reshape(1034, 1600, 4)], axis=1)
        img = bpy.data.images.new('side', 3200, 1034); img.pixels.foreach_set(both.ravel())
        img.filepath_raw = str(out / 'terminal-topdown-vs-ref4.png'); img.file_format = 'PNG'; img.save()
        print('RENDERED', img.filepath_raw)
