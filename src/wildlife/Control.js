import { Vector3 } from '../engine/index.js';
import { GRAVITY } from '../physics/Loads.js';
export const SPECIES = Object.freeze({
 goat:Object.freeze({mass:55,half:[.24,.45,.64],area:.72,volume:55/950,height:.90,walk:1.05,flee:3.2,stride:.80,slope:.45,traction:.9,stance:.32}),
 cow:Object.freeze({mass:550,half:[.43,.72,1.12],area:2.7,volume:550/950,height:1.44,walk:.85,flee:2.5,stride:1.35,slope:.25,traction:.9,stance:.52})
});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
/** Actual angular velocity from two native point velocities, omega cross r.
 * Points are one metre along world X/Z from the current COM; no attitude differencing.
 */
export function angularVelocity(physics,id,position,velocity,out=new Vector3()){
 const x=physics.disaster_contact(id,new Float32Array([position.x+1,position.y,position.z]),new Float32Array([0,1,0]));
 const z=physics.disaster_contact(id,new Float32Array([position.x,position.y,position.z+1]),new Float32Array([0,1,0]));
 if(x.length<3||z.length<3)return out.set(0,0,0);
 return out.set(-(z[1]-velocity.y),((z[0]-velocity.x)-(x[2]-velocity.z))*.5,x[1]-velocity.y);
}
/** Assumed whole-body ground/stance actuator, not measured animal biomechanics.
 * Ground-only bounded forces and torques. Never writes pose or velocity. Actual
 * Coulomb contacts, environmental loads and gravity remain in the native solve.
 */
export function locomotion(spec,state,{velocity,supported,dt},out={}){
 out.fx=out.fy=out.fz=out.tx=out.ty=out.tz=0;
 if(!supported||state.disabled||!(dt>0))return out;
 const q=state.quaternion,inverse=q.clone().invert(),up=new Vector3(0,1,0).applyQuaternion(q),forward=new Vector3(0,0,1).applyQuaternion(q);
 const n=new Vector3().copy(state.normal??{x:0,y:1,z:0}).normalize(),dot=clamp(up.dot(n),-1,1),w=new Vector3().copy(state.angular??{x:0,y:0,z:0}),h=spec.half,weight=spec.mass*GRAVITY;
 const inertia=new Vector3(spec.mass*(h[1]**2+h[2]**2)/3,spec.mass*(h[0]**2+h[2]**2)/3,spec.mass*(h[0]**2+h[1]**2)/3);
 // I_world * alpha: diagonal inertia belongs to body axes, including when yawed.
 const torqueFor=alpha=>alpha.clone().applyQuaternion(inverse).multiply(inertia).applyQuaternion(q);
 const axis=new Vector3().crossVectors(up,n),sin=axis.length(),angle=Math.atan2(sin,dot);
 if(sin>1e-7)axis.multiplyScalar(angle/sin);
 else if(dot<0){ // An inverted box has no cross-product direction; roll about its length.
  axis.copy(forward).addScaledVector(n,-forward.dot(n));if(axis.lengthSq()<1e-8)axis.set(1,0,0).addScaledVector(n,-n.x);axis.normalize().multiplyScalar(Math.PI);
 }
 const yawRate=w.dot(n),leanRate=w.clone().addScaledVector(n,-yawRate);
 // Implicit PD gains bound the response while this force is held across native substeps.
 const kp=100,kd=20,gain=1/(1+kd*dt+kp*dt*dt),balance=torqueFor(axis.multiplyScalar(kp*gain).addScaledVector(leanRate,-kd*gain));
 balance.addScaledVector(n,-balance.dot(n));
 const limit=weight*spec.stance,balanceSize=balance.length();if(balanceSize>limit)balance.multiplyScalar(limit/balanceSize);
 const yaw=Math.atan2(forward.x,forward.z),turn=wrap((state.heading??yaw)-yaw),recovering=dot<.9;
 // Roll/pitch has first claim on finite stance effort. Turning uses only the remainder.
 const yawInertia=n.dot(torqueFor(n)),yawGain=1/(1+6*dt+12*dt*dt),yawDemand=yawInertia*((recovering?0:12*turn)-6*yawRate)*yawGain;
 const yawLimit=Math.sqrt(Math.max(0,limit*limit-balance.lengthSq()));balance.addScaledVector(n,clamp(yawDemand,-yawLimit,yawLimit));
 out.tx=balance.x;out.ty=balance.y;out.tz=balance.z;
 if(recovering){
  // A virtual leg extension unloads a grounded, tipped proxy, up to 45% of weight.
  // It is less than gravity, stops before upright, and is never applied without contact.
  out.fy=.45*weight*clamp((.9-dot)/.4,0,1);
 }else{
  const desired=state.desired??{x:0,z:0},speed=Math.hypot(desired.x,desired.z),flatForward=new Vector3(forward.x,0,forward.z).normalize(),right=new Vector3(flatForward.z,0,-flatForward.x);
  const align=speed?clamp((desired.x*flatForward.x+desired.z*flatForward.z)/speed,0,1):0,target=speed*align*align;
  const longitudinal=velocity.x*flatForward.x+velocity.z*flatForward.z,lateral=velocity.x*right.x+velocity.z*right.z;
  // Turn before taking a forward step. There is no sideways friction feed-forward.
  const feed=target>.05?.62*GRAVITY:0,gain=1/Math.max(.22,dt),steady=clamp((dot-.9)/.08,0,1);
  let along=((target-longitudinal)*gain+feed)*spec.mass,across=-lateral*gain*spec.mass;
  along=clamp(along,-weight*Math.min(spec.traction,.65*h[2]/h[1]),weight*Math.min(spec.traction,.65*h[2]/h[1]));
  across=clamp(across,-weight*.65*h[0]/h[1],weight*.65*h[0]/h[1]);
  const scale=steady*Math.min(1,weight*spec.traction/Math.max(1e-9,Math.hypot(along,across)));
  out.fx=(flatForward.x*along+right.x*across)*scale;out.fz=(flatForward.z*along+right.z*across)*scale;
 }
 if(!Object.values(out).every(Number.isFinite))throw new Error('Non-finite livestock motor load');
 return out;
}
