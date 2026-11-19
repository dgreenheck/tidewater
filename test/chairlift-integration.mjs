import test from 'node:test';import assert from 'node:assert/strict';
import {TerrainData} from '../src/world/TerrainData.js';import {CoastalRoute} from '../src/world/CoastalRoute.js';import {Colliders} from '../src/world/Colliders.js';
import {Player} from '../src/player/Player.js';import {Group,Vector3,PerspectiveCamera} from '../src/engine/index.js';import {Chairlift} from '../src/chairlift/Chairlift.js';import {LIFT,prepareChairliftSite} from '../src/chairlift/Route.js';
const terrainData=new TerrainData(),coastalRoute=new CoastalRoute(terrainData);
function fixture(){const colliders=new Colliders(),input={keys:new Set(),pressed:new Set(),mouseDown:false,rightDown:false,down(k){return this.keys.has(k);},hit(k){return this.pressed.has(k);},consumeLook(){return {x:0,y:0};}},camera=new PerspectiveCamera(),player=new Player({camera,input,terrain:terrainData,colliders,query:{allocate:()=>0},boat:null}),external=new Set(),app={terrainData,coastalRoute,colliders,input,camera,player,scene:new Group(),village:{materials:{wood:{},hard:{},stone:{},rope:{},roofMetal:{}}},freeCam:false,cameraCut(){},disasters:{paused:false,field:{waterAt:()=>0,sample:()=>({wx:0,wy:0,wz:0})},structures:{addRecords(){}},registerExternal(a){external.add(a);return()=>external.delete(a);}}};const lift=new Chairlift(app).init({connector:true,panel:false});return{app,lift,external};}
const oldDocument=globalThis.document;globalThis.document={exitPointerLock(){}};test.after(()=>{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;});
function onBase(f){const {app,lift}=f,s=lift.site.base;app.player.position.set(s.board.x,s.floor,s.board.z);app.player.grounded=true;return s;}
function walkTo(p,target){p.input.keys.add('KeyW');let steps=0;for(;steps<1800&&Math.hypot(p.position.x-target.x,p.position.z-target.z)>.18;steps++){p.yaw=Math.atan2(-(target.x-p.position.x),-(target.z-p.position.z));p.updateWalk(1/60);assert.equal(p.mode,'walk','route must not require a fall or swim');}p.input.keys.clear();return steps;}

test('Actual walking capsule climbs the base approach and reaches the stopped chair on supported floors',()=>{const {app,lift}=fixture(),s=lift.site.base,p=app.player;p.position.set(s.entry.x,s.entry.y,s.entry.z);p.grounded=true;assert.ok(walkTo(p,s.exit)<1800);assert.ok(Math.abs(p.position.y-s.floor)<.05);assert.ok(app.colliders.groundHeightAt(p.position.x,p.position.z,p.position.y+.05)>s.floor-.02);assert.ok(walkTo(p,s.board)<1800);assert.equal(lift.stationSafe(s),true);});

test('The open terminal headframe has real walking collision instead of visible pass-through pillars',()=>{const {app,lift}=fixture();for(const s of lift.site.stations){const c=1.25,a=0,p=new Vector3(s.x+lift.site.right.x*c+lift.site.forward.x*a,s.floor,s.z+lift.site.right.z*c+lift.site.forward.z*a),old=p.clone();app.colliders.resolveCapsule(p,.3,1.75,.35);assert.ok(p.distanceTo(old)>.25,'visible terminal post must repel a capsule');}});

test('Occupied lift refuses an obstructed terminal exit and preserves rider position',()=>{const f=fixture(),{app,lift}=f,s=onBase(f);lift.board();assert.equal(lift.active,true);lift.transport.stop();const before=app.player.position.clone();app.colliders.addBox(new Vector3(s.exit.x,s.floor+.8,s.exit.z),new Vector3(.6,.8,.6),0,{solid:true,tag:'test-obstruction'});lift.exit();assert.equal(lift.active,true,'blocked landing cannot detach the rider');assert.ok(app.player.position.distanceTo(before)<1e-10);});

test('Pause, damaged and flooded terminal guards operate on the actual adapter and a safe exit uses the real on-foot contract',()=>{const f=fixture(),{app,lift}=f,s=onBase(f);app.disasters.paused=true;lift.board();assert.equal(lift.active,false);app.disasters.paused=false;app.player.mode='aviation';lift.board();assert.equal(lift.active,false);app.player.mode='walk';lift.board();assert.equal(lift.active,true);const saved=lift.transport.snapshot();app.disasters.paused=true;lift.update(.1);assert.deepEqual(lift.transport.snapshot(),saved);app.disasters.paused=false;lift.transport.stop();app.disasters.field.waterAt=()=>s.floor+1;lift.exit();assert.equal(lift.active,true);app.disasters.field.waterAt=()=>0;lift.model.records[0].broken=true;lift.exit();assert.equal(lift.active,true);lift.model.records[0].broken=false;lift.exit();assert.equal(lift.active,false);assert.equal(app.player.mode,'walk');assert.equal(app.player.grounded,true);assert.ok(app.player.position.distanceTo(new Vector3(s.exit.x,s.floor,s.exit.z))<1e-10);});

