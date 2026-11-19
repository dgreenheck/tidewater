import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Vector3,Quaternion,Group} from '../src/engine/index.js';
import {DisasterBodies} from '../src/disasters/Bodies.js';
import {Disasters} from '../src/disasters/Disasters.js';
import {DisasterField} from '../src/disasters/Field.js';
import {buildPalmNear} from '../src/world/vegetation/PlantGeometry.js';
import {createPlantLeafMaterial} from '../src/world/vegetation/VegMaterials.js';
import {VegType} from '../src/world/vegetation/InstanceLOD.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
function fixture(){
 const sim=new RallyPhysics();sim.set_terrain(new Float32Array(25).fill(-1000),5,400,-200);sim.reset(150,-990,150,0);const r={x:0,y:100,z:0,s:1.6,sy:1.2,yaw:.7,H:24,seed:.34,la:.2,l:.1};
 const {geometry}=buildPalmNear(),type=new VegType('palms',[r],{near:[{geometry,material:createPlantLeafMaterial()}],fade:[100,110]});
 const app={scene:new Group(),camera:{position:new Vector3()},vegetation:{palms:type,records:{palms:[r]}},rally:{physics:sim,supports:[],profile:{mass:1500}}},field=new DisasterField(()=>-1000),owner={field};
 const bodies=new DisasterBodies(app,owner);return {sim,r,type,app,field,bodies};
}
function director(f){return {app:f.app,field:f.field,structures:{bodies:new Map()},bodies:f.bodies,restored:false,limited:0,peakForce:0,rawPeakForce:0,touched:new Set(),bodyOptions:Disasters.prototype.bodyOptions};}
const loadAt=(d,sim,id,dt)=>{let observed;const bridge=sim.set_disaster_loads.bind(sim);sim.set_disaster_loads=loads=>{observed=Array.from(loads);return bridge(loads);};try{Disasters.prototype.loads.call(d,dt);}finally{sim.set_disaster_loads=bridge;}for(let i=0;i<observed.length;i+=7)if(observed[i]===id)return observed.slice(i+1,i+7);};

test('Actual tree release uses the authored already-scaled height and preserves the initial rest attitude',()=>{
 const f=fixture();try{assert.equal(f.bodies.fall(f.bodies.trees[0]),true);const b=[...f.bodies.bodies.values()][0];assert.equal(b.height,f.r.H,'record H is already in world metres');assert.equal(b.half.y*2,f.r.H);assert.ok(b.quaternion.angleTo(new Quaternion())<1e-8,'no scripted initial tilt');}finally{f.bodies.reset();f.sim.free();}
});

