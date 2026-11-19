import { BufferGeometry, Group, InstancedInterleavedBuffer, InterleavedBufferAttribute, InstancedMesh } from '../engine/index.js';
import { ShaderModule } from '../engine/webgpu.js';

// Keep each uprooted plant's authored trunk, branches, leaf cards, species seed and
// alpha masks. The original vegetation shader evaluates its rest shape first;
// the rigid body's current transform then moves that shape about its centre.
// Two small instance attributes let all fallen plants share one shader per source
// material, avoiding a new GPU pipeline for every tree.
const materials = new WeakMap();

function acquireMaterial(source) {
 let entry = materials.get(source);
 if (entry) { entry.references++; return entry; }
 const material = source.clone();
 material.name = `${source.name}-uprooted`;
 material.attributes = {...source.attributes, treeRest: 'vec4f', treeOrigin: 'vec3f'};
 const originalVertex = source.vertex.replaceAll('v.model', 'treeSavedModel')
  .replace(/let nearK = [^\n]+;/, 'let nearK = 1.0;');
 material.vertex = /* wgsl */`
 let treeSavedModel = mat4x4f(
  vec4f(v.treeRest.x, 0.0, v.treeRest.y, 0.0),
  vec4f(0.0, v.treeRest.z, 0.0, 0.0),
  vec4f(-v.treeRest.y, 0.0, v.treeRest.x, 0.0),
  vec4f(v.iPos.xyz, 1.0));
 ${originalVertex}
 // A snapped stem (TreeFailure.js): treeRest.w > 0 keeps the part above that height, the falling
 // top; < 0 keeps the part below, the stump. Vertices on the far side collapse onto the stem axis
 // at the break, so the cut closes to a splintered point instead of an open tube.
 let treeCut = v.treeRest.w;
 let treeAbove = v.worldPos.y - v.iPos.y;
 if ((treeCut > 0.0 && treeAbove < treeCut) || (treeCut < 0.0 && treeAbove > -treeCut)) {
  v.worldPos = vec3f(v.iPos.x, v.iPos.y + abs(treeCut), v.iPos.z);
 }
 let treeLocalPosition = v.worldPos - v.treeOrigin;
 v.worldPos = (v.model * vec4f(treeLocalPosition, 1.0)).xyz;
 v.worldNormal = normalize((v.model * vec4f(v.worldNormal, 0.0)).xyz);
 v.prevWorldPos = (v.prevModel * vec4f(treeLocalPosition, 1.0)).xyz;
 ${source.varyings.vTrunkT ? 'o.vTrunkT = normalize((v.model * vec4f(o.vTrunkT, 0.0)).xyz);' : ''}
 `;
 // A detached tree has no far impostor to fade into. Preserve leaf coverage and
 // edge-on thinning, removing only the outgoing near-to-impostor cross-fade.
 material.modules = source.modules.map(module => module.name === 'vegCanopyMask'
  ? new ShaderModule({...module, name: 'fallenCanopyMask', code: module.code.replace(' && n >= fade', '')})
  : module);
 entry = {source, material, references: 1};
 materials.set(source, entry);
 return entry;
}

// cut: 0 draws the whole plant; > 0 only above that height (m) and < 0 only below it.
export function createFallenVegetation(type, record, index, origin, cut = 0) {
 const group = new Group();
 group.name = `uprooted-${type.name}-${index}`;
 const at = index * 16, base = index * 4, matrix = type.inst.matrices;
 const resources = [];
 for (const source of type.near?.meshes ?? []) {
  const geometry = new BufferGeometry();
  if (source.geometry.index) geometry.setIndex(source.geometry.index.clone());
  // Copy only this plant's instance attributes, never the whole live forest's
  // interleaved buffer. Geometry remains independently disposable on Restore.
  const vertexBuffers = new Map();
  for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
   if (name === 'iPos' || name === 'iDat') continue;
   if (attribute.isInterleavedBufferAttribute) {
    if (!vertexBuffers.has(attribute.data)) vertexBuffers.set(attribute.data, attribute.data.clone());
    geometry.setAttribute(name, new InterleavedBufferAttribute(vertexBuffers.get(attribute.data), attribute.itemSize, attribute.offset, attribute.normalized));
   } else geometry.setAttribute(name, attribute.clone());
  }
  const instance = new InstancedInterleavedBuffer(new Float32Array([
   ...type.inst.iPos.slice(base, base + 4), ...type.inst.iDat.slice(base, base + 4),
   matrix[at], matrix[at + 2], matrix[at + 5], cut, origin.x, origin.y, origin.z, 0,
  ]), 16);
  for (const [name, size, offset] of [['iPos',4,0],['iDat',4,4],['treeRest',4,8],['treeOrigin',3,12]])
   geometry.setAttribute(name, new InterleavedBufferAttribute(instance, size, offset));
  for (const part of source.geometry.groups) geometry.addGroup(part.start, part.count, part.materialIndex);
  geometry.drawRange = {...source.geometry.drawRange};
  const entry = acquireMaterial(source.material);
  const mesh = new InstancedMesh(geometry, entry.material, 1);
  mesh.name = source.name + '-uprooted';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.drawParams = [0, 100000, 100001];
  group.add(mesh);
  resources.push({mesh, geometry, entry});
 }
 group.userData.originalPlant = {type: type.name, index, height: record.H, meshes: resources.length};
 let disposed = false;
 group.dispose = () => {
  if (disposed) return;
  disposed = true;
  for (const {mesh, geometry, entry} of resources) {
   mesh.dispose();
   geometry.dispose();
   if (--entry.references === 0) {
    entry.material.dispose();
    materials.delete(entry.source);
   }
  }
 };
 return group;
}
