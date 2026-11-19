"""Review renders of the ferry: opens assets/ferry/ferry.blend, adds sky, sun and sea, renders
named views with Cycles. Run:
  Blender --background assets/ferry/ferry.blend --python tools/ferry/ferry_render.py -- OUT_DIR [view ...]
Views: photo ref bow34 stern34 profile aerial rampdown bridge deck helm wheel saloon cafe sterndeck stairs
"""
import sys, math
from tempfile import gettempdir
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ferry_paint

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = Path(args[0] if args else Path(gettempdir()) / 'ferry-renders'); out.mkdir(parents=True, exist_ok=True)
wanted = args[1:] or ['photo', 'bow34', 'stern34', 'profile', 'aerial', 'rampdown']

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices: d.use = True
scene.cycles.device = 'GPU'
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1920, 1200
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'

# A real sea and sky, so the ship is judged as a ship: a deep, clear sky with a matching sun,
# a wind sea from Blender's ocean simulation (with foam), and a low island on the horizon.
world = bpy.data.worlds.new('Sky'); scene.world = world; world.use_nodes = True
nodes = world.node_tree.nodes; links = world.node_tree.links
# A clear coastal sky: pale and hazy at the horizon, deepening to blue overhead.
coords = nodes.new('ShaderNodeTexCoord')
along = nodes.new('ShaderNodeSeparateXYZ')
sky_ramp = nodes.new('ShaderNodeValToRGB')
HORIZON = (0.42, 0.6, 0.85, 1)
sky_ramp.color_ramp.elements[0].position = 0.0; sky_ramp.color_ramp.elements[0].color = HORIZON
sky_ramp.color_ramp.elements[1].position = 0.5; sky_ramp.color_ramp.elements[1].color = (0.03, 0.13, 0.55, 1)
mid = sky_ramp.color_ramp.elements.new(0.1); mid.color = (0.14, 0.34, 0.78, 1)
links.new(coords.outputs['Generated'], along.inputs['Vector'])
links.new(along.outputs['Z'], sky_ramp.inputs['Fac'])
links.new(sky_ramp.outputs['Color'], nodes['Background'].inputs['Color'])
SKY_STRENGTH = 1.6
nodes['Background'].inputs['Strength'].default_value = SKY_STRENGTH
SUN_ELEVATION, SUN_ROTATION = math.radians(50), math.radians(135)
bpy.ops.object.light_add(type='SUN', rotation=(math.pi / 2 - SUN_ELEVATION, 0, SUN_ROTATION + math.pi / 2))
sun = bpy.context.object; sun.data.energy = 5.4; sun.data.angle = math.radians(0.6)
sun.data.color = (1.0, 0.96, 0.9)

def haze(mat, start=400.0, end=9000.0, most=0.6):
    """Aerial perspective: blend toward the horizon sky with distance from the camera."""
    nt = mat.node_tree; n = nt.nodes
    out = n['Material Output']; shader = out.inputs['Surface'].links[0].from_socket
    cam = n.new('ShaderNodeCameraData')
    fade = n.new('ShaderNodeMapRange'); fade.interpolation_type = 'SMOOTHSTEP'
    fade.inputs['From Min'].default_value = start; fade.inputs['From Max'].default_value = end
    fade.inputs['To Max'].default_value = most
    air = n.new('ShaderNodeEmission'); air.inputs['Color'].default_value = HORIZON; air.inputs['Strength'].default_value = SKY_STRENGTH
    blend = n.new('ShaderNodeMixShader')
    nt.links.new(cam.outputs['View Distance'], fade.inputs['Value'])
    nt.links.new(fade.outputs['Result'], blend.inputs['Fac'])
    nt.links.new(shader, blend.inputs[1]); nt.links.new(air.outputs['Emission'], blend.inputs[2])
    nt.links.new(blend.outputs['Shader'], out.inputs['Surface'])

