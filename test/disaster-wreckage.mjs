import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3,Quaternion} from '../src/engine/index.js';
import {Wreckage,makePiece,stepPiece} from '../src/rally/Wreckage.js';
import {DisasterField} from '../src/disasters/Field.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {Damage} from '../src/rally/Damage.js';

test('Disaster snapshot restores pre-existing loose car pieces instead of repairing or deleting them',()=>{
 const scene=new Group(),terrain={heightAt:()=>0,normalAt:(x,z,n)=>n.set(0,1,0)},wreckage=new Wreckage(scene,terrain);
 const oldObject=new Group(),piece=wreckage.add(oldObject,{position:new Vector3(3,2,1),quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4),velocity:new Vector3(1,2,3),spin:new Vector3(.3,.4,.5),wheel:{radius:.34,width:.12}});
 const prior={pos:piece.pos.toArray(),q:piece.q.toArray(),vel:piece.vel.toArray(),w:piece.w.toArray(),wheel:structuredClone(piece.wheel)};
 const damage=Object.create(Damage.prototype);damage.cars=new Map();damage.wreckage=wreckage;damage.fx={clear(){}};damage.rally={physics:{take_impacts(){}}};damage.applyMechanical=()=>{};
 const saved=damage.captureDisasterState();wreckage.update(.05);piece.gone=3;wreckage.update(.05);
 const newObject=new Group();wreckage.add(newObject,{position:new Vector3(0,10,0)});
 damage.restoreDisasterState(saved);
 assert.equal(wreckage.pieces.length,1);assert.equal(wreckage.pieces[0],piece);assert.equal(piece.object,oldObject);assert.equal(oldObject.parent,scene);assert.equal(newObject.parent,null);
 assert.deepEqual(piece.pos.toArray(),prior.pos);assert.deepEqual(piece.q.toArray(),prior.q);assert.deepEqual(piece.vel.toArray(),prior.vel);assert.deepEqual(piece.w.toArray(),prior.w);assert.deepEqual(piece.wheel,prior.wheel);assert.equal(piece.age,0);assert.equal(piece.gone,0);
 assert.deepEqual(oldObject.position.toArray(),prior.pos);assert.deepEqual(oldObject.quaternion.toArray(),prior.q);
});

test('Actual Wreckage update receives mass/area air drag and only supported ground acceleration',()=>{
 const terrain={heightAt:()=>0,normalAt:(x,z,n)=>n.set(0,1,0)};
 const field=new DisasterField(()=>0);field.ambient=()=>({x:20,z:0});
 const w=new Wreckage(new Group(),terrain);w.environment=()=>field;
 const piece=w.add(new Group(),{position:new Vector3(0,10,0),mass:5,area:1});w.update(.05);
 const factor=.05*.5*1.225*1.1*20/5,expected=20*factor/(1+factor);
 assert.ok(Math.abs(piece.vel.x-expected)<1e-12);assert.ok(piece.pos.x>0);assert.ok(piece.vel.y<0);
 const quake=new DisasterField(()=>0);quake.start('earthquake',{x:0,z:0,intensity:2,frequency:.2});for(let i=0;i<12;i++)quake.advance(.1);
 const shaken=new Wreckage(new Group(),terrain);shaken.environment=()=>quake;
 const supported=shaken.add(new Group(),{position:new Vector3(0,.05,0),rest:.05,area:0});
 const airborne=shaken.add(new Group(),{position:new Vector3(0,5,0),rest:.05,area:0});shaken.update(.05);
 assert.ok(Math.abs(supported.vel.x)>.01);assert.equal(airborne.vel.x,0);
});

test('Actual Wreckage water damping is relative to common current and uses the common flood surface',()=>{
 const terrain={heightAt:()=>-5,normalAt:(x,z,n)=>n.set(0,1,0)},field=new DisasterField(()=>-5);
 field.water=new WaterGrid(()=>-5,{n:17,dx:8,sponge:false,friction:false});field.water.h.fill(7);field.water.qx.fill(21);field.water.qz.fill(-14);field.water.pack();
 const w=new Wreckage(new Group(),terrain);w.environment=()=>field;
 const p=w.add(new Group(),{position:new Vector3(0,2,0),area:0,floats:30});w.update(.05);
 const damping=Math.exp(-.05*1.2);assert.ok(Math.abs(p.vel.x-3*(1-damping))<1e-12);assert.ok(Math.abs(p.vel.z+2*(1-damping))<1e-12);assert.ok(p.wet>=0);
 const moving=w.add(new Group(),{position:new Vector3(0,2,0),velocity:new Vector3(3,0,-2),area:0,floats:30});w.update(.05);
 assert.equal(moving.vel.x,3);assert.equal(moving.vel.z,-2);
 for(let i=0;i<100;i++)w.update(.05);assert.ok(Math.abs(p.pos.y-2)<.15);assert.ok(p.pos.x>1);
});

test('Extreme wind remains finite for a light broad car scrap and absent environment preserves the legacy path',()=>{
 const terrain={heightAt:()=>0,normalAt:(x,z,n)=>n.set(0,1,0)},field=new DisasterField(()=>0);field.ambient=()=>({x:120,z:0});
 const w=new Wreckage(new Group(),terrain);w.environment=()=>field;const p=w.add(new Group(),{position:new Vector3(0,100,0),mass:.25,area:4});
 for(let i=0;i<240;i++){w.update(1/60);assert.ok(p.vel.x>=0&&p.vel.x<=120);assert.ok([...p.pos.toArray(),...p.vel.toArray()].every(Number.isFinite));}
 const old=new Wreckage(new Group(),terrain),a=old.add(new Group(),{position:new Vector3(0,3,0),velocity:new Vector3(1,0,0)}),b=makePiece({position:new Vector3(0,3,0),velocity:new Vector3(1,0,0)});
 for(let i=0;i<30;i++){old.update(1/60);stepPiece(b,1/60,terrain,0);}assert.deepEqual(a.pos,b.pos);assert.deepEqual(a.vel,b.vel);assert.deepEqual(a.q,b.q);
});

test('A grounded loose wheel converts shared wind impulse into rolling and lateral slip without energy gain',()=>{
 const run=wind=>{const scene=new Group(),w=new Wreckage(scene,{heightAt:()=>0,normalAt:(x,z,n)=>n.set(0,1,0)});const field=new DisasterField(()=>0);field.ambient=()=>({x:wind,z:0});w.environment=()=>field;
  const piece=w.add(new Group(),{position:new Vector3(0,.34,0),mass:22,area:.2,radius:.34,rest:.12,wheel:{radius:.34,width:.12}});piece.wheel.side=1;
  for(let i=0;i<30;i++)w.update(1/60);return {w,piece,field};};
 const calm=run(0),gust=run(120);assert.ok(gust.piece.pos.x>1,`grounded wheel position ${gust.piece.pos.x}`);assert.ok(Math.abs(calm.piece.pos.x)<1e-8);
 assert.ok(gust.piece.vel.length()<120);gust.field.ambient=()=>({x:0,z:0});let energy=Infinity;
 for(let i=0;i<60;i++){gust.w.update(1/120);const next=.5*22*gust.piece.vel.lengthSq();assert.ok(next<=energy+1e-3);energy=next;}
});
