import test from 'node:test';
import assert from 'node:assert/strict';
import {Ragdoll} from '../src/player/Ragdoll.js';
import {Colliders} from '../src/world/Colliders.js';
import {DisasterField} from '../src/disasters/Field.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';

const v=(x=0,y=0,z=0)=>({x,y,z}), q=()=>({x:0,y:0,z:0,w:1});
// One unconstrained production capsule isolates the real capsule integration and
// contact path from animation assets. Its mass/inertia are the capsule equations.
function capsule({mass=8,y=10,ground=-20,velocity=[0,0,0],field}={}) {
 const rd=new Ragdoll({terrain:{heightAt:()=>ground},colliders:new Colliders()},{mass,sub:1});
 const r=.1,len=.3,b={index:0,r,len,m:mass,im:1/mass,iAx:1/(.5*mass*r*r),iPerp:12/(mass*(3*r*r+(len+r)**2)),ax:v(0,1,0),float:1,x:v(0,y,0),q:q(),v:v(...velocity),w:v(),px:v(),pq:q(),samples:[v()],root:true};
 rd.bodies=[b];rd.pelvis=rd.chest=b;rd.joints=[];rd.stats={capped:0,acceptedTime:0,consumedTime:0,substeps:0,substepsMax:0,maxIntegratedAngle:0,maxNearTravelRatio:0,maxGeometricTravelRatio:0,forceRetries:0};rd.built=true;rd.nearT=0;rd.flail=0;rd.disasterField=field;return {rd,b};
}
function fluid(U=[0,0],level=0) {
 const f=new DisasterField(()=>-20);f.ambient=()=>({x:U[0],z:U[1]});
 f.water=new WaterGrid(()=>-20,{n:9,dx:8,x:0,z:0});
 for(let i=0;i<f.water.h.length;i++){f.water.h[i]=20+level;f.water.qx[i]=(20+level)*U[0];f.water.qz[i]=(20+level)*U[1];}
 f.water.pack();return f;
}
test('Production ragdoll water/air loads are invariant under equal fluid/body translation',()=>{
 const run=U=>{const {rd,b}=capsule({y:-.3,velocity:[U[0]+2,0,U[1]-1],field:fluid(U)});rd.waterY=0;rd.simulate(1/120);return [b.v.x-U[0],b.v.y,b.v.z-U[1]];};
 const a=run([0,0]),b=run([4,2]);a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<1e-10,`relative component ${i}: ${x} versus ${b[i]}`));
});
test('Segment air acceleration uses its actual mass and exact held substep',()=>{
 const run=mass=>{const f=new DisasterField(()=>-20);f.ambient=()=>({x:10,z:0});const {rd,b}=capsule({mass,field:f});rd.simulate(1/120);return b.v.x;};
 const light=run(4),heavy=run(16);assert.ok(light>3.9*heavy,`${light} versus ${heavy}`);
 const dt=1/120,area=2*.1*(.3+2*.1),speed=Math.hypot(10,9.81*dt),k=.5*1.225*1.1*area*speed/4;
 assert.ok(Math.abs(light-10*k*dt/(1+k*dt))<1e-10,`actual ${light}`);
});
test('Airborne capsule receives no earthquake acceleration until a solved support contact',()=>{
 const f=new DisasterField(()=>0);f.start('earthquake',{intensity:2,x:0,z:0});f.events.get('earthquake').time=1.3;
 const {rd,b}=capsule({y:.16,ground:0,field:f});rd.simulate(1/120);
 assert.ok(Math.abs(b.v.x)+Math.abs(b.v.z)<1e-12,`hovering velocity ${JSON.stringify(b.v)}`);
 const grounded=capsule({y:.1,ground:0,field:f});grounded.rd.simulate(1/120);assert.equal(grounded.b.supported,true);
});
test('Ragdoll point impulse conserves the declared adult/child linear momentum',()=>{
 for(const mass of [35,72,75]){const {rd,b}=capsule({mass});rd.push(v(21,7,-14),b.x);assert.ok(Math.abs(b.v.x*mass-21)<1e-10);assert.ok(Math.abs(b.v.y*mass-7)<1e-10);assert.ok(Math.abs(b.v.z*mass+14)<1e-10);}
});
test('Flooded capsule dissipates relative current energy and remains finite through stop',()=>{
 const f=fluid([3,-2],1),{rd,b}=capsule({y:-.3,velocity:[8,0,-2],field:f});rd.waterY=1;let prior=Infinity;
 for(let i=0;i<120;i++){rd.simulate(1/120);const energy=.5*b.m*((b.v.x-3)**2+(b.v.z+2)**2);assert.ok(energy<=prior+1e-9);prior=energy;assert.ok(Number.isFinite(b.x.x+b.x.y+b.x.z));}
 assert.ok(prior<1);f.stop();for(let i=0;i<120;i++)rd.simulate(1/120);assert.ok(b.x.y>-.7,`baseline water support ${b.x.y}`);assert.equal(rd.stats.capped,0);
});

