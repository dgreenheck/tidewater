import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const [{ArticulatedMass},{articulatedContact},{Tumbles},{Colliders},{Vector3,Quaternion},{parseGLB},{SkinnedModel},{StorageBuffer}]=await Promise.all(['player/ArticulatedMass.js','../test/reference/DenseJointVelocity.js','people/Tumble.js','world/Colliders.js','engine/index.js','engine/loaders/GLTF.js','engine/render/Skinning.js','engine/gpu/Texture.js'].map(p=>import(root+'/src/'+p)));
StorageBuffer.prototype.write=function(){};
const V=(...a)=>new Vector3(...a),parse=b=>parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const player=new SkinnedModel(parse(await readFile(root+'/public/models/characters/player.glb'))),rows=[];
const casts=['f01','f03','f06','f09','m01','m04','m07','m10'];
const readV=r=>Float64Array.from(r.bodies.flatMap(b=>[b.v.x,b.v.y,b.v.z,b.w.x,b.w.y,b.w.z]));
const writeV=(r,v)=>r.bodies.forEach((b,i)=>{b.v.x=v[i*6];b.v.y=v[i*6+1];b.v.z=v[i*6+2];b.w.x=v[i*6+3];b.w.y=v[i*6+4];b.w.z=v[i*6+5];});
const maxDiff=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
const kinetic=(r,v)=>r.bodies.reduce((E,b,i)=>{const k=i*6,w=V(v[k+3],v[k+4],v[k+5]),ax=V(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),d=w.dot(ax);return E+.5*b.m*(v[k]**2+v[k+1]**2+v[k+2]**2)+.5*((w.lengthSq()-d*d)/b.iPerp+d*d/b.iAx);},0);
const momentum=(r,v)=>{const P=V(),L=V();for(const b of r.bodies){const k=b.index*6,p=V(v[k],v[k+1],v[k+2]).multiplyScalar(b.m),w=V(v[k+3],v[k+4],v[k+5]),ax=V(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),d=w.dot(ax),spin=w.clone().multiplyScalar(1/b.iPerp).addScaledVector(ax,d*(1/b.iAx-1/b.iPerp));P.add(p);L.add(V(b.x.x,b.x.y,b.x.z).cross(p)).add(spin);}return {P,L};};
test('Articulated tree factor matches the preserved dense mass/viscosity/anchor solve for every unit wrench',async t=>{
for(const cast of casts){
 const source=parse(await readFile(root+'/public/models/characters/crowd/swim/'+cast+'.glb'));
 for(const time of [0,.7])for(const rotated of [false,true]){
  const m=new SkinnedModel(source);m.play('gestic_presentation_right_01',{fade:0,from:time});m.update(0);
  const hub={app:{player:{terrain:{heightAt:()=>-1000},colliders:new Colliders(),avatar:{model:player}}}},t=new Tumbles(hub),p={model:m,clipOf:()=> 'idle_neutral_01',brain:{type:'adult'},group:{position:V(0,10,0)},yaw:0};
  const r=t.start(p,V(),null,null).rd;if(rotated){const Q=new Quaternion().setFromAxisAngle(V(.3,.7,-.4).normalize(),1.1);for(const b of r.bodies){const q=Q.clone().multiply(new Quaternion(b.q.x,b.q.y,b.q.z,b.q.w)),x=V(b.x.x,b.x.y,b.x.z).applyQuaternion(Q);Object.assign(b.q,{x:q.x,y:q.y,z:q.z,w:q.w});Object.assign(b.x,{x:x.x,y:x.y,z:x.z});}}
  for(const h of [1/360,1/120,.1])for(const c of [0,1]){
   const old=Float64Array.from({length:r.bodies.length*6},(_,i)=>Math.sin(i*.63)*3+Math.cos(i*.21));writeV(r,old);
   const tree=new ArticulatedMass(r,h*c),f=tree.momentum(),fast=tree.solve(f),dense=articulatedContact(r,{viscosityStep:h*c}),reference=readV(r);let error=maxDiff(fast,reference),pointError=0,batchError=0;
   const energyBefore=kinetic(r,old),energyAfter=kinetic(r,fast),delta=Float64Array.from(fast,(x,i)=>x-old[i]);let loss=0;
   for(const b of r.joints){const k=b.index*6+3,j=b.parent.index*6+3;for(let a=0;a<3;a++)loss+=h*c*(fast[k+a]-fast[j+a])**2;}
   const before=momentum(r,old),after=momentum(r,fast),Perror=after.P.distanceTo(before.P),Lerror=after.L.distanceTo(before.L);
   let batch;
   for(const body of r.bodies)for(let axis=0;axis<6;axis++){
    if(axis%3===0){const forces=new Float64Array(old.length*3);for(let column=0;column<3;column++)forces[column*old.length+body.index*6+axis+column]=1;batch=tree.solve3(forces);
     for(let column=0;column<3;column++)assert.deepEqual(batch[column],tree.solve(forces.subarray(column*old.length,(column+1)*old.length)),'batched axes preserve the scalar solve exactly');
     const saved=batch.map(v=>Float64Array.from(v));forces.fill(0);tree.solve3(forces);for(let column=0;column<3;column++)assert.deepEqual(batch[column],saved[column],'a later solve must not overwrite cached response columns');
    }
    writeV(r,new Float64Array(old.length));const force=new Float64Array(old.length);force[body.index*6+axis]=1;
    if(axis<3){const n=[0,0,0];n[axis]=1;dense.impulse(body,{x:0,y:0,z:0},...n);}
    else {const n=[0,0,0],point=[0,0,0];point[(axis-3+1)%3]=1;n[(axis-3+2)%3]=.5;dense.impulse(body,{x:point[0],y:point[1],z:point[2]},...n);dense.impulse(body,{x:-point[0],y:-point[1],z:-point[2]},...n.map(x=>-x));}
    pointError=Math.max(pointError,maxDiff(tree.solve(force),readV(r)));batchError=Math.max(batchError,maxDiff(batch[axis%3],readV(r)));
   }
   const common=new Float64Array(old.length),omega=V(.4,-.2,.7);for(const b of r.bodies){const v=V(1,-2,3).add(omega.clone().cross(V(b.x.x,b.x.y,b.x.z)));common.set([...v.toArray(),...omega.toArray()],b.index*6);}writeV(r,common);const rigidError=maxDiff(tree.solve(tree.momentum()),common);
   rows.push({cast,time,rotated,h,c,baseError:error,pointError,batchError,rigidError,Perror,Lerror,energyBefore,energyAfter,backwardEulerResidual:energyAfter-energyBefore+kinetic(r,delta)+loss});
  }
 }
}
const summary={cases:rows.length,maxBase:Math.max(...rows.map(r=>r.baseError)),maxPoint:Math.max(...rows.map(r=>r.pointError)),maxBatch:Math.max(...rows.map(r=>r.batchError)),maxRigid:Math.max(...rows.map(r=>r.rigidError)),maxP:Math.max(...rows.map(r=>r.Perror)),maxL:Math.max(...rows.map(r=>r.Lerror)),maxWorkResidual:Math.max(...rows.map(r=>Math.abs(r.backwardEulerResidual))),maxEnergyGain:Math.max(...rows.map(r=>r.energyAfter-r.energyBefore))};
assert.equal(summary.cases,192);assert.ok(summary.maxBase<1e-8);assert.ok(summary.maxPoint<1e-8);assert.ok(summary.maxBatch<1e-8);assert.ok(summary.maxRigid<1e-8);
assert.ok(summary.maxP<1e-8);assert.ok(summary.maxL<1e-8);assert.ok(summary.maxWorkResidual<1e-8);assert.ok(summary.maxEnergyGain<=1e-8);
t.diagnostic(JSON.stringify(summary));
});
