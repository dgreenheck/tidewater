import {test} from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import init,{RallyPhysics}from'../public/rally/rally_physics.js';import{DisasterField}from'../src/disasters/Field.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const advance=(sim,t)=>{for(let i=0;i<Math.round(t*120);i++)sim.advance(1/120,0,0,0,0);};
const body=(sim,id,mass,x=0)=>sim.wake_prop(id,0,new Float32Array([.5,.5,.5]),new Float32Array([x,100,0,0,0,0,1,0,0,0]),mass,0,0,false);
const motion=(sim,id)=>{const a=sim.disaster_motion();for(let i=0;i<a.length;i+=7)if(a[i]===id)return Array.from(a.slice(i+1,i+7));};
test('Shipped Avian: equal applied force yields inverse-mass acceleration and stop removes stale loads',()=>{
 const sim=new RallyPhysics();try{body(sim,31,10,-10);body(sim,32,20,10);assert.equal(sim.set_disaster_loads(new Float32Array([31,100,0,0,0,0,0,32,100,0,0,0,0,0])),true);advance(sim,.5);const a=motion(sim,31),b=motion(sim,32);assert.ok(Math.abs(a[3]-5)<.15);assert.ok(Math.abs(a[3]/b[3]-2)<.01);sim.set_disaster_loads(new Float32Array());advance(sim,.5);assert.ok(Math.abs(motion(sim,31)[3]-a[3])<.01);assert.equal(sim.set_disaster_loads(new Float32Array([31,NaN,0,0,0,0,0])),false);}finally{sim.free();}
});
test('Shipped Avian: clearing island statics removes actual wall collision and preserves terrain',()=>{
 const sim=new RallyPhysics();try{sim.set_terrain(new Float32Array(25),5,200,-100);sim.reset(0,.45,0,0);sim.add_boxes(new Float32Array([0,2,12,8,2,.5,0,.65]));for(let i=0;i<600;i++)sim.advance(1/120,1,0,0,0);assert.ok(sim.snapshot()[2]<10);sim.clear_island_statics();for(let i=0;i<360;i++)sim.advance(1/120,1,0,0,0);assert.ok(sim.snapshot()[2]>20);assert.ok(sim.snapshot()[1]>-.2);}finally{sim.free();}
});
test('Shipped Avian: held tsunami drag forces cannot add horizontal kinetic energy to light debris',()=>{
 for(const dt of [1/60,1/30,.1]){const sim=new RallyPhysics(),field=new DisasterField(()=>-1);field.start('tsunami');field.advance(.1);try{sim.wake_prop(91,0,new Float32Array([.2,.2,.2]),new Float32Array([0,100,0,0,0,0,1,.1,0,0]),.5,0,0,false);let prev=.5*.5*.1*.1;
  for(let j=0;j<20;j++){const state=motion(sim,91),a=field.acceleration({x:0,y:0,z:0},{x:state[3],y:0,z:state[5]},{mass:.5,area:4,height:1,buoyancy:false,dt});sim.set_disaster_loads(new Float32Array([91,.5*a.ax,0,.5*a.az,0,0,0]));advance(sim,dt);const v=motion(sim,91)[3],energy=.5*.5*v*v;assert.ok(energy<=prev+1e-9,`${dt}: ${energy}>${prev}`);assert.ok(v>=-1e-7);prev=energy;}
 }finally{sim.free();}}
});

test('Shipped Avian support observes ground and a load-bearing stack, excluding a hovering neighbour',()=>{const sim=new RallyPhysics();try{sim.set_terrain(new Float32Array(25),5,200,-100);const spawn=(id,x,y)=>sim.wake_prop(id,0,new Float32Array([.5,.5,.5]),new Float32Array([x,y,0,0,0,0,1,0,0,0]),10,.6,0,false);spawn(201,-10,.5);spawn(202,10,.6);spawn(203,-10,1.5);sim.set_disaster_loads(new Float32Array([202,0,98.1,0,0,0,0]));advance(sim,2);const supported=new Set(sim.disaster_supported());assert.ok(supported.has(201));assert.ok(supported.has(203));assert.ok(!supported.has(202));assert.ok(Math.abs(motion(sim,202)[1]-.6)<1e-5);}finally{sim.free();}});

