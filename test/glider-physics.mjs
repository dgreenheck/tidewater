import test from 'node:test';import assert from 'node:assert/strict';
import {GliderPhysics,WING,STEP,coefficients,loads,equilibrium} from '../src/glider/GliderPhysics.js';
import {LAUNCH,prepareGliderSite} from '../src/glider/Site.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {poseQ,rotate,add,dot,finiteState} from '../src/aviation/Math.js';
import {DisasterField} from '../src/disasters/Field.js';
import {applyWakeToAir} from '../src/windfarm/Wake.js';
import {GliderCollision} from '../src/glider/Collision.js';
import {Colliders} from '../src/world/Colliders.js';
import {Vector3,Group} from '../src/engine/index.js';
import {Material} from '../src/engine/render/Material.js';
import {buildStation} from '../src/glider/Station.js';
import {spanBounds} from '../src/disasters/Structures.js';
import {Player} from '../src/player/Player.js';
import {Glider} from '../src/glider/Glider.js';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} differs from ${b}`);
const calm={sample:()=>({}),terrainAt:()=>-1000,waterAt:()=>-1000};
const terrain=new TerrainData();const wind={sample:()=>({wx:2.44,wz:6.55}),terrainAt:(x,z)=>terrain.heightAt(x,z),waterAt:()=>0};
function airborne(){const g=new GliderPhysics(),e=equilibrium();g.phase='airborne';g.position=[0,500,0];g.velocity=[0,e.speed*Math.sin(e.gamma),e.speed*Math.cos(e.gamma)];g.quaternion=poseQ(0,e.pitch);return g;}
test('NASA qSCl and finite-wing induced drag laws use the declared wing geometry',()=>{
 const a=.12,speed=13,c=coefficients(a),ar=10.2**2/15.8;
 near(c.cl,.724);near(c.induced,.724**2/(Math.PI*ar*.72));
 const f=loads([0,0,speed],poseQ(0,a));near(f.q,.5*1.225*13**2);near(f.lift,.5*1.225*13**2*15.8*.724);near(f.drag,.5*1.225*13**2*15.8*(.039+c.induced));
 near(dot(f.force,[0,0,speed]),-f.drag*speed); // Lift cannot power motion through still air.
});
test('steady-glide benchmark satisfies L=Wcosγ, D=Wsinγ and range/height=L/D',()=>{
 const e=equilibrium(),velocity=[0,e.speed*Math.sin(e.gamma),e.speed*Math.cos(e.gamma)],f=loads(velocity,poseQ(0,e.pitch));
 near(e.speed,12.82007046211981);near(e.ratio,9.758383972602381);near(f.force[1],118*9.81);near(f.force[2],0);near(velocity[2]/-velocity[1],e.ratio);
});
test('production integration closes mechanical energy against aerodynamic work with no engine',()=>{
 const g=airborne(),energy=()=>.5*118*dot(g.velocity,g.velocity)+118*9.81*g.position[1],before=energy();
 for(let i=0;i<1200;i++)g.step(STEP,calm);
 near(energy()-before,g.metrics.airWork,1e-6);assert.ok(energy()<before);assert.equal(g.metrics.thrust,0);assert.ok(g.position[1]<490);
});
test('constant-air translation is Galilean invariant and shared field wake changes loads',()=>{
 const a=airborne(),b=airborne(),v=[6,1,-4];b.velocity=add(b.velocity,v);
 const env={...calm,sample:()=>({wx:v[0],wy:v[1],wz:v[2]})};a.step(STEP,calm);b.step(STEP,env);
 near(a.metrics.lift,b.metrics.lift);near(a.metrics.drag,b.metrics.drag);
 const field=new DisasterField(()=>-1000);field.ambient=()=>({x:0,z:7});field.registerAirModifier((x,y,z,air)=>{air.wz*=.6;});
 const c=airborne(),d=airborne();c.step(STEP,{...calm,sample:(...p)=>field.sampleRaw(...p)});d.step(STEP,{...calm,sample:(...p)=>field.sample(...p)});near(d.metrics.wind,4.2);assert.ok(d.metrics.q>c.metrics.q);
});
test('mountain launch has a finite leg-powered ground run before aerodynamic flight',()=>{
 const g=new GliderPhysics();g.launch();for(let i=0;i<1200&&g.phase==='running';i++)g.step(STEP,wind);
 assert.equal(g.phase,'airborne');assert.ok(g.run>10&&g.run<24);assert.ok(g.metrics.controlWork>500);assert.equal(g.metrics.thrust,0);assert.ok(g.position[1]>300);
});
test('weight shift changes bank and heading; push-out stalls and pull-in recovers',()=>{
 const g=airborne();g.controls.roll=.5;for(let i=0;i<360;i++)g.step(STEP,calm);assert.ok(g.metrics.bank>.2);assert.ok(g.metrics.heading>.3);
 const s=airborne();s.controls.pitch=1;let stalled=false;for(let i=0;i<360;i++){s.step(STEP,calm);stalled ||=s.metrics.stall;}assert.ok(stalled);s.controls.pitch=-.25;for(let i=0;i<480;i++)s.step(STEP,calm);assert.equal(s.metrics.stall,false);assert.ok(s.metrics.speed>12);
});
test('real terrain beach approach lands only with reasonable sink, speed, bank and surface',()=>{
 const g=new GliderPhysics();g.approach(wind);for(let i=0;i<3600&&g.phase==='airborne';i++){g.controls.flare=g.metrics.agl<1.5;g.step(STEP,wind);}
 assert.equal(g.phase,'landed');assert.equal(g.reason,'Beach landing complete');assert.ok(g.metrics.distance>60);assert.ok(g.metrics.impactSpeed<1);assert.ok(g.metrics.landingSpeed<7);
 const bad=new GliderPhysics();bad.approach(wind);for(let i=0;i<3600&&bad.phase==='airborne';i++){bad.controls.flare=bad.metrics.agl<4;bad.step(STEP,wind);}assert.equal(bad.phase,'crashed');assert.ok(bad.metrics.impactSpeed>4);
 const wet=airborne();wet.position=[0,1,0];wet.velocity=[0,-5,10];wet.step(STEP,{...calm,waterAt:()=>0});assert.equal(wet.phase,'ditched');for(let i=0;i<1200;i++)wet.step(STEP,{...calm,waterAt:()=>0});assert.ok(wet.position[1]>-2);assert.equal(wet.metrics.thrust,0);
});
test('fixed-step results match 30 and 120Hz; reset and bounded extreme wind remain finite',()=>{
 const a=airborne(),b=airborne();for(let i=0;i<1200;i++)a.update(1/120,calm);for(let i=0;i<300;i++)b.update(1/30,calm);for(let i=0;i<3;i++)near(a.position[i],b.position[i]);
 const g=airborne();for(let i=0;i<2400;i++)g.step(STEP,{...calm,sample:()=>({wx:120*Math.sin(i*.03),wy:60*Math.cos(i*.01),wz:-90})});assert.ok(finiteState(g));g.reset();assert.equal(g.phase,'ready');near(g.position[0],new GliderPhysics().position[0]);
});
test('surveyed summit stairs connect the evacuation refuge with walkable rises and dry supports',()=>{
 const site=prepareGliderSite(terrain,new CoastalRoute(terrain));assert.ok(site.summit>300);assert.ok(site.length>500&&site.length<1400);assert.ok(site.maxRise<.20);assert.ok(site.maxGrade<.621);assert.ok(site.maxHeight<45);
 const first=site.points[0],last=site.points.at(-1);near(first.x,47);near(first.z,-249);near(first.y,site.refuge.y);assert.ok(site.bridges.length>10);for(const p of site.bridges)assert.ok(p.y-.16-p.roadHeight>=5.6);near(last.y,LAUNCH.y);
 for(const p of site.points){assert.ok(p.y>=terrain.heightAt(p.x,p.z));assert.ok(terrain.heightAt(p.x,p.z)>15);}
});
test('actual farm wake modifier reaches the wing without duplicate ambient flow or added wake energy',()=>{
 const field=new DisasterField(()=>-1000);field.ambient=()=>({x:0,z:10});const sources=[{id:'test',x:0,z:0,baseY:10,ct:.8,flowX:0,flowZ:1}];field.registerAirModifier((x,y,z,air)=>applyWakeToAir(air,x,y,z,sources,5));
 const a=airborne(),b=airborne();a.position=[0,100,400];b.position=[0,100,400];a.step(STEP,{...calm,sample:(...p)=>field.sampleRaw(...p)});b.step(STEP,{...calm,sample:(...p)=>field.sample(...p)});
 assert.ok(b.metrics.wind<10);assert.ok(b.metrics.windVector[1]!==0);assert.ok(b.metrics.q>a.metrics.q);assert.equal(b.metrics.thrust,0);
});
test('swept wing/pilot probes reject island structures, and removed/disabled colliders clear',()=>{
 const c=new Colliders(),box=c.addBox(new Vector3(0,500,2),new Vector3(2,3,1),0,{solid:true,tag:'building'});const collision=new GliderCollision(c),g=airborne();g.velocity=[0,0,100];g.step(.025,{...calm,obstacleAt:(...p)=>collision.at(...p)});assert.equal(g.phase,'crashed');assert.match(g.reason,/building/);
 box.disasterDisabled=true;assert.equal(collision.at(0,500,2),null);box.disasterDisabled=false;c.boxes.length=0;collision.refresh();assert.equal(collision.at(0,500,2),null);
});

test('launch structure loads are sampled at the summit, unaffected by the animated local-space windsock',()=>{
 const app={terrainData:terrain,coastalRoute:new CoastalRoute(terrain),scene:new Group(),colliders:new Colliders(),village:{materials:{wood:new Material(),stone:new Material(),hard:new Material()}}};
 const station=buildStation(app),bounds=spanBounds(station.launchRecord.spans);
 assert.ok(Math.abs(bounds.center.y-LAUNCH.y)<15,`launch load height ${bounds.center.y} must stay at summit ${LAUNCH.y}`);
 assert.ok(Math.abs(bounds.center.z-LAUNCH.z)<25);assert.ok(bounds.half.y<20&&bounds.half.z<25);
 assert.ok(station.launchRecord.colliders.length>80);assert.ok(station.records.length>100);
});

test('production walker follows every summit bend and landing without teleporting or blocked overlapping treads',()=>{
 const app={terrainData:terrain,coastalRoute:new CoastalRoute(terrain),scene:new Group(),colliders:new Colliders(),village:{materials:{wood:new Material(),stone:new Material(),hard:new Material()}}};
 const station=buildStation(app),route=station.site.points,input={down:k=>k==='KeyW'||k==='ShiftLeft',hit:()=>false};
 const player=app.player=new Player({camera:{},input,terrain,colliders:app.colliders,query:{allocate:()=>0},boat:null});
 player.position.set(route[0].x,route[0].y,route[0].z);player.grounded=true;player.waterH=player.waterMean=0;
 const guide=new Glider(app);Object.assign(guide,{trail:route,trailIndex:0,guiding:true,trailArrived:false,ui:{message:()=>{}}});
 let elapsed=0,lastIndex=0,stuck=0;
 while(elapsed<200&&!guide.trailArrived){const before=player.position.toArray();guide.updateHike();assert.deepEqual(player.position.toArray(),before,'Guidance changes the view, never position');player.updateWalk(1/60);elapsed+=1/60;stuck=guide.trailIndex===lastIndex?stuck+1:0;lastIndex=guide.trailIndex;if(stuck>180)break;}
 assert.equal(guide.trailArrived,true,`Stairs blocked at waypoint ${guide.trailIndex}, position ${player.position.toArray()}`);
 assert.ok(elapsed<180);assert.equal(player.mode,'walk');assert.ok(player.grounded);assert.ok(player.position.y>305);
});
