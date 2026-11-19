import {CARRIER} from './Constants.js';
import {insideDeck} from './CarrierPhysics.js';
import {rotate,inverseRotate} from './Math.js';

export const PARKED_FIGHTERS=Object.freeze([[25,-124,.12],[-26,72,.26],[23,112,.05]]);
const xyz=p=>Array.isArray(p)?p:[p.x,p.y,p.z];
// Walking support follows the physical carrier pose. The plane query is a
// vertical world ray, so pitch/roll cannot shift the queried deck underneath it.
export class CarrierDeck{
 constructor(carrier,flight=null){this.id='carrier';this.carrier=carrier;this.flight=flight;}
 simulationBounds(){
  // Encloses every rotated deck vertex and the resolveCapsule query box.
  const p=this.carrier.position,r=Math.max(Math.hypot(65,180,CARRIER.deckY+45),...CARRIER.deckPolygon.map(([x,z])=>Math.hypot(x,CARRIER.deckY,z)))+1;
  return{minX:p[0]-r,maxX:p[0]+r,minZ:p[2]-r,maxZ:p[2]+r};
 }
 world(p){return this.carrier.world(xyz(p));}
 local(p){return this.carrier.local(xyz(p));}
 velocityAt(p){return this.carrier.velocityAt(xyz(p));}
 angularVelocity(){return rotate(this.carrier.quaternion,this.carrier.omega);}
 groundHeightAt(x,z,maxY=Infinity){
  const normal=rotate(this.carrier.quaternion,[0,1,0]);if(normal[1]<.55)return-Infinity;
  const centre=this.world([0,CARRIER.deckY,0]);
  const y=centre[1]-(normal[0]*(x-centre[0])+normal[2]*(z-centre[2]))/normal[1];
  if(y>maxY)return-Infinity;const local=this.local([x,y,z]);return insideDeck(local[0],local[2])?y:-Infinity;
 }
 supportAt(feet,{maxRise=.45,maxDrop=.25}={}){
  const p=xyz(feet),height=this.groundHeightAt(p[0],p[2],p[1]+maxRise);
  if(!Number.isFinite(height)||p[1]-height>maxDrop)return null;
  const position=[p[0],height,p[2]];
  return{provider:this,height,normal:rotate(this.carrier.quaternion,[0,1,0]),velocity:this.velocityAt(position),local:this.local(position)};
 }
 // Coarse solid proxies for the island and aircraft body/gear. These are
 // capsule obstacles, not a claim of mesh-exact aircraft collision.
 boxes(){
  const result=[{center:[27.5,CARRIER.deckY+13.5,1.5],half:[8.5,13.5,28.5],yaw:0}];
  const addJet=(x,y,z,yaw)=>{
   result.push({center:[x,y-.15,z],half:[1.35,1.15,8.5],yaw});
   for(const side of [-1,1]){const s=Math.sin(yaw),c=Math.cos(yaw);result.push({center:[x+side*2.65*c-1.7*s,y-1.05,z-side*2.65*s-1.7*c],half:[.32,.95,.6],yaw});}
  };
  for(const[x,z,yaw]of PARKED_FIGHTERS)addJet(x,CARRIER.deckY+1.92,z,yaw);
  const f=this.flight;if(f){const p=this.local(f.position);if(p[1]>CARRIER.deckY-.5&&p[1]<CARRIER.deckY+5&&insideDeck(p[0],p[2])){const forward=rotate(f.quaternion,[0,0,1]),a=this.local([f.position[0]+forward[0],f.position[1]+forward[1],f.position[2]+forward[2]]);addJet(...p,Math.atan2(a[0]-p[0],a[2]-p[2]));}}
  return result;
 }
 // Camera rays use the same live deck plane and obstacle proxies as support.
 // Rotation preserves a unit ray's distance, so the returned value is world metres.
 raycast(worldOrigin,worldDirection,maxDistance){
  const o=this.local(worldOrigin),d=inverseRotate(this.carrier.quaternion,xyz(worldDirection));let best=maxDistance;
  if(Math.abs(d[1])>1e-10){const t=(CARRIER.deckY-o[1])/d[1];if(t>=0&&t<best&&insideDeck(o[0]+d[0]*t,o[2]+d[2]*t))best=t;}
  for(const b of this.boxes()){
   const c=Math.cos(b.yaw),s=Math.sin(b.yaw),dx=o[0]-b.center[0],dz=o[2]-b.center[2];
   const p=[dx*c-dz*s,o[1]-b.center[1],dx*s+dz*c],v=[d[0]*c-d[2]*s,d[1],d[0]*s+d[2]*c];let low=0,high=best,hit=true;
   for(let axis=0;axis<3;axis++){
    if(Math.abs(v[axis])<1e-10){if(Math.abs(p[axis])>b.half[axis]){hit=false;break;}continue;}
    let a=(-b.half[axis]-p[axis])/v[axis],z=(b.half[axis]-p[axis])/v[axis];if(a>z)[a,z]=[z,a];low=Math.max(low,a);high=Math.min(high,z);if(low>high){hit=false;break;}
   }
   if(hit)best=Math.min(best,low);
  }
  return best;
 }
 resolveCapsule(worldPosition,radius=.3,height=1.75,stepHeight=.4){
  const p=this.local(worldPosition);if(Math.abs(p[0])>65||Math.abs(p[2])>180||p[1]<CARRIER.deckY-4||p[1]>CARRIER.deckY+45)return false;let hit=false;
  for(let pass=0;pass<2;pass++)for(const b of this.boxes()){
   const top=b.center[1]+b.half[1],bottom=b.center[1]-b.half[1];if(top<=p[1]+stepHeight||bottom>=p[1]+height)continue;
   const c=Math.cos(b.yaw),s=Math.sin(b.yaw),dx=p[0]-b.center[0],dz=p[2]-b.center[2],x=dx*c-dz*s,z=dx*s+dz*c,px=b.half[0]+radius-Math.abs(x),pz=b.half[2]+radius-Math.abs(z);
   if(px<=0||pz<=0)continue;hit=true;let mx=0,mz=0;if(px<pz)mx=(Math.sign(x)||1)*px;else mz=(Math.sign(z)||1)*pz;p[0]+=mx*c+mz*s;p[2]+=-mx*s+mz*c;
  }
  const out=this.world(p);if(Array.isArray(worldPosition))worldPosition.splice(0,3,...out);else worldPosition.fromArray(out);return hit;
 }
}
