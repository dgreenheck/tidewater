// Aviation uses metres, seconds, kilograms; right-handed axes, +Y up, +Z nose.
// For a +Z-facing aircraft, +X is chase-camera left; UI controls account for it.
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const mul=(a,s)=>a.map(v=>v*s);
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length=a=>Math.hypot(...a);
export const unit=a=>mul(a,1/Math.max(1e-12,length(a)));
export const qmul=(a,b)=>[
 a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
 a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
 a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
 a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
export const rotate=(q,v)=>{const t=mul(cross(q,v),2);return add(v,add(mul(t,q[3]),cross(q,t)));};
// rotate() into a caller array: the same products and sums in the same order, so bit for bit the same
// result, without the 7 arrays rotate() builds. out may be v. For the per-frame and per-step carrier
// callers (Aviation.queueQueries 10 points a frame, CarrierPhysics.step 10 points a 1/120 s step).
export function rotateInto(out,q,v){
 const tx=(q[1]*v[2]-q[2]*v[1])*2;
 const ty=(q[2]*v[0]-q[0]*v[2])*2;
 const tz=(q[0]*v[1]-q[1]*v[0])*2;
 const x=v[0]+(tx*q[3]+(q[1]*tz-q[2]*ty));
 const y=v[1]+(ty*q[3]+(q[2]*tx-q[0]*tz));
 const z=v[2]+(tz*q[3]+(q[0]*ty-q[1]*tx));
 out[0]=x;
 out[1]=y;
 out[2]=z;
 return out;
}
export const inverseRotate=(q,v)=>rotate([-q[0],-q[1],-q[2],q[3]],v);
export const axisQ=(axis,angle)=>[...mul(axis,Math.sin(angle/2)),Math.cos(angle/2)];
export const poseQ=(yaw=0,pitch=0,bank=0)=>qmul(qmul(axisQ([0,1,0],yaw),axisQ([1,0,0],-pitch)),axisQ([0,0,1],-bank));
export function advanceQ(q,w,h){const speed=length(w);if(speed<1e-12)return [...q];const out=qmul(q,axisQ(mul(w,1/speed),speed*h));const n=Math.hypot(...out);return out.map(v=>v/n);}
export const finiteState=s=>[...s.position,...s.velocity,...s.quaternion,...s.omega].every(Number.isFinite);
export function attitude(q){const f=rotate(q,[0,0,1]),u=rotate(q,[0,1,0]),r=rotate(q,[1,0,0]);return {heading:Math.atan2(f[0],f[2]),pitch:Math.asin(clamp(f[1],-1,1)),bank:Math.atan2(-r[1],u[1])};}
