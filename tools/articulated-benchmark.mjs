// Focused CPU probe, not renderer FPS. Interleaves the exact frozen production
// baseline with this checkout using the same shipped 14-body cast rigs.
// Run only while browser performance measurements are paused.
import {readFile} from 'node:fs/promises';
import {cpus} from 'node:os';
import {ArticulatedMass} from '../src/player/ArticulatedMass.js';
import {articulatedContact,jointCoordinates} from '../src/player/JointVelocity.js';
import {ArticulatedMass as OriginalMass} from '../test/reference/PreLaptopArticulatedMass.js';
import {articulatedContact as originalContact,jointCoordinates as originalCoordinates} from '../test/reference/PreLaptopJointVelocity.js';
import {Tumbles} from '../src/people/Tumble.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3,Quaternion} from '../src/engine/index.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
StorageBuffer.prototype.write=function(){};
const load=async path=>{const b=await readFile(new URL('../public/models/'+path+'.glb',import.meta.url));return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const avatar=new SkinnedModel(await load('characters/player')),fixtures=[];
for(const cast of ['f01','f09','m01','m10']){
 const model=new SkinnedModel(await load('characters/crowd/swim/'+cast));model.play('gestic_presentation_right_01',{fade:0,from:.7});model.update(0);
 const manager=new Tumbles({app:{player:{terrain:{heightAt:()=>-1000},colliders:new Colliders(),avatar:{model:avatar}}}});
 const r=manager.start({model,clipOf:()=> 'idle_neutral_01',brain:{type:'adult'},group:{position:new Vector3(0,10,0)},yaw:0},new Vector3(),null,null).rd;
 for(const b of r.bodies){const q=new Quaternion().setFromAxisAngle(new Vector3(.2+b.index*.03,.7,-.3).normalize(),1.3*Math.sin(b.index+.3)).multiply(new Quaternion(b.q.x,b.q.y,b.q.z,b.q.w));Object.assign(b.q,{x:q.x,y:q.y,z:q.z,w:q.w});}
 fixtures.push(r);
}
function reset(r){for(const b of r.bodies){b.v.x=Math.sin(b.index)*20;b.v.y=Math.cos(b.index*.4)*10;b.v.z=Math.sin(b.index*.7)*10;b.w.x=Math.cos(b.index)*30;b.w.y=Math.sin(b.index*.8)*20;b.w.z=Math.cos(b.index*.3)*10;}}
function clone(r){const c={...r,bodies:r.bodies.map(b=>({...b,v:{...b.v},w:{...b.w}}))};for(const b of c.bodies)b.parent=b.parent?c.bodies[b.parent.index]:null;c.joints=c.bodies.filter(b=>b.parent);delete c._articulatedMass;return c;}
const variants=[{name:'before',Mass:OriginalMass,contact:originalContact,coordinates:originalCoordinates},{name:'after',Mass:ArticulatedMass,contact:articulatedContact,coordinates:jointCoordinates}];
let checksum=0;
const workloads=variants.map(({name,Mass,contact,coordinates})=>{
 const rigs=fixtures.map(clone),factors=rigs.map(r=>new Mass(r,1/120)),N=rigs[0].bodies.length*6;
 const sources=Array.from({length:14},(_,branch)=>{const f=new Float64Array(3*N);for(let axis=0;axis<3;axis++){f[axis*N+branch*6+axis]=1;f[axis*N+branch*6+3+(axis+1)%3]=.07;f[axis*N+branch*6+3+(axis+2)%3]=-.13;}return f;});
 const points=Array.from({length:6},(_,i)=>({index:[3,5,7,10,12,13][i],r:{x:.04*Math.sin(i),y:-.12,z:.03*Math.cos(i)}}));
 const n={x:0,y:1,z:0},t={x:.8,y:0,z:.6};
 return {name,
  sparseResponse(i){const branch=i%14;checksum+=factors[i%4].solve3(sources[branch],branch)[0][0];},
  coordinates(i){const r=rigs[i%4];for(const c of r.joints)checksum+=coordinates(c.parent,c)[0].angle;},
  coupledPass(i){const r=rigs[i%4];reset(r);const response=contact(r,{viscosityStep:1/120,deferWriteback:true});
   for(let iteration=0;iteration<8;iteration++){
    checksum+=response.limits(1/120);
    for(const p of points){const b=r.bodies[p.index];checksum+=response.wPos(b,p.r,n)+response.wPos(b,p.r,t);const J=(iteration%2?-.2:.3);response.impulse(b,p.r,.1*J,J,-.07*J);}
    const a=r.bodies[5],b=r.bodies[10],ra=points[1].r,rb=points[3].r;checksum+=response.pairMass(a,ra,b,rb,n);response.pairImpulse(a,ra,b,rb,0,iteration%2?-.02:.03,0);
   }
   response.writeback();checksum+=r.bodies[0].v.x;
  },
 };
});
const sampleMs=Number(process.env.ARTICULATED_SAMPLE_MS||300),rounds=Number(process.env.ARTICULATED_ROUNDS||7),results={};
function measure(fn,ms){let count=0;const start=performance.now();do{for(let j=0;j<64;j++)fn(count++);}while(performance.now()-start<ms);return {operations:count,milliseconds:performance.now()-start};}
for(const name of ['sparseResponse','coordinates','coupledPass']){
 for(const w of workloads)measure(w[name],150);
 const rows=[];
 for(let round=0;round<rounds;round++)for(const i of round%2?[1,0]:[0,1]){const w=workloads[i];rows.push({round,variant:w.name,...measure(w[name],sampleMs)});}
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 const before=median(rows.filter(r=>r.variant==='before').map(r=>r.milliseconds/r.operations*1000)),after=median(rows.filter(r=>r.variant==='after').map(r=>r.milliseconds/r.operations*1000));
 results[name]={beforeMicroseconds:before,afterMicroseconds:after,speedup:before/after,reductionPercent:(1-after/before)*100,rows};
}
console.log(JSON.stringify({description:'Interleaved fixed-pose CPU microbenchmark; four shipped cast rigs, 14 bodies/13 joints; identical eight-iteration coupled batches. No renderer or world-query cost is included.',runtime:{node:process.version,cpu:cpus()[0]?.model,arch:process.arch},sampleMs,rounds,checksum,results},null,2));
