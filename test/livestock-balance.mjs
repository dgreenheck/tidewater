import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Vector3,Quaternion,Group,Scene} from '../src/engine/index.js';
import {GPU} from '../src/engine/gpu/GPU.js';
import {StorageBuffer,Texture} from '../src/engine/gpu/Texture.js';
import {TerrainData} from '../src/world/TerrainData.js';import {Village} from '../src/world/Village.js';import {CoastalRoute} from '../src/world/CoastalRoute.js';import {Colliders} from '../src/world/Colliders.js';
import {applyTerminalSite,PLACES} from '../src/ferry/Terminal.js';import {Evacuation} from '../src/evacuation/Evacuation.js';import {prepareWindFarmSites} from '../src/windfarm/Sites.js';import {prepareGliderSite} from '../src/glider/Site.js';
import {VegSite,scatterVegetation} from '../src/world/vegetation/Scatter.js';import {trunkCylinders} from '../src/rally/WorldPhysics.js';
import {Disasters} from '../src/disasters/Disasters.js';import {DisasterBodies} from '../src/disasters/Bodies.js';import {DisasterField} from '../src/disasters/Field.js';import {PropPhysics} from '../src/physics/Props.js';
import {SPECIES,locomotion,angularVelocity} from '../src/wildlife/Control.js';import {Livestock} from '../src/wildlife/Livestock.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const UP=new Vector3(0,1,0),G=9.81,near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const state=q=>({quaternion:q,desired:new Vector3(),angular:new Vector3(),normal:UP.clone(),disabled:false,heading:Math.atan2(new Vector3(0,0,1).applyQuaternion(q).x,new Vector3(0,0,1).applyQuaternion(q).z)});

test('Balance torque is invariant under a change of world heading for the same tilted animal',()=>{
 for(const spec of Object.values(SPECIES))for(const angle of [.2,.9,1.7]){const tilt=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/18),yaw=new Quaternion().setFromAxisAngle(UP,angle),input={velocity:new Vector3(),supported:true,dt:1/60};const a=locomotion(spec,state(tilt),input,{}),b=locomotion(spec,state(yaw.clone().multiply(tilt)),input,{}),expected=new Vector3(a.tx,a.ty,a.tz).applyQuaternion(yaw);near(new Vector3(b.tx,b.ty,b.tz).distanceTo(expected),0,1e-5);}
});

test('A sharp heading change reserves balance and cannot launch a goat sideways past its passive tipping limit',()=>{
 const spec=SPECIES.goat,s=state(new Quaternion());s.heading=Math.PI/2;s.desired.set(spec.walk,0,0);const f=locomotion(spec,s,{velocity:new Vector3(),supported:true,dt:.1},{});
 assert.ok(Math.abs(f.fx)<spec.mass*G*spec.half[0]/spec.half[1]*.7,'turn first rather than apply maximum lateral traction');
 for(const q of [new Quaternion().setFromAxisAngle(new Vector3(0,0,1),1.2),new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI)]){
  const f=locomotion(spec,state(q),{velocity:new Vector3(),supported:true,dt:.1},{});assert.ok(f.fy>0&&f.fy<=.45*spec.mass*G+1e-6);assert.equal(f.fx,0);assert.equal(f.fz,0);assert.ok(Math.hypot(f.tx,f.ty,f.tz)<=spec.mass*G*spec.stance+1e-6);
  const absent=locomotion(spec,state(q),{velocity:new Vector3(),supported:false,dt:.1},{});assert.deepEqual(absent,{fx:0,fy:0,fz:0,tx:0,ty:0,tz:0});const wet=state(q);wet.disabled=true;assert.deepEqual(locomotion(spec,wet,{velocity:new Vector3(),supported:true,dt:.1},{}),absent);
 }
});

