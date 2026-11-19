import {test} from 'node:test';
import {tornadoMotionParams} from '../src/disasters/TornadoMotion.js'; // steady track for the exact translation check
import assert from 'node:assert/strict';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {DisasterField,DEFAULTS,validate} from '../src/disasters/Field.js';
import {STRENGTHS,structure,STRUCTURES,StructuralDamage} from '../src/disasters/Structures.js';
import {Vector3,Quaternion} from '../src/engine/index.js';
import {TerrainData} from '../src/world/TerrainData.js';
const advance=(w,seconds,dt=1/60)=>{for(let t=0;t<Math.round(seconds/dt);t++)w.advance(dt);};
const near=(a,b,tol,msg='')=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b} ±${tol}`);

test('Shallow water: stepped/sloping lake and emerged island remain exactly at rest',()=>{
 const w=new WaterGrid((x,z)=>Math.abs(x)<5&&Math.abs(z)<5?3:x<0?-10+.01*z:-3+.01*z,{n:41,dx:2,sponge:false});const initial=w.h.slice(),volume=w.volume();advance(w,8);
 near(w.volume(),volume,1e-8);assert.deepEqual(w.h,initial);assert.ok(w.qx.every(x=>Math.abs(x)<1e-12));assert.ok(w.qz.every(x=>Math.abs(x)<1e-12));assert.equal(w.sample(0,0).depth,0);assert.equal(w.stats.positivityCorrection,0);
});
test('Shallow water: source stays in its connected sea, enclosed low basin remains dry of added pulse',()=>{
 const w=new WaterGrid(x=>Math.abs(x)<2?8:-3,{n:49,dx:1,sponge:false});let initial=0;for(let j=0;j<w.n;j++)for(let i=27;i<w.n;i++)initial+=w.h[j*w.n+i];
 w.launch({x:0,z:0,direction:0,intensity:1,width:8,radius:20,launchDistance:12});advance(w,1);let after=0;for(let j=0;j<w.n;j++)for(let i=27;i<w.n;i++)after+=w.h[j*w.n+i];near(after,initial,1e-9);assert.ok(w.h.every(x=>x>=0));
});
test('Shallow water: closed pulse conserves disturbed volume and sponge loss is explicitly budgeted',()=>{
 for(const sponge of [false,true]){const w=new WaterGrid(()=>-10,{n:65,dx:2,sponge});const initial=w.volume();w.launch({x:0,z:0,direction:0,intensity:.5,width:8,radius:30,launchDistance:35});const added=w.stats.massAdded;advance(w,4);near(w.volume()-initial+w.stats.boundaryVolume,added,1e-7);assert.equal(w.stats.positivityCorrection,0);assert.equal(w.stats.droppedTime,0);assert.ok(w.stats.cfl<=.45+1e-9);}
});
test('Shallow water: small pulse speed agrees with sqrt(g h) on three grids',()=>{
 const rows=[];for(const dx of [4,2,1]){const n=Math.round(200/dx)+1,w=new WaterGrid(()=>-10,{n,dx,sponge:false,friction:false});w.launch({x:0,z:0,direction:0,intensity:.001,width:12,radius:1000,launchDistance:50});
  const centroid=()=>{let sum=0,moment=0,j=Math.floor(n/2);for(let i=0;i<n;i++){const eta=Math.max(0,w.h[j*n+i]-10);sum+=eta;moment+=eta*(w.x+i*dx);}return moment/sum;};const x0=centroid();advance(w,2);const speed=(centroid()-x0)/2;near(speed,Math.sqrt(98.1),.12,`dx=${dx}`);rows.push({dx,speed});}
 console.log('SWE wave speed benchmark',rows);
});
test('Shallow water: Ritter dry-bed dam-break profile converges and preserves positivity',()=>{
 const errors=[];for(const dx of [2,1,.5]){const n=Math.round(80/dx)+1,w=new WaterGrid(()=>0,{n,dx,sponge:false,friction:false});for(let j=0;j<n;j++)for(let i=0;i<n;i++)w.h[j*n+i]=w.x+i*dx<0?4:0;w.pack();const volume=w.volume();advance(w,1);let error=0,count=0;const c=Math.sqrt(9.81*4);
  for(let i=0;i<n;i++){const x=w.x+i*dx;if(x< -10||x>16)continue;const exact=x< -c?4:x>2*c?0:(2*c-x)**2/(9*9.81);error+=Math.abs(w.h[Math.floor(n/2)*n+i]-exact);count++;}errors.push(error/count);near(w.volume(),volume,1e-6);assert.ok(w.h.every(x=>x>=0));assert.equal(w.stats.positivityCorrection,0);}
 assert.ok(errors[1]<errors[0]&&errors[2]<errors[1]);assert.ok(errors[2]<.11);console.log('Ritter mean absolute depth error, m, dx2/1/.5',errors);
});
test('Water displacement conserves volume and CPU interpolation reproduces packed texture bilinear values',()=>{
 const w=new WaterGrid(()=>-8,{n:33,dx:4,sponge:false});const before=w.volume();assert.equal(w.addImpulse(0,0,12,.1),true);near(w.volume(),before,1e-8);const x=.7,z=1.4,u=(x-w.x)/w.dx,v=(z-w.z)/w.dx,i=Math.floor(u),j=Math.floor(v),fx=u-i,fz=v-j;
 for(const [channel,key]of ['height','ux','uz','depth'].entries()){const a=w.pixels[(j*w.n+i)*4+channel]*(1-fx)+w.pixels[(j*w.n+i+1)*4+channel]*fx,b=w.pixels[((j+1)*w.n+i)*4+channel]*(1-fx)+w.pixels[((j+1)*w.n+i+1)*4+channel]*fx;near(w.sample(x,z)[key],a*(1-fz)+b*fz,1e-12);}
});
test('Fields validate finite limits, propagate earthquake wavefront and require actual support',()=>{
 assert.match(validate('earthquake',{...DEFAULTS.earthquake,intensity:999}),/Intensity/);const field=new DisasterField(()=>0);field.start('earthquake',{x:0,z:0,intensity:1,radius:200,speed:100});advance(field,.5);assert.equal(field.sample(150,0,0).shake,0);advance(field,1.1);assert.ok(field.sample(150,0,0).shake>0);assert.ok(field.sample(0,0,0).shake>field.sample(150,0,0).shake);
 const p={x:0,y:1,z:0},v={x:0,y:0,z:0};const unsupported=field.acceleration(p,v,{supported:false});near(Math.hypot(unsupported.ax,unsupported.ay,unsupported.az),0,0);const supported=field.acceleration(p,v,{supported:true});assert.ok(Math.hypot(supported.ax,supported.ay,supported.az)>.1);
});
test('Tornado translation, ambient wind and pressure-load mass scaling are measurable',()=>{
 const field=new DisasterField(()=>0);field.ambient=()=>({x:8,z:0});field.start('tornado',{x:0,z:0,speed:2,direction:90,intensity:80});{const e=field.events.get('tornado');e.seed=0;e.motion=tornadoMotionParams(0,0);}advance(field,2);near(field.center(field.events.get('tornado')).z,4,1e-9);assert.equal(field.sample(800,1,800).wx,8);field.stop();
 const p={x:0,y:1,z:0},v={x:0,y:0,z:0},a=field.acceleration(p,v,{mass:100,area:1,dt:.001}),b=field.acceleration(p,v,{mass:200,area:1,dt:.001});near(a.rawDragForce,.5*1.225*1.1*64,1e-10);near(a.ax/b.ax,2,.001);
});
test('Quadratic fluid drag dissipates kinetic energy for light debris across held frame intervals',()=>{
 for(const dt of [1/120,1/60,1/30,.1]){const field=new DisasterField(()=>-1);field.start('tsunami');field.advance(.1);const p={x:0,y:0,z:0},v={x:.1,y:0,z:0};let prev=.5*.5*v.x*v.x;for(let i=0;i<100;i++){const a=field.acceleration(p,v,{mass:.5,area:4,height:1,buoyancy:false,dt});v.x+=a.ax*dt;const energy=.5*.5*v.x*v.x;assert.ok(energy<=prev+1e-15);assert.ok(v.x>=-1e-15);prev=energy;}}
 const still=new DisasterField(()=>0),a=still.acceleration({x:0,y:5,z:0},{x:5,y:0,z:0},{mass:80,area:1,dt:1/60});assert.ok(a.ax<0);
});
test('Pause holds water and event time; stop removes force and reset permits deterministic replay',()=>{
 const field=new DisasterField(()=>-10);field.start('tsunami',{intensity:2,warningLead:3});advance(field,7);const state=field.water.h.slice(),t=field.time;field.paused=true;field.advance(.1);assert.equal(field.time,t);assert.deepEqual(field.water.h,state);field.stop();assert.equal(field.waterAt(0,0),0);field.reset();assert.equal(field.events.size,0);assert.equal(field.time,0);
});

test('Shallow water: a requested source inside an enclosed below-sea basin cannot inject a tsunami into the lake',()=>{
 const w=new WaterGrid((x,z)=>Math.max(Math.abs(x),Math.abs(z))<10?-3:Math.max(Math.abs(x),Math.abs(z))<20?8:-6,{n:49,dx:2,sponge:false,friction:false});
 const lake=[];for(let j=0;j<w.n;j++)for(let i=0;i<w.n;i++)if(Math.abs(w.x+i*w.dx)<10&&Math.abs(w.z+j*w.dx)<10)lake.push([j*w.n+i,w.h[j*w.n+i]]);
 w.launch({x:0,z:0,direction:0,intensity:1,width:8,radius:20,launchDistance:0});
 for(const [cell,before]of lake)near(w.h[cell],before,0,'enclosed basin initial depth');
 assert.ok(w.stats.massAdded>0,'the imposed source still reaches eligible ocean cells');
});

// The 257 x 257 shallow-water grid costs about 12 ms a frame. A tornado over dry land never touches it,
// so it must not start one; the same tornado over the sea still drives surface water (Field.js start).
const island=new TerrainData(),islandHeight=(x,z)=>island.heightAt(x,z);
function islandPoints() {
 let summit={x:0,z:0,y:-Infinity},sea=null;
 for(let z=-960;z<=960;z+=32)for(let x=-960;x<=960;x+=32){
  const y=islandHeight(x,z);
  if(y>summit.y)summit={x,z,y};
  if(!sea&&y<-15&&Math.hypot(x,z)<700)sea={x,z,y};
 }
 return {summit,sea};
}
test('Tornado over land starts no water grid; a tornado over the real sea does',()=>{
 const {summit,sea}=islandPoints();
 assert.ok(summit.y>250,`real island summit found: ${summit.y.toFixed(1)} m`);
 assert.ok(sea,'a real sea point inside the water grid');
 const land=new DisasterField(islandHeight);
 land.start('tornado',{x:summit.x,z:summit.z,radius:100,speed:0});
 assert.equal(land.water??null,null,`tornado on the ${summit.y.toFixed(0)} m summit must not start the water grid`);
 advance(land,.5);
 assert.equal(land.water??null,null,'still no water grid after it runs');
 const wet=new DisasterField(islandHeight);
 wet.start('tornado',{x:sea.x,z:sea.z,radius:60,speed:0});
 assert.ok(wet.water instanceof WaterGrid,`tornado over ${sea.y.toFixed(1)} m of sea keeps its water grid`);
 const tsunami=new DisasterField(islandHeight);
 tsunami.start('tsunami',{x:summit.x,z:summit.z});
 assert.ok(tsunami.water instanceof WaterGrid,'a tsunami always starts the water grid');
});
