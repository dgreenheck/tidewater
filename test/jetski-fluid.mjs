import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JetskiController,SKI} from '../src/jetski/JetskiController.js';
import {Vector3} from '../src/engine/index.js';
import {DisasterField} from '../src/disasters/Field.js';

const hull=JSON.parse(readFileSync(new URL('../public/models/jetski.json',import.meta.url)));
const finite=b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.velocity.toArray(),...b.angular.toArray()].every(Number.isFinite);
function queryAt(level){return {latency:0,allocate:()=>0,setPoint(){},cpuValid:true,version:0,resultTime:0,cpu:new Float32Array(36),resultInputs:new Float32Array(36),feed(b,dt){this.version++;this.resultTime+=dt;for(let i=0;i<b.qpts.length;i++){const p=b.toWorld(b.qpts[i],new Vector3());this.cpu[i*4]=level;this.resultInputs[i*4]=p.x;this.resultInputs[i*4+1]=p.z;}}};}

test('Real jetski panel integration stays finite and follows 100–400 m/s shared current without recovery resets',()=>{
 for(const current of [100,200,300,400])for(const h of [1/120,1/360]){
  const b=new JetskiController({terrain:{heightAt:()=>-10000},hull});b.place(0,-2,0,.6);b.environment={sample:()=>({ux:current,uz:0,wx:0,wy:0,wz:0})};
  let peak=0;for(let i=0;i<Math.ceil(2/h);i++){b.step(h);assert.ok(finite(b),`current ${current}, dt ${h}, step ${i}: finite physical state before update() recovery`);peak=Math.max(peak,b.velocity.length());}
  assert.ok(b.position.x>current*.75,`actual current displacement ${b.position.x}`);assert.ok(peak<current*1.5+20,`unforced numerical speed growth ${peak} for current ${current}`);
 }
});

test('Production query/update path consumes extreme water heights at normal and long frame intervals',()=>{
 for(const dt of [1/60,.1]){
  const query=queryAt(3000),b=new JetskiController({query,terrain:{heightAt:()=>-10000},hull});b.place(39,-.18,-33,.8);b.velocity.set(51,4,-14);b.angular.set(-3.8,7.7,18);
  b.environment={sample:()=>({height:3000,ux:270,uz:-110,wx:0,wy:0,wz:0})};
  for(let i=0;i<Math.ceil(3/dt);i++){query.feed(b,dt);b.update(dt);assert.ok(finite(b),`dt ${dt}, frame ${i}: query/update must not corrupt position`);assert.ok(b.velocity.length()<600,'no explicit-drag runaway');}
  assert.ok(b.position.x>200);assert.equal(b.hasWater,true);assert.ok(b.waterH.every(h=>h===3000),'no water-height clamp or visual-only scaling');
 }
});

// Cancel ONLY gravity and the exact fully submerged panel-column hydrostatic
// resultant. The retained hydrodynamics and contacts are the production methods.
function balanceHydrostatics(b,F,T){
 const com=b.com.clone().applyQuaternion(b.quaternion).add(b.position);F.y+=b.mass*9.81;
 for(const s of b.samples){const p=b.toWorld(s.p,new Vector3()),deck=b.toWorld(new Vector3(s.p.x,SKI.deckY,s.p.z),new Vector3()),dy=Math.max(.05,Math.abs(deck.y-p.y)),force=new Vector3(0,1025*9.81*s.area*dy,0),mid=p.clone().add(deck).multiplyScalar(.5);F.sub(force);T.sub(mid.sub(com).cross(force));}
}
test('Actual submerged jetski drag dissipates total frozen-attitude 6DOF energy for arbitrary attitudes and spin',()=>{
 for(const h of [1/120,1/30,.1])for(const angle of [0,.7,1.4]){
  const b=new JetskiController({terrain:{heightAt:()=>-10000}});b.place(0,-100,0,0);b.quaternion.setFromAxisAngle(new Vector3(1,2,-1).normalize(),angle);b.velocity.set(140,-40,80);b.angular.set(7,-4,11);
  b.environment={sample:()=>({ux:0,uz:0,wx:140,wy:-40,wz:80})};b.disasterForces=(body,F,T)=>balanceHydrostatics(body,F,T);
  const q=b.quaternion.clone().invert(),energy=()=>{const v=b.velocity.clone().applyQuaternion(q),w=b.angular.clone().applyQuaternion(q);return .5*(b.mass*((1+SKI.addedMass[0])*v.x*v.x+(1+SKI.addedMass[1])*v.y*v.y+(1+SKI.addedMass[2])*v.z*v.z)+b.inertia.x*(1+SKI.addedInertia[0])*w.x*w.x+b.inertia.y*(1+SKI.addedInertia[1])*w.y*w.y+b.inertia.z*(1+SKI.addedInertia[2])*w.z*w.z);};
  const before=energy();b.step(h);assert.ok(finite(b));assert.ok(energy()<=before+1e-7,`dt ${h}, attitude ${angle}, energy ${before} → ${energy()}`);
 }
});

