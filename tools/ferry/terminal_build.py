"""Tidewater ferry terminal, modelled on the Penneshaw (Kangaroo Island) car ferry berth under our own TIDEWATER
FERRIES branding, built procedurally in Blender (Z up, metres, sea level z = 0). Run:
  Blender --background --factory-startup --python tools/ferry/terminal_build.py
Terminal frame: origin = the docked ferry's stern-ramp hinge line projected to sea level, +Y out to sea (the docked
ferry's bow), +X to the right looking out to sea (the ferry's starboard side). The ferry lies stern-to a linkspan
and port side to a long timber jetty (fender face x = -9.5) that runs out past its bow, turns 90 degrees to port
and ends at a lower landing with steps, inside a cove sheltered by a hooked rock breakwater (laid out from the
straight-down aerial reference). The exported root turns 180 deg about Z (like the ferry), so terminal +Y becomes
glTF +Z. Outputs public/ferry/terminal.glb, public/ferry/terminal_colliders.json, assets/ferry/terminal.blend and the
site data the game edits its terrain with, src/ferry/terminalSite.js. The flat is fitted to its site off the south
tip of the island's east headland (the terminal frame sits at world (150, 0, 300), yaw 0: world x = 150 - x,
world z = 300 + y); assets/ferry/site_terrain.json is that island terrain in this frame.
Pivot nodes: LinkspanDeck (shore hinge at (0, QY, HARD), rotate about X), GangwayEnd (shore hinge at
(-11.12, 9.7, 7.0), rotate about Z; +angle swings it toward the sea), BoomGate (rotation about Y: a negative angle
raises the arm), LinkspanBarrier (the red and white boom across the linkspan's land end, authored closed with its
arm level and pointing -x; rotation about Y, a positive angle raises it; the GLB rests it raised 85 deg). Station empties are listed in the collider JSON.
Geometry is accumulated per (group, material) in Python lists and turned into one mesh per key, so thousands of
parts cost no operator calls; groups are joined at export so draw calls stay low. Some blocks (linkspan, stair
tower and walkway, interior) are authored in their own local frame and placed with the XF transform.
"""
import sys, math, random, json
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix, geometry
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rally'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_primitives import material, mesh, join_group, groups
from ferry_kit import pivot

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
rng = random.Random(1907)

# ---- key levels (metres) -----------------------------------------------------------------
BED, HARD, JETTY, WALK = -6.0, 3.2, 3.2, 7.0    # seabed, yard and jetty deck, walkway floor (= ferry DECK2 sill)
FLOOR = 3.35                      # building floor, verandah and forecourt paving
# The linkspan is authored in its own frame (quay hinge line QUAY, sloped deck to LS_Y1, landing plate LS_Y1 to
# PLATE_Y1) and shifted LDY along Y, so in the terminal frame the quay face sits at QY and the plate spans
# y = -8.4 .. -6.6. The ferry's stern ramp is hinged at (0, 0, 2.6), 7.0 m long plus 0.8 m toe flaps, and the
# render (and the game) lowers it DROOP rad: its toe tip reaches y = -7.8 cos(DROOP) = -7.79 and the underside of
# the flap tips sits at 2.6 - 7.8 sin(DROOP) - 0.19 (flap depth under the ramp top) = 2.10, so the plate top is
# LAND = 2.10 and the toe rests on it.
QUAY, LS_Y1, PLATE_Y1, LDY = -26.0, -6.6, -4.8, -2.25
LSX = 1.25                        # the linkspan is widened 1.25 times to take the 10 m ramp
QY = QUAY + LDY                   # -28.25
DROOP = 0.04
LAND = 2.10
SLOPE = (HARD - LAND) / (LS_Y1 - QUAY)     # 5.7 %
def deck_z(y): return HARD - SLOPE * (min(max(y, QUAY), LS_Y1) - QUAY)

# ---- batch geometry kit ------------------------------------------------------------------
BATCH, FLAT = {}, set()
def add(g, mat, verts, faces):
    b = BATCH.setdefault((g, mat.name), [[], [], mat])
    o = len(b[0]); b[0].extend(tuple(v) for v in verts); b[1].extend(tuple(i + o for i in f) for f in faces)

HEX = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
def hexa(g, mat, pts): add(g, mat, pts, HEX)

def box(g, mat, c, s, rz=0.0):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2; cs, sn = math.cos(rz), math.sin(rz)
    hexa(g, mat, [(c[0] + x * cs - y * sn, c[1] + x * sn + y * cs, c[2] + z)
                  for z in (-hz, hz) for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))])

def aabb(g, mat, x0, x1, y0, y1, z0, z1):
    box(g, mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)))

def _frame(d):
    u = d.orthogonal().normalized(); return u, d.cross(u).normalized()

def beam(g, mat, p0, p1, w, h):
    p0, p1 = Vector(p0), Vector(p1); d = (p1 - p0).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6: side = Vector((1, 0, 0))
    side.normalize(); up = side.cross(d).normalized(); a, b = side * (w / 2), up * (h / 2)
    hexa(g, mat, [p0 - a - b, p0 + a - b, p1 + a - b, p1 - a - b, p0 - a + b, p0 + a + b, p1 + a + b, p1 - a + b])

def cyl(g, mat, p0, p1, r, n=16, r1=None):
    p0, p1 = Vector(p0), Vector(p1); u, v = _frame((p1 - p0).normalized()); r1 = r if r1 is None else r1
    ring = [u * math.cos(k * math.tau / n) + v * math.sin(k * math.tau / n) for k in range(n)]
    verts = [p0 + q * r for q in ring] + [p1 + q * r1 for q in ring]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    add(g, mat, verts, faces)

def rail(g, mat, pts, r, n=8):
    for a, b in zip(pts, pts[1:]): cyl(g, mat, a, b, r, n)

def annulus(g, mat, c, axis, r0, r1, depth, n=32):
    c, ax = Vector(c), Vector(axis).normalized(); u, v = _frame(ax); verts = []
    for rr, dd in ((r0, 0), (r1, 0), (r1, depth), (r0, depth)):
        verts += [c + (u * math.cos(k * math.tau / n) + v * math.sin(k * math.tau / n)) * rr + ax * dd for k in range(n)]
    faces = [(q * n + k, q * n + (k + 1) % n, ((q + 1) % 4) * n + (k + 1) % n, ((q + 1) % 4) * n + k) for q in range(4) for k in range(n)]
    add(g, mat, verts, faces)

def loop(g, mat, pts, normal, t, m=4):
    """A closed tube through pts (a chain link, a cage hoop); the cross-section frame uses the loop plane."""
    n, N = len(pts), Vector(normal).normalized(); verts = []
    for k in range(n):
        tang = (pts[(k + 1) % n] - pts[k - 1]).normalized(); b = tang.cross(N).normalized()
        verts += [pts[k] + (N * math.cos(j * math.tau / m + math.pi / 4) + b * math.sin(j * math.tau / m + math.pi / 4)) * t for j in range(m)]
    add(g, mat, verts, [(k * m + j, k * m + (j + 1) % m, ((k + 1) % n) * m + (j + 1) % m, ((k + 1) % n) * m + j) for k in range(n) for j in range(m)])

def chain(g, mat, p0, p1, link=0.2, t=0.024):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length; d.normalize(); u0, u1 = _frame(d)
    n = int(L / (link * 0.74))
    for i in range(n):
        c = p0 + d * ((i + 0.5) * L / n); w = u0 if i % 2 == 0 else u1
        pts = [c + d * (math.cos(k * math.tau / 8) * link * 0.5) + w * (math.sin(k * math.tau / 8) * link * 0.27) for k in range(8)]
        loop(g, mat, pts, d.cross(w), t)

def plate(g, mat, outline, origin, U, V, depth):
    """Extrude a closed (u, v) outline drawn on the plane origin + u U + v V by depth along U x V."""
    o, U, V = Vector(origin), Vector(U), Vector(V); N = U.cross(V).normalized() * depth; n = len(outline)
    base = [o + U * a + V * b for a, b in outline]
    add(g, mat, base + [p + N for p in base],
        [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)])

_bm = bmesh.new(); bmesh.ops.create_icosphere(_bm, subdivisions=1, radius=1.0); _bm.verts.index_update()
ICO_V = [v.co.copy() for v in _bm.verts]; ICO_F = [tuple(v.index for v in f.verts) for f in _bm.faces]; _bm.free()
def boulder(g, mat, c, size, flat=0.6):
    sx, sy, sz = size * rng.uniform(0.85, 1.2) / 2, size * rng.uniform(0.65, 1.0) / 2, size * rng.uniform(flat - 0.15, flat + 0.15) / 2
    rot = Matrix.Rotation(rng.uniform(0, math.tau), 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 3, 'X')
    add(g, mat, [Vector(c) + rot @ Vector((v.x * sx, v.y * sy, v.z * sz)) * rng.uniform(0.8, 1.12) for v in ICO_V], ICO_F)

FONT_BI = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'
FONT_B = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
TEXT_STATS = []
def tidy_glyphs(obj):
    """Weld a converted text's caps to its sides, drop the zero-area slivers the font's collinear points leave, and
    turn every glyph's faces outward. Returns (faces before, faces after, faces turned)."""
    bm = bmesh.new(); bm.from_mesh(obj.data); n0 = len(bm.faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # no dissolve_degenerate: on thin straight strokes it ate the fill triangles (E read as I', L as I, T lost its bar)
    bm.normal_update(); ref = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.normal_update()
    turned = sum(1 for f, n in zip(bm.faces, ref) if f.normal.dot(n) < 0)
    for f in bm.faces: f.smooth = False
    bm.to_mesh(obj.data); bm.free()
    return n0, len(obj.data.polygons), turned
def text(g, body, loc, size, mat, rot, font=FONT_BI, extrude=0.02, spacing=1.0):
    data = bpy.data.curves.new(body[:20], 'FONT'); data.body = body
    data.align_x = 'CENTER'; data.align_y = 'CENTER'; data.size = size; data.extrude = extrude; data.space_character = spacing
    if Path(font).exists(): data.font = bpy.data.fonts.load(font, check_existing=True)
    data.materials.append(mat)
    obj = bpy.data.objects.new(f'Text {body[:20]}', data); bpy.context.collection.objects.link(obj)
    obj.location = loc; obj.rotation_euler = rot
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH'); obj.select_set(False); groups.setdefault(g, []).append(obj)
    TEXT_STATS.append((body, *tidy_glyphs(obj)))
FACE_NEG_X, FACE_POS_Y, FACE_NEG_Y, FACE_POS_X = (math.pi / 2, 0, -math.pi / 2), (math.pi / 2, 0, math.pi), (math.pi / 2, 0, 0), (math.pi / 2, 0, math.pi / 2)

def flush():
    for (g, _), (v, f, m) in BATCH.items():
        if not f: continue
        obj = mesh(f'{g} {m.name}', v, f, m, group=g, smooth=g not in FLAT)
        if g not in FLAT:
            try: obj.data.set_sharp_from_angle(angle=math.radians(35))
            except Exception as err: print('TERMINAL sharp-edges skipped', err)
    BATCH.clear()

COLLIDERS, stations = [], {}
def colbox(kind, x0, x1, y0, y1, z0, z1):
    COLLIDERS.append((kind, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2)))
def station(name, loc):
    e = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(e); e.location = loc
    e.empty_display_size = 0.6; stations[name] = e

# ---- materials ---------------------------------------------------------------------------
OCHRE = material('RenderOchre', (0.8, 0.46, 0.08), 0.0, 0.85)
OCHRE_DARK = material('RenderOchreDark', (0.55, 0.28, 0.06), 0.0, 0.85)
COPING = material('CopingWhite', (0.82, 0.82, 0.79), 0.0, 0.6)
PYLON = material('PylonWhite', (0.86, 0.86, 0.83), 0.0, 0.55)
CONCRETE = material('Concrete', (0.46, 0.46, 0.44), 0.0, 0.9)
PAVING = material('Paving', (0.58, 0.56, 0.52), 0.0, 0.85)
CONC_DARK = material('WetConcrete', (0.24, 0.24, 0.23), 0.0, 0.8)
ALGAE = material('TidalGrowth', (0.035, 0.05, 0.03), 0.0, 0.6)
ASPHALT = material('Asphalt', (0.075, 0.075, 0.08), 0.0, 0.92)
LINE_W = material('RoadWhite', (0.85, 0.85, 0.82), 0.0, 0.6)
LINE_Y = material('RoadYellow', (0.9, 0.66, 0.04), 0.0, 0.6)
TIMBER = material('JettyTimber', (0.34, 0.25, 0.17), 0.0, 0.85)
TIMBER2 = material('JettyTimberGrey', (0.42, 0.36, 0.3), 0.0, 0.9)
TIMBER_DARK = material('TimberDark', (0.16, 0.11, 0.07), 0.0, 0.85)
GALV = material('Galvanised', (0.6, 0.61, 0.62), 0.85, 0.4)
STAINLESS = material('Stainless', (0.75, 0.76, 0.77), 1.0, 0.22)
STEEL = material('PaintedSteel', (0.28, 0.3, 0.32), 0.4, 0.5)
DECKSTEEL = material('LinkspanPlate', (0.13, 0.135, 0.14), 0.3, 0.75)
GRATING = material('StairGrating', (0.3, 0.31, 0.32), 0.6, 0.55)
BLACK = material('BlackPaint', (0.02, 0.02, 0.022), 0.1, 0.5)
RUBBER = material('FenderRubber', (0.03, 0.03, 0.03), 0.0, 0.8)
NAVY = material('LiveryNavy', (0.012, 0.03, 0.09), 0.1, 0.35)
TEAL = material('LiveryTeal', (0.0, 0.42, 0.45), 0.1, 0.35)
SUN = material('LiverySun', (0.95, 0.55, 0.08), 0.05, 0.35)
YELLOW = material('SafetyYellow', (0.9, 0.68, 0.02), 0.0, 0.5)
RED = material('SignalRed', (0.75, 0.04, 0.03), 0.0, 0.45)
WHITE = material('PaintWhite', (0.85, 0.86, 0.85), 0.05, 0.35)
ROOF = material('RoofSheet', (0.78, 0.79, 0.78), 0.3, 0.45)
FRAME = material('WindowFrame', (0.12, 0.13, 0.14), 0.6, 0.4)
GLASS = material('TintedGlass', (0.05, 0.09, 0.11), 0.0, 0.03)
_g = GLASS.node_tree.nodes['Principled BSDF']       # see-through, the same setup as the ferry
_g.inputs['Alpha'].default_value = 0.32
if 'Transmission Weight' in _g.inputs: _g.inputs['Transmission Weight'].default_value = 0.85
_g.inputs['IOR'].default_value = 1.45
if hasattr(GLASS, 'surface_render_method'): GLASS.surface_render_method = 'BLENDED'
if hasattr(GLASS, 'blend_method'): GLASS.blend_method = 'BLEND'
PORTHOLE = material('PortholeGlass', (0.02, 0.035, 0.045), 0.3, 0.08)
ROCKS = [material('RockA', (0.36, 0.33, 0.28), 0, 0.95), material('RockB', (0.26, 0.24, 0.21), 0, 0.95),
         material('RockC', (0.46, 0.42, 0.35), 0, 0.95), material('RockD', (0.4, 0.3, 0.2), 0, 0.95)]
ROCKCORE = material('RockCore', (0.12, 0.115, 0.105), 0, 1.0)
LAMP = material('LampGlow', (1.0, 0.9, 0.72), 0, 0.3, 4.0)
NAV_RED = material('NavLightRed', (1.0, 0.06, 0.03), 0, 0.3, 6.0)
NAV_GREEN = material('NavLightGreen', (0.05, 1.0, 0.25), 0, 0.3, 6.0)
GREEN = material('BeaconGreen', (0.02, 0.35, 0.12), 0, 0.5)
ORANGE = material('LifebuoyOrange', (0.95, 0.28, 0.03), 0.0, 0.45)
TILE = material('FloorTile', (0.6, 0.58, 0.54), 0, 0.35)
TILE2 = material('FloorTileDark', (0.47, 0.45, 0.42), 0, 0.35)
CEILING = material('Ceiling', (0.86, 0.86, 0.84), 0, 0.8)
PANEL_LIGHT = material('CeilingLight', (1.0, 0.97, 0.9), 0, 0.3, 3.0)
LINING = material('WallLining', (0.9, 0.88, 0.84), 0, 0.7)
LAMINATE = material('CounterLaminate', (0.9, 0.89, 0.86), 0, 0.3)
WOOD = material('CounterTimber', (0.45, 0.29, 0.16), 0, 0.45)
SEAT = material('SeatTeal', (0.0, 0.34, 0.37), 0, 0.5)
SCREEN = material('ScreenGlow', (0.35, 0.6, 0.95), 0, 0.2, 1.8)
AMBER = material('BoardAmber', (1.0, 0.62, 0.12), 0, 0.2, 1.3)
BOARD_GREEN = material('BoardGreen', (0.2, 1.0, 0.35), 0, 0.2, 1.2)
BOARD_WHITE = material('BoardWhite', (0.9, 0.93, 1.0), 0, 0.2, 1.1)
MENU = material('MenuBoard', (0.95, 0.6, 0.2), 0, 0.3, 1.2)
FRIDGE = material('FridgeGlow', (0.75, 0.88, 1.0), 0, 0.2, 1.4)
FOLIAGE = material('Foliage', (0.06, 0.2, 0.05), 0, 0.8)
PRODUCTS = [material(f'Product{i}', c, 0, 0.5) for i, c in enumerate(
    [(0.8, 0.1, 0.08), (0.95, 0.7, 0.1), (0.1, 0.35, 0.7), (0.1, 0.55, 0.25), (0.85, 0.85, 0.8), (0.6, 0.2, 0.5)])]

def bollard(g, x, y, z, r=0.17):
    cyl(g, STEEL, (x, y, z), (x, y, z + 0.04), r * 1.7, 16)
    cyl(g, BLACK, (x, y, z + 0.04), (x, y, z + 0.42), r, 16, r * 0.85)
    cyl(g, YELLOW, (x, y, z + 0.42), (x, y, z + 0.52), r * 1.45, 16)

def mast(g, x, y, z, h, heads):
    """A light mast; heads = list of unit (dx, dy) directions for the lantern arms."""
    cyl(g, CONCRETE, (x, y, z - 0.1), (x, y, z + 0.35), 0.35, 16)
    cyl(g, GALV, (x, y, z + 0.35), (x, y, z + h), 0.13, 12, 0.07)
    for dx, dy in heads:
        tip = (x + dx * 1.1, y + dy * 1.1, z + h + 0.25)
        cyl(g, GALV, (x, y, z + h - 0.1), tip, 0.045, 8)
        box(g, STEEL, (tip[0] + dx * 0.3, tip[1] + dy * 0.3, tip[2]), (0.75, 0.34, 0.16), math.atan2(dy, dx))
        box(g, LAMP, (tip[0] + dx * 0.3, tip[1] + dy * 0.3, tip[2] - 0.085), (0.62, 0.26, 0.02), math.atan2(dy, dx))

def logo(g, origin, U, V, s, depth=0.05):
    """Sun-over-waves mark: an orange sun disc with rays, a teal wave and a navy wave in front."""
    o = Vector(origin); N = Vector(U).cross(Vector(V)).normalized()
    plate(g, SUN, [(math.cos(k * math.tau / 32) * 0.42 * s, 0.25 * s + math.sin(k * math.tau / 32) * 0.42 * s) for k in range(32)], o, U, V, depth)
    for k in range(9):
        a = math.pi * (0.08 + 0.84 * k / 8); c, sn, w = math.cos(a), math.sin(a), 0.045 * s
        r0, r1 = 0.52 * s, 0.72 * s
        plate(g, SUN, [(c * r0 - sn * w, 0.25 * s + sn * r0 + c * w), (c * r1 - sn * w * 0.4, 0.25 * s + sn * r1 + c * w * 0.4),
                       (c * r1 + sn * w * 0.4, 0.25 * s + sn * r1 - c * w * 0.4), (c * r0 + sn * w, 0.25 * s + sn * r0 - c * w)], o, U, V, depth)
    for mat, lift, dep in ((TEAL, 0.0, depth * 1.6), (NAVY, -0.26, depth * 2.2)):
        us = [(-1.0 + 2.0 * k / 24) * s for k in range(25)]
        top = [(u, (lift + 0.12 + 0.13 * math.sin(u / s * 3.4 + 0.6)) * s) for u in us]
        bot = [(u, (lift - 0.08 + 0.1 * math.sin(u / s * 3.4 + 0.2)) * s) for u in reversed(us)]
        plate(g, mat, top + bot, o + N * 0.002, U, V, dep)


# ---- placement transform: blocks authored in their own frame are placed with XF ------------------
XF = None     # (a, b, c, d, dx, dy, dz): x' = a x + b y + dx, y' = c x + d y + dy, z' = z + dz
def xfp(p):
    if XF is None: return (p[0], p[1], p[2])
    a, b, c, d, dx, dy, dz = XF
    return (a * p[0] + b * p[1] + dx, c * p[0] + d * p[1] + dy, p[2] + dz)
def add(g, mat, verts, faces):
    b = BATCH.setdefault((g, mat.name), [[], [], mat])
    o = len(b[0]); b[0].extend(xfp(v) for v in verts)
    flip = XF is not None and XF[0] * XF[3] - XF[1] * XF[2] < 0
    b[1].extend(tuple(i + o for i in (f[::-1] if flip else f)) for f in faces)
def colbox(kind, x0, x1, y0, y1, z0, z1):
    p, q = xfp((x0, y0, z0)), xfp((x1, y1, z1))
    COLLIDERS.append((kind, ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2),
                      (abs(q[0] - p[0]) / 2, abs(q[1] - p[1]) / 2, abs(q[2] - p[2]) / 2)))
def station(name, loc):
    e = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(e); e.location = xfp(loc)
    e.empty_display_size = 0.6; stations[name] = e
_text0 = text
def text(g, body, loc, size, mat, rot, font=FONT_BI, extrude=0.02, spacing=1.0):
    if XF is not None:
        a, b, c, d = XF[:4]
        rot = (rot[0], rot[1], -rot[2]) if a * d - b * c < 0 else (rot[0], rot[1], rot[2] + math.atan2(c, a))
    _text0(g, body, xfp(loc), size, mat, rot, font, extrude, spacing)
def quad(g, mat, pts): add(g, mat, pts, [(0, 1, 2, 3)])

def spline(pts, step):
    """Points about every step metres along a Catmull-Rom curve through the (x, y) pts."""
    P = [Vector((x, y, 0.0)) for x, y in pts]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return out + [P[-2]]

# ---- materials added for the Penneshaw layout ----------------------------------------------------
RENDER = material('RenderWhite', (0.84, 0.84, 0.81), 0.0, 0.75)
FASCIA = material('FasciaGrey', (0.32, 0.34, 0.36), 0.3, 0.5)
ZINC = material('RoofZinc', (0.6, 0.61, 0.6), 0.55, 0.42)
SOLAR = material('SolarCell', (0.015, 0.03, 0.085), 0.25, 0.1)
SOLAR_FRAME = material('SolarFrame', (0.72, 0.73, 0.74), 0.9, 0.3)
GROUND = material('SandyGravel', (0.22, 0.19, 0.14), 0.0, 0.95)
GRAVEL = material('CrestGravel', (0.3, 0.27, 0.22), 0.0, 0.95)       # pale crushed limestone
SAND = material('BeachSand', (0.6, 0.55, 0.44), 0.0, 0.9)
GRASS = material('Grass', (0.13, 0.2, 0.07), 0.0, 0.9)
FOAM = material('SurfFoam', (0.88, 0.91, 0.93), 0.0, 0.55)
FOAM2 = material('SurfFoamThin', (0.8, 0.86, 0.88), 0.0, 0.5)
for _m, _a in ((FOAM, 0.82), (FOAM2, 0.38)):
    _m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = _a
    if hasattr(_m, 'surface_render_method'): _m.surface_render_method = 'BLENDED'
    if hasattr(_m, 'blend_method'): _m.blend_method = 'BLEND'
WETROCK = material('WetRock', (0.075, 0.07, 0.065), 0.0, 0.3)
ROCKS = [material('RockGrey', (0.2, 0.195, 0.186), 0, 0.9), material('RockTan', (0.235, 0.212, 0.184), 0, 0.9),
         material('RockPale', (0.285, 0.276, 0.258), 0, 0.9), material('RockDark', (0.122, 0.118, 0.112), 0, 0.9),
         material('RockRust', (0.215, 0.19, 0.162), 0, 0.9)]              # grey-brown granite and dark basalt
TAIL = material('TailLight', (0.6, 0.02, 0.02), 0.0, 0.3)
HEAD = material('HeadLight', (0.9, 0.9, 0.85), 0.2, 0.1)
ROCKCORE = material('RockCore', (0.07, 0.068, 0.062), 0, 1.0)
BWCORE = material('ArmourGaps', (0.14, 0.13, 0.115), 0, 1.0)
STRUCT = material('StructureWhite', (0.8, 0.81, 0.8), 0.25, 0.42)   # tower, walkway and rotunda steel

