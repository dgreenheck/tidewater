import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {Village} from '../src/world/Village.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {Colliders} from '../src/world/Colliders.js';
import {Scene,Vector3,Quaternion} from '../src/engine/index.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {Evacuation} from '../src/evacuation/Evacuation.js';
import {PropPhysics,PROPS} from '../src/physics/Props.js';
import {applyTerminalSite,PLACES} from '../src/ferry/Terminal.js';

await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
// Isolate canvas rasterization and GPU upload only. Terrain generation, authored
// Village/Evacuation construction, prop registration and native contact are real.
const canvas=new Proxy({measureText:()=>({width:100}),getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
const oldDocument=globalThis.document,oldWrite=StorageBuffer.prototype.write;
globalThis.document={createElement:()=>({getContext:()=>canvas})};
StorageBuffer.prototype.write=function(data){this.pendingData=data;};
let terrain,colliders,app,props;
try {
 terrain=new TerrainData();for(const place of Object.values(PLACES))applyTerminalSite(terrain,undefined,place);
 colliders=new Colliders();const scene=new Scene(),village=new Village({scene,terrain,colliders});new CoastalRoute(terrain);
 app={terrainData:terrain,colliders,scene,village};new Evacuation(app).build();props=new PropPhysics(app);props.link(colliders);
} finally {globalThis.document=oldDocument;StorageBuffer.prototype.write=oldWrite;}
const traps=PROPS.all.filter(p=>p.type==='trap'&&p.position.z< -149&&p.position.z> -152);
const staticBoxes=colliders.boxes.filter(b=>(b.solid||b.walkable)&&!b.prop&&Math.hypot(b.center.x-49,b.center.z+150)<12+b.radius);
const staticCylinders=colliders.cylinders.filter(c=>!c.prop&&Math.hypot(c.x-49,c.z+150)<12+c.radius);
const center=p=>p.local.c.clone().applyMatrix4(p.m);
// Independent separating-axis check on each authored yaw-only trap and actual
// static box. Initial overlap is invalid even if the solver sometimes ejects it.
function intersects(prop,box){const p=center(prop),q=new Quaternion();prop.m.decompose(new Vector3(),q,new Vector3());const h=prop.local.half;
 if(box.bottom>=p.y+h.y||box.top<=p.y-h.y)return false;
 const x=new Vector3(1,0,0).applyQuaternion(q),z=new Vector3(0,0,1).applyQuaternion(q),X=new Vector3(box.cos,0,-box.sin),Z=new Vector3(box.sin,0,box.cos),d=p.clone().sub(box.center);
 return [x,z,X,Z].every(axis=>Math.abs(d.dot(axis))<Math.abs(x.dot(axis))*h.x+Math.abs(z.dot(axis))*h.z+Math.abs(X.dot(axis))*box.half.x+Math.abs(Z.dot(axis))*box.half.z);
}
// Crop existing one-metre texels without resampling or changing their alignment.
const res=512,size=512,origin=-256,heights=new Float32Array(res*res);
for(let z=0;z<res;z++)for(let x=0;x<res;x++)heights[z*res+x]=terrain.heights[(z+768)*terrain.res+x+768];
function clearances(state,half){const p=new Vector3().fromArray(state,1),q=new Quaternion().fromArray(state,4);let lo=Infinity,hi=-Infinity;
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const c=new Vector3(x*half.x,y*half.y,z*half.z).applyQuaternion(q).add(p),d=c.y-terrain.heightAt(c.x,c.z);lo=Math.min(lo,d);hi=Math.max(hi,d);}return {lo,hi,p};
}

test('Authored village trap bodies have valid clearance from the evacuation stairs and neighbouring solids',()=>{
 assert.equal(traps.length,2,'the same two yard traps are retained');
 for(const prop of traps){const overlap=staticBoxes.filter(b=>intersects(prop,b));assert.deepEqual(overlap.map(b=>b.tag),[],`trap ${prop.id} begins intersecting ${overlap.map(b=>b.tag).join(', ')}`);}
 assert.ok(!intersects(traps[0],{center:center(traps[1]),half:traps[1].local.half,cos:Math.cos(.4),sin:Math.sin(.4),bottom:center(traps[1]).y-traps[1].local.half.y,top:center(traps[1]).y+traps[1].local.half.y}),'loose traps must not initially intersect each other');
});
for(const includeEvacuation of [false,true])test(`Real authored traps remain above the native terrain with evacuation contacts ${includeEvacuation?'present':'absent (control)'}`,()=>{
 for(const dt of [1/60,.1]){const sim=new RallyPhysics();try{assert.ok(sim.set_terrain(heights,res,size,origin));sim.reset(-200,10,0,0);
  sim.add_boxes(new Float32Array(staticBoxes.filter(b=>includeEvacuation||!b.tag.startsWith('evacuation')).flatMap(b=>[...b.center.toArray(),...b.half.toArray(),b.rotY,.65])));
  sim.add_cylinders(new Float32Array(staticCylinders.flatMap(c=>[c.x,c.z,c.radius,c.yMin,c.yMax])));
  props.physics=sim;props.awake.clear();for(const prop of traps)props.wake(prop);
  assert.equal(sim.prop_count(),2);const worst={bottom:Infinity,top:Infinity};
  for(let t=0;t<3-dt/2;t+=dt){sim.advance(dt,0,0,0,1);const poses=sim.prop_poses();for(let i=0;i<poses.length;i+=10){const prop=traps.find(p=>p.id===poses[i]),c=clearances(poses.slice(i,i+10),prop.local.half);worst.bottom=Math.min(worst.bottom,c.lo);worst.top=Math.min(worst.top,c.hi);assert.ok(c.hi>.15,`trap ${prop.id} top below safe terrain side at t=${t+dt}, clear=${c.hi}, COM=${c.p.toArray()}`);if(t>.25)assert.ok(c.lo>-.09,`trap ${prop.id} persistently penetrates terrain by ${-c.lo}m`);}}
  console.log(JSON.stringify({includeEvacuation,dt,worst}));
 }finally{props.awake.clear();sim.free();}}
});

import {Disasters} from '../src/disasters/Disasters.js';
import {DisasterField} from '../src/disasters/Field.js';
test('Clear yard traps remain on the terrain side under real held tornado loads',()=>{
 const sim=new RallyPhysics(),field=new DisasterField((x,z)=>terrain.heightAt(x,z));
 try{sim.set_terrain(heights,res,size,origin);sim.reset(-200,10,0,0);sim.add_boxes(new Float32Array(staticBoxes.flatMap(b=>[...b.center.toArray(),...b.half.toArray(),b.rotY,.65])));sim.add_cylinders(new Float32Array(staticCylinders.flatMap(c=>[c.x,c.z,c.radius,c.yMin,c.yMax])));props.physics=sim;props.awake.clear();for(const prop of traps)props.wake(prop);
  const director=Object.assign(Object.create(Disasters.prototype),{app:{...app,rally:{physics:sim,profile:{mass:1400}}},field,structures:{bodies:new Map()},bodies:{bodies:new Map()},restored:true,limited:0});
  field.start('tornado',{x:58,z:-70,radius:180,intensity:100,speed:0,duration:60});const start=traps.map(center);let moved=0;
  for(let i=0;i<120;i++){const dt=1/30;field.advance(dt);director.loads(dt);sim.advance(dt,0,0,0,1);const poses=sim.prop_poses();for(let k=0;k<poses.length;k+=10){const index=traps.findIndex(p=>p.id===poses[k]),c=clearances(poses.slice(k,k+10),traps[index].local.half);assert.ok(c.hi>.12,`loaded trap ${poses[k]} crossed under the terrain: top=${c.hi}`);moved=Math.max(moved,c.p.distanceTo(start[index]));}}
  assert.ok(moved>.5,'actual shared wind must move the native traps');
 }finally{props.awake.clear();sim.free();}
});
