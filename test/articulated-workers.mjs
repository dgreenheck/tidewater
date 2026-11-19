import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import {Player} from '../src/player/Player.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {Colliders} from '../src/world/Colliders.js';
import {DisasterField} from '../src/disasters/Field.js';
import {Vector3,PerspectiveCamera} from '../src/engine/index.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {captureRig,captureTerrain,captureField,runRigJob,poseStamp,applyRigResult,terrainReader,restoreRig} from '../src/player/workers/RigSnapshot.js';
import {RagdollPool} from '../src/player/workers/RagdollPool.js';
import {applyWakeToAir} from '../src/windfarm/Wake.js';
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url));
const source=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const terrain=new TerrainData();
function fixture(x=40){
 const model=new SkinnedModel(source),player=new Player({camera:new PerspectiveCamera(),input:{down:()=>false,hit:()=>false},terrain,colliders:new Colliders(),query:{allocate:()=>0}});
 model.play('idle',{fade:0});model.update(0);player.position.set(x,terrain.heightAt(x,-115),-115);model.group.position.copy(player.position);player.avatar={model,group:model.group,idle:model.layers[0]};
 player.colliders.addBox(new Vector3(x+.7,player.position.y+.1,-115),new Vector3(.3,.2,2),.3,{walkable:true});
 const field=new DisasterField((x,z)=>terrain.heightAt(x,z));field.start('tornado',{x:10,z:-115,intensity:100,radius:180,speed:0,duration:40});field.events.get('tornado').time=1.2;
 const sources=[{id:1,x:-100,z:-115,baseY:-90,flowX:1,flowZ:0,ct:.7,damaged:false}],bounds={minX:-200,maxX:1000,minZ:-300,maxZ:100};
 field.registerAirModifier((x,y,z,air)=>applyWakeToAir(air,x,y,z,sources,3),bounds,()=>({kind:'windfarm',sources,time:3}));
 assert.equal(player.ragdoll(null,null,{velocity:new Vector3(2,-1,3),spin:new Vector3(1,0,2)}),true);const rig=player.rag;rig.player.reef=null;rig.disasterField=field;
 return {player,rig,field,person:{knock:{rag:{rd:rig}}}};
}
function job(rig,dt){const {state,near}=captureRig(rig,dt);return {job:{id:0,dt,state,terrain:captureTerrain(terrain,rig),field:true},near};}
test('Worker snapshot consumes exactly the serial adaptive interval on real terrain, water, joints and walls',()=>{
 const {rig,field}=fixture();
 for(const dt of [1/60,.1,1/30,.075]){
  field.advance(dt);const captured=job(rig,dt),result=runRigJob(captured.job,structuredClone(captureField(field)));
  rig.simulate(dt);
  assert.deepEqual(result.bodies.map(b=>[b.x,b.q,b.v,b.w]),rig.bodies.map(b=>[b.x,b.q,b.v,b.w]));
  assert.deepEqual(result.stats,rig.stats);assert.equal(result.values.nearT,rig.nearT);assert.equal(result.values.supported,rig.supported);
  applyRigResult(rig,result,captured.near);assert.ok(rig.joints.every(b=>rig.bodies.includes(b.parent)));
 }
});
test('Terrain snapshot preserves original interpolation and rejects out-of-tile work',()=>{
 const {rig}=fixture(),tile=captureTerrain(terrain,rig),sample=terrainReader(tile);
 for(let i=0;i<500;i++){const x=40+Math.sin(i)*50,z=-115+Math.cos(i*1.3)*50;assert.equal(sample(x,z),terrain.heightAt(x,z));}
 assert.throws(()=>sample(500,500),/rig-terrain-tile/);
});
test('Air-only samples outside the water and tornado domain still enter worker exclusion bounds',()=>{
 const {rig,field}=fixture(),state=captureRig(rig,.03).state,snapshot=captureField(field),visited=[];
 snapshot.events=[];snapshot.water=null;snapshot.modifiers=[];
 const restored=restoreRig(state,()=>{throw Error('Unneeded terrain query');},snapshot,(x,z)=>visited.push([x,z]));
 const out={};assert.equal(restored.disasterField.sample(9000,10,8000,out),out);assert.deepEqual(visited,[[9000,8000]]);
});
class BrowserWorker {
 constructor(){
  const script=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:m=>parentPort.postMessage(m)};await import(${JSON.stringify(new URL('../src/player/workers/RagdollWorker.js',import.meta.url).href)});parentPort.on('message',data=>self.onmessage({data}));`;
  this.node=new NodeWorker(new URL('data:text/javascript,'+encodeURIComponent(script)),{type:'module'});this.listeners=new Map();
 }
 addEventListener(type,fn){const f=type==='message'?data=>fn({data}):error=>fn({message:error.message});this.listeners.set(fn,f);this.node.on(type,f);}
 removeEventListener(type,fn){this.node.off(type,this.listeners.get(fn));this.listeners.delete(fn);}
 postMessage(message){this.node.postMessage(message);}
 terminate(){this.node.terminate();}
}
test('Actual workers publish only at the barrier; intervening impulse rejects the stale result',async()=>{
 const fixtures=[fixture(40),fixture(44)],field=fixtures[0].field;
 for(const f of fixtures)f.rig.disasterField=field;
 const pool=new RagdollPool({size:2,createWorker:()=>new BrowserWorker(),timeout:5000});
 try{
  const before=fixtures.map(f=>poseStamp(f.rig)),pending=pool.prepare(fixtures.map(f=>f.person),.05,field);
  assert.ok(pending);assert.deepEqual(fixtures.map(f=>poseStamp(f.rig)),before,'dispatch cannot mutate owned bodies');
  await pending;assert.deepEqual(fixtures.map(f=>poseStamp(f.rig)),before,'completed jobs remain speculative');
  fixtures[1].rig.bodies[0].v.x+=2;
  for(const f of fixtures)f.rig.update(.05);
  assert.equal(pool.stats.accepted,1);assert.equal(pool.stats.fallback,1);
  for(const f of fixtures)assert.ok(Math.abs(f.rig.stats.consumedTime-.05)<1e-10);
 }finally{for(const w of pool.workers)w.terminate();}
});
test('Moving support and bounded air wake queries fall back without losing a step',async()=>{
 const fixtures=[fixture(40),fixture(44)],field=fixtures[0].field;
 for(const f of fixtures){f.rig.disasterField=field;f.rig.player.groundProviders=new Set([{simulationBounds:()=>({minX:0,maxX:100,minZ:-200,maxZ:0}),groundHeightAt:()=>-Infinity,resolveCapsule:()=>false}]);}
 const pool=new RagdollPool({size:2,createWorker:()=>new BrowserWorker(),timeout:5000});
 try{assert.equal(pool.prepare(fixtures.map(f=>f.person),.03,field),null);assert.equal(pool.stats.dispatched,0);for(const f of fixtures){f.rig.update(.03);assert.ok(Math.abs(f.rig.stats.consumedTime-.03)<1e-10);}}
 finally{for(const w of pool.workers)w.terminate();}
});
test('Worker failure disables offload and preserves serial physics',async()=>{
 const fixtures=[fixture(40),fixture(44)],pool=new RagdollPool({createWorker:()=>{throw new Error('worker unavailable');}});
 assert.equal(pool.prepare(fixtures.map(f=>f.person),.03,fixtures[0].field),null);assert.equal(pool.disabled,true);assert.equal(pool.stats.failures,1);
 for(const f of fixtures){f.rig.update(.03);assert.ok(Math.abs(f.rig.stats.consumedTime-.03)<1e-10);}
});
