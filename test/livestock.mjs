import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Group,Vector3,Quaternion} from '../src/engine/index.js';
import {Colliders} from '../src/world/Colliders.js';
import {Disasters} from '../src/disasters/Disasters.js';
import {DisasterBodies} from '../src/disasters/Bodies.js';
import {DisasterField} from '../src/disasters/Field.js';
import {SPECIES,angularVelocity,locomotion} from '../src/wildlife/Control.js';
import {Habitat} from '../src/wildlife/Habitat.js';
import {Livestock} from '../src/wildlife/Livestock.js';
import {AnimalBrain} from '../src/wildlife/Brain.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const near=(a,b,e=1e-4)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const renderer=async()=>({group:new Group(),current:'Idle',layers:[],play(name){this.current=name;let l=this.layers.find(l=>l.clip.name===name);if(!l){this.layers=[l={clip:{name},time:0,speed:1,target:1,weight:1}];}return l;},update(dt){for(const l of this.layers)l.time+=dt*l.speed;}});
async function fixture(){const physics=new RallyPhysics(),terrain={heightAt:()=>4};physics.set_terrain(new Float32Array(17*17).fill(4),17,1000,-500);physics.reset(-300,5,0,0);
 const app={scene:new Group(),terrainData:terrain,colliders:new Colliders(),rally:{physics,trunks:new Float32Array(),supports:[],profile:{mass:1400}}};
 const D=Object.assign(Object.create(Disasters.prototype),{app,field:new DisasterField(terrain.heightAt),structures:{bodies:new Map()},external:new Set(),restored:true,paused:false});D.bodies=new DisasterBodies(app,D);app.disasters=D;
 const herd=new Livestock(app);await herd.init({modelFactory:renderer,ui:false});
 const step=(dt=1/120)=>{herd.update(dt);D.loads(dt);physics.advance(dt,0,0,0,1);D.bodies.sync(physics.prop_poses());herd.after();};
 return {app,D,physics,herd,step};
}

