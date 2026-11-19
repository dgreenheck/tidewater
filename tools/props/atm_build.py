# Blender 5.x batch builder for the Tidewater Community Bank ATM: public/models/atm.glb.
#   blender -b --factory-startup --python tools/props/atm_build.py -- <repo root> [proof.png]
# A freestanding Australian kiosk ATM: charcoal powder-coated cabinet on a plinth, brushed steel fascia,
# a recessed screen under a privacy hood with four function keys each side, an anti-skim card reader
# with a green lead-in light, a receipt slot, a sloped keypad deck with a 12-key steel PIN pad plus
# cancel / clear / enter (raised dot on 5) and privacy wings, a shuttered cash dispenser, a camera dome
# and a backlit bank sign on top. Grime and wear are drawn at runtime by src/game/Atm.js (by material name).
# glTF frame: Y up, local +Z faces the customer, metres, origin on the ground at the plinth centre.
# Animated nodes for Atm.js: Card (the customer's card at the reader), Notes (in the dispenser), Shutter.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
ROOT = os.path.abspath(argv[0])
PROOF = argv[1] if len(argv) > 1 else None
FONT = ROOT + '/tools/props/fonts/Oswald.ttf'
bpy.ops.wm.read_factory_settings(use_empty=True)
log = lambda *a: print('ATM', *a, flush=True)
def B(p): return Vector((p[0], -p[2], p[1]))

def mat(name, col, rough, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal; m.diffuse_color = (*col, 1)
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = 1.0
    return m
STEEL = mat('WSteel_Brushed', (0.60, 0.60, 0.61), 0.34, 1.0)
KEYSTEEL = mat('Steel_Key', (0.70, 0.70, 0.71), 0.22, 1.0)
CHAR = mat('WPowder_Charcoal', (0.085, 0.09, 0.095), 0.6)
DARK = mat('WPowder_Dark', (0.025, 0.027, 0.03), 0.7)
TEAL = mat('WPowder_Teal', (0.0, 0.16, 0.18), 0.5)
PLASTIC = mat('Plastic_Black', (0.012, 0.012, 0.014), 0.38)
HOLE = mat('Slot_Black', (0.004, 0.004, 0.004), 0.95)
SCREEN = mat('Screen_Glass', (0.01, 0.02, 0.03), 0.06, 0.0, (0.02, 0.10, 0.14))
SKIM = mat('Bezel_Green', (0.02, 0.16, 0.07), 0.2)
LED = mat('LED_Green', (0.1, 0.9, 0.3), 0.3, 0.0, (0.25, 2.2, 0.6))
RED = mat('Key_Red', (0.55, 0.03, 0.02), 0.4)
YEL = mat('Key_Yellow', (0.85, 0.62, 0.02), 0.4)
GRN = mat('Key_Green', (0.03, 0.40, 0.10), 0.4)
INK = mat('Label_Black', (0.01, 0.01, 0.01), 0.5)
WHITE = mat('Label_White', (0.85, 0.86, 0.84), 0.5)
LIGHTBOX = mat('Sign_Lightbox', (0.0, 0.22, 0.25), 0.35, 0.0, (0.0, 0.10, 0.12))
SIGNTEXT = mat('Sign_Text', (0.9, 0.92, 0.9), 0.4, 0.0, (0.55, 0.58, 0.56))
DOME = mat('Dome_Smoke', (0.01, 0.01, 0.012), 0.05)
CARD = mat('Card_Blue', (0.02, 0.10, 0.35), 0.3)
CHIP = mat('Card_Chip', (0.75, 0.6, 0.25), 0.3, 1.0)
NOTE50 = mat('Note_Fifty', (0.78, 0.62, 0.22), 0.8)
NOTE20 = mat('Note_Twenty', (0.72, 0.25, 0.14), 0.8)
FONTD = bpy.data.fonts.load(FONT)
root = bpy.data.objects.new('ATM', None); bpy.context.collection.objects.link(root)

class Part:
    def __init__(s, name): s.bm = bmesh.new(); s.name = name; s.mats = []
    def mi(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)
    def _put(s, geom, m, c, R, scale):
        for v in geom['verts']:
            v.co = B(c) + R @ Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
        idx = s.mi(m)
        for f in {f for v in geom['verts'] for f in v.link_faces}: f.material_index = idx
    # box: centre c and size (x, y, z) in the glTF frame, turned rx about X then rot about Y
    def box(s, c, size, m, rot=0.0, rx=0.0):
        g = bmesh.ops.create_cube(s.bm, size=1.0)
        s._put(g, m, c, Matrix.Rotation(rot, 3, 'Z') @ Matrix.Rotation(rx, 3, 'X'), size)
    # cylinder along glTF Y (axis='y') or Z (axis='z', pointing at the customer)
    def cyl(s, c, r, h, m, axis='y', seg=20, r2=None, rx=0.0):
        g = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=1.0)
        R = Matrix.Rotation(rx, 3, 'X') @ (Matrix.Rotation(-math.pi / 2, 3, 'X') if axis == 'z' else Matrix.Identity(3))
        for v in g['verts']: v.co = B(c) + R @ Vector((v.co.x, v.co.y, v.co.z * h))
        idx = s.mi(m)
        for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = idx
    def dome(s, c, r, m):
        g = bmesh.ops.create_uvsphere(s.bm, u_segments=20, v_segments=10, radius=r)
        for v in g['verts']: v.co = B(c) + Vector((v.co.x, v.co.y, max(v.co.z, 0.0) * 0.9))
        idx = s.mi(m)
        for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = idx
    def done(s, parent=None, smooth=40):
        me = bpy.data.meshes.new(s.name); bmesh.ops.remove_doubles(s.bm, verts=s.bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(s.bm, faces=s.bm.faces); s.bm.to_mesh(me); s.bm.free()
        for m in s.mats: me.materials.append(m)
        me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(smooth))
        ob = bpy.data.objects.new(s.name, me); bpy.context.collection.objects.link(ob); ob.parent = parent or root; return ob

