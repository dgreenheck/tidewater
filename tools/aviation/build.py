"""Reproducible Tidewater aviation assets. Blender 5.0+, no external downloads.
Run: blender -b --python tools/aviation/build.py -- --root .
Author coordinates are GAME: +Y up, +Z nose, metres. Vertex conversion (x,-z,y)
then glTF Y-up export gives game coordinates identically. Named pivots survive.
Repeated hardware is batched per material and pivot, not thousands of draw calls.
"""
import subprocess
import bpy, bmesh, math, json, argparse, os, random, sys
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--no-render',action='store_true');p.add_argument('--asset',choices=['all','carrier','fighter'],default='all');args=p.parse_args(args)
ROOT=Path(args.root).resolve();PUB=ROOT/'public/aviation';ASSETS=ROOT/'assets/aviation';PUB.mkdir(parents=True,exist_ok=True);ASSETS.mkdir(parents=True,exist_ok=True)
BATCH={};PIVOTS={};MATS={};OBJECTS=[]
def cv(v):return (v[0],-v[2],v[1])
def mat(name,color,metal=0,rough=.55,alpha=1,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,alpha);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough;n.inputs['Alpha'].default_value=alpha
 if emission:n.inputs['Emission Color'].default_value=(*color,1);n.inputs['Emission Strength'].default_value=emission
 if alpha<1:m.surface_render_method='BLENDED';m.use_transparency_overlap=False
 MATS[name]=m;return name
def mesh(name,v,f,m,group='Static'):
 # Tiny hinge and service details reuse their assembly finish to bound draw calls.
 if group.startswith('Aileron'):m='AircraftGrey'
 elif group.startswith('Flap'):m='HullPanelGrey'
 elif group.startswith('Gear') and m=='Black':m='Rubber'
 elif group.startswith('Gear') and m=='SafetyYellow':m='SteelGrey'
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

def paint():
 mat('HullGrey',(.34,.39,.41),.25,.65);mat('HullPanelGrey',(.30,.35,.37),.22,.72);mat('BootTop',(.028,.033,.035),.1,.75);mat('Antifouling',(.22,.062,.047),.0,.85)
 mat('DeckNonslip',(.075,.095,.11),.1,.93);mat('SteelGrey',(.43,.49,.51),.55,.43);mat('SteelDark',(.13,.17,.18),.75,.4);mat('BrightMetal',(.58,.64,.66),.92,.28)
 mat('WhiteMarking',(.78,.81,.78),0,.8);mat('SafetyYellow',(.9,.60,.08),.05,.6);mat('SafetyRed',(.63,.052,.025),.12,.6);mat('Glass',(.025,.14,.19),.5,.17)
 mat('Black',(.015,.021,.023),.1,.7);mat('Rubber',(.019,.023,.026),0,.9);mat('Orange',(.94,.25,.035),0,.5);mat('AircraftGrey',(.38,.46,.49),.35,.46);mat('AircraftLight',(.5,.58,.60),.3,.5)
 mat('Canopy',(.11,.32,.38),.65,.11,.48);mat('GreenLight',(.12,.9,.4),0,.4,1,3);mat('RedLight',(1,.075,.035),0,.4,1,3);mat('WarmLight',(.94,.8,.47),0,.4,1,2)

def text_mesh(content,point,size,m,rotation=(math.pi/2,0,0),group='Static'):
 # Use Blender text only as a modelling tool; converted geometry is batched.
 data=bpy.data.curves.new('Deck lettering','FONT');data.body=content;data.align_x='CENTER';data.size=size;data.extrude=.001
 obj=bpy.data.objects.new(content,data);bpy.context.collection.objects.link(obj);obj.location=cv(point);obj.rotation_euler=rotation;bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');bpy.context.view_layer.update()
 verts=[]
 for v in obj.data.vertices:
  q=obj.matrix_world@v.co;verts.append((q.x,q.z,-q.y))
 mesh(content,verts,[tuple(f.vertices)for f in obj.data.polygons],m,group);bpy.data.objects.remove(obj,do_unlink=True)

