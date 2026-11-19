import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Builder} from '../src/world/village/GeoBuilder.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3,Quaternion} from '../src/engine/index.js';
import {structure,STRUCTURES,StructuralDamage} from '../src/disasters/Structures.js';
import {materialMembers,memberFrame} from '../src/disasters/MaterialMembers.js';
import {drawMember} from '../src/disasters/MemberSkin.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const rows=(sim)=>{const a=sim.structure_joint_states(),out=[];for(let i=0;i<a.length;i+=15)out.push(Array.from(a.slice(i,i+15)));return out;};
function fixture(name='Connected timber fixture',decoration=false){const sim=new RallyPhysics(),colliders=new Colliders(),B=new Builder(),terrain={heightAt:()=>-100};sim.reset(100,100,100,0);
 structure(name,colliders,()=>{B.box('wood',-1.05,3,0,2,3,.08);B.box('wood',1.05,3,0,2,3,.08);B.box('roofMetal',0,4.55,0,4.3,.02,2);if(decoration==='torus')B.torus('hard',-1.05,3.8,.15,.18,.02);else if(decoration)B.box('hard',-1.05,3.02,.15,.42,.36,.08);colliders.addBox(new Vector3(0,3,0),new Vector3(2.2,1.6,.1),0,{solid:true,walkable:true});});
 for(const b of Object.values(B.batches))b.build();const record=STRUCTURES.pop(),field={terrain:()=>-100,sample:()=>({height:-100,wx:0,wy:0,wz:0,ux:0,uz:0,ax:0,ay:0,az:0})};const app={terrainData:terrain,colliders,rally:{physics:sim,refreshIslandColliders:()=>{}}},damage=new StructuralDamage(app,{field});damage.addRecords([record]);return {sim,damage,record,colliders};}
const vertices=r=>r.spans.map(s=>s.geo.attributes.position.array.slice(s.start*3,(s.start+s.count)*3));
const step=(sim,damage,n,loads)=>{for(let i=0;i<n;i++){sim.set_disaster_loads(new Float32Array(loads()));sim.advance(1/120,0,0,0,0);damage.sync(sim.prop_poses());}};

test('Authored material entry builds connected sections, preserves rest geometry and restores all joints/colliders',()=>{
 const {sim,damage,record,colliders}=fixture();try{const before=vertices(record),solid=colliders.boxes.length;assert.ok(damage.fracture(record));assert.ok(rows(sim).length>=5,'material connections must exist, not four detached quadrants');assert.ok(record.members.some(m=>m.material==='steel'));assert.ok(record.members.some(m=>m.material==='timber'));assert.ok(record.members.every(m=>m.sections.length===2));
  damage.sync(sim.prop_poses());const after=vertices(record);for(let j=0;j<before.length;j++)for(let i=0;i<before[j].length;i++)assert.ok(Math.abs(before[j][i]-after[j][i])<2e-5,'initial deformation must be zero');
  damage.reset();assert.equal(sim.prop_count(),0);assert.deepEqual(rows(sim),[]);assert.deepEqual(vertices(record),before);assert.equal(colliders.boxes.length,solid);assert.equal(record.colliders[0].solid,true);
 }finally{sim.free();}
});

test('Actual connected panels transfer a subfailure load, bend continuously, then lose only overloaded connections without a throw',()=>{
 const {sim,damage,record}=fixture();try{assert.ok(damage.fracture(record));assert.ok(rows(sim).length>=5,'connected material load path is present');const target=record.members.find(m=>m.material==='timber').sections.at(-1),initial=vertices(record);
  const loads=()=>[...damage.bodies.values()].flatMap(b=>[b.id,b===target?12:0,9.81*b.mass,0,0,0,0]);step(sim,damage,360,loads);
  const js=rows(sim);assert.ok(js.some(j=>Math.hypot(...j.slice(2,5))>1),'load must reach a real connector');assert.ok(js.every(j=>j[1]===0),'small load keeps all connections');
  const moved=vertices(record).some((a,j)=>a.some((v,i)=>Math.abs(v-initial[j][i])>.0005));assert.ok(moved,'actual solved deformation reaches authored geometry');
  step(sim,damage,60,()=>[...damage.bodies.values()].flatMap(b=>[b.id,b===target?20000:0,9.81*b.mass,0,0,0,0]));const broken=rows(sim);assert.ok(broken.some(j=>j[1]===1));assert.ok(broken.some(j=>j[1]===0),'unloaded neighbours remain connected');assert.ok(broken.every(j=>j.every(Number.isFinite)));assert.ok(broken.filter(j=>j[1]).every(j=>j[10]===0&&j[11]>=0));
 }finally{damage.reset();sim.free();}
});

