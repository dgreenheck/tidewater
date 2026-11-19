"""Editable blacktip reef shark, Carcharhinus melanopterus, 1.50 m total length.

Blender 5: blender --background --factory-startup --python tools/wildlife/shark_build.py
Generates the authored .blend, a GLB for interchange, three shared runtime mesh LODs,
and full-frame studio review renders. No external artwork or licensed meshes.
Coordinates used by the authoring functions: +Z nose, +Y dorsal, +X left.
"""
import bpy, math, os, sys, json, struct
from mathutils import Vector, Matrix

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'public/models/shark')
ART = os.path.join(REPO, 'assets/shark')
os.makedirs(OUT, exist_ok=True)
os.makedirs(ART, exist_ok=True)
NO_RENDER = '--no-render' in sys.argv

# s = distance from the rounded snout / 1.5m. Loft reaches the caudal peduncle;
# separate swept airfoil surfaces form the heterocercal tail beyond it.
PROFILE = [
    (0.000, .002, -.012, .003), (0.012, .018, -.027, .032),
    (0.035, .035, -.038, .071), (0.065, .059, -.050, .093),
    (0.100, .078, -.065, .106), (0.160, .108, -.083, .123),
    (0.235, .128, -.098, .131), (0.310, .133, -.101, .123),
    (0.390, .124, -.096, .109), (0.480, .104, -.082, .089),
    (0.565, .077, -.061, .065), (0.640, .051, -.041, .044),
    (0.705, .032, -.027, .026), (0.760, .023, -.020, .017),
    (0.795, .018, -.017, .012),
]
TL, NOSE = 1.5, .54
DORSAL = (.16, .145, .117, 1)
FLANK = (.32, .31, .265, 1)
BELLY = (.74, .755, .68, 1)
BLACK = (.020, .026, .025, 1)
PALE = (.70, .71, .63, 1)

def lerp(a,b,t): return a+(b-a)*t
def mix(a,b,t): return tuple(lerp(a[i],b[i],t) for i in range(4))
def clamp(x,a=0,b=1): return max(a,min(b,x))
def smooth(a,b,x):
    t=clamp((x-a)/(b-a)); return t*t*(3-2*t)
def prof(s):
    k=next((k for k in range(len(PROFILE)-1) if s <= PROFILE[k+1][0]),len(PROFILE)-2)
    a,b=PROFILE[k:k+2]; t=clamp((s-a[0])/(b[0]-a[0]))
    # Catmull-Hermite slope preserves the designed rounded silhouette.
    result=[]
    for j in range(1,4):
        p=PROFILE[max(0,k-1)]; n=PROFILE[min(len(PROFILE)-1,k+2)]
        da=(b[j]-p[j])/(b[0]-p[0]); db=(n[j]-a[j])/(n[0]-a[0])
        h=b[0]-a[0]
        result.append((2*t**3-3*t*t+1)*a[j]+(t**3-2*t*t+t)*da*h+(-2*t**3+3*t*t)*b[j]+(t**3-t*t)*db*h)
    return result
def flank_x(s,y):
    top,bot,w=prof(s); r=clamp(abs(y)/(top if y>0 else -bot))
    return w*math.sqrt(max(0,1-r*r))
def skin(y_normal,s):
    a=mix(BELLY,FLANK,smooth(-.40,.08,y_normal))
    a=mix(a,DORSAL,smooth(.12,.83,y_normal))
    # Light lateral band extending forward from the anal region.
    band=(1-smooth(.035,.12,abs(y_normal+.17)))*smooth(.08,.21,s)*(1-smooth(.65,.76,s))
    a=mix(a,PALE,.42*band)
    grain=1+.018*math.sin(s*107+math.sin(y_normal*15))*math.sin(y_normal*51)+.008*math.sin(s*590)*math.sin(y_normal*127)
    return tuple(c*grain for c in a[:3])+(1,)