WATER = (0.004, 0.028, 0.06, 1)
mat = bpy.data.materials.new('Sea'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.08
bsdf.inputs['IOR'].default_value = 1.333
foam = nt.nodes.new('ShaderNodeAttribute'); foam.attribute_name = 'foam'
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.9; ramp.color_ramp.elements[1].position = 1.0
ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1)
mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
nt.links.new(foam.outputs['Fac'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], mix.inputs['Factor'])
mix.inputs['A'].default_value = WATER; mix.inputs['B'].default_value = (0.8, 0.85, 0.88, 1)
nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
haze(mat)

# The wake, as a foam mask on the sea surface in the render frame (bow toward -Y, stern at +25.2):
# foam hugging the hulls and the tunnel, a bow wave off each stem, the churned trail astern and the
# diverging Kelvin arms. The sea shader breaks it up with streaky noise so it rides the waves.
import numpy as np
WX0, WX1, WY0, WY1, RES = -80.0, 80.0, -45.0, 235.0, 0.2
NXp, NYp = int((WX1 - WX0) / RES), int((WY1 - WY0) / RES)
XX, YY = np.meshgrid(WX0 + (np.arange(NXp) + 0.5) * RES, WY0 + (np.arange(NYp) + 0.5) * RES)
MY = -YY                                                       # model y
def wl_np(y):
    t = np.clip((y - 8.0) / (22.6 - 8.0), 0, 1); t = t * t * (3 - 2 * t)
    return np.where(y >= 22.6, 0.0, 2.2 * np.clip(1 - t ** 1.5, 0, 1) ** 0.7)
mask = np.zeros_like(XX)
on_hull = (MY < 22.8) & (MY > -25.2)
along = np.clip((22.6 - MY) / 47.8, 0, 1)
for sgn in (1, -1):
    d = (XX - sgn * (6.7 + wl_np(MY))) * sgn
    w = 0.7 + 3.4 * along
    mask = np.maximum(mask, np.where(on_hull & (d > -0.3) & (d < w), (1 - np.clip(d / w, 0, 1)) ** 1.3 * (0.6 + 0.4 * (1 - along)), 0))
    d2 = (sgn * (6.7 - wl_np(MY)) - XX) * sgn
    w2 = 0.6 + 2.2 * along
    mask = np.maximum(mask, np.where(on_hull & (d2 > -0.3) & (d2 < w2), (1 - np.clip(d2 / w2, 0, 1)) ** 1.5 * 0.7, 0))
    # bow wave: a crest running out and aft from the stem at about 22 degrees, fading
    back = 22.6 - MY
    xb = sgn * (6.7 + back * np.tan(np.radians(22)))
    crest = np.exp(-((XX - xb) / (0.6 + back * 0.03)) ** 2) * np.exp(-np.clip(back, 0, None) / 14) * (back > -0.5)
    mask = np.maximum(mask, crest * 1.0)
    stem = np.exp(-((XX - sgn * 6.7) / 1.2) ** 2 - ((MY - 21.8) / 2.2) ** 2)
    mask = np.maximum(mask, stem * 0.95)
aft = -25.2 - MY
for sgn in (1, -1):
    cx = sgn * 6.7 * np.exp(-np.clip(aft, 0, None) / 45)
    w = 3.2 + np.clip(aft, 0, None) * 0.22
    mask = np.maximum(mask, np.where(aft > 0, np.exp(-((XX - cx) / w) ** 2) * np.exp(-aft / 95) * 1.1, 0))
    xa = sgn * (9.0 + np.clip(aft, 0, None) * np.tan(np.radians(19.5)))
    mask = np.maximum(mask, np.where(aft > 0, np.exp(-((XX - xa) / (0.9 + aft * 0.012)) ** 2) * np.exp(-aft / 130) * 0.55, 0))
