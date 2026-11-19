import {Part} from '../world/village/GeoBuilder.js';
const direction=(a,b)=>{const x=b.x-a.x,z=b.z-a.z,l=Math.hypot(x,z)||1;return{x:x/l,z:z/l};};
const dot=(a,b)=>a.x*b.x+a.z*b.z;
const normal=u=>({x:u.z,z:-u.x});
const shift=(p,n,d)=>({x:p.x+n.x*d,y:p.y,z:p.z+n.z*d});
function offsetVertex(points,i,width){
 const p=points[i],before=direction(points[Math.max(0,i-1)],p),after=direction(p,points[Math.min(points.length-1,i+1)]);
 const u=i===0?after:i===points.length-1?before:null;if(u)return shift(p,normal(u),width);
 const a=normal(before),b=normal(after),m={x:a.x+b.x,z:a.z+b.z},den=dot(m,b);
 return shift(p,m,width/Math.max(1e-6,den));
}

// An offset polyline is trimmed at the inside of each turn. Retaining every
// centreline sample there would double back through the outgoing walking lane.
export function stairGeometry(site,endIndex,endPoint){
 const points=site.points,vertices=[{...points[0],index:0}],corners=[];
 for(let i=1;i<endIndex;i++){const a=direction(points[i-1],points[i]),b=direction(points[i],points[i+1]);if(dot(a,b)<.999999){vertices.push({...points[i],index:i});corners.push(i);}}
 vertices.push({...endPoint,index:endIndex});const rails=[];
 const breaks=new Set(site.landings.flatMap(l=>[l.start,l.end]));
 for(const side of [-1,1]){
  const joins=vertices.map((_,i)=>offsetVertex(vertices,i,side*site.width*.46)),nodes=[];
  for(let k=0;k<vertices.length-1;k++){
   const a=vertices[k],b=vertices[k+1],u=direction(a,b),n=normal(u),lo=dot({x:joins[k].x-a.x,z:joins[k].z-a.z},u),hi=dot({x:joins[k+1].x-a.x,z:joins[k+1].z-a.z},u);
   nodes.push({...joins[k],index:a.index});
   for(let i=a.index+1;i<b.index;i++){if(i%12&&!breaks.has(i))continue;const p=points[i],along=dot({x:p.x-a.x,z:p.z-a.z},u);if(along<=lo+.03||along>=hi-.03)continue;nodes.push({...shift(p,n,side*site.width*.46),index:i});}
  }
  nodes.push({...joins.at(-1),index:endIndex});for(let i=0;i<nodes.length-1;i++)rails.push({a:nodes[i],b:nodes[i+1],side});
 }
 const landings=[],covered=new Set();
 for(const landing of site.landings){
  const turns=corners.filter(i=>i>landing.start&&i<landing.end);if(!turns.length||landing.end>=endIndex)continue;
  const a=points[landing.start],b=points[landing.end],u=direction(points[Math.max(0,landing.start-1)],a),v=direction(b,points[landing.end+1]);
  const before=points[Math.max(0,landing.start-1)],after=points[landing.end+1];
  const start=shift(a,u,-Math.hypot(a.x-before.x,a.z-before.z)/2-.0125),end=shift(b,v,Math.hypot(after.x-b.x,after.z-b.z)/2+.0125);
  const path=[start,...turns.map(i=>points[i]),end],left=path.map((_,i)=>offsetVertex(path,i,site.width/2)),right=path.map((_,i)=>offsetVertex(path,i,-site.width/2)).reverse();
  landings.push({index:landing.start,end:landing.end,polygon:[...left,...right],height:a.y,axis:u});
  for(let i=landing.start;i<=landing.end;i++)covered.add(i);
 }
 return{rails,landings,covered};
}
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
export function triangulate(polygon){
 const ids=polygon.map((_,i)=>i),area=polygon.reduce((s,p,i)=>s+p.x*polygon[(i+1)%polygon.length].z-p.z*polygon[(i+1)%polygon.length].x,0),sign=Math.sign(area)||1,result=[];
 while(ids.length>3){let found=false;for(let j=0;j<ids.length;j++){
  const a=ids[(j+ids.length-1)%ids.length],b=ids[j],c=ids[(j+1)%ids.length];if(cross(polygon[a],polygon[b],polygon[c])*sign<=1e-9)continue;
  if(ids.some(i=>i!==a&&i!==b&&i!==c&&cross(polygon[a],polygon[b],polygon[i])*sign>=-1e-9&&cross(polygon[b],polygon[c],polygon[i])*sign>=-1e-9&&cross(polygon[c],polygon[a],polygon[i])*sign>=-1e-9))continue;
  result.push([a,b,c]);ids.splice(j,1);found=true;break;
 }if(!found)throw new Error('Stair landing boundary is not a simple polygon');}
 result.push(ids.slice());return result;
}
export function landingPart(polygon,height,thickness=.13){
 const P=[],N=[],UV=[],I=[];
 const face=(vertices,normal)=>{const a=vertices[0],b=vertices[1],c=vertices[2],u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),crossed=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(crossed.reduce((s,n,i)=>s+n*normal[i],0)<0)vertices=vertices.slice().reverse();const base=P.length/3;for(const v of vertices){P.push(...v);N.push(...normal);UV.push(v[0],v[2]);}for(let i=1;i<vertices.length-1;i++)I.push(base,base+i,base+i+1);};
 for(const ids of triangulate(polygon)){face(ids.map(i=>[polygon[i].x,height,polygon[i].z]),[0,1,0]);face(ids.map(i=>[polygon[i].x,height-thickness,polygon[i].z]),[0,-1,0]);}
 const sign=Math.sign(polygon.reduce((s,p,i)=>s+p.x*polygon[(i+1)%polygon.length].z-p.z*polygon[(i+1)%polygon.length].x,0));
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],u=direction(a,b);face([[a.x,height,a.z],[b.x,height,b.z],[b.x,height-thickness,b.z],[a.x,height-thickness,a.z]],[u.z*sign,0,-u.x*sign]);}
 return new Part(P,N,UV,I);
}

