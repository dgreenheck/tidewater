import { Group, Mesh, BoxGeometry, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Vector3, Vector4, Sphere } from '../engine/index.js';
import { Material, Texture, LAYERS, GPU } from '../engine/webgpu.js';

const random=n=>{let x=Math.imul(n^0x5bd1e995,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;};

import { TornadoParticles } from './TornadoParticles.js';
export { TornadoParticles } from './TornadoParticles.js';

function noiseTexture(){
 const n=64,data=new Uint8Array(n*n*n);for(let i=0;i<data.length;i++)data[i]=Math.floor(random(i+739)*255);
 return new Texture({label:'tornado-3d-density',width:n,height:n,depth:n,dimension:'3d',format:'r8unorm',data,sampler:'linearRepeat'});
}
function particleGeometry(count,flecks){
 const geo=new InstancedBufferGeometry();
 if(flecks){const box=new BoxGeometry(2,.22,.7);for(const [k,v]of Object.entries(box.attributes))geo.setAttribute(k,v);geo.setIndex(box.index);}
 else{geo.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3));geo.setIndex([0,1,2,0,2,3]);}
 for(const k of ['parcel','previous','details','motion'])geo.setAttribute(k,new InstancedBufferAttribute(new Float32Array(count*4),4));
 geo.instanceCount=count;geo.boundingSphere=new Sphere(new Vector3(),1e6);return geo;
}
const attributes={parcel:'vec4f',previous:'vec4f',details:'vec4f',motion:'vec4f'};