// Independent analytic fixture: a green palm stem of 700 kg/m3 filling 80% of its .32 m-radius
// base cylinder (4.3 t for this 24 m palm), plus a crown holding 15% of the total at authored scale.
// The crown is an assumed ellipsoidal mass distribution; its collider is only the crushed-crown sphere.
function palmReference(r){
 const stemMass=700*.8*Math.PI*(.2*r.s)**2*r.H,crownMass=stemMass*.15/.85,mass=stemMass+crownMass;
 const radius=.2*r.s,R=4.5*r.s,Y=1.8*r.s,stemY=r.H/2,crownY=r.H-.6*r.s;
 const comY=(stemMass*stemY+crownMass*crownY)/mass;
 const transverse=stemMass*(3*radius*radius+r.H*r.H)/12+stemMass*(stemY-comY)**2+crownMass*(R*R+Y*Y)/5+crownMass*(crownY-comY)**2;
 return {mass,offset:comY-stemY,inertia:[transverse,stemMass*radius*radius/2+crownMass*2*R*R/5,transverse]};
}
test('Actual released native tree includes crown mass in all inertia axes and moves its physical COM without moving the authored proxy',()=>{
 const f=fixture();try{assert.ok(f.bodies.fall(f.bodies.trees[0]));const b=[...f.bodies.bodies.values()][0],ref=palmReference(f.r),origin=b.position.clone();
  f.sim.set_disaster_loads(new Float32Array([b.id,0,ref.mass*9.81,0,0,0,0]));f.sim.advance(1/120,0,0,0,0);
  const com=origin.clone().add(new Vector3(0,ref.offset,0));
  for(const [axis,offset,normal]of [[0,[0,0,1],[0,1,0]],[1,[1,0,0],[0,0,1]],[2,[0,1,0],[1,0,0]]]){
   const point=com.clone().add(new Vector3(...offset)),contact=f.sim.disaster_contact(b.id,new Float32Array(point.toArray()),new Float32Array(normal));
   assert.equal(contact.length,4);const actual=1/(contact[3]-1/ref.mass);assert.ok(Math.abs(actual/ref.inertia[axis]-1)<.001,`native axis${axis} inertia ${actual} kg m², expected ${ref.inertia[axis]}`);
  }
  f.sim.set_prop_angular_velocity(b.id,new Float32Array([0,0,1]));const at=f.sim.disaster_contact(b.id,new Float32Array(com.toArray()),new Float32Array([1,0,0]));assert.ok(Math.hypot(...at.slice(0,3))<1e-5,`COM point velocity ${at.slice(0,3)}`);
  const poses=f.sim.prop_poses(),i=Array.from(poses).findIndex((x,k)=>k%10===0&&x===b.id);assert.ok(new Vector3().fromArray(poses,i+1).distanceTo(origin)<1e-5,'mass metadata must not shift the initial collision/render origin');
 }finally{f.bodies.reset();f.sim.free();}
});

test('Actual released native tree angular impulse uses crown inertia at the true COM',()=>{
 const f=fixture();try{f.bodies.fall(f.bodies.trees[0]);const b=[...f.bodies.bodies.values()][0],ref=palmReference(f.r);
  f.sim.set_disaster_loads(new Float32Array([b.id,0,ref.mass*9.81,0,0,0,0]));f.sim.advance(1/120,0,0,0,0);
  const com=b.position.clone().add(new Vector3(0,ref.offset,0)),point=com.clone().add(new Vector3(2,0,0)),J=60;
  assert.ok(f.sim.apply_prop_impulse(b.id,new Float32Array([0,0,J]),new Float32Array(point.toArray())));
  const v=new Vector3(0,0,J/ref.mass),w=nativeAngularVelocity(f.sim,b.id,com,v);assert.ok(Math.abs(w.y-(-2*J/ref.inertia[1]))<1e-5,`actual angular impulse gives ${w.y}, expected ${-2*J/ref.inertia[1]}`);assert.ok(Math.abs(w.x)+Math.abs(w.z)<1e-5,'COM-aligned impulse must not add a pitch/roll moment');
 }finally{f.bodies.reset();f.sim.free();}
});

test('Actual director applies no invented world-up lever to a fallen tree aligned with uniform flow',()=>{
 const f=fixture();try{f.bodies.fall(f.bodies.trees[0]);const b=[...f.bodies.bodies.values()][0];f.sim.sleep_prop(b.id);b.quaternion.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);f.bodies.spawn(b);f.field.ambient=()=>({x:40,z:0});const d=director(f),load=loadAt(d,f.sim,b.id,1/60);assert.ok(load[0]>0);assert.ok(Math.hypot(...load.slice(3))<1e-4,`flow along the tree axis should not create a world-up torque: ${load.slice(3)}`);}finally{f.bodies.reset();f.sim.free();}
});

import {nativeAngularVelocity} from '../src/disasters/RigidLoads.js';
function nativeState(f,b){const pose=f.sim.prop_poses();for(let i=0;i<pose.length;i+=10)if(pose[i]===b.id){b.position.fromArray(pose,i+1);b.quaternion.fromArray(pose,i+4).normalize();}const motion=f.sim.disaster_motion();let v;for(let i=0;i<motion.length;i+=7)if(motion[i]===b.id)v=new Vector3().fromArray(motion,i+4);const com=b.position.clone().add(new Vector3(0,palmReference(f.r).offset,0).applyQuaternion(b.quaternion)),w=nativeAngularVelocity(f.sim,b.id,com,v);return {v,w,com};}
function energy(f,b){const {v,w,com}=nativeState(f,b),a=w.clone().applyQuaternion(b.quaternion.clone().invert()).toArray(),I=palmReference(f.r).inertia;const rotational=.5*a.reduce((sum,x,i)=>sum+x*x*I[i],0);return {total:.5*b.mass*v.lengthSq()+rotational+b.mass*9.81*com.y,rotational,w:w.length()};}

