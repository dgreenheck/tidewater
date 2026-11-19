import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TerrainData} from '../src/world/TerrainData.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {CoastalRoad} from '../src/world/CoastalRoad.js';
import {Village} from '../src/world/Village.js';
import {Colliders} from '../src/world/Colliders.js';
import {ReefBatch} from '../src/world/reef/ReefBatch.js';
import {Evacuation} from '../src/evacuation/Evacuation.js';
import {prepareEvacuationRoute} from '../src/evacuation/Route.js';
import {prepareWindFarmSites} from '../src/windfarm/Sites.js';
import {prepareGliderSite} from '../src/glider/Site.js';
import {buildStation} from '../src/glider/Station.js';
import {Glider} from '../src/glider/Glider.js';
import {Player} from '../src/player/Player.js';
import {Scene,Vector3,PerspectiveCamera} from '../src/engine/index.js';
import {applyTerminalSite,PLACES} from '../src/ferry/Terminal.js';
import {JOEY_VILLAGE_SITE} from '../src/joey/Village.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {DisasterField} from '../src/disasters/Field.js';
import {FerryShip} from '../src/ferry/FerryShip.js';
import {FerryDeck} from '../src/ferry/FerryDeck.js';
import {CarrierPhysics} from '../src/aviation/CarrierPhysics.js';
import {CarrierDeck} from '../src/aviation/CarrierDeck.js';
import {poseQ,advanceQ} from '../src/aviation/Math.js';

// Actual App construction order, including village terrain pads, road guardrails
// and all stair colliders. Isolate only canvas raster/GPU/image transports.
const priorDocument=globalThis.document,upload=ReefBatch.prototype.upload,texture=CoastalRoad.prototype.loadTextures,write=StorageBuffer.prototype.write;
const context=new Proxy({getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
globalThis.document={createElement:()=>({getContext:()=>context})};
ReefBatch.prototype.upload=()=>{};CoastalRoad.prototype.loadTextures=async()=>{};
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
test.after(()=>{globalThis.document=priorDocument;ReefBatch.prototype.upload=upload;CoastalRoad.prototype.loadTextures=texture;StorageBuffer.prototype.write=write;});
const terrain=new TerrainData();for(const place of Object.values(PLACES))applyTerminalSite(terrain,undefined,place);applyTerminalSite(terrain,JOEY_VILLAGE_SITE,PLACES.joey);
const colliders=new Colliders(),scene=new Scene(),village=new Village({scene,terrain,colliders});
const coastalRoute=new CoastalRoute(terrain),evac=prepareEvacuationRoute(terrain);prepareWindFarmSites(terrain);const site=prepareGliderSite(terrain,coastalRoute);
const road=new CoastalRoad(scene,terrain,coastalRoute,colliders),app={terrainData:terrain,coastalRoute,colliders,scene,village};
new Evacuation(app).build();const station=buildStation(app);
const trail=[{x:54,z:-74,y:terrain.heightAt(54,-74)},evac.entry,...evac.points,{x:47,z:-246,y:evac.refuge.y},...site.points];
const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url));
const source=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const deckData=JSON.parse(await readFile(new URL('../public/ferry/ferry_colliders.json',import.meta.url),'utf8'));
function walker(t=terrain,c=colliders){
 const keys=new Set(),pressed=new Set(),input={down:k=>keys.has(k),hit:k=>pressed.has(k),consumeLook:()=>({x:0,y:0}),consumeWheel:()=>0};
 const p=new Player({camera:new PerspectiveCamera(60,1,.1,4000),input,terrain:t,colliders:c,query:{allocate:()=>0},boat:null});
 const model=new SkinnedModel(source);model.play('idle',{fade:0});model.update(0);
 p.avatar={model,group:model.group,idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1},stepPhase:()=>null,takeStep:()=>false};
 p.grounded=true;p.waterH=p.waterMean=0;p.environment=new DisasterField((x,z)=>t.heightAt(x,z));
 const tick=dt=>{p.avatar.group.position.copy(p.position);p.avatar.group.quaternion.setFromAxisAngle(new Vector3(0,1,0),p.yaw+Math.PI);p.updateWalk(dt);};
 return {p,keys,pressed,tick};
}
for(const [name,cadence] of [['60Hz',[1/60]],['15Hz',[1/15]],['10Hz',[.1]],['alternating frames and hitch',[1/60,1/30,.1,1/60]]])test(`Real-avatar full-world summit hike keeps physical support at ${name}`,()=>{
 assert.equal(trail.length,3287);assert.ok(colliders.boxes.length>5000&&road.railColliders>1000,'retain actual road/village collision context');
 const f=walker(),p=f.p;f.keys.add('KeyW');f.keys.add('ShiftLeft');
 const guide=new Glider({...app,player:p});Object.assign(guide,{station,trail,trailIndex:0,guiding:true,trailArrived:false,ui:{message(){}}});
 let elapsed=0,frame=0,lastIndex=0,stuck=0;
 while(elapsed<230&&!guide.trailArrived){
  const dt=cadence[frame++%cadence.length],before=p.position.toArray();guide.updateHike();assert.deepEqual(p.position.toArray(),before,'guide must never place the body');f.tick(dt);elapsed+=dt;
  assert.equal(p.mode,'walk',`ordinary stairs must not trigger a fall: index=${guide.trailIndex}, p=${p.position.toArray()}, v=${p.velocity.toArray()}`);
  stuck=p.position.distanceTo(new Vector3(...before))<.005?stuck+dt:0;lastIndex=guide.trailIndex;if(stuck>4)break;
 }
 assert.equal(guide.trailArrived,true,`stalled index=${guide.trailIndex}, p=${p.position.toArray()}`);assert.ok(p.grounded&&p.position.y>305);
});

