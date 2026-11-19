import { GRAVITY as G, SEA_WATER_DENSITY as RHO, AIR_DENSITY, CARRIER, STEP } from './Constants.js';
import {add,sub,mul,dot,cross,length,rotate,rotateInto,inverseRotate,poseQ,advanceQ,attitude,clamp,finiteState} from './Math.js';

const spin=[0,0,0]; // scratch: the hull's angular velocity in world axes (rad/s), velocityAt()

export function insideDeck(x,z) {
 const p=CARRIER.deckPolygon;let inside=false;
 for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>z)!==(p[j][1]>z)&&x<(p[j][0]-p[i][0])*(z-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;
 return inside;
}
export function hydrostaticDisplacement(draftOffset){return clamp(CARRIER.mass/RHO+CARRIER.waterplane*draftOffset,0,CARRIER.mass/RHO*2.2);}
export class CarrierPhysics {
 constructor({position=[820,0,-940],yaw=Math.PI/2}={}){
  this.home=[...position];this.heading=yaw;this.position=[...position];this.velocity=[0,0,0];this.quaternion=poseQ(yaw);this.omega=[0,0,0];this.accumulator=0;this.time=0;
  this.samples=[];for(const z of [-125,-62.5,0,62.5,125])for(const x of [-14,14])this.samples.push([x,0,z]);
  this._sample=[0,0,0]; // scratch: one hull sample in world space (m), step()
  this.metrics={buoyancy:CARRIER.mass*G,displacedVolume:CARRIER.mass/RHO,waterMean:0,roll:0,pitch:0,heave:0,windForce:0,currentForce:0};
 }
 // world() and velocityAt() answer into `out` when given one (no allocation: the per-frame water queries and the
 // per-step hull samples), else into a new array as before. Same operations in the same order as add/rotate/cross/sub.
 world(local,out=[0,0,0]){
  rotateInto(out,this.quaternion,local);
  out[0]=this.position[0]+out[0];
  out[1]=this.position[1]+out[1];
  out[2]=this.position[2]+out[2];
  return out;
 }
 local(world){return inverseRotate(this.quaternion,sub(world,this.position));}
 velocityAt(world,out=[0,0,0]){
  const w=rotateInto(spin,this.quaternion,this.omega);
  const dx=world[0]-this.position[0],dy=world[1]-this.position[1],dz=world[2]-this.position[2];
  const cx=w[1]*dz-w[2]*dy,cy=w[2]*dx-w[0]*dz,cz=w[0]*dy-w[1]*dx;
  out[0]=this.velocity[0]+cx;
  out[1]=this.velocity[1]+cy;
  out[2]=this.velocity[2]+cz;
  return out;
 }
 runway(world){const p=this.local(world),d=sub(p,CARRIER.runwayOrigin);const s=Math.sin(CARRIER.runwayHeading),c=Math.cos(CARRIER.runwayHeading);return {cross:d[0]*c-d[2]*s,along:d[0]*s+d[2]*c,height:p[1]-CARRIER.deckY};}
 fromRunway(crossTrack,along,height=2){const s=Math.sin(CARRIER.runwayHeading),c=Math.cos(CARRIER.runwayHeading);return this.world([CARRIER.runwayOrigin[0]+crossTrack*c+along*s,CARRIER.deckY+height,CARRIER.runwayOrigin[2]-crossTrack*s+along*c]);}
 resetEffects(){this.velocity.fill(0);this.omega.fill(0);this.accumulator=0;}
 reset(){this.position=[...this.home];this.quaternion=poseQ(this.heading);this.resetEffects();this.time=0;}
 update(dt,env={}){this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,0.2);while(this.accumulator>=STEP){this.step(STEP,env);this.accumulator-=STEP;}}
 step(h,env={}){
  let mean=0,slopeX=0,slopeZ=0;
  for(let i=0;i<this.samples.length;i++){
   const local=this.samples[i],p=this.world(local,this._sample),surface=env.waterAt?.(p[0],p[2],i)??0;
   const water=Number.isFinite(surface)?surface:0;mean+=water/this.samples.length;
   slopeX+=water*local[0]/(this.samples.length*14*14);
   slopeZ+=water*local[2]/(2*(125**2+62.5**2)*2);
  }
  const displaced=hydrostaticDisplacement(mean-this.position[1]),buoyancy=RHO*G*displaced;
  const mass=CARRIER.mass,heaveK=RHO*G*CARRIER.waterplane,heaveD=2*0.38*Math.sqrt(heaveK*mass);
  const sample=env.sample?.(...this.position)||{},wind=[sample.wx||0,sample.wy||0,sample.wz||0],current=[sample.ux||0,0,sample.uz||0];
  const airRel=sub(wind,this.velocity),waterRel=sub(current,this.velocity);airRel[1]=waterRel[1]=0;
  const airSpeed=length(airRel),waterSpeed=length(waterRel);
  const windForce=mul(airRel,0.5*AIR_DENSITY*0.9*3800*airSpeed),currentForce=mul(waterRel,0.5*RHO*0.85*2700*waterSpeed);
  const moor=mul(sub(this.home,this.position),mass*0.0008);moor[1]=0;
  const force=add(add(windForce,currentForce),moor);force[1]=buoyancy-mass*G-heaveD*this.velocity[1];
  // Earthquake acceleration acts through the water/deck coupling only. Directly
  // adding ground acceleration to a floating ship would invent a rigid foundation.
  this.velocity=add(this.velocity,mul(force,h/mass));this.position=add(this.position,mul(this.velocity,h));
  const a=attitude(this.quaternion),rollTarget=-Math.atan(slopeX),pitchTarget=Math.atan(slopeZ);
  const rollK=mass*G*CARRIER.gmRoll,pitchK=mass*G*CARRIER.gmPitch;
  const torque=[pitchK*Math.sin(a.pitch-pitchTarget),0,rollK*Math.sin(a.bank-rollTarget)];
  // Above-water pressure centre is 22 m above the waterline; lateral wind heels her.
  const localWind=inverseRotate(this.quaternion,windForce);torque[2]-=22*localWind[0];torque[0]+=22*localWind[2];
  torque[1]=-mass*4*Math.sin(a.heading-this.heading);
  const stiffness=[pitchK,mass*4,rollK];
  for(let i=0;i<3;i++){
   const damp=2*CARRIER.damping[i]*Math.sqrt(stiffness[i]*CARRIER.inertia[i]);
   this.omega[i]+=(torque[i]-damp*this.omega[i])/CARRIER.inertia[i]*h;
  }
  this.quaternion=advanceQ(this.quaternion,this.omega,h);this.time+=h;
  Object.assign(this.metrics,{buoyancy,displacedVolume:displaced,waterMean:mean,roll:a.bank,pitch:a.pitch,heave:this.position[1],windForce:length(windForce),currentForce:length(currentForce)});
  if(!finiteState(this))throw new Error('Carrier physics produced a non-finite state');
 }
}
