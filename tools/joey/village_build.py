"""Joey Island shopping village: a single-storey island shopping strip on the Joey terminal flat, built
procedurally in Blender (metres). Run:
  Blender --background --factory-startup --python tools/joey/village_build.py
Outputs public/joey/village.glb and public/joey/village_colliders.json.

Everything is authored in the game's terminal frame, the frame of public/ferry/terminal_colliders.json: +z out to
sea, +x to the left looking out to sea, +y up, the yard paving at y 3.2. B() maps it to Blender (x' = -x, y' = z,
z' = y) and the exported root turns 180 deg about Z like the terminal's, so the GLB placed with the Joey terminal's
position and yaw lines up with terminal.glb. Colliders and stations are written straight in the terminal frame.

The site is the free grass at x 10..47, z -95..-58, between the yard road (z -101.2) and the terminal car park. A
skillion-roofed row of four shops (x 12..46, shopfronts at z -70, back wall at z -60) faces the yard road over a
verandah on posts, a concrete footpath, a kerb with bollards and a 24-bay car park with a driveway off the road.
Two shops trade (Joey Island Tackle & Bait, Joey Island Gifts) and have real door gaps, floors, counters and
fittings; the cafe and the general store are dressed shopfronts with closed doors. Materials whose names start
with W get the runtime weathering in src/joey/Village.js (world-space grime and grain).
"""
import sys, math, random, json
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rally'))
from blender_primitives import material, mesh, join_group, groups

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
rng = random.Random(2611)

# ---- geometry helpers, all in the terminal frame ------------------------------------------------------------
BATCH, TEXT_STATS = {}, []
def B(p): return (-p[0], p[2], p[1])
# Draw calls: plain-coloured materials fold into a few shared "Pal" materials (split by weathering, metalness and
# roughness) and keep their own colour per vertex, varied a little per piece, so the strip is a few dozen draws, not
# hundreds. Glows, glass and the patterned surfaces (*Pat*, shaded in src/joey/Village.js) stay materials of their own.
# The interior ("I") goes into one group per shop, so each can be culled and kept out of the shadow pass.
FAMILY, VAR = {}, random.Random(4127)
def family(mat):
    n = mat.node_tree.nodes['Principled BSDF']; rgb = tuple(n.inputs['Base Color'].default_value[:3])
    if mat.name.startswith(('WPat', 'Pat')) or 'Glass' in mat.name or n.inputs['Emission Strength'].default_value > 0: return mat, (1.0, 1.0, 1.0)
    m, r = n.inputs['Metallic'].default_value, n.inputs['Roughness'].default_value
    mi, ri = (0 if m < 0.3 else 1 if m < 0.7 else 2), (0 if r < 0.28 else 1 if r < 0.5 else 2 if r < 0.75 else 3)
    key = f"{'W' if mat.name.startswith('W') else ''}Pal M{mi} R{ri}"
    if key not in FAMILY: FAMILY[key] = material(key, (1, 1, 1), (0.0, 0.5, 0.9)[mi], (0.2, 0.4, 0.62, 0.88)[ri])
    return FAMILY[key], rgb
def shop_group(g, bverts):
    if g != 'I': return 'Shell'
    x = -bverts[0][0]
    return 'InTackle' if x > 37.0 else 'InGifts' if x > 28.5 else 'InCafe' if x > 20.0 else 'InStore'
def put(g, mat, bverts, faces, vary=0.07):
    """Blender-space vertices into group g's batch, with the material's colour per vertex."""
    fam, rgb = family(mat)
    if fam is not mat and vary: k = 1.0 + VAR.uniform(-vary, vary); rgb = tuple(min(1.0, c * k) for c in rgb)
    b = BATCH.setdefault((g, shop_group(g, bverts), fam.name), [[], [], fam, []])
    o = len(b[0]); b[0].extend(bverts); b[1].extend(tuple(i + o for i in f) for f in faces); b[3].extend([rgb] * len(bverts))
def add(g, mat, verts, faces): put(g, mat, [B(v) for v in verts], faces)
HEX = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
def box(g, mat, x0, x1, y0, y1, z0, z1):
    x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
    add(g, mat, [(x, y, z) for y in (y0, y1) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))], HEX)
def obox(g, mat, c, u, v, w):
    """A box about c with half-axis vectors u, v, w."""
    c, u, v, w = Vector(c), Vector(u), Vector(v), Vector(w)
    add(g, mat, [c + sw * w + a * u + b * v for sw in (-1, 1) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))], HEX)
def wedge(g, mat, x0, x1, z0, z1, y0, ya, yb):
    """A wall x0..x1, z0..z1 from y0 up to ya at z0 and yb at z1."""
    add(g, mat, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, ya, z0), (x1, ya, z0), (x1, yb, z1), (x0, yb, z1)], HEX)
def cyl(g, mat, p0, p1, r, n=12, r1=None, caps=True):
    p0, p1 = Vector(p0), Vector(p1); d = (p1 - p0).normalized()
    u = d.orthogonal().normalized(); v = d.cross(u).normalized(); r1 = r if r1 is None else r1
    ring = [u * math.cos(k * math.tau / n) + v * math.sin(k * math.tau / n) for k in range(n)]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    if caps: faces += [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    add(g, mat, [p0 + q * r for q in ring] + [p1 + q * r1 for q in ring], faces)
def disc(g, mat, c, rx, rz, n=10, jit=0.0):
    pts = [(c[0] + rx * math.cos(k * math.tau / n) * (1 + rng.uniform(-jit, jit)), c[1], c[2] + rz * math.sin(k * math.tau / n) * (1 + rng.uniform(-jit, jit))) for k in range(n)]
    add(g, mat, pts, [tuple(range(n))])
def quad(g, mat, pts): add(g, mat, pts, [(0, 1, 2, 3)])
def _ico(sub):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    V = [v.co.copy() for v in bm.verts]; F = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free(); return V, F
ICO1, ICO2 = _ico(1), _ico(2)
def blob(g, mat, c, r, ico=ICO1, jit=0.0, flat_base=None):
    V, F = ico; out = []
    for v in V:
        k = 1 + rng.uniform(-jit, jit); y = c[1] + v.z * r[1] * k
        if flat_base is not None: y = max(y, flat_base)
        out.append((c[0] + v.x * r[0] * k, y, c[2] + v.y * r[2] * k))
    add(g, mat, out, F)
def corrugated(g, mat, x0, x1, z0, y0, z1, y1, pitch=0.0762, depth=0.017):
    """A corrugated sheet across x0..x1, its ribs running from (z0, y0) to (z1, y1)."""
    n = int((x1 - x0) / (pitch / 3)); verts = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n; h = depth * 0.5 * (1 - math.cos(math.tau * (x - x0) / pitch))
        verts += [(x, y0 + h, z0), (x, y1 + h, z1)]
    add(g, mat, verts, [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(n)])

FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT_SERIF = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'
FONT_SIGN = '/System/Library/Fonts/Supplemental/Arial Black.ttf'
FACES = {'S': (math.pi / 2, 0, 0), 'N': (math.pi / 2, 0, math.pi), '+X': (math.pi / 2, 0, -math.pi / 2), '-X': (math.pi / 2, 0, math.pi / 2)}
def tidy_glyphs(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)     # no degenerate dissolve: it ate the foot of L at low resolution
    for f in bm.faces: f.smooth = False
    bm.to_mesh(obj.data); bm.free()
def text(g, body, p, size, mat, face='S', font=FONT, extrude=0.0, tilt=0.0, spacing=1.0):
    """Text centred on p, facing the terminal-frame direction `face` (S = toward the car park, -z)."""
    data = bpy.data.curves.new(body[:20], 'FONT'); data.body = body
    data.align_x = 'CENTER'; data.align_y = 'CENTER'; data.size = size; data.extrude = extrude
    data.resolution_u = 3 if extrude else 2; data.space_character = spacing
    if Path(font).exists(): data.font = bpy.data.fonts.load(font, check_existing=True)
    data.materials.append(mat)
    obj = bpy.data.objects.new(f'Text {body[:20]}', data); bpy.context.collection.objects.link(obj)
    r = FACES[face]; obj.location = B(p); obj.rotation_euler = (r[0] - tilt, r[1], r[2])
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH'); obj.select_set(False); tidy_glyphs(obj)
    mw = Matrix.Translation(obj.location) @ obj.rotation_euler.to_matrix().to_4x4()      # glyphs join the batches
    put(g, mat, [tuple(mw @ v.co) for v in obj.data.vertices], [tuple(p.vertices) for p in obj.data.polygons], 0.0)
    bpy.data.objects.remove(obj, do_unlink=True)
    TEXT_STATS.append(body)

SMOOTH = {'Roof'}
def flush():
    for (g, target, _), (v, f, m, c) in BATCH.items():
        if not f: continue
        obj = mesh(f'{target} {m.name}', v, f, m, group=target, smooth=True)
        try: obj.data.set_sharp_from_angle(angle=math.radians(35 if g not in SMOOTH else 60))
        except Exception as err: print('VILLAGE sharp-edges skipped', err)
        attr = obj.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); flat = []
        for rgb in c: flat.extend((*rgb, 1.0))
        attr.data.foreach_set('color', flat); obj.data.color_attributes.active_color = attr
    BATCH.clear()

COLLIDERS, STATIONS = [], {}
def col(kind, x0, x1, y0, y1, z0, z1):
    x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
    COLLIDERS.append({'kind': kind, 'center': [round((x0 + x1) / 2, 3), round((y0 + y1) / 2, 3), round((z0 + z1) / 2, 3)],
                      'half': [round((x1 - x0) / 2, 3), round((y1 - y0) / 2, 3), round((z1 - z0) / 2, 3)]})