test('Continuous member skin is invariant under a shared rigid transform and contains real intermediate section vertices',()=>{
 const {sim,damage,record}=fixture();try{assert.ok(damage.fracture(record));const member=record.members.find(m=>m.material==='timber'),rotation=new Quaternion().setFromAxisAngle(new Vector3(.2,.5,.7).normalize(),.8),translation=new Vector3(4,2,-3);
  for(const body of member.sections){body.position.copy(body.origin).applyQuaternion(rotation).add(translation);body.quaternion.copy(rotation).multiply(body.restQuaternion);}
  drawMember(member);let intermediate=0;for(const s of member.spans)for(let i=0;i<s.pos.length;i+=3){const p=new Vector3().fromArray(s.pos,i),actual=new Vector3().fromArray(s.geo.attributes.position.array,s.start*3+i),expected=p.clone().applyQuaternion(rotation).add(translation);assert.ok(actual.distanceTo(expected)<2e-5);const u=p.sub(member.center).dot(member.axes[0])/member.length+.5;if(u>.2&&u<.8)intermediate++;}assert.ok(intermediate>12,'surface tessellation must allow visible bending between end faces');
 }finally{damage.reset();sim.free();}
});

test('Bending and severed skin agree with the two solved section frames for every vertex and normal',()=>{
 const {sim,damage,record}=fixture();try{assert.ok(damage.fracture(record));const member=record.members.find(m=>m.material==='timber');
  const rotations=[new Quaternion().setFromAxisAngle(new Vector3(.2,.7,.4).normalize(),.37),new Quaternion().setFromAxisAngle(new Vector3(.8,.1,.3).normalize(),-.48)];
  member.sections.forEach((b,i)=>{b.position.copy(b.origin).add(new Vector3(i*.4,.2,-i*.3));b.quaternion.copy(rotations[i]).multiply(b.restQuaternion);});
  for(const severed of [false,true]){member.severed=severed;drawMember(member);for(const s of member.spans)for(let i=0;i<s.pos.length;i+=3){
   const p=new Vector3().fromArray(s.pos,i),u=Math.max(0,Math.min(1,p.clone().sub(member.center).dot(member.axes[0])/member.length+.5));let t=u;
   if(severed){const tri=Math.floor(i/9)*9,centroid=new Vector3();for(let j=0;j<9;j+=3)centroid.add(new Vector3().fromArray(s.pos,tri+j));t=centroid.multiplyScalar(1/3).sub(member.center).dot(member.axes[0])>0?1:0;}
   const projected=member.sections.map((b,k)=>p.clone().sub(b.origin).applyQuaternion(rotations[k]).add(b.position));
   const expected=projected[0].lerp(projected[1],t),actual=new Vector3().fromArray(s.geo.attributes.position.array,s.start*3+i);assert.ok(actual.distanceTo(expected)<2e-5);
   if(s.nrm){const n=new Vector3().fromArray(s.nrm,i),expected=n.clone().applyQuaternion(rotations[0]).lerp(n.clone().applyQuaternion(rotations[1]),t).normalize(),actual=new Vector3().fromArray(s.geo.attributes.normal.array,s.start*3+i);assert.ok(actual.distanceTo(expected)<2e-5);}
  }}
 }finally{damage.reset();sim.free();}
});

test('Rejected member capacity transaction leaves authored solids and geometry intact',()=>{
 const {sim,damage,record}=fixture();try{const original=vertices(record);damage.bodyBudget=1;assert.equal(damage.fracture(record),false);assert.equal(sim.prop_count(),0);assert.deepEqual(rows(sim),[]);assert.deepEqual(vertices(record),original);assert.equal(record.colliders[0].solid,true);assert.equal(record.broken,false);
 }finally{sim.free();}
});

for(const shape of ['box','torus'])for(const severed of [false,true])test(`Actual indexed decorative ${shape} triangles remain rigid during ${severed?'severing':'bending'} of parent sections`,()=>{
 const {sim,damage,record}=fixture('Indexed ornament fracture fixture',shape);try{
  assert.ok(damage.fracture(record));const member=record.members.find(m=>m.spans.some(s=>s.member?.material==='hard')),span=member?.spans.find(s=>s.member?.material==='hard');assert.ok(span);assert.equal(member.sections.length,2);assert.equal(span.count,shape==='torus'?119:24,'fixture is the real indexed primitive, not a triangle-soup substitute');
  member.sections.forEach((b,i)=>{b.position.copy(b.origin).add(new Vector3(i*30,0,0));b.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),i*.4)).multiply(b.restQuaternion);});
  const indices=span.geo.index.array,triangles=[];for(let i=0;i<indices.length;i+=3)if(indices[i]>=span.start&&indices[i]<span.start+span.count)triangles.push(Array.from(indices.slice(i,i+3)));
  assert.equal(triangles.length,shape==='torus'?192:12);
  {member.severed=severed;drawMember(member);
   for(const tri of triangles)for(let edge=0;edge<3;edge++){
    const a=tri[edge],b=tri[(edge+1)%3],restA=new Vector3().fromArray(span.pos,(a-span.start)*3),restB=new Vector3().fromArray(span.pos,(b-span.start)*3),nowA=new Vector3().fromArray(span.geo.attributes.position.array,a*3),nowB=new Vector3().fromArray(span.geo.attributes.position.array,b*3);
    assert.ok(Math.abs(nowA.distanceTo(nowB)-restA.distanceTo(restB))<2e-5,`indexed triangle bridges separated section poses (${severed?'severed':'bending'}): ${nowA.distanceTo(nowB)}m instead of ${restA.distanceTo(restB)}m`);
   }
  }
 }finally{damage.reset();sim.free();}
});

