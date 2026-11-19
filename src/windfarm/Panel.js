import { addWorldTool } from '../ui/WorldTools.js';
import { G } from '../core/Globals.js';

const STYLE=`
.wf-panel header{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:12px}.wf-panel input,.wf-panel .wf-total{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:13px 0;border-top:1px solid #46616a;border-bottom:1px solid #46616a;margin:12px 0}.wf-total strong{display:block;font-size:23px;line-height:1.2;color:#d3efbf;font-weight:550;font-variant-numeric:tabular-nums}.wf-total small{display:block;color:#b7c9cb;font-size:11px;margin-top:4px}.wf-panel .wf-unit{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #34545c;padding:8px 0;gap:8px;font-variant-numeric:tabular-nums}.wf-unit b{font-size:12px;font-weight:600}.wf-unit small{display:block;font-size:10px;color:#b7c9cb}.wf-unit .wf-output{text-align:right}.wf-panel .wf-buttons{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.wf-panel details{border-top:1px solid #46616a;margin-top:13px;padding-top:11px}.wf-panel summary{cursor:pointer;font-weight:600;list-style-position:inside}.wf-panel dl{display:grid;grid-template-columns:1fr auto;gap:5px 12px;font-size:11px;color:#c4d4d4;margin:11px 0}.wf-panel dt,.wf-panel dd{margin:0}.wf-panel dd{text-align:right;font-variant-numeric:tabular-nums;color:#f2f3ed}.wf-panel .wf-note{font-size:11px;line-height:1.45;color:#b7c9cb}.wf-panel [role=alert]{color:#ffd7a5;font-size:12px;min-height:0}.wf-panel [role=alert]:empty{display:none}.wf-panel [role=alert]:not(:empty){margin:8px 0;padding:8px 0}.wf-panel a{color:#beded9}.wf-panel .wf-danger{border-color:#967c65;background:#503d32}
`;
const fix=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'0';