# Quarried armour stone library. Each shape is the convex hull of points scattered over a rounded box, so it has the
# flat, angled fracture faces of a real quarried block. The hull is split (level 1: each triangle into 4, level 2: into
# 9), the arrises are worn round by a smoothing pass, and the faces get a gentle weathered undulation. Shapes are made
# once and placed thousands of times with their own size, stretch and turn; the 35 degree sharp-edge pass in flush()
# keeps the crisp arrises crisp. STONES_HERO (about 180 triangles) for the dry crest rows seen from the flat, STONES_HI
# (about 80) above the waterline, STONES_LO (a bare hull, about 18) for small spalls and stones mostly under water.
from mathutils import noise as mnoise
def _stone(level, seed):
    r = random.Random(seed); off = Vector((r.uniform(0, 90), r.uniform(0, 90), r.uniform(0, 90))); bm = bmesh.new()
    for sx in (-1, 1):                                   # a block: every corner knocked off by its own fracture facet,
        for sy in (-1, 1):                               # now and then a big broken corner; points on the faces bulge
            for sz in (-1, 1):                           # or split them (random directions gave pebbles or pyramids)
                big = r.random() < 0.25
                for _ in range(r.randint(1, 2)):
                    ch = [r.uniform(0.4, 0.75) if big else r.uniform(0.05, 0.35) for _ in range(3)]
                    bm.verts.new(Vector((sx * (1 - ch[0]), sy * (1 - ch[1]), sz * (1 - ch[2]))))
    for _ in range(r.randint(3, 6)):
        ax = r.randrange(3); v = [r.uniform(-0.7, 0.7) for _ in range(3)]; v[ax] = r.choice((-1, 1)) * r.uniform(0.95, 1.08)
        if level > 1: v[ax] = math.copysign(min(abs(v[ax]), 0.99), v[ax])   # hero: a face point bulges the face, never raises a pyramid on it
        bm.verts.new(Vector(v))
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for v in [v for v in bm.verts if not v.link_faces]: bm.verts.remove(v)
    bmesh.ops.triangulate(bm, faces=bm.faces[:]); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if level:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=level, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        for _ in range(2 if level > 1 else 1):   # wear the arrises: hero stones are rounded off, the rest keep them
            bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.3 if level > 1 else 0.22, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    if level > 1:
        # hero stones: a broken, craggy silhouette. Multi-octave noise (lumps, then knobs) plus ridged noise (fracture
        # ledges and pits) pushed along the normal, so the big faces are no longer flat planes.
        for v in bm.verts:
            ridge = 1.0 - abs(mnoise.noise(v.co * 3.1 + off * 0.7))
            v.co += v.normal * (0.075 * mnoise.noise(v.co * 1.4 + off) + 0.04 * mnoise.noise(v.co * 2.9 - off)
                                + 0.03 * (ridge * ridge - 0.45) + 0.012 * mnoise.noise(v.co * 6.1 + off) + r.uniform(-0.008, 0.008))
    else:
        for v in bm.verts:
            v.co += v.normal * (0.035 * mnoise.noise(v.co * 2.1 + off) + 0.015 * mnoise.noise(v.co * 5.3 - off) + r.uniform(-0.006, 0.006))
    lo = Vector([min(v.co[k] for v in bm.verts) for k in range(3)]); hi = Vector([max(v.co[k] for v in bm.verts) for k in range(3)])
    c, h = (lo + hi) / 2, (hi - lo) / 2
    bm.verts.index_update(); pts = [Vector(((v.co.x - c.x) / h.x, (v.co.y - c.y) / h.y, (v.co.z - c.z) / h.z)) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
    return pts, faces
STONES_HERO = [_stone(3, 300 + i) for i in range(16)]
STONES_HI = [_stone(1, 500 + i) for i in range(28)]
STONES_LO = [_stone(0, 900 + i) for i in range(14)]
print('TERMINAL stone library triangles hero %d hi %d lo %d' % tuple(sum(len(F) for _, F in L) // len(L) for L in (STONES_HERO, STONES_HI, STONES_LO)))
def armour_rock(g, mat, c, size, flat=0.62, hero=False):
    """A quarried armour stone: a library shape given its own size, stretch and turn."""
    V, F = rng.choice((STONES_HERO if hero else STONES_HI) if size >= 1.2 and c[2] > -0.5 else STONES_LO)      # centre 0.5 m under: mostly submerged
    sx, sy, sz = size * rng.uniform(0.9, 1.25) / 2, size * rng.uniform(0.64, 0.95) / 2, size * rng.uniform(flat - 0.12, flat + 0.12) / 2
    # the stones lie closer to their broad faces (a steep tilt stood a corner up like a pyramid peak)
    rot = (Matrix.Rotation(rng.uniform(0, math.tau), 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.6, 0.6) * 0.6, 3, 'X')
           @ Matrix.Rotation(rng.uniform(-0.6, 0.6) * 0.6, 3, 'Y'))
    # own stream (the shared rng keeps its sequence, so nothing placed after the rocks moves): a wider
    # spread of sizes. A flatter stone stands lower, so the centre comes up by what the smaller tilt took off:
    # the crest keeps its height and every base stays buried in the bank and among its neighbours.
    lr = random.Random(int(c[0] * 977.0) ^ int(c[1] * 131.0) ^ int(c[2] * 17.0))
    k = lr.uniform(0.82, 1.18) if size >= 1.0 else 1.0
    sx, sy, sz = sx * k, sy * k, sz * k * lr.uniform(0.9, 1.05)
    c = (c[0], c[1], c[2] + (sx + sy) * 0.5 * 0.12 * (1.0 if size >= 1.0 else 0.0))
    add(g, mat, [Vector(c) + rot @ Vector((v.x * sx, v.y * sy, v.z * sz)) for v in V], F)

def lamp_post(g, x, y, z, h=5.2, dx=1.0, dy=0.0):
    cyl(g, GALV, (x, y, z), (x, y, z + 0.06), 0.16, 12)
    cyl(g, GALV, (x, y, z + 0.06), (x, y, z + h), 0.065, 10, 0.045)
    tip = (x + dx * 0.55, y + dy * 0.55, z + h + 0.12)
    cyl(g, GALV, (x, y, z + h - 0.05), tip, 0.03, 6)
    box(g, STEEL, (tip[0], tip[1], tip[2] - 0.04), (0.42, 0.24, 0.12), math.atan2(dy, dx))
    box(g, LAMP, (tip[0], tip[1], tip[2] - 0.105), (0.36, 0.18, 0.012), math.atan2(dy, dx))


# ---- 1. the reclaimed flat: ground, seawalls, rock revetments, boat shed, dolphins ----------------
# Seaward edge of the flat (land to the left walking along it, the sea to the right): the back edge from the road
# entry out to the +x corner over the shallow bay, up the +x side, the linkspan notch and the jetty root, across the
# cove side to the north-east corner (the breakwater's root), then back down the -x side, which keeps 9 m clear of
# the toes of the sea stacks at x -100 .. -180. LANDPOLY closes the flat along the headland's shore, where the fill
# meets the natural bank with no revetment.
EDGE = [(-46.0, -110.0), (36.0, -110.0), (36.0, -12.0), (22.0, -14.5), (9.0, -22.0), (7.0, QY), (-17.2, QY),
        (-17.6, -22.0), (-19.4, 12.0), (-20.4, 30.0), (-44.0, 36.0), (-84.0, 40.0), (-87.0, 10.0), (-87.0, -40.0),
        (-88.0, -80.0), (-97.0, -96.0)]
LANDPOLY = EDGE + [(-95.0, -108.0), (-88.0, -117.0), (-70.0, -119.0), (-56.0, -117.0)]     # counter-clockwise; the last
# three points lie on the sand spit and the headland's toe, so no lagoon is left between the flat and the shore
def in_land(x, y, poly=LANDPOLY):
    c = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0): c = not c
    return c
def up_facing(g, mat, pts, z):
    """Fill a simple polygon and keep its faces pointing up whatever the winding."""
    tris = geometry.tessellate_polygon([[Vector((x, y, 0.0)) for x, y in pts]]); faces = []
    for a, b, c in tris:
        (x0, y0), (x1, y1), (x2, y2) = pts[a], pts[b], pts[c]
        faces.append((a, b, c) if (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0 else (c, b, a))
    add(g, mat, [(x, y, z) for x, y in pts], faces)
# the ground sheet itself is built in section 8b, once the yard, road and forecourt paving it is cut out under are known
for (x0, y0), (x1, y1) in zip(EDGE, EDGE[1:]):                      # skirt under the edge, hidden by rock or wall
    quad('Ground', ROCKCORE, [(x0, y0, -3.0), (x1, y1, -3.0), (x1, y1, HARD), (x0, y0, HARD)])
FLAT.update({'Ground', 'Cars'})

def seawall(pts, top=HARD):
    """Vertical concrete seawall along pts (sea to the right), with a cap and a band of tidal growth."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d = Vector((x1 - x0, y1 - y0, 0)).normalized(); n = Vector((d.y, -d.x, 0)); a, b = Vector((x0, y0, 0)), Vector((x1, y1, 0))
        hexa('Harbour', CONC_DARK, [a + Vector((0, 0, zz)) + w for zz in (BED, top - 0.3) for w in (Vector(), d * (b - a).length, d * (b - a).length - n * 1.2, -n * 1.2)])
        hexa('Harbour', CONCRETE, [a + Vector((0, 0, zz)) + w for zz in (top - 0.3, top + 0.1) for w in (n * 0.12, d * (b - a).length + n * 0.12, d * (b - a).length - n * 0.6, -n * 0.6)])
        quad('Harbour', ALGAE, [a + n * 0.02 + Vector((0, 0, -0.8)), b + n * 0.02 + Vector((0, 0, -0.8)), b + n * 0.02 + Vector((0, 0, 0.7)), a + n * 0.02 + Vector((0, 0, 0.7))])
        L = (b - a).length
        for k in range(1, int(L / 3.0) + 1):                          # panel joints
            p = a + d * (k * 3.0)
            box('Harbour', CONC_DARK, p + n * 0.03 + Vector((0, 0, (BED + top - 0.3) / 2)), (0.08, 0.06, top - 0.3 - BED), math.atan2(d.y, d.x))
seawall([(9.0, -22.0), (7.0, QY), (5.3, QY)]); seawall([(-5.3, QY), (-17.2, QY), (-17.6, -22.0), (-19.4, 12.0)])
aabb('Harbour', CONCRETE, -5.3, 5.3, QY - 1.5, QY + 0.1, HARD - 0.9, HARD - 0.32)            # linkspan hinge seat
aabb('Harbour', CONC_DARK, -5.3, 5.3, QY - 1.4, QY, BED, HARD - 0.9)
for x in (-8.0, -14.5, 6.0): bollard('Harbour', x, QY - 0.4, HARD + 0.1)
for x in (-9.5, 5.5):                                                                        # quay ladders
    for dx in (-0.22, 0.22): cyl('Harbour', GALV, (x + dx, QY + 0.14, -1.5), (x + dx, QY + 0.14, HARD + 1.0), 0.025, 8)
    for z in [k * 0.3 - 1.4 for k in range(16)]: cyl('Harbour', GALV, (x - 0.22, QY + 0.14, z), (x + 0.22, QY + 0.14, z), 0.018, 6)

def revet(pts, crest=HARD, rows=6, skip=None):
    """Rock armour along pts (sea to the right): rows of individually turned boulders on a 1 : 1.4 slope."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a = Vector((x0, y0, 0)); d = Vector((x1 - x0, y1 - y0, 0)); L = d.length; d.normalize(); n = Vector((d.y, -d.x, 0))
        run = (crest + 3.0) * 1.4; cz = 1.3 if skip and skip(a + d * (L / 2)) else 0.5      # the core stays under the slipway's top
        quad('Rocks', ROCKCORE, [a + n * run + Vector((0, 0, -3.0)), a + d * L + n * run + Vector((0, 0, -3.0)),
                                a + d * L - n * 0.5 + Vector((0, 0, crest - cz)), a - n * 0.5 + Vector((0, 0, crest - cz))])
        for k in range(int(L / 1.3) + 1):
            for r in range(rows):
                u = k * 1.3 + rng.uniform(-0.45, 0.45); t = -0.6 + r * 1.3 + rng.uniform(-0.35, 0.35)
                p = a + d * u + n * t
                if skip and skip(p): continue
                z = crest - max(0.0, t) / 1.4
                if z < -1.7: continue
                s = rng.uniform(1.2, 2.4)
                armour_rock('Rocks', WETROCK if z < 0.55 else rng.choice(ROCKS), (p.x, p.y, z - s * 0.18), s, hero=t < 2.0)
    for j in range(1, len(pts) - 1):                                  # close the open wedge at each convex corner
        c = Vector((*pts[j], 0)); d0 = (c - Vector((*pts[j - 1], 0))).normalized(); d1 = (Vector((*pts[j + 1], 0)) - c).normalized()
        turn = math.atan2(d0.x * d1.y - d0.y * d1.x, d0.dot(d1))
        if turn <= 0.05: continue
        a0 = math.atan2(-d0.x, d0.y); run = (crest + 3.0) * 1.4; m = max(2, int(turn / 0.25))
        for k in range(m):
            e0 = Vector((math.cos(a0 + turn * k / m), math.sin(a0 + turn * k / m), 0))
            e1 = Vector((math.cos(a0 + turn * (k + 1) / m), math.sin(a0 + turn * (k + 1) / m), 0))
            add('Rocks', ROCKCORE, [c + e0 * run + Vector((0, 0, -3.0)), c + e1 * run + Vector((0, 0, -3.0)), c + Vector((0, 0, crest - 0.5))], [(0, 1, 2)])
        for r in range(1, rows):
            t = -0.6 + r * 1.3; kn = max(1, int(turn * t / 1.3))
            for k in range(kn):
                u = a0 + turn * (k + 0.5) / kn + rng.uniform(-0.1, 0.1); tt = t + rng.uniform(-0.35, 0.35)
                p = c + Vector((math.cos(u), math.sin(u), 0)) * tt
                if skip and skip(p): continue
                z = crest - max(0.0, tt) / 1.4
                if z < -1.7: continue
                s = rng.uniform(1.2, 2.4)
                armour_rock('Rocks', WETROCK if z < 0.55 else rng.choice(ROCKS), (p.x, p.y, z - s * 0.18), s, hero=tt < 2.0)
slip = lambda p: 11.0 < p.x < 18.0 and p.y > -24.0     # keep stones (up to 1.5 m half size) off the slipway and shed door
revet([(-46.0, -110.0), (36.0, -110.0), (36.0, -12.0), (22.0, -14.5), (9.0, -22.0)], skip=slip)
revet([(-19.4, 12.0), (-20.4, 30.0), (-44.0, 36.0), (-84.0, 40.0), (-87.0, 10.0), (-87.0, -40.0), (-88.0, -80.0), (-97.0, -96.0)])

# ---- 2. the hooked rock breakwater: core, thousands of armour boulders, crest track, surf ---------
# The hook springs from the flat's north-east corner and stands in 3.6 to 8.4 m of water on the site (its head
# returns at y 147; at y 197 the water is 15 m deep); its outer toe stays over 60 m from the sea stacks.
BW = [(-80.0, 32.0), (-94.0, 52.0), (-110.0, 80.0), (-118.0, 106.0), (-117.0, 128.0), (-104.0, 144.0), (-84.0, 150.0),
      (-62.0, 147.0)]
BWC = spline(BW, 1.0)
NB = len(BWC); CR, CW, BS = 4.6, 3.0, 1.5         # crest level, half width of the crest, armour slope 1 : BS
def crest(i): return min(CR, HARD - 0.1 + 0.11 * i)
def bw_near(x, y):
    best, bi = 1e18, 0
    for i in range(0, NB, 2):
        p = BWC[i]; d2 = (x - p.x) ** 2 + (y - p.y) ** 2
        if d2 < best: best, bi = d2, i
    return math.sqrt(best), bi
def bw_h(x, y):
    d, i = bw_near(x, y); return crest(i) - max(0.0, d - CW) / BS
xs = [-165.0 + 2.5 * i for i in range(58)]; ys = [2.0 + 2.5 * j for j in range(87)]
hz = [[bw_h(x, y) for x in xs] for y in ys]
cv, cf, idx = [], [], {}
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        if max(hz[j][i], hz[j][i + 1], hz[j + 1][i], hz[j + 1][i + 1]) < -3.5: continue
        ids = []
        for jj, ii in ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)):
            if (jj, ii) not in idx: idx[(jj, ii)] = len(cv); cv.append((xs[ii], ys[jj], max(BED, hz[jj][ii] - 0.42)))
            ids.append(idx[(jj, ii)])
        cf.append(tuple(ids))
add('Breakwater', BWCORE, cv, cf)
def tangent(i): return (BWC[min(i + 1, NB - 1)] - BWC[max(i - 1, 0)]).normalized()
def armour(p, t, i, outer):
    if in_land(p.x, p.y): return                                         # the root runs into the flat's corner
    h = crest(i) - max(0.0, abs(t) - CW) / BS
    if h < -1.9: return
    if abs(t) < 2.4: return
    if abs(t) < 3.4: s = rng.uniform(1.4, 2.1)
    elif outer: s = rng.uniform(2.0, 3.1)
    else: s = rng.uniform(1.9, 2.9)
    armour_rock('Rocks', WETROCK if h < 0.7 else rng.choice(ROCKS), (p.x, p.y, h - s * 0.12), s, 0.64)
acc = 0.0
for i in range(1, NB):
    acc += (BWC[i] - BWC[i - 1]).length
    if acc < 1.55: continue
    acc = 0.0; T = tangent(i); N = Vector((-T.y, T.x, 0)); sh = rng.uniform(0, 1.5)
    for r in range(-9, 10):
        t = r * 1.5 + sh * (1 if r > 0 else -1) * 0.5 + rng.uniform(-0.45, 0.45); p = BWC[i] + N * t + T * rng.uniform(-0.55, 0.55)
        armour(p, t, i, t > 0)
    for sg in (1, -1):                                                   # a looser second layer on both faces
        if rng.random() < 0.5:
            t = sg * rng.uniform(4.0, 11.0); armour(BWC[i] + N * t + T * rng.uniform(-0.8, 0.8), t, i, sg > 0)
    u = rng.uniform(-2.0, 2.0)                                           # a loose spall on the crest track
    armour_rock('Rocks', rng.choice(ROCKS), BWC[i] + N * u + T * rng.uniform(-0.7, 0.7) + Vector((0, 0, crest(i) + 0.33)), rng.uniform(0.16, 0.32), 0.5)
T = tangent(NB - 1); N = Vector((-T.y, T.x, 0)); pe = BWC[-1]                # round head
for r in [2.6 + 1.6 * k for k in range(8)]:
    m = max(3, int(math.pi * r / 1.7))
    for k in range(m + 1):
        a = math.pi * k / m + rng.uniform(-0.08, 0.08); t = r + rng.uniform(-0.4, 0.4)
        armour(pe + (N * math.cos(a) + T * math.sin(a)) * t, t, NB - 1, True)
TRK = [(-2.8, -0.22), (-2.3, -0.07), (-1.15, 0.02), (0.0, 0.06), (1.15, 0.02), (2.3, -0.07), (2.8, -0.22)]
tv, tf, m = [], [], len(TRK)
for i in range(NB):                                                      # gravel crest track: cambered, ragged edges
    T0 = tangent(i); N0 = Vector((-T0.y, T0.x, 0)); z0 = crest(i) + 0.3
    for u, dz in TRK:
        e = 0.0 if abs(u) < 2.5 else 0.3 * math.sin(i * 0.53 + u) + 0.17 * math.sin(i * 1.37 + 2 * u) + rng.uniform(-0.09, 0.09)
        tv.append(BWC[i] + N0 * (u + math.copysign(e, u)) + Vector((0, 0, z0 + dz - 0.12 * abs(e) + rng.uniform(-0.03, 0.03))))
tf = [(i * m + k + 1, i * m + k, (i + 1) * m + k, (i + 1) * m + k + 1) for i in range(NB - 1) for k in range(m - 1)]
add('Breakwater', GRAVEL, tv, tf)
sv, sf = [], []                                                          # a gravel skirt under both ragged edges, down into
for i in range(NB):                                                      # the armour, so no dark gap shows under the track lip
    for k in (0, m - 1): v = tv[i * m + k]; sv += [v, v - Vector((0, 0, 0.75))]
for i in range(NB - 1):
    for s_ in (0, 1):
        a0, b0 = (i * 2 + s_) * 2, ((i + 1) * 2 + s_) * 2
        sf.append((a0, b0, b0 + 1, a0 + 1) if s_ else (b0, a0, a0 + 1, b0 + 1))
add('Breakwater', GRAVEL, sv, sf)
for i in range(0, NB - 1):                                               # edge stones along the track
    T0 = tangent(i); N0 = Vector((-T0.y, T0.x, 0)); z0 = crest(i) + 0.3
    if i % 2 == 0 and i > 12:
        for sgn in (-1, 1): armour_rock('Rocks', rng.choice(ROCKS), BWC[i] + N0 * sgn * rng.uniform(2.3, 2.7) + Vector((0, 0, z0 - 0.12)), rng.uniform(0.7, 1.1), 0.55)
def surf_w(i, a, b): return a + b * (0.55 * math.sin(i * 0.23) + 0.3 * math.sin(i * 0.61 + 1.0) + 0.15 * math.sin(i * 1.37 + 2.0))
for i in range(14, NB - 1):                                              # a continuous surf band on the outer face
    if math.sin(i * 0.11) + 0.6 * math.sin(i * 0.37 + 0.5) < -1.15: continue
    T0, T1 = tangent(i), tangent(i + 1); N0, N1 = Vector((-T0.y, T0.x, 0)), Vector((-T1.y, T1.x, 0))
    tw0, tw1 = CW + crest(i) * BS - 1.4, CW + crest(i + 1) * BS - 1.4
    wa, wb = surf_w(i, 2.6, 1.6), surf_w(i + 1, 2.6, 1.6)
    quad('Surf', FOAM, [BWC[i] + N0 * tw0 + Vector((0, 0, 0.06)), BWC[i] + N0 * (tw0 + wa) + Vector((0, 0, 0.06)),
                        BWC[i + 1] + N1 * (tw1 + wb) + Vector((0, 0, 0.06)), BWC[i + 1] + N1 * tw1 + Vector((0, 0, 0.06))][::-1])
    va, vb = surf_w(i + 40, 3.5, 3.0), surf_w(i + 41, 3.5, 3.0)
    quad('Surf', FOAM2, [BWC[i] + N0 * (tw0 + wa) + Vector((0, 0, 0.05)), BWC[i] + N0 * (tw0 + wa + va) + Vector((0, 0, 0.05)),
                         BWC[i + 1] + N1 * (tw1 + wb + vb) + Vector((0, 0, 0.05)), BWC[i + 1] + N1 * (tw1 + wb) + Vector((0, 0, 0.05))][::-1])
twh = CW + CR * BS - 1.4
for k in range(24):                                                      # round the head
    a0, a1 = math.pi * k / 24, math.pi * (k + 1) / 24
    d0, d1 = N * math.cos(a0) + T * math.sin(a0), N * math.cos(a1) + T * math.sin(a1)
    w0, w1 = surf_w(k * 3, 2.4, 1.2), surf_w(k * 3 + 3, 2.4, 1.2)
    quad('Surf', FOAM, [pe + d0 * twh + Vector((0, 0, 0.06)), pe + d0 * (twh + w0) + Vector((0, 0, 0.06)),
                        pe + d1 * (twh + w1) + Vector((0, 0, 0.06)), pe + d1 * twh + Vector((0, 0, 0.06))][::-1])
for i in range(6, NB - 6, 12):                                           # crest walk and armour solids along the hook
    a, b = BWC[i], BWC[min(i + 12, NB - 1)]
    colbox('walk', min(a.x, b.x) - 2.5, max(a.x, b.x) + 2.5, min(a.y, b.y) - 2.5, max(a.y, b.y) + 2.5, 0.0, crest(i) + 0.3)
hx, hy, hz0 = pe.x + T.x * 1.0, pe.y + T.y * 1.0, CR + 0.3                     # green beacon on the head
cyl('Harbour', CONCRETE, (hx, hy, hz0 - 1.4), (hx, hy, hz0 + 0.7), 1.2, 24)
cyl('Harbour', GREEN, (hx, hy, hz0 + 0.7), (hx, hy, hz0 + 5.2), 0.34, 16, 0.26)
cyl('Harbour', GALV, (hx, hy, hz0 + 5.2), (hx, hy, hz0 + 5.3), 0.55, 20)
rail('Harbour', GALV, [(hx + 0.52 * math.cos(k * math.tau / 12), hy + 0.52 * math.sin(k * math.tau / 12), hz0 + 5.85) for k in range(13)], 0.02)
for k in range(6): cyl('Harbour', GALV, (hx + 0.52 * math.cos(k * math.tau / 6), hy + 0.52 * math.sin(k * math.tau / 6), hz0 + 5.3), (hx + 0.52 * math.cos(k * math.tau / 6), hy + 0.52 * math.sin(k * math.tau / 6), hz0 + 5.85), 0.018, 6)
cyl('Harbour', NAV_GREEN, (hx, hy, hz0 + 5.3), (hx, hy, hz0 + 5.75), 0.16, 16)
cyl('Harbour', BLACK, (hx, hy, hz0 + 5.75), (hx, hy, hz0 + 5.9), 0.2, 16, 0.05)
colbox('solid', hx - 1.2, hx + 1.2, hy - 1.2, hy + 1.2, hz0, hz0 + 5.9)

# ---- boat shed and slipway on the rocky shore east of the ramp ------------------------------------
SX0, SX1, SY0, SY1 = 11.0, 18.0, -30.0, -23.0
aabb('Harbour', CONCRETE, SX0 - 0.3, SX1 + 0.3, SY0 - 0.3, SY1 + 0.3, HARD - 0.2, HARD + 0.12)
SCLAD = material('ShedCladding', (0.5, 0.53, 0.51), 0.3, 0.5)          # grey-green steel sheet
STRIM = material('ShedTrim', (0.12, 0.13, 0.13), 0.3, 0.45)              # flashings, gutters, downpipes
SDOOR = material('RollerDoor', (0.62, 0.64, 0.62), 0.35, 0.45)
for x0, x1, y0, y1 in ((SX0, SX0 + 0.12, SY0, SY1), (SX1 - 0.12, SX1, SY0, SY1), (SX0, SX1, SY0, SY0 + 0.12)):
    aabb('Harbour', SCLAD, x0, x1, y0, y1, HARD + 0.12, HARD + 3.4)
    colbox('solid', x0, x1, y0, y1, HARD, HARD + 3.4)
