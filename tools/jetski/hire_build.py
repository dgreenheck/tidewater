# Blender 5.x batch builder for the beach jetski hire: public/models/jetski-hire.glb (a weathered timber stand
# with its counter and signs facing the path at the east end, life jackets on hangers, the counter's props, a
# beach dolly) and public/models/jetski-buoys.glb (a float line on its rope, sea level at y = 0).
#   blender -b --factory-startup --python tools/jetski/hire_build.py -- <repo root>
# glTF frame: Y up, local +Z faces the sea, metres, origin on the sand at the stand's centre. PBR factors only.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
FONT = ROOT + '/tools/props/fonts/Oswald.ttf'
bpy.ops.wm.read_factory_settings(use_empty=True)
log = lambda *a: print('HIRE', *a, flush=True)
def B(p): return Vector((p[0], -p[2], p[1]))
MATS = {}
def mat(name, col, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal; m.diffuse_color = (*col, 1)
    MATS[name] = m; return m
TIMBER = mat('Timber_Weathered', (0.30, 0.20, 0.12), 0.85)
TIMBER2 = mat('Timber_Grey', (0.36, 0.33, 0.29), 0.9)
PAINT = mat('Paint_White', (0.78, 0.79, 0.77), 0.55)
TEAL = mat('Paint_Teal', (0.005, 0.12, 0.15), 0.45)
ORANGE = mat('Paint_Orange', (0.9, 0.22, 0.02), 0.5)
BLACK = mat('Rubber_Black', (0.02, 0.02, 0.022), 0.8)
ALU = mat('Aluminium', (0.6, 0.6, 0.62), 0.35, 1.0)
CARPET = mat('Bunk_Carpet', (0.08, 0.09, 0.1), 0.95)
ROPE = mat('Rope_Yellow', (0.75, 0.55, 0.08), 0.8)
FONTD = bpy.data.fonts.load(FONT)

class Part:
    def __init__(s, name): s.bm = bmesh.new(); s.name = name; s.mats = []; s.flat = set()
    def mi(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)
    def box(s, c, size, m, rot=0.0, rx=0.0, rz=0.0):
        # glTF axes: rx about X, then rot (yaw) about Y, then rz about Z (Blender Z is glTF Y, Blender -Y is glTF Z)
        g = bmesh.ops.create_cube(s.bm, size=1.0); R = Matrix.Rotation(-rz, 3, 'Y') @ Matrix.Rotation(rot, 3, 'Z') @ Matrix.Rotation(rx, 3, 'X')
        for v in g['verts']: v.co = B(c) + R @ Vector((v.co.x * size[0], v.co.y * size[2], v.co.z * size[1]))
        for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def cyl(s, c, r, h, m, axis='Y', seg=16, r2=None):
        g = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=seg, radius1=r, radius2=r2 if r2 is not None else r, depth=h)
        R = {'Y': Matrix.Identity(3), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Z': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
        for v in g['verts']: v.co = B(c) + R @ v.co
        for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def sphere(s, c, r, m, sq=1.0):
        g = bmesh.ops.create_uvsphere(s.bm, u_segments=16, v_segments=10, radius=r)
        for v in g['verts']: v.co = B(c) + Vector((v.co.x, v.co.y, v.co.z * sq))
        for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def tube(s, pts, r, m, seg=8):
        for a, b in zip(pts, pts[1:]):
            a, b = B(a), B(b); d = b - a
            g = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
            q = Vector((0, 0, 1)).rotation_difference(d.normalized())
            for v in g['verts']: v.co = (a + b) / 2 + q @ v.co
            for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = s.mi(m)
    def torus(s, c, R, r, m, axis='Y', seg=24, rseg=10):
        # a closed ring (a split ring, a wire loop): one smooth torus, R to the wire's centre, r the wire; its hole
        # along the glTF `axis` (the axes as cyl). A chain of tube segments broke into dashes at this size.
        A = {'Y': Matrix.Identity(3), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Z': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
        vs = [[s.bm.verts.new(B(c) + A @ Vector(((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v))))
               for v in [j * math.tau / rseg for j in range(rseg)]] for u in [i * math.tau / seg for i in range(seg)]]
        for i in range(seg):
            for j in range(rseg):
                f = s.bm.faces.new([vs[i][j], vs[(i + 1) % seg][j], vs[(i + 1) % seg][(j + 1) % rseg], vs[i][(j + 1) % rseg]]); f.material_index = s.mi(m)
    def text(s, body, c, size, m, yaw=0.0, depth=0.006, rz=0.0, rx=0.0, spin=0.0):
        # Painted lettering (depth <= 0.002) is one flat face at the old front face, turned outward and kept out of
        # the normal recalculation. That is invisible at 2 mm and cuts the
        # stand's triangles by more than half (the extruded sides and hidden back faces were most of them). Keep 3 curve steps: 2 turned the small print's commas into full stops.
        flat = depth <= 0.0021 and size >= 0.05   # small print keeps its 2 mm sides: flat, its thin strokes broke up at grazing angles
        cu = bpy.data.curves.new('t', 'FONT'); cu.body = body; cu.font = FONTD; cu.size = size; cu.extrude = 0.0 if flat else depth / 2
        cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 3
        ob = bpy.data.objects.new('t', cu); bpy.context.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg)); bpy.data.objects.remove(ob)
        # font plane XY -> faces glTF +Z, then rx about X, yaw about Y and rz about Z (the order Part.box uses)
        R = Matrix.Rotation(-rz, 3, 'Y') @ Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(rx, 3, 'X') @ Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))) @ Matrix.Rotation(spin, 3, 'Z')
        at = B(c) + (R @ Vector((0, 0, 1))) * (depth / 2 if flat else 0.0)
        me.transform((Matrix.Translation(at) @ R.to_4x4())); tmp = bmesh.new(); tmp.from_mesh(me)
        vm = {v: s.bm.verts.new(v.co) for v in tmp.verts}
        for f in tmp.faces:
            try:
                nf = s.bm.faces.new([vm[v] for v in f.verts]); nf.material_index = s.mi(m)
                if flat:
                    nf.normal_update()
                    if nf.normal.dot(R @ Vector((0, 0, 1))) < 0: nf.normal_flip()
                    s.flat.add(nf)
            except ValueError: pass
        tmp.free()
    def done(s, parent=None):
        me = bpy.data.meshes.new(s.name); bmesh.ops.recalc_face_normals(s.bm, faces=[f for f in s.bm.faces if f not in s.flat]); s.bm.to_mesh(me); s.bm.free()
        for m in s.mats: me.materials.append(m)
        me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(40))
        ob = bpy.data.objects.new(s.name, me); bpy.context.collection.objects.link(ob); ob.parent = parent; return ob

