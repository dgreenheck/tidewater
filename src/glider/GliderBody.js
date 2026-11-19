import {Vector3,Matrix4,Ray} from '../engine/math/index.js';
import {rotate,inverseRotate,cross,add} from '../aviation/Math.js';

const xyz=p=>Array.isArray(p)?p:[p.x,p.y,p.z];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ray=new Ray(),hit=new Vector3();
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;

// The authored sail is rigid in its local frame. A small immutable ray tree
// avoids testing all1,468 triangles for every head-surface/camera candidate.
function rayTree(triangles){
 const min=[0,1,2].map(k=>Math.min(...triangles.map(t=>t.min[k]))),max=[0,1,2].map(k=>Math.max(...triangles.map(t=>t.max[k])));
 if(triangles.length<=12)return{min,max,triangles};
 const size=max.map((v,k)=>v-min[k]),axis=size.indexOf(Math.max(...size)),ordered=triangles.slice().sort((a,b)=>(a.min[axis]+a.max[axis])-(b.min[axis]+b.max[axis])),middle=ordered.length>>1;
 return{min,max,left:rayTree(ordered.slice(0,middle)),right:rayTree(ordered.slice(middle))};
}
function boxEntry(node,o,d,best){
 let lo=0,hi=best;
 for(let k=0;k<3;k++){
  const origin=k===0?o.x:k===1?o.y:o.z,direction=k===0?d.x:k===1?d.y:d.z;
  if(Math.abs(direction)<1e-12){if(origin<node.min[k]||origin>node.max[k])return Infinity;continue;}
  const a=(node.min[k]-origin)/direction,b=(node.max[k]-origin)/direction;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(hi<lo)return Infinity;
 }
 return lo;
}
function castTree(tree,origin,direction,maxDistance){
 ray.set(origin,direction);let best=maxDistance;const pending=tree?[tree]:[];
 while(pending.length){const node=pending.pop();if(boxEntry(node,origin,direction,best)>best)continue;
  if(node.triangles){for(const t of node.triangles){const p=ray.intersectTriangle(t.a,t.b,t.c,false,hit);if(p){const distance=p.distanceTo(origin);if(distance<best)best=distance;}}}
  else{const left=boxEntry(node.left,origin,direction,best),right=boxEntry(node.right,origin,direction,best);if(left<right){if(right<=best)pending.push(node.right);if(left<=best)pending.push(node.left);}else{if(left<=best)pending.push(node.left);if(right<=best)pending.push(node.right);}}
 }
 return best;
}
function nearbyTriangles(tree,point,radius){
 const found=[],pending=tree?[tree]:[],p=point.toArray();
 while(pending.length){const node=pending.pop();if([0,1,2].some(k=>p[k]+radius<node.min[k]||p[k]-radius>node.max[k]))continue;
  if(node.triangles)found.push(...node.triangles);else pending.push(node.left,node.right);
 }
 return found;
}

// Centres of the authored harness and helmet, including the same weight-shift
// pivot as Glider.sync. These are visibility probes, not replacement geometry.
export function pilotPoints(controls={}){
 const angle=-(controls.roll||0)*.12,c=Math.cos(angle),s=Math.sin(angle);
 return [[0,-.93,-.54],[0,-.85,.71]].map(([x,y,z])=>[
  x*c-(y+.15)*s+(controls.roll||0)*.35,
  x*s+(y+.15)*c-.15,z-(controls.pitch||0)*.22
 ]);
}

