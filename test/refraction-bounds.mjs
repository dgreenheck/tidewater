import test from 'node:test';
import assert from 'node:assert/strict';
import {RefractionPass} from '../src/ocean/RefractionPass.js';
import {BufferAttribute,BufferGeometry,InterleavedBuffer,InterleavedBufferAttribute} from '../src/engine/index.js';
const pass=()=>Object.assign(Object.create(RefractionPass.prototype),{_boxes:new WeakMap()});
const geometry=()=>new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([0,2,0,1,3,0,0,-4,1,1,-5,1]),3));

test('Moving a complete mesh through water updates refraction eligibility despite a precomputed box',()=>{
 const r=pass(),g=geometry(),o={geometry:g};g.computeBoundingBox();assert.equal(r._localBox(o).min.y,-5);
 const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+10);p.needsUpdate=true;
 assert.equal(r._localBox(o).min.y,5,'the moved mesh is entirely above the water now');
});

test('Changed triangle membership updates the drawn range bounds without a position edit',()=>{
 const r=pass(),g=geometry().setIndex([0,1,0,2,3,2]),o={geometry:g};g.setDrawRange(0,3);
 assert.equal(r._localBox(o).min.y,2);g.index.array.set([2,3,2],0);g.index.needsUpdate=true;
 assert.equal(r._localBox(o).min.y,-5,'submerged replacement triangles must enter the refraction pass');
});

test('Replacing the position attribute or array at an equal version invalidates bounds',()=>{
 const r=pass(),g=geometry(),o={geometry:g};g.setDrawRange(0,2);assert.equal(r._localBox(o).min.y,2);
 const p=new BufferAttribute(new Float32Array([0,-8,0,1,-7,0]),3);g.setAttribute('position',p);
 assert.equal(r._localBox(o).min.y,-8);p.array=new Float32Array([0,9,0,1,10,0]);
 assert.equal(r._localBox(o).min.y,9);
});

test('Shared material views use only their drawn vertices and retain normalized interleaved semantics',()=>{
 const r=pass(),g=geometry().setIndex([0,1,0,2,3,2]),first={geometry:g};g.setDrawRange(0,3);
 assert.equal(r._localBox(first).min.y,2);g.setDrawRange(3,3);assert.equal(r._localBox(first).max.y,-4);
 const d=new InterleavedBuffer(new Int16Array([99,-32767,16384,0,99,0,32767,-32767]),4);
 const p=new InterleavedBufferAttribute(d,3,1,true),h=new BufferGeometry().setAttribute('position',p);h.setDrawRange(0,2);
 const box=r._localBox({geometry:h});assert.deepEqual(box.min.toArray(),[-1,16384/32767,-1]);assert.deepEqual(box.max.toArray(),[0,1,0]);
 h.setDrawRange(0,0);assert.ok(r._localBox({geometry:h}).isEmpty());
});
