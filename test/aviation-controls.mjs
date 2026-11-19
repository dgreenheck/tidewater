import test from 'node:test';
import assert from 'node:assert/strict';
import {Aviation,FIGHTER_KEYS} from '../src/aviation/Aviation.js';
import {Vector3} from '../src/engine/math/index.js';
import {Glider} from '../src/glider/Glider.js';
import {equilibrium} from '../src/glider/GliderPhysics.js';
import {STEP,CARRIER} from '../src/aviation/Constants.js';
import {poseQ,rotate,cross,dot,sub,advanceQ,length} from '../src/aviation/Math.js';
const air={sample:()=>({}),terrainAt:()=>-1000,waterAt:()=>-1000};
// The camera's right direction is forward × world-up. Project actual integrated
// flight motion onto it; checking only a control/roll sign concealed this defect.
// 2026-10-05: A and D are the rudder now; E enters and leaves like every other vehicle.
test('fighter pilot Right/D turns toward chase-camera right, Left/A toward left',()=>{
 for(const [key,side]of [['ArrowRight',1],['KeyD',1],['ArrowLeft',-1],['KeyA',-1]])for(const yaw of [0,1.2]){
  // The roll is 180 deg/s now: a quarter-second tap banks about 45 deg and the stick
  // law holds that bank. Held for the whole 1.5 s it would roll 270 deg. A and D are
  // the rudder and are held throughout.
  let tick=0;
  const a=new Aviation({input:{down:k=>k===key&&(key.startsWith('Key')||tick<30),hit:()=>false},terrainData:{heightAt:()=>-1000}}),f=a.flight;a.pilot=true;
  f.position=[0,1000,0];f.velocity=rotate(poseQ(yaw),[0,0,110]);f.quaternion=poseQ(yaw,.10);f.omega=[0,0,0];f.phase='airborne';f.controls.gear=false;f.gear=0;f.controls.flaps=0;f.flaps=0;f.engine=f.controls.throttle=.6;
  const right=cross(rotate(f.quaternion,[0,0,1]),[0,1,0]);
  for(let k=0;k<180;k++){a.controls(STEP);f.step(STEP,air);tick++;}
  assert.ok(side*dot(sub(f.position,[0,1000,0]),right)>1,`${key} moved ${dot(sub(f.position,[0,1000,0]),right)} m toward camera right`);
  assert.ok(side*dot(rotate(f.quaternion,[0,0,1]),right)>.01,`${key} must point toward its commanded side`);
 }
});
test('glider weight-shift keys turn toward the corresponding chase-camera side',()=>{
 for(const [key,side]of [['ArrowRight',1],['ArrowLeft',-1]]){
  const a=new Glider({input:{down:k=>k===key,hit:()=>false},terrainData:{heightAt:()=>-1000}}),f=a.flight,e=equilibrium();a.active=a.pilot=true;
  f.position=[0,500,0];f.phase='airborne';f.velocity=[0,e.speed*Math.sin(e.gamma),e.speed*Math.cos(e.gamma)];f.quaternion=poseQ(0,e.pitch);
  const right=cross(rotate(f.quaternion,[0,0,1]),[0,1,0]);
  for(let k=0;k<240;k++){a.controls();f.step(STEP,air);}
  assert.ok(side*dot(sub(f.position,[0,500,0]),right)>1);assert.ok(side*dot(rotate(f.quaternion,[0,0,1]),right)>.1);
 }
});