function director(sim,terrain,colliders=new Colliders(),vegetation=null){const app={scene:new Group(),terrainData:terrain,colliders,vegetation,rally:{physics:sim,trunks:vegetation?trunkCylinders(vegetation,terrain):new Float32Array(),supports:[],profile:{mass:1400}}};const D=Object.assign(Object.create(Disasters.prototype),{app,field:new DisasterField((x,z)=>terrain.heightAt(x,z)),structures:{bodies:new Map()},external:new Set(),restored:true,paused:false});D.bodies=new DisasterBodies(app,D);app.disasters=D;return {D,app};}

test('Supported side and inverted animals recover through finite native forces while unsupported bodies keep falling freely',()=>{
 for(const spec of Object.values(SPECIES))for(const angle of [Math.PI/2,Math.PI])for(const dt of [1/60,.1]){const sim=new RallyPhysics();try{const terrain={heightAt:()=>4};sim.set_terrain(new Float32Array(25).fill(4),5,200,-100);sim.reset(-80,6,0,0);const {D}=director(sim,terrain),q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle),s=state(q),extent=Math.abs(Math.cos(angle))*spec.half[1]+Math.abs(Math.sin(angle))*spec.half[0];let body;
  body=D.addBody({mesh:new Group(),mass:spec.mass,half:spec.half,area:0,volume:0,height:2*spec.half[1],position:new Vector3(20,4+extent+.005,0),quaternion:q,controlLoad:input=>{s.quaternion=body.quaternion;return locomotion(spec,s,input,{})}});
  let maxSpeed=0,maxForce=0,last;
  for(let t=0;t<10;t+=dt){const motion=sim.disaster_motion();for(let i=0;i<motion.length;i+=7)if(motion[i]===body.id){const v=new Vector3().fromArray(motion,i+4);angularVelocity(sim,body.id,body.position,v,s.angular);maxSpeed=Math.max(maxSpeed,v.length());}D.loads(dt);sim.advance(dt,0,0,0,1);D.bodies.sync(sim.prop_poses());last=UP.clone().applyQuaternion(body.quaternion);}
  assert.ok(last.y>.94,`${spec.mass}kg angle${angle} dt${dt} failed to physically recover, up=${last.y}`);assert.ok(maxSpeed<6,'recovery cannot launch an animal');assert.ok(Math.hypot(body.position.x-20,body.position.z)<3,'recovery is not propulsion');const effort=locomotion(spec,{...s,quaternion:body.quaternion},{velocity:new Vector3(),supported:true,dt},{});near(effort.fy,0);
  D.removeBody(body);s.quaternion=q;s.angular.set(0,0,0);body=D.addBody({mesh:new Group(),mass:spec.mass,half:spec.half,area:0,volume:0,height:2*spec.half[1],position:new Vector3(20,50,0),quaternion:q,controlLoad:input=>locomotion(spec,s,input,{})});D.loads(.1);sim.advance(.1,0,0,0,1);D.bodies.sync(sim.prop_poses());const m=sim.disaster_motion();let v;for(let i=0;i<m.length;i+=7)if(m[i]===body.id)v=m[i+5];near(v,-.981,3e-5);assert.ok(body.quaternion.toArray().every((v,i)=>Math.abs(v-q.toArray()[i])<1e-7),'unsupported orientation is unchanged within native float32 precision');const spin=angularVelocity(sim,body.id,body.position,new Vector3(0,v,0));near(spin.length(),0,1e-6);
 }finally{sim.free();}}
});