def export(path, objs):
    for o in bpy.context.scene.objects: o.select_set(o in objs or (o.parent in objs))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    log('EXPORTED', path, os.path.getsize(path))

# ------------------------------------------------------------------ the stand
# Stand frame: +x is the east end, the counter, facing the path down from the village; +z the sea; the
# back (-z) is open east of the vest rail (the attendant's way in and out); the vests hang on a rail along
# the back. Weathered timber throughout: boards with gaps in mixed greys and browns, rusty nail heads, a
# painted sign with chipped paint. The attendant's stool (src/people/Beach.js) sits inside at x = +0.65.
import random
rng = random.Random(7)
root = bpy.data.objects.new('JetskiHire', None); bpy.context.collection.objects.link(root)
TW = [mat('Timber_A', (0.34, 0.27, 0.19), 0.88), mat('Timber_B', (0.42, 0.39, 0.34), 0.92),
      mat('Timber_C', (0.27, 0.21, 0.15), 0.86), mat('Timber_D', (0.37, 0.33, 0.27), 0.9)]
NAIL = mat('Nail_Rust', (0.3, 0.19, 0.12), 0.6, 0.3)
SIGNW = mat('Paint_Sign_White', (0.86, 0.84, 0.77), 0.6)
VEST = [mat('Vest_Orange', (0.95, 0.28, 0.02), 0.72), mat('Vest_Orange_Faded', (0.88, 0.36, 0.09), 0.8)]
WEB = mat('Webbing_Black', (0.025, 0.025, 0.03), 0.85)
BUCKLE = mat('Buckle_Plastic', (0.07, 0.07, 0.08), 0.45)
REFL = mat('Reflective_Tape', (0.62, 0.64, 0.64), 0.35, 0.3)
TIN = mat('Cash_Tin_Green', (0.04, 0.17, 0.1), 0.4, 0.6)
PAPER = mat('Paper', (0.9, 0.9, 0.86), 0.9)
MASONITE = mat('Clipboard_Masonite', (0.36, 0.22, 0.11), 0.6)
BRO = [mat('Brochure_Yellow', (0.95, 0.72, 0.08), 0.5), mat('Brochure_Blue', (0.05, 0.35, 0.65), 0.5), mat('Brochure_Coral', (0.9, 0.3, 0.28), 0.5)]
FLOATS = [mat('Key_Float_Yellow', (0.95, 0.82, 0.05), 0.6), ORANGE]
LANYARD = mat('Lanyard_Red', (0.55, 0.05, 0.05), 0.7)
JERRY = mat('Jerry_Can_Red', (0.6, 0.04, 0.03), 0.45)
TIN_WORN = mat('Cash_Tin_Worn', (0.38, 0.38, 0.36), 0.45, 0.8)
CHROME = mat('Chrome', (0.8, 0.8, 0.82), 0.18, 1.0)
BRASS = mat('Brass_Hook', (0.62, 0.45, 0.16), 0.35, 1.0)
PLY = mat('Plywood_Edge', (0.62, 0.48, 0.3), 0.8)
PLYDK = mat('Plywood_Glue_Line', (0.3, 0.2, 0.11), 0.85)
BOARD = mat('Paint_Board_Teal', (0.03, 0.3, 0.32), 0.7)
ACRYL = mat('Acrylic_Edge', (0.72, 0.86, 0.9), 0.05)
INK = mat('Print_Ink_Grey', (0.2, 0.22, 0.25), 0.7)
BIRO = mat('Biro_Blue', (0.03, 0.08, 0.45), 0.6)
SKY = mat('Print_Sky', (0.45, 0.7, 0.9), 0.5)
SEA = mat('Print_Sea', (0.0, 0.25, 0.45), 0.5)
COIL = [mat('Coil_Red', (0.7, 0.04, 0.03), 0.5), mat('Coil_Yellow', (0.95, 0.75, 0.03), 0.5)]