def station(name, p): STATIONS[name] = [round(c, 3) for c in p]

# ---- materials (W* ones are weathered at runtime) --------------------------------------------------------------
M = material
def glow(mat, rgb, k):
    n = mat.node_tree.nodes['Principled BSDF']; n.inputs['Emission Color'].default_value = (*rgb, 1); n.inputs['Emission Strength'].default_value = k; return mat
RENDER = M('WRenderCream', (0.74, 0.68, 0.56), 0, 0.9); RENDER_PIER = M('WRenderPier', (0.82, 0.79, 0.72), 0, 0.88)
PAINT_IN = glow(M('WallPaintInside', (0.7, 0.66, 0.58), 0, 0.85), (0.95, 0.86, 0.72), 0.28)   # warm white, lit by the troffers
CONC = M('WConcrete', (0.55, 0.54, 0.5), 0, 0.92); CONC_KERB = M('WKerb', (0.63, 0.62, 0.58), 0, 0.9)
JOINT = M('SawCut', (0.2, 0.2, 0.19), 0, 0.95)
ASPH = M('WAsphalt', (0.085, 0.085, 0.09), 0, 0.93); ASPH2 = M('WAsphaltPatch', (0.05, 0.05, 0.055), 0, 0.9)
OIL = M('OilStain', (0.02, 0.02, 0.022), 0, 0.55)
LINE = M('WLineWhite', (0.8, 0.8, 0.76), 0, 0.7); LINE_F = M('WLineFaded', (0.5, 0.5, 0.48), 0, 0.8)
LINE_Y = M('WLineYellow', (0.85, 0.62, 0.05), 0, 0.7); BAY_BLUE = M('WBayBlue', (0.04, 0.2, 0.5), 0, 0.75)
ROOF = M('WRoofZincalume', (0.62, 0.64, 0.64), 0.75, 0.42); VROOF = M('WRoofSurfmist', (0.8, 0.8, 0.77), 0.2, 0.45)
FLASH = M('Flashing', (0.7, 0.71, 0.7), 0.8, 0.35); GUTTER = M('WGutterMonument', (0.2, 0.21, 0.22), 0.3, 0.5)
STEEL = M('WPostPaint', (0.16, 0.17, 0.18), 0.3, 0.55); GALV = M('WGalv', (0.58, 0.6, 0.6), 0.85, 0.45)
LINING = M('WLiningTimber', (0.55, 0.38, 0.22), 0, 0.7); LINING2 = M('WLiningTimber2', (0.49, 0.33, 0.19), 0, 0.72)
FRAME = M('AnodisedBronze', (0.1, 0.085, 0.07), 0.7, 0.4); STAINLESS = M('Stainless', (0.75, 0.76, 0.77), 1.0, 0.22)
GLASS = M('ShopGlass', (0.06, 0.09, 0.1), 0.0, 0.03)
_g = GLASS.node_tree.nodes['Principled BSDF']; _g.inputs['Alpha'].default_value = 0.28
if 'Transmission Weight' in _g.inputs: _g.inputs['Transmission Weight'].default_value = 0.85
if hasattr(GLASS, 'surface_render_method'): GLASS.surface_render_method = 'BLENDED'
if hasattr(GLASS, 'blend_method'): GLASS.blend_method = 'BLEND'
FLOOR_T = M('WFloorVinylGrey', (0.42, 0.42, 0.4), 0, 0.5); FLOOR_G = M('WFloorTimber', (0.5, 0.36, 0.22), 0, 0.45)
# Inside, the engine's sky and ground ambient has no roof to stop it (a ceiling faces the green ground bounce), so
# ceilings and inside linings carry a warm emissive fill standing in for the shop lighting.
CEIL = glow(M('CeilingTile', (0.22, 0.22, 0.21), 0, 0.85), (0.9, 0.89, 0.85), 0.62); PANEL = M('CeilingPanelLight', (1.0, 0.97, 0.9), 0, 0.3, 3.0)
TUBE = M('VerandahTube', (1.0, 0.96, 0.88), 0, 0.3, 2.0)
LAMINATE = M('CounterLaminate', (0.86, 0.85, 0.8), 0, 0.3); TIMBER = M('WCounterTimber', (0.42, 0.27, 0.15), 0, 0.5)
MDF = M('ShelfWhite', (0.82, 0.82, 0.8), 0, 0.6); PEG = M('Pegboard', (0.62, 0.52, 0.38), 0, 0.8)
BLACK = M('BlackPlastic', (0.02, 0.02, 0.022), 0.1, 0.45); SCREEN = M('RegisterScreen', (0.35, 0.6, 0.95), 0, 0.2, 1.4)
FREEZER = M('FreezerWhite', (0.88, 0.89, 0.9), 0.1, 0.35); FRIDGE_GLOW = M('FridgeGlow', (0.75, 0.88, 1.0), 0, 0.2, 1.2)
BENCH_T = M('WBenchTimber', (0.4, 0.3, 0.2), 0, 0.8); BIN_T = M('WBinSlats', (0.33, 0.24, 0.16), 0, 0.85)
MULCH = M('WMulch', (0.13, 0.095, 0.065), 0, 1.0)       # weathered bark mulch, not terracotta
LEAF = [M('WLeafSaltbush', (0.25, 0.3, 0.22), 0, 0.85), M('WLeafWestringia', (0.12, 0.2, 0.09), 0, 0.8),
        M('WLeafGrass', (0.28, 0.27, 0.12), 0, 0.9), M('WLeafBanksia', (0.08, 0.15, 0.06), 0, 0.8)]
BARK = M('WBark', (0.22, 0.18, 0.14), 0, 0.95); POT = M('WTerracotta', (0.55, 0.26, 0.14), 0, 0.85)
GRIME = M('Grime', (0.09, 0.08, 0.06), 0, 0.95); RUST = M('RustStreak', (0.33, 0.16, 0.06), 0, 0.9)
YELLOW = M('SafetyYellow', (0.9, 0.68, 0.02), 0, 0.5); RED = M('SignalRed', (0.7, 0.05, 0.04), 0, 0.5)
WHITE = M('SignWhite', (0.9, 0.9, 0.88), 0, 0.5); CREAM = M('SignCream', (0.93, 0.88, 0.74), 0, 0.55)
NAVY = M('SignNavy', (0.02, 0.05, 0.12), 0, 0.5); TEAL = M('SignTeal', (0.0, 0.33, 0.36), 0, 0.5)
ORANGE = M('SignOrange', (0.92, 0.42, 0.06), 0, 0.5); SAGE = M('SignSage', (0.3, 0.4, 0.3), 0, 0.55)
BRICKRED = M('SignRed', (0.42, 0.07, 0.05), 0, 0.55); CHALK = M('Chalkboard', (0.06, 0.08, 0.07), 0, 0.9)
LAMP = M('LampGlow', (1.0, 0.9, 0.72), 0, 0.3, 3.0)
PROD = [M(f'Product{i}', c, 0, 0.5) for i, c in enumerate([(0.75, 0.1, 0.08), (0.95, 0.7, 0.1), (0.1, 0.32, 0.65), (0.1, 0.5, 0.25),
        (0.85, 0.85, 0.8), (0.55, 0.2, 0.5), (0.95, 0.45, 0.08), (0.05, 0.05, 0.06), (0.2, 0.6, 0.7)])]
ROD = [M('RodGraphite', (0.03, 0.03, 0.035), 0.4, 0.3), M('RodBlue', (0.03, 0.12, 0.35), 0.4, 0.3),
       M('RodRed', (0.4, 0.04, 0.03), 0.4, 0.3), M('RodGlass', (0.55, 0.5, 0.35), 0.1, 0.35)]
CORK = M('CorkGrip', (0.6, 0.45, 0.28), 0, 0.8); REEL = M('ReelAlloy', (0.6, 0.6, 0.62), 0.9, 0.3)
PLUSH = M('PlushJoey', (0.45, 0.36, 0.28), 0, 0.95); PLUSH_IN = M('PlushPale', (0.75, 0.66, 0.55), 0, 0.95)
SNOWGLASS = M('GlobeGlass', (0.8, 0.9, 0.95), 0, 0.05)
TILE = {'tackle': M('WTileTeal', (0.02, 0.22, 0.24), 0.05, 0.3), 'gifts': M('WTileOchre', (0.62, 0.42, 0.12), 0.05, 0.3),
        'cafe': M('WTileSage', (0.25, 0.33, 0.24), 0.05, 0.3), 'store': M('WTileBrick', (0.38, 0.12, 0.07), 0.05, 0.3)}
DOOR = M('WDoorSteel', (0.36, 0.38, 0.36), 0.2, 0.6); CONDENSER = M('WCondenser', (0.78, 0.78, 0.74), 0.1, 0.55)
BIN_GREEN = M('WWheelieBin', (0.08, 0.22, 0.1), 0, 0.6); LID_RED = M('BinLidRed', (0.65, 0.06, 0.05), 0, 0.5)
LID_YEL = M('BinLidYellow', (0.85, 0.66, 0.05), 0, 0.5); SOLAR = M('SolarPanel', (0.03, 0.05, 0.1), 0.3, 0.15)
GAS = M('GasBottle', (0.72, 0.73, 0.72), 0.3, 0.45); COFFEE = M('CoffeeMachine', (0.6, 0.6, 0.62), 1.0, 0.25)

