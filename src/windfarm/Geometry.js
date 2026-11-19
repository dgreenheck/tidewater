import { Group, Mesh, BufferGeometry, Float32BufferAttribute, CylinderGeometry, SphereGeometry, BoxGeometry, mergeGeometries, Vector3, Quaternion } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { REFERENCE as R, BLADE_STATIONS, DEG } from './Reference.js';

// Each section has a round leading edge, thin trailing edge, tapered chord and
// source-backed twist. This approximates airfoil appearance, not DU coefficients.
export function bladeGeometry() {
 const positions=[],uv=[],indices=[],around=32;
 for(let k=0;k<BLADE_STATIONS.length;k++) {
  const [radius,chord,twist]=BLADE_STATIONS[k],a=twist*DEG;
  const rootBlend=Math.max(0,Math.min(1,(radius-7)/7));
  const thickness=(0.48*(1-rootBlend)+(0.35-(radius/63)*0.19)*rootBlend);
  for(let j=0;j<around;j++) {
   const theta=j/around*Math.PI*2,x=(1-Math.cos(theta))/2;
   const t=5*thickness*(0.2969*Math.sqrt(x)-0.126*x-0.3516*x*x+0.2843*x**3-0.1036*x**4);
   const cx=(x-0.25)*chord,cz=Math.sign(Math.sin(theta))*t*chord;
   const camber=0.025*chord*Math.sin(Math.PI*x)*rootBlend;
   positions.push(cx*Math.cos(a)+(cz+camber)*Math.sin(a),radius-R.hubRadius,-cx*Math.sin(a)+(cz+camber)*Math.cos(a));
   uv.push(x,radius/R.radius);
   if(k<BLADE_STATIONS.length-1) {
    const n=(j+1)%around,v=k*around+j,w=k*around+n;
    indices.push(v,w,w+around,v,w+around,v+around);
   }
  }
 }
 for(let j=1;j<around-1;j++){indices.push(0,j+1,j);const end=(BLADE_STATIONS.length-1)*around;indices.push(end,end+j,end+j+1);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}

export function createFarmAssets() {
 return {blade:bladeGeometry(),materials:{
  ivory:new Material({name:'Wind turbine enamel',color:0xe6e6df,roughness:0.4,metalness:0.12}),
  dark:new Material({name:'Turbine service steel',color:0x3c4b50,roughness:0.47,metalness:0.65}),
  yellow:new Material({name:'Maintenance safety yellow',color:0xe4af2f,roughness:0.5,metalness:0.22}),
  concrete:new Material({name:'Land turbine reinforced concrete',color:0x9c9a8b,roughness:0.95}),
  gravel:new Material({name:'Farm maintenance path gravel',color:0x88785c,roughness:1}),
  glass:new Material({name:'Nacelle service glazing',color:0x23434e,roughness:0.2,metalness:0.45}),
  marker:new Material({name:'Turbine red obstruction lamp',color:0xdb3326,emissive:0x9c1306,roughness:0.3}),
 }};
}

function mesh(geometry,material,name) { const m=new Mesh(geometry,material);m.name=name;m.layers.set(LAYERS.OPAQUE);m.castShadow=m.receiveShadow=true;return m; }
function merged(parts,material,name) {const g=mergeGeometries(parts);for(const p of parts)p.dispose();return mesh(g,material,name);}
function box(x,y,z,px,py,pz) {return new BoxGeometry(x,y,z).translate(px,py,pz);}
function cylinder(top,bottom,h,y,segments=24) {return new CylinderGeometry(top,bottom,h,segments).translate(0,y,0);}
function railSegment(a,b,r=0.055) {const v=new Vector3().subVectors(b,a),g=new CylinderGeometry(r,r,v.length(),6);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),v.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);return g;}

