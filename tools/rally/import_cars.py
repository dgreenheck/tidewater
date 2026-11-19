"""Convert Rally's sourced car models into Tidewater car GLBs, plus a report and QA renders.

Contract (matches public/rally/aster_rs.glb): glTF Y up, +Z nose, X width, metres. The root sits on
the ground, centred between the axles. Children: BodyStatic, GlassPanels, InteriorAssembly meshes and
four wheel pivots (WheelFrontL/R, WheelRearL/R, L on -X like the Aster) with identity rotation, each
owning a <pivot>Geometry mesh that spins about local X. Calipers stay on the body. Materials are
untextured factors named like the Aster's, so every textured badge, logo and sidewall print is gone.

Only models whose licence is confirmed CC0 or CC BY (credited in CREDITS.md) belong in CARS.

Run:   Blender --background --factory-startup --python tools/rally/import_cars.py
QA:    Blender --background --factory-startup --python tools/rally/import_cars.py -- --render
Needs: RALLY_MODELS=<a Rally checkout's assets/models>.
"""
from pathlib import Path
import json, math, os, re, struct, sys
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCES = Path(os.environ.get("RALLY_MODELS", "assets/models"))
GAME = ROOT / "public/rally"
OUT = ROOT / "assets/rally"
PREVIEW = OUT / "previews"
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

sys.path.insert(0, str(Path(__file__).resolve().parent))
from car_palette import PALETTE  # the shared material table (one source for importer and builders)

CARS = [{
    "key": "concept_gt",
    "name": "Concept GT",
    "root": "ConceptGT",
    "source": "car_concept.glb",
    "scale": 1.0,  # fictional car, authored at a plausible 4.36 m coupe length; no real length to match
    "materials": {
        "Paint 1 Carmine": "BodyPaint", "Paint 2 Carmine": "Graphite", "Mechanical": "Graphite",
        "Material_2": "Graphite", "Glass": "Glass", "Headlight": "Headlamp", "Brakelight": "TailLamp",
        "Signallight": "Indicator", "Mirror": "BrightMetal", "Hardware": "BrightMetal", "Rim2": "Alloy",
        "Rim1": "AlloyDark", "Tireside": "Rubber", "Tiretread": "Tread", "Disc": "BrakeRotor",
        "Brake": "Caliper", "License": "LicensePlate", "Interior 1": "Interior", "Interior 2": "Interior",
        "Dashboard": "Interior", "Floormat": "Interior", "Panel Sides": "Interior",
        "Interior 3 Carmine": "SeatFabric",
    },
    "wheel_pivots": r"^Wheel(Front|Rear)[LR]$",
    "caliper": r"BrakePad",                   # under the wheel pivots in the source; moved to the body
    "blank": r"Emblem|Logo|Badge",            # any marked geometry becomes plain dark plastic
    "interior": r"^Interior",
    "decimate": [(r"WindshieldWipers", 0.3), (r"^Interior", 0.3), (r"BrakePad", 0.3), (r"Rim$", 0.5)],
    "rear_plate": r"^License Plate$",
    # Fictional car: no real-world figures exist. Class figures for a mid-engine sports coupe.
    "specs": {"basis": "invented (fictional concept car, sports coupe class)", "mass_kg": 1350,
              "power_kw": 300, "torque_nm": 480, "drive": "RWD", "top_speed_kmh": 290,
              "zero_to_100_s": 4.2, "tyre_width_mm": 285},  # width as measured on the mesh
}]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def palette_material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    rgba, metal, rough, emit, coat = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat["tidewater_palette"] = True
    mat.use_nodes = True
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgba[:3], 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if coat:
        bsdf.inputs["Coat Weight"].default_value, bsdf.inputs["Coat Roughness"].default_value = coat
    if rgba[3] < 1:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = False
    return mat


