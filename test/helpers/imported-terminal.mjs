import {readFile} from 'node:fs/promises';
import {Group} from '../../src/engine/index.js';
import {loadModel,cloneVehicle} from '../../src/rally/VehicleModel.js';
import {Terminal} from '../../src/ferry/Terminal.js';
import {terminalPaint} from '../../src/ferry/TerminalPaint.js';
import {Colliders} from '../../src/world/Colliders.js';

// The shipped GLB, production loader, terminal placement and collision importer.
// Only file transport replaces browser fetch; no substitute geometry or renderer.
export async function importedTerminalFixture({both=false,physics=null,terrain={heightAt:()=>-1000}}={}){
 const previous=globalThis.__assetFile;let model;
 globalThis.__assetFile=async url=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
 try{model=await loadModel(new URL('../../public/ferry/terminal.glb',import.meta.url),{customize:terminalPaint});}finally{if(previous)globalThis.__assetFile=previous;else delete globalThis.__assetFile;}
 const app={scene:new Group(),colliders:new Colliders(),terrainData:terrain,rally:{physics,refreshIslandColliders(){}}};
 const data=JSON.parse(await readFile(new URL('../../public/ferry/terminal_colliders.json',import.meta.url),'utf8'));
 app.terminal=new Terminal(app);app.terminal.place(model,performance.now());app.terminal.addColliders(data);
 if(both){app.joeyTerminal=new Terminal(app,'joey');app.joeyTerminal.place(cloneVehicle(model),performance.now());app.joeyTerminal.addColliders(data);}
 return app;
}
