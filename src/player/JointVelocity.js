import { ArticulatedMass } from './ArticulatedMass.js';
// Passive, fixed-pose velocity constraints for the articulated capsules.
// Position corrections retain their separate job of repairing geometric error.
// Common-anchor impulses conserve total linear/angular momentum. Passivity
// belongs to the complete implicit viscosity/contact solve with its accumulated
// impulses, not to each response increment in isolation.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const add=(a,b,s=1)=>({x:a.x+s*b.x,y:a.y+s*b.y,z:a.z+s*b.z});
const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const length=a=>Math.hypot(a.x,a.y,a.z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rotate(q,v){const t=scale(cross(q,v),2);return add(add(v,t,q.w),cross(q,t));}
function velocityAt(b,r){return add(b.v,cross(b.w,r));}
function atanGradient(y,x,gy,gx){const d=x*x+y*y;return d>1e-14?scale(add(scale(gy,x),gx,-y),1/d):{x:0,y:0,z:0};}
export function jointCoordinates(p,c){
 const a2=rotate(c.q,c.ax),out=[];
 if(c.hinge){
  const h1=rotate(p.q,c.hP),h2=rotate(c.q,c.hC),d=clamp(dot(a2,h1),-1,1),e=Math.asin(d);
  out.push({kind:'plane',angle:e,min:-c.cone,max:c.cone,n:scale(cross(a2,h1),1/Math.sqrt(Math.max(1e-12,1-d*d)))});
  const d1=dot(h1,a2),d2=dot(h2,a2),y=dot(cross(h1,h2),a2),x=dot(h1,h2)-d1*d2;
  const gy=add(cross(h2,cross(a2,h1)),cross(a2,cross(h1,h2))),gx=add(cross(h2,h1),cross(a2,h1),-d2);
  out.push({kind:'twist',angle:Math.atan2(y,x),min:-c.twist,max:c.twist,n:atanGradient(y,x,gy,gx)});
  const a1=rotate(p.q,p.ax),fy=dot(cross(a1,a2),h1),fx=dot(a1,a2);
  out.push({kind:'flex',angle:Math.atan2(fy,fx),min:c.hinge[0],max:c.hinge[1],n:atanGradient(fy,fx,cross(a2,cross(h1,a1)),cross(a2,a1))});
 }else{
  const a1=rotate(p.q,c.aN),crossAxis=cross(a1,a2),s=length(crossAxis),th=Math.atan2(s,dot(a1,a2));
  out.push({kind:'cone',angle:th,min:-Infinity,max:c.cone,n:s>1e-8?scale(crossAxis,1/s):{x:0,y:0,z:0}});
  const sum=add(a1,a2),len=length(sum);if(len<1e-3)return out;const n=scale(sum,1/len),b1=rotate(p.q,c.bN),b2=rotate(c.q,c.bC),d1=dot(b1,n),d2=dot(b2,n);
  const dn=t=>scale(cross(a2,add(t,n,-dot(n,t))),1/len),y=dot(cross(b1,b2),n),x=dot(b1,b2)-d1*d2;
  const gy=add(cross(b2,cross(n,b1)),dn(cross(b1,b2))),gx=add(add(cross(b2,b1),dn(b1),-d2),add(cross(b2,n),dn(b2)),-d1);
  out.push({kind:'twist',angle:Math.atan2(y,x),min:-c.twist,max:c.twist,n:atanGradient(y,x,gy,gx)});
 }
 return out;
}
// Constrained point response for frame-boundary contacts. The 39 ball-anchor
// rows share one factorization at this fixed pose. A unit point impulse is
// projected through all joints before its effective inverse mass is measured;
// the contact therefore cannot treat a connected forearm as an isolated mass.
export function articulatedContact(rig,{viscosityStep=0,deferWriteback=false}={}){
 const bodies=rig.bodies,N=bodies.length*6,factor=rig._articulatedMass?rig._articulatedMass.update(viscosityStep):(rig._articulatedMass=new ArticulatedMass(rig,viscosityStep)),velocity=factor.solve(factor.momentum());
 // The substep solver may keep its velocity state in this packed buffer while
 // iterating contacts. It publishes before any body-based observer or wall solve.
 // External frame-boundary callers retain immediate object velocity updates.
 function publish(){for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x=velocity[k];b.v.y=velocity[k+1];b.v.z=velocity[k+2];b.w.x=velocity[k+3];b.w.y=velocity[k+4];b.w.z=velocity[k+5];}}
 function readBodies(){for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];velocity[k]=b.v.x;velocity[k+1]=b.v.y;velocity[k+2]=b.v.z;velocity[k+3]=b.w.x;velocity[k+4]=b.w.y;velocity[k+5]=b.w.z;}}
 publish();
 const force=new Float64Array(3*N);
 const pointCache=new WeakMap(),angleCache=new Map(),units=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
 function pointResponse(b,r){let result=pointCache.get(r);if(!result){force.fill(0);for(let axis=0;axis<3;axis++){const j=units[axis],k=axis*N+b.index*6;force[k]=j.x;force[k+1]=j.y;force[k+2]=j.z;force[k+3]=r.y*j.z-r.z*j.y;force[k+4]=r.z*j.x-r.x*j.z;force[k+5]=r.x*j.y-r.y*j.x;}result=factor.solve3(force,b.index);pointCache.set(r,result);}return result;}
 // Exact zero does no physical work. Negative releases and tiny corrections
 // still use the complete connected response, with the original sum order.
 function apply(list,x,y,z){
  if(x===0&&y===0&&z===0)return;
  const X=list[0],Y=list[1],Z=list[2];
  if(deferWriteback){for(let k=0;k<N;k++)velocity[k]+=X[k]*x+Y[k]*y+Z[k]*z;return;}
  for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x+=X[k]*x+Y[k]*y+Z[k]*z;b.v.y+=X[k+1]*x+Y[k+1]*y+Z[k+1]*z;b.v.z+=X[k+2]*x+Y[k+2]*y+Z[k+2]*z;b.w.x+=X[k+3]*x+Y[k+3]*y+Z[k+3]*z;b.w.y+=X[k+4]*x+Y[k+4]*y+Z[k+4]*z;b.w.z+=X[k+5]*x+Y[k+5]*y+Z[k+5]*z;}
 }
 function angularResponse(p,c){let result=angleCache.get(c);if(!result){force.fill(0);for(let j=0;j<3;j++){force[j*N+p.index*6+3+j]=1;force[j*N+c.index*6+3+j]=-1;}result=factor.solve3(force,c.index);angleCache.set(c,result);}return result;}
 // Limit directions are fixed for this pose. Project their complete connected
 // responses once instead of combining all three axes on every iteration.
 function applyLimit(response,J){
  if(J===0)return;
  if(deferWriteback){for(let k=0;k<N;k++)velocity[k]+=response[k]*J;return;}
  for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x+=response[k]*J;b.v.y+=response[k+1]*J;b.v.z+=response[k+2]*J;b.w.x+=response[k+3]*J;b.w.y+=response[k+4]*J;b.w.z+=response[k+5]*J;}
 }
 let limitRows=null;
 // Project only the body components needed by the row, not a temporary
 // full-rig vector. Directions are evaluated every call (friction mutates them).
 function component(list,k,n){return list[0][k]*n.x+list[1][k]*n.y+list[2][k]*n.z;}
 function relativePoint(A,B,k,r,n){const vx=component(B,k,n)-component(A,k,n),vy=component(B,k+1,n)-component(A,k+1,n),vz=component(B,k+2,n)-component(A,k+2,n),wx=component(B,k+3,n)-component(A,k+3,n),wy=component(B,k+4,n)-component(A,k+4,n),wz=component(B,k+5,n)-component(A,k+5,n);return {x:vx+(wy*r.z-wz*r.y),y:vy+(wz*r.x-wx*r.z),z:vz+(wx*r.y-wy*r.x)};}
 return {
  writeback(){if(deferWriteback)publish();},readBodies,
  pointVelocity(b,r,out){if(!deferWriteback)readBodies();const k=b.index*6;out.x=velocity[k]+(velocity[k+4]*r.z-velocity[k+5]*r.y);out.y=velocity[k+1]+(velocity[k+5]*r.x-velocity[k+3]*r.z);out.z=velocity[k+2]+(velocity[k+3]*r.y-velocity[k+4]*r.x);return out;},
  relativeSpeed(a,ra,b,rb,n){if(!deferWriteback)readBodies();const A=a.index*6,B=b.index*6;return (velocity[B]+(velocity[B+4]*rb.z-velocity[B+5]*rb.y)-velocity[A]-(velocity[A+4]*ra.z-velocity[A+5]*ra.y))*n.x+(velocity[B+1]+(velocity[B+5]*rb.x-velocity[B+3]*rb.z)-velocity[A+1]-(velocity[A+5]*ra.x-velocity[A+3]*ra.z))*n.y+(velocity[B+2]+(velocity[B+3]*rb.y-velocity[B+4]*rb.x)-velocity[A+2]-(velocity[A+3]*ra.y-velocity[A+4]*ra.x))*n.z;},
  report(){if(deferWriteback)publish();let anchorResidual=0;for(const c of rig.joints){const p=c.parent,at=scale(add(add(p.x,rotate(p.q,c.rP)),add(c.x,rotate(c.q,c.o))),.5),u=add(velocityAt(c,add(at,c.x,-1)),velocityAt(p,add(at,p.x,-1)),-1);anchorResidual=Math.max(anchorResidual,Math.abs(u.x),Math.abs(u.y),Math.abs(u.z));}return {anchorResidual,limits:(limitRows||[]).map(row=>({body:row.c.name,n:row.n,allow:row.allow,impulse:row.impulse,speed:dot(add(row.c.w,row.p.w,-1),row.n)}))};},
  wPos(b,r,n){const list=pointResponse(b,r),k=b.index*6,vx=component(list,k,n),vy=component(list,k+1,n),vz=component(list,k+2,n),wx=component(list,k+3,n),wy=component(list,k+4,n),wz=component(list,k+5,n);return (vx+(wy*r.z-wz*r.y))*n.x+(vy+(wz*r.x-wx*r.z))*n.y+(vz+(wx*r.y-wy*r.x))*n.z;},
  impulse(b,r,x,y,z){if(x===0&&y===0&&z===0)return;apply(pointResponse(b,r),x,y,z);},
  pairMass(a,ra,b,rb,n){const A=pointResponse(a,ra),B=pointResponse(b,rb);return dot(add(relativePoint(A,B,b.index*6,rb,n),relativePoint(A,B,a.index*6,ra,n),-1),n);},
  pairImpulse(a,ra,b,rb,x,y,z){if(x===0&&y===0&&z===0)return;apply(pointResponse(a,ra),-x,-y,-z);apply(pointResponse(b,rb),x,y,z);},
  limits(h){
   let maximumChange=0;
   if(!limitRows){limitRows=[];for(const c of rig.joints)for(const coordinate of jointCoordinates(c.parent,c)){
    const p=c.parent,{n,angle,min,max}=coordinate;
    const len=length(n);if(len<1e-8)continue;
    if(Number.isFinite(max))limitRows.push({p,c,n,allow:Math.max(0,(max-angle)/h),impulse:0});
    if(Number.isFinite(min))limitRows.push({p,c,n:scale(n,-1),allow:Math.max(0,(angle-min)/h),impulse:0});
   }}
   for(const row of limitRows){const {p,c,n,allow}=row,kp=p.index*6+3,kc=c.index*6+3,speed=deferWriteback?(velocity[kc]-velocity[kp])*n.x+(velocity[kc+1]-velocity[kp+1])*n.y+(velocity[kc+2]-velocity[kp+2])*n.z:dot(add(c.w,p.w,-1),n);if(!row.impulse&&speed<=allow)continue;
    if(!row.response){const list=angularResponse(p,c),response=row.response=new Float64Array(N);for(let k=0;k<N;k++)response[k]=component(list,k,n);row.eff=(response[kp]-response[kc])*n.x+(response[kp+1]-response[kc+1])*n.y+(response[kp+2]-response[kc+2])*n.z;}
    const total=Math.max(0,row.impulse+(speed-allow)/row.eff),J=total-row.impulse;row.impulse=total;maximumChange=Math.max(maximumChange,Math.abs(J));applyLimit(row.response,J);
   }
   return maximumChange;
  },
 };

}