# ---- levels and plan ------------------------------------------------------------------------------------------
# The car park top matches the terminal yard's asphalt (HARD + 0.025). At 3.2 it was level with the terminal's own
# sandy-gravel sheet under it, and the two z-fought in 1 m steps of beige across the bays.
PAVE, PATH, FL = 3.225, 3.33, 3.37    # car park top, footpath top, shop floor top
FZ, WT, BZ = -70.0, 0.22, -60.0       # shopfront face, wall thickness, back wall face
PARA, ROOF_F, ROOF_B = 7.55, 7.22, 6.8   # parapet top, main roof at the front and at the back
VY0, VY1, VZ1 = 6.32, 5.98, -74.3     # verandah sheet at the wall, at the front, its front edge
CEIL_Y = 6.2
X0, X1 = 12.0, 46.0
KERB_Z = -74.62                       # kerb face (the car park starts here)
PIERS = [12.0, 20.0, 28.5, 37.0, 46.0]
SHOPS = [
    dict(key='tackle', x0=37.0, x1=46.0, door=(40.4, 42.2), open=True, board=NAVY, ink=WHITE, accent=ORANGE,
         name='JOEY ISLAND TACKLE & BAIT', hang='TACKLE  BAIT  ICE'),
    dict(key='gifts', x0=28.5, x1=37.0, door=(31.9, 33.7), open=True, board=CREAM, ink=TEAL, accent=ORANGE,
         name='JOEY ISLAND GIFTS', hang='GIFTS & SOUVENIRS'),
    dict(key='cafe', x0=20.0, x1=28.5, door=(23.35, 25.15), open=False, board=SAGE, ink=CREAM, accent=CREAM,
         name='SALTBUSH CAFE', hang='COFFEE'),
    dict(key='store', x0=12.0, x1=20.0, door=(15.1, 16.9), open=False, board=BRICKRED, ink=CREAM, accent=CREAM,
         name='GENERAL STORE', hang='GROCERIES  ICE'),
]

# ---- 1. car park, driveway, kerbs and gardens -------------------------------------------------------------------
V = 'V'
box(V, ASPH, 12.8, 45.2, 2.95, PAVE, -94.6, KERB_Z); col('car', 12.8, 45.2, 2.95, PAVE, -94.6, KERB_Z)
box(V, ASPH, 29.0, 36.0, 2.95, PAVE, -98.4, -94.6); col('car', 29.0, 36.0, 2.95, PAVE, -98.4, -94.6)
for (a, b, c, d) in ((14.0, 18.5, -84.8, -82.9), (38.2, 40.6, -92.3, -90.9), (30.0, 34.5, -97.6, -95.9)):
    box(V, ASPH2, a, b, PAVE, PAVE + 0.003, c, d)      # patched trenches
for k in range(12):                                     # oil drips in the bays
    if rng.random() < 0.6: disc(V, OIL, (14.7 + 2.6 * k + rng.uniform(-0.3, 0.3), PAVE + 0.004, -77.6 + rng.uniform(-0.6, 0.6)), rng.uniform(0.25, 0.5), rng.uniform(0.3, 0.6), 10, 0.25)
    if rng.random() < 0.5: disc(V, OIL, (14.7 + 2.6 * k + rng.uniform(-0.3, 0.3), PAVE + 0.004, -88.8 + rng.uniform(-0.6, 0.6)), rng.uniform(0.2, 0.45), rng.uniform(0.3, 0.55), 10, 0.25)
def paint_line(x0, x1, z0, z1, y=PAVE + 0.006):
    """A painted line, broken where it has worn."""
    along_z = abs(z1 - z0) > abs(x1 - x0); L = abs(z1 - z0) if along_z else abs(x1 - x0); t = 0.0
    while t < L:
        s = min(L, t + rng.uniform(0.6, 2.4)); mat = LINE if rng.random() < 0.8 else LINE_F
        if along_z: box(V, mat, x0, x1, y - 0.003, y, min(z0, z1) + t, min(z0, z1) + s)
        else: box(V, mat, min(x0, x1) + t, min(x0, x1) + s, y - 0.003, y, z0, z1)
        t = s + (rng.uniform(0.03, 0.15) if rng.random() < 0.3 else 0.0)
for k in range(13):
    x = 13.4 + 2.6 * k
    paint_line(x - 0.05, x + 0.05, KERB_Z, -80.0); paint_line(x - 0.05, x + 0.05, -86.0, -91.4)
paint_line(13.4, 44.6, -80.05, -79.95); paint_line(13.4, 44.6, -86.05, -85.95)
box(V, BAY_BLUE, 13.45, 15.95, PAVE, PAVE + 0.004, -79.95, KERB_Z)    # the accessible bay, shared zone hatched beside it
for i in range(5): obox(V, LINE_Y, (17.3, PAVE + 0.005, -75.6 - 0.8 * i), (0.9, 0, 0.9), (0.05, 0, -0.05), (0, 0.002, 0))
for k in range(12):                                     # wheel stops
    for z in (-75.45, -90.55):
        x = 14.7 + 2.6 * k; box(V, CONC_KERB, x - 0.82, x + 0.82, PAVE, PAVE + 0.1, z - 0.08, z + 0.08)
        for e in (-0.82, 0.62): box(V, YELLOW, x + e, x + e + 0.2, PAVE + 0.001, PAVE + 0.101, z - 0.081, z + 0.081)
for zc in (-83.0,):                                     # direction arrows in the aisle
    for xc, s in ((32.5, 1), (22.0, -1)):
        add(V, LINE, [(xc - 1.2 * s, PAVE + 0.006, zc - 0.12), (xc + 0.4 * s, PAVE + 0.006, zc - 0.12), (xc + 0.4 * s, PAVE + 0.006, zc + 0.12), (xc - 1.2 * s, PAVE + 0.006, zc + 0.12)], [(0, 1, 2, 3)])
        add(V, LINE, [(xc + 0.4 * s, PAVE + 0.006, zc - 0.45), (xc + 1.2 * s, PAVE + 0.006, zc), (xc + 0.4 * s, PAVE + 0.006, zc + 0.45)], [(0, 1, 2)])
box(V, GALV, 28.6, 29.2, PAVE, PAVE + 0.02, -83.3, -82.7)                      # stormwater grate
for i in range(7): box(V, BLACK, 28.64 + 0.08 * i, 28.68 + 0.08 * i, PAVE + 0.02, PAVE + 0.021, -83.25, -82.75)
# Coastal planting for the beds, leaf by leaf (low icosphere blobs read as dark boulders). Leaves are thin strips with
# both windings so they show from either side. A separate generator keeps the rest of the village's random draws put.
prng = random.Random(4417)
LOMANDRA = M('WLeafLomandra', (0.1, 0.17, 0.055), 0, 0.7); LOMANDRA_DRY = M('WLeafLomandraDry', (0.32, 0.28, 0.15), 0, 0.85)
ROSEMARY = M('WLeafRosemary', (0.2, 0.24, 0.17), 0, 0.8); ROSEMARY_PALE = M('WLeafRosemaryPale', (0.33, 0.36, 0.3), 0, 0.8)
ROSEMARY_CORE = M('WLeafRosemaryShade', (0.09, 0.115, 0.07), 0, 0.95); FLOWER = M('WFlowerWhite', (0.8, 0.8, 0.84), 0, 0.7)
BANK_TOP = M('WLeafBanksiaTop', (0.07, 0.13, 0.05), 0, 0.55); BANK_UNDER = M('WLeafBanksiaUnder', (0.4, 0.42, 0.37), 0, 0.8)
BANK_CONE = M('WBanksiaCone', (0.6, 0.5, 0.14), 0, 0.85)
def both(g, mat, pts, faces, back=None):
    add(g, mat, pts, faces); add(g, back or mat, pts, [f[::-1] for f in faces])
def lomandra(x, z, h, y0=3.24):
    """Lomandra longifolia: a tussock of long strap leaves springing from the crown and arching out."""
    for _ in range(prng.randint(56, 72)):
        ang = prng.uniform(0, math.tau); lean = prng.uniform(0.1, 1.0); L = h * prng.uniform(0.75, 1.2); w = prng.uniform(0.012, 0.019)
        ca, sa = math.cos(ang), math.sin(ang); bx, bz = x + ca * prng.uniform(0, 0.09), z + sa * prng.uniform(0, 0.09); pts = []
        for i in range(4):
            t = i / 3; r_ = L * (0.1 * t + lean * 0.6 * t * t); yy = y0 + L * (t - lean * 0.5 * t * t); ww = w * (1 - 0.85 * t)
            pts += [(bx + ca * r_ - sa * ww, yy, bz + sa * r_ + ca * ww), (bx + ca * r_ + sa * ww, yy, bz + sa * r_ - ca * ww)]
        both(V, LOMANDRA_DRY if prng.random() < 0.1 else LOMANDRA, pts, [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(3)])
