import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { MeshRenderer as ReferenceRenderer } from './reference/PreLaptopMeshRenderer.js';
import { RefractionPass, minimumWorldY } from '../src/ocean/RefractionPass.js';
import { RefractionPass as ReferenceRefraction } from './reference/PreLaptopRefractionPass.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { poseScene } from '../src/engine/render/ScenePose.js';
import { ShadowCasters } from '../src/engine/render/ShadowCasters.js';
import { Scene, Group, Mesh, BufferGeometry, BufferAttribute, PerspectiveCamera, Box3, Matrix4, Vector3, InterleavedBuffer, InterleavedBufferAttribute } from '../src/engine/index.js';

const boundsPass = Class => Object.assign(Object.create(Class.prototype), {_boxes:new WeakMap()});
const records = lists => ['opaque','transparent'].map(k=>lists[k].map(i=>[i.object.id,i.geometry.id,i.material.id,i.start,i.count,i.z,i.renderOrder,i.pipeKey]));

function fakeGPU(run){
 const saved={device:GPU.device,queue:GPU.queue,getEncoder:GPU.getEncoder,samplers:GPU.samplers,usage:globalThis.GPUBufferUsage,stage:globalThis.GPUShaderStage};
 globalThis.GPUBufferUsage={VERTEX:32,INDEX:16,COPY_DST:8};globalThis.GPUShaderStage={VERTEX:1,FRAGMENT:2,COMPUTE:4};
 GPU.device={createBuffer:({size})=>({bytes:new Uint8Array(size),destroy(){}}),createBindGroupLayout:x=>x,createBindGroup:x=>x};GPU.samplers={};
 GPU.queue={writeBuffer(buffer,offset,source,sourceOffset=0,size){const data=ArrayBuffer.isView(source)?new Uint8Array(source.buffer,source.byteOffset+sourceOffset,size??source.byteLength-sourceOffset):new Uint8Array(source,sourceOffset,size??source.byteLength-sourceOffset);buffer.bytes.set(data,offset);}};
 GPU.getEncoder=()=>({beginRenderPass:()=>({setBindGroup(){},end(){}})});
 try{return run();}finally{Object.assign(GPU,{device:saved.device,queue:saved.queue,getEncoder:saved.getEncoder,samplers:saved.samplers});globalThis.GPUBufferUsage=saved.usage;globalThis.GPUShaderStage=saved.stage;}
}

test('Pooled render collections preserve draw order, pass callbacks, ranges, masks, and visibility',()=>fakeGPU(()=>{
 const scene=new Scene(),camera=new PerspectiveCamera(65,1.5,.1,200);camera.position.set(3,2,9);camera.lookAt(0,0,0);
 const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,0,1,0]),3));
 const materials=Array.from({length:9},(_,id)=>({id,visible:id!==5,transparent:id%3===0}));
 let callbackCount=0;
 for(let j=0;j<14;j++){
  const group=new Group();group.position.x=(j-7)*3;group.visible=j%6!==0;scene.add(group);
  for(let i=0;i<12;i++){
   const g=i%4===0?geometry.clone():geometry;if(g!==geometry){g.addGroup(0,2,0);g.addGroup(2,1,1);g.setDrawRange(1,2);}
   const mesh=new Mesh(g,i%4===0?[materials[i%9],materials[(i+1)%9]]:materials[i%9]);
   mesh.position.set(i%3,j%3,-i*2);mesh.layers.set(i%3);mesh.renderOrder=i%2;mesh.castShadow=i%2===0;mesh.visible=i!==7;
   mesh.onBeforeRender=()=>{callbackCount++;};group.add(mesh);
  }
 }
 const reference=new ReferenceRenderer(),candidate=new MeshRenderer(),block={label:'test',structName:'Test',upload(){},getBuffer(){return {};}};
 candidate._beginFrame=()=>{};
 for(const options of [{camera},{camera,kind:'depth'},{camera,layerMask:2},{camera,cull:false,filter:o=>o.id%3!==0},{camera,cull:false,precompile:true}]){
  reference.precompiling=candidate.precompiling=!!options.precompile;callbackCount=0;
  const expected=records(reference.collect(scene,options)),callbacks=callbackCount;callbackCount=0;const actual=[];
  candidate.drawItems=(rp,items)=>actual.push(items.map(i=>[i.object.id,i.geometry.id,i.material.id,i.start,i.count,i.z,i.renderOrder,i.pipeKey]));
  candidate.render(scene,{...options,frameBlock:block});assert.deepEqual(actual,expected);assert.equal(callbackCount,callbacks);
  assert.ok(candidate._listPool[0].items.every(i=>i.object===null&&i.geometry===null&&i.material===null),'pooled records may not retain a removed scene');
 }
 const held=candidate.collect(scene,{camera}),snapshot=records(held);candidate.collect(scene,{camera,cull:false});assert.deepEqual(records(held),snapshot,'public collections remain independently owned');
 const owned=candidate._listPool[0],identities=owned.items.slice();candidate.render(scene,{camera,frameBlock:block});identities.forEach((item,i)=>assert.equal(owned.items[i],item,'a warmed list allocates no replacement draw records'));
}));

