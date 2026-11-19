"""Mesh helpers reused from the original Rally vehicle generator. No scene side effects."""
import bpy, bmesh, math
from mathutils import Vector
groups = {}

def material(name, color, metallic=0.0, roughness=.4, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color[:3], color[3] if len(color) == 4 else 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = mat.diffuse_color
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission:
        node.inputs["Emission Color"].default_value = (*color[:3], 1)
        node.inputs["Emission Strength"].default_value = emission
    return mat

def mesh(name, vertices, faces, mat, group="BodyStatic", smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(mat)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for poly in data.polygons:
        poly.use_smooth = smooth
    if group:
        groups.setdefault(group, []).append(obj)
    return obj

def cube(name, loc, scale, mat, bevel=.025, group="BodyStatic"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Soft manufactured edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new("Weighted highlights", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if group:
        groups.setdefault(group, []).append(obj)
    return obj

def line(name, points, radius, mat, group="BodyStatic", cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 2
    data.use_fill_caps = True
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    if group:
        groups.setdefault(group, []).append(obj)
    return obj

def ring(name, centre, radius, tube, mat, axis="X", group="BodyStatic", segments=64):
    verts, faces = [], []
    for i in range(segments):
        a = i * math.tau / segments
        for j in range(8):
            b = j * math.tau / 8
            radial, axial = radius + tube * math.cos(b), tube * math.sin(b)
            p = (axial, radial * math.sin(a), radial * math.cos(a))
            if axis == "Y":
                p = (p[1], p[0], p[2])
            elif axis == "Z":
                p = (p[1], p[2], p[0])
            verts.append(tuple(centre[k] + p[k] for k in range(3)))
    for i in range(segments):
        for j in range(8):
            faces.append((i*8+j, ((i+1)%segments)*8+j, ((i+1)%segments)*8+(j+1)%8, i*8+(j+1)%8))
    return mesh(name, verts, faces, mat, group, True)

def cylinder(name, centre, radius, depth, mat, axis="X", group="BodyStatic", segments=48):
    verts = []
    for axial in (-depth/2, depth/2):
        for i in range(segments):
            a = math.tau*i/segments
            p = (axial, math.sin(a)*radius, math.cos(a)*radius)
            if axis == "Y": p = (p[1], p[0], p[2])
            elif axis == "Z": p = (p[1], p[2], p[0])
            verts.append(tuple(centre[k]+p[k] for k in range(3)))
    faces = [tuple(reversed(range(segments))), tuple(range(segments,segments*2))]
    faces += [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
    return mesh(name, verts, faces, mat, group, True)

def lettering(name,content,loc,size,mat,rotation=(math.pi/2,0,math.pi),group="BodyStatic"):
    data=bpy.data.curves.new(name,"FONT")
    data.body=content
    data.align_x="CENTER"
    data.align_y="CENTER"
    data.size=size
    data.extrude=.0006
    data.space_character=1.12
    data.materials.append(mat)
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=loc
    obj.rotation_euler=rotation
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    groups[group].append(obj)

def join_group(name,objects,parent=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=name
    # Bake local transforms while preserving global coordinates for body parts.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    if parent:obj.parent=parent
    obj.select_set(False)
    return obj