test('A real avatar descending small treads stays supported, but a cliff and an intentional jump remain airborne',()=>{
 const c=new Colliders();for(let i=0;i<20;i++)c.addBox(new Vector3(0,5-i*.18-.1,-i*.3),new Vector3(2,.1,.151),0,{walkable:true,solid:true});
 const f=walker({heightAt:()=>-100},c),p=f.p;p.position.set(0,5,0);p.yaw=0;f.keys.add('KeyW');f.keys.add('ShiftLeft');
 for(let i=0;i<35;i++){f.tick(1/60);assert.equal(p.mode,'walk');assert.ok(p.grounded,`descending tread lost support at ${p.position.toArray()}`);}
 f.pressed.add('Space');const y=p.position.y;f.tick(.1);f.pressed.clear();assert.equal(p.grounded,false);assert.ok(p.position.y>y+.2&&p.velocity.y>3,'Space must not be snapped down to the next step');
 const cliff=walker({heightAt:(x,z)=>z>=-.2?5:-100},new Colliders());cliff.p.position.set(0,5,0);cliff.p.yaw=0;cliff.keys.add('KeyW');cliff.keys.add('ShiftLeft');
 for(let i=0;i<120&&cliff.p.mode==='walk';i++)cliff.tick(1/60);
 assert.equal(cliff.p.mode,'ragdoll','a genuine ledge fall must still reach the actual articulated handoff');assert.equal(cliff.p.rag.bodies.length,14);
});

test('The actual browser descent at trail846 never accumulates a three-metre fall across small supported treads',()=>{
 const f=walker(),p=f.p;
 p.position.set(150.47828977040854,40.04230592666786,-264.0005249193997);p.velocity.set(-6.192447225542242,0,.010754775820460943);p.yaw=1.5718298021421369;p.pitch=.04;p.airTop=p.position.y;p._walkEnd=p.position.clone();
 f.keys.add('KeyW');f.keys.add('ShiftLeft');const guide=new Glider({...app,player:p});Object.assign(guide,{station,trail,trailIndex:846,guiding:true,ui:{message(){}}});
 for(let i=0;i<120;i++){guide.updateHike();f.tick(1/60);assert.equal(p.mode,'walk',`recorded descent became ${p.mode} at${guide.trailIndex}, y=${p.position.y}, vy=${p.velocity.y}`);assert.ok(p.grounded,'a .18m tread descent must retain support');}
 assert.ok(guide.trailIndex>865,'must traverse the actual reported obstruction');
});

