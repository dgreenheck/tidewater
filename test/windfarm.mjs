import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TurbineModel, aerodynamics, sectionModulus } from '../src/windfarm/TurbineModel.js';
import { REFERENCE as R, DRIVE_INERTIA, SWEPT_AREA, RPM, ASSUMPTIONS as A } from '../src/windfarm/Reference.js';
import { wakeFactor, applyWakeToAir, wakeBounds } from '../src/windfarm/Wake.js';
import { WindFarm } from '../src/windfarm/WindFarm.js';
import { Group } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';
import { verifySites, prepareWindFarmSites, FARM_SITES } from '../src/windfarm/Sites.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField } from '../src/disasters/Field.js';

const wind = speed => ({ wx:0, wy:0, wz:-speed / Math.cos(R.tilt), ax:0, ay:0, az:0, height:0, ux:0, uz:0 });
function run(t, seconds, speed=8, ground={}) { for(let i=0;i<Math.round(seconds*20);i++)t.advance(0.05,wind(speed),{...wind(0),...ground}); return t; }

test('NREL peak-Cp benchmark: the operating rotor extracts 0.482 of the available 8 m/s flux', () => {
 const t=new TurbineModel({yaw:0});
 run(t,240,8);
 // Independent reference calculation: 0.5 * 1.225 * 12445.3 * 0.482 * 8^3 * 0.944.
 const expected=1_775_800;
 assert.ok(Math.abs(t.electricalPower-expected)/expected<0.025,`${t.electricalPower} W must approach ${expected} W`);
 assert.ok(Math.abs(t.omega/RPM-9.155)/9.155<0.03,'rotor must reach the region-2 tip-speed-ratio equilibrium');
 assert.ok(t.energyJ>300e6,'the integrated meter must record supplied energy');
});

test('Published power/area constraints and the Betz bound hold over the rotor envelope',()=>{
 assert.ok(Math.abs(SWEPT_AREA-12445.3)<.1,'NREL preconed swept area');
 assert.ok(Math.abs(DRIVE_INERTIA-437e5)/437e5<.01,'blade parallel-axis inertia plus reflected generator');
 for(const speed of [0,3,8,11.4,24,60])for(const rpm of [0,6.9,12.1,18,30])for(const pitch of [0,0.15,0.5,Math.PI/2]) {
  const a=aerodynamics(rpm*RPM,speed,pitch);
  assert.ok(a.cp>=0&&a.cp<=16/27,'no aerodynamic coefficient exceeds Betz');
  assert.ok(a.torque>=0&&Number.isFinite(a.torque));
  if(rpm>0)assert.ok(a.torque*rpm*RPM<=a.flux*16/27+1e-7);
 }
 assert.equal(aerodynamics(0,8,0).cp,0);
 assert.ok(aerodynamics(0,8,0).torque>0,'wind has finite starting torque without inventing energy at rest');
 assert.equal(aerodynamics(12*RPM,20,Math.PI/2).torque,0,'feather eliminates driving torque');
});

test('Rated electrical cap is achieved by generator torque and pitch across NREL region 3',()=>{
 for(const speed of [11.4,16,24]) {
  const t=run(new TurbineModel(),240,speed);
  assert.ok(Math.abs(t.electricalPower-5e6)<25000,`${speed} m/s should deliver 5 MW within 0.5%`);
  assert.ok(Math.abs(t.omega/RPM-12.1)<.05,'pitch regulates 12.1 rpm');
  assert.equal(t.damaged,false);assert.equal(t.highWindLatched,false);assert.equal(t.overspeedLatched,false);
  assert.ok(t.generatorTorque*t.omega*R.efficiency<=5e6+1000,'generator work determines electrical power');
 }
});

test('Power below cut-in, high-wind shutdown and explicit restart hysteresis',()=>{
 const t=run(new TurbineModel(),50,2);
 assert.equal(t.energyJ,0);assert.equal(t.omega,0);assert.equal(t.status,'below cut-in');
 run(t,90,8);assert.ok(t.electricalPower>1e6);
 run(t,.1,26);assert.equal(t.electricalPower,0);assert.equal(t.highWindLatched,true);
 assert.match(t.restart(),/below 20/);
 run(t,50,26);assert.ok(t.omega<.001);assert.equal(t.pitch,Math.PI/2);assert.equal(t.damaged,false);
 run(t,10,22);assert.match(t.restart(),/below 20/);assert.equal(t.electricalPower,0);
 run(t,3,8);assert.match(t.restart(),/5 seconds/);run(t,3,8);assert.equal(t.restart(),'');
 run(t,150,8);assert.ok(t.electricalPower>1.7e6);
});