def carrier():
 # Lofted hull: fine bow, broad stern, rounded bilges and flared upper shell.
 stations=[(-158,12),(-148,17),(-125,19),(-90,20),(-40,20),(20,20),(65,19.5),(100,17),(125,12),(145,6),(158,.6)]
 section=[(-.92,16),(-1,7),(-.96,0),(-.9,-5),(-.68,-9),(-.33,-10.8),(0,-11),(.33,-10.8),(.68,-9),(.9,-5),(.96,0),(1,7),(.92,16)]
 for ylow,yhigh,material in [(-11,-.2,'Antifouling'),(-.2,.8,'BootTop'),(.8,16,'HullGrey')]:
  # Separate waterline material bands preserve genuine hull shape.
  ringv=[]
  for z,w in stations:
   points=[(x,y)for x,y in section if ylow<=y<=yhigh]
   def width(y):
    tab=[(-11,.04),(-10.8,.33),(-9,.68),(-5,.9),(0,.96),(7,1),(16,.92)]
    for i in range(len(tab)-1):
     if tab[i][0]<=y<=tab[i+1][0]:return tab[i][1]+(tab[i+1][1]-tab[i][1])*(y-tab[i][0])/(tab[i+1][0]-tab[i][0])
    return .92
   ys=sorted(set([ylow,yhigh]+[v for v in [-10.8,-9,-5,0,7]if ylow<v<yhigh]));points=[(-width(y),y)for y in reversed(ys)]+[(width(y),y)for y in ys]
   ringv.append([(x*w,y,z)for x,y in points])
  n=len(ringv[0]);verts=sum(ringv,[]);faces=[tuple(reversed(range(n))),tuple(range((len(ringv)-1)*n,len(ringv)*n))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(len(ringv)-1)for i in range(n)]
  mesh('Hydrodynamic hull',verts,faces,material)
 outline=[(-27,-160),(27,-160),(36,-135),(36,68),(28,145),(18,160),(-18,160),(-34,110),(-42,35),(-42,-70),(-35,-145)]
 prism('Flight deck structural edge',outline,16,18,'HullGrey');prism('Flight deck',outline,18,18.025,'DeckNonslip')
 # Island: terraced and chamfered on the starboard edge.
 def island_tier(y0,y1,x0,x1,z0,z1,m):prism('Faceted island',[(x0+1,z0),(x1-1,z0),(x1,z0+2),(x1,z1-2),(x1-2,z1),(x0,z1),(x0,z0+2)],y0,y1,m)
 island_tier(18,25,20,34,-27,27,'HullGrey');island_tier(25,31,20.7,34,-22,25,'HullPanelGrey');island_tier(31,36,21.3,34,-16,23,'HullGrey');island_tier(36,40,19.7,35,-8,21,'HullPanelGrey')
 island_tier(40,43,21.3,34,-5,17,'HullGrey');island_tier(43,45,22,33,-1,13,'HullGrey')
 for y,z0,z1,x0,x1 in [(29,-20,24,20.5,34.1),(38,-6,20,19.6,35.1),(41.5,-4,16,21.2,34.1)]:
  for z in range(int(z0),int(z1),3):
   for x in [x0,x1]:box('Bridge window',(x,y,z+1),(0.08,1.25,2.2),'Glass')
  for x in range(int(x0+1),int(x1),2):box('Bridge forward window',(x,y,z1),(1.4,1.25,.1),'Glass')
 for z in [-18,-9,0,9,18]:
  box('Island access door',(19.98,21,z),(.08,2.1,1.0),'SteelDark');rod('Door handle',(19.86,21,z-.2),(19.86,21,z+.15),.035,'BrightMetal')
 # Intake/exhaust trunks, gantry mast, scanned array radar and antenna farms.
 box('Exhaust trunk',(29,39,-17),(6,16,9),'HullPanelGrey');box('Stack cap',(29,47.2,-17),(6.6,1,9.6),'Black')
 for z in [-19,-16,-13]:box('Stack louvres',(25.95,42,z),(.12,7,1.1),'SteelDark')
 for x in [24,31]:rod('Mast leg',(x,43,5),(27.5,59,6),.34,'SteelGrey',n=10)
 rod('Mast platform',(21,51,6),(34,51,6),.3,'SteelGrey');box('Radar platform',(27.5,52,6),(13,1,8),'HullGrey')
 pivot('CarrierRadar',(27.5,56,6));box('Radar back',(27.5,56,6),(10,4.5,1.4),'SteelDark','CarrierRadar')
 for ix in range(12):
  for iy in range(5):box('Radar tile',(22.5+ix*.87,54.2+iy*.85,6.78),(.77,.72,.12),'SteelGrey','CarrierRadar')
 for x,z,h in [(24,1,16),(31,1,13),(23,10,12),(32,11,18),(28,-1,20)]:rod('Antenna',(x,45,z),(x,45+h,z),.08,'SteelGrey');rod('Antenna brace',(x-1,46,z),(x,51,z),.04,'SteelGrey')
 for x,z in [(22,14),(32,-9)]:ellipsoid('Comms radome',(x,47,z),(1.8,2,1.8),'WhiteMarking')
 # Catapult tracks, shuttle pockets and raised blast deflectors.
 for x in [8,21]:
  for dx in [-.5,.5]:box('Catapult rail',(x+dx,18.075,76),(.12,.1,106),'BrightMetal')
  box('Catapult slot',(x,18.05,76),(.55,.03,106),'Black');box('Catapult shuttle',(x,18.14,24),(1.0,.15,1.8),'SteelGrey')
  for k in range(6):
   z=14-k*.65;box('Blast deflector segment',(x,18.3+k*.44,z),(9,.24,.8),'SteelDark')
   rod('Deflector ram',(x-3.6,18,10),(x-3.6,20.2,11.5),.15,'BrightMetal')
  for side in [-1,1]:box('Launch stripe',(x+side*4.8,18.04,77),(.24,.025,108),'WhiteMarking')
 # Angled recovery runway, clear landing area, actual corresponding wires.
 heading=-math.radians(7);sx,cx=math.sin(heading),math.cos(heading)
 def runway(x,z,y=18.055):return (-9+x*cx+z*sx,y,-142-x*sx+z*cx)
 for side in [-1,1]:
  a=runway(side*12,0);b=runway(side*12,195);paint_line('Landing lane edge',a,b,.24,'WhiteMarking')
 for z in range(0,187,14):paint_line('Landing centre dash',runway(0,z),runway(0,z+6),.3,'WhiteMarking')
 for z in [30,42,54,66]:
  rod('Arresting cable',runway(-12.5,z,18.13),runway(12.5,z,18.13),.065,'BrightMetal',n=8)
  for side in [-1,1]:ellipsoid('Cable sheave',runway(side*13,z,18.16),(.35,.18,.4),'SteelDark',n=12,k=5)
 for x in [-8,-5,-2,2,5,8]:paint_line('Threshold piano keys',runway(x,3),runway(x,10),.8,'WhiteMarking')
 # Elevators with panel gaps and caution perimeter.
 for x,z,w,l in [(29,-80,13,25),(29,65,13,25),(-34,-95,14,23)]:
  box('Deck elevator',(x,18.05,z),(w,.10,l),'HullPanelGrey')
  for xx in [x-w/2,x+w/2]:box('Elevator seam',(xx,18.12,z),(.16,.06,l),'Black')
  for zz in [z-l/2,z+l/2]:box('Elevator caution',(x,18.12,zz),(w,.06,.22),'SafetyYellow')
 # Catwalks and repeated rails and safety nets follow deck outline.
 for i,(x,z) in enumerate(outline):
  xx,zz=outline[(i+1)%len(outline)];d=math.hypot(xx-x,zz-z);n=max(1,int(d/3));nx=(zz-z)/d;nz=-(xx-x)/d
  a=(x+nx*1.1,15.5,z+nz*1.1);b=(xx+nx*1.1,15.5,zz+nz*1.1);rod('Catwalk outer rail',a,b,.1,'SteelGrey');rod('Deck safety net frame',(x,17.3,z),(xx,17.3,zz),.09,'SteelGrey')
  for j in range(n):
   t=(j+.5)/n;px=x+(xx-x)*t;pz=z+(zz-z)*t
   rod('Catwalk support',(px,16,pz),(px+nx*1.8,14.8,pz+nz*1.8),.12,'SteelGrey')
   rod('Catwalk stanchion',(px+nx*1.1,14.5,pz+nz*1.1),(px+nx*1.1,16.5,pz+nz*1.1),.065,'SteelGrey')
   rod('Net rib',(px,17.3,pz),(px+nx*2.1,17.5,pz+nz*2.1),.035,'SteelGrey')
  for off in [.7,1.4,2.1]:rod('Net longitudinal',(x+nx*off,17.3+off*.09,z+nz*off),(xx+nx*off,17.3+off*.09,zz+nz*off),.025,'SteelGrey')
 # Tie-down crosses, deck weld panels, drain grilles and navigation lights.
 for x in range(-28,29,7):
  for z in range(-140,140,12):
   if x>17 and -35<z<33:continue
   ring('Tie-down eye',(x,18.07,z),.18,.035,'Black',n=10,k=4)
   rod('Tie-down bar',(x-.13,18.1,z),(x+.13,18.1,z),.025,'SteelGrey')
 for z in range(-135,130,15):
  for x in [-25,25]:
   box('Scupper grate',(x,18.04,z),(1.6,.05,.5),'SteelDark')
   for k in range(5):box('Scupper rib',(x-.7+k*.35,18.08,z),(.06,.04,.55),'SteelGrey')
 # Hull service galleries, doorways, boat cradles, rescue boats and life rafts.
 for side in [-1,1]:
  for z in range(-115,90,34):
   x=side*21
   box('Service gallery',(x,10,z),(5,1.2,20),'HullPanelGrey')
   for zz in [-6,0,6]:box('Gallery doorway',(side*20.1,12,z+zz),(.16,3.2,2),'SteelDark')
   ellipsoid('Rescue boat',(side*23,12,z),(2,1.5,5.6),'HullGrey',n=20,k=8);ellipsoid('Boat flotation',(side*23,13,z),(1.8,.7,4.7),'Orange',n=16,k=6)
   for off in [-4,4]:rod('Davit',(side*21,11,z+off),(side*26,16,z+off),.18,'SteelGrey');rod('Davit cable',(side*26,16,z+off),(side*24,13,z+off),.045,'SteelDark')
  for z in range(-130,130,18):
   for zz in [-2,2]:rod('Life raft canister',(side*23.5,15,z+zz-1.1),(side*23.5,15,z+zz+1.1),.55,'WhiteMarking',n=12)
 # Stern wake deck galleries and recessed mooring fixtures.
 for x in [-20,-12,12,20]:rod('Mooring bollard',(x,12,-157),(x,13.3,-157),.4,'SteelDark',n=12);rod('Mooring crossbar',(x-.8,13,-157),(x+.8,13,-157),.22,'SteelDark')
 for side in [-1,1]:
  for z in [-130,-70,0,80,130]:ellipsoid('Flight deck light',(side*31,18.3,z),(.18,.13,.25),'WarmLight',n=8,k=4)
 text_mesh('07',(0,18.08,137),9,'WhiteMarking',rotation=(0,0,0));text_mesh('TIDEWATER',(36.04,20,-12),1.4,'WhiteMarking',rotation=(math.pi/2,0,math.pi/2))