function closestTriangle(p,t,out){
 const ab=t.b.clone().sub(t.a),ac=t.c.clone().sub(t.a),ap=p.clone().sub(t.a),d1=dot(ab,ap),d2=dot(ac,ap);
 if(d1<=0&&d2<=0)return out.copy(t.a);
 const bp=p.clone().sub(t.b),d3=dot(ab,bp),d4=dot(ac,bp);
 if(d3>=0&&d4<=d3)return out.copy(t.b);
 const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0)return out.copy(t.a).addScaledVector(ab,d1/(d1-d3));
 const cp=p.clone().sub(t.c),d5=dot(ab,cp),d6=dot(ac,cp);
 if(d6>=0&&d5<=d6)return out.copy(t.c);
 const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0)return out.copy(t.a).addScaledVector(ac,d2/(d2-d6));
 const va=d3*d6-d5*d4;
 if(va<=0&&d4-d3>=0&&d5-d6>=0)return out.copy(t.b).addScaledVector(t.c.clone().sub(t.b),(d4-d3)/((d4-d3)+(d5-d6)));
 const inv=1/(va+vb+vc);return out.copy(t.a).addScaledVector(ab,vb*inv).addScaledVector(ac,vc*inv);
}

// Closest points of two finite segments. A capsule is a segment swept by a
// sphere, so this preserves the actual thin sail instead of a giant wing box.
function closestSegments(p,q,a,b){
 const d1=q.clone().sub(p),d2=b.clone().sub(a),r=p.clone().sub(a),aa=dot(d1,d1),ee=dot(d2,d2),ff=dot(d2,r);let s=0,t=0;
 if(aa<=1e-12)t=clamp(ff/Math.max(ee,1e-12),0,1);
 else{const cc=dot(d1,r);if(ee<=1e-12)s=clamp(-cc/aa,0,1);
  else{const bb=dot(d1,d2),den=aa*ee-bb*bb;s=den>1e-12?clamp((bb*ff-cc*ee)/den,0,1):0;t=(bb*s+ff)/ee;
   if(t<0){t=0;s=clamp(-cc/aa,0,1);}else if(t>1){t=1;s=clamp((bb-cc)/aa,0,1);}
  }
 }
 return[p.clone().addScaledVector(d1,s),a.clone().addScaledVector(d2,t)];
}
function closestAxisTriangle(a,b,t){
 const delta=b.clone().sub(a),length=delta.length();
 if(length>1e-8){ray.set(a,delta.clone().divideScalar(length));const p=ray.intersectTriangle(t.a,t.b,t.c,false,hit);if(p&&p.distanceTo(a)<=length)return[p.clone(),p.clone()];}
 let pair=[a.clone(),closestTriangle(a,t,new Vector3())],best=pair[0].distanceToSquared(pair[1]);
 const end=[b.clone(),closestTriangle(b,t,new Vector3())];if(end[0].distanceToSquared(end[1])<best){pair=end;best=end[0].distanceToSquared(end[1]);}
 for(const [u,v]of [[t.a,t.b],[t.b,t.c],[t.c,t.a]]){const p=closestSegments(a,b,u,v),d=p[0].distanceToSquared(p[1]);if(d<best){pair=p;best=d;}}
 return pair;
}

