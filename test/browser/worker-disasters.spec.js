import {test,expect} from '@playwright/test';

test('Active worker steps respect pause, validation, stop and reset barriers',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=.5&noAudio');
 await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();await page.getByRole('button',{name:'Skip',exact:true}).click();
 await page.getByRole('button',{name:'Disasters',exact:true}).click();
 await expect(page.getByLabel('Playback',{exact:true})).toHaveValue('realtime');
 await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target location').selectOption('village');
 await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('100');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');
 await page.getByRole('button',{name:'Start disaster',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.ragdollPool.stats.accepted),{timeout:90000}).toBeGreaterThan(20);
 // Catch elapsed-lifetime being mistaken for one frame's wall interval.
 await expect.poll(()=>page.evaluate(()=>window.__app.simulationPacing.rate)).toBeGreaterThan(.1);
 expect(await page.evaluate(()=>window.__app.fps)).toBeGreaterThan(3);
 const queued=await page.evaluate(async()=>{
  const a=window.__app,deadline=performance.now()+15000;while(!a.simulationPending&&performance.now()<deadline)await new Promise(r=>setTimeout(r,0));
  if(!a.simulationPending)throw new Error('No active worker barrier');
  let validation='';try{a.disasters.start('earthquake',{intensity:999});}catch(e){validation=e.message;}
  a.disasters.pause(true);return {validation,queued:a.simulationChanges.length,paused:a.disasters.paused};
 });
 expect(queued.validation).toContain('Intensity');expect(queued.queued).toBe(1);expect(queued.paused).toBe(false);
 await expect.poll(()=>page.evaluate(()=>window.__app.disasters.paused)).toBe(true);
 const state=()=>page.evaluate(()=>{const a=window.__app;return {time:a.disasters.field.time,poses:Array.from(a.rally.physics.disaster_motion()),people:a.people.list.filter(p=>p.knock?.rag).map(p=>p.knock.rag.rd.bodies.map(b=>[b.x,b.q,b.v,b.w])),accepted:a.ragdollPool.stats.accepted};});
 const paused=await state();await page.waitForTimeout(600);expect(await state()).toEqual(paused);
 await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
 await page.evaluate(async()=>{const a=window.__app,deadline=performance.now()+15000;while(!a.simulationPending&&performance.now()<deadline)await new Promise(r=>setTimeout(r,0));if(!a.simulationPending)throw new Error('No reset barrier');a.disasters.stop();a.disasters.reset();});
 await expect.poll(()=>page.evaluate(()=>window.__app.disasters.restored)).toBe(true);
 expect(await page.evaluate(()=>({events:window.__app.disasters.field.events.size,time:window.__app.disasters.field.time,pending:window.__app.simulationPending}))).toEqual({events:0,time:0,pending:false});
 await page.getByRole('button',{name:'Start disaster',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.time)).toBeGreaterThan(.2);
 await page.getByLabel('Playback',{exact:true}).selectOption('smooth');
 await expect.poll(()=>page.evaluate(()=>window.__app.simulationPacing.mode)).toBe('smooth');
 await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
 expect(errors).toEqual([]);expect(await page.evaluate(()=>window.__app.ragdollPool.stats.failures)).toBe(0);
});
