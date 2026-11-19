"""Procedural modelling kit shared by the ferry and terminal builds (Blender, Z up, metres).
Meshes are collected into blender_primitives.groups by name and joined per group at export."""
import math
import bpy, bmesh
from blender_primitives import mesh, join_group, line

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def loft(name, rings, mat, close_start=False, close_end=False, smooth=True, group='Hull'):
    """Skin a list of equal-length point rings (open polylines) into quads."""
    verts, faces = [], []
    n = len(rings[0])
    for r in rings: verts.extend(r)
    for i in range(len(rings) - 1):
        for j in range(n - 1):
            a = i * n + j
            faces.append((a, a + 1, a + n + 1, a + n))
    if close_start: faces.append(tuple(range(n))[::-1])
    if close_end: faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return mesh(name, verts, faces, mat, group, smooth)

def prism(name, outline, z0, z1, mat, group='Structure', bevel=0.0):
    """Extrude a closed (x, y) outline between two heights."""
    n = len(outline)
    verts = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    obj = mesh(name, verts, faces, mat, group, False)
    if bevel: soften(obj, bevel)
    return obj

def block(name, x, y0, y1, z0, z1, mat, rake=0.0, taper=0.0, group='Structure', bevel=0.04):
    """A deckhouse block, half width x from y0 (aft) to y1 (fore); the fore face leans back by
    `rake` metres at the top and the top is `taper` narrower each side (tumblehome)."""
    xt = x - taper
    v = [(-x, y0, z0), (x, y0, z0), (x, y1, z0), (-x, y1, z0),
         (-xt, y0, z1), (xt, y0, z1), (xt, y1 - rake, z1), (-xt, y1 - rake, z1)]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mesh(name, v, f, mat, group, False)
    if bevel: soften(obj, bevel)
    return obj

def soften(obj, width):
    mod = obj.modifiers.new('Bevel', 'BEVEL'); mod.width = width; mod.segments = 2
    mod.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

def cut(obj, inside):
    """Delete the faces whose centre satisfies inside(centre): window and door openings."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    doomed = [f for f in bm.faces if inside(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(obj.data); bm.free()
    return obj

def tube(name, pts, r, mat, group='Fittings'):
    return line(name, pts, r, mat, group)

def pivot(name, location, parts=(), parent=None):
    """An empty at `location` owning the joined `parts` (built in world coordinates)."""
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=location)
    p = bpy.context.object; p.name = name
    if parts:
        obj = join_group(f'{name} mesh', list(parts))
        obj.parent = p; obj.matrix_parent_inverse = p.matrix_world.inverted()
    if parent:
        p.parent = parent; p.matrix_parent_inverse = parent.matrix_world.inverted()
    return p

