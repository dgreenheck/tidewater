import {launchPoint,LAUNCH,prepareGliderSite} from '../glider/Site.js';
export const LIFT=Object.freeze({baseX:-40,baseZ:-105,laneRadius:3.2,cableHeight:4.2,hanger:3.3,feetDrop:4.15,clearance:5,spacing:34,sag:.65,chairs:20,speed:3,maxSpeed:5,acceleration:.55,brake:.8});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const prepared=new WeakMap();
const at=(origin,forward,right,along,cross,y)=>({x:origin.x+forward.x*along+right.x*cross,y,z:origin.z+forward.z*along+right.z*cross});
export function prepareChairliftSite(terrain,roads=null,{reserve=true}={}){
 if(prepared.has(terrain)){const site=prepared.get(terrain);if(reserve)reserveSite(site);return site;}
 const end=launchPoint(-14,-2),base={name:'Village base',x:LIFT.baseX,z:LIFT.baseZ},summit={name:'Summit',x:end[0],z:end[2]},D=Math.hypot(summit.x-base.x,summit.z-base.z),forward={x:(summit.x-base.x)/D,z:(summit.z-base.z)/D},right={x:forward.z,z:-forward.x};
 const ground=(s,c=0)=>{const p=at(base,forward,right,s,c,0);return terrain.heightAt(p.x,p.z);};
 for(const [station,s]of [[base,0],[summit,D]]){let high=-Infinity;for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)high=Math.max(high,ground(s+z,x));station.floor=Math.max(station===summit?LAUNCH.y:-Infinity,high+.25);station.cableY=station.floor+LIFT.cableHeight;station.s=s;station.center=at(base,forward,right,s,0,station.floor);station.board=at(base,forward,right,s,LIFT.laneRadius,station.floor);station.exit=at(base,forward,right,s,LIFT.laneRadius+1.6,station.floor);}
 const distances=[0,12];for(let s=12+LIFT.spacing;s<D-24;s+=LIFT.spacing)distances.push(s);distances.push(D-12,D);
 const envelope=LIFT.feetDrop+.95,obstacleCache=new Map(),stairs=prepareGliderSite(terrain,roads),stairCells=new Map(),cell=8;
 for(const p of stairs.points){const key=Math.floor(p.x/cell)+','+Math.floor(p.z/cell);let list=stairCells.get(key);if(!list)stairCells.set(key,list=[]);list.push(p);}
 const raisedFloor=(x,z)=>{let top=-Infinity;const radius=envelope+stairs.width/2+1.2;for(let iz=Math.floor((z-radius)/cell);iz<=Math.floor((z+radius)/cell);iz++)for(let ix=Math.floor((x-radius)/cell);ix<=Math.floor((x+radius)/cell);ix++)for(const p of stairCells.get(ix+','+iz)||[])if(Math.abs(p.x-x)<=radius&&Math.abs(p.z-z)<=radius)top=Math.max(top,p.y+1.3);return top;};
 // Survey the complete horizontal rider/seat envelope at the actual one-metre
 // terrain vertices, not only the still-air strand centre. This conservative
 // box also covers every pendulum direction without imposing an artificial tilt.
 const obstacle=(s,c)=>{const key=s+','+c;if(obstacleCache.has(key))return obstacleCache.get(key);const p=at(base,forward,right,s,c,0),road=roads?.closest?.(p.x,p.z,r=>r.path.kind==='asphalt');let top=terrain.heightAt(p.x,p.z);for(let z=Math.floor(p.z-envelope);z<=Math.ceil(p.z+envelope);z++)for(let x=Math.floor(p.x-envelope);x<=Math.ceil(p.x+envelope);x++)top=Math.max(top,terrain.heightAt(x,z));top=Math.max(top,raisedFloor(p.x,p.z),road&&road.distance<7+envelope?road.h+1.5:-Infinity);obstacleCache.set(key,top);return top;};
 const supports=distances.map((s,i)=>({s,x:base.x+forward.x*s,z:base.z+forward.z*s,y:i===0?base.cableY:i===distances.length-1?summit.cableY:Math.max(...[-LIFT.laneRadius,0,LIFT.laneRadius].map(c=>obstacle(s,c)))+LIFT.feetDrop+LIFT.clearance+LIFT.sag+1,ground:ground(s)}));
 function slopes(){for(let i=0;i<supports.length;i++)supports[i].slope=i===0||i===supports.length-1?0:(supports[i+1].y-supports[i-1].y)/(supports[i+1].s-supports[i-1].s);}
 function height(s,out={}){let i=0;while(i<supports.length-2&&supports[i+1].s<s)i++;const a=supports[i],b=supports[i+1],length=b.s-a.s,u=clamp((s-a.s)/length,0,1),u2=u*u,u3=u2*u;
  const y=(2*u3-3*u2+1)*a.y+(u3-2*u2+u)*length*a.slope+(-2*u3+3*u2)*b.y+(u3-u2)*length*b.slope-LIFT.sag*Math.sin(Math.PI*u)**2;
  const slope=((6*u2-6*u)*a.y+(3*u2-4*u+1)*length*a.slope+(-6*u2+6*u)*b.y+(3*u2-2*u)*length*b.slope-LIFT.sag*Math.PI*Math.sin(2*Math.PI*u))/length;
  out.y=y;
  out.slope=slope;
  out.i=i;
  return out;
 }
 // Raise supports, never the ground or moving chairs, until the continuous
 // prescribed cable has the required surveyed clearance between terminals.
 for(let pass=0;pass<12;pass++){slopes();let changed=false;for(let s=12;s<=D-12;s+=.5){const h=height(s),required=Math.max(...[-LIFT.laneRadius,0,LIFT.laneRadius].map(c=>obstacle(s,c)))+LIFT.feetDrop+LIFT.clearance;
   if(h.y<required){const lift=required-h.y+.05;for(const j of [h.i,h.i+1])if(j>0&&j<supports.length-1)supports[j].y+=lift;changed=true;}}
  if(!changed)break;
 }
 slopes();
 const R=LIFT.laneRadius,planLength=2*D+2*Math.PI*R;
 // One support-span scratch for plan(): height() built {y,slope,i} per chair per substep.
 const span={};
 function plan(u,out={}){u=((u%planLength)+planLength)%planLength;let s,c,y,dx,dz,dy=0;
  if(u<D){s=u;c=R;const h=height(s,span);y=h.y;dy=h.slope;dx=forward.x;dz=forward.z;}
  else if(u<D+Math.PI*R){const angle=(u-D)/R;s=D+R*Math.sin(angle);c=R*Math.cos(angle);y=summit.cableY;dx=forward.x*Math.cos(angle)-right.x*Math.sin(angle);dz=forward.z*Math.cos(angle)-right.z*Math.sin(angle);}
  else if(u<2*D+Math.PI*R){s=2*D+Math.PI*R-u;c=-R;const h=height(s,span);y=h.y;dy=-h.slope;dx=-forward.x;dz=-forward.z;}
  else{const angle=Math.PI+(u-(2*D+Math.PI*R))/R;s=R*Math.sin(angle);c=R*Math.cos(angle);y=base.cableY;dx=forward.x*Math.cos(angle)-right.x*Math.sin(angle);dz=forward.z*Math.cos(angle)-right.z*Math.sin(angle);}

  // Writes into `out` (same expressions as at()) so the 120 Hz transport step reuses each chair's hook:
  // a fresh {...at(), tx, ty, tz} per chair per substep was 2 of its ~25 objects.
  const length=Math.hypot(dx,dy,dz);
  out.x=base.x+forward.x*s+right.x*c;
  out.y=y;
  out.z=base.z+forward.z*s+right.z*c;
  out.tx=dx/length;
  out.ty=dy/length;
  out.tz=dz/length;
  return out;
 }
 const n=Math.ceil(planLength/.05),lut=[{u:0,d:0}],first=plan(0);let prior=first,arc=0;
 for(let i=1;i<=n;i++){const u=planLength*i/n,p=plan(u);arc+=Math.hypot(p.x-prior.x,p.y-prior.y,p.z-prior.z);lut.push({u,d:arc});prior=p;}
 const distanceAt=u=>{const i=Math.min(n-1,Math.floor(u/planLength*n)),a=lut[i],b=lut[i+1];return a.d+(b.d-a.d)*(u-a.u)/(b.u-a.u);};
 function sample(distance,out){const d=((distance%arc)+arc)%arc;let lo=0,hi=n;while(hi-lo>1){const mid=(lo+hi)>>1;if(lut[mid].d>d)hi=mid;else lo=mid;}const a=lut[lo],b=lut[hi];return plan(a.u+(b.u-a.u)*(d-a.d)/(b.d-a.d),out);}
 // Board only at the outward strand of each terminal; a summit departure first
 // travels around its bullwheel before joining the descending strand.
 base.distance=0;summit.distance=distanceAt(D);base.approach=at(base,forward,right,-8,R+1.6,base.floor);summit.connectorTarget=launchPoint(-6.7,-.5);const entry=launchPoint(-5.5,-.5);summit.launchEntry={x:entry[0],y:entry[1],z:entry[2]};
 const site={base,summit,stations:[base,summit],supports,forward,right,span:D,length:arc,planLength,sample,height,terrain,clearanceRadius:envelope,minimumClearance:Infinity};
 for(let s=12;s<=D-12;s+=.5)for(const c of [-R,0,R])site.minimumClearance=Math.min(site.minimumClearance,height(s).y-LIFT.feetDrop-obstacle(s,c));
 if(site.minimumClearance<LIFT.clearance-.001)throw Error('Chairlift support survey could not clear the terrain');
 if(reserve)reserveSite(site);
 prepared.set(terrain,site);return site;
}

function reserveSite(site){if(site.reserved||!site.terrain.addClearZone)return;const terrain=site.terrain;const f=site.forward,r=site.right,a=site.base,b=site.summit,w=8.5;terrain.addClearZone([[a.x+r.x*w,a.z+r.z*w],[b.x+r.x*w,b.z+r.z*w],[b.x-r.x*w,b.z-r.z*w],[a.x-r.x*w,a.z-r.z*w]]);for(const station of site.stations){const p=station.center;terrain.addClearZone([[p.x-9,p.z-9],[p.x+9,p.z-9],[p.x+9,p.z+9],[p.x-9,p.z+9]]);}const approach=[[-13,3.2],[-5,3.2],[-5,6.2],[-13,6.2]].map(([along,cross])=>[a.x+f.x*along+r.x*cross,a.z+f.z*along+r.z*cross]);terrain.addClearZone(approach);for(const tower of site.supports.slice(1,-1))terrain.addClearZone([[tower.x-2,tower.z-2],[tower.x+2,tower.z-2],[tower.x+2,tower.z+2],[tower.x-2,tower.z+2]]);site.reserved=true;}
