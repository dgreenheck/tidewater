import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene } from '../src/engine/index.js';
import { Material } from '../src/engine/webgpu.js';
import { Player } from '../src/player/Player.js';
import { Evacuation } from '../src/evacuation/Evacuation.js';
import { prepareEvacuationRoute, routeObservation } from '../src/evacuation/Route.js';
import { DisasterField } from '../src/disasters/Field.js';

const terrain=new TerrainData();new CoastalRoute(terrain);const route=prepareEvacuationRoute(terrain);
const canvasContext=new Proxy({getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
// The headless geometry check stubs only the canvas rasterizer; GPU/browser
// rendering and the actual sign appearance are exercised by the browser suite.
globalThis.document={createElement:()=>({getContext:()=>canvasContext})};
const colliders=new Colliders(),scene=new Scene(),material=new Material();
const app={terrainData:terrain,colliders,scene,village:{materials:{wood:material,hard:material,stone:material}}};
const evac=new Evacuation(app);evac.build();

test('surveyed timber route is continuous, on natural high ground, with safe stair rises and genuine road clearance',()=>{
 assert.equal(route.length,138);
 assert.ok(route.width>=3.5);
 assert.ok(route.maxRiser<=.180001);
 assert.ok(route.nominalRunSeconds<25);
 assert.ok(route.refuge.ground>35);
 assert.ok(route.refuge.y>40);
 assert.ok(route.bridge.y-.38-route.bridge.roadHeight>=5);
 assert.ok(evac.drawCalls<=6,`${evac.drawCalls} merged draw calls`);
 assert.ok(evac.triangles<30000,`${evac.triangles} triangles`);
 for(const p of route.points){
  assert.ok(p.y>terrain.heightAt(p.x,p.z)+.2);
  for(const side of [-1.3,0,1.3]){
   const floor=colliders.groundHeightAt(p.x+side,p.z,p.y+.01);
   assert.ok(Math.abs(floor-p.y)<1e-6,`Deck supports full running width at ${p.z}`);
  }
 }
 assert.ok(terrain.inClearZone(route.x,-150));
 assert.ok(terrain.inClearZone(route.refuge.x,route.refuge.z));
});

test('the production walking controller climbs every real step on foot within the normal warning',()=>{
 const input={down:key=>key==='KeyW'||key==='ShiftLeft',hit:()=>false};
 const player=new Player({camera:{},input,terrain,colliders,query:{allocate:()=>0},boat:null});
 player.position.set(route.entry.x,terrain.heightAt(route.entry.x,route.entry.z),route.entry.z);
 player.yaw=0;player.grounded=true;player.waterH=player.waterMean=0;
 let seconds=0,maxRise=0;
 while(seconds<50&&player.position.z>route.refuge.z){const y=player.position.y;player.updateWalk(1/60);maxRise=Math.max(maxRise,player.position.y-y);seconds+=1/60;}
 assert.ok(seconds<30,`Actual controller completed in ${seconds.toFixed(2)} s`);
 assert.equal(player.mode,'walk');
 assert.ok(player.grounded);
 assert.ok(maxRise<.4);
 assert.ok(Math.abs(player.position.y-route.refuge.y)<.01);
 assert.equal(routeObservation(route,player,null).atRefuge,true);
 const lifted={position:player.position.clone(),mode:'walk'};lifted.position.y+=8;
 assert.equal(routeObservation(route,lifted,null).atRefuge,false,'Airborne proximity does not count as reaching the platform');
});

test('a real severe shallow-water event exposes the entrance and leaves measured high ground dry without a safety flag',()=>{
 const field=new DisasterField((x,z)=>terrain.heightAt(x,z));
 // A mechanism test (route observation on real water): one fixed seed. A 25 m wave's run-up reaches 38-39 m on
 // some draws (2 of 5 fresh seeds, seed sweep), over this 37.6 m refuge: physically fine, R up to about 1.5 H.
 const e=field.start('tsunami',{x:58,z:-46,intensity:25,warningLead:3,duration:65,seed:3});
 let entrancePeak=0,refugePeak=0,entranceWet=0;
 // The whole event: warning, the planned approach from the open sea (60-120 s with the current solver), then the flood.
 const steps=Math.ceil((e.warning+e.approach+e.duration)/.1);
 for(let i=0;i<steps&&field.events.has('tsunami');i++){
  field.advance(.1);
  entrancePeak=Math.max(entrancePeak,field.waterAt(route.entry.x,route.entry.z));
  refugePeak=Math.max(refugePeak,field.waterAt(route.refuge.x,route.refuge.z));
  entranceWet=Math.max(entranceWet,field.acceleration(route.entry,{x:0,y:0,z:0},{mass:75,area:.7,volume:.075,height:1.8,supported:true,dt:.1},{}).wet);
 }
 assert.ok(entrancePeak>route.entry.y,`Actual entrance peak ${entrancePeak} exceeds deck ${route.entry.y}`);
 assert.ok(entranceWet>.5,'Standing at the entrance receives real fluid loading');
 assert.ok(refugePeak<route.refuge.ground,`Actual refuge water ${refugePeak} below natural ground ${route.refuge.ground}`);
 const obs=routeObservation(route,{position:route.refuge,mode:'walk'},field);
 assert.equal(obs.refugeWaterDepth,0);
 const overtopped={events:new Map(),waterAt:()=>route.refuge.y+2};
 assert.equal(routeObservation(route,{position:route.refuge,mode:'walk'},overtopped).refugeWaterDepth,2,'A higher physical flood is reported as flooded, never made immune');
});

test('passing beside or beyond the refuge does not misleadingly report zero distance',()=>{
 const p={position:{x:route.refuge.x+8,y:route.refuge.y+2,z:route.refuge.z-7},mode:'walk'};
 const state=routeObservation(route,p,null);
 assert.equal(state.atRefuge,false);
 assert.ok(state.remainingDistance>10,'Signed refuge is still more than 10 m away');
});