class Mesh:
    def __init__(self,name,jaw=0,recalc=True): self.name=name; self.vertices=[]; self.faces=[]; self.colors=[]; self.rough=[]; self.jaw=jaw; self.recalc=recalc
    def v(self,p,color,rough=.48):
        self.vertices.append((p[0],-p[2],p[1])); self.colors.append(color); self.rough.append(rough)
        return len(self.vertices)-1
    def face(self,*indices): self.faces.append(indices)
    def object(self,collection):
        mesh=bpy.data.meshes.new(self.name); mesh.from_pydata(self.vertices,[],self.faces); mesh.update()
        o=bpy.data.objects.new(self.name,mesh); collection.objects.link(o)
        col=mesh.color_attributes.new(name='SharkColor',type='FLOAT_COLOR',domain='POINT')
        for i,c in enumerate(self.colors): col.data[i].color=c
        rough=mesh.attributes.new(name='roughness',type='FLOAT',domain='POINT')
        for i,r in enumerate(self.rough): rough.data[i].value=r
        for p in mesh.polygons: p.use_smooth=True
        mesh.materials.append(MATERIAL)
        # Recalculate outward normals on closed authored pieces.
        if self.recalc:
            bpy.context.view_layer.objects.active=o; o.select_set(True)
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT'); o.select_set(False)
        o['jaw_weight']=self.jaw
        return o

JAW_PIVOT=(0,-.063,.302)
LOWER_TOOTH_TIPS=[((i-6)*.008,-.040-abs((i-6)*.008)*.06,.465-abs((i-6)*.008)*.65) for i in range(13)]
LOWER_TOOTH_TIPS += [(sign*(.055+i*.006),-.044-i*.0015,.425-i*.009) for sign in [-1,1] for i in range(6)]

def mouth_cut(s):
    top,bot,w=prof(s)
    if s<.05 or s>.18: return -1
    plane=-.045-(s-.05)*.04
    cut=max(-1,min(-.45,plane/(-bot)))
    return lerp(cut,-1,smooth(.145,.18,s))

