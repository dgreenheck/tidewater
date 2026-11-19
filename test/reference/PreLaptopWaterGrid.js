// Frozen pre-optimization numerical reference.
import { AIR_DENSITY, SEA_WATER_DENSITY } from '../../src/physics/Loads.js';
// Depth-averaged nonlinear shallow water, SI units. First-order finite volumes with
// hydrostatic reconstruction (Audusse et al., 2004) and a local Rusanov flux.
// This resolves flooding and terrain barriers, not breaking-wave overturning or erosion.
function wetComponent(bed,n,seeds) {
 const connected=new Uint8Array(bed.length),queue=new Int32Array(bed.length);let head=0,tail=0;
 const add=k=>{if(k>=0&&!connected[k]&&bed[k]<0){connected[k]=1;queue[tail++]=k;}};
 for(const seed of seeds)add(seed);
 while(head<tail){const k=queue[head++],i=k%n,j=Math.floor(k/n);add(i>0?k-1:-1);add(i<n-1?k+1:-1);add(j>0?k-n:-1);add(j<n-1?k+n:-1);}
 return connected;
}
export class WaterGrid {
 constructor(terrain,{n=129,dx=8,x=0,z=0,sponge=true,friction=true}={}){
  this.terrain=terrain;this.n=n;this.dx=dx;this.x=x-(n-1)*dx/2;this.z=z-(n-1)*dx/2;this.sponge=sponge;this.friction=friction;
  const count=n*n;for(const key of ['bed','h','qx','qz','dh','dqx','dqz'])this[key]=new Float64Array(count);
  this.pixels=new Float32Array(count*4);this.time=0;this.version=0;this.stats={steps:0,massAdded:0,massRemoved:0,boundaryVolume:0,positivityCorrection:0,cfl:0,maxSpeed:0,limited:0,droppedTime:0,windImpulseX:0,windImpulseZ:0,windWork:0};
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;this.bed[k]=terrain(this.x+i*dx,this.z+j*dx);this.h[k]=Math.max(0,-this.bed[k]);}
  this.initialVolume=this.volume();this.pack();
 }
 volume(){let sum=0;for(const h of this.h)sum+=h;return sum*this.dx*this.dx;}
 // Incoming finite-width long wave. Source is restricted to connected ocean cells and
 // starts offshore; no water is created on inland dry ground.
 launch(e){
  const a=e.direction*Math.PI/180,c=Math.cos(a),s=Math.sin(a),distance=e.launchDistance??Math.max(120,e.width*2.2);
  const x=e.x-c*distance,z=e.z-s*distance;let added=0;
  // Flood fill from the closest wet cell to the source. An enclosed inland basin
  // receives no initial pulse even if its elevation is below sea level.
  // Eligible seeds must connect to the domain's sea boundary. A requested source
  // over an enclosed below-datum lake must not generate a tsunami inside that lake.
  if(!this.oceanMask){const edges=[];for(let i=0;i<this.n;i++)edges.push(i,(this.n-1)*this.n+i,i*this.n,i*this.n+this.n-1);this.oceanMask=wetComponent(this.bed,this.n,edges);}
  let seed=-1,best=Infinity;for(let j=0;j<this.n;j++)for(let i=0;i<this.n;i++){const k=j*this.n+i;if(this.bed[k]>=-.3||!this.oceanMask[k])continue;const d=(this.x+i*this.dx-x)**2+(this.z+j*this.dx-z)**2;if(d<best){best=d;seed=k;}}
  const connected=wetComponent(this.bed,this.n,[seed]);

  for(let j=0;j<this.n;j++)for(let i=0;i<this.n;i++){
   const k=j*this.n+i,b=this.bed[k];if(b>=-0.3||!connected[k])continue;
   const dx=this.x+i*this.dx-x,dz=this.z+j*this.dx-z,along=dx*c+dz*s,cross=-dx*s+dz*c;
   const eta=e.intensity*Math.exp(-0.5*(along/e.width)**2-2*(cross/e.radius)**2);
   if(eta<0.0001)continue;const d=this.h[k];this.h[k]+=eta;
   // The simple-wave relation u=2(sqrt(g h)-sqrt(g h0)); no arbitrary launch speed.
   const u=2*(Math.sqrt(9.81*this.h[k])-Math.sqrt(9.81*d));
   this.qx[k]+=this.h[k]*u*c;this.qz[k]+=this.h[k]*u*s;added+=eta;
  }
  this.stats.massAdded+=added*this.dx*this.dx;this.pack();
 }
 // A bounded local vertical water displacement paired with a surrounding depression.
 // Application callers supply m of displacement, not an unbounded impulse/force.
 addImpulse(x,z,radius,strength){
  if(!Number.isFinite(x+z+radius+strength)||radius<4)return false;
  radius=Math.min(60,radius);strength=Math.max(-0.25,Math.min(0.25,strength));
  const cells=[];let weight=0,delta=0;
  for(let j=Math.max(1,Math.floor((z-radius*3-this.z)/this.dx));j<Math.min(this.n-1,Math.ceil((z+radius*3-this.z)/this.dx));j++)for(let i=Math.max(1,Math.floor((x-radius*3-this.x)/this.dx));i<Math.min(this.n-1,Math.ceil((x+radius*3-this.x)/this.dx));i++){
   const k=j*this.n+i;if(this.h[k]<0.2)continue;const r2=((this.x+i*this.dx-x)**2+(this.z+j*this.dx-z)**2)/(radius*radius),w=Math.exp(-r2/2);const d=strength*(Math.exp(-r2*2)-0.25*w);cells.push([k,d,w]);weight+=w;delta+=d;
  }
  if(!weight)return false;let added=0;for(const [k,d,w]of cells){const change=Math.max(-this.h[k]+0.01,d-delta*w/weight);this.h[k]+=change;added+=change;}
  this.stats.massAdded+=added*this.dx*this.dx;this.pack();return true;
 }
 advance(dt){
  if(!Number.isFinite(dt)||dt<=0)return;this.stats.droppedTime+=Math.max(0,dt-.1);let left=Math.min(dt,0.1),steps=0;
  while(left>1e-8){let speed=0,rate=0;
   for(let i=0;i<this.h.length;i++){const h=this.h[i];if(h>1e-5){const c=Math.sqrt(9.81*h),u=Math.abs(this.qx[i])/h,v=Math.abs(this.qz[i])/h;speed=Math.max(speed,Math.hypot(u,v)+c);rate=Math.max(rate,(u+v+2*c)/this.dx);}}
   if(!Number.isFinite(rate))throw new RangeError('Non-finite shallow-water characteristic speed');
   const step=Math.min(left,.45/Math.max(1,rate));this.stats.cfl=step*rate;this.stats.maxSpeed=speed;this.step(step);left-=step;steps++;
  }
  this.stats.maxSubsteps=Math.max(this.stats.maxSubsteps??0,steps);this.stats.lastSubsteps=steps;this.pack();
 }
 step(dt){
  const {n,dx,h,qx,qz,bed,dh,dqx,dqz}=this,k=dt/dx,g=9.81;
  dh.fill(0);dqx.fill(0);dqz.fill(0);
  const flux=(l,r,axis)=>{
   const hl=h[l],hr=h[r],b=Math.max(bed[l],bed[r]);
   const a=Math.max(0,hl+bed[l]-b),bR=Math.max(0,hr+bed[r]-b);
   const ul=hl>1e-5?(axis?qz[l]:qx[l])/hl:0,ur=hr>1e-5?(axis?qz[r]:qx[r])/hr:0;
   const vl=hl>1e-5?(axis?qx[l]:qz[l])/hl:0,vr=hr>1e-5?(axis?qx[r]:qz[r])/hr:0;
   const c=Math.max(Math.abs(ul)+Math.sqrt(g*a),Math.abs(ur)+Math.sqrt(g*bR));
   const f=0.5*(a*ul+bR*ur-c*(bR-a));
   const p=0.5*(a*ul*ul+bR*ur*ur+0.5*g*(a*a+bR*bR)-c*(bR*ur-a*ul));
   const t=0.5*(a*ul*vl+bR*ur*vr-c*(bR*vr-a*vl));
   dh[l]-=k*f;dh[r]+=k*f;
   const normal=axis?dqz:dqx,tangent=axis?dqx:dqz;
   normal[l]-=k*(p+0.5*g*(hl*hl-a*a));normal[r]+=k*(p+0.5*g*(hr*hr-bR*bR));
   tangent[l]-=k*t;tangent[r]+=k*t;
  };
  for(let j=0;j<n;j++)for(let i=0;i<n-1;i++)flux(j*n+i,j*n+i+1,0);
  for(let j=0;j<n-1;j++)for(let i=0;i<n;i++)flux(j*n+i,(j+1)*n+i,1);
  // Reflecting outside faces. Interior hydrostatic pressure balances exactly at rest.
  for(let i=0;i<n;i++){dqx[i*n]+=k*0.5*g*h[i*n]**2;dqx[i*n+n-1]-=k*0.5*g*h[i*n+n-1]**2;dqz[i]+=k*0.5*g*h[i]**2;dqz[(n-1)*n+i]-=k*0.5*g*h[(n-1)*n+i]**2;}
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const p=j*n+i,next=h[p]+dh[p];if(next<0)this.stats.positivityCorrection-=next*dx*dx;h[p]=Math.max(0,next);qx[p]+=dqx[p];qz[p]+=dqz[p];
   if(h[p]<1e-5){qx[p]=qz[p]=0;continue;}
   // Manning friction n=0.035 on inundated land, n=0.02 at sea (assumed roughness).
   const rough=this.friction?(bed[p]>0?0.035:0.02):0,drag=1+dt*g*rough*rough*Math.hypot(qx[p],qz[p])/Math.max(0.02,h[p])**(7/3);
   qx[p]/=drag;qz[p]/=drag;
   if(this.wind){
    // tau = rhoAir Cd |Uair-Uwater| (Uair-Uwater), Cd=.0015 assumed.
    // Exact relative-velocity relaxation over dt prevents overshoot in thin wet cells.
    const rx=this.wind.x[p]-qx[p]/h[p],rz=this.wind.z[p]-qz[p]/h[p],k=dt*AIR_DENSITY*.0015*Math.hypot(rx,rz)/(SEA_WATER_DENSITY*h[p]);
    const dqX=h[p]*rx*k/(1+k),dqZ=h[p]*rz*k/(1+k),beforeEnergy=(qx[p]*qx[p]+qz[p]*qz[p])/h[p];
    qx[p]+=dqX;qz[p]+=dqZ;this.stats.windImpulseX+=SEA_WATER_DENSITY*dqX*dx*dx;this.stats.windImpulseZ+=SEA_WATER_DENSITY*dqZ*dx*dx;
    this.stats.windWork+=.5*SEA_WATER_DENSITY*((qx[p]*qx[p]+qz[p]*qz[p])/h[p]-beforeEnergy)*dx*dx;
   }
   if(this.sponge){const edge=Math.min(i,j,n-1-i,n-1-j);if(edge<8){const damp=Math.exp(-dt*0.7*(1-edge/8)**2),rest=Math.max(0,-bed[p]),before=h[p];h[p]=rest+(h[p]-rest)*damp;qx[p]*=damp;qz[p]*=damp;this.stats.boundaryVolume+=(before-h[p])*dx*dx;}}
  }
  this.time+=dt;this.stats.steps++;
 }
 pack(){
  let inundated=0,minSurface=0,maxSurface=0;for(let k=0;k<this.h.length;k++){const h=this.h[k],wet=h>0.002;if(this.bed[k]>0&&h>.1)inundated++;this.pixels[k*4]=wet?h+this.bed[k]:Math.min(0,this.bed[k]);this.pixels[k*4+1]=wet?this.qx[k]/h:0;this.pixels[k*4+2]=wet?this.qz[k]/h:0;this.pixels[k*4+3]=h;minSurface=Math.min(minSurface,this.pixels[k*4]);maxSurface=Math.max(maxSurface,this.pixels[k*4]);}
  this.stats.inundatedArea=inundated*this.dx*this.dx;this.stats.minSurface=minSurface;this.stats.maxSurface=maxSurface;this.version++;
 }
 sample(x,z,out={}){
  const u=(x-this.x)/this.dx,v=(z-this.z)/this.dx,n=this.n;out.height=out.ux=out.uz=out.depth=0;
  if(u<0||v<0||u>n-1||v>n-1)return out;
  const i=Math.min(n-2,Math.floor(u)),j=Math.min(n-2,Math.floor(v)),fx=u-i,fz=v-j,P=this.pixels;
  for(let c=0;c<4;c++){const a=P[(j*n+i)*4+c]*(1-fx)+P[(j*n+i+1)*4+c]*fx,b=P[((j+1)*n+i)*4+c]*(1-fx)+P[((j+1)*n+i+1)*4+c]*fx;out[['height','ux','uz','depth'][c]]=a*(1-fz)+b*fz;}
  // Interpolation at a wet/dry interface never floods ground above the actual free surface.
  if(out.height<=this.terrain(x,z)+0.002){out.ux=out.uz=0;out.height=Math.min(0,out.height);out.depth=0;}
  return out;
 }
}