export function buildTurbine(site,assets) {
 const {materials:m}=assets,root=new Group(),flex=new Group(),yaw=new Group(),shaft=new Group(),rotor=new Group();
 root.name=`${site.id} land turbine`;root.position.set(site.x,site.baseY,site.z);root.add(flex);
 const buried=site.baseY-site.anchorY;
 const foundation=mesh(cylinder(6.5,6.5,buried,-buried/2),m.concrete,`${site.id} buried reinforced-concrete footing`);root.add(foundation);
 const towerBottom=mesh(cylinder(2.4675,3,43.8,21.9),m.ivory,`${site.id} lower tower`);
 const towerTop=mesh(cylinder(1.935,2.4675,43.8,65.7),m.ivory,`${site.id} upper tower`);
 flex.add(towerBottom,towerTop);
 // Local y=0 is the footing surface. Each detachable tower segment includes
 // its attached joints, access door and fittings; no floating details remain.
 const towerDetails=[cylinder(3.35,3.35,.18,.10),box(1.22,2.4,.12,0,1.35,3.015),box(.22,.32,.10,.42,1.32,3.1)];
 const seam=(radius,y)=>cylinder(radius,radius,.07,y);
 towerDetails.push(seam(2.762,21.9),seam(2.49,43.76));
 for(let i=0;i<36;i++){const a=i*Math.PI/18;towerDetails.push(new CylinderGeometry(.055,.065,.12,6).translate(3.17*Math.cos(a),.23,3.17*Math.sin(a)));}
 for(const x of [-.66,.66])towerDetails.push(box(.06,2.55,.06,x,1.35,3.10));
 for(let y=.15;y<2.5;y+=.31)towerDetails.push(box(.95,.045,.04,0,y,3.14));
 towerBottom.add(merged(towerDetails,m.dark,`${site.id} anchor bolts, tower seams and access door`));
 towerTop.add(mesh(seam(2.22,65.7),m.dark,`${site.id} upper flange seam`));
 const service=[],safety=[];
 for(let i=0;i<28;i++) {
  const a=i*Math.PI/14,b=(i+1)*Math.PI/14;
  if(Math.sin(a)>.92||Math.sin(b)>.92)continue;
  const p=new Vector3(6.05*Math.cos(a),.12,6.05*Math.sin(a)),q=new Vector3(p.x,1.2,p.z);
  service.push(railSegment(p,q),railSegment(q,new Vector3(6.05*Math.cos(b),1.2,6.05*Math.sin(b))),railSegment(new Vector3(p.x,.64,p.z),new Vector3(6.05*Math.cos(b),.64,6.05*Math.sin(b))));
 }
 service.push(box(1.25,1.65,.75,4.1,.85,0),box(.06,1.42,.67,4.75,.85,0),box(.12,.2,.1,4.82,.92,0));
 safety.push(box(.85,.30,.03,4.12,1.30,.395),box(1.25,.16,.12,0,2.54,3.14));
 // Open maintenance ladder down the exposed side of the concrete footing.
 const ladderBottom=Math.min(-.5,site.terrainMin-site.baseY);
 for(const x of [-.48,.48])service.push(box(.07,1.3-ladderBottom,.07,x,(1.3+ladderBottom)/2,6.62));
 for(let y=ladderBottom+.15;y<.25;y+=.28)service.push(box(1.02,.055,.075,0,y,6.62));
 for(const x of [-.9,.9])safety.push(box(.1,1.2,.1,x,.6,5.98));
 root.add(merged(service,m.dark,`${site.id} maintenance platform, guardrails, ladder and switchgear`),merged(safety,m.yellow,`${site.id} access safety markings`));
 flex.add(yaw);yaw.position.y=R.towerHeight;
 const nacelle=new Group();yaw.add(nacelle);
 const shell=new BoxGeometry(4.6,3.7,10).translate(0,1.8,-1.5);
 const cowling=new CylinderGeometry(2.0,2.0,3.5,24).rotateX(Math.PI/2).translate(0,1.9,3.7);
 nacelle.add(merged([shell,cowling],m.ivory,`${site.id} nacelle shell`));
 const details=[box(2.4,.18,2.2,0,3.77,-2.7),box(2.6,.8,.1,0,2.0,-6.55),box(5.8,.12,2.1,0,-.03,-7.05)];
 for(const side of [-1,1]) {
  details.push(box(.07,1.05,5.8,side*2.325,1.8,-2.2));
  for(let z=-4.9;z<.65;z+=.25)details.push(box(.11,.82,.07,side*2.385,1.8,z));
  for(let z=-5.5;z<2.6;z+=2.0)for(const y of [.13,3.45])details.push(box(.08,.06,.06,side*2.33,y,z));
  for(let z=-6;z<2.7;z+=2.8)details.push(box(.045,3.35,.025,side*2.321,1.8,z));
  for(let z=-7.95;z<=-6;z+=.65)details.push(box(.055,1.12,.055,side*2.75,.6,z));
  details.push(box(.055,.055,2.0,side*2.75,1.17,-7.0));
 }
 for(let x=-2.75;x<=2.76;x+=.69)details.push(box(.055,1.12,.055,x,.6,-8.02));
 details.push(box(5.5,.055,.055,0,1.17,-8.02));
 for(const x of [-.42,.42])details.push(box(.07,4.1,.07,x,1.9,-6.73));
 for(let y=0;y<=3.85;y+=.30)details.push(box(.9,.055,.07,0,y,-6.75));
 for(const z of [-3.55,-1.85])for(const x of [-.9,.9])details.push(new CylinderGeometry(.045,.045,.08,6).translate(x,3.92,z));
 details.push(box(.12,1.1,.12,0,4.3,-4.5));nacelle.add(merged(details,m.dark,`${site.id} louvres, service deck, ladder, roof hatch and bolts`));
 nacelle.add(mesh(box(2.7,0.65,.12,0,2.85,-6.58),m.glass,`${site.id} inspection window`));
 const lamp=mesh(new SphereGeometry(.23,10,6).translate(0,4.92,-4.5),m.marker,`${site.id} obstruction lamp`);nacelle.add(lamp);
 yaw.add(shaft);shaft.position.set(0,R.hubHeight-R.towerHeight,R.overhang);shaft.rotation.x=-R.tilt;shaft.add(rotor);
 const hub=mesh(new SphereGeometry(R.hubRadius,24,16).scale(1,1,1.65),m.ivory,`${site.id} rotor hub`);rotor.add(hub);
 const blades=[];
 for(let i=0;i<3;i++) {
  const azimuth=new Group(),cone=new Group(),pitch=new Group();azimuth.rotation.z=i*2*Math.PI/3;cone.rotation.x=R.precone;rotor.add(azimuth);azimuth.add(cone);pitch.position.y=R.hubRadius;cone.add(pitch);
  const blade=mesh(assets.blade,m.ivory,`${site.id} blade ${i+1}`);pitch.add(blade);
  const rootFittings=[cylinder(1.62,1.62,.22,.16,24),cylinder(1.53,1.53,.10,.42,24)];
  for(let j=0;j<20;j++){const a=j*Math.PI/10;rootFittings.push(new CylinderGeometry(.05,.05,.09,6).translate(1.48*Math.cos(a),.31,1.48*Math.sin(a)));}
  pitch.add(merged(rootFittings,m.dark,`${site.id} blade ${i+1} pitch bearing and root bolts`));blades.push({azimuth,pitch,mesh:blade});
 }
 return {root,flex,yaw,shaft,rotor,nacelle,hub,blades,towerBottom,towerTop,foundation,lamp};
}

export function buildAccessPaths(terrain,paths,assets) {
 const positions=[],indices=[];
 for(const points of paths)for(let i=1;i<points.length;i++) {
  const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z),nx=(b.z-a.z)/length*1.1,nz=-(b.x-a.x)/length*1.1,steps=Math.ceil(length/1.5);
  for(let k=0;k<steps;k++) {
   const n=positions.length/3;
   for(const [u,side] of [[k/steps,-1],[k/steps,1],[(k+1)/steps,-1],[(k+1)/steps,1]]){const x=a.x+(b.x-a.x)*u+nx*side,z=a.z+(b.z-a.z)*u+nz*side;positions.push(x,terrain.heightAt(x,z)+.08,z);}
   indices.push(n,n+2,n+1,n+1,n+2,n+3);
  }
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();
 return mesh(g,assets.materials.gravel,'Northern wind farm maintenance foot trail');
}

export function disposeFarmAssets(assets,roots) {
 const geometries=new Set([assets.blade]);for(const root of roots)root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});
 for(const g of geometries)g.dispose();for(const m of Object.values(assets.materials))m.dispose();
}
