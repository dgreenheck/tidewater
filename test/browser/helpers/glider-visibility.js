// Read-only independent geometry observations for the real renderer. This uses
// the displayed model's vertices/matrices, not the camera's collision helper.
export const gliderVisibility=page=>page.evaluate(()=>{
 const app=window.__app,g=app.glider,p=app.player,eye=app.camera.position.toArray(),triangles=[],pilot=[];
 const transform=(v,m)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
 const subtract=(a,b)=>a.map((n,i)=>n-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 g.model.root.traverse(mesh=>{
  if(!mesh.isMesh)return;const data=mesh.geometry.attributes.position.array,m=mesh.matrixWorld.elements;
  if(/^Pilot_(Harness|Helmet)$/.test(mesh.parent.name)){
   const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.length;i++) {const k=i%3;low[k]=Math.min(low[k],data[i]);high[k]=Math.max(high[k],data[i]);}
   pilot.push({name:mesh.parent.name,point:transform(low.map((v,i)=>(v+high[i])/2),m)});
  }
  if(!mesh.parent.name.startsWith('Static_')||!/^Sail(Ivory|Orange|Teal)$/.test(mesh.material.name))return;
  const indices=mesh.geometry.index?.array||Array.from({length:data.length/3},(_,i)=>i),vertices=Array.from({length:data.length/3},(_,i)=>transform(Array.from(data.slice(i*3,i*3+3)),m));
  for(let i=0;i<indices.length;i+=3)triangles.push([vertices[indices[i]],vertices[indices[i+1]],vertices[indices[i+2]]]);
 });
 const blocked=from=>{
  const delta=subtract(eye,from),length=Math.hypot(...delta),d=delta.map(v=>v/length);
  for(const[a,b,c]of triangles){const e1=subtract(b,a),e2=subtract(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-9)continue;
   const inverse=1/det,s=subtract(from,a),u=inverse*dot(s,h);if(u<0||u>1)continue;const q=cross(s,e1),v=inverse*dot(d,q);if(v<0||u+v>1)continue;
   const t=inverse*dot(e2,q);if(t>.025&&t<length-.025)return true;
  }return false;
 };
 const screen=point=>{
  const v=transform(point,app.camera.matrixWorldInverse.elements),m=app.camera.projectionMatrix.elements,w=m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15];
  return {x:(m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12])/w,y:(m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13])/w,front:w>0};
 };
 const swimmer=[{name:'eyes',point:[p.position.x,p.position.y+.162,p.position.z]}],joints=[],surfaces=[],model=p.avatar?.model;
 if(model){
  model.gltf.nodes.forEach((node,i)=>{if(/(head|neck|hand|spine2)$/i.test(node.name)){const point=transform(Array.from(model.world.slice(i*16+12,i*16+15)),model.group.matrixWorld.elements);joints.push({name:node.name,point,blocked:blocked(point),screen:screen(point),distance:Math.hypot(...subtract(eye,point))});}});
  // Skin actual rendered vertices using this frame's uploaded joint matrices.
  // Joint centres alone cannot establish that the visible head/body is exposed.
  for(const region of ['Head','Spine2']){
   const node=model.gltf.nodes.findIndex(n=>n.name.endsWith(region)),joint=model.skin.joints.indexOf(node),candidates=[];
   for(const mesh of model.meshes){
    const a=mesh.geometry.attributes,positions=a.position?.array,indices=a.skinIndex?.array,weights=a.skinWeight?.array;if(!positions||!indices||!weights)continue;
    for(let i=0;i<positions.length/3;i++){let influence=0;for(let k=0;k<4;k++)if(indices[i*4+k]===joint)influence+=weights[i*4+k];if(influence>.45)candidates.push({mesh,i,positions,indices,weights});}
   }
   const samples=[];
   for(let n=0;n<Math.min(48,candidates.length);n++){
    const c=candidates[Math.floor(n*candidates.length/Math.min(48,candidates.length))],rest=Array.from(c.positions.slice(c.i*3,c.i*3+3)),posed=[0,0,0];
    for(let k=0;k<4;k++){const w=c.weights[c.i*4+k];if(!w)continue;const o=c.indices[c.i*4+k]*16,v=transform(rest,model.jointData.subarray(o,o+16));for(let j=0;j<3;j++)posed[j]+=v[j]*w;}
    const point=transform(posed,c.mesh.matrixWorld.elements);samples.push({point,blocked:blocked(point),screen:screen(point),aboveWater:point[1]>p.waterH-.02});
   }
   surfaces.push({region,candidates:candidates.length,samples});
  }
 }
 return {time:g.flight.time,phase:g.flight.phase,quaternion:g.flight.quaternion.slice(),position:g.flight.position.slice(),eye,boom:Math.hypot(...subtract(eye,g.flight.position)),triangles:triangles.length,
  pilot:pilot.map(v=>({...v,blocked:blocked(v.point),screen:screen(v.point)})),swimmer:swimmer.map(v=>({...v,blocked:blocked(v.point),screen:screen(v.point)})),
  joints,surfaces,avatar:{visible:p.avatar?.visible,view:p.avatar?.view,headHidden:p.avatar?.headHidden},contactCount:g.body?.contacts||0,lastContact:g.body?.lastContact||null,render:[app.sceneRenderer.width,app.sceneRenderer.height],resolution:app.engine.resolution.mode};
});

