import {Vector3,Quaternion} from '../engine/index.js';
const V=(x=0,y=0,z=0)=>new Vector3(x,y,z),axes=['x','y','z'];
const bound=(x,h)=>Math.max(-h,Math.min(h,x));

// Exact translational sweep of a sphere against an oriented box: squared distance
// to the box is quadratic between each face crossing, including rounded corners.
// Rotation is sampled at the frame's actual final attitude, not swept continuously.
export function sweepSphereBox(from,to,bodyFrom,bodyTo,rotation,half,radius) {
 const inverse=rotation.clone().invert(),a=from.clone().sub(bodyFrom).applyQuaternion(inverse),b=to.clone().sub(bodyTo).applyQuaternion(inverse),d=b.clone().sub(a),cuts=[0,1];
 for(const axis of axes)if(Math.abs(d[axis])>1e-12)for(const face of [-half[axis],half[axis]]){const t=(face-a[axis])/d[axis];if(t>0&&t<1)cuts.push(t);}
 cuts.sort((x,y)=>x-y);let hit=null;
 for(let j=0;j<cuts.length-1&&hit===null;j++){
  const lo=cuts[j],hi=cuts[j+1],mid=(lo+hi)/2;let A=0,B=0,C=-radius*radius;
  for(const axis of axes){const at=a[axis]+d[axis]*mid;if(Math.abs(at)<=half[axis])continue;const offset=a[axis]-Math.sign(at)*half[axis];A+=d[axis]*d[axis];B+=2*d[axis]*offset;C+=offset*offset;}
  if(A*lo*lo+B*lo+C<=1e-10){hit=lo;break;}
  if(A>1e-16){const disc=B*B-4*A*C;if(disc>=0){const t=(-B-Math.sqrt(disc))/(2*A);if(t>=lo-1e-10&&t<=hi+1e-10)hit=Math.max(lo,t);}}
 }
 if(hit===null)return null;
 const local=a.clone().addScaledVector(d,hit),closest=V(...axes.map(k=>bound(local[k],half[k]))),normal=local.clone().sub(closest);
 if(normal.lengthSq()<1e-12){const axis=axes.reduce((best,k)=>half[k]-Math.abs(local[k])<half[best]-Math.abs(local[best])?k:best,'x');normal[axis]=Math.sign(local[axis])||-Math.sign(d[axis])||1;closest[axis]=normal[axis]*half[axis];}
 normal.normalize().applyQuaternion(rotation);
 const attachment=closest.applyQuaternion(rotation),bodyAt=bodyFrom.clone().lerp(bodyTo,hit);
 const point=attachment.clone().add(bodyAt);
 // The impulse is applied after the native frame. Keep each solver's local
 // contact attachment separate from the world-space time-of-impact point.
 return {time:hit,normal,point,bodyPoint:attachment.add(bodyTo),humanPoint:point.clone().addScaledVector(to.clone().sub(from),1-hit)};
}

// One physical contact with both solvers. The restitution assumption is 0.05.
// Effective inverse masses include each body's inertia about the contact point.
export function debrisImpulse(physics,id,point,normal,human) {
 const state=physics.disaster_contact?.(id,new Float32Array(point.toArray()),new Float32Array(normal.toArray()));
 if(!state?.length)return null;
 const closing=(state[0]-human.velocity.x)*normal.x+(state[1]-human.velocity.y)*normal.y+(state[2]-human.velocity.z)*normal.z;
 if(closing<=.05)return null;
 const magnitude=1.05*closing/(state[3]+human.inverseMass),impulse=normal.clone().multiplyScalar(magnitude);
 // Native rejects excessive/invalid impulses atomically. Never apply only one side.
 if(!physics.apply_prop_impulse(id,new Float32Array(impulse.clone().negate().toArray()),new Float32Array(point.toArray())))return null;
 human.apply(impulse);return {magnitude,closing,point:point.toArray(),normal:normal.toArray()};
}

