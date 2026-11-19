"""Original island goats and cows. Blender 5, CPU authoring, no external assets.
blender --background --factory-startup --python tools/wildlife/livestock_build.py
Produces editable blend and compact, single-material skinned GLBs with four clips.
Game coordinates: Y up, +Z nose. Skeleton is 15 rigid/smooth linked visual regions;
physical collision and locomotion are owned by the runtime whole-body proxy.
"""
import bpy, math, os, json
from mathutils import Vector
from mathutils.kdtree import KDTree
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.join(ROOT,'public/models/livestock'); ART=os.path.join(ROOT,'assets/livestock')
os.makedirs(OUT,exist_ok=True); os.makedirs(ART,exist_ok=True)
def cv(p): return (p[0],-p[2],p[1])
def blend(a,b,t): return tuple(a[i]*(1-t)+b[i]*t for i in range(4))
def clamp(x): return max(0,min(1,x))
def coat(p,species):
 x,y,z=p
 if species=='cow':
  patch=math.sin(x*4.1+z*4.5+math.sin(y*5.1))+math.cos(z*6.3-y*3.4)+.45*math.sin(x*15+z*7+y*11)
  a=blend((.025,.032,.03,1),(.83,.81,.74,1),clamp((patch+.1)*14+.5))
 else:
  a=(.49,.35,.21,1)
  stripe=math.exp(-(x/.12)**2)*clamp((y-.55)*4)
  a=blend(a,(.10,.075,.05,1),stripe*.7)
  if y<.25:a=blend(a,(.065,.055,.048,1),clamp((.25-y)*10))
 grain=1+.018*math.sin(x*177+y*93+z*47)*math.cos(z*141-x*63)
 return tuple(c*grain for c in a[:3])+(1,)
