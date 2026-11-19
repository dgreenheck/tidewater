import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player/Player.js';
import { Vector3, PerspectiveCamera } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { DisasterField } from '../src/disasters/Field.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { Disasters } from '../src/disasters/Disasters.js';

// Actual Player.update -> DisasterField loads, with only keyboard and GPU readback
// transports replaced. The synthetic uniform fluid gives independent known limits.
function fixture({ground=0,water=0,current=[0,0],mode='walk',wind=[0,0]}={}) {
 const terrain={heightAt:()=>ground},colliders=new Colliders(),keys=new Set();
 const input={down:k=>keys.has(k),hit:()=>false,consumeLook:()=>({x:0,y:0}),consumeWheel:()=>0};
 const query={cpuValid:true,cpu:new Float32Array(4),allocate:()=>0,setPoint(){}};
 const player=new Player({camera:new PerspectiveCamera(60,1,.1,1000),input,terrain,colliders,query});
 player.view='first';player.yaw=0;player.pitch=0;player.position.set(0,mode==='walk'?ground:water-.062,0);player.mode=mode;player.grounded=mode==='walk';player.waterMean=water;
 const field=new DisasterField(terrain.heightAt);field.ambient=()=>({x:wind[0],z:wind[1]});
 field.water=new WaterGrid(terrain.heightAt,{n:17,dx:16,x:0,z:0});
 const setWater=height=>{for(let i=0;i<field.water.h.length;i++){const depth=Math.max(0,height-ground);field.water.h[i]=depth;field.water.qx[i]=depth*current[0];field.water.qz[i]=depth*current[1];}field.water.pack();};setWater(water);
 const owner=Object.create(Disasters.prototype);owner.field=field;owner.app={people:{list:[]},player,freeCam:false};
 const tick=(dt=1/60)=>{query.cpu[0]=field.waterAt(player.position.x,player.position.z);owner.people(dt);player.update(dt);};
 return {player,field,keys,tick,setWater,run:(seconds,dt=1/60)=>{for(let t=0;t<seconds-dt/2;t+=dt)tick(dt);}};
}
test('A rising local crest changes actual walking mode before the head is submerged and preserves body coordinates',()=>{
 const f=fixture({ground:2.5});f.run(.2);const feet=f.player.position.y;
 f.setWater(8);f.tick();
 assert.equal(f.player.mode,'swim',`water=${f.player.waterH}, mean=${f.player.waterMean}, feet=${f.player.position.y}`);
 assert.ok(Math.abs(f.player.position.y-1.458-feet)<.02,'switch from feet to swimming float point must preserve visible body placement');
 assert.equal(f.player.grounded,false);
 for(let i=0;i<30;i++){f.tick();assert.equal(f.player.mode,'swim','old mean cannot immediately stand a submerged swimmer back up');}
});
test('Passing knee and chest waves retain walking hysteresis, then truly shallow retreat permits standing',()=>{
 const f=fixture();for(let i=0;i<180;i++){f.setWater(.9+.2*Math.sin(i/8));f.tick();assert.equal(f.player.mode,'walk');}
 f.setWater(2.5);f.tick();assert.equal(f.player.mode,'swim');f.run(1);
 f.setWater(.2);f.run(.2);assert.equal(f.player.mode,'walk');assert.ok(Math.abs(f.player.position.y)<.01);
});
test('Ordinary calm swimming keeps normal and sprint speeds and neutral diving behavior',()=>{
 for(const speed of [1.5,2.5]){const f=fixture({ground:-20,mode:'swim'});f.keys.add('KeyW');if(speed>2)f.keys.add('ShiftLeft');f.run(8);
  assert.ok(Math.abs(-f.player.velocity.z-speed)<.08,`calm target ${speed}, actual ${-f.player.velocity.z}`);
  assert.ok(Math.abs(f.player.position.y+.062)<.02);assert.equal(f.player.mode,'swim');
 }
 const f=fixture({ground:-20,mode:'swim'});f.keys.add('KeyC');f.run(2);assert.ok(f.player.position.y<-.8);f.keys.clear();f.run(2);const y=f.player.position.y;f.run(2);assert.ok(Math.abs(f.player.position.y-y)<.1,'no second buoyancy term may pull a deliberate diver up');f.keys.add('Space');f.run(5);assert.ok(f.player.position.y>-.2);
});
test('A passive production swimmer is carried by current instead of becoming immune on mode change',()=>{
 const f=fixture({ground:-20,mode:'swim',current:[4,0]});f.run(5);
 assert.ok(f.player.position.x>12,`current displacement ${f.player.position.x}`);
 assert.ok(f.player.velocity.x>3.6&&f.player.velocity.x<=4.001,`body velocity ${f.player.velocity.x}`);
});
test('Current-relative kinetic energy decays for passive swimmers without overshoot at supported frame steps',()=>{
 for(const dt of [1/120,1/30,.1]){const f=fixture({ground:-20,mode:'swim',current:[4,0],wind:[4,0]});f.player.velocity.set(10,0,0);let prior=.5*75*36;
  for(let i=0;i<Math.round(3/dt);i++){f.tick(dt);const energy=.5*75*(f.player.velocity.x-4)**2;assert.ok(energy<=prior+1e-8,`dt=${dt} relative energy ${energy} > ${prior}`);assert.ok(f.player.velocity.x>=4-1e-9);prior=energy;}
  assert.ok(prior<30,`remaining energy ${prior}`);
 }
});
test('Voluntary input cannot cancel a strong cross-current and total acceleration remains bounded',()=>{
 const f=fixture({ground:-20,mode:'swim',current:[12,0]});f.keys.add('KeyW');f.keys.add('ShiftLeft');let maxAcceleration=0;
 for(let i=0;i<300;i++){const before=f.player.velocity.clone();f.tick();maxAcceleration=Math.max(maxAcceleration,f.player.velocity.clone().sub(before).length()*60);assert.ok(Number.isFinite(f.player.position.lengthSq()));}
 assert.ok(f.player.position.x>35,`cross-current displacement ${f.player.position.x}`);assert.ok(f.player.velocity.x>10);assert.ok(f.player.velocity.z<-.2,'voluntary stroke must still act');assert.ok(maxAcceleration<=52.501,`shared 45 plus explicit 7.5 acceleration budget: ${maxAcceleration}`);
});
test('The swimmer receives real shared wind and uses its total velocity in air drag',()=>{
 const run=velocity=>{const f=fixture({ground:-20,mode:'swim',wind:[80,0]});f.player.velocity.x=velocity;f.tick();return f.player.velocity.x-velocity;};
 assert.ok(run(0)>.05,'wind acts on the swimmer');assert.ok(run(10)<run(0),'full body velocity reduces relative air speed');
});
test('A co-moving passive swimmer has zero relative-fluid acceleration and calm cruise converges across timesteps',()=>{
 const same=fixture({ground:-20,mode:'swim',current:[4,-2],wind:[4,-2]});same.player.velocity.set(4,0,-2);same.run(1);
 assert.ok(same.player.velocity.distanceTo(new Vector3(4,0,-2))<1e-10);
 const speeds=[];for(const dt of [1/120,1/60,1/30,.1]){const f=fixture({ground:-20,mode:'swim'});f.keys.add('KeyW');f.keys.add('ShiftLeft');f.run(8,dt);speeds.push(-f.player.velocity.z);assert.ok(f.player.swimMotor.maxAcceleration<=7.500001);}
 assert.ok(Math.max(...speeds)-Math.min(...speeds)<.01,`timestep terminal speeds ${speeds}`);
});
test('Invalid or paused frame times do not move or corrupt the player',()=>{
 const f=fixture({ground:-20,mode:'swim',current:[4,0]});const before=f.player.position.clone();
 for(const dt of [0,-1,NaN,Infinity]){f.player.update(dt);assert.equal(f.player.position.distanceTo(before),0);assert.ok(Number.isFinite(f.player.waterMean));}
});