test('Nested render callbacks and thrown callbacks never reuse a live outer list',()=>fakeGPU(()=>{
 const renderer=new MeshRenderer(),block={label:'nested',structName:'Test',upload(){},getBuffer(){return {};}};
 const geo=new BufferGeometry(),outer=new Scene(),inner=new Scene();outer.add(new Mesh(geo,{id:1,visible:true}));inner.add(new Mesh(geo,{id:2,visible:true}));renderer._beginFrame=()=>{};
 let outerItem;renderer.drawItems=(rp,items)=>{if(items[0]?.material.id===1)outerItem=items[0];};
 renderer.render(outer,{frameBlock:block,betweenLists:()=>{renderer.render(inner,{frameBlock:block});assert.equal(outerItem.material.id,1);}});
 assert.equal(renderer._listPool.length,2);
 assert.throws(()=>renderer.render(outer,{frameBlock:block,after:()=>{throw Error('test callback');}}),/test callback/);
 assert.equal(renderer._listPool.length,2);assert.ok(renderer._listPool.every(l=>l.used===0&&l.items.every(i=>i.object===null&&i.material===null)));
}));

test('Draw commands preserve every effective binding while coalescing redundant buffer binds',()=>{
 const buffers=Array.from({length:5},(_,id)=>({id})),pipelines=Array.from({length:3},(_,id)=>({handle:{pipeline:id+1},bindings:{getBindGroup:()=>id}}));
 const geos=Array.from({length:4},(_,i)=>({attributes:{position:{count:30}},index:i===3?null:{count:30},layout:{buffers:[{attr:buffers[i%2]},{attr:buffers[2]}]},indexBuffer:i===3?null:{buffer:buffers[3],format:i===2?'uint32':'uint16'}}));
 geos[2].indirect={buffer:buffers[4],offsets:[0,20]};
 const items=Array.from({length:100},(_,i)=>({object:{slot:i%8,count:2,isInstancedMesh:i%2===0},geometry:geos[Math.floor(i/7)%4],material:{id:i%3},start:i%5,count:12}));
 function run(Class){const renderer=new Class(),calls={vertex:0,index:0},draws=[],state={vertex:[],groups:[]};
  renderer._cachedLayout=(o,g)=>g.layout;renderer._pipeline=m=>pipelines[m.id];renderer._attributeBuffer=(g,a)=>a;renderer._indexBuffer=g=>g.indexBuffer;renderer._slot=o=>o.slot;
  const record=(name,args)=>draws.push({name,args,pipeline:state.pipeline,vertex:state.vertex.slice(),index:name.startsWith('drawIndexed')?state.index:null,groups:state.groups.slice()});
  const rp={setPipeline:p=>state.pipeline=p,setVertexBuffer(i,b){calls.vertex++;state.vertex[i]=b.id;},setIndexBuffer(b,f){calls.index++;state.index=[b.id,f];},setBindGroup(i,g,offset){state.groups[i]=offset?Array.from(offset):g;}};
  for(const k of ['draw','drawIndexed','drawIndirect','drawIndexedIndirect'])rp[k]=(...args)=>record(k,args);
  renderer.drawItems(rp,items,{});return {calls,draws,stats:renderer.stats};}
 const before=run(ReferenceRenderer),after=run(MeshRenderer);assert.deepEqual(after.draws,before.draws);assert.deepEqual(after.stats,before.stats);
 assert.ok(after.calls.vertex<before.calls.vertex/5);assert.ok(after.calls.index<before.calls.index/3);
});

