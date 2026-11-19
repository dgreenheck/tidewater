import {LIFT} from './Route.js';
import {GRAVITY,AIR_DENSITY} from '../physics/Loads.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mod=(x,n)=>((x%n)+n)%n;
const V=(x=0,y=0,z=0)=>({x,y,z}),cross=(a,b)=>V(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
// Scratch for the shared wind sample (Field.sampleRaw resets every key it writes) and the no-field case.
const _air={},NO_AIR=Object.freeze({});
// Seat step-off band, m/s at the feet (declared game choice). 0.4 m/s is a slow shuffle; 0.6 m/s is
// still well under the 2-2.5 m/s line speed at which fixed-grip chairs are unloaded, so a rider can
// always step off a seat that read docked and is only swaying in a light gust.
const DOCK_ENTER=.4,DOCK_RELEASE=.6;
// Latched chair id per station (-1 for none), kept off the instance: one more own property on the
// transport made V8 box every double the step writes (158 KB a frame, test/frame-garbage.mjs).
const LATCHES=new WeakMap();
const latchOf=t=>{let latch=LATCHES.get(t);if(!latch){latch=new Int16Array(t.site.stations?.length??0).fill(-1);LATCHES.set(t,latch);}return latch;};
const copyHook=(to,from)=>{to.x=from.x;to.y=from.y;to.z=from.z;to.tx=from.tx;to.ty=from.ty;to.tz=from.tz;};
export class LiftTransport{
 constructor(site,{chairs=LIFT.chairs}={}){this.site=site;this.time=0;this.phase=0;this.speed=0;this.cruise=LIFT.speed;this.running=false;this.docking=null;this.reason='Stopped at the base';this.elapsedDiscarded=0;this.motorDistance=0;this.chairs=Array.from({length:chairs},(_,id)=>({id,offset:id*site.length/chairs,n:V(0,-1,0),omega:V(),hook:site.sample(id*site.length/chairs),previousHook:site.sample(id*site.length/chairs),pivotVelocity:V(),position:V(),velocity:V(),mass:85,occupied:false,windForce:0}));this.sync();}
 snapshot(){return structuredClone({time:this.time,phase:this.phase,speed:this.speed,cruise:this.cruise,running:this.running,docking:this.docking,reason:this.reason,elapsedDiscarded:this.elapsedDiscarded,motorDistance:this.motorDistance,chairs:this.chairs});}
 restore(s){Object.assign(this,structuredClone(s));latchOf(this).fill(-1);this.sync();}
 sync(){for(const c of this.chairs){c.hook=this.site.sample(this.phase+c.offset);c.position=V(c.hook.x+LIFT.hanger*c.n.x,c.hook.y+LIFT.hanger*c.n.y,c.hook.z+LIFT.hanger*c.n.z);}this.latchDocks();}
 setSpeed(speed){if(!Number.isFinite(speed)||speed<.5||speed>LIFT.maxSpeed)return false;this.cruise=speed;return true;}
 start(){this.running=true;this.docking=null;this.reason='Running';}
 stop(reason='Service stopped'){this.running=false;this.docking=null;this.reason=reason;}
 stationOffset(chair,station){return mod(this.phase+chair.offset-station.distance+this.site.length*.5,this.site.length)-this.site.length*.5;}
 requestDock(station,chairId=null){
  const candidates=chairId===null?this.chairs:[this.chairs[chairId]],name=station===this.site.base?'base':'summit';
  // Repeated terminal calls retain a stopped chair, even while its swing is
  // settling. Forward-only modulo would send a tiny overshoot around the loop.
  // This only selects service: no phase, velocity or pendulum state is changed.
  if(!this.running&&this.speed<.03){const present=candidates.find(c=>c&&Math.abs(this.stationOffset(c,station))<.025);if(present){
   // An interrupted departure can still be braking inside the boarding window.
   // Leave that brake trajectory unconstrained instead of setting remaining=0,
   // which would remove its stopping distance and create a pivot impulse.
   this.docking=this.speed===0?{chairId:present.id,station:name,remaining:0}:null;this.reason=`${this.speed===0?'Stopped':'Stopping'} at ${name}`;return true;
  }}
  let chosen=null;for(const c of candidates){if(!c)continue;const distance=mod(station.distance-this.phase-c.offset,this.site.length);if(!chosen||distance<chosen.remaining)chosen={chairId:c.id,station:name,remaining:distance};}if(!chosen)return false;this.docking=chosen;this.running=true;this.reason=`Approaching ${station.name}`;return true;
 }
 // Step-off test at the seat (the feet hang LIFT.feetDrop below the pivot). A stopped chair docks when
 // the seat moves slower than DOCK_ENTER and stays docked until it moves faster than DOCK_RELEASE.
 // One 0.4 m/s threshold flickered: a light gust swings the seat through it for up to 0.9 s each half
 // swing, so the panel said "docked" and the rider's E a moment later was refused (test/chairlift.mjs
 // "light gust"; chairlift.spec.js summit exit). The latch is kept after every advance in latchDocks(), not by
 // whoever polls, so every caller reads the same answer.
 dockTest(chair,station,limit){
  if(Math.abs(this.stationOffset(chair,station))>=.025||this.speed>=.03)return false;
  const spin=cross(chair.omega,chair.n),pv=chair.pivotVelocity;
  const pointSpeed=Math.hypot(pv.x+spin.x*LIFT.feetDrop,pv.y+spin.y*LIFT.feetDrop,pv.z+spin.z*LIFT.feetDrop);
  return pointSpeed<limit&&-chair.n.y>Math.cos(Math.PI/12);
 }
 // The one chair that can sit at each station: chair offsets are id x length / chairs, so the nearest
 // is found by arithmetic. Looping every chair at every station cost 158 KB of boxed doubles a frame
 // (test/frame-garbage.mjs); this keeps one latched chair id per station, -1 for none.
 latchDocks(){
  const stations=this.site.stations;
  if(!stations)return;
  const latch=latchOf(this),n=this.chairs.length,spacing=this.site.length/n;
  for(let k=0;k<stations.length;k++){
   if(this.speed>=.03){latch[k]=-1;continue;}
   const id=Math.round(mod(stations[k].distance-this.phase,this.site.length)/spacing)%n,held=latch[k]===id;
   latch[k]=this.dockTest(this.chairs[id],stations[k],held?DOCK_RELEASE:DOCK_ENTER)?id:-1;
  }
 }
 docked(chair,station){
  const stations=this.site.stations,k=stations?stations.indexOf(station):-1;
  const latched=k>=0&&latchOf(this)[k]===chair.id;
  return this.dockTest(chair,station,latched?DOCK_RELEASE:DOCK_ENTER);
 }
 advance(dt,field=null,options){if(options?.paused)return;const elapsed=Math.max(0,Number.isFinite(dt)?dt:0),accepted=Math.min(.1,elapsed);this.elapsedDiscarded+=elapsed-accepted;const count=Math.max(1,Math.ceil(accepted*120)),h=accepted/count;if(!h)return;for(let i=0;i<count;i++)this.step(h,field);this.latchDocks();}
 step(h,field){
  let wanted=this.running?this.cruise:0;if(this.docking)wanted=Math.min(wanted,Math.sqrt(Math.max(0,2*LIFT.brake*(this.docking.remaining-this.speed*h-.001))));
  const acceleration=clamp((wanted-this.speed)/h,-LIFT.brake,LIFT.acceleration),next=Math.max(0,this.speed+acceleration*h);let distance=(this.speed+next)*.5*h;this.speed=next;
  if(this.docking){distance=Math.min(distance,this.docking.remaining);this.docking.remaining-=distance;if(this.docking.remaining<.001&&this.speed<.05){distance+=this.docking.remaining;this.docking.remaining=0;this.speed=0;this.running=false;this.reason=`Stopped at ${this.docking.station}`;}}
  this.phase=mod(this.phase+distance,this.site.length);this.motorDistance+=distance;this.time+=h;
  // Every chair vector is updated in place. The step runs 2 substeps x 20 chairs a 60 Hz frame and
  // built ~25 objects and four ['x','y','z'] arrays per chair: 280,880 heap bytes a frame (// test/frame-garbage.mjs). The arithmetic is the old expressions term for term, so the swing is bit
  // identical. chair.hook and chair.previousHook keep their objects: copy one to keep its value.
  for(const c of this.chairs){
   const previous=c.previousHook,hook=c.hook,pv=c.pivotVelocity,n=c.n,omega=c.omega;
   copyHook(previous,hook);
   const sampled=this.site.sample(this.phase+c.offset,hook);
   if(sampled!==hook)copyHook(hook,sampled);
   const pvx=(hook.x-previous.x)/h,pvy=(hook.y-previous.y)/h,pvz=(hook.z-previous.z)/h;
   const pax=(pvx-pv.x)/h,pay=(pvy-pv.y)/h,paz=(pvz-pv.z)/h;
   pv.x=pvx;
   pv.y=pvy;
   pv.z=pvz;
   // relative = omega x n, the seat's swing velocity per metre of hanger
   const rx=omega.y*n.z-omega.z*n.y,ry=omega.z*n.x-omega.x*n.z,rz=omega.x*n.y-omega.y*n.x;
   const sx=pvx+rx*LIFT.hanger,sy=pvy+ry*LIFT.hanger,sz=pvz+rz*LIFT.hanger;
   const air=field?.sample?.(c.position.x,c.position.y,c.position.z,_air)||NO_AIR;
   const ux=(air.wx||0)-sx,uy=(air.wy||0)-sy,uz=(air.wz||0)-sz,mass=c.mass+(c.occupied?75:0);
   const k=.5*AIR_DENSITY*1.15*(c.occupied?2:1.45)*Math.hypot(ux,uy,uz),relax=k/(mass+k*h);
   const gx=ux*relax-pax,gy=uy*relax-GRAVITY-pay,gz=uz*relax-paz;
   // torque = n x g
   const qx=n.y*gz-n.z*gy,qy=n.z*gx-n.x*gz,qz=n.x*gy-n.y*gx,damping=Math.exp(-.6*h);
   omega.x=(omega.x+qx/LIFT.hanger*h)*damping;
   omega.y=(omega.y+qy/LIFT.hanger*h)*damping;
   omega.z=(omega.z+qz/LIFT.hanger*h)*damping;
   // Rotation about the hanging direction has no pendulum degree of freedom.
   const axial=omega.x*n.x+omega.y*n.y+omega.z*n.z;
   omega.x-=axial*n.x;
   omega.y-=axial*n.y;
   omega.z-=axial*n.z;
   const cx=omega.y*n.z-omega.z*n.y,cy=omega.z*n.x-omega.x*n.z,cz=omega.x*n.y-omega.y*n.x;
   n.x+=cx*h;
   n.y+=cy*h;
   n.z+=cz*h;
   const length=Math.hypot(n.x,n.y,n.z);
   n.x/=length;
   n.y/=length;
   n.z/=length;
   c.position.x=hook.x+LIFT.hanger*n.x;
   c.position.y=hook.y+LIFT.hanger*n.y;
   c.position.z=hook.z+LIFT.hanger*n.z;
   const ax=omega.y*n.z-omega.z*n.y,ay=omega.z*n.x-omega.x*n.z,az=omega.x*n.y-omega.y*n.x;
   c.velocity.x=pvx+ax*LIFT.hanger;
   c.velocity.y=pvy+ay*LIFT.hanger;
   c.velocity.z=pvz+az*LIFT.hanger;
   c.windForce=k*Math.hypot(ux,uy,uz)/(1+k*h/mass);
  }
 }
}