test('Jetski finite-state check includes every quaternion component',()=>{const b=new JetskiController({terrain:{heightAt:()=>-100}});b.quaternion.x=NaN;assert.equal(b.isFinite(),false);});

test('Evolving full257-grid3000m field drives the real jetski query/controller chain without corrupting motion',()=>{
 const field=new DisasterField(()=>-20),query=queryAt(0),b=new JetskiController({query,terrain:{heightAt:()=>-20},hull});b.place(39,-.18,-33,.8);b.environment=field;
 // A mechanism test: one fixed seed. The source sits 3.2 km out (the 70 frames
 // ended before the wall arrived), and with the current solver it first comes in from beyond the ring. The field runs until
 // the solver's wall front reaches the jetski (water over 1 m); the 70 frames then ride the wall itself.
 const e=field.start('tsunami',{x:40,z:-115,intensity:3000,warningLead:3,direction:-90,radius:180,width:55,duration:15,seed:1});
 while(!e.launched||field.waterAt(39,-33)<1)field.advance(.1);
 let maxHeight=0,maxCurrent=0;
 for(let frame=0;frame<70;frame++){
  field.advance(.1);query.feed(b,.1);
  for(let i=0;i<b.qpts.length;i++){const p=b.toWorld(b.qpts[i],new Vector3()),s=field.sample(p.x,p.y,p.z),gx=(field.waterAt(p.x+.5,p.z)-field.waterAt(p.x-.5,p.z)),gz=(field.waterAt(p.x,p.z+.5)-field.waterAt(p.x,p.z-.5)),norm=Math.hypot(gx,1,gz);query.cpu[i*4]=s.height;query.cpu[i*4+1]=-gx/norm;query.cpu[i*4+2]=-gz/norm;maxHeight=Math.max(maxHeight,s.height);maxCurrent=Math.max(maxCurrent,Math.hypot(s.ux,s.uz));}
  b.update(.1);assert.ok(finite(b),`evolving shared field frame ${frame}`);assert.ok(b.velocity.length()<Math.max(600,1.5*maxCurrent),`numerical velocity must not run away (${b.velocity.length().toFixed(0)} m/s in a ${maxCurrent.toFixed(0)} m/s current)`);
 }
 // Hundreds of metres, not 3000: the wall slumps over 3.2 km of 20 m sea (550 m at the jetski, seed 1).
 assert.ok(maxHeight>300,`the jetski rides the wall: ${maxHeight} m`);assert.ok(maxCurrent>150);assert.ok(Math.hypot(b.position.x-39,b.position.z+33)>100,'physical advection is substantial');assert.equal(field.water.stats.droppedTime,0);
 console.log(JSON.stringify({jetskiExtremeField:{maxHeight,maxCurrent,position:b.position.toArray(),velocity:b.velocity.toArray()}}));
});

test('Calm production throttle still accelerates and planes within the existing measured envelope',()=>{
 const b=new JetskiController({terrain:{heightAt:()=>-100}});b.place(0,0,0,0);b.hasWater=true;b.driven=true;b.engineOn=true;b.setInput({throttle:1});let t60=null,t100=null;
 for(let i=0;i<1200;i++){b.update(1/60);assert.ok(finite(b));if(b.speed*3.6>60&&t60===null)t60=i/60;if(b.speed*3.6>100&&t100===null)t100=i/60;}
 assert.ok(t60>3.4&&t60<4.1);assert.ok(t100>8.8&&t100<10.4);assert.ok(b.speed*3.6>105&&b.speed*3.6<112);assert.ok(b.driven,'no spurious calm-water crash');
});