mid = np.where(aft > 0, np.exp(-(XX / (5.0 + np.clip(aft, 0, None) * 0.25)) ** 2) * np.exp(-aft / 80) * 0.8 * np.clip(aft / 6, 0, 1), 0)
mask = np.maximum(mask, mid)
mask = np.clip(mask, 0, 1).astype(np.float32)
wake_img = bpy.data.images.new('WakeMask', NXp, NYp, float_buffer=True)
px = np.zeros((NYp, NXp, 4), dtype=np.float32); px[..., 0] = mask; px[..., 1] = mask; px[..., 2] = mask; px[..., 3] = 1.0
wake_img.pixels.foreach_set(px.ravel())
nt = mat.node_tree; wn, wl_ = nt.nodes, nt.links
geo = wn.new('ShaderNodeNewGeometry')
mp = wn.new('ShaderNodeMapping'); mp.vector_type = 'POINT'
mp.inputs['Scale'].default_value = (1 / (WX1 - WX0), 1 / (WY1 - WY0), 1)
mp.inputs['Location'].default_value = (-WX0 / (WX1 - WX0), -WY0 / (WY1 - WY0), 0)
wl_.new(geo.outputs['Position'], mp.inputs['Vector'])
tex = wn.new('ShaderNodeTexImage'); tex.image = wake_img; tex.extension = 'CLIP'; tex.interpolation = 'Linear'
wl_.new(mp.outputs['Vector'], tex.inputs['Vector'])
sm = wn.new('ShaderNodeMapping'); sm.inputs['Scale'].default_value = (1.0, 0.6, 1.0)
wl_.new(geo.outputs['Position'], sm.inputs['Vector'])
streak_n = wn.new('ShaderNodeTexNoise'); streak_n.inputs['Scale'].default_value = 1.1; streak_n.inputs['Detail'].default_value = 10; streak_n.inputs['Roughness'].default_value = 0.62
wl_.new(sm.outputs['Vector'], streak_n.inputs['Vector'])
fine_n = wn.new('ShaderNodeTexNoise'); fine_n.inputs['Scale'].default_value = 5.0; fine_n.inputs['Detail'].default_value = 12; fine_n.inputs['Roughness'].default_value = 0.7
wl_.new(geo.outputs['Position'], fine_n.inputs['Vector'])
blend_n = wn.new('ShaderNodeMix'); blend_n.data_type = 'FLOAT'; blend_n.inputs['Factor'].default_value = 0.55
wl_.new(streak_n.outputs['Fac'], blend_n.inputs['A']); wl_.new(fine_n.outputs['Fac'], blend_n.inputs['B'])
class _S: pass
streak = _S(); streak.outputs = {'Fac': blend_n.outputs['Result']}
def m_(op, a, b=None, clamp=True):
    q = wn.new('ShaderNodeMath'); q.operation = op; q.use_clamp = clamp
    for sock, val in ((q.inputs[0], a), (q.inputs[1], b)):
        if val is None: continue
        if isinstance(val, float): sock.default_value = val
        else: wl_.new(val, sock)
    return q.outputs[0]
WAKE_ON = wn.new('ShaderNodeValue'); WAKE_ON.outputs[0].default_value = 1.0
wmask = m_('MULTIPLY', tex.outputs['Color'], WAKE_ON.outputs[0])
lace = m_('MULTIPLY', m_('ADD', m_('ADD', streak.outputs['Fac'], wmask, False), -0.95, False), 3.5)
wfoam = m_('MULTIPLY', lace, m_('MULTIPLY', wmask, 2.2))
aerated = m_('MULTIPLY', wmask, 1.3)
bsdf = nt.nodes['Principled BSDF']
old = bsdf.inputs['Base Color'].links[0].from_socket
amix = wn.new('ShaderNodeMix'); amix.data_type = 'RGBA'
wl_.new(aerated, amix.inputs['Factor']); wl_.new(old, amix.inputs['A']); amix.inputs['B'].default_value = (0.05, 0.2, 0.26, 1)
wmix = wn.new('ShaderNodeMix'); wmix.data_type = 'RGBA'
wl_.new(wfoam, wmix.inputs['Factor']); wl_.new(amix.outputs['Result'], wmix.inputs['A']); wmix.inputs['B'].default_value = (0.82, 0.87, 0.9, 1)
wl_.new(wmix.outputs['Result'], bsdf.inputs['Base Color'])
wl_.new(m_('ADD', m_('MULTIPLY', wfoam, 0.55), 0.08), bsdf.inputs['Roughness'])

