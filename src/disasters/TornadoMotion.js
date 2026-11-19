import { freshSeed, uniform, STREAM } from './EventRandom.js';
// Tornado paths derive from the event seed.
export const TRACK_STEP=.05; // s, fixed integration grid for the track deviation
const DEG=Math.PI/180;
const wave=(amp,period,phase,t)=>amp*Math.sin(2*Math.PI*t/period+phase);

export function tornadoMotionParams(seed,scale=1){
 const u=k=>uniform(seed,STREAM.track,k),phase=k=>2*Math.PI*u(k),sign=k=>u(k)<.5?-1:1;
 return {
  seed,t:0,dx:0,dz:0,cx:0,cz:0,at:-1,factor:1,
  // heading wander: 4-9 deg over 40-90 s plus 2-5 deg over 15-35 s (14 deg at most)
  swing:scale*sign(0)*(4+5*u(1))*DEG,swingPeriod:40+50*u(2),swingPhase:phase(3),
  weave:scale*sign(4)*(2+3*u(5))*DEG,weavePeriod:15+20*u(6),weavePhase:phase(7),
  // translation speed: +-10 to 25% over 25-70 s plus +-5 to 10% over 8-18 s
  surge:scale*(.10+.15*u(8)),surgePeriod:25+45*u(9),surgePhase:phase(10),
  lurch:scale*(.05+.05*u(11)),lurchPeriod:8+10*u(12),lurchPhase:phase(13),
  // peak wind: a +-5 to 12% surge over 15-45 s (mesocyclone and rear-flank cycles), gusts of
  // +-2 to 6% over 2-6 s and +-1 to 4% over 0.9-2.4 s; at most +-22% in all
  pulse:scale*(.05+.07*u(14)),pulsePeriod:15+30*u(15),pulsePhase:phase(16),
  gust:scale*(.02+.04*u(17)),gustPeriod:2+4*u(18),gustPhase:phase(19),
  flutter:scale*(.01+.03*u(20)),flutterPeriod:.9+1.5*u(21),flutterPhase:phase(22),
 };
}

// Adds h seconds of departure from the straight line at mid-interval time t. Speed factor f and
// heading offset turn give velocity speed*f*(cos(a+turn), sin(a+turn)); the line already moves at
// speed*(cos a, sin a). With scale 0 both terms are exactly zero.
function drift(m,e,a,t,h){
 const f=1+wave(m.surge,m.surgePeriod,m.surgePhase,t)+wave(m.lurch,m.lurchPeriod,m.lurchPhase,t);
 const turn=wave(m.swing,m.swingPeriod,m.swingPhase,t)+wave(m.weave,m.weavePeriod,m.weavePhase,t);
 m.dx+=e.speed*(f*Math.cos(a+turn)-Math.cos(a))*h;
 m.dz+=e.speed*(f*Math.sin(a+turn)-Math.sin(a))*h;
}

// The motion state at e.time: cx, cz (track deviation, m) and factor (intensity multiplier).
// Cached per e.time, so the many field samples in one frame integrate nothing. Allocation-free
// after the first call of an event.
export function tornadoMotion(e){
 e.seed??=freshSeed();
 let m=e.motion;
 if(!m||m.seed!==e.seed)m=e.motion=tornadoMotionParams(e.seed);
 if(e.time<m.t){m.t=0;m.dx=0;m.dz=0;m.at=-1;}
 if(m.at===e.time)return m;
 const a=e.direction*DEG;
 while(m.t+TRACK_STEP<=e.time){drift(m,e,a,m.t+TRACK_STEP*.5,TRACK_STEP);m.t+=TRACK_STEP;}
 // The partial step up to e.time is applied, read and undone, so the grid state never holds it.
 const gx=m.dx,gz=m.dz;
 drift(m,e,a,(m.t+e.time)*.5,e.time-m.t);
 m.cx=m.dx;m.cz=m.dz;m.dx=gx;m.dz=gz;
 const t=e.time;
 m.factor=1+wave(m.pulse,m.pulsePeriod,m.pulsePhase,t)+wave(m.gust,m.gustPeriod,m.gustPhase,t)+wave(m.flutter,m.flutterPeriod,m.flutterPhase,t);
 m.at=e.time;
 return m;
}
