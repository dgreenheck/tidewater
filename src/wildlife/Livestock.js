import { Group,Vector3,Quaternion,Euler } from '../engine/index.js';
import { SPECIES,locomotion,angularVelocity } from './Control.js';
import { Habitat } from './Habitat.js';
import { AnimalBrain } from './Brain.js';
import { createAnimalModel } from './AnimalModel.js';
import { addWorldTool } from '../ui/WorldTools.js';
const UP=new Vector3(0,1,0);
export class Livestock {
 constructor(app){this.app=app;this.animals=[];this.time=0;this.ready=false;this.baseline=null;this.observing=null;this.frameDt=0;this.restoreCount=0;}
 async init({modelFactory=createAnimalModel,ui=true}={}){
  const A=this.app;this.habitat=new Habitat(A.terrainData,A.colliders,A.rally.trunks,A.vegetation?.records);
  for(const [kind,count,site] of [['goat',6,{x:-112,z:-159}],['cow',4,{x:157,z:-145}]]){
   const spec=SPECIES[kind],chosen=this.habitat.chooseSite(site,spec,A.vegetation?.site?.cover.bind(A.vegetation.site)),spots=this.habitat.placement(chosen,count,spec);
   for(let i=0;i<count;i++){
    const model=await modelFactory(kind,i),root=new Group();root.name=`${kind} ${i+1}`;model.group.position.y=-spec.half[1];root.add(model.group);
    const a={name:root.name,kind,spec,model,root,brain:new AnimalBrain(spec,spots[i],this.animals.length+1),velocity:new Vector3(),angular:new Vector3(),desired:new Vector3(),heading:i*.71,normal:UP.clone(),disabled:false,supported:false,motor:{},distance:0};
    a.body=this.spawn(a,{position:spots[i],quaternion:new Quaternion().setFromAxisAngle(UP,a.heading),velocity:a.velocity,angularVelocity:a.angular});
    a.proxy=A.colliders.addBox(spots[i],new Vector3().fromArray(spec.half),a.heading,{solid:true,walkable:false,tag:`livestock:${a.name}`});a.proxy.prop=true;
    this.animals.push(a);
   }
  }
  this.unregister=A.disasters.registerExternal({capture:()=>this.capture(),cancelCapture:()=>{this.baseline=null;},before:()=>this.capture(),after:()=>this.after(),reset:()=>this.resetDisasterEffects()});
  if(ui)this.buildPanel();this.ready=true;return this;
 }
 spawn(a,state){const spec=a.spec;const body=this.app.disasters.addBody({mesh:a.root,mass:spec.mass,half:spec.half,area:spec.area,volume:spec.volume,height:spec.height,...state,name:a.name,
  controlLoad:input=>{a.supported=input.supported;a.quaternion=a.body.quaternion;a.motor=locomotion(spec,a,input,{});return a.motor;}});
  if(!body)throw new Error('Animal body budget exhausted. The herd cannot be simulated.');return body;
 }
 readMotion(){const physics=this.app.rally.physics,motion=physics.disaster_motion(),byId=new Map();for(let i=0;i<motion.length;i+=7)byId.set(motion[i],i);
  for(const a of this.animals){const i=byId.get(a.body.id);if(i===undefined)continue;a.velocity.fromArray(motion,i+4);angularVelocity(physics,a.body.id,a.body.position,a.velocity,a.angular);}
 }
 update(dt){if(!this.ready||this.app.disasters.paused)return;this.frameDt=Math.min(.1,Math.max(0,dt));this.time+=this.frameDt;this.readMotion();const field=this.app.disasters.field;
  // One herd list per kind per frame, refilled in place: each brain reads its own kind in animal
  // order, as before. It was a filter + map per animal (O(n^2), two arrays each, every frame) and a
  // new before-position vector per animal (L6 profile 2026-10-05; test/livestock.mjs pins both).
  const herds=this.herds??=new Map();
  for(const list of herds.values())list.length=0;
  for(const a of this.animals){
   let list=herds.get(a.kind);
   if(!list)herds.set(a.kind,list=[]);
   list.push(a.body);
  }
  for(const a of this.animals){a.brain.update(this.frameDt,a.body,this.habitat,field,herds.get(a.kind),a.supported);a.desired.copy(a.brain.desired);a.heading=a.brain.heading;a.normal.copy(this.habitat.normal(a.body.position.x,a.body.position.z));a.disabled=a.brain.mode==='carried';(a.beforePosition??=new Vector3()).copy(a.body.position);}
 }
 after(){if(!this.ready||this.app.disasters.paused)return;this.readMotion();
  for(const a of this.animals){const p=a.body.position,q=a.body.quaternion,up=UP.clone().applyQuaternion(q),forward=new Vector3(0,0,1).applyQuaternion(q),speed=Math.hypot(a.velocity.x,a.velocity.z);
   const travel=a.beforePosition?Math.hypot(p.x-a.beforePosition.x,p.z-a.beforePosition.z):0;a.distance+=travel;
   const clip=a.disabled||a.brain.mode==='recover'||!a.supported?'Alert':speed>.14&&a.supported?'Walk':a.brain.mode==='graze'?'Graze':'Idle';
   const layer=a.model.play(clip,{fade:.3});if(layer)layer.speed=clip==='Walk'?Math.min(8,Math.max(.08,speed/a.spec.stride)*2):1;
   a.model.update(this.frameDt);
   this.syncProxy(a);
  }
  this.refresh();
 }
 syncProxy(a){const p=a.body.position,q=a.body.quaternion,b=a.proxy,h=a.spec.half,up=UP.clone().applyQuaternion(q),forward=new Vector3(0,0,1).applyQuaternion(q);b.center.copy(p);
  if(up.y>.75){b.half.fromArray(h);b.rotY=Math.atan2(forward.x,forward.z);}else{const x=new Vector3(1,0,0).applyQuaternion(q),z=forward;b.half.set(Math.abs(x.x)*h[0]+Math.abs(up.x)*h[1]+Math.abs(z.x)*h[2],Math.abs(x.y)*h[0]+Math.abs(up.y)*h[1]+Math.abs(z.y)*h[2],Math.abs(x.z)*h[0]+Math.abs(up.z)*h[1]+Math.abs(z.z)*h[2]);b.rotY=0;}
  b.cos=Math.cos(b.rotY);b.sin=Math.sin(b.rotY);b.top=p.y+b.half.y;b.bottom=p.y-b.half.y;b.radius=Math.hypot(b.half.x,b.half.z);b.solid=true;
 }

