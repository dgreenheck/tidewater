"""Batched geometry for the ferry build (Blender, Z up, metres).

Parts are accumulated per (group, material) in Python lists and turned into one mesh per key at
flush(), so thousands of fittings cost no operator calls. Closed solids (box, cyl, ...) get their
normals recalculated; sheets (skins, glazing, decals) keep the winding they were given, so build
them facing outward. flush() hands the meshes to blender_primitives.groups for the export join.
"""
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix
from blender_primitives import mesh, groups

rng = random.Random(2003)
SOLIDS, SHEETS = {}, {}


def _batch(store, g, mat, verts, faces):
    b = store.setdefault((g, mat.name), [[], [], mat])
    o = len(b[0])
    b[0].extend(tuple(v) for v in verts)
    b[1].extend(tuple(i + o for i in f) for f in faces)


def add(g, mat, verts, faces):
    _batch(SOLIDS, g, mat, verts, faces)


def sheet(g, mat, verts, faces):
    _batch(SHEETS, g, mat, verts, faces)


def quad(g, mat, a, b, c, d):
    """One outward-facing sheet quad, corners counter-clockwise seen from outside."""
    sheet(g, mat, [a, b, c, d], [(0, 1, 2, 3)])


def fill(g, mat, boundary, normal=None):
    """A flat sheet filling a closed, possibly concave, planar boundary (transoms, caps, decks),
    every triangle turned to face `normal` when one is given."""
    bm = bmesh.new()
    pts = []
    for p in boundary:
        if not pts or (Vector(p) - Vector(pts[-1])).length > 1e-5: pts.append(tuple(p))
    if len(pts) > 2 and (Vector(pts[0]) - Vector(pts[-1])).length < 1e-5: pts.pop()
    vs = [bm.verts.new(p) for p in pts]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=es)
    bm.verts.index_update()
    tris = [tuple(v.index for v in f.verts) for f in bm.faces]
    verts = [v.co.copy() for v in bm.verts]
    bm.free()
    if normal is not None:
        N = Vector(normal)
        out = []
        for t in tris:
            a, b, c = (verts[i] for i in t)
            out.append(t if (b - a).cross(c - a).dot(N) >= 0 else t[::-1])
        tris = out
    sheet(g, mat, verts, tris)


HEX = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(g, mat, pts):
    add(g, mat, pts, HEX)


def box(g, mat, c, s, rz=0.0, rx=0.0):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    m = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(rx, 3, 'X')
    c = Vector(c)
    hexa(g, mat, [c + m @ Vector((x, y, z)) for z in (-hz, hz) for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))])


def aabb(g, mat, x0, x1, y0, y1, z0, z1):
    box(g, mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)))


def _frame(d):
    u = d.orthogonal().normalized()
    return u, d.cross(u).normalized()


def beam(g, mat, p0, p1, w, h):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6: side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    a, b = side * (w / 2), up * (h / 2)
    hexa(g, mat, [p0 - a - b, p0 + a - b, p1 + a - b, p1 - a - b, p0 - a + b, p0 + a + b, p1 + a + b, p1 - a + b])