def rosemary(x, z, r, y0=3.24):
    """Coastal rosemary (Westringia fruticosa): a dense mound of small grey-green needle leaves over a shaded core."""
    hy = r * 0.8
    for _ in range(3):
        blob(V, ROSEMARY_CORE, (x + prng.uniform(-0.3, 0.3) * r, y0 + hy * 0.5, z + prng.uniform(-0.3, 0.3) * r), (r * 0.62, hy * 0.55, r * 0.62), ICO1, 0.2, flat_base=y0 - 0.02)
    for _ in range(int(1500 * r)):
        th = prng.uniform(0, math.tau); ph = math.acos(prng.uniform(-0.15, 1.0)); k = prng.uniform(0.82, 1.04)
        n = Vector((math.sin(ph) * math.cos(th), math.cos(ph), math.sin(ph) * math.sin(th)))
        p = Vector((x + n.x * r * k, y0 + hy * 0.45 + n.y * hy * 0.6 * k, z + n.z * r * k))
        dv = (n + Vector((prng.uniform(-0.7, 0.7), prng.uniform(-0.2, 0.9), prng.uniform(-0.7, 0.7)))).normalized()
        sv = dv.cross(Vector((0, 1, 0))); sv = sv.normalized() if sv.length > 1e-3 else Vector((1, 0, 0))
        Lf, wf = prng.uniform(0.06, 0.1), prng.uniform(0.009, 0.014)
        both(V, ROSEMARY_PALE if prng.random() < 0.3 else ROSEMARY, [tuple(p - sv * wf), tuple(p + sv * wf), tuple(p + dv * Lf)], [(0, 1, 2)])
    for _ in range(int(14 * r)):                        # a few small white flowers
        th = prng.uniform(0, math.tau); ph = prng.uniform(0.2, 1.3)
        c0 = Vector((x + math.sin(ph) * math.cos(th) * r, y0 + hy * 0.45 + math.cos(ph) * hy * 0.62, z + math.sin(ph) * math.sin(th) * r))
        both(V, FLOWER, [tuple(c0 + Vector((-0.012, 0, 0))), tuple(c0 + Vector((0.012, 0.004, 0))), tuple(c0 + Vector((0, 0.01, 0.012)))], [(0, 1, 2)])
def banksia(x, z, h, y0=3.24):
    """A young coast banksia (Banksia integrifolia): short trunk, a few rising branches, whorls of leathery leaves,
    dark above and silver beneath, and pale yellow flower spikes."""
    top = Vector((x + prng.uniform(-0.05, 0.05), y0 + h * 0.3, z + prng.uniform(-0.05, 0.05)))
    cyl(V, BARK, (x, y0 - 0.05, z), tuple(top), 0.065, 8, 0.05)
    for bi in range(6):
        a_ = bi * math.tau / 6 + prng.uniform(-0.4, 0.4); tip = top + Vector((math.cos(a_) * h * prng.uniform(0.2, 0.36), h * prng.uniform(0.35, 0.62), math.sin(a_) * h * prng.uniform(0.2, 0.36)))
        cyl(V, BARK, tuple(top), tuple(tip), 0.03, 6, 0.014)
        for _ in range(prng.randint(7, 9)):                 # dense whorls over the outer half of each branch
            cp = top.lerp(tip, prng.uniform(0.45, 1.0)) + Vector((prng.uniform(-0.2, 0.2), prng.uniform(-0.08, 0.16), prng.uniform(-0.2, 0.2)))
            nl = prng.randint(14, 18)
            for li in range(nl):
                an = li * math.tau / nl + prng.uniform(-0.2, 0.2); el = prng.uniform(-0.55, 0.65)
                dv = Vector((math.cos(el) * math.cos(an), math.sin(el), math.cos(el) * math.sin(an)))
                wv = dv.cross(Vector((0, 1, 0))).normalized(); Lf, wf = prng.uniform(0.13, 0.2), prng.uniform(0.02, 0.028)
                q = [cp, cp + dv * Lf * 0.45 + wv * wf, cp + dv * Lf + Vector((0, -0.02, 0)), cp + dv * Lf * 0.45 - wv * wf]
                up_ = (q[1] - q[0]).cross(q[2] - q[0]).y > 0
                both(V, BANK_TOP if up_ else BANK_UNDER, [tuple(v) for v in q], [(0, 1, 2, 3)], BANK_UNDER if up_ else BANK_TOP)
            if prng.random() < 0.35:
                cyl(V, BANK_CONE, tuple(cp + Vector((0, 0.01, 0))), tuple(cp + Vector((prng.uniform(-0.02, 0.02), 0.11, prng.uniform(-0.02, 0.02)))), 0.028, 8, 0.022)
    col('solid', x - 0.12, x + 0.12, 3.2, 3.2 + h * 0.3, z - 0.12, z + 0.12)
# kerbs and garden beds round the car park, with the driveway gap
for (a, b, c, d) in ((12.6, 12.8, -94.8, KERB_Z), (45.2, 45.4, -94.8, KERB_Z), (12.6, 29.0, -94.8, -94.6), (36.0, 45.4, -94.8, -94.6)):
    box(V, CONC_KERB, a, b, 2.95, PATH, c, d); col('walk', a, b, 2.95, PATH, c, d)
for (a, b, c, d) in ((29.0, 28.2, -98.4, -94.6), (36.0, 36.8, -98.4, -94.6)):     # layback wings
    add(V, CONC_KERB, [(a, PAVE, c), (a, PATH, d), (b, PATH, d), (b, 3.1, c)], [(0, 1, 2, 3)])
for (a, b, c, d) in ((10.8, 12.6, -97.0, -74.4), (45.4, 47.2, -97.0, -74.4), (12.6, 28.2, -97.0, -94.8), (36.8, 45.4, -97.0, -94.8)):
    box(V, MULCH, a, b, 3.0, 3.24, c, d)
    long_x = abs(b - a) > abs(d - c); L = abs(b - a) if long_x else abs(d - c); u = 0.6; k = 0
    while u < L - 0.5:                                  # a planting row down the bed: tussocks, rosemary, now and then a banksia
        w = (0.3 if k % 2 else -0.3) * (min(abs(b - a), abs(d - c)) - 0.9) + prng.uniform(-0.08, 0.08)    # staggered double row
        x, z = (min(a, b) + u, (c + d) / 2 + w) if long_x else ((a + b) / 2 + w, min(c, d) + u)
        if k % 9 == 4 and L > 8: banksia(x, z, prng.uniform(1.7, 2.3)); u += 1.6
        elif prng.random() < 0.55: lomandra(x, z, prng.uniform(0.7, 0.95)); u += prng.uniform(0.5, 0.65)
        else: rosemary(x, z, prng.uniform(0.42, 0.56)); u += prng.uniform(0.6, 0.8)
        k += 1
def tree(x, z, h):
    cyl(V, BARK, (x, 3.2, z), (x + 0.2, 3.2 + h * 0.55, z + 0.1), 0.12, 8, 0.08)
    cyl(V, BARK, (x + 0.2, 3.2 + h * 0.55, z + 0.1), (x - 0.5, 3.2 + h * 0.8, z + 0.3), 0.07, 6, 0.05)
    for _ in range(9):
        blob(V, LEAF[3], (x + rng.uniform(-1.3, 1.3), 3.2 + h * rng.uniform(0.62, 0.95), z + rng.uniform(-1.1, 1.1)), (rng.uniform(0.7, 1.1), rng.uniform(0.45, 0.7), rng.uniform(0.7, 1.0)), ICO1, 0.22)
    col('solid', x - 0.15, x + 0.15, 3.2, 3.2 + h * 0.5, z - 0.15, z + 0.15)
def light_pole(x, z, dx):
    cyl(V, GALV, (x, 3.2, z), (x, 10.0, z), 0.08, 10, 0.055); box(V, CONC, x - 0.25, x + 0.25, 3.0, 3.35, z - 0.25, z + 0.25)
    cyl(V, GALV, (x, 9.9, z), (x + dx, 10.05, z), 0.04, 8)
    box(V, GUTTER, x + dx - 0.35 * (dx > 0) - 0.05, x + dx + 0.35 * (dx < 0) + 0.05, 9.95, 10.1, z - 0.18, z + 0.18)
    box(V, LAMP, x + dx - 0.3 * (dx > 0), x + dx + 0.3 * (dx < 0), 9.94, 9.95, z - 0.14, z + 0.14)
    col('solid', x - 0.1, x + 0.1, 3.2, 10.0, z - 0.1, z + 0.1)
light_pole(12.0, -84.0, 1.4); light_pole(46.0, -84.0, -1.4)
# the customer parking sign at the driveway
cyl(V, GALV, (28.0, 3.2, -95.6), (28.0, 5.6, -95.6), 0.035, 8)
box(V, WHITE, 27.55, 28.45, 4.75, 5.55, -95.66, -95.64); box(V, BLUE := BAY_BLUE, 27.55, 28.45, 5.3, 5.55, -95.67, -95.655)
text('T', 'CUSTOMER', (28.0, 5.43, -95.675), 0.13, WHITE, 'S'); text('T', 'PARKING', (28.0, 5.12, -95.67), 0.17, NAVY, 'S')
text('T', '2P  8AM-6PM', (28.0, 4.88, -95.67), 0.1, NAVY, 'S')

# ---- 2. footpath, kerb, bollards --------------------------------------------------------------------------------
box(V, CONC, 11.9, 46.1, 3.0, PATH, KERB_Z + 0.12, FZ + 0.1); col('walk', 11.9, 46.1, 3.0, PATH, KERB_Z, FZ + 0.1)
box(V, CONC_KERB, 11.9, 46.1, 3.0, PATH + 0.005, KERB_Z, KERB_Z + 0.12)
for i in range(1, 23):
    x = 11.9 + 1.55 * i
    if x < 46.0: box(V, JOINT, x - 0.006, x + 0.006, PATH, PATH + 0.002, KERB_Z + 0.12, FZ)
for x0_, x1_ in ((34.3, 35.7),):                        # kerb ramp with tactile studs
    add(V, CONC, [(x0_, PAVE + 0.001, KERB_Z - 0.01), (x1_, PAVE + 0.001, KERB_Z - 0.01), (x1_, PATH + 0.002, KERB_Z + 0.9), (x0_, PATH + 0.002, KERB_Z + 0.9)], [(0, 1, 2, 3)])
    box(V, YELLOW, x0_ + 0.1, x1_ - 0.1, PATH, PATH + 0.006, KERB_Z + 0.9, KERB_Z + 1.5)
