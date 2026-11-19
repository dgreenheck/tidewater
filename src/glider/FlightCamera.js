import {Vector3} from '../engine/math/index.js';
import {rotate,inverseRotate} from '../aviation/Math.js';
import {pilotPoints} from './GliderBody.js';
const origin=new Vector3(),direction=new Vector3();
const SUBJECT=[[0,0,0],[0,-.9,0],[-4.8,0,-1],[4.8,0,-1]];
const limit=(value,max)=>Math.max(-max,Math.min(max,value));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// Every candidate starts from the nominal 15 m chase boom. Corrections from the
// preceding frame are never added again. Side views keep the suspended pilot
// readable beside the sail while clearing terrain and authored station boxes.
export function clearFlightCamera(eye,subject,terrain,colliders=null,quaternion=[0,0,0,1],options={}){
 const state=options.state||{},dt=Math.max(0,options.dt??0),desired=options.desired||eye.toArray(),sail=options.sail;
 const probes=[...SUBJECT,...pilotPoints(options.controls)].map(local=>{const offset=rotate(quaternion,local);return subject.map((n,i)=>n+offset[i]);});
 const nominal=Math.atan2(desired[0]-subject[0],desired[2]-subject[2]);
 const home=40*Math.PI/180;
 const forecast=(options.velocity||[0,0,0]).map(n=>n*.7);
 const clear=(candidate,ahead=false)=>{
  const shift=ahead?forecast:[0,0,0],ex=candidate.x+shift[0],ey=candidate.y+shift[1],ez=candidate.z+shift[2];
  if(ey<terrain.heightAt(ex,ez)+2)return false;
  for(const p of probes){
   const x=p[0]+shift[0],z=p[2]+shift[2],y=Math.max(p[1]+shift[1],terrain.heightAt(x,z)+.3),dx=ex-x,dz=ez-z,dy=ey-y,n=Math.max(12,Math.ceil(Math.hypot(dx,dz)/.3));
   for(let i=1;i<=n;i++){const t=i/n;if(y+dy*t<terrain.heightAt(x+dx*t,z+dz*t)+.3)return false;}
   if(colliders?.raycast){origin.set(p[0]+shift[0],p[1]+shift[1],p[2]+shift[2]);direction.set(ex,ey,ez).sub(origin);const length=direction.length();if(length>.01){direction.divideScalar(length);const hit=colliders.raycast(origin,direction,length);if(hit>.15&&hit<length-.02)return false;}}
  }
  return !sail||sail.pilotVisible(new Vector3(...inverseRotate(quaternion,[candidate.x-subject[0],candidate.y-subject[1],candidate.z-subject[2]])),options.controls);
 };
 const candidate=(angle,height,radius=15)=>new Vector3(subject[0]+Math.sin(nominal+angle)*radius,subject[1]+height,subject[2]+Math.cos(nominal+angle)*radius);
 if(options.reset){state.angle=home;state.height=5;state.radius=15;state.nominalClear=0;}
 const straight=candidate(home,5);
 state.nominalClear=clear(straight)&&clear(straight,true)?(state.nominalClear||0)+dt:0;
 const preferred=state.nominalClear>1.2?home:(state.angle??home),preferredHeight=state.nominalClear>1.2?5:(state.height??5);
 const candidates=[];
 for(const degrees of [40,0,70,-40,-70,100,-100,140,-140,180])for(const height of [5,2,0,-2,8,11])for(const radius of [15,12,9,7]){
  const angle=degrees*Math.PI/180;
  const cost=Math.abs(wrap(angle-home))/.698*2+Math.abs(height-5)/3*1.4+Math.abs(wrap(angle-preferred))/.698*.8+Math.abs(height-preferredHeight)/3*.35;
  candidates.push({angle,height,radius,cost:cost+(15-radius)*.3});
 }
 candidates.sort((a,b)=>a.cost-b.cost);
 if(state.nominalClear<=1.2)candidates.unshift({angle:preferred,height:preferredHeight,cost:-1});
 const relative=eye.clone().sub(new Vector3(...subject)),oldAngle=Math.atan2(relative.x,relative.z),oldRadius=Math.hypot(relative.x,relative.z),blend=1-Math.exp(-dt*6);
 const eased=(goal,angle,radius)=>{
  if(options.reset||dt<=0)return goal;
  const theta=oldAngle+limit(wrap(nominal+angle-oldAngle)*blend,dt*1.8),r=oldRadius+limit((radius-oldRadius)*blend,dt*12);
  return new Vector3(subject[0]+Math.sin(theta)*r,eye.y+limit((goal.y-eye.y)*blend,dt*16),subject[2]+Math.cos(theta)*r);
 };
 let chosen=null,chosenAngle=preferred,chosenHeight=preferredHeight,chosenRadius=state.radius||15;
 const goals=[],seen=new Map();
 for(const predictive of [true,false]){
  for(const {angle,height,radius=state.radius||15,cost}of candidates){
   const key=angle+':'+height+':'+radius;let g=seen.get(key);
   if(g===undefined){const goal=candidate(angle,height,radius);g=clear(goal)?{goal,angle,height,radius,cost,future:clear(goal,true)}:null;seen.set(key,g);if(g)goals.push(g);}
   if(!g||(predictive&&!g.future))continue;
   const next=eased(g.goal,g.angle,g.radius);if(clear(next)){
    chosen=next;chosenAngle=g.angle;chosenHeight=g.height;chosenRadius=g.radius;break;
   }
  }
  if(chosen)break;
 }
 if(!chosen&&!options.reset&&dt>0){
  // Search a local continuation when a narrow wall invalidates the straight
  // interpolation. A safety correction may never jump across the aircraft.
  const goal=goals[0]?.goal||candidate(preferred,5),limit=Math.min(1.1,Math.max(.12,dt*40)),near=[];
  for(const scale of [0,.35,.7,1])for(const elevation of [-1,0,1])for(let k=0;k<12;k++){
   const theta=k*Math.PI/6,r=limit*scale/Math.sqrt(1+elevation*elevation),p=eye.clone().add(new Vector3(Math.sin(theta)*r,elevation*r,Math.cos(theta)*r));
   if(p.distanceTo(new Vector3(...subject))<23&&clear(p))near.push({p,cost:p.distanceToSquared(goal)+(clear(p,true)?0:100)});
  }
  near.sort((a,b)=>a.cost-b.cost);if(near.length)chosen=near[0].p;
 }
 if(!chosen){
  // Embedded terminal wrecks may have no view of every probe. Keep a finite
  // nearby lens. In flight the feasible candidate search above takes priority.
  chosen=goals[0]?.goal||candidate(preferred,11,9);
 }
 eye.copy(chosen);state.angle=chosenAngle;state.height=chosenHeight;state.radius=chosenRadius;return eye;
}
