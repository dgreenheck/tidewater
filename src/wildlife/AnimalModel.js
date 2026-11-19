import { BufferAttribute, Color } from '../engine/index.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
const assets=new Map(),geometry=new Map();
export async function createAnimalModel(kind,index){
 if(!assets.has(kind))assets.set(kind,loadGLB(`${import.meta.env.BASE_URL}models/livestock/${kind}.glb`));
 const gltf=await assets.get(kind),tint=kind==='goat'?[1,.96,.91,1.08,.86,1.02][index%6]:[1,.97,1.04,.91][index%4];
 const model=await SkinnedModel.create(gltf,{materials:()=>({color:new Color(tint,tint,tint),roughness:.8,metalness:0})});
 const node=gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined),primitives=gltf.meshes[node.mesh];
 for(let i=0;i<model.meshes.length;i++){
  const mesh=model.meshes[i],color=primitives[i].attributes.COLOR_0;
  if(!color)throw new Error(`Missing authored ${kind} coat colours`);
  // The skin loader intentionally keeps a small common attribute set. Preserve the
  // original model's coat here, and share its immutable mesh buffers across the herd.
  mesh.geometry.setAttribute('color',new BufferAttribute(color.array,color.itemSize,color.normalized));mesh.material.vertexColors=true;
  const key=`${kind}:${i}`;if(geometry.has(key))mesh.geometry=geometry.get(key);else geometry.set(key,mesh.geometry);
 }
 model.play('Graze',{fade:0,from:index*.24});model.update(0);return model;
}
