import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
register('./style-transport-loader.mjs',import.meta.url);
const {Ferry}=await import('../src/ferry/Ferry.js');
import {FerryShip} from '../src/ferry/FerryShip.js';
import {FerryDeck} from '../src/ferry/FerryDeck.js';
import {Terminal,applyTerminalSite} from '../src/ferry/Terminal.js';
import {Crowd} from '../src/ferry/Crowd.js';
import {Contact} from '../src/people/Contact.js';
import {Player} from '../src/player/Player.js';
import {TerrainData} from '../src/world/TerrainData.js';
import {Colliders} from '../src/world/Colliders.js';
import {Group,Scene,PerspectiveCamera,Vector3} from '../src/engine/index.js';
import {parseGLB} from '../src/engine/loaders/GLTF.js';
import {SkinnedModel} from '../src/engine/render/Skinning.js';
import {StorageBuffer} from '../src/engine/gpu/Texture.js';
const V=(...a)=>new Vector3(...a),parse=b=>parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const playerGLB=parse(await readFile(new URL('../public/models/characters/player.glb',import.meta.url))),crowdGLB=parse(await readFile(new URL('../public/models/characters/crowd/f01.glb',import.meta.url)));
const terminalData=JSON.parse(await readFile(new URL('../public/ferry/terminal_colliders.json',import.meta.url))),deckData=JSON.parse(await readFile(new URL('../public/ferry/ferry_colliders.json',import.meta.url)));
const write=StorageBuffer.prototype.write;StorageBuffer.prototype.write=function(data){this.pendingData=data.slice();};test.after(()=>StorageBuffer.prototype.write=write);

test('The actual ferry update removes gangway support before advancing midspan passengers on the failure frame',()=>{
 const terrainData=new TerrainData();applyTerminalSite(terrainData);const colliders=new Colliders(),camera=new PerspectiveCamera(),input={down:()=>false,hit:()=>false};
 const player=new Player({camera,input,terrain:terrainData,colliders,query:{allocate:()=>0},boat:null});player.avatar={model:new SkinnedModel(playerGLB)};
 const app={terrainData,colliders,camera,player,scene:new Scene()},terminal=app.terminal=new Terminal(app);terminal.addColliders(terminalData);
 const ferry=new Ferry(app);app.ferry=ferry;ferry.ship=new FerryShip(ferry.at);ferry.ship.moor(ferry.at);ferry.deck=new FerryDeck(ferry,deckData);player.groundProviders.add(ferry.deck.support);
 ferry.parts={radars:[]};ferry.service={update(){},enabled:false,steering:false,phase:'disabled',pilot:{}};
 // No graphics, UI/audio or native vehicle platform is needed to exercise the
 // real hull, berth work, terminal collider switch and crowd/contact ordering.
 ferry.sync=()=>{};ferry.updateHud=()=>{};ferry.whine=()=>{};ferry.platformLowered=false;
 const hub=app.people={t:3,app,list:[],objects:{add:o=>o,release(){}},charge(){}};hub.contact=new Contact(hub);
 const crowd=ferry.crowd=new Crowd(app,ferry),m=new SkinnedModel(crowdGLB);m.play('idle_neutral_01',{fade:0});m.update(0);m.clipSet=new Set(m.clipNames());
 const at=V(160.9966102846997,7,309.7),velocity=V(-1.2015943427580953,0,0),p={id:1,kind:'foot',model:m,group:new Group(),world:at.clone(),base:at.clone(),based:true,off:V(),head:V(),_bv:velocity.clone(),_bp:at.clone().addScaledVector(velocity,-1/30),s:.12338971530040994,pace:1.2,path:[['T',11.12,7,9.7],['S',9.32,7,-15.5]],at:['S',7.7,7,-15.5],terminal,state:'board',brain:{type:'friendly',bump(){},speak(){}},clipOf:k=>k==='idle'?'idle_neutral_01':k,footing:()=> 'narrow',yaw:-Math.PI/2,look:0,pitch:0,tuck:0,acc:0,walk:1.3,lod:'far'};
 p.group.position.copy(at);crowd.people.push(p);hub.list.push(p);terminal.setGangway(0);
 assert.equal(player.groundAt(at.x,at.z,7.4),7);assert.equal(crowd.gangwayConnected(p),true);
 // Given the measured transition at warning expiry: hull lines have just
 // failed, while the previous frame's authored gangway is still out.
 ferry.ship.moored=false;ferry.ship.mooringFailed=true;
 ferry.update(1/30);
 assert.ok(ferry.gangway>0);assert.ok(player.groundAt(at.x,at.z,7.4)<3.3);
 assert.equal(p.knock?.kind,'tumble','lost physical support must hand off in the same published frame');
 assert.equal(p.knock.rag.rd.bodies.length,14);assert.equal(p.knock.rag.rd.joints.length,13);
 assert.ok(p.knock.physical.velocity.distanceTo(velocity)<1e-12,'handoff retains the last supported route velocity');
 assert.equal(p.s,.12338971530040994,'the disconnected route cannot advance');
});