TEXTS = []
# text: pos in glTF; face 'front' (+Z), 'up' (lying flat, reading from +Z), 'left' / 'right' (sides); rx tilts about X
def text(body, size, pos, m, face='front', rx=0.0, align='CENTER', extrude=0.0006):
    cu = bpy.data.curves.new('Text', 'FONT'); cu.body = body; cu.font = FONTD; cu.size = size
    cu.align_x = align; cu.align_y = 'CENTER'; cu.extrude = extrude
    cu.resolution_u = 3 if size >= 0.05 else 1  # glyph curves: keeps the labels to a few thousand triangles
    ob = bpy.data.objects.new('Text', cu); bpy.context.collection.objects.link(ob)
    e = {'front': (math.pi / 2, 0, 0), 'up': (0, 0, 0), 'right': (math.pi / 2, 0, math.pi / 2), 'left': (math.pi / 2, 0, -math.pi / 2)}[face]
    ob.rotation_euler = (e[0] + rx, e[1], e[2]); ob.location = B(pos)
    ob.data.materials.append(m); TEXTS.append(ob); return ob

# ------------------------------------------------------------------ cabinet
cab = Part('Cabinet')
W = 0.62
cab.box((0, 0.045, -0.04), (0.58, 0.09, 0.50), DARK)                            # plinth, set in (a kick recess)
for x in (-0.25, 0.25):
    for z in (-0.25, 0.17): cab.cyl((x, 0.094, z), 0.011, 0.012, KEYSTEEL, seg=6)  # hold-down bolts
cab.box((0, 0.855, -0.04), (W, 1.53, 0.52), CHAR)                               # the safe and cabinet, z -0.30..0.22
cab.box((0, 1.525, -0.04), (W + 0.006, 0.12, 0.525), TEAL)                      # bank colour band round the top
cab.box((0, 0.13, -0.04), (W + 0.006, 0.012, 0.525), TEAL)                      # and a pinstripe above the plinth
cab.box((0, 0.525, 0.224), (0.57, 0.83, 0.008), STEEL)                          # lower fascia (safe door), y 0.11..0.94
for y in (0.16, 0.60): cab.box((0, y, 0.2285), (0.50, 0.004, 0.002), DARK)       # door panel seams
cab.box((0.24, 0.40, 0.23), (0.028, 0.06, 0.006), DARK)                         # service lock
cab.cyl((0.24, 0.41, 0.234), 0.007, 0.004, KEYSTEEL, axis='z', seg=12)
# cash dispenser: bezel, dark throat, amber-free green guide light over it
cab.box((0, 0.87, 0.235), (0.31, 0.08, 0.022), PLASTIC)
cab.box((0, 0.868, 0.2465), (0.25, 0.026, 0.004), HOLE)
cab.box((0, 0.894, 0.2466), (0.18, 0.004, 0.002), LED)
# console under the keypad deck
cab.box((0, 1.005, 0.30), (0.60, 0.13, 0.155), CHAR)
# keypad deck, sloped 17 deg to the customer
RX = 0.30
DC = Vector((0, 1.083, 0.30))
def deck(l):  # deck-local (x across, y up off the deck, z toward the customer) to glTF
    v = Matrix.Rotation(RX, 3, 'X') @ Vector(l)
    return (DC.x + v.x, DC.y + v.y, DC.z + v.z)