import {Contact} from '../src/people/Contact.js';
import {Disasters} from '../src/disasters/Disasters.js';
import {Vector3,Quaternion} from '../src/engine/index.js';
import {sweepSphereBox,debrisImpulse,HumanDebrisContacts} from '../src/disasters/HumanContacts.js';
const vec=(...a)=>new Vector3(...a);
test('Overflow physical human integrates the full accepted frame',()=>{
 const run=steps=>{const C=new Colliders(),app={colliders:C,player:{groundAt:()=>-1000}},contact=new Contact({app,t:1}),p={base:vec(0,10,0)},k={physical:{position:vec(0,10,0),velocity:vec(2,0,0),mass:72,supported:false}};
  for(const dt of steps)contact.environmentBody(p,k,dt,{});return k.physical;};
 const fine=run(Array(12).fill(1/120)),coarse=run([.1]);assert.ok(Math.abs(coarse.position.x-.2)<1e-12);assert.ok(Math.abs(coarse.velocity.y+.981)<1e-12);assert.ok(coarse.position.distanceTo(fine.position)<1e-12);
});
test('Calm sea buoyancy during a tsunami warning does not knock down waders or swimmers',()=>{
 const owner=Object.create(Disasters.prototype);owner.changedPeople=new Map();owner.field=fluid();owner.field.start('tsunami',{warningLead:90});let falls=0;
 const list=[-.4,-1.4].map(y=>({world:vec(0,y,0),model:{},brain:{type:'adult'},posture:'swim'}));
 owner.app={people:{list,t:1,contact:{environment:()=>falls++}},player:{groundAt:()=>-20,mode:'boat'}};owner.people(1/60);
 assert.equal(falls,0);assert.ok(list.every(p=>p.disasterLoad.current===0));assert.ok(list.every(p=>p.environmentAcceleration.y>0));
});
// Wading ragdoll loop, NPC side (2026-10-05): the tipping test fed each person's own walking
// velocity to the field, so a calm wader read his own drag as a knock: 1.4 m/s at 0.8 m gave about
// 4.6 m/s² against the 3.2 m/s² line. Calm water pushes nothing; a real current still tips.
test('Calm-sea waders never tip from their own walking drag, and a 2 m/s current at 0.8 m still tips one',()=>{
 const wade=(U,depth,speed)=>{const owner=Object.create(Disasters.prototype);owner.changedPeople=new Map();owner.field=fluid(U);let falls=0;
  const person={world:vec(0,-depth,0),model:{},brain:{type:'adult'},_bv:{x:speed,y:0,z:0}};
  owner.app={people:{list:[person],t:1,contact:{environment:()=>falls++}},player:{groundAt:()=>-depth,mode:'boat'}};owner.people(1/60);
  return {falls,person};};
 // depth (m), own speed (m/s): walking at the 0.8 m wade, running out through 0.3 m and 0.16 m.
 for(const [depth,speed] of [[.8,1.4],[.3,3],[.16,3]]){
  const {falls,person}=wade([0,0],depth,speed);
  assert.equal(falls,0,`${depth} m at ${speed} m/s in calm sea tipped (load ${person.environmentAcceleration.x.toFixed(2)} m/s²)`);
  assert.ok(person.environmentAcceleration.x<-.5,`the real wading drag still slows the wader (${person.environmentAcceleration.x.toFixed(2)} m/s²)`);
 }
 const {falls}=wade([2,0],.8,0);
 assert.equal(falls,1,'a 2 m/s current over 0.8 m must tip a standing adult');
});
test('Exact sphere-box sweep catches fast faces and rejects expanded-box false corner hits',()=>{
 const I=new Quaternion(),zero=vec(),half=vec(.5,.5,.5);
 const hit=sweepSphereBox(vec(0,0,0),vec(0,0,0),vec(-4,0,0),vec(4,0,0),I,half,.25);assert.ok(hit);assert.ok(Math.abs(hit.time-.40625)<1e-12);assert.ok(hit.normal.x>.99);
 assert.equal(sweepSphereBox(vec(.73,.73,0),vec(.73,.73,0),zero,zero,I,half,.25),null);
 assert.equal(sweepSphereBox(vec(.73,.6,0),vec(.73,.6,0),zero,zero,I,half,.25),null);
 assert.ok(sweepSphereBox(vec(.70,.6,0),vec(.70,.6,0),zero,zero,I,half,.25));
});
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {readFile} from 'node:fs/promises';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const nativeBody=(sim,id)=>{const a=sim.disaster_motion();for(let i=0;i<a.length;i+=7)if(a[i]===id)return Array.from(a.slice(i+1,i+7));};
test('Actual shipped debris/human contact conserves momentum and dissipates restitution energy',()=>{
 const sim=new RallyPhysics();try{
  sim.wake_prop(701,0,new Float32Array([.5,.5,.5]),new Float32Array([-2,100,0,0,0,0,1,5,0,0]),10,0,0,false);sim.advance(1/120,0,0,0,0);
  const before=nativeBody(sim,701),point=vec(before[0]+.5,before[1],0),normal=vec(1,0,0),humanV=vec();
  const result=debrisImpulse(sim,701,point,normal,{velocity:humanV,inverseMass:1/72,apply:J=>humanV.addScaledVector(J,1/72)});
  assert.ok(result?.magnitude>40,'production contact transfers the observed native momentum');const after=nativeBody(sim,701);
  assert.ok(Math.abs(after[3]*10+humanV.x*72-before[3]*10)<1e-4);
  assert.ok(.5*10*after[3]**2+.5*72*humanV.x**2<.5*10*before[3]**2);
  assert.ok(Math.abs((humanV.x-after[3])/.05-before[3])<1e-4);
  const old=after[3];assert.equal(sim.apply_prop_impulse(701,new Float32Array([NaN,0,0]),new Float32Array(point.toArray())),false);assert.equal(nativeBody(sim,701)[3],old);
 }finally{sim.free();}
});
test('Actual scene contact orchestration catches moving native debris and creates a measured-velocity human response',()=>{
 const sim=new RallyPhysics();try{
  const person={id:9,world:vec(0,0,0),base:vec(),model:{},brain:{type:'adult',bump(){}},_bv:vec()};
  const app={rally:{physics:sim},people:{list:[person],t:1},player:{avatar:{}},colliders:new Colliders()};app.people.app=app;app.people.contact=new Contact(app.people);
  const owner={app,structures:{bodies:new Map([[702,{half:vec(.3,.3,.3)}]])},bodies:{bodies:new Map()},rememberPerson(){}};
  const collisions=new HumanDebrisContacts(owner);sim.wake_prop(702,0,new Float32Array([.3,.3,.3]),new Float32Array([-1.2,.85,0,0,0,0,1,10,0,0]),10,0,0,false);
  for(let i=0;i<12;i++)sim.advance(1/120,0,0,0,0);collisions.update(.1);
  assert.ok(person.knock?.physical?.velocity.x>0);assert.ok(collisions.contacts>0);assert.ok(nativeBody(sim,702)[3]<10);
  collisions.reset();assert.equal(collisions.previous.size,0);assert.equal(collisions.last.length,0);
 }finally{sim.free();}
});