def sea_field(name, size, resolution, repeat, depth):
    """A tiled ocean simulation centred on the ship, `depth` below the waterline."""
    bpy.ops.mesh.primitive_plane_add(size=2, location=(-size * repeat / 2, -size * repeat / 2, depth))
    sea = bpy.context.object; sea.name = name
    ocean = sea.modifiers.new('Ocean', 'OCEAN')
    ocean.geometry_mode = 'GENERATE'
    ocean.spatial_size = int(size); ocean.repeat_x = repeat; ocean.repeat_y = repeat
    ocean.resolution = resolution
    if hasattr(ocean, 'viewport_resolution'): ocean.viewport_resolution = 4
    ocean.wave_scale = 0.42; ocean.choppiness = 1.05; ocean.wind_velocity = 5.5
    ocean.wave_alignment = 0.3; ocean.wave_direction = math.radians(30)
    ocean.use_normals = True; ocean.use_foam = True; ocean.foam_layer_name = 'foam'; ocean.foam_coverage = -0.3
    ocean.time = 12.0
    sea.data.materials.append(mat)
    return sea
# Near the ship a fine sea with a long tile (so its pattern doesn't visibly repeat); beyond it,
# a coarser simulation out past the horizon, sunk a little so the fine one always covers it.
sea_field('Sea', 200.0, 24, 6, 0.0)
sea_field('Far sea', 200.0, 8, 40, -0.6)

# A long low island on the horizon: a plateau with soft cliffs and rolling tops, hazed by distance.
def island_height(x, d):
    """Height at x along the island, d metres back from its shore."""
    ridge = 140 + 38 * math.sin(x * 0.0011) + 22 * math.sin(x * 0.0031 + 1.3) + 9 * math.sin(x * 0.009 + 0.4)
    ends = max(0.0, min(1.0, (9000 - abs(x)) / 2500)) ** 0.7
    return ridge * ends * (1 - math.exp(-d / 260)) - 3
NX, ND = 260, 24
verts, faces = [], []
ISLE_C, ISLE_T = (6900.0, 5480.0), (-0.62, 0.78)     # across the ref view, 9 km out; its shore line
for i in range(NX + 1):
    x = -11000 + 22000 * i / NX
    for j in range(ND + 1):
        d = 1800 * (j / ND) ** 1.6
        verts.append((ISLE_C[0] + ISLE_T[0] * x + ISLE_T[1] * d, ISLE_C[1] + ISLE_T[1] * x - ISLE_T[0] * d, island_height(x, d)))
for i in range(NX):
    for j in range(ND):
        a = i * (ND + 1) + j
        faces.append((a, a + ND + 1, a + ND + 2, a + 1))
land_data = bpy.data.meshes.new('Horizon island'); land_data.from_pydata(verts, [], faces)
for poly in land_data.polygons: poly.use_smooth = True
land = bpy.data.objects.new('Horizon island', land_data); bpy.context.collection.objects.link(land)
lm = bpy.data.materials.new('Distant land'); lm.use_nodes = True
ln = lm.node_tree.nodes; ll = lm.node_tree.links
lb = ln['Principled BSDF']; lb.inputs['Roughness'].default_value = 0.95
tone = ln.new('ShaderNodeTexNoise'); tone.inputs['Scale'].default_value = 0.0025; tone.inputs['Detail'].default_value = 8
tint = ln.new('ShaderNodeValToRGB')
tint.color_ramp.elements[0].color = (0.045, 0.06, 0.035, 1); tint.color_ramp.elements[1].color = (0.12, 0.095, 0.065, 1)
lb.inputs['Emission Color'].default_value = (0.36, 0.46, 0.6, 1); lb.inputs['Emission Strength'].default_value = 0.28
lc = ln.new('ShaderNodeTexCoord'); ll.new(lc.outputs['Object'], tone.inputs['Vector'])
ll.new(tone.outputs['Fac'], tint.inputs['Fac']); ll.new(tint.outputs['Color'], lb.inputs['Base Color'])
land.data.materials.append(lm)
haze(lm, 1000.0, 14000.0, 0.5)
scene.view_settings.exposure = -0.35
ferry_paint.apply()