DX0, DX1, DZ = SX0 + 1.2, SX1 - 1.2, HARD + 3.0                          # the roller door's opening, to the slipway
aabb('Harbour', SCLAD, SX0, DX0, SY1 - 0.12, SY1, HARD + 0.12, HARD + 3.4); aabb('Harbour', SCLAD, DX1, SX1, SY1 - 0.12, SY1, HARD + 0.12, HARD + 3.4)
aabb('Harbour', SCLAD, DX0, DX1, SY1 - 0.12, SY1, DZ, HARD + 3.4)
MD0, MD1 = 15.95, 16.95                                                   # the man door in the south wall, to the yard
for k in range(37):                                                       # corrugated sheet: a rib every 190 mm
    u = SX0 + 0.08 + k * 0.19
    if u < SX1 - 0.05:
        aabb('Harbour', SCLAD, u - 0.022, u + 0.022, SY0 - 0.028, SY0, HARD + (2.3 if MD0 - 0.08 < u < MD1 + 0.08 else 0.14), HARD + 3.38)
        aabb('Harbour', SCLAD, u - 0.022, u + 0.022, SY1, SY1 + 0.028, (DZ + 0.02) if DX0 - 0.05 < u < DX1 + 0.05 else HARD + 0.14, HARD + 3.38)
    v = SY0 + 0.08 + k * 0.19
    if v < SY1 - 0.05:
        for x in (SX0 - 0.028, SX1): aabb('Harbour', SCLAD, x, x + 0.028, v - 0.022, v + 0.022, HARD + 0.14, HARD + 3.38)
for cx, cy in ((SX0, SY0), (SX1, SY0), (SX0, SY1), (SX1, SY1)):             # corner flashings
    aabb('Harbour', STRIM, cx - 0.06, cx + 0.06, cy - 0.06, cy + 0.06, HARD + 0.12, HARD + 3.42)
for x0, x1, y0, y1 in ((SX0 - 0.04, SX1 + 0.04, SY0 - 0.045, SY0 + 0.01), (SX0 - 0.045, SX0 + 0.01, SY0, SY1 + 0.04), (SX1 - 0.01, SX1 + 0.045, SY0, SY1 + 0.04)):
    aabb('Harbour', STRIM, x0, x1, y0, y1, HARD + 0.12, HARD + 0.2)       # base flashing
aabb('Harbour', SDOOR, DX0, DX1, SY1 - 0.2, SY1 - 0.18, HARD + 0.12, DZ)  # roller door curtain, slats and its guides
for k in range(26):
    z = HARD + 0.12 + k * (DZ - HARD - 0.12) / 26
    aabb('Harbour', SDOOR, DX0 + 0.02, DX1 - 0.02, SY1 - 0.18, SY1 - 0.166, z + 0.025, z + 0.085)
for x0, x1 in ((DX0 - 0.1, DX0 + 0.03), (DX1 - 0.03, DX1 + 0.1)): aabb('Harbour', STRIM, x0, x1, SY1 - 0.24, SY1 - 0.12, HARD + 0.12, DZ)
aabb('Harbour', STRIM, DX0, DX1, SY1 - 0.21, SY1 - 0.15, HARD + 0.12, HARD + 0.19)
aabb('Harbour', STRIM, DX0 - 0.12, DX1 + 0.12, SY1 - 0.01, SY1 + 0.05, DZ - 0.02, DZ + 0.08)
box('Harbour', STAINLESS, ((DX0 + DX1) / 2, SY1 - 0.14, HARD + 0.3), (0.2, 0.03, 0.04))
aabb('Harbour', STRIM, MD0 - 0.06, MD1 + 0.06, SY0 - 0.045, SY0, HARD + 0.12, HARD + 2.2)       # man door: frame, leaf, lever, hood
aabb('Harbour', NAVY, MD0, MD1, SY0 - 0.06, SY0 - 0.03, HARD + 0.14, HARD + 2.14)
box('Harbour', STAINLESS, (MD1 - 0.14, SY0 - 0.09, HARD + 1.05), (0.15, 0.025, 0.025))
cyl('Harbour', STAINLESS, (MD1 - 0.08, SY0 - 0.06, HARD + 1.05), (MD1 - 0.08, SY0 - 0.078, HARD + 1.05), 0.03, 10)
aabb('Harbour', STRIM, MD0 - 0.15, MD1 + 0.15, SY0 - 0.4, SY0, HARD + 2.3, HARD + 2.36)
aabb('Harbour', CONCRETE, MD0 - 0.6, MD1 + 0.6, SY0 - 1.5, SY0 - 0.3, HARD, HARD + 0.1)          # aprons
aabb('Harbour', CONCRETE, SX0 - 0.3, 12.8, SY1 + 0.3, -21.2, HARD - 0.2, HARD + 0.1); aabb('Harbour', CONCRETE, 16.2, SX1 + 0.3, SY1 + 0.3, -21.2, HARD - 0.2, HARD + 0.1)
aabb('Harbour', WHITE, 17.22, 17.78, SY0 - 0.042, SY0 - 0.03, HARD + 1.48, HARD + 1.72)
text('Harbour', 'STAFF ONLY', (17.5, SY0 - 0.046, HARD + 1.6), 0.075, RED, FACE_NEG_Y, FONT_B, 0.004)
for sgn in (-1, 1):                                                        # zincalume roof with its ribs
    xa, xb = (SX0 - 0.35, (SX0 + SX1) / 2) if sgn < 0 else ((SX0 + SX1) / 2, SX1 + 0.35)
    za, zb = (HARD + 3.35, HARD + 4.6) if sgn < 0 else (HARD + 4.6, HARD + 3.35)
    hexa('Harbour', ZINC, [(xa, SY0 - 0.35, za), (xb, SY0 - 0.35, zb), (xb, SY1 + 0.35, zb), (xa, SY1 + 0.35, za),
                          (xa, SY0 - 0.35, za + 0.08), (xb, SY0 - 0.35, zb + 0.08), (xb, SY1 + 0.35, zb + 0.08), (xa, SY1 + 0.35, za + 0.08)])
    for k in range(39):
        y = SY0 - 0.25 + k * 0.2
        if y < SY1 + 0.3: beam('Harbour', ZINC, (xa, y, za + 0.1), (xb, y, zb + 0.1), 0.035, 0.03)
    for yb in (SY0 - 0.37, SY1 + 0.37): beam('Harbour', STRIM, (xa, yb, za + 0.02), (xb, yb, zb + 0.02), 0.05, 0.18)     # barge cappings
beam('Harbour', ZINC, ((SX0 + SX1) / 2, SY0 - 0.4, HARD + 4.71), ((SX0 + SX1) / 2, SY1 + 0.4, HARD + 4.71), 0.34, 0.04)   # ridge cap
for xg in (SX0 - 0.47, SX1 + 0.47):                                        # gutters and downpipes
    aabb('Harbour', STRIM, xg - 0.08, xg + 0.08, SY0 - 0.4, SY1 + 0.4, HARD + 3.2, HARD + 3.34)
    xw = SX0 - 0.07 if xg < SX0 else SX1 + 0.07
    for yd in (SY0 + 0.25, SY1 - 0.25):
        rail('Harbour', STRIM, [(xg, yd, HARD + 3.22), (xg, yd, HARD + 3.0), (xw, yd, HARD + 2.75), (xw, yd, HARD + 0.3), (xw + (xg - xw) * 0.3, yd, HARD + 0.14)], 0.045, 10)
for yg in (SY0, SY1 - 0.06):
    plate('Harbour', SCLAD, [(SX0, HARD + 3.4), (SX1, HARD + 3.4), ((SX0 + SX1) / 2, HARD + 4.55)], (0, yg, 0), (1, 0, 0), (0, 0, 1), 0.06)
for xw_, sg in ((SX0 - 0.03, -1), (SX1 + 0.03, 1)):                         # windows: frame, sill, dark glass, bars
    for yc in (-28.2, -25.6):
        aabb('Harbour', STRIM, min(xw_, xw_ + sg * 0.05), max(xw_, xw_ + sg * 0.05), yc - 0.62, yc + 0.62, HARD + 1.45, HARD + 2.45)
        aabb('Harbour', GLASS, min(xw_, xw_ + sg * 0.055), max(xw_, xw_ + sg * 0.055), yc - 0.55, yc + 0.55, HARD + 1.52, HARD + 2.38)
        aabb('Harbour', STRIM, min(xw_, xw_ + sg * 0.1), max(xw_, xw_ + sg * 0.1), yc - 0.66, yc + 0.66, HARD + 1.4, HARD + 1.45)
        for yb_ in (yc - 0.2, yc + 0.2): aabb('Harbour', STRIM, min(xw_, xw_ + sg * 0.07), max(xw_, xw_ + sg * 0.07), yb_ - 0.012, yb_ + 0.012, HARD + 1.52, HARD + 2.38)
box('Harbour', STRIM, ((SX0 + SX1) / 2 - 1.6, SY0 - 0.14, HARD + 3.1), (0.3, 0.22, 0.2)); aabb('Harbour', PANEL_LIGHT, (SX0 + SX1) / 2 - 1.72, (SX0 + SX1) / 2 - 1.48, SY0 - 0.26, SY0 - 0.25, HARD + 3.02, HARD + 3.18)
text('Harbour', 'MAINTENANCE', ((SX0 + SX1) / 2, SY0 - 0.066, HARD + 3.72), 0.26, NAVY, FACE_NEG_Y, FONT_B, 0.006)
hexa('Harbour', CONCRETE, [(12.8, -23.0, HARD - 0.4), (16.2, -23.0, HARD - 0.4), (16.2, -8.0, -2.2), (12.8, -8.0, -2.2),
                           (12.8, -23.0, HARD + 0.1), (16.2, -23.0, HARD + 0.1), (16.2, -8.0, -1.7), (12.8, -8.0, -1.7)])
for x in (13.6, 15.4):
    hexa('Harbour', TIMBER_DARK, [(x - 0.08, -22.8, HARD + 0.1), (x + 0.08, -22.8, HARD + 0.1), (x + 0.08, -9.0, -1.58), (x - 0.08, -9.0, -1.58),
                                  (x - 0.08, -22.8, HARD + 0.2), (x + 0.08, -22.8, HARD + 0.2), (x + 0.08, -9.0, -1.48), (x - 0.08, -9.0, -1.48)])
quad('Harbour', ALGAE, [(12.81, -15.0, 0.6), (16.19, -15.0, 0.6), (16.19, -8.0, -1.69), (12.81, -8.0, -1.69)])
colbox('solid', SX0 - 0.3, SX1 + 0.3, SY0 - 0.3, SY1 + 0.3, HARD - 0.2, HARD + 4.6)

# ---- mooring dolphins with a catwalk off the ferry's starboard side, stern fenders by the ramp ----
DX = 20.5
for yd in (-2.0, 13.0, 28.0, 43.0):
    for px, py in ((DX - 0.9, yd - 0.9), (DX + 0.9, yd - 0.9), (DX - 0.9, yd + 0.9), (DX + 0.9, yd + 0.9)):
        cyl('Harbour', BLACK, (px + (px - DX) * 0.25, py + (py - yd) * 0.25, BED), (px, py, 3.5), 0.36, 16)
        cyl('Harbour', ALGAE, (px + (px - DX) * 0.08, py + (py - yd) * 0.08, -0.7), (px + (px - DX) * 0.04, py + (py - yd) * 0.04, 0.6), 0.38, 16)
    aabb('Harbour', BLACK, DX - 1.6, DX + 1.6, yd - 1.6, yd + 1.6, 3.4, 4.3)
    aabb('Harbour', YELLOW, DX - 1.61, DX + 1.61, yd - 1.61, yd + 1.61, 4.2, 4.25)
    bollard('Harbour', DX - 0.6, yd, 4.3, 0.22)
    cyl('Harbour', STEEL, (DX + 0.5, yd - 0.4, 4.3), (DX + 0.5, yd - 0.4, 4.7), 0.12, 10)
    box('Harbour', GALV, (DX + 0.5, yd - 0.1, 4.6), (0.12, 0.6, 0.12))
    colbox('solid', DX - 1.6, DX + 1.6, yd - 1.6, yd + 1.6, 0.0, 4.3)
for y0, y1 in ((-15.2, -3.6), (-0.4, 11.4), (14.6, 26.4), (29.6, 41.4)):   # steel catwalk between them
    aabb('Harbour', GRATING, DX - 0.5, DX + 0.5, y0, y1, 4.12, 4.2)
    for sgn in (-1, 1):
        aabb('Harbour', BLACK, DX + sgn * 0.5 - 0.06, DX + sgn * 0.5 + 0.06, y0, y1, 3.8, 4.12)
        for hgt in (0.55, 1.05): cyl('Harbour', GALV, (DX + sgn * 0.52, y0, 4.2 + hgt), (DX + sgn * 0.52, y1, 4.2 + hgt), 0.022, 6)
        for k in range(int((y1 - y0) / 1.5) + 1): cyl('Harbour', GALV, (DX + sgn * 0.52, y0 + k * 1.5, 4.2), (DX + sgn * 0.52, y0 + k * 1.5, 5.25), 0.022, 6)
    colbox('walk', DX - 0.5, DX + 0.5, y0, y1, 3.8, 4.2)
    colbox('solid', DX - 0.56, DX - 0.48, y0, y1, 4.2, 5.25); colbox('solid', DX + 0.48, DX + 0.56, y0, y1, 4.2, 5.25)
cyl('Harbour', BLACK, (DX - 0.4, -12.0, BED), (DX - 0.4, -12.0, 4.0), 0.25, 12); cyl('Harbour', BLACK, (DX + 0.4, -12.0, BED), (DX + 0.4, -12.0, 4.0), 0.25, 12)
for s in (-1, 1):                                                        # stern fender dolphins either side of the ramp
    cx = s * 6.1
    for dx in (-0.6, 0.6): cyl('Harbour', STEEL, (cx + dx, -1.9, BED), (cx + dx, -1.9, 2.4), 0.3, 16)
    aabb('Harbour', CONCRETE, cx - 1.1, cx + 1.1, -2.6, -1.1, 2.3, 3.3)
    cyl('Harbour', RUBBER, (cx - 1.0, -0.62, 2.8), (cx + 1.0, -0.62, 2.8), 0.42, 20)
    for dx in (-0.9, 0.9): rail('Harbour', GALV, [(cx + dx, -1.1, 2.8), (cx + dx, -0.62, 2.8)], 0.03)
    colbox('solid', cx - 1.1, cx + 1.1, -2.6, -0.2, 2.3, 3.3)


# ---- 3. linkspan (authored at the old quay line, shifted LDY): pivot LinkspanDeck; hydraulic rams on low piled trestles ----
XF = (LSX, 0, 0, 1, 0.0, LDY, 0.0)
LG = 'P:LinkspanDeck'
def sloped(g, mat, x0, x1, y0, y1, off, thick):
    hexa(g, mat, [(x, y, deck_z(y) + off + dz) for dz in (-thick, 0.0) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])
sloped(LG, DECKSTEEL, -4.0, 4.0, QUAY, LS_Y1, 0.0, 0.3)
aabb(LG, DECKSTEEL, -3.8, 3.8, LS_Y1, PLATE_Y1, LAND - 0.3, LAND)
aabb(LG, YELLOW, -3.8, 3.8, PLATE_Y1 - 0.14, PLATE_Y1, LAND - 0.32, LAND + 0.004)
y = QUAY + 0.45
while y < PLATE_Y1 - 0.3:
    box(LG, STEEL, (0, y, deck_z(y) + 0.012), (7.0 if y > LS_Y1 else 7.3, 0.05, 0.03)); y += 0.36
for k in range(6):
    y0 = QUAY + 1.0 + k * 3.1; sloped(LG, LINE_W, -0.07, 0.07, y0, y0 + 1.6, 0.008, 0.016)
for s in (-1, 1):
    for k in range(20):
        y0 = QUAY + k * (LS_Y1 - QUAY) / 20
        sloped(LG, YELLOW if k % 2 == 0 else BLACK, s * 3.7, s * 4.0, y0, y0 + (LS_Y1 - QUAY) / 20, 0.25, 0.25)
    for k in range(11):
        y0 = QUAY + 0.3 + k * 1.9; z0 = deck_z(y0) + 0.25
        cyl(LG, GALV, (s * 3.86, y0, z0), (s * 3.86, y0, z0 + 1.05), 0.04, 8)
    for hgt in (0.6, 0.95, 1.3):
        cyl(LG, GALV, (s * 3.86, QUAY + 0.3, deck_z(QUAY) + hgt), (s * 3.86, LS_Y1 + 0.3, deck_z(LS_Y1) + hgt), 0.035 if hgt > 1 else 0.025, 8)
    for xg, depth in ((s * 3.0, 1.2), (s * 1.0, 0.75)):
        sloped(LG, STEEL, xg - 0.25, xg + 0.25, QUAY + 0.2, LS_Y1, -0.3, depth)
    box(LG, STEEL, (s * 4.35, -7.2, deck_z(-7.2) - 0.25), (0.9, 0.7, 0.65))          # lifting lug
    cyl(LG, STAINLESS, (s * 4.35, -7.6, deck_z(-7.2) - 0.1), (s * 4.35, -6.8, deck_z(-7.2) - 0.1), 0.09, 12)
    for xk in (1.0, 3.0): cyl(LG, STEEL, (s * xk - 0.3, QUAY + 0.15, HARD - 0.4), (s * xk + 0.3, QUAY + 0.15, HARD - 0.4), 0.2, 16)
    yl = -17.0; zl = deck_z(yl)                                                      # linkspan light mast
    aabb(LG, STEEL, s * 4.0, s * 4.45, yl - 0.3, yl + 0.3, zl - 0.6, zl - 0.2)
    cyl(LG, GALV, (s * 4.25, yl, zl - 0.2), (s * 4.25, yl, zl + 7.5), 0.1, 12, 0.06)
    cyl(LG, GALV, (s * 4.25, yl, zl + 7.4), (s * 3.3, yl, zl + 7.75), 0.04, 8)
    box(LG, STEEL, (s * 3.05, yl, zl + 7.75), (0.7, 0.32, 0.15)); box(LG, LAMP, (s * 3.05, yl, zl + 7.67), (0.6, 0.25, 0.02))
for k in range(8):
    y0 = QUAY + 0.8 + k * 2.4; sloped(LG, STEEL, -3.3, 3.3, y0, y0 + 0.3, -0.3, 0.55)
aabb(LG, STEEL, -3.8, 3.8, -6.1, -5.3, LAND - 0.85, LAND - 0.3)
# car surface: 64 short boxes, so neighbouring tops step 1.7 cm (under 2 cm) down the 5.7 % slope. Their tops ride
# the anti-skid bars at the quay (+2.5 cm, the yard asphalt's height) easing to the bare plate at the sea end, so the
# yard and the landing plate meet them within 1 cm
NLS, LS_TOPS = 64, []
for k in range(NLS):
    ya = QUAY + k * (LS_Y1 - QUAY) / NLS; yb = ya + (LS_Y1 - QUAY) / NLS; ym = (ya + yb) / 2
    zt = deck_z(ym) + 0.025 * (LS_Y1 - ym) / (LS_Y1 - QUAY); LS_TOPS.append(zt)
    colbox('car', -3.7, 3.7, ya, yb, zt - 0.6, zt)
colbox('car', -3.8, 3.8, LS_Y1, PLATE_Y1, LAND - 0.6, LAND)
for s in (-1, 1):
    colbox('car', s * 3.7, s * 4.0, QUAY, LS_Y1, LAND, HARD + 0.25)
    colbox('solid', s * 3.82, s * 3.9, QUAY, LS_Y1, LAND, HARD + 1.3)

XF = None
LY = -7.2 + LDY                    # the linkspan's sea end (its lifting lugs) in the terminal frame
for s in (-1, 1):                  # hydraulic lift: a low piled trestle each side with a ram under the deck's side lug
    px, xr = s * 5.95, s * 4.35 * LSX
    for dy in (-1.1, 1.1):
        cyl('Linkspan', STEEL, (px, LY + dy, BED), (px, LY + dy, -0.9), 0.32, 16)                      # tube piles
        cyl('Linkspan', ALGAE, (px, LY + dy, -0.7), (px, LY + dy, -0.92), 0.335, 16)
    beam('Linkspan', STEEL, (px, LY - 1.1, BED + 0.8), (px, LY + 1.1, -1.2), 0.2, 0.2)                # raking brace
    aabb('Linkspan', CONC_DARK, px - 0.9, px + 0.9, LY - 1.6, LY + 1.6, -0.9, 0.9)                    # pile cap
    aabb('Linkspan', ALGAE, px - 0.93, px + 0.93, LY - 1.63, LY + 1.63, -0.6, 0.45)
    aabb('Linkspan', STEEL, xr - 0.42, xr + 0.42, LY - 0.42, LY + 0.42, 0.9, 1.0)                     # ram base plate
    cyl('Linkspan', STEEL, (xr, LY, 1.0), (xr, LY, 1.3), 0.25, 20)                                    # ram barrel
    annulus('Linkspan', GALV, (xr, LY, 1.28), (0, 0, 1), 0.1, 0.27, 0.07, 20)                         # gland
    cyl('Linkspan', STAINLESS, (xr, LY, 1.3), (xr, LY, deck_z(-7.2) - 0.58), 0.085, 14)               # chromed rod to the lug
    aabb('Linkspan', STEEL, px - 0.2 * s, px + 0.5 * s, LY + 0.7, LY + 1.3, 0.9, 1.45)                # valve block
    rail('Linkspan', RUBBER, [(px + 0.1 * s, LY + 0.8, 1.2), (xr + 0.15 * s, LY + 0.5, 1.12), (xr + 0.2 * s, LY + 0.15, 1.2)], 0.028, 6)
    rail('Linkspan', RUBBER, [(px + 0.1 * s, LY + 1.0, 1.35), (xr + 0.25 * s, LY + 0.6, 1.28), (xr + 0.24 * s, LY + 0.1, 1.08)], 0.028, 6)
    colbox('solid', px - 0.9, px + 0.9, LY - 1.6, LY + 1.6, 0.0, 0.9)
beam('Linkspan', STEEL, (-5.95, LY, -0.55), (5.95, LY, -0.55), 0.45, 0.55)                               # cross tie under the sea end
for s in (-1, 1): beam('Linkspan', STEEL, (s * 5.95, LY - 1.1, BED + 1.0), (0.0, LY, -0.82), 0.22, 0.22)

# ---- 4. timber jetty along the ferry's port side, its 90 degree turn to port, the lower landing ----
J = 'Jetty'
JX0, JX1, JY0, JY1 = -16.0, -10.0, QY, 78.0          # main run (berth face x = JX1, fender face x = -9.5)
AX0, AY0 = -62.0, JY1 - 6.0                           # the L arm runs out to x = AX0 over y in [AY0, JY1]
TOPZ, PLK, STR, HS = JETTY, 0.075, 0.3, 0.3           # deck top, plank, stringer and headstock depths
PILE_TOP = TOPZ - PLK - STR - HS
def planks(x0, x1, y0, y1, along_y, z=TOPZ):
    """Deck planks 0.22 wide with 20 mm gaps, laid across the run (along_y: the run goes along y)."""
    a, b = (y0, y1) if along_y else (x0, x1); p = a + 0.01
    while p < b - 0.05:
        q = min(p + 0.22, b); m = TIMBER if rng.random() < 0.68 else TIMBER2; dz = rng.uniform(-0.004, 0.004)
        if along_y: aabb(J, m, x0, x1, p, q, z - PLK + dz, z + dz)
        else: aabb(J, m, p, q, y0, y1, z - PLK + dz, z + dz)
        p = q + 0.02
def bent(pts, along_y, z_top=PILE_TOP, braced=True):
    """One pile bent: timber piles with tidal growth, a headstock and X bracing between neighbours."""
    for x, y in pts:
        cyl(J, TIMBER_DARK, (x, y, BED), (x, y, z_top), 0.19, 12)
        cyl(J, ALGAE, (x, y, -0.75), (x, y, 0.5), 0.2, 12)
        cyl(J, STEEL, (x, y, z_top - 0.05), (x, y, z_top), 0.21, 12)
    (xa, ya), (xb, yb) = pts[0], pts[-1]
    if along_y: aabb(J, TIMBER_DARK, xa - 0.3, xb + 0.3, ya - 0.15, ya + 0.15, z_top, z_top + HS)
    else: aabb(J, TIMBER_DARK, xa - 0.15, xa + 0.15, ya - 0.3, yb + 0.3, z_top, z_top + HS)
    if not braced: return
    for (p0x, p0y), (p1x, p1y) in zip(pts, pts[1:]):
        o = (0.0, 0.24) if along_y else (0.24, 0.0)
        beam(J, TIMBER_DARK, (p0x + o[0], p0y + o[1], 0.2), (p1x + o[0], p1y + o[1], z_top - 0.1), 0.08, 0.2)
        beam(J, TIMBER_DARK, (p0x - o[0], p0y - o[1], z_top - 0.1), (p1x - o[0], p1y - o[1], 0.2), 0.08, 0.2)
def stringers(xs_, y0, y1, along_y, z=TOPZ):
    for c in xs_:
        if along_y: aabb(J, TIMBER_DARK, c - 0.075, c + 0.075, y0, y1, z - PLK - STR, z - PLK)
        else: aabb(J, TIMBER_DARK, y0, y1, c - 0.075, c + 0.075, z - PLK - STR, z - PLK)
def handrail(p0, p1, z=TOPZ, step=1.8, h=1.1):
    """Galvanised post and two-rail handrail from p0 to p1 (x, y)."""
    a, b = Vector((*p0, z)), Vector((*p1, z)); L = (b - a).length; n = max(1, round(L / step))
    for k in range(n + 1):
        p = a + (b - a) * (k / n); cyl(J, GALV, p, p + Vector((0, 0, h)), 0.028, 8)
    for hh, r in ((h, 0.03), (h * 0.55, 0.022)): cyl(J, GALV, a + Vector((0, 0, hh)), b + Vector((0, 0, hh)), r, 8)
    colbox('solid', min(a.x, b.x) - 0.04, max(a.x, b.x) + 0.04, min(a.y, b.y) - 0.04, max(a.y, b.y) + 0.04, z, z + h)

