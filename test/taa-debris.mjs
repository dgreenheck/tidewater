import { tempOutput } from './output-path.mjs';
// Real headless WebGPU regression: a correctly moving fragment must not remain
// visible in the newly exposed background at island-viewing distances.
// node test/taa-debris.mjs [output]
import './headless.mjs';
import {writePNG} from './headless.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {worldHarness} from './world-harness.mjs';
import {Material} from '../src/engine/render/Material.js';
import {FullscreenPass} from '../src/engine/render/FullscreenPass.js';
import {RenderTarget} from '../src/engine/gpu/Texture.js';
import {readTexture} from '../src/engine/gpu/Readback.js';
import {setFrameCamera,FrameUniforms} from '../src/engine/render/Frame.js';
import {TemporalUpscale} from '../src/post/TemporalUpscale.js';

const OUT=process.argv[2]||tempOutput( 'tidewater-taa-debris' );
mkdirSync(OUT,{recursive:true});
const W=640,H=360;
const h=await worldHarness({width:W,height:H});
const {E,GPU,scene,camera,mr,rt}=h;
const errors=[];
GPU.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const taa=new TemporalUpscale(()=>rt.texture,rt.depthTexture,rt.textures[1],camera,rt.textures[2]);
taa.setSize(W,H);
const temporalLdr=new RenderTarget(W,H,{colors:['rgba8unorm'],label:'debris-temporal'});
const currentLdr=new RenderTarget(W,H,{colors:['rgba8unorm'],label:'debris-current-reference'});
const display=src=>new FullscreenPass({label:'debris-linear-display',colorFormats:['rgba8unorm'],bindings:{hdr:{texture:src}},code:`
 fn fragment(in:FSIn)->vec4f {
  return vec4f(linearToSrgb(clamp(textureLoad(hdr,vec2i(in.pos.xy),0).rgb,vec3f(0.0),vec3f(1.0))),1.0);
 }`});
const showTemporal=display(()=>taa.texture),showCurrent=display(()=>rt.texture);

// Modest broad texture, equal luminance, different colour. Both surfaces are
// unlit, so only history can leave the former orange panel on green background.
const material=(name,tint,id)=>new Material({name,lit:false,side:'double',surface:`
 let grain=.012*sin(in.P.x*.31)+.008*cos(in.P.y*.47);
 s.albedo=vec3f(${tint.join(',')})+grain;
 `,output:`r.mask=vec4f(${id}.0,0.0,0.0,1.0);`});
const background=new E.Mesh(new E.PlaneGeometry(600,360),material('green-background',[.22,.4,.34],0));
const panel=new E.Mesh(new E.PlaneGeometry(1,1),material('orange-moving-fragment',[.5,.32,.22],1));
scene.add(background,panel);
camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.near=.1;camera.far=20000;camera.fov=55;camera.updateProjectionMatrix();
const prevVP=new E.Matrix4(),prevCam=new E.Vector3();let hasPrev=false;