def airfoil(name,sign,stations,y,m,group='Static'):
 # Span stations (absolute x, leading z, trailing z), a symmetric thickness
 # distribution with a rounded leading edge and closed sharp trailing edge.
 n=18;v=[]
 for x,lead,trail in stations:
  chord=lead-trail
  for side in [1,-1]:
   for j in range(n+1):
    t=(1-math.cos(math.pi*j/n))/2
    thickness=5*.045*chord*(.2969*math.sqrt(t)-.126*t-.3516*t*t+.2843*t**3-.1036*t**4)
    v.append((sign*x,y+side*thickness,lead-t*chord))
 step=2*(n+1);f=[]
 for i in range(len(stations)-1):
  for side in range(2):
   for j in range(n):
    a=i*step+side*(n+1)+j;b=a+step;f.append((a,a+1,b+1,b)if side==0 else(a,b,b+1,a+1))
 for i in [0,len(stations)-1]:
  base=i*step;f.append(tuple([base+j for j in range(n+1)]+[base+n+1+j for j in reversed(range(n+1))]))
 mesh(name,v,f,m,group)

def fighter():
 loft('Shaped fuselage',[(-8.6,.45,.5,.0),(-7.5,1.08,.75,.02),(-5.8,1.33,.87,.05),(-3.5,1.52,.93,.1),(-1,1.43,.86,.09),(1,1.08,.75,.12),(3,.87,.7,.15),(5,.69,.6,.16),(6.5,.52,.44,.17),(8,.28,.26,.12),(9.2,.015,.025,.04)],'AircraftGrey')
 # Upper chine shoulders join twin intake roots with the wing and fuselage.
 for s in [-1,1]:
  prism('Leading edge root extension',[(s*.7,5.1),(s*1.45,2.6),(s*2.25,.6),(s*2,-1.7),(s*.8,-2)],-.05,.27,'AircraftLight')
  airfoil('Main wing',s,[(1.1,2.2,-2.8),(1.8,1.66,-2.77),(3.8,-.06,-3.12),(6.45,-2.31,-3.69),(6.8,-2.6,-4.4)],0,'AircraftLight')
  pivot('Aileron'+('R'if s>0 else'L'),(s*5.1,-.025,-3.5));airfoil('Aileron',s,[(3.8,-3.15,-4.14),(6.45,-3.72,-4.42)],-.035,'AircraftGrey','Aileron'+('R'if s>0 else'L'))
  pivot('Flap'+('R'if s>0 else'L'),(s*2.5,-.04,-2.9));airfoil('Trailing flap',s,[(1.8,-2.8,-3.55),(3.8,-3.15,-4.15)],-.04,'HullPanelGrey','Flap'+('R'if s>0 else'L'))
  pivot('Elevator'+('R'if s>0 else'L'),(s*2.3,.2,-6.5));airfoil('Tailplane',s,[(.8,-5.2,-8.15),(2.4,-5.9,-8.2),(3.6,-7.1,-8.4)],.17,'AircraftLight','Elevator'+('R'if s>0 else'L'))
  # Canted twin tail fins, with separately hinged rudder trailing edges.
  fin=[(s*1.03,.55,-4.8),(s*1.55,3.35,-6.4),(s*2.02,3.65,-7.7),(s*1.63,.75,-8.2)]
  vv=[(x+s*t,y,z)for t in [-.05,.05]for x,y,z in fin];mesh('Canted tail fin',vv,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'AircraftGrey')
  name='Rudder'+('R'if s>0 else'L');pivot(name,(s*1.65,2,-7.5));mesh('Rudder',[(s*1.5,1,-7.65),(s*1.89,3.4,-7.56),(s*2.02,3.65,-7.85),(s*1.66,.8,-8.27)],[(0,1,2,3)],'AircraftLight',name)
  # Hollow intake lips, diverter ramp and dark recessed duct.
  x=s*1.2
  intake_duct(s)
  rod('Intake upper lip',(x-s*.43,.15,2.86),(x+s*.57,.1,2.55),.055,'BrightMetal')
  box('Diverter plate',(s*.9,-.2,2.35),(.04,1,1.25),'SteelDark')
  # Nozzles have overlapping metal petals and an internal turbine shadow.
  centre=(s*.7,0,-8.1)
  rod('Exhaust dark opening',(s*.7,0,-7.23),(s*.7,0,-7.26),.4,'Black',n=24)
  ring('Exhaust collar',centre,.46,.07,'BrightMetal',normal=(0,0,1),n=24,k=5)
  for i in range(16):
   a=math.tau*i/16;b=math.tau*(i+1)/16
   v=[(s*.7+r*math.cos(t),r*math.sin(t),z)for r,z in[(.47,-7.85),(.38,-8.6)]for t in[a,b]];mesh('Nozzle petal',v,[(0,1,3,2)],'SteelDark'if i%2 else'BrightMetal')
  # Access panel seams and rivets are geometry, retained in exported render.
  for z in [-5.5,-3.5,-1.4,1.2]:rod('Fuselage panel seam',(s*1.24,.46,z),(s*1.3,.12,z),.011,'SteelDark',n=5)
  for z in [-3,-2,-1,0,1]:ellipsoid('Fastener',(s*1.45,.15,z),(.026,.015,.026),'BrightMetal',n=6,k=4)
  ring('Wing insignia',(s*4.5,.075,-2.6),.38,.085,'WhiteMarking',n=24,k=4);ring('Wing insignia inner',(s*4.5,.08,-2.6),.16,.06,'SafetyRed',n=20,k=4)
  ellipsoid('Navigation lamp',(s*6.8,.08,-3.1),(.08,.07,.2),'GreenLight'if s>0 else'RedLight',n=10,k=5)
 # Transparent swept canopy, separate frame, ejection seat and visible cockpit.
 loft('Canopy',[ (1.25,.35,.17,.87),(1.8,.58,.52,1.05),(2.65,.61,.76,1.06),(3.6,.55,.69,1.0),(4.5,.39,.45,.93),(5.05,.1,.12,.82)],'Canopy',n=32)
 for s in [-1,1]:
  pts=[(s*.3,.92,1.35),(s*.6,1.05,2),(s*.6,1.15,3),(s*.49,1.07,4),(s*.15,.9,5)]
  for i in range(len(pts)-1):rod('Canopy sill',pts[i],pts[i+1],.048,'SteelDark')
 rod('Canopy rear bow',(-.54,1.17,1.9),(0,1.66,1.9),.04,'SteelDark');rod('Canopy rear bow',(0,1.66,1.9),(.54,1.17,1.9),.04,'SteelDark')
 box('Cockpit floor',(0,.65,2.8),(.9,.12,2.8),'Black');box('Seat back',(0,1.15,2.1),(.6,.8,.3),'Black');box('Seat cushion',(0,.91,2.53),(.61,.16,.6),'Rubber');box('Headrest',(0,1.64,2.1),(.4,.28,.2),'Rubber')
 box('Instrument coaming',(0,1.05,3.65),(.82,.28,.6),'Black');box('Instrument screen',(0,1.17,3.42),(.36,.12,.05),'GreenLight');rod('Control stick',(0,.87,2.95),(0,1.18,2.95),.04,'SteelDark')
 for s in [-1,1]:rod('Harness',(s*.19,1.51,2.31),(s*.12,.96,2.65),.04,'SafetyYellow')
 # Three independently animated retractable gear assemblies, detailed struts,
 # torque links, hubs and tyre toroids. Wheel ground tangency is exactly y=-2.
 for name,x,z,piv in [('GearNose',0,5.3,(0,-.55,4.9)),('GearLeft',-2.65,-1.7,(-1.7,-.5,-1.7)),('GearRight',2.65,-1.7,(1.7,-.5,-1.7))]:
  pivot(name,piv);radius=.36 if x==0 else .45;cy=-2+radius
  rod('Oleo outer',piv,(x,-1.25,z),.115,'SteelGrey',name,n=12);rod('Oleo piston',(x,-1.05,z),(x,cy,z),.065,'BrightMetal',name,n=12)
  rod('Gear scissor',(x,-.95,z+.16),(x,-1.26,z+.33),.045,'SteelDark',name);rod('Gear scissor',(x,-1.26,z+.33),(x,-1.55,z+.13),.04,'SteelDark',name)
  rod('Axle',(x-.22,cy,z),(x+.22,cy,z),.07,'BrightMetal',name)
  ring('Tyre',(x,cy,z),radius*.75,radius*.25,'Rubber',normal=(1,0,0),group=name,n=24,k=8)
  rod('Wheel hub',(x-.15,cy,z),(x+.15,cy,z),radius*.48,'SteelGrey',name,n=16)
  for sign in [-1,1]:ring('Hub rim',(x+sign*.155,cy,z),radius*.39,.025,'BrightMetal',normal=(1,0,0),group=name,n=16,k=4)
  box('Gear door',(piv[0]+(.3 if x>=0 else-.3),-.53,z),(.42,.06,1.4),'AircraftLight',name)
 pivot('ArrestorHook',(0,-.4,-5.8));rod('Hook shank',(0,-.4,-5.8),(0,-.5,-7.9),.065,'BrightMetal','ArrestorHook');rod('Hook shoe',(0,-.5,-7.9),(0,-.65,-7.72),.09,'SteelDark','ArrestorHook')
 # Nose sensor, vents and maintenance markings. No weapons or hardpoints.
 rod('Nose probe',(0,.04,9.05),(0,.04,9.65),.018,'BrightMetal')
 for s in [-1,1]:
  for i in range(7):box('Cooling louvre',(s*.7,.72,-2.9+i*.18),(.45,.025,.07),'SteelDark')
 text_mesh('07',(0,.77,6),.5,'WhiteMarking',rotation=(0,0,0))