planks(JX0, JX1, JY0, JY1, False)                                        # main run: planks lie across x
stringers([JX0 + 0.25 + k * 0.79 for k in range(8)], JY0, JY1, True)
planks(AX0, JX0, AY0, JY1, True)                                         # the arm: planks lie across y
stringers([AY0 + 0.25 + k * 0.785 for k in range(8)], AX0, JX0, False)
aabb(J, CONCRETE, JX0 - 0.2, JX1 + 0.2, JY0 - 0.5, JY0 + 1.2, PILE_TOP - 0.4, TOPZ - PLK)          # abutment on the quay
yb = JY0 + 3.0
while yb < JY1 - 0.5:
    bent([(JX0 + 0.4, yb), (JX0 + 3.0, yb), (JX1 - 0.4, yb)], True); yb += 3.5
bent([(JX0 + 0.4, JY1 - 0.4), (JX0 + 3.0, JY1 - 0.4), (JX1 - 0.4, JY1 - 0.4)], True)
xb = JX0 - 3.0
while xb > AX0 + 0.5:
    bent([(xb, AY0 + 0.4), (xb, AY0 + 3.0), (xb, JY1 - 0.4)], False); xb -= 3.5
bent([(AX0 + 0.4, AY0 + 0.4), (AX0 + 0.4, AY0 + 3.0), (AX0 + 0.4, JY1 - 0.4)], False)
for k in range(0, 29, 2):                                                # longitudinal bracing under the run
    y0 = JY0 + 3.0 + k * 3.5
    if y0 + 3.5 > JY1: break
    for x in (JX0 + 0.62, JX1 - 0.62): beam(J, TIMBER_DARK, (x, y0, 0.3), (x, y0 + 3.5, PILE_TOP - 0.1), 0.08, 0.2)
# berth face: fender piles, walers, rubber fender panels, timber kerb, bollards, ladders
for k in range(18):
    yf = -6.25 + 3.5 * k
    cyl(J, TIMBER_DARK, (-9.82, yf, BED), (-9.82, yf, TOPZ + 0.3), 0.22, 12)
    cyl(J, ALGAE, (-9.82, yf, -0.75), (-9.82, yf, 0.5), 0.23, 12)
    cyl(J, STEEL, (-9.82, yf, TOPZ + 0.3), (-9.82, yf, TOPZ + 0.35), 0.24, 12)
    if yf < 54: aabb(J, RUBBER, -9.66, -9.5, yf - 0.3, yf + 0.3, 0.7, TOPZ + 0.1)
for z0 in (0.9, 2.3): aabb(J, TIMBER_DARK, -9.99, -9.79, -8.0, JY1, z0, z0 + 0.25)
for y0 in [JY0 + 1.2 + 6.1 * k for k in range(17)]:
    if y0 + 5.8 < JY1: aabb(J, TIMBER_DARK, JX1 - 0.22, JX1, y0, y0 + 5.8, TOPZ, TOPZ + 0.2)
for yb2 in (-3.0, 10.5, 24.0, 37.5, 51.0, 64.0): bollard(J, JX1 - 0.55, yb2, TOPZ)
for yl in (6.0, 44.0):                                                   # ladders down the berth face
    for dy in (-0.22, 0.22): cyl(J, GALV, (-9.72, yl + dy, -1.2), (-9.72, yl + dy, TOPZ + 0.9), 0.025, 8)
    for z in [-1.0 + 0.3 * k for k in range(14)]: cyl(J, GALV, (-9.72, yl - 0.22, z), (-9.72, yl + 0.22, z), 0.018, 6)
# handrails: the port edge of the run, both edges past the berth, round the arm (a gap where the stub leaves)
handrail((JX0 + 0.1, JY0 + 1.0), (JX0 + 0.1, AY0 + 0.1))
handrail((JX1 - 0.1, 55.0), (JX1 - 0.1, JY1 - 0.1)); handrail((JX1 - 0.1, JY1 - 0.1), (AX0 + 0.1, JY1 - 0.1))
handrail((AX0 + 0.1, JY1 - 0.1), (AX0 + 0.1, AY0 + 0.1)); handrail((AX0 + 0.1, AY0 + 0.1), (-58.9, AY0 + 0.1))
handrail((-56.3, AY0 + 0.1), (JX0 + 0.1, AY0 + 0.1))
for yl in (16.0, 30.0, 44.0, 58.0, 72.0): lamp_post(J, JX0 + 0.2, yl, TOPZ, 5.2, 1.0, 0.0)
for xl in (-25.0, -39.0, -53.0): lamp_post(J, xl, JY1 - 0.2, TOPZ, 5.2, 0.0, -1.0)
cyl(J, STEEL, (JX1 - 0.5, JY1 - 0.5, TOPZ), (JX1 - 0.5, JY1 - 0.5, TOPZ + 3.6), 0.08, 12)        # red head light
cyl(J, NAV_RED, (JX1 - 0.5, JY1 - 0.5, TOPZ + 3.6), (JX1 - 0.5, JY1 - 0.5, TOPZ + 3.95), 0.15, 16)
cyl(J, BLACK, (JX1 - 0.5, JY1 - 0.5, TOPZ + 3.95), (JX1 - 0.5, JY1 - 0.5, TOPZ + 4.1), 0.18, 16, 0.05)
box(J, RED, (JX1 - 0.5, JY1 - 0.62, TOPZ + 2.7), (0.7, 0.04, 0.7))
for xb3, yb3 in ((JX0 + 0.35, 20.0), (JX0 + 0.35, 60.0), (-45.0, JY1 - 0.35)):                   # lifebuoys
    cyl(J, STEEL, (xb3, yb3, TOPZ), (xb3, yb3, TOPZ + 1.6), 0.04, 8)
    annulus(J, ORANGE, (xb3, yb3, TOPZ + 1.2), (1, 0, 0) if abs(xb3 - JX0) < 1 else (0, 1, 0), 0.24, 0.36, 0.1, 24)
colbox('walk', JX0, JX1, JY0, JY1, TOPZ - 0.4, TOPZ); colbox('walk', AX0, JX0, AY0, JY1, TOPZ - 0.4, TOPZ)
# the stub back toward the shore, a stair down and the lower landing with steps into the water
SX0_, SX1_, LZ = -59.0, -56.2, 1.3
planks(SX0_, SX1_, 66.8, AY0, False)
stringers([SX0_ + 0.3, (SX0_ + SX1_) / 2, SX1_ - 0.3], 66.8, AY0, True)
for yb4 in (67.1, 70.0): bent([(SX0_ + 0.3, yb4), (SX1_ - 0.3, yb4)], True)
colbox('walk', SX0_, SX1_, 66.8, AY0, TOPZ - 0.4, TOPZ)
nr = 11; rise = (TOPZ - LZ) / nr
for k in range(nr - 1):
    ya = 66.8 - (k + 1) * 0.28; za = TOPZ - (k + 1) * rise
    aabb(J, TIMBER, SX0_ + 0.12, SX1_ - 0.12, ya, ya + 0.28, za - 0.05, za); aabb(J, YELLOW, SX0_ + 0.12, SX1_ - 0.12, ya + 0.22, ya + 0.28, za - 0.052, za + 0.003)
    colbox('walk', SX0_, SX1_, ya, ya + 0.28, za - 0.3, za)
ybot = 66.8 - (nr - 1) * 0.28
for x in (SX0_ + 0.06, SX1_ - 0.06):
    beam(J, TIMBER_DARK, (x, 66.9, TOPZ - 0.1), (x, ybot, LZ - 0.1), 0.1, 0.3)
    cyl(J, GALV, (x, 66.8, TOPZ + 1.0), (x, ybot, LZ + 1.0), 0.03, 8)
    for yy, zz in ((66.8, TOPZ), (ybot, LZ), ((66.8 + ybot) / 2, (TOPZ + LZ) / 2)): cyl(J, GALV, (x, yy, zz), (x, yy, zz + 1.0), 0.028, 8)
    colbox('solid', x - 0.04, x + 0.04, ybot, 66.8, LZ, TOPZ + 1.0)
LX0_, LX1_, LY0_, LY1_ = -62.0, -53.0, 55.4, ybot
planks(LX0_, LX1_, LY0_, LY1_, False, LZ)
stringers([LX0_ + 0.3 + k * 1.2 for k in range(8)], LY0_, LY1_, True, LZ)
for yb5 in (LY0_ + 0.4, (LY0_ + LY1_) / 2, LY1_ - 0.4):
    bent([(LX0_ + 0.4, yb5), ((LX0_ + LX1_) / 2, yb5), (LX1_ - 0.4, yb5)], True, LZ - PLK - STR - HS)
colbox('walk', LX0_, LX1_, LY0_, LY1_, LZ - 0.4, LZ)
handrail((LX0_ + 0.1, LY1_ - 0.1), (LX0_ + 0.1, LY0_ + 0.1), LZ); handrail((LX1_ - 0.1, LY1_ - 0.1), (LX1_ - 0.1, LY0_ + 0.1), LZ)
handrail((LX0_ + 0.1, LY0_ + 0.1), (-58.9, LY0_ + 0.1), LZ); handrail((-56.3, LY0_ + 0.1), (LX1_ - 0.1, LY0_ + 0.1), LZ)
handrail((LX0_ + 0.1, LY1_ - 0.1), (SX0_ - 0.05, LY1_ - 0.1), LZ); handrail((SX1_ + 0.05, LY1_ - 0.1), (LX1_ - 0.1, LY1_ - 0.1), LZ)
for k in range(7):                                                       # steps down into the water
    yk = LY0_ - (k + 1) * 0.3; zk = LZ - (k + 1) * 0.27
    aabb(J, ALGAE if zk < 0.1 else CONC_DARK if zk < 0.5 else CONCRETE, -58.9, -56.3, yk, yk + 0.3, zk - 0.3, zk)
    colbox('walk', -58.9, -56.3, yk, yk + 0.3, zk - 0.25, zk)
for xl, yl in ((LX0_ + 0.25, LY0_ + 0.25), (LX1_ - 0.25, LY0_ + 0.25)): lamp_post(J, xl, yl, LZ, 4.6, 0.0, 1.0)
for k in range(4): aabb(J, TIMBER, -61.4, -60.8, 57.0 + k * 0.155, 57.12 + k * 0.155, LZ + 0.42, LZ + 0.46)   # bench
for dy in (0.1, 0.5): aabb(J, STEEL, -61.35, -60.85, 57.0 + dy - 0.03, 57.0 + dy + 0.03, LZ, LZ + 0.42)
colbox('solid', -61.4, -60.8, 57.0, 57.6, LZ, LZ + 0.46)


# ---- 5. stair tower, covered walkway, gate rotunda and swinging gangway: authored for a starboard-side jetty
# (old frame, walkway floor 8.0), mirrored onto the port-side jetty and dropped 1.0 m so the floor meets the
# ferry's DECK2 door sill at z 7.0 and the gangway hinge lands at (-11.12, 9.7).
XF = (-1, 0, 0, 1, -0.92, -13.2, -1.0); JETTY, WALK = 4.2, 8.0
# ---- 5a. stair tower (five flights round a well, rise 0.179, going 0.30) and the lift ---------
TX0, TX1, TY0, TY1, GO = 10.5, 14.6, -20.0, -15.9, 0.3
R = (WALK - JETTY) / 29
def P(ax, a, s, z): return (a, s, z) if ax == 'y' else (s, a, z)
def rect(ax, a0, a1, s0, s1):
    return (a0, a1, min(s0, s1), max(s0, s1)) if ax == 'y' else (min(s0, s1), max(s0, s1), a0, a1)
def flight(ax, a0, a1, s0, d, n, base):
    for i in range(1, n):
        sa, sb = s0 + d * (i - 1) * GO, s0 + d * i * GO; top = base + i * R
        x0, x1, y0, y1 = rect(ax, a0, a1, sa, sb)
        aabb('Tower', GRATING, x0, x1, y0, y1, top - 0.05, top)
        nx0, nx1, ny0, ny1 = rect(ax, a0, a1, sa, sa + d * 0.06)
        aabb('Tower', YELLOW, nx0, nx1, ny0, ny1, top - 0.054, top + 0.004)
        colbox('walk', x0, x1, y0, y1, base, top)
    se = s0 + d * (n - 1) * GO; ztop = base + (n - 1) * R
    for a in (a0 + 0.05, a1 - 0.05):
        beam('Tower', STRUCT, P(ax, a, s0 - d * 0.1, base - 0.15), P(ax, a, se, ztop - 0.15), 0.07, 0.32)
        cyl('Tower', STAINLESS, P(ax, a, s0, base + R + 0.95), P(ax, a, se, ztop + 0.95), 0.025, 8)
        for k in range(int((n - 1) * GO / 0.12) + 1):
            sp = s0 + d * k * 0.12; zp = base + R + (ztop - base - R) * min(1.0, k * 0.12 / ((n - 1) * GO))
            cyl('Tower', FRAME, P(ax, a, sp, zp - 0.05), P(ax, a, sp, zp + 0.93), 0.011, 4)
def landing(x0, x1, y0, y1, z, zfrom):
    aabb('Tower', GRATING, x0, x1, y0, y1, z - 0.15, z); colbox('walk', x0, x1, y0, y1, zfrom, z)
z1, z2, z3, z4 = (JETTY + 6 * k * R for k in (1, 2, 3, 4))
flight('y', 13.3, 14.6, -18.7, 1, 6, JETTY);  landing(13.3, 14.6, -17.2, TY1, z1, JETTY)
flight('x', -17.2, TY1, 13.3, -1, 6, z1);     landing(TX0, 11.8, -17.2, TY1, z2, z1)
flight('y', TX0, 11.8, -17.2, -1, 6, z2);     landing(TX0, 11.8, TY0, -18.7, z3, z2)
flight('x', TY0, -18.7, 11.8, 1, 6, z3);      landing(13.3, TX1, TY0, -18.7, z4, z3)
flight('y', 13.3, 14.6, -18.7, 1, 5, z4)
for x0, x1, y0 in ((13.3, TX1, -17.5), (TX0, 13.3, -17.2)):
    aabb('Tower', GRATING, x0, x1, y0, TY1, WALK - 0.25, WALK); colbox('walk', x0, x1, y0, TY1, WALK - 0.25, WALK)
colbox('solid', 11.85, 13.25, -18.65, -17.25, JETTY, WALK + 1.1)
rail('Tower', STAINLESS, [(11.8, -17.2, WALK + 1.0), (13.3, -17.2, WALK + 1.0), (13.3, -17.5, WALK + 1.0)], 0.025)
for k in range(13): cyl('Tower', FRAME, (11.8 + k * 0.12, -17.2, WALK), (11.8 + k * 0.12, -17.2, WALK + 1.0), 0.011, 4)
for cx in (TX0, TX1):
    for cy in (TY0, TY1): aabb('Tower', STRUCT, cx - 0.15, cx + 0.15, cy - 0.15, cy + 0.15, JETTY, 11.3)
for zr in (5.3, WALK - 0.35, 11.0):
    aabb('Tower', STRUCT, TX0 - 0.12, TX1 + 0.12, TY0 - 0.12, TY0 + 0.12, zr, zr + 0.3)
    aabb('Tower', STRUCT, TX1 - 0.12, TX1 + 0.12, TY0, TY1, zr, zr + 0.3)
    aabb('Tower', STRUCT, TX0 - 0.12, TX0 + 0.12, TY0, TY1, zr, zr + 0.3)
for k in range(14):
    t = TY0 + 0.15 + k * 0.3; u = TX0 + 0.15 + k * 0.3
    aabb('Tower', GALV, TX1 + 0.05, TX1 + 0.35, t - 0.025, t + 0.025, JETTY + 0.1, 10.95)
    aabb('Tower', GALV, TX0 - 0.35, TX0 - 0.05, t - 0.025, t + 0.025, JETTY + 0.1, 10.95)
    aabb('Tower', GALV, u - 0.025, u + 0.025, TY0 - 0.35, TY0 - 0.05, 5.65 if u > 13.2 else JETTY + 0.1, 10.95)
aabb('Tower', STEEL, TX0, TX1, TY1 - 0.05, TY1 + 0.05, JETTY + 0.1, WALK - 0.35)
aabb('Tower', STEEL, TX0, 12.0, TY1 - 0.05, TY1 + 0.05, WALK, 11.0)
aabb('Tower', ROOF, TX0 - 0.45, TX1 + 0.45, TY0 - 0.45, TY1 + 0.45, 11.3, 11.5)
aabb('Tower', NAVY, TX0 - 0.5, TX1 + 0.5, TY0 - 0.5, TY1 + 0.5, 11.12, 11.3)
aabb('Tower', TEAL, TX0 - 0.52, TX1 + 0.52, TY0 - 0.52, TY1 + 0.52, 11.04, 11.12)                  # teal stripe under the navy cap
aabb('Tower', NAVY, TX0 - 0.5, TX0 - 0.36, TY0 + 0.2, TY1 - 0.2, 9.75, 10.75)
text('Tower', 'TIDEWATER', (TX0 - 0.525, (TY0 + TY1) / 2, 10.25), 0.6, WHITE, FACE_NEG_X)
aabb('Tower', NAVY, TX0 + 0.2, 13.2, TY0 - 0.5, TY0 - 0.36, 9.5, 10.9)
logo('Tower', (11.85, TY0 - 0.5, 9.95), (1, 0, 0), (0, 0, 1), 0.62)
aabb('Tower', STRUCT, 13.2, TX1 + 0.1, TY0 - 0.36, TY0 + 0.1, 5.3, 5.65)
aabb('Tower', NAVY, 13.35, 14.55, TY0 - 0.42, TY0 - 0.36, 4.75, 5.2)
text('Tower', 'TO FERRY', (13.95, TY0 - 0.44, 4.975), 0.24, WHITE, FACE_NEG_Y, FONT_B, 0.01)
colbox('solid', TX1 - 0.05, TX1 + 0.35, TY0, TY1, JETTY, 11.3)
colbox('solid', TX0 - 0.35, TX0 + 0.05, TY0, TY1, JETTY, 11.3)
colbox('solid', TX0, 13.3, TY0 - 0.35, TY0 + 0.05, JETTY, 11.3)
colbox('solid', 13.3, TX1, TY0 - 0.35, TY0 + 0.05, 5.3, 11.3)
colbox('solid', TX0, TX1, TY1 - 0.05, TY1 + 0.05, JETTY, WALK - 0.3)
colbox('solid', TX0, 12.0, TY1 - 0.05, TY1 + 0.05, WALK - 0.3, 11.3)
LX0, LX1, LY0, LY1 = 10.2, 11.9, TY1 + 0.05, -13.9                                  # glass lift shaft
for cx in (LX0, LX1):
    for cy in (LY0, LY1): aabb('Tower', STRUCT, cx - 0.06, cx + 0.06, cy - 0.06, cy + 0.06, JETTY, 11.8)
aabb('Glazing', GLASS, LX0 - 0.01, LX0 + 0.01, LY0, LY1, JETTY + 0.1, 11.0)
aabb('Glazing', GLASS, LX0, LX1, LY1 - 0.01, LY1 + 0.01, JETTY + 0.1, 11.0)
for z0, z1 in ((5.0, WALK - 0.1), (10.2, 11.0)): aabb('Glazing', GLASS, LX1 - 0.01, LX1 + 0.01, LY0, LY1, z0, z1)
for zd in (JETTY, WALK):
    aabb('Tower', STAINLESS, LX1 - 0.02, LX1 + 0.02, -15.4, -14.4, zd, zd + 2.1)
    aabb('Tower', FRAME, LX1 - 0.03, LX1 + 0.03, LY0, LY1, zd + 2.1, zd + 2.3)
for zb in (5.0, WALK - 0.3): aabb('Tower', STRUCT, LX0, LX1, LY0, LY1, zb - 0.1, zb)
aabb('Tower', LINING, 10.4, 11.7, -15.6, -14.1, JETTY + 0.05, 5.1)
aabb('Tower', STRUCT, LX0 - 0.05, LX1 + 0.05, LY0, LY1 + 0.05, 11.0, 11.8)
aabb('Tower', ROOF, LX0 - 0.15, LX1 + 0.15, LY0 - 0.1, LY1 + 0.15, 11.8, 11.9)
colbox('solid', LX0, LX1, LY0, LY1, JETTY, 11.8)

# ---- 5b. covered walkway along the jetty, the gate rotunda and the swinging gangway ---------
WX0, WX1, WY0, WY1 = 12.0, 14.6, TY1, 21.2
aabb('Walkway', CONCRETE, 11.8, 14.8, WY0, WY1, 7.7, WALK - 0.02)
aabb('Walkway', DECKSTEEL, 12.05, 14.55, WY0, WY1, WALK - 0.02, WALK)
for xa in (12.05, 14.45): aabb('Walkway', YELLOW, xa, xa + 0.1, WY0, WY1, WALK - 0.02, WALK + 0.003)
aabb('Walkway', STEEL, 11.75, 11.95, WY0, WY1, 7.25, 7.7); aabb('Walkway', STEEL, 14.65, 14.85, WY0, WY1, 7.25, 7.7)
frames = [-15.6 + 4.1 * k for k in range(9)]
for k, yf in enumerate(frames):
    aabb('Walkway', STEEL, 11.7, 14.9, yf - 0.12, yf + 0.12, 7.3, 7.7)
    for xc in (11.85, 14.75):
        if k == 0 and xc < 12: continue
        aabb('Walkway', STRUCT, xc - 0.14, xc + 0.14, yf - 0.14, yf + 0.14, JETTY, 10.45)
        aabb('Walkway', STEEL, xc - 0.25, xc + 0.25, yf - 0.25, yf + 0.25, JETTY, JETTY + 0.03)
        colbox('solid', xc - 0.14, xc + 0.14, yf - 0.14, yf + 0.14, JETTY, 7.7)
        if k < 8 and k > 0:
            cyl('Walkway', GALV, (xc, yf, JETTY + 0.1), (xc, yf + 4.1, 7.2), 0.035, 6)
            cyl('Walkway', GALV, (xc, yf, 7.2), (xc, yf + 4.1, JETTY + 0.1), 0.035, 6)
    aabb('Walkway', PANEL_LIGHT, 13.1, 13.5, yf + 1.35, yf + 2.75, 10.29, 10.32)
for xw, y0, sgn in ((12.05, -13.9, -1), (14.55, WY0, 1)):
    aabb('Walkway', STRUCT, xw - 0.04, xw + 0.04, y0, WY1, WALK, 9.0)
    aabb('Walkway', TEAL, xw + sgn * 0.04, xw + sgn * 0.055, y0, WY1, 8.8, 8.88)
    aabb('Walkway', NAVY, xw + sgn * 0.04, xw + sgn * 0.055, y0, WY1, 8.62, 8.76)         # slim navy and teal brand stripe
    aabb('Glazing', GLASS, xw - 0.012, xw + 0.012, y0, WY1, 9.0, 10.3)
    for zt in (8.98, 10.26): aabb('Walkway', FRAME, xw - 0.05, xw + 0.05, y0, WY1, zt, zt + 0.06)
    ym = y0 + 0.02
    while ym < WY1:
        aabb('Walkway', FRAME, xw - 0.04, xw + 0.04, ym - 0.03, ym + 0.03, 9.0, 10.3); ym += 1.37
    cyl('Walkway', STAINLESS, (xw - sgn * 0.13, y0 + 0.1, 8.95), (xw - sgn * 0.13, WY1, 8.95), 0.025, 8)
    for yb in [y0 + 0.5 + 2.0 * k for k in range(int((WY1 - y0) / 2.0))]:
        cyl('Walkway', STAINLESS, (xw - sgn * 0.13, yb, 8.95), (xw, yb, 8.95), 0.012, 6)
    aabb('Walkway', STRUCT, xw - 0.35 if sgn < 0 else xw - 0.05, xw + 0.05 if sgn < 0 else xw + 0.35, y0 if sgn > 0 else WY0, WY1, 10.3, 10.45)
    colbox('solid', xw - 0.07, xw + 0.07, y0, WY1, WALK, 10.3)
for xa, xb, za, zb in ((11.7, 13.3, 10.45, 10.95), (14.9, 13.3, 10.45, 10.95)):
    hexa('Walkway', ROOF, [(xa, WY0, za), (xb, WY0, zb), (xb, WY1, zb), (xa, WY1, za), (xa, WY0, za + 0.1), (xb, WY0, zb + 0.1), (xb, WY1, zb + 0.1), (xa, WY1, za + 0.1)])
aabb('Walkway', GALV, 13.2, 13.4, WY0, WY1, 10.98, 11.1)
for yg, dirn in ((WY1, (0, 0, 1)), (WY0 + 0.1, (0, 0, 1))):
    plate('Walkway', NAVY, [(11.62, 10.25), (15.0, 10.25), (15.0, 10.6), (13.3, 11.12), (11.62, 10.6)], (0, yg, 0), (1, 0, 0), dirn, 0.1)