test('Disaster capture rollback discards an aborted baseline and repeated restore preserves the current rider state',()=>{const f=fixture(),{app,lift,external}=f,adapter=[...external][0];adapter.capture();adapter.cancelCapture?.();lift.transport.start();lift.update(.1);const changed=lift.transport.snapshot();adapter.capture();lift.update(.1);adapter.reset();assert.deepEqual(lift.transport.snapshot(),changed,'aborted capture cannot restore an earlier stale state');onBase(f);lift.transport.phase=0;lift.transport.speed=0;lift.transport.stop();lift.transport.sync();lift.board();adapter.capture();const ride=lift.transport.snapshot();lift.update(.1);adapter.reset();assert.deepEqual(lift.transport.snapshot(),ride);assert.equal(app.player.mode,'chairlift');assert.equal(lift.active,true);assert.equal(lift.snapshot,null);});

test('Rider feet use their own angular point velocity and detach only at a stopped station',()=>{const f=fixture(),{app,lift}=f;onBase(f);lift.board();const c=lift.transport.chairs[0];c.omega={x:0,y:0,z:2};c.n={x:0,y:-1,z:0};c.pivotVelocity={x:1,y:2,z:3};c.velocity={x:1+2*LIFT.hanger,y:2,z:3};lift.syncPlayer();assert.ok(Math.abs(app.player.velocity.x-(1+2*LIFT.feetDrop))<1e-12,'feet velocity must include the correct rigid offset');lift.transport.phase=lift.site.summit.distance*.5;lift.transport.sync();lift.exit();assert.equal(lift.active,true);});

test('Late site reservation covers a surveyed site without changing route height or terrain',()=>{const t=new TerrainData(),before=t.clearZones?.length??0,s=prepareChairliftSite(t,null,{reserve:false}),sample=s.sample(120),after=prepareChairliftSite(t,null,{reserve:true});assert.equal(s,after);assert.deepEqual(after.sample(120),sample);assert.ok(t.clearZones.length>before,'the first read-only survey must not suppress later vegetation reservations');const count=t.clearZones.length;prepareChairliftSite(t);assert.equal(t.clearZones.length,count);for(const along of [-12,-10,-8,-6])for(const cross of [3.6,4.7,5.8])assert.ok(t.inClearZone(s.base.x+s.forward.x*along+s.right.x*cross,s.base.z+s.forward.z*along+s.right.z*cross),'the actual graded access treads must be reserved before vegetation placement');});

import {spanBounds} from '../src/disasters/Structures.js';
import {launchLocal} from '../src/glider/Site.js';
test('Summit connector has a clear supported capsule lane and solid edge guards, while structural bounds remain world-space',()=>{const {app,lift}=fixture(),bridge=lift.site.summit.connector;assert.ok(bridge.length>0&&bridge.length<5);for(let j=1;j<20;j++){const u=j/20,p=new Vector3(bridge.a.x+(bridge.b.x-bridge.a.x)*u,bridge.a.y,bridge.a.z+(bridge.b.z-bridge.a.z)*u),floor=app.colliders.groundHeightAt(p.x,p.z,p.y+.02,.12);assert.ok(Math.abs(floor-p.y)<.01);const before=p.clone();app.colliders.resolveCapsule(p,.3,1.75,.35);assert.ok(p.distanceTo(before)<.01,'connector centre lane must remain clear');}const [cross,along]=launchLocal([bridge.b.x,bridge.b.y,bridge.b.z]);assert.ok(Math.abs(cross+7)<1e-9&&Math.abs(along+.5)<1e-9);for(const r of lift.model.records){const b=spanBounds(r.spans);assert.ok([...b.center.toArray(),...b.half.toArray()].every(Number.isFinite),r.name);}assert.ok(lift.model.triangles<60000,'chairlift geometry must fit its declared budget');});

