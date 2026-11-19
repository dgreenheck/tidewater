import {test,expect} from '@playwright/test';
const OUT=process.env.PW_OUT||'test-results';
async function island(page){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=0.5&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length)).toBe(26);
}
async function tsunami(page,lead){
 await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption('tsunami');await page.getByLabel('Target location').selectOption('pier');
 await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');await page.getByLabel('Warning lead time (s)').fill(String(lead));await page.getByLabel('Duration (s)').fill('90');
 await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
}
test('A rapidly rising tsunami changes the actual player to swimming and carries them with the current',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let original,observed;
 await test.step('Given the player is walking at the original boardwalk while the sea is calm',async()=>{await island(page);original=await page.evaluate(()=>window.__app.player.position.toArray());await expect(page.locator('.tw-mode-text')).toHaveText('Walking');});
 await test.step('When I start the strongest tsunami with a three second warning',async()=>{await tsunami(page,3);});
 await test.step('Then a crest above the head cannot leave actual mode or the HUD Walking, and the swimming body receives current',async()=>{
  // Read-only frame observations include the actual mode, its GPU water sample,
  // scene position and shared current. No game action or state is injected here.
  observed=await page.evaluate(async()=>{
   const a=window.__app,rows=[],deadline=performance.now()+45000;let movingSwim=0;
   while(performance.now()<deadline){await new Promise(requestAnimationFrame);const p=a.player,s=a.disasters.field.sample(p.position.x,p.position.y,p.position.z),row={time:a.disasters.field.time,mode:p.mode,water:p.waterH,mean:p.waterMean,position:p.position.toArray(),velocity:p.velocity.toArray(),current:Math.hypot(s.ux,s.uz),fieldWater:s.height,hud:document.querySelector('.tw-mode-text')?.textContent};rows.push(row);
    if(p.mode==='swim'&&row.current>1&&p.velocity.length()>.5)movingSwim++;if(movingSwim>45)break;
   }return rows;
  });
  await test.info().attach('player-flood-frames',{body:JSON.stringify(observed),contentType:'application/json'});
  await page.screenshot({path:`${OUT}/player-flood.png`});
  expect(observed.some(r=>r.water>original[1]+2),'Actual local water must rise above the original standing head').toBe(true);
  const submergedWalk=observed.filter(r=>r.mode==='walk'&&r.water-r.position[1]>1.75);
  expect(submergedWalk,'No frame may keep actual Walking after the live water covers the head').toEqual([]);
  const swim=observed.filter(r=>r.mode==='swim'&&r.current>1);expect(swim.length).toBeGreaterThan(10);
  expect(swim.some(r=>Math.hypot(r.position[0]-original[0],r.position[2]-original[2])>1&&Math.hypot(...r.velocity)>.5),'Current moves the actual swimming body').toBe(true);
  expect(swim.every(r=>['Swimming','Diving'].includes(r.hud))).toBe(true);expect(errors).toEqual([]);
 });
 await test.step('When I restore the island then the original walking position and mode return',async()=>{await page.getByRole('button',{name:'Restore island',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();await expect(page.locator('.tw-mode-text')).toHaveText('Walking');const restored=await page.evaluate(()=>window.__app.player.position.toArray());expect(Math.hypot(...restored.map((v,i)=>v-original[i]))).toBeLessThan(.5);const modes=await page.evaluate(async()=>{const modes=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);modes.push(window.__app.player.mode);}return modes;});expect(modes.every(m=>m==='walk')).toBe(true);});
 await test.step('When I start another short warning wave then the fresh water query can trigger swimming again',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();await expect.poll(()=>page.evaluate(()=>window.__app.player.mode),{timeout:60000}).toBe('swim');await page.getByRole('button',{name:'Restore island',exact:true}).click();await expect(page.locator('.tw-mode-text')).toHaveText('Walking');});
});

