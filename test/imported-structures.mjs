import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralDamage} from '../src/disasters/Structures.js';
import {importedTerminalFixture} from './helpers/imported-terminal.mjs';
import {BufferAttribute,BufferGeometry,Group,Mesh,Vector3} from '../src/engine/index.js';
import {partitionImportedGeometry} from '../src/disasters/ImportedFragments.js';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';

function meshes(app){const result=[];for(const site of [app.terminal,app.joeyTerminal])site?.root.traverse(m=>{if(m.isMesh&&/^Terminal (Building|Glazing|Interior|Tower|Walkway|Jetty|Hardstand)$/.test(m.parent?.name??''))result.push(m);});return result;}
function surfaceMoments(mesh){
 const g=mesh.geometry,p=g.attributes.position,index=g.index?.array,n=index?.length??p.count,a=new Vector3(),b=new Vector3(),c=new Vector3(),ab=new Vector3(),ac=new Vector3(),moments=Object.fromEntries(Object.entries(g.attributes).filter(([name])=>name!=='previousPosition').map(([name,v])=>[name,Array(v.itemSize).fill(0)]));let area=0;
 for(let i=0;i<n;i+=3){const ids=[0,1,2].map(k=>index?.[i+k]??i+k);a.fromBufferAttribute(p,ids[0]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,ids[1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,ids[2]).applyMatrix4(mesh.matrixWorld);const A=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;area+=A;for(const [name,out]of Object.entries(moments)){const attr=g.attributes[name];for(let k=0;k<out.length;k++)out[k]+=A*ids.reduce((n,id)=>n+attr.getComponent(id,k),0)/3;}}
 return {area,moments,triangles:n/3};
}

test('Actual imported terminal fragments contain only geometry inside their assigned 10 m cells',async()=>{
 const app=await importedTerminalFixture({both:true}),damage=new StructuralDamage(app,{});
 assert.ok(damage.records.length>40,'both complete authored terminals must be imported');
 const offenders=[];
 for(const r of damage.records){
  const extent=r.hi.clone().sub(r.lo);if(extent.x>10.0001||extent.z>10.0001)offenders.push({name:r.name,extent:extent.toArray()});
 }
 assert.deepEqual(offenders,[],'whole authored triangles must be geometrically split at fragment boundaries, not moved by centroid ownership');
});

test('Actual terminal clipping preserves total surface coverage and area-weighted position, normal, UV and colour fields',async()=>{
 const app=await importedTerminalFixture({both:true}),list=meshes(app),before=list.map(surfaceMoments);new StructuralDamage(app,{});
 let oldTriangles=0,newTriangles=0,oldArea=0,newArea=0;
 for(let i=0;i<list.length;i++){const now=surfaceMoments(list[i]),old=before[i];oldTriangles+=old.triangles;newTriangles+=now.triangles;oldArea+=old.area;newArea+=now.area;
  assert.ok(Math.abs(now.area-old.area)<=Math.max(1e-7,old.area*2e-6),`${list[i].parent.name}/${list[i].material.name} lost or duplicated surface area`);
  assert.deepEqual(Object.keys(now.moments),Object.keys(old.moments));for(const [name,values]of Object.entries(old.moments))for(let k=0;k<values.length;k++)assert.ok(Math.abs(now.moments[name][k]-values[k])<=Math.max(2e-6,Math.abs(values[k])*4e-6,old.area*2e-6),`${list[i].material.name} ${name}[${k}] changed its surface integral`);
 }
 assert.ok(newTriangles>oldTriangles,'actual long source faces must be subdivided');assert.ok(newTriangles<oldTriangles*1.15,'the one-time topology repair must remain bounded');
 assert.ok(Math.abs(oldArea-newArea)<oldArea*1e-6);
});

test('Clipping barycentrically preserves a rotated triangle and continuous normal, UV and normalized colour interpolation',()=>{
 const g=new BufferGeometry(),p=[-23,7,-17,34,9,-13,1,13,29];g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setAttribute('normal',new BufferAttribute(new Float32Array([.2,.9,.1,.5,.8,.2,-.1,.7,.6]),3));g.setAttribute('uv',new BufferAttribute(new Float32Array([0,0,1,0,0,1]),2));g.setAttribute('color',new BufferAttribute(new Uint8Array([0,64,255,255,128,0,128,255,64]),3,true));
 const mesh=new Mesh(g,{});mesh.position.set(-35,2,24);mesh.rotation.y=.61;mesh.scale.set(1.2,.7,.85);new Group().add(mesh);mesh.updateMatrixWorld(true);const {geometry,ranges}=partitionImportedGeometry(mesh),normal=g.attributes.normal,color=g.attributes.color;
 let total=0;for(const r of ranges){assert.ok(r.key!==null);const [x,z]=r.key.split(':').map(Number);for(let i=r.start;i<r.start+r.count;i++){const uv=geometry.attributes.uv,weights=[1-uv.getX(i)-uv.getY(i),uv.getX(i),uv.getY(i)],local=new Vector3().fromBufferAttribute(geometry.attributes.position,i),expected=new Vector3();for(let j=0;j<3;j++)expected.addScaledVector(new Vector3().fromArray(p,j*3),weights[j]);assert.ok(local.distanceTo(expected)<4e-6,'new vertices must remain on the original affine surface');const world=local.applyMatrix4(mesh.matrixWorld);assert.ok(world.x>=x*10-1e-5&&world.x<=(x+1)*10+1e-5&&world.z>=z*10-1e-5&&world.z<=(z+1)*10+1e-5);for(const [name,attr]of [['normal',normal],['color',color]])for(let k=0;k<3;k++)assert.ok(Math.abs(geometry.attributes[name].getComponent(i,k)-weights.reduce((n,w,j)=>n+w*attr.getComponent(j,k),0))<1e-7,`${name} must interpolate, including normalized integer source attributes`);}total+=r.count;}
 assert.equal(total,geometry.attributes.position.count);assert.ok(total>3);
 const old=surfaceMoments(mesh);mesh.geometry=geometry;const now=surfaceMoments(mesh);assert.ok(Math.abs(old.area-now.area)<old.area*1e-7);
});

test('Real native imported fragments keep bounded rest extents, rigid triangles, complete geometry and exact repeated Restore',async()=>{
 await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});const physics=new RallyPhysics();physics.reset(-400,200,-400,0);
 const app=await importedTerminalFixture({physics}),damage=new StructuralDamage(app,{}),list=meshes(app),baseline=list.map(m=>Object.fromEntries(Object.entries(m.geometry.attributes).map(([name,a])=>[name,a.array.slice()]))),targets=damage.records.filter(r=>['Ferry terminal 16:30','Ferry terminal 18:29','Ferry terminal 17:28'].includes(r.name));assert.equal(targets.length,3);
 try{for(let cycle=0;cycle<2;cycle++){
  for(const r of targets)assert.equal(damage.fracture(r),true);
  assert.ok(damage.bodies.size>=3);const loads=[];for(const b of damage.bodies.values()){const spanPositions=b.spans.flatMap(s=>Array.from(s.pos));for(const k of [0,2]){const values=spanPositions.filter((_,i)=>i%3===k);assert.ok(Math.max(...values)-Math.min(...values)<=10.0001,`${b.name} native body owns an oversized original face`);}loads.push(b.id,12*b.mass,9.81*b.mass,-4*b.mass,0,.7*b.mass,0);}
  physics.set_disaster_loads(new Float32Array(loads));for(let i=0;i<90;i++)physics.advance(1/120,0,0,0,0);damage.sync(physics.prop_poses());
  let moved=0;for(const b of damage.bodies.values()){if(b.position.distanceTo(b.origin)>.1)moved++;for(const s of b.spans)for(let j=0;j<s.count;j++){const expected=new Vector3().fromArray(s.pos,j*3).sub(b.origin).applyQuaternion(b.quaternion).add(b.position).applyMatrix4(s.inverse),actual=new Vector3().fromBufferAttribute(s.geo.attributes.position,s.start+j);assert.ok(expected.distanceTo(actual)<2e-4,'each actual triangle must follow one native rigid transform without cross-body stretching');}}
  assert.equal(moved,damage.bodies.size);damage.reset();assert.equal(physics.prop_count(),0);for(let i=0;i<list.length;i++)for(const [name,a]of Object.entries(baseline[i])){if(name==='previousPosition')continue;assert.deepEqual(list[i].geometry.attributes[name].array,a,`Restore must preserve every ${name} value, including unfractured neighbouring cells`);}assert.ok(targets.every(r=>r.colliders.every(c=>!c.disasterDisabled)));
 }}finally{damage.reset();physics.free();}
});