import {readFile} from 'node:fs/promises';import {Avatar} from '../src/player/Avatar.js';import {parseGLB} from '../src/engine/loaders/GLTF.js';import {SkinnedModel} from '../src/engine/render/Skinning.js';import {StorageBuffer} from '../src/engine/gpu/Texture.js';
test('Actual player seated animation places its measured pelvis on a tilted moving chair, with no forced lifejacket',async()=>{const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url)),write=StorageBuffer.prototype.write;StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};try{const {app,lift}=fixture(),model=new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))),a=Object.create(Avatar.prototype);Object.assign(a,{group:new Group(),model,rideClips:new Map(),idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1,loop:true,speed:1,fade:.001},_off:new Vector3(),hideJoints:[],vestOn:false});a.group.add(model.group);for(const name of ['ski_sit'])a.rideClips.set(name,{clip:model.clips.get(name),time:0,weight:0,target:0,loop:true,speed:1,fade:.001});app.player.avatar=a;onBase({app,lift});lift.board();const c=lift.transport.chairs[0];c.n={x:.2,y:-Math.sqrt(.96),z:0};lift.syncPlayer();lift.updateAvatar(1/60);assert.equal(a.clip,'ski_sit');assert.equal(a.visible,true);assert.equal(a.vestOn,false);assert.equal(lift.rider.poseAvailable,true);assert.ok(lift.rider.pelvisError<1e-10);const i=lift.rider.pelvis,at=new Vector3(model.world[i*16+12],model.world[i*16+13],model.world[i*16+14]).applyQuaternion(a.group.quaternion).add(a.group.position);assert.ok(at.distanceTo(lift.rider.seat)<1e-9);assert.ok(Math.abs(a.group.quaternion.lengthSq()-1)<1e-9);assert.ok(a.group.position.distanceTo(app.player.position)<2,'model is attached to its seat, not the world origin');}finally{StorageBuffer.prototype.write=write;}});

test('Boarding requires the actual player capsule to stand on the terminal, not merely a nearby grounded flag',()=>{const f=fixture(),{app,lift}=f,s=onBase(f);app.player.position.y+=1.4;lift.board();assert.equal(lift.active,false,'an elevated nearby walking body is not on the boarding floor');app.player.position.set(s.board.x,s.floor,s.board.z);app.colliders.addBox(app.player.position.clone().add(new Vector3(0,.8,0)),new Vector3(.5,.8,.5),0,{solid:true});lift.board();assert.equal(lift.active,false,'blocked boarding volume must not be crossed by attachment');});

test('Chase camera checks moving providers and retracts immediately from a newly blocked previous lens position',()=>{const f=fixture(),{app,lift}=f;onBase(f);lift.board();lift.transport.phase=lift.site.length*.20;lift.transport.sync();lift.syncPlayer();lift.cameraMode='chase';lift.updateCamera(0);const eye=app.player.position.clone().add(new Vector3(0,1.5,0)),far=app.camera.position.clone(),mid=eye.clone().lerp(far,.5),dynamic=new Colliders();dynamic.addBox(mid,new Vector3(2,2,.1),0,{solid:true});app.player.groundProviders.add(dynamic);lift.cameraReady=false;lift.updateCamera(0);let delta=app.camera.position.clone().sub(eye),len=delta.length();assert.ok(dynamic.raycast(eye,delta.clone().normalize(),len+.01)>=len-.01,'camera must respect the moving support geometry');app.player.groundProviders.clear();app.colliders.addBox(app.camera.position.clone(),new Vector3(.8,.8,.8),0,{solid:true});lift.cameraReady=true;lift.updateCamera(.001);const at=app.camera.position.clone().add(new Vector3(0,-.15,0)),before=at.clone();app.colliders.resolveCapsule(at,.15,.3,0);assert.ok(at.distanceTo(before)<.01,`smoothing must not leave the lens inside a new obstacle ${JSON.stringify({eye:eye.toArray(),far:far.toArray(),camera:app.camera.position.toArray(),shift:at.distanceTo(before),wall:app.colliders.boxes.at(-1).center.toArray()})}`);});

test('Boarding and dismount wait for a swinging chair to settle even when it crosses upright at a stopped cable',()=>{const f=fixture(),{app,lift}=f;onBase(f);const c=lift.transport.chairs[0];c.omega={x:0,y:0,z:4};c.velocity={x:4*LIFT.hanger,y:0,z:0};lift.board();assert.equal(lift.active,false,'upright orientation alone cannot make a 16.6 m/s foot point boardable');c.omega={x:0,y:0,z:0};c.velocity={x:0,y:0,z:0};lift.board();assert.equal(lift.active,true);lift.transport.stop();c.omega={x:0,y:0,z:4};c.velocity={x:4*LIFT.hanger,y:0,z:0};lift.syncPlayer();lift.exit();assert.equal(lift.active,true,'moving seat cannot be dismounted as if standing');c.omega={x:0,y:0,z:0};c.velocity={x:0,y:0,z:0};lift.syncPlayer();lift.exit();assert.equal(lift.active,false);});

