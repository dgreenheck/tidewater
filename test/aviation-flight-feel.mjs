import test from 'node:test';
import assert from 'node:assert/strict';
import {CarrierPhysics} from '../src/aviation/CarrierPhysics.js';
import {FlightPhysics} from '../src/aviation/FlightPhysics.js';
import {AIRCRAFT as A,CARRIER,STEP,GRAVITY as G,AIR_DENSITY} from '../src/aviation/Constants.js';
import {poseQ,advanceQ,attitude} from '../src/aviation/Math.js';

// Measure aircraft pitch, roll and stability under the normal flight controls.
const DEG=Math.PI/180;
const calm={sample:()=>({}),waterAt:()=>0,terrainAt:()=>-1000};
function setup(){
 const carrier=new CarrierPhysics(),flight=new FlightPhysics(carrier);
 return {carrier,flight};
}
function step(s,n=1){
 for(let i=0;i<n;i++){
  s.carrier.step(STEP,calm);
  s.flight.step(STEP,calm);
 }
}
// Clean jet, gear and flaps up, trimmed for the lift a level turn at this bank needs.
function cruise(speed,bank=0,altitude=600){
 const s=setup(),f=s.flight,density=AIR_DENSITY*Math.exp(-altitude/8500),q=0.5*density*speed*speed;
 const alpha=Math.min(0.25,Math.max(-0.05,(A.mass*G/Math.cos(bank)/(q*A.area)-A.cl0)/A.clAlpha));
 f.position=[0,altitude,0];
 f.velocity=[0,0,speed];
 f.quaternion=advanceQ(poseQ(0,alpha),[0,0,bank],1);
 f.omega=[0,0,0];
 Object.assign(f.controls,{throttle:0.75,pitch:0,roll:0,yaw:0,flaps:0,gear:false,hook:false,brake:false});
 f.engine=0.75;
 f.gear=0;
 f.flaps=0;
 f.phase='airborne';
 f.everAirborne=true;
 f.groundedLast=false;
 f.catapult=null;
 return s;
}

test('one-key launch: no further input leaves the bow climbing and hands over at 150 m with the gear up',()=>{
 const s=setup(),f=s.flight;
 step(s,120);
 const pressed=f.time;
 assert.equal(f.autoLaunch(),null,'the ready jet must accept the launch');
 let released=null,lowest=Infinity,climb3=null,handover=null,wasAuto=false;
 for(let k=0;k<120*30;k++){
  const onCatapult=!!f.catapult;
  step(s);
  if(onCatapult&&!f.catapult&&released===null)released=f.time;
  if(released!==null&&f.time-released<=8)lowest=Math.min(lowest,f.position[1]-CARRIER.deckY);
  if(released!==null&&climb3===null&&f.time-released>=3)climb3=f.velocity[1];
  if(f.auto?.attitude)wasAuto=true;
  else if(wasAuto&&handover===null)handover={time:f.time,altitude:f.position[1],gear:f.gear,speed:f.metrics.speed,phase:f.phase,reason:f.reason};
 }
 assert.ok(released!==null&&released-pressed<=4.5,`catapult released ${released===null?'never':(released-pressed).toFixed(2)+' s'} after W`);
 assert.ok(lowest>=1.5,`lowest point in the 8 s after release: ${lowest.toFixed(2)} m above deck height`);
 assert.ok(climb3>=15,`vertical speed 3 s after release: ${climb3?.toFixed(1)} m/s`);
 assert.ok(handover,'the autopilot never handed over');
 assert.ok(handover.altitude>=140&&handover.gear<0.05,`handover at ${handover.altitude.toFixed(0)} m with gear ${handover.gear.toFixed(2)}`);
 assert.ok(handover.time-pressed<=16,`handover ${(handover.time-pressed).toFixed(1)} s after W`);
 assert.equal(handover.phase,'airborne');
 assert.equal(handover.reason,'You have control');
});

test('one-key launch: any stick input after leaving the deck hands control straight back',()=>{
 const s=setup(),f=s.flight;
 step(s,120);
 f.autoLaunch();
 while(f.phase!=='airborne'&&f.time<20)step(s);
 assert.ok(f.auto?.attitude,'the autopilot flies the climb-out');
 f.controls.roll=-1;
 step(s,2);
 assert.ok(!f.auto?.attitude,'stick input must end the automatic climb');
 assert.equal(f.reason,'You have control');
});

