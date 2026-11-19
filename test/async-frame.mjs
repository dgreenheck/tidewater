import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine/Engine.js';
import {Input} from '../src/core/Input.js';

test('Engine serializes asynchronous simulation and stop drains without scheduling another frame',async()=>{
 const originalRAF=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame;
 const scheduled=new Map();let sequence=0;
 globalThis.requestAnimationFrame=fn=>{const id=++sequence;scheduled.set(id,fn);return id;};
 globalThis.cancelAnimationFrame=id=>scheduled.delete(id);
 const engine=Object.assign(Object.create(Engine.prototype),{clock:{update(){},getDelta:()=>.02,getElapsed:()=>1},resolution:{update(){}},frame:0});
 try{
  let finish,calls=0;engine.start(()=>{calls++;return new Promise(resolve=>finish=resolve);});
  const [id,loop]=[...scheduled][0];scheduled.delete(id);const active=loop(1);
  assert.equal(calls,1);assert.equal(scheduled.size,0);assert.equal(engine.frame,1);
  const drain=engine.stop();assert.ok(drain?.then);finish();await drain;await active;assert.equal(scheduled.size,0);
  engine.start(()=>calls++);const [next,again]=[...scheduled][0];scheduled.delete(next);await again(2);assert.equal(calls,2);assert.equal(scheduled.size,1);engine.stop();
 }finally{globalThis.requestAnimationFrame=originalRAF;globalThis.cancelAnimationFrame=originalCancel;}
});
test('Keyboard presses arriving during worker wait survive to the next frame exactly once',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document,events=new Map();
 globalThis.window={addEventListener:(type,fn)=>events.set(type,fn)};globalThis.document={addEventListener(){}};
 try{
  const input=new Input({addEventListener(){}}),press=code=>events.get('keydown')({code,preventDefault(){}});
  press('KeyF');input.beginFrame();assert.equal(input.hit('KeyF'),true);
  press('KeyM');assert.equal(input.hit('KeyM'),false);input.pressed.clear();assert.equal(input.hit('KeyF'),false);input.endFrame();input.beginFrame();assert.equal(input.hit('KeyF'),false);assert.equal(input.hit('KeyM'),true);
  input.endFrame();input.beginFrame();assert.equal(input.hit('KeyM'),false);input.endFrame();
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
