import { tempOutput } from './output-path.mjs';
// GPU proof for CPU-batched fragment motion, independently of object transforms.
// node test/geometry-motion-gpu.mjs [output]
import './headless.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {worldHarness} from './world-harness.mjs';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
import {Material} from '../src/engine/render/Material.js';
import {readTexture} from '../src/engine/gpu/Readback.js';
import {setFrameCamera,FrameUniforms} from '../src/engine/render/Frame.js';
import {enableGeometryMotion,commitGeometryMotion} from '../src/engine/render/GeometryMotion.js';
import {saveSpan,drawSpans,restoreSpans} from '../src/disasters/Structures.js';

const OUT=process.argv[2]||tempOutput( 'tidewater-geometry-motion-gpu' );mkdirSync(OUT,{recursive:true});
const W=640,H=360,{E,GPU,scene,camera,rt}=await worldHarness({width:W,height:H});
const mr=new MeshRenderer(),errors=[];
GPU.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.fov=55;camera.updateProjectionMatrix();
const distance=100,metresPerPixel=2*distance*Math.tan(camera.fov*Math.PI/360)/H;
const vertices=[];
function panel(cx){
 const l=(cx-16)*metresPerPixel,r=(cx+16)*metresPerPixel,b=-20*metresPerPixel,t=20*metresPerPixel,z=-distance;
 vertices.push(l,b,z,r,b,z,r,t,z,l,b,z,r,t,z,l,t,z);
}
panel(-40);panel(40);
const geo=new E.BufferGeometry().setAttribute('position',new E.BufferAttribute(new Float32Array(vertices),3));
const mat=new Material({name:'cpu-fragment-motion-proof',lit:false,side:'double',color:0xc08060,output:'r.mask=vec4f(1.0,0.0,0.0,1.0);'});
const mesh=new E.Mesh(geo,mat);mesh.frustumCulled=false;scene.add(mesh);
enableGeometryMotion(geo);
const span=saveSpan({geo,start:0,count:6}),body={origin:new E.Vector3(),spans:[span]},rotation=new E.Quaternion();
const objectMatrix=mesh.matrixWorld.clone();
const half=h=>{const s=h>>15,e=(h>>10)&31,m=h&1023;return (s?-1:1)*(e===31?(m?NaN:Infinity):e?2**(e-15)*(1+m/1024):2**-14*m/1024);};
const results=[];
async function frame(name,expected){
 GPU.beginFrame();FrameUniforms.fields.frameIndex.value++;setFrameCamera(camera,W,H);
 mr.render(scene,{camera,kind:'main',colorViews:rt.textures.map(t=>t.view()),colorFormats:rt.formats,
  clearColors:[[.1,.2,.3,1],[0,0,0,0],[0,0,0,0]],depthView:rt.depthTexture.view(),depthFormat:'depth32float',clearDepth:0});
 GPU.submit();commitGeometryMotion();
 const vel=new Uint16Array((await readTexture(rt.textures[1])).data),mask=new Uint8Array((await readTexture(rt.textures[2])).data);
 const groups=[{n:0,x:0,vx:0,vy:0,maxError:0},{n:0,x:0,vx:0,vy:0,maxError:0}];
 for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
  const o=(y*W+x)*4;if(mask[o]<128)continue;
  let inside=true;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(mask[((y+dy)*W+x+dx)*4]<128)inside=false;
  if(!inside)continue;
  const group=groups[x<W/2?0:1],vx=half(vel[o])*W,vy=half(vel[o+1])*H;
  assert.ok(Number.isFinite(vx)&&Number.isFinite(vy),'GPU vectors must be finite');
  group.n++;group.x+=x+.5;group.vx+=vx;group.vy+=vy;
  group.maxError=Math.max(group.maxError,Math.abs(vx-(x<W/2?expected:0)),Math.abs(vy));
 }
 for(const group of groups){group.x/=group.n;group.vx/=group.n;group.vy/=group.n;}
 const result={name,expected,moving:groups[0],stationary:groups[1]};results.push(result);console.log(JSON.stringify(result));
 assert.deepEqual(mesh.matrixWorld.elements,objectMatrix.elements,'CPU batch moves without changing its object transform');
}
await frame('initial',0);
drawSpans(body,new E.Vector3(6*metresPerPixel,0,0),rotation);await frame('first CPU move',6);
drawSpans(body,new E.Vector3(12*metresPerPixel,0,0),rotation);await frame('second CPU move',6);
await frame('paused',0);
restoreSpans([span]);await frame('restore',-12);
await frame('after restore',0);
await frame('remaining paused',0);
writeFileSync(`${OUT}/report.json`,JSON.stringify({width:W,height:H,distance,errors,results},null,2)+'\n');
const failures=[];
for(const r of results){
 if(r.moving.n<900||r.stationary.n<900)failures.push(`${r.name}: insufficient rendered interior coverage`);
 if(r.moving.maxError>.025||r.stationary.maxError>.005)failures.push(`${r.name}: GPU motion ${r.moving.vx.toFixed(6)} px, expected ${r.expected}; stationary ${r.stationary.vx.toFixed(6)} px`);
}
const x0=results[0].moving.x;
for(const [index,delta] of [[1,6],[2,12],[3,12],[4,0],[5,0],[6,0]])if(Math.abs(results[index].moving.x-x0-delta)>.01)failures.push(`${results[index].name}: visible fragment did not move by the prescribed screen distance`);
if(errors.length)failures.push(...errors);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('PASS: CPU fragment vertices carry actual movement, then zero velocity while paused and after restore');
process.exit(0);
