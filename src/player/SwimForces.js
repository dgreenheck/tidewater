import { Vector3 } from '../engine/index.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, quadraticDrag } from '../physics/Loads.js';

// Assumed streamlined swimming area, adult mass and voluntary actuator budget.
// These tune a game controller; they are not human performance/survival limits.
export const SWIM_BODY=Object.freeze({mass:75,area:.18,volume:.075,height:1.8,buoyancy:false,supported:false});
export const SWIM_PROPULSION=7.5;

// The same held-step drag law as DisasterField, evaluated ONLY in still fluid at
// the bounded command velocity. Actual current/body velocity never enters this
// propulsion calibration, so it cannot cancel incoming current or wind.
function calmDrag(v,wet,dt,out,body=SWIM_BODY) {
 const air=quadraticDrag({}, {x:-v.x,y:-v.y,z:-v.z},{area:body.area,dragCoefficient:1.1});
 const a=1+dt*.5*AIR_DENSITY*1.1*body.area*v.length()/body.mass;
 out.set(air.x,air.y,air.z).multiplyScalar(1/body.mass/a);
 const relative={x:-v.x-dt*out.x,y:0,z:-v.z-dt*out.z};
 const water=quadraticDrag({},relative,{density:SEA_WATER_DENSITY,area:body.area*wet});
 const w=1+dt*.5*SEA_WATER_DENSITY*body.area*wet*Math.hypot(relative.x,relative.z)/body.mass;
 out.x+=water.x/body.mass/w;out.z+=water.z/body.mass/w;
 return out;
}

export class SwimMotor {
 constructor(body=SWIM_BODY){this.body={...SWIM_BODY,...body};this.command=new Vector3();this.calm=new Vector3();this.thrust=new Vector3();this.at=new Vector3();this.load={};this.maxAcceleration=0;}
 reset(){this.command.set(0,0,0);}
 advance(player,target,dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  const field=player.environment;
  // Isolated scenes without a shared field retain the calm response, with the
  // same explicit actuator bound rather than clamping an incoming velocity.
  if(!field){const h=Math.min(.1,dt);this.thrust.copy(target).sub(player.velocity).multiplyScalar((1-Math.exp(-3*h))/h);if(this.thrust.length()>SWIM_PROPULSION)this.thrust.setLength(SWIM_PROPULSION);player.velocity.addScaledVector(this.thrust,h);return;}
  const count=Math.max(1,Math.ceil(Math.min(.1,dt)*60)),h=Math.min(.1,dt)/count;
  for(let i=0;i<count;i++){
   this.at.copy(player.position);this.at.y-=.558; // float point -> actual torso COM
   const load=field.acceleration(this.at,player.velocity,{...this.body,dt:h},this.load);
   const k=1-Math.exp(-3*h);
   calmDrag(this.command,load.wet,h,this.calm,this.body);
   this.thrust.copy(target).sub(this.command).multiplyScalar(k/h).sub(this.calm);
   if(this.thrust.length()>SWIM_PROPULSION)this.thrust.setLength(SWIM_PROPULSION);
   this.command.lerp(target,k);
   this.maxAcceleration=Math.max(this.maxAcceleration,this.thrust.length());
   player.velocity.addScaledVector(this.thrust,h);
   player.velocity.x+=load.ax*h;player.velocity.y+=load.ay*h;player.velocity.z+=load.az*h;
  }
 }
}