aabb('Walkway', CEILING, 12.1, 14.5, WY0, WY1, 10.32, 10.4)
aabb('Walkway', NAVY, 11.6, 11.7, WY0, WY1, 10.25, 10.6); aabb('Walkway', NAVY, 14.9, 15.0, WY0, WY1, 10.25, 10.6)
aabb('Walkway', TEAL, 11.585, 11.6, WY0, WY1, 10.36, 10.43); aabb('Walkway', TEAL, 15.0, 15.015, WY0, WY1, 10.36, 10.43)
colbox('walk', 12.05, 14.55, WY0, WY1, 7.7, WALK)
aabb('Walkway', NAVY, 14.0, 14.45, 15.8, 16.3, WALK, WALK + 1.05)                     # ticket-check podium
aabb('Walkway', STAINLESS, 14.02, 14.43, 15.82, 16.28, WALK + 1.05, WALK + 1.09)
aabb('Walkway', SCREEN, 14.05, 14.3, 15.9, 16.2, WALK + 1.09, WALK + 1.1)
aabb('Walkway', BLACK, 14.2, 14.4, 15.95, 16.15, WALK + 1.1, WALK + 1.18)
colbox('solid', 14.0, 14.45, 15.8, 16.3, WALK, WALK + 1.1)
for yb in (15.7,):
    for xr in (12.6, 14.0): cyl('Walkway', STAINLESS, (xr, yb, 10.32), (xr, yb, 10.05), 0.01, 4)
    aabb('Walkway', NAVY, 12.4, 14.2, yb - 0.05, yb + 0.05, 9.55, 10.05)
    text('Walkway', 'BOARDING  GATE 1', (13.3, yb - 0.065, 9.8), 0.2, WHITE, FACE_NEG_Y, FONT_B, 0.008)
RX0, RX1, RY0, RY1 = 10.2, 14.6, WY1, 24.6
aabb('Walkway', CONCRETE, 10.1, 14.8, RY0, RY1 + 0.1, 7.7, WALK - 0.02)
aabb('Walkway', DECKSTEEL, 10.3, 14.55, RY0, RY1 - 0.05, WALK - 0.02, WALK)
cyl('Walkway', STEEL, (10.2, 22.9, 7.3), (10.2, 22.9, 7.7), 0.55, 24)
for cx, cy in ((10.35, 21.35), (10.35, 24.45), (14.75, 24.45), (14.75, 21.35)):
    aabb('Walkway', STRUCT, cx - 0.14, cx + 0.14, cy - 0.14, cy + 0.14, JETTY, 10.45); colbox('solid', cx - 0.14, cx + 0.14, cy - 0.14, cy + 0.14, JETTY, 7.7)
def glazed(ax, fixed, a0, a1):
    """A rotunda wall panel: teal spandrel, glass and frames between a0 and a1 along the given axis."""
    def bx(g, m, f0, f1, s0, s1, z0, z1):
        if ax == 'y': aabb(g, m, f0, f1, s0, s1, z0, z1)
        else: aabb(g, m, s0, s1, f0, f1, z0, z1)
    bx('Walkway', STRUCT, fixed - 0.04, fixed + 0.04, a0, a1, WALK, 9.0)
    bx('Glazing', GLASS, fixed - 0.012, fixed + 0.012, a0, a1, 9.0, 10.3)
    for zt in (8.98, 10.26): bx('Walkway', FRAME, fixed - 0.05, fixed + 0.05, a0, a1, zt, zt + 0.06)
    for k in range(int((a1 - a0) / 1.1) + 2):
        m = min(a1 - 0.03, a0 + 0.03 + k * 1.1); bx('Walkway', FRAME, fixed - 0.04, fixed + 0.04, m - 0.03, m + 0.03, 9.0, 10.3)
    colbox('solid', *((fixed - 0.07, fixed + 0.07, a0, a1) if ax == 'y' else (a0, a1, fixed - 0.07, fixed + 0.07)), WALK, 10.3)
glazed('x', RY1 - 0.05, RX0, RX1); glazed('y', 10.25, RY0, 22.1); glazed('y', 10.25, 23.7, RY1); glazed('x', RY0 + 0.05, RX0, 12.0)
glazed('y', 14.55, RY0, RY1)
aabb('Walkway', FRAME, 10.15, 10.35, 22.0, 22.1, WALK, 10.3); aabb('Walkway', FRAME, 10.15, 10.35, 23.7, 23.8, WALK, 10.3)
aabb('Walkway', ROOF, 10.0, 15.0, 21.0, 24.8, 10.45, 10.62)
aabb('Walkway', CEILING, 10.3, 14.5, RY0, RY1 - 0.1, 10.32, 10.4)
aabb('Walkway', NAVY, 9.94, 15.06, 20.94, 24.86, 10.1, 10.45)
text('Walkway', 'GATE 1', (9.925, 22.9, 10.275), 0.24, WHITE, FACE_NEG_X, FONT_B, 0.008)
aabb('Walkway', PANEL_LIGHT, 11.8, 13.0, 22.5, 23.3, 10.29, 10.32)
colbox('walk', 10.25, 14.55, RY0, RY1 - 0.05, 7.7, WALK)
GE = 'P:GangwayEnd'
aabb(GE, STEEL, 8.6, 10.25, 22.1, 23.7, 7.72, 7.98); aabb(GE, DECKSTEEL, 8.6, 10.25, 22.12, 23.68, 7.98, WALK)
aabb(GE, YELLOW, 8.6, 8.75, 22.12, 23.68, 7.99, WALK + 0.004)
for yw in (22.13, 23.67):
    aabb(GE, NAVY, 8.62, 10.2, yw - 0.03, yw + 0.03, WALK, 8.95)
    aabb(GE, GLASS, 8.62, 10.2, yw - 0.01, yw + 0.01, 8.95, 10.15)
    for xp in (8.66, 9.43, 10.16): aabb(GE, FRAME, xp - 0.04, xp + 0.04, yw - 0.04, yw + 0.04, WALK, 10.2)
    for zt in (8.93, 10.13): aabb(GE, FRAME, 8.62, 10.2, yw - 0.04, yw + 0.04, zt, zt + 0.05)
    aabb(GE, STEEL, 8.65, 10.2, yw - 0.08, yw + 0.08, 7.35, 7.72)
    cyl(GE, STAINLESS, (8.85, yw + (0.12 if yw < 23 else -0.12), 8.95), (10.15, yw + (0.12 if yw < 23 else -0.12), 8.95), 0.025, 8)
aabb(GE, ROOF, 8.6, 10.25, 22.02, 23.78, 10.2, 10.34)
aabb(GE, NAVY, 8.6, 10.25, 21.98, 22.04, 10.1, 10.36); aabb(GE, NAVY, 8.6, 10.25, 23.76, 23.82, 10.1, 10.36)
aabb(GE, STEEL, 8.42, 8.6, 22.35, 23.45, 7.96, 7.995); aabb(GE, YELLOW, 8.42, 8.48, 22.35, 23.45, 7.965, 7.998)   # threshold lip, stops at the 8.4 sill line
for k, xb in enumerate((8.6, 8.68, 8.76)):
    w = 0.14 - k * 0.02
    aabb(GE, RUBBER, xb, xb + 0.06, 22.02, 22.02 + w, WALK, 10.34); aabb(GE, RUBBER, xb, xb + 0.06, 23.78 - w, 23.78, WALK, 10.34)
    aabb(GE, RUBBER, xb, xb + 0.06, 22.02, 23.78, 10.34 - w, 10.34)
aabb(GE, PANEL_LIGHT, 9.1, 9.8, 22.8, 23.0, 10.17, 10.2)
colbox('walk', 8.6, 10.25, 22.1, 23.7, 7.7, WALK)
colbox('solid', 8.6, 10.2, 22.02, 22.16, WALK, 10.3); colbox('solid', 8.6, 10.2, 23.64, 23.78, WALK, 10.3)
station('JettyStairs', (13.95, -21.0, JETTY)); station('GangwayGate', (13.1, 15.2, WALK))
XF = None; JETTY, WALK = 3.2, 7.0

# ---- 6. passenger hall walls, glazing and fit-out (authored east-west, turned -90 deg onto the berth side) ----
XF = (0, 1, -1, 0, 3.0, 4.0, 0.0)
BX0, BX1, BY0, BY1, PARA, CEIL = 12.0, 38.0, -48.0, -27.0, 7.5, 6.95
B, I = 'Building', 'Interior'
aabb(B, CONCRETE, BX0, BX1, BY0, BY1, 2.9, FLOOR - 0.02)
for i in range(18):
    for j in range(17):
        x, y = 12.3 + 0.6 + i * 1.2, -47.7 + 0.6 + j * 1.2
        if x < 37.7 and y < -27.3:
            aabb(I, TILE if (i + j) % 2 == 0 else TILE2, x - 0.595, min(x + 0.595, 37.7), y - 0.595, min(y + 0.595, -27.3), FLOOR - 0.02, FLOOR)
colbox('walk', BX0 + 0.3, BX1 - 0.3, BY0 + 0.3, BY1 - 0.3, 2.9, FLOOR)
# walls
aabb(B, RENDER, BX0, BX0 + 0.3, BY0, -40.5, 2.9, PARA); aabb(B, RENDER, BX0, BX0 + 0.3, -27.8, BY1, 2.9, PARA)
aabb(B, RENDER, BX0, BX0 + 0.3, -40.5, -27.8, 6.9, PARA); aabb(B, CONC_DARK, BX0, BX0 + 0.3, -40.5, -27.8, 2.9, FLOOR + 0.1)
for a, b2 in ((-40.5, -33.3), (-30.7, -27.8)): aabb('Glazing', GLASS, 12.13, 12.17, a, b2, FLOOR + 0.1, 6.9)
aabb('Glazing', GLASS, 12.13, 12.17, -33.3, -30.7, 5.8, 6.9)
ym = -40.5
while ym < -27.7:
    aabb(B, FRAME, 12.08, 12.22, ym - 0.04, ym + 0.04, FLOOR, 6.9); ym += 1.45
for zt in (FLOOR + 0.06, 5.86, 6.84): aabb(B, FRAME, 12.07, 12.23, -40.5, -27.8, zt, zt + 0.06)
for yj in (-33.35, -30.65): aabb(B, FRAME, 12.02, 12.26, yj - 0.06, yj + 0.06, FLOOR, 5.8)
aabb(B, STEEL, 11.9, 12.05, -34.5, -29.5, 5.6, 5.85)
for y0 in (-34.4, -30.9):                                                        # sliding leaves, open
    aabb('Glazing', GLASS, 11.99, 12.02, y0, y0 + 1.3, FLOOR + 0.05, 5.6)
    for yy in (y0, y0 + 1.3): aabb(B, FRAME, 11.97, 12.04, yy - 0.03, yy + 0.03, FLOOR, 5.6)
    aabb(B, FRAME, 11.97, 12.04, y0, y0 + 1.3, FLOOR, FLOOR + 0.1)
aabb(B, RENDER, BX0, 22.0, BY1 - 0.3, BY1, 2.9, PARA); aabb(B, RENDER, 37.5, BX1, BY1 - 0.3, BY1, 2.9, PARA)
aabb(B, RENDER, 22.0, 37.5, BY1 - 0.3, BY1, 2.9, 4.2); aabb(B, RENDER, 22.0, 37.5, BY1 - 0.3, BY1, 6.9, PARA)
aabb('Glazing', GLASS, 22.0, 37.5, -27.17, -27.13, 4.2, 6.9)
for k in range(11): aabb(B, FRAME, 22.0 + k * 1.55 - 0.04, 22.0 + k * 1.55 + 0.04, -27.22, -27.08, 4.2, 6.9)
for zt in (4.2, 6.84): aabb(B, FRAME, 22.0, 37.5, -27.22, -27.08, zt, zt + 0.06)
aabb(B, COPING, 22.0, 37.5, -27.05, -26.9, 4.12, 4.2)
aabb(B, RENDER, BX0, BX1, BY0, BY0 + 0.3, 2.9, PARA); aabb(B, RENDER, BX1 - 0.3, BX1, BY0, BY1, 2.9, PARA)
aabb(B, NAVY, 29.5, 30.5, BY0 - 0.04, BY0, FLOOR, 5.45); aabb(B, NAVY, BX1, BX1 + 0.04, -36.5, -35.5, FLOOR, 5.45)
for k in range(6): aabb('Glazing', GLASS, BX1 - 0.01, BX1 + 0.01, -46.0 + k * 3.2, -44.4 + k * 3.2, 5.8, 6.6)
for k in range(7):
    x = 14.0 + k * 4.0
    y = -46.0 + k * 3.2
aabb(I, CEILING, 12.3, 37.7, -47.7, -27.3, CEIL, CEIL + 0.05)
for i in range(8):
    for j in range(6): aabb(I, PANEL_LIGHT, 14.3 + i * 3.0 - 0.3, 14.3 + i * 3.0 + 0.3, -45.6 + j * 3.4 - 0.6, -45.6 + j * 3.4 + 0.6, CEIL - 0.015, CEIL)
for x0, x1, y0, y1, z1 in ((12.3, 12.32, -47.7, -40.5, CEIL), (12.3, 37.7, -47.7, -47.68, CEIL), (37.68, 37.7, -47.7, -27.3, CEIL),
                           (12.3, 22.0, -27.32, -27.3, CEIL), (22.0, 37.7, -27.32, -27.3, 4.2)):
    aabb(I, LINING, x0, x1, y0, y1, FLOOR, z1)
colbox('solid', BX0, BX0 + 0.3, BY0, -33.3, 2.9, PARA); colbox('solid', BX0, BX0 + 0.3, -30.7, BY1, 2.9, PARA)
colbox('solid', BX0, BX0 + 0.3, -33.3, -30.7, 5.6, PARA)
colbox('solid', BX0, BX1, BY1 - 0.3, BY1, 2.9, PARA); colbox('solid', BX0, BX1, BY0, BY0 + 0.3, 2.9, PARA)
colbox('solid', BX1 - 0.3, BX1, BY0, BY1, 2.9, PARA)
# ---- 6a. interior: ticket counter (three windows), departure board, shop, cafe, toilets ------
CY = -43.0
aabb(I, LAMINATE, 17.5, 27.5, CY - 0.8, CY, FLOOR, FLOOR + 1.1)
aabb(I, NAVY, 17.5, 27.5, CY, CY + 0.02, FLOOR, FLOOR + 0.15); aabb(I, TEAL, 17.5, 27.5, CY, CY + 0.015, FLOOR + 0.55, FLOOR + 0.75)
aabb(I, SUN, 17.5, 27.5, CY, CY + 0.015, FLOOR + 0.78, FLOOR + 0.83)
aabb(I, WOOD, 17.4, 27.6, CY - 0.9, CY + 0.12, FLOOR + 1.1, FLOOR + 1.15)
aabb('Glazing', GLASS, 17.5, 27.5, CY - 0.47, CY - 0.44, FLOOR + 1.3, FLOOR + 2.45)
for xp in (17.5, 20.85, 24.15, 27.5): aabb(I, FRAME, xp - 0.04, xp + 0.04, CY - 0.5, CY - 0.41, FLOOR + 1.15, FLOOR + 2.5)
aabb(I, FRAME, 17.5, 27.5, CY - 0.5, CY - 0.41, FLOOR + 2.45, FLOOR + 2.52)
for n, w in enumerate((25.8, 22.5, 19.2), 1):      # numbered left to right as the customer faces them
    aabb(I, NAVY, w - 0.22, w + 0.22, CY - 0.43, CY - 0.4, FLOOR + 2.02, FLOOR + 2.38)
    text(I, str(n), (w, CY - 0.393, FLOOR + 2.2), 0.26, WHITE, FACE_POS_Y, FONT_B, 0.006)
    box(I, BLACK, (w - 0.45, CY - 0.62, FLOOR + 1.47), (0.56, 0.04, 0.36)); aabb(I, SCREEN, w - 0.71, w - 0.19, CY - 0.645, CY - 0.64, FLOOR + 1.31, FLOOR + 1.63)
    cyl(I, BLACK, (w - 0.45, CY - 0.6, FLOOR + 1.15), (w - 0.45, CY - 0.6, FLOOR + 1.3), 0.02, 8)
    box(I, BLACK, (w + 0.35, CY - 0.05, FLOOR + 1.19), (0.09, 0.17, 0.08)); aabb(I, SCREEN, w + 0.315, w + 0.385, CY - 0.1, CY - 0.04, FLOOR + 1.23, FLOOR + 1.234)
    aabb(I, GALV, w + 0.315, w + 0.385, CY - 0.03, CY + 0.02, FLOOR + 1.23, FLOOR + 1.232)
    box(I, WHITE, (w + 0.5, CY - 0.62, FLOOR + 1.22), (0.3, 0.25, 0.14))
    box(I, BLACK, (w, CY - 1.4, FLOOR + 0.62), (0.5, 0.5, 0.08)); box(I, BLACK, (w, CY - 1.64, FLOOR + 0.98), (0.46, 0.06, 0.55))
    cyl(I, GALV, (w, CY - 1.4, FLOOR + 0.05), (w, CY - 1.4, FLOOR + 0.58), 0.025, 8); cyl(I, BLACK, (w, CY - 1.4, FLOOR), (w, CY - 1.4, FLOOR + 0.05), 0.3, 12)
aabb(I, LAMINATE, 17.5, 27.5, -47.68, -47.1, FLOOR, FLOOR + 0.9); aabb(I, WOOD, 17.5, 27.5, -47.68, -47.05, FLOOR + 0.9, FLOOR + 0.94)
aabb(I, NAVY, 17.5, 27.5, CY - 0.62, CY - 0.4, 5.95, CEIL)
text(I, 'TICKETS  &  CHECK-IN', (22.2, CY - 0.39, 6.45), 0.4, WHITE, FACE_POS_Y, FONT_BI, 0.01)
logo(I, (26.6, CY - 0.398, 6.28), (-1, 0, 0), (0, 0, 1), 0.4, 0.012)
for x0, x1 in ((16.0, 17.5), (27.5, 30.8)):
    aabb(I, LINING, x0, x1, -43.95, -43.85, FLOOR, CEIL); colbox('solid', x0, x1, -43.95, -43.85, FLOOR, CEIL)
    aabb(I, NAVY, (x0 + x1) / 2 - 0.45, (x0 + x1) / 2 + 0.45, -43.85, -43.83, FLOOR, FLOOR + 2.1)
colbox('solid', 17.4, 27.6, CY - 0.9, CY + 0.12, FLOOR, FLOOR + 2.5)
for yr, xa, xb in ((-41.2, 18.0, 25.5), (-39.4, 19.5, 27.0)):
    xs_ = [xa + k * 1.5 for k in range(int((xb - xa) / 1.5) + 1)]
    for xp in xs_:
        cyl(I, STAINLESS, (xp, yr, FLOOR), (xp, yr, FLOOR + 0.03), 0.17, 16); cyl(I, STAINLESS, (xp, yr, FLOOR + 0.03), (xp, yr, FLOOR + 0.97), 0.03, 10)
    aabb(I, NAVY, xa, xb, yr - 0.012, yr + 0.012, FLOOR + 0.84, FLOOR + 0.92)
    colbox('solid', xa, xb, yr - 0.05, yr + 0.05, FLOOR, FLOOR + 0.97)
station('TicketCounter', (22.5, -42.4, FLOOR))
aabb(I, LINING, 30.7, 30.9, -47.7, -38.0, FLOOR, CEIL); colbox('solid', 30.7, 30.9, -47.7, -38.0, FLOOR, CEIL)
aabb(I, BLACK, 30.55, 30.7, -43.2, -38.1, 4.3, 6.62); aabb(I, STEEL, 30.53, 30.7, -43.25, -38.05, 4.26, 4.3); aabb(I, STEEL, 30.53, 30.7, -43.25, -38.05, 6.62, 6.66)
text(I, 'DEPARTURES', (30.535, -40.65, 6.36), 0.26, AMBER, FACE_NEG_X, FONT_B, 0.006)
aabb(I, STEEL, 30.535, 30.55, -43.0, -38.3, 6.18, 6.195)
for r, (tm, st, sm) in enumerate((('07:30', 'DEPARTED', BOARD_WHITE), ('09:15', 'BOARDING', BOARD_GREEN), ('11:00', 'ON TIME', BOARD_GREEN),
                                  ('13:45', 'ON TIME', BOARD_GREEN), ('16:30', 'CHECK-IN 15:45', AMBER))):
    zr = 5.96 - r * 0.36
    text(I, tm, (30.535, -38.8, zr), 0.21, AMBER, FACE_NEG_X, FONT_B, 0.02)
    text(I, 'ISLAND PORT', (30.535, -40.3, zr), 0.2, BOARD_WHITE, FACE_NEG_X, FONT_B, 0.02)
    text(I, st, (30.535, -42.1, zr), 0.17, sm, FACE_NEG_X, FONT_B, 0.02)
aabb(I, BLACK, 30.55, 30.7, -41.2, -40.1, 6.65, 6.9); text(I, '09:02', (30.535, -40.65, 6.775), 0.16, AMBER, FACE_NEG_X, FONT_B, 0.005)
PLUSH = material('PlushBrown', (0.5, 0.3, 0.16), 0, 0.9)
_bm = bmesh.new(); bmesh.ops.create_icosphere(_bm, subdivisions=2, radius=1.0); _bm.verts.index_update()
ICO2_V = [v.co.copy() for v in _bm.verts]; ICO2_F = [tuple(v.index for v in f.verts) for f in _bm.faces]; _bm.free()
def blob(g, mat, c, r): add(g, mat, [Vector(c) + Vector((v.x * r[0], v.y * r[1], v.z * r[2])) for v in ICO2_V], ICO2_F)
for gx in (33.0, 35.2):                                                            # shop gondolas
    y0, y1 = -45.5, -39.0
    aabb(I, WHITE, gx - 0.45, gx + 0.45, y0, y1, FLOOR, FLOOR + 0.12); aabb(I, WHITE, gx - 0.03, gx + 0.03, y0, y1, FLOOR, FLOOR + 1.75)
    aabb(I, TEAL, gx - 0.05, gx + 0.05, y0, y1, FLOOR + 1.75, FLOOR + 2.0)
    for side in (-1, 1):
        for h in (0.12, 0.55, 0.95, 1.35):
            aabb(I, WHITE, gx + side * 0.03, gx + side * 0.45, y0, y1, FLOOR + h, FLOOR + h + 0.025)
            yy = y0 + 0.05
            while yy < y1 - 0.3:
                w = rng.uniform(0.1, 0.28); hh = rng.uniform(0.12, 0.28); d = rng.uniform(0.22, 0.36)
                aabb(I, rng.choice(PRODUCTS), gx + side * 0.05, gx + side * (0.05 + d), yy, yy + w, FLOOR + h + 0.025, FLOOR + h + 0.025 + hh)
                yy += w + 0.02
    colbox('solid', gx - 0.45, gx + 0.45, y0, y1, FLOOR, FLOOR + 2.0)
for k in range(3):                                                                 # drinks fridges
    y0 = -46.6 + k * 2.05; y1 = y0 + 2.0; ym = (y0 + y1) / 2
    aabb(I, WHITE, 37.6, 37.68, y0, y1, FLOOR, FLOOR + 2.15)
    aabb(I, WHITE, 37.02, 37.68, y0, y0 + 0.06, FLOOR, FLOOR + 2.15); aabb(I, WHITE, 37.02, 37.68, y1 - 0.06, y1, FLOOR, FLOOR + 2.15)
    aabb(I, WHITE, 37.02, 37.68, y0, y1, FLOOR + 1.95, FLOOR + 2.15); aabb(I, TEAL, 37.0, 37.02, y0, y1, FLOOR + 1.98, FLOOR + 2.12)
    aabb(I, BLACK, 37.02, 37.68, y0, y1, FLOOR, FLOOR + 0.2); aabb(I, FRIDGE, 37.57, 37.6, y0 + 0.06, y1 - 0.06, FLOOR + 0.2, FLOOR + 1.95)
    for h in (0.2, 0.62, 1.04, 1.46):
        aabb(I, GALV, 37.08, 37.57, y0 + 0.06, y1 - 0.06, FLOOR + h, FLOOR + h + 0.02)
        yy = y0 + 0.12
        while yy < y1 - 0.1:
            m = rng.choice(PRODUCTS)
            for bx in (37.18, 37.32): cyl(I, m, (bx, yy, FLOOR + h + 0.02), (bx, yy, FLOOR + h + 0.26), 0.034, 8, 0.028)
            yy += 0.085
    aabb('Glazing', GLASS, 37.03, 37.05, y0 + 0.06, y1 - 0.06, FLOOR + 0.2, FLOOR + 1.95)
    aabb(I, FRAME, 37.01, 37.05, ym - 0.03, ym + 0.03, FLOOR + 0.2, FLOOR + 1.95)
    for yh in (ym - 0.12, ym + 0.12): aabb(I, STAINLESS, 36.98, 37.01, yh - 0.015, yh + 0.015, FLOOR + 0.9, FLOOR + 1.4)
    colbox('solid', 37.0, 37.68, y0, y1, FLOOR, FLOOR + 2.15)
sx_, sy_ = 33.4, -37.5                                                             # souvenir spinner
cyl(I, BLACK, (sx_, sy_, FLOOR), (sx_, sy_, FLOOR + 0.03), 0.35, 16); cyl(I, GALV, (sx_, sy_, FLOOR), (sx_, sy_, FLOOR + 1.9), 0.025, 8)
for t, zt in enumerate((0.5, 0.9, 1.3, 1.7)):
    box(I, WHITE, (sx_, sy_, FLOOR + zt), (0.56, 0.56, 0.02), math.pi / 4)
    for k in range(8):
        a = k * math.tau / 8; px, py = sx_ + 0.2 * math.cos(a), sy_ + 0.2 * math.sin(a)
        if t % 2 == 0: cyl(I, rng.choice(PRODUCTS), (px, py, FLOOR + zt + 0.01), (px, py, FLOOR + zt + 0.11), 0.045, 12)
        else: box(I, rng.choice(PRODUCTS), (px, py, FLOOR + zt + 0.07), (0.11, 0.02, 0.13), a + math.pi / 2)
colbox('solid', sx_ - 0.35, sx_ + 0.35, sy_ - 0.35, sy_ + 0.35, FLOOR, FLOOR + 1.9)
aabb(I, WOOD, 34.7, 36.1, -37.9, -37.0, FLOOR + 0.8, FLOOR + 0.85)                    # plush kangaroo table
for lx in (34.8, 36.0):
    for ly in (-37.8, -37.1): aabb(I, BLACK, lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, FLOOR, FLOOR + 0.8)
