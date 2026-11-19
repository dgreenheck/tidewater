import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {gliderVisibility,watchSwimEntry} from './helpers/glider-visibility.js';
import {captureSwimmerExposure} from './helpers/swimmer-exposure.js';

const click=(page,name)=>page.getByRole('button',{name,exact:true}).click();
const hud=page=>page.getByRole('status',{name:'Glider instruments'});
const observe=page=>page.evaluate(()=>{
 const a=window.__app,p=a.player,g=a.glider,f=g.flight;
 return {time:f.time,phase:f.phase,reason:f.reason,airTime:f.metrics.airTime,distance:f.metrics.distance,
  aircraft:f.position.slice(),quaternion:f.quaternion.slice(),yaw:p.yaw,bodyContacts:g.body?.contacts||0,lastContact:g.body?.lastContact||null,controls:{...f.controls},player:p.position.toArray(),velocity:p.velocity.toArray(),
  mode:p.mode,grounded:p.grounded,active:g.active,pilot:g.pilot,lastExit:g.lastExit,
  water:p.waterH,bed:a.terrainData.heightAt(p.position.x,p.position.z),view:p.view,thirdPerson:p.thirdPerson,
  camera:a.camera.position.toArray(),render:[a.sceneRenderer.width,a.sceneRenderer.height],resolution:a.engine.resolution.mode};
});
async function capture(page,testInfo,name){
 await page.screenshot({path:testInfo.outputPath(name+'.png')});
 await writeFile(testInfo.outputPath(name+'.json'),JSON.stringify({output:page.viewportSize(),state:await observe(page)},null,2));
}
function expectVisibleSwimmer(visual){
 expect(visual.avatar).toMatchObject({visible:true,view:'third',headHidden:false});
 const joints=visual.joints.filter(j=>/(Head|Neck|Spine2)$/.test(j.name));expect(joints).toHaveLength(3);
 for(const joint of joints){
  expect(joint.blocked,`${joint.name} hidden by the actual sail`).toBe(false);
  expect(joint.screen.front).toBe(true);expect(Math.abs(joint.screen.x)).toBeLessThan(.85);expect(Math.abs(joint.screen.y)).toBeLessThan(.85);
  expect(joint.distance).toBeGreaterThan(2.3);expect(joint.distance).toBeLessThan(8.5);
 }
 for(const surface of visual.surfaces){
  expect(surface.samples.length).toBeGreaterThan(12);
  const visible=surface.samples.filter(v=>!v.blocked&&v.screen.front&&Math.abs(v.screen.x)<.95&&Math.abs(v.screen.y)<.95);
  expect(visible.length/surface.samples.length,`${surface.region} rendered surface obscured/cropped`).toBeGreaterThan(.7);
 }
}

