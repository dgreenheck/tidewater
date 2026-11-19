"""Hard-surface body modelling for the Blender-built hero cars: a low-poly control cage with creased
character lines, subdivided, its wheel arches cut by boolean, then weighted normals.

The lofted
Fulmine read as a soft inflated body with no crisp creases or planes. Expensive cars read through their
creases: a shoulder line, a door blade, the edges of an intake, the glasshouse. Here every such line is
an edge of the cage with crease 1.0, so the subdivided surface stays flat-ish between them and turns
sharply across them. Glass, lamp housings and intakes are faces of the same cage with their own
material, so their outlines are cage edges too (every edge between two materials is creased).

Frame: Blender Z up, -Y nose, X width (the left side is -X); metres. The root sits on the ground
centred between the axles (hero_kit.py).

Cage layout. A station is a cross section at one y: points j1..j8 run up the right side and j0 / j9 sit
on the centre line at the bottom and top. The ring mirrors the right side to the left, so a ring has
18 points and a car is mirror-symmetric by construction. Band b (0..8) is the strip of faces between
point j=b and j=b+1, and interval i is the strip between station i and station i+1.
"""
import math
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from hero_kit import palette
from blender_primitives import groups

RING = 18                         # points per station: j0, right j1..j8, j9, left j8..j1
BANDS = 9
SUBDIVISIONS = 3                  # cage face -> 64 faces; level 2 left visible facets on the bonnet
SHARP_ANGLE = math.radians(26)    # shading break after subdivision: creases bend about 30 to 60 deg
ARCH_SIDES = 8                    # the arch cutter is an octagon with a flat top: an angular arch
                                  # (a car can ask for more sides: Cage.build(arch_sides=...))
GAP_WIDTH = 0.004                 # m, a shut line as drawn (real panel gaps are 3.5 to 5 mm)
LIFT = 0.0008                     # m above the paint, enough to win the depth test at 25 m


def ring_index(j, side):
    """Ring position of point j on side +1 (right, +X) or -1 (left)."""
    if j in (0, 9) or side > 0:
        return j
    return RING - j


def band_of(k):
    """Band of the ring segment k -> k+1."""
    return k if k < BANDS else RING - 1 - k


