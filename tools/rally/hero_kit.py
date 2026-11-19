"""Shared parts for the Blender-built hero cars (build_fulmine_v10.py, build_corsaire_w16.py,
build_sandpiper.py): palette materials, wheels with tyres, rims, discs and body-mounted calipers,
cabin pieces, the GLB export with its contract asserts, and the studio review renders. The body
itself is modelled hard-surface in hard_surface.py.

Frame: Blender Z up, -Y nose, X width; the exported glTF is Y up, +Z nose (export_yup). Units are
metres, kilograms and radians. The root empty sits on the ground centred between the axles.

Output contract (src/rally/VehicleModel.js, src/rally/RallyDrive.js WHEEL_NAMES, test/vehicle-glass.mjs,
the same as tools/rally/build_black_jeep.py and tools/rally/import_cars.py): BodyStatic, GlassPanels and
InteriorAssembly meshes and four wheel pivots WheelFrontL/R, WheelRearL/R (L on -X, like the Aster)
parented to the root with identity rotation and glTF translation y = tyre radius, each owning a
<pivot>Geometry mesh that spins about local X. Calipers stay on the body. Lamp lenses use the palette
names Headlamp and TailLamp, which src/rally/CarLights.js finds and drives.

Body history: the Ridgeback 4x4 was built from bevelled cubes and read as a toy; the
first Fulmine was a soft loft through cross sections and read inflated. Hard-surface cages
with creased character lines replaced both (hard_surface.py).
"""
from pathlib import Path
import json, math, struct, sys
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from car_palette import PALETTE
from blender_primitives import cube, cylinder, ring, line, join_group, groups

ROOT = Path(__file__).resolve().parents[2]
GAME = ROOT / "public/rally"
REPORTS = ROOT / "assets/rally"
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

WHEEL_NAMES = ("WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR")
SHARP_ANGLE = math.radians(38)   # edges sharper than this shade flat: panel creases, lamp housings


def clear_scene():
    bpy.context.preferences.filepaths.save_version = 0
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    groups.clear()


def palette(name, rgba=None, coat=None):
    """The palette material `name` (car_palette.py). `rgba` gives this car its own paint colour and
    `coat` its own clearcoat (factor, roughness); the first call for a name decides both."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    base, metallic, roughness, emission, default_coat = PALETTE[name]
    rgba = rgba or base
    coat = coat or default_coat
    mat = bpy.data.materials.new(name)
    mat["tidewater_palette"] = True
    mat.use_nodes = True
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgba[:3], 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat[0]
        bsdf.inputs["Coat Roughness"].default_value = coat[1]
    if rgba[3] < 1:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        mat.surface_render_method = "BLENDED"   # exported as alphaMode BLEND (test/vehicle-glass.mjs)
    mat.use_backface_culling = False
    return mat


def build_mesh(name, verts, faces, mat, group="BodyStatic"):
    """A smooth-shaded mesh object with sharp edges above SHARP_ANGLE, added to a join group."""
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    data.validate()
    data.update()
    for poly in data.polygons:
        poly.use_smooth = True
    data.set_sharp_from_angle(angle=SHARP_ANGLE)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if group:
        groups.setdefault(group, []).append(obj)
    return obj


# ---------------------------------------------------------------- wheels

def lathe(name, profile, mat, group, side, segments=72):
    """Revolve (x, r) points about the wheel's X axis; x is outward from the car on side `side`."""
    verts = []
    for k in range(segments):
        a = math.tau * k / segments
        for x, r in profile:
            verts.append((side * x, r * math.sin(a), r * math.cos(a)))
    w = len(profile)
    faces = []
    for k in range(segments):
        for m in range(w - 1):
            a = k * w + m
            b = ((k + 1) % segments) * w + m
            faces.append((a, a + 1, b + 1, b) if side > 0 else (a, b, b + 1, a + 1))
    return build_mesh(name, verts, faces, mat, group)


def tyre_profile(radius, width, rim_radius):
    """Low-profile road tyre: rounded shoulders, a slight sidewall bulge, two circumferential grooves.
    The tread's outer radius is exactly `radius`, the physics radius, so the drawn tyre touches the
    ground where the simulated one does."""
    half, wall = width / 2, radius - rim_radius
    groove = width / 6
    return [
        (-half + 0.010, rim_radius + 0.004),
        (-half - 0.002, rim_radius + 0.35 * wall),
        (-half + 0.002, rim_radius + 0.75 * wall),
        (-half + 0.014, radius - 0.006),
        (-half + 0.030, radius),
        (-groove - 0.007, radius), (-groove - 0.004, radius - 0.007),
        (-groove + 0.004, radius - 0.007), (-groove + 0.007, radius),
        (groove - 0.007, radius), (groove - 0.004, radius - 0.007),
        (groove + 0.004, radius - 0.007), (groove + 0.007, radius),
        (half - 0.030, radius),
        (half - 0.014, radius - 0.006),
        (half + 0.002, rim_radius + 0.75 * wall),
        (half + 0.004, rim_radius + 0.35 * wall),
        (half - 0.004, rim_radius + 0.012),
        (half - 0.010, rim_radius + 0.004),
    ]