import {readFile} from 'node:fs/promises';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {loadModel} from '../src/rally/VehicleModel.js';
import {GliderBody} from '../src/glider/GliderBody.js';
test('A strong real updraft releases surface control to the actual articulated player using inherited momentum',async()=>{
 const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url)),write=StorageBuffer.prototype.write;
 StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 try{
  const f=fixture({ground:-20,mode:'swim'}),model=new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
  f.player.avatar={model,group:model.group,idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1}};model.group.position.copy(f.player.position);model.group.position.y-=1.458;
  f.player.velocity.set(1,0,-1);const e=f.field.start('tornado',{x:0,z:0,intensity:120,radius:100,speed:0});e.time=2;
  f.tick();assert.equal(f.player.mode,'ragdoll');assert.equal(f.player.ragFrom,'swim');assert.equal(f.player.rag.disasterField,f.field);assert.equal(f.player.rag.bodies.length,14);assert.equal(f.player.rag.bodies.reduce((m,b)=>m+b.m,0),75);
  for(const b of f.player.rag.bodies){assert.ok(new Vector3(b.v.x,b.v.y,b.v.z).distanceTo(f.player.velocity)<1e-10,'handoff must inherit velocity without a launch impulse');assert.deepEqual(b.w,{x:0,y:0,z:0});}
  const before=f.player.rag.bodies.map(b=>({...b.x}));f.player.rag.simulate(1/60);assert.ok(f.player.rag.bodies.some((b,i)=>Math.hypot(b.x.x-before[i].x,b.x.y-before[i].y,b.x.z-before[i].z)>.005));assert.ok(f.player.rag.bodies.every(b=>Number.isFinite(b.x.x+b.x.y+b.x.z+b.v.x+b.v.y+b.v.z)));
 }finally{StorageBuffer.prototype.write=write;}
});