def rot(p, yaw=0.0, rx=0.0, rz=0.0):
    # rx about X, then yaw about Y, then rz about Z (glTF axes): the order Part.box and Part.text use
    x, y, z = p
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(yaw) + z * math.sin(yaw), -x * math.sin(yaw) + z * math.cos(yaw)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x, y, z)
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])

st = Part('Stand')
W, D = 2.6, 1.2
DECK = 0.131
st.box((0, 0.06, 0), (W + 0.3, 0.12, D + 0.4), TW[2])                           # bearers under the deck
for i in range(12):                                                               # deck boards, gapped
    st.box((rng.uniform(-0.02, 0.02), 0.125, -D / 2 - 0.15 + (i + 0.5) * (D + 0.3) / 12), (W + 0.26, 0.012, (D + 0.3) / 12 - 0.012), rng.choice(TW))
# the awning: striped canvas sloping down to the sea (its sea edge low, the valance hanging from it)
SLOPE = math.atan2(0.3, 1.94)
def awning_y(z): return 2.52 - (z - 0.05) * math.tan(SLOPE)
for x in (-W / 2, W / 2):                                                         # posts, up to the canvas
    for z in (-D / 2, D / 2):
        top = awning_y(z) - 0.02
        st.box((x, (0.05 + top) / 2, z), (0.09, top - 0.05, 0.09), TW[2])

def planks(along, fixed, a0, a1, y0, y1, n, t=0.024):
    w = (a1 - a0) / n; out = 1 if fixed > 0 else -1
    for i in range(n):
        a = a0 + (i + 0.5) * w; top = y1 + rng.uniform(-0.014, 0.004); m = rng.choice(TW); j = rng.uniform(-0.01, 0.01)
        if along == 'x':
            st.box((a, (y0 + top) / 2, fixed), (w - 0.012, top - y0, t), m, j)
            for yy in (y0 + 0.12, top - 0.1):
                for da in (-w * 0.25, w * 0.25): st.box((a + da, yy, fixed + out * (t / 2 + 0.001)), (0.007, 0.007, 0.003), NAIL)
        else:
            st.box((fixed, (y0 + top) / 2, a), (t, top - y0, w - 0.012), m, j)
            for yy in (y0 + 0.12, top - 0.1):
                for da in (-w * 0.25, w * 0.25): st.box((fixed + out * (t / 2 + 0.001), yy, a + da), (0.003, 0.007, 0.007), NAIL)

planks('x', D / 2 + 0.058, -W / 2 - 0.06, W / 2 + 0.06, DECK, 1.07, 14)          # the sea front
planks('z', -W / 2 - 0.058, -D / 2 - 0.04, D / 2 + 0.04, DECK, 1.07, 6)           # the west end
planks('x', -D / 2 - 0.058, -W / 2 - 0.06, 0.48, DECK, 1.0, 8)                    # the back, under the vest rail
planks('z', W / 2 + 0.058, -D / 2 - 0.04, D / 2 + 0.04, DECK, 1.075, 7)           # the counter front (east)
st.box((0, 1.09, D / 2 + 0.05), (W + 0.24, 0.04, 0.13), TW[0])                    # cap rails
st.box((-W / 2 - 0.05, 1.09, 0), (0.13, 0.04, D + 0.2), TW[3])
st.box((-0.42, 1.02, -D / 2 - 0.05), (1.96, 0.04, 0.11), TW[0])
# the counter: two thick weathered planks overhanging the east end on braces
T = 1.1225
st.box((W / 2 - 0.02, 1.1, 0), (0.2, 0.045, D + 0.36), TW[0]); st.box((W / 2 + 0.185, 1.1, 0.004), (0.2, 0.045, D + 0.34), TW[3])
for z in (-0.45, 0.45): st.box((1.45, 0.99, z), (0.035, 0.24, 0.035), TW[2], rz=-0.7)
# its painted sign: teal on a white border, the paint chipped at the edges
SX = W / 2 + 0.058 + 0.012
st.box((SX + 0.005, 0.72, 0), (0.01, 0.42, 1.08), SIGNW)
st.box((SX + 0.011, 0.72, 0), (0.008, 0.34, 1.0), TEAL)
for y, z, h, w in ((0.925, -0.41, 0.012, 0.05), (0.52, 0.3, 0.014, 0.07), (0.7, 0.525, 0.05, 0.012), (0.9, 0.2, 0.01, 0.03), (0.54, -0.52, 0.03, 0.012)):
    st.box((SX + 0.0105, y, z), (0.002, h, w), TW[0])