class Geo:
 def __init__(self,species): self.v=[];self.f=[];self.c=[];self.w=[];self.species=species;self.flesh=[]
 def vertex(self,p,bone='Root',color=None):
  self.v.append(cv(p));self.c.append(color or coat(p,self.species));self.w.append(bone);self.flesh.append(color is None);return len(self.v)-1
 def loft(self,rings,bone='Root',color=None,n=24):
  # rings (x,y,z, width, vertical radius), longitudinal normal-smoothed skin
  start=len(self.v)
  for x,y,z,rx,ry in rings:
   for j in range(n):
    a=j*2*math.pi/n;self.vertex((x+rx*math.cos(a),y+ry*math.sin(a),z),bone,color)
  for k in range(len(rings)-1):
   for j in range(n):
    a=start+k*n+j;b=start+k*n+(j+1)%n;self.f.append((a,b,b+n,a+n))
  self.f.append(tuple(reversed(range(start,start+n))));e=start+(len(rings)-1)*n;self.f.append(tuple(range(e,e+n)))
 def ellipsoid(self,center,size,bone='Root',color=None,n=24,m=14):
  x,y,z=center;rx,ry,rz=size;r=[]
  for k in range(m+1):
   a=-math.pi/2+math.pi*k/m;rr=max(.002,math.cos(a));r.append((x,y,z+rz*math.sin(a),rx*rr,ry*rr))
  self.loft(r,bone,color,n)
 def tube(self,points,radii,bone='Root',color=None,n=14):
  start=len(self.v)
  for k,p in enumerate(points):
   axis=Vector(points[min(k+1,len(points)-1)])-Vector(points[max(0,k-1)]);axis.normalize();u=axis.cross(Vector((0,0,1)))
   if u.length<.01:u=axis.cross(Vector((1,0,0)))
   u.normalize();v=axis.cross(u)
   for j in range(n):
    a=j*math.tau/n;r=radii[k];r=(r,r) if isinstance(r,(float,int)) else r
    P=Vector(p)+u*(r[0]*math.cos(a))+v*(r[1]*math.sin(a));self.vertex(P,bone,color)
  for k in range(len(points)-1):
   for j in range(n):
    a=start+k*n+j;b=start+k*n+(j+1)%n;self.f.append((a,b,b+n,a+n))
  self.f.append(tuple(reversed(range(start,start+n))));e=start+(len(points)-1)*n;self.f.append(tuple(range(e,e+n)))
 def make(self,bones):
  def object_from_faces(name,faces):
   used=sorted(set(v for face in faces for v in face));mapping={old:i for i,old in enumerate(used)}
   mesh=bpy.data.meshes.new(name);mesh.from_pydata([self.v[i] for i in used],[],[tuple(mapping[i] for i in f) for f in faces]);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
   col=mesh.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
   for i,old in enumerate(used):col.data[i].color=self.c[old]
   for p in mesh.polygons:p.use_smooth=True
   for bone in bones:
    ids=[i for i,old in enumerate(used) if self.w[old]==bone];vg=o.vertex_groups.new(name=bone)
    if ids:vg.add(ids,1,'REPLACE')
   return o
  skin=object_from_faces(self.species+' continuous skin',[f for f in self.f if self.flesh[f[0]]])
  details=object_from_faces(self.species+' eyes horns and cloven hooves',[f for f in self.f if not self.flesh[f[0]]])
  original=[i for i in range(len(self.v)) if self.flesh[i]];tree=KDTree(len(original))
  for i,old in enumerate(original):tree.insert(self.v[old],old)
  tree.balance()
  bpy.context.view_layer.objects.active=skin;skin.select_set(True)
  # Union overlapping muscles into one closed skin, retain separately modelled details.
  remesh=skin.modifiers.new('Continuous sculpted hide','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.009 if self.species=='goat' else .014;remesh.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=remesh.name)
  smooth=skin.modifiers.new('Relax hide','SMOOTH');smooth.factor=.7;smooth.iterations=4;bpy.ops.object.modifier_apply(modifier=smooth.name)
  dec=skin.modifiers.new('Runtime skin topology','DECIMATE');dec.ratio=min(1,14000/max(1,len(skin.data.polygons)));bpy.ops.object.modifier_apply(modifier=dec.name)
  old=skin.data;fresh=bpy.data.meshes.new('clean union mesh');fresh.from_pydata([tuple(v.co) for v in old.vertices],[],[tuple(p.vertices) for p in old.polygons]);fresh.update();skin.data=fresh;bpy.data.meshes.remove(old)
  skin.vertex_groups.clear()
  for bone in bones:skin.vertex_groups.new(name=bone)
  for attr in list(skin.data.color_attributes):skin.data.color_attributes.remove(attr)
  points=[tuple(v.co) for v in skin.data.vertices]
  for i,co in enumerate(points):
   p=(co[0],co[2],-co[1]);near,old,d=tree.find(co);bone=self.w[old]
   # Blend deforming skin at anatomical joint boundaries; rigid details remain separate.
   if bone.endswith('K'):
    hinge=bones[bone][0][1];w=clamp((hinge+.05-p[1])/.10);skin.vertex_groups[bone].add([i],w,'REPLACE');skin.vertex_groups[bones[bone][1]].add([i],1-w,'REPLACE')
   else:skin.vertex_groups[bone].add([i],1,'REPLACE')
  col=skin.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
  for i,co in enumerate(points):col.data[i].color=coat((co[0],co[2],-co[1]),self.species)
  for p in skin.data.polygons:p.use_smooth=True
  details.select_set(True);bpy.context.view_layer.objects.active=skin;bpy.ops.object.join();o=skin;mesh=o.data;o.name=self.species
  mat=bpy.data.materials.new(self.species+' coat eyes horns hooves');mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.78
  attr=mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='Coat';mat.node_tree.links.new(attr.outputs['Color'],bs.inputs['Base Color']);mesh.materials.clear();mesh.materials.append(mat)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False);return o

