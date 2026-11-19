import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Group,Vector3,PerspectiveCamera} from '../src/engine/index.js';
import {Ray} from '../src/engine/math/Ray.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {Colliders} from '../src/world/Colliders.js';
import {Chairlift} from '../src/chairlift/Chairlift.js';
import {Avatar} from '../src/player/Avatar.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';

const bytes=readFileSync(new URL('../public/models/characters/player.glb',import.meta.url));
const gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const oldWrite=StorageBuffer.prototype.write;
test.after(()=>{StorageBuffer.prototype.write=oldWrite;});
StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};

function fixture(){
 const model=new SkinnedModel(gltf),avatar=Object.create(Avatar.prototype);
 Object.assign(avatar,{group:new Group(),model,rideClips:new Map(),idle:{clip:model.clips.get('idle'),time:0,weight:1,target:1,loop:true,speed:1,fade:.001},_off:new Vector3(),vestOn:false});
 avatar.group.add(model.group);
 avatar.rideClips.set('ski_sit',{clip:model.clips.get('ski_sit'),time:0,weight:0,target:0,loop:true,speed:1,fade:.001});
 const head=gltf.nodes.findIndex(n=>/(^|[\s_:.])head$/i.test(n.name)),neck=gltf.nodes.findIndex(n=>/(^|[\s_:.])neck$/i.test(n.name));
 const under=(i,root)=>{for(let n=i;n>=0;n=model.parent[n])if(n===root)return true;return false;};
 avatar.hideJoints=model.skin.joints.map((n,j)=>under(n,head)||n===neck?j:-1).filter(j=>j>=0);avatar.anchorNode=neck;
 const app={terrainData:new TerrainData(),colliders:new Colliders(),camera:new PerspectiveCamera(62,1.6,.1,5000),input:{consumeLook:()=>({x:0,y:0})},player:{avatar,velocity:new Vector3(),position:new Vector3(),groundProviders:new Set()}};
 const lift=new Chairlift(app);lift.active=true;lift.chairId=0;lift.cameraMode='seat';lift.syncPlayer();
 return {app,lift,avatar,model,head,neck};
}

function renderedBodyTriangles(f){
 const {model,avatar}=f,node=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined),triangles=[];
 for(const prim of gltf.meshes[node.mesh]){
  const A=prim.attributes,P=A.POSITION.array,J=A.JOINTS_0.array,W=A.WEIGHTS_0.array,D=model.jointData,points=[];
  for(let i=0;i<P.length/3;i++){
   const p=[0,0,0],total=W[i*4]+W[i*4+1]+W[i*4+2]+W[i*4+3];
   for(let k=0;k<4;k++){const weight=W[i*4+k]/total,j=J[i*4+k]*16;if(!weight)continue;for(let a=0;a<3;a++)p[a]+=weight*(D[j+a]*P[i*3]+D[j+4+a]*P[i*3+1]+D[j+8+a]*P[i*3+2]+D[j+12+a]);}
   points.push(new Vector3(...p).applyQuaternion(avatar.group.quaternion).add(avatar.group.position));
  }
  for(let i=0;i<prim.indices.length;i+=3)triangles.push([points[prim.indices[i]],points[prim.indices[i+1]],points[prim.indices[i+2]]]);
 }
 return triangles;
}

test('The default seated view clears the actual rendered torso across the native forward frustum',()=>{
 const f=fixture();f.lift.updateAvatar(.5);f.lift.updateCamera(0);assert.equal(f.avatar.headHidden,true);
 const camera=f.app.camera,forward=new Vector3(0,0,-1).applyQuaternion(camera.quaternion),right=new Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new Vector3(0,1,0).applyQuaternion(camera.quaternion),triangles=renderedBodyTriangles(f),hit=new Vector3();let blocked=0;
 for(let y=-4;y<=4;y++)for(let x=-7;x<=7;x++){
  const direction=forward.clone().addScaledVector(right,x/7*Math.tan(camera.fov*Math.PI/360)*camera.aspect).addScaledVector(up,y/4*Math.tan(camera.fov*Math.PI/360)).normalize(),ray=new Ray(camera.position,direction);
  if(triangles.some(t=>{if(!ray.intersectTriangle(...t,false,hit))return false;const delta=hit.clone().sub(camera.position);return delta.dot(forward)>camera.near&&delta.length()<1.5;}))blocked++;
 }
 assert.equal(blocked,0,`${blocked}/135 forward samples are filled by the rider's body`);
});

test('The eye remains above the posed neck through chair tilt, both terminals and the return heading',()=>{
 const f=fixture(),c=f.lift.transport.chairs[0];
 for(const phase of [0,f.lift.site.summit.distance,f.lift.site.length*.75])for(const tilt of [-.45,0,.45]){
  f.lift.transport.phase=phase;c.n={x:Math.sin(tilt),y:-Math.cos(tilt),z:0};f.lift.transport.sync();f.lift.syncPlayer();f.lift.updateAvatar(1/60);f.lift.updateCamera(0);
  const at=f.neck*16,neck=new Vector3(f.model.world[at+12],f.model.world[at+13],f.model.world[at+14]).applyQuaternion(f.avatar.group.quaternion).add(f.avatar.group.position),local=f.app.camera.position.clone().sub(neck).applyQuaternion(f.avatar.group.quaternion.clone().invert());
  assert.ok(local.y>.1&&local.y<.24,`lens must remain above the actual seated neck, observed ${local.y}m`);
  assert.ok(Math.abs(local.x)<.08&&Math.abs(local.z)<.2);
 }
});
