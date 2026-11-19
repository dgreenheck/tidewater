import {Vector3,Quaternion} from '../engine/math/index.js';
import {loadModel} from '../rally/VehicleModel.js';
import {CarrierPhysics} from './CarrierPhysics.js';
import {CarrierDeck,PARKED_FIGHTERS} from './CarrierDeck.js';
import {localAircraftExit,entryRescue} from './OnFootExit.js';
import {FlightPhysics,NOSE_STRUT} from './FlightPhysics.js';
import {AviationPanel} from './AviationPanel.js';
import {CARRIER,STEP} from './Constants.js';
import {add,sub,mul,dot,cross,unit,rotate,clamp,length} from './Math.js';

export const FIGHTER_KEYS=Object.freeze({
 leave:'KeyE',
 throttleUp:['KeyW','Equal','NumpadAdd'],
 throttleDown:['KeyS','Minus','NumpadSubtract'],
 pitchUp:'ArrowDown',
 pitchDown:'ArrowUp',
 rollLeft:'ArrowLeft',
 rollRight:'ArrowRight',
 yawLeft:'KeyA',
 yawRight:'KeyD',
 gear:'KeyG',
 hook:'KeyH',
 flaps:'KeyV',
 brake:'KeyB',
 holdBrake:'Space',
 camera:'KeyC',
 reset:'KeyR'});
const THROTTLE_RATE=0.5; // per s: W or S runs the throttle end to end in 2 s
const ENTRY_RADIUS=9; // m: walk-up E prompt range around the jet's centre
const CHASE_DISTANCE=20; // m behind along the smoothed flight path
const CHASE_HEIGHT=4; // m above, in the camera's own up
const CHASE_LEAD=30; // m ahead: the look-at point
const CHASE_FOLLOW=4; // 1/s: how fast the view direction follows the flight path
const CHASE_ROLL=2.5; // 1/s: how fast the view rolls with the jet
const CHASE_MIN_SPEED=25; // m/s: below this (on the deck) the view follows the nose
// On the catapult a 4 m-high view sat behind the raised blast deflector, which hid the
// lower half of the jet (capture ready-on-catapult.png, 2026-10-05). The view starts
// 5 m higher at rest and settles to CHASE_HEIGHT by 40 m/s, so it never snaps.
const CHASE_DECK_LIFT=5; // m
const CHASE_LIFT_SPEED=40; // m/s
function held(input,keys){
 if(typeof keys==='string')return input.down(keys);
 for(const key of keys)if(input.down(key))return true;
 return false;
}
// Rodrigues rotation of v about the unit axis k by angle (rad).
function aboutAxis(v,k,angle){
 if(!angle)return v;
 const c=Math.cos(angle),s=Math.sin(angle);
 return add(add(mul(v,c),mul(cross(k,v),s)),mul(k,dot(k,v)*(1-c)));
}

