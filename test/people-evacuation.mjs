import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Scene } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Material } from '../src/engine/webgpu.js';
import { Evacuation } from '../src/evacuation/Evacuation.js';
import { EvacuationAI } from '../src/people/EvacuationAI.js';
import { DisasterField } from '../src/disasters/Field.js';
import { Beach } from '../src/people/Beach.js';
import { SmartObjects } from '../src/people/SmartObjects.js';
import { buildPier } from '../src/world/Pier.js';
import { Builder } from '../src/world/village/GeoBuilder.js';
import { Rand, InstancedProps } from '../src/world/Props.js';
import { mulberry32 } from '../src/util/Noise.js';

const canvasContext=new Proxy({getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
globalThis.document={createElement:()=>({getContext:()=>canvasContext})};
function fixture(real=false){
 const terrain=real?new TerrainData():{heightAt:()=>2};if(real)new CoastalRoute(terrain);
 const app={terrainData:terrain,colliders:new Colliders(),scene:new Scene(),village:{materials:{wood:new Material(),hard:new Material(),stone:new Material()}}};
 if(real){app.evacuation=new Evacuation(app);app.evacuation.build();}
 else{const R={x:0,z:-20,y:2,width:8,depth:6};app.evacuation={route:{entry:{x:0,z:-5,y:2},startZ:-5,x:0,refuge:R,points:[]},refuge:R,records:[]};}
 const field={events:new Map(),waterAt:()=>0,center:e=>({x:e.x,z:e.z})};app.disasters={field};
 const hub={app,list:[],t:0,say:()=>{}};app.people=hub;app.beach={people:hub.list};hub.evacuation=new EvacuationAI(hub);
 return {app,hub,field,ai:hub.evacuation,add(x,z,role='camp'){
  const p={id:1001+hub.list.length,world:new Vector3(x,terrain.heightAt(x,z),z),base:new Vector3(x,terrain.heightAt(x,z),z),head:new Vector3(),off:new Vector3(),mode:'sand',posture:'sit',role,pace:1.2,walk:1.3,brain:{type:'friendly',activity:{name:'chat'},gesture:null},model:{clipSet:new Set(['idle','walk','crouch']),current:'idle',play(clip){this.current=clip;}},clipOf:k=>k};hub.list.push(p);hub.evacuation.register(p);return p;
 },tick(n=1){for(let i=0;i<n;i++){hub.t+=1/60;hub.evacuation.update(1/60);for(const p of hub.list)hub.evacuation.step(p,1/60);}}};
}

test('a warning interrupts beach activities regardless of render distance and repeated events restore original state',()=>{
 const f=fixture(),a=f.add(-10,0),b=f.add(100,0,'wade');b.lod='far';const original=a.world.clone();
 f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick();
 assert.equal(a.mode,'stand');assert.equal(b.evacuation.phase,'warning');assert.equal(f.ai.state().warned,2);
 f.tick(60);assert.ok(a.world.distanceTo(original)>.05);f.field.events.clear();f.tick();assert.equal(a.evacuation.phase,'all-clear');
 const stopped=a.world.clone();f.tick(10);assert.ok(a.world.distanceTo(stopped)<.01,'All clear does not return people by teleporting');
 f.ai.reset();assert.equal(a.evacuation,undefined);assert.equal(a.mode,'sand');assert.equal(a.world.distanceTo(original),0);
 f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick();assert.equal(a.evacuation.phase,'warning');
});

test('the NPC capsule climbs the actual 450 tread boardwalk and reaches physical refuge contact',()=>{
 const f=fixture(true),r=f.app.evacuation.route,p=f.add(r.entry.x,r.entry.z);f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});
 let largestStep=0,previous=p.world.clone(),seconds=0;
 for(;seconds<85&&p.evacuation?.phase!=='refuge';seconds+=1/60){f.tick();largestStep=Math.max(largestStep,p.world.distanceTo(previous));previous.copy(p.world);}
 assert.equal(p.evacuation.phase,'refuge',JSON.stringify({seconds,world:p.world,ai:f.ai.state()}));
 assert.ok(seconds<50,`Evacuation took ${seconds.toFixed(2)} s`);assert.ok(largestStep<.5,'Every physical frame moves less than a step');
 assert.ok(p.evacuation.routeContacts>200);assert.ok(p.evacuation.grounded);assert.ok(Math.abs(p.world.y-r.refuge.y)<.03);
 assert.ok(Math.abs(f.app.colliders.groundHeightAt(p.world.x,p.world.z,p.world.y+.1)-p.world.y)<.03);
 assert.ok(f.ai.state().maxExpansionsPerUpdate<=120);assert.equal(f.ai.state().maxPlansPerUpdate,1);
 for(let i=0;i<360;i++){f.tick();assert.equal(p.evacuation.phase,'refuge','A person standing at the assigned refuge spot is not obstructed');}
});

