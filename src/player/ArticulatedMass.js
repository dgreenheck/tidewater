// Fixed-pose articulated response. Each ball joint has three free relative
// angular velocities. Eliminating those variables from leaves to root solves
// (M + h*c*D^T*D)v = f with exact common-anchor velocities in O(body count).
// The same factorization serves the free step and every contact impulse.
const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
function rotate(q,v) {
 const tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
 return {x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx};
}
function cholesky(a,n,L=new Float64Array(n*n)) {
 L.fill(0);
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++) {
  let x=a[i*n+j];for(let k=0;k<j;k++)x-=L[i*n+k]*L[j*n+k];
  if(i===j){if(!(x>0))throw new Error('Non-positive articulated inertia');L[i*n+j]=Math.sqrt(x);}
  else L[i*n+j]=x/L[j*n+j];
 }
 return L;
}
function solveCholesky(L,b,n) {
 const x=new Float64Array(b);
 for(let i=0;i<n;i++){let v=x[i];for(let j=0;j<i;j++)v-=L[i*n+j]*x[j];x[i]=v/L[i*n+i];}
 for(let i=n-1;i>=0;i--){let v=x[i];for(let j=i+1;j<n;j++)v-=L[j*n+i]*x[j];x[i]=v/L[i*n+i];}
 return x;
}
export class ArticulatedMass {
 constructor(rig,viscosityStep=0) {
  this.bodies=rig.bodies;
  this.nodes=rig.bodies.map(b=>({parent:b.parent?.index??-1,H:new Float64Array(36),U:new Float64Array(18),L:new Float64Array(9),W:new Float64Array(18),reduced:new Float64Array(36),RX:new Float64Array(36),D:new Float64Array(9)}));
  this.forces=new Float64Array(rig.bodies.length*6);this.z=new Float64Array(rig.bodies.length*3);this.rootFactor=new Float64Array(36);
  this.update(viscosityStep);
 }
 update(viscosityStep=0) {
  for(const b of this.bodies) {
   const node=this.nodes[b.index],H=node.H,a=rotate(b.q,b.ax),v=[a.x,a.y,a.z],ip=1/b.iPerp,d=1/b.iAx-ip;H.fill(0);
   for(let i=0;i<3;i++){H[i*6+i]=b.m;for(let j=0;j<3;j++)H[(i+3)*6+j+3]=(i===j?ip:0)+d*v[i]*v[j];}
   if(!b.parent){this.root=b.index;continue;}
   if(node.parent>=b.index)throw new Error('Articulated bodies must follow their parents');
   const p=b.parent,rp=rotate(p.q,b.rP),rc=rotate(b.q,b.o);
   node.rx=(p.x.x+rp.x+b.x.x+rc.x)*.5-b.x.x;node.ry=(p.x.y+rp.y+b.x.y+rc.y)*.5-b.x.y;node.rz=(p.x.z+rp.z+b.x.z+rc.z)*.5-b.x.z;
   node.dx=p.x.x-b.x.x;node.dy=p.x.y-b.x.y;node.dz=p.x.z-b.x.z;
  }
  for(let index=this.nodes.length-1;index>=0;index--) {
   const n=this.nodes[index];if(n.parent<0)continue;
   const {H,U,D,L,W,reduced,RX,rx,ry,rz,dx,dy,dz}=n;
   for(let i=0;i<6;i++){const k=i*6,j=i*3;U[j]=H[k+1]*rz-H[k+2]*ry+H[k+3];U[j+1]=-H[k]*rz+H[k+2]*rx+H[k+4];U[j+2]=H[k]*ry-H[k+1]*rx+H[k+5];}
   for(let j=0;j<3;j++){D[j]=rz*U[3+j]-ry*U[6+j]+U[9+j];D[3+j]=-rz*U[j]+rx*U[6+j]+U[12+j];D[6+j]=ry*U[j]-rx*U[3+j]+U[15+j];}
   D[0]+=viscosityStep;D[4]+=viscosityStep;D[8]+=viscosityStep;cholesky(D,3,L);
   for(let i=0;i<6;i++){
    const j=i*3,y0=U[j]/L[0],y1=(U[j+1]-L[3]*y0)/L[4],y2=(U[j+2]-L[6]*y0-L[7]*y1)/L[8],q2=y2/L[8],q1=(y1-L[7]*q2)/L[4];
    W[j]=(y0-L[3]*q1-L[6]*q2)/L[0];W[j+1]=q1;W[j+2]=q2;
   }
   for(let i=0;i<6;i++)for(let j=0;j<6;j++)reduced[i*6+j]=H[i*6+j]-U[i*3]*W[j*3]-U[i*3+1]*W[j*3+1]-U[i*3+2]*W[j*3+2];
   for(let i=0;i<6;i++){const k=i*6;RX[k]=reduced[k];RX[k+1]=reduced[k+1];RX[k+2]=reduced[k+2];RX[k+3]=reduced[k+3]+dz*reduced[k+1]-dy*reduced[k+2];RX[k+4]=reduced[k+4]-dz*reduced[k]+dx*reduced[k+2];RX[k+5]=reduced[k+5]+dy*reduced[k]-dx*reduced[k+1];}
   const P=this.nodes[n.parent].H;
   for(let i=0;i<36;i++)P[i]+=RX[i];
   for(let j=0;j<6;j++){P[18+j]+=dz*RX[6+j]-dy*RX[12+j];P[24+j]+=-dz*RX[j]+dx*RX[12+j];P[30+j]+=dy*RX[j]-dx*RX[6+j];}
  }
  cholesky(this.nodes[this.root].H,6,this.rootFactor);return this;
 }
 solve(force) {
  const f=this.forces,z=this.z;f.set(force);
  for(let i=this.nodes.length-1;i>=0;i--) {
   const n=this.nodes[i];if(n.parent<0)continue;
   const {rx,ry,rz,dx,dy,dz,L,U}=n,k=i*6,j=i*3,p=n.parent*6;
   const r0=rz*f[k+1]-ry*f[k+2]+f[k+3],r1=-rz*f[k]+rx*f[k+2]+f[k+4],r2=ry*f[k]-rx*f[k+1]+f[k+5];
   const y0=r0/L[0],y1=(r1-L[3]*y0)/L[4],y2=(r2-L[6]*y0-L[7]*y1)/L[8],q2=y2/L[8],q1=(y1-L[7]*q2)/L[4],q0=(y0-L[3]*q1-L[6]*q2)/L[0];z[j]=q0;z[j+1]=q1;z[j+2]=q2;
   const a0=f[k]-U[0]*q0-U[1]*q1-U[2]*q2,a1=f[k+1]-U[3]*q0-U[4]*q1-U[5]*q2,a2=f[k+2]-U[6]*q0-U[7]*q1-U[8]*q2;
   f[p]+=a0;f[p+1]+=a1;f[p+2]+=a2;f[p+3]+=f[k+3]-U[9]*q0-U[10]*q1-U[11]*q2+dz*a1-dy*a2;f[p+4]+=f[k+4]-U[12]*q0-U[13]*q1-U[14]*q2-dz*a0+dx*a2;f[p+5]+=f[k+5]-U[15]*q0-U[16]*q1-U[17]*q2+dy*a0-dx*a1;
  }
  const out=new Float64Array(this.nodes.length*6);out.set(solveCholesky(this.rootFactor,f.subarray(this.root*6,this.root*6+6),6),this.root*6);
  for(let i=0;i<this.nodes.length;i++) {
   const n=this.nodes[i];if(n.parent<0)continue;
   const {dx,dy,dz,rx,ry,rz,W}=n,k=i*6,j=i*3,p=n.parent*6;
   const v0=out[p]-dz*out[p+4]+dy*out[p+5],v1=out[p+1]+dz*out[p+3]-dx*out[p+5],v2=out[p+2]-dy*out[p+3]+dx*out[p+4],v3=out[p+3],v4=out[p+4],v5=out[p+5];
   const q0=z[j]-W[0]*v0-W[3]*v1-W[6]*v2-W[9]*v3-W[12]*v4-W[15]*v5,q1=z[j+1]-W[1]*v0-W[4]*v1-W[7]*v2-W[10]*v3-W[13]*v4-W[16]*v5,q2=z[j+2]-W[2]*v0-W[5]*v1-W[8]*v2-W[11]*v3-W[14]*v4-W[17]*v5;
   out[k]=v0-rz*q1+ry*q2;out[k+1]=v1+rz*q0-rx*q2;out[k+2]=v2-ry*q0+rx*q1;out[k+3]=v3+q0;out[k+4]=v4+q1;out[k+5]=v5+q2;
  }
  return out;
 }
 // Three independent wrench columns, in column-major blocks of bodyCount*6.
 // Node data is loaded once for the three axes of a point or angular response.
 // W = U D^-1 is shared with factorization: q = D^-1 z - W^T v.
 // Optional branch means all force is on that body or its ancestors, so only
 // that path needs backward elimination. Forward propagation still visits every
 // body. Each column retains solve()'s arithmetic order. Only f/z are scratch: every
 // returned response owns fresh storage and survives later solves or updates.
 solve3(force,branch=-1) {
  const N=this.nodes.length*6,Z=this.nodes.length*3;
  if(force.length!==3*N)throw new Error('Three articulated force columns required');
  const f=this.batchForces??(this.batchForces=new Float64Array(3*N)),z=this.batchZ??(this.batchZ=new Float64Array(3*Z));f.set(force);z.fill(0);
  for(let i=branch<0?this.nodes.length-1:branch;i>=0;i=branch<0?i-1:this.nodes[i].parent) {
   const n=this.nodes[i];if(n.parent<0)continue;
   const {rx,ry,rz,dx,dy,dz,L,U}=n;
   for(let column=0;column<3;column++) {
    const k=column*N+i*6,j=column*Z+i*3,p=column*N+n.parent*6;
    const r0=rz*f[k+1]-ry*f[k+2]+f[k+3],r1=-rz*f[k]+rx*f[k+2]+f[k+4],r2=ry*f[k]-rx*f[k+1]+f[k+5];
    const y0=r0/L[0],y1=(r1-L[3]*y0)/L[4],y2=(r2-L[6]*y0-L[7]*y1)/L[8],q2=y2/L[8],q1=(y1-L[7]*q2)/L[4],q0=(y0-L[3]*q1-L[6]*q2)/L[0];z[j]=q0;z[j+1]=q1;z[j+2]=q2;
    const a0=f[k]-U[0]*q0-U[1]*q1-U[2]*q2,a1=f[k+1]-U[3]*q0-U[4]*q1-U[5]*q2,a2=f[k+2]-U[6]*q0-U[7]*q1-U[8]*q2;
    f[p]+=a0;f[p+1]+=a1;f[p+2]+=a2;f[p+3]+=f[k+3]-U[9]*q0-U[10]*q1-U[11]*q2+dz*a1-dy*a2;f[p+4]+=f[k+4]-U[12]*q0-U[13]*q1-U[14]*q2-dz*a0+dx*a2;f[p+5]+=f[k+5]-U[15]*q0-U[16]*q1-U[17]*q2+dy*a0-dx*a1;
   }
  }
  const out=new Float64Array(3*N),L=this.rootFactor;
  for(let column=0;column<3;column++) {
   const k=column*N+this.root*6;
   for(let i=0;i<6;i++)out[k+i]=f[k+i];
   for(let i=0;i<6;i++){let v=out[k+i];for(let j=0;j<i;j++)v-=L[i*6+j]*out[k+j];out[k+i]=v/L[i*6+i];}
   for(let i=5;i>=0;i--){let v=out[k+i];for(let j=i+1;j<6;j++)v-=L[j*6+i]*out[k+j];out[k+i]=v/L[i*6+i];}
  }
  for(let i=0;i<this.nodes.length;i++) {
   const n=this.nodes[i];if(n.parent<0)continue;
   const {dx,dy,dz,rx,ry,rz,W}=n;
   for(let column=0;column<3;column++) {
    const k=column*N+i*6,j=column*Z+i*3,p=column*N+n.parent*6;
    const v0=out[p]-dz*out[p+4]+dy*out[p+5],v1=out[p+1]+dz*out[p+3]-dx*out[p+5],v2=out[p+2]-dy*out[p+3]+dx*out[p+4],v3=out[p+3],v4=out[p+4],v5=out[p+5];
    const q0=z[j]-W[0]*v0-W[3]*v1-W[6]*v2-W[9]*v3-W[12]*v4-W[15]*v5,q1=z[j+1]-W[1]*v0-W[4]*v1-W[7]*v2-W[10]*v3-W[13]*v4-W[16]*v5,q2=z[j+2]-W[2]*v0-W[5]*v1-W[8]*v2-W[11]*v3-W[14]*v4-W[17]*v5;
    out[k]=v0-rz*q1+ry*q2;out[k+1]=v1+rz*q0-rx*q2;out[k+2]=v2-ry*q0+rx*q1;out[k+3]=v3+q0;out[k+4]=v4+q1;out[k+5]=v5+q2;
   }
  }
  return [out.subarray(0,N),out.subarray(N,2*N),out.subarray(2*N)];
 }
 momentum() {
  const out=new Float64Array(this.bodies.length*6);
  for(const b of this.bodies){const a=rotate(b.q,b.ax),d=dot(a,b.w),ip=1/b.iPerp,dd=1/b.iAx-ip;out.set([b.m*b.v.x,b.m*b.v.y,b.m*b.v.z,ip*b.w.x+dd*d*a.x,ip*b.w.y+dd*d*a.y,ip*b.w.z+dd*d*a.z],b.index*6);}
  return out;
 }
}
