import { GRAVITY as G,AIR_DENSITY,SEA_WATER_DENSITY,AIRCRAFT as A,CARRIER,STEP } from './Constants.js';
import {add,sub,mul,dot,cross,length,unit,rotate,inverseRotate,poseQ,qmul,advanceQ,attitude,clamp,finiteState} from './Math.js';
import {insideDeck} from './CarrierPhysics.js';
import {dynamicPressure} from '../physics/Loads.js';

export function coefficientLoads(speed,{density=AIR_DENSITY,area=A.area,cl,cd}){const q=dynamicPressure(speed,density);return {q,lift:q*area*cl,drag:q*area*cd};}

export function absorberWork(force,speedBefore,speedAfter,h){return Math.max(0,force*(speedBefore+speedAfter)*0.5*h);}

export function aerodynamicCoefficients(alpha,flaps=0,gear=0,speed=0){
 const flap=clamp(flaps,0,1),a=clamp(alpha,-Math.PI/2,Math.PI/2),stall=A.stallAlpha+0.04*flap;
 const attached=A.cl0+A.flapLift*flap+A.clAlpha*a;
 const separated=1.05*Math.sin(2*a),blend=clamp((Math.abs(a)-stall)/0.22,0,1);
 const smooth=blend*blend*(3-2*blend),cl=attached*(1-smooth)+separated*smooth;
 const ar=A.span*A.span/A.area,induced=cl*cl/(Math.PI*ar*A.efficiency);
 const cd=A.cd0+0.065*flap+0.035*clamp(gear,0,1)+induced+1.1*Math.sin(a)**2*smooth+0.45*clamp((speed/340-0.68)/0.32,0,1)**2;
 return {cl,cd,induced,stall:Math.abs(a)>stall,stallAngle:stall};
}
export function aerodynamicLoads(relativeVelocity,quaternion,flaps=0,gear=0,altitude=0){
 const speed=length(relativeVelocity),v=unit(relativeVelocity),body=inverseRotate(quaternion,relativeVelocity);
 const alpha=Math.atan2(-body[1],Math.max(0.01,Math.abs(body[2]))),beta=Math.atan2(body[0],Math.max(0.01,Math.hypot(body[1],body[2])));
 const density=AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500),q=dynamicPressure(speed,density);
 const c=aerodynamicCoefficients(alpha,flaps,gear,speed),up=rotate(quaternion,[0,1,0]),right=rotate(quaternion,[1,0,0]);
 const liftAxis=unit(cross(v,right)),{lift,drag}=coefficientLoads(speed,{density,cl:c.cl,cd:c.cd});
 const side=-q*A.area*0.55*Math.sin(beta);
 const force=add(add(mul(liftAxis,lift),mul(v,-drag)),mul(right,side));
 return {force,lift,drag,side,q,speed,alpha,beta,density,...c};
}
const LIMIT_G=7.3; // g: commanded ceiling, so the overshoot stays under the 7.5 g limit
const PUSH_G=-2; // g: full forward stick
const ALPHA_MARGIN=0.85; // fraction of the stall AoA the limiter allows: no accidental stall or spin
const ALPHA_FLOOR=-0.15; // rad: most negative AoA the limiter commands
const ROLL_RATE=Math.PI; // rad/s: 180 deg/s full-stick roll at speed
const ROLL_Q=9000; // Pa: full roll rate from this dynamic pressure up (about 120 m/s at sea level)
const RUDDER_RATE=0.3; // rad/s: yaw rate that full rudder adds
const RUDDER_BANK=0.6; // rad: bank (35 deg) that full rudder alone rolls toward, so A and D turn the jet
const K_ALPHA=3; // 1/s: AoA error to pitch-rate command
const K_BETA=4; // 1/s: sideslip to yaw-rate command; this is the turn coordination
const K_BANK=2; // 1/s: bank error to roll-rate command (autopilot wings level, rudder bank)
const RATE_GAINS=[4.1,2.8,4.5]; // 1/s: body-rate tracking, scaled by dynamic-pressure authority
const PITCH_STIFFNESS=0.25;
const RATES=[0,0,0]; // scratch: commanded body rates, rad/s (x pitch, nose-up negative; y yaw; z roll)
const NOSE_POINT=[0,0,0]; // scratch: nose-gear contact point with the strut extension applied
// One-key launch. Reference: a C-13 steam catapult strokes about 94 m to about 150 kt
// (77 m/s) in about 2.5 s; carrier jets launch from an extended nose strut, nose-up.
const LAUNCH_PITCH=6*Math.PI/180; // rad: nose-up on the catapult so the jet leaves climbing (declared)
export const NOSE_STRUT=0.736; // m: extension that gives LAUNCH_PITCH over the 7.0 m wheelbase
const STRUT_TIME=1.2; // s: the strut retracts after lift-off
const SPOOL_ENGINE=0.85; // engine fraction before the brake comes off and the shot fires (about 1.1 s)
const ROTATE_ALPHA=10*Math.PI/180; // rad: rotation AoA off the bow, wings level
const CLIMB_GAMMA=15*Math.PI/180; // rad: climb-out flight path
const GEAR_UP_HEIGHT=15; // m above the deck, with a positive climb
const FLAPS_UP_SPEED=110; // m/s
const HANDOVER_ALTITUDE=150; // m: the pilot gets the jet here, or on any stick input off the deck
const EMPTY_METRICS=()=>({speed:0,q:0,alpha:0,beta:0,lift:0,drag:0,thrust:0,loadFactor:0,contacts:0,gearCompression:[0,0,0],heading:0,pitch:0,bank:0,catapultRun:0,catapultForce:0,cableForce:0,peakCableForce:0,cableEnergy:0,landingDistance:0,deckSink:0,waterImpactEnergy:0,windSpeed:0,stall:false,energy:0});