for k in range(4):
    kx, ky, kz = 34.95 + k * 0.37, -37.45, FLOOR + 0.85
    blob(I, PLUSH, (kx, ky, kz + 0.13), (0.075, 0.09, 0.13)); blob(I, PLUSH, (kx, ky + 0.05, kz + 0.3), (0.05, 0.065, 0.05))
    for dx in (-0.025, 0.025): cyl(I, PLUSH, (kx + dx, ky + 0.03, kz + 0.33), (kx + dx * 1.6, ky + 0.02, kz + 0.41), 0.018, 6, 0.004)
    cyl(I, PLUSH, (kx, ky - 0.07, kz + 0.06), (kx, ky - 0.22, kz + 0.01), 0.03, 8, 0.012)
    cyl(I, rng.choice(PRODUCTS), (kx + 0.15, ky + 0.25, kz), (kx + 0.15, ky + 0.25, kz + 0.1), 0.045, 12)
colbox('solid', 34.7, 36.1, -37.9, -37.0, FLOOR, FLOOR + 0.85)
aabb(I, WOOD, 31.2, 32.4, -37.6, -36.6, FLOOR, FLOOR + 1.0); aabb(I, LAMINATE, 31.15, 32.45, -37.65, -36.55, FLOOR + 1.0, FLOOR + 1.04)
box(I, BLACK, (31.8, -37.3, FLOOR + 1.2), (0.36, 0.04, 0.26)); aabb(I, SCREEN, 31.64, 31.96, -37.275, -37.27, FLOOR + 1.1, FLOOR + 1.3)
colbox('solid', 31.15, 32.45, -37.65, -36.55, FLOOR, FLOOR + 1.04)
for xr in (32.4, 36.2): cyl(I, GALV, (xr, -36.05, 6.7), (xr, -36.05, CEIL), 0.01, 4)
aabb(I, TEAL, 32.2, 36.4, -36.1, -36.0, 6.2, 6.7)
text(I, 'ISLAND SHOP', (34.3, -35.985, 6.45), 0.3, WHITE, FACE_POS_Y, FONT_BI, 0.008)
aabb(I, WOOD, 35.6, 36.3, -33.0, -28.2, FLOOR, FLOOR + 1.0); aabb(I, LAMINATE, 35.55, 36.35, -33.05, -28.15, FLOOR + 1.0, FLOOR + 1.05)
aabb(I, TEAL, 35.585, 35.6, -33.0, -28.2, FLOOR + 0.35, FLOOR + 0.6)
box(I, STAINLESS, (36.0, -29.0, FLOOR + 1.3), (0.5, 0.75, 0.5)); aabb(I, BLACK, 35.75, 36.25, -29.375, -28.625, FLOOR + 1.55, FLOOR + 1.6)
for dy in (-0.2, 0.2): cyl(I, BLACK, (35.73, -29.0 + dy, FLOOR + 1.3), (35.73, -29.0 + dy, FLOOR + 1.2), 0.03, 8)
aabb('Glazing', GLASS, 35.65, 36.25, -31.6, -30.4, FLOOR + 1.05, FLOOR + 1.45)
for k in range(3): cyl(I, PRODUCTS[0 if k == 1 else 1], (35.95, -31.3 + k * 0.3, FLOOR + 1.06), (35.95, -31.3 + k * 0.3, FLOOR + 1.16), 0.11, 16)
aabb(I, LAMINATE, 37.1, 37.68, -33.0, -28.0, FLOOR, FLOOR + 0.9)
aabb(I, MENU, 37.64, 37.68, -32.6, -28.8, 5.2, 6.5)
text(I, 'CAFE', (37.62, -30.7, 6.22), 0.34, NAVY, FACE_NEG_X, FONT_BI, 0.01)
for r in range(4): aabb(I, NAVY, 37.625, 37.64, -32.3, -29.1, 5.83 - r * 0.17, 5.86 - r * 0.17)
colbox('solid', 35.55, 36.35, -33.05, -28.15, FLOOR, FLOOR + 1.05); colbox('solid', 37.1, 37.68, -33.0, -28.0, FLOOR, FLOOR + 0.9)
# A moulded polypropylene seat shell: a profile (forward distance d, height z above the floor) swept across the seat,
# 16 mm thick, the ends narrowed so the corners read rounded. Faces (fx, fy); (cx, cy) is its pan centre line.
SHELL_PROFILE = [(0.235, 0.405), (0.245, 0.43), (0.235, 0.452), (0.2, 0.462), (0.1, 0.462), (0.0, 0.457), (-0.1, 0.453),
                 (-0.16, 0.462), (-0.2, 0.49), (-0.218, 0.55), (-0.228, 0.65), (-0.238, 0.75), (-0.25, 0.84), (-0.262, 0.9), (-0.258, 0.925)]
def seat_shell(g, mat, cx, cy, fx, fy, w=0.48, t=0.016):
    ux, uy = -fy, fx; P = SHELL_PROFILE; n = len(P); verts = []
    for i, (d, z) in enumerate(P):
        a, b = P[max(i - 1, 0)], P[min(i + 1, n - 1)]
        td, tz = b[0] - a[0], b[1] - a[1]; L = math.hypot(td, tz) or 1.0
        nd, nz = -tz / L, td / L                                  # the profile normal
        ww = w * (0.94 if i in (0, n - 1) else (0.97 if i in (1, n - 2) else 1.0)) * (1.0 - 0.08 * max(0.0, -d - 0.16) / 0.1)
        for sd in (t / 2, -t / 2):
            for su in (-ww / 2, ww / 2):
                dd, zz = d + nd * sd, z + nz * sd
                verts.append((cx + fx * dd + ux * su, cy + fy * dd + uy * su, FLOOR + zz))
    faces = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces += [(a, a + 1, b + 1, b), (a + 3, a + 2, b + 2, b + 3), (a + 2, a, b, b + 2), (a + 1, a + 3, b + 3, b + 1)]
    faces += [(0, 2, 3, 1), (4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 3, 4 * (n - 1) + 2)]
    add(g, mat, verts, faces)
for tx, ty in [(23.5 + 2.5 * i, -28.6) for i in range(5)] + [(23.5 + 2.5 * i, -31.0) for i in range(4)]:
    cyl(I, WOOD, (tx, ty, FLOOR + 0.74), (tx, ty, FLOOR + 0.77), 0.4, 20); cyl(I, BLACK, (tx, ty, FLOOR), (tx, ty, FLOOR + 0.74), 0.04, 8)
    cyl(I, BLACK, (tx, ty, FLOOR), (tx, ty, FLOOR + 0.03), 0.25, 16)
    for sgn in (-1, 1):
        cx_ = tx + sgn * 0.62
        seat_shell(I, SEAT, tx + sgn * 0.6, ty, -sgn, 0.0, w=0.44)
        for lx in (-0.17, 0.17):
            for ly in (-0.17, 0.17): cyl(I, GALV, (cx_ + lx, ty + ly, FLOOR), (cx_ + lx, ty + ly, FLOOR + 0.43), 0.015, 6)
    colbox('solid', tx - 0.87, tx + 0.87, ty - 0.4, ty + 0.4, FLOOR, FLOOR + 0.77)
for x0 in (18.5, 23.5):                                                            # beam seating, back to back
    for yr, face in ((-37.0, -1), (-36.4, 1)):
        # real beam seating: moulded shells on brackets off a steel box beam, tube armrests with pads, T-legs on glides
        aabb(I, GALV, x0, x0 + 3.6, yr - 0.04, yr + 0.04, FLOOR + 0.33, FLOOR + 0.38)
        for xe in (x0 - 0.006, x0 + 3.6): aabb(I, BLACK, xe, xe + 0.006, yr - 0.036, yr + 0.036, FLOOR + 0.334, FLOOR + 0.376)
        for s in range(6):
            xs = x0 + 0.3 + s * 0.6
            seat_shell(I, SEAT, xs, yr, 0.0, face)
            aabb(I, GALV, xs - 0.025, xs + 0.025, yr - 0.14, yr + 0.14, FLOOR + 0.38, FLOOR + 0.448)
        for k in range(7):
            xa = x0 + k * 0.6
            rail(I, GALV, [(xa, yr - face * 0.1, FLOOR + 0.38), (xa, yr - face * 0.1, FLOOR + 0.6), (xa, yr + face * 0.02, FLOOR + 0.64),
                           (xa, yr + face * 0.19, FLOOR + 0.64), (xa, yr + face * 0.22, FLOOR + 0.58)], 0.012, 8)
            aabb(I, BLACK, xa - 0.028, xa + 0.028, *sorted((yr - face * 0.03, yr + face * 0.21)), FLOOR + 0.645, FLOOR + 0.672)
        for xl in (x0 + 0.2, x0 + 3.4):
            aabb(I, GALV, xl - 0.035, xl + 0.035, yr - 0.025, yr + 0.025, FLOOR + 0.035, FLOOR + 0.35); aabb(I, GALV, xl - 0.035, xl + 0.035, yr - 0.25, yr + 0.25, FLOOR + 0.012, FLOOR + 0.045)
            for ys in (-1, 1): aabb(I, BLACK, xl - 0.04, xl + 0.04, *sorted((yr + ys * 0.19, yr + ys * 0.26)), FLOOR, FLOOR + 0.012)
    colbox('solid', x0, x0 + 3.6, -37.3, -36.1, FLOOR, FLOOR + 0.95)
aabb(I, LINING, 12.3, 16.0, -41.1, -41.0, FLOOR, CEIL); aabb(I, LINING, 15.9, 16.0, -47.7, -41.0, FLOOR, CEIL)
colbox('solid', 12.3, 16.0, -47.7, -41.0, FLOOR, CEIL)
for xd, lab in ((13.0, 'MEN'), (14.2, 'WOMEN'), (15.35, 'ACCESS')):
    aabb(I, TEAL, xd - 0.42, xd + 0.42, -41.0, -40.96, FLOOR, FLOOR + 2.1)
    for xj in (xd - 0.45, xd + 0.45): aabb(I, FRAME, xj - 0.03, xj + 0.03, -41.0, -40.94, FLOOR, FLOOR + 2.15)
    aabb(I, FRAME, xd - 0.48, xd + 0.48, -41.0, -40.94, FLOOR + 2.1, FLOOR + 2.18)
    aabb(I, STAINLESS, xd - 0.4, xd + 0.4, -40.96, -40.955, FLOOR + 0.02, FLOOR + 0.3); aabb(I, STAINLESS, xd + 0.2, xd + 0.32, -40.96, -40.95, FLOOR + 0.9, FLOOR + 1.3)
    aabb(I, NAVY, xd - 0.25, xd + 0.25, -40.96, -40.94, FLOOR + 1.5, FLOOR + 1.8)
    text(I, lab, (xd, -40.93, FLOOR + 1.65), 0.1, WHITE, FACE_POS_Y, FONT_B, 0.004)
aabb(I, NAVY, 12.5, 15.8, -40.98, -40.93, 5.55, 5.95); text(I, 'TOILETS', (14.15, -40.92, 5.75), 0.24, WHITE, FACE_POS_Y, FONT_B, 0.006)
for px, py in ((12.9, -39.6), (12.9, -28.4), (29.9, -33.6), (21.0, -28.0)):
    cyl(I, OCHRE_DARK, (px, py, FLOOR), (px, py, FLOOR + 0.5), 0.26, 16, 0.3)
    for k in range(9):
        r = rng.uniform(0.14, 0.24); a = rng.uniform(0, math.tau); d = rng.uniform(0.0, 0.2)
        blob(I, FOLIAGE, (px + d * math.cos(a), py + d * math.sin(a), FLOOR + 0.62 + rng.uniform(0.0, 0.85)), (r, r, r * 0.85))
    colbox('solid', px - 0.3, px + 0.3, py - 0.3, py + 0.3, FLOOR, FLOOR + 1.5)
for px in (15.0, 18.5):
    aabb(I, FRAME, px - 0.7, px + 0.7, -27.34, -27.3, 4.4, 6.0); aabb(I, TEAL, px - 0.62, px + 0.62, -27.35, -27.34, 4.48, 5.1)
    aabb(I, WHITE, px - 0.62, px + 0.62, -27.35, -27.34, 5.1, 5.92); logo(I, (px, -27.35, 5.05), (1, 0, 0), (0, 0, 1), 0.45, 0.005)
XF = None

# ---- 7. terminal building: long, low, white, gable roof under solar panels, verandah to the berth ---
# The passenger hall (interior block, y -34 .. -8) keeps the earlier walls and fit-out, placed with XF above.
# North of it an open breezeway (y -8 .. -4) and a staff and baggage block (y -4 .. 12); one roof covers all.
B = 'Building'
RX0, RX1, RY0, RY1, EV, RIDGE = -45.6, -23.4, -34.6, 12.6, 7.4, 8.5
RM = (RX0 + RX1) / 2
up_facing(B, PAVING, [(-47.0, -40.0), (-10.8, -40.0), (-10.8, QY), (-17.2, QY), (-17.6, -22.0), (-19.4, 12.0),
                      (-19.9, 14.5), (-47.0, 14.5)], HARD + 0.02)
colbox('walk', -47.0, -17.6, -40.0, 14.5, HARD - 0.5, HARD + 0.02)
# staff and baggage block
for x0, x1, y0, y1 in ((-45.0, -44.7, -4.0, 12.0), (-24.3, -24.0, -4.0, 12.0), (-45.0, -24.0, -4.0, -3.7), (-45.0, -24.0, 11.7, 12.0)):
    aabb(B, RENDER, x0, x1, y0, y1, 2.9, EV + 0.1); colbox('solid', x0, x1, y0, y1, 2.9, EV)
aabb(B, CONC_DARK, -45.05, -23.95, -4.05, 12.05, 2.9, 3.5)
aabb(B, FASCIA, -45.03, -44.99, 3.0, 7.0, FLOOR, 6.3)                                    # roller door to the yard side
for k in range(22): aabb(B, STEEL, -45.05, -45.02, 3.0, 7.0, FLOOR + 0.1 + k * 0.13, FLOOR + 0.12 + k * 0.13)
aabb(B, FRAME, -45.06, -45.0, 2.85, 7.15, 6.3, 6.45)
def window(xc, yc, w, h, z0, face):
    """A dark glazed window with a frame and sill on the wall facing 'face' (+x, -x, +y or -y)."""
    ax, sgn = face[1], (1 if face[0] == '+' else -1)
    if ax == 'x':
        aabb(B, PORTHOLE, xc - 0.02, xc + 0.02, yc - w / 2, yc + w / 2, z0, z0 + h)
        for yy in (yc - w / 2, yc, yc + w / 2): aabb(B, FRAME, xc - 0.05 + sgn * 0.02, xc + 0.05 + sgn * 0.02, yy - 0.04, yy + 0.04, z0, z0 + h)
        for zz in (z0, z0 + h): aabb(B, FRAME, xc - 0.05 + sgn * 0.02, xc + 0.05 + sgn * 0.02, yc - w / 2, yc + w / 2, zz - 0.04, zz + 0.04)
        aabb(B, COPING, xc - 0.02 + sgn * 0.06, xc + 0.02 + sgn * 0.12, yc - w / 2 - 0.08, yc + w / 2 + 0.08, z0 - 0.08, z0 - 0.04)
    else:
        aabb(B, PORTHOLE, xc - w / 2, xc + w / 2, yc - 0.02, yc + 0.02, z0, z0 + h)
        for xx in (xc - w / 2, xc, xc + w / 2): aabb(B, FRAME, xx - 0.04, xx + 0.04, yc - 0.05 + sgn * 0.02, yc + 0.05 + sgn * 0.02, z0, z0 + h)
        for zz in (z0, z0 + h): aabb(B, FRAME, xc - w / 2, xc + w / 2, yc - 0.05 + sgn * 0.02, yc + 0.05 + sgn * 0.02, zz - 0.04, zz + 0.04)
        aabb(B, COPING, xc - w / 2 - 0.08, xc + w / 2 + 0.08, yc - 0.02 + sgn * 0.06, yc + 0.02 + sgn * 0.12, z0 - 0.08, z0 - 0.04)
for yc in (-1.5, 9.5): window(-45.02, yc, 2.4, 1.5, 4.4, '-x')
for yc in (-1.0, 3.5, 8.0): window(-23.98, yc, 2.4, 1.5, 4.4, '+x')
for xc in (-41.0, -36.0, -28.0): window(xc, 12.02, 2.4, 1.5, 4.4, '+y')
window(-40.0, -4.02, 2.0, 1.4, 4.5, '-y')
for xd, face in ((-26.5, '+x'),):                                                         # staff door onto the verandah
    aabb(B, NAVY, -23.99, -23.95, 5.2, 6.2, FLOOR, FLOOR + 2.15); aabb(B, STAINLESS, -23.95, -23.93, 5.3, 5.45, FLOOR + 1.0, FLOOR + 1.1)
aabb(B, NAVY, -33.2, -32.2, -4.03, -3.99, FLOOR, FLOOR + 2.15)
# breezeway between the hall and the staff block
aabb(B, PAVING, -45.0, -24.0, -8.0, -4.0, 2.9, FLOOR); colbox('walk', -45.0, -24.0, -8.0, -4.0, 2.9, FLOOR)
for k in range(1, 7): aabb(B, CONCRETE, -45.0 + 3.0 * k - 0.01, -45.0 + 3.0 * k + 0.01, -8.0, -4.0, FLOOR, FLOOR + 0.003)
aabb(B, CEILING, -45.0, -24.0, -8.3, -3.7, EV - 0.02, EV); aabb(B, NAVY, -45.0, -24.0, -8.0, -7.9, 6.9, EV)
for xl in (-40.0, -34.5, -29.0): cyl(B, LAMP, (xl, -6.0, EV - 0.02), (xl, -6.0, EV - 0.035), 0.16, 16)
aabb(B, NAVY, -36.5, -35.9, -5.6, -5.3, FLOOR, FLOOR + 2.3); colbox('solid', -36.5, -35.9, -5.6, -5.3, FLOOR, FLOOR + 2.3)
text(B, 'TICKETS', (-36.2, -5.615, FLOOR + 1.55), 0.13, WHITE, FACE_NEG_Y, FONT_B, 0.006)
logo(B, (-36.2, -5.602, FLOOR + 1.9), (1, 0, 0), (0, 0, 1), 0.2, 0.01)
# gable ends above the eave line
for yg, dn in ((RY0 + 0.6, (0, 0, 1)), (RY1 - 0.6 - 0.3, (0, 0, 1))):
    plate(B, RENDER, [(-45.0, EV + 0.05), (-24.0, EV + 0.05), (RM, RIDGE + 0.02)], (0, yg + 0.3, 0), (1, 0, 0), (0, 0, 1), 0.3)
# roof: two zinc slopes, ridge cap, gutters, barges, downpipes
PITCH = (RIDGE - EV) / (RM - RX0)
for xa, za, xb, zb in ((RX0, EV, RM, RIDGE), (RM, RIDGE, RX1, EV)):
    hexa(B, ZINC, [(xa, RY0, za), (xb, RY0, zb), (xb, RY1, zb), (xa, RY1, za),
                   (xa, RY0, za + 0.15), (xb, RY0, zb + 0.15), (xb, RY1, zb + 0.15), (xa, RY1, za + 0.15)])
for k in range(int((RY1 - RY0) / 0.76) + 1):                                              # sheet rib lines
    y = RY0 + 0.1 + k * 0.76
    for xa, za, xb, zb in ((RX0, EV, RM, RIDGE), (RM, RIDGE, RX1, EV)):
        beam(B, ZINC, (xa, y, za + 0.17), (xb, y, zb + 0.17), 0.03, 0.04)
beam(B, SOLAR_FRAME, (RM, RY0, RIDGE + 0.2), (RM, RY1, RIDGE + 0.2), 0.5, 0.08)
for xg in (RX0 - 0.1, RX1 + 0.1):
    aabb(B, FASCIA, xg - 0.12, xg + 0.12, RY0, RY1, EV - 0.15, EV + 0.12)
    for yd in (RY0 + 0.3, -6.0, RY1 - 0.3): cyl(B, FASCIA, (xg, yd, EV - 0.15), (xg, yd, HARD + 0.05), 0.05, 8)
for yb_ in (RY0, RY1):
    for xa, za, xb, zb in ((RX0, EV, RM, RIDGE), (RM, RIDGE, RX1, EV)): beam(B, FASCIA, (xa, yb_, za + 0.02), (xb, yb_, zb + 0.02), 0.06, 0.3)
colbox('solid', -45.0, -24.0, RY0 + 0.6, RY1 - 0.6, EV, RIDGE + 0.2)
# solar array: 1.76 x 1.10 m modules, portrait, five rows a slope, silver frames and dark blue cell columns
def module(side, s0, y0):
    """side -1 = west slope (eave at RX0), +1 = east slope (eave at RX1); s0 = distance up the slope."""
    L = math.hypot(RM - RX0, RIDGE - EV); ux, uz = (-side) * (RM - RX0) / L, (RIDGE - EV) / L
    nx, nz = side * (RIDGE - EV) / L, (RM - RX0) / L; ex = RX0 if side < 0 else RX1
    def P(s, y, h): return (ex + ux * s + nx * h, y, EV + 0.15 + uz * s + nz * h)
    ya, yb_ = (y0, y0 + 1.1) if side < 0 else (y0 + 1.1, y0)
    hexa(B, SOLAR_FRAME, [P(s0, ya, 0.1), P(s0 + 1.76, ya, 0.1), P(s0 + 1.76, yb_, 0.1), P(s0, yb_, 0.1),
                          P(s0, ya, 0.14), P(s0 + 1.76, ya, 0.14), P(s0 + 1.76, yb_, 0.14), P(s0, yb_, 0.14)])
    for c in range(6):
        c0 = y0 + 0.035 + c * 0.172; c1 = c0 + 0.166
        qa, qb = (c0, c1) if side < 0 else (c1, c0)
        quad(B, SOLAR, [P(s0 + 0.035, qa, 0.143), P(s0 + 1.725, qa, 0.143), P(s0 + 1.725, qb, 0.143), P(s0 + 0.035, qb, 0.143)])
nmod = 0
for side in (-1, 1):
    for r in range(5):
        y = RY0 + 0.9
        while y + 1.1 < RY1 - 0.9:
            if not (-9.2 < y < -2.8 and r > 2) and not (side > 0 and r == 0 and y > 6.0):
                module(side, 0.55 + r * 1.79, y); nmod += 1
            y += 1.12
# verandah along the berth face, and the covered link to the stair tower
aabb(B, PAVING, -24.0, -20.0, -34.3, 12.3, 2.9, FLOOR); colbox('walk', -24.0, -20.0, -34.3, 12.3, 2.9, FLOOR)
aabb(B, YELLOW, -20.08, -20.0, -34.3, 12.3, FLOOR - 0.001, FLOOR + 0.002)
hexa(B, ZINC, [(-24.0, -34.5, 7.12), (-19.9, -34.5, 6.72), (-19.9, 12.5, 6.72), (-24.0, 12.5, 7.12),
               (-24.0, -34.5, 7.24), (-19.9, -34.5, 6.84), (-19.9, 12.5, 6.84), (-24.0, 12.5, 7.24)])
aabb(B, NAVY, -19.95, -19.85, -34.5, 12.5, 6.45, 6.86); aabb(B, SUN, -19.86, -19.84, -34.5, 12.5, 6.47, 6.52)
aabb(B, CEILING, -24.0, -20.0, -34.4, 12.4, 6.7, 6.72)
yp = -34.1
while yp < 12.4:
    aabb(B, WHITE, -20.35, -20.25, yp - 0.05, yp + 0.05, FLOOR, 6.72); colbox('solid', -20.35, -20.25, yp - 0.05, yp + 0.05, FLOOR, 6.72)
    cyl(B, LAMP, (-22.0, yp + 2.0, 6.7), (-22.0, yp + 2.0, 6.685), 0.12, 16); yp += 4.1
text(B, 'TIDEWATER FERRIES', (-19.84, -10.0, 6.655), 0.3, WHITE, FACE_POS_X, FONT_BI, 0.008)
text(B, 'TIDEWATER FERRIES', (-19.84, -30.0, 6.655), 0.3, WHITE, FACE_POS_X, FONT_BI, 0.008)
for yb_ in (-31.5, -24.0, -15.0, 2.0):                                                    # timber benches
    for k in range(4): aabb(B, TIMBER, -23.6, -23.0, yb_ - 0.9 + k * 0.155, yb_ - 0.9 + k * 0.155 + 0.12, FLOOR + 0.42, FLOOR + 0.46)
    for dy in (-0.8, 0.8): aabb(B, STEEL, -23.55, -23.05, yb_ + dy - 0.03, yb_ + dy + 0.03, FLOOR, FLOOR + 0.42)
    colbox('solid', -23.6, -23.0, yb_ - 0.9, yb_ + 0.9, FLOOR, FLOOR + 0.46)
aabb(B, ZINC, -25.5, -14.0, -37.0, -34.0, 6.2, 6.32); aabb(B, NAVY, -25.5, -14.0, -37.1, -37.0, 6.0, 6.34)
for xp_ in (-23.7, -19.0, -14.3):
    aabb(B, WHITE, xp_ - 0.05, xp_ + 0.05, -36.95, -36.85, HARD, 6.2); colbox('solid', xp_ - 0.05, xp_ + 0.05, -36.95, -36.85, HARD, 6.2)
text(B, 'TO FERRY', (-19.0, -37.115, 6.17), 0.2, WHITE, FACE_NEG_Y, FONT_B, 0.006)
# branding on the car park wall and the north end
text(B, 'TIDEWATER FERRIES', (-45.02, -21.0, 6.45), 1.0, NAVY, FACE_NEG_X)
text(B, 'FERRY TERMINAL', (-45.02, -21.0, 5.35), 0.45, NAVY, FACE_NEG_X, FONT_B, 0.01)
logo(B, (-45.0, -31.0, 5.95), (0, -1, 0), (0, 0, 1), 0.85)
text(B, 'TIDEWATER', (-34.5, 12.02, 6.35), 0.9, NAVY, FACE_POS_Y)
logo(B, (-26.8, 12.0, 6.15), (1, 0, 0), (0, 0, 1), 0.7)