function frame(){
 GPU.beginFrame();FrameUniforms.fields.frameIndex.value++;
 camera.updateMatrixWorld();taa.advance();const [jx,jy]=taa.jitter();
 setFrameCamera(camera,W,H,{jitterX:-jx,jitterY:jy,prevViewProj:hasPrev?prevVP:null,prevCameraPos:hasPrev?prevCam:null});
 FrameUniforms.fields.outputResolution.value.set(W,H);
 prevVP.copy(FrameUniforms.fields.viewProjNoJitter.value);prevCam.copy(FrameUniforms.fields.cameraPos.value);hasPrev=true;
 mr.render(scene,{camera,kind:'main',colorViews:rt.textures.map(t=>t.view()),colorFormats:rt.formats,
  clearColors:[[.1,.1,.1,1],[0,0,0,0],[0,0,0,0]],depthView:rt.depthTexture.view(),depthFormat:'depth32float',clearDepth:0});
 taa.render();showTemporal.render({colorViews:[temporalLdr.texture]});showCurrent.render({colorViews:[currentLdr.texture]});
 taa.clearViewOffset();taa.endFrame();GPU.submit();
}
const bytes=async t=>new Uint8Array((await readTexture(t)).data);
const half=h=>{const s=h>>15,e=(h>>10)&31,m=h&1023;return (s?-1:1)*(e===31?(m?NaN:Infinity):e?2**(e-15)*(1+m/1024):2**-14*m/1024);};
const masked=(mask,x,y)=>mask[(y*W+x)*4]>127;
function interior(mask,x,y,wanted,margin=2){
 for(let dy=-margin;dy<=margin;dy++)for(let dx=-margin;dx<=margin;dx++)if(masked(mask,x+dx,y+dy)!==wanted)return false;
 return true;
}
function mean(a){return a.reduce((n,v)=>n+v,0)/Math.max(1,a.length);}
function percentile(a,p){const sorted=a.slice().sort((x,y)=>x-y);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;}
const all=[];
for(const distance of [100,200]){
 // The same 32x52-pixel fragment moves 6 pixels/frame at both distances.
 // Its true object-space movement is retained by the production MeshRenderer.
 const metresPerPixel=2*distance*Math.tan(camera.fov*Math.PI/360)/H;
 panel.scale.set(32*metresPerPixel,52*metresPerPixel,1);panel.position.set(-45*metresPerPixel,0,-distance);
 background.position.z=-(distance+50);panel.resetVelocity=true;taa.reset();
 for(let i=0;i<48;i++){frame();await GPU.queue.onSubmittedWorkDone();}
 let previousMask=await bytes(rt.textures[2]);
 const before=await bytes(temporalLdr.texture);writePNG(`${OUT}/${distance}m-before.png`,W,H,before);
 const age=new Uint8Array(W*H),groups={1:[],2:[],4:[],8:[]},control=[],movingVelocity=[],backgroundVelocity=[];
 let newPixels=0;
 for(let f=0;f<20;f++){
  if(f<12)panel.position.x+=6*metresPerPixel;
  frame();
  const temporal=await bytes(temporalLdr.texture),current=await bytes(currentLdr.texture),mask=await bytes(rt.textures[2]);
  const velocity=new Uint16Array((await readTexture(rt.textures[1])).data);
  const heat=new Uint8Array(W*H*4);
  for(let y=3;y<H-3;y++)for(let x=3;x<W-3;x++){
   const p=y*W+x,o=p*4,front=masked(mask,x,y),wasFront=masked(previousMask,x,y);
   if(front)age[p]=0;else if(wasFront)age[p]=1;else if(age[p])age[p]=Math.min(255,age[p]+1);
   const error=(Math.abs(temporal[o]-current[o])+Math.abs(temporal[o+1]-current[o+1])+Math.abs(temporal[o+2]-current[o+2]))/3;
   const speed=Math.hypot(half(velocity[o])*W,half(velocity[o+1])*H);
   assert.ok(Number.isFinite(speed),'GPU motion vectors must remain finite');
   if(age[p]&&groups[age[p]]&&interior(mask,x,y,false)&&y>H/2-21&&y<H/2+21){
    groups[age[p]].push(error);if(age[p]===1)newPixels++;
    heat[o]=Math.min(255,error*16);heat[o+1]=Math.max(0,80-error*4);heat[o+3]=255;
   }
   if(x>160&&x<230&&y>140&&y<220&&interior(mask,x,y,false)&&!age[p]){control.push(error);backgroundVelocity.push(speed);}
   if(f<12&&interior(mask,x,y,true))movingVelocity.push(speed);
  }
  if([0,3,7,11,19].includes(f)){
   const suffix=`${distance}m-frame-${String(f+1).padStart(2,'0')}`;
   writePNG(`${OUT}/${suffix}-taa.png`,W,H,temporal);writePNG(`${OUT}/${suffix}-current.png`,W,H,current);writePNG(`${OUT}/${suffix}-residual.png`,W,H,heat);
  }
  previousMask=mask;
 }
 const result={distance,backgroundDistance:distance+50,newPixels,controlMean:mean(control),controlP95:percentile(control,.95),
  movingPixelsPerFrame:mean(movingVelocity),backgroundPixelsPerFrame:mean(backgroundVelocity),
  exposed:Object.fromEntries(Object.entries(groups).map(([a,v])=>[a,{count:v.length,mean:mean(v),p95:percentile(v,.95)}]))};
 all.push(result);console.log(JSON.stringify(result));
}
const report={width:W,height:H,rendererSHA256:createHash('sha256').update(readFileSync(new URL('../src/post/TemporalUpscale.js',import.meta.url))).digest('hex'),errors,cases:all};
writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');
const failures=[];
for(const r of all){
 if(r.newPixels<1500)failures.push(`${r.distance}m: not enough measured newly exposed background (${r.newPixels})`);
 if(Math.abs(r.movingPixelsPerFrame-6)>.15||r.backgroundPixelsPerFrame>.01)failures.push(`${r.distance}m: fixture motion vectors do not describe the actual movement`);
 if(r.controlMean>1)failures.push(`${r.distance}m: unoccluded reference differs by ${r.controlMean.toFixed(3)} RGB levels`);
 // Three 8-bit display levels is already visible on a flat field. Broad texture
 // and a two-pixel geometry margin keep genuine spatial AA differences smaller.
 for(const age of [1,2,4,8])if(r.exposed[age].mean>3)failures.push(`${r.distance}m: ${age}-frame exposed background retains ${r.exposed[age].mean.toFixed(3)} mean RGB levels (limit 3)`);
}
if(errors.length)failures.push(...errors);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log('PASS: distant moving geometry leaves no persistent silhouette in exposed background');
process.exit(0);
