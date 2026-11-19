import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3, Matrix4} from '../src/engine/index.js';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
import {buildPalmNear} from '../src/world/vegetation/PlantGeometry.js';
import {createPlantLeafMaterial} from '../src/world/vegetation/VegMaterials.js';
import {VegType} from '../src/world/vegetation/InstanceLOD.js';
import {createFallenVegetation} from '../src/disasters/FallenVegetation.js';

test('Uprooted authored palms fit baseline WebGPU limits and retain species geometry through reset',()=>{
 const record={x:17,y:3,z:-21,s:1.3,sy:1.2,yaw:.7,H:9,seed:.34,la:.2,l:.1};
 const {geometry}=buildPalmNear(),material=createPlantLeafMaterial();
 const type=new VegType('palms',[record],{near:[{geometry,material}],fade:[100,110]});
 const origin=new Vector3(17,8.85,-21),source=type.near.meshes[0];
 const first=createFallenVegetation(type,record,0,origin),second=createFallenVegetation(type,record,0,origin);
 const mesh=first.children[0],layout=MeshRenderer.prototype._layout.call({},mesh,mesh.geometry,mesh.material);
 assert.ok(layout.buffers.length<=8,`requires ${layout.buffers.length} vertex buffers; WebGPU guarantees8`);
 assert.ok(layout.layout.length<=16,`requires ${layout.layout.length} vertex attributes; WebGPU guarantees16`);
 assert.equal(mesh.geometry.index.count,geometry.index.count);
 assert.ok(mesh.geometry.index.count>1000,'must preserve actual palm mesh, not a low-detail stand-in');
 for(const name of ['position','normal','uv','aVeg','aMat','aLobe']) {
  const original=geometry.getAttribute(name),copy=mesh.geometry.getAttribute(name);
  assert.equal(copy.count,original.count);
  for(let i=0;i<copy.count;i++)for(let c=0;c<copy.itemSize;c++)assert.equal(copy.getComponent(i,c),original.getComponent(i,c));
 }
 const rest=mesh.geometry.getAttribute('treeRest'),base=mesh.geometry.getAttribute('iPos');
 const saved=new Matrix4().fromArray(type.inst.matrices);
 const reconstructed=new Matrix4().set(rest.getX(0),0,-rest.getY(0),base.getX(0),0,rest.getZ(0),0,base.getY(0),rest.getY(0),0,rest.getX(0),base.getZ(0),0,0,0,1);
 assert.ok(new Vector3(2,7,-3).applyMatrix4(reconstructed).distanceTo(new Vector3(2,7,-3).applyMatrix4(saved))<1e-6);
 assert.equal(mesh.material,second.children[0].material,'fallen plants should share shader pipelines');
 let originalDisposed=0,fallenDisposed=0;
 source.material.addEventListener('dispose',()=>originalDisposed++);
 mesh.material.addEventListener('dispose',()=>fallenDisposed++);
 type.inst.iPos[1]=-10000;
 assert.equal(mesh.geometry.getAttribute('iPos').getY(0),3,'hiding the original must not hide the fallen copy');
 first.dispose();first.dispose();
 assert.equal(fallenDisposed,0,'another fallen plant still needs the shared material');
 second.dispose();
 assert.equal(fallenDisposed,1);
 assert.equal(originalDisposed,0,'Restore must retain the live forest material');
 assert.equal(geometry.index.count,mesh.geometry.index.count);
});