def line(name,points,r,m,group='Static',n=6):
 for a,b in zip(points,points[1:]):rod(name,a,b,r,m,group,n)

def railing(x0,x1,z0,z1,y,m='SteelGrey'):
 corners=[(x0,z0),(x1,z0),(x1,z1),(x0,z1),(x0,z0)]
 for (x,z),(xx,zz) in zip(corners,corners[1:]):
  for h in [.42,1.05]:rod('Gallery handrail',(x,y+h,z),(xx,y+h,zz),.045,m,n=6)
  count=max(1,int(math.hypot(xx-x,zz-z)/2.1))
  for i in range(count+1):
   t=i/count;rod('Gallery upright',(x+(xx-x)*t,y,z+(zz-z)*t),(x+(xx-x)*t,y+1.05,z+(zz-z)*t),.047,m,n=6)

def deck_vehicle(x,z,yaw=0,kind='tractor'):
 # Complete local vehicle assemblies, transformed into the same material batches.
 base={key:len(value[0])for key,value in BATCH.items()}
 y=18.08
 box('Tug chassis',(0,y+.42,0),(2.3,.48,4.2),'SteelDark');box('Tug fender',(0,y+.93,-.55),(2.6,.7,2.8),'SafetyYellow')
 for side in [-1,1]:
  for az in [-1.34,1.32]:
   ring('Industrial tyre',(side*1.16,y+.5,az),.37,.13,'Rubber',normal=(1,0,0),n=16,k=6)
   rod('Tug wheel hub',(side*1.1,y+.5,az),(side*1.33,y+.5,az),.25,'SteelGrey',n=12)
  box('Tug footboard',(side*1.05,y+.63,.72),(.45,.13,1),'SteelGrey')
  for k in range(4):box('Tug engine cooling slit',(side*1.31,y+1.0,-1.35+k*.24),(.035,.37,.12),'SteelDark')
  ellipsoid('Tug headlamp',(side*.8,y+.9,2.12),(.18,.12,.04),'WarmLight',n=8,k=4)
  rod('Tug grab handle',(side*.85,y+1.35,.65),(side*.85,y+1.7,.65),.04,'SteelGrey')
 box('Tug bonnet',(0,y+1.1,1.42),(2.4,.5,1.3),'SafetyYellow');box('Driver seat',(0,y+1.27,.2),(.65,.3,.65),'Black');box('Driver backrest',(0,y+1.56,-.12),(.65,.72,.15),'Black')
 rod('Steering column',(0,y+1,.75),(0,y+1.7,.9),.055,'SteelDark');ring('Steering wheel',(0,y+1.7,.9),.25,.027,'Rubber',normal=(0,1,-.4),n=12,k=4)
 for sign in [-1,1]:rod('Tow clevis',(sign*.16,y+.4,-2),(sign*.16,y+.4,-2.6),.07,'BrightMetal')
 ring('Tow attachment',(0,y+.4,-2.65),.17,.055,'BrightMetal',normal=(0,1,0),n=12,k=4)
 for zz in [-1.65,-1,-.35]:box('Tug hazard stripe',(0,y+1.3,zz),(2.45,.035,.14),'Black',yaw=-.15)
 text_mesh('T 04',(0,y+1.37,1.4),.35,'SteelDark',rotation=(0,0,0))
 if kind=='power':
  box('Power unit',(0,y+1.8,-.8),(1.9,1.1,2),'HullGrey')
  for k in range(7):box('Power unit louvre',(-.96,y+1.8,-1.65+k*.25),(.04,.75,.11),'SteelDark')
  ring('Hose reel',(1.15,y+1.7,-.8),.5,.14,'Black',normal=(1,0,0),n=20,k=5)
  rod('Power beacon',(0,y+2.34,-.8),(0,y+2.7,-.8),.14,'Orange',n=10)
 co,si=math.cos(yaw),math.sin(yaw)
 for key,(verts,_) in BATCH.items():
  for i in range(base.get(key,0),len(verts)):
   vx,vy,vz=verts[i];verts[i]=(x+vx*co+vz*si,vy,z-vx*si+vz*co)

