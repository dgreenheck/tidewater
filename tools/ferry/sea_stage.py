"""Render-only sea stage for the terminal renders (the game draws its own water; nothing here is exported).
The same approach as ferry_render.py: Blender's ocean simulation makes a real wind sea with foam, a near field
around the harbour and a far field out to the horizon. On top of that the near field is baked to a mesh and its
wave heights are damped by a calm mask (inside a sheltered polygon the sea is calmer), and the water material is
painted by depth: turquoise shallows over pale sand and dark weed inside the cove, deeper blue offshore.
Use from a Blender script:  import sea_stage; sea_stage.build(calm_poly=[(x, y), ...], centre=(x, y), ...)
"""
import math
import bpy
import numpy as np


def _sock(sockets, name, kind):
    return next(s for s in sockets if s.name == name and s.type == kind)


def _set(nt, sock, v):
    if isinstance(v, bpy.types.NodeSocket): nt.links.new(v, sock)
    else: sock.default_value = v


def mixc(nt, fac, a, b, blend='MIX'):
    """Colour mix; each of fac, a, b is a socket or a value. Returns the colour output socket."""
    m = nt.nodes.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = blend; m.clamp_result = True
    _set(nt, _sock(m.inputs, 'Factor', 'VALUE'), fac); _set(nt, _sock(m.inputs, 'A', 'RGBA'), a); _set(nt, _sock(m.inputs, 'B', 'RGBA'), b)
    return _sock(m.outputs, 'Result', 'RGBA')


def mrange(nt, v, a, b, c=0.0, d=1.0, smooth=True):
    m = nt.nodes.new('ShaderNodeMapRange'); m.clamp = True
    if smooth: m.interpolation_type = 'SMOOTHSTEP'
    _set(nt, m.inputs['Value'], v)
    for k, x in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)): m.inputs[k].default_value = x
    return m.outputs['Result']


def math_op(nt, op, a, b=0.0):
    m = nt.nodes.new('ShaderNodeMath'); m.operation = op; m.use_clamp = False
    _set(nt, m.inputs[0], a); _set(nt, m.inputs[1], b)
    return m.outputs[0]


def noise(nt, vec, scale, detail=4.0, rough=0.55, dim='3D'):
    n = nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = dim
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    nt.links.new(vec, n.inputs['Vector'])
    return n.outputs['Fac']


def _ocean(name, size, resolution, repeat, depth, centre, wave_scale, chop, wind, time):
    bpy.ops.mesh.primitive_plane_add(size=2, location=(centre[0] - size * repeat / 2, centre[1] - size * repeat / 2, depth))
    sea = bpy.context.object; sea.name = name
    oc = sea.modifiers.new('Ocean', 'OCEAN'); oc.geometry_mode = 'GENERATE'
    oc.spatial_size = int(size); oc.repeat_x = repeat; oc.repeat_y = repeat; oc.resolution = resolution
    if hasattr(oc, 'viewport_resolution'): oc.viewport_resolution = resolution     # the bake reads the viewport evaluation; cells per tile side = resolution squared
    oc.wave_scale = wave_scale; oc.choppiness = chop; oc.wind_velocity = wind
    oc.wave_alignment = 0.3; oc.wave_direction = math.radians(30)
    oc.use_normals = True; oc.use_foam = True; oc.foam_layer_name = 'foam'; oc.foam_coverage = -0.3; oc.time = time
    return sea


def _inside(px, py, poly):
    c = np.zeros(px.shape, bool)
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        dy = (y1 - y0) if abs(y1 - y0) > 1e-9 else 1e-9
        c ^= ((y0 > py) != (y1 > py)) & (px < (x1 - x0) * (py - y0) / dy + x0)
    return c


def _edge_dist(px, py, poly, closed=True, index=False):
    best = np.full(px.shape, 1e9); which = np.zeros(px.shape, np.int32)
    for k, ((x0, y0), (x1, y1)) in enumerate(zip(poly, poly[1:] + (poly[:1] if closed else []))):
        vx, vy = x1 - x0, y1 - y0; L2 = max(vx * vx + vy * vy, 1e-9)
        t = np.clip(((px - x0) * vx + (py - y0) * vy) / L2, 0.0, 1.0)
        d = np.hypot(px - (x0 + t * vx), py - (y0 + t * vy))
        if index: which = np.where(d < best, k, which)
        best = np.minimum(best, d)
    return (best, which) if index else best


