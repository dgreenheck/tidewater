import test from 'node:test';
import assert from 'node:assert/strict';
import {Glider} from '../src/glider/Glider.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {PerspectiveCamera} from '../src/engine/index.js';
const terrain=new TerrainData();
test('chase camera stays outside the ridge and sees the airborne glider after an ordinary push-out launch',()=>{
 const camera=new PerspectiveCamera(60,16/9,.1,4000),g=new Glider({camera,terrainData:terrain,cameraCut(){}});g.model={};g.active=g.pilot=true;g.flight.launch();
 const env={terrainAt:(x,z)=>terrain.heightAt(x,z),waterAt:()=>0,sample:()=>({wx:2.44,wz:6.55})};let checked=0,minEye=Infinity,minLine=Infinity;
 for(let i=0;i<1200;i++){
  g.flight.controls.pitch=i>=480?1:0;g.flight.step(1/120,env);g.updateCamera(1/120);
  if(g.flight.phase!=='airborne')continue;checked++;const eye=camera.position.toArray(),p=g.flight.position;
  minEye=Math.min(minEye,eye[1]-terrain.heightAt(eye[0],eye[2]));
  for(let j=1;j<=40;j++){const f=j/40,x=p[0]+(eye[0]-p[0])*f,y=p[1]+(eye[1]-p[1])*f,z=p[2]+(eye[2]-p[2])*f;minLine=Math.min(minLine,y-terrain.heightAt(x,z));}
 }
 assert.ok(checked>100);assert.ok(minEye>=1.8,`smoothed camera entered ridge clearance: ${minEye}m`);assert.ok(minLine>.25,`terrain blocked camera-to-wing sightline: ${minLine}m`);
});

// This is the actual airborne pose recorded at frame660 of the real ArrowDown
// browser reproduction. The center ray was clear while the suspended pilot was
// hidden by a launch-ramp plank. Geometry is built by the production station.
import {CoastalRoute} from '../src/world/CoastalRoute.js';
import {Colliders} from '../src/world/Colliders.js';
import {buildStation} from '../src/glider/Station.js';
import {Group,Vector3,Ray} from '../src/engine/index.js';
import {rotate} from '../src/aviation/Math.js';
test('chase camera frames the suspended pilot and wing around the actual station ramp',()=>{
 const t=new TerrainData(),colliders=new Colliders();buildStation({terrainData:t,coastalRoute:new CoastalRoute(t),colliders,scene:new Group(),village:{materials:{wood:{},hard:{},stone:{}}}});
 const camera=new PerspectiveCamera(60,16/9,.1,4000),g=new Glider({camera,terrainData:t,colliders,cameraCut(){}});g.model={};g.active=g.pilot=g.camReady=true;
 camera.position.set(-38.07077639615869,307.88409383025805,-510.9329423211104);g.flight.position=[-43.22634064026852,301.95512454813763,-524.7793148624338];g.flight.quaternion=[.004554242682966036,-.9838362606504257,.025283143218796378,.17721804019893206];g.flight.phase='airborne';g.updateCamera(0);
 for(const local of [[0,0,0],[0,-.9,0],[-4.8,0,-1],[4.8,0,-1]]){
  const offset=rotate(g.flight.quaternion,local),subject=new Vector3(...g.flight.position.map((n,i)=>n+offset[i])),direction=camera.position.clone().sub(subject),length=direction.length();
  assert.ok(colliders.raycast(subject,direction.clone().divideScalar(length),length)>=length-.03,`actual ramp still hides subject ${local}`);
  for(let i=1;i<=80;i++){const p=subject.clone().addScaledVector(direction,i/80);assert.ok(p.y-t.heightAt(p.x,p.z)>.1,`terrain hides subject ${local}`);}
 }
 assert.ok(camera.position.distanceTo(new Vector3(...g.flight.position))>9,'chase lens must stay outside the wing and frame the pilot');
});

