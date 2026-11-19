import test from 'node:test';
import assert from 'node:assert/strict';
import {Disasters} from '../src/disasters/Disasters.js';
import {DisasterField} from '../src/disasters/Field.js';
import {TornadoVisuals} from '../src/disasters/TornadoVisuals.js';
import {Scene,Vector3} from '../src/engine/index.js';

test('The actual director completes the last tornado optical population at natural expiry',()=>{
 const field=new DisasterField(()=>0),event=field.start('tornado',{intensity:100,radius:180,speed:0,duration:3});
 const app={scene:new Scene(),camera:{position:new Vector3(0,50,200)},sceneRenderer:{opaqueCopy:{depthTexture:null}},ferry:{ship:{}}};
 const director=Object.create(Disasters.prototype);Object.assign(director,{app,field,paused:false,waterMs:0,water:{update(){}},siren:{update(){}},external:new Set(),structures:{update(){}},bodies:{update(){}},loads(){},people(){},parkedSkis(){},wakeProps(){}});
 director.tornadoVisuals=new TornadoVisuals(app,field);director.funnel=director.tornadoVisuals.group;
 while(event.time<1.5)director.before(1/60);
 assert.ok(director.tornadoVisuals.particles.snapshot().budget.sourceLiquidMass>0,'fixture must create actual liquid clouds through director.before');
 while(field.events.size)director.before(1/60);
 const view=director.tornadoVisuals,snapshot=view.snapshot();
 assert.equal(view.dust.geometry.instanceCount,0,'last-event expiry must retire rendered instances through the real director');
 assert.ok(snapshot.completedBudget,'natural completion must preserve the exported population ledger');
 const b=snapshot.completedBudget;
 for(const material of ['Dust','Liquid'])for(const quantity of ['Mass','Extinction']){
  const evaporated=material==='Liquid'?b[quantity==='Mass'?'evaporatedLiquidMass':'evaporatedExtinction']:0;
  const loss=b['live'+material+quantity]+b['exported'+material+quantity]+b['deposited'+material+quantity]+evaporated;
  assert.ok(Math.abs(b['source'+material+quantity]-loss)<1e-8,'real completion must close its source ledger');
 }
 director.before(.1);assert.deepEqual(view.snapshot().completedBudget,b,'later calm frames retain the completed ledger');
 view.clear();assert.equal(view.snapshot().completedBudget,null,'explicit Stop/Restore clear remains immediate');
});