test('a broken or flooded section ahead cancels voluntary route advance without granting protection',()=>{
 const f=fixture(),p=f.add(0,0);f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick(90);
 f.app.evacuation.records=[{broken:true,colliders:[{tag:'evacuation-deck',center:{z:-10}}]}];f.tick(40);
 assert.equal(p.evacuation.phase,'blocked');assert.equal(p.evacuation.reason,'broken-route');
 p.environmentAcceleration={x:5,y:0,z:0};const before=p.world.x;f.tick(60);assert.ok(p.world.x>before+.3,'Environmental force still moves a blocked evacuee');
 f.app.evacuation.records=[];f.field.waterAt=()=>3;f.tick(40);assert.equal(p.evacuation.reason,'flooded-route');
});

test('incapacitated people are left to the ragdoll, then resume from their actual recovered location',()=>{
 const f=fixture(),p=f.add(-2,0);f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick(60);
 p.knock={kind:'tumble',rag:{}};const at=p.world.clone();f.tick(120);assert.equal(p.evacuation.phase,'incapacitated');assert.equal(p.world.distanceTo(at),0);
 p.knock=null;p.off.set(3,0,0);f.tick();assert.ok(p.world.x>at.x+2.9,'Recovery takes the contact displacement as the new position');
 assert.equal(p.off.length(),0);p.dead=true;const dead=p.world.clone();f.tick(120);assert.equal(p.world.distanceTo(dead),0);
});

test('a tornado prompts movement away from its centre while an earthquake interrupts activities to brace',()=>{
 const f=fixture(),p=f.add(8,0);f.field.events.set('tornado',{kind:'tornado',x:0,z:0});f.tick(120);assert.ok(p.world.x>10);
 f.field.events.clear();f.field.events.set('earthquake',{kind:'earthquake',x:0,z:0});f.tick(90);assert.equal(p.evacuation.phase,'brace');assert.equal(p.model.current,'crouch');
});

test('a crowd approaching together queues uphill and fills the refuge without blocking later arrivals',()=>{
 const f=fixture(true),r=f.app.evacuation.route;
 for(let i=0;i<8;i++)f.add(r.entry.x+(i%2)*.2,r.entry.z+2+i*.75);
 f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});
 let seconds=0;for(;seconds<80&&!f.hub.list.every(p=>p.evacuation?.phase==='refuge');seconds+=1/60)f.tick();
 assert.equal(f.hub.list.filter(p=>p.evacuation.phase==='refuge').length,8,JSON.stringify(f.hub.list.map(p=>({id:p.id,at:p.world,phase:p.evacuation.phase,reason:p.evacuation.reason}))));
 assert.ok(seconds<70);assert.ok(f.hub.list.every(p=>p.evacuation.routeContacts>200));
});


test('voluntary wading keeps real still-water drag below the support tipping threshold',()=>{
 const f=fixture(),p=f.add(0,0);f.app.terrainData.heightAt=()=>-.4;p.world.y=-.4;
 p.evacuation={velocity:new Vector3(),grounded:true,collisions:0,routeContacts:0};
 const field=new DisasterField(()=>-.4);let peak=0;
 for(let i=0;i<600;i++){const c=p.world.clone();c.y+=.85;const a=field.acceleration(c,p.evacuation.velocity,{mass:72,area:.7,volume:.072,height:1.7,supported:true,dt:1/60},{});p.environmentAcceleration={x:a.ax,y:a.ay,z:a.az};peak=Math.max(peak,Math.hypot(a.ax,a.az));f.ai.walker.step(p,{x:0,z:-50},1/60,4.8,()=>0);}
 assert.ok(p.world.z<-6,'The person makes real progress through the shallows');assert.ok(peak<3.2,`Still-water drag acceleration ${peak} must not trip the voluntary walker`);
});


test('refuge status is lost when the actual platform is overtopped',()=>{
 const f=fixture(),p=f.add(0,-21.2);f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick();p.evacuation.phase='refuge';p.evacuation.goalZ=-21.2;
 f.field.waterAt=()=>4;f.tick();assert.equal(p.evacuation.phase,'blocked');assert.equal(p.evacuation.reason,'flooded-route');
});


