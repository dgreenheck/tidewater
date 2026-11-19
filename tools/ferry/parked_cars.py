"""Low-detail parked cars for the ferry terminal's car park: our four real car models, each joined
into one mesh (materials kept), decimated to a few thousand triangles and set on the ground
(tyres on y 0, centred, bow +Z like the originals). The game instances them into the bays.
Run:
  Blender --background --factory-startup --python tools/ferry/parked_cars.py
Output: public/ferry/parked_cars.glb with one root node per model (ParkedAster, ParkedJeep,
ParkedWagon, ParkedPickup), the body as its mesh, and four wheel nodes under it
(<root>WheelFrontL, ..R, <root>WheelRearL, ..R; L on -X like the Aster): identity rotation, at the
wheel's hub, the wheel's mesh centred on it so it spins about its local X (the axle) and steers
about its local Y. Traffic.js animates the pivots, and Terminal.js places parked cars.
"""
import math
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
WHEELS = ('WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR')
# Triangles each wheel keeps (tyre, rim, disc). At 420 the Aster's 19448-triangle wheel (tread
# blocks) collapsed into spikes that stood its tyre 6 cm out of round and put its mesh 5 cm off the
# hub, so it would have wobbled as it rolled; at 1600 every wheel stays within 2 cm. The light
# wagon and pickup wheels (about 2400) barely change.
WHEEL_TRIS = 1600
MODELS = (('ParkedAster', 'aster_rs', 5000), ('ParkedJeep', 'black_jeep', 5500), ('ParkedWagon', 'support_wagon', 4500), ('ParkedPickup', 'support_pickup', 4500))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

roots = []
for i, (name, src, target) in enumerate(MODELS):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f'public/rally/{src}.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    new_names = [o.name for o in new]
    meshes = [o for o in new if o.type == 'MESH']
    # The source's four wheel pivots (empties named ...WheelFrontL etc., each owning its wheel's
    # geometry): those meshes stay out of the body and become the car's wheel nodes.
    def pivot_of(o):
        while o is not None:
            for suffix in WHEELS:
                if o.type == 'EMPTY' and o.name.endswith(suffix): return suffix
            o = o.parent
        return None
    wheel_parts = {suffix: [o for o in meshes if pivot_of(o) == suffix] for suffix in WHEELS}
    assert all(wheel_parts.values()), f'{src}: a wheel pivot has no mesh ({ {k: len(v) for k, v in wheel_parts.items()} })'
    # each hub is its pivot's place in the source (exact); a decimated mesh's bounding box is not
    hubs = {suffix: next(o for o in new if o.type == 'EMPTY' and o.name.endswith(suffix)).matrix_world.translation.copy() for suffix in WHEELS}
    in_wheels = {o for v in wheel_parts.values() for o in v}
    body_parts = [o for o in meshes if o not in in_wheels]
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # Bake every transform into the vertices, decimate each part on its own (big parts hard, small
    # parts barely, so trim and lamps survive), then join into one mesh.
    pivot_of_name = {o.name: k for k, v in wheel_parts.items() for o in v}
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for o in body_parts for p in o.data.polygons)
    wheel_tris = {k: sum(len(p.vertices) - 2 for o in v for p in o.data.polygons) for k, v in wheel_parts.items()}
    for o in meshes:
        share = WHEEL_TRIS / max(1, wheel_tris[pivot_of_name[o.name]]) if o.name in pivot_of_name else target / max(1, tris)
        # Weld split vertices first: open seams are what collapse into spikes.
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
        bm.to_mesh(o.data); bm.free()
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        keep = max(share, min(1.0, 300 / max(1, t)))
        if keep < 0.98:
            mod = o.modifiers.new('Decimate', 'DECIMATE'); mod.ratio = keep; mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
    def join(parts):
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts: o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        return bpy.context.view_layer.objects.active
    car = join(body_parts)
    wheels = {k: join(v) for k, v in wheel_parts.items()}
    keep = {car, *wheels.values()}
    for n in new_names:
        o = bpy.data.objects.get(n)
        if o is not None and o not in keep: bpy.data.objects.remove(o)
    # Centred in plan; the originals already stand with their tyres on z 0 (Blender is Z up here;
    # the export turns it back to glTF Y up).
    # (the plan centre over body and wheels together, as when they were one mesh)
    every = [v.co for o in keep for v in o.data.vertices]
    xs = [c.x for c in every]; ys = [c.y for c in every]; zs = [c.z for c in every]
    shift = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0))
    for v in car.data.vertices: v.co -= shift
    for o in keep:
        for p in o.data.polygons: p.use_smooth = True
    car.name = name
    car.data.name = name
    for suffix, w in wheels.items():
        # the mesh re-centred on its hub so it spins about its own axle (Blender X) without
        # wobble, and the node stands at the hub
        hub = hubs[suffix]
        for v in w.data.vertices: v.co -= hub
        wy = [v.co.y for v in w.data.vertices]; wz = [v.co.z for v in w.data.vertices]
        print(f'PARKED {name}{suffix}: from {wheel_tris[suffix]} triangles; box centre off the hub by {(min(wy) + max(wy)) / 2:.3f} {(min(wz) + max(wz)) / 2:.3f} m')
        w.name = w.data.name = name + suffix
        w.parent = car
        w.location = hub - shift
        print(f'PARKED {name}{suffix}: hub {w.location.x:.3f} {w.location.y:.3f} {w.location.z:.3f}, radius {max(abs(min(wz)), max(wz)):.3f} m, {sum(len(p.vertices) - 2 for p in w.data.polygons)} triangles')
    car.location = (i * 6.0, 0, 0)          # side by side in the file; the game ignores this offset
    after = sum(len(p.vertices) - 2 for p in car.data.polygons)
    print(f'PARKED {name} {src}: {tris} -> {after} body triangles, {len(car.data.materials)} materials, size {max(xs) - min(xs):.2f} x {max(ys) - min(ys):.2f} x {max(zs) - min(zs):.2f}')
    roots.append(car)

bpy.ops.object.select_all(action='DESELECT')
for o in roots:
    o.select_set(True)
    for w in o.children: w.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/ferry/parked_cars.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
print('PARKED written', ROOT / 'public/ferry/parked_cars.glb')