// In flight the throttle, pitch, roll and yaw controls remain independent.
function pilotFixture(held,hits=new Set()){
 const camera={position:new Vector3(),up:new Vector3(0,1,0),lookAt(v){this.target=v.clone();}};
 const a=new Aviation({input:{down:k=>held.has(k),hit:k=>hits.has(k),consumeLook:()=>({x:0,y:0})},terrainData:{heightAt:()=>-1000},camera});
 a.active=a.pilot=true;
 a.jetModel={};
 return a;
}
function airborne(f,speed=150){
 f.position=[0,1000,0];
 f.velocity=[0,0,speed];
 f.quaternion=poseQ(0,.04);
 f.omega=[0,0,0];
 f.phase='airborne';
 f.everAirborne=true;
 f.groundedLast=false;
 f.controls.gear=false;
 f.gear=0;
}
test('airborne fighter: W and S are throttle, A and D are rudder, E leaves',()=>{
 const held=new Set(['KeyW']),hits=new Set(),a=pilotFixture(held,hits),f=a.flight;
 airborne(f);
 f.controls.throttle=f.engine=.4;
 for(let k=0;k<120;k++)a.controls(STEP);
 assert.ok(f.controls.throttle>=.85&&f.controls.pitch===0,`W for 1 s: throttle ${f.controls.throttle.toFixed(2)}, pitch command ${f.controls.pitch}`);
 held.clear();
 held.add('KeyS');
 for(let k=0;k<60;k++)a.controls(STEP);
 assert.ok(f.controls.throttle<=.7&&f.controls.pitch===0,`S for 0.5 s: throttle ${f.controls.throttle.toFixed(2)}, pitch command ${f.controls.pitch}`);
 held.clear();
 held.add('KeyD');
 a.controls(STEP);
 assert.ok(f.controls.yaw<0&&f.controls.roll===0,`D is right rudder: yaw ${f.controls.yaw}, roll ${f.controls.roll}`);
 held.clear();
 let left=false;
 a.leave=()=>{left=true;};
 f.controls.yaw=0;
 hits.add('KeyE');
 a.controls(STEP);
 assert.ok(left,'E must leave the jet');
 assert.equal(f.controls.yaw,0,'E is no longer the rudder');
});
test('on the catapult one press of W launches the jet with no other input',()=>{
 const held=new Set(['KeyW']),hits=new Set(['KeyW']),a=pilotFixture(held,hits),f=a.flight;
 for(let k=0;k<120*7;k++){
  if(k===12){
   held.clear();
   hits.clear();
  }
  a.controls(STEP);
  a.carrier.step(STEP,a.carrierEnv);
  f.step(STEP,a.flightEnv);
 }
 const local=a.carrier.local(f.position);
 assert.ok(f.launchCount===1&&f.metrics.speed>=70,`7 s after one W press: ${f.launchCount} launches, ${f.metrics.speed.toFixed(1)} m/s`);
 assert.ok(local[1]>CARRIER.deckY+5,`7 s after one W press the jet is ${(local[1]-CARRIER.deckY).toFixed(1)} m above the deck`);
});
test('chase camera rides about 20 m behind the velocity vector and never flips through the vertical',()=>{
 const a=pilotFixture(new Set()),f=a.flight,camera=a.app.camera,radius=500,speed=150;
 airborne(f,speed);
 let previousUp=null,worstUp=1,worstBehind=0,worstOff=0;
 for(let k=0;k<=240;k++){
  const theta=Math.PI*k/240;
  f.position=[0,1000+radius*(1-Math.cos(theta)),radius*Math.sin(theta)];
  f.velocity=[0,speed*Math.sin(theta),speed*Math.cos(theta)];
  f.quaternion=advanceQ(poseQ(0,0),[-theta,0,0],1);
  f.metrics.speed=speed;
  a.updateCamera(1/60);
  const up=camera.up.toArray(),offset=sub(camera.position.toArray(),f.position),along=dot(offset,[0,Math.sin(theta),Math.cos(theta)]);
  if(previousUp)worstUp=Math.min(worstUp,dot(up,previousUp));
  previousUp=up;
  if(k>30){
   worstBehind=Math.max(worstBehind,Math.abs(-along-20));
   worstOff=Math.max(worstOff,length(offset));
  }
 }
 assert.ok(worstUp>.95,`camera up turned by ${(Math.acos(Math.min(1,worstUp))*180/Math.PI).toFixed(1)} deg in one frame`);
 assert.ok(worstBehind<4,`camera sat up to ${worstBehind.toFixed(1)} m away from 20 m behind the flight path`);
 assert.ok(worstOff<26,`camera drifted ${worstOff.toFixed(1)} m from the jet`);
});
// One key per flight action, none taken from the island-wide keys (F free camera,
// T time of day, M map, L lights, I inventory, Backquote car dock). R stays: in the
// jet it resets the aircraft, the same "recover" meaning it has on foot.
test('fighter key map: one key per action and no clash with island-wide keys',()=>{
 const keys=Object.values(FIGHTER_KEYS).flat();
 assert.equal(new Set(keys).size,keys.length,`a key is bound twice: ${keys.join(' ')}`);
 for(const global of ['KeyF','KeyT','KeyM','KeyL','KeyI','Backquote','KeyX','KeyQ'])assert.ok(!keys.includes(global),`${global} is an island-wide key`);
 for(const [action,key]of [['leave','KeyE'],['throttleUp','KeyW'],['throttleDown','KeyS'],['yawLeft','KeyA'],['yawRight','KeyD'],['gear','KeyG'],['hook','KeyH'],['flaps','KeyV'],['brake','KeyB'],['camera','KeyC'],['reset','KeyR']])assert.ok([FIGHTER_KEYS[action]].flat().includes(key),`${action} must be ${key}`);
});