test('a blocked tornado escape never falls back to the tsunami high-ground route',()=>{
 const f=fixture(),p=f.add(8,0);f.app.colliders.addBox(new Vector3(10,3,0),new Vector3(.5,1,2));
 f.field.events.set('tornado',{kind:'tornado',x:0,z:0});f.tick(180);assert.equal(p.evacuation.phase,'blocked');assert.equal(p.evacuation.reason,'no-clear-ground');assert.equal(f.ai.state().planning,0);
});


test('a swimmer reaches walkable dry shore without being stranded by the handoff depth',()=>{
 const f=fixture(true),p=f.add(23.7,-15,'swim');p.world.y=-1.25;p.base.copy(p.world);
 const field=new DisasterField((x,z)=>f.app.terrainData.heightAt(x,z));
 f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});
 for(let i=0;i<4200;i++){
  const c=p.world.clone();c.y+=.85;const a=field.acceleration(c,p.evacuation?.velocity??new Vector3(),{mass:72,area:.7,volume:.072,height:1.7,supported:p.evacuation?.grounded??false,dt:1/60},{});
  p.environmentAcceleration={x:a.ax,y:a.ay,z:a.az};f.tick();
 }
 assert.ok(p.world.y>.2&&p.world.z<-50,JSON.stringify({at:p.world,phase:p.evacuation.phase,reason:p.evacuation.reason}));
 assert.ok(['approach','climb','refuge'].includes(p.evacuation.phase));
});

test('both fishing slots have a clear physical capsule and an inland exit on the real pier',()=>{
 const f=fixture(true),B=new Builder();
 buildPier({B,terrain:f.app.terrainData,colliders:f.app.colliders,rand:new Rand(mulberry32(42)),lights:[],inst:new InstancedProps(B),hang:()=>new Builder()});
 f.hub.objects=new SmartObjects();const beach=new Beach(f.app);beach.layout();
 const slots=beach.slots.filter(s=>s.role==='fish');assert.equal(slots.length,2);
 for(const s of slots){const p=s.at.clone();f.app.colliders.resolveCapsule(p,.27,1.7,.4);assert.ok(p.distanceTo(s.at)<.01,`Fisher at ${s.at.toArray()} overlaps real pier geometry`);
  assert.ok(f.ai.walker.segment(s.at,{x:s.at.x,y:s.at.y,z:s.at.z-2}),`Fisher at ${s.at.toArray()} cannot leave toward shore`);}
});


test('a treading swimmer enters physical evacuation from the visible feet without a vertical jump',()=>{
 const f=fixture(),p=f.add(23,-15,'swim');f.app.terrainData.heightAt=()=>-2;p.world.y=0;p.base.copy(p.world);p.mode='tread';p.group={position:new Vector3(23,-1.38,-15)};
 f.field.events.set('tsunami',{kind:'tsunami',warning:90,time:0});f.tick();
 assert.ok(Math.abs(p.world.y-p.group.position.y)<.05,`Visible swimmer feet jumped from ${p.group.position.y} to ${p.world.y}`);
 f.ai.reset();assert.equal(p.mode,'tread');assert.equal(p.world.y,0);
});

import { JETSKI_HIRE } from '../src/world/JetskiHire.js';
test('the attendant stool is supported outside the actual solid hire envelope and has a physical inland exit',()=>{
 const f=fixture(true),H=JETSKI_HIRE.stand,t=f.app.terrainData;
 const y=Math.min(...[[-1.5,-.8],[1.5,-.8],[-1.5,.8],[1.5,.8]].map(([x,z])=>t.heightAt(H.x+x,H.z+z)));
 f.app.colliders.addBox(new Vector3(H.x,y+H.half[1],H.z),new Vector3(...H.half),H.yaw,{solid:true,tag:'jetski-hire'});
 f.hub.objects=new SmartObjects();const beach=new Beach(f.app);beach.layout();const slot=beach.slots.find(s=>s.role==='attendant'),body=slot.at.clone();
 f.app.colliders.resolveCapsule(body,.27,1.7,.4);assert.ok(body.distanceTo(slot.at)<.01,`Hire slot projects ${body.distanceTo(slot.at)}m from ${slot.at.toArray()}`);
 assert.ok(Math.abs(slot.at.y-f.ai.walker.ground(slot.at.x,slot.at.z,slot.at.y+.2))<.03,'stool must be on real support');
 assert.ok(f.ai.walker.segment(slot.at,{x:slot.at.x,y:slot.at.y,z:slot.at.z-2}),'attendant must have a physical exit toward refuge');
});
