// Passive, fixed-pose velocity constraints for the articulated capsules.
// Position corrections retain their separate job of repairing geometric error.
// Each impulse is equal/opposite at a common world anchor, so it conserves total
// linear/angular momentum. Removing relative constraint speed cannot add energy.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const add=(a,b,s=1)=>({x:a.x+s*b.x,y:a.y+s*b.y,z:a.z+s*b.z});
const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const length=a=>Math.hypot(a.x,a.y,a.z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rotate(q,v){const t=scale(cross(q,v),2);return add(add(v,t,q.w),cross(q,t));}
function velocity(b,r){return add(b.v,cross(b.w,r));}
function pointMass(b,r){
 const a=rotate(b.q,b.ax),c=cross(r,a),rr=dot(r,r),ip=b.iPerp,d=b.iAx-ip;
 return [b.im+ip*(rr-r.x*r.x)+d*c.x*c.x,-ip*r.x*r.y+d*c.x*c.y,-ip*r.x*r.z+d*c.x*c.z,b.im+ip*(rr-r.y*r.y)+d*c.y*c.y,-ip*r.y*r.z+d*c.y*c.z,b.im+ip*(rr-r.z*r.z)+d*c.z*c.z];
}
function anchor(rig,p,c){
 const ap=add(p.x,rotate(p.q,c.rP)),ac=add(c.x,rotate(c.q,c.o)),at=scale(add(ap,ac),.5),rp=add(at,p.x,-1),rc=add(at,c.x,-1),u=add(velocity(c,rc),velocity(p,rp),-1);
 const a=pointMass(p,rp),b=pointMass(c,rc),[xx,xy,xz,yy,yz,zz]=a.map((v,i)=>v+b[i]);
 const A=yy*zz-yz*yz,B=xz*yz-xy*zz,C=xy*yz-xz*yy,D=xx*zz-xz*xz,E=xy*xz-xx*yz,F=xx*yy-xy*xy,det=xx*A+xy*B+xz*C;
 if(det<=1e-18)return;
 const j={x:(A*u.x+B*u.y+C*u.z)/det,y:(B*u.x+D*u.y+E*u.z)/det,z:(C*u.x+E*u.y+F*u.z)/det};
 rig.impulse(p,rp,j.x,j.y,j.z);rig.impulse(c,rc,-j.x,-j.y,-j.z);
}
// A unilateral limit only removes the outward speed that would cross it during
// this step. Permitted hinge/twist motion and inward motion remain unconstrained.
function limit(rig,p,c,n,angle,min,max,h){
 const len=length(n);if(len<1e-8)return;
 const speed=dot(add(c.w,p.w,-1),n);let keep=speed;
 if(speed>0&&angle+speed*h>max)keep=Math.min(speed,Math.max(0,(max-angle)/h));
 if(speed<0&&angle+speed*h<min)keep=Math.max(speed,Math.min(0,(min-angle)/h));
 if(keep===speed)return;
 const j=(speed-keep)/(rig.wRot(p,n)+rig.wRot(c,n)),P=scale(n,j),v={x:0,y:0,z:0};
 rig.invI(p,P,v);p.w.x+=v.x;p.w.y+=v.y;p.w.z+=v.z;
 rig.invI(c,P,v);c.w.x-=v.x;c.w.y-=v.y;c.w.z-=v.z;
}
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
function limits(rig,p,c,h,apply=limit){for(const a of jointCoordinates(p,c))apply(rig,p,c,a.n,a.angle,a.min,a.max,h);}
export function projectJointVelocities(rig,h,{passes=4,angular=true}={}){
 for(let pass=0;pass<passes;pass++){
  const joints=rig.joints;
  for(let j=0;j<joints.length;j++){
   const c=joints[pass%2?joints.length-1-j:j],p=c.parent;
   anchor(rig,p,c);if(angular)limits(rig,p,c,h);
  }
 }
}

// Constrained point response for frame-boundary contacts. The 39 ball-anchor
// rows share one factorization at this fixed pose. A unit point impulse is
// projected through all joints before its effective inverse mass is measured;
// the contact therefore cannot treat a connected forearm as an isolated mass.
export function articulatedContact(rig,{viscosityStep=0}={}){
 const bodies=rig.bodies,N=bodies.length*6,rows=[],weights=[];
 const axes=bodies.map(b=>rotate(b.q,b.ax));
 // Backward-Euler internal joint torque, solved with the same effective
 // inertia used by anchors and contacts. D couples relative angular velocity;
 // it annihilates common rigid rotation and applies no external torque.
 const R=bodies.length*3,viscous=new Float64Array(R*R);
 for(let i=0;i<bodies.length;i++){
  const b=bodies[i],a=axes[i],ip=1/b.iPerp,d=1/b.iAx-ip,v=[a.x,a.y,a.z];
  for(let j=0;j<3;j++)for(let k=0;k<3;k++)viscous[(i*3+j)*R+i*3+k]=(j===k?ip:0)+d*v[j]*v[k];
 }
 if(viscosityStep>0)for(const c of rig.joints){const p=c.parent;for(let j=0;j<3;j++){
  const a=p.index*3+j,b=c.index*3+j;viscous[a*R+a]+=viscosityStep;viscous[b*R+b]+=viscosityStep;viscous[a*R+b]-=viscosityStep;viscous[b*R+a]-=viscosityStep;
 }}
 const VL=new Float64Array(R*R);
 for(let i=0;i<R;i++)for(let j=0;j<=i;j++){let v=viscous[i*R+j];for(let k=0;k<j;k++)v-=VL[i*R+k]*VL[j*R+k];VL[i*R+j]=i===j?Math.sqrt(Math.max(1e-18,v)):v/VL[j*R+j];}
 function angularSolve(a){
  const x=new Float64Array(a);
  for(let i=0;i<R;i++){let v=x[i];for(let j=0;j<i;j++)v-=VL[i*R+j]*x[j];x[i]=v/VL[i*R+i];}
  for(let i=R-1;i>=0;i--){let v=x[i];for(let j=i+1;j<R;j++)v-=VL[j*R+i]*x[j];x[i]=v/VL[i*R+i];}
  return x;
 }
 function inverse(row){const out=new Float64Array(N),torque=new Float64Array(R);for(let i=0;i<bodies.length;i++){
  const b=bodies[i],k=i*6;for(let j=0;j<3;j++){out[k+j]=row[k+j]*b.im;torque[i*3+j]=row[k+3+j];}
 }const omega=angularSolve(torque);for(let i=0;i<bodies.length;i++)for(let j=0;j<3;j++)out[i*6+3+j]=omega[i*3+j];return out;}
 for(const c of rig.joints){const p=c.parent,at=scale(add(add(p.x,rotate(p.q,c.rP)),add(c.x,rotate(c.q,c.o))),.5),rp=add(at,p.x,-1),rc=add(at,c.x,-1);
  for(let j=0;j<3;j++){const n={x:j===0?1:0,y:j===1?1:0,z:j===2?1:0},pa=cross(rp,n),ca=cross(rc,n),row=new Float64Array(N);row[p.index*6+j]=-1;row[c.index*6+j]=1;
   for(let k=0;k<3;k++){const key=['x','y','z'][k];row[p.index*6+3+k]=-pa[key];row[c.index*6+3+k]=ca[key];}rows.push(row);weights.push(inverse(row));
  }
 }
 const sum=(a,b)=>{let v=0;for(let i=0;i<N;i++)v+=a[i]*b[i];return v;},count=rows.length,L=new Float64Array(count*count);
 for(let i=0;i<count;i++)for(let j=0;j<=i;j++){let v=sum(rows[i],weights[j]);for(let k=0;k<j;k++)v-=L[i*count+k]*L[j*count+k];L[i*count+j]=i===j?Math.sqrt(Math.max(1e-18,v)):v/L[j*count+j];}
 function project(v){
  const lambda=new Float64Array(count);
  for(let i=0;i<count;i++){let n=sum(rows[i],v);for(let j=0;j<i;j++)n-=L[i*count+j]*lambda[j];lambda[i]=n/L[i*count+i];}
  for(let i=count-1;i>=0;i--){let n=lambda[i];for(let j=i+1;j<count;j++)n-=L[j*count+i]*lambda[j];lambda[i]=n/L[i*count+i];}
  for(let i=0;i<N;i++){let d=0;for(let j=0;j<count;j++)d+=weights[j][i]*lambda[j];v[i]-=d;}return v;
 }
 const velocity=new Float64Array(N),momentum=new Float64Array(R);
 bodies.forEach((b,i)=>{velocity.set([b.v.x,b.v.y,b.v.z,0,0,0],i*6);const a=axes[i],d=dot(a,b.w),ip=1/b.iPerp,dd=1/b.iAx-ip;momentum.set([ip*b.w.x+dd*d*a.x,ip*b.w.y+dd*d*a.y,ip*b.w.z+dd*d*a.z],i*3);});
 const omega=angularSolve(momentum);for(let i=0;i<bodies.length;i++)for(let j=0;j<3;j++)velocity[i*6+3+j]=omega[i*3+j];project(velocity);
 bodies.forEach((b,i)=>{const k=i*6;b.v.x=velocity[k];b.v.y=velocity[k+1];b.v.z=velocity[k+2];b.w.x=velocity[k+3];b.w.y=velocity[k+4];b.w.z=velocity[k+5];});
 function response(b,r,j){const f=new Float64Array(N),k=b.index*6,t=cross(r,j);f.set([j.x,j.y,j.z,t.x,t.y,t.z],k);return project(inverse(f));}
 const pointCache=new WeakMap(),angleCache=new Map(),units=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
 function pointResponse(b,r){let result=pointCache.get(r);if(!result){result=units.map(n=>response(b,r,n));pointCache.set(r,result);}return result;}
 function apply(list,x,y,z){bodies.forEach((b,i)=>{const k=i*6;b.v.x+=list[0][k]*x+list[1][k]*y+list[2][k]*z;b.v.y+=list[0][k+1]*x+list[1][k+1]*y+list[2][k+1]*z;b.v.z+=list[0][k+2]*x+list[1][k+2]*y+list[2][k+2]*z;b.w.x+=list[0][k+3]*x+list[1][k+3]*y+list[2][k+3]*z;b.w.y+=list[0][k+4]*x+list[1][k+4]*y+list[2][k+4]*z;b.w.z+=list[0][k+5]*x+list[1][k+5]*y+list[2][k+5]*z;});}
 function angularResponse(p,c){let result=angleCache.get(c);if(!result){result=units.map((n,j)=>{const f=new Float64Array(N);f[p.index*6+3+j]=1;f[c.index*6+3+j]=-1;return project(inverse(f));});angleCache.set(c,result);}return result;}
 let limitRows=null;
 function contactVelocity(list,k,r){return add({x:list[k],y:list[k+1],z:list[k+2]},cross({x:list[k+3],y:list[k+4],z:list[k+5]},r));}
 function weighted(list,n){const result=new Float64Array(N);for(let k=0;k<N;k++)result[k]=list[0][k]*n.x+list[1][k]*n.y+list[2][k]*n.z;return result;}
 return {
  report(){const v=new Float64Array(N);bodies.forEach((b,i)=>v.set([b.v.x,b.v.y,b.v.z,b.w.x,b.w.y,b.w.z],i*6));return {anchorResidual:Math.max(...rows.map(row=>Math.abs(sum(row,v)))),limits:(limitRows||[]).map(row=>({body:row.c.name,n:row.n,allow:row.allow,impulse:row.impulse,speed:dot(add(row.c.w,row.p.w,-1),row.n)}))};},
  wPos(b,r,n){const v=weighted(pointResponse(b,r),n);return dot(contactVelocity(v,b.index*6,r),n);},
  impulse(b,r,x,y,z){apply(pointResponse(b,r),x,y,z);},
  pairMass(a,ra,b,rb,n){const A=weighted(pointResponse(a,ra),n),B=weighted(pointResponse(b,rb),n);for(let i=0;i<N;i++)B[i]-=A[i];return dot(add(contactVelocity(B,b.index*6,rb),contactVelocity(B,a.index*6,ra),-1),n);},
  pairImpulse(a,ra,b,rb,x,y,z){apply(pointResponse(a,ra),-x,-y,-z);apply(pointResponse(b,rb),x,y,z);},
  limits(h){
   if(!limitRows){limitRows=[];for(const c of rig.joints)limits(rig,c.parent,c,h,(rig,p,c,n,angle,min,max,h)=>{
    const len=length(n);if(len<1e-8)return;
    const list=angularResponse(p,c),v=weighted(list,n),kp=p.index*6+3,kc=c.index*6+3,eff=(v[kp]-v[kc])*n.x+(v[kp+1]-v[kc+1])*n.y+(v[kp+2]-v[kc+2])*n.z;
    if(Number.isFinite(max))limitRows.push({p,c,n,list,eff,allow:Math.max(0,(max-angle)/h),impulse:0});
    if(Number.isFinite(min))limitRows.push({p,c,n:scale(n,-1),list,eff,allow:Math.max(0,(angle-min)/h),impulse:0});
   });}
   for(const row of limitRows){const {p,c,n,list,eff,allow}=row,speed=dot(add(c.w,p.w,-1),n),total=Math.max(0,row.impulse+(speed-allow)/eff),J=total-row.impulse;row.impulse=total;apply(list,n.x*J,n.y*J,n.z*J);}
  },
 };

}

// Relax the complete relative angular-velocity vector with the actual tensor
// effective inertia. A scalar projection along omega can create a perpendicular
// axial spin on an anisotropic capsule even while it lowers total energy.
export function dampJointVelocity(rig,p,c,viscosityStep){
 if(viscosityStep<=0)return;
 const a=rotate(p.q,p.ax),b=rotate(c.q,c.ax),ip=p.iPerp+c.iPerp+1/viscosityStep,dp=p.iAx-p.iPerp,dc=c.iAx-c.iPerp;
 const xx=ip+dp*a.x*a.x+dc*b.x*b.x,xy=dp*a.x*a.y+dc*b.x*b.y,xz=dp*a.x*a.z+dc*b.x*b.z,yy=ip+dp*a.y*a.y+dc*b.y*b.y,yz=dp*a.y*a.z+dc*b.y*b.z,zz=ip+dp*a.z*a.z+dc*b.z*b.z;
 const A=yy*zz-yz*yz,B=xz*yz-xy*zz,C=xy*yz-xz*yy,D=xx*zz-xz*xz,E=xy*xz-xx*yz,F=xx*yy-xy*xy,det=xx*A+xy*B+xz*C,u=add(c.w,p.w,-1);
 if(det<=1e-18)return;
 const J={x:(A*u.x+B*u.y+C*u.z)/det,y:(B*u.x+D*u.y+E*u.z)/det,z:(C*u.x+E*u.y+F*u.z)/det},v={x:0,y:0,z:0};
 rig.invI(p,J,v);p.w.x+=v.x;p.w.y+=v.y;p.w.z+=v.z;rig.invI(c,J,v);c.w.x-=v.x;c.w.y-=v.y;c.w.z-=v.z;
}
