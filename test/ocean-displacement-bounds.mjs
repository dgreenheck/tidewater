import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from '../src/engine/index.js';
import {CDLOD} from '../src/core/CDLOD.js';
import {WaterGrid} from '../src/disasters/WaterGrid.js';
import {updateOceanDisplacementBounds} from '../src/ocean/DisplacementBounds.js';
const lod=()=>new CDLOD({gridSize:8,leafSize:8,levels:6,minY:-25,maxY:25,center:{x:-128,z:-128,size:256}});
const camera=()=>{const c=new PerspectiveCamera(55,1,.1,500);c.position.set(0,3000,160);c.lookAt(0,3000,0);c.updateProjectionMatrix();return c;};
test('The real ocean quadtree retains a visible 3000 m water crest that sea-level bounds cull',()=>{
 const grid=new WaterGrid(()=>-30,{n:33,dx:8,sponge:false,friction:false});
 grid.launch({direction:0,x:0,z:0,launchDistance:0,width:40,radius:100,intensity:3000});
 const l=lod(),c=camera();l.update(c);assert.equal(l.count,0,'original sea-level bounds reproduce the invisible crest');
 updateOceanDisplacementBounds(l,grid);l.update(c);assert.ok(l.count>0,'the actual displaced surface must be admitted by the render frustum');
 assert.equal(l.maxY,Math.max(...grid.pixels.filter((_,i)=>i%4===0))+25);
});
test('Stopping flood restores ordinary sea bounds without retaining an extreme culling volume',()=>{
 const l=lod();l.minY=-900;l.maxY=5000;updateOceanDisplacementBounds(l,null);assert.deepEqual([l.minY,l.maxY],[-25,25]);
});