test('The rotor conserves torque work, stores kinetic energy, and a brake cannot keep generating',()=>{
 const t=new TurbineModel();run(t,12,8);
 assert.ok(t.omega>0&&t.omega<8*R.optimalTSR/R.radius,'inertia prevents an immediate assigned wind speed');
 run(t,200,8);
 assert.ok(Math.abs(t.rotorEnergyJ-.5*DRIVE_INERTIA*t.omega**2)<1e-6);
 assert.ok(Math.abs(t.state().energyResidual)<.01,'work in minus work out equals delta rotational kinetic energy');
 assert.ok(Math.abs(t.energyJ-t.generatorWorkJ*R.efficiency)<.001);
 const initialEnergy=t.energyJ;t.setBrake(true);run(t,50,8);
 assert.equal(t.energyJ,initialEnergy);assert.equal(t.electricalPower,0);assert.equal(t.omega,0);
 assert.ok(t.brakeWorkJ>1e7,'the brake absorbs the stored kinetic energy');
 assert.ok(Math.abs(t.state().energyResidual)<.01);
 t.setBrake(false);t.setEnabled(false);run(t,10,8);assert.equal(t.omega,0);
});

test('Yaw slews at published 0.3 degrees/s and crosswind cannot receive full aligned power',()=>{
 const t=new TurbineModel({yaw:Math.PI/2});t.advance(.1,wind(8));
 assert.ok(Math.abs(t.yaw-(Math.PI/2-R.yawRate*.1))<1e-10);
 assert.ok(t.axialSpeed<.01);
 run(t,100,8);
 assert.ok(t.yaw>Math.PI/4,'a 90 degree yaw move takes five minutes');
 assert.ok(t.electricalPower<800000);
});

test('Jensen wake benchmark, crosswind clearance and damaged upstream rotor',()=>{
 const source={id:'a',x:0,z:0,ct:.8,damaged:false},target={id:'b',x:630,z:0};
 const retained=wakeFactor(target,[source],{wx:8,wz:0});
 const expected=1-(1-Math.sqrt(.2))/(1+2*.04*5)**2;
 assert.ok(Math.abs(retained-expected)<1e-12,'aligned five-diameter wake analytic deficit');
 assert.equal(wakeFactor({...target,z:200},[source],{wx:8,wz:0}),1);
 assert.equal(wakeFactor({...target,baseY:170},[{...source,baseY:0}],{wx:8,wz:0}),1,'a higher land turbine outside the wake disk cannot be shadowed');
 assert.equal(wakeFactor(target,[{...source,damaged:true}],{wx:8,wz:0}),1);
});

test('Supported earthquake inertia and water-current foundation force have dimensional analytic expectations',()=>{
 const t=new TurbineModel({groundY:10,terrainMin:10,baseY:11,anchorY:8});run(t,160,0,{ax:2,ux:3,height:15});
 const massMoment=(240000+56780+3*17740)*90+347460*38.234;
 assert.ok(Math.abs(t.loads.seismicMoment-2*massMoment)<1e-5);
 assert.ok(Math.abs(t.loads.waterForce-.5*1025*1.2*(13*1+6*4)*3**2)<1e-6);
 const stress=2*massMoment/sectionModulus(6,.027)+(350000+347460)*9.81/(Math.PI*(6**2-5.946**2)/4);
 assert.ok(Math.abs(t.loads.towerStress-stress)/stress<.001,'settled supported inertia produces bending and axial stress in Pa');
 assert.ok(t.loads.foundationMoment>t.loads.seismicMoment,'buried anchor lever and exposed flood forces reach the land foundation');
});

