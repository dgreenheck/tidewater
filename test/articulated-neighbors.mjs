import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const [{Tumbles},{Colliders},{Vector3},{parseGLB},{SkinnedModel},{StorageBuffer}]=await Promise.all(['people/Tumble.js','world/Colliders.js','engine/index.js','engine/loaders/GLTF.js','engine/render/Skinning.js','engine/gpu/Texture.js'].map(p=>import(root+'/src/'+p)));
StorageBuffer.prototype.write=function(){};const V=(...v)=>new Vector3(...v),load=async p=>{const b=await readFile(root+'/public/models/'+p+'.glb');return new SkinnedModel(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));};
test('Eight actual articulated people collide and complete natural recovery without emergency guards',async t=>{
const hub={app:{player:{terrain:{heightAt:()=>0},colliders:new Colliders(),avatar:{model:await load('characters/player')}}},list:[]},manager=new Tumbles(hub),rigs=[];
for(const [i,cast] of ['f01','m01','f03','m04','f06','m07','f09','m10'].entries()){
 const model=await load('characters/crowd/swim/'+cast);model.play('idle_neutral_01',{fade:0});model.update(0);const p={id:i,model,clipOf:k=>k==='idle'?'idle_neutral_01':k,brain:{type:'adult'},group:{position:V(i%2?.55:-.55,0,Math.floor(i/2)*5)},world:V(),yaw:0},r=manager.start(p,V(i%2?-3:3,0,0),null,null);p.knock={rag:r};hub.list.push(p);rigs.push(r.rd);
}
const energy=()=>rigs.reduce((s,r)=>s+r.kineticEnergy()+r.bodies.reduce((e,b)=>e+b.m*9.81*b.x.y,0),0);let collisions=0,maxSpin=0,maxE=0,initialE=energy(),maxGap=0,maxPen=0;
for(let frame=0;frame<600;frame++){
 for(const p of manager.live){const r=p.knock.rag;r.rd.update(1/60);if(r.rd.phase==='done')manager.end(p,r);}
 manager.collide(1/60);collisions+=manager.contacts.people;maxPen=Math.max(maxPen,manager.contacts.maxPenetration);maxE=Math.max(maxE,energy());for(const r of rigs)for(const b of r.bodies)maxSpin=Math.max(maxSpin,Math.hypot(b.w.x,b.w.y,b.w.z));
 if(!manager.live.size)break;
}
const result={collisions,maxSpin,maxE,initialE,maxPen,remaining:manager.live.size,caps:rigs.reduce((s,r)=>s+r.stats.capped,0),nan:rigs.reduce((s,r)=>s+r.stats.nan,0),phases:rigs.map(r=>r.phase)};
assert.ok(collisions>0);assert.ok(maxSpin<50);assert.ok(maxE<=initialE*1.01);assert.ok(maxPen<.1);assert.equal(result.remaining,0);assert.equal(result.caps,0);assert.equal(result.nan,0);t.diagnostic(JSON.stringify(result));
});
