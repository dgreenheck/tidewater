import {addWorldTool} from '../ui/WorldTools.js';
import {AIRCRAFT,CARRIER} from './Constants.js';
import {length,sub} from './Math.js';
const DEG=180/Math.PI;
const STYLE=`
/* Layout only. Typography, buttons, inputs, kbd, details and the glass come from the panel
   shell and the tokens in src/ui/ui.css (docs/world-tools.md "Adopting the shell"). */
.av-panel .av-actions{display:grid;grid-template-columns:1fr 1fr;gap:var(--tw-2);margin:var(--tw-3) 0}
.av-panel .av-wide{grid-column:1/-1}
.av-panel select[aria-label="Inspection view"]{width:calc(148 * var(--tw-u))}
.av-panel dl{display:grid;grid-template-columns:auto 1fr;gap:var(--tw-2) var(--tw-3);margin:var(--tw-2) 0}
.av-panel dt{color:var(--tw-ink-3)}
.av-panel dd{margin:0;color:var(--tw-ink-2)}
.av-validation{min-height:calc(16 * var(--tw-u))}
/* In-flight instruments: a glass card right of centre under the strip, four readings and one
   row of seven buttons that each show their key (no action lives only behind a button). */
.av-hud{position:fixed;z-index:108;right:calc(var(--tw-edge) + 64 * var(--tw-u));top:calc(154 * var(--tw-u));width:calc(300 * var(--tw-u));max-width:calc(100vw - 2 * var(--tw-edge));box-sizing:border-box;padding:var(--tw-4);border-radius:var(--tw-r-md);pointer-events:auto}
.av-hud[hidden]{display:none}
.av-hud .av-name{font:600 var(--tw-fs-xs) var(--tw-font);letter-spacing:.15em;color:var(--tw-aqua)}
.av-hud .av-phase{margin:var(--tw-1) 0 var(--tw-2);font:650 calc(17 * var(--tw-u)) / 1.2 var(--tw-font);color:var(--tw-ink)}
.av-hud .av-readings{display:grid;grid-template-columns:1fr 1fr;gap:var(--tw-2) var(--tw-3)}
.av-hud .av-readings b{display:block;font:600 calc(22 * var(--tw-u)) / 1.1 var(--tw-mono);font-variant-numeric:tabular-nums;color:var(--tw-ink)}
.av-hud .av-readings small{color:var(--tw-ink-3);font-size:var(--tw-fs-xs);letter-spacing:.06em}
.av-hud .av-note{margin:var(--tw-2) 0;min-height:calc(16 * var(--tw-u));color:var(--tw-sun);font-size:var(--tw-fs-sm)}
.av-hud .av-buttons{display:grid;grid-template-columns:repeat(7,1fr);gap:var(--tw-1)}
.av-hud .av-buttons button{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;min-height:calc(38 * var(--tw-u));padding:var(--tw-1) 1px;font-size:var(--tw-fs-xs)}
.av-hud .av-buttons button[aria-pressed=true]{background:rgba(var(--tw-aqua-rgb),.18);border-color:rgba(var(--tw-aqua-rgb),.45)}
.av-hud .av-buttons kbd{padding:0 calc(4 * var(--tw-u));color:var(--tw-sun)}
.av-forces{font:var(--tw-fs-sm) / 1.7 var(--tw-mono);white-space:pre-line;color:var(--tw-ink-2)}
.av-hud .av-controls{margin-top:var(--tw-2);color:var(--tw-ink-3);font-size:var(--tw-fs-xs)}
.av-reticle{position:fixed;z-index:107;pointer-events:none;left:50%;top:49%;width:100px;height:60px;transform:translate(-50%,-50%);color:#b6ffd2;text-shadow:0 1px 3px #000}
.av-reticle[hidden]{display:none}
.av-reticle:before{content:'';position:absolute;width:100%;top:50%;border-top:1px solid currentColor}
.av-reticle:after{content:'◇';position:absolute;left:43%;top:25%;font:24px system-ui}
@media(max-width:850px){.av-hud{top:auto;bottom:var(--tw-edge);right:var(--tw-edge);width:calc(250 * var(--tw-u));padding:var(--tw-3)}.av-hud .av-readings b{font-size:calc(18 * var(--tw-u))}}
`;
export class AviationPanel{
 constructor(aviation){
  this.aviation=aviation;this.last=0;const style=document.createElement('style');style.textContent=STYLE;document.head.append(style);
  const panel=this.panel=document.createElement('section');panel.className='av-panel';panel.setAttribute('aria-label','Aviation controls');
  panel.innerHTML=`<header><div><div class="tw-shell-kicker">Tidewater naval aviation</div><h2>Flight deck</h2></div><button class="tw-shell-close" type="button" data-act="close" aria-label="Close aviation controls">Close</button></header><p>Visit the 320 m carrier or fly the unarmed Kestrel deck fighter.</p><div class="av-actions"><button type="button" data-act="visit">Visit carrier</button><button type="button" data-act="enter">Enter fighter</button><button class="av-wide" type="button" data-act="walk">Walk flight deck</button><button class="av-wide" type="button" data-act="approach">Start landing approach</button></div><label>Inspection view <select aria-label="Inspection view"><option value="carrier">Whole carrier</option><option value="deck">Flight deck</option><option value="bridge">Bridge detail</option><option value="fighter">Fighter detail</option></select></label><label>Aircraft throttle <input aria-label="Aircraft throttle" type="number" min="0" max="100" step="1" value="0"></label><label>Flap setting <select aria-label="Flap setting"><option value="0">Retracted</option><option value="0.6" selected>Takeoff</option><option value="1">Landing</option></select></label><p class="av-validation" role="alert" aria-label="Aviation validation"></p><details open><summary>Flying controls</summary><dl><dt><kbd>↓ / S</kbd></dt><dd>Pull nose up</dd><dt><kbd>↑ / W</kbd></dt><dd>Push nose down</dd><dt><kbd>← → / A D</kbd></dt><dd>Bank left / right</dd><dt><kbd>Q / E</kbd></dt><dd>Rudder left / right</dd><dt><kbd>+ / −</kbd></dt><dd>Increase / reduce throttle</dd><dt><kbd>G / V / H</kbd></dt><dd>Gear / flaps / hook</dd><dt><kbd>B / Space</kbd></dt><dd>Toggle / hold wheel brake</dd><dt><kbd>C / R / X</kbd></dt><dd>Camera / reset / leave aircraft</dd></dl></details><details><summary>Launch and recovery</summary><p>For launch: throttle 100%, release the brake, launch, then gently pull up above 60 m/s. Raise the gear after climbing.</p><p>The approach preset starts 620 m behind the stern at 68 m/s. Lower the hook, keep the wings level and follow the dashed landing line. A rough sea or crosswind needs corrections. A hook-up pass is a bolter. Add power and go around.</p></details><details><summary>Physics and limits</summary><p>17,000 kg aircraft, 48 m² wing. Air-relative lift and drag, stall, gravity, bounded control torques, spring landing gear and energy-limited arresting cable. Carrier buoyancy and water-relative drift use the same disaster water field.</p><p>Equations follow <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/" target="_blank" rel="noreferrer">NASA's lift equation</a>. Aircraft coefficients, gear and cable capacities are declared assumptions for a fictional aircraft. This is a real-time approximation, not certified flight or structural prediction.</p></details>`;
  this.tool=addWorldTool(aviation.app,{id:'aviation',label:'Aviation',panel,onOpen:()=>this.syncControls()});
  const hud=this.hud=document.createElement('section');hud.className='av-hud tw-glass tw-shell';hud.hidden=true;hud.setAttribute('role','status');hud.setAttribute('aria-label','Flight instruments');hud.setAttribute('aria-live','off');
  hud.innerHTML=`<div class="av-name">KESTREL 07 · DECK FIGHTER</div><div class="av-phase"></div><div class="av-readings"><div><b data-read="speed">0</b><small>AIRSPEED m/s</small></div><div><b data-read="altitude">0</b><small>ALTITUDE m</small></div><div><b data-read="sink">0</b><small>VERTICAL m/s</small></div><div><b data-read="throttle">0%</b><small>THROTTLE</small></div></div><p class="av-note"></p><div class="av-buttons"><button type="button" data-act="gear" aria-label="Landing gear">Gear<kbd>G</kbd></button><button type="button" data-act="hook" aria-label="Arrestor hook">Hook<kbd>H</kbd></button><button type="button" data-act="flaps" aria-label="Cycle flaps">Flaps<kbd>V</kbd></button><button type="button" data-act="brake" aria-label="Wheel brake">Brake<kbd>B</kbd></button><button type="button" data-act="camera" aria-label="Cockpit view">View<kbd>C</kbd></button><button type="button" data-act="reset" aria-label="Reset aircraft">Reset<kbd>R</kbd></button><button type="button" data-act="leave" aria-label="Leave aviation">Leave<kbd>E</kbd></button></div><details><summary>Inspect forces</summary><div class="av-forces"></div></details><div class="av-controls">W S Throttle · Arrows Fly · A D Rudder</div>`;
  document.body.append(hud);const reticle=this.reticle=document.createElement('div');reticle.className='av-reticle';reticle.hidden=true;reticle.setAttribute('aria-hidden','true');document.body.append(reticle);
  this.throttle=panel.querySelector('input');this.flapInput=panel.querySelector('[aria-label="Flap setting"]');this.inspectionInput=panel.querySelector('[aria-label="Inspection view"]');this.alert=panel.querySelector('[role=alert]');
  this.throttle.addEventListener('input',()=>{const n=Number(this.throttle.value);if(Number.isFinite(n)&&n>=0&&n<=100){aviation.flight.controls.throttle=n/100;this.alert.textContent='';}else this.alert.textContent='Throttle must be between 0 and 100%.';});
  this.inspectionInput.addEventListener('change',()=>aviation.visit(this.inspectionInput.value));
  this.flapInput.addEventListener('change',()=>aviation.flight.controls.flaps=Number(this.flapInput.value));
  for(const root of [panel,hud])root.addEventListener('click',e=>{const button=e.target.closest('[data-act]');if(!button)return;this.act(button.dataset.act);button.blur();});
 }
 act(action){const a=this.aviation,c=a.flight.controls;if(a.app.chairlift?.active&&['visit','walk','enter','approach'].includes(action)){this.alert.textContent='Exit the chairlift at a terminal before changing activities.';return;}
  if(action==='close')this.tool.close();
  if(action==='visit')a.visit();if(action==='walk'){a.walkDeck();this.release();}
  if(action==='enter'){a.enter();this.release();}
  if(action==='approach'){a.approach();this.release();}
  if(action==='brake')c.brake=!c.brake;if(action==='gear')c.gear=!c.gear;if(action==='hook')c.hook=!c.hook;
  if(action==='flaps')c.flaps=c.flaps<.3?.6:c.flaps<.9?1:0;
  if(action==='camera')a.toggleCamera();if(action==='reset')a.reset();if(action==='leave'){a.leave();this.release();}this.syncControls();
 }
 release(){this.tool.close();document.activeElement?.blur();this.aviation.app.engine.domElement.focus?.();}
 syncControls(){const a=this.aviation,c=a.flight.controls;this.throttle.value=String(Math.round(c.throttle*100));this.flapInput.value=String(c.flaps);this.inspectionInput.value=a.inspectView;
  // Pressed means gear down, hook down, brake on, cockpit view. The labels stay short
  // so the seven buttons keep one row (they wrapped, and the panel
  // duplicated them).
  for(const action of ['gear','hook','brake'])this.hud.querySelector(`[data-act=${action}]`).setAttribute('aria-pressed',String(!!c[action]));
  this.hud.querySelector('[data-act=camera]').setAttribute('aria-pressed',String(a.camMode==='cockpit'));
 }
 update(dt){const a=this.aviation,f=a.flight,m=f.metrics,c=a.carrier.metrics;this.hud.hidden=!a.pilot;this.reticle.hidden=!a.pilot||a.camMode!=='cockpit';if(!a.pilot)return;
  this.last+=dt;if(this.last<.08&&dt>0)return;this.last=0;
  const datasets={phase:f.phase,speed:m.speed,'deck-speed':length(sub(f.velocity,a.carrier.velocityAt(f.position))),contacts:m.contacts,'model-parts':a.modelParts,gear:f.controls.gear?'down':'up',hook:f.controls.hook?'down':'up',q:m.q,lift:m.lift,drag:m.drag,thrust:m.thrust,alpha:m.alpha*DEG,heading:((180-m.heading*DEG+360)%360),bank:-m.bank*DEG,'catapult-run':m.catapultRun,'cable-energy':m.cableEnergy,'peak-cable-force':m.peakCableForce,'landing-distance':m.landingDistance,'deck-sink':m.deckSink,x:f.position[0],y:f.position[1],z:f.position[2],'carrier-heave':c.heave,'carrier-roll':c.roll*DEG,'carrier-wind-force':c.windForce};
  for(const [key,value]of Object.entries(datasets))this.hud.setAttribute(`data-${key}`,typeof value==='number'?value.toFixed(5):value);
  this.hud.querySelector('.av-phase').textContent={ready:'Ready on catapult',launching:'Catapult launch',airborne:'Airborne',touchdown:'Deck contact',arresting:'Wire captured',arrested:'Arrested landing',bolter:'Bolter · go around',ditched:'Ditching · flooding',crashed:'Aircraft damaged'}[f.phase]||f.phase;
  const read=(key,value)=>this.hud.querySelector(`[data-read=${key}]`).textContent=value;
  read('speed',m.speed.toFixed(0));read('altitude',f.position[1].toFixed(0));
  // no '-0.0' on the parked jet (capture ready-on-catapult.png)
  read('sink',(Math.abs(f.velocity[1])<0.05?0:f.velocity[1]).toFixed(1));
  read('throttle',Math.round(f.controls.throttle*100)+'%');
  const runway=a.carrier.runway(f.position),distance=Math.max(0,-runway.along),glide=Math.atan2(runway.height-1.9,Math.max(1,distance))*DEG;
  this.hud.querySelector('.av-note').textContent=!['crashed','ditched','arrested'].includes(f.phase)&&m.stall&&m.speed>25?'STALL · lower the nose and add power':f.phase==='airborne'&&runway.along<0&&distance<1500?`${distance.toFixed(0)} m to stern · ${Math.abs(runway.cross).toFixed(1)} m ${runway.cross<0?'right':'left'} · ${glide.toFixed(1)}° glide`:f.reason;
  this.hud.querySelector('.av-forces').textContent=`Mass ${AIRCRAFT.mass.toLocaleString()} kg · q ${(m.q/1000).toFixed(2)} kPa\nAoA ${(m.alpha*DEG).toFixed(1)}° · Bank ${(-m.bank*DEG).toFixed(1)}°\nLift ${(m.lift/1000).toFixed(1)} kN · Drag ${(m.drag/1000).toFixed(1)} kN\nThrust ${(m.thrust/1000).toFixed(1)} kN · Load ${m.loadFactor.toFixed(2)} g\nWind ${m.windSpeed.toFixed(1)} m/s · Gear ${m.contacts}/3\nDeck descent ${m.deckSink.toFixed(2)} m/s\nCable ${(m.cableForce/1000).toFixed(0)} kN · Work ${(m.cableEnergy/1e6).toFixed(2)} MJ\nCarrier ${(CARRIER.mass/1e6).toFixed(0)} million kg\nHeave ${c.heave.toFixed(2)} m · Roll ${(c.roll*DEG).toFixed(2)}°\nBuoyancy ${(c.buoyancy/1e6).toFixed(1)} MN\nCurrent load ${(c.currentForce/1000).toFixed(0)} kN`;
 }
}