test('Habitat rejects submerged, steep and obstructed whole footprints, and spaces dry animals',()=>{
 const c=new Colliders();c.addBox(new Vector3(0,5,0),new Vector3(2,1,2));const h=new Habitat({heightAt:(x,z)=>x>30?-.1:x< -20?4+Math.abs(x+20):4},c);
 assert.equal(h.clear(0,0,SPECIES.cow),false);assert.equal(h.clear(40,0,SPECIES.goat),false);assert.equal(h.clear(-30,0,SPECIES.goat),false);
 const p=h.placement({x:8,z:0},6,SPECIES.goat);assert.equal(p.length,6);for(let i=0;i<p.length;i++){near(p[i].y,4+.45+.06);for(let j=0;j<i;j++)assert.ok(p[i].distanceTo(p[j])>3);}
 assert.equal(h.segment({x:-5,z:0},{x:5,z:0},SPECIES.cow),false);
});
test('Animal locomotion is finite, support gated, traction limited and never overwrites momentum',()=>{
 const state={quaternion:new Quaternion(),angular:new Vector3(2,4,-3),desired:new Vector3(3,0,-1),heading:1,normal:new Vector3(0,1,0)};
 for(const spec of Object.values(SPECIES)){const velocity=new Vector3(50,2,-10),before=velocity.clone(),f=locomotion(spec,state,{velocity,supported:true,dt:.1});assert.ok(Math.hypot(f.fx,f.fz)<=spec.mass*9.81*.9+1e-8);assert.ok(Math.hypot(f.tx,f.ty,f.tz)<=spec.mass*9.81*spec.stance+1e-8);assert.deepEqual(velocity,before);assert.equal(f.fy,0);assert.deepEqual(locomotion(spec,state,{velocity,supported:false,dt:.1}),{fx:0,fy:0,fz:0,tx:0,ty:0,tz:0});}
});
test('Native point velocities recover all angular axes including an arbitrarily rotated moving body',()=>{
 const sim=new RallyPhysics();try{sim.set_terrain(new Float32Array(25).fill(-100),5,1000,-500);sim.reset(-100,-90,0,0);const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.8),p=new Vector3(10,10,10),v=new Vector3(3,-2,1),w=new Vector3(.7,-1.2,2.3);
 assert.ok(sim.wake_prop(301,0,new Float32Array([.24,.45,.64]),new Float32Array([...p.toArray(),...q.toArray(),...v.toArray()]),55,.6,.05,false));sim.set_prop_angular_velocity(301,new Float32Array(w.toArray()));const actual=angularVelocity(sim,301,p,v);near(actual.x,w.x);near(actual.y,w.y);near(actual.z,w.z);
 }finally{sim.free();}
});
test('Actual director loads applies a supported external motor and caps the combined load',async()=>{
 const F=await fixture();try{for(let i=0;i<90;i++)F.step();const a=F.herd.animals[0],x=a.body.position.x;const control=a.body.controlLoad;
 a.body.controlLoad=input=>input.supported?{fx:550,fy:0,fz:0,tx:0,ty:0,tz:0}:{};
 for(let i=0;i<120;i++){F.D.loads(1/120);F.physics.advance(1/120,0,0,0,1);F.D.bodies.sync(F.physics.prop_poses());}
 assert.ok(a.body.position.x-x>.6,'registered motor must reach the real native solver');a.body.controlLoad=control;
 let batch;F.D.app.rally.physics={disaster_supported:()=>new Float32Array([a.body.id]),disaster_motion:()=>new Float32Array([a.body.id,0,10,0,0,0,0]),set_disaster_loads:x=>batch=x};a.body.controlLoad=()=>({fx:4e6,fy:4e6,fz:0,tx:3e6,ty:0,tz:3e6});F.D.loads(.1);assert.ok(Math.hypot(...batch.slice(1,4))<=2e6+.2);assert.ok(Math.hypot(...batch.slice(4,7))<=2e6+.2);
 }finally{F.physics.free();}
});
test('Ten live animals roam through native contact, respond to shared wind, and restore captured states repeatedly',async()=>{
 const F=await fixture();try{for(let i=0;i<650;i++)F.step();assert.equal(F.herd.animals.length,10);assert.ok(F.herd.animals.some(a=>a.distance>.8),'grazing herd must begin physical roaming');assert.ok(F.herd.animals.every(a=>a.body.position.y>4),'animals stay above the terrain');
 for(let cycle=0;cycle<2;cycle++){F.herd.capture();const saved=F.herd.baseline;F.D.field.ambient=()=>({x:90,z:15});for(let i=0;i<180;i++)F.step();const a=F.herd.animals[0];assert.ok(a.body.position.distanceTo(saved.animals[0].position)>1,'wind pushes the actual rigid animal');assert.ok(a.brain.panic>0);F.D.field.ambient=()=>({x:0,z:0});F.D.bodies.reset();F.herd.resetDisasterEffects();assert.equal(F.physics.prop_count(),10);for(let i=0;i<10;i++){const now=F.herd.animals[i];near(now.body.position.distanceTo(saved.animals[i].position),0);near(now.proxy.center.distanceTo(now.body.position),0);near(now.proxy.top,now.body.position.y+now.proxy.half.y);near(now.proxy.bottom,now.body.position.y-now.proxy.half.y);assert.deepEqual(now.body.quaternion.toArray(),saved.animals[i].quaternion.toArray());assert.deepEqual(now.velocity.toArray(),saved.animals[i].velocity.toArray());}assert.equal(F.herd.baseline,null);for(let i=0;i<30;i++)F.step();}
 }finally{F.physics.free();}
});
test('A tsunami warning selects higher reachable ground without granting immunity to a flooded body',()=>{
 const spec=SPECIES.goat,habitat=new Habitat({heightAt:(x,z)=>4-z*.1}),brain=new AnimalBrain(spec,new Vector3(0,4.45,0),11),body={position:new Vector3(0,4.45,0),quaternion:new Quaternion()};const field=new DisasterField((x,z)=>4-z*.1);field.events.set('tsunami',{kind:'tsunami',time:0,warning:90});brain.update(.1,body,habitat,field,[body]);assert.equal(brain.mode,'flee');assert.ok(brain.goal.y>4.3);field.water={sample:()=>({height:7,ux:3,uz:0})};brain.update(.1,body,habitat,field,[body]);assert.equal(brain.mode,'carried');assert.equal(brain.desired.length(),0);
});

test('External after callbacks do not advance animation or travelled distance while paused',async()=>{
 const F=await fixture();try{for(let i=0;i<650;i++)F.step();F.D.paused=true;const before=F.herd.state();for(let i=0;i<12;i++){F.herd.update(1/30);F.herd.after();}const after=F.herd.state();assert.deepEqual(after.members.map(a=>[a.phase,a.distance]),before.members.map(a=>[a.phase,a.distance]));assert.equal(after.time,before.time);}finally{F.physics.free();}
});

function startFixture(F){const body=()=>({position:new Vector3(),quaternion:new Quaternion(),velocity:new Vector3(),angular:new Vector3()});Object.assign(F.app,{people:{list:[]},boatCtl:body(),jetskis:{ctl:body(),skis:[]},ferry:{ship:body()},player:{...body(),mode:'walk'},camera:body()});F.app.rally.damage={captureDisasterState:()=>({})};F.D.siren={arm:()=>Promise.resolve()};F.D.refresh=()=>{};F.D.vesselSnapshots=null;}
test('Actual Start captures the herd before any hazard-aware update and failed capture leaves no partial baseline',async()=>{
 const F=await fixture();try{startFixture(F);for(let i=0;i<180;i++)F.step();const a=F.herd.animals[0],before=a.brain.capture(),pos=a.body.position.clone();F.D.start('earthquake',{intensity:1});assert.deepEqual(F.herd.baseline.animals[0].brain,before);assert.deepEqual(F.herd.baseline.animals[0].position,pos);F.step();assert.deepEqual(F.herd.baseline.animals[0].brain,before);
 F.D.field.stop();F.D.vesselSnapshots=null;F.herd.baseline=null;F.D.external.add({capture(){throw new Error('synthetic later adapter failure');}});assert.throws(()=>F.D.start('earthquake',{intensity:1}),/later adapter failure/);assert.equal(F.D.field.events.size,0);assert.equal(F.herd.baseline,null,'failed Start cannot retain a stale animal baseline');assert.equal(F.D.vesselSnapshots,null);
 }finally{F.physics.free();}
});

