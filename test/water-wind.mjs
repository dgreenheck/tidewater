import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {DisasterField} from '../src/disasters/Field.js';
import {AIR_DENSITY,SEA_WATER_DENSITY} from '../src/physics/Loads.js';

const near=(a,b,tolerance,label='')=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} versus ${b}, tolerance ${tolerance}`);
const wind=(grid,x,z)=>{grid.wind={x:new Float32Array(grid.h.length).fill(x),z:new Float32Array(grid.h.length).fill(z)};};

test('Surface stress: uniform flat-water momentum and work match exact quadratic relaxation',()=>{
 const depth=10,dt=.02,ux=12,uz=5,w=new WaterGrid(()=>-depth,{n:17,dx:8,sponge:false,friction:false});
 wind(w,ux,uz);const volume=w.volume(),area=w.h.length*w.dx*w.dx;
 // du/dt = rho_air Cd/(rho_water h) |U-u| (U-u), with fixed air U.
 const k=dt*AIR_DENSITY*.0015*Math.hypot(ux,uz)/(SEA_WATER_DENSITY*depth);
 const expectedX=ux*k/(1+k),expectedZ=uz*k/(1+k);
 w.step(dt);
 for(let i=0;i<w.h.length;i++){near(w.qx[i]/w.h[i],expectedX,1e-14);near(w.qz[i]/w.h[i],expectedZ,1e-14);}
 near(w.stats.windImpulseX,SEA_WATER_DENSITY*depth*expectedX*area,1e-8,'x impulse, N s');
 near(w.stats.windImpulseZ,SEA_WATER_DENSITY*depth*expectedZ*area,1e-8,'z impulse, N s');
 near(w.stats.windWork,.5*SEA_WATER_DENSITY*depth*(expectedX**2+expectedZ**2)*area,1e-10,'work, J');
 near(w.volume(),volume,0);assert.equal(w.stats.massAdded,0);assert.equal(w.stats.positivityCorrection,0);
});

test('Surface stress: still lakes and dry land receive no momentum, co-moving fluid has zero local stress',()=>{
 const lake=new WaterGrid((x,z)=>x<0?-4+.001*z:-10,{n:17,dx:8,sponge:false,friction:false});
 wind(lake,0,0);const old=lake.h.slice();for(let i=0;i<100;i++)lake.advance(.02);
 assert.deepEqual(lake.h,old);assert.ok(lake.qx.every(v=>Math.abs(v)<1e-12));assert.ok(lake.qz.every(v=>Math.abs(v)<1e-12));near(lake.stats.windWork,0,1e-24);near(lake.stats.windImpulseX,0,1e-15);
 const dry=new WaterGrid(()=>2,{n:17,dx:8,sponge:false});wind(dry,120,-120);dry.advance(.1);
 assert.ok(dry.h.every(v=>v===0));assert.ok(dry.qx.every(v=>v===0));assert.equal(dry.stats.windImpulseX,0);assert.equal(dry.stats.windWork,0);
 const moving=new WaterGrid(()=>-10,{n:17,dx:8,sponge:false,friction:false});wind(moving,4,2);moving.qx.fill(40);moving.qz.fill(20);moving.step(.02);
 // Reflecting outer walls perturb the edge. The interior is exactly uniform and
 // has no hydrodynamic gradient; only a spurious relative-wind law could alter it.
 const centre=8*moving.n+8;near(moving.qx[centre],40,0);near(moving.qz[centre],20,0);
});

test('Surface stress: thin wet-cell integration cannot overshoot the air or create water',()=>{
 const depth=.0001,w=new WaterGrid(()=>-depth,{n:17,dx:8,sponge:false,friction:false});wind(w,120,0);const volume=w.volume();w.step(.1);
 const k=.1*AIR_DENSITY*.0015*120/(SEA_WATER_DENSITY*depth),expected=120*k/(1+k);
 for(let i=0;i<w.h.length;i++){near(w.qx[i]/w.h[i],expected,1e-12);assert.ok(w.qx[i]/w.h[i]<120);assert.ok(w.h[i]>0);}
 near(w.volume(),volume,0);assert.equal(w.stats.positivityCorrection,0);assert.ok(Number.isFinite(w.stats.windWork));
});

test('Tornado air field drives the shared production water grid and sampled current without a volume source',()=>{
 const field=new DisasterField(()=>-10);field.ambient=()=>({x:3,z:-1});field.start('tornado',{x:0,z:0,intensity:90,radius:180,speed:0});
 assert.equal(field.water.n,257);const initial=field.water.volume();for(let i=0;i<13;i++)field.advance(.1);
 const w=field.water,i=132,j=128,k=j*w.n+i,x=w.x+i*w.dx,z=w.z+j*w.dx,s=field.sample(x,0,z);
 near(w.wind.x[k],s.wx,1e-5);near(w.wind.z[k],s.wz,1e-5);assert.ok(Math.hypot(s.ux,s.uz)>.0001);
 near(s.ux,w.pixels[k*4+1],1e-12);near(s.uz,w.pixels[k*4+2],1e-12);
 near(w.volume()-initial+w.stats.boundaryVolume,0,1e-5);assert.equal(w.stats.massAdded,0);assert.equal(w.stats.positivityCorrection,0);assert.equal(w.stats.droppedTime,0);assert.ok(w.stats.cfl<=.45+1e-12);assert.ok(w.stats.windWork>0);
 field.start('tsunami',{warningLead:3,intensity:2});assert.equal(field.water,w,'simultaneous hazards share one solver');field.stop();assert.equal(field.water,null);
});

test('Bounded air modifiers affect shared body and water air samples, preserve other fields, and dispose cleanly',()=>{
 const field=new DisasterField(()=>-10);field.ambient=()=>({x:10,z:2});field.start('tsunami',{warningLead:90});
 const detach=field.registerAirModifier((x,y,z,air)=>{air.wx*=.5;air.wz*=.25;air.height=99;air.ax=123;},()=>({minX:-20,maxX:20,minZ:-20,maxZ:20}));
 const raw=field.sampleRaw(0,0,0),changed=field.sample(0,0,0);near(raw.wx,10,0);near(raw.wz,2,0);near(changed.wx,5,0);near(changed.wz,.5,0);near(changed.height,raw.height,0);near(changed.ax,raw.ax,0);near(field.sample(80,0,0).wx,10,0);
 field.advance(.02);const w=field.water,k=128*w.n+128;near(w.wind.x[k],5,0);near(w.wind.z[k],.5,0);near(field.sample(0,0,0).ux,w.pixels[k*4+1],0);
 detach();near(field.sample(0,0,0).wx,10,0);field.advance(.02);near(w.wind.x[k],10,0);
 const disabled=field.registerAirModifier((x,y,z,air)=>{air.wx=0;},()=>null);near(field.sample(0,0,0).wx,10,0);disabled();
});
