import { Vector3, Matrix4, Matrix3, Quaternion } from '../engine/index.js';
import { GRAVITY, AIR_DENSITY, SEA_WATER_DENSITY } from '../physics/Loads.js';
import {materialMembers,beamConnection,nearestConnection,memberFrame} from './MaterialMembers.js';
import {buildingComponents,stepComponents} from './BuildingComponents.js';
import {drawMember} from './MemberSkin.js';
import {rigidEnvironmentalLoad} from './RigidLoads.js';
import {partitionImportedGeometry} from './ImportedFragments.js';
import {capacityFactor,CAPACITY_COV,STREAM} from './EventRandom.js';
import { tagSpans } from '../world/village/GeoBuilder.js';
import { enableGeometryMotion, markGeometryMotion } from '../engine/render/GeometryMotion.js';
export { commitGeometryMotion } from '../engine/render/GeometryMotion.js';

// Building identity is retained through the shared material batches. Primitive spans are
// separate so fracture never tears triangles or borrows vertices from a neighbour/loose prop.
export const STRUCTURES=[];
// options.progressive: a house that loses windows, panels and roof one by one (BuildingComponents.js)
// instead of turning into one jointed assembly on its first exposed frame.
export function structure(name,colliders,fn,material='timber',options={}){
 const record={name,material,progressive:!!options.progressive,disaster:true,spans:[],colliders:[],broken:false,damage:0,utilization:0,bind(geo,start,count,member){this.spans.push({geo,start,count,member});}};
 const b=colliders.boxes.length,c=colliders.cylinders.length;let result;
 tagSpans(record,()=>{result=fn();});record.colliders=[...colliders.boxes.slice(b),...colliders.cylinders.slice(c)];STRUCTURES.push(record);return result;
}
export const STRENGTHS=Object.freeze({
 // Effective whole-structure anchor capacity, assumed rather than site-engineered values.
 timber:{solidDensity:600,density:65,anchorG:0.42,drag:1.3},light:{solidDensity:500,density:40,anchorG:0.25,drag:1.3},masonry:{solidDensity:2400,density:180,anchorG:0.65,drag:1.2},steel:{solidDensity:7850,density:100,anchorG:0.55,drag:1.2}
});
const v=new Vector3(),q=new Quaternion(),one=new Vector3(1,1,1),m=new Matrix4(),normal=new Matrix3(),pieceRotation=new Quaternion();
// Loose building pieces (docs/disaster-damage.md, buildings). Large pieces near the camera become rigid
// bodies at most PIECE_RATE per second with a burst of PIECE_BURST; the rest collapse their vertices and
// go to the debris hook (onDebris) that the tornado's GPU debris draws.
export const PIECE_RATE=8; // bodies/s
export const PIECE_BURST=8; // bodies
export const PIECE_RANGE=150; // m from the camera
export const PIECE_MASS=25; // kg: heavier, or longer than PIECE_SIZE, is a large piece
export const PIECE_SIZE=1.5; // m
const DEBRIS_PER_FRAME=64; // pieces handed to the debris hook per frame
export const PIECE_WAIT=1; // s a large piece waits for a spawn token before it goes to the debris hook instead
export function saveSpan(s){const p=s.geo.attributes.position,n=s.geo.attributes.normal,copy={...s,pos:p.array.slice(s.start*3,(s.start+s.count)*3),nrm:n?.array.slice(s.start*3,(s.start+s.count)*3)};if(s.frame){copy.restorePos=copy.pos.slice();copy.restoreNrm=copy.nrm?.slice();const nm=new Matrix3().getNormalMatrix(s.frame);for(let i=0;i<copy.pos.length;i+=3){v.fromArray(copy.pos,i).applyMatrix4(s.frame).toArray(copy.pos,i);if(copy.nrm)v.fromArray(copy.nrm,i).applyMatrix3(nm).normalize().toArray(copy.nrm,i);}copy.inverse=s.frame.clone().invert();}return copy;}
export function spanBounds(spans){const lo=new Vector3(Infinity,Infinity,Infinity),hi=new Vector3(-Infinity,-Infinity,-Infinity);for(const s of spans){const a=s.pos??s.geo.attributes.position.array.subarray(s.start*3,(s.start+s.count)*3);for(let i=0;i<a.length;i+=3){v.fromArray(a,i);lo.min(v);hi.max(v);}}return {lo,hi,center:lo.clone().add(hi).multiplyScalar(0.5),half:hi.clone().sub(lo).multiplyScalar(0.5)};}
export function restoreSpans(spans){for(const s of spans){markGeometryMotion(s.geo,s.start,s.count);s.geo.attributes.position.array.set(s.restorePos??s.pos,s.start*3);s.geo.attributes.position.needsUpdate=true;if(s.nrm){s.geo.attributes.normal.array.set(s.restoreNrm??s.nrm,s.start*3);s.geo.attributes.normal.needsUpdate=true;}}}
export function drawSpans(body,position,rotation){
 m.compose(position,rotation,one);m.multiply(new Matrix4().makeTranslation(-body.origin.x,-body.origin.y,-body.origin.z));const worldMatrix=m.clone();
 for(const s of body.spans){markGeometryMotion(s.geo,s.start,s.count);m.copy(worldMatrix);if(s.inverse)m.premultiply(s.inverse);normal.getNormalMatrix(m);const e=m.elements,ne=normal.elements;const p=s.geo.attributes.position,n=s.geo.attributes.normal,a=s.start*3;
  for(let i=0;i<s.pos.length;i+=3){const x=s.pos[i],y=s.pos[i+1],z=s.pos[i+2];p.array[a+i]=e[0]*x+e[4]*y+e[8]*z+e[12];p.array[a+i+1]=e[1]*x+e[5]*y+e[9]*z+e[13];p.array[a+i+2]=e[2]*x+e[6]*y+e[10]*z+e[14];if(n&&s.nrm){const x=s.nrm[i],y=s.nrm[i+1],z=s.nrm[i+2];n.array[a+i]=ne[0]*x+ne[3]*y+ne[6]*z;n.array[a+i+1]=ne[1]*x+ne[4]*y+ne[7]*z;n.array[a+i+2]=ne[2]*x+ne[5]*y+ne[8]*z;}}
  p.addUpdateRange(a,s.pos.length);p.needsUpdate=true;if(n){n.addUpdateRange(a,s.pos.length);n.needsUpdate=true;}
 }
}
export function disableCollider(c){c.disasterDisabled=true;if(c.center){c.solid=false;c.walkable=false;}else{c.yMin=-1e9;c.yMax=-1e9;}}
export function snapshotCollider(c){return {c,solid:c.solid,walkable:c.walkable,yMin:c.yMin,yMax:c.yMax,disasterDisabled:c.disasterDisabled};}
export function restoreCollider(s){const {c,...props}=s;Object.assign(c,props);}
// Authored foundations extend below the heightfield. A released solid proxy must
// contain only the exposed part; its changed origin preserves every world vertex.
// The one-metre sample spacing matches the terrain grid, with an extra 2 cm skin.
// This is a coarse assembly collision proxy, not excavated soil or separate nails.
export function fragmentProxy(bounds,terrain){
 const half=bounds.half.clone().multiplyScalar(.92);half.x=Math.max(.02,half.x);half.y=Math.max(.02,half.y);half.z=Math.max(.02,half.z);
 const lo=bounds.center.clone().sub(half),hi=bounds.center.clone().add(half);let ground=-Infinity;
 if(terrain?.heightAt){const nx=Math.max(1,Math.ceil(hi.x-lo.x)),nz=Math.max(1,Math.ceil(hi.z-lo.z));
  for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++)ground=Math.max(ground,terrain.heightAt(lo.x+(hi.x-lo.x)*i/nx,lo.z+(hi.z-lo.z)*j/nz));
 }
 const cut=Math.max(0,ground+.02-lo.y);lo.y+=cut;
 if(hi.y-lo.y<.02)return null;
 return {center:lo.clone().add(hi).multiplyScalar(.5),half:hi.clone().sub(lo).multiplyScalar(.5),cut};
}
export class StructuralDamage {
 constructor(app,owner){this.app=app;this.owner=owner;this.records=[];this.bodyBudget=224;this.joints=new Map();this.anchors=[];this.members=[];this.bodies=new Map();this.nextId=100000;this.deferred=0;this.pending=[];this.tokens=PIECE_BURST;this.debrisSinks=[];this.debrisCount=0;
  this.addRecords([...STRUCTURES,...importedStructures(app)]);
 }
 addRecords(records){
  for(const r of records){if(this.records.includes(r))continue;r.scatterIndex=this.records.length;r.spans=r.spans.map(saveSpan);Object.assign(r,spanBounds(r.spans));r.initialColliders=r.colliders.map(snapshotCollider);for(const s of r.spans)enableGeometryMotion(s.geo);this.records.push(r);}
 }
 update(dt){let changed=false;const field=this.owner.field;this.clock=(this.clock??0)+dt;
  for(const r of this.records){
   if(r.progressive&&(r.components??=this.components(r))){if(this.progress(r,dt,field))changed=true;continue;}
   if(r.active||r.broken||!r.spans.length)continue;const mat=STRENGTHS[r.material]??STRENGTHS.timber,h=r.half,p=r.center,s=field.sample(p.x,p.y,p.z),volume=Math.max(1,8*h.x*h.y*h.z),mass=volume*mat.density,area=4*h.y*Math.max(h.x,h.z),depth=Math.max(0,s.height-(p.y-h.y));
   const seismic=mass*s.shake,wind=0.5*AIR_DENSITY*(s.wx*s.wx+s.wz*s.wz+s.wy*s.wy)*area*mat.drag;
   // Integrate pressure on both opposing faces; equal flood levels cancel exactly.
   // Interiors are treated as freely flooded, with no trapped-air pressure model.
   const pressure=level=>{const d=Math.max(0,level-(p.y-h.y)),H=Math.min(d,2*h.y);return SEA_WATER_DENSITY*GRAVITY*H*(d-H*.5);};
   const px=(pressure(field.waterAt(p.x-h.x,p.z))-pressure(field.waterAt(p.x+h.x,p.z)))*2*h.z;
   const pz=(pressure(field.waterAt(p.x,p.z-h.z))-pressure(field.waterAt(p.x,p.z+h.z)))*2*h.x;
   const flood=.5*SEA_WATER_DENSITY*(s.ux*s.ux+s.uz*s.uz)*Math.min(area,2*Math.max(h.x,h.z)*depth)+Math.hypot(px,pz);
   // Each run scatters anchor capacity per building (EventRandom CAPACITY_COV), so one wind takes some
   // houses and spares their identical neighbours; without it the whole street went at once.
   const seed=this.owner.runSeed;if(r.anchorFactor===undefined||r.scatterSeed!==seed){r.scatterSeed=seed;r.anchorFactor=capacityFactor(seed,STREAM.anchor,r.scatterIndex,CAPACITY_COV[r.material]??CAPACITY_COV.timber);}
   r.load=Math.hypot(seismic,wind+flood);r.capacity=mass*GRAVITY*mat.anchorG*r.anchorFactor;r.utilization=r.load/r.capacity;
   r.damage=Math.max(0,r.damage+dt*(r.utilization>1?(r.utilization-1):-.2));
   const exposed=s.shake>.25||Math.hypot(s.wx,s.wy,s.wz)>16||(depth>.08&&s.height>.1);
   if(exposed&&(r.damage>0.08||r.utilization>.5)&&this.fracture(r))changed=true;
  }
  if(this.releasePieces(dt))changed=true;
  // One deferred static rebuild per frame, run before the next physics step. No cameraCut: the pieces start where the building stood, so resetting TAA only smeared each break (test/disaster-frame-cost.mjs).
  if(changed)this.app.rally.requestIslandColliders();
 }
 // A record with no roof covering is a deck or fixture: it keeps the jointed member path.
 components(r){
  const list=buildingComponents(r);if(!list){r.progressive=false;return null;}
  r.wallCount=list.filter(c=>c.kind==='wall').length;r.failedCount=0;r.wallsFailed=0;
  // Each part's own ground: the wind loads only the height it stands above the soil (stepComponents).
  const terrain=this.app.terrainData;
  if(terrain?.heightAt)for(const c of list)c.ground=terrain.heightAt(c.center[0],c.center[2]);
  const s=this.loadSample??={};
  // Built once per record so the per-frame step allocates nothing; the pieces queue only on a failure.
  r.onFail=c=>{const roof=c.kind==='roofCover'||c.kind==='roofFrame',wx=Number.isFinite(s.wx)?s.wx:0,wz=Number.isFinite(s.wz)?s.wz:0,ux=Number.isFinite(s.ux)?s.ux:0,uz=Number.isFinite(s.uz)?s.uz:0;
   // Declared start: a third of the wind and half the flow, and 3 m/s up for a roof piece the uplift tore off.
   this.pending.push({r,c,vx:.3*wx+.5*ux,vy:roof?3:0,vz:.3*wz+.5*uz,age:0});r.failedCount++;if(c.kind==='wall')r.wallsFailed++;
   c.failedAt=this.clock; // s of game time, so a review reads the order parts went in
   if(this.releaseCollider(r,c))r.collidersChanged=true;};
  return list;
 }
 progress(r,dt,field){
  const p=r.center,s=field.sample(p.x,p.y,p.z,this.loadSample??={}),ground=r.groundY??=(this.app.terrainData?.heightAt?.(p.x,p.z)??r.lo.y);
  r.utilization=stepComponents(r,s,ground,dt,this.owner.runSeed,(STRENGTHS[r.material]??STRENGTHS.timber).anchorG,r.onFail);
  r.damage=r.failedCount/r.components.length;
  // Half the wall panels gone: the house is down (the telemetry and evacuation read broken). Its standing
  // walls keep their own colliders (releaseCollider).
  if(!r.broken&&r.wallCount>0&&2*r.wallsFailed>=r.wallCount)r.broken=true;
  const changed=!!r.collidersChanged;
  r.collidersChanged=false;
  return changed;
 }
 // A failed part takes only its own collider with it. Defect: the first rigid piece of a house
 // disabled every collider of the record, so the walls still standing became walk-through. On a record's
 // first failure its shell box (one box over the whole body: Buildings.js 'house', 'shed') is swapped for
 // one slab per wall and masonry part, in the shell's own frame; each failure then drops only its part's slab.
 releaseCollider(r,c){
  let changed=this.splitColliders(r);
  if(c.collider&&!c.collider.disasterDisabled){disableCollider(c.collider);changed=true;}
  return changed;
 }
 splitColliders(r){
  const world=this.app.colliders;
  if(r.split||!world?.addBox)return false;
  r.split=true;
  r.slabs??=[];
  const parts=r.components.filter(c=>c.kind==='wall'||c.kind==='masonry');
  let changed=false;
  for(const box of r.colliders){
   if(!box.center||box.disasterDisabled)continue;
   // By the vertex centroid of the part's own spans: on a yawed house a corner panel's world box centre
   // can fall outside the shell (house F, test/building-damage.mjs).
   const inside=parts.filter(c=>{const m=c.centroid??=centroid(c);const [lx,lz]=world._toLocal(box,m[0],m[2]);return Math.abs(lx)<=box.half.x+.3&&Math.abs(lz)<=box.half.z+.3&&m[1]>=box.bottom-.3&&m[1]<=box.top+.3;});
   // One part inside (a chimney's box): that part owns the box. None: a porch, stoop or stair, which stays.
   if(inside.length===1&&inside[0].kind==='masonry'&&!inside[0].collider)inside[0].collider=box;
   if(inside.length<2)continue;
   const solid=box.solid;
   disableCollider(box);
   changed=true;
   for(const c of inside){
    if(c.failed||c.collider)continue;
    // The part's own spans (not the fittings riding on it) in the shell's frame, clipped to the shell.
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity,y0=Infinity,y1=-Infinity;
    for(let k=0;k<(c.own??c.spans.length);k++){const a=c.spans[k].pos;
     for(let i=0;i<a.length;i+=3){const [lx,lz]=world._toLocal(box,a[i],a[i+2]);x0=Math.min(x0,lx);x1=Math.max(x1,lx);z0=Math.min(z0,lz);z1=Math.max(z1,lz);y0=Math.min(y0,a[i+1]);y1=Math.max(y1,a[i+1]);}}
    x0=Math.max(x0,-box.half.x);x1=Math.min(x1,box.half.x);z0=Math.max(z0,-box.half.z);z1=Math.min(z1,box.half.z);y0=Math.max(y0,box.bottom);y1=Math.min(y1,box.top);
    if(!(x1>x0&&z1>z0&&y1>y0))continue;
    const lx=(x0+x1)/2,lz=(z0+z1)/2,[wx,wz]=world._toWorldDir(box,lx,lz);
    // 6 cm minimum half thickness (m): a capsule step of 5 cm never tunnels a slab.
    const slab=world.addBox(new Vector3(box.center.x+wx,(y0+y1)/2,box.center.z+wz),new Vector3(Math.max(.06,(x1-x0)/2),(y1-y0)/2,Math.max(.06,(z1-z0)/2)),box.rotY,{solid,walkable:false,tag:'wallPanel'});
    c.collider=slab;
    r.slabs.push(slab);
   }
  }
  return changed;
 }
 onDebris(fn){this.debrisSinks.push(fn);return ()=>{const i=this.debrisSinks.indexOf(fn);if(i>=0)this.debrisSinks.splice(i,1);};}
 releasePieces(dt){
  this.tokens=Math.min(PIECE_BURST,(this.tokens??PIECE_BURST)+dt*PIECE_RATE);if(!this.pending?.length)return false;
  let changed=false,handed=0;const cam=this.app.camera?.position;
  for(let i=0;i<this.pending.length;){const e=this.pending[i],c=e.c;e.age+=dt;const size=Math.max(c.hi[0]-c.lo[0],c.hi[1]-c.lo[1],c.hi[2]-c.lo[2]);
   const near=!cam||Math.hypot(c.center[0]-cam.x,c.center[1]-cam.y,c.center[2]-cam.z)<PIECE_RANGE,big=c.mass>PIECE_MASS||size>PIECE_SIZE;
   if(big&&near&&this.bodies.size<this.bodyBudget){
    // A large piece waits, drawn where it stood, for a spawn token (it never pops); past PIECE_WAIT the
    // village is failing faster than the bound and the piece lifts away through the debris hook.
    if(this.tokens<1&&e.age<PIECE_WAIT){i++;continue;}
    if(this.tokens>=1)
    if(this.spawnPiece(e)){this.tokens-=1;this.pending.splice(i,1);continue;}
   }
   if(handed>=DEBRIS_PER_FRAME){i++;continue;}
   this.hidePiece(e);handed++;this.pending.splice(i,1);
  }
  return changed;
 }
 spawnPiece({r,c,vx,vy,vz}){
  const physics=this.app.rally.physics,f=memberFrame(c.spans),half=f.half.clone(),mass=Math.max(2,c.mass);
  half.x=Math.max(.03,half.x);half.y=Math.max(.03,half.y);half.z=Math.max(.03,half.z);
  const body={id:this.nextId++,kind:'structure',name:r.name+' '+c.kind,piece:c,spans:c.spans,origin:f.center.clone(),position:f.center.clone(),quaternion:f.quaternion.clone(),restInverse:f.quaternion.clone().invert(),half,mass,area:4*half.x*half.y,volume:mass/(STRENGTHS[r.material]?.solidDensity??600),height:2*half.y};
  body.environmentLoad=context=>rigidEnvironmentalLoad(this.owner.field,physics,body,context);
  const o=body.quaternion;
  if(!physics.wake_prop(body.id,0,new Float32Array(half.toArray()),new Float32Array([f.center.x,f.center.y,f.center.z,o.x,o.y,o.z,o.w,vx,vy,vz]),mass,.65,.05,false))return false;
  this.bodies.set(body.id,body);return true;
 }
 hidePiece({r,c,vx,vy,vz}){
  const [x,y,z]=c.center;
  for(const s of c.spans){markGeometryMotion(s.geo,s.start,s.count);const a=s.geo.attributes.position;for(let i=s.start*3;i<(s.start+s.count)*3;i+=3){a.array[i]=x;a.array[i+1]=y;a.array[i+2]=z;}a.addUpdateRange(s.start*3,s.count*3);a.needsUpdate=true;}
  this.debrisCount++;if(!this.debrisSinks.length)return;
  const event={x,y,z,vx,vy,vz,size:Math.max(c.hi[0]-c.lo[0],c.hi[1]-c.lo[1],c.hi[2]-c.lo[2]),mass:c.mass,area:c.area,kind:c.kind,material:c.spans[0]?.member?.material??r.material,record:r.name};
  for(const fn of this.debrisSinks)fn(event);
 }
 fractureLegacy(r){
  // Imported unstructured meshes retain their declared legacy coarse proxy.
  // Four sectors inside a geometrically clipped 10 m imported cell. Coarse rigid
  // proxies approximate assemblies; imported surfaces have no internal cut caps.
  const bins=[[],[],[],[]];for(const s of r.spans){const b=spanBounds([s]),i=(b.center.x>r.center.x?1:0)+(b.center.z>r.center.z?2:0);bins[i].push(s);}
  const used=bins.filter(x=>x.length);if(this.bodies.size+used.length>this.bodyBudget){this.deferred++;return false;}
  const proxies=used.map(spans=>({spans,proxy:fragmentProxy(spanBounds(spans),this.app.terrainData)}));if(proxies.some(p=>!p.proxy)){this.deferred++;return false;}
  const created=[];for(const {spans,proxy:b} of proxies){const half=b.half,volume=8*half.x*half.y*half.z,mass=Math.max(2,volume*(STRENGTHS[r.material]?.density??65));
   const body={id:this.nextId++,kind:'structure',name:r.name,origin:b.center.clone(),position:b.center.clone(),quaternion:new Quaternion(),spans,half,mass,area:4*half.y*Math.max(half.x,half.z),volume:mass/(STRENGTHS[r.material]?.solidDensity??600),height:2*half.y,foundationCut:b.cut};
   if(!this.app.rally.physics.wake_prop(body.id,0,new Float32Array([half.x,half.y,half.z]),new Float32Array([...body.position.toArray(),0,0,0,1,0,0,0]),mass,.65,.05,false)){for(const b of created)this.app.rally.physics.sleep_prop(b.id);this.deferred++;return false;}created.push(body);
  }
  for(const b of created)this.bodies.set(b.id,b);r.broken=true;for(const c of r.colliders)disableCollider(c);return true;
 }
 fracture(r){
  if(!r.spans.some(s=>s.member))return this.fractureLegacy(r);
  const physics=this.app.rally.physics,terrain=this.app.terrainData??{heightAt:()=>-1000};
  if(!physics.add_structure_joint)return false;
  // Authored rest geometry and terrain are unchanged across budget deferrals and
  // Restore. Build the material description once, not every exposed frame.
  const members=r.memberDescriptions??=(materialMembers(r,terrain)),created=[],jointIds=[],anchorId=this.nextId++;
  const projectedCount=members.reduce((n,m)=>n+(!m.module&&m.material!=='masonry'&&m.length>1.5?2:1),0);
  if(this.bodies.size+projectedCount>this.bodyBudget){this.deferred++;return false;}
  if(!physics.add_structure_anchor(anchorId,new Float32Array([...r.center.toArray(),0,0,0,1])))return false;
  const rollback=()=>{for(const id of jointIds){physics.remove_structure_joint(id);this.joints.delete(id);}for(const body of created)physics.sleep_prop(body.id);physics.remove_structure_anchor(anchorId);this.deferred++;return false;};
  for(const member of members){member.record=r;member.sections=[];member.severed=false;
   const count=!member.module&&member.material!=='masonry'&&member.length>1.5?2:1;
   member.grounded=false;
   for(let k=0;k<count;k++){
    const half=member.half.clone(),center=member.center.clone(),rotation=member.quaternion.clone();
    half.x/=count;center.addScaledVector(member.axes[0],count===2?(k===0?-1:1)*member.half.x*.5:0);
    half.x=Math.max(.025,half.x);half.y=Math.max(.025,half.y);half.z=Math.max(.018,half.z);
    const initialVolume=8*half.x*half.y*half.z;
    // Clip authored buried foundations out of the collision proxy, preserving the
    // authored skin through its separate rest transform. No body pose is teleported.
    const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(v=>v.applyQuaternion(rotation));
    let ground=-Infinity,bottom=Infinity;for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const at=new Vector3(x*half.x,y*half.y,z*half.z).applyQuaternion(rotation).add(center);bottom=Math.min(bottom,at.y);ground=Math.max(ground,terrain.heightAt(at.x,at.z));}
    if(bottom<=ground+.2)member.grounded=true;
    const cut=Math.max(0,ground+.025-bottom),vertical=axes.map(a=>Math.abs(a.y)),j=vertical.indexOf(Math.max(...vertical));
    if(cut>0){const shift=cut/(2*Math.max(.01,vertical[j]));half.setComponent(j,half.getComponent(j)-shift);center.addScaledVector(axes[j],Math.sign(axes[j].y)*shift);}
    if(Math.min(half.x,half.y,half.z)<.012)continue;
    const fraction=Math.min(1,8*half.x*half.y*half.z/initialVolume),mass=Math.max(.5,member.mass/count*fraction);
    const body={id:this.nextId++,kind:'structure',name:r.name,member,origin:center.clone(),position:center.clone(),quaternion:rotation,restQuaternion:rotation.clone(),half,mass,area:member.area/count,volume:member.volume/count*fraction,height:2*axes.reduce((v,a,i)=>v+Math.abs(a.y)*half.getComponent(i),0),foundationCut:cut};
    body.environmentLoad=context=>rigidEnvironmentalLoad(this.owner.field,physics,body,context);
    if(!physics.wake_prop(body.id,0,new Float32Array(half.toArray()),new Float32Array([...center.toArray(),...rotation.toArray(),0,0,0]),mass,.65,.02,false))return rollback();
    member.sections.push(body);created.push(body);
   }
  }
  const useful=members.filter(m=>m.sections.length);if(!useful.length)return rollback();
  // Member and anchor connection strengths scatter per run too (force and moment capacity).
  const strength=m=>capacityFactor(this.owner.runSeed,STREAM.member,r.scatterIndex*4096+members.indexOf(m),CAPACITY_COV[m.material]??CAPACITY_COV.timber);
  const connect=(a,b,point,parameters,member=null,factor=1)=>{parameters[2]*=factor;parameters[3]*=factor;const id=this.nextId++;if(!physics.add_structure_joint(id,a,b,new Float32Array(point.toArray()),new Float32Array(parameters)))return false;jointIds.push(id);this.joints.set(id,{id,record:r,member,broken:false});if(member)member.joint=id;return true;};
  for(const m of useful)if(m.sections.length===2&&!connect(m.sections[0].id,m.sections[1].id,m.center,beamConnection(m),m,strength(m)))return rollback();
  let foundations=useful.filter(m=>m.grounded);if(!foundations.length)foundations=[useful.reduce((a,b)=>a.center.y-a.half.y<b.center.y-b.half.y?a:b)];
  const connected=new Set();for(const m of foundations){const body=m.sections.reduce((a,b)=>a.position.y<b.position.y?a:b),point=body.position.clone();point.y-=Math.min(body.half.x,body.half.y);
   if(!connect(anchorId,body.id,point,beamConnection(m,true),null,strength(m)))return rollback();connected.add(m);}
  // A nearest-surface spanning tree transfers every member's load into actual
  // foundations. Extra touching neighbours supply alternate load paths.
  const edges=new Set(),link=(a,b)=>{const key=[useful.indexOf(a),useful.indexOf(b)].sort((a,b)=>a-b).join(':');if(edges.has(key))return true;
   const c=nearestConnection(a,b),pick=m=>m.sections.reduce((a,b)=>a.position.distanceToSquared(c.point)<b.position.distanceToSquared(c.point)?a:b);
   const parameters=[2e-6,4e-5,Math.min(a.forceCapacity,b.forceCapacity),Math.min(a.momentCapacity,b.momentCapacity),Math.max(a.relaxation,b.relaxation)];
   if(!connect(pick(a).id,pick(b).id,c.point,parameters))return false;edges.add(key);return true;};
  while(connected.size<useful.length){let best=null;for(const a of connected)for(const b of useful)if(!connected.has(b)){const gap=nearestConnection(a,b).gap;if(!best||gap<best.gap)best={a,b,gap};}if(!link(best.a,best.b))return rollback();connected.add(best.b);}
  for(let i=0;i<useful.length;i++)for(let j=i+1;j<useful.length;j++)if(nearestConnection(useful[i],useful[j]).gap<.08&&!link(useful[i],useful[j]))return rollback();
  for(const body of created){this.bodies.set(body.id,body);if(this.app.colliders?.addBox){body.proxy=this.app.colliders.addBox(body.position,body.half,0,{solid:true,walkable:false,tag:'structural-member'});body.proxy.prop=true;}}
  this.members.push(...useful);this.anchors.push(anchorId);r.active=true;r.members=useful;r.jointIds=jointIds;r.broken=false;
  for(const collider of r.colliders)disableCollider(collider);this.sync(physics.prop_poses());return true;
 }
 sync(poses){
  for(let i=0;i<poses.length;i+=10){const b=this.bodies.get(poses[i]);if(!b)continue;
   const p=b.position,q=b.quaternion,changed=!b.poseSynchronized||p.x!==poses[i+1]||p.y!==poses[i+2]||p.z!==poses[i+3]||q.x!==poses[i+4]||q.y!==poses[i+5]||q.z!==poses[i+6]||q.w!==poses[i+7];
   if(!changed)continue;b.poseSynchronized=true;if(b.member)b.member.skinDirty=true;b.position.fromArray(poses,i+1);b.quaternion.fromArray(poses,i+4);
   // A loose building piece starts in its own principal frame: draw the rotation since rest.
   if(!b.member)drawSpans(b,b.position,b.restInverse?pieceRotation.copy(b.quaternion).multiply(b.restInverse):b.quaternion);
   if(b.proxy){const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(v=>v.applyQuaternion(b.quaternion)),h=new Vector3();for(let j=0;j<3;j++)h.setComponent(j,axes.reduce((v,a,k)=>v+Math.abs(a.getComponent(j))*b.half.getComponent(k),0));Object.assign(b.proxy,{top:b.position.y+h.y,bottom:b.position.y-h.y,radius:Math.hypot(h.x,h.z),walkable:h.y<.6});b.proxy.center.copy(b.position);b.proxy.half.copy(h);}
  }
  const jointStates=this.app.rally.physics.structure_joint_states?.()??[];
  for(let i=0;i<jointStates.length;i+=15){const j=this.joints?.get(jointStates[i]);if(!j)continue;j.broken=!!jointStates[i+1];j.force=Math.hypot(jointStates[i+2],jointStates[i+3],jointStates[i+4]);j.moment=Math.hypot(jointStates[i+5],jointStates[i+6],jointStates[i+7]);j.extension=jointStates[i+8];j.angle=jointStates[i+9];j.energy=jointStates[i+10];j.fractureEnergy=jointStates[i+11];j.utilization=jointStates[i+12];j.dampingEnergy=jointStates[i+13];j.numericalEnergy=jointStates[i+14];if(j.broken){j.record.broken=true;if(j.member){if(!j.member.severed)j.member.skinDirty=true;j.member.severed=true;}}j.record.utilization=Math.max(j.record.utilization||0,j.utilization);}
  for(const member of this.members??[])if(member.skinDirty!==false){drawMember(member);member.skinDirty=false;}
 }
 reset(){
  for(const id of this.joints?.keys()??[])this.app.rally.physics.remove_structure_joint(id);this.joints?.clear();
  for(const body of this.bodies.values()){this.app.rally.physics.sleep_prop(body.id);if(body.proxy){const i=this.app.colliders.boxes.indexOf(body.proxy);if(i>=0)this.app.colliders.boxes.splice(i,1);}}
  for(const id of this.anchors??[])this.app.rally.physics.remove_structure_anchor(id);this.anchors=[];this.members=[];this.bodies.clear();
  for(const r of this.records){restoreSpans(r.spans);for(const c of r.initialColliders)restoreCollider(c);r.broken=r.active=false;r.members=null;r.jointIds=[];r.damage=r.utilization=0;
   r.breached=false;r.floodedAt=undefined;r.wetTime=0;r.failedCount=0;r.wallsFailed=0;if(r.components)for(const c of r.components){c.failed=false;c.damage=0;c.u=0;c.failedAt=undefined;c.collider=null;}
   // The wall slabs a split added go; the shell box came back with initialColliders above.
   for(const slab of r.slabs??[]){const i=this.app.colliders.boxes.indexOf(slab);if(i>=0)this.app.colliders.boxes.splice(i,1);}
   if(r.slabs)r.slabs.length=0;r.split=false;r.collidersChanged=false;}
  this.deferred=0;this.clock=0;this.pending.length=0;this.tokens=PIECE_BURST;
 }

}