 capture(){if(this.baseline)return;this.readMotion();this.baseline={time:this.time,animals:this.animals.map(a=>({position:a.body.position.clone(),quaternion:a.body.quaternion.clone(),velocity:a.velocity.clone(),angularVelocity:a.angular.clone(),brain:a.brain.capture(),distance:a.distance,clip:a.model.current,layers:a.model.layers?.map(l=>({name:l.clip.name,time:l.time,speed:l.speed,weight:l.weight,target:l.target}))}))};}
 resetDisasterEffects(){
  if(!this.baseline)this.capture();const S=this.baseline;this.time=S.time;
  for(let i=0;i<this.animals.length;i++){const a=this.animals[i],s=S.animals[i];this.app.disasters.removeBody(a.body);a.body=this.spawn(a,s);a.velocity.copy(s.velocity);a.angular.copy(s.angularVelocity);a.brain.restore(s.brain);a.desired.copy(a.brain.desired);a.heading=a.brain.heading;a.disabled=a.brain.mode==='carried';a.distance=s.distance;
   if(a.model.layers){a.model.layers.length=0;for(const l of s.layers??[]){const layer=a.model.play(l.name,{fade:0,from:l.time,speed:l.speed});Object.assign(layer,{weight:l.weight,target:l.target});}}a.model.update(0);a.beforePosition=a.body.position.clone();a.normal.copy(this.habitat.normal(a.body.position.x,a.body.position.z));a.supported=false;a.motor={};this.syncProxy(a);
  }
  this.baseline=null;this.restoreCount++;this.refresh();
 }
 watch(kind){const A=this.app;if(A.chairlift?.active||A.aviation?.active||A.glider?.active||A.rally?.active||A.player.mode==='jetski'||A.player.mode==='boat'||A.player.mode==='ferry-helm'||A.jetskis?.riding){this.message.textContent='Leave the vehicle controls before watching animals.';return false;}
  const herd=this.animals.filter(a=>a.kind===kind),p=herd[0].body.position,target=p.clone().add(new Vector3(0,kind==='cow'?.25:.1,0));let eye=null,best=-Infinity;
  for(let i=0;i<24;i++){const angle=.65+i*Math.PI/12,range=kind==='cow'?8.2:6.5,candidate=target.clone().add(new Vector3(Math.sin(angle)*range,kind==='cow'?2.3:1.8,Math.cos(angle)*range));
   if(!this.habitat.visible(candidate,target,.32))continue;let score=0;for(const a of herd)if(this.habitat.visible(candidate,a.body.position,.16))score++;score-=i*.008;if(score>best){best=score;eye=candidate;}}
  if(!eye){this.message.textContent='The herd is obscured here. Try again after it moves into a clearing.';return false;}
  A.setFreeCam(true);A.camera.position.copy(eye);A.camera.lookAt(target);const e=new Euler().setFromQuaternion(A.camera.quaternion,'YXZ');A.fly.setPose(eye,e.y,e.x);A.fly.velocity.set(0,0,0);A.cameraCut();this.observing=kind;this.message.textContent='';this.tool.close();return true;
 }
 buildPanel(){this.panel=document.createElement('section');this.panel.className='livestock-panel';this.panel.setAttribute('aria-label','Island animals');this.panel.innerHTML=`<button type="button" data-close style="float:right">Close</button><h2 style="margin-top:0">Goats &amp; cows</h2><p>Six goats browse the western slopes. Four cows graze the eastern meadow.</p><p><button type="button" data-watch="goat">Watch goats</button> <button type="button" data-watch="cow">Watch cows</button></p><p data-message role="status"></p><div data-summary></div><p style="color:#b9cbd0;font-size:12px">Walking uses limited ground forces. Wind, water, cars and debris can push or topple the animals. Restore island returns the captured herd state.</p><details><summary>Physical model</summary><p>Goats 55 kg; cows 550 kg. Ten native rigid bodies, one box per animal. Animated legs and hooves do not have individual contact joints. Muscle force, friction and stance torque are assumed bounds, not measured biomechanics.</p></details>`;
  this.tool=addWorldTool(this.app,{id:'livestock',label:'Animals',panel:this.panel});this.panel.querySelector('[data-close]').onclick=()=>this.tool.close();for(const b of this.panel.querySelectorAll('[data-watch]'))b.onclick=()=>this.watch(b.dataset.watch);this.message=this.panel.querySelector('[data-message]');this.summary=this.panel.querySelector('[data-summary]');this.refresh();
 }
 refresh(){if(!this.summary||this.panel.hidden)return;const text=this.animals.map(a=>`${a.name}: ${a.brain.mode}, ${Math.hypot(a.velocity.x,a.velocity.z).toFixed(1)} m/s, ${Math.hypot(a.motor.fx??0,a.motor.fz??0).toFixed(0)} N walking force`).join('\n');this.summary.textContent=text;this.summary.style.whiteSpace='pre-line';}
 state(){return {ready:this.ready,count:this.animals.length,time:this.time,observing:this.observing,restoreCount:this.restoreCount,baseline:this.baseline?{time:this.baseline.time,positions:this.baseline.animals.map(a=>a.position.toArray())}:null,members:this.animals.map(a=>({name:a.name,kind:a.kind,id:a.body.id,position:a.body.position.toArray(),quaternion:a.body.quaternion.toArray(),velocity:a.velocity.toArray(),angular:a.angular.toArray(),supported:a.supported,mode:a.brain.mode,panic:a.brain.panic,desired:a.desired.toArray(),motor:{...a.motor},mass:a.spec.mass,area:a.spec.area,clip:a.model.current,phase:a.model.layers?.find(l=>l.target===1)?.time??0,distance:a.distance,ground:this.habitat.ground(a.body.position.x,a.body.position.z),meshes:a.model.meshes?.length??0,joints:a.model.joints??0}))};}
}