test('Habitat excludes the full road shoulder footprint',()=>{
 const terrain={heightAt:()=>4,roads:{clearance:(x,z)=>Math.abs(x)-6.1}},h=new Habitat(terrain);assert.equal(h.clear(0,0,SPECIES.goat),false);assert.equal(h.clear(6.5,0,SPECIES.cow),false);assert.equal(h.clear(10,0,SPECIES.cow),true);const p=h.placement({x:0,z:0},6,SPECIES.goat);assert.ok(p.every(p=>Math.abs(p.x)>6.1+Math.hypot(.24,.64)));
});
test('Actual Watch chooses a clear camera side instead of placing a wall between camera and animal',async()=>{
 const F=await fixture();try{const p=F.herd.animals[0].body.position;F.app.colliders.addBox(p.clone().add(new Vector3(0,1,2)),new Vector3(30,8,.5));F.herd.habitat=new Habitat(F.app.terrainData,F.app.colliders);
 const {PerspectiveCamera}=await import('../src/engine/index.js');F.app.camera=new PerspectiveCamera();F.app.player={mode:'walk'};F.app.setFreeCam=()=>{};F.app.fly={setPose(){},velocity:new Vector3()};F.app.cameraCut=()=>{};F.herd.message={textContent:''};F.herd.tool={close(){}};
 assert.equal(F.herd.watch('goat'),true);assert.ok(F.app.camera.position.z<p.z+1.25,'observation camera must remain on the near side of the wall');
 }finally{F.physics.free();}
});

test('A toppled cow retains a conservative walking collider around its actual rotated body',async()=>{
 const F=await fixture();try{const a=F.herd.animals.find(a=>a.kind==='cow');a.body.quaternion.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);F.herd.after();assert.equal(a.proxy.solid,true);near(a.proxy.half.x,.72);near(a.proxy.half.y,.43);near(a.proxy.half.z,1.12);}finally{F.physics.free();}
});

test('Decorative banana leaves exclude visual grazing and camera space without inventing physical colliders',()=>{
 const colliders=new Colliders(),h=new Habitat({heightAt:()=>4},colliders,[],{bananas:[{x:0,y:4,z:0,s:1}]});assert.equal(h.clear(0,0,SPECIES.cow),false);assert.equal(h.visible(new Vector3(0,5,4),new Vector3(0,5,-4)),false);assert.equal(h.clear(8,0,SPECIES.cow),true);assert.equal(colliders.boxes.length+colliders.cylinders.length,0);
});
test('Watching livestock cannot take control away from the ferry helm',async()=>{
 const F=await fixture();try{const {PerspectiveCamera}=await import('../src/engine/index.js');F.app.camera=new PerspectiveCamera();F.app.player={mode:'ferry-helm'};F.app.freeCam=false;F.app.setFreeCam=v=>{F.app.freeCam=v;};F.app.fly={setPose(){},velocity:new Vector3()};F.app.cameraCut=()=>{};F.herd.message={textContent:''};F.herd.tool={close(){}};assert.equal(F.herd.watch('goat'),false);assert.equal(F.app.freeCam,false);assert.equal(F.app.player.mode,'ferry-helm');assert.match(F.herd.message.textContent,/Leave the vehicle/);}finally{F.physics.free();}
});

test('Each animal reads its own herd every frame without a filter and map per animal, and keeps one before-position',async()=>{
 const {herd,step}=await fixture();let filters=0,mismatches=0,calls=0;
 // the herd list each brain saw before the change: its own kind, in animal order
 const expected=a=>Array.prototype.filter.call(herd.animals,b=>b.kind===a.kind).map(b=>b.body);
 herd.animals.filter=function(...args){filters++;return Array.prototype.filter.apply(this,args);};
 for(const a of herd.animals){const update=a.brain.update;a.brain.update=function(dt,body,habitat,field,list,supported){calls++;const want=expected(a);if(list.length!==want.length||list.some((b,i)=>b!==want[i]))mismatches++;return update.call(this,dt,body,habitat,field,list,supported);};}
 step();const before=herd.animals.map(a=>a.beforePosition);
 for(let i=0;i<30;i++)step();
 assert.ok(herd.animals.length>=2&&calls>=31*herd.animals.length,`${calls} brain updates for ${herd.animals.length} animals`);
 assert.equal(mismatches,0,`${mismatches} brain updates saw a different herd list`);
 assert.equal(filters,0,`${filters} herd filters in 31 frames (expected 0: one list per kind per frame)`);
 herd.animals.forEach((a,i)=>assert.equal(a.beforePosition,before[i],`${a.name} keeps one before-position vector`));
});
