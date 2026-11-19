// Events draw independent seeds. Replaying an explicit seed reproduces the event.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {DisasterField,smooth} from '../src/disasters/Field.js';
import {TornadoParticles} from '../src/disasters/TornadoParticles.js';
import {Builder} from '../src/world/village/GeoBuilder.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3} from '../src/engine/index.js';
import {structure,STRUCTURES,StructuralDamage,STRENGTHS} from '../src/disasters/Structures.js';
import {capacityFactor,CAPACITY_COV,STREAM} from '../src/disasters/EventRandom.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});

const TRACK={x:0,z:0,speed:6,direction:0,intensity:80,radius:100,duration:90}; // m/s, deg, m, s
function run(seconds,config){
 const field=new DisasterField(()=>0),e=field.start('tornado',config);
 for(let t=0;t<seconds;t+=1/30)field.advance(1/30);
 return {field,e,c:field.center(e)};
}
// Peak tangential plus radial wind at the core radius, divided by the configured intensity.
function intensityFactor(field,e){
 const c=field.center(e),core=e.radius*.18,w=field.sampleRaw(c.x+core,1,c.z,{}),fall=smooth(1-core/e.radius);
 return Math.hypot(w.wx,w.wz)/(e.intensity*fall*Math.hypot(1,.28)*field.envelope(e));
}

test('Two fresh tornadoes take different tracks; a fixed seed replays one exactly',()=>{
 const a=run(40,{...TRACK}),b=run(40,{...TRACK});
 const apart=Math.hypot(a.c.x-b.c.x,a.c.z-b.c.z);
 assert.ok(apart>.5,`two fresh tornadoes ended 40 s apart by ${apart.toFixed(3)} m: the track is scripted`);
 // The wind at 40 s is 1 + pulse + gust + flutter, each a sine with a fresh phase and amplitude
 // (TornadoMotion.js: 5-12%, 2-6%, 1-4%). Two fresh draws can land 0.005 apart by chance (0.8970
 // and 0.9018 on lane/tsunami), so two samples cannot tell scripted from random. Eight fresh draws
 // spread over about 2.8 sd (sd about 0.07, so about 0.2). The density of the factor is at most
 // about 16 per unit (the gust and flutter terms smooth the pulse's arcsine peaks), so all eight
 // inside 0.01 of the lowest has probability below 8 x (16 x 0.01)^7, about 2e-5 per run.
 // A scripted wind gives a spread of exactly 0.
 const factors=Array.from({length:8},()=>{const r=run(40,{...TRACK});return intensityFactor(r.field,r.e);}),spread=Math.max(...factors)-Math.min(...factors);
 assert.ok(spread>.01,`eight fresh tornadoes blew ${factors.map(f=>f.toFixed(4)).join(', ')} x intensity at 40 s (spread ${spread.toFixed(4)}): the wind is scripted`);
 const s=run(40,{...TRACK,seed:12345}),r=run(40,{...TRACK,seed:12345});
 assert.deepEqual(r.c,s.c,'the same seed took a different track');
 assert.deepEqual(r.field.sampleRaw(20,2,5,{}),s.field.sampleRaw(20,2,5,{}),'the same seed blew a different wind');
});

test('Across 8 seeds the tornado keeps its configured speed, heading and intensity band',()=>{
 for(let seed=1;seed<=8;seed++){
  const field=new DisasterField(()=>0),e=field.start('tornado',{...TRACK,seed});let sum=0,n=0,lo=Infinity,hi=-Infinity;
  for(let t=0;t<60;t+=1/30){field.advance(1/30);if(e.time<2)continue;const f=intensityFactor(field,e);sum+=f;n++;lo=Math.min(lo,f);hi=Math.max(hi,f);}
  const c=field.center(e),along=c.x-TRACK.x,across=Math.abs(c.z-TRACK.z),straight=TRACK.speed*e.time;
  assert.ok(along>.75*straight&&along<1.25*straight,`seed ${seed}: ${along.toFixed(1)} m along the heading in ${e.time.toFixed(1)} s, want ${straight.toFixed(0)} m +-25%`);
  assert.ok(across<straight*Math.sin(15*Math.PI/180),`seed ${seed}: drifted ${across.toFixed(1)} m off the heading in ${straight.toFixed(0)} m (cap 15 deg)`);
  assert.ok(lo>=.75&&hi<=1.25,`seed ${seed}: intensity factor ranged ${lo.toFixed(3)} to ${hi.toFixed(3)}, band 0.75 to 1.25`);
  assert.ok(Math.abs(sum/n-1)<.06,`seed ${seed}: mean intensity factor ${(sum/n).toFixed(3)}, want 1 +-6% (the slider sets the EF band)`);
 }
});

