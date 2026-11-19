import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('Tornado plume: transported condensate evaporates and the rendered cloud lifecycle pauses and restores',async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors=[],shrinking=new Set(),risingWhileShrinking=new Set(),previous=new Map();let dryDiameterChanges=0,comparisons=0,final;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const read=()=>page.evaluate(()=>{
  const a=window.__app,v=a.disasters.tornadoVisuals;
  return {time:a.disasters.field.events.get('tornado')?.time??null,snapshot:v.particles.snapshot(),drawn:v.dust.geometry.instanceCount,render:[a.sceneRenderer.width,a.sceneRenderer.height],particles:v.particles.dust.filter(p=>p.active).map(p=>({id:p.id,cycle:p.cycle,condensation:p.condensation,water:p.water,age:p.age,diameter:p.diameter,opacity:p.opacity,position:{...p.p}}))};
 });
 try{
  await test.step('Given the real island and a stationary 100 m/s tornado in the village',async()=>{
   await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
   await page.goto('/?scale=1&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
   await click('Click to explore');await click('Skip');await click('Performance');
   await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();await click('Collapse (H)');
   await click('Disasters');await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target location').selectOption('village');
   await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('100');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');await page.getByLabel('Duration (s)').fill('60');await click('View target');
  });
  await test.step('When I start the tornado and its real droplets travel into mixed air',async()=>{
   await click('Start disaster');await click('Close disaster controls');
   await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.events.get('tornado')?.time??0),{timeout:30000}).toBeGreaterThan(3);
   const start=Date.now();while(Date.now()-start<5500){
    const s=await read();final=s;expect(s.render).toEqual([1440,900]);expect(s.drawn).toBeGreaterThan(0);
    for(const p of s.particles){
     expect([p.diameter,p.opacity,...Object.values(p.position)].every(Number.isFinite)).toBe(true);
     const key=p.id+':'+p.cycle,old=previous.get(key);
     if(old&&p.age>old.age){
      comparisons++;
      if(p.condensation&&p.diameter<old.diameter-1e-10){shrinking.add(key);if(p.position.y>old.position.y)risingWhileShrinking.add(key);}
      if(!p.condensation&&!p.water&&Math.abs(p.diameter-old.diameter)>1e-12)dryDiameterChanges++;
     }
     previous.set(key,p);
    }
    await page.waitForTimeout(160);
   }
  });
  await test.step('Then condensate loses liquid while it still rises, and mineral grains keep their diameter',async()=>{
   expect(comparisons).toBeGreaterThan(100);
   expect(shrinking.size,'actual surviving droplet cohorts shrink through the production update').toBeGreaterThan(5);
   expect(risingWhileShrinking.size,'evaporation must coexist with physical upward transport').toBeGreaterThan(3);
   expect(dryDiameterChanges).toBe(0);expect(final.snapshot.budget.evaporatedLiquidMass).toBeGreaterThan(0);
  });
  await test.step('When I pause then parcel state and submitted motion history remain settled',async()=>{
   await click('Disasters');await click('Pause simulation');await click('Close disaster controls');await page.waitForTimeout(600);
   const paused=await read();await page.waitForTimeout(500);expect(await read()).toEqual(paused);
   const error=await page.evaluate(()=>{
    const v=window.__app.disasters.tornadoVisuals;let error=0;
    for(const m of [v.dust,v.flecks]){const a=m.geometry.attributes;for(let i=0;i<m.geometry.instanceCount;i++){const o=i*4;for(let k=0;k<3;k++)error=Math.max(error,Math.abs(a.parcel.array[o+k]-a.previous.array[o+k]));error=Math.max(error,Math.abs(a.parcel.array[o+3]-a.motion.array[o+3]),Math.abs(a.details.array[o+3]-a.previous.array[o+3]));}}
    return error;
   });expect(error).toBe(0);await page.screenshot({path:testInfo.outputPath('paused-plume.png')});
  });
  await test.step('When I stop and restore then clouds and lifecycle reservoirs clear for a fresh event',async()=>{
   await click('Disasters');await click('Resume simulation');await click('Stop all disasters');await click('Restore island');
   await expect(page.getByRole('status',{name:'Disaster simulation'})).toHaveAttribute('data-restored','true');
   const clear=await read();expect(clear.drawn).toBe(0);expect(clear.snapshot.budget.sourceDustMass).toBe(0);expect(clear.snapshot.budget.sourceLiquidMass).toBe(0);
   await click('Start disaster');await expect.poll(async()=>{const s=await read();return s.snapshot.budget.sourceLiquidMass;},{timeout:15000}).toBeGreaterThan(0);
   await click('Stop all disasters');await click('Restore island');expect(errors).toEqual([]);
  });
 }finally{
  await writeFile(testInfo.outputPath('plume-lifecycle.json'),JSON.stringify({shrinking:[...shrinking],risingWhileShrinking:[...risingWhileShrinking],dryDiameterChanges,comparisons,final,errors},null,2));
 }
});