def cyl(g, mat, p0, p1, r, n=16, r1=None, caps=True):
    p0, p1 = Vector(p0), Vector(p1)
    u, v = _frame((p1 - p0).normalized())
    r1 = r if r1 is None else r1
    ring = [u * math.cos(k * math.tau / n) + v * math.sin(k * math.tau / n) for k in range(n)]
    verts = [p0 + q * r for q in ring] + [p1 + q * r1 for q in ring]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    if caps: faces += [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    add(g, mat, verts, faces)


def rail(g, mat, pts, r, n=8):
    for a, b in zip(pts, pts[1:]): cyl(g, mat, a, b, r, n)


def annulus(g, mat, c, axis, r0, r1, depth, n=32):
    c, ax = Vector(c), Vector(axis).normalized()
    u, v = _frame(ax)
    verts = []
    for rr, dd in ((r0, 0), (r1, 0), (r1, depth), (r0, depth)):
        verts += [c + (u * math.cos(k * math.tau / n) + v * math.sin(k * math.tau / n)) * rr + ax * dd for k in range(n)]
    faces = [(q * n + k, q * n + (k + 1) % n, ((q + 1) % 4) * n + (k + 1) % n, ((q + 1) % 4) * n + k) for q in range(4) for k in range(n)]
    add(g, mat, verts, faces)


def torus(g, mat, c, axis, R, r, n=32, m=10):
    c, ax = Vector(c), Vector(axis).normalized()
    u, v = _frame(ax)
    verts = []
    for i in range(n):
        a = i * math.tau / n
        d = u * math.cos(a) + v * math.sin(a)
        for j in range(m):
            b = j * math.tau / m
            verts.append(c + d * (R + r * math.cos(b)) + ax * (r * math.sin(b)))
    faces = [(i * m + j, i * m + (j + 1) % m, ((i + 1) % n) * m + (j + 1) % m, ((i + 1) % n) * m + j) for i in range(n) for j in range(m)]
    add(g, mat, verts, faces)


def sphere(g, mat, c, r, n=16, m=8, squash=1.0, top_only=False):
    c = Vector(c)
    verts, faces = [], []
    j0 = 0 if not top_only else m // 2
    rows = list(range(j0, m + 1))
    for j in rows:
        b = -math.pi / 2 + math.pi * j / m
        for i in range(n):
            a = i * math.tau / n
            verts.append(c + Vector((math.cos(b) * math.cos(a) * r, math.cos(b) * math.sin(a) * r, math.sin(b) * r * squash)))
    for jj in range(len(rows) - 1):
        for i in range(n):
            a, b2 = jj * n + i, jj * n + (i + 1) % n
            faces.append((a, b2, b2 + n, a + n))
    if top_only: faces.append(tuple(range(n))[::-1])
    add(g, mat, verts, faces)


def plate(g, mat, outline, origin, U, V, depth):
    """Extrude a closed (u, v) outline drawn on the plane origin + u U + v V by depth along U x V."""
    o, U, V = Vector(origin), Vector(U), Vector(V)
    N = U.cross(V).normalized() * depth
    n = len(outline)
    base = [o + U * a + V * b for a, b in outline]
    add(g, mat, base + [p + N for p in base],
        [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)])


def rounded_rect(w, h, r, n=4):
    """Outline of a w x h rectangle with corner radius r, centred on the origin, counter-clockwise."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def loop(g, mat, pts, normal, t, m=4):
    """A closed tube through pts (a chain link, a cage hoop); the cross-section frame uses the loop plane."""
    n, N = len(pts), Vector(normal).normalized()
    verts = []
    for k in range(n):
        tang = (pts[(k + 1) % n] - pts[k - 1]).normalized()
        b = tang.cross(N).normalized()
        verts += [pts[k] + (N * math.cos(j * math.tau / m + math.pi / 4) + b * math.sin(j * math.tau / m + math.pi / 4)) * t for j in range(m)]
    add(g, mat, verts, [(k * m + j, k * m + (j + 1) % m, ((k + 1) % n) * m + (j + 1) % m, ((k + 1) % n) * m + j) for k in range(n) for j in range(m)])


def chain(g, mat, p0, p1, link=0.2, t=0.024):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    d.normalize()
    u0, u1 = _frame(d)
    n = max(1, int(L / (link * 0.74)))
    for i in range(n):
        c = p0 + d * ((i + 0.5) * L / n)
        w = u0 if i % 2 == 0 else u1
        pts = [c + d * (math.cos(k * math.tau / 8) * link * 0.5) + w * (math.sin(k * math.tau / 8) * link * 0.27) for k in range(8)]
        loop(g, mat, pts, d.cross(w), t)


def coil(g, mat, c, r0, turns, t, layers=3, n=48):
    """A coiled mooring line on deck: stacked flat rings of rope."""
    for layer in range(layers):
        for k in range(turns):
            R = r0 - k * t * 2.1
            if R < t * 3: break
            torus(g, mat, (c[0], c[1], c[2] + t + layer * t * 1.9), (0, 0, 1), R, t, n, 6)


def flush(sharp_angle=35.0, smooth_groups=()):
    """Turn every batch into a mesh in blender_primitives.groups; sheets keep their winding."""
    made = []
    for store, recalc in ((SOLIDS, True), (SHEETS, False)):
        for (g, _), (v, f, m) in store.items():
            if not f: continue
            if recalc:
                obj = mesh(f'{g} {m.name}', v, f, m, group=g, smooth=g in smooth_groups)
            else:
                data = bpy.data.meshes.new(f'{g} {m.name} sheet')
                data.from_pydata(v, [], f)
                data.materials.append(m)
                data.update()
                obj = bpy.data.objects.new(f'{g} {m.name} sheet', data)
                bpy.context.collection.objects.link(obj)
                for poly in data.polygons: poly.use_smooth = g in smooth_groups
                groups.setdefault(g, []).append(obj)
            if g in smooth_groups:
                ang = smooth_groups.get(g, sharp_angle) if isinstance(smooth_groups, dict) else sharp_angle   # per-group angle
                try: obj.data.set_sharp_from_angle(angle=math.radians(ang))
                except Exception as err: print('FERRY sharp-edges skipped', err)
            made.append(obj)
        store.clear()
    return made
