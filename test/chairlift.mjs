import test from 'node:test';import assert from 'node:assert/strict';
import {TerrainData} from '../src/world/TerrainData.js';import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {prepareChairliftSite,LIFT} from '../src/chairlift/Route.js';import {LiftTransport} from '../src/chairlift/Transport.js';
const terrain=new TerrainData(),roads=new CoastalRoute(terrain),site=prepareChairliftSite(terrain,roads);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function horizontal(){const length=200,base={name:'Base',distance:0},summit={name:'Summit',distance:100};return {length,base,summit,sample:d=>({x:d,y:10,z:0,tx:1,ty:0,tz:0})};}

test('Chairlift survey keeps both strands clear of actual terrain, roads and the existing launch run',()=>{
 assert.ok(site.minimumClearance>=5);assert.ok(site.length>1100&&site.length<1200);assert.equal(site.summit.floor,306.6);assert.ok(site.base.floor<5);
 for(let i=1;i<site.supports.length;i++)assert.ok(site.supports[i].s-site.supports[i-1].s>=11.99,'distinct support foundations');
 for(const p of site.supports){const road=roads.closest(p.x,p.z,r=>r.path.kind==='asphalt');assert.ok(!road||road.distance>8,'tower feet must not occupy a road');}
 const a=site.sample(0),b=site.sample(site.length-1e-5),c=site.sample(1e-5);assert.ok(distance(a,b)<2e-5&&distance(a,c)<2e-5);assert.ok(Math.hypot(a.tx-b.tx,a.ty-b.ty,a.tz-b.tz)<.001,'closed loop has continuous tangent');
 assert.ok(Math.abs(site.summit.x+34)>10,'upper terminal remains outside glider centreline');
});

test('Transport follows the measured cable continuously and docks at the other real terminal without a position jump',()=>{
 const t=new LiftTransport(site,{chairs:4});t.setSpeed(5);assert.ok(t.requestDock(site.summit,0));let old={...t.chairs[0].hook},prior=0;
 for(let i=0;i<1800&&t.running;i++){t.advance(.1);assert.ok(distance(old,t.chairs[0].hook)<=.501);assert.ok(Math.abs(t.speed-prior)<=LIFT.brake*.1+1e-8);old={...t.chairs[0].hook};prior=t.speed;}
 assert.equal(t.running,false);assert.equal(t.speed,0);assert.ok(distance(t.chairs[0].hook,site.sample(site.summit.distance))<.001);assert.ok(t.time>100&&t.time<140);const stopped=t.phase;for(let i=0;i<120&&!t.docked(t.chairs[0],site.summit);i++)t.advance(.1);assert.equal(t.phase,stopped,'waiting for the swinging seat must not move the stopped cable');assert.ok(t.docked(t.chairs[0],site.summit),'chair must settle to a boardable point speed after braking');
});

test('Service interruption brakes without detaching the seat; pause and snapshot restore preserve the whole physical state',()=>{
 const t=new LiftTransport(site);t.start();for(let i=0;i<100;i++)t.advance(.1);const snapshot=t.snapshot();t.advance(10,null,{paused:true});assert.deepEqual(t.snapshot(),snapshot);
 const distanceBefore=t.motorDistance;t.stop('Emergency stop');for(let i=0;i<100;i++)t.advance(.1);assert.equal(t.speed,0);assert.ok(t.motorDistance-distanceBefore<6.1);for(const c of t.chairs)assert.ok(Math.abs(distance(c.position,c.hook)-LIFT.hanger)<1e-9);
 t.restore(snapshot);assert.deepEqual(t.snapshot(),snapshot);
});

test('Suspended seat has the expected small-angle gravity restoring period and dissipates energy in still air',()=>{
 const t=new LiftTransport(horizontal(),{chairs:1}),c=t.chairs[0],theta=.1;c.n={x:Math.sin(theta),y:-Math.cos(theta),z:0};t.sync();const energy=()=>.5*c.mass*LIFT.hanger**2*(c.omega.x**2+c.omega.y**2+c.omega.z**2)+c.mass*9.81*LIFT.hanger*(1+c.n.y),initial=energy();let crossing=null;
 for(let i=0;i<1200;i++){const before=c.n.x;t.advance(1/120);if(crossing===null&&before>0&&c.n.x<=0)crossing=t.time;assert.ok(energy()<=initial*1.01);}
 const quarter=Math.PI/2*Math.sqrt(LIFT.hanger/9.81);assert.ok(crossing>quarter*.9&&crossing<quarter*1.25);assert.ok(energy()<initial*.02);
});

test('Shared wind loads swing chairs with mass-dependent response and exact accepted substep timing',()=>{
 const air={sample:()=>({wx:12,wy:0,wz:0})},a=new LiftTransport(horizontal(),{chairs:1}),b=new LiftTransport(horizontal(),{chairs:1});b.chairs[0].occupied=true;
 // Use the same projected area by comparing a declared heavier empty chair.
 b.chairs[0].occupied=false;b.chairs[0].mass=160;for(let i=0;i<12;i++)a.advance(1/120,air);b.advance(.1,air);assert.ok(a.chairs[0].n.x>b.chairs[0].n.x&&b.chairs[0].n.x>0);assert.ok(a.chairs[0].windForce>0);
 const c=new LiftTransport(horizontal(),{chairs:1});c.advance(.1,air);assert.deepEqual(c.chairs[0].n,a.chairs[0].n);assert.ok(Math.abs(c.time-.1)<1e-12);c.advance(.3,air);assert.ok(Math.abs(c.elapsedDiscarded-.2)<1e-12);
});

