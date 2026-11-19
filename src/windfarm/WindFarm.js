import { Group, Vector3, Quaternion, Euler } from '../engine/index.js';
import { REFERENCE as R, ASSUMPTIONS as A } from './Reference.js';
import { TurbineModel } from './TurbineModel.js';
import { applyWakeToAir, wakeBounds } from './Wake.js';
import { verifySites, preparedWindFarmSites } from './Sites.js';
import { buildTurbine, buildAccessPaths, createFarmAssets, disposeFarmAssets } from './Geometry.js';
import { WindFarmPanel } from './Panel.js';

// The farm reads the wind without its own wake (raw) when the field offers that, so a rotor is not
// attenuated twice. A plain call: binding the method allocated a function per frame.
const sampleRaw=(field,x,y,z,out)=>field.sampleRaw?field.sampleRaw(x,y,z,out):field.sample(x,y,z,out);
export class WindFarm {
 constructor(app) {this.app=app;this.enabled=true;this.watching=false;this.turbines=[];this.visuals=[];this.detached=[];this.bodies=[];this.discardedFragments=0;this.panelClock=0;this.disposed=false;this.wakeSources=[];this.flowTime=0;this.airBounds=null;}
 async init({panel=true}={}) {
  const sites=verifySites(this.app.terrainData,this.app.colliders);
  this.assets=createFarmAssets();
  const layout=preparedWindFarmSites(this.app.terrainData);if(layout){this.paths=buildAccessPaths(this.app.terrainData,layout.paths,this.assets);this.app.scene.add(this.paths);}
  for(const site of sites) {
   const wind=this.app.disasters.field.sample(site.x,site.baseY+R.hubHeight,site.z,{});
   const yaw=Math.atan2(-wind.wx,-wind.wz);
   const t=new TurbineModel({...site,yaw,onFailure:(part)=>this.fracture(t,part)});
   const v=buildTurbine(site,this.assets);this.turbines.push(t);this.visuals.push(v);this.app.scene.add(v.root);
   v.yaw.rotation.y=yaw;v.detached=new Set();v.colliders=this.addColliders(site);v.removedColliders=[];
  }
  this.unregisterAir=this.app.disasters.field.registerAirModifier?.((x,y,z,air)=>applyWakeToAir(air,x,y,z,this.wakeSources,this.flowTime),()=>this.airBounds,()=>({kind:'windfarm',sources:this.wakeSources,time:this.flowTime}));
  this.unregister=this.app.disasters.registerExternal?.({name:'Wind farm',reset:()=>this.resetDisasterEffects()});
  this.app.rally?.refreshIslandColliders?.();
  if(panel)this.panel=new WindFarmPanel(this);
  return this;
 }
 addColliders(site) {
  const c=this.app.colliders,id=site.id;
  return [
   {part:'foundation',value:c.addCylinder(site.x,site.z,6.5,site.anchorY,site.baseY,{tag:`windfarm:${id}:footing`}),list:c.cylinders},
   {part:'tower',value:c.addCylinder(site.x,site.z,3,site.baseY,site.baseY+43.8,{tag:`windfarm:${id}:tower-lower`}),list:c.cylinders},
   {part:'tower',value:c.addCylinder(site.x,site.z,2.4675,site.baseY+43.8,site.baseY+R.towerHeight,{tag:`windfarm:${id}:tower-upper`}),list:c.cylinders},
   ...[0,Math.PI/4].map(angle=>({part:'foundation',value:c.addBox(new Vector3(site.x,site.baseY-.04,site.z),new Vector3(4.58,.04,4.58),angle,{walkable:true,solid:false,tag:`windfarm:${id}:footing-surface`}),list:c.boxes})),
  ];
 }
 update(dt) {
  if(this.disposed||this.app.disasters.paused)return;
  const field=this.app.disasters.field;
  this.flowTime+=Math.min(Math.max(0,dt),A.maxFrame);
  // Snapshot source pitch/thrust direction once per frame. Projecting Ct by
  // cos³(yaw+tilt error) accounts for actual streamwise momentum extraction.
  // The sources, the wind scratches and the bounds keep their objects frame to frame: a map, a
  // source object and three {} per turbine plus two bound functions were rebuilt every frame (// test/frame-garbage.mjs). Field.sampleRaw resets every key it writes, so a reused out reads the same.
  const sources=this.wakeSources,scratch=this.windScratch??={source:{},ambient:{},base:{}};
  sources.length=this.turbines.length;
  for(let i=0;i<this.turbines.length;i++){
   const t=this.turbines[i],air=sampleRaw(field,t.x,t.baseY+R.hubHeight,t.z,scratch.source),speed=Math.hypot(air.wx,air.wy,air.wz),horizontal=Math.hypot(air.wx,air.wz);
   const axial=-(air.wx*Math.sin(t.yaw)*Math.cos(R.tilt)+air.wy*Math.sin(R.tilt)+air.wz*Math.cos(t.yaw)*Math.cos(R.tilt));
   const aligned=speed>.01?Math.max(0,axial/speed):0;
   const s=sources[i]??={};
   s.id=t.id;
   s.x=t.x;
   s.z=t.z;
   s.baseY=t.baseY;
   s.damaged=t.damaged;
   s.ct=t.ct*aligned**3;
   s.flowX=horizontal>.01?air.wx/horizontal:0;
   s.flowZ=horizontal>.01?air.wz/horizontal:0;
  }
  this.airBounds=wakeBounds(sources,this.airBounds??undefined);
  for(let i=0;i<this.turbines.length;i++) {
   const t=this.turbines[i],v=this.visuals[i];t.farmEnabled=this.enabled;
   const ambient=sampleRaw(field,t.x,t.baseY+R.hubHeight,t.z,scratch.ambient),base=sampleRaw(field,t.x,t.terrainMin+0.1,t.z,scratch.base);
   // A rotor receives disk-averaged flow; other consumers sample the same wake
   // pointwise through Field.sample. Raw input prevents double attenuation.
   t.wakeFactor=applyWakeToAir(ambient,t.x,t.baseY+R.hubHeight,t.z,this.wakeSources,this.flowTime,R.radius,t.id);
   t.advance(dt,ambient,base);
   if(!v.detached.has(v.yaw))v.yaw.rotation.y=t.yaw;
   if(!v.detached.has(v.yaw)){v.rotor.rotation.z=t.angle;for(const b of v.blades)if(!v.detached.has(b.pitch))b.pitch.rotation.y=t.pitch;}
   if(!t.failedComponents.includes('tower')&&!t.failedComponents.includes('foundation')) {
    v.flex.rotation.z=-Math.atan2(t.deflectionX,R.hubHeight);v.flex.rotation.x=Math.atan2(t.deflectionZ,R.hubHeight);
   }
  }
  this.panelClock+=Math.min(Math.max(0,dt),A.maxFrame);
  if(this.panelClock>=.15){this.panelClock=0;this.panel?.render();}
 }
 removeColliders(v,parts) {
  let removed=false;
  for(const c of v.colliders)if(parts.includes(c.part)&&!v.removedColliders.includes(c)) {const index=c.list.indexOf(c.value);if(index>=0)c.list.splice(index,1);v.removedColliders.push(c);removed=true;}
  if(removed)this.app.rally?.refreshIslandColliders?.();
 }
 detach(t,v,node,mass,half,offset=new Vector3(),rotating=false) {
  if(v.detached.has(node))return;
  const original={node,parent:node.parent,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone(),visible:node.visible};
  node.updateWorldMatrix(true,true);
  const rotation=node.getWorldQuaternion(new Quaternion()),position=node.localToWorld(offset.clone());
  const group=new Group();group.name=`${node.name||t.id} detached component`;group.position.copy(position);group.quaternion.copy(rotation);
  node.parent.remove(node);group.add(node);node.position.copy(offset).multiplyScalar(-1);node.quaternion.identity();node.scale.set(1,1,1);this.app.scene.add(group);
  const velocity=new Vector3(t.deflectionVX,0,t.deflectionVZ),angularVelocity=new Vector3();
  if(rotating) {
   const axis=new Vector3(Math.sin(t.yaw)*Math.cos(R.tilt),Math.sin(R.tilt),Math.cos(t.yaw)*Math.cos(R.tilt));angularVelocity.copy(axis).multiplyScalar(t.omega);
   const hub=v.shaft.getWorldPosition(new Vector3()),arm=position.clone().sub(hub);velocity.add(new Vector3().crossVectors(angularVelocity,arm));
  }
  const body=this.app.disasters.addBody?.({name:`${t.id} ${node.name||'component'}`,mesh:group,mass,half,position,quaternion:rotation,velocity,angularVelocity,area:4*half.y*Math.max(half.x,half.z),volume:8*half.x*half.y*half.z*.06,height:2*half.y});
  if(body)this.bodies.push(body);else{group.visible=false;this.discardedFragments++;}
  original.group=group;original.body=body;this.detached.push(original);v.detached.add(node);
 }
 fracture(t,part) {
  const v=this.visuals[this.turbines.indexOf(t)];if(!v)return;
  const blade=(b)=>this.detach(t,v,b.pitch,R.bladeMass,new Vector3(3,30.75,1.7),new Vector3(0,30.75,0),true);
  if(part==='blade')blade(v.blades[0]);
  if(['nacelle','tower','foundation'].includes(part)) {
   for(const b of v.blades)blade(b);
   this.detach(t,v,v.yaw,R.nacelleMass+R.hubMass,new Vector3(3.2,3.8,8),new Vector3(0,1.8,-.25));
  }
  if(part==='tower'||part==='foundation') {
   this.detach(t,v,v.towerTop,R.towerMass*.4,new Vector3(2.4675,21.9,2.4675),new Vector3(0,65.7,0));
   this.detach(t,v,v.towerBottom,R.towerMass*.6,new Vector3(3,21.9,3),new Vector3(0,21.9,0));
   this.removeColliders(v,['tower']);
  }
  // A failed anchor releases the supported tower, while the visible buried
  // concrete footing remains real ground-contact geometry and collision.

 }
 watch() {
  if(this.app.setFreeCam(true)===false)return;
  // The northern coast, all three dry foundations and the trail stay in view.
  const target=new Vector3(70,65,-680),eye=new Vector3(160,250,-1530);
  this.app.camera.position.copy(eye);this.app.camera.lookAt(target);
  const e=new Euler().setFromQuaternion(this.app.camera.quaternion,'YXZ');this.app.fly.setPose(eye,e.y,e.x);this.app.fly.velocity.set(0,0,0);this.app.cameraCut?.();this.watching=true;
 }
 inspect(index=0) {
  const t=this.turbines[index],normal=new Vector3(Math.sin(t.yaw),0,Math.cos(t.yaw)),right=new Vector3(normal.z,0,-normal.x);
  const hub=new Vector3(t.x,t.baseY+R.hubHeight,t.z),eye=hub.clone().addScaledVector(normal,-25).addScaledVector(right,30).add(new Vector3(0,12,0));
  const target=hub.clone().addScaledVector(normal,-3).addScaledVector(right,-9);
  if(this.app.setFreeCam(true)===false)return;this.app.camera.position.copy(eye);this.app.camera.lookAt(target);const e=new Euler().setFromQuaternion(this.app.camera.quaternion,'YXZ');this.app.fly.setPose(eye,e.y,e.x);this.app.fly.velocity.set(0,0,0);this.app.cameraCut?.();this.watching=true;this.inspected=t.id;
 }
 inspectFoundation(index=0) {
  const t=this.turbines[index],eye=new Vector3(t.x+20,t.baseY+10,t.z+30),target=new Vector3(t.x-7,t.baseY+4,t.z);
  if(this.app.setFreeCam(true)===false)return;this.app.camera.position.copy(eye);this.app.camera.lookAt(target);const e=new Euler().setFromQuaternion(this.app.camera.quaternion,'YXZ');this.app.fly.setPose(eye,e.y,e.x);this.app.fly.velocity.set(0,0,0);this.app.cameraCut?.();this.watching=true;this.inspected=`${t.id} foundation`;
 }

