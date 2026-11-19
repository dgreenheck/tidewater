import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const OUT=process.env.PW_OUT||'test-results';
test.use({video:{mode:'on',size:{width:1440,height:900}}});
async function ready(page,query=''){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto(`/?scale=${process.env.PW_STANDARD==='1'?'1':'.6'}&noAudio`+query);await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length),{timeout:30000}).toBe(26);
 if(process.env.PW_STANDARD==='1'){
  await page.getByRole('button',{name:'Performance',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();
  await page.getByRole('button',{name:'Collapse (H)',exact:true}).click();
 }
}
test('Walking into a real vortex releases locomotion to articulated physics without a timed airborne get-up',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let origin;
 await test.step('Given I am walking at the ordinary island arrival point',async()=>{
  await ready(page);origin=await page.evaluate(()=>window.__app.player.position.toArray());expect(await page.evaluate(()=>window.__app.player.mode)).toBe('walk');
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target location').selectOption('custom');
  await page.getByLabel('Target X (m)').fill(String(origin[0]-20));await page.getByLabel('Target Z (m)').fill(String(origin[2]));
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('120');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Duration (s)').fill('40');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');
 });
 await test.step('When I start the vortex through its controls and keep the forward key held',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  await page.keyboard.press('Escape');await page.locator('canvas').first().click({position:{x:700,y:420}});await page.keyboard.down('KeyW');
 });
 await test.step('Then the rendered character uses fourteen jointed physical bodies and stays physical while airborne',async()=>{
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],start=a.disasters.field.time,end=performance.now()+90000;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.player,r=p.rag,s=a.disasters.field.sample(p.position.x,p.position.y,p.position.z);rows.push({worldTime:a.disasters.field.time-start,mode:p.mode,from:p.ragFrom,phase:r.phase,simTime:r.t,position:p.position.toArray(),updraft:s.wy,supported:r.supported,parts:r.bodies.length,joints:r.joints?.length??0,mass:r.bodies.reduce((m,b)=>m+b.m,0),energy:r.bodies.reduce((e,b)=>e+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2),0),caps:r.stats?.capped,solver:r.stats?{...r.stats}:null,limits:r.stats?{swing:r.stats.swing,hinge:r.stats.hinge,twist:r.stats.twist}:null,body:r.bodies.map(b=>({p:[b.x.x,b.x.y,b.x.z],v:[b.v.x,b.v.y,b.v.z],w:[b.w.x,b.w.y,b.w.z]}))});if(a.disasters.field.time-start>=13)break;}return rows;});
  await page.keyboard.up('KeyW');await test.info().attach('ordinary-walking-vortex-frames',{body:JSON.stringify(rows),contentType:'application/json'});await writeFile(test.info().outputPath('ordinary-walking-vortex-frames.json'),JSON.stringify(rows));await page.screenshot({path:`${OUT}/walking-vortex.png`});
  expect(rows.some(r=>r.updraft>18),'the actual character must meet the visible event').toBe(true);
  const physical=rows.filter(r=>r.mode==='ragdoll'&&r.from==='walk');expect(physical.length,'Walking cannot remain a run animation inside the capture region').toBeGreaterThan(10);
  expect(physical.every(r=>r.parts===14&&r.joints===13&&r.mass===75&&r.body.flatMap(b=>[...b.p,...b.v,...b.w]).every(Number.isFinite))).toBe(true);
  expect(rows.at(-1).worldTime,'observe thirteen actual simulation seconds, including legitimate landings and later recaptures').toBeGreaterThanOrEqual(13);
  expect(rows.filter(r=>!r.supported&&r.phase==='getup'),'elapsed time cannot start a get-up in open air').toEqual([]);
  const steps=physical.filter(r=>r.solver?.frames>0);expect(steps.length).toBeGreaterThan(0);
  expect(steps.every(r=>r.solver.maxIntegratedAngle<=.100001&&r.solver.maxNearTravelRatio<=.150001),'actual post-force motion must stay within the integration geometry bounds').toBe(true);
  expect(steps.every(r=>r.solver.capped===r.solver.protectionCount&&r.solver.droppedTime===0&&r.solver.protectionBoundExceeded===0),'every emergency intervention and all accepted time must be accounted').toBe(true);
  expect(steps.every(r=>Math.abs(r.solver.protectionEnergy-r.solver.protectionTranslationEnergy-r.solver.protectionRotationEnergy)<1e-4)).toBe(true);expect(errors).toEqual([]);
 });

 await test.step('When I stop the vortex with its controls then the physical body settles and ordinary control returns',async()=>{
  await page.keyboard.press('Escape');if(!await page.getByRole('button',{name:'Stop all disasters',exact:true}).isVisible())await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],end=performance.now()+25000;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.player,r=p.rag;rows.push({mode:p.mode,phase:r.phase,position:p.position.toArray(),stats:{...r.stats},spin:Math.max(0,...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z)))});if(['walk','swim','ferry'].includes(p.mode))break;}return rows;});
  await writeFile(test.info().outputPath('vortex-stopped-recovery.json'),JSON.stringify(rows));await test.info().attach('vortex-stopped-recovery',{body:JSON.stringify(rows),contentType:'application/json'});await page.screenshot({path:`${OUT}/vortex-stopped-recovery.png`});
  expect(['walk','swim','ferry']).toContain(rows.at(-1).mode);expect(rows.every(r=>r.position.every(Number.isFinite))).toBe(true);expect(errors).toEqual([]);
 });
});

