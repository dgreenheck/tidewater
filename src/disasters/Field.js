import { GRAVITY, AIR_DENSITY, SEA_WATER_DENSITY, quadraticDrag, buoyancy as lift } from '../physics/Loads.js';
import { WaterGrid, nWaveEta, nWaveSpeed } from './WaterGrid.js';
import { mulberry32 } from '../util/Noise.js';
import { freshSeed } from './EventRandom.js';
import { tornadoMotion } from './TornadoMotion.js'; // tornado motion block only
export const DEFAULTS = Object.freeze({earthquake:{intensity:0.7,radius:160,duration:25,speed:180,frequency:2,width:55,direction:0,x:40,z:-115},tsunami:{warningLead:90,intensity:10,radius:220,duration:60,speed:18,frequency:2,width:55,direction:-90,x:40,z:-25},tornado:{intensity:65,radius:100,duration:60,speed:3,frequency:2,width:55,direction:0,x:40,z:-115}});
export const LIMITS = {intensity:{earthquake:[0.05,2],tsunami:[0.5,3000],tornado:[5,120]},warningLead:[3,300],radius:[20,400],duration:[3,180],speed:{earthquake:[60,600],tsunami:[3,50],tornado:[0,15]},frequency:[0.2,8],width:[15,160],direction:[-180,180],x:[-950,950],z:[-950,950]};
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
export const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
export function validate(kind,config) {
 if(!DEFAULTS[kind]) return 'Choose a disaster type.';
 for(const key of Object.keys(DEFAULTS[kind])) {
  const limits=LIMITS[key][kind]||LIMITS[key], v=config[key];
  if(!Number.isFinite(v)||v<limits[0]||v>limits[1])return `${key==='intensity'?'Intensity':key} must be ${limits[0]} to ${limits[1]}.`;
 }
 if(config.seed!==undefined&&(!Number.isInteger(config.seed)||config.seed<0||config.seed>0xffffffff))return 'seed must be a whole number 0 to 4294967295.';
 return '';
}
// Shared shallow-water domain: 257 x 257 cells at 8 m, centred on the island (2,048 m square).
// fixedStep: whole CFL steps (about 0.1 s at 8 m) blended for display, not one solver step per frame.
const WATER_GRID=Object.freeze({n:257,dx:8,x:0,z:0,fixedStep:true});
const WATER_HALF=(WATER_GRID.n-1)*WATER_GRID.dx/2; // m
// Outer ring for the approach: 257 x 257 cells at 32 m (8,192 m square) round the inner grid, which
// takes its edge water from it (WaterGrid.nestIn). Inside the 2 km grid the village saw at most 33-49 s
// of approach; a crest seen for 60-120 s starts 2-3.5 km out over the 90 m sea floor.
const OUTER_GRID=Object.freeze({n:257,dx:32,x:0,z:0,fixedStep:true});
const OUTER_HALF=(OUTER_GRID.n-1)*OUTER_GRID.dx/2; // m
// Crest sigma in outer cells: at 4 cells second order kept 0.73 of a crest over 1.2 km, first order 0.34.
const CREST_CELLS=6;
const SWEEP_STEP=WATER_GRID.dx*2; // m: two cells, finer than any channel the grid resolves
// True when any ground inside the grid under the tornado's whole path (a capsule of its radius
// from the start centre to where it is after `duration`) lies below sea level (0 m).
function sweepsSea(terrain,c) {
 const a=c.direction*Math.PI/180;
 const travel=c.speed*c.duration; // m
 const x0=c.x,z0=c.z;
 const x1=c.x+Math.cos(a)*travel,z1=c.z+Math.sin(a)*travel;
 const lx=x1-x0,lz=z1-z0,length2=lx*lx+lz*lz;
 const minX=Math.max(-WATER_HALF,Math.min(x0,x1)-c.radius),maxX=Math.min(WATER_HALF,Math.max(x0,x1)+c.radius);
 const minZ=Math.max(-WATER_HALF,Math.min(z0,z1)-c.radius),maxZ=Math.min(WATER_HALF,Math.max(z0,z1)+c.radius);
 for(let z=minZ;z<=maxZ;z+=SWEEP_STEP) {
  for(let x=minX;x<=maxX;x+=SWEEP_STEP) {
   const t=length2>0?clamp(((x-x0)*lx+(z-z0)*lz)/length2,0,1):0;
   const dx=x-(x0+lx*t),dz=z-(z0+lz*t);
   if(dx*dx+dz*dz>c.radius*c.radius)continue;
   if(terrain(x,z)<0)return true;
  }
 }
 return false;
}
// Tsunami approach, driven by the crest height H (m). Real tsunamis are 100 km and more long; the
// 2 km grid cannot hold that, so the source goes as far out as the grid allows, up to APPROACH_TIME
// of long-wave travel (was: 121 m out, with 0.68 of the crest on the beach at t 0 and no approach).
// Crest celerity c = sqrt( g ( d + H ) ) over still depth d. The warning countdown is that travel
// time from the source to the shoreline, integrated along the approach ray.
const G=9.81; // m/s^2
const APPROACH_TIME=75; // s: game choice inside the 60–120 s approach band
const APPROACH_STEP=4; // m: half a grid cell
const MIN_LAUNCH=120; // m: the old fixed distance, kept as the floor near the grid edge
const SPONGE=8*OUTER_GRID.dx; // m: the outer grid's absorbing edge band (8 cells)
const MIN_SOURCE_DEPTH=10; // m: open water under the source crest
const MIN_TRAVEL_DEPTH=0.5; // m: matches the test's long-wave integral over shoals
// Distance from (x, z) along unit (dx, dz) to the edge of the grid square.
function distanceToEdge(x,z,dx,dz,half=OUTER_HALF) {
 const tx=dx>0?(half-x)/dx:dx<0?(-half-x)/dx:Infinity;
 const tz=dz>0?(half-z)/dz:dz<0?(-half-z)/dz:Infinity;
 return Math.max(0,Math.min(tx,tz));
}
// Crest speed (m/s) of height H over still depth d, in two regimes, both checked against the solver on the
// real island (test/tsunami-approach.mjs):
// - Below the breaking limit, H < 0.78 d (McCowan 1894), the crest is a long wave: c = sqrt( g ( d + H ) ).
//   The 2 m surge crest reached the 3 m gauges 2.5-10% inside that prediction.
// - At or above it the front is a bore of the full height (the solver keeps it: 6.4 m of crest over the
//   6.3 m gauge for the 10 m wave): Stoker's (1957) bore celerity sqrt( g ( d + H ) ( 2 d + H ) / ( 2 d ) ),
//   held to the dam-break front 2 sqrt( g ( d + H ) ) (Ritter 1892) as d goes to 0. Both are at least
//   sqrt( g H ), so a wall far taller than the water (the 3000 m preset) is never slower than that.
// Was: Stoker with a depth-limited height min( H, 0.78 d ) everywhere. The 10 m countdown ran 20% late on
// the -60 shelf and the 2 m ones 11-14% early.
// - A wall fed from beyond the ring (sustained, e.farField) is a bore with its supply behind it, so it keeps
//   Stoker's speed at any height: the dam-break cap is the front of a reservoir at rest, which a hump launched
//   at rest becomes. Capped, the 3000 m wall (348 m/s over 90 m of sea, Stoker 732 m/s) carried too little
//   momentum for its height and slumped to 1430 m within 3 s of the hand-off.
const BREAKING=0.78; // McCowan breaking limit, H / d
function crestCelerity(d,H,sustained=false) {
 if(H<BREAKING*d)return Math.sqrt(G*(d+H));
 const stoker=Math.sqrt(G*(d+H)*(2*d+H)/(2*d));
 return sustained?stoker:Math.min(stoker,2*Math.sqrt(G*(d+H)));
}
// Dijkstra stencil: the 8 neighbours plus the 8 knight moves. With 8 alone the octile metric made a front
// at -60 deg travel 7.3% further than the straight line and its countdown ran late off the grid axes; with
// 16 the worst direction is 2.7% long.
const STENCIL=Object.freeze([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]);
// Crest travel time (s) between the shoreline cell at (tx, tz) and every sea cell of the outer ring, by
// Dijkstra on its 32 m cells (STENCIL, crestCelerity on each leg; the legs are symmetric, so this is also
// the time from each cell to the shore). The first arrival from a source line is the least time on it. A straight ray that skipped
// land read the village's countdown as 75 s while the crest wrapped round Joey Island and reached the
// shore at 119 s (test/tsunami-approach.mjs). Runs once at start: about 66,000 cells.
function arrivalField(terrain,H,tx,tz,sustained=false) {
 const n=OUTER_GRID.n,dx=OUTER_GRID.dx,x0=-OUTER_HALF,count=n*n;
 const depth=new Float64Array(count),time=new Float64Array(count).fill(Infinity);
 const ids=new Int32Array(count*STENCIL.length+STENCIL.length),keys=new Float64Array(count*STENCIL.length+STENCIL.length);
 let size=0;
 const push=(k,t)=>{
  let c=size++;
  while(c>0) {
   const p=(c-1)>>1;
   if(keys[p]<=t)break;
   ids[c]=ids[p];keys[c]=keys[p];c=p;
  }
  ids[c]=k;keys[c]=t;
 };
 const pop=()=>{
  const top=ids[0];size--;
  const lastId=ids[size],lastKey=keys[size];
  let c=0;
  for(;;) {
   let m=2*c+1;
   if(m>=size)break;
   if(m+1<size&&keys[m+1]<keys[m])m++;
   if(keys[m]>=lastKey)break;
   ids[c]=ids[m];keys[c]=keys[m];c=m;
  }
  ids[c]=lastId;keys[c]=lastKey;
  return top;
 };
 for(let k=0;k<count;k++)depth[k]=-terrain(x0+(k%n)*dx,x0+Math.floor(k/n)*dx);
 // The shoreline point snaps to the nearest sea cell within two cells: a 32 m cell centred on the beach
 // can be dry, and walled in by dry cells it reached nothing (a 2 m countdown fell to 16 s on the straight ray).
 const gi=Math.round((tx-x0)/dx),gj=Math.round((tz-x0)/dx);
 let goal=-1,best=Infinity;
 for(let j=Math.max(0,gj-2);j<=Math.min(n-1,gj+2);j++) {
  for(let i=Math.max(0,gi-2);i<=Math.min(n-1,gi+2);i++) {
   const k=j*n+i,r=(x0+i*dx-tx)**2+(x0+j*dx-tz)**2;
   if(depth[k]>0&&r<best){best=r;goal=k;}
  }
 }
 if(goal<0)return time;
 time[goal]=0;push(goal,0);
 while(size) {
  const t0=keys[0],k=pop();
  if(t0>time[k])continue;
  const i=k%n,j=(k-i)/n;
  for(const [di,dj] of STENCIL) {
   {
    const ii=i+di,jj=j+dj;
    if(ii<0||jj<0||ii>=n||jj>=n)continue;
    const m=jj*n+ii;
    if(depth[m]<=0)continue;
    // A knight move straddles two cells; both must be sea, or the front would hop a 32 m spit of land.
    if(Math.abs(di)===2&&(depth[j*n+i+di/2]<=0||depth[jj*n+i+di/2]<=0))continue;
    if(Math.abs(dj)===2&&(depth[(j+dj/2)*n+i]<=0||depth[(j+dj/2)*n+ii]<=0))continue;
    const d=Math.max(MIN_TRAVEL_DEPTH,(Math.max(0,depth[k])+depth[m])/2);
    const t=t0+dx*Math.hypot(di,dj)/crestCelerity(d,H,sustained);
    if(t<time[m]){time[m]=t;push(m,t);}
   }
  }
 }
 return time;
}
const AZIMUTH_SPREAD=8; // deg either side of the chosen direction: a source region, not a point
const APPROACH_BAND=Object.freeze([60,90]); // s of long-wave travel to the source, inside the 60–120 s approach band
const CREST_WIDTH_BAND=Object.freeze([1,1.4]); // x the crest width (wavelength); 1 keeps the 6-cell floor
const DRAWDOWN_BAND=Object.freeze([0.45,0.6]); // trough depth / H: approximately half the crest height
const TROUGH_LEAD_BAND=Object.freeze([2,2.5]); // crest widths from crest to trough centre (was 2.2 fixed)
const FAR_FIELD_BAND=Object.freeze([25,30]); // s of approach from beyond the ring before the hand-off
// The wall's crest is a long wave: it stays at H for LONG_WAVE x its water depth behind the front, then falls
// away. 20 is the shallow-water limit, wavelength / depth >= 20 (kh < pi / 10, Dean and Dalrymple 1991, ch. 3);
// a real tsunami is longer still, so this is the shortest crest the long-wave model may draw (declared). The
// ring's open boundary takes that crest from the analytic field for as long as it lasts (WaterGrid inflow):
// 3000 m over 90 m of sea, 62 km at Stoker's 732 m/s, 84 s; 320 m, 8.2 km at 106 m/s, 77 s.
const LONG_WAVE=20;
const EARTH_RADIUS=6.371e6; // m, mean
// A fresh 32-bit seed: EventRandom.freshSeed, the one draw every event uses (re-exported for old callers).
export { freshSeed };
// The tsunami's start-up plan, without building any water grid (the panel's arrival readout uses it).
// planApproach( terrain( x, z ) -> m, config ) -> { seed, requestedDirection, direction, warning, crestWidth,
// crestHalfLength, drawdown, troughLead, launchDistance, approach, arrival }. config is a tsunami config
// (DEFAULTS.tsunami fills gaps); pass config.seed to get the same plan DisasterField.start gives that seed.
// Times in s from the start of the event, distances in m, direction in deg.
export function planApproach(terrain,config={}) {
 const c={...DEFAULTS.tsunami,...config};
 const seed=Number.isInteger(c.seed)?c.seed>>>0:freshSeed();
 const random=mulberry32(seed),band=range=>range[0]+(range[1]-range[0])*random();
 const direction=c.direction+(2*random()-1)*AZIMUTH_SPREAD; // deg: the wave's actual heading
 const approachTime=band(APPROACH_BAND),widthScale=band(CREST_WIDTH_BAND);
 const drawdown=band(DRAWDOWN_BAND),troughLead=band(TROUGH_LEAD_BAND),farTime=band(FAR_FIELD_BAND); // preserve draw order for deterministic seeded replays
 const plan={seed,requestedDirection:c.direction,direction,warning:c.warningLead};
 const H=c.intensity,a=direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);
 // Crest Gaussian width (m) of the front. The Advanced width is the floor; very high walls get a front at least
 // 3% of H wide (1:33 width to height; was described as 30:1 length to height, which H*0.03 is not). The
 // crest's length behind the front is the far field's plateau (farField.length, LONG_WAVE).
 plan.crestWidth=Math.max(c.width,CREST_CELLS*OUTER_GRID.dx,H*0.03)*widthScale;
 // A real front is 100 km and more long, a plane wave at island scale: it spans the whole grid.
 plan.crestHalfLength=2*OUTER_HALF; // m
 plan.drawdown=drawdown; // trough depth / H
 plan.troughLead=troughLead; // crest widths
 // Room behind the target, keeping the crest's 3-sigma tail out of the sponge.
 const room=distanceToEdge(c.x,c.z,-cx,-cz)-SPONGE-3*plan.crestWidth;
 // The shoreline on the ray, and the crest's travel time from every sea cell to it.
 // The shoreline is the first point out with MIN_TRAVEL_DEPTH of water whose 32 m outer cell is sea too:
 // a dry cell there seeded the arrival field in a pocket and a 2 m countdown fell to 16 s.
 const cell=v=>Math.round((v+OUTER_HALF)/OUTER_GRID.dx)*OUTER_GRID.dx-OUTER_HALF; // m: nearest cell centre
 let shore=0;
 while(shore<room&&(terrain(c.x-cx*shore,c.z-cz*shore)>-MIN_TRAVEL_DEPTH||terrain(cell(c.x-cx*shore),cell(c.z-cz*shore))>=0))shore+=APPROACH_STEP;
 let time=arrivalField(terrain,H,c.x-cx*shore,c.z-cz*shore);
 // Least arrival time over each source line, binned by its distance s back from the target (m). A line
 // holds the cells within half a cell of s, as the solver's plane crest does.
 const n=OUTER_GRID.n,dx=OUTER_GRID.dx,bins=Math.max(1,Math.ceil(room/APPROACH_STEP)+1),half=Math.round(dx/2/APPROACH_STEP);
 const linesOf=time=>{
  const least=new Float64Array(bins).fill(Infinity);
  for(let k=0;k<n*n;k++) {
   if(!(time[k]<Infinity))continue;
   const b=Math.round(-((-OUTER_HALF+(k%n)*dx-c.x)*cx+(-OUTER_HALF+Math.floor(k/n)*dx-c.z)*cz)/APPROACH_STEP);
   if(b>=0&&b<bins&&time[k]<least[b])least[b]=time[k];
  }
  return s=>{
   const b=Math.round(s/APPROACH_STEP);let t=Infinity;
   for(let q=Math.max(0,b-half);q<=Math.min(bins-1,b+half);q++)if(least[q]<t)t=least[q];
   return t;
  };
 };
 let lineTime=linesOf(time);
 // The source goes back until its first arrival reaches the drawn approach time. Was: the straight-ray
 // travel; the crest then took a shorter way round and the 2 m countdown on the -60 shelf fell to 51 s.
 // The time at the ray's own cell. The line minimum alone is not enough near the shore: a line tilted off
 // the grid axes picks up far-coast cells 4 km along it and read 60 s at the target (a 2 m countdown of 16 s).
 const rayTime=s=>time[Math.round((c.z-cz*s+OUTER_HALF)/dx)*n+Math.round((c.x-cx*s+OUTER_HALF)/dx)]??Infinity;
 let s=shore;
 while(s+APPROACH_STEP<=room&&!(rayTime(s)>=approachTime&&rayTime(s)<Infinity&&lineTime(s)>=approachTime&&lineTime(s)<Infinity))s+=APPROACH_STEP;
 // Land behind the sea approach (Joey Island behind the village bay) is crossed: the front is far
 // wider than the island and wraps round it, so the source sits in the open sea beyond.
 // The crest may not start on a shoal or the far side of a beach: it moves on into open water.
 // Only the crest must: a real trough is tens of km long and a bay far smaller than it drains as a whole,
 // so the trough may start in the bay. Moving it beyond Joey Island left 0.165 H of drawdown in the lee.
 // A sea shallower than that all the way to the grid edge keeps the spot where the travel time was met:
 // walking on to the edge gave a flat 2 m sea a 154 s countdown, outside the 60–120 s approach band.
 let deep=s;
 while(deep+APPROACH_STEP<=room&&terrain(c.x-cx*deep,c.z-cz*deep)>-MIN_SOURCE_DEPTH)deep+=APPROACH_STEP;
 if(terrain(c.x-cx*deep,c.z-cz*deep)<=-MIN_SOURCE_DEPTH)s=deep;
 plan.launchDistance=Math.max(MIN_LAUNCH,s);
 // Countdown: the least first arrival from the source line, or the straight sea ray if the shore is cut off.
 const rayTravel=sustained=>{
  let travel=0;
  for(let d=0;d<plan.launchDistance;d+=APPROACH_STEP) {
   const mid=d+APPROACH_STEP/2,y=terrain(c.x-cx*mid,c.z-cz*mid);
   if(y<0)travel+=APPROACH_STEP/crestCelerity(Math.max(MIN_TRAVEL_DEPTH,-y),H,sustained);
  }
  return travel;
 };
 const around=lineTime(plan.launchDistance);
 plan.ringApproach=Number.isFinite(around)?around:rayTravel(false); // s: source to shoreline, inside the ring
 // The far field: the wall's crest starts farTime of travel beyond the source line and reaches it at launchTime.
 const sourceDepth=Math.max(MIN_TRAVEL_DEPTH,-terrain(c.x-cx*plan.launchDistance,c.z-cz*plan.launchDistance)); // m
 // Only a wall the ring cannot hold for the drawn approach time: a 10 m bore on the -60 deg shelf starts 1 km
 // out and keeps its 60-90 s inside the ring (test/tsunami-approach.mjs Severe, seed 1).
 const wall=H>=BREAKING*sourceDepth&&plan.ringApproach<approachTime&&Math.sqrt(2*EARTH_RADIUS*H)>distanceToEdge(c.x,c.z,-cx,-cz);
 // A wall is fed from beyond the ring for its whole length, so it crosses the ring as a sustained bore at
 // Stoker's speed (crestCelerity): its countdown is timed again on that speed (a second Dijkstra, walls only).
 if(wall) {
  time=arrivalField(terrain,H,c.x-cx*shore,c.z-cz*shore,true);lineTime=linesOf(time);
  const sustained=lineTime(plan.launchDistance);
  plan.ringApproach=Number.isFinite(sustained)?sustained:rayTravel(true);
 }
 const speed=crestCelerity(sourceDepth,H,wall); // m/s: Stoker's bore, 732 m/s for 3000 m over 90 m of sea
 plan.farField=wall?{time:farTime,speed,distance:plan.launchDistance+speed*farTime,length:LONG_WAVE*(sourceDepth+H)}:null;
 plan.approach=plan.ringApproach+(wall?farTime:0); // s: first sight to the shoreline
 plan.launchTime=plan.warning+(wall?farTime:0); // s: the solver takes the wave
 // The crest outruns its own trough: it moves at crestCelerity, the trough at sqrt( g ( d - drawdown H ) ).
 // With a fixed 2.2 crest widths of lead a 10 m crest launched 1.9 km out caught its trough on the 10 m shelf
 // and left 0.007 H of drawdown at the shore (seed 9, test/tsunami-approach.mjs); a real leading trough is
 // tens of km long and survives. The lead covers the overrun plus two crest widths, and the trough centre
 // stays at least two crest widths out from the shoreline: at one, a 10 m trough started on the 6 m shelf,
 // drained it to the 5% floor, and the refill carried the crest ashore 21% before the countdown (seed 1).
 let overrun=0; // m
 for(let d=shore;d<plan.launchDistance;d+=APPROACH_STEP) {
  const y=terrain(c.x-cx*(d+APPROACH_STEP/2),c.z-cz*(d+APPROACH_STEP/2));
  if(y>=0)continue;
  const depth=Math.max(MIN_TRAVEL_DEPTH,-y),crest=crestCelerity(depth,H,wall);
  overrun+=APPROACH_STEP*(crest-Math.sqrt(G*Math.max(MIN_TRAVEL_DEPTH,depth-plan.drawdown*H)))/crest;
 }
 plan.troughLead=Math.max(plan.troughLead,Math.min((overrun+2*plan.crestWidth)/plan.crestWidth,(plan.launchDistance-shore)/plan.crestWidth-2));
 plan.arrival=plan.warning+plan.approach;
 return plan;
}
// Scratch for DisasterField.acceleration: it runs per body per frame (305 bodies made 13-16 minor GCs per 1500
// frames, most from four small objects a call here; destruction lane, 2026-10-05). Used only after sample()
// returns, so an air modifier that samples the field cannot overwrite them mid-use. Outputs are identical
// (test/field-acceleration-scratch.mjs).
const DRAG_AIR={x:0,y:0,z:0},DRAG_AIR_FORCE={x:0,y:0,z:0},DRAG_WATER={x:0,y:0,z:0},DRAG_WATER_FORCE={x:0,y:0,z:0};
const DRAG_AIR_SHAPE={area:1,dragCoefficient:1.1},DRAG_WATER_SHAPE={density:SEA_WATER_DENSITY,area:1}; // m^2 set per call
export class DisasterField {
 constructor(terrain=()=>-20){this.terrain=terrain;this.events=new Map();this.airModifiers=new Set();this.time=0;this.paused=false;}
 registerAirModifier(fn,bounds,workerSnapshot){const entry={fn,bounds,workerSnapshot};this.airModifiers.add(entry);return()=>this.airModifiers.delete(entry);}
 sample(x,y,z,out={}){
  const s=this.sampleRaw(x,y,z,out);if(!this.airModifiers.size)return s;
  // Reuse scratch storage without sharing it with a recursively invoked sample.
  const depth=this.airDepth??0;this.airDepth=depth+1;this.airScratch??=[];const air=this.airScratch[depth]??=( {wx:0,wy:0,wz:0} );
  air.wx=s.wx;air.wy=s.wy;air.wz=s.wz;
  try{for(const entry of this.airModifiers){const bounds=typeof entry.bounds==='function'?entry.bounds():entry.bounds;if(entry.bounds&&!bounds)continue;if(bounds&&(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ))continue;entry.fn(x,y,z,air);}s.wx=air.wx;s.wy=air.wy;s.wz=air.wz;return s;}
  finally{this.airDepth=depth;}
 }
 start(kind,config={}){const c={...DEFAULTS[kind],...config};const error=validate(kind,c);if(error)throw new RangeError(error);if(!this.events.size)this.time=0;this.events.set(kind,{...c,kind,time:0});
  // The grid costs about 12 ms a frame (257 x 257 cells, CPU). A tornado only needs it when its
  // swept footprint crosses open water; over land it never wets a cell (was: every tornado paid it).
  const needsWater=kind==='tsunami'||(kind==='tornado'&&sweepsSea(this.terrain,c));
  // A tsunami also runs the outer ring, and the inner grid nests in it.
  if(kind==='tsunami'&&!this.outer){this.outer=new WaterGrid(this.terrain,OUTER_GRID);this.water?.nestIn(this.outer);}
  if(needsWater&&!this.water)this.water=new WaterGrid(this.terrain,{...WATER_GRID,parent:this.outer??null});
  if(kind==='tsunami'){const e=this.events.get(kind);e.launched=false;Object.assign(e,planApproach(this.terrain,c));}return this.events.get(kind);}
 // A tsunami runs its warning, its approach to the shore, then `duration` of flooding.
 endTime(e){return e.kind==='tsunami'?e.warning+(e.approach??0)+e.duration:e.duration;}
 stop(){this.events.clear();this.water=null;this.outer=null;}
 reset(){this.stop();this.time=0;this.paused=false;}
 // e.coastReached ("Coastal flooding detected", the evacuation route) means the bore is ashore at the coast the
 // warning names: land within the event's radius (m) of the target (coastWatch, WaterGrid.landWithin, built at launch).
 // Was any wet land in the grid: the plane crest's source line lies off other shores (Surge 2 m seed 7: the north
 // bay mouth, 900 m from the village) and their 0.1-0.3 m of run-up 0.2 s after launch flagged the coast with the
 // crest 97 s out (the surge regression, test/tsunami-coast.mjs). A target with no land in its radius watches the grid.
 advance(dt){if(this.paused||!this.events.size||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,0.1);this.time+=dt;for(const [k,e] of this.events){e.time+=dt;if(k==='tsunami'&&e.time>=(e.launchTime??e.warning)&&!e.launched){this.outer?.launch(e);this.water.launch(e);this.coastWatch=this.water.landWithin(e.x,e.z,e.radius);e.launched=true;}if(e.time>=this.endTime(e)){this.events.delete(k);}}if(this.water){if(!this.events.has('tsunami')&&!this.events.has('tornado')){this.water=null;this.outer=null;return;}this.applySurfaceWind();this.outer?.advance(dt);this.water.advance(dt);const e=this.events.get('tsunami');if(e?.launched&&!e.coastReached&&(this.coastWatch.length?this.water.floods(this.coastWatch):this.water.stats.inundatedArea>0)){e.coastReached=true;e.firstImpact=e.time;}}}
 applySurfaceWind(){
  const grid=this.water;if(!grid)return;const n=grid.n,ambient=this.ambient?.()??{x:0,z:0};grid.wind??={x:new Float32Array(n*n),z:new Float32Array(n*n)};grid.wind.x.fill(ambient.x);grid.wind.z.fill(ambient.z);
  const e=this.events.get('tornado');if(e){const c=this.center(e),env=this.envelope(e),core=e.radius*.18,I=this.tornadoIntensity(e);
  const loX=Math.max(0,Math.floor((c.x-e.radius-grid.x)/grid.dx)),hiX=Math.min(n-1,Math.ceil((c.x+e.radius-grid.x)/grid.dx)),loZ=Math.max(0,Math.floor((c.z-e.radius-grid.z)/grid.dx)),hiZ=Math.min(n-1,Math.ceil((c.z+e.radius-grid.z)/grid.dx));
  for(let j=loZ;j<=hiZ;j++)for(let i=loX;i<=hiX;i++){const k=j*n+i;if(grid.h[k]<=1e-5)continue;const dx=grid.x+i*grid.dx-c.x,dz=grid.z+j*grid.dx-c.z,r=Math.hypot(dx,dz),safe=Math.max(.1,r),fall=smooth(1-r/e.radius),rank=r<core?r/core:core/safe,w=I*rank*fall*env;grid.wind.x[k]+=(-dz/safe-dx/safe*.28)*w;grid.wind.z[k]+=(dx/safe-dz/safe*.28)*w;}}
  // Wake modifiers act on this same air field at the water surface. A bounds
  // getter is evaluated once per source per grid update, not once per wet cell.
  const air={wx:0,wy:0,wz:0};for(const entry of this.airModifiers){const b=typeof entry.bounds==='function'?entry.bounds():entry.bounds;if(entry.bounds&&!b)continue;
   const x0=b?Math.max(0,Math.ceil((b.minX-grid.x)/grid.dx)):0,x1=b?Math.min(n-1,Math.floor((b.maxX-grid.x)/grid.dx)):n-1,z0=b?Math.max(0,Math.ceil((b.minZ-grid.z)/grid.dx)):0,z1=b?Math.min(n-1,Math.floor((b.maxZ-grid.z)/grid.dx)):n-1;
   for(let j=z0;j<=z1;j++)for(let i=x0;i<=x1;i++){const k=j*n+i;if(grid.h[k]<=1e-5)continue;air.wx=grid.wind.x[k];air.wy=0;air.wz=grid.wind.z[k];entry.fn(grid.x+i*grid.dx,grid.bed[k]+grid.h[k],grid.z+j*grid.dx,air);grid.wind.x[k]=air.wx;grid.wind.z[k]=air.wz;}
  }
 }
 envelope(e){return smooth(e.time/1.2)*smooth((this.endTime(e)-e.time)/2);}
 center(e){const a=e.direction*Math.PI/180,travel=e.kind==='tornado'?e.time*e.speed:0;if(e.kind==='tornado'){const m=this.tornadoMotion(e);return {x:e.x+Math.cos(a)*travel+m.cx,z:e.z+Math.sin(a)*travel+m.cz};}return {x:e.x+Math.cos(a)*travel,z:e.z+Math.sin(a)*travel};}
 // ---- Tornado track, intensity pulses and gusts (lane 2026-10-05) ----
 // The only tornado-motion code in this file; the rest of Field.js belongs to the water lane.
 // Each tornado takes a fresh seed, so its track wanders, its speed changes and its wind
 // pulses and gusts differently every run; the model and its sources are in TornadoMotion.js.
 tornadoMotion(e){return tornadoMotion(e);}
 tornadoIntensity(e){const m=this.tornadoMotion(e);return e.intensity*m.factor;}
 // ---- end of the tornado motion block ----
 waterAt(x,z){const s=this.gridAt(x,z)?.sample(x,z,this.waterAtScratch??={});const h=s?.height??0;return this.farFieldAt(x,z,this.farScratch??={})?h+this.farScratch.height:h;}
 // The analytic wall (e.farField) where no solver holds it: everywhere until the hand-off, then outside the ring.
 // Adds its height (m), depth (m) and velocity (m/s) to `out` and returns true where it is drawn, else false.
 // Water.js disasterFar is the same maths in WGSL. Not allocated per call.
 farFieldAt(x,z,out){
  out.height=out.depth=out.ux=out.uz=0;
  const e=this.events.get('tsunami'),far=e?.farField;
  if(!far||(e.launched&&this.outer?.contains(x,z)))return false;
  const depth=-this.terrain(x,z);
  if(!(depth>0.3))return false; // m: the launch's own sea test (WaterGrid.launch, bed < -0.3)
  const crest=this.farCrest(e),a=e.direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);
  const rx=x-(e.x-cx*crest),rz=z-(e.z-cz*crest);
  const eta=nWaveEta(e,rx*cx+rz*cz,-rx*cz+rz*cx,depth);
  if(Math.abs(eta)<0.0001)return false;
  const u=nWaveSpeed(e,depth,depth+eta);
  out.height=eta;out.depth=depth+eta;out.ux=u*cx;out.uz=u*cz;
  return true;
 }
 // Height bounds (m) of the analytic wall for the ocean's culling, or null: the crest, and the trough's
 // drawdown x H (deeper than any floor-limited trough, so conservative). Reused object, not per-frame garbage.
 farFieldBounds(){const e=this.events.get('tsunami');if(!e?.farField)return null;const b=this.farBounds??={max:0,min:0};b.max=e.intensity;b.min=-(e.drawdown??0)*e.intensity;return b;}
 // Distance (m) of the far-field wall's crest line from the target, back along the heading.
 farCrest(e){return e.launchDistance+e.farField.speed*(e.launchTime-e.time);}
 // The inner grid where it covers (x, z), else the outer ring (the approach), else none.
 gridAt(x,z){const w=this.water;return w&&this.outer&&!w.contains(x,z)?this.outer:w;}
 addImpulse(x,z,radius,strength){return this.water?.addImpulse(x,z,radius,strength)??false;}
 sampleRaw(x,y,z,out={}) {
  out.ax=out.ay=out.az=out.wx=out.wy=out.wz=out.ux=out.uz=out.height=out.shake=0;
  if(!Number.isFinite(x+y+z))return out;
  const ambient=this.ambient?.();if(ambient){out.wx=ambient.x;out.wz=ambient.z;}
  for(const e of this.events.values()){
   const env=this.envelope(e); if(env<=0)continue;
   const c=this.center(e),dx=x-c.x,dz=z-c.z,r=Math.hypot(dx,dz),fall=smooth(1-r/e.radius);
   if(e.kind==='earthquake'){
    const t=e.time-r/e.speed;if(t<0||fall===0)continue;
    const a=e.intensity*9.81*fall*env*smooth(t/0.5),phase=t*e.frequency*Math.PI*2;
    out.shake=a; {out.ax+=a*(Math.sin(phase)+0.3*Math.sin(phase*1.73))/1.3;out.az+=a*Math.cos(phase*0.83)*0.8;out.ay+=a*Math.sin(phase*1.3)*0.35;}
   }else if(e.kind==='tornado'&&fall>0){
    const ground=this.terrain(x,z),core=e.radius*0.18,safe=Math.max(r,0.1),rank=r<core?r/core:core/safe,I=this.tornadoIntensity(e);
    const w=I*rank*fall*env*Math.exp(-Math.max(0,y-Math.max(0,ground)-80)/80);
    out.wx+=(-dz/safe-dx/safe*0.28)*w;out.wz+=(dx/safe-dz/safe*0.28)*w;
    out.wy+=I*0.35*Math.exp(-r*r/(core*core*2))*env;
   }
  }
  const grid=this.gridAt(x,z);
  if(grid){const w=grid.sample(x,z,this.waterScratch??={});out.height=w.height;out.ux=w.ux;out.uz=w.uz;}
  // The wall coming in from beyond the ring: its water over the solver's still sea.
  if(this.farFieldAt(x,z,this.farScratch??={})){out.height+=this.farScratch.height;out.ux+=this.farScratch.ux;out.uz+=this.farScratch.uz;}
  return out;
 }
 // Acceleration from loads, with force/mass and projected-area differences. Fluid-relative
 // quadratic drag is bounded to avoid an explicit solver exploding at small debris masses.
 acceleration(p,v,{mass=80,area=0.7,volume=0.08,height=1.8,buoyancy=true,waterDrag=true,supported=false,dt=1/30}={},out={}){
  const s=this.sample(p.x,p.y,p.z,out),ground=this.terrain(p.x,p.z),step=Math.max(1/1000,Math.min(.1,dt));
  mass=Math.max(.05,mass);let ax=supported?s.ax:0,ay=supported?s.ay:0,az=supported?s.az:0;
  // Exact quadratic-drag relaxation for a constant fluid velocity over the load interval.
  // F_raw follows rho Cd A |u-v| (u-v)/2; impulse cannot reverse relative velocity.
  const air=DRAG_AIR;air.x=s.wx-v.x;air.y=s.wy-v.y;air.z=s.wz-v.z;DRAG_AIR_SHAPE.area=area;
  const raw=quadraticDrag(DRAG_AIR_FORCE,air,DRAG_AIR_SHAPE),airSpeed=Math.hypot(air.x,air.y,air.z);
  const airRelax=1+step*.5*AIR_DENSITY*1.1*area*airSpeed/mass;
  ax+=raw.x/mass/airRelax;ay+=raw.y/mass/airRelax;az+=raw.z/mass/airRelax;
  const wet=s.height>ground+0.02?clamp((s.height-p.y+height*.5)/height,0,1):0;
  let rawWater=0;
  if(wet>0){
   if(waterDrag){const relative=DRAG_WATER;relative.x=s.ux-v.x-step*raw.x/mass/airRelax;relative.y=0;relative.z=s.uz-v.z-step*raw.z/mass/airRelax;DRAG_WATER_SHAPE.area=area*wet;
   const water=quadraticDrag(DRAG_WATER_FORCE,relative,DRAG_WATER_SHAPE),speed=Math.hypot(relative.x,relative.z),waterRelax=1+step*.5*SEA_WATER_DENSITY*area*wet*speed/mass;
   ax+=water.x/mass/waterRelax;az+=water.z/mass/waterRelax;rawWater=Math.hypot(water.x,water.z);}
   if(buoyancy)ay+=lift(volume*wet)/mass-v.y*wet*2;
  }
  const length=Math.hypot(ax,ay,az),k=length>45?45/length:1;s.rawAcceleration=length;s.rawDragForce=Math.hypot(raw.x,raw.y,raw.z)+rawWater;s.limited=k<1;s.ax=ax*k;s.ay=ay*k;s.az=az*k;s.wet=wet;return s;
 }
}
