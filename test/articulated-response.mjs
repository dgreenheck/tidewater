import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {articulatedContact} from '../src/player/JointVelocity.js';
import {articulatedContact as originalContact} from './reference/PreLaptopJointVelocity.js';
import {repairJoint} from './reference/PrePerformanceJointVelocity.js';
import {Tumbles} from '../src/people/Tumble.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3,Quaternion} from '../src/engine/index.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
StorageBuffer.prototype.write=function(){};
const V=(...a)=>new Vector3(...a),load=async path=>{const b=await readFile(new URL('../public/models/'+path+'.glb',import.meta.url));return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const avatar=new SkinnedModel(await load('characters/player'));
function cloneRig(r){const c=Object.assign(Object.create(Object.getPrototypeOf(r)),r);delete c._articulatedMass;c.bodies=r.bodies.map(b=>({...b,x:{...b.x},q:{...b.q},v:{...b.v},w:{...b.w}}));for(const b of c.bodies)b.parent=b.parent?c.bodies[b.parent.index]:null;c.joints=r.joints.map(b=>c.bodies[b.index]);return c;}
function velocities(r){return r.bodies.flatMap(b=>[b.v.x,b.v.y,b.v.z,b.w.x,b.w.y,b.w.z]);}
function poses(r){return r.bodies.flatMap(b=>[b.x.x,b.x.y,b.x.z,b.q.x,b.q.y,b.q.z,b.q.w]);}
function compare(a,b,label,tolerance=1e-9){assert.equal(a.length,b.length);let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));assert.ok(Number.isFinite(error)&&error<tolerance,`${label}: ${error}`);return error;}
async function rig(cast,time,tilt){const model=new SkinnedModel(await load('characters/crowd/swim/'+cast));model.play('gestic_presentation_right_01',{fade:0,from:time});model.update(0);const hub={app:{player:{terrain:{heightAt:()=>-1000},colliders:new Colliders(),avatar:{model:avatar}}}},manager=new Tumbles(hub),p={model,clipOf:()=> 'idle_neutral_01',brain:{type:'adult'},group:{position:V(0,10,0)},yaw:0},r=manager.start(p,V(),null,null).rd;
 if(tilt)for(const b of r.bodies){const q=new Quaternion().setFromAxisAngle(V(.2+b.index*.03,.7,-.3).normalize(),tilt*Math.sin(b.index+.3)).multiply(new Quaternion(b.q.x,b.q.y,b.q.z,b.q.w));Object.assign(b.q,{x:q.x,y:q.y,z:q.z,w:q.w});}
 for(const b of r.bodies){b.v.x=Math.sin(b.index)*2;b.v.y=Math.cos(b.index*.4);b.v.z=Math.sin(b.index*.7);b.w.x=Math.cos(b.index)*3;b.w.y=Math.sin(b.index*.8)*2;b.w.z=Math.cos(b.index*.3);}
 return r;
}
test('Optimized fixed-pose contact response preserves point, pair, release and angular impulses against frozen production solver',async t=>{
 let cases=0,maxError=0;
 for(const cast of ['f01','f09','m01','m10'])for(const time of [0,.7])for(const tilt of [0,1.3])for(const h of [1/120,.1])for(const deferWriteback of [false,true]){
  const initial=await rig(cast,time,tilt),r=cloneRig(initial),reference=cloneRig(initial),fast=articulatedContact(r,{viscosityStep:h,deferWriteback}),old=originalContact(reference,{viscosityStep:h});
  maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'free constrained velocity'));
  const n={x:0,y:1,z:0},ra={x:.07,y:-.12,z:.03},rb={x:-.04,y:.09,z:.05};
  for(let step=0;step<16;step++){
   // Deliberately reuse and mutate the tangent object. It is not a cache key.
   Object.assign(n,V(Math.sin(step+.2),Math.cos(step*.4),Math.sin(step*.7)).normalize());
   const a=r.bodies[3],b=r.bodies[10],A=reference.bodies[3],B=reference.bodies[10];
   maxError=Math.max(maxError,compare([fast.wPos(a,ra,n),fast.pairMass(a,ra,b,rb,n)],[old.wPos(A,ra,n),old.pairMass(A,ra,B,rb,n)],'scalar inverse mass'));
   const magnitude=[0,1.8,-.7,1e-14][step%4],x=n.x*magnitude,y=n.y*magnitude,z=n.z*magnitude;
   fast.impulse(a,ra,x,y,z);old.impulse(A,ra,x,y,z);
   fast.pairImpulse(a,ra,b,rb,-x,-y,-z);old.pairImpulse(A,ra,B,rb,-x,-y,-z);
   // Read the packed state BEFORE publishing: body velocities are intentionally stale here.
   const actual=fast.pointVelocity(a,ra,{}),expected={x:A.v.x+(A.w.y*ra.z-A.w.z*ra.y),y:A.v.y+(A.w.z*ra.x-A.w.x*ra.z),z:A.v.z+(A.w.x*ra.y-A.w.y*ra.x)};
   maxError=Math.max(maxError,compare([actual.x,actual.y,actual.z],[expected.x,expected.y,expected.z],'packed point velocity'));
   const relative=(B.v.x+(B.w.y*rb.z-B.w.z*rb.y)-A.v.x-(A.w.y*ra.z-A.w.z*ra.y))*n.x+(B.v.y+(B.w.z*rb.x-B.w.x*rb.z)-A.v.y-(A.w.z*ra.x-A.w.x*ra.z))*n.y+(B.v.z+(B.w.x*rb.y-B.w.y*rb.x)-A.v.z-(A.w.x*ra.y-A.w.y*ra.x))*n.z;
   maxError=Math.max(maxError,compare([fast.relativeSpeed(a,ra,b,rb,n)],[relative],'packed relative speed'));
   fast.writeback();maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'complete coupled impulse'));
   for(let iteration=0;iteration<8;iteration++){
    maxError=Math.max(maxError,compare([fast.limits(h)],[old.limits(h)],'angular release'));
    // Alternate normal deferred batches with batches that publish to an observer.
    if(step%2){fast.writeback();maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'observed angular velocity'));}
   }
   fast.writeback();maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'complete deferred angular batch'));
  }
  // Body-based wall response is imported before the final angular solve.
  r.bodies[5].v.x-=.03;reference.bodies[5].v.x-=.03;if(deferWriteback)fast.readBodies();
  maxError=Math.max(maxError,compare([fast.limits(h)],[old.limits(h)],'wall velocity import'));fast.writeback();
  maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'post-wall velocity'));
  maxError=Math.max(maxError,compare([fast.report().anchorResidual],[old.report().anchorResidual],'anchor residual'));
  // A new fixed pose/contact instance must discard every response cache.
  for(const target of [r,reference])for(const b of target.bodies){b.x.x+=.11*Math.sin(b.index);b.x.y+=.02;}
  const f2=articulatedContact(r,{viscosityStep:h*.4}),o2=originalContact(reference,{viscosityStep:h*.4});ra.x=-.14;rb.y=.13;
  maxError=Math.max(maxError,compare([f2.pairMass(r.bodies[3],ra,r.bodies[10],rb,n)],[o2.pairMass(reference.bodies[3],ra,reference.bodies[10],rb,n)],'new pose cache'));
  maxError=Math.max(maxError,compare(velocities(r),velocities(reference),'new pose velocity'));cases++;
 }
 assert.equal(cases,64);t.diagnostic(JSON.stringify({cases,maxError}));
});
test('Joint-coordinate reuse is invalidated by anchor and earlier angular repairs',async t=>{
 let cases=0,maxError=0;
 for(const cast of ['f01','f09','m01','m10'])for(const tilt of [0,.6,1.3])for(const anchors of [false,true]){
  const initial=await rig(cast,.7,tilt),r=cloneRig(initial),reference=cloneRig(initial);
  for(let pass=0;pass<3;pass++)for(let i=0;i<r.joints.length;i++){
   r.solveJoint(r.joints[i],anchors);repairJoint.call(reference,reference.joints[i],anchors);
   maxError=Math.max(maxError,compare(poses(r),poses(reference),'sequential geometric repair',1e-12));
  }cases++;
 }
 assert.equal(cases,24);t.diagnostic(JSON.stringify({cases,maxError}));
});
