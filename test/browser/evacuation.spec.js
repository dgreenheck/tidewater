import { test, expect } from '@playwright/test';

// New browser contexts supply isolated local state. Only the external font
// stylesheet is replaced; terrain, input, player, water and damage run for real.
const telemetry = page => page.getByRole('status', {name:'Evacuation route',includeHidden:true});
const read = (page,key) => telemetry(page).getAttribute(`data-${key}`).then(Number);
async function ready(page) {
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=0.5&noAudio');
 await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Skip',exact:true}).click();
}
async function face(page) {
 await page.getByRole('button',{name:'Evacuation',exact:true}).click();
 await page.getByRole('button',{name:'Face evacuation route',exact:true}).click();
}

test('The signed boardwalk carries a runner from the village to high ground during a tsunami warning',async({page})=>{
 test.setTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given the real village and a connected route with a high-ground refuge',async()=>{
  await ready(page);
  await page.getByRole('button',{name:'Evacuation',exact:true}).click();
  await expect(page.getByRole('region',{name:'Evacuation controls'})).toBeVisible();
  await expect(telemetry(page)).toContainText('High-ground refuge');
  expect(await read(page,'refuge-elevation')).toBeGreaterThan(35);
  expect(await read(page,'width')).toBeGreaterThanOrEqual(3);
  await page.getByRole('button',{name:'Close evacuation controls'}).click();
 });
 await test.step('When I start a tsunami with its normal warning lead and face the signed entrance',async()=>{
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByLabel('Disaster type').selectOption('tsunami');
  await page.getByLabel('Target location').selectOption('pier');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('18');
  await expect(page.getByLabel('Warning lead time (s)')).toHaveValue('90');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  const before=await page.evaluate(()=>window.__app.player.position.toArray());
  await face(page);
  const after=await page.evaluate(()=>window.__app.player.position.toArray());
  expect(Math.hypot(after[0]-before[0],after[2]-before[2]),'Facing does not teleport the walker').toBeLessThan(.1);
  await expect(telemetry(page)).toHaveAttribute('data-warning','true');
  await expect(page.getByRole('status',{name:'Evacuation guidance'})).toContainText('Follow green');
  await page.screenshot({path:test.info().outputPath( 'tidewater-live-evacuation.png' )});
 });
 await test.step('When I hold the real run keys to reach the entrance and climb the boardwalk',async()=>{
  await page.keyboard.down('Shift');await page.keyboard.down('w');
  await expect.poll(()=>read(page,'entrance-distance'),{timeout:45000,intervals:[100]}).toBeLessThan(2.5);
  await page.keyboard.up('w');await page.keyboard.up('Shift');
  await page.screenshot({path:test.info().outputPath( 'entrance.png' )});
  await face(page);
  await page.keyboard.down('Shift');await page.keyboard.down('w');
  await expect(telemetry(page)).toHaveAttribute('data-at-refuge','true',{timeout:100000});
  await page.keyboard.up('w');await page.keyboard.up('Shift');
 });
 await test.step('Then actual foot contact reaches the elevated refuge before the wave launches',async()=>{
  await expect(page.getByRole('status',{name:'Evacuation guidance'})).toContainText('High-ground refuge reached');
  await expect(telemetry(page)).toHaveAttribute('data-player-mode','walk');
  expect(await read(page,'player-elevation')).toBeGreaterThan(35);
  expect(await read(page,'remaining-warning')).toBeGreaterThan(25);
  expect(await read(page,'refuge-water-depth')).toBe(0);
  expect(await read(page,'broken-sections')).toBe(0);
  const physical=await page.evaluate(()=>{
   const a=window.__app,p=a.player.position;
   return {water:a.disasters.field.waterAt(p.x,p.z),feet:p.y,ground:a.terrainData.heightAt(p.x,p.z),support:a.colliders.groundHeightAt(p.x,p.z,p.y+.1),launched:a.disasters.field.events.get('tsunami').launched};
  });
  expect(physical.ground).toBeGreaterThan(30);
  expect(Math.abs(physical.feet-physical.support)).toBeLessThan(.15);
  expect(physical.water).toBeLessThan(physical.feet);
  expect(physical.launched).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath( 'refuge.png' )});
 });
 await test.step('When the event is stopped then warning lights return to steady route lighting',async()=>{
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  await expect(telemetry(page)).toHaveAttribute('data-warning','false');
  await expect(telemetry(page)).toHaveAttribute('data-light-mode','steady');
 });
});

test('Exposed boardwalk sections can flood and break, and restoring the island restores their real collision surfaces',async({page})=>{
 test.setTimeout(300000);
 let original;
 await test.step('Given the evacuation boardwalk on a fresh physical island',async()=>{
  await ready(page);
  await page.getByRole('button',{name:'Evacuation',exact:true}).click();
  await expect(telemetry(page)).toHaveAttribute('data-broken-sections','0');
  original=await page.evaluate(()=>window.__app.evacuation.records.map(r=>({name:r.name,colliders:r.colliders.map(c=>({solid:c.solid,walkable:c.walkable,top:c.top})),vertices:r.spans.map(s=>Array.from(s.geo.attributes.position.array.slice(s.start*3,(s.start+s.count)*3)))})));
 });
 await test.step('When a severe tsunami reaches the low village entrance',async()=>{
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByLabel('Disaster type').selectOption('tsunami');
  await page.getByLabel('Target location').selectOption('pier');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');
  await page.getByLabel('Warning lead time (s)').fill('3');
  await page.getByLabel('Duration (s)').fill('90');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
 });
 await test.step('Then water loads break exposed timber while the elevated refuge stays above the actual flood',async()=>{
  await expect.poll(()=>read(page,'broken-sections'),{timeout:130000,intervals:[500]}).toBeGreaterThan(0);
  const damage=await page.evaluate(()=>{const a=window.__app,e=a.evacuation;return {broken:e.records.filter(r=>r.broken).map(r=>({utilization:r.utilization,colliders:r.colliders.map(c=>[c.solid,c.walkable])})),water:a.disasters.field.waterAt(e.refuge.x,e.refuge.z),refuge:e.refuge.y};});
  expect(damage.broken.some(r=>r.utilization>1)).toBe(true);
  expect(damage.broken.every(r=>r.colliders.every(c=>!c[0]&&!c[1]))).toBe(true);
  expect(damage.water).toBeLessThan(damage.refuge);
  await expect(page.getByRole('status',{name:'Evacuation guidance'})).toContainText('Damaged boardwalk');
  await page.screenshot({path:test.info().outputPath( 'flood-damage.png' )});
 });
 await test.step('When I restore the island then geometry and walkable collision return together',async()=>{
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await expect(telemetry(page)).toHaveAttribute('data-broken-sections','0');
  await expect(telemetry(page)).toHaveAttribute('data-warning','false');
  const restored=await page.evaluate(()=>window.__app.evacuation.records.map(r=>({name:r.name,colliders:r.colliders.map(c=>({solid:c.solid,walkable:c.walkable,top:c.top})),vertices:r.spans.map(s=>Array.from(s.geo.attributes.position.array.slice(s.start*3,(s.start+s.count)*3)))})));
  expect(restored).toEqual(original);
 });
});
