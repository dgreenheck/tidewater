import {Vector3,Matrix4,Quaternion} from '../engine/index.js';
// Assumed material values, not a survey or engineering certification of the village.
// Siding and roofing use physical thickness independent of their exaggerated visual
// shell. A scalar connector calibrates the weak bending plane; it is not orthotropic FEM.
export const MATERIALS=Object.freeze({
 timber:{density:600,E:8e9,stress:30e6,fastener:1800,thickness:.022,relaxation:5},
 light:{density:500,E:5e9,stress:18e6,fastener:950,thickness:.018,relaxation:6},
 steel:{density:7850,E:200e9,stress:220e6,fastener:1400,thickness:.0007,relaxation:3},
 masonry:{density:2400,E:15e9,stress:2e6,fastener:12000,thickness:.18,relaxation:5}
});
const V=(x=0,y=0,z=0)=>new Vector3(x,y,z);
function bounds(spans){const lo=V(Infinity,Infinity,Infinity),hi=V(-Infinity,-Infinity,-Infinity);for(const s of spans)for(let i=0;i<s.pos.length;i+=3){const p=V().fromArray(s.pos,i);lo.min(p);hi.max(p);}return {lo,hi,center:lo.clone().add(hi).multiplyScalar(.5),half:hi.clone().sub(lo).multiplyScalar(.5)};}
// Jacobi eigenvectors of the authored vertex covariance. This recovers pitched
// roof-sheet axes, where the original builder's vertical bounding box is mostly air.
export function memberFrame(spans){
 const points=[];for(const s of spans){const authored=spans.length===1&&s.member?.fullCount===s.count&&s.member.originalPoints;const data=authored||s.pos;for(let i=0;i<data.length;i+=3){const p=V().fromArray(data,i);if(authored)p.applyMatrix4(s.member.frame);points.push(p);}}
 const mean=points.reduce((a,b)=>a.add(b),V()).multiplyScalar(1/points.length),A=Array(9).fill(0),R=[1,0,0,0,1,0,0,0,1];
 for(const p of points){const d=p.clone().sub(mean).toArray();for(let i=0;i<3;i++)for(let j=0;j<3;j++)A[3*i+j]+=d[i]*d[j];}
 for(let k=0;k<16;k++){let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(A[3*i+j])>Math.abs(A[3*p+q])){p=i;q=j;}if(Math.abs(A[3*p+q])<1e-10)break;
  const angle=.5*Math.atan2(2*A[3*p+q],A[3*q+q]-A[3*p+p]),c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<3;i++){const x=A[3*i+p],y=A[3*i+q];A[3*i+p]=c*x-s*y;A[3*i+q]=s*x+c*y;}
  for(let i=0;i<3;i++){const x=A[3*p+i],y=A[3*q+i];A[3*p+i]=c*x-s*y;A[3*q+i]=s*x+c*y;const a=R[3*i+p],b=R[3*i+q];R[3*i+p]=c*a-s*b;R[3*i+q]=s*a+c*b;}
 }
 const order=[0,1,2].sort((a,b)=>A[3*b+b]-A[3*a+a]),axes=order.map(j=>V(R[j],R[3+j],R[6+j]).normalize());axes[2].crossVectors(axes[0],axes[1]).normalize();axes[1].crossVectors(axes[2],axes[0]).normalize();
 const lo=V(Infinity,Infinity,Infinity),hi=V(-Infinity,-Infinity,-Infinity);for(const p of points){const d=p.clone().sub(mean),v=V(...axes.map(a=>d.dot(a)));lo.min(v);hi.max(v);}
 const mid=lo.clone().add(hi).multiplyScalar(.5),center=mean.clone();axes.forEach((a,i)=>center.addScaledVector(a,mid.getComponent(i)));
 return {center,half:hi.sub(lo).multiplyScalar(.5),axes,quaternion:new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(...axes))};
}
function distanceTo(point,m){const d=point.clone().sub(m.center);return Math.hypot(...m.axes.map((a,i)=>Math.max(0,Math.abs(d.dot(a))-m.half.getComponent(i))));}
// Deck allocation works per triangle, but adjacent triangles in the same native
// member still occupy one contiguous vertex range. Rejoin those ranges after all
// physical properties have been measured; this changes neither topology nor mass.
function compactSpans(spans){
 const runs=[];for(const s of spans){const run=runs.at(-1),last=run?.at(-1);
  if(last&&!last.rigidAttachment&&!s.rigidAttachment&&last.geo===s.geo&&last.inverse===s.inverse&&last.start+last.count===s.start&&!!last.nrm===!!s.nrm)run.push(s);else runs.push([s]);
 }
 return runs.map(run=>{if(run.length===1)return run[0];const first=run[0],count=run.reduce((n,s)=>n+s.count,0),pos=new first.pos.constructor(count*3),nrm=first.nrm?new first.nrm.constructor(count*3):null;
  let at=0;for(const s of run){pos.set(s.pos,at);if(nrm)nrm.set(s.nrm,at);at+=s.pos.length;}return {...first,count,pos,nrm};
 });
}
export function materialMembers(record,terrain){
 const spans=record.spans,described=spans.map(s=>{const f=memberFrame([s]),d=f.half.clone().multiplyScalar(2),material=s.member?.material;
  return {spans:[s],...f,material:material==='roofMetal'||material==='hard'?'steel':material==='stone'?'masonry':record.material==='light'?'light':'timber',area:d.x*d.y,source:material,d};});
 const deck=/pier|boardwalk|evacuation|stair|station/i.test(record.name);
 let members;
 if(deck){
  const chunks=spans.flatMap(s=>s.member?.sectioned?Array.from({length:s.count/3},(_,i)=>({...s,start:s.start+i*3,count:3,pos:s.pos.slice(i*9,i*9+9),nrm:s.nrm?.slice(i*9,i*9+9)})):[s]);
  const bins=new Map();for(const s of chunks){const b=bounds([s]),key=`${Math.floor(b.center.x/3)}:${Math.floor(b.center.z/3)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(s);}
  members=[...bins.values()].map(group=>({spans:group,...memberFrame(group),material:record.material==='light'?'light':'timber',module:true}));
 }else{
  const panels=described.filter(m=>m.area>1.5&&m.d.y>.5&&m.d.z<.5&&['wood','roofMetal','stone','thatch'].includes(m.source));
  const supports=described.filter(m=>m.source==='wood'&&m.d.x>1&&m.d.y<.38&&Math.abs(m.axes[0].y)>.85&&m.center.y-m.half.x<=terrain.heightAt(m.center.x,m.center.z)+.3);
  members=[...panels.sort((a,b)=>b.area-a.area).slice(0,10),...supports.sort((a,b)=>b.d.x-a.d.x).slice(0,6)];
  if(!members.length){members=described.filter(m=>m.d.x>1).sort((a,b)=>b.area-a.area).slice(0,8);}
  if(!members.length)members=[{spans:[],...memberFrame(spans),material:record.material??'timber',module:true}];
  const used=new Set(members.flatMap(m=>m.spans));for(const s of spans)if(!used.has(s)){const p=bounds([s]).center;
   // Minor indexed fittings do not have their own deformable material law. Keep
   // each whole primitive attached to one section; splitting shared quad vertices
   // into invented triples creates triangles between distant fractured bodies.
   members.reduce((a,b)=>distanceTo(p,a)<distanceTo(p,b)?a:b).spans.push({...s,rigidAttachment:true});
  }
 }
 for(const m of members){const material=MATERIALS[m.material]??MATERIALS.timber,L=Math.max(.1,2*m.half.x),width=Math.max(.05,2*m.half.y),visualT=Math.max(.02,2*m.half.z),panel=width>.5&&visualT<.5;
  // Deck modules retain a measured exposed bounding proxy and an assumed solid
  // fraction. Individual sheets/posts use their physical material cross-section.
  m.thickness=m.module?visualT:panel?Math.min(visualT,material.thickness):visualT;
  let surface=0;if(m.module)for(const s of m.spans)for(let i=0;i+8<s.pos.length;i+=9){const a=V().fromArray(s.pos,i),b=V().fromArray(s.pos,i+3),c=V().fromArray(s.pos,i+6);surface+=b.sub(a).cross(c.sub(a)).length()*.5;}
  m.volume=m.module?Math.max(.003,surface*.5*.05):L*width*m.thickness;
  m.mass=Math.max(2,m.volume*material.density);m.area=L*width;
  const corrugation=m.material==='steel'&&panel?100:1;
  m.A=width*m.thickness;m.I=width*m.thickness**3/12*corrugation;m.EI=material.E*m.I;m.EA=material.E*m.A;m.length=L;
  m.materialCapacity=material.stress*m.A;
  m.forceCapacity=Math.max(300,Math.min(m.materialCapacity,material.fastener*Math.max(2,Math.ceil(width/.6))));
  m.momentCapacity=Math.max(50,material.stress*width*m.thickness**2/6*Math.sqrt(corrugation));
  m.relaxation=material.relaxation;
  m.spans=compactSpans(m.spans);
 }
 return members;
}
export function beamConnection(member,root=false){return [member.length/(2*member.EA),root?member.length/(6*member.EI):2*member.length/(3*member.EI),root?member.forceCapacity:member.materialCapacity,member.momentCapacity,member.relaxation];}
export function nearestConnection(a,b){
 const pa=a.center.clone(),pb=b.center.clone();
 for(let k=0;k<3;k++){for(const [p,m,t]of [[pa,a,pb],[pb,b,pa]]){const d=t.clone().sub(m.center);p.copy(m.center);m.axes.forEach((axis,i)=>p.addScaledVector(axis,Math.max(-m.half.getComponent(i),Math.min(m.half.getComponent(i),d.dot(axis)))));}}
 return {point:pa.clone().add(pb).multiplyScalar(.5),gap:pa.distanceTo(pb)};
}