test('Wading into the calm sea to knee depth and sprinting back out never trips the player',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let shore,wadeIn,wadeOut;
 // Read-only per-frame observation while the held keys act: mode, depth at the feet, position.
 const watch=(until,limit)=>page.evaluate(async([until,limit])=>{
  const p=window.__app.player,rows=[],end=performance.now()+limit;
  while(performance.now()<end){await new Promise(requestAnimationFrame);const row={mode:p.mode,depth:p.waterH-p.position.y,position:p.position.toArray(),speed:Math.hypot(p.velocity.x,p.velocity.z)};rows.push(row);
   if(until==='knee'?row.depth>=.45:row.depth<=0&&rows.some(r=>r.depth>.2))break;}
  return rows;},[until,limit]);
 await test.step('Given I stand on the beach sand facing the calm sea with no disaster running',async()=>{
  await island(page);await page.keyboard.press('Escape');await page.locator('canvas').first().click({position:{x:700,y:420}});
  // Staging only: from the beach review view (DebugViews beach, x 15 z -58) find the shortest run from
  // dry sand (0.25 m above sea level) to past knee depth (0.8 m under), and stand him at its top facing
  // the water. The walk itself is the When step and uses only the held keys.
  shore=await page.evaluate(()=>{const a=window.__app,p=a.player,h=(x,z)=>p.terrain.heightAt(x,z);let best=null;
   for(let k=0;k<64;k++){const ang=k*Math.PI/32,dx=Math.sin(ang),dz=Math.cos(ang);let dry=null;
    for(let s=0;s<60;s+=.25){const g=h(15+dx*s,-58+dz*s);if(g>.25)dry=s;else if(dry!==null&&g<-.8){if(!best||s-dry<best.run)best={run:s-dry,x:15+dx*dry,z:-58+dz*dry,dx,dz};break;}}}
   if(best){p.debugPlace(best.x,h(best.x,best.z),best.z,'walk');p.yaw=Math.atan2(-best.dx,-best.dz);}
   return {...best,events:a.disasters.field.events.size};});
  expect(shore?.run,'a beach slope into the sea exists near the beach view').toBeLessThan(40);expect(shore.events).toBe(0);
  await expect(page.locator('.tw-mode-text')).toHaveText('Walking');
 });
 await test.step('When I hold W into the sea until the water reaches my knees',async()=>{
  await page.keyboard.down('KeyW');wadeIn=await watch('knee',20000);await page.keyboard.up('KeyW');
  await page.screenshot({path:`${OUT}/player-wading-knee.png`});
 });
 await test.step('And I hold Shift and S to sprint back out onto the sand',async()=>{
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyS');wadeOut=await watch('dry',20000);await page.keyboard.up('KeyS');await page.keyboard.up('ShiftLeft');
  await page.screenshot({path:`${OUT}/player-wading-out.png`});
 });
 await test.step('Then I stayed on my feet the whole way in and out',async()=>{
  const rows=[...wadeIn,...wadeOut];await test.info().attach('player-wading-frames',{body:JSON.stringify({shore,rows}),contentType:'application/json'});
  const fell=rows.filter(r=>r.mode==='ragdoll');
  expect(fell.length,`ragdoll frames while wading calm sea (first at depth ${fell[0]?.depth?.toFixed(2)} m)`).toBe(0);
  expect(Math.max(...wadeIn.map(r=>r.depth)),'the walk reached knee depth').toBeGreaterThanOrEqual(.45);
  expect(wadeIn.filter(r=>r.depth>.1&&r.mode==='walk').length,'he waded on foot, not swimming').toBeGreaterThan(10);
  expect(wadeOut.at(-1).depth,'the sprint ended back on the sand').toBeLessThanOrEqual(0);
  expect(Math.max(...wadeOut.map(r=>r.speed)),'Shift sprinted him out faster than a walk').toBeGreaterThan(3);
  await expect(page.locator('.tw-mode-text')).toHaveText('Walking');expect(errors).toEqual([]);
 });
});