test('hands-off 45 degree bank: a coordinated level turn at g tan(bank) / V with sideslip under 1 degree',()=>{
 const s=cruise(150,45*DEG),f=s.flight;
 step(s,240);
 const h0=f.position[1];
 let maxBeta=0,turned=0,expected=0,previous=Math.atan2(f.velocity[0],f.velocity[2]);
 for(let k=0;k<720;k++){
  step(s);
  maxBeta=Math.max(maxBeta,Math.abs(f.metrics.beta));
  const heading=Math.atan2(f.velocity[0],f.velocity[2]),d=heading-previous;
  turned+=Math.atan2(Math.sin(d),Math.cos(d));
  previous=heading;
  expected+=G*Math.tan(Math.abs(attitude(f.quaternion).bank))/Math.hypot(...f.velocity)*STEP;
 }
 const ratio=Math.abs(turned)/expected,bank=Math.abs(attitude(f.quaternion).bank)/DEG;
 assert.ok(maxBeta<1*DEG,`sideslip reached ${(maxBeta/DEG).toFixed(2)} deg`);
 assert.ok(bank>35&&bank<55,`bank drifted to ${bank.toFixed(1)} deg with the stick released`);
 assert.ok(Math.abs(ratio-1)<0.15,`turned ${(Math.abs(turned)/DEG).toFixed(1)} deg in 6 s against ${(expected/DEG).toFixed(1)} deg for a level turn (ratio ${ratio.toFixed(2)})`);
 assert.ok(Math.abs(f.position[1]-h0)<60,`height changed ${(f.position[1]-h0).toFixed(1)} m in a hands-off 6 s turn`);
});

test('full back stick at 70, 150 and 220 m/s never stalls and never passes 7.5 g',()=>{
 for(const speed of [70,150,220]){
  const s=cruise(speed),f=s.flight;
  f.controls.throttle=f.engine=1;
  f.controls.pitch=1;
  let maxG=0,maxAlpha=0,stalled=false;
  for(let k=0;k<600;k++){
   step(s);
   maxG=Math.max(maxG,f.metrics.loadFactor);
   maxAlpha=Math.max(maxAlpha,f.metrics.alpha);
   stalled||=f.metrics.stall;
  }
  assert.ok(!stalled&&maxG<=7.5,`full back stick at ${speed} m/s: ${maxG.toFixed(2)} g, ${(maxAlpha/DEG).toFixed(1)} deg AoA, stall ${stalled}`);
  if(speed===220)assert.ok(maxG>=6.5,`the limiter must still let the jet pull hard: ${maxG.toFixed(2)} g at 220 m/s`);
 }
});

test('full roll stick at 150 m/s rolls at least 150 degrees per second',()=>{
 const s=cruise(150),f=s.flight;
 f.controls.roll=-1;
 let peak=0;
 for(let k=0;k<180;k++){
  step(s);
  peak=Math.max(peak,Math.abs(f.omega[2]));
 }
 assert.ok(peak>=150*DEG,`peak roll rate ${(peak/DEG).toFixed(0)} deg/s`);
});

// S while the engine spools cancels the one-key launch; once the shot fires it is committed.
test('S during the spool cancels the launch and leaves the jet parked on the catapult',()=>{
 const s=setup(),f=s.flight;
 assert.equal(f.autoLaunch(),null);
 step(s,10);
 assert.equal(f.auto?.stage,'spool','still spooling after 10 steps');
 assert.equal(f.abortLaunch(),true,'S while spooling must cancel');
 step(s,240);
 assert.equal(f.phase,'ready',`phase ${f.phase} after a cancelled launch`);
 assert.equal(f.controls.throttle,0);
 assert.equal(f.controls.brake,true);
 assert.equal(f.catapult,null,'no catapult stroke after a cancel');
 assert.equal(f.autoLaunch(),null);
 step(s,600);
 assert.notEqual(f.abortLaunch(),true,'once the shot fires S no longer cancels it');
});