def make_wheel(root, name, side, centre, spec):
    """A wheel pivot at `centre` with its geometry: tyre, barrel, polished lip, spokes, hub, centre
    nut and brake disc (the disc turns with the wheel). spec: radius, width, rim_radius, spokes,
    twin (bool), spoke_mat, lip_mat, profile (optional tyre profile)."""
    pivot = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = centre
    pivot.parent = root
    radius, width, rim = spec["radius"], spec["width"], spec["rim_radius"]
    half = width / 2
    profile = spec.get("profile") or tyre_profile(radius, width, rim)
    lathe("Tyre", profile, palette("Rubber"), name, side)
    lathe("Rim barrel", [(-half + 0.02, rim - 0.006), (half - 0.02, rim - 0.006)], palette("AlloyDark"), name, side)
    lathe("Polished rim lip", [(half - 0.02, rim - 0.006), (half - 0.012, rim + 0.008), (half - 0.004, rim + 0.008),
                               (half - 0.004, rim - 0.014), (half - 0.02, rim - 0.022)], palette(spec["lip_mat"]), name, side)
    spoke_x = side * (half - 0.032)
    hub_r, inner_r = 0.075, rim - 0.018
    length = inner_r - hub_r
    angles = []
    for k in range(spec["spokes"]):
        a = math.tau * k / spec["spokes"]
        angles += [a - 0.06, a + 0.06] if spec.get("twin") else [a]
    for a in angles:
        rc = hub_r + length / 2
        obj = cube("Spoke", (spoke_x, rc * math.sin(a), rc * math.cos(a)), (0.022, 0.024, length), palette(spec["spoke_mat"]), 0.006, name)
        obj.rotation_euler.x = -a
    cylinder("Hub", (side * (half - 0.04), 0, 0), hub_r, 0.05, palette(spec["spoke_mat"]), group=name)
    cylinder("Centre lock nut", (side * (half - 0.012), 0, 0), 0.034, 0.04, palette("BrightMetal"), group=name, segments=6)
    disc_r = rim - 0.045
    cylinder("Brake disc", (side * (half - 0.12), 0, 0), disc_r, 0.032, palette("BrakeRotor"), group=name, segments=64)
    cylinder("Disc bell", (side * (half - 0.085), 0, 0), 0.10, 0.05, palette("AlloyDark"), group=name)
    geometry = join_group(name + "Geometry", groups.pop(name), pivot)
    geometry.location = (0, 0, 0)
    return pivot


def caliper(side, centre, spec, trailing):
    """A brake caliper on the body (static, per the contract) straddling the disc edge, 50 degrees
    round from the top towards the car's middle: behind the front discs, ahead of the rear."""
    x, y, z = centre
    disc_r = spec["rim_radius"] - 0.045
    theta = math.radians(50) * trailing
    rc = disc_r - 0.03
    loc = (x + side * (spec["width"] / 2 - 0.12), y + rc * math.sin(theta), z + rc * math.cos(theta))
    obj = cube("Brake caliper", loc, (0.085, 0.17, 0.075), palette("Caliper"), 0.012)
    obj.rotation_euler.x = -theta
    return obj


# ---------------------------------------------------------------- cabin

def bucket_seat(x, y, floor, mat, group="InteriorAssembly"):
    """A fixed-back bucket seat: cushion, reclined back with side bolsters, shoulder wings."""
    cube("Seat cushion", (x, y, floor + 0.09), (0.48, 0.50, 0.10), mat, 0.03, group)
    for side in (-1, 1):
        cube("Cushion bolster", (x + side * 0.21, y, floor + 0.13), (0.07, 0.46, 0.12), mat, 0.03, group)
    back_y, back_z, tilt = y + 0.27, floor + 0.42, -0.30   # m, rad: about 17 degrees of recline
    for part, dx, size in (("Seat back", 0.0, (0.46, 0.09, 0.62)), ("Back bolster", -0.21, (0.08, 0.14, 0.56)),
                           ("Back bolster", 0.21, (0.08, 0.14, 0.56))):
        obj = cube(part, (x + dx, back_y, back_z), size, mat, 0.03, group)
        obj.rotation_euler.x = tilt


def steering_wheel(x, y, z, tilt, rim_mat, hub_mat, group="InteriorAssembly"):
    """Three-spoke wheel on a column, built at the origin and then placed, so it tilts as one piece;
    tilt (rad) leans its top away from the driver towards the dash, as a real column does."""
    parts = [ring("Steering rim", (0, 0, 0), 0.175, 0.017, rim_mat, axis="Y", group=None, segments=48),
             cylinder("Steering hub", (0, 0.01, 0), 0.055, 0.04, hub_mat, axis="Y", group=None, segments=24),
             cube("Steering spoke", (-0.09, 0.005, 0), (0.16, 0.02, 0.03), hub_mat, 0.008, None),
             cube("Steering spoke", (0.09, 0.005, 0), (0.16, 0.02, 0.03), hub_mat, 0.008, None),
             cube("Steering spoke", (0, 0.005, -0.09), (0.03, 0.02, 0.15), hub_mat, 0.008, None),
             line("Steering column", [(0, 0.02, 0), (0, -0.30, -0.10)], 0.025, hub_mat, None)]
    wheel = join_group("Steering wheel", parts)
    wheel.location = (x, y, z)
    wheel.rotation_euler.x = tilt
    groups.setdefault(group, []).append(wheel)