export class GliderBody{
 constructor(root,flight){
  this.id='glider';this.flight=flight;this.triangles=[];this.cameraTriangles=[];this.contacts=0;this.lastContact=null;
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert();
  root.traverse(mesh=>{
   if(!mesh.isMesh||!mesh.parent.name.startsWith('Static_'))return;
   const sail=/^Sail(Ivory|Orange|Teal)$/.test(mesh.material.name),opaque=!(mesh.material.opacity<.9);
   if(!sail&&!opaque)return;
   const matrix=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),p=mesh.geometry.attributes.position.array,index=mesh.geometry.index?.array||Array.from({length:p.length/3},(_,i)=>i);
   for(let i=0;i<index.length;i+=3){const vertices=[0,1,2].map(k=>new Vector3(...p.slice(index[i+k]*3,index[i+k]*3+3)).applyMatrix4(matrix));
    const [a,b,c]=vertices,normal=b.clone().sub(a).cross(c.clone().sub(a));if(normal.lengthSq()<1e-14)continue;normal.normalize();
    const triangle={a,b,c,normal,min:[0,1,2].map(k=>Math.min(...vertices.map(v=>xyz(v)[k]))),max:[0,1,2].map(k=>Math.max(...vertices.map(v=>xyz(v)[k])))};
    if(sail)this.triangles.push(triangle);
    if(opaque)this.cameraTriangles.push(triangle);
   }
  });
  this.radius=Math.max(1,...this.triangles.flatMap(t=>[t.a.length(),t.b.length(),t.c.length()]));
  this.rayTree=this.triangles.length?rayTree(this.triangles):null;
  // Camera obstruction includes the aluminium spar and cables. Physical swim
  // contact retains its existing sail surface and force/velocity response.
  this.cameraTree=this.cameraTriangles.length?rayTree(this.cameraTriangles):null;
  this.cameraRadius=Math.max(this.radius,...this.cameraTriangles.flatMap(t=>[t.a.length(),t.b.length(),t.c.length()]));
 }
 local(world){const f=this.flight;return new Vector3(...inverseRotate(f.quaternion,xyz(world).map((n,i)=>n-f.position[i])));}
 cameraNear(world,range=0){return Math.hypot(...xyz(world).map((n,i)=>n-this.flight.position[i]))<=this.cameraRadius+range;}
 pointVelocity(world){const f=this.flight,angular=f.phase==='airborne'?rotate(f.quaternion,f.omega):[0,0,0];return add(f.velocity,cross(angular,xyz(world).map((n,i)=>n-f.position[i])));}
 raycastLocal(origin,direction,maxDistance){
  return castTree(this.rayTree,origin,direction,maxDistance);
 }
 raycast(origin,direction,maxDistance){
  const f=this.flight,o=xyz(origin);if(Math.hypot(...o.map((n,i)=>n-f.position[i]))>maxDistance+this.radius)return maxDistance;
  return this.raycastLocal(this.local(origin),new Vector3(...inverseRotate(f.quaternion,xyz(direction))),maxDistance);
 }
 cameraRaycast(origin,direction,maxDistance){
  const f=this.flight,o=xyz(origin);if(Math.hypot(...o.map((n,i)=>n-f.position[i]))>maxDistance+this.cameraRadius)return maxDistance;
  return castTree(this.cameraTree,this.local(origin),new Vector3(...inverseRotate(f.quaternion,xyz(direction))),maxDistance);
 }
 pilotVisible(localEye,controls={}){
  for(const p of pilotPoints(controls)){const origin=new Vector3(...p),direction=localEye.clone().sub(origin),length=direction.length();if(length<.1||this.raycastLocal(origin,direction.divideScalar(length),length)<length-.03)return false;}
  return true;
 }
 resolveCapsule(feet,radius,height,{velocity=null,dt=0,previous=null,head=null,headOnly=false}={}){
  const f=this.flight;if(Math.hypot(...xyz(feet).map((n,i)=>n-f.position[i]))>this.radius+height+radius)return false;
  let moved=false;const initialFeet=feet.clone();
  for(let pass=0;pass<(headOnly?0:3);pass++){
   const a=this.local([feet.x,feet.y+radius,feet.z]),b=this.local([feet.x,feet.y+height-radius,feet.z]);let contact=null;
   for(const t of this.triangles){if([0,1,2].some(k=>Math.max(xyz(a)[k],xyz(b)[k])+radius<t.min[k]||Math.min(xyz(a)[k],xyz(b)[k])-radius>t.max[k]))continue;
    const [axis,surface]=closestAxisTriangle(a,b,t),normal=axis.clone().sub(surface),distance=normal.length();if(distance>=radius)continue;
    let depth=radius-distance;
    if(distance>1e-6)normal.divideScalar(distance);
    else{normal.copy(t.normal);const old=previous?this.local(previous):a.clone().add(b).multiplyScalar(.5);if(dot(old.clone().sub(t.a),normal)<0)normal.negate();depth=radius-Math.min(dot(a.clone().sub(t.a),normal),dot(b.clone().sub(t.a),normal));}
    if(!contact||depth>contact.depth)contact={normal,surface,depth};
   }
   if(!contact)break;moved=true;
   const normal=new Vector3(...rotate(f.quaternion,contact.normal.toArray())),amount=Math.min(height+radius*2,contact.depth+.003);
   feet.addScaledVector(normal,amount);
   const point=new Vector3(...add(f.position,rotate(f.quaternion,contact.surface.toArray()))),bodyVelocity=new Vector3(...this.pointVelocity(point));
   if(velocity){const closing=velocity.clone().sub(bodyVelocity).dot(normal);if(closing<0)velocity.addScaledVector(normal,-closing);}
   this.contacts++;this.lastContact={point:point.toArray(),normal:normal.toArray(),correction:amount,bodyVelocity:bodyVelocity.toArray(),dt};
  }
  if(head&&Number.isFinite(head.radius)&&head.radius>0&&head.radius<.4){
   // The actual swimming skull extends ahead of the upright locomotion capsule.
   // Keep this measured sphere separate and apply its contact to the same body.
   const bodyCorrection=feet.clone().sub(initialFeet);head.center.add(bodyCorrection);
   const old=head.previousCenter?this.local(head.previousCenter.clone().add(bodyCorrection)):this.local(head.center);
   const contactStart=feet.clone();
   for(let pass=0;pass<6;pass++){
    const center=this.local(head.center),sweep=center.clone().sub(old),distance=sweep.length();let contact=null;
    const broad=center.clone().add(old).multiplyScalar(.5),reach=head.radius+distance*.5;
    const triangles=nearbyTriangles(this.cameraTree,broad,reach);let nearest=null,oldNearest=null;
    for(const t of triangles){
     const surface=closestTriangle(center,t,new Vector3()),separation=center.distanceTo(surface);
     if(!nearest||separation<nearest.separation)nearest={t,surface,separation};
     const oldSurface=closestTriangle(old,t,new Vector3()),oldDistance=old.distanceTo(oldSurface);
     if(!oldNearest||oldDistance<oldNearest.separation)oldNearest={t,surface:oldSurface,separation:oldDistance};
    }
    const inside=nearest&&dot(center.clone().sub(nearest.surface),nearest.t.normal)<-1e-7;
    if(nearest&&nearest.separation<head.radius){
     const normal=inside?nearest.t.normal.clone():center.clone().sub(nearest.surface).normalize();
     contact={normal,surface:nearest.surface,depth:head.radius+(inside?nearest.separation:-nearest.separation)};
    }
    // A point already inside a closed foil/frame must leave by its nearest
    // outward face. Retaining its previous side there would trap it between
    // opposing inner faces. Ordinary incoming motion retains swept contact.
    const oldInside=oldNearest&&dot(old.clone().sub(oldNearest.surface),oldNearest.t.normal)<-1e-7;
    if(!inside&&!oldInside&&distance>1e-8){
     let first=distance;ray.set(old,sweep.clone().divideScalar(distance));
     for(const t of triangles){const crossing=ray.intersectTriangle(t.a,t.b,t.c,false,hit);if(!crossing)continue;const travel=crossing.distanceTo(old);if(travel>=first)continue;first=travel;
      const normal=t.normal.clone();if(dot(old.clone().sub(t.a),normal)<0)normal.negate();contact={normal,surface:crossing.clone(),depth:head.radius-dot(center.clone().sub(crossing),normal)};
     }
    }
    if(!contact)break;
    const normal=new Vector3(...rotate(f.quaternion,contact.normal.toArray())),offset=feet.clone().sub(contactStart),along=offset.dot(normal),available=-along+Math.sqrt(Math.max(0,along*along+.65*.65-offset.lengthSq()));
    const amount=Math.min(available,contact.depth+.004),correction=normal.clone().multiplyScalar(amount);
    if(amount<=0)break;
    feet.add(correction);head.center.add(correction);moved=true;
    const point=new Vector3(...add(f.position,rotate(f.quaternion,contact.surface.toArray()))),bodyVelocity=new Vector3(...this.pointVelocity(point));
    if(velocity){const closing=velocity.clone().sub(bodyVelocity).dot(normal);if(closing<0)velocity.addScaledVector(normal,-closing);}
    this.contacts++;this.lastContact={kind:'head',point:point.toArray(),normal:normal.toArray(),correction:amount,bodyVelocity:bodyVelocity.toArray(),radius:head.radius,dt};
   }
  }
  return moved;
 }
}
