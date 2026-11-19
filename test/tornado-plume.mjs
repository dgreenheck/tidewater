import {test} from 'node:test';import assert from 'node:assert/strict';
import {TornadoParticles,TornadoVisuals} from '../src/disasters/TornadoVisuals.js';
import {DisasterField} from '../src/disasters/Field.js';import {Scene,Vector3} from '../src/engine/index.js';
import {evaporatedDiameter,liquidMass,geometricExtinction,spreadRadius,plumeSource,plumeRepresentation} from '../src/disasters/TornadoPlume.js';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const event={time:3,intensity:100,radius:180,duration:90};
const field={center:()=>({x:0,z:0}),envelope:()=>1,terrain:()=>0,waterAt:()=>0,sample:(_x,_y,_z,out={})=>Object.assign(out,{wx:20,wy:25,wz:0,height:0})};
function parcel(index=4,plume={}){const model=new TornadoParticles(field,{dust:5,flecks:0,turbulence:false,plume});model.update(0,event);const p=model.dust[index];model.spawn(p,event);p.age=.6;p.life=100;p.p.y=100;p.diffusivity=0;return {model,p};}

test('Evaporation obeys diameter-squared law, preserves saturation and has positive stable mass and area',()=>{
 const d=20e-6,after=evaporatedDiameter(d,.8,5e-12,5);near(after,18.973665961e-6,1e-15);near(liquidMass(1,after)/liquidMass(1,d),.853814968245,1e-11);near(geometricExtinction(1,after)/geometricExtinction(1,d),.9,1e-12);
 near(evaporatedDiameter(d,1,5e-12,100),d);assert.equal(evaporatedDiameter(d,0,5e-12,100),0);
 let split=d;for(let i=0;i<100;i++)split=evaporatedDiameter(split,.8,5e-12,.05);near(split,after,1e-15);
});
test('The real parcel update evaporates dry condensate and keeps saturated condensate unchanged',()=>{
 for(const humidity of [0,.5,1]){const {model,p}=parcel(4,{humidity,sourceHumidity:humidity,entrainmentSpeed:0,evaporationK:5e-12}),d=p.diameter;
  for(let i=0;i<3;i++)model.update(1/60,event);near(p.diameter,evaporatedDiameter(d,humidity,5e-12,.05),1e-14);assert.ok(p.p.y>100,'evaporation must not clip upward motion');}
});
test('Dry mineral grains dilute by real cloud spreading while keeping grain mass and extinction accounted',()=>{
 const {model,p}=parcel(0,{humidity:0,sourceHumidity:0,entrainmentSpeed:3}),d=p.diameter,r=p.size;
 for(let i=0;i<6;i++)model.update(1/60,event);near(p.diameter,d);near(p.size,r+.3,1e-12);assert.ok(p.cloudMass>0);
 const b=model.snapshot().budget;near(b.sourceDustMass,b.liveDustMass+b.exportedDustMass+b.depositedDustMass,1e-9);near(b.sourceDustExtinction,b.liveDustExtinction+b.exportedDustExtinction+b.depositedDustExtinction,1e-9);
 near(spreadRadius(3,.4,0,10),5);near(spreadRadius(3,0,2,10),23);
});
test('Nearby parcels sample a common coherent eddy independent of their source ids',()=>{
 const m=new TornadoParticles(field,{dust:5,flecks:0}),a=m.dust[0],b=m.dust[4];m.update(0,event);m.spawn(b,event);
 Object.assign(a.p,{x:20,y:80,z:10});Object.assign(b.p,a.p);const s=field.sample(0,0,0),u={...m.air(a,s,event,1/60)},v={...m.air(b,s,event,1/60)};
 near(u.x,v.x);near(u.y,v.y);near(u.z,v.z);b.p.x+=.01;const next=m.air(b,s,event,1/60);assert.ok(Math.hypot(next.x-u.x,next.y-u.y,next.z-u.z)<.05);
});
test('Mixed actual tornado clouds conserve source matter across evaporation, pool export and deposition',()=>{
 const f=new DisasterField(()=>0),e=f.start('tornado',{intensity:100,radius:180,speed:0,duration:60}),m=new TornadoParticles(f,{dust:120,flecks:0});
 for(let i=0;i<240;i++){e.time+=.1;m.update(.1,e);}const b=m.snapshot().budget;assert.ok(b&&b.sourceDustMass>0&&b.sourceLiquidMass>0&&b.evaporatedLiquidMass>0);
 for(const material of ['Dust','Liquid']){const evaporated=material==='Liquid'?b.evaporatedLiquidMass:0;near(b['source'+material+'Mass'],b['live'+material+'Mass']+b['exported'+material+'Mass']+b['deposited'+material+'Mass']+evaporated,1e-8);}
 const p=m.dust.find(p=>p.active);p.p.y=-10;m.update(1/60,e);assert.ok(m.deposited>0);
 const before=JSON.stringify(m.snapshot());f.paused=true;m.update(.1,e);assert.equal(JSON.stringify(m.snapshot()),before);m.clear();assert.equal(m.snapshot().budget.sourceDustMass,0);
});
test('One optical population covers every height and gives respawn a fresh world-motion history',()=>{
 const f=new DisasterField(()=>0),e=f.start('tornado',{intensity:100,radius:180,speed:0,duration:60}),v=new TornadoVisuals({scene:new Scene(),camera:{position:new Vector3(0,50,200)},sceneRenderer:{opaqueCopy:{depthTexture:null}}},f);
 for(let i=0;i<120;i++){e.time+=1/60;v.update(1/60);}assert.equal(v.group.children.filter(o=>o.geometry&&o.material&&o.visible).length,2,'scene contains exactly the cloud and debris meshes');assert.equal(v.stats.raySteps,0,'an independent optical tube must not be superimposed on transported clouds');assert.equal(v.stats.drawCalls,2);
 const p=v.particles.dust[4];v.particles.spawn(p,e);assert.deepEqual(p.previous,p.p);assert.equal(p.previousSize,p.size);assert.equal(p.previousRotation,p.rotation);
 v.clear();assert.equal(v.dust.geometry.instanceCount,0);assert.equal(v.snapshot().budget.sourceDustMass,0);assert.ok(v.particles.dust.every(p=>p.number===0&&p.extinctionArea===0));
});
test('Actual condensate births retain the shared heterogeneous moisture source and a soft widening cross-section',()=>{
 const m=new TornadoParticles(field,{dust:1000,flecks:0});m.update(0,event);const low=[],high=[],moisture=[],births=[];
 for(const p of m.dust.filter(p=>p.id%5===4)){
  m.spawn(p,event);births.push(p);moisture.push(p.sourceMoisture);
  const r=Math.hypot(p.p.x,p.p.z);if(p.p.y<80)low.push(r*r);if(p.p.y>160)high.push(r*r);
 }
 assert.ok(low.length>20&&high.length>20,'source samples both the lower funnel and upper moist region');
 const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v,0)/a.length);assert.ok(rms(high)>2*rms(low),'source opens gradually aloft instead of an equal-width chimney');assert.ok(Math.max(...moisture)-Math.min(...moisture)>.25);
 for(const p of births){const expected=plumeSource(p.p,event,{x:0,z:0},0);near(p.sourceMoisture,expected.moisture);near(p.sourceHumidity,expected.humidity);assert.ok(p.sourceLoading>0&&p.sourceLoading<2.4);}
});
test('Source moisture changes the actual statistical grain population at otherwise identical births',()=>{
 // One event seed for both births: parcel draws are seeded per event (EventRandom).
 const born=time=>{const m=new TornadoParticles(field,{dust:5,flecks:0}),e={...event,time,seed:11};m.update(0,e);m.spawn(m.dust[4],e);return m.dust[4];},a=born(3),b=born(6);
 assert.deepEqual(a.p,b.p);near(a.diameter,b.diameter);near(a.initialSize,b.initialSize);
 const sourceA=plumeSource(a.p,{...event,time:3},{x:0,z:0},0),sourceB=plumeSource(b.p,{...event,time:6},{x:0,z:0},0);
 assert.ok(Math.abs(b.targetNumber/a.targetNumber-1)>.1,'physical source population must respond to transported moisture patches');near(b.targetNumber/a.targetNumber,sourceB.loading/sourceA.loading);
});
test('Condensate concentration seeds real liquid mass and extinction through the production source and injection',()=>{
 for(const concentration of [.00003,.00006,.00009]){
  const m=new TornadoParticles(field,{dust:5,flecks:0,plume:{liquidWaterContent:concentration,evaporationK:0,humidity:1,sourceHumidity:1,entrainmentSpeed:0}});m.update(0,event);const p=m.dust[4];m.spawn(p,event);
  const volume=4*Math.PI*p.initialSize**3/3,source=plumeSource(p.p,event,{x:0,z:0},0),mass=concentration*volume*source.loading,grainMass=p.density*Math.PI*p.diameter**3/6;
  near(p.targetNumber*grainMass,mass,1e-12);near(p.targetNumber*Math.PI*p.diameter*p.diameter/2,mass*3/(p.density*p.diameter),1e-10);
  for(let i=0;i<6;i++)m.update(.1,event);near(m.snapshot().budget.sourceLiquidMass,mass,1e-12);near(m.snapshot().budget.liveLiquidMass,mass,1e-12);
 }
});
test('Constant-source statistical representation preserves volume, mass and extinction flux at every intensity',()=>{
 const r=plumeRepresentation(1280,100);near(r.birthRate,91.42857142857143);near(r.weight,3.7333333333333334);near(r.radiusScale,1.551311180968,.000000000001);
 const radius=5*r.radiusScale,mass=.00006*4*Math.PI*radius**3/3,number=mass/liquidMass(1,20e-6),area=geometricExtinction(number,20e-6);
 near(mass,.117286125734,.000000000001);near(number,2.8e10,.00002);near(area,17.5929188601,.0000000001);
 for(const capacity of [5,200,1280])for(const intensity of [5,65,100,120])for(const envelope of [.1,.5,1]){
  const p=plumeRepresentation(capacity,intensity,envelope),baseMass=.00006*4*Math.PI*5**3/3,expected=capacity/5*Math.max(.15,Math.min(1.5,intensity/75))*envelope*baseMass;
  assert.ok(p.birthRate<=capacity/14);near(p.birthRate*.00006*4*Math.PI*(5*p.radiusScale)**3/3,expected,1e-10);
 }
});
test('The bounded production pool supplies ground mineral clouds continuously instead of starving when full',()=>{
 const run=dt=>{
  const f=new DisasterField(()=>0),e=f.start('tornado',{intensity:100,radius:180,speed:0,duration:60}),m=new TornadoParticles(f,{dust:200,flecks:0}),bins=Array.from({length:54},()=>({births:0,represented:0}));let bin=0;
  const spawn=m.spawn.bind(m);m.spawn=(p,...args)=>{spawn(p,...args);if(p.active&&!p.kind&&!p.liquid){bins[bin].births++;bins[bin].represented+=p.representationWeight??1;}};
  for(let i=1;i<=Math.round(54/dt);i++){bin=Math.min(53,Math.floor((i-1)*dt+1e-9));e.time=i*dt;m.update(dt,e);assert.ok(m.dust.filter(p=>p.active).length<=200);}
  const steady=bins.slice(2);assert.ok(steady.every(b=>b.births>=8),JSON.stringify(steady));
  const represented=steady.reduce((s,b)=>s+b.represented,0),wanted=steady.length*(200/5)*(100/75)*.8;
  assert.ok(Math.abs(represented/wanted-1)<.06,'statistical source weight preserves the intended pre-cap mineral source rate');return represented;
 };
 const fine=run(1/60),coarse=run(.1);assert.ok(Math.abs(coarse/fine-1)<.01,'source delivery remains stable over three pool lifetimes at both accepted frame steps');
});
test('The prescribed moist source is neighbour-continuous and changes in space and time without source bands',()=>{
 const p={x:30,y:110,z:18},a=plumeSource(p,event,{x:0,z:0},0),b=plumeSource({x:30.01,y:110.01,z:18.01},event,{x:0,z:0},0);
 assert.ok(Math.abs(a.moisture-b.moisture)<.001);assert.ok(Math.abs(a.humidity-b.humidity)<.001);
 const ys=[];for(let y=20;y<=250;y+=1)ys.push(plumeSource({x:30,y,z:18},event,{x:0,z:0},0).moisture);assert.ok(Math.max(...ys)-Math.min(...ys)>.2);assert.ok(Math.max(...ys.slice(1).map((v,i)=>Math.abs(v-ys[i])))<.04);
 assert.ok(Math.abs(a.moisture-plumeSource(p,{...event,time:6},{x:0,z:0},0).moisture)>.01);
});
test('Natural event shutdown exports accounted clouds smoothly and closes the budget across real expiry',()=>{
 const f=new DisasterField(()=>0),e=f.start('tornado',{intensity:100,radius:180,speed:0,duration:6}),v=new TornadoVisuals({scene:new Scene(),camera:{position:new Vector3(0,50,200)},sceneRenderer:{opaqueCopy:{depthTexture:null}}},f);
 for(let i=0;i<240;i++){f.advance(1/60);v.update(1/60);}const atTail=v.snapshot().budget;assert.ok(atTail.liveDustExtinction+atTail.liveLiquidExtinction>100);
 while(e.time<5.9){f.advance(1/60);v.update(1/60);}const late=v.snapshot().budget;assert.ok(late.liveDustExtinction+late.liveLiquidExtinction<.03*(atTail.liveDustExtinction+atTail.liveLiquidExtinction),'last tenth second contains only a small optical tail');
 f.advance(.1);v.update(.1);assert.equal(f.events.has('tornado'),false);assert.equal(v.dust.geometry.instanceCount,0);const b=v.snapshot().completedBudget;assert.ok(b,'completed event exposes its final accounted export');
 for(const material of ['Dust','Liquid'])for(const quantity of ['Mass','Extinction']){
  const evaporated=material==='Liquid'?b[quantity==='Mass'?'evaporatedLiquidMass':'evaporatedExtinction']:0;
  near(b['source'+material+quantity],b['live'+material+quantity]+b['exported'+material+quantity]+b['deposited'+material+quantity]+evaporated,1e-8);
 }
 v.update(.1);assert.deepEqual(v.snapshot().completedBudget,b);v.clear();assert.equal(v.snapshot().completedBudget,null);
});
