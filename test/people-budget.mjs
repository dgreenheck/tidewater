// Reproducible CPU cost probe, not a renderer FPS benchmark. Read-only shipped
// crowd GLBs, production14-body rigs and shared field; only GPU writes are a seam.
import {readFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {Tumbles} from '../src/people/Tumble.js';
import {Vector3} from '../src/engine/index.js';
import {Colliders} from '../src/world/Colliders.js';
import {DisasterField} from '../src/disasters/Field.js';

const casts=['f01','m01','f03','m04','f06','m07','f09','m10'];
const assets=new Map();
const load=async path=>{const b=await readFile(new URL(`../public/models/${path}.glb`,import.meta.url));assets.set(path,parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));};
await Promise.all(['characters/player','beach/attendant',...casts.flatMap(c=>[`characters/crowd/${c}`,`characters/crowd/swim/${c}`])].map(load));
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
const model=path=>new SkinnedModel(assets.get(path)),V=(...a)=>new Vector3(...a);
// A representative full population:23 beach swim variants, two clothed fishers,
// one attendant, and all32 ferry bodies. All are adult72kg, as currently cast.
const population=[...Array.from({length:23},(_,i)=>`characters/crowd/swim/${casts[i%8]}`),'characters/crowd/m07','characters/crowd/f06','beach/attendant',...Array.from({length:32},(_,i)=>`characters/crowd/${casts[i%8]}`)];
function fixture({wind=false}={}){
 const terrain={heightAt:()=>0},field=new DisasterField(terrain.heightAt);
 if(wind){const e=field.start('tornado',{x:0,z:0,intensity:120,radius:180,speed:0});e.time=2;}
 const hub={app:{player:{terrain,colliders:new Colliders(),avatar:{model:model('characters/player')}}},list:[]},tumbles=new Tumbles(hub);
 for(const [i,path] of population.entries()){
  const m=model(path);m.play('idle_neutral_01',{fade:0});m.update(0);
  const p={id:i,model:m,clipOf:k=>k==='idle'?'idle_neutral_01':k,brain:{type:'adult'},group:{position:V((i%10)*(wind?3:4)-15,wind?3:0,Math.floor(i/10)*(wind?3:4)-9)},world:V(),yaw:0};
  const r=tumbles.start(p,wind?V():V(3,0,0),null,null);if(!r)throw new Error(`missing articulated body ${i}`);
  if(wind)r.rd.disasterField=field;p.knock={rag:r};hub.list.push(p);
 }
 return {hub,tumbles};
}
function advance(f){
 for(const p of f.tumbles.live){const r=p.knock.rag;r.rd.update(1/60);r.rd.draw(1/60,r.avatar);if(r.rd.phase==='done')f.tumbles.end(p,r);}
 f.tumbles.collide(1/60);
}
function summary(rows){const sorted=[...rows].sort((a,b)=>a-b);return {samples:rows.length,mean:rows.reduce((s,x)=>s+x,0)/rows.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)};}
const active=fixture({wind:true}),rows=[],counts=[],collisionRows=[];
let maxSpin=0,maxPeopleContacts=0;
for(let i=0;i<180;i++){
 const start=performance.now();advance(active);rows.push(performance.now()-start);counts.push(active.tumbles.live.size);collisionRows.push(active.tumbles.contacts.ms);
 maxPeopleContacts=Math.max(maxPeopleContacts,active.tumbles.contacts.people);
 for(const p of active.hub.list)for(const b of p.knock.rag.rd.bodies)maxSpin=Math.max(maxSpin,Math.hypot(b.w.x,b.w.y,b.w.z));
}
const neutral=fixture();let settledSeconds=0;
while(neutral.tumbles.live.size&&settledSeconds<12){advance(neutral);settledSeconds+=1/60;}
const quiet=[];for(let i=0;i<180;i++){const start=performance.now();neutral.tumbles.collide(1/60);quiet.push(performance.now()-start);}
const diagnostics=f=>({solverCaps:f.hub.list.reduce((s,p)=>s+p.knock.rag.rd.stats.capped,0),nonfinite:f.hub.list.reduce((s,p)=>s+p.knock.rag.rd.stats.nan,0)});
console.log(JSON.stringify({
 assumptions:'CPU model only, no renderer or scene walls. Production skeleton pose writes retained with GPU upload replaced by a copy. Active:58 actual cast rigs in a compact3m grid, three seconds of120m/s tornado load, first30frames excluded from timings. Quiet:separate unforced3m/s falls at4m spacing, natural supported settle and complete get-up before releasing rigs; measures only inactive contact manager, not all normal NPC animation/AI.',
 runtime:{node:process.version,cpu:cpus()[0]?.model,arch:process.arch},population:population.length,bodies:population.length*14,joints:population.length*13,assets:[...new Set(population)],
 activeMilliseconds:summary(rows.slice(30)),collisionMilliseconds:summary(collisionRows.slice(30)),activeRigRange:[Math.min(...counts),Math.max(...counts)],maxPeopleContacts,maxSpin,...diagnostics(active),
 naturalRecovery:{seconds:settledSeconds,remaining:neutral.tumbles.live.size,...diagnostics(neutral)},inactiveContactMilliseconds:summary(quiet),
},null,2));