BOLLARDS = [12.6 + 1.3 * k for k in range(26) if not 34.2 < 12.6 + 1.3 * k < 35.8]
for x in BOLLARDS:
    z = KERB_Z - 0.2
    cyl(V, GALV, (x, PAVE, z), (x, PAVE + 0.95, z), 0.09, 12); blob(V, GALV, (x, PAVE + 0.95, z), (0.09, 0.05, 0.09), ICO1)
    for y in (PAVE + 0.72, PAVE + 0.82): cyl(V, YELLOW, (x, y, z), (x, y + 0.06, z), 0.093, 12, caps=False)
    col('solid', x - 0.1, x + 0.1, PAVE, PAVE + 1.0, z - 0.1, z + 0.1)

# ---- 3. the building shell ---------------------------------------------------------------------------------------
W = 'W'
for i, x in enumerate(PIERS):                         # piers, full height, standing proud of the shopfronts
    a, b = (x, x + 0.45) if i == 0 else (x - 0.45, x) if i == len(PIERS) - 1 else (x - 0.225, x + 0.225)
    box(W, RENDER_PIER, a, b, PATH - 0.02, PARA, FZ - 0.08, FZ + WT)
    box(W, GRIME, a + 0.02, b - 0.02, PATH, PATH + 0.18, FZ - 0.096, FZ - 0.095)      # splash grime at the foot
    box(W, FLASH, a - 0.02, b + 0.02, PARA, PARA + 0.04, FZ - 0.11, FZ + WT + 0.03)
    col('solid', a, b, PATH, PARA, FZ - 0.08, FZ + WT)
box(W, FLASH, X0, X1, PARA, PARA + 0.035, FZ - 0.05, FZ + WT + 0.03)     # parapet capping
wedge(W, RENDER, X0, X0 + WT, FZ, BZ, PATH - 0.02, ROOF_F, ROOF_B); col('solid', X0, X0 + WT, PATH, ROOF_F, FZ, BZ)
wedge(W, RENDER, X1 - WT, X1, FZ, BZ, PATH - 0.02, ROOF_F, ROOF_B); col('solid', X1 - WT, X1, PATH, ROOF_F, FZ, BZ)
box(W, RENDER, X0, X1, PATH - 0.02, ROOF_B, BZ - WT, BZ); col('solid', X0, X1, PATH, ROOF_B, BZ - WT, BZ)
for x in PIERS[1:-1]:
    box(W, PAINT_IN, x - 0.1, x + 0.1, PATH, CEIL_Y + 0.05, FZ + WT, BZ - WT); col('solid', x - 0.1, x + 0.1, PATH, CEIL_Y, FZ + WT, BZ - WT)
for x in (X0 - 0.016, X1 + 0.016):                    # rising damp and run-off stains on the end and back walls
    for _ in range(7):
        z = rng.uniform(-69.5, -60.5); h = rng.uniform(0.6, 2.2)
        quad(W, GRIME, [(x, ROOF_F - 0.3, z - 0.04), (x, ROOF_F - 0.3, z + 0.04), (x, ROOF_F - 0.3 - h, z + 0.02), (x, ROOF_F - 0.3 - h, z - 0.02)])
for _ in range(16):
    x = rng.uniform(12.5, 45.5); h = rng.uniform(0.5, 1.9)
    quad(W, GRIME, [(x - 0.05, ROOF_B - 0.1, BZ + 0.016), (x + 0.05, ROOF_B - 0.1, BZ + 0.016), (x + 0.02, ROOF_B - 0.1 - h, BZ + 0.016), (x - 0.02, ROOF_B - 0.1 - h, BZ + 0.016)])

# main roof: corrugated zincalume over the whole row, falling to a box gutter at the back
corrugated('Roof', ROOF, X0 - 0.1, X1 + 0.1, FZ + 0.05, ROOF_F, BZ + 0.35, ROOF_B - 0.04)
box(W, GUTTER, X0 - 0.1, X1 + 0.1, ROOF_B - 0.2, ROOF_B - 0.02, BZ + 0.33, BZ + 0.5)
for x in (X0 - 0.12, X1 + 0.12): box(W, FLASH, x - 0.03, x + 0.03, ROOF_B - 0.05, ROOF_F + 0.06, FZ, BZ + 0.35)
for x in (14.5, 29.0, 43.5):                          # downpipes down the back wall into pits
    box(W, GUTTER, x - 0.05, x + 0.05, PATH, ROOF_B - 0.18, BZ + 0.36, BZ + 0.44)
    for y in (4.2, 5.2, 6.2): box(W, GALV, x - 0.06, x + 0.06, y, y + 0.03, BZ + 0.34, BZ + 0.45)
    box(W, CONC, x - 0.2, x + 0.2, 3.0, 3.3, BZ + 0.25, BZ + 0.65)
for i, x in enumerate((17.0, 26.0, 33.0, 41.5)):      # roof dressing: whirlybirds and solar
    y = ROOF_F + (ROOF_B - ROOF_F) * 0.7
    cyl('Roof', GALV, (x, y - 0.1, -67.0 + 0.7 * 9.6), (x, y + 0.22, -67.0 + 0.7 * 9.6), 0.13, 12)
    blob('Roof', GALV, (x, y + 0.3, -67.0 + 0.7 * 9.6), (0.2, 0.16, 0.2), ICO1)
for i in range(8):
    x = 14.5 + 1.08 * i; z0, z1 = -68.8, -66.9
    yz = lambda z: ROOF_F + (ROOF_B - ROOF_F) * (z - FZ) / (BZ - FZ) + 0.1
    add('Roof', SOLAR, [(x, yz(z0), z0), (x + 1.0, yz(z0), z0), (x + 1.0, yz(z1), z1), (x, yz(z1), z1),
                        (x, yz(z0) + 0.04, z0), (x + 1.0, yz(z0) + 0.04, z0), (x + 1.0, yz(z1) + 0.04, z1), (x, yz(z1) + 0.04, z1)], HEX)
cyl('Roof', STAINLESS, (21.5, 6.9, -63.0), (21.5, 8.1, -63.0), 0.09, 10); blob('Roof', STAINLESS, (21.5, 8.15, -63.0), (0.16, 0.06, 0.16), ICO1)

# back of house: steel doors, condensers, bins, meter box
for s in SHOPS:
    xc = s['x0'] + 1.3
    box(W, DOOR, xc - 0.45, xc + 0.45, PATH, PATH + 2.1, BZ, BZ + 0.05); box(W, STAINLESS, xc + 0.28, xc + 0.38, PATH + 1.0, PATH + 1.04, BZ + 0.05, BZ + 0.09)
    box(W, CONC, xc - 0.7, xc + 0.7, 3.0, PATH, BZ, BZ + 1.2)
for x in (24.8, 40.2):
    box(W, CONDENSER, x - 0.45, x + 0.45, 3.45, 4.2, BZ + 0.05, BZ + 0.4); cyl(W, BLACK, (x - 0.08, 3.83, BZ + 0.405), (x - 0.08, 3.83, BZ + 0.41), 0.26, 16)
    box(W, CONC, x - 0.55, x + 0.55, 3.0, 3.45, BZ + 0.02, BZ + 0.5); col('solid', x - 0.55, x + 0.55, 3.0, 4.2, BZ, BZ + 0.5)
for i, x in enumerate((13.2, 13.95, 18.3, 34.6, 35.35)):
    box(W, BIN_GREEN, x - 0.3, x + 0.3, 3.2, 4.15, BZ + 0.2, BZ + 0.9); box(W, (LID_RED, LID_YEL)[i % 2], x - 0.32, x + 0.32, 4.15, 4.2, BZ + 0.15, BZ + 0.92)
    for dx in (-0.25, 0.25): cyl(W, BLACK, (x + dx - 0.04, 3.3, BZ + 0.3), (x + dx + 0.04, 3.3, BZ + 0.3), 0.1, 10)
    col('solid', x - 0.32, x + 0.32, 3.2, 4.2, BZ, BZ + 0.92)
box(W, GALV, X1, X1 + 0.12, 4.3, 5.3, -64.2, -63.4); box(W, GRIME, X1 + 0.135, X1 + 0.136, 3.4, 4.3, -63.95, -63.65)

# ---- 4. verandah ------------------------------------------------------------------------------------------------
H = 'H'
corrugated('Roof', VROOF, X0 - 0.1, X1 + 0.1, FZ, VY0, VZ1, VY1)
box(H, FLASH, X0 - 0.1, X1 + 0.1, VY0 - 0.02, VY0 + 0.12, FZ - 0.04, FZ - 0.01)
yl = lambda z: VY0 - 0.14 + (VY1 - VY0) * (z - FZ) / (VZ1 - FZ)
x = X0
while x < X1:                                          # timber lining boards under the verandah
    w = 0.14; m = LINING if rng.random() < 0.6 else LINING2
    quad(H, m, [(x, yl(FZ), FZ - 0.01), (x + w - 0.004, yl(FZ), FZ - 0.01), (x + w - 0.004, yl(VZ1 + 0.3), VZ1 + 0.3), (x, yl(VZ1 + 0.3), VZ1 + 0.3)])
    x += w