test('Tower resonance transfers its amplified modal reaction into actual bending demand and failure',()=>{
 const t=new TurbineModel();t.setEnabled(false);const amplitude=.00981,dt=1/120,omega=2*Math.PI*R.towerFrequency;
 let peakDisplacement=0,peakMoment=0;
 for(let i=0;i<14400;i++) {t.advance(dt,wind(0),{...wind(0),ax:amplitude*Math.sin(omega*i*dt)});if(i>12000){peakDisplacement=Math.max(peakDisplacement,Math.abs(t.deflectionX));peakMoment=Math.max(peakMoment,t.loads.towerMoment);}}
 const expected=amplitude/(2*A.towerDamping*omega**2);
 assert.ok(Math.abs(peakDisplacement-expected)/expected<.003,'published frequency and assumed damping yield the analytical SDOF resonance');
 const staticMoment=amplitude*((240000+56780+3*17740)*90+347460*38.234);
 assert.ok(peakMoment/staticMoment>10,'resonance amplifies the moment that actually drives stress, rather than only the mesh');
 assert.ok(Math.abs(t.loads.modalMoment-t.loads.modalReaction*90)<1e-7);
 const severe=new TurbineModel();severe.setEnabled(false);
 for(let i=0;i<14400&&!severe.damaged;i++)severe.advance(dt,wind(0),{...wind(0),ax:.981*Math.sin(omega*i*dt)});
 assert.equal(severe.damaged,true,'sustained 0.1 g resonant loading exceeds the explicit assumed strength');
});

test('Blade release transfers kinetic energy out of the attached rotor without duplicating its reservoir',()=>{
 const t=run(new TurbineModel(),200,8),before=t.rotorEnergyJ,omega=t.omega,inertia=t.inertia;
 t.fail('blade');
 assert.equal(t.omega,omega);assert.ok(t.inertia<inertia);assert.equal(t.electricalPower,0);
 assert.ok(Math.abs(before-t.rotorEnergyJ-t.detachedEnergyJ)<1e-7);
 assert.ok(Math.abs(t.state().energyResidual)<.01);
 t.fail('tower');assert.equal(t.omega,0);assert.equal(t.rotorEnergyJ,0);assert.ok(Math.abs(before-t.detachedEnergyJ)<1e-7);
});

test('The same live tornado sample drives rotor cut-out and a damaged rotor stops electrical production',()=>{
 const field=new DisasterField(()=>25);field.start('tornado',{x:0,z:0,radius:100,intensity:120,speed:0,duration:30});
 const t=new TurbineModel({x:18,z:0,groundY:25,baseY:25.45,yaw:Math.atan2(.28,-1)});
 let sampledPeak=0;
 for(let i=0;i<240;i++){field.advance(.05);const hub=field.sample(18,115.45,0,{}),base=field.sample(18,25.1,0,{});sampledPeak=Math.max(sampledPeak,Math.hypot(hub.wx,hub.wy,hub.wz));t.advance(.05,hub,base);}
 assert.ok(sampledPeak>25);assert.equal(t.highWindLatched,true);assert.ok(t.peakUtilization>1);
 assert.equal(t.damaged,true,'the same sampled tornado loads fracture the supported land turbine');assert.equal(t.electricalPower,0);assert.ok(t.failedComponents.includes('tower'));
 // A sustained supported severe quake is an independent destructive load case.
 const quake=new TurbineModel();run(quake,10,8,{ax:15});
 assert.equal(quake.damaged,true);assert.ok(quake.failedComponents.some(x=>x==='tower'||x==='foundation'));
 assert.equal(quake.electricalPower,0);assert.match(quake.restart(),/Repair/);
});

test('Long runs, bounded timesteps, invalid controls and reset are finite and deterministic',()=>{
 const t=run(new TurbineModel(),3600,8);
 assert.ok(t.energyJ>6e9&&t.energyJ<6.4e9);assert.ok(Math.abs(t.state().energyResidual)<1);
 assert.throws(()=>t.setMinimumPitch(91),/0 to 90/);assert.throws(()=>t.setMinimumPitch(NaN),/0 to 90/);
 const x=new TurbineModel(),y=new TurbineModel();x.advance(10,wind(8));y.advance(.1,wind(8));assert.equal(x.omega,y.omega);assert.equal(x.discardedTime,9.9);
 const expected=run(new TurbineModel(),30,8).state();t.reset();run(t,30,8);assert.deepEqual(t.state(),expected);
});