def camera(name, location, target, lens=35):
    data = bpy.data.cameras.new(name); data.lens = lens; data.clip_end = 30000
    cam = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(cam)
    cam.location = location
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
    return cam

# The model faces -Y here (the export turns it); starboard is -X.
ramp = bpy.data.objects.get('SternRamp')
views = {
    'photo': (( -150, 58, 30 ), ( 0, -4, 4.5 ), 62),
    'ref': (( -124, -102, 26 ), ( 0, -3, 5.0 ), 62),       # the reference photo's angle (starboard bow)
    'sideclose': (( -34, 4, 7.5 ), ( -8, -1, 6.0 ), 30),    # the starboard side's paint up close
    'aerial1': (( 62, -40, 58 ), ( 0, -2, 5.0 ), 45),       # like the port-bow aerial underway
    'bowlow': (( -24, -42, 5.0 ), ( -3, -20, 4.5 ), 32),     # like the bow at the jetty
    'sternq': (( 42, 58, 26 ), ( 0, 6, 6.0 ), 35),          # port quarter from above: wings, car deck, ramp
    'ref9': (( -124, -102, 26 ), ( 0, -1.5, 4.8 ), 100, (1702, 746)),   # framed like the reference close crop
    'bow34': (( -38, -46, 4.5 ), ( 0, -6, 6.5 ), 32),
    'stern34': (( 30, 44, 6.0 ), ( 0, 10, 5.5 ), 32),
    'profile': (( -120, -2, 5.0 ), ( 0, -2, 6.0 ), 60),
    'aerial': (( 42, 58, 44 ), ( 0, -2, 6.0 ), 30),
    'rampdown': (( 9, 40, 5.2 ), ( 0, 20, 4.8 ), 28),
    'bridge': (( -14, -30, 16 ), ( 0, -10, 12 ), 30),
    'helm': (( 0, -13.45, 11.7 ), ( 0, -30, 11.2 ), 22),
    'wheel': (( 1.1, -13.3, 11.55 ), ( 0, -14.4, 11.0 ), 30),
    'saloon': (( 1.1, -1.2, 8.65 ), ( -0.4, -16, 8.0 ), 20),
    'cafe': (( 4.0, -8.0, 8.7 ), ( 4.2, -1.0, 8.0 ), 22),
    'cardeck': (( 0, 27.5, 13.0 ), ( 0, 5, 4.0 ), 26),
    'stairs': (( -7.3, 1.5, 8.2 ), ( -7.2, 8.0, 3.5 ), 18),
    'sundeck': (( -7.0, 12, 11.8 ), ( -2.0, -5.0, 11.0 ), 22),
    'bowdeck': (( 0, -24.2, 8.7 ), ( 0, -14, 10.0 ), 20),
    'corridor': (( -8.3, 21.0, 8.6 ), ( -8.0, 5.0, 8.2 ), 20),
}
FILL = {'helm': ((0, -13.0, 12.9), 900), 'wheel': ((0, -13.0, 12.9), 900), 'saloon': ((0, -8.0, 9.6), 650),
        'cafe': ((4, -3, 9.6), 1500), 'stairs': ((-7.3, 5, 6.0), 400), 'corridor': ((-7.8, 12, 9.4), 700)}