# ---- 8. marshalling yard behind the linkspan, check-in booth and boom gate, car park, road --------
H = 'Hardstand'
YX0, YX1, YY0 = -10.8, 18.0, -92.0
up_facing(H, ASPHALT, [(YX0, YY0), (YX1, YY0), (YX1, QY), (YX0, QY)], HARD + 0.025)
colbox('car', YX0, YX1, YY0, QY, HARD - 0.5, HARD + 0.025)
ZL = HARD + 0.037
for k in range(8):
    x = -9.0 + 3.3 * k; aabb(H, LINE_W, x - 0.06, x + 0.06, -80.0, -42.0, HARD + 0.025, ZL)
aabb(H, LINE_W, -9.0, 14.1, -42.3, -42.0, HARD + 0.025, ZL)
ARROW = [(-0.15, -1.7), (0.15, -1.7), (0.15, 0.2), (0.5, 0.2), (0.0, 1.3), (-0.5, 0.2), (-0.15, 0.2)]
for k in range(7):
    xc = -9.0 + 3.3 * k + 1.65
    text(H, str(k + 1), (xc, -77.5, ZL - 0.004), 1.5, LINE_W, (0, 0, 0), FONT_B, 0.006)
    for ya in (-68.0, -54.0): plate(H, LINE_W, ARROW, (xc, ya, HARD + 0.025), (1, 0, 0), (0, 1, 0), 0.012)
    text(H, 'WAIT', (xc, -43.4, ZL - 0.004), 0.6, LINE_W, (0, 0, 0), FONT_B, 0.006)
for s in (-1, 1): aabb(H, LINE_Y, s * 5.1 - 0.075, s * 5.1 + 0.075, -40.0, QY - 0.3, HARD + 0.025, ZL)
for yc in (-36.0, -33.0, -30.0):
    for s in (-1, 1): box(H, LINE_Y, (s * 0.85, yc, HARD + 0.031), (1.95, 0.3, 0.012), -s * 0.5)
for x0, x1, y0, y1 in ((YX1 - 0.3, YX1, YY0, QY), (YX0, YX0 + 0.3, YY0, -40.0)):              # kerbs
    aabb(H, CONCRETE, x0, x1, y0, y1, HARD, HARD + 0.17); colbox('car', x0, x1, y0, y1, HARD, HARD + 0.17)
for x, y, h, heads in ((-10.3, -80.0, 11.0, [(1, 0)]), (-10.3, -56.0, 11.0, [(1, 0)]), (17.5, -80.0, 11.0, [(-1, 0)]),
                       (17.5, -56.0, 11.0, [(-1, 0)]), (17.5, -34.0, 11.0, [(-1, 0)]), (-66.0, -40.0, 10.0, [(1, 0), (-1, 0)]),
                       (-66.0, -4.0, 10.0, [(1, 0), (-1, 0)]), (-66.0, 26.0, 10.0, [(1, 0), (-1, 0)])):
    mast(H, x, y, HARD, h, heads); colbox('solid', x - 0.2, x + 0.2, y - 0.2, y + 0.2, HARD, HARD + h)
# sandy gravel car park beside the hall: four rows of bays behind timber wheel stops. The bays stay empty in the GLB;
# PARKING lists them (x, y, heading) for the game and the review renders to fill with real car models.
PARKING = []
for xr, hd in ((-51.5, math.pi), (-57.5, 0.0), (-72.0, math.pi), (-78.0, 0.0)):
    y = -52.0
    while y < 15.0:
        if not (-8.0 < y < -1.0):
            xw = xr - (2.55 if hd == math.pi else -2.55)
            aabb(H, TIMBER_DARK, xw - 0.1, xw + 0.1, y - 0.9, y + 0.9, HARD, HARD + 0.15)
            PARKING.append((xr, round(y, 2), hd))
        y += 2.7
LANES = [(-9.0 + 3.3 * k + 1.65, -46.0 - 5.8 * j) for k in (1, 2, 3, 4, 5) for j in range(6)]   # queue slots, facing +y
colbox('car', -86.5, -46.0, -62.0, 34.0, HARD - 0.5, HARD)
# the check-in booth island with its boom gate (authored in the earlier yard frame, placed with XF)
XF = (1, 0, 0, 1, 8.4, -22.0, 0.0)
aabb(H, CONCRETE, -9.4, -7.4, -67.0, -61.0, HARD, HARD + 0.16)
for ya, yb2 in ((-67.01, -66.6), (-61.4, -60.99)): aabb(H, YELLOW, -9.41, -7.39, ya, yb2, HARD, HARD + 0.165)
# The booth: a toll-style check-in kiosk (as at Cape Jervis and Penneshaw), not a white box. Insulated panels over a
# stainless kick plate, aluminium framed glazing with mullions, a sliding service window to the lane on its own track
# with a deal tray and speech grille, a card reader on a swing arm, a cantilevered canopy over the lane edge with a lit
# soffit and fascia signs, a ticket printer on a pedestal before the window, an AC unit and a door at the back, yellow
# steel bollards, grime splashed up the panels and tyre scuffs on the kerb. Visual only: the island's car box is unchanged.
BGRIME = material('BoothGrime', (0.12, 0.115, 0.1), 0, 0.95)
BALU = material('BoothAlu', (0.62, 0.64, 0.66), 0.8, 0.35)
BSOFFIT = material('BoothSoffitLight', (1.0, 0.96, 0.88), 0, 0.3, 2.0)
I0 = HARD + 0.16
aabb(H, WHITE, -9.1, -7.7, -66.0, -63.0, I0 + 0.3, 4.3)                                          # insulated panel body
aabb(H, STAINLESS, -9.12, -7.68, -66.02, -62.98, I0, I0 + 0.3)                                   # kick plate
for zb in (I0 + 0.29, 4.26): aabb(H, NAVY, -9.115, -7.685, -66.015, -62.985, zb, zb + 0.05)      # plinth and sill bands
for yp in (-65.25, -64.5, -63.75): aabb(H, BGRIME, -7.702, -7.696, yp - 0.005, yp + 0.005, I0 + 0.34, 4.25)   # panel joints
for xp in (-8.4,): aabb(H, BGRIME, xp - 0.005, xp + 0.005, -66.004, -65.998, I0 + 0.34, 4.25)
aabb('Glazing', GLASS, -9.08, -7.72, -65.98, -63.02, 4.31, 5.62)
for cx in (-9.1, -7.7):
    for cy in (-66.0, -63.0): aabb(H, BALU, cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, I0, 5.72)   # corner posts
for zf in (4.3, 5.6): aabb(H, BALU, -9.13, -7.67, -66.03, -62.97, zf, zf + 0.06)                  # sill and head
for yp in (-65.0, -64.0):
    for xf in (-9.1, -7.7): aabb(H, BALU, xf - 0.035, xf + 0.035, yp - 0.03, yp + 0.03, 4.3, 5.62)  # mullions
for yf in (-66.0, -63.0): aabb(H, BALU, -8.43, -8.37, yf - 0.035, yf + 0.035, 4.3, 5.62)
for zt in (4.36, 5.2): aabb(H, BALU, -7.665, -7.625, -65.0, -63.95, zt, zt + 0.035)             # sliding window track
for y0_, y1_ in ((-64.97, -64.2), (-64.72, -63.98)):                                             # the two sashes
    xo = -7.66 if y0_ < -64.8 else -7.63
    for a0, a1, b0, b1 in ((y0_, y0_ + 0.035, 4.395, 5.2), (y1_ - 0.035, y1_, 4.395, 5.2), (y0_, y1_, 4.395, 4.43), (y0_, y1_, 5.165, 5.2)):
        aabb(H, BALU, xo, xo + 0.025, a0, a1, b0, b1)
aabb(H, STAINLESS, -7.63, -7.6, -64.26, -64.22, 4.7, 4.86)                                       # sash pull
cyl(H, BLACK, (-7.67, -64.6, 4.95), (-7.655, -64.6, 4.95), 0.065, 16)                             # speech grille
aabb(H, STAINLESS, -7.7, -7.45, -65.2, -64.0, 4.33, 4.37)                                          # deal tray
for yb_ in (-65.1, -64.1): beam(H, BALU, (-7.69, yb_, 4.05), (-7.47, yb_, 4.33), 0.03, 0.03)
beam(H, STAINLESS, (-7.68, -63.8, 4.5), (-7.48, -63.8, 4.5), 0.03, 0.03); box(H, BLACK, (-7.45, -63.8, 4.5), (0.07, 0.12, 0.19))   # card reader
aabb(H, SCREEN, -7.414, -7.41, -63.84, -63.76, 4.53, 4.58)
box(H, BLACK, (-8.3, -64.5, 4.62), (0.05, 0.5, 0.34)); aabb(H, SCREEN, -8.28, -8.27, -64.72, -64.28, 4.48, 4.76)
aabb(H, LAMINATE, -8.9, -7.75, -65.9, -63.1, 4.35, 4.38)
box(H, BLACK, (-7.95, -63.45, 4.45), (0.2, 0.24, 0.14)); aabb(H, WHITE, -7.86, -7.8, -63.5, -63.4, 4.43, 4.44)   # ticket printer
box(H, BLACK, (-8.6, -64.5, I0 + 0.5), (0.45, 0.45, 0.08)); cyl(H, STEEL, (-8.6, -64.5, I0), (-8.6, -64.5, I0 + 0.46), 0.03, 8)   # stool
# roof and canopy: out over the lane edge (x -6.05, clear of a car's mirrors), a lit soffit, fascias with the signs
aabb(H, ROOF, -9.5, -6.05, -66.6, -62.4, 5.74, 5.92)
aabb(H, WHITE, -7.7, -6.08, -66.57, -62.43, 5.715, 5.74)
aabb(H, BSOFFIT, -6.85, -6.45, -66.2, -62.8, 5.705, 5.715)
for x0_, x1_, y0_, y1_ in ((-6.08, -6.02, -66.63, -62.37), (-9.53, -9.47, -66.63, -62.37), (-9.53, -6.02, -66.63, -66.57), (-9.53, -6.02, -62.43, -62.37)):
    aabb(H, NAVY, x0_, x1_, y0_, y1_, 5.56, 5.95)
aabb(H, STEEL, -9.55, -6.0, -66.65, -62.35, 5.95, 5.97)                                             # drip edge
for yb_ in (-66.2, -62.8): beam(H, STEEL, (-7.66, yb_, 5.25), (-6.12, yb_, 5.7), 0.07, 0.07)      # cantilever brackets
aabb(H, SUN, -6.017, -6.012, -66.6, -62.4, 5.6, 5.63)
text(H, 'CHECK-IN', (-6.012, -65.2, 5.8), 0.2, WHITE, FACE_POS_X, FONT_B, 0.02)
text(H, 'LANE 1', (-6.012, -63.3, 5.8), 0.16, SUN, FACE_POS_X, FONT_B, 0.02)
text(H, 'CHECK-IN', (-7.8, -66.64, 5.8), 0.2, WHITE, FACE_NEG_Y, FONT_B, 0.02)
cyl(H, BLACK, (-6.3, -66.35, 5.7), (-6.3, -66.35, 5.62), 0.06, 12)                                 # CCTV dome
# back: a door with a vision panel, an AC unit under the eave with its drip stain
aabb(H, WHITE, -9.13, -9.105, -63.95, -63.1, I0 + 0.02, 4.28); aabb(H, BALU, -9.14, -9.125, -63.98, -63.07, I0, 4.3)
aabb(H, STAINLESS, -9.16, -9.13, -63.3, -63.18, 3.75, 3.79)
box(H, WHITE, (-9.3, -64.9, 5.3), (0.28, 0.8, 0.5)); aabb(H, BLACK, -9.445, -9.44, -65.2, -64.6, 5.1, 5.5)
aabb(H, BGRIME, -9.112, -9.108, -65.0, -64.8, I0 + 0.3, 5.0)
# grime splashed up the lane face over the kick plate, tyre scuffs on the kerb nose, a rust run under the tray
for k, (ya, yb, hh) in enumerate(((-65.95, -65.3, 0.18), (-65.1, -64.4, 0.1), (-64.2, -63.6, 0.22), (-63.5, -63.05, 0.13))):
    aabb(H, BGRIME, -7.692, -7.688, ya, yb, I0 + 0.3, I0 + 0.3 + hh)
aabb(H, BGRIME, -7.405, -7.396, -66.8, -61.3, HARD + 0.02, HARD + 0.1)
aabb(H, RED, -7.69, -7.686, -64.7, -64.66, 3.95, 4.25)
# yellow steel bollards on the island's corners: reflective bands, domed caps, scuffed feet
for bx, by in ((-7.62, -66.75), (-9.18, -66.75), (-7.62, -62.3), (-9.18, -61.3)):
    cyl(H, YELLOW, (bx, by, I0), (bx, by, I0 + 1.0), 0.085, 14)
    cyl(H, YELLOW, (bx, by, I0 + 1.0), (bx, by, I0 + 1.04), 0.085, 14, r1=0.05)
    for zb in (I0 + 0.72, I0 + 0.84): cyl(H, BLACK, (bx, by, zb), (bx, by, zb + 0.05), 0.087, 14)
    cyl(H, BGRIME, (bx, by, I0), (bx, by, I0 + 0.16), 0.087, 14)
# the ticket pedestal on the island nose, ahead of the window: printer, screen, intercom, help button
cyl(H, STEEL, (-7.58, -65.75, I0), (-7.58, -65.75, 4.2), 0.05, 12)
box(H, NAVY, (-7.56, -65.75, 4.42), (0.2, 0.34, 0.5)); aabb(H, NAVY, -7.68, -7.42, -65.95, -65.55, 4.67, 4.7)
aabb(H, SCREEN, -7.461, -7.456, -65.86, -65.64, 4.5, 4.64); aabb(H, BLACK, -7.461, -7.45, -65.83, -65.67, 4.29, 4.32)
aabb(H, WHITE, -7.452, -7.43, -65.78, -65.72, 4.285, 4.3); aabb(H, BLACK, -7.461, -7.456, -65.9, -65.8, 4.36, 4.44)
cyl(H, YELLOW, (-7.46, -65.61, 4.4), (-7.445, -65.61, 4.4), 0.022, 10)
colbox('car', -9.4, -7.4, -67.0, -61.0, HARD, 5.9)
aabb(H, WHITE, -7.9, -7.5, -61.95, -61.4, HARD + 0.16, 4.45); aabb(H, RED, -7.91, -7.49, -61.96, -61.39, 4.05, 4.12)
BG = 'P:BoomGate'
for k in range(9):
    xa = -7.45 + k * 0.5; aabb(BG, RED if k % 2 == 0 else WHITE, xa, min(xa + 0.5, -3.1), -61.73, -61.62, 4.2, 4.3)
aabb(BG, STEEL, -7.55, -7.4, -61.8, -61.55, 4.1, 4.4)
cyl(H, STEEL, (-2.95, -61.675, HARD), (-2.95, -61.675, 4.12), 0.05, 8); aabb(H, YELLOW, -3.05, -2.85, -61.8, -61.55, 4.12, 4.18)
colbox('car', -3.0, -2.9, -61.73, -61.62, HARD, 4.18)
for xp_ in (-12.3, -9.7): cyl(H, GALV, (xp_, -67.5, HARD), (xp_, -67.5, 5.8), 0.06, 10)
aabb(H, NAVY, -12.5, -9.5, -67.56, -67.44, 4.6, 5.8)
text(H, 'TIDEWATER FERRIES', (-11.0, -67.575, 5.42), 0.24, WHITE, FACE_NEG_Y, FONT_BI, 0.006)
text(H, 'VEHICLE CHECK-IN', (-11.0, -67.575, 4.95), 0.2, SUN, FACE_NEG_Y, FONT_B, 0.006)
BOOM_HINGE = xfp((-7.5, -61.675, 4.25))
XF = None
# linkspan barrier: a red and white boom across the land end of the linkspan, 1 m behind the quay hinge line, closed
# while her ramp is up. Drive cabinet on the starboard side of the lane, a fork rest post beyond the port edge. The arm
# (pivot LinkspanBarrier, hinge axis along +y) is authored closed; its car-solid box is exported apart, in 'barriers'.
LB = 'P:LinkspanBarrier'
LBY, LBZ, LBX = QY - 1.0, HARD + 0.95, 5.75          # cabinet centre line, hinge height, cabinet centre x
LA = LBY - 0.24                                      # the arm's plane, on the cabinet's land-side face
aabb(H, STEEL, LBX - 0.22, LBX + 0.22, LBY - 0.2, LBY + 0.2, HARD, HARD + 0.05)                    # base plate
aabb(H, WHITE, LBX - 0.16, LBX + 0.16, LBY - 0.16, LBY + 0.16, HARD + 0.05, HARD + 1.12)           # drive cabinet
aabb(H, RED, LBX - 0.17, LBX + 0.17, LBY - 0.17, LBY + 0.17, HARD + 1.12, HARD + 1.17)             # cap
aabb(H, RED, LBX - 0.165, LBX + 0.165, LBY - 0.165, LBY + 0.165, HARD + 0.62, HARD + 0.68)         # reflective band
aabb(H, BLACK, LBX - 0.1, LBX + 0.1, LBY + 0.16, LBY + 0.165, HARD + 0.3, HARD + 0.55)            # service door
cyl(LB, GALV, (LBX, LBY - 0.17, LBZ), (LBX, LBY - 0.31, LBZ), 0.085, 16)                          # hub
aabb(LB, STEEL, LBX - 0.08, LBX + 0.45, LA - 0.05, LA + 0.05, LBZ - 0.06, LBZ + 0.06)              # counterweight stub
xa, k = LBX - 0.08, 0
while xa > -5.62:
    xb = max(xa - 0.55, -5.62)
    aabb(LB, RED if k % 2 == 0 else WHITE, xb, xa, LA - 0.035, LA + 0.035, LBZ - 0.05, LBZ + 0.05); xa, k = xb, k + 1
aabb(LB, BLACK, -5.66, -5.62, LA - 0.04, LA + 0.04, LBZ - 0.055, LBZ + 0.055)                      # rubber end cap
cyl(H, GALV, (-5.45, LA, HARD), (-5.45, LA, LBZ - 0.12), 0.04, 10)                                  # fork rest post
aabb(H, YELLOW, -5.5, -5.4, LA - 0.07, LA + 0.07, LBZ - 0.12, LBZ - 0.06)
for dy in (-0.06, 0.06): aabb(H, YELLOW, -5.5, -5.4, LA + dy - 0.012, LA + dy + 0.012, LBZ - 0.06, LBZ + 0.08)
colbox('car', LBX - 0.17, LBX + 0.17, LBY - 0.17, LBY + 0.17, HARD, HARD + 1.17)
colbox('solid', -5.5, -5.4, LA - 0.07, LA + 0.07, HARD, LBZ + 0.08)
LB_HINGE = (LBX, LA, LBZ)
BARRIERS = [('LinkspanBarrier', (-5.45 + LBX) / 2, LA, HARD + 0.65, (LBX + 5.45) / 2, 0.3, 0.65)]   # closed: car-solid across the lane
station('CarQueue', (-9.0 + 3.3 * 2 + 1.65, -78.0, HARD))
# the road out of the yard's back gate to the flat's back edge, where the island road arrives off the headland's
# west shore (ROAD_END); grass verges clear of the road and the revetments
RDP = [(3.2, -92.0), (2.4, -96.0), (-1.5, -99.8), (-8.0, -101.2), (-40.0, -101.2), (-49.0, -102.5), (-55.0, -107.0), (-55.0, -116.2)]
RD = spline(RDP, 1.5)
RN = []                                                   # one shared side vector per centreline point, so the
for i in range(len(RD)):                                  # quads meet edge to edge round the bends (no overlap seams)
    t = (RD[min(i + 1, len(RD) - 1)] - RD[max(i - 1, 0)]).normalized(); RN.append(Vector((t.y, -t.x, 0)))
for i in range(len(RD) - 1):
    a, b, n, n2 = RD[i], RD[i + 1], RN[i], RN[i + 1]
    quad(H, ASPHALT, [a + n * 3.8 + Vector((0, 0, HARD + 0.025)), b + n2 * 3.8 + Vector((0, 0, HARD + 0.025)),
                      b - n2 * 3.8 + Vector((0, 0, HARD + 0.025)), a - n * 3.8 + Vector((0, 0, HARD + 0.025))][::-1])
    for off in (3.45, -3.45): beam(H, LINE_W, a + n * off + Vector((0, 0, ZL - 0.006)), b + n2 * off + Vector((0, 0, ZL - 0.006)), 0.1, 0.012)
    if i % 4 < 2: beam(H, LINE_W, a + Vector((0, 0, ZL - 0.006)), b + Vector((0, 0, ZL - 0.006)), 0.1, 0.012)
ROAD_END, ROAD_IN = RD[-1], (Vector((*RDP[-2], 0)) - Vector((*RDP[-1], 0))).normalized()   # entry, and the way a car faces in
def road_side(sgn, w=4.8):
    out = []
    for i in range(len(RD)):
        t = (RD[min(i + 1, len(RD) - 1)] - RD[max(i - 1, 0)]).normalized(); q = RD[i] + Vector((t.y, -t.x, 0)) * sgn * w
        out.append((round(q.x, 2), round(q.y, 2)))
    return out
south = [(x, max(y, -108.8)) for x, y in road_side(-1) if y < -94.0]
north = [(x, max(y, -115.6)) for x, y in road_side(1) if x < -45.0]
def _h(i, j, k=0.0):
    v = math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
    return v - math.floor(v)
def _vn(x, y, s):
    """Smooth value noise in 0..1 with cells of s metres."""
    gx, gy = x / s, y / s; i, j = math.floor(gx), math.floor(gy); fx, fy = gx - i, gy - j
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = _h(i, j), _h(i + 1, j), _h(i, j + 1), _h(i + 1, j + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
def _edge_d(x, y, pts):
    best = 1e9
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        dx, dy = x1 - x0, y1 - y0; t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy or 1e-9)))
        best = min(best, math.hypot(x - x0 - t * dx, y - y0 - t * dy))
    return best
def _seg_d(x, y, pts):
    return min(_edge_d(x, y, [a, b]) for a, b in zip(pts, pts[1:]))
def _sat(v): return max(0.0, min(1.0, v))

# ---- 8b. the flat's ground: one sheet on a 2 m grid at HARD, cut out under the yard and road asphalt and the forecourt
# paving (they sat 2 to 2.5 cm over a full sheet and z-fought it). Small cells keep Joey's village cut (src/joey/Village.js
# clearVerge) working. The vertex colour carries the masks the game's ground shader reads (src/ferry/TerminalPaint.js):
# r grass (the verges, with a soft ragged edge), g traffic (the hall car park and the yard's spill), b weedy fringe (fences, crest).
KERB = material('KerbConcrete', (0.5, 0.49, 0.46), 0.0, 0.88)
IRON = material('GrateIron', (0.05, 0.05, 0.048), 0.55, 0.6)
TUFT = material('VergeTuft', (0.3, 0.27, 0.13), 0.0, 0.85)
WEED = material('VergeWeed', (0.11, 0.16, 0.055), 0.0, 0.85)
BIN = material('BinGreen', (0.03, 0.16, 0.07), 0.0, 0.55)
SALTBUSH = material('Saltbush', (0.2, 0.23, 0.17), 0.0, 0.9)
lr = random.Random(4242)
VERGES = [[(34.6, -13.8), (22.0, -16.0), (22.0, -94.0)] + south + [(34.6, -108.8)],
          [(-45.0, -64.0), (-85.6, -64.0), (-86.4, -80.5), (-95.3, -96.4), (-93.6, -107.6), (-87.4, -115.6), (-70.0, -117.4),
           (-60.0, -115.6)] + north[::-1],
          [(-50.0, 20.0), (-83.5, 20.0), (-83.5, 38.3), (-50.0, 35.3)]]
FENCES = [[(-10.5, -93.0), (-1.4, -93.0)], [(7.6, -93.0), (18.8, -93.0), (18.8, -31.6)]]
YARD = [(YX0, YY0), (YX1, YY0), (YX1, QY), (YX0, QY)]
FORECOURT = [(-47.0, -40.0), (-10.8, -40.0), (-10.8, QY), (-17.2, QY), (-17.6, -22.0), (-19.4, 12.0), (-19.9, 14.5), (-47.0, 14.5)]
def ground_mask(x, y):
    g = 0.0
    for P in VERGES:
        d = _edge_d(x, y, P) * (1.0 if in_land(x, y, P) else -1.0)
        g = max(g, _sat((d + 0.8) / 3.2))
    cx, cy = max(-86.5 - x, 0.0, x + 46.0), max(-62.0 - y, 0.0, y - 34.0)
    t = max(_sat(1.0 - math.hypot(cx, cy) / 3.5), 0.5 * _sat(1.0 - _edge_d(x, y, YARD) / 2.5))
    f = max(_sat(1.0 - min(_seg_d(x, y, F) for F in FENCES) / 1.6), 0.8 * _sat(1.0 - _seg_d(x, y, EDGE) / 3.0))
    return (round(g * (1.0 - t), 3), round(t, 3), round(f, 3))
def _clip(poly, a, b, left=True):
    out, n = [], len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        sp = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); sq = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
        if not left: sp, sq = -sp, -sq
        if sp >= 0: out.append(p)
        if (sp >= 0) != (sq >= 0):
            t = sp / (sp - sq); out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out