class Cage:
    """stations: [(y, [(x, z) for j0..j9])], j0 and j9 with x = 0. material_at(i, b) -> palette name."""

    def __init__(self, stations, material_at):
        self.stations = stations
        self.material_at = material_at
        self.names = []
        self.creases = {}
        verts = []
        for y, points in stations:
            for k in range(RING):
                j = k if k <= 9 else RING - k
                x, z = points[j]
                verts.append((x if k <= 9 else -x, y, z))
        self.verts = verts
        faces, mats = [], []
        for i in range(len(stations) - 1):
            for k in range(RING):
                a, b = i * RING + k, i * RING + (k + 1) % RING
                faces.append((a, b, b + RING, a + RING))
                mats.append(self.material_index(material_at(i, band_of(k))))
        last = (len(stations) - 1) * RING
        faces.append(tuple(reversed(range(RING))))                  # nose cap
        mats.append(self.material_index(material_at(-1, None)))
        faces.append(tuple(range(last, last + RING)))               # tail cap
        mats.append(self.material_index(material_at(len(stations) - 1, None)))
        self.faces, self.mats = faces, mats

    def material_index(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    def crease_line(self, j, i0=0, i1=None, value=1.0):
        """Crease the lengthwise edges through point j from station i0 to i1, both sides."""
        i1 = len(self.stations) - 1 if i1 is None else i1
        for side in (1, -1):
            k = ring_index(j, side)
            for i in range(i0, i1):
                self.creases[frozenset((i * RING + k, (i + 1) * RING + k))] = value

    def crease_ring(self, i, j0=0, j1=9, value=1.0):
        """Crease the edges of station i between points j0 and j1, both sides."""
        for side in (1, -1):
            for j in range(j0, j1):
                a, b = ring_index(j, side), ring_index(j + 1, side)
                self.creases[frozenset((i * RING + a, i * RING + b))] = value

    def build(self, name, arches, arch_material="Graphite", arch_sides=ARCH_SIDES):
        """Subdivide the cage, cut the arches and return the finished shell object (not yet grouped).
        arches: [(y, z, radius, x_inner)], one cutter per side for each. arch_sides: 8 cuts an angular
        arch (the Fulmine); 24 reads round (octagons read angular on round-fendered bodies)."""
        data = bpy.data.meshes.new(name + " cage")
        data.from_pydata(self.verts, [], self.faces)
        for name_ in self.names:
            data.materials.append(palette(name_))
        for poly, m in zip(data.polygons, self.mats):
            poly.material_index = m
            poly.use_smooth = True
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(data)
        bm.free()
        # Every edge between two materials is a crease, so glass, intakes and lamps keep crisp outlines.
        face_mats = {}
        for poly in data.polygons:
            for key in poly.edge_keys:
                face_mats.setdefault(frozenset(key), set()).add(poly.material_index)
        crease = data.attributes.new("crease_edge", "FLOAT", "EDGE")
        for edge in data.edges:
            key = frozenset(edge.vertices)
            value = self.creases.get(key, 0.0)
            if len(face_mats.get(key, ())) > 1:
                value = 1.0
            crease.data[edge.index].value = value
        # A vertex where a creased lengthwise line meets a creased cross line is a corner: without a
        # vertex crease the subdivided crease curve rounds it, and the side window came out an oval.
        corner = data.attributes.new("crease_vert", "FLOAT", "POINT")
        kinds = {}
        for edge in data.edges:
            if crease.data[edge.index].value >= 0.99:
                a, b = edge.vertices
                kind = "length" if a // RING != b // RING else "ring"
                for v in (a, b):
                    kinds.setdefault(v, set()).add(kind)
        for v, seen in kinds.items():
            if len(seen) == 2:
                corner.data[v].value = 1.0
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        sub = obj.modifiers.new("Subdivision", "SUBSURF")
        sub.levels = sub.render_levels = SUBDIVISIONS
        sub.use_creases = True
        cutter = arch_cutters(arches, palette(arch_material), arch_sides)
        cut = obj.modifiers.new("Wheel arches", "BOOLEAN")
        cut.operation = "DIFFERENCE"
        cut.solver = "EXACT"
        cut.object = cutter
        cut.material_mode = "TRANSFER"
        apply_modifiers(obj)
        bpy.data.objects.remove(cutter, do_unlink=True)
        return obj


def apply_modifiers(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.clear()
    old = obj.data
    obj.data = data
    bpy.data.meshes.remove(old)


def arch_cutters(arches, mat, sides=ARCH_SIDES):
    """Prisms of `sides` sides through the side of the body, one per wheel, with a flat top edge: as
    an octagon the arch reads as a cut, not a round fairing. Inscribed radius = radius * cos(pi / sides)."""
    verts, faces = [], []
    for y, z, radius, x_inner in arches:
        for side in (1, -1):
            base = len(verts)
            for x in (side * x_inner, side * 1.6):
                for k in range(sides):
                    a = math.tau * (k + 0.5) / sides
                    verts.append((x, y + radius * math.sin(a), z + radius * math.cos(a)))
            for k in range(sides):
                n = (k + 1) % sides
                faces.append((base + k, base + n, base + sides + n, base + sides + k))
            faces.append(tuple(base + k for k in range(sides)))
            faces.append(tuple(base + sides + k for k in reversed(range(sides))))
    data = bpy.data.meshes.new("Arch cutter")
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new("Arch cutter", data)
    bpy.context.collection.objects.link(obj)
    return obj


def finish_shell(obj, glass_names=("Glass",)):
    """Split the glass faces into their own GlassPanels mesh; shade the rest flat across creases and
    smooth between them with face-area weighted normals (big flat panels stay flat to the edge)."""
    glass_idx = {i for i, m in enumerate(obj.data.materials) if m and m.name in glass_names}
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    glass_bm = bm.copy()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in glass_idx], context="FACES")
    bmesh.ops.delete(glass_bm, geom=[f for f in glass_bm.faces if f.material_index not in glass_idx], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    glass = bpy.data.meshes.new(obj.name + " glass")
    glass_bm.to_mesh(glass)
    glass_bm.free()
    for m in obj.data.materials:
        glass.materials.append(m)
    glass_obj = bpy.data.objects.new(obj.name + " glass", glass)
    bpy.context.collection.objects.link(glass_obj)
    groups.setdefault("GlassPanels", []).append(glass_obj)
    obj.data.set_sharp_from_angle(angle=SHARP_ANGLE)
    weighted = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    weighted.mode = "FACE_AREA"
    apply_modifiers(obj)
    groups.setdefault("BodyStatic", []).append(obj)
    return obj, glass_obj


class Surface:
    """Ray casts against the finished shell, to lay lamps, shut lines and fittings on the paint."""

    def __init__(self, obj):
        self.bvh = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())

    def hit(self, origin, direction):
        location, normal, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        assert location is not None, ("ray missed the body", origin, direction)
        return location, normal

    def from_side(self, y, z, side):
        """Point on the right (side 1) or left (-1) flank at (y, z)."""
        return self.hit((side * 3.0, y, z), (-side, 0, 0))

    def from_above(self, x, y):
        return self.hit((x, y, 3.0), (0, 0, -1))

    def from_behind(self, x, z):
        return self.hit((x, 4.0, z), (0, -1, 0))

    def from_front(self, x, z):
        return self.hit((x, -4.0, z), (0, 1, 0))


def ribbon(name, hits, width, mat, lift=LIFT, group="BodyStatic"):
    """A flat strip `width` wide laid along surface hits [(location, normal)]: shut lines and lamp
    signatures. Each end is square to the strip."""
    verts, faces = [], []
    n = len(hits)
    for k, (p, normal) in enumerate(hits):
        ahead = hits[min(k + 1, n - 1)][0] - hits[max(k - 1, 0)][0]
        across = normal.cross(ahead).normalized() * (width / 2)
        lifted = p + normal * lift
        verts += [tuple(lifted - across), tuple(lifted + across)]
        if k:
            faces.append((2 * k - 2, 2 * k - 1, 2 * k + 1, 2 * k))
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    groups.setdefault(group, []).append(obj)
    return obj


def path(cast, start, end, steps=16):
    """Surface hits along a straight line between two 2D points, cast by `cast` (a Surface method)."""
    return [cast(*(start[d] + (end[d] - start[d]) * t / steps for d in range(2))) for t in range(steps + 1)]


def prism(name, outline, z0, z1, mat, group="BodyStatic"):
    """A flat plate from a star-shaped plan outline [(x, y)] between heights z0 and z1: splitters."""
    m = len(outline)
    verts = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    faces = [tuple(reversed(range(m))), tuple(range(m, 2 * m))]
    faces += [(k, (k + 1) % m, m + (k + 1) % m, m + k) for k in range(m)]
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    groups.setdefault(group, []).append(obj)
    return obj