cab.box(deck((0, 0, 0)), (0.60, 0.022, 0.175), STEEL, rx=RX)
# upper fascia, the hood and the screen
cab.box((0, 1.28, 0.224), (0.57, 0.40, 0.008), STEEL)                           # y 1.08..1.48 (the band above is teal)
cab.box((0, 1.345, 0.2295), (0.43, 0.29, 0.004), PLASTIC)                       # screen bezel
cab.box((0, 1.485, 0.29), (0.47, 0.014, 0.13), CHAR, rx=-0.10)                  # hood top, sloping down to the front
for x in (-0.228, 0.228): cab.box((x, 1.345, 0.285), (0.014, 0.30, 0.12), CHAR)  # hood sides
cab.box((0, 1.198, 0.285), (0.47, 0.012, 0.12), CHAR)                           # hood sill
for x in (-0.236, 0.236): cab.box((x, 1.345, 0.345), (0.004, 0.30, 0.004), KEYSTEEL)  # bright trim on the hood edges
cab.box((0, 1.4755, 0.346), (0.47, 0.004, 0.004), KEYSTEEL)
cab.box((0, 1.345, 0.233), (0.33, 0.25, 0.004), SCREEN)                         # the display, recessed 11 cm
for sx in (-1, 1):                                                              # four function keys each side
    for i in range(4):
        y = 1.265 + i * 0.053
        cab.box((sx * 0.192, y, 0.236), (0.03, 0.022, 0.008), KEYSTEEL)
        cab.box((sx * 0.192, y, 0.2405), (0.012, 0.003, 0.001), INK)
# card reader (right of the hood) with its anti-skim nose and green lead-in light
cab.box((0.19, 1.145, 0.238), (0.12, 0.07, 0.02), PLASTIC)
cab.box((0.19, 1.145, 0.262), (0.10, 0.052, 0.04), SKIM)
cab.box((0.19, 1.141, 0.2825), (0.074, 0.005, 0.002), HOLE)                     # the card slot
cab.box((0.19, 1.158, 0.2826), (0.082, 0.003, 0.002), LED)                      # lead-in light
# receipt printer slot (left)
cab.box((-0.19, 1.145, 0.236), (0.12, 0.05, 0.016), PLASTIC)
cab.box((-0.19, 1.145, 0.2445), (0.086, 0.005, 0.002), HOLE)
# camera dome on the front edge of the cabinet top, speaker grille and headphone socket
cab.box((0, 1.598, 0.19), (0.06, 0.008, 0.06), PLASTIC)
cab.dome((0, 1.602, 0.19), 0.024, DOME)
for i in range(5): cab.box((-0.235, 1.03 + i * 0.008, 0.378), (0.05, 0.003, 0.002), HOLE, rx=RX)
cab.cyl(deck((0.255, 0.012, 0.03)), 0.009, 0.006, PLASTIC, rx=RX)
cab.cyl(deck((0.255, 0.016, 0.03)), 0.0035, 0.004, HOLE, rx=RX)
# sign on top: a teal lightbox on a neck
cab.box((0, 1.64, -0.06), (0.10, 0.04, 0.06), CHAR)
cab.box((0, 1.745, -0.06), (W, 0.18, 0.10), TEAL)
cab.box((0, 1.745, -0.0085), (0.59, 0.155, 0.004), LIGHTBOX)
cab.box((0, 1.745, -0.1115), (0.59, 0.155, 0.004), LIGHTBOX)
cab.done(smooth=30)

# ------------------------------------------------------------------ PIN pad
kp = Part('Keypad')
KX = -0.03
kp.box(deck((KX, 0.013, 0.005)), (0.205, 0.006, 0.160), PLASTIC, rx=RX)         # the pad surround
for wx in (KX - 0.118, KX + 0.118):                                             # privacy wings
    kp.box(deck((wx, 0.045, 0.0)), (0.004, 0.07, 0.17), CHAR, rx=RX)