def world_bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def mesh_copy(obj, matrix, car, name, ratio=None):
    """World (or pivot) space copy of obj with palette materials, no UVs or colours, optionally decimated."""
    if ratio:
        mod = obj.modifiers.new("decimate", "DECIMATE"); mod.ratio = ratio
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        obj.modifiers.remove(mod)
    else:
        me = obj.data.copy()
    me.transform(matrix)
    if matrix.determinant() < 0:
        me.flip_normals()
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    blank = re.search(car["blank"], obj.name)
    for i, src in enumerate(me.materials):
        target = "Graphite" if blank else car["materials"].get(src.name if src else "", None)
        if target is None:
            print("UNMAPPED", obj.name, src.name if src else None, "-> Graphite"); target = "Graphite"
        me.materials[i] = palette_material(target)
    new = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(new)
    return new


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = out.data.name = name
    return out


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build(car):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(SOURCES / car["source"]))
    # A source material can carry a palette name. The concept car's own "Glass" is transmission
    # only (no colour, no blend), and palette_material() returned it in place of ours, so the game's
    # loader drew the windscreen, rear glass and roof glazing as an opaque white slab (# test/vehicle-glass.mjs). Rename such materials out of the way and keep their mapping.
    for m in list(bpy.data.materials):
        if m.name in PALETTE and not m.get("tidewater_palette"):
            old = m.name
            m.name = "Source " + old
            if old in car["materials"]:
                car["materials"][m.name] = car["materials"][old]
    source = list(bpy.context.scene.objects)
    S = Matrix.Scale(car["scale"], 4)
    pivots = [o for o in source if re.match(car["wheel_pivots"], o.name)]
    assert len(pivots) == 4, [o.name for o in pivots]
    # Aster naming by position: front is -Y in Blender (+Z in glTF), L is -X.
    slot = {}
    for p in pivots:
        w = S @ p.matrix_world.translation
        slot[p] = ("WheelFront" if w.y < 0 else "WheelRear") + ("L" if w.x < 0 else "R")
    assert sorted(slot.values()) == ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"], slot

    def under(o):
        while o.parent:
            if o.parent in slot:
                return o.parent
            o = o.parent
        return None

    def ratio(o):
        return next((r for pat, r in car["decimate"] if re.search(pat, o.name)), None)

    groups = {"BodyStatic": [], "GlassPanels": [], "InteriorAssembly": []}
    wheels = {name: [] for name in slot.values()}
    rear_plate = None
    for o in [o for o in source if o.type == "MESH"]:
        pivot = under(o)
        if pivot and not re.search(car["caliper"], o.name):
            # Pivot-local geometry: strips the source's posed steer and spin.
            m = Matrix.Scale(car["scale"], 4) @ pivot.matrix_world.inverted() @ o.matrix_world
            wheels[slot[pivot]].append(mesh_copy(o, m, car, o.name + "_w", ratio(o)))
            continue
        copy = mesh_copy(o, S @ o.matrix_world, car, o.name + "_c", ratio(o))
        if re.search(car["rear_plate"], o.name):
            rear_plate = world_bounds([copy])  # before the join consumes the object
        if o.data.materials and all(m and car["materials"].get(m.name) == "Glass" for m in o.data.materials):
            groups["GlassPanels"].append(copy)
        elif re.search(car["interior"], o.name):
            groups["InteriorAssembly"].append(copy)
        else:
            groups["BodyStatic"].append(copy)
    blanked = [o.name for o in source if o.type == "MESH" and re.search(car["blank"], o.name)]
    centres = {slot[p]: S @ p.matrix_world.translation for p in pivots}
    for o in source:
        bpy.data.objects.remove(o, do_unlink=True)

    wheel_objs = {n: join(objs, n + "Geometry") for n, objs in wheels.items()}
    wheel_info = {}
    for n, w in wheel_objs.items():
        tyre = [v.co for v in w.data.vertices]
        lo = Vector([min(c[i] for c in tyre) for i in range(3)])
        hi = Vector([max(c[i] for c in tyre) for i in range(3)])
        wheel_info[n] = {"radius": max(hi.y - lo.y, hi.z - lo.z) / 2, "width": hi.x - lo.x,
                         "centre_offset": max(abs(hi.y + lo.y) / 2, abs(hi.z + lo.z) / 2)}
    radius = sum(i["radius"] for i in wheel_info.values()) / 4
    ground = sum(c.z for c in centres.values()) / 4 - radius
    front = (centres["WheelFrontL"].y + centres["WheelFrontR"].y) / 2
    rear = (centres["WheelRearL"].y + centres["WheelRearR"].y) / 2
    shift = Matrix.Translation((0, -(front + rear) / 2, -ground))

    root = bpy.data.objects.new(car["root"], None)
    bpy.context.collection.objects.link(root)
    parts = {}
    for name, objs in groups.items():
        if objs:
            part = join(objs, name)
            part.data.transform(shift)
            part.parent = root
            parts[name] = part
    pivot_pos = {}
    for n, w in wheel_objs.items():
        c = shift @ centres[n]
        c.z = radius  # all four pivots on one axle height, wheels resting on the ground plane
        empty = bpy.data.objects.new(n, None)
        bpy.context.collection.objects.link(empty)
        empty.parent = root
        empty.location = c
        w.parent = empty
        pivot_pos[n] = c

    # Plates. Rear: the model's own recess, material already blank. Front: flattest bumper face on x=0.
    plates = {}
    bpy.context.view_layer.update()
    if rear_plate:
        lo, hi = rear_plate
        plates["rear"] = [0.0, (lo.z + hi.z) / 2 - ground, -(hi.y - (front + rear) / 2) - 0.005, math.pi]
    body = parts["BodyStatic"]
    dg = bpy.context.evaluated_depsgraph_get()
    hits = []
    for k in range(10, 70):
        z = k / 100
        ok, loc, nrm, *_ = bpy.context.scene.ray_cast(dg, Vector((0, -10, z)), Vector((0, 1, 0)))
        if ok and abs(nrm.y) > 0.85:
            hits.append((z, loc.y))
    best = None
    for i in range(len(hits) - 10):
        win = hits[i:i + 11]
        if win[-1][0] - win[0][0] > 0.105:
            continue
        spread = max(h[1] for h in win) - min(h[1] for h in win)
        if best is None or spread < best[0]:
            best = (spread, (win[0][0] + win[-1][0]) / 2, min(h[1] for h in win))
    if best:
        plates["front"] = [0.0, best[1], -best[2] + 0.005, 0.0]
        plates["front_face_spread_m"] = round(best[0], 4)

    # Export
    GAME.mkdir(parents=True, exist_ok=True)
    glb = GAME / f"{car['key']}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_texcoords=False, export_extras=False,
                              export_cameras=False, export_lights=False, export_animations=False)
    data = glb.read_bytes()
    doc = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
    assert not doc.get("images") and not doc.get("textures"), "textures must not ship"
    names = [n.get("name") for n in doc["nodes"]]
    for n in wheel_objs:
        node = doc["nodes"][names.index(n)]
        assert node.get("rotation", [0, 0, 0, 1]) == [0, 0, 0, 1] and "scale" not in node, node
        assert abs(node["translation"][1] - radius) < 1e-4, node
        assert n + "Geometry" in names
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            assert prim.get("mode", 4) == 4 and set(prim["attributes"]) <= {"POSITION", "NORMAL"}, prim["attributes"]

    objs = [o for o in root.children_recursive if o.type == "MESH"]
    lo, hi = world_bounds(objs)
    body_verts = [v.co for v in parts["BodyStatic"].data.vertices if v.co.z < 0.7 * hi.z]  # below the mirrors
    body_width = max(c.x for c in body_verts) - min(c.x for c in body_verts)
    g = lambda v: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]  # Blender to glTF axes
    fl, fr, rl, rr = (pivot_pos[n] for n in ("WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"))
    tyre_width = sum(i["width"] for i in wheel_info.values()) / 4
    report = {
        "name": car["name"], "file": f"public/rally/{car['key']}.glb", "root_node": car["root"],
        "source": car["source"], "scale_applied": car["scale"],
        "dimensions_m": {"length": round(hi.y - lo.y, 3), "width_with_mirrors": round(hi.x - lo.x, 3),
                         "width_body_below_mirrors": round(body_width, 3), "height": round(hi.z - lo.z, 3),
                         "min_gltf": [round(lo.x, 4), round(lo.z, 4), round(-hi.y, 4)],
                         "max_gltf": [round(hi.x, 4), round(hi.z, 4), round(-lo.y, 4)]},
        "wheel_radius_m": round(radius, 4), "tyre_width_m": round(tyre_width, 4),
        "wheelbase_m": round(abs(fl.y - rl.y), 4),
        "track_m": {"front": round(abs(fl.x - fr.x), 4), "rear": round(abs(rl.x - rr.x), 4)},
        "wheel_pivots_gltf": {n: g(c) for n, c in pivot_pos.items()},
        "wheel_spin_check": {n: {"geometry_centre_offset_from_axis_m": round(i["centre_offset"], 5)} for n, i in wheel_info.items()},
        "triangles": {"total": sum(tris(o) for o in objs), **{o.name: tris(o) for o in objs}},
        "materials": [m["name"] for m in doc["materials"]],
        "blanked_geometry": blanked,
        "file_bytes": len(data),
        "plates_gltf_xyz_yaw": plates,
        "specs": {**car["specs"], "wheel_radius_m": round(radius, 4)},
    }
    print("BUILT", glb, len(data))
    return report