test('Farm destruction removes solid tower proxies, reset restores each exactly once, and disposal leaves no bodies',async()=>{
 const scene=new Group(),colliders=new Colliders(),registered=new Set(),bodies=new Set();
 const app={scene,colliders,terrainData:{heightAt:()=>10},rally:{refreshIslandColliders(){}},disasters:{paused:false,field:{sample:(x,y,z,out)=>Object.assign(out,wind(8))},registerExternal:a=>{registered.add(a);return()=>registered.delete(a);},addBody:opts=>{bodies.add(opts);return opts;},removeBody:r=>bodies.delete(r)}};
 const farm=await new WindFarm(app).init({panel:false});
 assert.equal(colliders.cylinders.length,9);assert.equal(registered.size,1);
 const t=farm.turbines[0];t.failedComponents.push('tower');t.damaged=true;farm.fracture(t,'tower');
 assert.equal(colliders.cylinders.length,7,'two tower colliders are removed, concrete footing remains');
 assert.equal(bodies.size,6,'three blades, nacelle and two tower segments have bounded proxies');
 farm.update(.1);assert.equal(t.electricalPower,0);
 farm.reset();farm.reset();assert.equal(colliders.cylinders.length,9);assert.equal(bodies.size,0);assert.equal(farm.detached.length,0);
 assert.equal(farm.state().damaged,0);farm.dispose();assert.equal(scene.children.length,0);assert.equal(colliders.cylinders.length,0);assert.equal(colliders.boxes.length,0);assert.equal(registered.size,0);
});


test('Land foundations stay dry under ordinary currents and react only when inundated',()=>{
 const t=new TurbineModel({groundY:12,terrainMin:11,baseY:14,anchorY:9});run(t,10,0,{height:0,ux:5,uz:3});
 assert.equal(t.loads.waterForce,0,'a current below dry ground cannot push the foundation');assert.equal(t.loads.uplift,0);
 run(t,.1,0,{height:13,ux:3});assert.ok(Math.abs(t.loads.waterForce-.5*1025*1.2*13*2*9)<1e-6,'only 2 m of exposed concrete is wetted');
 assert.equal(t.loads.padWet,2);assert.equal(t.loads.towerWet,0);
});

test('Real island sites have dry supported footings, clear rotor envelopes and non-destructive access reservations',async()=>{
 const terrain=new TerrainData(),before=FARM_SITES.map(s=>terrain.heightAt(s.x,s.z));
 const layout=prepareWindFarmSites(terrain);assert.equal(layout.sites.length,3);
 assert.deepEqual(FARM_SITES.map(s=>terrain.heightAt(s.x,s.z)),before,'site preparation does not grade or overwrite the island');
 const clearCount=terrain.clearZones.length;assert.equal(prepareWindFarmSites(terrain),layout);assert.equal(terrain.clearZones.length,clearCount);
 for(const site of layout.sites){assert.ok(site.terrainMin>3);assert.ok(site.rotorClearance>=15);assert.ok(site.baseY>site.terrainMax);assert.ok(site.anchorY<site.terrainMin);assert.ok(terrain.inClearZone(site.x,site.z));}
 for(const path of layout.paths)for(const p of path)assert.ok(terrain.heightAt(p.x,p.z)>0,'maintenance trail remains on dry land');
 assert.throws(()=>verifySites({heightAt:()=>-15}),/dry land/);
 const scene=new Group(),colliders=new Colliders(),samples=[];
 const app={scene,colliders,terrainData:terrain,disasters:{paused:false,field:{sample:(x,y,z,out)=>{samples.push({x,y,z});return Object.assign(out,wind(8));}},registerExternal:()=>()=>{}},rally:{refreshIslandColliders(){}}};
 const farm=await new WindFarm(app).init({panel:false});farm.update(.05);
 for(let i=0;i<3;i++) {const t=farm.turbines[i],v=farm.visuals[i],foot=v.colliders.find(c=>c.value.tag.endsWith(':footing')).value;
  assert.equal(v.root.position.y,t.baseY);assert.equal(foot.yMax,t.baseY);assert.ok(foot.yMin<t.terrainMin);
  assert.equal(colliders.groundHeightAt(t.x+4,t.z,t.baseY+.1),t.baseY,'the visible footing supports actual walking contact');
  assert.ok(samples.some(p=>p.x===t.x&&p.z===t.z&&p.y===t.baseY+90),'wind is sampled at 90 m above each footing');
 }
 // Independent Jensen disk-overlap calculation for the surveyed WT01/WT02
 // wakes at WT03 with due-east 8 m/s flow: coverages .567654976/.505730439,
 // with source streamwise Ct=.8*cos(5 degrees)^3=.7909019841.
 for(const t of farm.turbines){t.ct=.8;t.yaw=-Math.PI/2;}
 app.disasters.field.sample=(x,y,z,out)=>Object.assign(out,{...wind(0),wx:8});farm.update(.05);
 assert.ok(Math.abs(farm.state().turbines[2].wakeFactor-.7456099550497778)<1e-10,'production wake snapshots preserve local hub elevations');
 farm.dispose();assert.equal(scene.children.length,0);
});