kp.box(deck((KX, 0.082, -0.075)), (0.24, 0.004, 0.035), CHAR, rx=RX)            # and the lip over the back row
cols = [KX - 0.075, KX - 0.030, KX + 0.015, KX + 0.068]
rows = [-0.054, -0.018, 0.018, 0.054]
digits = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', '']]
funcs = [(RED, 'CANCEL'), (YEL, 'CLEAR'), (GRN, 'ENTER'), (KEYSTEEL, '')]
for r, lz in enumerate(rows):
    for c in range(3):
        kp.box(deck((cols[c], 0.022, lz)), (0.036, 0.012, 0.028), KEYSTEEL, rx=RX)
        d = digits[r][c]
        if d: text(d, 0.017, deck((cols[c], 0.0286, lz)), INK, face='up', rx=RX)
        if d == '5': kp.dome(deck((cols[c] + 0.011, 0.028, lz - 0.008)), 0.0022, KEYSTEEL)
    m, label = funcs[r]
    kp.box(deck((cols[3], 0.022, lz)), (0.052, 0.012, 0.028), m, rx=RX)
    if label: text(label, 0.0075, deck((cols[3], 0.0286, lz)), WHITE if m is not YEL else INK, face='up', rx=RX)
kp.done(smooth=30)
text('Cover the keypad when you enter your PIN', 0.0065, deck((KX, 0.0115, 0.0915)), INK, face='up', rx=RX)

# ------------------------------------------------------------------ labels and the bank sign
text('TIDEWATER', 0.075, (0, 1.765, -0.0055), SIGNTEXT)
text('COMMUNITY BANK', 0.03, (0, 1.703, -0.0055), SIGNTEXT)
back = text('TIDEWATER', 0.075, (0, 1.765, -0.1145), SIGNTEXT); back.rotation_euler.z = math.pi
back2 = text('COMMUNITY BANK', 0.03, (0, 1.703, -0.1145), SIGNTEXT); back2.rotation_euler.z = math.pi
for sx, face in ((1, 'right'), (-1, 'left')):
    text('ATM', 0.16, (sx * 0.3135, 1.05, -0.04), WHITE, face=face)
    text('Tidewater Community Bank', 0.042, (sx * 0.3135, 1.525, -0.04), WHITE, face=face)
text('Take cash', 0.012, (0, 0.925, 0.2465), WHITE)
text('Card', 0.011, (0.19, 1.19, 0.2485), WHITE)
text('Receipt', 0.011, (-0.19, 1.19, 0.2445), WHITE)
text('Fees: nil for Tidewater Community Bank customers', 0.0085, (0, 1.505, 0.2285), INK)

# ------------------------------------------------------------------ the moving bits (Atm.js)
card = Part('Card')                                                              # at the reader, half in
card.box((0, 0, 0), (0.054, 0.0009, 0.0856), CARD)
card.box((-0.012, 0.0006, 0.018), (0.011, 0.0004, 0.009), CHIP)
co = card.done(); co.location = B((0.19, 1.141, 0.30))
notes = Part('Notes')                                                            # a wad of fifties and twenties
for i in range(7):
    m = NOTE50 if i % 3 != 1 else NOTE20
    notes.box((0.003 * ((i * 7) % 3 - 1), -0.009 + i * 0.0026, 0.0015 * ((i * 5) % 3 - 1)), (0.13, 0.0022, 0.066), m)
no = notes.done(); no.location = B((0, 0.868, 0.215))
sh = Part('Shutter')
sh.box((0, 0, 0), (0.245, 0.024, 0.003), KEYSTEEL)
for i in range(3): sh.box((0, -0.008 + i * 0.008, 0.0017), (0.24, 0.0012, 0.0006), DARK)
so = sh.done(); so.location = B((0, 0.868, 0.2485))

# text to meshes (with their material), joined into one object
for o in bpy.context.scene.objects: o.select_set(False)
for o in TEXTS: o.select_set(True)
bpy.context.view_layer.objects.active = TEXTS[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join()
lab = bpy.context.view_layer.objects.active; lab.name = 'Labels'; lab.parent = root
lab.data.shade_flat() if hasattr(lab.data, 'shade_flat') else None

path = ROOT + '/public/models/atm.glb'
for o in bpy.context.scene.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True, export_apply=True,
                          export_cameras=False, export_lights=False, export_animations=False)
tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
log('EXPORTED', path, os.path.getsize(path), 'bytes', tris, 'tris')

if PROOF:
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception: sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 900, 1100
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.6, 0.65, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.9, 0.2, 0.6); bpy.context.collection.objects.link(sun)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); bpy.context.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    eye = B((1.1, 1.5, 2.6)); target = B((0, 0.95, 0.0))
    cam.location = eye; cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = PROOF
    bpy.ops.render.render(write_still=True)
    log('PROOF', PROOF)