export class WindFarmPanel {
 constructor(farm) {
  this.farm=farm;this.selected=0;this.abort=new AbortController();
  const style=this.style=document.createElement('style');style.textContent=STYLE;document.head.append(style);
  const p=this.element=document.createElement('section');p.className='wf-panel';p.setAttribute('aria-label','Wind farm controls');
  p.innerHTML=`<header><div><div class="wf-kicker">North coast · 15 MW installed</div><h2>Wind farm</h2><p>Three turbines on island foundations</p></div><button class="wf-close" aria-label="Close wind farm">×</button></header>
   <div role="status" aria-label="Wind farm telemetry"><div class="wf-total"><div><strong data-value="power">0.00 MW</strong><small>Electrical generation</small></div><div><strong data-value="energy">0.000 MWh</strong><small>Energy this session</small></div></div><div class="wf-units"></div></div>
   <label>Farm enabled<input type="checkbox" aria-label="Farm enabled" checked></label>
   <div class="wf-buttons"><button data-action="watch">Watch farm</button><button data-action="reset">Reset wind farm</button></div>
   <label>Turbine<select aria-label="Turbine">${farm.turbines.map((t,i)=>`<option value="${i}">${t.id}</option>`).join('')}</select></label>
   <div class="wf-buttons"><button data-action="inspect">Inspect turbine</button><button data-action="foundation">Inspect foundation</button></div>
   <label>Turbine enabled<input type="checkbox" aria-label="Turbine enabled" checked></label>
   <label>Rotor brake<input type="checkbox" aria-label="Rotor brake"></label>
   <div class="wf-buttons"><button data-action="restart">Restart turbine</button></div>
   <p class="wf-note" data-value="safety">Automatic feather and brake above 25 m/s. Restart below 20 m/s after five safe seconds.</p>
   <div role="alert" aria-label="Wind farm validation"></div>
   <details><summary>Inspect loads &amp; energy</summary><dl data-value="inspector"></dl>
    <label>Minimum pitch (°)<input aria-label="Minimum pitch (°)" type="number" min="0" max="90" step="1" value="0"></label><button data-action="pitch">Apply pitch</button>
    <p class="wf-note">NREL 5 MW geometry and peak efficiency. Simplified aerodynamics, wake and structural limits. <a href="https://www.osti.gov/servlets/purl/947422" target="_blank" rel="noopener noreferrer">Reference turbine report</a>.</p>
   </details>
   <details><summary>Shared island wind</summary><p class="wf-note">Changes the wind used by the sea, aircraft and turbines.</p>
    <label>Ambient wind (m/s)<input aria-label="Ambient wind (m/s)" type="number" min="0" max="60" step="0.5"></label>
    <label>Wind direction (°)<input aria-label="Wind direction (°)" type="number" min="0" max="360" step="1"></label><button data-action="wind">Apply wind</button>
   </details>`;
  this.tool=addWorldTool(farm.app,{id:'windfarm',label:'Wind farm',panel:p,onOpen:()=>this.syncControls()});
  this.total=p.querySelector('[aria-label="Wind farm telemetry"]');
  this.rows=farm.turbines.map(t=>{const e=document.createElement('div');e.className='wf-unit';e.setAttribute('role','status');e.setAttribute('aria-label',`${t.id} telemetry`);e.innerHTML=`<div><b>${t.id}</b><small data-unit="state">Starting</small></div><div class="wf-output"><b data-unit="power">0.00 MW</b><small data-unit="speed">0.0 rpm · 0.0 m/s</small></div>`;p.querySelector('.wf-units').append(e);return e;});
  const listen=(target,event,fn)=>target.addEventListener(event,fn,{signal:this.abort.signal});
  listen(p.querySelector('.wf-close'),'click',()=>this.tool.close(true));
  listen(p.querySelector('[aria-label="Turbine"]'),'change',e=>{this.selected=Number(e.target.value);this.syncControls();this.render();});
  listen(this.input('Farm enabled'),'change',e=>{farm.enabled=e.target.checked;this.render();});
  listen(this.input('Turbine enabled'),'change',e=>this.current.setEnabled(e.target.checked));
  listen(this.input('Rotor brake'),'change',e=>this.current.setBrake(e.target.checked));
  listen(p.querySelector('[data-action="watch"]'),'click',()=>{farm.watch();this.render();});
  listen(p.querySelector('[data-action="inspect"]'),'click',()=>{farm.inspect(this.selected);this.render();});
  listen(p.querySelector('[data-action="foundation"]'),'click',()=>{farm.inspectFoundation(this.selected);this.render();});
  listen(p.querySelector('[data-action="reset"]'),'click',()=>{farm.reset();this.syncControls();this.error('');this.render();});
  listen(p.querySelector('[data-action="restart"]'),'click',()=>this.error(this.current.restart()));
  listen(p.querySelector('[data-action="pitch"]'),'click',()=>{try{const i=this.input('Minimum pitch (°)');if(i.value.trim()==='')throw new RangeError('Minimum pitch must be 0 to 90 degrees.');this.current.setMinimumPitch(Number(i.value));this.error('');}catch(e){this.error(e.message);}});
  listen(p.querySelector('[data-action="wind"]'),'click',()=>{
   try {const speed=this.input('Ambient wind (m/s)'),direction=this.input('Wind direction (°)');if(speed.value.trim()===''||direction.value.trim()===''||!speed.checkValidity()||!direction.checkValidity())throw new RangeError('Wind must be 0 to 60 m/s and direction 0 to 360 degrees.');farm.app.setAmbientWind(Number(speed.value),Number(direction.value));this.error('');}
   catch(e){this.error(e.message);}
  });
  this.syncControls();this.render();
 }
 get current(){return this.farm.turbines[this.selected];}
 input(name){return this.element.querySelector(`[aria-label="${name}"]`);}
 error(message){this.element.querySelector('[role="alert"]').textContent=message;}
 syncControls() {
  this.input('Farm enabled').checked=this.farm.enabled;
  this.input('Turbine enabled').checked=this.current.enabled;this.input('Rotor brake').checked=this.current.brake;
  this.input('Minimum pitch (°)').value=fix(this.current.minimumPitch*180/Math.PI,0);
  this.input('Ambient wind (m/s)').value=fix(G.windSpeed.value,1);
  this.input('Wind direction (°)').value=fix((Math.atan2(G.windDir.value.y,G.windDir.value.x)*180/Math.PI+360)%360,0);
 }
 render() {
  const state=this.farm.state();
  Object.assign(this.total.dataset,{power:String(state.electricalPower),energy:String(state.energyMWh),enabled:String(state.enabled),damaged:String(state.damaged),watch:String(this.farm.watching),inspected:this.farm.inspected||'',bodies:String(state.bodyCount),fragmentHeight:String(state.lowestFragmentY),solidTowers:String(state.solidTowerSections),dryFoundations:String(state.dryFoundations)});
  this.element.querySelector('[data-value="power"]').textContent=`${fix(state.electricalPower/1e6)} MW`;
  this.element.querySelector('[data-value="energy"]').textContent=`${fix(state.energyMWh,3)} MWh`;
  state.turbines.forEach((t,i)=>{
   const row=this.rows[i];Object.assign(row.dataset,{power:String(t.electricalPower),angle:String(t.rotorAngle),rpm:String(t.rpm),status:t.status,energy:String(t.energyJ),wind:String(t.windSpeed),pitch:String(t.pitch),yawError:String(t.yawError),thrust:String(t.thrust),foundationMoment:String(t.loads.foundationMoment||0),towerStress:String(t.loads.towerStress||0),damaged:String(t.damaged),ground:String(t.groundY),footing:String(t.baseY),hubHeight:String(t.hubY),floodDepth:String(t.loads.padWet||0)});
   row.querySelector('[data-unit="state"]').textContent=t.status;
   row.querySelector('[data-unit="power"]').textContent=`${fix(t.electricalPower/1e6)} MW`;
   row.querySelector('[data-unit="speed"]').textContent=`${fix(t.rpm,1)} rpm · ${fix(t.windSpeed,1)} m/s`;
  });
  if(this.tool.isOpen) {
   const t=state.turbines[this.selected],loads=t.loads;
   const pairs=[['Footing / hub elevation',`${fix(t.baseY,1)} / ${fix(t.hubY,1)} m`],['Available wind flux',`${fix(t.availablePower/1e6)} MW`],['Rotor mechanical power',`${fix(t.rotorPower/1e6)} MW`],['Electrical output',`${fix(t.electricalPower/1e6)} MW`],['Delivered energy',`${fix(t.energyJ/3.6e9,4)} MWh`],['Rotor kinetic energy',`${fix(t.rotorEnergyJ/1e6)} MJ`],['Generator torque',`${fix(t.generatorTorque/1e6,3)} MN·m`],['Aerodynamic torque',`${fix(t.aerodynamicTorque/1e6,3)} MN·m`],['Pitch / yaw error',`${fix(t.pitch,1)}° / ${fix(t.yawError,1)}°`],['Power coefficient / TSR',`${fix(t.cp,3)} / ${fix(t.tsr)}`],['Rotor thrust',`${fix(t.thrust/1000,1)} kN`],['Tower stress',`${fix((loads.towerStress||0)/1e6,1)} MPa`],['Foundation moment',`${fix((loads.foundationMoment||0)/1e6,1)} MN·m`],['Flood force on base',`${fix((loads.waterForce||0)/1000,1)} kN`],['Tower top deflection',`${fix(t.tipDeflection)} m`],['Wake speed retained',`${fix((t.wakeFactor??1)*100,1)}%`],['Peak structural demand',`${fix(this.current.peakUtilization*100,0)}%`]];
   this.element.querySelector('[data-value="inspector"]').innerHTML=pairs.map(([key,value])=>`<dt>${key}</dt><dd>${value}</dd>`).join('');
   if(state.bodyCount)this.element.querySelector('[data-value="inspector"]').insertAdjacentHTML('beforeend',`<dt>Detached parts</dt><dd>${state.bodyCount} · lowest ${fix(state.lowestFragmentY,1)} m</dd>`);
  }
 }
 dispose(){this.abort.abort();this.tool.close();this.tool.button.remove();this.farm.app.worldTools?.tools.delete('windfarm');this.element.remove();this.style.remove();}
}
