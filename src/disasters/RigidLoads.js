import { Vector3 } from '../engine/index.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, GRAVITY } from '../physics/Loads.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// The bridge returns actual v + omega cross r. No attitude differencing or
// invented spin. Position supplied here is the actual centre of mass.
export function nativeAngularVelocity(physics,id,p,v){
 const x=physics.disaster_contact(id,new Float32Array([p.x+1,p.y,p.z]),new Float32Array([0,1,0]));
 const z=physics.disaster_contact(id,new Float32Array([p.x,p.y,p.z+1]),new Float32Array([0,1,0]));
 return x.length>=3&&z.length>=3?new Vector3(v.y-z[1],((z[0]-v.x)-(x[2]-v.z))*.5,x[1]-v.y):new Vector3();
}
export function worldBoxInertia(mass,half,q){
 const h=Array.isArray(half)?half:[half.x,half.y,half.z],diag=[mass*(h[1]**2+h[2]**2)/3,mass*(h[0]**2+h[2]**2)/3,mass*(h[0]**2+h[1]**2)/3];
 return worldPrincipalInertia(diag,q);
}
export function worldPrincipalInertia(diag,q){
 const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(v=>v.applyQuaternion(q).toArray()),out=new Float64Array(9);
 for(let a=0;a<3;a++)for(let i=0;i<3;i++)for(let j=0;j<3;j++)out[i*3+j]+=diag[a]*axes[a][i]*axes[a][j];return out;
}
function solveSPD(A,b){
 const L=new Float64Array(36),y=new Float64Array(6),x=new Float64Array(6);
 for(let i=0;i<6;i++)for(let j=0;j<=i;j++){let s=A[i*6+j];for(let k=0;k<j;k++)s-=L[i*6+k]*L[j*6+k];L[i*6+j]=i===j?Math.sqrt(Math.max(1e-18,s)):s/L[j*6+j];}
 for(let i=0;i<6;i++){let s=b[i];for(let j=0;j<i;j++)s-=L[i*6+j]*y[j];y[i]=s/L[i*6+i];}
 for(let i=5;i>=0;i--){let s=y[i];for(let j=i+1;j<6;j++)s-=L[j*6+i]*x[j];x[i]=s/L[i*6+i];}return x;
}
function product(A,v){return Array.from({length:6},(_,i)=>{let s=0;for(let j=0;j<6;j++)s+=A[i*6+j]*v[j];return s;});}
export function boxLoadPoints(half){
 const h=Array.isArray(half)?half:[half.x,half.y,half.z],points=[];
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const p=[0,0,0];p[axis]=sign*h[axis]*.65;points.push({local:p,half:h.map(x=>x*.35),areaWeight:1/6,volumeWeight:1/6});}return points;
}
// stemShare and crownShare split the body's buoyant volume. The crown's branch wood floats like the
// stem (TreeMass.js): with no crown volume a floating tree's top sank and stood it on end.
export function treeLoadPoints(height,radius,crownRadius,{crownY=height*.32,crownHalfHeight=height*.12,stemShare=1,crownShare=0}={}){
 const points=[];
 for(let i=0;i<5;i++)points.push({local:[0,(i-2)*height/5,0],half:[radius,height/10,radius],areaWeight:.2/5,volumeWeight:stemShare/5});
 for(const [x,z]of [[-1,0],[1,0],[0,-1],[0,1]])points.push({local:[x*crownRadius,crownY,z*crownRadius],half:[crownRadius*.5,crownHalfHeight,crownRadius*.5],areaWeight:.8/4,volumeWeight:crownShare/4});
 return points;
}

/** Coupled implicit point drag over the actual held-force interval.
 * (M + dt sum(k B'B)) deltaTwist = dt sum(k B'(u - B twist)).
 * B maps rigid COM/angular velocity to each rotated force point. M contains the
 * actual declared rotated inertia. This accounts for every point's effective mass and coupling;
 * still-fluid drag cannot increase frozen-attitude rigid kinetic energy.
 * Coefficients are reevaluated each frame. Native contacts and gravity are untouched.
 */