test('The hire attendant leaves a supported stool during a calm warning without a collider launch',async({page})=>{
 let before,observed;
 await test.step('Given the attendant is seated beside the real hire stand',async()=>{await island(page);before=await page.evaluate(()=>window.__app.beach.attendant.world.toArray());});
 await test.step('When I start a ninety second warning without launching the wave yet',async()=>{await tsunami(page,90);});
 await test.step('Then the attendant walks toward refuge without tumbling or a large collision projection',async()=>{
  observed=await page.evaluate(async()=>{const a=window.__app,p=a.beach.attendant,rows=[],end=performance.now()+8000;while(performance.now()<end){await new Promise(requestAnimationFrame);rows.push({position:p.world.toArray(),phase:p.evacuation?.phase,knock:p.knock?.kind??null,speed:p.evacuation?.velocity.length()??0,launched:a.disasters.field.events.get('tsunami')?.launched});}return rows;});
  await test.info().attach('attendant-warning-frames',{body:JSON.stringify(observed),contentType:'application/json'});await page.screenshot({path:`${OUT}/attendant-warning.png`});
  expect(observed.every(r=>r.launched===false)).toBe(true);expect(observed.filter(r=>r.knock),'Calm warning must not turn spawn overlap into a tumble').toEqual([]);
  expect(Math.max(...observed.map(r=>r.speed))).toBeLessThan(6);const last=observed.at(-1);expect(Math.hypot(last.position[0]-before[0],last.position[2]-before[2])).toBeGreaterThan(2);
  await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
 });
});

test('An exposed swimmer enters the existing physical ragdoll under a real tornado updraft',async({page})=>{
 await test.step('Given I have launched a short warning wave and the player has entered the water',async()=>{await island(page);await tsunami(page,3);await expect.poll(()=>page.evaluate(()=>window.__app.player.mode),{timeout:60000}).toBe('swim');await page.getByRole('button',{name:'Pause simulation',exact:true}).click();});
 await test.step('When I start a stationary strong tornado over the swimming player through the disaster controls',async()=>{
  const at=await page.evaluate(()=>window.__app.player.position.toArray());await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target location').selectOption('custom');await page.getByLabel('Target X (m)').fill(String(at[0]));await page.getByLabel('Target Z (m)').fill(String(at[2]));await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('120');await page.getByLabel('Radius (m)').fill('400');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');await page.getByLabel('Duration (s)').fill('40');await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
 });
 await test.step('Then upward wind releases surface control to fourteen physical capsules without a scripted launch',async()=>{
  const observed=[];try{await expect.poll(async()=>{const state=await page.evaluate(()=>{const a=window.__app,p=a.player,s=a.disasters.field.sample(p.position.x,p.position.y,p.position.z);return {mode:p.mode,from:p.ragFrom,position:p.position.toArray(),water:p.waterH,updraft:s.wy,appliedUpdraft:p.swimMotor?.load.wy,time:a.disasters.field.time};});observed.push(state);return state.mode==='ragdoll'&&state.from==='swim';},{timeout:12000,intervals:[100]}).toBe(true);}finally{await test.info().attach('updraft-transition-observations',{body:JSON.stringify(observed),contentType:'application/json'});}expect(observed.some(s=>s.updraft>18)).toBe(true);
  const result=await page.evaluate(()=>{const a=window.__app,p=a.player,r=p.rag;return {mode:p.mode,from:p.ragFrom,mass:r.bodies.reduce((m,b)=>m+b.m,0),count:r.bodies.length,field:r.disasterField===a.disasters.field,bodies:r.bodies.map(b=>({position:[b.x.x,b.x.y,b.x.z],velocity:[b.v.x,b.v.y,b.v.z]}))};});
  expect(result.count).toBe(14);expect(result.mass).toBe(75);expect(result.field).toBe(true);expect(result.bodies.every(b=>b.position.concat(b.velocity).every(Number.isFinite))).toBe(true);await test.info().attach('swimmer-updraft-body-state',{body:JSON.stringify(result),contentType:'application/json'});await page.screenshot({path:`${OUT}/swimmer-updraft.png`});
 });
});
