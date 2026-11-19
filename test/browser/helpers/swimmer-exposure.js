// Passive observer. Head samples are stratified by actual triangle area, then
// weighted by their projected front-facing area. Casts include every authored
// opaque static glider part, including the spar, with no 2.5 cm endpoint hole.
// This remains a geometric estimate; final whole-frame media is a separate gate.
export function captureSwimmerExposure(options={}){
 const app=options.app||window.__app;
 if(options.stop){const run=window.__swimmerExposure;run.active=false;return{rows:run.rows,startWall:run.startWall,endWall:performance.now()};}
 if(options.start){
  const run={active:true,rows:[],cache:{},lastFrame:-1,startWall:performance.now()};window.__swimmerExposure=run;
  const tick=()=>{if(!run.active)return;if(app.engine.frame!==run.lastFrame){run.lastFrame=app.engine.frame;run.rows.push(captureSwimmerExposure({app,cache:run.cache}));}requestAnimationFrame(tick);};
  requestAnimationFrame(tick);return;
 }
 const cache=options.cache||{},g=app.glider,p=app.player,model=p.avatar?.model,eye=app.camera.position.toArray();
 const add=(a,b)=>a.map((n,i)=>n+b[i]),sub=(a,b)=>a.map((n,i)=>n-b[i]),scale=(a,s)=>a.map(n=>n*s),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const transform=(v,m)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
 const rootInverse=g.model.root.matrixWorld.clone().invert().elements;
 const tree=triangles=>{
  const min=[0,1,2].map(k=>Math.min(...triangles.map(t=>t.min[k]))),max=[0,1,2].map(k=>Math.max(...triangles.map(t=>t.max[k])));
  if(triangles.length<=12)return{min,max,triangles};const extent=max.map((n,i)=>n-min[i]),axis=extent.indexOf(Math.max(...extent));
  const ordered=triangles.slice().sort((a,b)=>a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis]),middle=ordered.length>>1;
  return{min,max,left:tree(ordered.slice(0,middle)),right:tree(ordered.slice(middle))};
 };
 if(cache.glider!==g.model.root){
  const triangles=[];g.model.root.traverse(mesh=>{
   if(!mesh.isMesh||!mesh.parent.name.startsWith('Static_')||mesh.material.opacity<.9)return;
   const data=mesh.geometry.attributes.position.array,index=mesh.geometry.index?.array||Array.from({length:data.length/3},(_,i)=>i),matrix=mesh.matrixWorld.elements;
   const vertices=Array.from({length:data.length/3},(_,i)=>transform(transform(Array.from(data.slice(i*3,i*3+3)),matrix),rootInverse));
   for(let i=0;i<index.length;i+=3){const points=[vertices[index[i]],vertices[index[i+1]],vertices[index[i+2]]];triangles.push({points,name:mesh.material.name,min:[0,1,2].map(k=>Math.min(...points.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...points.map(v=>v[k])))});}
  });cache.glider=g.model.root;cache.tree=tree(triangles);cache.triangleCount=triangles.length;
 }
 const entry=(node,o,d,best)=>{let low=0,high=best;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-12){if(o[k]<node.min[k]||o[k]>node.max[k])return Infinity;continue;}const a=(node.min[k]-o[k])/d[k],b=(node.max[k]-o[k])/d[k];low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(high<low)return Infinity;}return low;};
 const occlusion=point=>{
  const o=transform(point,rootInverse),to=transform(eye,rootInverse),delta=sub(to,o),length=Math.hypot(...delta),d=scale(delta,1/length);let best=length,material=null;
  const pending=[cache.tree];while(pending.length){const node=pending.pop();if(entry(node,o,d,best)>best)continue;
   if(!node.triangles){pending.push(node.left,node.right);continue;}
   for(const t of node.triangles){const[a,b,c]=t.points,e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-10)continue;const inverse=1/det,s=sub(o,a),u=inverse*dot(s,h);if(u<0||u>1)continue;const q=cross(s,e1),v=inverse*dot(d,q);if(v<0||u+v>1)continue;const distance=inverse*dot(e2,q);if(distance>1e-6&&distance<best-1e-6){best=distance;material=t.name;}}
  }return{blocked:material!==null,material,distance:best};
 };
 if(cache.avatar!==model){
  const head=model.gltf.nodes.findIndex(n=>n.name.endsWith('Head')),joint=model.skin.joints.indexOf(head),triangles=[],joints=new Set();let total=0;
  for(const mesh of model.meshes){
   const A=mesh.geometry.attributes,positions=A.position?.array,indices=A.skinIndex?.array,weights=A.skinWeight?.array,index=mesh.geometry.index?.array;if(!positions||!indices||!weights||!index)continue;
   const vertex=i=>({position:Array.from(positions.slice(i*3,i*3+3)),joints:Array.from(indices.slice(i*4,i*4+4)),weights:Array.from(weights.slice(i*4,i*4+4))});
   const influence=i=>{let sum=0;for(let k=0;k<4;k++)if(indices[i*4+k]===joint)sum+=weights[i*4+k];return sum;};
   for(let i=0;i<index.length;i+=3){const ids=Array.from(index.slice(i,i+3));if(ids.some(id=>influence(id)<.45))continue;const vertices=ids.map(vertex),points=vertices.map(v=>v.position),area=Math.hypot(...cross(sub(points[1],points[0]),sub(points[2],points[0])))/2;if(area<1e-10)continue;total+=area;triangles.push({vertices,mesh,total});}
  }
  const samples=[];let at=0;for(let i=0;i<192;i++){const target=total*(i+.5)/192;while(triangles[at].total<target)at++;const t=triangles[at];samples.push(t);for(const v of t.vertices)for(let k=0;k<4;k++)if(v.weights[k])joints.add(v.joints[k]);}
  cache.avatar=model;cache.samples=samples;cache.joints=[...joints].sort((a,b)=>a-b);cache.headTriangles=triangles.length;
 }
 const skin=vertex=>{const result=[0,0,0];for(let k=0;k<4;k++){const weight=vertex.weights[k];if(!weight)continue;const point=transform(vertex.position,model.jointData.subarray(vertex.joints[k]*16,vertex.joints[k]*16+16));for(let i=0;i<3;i++)result[i]+=point[i]*weight;}return result;};
 const project=point=>{const v=transform(point,app.camera.matrixWorldInverse.elements),m=app.camera.projectionMatrix.elements,w=m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15];return{x:(m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12])/w,y:(m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13])/w,front:w>0};};
 let weight=0,visible=0,above=0,aboveVisible=0,front=0,nearFoil=0;const blockedBy={},samples=[];
 for(const sample of cache.samples){
  const points=sample.vertices.map(v=>transform(skin(v),sample.mesh.matrixWorld.elements)),point=scale(add(add(points[0],points[1]),points[2]),1/3),normal=cross(sub(points[1],points[0]),sub(points[2],points[0])),delta=sub(eye,point),distance=Math.hypot(...delta),nlen=Math.hypot(...normal),cosine=dot(normal,delta)/Math.max(1e-15,nlen*distance);
  if(cosine<=0)continue;const w=cosine/(distance*distance),hit=occlusion(point),screen=project(point),onscreen=screen.front&&Math.abs(screen.x)<.95&&Math.abs(screen.y)<.95,water=point[1]>p.waterH-.02;
  weight+=w;front++;if(water)above+=w;if(!hit.blocked&&onscreen){visible+=w;if(water)aboveVisible+=w;}
  if(hit.blocked){blockedBy[hit.material]=(blockedBy[hit.material]||0)+w;if(hit.distance<.03)nearFoil++;}
  samples.push({point,weight:w,blocked:hit.blocked,material:hit.material,distance:hit.distance,screen,aboveWater:water});
 }
 for(const name in blockedBy)blockedBy[name]/=weight;
 const orbit=p.boom?.swimOrbit||p.thirdPersonCamera?.swimOrbit||p.cameraBoom?.swimOrbit;
 return{frame:app.engine?.frame,wall:typeof performance!=='undefined'?performance.now():0,time:g.flight.time,mode:p.mode,view:p.view,avatarVisible:p.avatar?.visible,headHidden:p.avatar?.headHidden,
  player:p.position.toArray(),velocity:p.velocity.toArray(),water:p.waterH,yaw:p.yaw,aircraft:g.flight.position.slice(),quaternion:g.flight.quaternion.slice(),eye,cameraQuaternion:app.camera.quaternion.toArray(),
  orbit:orbit?{angle:orbit.angle,radius:orbit.radius,height:orbit.height,continuing:!!orbit.continuing}:null,contacts:g.body?.contacts||0,
  head:{triangles:cache.headTriangles,samples:192,front,visibleFraction:visible/weight,aboveFraction:above/weight,aboveVisibleFraction:above?aboveVisible/above:1,blockedBy,nearFoil},
  skin:{group:model.group.matrixWorld.elements.slice(),joints:cache.joints.map(index=>({index,matrix:Array.from(model.jointData.subarray(index*16,index*16+16))}))},
  probes:samples,gliderTriangles:cache.triangleCount};
}