test('Refraction bounds survive consumed sparse uploads, skipped frames, full edits and topology changes',()=>fakeGPU(()=>{
 const p=new BufferAttribute(new Float32Array(3072*3),3);for(let i=0;i<p.count;i++)p.setXYZ(i,i%19,(i%29)-14,i%31);
 const g=new BufferGeometry().setAttribute('position',p),objects=[];for(let i=0;i<6;i++){const view=new BufferGeometry().setAttribute('position',p);view.setDrawRange(i*512,512);objects.push({geometry:view});}
 const r=boundsPass(RefractionPass),reference=boundsPass(ReferenceRefraction),renderer=new MeshRenderer();renderer._attributeBuffer(g,p);
 const check=()=>{for(const o of objects)assert.deepEqual(r._localBox(o),reference._localBox(o));};check();
 let scans=0;const normalize=p.normalized;p.normalized=true;const getX=p.getX.bind(p);p.getX=i=>{scans++;return getX(i);};check();scans=0;
 for(let frame=0;frame<30;frame++){
  const first=(frame%6)*512+31;p.setY(first,-30-frame);p.addUpdateRange(first*3+1,1);p.needsUpdate=true;renderer._attributeBuffer(g,p);assert.equal(p.updateRanges.length,0);
  const other=objects[(frame+3)%6];scans=0;r._localBox(other);if(frame===0)assert.equal(scans,0,'an untouched material view does not rescan after consumed disjoint uploads');
  if(frame%4===3)check();
 }
 check();p.setY(1,-500);p.needsUpdate=true;renderer._attributeBuffer(g,p);check();
 p.setY(2000,-800);p.needsUpdate=true;check();renderer._attributeBuffer(g,p);check();
 objects[0].geometry.setIndex([2000,1,2000]);objects[0].geometry.setDrawRange(0,3);check();
 p.array=p.array.slice();p.array[4]=-900;check();p.normalized=normalize;
}));

test('Normalized interleaved refraction positions and general projective bounds retain their values',()=>{
 const data=new InterleavedBuffer(new Int16Array([42,-32767,16384,0,42,0,32767,-32767]),4),pos=new InterleavedBufferAttribute(data,3,1,true);
 const o={geometry:new BufferGeometry().setAttribute('position',pos)},r=boundsPass(RefractionPass),reference=boundsPass(ReferenceRefraction);
 assert.deepEqual(r._localBox(o),reference._localBox(o));data.array[2]=-16384;data.needsUpdate=true;assert.deepEqual(r._localBox(o),reference._localBox(o));
 let seed=1987;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let i=0;i<2000;i++){
  const min=new Vector3(random()*20-10,random()*20-10,random()*20-10),max=min.clone().add(new Vector3(random()*5,random()*5,random()*5)),box=new Box3(min,max),m=new Matrix4();
  for(const j of [0,1,2,4,5,6,8,9,10,12,13,14])m.elements[j]=random()*20-10;
  if(i%8===0){m.elements[3]=.001;m.elements[7]=.002;m.elements[11]=.003;}
  const expected=box.clone().applyMatrix4(m).min.y,actual=minimumWorldY(box,m);assert.ok(Math.abs(actual-expected)<1e-12,`${actual} / ${expected}`);
 }
 assert.equal(minimumWorldY(new Box3(),new Matrix4()),Infinity);
});

// L6 perf: every pass of a frame walked the whole main scene graph again (shadow caster check, opaque,
// refraction, water + transparent: four updateMatrixWorld calls, about 2.5 ms of CPU a frame at the
// README target). App.renderFrame now poses the scene once (src/engine/render/ScenePose.js).
test('A posed main scene is updated once per frame and every pass still draws its current matrices',()=>fakeGPU(()=>{
 const savedFrame=GPU.frame;
 try{
  const scene=new Scene(),camera=new PerspectiveCamera(65,1.5,.1,200);camera.position.set(3,2,9);camera.lookAt(0,0,0);
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,0,1,0]),3));
  const meshes=[];
  for(let j=0;j<6;j++){
   const group=new Group();group.position.x=(j-3)*2;group.rotation.y=j*.3;scene.add(group);
   for(let i=0;i<5;i++){const mesh=new Mesh(geometry,{id:i,visible:true,transparent:i===4});mesh.position.set(i*.5,j*.2,-i);mesh.castShadow=true;group.add(mesh);meshes.push(mesh);}
  }
  const update=scene.updateMatrixWorld.bind(scene);let walks=0;scene.updateMatrixWorld=force=>{walks++;return update(force);};
  const reference=new ReferenceRenderer(),candidate=new MeshRenderer(),casters=new ShadowCasters(),cascades=[{viewProj:new Matrix4(),dirty:false}];
  const worlds=()=>meshes.map(m=>m.matrixWorld.elements.slice());
  const options=[{camera},{camera,kind:'depth'},{camera,layerMask:2}];
  for(let frame=1;frame<=3;frame++){
   GPU.frame=1000+frame;
   // the simulation moves things between frames, never between the passes of one frame
   meshes[frame].position.y+=1;meshes[0].parent.position.z-=.5;
   poseScene(scene);walks=0;
   casters.invalidate(scene,cascades,0xffffffff);
   const passes=options.map(o=>records(candidate.collect(scene,o)));
   assert.equal(walks,0,`frame ${frame}: ${walks} extra whole-scene matrix updates after the pose (expected 0)`);
   const posedWorlds=worlds();scene.updateMatrixWorld();
   assert.deepEqual(posedWorlds,worlds(),'posed world matrices equal a fresh update');
   assert.deepEqual(passes,options.map(o=>records(reference.collect(scene,o))),'draw lists equal the per-pass reference');
  }
  // an unposed scene (the fish portrait, impostor bakes) still updates in every pass
  GPU.frame=2000;walks=0;candidate.collect(scene,{camera});candidate.collect(scene,{camera});
  assert.equal(walks,2,'an unposed scene updates in every pass');
 }finally{GPU.frame=savedFrame;}
}));