test('A coarse frame carries the actual ferry support once and consumes the jump edge once',()=>{
 for(const dt of [1/60,1/15,.1]){
  const f=walker({heightAt:()=>-100},new Colliders()),p=f.p,ship=new FerryShip({x:0,z:0,yaw:0}),deck=new FerryDeck({ship},deckData);
  p.environment=null;ship.velocity.set(6,0,0);p.groundProviders.add(deck.support);p.position.copy(ship.toWorld(new Vector3(7.7,7,-1),new Vector3()));p.velocity.set(6,0,0);p.refreshGroundSupport();
  const before=p.position.clone();ship.position.x+=6*dt;ship.pose();let edges=0;p.input.hit=k=>{if(k==='Space')edges++;return k==='Space';};f.tick(dt);
  assert.equal(edges,1);assert.ok(Math.abs(p.position.x-before.x-6*dt)<1e-8);assert.ok(Math.abs(p.velocity.x-6)<1e-8);assert.ok(Math.abs(p.velocity.y-(4.6-9.81*dt))<1e-8);assert.equal(p.grounded,false);
 }
});

test('Idle and walking feet retain a descending carrier with actual heave, tilt and angular point velocity',()=>{
 for(const dt of [1/60,1/30,1/15,.1])for(const moving of [false,true])for(const tilted of [false,true]){
  const f=walker({heightAt:()=>-100},new Colliders()),p=f.p,carrier=new CarrierPhysics({position:[0,0,0],yaw:0}),deck=new CarrierDeck(carrier);
  p.environment=null;carrier.velocity=[.4,-1.5,.2];carrier.quaternion=tilted?poseQ(.6,.08,-.06):poseQ(0);carrier.omega=tilted?[.025,.012,.035]:[0,0,0];
  const feet=deck.world([-17,18,0]);p.resumeOnFoot({position:feet,velocity:deck.velocityAt(feet),waterHeight:0,grounded:true,provider:deck});
  p.yaw=0;if(moving)f.keys.add('KeyW');const localBefore=deck.local(p.position);
  for(let frame=0;frame<12;frame++){
   // A prescribed rigid pose isolates walking from the unrelated hull force law;
   // coordinate transforms, point velocity and capsule support are production code.
   carrier.position=carrier.position.map((n,i)=>n+carrier.velocity[i]*dt);carrier.quaternion=advanceQ(carrier.quaternion,carrier.omega,dt);f.tick(dt);
   const floor=deck.groundHeightAt(p.position.x,p.position.z,p.position.y+.45);
   assert.ok(Math.abs(p.position.y-floor)<1e-8,`descending support gap=${p.position.y-floor}, dt=${dt}, walking=${moving}, tilted=${tilted}`);
   assert.equal(p.grounded,true);assert.equal(p.groundSupport?.provider,deck);assert.ok(Math.abs(p.velocity.y-deck.velocityAt(p.position)[1])<1e-8);
  }
  if(moving)assert.ok(Math.hypot(...deck.local(p.position).filter((_,i)=>i!==1).map((n,i)=>n-localBefore[i*2]))>.1,'ordinary walking still moves along the supported deck');
 }
});

test('Movement sweeps retain accepted free-flight velocity, one shared force application, and real hard landings',()=>{
 const f=walker({heightAt:()=>-100},new Colliders()),p=f.p;p.position.set(0,20,0);p.grounded=false;p.velocity.set(4,1,0);p.airTop=null;
 const field=new DisasterField(()=>-100);p.environment=field;
 const dt=.1,motorVelocity=new Vector3(3.75,1,0),load=field.acceleration(new Vector3(0,20.9,0),motorVelocity,{mass:75,area:.7,volume:.075,height:1.8,supported:false,dt},{});
 const expected=motorVelocity.clone().add(new Vector3(load.ax*dt,load.ay*dt-9.81*dt,load.az*dt));
 f.tick(dt);assert.ok(p.velocity.distanceTo(expected)<1e-10,'subdividing contact queries must not duplicate forces');assert.ok(p.position.distanceTo(new Vector3(0,20,0).addScaledVector(expected,dt))<1e-10);
 const land=walker({heightAt:()=>0},new Colliders());land.p.position.set(0,.8,0);land.p.grounded=false;land.p.velocity.set(0,-10,0);land.p.airTop=12;
 land.tick(.1);assert.equal(land.p.mode,'ragdoll');assert.equal(land.p.rag.bodies.length,14,'hard landing still hands measured impact to physical limbs');
});