import {LiftTransport} from '../src/chairlift/Transport.js';
test('Repeated station calls retain the actual stopped chair through a full adapter roundtrip and reboarding',()=>{
 for(const cruise of [3,5]){
  const f=fixture(),{app,lift}=f;onBase(f);lift.transport.setSpeed(cruise);lift.board();assert.equal(lift.active,true);
  for(const station of [lift.site.summit,lift.site.base]){
   let steps=0;while(steps++<2600&&(lift.transport.running||!lift.transport.docked(lift.transport.chairs[lift.chairId],station)))lift.update(.1);
   assert.ok(steps<2600,'ordinary service must arrive and naturally settle');const id=lift.chairId;
   lift.exit();assert.equal(lift.active,false);assert.equal(app.player.mode,'walk');assert.equal(app.player.grounded,true);
   const phase=lift.transport.phase,motor=lift.transport.motorDistance,chairs=structuredClone(lift.transport.chairs);
   for(let repeat=0;repeat<3;repeat++){
    lift.callChair();assert.equal(lift.transport.running,false,'redundant Call must keep the available stopped chair');
    assert.equal(lift.transport.docking.chairId,id,'service must not skip the chair already at the terminal');
    assert.equal(lift.transport.phase,phase);assert.equal(lift.transport.motorDistance,motor);assert.deepEqual(lift.transport.chairs,chairs,'Call must not reset chair pose or swing');
   }
   for(let i=0;i<12;i++)lift.update(1/60);assert.equal(lift.transport.phase,phase,'the next frames must not restart the stopped cable');
   lift.board();assert.equal(lift.active,true);assert.equal(lift.chairId,id);assert.equal(lift.transport.running,true,'boarding still requests the opposite terminal');
  }
 }
});

test('Station service uses the existing signed docking tolerance without snapping nearby or out-of-range chairs',()=>{
 const s=prepareChairliftSite(terrainData,coastalRoute);
 for(const station of s.stations)for(const offset of [-.026,-.024,-1e-10,0,1e-10,.024,.026]){
  const t=new LiftTransport(s),snapshot=t.snapshot();snapshot.phase=((station.distance+offset)%s.length+s.length)%s.length;t.restore(snapshot);
  const phase=t.phase,chairs=structuredClone(t.chairs);assert.equal(t.requestDock(station),true);
  assert.equal(t.running,Math.abs(offset)>.025,`station ${station.name}, signed phase offset ${offset}`);
  if(Math.abs(offset)<.025)assert.equal(t.docking.chairId,0,'phase wrap cannot replace the stopped chair with the following one');
  assert.equal(t.phase,phase,'a service call must not snap the cable to the stop');assert.deepEqual(t.chairs,chairs);
 }
});

test('Repeated calls hold a phase-aligned chair while its actual swing settles instead of restarting or resetting it',()=>{
 const s=prepareChairliftSite(terrainData,coastalRoute),t=new LiftTransport(s),c=t.chairs[0];c.omega={x:0,y:0,z:4};t.sync();
 const reference=new LiftTransport(s);reference.restore(t.snapshot());assert.equal(t.docked(c,s.base),false,'fixture starts physically unsafe to board');
 for(let i=0;i<300;i++){
  const chairs=structuredClone(t.chairs);t.requestDock(s.base);assert.equal(t.running,false,'Call must wait for the present chair to settle');assert.deepEqual(t.chairs,chairs);
  t.advance(.1);reference.advance(.1);assert.equal(t.phase,0);assert.deepEqual(t.chairs,reference.chairs,'service calls must preserve unforced pendulum evolution');
 }
 assert.equal(t.docked(c,s.base),true,'ordinary damping must eventually make the held chair boardable');
});

test('Calling a boardable chair during interrupted departure preserves the actual braking trajectory',()=>{
 const s=prepareChairliftSite(terrainData,coastalRoute);
 for(const station of s.stations){
  const t=new LiftTransport(s);t.phase=station.distance;t.sync();t.start();for(let i=0;i<4;i++)t.advance(1/60);t.stop('Interrupted during departure');t.advance(1/60);
  const c=t.chairs[0],reference=new LiftTransport(s);reference.restore(t.snapshot());assert.ok(t.speed>0&&t.speed<.03);assert.equal(t.docked(c,station),true);
  for(let i=0;i<12;i++){
   const phase=t.phase,speed=t.speed,chairs=structuredClone(t.chairs);assert.equal(t.requestDock(station),true);assert.equal(t.running,false,'a boardable braking chair must not be replaced by the next chair');assert.equal(t.phase,phase);assert.equal(t.speed,speed);assert.deepEqual(t.chairs,chairs);
   t.advance(1/60);reference.advance(1/60);assert.equal(t.phase,reference.phase,'Call must retain natural stopping distance');assert.equal(t.speed,reference.speed);assert.deepEqual(t.chairs,reference.chairs,'Call must not introduce pivot acceleration by snapping braking velocity');
  }
  assert.equal(t.speed,0);assert.equal(t.docked(c,station),true);
 }
});
