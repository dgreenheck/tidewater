import { AIR_DENSITY, SEA_WATER_DENSITY } from '../physics/Loads.js';
// Depth-averaged nonlinear shallow water, SI units. Finite volumes with hydrostatic reconstruction
// (Audusse et al., 2004): second-order central-upwind by default, first-order Rusanov as order 1.
// This resolves flooding and terrain barriers, not breaking-wave overturning or erosion.
function wetComponent(bed,n,seeds) {
 const connected=new Uint8Array(bed.length),queue=new Int32Array(bed.length);let head=0,tail=0;
 const add=k=>{if(k>=0&&!connected[k]&&bed[k]<0){connected[k]=1;queue[tail++]=k;}};
 for(const seed of seeds)add(seed);
 while(head<tail){const k=queue[head++],i=k%n,j=Math.floor(k/n);add(i>0?k-1:-1);add(i<n-1?k+1:-1);add(j>0?k-n:-1);add(j<n-1?k+n:-1);}
 return connected;
}
const TROUGH_LEAD=2.2; // crest widths (Gaussian sigma) from crest to trough centre; an event's e.troughLead (Field.js, drawn per event) wins
const TROUGH_FLOOR=0.05; // fraction of the still depth a trough may leave (keeps h > 0 for the flux)
// Second order (the default, order 2). First order smeared a bore over 3-5 cells and ate most of the
// leading drawdown before it reached the shore: 0.13 H was left at the 2 m surge gauge
// (test/tsunami-approach.mjs in the baseline). Order 2: per-cell slopes with the generalised minmod limiter
// on the surface, depth and velocities; the central-upwind flux of Kurganov and Petrova (2007) on
// the hydrostatic reconstruction of Audusse et al. (2004) with its second-order centred bed term, so
// a lake at rest stays exactly at rest, wet or dry; Heun's SSP-RK2 in time. CPU reference: the GPU
// compute port is the next step and must match it.
const THETA=1.3; // generalised minmod (Kurganov and Petrova 2007): 1 is minmod (most diffusive), 2 is MC
const DRY=1e-3; // m: a cell touching water this thin is reconstructed first order (wet/dry fronts stay balanced and positive)
const NEST_BAND=8; // cells: a nested grid's edge band takes its water from the parent (was a sponge to rest)
const NEST_HARD=2; // cells: the outermost band copies the parent outright (a Dirichlet boundary)
const NEST_RATE=3; // 1/s: relaxation toward the parent just inside NEST_HARD, falling to 0 at NEST_BAND
export const INUNDATION_DEPTH=0.1; // m: water over land (ground above datum) deeper than this counts as flooded (stats.inundatedArea, the coast watch)
// Generalised minmod of the two one-sided differences and their centred mean (face values then stay
// between the neighbours for THETA <= 2, so a reconstructed depth is never negative).
function limited(a,b) {
 if(a>0&&b>0)return Math.min(THETA*a,0.5*(a+b),THETA*b);
 if(a<0&&b<0)return Math.max(THETA*a,0.5*(a+b),THETA*b);
 return 0;
}
// The N-wave surface (m) a tsunami source puts over still depth `depth` (m) at `along` m shoreward of its
// crest line and `cross` m off its ray. One function for the solver's launch and the analytic wall beyond the
// ring (Field.js farFieldAt, mirrored in WGSL by Water.js disasterFar), so the hand-off is exact.
// Flat along the crest for crestHalfLength (m), then the old Gaussian falloff of `radius`. A 440 m wide patch
// spread like a ripple and kept 0.18 of its height after 600 m.
// Leading-depression N-wave: a trough of e.drawdown x H runs ahead (shoreward, along > 0) of the crest, so the
// sea draws back before the wall arrives (was: a positive mound only, no drawdown). A trough deeper than the
// water uncovers the bed; it cannot dig below it (TROUGH_FLOOR).
// A wall fed from beyond the ring (e.farField) holds its crest at H for farField.length m behind the front
// (seaward, along < 0) before the Gaussian falls away: the leading edge of a long wave, not a lone hump.
export function nWaveEta(e,along,cross,depth) {
 const sigma=e.crestWidth??e.width;
 const lateral=Math.exp(-2*(Math.max(0,Math.abs(cross)-(e.crestHalfLength??0))/e.radius)**2);
 const back=along<0?Math.min(0,along+(e.farField?.length??0)):along; // m past the plateau; 0 on it
 const crest=Math.exp(-0.5*(back/sigma)**2);
 const trough=Math.exp(-0.5*((along-(e.troughLead??TROUGH_LEAD)*sigma)/sigma)**2);
 return Math.max((TROUGH_FLOOR-1)*depth,e.intensity*(crest-(e.drawdown??0)*trough)*lateral);
}
// Depth-averaged water speed (m/s, along the heading) under the source at still depth `depth` and depth h (m).
// A long wave takes the simple-wave relation u = 2 ( sqrt( g h ) - sqrt( g depth ) ): no arbitrary launch speed;
// under the trough u < 0, the water runs out to sea ahead of the crest.
// A wall that came in from beyond the ring (e.farField) is a bore moving at its Stoker speed C (Field.js
// crestCelerity, sustained): its water moves at the flux of a profile translating at C, u = C ( h - depth ) / h,
// which across the front is the Rankine-Hugoniot mass condition, so the state behind is the bore's own (3000 m
// over 90 m: 711 m/s, Froude 4.1; 320 m: 83 m/s, Froude 1.3). Was: C held to the dam-break 348 m/s and u
// limited to C - sqrt( g h ) = 174 m/s; a 3090 m column moving that slowly is no bore of its height, and the
// wall slumped to 1430 m within 3 s (41% of H at the coast). Under the trough the simple wave stays: the
// translating flux over the TROUGH_FLOOR film would ask for 19 C of outflow.
export function nWaveSpeed(e,depth,h) {
 const simple=2*(Math.sqrt(9.81*h)-Math.sqrt(9.81*depth));
 if(!e.farField||h<=depth)return simple;
 return e.farField.speed*(h-depth)/h; // m/s
}
export class WaterGrid {
 constructor(terrain,{n=129,dx=8,x=0,z=0,sponge=true,friction=true,order=2,parent=null,maxInterval=0.1,fixedStep=false}={}){
  this.terrain=terrain;this.n=n;this.dx=dx;this.x=x-(n-1)*dx/2;this.z=z-(n-1)*dx/2;this.sponge=sponge;this.friction=friction;
  this.order=order; // 1 first-order Rusanov, 2 second-order central-upwind
  this.maxInterval=maxInterval; // s: the longest interval one advance() accepts; the rest is reported as dropped
  const count=n*n;for(const key of ['bed','h','qx','qz','dh','dqx','dqz'])this[key]=new Float64Array(count);
  // Second-order scratch: stage copies, surface, velocities and one axis of limited slopes.
  if(order>=2)for(const key of ['h0','qx0','qz0','eta','u','v','sE','sH','sU','sV'])this[key]=new Float64Array(count);
  this.pixels=new Float32Array(count*4);
  // state: the latest step packed; previous: the step before (fixed-step mode blends them into pixels).
  this.fixedStep=fixedStep;this.lag=0;this.nextStep=null;
  this.state=fixedStep?new Float32Array(count*4):this.pixels;this.previous=fixedStep?new Float32Array(count*4):this.pixels;this.time=0;this.version=0;this.stats={steps:0,massAdded:0,massRemoved:0,boundaryVolume:0,positivityCorrection:0,cfl:0,maxSpeed:0,limited:0,droppedTime:0,windImpulseX:0,windImpulseZ:0,windWork:0};
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;this.bed[k]=terrain(this.x+i*dx,this.z+j*dx);this.h[k]=Math.max(0,-this.bed[k]);}
  this.initialVolume=this.volume();this.pack();
  if(parent)this.nestIn(parent);
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
   const d=this.h[k],eta=nWaveEta(e,along,cross,d);
   if(Math.abs(eta)<0.0001)continue;
   this.h[k]=d+eta;
   const u=nWaveSpeed(e,d,this.h[k]);
   this.qx[k]+=this.h[k]*u*c;this.qz[k]+=this.h[k]*u*s;added+=this.h[k]-d;
  }
  this.stats.massAdded+=added*this.dx*this.dx;this.pack();
  // A wall from beyond the ring keeps coming in through this grid's open boundary (the outer ring only; a
  // nested grid takes it from its parent). See sources().
  this.inflow=e.farField&&!this.nest?{e,elapsed:0,c,s}:null;
  // The wave just written is the sea at this instant, so the fixed-step accumulator owes it no time. The calm
  // sea's unspent lag (up to one 0.24 s step on the 32 m ring) was replayed on the launched wave in the next
  // frame: the 3000 m wall's face jumped 97-161 m (0.13-0.22 s x 732 m/s) ahead of the analytic face it took
  // over (test/tsunami-farfield.mjs). pack() above already dropped the cached step; the
  // grid clock moves on to the instant the state now holds.
  if(this.fixedStep){this.time+=this.lag;this.lag=0;}
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
  if(!Number.isFinite(dt)||dt<=0)return;this.stats.droppedTime+=Math.max(0,dt-this.maxInterval);let left=Math.min(dt,this.maxInterval),steps=0;
  if(this.fixedStep)return this.advanceFixed(left);
  while(left>1e-8){const step=Math.min(left,this.stableStep());this.step(step);left-=step;steps++;}
  this.stats.maxSubsteps=Math.max(this.stats.maxSubsteps??0,steps);this.stats.lastSubsteps=steps;this.pack();
 }
 // Largest stable step (s) for the current state, and the CFL stats it implies.
 stableStep(){
  let speed=0,rate=0;
  for(let i=0;i<this.h.length;i++){const h=this.h[i];if(h>1e-5){const c=Math.sqrt(9.81*h),u=Math.abs(this.qx[i])/h,v=Math.abs(this.qz[i])/h;speed=Math.max(speed,Math.sqrt(u*u+v*v)+c);rate=Math.max(rate,(u+v+2*c)/this.dx);
   // Second order keeps h >= 0 only while dt max(|u|+c)/dx <= 1/4 on each axis (Kurganov and
   // Petrova 2007, Theorem 2.1); the summed rate above allowed 0.45 on one axis.
   if(this.order>=2)rate=Math.max(rate,2*(Math.max(u,v)+c)/this.dx);}}
  if(!Number.isFinite(rate))throw new RangeError('Non-finite shallow-water characteristic speed');
  const step=.45/Math.max(1,rate);this.stats.cfl=step*rate;this.stats.maxSpeed=speed;return step;
 }
 // Fixed-step mode (the game's grids): whole CFL-sized steps from an accumulator, and the packed
 // field shown and sampled is the blend of the last two steps. Stepping every frame at the frame's
 // dt cost 60 solver steps a second (10.5 ms each first order, 630 ms of CPU per second); the
 // CFL step at 8 m is about 0.1 s, so this runs about 10 steps a second.
 advanceFixed(dt){
  this.lag+=dt;let steps=0;
  this.stepping=true; // pack() inside the loop must keep the previous step for the blend
  for(;;){
   this.nextStep??=this.stableStep();
   if(this.lag<this.nextStep)break;
   this.previous.set(this.state);this.step(this.nextStep);this.lag-=this.nextStep;this.nextStep=null;this.pack();steps++;
  }
  this.stepping=false;
  this.stats.maxSubsteps=Math.max(this.stats.maxSubsteps??0,steps);this.stats.lastSubsteps=steps;
  this.blend(this.lag/this.nextStep);
 }
 blend(alpha){
  const a=Math.min(1,Math.max(0,alpha)),A=this.previous,B=this.state,P=this.pixels;
  for(let k=0;k<P.length;k++)P[k]=A[k]+(B[k]-A[k])*a;
  this.version++;
 }
 step(dt){
  if(this.order>=2)this.stepSecond(dt);
  else this.stepFirst(dt);
  this.sources(dt);
  if(this.nest)this.nestToParent(dt);
  if(this.inflow)this.inflow.elapsed+=dt;
  this.time+=dt;this.stats.steps++;
 }
 // First order: Rusanov on cell averages (the solver before 2026-10-05; kept as the reference).
 stepFirst(dt){
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
  this.walls(k);
  for(let p=0;p<h.length;p++){const next=h[p]+dh[p];if(next<0)this.stats.positivityCorrection-=next*dx*dx;h[p]=Math.max(0,next);qx[p]+=dqx[p];qz[p]+=dqz[p];}
 }
 // Reflecting outside faces. Interior hydrostatic pressure balances exactly at rest. Edge cells are
 // always reconstructed first order, so this face pressure is the same at both orders.
 walls(k){
  const {n,h,dqx,dqz}=this,g=9.81;
  for(let i=0;i<n;i++){dqx[i*n]+=k*0.5*g*h[i*n]**2;dqx[i*n+n-1]-=k*0.5*g*h[i*n+n-1]**2;dqz[i]+=k*0.5*g*h[i]**2;dqz[(n-1)*n+i]-=k*0.5*g*h[(n-1)*n+i]**2;}
 }
 // Second order: Heun's SSP-RK2 (Gottlieb and Shu 1998), U = ( U0 + U1 + dt L( U1 ) ) / 2 with
 // U1 = U0 + dt L( U0 ). Each stage is a positive Euler step, so their average is too.
 stepSecond(dt){
  const {dx,h,qx,qz,dh,dqx,dqz,h0,qx0,qz0}=this,count=h.length;
  h0.set(h);qx0.set(qx);qz0.set(qz);
  this.residual(dt);
  let fix1=0;
  for(let p=0;p<count;p++){
   let next=h[p]+dh[p];
   if(next<0){fix1-=next;next=0;}
   h[p]=next;qx[p]+=dqx[p];qz[p]+=dqz[p];
   if(next<1e-5){qx[p]=0;qz[p]=0;}
  }
  this.residual(dt);
  let fix2=0;
  for(let p=0;p<count;p++){
   let next=0.5*(h0[p]+h[p]+dh[p]);
   if(next<0){fix2-=next;next=0;}
   h[p]=next;qx[p]=0.5*(qx0[p]+qx[p]+dqx[p]);qz[p]=0.5*(qz0[p]+qz[p]+dqz[p]);
  }
  // Water a clamp created: half of stage one's survives the average.
  this.stats.positivityCorrection+=(0.5*fix1+fix2)*dx*dx;
 }
 // dt L( U ) for the current state into dh, dqx, dqz.
 residual(dt){
  const {h,qx,qz,bed,dh,dqx,dqz,eta,u,v}=this,k=dt/this.dx;
  dh.fill(0);dqx.fill(0);dqz.fill(0);
  for(let p=0;p<h.length;p++){
   const d=h[p];eta[p]=d+bed[p];
   if(d>1e-5){u[p]=qx[p]/d;v[p]=qz[p]/d;}
   else{u[p]=0;v[p]=0;}
  }
  this.sweep(k,0);
  this.sweep(k,1);
  // (no walls(): an edge cell's wall-face pressure is in its per-cell term, which is 0 with no slope)
 }
 // One axis: limited slopes per cell, the centred bed term, then the central-upwind flux at every face.
 sweep(k,axis){
  const {n,h,eta,dh,sE,sH,sU,sV}=this,g=9.81,stride=axis?n:1;
  const un=axis?this.v:this.u,ut=axis?this.u:this.v; // normal and tangential velocity, m/s
  const dqn=axis?this.dqz:this.dqx,dqt=axis?this.dqx:this.dqz;
  for(let j=0;j<n;j++){
   for(let i=0;i<n;i++){
    const p=j*n+i,along=axis?j:i;
    // A slope is a property of the cell (both its faces and its bed term use it), so the first-order
    // fallback at the domain edge and next to thin water is decided per cell. Deciding it per face
    // broke the lake-at-rest balance.
    if(along===0||along===n-1||h[p]<DRY||h[p-stride]<DRY||h[p+stride]<DRY){sE[p]=0;sH[p]=0;sU[p]=0;sV[p]=0;continue;}
    const l=p-stride,r=p+stride;
    sE[p]=limited(eta[p]-eta[l],eta[r]-eta[p]);
    sH[p]=limited(h[p]-h[l],h[r]-h[p]);
    sU[p]=limited(un[p]-un[l],un[r]-un[p]);
    sV[p]=limited(ut[p]-ut[l],ut[r]-ut[p]);
    // The centred bed term -g/2 ( h(i-1/2+) + h(i+1/2-) ) ( b(i+1/2-) - b(i-1/2+) ) = -g h_i ( sEta - sH )
    // (Audusse et al. 2004) plus this cell's own face pressures g/2 ( h(i-1/2+)^2 - h(i+1/2-)^2 ) = -g h_i sH
    // is -g h_i sEta: exactly 0 at rest in floating point. Summed apart they left 1e-13 m/s of drift.
    dqn[p]-=k*g*h[p]*sE[p];
   }
  }
  const rows=axis?n-1:n,cols=axis?n:n-1;
  for(let j=0;j<rows;j++){
   for(let i=0;i<cols;i++){
    const l=j*n+i,r=l+stride;
    // Face states from each side's slope; the bed there is surface minus depth.
    const hL=h[l]+0.5*sH[l],hR=h[r]-0.5*sH[r];
    const eL=eta[l]+0.5*sE[l],eR=eta[r]-0.5*sE[r];
    const bL=eL-hL,bR=eR-hR,bs=bL>bR?bL:bR;
    // Hydrostatic reconstruction: depth above the higher face bed.
    const aL=eL>bs?eL-bs:0,aR=eR>bs?eR-bs:0;
    let uL=0,vL=0,uR=0,vR=0;
    if(hL>1e-5){uL=un[l]+0.5*sU[l];vL=ut[l]+0.5*sV[l];}
    if(hR>1e-5){uR=un[r]-0.5*sU[r];vR=ut[r]-0.5*sV[r];}
    const cL=Math.sqrt(g*aL),cR=Math.sqrt(g*aR);
    // One-sided local speeds (Kurganov, Noelle and Petrova 2001): a+ >= 0 >= a-.
    const ap=Math.max(0,uL+cL,uR+cR),am=Math.min(0,uL-cL,uR-cR),span=ap-am;
    // delta: the momentum flux less g/2 aL^2, formed so it is exactly 0 at rest. Each side's own
    // g/2 h^2 face pressure is in the per-cell term above.
    let f=0,delta=0,t=0;
    if(span>1e-12){
     const qL=aL*uL,qR=aR*uR,w=ap*am;
     f=(ap*qL-am*qR+w*(aR-aL))/span;
     delta=(ap*qL*uL-am*(qR*uR+0.5*g*(aR*aR-aL*aL))+w*(qR-qL))/span;
     t=(ap*qL*vL-am*qR*vR+w*(aR*vR-aL*vL))/span;
    }
    dh[l]-=k*f;dh[r]+=k*f;
    dqn[l]-=k*delta;dqn[r]+=k*(delta+0.5*g*(aL*aL-aR*aR));
    dqt[l]-=k*t;dqt[r]+=k*t;
   }
  }
 }
 // Friction, wind stress and the absorbing edge, per cell after the flux update.
 sources(dt){
  const {n,dx,h,qx,qz,bed}=this,g=9.81;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const p=j*n+i;
   if(h[p]<1e-5){qx[p]=qz[p]=0;continue;}
   // Manning friction n=0.035 on inundated land, n=0.02 at sea (assumed roughness).
   // (sqrt and h^2 cbrt h: hypot and ** 7/3 cost 4.7 ms of a 257^2 step)
   const rough=this.friction?(bed[p]>0?0.035:0.02):0,speed2=qx[p]*qx[p]+qz[p]*qz[p];
   if(rough>0&&speed2>0){const d=Math.max(0.02,h[p]),drag=1+dt*g*rough*rough*Math.sqrt(speed2)/(d*d*Math.cbrt(d));qx[p]/=drag;qz[p]/=drag;}
   if(this.wind){
    // tau = rhoAir Cd |Uair-Uwater| (Uair-Uwater), Cd=.0015 assumed.
    // Exact relative-velocity relaxation over dt prevents overshoot in thin wet cells.
    const rx=this.wind.x[p]-qx[p]/h[p],rz=this.wind.z[p]-qz[p]/h[p],k=dt*AIR_DENSITY*.0015*Math.hypot(rx,rz)/(SEA_WATER_DENSITY*h[p]);
    const dqX=h[p]*rx*k/(1+k),dqZ=h[p]*rz*k/(1+k),beforeEnergy=(qx[p]*qx[p]+qz[p]*qz[p])/h[p];
    qx[p]+=dqX;qz[p]+=dqZ;this.stats.windImpulseX+=SEA_WATER_DENSITY*dqX*dx*dx;this.stats.windImpulseZ+=SEA_WATER_DENSITY*dqZ*dx*dx;
    this.stats.windWork+=.5*SEA_WATER_DENSITY*((qx[p]*qx[p]+qz[p]*qz[p])/h[p]-beforeEnergy)*dx*dx;
   }
   if(this.sponge&&!this.nest){const edge=Math.min(i,j,n-1-i,n-1-j);if(edge<8&&this.inflow&&this.inflowAt(p,i,j,edge,dt))continue;if(edge<8){const damp=Math.exp(-dt*0.7*(1-edge/8)**2),rest=Math.max(0,-bed[p]),before=h[p];h[p]=rest+(h[p]-rest)*damp;qx[p]*=damp;qz[p]*=damp;this.stats.boundaryVolume+=(before-h[p])*dx*dx;}}
  }
 }
 // Inflow: while the analytic wall (Field.farFieldAt, the same nWaveEta and nWaveSpeed) covers an edge
 // cell, the cell takes the wall's state instead of relaxing to rest: copied outright on the outer NEST_HARD cells,
 // relaxed at the nest's rate across the rest of the band (a wave-making relaxation zone, Mayer, Garapon and
 // Sorensen 1998). The wall's water outruns its waves there (Froude 4.1 for 3000 m, 1.3 for 320 m), so every
 // characteristic enters and both h and q are given, as the nest's Dirichlet band does. It lasts as long as the
 // crest does (farField.length / speed, Field.js LONG_WAVE), then the band is a sponge to rest again. Without it
 // the ring's sponge ate the wall's back and the 3000 m wall reached the coast at 41% of H. Returns false where no
 // wall is drawn (the old sponge applies). The crest is at the step's end time; stats.boundaryVolume keeps the
 // volume budget (negative: water let in).
 inflowAt(p,i,j,edge,dt){
  const {e,elapsed,c,s}=this.inflow,rest=Math.max(0,-this.bed[p]);
  if(!(rest>0.3))return false; // m: the launch's own sea test
  const crest=e.launchDistance-e.farField.speed*(elapsed+dt),x=this.x+i*this.dx-(e.x-c*crest),z=this.z+j*this.dx-(e.z-s*crest);
  const eta=nWaveEta(e,x*c+z*s,-x*s+z*c,rest);
  if(Math.abs(eta)<0.0001)return false;
  const h=this.h,target=rest+eta,u=nWaveSpeed(e,rest,target),keep=edge<NEST_HARD?0:Math.exp(-dt*NEST_RATE*(1-(edge-NEST_HARD)/(NEST_BAND-NEST_HARD))**2),before=h[p];
  h[p]=target+(h[p]-target)*keep;
  this.qx[p]=target*u*c+(this.qx[p]-target*u*c)*keep;this.qz[p]=target*u*s+(this.qz[p]-target*u*s)*keep;
  this.stats.boundaryVolume+=(before-h[p])*this.dx*this.dx;
  return true;
 }
 // One-way nesting: this grid's edge band takes its water from a coarser parent that holds the far
 // field (the approach). A sponge to rest there ate the incoming wave; a wall reflected it.
 nestIn(parent){
  const {n,dx}=this,cells=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){if(Math.min(i,j,n-1-i,n-1-j)<NEST_BAND)cells.push(j*n+i);}
  const m=cells.length,nest={cell:Int32Array.from(cells),base:new Int32Array(m),fx:new Float64Array(m),fz:new Float64Array(m),rate:new Float64Array(m)};
  for(let c=0;c<m;c++){
   const p=nest.cell[c],i=p%n,j=(p-i)/n,edge=Math.min(i,j,n-1-i,n-1-j);
   const u=Math.min(parent.n-1.000001,Math.max(0,(this.x+i*dx-parent.x)/parent.dx)),v=Math.min(parent.n-1.000001,Math.max(0,(this.z+j*dx-parent.z)/parent.dx));
   const pi=Math.floor(u),pj=Math.floor(v);
   nest.base[c]=pj*parent.n+pi;nest.fx[c]=u-pi;nest.fz[c]=v-pj;
   // Copy outright on the outer NEST_HARD cells; relax at NEST_RATE falling to 0 across the rest.
   nest.rate[c]=edge<NEST_HARD?Infinity:NEST_RATE*(1-(edge-NEST_HARD)/(NEST_BAND-NEST_HARD))**2;
  }
  this.parent=parent;this.nest=nest;
 }
 nestToParent(dt){
  const {h,qx,qz,bed,nest}=this,P=this.parent.pixels,row=this.parent.n*4;let moved=0;
  for(let c=0;c<nest.cell.length;c++){
   const p=nest.cell[c],k=nest.base[c]*4,l=k+row,fx=nest.fx[c],fz=nest.fz[c],tx=1-fx,tz=1-fz;
   const surface=(P[k]*tx+P[k+4]*fx)*tz+(P[l]*tx+P[l+4]*fx)*fz;
   const ux=(P[k+1]*tx+P[k+5]*fx)*tz+(P[l+1]*tx+P[l+5]*fx)*fz,uz=(P[k+2]*tx+P[k+6]*fx)*tz+(P[l+2]*tx+P[l+6]*fx)*fz;
   const target=Math.max(0,surface-bed[p]),keep=Math.exp(-dt*nest.rate[c]),before=h[p];
   h[p]=target+(h[p]-target)*keep;
   qx[p]=target*ux+(qx[p]-target*ux)*keep;qz[p]=target*uz+(qz[p]-target*uz)*keep;
   if(h[p]<1e-5){qx[p]=0;qz[p]=0;}
   moved+=before-h[p];
  }
  this.stats.boundaryVolume+=moved*this.dx*this.dx;
 }
 contains(x,z){const span=(this.n-1)*this.dx;return x>=this.x&&z>=this.z&&x<=this.x+span&&z<=this.z+span;}
 // Cell indices of the land (ground above datum) within r m of (x, z): the coast a warning names. Built once
 // per launch so the per-frame check (floods) walks a fixed list and allocates nothing.
 landWithin(x,z,r) {
  const n=this.n,dx=this.dx,i0=Math.max(0,Math.floor((x-r-this.x)/dx)),i1=Math.min(n-1,Math.ceil((x+r-this.x)/dx));
  const j0=Math.max(0,Math.floor((z-r-this.z)/dx)),j1=Math.min(n-1,Math.ceil((z+r-this.z)/dx));
  const cells=[];
  for(let j=j0;j<=j1;j++) {
   for(let i=i0;i<=i1;i++) {
    const k=j*n+i,ex=this.x+i*dx-x,ez=this.z+j*dx-z;
    if(this.bed[k]>0&&ex*ex+ez*ez<=r*r)cells.push(k);
   }
  }
  return Int32Array.from(cells);
 }
 // True once any of these cells holds more than INUNDATION_DEPTH of water.
 floods(cells) {
  for(let q=0;q<cells.length;q++)if(this.h[cells[q]]>INUNDATION_DEPTH)return true;
  return false;
 }
 pack(){
  let inundated=0,minSurface=0,maxSurface=0;for(let k=0;k<this.h.length;k++){const h=this.h[k],wet=h>0.002;if(this.bed[k]>0&&h>INUNDATION_DEPTH)inundated++;const S=this.state;S[k*4]=wet?h+this.bed[k]:Math.min(0,this.bed[k]);S[k*4+1]=wet?this.qx[k]/h:0;S[k*4+2]=wet?this.qz[k]/h:0;S[k*4+3]=h;minSurface=Math.min(minSurface,S[k*4]);maxSurface=Math.max(maxSurface,S[k*4]);}
  this.stats.inundatedArea=inundated*this.dx*this.dx;if(this.fixedStep&&!this.stepping){this.previous.set(this.state);this.pixels.set(this.state);this.nextStep=null;}this.stats.minSurface=minSurface;this.stats.maxSurface=maxSurface;this.version++;
 }
 sample(x,z,out={}){
  const u=(x-this.x)/this.dx,v=(z-this.z)/this.dx,n=this.n;out.height=out.ux=out.uz=out.depth=0;
  if(u<0||v<0||u>n-1||v>n-1)return out;
  const i=Math.min(n-2,Math.floor(u)),j=Math.min(n-2,Math.floor(v)),fx=u-i,fz=v-j,P=this.pixels;
  const k=(j*n+i)*4,l=k+n*4,tx=1-fx,tz=1-fz;
  out.height=(P[k]*tx+P[k+4]*fx)*tz+(P[l]*tx+P[l+4]*fx)*fz;
  out.ux=(P[k+1]*tx+P[k+5]*fx)*tz+(P[l+1]*tx+P[l+5]*fx)*fz;
  out.uz=(P[k+2]*tx+P[k+6]*fx)*tz+(P[l+2]*tx+P[l+6]*fx)*fz;
  out.depth=(P[k+3]*tx+P[k+7]*fx)*tz+(P[l+3]*tx+P[l+7]*fx)*fz;
  // Interpolation at a wet/dry interface never floods ground above the actual free surface.
  if(out.height<=this.terrain(x,z)+0.002){out.ux=out.uz=0;out.height=Math.min(0,out.height);out.depth=0;}
  return out;
 }
}
