import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedMass} from '../src/player/ArticulatedMass.js';
import {ArticulatedMass as OriginalMass} from './reference/PreLaptopArticulatedMass.js';

// Branched, non-axis-aligned fixtures exercise both sparse ancestor paths and
// simultaneous loads on unrelated branches. Full cast/dense physics coverage
// remains in articulated-mass.mjs and articulated-response.mjs.
const parents=[-1,0,1,2,2,4,2,6,0,8,9,0,11,12];
function rig(seed){
 let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const vector=()=>({x:random()-.5,y:random()-.5,z:random()-.5});
 const unit=()=>{const v=vector(),l=Math.hypot(v.x,v.y,v.z);return {x:v.x/l,y:v.y/l,z:v.z/l};};
 const bodies=parents.map((_,index)=>{const q={...vector(),w:random()-.5},l=Math.hypot(q.x,q.y,q.z,q.w);for(const k of ['x','y','z','w'])q[k]/=l;return {index,q,x:vector(),ax:unit(),m:1+random()*15,iPerp:1+random()*30,iAx:1+random()*100,rP:vector(),o:vector(),v:vector(),w:vector()};});
 bodies.forEach((b,i)=>b.parent=parents[i]<0?null:bodies[parents[i]]);
 return {bodies};
}
function error(a,b){let maximum=0;assert.equal(a.length,b.length);for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i]));maximum=Math.max(maximum,Math.abs(a[i]-b[i]));assert.ok(Math.abs(a[i]-b[i])<1e-10*(1+Math.abs(b[i])),`component ${i}: ${a[i]} vs ${b[i]}`);}return maximum;}

test('Sparse ancestor response, shared Schur factors and scratch reuse preserve every connected body',t=>{
 let maxError=0,cases=0;
 for(let seed=1;seed<=20;seed++)for(const viscosity of [0,1/360,1/120,.1,10]){
  const r=rig(seed),fast=new ArticulatedMass(r,viscosity),old=new OriginalMass(r,viscosity),N=r.bodies.length*6;
  const dense=Float64Array.from({length:3*N},(_,i)=>Math.sin(seed+i*.37));
  const full=fast.solve3(dense),reference=old.solve3(dense);
  for(let column=0;column<3;column++)maxError=Math.max(maxError,error(full[column],reference[column]),error(fast.solve(dense.subarray(column*N,(column+1)*N)),reference[column]));
  for(let branch=r.bodies.length-1;branch>=0;branch--){
   const force=new Float64Array(3*N);
   for(let body=branch;body>=0;body=parents[body])for(let column=0;column<3;column++)for(let axis=0;axis<6;axis++)force[column*N+body*6+axis]=Math.cos(seed+body*.4+column+axis);
   const actual=fast.solve3(force,branch),expected=old.solve3(force),saved=actual.map(x=>Float64Array.from(x));
   for(let column=0;column<3;column++)maxError=Math.max(maxError,error(actual[column],expected[column]));
   // Poison every scratch branch, then test a root-only response. No previous
   // response may leak into an unvisited branch or overwrite returned storage.
   fast.solve3(dense);const zero=fast.solve3(new Float64Array(3*N),0);
   for(let column=0;column<3;column++){assert.deepEqual(actual[column],saved[column]);for(const x of zero[column])assert.equal(Math.abs(x),0);}
   cases++;
  }
  const retained=full.map(x=>Float64Array.from(x));r.bodies[4].x.z+=.08;fast.update(viscosity*.5);old.update(viscosity*.5);
  maxError=Math.max(maxError,error(fast.solve(dense.subarray(0,N)),old.solve(dense.subarray(0,N))));
  for(let column=0;column<3;column++)assert.deepEqual(full[column],retained[column]);
 }
 assert.equal(cases,1400);t.diagnostic(JSON.stringify({cases,maxError}));
});
