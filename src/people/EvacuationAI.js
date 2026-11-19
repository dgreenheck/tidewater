import { Vector3 } from '../engine/index.js';
import { EvacuationWalker } from './EvacuationWalker.js';
import { EvacuationPaths } from './EvacuationPaths.js';
const copyPath=p=>p?.map(v=>v.clone?.()??v.slice?.()??v)??null;
const unable=p=>!!(p.dead||p.health===0||p.knock);

// Behaviour only. The shared disaster model owns wind, current, buoyancy loads,
// falls and ragdolls; this controller supplies voluntary movement, never immunity.
export class EvacuationAI {
 constructor(hub){this.hub=hub;this.app=hub.app;this.walker=new EvacuationWalker(this.app);this.event=null;this.saved=new Map();this.queue=[];this.job=null;this.paths=null;this.scanIn=0;this.routeHazards=[];this.maxPlansPerUpdate=0;this.arrivals=[0,0,0,0];this.warned=0;this.cpuMs=0;this.peakMs=0;}
 get field(){return this.app.disasters?.field;}
 water=(x,z)=>this.field?.waterAt(x,z)??0;
 controlled(p){return !!p.evacuation;}
 register(p){p.evacuationOwner='beach';}
 save(p){if(this.saved.has(p))return;this.saved.set(p,{world:p.world.clone(),base:p.base.clone(),based:p.based,off:p.off?.clone(),path:copyPath(p.path),pace:p.pace,mode:p.mode,heading:p.heading,face:p.face,posture:p.posture,beat:p.beat,then:p.then,activity:p.brain.activity,gesture:p.gesture});}
 warn(p,event){
  if(!p.world||p.dead||p.health===0)return;
  if(p.warningEvent===event)return;p.warningEvent=event;this.warned++;
  p.brain.gesture=null;p.brain.target=null;p.brain.lookUntil=0;
  if(p.evacuationOwner!=='beach'){this.hub.say(p,event.kind==='tsunami'?'Tsunami warning! Get to higher ground.':'Watch out! Disaster nearby.','disaster-warning',true);return;}
  this.save(p);
  // Ordinary treading stores sea level in world.y but draws feet underwater.
  // Start physics at those visible feet before changing to the standing mode.
  if(p.mode==='tread'){p.world.y=p.group?.position.y??this.water(p.world.x,p.world.z)-1.38;p.base.copy(p.world);}
  const old=p.evacuation,slot=this.app.beach?.people.indexOf(p)??0;
  p.evacuation={phase:'warning',reason:null,kind:event.kind,velocity:old?.velocity??new Vector3(),grounded:true,routeContacts:old?.routeContacts??0,collisions:0,moving:false,swimming:p.role==='swim',readyAt:this.hub.t+.3+(p.id%7)*.09,lane:((slot%4)-1.5)*.75,slot,plan:null,index:0,nextSense:0,stuck:0,last:p.world.clone(),wasKnocked:!!p.knock};
  p.path=null;p.then=null;p.beat=null;p.gesture=null;p.brain.activity=null;p.mode='stand';
  if(p.bat)p.bat.visible=false;
  this.hub.say(p,event.kind==='tsunami'?'Tsunami warning! Follow the green signs uphill.':event.kind==='tornado'?'Strong wind! Move away from the funnel.':'Earthquake! Keep clear of falling debris.','disaster-warning',true);
 }
 update(dt){
  const start=performance.now(),field=this.field;if(!field)return;
  const event=field.events.get('tsunami')??field.events.get('tornado')??field.events.get('earthquake')??null;
  if(event!==this.event){this.event=event;this.queue.length=0;this.job=null;this.paths=null;this.scanIn=0;this.arrivals=[0,0,0,0];if(!event)this.stop();}
  if(event){
   for(const p of this.hub.list)this.warn(p,event);
   if(!this.paths&&this.app.evacuation?.route)this.paths=new EvacuationPaths(this.walker,this.app.evacuation.route.entry,this.water);
   if((this.scanIn-=dt)<=0){this.scanIn=.5;this.scanRoute();}
   // Each frame has one planning slot, independently of camera distance.
   if(!this.job&&this.queue.length){const p=this.queue.shift();if(p.evacuation&&!unable(p))this.job={p,search:this.paths?.begin(p.world)};}
   if(this.job){const {p,search}=this.job;if(search){this.paths.advance(search);if(search.done){const e=p.evacuation;if(e){e.plan=search.path;e.index=0;e.phase=e.plan?'approach':'blocked';e.reason=e.plan?null:'no-walkable-approach';e.retryAt=this.hub.t+4;}this.job=null;this.maxPlansPerUpdate=Math.max(this.maxPlansPerUpdate,1);}}else this.job=null;}
  }
  const ms=performance.now()-start;this.cpuMs+=(ms-this.cpuMs)*.05;this.peakMs=Math.max(this.peakMs,ms);
 }
 scanRoute(){
  this.routeHazards=[];const E=this.app.evacuation;if(!E)return;
  for(const r of E.records)if(r.broken){const decks=r.colliders.filter(c=>c.tag==='evacuation-deck'||c.tag==='evacuation-refuge');if(decks.length)this.routeHazards.push({z:Math.min(...decks.map(c=>c.center.z)),reason:'broken-route'});}
  for(let i=0;i<E.route.points.length;i+=10){const p=E.route.points[i];if(this.water(p.x,p.z)>p.y+.4)this.routeHazards.push({z:p.z,reason:'flooded-route'});}
  if(this.water(E.refuge.x,E.refuge.z)>E.refuge.y+.4)this.routeHazards.push({z:E.refuge.z,reason:'flooded-route'});
 }
 request(p){if(!this.paths)return;const e=p.evacuation,r=this.app.evacuation?.route;
  if(r&&p.world.z<r.startZ&&Math.abs(p.world.x-r.x)<r.width/2-.25&&Math.abs(this.walker.ground(p.world.x,p.world.z,p.world.y+.1)-p.world.y)<.15&&Math.abs(r.sample(p.world.z).y-p.world.y)<.45){e.phase='climb';e.reason=null;e.goalZ??=r.refuge.z-2+this.arrivals[e.slot%4]++*.65;return;}
  e.phase='planning';e.plan=null;e.reason=null;if(!this.queue.includes(p)&&this.job?.p!==p)this.queue.push(p);}
 stop(){this.queue.length=0;this.job=null;for(const p of this.hub.list)if(p.evacuation){p.evacuation.phase='all-clear';p.evacuation.plan=null;p.evacuation.reason=null;p.evacuation.velocity.set(0,0,0);}}
 reset(){
  for(const [p,s]of this.saved){p.world.copy(s.world);p.base.copy(s.base);p.based=s.based;if(s.off)p.off?.copy(s.off);else p.off?.set(0,0,0);Object.assign(p,{path:copyPath(s.path),pace:s.pace,mode:s.mode,heading:s.heading,face:s.face,posture:s.posture,beat:s.beat,then:s.then,gesture:s.gesture});p.brain.activity=s.activity;p.brain.gesture=null;p.brain.target=null;p._bp?.copy(s.world);p._bv?.set(0,0,0);if(p.bat)p.bat.visible=true;delete p.evacuation;delete p.warningEvent;}
  for(const p of this.hub.list)delete p.warningEvent;
  this.saved.clear();this.event=null;this.paths=null;this.queue.length=0;this.job=null;this.routeHazards=[];this.warned=0;
 }
 step(p,dt){
  const e=p.evacuation;if(!e)return false;
  if(unable(p)){e.phase='incapacitated';e.wasKnocked=true;e.moving=false;e.velocity.set(0,0,0);return true;}
  if(e.wasKnocked){e.wasKnocked=false;if(p.off){p.world.add(p.off);p.base.copy(p.world);p.off.set(0,0,0);}if(!this.event)e.phase='all-clear';else if(e.kind==='tsunami')this.request(p);else e.phase=e.kind==='earthquake'?'brace':'flee';}
  const r=this.app.evacuation?.route;
  let target=null,speed=p.brain.type==='elderly'?3.2:4.4+(p.id%5)*.1;
  if(e.phase==='warning'&&this.hub.t>=e.readyAt){
   if(e.kind==='tsunami'){if(this.water(p.world.x,p.world.z)-this.app.terrainData.heightAt(p.world.x,p.world.z)>1.1&&p.role==='swim')e.phase='shore';else this.request(p);}
   else e.phase=e.kind==='earthquake'?'brace':'flee';
  }
  if(e.phase==='shore'){
   // The inhabited main beach faces +Z. Swimmers move inland until their feet
   // find the actual sand; no instantaneous relocation to a shoreline marker.
   target={x:p.world.x,z:p.world.z-6};
   // Leave the shore phase only after both the actual feet and support are
   // shallow enough for the planner's 0.45 m walking limit, with margin.
   const w=this.water(p.world.x,p.world.z);if(w-Math.min(p.world.y,this.walker.ground(p.world.x,p.world.z,p.world.y+.4))<.35)this.request(p);
  }
  if(e.phase==='flee'){
   const event=this.field?.events.get('tornado'),c=event&&this.field.center(event);if(c){let dx=p.world.x-c.x,dz=p.world.z-c.z,l=Math.hypot(dx,dz)||1;const q=this.walker.navigationPoint(p.world.x+dx/l*4,p.world.z+dz/l*4);if(q&&this.walker.segment(p.world,q,{water:this.water}))target=q;else{e.phase='blocked';e.reason='no-clear-ground';}}
  }
  if(r&&e.kind==='tsunami'&&(e.phase==='approach'||e.phase==='climb'||e.phase==='refuge'||e.phase==='blocked')){
   const hazard=this.routeHazards.find(h=>h.z<p.world.z+.4);
   const flooded=this.water(p.world.x,p.world.z)>p.world.y+.5;
   if(hazard||flooded){e.phase='blocked';e.reason=hazard?.reason??'flooded-route';e.plan=null;}
   if(e.phase==='blocked'&&!hazard&&!flooded&&this.hub.t>(e.retryAt??0)){e.retryAt=this.hub.t+4;this.request(p);}
   if(e.phase==='approach'&&e.plan){
    while(e.index<e.plan.length&&Math.hypot(e.plan[e.index].x-p.world.x,e.plan[e.index].z-p.world.z)<.28)e.index++;
    target=e.plan[e.index]??null;if(!target){e.phase='climb';e.plan=null;e.goalZ=r.refuge.z-2+this.arrivals[e.slot%4]++*.65;}
   }
   if(e.phase==='climb'){
    const onDeck=p.world.z<r.startZ-.5;
    const goalZ=e.goalZ??r.refuge.z;
    target={x:r.x+(onDeck?e.lane:0),z:Math.max(goalZ,p.world.z-4)};
    if(Math.abs(p.world.x-target.x)<.3&&Math.abs(p.world.z-goalZ)<.25&&Math.abs(p.world.y-r.refuge.y)<.15&&e.grounded){e.phase='refuge';e.reason=null;target=null;}
   }
   if(e.phase==='refuge'){
    const R=r.refuge,support=this.walker.ground(p.world.x,p.world.z,p.world.y+.12);
    if(Math.abs(p.world.y-R.y)>.3||Math.abs(support-R.y)>.15||Math.abs(p.world.x-R.x)>R.width/2-.27||Math.abs(p.world.z-R.z)>R.depth/2-.27){e.phase='blocked';e.reason='lost-support';e.retryAt=this.hub.t+1;}
    else{target={x:r.x+e.lane,z:e.goalZ??R.z};speed=1.2;}
   }
   // A fallen person or a slower walker ahead occupies the lane. Nearby people
   // queue; this does not provide mechanical shielding from disaster loads.
   if(target){const dx=target.x-p.world.x,dz=target.z-p.world.z,l=Math.hypot(dx,dz)||1;for(const q of this.app.beach?.people??[]){if(q===p||!q.world||Math.abs(q.world.y-p.world.y)>1.5)continue;const qx=q.world.x-p.world.x,qz=q.world.z-p.world.z,ahead=(qx*dx+qz*dz)/l,side=Math.abs(qx*dz-qz*dx)/l;if(ahead>0&&ahead<.85&&side<.42&&(q.world.z<p.world.z-.05||Math.abs(q.world.z-p.world.z)<.05&&q.id<p.id))speed=Math.min(speed,Math.max(0,(ahead-.5)*6));}}
  }
  this.walker.step(p,target,Math.min(dt,.1),target?speed:0,this.water);
  if(target&&speed>.1&&Math.hypot(target.x-p.world.x,target.z-p.world.z)>.35){const moved=p.world.distanceTo(e.last);e.stuck=moved<.004?e.stuck+dt:0;if(e.stuck>2.5){e.phase='blocked';e.reason='obstructed';e.retryAt=this.hub.t+3;e.stuck=0;}}
  e.last.copy(p.world);
  p.mode='stand';p.gesture=null;p.beat=null;p.brain.gesture=null;p.brain.target=null;
  const clip=p.clipOf?.(e.swimming?'idle':e.moving?'walk':e.phase==='brace'?'crouch':'idle');
  if(clip&&p.model.clipSet.has(clip)){const pace=e.moving&&!e.swimming?Math.max(.4,Math.min(2.5,Math.hypot(e.velocity.x,e.velocity.z)/(p.walk||1.3))):1;const layer=p.model.play(clip,{fade:.25,speed:pace});if(layer)layer.speed=pace;}
  return true;
 }
 state(){const phases={};for(const p of this.hub.list)if(p.evacuation)phases[p.evacuation.phase]=(phases[p.evacuation.phase]??0)+1;return {event:this.event?.kind??null,warned:this.warned,phases,planning:this.queue.length+Number(!!this.job),maxPlansPerUpdate:this.maxPlansPerUpdate,maxExpansionsPerUpdate:this.paths?.stats.maxExpansions??0,expansions:this.paths?.stats.expansions??0,collisionCandidates:this.walker.stats.maxCandidates,cpuMs:+this.cpuMs.toFixed(3),peakMs:+this.peakMs.toFixed(3)};}
}