export class TornadoVisuals {
 constructor(app,field){
  this.app=app;this.field=field;this.group=new Group();this.group.name='Tornado volume and advected aerosols';this.group.visible=false;
  this.particles=new TornadoParticles(field);this.noise=noiseTexture();this.stats={mode:'transported-parcel-clouds',drawCalls:2,raySteps:0,triangles:3328,noiseBytes:64*64*64,dust:0,flecks:0,samples:0,bounds:null};
  const depth=()=>app.sceneRenderer.opaqueCopy.depthTexture;
  const dustMaterial=new Material({name:'Transported dust mist and condensate',lit:false,transparent:true,blending:'premultiplied',side:'double',depthWrite:false,depthTest:false,defines:{VELOCITY_COVERAGE:1,TAA_REACTIVE:1},attributes,
   textures:{tornadoNoise:this.noise,tornadoDepth:{texture:depth}},uniforms:{base:['vec3f',new Vector3()],flow:['vec4f',new Vector4()]},varyings:{parcelUV:'vec2f',parcelData:'vec4f',cloud:'vec4f'},
   vertex:/* wgsl */`
    let toCam=normalize(frame.cameraPos-v.parcel.xyz+vec3f(.0001));
    let right=normalize(cross(vec3f(0.0,1.0,0.0),toCam)+vec3f(.0001,0.0,0.0));let up=cross(toCam,right);
    let corner=rotate2(v.position.xy,v.details.w);
    let extent=(right*corner.x+up*corner.y)*v.parcel.w;
    let prevToCam=normalize(frame.prevCameraPos-v.previous.xyz+vec3f(.0001));
    let prevRight=normalize(cross(vec3f(0.0,1.0,0.0),prevToCam)+vec3f(.0001,0.0,0.0));let prevUp=cross(prevToCam,prevRight);
    let prevCorner=rotate2(v.position.xy,v.previous.w);
    let previousExtent=(prevRight*prevCorner.x+prevUp*prevCorner.y)*v.motion.w;
    v.useWorld=true;v.worldPos=v.parcel.xyz+extent;v.prevWorldPos=v.previous.xyz+previousExtent;v.worldNormal=toCam;
    o.parcelUV=v.position.xy;o.parcelData=v.details;o.cloud=vec4f(v.parcel.xyz,v.parcel.w);
    if(v.details.y<=.001){v.worldPos=vec3f(0.0,-1e5,0.0);v.prevWorldPos=v.worldPos;}
   `,
   output:/* wgsl */`
    let uv=in.vs.parcelUV;let rr=dot(uv,uv);if(rr>=1.0){discard;}
    // One advected world-space modulation spans neighbouring cloud parcels.
    // Independent per-billboard noise would average into a smooth column.
    let coordinate=(in.P-mat.base-vec3f(0.0,mat.flow.x*mat.flow.z,0.0))/max(.2,mat.flow.y);
    let noise=textureSampleLevel(tornadoNoise,smpLinearRepeat,coordinate*.0011,0.0).r;
    let fine=textureSampleLevel(tornadoNoise,smpLinearRepeat,coordinate*.0032+vec3f(.23),0.0).r;
    let falloff=exp(-3.4*rr)*(1.0-smoothstep(.62,1.0,rr));
    let pixel=vec2i(clamp(in.pixel*frame.invResolution,vec2f(0.0),vec2f(.9999))*vec2f(textureDimensions(tornadoDepth)));
    let sceneDistance=viewDepth(textureLoad(tornadoDepth,pixel,0));
    let centreDistance=-(frame.view*vec4f(in.vs.cloud.xyz,1.0)).z;
    let halfDepth=in.vs.cloud.w*sqrt(max(.0001,1.0-rr));
    // Integrate a soft cloud chord up to the opaque surface; the centre plane
    // may be behind the wall while the front of the cloud is still visible.
    let visibleChord=smoothstep(-halfDepth,halfDepth,sceneDistance-centreDistance);
    let filament=.15+1.7*smoothstep(.2,.8,noise*.7+fine*.3);
    let opticalDepth=in.vs.parcelData.y*falloff*filament*visibleChord;
    let alpha=1.0-exp(-opticalDepth);if(alpha<.0003){discard;}
    let moisture=clamp(in.vs.parcelData.x,0.0,1.0);
    let tint=mix(vec3f(.13,.099,.061),vec3f(.16,.18,.20),moisture);
    let light=tint+frame.skyIrradiance*.19+frame.sunColor*.013;
    r.color=vec4f(light*alpha,alpha);
    // Cloud coverage has no opaque depth. The dedicated blue mask lets TAA
    // reject cloud history after transport/evaporation without changing water.
    // Preserve a coverage bit for sub-byte layers: their composite can be
    // visible even when each individual alpha quantizes to zero in rgba8.
    r.mask=vec4f(0.0,0.0,max(alpha,1.0/255.0),0.0);
   `});
  this.cloudMaterial=dustMaterial;this.volumeMaterial=dustMaterial; // Compatibility alias: both names describe the same parcel material.
  this.dust=new Mesh(particleGeometry(this.particles.dust.length,false),dustMaterial);this.dust.count=this.particles.dust.length;this.dust.name='Wind-advected dust mist and condensate';this.dust.layers.set(LAYERS.TRANSPARENT);this.dust.renderOrder=15;this.dust.frustumCulled=false;this.group.add(this.dust);
  const fleckMaterial=new Material({name:'Wind-driven leaf and wood flecks',attributes,roughness:1,color:0x5e4c2f,
   vertex:/* wgsl */`
    let spin=rotate2(v.position.xz,v.details.w);let prevSpin=rotate2(v.position.xz,v.previous.w);
    let tilt=rotate2(vec2f(spin.x,v.position.y),v.details.w*1.7);let prevTilt=rotate2(vec2f(prevSpin.x,v.position.y),v.previous.w*1.7);
    v.useWorld=true;v.worldPos=v.parcel.xyz+vec3f(tilt.x,tilt.y,spin.y)*v.parcel.w;v.prevWorldPos=v.previous.xyz+vec3f(prevTilt.x,prevTilt.y,prevSpin.y)*v.parcel.w;
    v.worldNormal=normalize(v.normal);if(v.details.y<.04){v.worldPos=vec3f(0.0,-1e5,0.0);v.prevWorldPos=v.worldPos;}
   `});
  this.flecks=new Mesh(particleGeometry(this.particles.flecks.length,true),fleckMaterial);this.flecks.count=this.particles.flecks.length;this.flecks.name='Force-integrated small litter';this.flecks.frustumCulled=false;this.group.add(this.flecks);
  app.scene.add(this.group);
 }
 clear(completed=false){this.group.visible=false;if(completed)this.particles.complete();else this.particles.clear();for(const mesh of [this.dust,this.flecks]){mesh.geometry.instanceCount=0;}Object.assign(this.stats,{budget:this.particles.snapshot().budget,completedBudget:this.particles.completedBudget,liquidParcels:0,evaporated:0,maxRadius:0,dust:0,flecks:0,samples:0,sourceSamples:0,emitted:0,deposited:0,expired:0,bounds:null});}
 settleMotion(){
  for(const mesh of [this.dust,this.flecks]){
   const a=mesh.geometry.attributes,n=mesh.geometry.instanceCount;
   for(let i=0;i<n;i++){const o=i*4;a.previous.array[o]=a.parcel.array[o];a.previous.array[o+1]=a.parcel.array[o+1];a.previous.array[o+2]=a.parcel.array[o+2];a.previous.array[o+3]=a.details.array[o+3];a.motion.array[o+3]=a.parcel.array[o+3];}
   a.previous.needsUpdate=true;a.motion.needsUpdate=true;
  }
 }
 scheduleMotionCommit(){if(GPU.device&&!this.motionPending){this.motionPending=true;GPU.onSubmit(null,()=>{this.settleMotion();this.motionPending=false;});}}
 write(mesh,parcels){
  const attrs=mesh.geometry.attributes,eye=this.app.camera.position;
  const sorted=parcels.filter(p=>p.active&&p.opacity>.0003).sort((a,b)=>{const d=p=>(p.p.x-eye.x)**2+(p.p.y-eye.y)**2+(p.p.z-eye.z)**2;return d(b)-d(a);});
  sorted.forEach((p,i)=>{
   const size=p.size;
   attrs.parcel.setXYZW(i,p.p.x,p.p.y,p.p.z,size);attrs.previous.setXYZW(i,p.previous.x,p.previous.y,p.previous.z,p.previousRotation);
   attrs.details.setXYZW(i,p.water||p.condensation?1:0,p.opacity,p.seed,p.rotation);attrs.motion.setXYZW(i,p.v.x,p.v.y,p.v.z,p.previousSize);
  });
  mesh.geometry.instanceCount=sorted.length;for(const key of ['parcel','previous','details','motion'])attrs[key].needsUpdate=true;
 }
 update(dt){
  const e=this.field.events.get('tornado');if(!e){if(this.particles.event)this.clear(this.particles.event.time>=this.particles.event.duration);return;}
  if(this.field.paused){this.settleMotion();return;}
  this.group.visible=true;const c=this.field.center(e),scale=e.radius/100,base=Math.max(0,this.field.terrain(c.x,c.z));
  this.cloudMaterial.uniforms.base.value.set(c.x,base,c.z);this.cloudMaterial.uniforms.flow.value.set(e.time,scale,e.intensity*.22,0);
  this.particles.update(dt,e);this.write(this.dust,this.particles.dust);this.write(this.flecks,this.particles.flecks);this.scheduleMotionCommit();
  const s=this.particles.snapshot(),bounds={minX:c.x,maxX:c.x,minY:base,maxY:base,minZ:c.z,maxZ:c.z};
  for(const p of this.particles.all)if(p.opacity>0){const r=p.size*1.5;bounds.minX=Math.min(bounds.minX,p.p.x-r);bounds.maxX=Math.max(bounds.maxX,p.p.x+r);bounds.minY=Math.min(bounds.minY,p.p.y-r);bounds.maxY=Math.max(bounds.maxY,p.p.y+r);bounds.minZ=Math.min(bounds.minZ,p.p.z-r);bounds.maxZ=Math.max(bounds.maxZ,p.p.z+r);}
  Object.assign(this.stats,{budget:s.budget,completedBudget:s.completedBudget,liquidParcels:s.liquidParcels,evaporated:s.evaporated,maxRadius:s.maxRadius,dust:s.dust,flecks:s.flecks,samples:s.samples,sourceSamples:s.sourceSamples,emitted:s.emitted,deposited:s.deposited,expired:s.expired,capacity:s.capacity,time:e.time,bounds});
 }
 snapshot(){return {...this.stats,visible:this.group.visible,particles:this.particles.snapshot()};}
}
