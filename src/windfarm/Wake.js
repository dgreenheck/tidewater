import { REFERENCE as R, ASSUMPTIONS as A } from './Reference.js';
import { clamp } from './TurbineModel.js';

function overlap(a,b,d) {
 if(a===0)return d<b?1:0;
 if(d>=a+b)return 0;
 if(d<=Math.abs(a-b))return Math.PI*Math.min(a,b)**2;
 const ca=clamp((d*d+a*a-b*b)/(2*d*a),-1,1),cb=clamp((d*d+b*b-a*a)/(2*d*b),-1,1);
 return a*a*Math.acos(ca)+b*b*Math.acos(cb)-0.5*Math.sqrt(Math.max(0,(-d+a+b)*(d+a-b)*(d-a+b)*(d+a+b)));
}
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};

// Jensen momentum-deficit envelope. A point samples the actual expanded wake;
// a rotor samples its disk overlap, including the different land hub heights.
// k=.04, RSS combination and the 8D..10D fade are explicit approximations.
function deficitAt(x,y,z,sources,wx,wz,receiverRadius,excludeId) {
 const speed=Math.hypot(wx,wz);if(speed<.01)return 0;
 const ux=wx/speed,uz=wz/speed;let squares=0;
 for(const source of sources) {
  if(source.id===excludeId||source.damaged||source.ct<=0)continue;
  const dx=x-source.x,dz=z-source.z,sx=source.flowX??ux,sz=source.flowZ??uz,downstream=dx*sx+dz*sz;
  if(downstream<=R.radius||downstream>=A.wakeDistance)continue;
  const radius=R.radius+A.wakeExpansion*downstream,dy=y-((source.baseY??0)+R.hubHeight);
  if(Math.abs(dy)>radius+receiverRadius)continue;
  const lateral=Math.hypot(dx*sz-dz*sx,dy);
  if(lateral>=radius+receiverRadius)continue;
  const coverage=receiverRadius===0?1:overlap(receiverRadius,radius,lateral)/(Math.PI*receiverRadius**2);
  const fade=1-smooth((downstream-A.wakeFadeStart)/(A.wakeDistance-A.wakeFadeStart));
  const deficit=(1-Math.sqrt(1-clamp(source.ct,0,.95)))*(R.radius/radius)**2*coverage*fade;
  squares+=deficit**2;
 }
 return clamp(Math.sqrt(squares),0,.85);
}

export function wakeFactor(target,upstream,wind) {
 return 1-deficitAt(target.x,(target.baseY??0)+R.hubHeight,target.z,upstream,wind.wx,wind.wz,R.radius,target.id);
}

// The steady wake removes streamwise momentum. These deterministic, zero-mean
// lateral/vertical sinusoids are an ASSUMED turbulence surrogate, not a resolved
// turbulence spectrum. They use only part of the removed kinetic-energy budget;
// the final vector magnitude can never exceed the incoming raw air speed.
// Mutates air velocity only, so it can also be used by shared Field.sample.
export function applyWakeToAir(air,x,y,z,sources,time,receiverRadius=0,excludeId) {
 const wx=air.wx||0,wy=air.wy||0,wz=air.wz||0;
 const deficit=deficitAt(x,y,z,sources,wx,wz,receiverRadius,excludeId);
 if(deficit<=0)return 1;
 const speed=Math.hypot(wx,wy,wz),horizontal=Math.hypot(wx,wz),ux=wx/horizontal,uz=wz/horizontal,retained=1-deficit;
 const amplitude=A.wakeTurbulence*deficit*speed,phase=(speed*time-x*ux-z*uz)/18;
 const lateral=amplitude*Math.sin(phase),vertical=.7*amplitude*Math.sin(phase*1.37+y/29);
 air.wx=wx*retained-uz*lateral;air.wy=wy*retained+vertical;air.wz=wz*retained+ux*lateral;
 const after=Math.hypot(air.wx,air.wy,air.wz),scale=after>speed?speed/after:1;
 air.wx*=scale;air.wy*=scale;air.wz*=scale;
 return retained;
}

// Cached by WindFarm once per update, then queried without allocation by Field's
// water-stress grid. Individual point samples still reject each bounded cone.
export function wakeBounds(sources,out={}) {
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
 const r=R.radius+A.wakeExpansion*A.wakeDistance;
 for(const s of sources){if(s.damaged||s.ct<=0||!Number.isFinite(s.flowX+s.flowZ))continue;const x=s.x+s.flowX*A.wakeDistance,z=s.z+s.flowZ*A.wakeDistance;minX=Math.min(minX,s.x-r,x-r);maxX=Math.max(maxX,s.x+r,x+r);minZ=Math.min(minZ,s.z-r,z-r);maxZ=Math.max(maxZ,s.z+r,z+r);}
 // Written into `out` so the farm keeps one bounds object; null when no wake is shed.
 if(minX===Infinity)return null;
 out.minX=minX;
 out.maxX=maxX;
 out.minZ=minZ;
 out.maxZ=maxZ;
 return out;
}
