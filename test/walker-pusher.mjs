import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import init,{RallyPhysics} from '../public/rally/rally_physics.js';
import {PropPhysics} from '../src/physics/Props.js';
import {Player} from '../src/player/Player.js';
import {Colliders} from '../src/world/Colliders.js';

await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
const terrain={heightAt:()=>0,normalAt:(x,z,out)=>out.set(0,1,0)};
function walk({obstacle=false,seconds=3}={}) {
 const physics=new RallyPhysics();
 try {
  physics.set_terrain(new Float32Array(25),5,200,-100);
  physics.wake_prop(400,0,new Float32Array([.5,.5,.5]),new Float32Array([obstacle?0:40,.5,obstacle?-4:40,0,0,0,1]),obstacle?5000:10,.9,0,false);
  const input={down:key=>key==='KeyW'||key==='ShiftLeft',hit:()=>false};
  const player=new Player({camera:{},input,terrain,colliders:new Colliders(),query:{allocate:()=>0},boat:null});
  player.position.set(0,0,0);player.yaw=0;player.grounded=true;player.waterH=player.waterMean=0;
  const props=Object.create(PropPhysics.prototype);
  props.app={player,rally:{active:false},freeCam:false};props.physics=physics;props.awake=new Map([[400,{}]]);props.stats={};
  props.pushers();
  for(let i=0;i<seconds*60;i++){
   // Actual frame ordering: physics, prop reconciliation, then walking input.
   physics.advance(1/60,0,0,0,0);props.pushers();player.updateWalk(1/60);
  }
  return {z:player.position.z,held:props.stats.held??0,speed:Math.hypot(player.velocity.x,player.velocity.z)};
 } finally {physics.free();}
}
test('An unrelated awake prop cannot hold back a sprinting walker without solver contact',()=>{
 const result=walk();
 assert.equal(result.held,0,`unrelated remote prop caused${result.held} false holds`);
 assert.ok(result.z<-17,`expected near6.2m/s sprint over3s; reached z=${result.z}`);
 assert.ok(result.speed>6);
});
test('Real contact with a heavy prop still restrains the walker',()=>{
 const result=walk({obstacle:true,seconds:4});
 assert.ok(result.held>0,'a heavy obstacle must generate real restraining contact');
 assert.ok(result.z>-5,'walker must not pass through the heavy box');
});
