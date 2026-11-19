"""Editable Tidewater delta hang glider, authored in game metres (+Y up,+Z nose).
Run Blender -b --python tools/glider/build.py -- --root .
Sail shape/coefficients are fictional declared assumptions, not a manufacturer replica.
"""
import bpy,bmesh,math,json,sys,argparse
from pathlib import Path
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--no-render',action='store_true');args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
ROOT=Path(args.root).resolve();PUB=ROOT/'public/glider';ASSETS=ROOT/'assets/glider';PUB.mkdir(parents=True,exist_ok=True);ASSETS.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
BATCH={};PIVOTS={};MATS={};OBJECTS=[]
def cv(v):return (v[0],-v[2],v[1])
def mat(name,color,metal=0,rough=.55,alpha=1,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,alpha);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough;n.inputs['Alpha'].default_value=alpha
 if emission:n.inputs['Emission Color'].default_value=(*color,1);n.inputs['Emission Strength'].default_value=emission
 if alpha<1:m.surface_render_method='BLENDED';m.use_transparency_overlap=False
 MATS[name]=m;return name
def mesh(name,v,f,m,group='Static'):
 key=(group,m);vv,ff=BATCH.setdefault(key,([],[]));offset=len(vv);vv.extend(v);ff.extend(tuple(offset+i for i in face) for face in f)
def prism(name,outline,y0,y1,m,group='Static'):
 n=len(outline);v=[(x,y,z) for y in [y0,y1] for x,z in outline];f=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)];mesh(name,v,f,m,group)
def paint_line(name,a,b,width,m):
 dx,dz=b[0]-a[0],b[2]-a[2];length=math.hypot(dx,dz);nx,nz=dz/length*width/2,-dx/length*width/2
 prism(name,[(a[0]+nx,a[2]+nz),(a[0]-nx,a[2]-nz),(b[0]-nx,b[2]-nz),(b[0]+nx,b[2]+nz)],18.031,18.035,m)
def box(name,c,s,m,group='Static',yaw=0):
 x,y,z=c;a,b,d=[i/2 for i in s];co,si=math.cos(yaw),math.sin(yaw);o=[(-a,-d),(a,-d),(a,d),(-a,d)];o=[(x+xx*co+zz*si,z-xx*si+zz*co)for xx,zz in o];prism(name,o,y-b,y+b,m,group)
def rod(name,a,b,r,m,group='Static',n=8):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();t=axis.cross(Vector((0,1,0)))
 if t.length<.01:t=axis.cross(Vector((1,0,0)))
 t.normalize();u=axis.cross(t);v=[]
 for pt in [a,b]:
  for i in range(n):v.append(tuple(pt+r*(t*math.cos(math.tau*i/n)+u*math.sin(math.tau*i/n))))
 f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)];mesh(name,v,f,m,group)
def ring(name,c,r,t,m,normal=(0,1,0),group='Static',n=14,k=5):
 c=Vector(c);axis=Vector(normal).normalized();u=axis.cross(Vector((1,0,0)))
 if u.length<.01:u=axis.cross(Vector((0,1,0)))
 u.normalize();v=axis.cross(u);verts=[]
 for i in range(n):
  radial=u*math.cos(math.tau*i/n)+v*math.sin(math.tau*i/n)
  for j in range(k):verts.append(tuple(c+radial*(r+t*math.cos(math.tau*j/k))+axis*(t*math.sin(math.tau*j/k))))
 faces=[(i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k)for i in range(n)for j in range(k)];mesh(name,verts,faces,m,group)
def ellipsoid(name,c,r,m,group='Static',n=24,k=12):
 v=[]
 for j in range(k+1):
  a=-math.pi/2+math.pi*j/k
  for i in range(n):
   b=math.tau*i/n;v.append((c[0]+r[0]*math.cos(a)*math.cos(b),c[1]+r[1]*math.sin(a),c[2]+r[2]*math.cos(a)*math.sin(b)))
 f=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(k)for i in range(n)];mesh(name,v,f,m,group)