// Exact production island terrain, village pads, road grading and plant scatter.
// Only rasterization/upload/model draw transport is isolated in this CPU fixture.
let site;
function island(){if(site)return site;const oldDoc=globalThis.document,oldWrite=StorageBuffer.prototype.write,oldTexture=Texture.prototype.getGPU,oldEncoder=GPU.getEncoder,ctx=new Proxy({measureText:()=>({width:100}),getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});globalThis.document={createElement:()=>({getContext:()=>ctx})};StorageBuffer.prototype.write=function(data){this.pendingData=data;};Texture.prototype.getGPU=function(){this.mipsOption=false;return {};};GPU.getEncoder=()=>null;
 try{const terrain=new TerrainData();for(const place of Object.values(PLACES))applyTerminalSite(terrain,undefined,place);const scene=new Scene(),colliders=new Colliders(),village=new Village({scene,terrain,colliders}),roads=new CoastalRoute(terrain);const app={terrainData:terrain,colliders,scene,village};new Evacuation(app).build();prepareWindFarmSites(terrain);prepareGliderSite(terrain,roads);new PropPhysics(app).link(colliders);
  const paths=[];for(const p of [village.path,...village.sidePaths]){const points=[];for(let i=0;i<p.samples.length;i+=5)points.push([p.samples[i].p.x,p.samples[i].p.z]);const last=p.samples.at(-1);points.push([last.p.x,last.p.z]);paths.push({points,width:p.width??1.8});}
  const plants=new VegSite(terrain,{footprints:village.getFootprints(),paths}),vegetation={site:plants,records:scatterVegetation(plants)},heights=new Float32Array(512*512);for(let z=0;z<512;z++)for(let x=0;x<512;x++)heights[z*512+x]=terrain.heights[(z+768)*terrain.res+x+768];
  site={terrain,colliders,vegetation,heights};return site;
 }finally{globalThis.document=oldDoc;StorageBuffer.prototype.write=oldWrite;Texture.prototype.getGPU=oldTexture;GPU.getEncoder=oldEncoder;}}
const renderer=async()=>({group:new Group(),current:'Idle',layers:[],play(name){this.current=name;let l=this.layers.find(l=>l.clip.name===name);if(!l)this.layers=[l={clip:{name},time:0,speed:1,target:1,weight:1}];return l;},update(dt){for(const l of this.layers)l.time+=dt*l.speed;}});
test('Ten native animals remain mobile and recover their footing over sixty calm seconds on the actual island habitats',async()=>{
 const {terrain,colliders,vegetation,heights}=island();
 for(const dt of [1/30,.1]){const sim=new RallyPhysics();try{sim.set_terrain(heights,512,512,-256);sim.reset(-200,20,0,0);const {D,app}=director(sim,terrain,colliders,vegetation);sim.add_cylinders(app.rally.trunks);sim.add_boxes(new Float32Array(colliders.boxes.filter(b=>(b.solid||b.walkable)&&!b.prop).flatMap(b=>[...b.center.toArray(),...b.half.toArray(),b.rotY,.65])));sim.add_cylinders(new Float32Array(colliders.cylinders.filter(c=>!c.prop).flatMap(c=>[c.x,c.z,c.radius,c.yMin,c.yMax])));
  const herd=new Livestock(app);await herd.init({modelFactory:renderer,ui:false});const initial=herd.state();console.log('HABITATS',dt,initial.members.map(a=>a.position));let longest=0,minUp=1,maxSpeed=0;const fallen=new Map();
  for(let t=0;t<60;t+=dt){herd.update(dt);D.loads(dt);sim.advance(dt,0,0,0,1);D.bodies.sync(sim.prop_poses());herd.after();for(const a of herd.animals){const up=UP.clone().applyQuaternion(a.body.quaternion).y;minUp=Math.min(minUp,up);maxSpeed=Math.max(maxSpeed,a.velocity.length());const duration=up<.75?(fallen.get(a.name)??0)+dt:0;fallen.set(a.name,duration);longest=Math.max(longest,duration);assert.ok(Number.isFinite(up)&&a.body.position.y>terrain.heightAt(a.body.position.x,a.body.position.z)-.1);}}
  console.log('CALM',JSON.stringify({dt,minUp,maxSpeed,longest,members:herd.state().members.map(a=>({name:a.name,up:UP.clone().applyQuaternion(herd.animals.find(b=>b.name===a.name).body.quaternion).y,mode:a.mode,distance:a.distance}))}));
  assert.ok(longest<6,`calm body stayed fallen ${longest}s`);assert.ok(maxSpeed<5);assert.ok(herd.animals.every(a=>UP.clone().applyQuaternion(a.body.quaternion).y>.8));assert.ok(herd.animals.some(a=>a.distance>5),'controller still permits actual island roaming');
 }finally{sim.free();}}
});
