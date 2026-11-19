import test from 'node:test';
import assert from 'node:assert/strict';
import {DisasterField} from '../src/disasters/Field.js';
import {DisasterField as ReferenceField} from './reference/PreLaptopField.js';
import {tornadoMotionParams} from '../src/disasters/TornadoMotion.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {WaterGrid as ReferenceWater} from './reference/PreLaptopWaterGrid.js';
const terrain=(x,z)=>Math.sin(x*.013)*7+Math.cos(z*.021)*3-4;

test('Optimized wet/dry interpolation and combined disaster samples exactly match the frozen original',()=>{
 const current=new DisasterField(terrain),reference=new ReferenceField(terrain);
 for(const field of [current,reference]){
  field.start('earthquake',{x:4,z:12});field.start('tornado',{x:10,z:18});
  // The frozen original has a straight track and steady wind: compare with a steady motion (scale 0).
  if(field===current){const e=field.events.get('tornado');e.seed=0;e.motion=tornadoMotionParams(0,0);}
  field.water=new (field===current?WaterGrid:ReferenceWater)(terrain,{n:33,dx:8});
  for(let i=0;i<field.water.h.length;i++)if(field.water.h[i]>0){field.water.h[i]+=.7*Math.sin(i*.7);field.water.qx[i]=Math.sin(i);field.water.qz[i]=Math.cos(i);}
  field.water.pack();field.ambient=()=>({x:2,z:-1});field.registerAirModifier((x,y,z,a)=>{a.wx+=Math.sin(x);a.wy+=y*.001;a.wz*=.7;},{minX:-20,maxX:30,minZ:-10,maxZ:50});
 }
 for(const age of [0,.1,1,3,15,24.9,61]){
  for(const field of [current,reference])for(const e of field.events.values())e.time=age;
  for(let i=0;i<1500;i++){
   const x=Math.sin(i*11.3)*220,z=Math.cos(i*1.7)*220,y=i%180;
   assert.deepEqual(current.water.sample(x,z),reference.water.sample(x,z));
   assert.deepEqual(current.sample(x,y,z),reference.sample(x,y,z));
  }
 }
});

test('Air scratch remains isolated during recursive queries and recovers after modifier failure',()=>{
 const field=new DisasterField(()=>0);field.ambient=()=>({x:2,z:3});
 const remove=field.registerAirModifier((x,y,z,a)=>{if(x===1){const inner=field.sample(2,y,z);assert.equal(inner.wx,4);a.wx+=inner.wx;}else a.wx*=2;});
 assert.equal(field.sample(1,0,0).wx,6);remove();
 const fail=field.registerAirModifier(()=>{throw new Error('modifier');});assert.throws(()=>field.sample(0,0,0),/modifier/);fail();assert.equal(field.sample(0,0,0).wx,2);assert.equal(field.airDepth,0);
});