import fs from 'node:fs/promises';
import {loadModel} from '../src/rally/VehicleModel.js';
import {GliderBody} from '../src/glider/GliderBody.js';
import {ThirdPersonCamera} from '../src/player/ThirdPersonCamera.js';
const asset=fs.readFile(new URL('../public/glider/glider.glb',import.meta.url)).then(bytes=>loadModel('data:model/gltf-binary;base64,'+bytes.toString('base64')));
test('accelerated sail rays retain exhaustive triangle distances through the full live pose',async()=>{
 const model=await asset,flight={position:[-43.3,-.22,9.6],quaternion:[.19059833367830312,.898788119078234,-.21432809573346948,-.33153530669014597]},body=new GliderBody(model.root,flight),ray=new Ray(),hit=new Vector3();let checkedHits=0;
 for(let i=0;i<240;i++){
  const local=new Vector3(Math.sin(i*1.73)*7,Math.cos(i*.71)*4,Math.sin(i*.37)*6),target=new Vector3(Math.cos(i*.31)*3,.15,Math.sin(i*.83)*2),direction=target.sub(local).normalize();
  if(i%4===0)direction.set(0,i%8===0?-1:1,0);
  let expected=20;ray.set(local,direction);for(const t of body.triangles){const p=ray.intersectTriangle(t.a,t.b,t.c,false,hit);if(p)expected=Math.min(expected,p.distanceTo(local));}
  const origin=new Vector3(...rotate(flight.quaternion,local.toArray())).add(new Vector3(...flight.position)),worldDirection=new Vector3(...rotate(flight.quaternion,direction.toArray()));
  assert.ok(Math.abs(body.raycast(origin,worldDirection,20)-expected)<1e-8,`ray${i} changed the actual triangle hit`);if(expected<20)checkedHits++;
 }
 assert.ok(checkedHits>30);
});
test('ordinary push-out camera keeps a bounded boom and exposes the actual authored pilot at several rendering cadences',async()=>{
 const t=new TerrainData(),colliders=new Colliders();buildStation({terrainData:t,coastalRoute:new CoastalRoute(t),colliders,scene:new Group(),village:{materials:{wood:{},hard:{},stone:{}}}});
 const model=await asset,env={terrainAt:(x,z)=>t.heightAt(x,z),waterAt:()=>0,sample:()=>({wx:2.44,wz:6.55})};
 for(const stride of [1,2,4]){
  const camera=new PerspectiveCamera(60,16/9,.1,4000),g=new Glider({camera,terrainData:t,colliders,cameraCut(){}});g.model=model;g.active=g.pilot=true;g.flight.launch();
  const body=new GliderBody(g.model.root,g.flight);let maxBoom=0,hidden=0,checked=0,maxSpeed=0,last=null;
  for(let i=0;i<1200;i++){
   g.flight.controls.pitch=i>=480?1:0;g.flight.step(1/120,env);if(i%stride)continue;g.updateCamera(stride/120);
   if(g.flight.phase!=='airborne')continue;checked++;
   maxBoom=Math.max(maxBoom,camera.position.distanceTo(new Vector3(...g.flight.position)));
   if(!body.pilotVisible(body.local(camera.position),g.flight.controls))hidden++;
   if(last)maxSpeed=Math.max(maxSpeed,camera.position.distanceTo(last)/(stride/120));last=camera.position.clone();
  }
  assert.ok(checked>100);assert.ok(maxBoom<23,`nominal15m boom grew to ${maxBoom}m at ${120/stride}Hz`);
  assert.equal(hidden,0,'the actual sail must not hide harness or helmet');
  assert.ok(maxSpeed<45,`camera correction exceeded a bounded lateral transition: ${maxSpeed}m/s at ${120/stride}Hz`);
 }
});
test('normal swimming camera sees the nearest authored frame or sail through the registered live obstacle',async()=>{
 const model=await asset,camera=new PerspectiveCamera(60,16/9,.1,4000),t={heightAt:()=>-80},colliders=new Colliders();
 const player={mode:'swim',groundProviders:new Set(),colliders,terrain:t},g=new Glider({camera,terrainData:t,colliders,player,cameraCut(){}});
 g.model=model;g.active=g.pilot=true;g.flight.position=[0,2,0];g.flight.quaternion=[0,0,0,1];g.flight.phase='ditched';g.updateCamera(0);
 const result=new ThirdPersonCamera().cast(player,new Vector3(0,1.1,0),new Vector3(0,1,0),4);
 // The full frame adds a nearer spar before the cloth hit. Compare the live
 // provider boundary with an exhaustive local-space authored triangle ray.
 const body=new GliderBody(model.root,g.flight),ray=new Ray(new Vector3(0,-.9,0),new Vector3(0,1,0)),hit=new Vector3();let expected=4;
 for(const triangle of body.cameraTriangles){const point=ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit);if(point)expected=Math.min(expected,point.distanceTo(ray.origin));}
 assert.ok(expected>.8&&expected<1);assert.ok(Math.abs(result-expected)<1e-8,`swim boom crossed the authored frame, distance ${result}`);
});

