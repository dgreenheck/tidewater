import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Player} from '../src/player/Player.js';
import {Contact} from '../src/people/Contact.js';
import {Tumbles} from '../src/people/Tumble.js';
import {Crowd} from '../src/ferry/Crowd.js';
import {FerryDeck} from '../src/ferry/FerryDeck.js';
import {FerryShip} from '../src/ferry/FerryShip.js';
import {DisasterField} from '../src/disasters/Field.js';
import {Disasters} from '../src/disasters/Disasters.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {Ragdoll} from '../src/player/Ragdoll.js';
import {Vector3,Group,PerspectiveCamera} from '../src/engine/index.js';
import {Colliders} from '../src/world/Colliders.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';

const V=(...a)=>new Vector3(...a);
const bytes=await readFile(new URL('../public/models/characters/player.glb',import.meta.url));
const deckData=JSON.parse(await readFile(new URL('../public/ferry/ferry_colliders.json',import.meta.url),'utf8'));
const crowdAssets=await Promise.all(['f01','m01','f03','m04','f06','m07','f09','m10'].map(async cast=>({cast,bytes:await readFile(new URL(`../public/models/characters/crowd/${cast}.glb`,import.meta.url))})));
const write=StorageBuffer.prototype.write;
// Transport seam only: actual GLB, skeleton, constraints and control methods.
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
test.after(()=>{StorageBuffer.prototype.write=write;});
const model=()=>new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
function playerFixture(ground=0){
 const terrain={heightAt:()=>ground},colliders=new Colliders(),keys=new Set();
 const input={down:k=>keys.has(k),hit:()=>false,consumeLook:()=>({x:0,y:0}),consumeWheel:()=>0};
 const query={cpuValid:true,version:1,cpu:new Float32Array(4),allocate:()=>0,setPoint(){}};
 const player=new Player({camera:new PerspectiveCamera(60,1,.1,1000),input,terrain,colliders,query});
 player.view='first';player.position.set(0,ground,0);player.grounded=true;player.waterMean=0;
 const m=model();player.avatar={model:m,group:m.group,idle:{clip:m.clips.get('idle'),time:0,weight:1,target:1},stepPhase:()=>null,takeStep:()=>false};
 player.avatar.group.position.copy(player.position);
 const field=new DisasterField(terrain.heightAt),owner=Object.assign(Object.create(Disasters.prototype),{field,app:{player,people:{list:[]},freeCam:false}});
 return {player,field,keys,tick(dt=1/60){owner.people(dt);player.update(dt);}};
}
function tumbleFixture(){
 const player={terrain:{heightAt:()=>-1000},colliders:new Colliders(),avatar:{model:model()}},hub={app:{player},list:[]};
 const tumbles=new Tumbles(hub);
 const person=()=>({model:model(),clipOf:k=>k,brain:{type:'adult'},group:{position:V(0,100,0)},world:V(0,100,0),yaw:0});
 return {player,hub,tumbles,person};
}
test('Production walking player releases control to 14 physical bodies in a strong vortex',()=>{
 const f=playerFixture();f.player.position.set(20,0,0);f.player.avatar.group.position.copy(f.player.position);
 const e=f.field.start('tornado',{x:0,z:0,intensity:120,radius:180,speed:0});e.time=2;f.keys.add('KeyW');
 f.tick();assert.equal(f.player.mode,'ragdoll');assert.equal(f.player.ragFrom,'walk');assert.equal(f.player.rag.bodies.length,14);
 assert.equal(f.player.rag.disasterField,f.field);
 for(const b of f.player.rag.bodies){assert.ok(V(b.v.x,b.v.y,b.v.z).distanceTo(f.player.velocity)<1e-9);assert.deepEqual(b.w,{x:0,y:0,z:0});}
});
test('Velocity-only NPC handoff conserves incoming translation without random angular or repeated kick energy',()=>{
 const f=tumbleFixture(),p=f.person(),v=V(20,0,0),r=f.tumbles.start(p,v,null,V(0,101.3,0)).rd;
 assert.equal(r.bodies.length,14);assert.equal(r.joints.length,13);assert.equal(r.bodies.reduce((s,b)=>s+b.m,0),72);
 for(const b of r.bodies){assert.ok(V(b.v.x,b.v.y,b.v.z).distanceTo(v)<1e-10);assert.deepEqual(b.w,{x:0,y:0,z:0});}
 const ke=r.bodies.reduce((s,b)=>s+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2),0);assert.ok(Math.abs(ke-.5*72*400)<1e-8);
 assert.ok(!r.flail,'no hidden random actuator remains armed after an inherited-velocity handoff');
});
test('An airborne articulated body cannot switch to a get-up because a twelve-second timer expired',()=>{
 const f=tumbleFixture(),r=f.tumbles.start(f.person(),V(),null,null).rd;
 r.t=12.1;r.update(1/60);assert.equal(r.phase,'sim');assert.equal(r.supported,false);
});
test('Exact player/NPC overlap separates by the capsule radius, never hundreds of metres',()=>{
 const p={world:V(),posture:'stand',knock:{},yaw:0},hub={t:0,app:{},grid:{near:()=>[p]}};
 const c=new Contact(hub),pl={position:V(),velocity:V(),mode:'walk',yaw:0};c.player(pl,1/60);
 assert.ok(pl.position.length()>.56&&pl.position.length()<.58,`separation ${pl.position.length()}`);
});
function ferryFixture(){
 const ship=new FerryShip({x:0,z:0,yaw:0}),ferry={ship,gangway:0,castingOff:false};
 ferry.deck=new FerryDeck(ferry,deckData);const crowd=Object.assign(Object.create(Crowd.prototype),{ferry,hub:{t:0,contact:{boards:()=>false,body:()=>null}},fallen:[],frame:0});
 return {ship,ferry,deck:ferry.deck,crowd};
}
test('Ferry knock support uses actual deck extent, height and furniture collisions',()=>{
 const {ship,crowd}=ferryFixture(),p={local:V(0,7,0),at:['S',0,7,0]};
 const world=a=>ship.toWorld(V(...a),V()),base=world([0,7,0]);
 assert.equal(crowd.canStand(p,world([0,7,100]),base),false);
 assert.equal(crowd.canStand(p,world([0,30,0]),base),false);
 assert.equal(crowd.canStand(p,world([7.7,7,-1]),base),true);
});
test('Boarding a ferry reattaches its controller after an activity cleared vessel ownership',()=>{
 const {ship,deck}=ferryFixture(),pl={vessel:null,mode:'walk',velocity:V(),yaw:0};
 deck.board(pl,ship.toWorld(V(0,7,0),V()));assert.ok(pl.vessel===deck);assert.equal(pl.mode,'ferry');
});
test('An already-created terminal/ship passenger route stops when its gangway disconnects',()=>{
 const {ship,ferry,crowd}=ferryFixture();ship.moored=false;ferry.castingOff=true;
 const terminal={yaw:0,toWorld:(a,o)=>o.set(...a)};
 const p={id:1,path:[['T',0,7,-40],['S',0,7,0]],at:['S',0,7,0],s:0,pace:1.4,world:V(0,7,-40),base:V(0,7,-40),based:true,terminal,
  state:'board',brain:{gesture:null,target:null},group:new Group(),model:{current:'idle_neutral_01',play(){},clipSet:new Set()},lod:'far',yaw:0,look:0,pitch:0,tuck:0,acc:0,head:V(),walk:1.4};
 crowd.step(p,1,V(1000,7,0),V(0,0,-1));assert.ok(p.world.distanceTo(V(0,7,-40))<1e-8,`unsupported route moved ${p.world.toArray()}`);assert.equal(p.s,0);
});
test('An already-floating player cannot follow an extreme crest by an unmeasured position jump',()=>{
 for(const dt of [1/60,.1]){
  const f=playerFixture(-100);f.player.avatar=null;f.player.mode='swim';f.player.position.set(0,-.062,0);f.player.floating=true;f.player.waterMean=0;f.player.query.cpu[0]=3000;
  const before=f.player.position.y;f.tick(dt);
  assert.ok(Math.abs(f.player.position.y-before)<=10*dt*dt+1e-8,`dt=${dt}, displacement=${f.player.position.y-before}`);
  assert.ok(Math.abs((f.player.position.y-before)/dt-f.player.velocity.y)<1e-8,'position must integrate the reported body velocity');
 }
});
function energy(r){return r.bodies.reduce((s,b)=>{
 const ax=V(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),w=V(b.w.x,b.w.y,b.w.z),along=w.dot(ax);
 return s+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2)+.5*((w.lengthSq()-along*along)/b.iPerp+along*along/b.iAx);
},0);}
test('A real walking impact gives equal opposite momentum without scripted upward launch energy',()=>{
 const f=tumbleFixture(),p=f.person();p.group.position.set(0,0,0);p.world.set(0,0,0);p.base=V();p.off=V();p._bv=V();p.posture='stand';p.footing=()=> 'open';p.brain.bump=()=>{};
 const c=new Contact(Object.assign(f.hub,{t:10,grid:{near:()=>[p]}}));p.model.clipSet=new Set(p.model.clipNames());
 c.prevOn=true;c.prevAboard=false;c.prev.set(-.5-6.2/60,0,0);
 const pl={position:V(-.5,0,0),velocity:V(6.2,0,0),mode:'walk',yaw:0};c.player(pl,1/60);
 assert.equal(p.knock.kind,'tumble');const r=p.knock.rag.rd;
 const momentum=r.bodies.reduce((s,b)=>s.addScaledVector(V(b.v.x,b.v.y,b.v.z),b.m),pl.velocity.clone().multiplyScalar(75));
 assert.ok(momentum.distanceTo(V(75*6.2,0,0))<1e-8,`total momentum ${momentum.toArray()}`);
 assert.ok(energy(r)+.5*75*pl.velocity.lengthSq()<=.5*75*6.2**2+1e-7);
 assert.ok(r.bodies.some(b=>Math.hypot(b.w.x,b.w.y,b.w.z)>0),'a real off-centre contact may impart torque');
});
test('An ordinary beach impact uses actual capsule normals instead of an off-surface forearm torque',async()=>{
 const f=tumbleFixture(),terrain=new TerrainData();f.player.terrain=terrain;
 const bytes=await readFile(new URL('../public/models/characters/crowd/swim/f01.glb',import.meta.url)),p=f.person();
 p.model=new SkinnedModel(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));p.model.play('idle_neutral_01',{fade:0});p.model.update(0);p.model.clipSet=new Set(p.model.clipNames());p.clipOf=k=>k==='idle'?'idle_neutral_01':k;
 p.group.position.set(66,terrain.heightAt(66,-48),-48);p.world.copy(p.group.position);p.base=p.world.clone();p.off=V();p._bv=V();p.posture='stand';p.footing=()=> 'open';p.brain.bump=()=>{};p.yaw=Math.atan2(9,-1);
 const c=new Contact(Object.assign(f.hub,{t:8.63,grid:{near:()=>[p]}}));
 const pl={position:V(65.93,terrain.heightAt(65.93,-48.5),-48.5),velocity:V(0,0,6.2),mode:'walk',yaw:Math.PI};
 c.prevOn=true;c.prevAboard=false;c.prev.copy(pl.position).add(V(0,0,-6.2/60));c.player(pl,1/60);assert.equal(p.knock.kind,'tumble');const r=p.knock.rag.rd;
 assert.ok(Math.max(...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z)))<40,'ordinary normal contact must not invent axial forearm spin');
 const total=r.bodies.reduce((v,b)=>v.addScaledVector(V(b.v.x,b.v.y,b.v.z),b.m),pl.velocity.clone().multiplyScalar(75));
 assert.ok(total.distanceTo(V(0,0,75*6.2))<1e-8);assert.ok(energy(r)+.5*75*pl.velocity.lengthSq()<=.5*75*6.2**2+1e-7);
 assert.ok(p.knock.contacts.length>0,'handoff must resolve actual walker/segment overlap');
 for(const hit of p.knock.contacts){const b=r.bodies[hit.body],axis=V(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),arm=V(hit.point.x-b.x.x,hit.point.y-b.x.y,hit.point.z-b.x.z),normal=V(hit.normal.x,hit.normal.y,hit.normal.z);assert.ok(Math.abs(arm.cross(normal).dot(axis))<1e-8,'a capsule surface normal cannot apply axial torque');}
});
test('All 58 loaded people can receive full mass-preserving articulated rigs',()=>{
 const f=tumbleFixture();for(let i=0;i<58;i++){const p=f.person();p.group.position.x=i*4;f.hub.list.push(p);const r=f.tumbles.start(p,V(),null,null);assert.ok(r,`person ${i}`);assert.equal(r.rd.bodies.length,14);assert.equal(r.rd.joints.length,13);assert.equal(r.rd.bodies.reduce((s,b)=>s+b.m,0),72);}
 assert.equal(f.tumbles.live.size,58);
});
test('Neighboring articulated people receive separating impulses, with no collision energy source',()=>{
 const f=tumbleFixture(),a=f.person(),b=f.person();a.group.position.x=-.22;b.group.position.x=.22;
 const A=f.tumbles.start(a,V(1,0,0),null,null).rd,B=f.tumbles.start(b,V(-1,0,0),null,null).rd;
 a.knock={rag:{rd:A,avatar:f.tumbles.rig(a).avatar}};b.knock={rag:{rd:B,avatar:f.tumbles.rig(b).avatar}};
 const before=energy(A)+energy(B),momentum=()=>[A,B].reduce((v,r)=>r.bodies.reduce((s,b)=>s.addScaledVector(V(b.v.x,b.v.y,b.v.z),b.m),v),V());
 const m=momentum();f.tumbles.collide?.(1/60);
 assert.ok(f.tumbles.contacts?.people>0,'actual capsule pairs must meet');assert.ok(energy(A)+energy(B)<=before+1e-7,`${before} -> ${energy(A)+energy(B)}`);assert.ok(momentum().distanceTo(m)<1e-7);
 assert.ok(A.bodies.some(b=>b.v.x<.95)&&B.bodies.some(b=>b.v.x>-.95));
});
test('A ferry ragdoll queries its real moving tilted deck and starts with point velocity',()=>{
 const f=tumbleFixture(),{ship,deck}=ferryFixture();f.player.groundProviders=new Set([deck.support]);ship.pitch=.025;ship.roll=-.02;ship.velocity.set(0,0,3);ship.pose();
 const p=f.person();ship.toWorld(V(7.7,7,-1),p.group.position);p.world.copy(p.group.position);
 const v=ship.velocityAt(p.world,V()),r=f.tumbles.start(p,v,null,null).rd,feet=p.world;
 assert.ok(Math.abs(r.ground(feet.x,feet.z,feet.y+.1)-feet.y)<1e-7);assert.equal(r.groundProvider,deck.support);
 for(const b of r.bodies)assert.ok(V(b.v.x,b.v.y,b.v.z).distanceTo(v)<1e-9);
 const prior=deck.groundHeightAt(feet.x,feet.z,feet.y+.1);ship.position.y+=.2;ship.pose();assert.ok(deck.groundHeightAt(feet.x,feet.z,feet.y+.5)>prior+.19);
});
test('Recovery on a moved ferry anchors the reached position, not the stale route over water',()=>{
 const {ship,crowd}=ferryFixture(),at=ship.toWorld(V(7.7,7,-1),V()),p={world:V(100,0,100),base:V(100,0,100),off:V(20,0,0),path:[['T',1,7,9],['S',7.7,7,-1]],state:'board',s:4};
 crowd.recoverAt(p,at);assert.equal(p.path,null);assert.equal(p.at[0],'S');assert.ok(p.world.distanceTo(at)<1e-10);assert.equal(p.off.length(),0);assert.equal(p.aboard,true);
});
test('Moving support carries once on a jump and hands the measured platform velocity to flight',()=>{
 const f=playerFixture(-100),{ship,deck}=ferryFixture(),p=f.player;ship.velocity.set(6,0,0);p.groundProviders.add(deck.support);
 p.position.copy(ship.toWorld(V(7.7,7,-1),V()));p.velocity.set(6,0,0);p.grounded=true;p.refreshGroundSupport();
 const start=p.position.clone();ship.position.x+=.1;ship.pose();p.input.hit=k=>k==='Space';p.updateWalk(1/60);
 assert.ok(Math.abs(p.position.x-start.x-.1)<1e-8);assert.ok(Math.abs(p.velocity.x-6)<1e-8);assert.ok(p.velocity.y>4&&p.velocity.y<4.6);assert.equal(p.groundSupport,null);
});
test('An actual midspan passenger falls physically when both the gangway and deck support are gone',()=>{
 const {ferry,crowd}=ferryFixture();ferry.castingOff=true;let fallen=null;crowd.hub.contact.environment=p=>{fallen=p;p.knock={physical:true};};
 const p={id:1,path:[['T',0,7,-40],['S',0,7,0]],at:['S',0,7,0],s:3,pace:1.4,world:V(0,7,-37),base:V(0,7,-37),based:true,terminal:{yaw:0,toWorld:(a,o)=>o.set(...a)},state:'board',brain:{},group:new Group(),model:{current:'idle_neutral_01',play(){},clipSet:new Set()},lod:'far',yaw:0,look:0,pitch:0,tuck:0,acc:0,head:V(),walk:1.4};
 crowd.step(p,1/60,V(1000,7,0),V(0,0,-1));assert.ok(fallen===p,'lost support must hand the existing person to the production environmental fall path');assert.equal(p.s,3);assert.ok(p.world.distanceTo(V(0,7,-37))<1e-8);
});
test('A zero-closing spinning capsule overlap cannot gain rotational energy during stabilization',async()=>{
 const {solveCapsules}=await import('../src/people/ArticulatedContacts.js');
 const solver=Object.create(Ragdoll.prototype),body=(x,y)=>({x:{x,y,z:0},v:{x:0,y:0,z:0},w:{x:0,y:6,z:0},q:{x:0,y:0,z:0,w:1},ax:{x:0,y:1,z:0},len:1,r:.2,m:10,im:.1,iAx:5,iPerp:1});
 const a=body(0,0),b=body(.3,.3),rig={bodies:[a,b]},before=energy(rig);const c=solveCapsules(solver,a,solver,b);
 assert.equal(c.impulse,0);assert.ok(energy(rig)<=before+1e-12,`${before} -> ${energy(rig)}`);assert.deepEqual(a.q,{x:0,y:0,z:0,w:1});
});
test('A recovered NPC swimmer is carried by actual current with its own body mass',()=>{
 const f=tumbleFixture(),p=f.person(),field=new DisasterField(()=>-20);field.water=new WaterGrid(()=>-20,{n:17,dx:16,x:0,z:0});
 for(let i=0;i<field.water.h.length;i++){field.water.h[i]=20;field.water.qx[i]=80;}field.water.pack();
 f.hub.app.disasters={field};f.hub.app.colliders=f.player.colliders;f.player.groundAt=()=>-20;f.hub.t=0;
 p.brain.speak=()=>{};p.model.clipSet=new Set(p.model.clipNames());p.base=V(0,-1.45,0);p.off=V();p.world.copy(p.base);
 const c=new Contact(f.hub),r=c.tumbles.start(p,V(),null,null);p.knock={kind:'tumble',rag:r,t0:0,nx:1,nz:0};c.tumbles.end(p,r,true);c.dunk(p,p.knock,{at:V(),yaw:0},0);p.knock.sw.waiting=true;
 for(let i=0;i<180;i++){p.world.copy(p.base);f.hub.t+=1/60;c.body(p,1/60);}
 assert.ok(p.knock.sw.at.x>6,`swimmer current displacement ${p.knock.sw.at.x}`);assert.ok(p.knock.sw.velocity.x>3);assert.equal(p.knock.sw.motor.body.mass,72);
});
test('A person walking the actual ferry can release deck locomotion to physical wind capture',()=>{
 const f=playerFixture(-100),{ship,deck}=ferryFixture(),p=f.player;p.groundProviders?.add(deck.support);p.position.copy(ship.toWorld(V(7.7,7,-1),V()));p.avatar.group.position.copy(p.position);deck.board(p,p.position);
 p.environment=f.field;const e=f.field.start('tornado',{x:p.position.x-20,z:p.position.z,intensity:120,radius:180,speed:0});e.time=2;
 deck.walk(p,1/60);assert.equal(p.mode,'ragdoll');assert.equal(p.ragFrom,'ferry');assert.equal(p.rag.bodies.length,14);assert.equal(p.rag.disasterField,f.field);
});
test('The ferry point-velocity API includes measured heave, pitch and roll without treating a reset as an impulse',()=>{
 for(const dt of [1/120,1/60,.1]){
  const ship=new FerryShip({x:0,z:0,yaw:0});ship.environment={sample:()=>({height:0,ux:0,uz:0,wx:0,wz:0}),waterAt:(x,z)=>.15*Math.sin(2*ship.time)*(z-ship.position.z)+.08*Math.cos(ship.time)*(x-ship.position.x)};
  for(let i=0;i<120;i++)ship.step(1/120);
  const point=V(0,7,20),before=ship.toWorld(point,V());ship.step(dt);const after=ship.toWorld(point,V()),measured=after.clone().sub(before).multiplyScalar(1/dt),reported=ship.velocityAt(after,V());
  assert.ok(reported.distanceTo(measured)<.15,`dt=${dt}, measured=${measured.toArray()}, reported=${reported.toArray()}`);assert.ok(Math.abs(reported.y)>1,'tilted deck has real vertical point motion');
  ship.position.x+=1000;ship.position.z-=1000;ship.pose();ship.step(dt);assert.ok(ship.velocityAt(ship.toWorld(point,V()),V()).length()<20,'external placement must not be differentiated across a frame');
 }
});
test('An articulated person settles naturally, but a still-spinning head prevents recovery despite quiet centre motion',()=>{
 const f=tumbleFixture();f.player.terrain.heightAt=()=>0;const p=f.person();p.group.position.set(0,0,0);
 const r=f.tumbles.start(p,V(),null,null).rd;let frames=0;
 while(r.phase==='sim'&&frames++<600)r.update(1/60);
 assert.equal(r.phase,'getup','an ordinary supported fall must still recover without a timer forcing it');
 // A supported physical fixture at the rest boundary, with pure axial head
 // spin and no commanded COM motion. The actual solver advances every joint.
 r.phase='sim';r.rest=1;
 for(const b of r.bodies)b.v.x=b.v.y=b.v.z=b.w.x=b.w.y=b.w.z=0;
 const axis=V(r.head.ax.x,r.head.ax.y,r.head.ax.z).applyQuaternion(r.head.q).multiplyScalar(20);Object.assign(r.head.w,axis);
 r.update(1/120);assert.ok(Math.hypot(r.head.w.x,r.head.w.y,r.head.w.z)>10,'the physical head remains visibly spinning');
 assert.ok(Math.sqrt(r.bodies.reduce((s,b)=>s+b.m*(b.v.x**2+b.v.y**2+b.v.z**2),0)/r.mass)<.1,'COM translation alone would permit a false recovery');
 assert.equal(r.phase,'sim','rotational motion must block get-up');assert.equal(r.rest,0);
});
test('A deck-supported passenger can lose balance to horizontal wind without requiring an updraft',()=>{
 const f=tumbleFixture(),{ship,deck}=ferryFixture(),p=f.person();f.player.groundAt=(x,z,maxY)=>Math.max(-100,deck.support.groundHeightAt(x,z,maxY));f.player.groundProviders=new Set([deck.support]);
 p.local=V(7.7,7,-1);ship.toWorld(p.local,p.group.position);p.world.copy(p.group.position);p.brain.bump=()=>{};p.model.clipSet=new Set(p.model.clipNames());
 f.hub.list.push(p);f.hub.t=1;f.hub.contact=new Contact(f.hub);f.hub.app.people=f.hub;
 const field=new DisasterField(()=>-100);field.ambient=()=>({x:60,z:0});
 const owner=Object.assign(Object.create(Disasters.prototype),{app:f.hub.app,field,changedPeople:new Map()});f.hub.app.disasters=owner;
 owner.people(1/60);assert.equal(p.disasterLoad.supported,true,'the shipped saloon deck is real stance support');
 assert.equal(p.knock?.rag?.rd.bodies.length,14,'strong horizontal wind must release the supported passenger to articulated physics');
});
test('Every shipped crowd skeleton builds human-sized capsules and recovers from an ordinary fall without angular blow-up',()=>{
 for(const dt of [1/60,.1])for(const {cast,bytes:b} of crowdAssets){
  const f=tumbleFixture();f.player.terrain.heightAt=()=>0;const p=f.person();p.group.position.set(0,0,0);
  p.model=new SkinnedModel(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));p.model.play('idle_neutral_01',{fade:0});p.model.update(0);p.clipOf=k=>k==='idle'?'idle_neutral_01':k;
  const r=f.tumbles.start(p,V(3,0,0),null,null);p.knock={rag:r};f.hub.list.push(p);
  assert.ok(r.rd.head.r>.06&&r.rd.head.r<.14,`${cast}: visual adult head requires a metre-scaled capsule, radius=${r.rd.head.r}`);
  let frames=0,maxSpin=0,peakEnergy=0;while(r.rd.phase==='sim'&&frames++<10/dt){r.rd.update(dt);f.tumbles.collide(dt);maxSpin=Math.max(maxSpin,...r.rd.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z)));peakEnergy=Math.max(peakEnergy,energy(r.rd));for(const b of r.rd.bodies)assert.ok(Math.abs(Math.hypot(b.q.x,b.q.y,b.q.z,b.q.w)-1)<1e-5,'physical orientation remains unit length');}
  assert.ok(maxSpin<50,`${cast},dt=${dt}: spin=${maxSpin}`);assert.equal(r.rd.stats.capped,0,`${cast},dt=${dt}: ordinary fall must not rely on emergency solver limits`);assert.ok(peakEnergy<2000,`${cast}: energy=${peakEnergy}`);assert.equal(r.rd.phase,'getup',`${cast}: supported body should settle naturally`);assert.ok(energy(r.rd)<5,'late complete kinetic energy must dissipate before recovery');assert.ok(Math.max(r.rd.stats.hinge,r.rd.stats.swing,r.rd.stats.twist)<5,'joint limits must remain bounded throughout the fall');
 }
});
test('Inter-person overlap repair preserves every internal joint configuration within one bounded rig correction',()=>{
 const f=tumbleFixture(),a=f.person(),b=f.person();a.group.position.x=-.22;b.group.position.x=.22;
 const A=f.tumbles.start(a,V(1,0,0),null,null).rd,B=f.tumbles.start(b,V(-1,0,0),null,null).rd;
 a.knock={rag:{rd:A,avatar:f.tumbles.rig(a).avatar}};b.knock={rag:{rd:B,avatar:f.tumbles.rig(b).avatar}};
 const poses=[A,B].map(r=>r.bodies.map(b=>({x:{...b.x},q:{...b.q}})));
 f.tumbles.collide(1/60);assert.ok(f.tumbles.contacts.people>0);
 for(const [i,r] of [A,B].entries()){
  const shift=V(r.pelvis.x.x-poses[i][0].x.x,r.pelvis.x.y-poses[i][0].x.y,r.pelvis.x.z-poses[i][0].x.z);
  assert.ok(shift.length()<=.035+1e-10,'all capsule pairs share one per-rig correction budget');
  for(const [j,b] of r.bodies.entries()){
   assert.ok(V(b.x.x-poses[i][j].x.x,b.x.y-poses[i][j].x.y,b.x.z-poses[i][j].x.z).distanceTo(shift)<1e-10,'postpass must not strain a joint anchor');
   assert.deepEqual(b.q,poses[i][j].q,'stabilization must not rotate inertia outside the solver');
  }
 }
});
