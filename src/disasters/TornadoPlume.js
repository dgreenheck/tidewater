// Reduced one-way cloud lifecycle, SI units. This does not solve humidity or heat.
// r dr/dt = K (RH-1), Kumar et al. Eq.26: https://arxiv.org/pdf/1112.5012
// Entrainment motivates spreading, not a calibrated tornado coefficient:
// https://arxiv.org/pdf/2109.01240 . All coefficients below are declared assumptions.
export const PLUME = Object.freeze({evaporationK:5e-11,sourceHumidity:1,ambientHumidity:.84,entrainmentLow:.035,entrainmentHigh:.16,birthSeconds:.6,extinctionEfficiency:2,liquidWaterContent:.00006,maxLifetime:14});
export const CLOUD_KERNEL_FRACTION=.274597137431334;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
export const liquidMass=(number,diameter,density=1000)=>number*Math.PI/6*density*diameter**3;
export const geometricExtinction=(number,diameter)=>number*PLUME.extinctionEfficiency*Math.PI*.25*diameter*diameter;
// A parcel represents a bounded statistical volume, not an extra force. Cap
// actual births even at maximum intensity; weight preserves expected source flux.
export function plumeRepresentation(capacity,intensity,envelope=1){const weight=PLUME.maxLifetime/5*clamp(intensity/75,.15,1.5);return {birthRate:Math.max(0,capacity)/PLUME.maxLifetime*clamp(envelope,0,1),weight,radiusScale:Math.cbrt(weight)};}
function valueNoise(x,y,z){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),u=smooth(x-ix),v=smooth(y-iy),w=smooth(z-iz);
 const hash=(a,b,c)=>{let n=Math.imul(a,73856093)^Math.imul(b,19349663)^Math.imul(c,83492791);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;};
 const mix=(a,b,t)=>a+(b-a)*t;
 return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),u),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),u),v),mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),u),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),u),v),w);
}
// A prescribed moist source with spatially correlated patches, sampled once at
// birth. These are reduced source assumptions, not solved atmospheric humidity.
// Every neighbour samples the same field; no per-parcel id selects its moisture.
export function plumeSource(position,event,centre,base,out={}){
 const scale=event.radius/100,x=(position.x-centre.x)/(42*scale),y=(position.y-base-event.time*event.intensity*.22)/(42*scale),z=(position.z-centre.z)/(42*scale);
 const q=.72*valueNoise(x+17.3,y-4.7,z+9.1)+.28*valueNoise(x*2.31-3.8,y*2.31+5.9,z*2.31-7.2),moisture=smooth((q-.18)/.64);
 out.moisture=moisture;out.humidity=.94+.06*moisture;out.loading=.16+2.2*moisture*moisture;return out;
}
export function evaporatedDiameter(diameter,relativeHumidity,K,dt){return Math.sqrt(Math.max(0,diameter*diameter-8*Math.max(0,K)*(1-clamp(relativeHumidity,0,1))*Math.max(0,dt)));}
export function spreadRadius(radius,diffusivity,entrainmentSpeed,dt){return Math.sqrt((radius+Math.max(0,entrainmentSpeed)*dt)**2+4*Math.max(0,diffusivity)*dt);}
export function createPlumeBudget(){const b={evaporatedLiquidMass:0,evaporatedExtinction:0};for(const route of ['source','exported','deposited'])for(const material of ['Dust','Liquid']){b[route+material+'Mass']=0;b[route+material+'Extinction']=0;}return b;}
function moments(p){p.grainMass=liquidMass(1,p.diameter,p.density);p.cloudMass=p.number*p.grainMass;p.extinctionArea=geometricExtinction(p.number,p.diameter);}
function account(b,route,p,mass,area){const material=p.liquid?'Liquid':'Dust';b[route+material+'Mass']+=mass;b[route+material+'Extinction']+=area;}
export function initializePlumeParcel(p,sourceArea,sourceHumidity=1){
 p.liquid=!!(p.water||p.condensation);p.initialDiameter=p.diameter;p.liquidFraction=1;p.targetNumber=sourceArea/geometricExtinction(1,p.diameter);p.number=0;p.injectedFraction=0;p.retainedFraction=1;p.mixedFraction=1;p.sourceHumidity=clamp(sourceHumidity,0,1);p.relativeHumidity=p.sourceHumidity;p.extinctionArea=p.cloudMass=0;
}
export function retirePlumeParcel(p,route,budget){moments(p);account(budget,route,p,p.cloudMass,p.extinctionArea);p.number=0;p.cloudMass=p.extinctionArea=p.opacity=0;p.active=false;}
export function advancePlumeParcel(p,environment,dt,budget){
 if(!(dt>0)||!p.active)return;
 // Number is injected continuously over 0.6 s; source mass/area use the current
 // representative grain. No opacity-only birth fade creates unaccounted matter.
 const sourceFraction=smooth(p.age/PLUME.birthSeconds),added=Math.max(0,sourceFraction-p.injectedFraction)*p.targetNumber;
 p.injectedFraction=sourceFraction;p.number+=added;account(budget,'source',p,liquidMass(added,p.diameter,p.density),geometricExtinction(added,p.diameter));
 const previous=p.size;p.size=spreadRadius(previous,p.diffusivity,environment.entrainmentSpeed,dt);p.mixedFraction*=Math.min(1,(previous/p.size)**3);
 p.relativeHumidity=clamp(environment.humidity+(p.sourceHumidity-environment.humidity)*p.mixedFraction,0,1);
 if(p.liquid){
  const before=p.diameter,after=evaporatedDiameter(before,p.relativeHumidity,environment.evaporationK,dt);
  budget.evaporatedLiquidMass+=liquidMass(p.number,before,p.density)-liquidMass(p.number,after,p.density);
  budget.evaporatedExtinction+=geometricExtinction(p.number,before)-geometricExtinction(p.number,after);p.diameter=after;
 }
 // Pool retirement exports a resolved population into an unrendered far-field
 // reservoir. It does not evaporate mineral mass. The budget records the transfer.
 const retained=(1-smooth((p.age/p.life-.65)/.35))*(environment.shutdown??1),removed=p.retainedFraction>0?p.number*(1-retained/p.retainedFraction):p.number;
 account(budget,'exported',p,liquidMass(Math.max(0,removed),p.diameter,p.density),geometricExtinction(Math.max(0,removed),p.diameter));p.number-=Math.max(0,removed);p.retainedFraction=retained;
 moments(p);p.liquidFraction=p.liquid?(p.diameter/p.initialDiameter)**3:1;p.opacity=p.extinctionArea/(Math.PI*p.size*p.size*CLOUD_KERNEL_FRACTION);
 if(p.liquid&&p.diameter===0){p.number=0;p.cloudMass=p.extinctionArea=p.opacity=0;p.active=false;}
}
export function plumeEnvironment(position,air,event,centre,base,options={},out={}){
 const scale=event.radius/100,alt=Math.max(0,position.y-base),height=130*scale,h=alt/height,r=Math.hypot(position.x-centre.x,position.z-centre.z);
 const moist=Math.exp(-.6*(r/(event.radius*.3+alt*.08))**2)*(1-smooth((h-.3)/.8));
 out.humidity=options.humidity??(PLUME.ambientHumidity+(1-PLUME.ambientHumidity)*moist);
 const alpha=PLUME.entrainmentLow+(PLUME.entrainmentHigh-PLUME.entrainmentLow)*smooth((h-.2)/.9);
 out.entrainmentSpeed=options.entrainmentSpeed??alpha*Math.hypot(air.wx,air.wy,air.wz);out.evaporationK=options.evaporationK??PLUME.evaporationK;
 // Shutdown is only the decreasing duration tail, never the rising start ramp.
 out.shutdown=smooth((event.duration-event.time)/2);return out;
}
// Two smooth, spatially shared curl modes. Nearby parcels see the same eddy,
// regardless of their id/birth cohort. Amplitude is event-wide; each constant-
// amplitude mode is divergence-free, but the full prescribed carrier is not CFD.
export function coherentPlumeEddy(position,event,centre,base,out={}){
 const scale=event.radius/100,k=.12/scale,x=(position.x-centre.x)*k,y=(position.y-base-event.time*event.intensity*.22)*k,z=(position.z-centre.z)*k;
 const a=Math.min(8,event.intensity*.055),t=event.time*.19;
 out.x=a*(.55*(Math.sin(y+t)-Math.cos(z-t*.7))+.25*(Math.sin(y*.37-t*.6)-Math.cos(z*.37+t*.4)));
 out.y=a*(.3*(Math.sin(z+t*.8)-Math.cos(x+t))+.15*(Math.sin(z*.37-t*.3)-Math.cos(x*.37+t*.5)));
 out.z=a*(.55*(Math.sin(x-t*.6)-Math.cos(y+t*.9))+.25*(Math.sin(x*.37+t*.7)-Math.cos(y*.37-t*.4)));return out;
}