st.text('JETSKI HIRE', (SX + 0.016, 0.79, 0), 0.155, SIGNW, math.pi / 2, depth=0.002)
st.text('$20 A RIDE', (SX + 0.016, 0.655, 0), 0.085, ORANGE, math.pi / 2, depth=0.002)
st.text('VEST, FUEL AND BRIEFING INCLUDED', (SX + 0.016, 0.585, 0), 0.036, SIGNW, math.pi / 2, depth=0.002)
# the sea front's painted panel
st.box((0, 0.64, D / 2 + 0.075), (1.62, 0.36, 0.008), TEAL)
st.text('RIDE THE REEF', (0, 0.69, D / 2 + 0.08), 0.13, SIGNW, depth=0.002)
st.text('RIPTIDE RX-300  -  VEST, FUEL AND BRIEFING INCLUDED', (0, 0.54, D / 2 + 0.08), 0.045, ORANGE, depth=0.002)
# the west end: a safety notice
st.box((-W / 2 - 0.075, 0.64, 0), (0.008, 0.22, 0.95), SIGNW)
st.text('LIFE JACKETS MUST BE WORN', (-W / 2 - 0.08, 0.64, 0), 0.06, TEAL, -math.pi / 2, depth=0.002)

# on the counter, from the back: the cash tin, the brochure stand and a spare leaflet, the clipboard and its pen
# the cash tin: pressed green steel, a piano hinge along the back, the lid lipped over the box with its paint worn
# off the rolled edges, a fold-down handle on the lid, and a key lock in the front (facing the path, its key left in)
CX, CZ = 1.38, -0.45
st.box((CX, T + 0.036, CZ), (0.17, 0.072, 0.25), TIN)
st.box((CX + 0.003, T + 0.08, CZ), (0.178, 0.018, 0.258), TIN)
st.box((CX + 0.004, T + 0.0905, CZ), (0.13, 0.003, 0.2), TIN)                             # the lid's pressed panel
for z in (-0.1295, 0.1295): st.box((CX + 0.003, T + 0.086, CZ + z), (0.16, 0.005, 0.0012), TIN_WORN)
st.box((CX + 0.0922, T + 0.086, CZ + 0.02), (0.0012, 0.005, 0.17), TIN_WORN)
for k in range(5):                                                                         # the hinge knuckles and pin
    st.cyl((CX - 0.087, T + 0.074, CZ - 0.1 + k * 0.05), 0.0055, 0.046, CHROME if k % 2 else TIN, axis='Z', seg=8)
st.cyl((CX - 0.087, T + 0.074, CZ), 0.0022, 0.236, CHROME, axis='Z', seg=6)
for z in (-0.056, 0.056): st.box((CX + 0.006, T + 0.0935, CZ + z), (0.02, 0.008, 0.012), CHROME)
st.tube([(CX + 0.006, T + 0.0965, CZ - 0.058), (CX + 0.03, T + 0.097, CZ - 0.05), (CX + 0.036, T + 0.097, CZ - 0.03),
         (CX + 0.036, T + 0.097, CZ + 0.03), (CX + 0.03, T + 0.097, CZ + 0.05), (CX + 0.006, T + 0.0965, CZ + 0.058)], 0.0028, CHROME, seg=6)
st.cyl((CX + 0.036, T + 0.097, CZ), 0.0058, 0.052, BLACK, axis='Z', seg=8)                 # the handle's grip
st.box((CX + 0.0865, T + 0.05, CZ), (0.003, 0.036, 0.032), CHROME)                        # the lock plate, barrel, keyway
st.cyl((CX + 0.0895, T + 0.05, CZ), 0.0068, 0.004, CHROME, axis='X', seg=10)
st.box((CX + 0.0918, T + 0.05, CZ), (0.001, 0.008, 0.0018), BLACK)
st.box((CX + 0.097, T + 0.05, CZ), (0.012, 0.0045, 0.0022), CHROME)                       # the key: shank, bow, its ring
st.box((CX + 0.107, T + 0.05, CZ), (0.009, 0.017, 0.0028), CHROME)
st.torus((CX + 0.109, T + 0.039, CZ), 0.0095, 0.0014, CHROME, axis='X')
# the brochure stand: clear acrylic (only its edges catch the light), two pockets side by side, each holding a stack of
# tri-fold brochures: a sea photo panel with a jetski and its wake, a title, lines of print; the next one peeks above
RZ, BX = 0.25, 1.5
def lean(o, d): return add(o, rot(d, rz=RZ))
st.box((BX, T + 0.003, -0.12), (0.09, 0.006, 0.232), ACRYL)
st.box(lean((BX - 0.028, T + 0.006, -0.12), (-0.002, 0.1, 0)), (0.004, 0.2, 0.232), ACRYL, rz=RZ)
for j, z in enumerate((-0.178, -0.062)):
    o = (BX - 0.024, T + 0.006, z)
    st.box(lean(o, (0.002, 0.1, 0)), (0.003, 0.19, 0.1), BRO[j], rz=RZ)                    # the one behind, a little higher
    st.box(lean(o, (0.0055, 0.094, 0)), (0.003, 0.186, 0.1), BRO[j], rz=RZ)
    for dy, h, dz, wd, m in ((0.158, 0.05, 0, 0.09, SKY), (0.113, 0.04, 0, 0.09, SEA), (0.075, 0.013, 0, 0.07, PAPER),
                             (0.05, 0.0025, 0, 0.07, INK), (0.041, 0.0025, 0, 0.07, INK), (0.032, 0.0025, -0.008, 0.054, INK),
                             (0.02, 0.0025, 0, 0.07, INK)):
        st.box(lean(o, (0.0075, dy, dz)), (0.001, h, wd), m, rz=RZ)
    st.box(lean(o, (0.0082, 0.112, 0.014)), (0.001, 0.008, 0.024), ORANGE, rz=RZ)            # the jetski on the photo
    st.box(lean(o, (0.0082, 0.109, -0.016)), (0.001, 0.0025, 0.036), PAPER, rz=RZ)          # its wake
    st.box(lean(o, (0.0082, 0.13, 0.0)), (0.001, 0.001, 0.09), PAPER, rz=RZ)                # the horizon's white line
    for dz in (-0.052, 0.052):                                                                # the pocket: side walls, front lip
        st.box(lean(o, (0.021, 0.034, dz)), (0.003, 0.068, 0.003), ACRYL, rz=RZ)
        st.box(lean(o, (0.011, 0.068, dz)), (0.02, 0.003, 0.003), ACRYL, rz=RZ)
    st.box(lean(o, (0.021, 0.068, 0)), (0.004, 0.003, 0.107), ACRYL, rz=RZ)
    st.box(lean(o, (0.011, 0.002, 0)), (0.022, 0.004, 0.107), ACRYL, rz=RZ)
