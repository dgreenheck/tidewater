import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createPilot} from './helpers/gliderJourneyPilot.mjs';

// Test-only pilot: observations choose ordinary keyboard events. It cannot
// mutate the glider, call flight methods, supply lift, or reposition the body.
test('Hang glider: uninterrupted summit launch through shared wind to a controlled beach landing',async({page},testInfo)=>{
 test.setTimeout(540000);
 const errors=[],rows=[],actions=[],started=Date.now();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const hud=page.getByRole('status',{name:'Glider instruments'});
 const snapshot=()=>page.evaluate(()=>{
  const a=window.__app,g=a.glider,f=g.flight,s=a.disasters.field.sample(...f.position);
  return {wall:performance.now(),time:f.time,phase:f.phase,reason:f.reason,position:[...f.position],velocity:[...f.velocity],quaternion:[...f.quaternion],omega:[...f.omega],metrics:structuredClone(f.metrics),controls:{...f.controls},sharedWind:[s.wx,s.wy,s.wz],active:g.active,mode:a.player.mode,discardedTime:g.discardedTime,render:[a.sceneRenderer.width,a.sceneRenderer.height],resolution:a.engine.resolution.mode};
 });
 await test.step('Given the real island with a 7 m/s prevailing wind and the intact summit launch',async()=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.goto('/?scale=1&noAudio');
  await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();
  await page.getByRole('button',{name:'Performance',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();
  await page.getByRole('button',{name:'Collapse (H)',exact:true}).click();
  await page.getByRole('button',{name:'Wind farm',exact:true}).click();
  await page.getByText('Shared island wind',{exact:true}).click();
  await page.getByLabel('Ambient wind (m/s)',{exact:true}).fill('7');
  await page.getByLabel('Wind direction (°)',{exact:true}).fill('70');
  await page.getByRole('button',{name:'Apply wind',exact:true}).click();
  await page.getByRole('button',{name:'Hang glider',exact:true}).click();
  await page.getByRole('button',{name:'Visit summit',exact:true}).click();
  const initial=await snapshot();expect(initial.phase).toBe('ready');expect(initial.position[1]).toBeGreaterThan(300);
  expect(initial.render).toEqual([1440,900]);expect(initial.resolution).toBe('standard');
  rows.push({...initial,stage:'summit-ready'});
 });
 const pilot=createPilot(),held=new Set();let lastStage='',previous;
 const keys=async command=>{
  const wanted=new Set();
  if(command.roll>0)wanted.add('ArrowLeft');if(command.roll<0)wanted.add('ArrowRight');
  if(command.pitch>0)wanted.add('ArrowDown');if(command.pitch<0)wanted.add('ArrowUp');
  if(command.flare)wanted.add('Space');
  for(const key of held)if(!wanted.has(key)){await page.keyboard.up(key);held.delete(key);actions.push({wall:Date.now()-started,type:'up',key});}
  for(const key of wanted)if(!held.has(key)){await page.keyboard.down(key);held.add(key);actions.push({wall:Date.now()-started,type:'down',key});}
 };
 try{
  await test.step('When I launch once, clear the ridge, descend and turn into wind using ordinary flight keys',async()=>{
   await page.getByRole('button',{name:'Launch glider',exact:true}).first().click();
   actions.push({wall:Date.now()-started,type:'click',name:'Launch glider'});
   const deadline=Date.now()+440000;
   while(Date.now()<deadline){
    const s=await snapshot(),command=pilot.decide(s);rows.push({...s,stage:command.stage,command});
    expect([...s.position,...s.velocity,...s.quaternion,...s.omega].every(Number.isFinite)).toBe(true);
    expect(s.metrics.thrust).toBe(0);expect(s.active).toBe(true);expect(s.mode).toBe('glider');
    if(previous&&s.metrics.airTime>0&&previous.metrics.airTime>0){
     const dt=s.time-previous.time;expect(dt).toBeGreaterThanOrEqual(0);
     expect(s.metrics.airTime).toBeGreaterThanOrEqual(previous.metrics.airTime);
     expect(s.metrics.distance).toBeGreaterThanOrEqual(previous.metrics.distance);
     const displacement=Math.hypot(...s.position.map((v,i)=>v-previous.position[i]));
     expect(displacement,'continuous motion bounded by observed velocity and elapsed time').toBeLessThan((Math.max(Math.hypot(...s.velocity),Math.hypot(...previous.velocity))+3)*dt+1);
    }
    if(command.stage!==lastStage||rows.length%100===0){console.log('Journey checkpoint',JSON.stringify({stage:command.stage,time:s.metrics.airTime,position:s.position,heading:s.metrics.heading,bank:s.metrics.bank,agl:s.metrics.agl,speed:s.metrics.speed,phase:s.phase}));lastStage=command.stage;}
    if(['landed','crashed','ditched'].includes(s.phase))break;
    await keys(command);previous=s;await page.waitForTimeout(100);
   }
  });
  await keys({});
  await test.step('Then the same unpowered flight touches down gently within the beach completion envelope',async()=>{
   const final=await snapshot();rows.push({...final,stage:'final'});
   await page.screenshot({path:testInfo.outputPath('summit-to-beach-landing.png')});
   expect(final.phase).toBe('landed');expect(final.reason).toBe('Beach landing complete');
   expect(Math.hypot(final.position[0]+92,final.position[2]+91)).toBeLessThan(45);
   expect(final.metrics.run).toBeGreaterThan(4);expect(final.metrics.airTime).toBeGreaterThan(30);
   expect(final.metrics.distance).toBeGreaterThan(400);expect(final.metrics.impactSpeed).toBeLessThan(2.6);
   expect(final.metrics.landingSpeed).toBeLessThan(9.5);expect(final.metrics.thrust).toBe(0);
   expect(rows.some(s=>s.phase==='running')).toBe(true);
   const airborne=rows.filter(s=>s.phase==='airborne');expect(airborne.length).toBeGreaterThan(200);
   expect(airborne.every(s=>Math.hypot(...s.metrics.windVector)>1)).toBe(true);
   expect(Math.max(...airborne.map(s=>Math.hypot(...s.metrics.windVector.map((v,i)=>v-s.sharedWind[i]))))).toBeLessThan(.5);
   expect(errors).toEqual([]);await expect(hud).toContainText('Beach landing complete');
  });
 }finally{
  await keys({});
  const evidence={settings:{windSpeed:7,windDirectionDegrees:70,render:'Standard 1440x900',controlIntervalMs:100,practiceApproach:false,resetsAfterLaunch:0},errors,actions,rows};
  await writeFile(testInfo.outputPath('journey.json'),JSON.stringify(evidence));
  await testInfo.attach('Continuous flight observations',{path:testInfo.outputPath('journey.json'),contentType:'application/json'});
 }
});
