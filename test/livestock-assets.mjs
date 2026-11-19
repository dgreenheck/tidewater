import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseGLB} from '../src/engine/loaders/GLTF.js';
for(const species of ['goat','cow'])test(`${species} original model has a complete coat, linked legs, head, tail and four real animation clips`,async()=>{
 const b=await readFile(new URL(`../public/models/livestock/${species}.glb`,import.meta.url)),g=parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.equal(g.meshes.length,1);assert.equal(g.meshes[0].length,1);assert.equal(g.skins.length,1);assert.equal(g.skins[0].joints.length,12);const p=g.meshes[0][0],A=p.attributes;assert.ok(A.POSITION.array.length/3>6000);assert.ok(A.COLOR_0);assert.ok(new Set(A.COLOR_0.array).size>100);assert.ok([...A.POSITION.array,...A.NORMAL.array].every(Number.isFinite));const w=A.WEIGHTS_0.array;for(let i=0;i<w.length;i+=4)assert.ok(Math.abs(w[i]+w[i+1]+w[i+2]+w[i+3]-1)<1e-6);
 assert.deepEqual(g.animations.map(a=>a.name).sort(),['Alert','Graze','Idle','Walk']);for(const name of ['Walk','Graze']){const clip=g.animations.find(a=>a.name===name);assert.ok(clip.duration>=1.9);const active=clip.channels.filter(c=>new Set(c.values).size>10).map(c=>g.nodes[c.node].name);assert.ok(active.some(n=>name==='Walk'?n==='FL':n==='Neck'));}
});

import {SkinnedModel} from '../src/engine/render/Skinning.js';import {StorageBuffer} from '../src/engine/gpu/Texture.js';
for(const species of ['goat','cow'])test(`${species} grazing animation lowers its authored muzzle into the grass without moving the physical body`,async()=>{
 const b=await readFile(new URL(`../public/models/livestock/${species}.glb`,import.meta.url)),g=parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),write=StorageBuffer.prototype.write;
 StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 try{const model=new SkinnedModel(g),a=g.meshes[0][0].attributes,P=a.POSITION.array,W=a.WEIGHTS_0.array,J=a.JOINTS_0.array;model.play('Graze',{fade:0});model.update(.5);let sum=0,count=0;
  for(let i=0;i<P.length/3;i++){if(P[i*3+2]<(species==='goat'?.94:1.58))continue;let y=0;for(let k=0;k<4;k++){const n=J[i*4+k]*16,d=model.jointData;y+=W[i*4+k]*(d[n+1]*P[i*3]+d[n+5]*P[i*3+1]+d[n+9]*P[i*3+2]+d[n+13]);}sum+=y;count++;}
  assert.ok(count>10);assert.ok(sum/count>.02&&sum/count<.20,`grazing muzzle is ${sum/count}m above foot level`);assert.equal(model.group.position.y,0);
 }finally{StorageBuffer.prototype.write=write;}
});
