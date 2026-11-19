// CPU-only reference comparison; no GPU/browser, no rendering quality claim.
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
import {MeshRenderer as ReferenceRenderer} from '../test/reference/PreLaptopMeshRenderer.js';
import {RefractionPass} from '../src/ocean/RefractionPass.js';
import {RefractionPass as ReferenceRefraction} from '../test/reference/PreLaptopRefractionPass.js';
import {recordAttributeChanges} from '../src/engine/render/AttributeChanges.js';
import {GPU} from '../src/engine/gpu/GPU.js';
import {Scene,Mesh,BufferGeometry,BufferAttribute} from '../src/engine/index.js';

globalThis.GPUShaderStage={VERTEX:1,FRAGMENT:2,COMPUTE:4};
GPU.device={createBindGroupLayout:x=>x,createBindGroup:x=>x};GPU.samplers={};
const rp={setBindGroup(){},end(){}},encoder={beginRenderPass:()=>rp};GPU.getEncoder=()=>encoder;
const block={label:'bench',structName:'Test',upload(){},getBuffer(){return {};}};
function collection(Class){
 const renderer=new Class(),scene=new Scene(),geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array(9),3));
 const materials=Array.from({length:20},(_,id)=>({id,visible:true,transparent:id%5===0}));
 for(let i=0;i<6000;i++){const mesh=new Mesh(geometry,materials[i%20]);mesh.position.set(i%90,i%12,i%70);mesh.renderOrder=i%3;scene.add(mesh);}
 renderer._beginFrame=()=>{};renderer.drawItems=()=>{};const pass={frameBlock:block};
 return ()=>renderer.render(scene,pass);
}
function bounds(Class,dense){
 const r=Object.assign(Object.create(Class.prototype),{_boxes:new WeakMap()}),p=new BufferAttribute(new Float32Array(60000*3),3),objects=[];
 for(let i=0;i<p.count;i++)p.setXYZ(i,i%19,i%43-21,i%79);
 for(let i=0;i<20;i++){const geometry=new BufferGeometry().setAttribute('position',p);geometry.setDrawRange(i*3000,3000);objects.push({geometry});r._localBox(objects[i]);}
 let step=0;const range={start:0,count:30},ranges=[range];
 return ()=>{const prior=p.version,at=(step++%20)*9000;p.array[at+1]=step%31-15;range.start=at;p.needsUpdate=true;recordAttributeChanges(p,prior,dense?null:ranges);for(const o of objects)r._localBox(o);};
}
const cases=[['6000-mesh collection',()=>collection(ReferenceRenderer),()=>collection(MeshRenderer)],['sparse shared refraction bounds',()=>bounds(ReferenceRefraction,false),()=>bounds(RefractionPass,false)],['full dirty refraction bounds',()=>bounds(ReferenceRefraction,true),()=>bounds(RefractionPass,true)]];
const median=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
function sample(fn,ms=180){let n=0;const begin=performance.now();do{fn();n++;}while(performance.now()-begin<ms);return (performance.now()-begin)/n;}
const results=[];
for(const [name,beforeFactory,afterFactory] of cases){const before=beforeFactory(),after=afterFactory();sample(before,100);sample(after,100);const b=[],a=[];for(let i=0;i<7;i++){if(i%2){a.push(sample(after));b.push(sample(before));}else{b.push(sample(before));a.push(sample(after));}}results.push({name,beforeMs:b,afterMs:a,beforeMedian:median(b),afterMedian:median(a),reduction:1-median(a)/median(b)});}
const report={description:'Seven interleaved CPU-only batches per implementation; synthetic collection and shared geometry; not browser FPS',results};
writeFileSync(new URL('../evidence/render-hot-path-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
