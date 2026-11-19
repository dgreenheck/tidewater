import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Group,Vector3,Matrix4,Ray} from '../src/engine/index.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {loadModel} from '../src/rally/VehicleModel.js';
import {GliderBody} from '../src/glider/GliderBody.js';
import {swimmingHeadContact} from '../src/player/SwimHeadContact.js';

const trace=JSON.parse(await fs.readFile(new URL('./fixtures/glider-contact-visibility.json',import.meta.url),'utf8')).rows;
const bytes=await fs.readFile(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),skin=gltf.skins[0];
const gliderBytes=await fs.readFile(new URL('../public/glider/glider.glb',import.meta.url)),glider=await loadModel('data:model/gltf-binary;base64,'+gliderBytes.toString('base64'));
const headJoint=skin.joints.indexOf(gltf.nodes.findIndex(n=>n.name.endsWith('Head'))),bind=skin.joints.map((_,i)=>new Matrix4().fromArray(skin.inverseBindMatrices,i*16).invert()),meshNode=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined);
function fixture(row){
 const model={gltf,skin,world:new Float32Array(gltf.nodes.length*16),group:new Group()};model.group.matrixAutoUpdate=false;model.group.matrix.fromArray(row.skin.group);model.group.updateMatrixWorld(true);
 for(const joint of row.skin.joints)model.world.set(new Matrix4().fromArray(joint.matrix).multiply(bind[joint.index]).elements,skin.joints[joint.index]*16);
 const player={mode:'swim',view:'third',position:new Vector3(...row.player),velocity:new Vector3(...row.velocity),yaw:row.yaw,avatar:{visible:true,model}};
 const flight={position:row.aircraft.slice(),quaternion:row.quaternion.slice(),velocity:[0,0,0],omega:[0,0,0],phase:'ditched'},body=new GliderBody(glider.root,flight);
 return{player,body};
}
function headEdges(row){
 const matrices=new Map(row.skin.joints.map(j=>[j.index,new Matrix4().fromArray(j.matrix)])),group=new Matrix4().fromArray(row.skin.group),edges=[];
 for(const primitive of gltf.meshes[meshNode.mesh]){
  const A=primitive.attributes,p=A.POSITION.array,j=A.JOINTS_0.array,w=A.WEIGHTS_0.array,vertices=[];
  for(let i=0;i<p.length/3;i++){
   let sum=0,influence=0;for(let k=0;k<4;k++){sum+=w[i*4+k];if(j[i*4+k]===headJoint)influence+=w[i*4+k];}
   if(influence/sum<=.45){vertices.push(null);continue;}
   const point=new Vector3();let complete=true;for(let k=0;k<4;k++)if(w[i*4+k]){const matrix=matrices.get(j[i*4+k]);if(!matrix){complete=false;break;}point.addScaledVector(new Vector3(...p.slice(i*3,i*3+3)).applyMatrix4(matrix),w[i*4+k]/sum);}
   vertices.push(complete?point.applyMatrix4(group):null);
  }
  const seen=new Set(),I=primitive.indices;for(let i=0;i<I.length;i+=3)for(let k=0;k<3;k++){const a=I[i+k],b=I[i+(k+1)%3],key=a<b?a+','+b:b+','+a;if(seen.has(key)||!vertices[a]||!vertices[b])continue;seen.add(key);edges.push([vertices[a],vertices[b]]);}
 }
 return edges;
}
function intersections(body,edges,delta=new Vector3()){
 let count=0;for(const [from,to]of edges){const a=from.clone().add(delta),d=to.clone().sub(from),length=d.length();if(length>1e-8&&body.cameraRaycast(a,d.divideScalar(length),length)<length-1e-6)count++;}return count;
}

test('the authored swimming head envelope covers the real emerged skull across the recorded poses',()=>{
 for(const frame of [800,860,886,890,900,910,925,935]){
  const row=trace.find(r=>r.frame===frame),{player}=fixture(row),shape=swimmingHeadContact(player,player.position,0),edges=headEdges(row);
  assert.ok(shape&&shape.radius>.16&&shape.radius<.22,'envelope must be measured head size, not a larger standing capsule');
  for(const [point]of edges)assert.ok(point.distanceTo(shape.center)<=shape.radius,`frame${frame}: displayed skull is outside its physical envelope`);
 }
});

test('real head contact prevents the captured swimmer skull from passing through sail and metal',()=>{
 let initialCrossings=0;
 for(const frame of [890,892,900,910,935]){
  const row=trace.find(r=>r.frame===frame),prior=trace[trace.indexOf(row)-1],{player,body}=fixture(row),head=swimmingHeadContact(player,player.position,0),edges=headEdges(row),feet=player.position.clone();feet.y-=1.458;
  const before=feet.clone(),velocity=player.velocity.clone();head.previousCenter=swimmingHeadContact(fixture(prior).player,new Vector3(...prior.player),0).center;
  const crossings=intersections(body,edges);initialCrossings+=crossings;assert.ok(crossings>500,'unchanged recorded pose must retain the real overlap');
  body.resolveCapsule(feet,.3,1.75,{velocity,dt:row.time-prior.time,previous:before,head});
  const correction=feet.clone().sub(before),remaining=intersections(body,edges,correction);
  assert.equal(remaining,0,`frame${frame}: ${remaining} actual head edges still cross the authored wreck`);
  assert.ok(correction.length()>0&&correction.length()<.7,'contact must be a finite local correction');
  assert.ok(body.lastContact&&velocity.clone().sub(new Vector3(...body.lastContact.bodyVelocity)).dot(new Vector3(...body.lastContact.normal))>=-1e-7,'head contact removes inward relative motion');
 }
 assert.ok(initialCrossings>4000);
});