def loft(name,stations,m,group='Static',n=32):
 # Stations: z, half width, half height, vertical centre.
 v=[]
 for z,w,h,y in stations:
  for i in range(n):
   a=math.tau*i/n;v.append((w*math.cos(a),y+h*math.sin(a),z))
 f=[tuple(reversed(range(n))),tuple(range((len(stations)-1)*n,len(stations)*n))]
 f += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(len(stations)-1)for i in range(n)];mesh(name,v,f,m,group)
def pivot(name,point):PIVOTS[name]=point

def build_objects():
 parents={}
 for name,point in PIVOTS.items():
  e=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(e);e.location=cv(point);parents[name]=e;OBJECTS.append(e)
 for (group,m),(vertices,faces) in BATCH.items():
  origin=PIVOTS.get(group,(0,0,0));data=bpy.data.meshes.new(group+'_'+m);data.from_pydata([cv(tuple(v[i]-origin[i]for i in range(3)))for v in vertices],[],faces);data.materials.append(MATS[m]);data.update();bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
  obj=bpy.data.objects.new(group+'_'+m,data);bpy.context.collection.objects.link(obj)
  if group in parents:obj.parent=parents[group]
  OBJECTS.append(obj)
  # Auto-smooth only small adjacent faces; surfaces retain their deliberate hard edges.
  for poly in data.polygons:poly.use_smooth=True
  bpy.context.view_layer.objects.active=obj
  split=obj.modifiers.new('Manufactured edge normals','EDGE_SPLIT');split.split_angle=math.radians(32);split.use_edge_angle=True;bpy.ops.object.modifier_apply(modifier=split.name)
 return parents

