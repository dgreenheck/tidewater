import {BufferAttribute,BufferGeometry,Vector3} from '../engine/index.js';

// Imported GLBs batch many authored objects into one material primitive. A
// triangle's centroid is not a fracture boundary: a 99 m railing face can cross
// ten cells. Clip the actual surface in world X/Z and interpolate its original
// vertex attributes barycentrically. This does not add internal fracture caps.
export function partitionImportedGeometry(mesh,{cellSize=10,minHeight=3.4}={}){
 const source=mesh.geometry,position=source.attributes.position,index=source.index?.array,attributes=Object.entries(source.attributes),parts=new Map(),v=new Vector3();
 const bucket=key=>{let b=parts.get(key);if(!b){b={key,count:0,arrays:attributes.map(()=>[])};parts.set(key,b);}return b;};
 const count=index?.length??position.count;let sourceTriangles=0,splitTriangles=0;
 const interpolate=(a,b,t)=>({p:a.p.map((x,k)=>x+(b.p[k]-x)*t),w:a.w.map((x,k)=>x+(b.w[k]-x)*t)});
 const clip=(polygon,axis,bound,sign)=>{
  const result=[];if(!polygon.length)return result;let a=polygon.at(-1),da=sign*(a.p[axis]-bound);
  for(const b of polygon){const db=sign*(b.p[axis]-bound);if((da<0)!==(db<0)){const p=interpolate(a,b,da/(da-db));p.p[axis]=bound;result.push(p);}if(db>=0)result.push(b);a=b;da=db;}return result;
 };
 for(let t=0;t<count;t+=3){
  const ids=[0,1,2].map(k=>index?.[t+k]??t+k),corners=ids.map((id,k)=>({p:v.fromBufferAttribute(position,id).applyMatrix4(mesh.matrixWorld).toArray(),w:[+(k===0),+(k===1),+(k===2)]}));
  const values=attributes.map(([,a])=>ids.map(id=>Array.from({length:a.itemSize},(_,k)=>a.getComponent(id,k))));
  const emit=(key,tri)=>{const b=bucket(key);for(let j=0;j<attributes.length;j++){const a=b.arrays[j],original=values[j];for(const vertex of tri)for(let k=0;k<attributes[j][1].itemSize;k++)a.push(vertex.w[0]*original[0][k]+vertex.w[1]*original[1][k]+vertex.w[2]*original[2][k]);}b.count+=3;};
  sourceTriangles++;
  // Keep the original eligibility policy. Low foundations remain in their
  // unchanged static surface; this repair only partitions eligible triangles.
  if(corners.reduce((n,c)=>n+c.p[1],0)/3<minHeight){emit(null,corners);continue;}
  const xs=corners.map(c=>c.p[0]),zs=corners.map(c=>c.p[2]),x0=Math.floor(Math.min(...xs)/cellSize),x1=Math.floor(Math.max(...xs)/cellSize),z0=Math.floor(Math.min(...zs)/cellSize),z1=Math.floor(Math.max(...zs)/cellSize);
  if(x0===x1&&z0===z1){emit(`${x0}:${z0}`,corners);continue;}
  splitTriangles++;
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
   let polygon=clip(corners,0,x*cellSize,1);polygon=clip(polygon,0,(x+1)*cellSize,-1);polygon=clip(polygon,2,z*cellSize,1);polygon=clip(polygon,2,(z+1)*cellSize,-1);
   for(let j=1;j<polygon.length-1;j++){
    const tri=[polygon[0],polygon[j],polygon[j+1]],a=tri[1].p.map((x,k)=>x-tri[0].p[k]),b=tri[2].p.map((x,k)=>x-tri[0].p[k]);
    // Boundary-only polygons have no surface area and must not be duplicated.
    if(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])<=1e-12)continue;
    emit(`${x}:${z}`,tri);
   }
  }
 }
 const geometry=new BufferGeometry(),ranges=[];geometry.name=source.name;geometry.userData={...source.userData};const total=[...parts.values()].reduce((n,b)=>n+b.count,0);
 for(let j=0;j<attributes.length;j++){const [name,a]=attributes[j],out=new Float32Array(total*a.itemSize);let at=0;for(const b of parts.values()){out.set(b.arrays[j],at);at+=b.arrays[j].length;}const attr=new BufferAttribute(out,a.itemSize);attr.name=a.name;attr.usage=a.usage;geometry.setAttribute(name,attr);}
 let start=0;for(const b of parts.values()){ranges.push({key:b.key,start,count:b.count});start+=b.count;}
 geometry.computeBoundingSphere();
 return {geometry,ranges,metrics:{sourceTriangles,outputTriangles:total/3,splitTriangles}};
}
