# Cycles review renders of player.glb on a neutral stage (evidence only, not part of the build).
#   blender -b --python player_review.py -- <player.glb> <outdir>
# Writes front / three-quarter / back / face stills (idle), 8 phases each of walk and run (profile) and the jump keys.
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = argv[:2]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
print('REVIEW actions', [a.name for a in bpy.data.actions])

def action(name):
    for a in bpy.data.actions:
        if a.name == name: return a
    return next(a for a in bpy.data.actions if a.name.startswith(name + '_'))

def play(name, frame):
    a = action(name)
    arm.animation_data_create()
    for t in arm.animation_data.nla_tracks: t.mute = True
    arm.animation_data.action = a
    if hasattr(arm.animation_data, 'action_slot') and a.slots: arm.animation_data.action_slot = a.slots[0]
    sc.frame_set(int(a.frame_range[0] + frame))
    return a

# stage: grey floor, soft grey world, key / fill / rim
w = bpy.data.worlds.new('stage'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.52, 0.55, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
bpy.ops.mesh.primitive_plane_add(size=400)
fm = bpy.data.materials.new('floor'); fm.use_nodes = True
fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.36, 0.36, 0.37, 1)
fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
sc.objects['Plane'].data.materials.append(fm)
def light(kind, loc, energy, size=1.0, rot=None):
    d = bpy.data.lights.new(kind, kind); d.energy = energy
    if kind == 'AREA': d.size = size
    o = bpy.data.objects.new(kind, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = rot or (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light('SUN', (0, 0, 10), 2.2, rot=(math.radians(48), 0, math.radians(-35)))
light('AREA', (-2.5, -3.0, 3.0), 600, 2.5)
light('AREA', (2.0, 3.0, 2.6), 350, 2.0)

cd = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
def shoot(path, loc, target, lens=50, res=(720, 1080), samples=64):
    cd.lens = lens; cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x, sc.render.resolution_y = res; sc.cycles.samples = samples
    sc.render.filepath = os.path.join(OUT, path); bpy.ops.render.render(write_still=True)
    print('REVIEW wrote', path, flush=True)

sc.render.engine = 'CYCLES'; sc.cycles.use_denoising = True
try:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
    for d in pr.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print('REVIEW cpu', e)

D, T = 3.4, (0, 0, 0.98)
play('idle', 0)
for name, ang in (('front', 0), ('three_quarter', 35), ('back', 180)):
    a = math.radians(ang)
    shoot(name + '.png', (D * math.sin(a), -D * math.cos(a), 1.05), T)
shoot('face.png', (0.35, -1.25, 1.74), (0, -0.02, 1.68), lens=85, res=(900, 900))
for clip in ('walk', 'run'):
    a = action(clip); n = a.frame_range[1] - a.frame_range[0]
    for k in range(8):
        play(clip, round(k * n / 8)); shoot(f'{clip}_{k}.png', (D, -0.4, 1.05), (0, 0, 0.98), res=(420, 640), samples=24)
for clip, f in (('jump_start', 5), ('jump_start', 10), ('jump_loop', 0), ('jump_loop', 12), ('jump_land', 4)):
    play(clip, f); shoot(f'{clip}_{f}.png', (D * 0.8, -D * 0.6, 1.05), (0, 0, 0.98), res=(420, 640), samples=24)