WAKE_VIEWS = {'ref', 'ref9', 'photo', 'aerial1', 'sternq', 'profile', 'bow34'}
SUN_VIEWS = {'bowlow': math.radians(20), 'bowdeck': math.radians(20)}
# A few passengers for scale (renders only; the game has its own people).
import random
rnd = random.Random(7)
CLOTHES = [(0.6, 0.08, 0.08), (0.08, 0.15, 0.4), (0.85, 0.82, 0.75), (0.1, 0.1, 0.1), (0.2, 0.4, 0.2), (0.75, 0.45, 0.1), (0.5, 0.2, 0.5)]
SKIN = [(0.6, 0.42, 0.3), (0.42, 0.28, 0.18), (0.8, 0.62, 0.5)]
def person(mx, my, z, yaw):
    x, y = -mx, -my
    h = rnd.uniform(1.6, 1.85)
    top = bpy.data.materials.new('Top'); top.diffuse_color = (*rnd.choice(CLOTHES), 1)
    top.use_nodes = True; top.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rnd.choice(CLOTHES), 1)
    legs = bpy.data.materials.new('Legs'); legs.use_nodes = True
    legs.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rnd.choice(CLOTHES[:4]), 1)
    skin = bpy.data.materials.new('Skin'); skin.use_nodes = True
    skin.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rnd.choice(SKIN), 1)
    for dx in (-0.1, 0.1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=h * 0.47, location=(x + dx * math.cos(yaw), y + dx * math.sin(yaw), z + h * 0.235))
        bpy.context.object.data.materials.append(legs)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.19, depth=h * 0.33, location=(x, y, z + h * 0.62))
    bpy.context.object.scale = (1.0, 0.7, 1.0); bpy.context.object.rotation_euler.z = yaw
    bpy.context.object.data.materials.append(top)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, location=(x, y, z + h * 0.88))
    bpy.context.object.data.materials.append(skin)
for mx, my, z, yaw in ((-1.5, 24.6, 7.0, 0.3), (-0.8, 24.7, 7.0, 0.1), (2.4, 24.3, 7.0, -0.4), (3.1, 24.0, 7.0, 0.2), (-4.5, 21.5, 7.0, 1.2),
                       (8.3, -21.8, 10.0, 1.4), (8.2, -21.2, 10.0, 1.7), (7.3, -20.0, 10.0, 0.5), (-8.3, -3.6, 10.0, 4.6), (-7.2, -11.8, 10.0, 4.3),
                       (2.5, 3.0, 10.0, 0.0), (-3.2, 2.2, 10.0, 0.7), (-1.0, 4.4, 10.0, 3.0)):
    person(mx, my, z, yaw)
# Inside, the tinted glass keeps it dim: a warm fill for the interior views.
bpy.ops.object.light_add(type='AREA', location=(0, -10.5, 13.3))
fill = bpy.context.object; fill.data.energy = 0; fill.data.size = 3.0; fill.data.color = (1.0, 0.94, 0.85)
for name in wanted:
    location, target, lens, *res = views[name]
    scene.render.resolution_x, scene.render.resolution_y = res[0] if res else (1920, 1200)
    WAKE_ON.outputs[0].default_value = 1.0 if name in WAKE_VIEWS else 0.0
    rot = SUN_VIEWS.get(name, SUN_ROTATION)
    sun.rotation_euler = (math.pi / 2 - SUN_ELEVATION, 0, rot + math.pi / 2)
    if ramp: ramp.rotation_euler.x = 0.09 if name == 'rampdown' else -math.pi / 2 * 0.98
    at, energy = FILL.get(name, ((0, 0, -50), 0))
    fill.location = at; fill.data.energy = energy; fill.data.size = 6.0 if name in ('saloon', 'cafe') else 3.0
    scene.camera = camera(name, location, target, lens)
    scene.render.filepath = str(out / f'ferry-{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)
