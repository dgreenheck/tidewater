import { Group, Mesh, Vector3, Color } from '../engine/index.js';
import { Material } from '../engine/webgpu.js';
import { Builder } from '../world/village/GeoBuilder.js';
import { structure, STRUCTURES } from '../disasters/Structures.js';
import { prepareEvacuationRoute, routeObservation } from './Route.js';
import { evacuationSignMaterial, signFace } from './Signs.js';
import { EvacuationPanel } from './Panel.js';

const timber=[.34,.205,.105],dark=[.14,.09,.048],green=[.04,.22,.12],metal=[.34,.37,.34];
export class Evacuation {
 constructor(app){
  this.app=app;this.route=prepareEvacuationRoute(app.terrainData);this.refuge=this.route.refuge;
  this.group=new Group();this.group.name='High-ground evacuation boardwalk';this.records=[];this.elapsed=0;this.lights=[];
 }
 async init(){
  this.build();this.app.scene.add(this.group);this.ui=new EvacuationPanel(this);this.update(0);
 }
 build(){
  const app=this.app,r=this.route,B=new Builder(),C=app.colliders,w=r.width;
  const box=(x,y,z,sx,sy,sz,walkable=false,tag='evacuation-rail')=>C.addBox(new Vector3(x,y,z),new Vector3(sx/2,sy/2,sz/2),0,{walkable,solid:true,tag});
  const wood=(x,y,z,sx,sy,sz,tint=timber,seed=0)=>B.box('wood',x,y,z,sx,sy,sz,{tint,data:[seed,.28,0,0]});
  const post=(x,z,top,base,seed)=>{
   wood(x,(base+top)/2,z,.22,top-base,.22,dark,seed);
   B.box('stone',x,base-.09,z,.55,.30,.55,{tint:[.30,.30,.25]});
   B.box('hard',x,base+.13,z,.25,.24,.25,{tint:metal,data:[seed,.3,0,0]});
   B.box('hard',x,top+.025,z,.26,.055,.26,{tint:metal});
   for(const y of [top-.23,top-.72])B.cyl('hard',x+.116,y,z,.025,.025,.03,{rz:-Math.PI/2,segs:6,tint:metal});
  };
  const sign=(x,z,y,row,width=3.4)=>{
   wood(x,y,z,width+.18,.96,.13,dark,row+20);
   B.part('sign',signFace(width,.82,row),x,y,z+.071);
  };
  const node=(z,y,seed)=>{
   for(const side of [-1,1]){
    const x=r.x+side*(w/2-.08);
    B.box('hard',x,y+.91,z,.22,.12,.25,{tint:metal});
    B.box('lamp',x,y+.99,z,.15,.08,.20);
   }
   if(seed%2===0){const light=app.localLights?.add({position:new Vector3(r.x,y+.8,z),color:new Color(.12,1,.38),intensity:2.5,range:6,kind:'lantern',flicker:0});if(light)this.lights.push(light);}
  };
  // Merge all repeated detail by material, retaining section ownership for the
  // existing load/fracture system. A broken span carries its signs and rails too.
  for(let start=0;start<r.points.length;start+=20){
   const end=Math.min(start+20,r.points.length),a=r.points[start],b=r.points[end-1];
   structure(`Evacuation boardwalk ${1+start/20}`,C,()=>{
    for(let i=start;i<end;i++){
     const p=r.points[i],shade=1+.06*Math.sin(i*13.37);
     wood(p.x,p.y-.065,p.z,w,.13,p.run-.012,timber.map(v=>v*shade),i*.37);
     box(p.x,p.y-.10,p.z,w,.20,p.run+.006,true,'evacuation-deck');
     // Contrast the tread noses: real narrow timber battens, no floating stripe.
     B.box('hard',p.x,p.y+.002,p.z+p.run/2-.025,w-.10,.009,.035,{tint:[.52,.47,.29]});
    }
    for(const side of [-1,1]){
     const x=r.x+side*(w/2-.10),z0=a.z+a.run/2,z1=b.z-b.run/2;
     for(const above of [.53,1.03])B.beam('wood',[x,a.y+above,z0],[x,b.y+above,z1],.095,.095,{tint:green,data:[start,.5,0,0]});
     B.beam('wood',[x,a.y-.23,z0],[x,b.y-.23,z1],.19,.30,{tint:dark});
     box(x,(a.y+b.y)/2+.59,(z0+z1)/2,.16,Math.abs(b.y-a.y)+1.13,z0-z1+.015);
    }
    for(let i=start;i<end;i+=10){const p=r.points[i];
     // Bridge piers stay off the coastal roadway. Continuous braced stringers
     // carry this 18 m span, with no post or collision wall across traffic.
     const bridge=p.z<r.bridge.startZ&&p.z>r.bridge.endZ;
     for(const side of [-1,1]){
      const x=r.x+side*(w/2-.10),base=bridge?p.y-.20:app.terrainData.heightAt(x,p.z)-.15;
      post(x,p.z,p.y+1.1,base,i+side);
      if(bridge){const next=r.points[Math.min(i+10,r.points.length-1)];B.beam('wood',[x,p.y-.20,p.z],[x,next.y+1.03,next.z],.15,.18,{tint:dark});}
      if(!bridge&&p.y-base>1.5)B.beam('wood',[x,base+.3,p.z],[r.x-side*(w/2-.10),p.y-.28,p.z],.13,.16,{tint:dark});
     }
     if(i%20===0)node(p.z,p.y,i/20);
    }
    if(start===0){
     for(const side of [-1,1])post(r.x+side*(w/2+.08),a.z,a.y+3.3,app.terrainData.heightAt(r.x+side*2,a.z),102+side);
     sign(r.x,a.z,a.y+2.84,0);
    }
    if(start===180||start===320){const p=r.points[start];sign(r.x+3.15,p.z,p.y+1.85,start===180?3:1,2.8);post(r.x+3.15,p.z,p.y+1.45,app.terrainData.heightAt(r.x+3.15,p.z),start);}
   },'timber');
   this.records.push(STRUCTURES.at(-1));
  }
  structure('Evacuation high-ground refuge',C,()=>{
   const R=r.refuge;
   for(let z=R.z+R.depth/2-.15;z>R.z-R.depth/2;z-=.30)wood(R.x,R.y-.065,z,R.width,.13,.286,timber,z);
   box(R.x,R.y-.12,R.z,R.width,.24,R.depth+.012,true,'evacuation-refuge');
   for(const side of [-1,1])for(const z of [R.z+2.7,R.z,R.z-2.7])post(R.x+side*(R.width/2-.12),z,R.y+1.13,app.terrainData.heightAt(R.x+side*3.9,z)-.15,z);
   for(const side of [-1,1]){
    const x=R.x+side*(R.width/2-.12);
    for(const y of [.52,1.04])wood(x,R.y+y,R.z,.10,.10,R.depth,green);
    box(x,R.y+.60,R.z,.16,1.2,R.depth);
    // Benches sit clear of the walking centre, with solid seats and visible legs.
    wood(R.x+side*2.9,R.y+.43,R.z,.62,.12,2.1,timber);
    for(const z of [R.z-.8,R.z+.8])wood(R.x+side*2.9,R.y+.20,z,.45,.40,.12,dark);
    box(R.x+side*2.9,R.y+.25,R.z,.65,.5,2.1,true,'evacuation-bench');
   }
   // The summit footpath leaves through this 2.5 m opening; rails and their
   // physical colliders retain exactly the same two side spans.
   const gateWidth=2.5,backSpan=(R.width-gateWidth)/2;
   for(const side of [-1,1]){
    const x=R.x+side*(gateWidth/2+backSpan/2);
    for(const y of [.52,1.04])wood(x,R.y+y,R.z-R.depth/2,backSpan,.10,.10,green);
    box(x,R.y+.60,R.z-R.depth/2,backSpan,1.2,.16);
   }
   for(const side of [-1,1]){wood(R.x+side*2.95,R.y+1.04,R.z+R.depth/2,1.9,.10,.10,green);box(R.x+side*2.95,R.y+.60,R.z+R.depth/2,1.9,1.2,.16);}
   // Keep the rear-centre sightline clear for the third-person view downhill.
   sign(R.x+3.0,R.z-2.85,R.y+1.92,2,2.6);
   for(const x of [R.x+1.75,R.x+4.25])post(x,R.z-2.93,R.y+2.43,app.terrainData.heightAt(x,R.z-2.93)-.15,108);
   node(R.z,R.y,100);
  },'timber');
  this.records.push(STRUCTURES.at(-1));
  this.lampMaterial=new Material({name:'evacuation-green-lights',color:0x32d68c,emissive:0x24c97d,uniforms:{warning:['f32',0],pulse:['f32',0]},surface:'let on=0.65+mat.warning*(0.65+0.6*sin(mat.pulse+in.P.z*0.48));s.albedo=vec3f(0.04,0.48,0.21);s.emissive=vec3f(0.03,1.0,0.32)*on*2.2;'});
  const materials={...app.village.materials,sign:evacuationSignMaterial(r.refuge.y,r.length),lamp:this.lampMaterial};
  for(const [key,batch]of Object.entries(B.batches)){
   const geo=batch.build(),mesh=new Mesh(geo,materials[key]);mesh.name='Evacuation '+key;mesh.castShadow=key!=='lamp';mesh.receiveShadow=true;mesh.frustumCulled=false;this.group.add(mesh);
  }
  this.drawCalls=this.group.children.length;
  this.triangles=this.group.children.reduce((n,m)=>n+m.geometry.index.count/3,0);
 }
 faceRoute(){
  const app=this.app,p=app.player;
  if(app.freeCam||p.mode!=='walk'){this.ui.message('Return to walking before following the evacuation route.');return false;}
  const obs=this.state(),target=obs.atRefuge?this.route.entry:obs.entranceDistance<5||p.position.z<this.route.startZ?this.refuge:this.route.entry;
  p.yaw=Math.atan2(-(target.x-p.position.x),-(target.z-p.position.z));p.pitch=obs.atRefuge?-.16:.10;
  p._camY=null;app.input.consumeLook();app.cameraCut?.();this.ui.tool.close();this.ui.panel.querySelector('button:focus')?.blur();return true;
 }
 state(){return routeObservation(this.route,this.app.player,this.app.disasters?.field,this.records);}
 update(dt){
  if(!this.app.disasters?.paused)this.elapsed+=dt;
  const s=this.state();this.lampMaterial?.set('warning',s.warning?1:0);this.lampMaterial?.set('pulse',this.elapsed*4.5);
  this.ui?.update(s);
 }
}