LY, LO = 0.35, (1.46, T + 0.002, 0.06)                                                       # the spare leaflet, lying open
st.box(LO, (0.1, 0.004, 0.2), BRO[2], LY)
for dx, dz, sx, sz, m in ((0, -0.066, 0.086, 0.052, SEA), (0, -0.03, 0.086, 0.018, SKY), (0, 0.0, 0.06, 0.012, PAPER),
                          (0, 0.022, 0.074, 0.0025, INK), (0, 0.032, 0.074, 0.0025, INK), (0, 0.042, 0.074, 0.0025, INK),
                          (-0.01, 0.052, 0.054, 0.0025, INK), (0, 0.07, 0.074, 0.0025, INK), (0, 0.08, 0.074, 0.0025, INK)):
    st.box(add(LO, rot((dx, 0.0025, dz), LY)), (sx, 0.001, sz), m, LY)
for dz in (-0.0333, 0.0333): st.box(add(LO, rot((0, 0.0021, dz), LY)), (0.1, 0.0006, 0.0012), INK, LY)   # its folds
# the clipboard, turned for the customer to sign: masonite, a chrome spring clip (its jaw roll, lever and rivets),
# the hire form (a printed heading, ruled rows and columns, three entries and a signature in blue biro), the pen on it
YW, CO = -0.12, (1.36, T, 0.33)
def cb(d): return add(CO, rot(d, YW))
st.box(cb((0, 0.003, 0)), (0.3, 0.006, 0.23), MASONITE, YW)
st.box(cb((0.014, 0.0065, 0)), (0.262, 0.001, 0.19), PAPER, YW)
st.box(cb((-0.13, 0.0085, 0)), (0.032, 0.003, 0.11), CHROME, YW)
st.tube([cb((-0.117, 0.011, -0.055)), cb((-0.117, 0.011, 0.055))], 0.0045, CHROME, seg=8)
st.box(cb((-0.138, 0.019, 0)), (0.036, 0.002, 0.086), CHROME, YW, rz=-0.45)
for z in (-0.035, 0.035): st.cyl(cb((-0.139, 0.0102, z)), 0.0042, 0.002, CHROME, seg=8)
st.text('HIRE AGREEMENT', cb((-0.084, 0.0072, 0)), 0.016, INK, yaw=math.pi / 2 + YW, depth=0.001, rx=-math.pi / 2)
for i in range(9): st.box(cb((-0.066 + i * 0.022, 0.00715, 0)), (0.0012, 0.0005, 0.172), INK, YW)
for z in (-0.035, 0.045): st.box(cb((0.022, 0.00715, z)), (0.176, 0.0005, 0.0012), INK, YW)
for i, (a, b, c) in enumerate(((0.05, 0.026, 0.02), (0.042, 0.03, 0.018), (0.056, 0.022, 0.024))):
    x = -0.055 + i * 0.022
    st.box(cb((x, 0.0074, -0.078 + a / 2)), (0.0016, 0.0005, a), BIRO, YW)
    st.box(cb((x, 0.0074, 0.005)), (0.0016, 0.0005, b), BIRO, YW)
    st.box(cb((x, 0.0074, 0.063)), (0.0016, 0.0005, c), BIRO, YW)