 resetDisasterEffects() {
  // Restore parents in reverse order so nested yaw/blade pieces have a valid
  // frame before their saved local transforms are used again.
  for(const saved of [...this.detached].reverse()) {
   if(saved.body)this.app.disasters.removeBody?.(saved.body);
   saved.node.parent?.remove(saved.node);saved.parent.add(saved.node);saved.node.position.copy(saved.position);saved.node.quaternion.copy(saved.quaternion);saved.node.scale.copy(saved.scale);saved.node.visible=saved.visible;saved.group.parent?.remove(saved.group);
  }
  this.detached.length=0;this.bodies.length=0;this.discardedFragments=0;this.wakeSources=[];this.airBounds=null;this.flowTime=0;
  for(let i=0;i<this.turbines.length;i++) {
   const t=this.turbines[i],v=this.visuals[i],energy=t.energyJ;
   t.reset();t.energyJ=energy;v.detached.clear();v.flex.rotation.set(0,0,0);v.yaw.rotation.y=t.yaw;v.rotor.rotation.z=0;for(const b of v.blades)b.pitch.rotation.y=0;
   for(const c of v.removedColliders)if(!c.list.includes(c.value))c.list.push(c.value);v.removedColliders.length=0;
  }
  this.app.rally?.refreshIslandColliders?.();this.panel?.syncControls();this.panel?.render();
 }
 reset(){if(this.app.deferSimulationChange?.(()=>this.reset()))return;this.resetDisasterEffects();this.enabled=true;for(const t of this.turbines)t.reset();this.panel?.syncControls();this.panel?.render();}
 state() {
  const turbines=this.turbines.map(t=>({...t.state(),wakeFactor:t.wakeFactor??1}));
  const electricalPower=turbines.reduce((sum,t)=>sum+t.electricalPower,0),energyJ=turbines.reduce((sum,t)=>sum+t.energyJ,0);
  return {enabled:this.enabled,electricalPower,energyJ,energyMWh:energyJ/3.6e9,damaged:turbines.filter(t=>t.damaged).length,bodyCount:this.bodies.length,lowestFragmentY:this.bodies.length?Math.min(...this.bodies.map(b=>b.position.y)):0,solidTowerSections:this.visuals.reduce((n,v)=>n+v.colliders.filter(c=>c.part==='tower'&&!v.removedColliders.includes(c)).length,0),discardedFragments:this.discardedFragments,dryFoundations:this.turbines.filter(t=>t.terrainMin>0).length,turbines};
 }
 dispose() {
  if(this.disposed)return;this.resetDisasterEffects();this.disposed=true;this.unregisterAir?.();this.unregister?.();this.panel?.dispose();
  for(const v of this.visuals){this.removeColliders(v,['tower','foundation']);this.app.scene.remove(v.root);}
  if(this.paths)this.app.scene.remove(this.paths);disposeFarmAssets(this.assets,[...this.visuals.map(v=>v.root),...(this.paths?[this.paths]:[])]);
 }
}