test('An ordinary sprint into a beach player transfers momentum into stable jointed motion',async({page})=>{
 let target,seen;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given I start beside the beach games with an adult frisbee player in sight',async()=>{
  await ready(page);target=await page.evaluate(()=>{const a=window.__app,p=a.beach.people.filter(p=>p.role==='frisbee'&&p.brain.type!=='kid').sort((a,b)=>a.world.x-b.world.x)[0];return p?{id:p.id,at:p.world.toArray()}:null;});expect(target).not.toBeNull();await page.locator('canvas').first().click({position:{x:700,y:420}});
 });
 await test.step('When I use ordinary walking and sprint keys to approach and bump them',async()=>{
  // Steering chooses real key presses from read-only observed relative position.
  // No player, NPC, velocity, clock, or contact state is assigned by the test.
  const held=new Set(),approach=[];let retreat=false,contacts=0;await page.keyboard.down('ShiftLeft');
  for(let i=0;i<400;i++){
   const s=await page.evaluate(id=>{const a=window.__app,p=a.player,n=a.beach.people.find(n=>n.id===id);return{at:p.position.toArray(),yaw:p.yaw,npc:n.world.toArray(),knock:n.knock?.kind,log:a.people.contact.log.filter(x=>x.id===id),cooldown:(n.bumpUntil||0)-a.people.t,mode:p.mode};},target.id);approach.push(s);
   if(s.knock==='tumble'){seen=s;break;}
   if(s.log.length>contacts){contacts=s.log.length;retreat=true;}
   const dx=s.npc[0]-s.at[0],dz=s.npc[2]-s.at[2],distance=Math.hypot(dx,dz),keys=new Set();
   // A glancing approach can produce a legitimate stagger. Walk back into
   // clear space, wait for recovery, then make another ordinary running pass.
   if(retreat&&distance>4.5&&s.cooldown<=0)retreat=false;
   const direction=retreat?-1:1,f=direction*(-dx*Math.sin(s.yaw)-dz*Math.cos(s.yaw)),r=direction*(dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw));
   if(!retreat||distance<4.6){if(Math.abs(f)>.12)keys.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.12)keys.add(r>0?'KeyD':'KeyA');}
   for(const k of held)if(!keys.has(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}await page.waitForTimeout(100);
  }
  for(const k of held)await page.keyboard.up(k);await page.keyboard.up('ShiftLeft');await writeFile(test.info().outputPath('ordinary-sprint-approach.json'),JSON.stringify(approach));expect(seen,'ordinary input must make an actual contact, otherwise this is not a ragdoll test').toBeTruthy();
 });
 await test.step('Then the affected person has physical joints, finite pose and bounded contact motion',async()=>{
  const frames=await page.evaluate(async id=>{const a=window.__app,rows=[],end=performance.now()+5500;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.beach.people.find(p=>p.id===id),r=p.knock?.rag?.rd;if(!r)continue;rows.push({phase:r.phase,parts:r.bodies.length,joints:r.joints.length,mass:r.mass,player:a.player.position.toArray(),world:p.world.toArray(),wear:p.wear?.map(w=>{const wanted=w.g.matrix.clone().fromArray(p.model.world,w.h*16).multiply(w.L).elements;return {name:w.n,error:Math.max(...wanted.map((v,i)=>Math.abs(v-w.g.matrix.elements[i])))};}),energy:r.bodies.reduce((e,b)=>{const axis=a.player.position.clone().set(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),along=axis.x*b.w.x+axis.y*b.w.y+axis.z*b.w.z;return e+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2)+.5*((b.w.x**2+b.w.y**2+b.w.z**2-along**2)/b.iPerp+along**2/b.iAx);},0),spin:Math.max(...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z))),caps:r.stats.capped,limits:{swing:r.stats.swing,hinge:r.stats.hinge,twist:r.stats.twist},body:r.bodies.map(b=>[b.x.x,b.x.y,b.x.z,b.v.x,b.v.y,b.v.z,b.w.x,b.w.y,b.w.z])});}return rows;},target.id);
  await test.info().attach('ordinary-sprint-contact-frames',{body:JSON.stringify({target,seen,frames}),contentType:'application/json'});await writeFile(test.info().outputPath('ordinary-sprint-contact-frames.json'),JSON.stringify({target,seen,frames}));await page.screenshot({path:`${OUT}/npc-sprint-contact.png`});
  expect(frames.length).toBeGreaterThan(5);expect(frames.every(r=>r.parts===14&&r.joints===13&&r.mass===72&&r.body.flat().every(Number.isFinite))).toBe(true);
  expect(Math.max(...frames.map(r=>Math.hypot(r.player[0]-target.at[0],r.player[2]-target.at[2])))).toBeLessThan(35);
  expect(Math.max(...frames.map(r=>r.energy))).toBeLessThan(5000);
  expect(Math.max(...frames.map(r=>r.spin)),'ordinary contact cannot produce runaway limb spin').toBeLessThan(50);
  expect(Math.max(...frames.map(r=>r.caps)),'ordinary contact must not depend on emergency numerical guards').toBe(0);
  expect(frames.every(r=>r.wear?.length>0),'the contacted person must actually wear the observed head prop').toBe(true);
  expect(Math.max(...frames.flatMap(r=>r.wear.map(w=>w.error))),'worn props must follow the rendered head through falling and getting up').toBeLessThan(1e-4);
  expect(Math.max(...frames.flatMap(r=>Object.values(r.limits))),'physical joints stay near their authored limits').toBeLessThan(8);
  expect(frames.some(r=>r.phase==='getup'||r.phase==='idle'),'the body must settle and begin recovery').toBe(true);expect(errors).toEqual([]);
 });
});