st.tube([cb((0.1, 0.0075, -0.07 + i * 0.012 + (0.004 if i % 2 else 0))) if False else cb((0.101 + (0.005 if i % 2 else -0.004), 0.0075, -0.07 + i * 0.011)) for i in range(9)], 0.0008, BIRO, seg=4)
st.tube([cb((0.03, 0.0112, -0.1)), cb((0.15, 0.0112, -0.055))], 0.0038, PAINT, seg=8)          # the biro: barrel, cap, tip
st.tube([cb((0.15, 0.0112, -0.055)), cb((0.172, 0.0112, -0.047))], 0.0042, BIRO, seg=8)
st.tube([cb((0.03, 0.0112, -0.1)), cb((0.022, 0.0112, -0.103))], 0.0016, CHROME, seg=6)
# the key board on the sea-side corner post, facing the path: a painted plywood offcut (the ply's glue lines at its
# edges, the paint chipped back to the wood), hand-painted KEYS and hook numbers over four brass cup hooks; three sets
# hang (one ski is out), each a key and a foam float on a split ring with the kill cord's coil and its clip below
KX = W / 2 + 0.045 + 0.011
st.box((KX - 0.001, 1.6, 0.5), (0.018, 0.3, 0.26), PLY)
st.box((KX + 0.0088, 1.6, 0.5), (0.0016, 0.29, 0.25), BOARD)
for dx in (-0.006, -0.001, 0.004):
    for y in (1.7502, 1.4498): st.box((KX + dx, y, 0.5), (0.0012, 0.0005, 0.26), PLYDK)
    for z in (0.3698, 0.6302): st.box((KX + dx, 1.6, z), (0.0012, 0.3, 0.0005), PLYDK)
for y, z, h, w in ((1.742, 0.41, 0.009, 0.03), (1.47, 0.6, 0.02, 0.012), (1.5, 0.378, 0.012, 0.008), (1.735, 0.62, 0.006, 0.014), (1.458, 0.47, 0.007, 0.022)):
    st.box((KX + 0.0099, y, z), (0.0006, h, w), PLY)
for y in (1.735, 1.465):
    for z in (0.385, 0.615): st.cyl((KX + 0.0102, y, z), 0.0045, 0.0015, CHROME, axis='X', seg=8)
for i, (ch, dy, sp, sz) in enumerate((('K', 0.004, 0.07, 0.066), ('E', -0.002, -0.04, 0.062), ('Y', 0.003, 0.05, 0.066), ('S', -0.003, -0.06, 0.064))):
    st.text(ch, (KX + 0.0096, 1.702 + dy, 0.5 + 0.048 - i * 0.032), sz, SIGNW, math.pi / 2, depth=0.001, spin=sp)
st.box((KX + 0.0099, 1.665, 0.5), (0.0006, 0.004, 0.12), SIGNW, rx=0.03)                      # the brush stroke under it
for k in range(4):
    z = 0.59 - k * 0.06
    st.text(str(k + 1), (KX + 0.0096, 1.628, z), 0.022, SIGNW, math.pi / 2, depth=0.001, spin=0.05 * (k % 2) - 0.03)
    st.cyl((KX + 0.011, 1.66, z), 0.004, 0.003, BRASS, axis='X', seg=8)
    st.tube([(KX + 0.01, 1.66, z), (KX + 0.03, 1.66, z), (KX + 0.037, 1.664, z), (KX + 0.039, 1.672, z), (KX + 0.035, 1.679, z)], 0.0022, BRASS, seg=6)
    if k == 1: continue
    H = (KX + 0.028, 1.637, z); A = 0.22
    st.tube([(H[0], 1.648 + 0.011 * math.cos(a), z + 0.011 * math.sin(a)) for a in [i * math.tau / 10 for i in range(11)]], 0.0012, CHROME, seg=4)
    st.box(add(H, rot((0, -0.012, 0), rx=A)), (0.005, 0.02, 0.016), BLACK, rx=A)              # the key's head, blade, teeth
    st.box(add(H, rot((0, -0.034, 0), rx=A)), (0.0022, 0.026, 0.007), CHROME, rx=A)
    for dy in (-0.029, -0.037): st.box(add(H, rot((0, dy, 0.0045), rx=A)), (0.0022, 0.004, 0.003), CHROME, rx=A)
    st.tube([H, add(H, rot((0, -0.012, 0), rx=-A))], 0.0012, BLACK, seg=4)                     # the float on its tag
    st.tube([add(H, rot((0, -0.012, 0), rx=-A)), add(H, rot((0, -0.062, 0), rx=-A))], 0.012, FLOATS[k % 2], seg=10)
    st.tube([add(H, rot((0, -0.03, 0), rx=-A)), add(H, rot((0, -0.037, 0), rx=-A))], 0.0124, BLACK, seg=10)
    cx, top, n = KX + 0.038, 1.632, 54                                                          # the coiled kill cord
    st.tube([(cx + 0.0055 * math.cos(i * math.tau / 6), top - i * 0.0019, z + 0.0055 * math.sin(i * math.tau / 6)) for i in range(n)], 0.0016, COIL[(k + 1) % 2], seg=4)
    yb = top - n * 0.0019
    st.box((cx, yb - 0.011, z), (0.01, 0.022, 0.015), BLACK)                                    # its clip and red tab
    st.box((cx + 0.0055, yb - 0.006, z), (0.002, 0.008, 0.012), COIL[0])
    st.tube([(cx, yb - 0.022 - 0.005 + 0.005 * math.cos(a), z + 0.005 * math.sin(a)) for a in [i * math.tau / 8 for i in range(9)]], 0.0012, CHROME, seg=4)