def _area(poly): return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))
def _ccw(poly): return list(poly) if _area(poly) > 0 else list(poly)[::-1]
def _minus(piece, hole):
    """A convex piece minus a convex counter-clockwise hole, as convex pieces."""
    out, rem = [], piece
    for a, b in zip(hole, hole[1:] + hole[:1]):
        o = _clip(rem, a, b, False)
        if len(o) >= 3 and _area(o) > 1e-5: out.append(o)
        rem = _clip(rem, a, b, True)
        if len(rem) < 3 or _area(rem) < 1e-5: return out
    return out
def _tris(pts): return [[pts[a], pts[b], pts[c]] for a, b, c in geometry.tessellate_polygon([[Vector((x, y, 0.0)) for x, y in pts]])]
PAVED = [_ccw(YARD)] + [_ccw(t) for t in _tris(FORECOURT)]
for i in range(len(RD) - 1):
    a, b, n, n2 = RD[i], RD[i + 1], RN[i], RN[i + 1]
    PAVED.append(_ccw([(p.x, p.y) for p in (a + n * 3.8, b + n2 * 3.8, b - n2 * 3.8, a - n * 3.8)]))
PBOX = [(min(p[0] for p in P), max(p[0] for p in P), min(p[1] for p in P), max(p[1] for p in P)) for P in PAVED]
def paved(x, y):
    for P, (x0, x1, y0, y1) in zip(PAVED, PBOX):
        if x0 <= x <= x1 and y0 <= y <= y1 and all((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0 for a, b in zip(P, P[1:] + P[:1])): return True
    return False
CELL = 2.0
GV, GF, GC, GIX = [], [], [], {}
def _gv(x, y):
    k = (round(x, 3), round(y, 3))
    if k not in GIX: GIX[k] = len(GV); GV.append((k[0], k[1], HARD)); GC.append(ground_mask(*k))
    return GIX[k]
for tri in _tris(LANDPOLY):
    tri = _ccw(tri); xs, ys = [p[0] for p in tri], [p[1] for p in tri]
    for i in range(math.floor(min(xs) / CELL), math.ceil(max(xs) / CELL)):
        for j in range(math.floor(min(ys) / CELL), math.ceil(max(ys) / CELL)):
            x0, y0 = i * CELL, j * CELL
            pc = [(x0, y0), (x0 + CELL, y0), (x0 + CELL, y0 + CELL), (x0, y0 + CELL)]
            for a, b in zip(tri, tri[1:] + tri[:1]):
                pc = _clip(pc, a, b)
                if len(pc) < 3: break
            if len(pc) < 3 or _area(pc) < 1e-5: continue
            pieces = [pc]
            for P, (bx0, bx1, by0, by1) in zip(PAVED, PBOX):
                if bx1 < x0 or bx0 > x0 + CELL or by1 < y0 or by0 > y0 + CELL: continue
                pieces = [q for p_ in pieces for q in _minus(p_, P)]
                if not pieces: break
            for p_ in pieces:
                ids = [_gv(*p) for p in p_]
                for k in range(1, len(ids) - 1):
                    if len({ids[0], ids[k], ids[k + 1]}) == 3: GF.append((ids[0], ids[k], ids[k + 1]))
_gobj = mesh('Ground SandyGravel', GV, GF, GROUND, group='GroundSheet', smooth=False)
_gcol = _gobj.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); _flat = []
for c in GC: _flat.extend((*c, 1.0))
_gcol.data.foreach_set('color', _flat); _gobj.data.color_attributes.active_color = _gcol
print(f'TERMINAL ground sheet {len(GV)} vertices {len(GF)} triangles, {len(PAVED)} paved cut-outs')

# concrete edge strips where the asphalt and the forecourt paving meet the gravel
for i in range(len(RD) - 1):
    a, b, n, n2 = RD[i], RD[i + 1], RN[i], RN[i + 1]
    for sg in (1, -1): beam(H, KERB, a + n * sg * 3.92 + Vector((0, 0, HARD)), b + n2 * sg * 3.92 + Vector((0, 0, HARD)), 0.24, 0.1)
for x0, x1 in ((YX0, -0.84), (7.24, YX1)): aabb(H, KERB, x0, x1, YY0 - 0.24, YY0, HARD - 0.05, HARD + 0.05)
for x0, x1, y0, y1 in ((-47.0, -10.8, -40.24, -40.0), (-47.24, -47.0, -40.24, 14.74), (-47.0, -19.9, 14.5, 14.74)):
    aabb(H, KERB, x0, x1, y0, y1, HARD - 0.05, HARD + 0.045)
# drainage: gully grates by the yard's kerbs and a slot drain across the back gate
def grate(x, y, w, l, bars):
    aabb(H, BLACK, x - w / 2, x + w / 2, y - l / 2, y + l / 2, HARD + 0.02, HARD + 0.033)
    for x0, x1, y0, y1 in ((x - w / 2, x + w / 2, y - l / 2, y - l / 2 + 0.04), (x - w / 2, x + w / 2, y + l / 2 - 0.04, y + l / 2),
                           (x - w / 2, x - w / 2 + 0.04, y - l / 2, y + l / 2), (x + w / 2 - 0.04, x + w / 2, y - l / 2, y + l / 2)):
        aabb(H, IRON, x0, x1, y0, y1, HARD + 0.02, HARD + 0.045)
    for k in range(1, bars):
        u = x - w / 2 + k * w / bars; aabb(H, IRON, u - 0.012, u + 0.012, y - l / 2, y + l / 2, HARD + 0.02, HARD + 0.043)
for gx in (17.25, -10.05):
    for gy in (-88.0, -68.0, -46.0): grate(gx, gy, 0.45, 0.9, 8)
xg = YX0 + 0.5
while xg < YX1 - 1.4:
    grate(xg + 0.5, -91.0, 1.0, 0.26, 12); xg += 1.02
def tuft(mat, x, y, hmax):
    for k in range(lr.randint(12, 18)):                                   # many thin blades, not a rosette
        ang = lr.uniform(0, math.tau); h = hmax * lr.uniform(0.45, 1.0); lean = lr.uniform(0.15, 0.55) * h; w = lr.uniform(0.007, 0.014)
        bx, by = x + math.cos(ang) * lr.uniform(0, 0.07), y + math.sin(ang) * lr.uniform(0, 0.07); px, py = -math.sin(ang) * w, math.cos(ang) * w
        add('Verge', mat, [(bx - px, by - py, HARD - 0.01), (bx + px, by + py, HARD - 0.01), (bx + math.cos(ang) * lean, by + math.sin(ang) * lean, HARD + h)], [(0, 1, 2)])
# palisade security fence behind the yard and down its east side, weeds along its foot
def spike(p, d, nrm, z0, z1, w0=0.065, w1=0.012, t=0.022):
    add('Site', GALV, [p + d * sx * (w0 if z == z0 else w1) / 2 + nrm * sy * t / 2 + Vector((0, 0, z)) for z in (z0, z1)
                       for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))], HEX)
for F in FENCES:
    for (x0, y0), (x1, y1) in zip(F, F[1:]):
        a, b = Vector((x0, y0, 0)), Vector((x1, y1, 0)); d = b - a; L = d.length; d.normalize(); nrm = Vector((-d.y, d.x, 0)); rz = math.atan2(d.y, d.x)
        npost = max(1, round(L / 2.75))
        for k in range(npost + 1):
            p = a + d * (L * k / npost)
            box('Site', GALV, (p.x, p.y, HARD + 1.12), (0.075, 0.075, 2.24), rz); box('Site', CONCRETE, (p.x, p.y, HARD + 0.03), (0.3, 0.3, 0.1), rz)
        for z in (HARD + 0.35, HARD + 1.85): beam('Site', GALV, a + nrm * 0.05 + Vector((0, 0, z)), b + nrm * 0.05 + Vector((0, 0, z)), 0.05, 0.05)
        npale = int(L / 0.2)
        for k in range(npale):
            p = a + d * ((k + 0.5) * L / npale) + nrm * 0.09
            box('Site', GALV, (p.x, p.y, HARD + 1.12), (0.065, 0.022, 2.0), rz); spike(p, d, nrm, HARD + 2.12, HARD + 2.24)
        u = 0.2
        while u < L:
            if lr.random() < 0.7:
                p = a + d * u + nrm * (lr.choice((-1, 1)) * lr.uniform(0.1, 0.6))
                if not paved(p.x, p.y): tuft(WEED, p.x, p.y, lr.uniform(0.25, 0.5))
            u += 0.45
for gp in ((-1.4, -93.0), (7.6, -93.0)): box('Site', GALV, (gp[0], gp[1], HARD + 1.2), (0.15, 0.15, 2.4))      # gate posts at the road
# grass tufts scattered over the verges (icosphere saltbushes read as boulders, so none); weeds along the revetment crest
NT = 0
for P in VERGES:
    xs, ys = [p[0] for p in P], [p[1] for p in P]
    x = min(xs)
    while x < max(xs):
        y = min(ys)
        while y < max(ys):
            px_, py_ = x + lr.uniform(-0.5, 0.5), y + lr.uniform(-0.5, 0.5); r_ = lr.random()
            if in_land(px_, py_, P) and in_land(px_, py_) and not paved(px_, py_):
                g = ground_mask(px_, py_)[0]
                if g > 0.55 and r_ < 0.4: tuft(TUFT, px_, py_, lr.uniform(0.28, 0.55)); NT += 1
            y += 1.1
        x += 1.1
for (x0, y0), (x1, y1) in zip(EDGE, EDGE[1:]):
    a, b = Vector((x0, y0, 0)), Vector((x1, y1, 0)); L = (b - a).length; d = (b - a).normalized(); nl = Vector((-d.y, d.x, 0))
    u = 1.0
    while u < L - 1.0:
        p = a + d * u + nl * lr.uniform(0.8, 2.6)
        if lr.random() < 0.4 and in_land(p.x, p.y) and not paved(p.x, p.y): tuft(WEED, p.x, p.y, lr.uniform(0.2, 0.42))
        u += 2.0
print(f'TERMINAL verge tufts {NT}')
# site furniture: bollards by the shed and the check-in island, wheelie bins at the shed, signs
def post_bollard(x, y, z):
    cyl('Site', YELLOW, (x, y, z), (x, y, z + 1.0), 0.07, 14); cyl('Site', YELLOW, (x, y, z + 1.0), (x, y, z + 1.04), 0.074, 14, 0.05)
    cyl('Site', BLACK, (x, y, z + 0.78), (x, y, z + 0.86), 0.072, 14)
for bx_, by_ in ((10.4, -30.75), (18.45, -30.75), (10.35, -22.2), (18.65, -22.2)): post_bollard(bx_, by_, HARD)
post_bollard(0.0, -88.75, HARD + 0.16)
def wheelie_bin(x, y, lid):
    z = HARD + 0.025
    hexa('Site', BIN, [(x - 0.25, y - 0.3, z + 0.05), (x + 0.25, y - 0.3, z + 0.05), (x + 0.25, y + 0.3, z + 0.05), (x - 0.25, y + 0.3, z + 0.05),
                       (x - 0.29, y - 0.36, z + 0.98), (x + 0.29, y - 0.36, z + 0.98), (x + 0.29, y + 0.34, z + 0.98), (x - 0.29, y + 0.34, z + 0.98)])
    aabb('Site', lid, x - 0.3, x + 0.3, y - 0.39, y + 0.38, z + 0.98, z + 1.04)
    cyl('Site', BIN, (x - 0.24, y + 0.38, z + 0.95), (x + 0.24, y + 0.38, z + 0.95), 0.02, 8)
    for sx in (-1, 1): cyl('Site', RUBBER, (x + sx * 0.3, y + 0.3, z + 0.1), (x + sx * 0.24, y + 0.3, z + 0.1), 0.1, 12)
wheelie_bin(14.05, -30.9, YELLOW); wheelie_bin(14.75, -30.9, RED)
cyl('Site', GALV, (8.3, -93.35, HARD), (8.3, -93.35, HARD + 2.4), 0.03, 8)          # 10 km/h at the back gate
aabb('Site', WHITE, 8.02, 8.58, -93.41, -93.39, HARD + 1.8, HARD + 2.38)
annulus('Site', RED, (8.3, -93.41, HARD + 2.12), (0, -1, 0), 0.17, 0.23, 0.004, 28)
text('Site', '10', (8.3, -93.416, HARD + 2.12), 0.2, BLACK, FACE_NEG_Y, FONT_B, 0.004)
text('Site', 'FERRY YARD', (8.3, -93.416, HARD + 1.87), 0.07, BLACK, FACE_NEG_Y, FONT_B, 0.004)
for (sx_, sy_, face) in ((-6.0, -93.06, 'ny'), (18.86, -60.0, 'px')):                 # security signs on the fence
    if face == 'ny':
        aabb('Site', WHITE, sx_ - 0.36, sx_ + 0.36, sy_ - 0.012, sy_, HARD + 1.2, HARD + 1.68); aabb('Site', RED, sx_ - 0.36, sx_ + 0.36, sy_ - 0.016, sy_ - 0.012, HARD + 1.54, HARD + 1.68)
        for body, z, sz, m_ in (('TIDEWATER FERRIES', 1.61, 0.055, WHITE), ('NO UNAUTHORISED', 1.43, 0.06, BLACK), ('ACCESS', 1.31, 0.06, BLACK)):
            text('Site', body, (sx_, sy_ - 0.02, HARD + z), sz, m_, FACE_NEG_Y, FONT_B, 0.003)
    else:
        aabb('Site', WHITE, sx_, sx_ + 0.012, sy_ - 0.36, sy_ + 0.36, HARD + 1.2, HARD + 1.68); aabb('Site', RED, sx_ + 0.012, sx_ + 0.016, sy_ - 0.36, sy_ + 0.36, HARD + 1.54, HARD + 1.68)
        for body, z, sz, m_ in (('TIDEWATER FERRIES', 1.61, 0.055, WHITE), ('NO UNAUTHORISED', 1.43, 0.06, BLACK), ('ACCESS', 1.31, 0.06, BLACK)):
            text('Site', body, (sx_ + 0.02, sy_, HARD + z), sz, m_, FACE_POS_X, FONT_B, 0.003)
# Colliders for the site furniture ('solid': cars and walkers both stop). The road mouth between the gate posts
# (x -1.4 .. 7.6 at y -93) stays open, the fence boxes stop short of the yard paving (y -92) and its east edge (x 18),
# and the shed bollards leave the apron between them (x 10.5 .. 18.3) clear.
for F in FENCES:
    for (x0, y0), (x1, y1) in zip(F, F[1:]):
        colbox('solid', min(x0, x1) - 0.15, max(x0, x1) + 0.15, min(y0, y1) - 0.15, max(y0, y1) + 0.15, HARD, HARD + 2.24)
for bx_, by_, bz_ in ((10.4, -30.75, HARD), (18.45, -30.75, HARD), (10.35, -22.2, HARD), (18.65, -22.2, HARD), (0.0, -88.75, HARD + 0.16)):
    colbox('solid', bx_ - 0.09, bx_ + 0.09, by_ - 0.09, by_ + 0.09, bz_, bz_ + 1.04)
colbox('solid', 13.74, 15.06, -31.3, -30.5, HARD, HARD + 1.07)                       # the two wheelie bins
colbox('solid', 8.24, 8.36, -93.41, -93.29, HARD, HARD + 2.38)                       # the 10 km/h sign's pole
colbox('solid', 8.02, 8.58, -93.43, -93.37, HARD + 1.8, HARD + 2.38)                 # and its plate

# ---- 9. stations, pivots, export ---------------------------------------------------------
station('BuildingDoor', (-29.0, -6.8, FLOOR)); station('LinkspanTop', (0.0, QY - 1.5, HARD))
flush()
root = bpy.data.objects.new('TidewaterTerminal', None); bpy.context.collection.objects.link(root)
HINGES = {'LinkspanDeck': ((0.0, QY, HARD), 'x'), 'GangwayEnd': ((-11.12, 9.7, WALK), 'z'), 'BoomGate': (BOOM_HINGE, 'y'),
          'LinkspanBarrier': (LB_HINGE, 'y')}
pivots = {}
for name, (loc, _) in HINGES.items():
    parts = [o for o in groups.pop(f'P:{name}', []) if o and o.name in bpy.data.objects]
    pivots[name] = pivot(name, loc, parts)
pivots['LinkspanBarrier'].rotation_euler.y = math.radians(85)     # rests raised (open) until the game closes it
for name, objects in list(groups.items()):
    objects = [o for o in objects if o and o.name in bpy.data.objects]
    if not objects: continue
    joined = join_group(f'Terminal {name}', objects); joined.parent = root
for node in [*pivots.values(), *stations.values()]: node.parent = root
root.rotation_euler.z = math.pi     # terminal +Y (out to sea) becomes glTF +Z, like the ferry
bpy.ops.object.select_all(action='DESELECT')
for obj in [root] + list(root.children_recursive): obj.select_set(True)
bpy.context.view_layer.objects.active = root
_GL = dict(filepath=str(ROOT / 'public/ferry/terminal.glb'), export_format='GLB', use_selection=True, export_apply=True,
           export_yup=True, export_extras=True)
try: bpy.ops.export_scene.gltf(**_GL, export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True)   # the ground's masks
except TypeError: bpy.ops.export_scene.gltf(**_GL, export_colors=True)     # older exporters
# ---- 10. site data: the terrain edits and parking slots the game applies around the GLB -----------------------
# In this frame for the .blend (terminal_render.py builds the render context land from it) and in the glTF frame
# (X = -x, Z = y) for src/ferry/terminalSite.js below.
def grow(pts, m):
    """Grow a counter-clockwise polygon by m, mitred corners capped at 2.5 m."""
    out = []
    for j in range(len(pts)):
        p0, p1, p2 = (Vector((*pts[k % len(pts)], 0)) for k in (j - 1, j, j + 1))
        n0 = Vector(((p1 - p0).normalized().y, -(p1 - p0).normalized().x, 0)); n1 = Vector(((p2 - p1).normalized().y, -(p2 - p1).normalized().x, 0))
        b = (n0 + n1).normalized(); q = p1 + b * min(m / max(b.dot(n0), 0.4), 2.5 * m)
        out.append((round(q.x, 2), round(q.y, 2)))
    return out
assert sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(LANDPOLY, LANDPOLY[1:] + LANDPOLY[:1])) > 0
BERTH = [(-17.0, -27.9), (6.8, -27.9), (7.6, -22.4), (3.5, -14.5), (12.0, -6.0), (12.0, 62.0), (-9.6, 62.0), (-9.6, 14.0),
         (-19.0, 11.4), (-17.4, -22.0)]        # the linkspan pit and the ferry's berth, off the seawall faces
COVE = [(-24.0, 60.0), (-80.0, 62.0), (-92.0, 84.0), (-99.0, 106.0), (-98.0, 124.0), (-88.0, 132.0), (-70.0, 134.0),
        (-50.0, 128.0), (-30.0, 100.0), (-22.0, 76.0)]      # inside the hook, 17 m or more off its centreline
SITE = {'fill': [{'poly': LANDPOLY, 'height': 3.1, 'slope': 6.5}],
        'dredge': [{'poly': BERTH, 'depth': -5.5, 'blend': 2}, {'poly': COVE, 'depth': -4.0, 'blend': 8}],
        'ridges': [{'line': [(round(p.x, 1), round(p.y, 1)) for p in BWC[::6] + [BWC[-1]]], 'crest': 2.4, 'halfWidth': 2.8, 'slope': 1.5}],
        'clear': [{'poly': grow(LANDPOLY, 6.0)}],
        'roadEntry': {'point': (round(ROAD_END.x, 2), round(ROAD_END.y, 2)), 'height': HARD, 'dir': (round(ROAD_IN.x, 4), round(ROAD_IN.y, 4))},
        'parking': PARKING, 'lanes': LANES, 'bw': BW}
bpy.context.scene['tw_site'] = json.dumps(SITE)      # set after the glTF export, so it stays out of the GLB's extras
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/ferry/terminal.blend'))
# Colliders in the glTF frame: model (x, y, z) -> game (-x, z, y); half extents (hx, hy, hz) -> (hx, hz, hy).
g3 = lambda p: [round(-p[0], 3), round(p[2], 3), round(p[1], 3)]
out = {'frame': 'terminal local, metres: +Z out to sea (docked ferry bow), +Y up, origin = ferry stern-ramp hinge line at sea level',
       'boxes': [{'kind': k, 'center': g3(c), 'half': [round(h[0], 3), round(h[2], 3), round(h[1], 3)]} for k, c, h in COLLIDERS],
       'stations': {n: g3(p.location) for n, p in stations.items()},
       'pivots': {n: {'hinge': g3(loc), 'axis': {'x': 'x', 'y': 'z', 'z': 'y'}[ax]} for n, (loc, ax) in HINGES.items()},
       'barriers': [{'name': n, 'kind': 'barrier', 'pivot': n, 'center': g3((cx, cy, cz)), 'half': [round(hx, 3), round(hz, 3), round(hy, 3)]}
                    for n, cx, cy, cz, hx, hy, hz in BARRIERS]}
(ROOT / 'public/ferry/terminal_colliders.json').write_text(json.dumps(out, indent=1))
kinds = {}
for k, _, _ in COLLIDERS: kinds[k] = kinds.get(k, 0) + 1
print(f'TERMINAL colliders {len(COLLIDERS)} {kinds}')
steps = [abs(a - b) for a, b in zip([HARD + 0.025] + LS_TOPS, LS_TOPS + [LAND])]
print(f'TERMINAL linkspan car boxes {NLS}: max step {max(steps[1:-1]) * 100:.2f} cm between boxes, yard joint {steps[0] * 100:.2f} cm, plate joint {steps[-1] * 100:.2f} cm')
print(f'TERMINAL barriers {out["barriers"]} pivot {out["pivots"]["LinkspanBarrier"]}')
print(f'TERMINAL lettering {len(TEXT_STATS)} texts, slivers dropped {sum(a - b for _, a, b, _ in TEXT_STATS)}, faces turned outward {sum(t for *_, t in TEXT_STATS)}')
print(f'TERMINAL triangles {sum(len(p.vertices) - 2 for o in root.children_recursive if o.type == "MESH" for p in o.data.polygons)}')
tris = sum(len(p.vertices) - 2 for o in root.children_recursive if o.type == 'MESH' for p in o.data.polygons)
mats = {m.name for o in root.children_recursive if o.type == 'MESH' for m in o.data.materials}
print('TERMINAL group triangles', {o.name: sum(len(q.vertices) - 2 for q in o.data.polygons) for o in root.children_recursive if o.type == 'MESH'})
print(f'TERMINAL triangles {tris} materials {len(mats)} meshes {sum(1 for o in root.children_recursive if o.type == "MESH")}')
G2 = lambda pts: [(round(-x, 2), round(y, 2)) for x, y in pts]
yaw = lambda dx, dy: round(math.atan2(-dx, dy), 4)          # terminal heading (dx, dy) -> yaw about glTF +Y, 0 facing +Z
def js(v):
    if isinstance(v, dict): return '{ ' + ', '.join(f'{k}: {js(e)}' for k, e in v.items()) + ' }'
    if isinstance(v, (list, tuple)): return ('[ ' + ', '.join(js(e) for e in v) + ' ]') if v else '[]'
    v = round(float(v), 4); v = int(v) if v == int(v) else v
    return f'- {-v}' if v < 0 else str(v)
fill = {'poly': G2(LANDPOLY), 'height': 3.1, 'slope': 6.5}
dredge = [{'poly': G2(g['poly']), 'depth': g['depth'], 'blend': g['blend']} for g in SITE['dredge']]
ridge = {**SITE['ridges'][0], 'line': G2(SITE['ridges'][0]['line'])}
entry = {'point': G2([SITE['roadEntry']['point']])[0], 'height': HARD, 'yaw': yaw(ROAD_IN.x, ROAD_IN.y)}
park = [(round(-x, 2), y, yaw(math.cos(hd), math.sin(hd))) for x, y, hd in PARKING]
SITE_HEADER = '''// Generated by tools/ferry/terminal_build.py from the terminal's own geometry; do not edit by hand.
// Generated by tools/ferry/terminal_build.py: re-run it after changing the flat, breakwater or car park.
//
// Everything is in the terminal's glTF frame (the frame the game places it in): metres, +Z out to
// sea (the docked ferry's bow), +X to the left looking out to sea, +Y up, origin on the docked
// ferry's stern-ramp hinge line at sea level. The game places this frame at
// WORLD.ferryTerminal (position, yaw) and applies the terrain edits before building the world.
//
// fill:   raise the terrain to `height` inside the polygon (the reclaimed flat, under the GLB's
//         paving), falling to the natural seabed over `slope` metres outside it (the revetments).
// dredge: lower the terrain to at most `depth` inside the polygon, blending over `blend` metres.
// ridges: a breakwater core along the polyline: crest height, crest half width, side slope (run
//         per metre of rise) down to the natural seabed.
// clear:  no vegetation, rocks or debris inside these polygons.
// roadEntry: where the island road should arrive, on the flat, with the direction a car faces
//         driving in (yaw about +Y, radians, same convention as the ship: 0 faces +Z).
// parking: parked-car slots on the flat [x, z, yaw] for the game to fill with real car models.'''
lines = [SITE_HEADER, 'export const TERMINAL_SITE = {', f'\tfill: [ {js(fill)} ],', '\tdredge: [']
lines += [f'\t\t{js(g)},' for g in dredge] + ['\t],', f'\tridges: [ {js(ridge)} ],', f"\tclear: [ {js({'poly': G2(SITE['clear'][0]['poly'])})} ],",
          f'\troadEntry: {js(entry)},', '\tparking: [']
lines += ['\t\t' + ', '.join(js(q) for q in park[k:k + 4]) + ',' for k in range(0, len(park), 4)] + ['\t],', '};']
(ROOT / 'src/ferry/terminalSite.js').write_text('\n'.join(lines) + '\n')
print(f'TERMINAL site fill {len(LANDPOLY)} points, dredge {len(dredge)}, ridge {len(ridge["line"])} points, '
      f'road entry {entry}, parking {len(park)} bays')