// Mean vertex of a building part's own spans (not the fittings riding on it), world metres.
function centroid(c){const m=[0,0,0];let n=0;
 for(let k=0;k<(c.own??c.spans.length);k++){const a=c.spans[k].pos;for(let i=0;i<a.length;i+=3){m[0]+=a[i];m[1]+=a[i+1];m[2]+=a[i+2];n++;}}
 return n?[m[0]/n,m[1]/n,m[2]/n]:c.center;
}
function importedStructures(app){const result=[];
 for(const site of [app.terminal,app.joeyTerminal,app.joeyVillage]){if(!site?.root)continue;site.root.updateMatrixWorld(true);const groups=new Map(),terminal=site!==app.joeyVillage;
  const chooseKey=key=>{if(key===null)return null;let record=groups.get(key);if(!record){record={name:(site===app.terminal?'Ferry terminal':site===app.joeyTerminal?'Joey terminal':'Joey shops')+' '+key,material:'masonry',spans:[],colliders:[],broken:false,damage:0,utilization:0};groups.set(key,record);}return record;};
  const choose=p=>p.y<3.4?null:chooseKey(Math.floor(p.x/10)+':'+Math.floor(p.z/10));
  site.root.traverse(mesh=>{if(!mesh.isMesh)return;const name=mesh.parent?.name??'';if(terminal&&!/^Terminal (Building|Glazing|Interior|Tower|Walkway|Jetty|Hardstand)$/.test(name))return;
   const {geometry:geo,ranges,metrics}=partitionImportedGeometry(mesh);for(const {key,start,count} of ranges){const record=chooseKey(key);if(record)record.spans.push({geo,start,count,frame:mesh.matrixWorld.clone()});}
   mesh.geometry=geo;mesh.userData.importedFragments=metrics;mesh.frustumCulled=false;
  });
  for(const c of site.disasterColliders??[]){const record=choose(c.center);if(record)record.colliders.push(c);}
  for(const record of groups.values())if(record.spans.length&&record.colliders.length)result.push(record);
 }
 return result;
}