def deck_crew(x,z,vest='SafetyYellow',yaw=0):
 # Small helmeted deck crew give a truthful human-scale reference.
 y=18.1
 for side in [-1,1]:
  rod('Crew boot',(x+side*.14,y+.08,z-.1),(x+side*.14,y+.08,z+.14),.095,'Black',n=8)
  rod('Crew trouser',(x+side*.14,y+.16,z),(x+side*.12,y+.9,z),.115,'AircraftGrey',n=8)
 ellipsoid('Crew vest',(x,y+1.12,z),(.29,.35,.17),vest,n=10,k=6)
 for side in [-1,1]:rod('Crew sleeve',(x+side*.24,y+1.3,z),(x+side*.38,y+.86,z+.09),.09,vest,n=8);ellipsoid('Crew hand',(x+side*.38,y+.85,z+.09),(.075,.1,.07),'HullPanelGrey',n=8,k=4)
 ellipsoid('Crew head',(x,y+1.59,z),(.14,.17,.14),'HullPanelGrey',n=10,k=6);ellipsoid('Crew cranial helmet',(x,y+1.69,z),(.17,.13,.17),'WhiteMarking',n=10,k=6)
 box('Crew reflective vest',(x,y+1.11,z+.17),(.35,.07,.018),'WhiteMarking');box('Crew goggles',(x,y+1.62,z+.13),(.25,.065,.04),'Glass')