test('the ordinary swim camera also detects the authored metal spar across the recorded emerged head',async()=>{
 const model=await asset,flight={position:[-43.35194114139732,-.23985145929044774,9.451167479564626],quaternion:[.19387743701143256,.8950099579523495,-.21800889079630714,-.3374030795914218]},body=new GliderBody(model.root,flight);
 const point=new Vector3(-43.53199115629157,.28864324986525935,9.947041122454849),eye=new Vector3(-41.442420748056385,1.056451177597046,13.304128571869146),direction=eye.clone().sub(point),length=direction.length();
 const player={mode:'swim',colliders:new Colliders(),terrain:{heightAt:()=>-2.7},groundProviders:new Set(),cameraObstacles:new Set([body])};
 const distance=new ThirdPersonCamera().cast(player,point,direction.divideScalar(length),length);
 // Exhaustive independent actual-GLB ray at this captured pose enters the
 // Aluminium spar 0.28293 m from the head. Sail-only collision misses it.
 assert.ok(Math.abs(distance-.2829295690209702)<1e-6,`camera sightline crossed the metal frame at ${distance}m`);
});

test('the camera detects the metal obstruction before the recorded head touches the glider',async()=>{
 // Frame886 has zero actual head-edge intersections with cloth or metal. Its
 // obscuration is therefore a camera-only regression, separate from contact.
 const model=await asset,flight={position:[-43.30436576400269,-.22518479351283438,9.5500678429813],quaternion:[.1936697827211101,.8948048803274119,-.21824732221170395,-.33791174550527914]},body=new GliderBody(model.root,flight);
 const point=new Vector3(-43.05599227581622,.05586186366197077,9.826001712257465),eye=new Vector3(-41.63277847973257,.875426410138607,13.41367192329101),direction=eye.clone().sub(point),length=direction.length();
 const player={mode:'swim',colliders:new Colliders(),terrain:{heightAt:()=>-2.7},groundProviders:new Set(),cameraObstacles:new Set([body])};
 const distance=new ThirdPersonCamera().cast(player,point,direction.divideScalar(length),length);
 assert.ok(Math.abs(distance-.38242826497867377)<1e-6,`the unobstructed skull's view crosses Aluminium at ${distance}m`);
});

test('the normal third-person swim view frames the recorded animated head and neck beside the actual floating sail',async()=>{
 const model=await asset,flight={position:[-43.303113402117006,-.13824341779054805,9.640180563053974],quaternion:[.19059833367830312,.898788119078234,-.21432809573346948,-.33153530669014597],velocity:[0,0,0],omega:[0,0,0],phase:'ditched'},body=new GliderBody(model.root,flight);
 // Actual rendered joint positions from the rejected real W/V swim capture.
 const landmarks=[[-45.670054203076496,.0707091995394617,9.288830183624901],[-45.62618043603981,.07494368389170508,9.342260820645048]];
 const world=new Float64Array(32);for(let i=0;i<2;i++){world[i*16]=world[i*16+5]=world[i*16+10]=world[i*16+15]=1;world.set(landmarks[i],i*16+12);}
 const group=new Group();group.updateMatrixWorld(true);
 const camera=new PerspectiveCamera(60,16/9,.1,4000),player={mode:'swim',floating:true,waterH:.10307371616363525,yaw:.7776129568535725,pitch:0,position:new Vector3(-45.42017776062378,.11594434261668045,9.615822451583494),velocity:new Vector3(),camera,colliders:new Colliders(),terrain:{heightAt:()=>-2.7},cameraObstacles:new Set([body]),groundProviders:new Set(),avatar:{visible:true,view:'third',headHidden:false,model:{gltf:{nodes:[{name:'Bip01 Head'},{name:'Bip01 Neck'}]},world,group}}};
 const boom=new ThirdPersonCamera();camera.position.copy(player.position);camera.position.y+=.162;camera.rotation.set(0,player.yaw,0);boom.apply(player,1/60);camera.updateMatrixWorld(true);
 for(const xyz of landmarks){const p=new Vector3(...xyz),projected=p.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix),d=camera.position.clone().sub(p),length=d.length();
  assert.ok(Math.abs(projected.x)<.85&&Math.abs(projected.y)<.85,`animated avatar was cropped at ${projected.x},${projected.y}`);
  assert.ok(length>2.3,`uncomfortable camera retraction to ${length}m`);assert.ok(body.raycast(p,d.divideScalar(length),length)>=length-.03,'sail hides actual avatar landmark');
 }
 assert.equal(player.yaw,.7776129568535725,'orbit framing must not change walking/swimming input heading');
});

