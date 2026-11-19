"""European-format custom plate: black face, white border and raised lettering, a red band on
the left. +Z-facing after glTF export; the vehicle loader mounts copies front and rear."""
import sys,math
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_primitives import material,cube,cylinder,join_group,groups
ROOT=Path(__file__).resolve().parents[2]
FONT=Path('/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
font=bpy.data.fonts.load(str(FONT)) if FONT.exists() else None

def raised_text(name,content,loc,size,mat,fit=None,bold=0.0):
    data=bpy.data.curves.new(name,'FONT')
    data.body=content;data.align_x='CENTER';data.align_y='CENTER'
    data.size=size;data.extrude=.0022;data.space_character=1.0;data.offset=bold
    if font:data.font=font
    data.materials.append(mat)
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    obj.location=loc;obj.rotation_euler=(math.pi/2,0,0)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH');obj.select_set(False)
    if fit:
        # Fit the converted glyph mesh itself (curve dimensions miss the outline offset and
        # side bearings): scale into the fit box and centre it on loc. Local x is plate x,
        # local y is plate up (rotated a quarter turn about x).
        xs=[v.co.x for v in obj.data.vertices];ys=[v.co.y for v in obj.data.vertices]
        s=min(1.0,fit[0]/(max(xs)-min(xs)),fit[1]/(max(ys)-min(ys)))
        obj.scale=(s,s,s)
        obj.location=(loc[0]-s*(max(xs)+min(xs))/2,loc[1],loc[2]-s*(max(ys)+min(ys))/2)
    groups['BodyStatic'].append(obj)

face=material('PlateBlack',(.012,.012,.013),.05,.42)
ink=material('PlateWhite',(.92,.92,.90),.05,.45)
red=material('PlateBand',(.56,.018,.016),.05,.42)
W,H,FRONT=.70,.165,-.0095
cube('Number plate',(0,0,0),(W,.018,H),face,.008)
# Border and band, just proud of the face.
for z in (H/2-.011,-(H/2-.011)):cube('Plate border',(0,FRONT-.001,z),(W-.016,.002,.006),ink,.001)
for x in (W/2-.011,-(W/2-.011)):cube('Plate border',(x,FRONT-.001,0),(.006,.002,H-.016),ink,.001)
band=-W/2+.064
cube('Plate band',(band,FRONT-.001,0),(.086,.002,H-.03),red,.002)
for k in range(12):
    a=k*math.tau/12
    cylinder('Band star',(band+.025*math.cos(a),FRONT-.0025,.027+.025*math.sin(a)),.004,.0015,ink,'Y',segments=8)
raised_text('Band letters','TW',(band,FRONT-.0025,-.043),.038,ink)
# Lettering box inside the border: 22 mm clear of the band and the right border, 20 mm top and bottom.
left,right=band+.043+.022,W/2-.014-.022
top,bottom=H/2-.014-.02,-(H/2-.014-.02)
raised_text('Plate text','@cosier',((left+right)/2,FRONT-.0025,(top+bottom)/2),.14,ink,fit=(right-left,top-bottom),bold=.004)
root=bpy.data.objects.new('CosierPlate',None);bpy.context.collection.objects.link(root)
root['text']='@cosier'
join_group('Raised plate and lettering',groups['BodyStatic'],root)
bpy.ops.object.select_all(action='DESELECT')
for obj in [root]+list(root.children_recursive):obj.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/rally/cosier_plate.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/rally/cosier_plate.blend'))