# ---------------------------------------------------------------- export and review

def finish(root, file, radius, wheelbase, track, plates, extra_report=None, triangle_cap=150_000):
    """Join each group under the root, export public/rally/<file>.glb, assert the contract on the
    exported file (wheel pivots at y = radius with identity rotation, a GlassPanels node, the
    triangle cap from docs/cars.md LOD0) and write assets/rally/<file>_report.json."""
    for name, objects in list(groups.items()):
        if objects:
            join_group(name, objects, root)
    bpy.ops.object.select_all(action="DESELECT")
    asset = [root] + list(root.children_recursive)
    for obj in asset:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    glb = GAME / f"{file}.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False)
    binary = glb.read_bytes()
    doc = json.loads(binary[20:20 + struct.unpack_from("<I", binary, 12)[0]])
    for name in WHEEL_NAMES:
        node = next(n for n in doc["nodes"] if n.get("name") == name)
        assert abs(node["translation"][1] - radius) < 1e-5, (name, node["translation"])
        assert node.get("rotation", [0, 0, 0, 1]) == [0, 0, 0, 1], (name, node.get("rotation"))
    assert any(n.get("name") == "GlassPanels" and "mesh" in n for n in doc["nodes"]), "no GlassPanels mesh"
    triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in asset if o.type == "MESH")
    assert triangles < triangle_cap, triangles
    materials = sorted(m["name"] for m in doc.get("materials", []))
    report = {"generator": f"tools/rally/build_{file}.py", "blender": bpy.app.version_string, "triangles": triangles,
              "glb_bytes": len(binary), "materials": materials, "wheel_radius_m": radius, "wheelbase_m": wheelbase,
              "track_width_m": track, "wheel_pivots": list(WHEEL_NAMES),
              "plates_gltf_xyz_yaw": plates, **(extra_report or {})}
    (REPORTS / f"{file}_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("HERO_CAR_ASSET", json.dumps(report))
    return report


def review_renders(prefix, views, focus=(0.0, 0.0, 0.55)):
    """Studio renders of named views stitched into one contact sheet, written only when the run
    passes `-- --previews <dir>` (renders stay out of git). views: [(label, camera location, lens)]."""
    if "--previews" not in ARGS:
        return
    out = Path(ARGS[ARGS.index("--previews") + 1])
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 28
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 600
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    world = scene.world or bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.16, 0.20, 0.24, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    cube("Studio floor", (0, 0, -0.05), (200, 200, 0.1), palette("Interior"), 0, None)
    for label, location, power, size, colour in (("Key", (2, -4, 7), 1800, 5, (1, 0.9, 0.77)),
                                                  ("Side", (-4, -1, 4), 1500, 4, (0.7, 0.84, 1)),
                                                  ("Rim", (2, 4, 6), 2400, 4, (1, 0.94, 0.85)),
                                                  ("Front fill", (0, -6, 2), 650, 3, (0.88, 0.94, 1))):
        data = bpy.data.lights.new(label, "AREA")
        data.energy, data.shape, data.size, data.color = power, "DISK", size, colour
        light = bpy.data.objects.new(label, data)
        bpy.context.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 1)) - light.location).to_track_quat("-Z", "Y").to_euler()
    camera = bpy.data.objects.new("Studio camera", bpy.data.cameras.new("Studio camera"))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    paths = []
    for label, location, lens in views:
        camera.data.lens = lens
        camera.location = location
        camera.rotation_euler = (Vector(focus) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out / f"{prefix}_{label}.png")
        bpy.ops.render.render(write_still=True)
        paths.append(scene.render.filepath)
    contact_sheet(paths, out / f"{prefix}_sheet.png")


def contact_sheet(paths, target, columns=2):
    images = [bpy.data.images.load(p) for p in paths]
    w, h = images[0].size
    rows = math.ceil(len(images) / columns)
    sheet = np.zeros((rows * h, columns * w, 4), np.float32)
    for k, image in enumerate(images):
        pixels = np.empty(w * h * 4, np.float32)
        image.pixels.foreach_get(pixels)
        r, c = divmod(k, columns)
        sheet[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = pixels.reshape(h, w, 4)   # rows start at the bottom
    out = bpy.data.images.new("Contact sheet", columns * w, rows * h, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = str(target)
    out.file_format = "PNG"
    out.save()
    print("CONTACT_SHEET", target)