// App adapter only. Force calculation and fixed-step integration are independent
// of rendering and DOM, exercised through FlightPhysics and CarrierPhysics.
export class Aviation{
 constructor(app){
  this.app=app;this.carrier=new CarrierPhysics();this.flight=new FlightPhysics(this.carrier);this.deckSupport=new CarrierDeck(this.carrier,this.flight);this.app.player?.groundProviders?.add(this.deckSupport);this.active=false;this.pilot=false;this.camMode='chase';this.camReady=false;this.inspectYaw=-.75;this.inspectPitch=.37;this.inspectView='carrier';this.modelParts=0;this.waterSlot=-1;this.time=0;this.savedPlayer=null;this.waterImpactSeen=null;this.lastError=null;this.accumulator=0;this.discardedTime=0;this.disasterSnapshot=null;
  this.carrierEnv={sample:(x,y,z)=>this.sample(x,y,z),waterAt:(x,z,i)=>this.waterHeight(x,z,i)};
  this.flightEnv={sample:(x,y,z)=>this.sample(x,y,z),waterAt:(x,z)=>this.waterHeight(x,z,10),terrainAt:(x,z)=>this.app.terrainData.heightAt(x,z)};
 }
 async init(){
  const base=import.meta.env.BASE_URL||'/';
  // Do not silently substitute boxes if an authored model is missing: loading
  // failure is actionable and the rest of the island may continue through App.
  const [carrier,jet]=await Promise.all([loadModel(`${base}aviation/carrier.glb`),loadModel(`${base}aviation/fighter.glb`)]);
  this.carrierModel=carrier;this.jetModel=jet;this.modelParts=carrier.parts+jet.parts;carrier.root.name='Tidewater carrier';jet.root.name='Kestrel fighter';this.app.scene.add(carrier.root);this.app.scene.add(jet.root);
  this.basePivots=new Map();for(const[name,node]of jet.pivots)this.basePivots.set(name,{q:node.quaternion.clone(),p:node.position.clone()});
  this.parked=[];
  for(const [x,z,yaw]of PARKED_FIGHTERS){
   const copy=jet.root.clone();copy.position.set(x,CARRIER.deckY+1.92,z);copy.rotation.y=yaw;carrier.root.add(copy);this.parked.push(copy);
  }
  // One query per hydrostatic station plus the aircraft. Slots are reserved once;
  // query shortage uses the shared analytical/grid surface, never another owner.
  try{this.waterSlot=this.app.query.allocate('aviationWater',11);}catch(error){this.waterSlot=-1;this.lastError=error.message;}
  this.unregisterDisaster=this.app.disasters?.registerExternal?.({before:()=>this.captureDisasterState()});
  this.app.player.groundProviders?.add(this.deckSupport);this.panel=new AviationPanel(this);this.syncModels();this.queueQueries();this.panel.update(0);
 }
 sample(x,y,z){return this.app.disasters?.field?.sample(x,y,z)||{wx:0,wy:0,wz:0,ux:0,uz:0,height:0};}
 waterHeight(x,z,station=10){
  const q=this.app.query;
  if(this.waterSlot>=0&&q.cpuValid){const h=q.cpu[(this.waterSlot+station)*4];if(Number.isFinite(h))return h;}
  // GPU WaterQuery already includes disaster height. Never add it a second time.
  return this.app.disasters?.field?.waterAt(x,z)??0;
 }
 queueQueries(){if(this.waterSlot<0)return;const q=this.app.query;
  // one scratch point for the 10 hull samples: world() answered with 8 new arrays per point every frame
  const p=this._hullPoint||(this._hullPoint=[0,0,0]);
  for(let i=0;i<10;i++){this.carrier.world(this.carrier.samples[i],p);q.setPoint(this.waterSlot+i,p[0],p[2]);}
  const f=this.flight,lead=clamp(q.latency||0.05,0,0.15);q.setPoint(this.waterSlot+10,f.position[0]+f.velocity[0]*lead,f.position[2]+f.velocity[2]*lead);
 }
 takeControl(){const app=this.app,p=app.player;if(app.chairlift?.active)return false;if(this.active)return true;
  app.glider?.leave();
  if(app.rally?.active)app.rally.leave();if(app.jetskis?.riding)app.jetskis.dismount();
  // Restore a walking/swimming state on exit; vehicle ownership is relinquished.
  this.savedPlayer={position:p.position.clone(),velocity:p.velocity.clone(),mode:p.mode,yaw:p.yaw,pitch:p.pitch};
  if(app.freeCam)app.setFreeCam(false);app.freeCam=false;p.mode='aviation';p.velocity.set(0,0,0);p.prompt=null;
  this.active=true;this.camReady=false;app.input.keys.clear();app.input.pressed.clear();app.input.consumeLook();app.cameraCut();return true;
 }
 visit(view=this.inspectView){if(!this.takeControl())return false;this.pilot=false;this.camReady=false;this.camMode='chase';this.inspectView=['carrier','deck','bridge','fighter'].includes(view)?view:'carrier';this.inspectYaw=this.inspectView==='bridge'?-.9:-.75;this.inspectPitch=this.inspectView==='deck'?.62:this.inspectView==='bridge'?.18:.37;this.app.cameraCut();}
 enter(){if(!this.takeControl())return false;this.pilot=true;this.camReady=false;this.app.player.mode='aviation';this.app.cameraCut();this.panel?.syncControls();}
 offer(player){
  if(this.active||!this.jetModel||this.app.chairlift?.active||this.flight.phase==='crashed'||this.flight.phase==='ditched')return null;
  const p=player.position,f=this.flight.position,dx=p.x-f[0],dz=p.z-f[2];
  if(dx*dx+dz*dz>ENTRY_RADIUS*ENTRY_RADIUS||Math.abs(p.y-f[1])>4)return null;
  this.entryOffer||={text:'Fly the jet',act:()=>this.enter()};
  return this.entryOffer;
 }
 approach(){if(!this.takeControl())return false;this.flight.startApproach(this.flightEnv);this.pilot=true;this.camReady=false;this.camMode='chase';this.app.cameraCut();this.panel?.syncControls();}
 reset(){this.flight.reset();this.waterImpactSeen=null;this.camReady=false;this.app.cameraCut();this.panel?.syncControls();this.syncModels();}
 captureDisasterState(){
  if(this.disasterSnapshot)return;
  const flight=Object.fromEntries(Object.entries(this.flight).filter(([key])=>key!=='carrier'));
  this.disasterSnapshot={carrier:structuredClone({...this.carrier}),flight:structuredClone(flight),active:this.active,pilot:this.pilot,camMode:this.camMode,savedPlayer:this.savedPlayer,inspection:{view:this.inspectView,yaw:this.inspectYaw,pitch:this.inspectPitch,chaseYaw:this.chaseYaw}};
 }
 resetDisasterEffects(){
  const state=this.disasterSnapshot;
  if(state){Object.assign(this.carrier,state.carrier);Object.assign(this.flight,state.flight);this.active=state.active;this.pilot=state.pilot;this.camMode=state.camMode;this.savedPlayer=state.savedPlayer;if(state.inspection){this.inspectView=state.inspection.view;this.inspectYaw=state.inspection.yaw;this.inspectPitch=state.inspection.pitch;this.chaseYaw=state.inspection.chaseYaw;}this.disasterSnapshot=null;}
  else this.carrier.resetEffects();
  // The disaster service restores its player snapshot before this owner. Assert
  // the controller mode from our captured state, even after repeated events.
  if(this.active&&this.app.player){const p=this.app.player;p.mode='aviation';p.position.fromArray(this.pilot?this.flight.position:this.carrier.world([0,18,0]));p.velocity.set(0,0,0);p.prompt=null;this.app.freeCam=false;this.app.input?.keys?.clear();this.app.input?.pressed?.clear();}
  this.app.cameraCut?.();
  this.accumulator=0;this.flight.accumulator=0;this.waterImpactSeen=null;this.camReady=false;this.syncModels();this.panel?.syncControls();this.panel?.update(0);
 }
 leave(){
  if(!this.active)return;const app=this.app,p=app.player;
  const local=this.pilot&&['ready','arrested','touchdown','crashed','ditched'].includes(this.flight.phase)?localAircraftExit(app,this.flight,{sideOffset:4,provider:this.deckSupport,waterAt:(x,z)=>this.waterHeight(x,z)}):null;
  const destination=local||entryRescue(app,this.savedPlayer);this.lastExit=local?'local':'rescue';this.active=false;this.pilot=false;
  p.resumeOnFoot(destination);this.savedPlayer=null;
  this.flight.controls.throttle=0;this.flight.controls.brake=true;app.camera.up.set(0,1,0);app.input.keys.clear();app.input.pressed.clear();app.input.consumeLook();this.camReady=false;this.panel?.update(0);app.cameraCut();
 }
 walkDeck(){
  if(this.app.chairlift?.active)return false;
  const app=this.app;app.glider?.leave();if(app.rally?.active)app.rally.leave();if(app.jetskis?.riding)app.jetskis.dismount();if(app.freeCam)app.setFreeCam(false);
  this.active=false;this.pilot=false;this.savedPlayer=null;// 12 m to port of the jet on the catapult, facing it, so the walk-up E prompt is a
  // few steps away (was mid-deck at x -17, z 0, facing the bow).
  const position=this.carrier.world([-4,CARRIER.deckY,24]);
  app.player.resumeOnFoot({position,velocity:this.deckSupport.velocityAt(position),yaw:this.carrier.heading-Math.PI/2,pitch:0,waterHeight:this.waterHeight(position[0],position[2]),grounded:true,provider:this.deckSupport});
  app.input.keys.clear();app.input.pressed.clear();app.input.consumeLook();this.panel?.update(0);app.cameraCut();
 }

