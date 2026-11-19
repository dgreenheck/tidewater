import {Vector3} from '../engine/index.js';

// Frozen-coefficient backward Euler for coupled point resistance. The six
// unknowns are world COM velocity and world angular velocity. A point row is
// g=[n,r cross n], so -k*g*g' is dissipative even with small roll inertia and
// several simultaneously loaded panels. Units: k N s/m; angular k N m s/rad.
// (M+h K) twistNext = M twist + h(externalWrench + fluidTargets).
export class FluidStep {
 constructor(){
  this.K=new Float64Array(36);this.target=new Float64Array(6);this.M=new Float64Array(36);this.A=new Float64Array(36);this.L=new Float64Array(36);this.rhs=new Float64Array(6);this.y=new Float64Array(6);this.next=new Float64Array(6);this.row=new Float64Array(6);this.com=new Vector3();this.axes=[new Vector3(),new Vector3(),new Vector3()];this.stats={rows:0};
 }
 begin(com){this.K.fill(0);this.target.fill(0);this.com.copy(com);this.stats.rows=0;return this;}
 rank(k,row,target){
  if(!(k>0))return;this.stats.rows++;
  for(let i=0;i<6;i++){this.target[i]+=k*row[i]*target;for(let j=0;j<6;j++)this.K[i*6+j]+=k*row[i]*row[j];}
 }
 point(k,p,n,fluid){
  const x=p.x-this.com.x,y=p.y-this.com.y,z=p.z-this.com.z,g=this.row;
  g[0]=n.x;g[1]=n.y;g[2]=n.z;g[3]=y*n.z-z*n.y;g[4]=z*n.x-x*n.z;g[5]=x*n.y-y*n.x;
  this.rank(k,g,n.x*fluid.x+n.y*fluid.y+n.z*fluid.z);
 }
 isotropic(k,p,fluid){for(const n of BASIS)this.point(k,p,n,fluid);}
 angular(k,n){const g=this.row;g[0]=g[1]=g[2]=0;g[3]=n.x;g[4]=n.y;g[5]=n.z;this.rank(k,g,0);}
 solve(h,q,mass,inertia,velocity,angular,force,torque){
  const {M,A,L,rhs,y,next,K,target,axes}=this;M.fill(0);L.fill(0);
  axes[0].set(1,0,0).applyQuaternion(q);axes[1].set(0,1,0).applyQuaternion(q);axes[2].set(0,0,1).applyQuaternion(q);
  for(let a=0;a<3;a++){const n=axes[a],v=[n.x,n.y,n.z];for(let i=0;i<3;i++)for(let j=0;j<3;j++){M[i*6+j]+=mass[a]*v[i]*v[j];M[(i+3)*6+j+3]+=inertia[a]*v[i]*v[j];}}
  const old=[velocity.x,velocity.y,velocity.z,angular.x,angular.y,angular.z],external=[force.x,force.y,force.z,torque.x,torque.y,torque.z];
  for(let i=0;i<6;i++){rhs[i]=h*(external[i]+target[i]);for(let j=0;j<6;j++){rhs[i]+=M[i*6+j]*old[j];A[i*6+j]=M[i*6+j]+h*K[i*6+j];}}
  for(let i=0;i<6;i++)for(let j=0;j<=i;j++){let s=A[i*6+j];for(let k=0;k<j;k++)s-=L[i*6+k]*L[j*6+k];L[i*6+j]=i===j?Math.sqrt(s):s/L[j*6+j];}
  for(let i=0;i<6;i++){let s=rhs[i];for(let j=0;j<i;j++)s-=L[i*6+j]*y[j];y[i]=s/L[i*6+i];}
  for(let i=5;i>=0;i--){let s=y[i];for(let j=i+1;j<6;j++)s-=L[j*6+i]*next[j];next[i]=s/L[i*6+i];}
  velocity.set(next[0],next[1],next[2]);angular.set(next[3],next[4],next[5]);
 }
}
const BASIS=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