export class FlightPhysics {
 constructor(carrier){this.carrier=carrier;this.controls={throttle:0,pitch:0,roll:0,yaw:0,flaps:0.6,gear:true,hook:false,brake:true};this.accumulator=0;this.reset();}
 reset(){
  // The jet sits LAUNCH_PITCH nose-up on its extended nose strut, main gear 0.09 m
  // into its springs. Level (all gear points at y -2) it left the bow at 0 deg pitch
  // with lift 0.62 of weight and sank 13 m in 8 s (2026-10-05).
  const rest=-rotate(poseQ(0,LAUNCH_PITCH),A.gearPoints[1])[1]-0.09;
  this.position=this.carrier.world([CARRIER.launch[0],CARRIER.deckY+rest,CARRIER.launch[2]]);this.velocity=this.carrier.velocityAt(this.position);this.quaternion=qmul(this.carrier.quaternion,poseQ(0,LAUNCH_PITCH));this.omega=[0,0,0];this.previous=[...this.position];
  this.phase='ready';this.reason='Hold W to launch';this.auto=null;this.noseStrut=1;this.controls={throttle:0,pitch:0,roll:0,yaw:0,flaps:0.6,gear:true,hook:false,brake:true};
  this.engine=0;this.gear=1;this.hook=0;this.flaps=0.6;this.catapult=null;this.cable=null;this.crashAge=0;this.time=0;this.accumulator=0;this.metrics=EMPTY_METRICS();this.lastHook=null;this.approachStart=null;this.groundedLast=true;this.everAirborne=false;this.lastImpact=null;this.launchCount=0;
 }
 startApproach(env={}){
  this.reset();const distance=620,glide=3.5*Math.PI/180,speed=68;
  this.position=this.carrier.fromRunway(0,-distance,1.88+distance*Math.tan(glide));
  const q=0.5*AIR_DENSITY*speed*speed,alpha=(A.mass*G/(q*A.area)-A.cl0-A.flapLift)/A.clAlpha;
  this.quaternion=qmul(this.carrier.quaternion,poseQ(CARRIER.runwayHeading,alpha-glide));
  const horizontal=rotate(this.carrier.quaternion,rotate(poseQ(CARRIER.runwayHeading),[0,0,speed*Math.cos(glide)]));
  // Far-field approach velocity follows carrier translation, not omega cross a
  // 620m virtual deck extension, which would invent vertical approach velocity.
  this.velocity=add([this.carrier.velocity[0],0,this.carrier.velocity[2]],add(horizontal,[0,-speed*Math.sin(glide),0]));
  this.noseStrut=0;this.controls={throttle:0.185,pitch:0,roll:0,yaw:0,flaps:1,gear:true,hook:false,brake:false};this.engine=this.controls.throttle;this.gear=1;this.flaps=1;this.phase='airborne';this.reason='Training approach: lower hook (H), hold 68 m/s and follow the landing line';
  // Trim the initial approach to the actual shared ambient wind. The preset
  // establishes a start; subsequent controls/forces alone determine touchdown.
  const windSample=env.sample?.(...this.position)||{},wind=[windSample.wx||0,windSample.wy||0,windSample.wz||0];
  const air=sub(this.velocity,wind),vAir=length(air),airQ=0.5*AIR_DENSITY*Math.exp(-Math.max(0,this.position[1])/8500)*vAir*vAir;
  let trimAlpha=clamp((A.mass*G/(airQ*A.area)-A.cl0-A.flapLift)/A.clAlpha,-.05,.24);
  const gamma=Math.atan2(air[1],Math.hypot(air[0],air[2]));
  let requiredThrust=0;
  for(let i=0;i<8;i++){
   const cd=aerodynamicCoefficients(trimAlpha,1,1,vAir).cd;
   requiredThrust=(airQ*A.area*cd+A.mass*G*Math.sin(gamma))/Math.cos(trimAlpha);
   const requiredLift=A.mass*G*Math.cos(gamma)-requiredThrust*Math.sin(trimAlpha);
   trimAlpha=clamp((requiredLift/(airQ*A.area)-A.cl0-A.flapLift)/A.clAlpha,-.05,.24);
  }
  this.quaternion=poseQ(Math.atan2(air[0],air[2]),gamma+trimAlpha);
  this.controls.throttle=clamp(requiredThrust/(A.maxThrust*Math.exp(-Math.max(0,this.position[1])/18000)*(1-vAir/750)),0,1);this.engine=this.controls.throttle;
  this.previous=[...this.position];this.approachStart=[...this.position];this.everAirborne=true;this.groundedLast=false;
 }
 autoLaunch(){
  if(this.phase==='crashed'||this.phase==='ditched')return 'Reset the damaged aircraft first';
  if(this.auto)return null;
  if(this.phase!=='ready')return 'Return to the catapult with Reset aircraft';
  this.auto={stage:'spool',attitude:true,gearDone:false,flapsDone:false};
  this.controls.throttle=1;
  this.controls.flaps=0.6;
  this.controls.gear=true;
  this.reason='Catapult';
  return null;
 }
 // S while the engine spools cancels the shot; once the catapult fires it is committed.
 abortLaunch(){
  if(this.auto?.stage!=='spool')return false;
  this.auto=null;
  this.controls.throttle=0;
  this.controls.brake=true;
  this.reason='Hold W to launch';
  return true;
 }
 autopilot(aero,gamma){
  const auto=this.auto,c=this.controls;
  if(!auto)return;
  if(auto.stage==='spool'){
   c.throttle=1;
   if(this.engine<SPOOL_ENGINE)return;
   c.brake=false;
   const error=this.requestLaunch();
   if(error){
    this.auto=null;
    this.reason=error;
    return;
   }
   auto.stage='catapult';
   return;
  }
  if(auto.stage==='catapult'){
   if(!this.catapult){
    auto.stage='rotate';
    this.reason='Rotating';
   }
   return;
  }
  if(auto.stage==='rotate'&&gamma>=CLIMB_GAMMA*0.9)auto.stage='climb';
  const height=this.carrier.local(this.position)[1]-CARRIER.deckY;
  if(!auto.gearDone&&height>GEAR_UP_HEIGHT&&this.velocity[1]>0){
   c.gear=false;
   auto.gearDone=true;
  }
  if(!auto.flapsDone&&aero.speed>FLAPS_UP_SPEED){
   c.flaps=0;
   auto.flapsDone=true;
  }
  if(auto.attitude){
   if(c.pitch||c.roll||c.yaw||this.position[1]>=HANDOVER_ALTITUDE){
    auto.attitude=false;
    this.reason='You have control';
   }else this.reason=auto.gearDone?'Climbing, gear up':auto.stage==='rotate'?'Rotating':'Climbing';
  }
  // Gear and flap housekeeping finishes after the handover unless the pilot takes them.
  if(!auto.attitude&&auto.gearDone&&auto.flapsDone)this.auto=null;
 }
 // Fly-by-wire command law. The stick commands load factor; the limiter caps it at
 // LIMIT_G and the AoA at ALPHA_MARGIN of the stall; neutral stick holds the flight
 // path through a bank; the yaw channel drives sideslip to zero. Body rates track
 // the turn rate of the velocity vector itself. Defect 2026-10-05: the old law drove
 // body rates to zero, so neutral stick fought the turn a bank needs (48 deg bank
 // released: 6 deg of heading in 5 s, 82 m lost, 3.2 deg sideslip) and full back
 // stick at 150 m/s reached 29.8 deg AoA and 5.4 g in 2 s. Writes RATES, returns
 // the commanded AoA (rad) that the pitch stiffness trims about.
 commandRates(aero,relative,thrust,forward,att,gamma){
  const c=this.controls,auto=this.auto?.attitude?this.auto:null,speed=aero.speed,flaps=clamp(this.flaps,0,1);
  const pitch=auto?0:clamp(c.pitch,-1,1),roll=auto?0:clamp(c.roll,-1,1),yaw=auto?0:clamp(c.yaw,-1,1);
  const stall=A.stallAlpha+0.04*flaps;
  if(this.groundedLast||speed<30){
   // On the deck the gear holds the attitude: plain rate commands, no trim moment.
   // The autopilot rotates off the bow to ROTATE_ALPHA once the shot has ended.
   const rotating=auto&&auto.stage!=='spool'&&auto.stage!=='catapult';
   RATES[0]=rotating?-K_ALPHA*(ROTATE_ALPHA-aero.alpha):-pitch*0.5;
   RATES[1]=yaw*0.32;
   RATES[2]=-roll*1.15;
   return rotating?ROTATE_ALPHA:aero.alpha;
  }
  // Turn rate of the flight path from the free-flight forces: v x a / V (rad/s, world).
  const ax=(aero.force[0]+forward[0]*thrust)/A.mass,ay=(aero.force[1]+forward[1]*thrust)/A.mass-G,az=(aero.force[2]+forward[2]*thrust)/A.mass;
  const vx=relative[0]/speed,vy=relative[1]/speed,vz=relative[2]/speed;
  const path=inverseRotate(this.quaternion,[(vy*az-vz*ay)/speed,(vz*ax-vx*az)/speed,(vx*ay-vy*ax)/speed]);
  // The load factor that holds the flight path in a bank is cos(gamma) / cos(bank). It
  // fades to 0 g at knife edge and -1 g inverted, so it never pulls toward the ground.
  const cosBank=Math.cos(att.bank),level=Math.cos(gamma)*cosBank/Math.max(cosBank*cosBank,0.25);
  let load=pitch>=0?level+pitch*(LIMIT_G-level):level+pitch*(level-PUSH_G);
  if(auto)load=level+clamp(0.8*(CLIMB_GAMMA-gamma)*speed/G,-0.6,1.5);
  const qS=Math.max(aero.q,600)*A.area;
  let alpha=((load*A.mass*G-thrust*Math.sin(aero.alpha))/qS-A.cl0-A.flapLift*flaps)/A.clAlpha;
  if(auto&&auto.stage==='rotate')alpha=ROTATE_ALPHA;
  alpha=clamp(alpha,ALPHA_FLOOR,ALPHA_MARGIN*stall);
  // Right bank is a negative attitude bank. The autopilot holds wings level; rudder
  // alone rolls toward RUDDER_BANK; otherwise the stick commands roll rate.
  const rollRate=ROLL_RATE*clamp(aero.q/ROLL_Q,0.3,1);
  let bankRate=-roll*rollRate;
  if(auto)bankRate=K_BANK*att.bank;
  else if(yaw&&!roll)bankRate=clamp(K_BANK*(-yaw*RUDDER_BANK+att.bank),-0.4*rollRate,0.4*rollRate);
  RATES[0]=path[0]-K_ALPHA*(alpha-aero.alpha);
  RATES[1]=path[1]+K_BETA*aero.beta*(1-0.7*Math.abs(yaw))+yaw*RUDDER_RATE;
  RATES[2]=path[2]+bankRate;
  return alpha;
 }
 requestLaunch(){
  const local=this.carrier.local(this.position),rel=inverseRotate(this.carrier.quaternion,sub(this.velocity,this.carrier.velocityAt(this.position)));
  const direction=inverseRotate(this.carrier.quaternion,rotate(this.quaternion,[0,0,1]));
  if(this.phase==='crashed'||this.phase==='ditched')return 'Reset the damaged aircraft first';
  if(this.controls.throttle<0.8)return 'Set throttle to at least 80%';
  if(this.controls.brake)return 'Release the wheel brake';
  if(this.gear<0.95||Math.abs(local[0]-CARRIER.launch[0])>1.8||Math.abs(local[2]-CARRIER.launch[2])>5||Math.abs(local[1]-CARRIER.deckY-1.9)>0.65||length(rel)>8||direction[2]<0.99)return 'Return to the catapult with Reset aircraft';
  this.catapult={start:local[2],run:0};this.phase='launching';this.reason='Catapult';this.launchCount++;return null;
 }
 update(dt,env={}){this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,0.2);let steps=0;while(this.accumulator>=STEP){this.step(STEP,env);this.accumulator-=STEP;steps++;}return steps;}
 crash(reason,kind='crashed'){
  if(this.phase==='crashed'||this.phase==='ditched')return;
  this.phase=kind;this.reason=reason;this.controls.throttle=0;this.engine=0;this.catapult=null;this.cable=null;this.crashAge=0;
 }
 step(h,env={}){
  const p=this.position,q=this.quaternion,c=this.controls,m=this.metrics;
  const sample=env.sample?.(...p)||{},wind=[sample.wx||0,sample.wy||0,sample.wz||0];
  const sea=env.waterAt?.(p[0],p[2])??0,water=Number.isFinite(sea)?sea:0;
  const relative=sub(this.velocity,wind),aero=aerodynamicLoads(relative,q,this.flaps,this.gear,p[1]);
  this.engine+=(clamp(c.throttle,0,1)-this.engine)*(1-Math.exp(-h/0.6));
  this.gear+=clamp((c.gear?1:0)-this.gear,-h/1.4,h/1.4);this.hook+=clamp((c.hook?1:0)-this.hook,-h/0.65,h/0.65);this.flaps+=clamp(clamp(c.flaps,0,1)-this.flaps,-h/1.1,h/1.1);
  const forward=rotate(q,[0,0,1]),a=attitude(q),damaged=this.phase==='crashed'||this.phase==='ditched';
  const thrust=damaged?0:A.maxThrust*this.engine*Math.exp(-Math.max(0,p[1])/18000)*clamp(1-aero.speed/750,0.4,1);
  let force=add(aero.force,mul(forward,thrust));force[1]-=A.mass*G;let cableWork=null;
  let torque=[0,0,0];
  if(!damaged){
   const gamma=Math.atan2(relative[1],Math.hypot(relative[0],relative[2]));
   this.autopilot(aero,gamma);
   // Control authority falls with dynamic pressure; no attitude or velocity snap.
   const authority=clamp(aero.q/2500,0,2.8),alphaCommand=this.commandRates(aero,relative,thrust,forward,a,gamma);
   for(let i=0;i<3;i++)torque[i]=A.inertia[i]*(RATES[i]-this.omega[i])*RATE_GAINS[i]*authority;
   // Static pitch stiffness about the commanded AoA (the trim the law sets), plus
   // weathercock and dihedral from sideslip.
   torque[0]+=aero.q*A.area*A.chord*PITCH_STIFFNESS*(aero.alpha-alphaCommand);
   torque[1]+=aero.q*A.area*A.span*0.11*aero.beta;
   torque[2]+=-aero.q*A.area*A.span*0.015*aero.beta;
  }else{torque=mul(this.omega,-90000);this.crashAge+=h;}
  // The launch nose strut stays out on the catapult and retracts once airborne.
  this.noseStrut=clamp(this.noseStrut+((this.phase==='ready'||this.phase==='launching')&&!this.everAirborne?h:-h)/STRUT_TIME,0,1);
  NOSE_POINT[0]=A.gearPoints[0][0];
  NOSE_POINT[1]=A.gearPoints[0][1]-NOSE_STRUT*this.noseStrut;
  NOSE_POINT[2]=A.gearPoints[0][2];
  let contacts=0,maxSink=0;const compress=[0,0,0],up=rotate(this.carrier.quaternion,[0,1,0]);
  const local=this.carrier.local(p),deckVelocity=this.carrier.velocityAt(p);
  if(this.gear>0.9){
   for(let i=0;i<A.gearPoints.length;i++){
    const arm=rotate(q,i===0?NOSE_POINT:A.gearPoints[i]),point=add(p,arm),cp=this.carrier.local(point);
    if(!insideDeck(cp[0],cp[2]))continue;
    const penetration=CARRIER.deckY-cp[1];
    if(penetration<=0||penetration>4)continue;
    const pointVelocity=add(this.velocity,cross(rotate(q,this.omega),arm));
    const relativePoint=sub(pointVelocity,this.carrier.velocityAt(point)),sink=-dot(relativePoint,up);
    const normal=clamp(A.gearK*penetration+A.gearC*sink,0,A.mass*G*2.5);
    if(normal<=0)continue;contacts++;maxSink=Math.max(maxSink,sink);compress[i]=clamp(penetration,0,A.gearTravel);
    let f=mul(up,normal),horizontal=sub(relativePoint,mul(up,dot(relativePoint,up))),speed=length(horizontal);
    const coeff=c.brake?0.65:0.018,friction=Math.min(coeff*normal,A.mass*speed/(3*h));
    f=add(f,mul(unit(horizontal),-friction));force=add(force,f);torque=add(torque,inverseRotate(q,cross(arm,f)));
    if(penetration>A.gearTravel+0.5)this.crash('Landing gear collapsed: excessive deck penetration');
   }
  }
  if(contacts&&!this.groundedLast&&this.everAirborne){
   m.deckSink=maxSink;const inCarrier=inverseRotate(this.carrier.quaternion,forward),heading=Math.atan2(inCarrier[0],inCarrier[2]);
   const badHeading=Math.abs(Math.atan2(Math.sin(heading-CARRIER.runwayHeading),Math.cos(heading-CARRIER.runwayHeading)))>A.maxLandingHeading;
   if(maxSink>A.maxLandingSink||Math.abs(a.bank-attitude(this.carrier.quaternion).bank)>A.maxLandingBank||a.pitch< -0.10||a.pitch>0.40||badHeading)this.crash(`Hard deck impact (${maxSink.toFixed(1)} m/s relative descent)`);
   else if(!this.cable){this.phase='touchdown';this.reason='On deck: hook must cross an arresting wire';}
  }
  this.groundedLast=contacts>0;
  // Belly and island collisions are separate from wheel support. A gear-up pass
  // at deck height cannot masquerade as a successful wheeled landing.
  if(insideDeck(local[0],local[2])&&local[1]<CARRIER.deckY+0.9&&local[1]>-9){this.crash('Aircraft struck the flight deck');if(local[1]<CARRIER.deckY+0.6){const correction=mul(up,CARRIER.deckY+0.6-local[1]);this.position=add(this.position,correction);const vn=dot(this.velocity,up);if(vn<0)this.velocity=sub(this.velocity,mul(up,1.2*vn));}}
  if(local[0]>19&&local[0]<36&&local[2]>-28&&local[2]<31&&local[1]>CARRIER.deckY&&local[1]<CARRIER.deckY+31)this.crash('Collision with the carrier island');
  const ground=env.terrainAt?.(p[0],p[2])??-1000;
  if(ground>water-0.5&&p[1]-1.0<ground){this.crash('Terrain impact');this.position[1]=Math.max(this.position[1],ground+1);this.velocity=mul(this.velocity,Math.exp(-h*7));if(this.velocity[1]<0)this.velocity[1]=0;force[1]=Math.max(0,force[1]);}
  m.catapultForce=0;
  if(this.catapult&&!damaged){
   const rail=this.catapult,relVel=inverseRotate(this.carrier.quaternion,sub(this.velocity,deckVelocity));rail.run=Math.max(0,local[2]-rail.start);m.catapultRun=rail.run;
   if(rail.run>=A.catapultLength||relVel[2]>=A.catapultSpeed){this.catapult=null;this.reason='Catapult released: continue the climb';}
   else{
    const catForce=A.catapultForce*clamp((A.catapultSpeed-relVel[2])/8,0,1);m.catapultForce=catForce;
    force=add(force,rotate(this.carrier.quaternion,[-(local[0]-CARRIER.launch[0])*350000-relVel[0]*130000,0,catForce]));
    torque[1]+=-A.inertia[1]*(Math.atan2(inverseRotate(this.carrier.quaternion,forward)[0],inverseRotate(this.carrier.quaternion,forward)[2])*15+this.omega[1]*6);
   }
  }
  const hookPoint=add(this.position,rotate(q,[0,-1.5-0.75*this.hook,-7.1])),hookRun=this.carrier.runway(hookPoint);
  if(!damaged&&!this.cable&&this.hook>0.92&&contacts&&this.lastHook&&this.everAirborne){
   for(const wire of CARRIER.wires){
    const fraction=(wire-this.lastHook.along)/Math.max(1e-9,hookRun.along-this.lastHook.along);
    const crossingCross=this.lastHook.cross+(hookRun.cross-this.lastHook.cross)*fraction;
    const crossingHeight=this.lastHook.height+(hookRun.height-this.lastHook.height)*fraction;
    if(this.lastHook.along<=wire&&hookRun.along>=wire&&Math.abs(crossingCross)<12&&crossingHeight<0.5&&crossingHeight> -1){
     const speed=length(sub(this.velocity,deckVelocity));
     if(speed>18&&speed<105){this.cable={wire,payout:0,energy:0,initialSpeed:speed};this.phase='arresting';this.reason='Arresting wire captured';break;}
    }
   }
  }
  this.lastHook=hookRun;m.cableForce=0;
  if(this.cable){
   const cable=this.cable,relativeVel=sub(this.velocity,deckVelocity),v=length(relativeVel);cable.payout=Math.max(0,hookRun.along-cable.wire);
   // Equal cable branches pull toward the fixed port/starboard wire endpoints.
   // A hydraulic absorber resists outward payout only; a reversing aircraft
   // makes the cable slack and cannot be pushed back away from its anchors.
   const left=this.carrier.fromRunway(-12.5,cable.wire,.12),right=this.carrier.fromRunway(12.5,cable.wire,.12);
   const leftDelta=sub(hookPoint,left),rightDelta=sub(hookPoint,right);
   const awayLeft=sub(leftDelta,mul(up,dot(leftDelta,up))),awayRight=sub(rightDelta,mul(up,dot(rightDelta,up)));
   const direction=unit(add(unit(awayLeft),unit(awayRight))),outward=dot(relativeVel,direction);
   const demand=A.mass*cable.initialSpeed**2/(2*80);
   const cableForce=cable.payout>0&&outward>0?Math.min(A.cableMaxForce,demand,A.mass*outward/h):0;
   force=add(force,mul(direction,-cableForce));m.cableForce=cableForce;m.peakCableForce=Math.max(m.peakCableForce,cableForce);
   cableWork={cable,force:cableForce,direction,before:outward,deckVelocity};
   c.throttle=0;c.brake=true;
   if(cable.payout>A.cableStroke||cable.energy>A.cableEnergy){this.cable=null;this.phase='bolter';this.reason='Arresting limit exceeded: go around';}
   else if(v<1.2&&contacts){this.phase='arrested';this.reason='Arrested landing complete';}
  }
  if(this.everAirborne&&!contacts&&!this.cable&&this.phase==='touchdown'){this.phase='bolter';this.reason='Bolter: add power and climb away';}
  if(!contacts&&!this.catapult&&local[1]>CARRIER.deckY+2.2&&!damaged&&this.phase!=='arresting'&&this.phase!=='arrested'&&this.phase!=='bolter'){this.phase='airborne';this.everAirborne=true;}
  // Actual water contact ends powered flight. A damaged sealed volume briefly
  // floats, then progressively floods. Quadratic drag is integrated implicitly.
  if(p[1]-1.15<water){
   if(!damaged){m.waterImpactEnergy=0.5*A.mass*Math.max(0,-this.velocity[1])**2;this.lastImpact={x:p[0],z:p[2],energy:m.waterImpactEnergy};this.crash('Water impact: aircraft flooding','ditched');}
   const wet=clamp((water-(p[1]-1.15))/2.2,0,1),sealed=20*Math.exp(-this.crashAge/32);
   force=[0,SEA_WATER_DENSITY*G*sealed*wet-A.mass*G,0];
   const current=[sample.ux||0,0,sample.uz||0],rv=sub(this.velocity,current),dragFactor=0.5*SEA_WATER_DENSITY*0.9*20*wet/A.mass;
   this.velocity=add(current,mul(rv,1/(1+dragFactor*length(rv)*h)));
   this.omega=mul(this.omega,Math.exp(-h*2.5*wet));
  }
  this.previous=[...this.position];this.velocity=add(this.velocity,mul(force,h/A.mass));this.position=add(this.position,mul(this.velocity,h));
  // Body Euler equation includes the gyroscopic coupling term omega x I omega.
  const angularMomentum=this.omega.map((w,i)=>w*A.inertia[i]),gyro=cross(this.omega,angularMomentum);
  for(let i=0;i<3;i++)this.omega[i]+=(torque[i]-gyro[i])/A.inertia[i]*h;
  this.quaternion=advanceQ(this.quaternion,this.omega,h);this.time+=h;
  if(cableWork){const after=dot(sub(this.velocity,cableWork.deckVelocity),cableWork.direction);cableWork.cable.energy+=absorberWork(cableWork.force,cableWork.before,after,h);m.cableEnergy=cableWork.cable.energy;}
  const now=attitude(this.quaternion);
  Object.assign(m,{speed:aero.speed,q:aero.q,alpha:aero.alpha,beta:aero.beta,lift:aero.lift,drag:aero.drag,thrust,loadFactor:aero.lift/(A.mass*G),contacts,gearCompression:compress,heading:now.heading,pitch:now.pitch,bank:now.bank,windSpeed:length(wind),stall:aero.stall,energy:0.5*A.mass*dot(this.velocity,this.velocity)+A.mass*G*this.position[1]});
  if(this.approachStart)m.landingDistance=length(sub(this.position,this.approachStart));
  if(!finiteState(this))throw new Error('Flight physics produced a non-finite state');
 }
}
