import test from 'node:test';
import assert from 'node:assert/strict';
import {SunShadows} from '../src/engine/render/Shadows.js';
import {Group,Mesh,BoxGeometry,PerspectiveCamera,Vector3} from '../src/engine/index.js';
const sun=new Vector3(.4,.8,.3).normalize();
function fixture(){
 const s=new SunShadows(),scene=new Group(),camera=new PerspectiveCamera(55,1.6,.1,2000);camera.lookAt(0,0,-1);
 const jet=new Mesh(new BoxGeometry(12,3,18),{});jet.castShadow=true;jet.position.set(0,0,-47);scene.add(jet);s.update(camera,sun,scene);s.periods.fill(1000);return {s,scene,camera,jet};
}
test('A fighter moving 1.45 m between rendered frames invalidates its cached self-shadow',()=>{
 const {s,scene,camera,jet}=fixture();jet.position.x+=1.45;assert.ok(s.update(camera,sun,scene).includes(1),'second cascade cannot reuse depth from the old airframe position');
 assert.deepEqual(s.update(camera,sun,scene),[],'unchanged rigid casters retain the configured cadence');
});
test('Hiding or removing a moving caster clears its old shadow footprint',()=>{
 for(const remove of [false,true]){const {s,scene,camera,jet}=fixture();if(remove)scene.remove(jet);else jet.visible=false;
  assert.ok(s.update(camera,sun,scene).includes(1),'old shadow must disappear even when the caster is no longer visited');
 }
});
test('A remote moving caster outside the cached light volumes does not force every cascade',()=>{
 const {s,scene,camera}=fixture(),remote=new Mesh(new BoxGeometry(2,2,2),{});remote.castShadow=true;remote.position.set(10000,0,0);scene.add(remote);s.update(camera,sun,scene);remote.position.x+=2;
 assert.deepEqual(s.update(camera,sun,scene),[]);
});
test('CPU-deformed fragments invalidate cached depth even when the object matrix stays fixed',()=>{
 const {s,scene,camera,jet}=fixture();const a=jet.geometry.attributes.position;for(let i=0;i<a.count;i++)a.setX(i,a.getX(i)+2);a.needsUpdate=true;
 assert.ok(s.update(camera,sun,scene).includes(1),'geometry motion must invalidate depth independently of rigid transforms');
});

test('Material visibility and instance count removal clear depth already in the cache',()=>{
 for(const hide of [o=>{o.material.visible=false;},o=>{o.geometry.instanceCount=0;}]){
  const {s,scene,camera,jet}=fixture();hide(jet);assert.ok(s.update(camera,sun,scene).includes(1));
 }
});
test('Replacing vertex storage at equal attribute version invalidates the rendered shadow',()=>{
 const {s,scene,camera,jet}=fixture(),p=jet.geometry.attributes.position;p.array=p.array.map((x,i)=>x+(i%3===0?2:0));
 assert.ok(s.update(camera,sun,scene).includes(1));
});
import {InterleavedBuffer,InterleavedBufferAttribute} from '../src/engine/index.js';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
test('Interleaved vertex edits use the backing buffer version for shadow freshness',()=>{
 const {s,scene,camera,jet}=fixture(),p=jet.geometry.attributes.position,buffer=new InterleavedBuffer(p.array.slice(),3);jet.geometry.setAttribute('position',new InterleavedBufferAttribute(buffer,3,0));s.update(camera,sun,scene);
 buffer.array[0]+=2;buffer.needsUpdate=true;assert.ok(s.update(camera,sun,scene).includes(1));
});
test('Moving a caster out of the cached light volume removes its previous silhouette',()=>{
 const {s,scene,camera,jet}=fixture();jet.position.x=10000;assert.ok(s.update(camera,sun,scene).includes(1),'test old footprint even when new bounds no longer intersect');
});
test('Empty material slots accepted by the renderer do not break shadow tracking',()=>{
 const {s,scene,camera,jet}=fixture();jet.material=[{visible:true},null];assert.doesNotThrow(()=>s.update(camera,sun,scene));
 jet.position.x+=1.45;assert.ok(s.update(camera,sun,scene).includes(1));
});