def camera_at(point,target,ortho):
 bpy.ops.object.camera_add(location=cv(point));cam=bpy.context.object;cam.rotation_euler=(Vector(cv(target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=ortho;bpy.context.scene.camera=cam


mat('SailIvory',(.91,.86,.70),0,.75);mat('SailOrange',(.93,.25,.055),0,.63);mat('SailTeal',(.035,.23,.29),0,.62);mat('Aluminium',(.62,.68,.69),.86,.3);mat('Cable',(.075,.095,.105),.7,.37);mat('Harness',(.08,.12,.16),0,.85);mat('Helmet',(.96,.71,.16),.1,.48);mat('Visor',(.02,.09,.14),.3,.21);mat('Gloves',(.25,.13,.075),0,.9)
def sail(x,t):
 span=abs(x)/5.1;front=1.75-.4*abs(x);back=-1.35+.2*abs(x);return (x,.10+.025*abs(x)+.22*(1-span)*math.sin(math.pi*t)-.035*abs(x)*t,front+(back-front)*t)
for side in [-1,1]:
 for i in range(26):
  x0=side*5.1*i/26;x1=side*5.1*(i+1)/26
  for j in range(14):
   t0=j/14;t1=(j+1)/14;color='SailOrange' if i>20 or j<3 else 'SailTeal' if 10<i<16 else 'SailIvory'
   vs=[sail(x0,t0),sail(x1,t0),sail(x1,t1),sail(x0,t1)];mesh('Airfoil sail panel',vs,[(0,1,2,3) if side>0 else (3,2,1,0)],color)
 # Sewn battens, leading-edge sleeves and tension straps.
 for i in range(11):
  x=side*(.18+i*.46)
  for j in range(12):rod('Batten',sail(x,j/12),sail(x,(j+1)/12),.009,'Cable',n=5)
 for j in range(25):rod('Leading tube',sail(side*5.1*j/25,0),sail(side*5.1*(j+1)/25,0),.034,'Aluminium',n=10)
 rod('Crossbar',(0,.055,-.9),(side*3.4,.12,.4),.030,'Aluminium',n=10)
 rod('Upper flying wire',(0,1.42,-.15),(side*3.3,.14,.37),.006,'Cable',n=5)
 rod('Lower flying wire',(side*.86,-1.45,.32),(side*3.3,.14,.37),.007,'Cable',n=5)
 rod('A-frame upright',(0,-.02,.12),(side*.86,-1.45,.32),.027,'Aluminium',n=10)
 rod('Side rear wire',(side*.86,-1.45,.32),(0,.09,-1.5),.006,'Cable',n=5)
 rod('Nose rigging',(side*.86,-1.45,.32),(0,.12,1.70),.006,'Cable',n=5)
 for z in [-.8,.8]:ring('Rigging pin',(side*.03,.12,z),.043,.012,'Cable',normal=(0,0,1),n=10,k=5)
rod('Keel',(0,.05,-1.58),(0,.10,1.72),.035,'Aluminium',n=12)
rod('Kingpost',(0,.04,-.15),(0,1.42,-.15),.025,'Aluminium',n=10)
rod('Top front rigging',(0,1.42,-.15),(0,.12,1.70),.006,'Cable',n=5)
rod('Top rear rigging',(0,1.42,-.15),(0,.09,-1.5),.006,'Cable',n=5)
rod('Control bar',(-.87,-1.45,.32),(.87,-1.45,.32),.031,'Aluminium',n=12)
for x in [-.6,.6]:rod('Hand grip',(x-.10,-1.45,.32),(x+.10,-1.45,.32),.038,'Cable',n=10)
pivot('Pilot',(0,-.15,.0));rod('Hang strap',(0,-.12,-.2),(0,-.78,-.2),.025,'Harness','Pilot',n=8)
ellipsoid('Aerodynamic harness',(0,-.93,-.54),(.23,.22,.86),'Harness','Pilot',n=24,k=14)
ellipsoid('Pilot shoulders',(0,-.87,.22),(.31,.22,.29),'SailOrange','Pilot',n=20,k=12)
ellipsoid('Helmet',(0,-.85,.71),(.19,.21,.23),'Helmet','Pilot',n=24,k=14)
ellipsoid('Helmet visor',(0,-.84,.87),(.16,.12,.08),'Visor','Pilot',n=20,k=10)
for side in [-1,1]:
 rod('Upper arm',(side*.24,-.89,.3),(side*.43,-1.17,.38),.067,'SailOrange','Pilot',n=10)
 rod('Forearm',(side*.43,-1.17,.38),(side*.59,-1.42,.33),.055,'Harness','Pilot',n=10)
 ellipsoid('Glove',(side*.59,-1.42,.33),(.074,.063,.078),'Gloves','Pilot',n=12,k=7)
 rod('Harness stitching',(side*.18,-.84,-1.03),(side*.21,-.76,-.28),.006,'SailIvory','Pilot',n=5)
 box('Harness buckle',(side*.2,-.81,-.18),(.07,.055,.08),'Aluminium','Pilot')
# A small real instrument pod on the control frame.
box('Flight instrument',(.50,-1.37,.36),(.15,.13,.12),'Harness')
box('LCD face',(.50,-1.30,.36),(.12,.006,.09),'SailIvory')
for z in [.34,.37,.40]:rod('LCD graph',(.47,-1.295,z),(.53,-1.295,z),.004,'Cable',n=4)
build_objects()
bpy.ops.object.select_all(action='DESELECT')
for obj in OBJECTS:obj.select_set(True)
bpy.context.view_layer.objects.active=next(o for o in OBJECTS if o.type=='MESH')
bpy.ops.export_scene.gltf(filepath=str(PUB/'glider.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False,export_animations=False)
triangles=sum(sum(len(f.vertices)-2 for f in o.data.polygons)for o in OBJECTS if o.type=='MESH');stats={'asset':'glider','triangles':triangles,'meshes':sum(o.type=='MESH'for o in OBJECTS),'pivots':PIVOTS,'axes':'+Y up +Z nose metres','bytes':(PUB/'glider.glb').stat().st_size};(PUB/'glider.json').write_text(json.dumps(stats,indent=2));print('GLIDER_MODEL',json.dumps(stats),flush=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1440;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Hang glider studio');scene.world.color=(.23,.27,.30)
bpy.ops.object.light_add(type='AREA',location=cv((-8,15,6)));light=bpy.context.object;light.data.energy=2500;light.data.size=12;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.4,-.3,-.6)
camera_at((-9,6,10),(0,-.2,0),13);scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ASSETS/'glider-preview.png');bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'glider.blend'))
if not args.no_render:bpy.ops.render.render(write_still=True)