test('Diagonal debris sweep keeps collision-time human torque separate from the final native contact attachment',()=>{
 for(const lift of [0,2]){
  const hit=sweepSphereBox(vec(),vec(0,lift,0),vec(-4,-1,0),vec(4,1+lift,0),new Quaternion(),vec(.5,.5,.5),.25);
  assert.ok(Math.abs(hit.time-.40625)<1e-12);
  assert.ok(hit.point.distanceTo(vec(-.25,lift*hit.time,0))<1e-12,'world contact must be at collision time');
  assert.ok(hit.bodyPoint.distanceTo(vec(4.5,1.1875+lift,0))<1e-12,'native point must retain its local attachment at the final native pose');
  assert.ok(hit.humanPoint.distanceTo(vec(-.25,lift,0))<1e-12,'human point must retain its local attachment at the final human pose');
  const {rd,b}=capsule({mass:72,y:lift}),offset=hit.humanPoint.clone().sub(vec(b.x.x,b.x.y,b.x.z));
  assert.ok(Math.abs(rd.wPos(b,offset,hit.normal)-1/72)<1e-12,'central hit must have no rotational effective mass');
  rd.impulse(b,offset,12,0,0);assert.deepEqual(b.w,v(),'central hit must not create artificial spin');
 }
});

test('Disaster baseline captures and restores mixed ferry-array and beach-vector routes without sharing mutable points',()=>{
 const sim=new RallyPhysics();try{
  const body=()=>({position:vec(),quaternion:new Quaternion(),velocity:vec(),angular:vec(),pose(){}});
  const list=[{world:vec(1,2,3),base:vec(1,2,3),off:vec(),path:[['T',4,5,6],['S',7,8,9]],mode:'walk'}, {world:vec(4,5,6),base:vec(4,5,6),off:vec(),path:[vec(7,8,9)],mode:'stand'}];
  const owner=Object.create(Disasters.prototype),ship=body(),app={people:{list,contact:{wet:new Set()},evacuation:{reset(){}}},boatCtl:body(),jetskis:{ctl:body(),skis:[]},ferry:{ship},rally:{physics:sim,damage:{captureDisasterState:()=>({}),restoreDisasterState(){}},syncModel(){},refreshIslandColliders(){}},player:{position:vec(),velocity:vec(),mode:'walk'},camera:{position:vec(),quaternion:new Quaternion()},cameraCut(){}};
  Object.assign(owner,{app,field:new DisasterField(),humanContacts:{reset(){}},structures:{reset(){}},bodies:{reset(){}},propSnapshots:new Map(),changedPeople:new Map(),external:new Set(),touched:new Set(),water:{update(){}},siren:{stop(){}},tornadoVisuals:{clear(){}},refresh(){}});
  assert.doesNotThrow(()=>owner.capture());for(const p of list)owner.rememberPerson(p);
  list[0].path[0][1]=999;list[1].path[0].x=999;list.forEach(p=>p.world.set(999,999,999));owner.reset();
  assert.deepEqual(list[0].path,[['T',4,5,6],['S',7,8,9]]);assert.deepEqual(list[1].path[0].toArray(),[7,8,9]);assert.deepEqual(list.map(p=>p.world.toArray()),[[1,2,3],[4,5,6]]);
  assert.equal(owner.peopleBaseline,null);assert.equal(owner.vesselSnapshots,null);
 }finally{sim.free();}
});

