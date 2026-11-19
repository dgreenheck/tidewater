import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Player} from '../src/player/Player.js';
import {Group,Vector3,Matrix4,PerspectiveCamera} from '../src/engine/index.js';
import {Colliders} from '../src/world/Colliders.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {loadModel} from '../src/rally/VehicleModel.js';
import {GliderBody} from '../src/glider/GliderBody.js';

// Actual recorded skin/obstacle geometry supplies the initial condition. Player's
// real update owns movement and contact; only keyboard/GPU transport is isolated.
const rows=JSON.parse(await readFile(new URL('./fixtures/glider-contact-visibility.json',import.meta.url),'utf8')).rows;
const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url));
const gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),skin=gltf.skins[0];
const bind=skin.joints.map((_,i)=>new Matrix4().fromArray(skin.inverseBindMatrices,i*16).invert());
const head=skin.joints.indexOf(gltf.nodes.findIndex(n=>n.name.endsWith('Head'))),mesh=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined);
const gliderBytes=await readFile(new URL('../public/glider/glider.glb',import.meta.url));
const glider=await loadModel('data:model/gltf-binary;base64,'+gliderBytes.toString('base64'));
const V=(...a)=>new Vector3(...a);
function fixture(row,{obstacle=true}={}){
 const input={down:()=>false,hit:()=>false,consumeLook:()=>({x:0,y:0}),consumeWheel:()=>0},query={cpuValid:true,cpu:new Float32Array([row.water,0,0,0]),allocate:()=>0,setPoint(){}};
 const player=new Player({camera:new PerspectiveCamera(60,16/9,.1,4000),input,terrain:{heightAt:()=>-20},colliders:new Colliders(),query});
 Object.assign(player,{mode:'swim',view:'third',floating:true,grounded:false,waterH:row.water,waterMean:row.water,yaw:row.yaw,pitch:0});
 player.position.fromArray(row.player);player.velocity.fromArray(row.velocity);player.camera.position.fromArray(row.eye);
 const model={gltf,skin,world:new Float32Array(gltf.nodes.length*16),group:new Group()};model.group.matrixAutoUpdate=false;model.group.matrix.fromArray(row.skin.group);model.group.updateMatrixWorld(true);
 for(const joint of row.skin.joints)model.world.set(new Matrix4().fromArray(joint.matrix).multiply(bind[joint.index]).elements,skin.joints[joint.index]*16);
 player.avatar={visible:true,view:'third',headHidden:false,model};
 const flight={position:row.aircraft.slice(),quaternion:row.quaternion.slice(),velocity:[0,0,0],omega:[0,0,0],phase:'ditched'},body=new GliderBody(glider.root,flight);
 if(obstacle)player.obstacleProviders.add(body);
 return {player,body};
}
function edges(row){
 const matrices=new Map(row.skin.joints.map(j=>[j.index,new Matrix4().fromArray(j.matrix)])),group=new Matrix4().fromArray(row.skin.group),out=[];
 for(const primitive of gltf.meshes[mesh.mesh]){
  const A=primitive.attributes,p=A.POSITION.array,j=A.JOINTS_0.array,w=A.WEIGHTS_0.array,vertices=[];
  for(let i=0;i<p.length/3;i++){
   let sum=0,influence=0;for(let k=0;k<4;k++){sum+=w[i*4+k];if(j[i*4+k]===head)influence+=w[i*4+k];}
   if(influence/sum<=.45){vertices.push(null);continue;}
   const point=V();let complete=true;for(let k=0;k<4;k++)if(w[i*4+k]){const m=matrices.get(j[i*4+k]);if(!m){complete=false;break;}point.addScaledVector(V(...p.slice(i*3,i*3+3)).applyMatrix4(m),w[i*4+k]/sum);}
   vertices.push(complete?point.applyMatrix4(group):null);
  }
  const seen=new Set(),I=primitive.indices;for(let i=0;i<I.length;i+=3)for(let k=0;k<3;k++){const a=I[i+k],b=I[i+(k+1)%3],key=a<b?a+','+b:b+','+a;if(seen.has(key)||!vertices[a]||!vertices[b])continue;seen.add(key);out.push([vertices[a],vertices[b]]);}
 }
 return out;
}
function crossings(body,list,delta=V()){
 let count=0;for(const [a,b]of list){const d=b.clone().sub(a),n=d.length();if(n>1e-8&&body.cameraRaycast(a.clone().add(delta),d.divideScalar(n),n)<n-1e-6)count++;}return count;
}
import {Avatar} from '../src/player/Avatar.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
const write=StorageBuffer.prototype.write,assetFile=globalThis.__assetFile;
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
globalThis.__assetFile=async url=>{const b=await readFile(new URL('../public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
test.after(()=>{StorageBuffer.prototype.write=write;if(assetFile===undefined)delete globalThis.__assetFile;else globalThis.__assetFile=assetFile;});
class PoseAvatar extends Avatar{async load(){}}
async function actualFixture(row,{obstacle=true}={}){
 const f=fixture(row),p=f.player,a=new PoseAvatar(new Group());await a.ready;a.setup(new SkinnedModel(gltf),gltf,'player.glb');p.avatar=a;
 // Given an ordinary authored swim pose. The obstacle is added only after pose
 // preparation, so setup cannot perform the contact claimed by the update.
 p.obstacleProviders.clear();for(let i=0;i<90;i++)p.updateAvatar(1/60);if(obstacle)p.obstacleProviders.add(f.body);
 return f;
}
function displayedEdges(player){
 const m=player.avatar.model;player.avatar.group.updateMatrixWorld(true);
 return edges({skin:{group:m.group.matrixWorld.toArray(),joints:skin.joints.map((_,index)=>({index,matrix:Array.from(m.jointData.slice(index*16,index*16+16))}))}});
}
const step=p=>{p.update(1/60);p.updateAvatar(1/60);};
test('The physical body and displayed swimming head clear actual cloth and frame through Player and Avatar',async t=>{
 for(const frame of [890,892,900,910,935]){
  const row=rows.find(r=>r.frame===frame),{player,body}=await actualFixture(row),before=player.position.clone();
  const initial=crossings(body,displayedEdges(player));assert.ok(initial>500,'retain the actual authored swim animation intersecting the wreck');
  const resolve=body.resolveCapsule.bind(body),calls=[];body.resolveCapsule=(feet,r,h,context)=>{
   const prior=player.velocity.lengthSq(),result=resolve(feet,r,h,context);calls.push(context.headOnly?'head':'upright');
   assert.ok(player.velocity.lengthSq()<=prior+1e-10,'stationary wreck contact cannot add body kinetic energy');return result;
  };
  step(player);
  const remaining=crossings(body,displayedEdges(player));
  assert.equal(remaining,0,`frame${frame}: actual post-contact avatar remains inside the wreck`);
  assert.deepEqual(calls,['upright','head'],'upright and actual-pose head each have one contact owner');
  assert.equal(body.lastContact?.kind,'head');assert.ok(player.position.distanceTo(before)<.7);assert.equal(player.mode,'swim');
  assert.ok([...player.position.toArray(),...player.velocity.toArray()].every(Number.isFinite));
  assert.ok(player.velocity.clone().sub(V(...body.lastContact.bodyVelocity)).dot(V(...body.lastContact.normal))>=-1e-7);
  const paused=JSON.stringify([player.position,player.velocity]);player.updateAvatar(0);assert.equal(JSON.stringify([player.position,player.velocity]),paused);
  t.diagnostic(JSON.stringify({frame,initial,remaining,correction:player.position.clone().sub(before).toArray()}));
 }
});
test('Sustained ordinary swimming contact keeps the displayed skull clear without ratcheting the physical anchor away',async t=>{
 for(const frame of [890,935]){
  const row=rows.find(r=>r.frame===frame),{player,body}=await actualFixture(row),before=player.position.clone();let maximumDistance=0;
  assert.ok(crossings(body,displayedEdges(player))>500);
  for(let i=0;i<120;i++){
   step(player);assert.equal(crossings(body,displayedEdges(player)),0,`frame${frame}+${i}: displayed head intersects wreck`);
   maximumDistance=Math.max(maximumDistance,player.position.distanceTo(before));assert.equal(player.mode,'swim');assert.ok([...player.position.toArray(),...player.velocity.toArray()].every(Number.isFinite));
  }
  assert.ok(maximumDistance<2,'a recurring pose correction cannot walk the physical anchor away from contact');
  t.diagnostic(JSON.stringify({frame,maximumDistance,contacts:body.contacts,final:player.position.toArray()}));
 }
});
test('A distant posed-head obstacle leaves ordinary swimming, avatar placement and the water owner unchanged',async()=>{
 const row=rows.find(r=>r.frame===890),a=await actualFixture(row),b=await actualFixture(row,{obstacle:false});a.body.flight.position[0]+=100;
 for(let i=0;i<120;i++){step(a.player);step(b.player);assert.ok(a.player.position.distanceTo(b.player.position)<1e-10);assert.ok(a.player.velocity.distanceTo(b.player.velocity)<1e-10);assert.ok(a.player.avatar.group.position.distanceTo(b.player.avatar.group.position)<1e-10);}
 assert.equal(a.player.waterH,b.player.waterH);assert.equal(a.player.floating,b.player.floating);assert.equal(a.body.contacts,0);
});

for(const boundary of ['Restore','on-foot handoff'])test(`A local swimming ${boundary} does not sweep the head through the abandoned movement path`,async()=>{
 const row=rows.find(r=>r.frame===890),actual=await actualFixture(row,{obstacle:false}),reference=await actualFixture(row,{obstacle:false});
 // Both endpoints clear the real wreck. The 1.8 m relocation crosses its sail,
 // but Restore/handoff is a new pose rather than swimming along that segment.
 const target=V(...row.player).add(V(.4,0,-.4)),prior=target.clone().add(V(0,0,1.8));
 for(const f of [actual,reference])f.player.position.copy(prior);
 actual.player.obstacleProviders.add(actual.body);
 actual.player.updateAvatar(1/60);reference.player.updateAvatar(1/60);
 assert.equal(actual.body.contacts,0,'the old pose is clear and must not be pre-corrected');
 assert.equal(crossings(actual.body,displayedEdges(actual.player)),0);
 for(const f of [actual,reference]){
  const p=f.player;
  if(boundary==='Restore'){
   const water=p.captureWaterState();p.position.copy(target);p.restoreWaterState(water);
  }else p.resumeOnFoot({position:target.clone().add(V(0,-1.458,0)).toArray(),velocity:row.velocity,yaw:row.yaw,waterHeight:row.water,grounded:false});
  assert.equal(p.mode,'swim');
 }
 // This identical avatar had no preceding obstacle history. Adding the actual
 // wreck now establishes whether the new posed endpoint itself needs contact.
 reference.player.obstacleProviders.add(reference.body);
 const before=reference.player.position.clone();
 actual.player.updateAvatar(1/60);reference.player.updateAvatar(1/60);
 assert.equal(reference.body.contacts,0,'the new endpoint has no physical contact');
 assert.equal(crossings(reference.body,displayedEdges(reference.player)),0);
 assert.ok(reference.player.position.distanceTo(before)<1e-10);
 const delta=actual.player.position.clone().sub(reference.player.position);
 assert.ok(delta.length()<1e-10,`abandoned swim history caused a phantom ${delta.length()}m correction ${JSON.stringify(delta.toArray())}`);
 assert.equal(actual.body.contacts,0);
 assert.ok(actual.player.velocity.distanceTo(reference.player.velocity)<1e-10);
 assert.ok(actual.player.avatar.group.position.distanceTo(reference.player.avatar.group.position)<1e-10);
 assert.ok(actual.player.avatar._last.distanceTo(reference.player.avatar._last)<1e-10);
 assert.equal(actual.player.waterH,reference.player.waterH);assert.equal(actual.player.floating,reference.player.floating);
});
