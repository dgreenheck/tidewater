import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TerrainData} from '../src/world/TerrainData.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {Colliders} from '../src/world/Colliders.js';
import {Group,Vector3,PerspectiveCamera} from '../src/engine/index.js';
import {prepareChairliftSite,LIFT} from '../src/chairlift/Route.js';
import {buildChairlift} from '../src/chairlift/Geometry.js';
import {LiftTransport} from '../src/chairlift/Transport.js';
import {chairRotation,LiftRider} from '../src/chairlift/Rider.js';
import {G} from '../src/core/Globals.js';
import {Avatar} from '../src/player/Avatar.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {spanBounds} from '../src/disasters/Structures.js';

const terrain=new TerrainData(),roads=new CoastalRoute(terrain),site=prepareChairliftSite(terrain,roads);
const app={terrainData:terrain,colliders:new Colliders(),scene:new Group(),village:{materials:{wood:{},hard:{},stone:{},rope:{},roofMetal:{}}}},model=buildChairlift(app,site,{connector:true});
const geo=model.chairs[0].geometry,P=geo.attributes.position.array,I=geo.index.array,points=Array.from({length:P.length/3},(_,i)=>new Vector3().fromArray(P,i*3));
const localMin=new Vector3(Infinity,Infinity,Infinity),localMax=new Vector3(-Infinity,-Infinity,-Infinity);for(const p of points){localMin.min(p);localMax.max(p);}
const localCorners=[];for(const x of [localMin.x,localMax.x])for(const y of [localMin.y,localMax.y])for(const z of [localMin.z,localMax.z])localCorners.push(new Vector3(x,y,z));
const chairShape={points,corners:localCorners,index:I,name:'chair'};

test('Terminal foundation meshes embed across their actual sloping footprint and have matching solid contacts',()=>{
 const bounds=[];
 for(const r of model.records.filter(r=>r.name.endsWith(' terminal'))){const pads=r.spans.filter(s=>s.member?.material==='stone');assert.equal(pads.length,4);for(const span of pads){const b=spanBounds([span]);bounds.push(b);let min=Infinity,max=-Infinity;for(let i=0;i<=20;i++)for(let j=0;j<=20;j++){const along=(i/20-.5)*.7,cross=(j/20-.5)*.7,x=b.center.x+site.forward.x*along+site.right.x*cross,z=b.center.z+site.forward.z*along+site.right.z*cross,h=terrain.heightAt(x,z);min=Math.min(min,h);max=Math.max(max,h);}assert.ok(b.lo.y<min-.1,`${r.name} foundation bottom ${b.lo.y} floats above footprint low ${min}`);assert.ok(b.hi.y>max+.02,`${r.name} foundation top ${b.hi.y} is buried under footprint high ${max}`);}}
 for(const b of bounds){const proxy=app.colliders.boxes.find(p=>p.tag==='chairlift-footing'&&Math.hypot(p.center.x-b.center.x,p.center.z-b.center.z)<.01);assert.ok(proxy,'rendered concrete must have a real contact proxy');assert.ok(Math.abs(proxy.bottom-b.lo.y)<3e-5&&Math.abs(proxy.top-b.hi.y)<3e-5);}
});
// Actual shipped seated GLB and production rider placement. Only the GPU
// upload transport is replaced; animation, skinning and ancestor scale are real.
const bytes=readFileSync(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),priorWrite=StorageBuffer.prototype.write;
let riderShape;
try{
 StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};
 const skin=new SkinnedModel(gltf),avatar=Object.create(Avatar.prototype);Object.assign(avatar,{group:new Group(),model:skin,rideClips:new Map(),idle:{clip:skin.clips.get('idle'),time:0,weight:1,target:1,loop:true,speed:1,fade:.001},_off:new Vector3(),hideJoints:[],vestOn:false});avatar.group.add(skin.group);avatar.rideClips.set('ski_sit',{clip:skin.clips.get('ski_sit'),time:0,weight:0,target:0,loop:true,speed:1,fade:.001});
 const lift={active:true,chairId:0,transport:new LiftTransport(site),cameraMode:'chase',lookPitch:0,app:{player:{avatar,velocity:new Vector3()},camera:new PerspectiveCamera()}},rider=new LiftRider(lift);rider.update(.5);assert.ok(rider.poseAvailable);const at=rider.pelvis*16,origin=[skin.world[at+12],skin.world[at+13],skin.world[at+14]],node=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined),posed=[],indices=[];
 for(const prim of gltf.meshes[node.mesh]){const A=prim.attributes,P=A.POSITION.array,J=A.JOINTS_0.array,W=A.WEIGHTS_0.array,offset=posed.length;for(let i=0;i<P.length/3;i++){const p=[0,0,0],total=W[i*4]+W[i*4+1]+W[i*4+2]+W[i*4+3];for(let k=0;k<4;k++){const weight=W[i*4+k]/total;if(!weight)continue;const j=J[i*4+k]*16,D=skin.jointData;for(let a=0;a<3;a++)p[a]+=weight*(D[j+a]*P[i*3]+D[j+4+a]*P[i*3+1]+D[j+8+a]*P[i*3+2]+D[j+12+a]);}posed.push(new Vector3(...p.map((x,a)=>x-origin[a]+[0,-3.17,-.02][a])));}for(const i of prim.indices)indices.push(offset+i);}
 const lo=new Vector3(Infinity,Infinity,Infinity),hi=new Vector3(-Infinity,-Infinity,-Infinity),corners=[];for(const p of posed){lo.min(p);hi.max(p);}for(const x of [lo.x,hi.x])for(const y of [lo.y,hi.y])for(const z of [lo.z,hi.z])corners.push(new Vector3(x,y,z));riderShape={points:posed,index:indices,corners,name:'posed rider'};
}finally{StorageBuffer.prototype.write=priorWrite;}
const boxes=app.colliders.boxes.filter(b=>b.solid&&site.stations.some(s=>Math.hypot(b.center.x-s.x,b.center.z-s.z)<13));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function inBox(p,b){const dx=p.x-b.center.x,dz=p.z-b.center.z;return [dx*b.cos-dz*b.sin,p.y-b.center.y,dx*b.sin+dz*b.cos];}
function triangleBox(A,B,C,box){
 const p=[inBox(A,box),inBox(B,box),inBox(C,box)],edges=[sub(p[1],p[0]),sub(p[2],p[1]),sub(p[0],p[2])],axes=[[1,0,0],[0,1,0],[0,0,1],cross(edges[0],edges[1]),...edges.flatMap(e=>[[0,-e[2],e[1]],[e[2],0,-e[0]],[-e[1],e[0],0]])];
 for(const a of axes){if(Math.hypot(...a)<1e-10)continue;const d=p.map(v=>dot(v,a)),r=box.half.x*Math.abs(a[0])+box.half.y*Math.abs(a[1])+box.half.z*Math.abs(a[2]);if(Math.min(...d)>r+1e-8||Math.max(...d)<-r-1e-8)return false;}return true;
}
function collision(chair,shape){
 const {points,corners:localCorners,index:I}=shape,q=chairRotation(chair),hook=new Vector3(chair.hook.x,chair.hook.y,chair.hook.z),lo=new Vector3(Infinity,Infinity,Infinity),hi=new Vector3(-Infinity,-Infinity,-Infinity);for(const p of localCorners){const w=p.clone().applyQuaternion(q).add(hook);lo.min(w);hi.max(w);}
 let world;
 for(const b of boxes){if(lo.y>b.top||hi.y<b.bottom||lo.x>b.center.x+b.radius||hi.x<b.center.x-b.radius||lo.z>b.center.z+b.radius||hi.z<b.center.z-b.radius)continue;
  // OBB-local slab rejection keeps the actual triangle check cheap, without
  // turning the empty air around the chair hanger into a solid proxy.
  const corners=localCorners.map(p=>inBox(p.clone().applyQuaternion(q).add(hook),b));let separated=false;for(let a=0;a<3;a++){const half=[b.half.x,b.half.y,b.half.z][a];if(corners.every(p=>p[a]>half)||corners.every(p=>p[a]<-half)){separated=true;break;}}if(separated)continue;
  world??=points.map(p=>p.clone().applyQuaternion(q).add(hook));for(let k=0;k<I.length;k+=3)if(triangleBox(world[I[k]],world[I[k+1]],world[I[k+2]],b))return {shape:shape.name,tag:b.tag,box:b.center.toArray(),triangle:k/3,point:world[I[k]].toArray()};
 }return null;
}