import {Avatar} from '../src/player/Avatar.js';
import {Player} from '../src/player/Player.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {captureSwimmerExposure} from './browser/helpers/swimmer-exposure.js';
import {BufferGeometry,BufferAttribute,Mesh,Matrix4} from '../src/engine/index.js';
import {swimmingHeadContact} from '../src/player/SwimHeadContact.js';

test('the actual contact response and camera keep the recorded emerged head readable around cloth and frame',async()=>{
 const model=await asset,trace=JSON.parse(await fs.readFile(new URL('./fixtures/glider-contact-visibility.json',import.meta.url),'utf8')).rows;
 const bytes=await fs.readFile(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),skin=gltf.skins[0];
 const m={gltf,skin,jointData:new Float32Array(skin.joints.length*32),world:new Float32Array(gltf.nodes.length*16),group:new Group(),meshes:[]};m.group.matrixAutoUpdate=false;
 const bind=skin.joints.map((_,i)=>new Matrix4().fromArray(skin.inverseBindMatrices,i*16).invert()),meshNode=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined);
 // The captured real uploaded joint matrices are replayed unchanged. Only GPU
 // upload is omitted; observer geometry retains the actual index/weight data.
 for(const primitive of gltf.meshes[meshNode.mesh]){
  const a=primitive.attributes,geometry=new BufferGeometry(),weights=Float32Array.from(a.WEIGHTS_0.array);
  for(let i=0;i<weights.length;i+=4){const sum=weights[i]+weights[i+1]+weights[i+2]+weights[i+3];for(let j=0;j<4;j++)weights[i+j]/=sum;}
  geometry.setAttribute('position',new BufferAttribute(a.POSITION.array,3));geometry.setAttribute('skinIndex',new BufferAttribute(Uint32Array.from(a.JOINTS_0.array),4));geometry.setAttribute('skinWeight',new BufferAttribute(weights,4));geometry.setIndex(new BufferAttribute(primitive.indices,1));
  const mesh=new Mesh(geometry,{});m.meshes.push(mesh);m.group.add(mesh);
 }
 const setPose=row=>{for(const joint of row.skin.joints){m.jointData.set(joint.matrix,joint.index*16);const world=new Matrix4().fromArray(joint.matrix).multiply(bind[joint.index]);m.world.set(world.elements,skin.joints[joint.index]*16);}m.group.matrix.fromArray(row.skin.group);m.group.matrixWorldNeedsUpdate=true;m.group.updateMatrixWorld(true);};
 const first=trace[0],flight={position:first.aircraft.slice(),quaternion:first.quaternion.slice(),time:first.time,velocity:[0,0,0],omega:[0,0,0],phase:'ditched'},body=new GliderBody(model.root,flight),camera=new PerspectiveCamera(60,16/9,.1,4000),boom=new ThirdPersonCamera();
 const player={mode:'swim',view:'third',floating:true,waterH:first.water,yaw:first.yaw,pitch:0,position:new Vector3(...first.player),velocity:new Vector3(),camera,boom,avatar:{visible:true,view:'third',headHidden:false,model:m},colliders:new Colliders(),terrain:{heightAt:()=>-2.7},cameraObstacles:new Set([body]),groundProviders:new Set()};
 const app={player,camera,glider:{flight,model,body},engine:{frame:0}},cache={};
 boom.swimOrbit={...first.orbit,eye:new Vector3(...first.eye),posed:true};boom.swimPose=player.position.clone();
 let longest=0,run=0,worst=1;
 for(let i=1;i<trace.length;i++){
  const row=trace[i],previous=trace[i-1],dt=row.time-previous.time;setPose(previous);player.position.fromArray(row.player);player.velocity.fromArray(row.velocity);player.waterH=row.water;player.yaw=row.yaw;flight.position=row.aircraft.slice();flight.quaternion=row.quaternion.slice();flight.time=row.time;
  model.root.position.fromArray(flight.position);model.root.quaternion.fromArray(flight.quaternion);model.root.updateMatrixWorld(true);
  // Some old captured poses put the skull physically inside the sail. The
  // production contact response must first move that same body and displayed
  // pose. Camera-only visibility is not a valid requirement for intersecting
  // solids. The original controls/skin/aircraft fixtures remain unchanged.
  setPose(row);const head=swimmingHeadContact(player,player.position,0),feet=player.position.clone();feet.y-=1.458;
  const initial=feet.clone();body.resolveCapsule(feet,.3,1.75,{head,previous:feet.clone(),velocity:player.velocity,dt});
  const correction=feet.clone().sub(initial);player.position.add(correction);
  const correctedPose=pose=>{setPose(pose);m.group.matrix.elements[12]+=correction.x;m.group.matrix.elements[13]+=correction.y;m.group.matrix.elements[14]+=correction.z;m.group.matrixWorldNeedsUpdate=true;m.group.updateMatrixWorld(true);};
  correctedPose(previous);camera.position.copy(player.position);camera.position.y+=.162;camera.rotation.set(0,player.yaw,0);boom.apply(player,dt);correctedPose(row);camera.updateMatrixWorld(true);app.engine.frame=row.frame;
  const observation=captureSwimmerExposure({app,cache});worst=Math.min(worst,observation.head.aboveVisibleFraction);
  run=observation.head.aboveFraction>.3&&observation.head.aboveVisibleFraction<.7?run+dt:0;longest=Math.max(longest,run);
 }
 assert.ok(longest<.25,`actual recorded head obscured for ${longest}s; worst emerged projected exposure ${worst}`);
});