# a jerry can inside by the west end
st.box((-1.0, DECK + 0.16, 0.3), (0.17, 0.32, 0.3), JERRY)
st.tube([(-1.0, DECK + 0.33, 0.2), (-1.0, DECK + 0.37, 0.24), (-1.0, DECK + 0.37, 0.34), (-1.0, DECK + 0.33, 0.38)], 0.012, JERRY, seg=6)

# the awning's stripes and the valance along its sea edge
for k in range(10):
    x0 = -W / 2 - 0.2 + k * (W + 0.4) / 10; col = TEAL if k % 2 else PAINT
    st.box((x0 + (W + 0.4) / 20, 2.52, 0.05), ((W + 0.4) / 10, 0.03, D + 0.7), col, rx=SLOPE)
    ez = 0.05 + (D + 0.7) / 2 * math.cos(SLOPE); ey = 2.52 - (D + 0.7) / 2 * math.sin(SLOPE)
    st.box((x0 + (W + 0.4) / 20, ey - 0.1, ez), ((W + 0.4) / 10, 0.22, 0.02), col)
# the sign board over the east end, turned to face the path (both faces lettered)
SGX, SGY = W / 2 + 0.02, 2.98
st.box((SGX, SGY, 0), (0.04, 0.6, 2.02), SIGNW); st.box((SGX, SGY, 0), (0.056, 0.5, 1.9), TEAL)
for s in (1, -1): st.text('JETSKI HIRE', (SGX + s * 0.03, SGY, 0), 0.32, SIGNW, s * math.pi / 2, depth=0.006)
for z in (-0.72, 0.72):
    y0 = awning_y(z) + 0.015; y1 = SGY - 0.3
    st.box((SGX, (y0 + y1) / 2, z), (0.06, y1 - y0 + 0.02, 0.06), TW[2])

# the vest rack: a rail along the back, four life jackets on hangers facing the land side
RY, RZ = 1.95, -D / 2 - 0.12
st.tube([(-W / 2, RY, RZ), (0.55, RY, RZ)], 0.016, ALU)
st.tube([(-W / 2, RY, -D / 2 - 0.045), (-W / 2, RY, RZ)], 0.014, ALU)
st.tube([(0.55, RY, RZ), (0.55, awning_y(RZ) - 0.01, RZ)], 0.014, ALU)

def vest(o, yaw, sag, m, twist):
    def w(c): return add(o, rot(c, yaw, sag))
    def bx(c, size, mm, e=0.0): st.box(w(c), size, mm, yaw, sag + e)
    bx((0, -0.3, -0.04), (0.42, 0.53, 0.024), m)                                   # back panel
    for cx in (-0.125, 0.0, 0.125):                                                    # its foam channels, pillowed
        st.tube([w((cx, -0.1, -0.05)), w((cx, -0.33, -0.056)), w((cx, -0.53, -0.052))], 0.03, m, seg=8)
    st.tube([w((-0.18, -0.07, -0.046)), w((0.18, -0.07, -0.046))], 0.024, m, seg=8)       # the yoke across the shoulders
    for y in (-0.3, -0.46): bx((0, y, -0.086), (0.43, 0.028, 0.005), WEB)                  # the straps round the back
    for sx in (-1, 1): bx((sx * 0.1, -0.16, -0.088), (0.07, 0.02, 0.004), REFL)           # reflective tape
    bx((0.0, -0.4, -0.089), (0.07, 0.045, 0.003), PAINT)                                # the size label, printed
    for y in (-0.388, -0.4, -0.412): bx((0.0, y, -0.0912), (0.05, 0.003, 0.001), BLACK)
    st.tube([w(p) for p in ((-0.02, -0.06, -0.05), (-0.022, 0.0, -0.052), (-0.012, 0.024, -0.05), (0.012, 0.024, -0.05), (0.022, 0.0, -0.052), (0.02, -0.06, -0.05))], 0.004, WEB, seg=4)   # the hang loop
    for sx in (-1, 1):
        for cx in (0.07, 0.165):                                                     # front foam blocks, pillowed
            bx((sx * cx, -0.335, 0.035), (0.088, 0.44, 0.05), m, -0.03)
            st.tube([w((sx * cx, -0.14, 0.056)), w((sx * cx, -0.53, 0.06 + twist * sx))], 0.021, m, seg=8)
        bx((sx * 0.16, -0.075, 0.03), (0.1, 0.13, 0.045), m)                          # shoulder panels by the V neck
        st.tube([w((sx * 0.16, -0.02, 0.045)), w((sx * 0.165, 0.014, 0.0)), w((sx * 0.16, -0.02, -0.045))], 0.024, m, seg=8)
        bx((sx * 0.16, -0.065, 0.054), (0.06, 0.018, 0.004), REFL)
        for y in (-0.3, -0.46): bx((sx * 0.224, y, -0.005), (0.012, 0.028, 0.1), WEB)   # side straps
    st.tube([w(p) for p in ((-0.1, -0.03, 0.02), (-0.085, -0.005, -0.03), (-0.045, 0.006, -0.06), (0, 0.009, -0.07), (0.045, 0.006, -0.06), (0.085, -0.005, -0.03), (0.1, -0.03, 0.02))], 0.028, m, seg=8)   # collar
    for y in (-0.22, -0.35, -0.48):                                                  # three buckled straps across the front
        bx((0, y, 0.082), (0.43, 0.026, 0.005), WEB)
        bx((0.03, y, 0.088), (0.052, 0.036, 0.012), BUCKLE); bx((0.03, y, 0.095), (0.02, 0.018, 0.005), WEB)
    bx((-0.07, -0.16, 0.079), (0.05, 0.03, 0.003), PAINT)                             # maker's label
    st.tube([w((-0.19, -0.03, 0)), w((0, 0.02, 0)), w((0.19, -0.03, 0))], 0.01, BLACK, seg=6)          # hanger
    st.tube([w(p) for p in ((0, 0.02, 0), (0, 0.09, 0), (0, 0.125, -0.02), (0, 0.12, -0.045), (0, 0.1, -0.05))], 0.005, ALU, seg=6)
