import { addWorldTool } from '../ui/WorldTools.js';
const STYLE=`
.evac-guidance{position:fixed;z-index:105;left:50%;bottom:calc(max(72px,13vh) + 64px);transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:10px 18px;border:1px solid #85ba97;border-radius:9px;background:#103528eb;color:#edffef;font:600 13px/1.45 system-ui;text-align:center;pointer-events:none;box-shadow:0 5px 22px #0004}.evac-guidance[hidden]{display:none}.evac-guidance small{display:block;font-weight:400;color:#c6dfcc}body:has(.tw-root.is-starting) .evac-guidance,body:has(.tw-root.is-photo) .evac-guidance{display:none}/* Third person: the character stands at the bottom centre, so the hint takes the prompt's column
   to its right (.tw-prompt.is-third in ui.css), stacked above the prompt (the card
   sat on the player's shorts). AppUI stamps .tw-root.is-third. */
body:has(.tw-root.is-third) .evac-guidance{left:calc(50% + 14vw);transform:none;text-align:left;max-width:calc(36vw - 24px)}
@media(max-width:700px){.evac-guidance{font-size:11px;padding:8px 11px}}
`;
const fixed=x=>Number.isFinite(x)?x.toFixed(2):'0.00';
export class EvacuationPanel {
 constructor(owner){
  this.owner=owner;this.last='';const style=document.createElement('style');style.textContent=STYLE;document.head.append(style);
  const panel=this.panel=document.createElement('section');panel.className='evac-panel';panel.setAttribute('aria-label','Evacuation controls');
  panel.innerHTML=`<button class="evac-close" aria-label="Close evacuation controls">Close</button><div class="evac-eyebrow">Tsunami evacuation</div><h2>Follow the green boardwalk</h2><p>The entrance is beside the village market, at the inland end of the harbour boardwalk. Climb north over the road bridge to the signed hillside refuge.</p><p>Hold <kbd>Shift</kbd> + <kbd>W</kbd> to run. Use the mouse to steer. Handrails and green lamps lead all the way uphill.</p><button class="evac-face">Face evacuation route</button><p class="evac-message" role="alert" aria-label="Evacuation guidance message"></p><output role="status" aria-label="Evacuation route" aria-live="off"></output><p>Leave the waterfront when the siren starts. The refuge is ordinary high ground: water and damage still apply there. A broken or flooded section is unsafe.</p>`;
  this.tool=addWorldTool(owner.app,{id:'evacuation',label:'Evacuation',panel});
  panel.querySelector('.evac-close').onclick=()=>this.tool.close();panel.querySelector('.evac-face').onclick=()=>owner.faceRoute();
  this.output=panel.querySelector('output');
  this.guidance=document.createElement('div');this.guidance.className='evac-guidance';this.guidance.setAttribute('role','status');this.guidance.setAttribute('aria-label','Evacuation guidance');this.guidance.setAttribute('aria-live','polite');this.guidance.hidden=true;document.body.append(this.guidance);
 }
 message(s){this.panel.querySelector('.evac-message').textContent=s;}
 update(s){
  const attrs={'at-refuge':s.atRefuge,'entrance-distance':fixed(s.entranceDistance),'remaining-warning':fixed(s.remainingWarning),warning:s.warning,'light-mode':s.lightMode,'player-elevation':fixed(s.playerElevation),'player-mode':s.playerMode,'refuge-elevation':fixed(s.refugeElevation),'refuge-ground':fixed(s.refugeGround),'refuge-water-depth':fixed(s.refugeWaterDepth),'broken-sections':s.brokenSections,width:s.width,length:s.length};
  for(const [k,v]of Object.entries(attrs))this.output.setAttribute('data-'+k,String(v));
  const key=[Math.round(s.playerElevation),Math.round(s.remainingDistance),s.atRefuge,s.brokenSections,s.refugeWaterDepth>0].join(':');
  if(key!==this.last){this.last=key;this.output.innerHTML=`<strong>High-ground refuge · +${Math.round(s.refugeElevation)} m</strong><br>${Math.round(s.length)} m boardwalk · ${s.width} m wide<br>${s.atRefuge?'At the refuge':Math.round(s.remainingDistance)+' m to the refuge'} · current elevation +${Math.round(s.playerElevation)} m<br>${s.brokenSections?s.brokenSections+' damaged sections': 'Route intact'} · ${s.refugeWaterDepth>.02?'Water above refuge deck':'Refuge deck above the current water'}`;}
  const near=Math.abs(this.owner.app.player.position.x-this.owner.route.x)<8&&this.owner.app.player.position.z<this.owner.route.startZ+8;
  this.guidance.hidden=!s.warning&&!s.atRefuge&&!near;
  const text=s.refugeWaterDepth>.05?'Refuge flooded. Keep moving to higher ground.':s.atRefuge?'High-ground refuge reached':s.brokenSections?'Damaged boardwalk. Avoid broken sections and keep climbing.':'Follow green lights uphill to the refuge';
  const detail=s.atRefuge?`Elevation +${Math.round(s.refugeElevation)} m · stay above the flood`: `${Math.round(s.remainingDistance)} m remaining · Shift + W to run`;
  const copy=text+'|'+detail;if(copy!==this.lastGuidance){this.lastGuidance=copy;this.guidance.replaceChildren(document.createTextNode(text));const small=document.createElement('small');small.textContent=detail;this.guidance.append(small);}
 }
}