def carrier_detail():
 # Layered bridge platforms, support brackets, window frames and external services.
 for y,x0,x1,z0,z1 in [(25,19,35,-24,27),(31,19.7,35,-18,25),(36,18.8,36,-10,23),(40,20.2,35,-7,19),(45,21,34,-3,15)]:
  prism('Overhanging island gallery',[(x0,z0),(x1,z0),(x1,z1),(x0,z1)],y-.18,y+.05,'SteelGrey');railing(x0,x1,z0,z1,y+.05)
  for z in range(int(z0)+2,int(z1),5):rod('Gallery bracket',(x0+1.6,y-1.8,z),(x0,y-.18,z),.1,'SteelDark',n=6)
 for y,z0,z1,x0,x1 in [(29,-20,24,20.43,34.17),(38,-6,20,19.53,35.17),(41.5,-4,16,21.13,34.17)]:
  for z in range(int(z0),int(z1),3):
   for x in [x0,x1]:
    line('Window frame',[(x,y-.68,z-.14),(x,y+.68,z-.14),(x,y+.68,z+2.14),(x,y-.68,z+2.14),(x,y-.68,z-.14)],.055,'SteelGrey')
    rod('Bridge wiper',(x-.035,y-.52,z+.25),(x-.035,y+.3,z+1.1),.018,'Black',n=4)
 for z in [-21,-15,-8,3,13,21]:
  for j in range(7):box('Vent horizontal blade',(19.91,22.6+j*.16,z),(.16,.065,1.35),'SteelDark')
 for x in [23.5,32.8]:
  for z in [-19,-9,8,20]:
   rod('Vertical utility pipe',(x,19,z),(x,25,z),.075,'SteelDark');rod('Pipe elbow',(x,24.8,z),(x+.5,24.8,z),.075,'SteelDark')
   box('Junction box',(x,20.8,z),(.55,.7,.28),'HullPanelGrey')
 for x,z in [(19.4,-19),(34.8,11)]:
  for dx in [0,.6]:rod('Access ladder stringer',(x+dx,19,z),(x+dx,31,z),.047,'SteelGrey')
  for y in range(38,61):rod('Access ladder rung',(x, y*.5,z),(x+.6,y*.5,z),.043,'SteelGrey')
 # Mast bracing, sensor horns, a genuinely concave surveillance dish and cabling.
 for y in [46,49,52,55]:
  rod('Mast cross brace',(24,y,5),(31,y+3,6),.09,'SteelDark');rod('Mast reverse brace',(31,y,5),(24,y+3,6),.09,'SteelDark')
 for x,z in [(22,2),(33,8)]:
  box('Sensor housing',(x,46.7,z),(1.1,.9,1.5),'SteelDark');rod('Sensor horn',(x,46.7,z+.7),(x,46.7,z+1.65),.2,'SteelGrey',n=10)
 cx,cy,cz=30,50,-15;v=[];n=28;k=6
 for j in range(k+1):
  r=2.1*j/k
  for i in range(n):
   a=math.tau*i/n;v.append((cx+r*math.cos(a),cy+r*math.sin(a),cz+.19*r*r))
 mesh('Parabolic radar reflector',v,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(k)for i in range(n)],'SteelGrey')
 ring('Radar dish rim',(cx,cy,cz+.19*2.1**2),2.1,.065,'BrightMetal',normal=(0,0,1),n=28,k=5)
 for a in [0,math.tau/3,math.tau*2/3]:rod('Dish feed strut',(cx+2*math.cos(a),cy+2*math.sin(a),cz+.76),(cx,cy,cz+2.4),.045,'SteelDark')
 rod('Dish feed',(cx,cy,cz+2.1),(cx,cy,cz+2.6),.16,'Black',n=12);rod('Dish pedestal',(cx,46,cz),(cx,cy-1.4,cz),.27,'SteelDark',n=12)
 for x in [24,31]:line('Mast conduit',[(x,43,4.5),(x,48,4.5),(27.5,55,5)],.035,'Black')
 # Deck lanes read at a distance; smaller procedural lettering survives close inspection.
 heading=-math.radians(7);ss,cc=math.sin(heading),math.cos(heading)
 def lane(x,z,y=18.11):return(-9+x*cc+z*ss,y,-142-x*ss+z*cc)
 for side in [-1,1]:
  for z in range(12,177,6):paint_line('Recovery hazard dashes',lane(side*14,z),lane(side*14,z+2.8),.28,'SafetyRed'if(z//6)%2 else'WhiteMarking')
 for index,z in enumerate([30,42,54,66],1):
  for side in [-1,1]:
   x,y,zz=lane(side*13.1,z)
   box('Wire sheave housing',(x,y+.2,zz),(1.6,.38,2.1),'SteelDark',yaw=heading)
   ring('Exposed wire sheave',(x,y+.41,zz),.45,.09,'BrightMetal',normal=(0,1,0),n=18,k=5)
   box('Arrestor access plate',(x+side*1.65,18.12,zz),(1.2,.12,1.8),'SteelGrey',yaw=heading)
   for dx in [-.43,.43]:
    for dz in [-.65,.65]:rod('Access plate bolt',(x+side*1.65+dx,18.2,zz+dz),(x+side*1.65+dx,18.24,zz+dz),.045,'SteelDark',n=6)
   text_mesh(str(index),(x+side*2.8,18.13,zz),1.25,'SafetyYellow',rotation=(0,0,-heading))
 for x in [8,21]:
  for z in range(26,128,4):
   box('Catapult rail expansion plate',(x,18.08,z),(1.3,.055,.33),'SteelGrey')
   for dx in [-.52,.52]:rod('Catapult clamp bolt',(x+dx,18.14,z),(x+dx,18.18,z),.065,'SteelDark',n=6)
  box('Launch shuttle lower shoe',(x,18.2,24),(1.25,.18,2.3),'SteelDark');box('Shuttle tow lug',(x,18.45,24.5),(.55,.42,.65),'BrightMetal')
  for dx in [-3.5,3.5]:
   rod('Deflector hydraulic cylinder',(x+dx,18.25,10),(x+dx,19.4,11),.22,'SteelDark',n=12);rod('Deflector chrome piston',(x+dx,19.35,10.95),(x+dx,20.7,12),.115,'BrightMetal',n=12)
  for k in range(9):box('Blast panel rib',(x-4+k,19.05,12.8),(.055,1.7,2.4),'SteelGrey')
  text_mesh('JET BLAST',(x,18.13,7),1.0,'SafetyYellow',rotation=(0,0,0));text_mesh('CAT '+('1'if x==8 else'2'),(x,18.13,133),1.35,'WhiteMarking',rotation=(0,0,0))
 for i,(x,z,w,l) in enumerate([(29,-80,13,25),(29,65,13,25),(-34,-95,14,23)],1):
  text_mesh('ELEVATOR '+str(i),(x,18.16,z-3),.9,'WhiteMarking',rotation=(0,0,0));text_mesh('KEEP CLEAR',(x,18.16,z+1),.7,'SafetyYellow',rotation=(0,0,0))
  for side in [-1,1]:
   for az in range(-int(l/2),int(l/2),2):box('Elevator hazard block',(x+side*(w/2-.35),18.17,z+az),(.55,.04,1),'SafetyYellow')
 # Small non-slip hatches, tie-down service points and wheel chocks near parking areas.
 for x,z in [(-29,-30),(-31,9),(-31,50),(27,38),(28,99),(21,-139),(-24,118)]:
  box('Flush service hatch',(x,18.08,z),(2.1,.08,2.6),'HullPanelGrey')
  for xx in [x-.9,x+.9]:box('Hatch rim',(xx,18.13,z),(.055,.04,2.45),'SteelDark')
  rod('Flush hatch handle',(x-.3,18.18,z),(x+.3,18.18,z),.045,'BrightMetal');text_mesh('FUEL',(x,18.15,z+.8),.28,'WhiteMarking',rotation=(0,0,0))
 for x,z,yaw,kind in [(-31,40,.2,'tractor'),(28,-108,-.25,'tractor'),(29,96,.15,'power'),(-31,-47,0,'power')]:deck_vehicle(x,z,yaw,kind)
 for x,z in [(-29,45),(-28,38),(26,-110),(26,98),(18,8),(-24,97)]:deck_crew(x,z,'SafetyYellow'if z%2 else'SafetyRed')
 # Rope barriers, rolled hoses and fire lockers occupy only the service margins.
 for x,z in [(-35,16),(34,40),(-30,-126)]:
  box('Fire equipment locker',(x,19.08,z),(1.05,1.9,1.9),'SafetyRed');box('Locker plaque',(x-.54,19.3,z),(.03,.5,.8),'WhiteMarking')
  ring('Fire hose reel',(x-.64,19.22,z),.48,.15,'Black',normal=(1,0,0),n=20,k=6)
  line('Hose end',[(x-.64,19.2,z),(x-.64,18.2,z+.6),(x-.4,18.1,z+1.6)],.055,'Black')
 for x,z in [(-33,-50),(32,103),(-33,48)]:
  for off in [-3,0,3]:rod('Safety barrier post',(x,18.1,z+off),(x,19.25,z+off),.08,'SafetyYellow')
  for h in [18.5,19.1]:rod('Safety barrier rail',(x,h,z-3),(x,h,z+3),.06,'SafetyYellow')
 # Full mesh of safety net cables instead of only long outer frames.
 outline=[(-27,-160),(27,-160),(36,-135),(36,68),(28,145),(18,160),(-18,160),(-34,110),(-42,35),(-42,-70),(-35,-145)]
 for (x,z),(xx,zz) in zip(outline,outline[1:]+outline[:1]):
  distance=math.hypot(xx-x,zz-z);nx=(zz-z)/distance;nz=-(xx-x)/distance;n=max(1,int(distance/.8))
  for j in range(n):
   t=(j+.5)/n;px=x+(xx-x)*t;pz=z+(zz-z)*t
   rod('Safety net transverse',(px,17.32,pz),(px+nx*2.1,17.5,pz+nz*2.1),.018,'SteelDark',n=4)
 # Visible hull maintenance seams, deep portholes, anchor hawse and embarkation ladders.
 for side in [-1,1]:
  for z in range(-118,104,12):
   rod('Hull weld seam',(side*20.02,1.5,z),(side*20.02,7,z),.025,'HullPanelGrey',n=4)
   ring('Gallery life ring',(side*24,15.2,z),.48,.11,'Orange',normal=(1,0,0),n=16,k=5)
  for z in [78,104,125]:
   ring('Hull porthole bezel',(side*(19 if z<100 else 15),9,z),.45,.065,'BrightMetal',normal=(1,0,0),n=16,k=5)
  line('Anchor shank',[(side*12,7,123),(side*12,4,123),(side*10.5,3.3,123)],.3,'SteelDark',n=10)
  rod('Anchor fluke',(side*10.5,3.3,123),(side*13.5,3.3,123),.32,'SteelDark',n=10)
  for k in range(7):ring('Anchor chain link',(side*12,7+k*.45,123),.23,.07,'SteelDark',normal=(1,0,0)if k%2 else(0,0,1),n=10,k=4)
 text_mesh('TIDEWATER 07',(19.91,23,-1),1.2,'WhiteMarking',rotation=(math.pi/2,0,-math.pi/2))

def intake_duct(sign):
 front=[(sign*.65,-.75,2.94),(sign*1.82,-.7,2.52),(sign*1.82,.13,2.52),(sign*.78,.25,2.94)]
 inner=[(sign*.78,-.65,2.85),(sign*1.69,-.6,2.47),(sign*1.69,.01,2.47),(sign*.85,.13,2.85)]
 back=[(sign*.92,-.53,-1.65),(sign*1.55,-.53,-1.65),(sign*1.55,.0,-1.65),(sign*.92,.0,-1.65)]
 mesh('Intake rolled lip',front+inner,[(i,(i+1)%4,(i+1)%4+4,i+4)for i in range(4)],'AircraftLight')
 mesh('Four metre recessed intake duct',inner+back,[(i,(i+1)%4,(i+1)%4+4,i+4)for i in range(4)],'SteelDark')
 mesh('Recessed compressor shadow',back,[(0,1,2,3)],'Black')
 outerback=[(sign*.74,-.8,-2.6),(sign*1.7,-.72,-2.6),(sign*1.7,.12,-2.6),(sign*.82,.18,-2.6)]
 mesh('Intake external fairing',front+outerback,[(i,(i+1)%4,(i+1)%4+4,i+4)for i in range(4)],'AircraftGrey')
 for i in range(9):
  x=sign*(.98+i*.06);rod('Compressor stator',(x,-.49,-1.61),(x+sign*.045,-.04,-1.61),.018,'SteelGrey',n=4)

def fighter_detail():
 # Skin panel outlines follow the actual loft rather than floating over it.
 stations=[(-8.6,.45,.5,0),(-7.5,1.08,.75,.02),(-5.8,1.33,.87,.05),(-3.5,1.52,.93,.1),(-1,1.43,.86,.09),(1,1.08,.75,.12),(3,.87,.7,.15),(5,.69,.6,.16),(6.5,.52,.44,.17),(8,.28,.26,.12),(9.2,.015,.025,.04)]
 def skin(z,a,offset=.014):
  for (z0,w0,h0,y0),(z1,w1,h1,y1) in zip(stations,stations[1:]):
   if z0<=z<=z1:
    t=(z-z0)/(z1-z0);w=w0+(w1-w0)*t;h=h0+(h1-h0)*t;y=y0+(y1-y0)*t;return((w+offset)*math.cos(a),y+(h+offset)*math.sin(a),z)
  return (0,0,z)
 for z in [-7.35,-5.5,-3.4,-1.1,.9,5.35,6.55,7.6]:
  line('Fuselage circumferential seam',[skin(z,a)for a in [math.tau*i/48 for i in range(49)]],.009,'SteelDark',n=4)
 for a in [.18,.72,2.42,2.96,3.85,5.58]:
  line('Longitudinal skin seam',[skin(z,a)for z in [-7.3,-6,-5,-3.5,-2,-1,0,.9]],.008,'SteelDark',n=4)
 for side in [-1,1]:
  # Flush access covers and distinctly inset screw heads on shoulders and wings.
  for z in [-5.15,-2.7,-.45]:
   a=.66 if side>0 else math.pi-.66;pts=[skin(z+dz,a+da,.022)for da,dz in [(-.17,-.36),(.17,-.36),(.17,.36),(-.17,.36),(-.17,-.36)]]
   line('Removable inspection cover',pts,.012,'SteelDark',n=4)
   for pt in pts[:4]:ellipsoid('Flush cover fastener',pt,(.022,.022,.022),'BrightMetal',n=6,k=4)
  for x,lead,trail in [(2.6,.85,-3.1),(3.8,-.12,-3.48),(5.0,-1.12,-3.8)]:
   line('Wing skin joint',[(side*x,.15,lead),(side*x,.11,(lead+trail)/2),(side*x,.045,trail)],.012,'SteelDark',n=4)
  line('Wing leading edge inset',[(side*1.6,.06,1.98),(side*2.8,.085,.76),(side*4.8,.06,-1.08),(side*6.75,.035,-2.65)],.027,'SteelGrey',n=6)
  line('Wing walk boundary',[(side*1.85,.14,.6),(side*2.65,.16,.0),(side*2.65,.08,-2.6),(side*1.8,.055,-2.9)],.023,'SafetyYellow',n=5)
  text_mesh('NO STEP',(side*3.1,.20,-1.1),.20,'SteelDark',rotation=(0,0,0));text_mesh('KESTREL',(side*4.65,.18,-2.1),.33,'SteelDark',rotation=(0,0,0))
  for x,z in [(2.25,-2.95),(3.05,-3.15),(4.45,-3.5),(5.6,-3.78)]:
   group=('Flap'if x<3.2 else'Aileron')+('R'if side>0 else'L')
   rod('Control surface hinge pin',(side*(x-.1),-.015,z),(side*(x+.1),-.015,z),.037,'BrightMetal',group,n=10)
   box('Hinge fairing',(side*x,.035,z),(.18,.08,.28),'AircraftLight',group)
  # Canted tail livery panels, cut into the fin plane with separate stencil geometry.
  v=[(side*1.59,2.95,-6.3),(side*1.90,3.47,-7.54),(side*1.85,2.88,-7.82),(side*1.46,2.46,-6.4)]
  mesh('Tail recognition band',v,[(0,1,2,3)],'SafetyRed')
  line('Tail panel seam',[(side*1.2,.97,-5.36),(side*1.64,3.0,-6.68),(side*1.9,3.42,-7.52)],.015,'SteelDark')
  text_mesh('TW',(side*1.66,2.12,-7.1),.5,'WhiteMarking',rotation=(math.pi/2,0,side*math.pi/2))
  # Real internal nozzle walls, annular rings, turbine blades, petal actuators.
  x=side*.7;n=24;v=[]
  for z,r in [(-8.62,.375),(-8.1,.41),(-7.27,.38)]:
   for i in range(n):a=math.tau*i/n;v.append((x+r*math.cos(a),r*math.sin(a),z))
  mesh('Exhaust internal duct',v,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for j in range(2)for i in range(n)],'SteelDark')
  for z,r in [(-8.3,.394),(-7.75,.395),(-7.35,.382)]:ring('Inner nozzle annulus',(x,0,z),r,.014,'BrightMetal',normal=(0,0,1),n=24,k=4)
  ellipsoid('Turbine spinner',(x,0,-7.55),(.11,.11,.23),'SteelGrey',n=16,k=8)
  for i in range(16):
   a=math.tau*i/16;b=a+.16
   mesh('Turbine blade',[(x+.12*math.cos(a),.12*math.sin(a),-7.53),(x+.36*math.cos(a),.36*math.sin(a),-7.37),(x+.36*math.cos(b),.36*math.sin(b),-7.32),(x+.12*math.cos(b),.12*math.sin(b),-7.47)],[(0,1,2,3)],'SteelGrey')
   rod('Petal actuator',(x+.49*math.cos(a),.49*math.sin(a),-7.8),(x+.405*math.cos(a),.405*math.sin(a),-8.43),.018,'BrightMetal',n=5)
  # Shoulder formation strips and maintenance warning triangles are surface geometry.
  for z in [-2.2,3.7]:
   pt=skin(z,.21 if side>0 else math.pi-.21,.022);box('Formation light',pt,(.028,.065,.47),'WarmLight')
  mesh('Intake danger arrow',[(side*1.83,-.15,2),(side*1.83,-.05,1.55),(side*1.83,-.25,1.55)],[(0,1,2)],'SafetyRed')
 # Layered canopy bows, windshield divider, a small head-up display and instrument bezels.
 for z,w,y,h in [(1.83,.58,1.05,.52),(4.45,.4,.95,.46)]:
  line('Canopy arch',[(w*math.cos(math.pi*i/20),y+h*math.sin(math.pi*i/20),z)for i in range(21)],.035,'AircraftLight',n=7)
 line('Windscreen centre frame',[(0,1.78,3.4),(0,1.53,4.1),(0,1.17,4.75)],.023,'SteelDark',n=6)
 box('Instrument panel backing',(0,1.12,3.44),(.91,.39,.1),'SteelDark')
 for x in [-.28,0,.28]:
  box('Display bezel',(x,1.14,3.374),(.23,.23,.035),'Black');box('Cockpit multifunction display',(x,1.145,3.35),(.18,.17,.012),'Glass')
  line('Display artificial horizon',[(x-.077,1.145,3.337),(x+.077,1.145,3.337)],.003,'GreenLight',n=4)
  for xx in [-.085,.085]:
   for yy in [-.09,-.03,.03,.09]:box('Display softkey',(x+xx,1.145+yy,3.33),(.009,.011,.01),'WhiteMarking')
 for side in [-1,1]:
  box('Cockpit side console',(side*.38,.96,2.7),(.18,.14,1.0),'SteelDark')
  for k in range(6):rod('Console switch',(side*.38,1.04,2.25+k*.14),(side*.38,1.09,2.25+k*.14),.012,'BrightMetal',n=5)
  for k in range(4):box('Armrest pad',(side*.28,1.11,2.2+k*.1),(.095,.10,.065),'Black')
  rod('Seat guide rail',(side*.29,.79,1.94),(side*.29,1.70,1.94),.027,'BrightMetal',n=6)
  ring('Ejection seat handle',(side*.15,1.64,2.3),.065,.016,'SafetyYellow',normal=(0,0,1),n=12,k=4)
 mesh('HUD combiner glass',[(-.2,1.28,3.86),(.2,1.28,3.86),(.17,1.55,3.98),(-.17,1.55,3.98)],[(0,1,2,3)],'Canopy')
 for side in [-1,1]:rod('HUD bracket',(side*.23,1.13,3.8),(side*.2,1.36,3.9),.023,'SteelDark',n=6)
 # Gear brake lines, tie-down eyes, wheel bolts and undercarriage placards.
 for name,x,z,piv in [('GearNose',0,5.3,(0,-.55,4.9)),('GearLeft',-2.65,-1.7,(-1.7,-.5,-1.7)),('GearRight',2.65,-1.7,(1.7,-.5,-1.7))]:
  radius=.36 if x==0 else .45;cy=-2+radius
  line('Flexible gear brake line',[(piv[0]+.11,piv[1],piv[2]),(x+.13,-1.13,z+.06),(x+.1,cy,z+.14)],.018,'Black',name,n=5)
  for side in [-1,1]:
   for k in range(8):
    a=math.tau*k/8;rod('Wheel lug',(x+side*.16,cy+radius*.27*math.sin(a),z+radius*.27*math.cos(a)),(x+side*.18,cy+radius*.27*math.sin(a),z+radius*.27*math.cos(a)),.023,'BrightMetal',name,n=6)
  ring('Gear tie-down eye',(x,-1.25,z+.2),.095,.025,'SafetyYellow',normal=(1,0,0),group=name,n=10,k=4)
  box('Oleo data plate',(x+.12,-1.03,z),(.012,.18,.1),'Black',name)
 for z in [-6.2,-6.6,-7,-7.4]:rod('Hook safety band',(0,-.41-(z+5.8)*-.047,z),(0,-.41-(z+5.8)*-.047,z-.13),.07,'SafetyYellow','ArrestorHook',n=10)
 text_mesh('RESCUE',(0,1.02,1.0),.23,'SafetyYellow',rotation=(0,0,0));text_mesh('KESTREL 07',(0,.91,-.45),.4,'WhiteMarking',rotation=(0,0,0))


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

def stage(kind):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1440;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Aviation studio world');scene.world.color=(.18,.22,.27);scene.view_settings.view_transform='AgX'
 bpy.ops.object.light_add(type='AREA',location=cv((-130,230,40)if kind=='carrier'else(-15,24,8)));light=bpy.context.object;light.data.energy=3500000 if kind=='carrier'else 16000;light.data.shape='DISK';light.data.size=200 if kind=='carrier'else 20;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.light_add(type='SUN',location=(0,0,100));bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.4,-.3,-.6)
 if kind=='carrier':
  # Render at rest waterline. Model geometry remains below water in the .blend.
  bpy.ops.mesh.primitive_plane_add(size=2000,location=(0,0,-.05));water=bpy.context.object;water.name='Preview sea';m=bpy.data.materials.new('PreviewOcean');m.diffuse_color=(.025,.085,.105,1);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.025,.085,.105,1);bs.inputs['Metallic'].default_value=.45;bs.inputs['Roughness'].default_value=.26;water.data.materials.append(m);camera_at((-240,215,290),(0,8,0),440)
 else:
  bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-2.04));floor=bpy.context.object;floor.name='Preview studio';floor.data.materials.append(MATS['DeckNonslip']);camera_at((-19,13,23),(0,0,0),28)
 scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ASSETS/(kind+'-preview.png'))