test('A posed scene draws from a flat walk: the same draw lists and callback order, without re-reading the hierarchy in every pass',()=>fakeGPU(()=>{
 const savedFrame=GPU.frame;
 try{
  const scene=new Scene(),camera=new PerspectiveCamera(65,1.5,.1,200);camera.position.set(3,2,9);camera.lookAt(0,0,0);
  const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,0,1,0]),3));
  const materials=Array.from({length:5},(_,id)=>({id,visible:true,transparent:id===4}));
  const order=[],meshes=[],groups=[];
  const mesh=(i,j)=>{const m=new Mesh(geometry,materials[i%5]);m.position.set(i*.4,j*.3,-i);m.layers.set(i%3);m.castShadow=i%2===0;m.visible=(i+j)%7!==3;
   // an LOD-style callback: it hides or shows a later sibling, so visibility is read live in walk order
   m.onBeforeRender=()=>{order.push(m.id);if(m.userData.lod)m.userData.lod.visible=camera.position.x>0;};meshes.push(m);return m;};
  for(let j=0;j<8;j++){
   const group=new Group();group.position.x=(j-4)*2;group.visible=j!==5;scene.add(group);groups.push(group);
   const helpers=new Group();helpers.add(new Group(),new Group());helpers.children[0].add(new Group());group.add(helpers); // meshless subtree (bones, anchors)
   for(let i=0;i<6;i++){const m=mesh(i,j);if(i===3)m.add(mesh(9,j));group.add(m);}
   group.children[2].userData.lod=group.children[4];
  }
  const reference=new ReferenceRenderer(),candidate=new MeshRenderer();
  const options=[{camera},{camera,kind:'depth'},{camera,layerMask:2},{camera,filter:o=>o.id%3!==0}];
  let reads=0;const watch=o=>{const list=o.children;Object.defineProperty(o,'children',{configurable:true,get(){reads++;return list;}});list.forEach(watch);};
  const compare=label=>{for(const o of options){order.length=0;const expected=records(reference.collect(scene,o)),expectedOrder=order.slice();order.length=0;
   assert.deepEqual(records(candidate.collect(scene,o)),expected,`${label}: draw list equals the recursive walk`);assert.deepEqual(order,expectedOrder,`${label}: callbacks run in the same order`);}};
  for(let frame=1;frame<=3;frame++){
   GPU.frame=3000+frame;camera.position.x=frame===2?-3:3;camera.updateMatrixWorld();
   if(frame===2){groups[1].remove(groups[1].children[3]);groups[6].add(mesh(1,6));} // the hierarchy changes between frames
   poseScene(scene);compare(`frame ${frame}`);
  }
  // the hierarchy changes between two passes of one frame (a system adds a mesh mid-frame)
  groups[2].add(mesh(2,2));compare('after a mid-frame add');
  // a warmed flat walk re-reads no child lists: one walk per hierarchy change, not one per pass
  watch(scene);candidate.collect(scene,{camera});reads=0;
  for(const o of options)candidate.collect(scene,o);
  assert.equal(reads,0,`${reads} child-list reads in ${options.length} passes of a posed, unchanged scene (expected 0)`);
 }finally{GPU.frame=savedFrame;}
}));