test('Shipped Avian disaster restoration preserves full car pose and velocity',()=>{const sim=new RallyPhysics();try{const a=.17,b=.31,c=-.12,d=Math.sqrt(1-a*a-b*b-c*c),saved=new Float32Array([12,5,-3,a,b,c,d,4,1,-2,.3,.2,.1]);assert.equal(sim.restore_disaster_car(saved),true);const round=sim.disaster_car_state();round.forEach((v,i)=>assert.ok(Math.abs(v-saved[i])<1e-6));advance(sim,.1);assert.notDeepEqual(Array.from(sim.disaster_car_state()),Array.from(saved));sim.restore_disaster_car(saved);sim.disaster_car_state().forEach((v,i)=>assert.ok(Math.abs(v-saved[i])<1e-6));}finally{sim.free();}});

test('Shipped car column-water and aerodynamic loads are invariant under equal body/fluid translation',()=>{
 const run=(translation,wet)=>{const sim=new RallyPhysics();try{
  sim.restore_disaster_car(new Float32Array([0,wet?-.7:100,0,0,0,0,1,translation[0]+.7,0,translation[1]-.3,0,0,0]));
  sim.set_water(wet?0:NaN,0,0,0,0,0);
  // The former shipped module has no flow API; executing it still exposes the
  // actual old still-fluid force law as the negative physical baseline.
  sim.set_fluid_velocity?.(translation[0],0,translation[1],translation[0],translation[1]);
  advance(sim,.1);if(wet)assert.ok(sim.snapshot()[73]>.1,'actual water columns are submerged');const state=Array.from(sim.disaster_car_state());state[7]-=translation[0];state[9]-=translation[1];return state;
 }finally{sim.free();}};
 for(const wet of [false,true]){const still=run([0,0],wet),translated=run([4,2],wet);for(const i of [1,3,4,5,6,7,8,9,10,11,12])assert.ok(Math.abs(still[i]-translated[i])<2e-5,`${wet?'water':'air'} component ${i}: ${still[i]} versus ${translated[i]}`);}
});

test('Shipped debris spirals, lifts according to mass and leaves the vortex with physical momentum',()=>{
 const run=mass=>{const sim=new RallyPhysics(),field=new DisasterField(()=>0),rows=[];try{
  sim.set_terrain(new Float32Array(25),5,400,-200);field.start('tornado',{x:0,z:0,intensity:100,radius:100,speed:0});for(let i=0;i<12;i++)field.advance(.1);
  sim.wake_prop(77,0,new Float32Array([.5,.5,.5]),new Float32Array([20,40,0,0,0,0,1,0,0,0]),mass,0,0,false);
  for(let frame=0;frame<150;frame++){
   if(frame===120)field.stop();field.advance(1/30);const b=motion(sim,77),a=field.acceleration({x:b[0],y:b[1],z:b[2]},{x:b[3],y:b[4],z:b[5]},{mass,area:.7,volume:0,height:1,buoyancy:false,supported:false,dt:1/30});
   sim.set_disaster_loads(new Float32Array([77,mass*a.ax,mass*a.ay,mass*a.az,0,0,0]));advance(sim,1/30);if([29,59,119,149].includes(frame))rows.push(motion(sim,77));
  }return rows;
 }finally{sim.free();}};
 const light=run(40),heavy=run(400);
 assert.ok(light[0][2]>heavy[0][2]*3,'lower mass gains tangential speed faster at equal exposed area');
 assert.ok(light[0][1]>40.4&&heavy[0][1]<39,'the light body lifts while the heavy body falls');
 assert.ok(Math.atan2(light[1][2],light[1][0])>1.7,'observed solver trajectory has rotated around the core');
 assert.ok(Math.hypot(light[2][0],light[2][2])>70,'the trajectory expands, it is not constrained to an orbit');
 assert.ok(Math.hypot(light[3][0],light[3][2])>Math.hypot(light[2][0],light[2][2])+10,'stop removes vortex forcing but retains outgoing body momentum');
 assert.ok(light.flat().every(Number.isFinite));assert.ok(heavy.flat().every(Number.isFinite));
});