def body(collection,detail):
    mesh=Mesh('Streamlined upper body with open mouth cavity')
    rings,sides=detail*2,detail
    for i in range(rings+1):
        s=.795*i/rings; top,bot,w=prof(s); alpha=math.acos(mouth_cut(s))
        for j in range(sides+1):
            a=lerp(-alpha,alpha,j/sides); c=math.cos(a)
            y=(top if c>=0 else -bot)*c; x=w*math.sin(a)
            mesh.v((x,y,NOSE-TL*s),skin(c,s))
    stride=sides+1
    for i in range(rings):
        for j in range(sides):
            a=i*stride+j; mesh.face(a,a+1,a+1+stride,a+stride)
    mesh.face(*reversed(tuple(range(stride)))); mesh.face(*tuple(rings*stride+j for j in range(stride)))
    mesh.object(collection)
    jaw=Mesh('Articulated lower jaw skin',1); upper=Mesh('Protracting upper palate',-1,False); lower=Mesh('Lower mouth floor and gums',1,False)
    nr=max(20,detail); ns=max(16,detail//2); cross=12
    for i in range(nr+1):
        s=lerp(.052,.179,i/nr); top,bot,w=prof(s); cut=max(-.99999,mouth_cut(s)); alpha=math.acos(cut)
        edge=w*math.sin(alpha); plane=(-bot)*cut
        for j in range(ns+1):
            a=lerp(alpha,2*math.pi-alpha,j/ns); c=math.cos(a)
            jaw.v((w*math.sin(a),(-bot)*c,NOSE-TL*s),skin(c,s),.51)
        for j in range(cross+1):
            u=-1+2*j/cross; x=edge*u
            upper.v((x,plane+.006*(1-u*u),NOSE-TL*s),(.125,.105,.10,1),.63)
            lower.v((x,plane-.001-.003*(1-u*u),NOSE-TL*s),(.21,.18,.16,1),.58)
    for i in range(nr):
        for j in range(ns):
            a=i*(ns+1)+j; jaw.face(a,a+1,a+ns+2,a+ns+1)
        for j in range(cross):
            a=i*(cross+1)+j
            upper.face(a+cross+1,a+cross+2,a+1,a)
            lower.face(a,a+1,a+cross+2,a+cross+1)
    jaw.object(collection); upper.object(collection); lower.object(collection)

def teeth(collection,detail):
    rows=2 if detail>24 else 1
    for lower in [False,True]:
        mesh=Mesh(('Lower' if lower else 'Upper')+' detailed tooth rows',1 if lower else -1)
        for row in range(rows):
            for tip in LOWER_TOOTH_TIPS:
                x,y,z=tip; z-=row*.011
                height=(.007 if lower else .009)*(1-.22*row); width=.0027*(1-.20*row)
                root=y-height if lower else y+.002
                direction=1 if lower else -1
                outline=[(-1,0),(-.72,.25),(-.80,.36),(-.42,.48),(-.49,.60),(0,1),(.49,.60),(.42,.48),(.80,.36),(.72,.25),(1,0)]
                start=len(mesh.vertices); n=len(outline)
                for face in [-1,1]:
                    for u,v in outline:
                        mesh.v((x+u*width,root+direction*v*height,z+face*.00065-v*.001),(.76,.745,.65,1),.24)
                mesh.face(*reversed(tuple(start+j for j in range(n))))
                mesh.face(*tuple(start+n+j for j in range(n)))
                for j in range(n): mesh.face(start+j,start+(j+1)%n,start+n+(j+1)%n,start+n+j)
        mesh.object(collection)


def fin(collection,name,stations,normal,detail,underside=False,black_tip=True):
    # Each station: centre x/y/z, chord along Z, thickness. Airfoil loft, not a flat triangle.
    mesh=Mesh(name); sections=max(8,detail//2); sides=max(12,detail//2)
    for i in range(sections+1):
        r=i/sections; f=r*(len(stations)-1); k=min(len(stations)-2,int(f)); t=f-k
        a=stations[k]; b=stations[k+1]; before=stations[max(0,k-1)]; after=stations[min(len(stations)-1,k+2)]
        st=[(2*t**3-3*t*t+1)*a[j]+(t**3-2*t*t+t)*(b[j]-before[j])*.5+(-2*t**3+3*t*t)*b[j]+(t**3-t*t)*(after[j]-a[j])*.5 for j in range(5)]
        st[3]=max(.001,st[3]); st[4]=max(.0003,st[4])
        for j in range(sides):
            a=j*2*math.pi/sides
            # Rounded leading edge, thinner trailing edge.
            chord=.5*st[3]*math.cos(a)
            thick=st[4]*math.sin(a)*(1+.35*math.cos(a))
            p=(st[0]+normal[0]*thick,st[1]+normal[1]*thick,st[2]+chord)
            color=mix(FLANK,DORSAL,.45) if not underside else mix(FLANK,DORSAL,.60)
            if underside and math.sin(a)<0: color=BELLY
            if black_tip:
                color=mix(color,PALE,smooth(.57,.65,r)*(1-smooth(.67,.71,r)))
                color=mix(color,BLACK,smooth(.66,.73,r))
            mesh.v(p,color,.48)
    for i in range(sections):
        for j in range(sides):
            a=i*sides+j; b=i*sides+(j+1)%sides; mesh.face(a,b,b+sides,a+sides)
    mesh.face(*reversed(tuple(range(sides)))); mesh.face(*tuple(sections*sides+j for j in range(sides)))
    return mesh.object(collection)

def tube(collection,name,points,radius,color,detail=6,jaw=0):
    mesh=Mesh(name,jaw)
    for i,p in enumerate(points):
        before=Vector(points[max(0,i-1)]); after=Vector(points[min(len(points)-1,i+1)])
        axis=(after-before).normalized(); guide=Vector((0,1,0))
        if abs(axis.dot(guide))>.9: guide=Vector((1,0,0))
        u=axis.cross(guide).normalized(); v=axis.cross(u).normalized()
        for j in range(detail):
            a=j*2*math.pi/detail; q=Vector(p)+radius*(math.cos(a)*u+math.sin(a)*v)
            mesh.v(q,color,.40)
    for i in range(len(points)-1):
        for j in range(detail):
            a=i*detail+j; b=i*detail+(j+1)%detail; mesh.face(a,b,b+detail,a+detail)
    return mesh.object(collection)

def eye(collection,sign,detail):
    # Convex iris and recessed pupil, each with its own contour and roughness.
    s=.086; y=.029; x=flank_x(s,y); z=NOSE-TL*s
    for title,ry,rz,col,offset,bulge in [
        ('Eye socket',.0143,.0150,(.10,.10,.075,1),-.0005,.002),
        ('Iris',.0116,.0122,(.27,.25,.145,1),.0010,.003),
        ('Pupil',.0076,.0060,BLACK,.0020,.0030)]:
        mesh=Mesh(title+(' left' if sign>0 else ' right')); nr=max(8,detail//5); ns=max(16,detail//2)
        for i in range(nr+1):
            a=math.pi*i/nr
            for j in range(ns):
                b=2*math.pi*j/ns
                shade=1+(.18*math.sin(j*3.17)*math.sin(a)**2 if title=='Iris' else 0)
                c=tuple(v*shade for v in col[:3])+(1,)
                mesh.v((sign*(x+offset+math.cos(a)*bulge),y+math.sin(a)*math.sin(b)*ry,z+math.sin(a)*math.cos(b)*rz),c,.12 if title=='Pupil' else .27 if title=='Iris' else .52)
        for i in range(nr):
            for j in range(ns):
                a=i*ns+j; b=i*ns+(j+1)%ns; mesh.face(a,b,b+ns,a+ns)
        mesh.object(collection)
    pts=[]
    for j in range(25):
        t=math.pi*j/24
        ey=y+.014*math.sin(t); ez=z+.015*math.cos(t)
        ss=(NOSE-ez)/TL
        pts.append((sign*(flank_x(ss,ey)+.0018),ey,ez))
    tube(collection,'Upper eyelid '+str(sign),pts,.0015,skin(.35,s),8)

def gill(collection,sign,g,detail):
    # Flesh overlaps each slit. The dark crease is inset below the raised lip,
    # so moving illumination reveals actual relief instead of painted stripes.
    mesh=Mesh('Raised gill flap %s %s'%(sign,g+1)); pts=[]
    n=18 if detail>24 else 12
    for j in range(n+1):
        t=j/n; y=lerp(.067,-.058,t); ss=.178+g*.016+.008*math.sin(t*math.pi)
        fade=math.sin(math.pi*t)**.6
        pts.append((sign*(flank_x(ss,y)+.0006),y,NOSE-TL*ss))
        for dz,h,dark in [(-.005,0,0),(-.003,.001,0),(-.001,.0038,.04),(.001,.0034,.12),(.0022,.0012,.48),(.003,0,.1)]:
            s0=ss-dz/TL; xx=flank_x(s0,y)
            top,bot,w=prof(s0); yn=y/(top if y>0 else -bot)
            c=mix(skin(yn,s0),BLACK,dark*fade)
            mesh.v((sign*(xx+.0004+h*fade),y,NOSE-TL*ss+dz),c,.51)
    for j in range(n):
        for k in range(5):
            a=j*6+k; mesh.face(a,a+1,a+7,a+6)
    mesh.object(collection)
    tube(collection,'Recessed gill slit %s %s'%(sign,g+1),pts,.0010,BLACK,6)

def nasal(collection,sign,detail):
    # Two small ventrolateral nares and their fleshy anterior flaps.
    s=.046; y=-.031; z=NOSE-TL*s; xx=flank_x(s,y)
    mesh=Mesh('Nasal recess '+str(sign)); segments=20 if detail>24 else 12
    center=mesh.v((sign*(xx+.001),y,z),BLACK,.42)
    pts=[]
    for j in range(segments):
        a=2*math.pi*j/segments; yy=y+.0034*math.sin(a); zz=z+.0065*math.cos(a); ss=(NOSE-zz)/TL
        p=(sign*(flank_x(ss,yy)+.0008),yy,zz)
        mesh.v(p,(.045,.047,.034,1),.48)
        if 0<a<math.pi: pts.append((p[0]+sign*.0010,p[1]+.0007,p[2]))
    for j in range(segments): mesh.face(center,1+j,1+(j+1)%segments)
    mesh.object(collection)
    tube(collection,'Nasal flap '+str(sign),pts,.0014,BELLY,6)


def create_lod(name,detail):
    collection=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(collection)
    body(collection,detail)
    fin(collection,'First dorsal, black apex',[(0,.115,.003,.265,.012),(0,.25,-.035,.14,.007),(0,.355,-.107,.012,.001)],(1,0),detail)
    fin(collection,'Second dorsal',[(0,.042,-.421,.113,.006),(0,.10,-.442,.055,.003),(0,.12,-.466,.006,.0005)],(1,0),detail//2)
    for side in [-1,1]:
        fin(collection,'Pectoral '+str(side),[(side*.103,-.058,.117,.275,.017),(side*.235,-.081,-.008,.19,.010),(side*.39,-.123,-.166,.008,.0006)],(0,1),detail,True)
        fin(collection,'Pelvic '+str(side),[(side*.064,-.045,-.301,.145,.009),(side*.135,-.08,-.379,.085,.006),(side*.173,-.099,-.434,.007,.0006)],(0,1),detail//2,True)
    fin(collection,'Anal fin',[(0,-.032,-.443,.115,.006),(0,-.102,-.486,.067,.003),(0,-.118,-.510,.007,.0005)],(1,0),detail//2,True)
    # Unequal vertical lobes, an elongated upper lobe with subterminal notch.
    fin(collection,'Caudal upper heterocercal lobe',[(0,.004,-.630,.13,.014),(0,.10,-.715,.16,.010),(0,.223,-.836,.125,.006),(0,.248,-.855,.060,.003),(0,.28,-.925,.055,.002),(0,.30,-.955,.010,.0005)],(1,0),detail)
    fin(collection,'Caudal lower lobe black tip',[(0,-.008,-.637,.13,.014),(0,-.102,-.698,.145,.007),(0,-.212,-.776,.012,.0005)],(1,0),detail)
    if detail>=20:
        for sign in [-1,1]:
            eye(collection,sign,detail)
            for g in range(5): gill(collection,sign,g,detail)
            nasal(collection,sign,detail)
    if detail>=20:
        teeth(collection,detail)
        for sign in [-1,1]:
            pts=[]
            for j in range(45):
                ss=lerp(.054,.145,j/44); top,bot,w=prof(ss); cut=mouth_cut(ss)
                pts.append((sign*w*math.sqrt(max(0,1-cut*cut)),(-bot)*cut,NOSE-TL*ss))
            tube(collection,'Upper mouth lip '+str(sign),pts,.0011,mix(BELLY,FLANK,.38),8)
            tube(collection,'Articulated lower lip '+str(sign),[(x,y-.001,z) for x,y,z in pts],.0012,mix(BELLY,FLANK,.32),8,1)
            if detail>24:
                for i in range(11):
                    ss=.035+.007*i; yy=.003+.012*math.sin(i*2.1); zz=NOSE-TL*ss; xx=flank_x(ss,yy)
                    tube(collection,'Sensory pore %s %s'%(sign,i),[(sign*(xx+.0002),yy-.0004,zz),(sign*(xx+.0003),yy+.0004,zz)],.0005,mix(FLANK,BLACK,.45),5)
    return collection

def runtime_mesh(collection,blob):
    vertices=[]; normals=[]; colors=[]; uv=[]; indices=[]
    for obj in collection.objects:
        mesh=obj.data; mesh.calc_loop_triangles()
        offset=len(vertices)//3
        col=mesh.color_attributes['SharkColor']; rough=mesh.attributes['roughness']
        for i,v in enumerate(mesh.vertices):
            vertices.extend((v.co.x,v.co.z,-v.co.y)); normals.extend((v.normal.x,v.normal.z,-v.normal.y))
            colors.extend(col.data[i].color); uv.extend((rough.data[i].value,obj.get("jaw_weight",0)))
        for tri in mesh.loop_triangles: indices.extend(offset+i for i in tri.vertices)
    result={'vertices':len(vertices)//3,'indices':len(indices)}
    for name,data,fmt in [('position',vertices,'f'),('normal',normals,'f'),('color',colors,'f'),('uv',uv,'f'),('index',indices,'I')]:
        result[name]=len(blob); blob.extend(struct.pack('<'+fmt*len(data),*data))
    return result

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name!='Collection' and not c.objects: bpy.data.collections.remove(c)
MATERIAL=bpy.data.materials.new('Blacktip reef shark | vertex-painted skin'); MATERIAL.use_nodes=True
nodes=MATERIAL.node_tree.nodes; links=MATERIAL.node_tree.links; bsdf=nodes.get('Principled BSDF')
color=nodes.new('ShaderNodeVertexColor'); color.layer_name='SharkColor'; links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
attribute=nodes.new('ShaderNodeAttribute'); attribute.attribute_name='roughness'; links.new(attribute.outputs['Fac'],bsdf.inputs['Roughness'])
bsdf.inputs['Specular IOR Level'].default_value=.34

blob=bytearray(); levels=[]; collections=[]
for label,detail in [('Near',64),('Middle',24),('Far',12)]:
    col=create_lod('Shark '+label,detail); collections.append(col)
    lv=runtime_mesh(col,blob); lv['name']=label; levels.append(lv)
    col.hide_render=label!='Near'; col.hide_viewport=label!='Near'
with open(os.path.join(OUT,'blacktip.bin'),'wb') as f: f.write(blob)
manifest={'species':'Carcharhinus melanopterus','commonName':'Blacktip reef shark','length':1.5,'noseZ':NOSE,'tailZ':-.96,'levels':levels,'source':'https://www.floridamuseum.ufl.edu/discover-fish/species-profiles/blacktip-reef-shark/','jaw':{'pivot':JAW_PIVOT,'maxAngle':.65,'lowerToothTips':LOWER_TOOTH_TIPS,'nearToothCount':100},'generator':'tools/wildlife/shark_build.py','license':'Original project asset, generated from authored anatomy lofts; no external mesh or textures'}
with open(os.path.join(OUT,'blacktip.json'),'w') as f: json.dump(manifest,f,indent=2)

# The editable project and GLB include the same rigid jaw controls as the GPU rig.
# Mesh vertices stay in their authored coordinates; an inverse parent translation
# preserves the closed pose while the lower control turns about its anatomical hinge.
scene=bpy.context.scene
controls=bpy.data.collections.new('Animated jaw controls'); scene.collection.children.link(controls)
pivot=Vector((JAW_PIVOT[0],-JAW_PIVOT[2],JAW_PIVOT[1]))
lower_control=bpy.data.objects.new('Lower jaw hinge | 0 to 37 degrees',None)
upper_control=bpy.data.objects.new('Upper palate protraction | 10 mm',None)
for control in [lower_control,upper_control]:
    controls.objects.link(control); control.empty_display_type='ARROWS'; control.empty_display_size=.06
lower_control.location=pivot
limit=lower_control.constraints.new('LIMIT_ROTATION'); limit.use_limit_x=True; limit.min_x=0; limit.max_x=.65; limit.owner_space='LOCAL'
for col in collections:
    for obj in col.objects:
        if obj.get('jaw_weight')==1:
            obj.parent=lower_control; obj.matrix_parent_inverse=Matrix.Translation(-pivot)
        elif obj.get('jaw_weight')==-1: obj.parent=upper_control
scene.render.fps=30; scene.frame_start=1; scene.frame_end=65
for frame,angle,label in [(1,0,'Closed'),(15,.65,'Open'),(30,.35,'Contact pose'),(38,.35,'Hold'),(50,.45,'Release'),(65,0,'Closed again')]:
    lower_control.rotation_euler=(angle,0,0); lower_control.keyframe_insert(data_path='rotation_euler',frame=frame)
    upper_control.location=(0,-.010*angle/.65,-.004*angle/.65); upper_control.keyframe_insert(data_path='location',frame=frame)
    scene.timeline_markers.new(label,frame=frame)
lower_control['Maximum opening radians']=.65
lower_control['Runtime control']='SharkBite joint servo; authored preview keyframes are illustrative, physical contact is solved live.'
scene.frame_set(1); bpy.context.view_layer.update()

# Interchange mesh remains editable by named anatomical part. The runtime uses the exact
# same vertex colors/geometry, packed into one draw per animal rather than many objects.
bpy.ops.object.select_all(action='DESELECT')
for obj in [*collections[0].objects,lower_control,upper_control]: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ART,'blacktip-reef.glb'),use_selection=True,export_format='GLB',export_extras=True,export_materials='EXPORT')

scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
scene.render.engine='CYCLES'; scene.cycles.samples=48
scene.render.resolution_x=1600; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
scene.world.color=(.15,.18,.20)
scene.view_settings.view_transform='AgX'
studio=bpy.data.collections.new('Studio lights and cameras'); scene.collection.children.link(studio)
def area(name,loc,power,size):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
    o=bpy.data.objects.new(name,data); studio.objects.link(o); o.location=loc
    o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large softbox',(1,-2,3),240,3)
area('White belly fill',(-1,-1,.3),90,2)
area('Rim light',(0,2,1.5),180,2)
camera_data=bpy.data.cameras.new('Review camera'); camera=bpy.data.objects.new('Review camera',camera_data); studio.objects.link(camera); scene.camera=camera
camera_data.type='ORTHO'; camera_data.ortho_scale=2.1
def pose(loc,target=(0,.18,.01)):
    camera.location=loc; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.065,.095,.115,1); scene.world.node_tree.nodes['Background'].inputs[1].default_value=.55
pose((2,-2.2,1.0))
scene['Species']='Carcharhinus melanopterus, blacktip reef shark'
scene['Total length metres']=1.5
scene['Model assumptions']='Authored visual anatomy, not a scanned specimen. Body musculature/CFD not simulated.'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,'blacktip-reef.blend'))
if not NO_RENDER:
    for label,loc in [('three-quarter',(2,-2.2,1.0)),('side',(3,.18,.45)),('dorsal',(0,.18,3)),('ventral',(1,-1.6,-2)),('jaw-open',(2,-1.8,-.55))]:
        camera_data.ortho_scale=2.8 if label=='dorsal' else 2.1
        scene.frame_set(15 if label=='jaw-open' else 1)
        pose(loc); scene.render.filepath=os.path.join(ART,'blacktip-'+label+'.png'); bpy.ops.render.render(write_still=True)
print(json.dumps({'bytes':len(blob),'levels':levels,'blend':os.path.join(ART,'blacktip-reef.blend')}))
