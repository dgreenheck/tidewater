import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightPhysics,aerodynamicLoads,aerodynamicCoefficients,coefficientLoads,absorberWork} from '../src/aviation/FlightPhysics.js';
import {CarrierPhysics,hydrostaticDisplacement,insideDeck} from '../src/aviation/CarrierPhysics.js';
import {AIRCRAFT as A,CARRIER,GRAVITY,AIR_DENSITY,SEA_WATER_DENSITY,STEP} from '../src/aviation/Constants.js';
import {poseQ,rotate,sub,length,dot,finiteState,attitude} from '../src/aviation/Math.js';
const near=(actual,expected,tol=1e-8)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} differs from ${expected} by >${tol}`);
const calm={waterAt:()=>0,sample:()=>({wx:0,wy:0,wz:0,ux:0,uz:0})};
const setup=()=>{const carrier=new CarrierPhysics({position:[0,0,0],yaw:0});return {carrier,flight:new FlightPhysics(carrier)};};
function run(f,seconds,env=calm,controls=()=>{}){for(let i=0;i<Math.round(seconds/STEP);i++){controls(f,i*STEP);f.step(STEP,env);}}

test('NASA law benchmark: q, lift and drag use independent synthetic numbers and SI units',()=>{
 // Independent expectation supplied by the physics review: 27m² synthetic wing,
 // CL1.2, CD0.03, AR7, e0.8, speed70m/s. Same load kernel as production flight.
 const cd=.03+1.2**2/(Math.PI*.8*7),loads=coefficientLoads(70,{area:27,cl:1.2,cd});
 near(loads.q,3001.25);near(loads.lift,97240.5);near(loads.drag,9063.7152,1e-4);
 const half=coefficientLoads(35,{area:27,cl:1.2,cd});near(half.lift,loads.lift/4);
});

test('production air-relative forces oppose flow and lift is perpendicular to it; post-stall loses lift',()=>{
 const orientation=poseQ(.32,.12,.4),v=rotate(orientation,[2,-8,70]),f=aerodynamicLoads(v,orientation,0,0);
 assert.ok(f.drag>0&&f.lift>0);assert.ok(dot(f.force,v)<0,'net aerodynamic force must dissipate energy');
 const quarter=aerodynamicLoads(v.map(x=>x/2),orientation,0,0);near(quarter.lift,f.lift/4,1e-7);
 const attached=aerodynamicCoefficients(.29),stalled=aerodynamicCoefficients(.7);
 assert.ok(stalled.stall);assert.ok(stalled.cl<attached.cl);assert.ok(stalled.cd>attached.cd);
 const still=aerodynamicLoads([0,0,0],poseQ());near(length(still.force),0);
});

test('carrier Archimedes equilibrium, finite-volume draft increment and flat-water rest',()=>{
 near(hydrostaticDisplacement(0),82926.82926829268,1e-7);
 near(hydrostaticDisplacement(1)-hydrostaticDisplacement(0),8500,1e-8);
 const c=new CarrierPhysics({position:[0,0,0],yaw:0});for(let i=0;i<7200;i++)c.step(STEP,calm);
 near(c.metrics.buoyancy,833850000,.01);near(c.position[1],0,1e-10);near(length(c.velocity),0,1e-10);
 assert.ok(insideDeck(0,0));assert.ok(!insideDeck(60,0));
});

test('carrier water plane, current and wind enter forces and moments; earthquake does not push an unsupported ship',()=>{
 const c=new CarrierPhysics({position:[0,0,0],yaw:0});const quake={...calm,sample:()=>({ax:8,ay:8,az:8})};for(let i=0;i<600;i++)c.step(STEP,quake);near(length(c.velocity),0,1e-9);
 const surge={waterAt:(x,z)=>2+.004*x+.001*z,sample:()=>({wx:35,wy:0,wz:0,ux:3,uz:0})};for(let i=0;i<3600;i++)c.step(STEP,surge);
 assert.ok(c.position[1]>1.7&&c.position[1]<2.5);assert.ok(c.position[0]>1);assert.ok(Math.abs(c.metrics.roll)>.002);assert.ok(c.metrics.currentForce>1000);assert.ok(finiteState(c));
});

test('three spring contacts support parked mass without velocity resets and follow a moving deck',()=>{
 const {flight:f,carrier:c}=setup();run(f,8);assert.equal(f.metrics.contacts,3);// 2026-10-05: the jet rests 6 deg nose-up on its launch nose strut, mains 0.09 m into their springs.
 assert.ok(Math.abs(f.position[1]-20.08)<.08,`rest height ${f.position[1].toFixed(3)} m`);assert.ok(Math.abs(attitude(f.quaternion).pitch-6*Math.PI/180)<.01,`rest pitch ${(attitude(f.quaternion).pitch*180/Math.PI).toFixed(2)} deg`);assert.ok(length(f.velocity)<.02);
 c.velocity=[2,0,0];f.velocity=[2,0,0];const start=f.position[0];for(let i=0;i<600;i++){c.position[0]+=2*STEP;f.step(STEP,calm);}
 assert.equal(f.metrics.contacts,3);near(f.position[0]-start,10,.06);assert.ok(length(sub(f.velocity,c.velocity))<.1);
});

test('bounded catapult stroke, actual takeoff and bank turn from pilot force/torque controls',()=>{
 const {flight:f}=setup();run(f,1);assert.match(f.requestLaunch(),/throttle/);f.controls.throttle=1;assert.match(f.requestLaunch(),/brake/);f.controls.brake=false;assert.equal(f.requestLaunch(),null);
 let maxForce=0;run(f,12,calm,s=>{s.controls.pitch=s.metrics.speed>55&&s.metrics.pitch<.16?.25:0;maxForce=Math.max(maxForce,s.metrics.catapultForce);});
 assert.equal(f.phase,'airborne');assert.ok(f.metrics.catapultRun>=90);assert.ok(f.metrics.catapultRun<105);assert.ok(maxForce<=A.catapultForce);assert.ok(f.position[1]>70);assert.ok(f.metrics.lift>50000);
 f.controls.gear=false;f.controls.roll=.4;run(f,.8);f.controls.roll=0;const before=f.metrics.heading;run(f,4);assert.ok(f.metrics.bank>.15);assert.ok(f.metrics.heading-before>.03);
});

test('the approach flies 620m then arrests on a swept hook crossing and absorbs bounded cable work',()=>{
 const {flight:f}=setup();f.startApproach(calm);f.controls.hook=true;let maxForce=0;run(f,16,calm,s=>{maxForce=Math.max(maxForce,s.metrics.cableForce);});
 assert.equal(f.phase,'arrested',f.reason);assert.ok(f.metrics.landingDistance>650);assert.ok(f.metrics.cableEnergy>20e6&&f.metrics.cableEnergy<45e6);assert.ok(maxForce>300000&&maxForce<=A.cableMaxForce);assert.ok(f.metrics.speed<1);assert.equal(f.metrics.contacts,3);assert.ok(f.metrics.deckSink<A.maxLandingSink);
});

test('wind-aware start maintains an air-relative approach in a steady seven-metre crosswind',()=>{
 const {flight:f}=setup(),env={waterAt:()=>0,sample:()=>({wx:7,wy:0,wz:-2})};f.startApproach(env);f.controls.hook=true;run(f,18,env);assert.equal(f.phase,'arrested',f.reason);assert.ok(f.metrics.cableEnergy>1e6);
});

test('hook-up bolter, gear-up collision and steep descent never report a successful arrested landing',()=>{
 for(const mode of ['hook-up','gear-up','hard']){const {flight:f}=setup();f.startApproach(calm);if(mode==='gear-up')f.controls.gear=false;if(mode==='hard'){f.velocity[1]=-20;f.controls.hook=true;}run(f,22);assert.notEqual(f.phase,'arrested',mode);if(mode!=='hard')near(f.metrics.cableEnergy,0);assert.ok(['ditched','crashed','bolter','touchdown'].includes(f.phase),`${mode}: ${f.phase}`);assert.ok(finiteState(f));}
});

test('sea impact cuts thrust, dissipates momentum and floods; it cannot continue powered underwater flight',()=>{
 const {flight:f}=setup();f.position=[300,3,0];f.velocity=[10,-7,65];f.phase='airborne';f.everAirborne=true;f.controls.throttle=1;run(f,45);
 assert.equal(f.phase,'ditched');assert.equal(f.controls.throttle,0);assert.equal(f.engine,0);assert.ok(f.position[1]<0);assert.ok(f.metrics.speed<8);assert.ok(f.metrics.waterImpactEnergy>100000);assert.ok(finiteState(f));
});

test('fixed-step partition invariance, reset/repeat, and extreme gusts remain finite',()=>{
 const a=setup().flight,b=setup().flight;a.startApproach(calm);b.startApproach(calm);a.controls.hook=b.controls.hook=true;
 for(let i=0;i<1800;i++)a.update(1/120,calm);for(let i=0;i<450;i++)b.update(1/30,calm);near(length(sub(a.position,b.position)),0,1e-9);near(a.metrics.cableEnergy,b.metrics.cableEnergy,1e-6);
 const initial=[...a.position];a.reset();a.startApproach(calm);a.controls.hook=true;for(let i=0;i<1800;i++)a.update(1/120,calm);near(length(sub(initial,a.position)),0,1e-9);
 a.startApproach(calm);const gust={waterAt:(x,z)=>12*Math.sin(x/120),sample:(x,y,z)=>({wx:100*Math.sin(z/50),wy:35,wz:80,ux:12,uz:6})};run(a,60,gust,s=>{s.controls.roll=Math.sin(s.time);s.controls.pitch=Math.cos(s.time)*.7;});assert.ok(finiteState(a));assert.ok(length(a.velocity)<1000);
});


test('water beneath the carrier footprint never permits an underwater powered aircraft',()=>{
 const {flight:f,carrier:c}=setup();f.position=c.world([0,-20,0]);f.velocity=[0,0,30];f.phase='airborne';f.everAirborne=true;f.controls.gear=false;f.gear=0;f.controls.throttle=f.engine=1;
 f.step(STEP,calm);assert.equal(f.phase,'ditched');assert.equal(f.controls.throttle,0);assert.equal(f.engine,0);run(f,.1);near(f.metrics.thrust,0);
});

test('arrestor midpoint work matches the independent 19.6MJ stop benchmark; retreating payout is slack',()=>{
 // m8000kg, V70m/s, s100m: E19.6MJ, F196kN, a24.5m/s².
 near(absorberWork(196000,70,0,70/24.5),19600000,1e-6);
 const {flight:f,carrier:c}=setup();f.position=c.fromRunway(0,70,1.92);f.velocity=[0,0,-12];f.phase='arresting';f.cable={wire:30,payout:40,energy:0,initialSpeed:68};f.controls.throttle=0;f.controls.hook=true;f.hook=1;
 f.step(STEP,calm);near(f.metrics.cableForce,0);near(f.metrics.cableEnergy,0);
});

test('real Aviation adapter co-steps moving deck and aircraft independently of render cadence',async()=>{
 const {Aviation}=await import('../src/aviation/Aviation.js');
 function simulate(dt){const a=new Aviation({terrainData:{heightAt:()=>-1000}});a.carrier=new CarrierPhysics({position:[0,0,0],yaw:0});a.flight=new FlightPhysics(a.carrier);a.carrierEnv=a.flightEnv={waterAt:(x,z)=>2+.004*x+.001*z,sample:()=>({wx:35,ux:3}),terrainAt:()=>-1000};a.jetModel={};a.controls=a.syncModels=a.queueQueries=()=>{};for(let i=0;i<Math.round(10/dt);i++)a.update(dt);return a;}
 const a=simulate(1/120);for(const dt of [1/30,1/10]){const b=simulate(dt);near(length(sub(a.flight.position,b.flight.position)),0,1e-9);near(length(sub(a.flight.velocity,b.flight.velocity)),0,1e-9);near(length(sub(a.carrier.position,b.carrier.position)),0,1e-9);}
});

test('real Aviation disaster boundary restores the captured flying state and original carrier pose',async()=>{
 const {Aviation}=await import('../src/aviation/Aviation.js'),{Vector3}=await import('../src/engine/math/index.js'),a=new Aviation({terrainData:{heightAt:()=>-1000},player:{mode:'walk',position:new Vector3(),velocity:new Vector3()},freeCam:true});a.syncModels=()=>{};a.flight.startApproach(calm);a.flight.controls.throttle=.37;a.active=a.pilot=true;
 const p=[...a.flight.position],v=[...a.flight.velocity],ship=[...a.carrier.position];a.captureDisasterState();a.flight.position=[9,-12,100];a.flight.velocity=[7,6,-2];a.flight.controls.throttle=0;a.carrier.position=[30,45,80];a.active=false;a.pilot=false;a.resetDisasterEffects();
 assert.deepEqual(a.flight.position,p);assert.deepEqual(a.flight.velocity,v);assert.deepEqual(a.carrier.position,ship);near(a.flight.controls.throttle,.37);assert.ok(a.active&&a.pilot);assert.equal(a.disasterSnapshot,null);assert.equal(a.app.player.mode,'aviation');assert.equal(a.app.freeCam,false);near(a.app.player.position.distanceTo(new Vector3(...p)),0);
});

test('production cable force and displayed work close the same midpoint energy balance',()=>{
 const {flight:a,carrier:c}=setup();a.position=c.fromRunway(0,80,50);a.quaternion=poseQ(CARRIER.runwayHeading);a.velocity=rotate(a.quaternion,[0,0,68]);a.phase='arresting';a.gear=0;a.controls.gear=false;a.hook=1;a.controls.hook=true;a.controls.brake=false;a.controls.throttle=a.engine=0;a.cable={wire:30,payout:0,energy:0,initialSpeed:68};
 const b=new FlightPhysics(c);Object.assign(b,structuredClone(Object.fromEntries(Object.entries(a).filter(([key])=>key!=='carrier'))));b.phase='airborne';b.cable=null;
 const before=[...a.velocity];a.step(STEP,calm);b.step(STEP,calm);
 // Subtract an independently integrated identical no-cable aircraft to isolate
 // the actual applied cable impulse. No helper or stored cable force is used.
 const force=sub(a.velocity,b.velocity).map(v=>v*A.mass/STEP),midpoint=before.map((v,i)=>(v+a.velocity[i])/2),work=-dot(force,midpoint)*STEP;
 assert.ok(work>270000&&work<285000);near(a.metrics.cableEnergy,work,1e-5);
});