test('Glider water recovery: a real banked ditch releases local swimming, the swim camera and reusable launch controls',async({page},testInfo)=>{
 const rows=[],errors=[];let ditched,swimming,entryFrames,continuousExposure;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await test.step('Given a fresh real beach approach in a 7 m/s prevailing wind',async()=>{
   await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
   await page.goto('/?scale=1&noAudio');
   await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
   await click(page,'Click to explore');await click(page,'Skip');
   await click(page,'Performance');
   await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();
   await click(page,'Collapse (H)');await click(page,'Wind farm');
   await page.getByText('Shared island wind',{exact:true}).click();
   await page.getByLabel('Ambient wind (m/s)',{exact:true}).fill('7');
   await page.getByLabel('Wind direction (°)',{exact:true}).fill('70');await click(page,'Apply wind');
   await click(page,'Hang glider');await click(page,'Practice beach approach');
   await expect(hud(page)).toHaveAttribute('data-phase','airborne');
   await expect.poll(async()=>Number(await hud(page).getAttribute('data-agl'))).toBeGreaterThan(5);
  });
  await test.step('When I bank right and push out until the moving wing really reaches the bay',async()=>{
   // This is an intentionally poor recovery turn, not a safe ditching technique.
   // These are ordinary held keys; no flight state or position is supplied by the test.
   await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowDown');
   await expect.poll(async()=>{const row=await observe(page);rows.push(row);return row.phase;},{timeout:25000,intervals:[150]}).toBe('ditched');
   await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowDown');
   ditched=await observe(page);rows.push(ditched);
   expect(ditched.airTime).toBeGreaterThan(5);expect(ditched.distance).toBeGreaterThan(60);
   await expect(hud(page)).toContainText('Floating after water contact');
   await expect(hud(page)).toContainText('Water contact');
   await capture(page,testInfo,'actual-water-contact');
  });
  await test.step('When I leave the floating glider with X',async()=>{
   const entry=watchSwimEntry(page);await page.keyboard.press('x');entryFrames=await entry;rows.push({entryFrames});
  });
  await test.step('Then I swim beside the actual ditch with an ordinary water-level camera',async()=>{
   expect(entryFrames).toHaveLength(8);
   expect(new Set(entryFrames.map(entry=>entry.frame)).size).toBe(8);
   for(const entry of entryFrames){
    expect(entry.head.samples).toBeGreaterThan(12);
    const [x,,z]=entry.head.centre;
    expect(Math.hypot(x-entry.player[0],z-entry.player[2]),'the first skinned head must be at the local exit, not easing from the pre-flight island').toBeLessThan(.65);
    expect(entry.visible).toBe(true);expect(entry.headHidden).toBe(false);expect(entry.view).toBe('third');
    expect(entry.head.screen.front).toBe(true);expect(Math.abs(entry.head.screen.x)).toBeLessThan(.9);expect(Math.abs(entry.head.screen.y)).toBeLessThan(.9);
   }
   await expect(hud(page)).toBeHidden();
   await expect.poll(async()=>(await observe(page)).mode).toBe('swim');
   await expect(page.locator('.tw-mode-text')).toHaveText('Swimming');
   swimming=await observe(page);rows.push(swimming);
   expect(swimming.active).toBe(false);expect(swimming.pilot).toBe(false);expect(swimming.grounded).toBe(false);
   expect(Math.hypot(swimming.player[0]-ditched.aircraft[0],swimming.player[2]-ditched.aircraft[2])).toBeLessThan(6);
   expect(swimming.water-swimming.bed).toBeGreaterThan(1.35);
   expect(swimming.thirdPerson).toBe(true);
   expect(Math.hypot(...swimming.camera.map((n,i)=>n-swimming.player[i]))).toBeLessThan(9);
   expect(swimming.camera[1]-swimming.water).toBeGreaterThan(.45);
   expect([...swimming.player,...swimming.velocity,...swimming.camera].every(Number.isFinite)).toBe(true);
  });
  await test.step('When I swim forward and switch between the normal first and third person views',async()=>{
   const before=await observe(page);await page.keyboard.down('w');await page.waitForTimeout(1700);await page.keyboard.up('w');
   const after=await observe(page);rows.push(after);
   expect(after.mode).toBe('swim');expect(Math.hypot(after.player[0]-before.player[0],after.player[2]-before.player[2])).toBeGreaterThan(1);
   await page.keyboard.press('v');await expect.poll(async()=>(await observe(page)).view).toBe('first');
   const first=await observe(page);expect(Math.hypot(...first.camera.map((n,i)=>n-first.player[i]))).toBeLessThan(.6);
   await page.keyboard.press('v');await expect.poll(async()=>(await observe(page)).thirdPerson).toBe(true);
   // Let the normal avatar update restore the head collapsed by first person.
   await expect.poll(async()=>(await gliderVisibility(page)).avatar.headHidden).toBe(false);
   for(let i=0;i<4;i++){const visual=await gliderVisibility(page);rows.push({visual});expect(visual.triangles).toBeGreaterThan(1000);expectVisibleSwimmer(visual);await page.waitForTimeout(100);}
   await capture(page,testInfo,'local-swimming');swimming=await observe(page);
  });
  await test.step('When I swim toward the floating wing using ordinary movement keys',async()=>{
   await page.evaluate(captureSwimmerExposure,{start:true});
   const before=await observe(page),started=Date.now(),held=new Set();
   while(Date.now()-started<10000){
    const row=await observe(page);rows.push(row);if(row.bodyContacts>before.bodyContacts)break;
    const dx=row.aircraft[0]-row.player[0],dz=row.aircraft[2]-row.player[2],forward=-Math.sin(row.yaw)*dx-Math.cos(row.yaw)*dz,right=Math.cos(row.yaw)*dx-Math.sin(row.yaw)*dz;
    const wanted=new Set(['Space',Math.abs(forward)>Math.abs(right)?(forward>0?'w':'s'):(right>0?'d':'a')]);
    for(const key of held)if(!wanted.has(key)){await page.keyboard.up(key);held.delete(key);}
    for(const key of wanted)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
    await page.waitForTimeout(100);
   }
   for(const key of held)await page.keyboard.up(key);
   const contact=await observe(page);rows.push(contact);expect(contact.bodyContacts).toBeGreaterThan(before.bodyContacts);expect(contact.mode).toBe('swim');
   expect(contact.lastContact.correction).toBeLessThan(2.36);expect([...contact.player,...contact.velocity].every(Number.isFinite)).toBe(true);
   expect(Math.hypot(contact.player[0]-contact.aircraft[0],contact.player[2]-contact.aircraft[2])).toBeLessThan(7);
   for(let i=0;i<4;i++){const visual=await gliderVisibility(page);rows.push({contactVisual:visual});expectVisibleSwimmer(visual);await page.waitForTimeout(100);}
   await capture(page,testInfo,'swimmer-wing-contact');swimming=contact;
   continuousExposure=await page.evaluate(captureSwimmerExposure,{stop:true});
   await writeFile(testInfo.outputPath('swimmer-continuous-exposure.json'),JSON.stringify(continuousExposure,null,2));
   expect(continuousExposure.rows.length).toBeGreaterThan(40);
   expect(new Set(continuousExposure.rows.map(r=>r.frame)).size).toBe(continuousExposure.rows.length);
   // Test the full approach and real contact, not just four settled snapshots.
   // Actual wave submersion is recorded separately; a largely emerged head
   // must not spend a sustained interval behind the foil or its metal frame.
   let obscured=0,longest=0,obscuredWall=0,longestWall=0,previous=null;
   for(const row of continuousExposure.rows){
    expect(row.head.front).toBeGreaterThan(20);
    const dt=previous?Math.max(0,row.time-previous.time):0,wall=previous?Math.max(0,(row.wall-previous.wall)/1000):0,bad=row.head.aboveFraction>.3&&row.head.aboveVisibleFraction<.7;
    obscured=bad?obscured+dt:0;obscuredWall=bad?obscuredWall+wall:0;
    longest=Math.max(longest,obscured);longestWall=Math.max(longestWall,obscuredWall);previous=row;
   }
   continuousExposure.summary={longestObscuredSimulationSeconds:longest,longestObscuredWallSeconds:longestWall};
   await writeFile(testInfo.outputPath('swimmer-continuous-exposure.json'),JSON.stringify(continuousExposure,null,2));
   expect(longest,'the emerged head remained mostly obscured during the continuous swim/contact journey').toBeLessThan(.25);
   expect(longestWall,'the emerged head remained mostly obscured in real display time').toBeLessThan(.25);
  });
  await test.step('Then the visible reset permits another normal launch and leaving that flight rescues to the swimming entry point',async()=>{
   await click(page,'Hang glider');await click(page,'Reset glider');await click(page,'Launch glider');
   await expect(hud(page)).toHaveAttribute('data-phase','running');
   const launched=await observe(page);expect(launched.aircraft[1]).toBeGreaterThan(300);expect(launched.mode).toBe('glider');
   await page.keyboard.press('x');await expect(hud(page)).toBeHidden();
   await expect.poll(async()=>(await observe(page)).mode).toBe('swim');
   const reused=await observe(page);rows.push(reused);
   expect(Math.hypot(reused.player[0]-swimming.player[0],reused.player[2]-swimming.player[2])).toBeLessThan(3);
   expect(reused.active).toBe(false);expect(reused.pilot).toBe(false);expect(reused.thirdPerson).toBe(true);
   expect(errors).toEqual([]);
  });
 }finally{
  for(const key of ['ArrowRight','ArrowDown','w','s','a','d','Space'])await page.keyboard.up(key);
  if(!continuousExposure){try{continuousExposure=await page.evaluate(captureSwimmerExposure,{stop:true});await writeFile(testInfo.outputPath('swimmer-continuous-exposure.json'),JSON.stringify(continuousExposure,null,2));}catch{}}
  await writeFile(testInfo.outputPath('water-exit-observations.json'),JSON.stringify({rows,errors},null,2));
 }
});
