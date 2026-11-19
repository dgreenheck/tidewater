import { Vector3 } from '../engine/index.js';
const key=(x,z)=>`${Math.floor(x/8)},${Math.floor(z/8)}`;
/** Spatial broadphase for navigation only. Avian owns real contact resolution. */
export class Habitat {
 constructor(terrain,colliders={boxes:[],cylinders:[]},trunks=[],plants={}){this.terrain=terrain;this.colliders=colliders;this.cells=new Map();
  for(const b of colliders.boxes??[])if(b.solid&&!b.prop){const r=Math.hypot(b.half.x,b.half.z);this.insert(b,b.center.x,b.center.z,r);}
  for(const c of colliders.cylinders??[])if(!c.prop)this.insert(c,c.x,c.z,c.radius);
  for(let i=0;i<trunks.length;i+=5){const c={x:trunks[i],z:trunks[i+1],radius:trunks[i+2],yMin:trunks[i+3],yMax:trunks[i+4]};c.tree=true;this.insert(c,c.x,c.z,c.radius);}
  // These are visual navigation/sightline envelopes, not new solid physics bodies.
  for(const [kind,radius,height]of [['bananas',1.8,3],['shrubs',1.6,2],['youngPalms',1.5,2],['monsteras',1.3,1.6],['elephantEars',1.5,2],['heliconias',1.2,1.7],['strelitzias',1.2,1.5]])for(const r of plants[kind]??[]){const scale=r.s??1,c={x:r.x,z:r.z,radius:radius*scale,yMin:r.y??this.ground(r.x,r.z),yMax:(r.y??this.ground(r.x,r.z))+height*scale,foliage:true};this.insert(c,c.x,c.z,c.radius);}
 }
 insert(c,x,z,r){for(let j=Math.floor((z-r)/8);j<=Math.floor((z+r)/8);j++)for(let i=Math.floor((x-r)/8);i<=Math.floor((x+r)/8);i++){const k=`${i},${j}`;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(c);}}
 ground(x,z){return this.terrain.heightAt(x,z);}
 normal(x,z){const d=1;return new Vector3(-(this.ground(x+d,z)-this.ground(x-d,z))/(2*d),1,-(this.ground(x,z+d)-this.ground(x,z-d))/(2*d)).normalize();}
 clear(x,z,spec,water=0){
  const y=this.ground(x,z),normal=this.normal(x,z),radius=Math.hypot(spec.half[0],spec.half[2])+.20;
  if((this.terrain.roads?.clearance(x,z)??Infinity)<radius)return false;
  if(!Number.isFinite(y)||y<Math.max(1.8,water+.35)||Math.hypot(normal.x,normal.z)/normal.y>spec.slope)return false;
  // An animal's full footprint must not bridge a sudden ledge or emerged obstacle.
  for(let j=0;j<8;j++){const a=j*Math.PI/4,h=this.ground(x+Math.cos(a)*radius,z+Math.sin(a)*radius);if(Math.abs(h-y)>radius*spec.slope+.08)return false;}
  const candidates=new Set();for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)for(const c of this.cells.get(key(x+i*8,z+j*8))??[])candidates.add(c);
  for(const c of candidates){if(c.center){if(!c.solid||c.top<y+.10||c.bottom>y+spec.height)continue;const dx=x-c.center.x,dz=z-c.center.z,lx=dx*c.cos-dz*c.sin,lz=dx*c.sin+dz*c.cos;const px=Math.max(-c.half.x,Math.min(c.half.x,lx)),pz=Math.max(-c.half.z,Math.min(c.half.z,lz));if(Math.hypot(lx-px,lz-pz)<radius)return false;}else if(c.yMax>y+.1&&c.yMin<y+spec.height&&Math.hypot(x-c.x,z-c.z)<c.radius+radius)return false;}
  return true;
 }
 segment(a,b,spec,field){const d=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(d/.75));for(let i=1;i<=n;i++){const t=i/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(!this.clear(x,z,spec,field?.waterAt(x,z)??0))return false;}return true;}
 visible(from,to,pad=.25){const length=from.distanceTo(to),n=Math.ceil(length/.3);
  for(let i=1;i<n;i++){const t=i/n,x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,z=from.z+(to.z-from.z)*t;if(y<this.ground(x,z)+pad)return false;
   const candidates=new Set();for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++)for(const c of this.cells.get(key(x+k*8,z+j*8))??[])candidates.add(c);
   for(const c of candidates){if(c.center){if(!c.solid||y<c.bottom-pad||y>c.top+pad)continue;const dx=x-c.center.x,dz=z-c.center.z;if(Math.abs(dx*c.cos-dz*c.sin)<c.half.x+pad&&Math.abs(dx*c.sin+dz*c.cos)<c.half.z+pad)return false;}else if(y>c.yMin-pad&&y<c.yMax+pad&&Math.hypot(x-c.x,z-c.z)<c.radius+pad)return false;}
  }return true;
 }
 chooseSite(preferred,spec,cover){let best=preferred,score=Infinity;
  for(let j=-7;j<=7;j++)for(let i=-7;i<=7;i++){const x=preferred.x+i*8,z=preferred.z+j*8;if(!this.clear(x,z,spec))continue;let clear=0;for(let k=0;k<8;k++){const a=k*Math.PI/4;if(this.clear(x+Math.cos(a)*7,z+Math.sin(a)*7,spec))clear++;}if(clear<5)continue;
   const seen=new Set();for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++)for(const c of this.cells.get(key(x+dx*8,z+dz*8))??[])if((c.tree||c.foliage)&&Math.hypot(c.x-x,c.z-z)<14)seen.add(c);
   const surface=cover?.(x,z)??{},merit=seen.size*22+(surface.forest??0)*60+(surface.sand??0)*12+(8-clear)*14+Math.hypot(x-preferred.x,z-preferred.z)*.08;
   if(merit<score){score=merit;best={x,z};}
  }return best;
 }
 placement(center,count,spec){const result=[];
  for(let i=0;i<1600&&result.length<count;i++){const r=2+Math.sqrt(i)*1.1,a=i*2.3999632297,x=center.x+Math.cos(a)*r,z=center.z+Math.sin(a)*r;if(!this.clear(x,z,spec)||result.some(p=>Math.hypot(p.x-x,p.z-z)<spec.half[2]*2+2))continue;result.push(new Vector3(x,this.ground(x,z)+spec.half[1]+.06,z));}
  if(result.length!==count)throw new Error(`No clear dry habitat for ${count} animals`);return result;
 }
}
