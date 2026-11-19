// Keep expensive disaster frames from feeding a larger catch-up interval into
// the next frame. This changes playback speed, never physics detail or solver
// budgets. Every subsystem receives the same accepted simulation interval.

// Rendering and physics consume the same simulation time during a disaster.
export const DISASTER_MAX_STEP=3/120; // s
// Fixed physics steps one advance may run (rally-physics set_max_steps). Outside a disaster the
// car keeps the old 0.1 s catch-up: with the 3-step cap always on, a car driven at 30 fps ran
// 3 of the 4 steps it owed, at 75% speed (test/simulation-pacing.mjs, rally-physics tests.rs).
export const DISASTER_PHYSICS_STEPS=3;
export const CATCH_UP_PHYSICS_STEPS=12;

export class SimulationPacing {
 constructor({mode,storage}={}){
  try{this.storage=storage===undefined?globalThis.localStorage:storage;}catch{this.storage=null;}
  if(!mode){try{mode=this.storage?.getItem('tidewater.playback');}catch{}}
  this.mode=mode==='smooth'?'smooth':'realtime';this.reset();
 }
 reset(){this.maxStep=DISASTER_MAX_STEP;this.cost=0;this.rate=1;this.wall=0;this.simulated=0;this.active=false;}
 setMode(mode){if(!['smooth','realtime'].includes(mode))throw new RangeError('Unknown simulation playback mode');this.mode=mode;this.reset();try{this.storage?.setItem('tidewater.playback',mode);}catch{}}
 step(dt,active){
  this.active=active;
  if(!Number.isFinite(dt)||dt<=0)return 0;
  if(!active){this.maxStep=DISASTER_MAX_STEP;this.cost=0;return dt;}
  // Both modes: the physics cannot simulate more than this per frame, so nothing else may.
  return Math.min(dt,this.maxStep);
 }
 // The step cap the car physics gets this frame; read after step().
 get physicsSteps(){return this.active?DISASTER_PHYSICS_STEPS:CATCH_UP_PHYSICS_STEPS;}
 observe(ms,accepted,wall){
  if(!Number.isFinite(ms+accepted+wall)||wall<=0)return;
  this.wall+=wall;this.simulated+=accepted;
  if(this.wall>=.5){this.rate=this.simulated/this.wall;this.wall=this.simulated=0;}
  if(!this.active)return;
  this.cost=this.cost?this.cost*.85+ms*.15:ms;
  if(this.mode!=='smooth')return;
  // A fixed upper interval prevents the catch-up feedback loop. Do not keep
  // shrinking time to chase an unattainable frame rate: rendering and broad
  // phase work have a fixed cost even at a vanishing simulation interval.
 }
}
