import { Vector3 } from '../engine/index.js';
import { Colliders } from '../world/Colliders.js';
import { SEA_WATER_DENSITY } from '../physics/Loads.js';

// The same capsule/step collision rules as the player, with a small spatial
// broadphase. Entries reference the live colliders: a broken deck immediately
// stops supporting feet. No route point ever supplies a character's height.
export const HUMAN_WALK = Object.freeze({radius:.27,height:1.7,step:.4,gravity:9.81,substep:1/30});
export class EvacuationWalker {
 constructor(app){this.app=app;this.local=new Colliders();this.cells=new Map();this.count=-1;this.probe=new Vector3();this.stats={queries:0,maxCandidates:0};}
 refresh(){
  const C=this.app.colliders,count=C.boxes.length+C.cylinders.length;
  const time=this.app.people?.t??0;
  if(count===this.count&&time-(this.indexTime??time)<1)return;this.indexTime=time;this.count=count;this.cells.clear();
  const add=(item,kind,x,z,r)=>{for(let ix=Math.floor((x-r)/8);ix<=Math.floor((x+r)/8);ix++)for(let iz=Math.floor((z-r)/8);iz<=Math.floor((z+r)/8);iz++){const key=ix+','+iz;let c=this.cells.get(key);if(!c)this.cells.set(key,c={boxes:[],cylinders:[]});c[kind].push(item);}};
  for(const b of C.boxes)add(b,'boxes',b.center.x,b.center.z,b.radius+1);
  for(const c of C.cylinders)add(c,'cylinders',c.x,c.z,c.radius+1);
 }
 at(x,z){this.refresh();const c=this.cells.get(Math.floor(x/8)+','+Math.floor(z/8));this.local.boxes=c?.boxes??[];this.local.cylinders=c?.cylinders??[];this.stats.queries++;this.stats.maxCandidates=Math.max(this.stats.maxCandidates,this.local.boxes.length+this.local.cylinders.length);return this.local;}
 ground(x,z,maxY){return Math.max(this.app.terrainData.heightAt(x,z),this.at(x,z).groundHeightAt(x,z,maxY));}
 canStand(w,base){const y=this.ground(w.x,w.z,base.y+.42);if(Math.abs(y-base.y)>.42)return false;const q=this.probe.set(w.x,y,w.z);this.at(w.x,w.z).resolveCapsule(q,HUMAN_WALK.radius,HUMAN_WALK.height,HUMAN_WALK.step);return Math.hypot(q.x-w.x,q.z-w.z)<.06;}
 navigationPoint(x,z){const terrain=this.app.terrainData.heightAt(x,z),y=this.ground(x,z,Math.max(4.5,terrain+.42)),q=this.probe.set(x,y,z);this.at(x,z).resolveCapsule(q,.32,HUMAN_WALK.height,HUMAN_WALK.step);return Math.hypot(q.x-x,q.z-z)<.08?{x,y,z}:null;}
 segment(a,b,{water=()=>0,swim=false}={}){
  const length=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(length/.3));let y=a.y;
  for(let i=1;i<=n;i++){
   const f=i/n,x=a.x+(b.x-a.x)*f,z=a.z+(b.z-a.z)*f,g=this.ground(x,z,y+.42),wet=water(x,z)-g;
   if((!swim&&wet>.45)||g-y>.42||y-g>.65)return false;
   const q=this.probe.set(x,g,z);this.at(x,z).resolveCapsule(q,.32,HUMAN_WALK.height,HUMAN_WALK.step);
   if(Math.hypot(q.x-x,q.z-z)>.07)return false;y=g;
  }
  return true;
 }
 step(p,target,dt,speed,water){
  const e=p.evacuation,v=e.velocity,P=p.world,steps=Math.max(1,Math.ceil(dt/HUMAN_WALK.substep)),h=dt/steps;
  e.moving=false;
  for(let i=0;i<steps;i++){
   const x=P.x,z=P.z,depth=Math.max(0,water(P.x,P.z)-P.y),ground=this.ground(P.x,P.z,P.y+.45);
   const swimming=water(P.x,P.z)-ground>1.25&&depth>.6;
   let dx=target?target.x-P.x:0,dz=target?target.z-P.z:0,L=Math.hypot(dx,dz);
   if(L>0){dx/=L;dz/=L;}
   const mass=p.brain?.type==='kid'?35:72,bodyHeight=p.brain?.type==='kid'?1.25:1.7,area=.7*(bodyHeight/1.7)**2,wet=Math.min(1,depth/bodyHeight);
   // Voluntary wading slows before still-water drag exceeds the assumed stance
   // budget: .5 rho Cd A wet v² / mass = 1.8 m/s², Cd=1. Actual currents can
   // still exceed support and cause a tumble through the shared load model.
   const waterSpeed=wet>.02?Math.sqrt(2*mass*1.8/(SEA_WATER_DENSITY*area*wet)):speed;
   const desired=Math.min(speed,waterSpeed,swimming?.8:Infinity,Math.max(0,L-.05)/h),k=1-Math.exp(-(e.grounded||swimming?10:1.5)*h);
   v.x+=(dx*desired-v.x)*k;v.z+=(dz*desired-v.z)*k;
   const force=p.environmentAcceleration;
   if(force){v.x+=force.x*h;v.y+=force.y*h;v.z+=force.z*h;}
   v.y-=HUMAN_WALK.gravity*h;
   // A swimmer's buoyancy balances weight near shoulder depth. It does not
   // cancel horizontal current/wind loads or the shared tumble threshold.
   if(swimming){const buoyancy=force?HUMAN_WALK.gravity*SEA_WATER_DENSITY/1000*wet:0;v.y+=(Math.max(0,HUMAN_WALK.gravity-buoyancy)+(water(P.x,P.z)-1.25-P.y)*8-v.y*4)*h;}
   P.addScaledVector(v,h);
   const C=this.at(P.x,P.z),hit=C.resolveCapsule(P,HUMAN_WALK.radius,HUMAN_WALK.height,HUMAN_WALK.step),floor=this.ground(P.x,P.z,P.y+.45);
   if(P.y<=floor&&v.y<=2){P.y=floor;if(v.y<0)v.y=0;e.grounded=true;}else e.grounded=P.y-floor<.06;
   e.swimming=swimming;e.moving ||=Math.hypot(P.x-x,P.z-z)>.002;
   if(hit){v.x=(P.x-x)/h;v.z=(P.z-z)/h;e.collisions++;}
   if(e.grounded&&this.local.boxes.some(b=>b.walkable&&b.tag==='evacuation-deck'&&Math.abs(b.top-P.y)<.03&&Math.abs(P.x-b.center.x)<b.half.x&&Math.abs(P.z-b.center.z)<b.half.z))e.routeContacts++;
   if(L>.1)p.heading=Math.atan2(dx,dz);
  }
 }
}