test('Stationary skinned casters still refresh depth on every rendered frame',()=>{
 const {s,scene,camera,jet}=fixture();jet.geometry._skinBounds=true;
 for(let i=0;i<5;i++)assert.ok(s.update(camera,sun,scene).includes(1),'a stationary root does not imply stationary animated joints');
});

function cpuDraws(s){
 // Keep production collection, culling, callbacks, sorting and object identity;
 // replace only the GPU submission boundary, which Node does not provide.
 const renderer=new MeshRenderer(),passes=[];s.texture.view=()=>({});
 renderer.render=(scene,pass)=>{
  const lists=renderer.collect(scene,pass);
  passes.push({camera:pass.camera,items:[...lists.opaque,...lists.transparent].map(i=>({...i,matrix:i.object.matrixWorld.elements.slice()}))});
 };
 return {renderer,passes};
}
test('A shadow batch computes world transforms once while collecting every cascade from current objects',()=>{
 const {s,scene,camera,jet}=fixture(),parent=new Group();scene.remove(jet);scene.add(parent);parent.add(jet);
 jet.material={visible:true,id:1};jet.frustumCulled=false;parent.position.set(3,2,1);
 const hidden=new Group(),hiddenJet=new Mesh(new BoxGeometry(1,1,1),{visible:true,id:2});hiddenJet.castShadow=true;hiddenJet.frustumCulled=false;hidden.add(hiddenJet);hidden.visible=false;scene.add(hidden);
 const {renderer,passes}=cpuDraws(s);let updates=0,callbacks=0;
 const update=scene.updateMatrixWorld;scene.updateMatrixWorld=function(...args){updates++;return update.apply(this,args);};
 jet.onBeforeRender=(_r,_scene,shadowCamera)=>{callbacks++;assert.ok(s.cascades.some(c=>c.camera===shadowCamera));jet.geometry.setDrawRange(3,9);};
 jet.position.x+=1.45;s.update(camera,sun,scene);s.render(scene,renderer,[0,1,2]);
 assert.equal(updates,1,'invalidation and three immediate depth passes share one current transform snapshot');
 assert.equal(callbacks,3,'each cascade retains the ordinary draw callback');
 for(const pass of passes){assert.equal(pass.items.length,1);assert.equal(pass.items[0].object,jet);assert.equal(pass.items[0].matrix[12],4.45);assert.equal(pass.items[0].matrix[13],2);assert.equal(pass.items[0].start,3);assert.equal(pass.items[0].count,9);}
});
test('Rendering without an invalidation update refreshes the scene once per complete batch',()=>{
 const {s,scene,jet}=fixture(),{renderer,passes}=cpuDraws(s);jet.material={visible:true,id:1};jet.frustumCulled=false;
 s.render(scene,renderer,[]);let updates=0;const update=scene.updateMatrixWorld;
 scene.updateMatrixWorld=function(...args){updates++;return update.apply(this,args);};
 jet.position.x=9;s.render(scene,renderer,[0,1,2]);
 jet.position.x=12;s.render(scene,renderer,[0,1,2]);
 assert.equal(updates,2);assert.deepEqual(passes.map(p=>p.items[0].matrix[12]),[9,9,9,12,12,12]);
});
test('A mesh used as the shadow scene root retains its original draw identity',()=>{
 const {s,jet}=fixture(),{renderer,passes}=cpuDraws(s);jet.material={visible:true,id:1};jet.frustumCulled=false;jet.parent=null;
 s.render(jet,renderer,[0,1,2]);
 assert.equal(passes.length,3);for(const p of passes)assert.equal(p.items[0].object,jet);
});