POSTS = [12.2, 16.0, 19.8, 23.6, 27.4, 31.2, 35.0, 38.8, 42.9, 45.8]
box(H, STEEL, X0 - 0.1, X1 + 0.1, VY1 - 0.2, VY1 - 0.02, -74.2, -74.05)          # front beam (C section)
box(H, STEEL, X0 - 0.1, X1 + 0.1, VY1 - 0.2, VY1 - 0.18, -74.05, -73.98)
for x in POSTS:
    box(H, STEEL, x - 0.05, x + 0.05, PATH, VY1 - 0.2, -74.175, -74.075); box(H, GALV, x - 0.13, x + 0.13, PATH, PATH + 0.012, -74.25, -74.0)
    for dx, dz in ((-0.09, -0.21), (0.09, -0.21), (-0.09, -0.04), (0.09, -0.04)): cyl(H, GALV, (x + dx, PATH, -74.0 + dz - 0.04), (x + dx, PATH + 0.035, -74.0 + dz - 0.04), 0.012, 6)
    quad(H, RUST, [(x - 0.03, VY1 - 0.21, -74.177), (x + 0.02, VY1 - 0.21, -74.177), (x + 0.005, VY1 - 0.21 - rng.uniform(0.3, 0.9), -74.177), (x - 0.015, VY1 - 0.5, -74.177)])
    col('solid', x - 0.06, x + 0.06, PATH, VY1 - 0.2, -74.18, -74.07)
box(H, GUTTER, X0 - 0.1, X1 + 0.1, VY1 - 0.2, VY1 - 0.18, VZ1 - 0.16, VZ1)      # quad gutter: sole, back and bead
box(H, GUTTER, X0 - 0.1, X1 + 0.1, VY1 - 0.2, VY1 - 0.04, VZ1 - 0.16, VZ1 - 0.145)
cyl(H, GUTTER, (X0 - 0.1, VY1 - 0.04, VZ1 - 0.155), (X1 + 0.1, VY1 - 0.04, VZ1 - 0.155), 0.014, 8)
for x in (X0 - 0.1, X1 + 0.1): box(H, GUTTER, x - 0.005, x + 0.005, VY1 - 0.2, VY1 - 0.04, VZ1 - 0.16, VZ1)
for x in (12.42, 27.62, 45.58):                        # downpipes strapped to the posts
    box(H, GUTTER, x - 0.05, x + 0.05, PATH + 0.12, VY1 - 0.2, -74.33, -74.25)
    box(H, GUTTER, x - 0.05, x + 0.05, PATH + 0.02, PATH + 0.12, -74.45, -74.25)
    for y in (4.2, 5.2): box(H, GALV, x - 0.1, x + 0.06, y, y + 0.025, -74.34, -74.1)
    quad(H, RUST, [(x - 0.05, VY1 - 0.04, VZ1 - 0.165), (x + 0.05, VY1 - 0.04, VZ1 - 0.165), (x + 0.03, VY1 - 0.19, VZ1 - 0.165), (x - 0.03, VY1 - 0.19, VZ1 - 0.165)])
for s in SHOPS:                                        # batten lights under the verandah
    for f in (0.3, 0.7):
        x = s['x0'] + (s['x1'] - s['x0']) * f; z = -72.3
        box(H, MDF, x - 0.62, x + 0.62, yl(z) - 0.07, yl(z) - 0.01, z - 0.06, z + 0.06); box(H, TUBE, x - 0.58, x + 0.58, yl(z) - 0.075, yl(z) - 0.07, z - 0.035, z + 0.035)

# ---- 5. shopfronts and signs ------------------------------------------------------------------------------------
G, T = 'G', 'T'
def glazing(x0, x1, y0=3.88, y1=5.74, z=FZ + 0.06):
    n = max(1, math.ceil((x1 - x0) / 1.7))
    box(G, GLASS, x0, x1, y0, y1, z - 0.006, z + 0.006)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n; box(W, FRAME, x - 0.03, x + 0.03, y0 - 0.03, y1 + 0.03, z - 0.05, z + 0.07)
    box(W, FRAME, x0, x1, y0 - 0.04, y0, z - 0.05, z + 0.07); box(W, FRAME, x0, x1, y1, y1 + 0.06, z - 0.05, z + 0.07)
def door_leaf(p, u, w=0.86, h=2.25, glass=True):
    """A glazed aluminium door leaf from hinge point p, width w along unit vector u (horizontal)."""
    p, u = Vector(p), Vector(u); n = Vector((u.z, 0, -u.x)); c = p + u * (w / 2) + Vector((0, h / 2, 0))
    obox(W, FRAME, c + Vector((0, h / 2 - 0.06, 0)), u * (w / 2), Vector((0, 0.06, 0)), n * 0.025)
    obox(W, FRAME, c - Vector((0, h / 2 - 0.12, 0)), u * (w / 2), Vector((0, 0.12, 0)), n * 0.025)
    for s in (-1, 1): obox(W, FRAME, c + u * s * (w / 2 - 0.05), u * 0.05, Vector((0, h / 2, 0)), n * 0.025)
    obox(G, GLASS, c + Vector((0, 0.06, 0)), u * (w / 2 - 0.1), Vector((0, h / 2 - 0.18, 0)), n * 0.006)
    obox(W, STAINLESS, c + u * (w / 2 - 0.16) + Vector((0, -0.1, 0)) + n * 0.06, u * 0.015, Vector((0, 0.5, 0)), n * 0.015)
for s in SHOPS:
    x0, x1 = s['x0'] + (0.45 if s['x0'] == X0 else 0.225), s['x1'] - (0.45 if s['x1'] == X1 else 0.225)
    d0, d1 = s['door']; k = s['key']; tile = TILE[k]
    for a, b in ((x0, d0), (d1, x1)):
        box(W, tile, a, b, PATH - 0.02, 3.85, FZ, FZ + 0.2)                        # tiled stallriser
        box(W, CONC_KERB, a, b, 3.85, 3.88, FZ - 0.04, FZ + 0.2)
        glazing(a + 0.03, b - 0.03)
        col('solid', a, b, PATH, PARA, FZ - 0.04, FZ + WT)
    for x in (d0, d1): box(W, FRAME, x - 0.04, x + 0.04, PATH, 5.74, FZ - 0.05, FZ + 0.2)
    box(W, FRAME, x0, x1, 5.74, 5.82, FZ - 0.05, FZ + 0.12)                     # transom and highlight glazing
    box(G, GLASS, x0, x1, 5.82, 6.12, FZ + 0.054, FZ + 0.066); box(W, FRAME, x0, x1, 6.12, 6.2, FZ - 0.05, FZ + 0.12)
    for i in range(1, 5): xm = x0 + (x1 - x0) * i / 5; box(W, FRAME, xm - 0.02, xm + 0.02, 5.82, 6.12, FZ + 0.03, FZ + 0.09)
    box(W, RENDER, x0, x1, 6.2, PARA, FZ, FZ + WT)                               # wall above
    box(W, STAINLESS, d0, d1, PATH - 0.005, PATH + 0.008, FZ - 0.06, FZ + 0.26)   # threshold plate
    if s['open']:
        door_leaf((d0 + 0.05, PATH + 0.01, FZ + 0.22), (0, 0, 1)); door_leaf((d1 - 0.05, PATH + 0.01, FZ + 0.22), (0, 0, 1))
        col('solid', x0, x1, 5.74, PARA, FZ - 0.04, FZ + WT)                     # the lintel over the gap
        box(W, CHALK, d1 + 0.12, d1 + 0.5, 4.9, 5.2, FZ + 0.08, FZ + 0.085)       # OPEN sign behind the glass
        text(T, 'OPEN', (d1 + 0.31, 5.05, FZ + 0.074), 0.09, ORANGE, 'S')
    else:
        door_leaf((d0 + 0.04, PATH + 0.01, FZ + 0.06), (1, 0, 0), (d1 - d0) / 2 - 0.04)
        door_leaf((d1 - 0.04, PATH + 0.01, FZ + 0.06), (-1, 0, 0), (d1 - d0) / 2 - 0.04)
        col('solid', d0, d1, PATH, PARA, FZ - 0.04, FZ + WT)
        box(W, WHITE, d1 - 0.62, d1 - 0.3, 4.2, 4.5, FZ + 0.035, FZ + 0.04)      # trading-hours sticker
        text(T, 'CLOSED', (d1 - 0.46, 4.42, FZ + 0.03), 0.045, NAVY, 'S'); text(T, 'BACK 9AM', (d1 - 0.46, 4.3, FZ + 0.03), 0.04, NAVY, 'S')
    # the parapet sign board, with a painted border and a small emblem
    a, b = x0 + 0.25, x1 - 0.25
    box(W, s['board'], a, b, 6.52, 7.34, FZ - 0.09, FZ - 0.01)
    for y0_, y1_ in ((6.52, 6.56), (7.30, 7.34)): box(W, s['accent'], a, b, y0_, y1_, FZ - 0.095, FZ - 0.089)
    title = s['name']; tag = title.startswith('JOEY ISLAND ') or k == 'store'
    main = title[len('JOEY ISLAND '):] if title.startswith('JOEY ISLAND ') else title
    size = min(0.54, (b - a - 1.2) / (0.78 * len(main)))
    text(T, main, ((a + b) / 2 - 0.2, 6.84 if tag else 6.92, FZ - 0.1), size, s['ink'], 'S', FONT_SIGN, 0.012)
    if tag: text(T, 'JOEY ISLAND', ((a + b) / 2 - 0.2, 7.15, FZ - 0.1), 0.19, s['ink'], 'S', FONT_SIGN, 0.008)
    if k == 'tackle':                                  # a leaping fish emblem at the left-hand end (seen from the car park)
        cx = b - 0.45
        add(W, ORANGE, [(cx + 0.28, 6.95, FZ - 0.097), (cx + 0.05, 7.12, FZ - 0.097), (cx - 0.2, 7.02, FZ - 0.097), (cx - 0.28, 6.88, FZ - 0.097),
                        (cx - 0.05, 6.8, FZ - 0.097), (cx + 0.18, 6.86, FZ - 0.097)], [(0, 1, 2, 3, 4, 5)])
        add(W, ORANGE, [(cx - 0.26, 6.93, FZ - 0.097), (cx - 0.42, 7.07, FZ - 0.097), (cx - 0.4, 6.75, FZ - 0.097)], [(0, 1, 2)])
    elif k == 'gifts':
        blob(W, TEAL, (b - 0.45, 6.93, FZ - 0.1), (0.2, 0.2, 0.01), ICO1)
        blob(W, s['board'], (b - 0.45, 6.93, FZ - 0.108), (0.14, 0.14, 0.01), ICO1)
    # rust run-off from the capping over the sign
    for _ in range(3):
        xr = rng.uniform(a + 0.2, b - 0.2); quad(W, GRIME, [(xr - 0.03, 7.34, FZ - 0.097), (xr + 0.03, 7.34, FZ - 0.097), (xr + 0.01, 7.34 - rng.uniform(0.1, 0.35), FZ - 0.097), (xr - 0.01, 7.34 - 0.1, FZ - 0.097)])
    # the under-verandah hanging sign, double-sided, on two rods from the lining
    hx = (d0 + d1) / 2 + (1.9 if k != 'gifts' else -1.8); hz0, hz1 = -73.25, -71.75
    for z in (hz0 + 0.1, hz1 - 0.1): cyl(H, GALV, (hx, 5.64, z), (hx, yl(z), z), 0.008, 5)
    box(H, s['board'], hx - 0.03, hx + 0.03, 5.28, 5.64, hz0, hz1)
    for face, xo in (('+X', 0.034), ('-X', -0.034)):
        text(T, s['hang'], (hx + xo, 5.46, (hz0 + hz1) / 2), min(0.13, 1.3 / (0.6 * len(s['hang']))), s['ink'], face)
    # window decals: a band of lettering on the glass
    dec = {'tackle': 'LIVE BAIT  RODS  REELS', 'gifts': 'POSTCARDS  PLUSH  HONEY', 'cafe': 'COFFEE  CAKE  TOASTIES', 'store': 'BREAD  MILK  PAPERS'}[k]
    n_ = max(1, math.ceil((d0 - x0 - 0.06) / 1.7)); pw = (d0 - x0 - 0.06) / n_      # fits the pane nearest the door
    text(T, dec, (d0 - 0.03 - pw / 2, 5.5, FZ + 0.045), min(0.08, (pw - 0.25) / (0.62 * len(dec))), WHITE, 'S')