test('The suspended rider envelope retains surveyed terrain clearance under unrestricted pendulum directions',()=>{let minimum=Infinity;for(let s=12;s<=site.span-12;s+=2){const h=site.height(s).y;for(const side of [-1,1])for(const theta of [.25,.5,.75,1,1.25,1.5])for(let k=0;k<16;k++){const a=k/16*Math.PI*2,x=site.base.x+site.forward.x*s+site.right.x*side*LIFT.laneRadius+Math.sin(theta)*Math.cos(a)*LIFT.feetDrop,z=site.base.z+site.forward.z*s+site.right.z*side*LIFT.laneRadius+Math.sin(theta)*Math.sin(a)*LIFT.feetDrop,y=h-Math.cos(theta)*LIFT.feetDrop;minimum=Math.min(minimum,y-terrain.heightAt(x,z));}}assert.ok(minimum>=LIFT.clearance,`full swing envelope clearance ${minimum} m`);});

test('Prescribed drive acceleration excites the physical hanger with the expected inertial sign and magnitude',()=>{const t=new LiftTransport(horizontal(),{chairs:1}),h=1/120;t.start();t.advance(h);const expected=-LIFT.acceleration*.5/LIFT.hanger*h*Math.exp(-.6*h);assert.ok(Math.abs(t.chairs[0].omega.z-expected)<2e-7,'first pivot displacement uses midpoint drive velocity');assert.ok(t.chairs[0].n.x<0,'seat lags an accelerating forward support');});

test('Uniform support-and-air translation preserves relative pendulum response and restored continuation',()=>{function create(U){let t;const s=horizontal();s.sample=d=>({x:d+U*(t?.time??0),y:10,z:0,tx:1,ty:0,tz:0});t=new LiftTransport(s,{chairs:1});t.chairs[0].pivotVelocity.x=U;t.chairs[0].velocity.x=U;t.chairs[0].n={x:.12,y:-Math.sqrt(1-.12**2),z:0};t.sync();return t;}const a=create(0),b=create(8);for(let i=0;i<240;i++){a.advance(1/120,{sample:()=>({wx:3,wy:0,wz:0})});b.advance(1/120,{sample:()=>({wx:11,wy:0,wz:0})});}assert.ok(Math.hypot(a.chairs[0].n.x-b.chairs[0].n.x,a.chairs[0].n.y-b.chairs[0].n.y)<1e-9);assert.ok(Math.abs(a.chairs[0].omega.z-b.chairs[0].omega.z)<1e-9);const snap=a.snapshot(),c=create(0);c.restore(snap);for(let i=0;i<12;i++){a.advance(1/120);c.advance(1/120);}assert.deepEqual(c.snapshot(),a.snapshot());});

import {prepareGliderSite} from '../src/glider/Site.js';
test('The prescribed rider path clears the raised summit stair floors and guards, not merely their underlying hillside',()=>{const stairs=prepareGliderSite(terrain,roads);let clearance=Infinity;for(let d=0;d<site.length;d+=.5){const hook=site.sample(d);for(const p of stairs.points)if(Math.hypot(hook.x-p.x,hook.z-p.z)<stairs.width/2+.35)clearance=Math.min(clearance,hook.y-LIFT.feetDrop-(p.y+1.3));}assert.ok(clearance>4.8,`raised hiking rail clearance ${clearance} m`);});

// a stopped chair in a light gust swings its seat through the 0.4 m/s step-off limit for a
// fifth of a second at a time. docked() flickered, so the panel and the spec saw "docked" and the
// rider's E a moment later was refused (chairlift.spec.js summit exit, base the baseline and later).
function gust(amplitude){let time=0;return {tick(h){time+=h;},sample(x,y,z,out={}){out.wx=6+amplitude*Math.sin(time*.9)+amplitude*.6*Math.sin(time*2.3);out.wy=0;out.wz=amplitude*.5*Math.sin(time*1.3);return out;}};}
function dockReadings(amplitude){
 const t=new LiftTransport(site),air=gust(amplitude),h=1/60;t.chairs[0].occupied=true;t.setSpeed(LIFT.maxSpeed);t.requestDock(site.summit,0);
 for(let i=0;i<20000&&t.running;i++){air.tick(h);t.advance(h,air);}
 let first=null,refusedAfter=0,longest=0,refusedSince=null;
 for(let i=0;i<60*30;i++){air.tick(h);t.advance(h,air);const docked=t.docked(t.chairs[0],site.summit);
  if(docked){if(first===null)first=t.time;if(refusedSince!==null){longest=Math.max(longest,t.time-refusedSince);refusedSince=null;}}
  else if(first!==null){refusedAfter++;if(refusedSince===null)refusedSince=t.time;}}
 return {first,refusedAfter,longest};
}
test('A stopped summit chair that reads docked stays docked through a light gust, so the rider can step off',()=>{
 const light=dockReadings(2);assert.ok(light.first!==null,'the chair docks at the summit');
 assert.equal(light.refusedAfter,0,`docked flickered off for ${light.longest.toFixed(3)} s after the chair first read docked`);
 const strong=dockReadings(8);assert.ok(strong.refusedAfter>0,'a seat swung hard by a strong gust still refuses the exit');
});