// Install before the X key, then record the first eight rendered swim updates.
// Waiting until a visibility assertion becomes true would miss a remote avatar
// easing back from the pre-flight island position. This observes uploaded skin
// matrices and the actual mesh transform without changing any product state.
export const watchSwimEntry=page=>page.evaluate(()=>new Promise((resolve,reject)=>{
 const rows=[],app=window.__app;let done=false,lastFrame=-1;
 const timeout=setTimeout(()=>{done=true;reject(new Error('No ordinary X-to-swim entry was observed'));},15000);
 const transform=(v,m)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
 const capture=()=>{
  if(done)return;const p=app.player,a=p.avatar,m=a?.model;
  const frame=app.engine.frame;
  if(p.mode==='swim'&&m&&Number.isFinite(frame)&&frame!==lastFrame){
   lastFrame=frame;
   const node=m.gltf.nodes.findIndex(n=>n.name.endsWith('Head')),joint=m.skin.joints.indexOf(node),candidates=[];
   for(const mesh of m.meshes){const attributes=mesh.geometry.attributes,positions=attributes.position?.array,indices=attributes.skinIndex?.array,weights=attributes.skinWeight?.array;if(!positions||!indices||!weights)continue;
    for(let i=0;i<positions.length/3;i++){let influence=0;for(let k=0;k<4;k++)if(indices[i*4+k]===joint)influence+=weights[i*4+k];if(influence>.45)candidates.push({mesh,i,positions,indices,weights});}
   }
   const points=[];
   for(let n=0;n<Math.min(48,candidates.length);n++){
    const c=candidates[Math.floor(n*candidates.length/Math.min(48,candidates.length))],rest=Array.from(c.positions.slice(c.i*3,c.i*3+3)),posed=[0,0,0];
    for(let k=0;k<4;k++){const weight=c.weights[c.i*4+k];if(!weight)continue;const offset=c.indices[c.i*4+k]*16,v=transform(rest,m.jointData.subarray(offset,offset+16));for(let j=0;j<3;j++)posed[j]+=v[j]*weight;}
    points.push(transform(posed,c.mesh.matrixWorld.elements));
   }
   const centre=[0,0,0];for(const point of points)for(let j=0;j<3;j++)centre[j]+=point[j]/points.length;
   const v=transform(centre,app.camera.matrixWorldInverse.elements),projection=app.camera.projectionMatrix.elements,w=projection[3]*v[0]+projection[7]*v[1]+projection[11]*v[2]+projection[15];
   rows.push({frame,observation:rows.length,time:app.glider.flight.time,player:p.position.toArray(),water:p.waterH,visible:a.visible,headHidden:a.headHidden,view:a.view,
    head:{centre,samples:points.length,yRange:[Math.min(...points.map(q=>q[1])),Math.max(...points.map(q=>q[1]))],screen:{x:(projection[0]*v[0]+projection[4]*v[1]+projection[8]*v[2]+projection[12])/w,y:(projection[1]*v[0]+projection[5]*v[1]+projection[9]*v[2]+projection[13])/w,front:w>0}}});
   if(rows.length===8){done=true;clearTimeout(timeout);resolve(rows);return;}
  }
  requestAnimationFrame(capture);
 };
 requestAnimationFrame(capture);
}));
