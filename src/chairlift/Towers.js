import {Vector3,Matrix4} from '../engine/index.js';
import {Part,boxPart} from '../world/village/GeoBuilder.js';

// Each bay bar has its actual middle section in the mesh. Sixteen side triangles
// suffice for the two-section skin; joined ends lie inside the adjacent members.
// Only exposed head-beam ends need caps. Avoid redundant cuts/caps on every brace.
const makeBarPart=capped=>{const p=[],n=[],uv=[],idx=[];for(const side of [-1,1]){
 const half=boxPart(.5,1,1,0,capped?(side<0?1:2):3);
 for(const i of half.idx){idx.push(p.length/3);p.push(half.p[i*3]+side*.25,half.p[i*3+1],half.p[i*3+2]);n.push(...half.n.slice(i*3,i*3+3));uv.push(...half.uv.slice(i*2,i*2+2));}
}return new Part(p,n,uv,idx);};
const barPart=makeBarPart(false),cappedBarPart=makeBarPart(true);
function drawBar(B,b,tint){
 const a=new Vector3(...b.a),end=new Vector3(...b.b),axis=end.clone().sub(a),length=axis.length();if(length<1e-6)return;
 axis.divideScalar(length);const z=new Vector3().crossVectors(axis,Math.abs(axis.y)>.98?new Vector3(1,0,0):new Vector3(0,1,0)).normalize(),y=new Vector3().crossVectors(z,axis);
 const frame=new Matrix4().makeBasis(axis,y,z).scale(new Vector3(length,b.width,b.width));frame.setPosition(a.add(end).multiplyScalar(.5));
 B.add('hard',b.kind==='head'?cappedBarPart:barPart,frame,tint);
}