 toggleCamera(){this.camMode=this.camMode==='cockpit'?'chase':'cockpit';this.camReady=false;this.app.cameraCut();this.panel?.syncControls();}
 controls(dt){
  const i=this.app.input,f=this.flight,c=f.controls,K=FIGHTER_KEYS;
  if(this.active&&i.hit(K.leave)){
   this.leave();
   return;
  }
  if(!this.pilot)return;
  // WorldTools isolates focused form inputs. Releasing control clears stale keys.
  c.pitch=(i.down(K.pitchUp)?1:0)-(i.down(K.pitchDown)?1:0);
  // Match the Y-up chase camera: a +Z-facing model's +X is screen left.
  c.roll=(i.down(K.rollLeft)?1:0)-(i.down(K.rollRight)?1:0);
  c.yaw=(i.down(K.yawLeft)?1:0)-(i.down(K.yawRight)?1:0);
  const up=held(i,K.throttleUp),down=held(i,K.throttleDown);
  if(f.phase==='ready'){
   // One key launches: W on the catapult runs the whole launch; S cancels it while
   // the engine spools (FlightPhysics.autoLaunch).
   if(up&&!f.auto)this.launchError=f.autoLaunch();
   if(down)f.abortLaunch();
  }else if(!f.auto?.attitude){
   if(up)c.throttle=clamp(c.throttle+dt*THROTTLE_RATE,0,1);
   if(down)c.throttle=clamp(c.throttle-dt*THROTTLE_RATE,0,1);
  }
  const gear=i.hit(K.gear),hook=i.hit(K.hook),flaps=i.hit(K.flaps),brake=i.hit(K.brake);
  // Taking the gear or flaps by hand ends the launch housekeeping for them.
  if(gear){
   c.gear=!c.gear;
   if(f.auto)f.auto.gearDone=true;
  }
  if(hook)c.hook=!c.hook;
  if(flaps){
   c.flaps=c.flaps<.3?.6:c.flaps<.9?1:0;
   if(f.auto)f.auto.flapsDone=true;
  }
  if(brake)c.brake=!c.brake;
  if(i.down(K.holdBrake)){
   if(this.brakeSaved===undefined)this.brakeSaved=c.brake;
   c.brake=true;
  }else if(this.brakeSaved!==undefined){
   c.brake=this.brakeSaved;
   this.brakeSaved=undefined;
  }
  if(i.hit(K.reset))this.reset();
  if(i.hit(K.camera))this.toggleCamera();
  if(gear||hook||flaps||brake||up||down)this.panel?.syncControls();
 }
 update(dt){
  if(!this.jetModel)return;
  this.controls(dt);const elapsed=Math.max(0,Number.isFinite(dt)?dt:0),accepted=Math.min(.2,elapsed);this.discardedTime+=elapsed-accepted;this.accumulator+=accepted;
  while(this.accumulator>=STEP){this.carrier.step(STEP,this.carrierEnv);this.flight.step(STEP,this.flightEnv);this.accumulator-=STEP;}
  this.time+=accepted;
  this.syncModels();this.queueQueries();
  if(this.active){this.app.player.position.fromArray(this.pilot?this.flight.position:this.carrier.world([0,18,0]));this.app.player.velocity.set(0,0,0);this.app.player.prompt=null;}
  // This surface displacement is explicitly metres, not impulse N.s. The
  // receiving water service bounds it to 0.25 m and preserves paired volume.
  const hit=this.flight.lastImpact;
  if(hit&&hit!==this.waterImpactSeen){this.waterImpactSeen=hit;this.app.disasters?.field?.water?.addImpulse?.(hit.x,hit.z,12,Math.min(.25,Math.sqrt(hit.energy/1e8)*.25));}
  this.panel?.update(dt);
 }
 syncModels(){if(!this.jetModel)return;const f=this.flight;
  this.carrierModel.root.position.fromArray(this.carrier.position);this.carrierModel.root.quaternion.fromArray(this.carrier.quaternion);this.jetModel.root.position.fromArray(f.position);this.jetModel.root.quaternion.fromArray(f.quaternion);
  const def=(name,axis,angle)=>{const node=this.jetModel.pivots.get(name),base=this.basePivots.get(name);if(node&&base)node.quaternion.copy(base.q).multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis),angle));};
  def('GearNose',[1,0,0],(1-f.gear)*-1.4);
  // The launch nose strut drops the nose leg to sit the jet 6 deg nose-up.
  const nose=this.jetModel.pivots.get('GearNose'),noseBase=this.basePivots.get('GearNose');
  if(nose&&noseBase){nose.position.copy(noseBase.p);nose.position.y-=NOSE_STRUT*f.noseStrut;}
  def('GearLeft',[0,0,1],(1-f.gear)*-1.3);def('GearRight',[0,0,1],(1-f.gear)*1.3);
  def('ArrestorHook',[1,0,0],-.82*f.hook);
  for(const side of ['L','R']){def('Flap'+side,[1,0,0],-.42*f.flaps);def('Elevator'+side,[1,0,0],-.35*f.controls.pitch);def('Rudder'+side,[0,1,0],.35*f.controls.yaw);def('Aileron'+side,[1,0,0],(side==='L'?1:-1)*.32*f.controls.roll);}
  const radar=this.carrierModel.pivots.get('CarrierRadar');if(radar)radar.rotation.y=this.time*.32;
 }
 updateCamera(dt){if(!this.active||!this.jetModel)return;const camera=this.app.camera;let target,desired;
  if(!this.pilot){const look=this.app.input.consumeLook();this.inspectYaw-=look.x*.004;this.inspectPitch=clamp(this.inspectPitch+look.y*.003,.08,1.0);
   const view=this.inspectView,preset={carrier:[[0,12,0],265],deck:[[-4,18,30],85],bridge:[[24,35,0],64],fighter:[[0,.4,1.2],19]}[view]||[[0,12,0],265];
   const frame=view==='fighter'?this.flight:this.carrier,radius=preset[1];target=view==='fighter'?add(frame.position,rotate(frame.quaternion,preset[0])):this.carrier.world(preset[0]);desired=add(target,rotate(frame.quaternion,[Math.sin(this.inspectYaw)*radius,Math.sin(this.inspectPitch)*radius,Math.cos(this.inspectYaw)*radius]));
  }else if(this.camMode==='cockpit'){
   desired=add(this.flight.position,rotate(this.flight.quaternion,[0,1.44,2.9]));target=add(desired,rotate(this.flight.quaternion,[0,0,150]));
  }else{
   const look=this.app.input.consumeLook();this.chaseYaw=clamp((this.chaseYaw||0)-look.x*.003,-1.5,1.5);
   const f=this.flight,speed=length(f.velocity),up=rotate(f.quaternion,[0,1,0]);
   const aim=speed>CHASE_MIN_SPEED?mul(f.velocity,1/speed):rotate(f.quaternion,[0,0,1]);
   if(!this.camReady||!this.chaseDir){
    this.chaseDir=aim;
    this.chaseUp=up;
   }
   const follow=1-Math.exp(-dt*CHASE_FOLLOW),roll=1-Math.exp(-dt*CHASE_ROLL);
   this.chaseDir=unit(add(this.chaseDir,mul(sub(aim,this.chaseDir),follow)));
   const smoothed=add(this.chaseUp,mul(sub(up,this.chaseUp),roll)),square=sub(smoothed,mul(this.chaseDir,dot(smoothed,this.chaseDir)));
   // Keep the previous up if the smoothed one ever lines up with the view direction.
   if(length(square)>1e-3)this.chaseUp=unit(square);
   const back=aboutAxis(this.chaseDir,this.chaseUp,this.chaseYaw||0);
   const height=CHASE_HEIGHT+CHASE_DECK_LIFT*clamp(1-speed/CHASE_LIFT_SPEED,0,1);
   desired=add(f.position,add(mul(back,-CHASE_DISTANCE),mul(this.chaseUp,height)));
   target=add(f.position,mul(back,CHASE_LEAD));
   const ground=this.app.terrainData.heightAt(desired[0],desired[2]);desired[1]=Math.max(desired[1],ground+3,this.waterHeight(desired[0],desired[2])+2);
  }
  const chase=this.pilot&&this.camMode!=='cockpit',v=new Vector3(...desired);
  // The chase view smooths its own direction and roll, so its position is not lerped:
  // a 7/s lerp left the camera about 21 m further back at 150 m/s.
  if(this.camReady&&!chase&&this.camMode!=='cockpit')camera.position.lerp(v,1-Math.exp(-dt*7));else camera.position.copy(v);
  camera.up.set(0,1,0);
  if(this.pilot&&this.camMode==='cockpit')camera.up.fromArray(rotate(this.flight.quaternion,[0,1,0]));
  else if(chase)camera.up.fromArray(this.chaseUp);
  camera.lookAt(new Vector3(...target));this.camReady=true;
 }
}
