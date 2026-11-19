import { tempOutput } from './output-path.mjs';
// Synthetic GPU regression for the production transported-cloud material.
// The real-control island journey is separately covered by tornado-plume.spec.js.
import './headless.mjs';
import {writePNG} from './headless.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {worldHarness} from './world-harness.mjs';
import {SceneRenderer} from '../src/engine/render/SceneRenderer.js';
import {Material} from '../src/engine/render/Material.js';
import {FullscreenPass} from '../src/engine/render/FullscreenPass.js';
import {RenderTarget} from '../src/engine/gpu/Texture.js';
import {readTexture} from '../src/engine/gpu/Readback.js';
import {setFrameCamera,FrameUniforms} from '../src/engine/render/Frame.js';
import {TemporalUpscale} from '../src/post/TemporalUpscale.js';
import {DisasterField} from '../src/disasters/Field.js';
import {TornadoVisuals} from '../src/disasters/TornadoVisuals.js';

const OUT=process.argv[2]||tempOutput( 'tidewater-plume-gpu' );mkdirSync(OUT,{recursive:true});
const W=640,H=360,{E,GPU,scene,camera,mr}=await worldHarness({width:W,height:H});
const errors=[];GPU.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const renderer=new SceneRenderer(mr,scene,camera);renderer.setSize(W,H);
const rt=renderer.sceneRT,taa=new TemporalUpscale(()=>rt.texture,rt.depthTexture,rt.textures[1],camera,rt.textures[2]);taa.setSize(W,H);
const temporalLdr=new RenderTarget(W,H,{colors:['rgba8unorm']}),currentLdr=new RenderTarget(W,H,{colors:['rgba8unorm']});
const display=src=>new FullscreenPass({label:'plume-linear-display',colorFormats:['rgba8unorm'],bindings:{hdr:{texture:src}},code:`fn fragment(in:FSIn)->vec4f{return vec4f(linearToSrgb(clamp(textureLoad(hdr,vec2i(in.pos.xy),0).rgb,vec3f(0.0),vec3f(1.0))),1.0);}`});
const showTemporal=display(()=>taa.texture),showCurrent=display(()=>rt.texture);
camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.fov=55;camera.updateProjectionMatrix();
const background=new E.Mesh(new E.PlaneGeometry(700,500),new Material({name:'plume-static-background',lit:false,side:'double',color:0x89b9aa}));background.position.z=-180;scene.add(background);
const visual=new TornadoVisuals({scene,camera,sceneRenderer:renderer},new DisasterField(()=>0));
visual.flecks.geometry.instanceCount=0;
visual.cloudMaterial.uniforms.base.value.set(0,0,-100);visual.cloudMaterial.uniforms.flow.value.set(0,1.8,0,0);
const unit=2*100*Math.tan(camera.fov*Math.PI/360)/H;
const parcel={active:true,opacity:6,water:false,condensation:true,p:{x:-70*unit,y:0,z:-100},previous:{x:-70*unit,y:0,z:-100},size:24*unit,previousSize:24*unit,rotation:0,previousRotation:0,seed:.2,v:{x:0,y:0,z:0}};
const prevVP=new E.Matrix4(),prevCam=new E.Vector3();let hasPrev=false;
function frame(){
 GPU.beginFrame();FrameUniforms.fields.frameIndex.value++;camera.updateMatrixWorld();taa.advance();const [jx,jy]=taa.jitter();
 setFrameCamera(camera,W,H,{jitterX:-jx, jitterY:jy,prevViewProj:hasPrev?prevVP:null,prevCameraPos:hasPrev?prevCam:null});FrameUniforms.fields.outputResolution.value.set(W,H);
 prevVP.copy(FrameUniforms.fields.viewProjNoJitter.value);prevCam.copy(FrameUniforms.fields.cameraPos.value);hasPrev=true;
 renderer.render();taa.render();showTemporal.render({colorViews:[temporalLdr.texture]});showCurrent.render({colorViews:[currentLdr.texture]});
 taa.clearViewOffset();taa.endFrame();GPU.submit();visual.settleMotion();
}
const bytes=async t=>new Uint8Array((await readTexture(t)).data);
const half=h=>{const s=h>>15,e=(h>>10)&31,m=h&1023;return (s?-1:1)*(e===31?(m?NaN:Infinity):e?2**(e-15)*(1+m/1024):2**-14*m/1024);};
const mean=a=>a.reduce((n,v)=>n+v,0)/Math.max(1,a.length);
const distance=(a,b,o)=>(Math.abs(a[o]-b[o])+Math.abs(a[o+1]-b[o+1])+Math.abs(a[o+2]-b[o+2]))/3;
frame();const bare=await bytes(currentLdr.texture);
visual.group.visible=true;visual.write(visual.dust,[parcel]);
for(let i=0;i<32;i++)frame();
let previous=await bytes(currentLdr.texture),visible=0;
for(let i=0;i<W*H;i++)if(distance(previous,bare,i*4)>10)visible++;
assert.ok(visible>500,'fixture must actually render a substantial cloud through the production transparent pass');
const ages=new Uint8Array(W*H),coveredEver=new Uint8Array(W*H),groups={1:[],2:[],4:[],8:[]},motion=[],results=[],clearedResidual=[];
for(let f=0;f<30;f++){
 Object.assign(parcel.previous,parcel.p);parcel.previousSize=parcel.size;
 if(f<18){parcel.p.x+=6*unit;parcel.size*=1.007;parcel.opacity=6*(24*unit/parcel.size)**2;visual.cloudMaterial.uniforms.flow.value.set((f+1)/30,1.8,22,0);}
 if(f===22)visual.clear();else if(f<22)visual.write(visual.dust,[parcel]);
 frame();
 const temporal=await bytes(temporalLdr.texture),current=await bytes(currentLdr.texture);
 const velocity=new Uint16Array((await readTexture(rt.textures[1])).data);let maxVelocity=0;
 const sample=[];
 for(let y=3;y<H-3;y++)for(let x=3;x<W-3;x++){
  const p=y*W+x,o=p*4,contrast=distance(current,bare,o),was=distance(previous,bare,o);
  if(contrast>2||was>2)coveredEver[p]=1;
  if(contrast<.8){if(was>2)ages[p]=1;else if(ages[p])ages[p]++;}else ages[p]=0;
  const vx=half(velocity[o])*W,vy=half(velocity[o+1])*H;assert.ok(Number.isFinite(vx)&&Number.isFinite(vy));maxVelocity=Math.max(maxVelocity,Math.hypot(vx,vy));
  if(f<18&&vx>5.5&&Math.abs(y-H/2)<8&&Math.abs(x-(W/2-70+(f+1)*6))<10)motion.push(vx);
  if(groups[ages[p]]&&contrast<.8&&x>150&&x<440&&y>135&&y<225){const error=distance(temporal,current,o);groups[ages[p]].push(error);sample.push(error);}
  if(f===29&&coveredEver[p])clearedResidual.push(distance(temporal,current,o));
 }
 results.push({frame:f+1,maxVelocity,exposedCount:sample.length,exposedMean:mean(sample)});
 if([0,17,21,29].includes(f)){writePNG(`${OUT}/frame-${f+1}-taa.png`,W,H,temporal);writePNG(`${OUT}/frame-${f+1}-current.png`,W,H,current);}
 if(f>=18)assert.ok(maxVelocity<.01,'paused/cleared cloud must not retain stale transport or size velocity');
 previous=current;
}
const exposed=Object.fromEntries(Object.entries(groups).map(([age,a])=>[age,{count:a.length,mean:mean(a)}]));
// The cloud's dedicated channel must preserve the underlying water/underwater
// classification even at high coverage. Use the production mask attachment.
background.material.output='r.mask=vec4f(1.0,1.0,0.0,1.0);';background.material.needsUpdate=true;
visual.group.visible=true;parcel.opacity=6;visual.write(visual.dust,[parcel]);frame();
const mask=await bytes(rt.textures[2]);let waterCoverageSamples=0,waterMaskChanges=0;
for(let p=0;p<W*H;p++){const o=p*4;if(mask[o+2]>2){waterCoverageSamples++;if(mask[o]!==255||mask[o+1]!==255||mask[o+3]!==255)waterMaskChanges++;}}
const clear={count:clearedResidual.length,mean:mean(clearedResidual),max:Math.max(...clearedResidual)};
// Many sub-byte alpha layers can be visibly dense together. Exercise the same
// production material with 160 faint overlapping parcels, then clear it.
background.material.output='';background.material.needsUpdate=true;visual.clear();
for(let i=0;i<10;i++)frame();
const faintBare=await bytes(currentLdr.texture);
const faintParcel={...parcel,opacity:.0015,p:{x:0,y:0,z:-100},previous:{x:0,y:0,z:-100},size:24*unit,previousSize:24*unit};
visual.group.visible=true;visual.write(visual.dust,[faintParcel]);frame();
const singleFaintMask=await bytes(rt.textures[2]);let singleMaskMax=0;
for(let p=0;p<W*H;p++)singleMaskMax=Math.max(singleMaskMax,singleFaintMask[p*4+2]);
const faintLayers=Array.from({length:160},()=>({...faintParcel,p:{...faintParcel.p},previous:{...faintParcel.previous}}));
visual.write(visual.dust,faintLayers);for(let i=0;i<40;i++)frame();
const overlap=await bytes(currentLdr.texture),overlapMask=await bytes(rt.textures[2]),overlapCovered=[];let overlapMaskMax=0;
for(let p=0;p<W*H;p++){overlapMaskMax=Math.max(overlapMaskMax,overlapMask[p*4+2]);if(distance(overlap,faintBare,p*4)>3)overlapCovered.push(p);}
writePNG(`${OUT}/faint-overlap-current.png`,W,H,overlap);
writePNG(`${OUT}/faint-overlap-taa.png`,W,H,await bytes(temporalLdr.texture));
visual.clear();for(let i=0;i<8;i++)frame();
const faintCurrent=await bytes(currentLdr.texture),faintTemporal=await bytes(temporalLdr.texture);
const faintResidual=overlapCovered.map(p=>distance(faintTemporal,faintCurrent,p*4));
writePNG(`${OUT}/faint-clear-current.png`,W,H,faintCurrent);writePNG(`${OUT}/faint-clear-taa.png`,W,H,faintTemporal);
const faintOverlap={layers:160,parcelOpticalDepth:.0015,singleMaskMax,overlapMaskMax,coveredPixels:overlapCovered.length,clearMean:mean(faintResidual),clearMax:Math.max(...faintResidual)};
const report={faintOverlap,width:W,height:H,synthetic:true,productionMaterial:true,visiblePixels:visible,motionSamples:motion.length,meanMovingPixelsPerFrame:mean(motion),exposed,clear,waterCoverageSamples,waterMaskChanges,results,errors};
writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,results:undefined}));
assert.ok(motion.length>100&&Math.abs(mean(motion)-6)<.5,'opaque cloud core motion must follow actual six-pixel translation plus measured spreading');
for(const age of [1,2,4,8]){assert.ok(exposed[age].count>100,`enough newly exposed background at age ${age}`);assert.ok(exposed[age].mean<3,`cloud must not leave a persistent silhouette at age ${age}`);}
assert.ok(clear.count>1000&&clear.mean<1,'eight frames after clear the whole previously covered cloud path must be clean');
assert.ok(waterCoverageSamples>500&&waterMaskChanges===0,'reactive cloud coverage must preserve water and underwater mask channels');
assert.ok(faintOverlap.coveredPixels>250,'faint overlapping clouds must be visibly dense in the actual rendered frame');
assert.ok(faintOverlap.clearMean<1,'faint overlapping clouds must not leave persistent history eight frames after clear');
assert.deepEqual(errors,[]);console.log('PASS: production plume transport, spreading, pause and clear leave finite motion and no persistent exposed-background silhouette');process.exit(0);
