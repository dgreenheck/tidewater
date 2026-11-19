import { UniformBlock, ShaderModule, Texture } from '../engine/webgpu.js';
import { Vector4 } from '../engine/index.js';
// The CPU solver's exact packed grids; the manual bilinear interpolation matches WaterGrid.sample.
// Inside the 2 km inner grid it is sampled; outside, the 8 km outer ring (the approach), as Field.gridAt.
// A wall coming in from beyond the ring (e.farField) is drawn analytically by disasterFar, the WGSL twin of
// Field.farFieldAt (WaterGrid.nWaveEta and nWaveSpeed): everywhere until the hand-off, then outside the ring.
export class DisasterWater {
 constructor(terrain){
  // One texture, inner grid in rows 0..n-1 and the outer ring in rows n..2n-1: a second texture took the
  // beauty pass to 33 sampled textures in the fragment stage (limit 32) and the game did not load.
  this.packed=new Float32Array(257*514*4);
  this.texture=new Texture({width:257,height:514,format:'rgba32float',label:'disaster-height-current',data:this.packed});
  this.params=new UniformBlock('DisasterWaterParams',{domain:['vec4f',new Vector4(0,0,8,0)],outer:['vec4f',new Vector4(0,0,32,0)],
   // far0: crest point x, z (m) and heading cos, sin; far1: H (m), sigma (m), drawdown (/H), trough lead (sigmas);
   // far2: crest half length (m), lateral falloff (m), wall speed (m/s), mode (0 off, 1 everywhere, 2 outside the ring);
   // far3: x the crest's plateau behind the front (m, farField.length), yzw unused.
   far0:['vec4f',new Vector4(0,0,1,0)],far1:['vec4f',new Vector4(0,1,0,0)],far2:['vec4f',new Vector4(0,1,0,0)],far3:['vec4f',new Vector4(0,0,0,0)]},{label:'disasterWater'});
  this.module=new ShaderModule({name:'disasterWater',deps:[terrain.module],uniforms:this.params,uniformName:'disasterWater',bindings:{disasterGridTex:{texture:()=>this.texture}},code:`
// The analytic wall: Field.farFieldAt and WaterGrid.nWaveEta / nWaveSpeed, same maths (TROUGH_FLOOR 0.05).
fn disasterFar(p:vec2f,ground:f32,inRing:bool)->vec4f {
 let f0=disasterWater.far0;let f1=disasterWater.far1;let f2=disasterWater.far2;
 if(f2.w<0.5||(f2.w>1.5&&inRing)||ground>=-0.3){return vec4f(0.0);}
 let r=p-f0.xy;let along=dot(r,f0.zw);let cross=r.y*f0.z-r.x*f0.w;
 let side=max(0.0,abs(cross)-f2.x)/f2.y;let lateral=exp(-2.0*side*side);
 let a=select(along,min(0.0,along+disasterWater.far3.x),along<0.0)/f1.y;let b=along/f1.y-f1.w;
 let depth=-ground;let eta=max(-0.95*depth,f1.x*(exp(-0.5*a*a)-f1.z*exp(-0.5*b*b))*lateral);
 if(abs(eta)<0.0001){return vec4f(0.0);}
 let h=depth+eta;let simple=2.0*(sqrt(9.81*h)-sqrt(9.81*depth));
 let u=select(simple,f2.z*eta/h,eta>0.0);
 return vec4f(eta,u*f0.z,u*f0.w,eta);
}
fn disasterSample(p:vec2f)->vec4f {
 let d=disasterWater.domain;if(d.w<1.0){return vec4f(0.0);}
 var v=vec4f(0.0);var inRing=false;
 let uv=(p-d.xy)/d.z;
 if(all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0))){
  let i=min(vec2i(floor(uv)),vec2i(i32(d.w)-2));let f=uv-vec2f(i);
  let a=mix(textureLoad(disasterGridTex,i,0),textureLoad(disasterGridTex,i+vec2i(1,0),0),f.x);
  let b=mix(textureLoad(disasterGridTex,i+vec2i(0,1),0),textureLoad(disasterGridTex,i+vec2i(1,1),0),f.x);
  v=mix(a,b,f.y);inRing=true;
 }else{
  let o=disasterWater.outer;let ov=(p-o.xy)/o.z;
  if(o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0))){
   let c=min(vec2i(floor(ov)),vec2i(i32(o.w)-2));let f=ov-vec2f(c);let i=c+vec2i(0,i32(d.w)); // outer rows follow the inner grid's
   let a=mix(textureLoad(disasterGridTex,i,0),textureLoad(disasterGridTex,i+vec2i(1,0),0),f.x);
   let b=mix(textureLoad(disasterGridTex,i+vec2i(0,1),0),textureLoad(disasterGridTex,i+vec2i(1,1),0),f.x);
   v=mix(a,b,f.y);inRing=true;
  }
 }
 let ground=terrainHeightAt(p);
 v+=disasterFar(p,ground,inRing);
 if(v.x<=ground+0.002){return vec4f(min(0.0,v.x),0.0,0.0,0.0);}return v;
}
fn disasterHeight(p:vec2f)->f32 {return disasterSample(p).x;}
fn disasterSlope(p:vec2f)->vec2f {let h=disasterHeight(p);return vec2f(disasterHeight(p+vec2f(0.5,0.0))-h,disasterHeight(p+vec2f(0.0,0.5))-h)*2.0;}
fn disasterFoam(p:vec2f)->f32 {let v=disasterSample(p);return smoothstep(0.3,3.0,v.x)*smoothstep(-8.0,1.0,terrainHeightAt(p))*smoothstep(0.0,0.8,v.w);}
`});
 }
 update(field){
  const grid=field.water,outer=field.outer?.n===grid?.n?field.outer:null;
  this.params.fields.domain.value.set(grid?.x??0,grid?.z??0,grid?.dx??8,grid?grid.n:0);
  this.params.fields.outer.value.set(outer?.x??0,outer?.z??0,outer?.dx??32,outer?outer.n:0);
  // The far-field wall moves every frame, the grids only every solver step: set before the version check.
  const e=field.events?.get('tsunami'),far=grid?e?.farField:null,F=this.params.fields;
  if(far){
   const crest=field.farCrest(e),a=e.direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);
   F.far0.value.set(e.x-cx*crest,e.z-cz*crest,cx,cz);
   F.far1.value.set(e.intensity,e.crestWidth??e.width,e.drawdown??0,e.troughLead??2.2);
   F.far2.value.set(e.crestHalfLength??0,e.radius,far.speed,e.launched?2:1);
   F.far3.value.set(far.length??0,0,0,0);
  }else F.far2.value.set(0,1,0,0);
  if(!grid)return;
  if(this.grid===grid&&this.version===grid.version&&this.outerGrid===outer&&this.outerVersion===outer?.version)return;
  const cells=grid.n*grid.n*4;
  if(this.texture.width!==grid.n){this.packed=new Float32Array(cells*2);this.texture.resize(grid.n,grid.n*2);}
  this.packed.set(grid.pixels,0);
  if(outer)this.packed.set(outer.pixels,cells);
  this.texture.upload(this.packed);
  this.grid=grid;this.version=grid.version;this.outerGrid=outer;this.outerVersion=outer?.version;
 }
}
