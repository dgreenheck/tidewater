# Cycles review renders for the jetski (turnaround) and the rider's ski clips on it.
#   blender -b --factory-startup --python tools/jetski/jetski_render.py -- <repo root> <out dir> turn|rider
import bpy, sys, os, math, json, struct
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
ROOT, OUTD, MODE = os.path.abspath(argv[0]), argv[1], argv[2]
os.makedirs(OUTD, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
    for d in pr.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print('RENDER cpu', e)
sc.cycles.samples = 48 if MODE == 'turn' else 24; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = (1100, 620) if MODE == 'turn' else (720, 460)
def B(p): return Vector((p[0], -p[2], p[1]))
def glb_json(path):
    b = open(path, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; return json.loads(b[20:20 + jl])

bpy.ops.import_scene.gltf(filepath=ROOT + '/public/models/jetski.glb')
ski = {o.name: o for o in bpy.context.scene.objects}
info = json.load(open(ROOT + '/public/models/jetski.json'))
keel = info['bboxMin'][1]

w = bpy.data.worlds.new('w'); sc.world = w
w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.42, 0.56, 0.75, 1); bg.inputs[1].default_value = 0.9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 4.0; sun.data.angle = math.radians(2); sun.rotation_euler = (math.radians(50), 0, math.radians(35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'AREA')); sc.collection.objects.link(fill)
fill.data.energy = 900; fill.data.size = 4; fill.location = (-4, 3, 4); fill.rotation_euler = (math.radians(-40), math.radians(-40), 0)
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, keel - 0.004)); floor = bpy.context.active_object
fm = bpy.data.materials.new('floor'); fm.use_nodes = True; p = fm.node_tree.nodes['Principled BSDF']
p.inputs['Base Color'].default_value = (0.30, 0.30, 0.29, 1); p.inputs['Roughness'].default_value = 0.55; floor.data.materials.append(fm)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
def shoot(name, loc, at, lens=50, hide_floor=False):
    cam.location = Vector(loc); cam.data.lens = lens
    cam.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    floor.hide_render = hide_floor
    sc.render.filepath = f'{OUTD}/{name}.png'; bpy.ops.render.render(write_still=True); print('RENDER wrote', sc.render.filepath, flush=True)

if MODE == 'turn':
    shoot('t1_port', (6.2, -0.1, 0.55), (0, -0.05, 0.28))
    shoot('t2_front34', (3.6, -4.0, 1.55), (0, -0.1, 0.30))
    shoot('t3_rear34', (-3.0, 4.2, 2.0), (0, 0.2, 0.25))
    shoot('t4_cockpit', (1.25, 1.05, 1.75), (0, -0.25, 0.45), lens=35)
    shoot('t5_under', (2.2, -1.6, -1.5), (0, 0.0, -0.1), lens=35, hide_floor=True)
    shoot('t6_stern', (0.9, 2.3, 0.35), (0, 1.5, 0.0), lens=40)
else:
    js = glb_json(ROOT + '/public/models/characters/player.glb')
    ex = js['scenes'][js.get('scene', 0)]['extras']['ski']
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=ROOT + '/public/models/characters/player.glb')
    new = [o for o in bpy.context.scene.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE'); top = next(o for o in new if o.parent is None)
    seat = Vector(info['points']['Seat'])
    top.location = top.location + B(seat - Vector(ex['pelvis']))  # the armature node keeps its own glTF offset
    for o in new:
        if o.name.startswith('Icosphere'): o.hide_render = True  # the importer's bone-shape helper
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
    else: arm.animation_data_create()
    for clip in ex['clips']:
        act = next(a for a in bpy.data.actions if a.name.split('_Arm')[0] == clip or a.name.startswith(clip + '_') and not a.name.startswith(clip + '_l') and not a.name.startswith(clip + '_r') or a.name == clip)
        arm.animation_data.action = act
        if hasattr(arm.animation_data, 'action_slot') and act.slots: arm.animation_data.action_slot = act.slots[0]
        steer = ex['steerDeg'].get(clip, 0)
        ski['Bars'].rotation_mode = 'XYZ'; ski['Bars'].rotation_euler = (0, 0, math.radians(steer))
        sc.frame_set(0)
        shoot(f'r_{clip}_side', (5.4, -0.3, 1.0), (0, -0.1, 0.78))
        shoot(f'r_{clip}_front', (2.8, -3.9, 2.0), (0, -0.1, 0.80))
        shoot(f'r_{clip}_top', (0.0, 0.9, 3.4), (0, -0.2, 0.5), lens=40)