def build(species):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 g=Geo(species);cow=species=='cow';H=1.45 if cow else .83;L=1.85 if cow else 1.1;W=.42 if cow else .235
 bones={'Root':((0,.65*H,0),None),'Neck':((0,.77*H,L*.35),'Root'),'Head':((0,1.04*H,L*.52),'Neck'),'Tail':((0,.86*H,-L*.48),'Root')}
 # Barrel with withers, shoulder and angular croup rather than a spherical body.
 profiles=[(-.51,.12,.10),(-.47,.76,.74),(-.34,1,1),(-.10,1.04,1.03),(.14,.97,.91),(.34,.9,.83),(.46,.65,.70),(.49,.08,.12)]
 g.loft([(0,.73*H,z*L,W*w,H*.23*v) for z,w,v in profiles],n=40)
 g.ellipsoid((0,.91*H,L*.28),(W*.72,H*.11,L*.18),n=24)
 for sx in [-1,1]:g.ellipsoid((sx*W*.52,.73*H,-L*.33),(W*.54,H*.24,L*.20),n=24)
 # Muscular rising neck, tapered skull and muzzle.
 g.tube([(0,.77*H,L*.34),(0,.96*H,L*.46),(0,1.06*H,L*.55)],[W*.73,W*.56,W*.48],'Neck',n=28)
 g.loft([(0,1.06*H,L*.49,W*.43,H*.14),(0,1.1*H,L*.6,W*.49,H*.145),(0,1.02*H,L*.78,W*.36,H*.09),(0,.995*H,L*.86,W*.30,H*.065)],'Head',n=28)
 muzzle=(.24,.17,.145,1) if cow else (.095,.085,.07,1)
 g.ellipsoid((0,.996*H,L*.854),(W*(.55 if cow else .315),H*(.085 if cow else .072),L*.065),'Head',muzzle)
 g.tube([(-W*.26,.966*H,L*.884),(0,.955*H,L*.90),(W*.26,.966*H,L*.884)],[.004,.006,.004],'Head',(.06,.04,.035,1),8)
 # Eyes with lids, amber/brown iris and horizontal pupils. Lateral surfaces face outward.
 for sx in [-1,1]:
  eye=(sx*W*.443,1.09*H,L*.644)
  g.ellipsoid(eye,(.033 if cow else .022,.038 if cow else .025,.043 if cow else .027),'Head',(.05,.04,.03,1),n=16,m=10)
  iris=(eye[0]+sx*.014,eye[1],eye[2]+.014)
  g.ellipsoid(iris,(.021 if cow else .013,.023 if cow else .016,.026 if cow else .017),'Head',(.24,.17,.065,1),n=16,m=8)
  g.ellipsoid((iris[0]+sx*.012,iris[1],iris[2]+.008),(.008,.006 if cow else .004,.017),'Head',(.009,.01,.01,1),n=12,m=8)
  g.ellipsoid((sx*W*.20,1.018*H,L*.906),(.026 if cow else .014,.014 if cow else .009,.013),'Head',(.035,.025,.022,1),n=16,m=8)
  # Flattened pointed ears, pink recessed inner lobe.
  ear=[(sx*W*.4,1.13*H,L*.55),(sx*W*.8,1.19*H,L*.50),(sx*W*1.12,1.19*H,L*.47)]
  g.tube(ear,[(.026,.035),(.035,.085 if cow else .060),.004],'Head',n=14)
  g.tube([(p[0],p[1]+.016,p[2]+.012) for p in ear],[(.010,.012),(.013,.06 if cow else .038),.002],'Head',(.34,.22,.19,1),n=12)
  # Horns, swept back on goats and outward/upward on cows, modelled annular ridges.
  pts=[];r=[]
  for i in range(24):
   t=i/23
   pts.append((sx*(W*.30+(W*.62*t if cow else W*.10*t)),H*(1.20+(.13 if cow else .42)*math.sin(t*math.pi*.66)),L*(.56-(.05 if cow else .20)*t)))
   r.append((.037 if cow else .026)*(1-t)**.65*(1+.10*math.sin(t*math.pi*34))+.001)
  g.tube(pts,r,'Head',(.32,.28,.21,1),12)
 # Legs. Bone pivots at hips/shoulders and hock/carpus, four independent gait phases.
 for fore in [True,False]:
  for sx in [-1,1]:
   name=('F' if fore else 'R')+('L' if sx<0 else 'R');x=sx*W*.65;z=L*(.34 if fore else -.34);kz=z+(-.025 if fore else .08)*L
   hip=(x,.74*H,z);knee=(x,.38*H,kz);ankle=(x,.105*H,z+(.018 if fore else -.012)*L)
   bones[name]=(hip,'Root');bones[name+'K']=(knee,name)
   g.tube([hip,(x,.57*H,z),knee],[(W*.30,W*.38),(W*.24,W*.25),(W*.18,W*.16)],name,n=20)
   g.ellipsoid(knee,(W*.205,H*.067,W*.20),name,n=16,m=10)
   g.tube([knee,(x,.22*H,(kz+ankle[2])*.5),ankle],[W*.165,W*.10,W*.14],name+'K',n=16)
   # Distinct cloven hoof toes and dark cleft, heel bulb retained.
   for toe in [-1,1]:g.ellipsoid((x+toe*W*.073,.053*H,ankle[2]+.017*L),(W*.069,H*.052,L*.048),name+'K',(.058,.055,.046,1),n=16,m=10)
 if cow:
  g.tube([(0,.68*H,L*.43),(0,.49*H,L*.35),(0,.49*H,L*.22)],[(.045,.06),(.055,.07),.02],'Root',n=18)
  g.ellipsoid((0,.425*H,-L*.25),(W*.46,H*.11,L*.115),'Root',(.50,.33,.27,1))
  for x,z in [(-.10,-.48),(.10,-.48),(-.10,-.32),(.10,-.32)]:g.tube([(x,.37*H,z),(x,.31*H,z)],[.025,.018],'Root',(.39,.25,.21,1),10)
  tail=[(0,.86*H,-L*.49),(.02,.66*H,-L*.55),(.025,.30*H,-L*.58)];g.tube(tail,[.033,.02,.015],'Tail',n=14);g.ellipsoid(tail[-1],(.065,.12,.060),'Tail',(.08,.067,.05,1),n=18)
 else:
  g.tube([(0,.91*H,-L*.46),(0,1.09*H,-L*.57),(0,1.13*H,-L*.60)],[.050,.035,.006],'Tail',n=18)
  # Layered tapered beard tufts, actual silhouette, not a texture card.
  for i in range(9):
   x=(i%3-1)*.015;z=L*.76+(i//3-1)*.012
   g.tube([(x,.95*H,z),(x,.78*H,z-.025),(x+.004,.73*H,z-.046)],[.013,.009,.0008],'Head',(.16,.12,.08,1),8)
 obj=g.make(bones)
 arm=bpy.data.armatures.new(species+' articulated skeleton');rig=bpy.data.objects.new(species+' rig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,(pos,parent) in bones.items():
  b=arm.edit_bones.new(name);b.head=cv(pos);b.tail=cv((pos[0],pos[1]+.12,pos[2]));
  if parent:b.parent=arm.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False);obj.parent=rig;mod=obj.modifiers.new('Skin','ARMATURE');mod.object=rig
 scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1;scene.frame_end=61
 for clip in ['Idle','Walk','Graze','Alert']:
  action=bpy.data.actions.new(clip);rig.animation_data_create();rig.animation_data.action=action
  for f in range(1,62):
   t=(f-1)/60;phase=t*math.tau
   for b in rig.pose.bones:b.rotation_mode='XYZ';b.rotation_euler=(0,0,0)
   rig.pose.bones['Tail'].rotation_euler[1]=.16*math.sin(phase*2)
   rig.pose.bones['Neck'].rotation_euler[0]=((1.44 if cow else 1.23)+.025*math.sin(phase*2)) if clip=='Graze' else (.015*math.sin(phase) if clip=='Idle' else -.04)
   rig.pose.bones['Head'].rotation_euler[0]=.18 if clip=='Graze' else -.015*math.sin(phase)
   rig.pose.bones['Head'].rotation_euler[1]=.035*math.sin(phase) if clip=='Idle' else 0
   if clip=='Alert':rig.pose.bones['Head'].rotation_euler[1]=.16*math.sin(phase)
   if clip=='Walk':
    for name,offset in [('FL',0),('RR',.25),('FR',.5),('RL',.75)]:
     a=phase+offset*math.tau;rig.pose.bones[name].rotation_euler[0]=.36*math.sin(a);rig.pose.bones[name+'K'].rotation_euler[0]=-.42*max(0,math.cos(a))
   for b in rig.pose.bones:b.keyframe_insert('rotation_euler',frame=f,group=b.name)
  track=rig.animation_data.nla_tracks.new();track.name=clip;strip=track.strips.new(clip,1,action);strip.name=clip
  rig.animation_data.action=None
 for track in rig.animation_data.nla_tracks:track.mute=True
 scene.frame_set(1)
 for b in rig.pose.bones:b.rotation_euler=(0,0,0)
 bpy.context.view_layer.update()
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,species+'.blend'))
 for track in rig.animation_data.nla_tracks:track.mute=False
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,species+'.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_skins=True,export_all_influences=False,export_vertex_color='ACTIVE',export_apply=False)
 return {'species':species,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons),'joints':len(bones),'clips':['Idle','Walk','Graze','Alert'],'length':L,'shoulderHeight':H,'source':'Original authored geometry and animation; no external assets'}
manifest=[build('goat'),build('cow')]
with open(os.path.join(OUT,'manifest.json'),'w') as f:json.dump(manifest,f,indent=2)
print(json.dumps(manifest))