station('Shopfront', (29.0, PATH, FZ))

# ---- 6. footpath furniture ---------------------------------------------------------------------------------------
F = 'F'
def bench(x0, z):
    for x in (x0 + 0.15, x0 + 1.65):
        box(F, STEEL, x - 0.03, x + 0.03, PATH, PATH + 0.43, z - 0.02, z + 0.02); box(F, STEEL, x - 0.03, x + 0.03, PATH, PATH + 0.43, z - 0.42, z - 0.38)
        box(F, STEEL, x - 0.03, x + 0.03, PATH + 0.4, PATH + 0.43, z - 0.42, z + 0.02); box(F, STEEL, x - 0.03, x + 0.03, PATH + 0.43, PATH + 0.85, z + 0.0, z + 0.04)
    for i in range(4): box(F, BENCH_T, x0, x0 + 1.8, PATH + 0.43, PATH + 0.47, z - 0.42 + 0.105 * i, z - 0.42 + 0.105 * i + 0.09)
    for i in range(3): box(F, BENCH_T, x0, x0 + 1.8, PATH + 0.55 + 0.1 * i, PATH + 0.63 + 0.1 * i, z + 0.04, z + 0.07)
    col('solid', x0, x0 + 1.8, PATH, PATH + 0.85, z - 0.44, z + 0.08)
bench(43.4, FZ - 0.5); bench(34.3, FZ - 0.5)
def slat_bin(x, z):
    for k in range(16):
        a = k * math.tau / 16; box(F, BIN_T, x + 0.3 * math.cos(a) - 0.04, x + 0.3 * math.cos(a) + 0.04, PATH, PATH + 0.9, z + 0.3 * math.sin(a) - 0.04, z + 0.3 * math.sin(a) + 0.04)
    cyl(F, GALV, (x, PATH + 0.9, z), (x, PATH + 0.96, z), 0.33, 16); blob(F, GALV, (x, PATH + 0.96, z), (0.33, 0.05, 0.33), ICO1)
    cyl(F, BLACK, (x, PATH + 0.5, z), (x, PATH + 0.88, z), 0.27, 12)
    col('solid', x - 0.34, x + 0.34, PATH, PATH + 1.0, z - 0.34, z + 0.34)
slat_bin(37.0, -71.0)
def a_frame(x, z, lines, board=CHALK, ink=WHITE):
    t = 0.2
    for s in (1, -1):
        c = Vector((x, PATH + 0.47, z + s * 0.19))
        obox(F, TIMBER, c, (0.33, 0, 0), (0, 0.46 * math.cos(t), -s * 0.46 * math.sin(t)), (0, s * 0.015 * math.sin(t), s * 0.015 * math.cos(t)))
        obox(F, board, c + Vector((0, 0.02, s * 0.018)), (0.28, 0, 0), (0, 0.4 * math.cos(t), -s * 0.4 * math.sin(t)), (0, s * 0.004, s * 0.004))
    for i, (ln, sz, m) in enumerate(lines):
        y = PATH + 0.75 - 0.15 * i; zz = z - 0.19 - 0.026 + (y - PATH - 0.47) * math.tan(t)
        text(T, ln, (x, y, zz), sz, m, 'S', FONT, 0.003, t)
    col('solid', x - 0.34, x + 0.34, PATH, PATH + 0.95, z - 0.3, z + 0.3)
a_frame(39.2, -72.6, [('LIVE BAIT', 0.075, ORANGE), ('PILCHARDS', 0.058, WHITE), ('SQUID  PRAWNS', 0.052, WHITE), ('ICE $4', 0.07, YELLOW)])
a_frame(30.6, -72.6, [('SOUVENIRS', 0.058, TEAL), ('POSTCARDS', 0.056, NAVY), ('MAGNETS', 0.058, NAVY), ('PLUSH JOEYS', 0.052, ORANGE)], CREAM, NAVY)
a_frame(26.4, -72.6, [('COFFEE', 0.08, WHITE), ('& CAKE', 0.07, YELLOW), ('TOASTIES', 0.058, WHITE), ('OPEN 7-2', 0.052, WHITE)])
def cafe_table(x, z):
    cyl(F, GALV, (x, PATH, z), (x, PATH + 0.02, z), 0.25, 12); cyl(F, STEEL, (x, PATH, z), (x, PATH + 0.72, z), 0.03, 8)
    cyl(F, TIMBER, (x, PATH + 0.72, z), (x, PATH + 0.75, z), 0.36, 16)
    for dx in (-0.62, 0.62):
        sx = x + dx; sgn = 1 if dx > 0 else -1
        for lx, lz in ((-0.18, -0.18), (0.18, -0.18), (-0.18, 0.18), (0.18, 0.18)): cyl(F, GALV, (sx + lx, PATH, z + lz), (sx + lx, PATH + 0.45, z + lz), 0.012, 6)
        box(F, BENCH_T, sx - 0.21, sx + 0.21, PATH + 0.45, PATH + 0.48, z - 0.21, z + 0.21)
        box(F, BENCH_T, sx + sgn * 0.19, sx + sgn * 0.22, PATH + 0.48, PATH + 0.85, z - 0.2, z + 0.2)
    col('solid', x - 0.9, x + 0.9, PATH, PATH + 0.85, z - 0.36, z + 0.36)
cafe_table(21.9, -71.0); cafe_table(27.0, -71.0)
box(F, FREEZER, 12.9, 14.5, PATH, PATH + 1.05, FZ - 0.78, FZ - 0.08); box(F, GALV, 12.88, 14.52, PATH + 1.05, PATH + 1.1, FZ - 0.8, FZ - 0.06)
box(F, NAVY, 13.1, 14.3, PATH + 0.55, PATH + 0.95, FZ - 0.785, FZ - 0.78); text(T, 'ICE', (13.7, PATH + 0.75, FZ - 0.79), 0.26, WHITE, 'S')
col('solid', 12.9, 14.5, PATH, PATH + 1.1, FZ - 0.8, FZ)
for i, x in enumerate((17.9, 18.4, 18.9)):              # gas swap cage
    cyl(F, GAS, (x, PATH, FZ - 0.4), (x, PATH + 0.8, FZ - 0.4), 0.16, 12); blob(F, GAS, (x, PATH + 0.8, FZ - 0.4), (0.16, 0.08, 0.16), ICO1)
    cyl(F, GALV, (x, PATH + 0.86, FZ - 0.4), (x, PATH + 0.95, FZ - 0.4), 0.03, 6)
for x in (17.6, 19.2):
    for z in (FZ - 0.72, FZ - 0.08): box(F, GALV, x - 0.02, x + 0.02, PATH, PATH + 1.15, z - 0.02, z + 0.02)
for y in (PATH + 0.1, PATH + 0.6, PATH + 1.13):
    box(F, GALV, 17.6, 19.2, y, y + 0.02, FZ - 0.74, FZ - 0.7); box(F, GALV, 17.58, 17.62, y, y + 0.02, FZ - 0.74, FZ - 0.06); box(F, GALV, 19.18, 19.22, y, y + 0.02, FZ - 0.74, FZ - 0.06)