test('the real animated swimmer keeps a connected readable camera through the captured wing-contact journey',async()=>{
 const model=await asset,trace=JSON.parse(await fs.readFile(new URL('./fixtures/glider-swim-poses.json',import.meta.url),'utf8')).rows;
 const bytes=await fs.readFile(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 // Only renderer upload and asynchronous asset transport are replaced. Actual
 // Avatar clips, pose blending, joint matrices and Player.updateAvatar run.
 const write=StorageBuffer.prototype.write,assetFile=globalThis.__assetFile;
 StorageBuffer.prototype.write=function(data){this.pendingData=data;};
 globalThis.__assetFile=async url=>{const b=await fs.readFile(new URL('../public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 class PoseAvatar extends Avatar{async load(){}}
 try{
  const avatar=new PoseAvatar(new Group());await avatar.ready;avatar.setup(new SkinnedModel(gltf),gltf,'player.glb');
  const first=trace[0],flight={position:first.aircraft.slice(),quaternion:first.quaternion.slice(),velocity:[0,0,0],omega:[0,0,0],phase:'ditched'},body=new GliderBody(model.root,flight);
  const camera=new PerspectiveCamera(60,16/9,.1,4000),boom=new ThirdPersonCamera(),player={mode:'swim',view:'third',floating:true,grounded:false,waterH:first.water,yaw:first.yaw,pitch:0,position:new Vector3(...first.player),velocity:new Vector3(),camera,avatar,colliders:new Colliders(),terrain:{heightAt:()=>-2.7},cameraObstacles:new Set([body]),groundProviders:new Set(),obstacleProviders:new Set([body]),updateAvatar:Player.prototype.updateAvatar};
  // Independently skin 48 head samples from the GLB. The runtime camera uses
  // 24 samples; this observer does not call its visibility predicate.
  const headNode=gltf.nodes.findIndex(n=>n.name.endsWith('Head')),headJoint=avatar.model.skin.joints.indexOf(headNode),meshNode=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined),vertices=[];
  for(const primitive of gltf.meshes[meshNode.mesh]){const A=primitive.attributes,p=A.POSITION.array,j=A.JOINTS_0.array,w=A.WEIGHTS_0.array;
   for(let i=0;i<p.length/3;i++){let sum=0,influence=0;for(let k=0;k<4;k++){sum+=w[i*4+k];if(j[i*4+k]===headJoint)influence+=w[i*4+k];}if(influence/sum>.45)vertices.push({p:Array.from(p.slice(i*3,i*3+3)),j:Array.from(j.slice(i*4,i*4+4)),w:Array.from(w.slice(i*4,i*4+4),v=>v/sum)});}
  }
  const samples=Array.from({length:48},(_,i)=>vertices[Math.floor(i*vertices.length/48)]);let prior=null,maxSpeed=0,checked=0,visibleAtContact=0;
  for(let i=0;i<480;i++){
   const time=first.time+i/60;let a=first,b=trace.at(-1);for(let k=1;k<trace.length;k++)if(trace[k].time>=time){a=trace[k-1];b=trace[k];break;}
   const fraction=Math.max(0,Math.min(1,(time-a.time)/Math.max(.00001,b.time-a.time))),blend=(key)=>a[key].map((n,k)=>n+(b[key][k]-n)*fraction);
   player.position.fromArray(blend('player'));player.velocity.fromArray(blend('velocity'));player.waterH=a.water+(b.water-a.water)*fraction;flight.position=blend('aircraft');
   if(time>trace.at(-1).time)player.velocity.multiplyScalar(Math.exp(-(time-trace.at(-1).time)*3));
   camera.position.copy(player.position);camera.position.y+=.162;camera.rotation.set(0,player.yaw,0);boom.apply(player,1/60);player.updateAvatar(1/60,{attached:true,hidden:false});camera.updateMatrixWorld(true);avatar.group.updateMatrixWorld(true);
   if(i>60){checked++;
    for(let k=0;k<gltf.nodes.length;k++){if(!/(Head|Neck|Spine2)$/.test(gltf.nodes[k].name))continue;const p=new Vector3().fromArray(avatar.model.world,k*16+12).applyMatrix4(avatar.model.group.matrixWorld),screen=p.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
     assert.ok(Math.abs(screen.x)<.85&&Math.abs(screen.y)<.85,`animated ${gltf.nodes[k].name} left frame at ${time}s`);assert.ok(p.distanceTo(camera.position)>2.3);
    }
    if(prior)maxSpeed=Math.max(maxSpeed,camera.position.distanceTo(prior)*60);
    if(time>=13.8||time>=10.1&&time<=10.4){let exposed=0;for(const v of samples){const p=new Vector3(),D=avatar.model.jointData;for(let k=0;k<4;k++){const o=v.j[k]*16,[x,y,z]=v.p,w=v.w[k];p.x+=(D[o]*x+D[o+4]*y+D[o+8]*z+D[o+12])*w;p.y+=(D[o+1]*x+D[o+5]*y+D[o+9]*z+D[o+13])*w;p.z+=(D[o+2]*x+D[o+6]*y+D[o+10]*z+D[o+14])*w;}p.applyMatrix4(avatar.model.group.matrixWorld);const direction=camera.position.clone().sub(p),length=direction.length();if(body.raycast(p,direction.divideScalar(length),length)>=length-.03)exposed++;}
     assert.ok(exposed/48>.7,`only ${exposed}/48 actual head surface samples exposed at ${time}s`);if(time>=13.8)visibleAtContact++;
    }
   }
   prior=camera.position.clone();
  }
  assert.ok(checked>400&&visibleAtContact>80);assert.ok(maxSpeed<25,`camera fallback jumped at ${maxSpeed}m/s`);assert.equal(player.yaw,first.yaw);
 }finally{StorageBuffer.prototype.write=write;if(assetFile===undefined)delete globalThis.__assetFile;else globalThis.__assetFile=assetFile;}
});

test('the first visible avatar after hidden flight is placed at the local exit while ordinary wading stays continuous',async()=>{
 const bytes=await fs.readFile(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const write=StorageBuffer.prototype.write,assetFile=globalThis.__assetFile;StorageBuffer.prototype.write=function(data){this.pendingData=data;};
 globalThis.__assetFile=async url=>{const b=await fs.readFile(new URL('../public'+url,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 class PoseAvatar extends Avatar{async load(){}}
 try{
  const avatar=new PoseAvatar(new Group());await avatar.ready;avatar.setup(new SkinnedModel(gltf),gltf,'player.glb');
  const camera=new PerspectiveCamera(60,16/9,.1,4000),player={mode:'walk',view:'third',floating:true,grounded:true,waterH:0,yaw:Math.PI,pitch:0,position:new Vector3(54,4,-74),velocity:new Vector3(),camera,avatar,obstacleProviders:new Set(),updateAvatar:Player.prototype.updateAvatar};
  camera.position.set(54,6,-69);for(let i=0;i<60;i++)player.updateAvatar(1/60,{attached:true,hidden:false});
  player.mode='glider';player.position.set(-42.402858667983466,-.03583193866978741,9.813944012458235);
  for(let i=0;i<450;i++)player.updateAvatar(1/60,{attached:true,hidden:true});
  // Recorded real X exit after the banked ditch. The physical float point and
  // water are unchanged; only the previously hidden character reappears here.
  player.mode='swim';player.grounded=false;player.position.set(-43.78335332440973,-.062,11.075990987515553);player.yaw=.7948429230878071;
  camera.position.set(-41.75072540635288,.85,14.521048860285742);camera.lookAt(player.position.clone().add(new Vector3(0,.16,0)));camera.updateMatrixWorld(true);
  player.updateAvatar(1/60,{attached:true,hidden:false});avatar.group.updateMatrixWorld(true);
  const headNode=gltf.nodes.findIndex(n=>n.name.endsWith('Head')),head=new Vector3().fromArray(avatar.model.world,headNode*16+12).applyMatrix4(avatar.group.matrixWorld);
  assert.ok(Math.hypot(head.x-player.position.x,head.z-player.position.z)<.3,`first visible head is still ${head.distanceTo(player.position)}m from the local exit`);
  assert.equal(avatar.visible,true);const screen=head.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);assert.ok(Math.abs(screen.x)<.85&&Math.abs(screen.y)<.85);
  // A normal visible walk into water must keep its existing placement blend.
  // This catches clearing the history every frame instead of only while hidden.
  const wader=new PoseAvatar(new Group());await wader.ready;wader.setup(new SkinnedModel(gltf),gltf,'player.glb');player.avatar=wader;player.mode='walk';player.grounded=true;player.position.set(0,0,0);camera.position.set(0,2,4);
  for(let i=0;i<30;i++)player.updateAvatar(1/60,{attached:true,hidden:false});
  const previous=wader.group.position.clone();player.mode='swim';player.grounded=false;player.position.y=.062;player.updateAvatar(1/60,{attached:true,hidden:false});
  assert.ok(wader.group.position.distanceTo(previous)<.2,'ordinary visible wading must retain the smooth placement transition');
  assert.ok(wader._off.length()>1,'visible land-to-water transition was unexpectedly snapped');
 }finally{StorageBuffer.prototype.write=write;if(assetFile===undefined)delete globalThis.__assetFile;else globalThis.__assetFile=assetFile;}
});

// The contact sphere has already cleared these displayed poses. Final framing
// must use that same new pose, rather than the one preceding animation/contact.
test('Player finalizes the nearby wreck camera after the actual displayed contact pose',async()=>{
 const model=await asset,trace=JSON.parse(await fs.readFile(new URL('./fixtures/glider-contact-post-pose.json',import.meta.url),'utf8')).rows;
 const bytes=await fs.readFile(new URL('../public/models/characters/player.glb',import.meta.url)),gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),skin=gltf.skins[0];
 const m={gltf,skin,jointData:new Float32Array(skin.joints.length*32),world:new Float32Array(gltf.nodes.length*16),group:new Group(),meshes:[]};m.group.matrixAutoUpdate=false;
 const bind=skin.joints.map((_,i)=>new Matrix4().fromArray(skin.inverseBindMatrices,i*16).invert()),meshNode=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined);
 for(const primitive of gltf.meshes[meshNode.mesh]){
  const a=primitive.attributes,geometry=new BufferGeometry(),weights=Float32Array.from(a.WEIGHTS_0.array);
  for(let i=0;i<weights.length;i+=4){const sum=weights[i]+weights[i+1]+weights[i+2]+weights[i+3];for(let k=0;k<4;k++)weights[i+k]/=sum;}
  geometry.setAttribute('position',new BufferAttribute(a.POSITION.array,3));geometry.setAttribute('skinIndex',new BufferAttribute(Uint32Array.from(a.JOINTS_0.array),4));geometry.setAttribute('skinWeight',new BufferAttribute(weights,4));geometry.setIndex(new BufferAttribute(primitive.indices,1));
  const mesh=new Mesh(geometry,{});m.meshes.push(mesh);m.group.add(mesh);
 }
 const setPose=row=>{for(const joint of row.skin.joints){m.jointData.set(joint.matrix,joint.index*16);m.world.set(new Matrix4().fromArray(joint.matrix).multiply(bind[joint.index]).elements,skin.joints[joint.index]*16);}m.group.matrix.fromArray(row.skin.group);m.group.matrixWorldNeedsUpdate=true;m.group.updateMatrixWorld(true);};
 const first=trace[0],flight={position:first.aircraft.slice(),quaternion:first.quaternion.slice(),time:first.time},body=new GliderBody(model.root,flight),camera=new PerspectiveCamera(60,16/9,.1,4000);
 const input={consumeWheel:()=>0},query={allocate:()=>0},player=new Player({camera,input,query,terrain:{heightAt:()=>-2.7},colliders:new Colliders()});
 player.mode='swim';player.view='third';player.floating=true;player.position.fromArray(first.player);player.velocity.set(0,0,0);player.waterH=first.water;player.yaw=first.yaw;player.cameraObstacles=new Set([body]);
 let current=first;player.avatar={visible:true,headHidden:false,view:'third',group:m.group,model:m,update(){setPose(current);}};
 const app={player,camera,glider:{flight,model,body},engine:{frame:0}},cache={};
 player.boom.swimOrbit={...first.orbit,eye:new Vector3(...first.eye),posed:true};player.boom.swimPose=player.position.clone();setPose(first);
 let longest=0,run=0,endpoint=0;
 for(let i=1;i<trace.length;i++){
  const row=trace[i],previous=trace[i-1],dt=row.time-previous.time;current=row;player.position.fromArray(row.player);player.velocity.fromArray(row.velocity);player.waterH=row.water;player.yaw=row.yaw;flight.position=row.aircraft.slice();flight.quaternion=row.quaternion.slice();flight.time=row.time;
  model.root.position.fromArray(flight.position);model.root.quaternion.fromArray(flight.quaternion);model.root.updateMatrixWorld(true);
  // This is the actual Player call order. Only animation evaluation is replayed
  // from the captured uploaded pose, including its real physical correction.
  camera.position.copy(player.position);camera.position.y+=.162;camera.rotation.set(0,player.yaw,0);player.finishView(dt);player.updateAvatar(dt,{attached:true,hidden:false});camera.updateMatrixWorld(true);app.engine.frame=row.frame;
  const observed=captureSwimmerExposure({app,cache});run=observed.head.aboveFraction>.3&&observed.head.aboveVisibleFraction<.7?run+dt:0;longest=Math.max(longest,run);
  if(row.frame===838)endpoint=observed.head.aboveVisibleFraction;
 }
 assert.ok(endpoint>.7,`the actual failed contact frame838 remains obscured: ${endpoint}`);
 assert.ok(longest<.25,`post-contact head stays obscured for ${longest}s`);
});
