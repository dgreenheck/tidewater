import { Vector3 } from '../engine/index.js';
const fract=x=>x-Math.floor(x);
export class AnimalBrain {
 constructor(spec,home,seed=1){this.spec=spec;this.home=home.clone();this.seed=seed;this.goal=home.clone();this.desired=new Vector3();this.heading=seed*.71;this.timer=1.5+seed*.31;this.mode='graze';this.time=0;this.blocked=0;this.panic=0;}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 capture(){return {seed:this.seed,goal:this.goal.toArray(),desired:this.desired.toArray(),heading:this.heading,timer:this.timer,mode:this.mode,time:this.time,blocked:this.blocked,panic:this.panic};}
 restore(s){Object.assign(this,s);this.goal=new Vector3().fromArray(s.goal);this.desired=new Vector3().fromArray(s.desired);}
 update(dt,body,habitat,field,herd=[],supported=false){
  this.time+=dt;this.timer-=dt;const p=body.position,s=field.sample(p.x,p.y,p.z),up=new Vector3(0,1,0).applyQuaternion(body.quaternion),water=s.height-habitat.ground(p.x,p.z);
  const tsunami=field.events.get('tsunami'),tornado=field.events.get('tornado'),quake=field.events.get('earthquake');
  const danger=water>.25||Math.hypot(s.wx,s.wz)>15||s.shake>1||!!tsunami||(tornado&&Math.hypot(p.x-field.center(tornado).x,p.z-field.center(tornado).z)<tornado.radius*1.5);
  this.panic=danger?1:Math.max(0,this.panic-dt*.2);
  if(water>this.spec.height*.55||(!supported&&up.y<.5)){this.mode='carried';this.desired.set(0,0,0);return;}
  if(up.y<.9){this.mode='recover';this.desired.set(0,0,0);return;}
  const d=Math.hypot(this.goal.x-p.x,this.goal.z-p.z);
  if(danger){if(this.mode!=='flee'||this.timer<=0||d<1){this.mode='flee';this.choose(p,habitat,field,true,tornado);this.timer=1.4;}}
  else if(this.mode==='carried'||this.mode==='recover'){this.mode='idle';this.timer=2;}
  else if(this.timer<=0||((this.mode==='roam'||this.mode==='flee')&&d<.8)){
   if(this.mode==='roam'||this.mode==='flee'){this.mode='graze';this.timer=4+this.random()*8;}
   else {this.mode='roam';this.choose(p,habitat,field,false);this.timer=10+this.random()*10;}
  }
  this.desired.set(0,0,0);
  if(this.mode==='graze'||this.mode==='idle')return;
  let dx=this.goal.x-p.x,dz=this.goal.z-p.z,len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
  // Short lookahead tests steer around trunks/walls without moving through them.
  const yaw=Math.atan2(dx,dz),speed=this.mode==='flee'?this.spec.flee:this.spec.walk;
  let found=false;for(const angle of [0,.45,-.45,.9,-.9,1.4,-1.4,Math.PI]){const a=yaw+angle,step=Math.max(1.8,speed*.7),next={x:p.x+Math.sin(a)*step,z:p.z+Math.cos(a)*step};if(!habitat.segment(p,next,this.spec,field))continue;dx=Math.sin(a);dz=Math.cos(a);found=true;break;}
  if(!found){this.blocked+=dt;this.timer=Math.min(this.timer,.4);this.mode='idle';return;}
  // Herd spacing is a bounded steering preference, never positional separation.
  let sx=0,sz=0;for(const other of herd){if(other===body)continue;const ox=p.x-other.position.x,oz=p.z-other.position.z,r=Math.hypot(ox,oz),minimum=this.spec.half[2]*2+1.3;if(r<minimum&&r>.01){sx+=ox/r*(1-r/minimum);sz+=oz/r*(1-r/minimum);}}
  dx+=sx*1.8;dz+=sz*1.8;len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
  const next={x:p.x+dx*1.4,z:p.z+dz*1.4};if(!habitat.segment(p,next,this.spec,field)){this.timer=0;return;}
  this.heading=Math.atan2(dx,dz);this.desired.set(dx*speed,0,dz*speed);
 }
 choose(p,habitat,field,danger,tornado){let best=null,score=-Infinity;const center=tornado?field.center(tornado):null;
  for(let i=0;i<28;i++){const a=this.random()*Math.PI*2,r=4+this.random()*(danger?18:12),x=p.x+Math.sin(a)*r,z=p.z+Math.cos(a)*r;if(!habitat.clear(x,z,this.spec,field.waterAt(x,z))||!habitat.segment(p,{x,z},this.spec,field))continue;
   const y=habitat.ground(x,z),home=Math.hypot(x-this.home.x,z-this.home.z);let merit=this.random()*2-home*.08;
   if(danger)merit+=Math.min(12,y-habitat.ground(p.x,p.z))*3+(center?(Math.hypot(x-center.x,z-center.z)-Math.hypot(p.x-center.x,p.z-center.z))*.4:0);
   if(merit>score){best={x,y,z};score=merit;}}
  if(best)this.goal.set(best.x,best.y,best.z);else this.goal.copy(p);
 }
}