// Boxes approximate only the already-authored flat polygon, using narrow
// slices. Union intervals handle the concave inside of a switchback without
// inserting a large invisible rectangle across its opening.
export function landingSlices(landing,step=.28){
 const base=landing.polygon[0],u=landing.axis,n=normal(u),poly=landing.polygon.map(p=>({x:dot({x:p.x-base.x,z:p.z-base.z},n),z:dot({x:p.x-base.x,z:p.z-base.z},u)}));
 const lo=Math.min(...poly.map(p=>p.z)),hi=Math.max(...poly.map(p=>p.z)),count=Math.ceil((hi-lo)/step),length=(hi-lo)/count,out=[];
 const intervals=z=>{const xs=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if((a.z<=z&&b.z>z)||(b.z<=z&&a.z>z))xs.push(a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z));}xs.sort((a,b)=>a-b);const pairs=[];for(let i=0;i<xs.length;i+=2)if(xs[i+1]-xs[i]>.0001)pairs.push([xs[i],xs[i+1]]);return pairs;};
 for(let i=0;i<count;i++){
  const z=lo+(i+.5)*length,all=[...intervals(z-length/2+1e-6),...intervals(z),...intervals(z+length/2-1e-6)].sort((a,b)=>a[0]-b[0]),merged=[];
  for(const r of all){const last=merged.at(-1);if(last&&last[1]>=r[0]-.005)last[1]=Math.max(last[1],r[1]);else merged.push(r.slice());}
  const world=(x)=>[base.x+n.x*x+u.x*z,landing.height,base.z+n.z*x+u.z*z];
  out.push({length,yaw:Math.atan2(u.x,u.z),boxes:merged.map(([a,b])=>({center:world((a+b)/2),width:b-a})),seams:intervals(z).map(([a,b])=>({center:world((a+b)/2),width:b-a}))});
 }
 return out;
}