export function rigidEnvironmentalLoad(field,physics,body,{position,velocity,dt,supported=false},out={}){
 const mass=body.mass,q=body.quaternion,h=body.half,step=Math.max(1e-6,dt),offset=new Vector3().fromArray(body.centerOfMass??[0,0,0]),com=position.clone().add(offset.clone().applyQuaternion(q)),omega=nativeAngularVelocity(physics,body.id,com,velocity);
 const twist=[velocity.x,velocity.y,velocity.z,omega.x,omega.y,omega.z],M=new Float64Array(36),I=body.principalInertia?worldPrincipalInertia(body.principalInertia,q):worldBoxInertia(mass,h,q);
 for(let i=0;i<3;i++){M[i*6+i]=mass;for(let j=0;j<3;j++)M[(i+3)*6+j+3]=I[i*3+j];}
 const A=M.slice(),rhs=new Float64Array(6),extra=new Float64Array(6),upAxes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(v=>Math.abs(v.applyQuaternion(q).y));
 let rawForce=0,wetVolume=0;const centre=field.sample(com.x,com.y,com.z,{});
 if(supported){extra[0]+=mass*centre.ax;extra[1]+=mass*centre.ay;extra[2]+=mass*centre.az;}
 for(const point of body.loadPoints??boxLoadPoints(h)){
  const r=new Vector3().fromArray(point.local).sub(offset).applyQuaternion(q),p=new Vector3().copy(com).add(r),s=field.sample(p.x,p.y,p.z,{}),half=point.half;
  const B=[[1,0,0,0,r.z,-r.y],[0,1,0,-r.z,0,r.x],[0,0,1,r.y,-r.x,0]],pv=B.map(row=>row.reduce((sum,x,i)=>sum+x*twist[i],0));
  const extent=Math.max(.005,half[0]*upAxes[0]+half[1]*upAxes[1]+half[2]*upAxes[2]),wet=s.height>field.terrain(p.x,p.z)+.02?clamp((s.height-p.y+extent)/(2*extent),0,1):0;
  wetVolume+=body.volume*(point.volumeWeight??point.areaWeight)*wet;
  const drag=(fluid,density,area,coefficient)=>{const relative=fluid.map((x,i)=>x-pv[i]),k=.5*density*area*coefficient*Math.hypot(...relative);rawForce+=k*Math.hypot(...relative);if(!k)return;
   for(let i=0;i<6;i++){for(let c=0;c<3;c++)rhs[i]+=step*k*B[c][i]*relative[c];for(let j=0;j<6;j++)for(let c=0;c<3;c++)A[i*6+j]+=step*k*B[c][i]*B[c][j];}
  };
  drag([s.wx,s.wy,s.wz],AIR_DENSITY,body.area*point.areaWeight*(1-wet),body.dragCoefficient??1.1);
  if(wet>0){drag([s.ux,0,s.uz],SEA_WATER_DENSITY,body.area*point.areaWeight*wet,body.waterDragCoefficient??1);
   const lift=SEA_WATER_DENSITY*GRAVITY*body.volume*(point.volumeWeight??point.areaWeight)*wet;extra[1]+=lift;extra[3]-=r.z*lift;extra[5]+=r.x*lift;
  }
 }
 const delta=solveSPD(A,rhs),J=product(M,delta),requested=J.map((x,i)=>x/step+extra[i]),linear=Math.hypot(...requested.slice(0,3));
 // Same disclosed translational safety bound as other disaster bodies; scale the
 // entire wrench together so the bound cannot manufacture a separate torque.
 const scale=Math.min(1,45*mass/Math.max(linear,1e-12));
 for(const [i,k]of ['fx','fy','fz','tx','ty','tz'].entries())out[k]=requested[i]*scale;
 const before=product(M,twist);out.dragWork=delta.reduce((sum,x,i)=>sum+x*(before[i]+J[i]*.5),0);out.rawDragForce=rawForce;out.rawAcceleration=linear/mass;out.limited=scale<1;out.wet=body.volume>0?wetVolume/body.volume:0;
 if(!['fx','fy','fz','tx','ty','tz','dragWork'].every(k=>Number.isFinite(out[k])))throw new Error('Non-finite rigid environmental load');return out;
}