test('Production disaster Restore rejects the pending crest readback and restores transition state for a repeat event',()=>{
 const f=fixture({ground:2.5}),p=f.player,q=p.query;q.version=10;p.waterH=0;p.waterMean=0;p.floating=true;
 const body=()=>({position:new Vector3(),quaternion:{clone(){return this;},copy(){}},velocity:new Vector3(),angular:new Vector3(),pose(){}});
 const owner=Object.create(Disasters.prototype),app={player:p,people:{list:[],contact:{wet:new Set()}},boatCtl:body(),jetskis:{ctl:body(),skis:[]},ferry:{ship:body()},camera:p.camera,cameraCut(){},rally:{physics:{disaster_car_state:()=>[],restore_disaster_car(){},set_disaster_loads(){}},damage:{captureDisasterState:()=>({}),restoreDisasterState(){}},syncModel(){},refreshIslandColliders(){}}};
 Object.assign(owner,{app,field:f.field,external:new Set(),vesselSnapshots:null,propSnapshots:new Map(),changedPeople:new Map(),touched:new Set(),water:{update(){}},siren:{stop(){}},tornadoVisuals:{clear(){}},humanContacts:{reset(){}},structures:{reset(){}},bodies:{reset(){}},refresh(){}});
 owner.capture();p.mode='swim';p.position.y=8;p.waterH=8;p.waterMean=7;p.floating=false;p.grounded=false;q.cpu[0]=8;
 owner.reset();
 // One already-issued GPU readback still describes the removed crest. Only the
 // next post-reset result may replace the restored baseline at this player slot.
 for(const version of [10,11]){q.version=version;p.update(1/60);assert.equal(p.mode,'walk',`stale GPU version ${version} must not reflood the restored body`);assert.ok(Math.abs(p.position.y-2.5)<.01);}
 q.version=12;q.cpu[0]=0;p.update(1/60);assert.equal(p.mode,'walk');assert.equal(p.waterMean,0);assert.equal(p.floating,true);
 owner.capture();q.version=13;q.cpu[0]=8;p.update(1/60);assert.equal(p.mode,'swim','a fresh subsequent crest must still be received');owner.reset();q.version=15;q.cpu[0]=0;p.update(1/60);assert.equal(p.mode,'walk');
});