for(const speed of [3,LIFT.maxSpeed])for(const wind of [0,1,-1])test(`All 20 actual chairs and the posed rider clear both terminals at ${speed} m/s in ${wind===0?'zero':wind>0?'ambient':'opposite ambient'} wind`,()=>{
 const transport=new LiftTransport(site),field={sample:()=>({wx:G.windDir.value.x*G.windSpeed.value*wind,wy:0,wz:G.windDir.value.y*G.windSpeed.value*wind})};transport.chairs[0].occupied=true;transport.setSpeed(speed);let inspected=0,maxTilt=0;
 for(const destination of [site.summit,site.base]){transport.requestDock(destination,0);let settled=false;
  for(let frame=0;frame<18000;frame++){transport.advance(1/60,field);for(const c of transport.chairs){maxTilt=Math.max(maxTilt,Math.acos(Math.max(-1,Math.min(1,-c.n.y))));if(!site.stations.some(s=>Math.hypot(c.hook.x-s.x,c.hook.z-s.z)<11))continue;inspected++;for(const shape of c.occupied?[chairShape,riderShape]:[chairShape]){const hit=collision(c,shape);assert.equal(hit,null,`chair${c.id}, t${transport.time.toFixed(4)}, ${JSON.stringify(hit)}, swing${(Math.acos(-c.n.y)*180/Math.PI).toFixed(2)}deg`);}}
   if(transport.docked(transport.chairs[0],destination)){settled=true;break;}}
  assert.ok(settled,'ordinary service must reach a safely stopped destination, not avoid the turn');
 }
 assert.ok(inspected>10000);assert.ok(maxTilt>.2,'the test retains actual driven swing');console.log(JSON.stringify({chairliftTerminal:{speed,wind,inspected,maxTiltDegrees:maxTilt*180/Math.PI,time:transport.time}}));
});