def main(kind):
 global BATCH,PIVOTS,MATS,OBJECTS
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;BATCH={};PIVOTS={};MATS={};OBJECTS=[];paint();carrier()if kind=='carrier'else fighter();carrier_detail()if kind=='carrier'else fighter_detail();build_objects()
 bpy.ops.object.select_all(action='DESELECT')
 for o in OBJECTS:o.select_set(True)
 bpy.context.view_layer.objects.active=next(o for o in OBJECTS if o.type=='MESH')
 bpy.ops.export_scene.gltf(filepath=str(PUB/(kind+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_cameras=False,export_lights=False,export_animations=False,export_materials='EXPORT',export_extras=True)
 tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in OBJECTS if o.type=='MESH');verts=sum(len(o.data.vertices)for o in OBJECTS if o.type=='MESH');stats={'asset':kind,'metres':True,'axes':'+Y up, +Z forward, +X right','triangles':tris,'vertices':verts,'meshes':sum(o.type=='MESH'for o in OBJECTS),'pivots':PIVOTS,'glbBytes':(PUB/(kind+'.glb')).stat().st_size,'generator':'tools/aviation/build.py','blender':bpy.app.version_string};(PUB/(kind+'.json')).write_text(json.dumps(stats,indent=2));print('AVIATION_MODEL',json.dumps(stats),flush=True)
 stage(kind);bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/(kind+'.blend')))
 if not args.no_render:bpy.ops.render.render(write_still=True)
for kind in (['carrier','fighter']if args.asset=='all'else[args.asset]):
 main(kind)
 if kind=='carrier':subprocess.run(['node',str(ROOT/'tools/distribution-assets.mjs'),'pack','carrier'],check=True)