test('Deck member ranges preserve every authored triangle through repeated activation and Restore',()=>{
 const {sim,damage,record}=fixture('Boardwalk fixture');try{const initial=vertices(record);let description;
  for(let cycle=0;cycle<2;cycle++){assert.ok(damage.fracture(record));assert.ok(record.members.every(m=>m.module&&m.sections.length===1));
   const rendered=record.members.flatMap(m=>m.spans);assert.equal(rendered.reduce((n,s)=>n+s.count,0),record.spans.reduce((n,s)=>n+s.count,0));assert.ok(rendered.some(s=>s.count>3),'adjacent triangles share a render range');
   if(description)assert.equal(record.memberDescriptions,description);description=record.memberDescriptions;
   const current=vertices(record);for(let j=0;j<initial.length;j++)for(let i=0;i<initial[j].length;i++)assert.ok(Math.abs(initial[j][i]-current[j][i])<2e-5);
   damage.reset();assert.deepEqual(vertices(record),initial);assert.equal(sim.prop_count(),0);assert.deepEqual(rows(sim),[]);
  }
 }finally{damage.reset();sim.free();}
});

import {nativeAngularVelocity} from '../src/disasters/RigidLoads.js';
test('Actual native connection damping is dissipative for unequal masses and coupled angular/linear motion',()=>{
 const sim=new RallyPhysics();try{sim.reset(150,150,150,0);const masses=[1,40];for(let k=0;k<2;k++)sim.wake_prop(501+k,0,new Float32Array([.25,.25,.25]),new Float32Array([k?2:-2,100,0,0,0,0,1,k?-1:1,0,0]),masses[k],0,0,false);
  sim.set_disaster_loads(new Float32Array([501,0,9.81,0,0,0,0,502,0,392.4,0,0,0,0]));sim.advance(1/120,0,0,0,0);
  assert.ok(sim.add_structure_joint(600,501,502,new Float32Array([0,100,0]),new Float32Array([1e6,1e6,1e9,1e9,5])));sim.set_prop_angular_velocity(501,new Float32Array([6,2,1]));sim.set_prop_angular_velocity(502,new Float32Array([-2,1,3]));
  const kinetic=()=>{const a=sim.disaster_motion();let E=0;for(let i=0;i<a.length;i+=7)if(a[i]>=501){const k=a[i]-501,p=new Vector3().fromArray(a,i+1),v=new Vector3().fromArray(a,i+4),w=nativeAngularVelocity(sim,a[i],p,v);E+=.5*masses[k]*(v.lengthSq()+w.lengthSq()/24);}return E;};
  const first=kinetic();let previous=first;for(let i=0;i<180;i++){sim.advance(1/120,0,0,0,0);const E=kinetic();assert.ok(E<=previous+.002,`joint damping injected ${E-previous}J`);previous=E;}const j=rows(sim)[0];assert.ok(previous<first*.9);assert.ok(j[13]>1);assert.ok(Math.abs(first-previous-j[13])<.04,`unaccounted damping work ${first-previous-j[13]} J`);
 }finally{sim.free();}
});

test('Repeated native poses leave geometry untouched while motion and connection failure invalidate the skin',()=>{
 const {sim,damage,record}=fixture('Sleeping member cache');try{
  assert.ok(damage.fracture(record));const member=record.members.find(m=>m.sections.length===2),attribute=member.spans[0].geo.attributes.position,poses=sim.prop_poses();
  const version=attribute.version;damage.sync(poses);assert.equal(attribute.version,version,'unchanged poses must not upload geometry again');
  const id=member.sections[1].id;for(let i=0;i<poses.length;i+=10)if(poses[i]===id)poses[i+1]+=.3;
  damage.sync(poses);assert.ok(attribute.version>version);const moved=attribute.version;damage.sync(poses);assert.equal(attribute.version,moved);
  const states=sim.structure_joint_states();for(let i=0;i<states.length;i+=15)if(states[i]===member.joint)states[i+1]=1;
  const original=sim.structure_joint_states.bind(sim);sim.structure_joint_states=()=>states;
  damage.sync(poses);assert.equal(member.severed,true);assert.ok(attribute.version>moved,'a break must redraw even when section poses are identical');sim.structure_joint_states=original;
  damage.reset();assert.ok(damage.fracture(record));assert.ok(record.members.every(m=>m.skinDirty===false));
 }finally{damage.reset();sim.free();}
});