test('Start validates and captures the whole reset baseline before activating any event',()=>{
 const owner=Object.create(Disasters.prototype);owner.field=new DisasterField();owner.capture=()=>{throw new Error('capture fixture failure');};
 assert.throws(()=>owner.start('earthquake',{intensity:1}),/capture fixture failure/);assert.equal(owner.field.events.size,0,'failed baseline cannot leave an active disaster behind a validation error');
});

test('Articulated solver consumes the full accepted 0.1 second frame with bounded physical substeps',()=>{
 const coarse=capsule({y:100,ground:-1000,velocity:[2,0,0]}),fine=capsule({y:100,ground:-1000,velocity:[2,0,0]});
 coarse.rd.simulate(.1);for(let i=0;i<12;i++)fine.rd.simulate(1/120);
 assert.ok(Math.abs(coarse.b.v.y+.981)<1e-9,'gravity must act over the whole accepted interval');assert.ok(Math.abs(coarse.b.x.x-.2)<1e-10);assert.ok(Math.abs(coarse.b.x.y-fine.b.x.y)<.005);assert.equal(coarse.rd.stats.capped,0);
});

import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
test('Actual 14-capsule human propagates solved support through joints and sums base-excitation load over its complete mass',async()=>{
 const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url)),write=StorageBuffer.prototype.write;
 // Isolate only GPU transport; GLB skeleton, animation pose, masses, constraints,
 // terrain contacts and all physical integration are the production classes.
 StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 try{const create=height=>{const model=new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))),avatar={model,group:model.group,idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1}},rd=new Ragdoll({terrain:{heightAt:()=>0},colliders:new Colliders()},{mass:72,sub:3});assert.ok(rd.start(avatar,vec(0,height,0),new Quaternion(),vec()));return rd;};
  const grounded=create(0),hovering=create(10);for(let i=0;i<120;i++)grounded.simulate(1/120);
  assert.equal(grounded.bodies.length,14);assert.equal(grounded.bodies.reduce((sum,b)=>sum+b.m,0),72);assert.ok(grounded.bodies.some(b=>b.supported)&&grounded.bodies.some(b=>!b.supported),'a partially supported, joint-connected rig is required');
  for(const [rd,expected]of [[grounded,144],[hovering,0]]){const loads=[];rd.disasterField={waterAt:()=>-100,acceleration(p,v,o){const ax=o.supported?2:0;loads.push({force:o.mass*ax,h:o.dt});return {ax,ay:0,az:0,ux:0,uz:0,height:-100};}};
   const before=rd.bodies.map(b=>[b.x.x,b.x.y,b.x.z]);rd.simulate(1/120);assert.equal(loads.length,42);
   for(let sub=0;sub<3;sub++)assert.ok(Math.abs(loads.slice(sub*14,(sub+1)*14).reduce((sum,l)=>sum+l.force,0)-expected)<1e-9,'sum F = total mass times uniform base acceleration, or zero when all bodies hover');
   assert.ok(loads.every(l=>Math.abs(l.h-1/360)<1e-12));assert.ok(rd.bodies.every((b,i)=>Math.hypot(b.x.x-before[i][0],b.x.y-before[i][1],b.x.z-before[i][2])<.1),'support change cannot teleport the connected pose');
  }
 }finally{StorageBuffer.prototype.write=write;}
});

test('Overflow physical human remains grounded and cannot pass through an actual wall under sustained shared wind',()=>{
 const C=new Colliders();C.addBox(vec(1.2,1,0),vec(.1,1,3));const field=new DisasterField(()=>0);field.ambient=()=>({x:80,z:0});
 const contact=new Contact({app:{colliders:C,player:{groundAt:()=>0},disasters:{field}},t:1}),person={base:vec()},body={position:vec(),velocity:vec(),mass:72,supported:true},k={physical:body};let maxSpeed=0;
 for(let i=0;i<240;i++){contact.environmentBody(person,k,1/120,{});maxSpeed=Math.max(maxSpeed,body.velocity.length());assert.ok(body.position.x<=.83001);assert.ok(body.position.y>=0);}
 assert.ok(body.position.x>.8,'wind must actually move the person into the wall');assert.equal(body.supported,true);assert.equal(body.velocity.x,0);assert.equal(body.position.y,0);assert.ok(maxSpeed<10);
});
