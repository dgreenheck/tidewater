import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Builder} from '../src/world/village/GeoBuilder.js';
import {buildBoardwalk} from '../src/world/village/Boardwalk.js';
import {Rand} from '../src/world/Props.js';
import {mulberry32} from '../src/util/Noise.js';
import {Colliders} from '../src/world/Colliders.js';
import {structure,STRUCTURES,StructuralDamage} from '../src/disasters/Structures.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const advance=(sim,n)=>{for(let i=0;i<n;i++)sim.advance(1/120,0,0,0,0);};
const poses=sim=>{const p=sim.prop_poses(),a=[];for(let i=0;i<p.length;i+=10)a.push(Array.from(p.slice(i,i+10)));return a;};

test('Real boardwalk fragments retain authored geometry and collide above flat or sloping terrain after embedded foundations break',()=>{
 for(const slope of [0,.025]){const sim=new RallyPhysics(),B=new Builder(),colliders=new Colliders(),terrain={heightAt:(x,z)=>3+slope*z};
  const res=81,size=80,origin=-40,heights=Float32Array.from({length:res*res},(_,i)=>terrain.heightAt(origin+(i%res+.5)*size/res,origin+(Math.floor(i/res)+.5)*size/res));
  sim.set_terrain(heights,res,size,origin);sim.reset(-30,terrain.heightAt(-30,0)+1,0,0);
  const before=STRUCTURES.length;structure('Boardwalk regression',colliders,()=>buildBoardwalk({B,terrain,colliders,rand:new Rand(mulberry32(11)),lights:[],checks:[]},[[10,-12],[10,0],[10,12]],{lightEvery:1e9}),'light');
  for(const b of Object.values(B.batches))b.build();const record=STRUCTURES.pop();assert.equal(STRUCTURES.length,before);
  const app={terrainData:terrain,rally:{physics:sim}},damage=new StructuralDamage(app,{});damage.addRecords([record]);
  const original=record.spans.map(s=>s.geo.attributes.position.array.slice(s.start*3,(s.start+s.count)*3));
  try{assert.equal(damage.fracture(record),true);damage.sync(sim.prop_poses());for(let i=0;i<record.spans.length;i++){const s=record.spans[i],current=s.geo.attributes.position.array.slice(s.start*3,(s.start+s.count)*3);for(let j=0;j<current.length;j++)assert.ok(Math.abs(current[j]-original[i][j])<1e-5,'fracture must not snap authored vertices upward');}
   advance(sim,1200);const p=poses(sim);assert.ok(p.length>1);for(const body of p)assert.ok(body[2]>terrain.heightAt(body[1],body[3])-.12,`buried boardwalk body ${body[0]}: y=${body[2]}, ground=${terrain.heightAt(body[1],body[3])}`);
   damage.reset();assert.equal(sim.prop_count(),0);assert.ok(record.colliders.every(c=>c.solid&&c.walkable));
  }finally{sim.free();}
 }
});

test('Shipped debris swept collision catches a fast thin panel at the terrain surface',()=>{
 const sim=new RallyPhysics();try{sim.set_terrain(new Float32Array(25),5,100,-50);sim.reset(-20,1,0,0);
  assert.ok(sim.wake_prop(990,0,new Float32Array([.3,.025,.3]),new Float32Array([10,.6,0,0,0,0,1,0,-180,0]),8,.6,.05,false));
  advance(sim,120);const body=poses(sim).find(p=>p[0]===990);assert.ok(body[2]>-.1,`thin panel tunneled below terrain to ${body[2]}m`);
 }finally{sim.free();}
});