export class HumanDebrisContacts {
 constructor(owner){this.owner=owner;this.previous=new Map();this.previousPeople=new Map();this.contacts=0;this.last=[];this.ms=0;}
 reset(){this.previous.clear();this.previousPeople.clear();this.contacts=0;this.last=[];}
 update(dt){
  const started=performance.now(),O=this.owner,A=O.app,physics=A.rally.physics,poses=physics.prop_poses(),motion=physics.disaster_motion(),velocity=new Map(),next=new Map(),nextPeople=new Map();
  for(let i=0;i<motion.length;i+=7)velocity.set(motion[i],V(...motion.slice(i+4,i+7)));
  const debris=[];for(let i=0;i<poses.length;i+=10){const id=poses[i],r=O.structures.bodies.get(id)||O.bodies.bodies.get(id);if(!r)continue;const at=V(...poses.slice(i+1,i+4)),prior=this.previous.get(id)??at.clone().addScaledVector(velocity.get(id)??V(),-dt);next.set(id,at);debris.push({id,r,at,prior,q:new Quaternion(...poses.slice(i+4,i+8))});}
  if(!debris.length){this.previous=next;this.previousPeople.clear();this.ms=performance.now()-started;return;}
  for(const person of A.people.list){
   if(!person.world||!person.model)continue;const rd=person.knock?.rag?.rd;
   const center=rd?.phase==='sim'?V(rd.pelvis.x.x,rd.pelvis.x.y,rd.pelvis.x.z):person.world.clone().add(V(0,.85,0));
   const old=this.previousPeople.get(person)??center;nextPeople.set(person,center.clone());
   let impacts=0;
   for(const b of debris){
    if(impacts>=3)break;
    const reach=b.r.half.length()+1.8+b.at.distanceTo(b.prior);
    if(center.distanceToSquared(b.at)>reach*reach)continue;
    // Standing capsule is represented by its three contact spheres. Articulated
    // rigs use the real segment spheres already used by the XPBD contact solver.
    const spheres=[];
    if(rd?.phase==='sim')for(const segment of rd.bodies)for(const sample of segment.samples){const at=V(sample.x,sample.y,sample.z).applyQuaternion(new Quaternion(segment.q.x,segment.q.y,segment.q.z,segment.q.w)).add(V(segment.x.x,segment.x.y,segment.x.z));spheres.push({at,r:segment.r,segment});}
    else for(const y of [-.58,0,.58])spheres.push({at:center.clone().add(V(0,y,0)),r:.27});
    let first=null;for(const sphere of spheres){const from=sphere.at.clone().add(old).sub(center),hit=sweepSphereBox(from,sphere.at,b.prior,b.at,b.q,b.r.half,sphere.r);if(hit&&(!first||hit.time<first.time))first={...hit,segment:sphere.segment};}
    if(!first)continue;
    const check=physics.disaster_contact?.(b.id,new Float32Array(first.bodyPoint.toArray()),new Float32Array(first.normal.toArray()));if(!check?.length)continue;const pv=rd?.phase==='sim'?rd.pelvis.v:person.knock?.physical?.velocity??person.evacuation?.velocity??person._bv??{x:0,y:0,z:0};if((check[0]-pv.x)*first.normal.x+(check[1]-pv.y)*first.normal.y+(check[2]-pv.z)*first.normal.z<=.5)continue;
    O.rememberPerson(person);const k=A.people.contact.environment(person);const active=k?.rag?.rd;let human;
    if(active?.phase==='sim'){
     const segment=first.segment??active.bodies.reduce((best,s)=>V(s.x.x,s.x.y,s.x.z).distanceToSquared(first.humanPoint)<V(best.x.x,best.x.y,best.x.z).distanceToSquared(first.humanPoint)?s:best,active.pelvis);
     const offset=first.humanPoint.clone().sub(V(segment.x.x,segment.x.y,segment.x.z));
     human={velocity:V(segment.v.x,segment.v.y,segment.v.z).add(V(segment.w.x,segment.w.y,segment.w.z).cross(offset)),inverseMass:active.wPos(segment,offset,first.normal),apply:J=>active.impulse(segment,offset,J.x,J.y,J.z)};
    }else if(k?.physical){const s=k.physical;human={velocity:s.velocity,inverseMass:1/s.mass,apply:J=>s.velocity.addScaledVector(J,1/s.mass)};}
    if(!human)continue;
    const result=debrisImpulse(physics,b.id,first.bodyPoint,first.normal,human);if(result){this.contacts++;impacts++;this.last.push({person:person.id,body:b.id,...result,point:first.point.toArray(),bodyPoint:first.bodyPoint.toArray(),humanPoint:first.humanPoint.toArray()});if(this.last.length>12)this.last.shift();}
   }
  }
  this.previous=next;this.previousPeople=nextPeople;this.ms=performance.now()-started;
 }
}
