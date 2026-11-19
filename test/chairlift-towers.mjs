import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainData} from '../src/world/TerrainData.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {Colliders} from '../src/world/Colliders.js';
import {Group,Vector3} from '../src/engine/index.js';
import {prepareChairliftSite,LIFT} from '../src/chairlift/Route.js';
import {buildChairlift} from '../src/chairlift/Geometry.js';
import {spanBounds} from '../src/disasters/Structures.js';

const terrain=new TerrainData(),roads=new CoastalRoute(terrain),site=prepareChairliftSite(terrain,roads);
const app={terrainData:terrain,colliders:new Colliders(),scene:new Group(),village:{materials:{wood:{},hard:{},stone:{},rope:{},roofMetal:{}}}};
const before=site.supports.map(p=>({...p})),model=buildChairlift(app,site),towers=model.records.filter(r=>/^Chairlift tower \d+$/.test(r.name));

test('Actual chairlift towers have four independently grounded feet and connected braced bays up to the cable head',()=>{
 assert.equal(towers.length,12);
 for(const r of towers){
  const feet=r.spans.filter(s=>s.member?.material==='stone');
  assert.equal(feet.length,4,`${r.name} must have four separate footings, not one slender pole`);
  const plan=r.tower;
  assert.equal(plan.feet.length,4);assert.equal(plan.legs.length,4);
  assert.equal(new Set(plan.feet.map(p=>`${p.x}:${p.z}`)).size,4);
  for(let k=0;k<4;k++){
   const foot=plan.feet[k],bounds=spanBounds([feet[k]]);
   for(const sample of foot.samples){assert.ok(foot.bottom<=sample.ground-.4);assert.ok(foot.top>=sample.ground+.19);}
   assert.ok(Math.abs(bounds.lo.y-foot.bottom)<2e-5&&Math.abs(bounds.hi.y-foot.top)<2e-5,'actual rendered concrete must match the grounded foundation');
   const segments=plan.legs[k];assert.ok(segments.length>2);
   assert.deepEqual(segments[0].a,[foot.x,foot.top,foot.z]);
   for(let i=0;i<segments.length;i++){const b=segments[i];assert.ok(b.b[1]-b.a[1]<=4.00001);if(i)assert.deepEqual(segments[i-1].b,b.a);}
   assert.equal(segments.at(-1).b[1],plan.headY);
  }
  // Every exposed face bay has both diagonal load paths and a horizontal tie.
  assert.ok(plan.panels.length>=8);
  for(const panel of plan.panels){assert.equal(panel.diagonals.length,2);assert.deepEqual(panel.diagonals[0].a,panel.lo[0]);assert.deepEqual(panel.diagonals[0].b,panel.hi[1]);assert.deepEqual(panel.diagonals[1].a,panel.lo[1]);assert.deepEqual(panel.diagonals[1].b,panel.hi[0]);}
  assert.ok(plan.headBeams.length>=8,'the transverse sheave beams need a connected trussed head');
 }
 assert.deepEqual(site.supports,before,'tower redesign cannot move the validated cable route');
 assert.ok(model.triangles<60000,`chairlift triangle budget ${model.triangles}`);
});

test('Actual lattice proxies preserve a clear upright seat envelope on both strands, including the steepest foundations',()=>{
 const proxies=app.colliders.boxes.filter(b=>b.tag==='chairlift-tower');
 assert.ok(proxies.length>=48,'four foundation and braced hull proxies replace the thin pole');
 let worst=0;
 for(const t of site.supports.slice(1,-1))for(const side of [-1,1])for(const a of [-.48,0,.52])for(const c of [-.925,0,.925]){
  const p=new Vector3(t.x+site.forward.x*a+site.right.x*(side*LIFT.laneRadius+c),t.y-LIFT.feetDrop,t.z+site.forward.z*a+site.right.z*(side*LIFT.laneRadius+c)),initial=p.clone(),world=new Colliders();world.boxes=proxies;world.resolveCapsule(p,.06,1.75,0);worst=Math.max(worst,p.distanceTo(initial));
 }
 assert.ok(worst<1e-9,`upright seat frame intersects a tower by ${worst}m`);
 const steep=towers[10].tower,grounds=steep.feet.map(f=>f.ground);assert.ok(Math.max(...grounds)-Math.min(...grounds)>20,'fixture retains the real steep tower site');
});
