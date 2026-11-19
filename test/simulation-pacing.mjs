import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationPacing,DISASTER_MAX_STEP,DISASTER_PHYSICS_STEPS,CATCH_UP_PHYSICS_STEPS} from '../src/core/SimulationPacing.js';

// During a disaster one physics advance runs at most 3 fixed steps of 1/120 s (rally-physics DISASTER_MAX_STEPS).
const PHYSICS_BUDGET=3/120; // s

test('Bounded playback avoids catch-up growth without chasing fixed rendering costs by freezing time',()=>{
 const clock=new SimulationPacing({mode:'smooth',storage:null});let wall=.1,total=0,real=0,finalCost;
 // An 18 ms render cost plus 700 ms of simulation work per simulated second.
 for(let i=0;i<180;i++){
  const accepted=clock.step(wall,true),cost=18+accepted*700;clock.observe(cost,accepted,wall);
  assert.ok(accepted>0&&accepted<=wall);assert.ok(accepted<=PHYSICS_BUDGET);
  total+=accepted;real+=wall;wall=cost/1000;finalCost=cost;
 }
 assert.ok(finalCost<42);assert.ok(total<real);assert.ok(clock.rate<1&&clock.rate>.7);
 for(let i=0;i<180;i++){const accepted=clock.step(.1,true);clock.observe(80,accepted,.1);assert.equal(accepted,PHYSICS_BUDGET);}
 assert.equal(clock.maxStep,PHYSICS_BUDGET);
});

// During disasters, the solver and rendering share the same accepted interval.
test('During a disaster every consumer gets the same interval, capped at the physics budget in both modes',()=>{
 assert.equal(DISASTER_MAX_STEP,PHYSICS_BUDGET);
 for(const mode of ['realtime','smooth']){
  const clock=new SimulationPacing({mode,storage:null});
  for(const dt of [.08,.1,1/30])assert.equal(clock.step(dt,true),PHYSICS_BUDGET,`${mode}: a ${dt} s disaster frame`);
  // At or above 40 fps nothing is cut: the cap rarely bites at the 60 fps target.
  assert.equal(clock.step(1/60,true),1/60,`${mode}: a 60 fps disaster frame`);
  assert.equal(clock.step(.08,false),.08,`${mode}: outside a disaster`);
 }
});

test('Ordinary play keeps the caller interval; the playback preference survives reset',()=>{
 const saved=new Map(),storage={getItem:key=>saved.get(key),setItem:(k,v)=>saved.set(k,v)};
 const clock=new SimulationPacing({storage});assert.equal(clock.mode,'realtime');
 assert.equal(clock.step(.08,false),.08);assert.equal(clock.step(.1,false),.1);clock.setMode('realtime');
 for(let i=0;i<10;i++){assert.equal(clock.step(.1,false),.1);clock.observe(150,.1,.15);}
 assert.equal(clock.rate,.1/.15);assert.equal(new SimulationPacing({storage}).mode,'realtime');clock.reset();assert.equal(clock.mode,'realtime');
 clock.setMode('smooth');assert.equal(clock.step(.1,true),PHYSICS_BUDGET);assert.throws(()=>clock.setMode('fast'),RangeError);
});

test('Pause/invalid intervals neither advance the clock nor corrupt pacing',()=>{
 const clock=new SimulationPacing({storage:null});for(const dt of [0,-1,NaN,Infinity])assert.equal(clock.step(dt,true),0);
 clock.observe(30,0,0);clock.observe(NaN,.01,.03);assert.equal(clock.rate,1);assert.equal(clock.maxStep,PHYSICS_BUDGET);
});

test('Outside a disaster the car physics keeps its 0.1 s catch-up; during one it gets 3 steps a frame',()=>{
 // The 3-step cap was always on: a car driven at 30 fps ran 3 of the 4 steps it owed (75% speed).
 const clock=new SimulationPacing({storage:null});
 assert.equal(clock.step(1/30,false),1/30);
 assert.equal(clock.physicsSteps,12,`outside a disaster the physics may run ${clock.physicsSteps} steps a frame, want the 0.1 s catch-up (12)`);
 assert.equal(CATCH_UP_PHYSICS_STEPS*(1/120),.1);
 clock.step(1/30,true);
 assert.equal(clock.physicsSteps,3,`during a disaster the physics may run ${clock.physicsSteps} steps a frame, want 3`);
 assert.equal(DISASTER_PHYSICS_STEPS/120,DISASTER_MAX_STEP);
 clock.step(1/30,false);assert.equal(clock.physicsSteps,12,'the cap stayed on after the disaster ended');
});