for i, x in enumerate((-1.1, -0.64, -0.18, 0.28)):
    yaw = math.pi + rng.uniform(-0.06, 0.06); sag = rng.uniform(0.02, 0.07)
    vest(add((x, RY, RZ), rot((0, -0.1, 0.025), yaw)), yaw, sag, VEST[i % 2], rng.uniform(-0.01, 0.01))

# the A-frame price board by the path, facing east and west
AX, AZ = 2.15, 1.3
for s in (1, -1):
    c = (AX + s * 0.13, 0.52, AZ); rz = s * 0.245
    st.box(c, (0.03, 1.0, 0.62), TEAL, rz=rz)
    for body, h, size, m in (('JETSKI HIRE', 0.3, 0.085, SIGNW), ('$20', 0.12, 0.17, ORANGE), ('A RIDE', -0.03, 0.07, SIGNW),
                             ('VEST + FUEL', -0.18, 0.05, SIGNW), ('INCLUDED', -0.25, 0.05, SIGNW), ('LIFE JACKETS ON', -0.38, 0.042, ORANGE)):
        st.text(body, add(c, rot((s * 0.017, h, 0), rz=rz)), size, m, s * math.pi / 2, depth=0.002, rz=rz)
st.box((AX, 1.0, AZ), (0.05, 0.05, 0.6), TW[2])
stand = st.done(root)

dl = Part('Dolly')                                                             # beach launching dolly, drawbar to the land
for x in (-0.33, 0.33): dl.tube([(x, 0.42, -1.1), (x, 0.42, 1.1)], 0.028, ALU)
for z in (-1.0, 0.0, 0.9): dl.tube([(-0.33, 0.42, z), (0.33, 0.42, z)], 0.025, ALU)
for x in (-0.22, 0.22): dl.box((x, 0.5, 0.0), (0.09, 0.07, 2.0), CARPET)
for x in (-0.33, 0.33): dl.tube([(x, 0.42, 0.9), (x * 0.2, 0.42, 1.9)], 0.025, ALU)
dl.tube([(0, 0.42, 1.9), (0, 0.9, 2.1)], 0.025, ALU); dl.tube([(-0.25, 0.9, 2.1), (0.25, 0.9, 2.1)], 0.022, BLACK)
for x in (-0.55, 0.55):
    dl.cyl((x, 0.3, -0.35), 0.3, 0.26, BLACK, axis='X', seg=24); dl.cyl((x * 1.02, 0.3, -0.35), 0.12, 0.28, ALU, axis='X', seg=16)
dl.tube([(-0.55, 0.3, -0.35), (0.55, 0.3, -0.35)], 0.022, ALU)
for x in (-0.33, 0.33): dl.tube([(x, 0.42, -0.35), (x * 1.3, 0.3, -0.35)], 0.022, ALU)
# the dolly lies off the west end, clear of the counter and the path in from the village at the east end
dolly = dl.done(root); dolly.location = B((-3.7, 0.0, 0.4)); dolly.rotation_euler = (0, 0, math.radians(70))
export(ROOT + '/public/models/jetski-hire.glb', [root])

# ------------------------------------------------------------------ the float line (sea level y = 0, runs along +Z)
broot = bpy.data.objects.new('JetskiBuoys', None); bpy.context.collection.objects.link(broot)
bl = Part('Buoys'); N, SP = 8, 3.0
pts = []
for i in range(N):
    z = i * SP; big = i in (0, N - 1)
    bl.sphere((0, 0.04, z), 0.3 if big else 0.17, ORANGE if (i % 2 == 0 or big) else PAINT, 0.9)
    if big: bl.tube([(0, 0.2, z), (0, 1.1, z)], 0.02, ALU); bl.box((0.12, 0.98, z), (0.24, 0.16, 0.01), ORANGE)
for i in range(N * 6 + 1):
    z = i * SP / 6; pts.append((0.0, 0.03 - 0.03 * math.sin(math.pi * (i % 6) / 6), z))
bl.tube(pts, 0.012, ROPE, seg=6)
bl.done(broot)
export(ROOT + '/public/models/jetski-buoys.glb', [broot])
