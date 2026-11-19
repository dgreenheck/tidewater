import {advanceAerosol} from './AerosolDynamics.js';
import {hash32,STREAM} from './EventRandom.js';
import {PLUME,CLOUD_KERNEL_FRACTION,liquidMass,geometricExtinction,plumeRepresentation,createPlumeBudget,initializePlumeParcel,advancePlumeParcel,retirePlumeParcel,plumeEnvironment,plumeSource,coherentPlumeEddy} from './TornadoPlume.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const random=n=>{let x=Math.imul(n^0x5bd1e995,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;};
const fade=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

// Each aerosol is a statistical cloud of grains/droplets. diameter is the
// physical grain size in metres; size is the metre-scale optical cloud radius.
// The shared DisasterField supplies carrier air (including registered wakes).
export class TornadoParticles {
 constructor(field,{dust=1280,flecks=64,turbulence=true,plume={}}={}){
  this.field=field;this.turbulence=turbulence;this.plume=plume;this.budget=createPlumeBudget();this.completedBudget=null;this.evaporated=0;this._eddy={};this._environment={};this._source={};this.event=null;this.samples=0;this.emitted=0;this.deposited=0;this.expired=0;this.credit=0;this.cursor=0;this.time=0;
  const make=(id,kind)=>({id,kind,cycle:0,active:false,p:{x:0,y:0,z:0},previous:{x:0,y:0,z:0},v:{x:0,y:0,z:0},eddy:{x:0,y:0,z:0},age:0,life:1,rotation:0,previousRotation:0,opacity:0,size:1,previousSize:1});
  this.dust=Array.from({length:dust},(_,i)=>make(i,0));this.flecks=Array.from({length:flecks},(_,i)=>make(i+dust,1));this.all=[...this.dust,...this.flecks];this._sample={};this._air={};this._emissionSample={};this.sourceSamples=0;
 }
 clear(){this.event=null;this.budget=createPlumeBudget();this.completedBudget=null;this.evaporated=0;this.sourceSamples=0;this.samples=this.emitted=this.deposited=this.expired=this.credit=this.cursor=this.time=0;for(const p of this.all){p.active=false;p.opacity=0;if(!p.kind){p.number=0;p.cloudMass=0;p.extinctionArea=0;}}}
 complete(){for(const p of this.dust)if(p.active)retirePlumeParcel(p,'exported',this.budget);const budget=this.snapshot().budget;this.clear();this.completedBudget=budget;}
 spawn(p,e,delay=0){
  // Every parcel draw derives from the event's fresh seed (field.center assigns it), so two runs
  // raise different dust and debris; the old id*113+cycle*191 seed was the same every run.
  const c=this.field.center(e),seed=hash32(e.seed??0,STREAM.particles,p.id*4096+(p.cycle++&4095)),rand=k=>random(seed+k*577),s=e.radius/100;
  p.condensation=!p.kind&&p.id%5===4;
  const angle=rand(1)*Math.PI*2,alt=p.condensation?(8+rand(12)*112)*s:0;
  const r=p.condensation?(3.5+alt*.18)*(.45+rand(2)*1.2):e.radius*.18*(.45+rand(2)*1.4);
  p.p.x=c.x+Math.cos(angle)*r;p.p.z=c.z+Math.sin(angle)*r;
  const ground=this.field.terrain(p.p.x,p.p.z),water=this.field.waterAt?.(p.p.x,p.p.z)??0;
  p.water=water>ground+.03;p.material=p.condensation?'condensation':p.water?'mist':'dust';
  p.p.y=Math.max(ground,water)+.18+rand(3)*.7*s+alt;
  p.v.x=p.v.y=p.v.z=0;p.age=-delay;p.life=p.kind?4+rand(4)*5:7+rand(4)*(PLUME.maxLifetime-7);
  const representation=plumeRepresentation(this.dust.length,e.intensity);p.representationWeight=p.kind?1:representation.weight;
  p.baseSize=p.kind?.08+rand(5)*.17:(p.condensation?4.5+rand(5)*4.0+alt*.022/s:1.5+rand(5)*2.4)*s;
  p.initialSize=p.baseSize*(p.kind?1:representation.radiusScale);
  // Unresolved mixing spreads the optical cloud, independently of grain drag.
  // Condensate mixes faster aloft; extinction area is conserved during spread.
  p.diffusivity=(p.condensation?2+rand(13)*2:.8+1.2*rand(13))*s;
  p.size=p.previousSize=p.initialSize;p.extinctionArea=Math.PI*p.baseSize*p.baseSize*(p.condensation?.20:.50)*p.representationWeight;
  // Fine dust, occasional coarser saltating grains, sea spray, and condensate.
  p.diameter=p.condensation?(8+rand(6)*20)*1e-6:p.water?(25+rand(6)*240)*1e-6:(p.id%7===3?(.3+rand(6)*1.2)*1e-3:(12+rand(6)*120)*1e-6);
  p.density=p.water||p.condensation?1000:2600;p.mass=.018+rand(6)*.10;p.area=.007+rand(7)*.028;
  p.seed=rand(8);p.rotation=rand(9)*6.283;p.previousRotation=p.rotation;p.rng=(seed^0x9e3779b9)>>>0;
  p.eddy.x=p.eddy.y=p.eddy.z=0;Object.assign(p.previous,p.p);p.opacity=0;p.active=true;
  if(!p.kind){
   const air=this.field.sample(p.p.x,p.p.y,p.p.z,this._emissionSample);this.sourceSamples++;
   const speed=Math.hypot(air.wx,air.wz),threshold=p.water?12:6;
   const loading=p.condensation?clamp(air.wy/12,0,1):clamp((speed*speed-threshold*threshold)/Math.max(1,(e.intensity*.7)**2-threshold*threshold),0,1);
   const source=p.condensation?plumeSource(p.p,e,c,Math.max(0,this.field.terrain(c.x,c.z)),this._source):{moisture:1,humidity:PLUME.sourceHumidity,loading:1};
   p.sourceMoisture=source.moisture;p.sourceLoading=source.loading;
   let sourceArea=p.extinctionArea*loading*source.loading*CLOUD_KERNEL_FRACTION;
   p.sourceVolume=0;p.sourceNominalMass=0;p.sourceLiquidWaterContent=0;
   if(p.condensation){
    // Mean concentration in an assumed optical cloud volume, not a measured
    // thermodynamic cell. The weighted radius already accounts for population
    // representation; do not multiply its liquid mass by weight a second time.
    p.sourceVolume=4*Math.PI*p.initialSize**3/3;p.sourceLiquidWaterContent=Math.max(0,this.plume.liquidWaterContent??PLUME.liquidWaterContent)*loading*source.loading;
    p.sourceNominalMass=p.sourceVolume*p.sourceLiquidWaterContent;
    sourceArea=geometricExtinction(p.sourceNominalMass/liquidMass(1,p.diameter,p.density),p.diameter);
   }
   p.active=sourceArea>0;initializePlumeParcel(p,sourceArea,this.plume.sourceHumidity??source.humidity);
  }
  if(p.active)this.emitted++;
 }
 air(p,s,e,h){
  const out=this._air;out.x=s.wx;out.y=s.wy;out.z=s.wz;if(!this.turbulence)return out;
  const c=this._centre??this.field.center(e),base=this._base??Math.max(0,this.field.terrain(c.x,c.z)),eddy=coherentPlumeEddy(p.p,e,c,base,this._eddy);
  out.x+=eddy.x;out.y+=eddy.y;out.z+=eddy.z;return out;
 }
 update(dt,e){
  if(!e){if(this.event?.time>=this.event?.duration)this.complete();else if(this.event)this.clear();return;}if(!Number.isFinite(dt)||dt<0||this.field.paused)return;
  if(this.event!==e){this.clear();this.event=e;for(const p of this.all)p.cycle=0;if(this.dust.length)this.spawn(this.dust[0],e);for(const p of this.flecks)this.spawn(p,e,(p.id-this.dust.length)/Math.max(1,this.flecks.length)*2.4);}
  this._centre=this.field.center(e);this._base=Math.max(0,this.field.terrain(this._centre.x,this._centre.z));
  dt=Math.min(dt,.1);const steps=Math.max(1,Math.ceil(dt/(1/60))),h=dt/steps,env=this.field.envelope(e);
  for(const p of this.all){Object.assign(p.previous,p.p);p.previousRotation=p.rotation;p.previousSize=p.size;}
  this.credit+=dt*plumeRepresentation(this.dust.length,e.intensity,env).birthRate;
  let searched=0;while(this.credit>=1&&searched<this.dust.length){const p=this.dust[this.cursor++%this.dust.length];searched++;if(p.active)continue;this.spawn(p,e);this.credit--;}
  this.credit=Math.min(this.credit,1);
  for(let j=0;j<steps;j++){
   this.time+=h;
   for(const p of this.all){
    if(!p.active)continue;p.age+=h;if(p.age<0)continue;
    if(p.age>p.life){this.expired++;if(p.kind)this.spawn(p,e);else retirePlumeParcel(p,'exported',this.budget);continue;}
    const ground=this.field.terrain(p.p.x,p.p.z),water=this.field.waterAt?.(p.p.x,p.p.z)??0,floor=Math.max(ground,water);
    if(p.kind){
     const a=this.field.acceleration(p.p,p.v,{mass:p.mass,area:p.area,height:.12,volume:0,buoyancy:false,supported:p.p.y<=floor+.05,dt:h},this._sample);
     p.v.x+=a.ax*h;p.v.y+=(a.ay-9.81)*h;p.v.z+=a.az*h;
     p.p.x+=p.v.x*h;p.p.y+=p.v.y*h;p.p.z+=p.v.z*h;
    }else{
     const s=this.field.sample(p.p.x,p.p.y,p.p.z,this._sample);advanceAerosol(p,this.air(p,s,e,h),h);
     const environment=plumeEnvironment(p.p,s,e,this._centre,this._base,this.plume,this._environment);advancePlumeParcel(p,environment,h,this.budget);if(!p.active)this.evaporated++;
    }
    if(h>0)this.samples++;
    p.rotation+=h*(.2+Math.hypot(p.v.x,p.v.z)*.018)*(p.seed>.5?1:-1);
    if(p.p.y<floor+.02){
     if(p.kind){p.p.y=floor+.025;p.v.x*=Math.exp(-5*h);p.v.z*=Math.exp(-5*h);p.v.y=Math.max(0,-p.v.y*.1);}
     else if(p.active){retirePlumeParcel(p,'deposited',this.budget);this.deposited++;}
    }
   }
  }
  for(const p of this.all){
   if(!p.active){p.opacity=0;continue;}
   const t=p.age/p.life,lifetime=fade(p.age/.6)*(1-fade((t-.65)/.35))*env;
   if(p.kind)p.opacity=lifetime*(p.water?0:1);
   // Aerosol extinction already comes from its accounted grain population; it
   // is not multiplied by a second arbitrary lifetime or event-opacity fade.
  }
 }
 snapshot(){const budget={...this.budget,liveDustMass:0,liveLiquidMass:0,liveDustExtinction:0,liveLiquidExtinction:0};let liquidParcels=0,maxRadius=0;for(const p of this.dust)if(p.active){const material=p.liquid?'Liquid':'Dust';budget['live'+material+'Mass']+=p.cloudMass;budget['live'+material+'Extinction']+=p.extinctionArea;if(p.liquid)liquidParcels++;maxRadius=Math.max(maxRadius,p.size);}return {budget,completedBudget:this.completedBudget,liquidParcels,evaporated:this.evaporated,maxRadius,samples:this.samples,dust:this.dust.filter(p=>p.opacity>0).length,flecks:this.flecks.filter(p=>p.opacity>0).length,capacity:this.all.length,sourceSamples:this.sourceSamples,emitted:this.emitted,deposited:this.deposited,expired:this.expired,positions:this.all.slice(0,8).map(p=>[p.p.x,p.p.y,p.p.z]),velocities:this.all.slice(0,8).map(p=>[p.v.x,p.v.y,p.v.z])};}
}
