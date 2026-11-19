import { Ragdoll } from '../Ragdoll.js';
import { Colliders } from '../../world/Colliders.js';
import { DisasterField } from '../../disasters/Field.js';
import { WaterGrid } from '../../disasters/WaterGrid.js';
import { applyWakeToAir } from '../../windfarm/Wake.js';

// Worker jobs contain a single accepted interval and a frozen environment. No
// render/model objects cross threads; the ordinary solver runs on both paths.
const scalar = value => {const type=typeof value;return type==='number'||type==='boolean'||type==='string';};
const scalars = object => {const out={};for(const key in object)if(Object.hasOwn(object,key)&&scalar(object[key]))out[key]=object[key];return out;};
const bodyCopy = body => {const out={};for(const key in body)if(key!=='parent'&&Object.hasOwn(body,key))out[key]=body[key];return out;};
export function captureRig(rig, dt, {copy=true}={}) {
 const near = { boxes: rig.near.boxes, cylinders: rig.near.cylinders };
 if (rig.nearT - dt <= 0) { near.boxes=[]; near.cylinders=[]; rig.gather.call({...rig, near}); }
 const state = { values: scalars(rig), opts: scalars(rig.opts), stats: rig.stats,
  bodies: rig.bodies.map(b => ({...bodyCopy(b), parent: b.parent?.index ?? -1})),
  joints: rig.joints.map(b=>b.index), selfPairs: rig.selfPairs.map(pair=>pair.map(b=>b.index)),
  pelvis: rig.pelvis.index, chest: rig.chest.index, near };
 // postMessage makes the production snapshot synchronously before control can
 // yield. Direct callers retain the detached snapshot contract by default.
 return {state: copy?structuredClone(state):state, near};
}
export function poseStamp(rig) {
 const result=[];
 for(const b of rig.bodies)for(const key of ['x','q','v','w']){const v=b[key];result.push(v.x,v.y,v.z);if(key==='q')result.push(v.w);}
 return result;
}
export function unchanged(rig, stamp) {
 let i=0;
 for(const b of rig.bodies)for(const key of ['x','q','v','w']){const v=b[key];if(v.x!==stamp[i++]||v.y!==stamp[i++]||v.z!==stamp[i++])return false;if(key==='q'&&v.w!==stamp[i++])return false;}
 return i===stamp.length;
}
// Copy the original texels without resampling or changing the world coordinate
// arithmetic. Escaping this generous tile rejects the speculative job; the main
// thread then runs the complete original interval against the full terrain.
export function captureTerrain(terrain, rig) {
 const {res,texel,origin,heights}=terrain;
 if(!heights||!Number.isInteger(res)||!Number.isFinite(texel))return null;
 const xs=rig.bodies.map(b=>b.x.x), zs=rig.bodies.map(b=>b.x.z), pad=64;
 const clamp=v=>Math.max(0,Math.min(res-1,v));
 const x0=clamp(Math.floor((Math.min(...xs)-pad-origin)/texel)-1),x1=clamp(Math.ceil((Math.max(...xs)+pad-origin)/texel)+1);
 const z0=clamp(Math.floor((Math.min(...zs)-pad-origin)/texel)-1),z1=clamp(Math.ceil((Math.max(...zs)+pad-origin)/texel)+1);
 const width=x1-x0+1,data=new Float32Array(width*(z1-z0+1));
 for(let z=z0;z<=z1;z++)data.set(heights.subarray(z*res+x0,z*res+x1+1),(z-z0)*width);
 return {res,texel,origin,x0,x1,z0,z1,width,data};
}
export function terrainReader(tile, visit=()=>{}) {
 return (x,z)=>{
  visit(x,z);
  const {res,texel,origin,x0,x1,z0,z1,width,data}=tile;
  const fx=(x-origin)/texel-.5,fz=(z-origin)/texel-.5;
  if(fx<0||fz<0||fx>=res-1||fz>=res-1)return -90;
  const i=Math.floor(fx),j=Math.floor(fz),tx=fx-i,tz=fz-j;
  if(i<x0||j<z0||i+1>x1||j+1>z1)throw new RangeError('rig-terrain-tile');
  const k=(j-z0)*width+i-x0,a=data[k],b=data[k+1],c=data[k+width],d=data[k+width+1];
  return (a*(1-tx)+b*tx)*(1-tz)+(c*(1-tx)+d*tx)*tz;
 };
}
export function captureField(field) {
 if(!field)return null;
 const water=field.water,outer=field.outer;
 const modifiers=[];
 for(const entry of field.airModifiers){const data=entry.workerSnapshot?.(),bounds=typeof entry.bounds==='function'?entry.bounds():entry.bounds;if(data?.kind==='windfarm'&&(!entry.bounds||bounds))modifiers.push({...data,bounds});}
 return {events:[...field.events],time:field.time,ambient:field.ambient?.()??null,modifiers,
  water:water?{n:water.n,dx:water.dx,x:water.x,z:water.z,pixels:water.pixels}:null,
  // The 8 km outer ring too (one water field for everyone): with the inner 2 km grid alone a body
  // beyond it saw a flat sea in the worker under a 9.5 m crest on the main thread (test/rig-snapshot-water.mjs).
  // Cost: a second 257^2 x 4 float copy (1 MB) per job while a tsunami runs.
  outer:outer?{n:outer.n,dx:outer.dx,x:outer.x,z:outer.z,pixels:outer.pixels}:null};
}
// The worker's copy of the disaster field: events, air and the water the main thread sees.
export function restoreField(fieldState, terrain, visit=()=>{}) {
 const field=new DisasterField(terrain);field.events=new Map(fieldState.events);field.time=fieldState.time;
 // Air queries must participate in the exclusion guard even when their field
 // calculation does not need terrain or lies outside the water grid.
 const sampleRaw=field.sampleRaw;
 field.sampleRaw=function(x,y,z,out){visit(x,z);return sampleRaw.call(this,x,y,z,out);};
 if(fieldState.ambient)field.ambient=()=>fieldState.ambient;
 for(const m of fieldState.modifiers??[])if(m.kind==='windfarm')field.registerAirModifier((x,y,z,air)=>applyWakeToAir(air,x,y,z,m.sources,m.time),m.bounds);
 if(fieldState.water)field.water=Object.assign(Object.create(WaterGrid.prototype),fieldState.water,{terrain});
 if(fieldState.outer)field.outer=Object.assign(Object.create(WaterGrid.prototype),fieldState.outer,{terrain});
 return field;
}
export function restoreRig(state, terrain, fieldState, visit=()=>{}) {
 const colliders=new Colliders();colliders.boxes=state.near.boxes;colliders.cylinders=state.near.cylinders;
 const resolve=colliders.resolveCapsule;
 colliders.resolveCapsule=function(p,...args){visit(p.x,p.z);const hit=resolve.call(this,p,...args);visit(p.x,p.z);return hit;};
 const rig=new Ragdoll({terrain:{heightAt:terrain},colliders,groundProviders:[],reef:null},state.opts);
 Object.assign(rig,state.values);rig.stats=state.stats;rig.bodies=state.bodies;
 for(const b of rig.bodies)b.parent=b.parent>=0?rig.bodies[b.parent]:null;
 rig.joints=state.joints.map(i=>rig.bodies[i]);rig.selfPairs=state.selfPairs.map(pair=>pair.map(i=>rig.bodies[i]));
 rig.pelvis=rig.bodies[state.pelvis];rig.chest=rig.bodies[state.chest];
 rig.near.boxes=colliders.boxes;rig.near.cylinders=colliders.cylinders;
 // The query snapshot already contains exactly what the frame's gather selects.
 rig.gather=()=>{};
 if(fieldState)rig.disasterField=restoreField(fieldState,terrain,visit);
 return rig;
}
export function runRigJob(job, field) {
 const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
 const visit=(x,z)=>{bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);bounds.minZ=Math.min(bounds.minZ,z);bounds.maxZ=Math.max(bounds.maxZ,z);};
 const rig=restoreRig(job.state,terrainReader(job.terrain,visit),job.field?field:null,visit);
 rig.simulate(job.dt);
 return {id:job.id,values:scalars(rig),stats:rig.stats,bodies:rig.bodies.map(bodyCopy),bounds};
}
export function applyRigResult(rig, result, near) {
 Object.assign(rig,result.values);rig.stats=result.stats;
 for(let i=0;i<rig.bodies.length;i++)Object.assign(rig.bodies[i],result.bodies[i]);
 rig.near.boxes=near.boxes;rig.near.cylinders=near.cylinders;
 // Each simulate starts with fresh planes. Contacts/factorizations retained on
// the main thread rebuild at the new pose before any inter-person impulse.
 rig.groundProvider=null;
}
export function overlaps(a,b){return a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;}
