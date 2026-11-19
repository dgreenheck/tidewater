// Synthesized civil-warning tone, created only by the Start user gesture. One context,
// two oscillators while sounding, no leaked/repeated sources after stop/reset.
export class TsunamiSiren {
 constructor(app){this.app=app;this.muted=false;this.volume=.25;this.nodes=[];this.ctx=null;this.level=0;this.enabled=false;}
 async arm(){this.enabled=true;if(this.app.qs?.has('noAudio'))return;const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AC)return;try{this.ctx??=new AC();await this.ctx.resume();}catch{this.blocked=true;}}
 start(){const c=this.ctx;if(!c||c.state!=='running'||this.nodes.length)return;
  this.gain=c.createGain();this.gain.gain.value=0;this.gain.connect(c.destination);
  for(const ratio of [1,1.006]){const o=c.createOscillator();o.type='sine';o.frequency.value=540*ratio;o.connect(this.gain);o.start();this.nodes.push(o);}
 }
 update(event,paused=false){const on=!!event&&!paused&&this.enabled;const mute=this.muted||!!this.app.audio?.muted||!!this.app.disasters?.globalMuted;
  if(!on){this.stop();return;}this.start();if(!this.ctx)return;
  const t=this.ctx.currentTime,w=.5+.5*Math.sin(event.time*Math.PI/2),frequency=420+300*w;
  this.nodes.forEach((o,i)=>o.frequency.setTargetAtTime(frequency*(i?1.006:1),t,.08));
  this.level=mute?0:this.volume*.18;if(this.gain)this.gain.gain.setTargetAtTime(this.level,t,.08);
 }
 stop(){for(const node of this.nodes){try{node.stop();node.disconnect();}catch{}}this.nodes.length=0;this.gain?.disconnect();this.gain=null;this.level=0;}
 get state(){return {context:this.ctx?.state??'unavailable',sources:this.nodes.length,level:this.level,muted:this.muted||!!this.app.audio?.muted||!!this.app.disasters?.globalMuted};}
}
