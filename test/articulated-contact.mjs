import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const [{Player},{Contact},{TerrainData},{Colliders},{DisasterField},{Vector3,PerspectiveCamera,Group},{parseGLB},{SkinnedModel},{StorageBuffer}]=await Promise.all(['player/Player.js','people/Contact.js','world/TerrainData.js','world/Colliders.js','disasters/Field.js','engine/index.js','engine/loaders/GLTF.js','engine/render/Skinning.js','engine/gpu/Texture.js'].map(p=>import(root+'/src/'+p)));
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
const {jointCoordinates}=await import(root+'/src/player/JointVelocity.js');
const V=(...a)=>new Vector3(...a),parse=b=>parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const playerSource=parse(await readFile(root+'/public/models/characters/player.glb')),terrain=new TerrainData();
test('Actual animated beach contact preserves connected joints through ordinary impact and natural recovery',async()=>{
const casts=['f01','f03','f06','f09','m01','m04','m07','m10'],clips=['idle_neutral_01','wave_01','gestic_presentation_right_01'],times=[0,.7,1.4];
for(const dt of [1/60,.1]){
for(const cast of casts){
 const source=parse(await readFile(root+'/public/models/characters/crowd/swim/'+cast+'.glb'));
 for(const clip of clips)for(const time of times){
  const input={down:()=>false,hit:()=>false,consumeLook:()=>({x:0,y:0}),consumeWheel:()=>0},colliders=new Colliders(),player=new Player({camera:new PerspectiveCamera(),input,terrain,colliders,query:{allocate:()=>0},boat:null});
  player.avatar={model:new SkinnedModel(playerSource),stepPhase:()=>null,takeStep:()=>false};player.mode='walk';player.position.set(65.93,terrain.heightAt(65.93,-48.5),-48.5);player.velocity.set(0,0,6.2);player.yaw=Math.PI;player.grounded=true;player.waterH=player.waterMean=0;
  const model=new SkinnedModel(source);model.play(clip,{fade:0,from:time});model.update(0);model.clipSet=new Set(model.clipNames());
  const p={id:1,cast,model,group:new Group(),world:V(66,terrain.heightAt(66,-48),-48),yaw:Math.atan2(9,-1),clipOf:k=>k==='idle'?'idle_neutral_01':k,brain:{type:'adult',bump(){},speak(){}},posture:'stand',footing:()=> 'open',base:V(66,terrain.heightAt(66,-48),-48),off:V(),_bv:V(),head:V()};p.group.position.copy(p.world);
  const hub={t:8.63,app:{player,colliders,disasters:{field:new DisasterField((x,z)=>terrain.heightAt(x,z))}},list:[p],grid:{near:()=>[p]}};const contact=new Contact(hub);hub.contact=contact;
  contact.prevOn=true;contact.prevAboard=false;contact.prev.copy(player.position).add(V(0,0,-6.2/60));contact.player(player,1/60);
  assert.equal(p.knock?.rag?.rd.bodies.length,14,'actual contact must start articulated motion');
  const r=p.knock.rag.rd;let frame=0,maxGap=0,maxSpin=0,maxCoordinateError=0;
  const energy=()=>r.bodies.reduce((sum,b)=>{const axis=V(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),along=axis.dot(V(b.w.x,b.w.y,b.w.z));return sum+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2)+.5*((b.w.x**2+b.w.y**2+b.w.z**2-along**2)/b.iPerp+along**2/b.iAx)+b.m*9.81*b.x.y;},.5*75*player.velocity.lengthSq()+75*9.81*player.position.y);
  const initialEnergy=energy();
  for(;frame<10/dt&&r.phase==='sim';frame++){
   player.updateWalk(dt);r.update(dt);contact.tumbles.collide(dt);
   maxSpin=Math.max(maxSpin,...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z)));
   assert.ok(energy()<=initialEnergy*1.01+1,'unforced contact cannot create kinetic plus gravitational energy');
   for(const c of r.joints){const p=c.parent,a=V(c.rP.x,c.rP.y,c.rP.z).applyQuaternion(p.q).add(V(p.x.x,p.x.y,p.x.z)),b=V(c.o.x,c.o.y,c.o.z).applyQuaternion(c.q).add(V(c.x.x,c.x.y,c.x.z));maxGap=Math.max(maxGap,a.distanceTo(b));for(const q of jointCoordinates(p,c))maxCoordinateError=Math.max(maxCoordinateError,q.min-q.angle,q.angle-q.max);}
   assert.equal(r.stats.capped,0,`${cast}/${clip}/${time}/dt${dt} frame${frame}: an ordinary impact must not require an emergency guard`);
   for(const b of r.bodies)assert.ok(Math.abs(Math.hypot(b.q.x,b.q.y,b.q.z,b.q.w)-1)<1e-8);
  }
  assert.ok(maxSpin<50,`ordinary spin must remain bounded: ${maxSpin}`);
  assert.ok(maxCoordinateError<5*Math.PI/180,`${cast}/${clip}/${time}/dt${dt}: transient joint coordinate error ${maxCoordinateError*180/Math.PI}deg`);
  assert.ok(maxGap<.025,`physical anchors must remain connected: ${maxGap}`);
  assert.equal(r.phase,'getup','unforced supported body must settle without a timer or forced pose');
  assert.ok(Math.max(r.stats.hinge,r.stats.swing,r.stats.twist)<5,`${cast}/${clip}/${time}/dt${dt}: joint limits must remain bounded (${r.stats.hinge}, ${r.stats.swing}, ${r.stats.twist})`);

 }
}
}
});
