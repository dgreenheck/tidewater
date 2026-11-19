import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('Ferry status and a tsunami warning remain readable above the world controls',async({page},info)=>{
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 await test.step('Given the real ferry and its departures notice',async()=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.goto('/?scale=.6&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
  await page.keyboard.press('Enter');await click('Skip');await click('Disasters');
  const ship=await page.evaluate(()=>window.__app.ferry.ship.position.toArray());
  await page.getByLabel('Disaster type').selectOption('tsunami');await page.getByLabel('Target location').selectOption('custom');
  await page.getByLabel('Target X (m)').fill(String(ship[0]));await page.getByLabel('Target Z (m)').fill(String(ship[2]));
  await page.getByLabel('Warning lead time (s)').fill('300');await click('View target');
  await expect(page.getByRole('status',{name:'Ferry departures'})).toBeVisible();
 });
 await test.step('When I start a tsunami warning and close its controls',async()=>{await click('Start disaster');await click('Close disaster controls');});
 await test.step('Then the card PIN and the cooler leave the top of the screen while the warning shows',async()=>{
  await expect(page.getByLabel(/^Card PIN/)).toBeHidden();await expect(page.locator('.gm-purse')).toBeHidden();
 });
 await test.step('Then the full warning, departure notice and world controls occupy separate visible rows',async()=>{
  const rows=[];
  for(const width of [1440,960,390]){
   await page.setViewportSize({width,height:900});
   const warning=page.getByRole('status',{name:'Tsunami warning'}),ferry=page.getByRole('status',{name:'Ferry departures'}),tools=page.getByRole('navigation',{name:'World controls'});
   await expect(warning).toBeVisible();await expect(ferry).toBeVisible();
   const boxes=await Promise.all([ferry,warning,tools].map(x=>x.boundingBox()));rows.push({width,boxes});
   const overlap=(a,b)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>0&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>0;
   expect.soft(overlap(boxes[0],boxes[1]),`${width}px: ferry status must not cover the warning`).toBe(false);
   expect.soft(overlap(boxes[1],boxes[2]),`${width}px: tools must not cover the warning`).toBe(false);
   for(const box of boxes){expect.soft(box.x).toBeGreaterThanOrEqual(0);expect.soft(box.x+box.width).toBeLessThanOrEqual(width+1);}
   await page.screenshot({path:info.outputPath(`notices-${width}.png`)});
  }
  await writeFile(info.outputPath('notice-layout.json'),JSON.stringify(rows,null,2));
 });
 await test.step('When I stop the warning the ordinary controls return to their original row',async()=>{
  await page.setViewportSize({width:1440,height:900});await click('Disasters');await click('Stop all disasters');await click('Close disaster controls');
  await expect(page.getByRole('status',{name:'Tsunami warning'})).toBeHidden();
  expect((await page.getByRole('navigation',{name:'World controls'}).boundingBox()).y).toBe(100);
 });
});
