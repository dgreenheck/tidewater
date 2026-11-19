import { Vector3, Quaternion, Euler, Group, Mesh, CylinderGeometry, TorusGeometry } from '../engine/index.js';
import { freshSeed } from './EventRandom.js';
import { TornadoVisuals } from './TornadoVisuals.js';
import { HumanDebrisContacts } from './HumanContacts.js';
import { G } from '../core/Globals.js';
import { DisasterField,DEFAULTS,validate } from './Field.js';
import { StructuralDamage,snapshotCollider,restoreCollider,saveSpan,restoreSpans } from './Structures.js';
import { DisasterBodies } from './Bodies.js';
import { PROPS,MAX_AWAKE } from '../physics/Props.js';
import { DisasterControls } from './Controls.js';
import { TsunamiSiren } from './Siren.js';
import { dynamicPressure } from '../physics/Loads.js';
const p=new Vector3(),v=new Vector3(),f=new Vector3(),q=new Quaternion();
// People tipping (people()): the same body sampled at rest, so the test reads the fluid's push and
// not the person's own wading drag. atRest stays (0, 0, 0) m/s; tipBody and push are reused scratch, filled per person.
const atRest=new Vector3(),push={},tipBody={mass:72,area:.7,volume:.072,height:1.7,supported:false,dt:1/60};
const TIP_PUSH=3.2; // m/s²: lateral outside push that tips a standing person (declared stance)
// A motor that returns nothing adds no load (shared, never written).
const NO_LOAD=Object.freeze({});
// Load options for one body: the fields Field.acceleration reads (an absent field stays undefined so its
// default still applies), the two load hooks and dt. One literal, so every body shares one shape.
function loadOptions(){return {mass:0,area:0,volume:undefined,height:undefined,buoyancy:undefined,waterDrag:undefined,supported:false,dt:0,environmentLoad:undefined,controlLoad:undefined,fixed:undefined};}
function copyLoadOptions(o,r,supported){o.mass=r.mass;o.area=r.area;o.volume=r.volume;o.height=r.height;o.buoyancy=r.buoyancy;o.waterDrag=r.waterDrag;o.environmentLoad=r.environmentLoad;o.controlLoad=r.controlLoad;o.supported=supported;return o;}
const fixed=x=>Number.isFinite(x)?x.toFixed(2):'0.00';
export class Disasters {
 constructor(app,water){
  this.app=app;this.water=water;this.field=new DisasterField((x,z)=>app.terrainData.heightAt(x,z));this.field.ambient=()=>({x:G.windDir.value.x*G.windSpeed.value,z:G.windDir.value.y*G.windSpeed.value});
  this.paused=false;this.restored=true;this.peakForce=this.rawPeakForce=0;this.limited=0;this.waterMs=0;this.touched=new Set();this.vesselSnapshots=null;this.changedPeople=new Map();this.external=new Set();
  this.humanContacts=new HumanDebrisContacts(this);this.frameDt=0;this.structures=new StructuralDamage(app,this);this.bodies=new DisasterBodies(app,this);this.siren=new TsunamiSiren(app);
  this.propSnapshots=new Map(PROPS.all.map(r=>[r.id,{r,m:r.m?.clone(),walker:r.walker?.slice(),box:r.box,broken:r.broken,spans:r.spans?.map(saveSpan),colliders:[...(r.walker??[]),...(r.box?[r.box]:[])].map(snapshotCollider)}]));
  app.boatCtl.environment=this.field;app.jetskis.ctl.environment=this.field;
  app.boatCtl.disasterForces=(body,F,T)=>this.craft(body,F,T,6,body.disasterDt);
  app.jetskis.ctl.disasterForces=(body,F,T)=>this.craft(body,F,T,1.6,body.disasterDt);
  this.ui=new DisasterControls(this);this.visuals();this.refresh();
  window.addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat&&!/INPUT|SELECT|TEXTAREA/.test(e.target?.tagName??'')&&(this.paused||!app.audio)){if(app.audio)app.audio.setMuted(!app.audio.muted);else this.globalMuted=!this.globalMuted;this.refresh();}});
 }
 registerExternal(adapter){this.external.add(adapter);return ()=>this.external.delete(adapter);}
 addBody(options){return this.bodies.addExternal(options);}
 removeBody(record){this.bodies.removeExternal(record);}
 registerBody(options){return this.bodies.register(options);}
 start(kind,config){const error=validate(kind,{...DEFAULTS[kind],...config});if(error)throw new RangeError(error);if(this.app?.deferSimulationChange?.(()=>this.start(kind,{...config})))return;if(!this.vesselSnapshots)this.capture();
  // A run that starts from calm draws a fresh seed for its capacity scatter (EventRandom). Internal: tests and telemetry read runSeed; no panel shows it.
  // nextSeed: a one-shot replay hook for the browser specs and bug repro (window.__app.disasters.nextSeed = n).
  // The next real start takes it as both the event's seed (the tsunami plan, the tornado track) and runSeed,
  // then clears it; a start deferred to the frame boundary keeps it until it runs. Internal plumbing only:
  // no panel, key or HUD shows or sets it (rule 6, test/disaster-next-seed.mjs).
  const fixed=this.nextSeed;this.nextSeed=null;
  if(fixed!=null){this.runSeed=fixed>>>0;config={...config,seed:fixed>>>0};}else if(!this.field.events.size)this.runSeed=freshSeed();
  this.field.start(kind,config);this.restored=false;this.paused=false;this.field.paused=false;this.siren.arm().then(()=>this.refresh());this.refresh();}
 pause(on){if(this.app?.deferSimulationChange?.(()=>this.pause(on)))return;this.paused=on;this.field.paused=on;this.app.input.keys.clear();this.app.input.pressed.clear();this.refresh();}
 stop(){if(this.app?.deferSimulationChange?.(()=>this.stop()))return;this.field.stop();this.paused=false;this.field.paused=false;this.app.rally.physics.set_disaster_loads(new Float32Array());for(const r of PROPS.all)r.disasterActive=false;this.water.update(this.field);this.siren.stop();this.tornadoVisuals.clear();for(const adapter of this.external)adapter.stop?.();this.refresh();}
 capture(){
  const A=this.app,save=b=>({body:b,p:b.position.clone(),q:b.quaternion.clone(),v:b.velocity?.clone(),angular:b.angular?.clone(),moored:b.moored});
  const peopleBaseline=new Map(A.people.list.map(person=>[person,this.personSnapshot(person)]));
  const vesselSnapshots={boat:save(A.boatCtl),ski:save(A.jetskis.ctl),ship:save(A.ferry.ship),shipState:Object.fromEntries(['yaw','u','v','r','heave','pitch','roll','moored','settled','berth','lever','power'].map(k=>[k,A.ferry.ship[k]])),car:Array.from(A.rally.physics.disaster_car_state()),damage:A.rally.damage.captureDisasterState(),player:{p:A.player.position.clone(),v:A.player.velocity.clone(),mode:A.player.mode,yaw:A.player.yaw,pitch:A.player.pitch,waterState:A.player.captureWaterState?.()},skis:A.jetskis.skis.map(s=>({s,p:s.position.clone(),q:s.quaternion.clone()})),camera:{p:A.camera.position.clone(),q:A.camera.quaternion.clone(),free:A.freeCam}};
  try{for(const adapter of this.external)adapter.capture?.();}catch(error){for(const adapter of this.external)adapter.cancelCapture?.();throw error;}
  this.peopleBaseline=peopleBaseline;this.vesselSnapshots=vesselSnapshots;
 }
 reset(){if(this.app?.deferSimulationChange?.(()=>this.reset()))return;this.stop();this.humanContacts.reset();const A=this.app;this.structures.reset();this.bodies.reset();
  for(const s of this.propSnapshots.values()){const r=s.r;A.props.physics.sleep_prop(r.id);A.props.awake.delete(r.id);r.disasterActive=false;if(r.m){r.m.copy(s.m);restoreSpans(s.spans);r.walker=s.walker.slice();r.rest=0;if(r.box&&r.box!==s.box){r.box.solid=r.box.walkable=false;}r.box=s.box;for(const span of r.spans){span.pos=null;span.nrm=null;}}else{r.broken=s.broken;r.solid=false;}for(const c of s.colliders)restoreCollider(c);A.props.file(r);}
  if(this.vesselSnapshots){const S=this.vesselSnapshots;for(const s of [S.boat,S.ski,S.ship]){s.body.position.copy(s.p);s.body.quaternion.copy(s.q);if(s.v)s.body.velocity.copy(s.v);if(s.angular)s.body.angular.copy(s.angular);if(s.moored!==undefined)s.body.moored=s.moored;}Object.assign(A.ferry.ship,S.shipState);A.ferry.ship.environmentHeave=0;A.ferry.ship.environmentVelocity=0;A.ferry.ship.environmentPitch=0;A.ferry.ship.environmentRoll=0;A.ferry.ship.pose();
   for(const s of S.skis){s.s.position.copy(s.p);s.s.quaternion.copy(s.q);s.s.disasterVelocity?.set(0,0,0);}
   A.rally.physics.restore_disaster_car(new Float32Array(S.car));A.rally.syncModel(0);A.rally.damage.restoreDisasterState(S.damage);
   A.player.position.copy(S.player.p);A.player.velocity.copy(S.player.v);A.player.mode=S.player.mode;A.player.yaw=S.player.yaw;A.player.pitch=S.player.pitch;A.player.restoreWaterState?.(S.player.waterState);
  }
  for(const [person,s]of this.changedPeople){if(person.knock?.rag)A.people.contact.tumbles.end(person,person.knock.rag);person.knock=null;if(s.off)person.off?.copy(s.off);else person.off?.set(0,0,0);if(s.world)person.world?.copy(s.world);if(s.base)person.base?.copy(s.base);person._bp?.copy(person.base??person.world);person.environmentAcceleration={x:0,y:0,z:0};Object.assign(person,{path:s.path?.map(p=>p.clone?.()??(Array.isArray(p)?p.slice():p))??null,s:s.s,mode:s.mode,posture:s.posture,pace:s.pace,then:s.then,beat:s.beat,gesture:s.gesture});A.people.contact.wet.delete(person);}this.changedPeople.clear();A.people.evacuation?.reset();for(const adapter of this.external)adapter.reset?.();this.app.aviation?.resetDisasterEffects?.();this.app.sharks?.reset?.();
  // Reacquire support after the carrier/ferry and walker have both been restored.
  A.player.refreshGroundSupport?.();
  A.rally.refreshIslandColliders();this.field.reset();this.peakForce=this.rawPeakForce=this.limited=0;this.touched.clear();this.restored=true;this.vesselSnapshots=null;this.peopleBaseline=null;this.app.cameraCut();this.refresh();
 }
 view(config){const A=this.app;if(A.setFreeCam(true)===false)return 'Exit the chairlift at a terminal before changing view.';const target=p.set(config.x,A.terrainData.heightAt(config.x,config.z)+3,config.z).clone();const eye=target.clone().add(new Vector3(-38,38,62));A.camera.position.copy(eye);A.camera.lookAt(target);const e=new Euler().setFromQuaternion(A.camera.quaternion,'YXZ');A.fly.setPose(eye,e.y,e.x);A.fly.velocity.set(0,0,0);A.cameraCut();}
 craft(body,F,T,area,dt){
  const s=this.field.sample(body.position.x,body.position.y,body.position.z);
  // Hull controllers own aerodynamic resistance, panel pressure and buoyancy. Their
  // velocity inputs are fluid-relative; adding another drag force here would double it.
  if(body.beached&&this.field.events.has('earthquake')){F.x+=s.ax*body.mass;F.y+=s.ay*body.mass;F.z+=s.az*body.mass;}
  const demand=.5*1.225*area*((s.wx-body.velocity.x)**2+(s.wz-body.velocity.z)**2)+.5*1025*area*((s.ux-body.velocity.x)**2+(s.uz-body.velocity.z)**2);
  if(!this.restored)this.rawPeakForce=Math.max(this.rawPeakForce,demand);if(body.moored&&demand>18000)body.moored=false;
 }
 before(dt){if(this.paused)return;this.frameDt=dt;const t=performance.now();this.field.advance(dt);this.waterMs=this.waterMs*.9+(performance.now()-t)*.1;this.water.update(this.field);this.app.ferry.ship.environment=this.field;
  this.siren.update(this.field.events.get('tsunami'),false);if(!this.field.events.size){this.loads(dt);this.people(dt);this.parkedSkis(dt);this.updateVisuals(dt);return;}
  for(const adapter of this.external)adapter.before?.(dt,this.field);this.structures.update(dt);this.bodies.update(dt);this.wakeProps();this.loads(dt);this.people(dt);this.parkedSkis(dt);this.updateVisuals(dt);
 }
 wakeProps(){const props=this.app.props;for(const r of PROPS.all){if(r.group&&!r.group.broken)continue;const o=r.position;if(!o)continue;const s=this.field.sample(o.x,o.y,o.z),ground=this.field.terrain(o.x,o.z),wet=s.height>ground+.05,wind=Math.hypot(s.wx,s.wy,s.wz);if(s.shake<.45&&wind<14&&!wet)continue;
   if(r.panel){if(!r.broken&&s.shake+wind*.15+(wet?8:0)>3)props.breakPanel(r);continue;}if(props.awake.size>=MAX_AWAKE&&!props.awake.has(r.id))continue;r.disasterActive=true;if(!props.awake.has(r.id))props.wake(r);
  }}
 // One options object per body, reused every frame. The old path spread each body record twice a frame
 // ({...record,supported} then {...opts,dt}); with 305 bodies awake at t 4 s of the default tornado that
 // and the literals in loads cost 79 scavenges per 1500 frames (test/disaster-bookkeeping-alloc.mjs).
 // Every options object has the one shape loadOptions makes, so the stores below stay monomorphic and
 // write numbers in place (prototype-linked wrappers, one map per body, boxed every dt: 15 scavenges).
 // They copy the live record each frame: the fields Field.acceleration reads plus the two load hooks.
 bodyOptions(id){
  const supported=this.supported?.has(id)??false;
  if(id===-1){const o=this.carOptions??=loadOptions();o.mass=this.app.rally.profile.mass;o.area=0;o.volume=2;o.height=1.6;o.buoyancy=false;o.supported=this.app.rally.state?.[10]>0;return o;}
  const r=this.structures.bodies.get(id)||this.bodies.bodies.get(id);
  if(r){const map=this.recordOptions??=new WeakMap();let o=map.get(r);if(!o){o=loadOptions();map.set(r,o);}return copyLoadOptions(o,r,supported);}
  const prop=PROPS.all[id];if(!prop||prop.panel)return null;
  const cache=this.propOptions??=[];let o=cache[id];
  if(!o){o=cache[id]=loadOptions();if(!prop.physical){const h=prop.local.half,volume=8*h.x*h.y*h.z,density=prop.type==='barrel'?590:prop.type==='trap'?70:prop.type==='fence'?90:170;o.fixed={mass:Math.max(.5,volume*density),area:4*h.y*Math.max(h.x,h.z),volume,height:2*h.y};}}
  return copyLoadOptions(o,prop.physical??o.fixed,supported);
 }
 loads(dt){
  const physics=this.app.rally.physics,ids=physics.disaster_supported(),supported=this.supported??=new Set();
  supported.clear();for(let i=0;i<ids.length;i++)supported.add(ids[i]);
  const motion=physics.disaster_motion(),sample=this.loadSample??={},context=this.loadContext??={position:p,velocity:v,dt:0,supported:false};
  // Seven floats per body, like the motion list, so its length bounds the loads. Grow with headroom, never per frame.
  if(!this.loadBuffer||this.loadBuffer.length<motion.length)this.loadBuffer=new Float32Array(Math.max(7*64,motion.length*2));
  const loads=this.loadBuffer;let n=0;
  for(let i=0;i<motion.length;i+=7){
   const id=motion[i],opts=this.bodyOptions(id);if(!opts)continue;p.fromArray(motion,i+1);v.fromArray(motion,i+4);opts.dt=dt;
   const s=this.field.acceleration(p,v,opts,sample);if(id===-1)physics.set_fluid_velocity?.(s.wx,s.wy,s.wz,s.ux,s.uz);
   // Resolved load points use the body's current orientation and point velocity.
   // A centre-of-mass-only force has no invented world-up torque arm.
   context.dt=dt;context.supported=opts.supported;
   const environmental=opts.environmentLoad?.(context);
   let fx=environmental?.fx??s.ax*opts.mass,fy=environmental?.fy??s.ay*opts.mass,fz=environmental?.fz??s.az*opts.mass;
   let tx=environmental?.tx??0,ty=environmental?.ty??0,tz=environmental?.tz??0;
   if(environmental){s.rawDragForce=Math.max(s.rawDragForce||0,environmental.rawDragForce||0);s.rawAcceleration=Math.max(s.rawAcceleration||0,environmental.rawAcceleration||0);s.limited=s.limited||environmental.limited;}
   // Optional supported locomotion is a physical force, never a pose/velocity write.
   // Validate and bound the combined environmental plus motor load before the bridge.
   if(opts.controlLoad&&opts.supported){context.supported=true;const c=opts.controlLoad(context)??NO_LOAD,cx=c.fx??0,cy=c.fy??0,cz=c.fz??0,cu=c.tx??0,cv=c.ty??0,cw=c.tz??0;
    if(Number.isFinite(cx)&&Number.isFinite(cy)&&Number.isFinite(cz)&&Number.isFinite(cu)&&Number.isFinite(cv)&&Number.isFinite(cw)){fx+=cx;fy+=cy;fz+=cz;tx+=cu;ty+=cv;tz+=cw;}else this.limited++;
   }else if(opts.controlLoad){context.supported=false;opts.controlLoad(context);}
   if(!(Number.isFinite(fx)&&Number.isFinite(fy)&&Number.isFinite(fz)&&Number.isFinite(tx)&&Number.isFinite(ty)&&Number.isFinite(tz))){this.limited++;continue;}
   const requested=Math.hypot(fx,fy,fz),cap=Math.min(1,2e6/Math.max(requested,1)),torqueCap=Math.min(1,2e6/Math.max(1,Math.hypot(tx,ty,tz)));
   fx*=cap;fy*=cap;fz*=cap;tx*=torqueCap;ty*=torqueCap;tz*=torqueCap;
   loads[n]=id;loads[n+1]=fx;loads[n+2]=fy;loads[n+3]=fz;loads[n+4]=tx;loads[n+5]=ty;loads[n+6]=tz;n+=7;
   if(!this.restored){this.peakForce=Math.max(this.peakForce,Math.hypot(fx,fy,fz));this.rawPeakForce=Math.max(this.rawPeakForce,s.rawDragForce,s.rawAcceleration*opts.mass,requested);if(s.limited||cap<1||torqueCap<1)this.limited++;if(v.length()>.25)this.touched.add(id);}
  }physics.set_disaster_loads(loads.subarray(0,n));
 }

 personSnapshot(person){return {off:person.off?.clone(),world:person.world?.clone(),base:person.base?.clone(),path:person.path?.map(p=>p.clone?.()??(Array.isArray(p)?p.slice():p)),s:person.s,mode:person.mode,posture:person.posture,pace:person.pace,then:person.then,beat:person.beat,gesture:person.gesture};}
 rememberPerson(person){if(!this.changedPeople.has(person))this.changedPeople.set(person,this.peopleBaseline?.get(person)??this.personSnapshot(person));}
 people(dt){const A=this.app;
  for(const person of A.people.list){const at=person.world;if(!at||!person.model)continue;
   const rd=person.knock?.rag?.rd;if(rd && rd.phase !== 'idle'){rd.waterY=this.field.waterAt(rd.focus.x,rd.focus.z);rd.disasterField=this.field;person.environmentAcceleration={x:0,y:0,z:0};continue;}
   const mass=person.brain?.type==='kid'?35:72,height=person.brain?.type==='kid'?1.25:1.7,area=.7*(height/1.7)**2;
   const velocity=person.knock?.sw?.velocity??person.evacuation?.velocity??person._bv??{x:0,y:0,z:0};
   const floor=A.player.groundAt(at.x,at.z,at.y+.2),supported=person.evacuation?.grounded??(Math.abs(at.y-floor)<.1);
   p.copy(at);p.y+=height*.5;const s=this.field.acceleration(p,velocity,{mass,area,volume:mass/1000,height,supported:supported&&!person.local,dt},{});
   person.environmentAcceleration={x:s.ax,y:s.ay,z:s.az};
   person.disasterLoad={mass,height,water:s.height,depth:Math.max(0,s.height-at.y),current:Math.hypot(s.ux,s.uz),acceleration:[s.ax,s.ay,s.az],supported};
   // Assumed stance: lateral tipping threshold 3.2 m/s². Calm hydrostatic support
   // never counts as a knock. Deep moving/rising flood or strong updraft does.
   // s is relative to the person's own velocity, so in calm sea it is their own wading
   // drag (1.4 m/s at 0.8 m read 4.4 m/s² and tipped every wader). Tip on the push the
   // same body feels at rest: calm water and still air give 0, a current still tips.
   tipBody.mass=mass;
   tipBody.area=area;
   tipBody.volume=mass/1000;
   tipBody.height=height;
   tipBody.supported=supported&&!person.local;
   tipBody.dt=dt;
   const still=this.field.acceleration(p,atRest,tipBody,push);
   const tipping=supported&&Math.hypot(still.ax,still.az)>TIP_PUSH,updraft=s.wy>18,flood=s.height-at.y>.9&&(Math.hypot(s.ux,s.uz)>.6||s.height>.25);
   if((!person.knock || person.knock.sw)&&(tipping||updraft||flood)&&A.people.t>(person.bumpUntil||0)){this.rememberPerson(person);A.people.contact.environment(person,velocity);}
  }
  const pl=A.player;pl.environment=this.field;if(pl.mode==='ragdoll'){pl.rag.disasterField=this.field;pl.rag.waterY=this.field.waterAt(pl.rag.focus.x,pl.rag.focus.z);}
  // Player.updateWalk owns its motor, shared field force and physical handoff.
 }
 parkedSkis(dt){for(const ski of this.app.jetskis.skis){if(ski===this.app.jetskis.live)continue;const velocity=ski.disasterVelocity??=new Vector3(),s=this.field.acceleration(ski.position,velocity,{mass:310,area:1.6,height:.7,buoyancy:false,supported:false,dt},{});velocity.x+=s.ax*dt;velocity.z+=s.az*dt;velocity.multiplyScalar(Math.exp(-.4*dt));ski.position.x+=velocity.x*dt;ski.position.z+=velocity.z*dt;}}
 after(){if(!this.paused&&!this.restored)this.humanContacts.update(this.frameDt);const poses=this.app.rally.physics.prop_poses();this.structures.sync(poses);this.bodies.sync(poses);for(const adapter of this.external)adapter.after?.();if(!this.paused)this.refresh(false);}
 // The pose list is 7 numbers per awake body printed at 4 decimals, 10 times a second (305 bodies at t 4 s of the
 // default tornado). Only the open Disasters panel shows it, so a closed panel skips it (test/disaster-panel-cost.mjs).
 refresh(force=true){const panelOpen=!!this.ui?.panel&&!this.ui.panel.hidden;const now=performance.now();if(!force&&now<(this.nextMetricsAt??0))return;this.nextMetricsAt=now+100;this.siren.update(this.field.events.get('tsunami'),this.paused);const config=this.ui?.config()??{x:40,z:-115},s=this.field.sample(config.x,this.field.terrain(config.x,config.z),config.z),grid=this.field.water;const bodyCount=this.app.rally.physics.prop_count();const utilization=Math.max(0,...this.structures.records.filter(r=>!r.broken).map(r=>r.utilization));
  this.ui?.update({active:[...this.field.events.keys()].join(',')||'none',paused:String(this.paused),time:fixed(this.field.time),pose:panelOpen?Array.from(this.app.rally.physics.disaster_motion()).map(x=>x.toFixed(4)).join(','):'','peak-force':Math.round(this.peakForce),'raw-force':Math.round(this.rawPeakForce),moved:this.touched.size,destroyed:this.structures.records.filter(r=>r.broken).length+this.bodies.fallenCount+PROPS.all.filter(r=>r.panel&&r.broken).length,restored:String(this.restored),water:fixed(s.height),current:fixed(Math.hypot(s.ux,s.uz)),wind:fixed(Math.hypot(s.wx,s.wy,s.wz)),pressure:Math.round(dynamicPressure(Math.hypot(s.wx,s.wy,s.wz))),utilization:fixed(utilization),bodies:bodyCount,limited:this.limited,deferred:this.structures.deferred+this.bodies.deferred,'water-ms':fixed(this.waterMs),cfl:fixed(grid?.stats.cfl??0),'wind-work':fixed((grid?.stats.windWork??0)/1000),'water-dropped':fixed(grid?.stats.droppedTime??0),'water-error':grid?fixed(grid.volume()-grid.initialVolume-grid.stats.massAdded+grid.stats.boundaryVolume-grid.stats.positivityCorrection):'0.00'});
 }
 visuals(){this.tornadoVisuals=new TornadoVisuals(this.app,this.field);this.funnel=this.tornadoVisuals.group;}
 updateVisuals(dt){this.tornadoVisuals.update(dt);}
}