test('The ordinary swimmer resolves contact against the actual floating glider sail through Player.update',async()=>{
 const bytes=await readFile(new URL('../public/glider/glider.glb',import.meta.url));
 const model=await loadModel(`data:model/gltf-binary;base64,${bytes.toString('base64')}`);
 const flight={position:[0,0,0],quaternion:[0,0,0,1],velocity:[.4,0,.2],omega:[0,0,0],phase:'ditched'};
 const body=new GliderBody(model.root,flight),f=fixture({ground:-20,mode:'swim'}),p=f.player;
 assert.ok(body.triangles.length>1000,'collision must use the real authored sail, not a substitute test plane');
 // True capsule feet are1.458m below the swim float anchor. This is a contact
 // initial condition beneath the actual cambered sail; update owns the response.
 p.position.set(0,-.95+1.458,0);p.velocity.set(0,1,0);p.obstacleProviders ||= new Set();p.obstacleProviders.add(body);
 const before=p.position.clone();f.tick();
 assert.ok(p.position.y<.1,`swimmer remained inside the sail: float anchor y=${p.position.y}`);
 assert.ok(p.position.distanceTo(before)<.75,'local depenetration cannot throw the swimmer away from the wreck');
 assert.ok(body.contacts>0,'Player.update must reach the actual moving obstacle response');
 const c=body.lastContact,relative=p.velocity.clone().sub(new Vector3(...c.bodyVelocity));
 assert.ok(relative.dot(new Vector3(...c.normal))>=-1e-8,'contact removes inward normal motion relative to the wreck');
 assert.equal(p.mode,'swim');assert.ok([...p.position.toArray(),...p.velocity.toArray()].every(Number.isFinite));
 const far=fixture({ground:-20,mode:'swim'});far.player.position.set(100,-.062,0);far.player.obstacleProviders ||= new Set();far.player.obstacleProviders.add(body);
 far.keys.add('KeyW');far.run(3);assert.ok(far.player.position.z<-3,'a finite sail must not block unrelated open water');
 assert.ok(Math.abs(far.player.position.y+.062)<.02,'ordinary calm surface control is unchanged away from contact');
});

async function rigged(options){
 const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url));
 const f=fixture(options),model=new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
 f.player.avatar={model,group:model.group,idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1},stepPhase:()=>null};model.group.position.copy(f.player.position);
 return f;
}
test('Walking and sprinting through calm shallow sea keeps the actual walker on his feet and moving',async()=>{
 const write=StorageBuffer.prototype.write;StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 try{
  // depth (m) of still sea over flat seabed, sprint held: knee-ish wade, the 16 cm and 4-6 cm cases
  // from the diagnosis, and a deep sprint where his own drag is far past the old line.
  for(const [depth,sprint] of [[.3,false],[.16,false],[.06,true],[.4,true]]){
   const f=await rigged({ground:-depth});f.keys.add('KeyW');if(sprint)f.keys.add('ShiftLeft');
   const start=f.player.position.clone(),modes=new Set();let selfDrag=0;
   for(let i=0;i<120;i++){f.tick(1/60);modes.add(f.player.mode);if(f.player.walkLoad)selfDrag=Math.max(selfDrag,Math.hypot(f.player.walkLoad.ax,f.player.walkLoad.az));}
   const label=`${depth} m ${sprint?'sprint':'walk'}`,moved=Math.hypot(f.player.position.x-start.x,f.player.position.z-start.z);
   assert.deepEqual([...modes],['walk'],`${label}: modes ${[...modes]}, own wading drag peaked at ${selfDrag.toFixed(2)} m/s² with no current or wind`);
   assert.ok(moved>3,`${label}: moved ${moved.toFixed(2)} m in 2 s holding W`);
   assert.ok(selfDrag>.5,`${label}: the real wading drag still slows him (${selfDrag.toFixed(2)} m/s²)`);
  }
 }finally{StorageBuffer.prototype.write=write;}
});
test('A 2 m/s current at 0.6 m still knocks the standing walker into the articulated body',async()=>{
 const write=StorageBuffer.prototype.write;StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 try{
  const f=await rigged({ground:-.6,current:[2,0]});let at=-1;
  for(let i=0;i<60&&at<0;i++){f.tick(1/60);if(f.player.mode==='ragdoll')at=i;}
  assert.ok(at>=0,`a 2 m/s current over 0.6 m must trip him inside 1 s (mode ${f.player.mode})`);
  assert.equal(f.player.ragFrom,'walk');assert.equal(f.player.rag.disasterField,f.field);
 }finally{StorageBuffer.prototype.write=write;}
});
