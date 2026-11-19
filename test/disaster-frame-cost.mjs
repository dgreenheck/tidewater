// Per-frame cost of a fracture. Each fracture frame used to rebuild every island static
// collider inline (all trunks, boxes and cylinders, then a BVH rebuild) once from the
// structures and again from the trees, and to reset the TAA history (cameraCut), so a
// tornado smeared and stalled on every break. Now a fracture asks the car physics for one
// deferred rebuild, which runs once before the next physics step, and the image keeps its
// history because the pieces start exactly where the building stood.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Builder} from '../src/world/village/GeoBuilder.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3} from '../src/engine/index.js';
import {structure,STRUCTURES,StructuralDamage} from '../src/disasters/Structures.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});

const WIND=80; // m/s, an EF4 gust: well past the timber anchor capacity

function fixture(){
 const sim=new RallyPhysics(),colliders=new Colliders(),B=new Builder();
 sim.reset(100,100,100,0);
 structure('Fracture cost fixture',colliders,()=>{
  B.box('wood',-1.05,3,0,2,3,.08);
  B.box('wood',1.05,3,0,2,3,.08);
  B.box('roofMetal',0,4.55,0,4.3,.02,2);
  colliders.addBox(new Vector3(0,3,0),new Vector3(2.2,1.6,.1),0,{solid:true,walkable:true});
 });
 for(const b of Object.values(B.batches))b.build();
 const record=STRUCTURES.pop();
 const field={terrain:()=>-100,waterAt:()=>-100,sample:()=>({height:-100,wx:WIND,wy:0,wz:0,ux:0,uz:0,ax:0,ay:0,az:0,shake:0})};
 const calls={inline:0,deferred:0,cuts:0};
 const app={
  terrainData:{heightAt:()=>-100},colliders,
  rally:{physics:sim,refreshIslandColliders:()=>calls.inline++,requestIslandColliders:()=>calls.deferred++},
  cameraCut:()=>calls.cuts++,
 };
 const damage=new StructuralDamage(app,{field});
 damage.addRecords([record]);
 return {damage,record,calls};
}

test('A fracture frame keeps the TAA history and defers one static rebuild to the next physics step',()=>{
 const {damage,record,calls}=fixture();
 for(let frame=0;frame<30&&!record.active&&!record.broken;frame++)damage.update(1/60);
 assert.ok(record.active||record.broken,`an ${WIND} m/s wind did not break the fixture (utilization ${record.utilization?.toFixed(2)})`);
 assert.equal(calls.cuts,0,`the fracture reset the TAA history ${calls.cuts} times`);
 assert.equal(calls.inline,0,`the fracture rebuilt every island static inline ${calls.inline} times`);
 assert.ok(calls.deferred>=1,'the fracture never asked for its colliders to be rebuilt');
});

test('The real WASM catches up outside a disaster and runs at most 3 steps a frame during one',()=>{
 const sim=new RallyPhysics();sim.reset(100,100,100,0);
 sim.set_max_steps(12);
 const outside=sim.advance(1/30,0,0,0,1);
 assert.equal(outside,4,`a 1/30 s frame outside a disaster ran ${outside} fixed steps, want 4 (real time)`);
 sim.set_max_steps(3);
 const during=sim.advance(.1,0,0,0,1);
 assert.ok(during<=3,`a 100 ms frame during a disaster ran ${during} fixed steps, cap 3`);
});
