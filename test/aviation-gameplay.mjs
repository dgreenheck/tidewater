import test from 'node:test';
import assert from 'node:assert/strict';
import {Aviation} from '../src/aviation/Aviation.js';
import {Glider} from '../src/glider/Glider.js';
import {Player} from '../src/player/Player.js';
import {Colliders} from '../src/world/Colliders.js';
import {PerspectiveCamera,Vector3} from '../src/engine/index.js';
import {poseQ,rotate} from '../src/aviation/Math.js';
import {CARRIER} from '../src/aviation/Constants.js';
import {Disasters} from '../src/disasters/Disasters.js';
import {Quaternion} from '../src/engine/index.js';
import {ThirdPersonCamera} from '../src/player/ThirdPersonCamera.js';
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);
function fixture(height=2,water=0){
 const input={keys:new Set(),pressed:new Set(),consumeLook:()=>({x:0,y:0}),down(){return false;},hit(){return false;}};
 const camera=new PerspectiveCamera(60,16/9,.1,4000),terrainData={heightAt:()=>height},colliders=new Colliders(),query={allocate:()=>0,setPoint:()=>{},version:1,cpuValid:false};
 const player=new Player({camera,input,terrain:terrainData,colliders,query,boat:null});player.position.set(54,4,-74);player.yaw=.2;player.pitch=0;player.velocity.set(0,0,0);player.mode='walk';
 const app={input,camera,player,terrainData,colliders,query,freeCam:false,cameraCut(){},disasters:{field:{waterAt:()=>water,sample:()=>({})}}};
 app.setFreeCam=value=>{app.freeCam=value;};return app;
}
test('leaving a landed glider returns walking control beside its actual touchdown',()=>{
 const app=fixture(),g=new Glider(app);g.takeControl();g.pilot=true;g.flight.phase='landed';g.flight.position=[-90,3.45,-78];
 g.leave();assert.equal(g.active,false);assert.equal(app.player.mode,'walk');assert.ok(Math.hypot(app.player.position.x+90,app.player.position.z+78)<5,'exit must stay beside the wing');near(app.player.position.y,2);assert.equal(app.player.grounded,true);
});
test('leaving a ditched glider restores local swimming and water sampling',()=>{
 const app=fixture(-80,2.5),g=new Glider(app);g.takeControl();g.pilot=true;g.flight.phase='ditched';g.flight.position=[600,2.4,-800];
 g.leave();assert.equal(app.player.mode,'swim');assert.ok(Math.hypot(app.player.position.x-600,app.player.position.z+800)<5);near(app.player.waterH,2.5);assert.equal(app.player.grounded,false);assert.equal(g.active,false);
});
test('a rejected terminal glider launch cannot seize ordinary player control',()=>{
 const app=fixture(),g=new Glider(app);g.station={launchRecord:{broken:false}};g.flight.phase='crashed';const before=app.player.position.clone();
 assert.match(g.launch(),/Reset/);assert.equal(g.active,false);assert.equal(g.pilot,false);assert.equal(app.player.mode,'walk');near(app.player.position.distanceTo(before),0);
});
test('ready fighter exit and walking deck remain on the live tilted carrier support',()=>{
 const app=fixture(-80),a=new Aviation(app);app.aviation=a;a.enter();
 assert.ok(a.deckSupport,'carrier registers a physical walking surface');
 const provider=a.deckSupport;a.carrier.position=[820,2,-940];a.carrier.quaternion=poseQ(1.1,.04,-.06);
 a.carrier.omega=[.03,.02,-.04];const expectedOmega=rotate(a.carrier.quaternion,a.carrier.omega);provider.angularVelocity().forEach((n,i)=>near(n,expectedOmega[i]));
 const feet=a.carrier.world([-12,CARRIER.deckY,25]);near(provider.groundHeightAt(feet[0],feet[2],feet[1]+.1),feet[1]);
 assert.equal(provider.groundHeightAt(feet[0],feet[2],0),-Infinity,'being under the carrier cannot board through its hull');
 assert.equal(provider.groundHeightAt(0,0,1000),-Infinity);const contact=provider.supportAt(feet,{maxRise:.45,maxDrop:.25});assert.equal(contact.provider,provider);near(contact.local[1],CARRIER.deckY);
 a.flight.reset();const origin=[...a.flight.position];a.leave();assert.equal(app.player.mode,'walk');assert.ok(Math.hypot(app.player.position.x-origin[0],app.player.position.z-origin[2])<15);near(a.carrier.local(app.player.position.toArray())[1],CARRIER.deckY,1e-6);
});
test('carrier island and parked aircraft oppose capsule traversal',()=>{
 const app=fixture(-80),a=new Aviation(app);assert.ok(a.deckSupport,'carrier has walking collision');const d=a.deckSupport;
 for(const p of [[27,CARRIER.deckY,0],[25,CARRIER.deckY,-124]]){const world=new Vector3(...a.carrier.world(p));assert.equal(d.resolveCapsule(world,.3,1.75,.4),true,'physical consumers need the collision boolean');assert.ok(world.distanceTo(new Vector3(...a.carrier.world(p)))>.3,'solid island/aircraft must move an overlapping walker out');}
});

