import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {Matrix4,Vector3,Quaternion} from '../src/engine/math/index.js';
async function inspect(name){
 const bytes=await fs.readFile(new URL(`../public/aviation/${name}.glb`,import.meta.url));
 const gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},pivots=new Map();let triangles=0,parts=0;
 function walk(index,parent){
  const n=gltf.nodes[index],matrix=new Matrix4().compose(new Vector3(...n.t),new Quaternion(...n.r),new Vector3(...n.s));matrix.premultiply(parent);pivots.set(n.name,new Vector3().setFromMatrixPosition(matrix));
  for(const p of gltf.meshes[n.mesh]||[]){parts++;const points=p.attributes.POSITION.array;triangles+=(p.indices?.length||points.length/3)/3;assert.equal(p.mode,4);
   for(let i=0;i<points.length;i+=3){const v=new Vector3(points[i],points[i+1],points[i+2]).applyMatrix4(matrix);for(let j=0;j<3;j++){const x=[v.x,v.y,v.z][j];assert.ok(Number.isFinite(x));bounds.min[j]=Math.min(bounds.min[j],x);bounds.max[j]=Math.max(bounds.max[j],x);}}
  }
  for(const child of n.children)walk(child,matrix);
 }
 for(const root of gltf.roots)walk(root,new Matrix4());
 return {gltf,bounds,pivots,triangles,parts,bytes:bytes.length};
}
test('carrier exported through the production GLB parser retains full metre-scale hull/deck and radar pivot within draw budget',async()=>{
 const m=await inspect('carrier');assert.ok(m.triangles>120000&&m.triangles<200000);assert.ok(m.parts<=24);assert.ok(m.bytes<8e6);
 assert.ok(m.bounds.min[1]<=-10.9&&m.bounds.max[1]>=60);assert.ok(m.bounds.min[2]<=-159&&m.bounds.max[2]>=159);assert.ok(m.bounds.min[0]<-42&&m.bounds.max[0]>35);
 const radar=m.pivots.get('CarrierRadar');assert.ok(radar&&Math.abs(radar.y-56)<.001);assert.ok(m.gltf.materials.some(x=>x.name==='DeckNonslip'));
});
test('fighter GLB forward/up conventions and actual animation pivots match the solver gear/hook frame',async()=>{
 const m=await inspect('fighter');assert.ok(m.triangles>20000&&m.triangles<33000);assert.ok(m.parts<=48);assert.ok(m.bytes<1.5e6);
 assert.ok(Math.abs(m.bounds.min[1]+2)<.02,'wheel bottoms are y=-2');assert.ok(m.bounds.max[2]>9.6&&m.bounds.min[2]<-8.5,'nose is +Z');assert.ok(m.bounds.max[0]>6.7&&m.bounds.min[0]<-6.7);
 for(const key of ['GearNose','GearLeft','GearRight','AileronL','AileronR','FlapL','FlapR','ElevatorL','ElevatorR','RudderL','RudderR','ArrestorHook'])assert.ok(m.pivots.has(key),key);
 assert.ok(m.pivots.get('GearNose').z>4);assert.ok(m.pivots.get('ArrestorHook').z< -5);assert.ok(m.gltf.materials.some(x=>x.name==='Canopy'&&x.alphaMode==='BLEND'));
});
