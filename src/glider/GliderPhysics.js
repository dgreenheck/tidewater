import {GRAVITY as G,AIR_DENSITY,dynamicPressure} from '../physics/Loads.js';
import {add,sub,mul,dot,cross,length,unit,rotate,inverseRotate,poseQ,advanceQ,attitude,clamp,finiteState} from '../aviation/Math.js';
import {LAUNCH,BEACH,launchPoint,launchLocal} from './Site.js';
export const STEP=1/120;
// Fictional recreational flexible wing. These coefficients and inertias are
// declared design assumptions; NASA supplies the equations, not these numbers.
export const WING=Object.freeze({mass:118,area:15.8,span:10.2,chord:1.55,cl0:.22,clAlpha:4.2,cd0:.039,efficiency:.72,stallAlpha:.25,trimAlpha:.12,inertia:[85,170,230],pilotMass:85,maxShift:.38,maxRunForce:440,maxRunSpeed:6.2,maxAirSpeed:42,maxLoad:5.5});
export function coefficients(alpha){
 const a=clamp(alpha,-Math.PI/2,Math.PI/2),blend=clamp((Math.abs(a)-WING.stallAlpha)/.20,0,1),f=blend*blend*(3-2*blend);
 const cl=(WING.cl0+WING.clAlpha*a)*(1-f)+1.05*Math.sin(2*a)*f,induced=cl*cl/(Math.PI*(WING.span**2/WING.area)*WING.efficiency);
 return{cl,induced,cd:WING.cd0+induced+1.3*Math.sin(a)**2*f,stall:Math.abs(a)>WING.stallAlpha};
}
export function loads(relative,q,altitude=0){
 const speed=length(relative),body=inverseRotate(q,relative),alpha=Math.atan2(-body[1],body[2]),beta=Math.atan2(body[0],Math.max(.01,Math.hypot(body[1],body[2])));
 const density=AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500),pressure=dynamicPressure(speed,density),c=coefficients(alpha),lift=pressure*WING.area*c.cl,drag=pressure*WING.area*c.cd;
 const v=unit(relative),right=rotate(q,[1,0,0]),liftAxis=unit(cross(v,right));
 return{force:add(mul(liftAxis,lift),mul(v,-drag)),speed,alpha,beta,density,q:pressure,lift,drag,...c};
}
export function equilibrium(alpha=WING.trimAlpha,altitude=0){const c=coefficients(alpha),gamma=-Math.atan2(c.cd,c.cl),rho=AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500),speed=Math.sqrt(2*WING.mass*G/(rho*WING.area*Math.hypot(c.cl,c.cd)));return{speed,gamma,alpha,pitch:alpha+gamma,ratio:c.cl/c.cd};}
const metrics=()=>({speed:0,lift:0,drag:0,q:0,alpha:0,bank:0,heading:0,stall:false,wind:0,windVector:[0,0,0],sink:0,energy:0,dragWork:0,airWork:0,controlWork:0,run:0,thrust:0,load:0,agl:0,distance:0,impactSpeed:0,landingSpeed:0,airTime:0,limits:0});
export class GliderPhysics{
 constructor(){this.reset();}
 reset(){this.position=launchPoint(0,-3,1.5);this.velocity=[0,0,0];this.quaternion=poseQ(LAUNCH.yaw,.08);this.omega=[0,0,0];this.phase='ready';this.reason='Launch into wind, then bank around toward the bay';this.controls={pitch:0,roll:0,flare:false};this.metrics=metrics();this.accumulator=0;this.time=0;this.distance=0;this.run=0;this.damageAge=0;this.lastPosition=[...this.position];this.start=[...this.position];}
 launch(){if(this.phase!=='ready')return'Reset the glider before another launch';this.phase='running';this.reason='Running down the launch ramp';return null;}
 approach(env={}){this.reset();const trim=equilibrium(.15,18),yaw=LAUNCH.yaw;this.position=[BEACH.x+28,22,BEACH.z+58];const wind=env.sample?.(...this.position)||{};this.velocity=add(rotate(poseQ(yaw),[0,trim.speed*Math.sin(trim.gamma),trim.speed*Math.cos(trim.gamma)]),[wind.wx||0,wind.wy||0,wind.wz||0]);this.quaternion=poseQ(yaw,trim.pitch);this.phase='airborne';this.reason='Beach approach: level wings; flare gently below 2 m';this.start=[...this.position];this.lastPosition=[...this.position];}
 update(dt,env={}){this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,.2);while(this.accumulator>=STEP){this.step(STEP,env);this.accumulator-=STEP;}}
 crash(reason,water=false){this.phase=water?'ditched':'crashed';this.reason=reason;this.damageAge=0;}
 step(h,env={}){
  this.time+=h;const m=this.metrics,p=this.position,c=this.controls,s=env.sample?.(...p)||{},wind=[s.wx||0,s.wy||0,s.wz||0],air=sub(this.velocity,wind),a=loads(air,this.quaternion,p[1]);
  Object.assign(m,{speed:a.speed,lift:a.lift,drag:a.drag,q:a.q,alpha:a.alpha,stall:a.stall,wind:length(wind),windVector:wind,thrust:0,load:a.lift/(WING.mass*G),energy:.5*WING.mass*dot(this.velocity,this.velocity)+WING.mass*G*p[1]});
  const att=attitude(this.quaternion);m.heading=att.heading;m.bank=att.bank;m.sink=-this.velocity[1];
  const ground=env.terrainAt?.(p[0],p[2])??-1000,water=env.waterAt?.(p[0],p[2])??0;m.agl=p[1]-1.45-Math.max(ground,water);
  if(this.phase==='ready'||this.phase==='landed')return;
  if(this.phase==='crashed'||this.phase==='ditched'){
   this.damageAge+=h;const afloat=this.phase==='ditched';const target=afloat?water-.10-Math.min(1.0,this.damageAge*.02):ground+1.15;
   const current=[s.ux||0,0,s.uz||0];this.velocity=add(current,mul(sub(this.velocity,current),Math.exp(-h*(afloat?2.2:5))));this.velocity[1]+=(target-p[1])*h*12-this.velocity[1]*Math.min(1,h*5);this.position=add(p,mul(this.velocity,h));return;
  }
  let force=add(a.force,[0,-WING.mass*G,0]);const before=[...this.velocity];
  if(this.phase==='running'){
   const along=launchLocal(p)[1],tangent=unit(rotate(poseQ(LAUNCH.yaw),[0,LAUNCH.grade,1])),speed=Math.max(0,dot(this.velocity,tangent));
   const leg=WING.maxRunForce*clamp((WING.maxRunSpeed-speed)/1.5,0,1);force=add(force,mul(tangent,leg));const next=Math.max(0,speed+dot(force,tangent)/WING.mass*h);this.run+=next*h;
   this.position=launchPoint(0,-3+this.run,1.5);this.velocity=mul(tangent,next);this.quaternion=poseQ(LAUNCH.yaw,.04);m.run=this.run;m.controlWork+=leg*(speed+next)*.5*h;
   if((this.run>5&&a.lift>WING.mass*G*.98)||along>LAUNCH.length-3){this.phase='airborne';this.reason='Unpowered flight · the beach lies south of the mountain';}
   return;
  }
  m.airTime+=h;
  // Fore/aft weight shift changes the trim angle. Roll is a bounded pendulum
  // torque with neutral roll damping. Yaw weathercocks into the air-relative
  // velocity. No kinematic velocity steering or thrust is applied.
  const alphaTarget=WING.trimAlpha+clamp(c.pitch,-1,1)*.20+(c.flare?.23:0),authority=clamp(a.q/95,.12,3);
  const bankTarget=clamp(c.roll,-1,1)*.86;
  const maxMoment=WING.pilotMass*G*WING.maxShift;
  const torque=[clamp((a.alpha-alphaTarget)*480*authority-this.omega[0]*105,-maxMoment,maxMoment),clamp(a.beta*400*authority-this.omega[1]*150,-230,230),clamp((att.bank-bankTarget)*400-this.omega[2]*180,-maxMoment,maxMoment)];
  this.omega=this.omega.map((v,i)=>v+torque[i]/WING.inertia[i]*h);this.quaternion=advanceQ(this.quaternion,this.omega,h);
  const acceleration=mul(force,1/WING.mass);this.velocity=add(before,mul(acceleration,h));this.position=add(p,mul(add(before,this.velocity),h*.5));
  const midpoint=mul(add(before,this.velocity),.5);m.airWork+=dot(a.force,midpoint)*h;m.dragWork+=a.drag*a.speed*h;
  const travel=length(sub(this.position,p));this.distance+=travel;m.distance=this.distance;
  if(a.speed>WING.maxAirSpeed||Math.abs(m.load)>WING.maxLoad){m.limits++;this.crash('Airframe overload · reset to the summit');}
  // Sweep pilot and wing tips so a fast descending glider cannot tunnel through
  // a ridge or a wave. Landing requires low relative sink, speed and bank.
  const probes=[[0,-1.45,0],[-4.8,0,-1],[4.8,0,-1]];let hit=null;
  for(const local of probes){const arm=rotate(this.quaternion,local);for(let j=1;j<=Math.max(1,Math.ceil(travel/.5));j++){const f=j/Math.max(1,Math.ceil(travel/.5)),point=add(add(p,mul(sub(this.position,p),f)),arm),g=env.terrainAt?.(point[0],point[2])??-1000,w=env.waterAt?.(point[0],point[2])??0;const obstacle=env.obstacleAt?.(...point);if(obstacle||point[1]<Math.max(g,w)){hit={point,g,w,obstacle,tip:local[0]!==0};break;}}if(hit)break;}
  if(hit){
   m.impactSpeed=Math.max(0,-this.velocity[1]);m.landingSpeed=Math.hypot(this.velocity[0],this.velocity[2]);
   if(hit.obstacle){this.crash(`Impact with ${hit.obstacle}`);this.velocity=mul(this.velocity,.2);}
   else if(hit.w>hit.g+.08){this.crash('Water contact · glider and pilot are floating',true);this.position[1]=hit.w+1.2;}
   else{
    const slope=Math.hypot((env.terrainAt(hit.point[0]+1,hit.point[2])-env.terrainAt(hit.point[0]-1,hit.point[2]))*.5,(env.terrainAt(hit.point[0],hit.point[2]+1)-env.terrainAt(hit.point[0],hit.point[2]-1))*.5);
    const soft=!hit.tip&&m.impactSpeed<2.6&&m.landingSpeed<9.5&&Math.abs(att.bank)<.23&&slope<.30&&a.speed<18;
    this.position[1]=Math.max(this.position[1],hit.g+1.45);
    if(soft){this.phase='landed';this.reason=Math.hypot(this.position[0]-BEACH.x,this.position[2]-BEACH.z)<45?'Beach landing complete':'Controlled landing complete';this.velocity=[0,0,0];this.omega=[0,0,0];}
    else this.crash(`Ground impact · ${m.impactSpeed.toFixed(1)} m/s descent`);
   }
  }
  if(!finiteState(this)){this.reset();this.crash('Simulation limit reached · reset to fly again');m.limits++;}
 }
}
