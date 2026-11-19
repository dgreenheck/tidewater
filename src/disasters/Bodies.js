import { Vector3, Quaternion, Matrix4 } from '../engine/index.js';
import { createFallenVegetation } from './FallenVegetation.js';
import { rigidEnvironmentalLoad,treeLoadPoints } from './RigidLoads.js';
import { treeMassProperties } from './TreeMass.js';
import { treeCapacity, standingMoment, snapHeight, hingeStep, RELEASE_TILT, CROWN_SUPPORT } from './TreeFailure.js';
import { uniform,STREAM } from './EventRandom.js';
import { disableCollider,snapshotCollider,restoreCollider } from './Structures.js';
const one=new Vector3(1,1,1),zero=new Vector3(),m=new Matrix4(),q=new Quaternion();
// Scratch for sync: never escapes the call.
const syncBase=new Vector3();

const NEAR_BODY_RANGE=300; // m: the solver budget goes where the player can see a body's contacts
const TREE_SPIN_CAP=2; // rad/s: declared; a felled tree's crown drag keeps real tumbling far below this
const TREE_ANGULAR_DAMPING=.5; // 1/s: declared; branch and ground drag the point loads do not model
const TREE_FRICTION=.9; // bark and branches snag on ground and walls (declared; boxes use .7)
const HINGE_STEP=1/120; // s, the physics rate
const TREE_GROUP_LIMIT=160; // falling and fallen tree copies, each one or two draws (declared budget)
const hingeAxis=new Vector3(),hingeQ=new Quaternion(),hingePivot=new Vector3();
const STILL={wx:0,wz:0};
export class DisasterBodies {
 constructor(app,owner){this.app=app;this.owner=owner;this.bodies=new Map();this.parked=[];this.trees=[];this.next=200000;this.treeLimit=40;this.treeBodies=0;this.treeGroups=0;this.carLimit=24;this.deferred=0;
  for(const [type,records]of [[app.vegetation?.palms,app.vegetation?.records.palms],[app.vegetation?.canopy,app.vegetation?.records.trees]])if(type)for(let i=0;i<records.length;i++){const r=records[i];this.trees.push({type,r,i,k:this.trees.length,kind:type.name==='palms'?'palms':'canopy',damage:0,fallen:false});}
  for(const item of app.rally.supports??[])this.register({...item,name:'Parked support vehicle',mass:1800,half:new Vector3(1,.85,item.halfLength),height:1.7,area:4,volume:2.5});
  for(const terminal of [app.terminal,app.joeyTerminal]){
   const groups=new Map();for(const mesh of terminal?.parkedMeshes??[])for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);const pos=new Vector3().setFromMatrixPosition(m),key=pos.x.toFixed(3)+','+pos.z.toFixed(3);let r=groups.get(key);if(!r){r={name:'Parked terminal car',position:pos,quaternion:new Quaternion(),parts:[],mass:1400,half:new Vector3(.95,.75,2.1),height:1.5,area:3,volume:2};m.decompose(zero,r.quaternion,one);groups.set(key,r);}r.parts.push({mesh,i,m:m.clone()});}
   for(const r of groups.values())this.register(r);
  }
 }
 addExternal(opts){
  if([...this.bodies.values()].filter(b=>b.kind==='external').length>=48)return null;
  const half=Array.isArray(opts.half)?new Vector3().fromArray(opts.half):opts.half.clone(),position=opts.position.clone(),rotation=(opts.quaternion??new Quaternion()).clone();
  const b={...opts,id:this.next++,kind:'external',root:opts.mesh,origin:position.clone(),position,quaternion:rotation,half,area:opts.area??4*half.y*Math.max(half.x,half.z),volume:opts.volume??8*half.x*half.y*half.z,height:opts.height??half.y*2};
  const h=half,v=opts.velocity??new Vector3(),q=rotation;
  if(!this.app.rally.physics.wake_prop(b.id,0,new Float32Array([h.x,h.y,h.z]),new Float32Array([position.x,position.y,position.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z]),b.mass,.6,.05,false))return null;
  if(b.root){b.parent=b.root.parent;this.app.scene.add(b.root);b.root.position.copy(position);b.root.quaternion.copy(rotation);}
  if(opts.angularVelocity)this.app.rally.physics.set_prop_angular_velocity(b.id,new Float32Array(opts.angularVelocity.toArray()));
  this.bodies.set(b.id,b);return b;
 }
 removeExternal(b){if(!b)return;this.app.rally.physics.sleep_prop(b.id);this.bodies.delete(b.id);}

 register(opts){const root=opts.root??opts.model?.root,p=(opts.position??root?.position)?.clone();if(!p)return null;const r={...opts,root,origin:p.clone().add(new Vector3(0,opts.half.y,0)),position:p.clone().add(new Vector3(0,opts.half.y,0)),initial:p.clone(),quaternion:(opts.quaternion??root?.quaternion??new Quaternion()).clone(),initialQ:(opts.quaternion??root?.quaternion??new Quaternion()).clone(),colliders:opts.colliders??(opts.collider?[opts.collider]:[]),kind:'vehicle',damage:0};r.snap=r.colliders.map(snapshotCollider);this.parked.push(r);return r;}
 update(dt){let dirty=false;const field=this.owner.field,sample=this.loadSample??={},seed=this.owner.runSeed;
  for(const t of this.trees){
   if(t.mode){if(t.phase==='hinge')this.hinge(t,dt);continue;}
   const r=t.r,s=field.sample(r.x,r.y,r.z,sample),depth=Math.max(0,s.height-r.y);
   // Root plate and stem capacities scatter per event (TreeFailure.js), so one gust does not fell every tree of a size.
   if(t.scatterSeed!==seed||!t.cap){t.scatterSeed=seed;t.mass??=treeMassProperties(r,t.type.name);t.cutAt=snapHeight(r,t.mass,t.kind,seed,t.k);t.cap=treeCapacity(t.mass,t.kind,t.cutAt,seed,t.k,t.cap??{});}
   const uproot=standingMoment(t.mass,s,depth,0)/t.cap.uproot,snap=standingMoment(t.mass,s,depth,t.cutAt)/t.cap.snap,util=Math.max(uproot,snap);
   // Below failure the tree bends: util is what a sway shader would read (remainder, docs/disaster-damage.md).
   // t.load: the governing load ratio (the larger of uproot and snap); damage grows only above 1, and the
   // tsunami spec reads it (no tree falls that never passed 1).
   t.util=util;t.load=util;t.damage=Math.max(0,t.damage+dt*(util>1?util-1:-.3));
   if(t.damage>.5&&this.fail(t,s,snap>uproot?'snap':'uproot'))dirty=true;
  }
  let cars=[...this.bodies.values()].filter(x=>x.kind==='vehicle').length;for(const r of this.parked){if(r.id!==undefined)continue;const s=field.sample(r.position.x,r.position.y,r.position.z),wind=Math.hypot(s.wx,s.wy,s.wz),depth=s.height-(r.position.y-r.half.y);if(s.shake<3&&wind<25&&depth<.3)continue;if(cars>=this.carLimit){this.deferred++;break;}r.id=this.next++;if(!this.spawn(r)){delete r.id;this.deferred++;continue;}for(const c of r.colliders)disableCollider(c);cars++;dirty=true;}
  // One deferred static rebuild per frame, run before the next physics step. No cameraCut: the pieces start where the building stood, so resetting TAA only smeared each break (test/disaster-frame-cost.mjs).
  if(dirty)this.app.rally.requestIslandColliders();
 }
 get fallenCount(){let n=0;for(const t of this.trees)if(t.fallen)n++;return n;}
 spawn(r){const h=r.half,p=r.position,q=r.quaternion,v=r.velocity,physics=this.app.rally.physics;if(physics.wake_prop(r.id,0,new Float32Array([h.x,h.y,h.z]),new Float32Array([p.x,p.y,p.z,q.x,q.y,q.z,q.w,v?.x??0,v?.y??0,v?.z??0]),r.mass,r.friction??.7,.05,false)){
  // A released tree: crown sphere first (its auto mass is then overridden), spin cap last.
  if(r.crownSupport&&physics.set_prop_crown&&!physics.set_prop_crown(r.id,new Float32Array([h.x,h.y,h.z]),r.crownCentre,r.crownSupport)){physics.sleep_prop(r.id);return false;}
  if(r.principalInertia&&!physics.set_prop_mass_properties(r.id,r.mass,new Float32Array(r.principalInertia),new Float32Array(r.centerOfMass))){physics.sleep_prop(r.id);return false;}
  if(r.spinCap&&physics.set_prop_motion_limits)physics.set_prop_motion_limits(r.id,TREE_ANGULAR_DAMPING,r.spinCap);
  if(r.angularVelocity)physics.set_prop_angular_velocity(r.id,new Float32Array([r.angularVelocity.x,r.angularVelocity.y,r.angularVelocity.z]));
  this.bodies.set(r.id,r);return true;}return false;}
 // A tree gives way: copy its authored mesh (whole, or the top above the break plus a standing
 // stump), hide the forest instance and start the hinge. s is the field sample that failed it.
 fail(t,s,mode){
  if(this.treeGroups>=TREE_GROUP_LIMIT){this.deferred++;return false;}
  const {r,type,i}=t,H=Math.max(3,r.H||6),cut=mode==='snap'?t.cutAt:0,origin=new Vector3(r.x,r.y+H*.5,r.z);
  const group=createFallenVegetation(type,r,i,origin,cut);
  if(!group.children.length){group.dispose();this.deferred++;return false;}
  if(mode==='snap'){t.stump=createFallenVegetation(type,r,i,origin,-cut);t.stump.position.copy(origin);this.app.scene.add(t.stump);}
  // The tree falls along the wind that failed it; shaking alone picks a seeded direction.
  const wind=Math.hypot(s.wx,s.wz),angle=2*Math.PI*uniform(this.owner.runSeed??0,STREAM.tree,1e6+t.k);
  t.dirX=wind>1e-3?s.wx/wind:Math.cos(angle);t.dirZ=wind>1e-3?s.wz/wind:Math.sin(angle);
  t.mass??=treeMassProperties(r,type.name);t.cap??=treeCapacity(t.mass,t.kind,t.cutAt??0,this.owner.runSeed,t.k,{});
  t.mode=mode;t.cut=cut;t.piece=treeMassProperties(r,type.name,cut);t.capacity=mode==='snap'?t.cap.snap:t.cap.uproot;
  t.theta=0;t.omega=0;t.hingeInertia=undefined;t.phase='hinge';t.group=group;group.position.copy(origin);this.app.scene.add(group);this.treeGroups++;
  // The animated fall stops when the crown centre is a crushed crown's height off the ground.
  const lever=t.piece.crownY-cut,ground=this.app.terrainData?.heightAt?.(r.x+t.dirX*lever,r.z+t.dirZ*lever)??r.y,c=(ground+CROWN_SUPPORT*t.piece.crownRadius-r.y-cut)/lever;
  t.restTilt=c<=0?Math.PI/2:Math.max(.5,Math.acos(Math.min(1,c)));
  this.hideInstance(t);t.fallen=true;r.disasterFallen=true;return true;
 }
 hinge(t,dt){
  const r=t.r,s=this.owner.field.sample(r.x,r.y+t.piece.crownY,r.z,this.loadSample),u=s.wx*t.dirX+s.wz*t.dirZ;
  for(let left=Math.min(dt,.1);left>1e-9;left-=HINGE_STEP){hingeStep(t,t.piece,u,Math.min(HINGE_STEP,left));if(t.theta>=t.restTilt){t.theta=t.restTilt;t.omega=0;t.phase='rest';break;}}
  this.poseHinge(t);
  const cam=this.app.camera.position,near=Math.hypot(cam.x-r.x,cam.z-r.z)<NEAR_BODY_RANGE;
  if(t.phase==='hinge'&&t.theta>=RELEASE_TILT&&near&&this.treeBodies<this.treeLimit)this.release(t);
 }
 poseHinge(t){
  const r=t.r,H=Math.max(3,r.H||6);hingeAxis.set(t.dirZ,0,-t.dirX);hingeQ.setFromAxisAngle(hingeAxis,t.theta);
  t.group.quaternion.copy(hingeQ);t.group.position.set(0,H*.5-t.cut,0).applyQuaternion(hingeQ).add(hingePivot.set(r.x,r.y+t.cut,r.z));
 }
 // Hand the swinging piece to the solver with the hinge's pose and velocity, so nothing jumps.
 release(t){
  const r=t.r,piece=t.piece,H=Math.max(3,r.H||6);this.poseHinge(t);
  const pivot=new Vector3(r.x,r.y+t.cut,r.z),angularVelocity=hingeAxis.clone().multiplyScalar(t.omega);
  const position=new Vector3(0,piece.stemY-t.cut,0).applyQuaternion(hingeQ).add(pivot),velocity=angularVelocity.clone().cross(new Vector3(0,piece.comY-t.cut,0).applyQuaternion(hingeQ));
  const radius=Math.max(.25,piece.radius),body={id:this.next++,kind:'tree',name:t.mode==='snap'?(t.type.name==='palms'?'Snapped palm':'Snapped tree'):(t.type.name==='palms'?'Uprooted palm':'Uprooted tree'),root:t.group,origin:position.clone(),position,quaternion:hingeQ.clone(),
   half:new Vector3(radius,piece.length*.5,radius),mass:piece.mass,area:H*.8,volume:piece.volume,height:piece.length,tree:t,massModel:piece,principalInertia:piece.principalInertia,centerOfMass:piece.centerOfMass,
   renderOffset:new Vector3(0,H*.5-piece.stemY,0),crownCentre:piece.crownY-piece.stemY,crownSupport:CROWN_SUPPORT*piece.crownRadius,friction:TREE_FRICTION,spinCap:TREE_SPIN_CAP,velocity,angularVelocity};
  body.loadPoints=treeLoadPoints(piece.length,piece.radius,piece.crownRadius*Math.sqrt(2/5),{crownY:piece.crownY-piece.stemY,crownHalfHeight:piece.crownHalfHeight,stemShare:piece.stemVolume/piece.volume,crownShare:piece.crownVolume/piece.volume});
  body.environmentLoad=context=>rigidEnvironmentalLoad(this.owner.field,this.app.rally.physics,body,context);
  if(!this.spawn(body)){this.deferred++;return false;}
  t.body=body;t.phase='body';this.treeBodies++;return true;
 }
 // Release a standing tree whole and upright as a body (tests and tools); the director never does this.
 fall(t){if(t.mode||!this.fail(t,STILL,'uproot'))return false;if(this.release(t))return true;this.restoreTree(t);return false;}
 hideInstance(t){const {type,i}=t,inst=type.inst,base=i*4,at=i*16;t.saved={matrix:inst.matrices.slice(at,at+16),ip:inst.iPos.slice(base,base+4)};
  // Both LOD paths read these buffers: move the dead instance underground and make scale 0.
  inst.iPos[base+1]=-10000;inst.iPos[base+3]=0;for(const k of [0,5,10])inst.matrices[at+k]=0;inst.matrices[at+13]=-10000;type.farX=Infinity;type.lastX=Infinity;type.update(this.app.camera.position,true);if(type.far&&!type.farExcludeNear&&!type.sortFar)type.far.fill(inst);
 }
 restoreTree(t){
  for(const g of [t.group,t.stump])if(g){this.app.scene.remove(g);g.dispose();}
  if(t.group)this.treeGroups--;
  if(t.fallen){const inst=t.type.inst;inst.matrices.set(t.saved.matrix,t.i*16);inst.iPos.set(t.saved.ip,t.i*4);t.type.farX=Infinity;t.type.lastX=Infinity;t.type.update(this.app.camera.position,true);if(t.type.far&&!t.type.farExcludeNear&&!t.type.sortFar)t.type.far.fill(inst);}
  t.fallen=false;t.r.disasterFallen=false;t.damage=0;t.mode=undefined;t.phase=undefined;t.group=null;t.stump=null;t.body=null;t.theta=0;t.omega=0;
 }
 // Runs every frame for every awake body (305 at t 4 s of the default tornado). It used to build two or
 // three Vector3 per vehicle or part-built body to find its base: 47 scavenges per 15000 frames
 // (test/disaster-bookkeeping-alloc.mjs). The base is the body centre less half its height along
 // the body's own up, the same sum in the same order as before.
 sync(poses){
  for(let i=0;i<poses.length;i+=10){
   const b=this.bodies.get(poses[i]);if(!b)continue;b.position.fromArray(poses,i+1);b.quaternion.fromArray(poses,i+4);
   const drawBase=b.parts||b.kind==='vehicle'?syncBase.set(0,-b.half.y,0).applyQuaternion(b.quaternion).add(b.position):null;
   // A tree's mesh origin sits renderOffset up its own axis from the body centre (a snapped top's centre is above the tree's).
   if(b.root){if(b.renderOffset)b.root.position.copy(syncBase.copy(b.renderOffset).applyQuaternion(b.quaternion).add(b.position));else b.root.position.copy(drawBase&&b.kind==='vehicle'?drawBase:b.position);b.root.quaternion.copy(b.quaternion);}
   if(b.parts){m.compose(drawBase,b.quaternion,one);for(let j=0;j<b.parts.length;j++){const part=b.parts[j];part.mesh.setMatrixAt(part.i,m);part.mesh.instanceMatrix.needsUpdate=true;part.mesh.frustumCulled=false;}}
  }
 }
 reset(){for(const b of this.bodies.values())this.app.rally.physics.sleep_prop(b.id);this.bodies.clear();this.treeBodies=0;
  for(const t of this.trees)if(t.mode||t.fallen)this.restoreTree(t);
  for(const r of this.parked){delete r.id;r.position.copy(r.origin);r.quaternion.copy(r.initialQ);if(r.root){r.root.position.copy(r.initial);r.root.quaternion.copy(r.initialQ);}if(r.parts)for(const part of r.parts){part.mesh.setMatrixAt(part.i,part.m);part.mesh.instanceMatrix.needsUpdate=true;}for(const c of r.snap)restoreCollider(c);}this.deferred=0;
 }
}
