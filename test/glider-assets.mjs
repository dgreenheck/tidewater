import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {Vector3,Quaternion,Matrix4} from '../src/engine/index.js';
test('production GLB parser retains the metre-scale delta sail, suspended pilot and draw budget',async()=>{
 const bytes=await fs.readFile(new URL('../public/glider/glider.glb',import.meta.url)),g=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));let tris=0,parts=0;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],names=[];
 function visit(i,parent){const n=g.nodes[i],m=new Matrix4().compose(new Vector3(...n.t),new Quaternion(...n.r),new Vector3(...n.s)).premultiply(parent);names.push(n.name);for(const p of g.meshes[n.mesh]||[]){parts++;tris+=p.indices.length/3;const a=p.attributes.POSITION.array;for(let j=0;j<a.length;j+=3){const v=new Vector3(a[j],a[j+1],a[j+2]).applyMatrix4(m).toArray();for(let k=0;k<3;k++){assert.ok(Number.isFinite(v[k]));lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}}}for(const child of n.children)visit(child,m);}
 for(const i of g.roots)visit(i,new Matrix4());assert.ok(tris>10000&&tris<15000);assert.ok(parts<=15);assert.ok(bytes.length<600000);assert.ok(hi[0]-lo[0]>10.2&&hi[0]-lo[0]<10.4);assert.ok(lo[1]<-1.45&&hi[1]>1.4);assert.ok(names.includes('Pilot'));assert.ok(g.materials.some(m=>m.name==='SailIvory'&&m.doubleSided));
});