for i in range(9): box(F, GALV, 17.6 + 0.2 * i - 0.006, 17.6 + 0.2 * i + 0.006, PATH, PATH + 1.15, FZ - 0.73, FZ - 0.71)
col('solid', 17.55, 19.25, PATH, PATH + 1.15, FZ - 0.75, FZ)
for x in (28.9, 36.6):                                  # potted plants either side of the gift shop
    if x > 36: continue
    cyl(F, POT, (x, PATH, FZ - 0.4), (x, PATH + 0.5, FZ - 0.4), 0.2, 12, 0.27)
    for _ in range(6): rng.uniform(0, 1); rng.uniform(0, 1); rng.uniform(0, 1)      # keep the later random draws where they were
    lomandra(x, FZ - 0.4, 0.5, PATH + 0.47)
    col('solid', x - 0.28, x + 0.28, PATH, PATH + 1.0, FZ - 0.68, FZ - 0.12)
for i in range(3):                                      # bike hoops at the east end
    x = 45.0 - 0.8 * i; z0, z1 = -73.5, -72.7
    for z in (z0, z1): box(F, GALV, x - 0.025, x + 0.025, PATH, PATH + 0.8, z - 0.025, z + 0.025)
    box(F, GALV, x - 0.025, x + 0.025, PATH + 0.78, PATH + 0.83, z0 - 0.025, z1 + 0.025)
    col('solid', x - 0.05, x + 0.05, PATH, PATH + 0.83, z0 - 0.03, z1 + 0.03)

# the raised name panel over the middle of the row, as on a 1960s strip
box(W, RENDER_PIER, 26.2, 30.8, PARA - 0.2, 8.2, FZ - 0.08, FZ + WT); box(W, FLASH, 26.15, 30.85, 8.2, 8.24, FZ - 0.11, FZ + WT + 0.03)
box(W, RENDER, 26.45, 30.55, 7.62, 8.1, FZ - 0.1, FZ - 0.08); text(T, 'EST. 1961', (28.5, 7.86, FZ - 0.105), 0.34, BRICKRED, 'S', FONT_SIGN, 0.01)
# ---- 7. interiors -------------------------------------------------------------------------------------------------
I = 'I'
exec(compile((Path(__file__).parent / 'village_shops.py').read_text(), 'village_shops.py', 'exec'))   # fit-out helpers
for s in SHOPS:
    a, b = s['x0'] + (0.22 if s['x0'] == X0 else 0.1), s['x1'] - (0.22 if s['x1'] == X1 else 0.1)
    box(I, PAINT_IN, a, b, FL, CEIL_Y, BZ - WT - 0.012, BZ - WT)          # inside linings: back wall and end walls
    if s['x0'] == X0: box(I, PAINT_IN, a, a + 0.012, FL, CEIL_Y, FZ + WT, BZ - WT)
    if s['x1'] == X1: box(I, PAINT_IN, b - 0.012, b, FL, CEIL_Y, FZ + WT, BZ - WT)
    box(I, FLOORS.get(s['key'], FLOOR_T), a, b, PATH - 0.05, FL, FZ + 0.05, BZ - WT)
    col('walk', a, b, 3.1, FL, FZ - 0.06, BZ - WT)
    box(I, CEIL, a, b, CEIL_Y, CEIL_Y + 0.03, FZ + WT, BZ - WT)
    for fx in (0.25, 0.5, 0.75):
        for fz in (-67.8, -64.6, -61.8): troffer(a + (b - a) * fx, fz)
def shelving(x0, x1, z0, z1, levels=(3.55, 4.1, 4.65, 5.2), stock=True, face=-1, tall=5.6):
    """A shelving bay (x0..x1 along the wall, z0..z1 deep) with stock on each shelf."""
    box(I, MDF, x0, x1, FL, tall, z0 if face < 0 else z1 - 0.03, z0 + 0.03 if face < 0 else z1)
    for x in (x0, x1): box(I, MDF, x - 0.015, x + 0.015, FL, tall, z0, z1)
    for y in levels:
        box(I, MDF, x0, x1, y - 0.025, y, z0, z1)
        if not stock: continue
        x = x0 + 0.04
        while x < x1 - 0.12:
            w = rng.uniform(0.08, 0.22); h = rng.uniform(0.1, 0.34); d = (z1 - z0) * rng.uniform(0.55, 0.85)
            zc = (z0 + z1) / 2; box(I, rng.choice(PROD), x, min(x + w, x1 - 0.04), y, y + h, zc - d / 2, zc + d / 2); x += w + rng.uniform(0.01, 0.05)
    col('solid', x0, x1, FL, tall, z0, z1)
fit_tackle()      # Joey Island Tackle & Bait (village_shops.py)
fit_gifts()       # Joey Island Gifts
# Saltbush Cafe (dressing, seen through the glass)
box(I, TIMBER, 20.3, 22.6, FL, 4.4, -63.2, -62.5); box(I, LAMINATE, 20.25, 22.65, 4.4, 4.44, -63.25, -62.45)
box(I, COFFEE, 21.0, 21.7, 4.44, 4.95, -62.9, -62.5); box(I, GLASS, 20.4, 21.0, 4.44, 4.8, -63.2, -62.6); box(I, FRIDGE_GLOW, 20.42, 20.98, 4.46, 4.48, -63.18, -62.62)
box(I, CHALK, 20.8, 23.6, 4.9, 5.8, BZ - WT - 0.03, BZ - WT); text(T, 'MENU', (22.2, 5.62, BZ - WT - 0.035), 0.14, WHITE, 'S')
for i, ln in enumerate(('FLAT WHITE  4.5', 'BIG BREKKIE  19', 'BANANA BREAD  7', 'TOASTIE  11')): text(T, ln, (22.2, 5.42 - 0.15 * i, BZ - WT - 0.035), 0.07, CREAM, 'S')
for tx, tz in ((24.0, -67.8), (26.6, -67.8), (25.3, -65.3)):
    cyl(I, STEEL, (tx, FL, tz), (tx, FL + 0.72, tz), 0.03, 8); cyl(I, TIMBER, (tx, FL + 0.72, tz), (tx, FL + 0.75, tz), 0.35, 14)
    for dz in (-0.55, 0.55): box(I, BENCH_T, tx - 0.2, tx + 0.2, FL + 0.44, FL + 0.47, tz + dz - 0.2, tz + dz + 0.2); box(I, BENCH_T, tx - 0.2, tx + 0.2, FL + 0.47, FL + 0.85, tz + dz + (0.18 if dz > 0 else -0.21), tz + dz + (0.21 if dz > 0 else -0.18))
for px in (22.0, 24.5, 27.0): cyl(I, BLACK, (px, CEIL_Y, -64.0), (px, 5.3, -64.0), 0.005, 4); cyl(I, BLACK, (px, 5.3, -64.0), (px, 5.12, -64.0), 0.03, 12, 0.16); box(I, PANEL, px - 0.1, px + 0.1, 5.11, 5.12, -64.1, -63.9)
# General store (dressing): shelving runs and a drinks fridge
for zz in (-67.0, -64.4):
    shelving(13.4, 18.6, zz, zz + 0.5, levels=(3.6, 4.1, 4.6), tall=4.9)
box(I, FREEZER, 18.9, 19.85, FL, 5.3, -69.3, -65.3); box(I, FRIDGE_GLOW, 18.88, 18.9, 3.5, 5.1, -69.2, -65.4)
for i in range(24): box(I, rng.choice(PROD), 18.92, 19.1, 3.6 + 0.37 * (i % 4), 3.85 + 0.37 * (i % 4), -69.1 + 0.62 * (i // 4), -69.0 + 0.62 * (i // 4))
box(I, TIMBER, 12.4, 13.3, FL, 4.35, -69.4, -67.0); box(I, BLACK, 12.6, 13.0, 4.35, 4.45, -68.6, -68.2)

# ---- 8. stations, export ----------------------------------------------------------------------------------------
station('CarPark', (24.3, PAVE, -88.9)); station('Driveway', (32.5, PAVE, -97.0))
flush()
root = bpy.data.objects.new('JoeyVillage', None); bpy.context.collection.objects.link(root)
tris = 0
for name, objects in list(groups.items()):
    objects = [o for o in objects if o and o.name in bpy.data.objects]
    if not objects: continue
    joined = join_group(f'Village {name}', objects); joined.parent = root
    joined.data.calc_loop_triangles(); tris += len(joined.data.loop_triangles); print('VILLAGE group', name, len(joined.data.loop_triangles))
root.rotation_euler.z = math.pi     # terminal +z (out to sea) becomes glTF +Z, like the terminal
bpy.ops.object.select_all(action='DESELECT')
for obj in [root] + list(root.children_recursive): obj.select_set(True)
bpy.context.view_layer.objects.active = root
(ROOT / 'public/joey').mkdir(parents=True, exist_ok=True)
GLTF = dict(filepath=str(ROOT / 'public/joey/village.glb'), export_format='GLB', use_selection=True, export_apply=True,
            export_yup=True, export_extras=False)
try: bpy.ops.export_scene.gltf(**GLTF, export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True)
except TypeError: bpy.ops.export_scene.gltf(**GLTF, export_colors=True)     # older exporters
out = {'frame': 'Joey terminal local, metres: +z out to sea, +x to the left looking out to sea, +y up (as terminal_colliders.json)',
       'boxes': COLLIDERS, 'stations': STATIONS}
(ROOT / 'public/joey/village_colliders.json').write_text(json.dumps(out, indent=1))
kinds = {}
for c in COLLIDERS: kinds[c['kind']] = kinds.get(c['kind'], 0) + 1
print(f'VILLAGE palette families {sorted(FAMILY)}')
print(f'VILLAGE triangles {tris} colliders {len(COLLIDERS)} {kinds} texts {len(TEXT_STATS)}')