test('Two fresh tornadoes raise their dust and debris differently; a fixed seed replays the spawn',()=>{
 const spawn=config=>{const f=new DisasterField(()=>0),e=f.start('tornado',config),m=new TornadoParticles(f,{dust:40,flecks:4});m.update(1/30,e);return [...m.dust.slice(0,1),...m.flecks].map(p=>[p.p.x,p.p.y,p.p.z,p.life]);};
 const a=spawn({...TRACK,speed:0}),b=spawn({...TRACK,speed:0});
 assert.notDeepEqual(a,b,'two fresh tornadoes spawned their parcels at the same places with the same lives');
 assert.deepEqual(spawn({...TRACK,speed:0,seed:7}),spawn({...TRACK,speed:0,seed:7}),'the same seed spawned different parcels');
});

test('Identical houses under the same wind do not all go at once; the run seed picks which',()=>{
 const house=()=>{const colliders=new Colliders(),B=new Builder();structure('Scatter house',colliders,()=>{B.box('wood',-1.05,3,0,2,3,.08);B.box('wood',1.05,3,0,2,3,.08);B.box('roofMetal',0,4.55,0,4.3,.02,2);});for(const b of Object.values(B.batches))b.build();return STRUCTURES.pop();};
 const activated=runSeed=>{
  const sim=new RallyPhysics();sim.reset(100,100,100,0);const records=Array.from({length:12},house);
  let wind=0;const field={terrain:()=>-100,waterAt:()=>-100,sample:()=>({height:-100,wx:wind,wy:0,wz:0,ux:0,uz:0,ax:0,ay:0,az:0,shake:0})};
  const damage=new StructuralDamage({terrainData:{heightAt:()=>-100},colliders:new Colliders(),rally:{physics:sim,refreshIslandColliders(){},requestIslandColliders(){}}},{field,runSeed});
  damage.addRecords(records);
  const h=records[0].half,mat=STRENGTHS.timber,capacity=8*h.x*h.y*h.z*mat.density*9.81*mat.anchorG,area=4*h.y*Math.max(h.x,h.z);
  // The wind that loads the nominal anchor to 0.52, just past the 0.5 activation line.
  wind=Math.sqrt(.52*capacity/(.5*1.225*area*mat.drag));
  damage.update(1/60);return records.map(r=>r.utilization>.5);
 };
 const a=activated(101),b=activated(202),count=list=>list.filter(Boolean).length;
 assert.ok(count(a)>=1&&count(a)<=11,`run seed 101: ${count(a)} of 12 identical houses reached activation under one wind (all-or-nothing is scripted)`);
 assert.notDeepEqual(a,b,'two run seeds activated the same houses');
});

test('Capacity scatter keeps the nominal mean and the cited spread',()=>{
 for(const [kind,cov] of Object.entries(CAPACITY_COV)){
  let sum=0,sq=0;const n=4000;for(let i=0;i<n;i++){const f=capacityFactor(99,STREAM.anchor,i,cov);sum+=f;sq+=f*f;}
  const mean=sum/n,sd=Math.sqrt(sq/n-mean*mean);
  assert.ok(Math.abs(mean-1)<.02,`${kind}: mean factor ${mean.toFixed(3)}, want 1`);
  assert.ok(Math.abs(sd-cov)<.03,`${kind}: COV ${sd.toFixed(3)}, cited ${cov}`);
 }
 assert.equal(capacityFactor(undefined,STREAM.anchor,3,.25),1,'no seed must mean nominal capacity');
});
