import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {Quaternion,Vector3} from '../src/engine/index.js';
await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const config=[{mass:1250,I:[1550,1850,600]},{mass:2100,I:[3500,4200,1600]}];
const energy=(a,kind,U=[0,0,0])=>{const c=config[kind],q=new Quaternion().fromArray(a,3),w=new Vector3().fromArray(a,10).applyQuaternion(q.invert());return .5*c.mass*((a[7]-U[0])**2+(a[8]-U[1])**2+(a[9]-U[2])**2)+.5*(c.I[0]*w.x*w.x+c.I[1]*w.y*w.y+c.I[2]*w.z*w.z);};
for(const kind of [0,1])test(`Native vehicle${kind} approaches extreme shared currents without quadratic drag runaway`,()=>{
 for(const current of [100,250,400]){const s=new RallyPhysics();try{s.select_vehicle(kind);s.reset(0,10,0,.43);s.set_water(3000,0,0,0,0,0);s.set_fluid_velocity(current,0,0,current,0);const initial=energy(s.disaster_car_state(),kind,[current,0,0]);let peak=initial;
  for(let i=0;i<240;i++){s.advance(1/120,0,0,0,0);const a=Array.from(s.disaster_car_state());assert.ok(a.every(Number.isFinite));const E=energy(a,kind,[current,0,0]);peak=Math.max(peak,E);assert.ok(E<initial*1.03+5000,`current${current}, step${i}: energy${E} from${initial}; v=${a.slice(7,10)}, spin=${a.slice(10,13)}`);}
  const a=s.disaster_car_state();assert.ok(Math.abs(a[7]-current)<current*.12+2,`car must actually advect with current: ${a[7]}`);assert.ok(energy(a,kind,[current,0,0])<initial*.02+5000);console.log(JSON.stringify({kind,current,initialEnergy:initial,peakEnergy:peak,endVelocity:Array.from(a.slice(7,10))}));
 }finally{s.free();}}
});
test('Shipped vehicle fluid response preserves common translation and accepted-frame subdivision',()=>{
 const run=(U,dt)=>{const s=new RallyPhysics();try{s.reset(0,10,0,.43);const a=Array.from(s.disaster_car_state());a.splice(7,6,170+U[0],20+U[1],-130+U[2],2,-3,5);s.restore_disaster_car(new Float32Array(a));s.set_water(3000,0,0,0,0,0);s.set_fluid_velocity(...U,U[0],U[2]);for(let t=0;t<.2-1e-8;t+=dt)s.advance(dt,0,0,0,0);const b=Array.from(s.disaster_car_state());assert.ok(b.every(Number.isFinite));return [...b.slice(7,10).map((x,i)=>x-U[i]),...b.slice(10,13),...b.slice(3,7)];}finally{s.free();}};
 const base=run([0,0,0],1/120),moving=run([70,0,-35],1/120),long=run([0,0,0],.1);for(let i=0;i<base.length;i++){assert.ok(Math.abs(base[i]-moving[i])<.002,`Galilean component${i}: ${base[i]} vs${moving[i]}`);assert.ok(Math.abs(base[i]-long[i])<.002,`subdivision component${i}: ${base[i]} vs${long[i]}`);}
});