test('Actual held native tree drag dissipates rotational and total mechanical energy with crown inertia across attitudes and frame intervals',()=>{
 for(const dt of [1/120,1/30,.1])for(const angle of [0,.7,Math.PI/2]){const f=fixture();try{f.bodies.fall(f.bodies.trees[0]);const b=[...f.bodies.bodies.values()][0];f.sim.sleep_prop(b.id);b.quaternion.setFromAxisAngle(new Vector3(1,.3,.5).normalize(),angle);f.bodies.spawn(b);const spin=new Vector3(0,6,0).applyQuaternion(b.quaternion);f.sim.set_disaster_loads(new Float32Array([b.id,0,b.mass*9.81,0,0,0,0]));f.sim.advance(1/120,0,0,0,0);f.sim.set_prop_angular_velocity(b.id,new Float32Array(spin.toArray()));const d=director(f);let previous=energy(f,b),initial=previous;
   // Count simulated time, not calls: one advance runs at most the steps set_max_steps allows (3 during a disaster), so a call may simulate less than it asked.
   for(let t=0;t<2-dt/2;){const load=loadAt(d,f.sim,b.id,dt);load[1]+=b.mass*9.81;f.sim.set_disaster_loads(new Float32Array([b.id,...load]));t+=f.sim.advance(dt,0,0,0,0)/120;const next=energy(f,b);assert.ok(next.total<=previous.total+.03,`mechanical energy grew at dt=${dt}, angle=${angle}: ${previous.total} -> ${next.total}`);assert.ok(next.w<7,'no rotational runaway');previous=next;}
   assert.ok(previous.rotational<initial.rotational*.25,`axial spin must dissipate in still air: ${previous.rotational}/${initial.rotational}`);
  }finally{f.bodies.reset();f.sim.free();}}
});

test('Rotated tree submergence follows its horizontal proxy thickness, with fluid/body translation invariance',()=>{
 const f=fixture();try{f.bodies.fall(f.bodies.trees[0]);const b=[...f.bodies.bodies.values()][0];f.sim.sleep_prop(b.id);b.position.y=-.6;b.quaternion.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);f.bodies.spawn(b);f.field.water={sample:(x,z,out={})=>Object.assign(out,{height:0,ux:0,uz:0,depth:1000})};const a=b.environmentLoad({position:b.position,velocity:new Vector3(),dt:1/60});const stemShare=b.massModel.stemVolume/b.volume;assert.ok(a.wet>=stemShare-1e-9,`a submerged horizontal trunk must not retain its upright 24 m wet-depth scale: wet ${a.wet}, stem share ${stemShare}`);
   f.field.ambient=()=>({x:4,z:-2});f.field.water.sample=(x,z,out={})=>Object.assign(out,{height:0,ux:4,uz:-2,depth:1000});f.sim.sleep_prop(b.id);const h=b.half,p=b.position,q=b.quaternion;f.sim.wake_prop(b.id,0,new Float32Array(h.toArray()),new Float32Array([...p.toArray(),...q.toArray(),4,0,-2]),b.mass,.7,.05,false);if(b.principalInertia)f.sim.set_prop_mass_properties(b.id,b.mass,new Float32Array(b.principalInertia),new Float32Array(b.centerOfMass));const moved=b.environmentLoad({position:p,velocity:new Vector3(4,0,-2),dt:1/60});for(const k of ['fx','fy','fz','tx','ty','tz'])assert.ok(Math.abs(a[k]-moved[k])<1e-6,`${k} depends on shared fluid/body translation`);
 }finally{f.bodies.reset();f.sim.free();}
});