def calm_factor(px, py, poly, inner=0.25, feather=40.0):
    """1 in open water; inside poly it falls to `inner` over `feather` metres from the polygon edge."""
    d = _edge_dist(px, py, poly); s = np.clip(d / feather, 0.0, 1.0); s = s * s * (3 - 2 * s)
    return np.where(_inside(px, py, poly), 1.0 - (1.0 - inner) * s, 1.0)


def bake_calm(sea, poly, inner=0.25, feather=40.0, toe_line=None, toe_w=None):
    """Bake the ocean to a mesh, damp its heights by the calm mask and store the mask as the 'calm' attribute.
    With toe_line (a breakwater centreline) and toe_w (its waterline half width per segment) it also stores 'toe'
    (1 over the submerged armour just off the waterline) and 'wash' (a band of broken water along the waterline)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(sea.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    n = len(me.vertices); co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(n, 3)
    k = calm_factor(co[:, 0] + sea.location.x, co[:, 1] + sea.location.y, poly, inner, feather).astype(np.float32)
    co[:, 2] *= k
    me.vertices.foreach_set('co', co.ravel())
    at = me.attributes.new('calm', 'FLOAT', 'POINT'); at.data.foreach_set('value', k)
    if toe_line:
        wx, wy = co[:, 0] + sea.location.x, co[:, 1] + sea.location.y; tl = np.asarray(toe_line)
        sel = np.nonzero((wx > tl[:, 0].min() - 30) & (wx < tl[:, 0].max() + 30) & (wy > tl[:, 1].min() - 30) & (wy < tl[:, 1].max() + 30))[0]
        d = np.full(n, 1e9); i = np.zeros(n, np.int32)
        d[sel], i[sel] = _edge_dist(wx[sel], wy[sel], [tuple(q) for q in toe_line], False, True)
        w = np.asarray(toe_w, np.float32)[np.minimum(i, len(toe_w) - 1)]
        toe = np.clip((w + 5.0 - d) / 4.0, 0.0, 1.0).astype(np.float32)
        wash = (np.clip(1.0 - np.abs(d - w - 0.4) / 1.8, 0.0, 1.0) * (0.35 + 0.65 * k ** 2)).astype(np.float32)
        for name, arr in (('toe', toe), ('wash', wash)):
            a = me.attributes.new(name, 'FLOAT', 'POINT'); a.data.foreach_set('value', arr)
    sea.modifiers.clear(); old = sea.data; sea.data = me; bpy.data.meshes.remove(old)
    try:
        if me.has_custom_normals:
            with bpy.context.temp_override(object=sea, active_object=sea, selected_objects=[sea]):
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as err:
        print('SEA custom normals kept', err)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons)); me.update()
    print(f'SEA near field {n} vertices, calm inside {float((k < 0.99).mean()):.2f} of them')
    return sea


def water_material(shallow_at, near=70.0, far=190.0):
    """Depth-painted water: turquoise over sand and weed within `near`..`far` metres of shallow_at, deep blue
    beyond; ocean foam (damped by the calm attribute) mixed to white; glassy with sky reflections."""
    mat = bpy.data.materials.new('SeaWater'); mat.use_nodes = True; nt = mat.node_tree
    b = nt.nodes['Principled BSDF']; N = nt.nodes.new
    geo = N('ShaderNodeNewGeometry'); P = geo.outputs['Position']
    dist = N('ShaderNodeVectorMath'); dist.operation = 'DISTANCE'; nt.links.new(P, dist.inputs[0])
    dist.inputs[1].default_value = (shallow_at[0], shallow_at[1], 0.0)
    warp = math_op(nt, 'MULTIPLY_ADD', noise(nt, P, 0.006, 3), 150.0); warp.node.inputs[2].default_value = -75.0
    shallow = mrange(nt, math_op(nt, 'ADD', dist.outputs['Value'], warp), near, far, 1.0, 0.0)
    col = mixc(nt, shallow, (0.004, 0.03, 0.065, 1), (0.045, 0.33, 0.32, 1))
    sand = math_op(nt, 'MULTIPLY', mrange(nt, noise(nt, P, 0.018, 5, 0.6), 0.5, 0.64), shallow)
    col = mixc(nt, sand, col, (0.13, 0.46, 0.41, 1))
    weed = math_op(nt, 'MULTIPLY', mrange(nt, noise(nt, P, 0.04, 6, 0.62), 0.56, 0.68), shallow)
    col = mixc(nt, weed, col, (0.018, 0.085, 0.07, 1))
    clumps = math_op(nt, 'MULTIPLY', mrange(nt, noise(nt, P, 0.2, 6, 0.65), 0.6, 0.7), shallow)        # weed clumps
    col = mixc(nt, clumps, col, (0.02, 0.1, 0.085, 1))
    ta = N('ShaderNodeAttribute'); ta.attribute_name = 'toe'                                 # submerged armour
    toe = math_op(nt, 'MULTIPLY', ta.outputs['Fac'], mrange(nt, noise(nt, P, 0.9, 5), 0.3, 0.62, 0.55, 0.95))
    col = mixc(nt, toe, col, (0.02, 0.055, 0.045, 1))
    streak = mrange(nt, noise(nt, P, 0.11, 3), 0.45, 0.62, 0.0, 0.25)                      # wind lanes
    col = mixc(nt, streak, col, (0.03, 0.2, 0.22, 1))
    fa = N('ShaderNodeAttribute'); fa.attribute_name = 'foam'
    ca = N('ShaderNodeAttribute'); ca.attribute_name = 'calm'
    calm = mrange(nt, ca.outputs['Fac'], 0.0, 1.0, 0.0, 1.0, False)
    has_calm = N('ShaderNodeAttribute'); has_calm.attribute_name = 'calm'                   # far field: no attribute -> 0
    open_sea = math_op(nt, 'MAXIMUM', calm, mrange(nt, has_calm.outputs['Alpha'], 0.5, 0.0, 0.0, 1.0, False))
    foam = math_op(nt, 'MULTIPLY', mrange(nt, fa.outputs['Fac'], 0.3, 0.75), math_op(nt, 'POWER', open_sea, 2.0))
    lace = mrange(nt, noise(nt, P, 1.6, 8, 0.7), 0.35, 0.6)
    foam = math_op(nt, 'MULTIPLY', foam, lace)
    wa = N('ShaderNodeAttribute'); wa.attribute_name = 'wash'                                # broken water on the rocks
    wash = math_op(nt, 'MULTIPLY', mrange(nt, wa.outputs['Fac'], 0.05, 0.8), math_op(nt, 'MULTIPLY',
                   mrange(nt, noise(nt, P, 0.85, 10, 0.72), 0.38, 0.6), mrange(nt, noise(nt, P, 0.09, 3), 0.28, 0.55)))
    foam = math_op(nt, 'MAXIMUM', foam, wash)
    col = mixc(nt, foam, col, (0.82, 0.86, 0.87, 1))
    nt.links.new(col, b.inputs['Base Color'])
    nt.links.new(mrange(nt, foam, 0.0, 1.0, 0.05, 0.5, False), b.inputs['Roughness'])
    b.inputs['IOR'].default_value = 1.333
    bump = N('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.26; bump.inputs['Distance'].default_value = 0.05
    nt.links.new(math_op(nt, 'ADD', noise(nt, P, 0.9, 6), math_op(nt, 'MULTIPLY', noise(nt, P, 3.2, 4), 0.5)), bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return mat


def build(calm_poly, centre, shallow_at, inner=0.25, feather=40.0, toe_line=None, toe_w=None, resolution=16):
    """A near wind sea (200 m tiles x 6, baked and damped inside calm_poly) and a far field to the horizon."""
    mat = water_material(shallow_at)
    near = _ocean('Sea', 200.0, resolution, 6, 0.0, centre, 0.42, 1.05, 5.5, 12.0)
    bake_calm(near, calm_poly, inner, feather, toe_line, toe_w)
    far = _ocean('Far sea', 200.0, 8, 40, -0.6, centre, 0.42, 1.05, 5.5, 12.0)      # same sea as the near field, so no seam in tone
    for o in (near, far): o.data.materials.append(mat)
    return near, far
