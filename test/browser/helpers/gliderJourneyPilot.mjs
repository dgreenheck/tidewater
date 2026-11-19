// Test-only pilot: observations in, discrete physical key commands out.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));
function rotate(q,v){const [x,y,z,w]=q;const tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return[v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];}
export function createPilot(options={}) {
 let stage='departure',lastTime=0,lastSpeed=13,pitchAccumulator=0,rollAccumulator=0,orbitTurns=0,oldTheta,baseZ,flareAt=null;
 const cfg={orbitX:-180,orbitZ:-80,radius:80,exitHeight:105,speed:14,bankLimit:.55,headingGain:.5,yawDamping:.8,bankGain:.3,rollDamping:.8,baseX:-30,baseZ:90,finalRadius:45,lineGain:35,finalBankLimit:.3,flareHeight:.35,finalSpeed:13,...options};
 const quant=(value,axis)=>{if(axis==='pitch'){pitchAccumulator+=value;const r=pitchAccumulator>.5?1:pitchAccumulator<-.5?-1:0;pitchAccumulator-=r;return r;}rollAccumulator+=value;const r=rollAccumulator>.5?1:rollAccumulator<-.5?-1:0;rollAccumulator-=r;return r;};
 return {get stage(){return stage;},decide(s){
  if(s.phase==='running'||(s.metrics.airTime||0)<1){pitchAccumulator=rollAccumulator=0;lastTime=s.time;lastSpeed=s.metrics.speed;return{roll:0,pitch:0,flare:false,stage:'departure'};}
  const p=s.position,v=s.velocity,m=s.metrics,wind=m.windVector||[2.442,0,6.56],time=s.time,dt=clamp(time-lastTime,.02,.5);lastTime=time;
  const forward=rotate(s.quaternion,[0,0,1]),up=rotate(s.quaternion,[0,1,0]),right=rotate(s.quaternion,[1,0,0]);
  const heading=Math.atan2(forward[0],forward[2]),bank=Math.atan2(-right[1],up[1]);
  const speed=Math.hypot(v[0]-wind[0],v[1]-wind[1],v[2]-wind[2]),speedDot=(speed-lastSpeed)/dt;lastSpeed=speed;
  let target,groundDir;
  if(stage==='departure') {target=[-115,-550];if((m.airTime||0)>7)stage='transit';}
  if(stage==='transit'){target=[-225,-130];if(p[2]>-170)stage='orbit';}
  if(stage==='orbit') {
   const dx=p[0]-cfg.orbitX,dz=p[2]-cfg.orbitZ,r=Math.hypot(dx,dz),theta=Math.atan2(dz,dx);
   if(oldTheta!==undefined)orbitTurns+=Math.abs(wrap(theta-oldTheta))/(2*Math.PI);oldTheta=theta;
   // clockwise map orbit: northeast-side exit points southeast then turns into wind.
   const radial=clamp((r-cfg.radius)/40,-1.5,1.5);
   groundDir=[-dz/r-radial*dx/r,dx/r-radial*dz/r];
   if(p[1]<cfg.exitHeight){stage='base';baseZ=cfg.baseZ+Math.max(0,p[0]+260)*.45;}
  }
  if(stage==='base') {target=[cfg.baseX,baseZ??cfg.baseZ];groundDir=null;if(Math.hypot(p[0]-cfg.baseX,p[2]-(baseZ??cfg.baseZ))<cfg.finalRadius){stage='final';}}
  if(stage==='final') {const ux=-wind[0]/Math.hypot(wind[0],wind[2]),uz=-wind[2]/Math.hypot(wind[0],wind[2]),nx=-uz,nz=ux,cross=(p[0]+92)*nx+(p[2]+91)*nz;groundDir=[ux-nx*clamp(cross/cfg.lineGain,-.8,.8),uz-nz*clamp(cross/cfg.lineGain,-.8,.8)];target=null;}
  if(target&&!groundDir){const dx=target[0]-p[0],dz=target[1]-p[2],r=Math.max(1,Math.hypot(dx,dz));groundDir=[dx/r,dz/r];}
  const gl=Math.hypot(...groundDir);groundDir=groundDir.map(a=>a/gl);
  const along=wind[0]*groundDir[0]+wind[2]*groundDir[1],cross=wind[0]*groundDir[1]-wind[2]*groundDir[0],gs=along+Math.sqrt(Math.max(4,speed*speed-cross*cross));
  const desiredHeading=Math.atan2(groundDir[0]*gs-wind[0],groundDir[1]*gs-wind[2]);
  const headingError=wrap(desiredHeading-heading),bankTarget=clamp(cfg.headingGain*headingError-cfg.yawDamping*s.omega[1],-(stage==='final'?cfg.finalBankLimit:cfg.bankLimit),(stage==='final'?cfg.finalBankLimit:cfg.bankLimit));
  const roll=clamp((bankTarget+cfg.bankGain*(bankTarget-bank)+cfg.rollDamping*s.omega[2])/.86,-1,1);
  const targetSpeed=stage==='final'?cfg.finalSpeed:cfg.speed;
  const trimAlpha=(2*118*9.81/(1.225*Math.exp(-Math.max(0,p[1])/8500)*15.8*targetSpeed**2)-.22)/4.2;
  const alphaTarget=clamp(trimAlpha+.035*(speed-targetSpeed)+.028*speedDot,-.04,.22);
  const pitch=(alphaTarget-.12)/.20;
  if(stage==='final'&&m.agl<cfg.flareHeight&&flareAt===null)flareAt=time;
  const flare=flareAt!==null&&time-flareAt<.18;
  return {roll:quant(roll,'roll'),pitch:flare?0:quant(pitch,'pitch'),flare,stage,orbitTurns,target,desiredHeading,bankTarget,alphaTarget,speed};
 }};
}