def studio(target_z):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine; break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("Studio"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.44, 0.47, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    bpy.ops.mesh.primitive_plane_add(size=40)
    floor = bpy.context.active_object
    fm = bpy.data.materials.new("Floor"); fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.5, 0.52, 1)
    floor.data.materials.append(fm)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)
    aim = bpy.data.objects.new("Aim", None); aim.location = (0, 0, target_z)
    bpy.context.collection.objects.link(aim)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); cam.data.lens = 50
    bpy.context.collection.objects.link(cam); scene.camera = cam
    track = cam.constraints.new("TRACK_TO"); track.target = aim
    return cam


def render(car):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(GAME / f"{car['key']}.glb"))
    for m in bpy.data.materials:
        m.use_backface_culling = True  # an inverted face disappears instead of hiding behind double-siding
    cam = studio(0.55)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    # The game's plate model at the measured mounts, placed the way VehicleModel.js places it.
    report = json.loads((OUT / "asset_report.json").read_text())["cars"][car["key"]]
    for end in ("front", "rear"):
        x, y, z, yaw = report["plates_gltf_xyz_yaw"][end]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(GAME / "cosier_plate.glb"))
        mount = bpy.data.objects.new(f"PlateMount_{end}", None)
        bpy.context.collection.objects.link(mount)
        mount.location, mount.rotation_euler = (x, -z, y), (0, 0, yaw)  # glTF to Blender axes
        for o in set(bpy.data.objects) - before - {mount}:
            if o.parent is None:
                o.parent = mount
        for m in bpy.data.materials:
            m.use_backface_culling = True
    shots = {"front34": (-4.6, -6.2, 1.7), "rear34": (4.6, 6.2, 1.9), "side": (-8.5, 0, 0.75)}
    for shot, loc in shots.items():
        cam.location = loc
        bpy.context.scene.render.filepath = str(PREVIEW / f"{car['key']}_{shot}.png")
        bpy.ops.render.render(write_still=True)
    for n in ("WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"):
        bpy.data.objects[n].rotation_mode = "XYZ"
        bpy.data.objects[n].rotation_euler.x += math.pi / 2  # spin about the axle
    cam.location = shots["side"]
    bpy.context.scene.render.filepath = str(PREVIEW / f"{car['key']}_spin90.png")
    bpy.ops.render.render(write_still=True)
    # Cabin check: glass hidden, looking down through the greenhouse.
    bpy.data.objects["GlassPanels"].hide_render = True
    cam.location = (-3.2, -4.2, 3.6)
    bpy.context.scene.render.filepath = str(PREVIEW / f"{car['key']}_cabin.png")
    bpy.ops.render.render(write_still=True)


if "--render" in ARGS:
    for car in CARS:
        render(car)
else:
    reports = {car["key"]: build(car) for car in CARS}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "asset_report.json").write_text(json.dumps({
        "generator": "tools/rally/import_cars.py", "blender": bpy.app.version_string,
        "contract": "glTF Y up, +Z nose, X width, metres; root on the ground centred between the axles; "
                    "wheel pivots WheelFrontL/R, WheelRearL/R (L on -X) with identity rotation, spin about local X",
        "plate_note": "[x, y, z, yaw] in car space, for the PLATES table in src/rally/VehicleModel.js",
        "cars": reports}, indent=2) + "\n")