test('Shared air samples receive Jensen momentum deficit and bounded zero-mean wake fluctuations',()=>{
 const field=new DisasterField(()=>0);field.ambient=()=>({x:8,z:0});
 const sources=[{id:'source',x:0,z:0,baseY:0,ct:.8,damaged:false,flowX:1,flowZ:0}];let time=0;
 const remove=field.registerAirModifier((x,y,z,air)=>applyWakeToAir(air,x,y,z,sources,time),()=>wakeBounds(sources));
 const raw=field.sampleRaw(630,90,0,{}),expected=8*(1-(1-Math.sqrt(.2))/1.4**2);let sumSide=0,sumVertical=0,squares=0;
 for(let i=0;i<2000;i++) {time=i/2000*(2*Math.PI*18/8)*100;const s=field.sample(630,90,0,{});
  assert.ok(Math.abs(s.wx-expected)<1e-12,'streamwise momentum follows the independent five-diameter Jensen benchmark');
  assert.ok(Math.hypot(s.wx,s.wy,s.wz)<=8,'wake turbulence cannot create more kinetic energy than raw incoming flow');
  assert.equal(s.ax,raw.ax);assert.equal(s.height,raw.height);sumSide+=s.wz;sumVertical+=s.wy;squares+=s.wy*s.wy;
 }
 assert.ok(Math.abs(sumSide/2000)<1e-12&&Math.abs(sumVertical/2000)<1e-12,'assumed wake fluctuations have zero temporal mean');assert.ok(squares/2000>.01,'downstream vertical fluctuations are actually present');
 assert.equal(field.sample(630,90,300,{}).wx,8);assert.equal(field.sample(630,260,0,{}).wx,8);assert.equal(field.sample(1300,90,0,{}).wx,8);
 assert.deepEqual(field.sampleRaw(630,90,0,{}),raw,'raw air remains available to the rotor solver without recursion');
 remove();assert.equal(field.airModifiers.size,0);assert.equal(field.sample(630,90,0,{}).wx,8);
});

test('Operating farm registers the shared wake, slows downstream rotors and cleans up its flow modifier',async()=>{
 const terrain={heightAt:()=>10},field=new DisasterField(terrain.heightAt);field.ambient=()=>({x:8,z:0});
 const scene=new Group(),colliders=new Colliders();const app={scene,colliders,terrainData:terrain,disasters:{paused:false,field,registerExternal:()=>()=>{}},rally:{refreshIslandColliders(){}}};
 const farm=await new WindFarm(app).init({panel:false});
 for(let i=0;i<3000;i++)farm.update(.05);
 const first=farm.turbines[0],p={x:first.x+630,y:first.baseY+90,z:first.z},raw=field.sampleRaw(p.x,p.y,p.z,{}),air=field.sample(p.x,p.y,p.z,{});
 assert.ok(air.wx<raw.wx-1,'actual WindFarm registration removes shared downstream streamwise momentum');
 assert.ok(Math.hypot(air.wx,air.wy,air.wz)<8);assert.equal(field.airModifiers.size,1);
 assert.ok(first.electricalPower>1e6);assert.ok(farm.turbines[1].electricalPower<first.electricalPower*.95,'wake-fed downstream rotor converts less power');
 const before=farm.visuals[0].rotor.rotation.z;farm.update(.05);assert.notEqual(farm.visuals[0].rotor.rotation.z,before,'physical rotor velocity turns the actual mesh');
 farm.enabled=false;for(let i=0;i<400;i++)farm.update(.05);
 const stoppedAir=field.sample(p.x,p.y,p.z,{});assert.ok(stoppedAir.wx>air.wx,'feathering reduces momentum extraction and the shared wake weakens');
 assert.equal(farm.state().electricalPower,0);
 farm.dispose();assert.equal(field.airModifiers.size,0);assert.deepEqual(field.sample(p.x,p.y,p.z,{}),field.sampleRaw(p.x,p.y,p.z,{}));
});