// Exercise the production disaster restore boundary and real walking controller.
// Unrelated render/native/craft services are inert; carrier/player state is real.
test('Restore island resets moving-carrier support history before the next ordinary walking step',()=>{
 const app=fixture(-80),a=new Aviation(app);app.aviation=a;const player=app.player;
 const saved=a.carrier.world([-12,CARRIER.deckY,0]);player.resumeOnFoot({position:saved,grounded:true,provider:a.deckSupport});a.captureDisasterState();
 const playerSnapshot={p:player.position.clone(),v:player.velocity.clone(),mode:player.mode,yaw:player.yaw,pitch:player.pitch,waterState:player.captureWaterState()};
 a.carrier.position[0]+=20;player.updateWalk(1/60);near(player.position.x,saved[0]+20);
 const craft=()=>({body:{position:new Vector3(),quaternion:new Quaternion()},p:new Vector3(),q:new Quaternion()});
 app.ferry={ship:{pose(){}}};app.rally={physics:{restore_disaster_car(){}},syncModel(){},damage:{restoreDisasterState(){}},refreshIslandColliders(){}};
 app.people={contact:{wet:new Map()},evacuation:{reset(){}}};
 const disaster=Object.assign(Object.create(Disasters.prototype),{app,stop(){},humanContacts:{reset(){}},structures:{reset(){}},bodies:{reset(){}},propSnapshots:new Map(),changedPeople:new Map(),external:new Set(),field:{reset(){}},touched:new Set(),refresh(){},vesselSnapshots:{boat:craft(),ski:craft(),ship:craft(),shipState:{},skis:[],car:[],damage:{},player:playerSnapshot}});
 disaster.reset();player.updateWalk(1/60);
 player.position.toArray().forEach((n,i)=>near(n,saved[i],.002));assert.equal(player.groundSupport.provider,a.deckSupport);
});

test('ordinary walking camera casts against the moving carrier island and tilted deck through its provider',()=>{
 const app=fixture(-80),a=new Aviation(app),d=a.deckSupport,boom=new ThirdPersonCamera();
 for(const quaternion of [poseQ(Math.PI/2),poseQ(1.1,.12,-.18)]){
  a.carrier.quaternion=quaternion;
  const cast=(from,to,len)=>{const origin=new Vector3(...d.world(from)),dir=new Vector3(...d.world(to)).sub(origin).normalize();return boom.cast(app.player,origin,dir,len);};
  near(cast([17,19.6,0],[27,19.6,0],10),2,1e-7);
  near(cast([0,22,0],[0,16,0],6),4,1e-7);
  near(cast([0,16,0],[0,22,0],6),2,1e-7);
  near(cast([60,22,0],[60,16,0],6),6,1e-7);
 }
 const miss=new Vector3(...d.world([-20,18,0]));assert.equal(d.resolveCapsule(miss,.3,1.75,.4),false);
});

for(const entry of ['exit','walk'])test(`carrier ${entry} entry must seed support point velocity before an immediate jump`,()=>{
  const app=fixture(-80),a=new Aviation(app);app.aviation=a;
  a.carrier.quaternion=poseQ(1.1,.03,-.04);a.carrier.velocity=[2,.3,-.6];a.carrier.omega=[.005,.012,-.003];a.flight.reset();
  if(entry==='exit'){a.enter();a.leave();}else a.walkDeck();
  const expected=a.deckSupport.velocityAt(app.player.position);
  assert.equal(app.player.groundSupport.provider,a.deckSupport);
  app.player.velocity.toArray().forEach((n,i)=>near(n,expected[i]));
  app.input.hit=key=>key==='Space';app.player.updateWalk(1/60);
  assert.equal(app.player.grounded,false);
  near(app.player.velocity.x,expected[0]);near(app.player.velocity.z,expected[2]);
  near(app.player.velocity.y,expected[1]+4.6-9.81/60);
});
