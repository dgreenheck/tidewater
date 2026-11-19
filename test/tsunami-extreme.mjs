import test from 'node:test';
import assert from 'node:assert/strict';
import {DisasterField,DEFAULTS,validate} from '../src/disasters/Field.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
const crest=3000,flat=()=>-20;
const max=a=>a.reduce((m,x)=>Math.max(m,x),-Infinity);

test('Production tsunami accepts a3000m crest without scaling and shares full257-grid height/current with all field consumers',()=>{
 const config={...DEFAULTS.tsunami,intensity:crest,warningLead:3,x:0,z:0,direction:0,width:55,radius:180,duration:12};
 assert.equal(validate('tsunami',config),'','the requested crest must be accepted explicitly');
 // A 3000 m wall comes in from beyond the ring first: the solver takes it at e.launchTime.
 const field=new DisasterField(flat),e=field.start('tsunami',config);while(field.time+.1<e.launchTime-1e-9)field.advance(.1);assert.ok(e.launchTime>=config.warningLead+25,`the wall reaches the ring ${e.launchTime} s in`);assert.ok(max(field.water.h)<21&&max(field.outer.h)<21,'the solver must not take the wall before it reaches the ring');while(!e.launched)field.advance(.1);
 assert.equal(field.water.n,257);assert.equal(field.water.dx,8);
 // The source now starts in the 8 km outer ring (the approach), where the crest must stand at full height.
 assert.ok(max(field.outer.h)>crest*.8,'physical source amplitude must not be secretly clamped');
 {const D=field.events.get('tsunami').launchDistance,water=field.outer.sample(-D,0),sample=field.sample(-D,water.height*.5,0);assert.ok(water.height>crest*.8,'the field samples the outer ring at the source');assert.equal(sample.height,water.height);assert.equal(field.waterAt(-D,0),water.height);}
 for(const [x,z]of [[-120,0],[-80,0],[-40,15]]){const water=field.water.sample(x,z),sample=field.sample(x,water.height*.5,z);assert.equal(sample.height,water.height);assert.equal(field.waterAt(x,z),water.height);assert.equal(sample.ux,water.ux);assert.equal(sample.uz,water.uz);}
});

test('Extreme257-grid wet/dry inundation advances the whole accepted interval with bounded CFL, finite conserved fields and useful current',()=>{
 const terrain=(x,z)=>x<0?-20:Math.min(120,x*.4),w=new WaterGrid(terrain,{n:257,dx:8,sponge:true});w.launch({x:0,z:0,direction:0,intensity:crest,width:55,radius:180,launchDistance:121});
 let maxCurrent=0,maxCharacteristicSpeed=0;const start=performance.now();for(let i=0;i<20;i++){w.advance(.1);assert.ok(w.stats.cfl<=.45+1e-10);assert.ok(w.h.every(v=>Number.isFinite(v)&&v>=0));assert.ok(w.qx.every(Number.isFinite)&&w.qz.every(Number.isFinite));maxCharacteristicSpeed=Math.max(maxCharacteristicSpeed,w.stats.maxSpeed);for(let j=0;j<w.h.length;j++)if(w.h[j]>1e-4)maxCurrent=Math.max(maxCurrent,Math.hypot(w.qx[j],w.qz[j])/w.h[j]);}
 assert.ok(Math.abs(w.time-2)<1e-9);assert.equal(w.stats.droppedTime,0);assert.equal(w.stats.positivityCorrection,0);assert.ok(w.stats.inundatedArea>0);assert.ok(maxCurrent>150);
 const residual=w.volume()-w.initialVolume-w.stats.massAdded+w.stats.boundaryVolume-w.stats.positivityCorrection;assert.ok(Math.abs(residual)<1e-4,`unaccounted volume ${residual}`);console.log(JSON.stringify({extremeGrid:true,steps:w.stats.steps,time:w.time,wallMs:performance.now()-start,maxCurrent,maxCharacteristicSpeed,residual}));
});

// Replay the sampled event seed to compare wave behaviour across runs.
test('Extreme source pause/reset removes the shared field and permits deterministic replay',()=>{
 const field=new DisasterField(flat),config={intensity:crest,warningLead:3,duration:12};const first=field.start('tsunami',config),steps=Math.ceil((first.launchTime+.5)/.1);for(let i=0;i<steps;i++)field.advance(.1);const old=field.water.h.slice(),t=field.time;field.paused=true;field.advance(.1);assert.equal(field.time,t);assert.deepEqual(field.water.h,old);field.reset();assert.equal(field.water,null);assert.equal(field.waterAt(0,0),0);field.start('tsunami',{...config,seed:first.seed});for(let i=0;i<steps;i++)field.advance(.1);assert.deepEqual(field.water.h,old);
});

import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
test('The actual3000m field supplies both current impulse and submerged buoyancy to shipped native bodies',()=>{
 const sim=new RallyPhysics(),field=new DisasterField(flat);try{sim.reset(200,10,200,0);field.start('tsunami',{x:0,z:0,intensity:crest,warningLead:3,duration:12,direction:0,width:55,radius:180});const e=field.events.get('tsunami');while(!e.launched)field.advance(.1);const D=e.launchDistance; // the crest sits at the planned source (after the far-field approach)
  for(const id of [9101,9102])assert.ok(sim.wake_prop(id,0,new Float32Array([1,.5,.6]),new Float32Array([-D,10,id===9101?-3:3,0,0,0,1]),800,.6,.02,false));
  let lift=0,drag=0;for(let k=0;k<4;k++){const motion=sim.disaster_motion(),loads=[];for(let i=0;i<motion.length;i+=7){const id=motion[i];if(id<9101)continue;const p={x:motion[i+1],y:motion[i+2],z:motion[i+3]},v={x:motion[i+4],y:motion[i+5],z:motion[i+6]},s=field.acceleration(p,v,{mass:800,area:id===9101?0:5,volume:2,height:1,buoyancy:id===9101,dt:.1},{});assert.ok(s.height>100,'body queries use the full physical surface');lift=Math.max(lift,s.ay*800);drag=Math.max(drag,Math.hypot(s.ax,s.az)*800);loads.push(id,s.ax*800,s.ay*800,s.az*800,0,0,0);}sim.set_disaster_loads(new Float32Array(loads));sim.advance(.1,0,0,0,0);field.advance(.1);}
  const p=sim.prop_poses(),rows=[];for(let i=0;i<p.length;i+=10)rows.push(Array.from(p.slice(i,i+10)));const floating=rows.find(p=>p[0]===9101),advected=rows.find(p=>p[0]===9102);assert.ok(lift>20000);assert.ok(drag>10000);assert.ok(floating[2]>10.8,`buoyant native height ${floating[2]}`);assert.ok(advected[1]>-D+3,`current-driven native x ${advected[1]}`);assert.ok(rows.flat().every(Number.isFinite));
 }finally{sim.free();}
});
