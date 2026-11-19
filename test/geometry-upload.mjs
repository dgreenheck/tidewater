import test from 'node:test';
import assert from 'node:assert/strict';
import {GPU} from '../src/engine/gpu/GPU.js';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
import {BufferGeometry,BufferAttribute} from '../src/engine/index.js';

function fakeQueue(run){
 const old={device:GPU.device,queue:GPU.queue,usage:globalThis.GPUBufferUsage},writes=[];
 globalThis.GPUBufferUsage={VERTEX:32,COPY_DST:8};
 GPU.device={createBuffer:({size})=>({bytes:new Uint8Array(size),destroy(){}})};
 GPU.queue={writeBuffer(buffer,offset,source,sourceOffset=0,size){const data=ArrayBuffer.isView(source)?new Uint8Array(source.buffer,source.byteOffset+sourceOffset,size??source.byteLength-sourceOffset):new Uint8Array(source,sourceOffset,size??source.byteLength-sourceOffset);buffer.bytes.set(data,offset);writes.push({offset,size:data.byteLength});}};
 try{run(writes);}finally{GPU.device=old.device;GPU.queue=old.queue;globalThis.GPUBufferUsage=old.usage;}
}

test('Many adjacent fragment changes upload only their small dirty region with exact GPU bytes',()=>fakeQueue(writes=>{
 const backing=new Float32Array(30016),values=backing.subarray(8,30008);for(let i=0;i<values.length;i++)values[i]=i*.25;
 const a=new BufferAttribute(values,3),g=new BufferGeometry().setAttribute('position',a),r=new MeshRenderer();
 const buffer=r._attributeBuffer(g,a);writes.length=0;
 for(let i=300;i<600;i+=3){values.set([i+1,i+2,i+3],i);a.addUpdateRange(i,3);}
 // Duplicated changes from separate simulation substeps must not upload twice.
 a.addUpdateRange(330,36);a.needsUpdate=true;r._attributeBuffer(g,a);
 assert.ok(writes.reduce((n,w)=>n+w.size,0)<2400,'small geometry edits must not re-upload the entire 120KB shared batch');
 assert.ok(writes.length<=4,'adjacent per-primitive updates should be batched rather than issuing hundreds of GPU calls');
 assert.deepEqual(buffer.bytes,new Uint8Array(values.buffer,values.byteOffset,values.byteLength),'GPU bytes include the changed region and preserve every unchanged neighbor');
 assert.equal(a.updateRanges.length,0,'submitted dirty ranges must be consumed');
 const count=writes.length;r._attributeBuffer(g,a);assert.equal(writes.length,count,'unchanged following frame uploads nothing');
}));

test('Initial and widened attribute uploads clear ranges and preserve normalized values',()=>fakeQueue(writes=>{
 const a=new BufferAttribute(new Uint8Array([0,128,255,64,128,192]),3,true),g=new BufferGeometry().setAttribute('color',a),r=new MeshRenderer();
 a.addUpdateRange(0,3);const b=r._attributeBuffer(g,a);assert.equal(a.updateRanges.length,0,'initial full upload consumes its ranges');
 a.array[3]=255;a.addUpdateRange(3,3);a.needsUpdate=true;r._attributeBuffer(g,a);
 assert.equal(a.updateRanges.length,0,'converted full upload consumes ranges too');
 assert.deepEqual(new Float32Array(b.bytes.buffer),Float32Array.from(a.array,v=>v/255));
}));

test('Material views of one village batch share uploads and retain their buffer until the last view is disposed',()=>fakeQueue(writes=>{
 const a=new BufferAttribute(new Float32Array(300),3);
 const one=new BufferGeometry().setAttribute('position',a),two=new BufferGeometry().setAttribute('position',a),r=new MeshRenderer();
 const first=r._attributeBuffer(one,a),second=r._attributeBuffer(two,a);
 assert.equal(first,second,'material views must not allocate and upload the full shared village batch independently');
 assert.equal(writes.length,1);
 let disposals=0;first.destroy=()=>{disposals++;};one.dispose();assert.equal(disposals,0,'one material cannot dispose a buffer another material still uses');
 a.array[30]=17;a.addUpdateRange(30,1);a.needsUpdate=true;r._attributeBuffer(two,a);
 assert.equal(new Float32Array(second.bytes.buffer)[30],17);
 two.dispose();assert.equal(disposals,1,'the last owner releases the native buffer');
}));

test('A dirty tail of a six-byte packed attribute keeps aligned padding inside its source buffer',()=>fakeQueue(()=>{
 const a=new BufferAttribute(new Uint8Array([1,2,3,4,5,6]),2,true),g=new BufferGeometry().setAttribute('uv',a),r=new MeshRenderer();
 const b=r._attributeBuffer(g,a);a.array[4]=91;a.array[5]=92;a.addUpdateRange(4,2);a.needsUpdate=true;
 assert.doesNotThrow(()=>r._attributeBuffer(g,a),'alignment may not read beyond the source typed array');
 assert.deepEqual(Array.from(b.bytes.slice(0,8)),[1,2,3,4,91,92,0,0]);
 assert.equal(a.updateRanges.length,0);
}));