// An authored lattice, not a certified cableway design. The contact envelope is
// a conservative solid hull per bay; individual open steel gaps are not walkable.
// Each rock/concrete anchor follows its own sampled terrain. No terrain is moved.
export function planLiftTower(terrain,site,tower){
 const headY=tower.y+.75,headLower=headY-1.15,signs=[[-1,-1],[-1,1],[1,1],[1,-1]],pad=.9;
 const world=(along,y,cross)=>[tower.x+site.forward.x*along+site.right.x*cross,y,tower.z+site.forward.z*along+site.right.z*cross];
 const feet=signs.map(([a,c])=>{
  const [x,,z]=world(a*1.8,0,c*1.6),samples=[];
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
   const [sx,,sz]=world(a*1.8+(i/4-.5)*pad,0,c*1.6+(j/4-.5)*pad);
   samples.push({x:sx,z:sz,ground:terrain.heightAt(sx,sz)});
  }
  const ground=terrain.heightAt(x,z),bottom=Math.min(...samples.map(p=>p.ground))-.45,top=Math.max(...samples.map(p=>p.ground))+.22;
  if(top>=headLower)throw new Error('Chairlift tower foundation is above its trussed head');
  return{x,z,ground,bottom,top,width:pad,along:a*1.8,cross:c*1.6,samples};
 });
 const bottom=Math.min(...feet.map(f=>f.top)),n=Math.ceil((headY-bottom)/4);
 const levels=[...new Set([...Array.from({length:n+1},(_,i)=>bottom+(headY-bottom)*i/n),headLower,headY])].sort((a,b)=>a-b);
 const at=(k,y)=>{const f=feet[k],u=(y-f.top)/(headY-f.top),[a,c]=signs[k];return world(f.along*(1-u)+a*.65*u,y,f.cross*(1-u)+c*.65*u);};
 const beam=(a,b,width,kind)=>({a,b,width,kind});
 const legs=feet.map((f,k)=>{const rows=[f.top,...levels.filter(y=>y>f.top)];return rows.slice(1).map((y,i)=>beam(at(k,rows[i]),at(k,y),.20,'leg'));});
 const panels=[],ties=[],pairs=[[0,1],[1,2],[2,3],[3,0]];
 for(let j=1;j<levels.length;j++)for(const [a,b]of pairs){
  const loY=levels[j-1],hiY=levels[j];if(hiY<=Math.max(feet[a].top,feet[b].top))continue;
  const lo=[at(a,Math.max(loY,feet[a].top)),at(b,Math.max(loY,feet[b].top))],hi=[at(a,hiY),at(b,hiY)];
  if(loY<Math.max(feet[a].top,feet[b].top))ties.push(beam(lo[0],lo[1],.10,'foot-tie'));
  panels.push({lo,hi,diagonals:[beam(lo[0],hi[1],.08,'brace'),beam(lo[1],hi[0],.08,'brace')]});
 }
 for(const y of levels)for(const [a,b]of pairs)if(y>=Math.max(feet[a].top,feet[b].top))ties.push(beam(at(a,y),at(b,y),.10,'tie'));
 const headBeams=[];
 for(const a of [-1,1]){
  headBeams.push(beam(world(a*.65,headY,-3.65),world(a*.65,headY,3.65),.20,'head'));
  for(const c of [-1,1]){const k=signs.findIndex(s=>s[0]===a&&s[1]===c);headBeams.push(beam(at(k,headLower),world(a*.65,headY,c*3.65),.14,'head-brace'));}
 }
 for(const c of [-1,1])headBeams.push(beam(world(-.65,headY,c*3.65),world(.65,headY,c*3.65),.16,'head-tie'));
 const hulls=[];
 for(let j=1;j<levels.length;j++){
  const loY=levels[j-1],hiY=levels[j],points=feet.flatMap((f,k)=>hiY>f.top?[at(k,Math.max(loY,f.top)),at(k,hiY)]:[]);if(!points.length)continue;
  const local=points.map(p=>{const dx=p[0]-tower.x,dz=p[2]-tower.z;return[dx*site.right.x+dz*site.right.z,dx*site.forward.x+dz*site.forward.z];});
  const minC=Math.min(...local.map(p=>p[0]))-.14,maxC=Math.max(...local.map(p=>p[0]))+.14,minA=Math.min(...local.map(p=>p[1]))-.14,maxA=Math.max(...local.map(p=>p[1]))+.14;
  hulls.push({center:world((minA+maxA)/2,(loY+hiY)/2,(minC+maxC)/2),half:[(maxC-minC)/2,(hiY-loY)/2,(maxA-minA)/2]});
 }
 return{feet,legs,panels,ties,headBeams,hulls,headY,levels};
}

export function buildLiftTower(B,colliders,terrain,site,tower,{steel,stone,bright}){
 const plan=planLiftTower(terrain,site,tower),yaw=Math.atan2(site.forward.x,site.forward.z);
 for(const f of plan.feet){
  B.box('stone',f.x,(f.bottom+f.top)/2,f.z,f.width,f.top-f.bottom,f.width,{ry:yaw,tint:stone});
  B.box('hard',f.x,f.top+.02,f.z,.38,.04,.38,{ry:yaw,tint:steel});
  colliders.addBox(new Vector3(f.x,(f.bottom+f.top)/2,f.z),new Vector3(f.width/2,(f.top-f.bottom)/2,f.width/2),yaw,{solid:true,tag:'chairlift-tower'});
 }
 for(const b of [...plan.legs.flat(),...plan.panels.flatMap(p=>p.diagonals),...plan.ties,...plan.headBeams])drawBar(B,b,steel);
 for(const h of plan.hulls)colliders.addBox(new Vector3(...h.center),new Vector3(...h.half),yaw,{solid:true,tag:'chairlift-tower'});
 // The two long transverse beams and their lower diagonals support both bogies.
 for(const side of [-1,1])for(const along of [-.45,.45]){
  const x=tower.x+site.right.x*side*3.2+site.forward.x*along,z=tower.z+site.right.z*side*3.2+site.forward.z*along;
  B.cyl('hard',x,tower.y-.17,z,.21,.21,.13,{rz:Math.PI/2,ry:yaw,segs:12,tint:bright});
 }
 return plan;
}