test('Ferry passengers retain real support or physical motion when flood separates the gangway',async({page})=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let aboard;
 await test.step('Given the actual ferry service is boarding through its connected gangway',async()=>{
  // The shipped short timetable changes only the layover wait; vessel dynamics,
  // crowd paths, water and contacts are the ordinary production systems.
  await ready(page,'&ferryTimetable=short');
  await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd.people.filter(p=>p.path?.some(v=>v[0]==='T')&&p.path.some(v=>v[0]==='S')).length),{timeout:45000}).toBeGreaterThan(0);
  aboard=await page.evaluate(()=>window.__app.ferry.ship.position.toArray());
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption('tsunami');await page.getByLabel('Target location').selectOption('custom');await page.getByLabel('Target X (m)').fill(String(aboard[0]));await page.getByLabel('Target Z (m)').fill(String(aboard[2]));
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Duration (s)').fill('60');await page.getByLabel('Warning lead time (s)').fill('3');await page.getByRole('button',{name:'View target',exact:true}).click();
 });
 await test.step('When I start the wave through the disaster controls',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
 });
 await test.step('Then separated-route passengers cannot keep following a moving endpoint across unsupported water',async()=>{
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],end=performance.now()+65000;let afterFailure=null;while(performance.now()<end){await new Promise(requestAnimationFrame);const f=a.ferry,c=f.crowd;if(f.ship.mooringFailed&&afterFailure===null)afterFailure=performance.now();rows.push({time:a.disasters.field.time,wallMs:performance.now(),frame:a.engine.frame,camera:{p:a.camera.position.toArray(),q:a.camera.quaternion.toArray(),fov:a.camera.fov,aspect:a.camera.aspect},structures:[...a.disasters.structures.bodies.values()].map(b=>({id:b.id,p:b.position.toArray(),q:b.quaternion.toArray()})),ship:f.ship.position.toArray(),failed:!!f.ship.mooringFailed,gangway:f.gangway,moored:f.ship.moored,people:c.people.map(p=>{const r=p.knock?.rag?.rd,ground=a.player.groundAt(p.world.x,p.world.z,p.world.y+.45),shore=p.terminal?.toWorld([11.12,7,9.7]),deck=f.ship.toWorld(p.world.clone().set(9.32,7,-15.5));const connected=!!(shore&&f.ship.moored&&!f.castingOff&&f.gangway===0&&f.at?.terminal===p.terminal&&Math.hypot(shore.x-deck.x,shore.z-deck.z)<4&&Math.abs(shore.y-deck.y)<.45);return{id:p.id,world:p.world.toArray(),state:p.state,local:p.local?.toArray(),path:p.path?.slice(0,2),s:p.s,knock:p.knock?.kind,phase:r?.phase,parts:r?.bodies.length??0,joints:r?.joints.length??0,support:ground,connected,velocity:r?.pelvis?[r.pelvis.v.x,r.pelvis.v.y,r.pelvis.v.z]:p._bv?.toArray()};}),rigs:a.people.contact.tumbles.state()});if(afterFailure&&performance.now()-afterFailure>10000)break;}return rows;});
  // Retain authored identity and rest bounds once, then match them to each
  // frame's read-only poses. Large imported pieces can be distinguished from
  // stretched connectors without inferring their identity from a screenshot.
  const structureMetadata=await page.evaluate(()=>[...window.__app.disasters.structures.bodies.values()].map(b=>{
   const member=b.member,spans=member?.spans??b.spans,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   for(const span of spans)for(let i=0;i<span.pos.length;i++) {const axis=i%3;lo[axis]=Math.min(lo[axis],span.pos[i]);hi[axis]=Math.max(hi[axis],span.pos[i]);}
   return {id:b.id,name:b.name,kind:b.kind,origin:b.origin.toArray(),half:b.half.toArray(),restQuaternion:b.restQuaternion?.toArray()??[0,0,0,1],mass:b.mass,restBounds:{lo,hi},vertices:spans.reduce((n,s)=>n+s.count,0),member:member?{material:member.material,length:member.length,center:member.center.toArray(),axes:member.axes.map(v=>v.toArray()),sections:member.sections.map(s=>s.id)}:null};
  }));
  await writeFile(test.info().outputPath('ferry-structural-identities.json'),JSON.stringify(structureMetadata,null,2));
  await test.info().attach('ferry-flood-support-frames',{body:JSON.stringify(rows),contentType:'application/json'});await writeFile(test.info().outputPath('ferry-flood-support-frames.json'),JSON.stringify(rows));await page.screenshot({path:`${OUT}/ferry-flood-support.png`});
  const render=await page.evaluate(()=>({render:[window.__app.sceneRenderer.width,window.__app.sceneRenderer.height],scale:window.__app.settings.renderScale,viewport:[innerWidth,innerHeight]}));
  await writeFile(test.info().outputPath('ferry-render.json'),JSON.stringify(render));
  if(process.env.PW_STANDARD==='1')expect(render.render).toEqual([1440,900]);
  expect(rows.some(r=>r.failed),'the wave must really displace the moored ferry').toBe(true);
  const unsupported=rows.flatMap(r=>r.people.filter(p=>p.connected===false&&p.path?.length===2&&p.path[0][0]!==p.path[1][0]&&p.s>0&&!p.knock&&p.world[1]-p.support>.55));expect(unsupported,'people on a removed bridge must enter physical motion, not route interpolation').toEqual([]);
  const physical=rows.flatMap(r=>r.people.filter(p=>p.phase==='sim'));expect(physical.length).toBeGreaterThan(0);expect(physical.every(p=>p.parts===14&&p.joints===13&&p.world.concat(p.velocity||[]).every(Number.isFinite))).toBe(true);expect(errors).toEqual([]);
 });
});
