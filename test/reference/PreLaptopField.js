// Frozen pre-optimization numerical reference.
import { GRAVITY, AIR_DENSITY, SEA_WATER_DENSITY, quadraticDrag, buoyancy as lift } from '../../src/physics/Loads.js';
import { WaterGrid } from './PreLaptopWaterGrid.js';
// Deterministic, bounded game-scale disaster fields. SI units throughout.
// Nonlinear shallow water and a Rankine-like vortex, not a 3D CFD/seismology solver.
export const DEFAULTS = Object.freeze({earthquake:{intensity:0.7,radius:160,duration:25,speed:180,frequency:2,width:55,direction:0,x:40,z:-115},tsunami:{warningLead:90,intensity:10,radius:220,duration:60,speed:18,frequency:2,width:55,direction:-90,x:40,z:-25},tornado:{intensity:65,radius:100,duration:60,speed:3,frequency:2,width:55,direction:0,x:40,z:-115}});
export const LIMITS = {intensity:{earthquake:[0.05,2],tsunami:[0.5,3000],tornado:[5,120]},warningLead:[3,300],radius:[20,400],duration:[3,180],speed:{earthquake:[60,600],tsunami:[3,50],tornado:[0,15]},frequency:[0.2,8],width:[15,160],direction:[-180,180],x:[-950,950],z:[-950,950]};
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
export const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
export function validate(kind,config) {
 if(!DEFAULTS[kind]) return 'Choose a disaster type.';
 for(const key of Object.keys(DEFAULTS[kind])) {
  const limits=LIMITS[key][kind]||LIMITS[key], v=config[key];
  if(!Number.isFinite(v)||v<limits[0]||v>limits[1])return `${key==='intensity'?'Intensity':key} must be ${limits[0]} to ${limits[1]}.`;
 }
 return '';
}
export class DisasterField {
 constructor(terrain=()=>-20){this.terrain=terrain;this.events=new Map();this.airModifiers=new Set();this.time=0;this.paused=false;}
 registerAirModifier(fn,bounds,workerSnapshot){const entry={fn,bounds,workerSnapshot};this.airModifiers.add(entry);return()=>this.airModifiers.delete(entry);}
 sample(x,y,z,out={}){const s=this.sampleRaw(x,y,z,out),air={wx:s.wx,wy:s.wy,wz:s.wz};for(const entry of this.airModifiers){const bounds=typeof entry.bounds==='function'?entry.bounds():entry.bounds;if(entry.bounds&&!bounds)continue;if(bounds&&(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ))continue;entry.fn(x,y,z,air);}s.wx=air.wx;s.wy=air.wy;s.wz=air.wz;return s;}
 start(kind,config={}){const c={...DEFAULTS[kind],...config};const error=validate(kind,c);if(error)throw new RangeError(error);if(!this.events.size)this.time=0;this.events.set(kind,{...c,kind,time:0});if((kind==='tsunami'||kind==='tornado')&&!this.water)this.water=new WaterGrid(this.terrain,{n:257,dx:8,x:0,z:0});if(kind==='tsunami'){const e=this.events.get(kind);e.warning=c.warningLead;e.launched=false;e.launchDistance=Math.max(120,c.width*2.2);const a=c.direction*Math.PI/180,depth=Math.max(1,-this.terrain(c.x-Math.cos(a)*e.launchDistance,c.z-Math.sin(a)*e.launchDistance));e.phaseSpeed=3*Math.sqrt(9.81*(depth+c.intensity))-2*Math.sqrt(9.81*depth);e.arrival=e.warning+e.launchDistance/e.phaseSpeed;}return this.events.get(kind);}
 stop(){this.events.clear();this.water=null;}
 reset(){this.stop();this.time=0;this.paused=false;}
 advance(dt){if(this.paused||!this.events.size||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,0.1);this.time+=dt;for(const [k,e] of this.events){e.time+=dt;if(k==='tsunami'&&e.time>=e.warning&&!e.launched){this.water.launch(e);e.launched=true;}if(e.time>=e.duration+(k==='tsunami'?e.warning:0)){this.events.delete(k);}}if(this.water){if(!this.events.has('tsunami')&&!this.events.has('tornado')){this.water=null;return;}this.applySurfaceWind();this.water.advance(dt);const e=this.events.get('tsunami');if(e?.launched&&!e.coastReached&&this.water.stats.inundatedArea>0){e.coastReached=true;e.firstImpact=e.time;}}}
 applySurfaceWind(){
  const grid=this.water;if(!grid)return;const n=grid.n,ambient=this.ambient?.()??{x:0,z:0};grid.wind??={x:new Float32Array(n*n),z:new Float32Array(n*n)};grid.wind.x.fill(ambient.x);grid.wind.z.fill(ambient.z);
  const e=this.events.get('tornado');if(e){const c=this.center(e),env=this.envelope(e),core=e.radius*.18;
  const loX=Math.max(0,Math.floor((c.x-e.radius-grid.x)/grid.dx)),hiX=Math.min(n-1,Math.ceil((c.x+e.radius-grid.x)/grid.dx)),loZ=Math.max(0,Math.floor((c.z-e.radius-grid.z)/grid.dx)),hiZ=Math.min(n-1,Math.ceil((c.z+e.radius-grid.z)/grid.dx));
  for(let j=loZ;j<=hiZ;j++)for(let i=loX;i<=hiX;i++){const k=j*n+i;if(grid.h[k]<=1e-5)continue;const dx=grid.x+i*grid.dx-c.x,dz=grid.z+j*grid.dx-c.z,r=Math.hypot(dx,dz),safe=Math.max(.1,r),fall=smooth(1-r/e.radius),rank=r<core?r/core:core/safe,w=e.intensity*rank*fall*env;grid.wind.x[k]+=(-dz/safe-dx/safe*.28)*w;grid.wind.z[k]+=(dx/safe-dz/safe*.28)*w;}}
  // Wake modifiers act on this same air field at the water surface. A bounds
  // getter is evaluated once per source per grid update, not once per wet cell.
  const air={wx:0,wy:0,wz:0};for(const entry of this.airModifiers){const b=typeof entry.bounds==='function'?entry.bounds():entry.bounds;if(entry.bounds&&!b)continue;
   const x0=b?Math.max(0,Math.ceil((b.minX-grid.x)/grid.dx)):0,x1=b?Math.min(n-1,Math.floor((b.maxX-grid.x)/grid.dx)):n-1,z0=b?Math.max(0,Math.ceil((b.minZ-grid.z)/grid.dx)):0,z1=b?Math.min(n-1,Math.floor((b.maxZ-grid.z)/grid.dx)):n-1;
   for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){const k=j*n+i;if(grid.h[k]<=1e-5)continue;air.wx=grid.wind.x[k];air.wy=0;air.wz=grid.wind.z[k];entry.fn(grid.x+i*grid.dx,grid.bed[k]+grid.h[k],grid.z+j*grid.dx,air);grid.wind.x[k]=air.wx;grid.wind.z[k]=air.wz;}
  }
 }
 envelope(e){return smooth(e.time/1.2)*smooth((e.duration+(e.kind==='tsunami'?e.warning:0)-e.time)/2);}
 center(e){const a=e.direction*Math.PI/180,travel=e.kind==='tornado'?e.time*e.speed:0;return {x:e.x+Math.cos(a)*travel,z:e.z+Math.sin(a)*travel};}
 waterAt(x,z){return this.water?.sample(x,z).height??0;}
 addImpulse(x,z,radius,strength){return this.water?.addImpulse(x,z,radius,strength)??false;}
 sampleRaw(x,y,z,out={}) {
  out.ax=out.ay=out.az=out.wx=out.wy=out.wz=out.ux=out.uz=out.height=out.shake=0;
  if(!Number.isFinite(x+y+z))return out;
  const ground=this.terrain(x,z);const ambient=this.ambient?.();if(ambient){out.wx=ambient.x;out.wz=ambient.z;}
  for(const e of this.events.values()){
   const env=this.envelope(e); if(env<=0)continue;
   const c=this.center(e),dx=x-c.x,dz=z-c.z,r=Math.hypot(dx,dz),fall=smooth(1-r/e.radius);
   if(e.kind==='earthquake'){
    const t=e.time-r/e.speed;if(t<0||fall===0)continue;
    const a=e.intensity*9.81*fall*env*smooth(t/0.5),phase=t*e.frequency*Math.PI*2;
    out.shake=a; {out.ax+=a*(Math.sin(phase)+0.3*Math.sin(phase*1.73))/1.3;out.az+=a*Math.cos(phase*0.83)*0.8;out.ay+=a*Math.sin(phase*1.3)*0.35;}
   }else if(e.kind==='tornado'&&fall>0){
    const core=e.radius*0.18,safe=Math.max(r,0.1),rank=r<core?r/core:core/safe;
    const w=e.intensity*rank*fall*env*Math.exp(-Math.max(0,y-Math.max(0,ground)-80)/80);
    out.wx+=(-dz/safe-dx/safe*0.28)*w;out.wz+=(dx/safe-dz/safe*0.28)*w;
    out.wy+=e.intensity*0.35*Math.exp(-r*r/(core*core*2))*env;
   }
  }
  if(this.water){const w=this.water.sample(x,z);out.height=w.height;out.ux=w.ux;out.uz=w.uz;}
  return out;
 }
 // Acceleration from loads, with force/mass and projected-area differences. Fluid-relative
 // quadratic drag is bounded to avoid an explicit solver exploding at small debris masses.
 acceleration(p,v,{mass=80,area=0.7,volume=0.08,height=1.8,buoyancy=true,waterDrag=true,supported=false,dt=1/30}={},out={}){
  const s=this.sample(p.x,p.y,p.z,out),ground=this.terrain(p.x,p.z),step=Math.max(1/1000,Math.min(.1,dt));
  mass=Math.max(.05,mass);let ax=supported?s.ax:0,ay=supported?s.ay:0,az=supported?s.az:0;
  // Exact quadratic-drag relaxation for a constant fluid velocity over the load interval.
  // F_raw follows rho Cd A |u-v| (u-v)/2; impulse cannot reverse relative velocity.
  const air={x:s.wx-v.x,y:s.wy-v.y,z:s.wz-v.z},raw=quadraticDrag({},air,{area,dragCoefficient:1.1}),airSpeed=Math.hypot(air.x,air.y,air.z);
  const airRelax=1+step*.5*AIR_DENSITY*1.1*area*airSpeed/mass;
  ax+=raw.x/mass/airRelax;ay+=raw.y/mass/airRelax;az+=raw.z/mass/airRelax;
  const wet=s.height>ground+0.02?clamp((s.height-p.y+height*.5)/height,0,1):0;
  let rawWater=0;
  if(wet>0){
   if(waterDrag){const relative={x:s.ux-v.x-step*raw.x/mass/airRelax,y:0,z:s.uz-v.z-step*raw.z/mass/airRelax};
   const water=quadraticDrag({},relative,{density:SEA_WATER_DENSITY,area:area*wet}),speed=Math.hypot(relative.x,relative.z),waterRelax=1+step*.5*SEA_WATER_DENSITY*area*wet*speed/mass;
   ax+=water.x/mass/waterRelax;az+=water.z/mass/waterRelax;rawWater=Math.hypot(water.x,water.z);}
   if(buoyancy)ay+=lift(volume*wet)/mass-v.y*wet*2;
  }
  const length=Math.hypot(ax,ay,az),k=length>45?45/length:1;s.rawAcceleration=length;s.rawDragForce=Math.hypot(raw.x,raw.y,raw.z)+rawWater;s.limited=k<1;s.ax=ax*k;s.ay=ay*k;s.az=az*k;s.wet=wet;return s;
 }
}
