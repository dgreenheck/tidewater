import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dynamicPressure, quadraticDrag, buoyancy, kineticEnergy, hydrostaticPressure } from '../src/physics/Loads.js';
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} versus ${expected}`);
test('reference wind pressure and frontal drag have SI magnitudes and vector direction', () => {
 close(dynamicPressure(20),245);
 const f = quadraticDrag({}, {x:12,y:0,z:16}, {density:1.225,dragCoefficient:1.2,area:2});
 close(f.x,352.8); close(f.y,0); close(f.z,470.4);
 const reverse=quadraticDrag({}, {x:-20,y:0,z:0}, {density:1.225,dragCoefficient:1.2,area:2});
 close(reverse.x,-588);
 close(quadraticDrag({}, {x:0,y:0,z:0}, {area:10}).x,0);
});
test('drag scales quadratically with relative speed and linearly with area and density',()=>{
 const force=(speed,area,density)=>quadraticDrag({}, {x:speed,y:0,z:0},{area,density}).x;
 close(force(20,1,1)/force(10,1,1),4);
 close(force(10,3,1)/force(10,1,1),3);
 close(force(10,1,2)/force(10,1,1),2);
 close(force(10,0,2),0);
});
test('Archimedes buoyancy, hydrostatic pressure and kinetic energy match independent examples',()=>{
 close(buoyancy(1),10055.25); // one cubic metre of reference seawater
 close(buoyancy(0.5,1000),4905);
 close(hydrostaticPressure(4,1000),39240);
 close(kineticEnergy(12000,70),29400000); // jet arrestor energy budget, J
 close(buoyancy(0),0);
});
test('invalid physical inputs are rejected instead of introducing NaNs into a solver',()=>{
 for(const bad of [-1,NaN,Infinity]) {
  assert.throws(()=>dynamicPressure(bad),RangeError);
  assert.throws(()=>buoyancy(bad),RangeError);
  assert.throws(()=>kineticEnergy(bad,1),RangeError);
 }
 assert.throws(()=>quadraticDrag({}, {x:NaN,y:0,z:0}),RangeError);
 assert.throws(()=>quadraticDrag({}, {x:1,y:0,z:0},{area:-1}),RangeError);
 assert.throws(()=>hydrostaticPressure(-1),RangeError);
});
