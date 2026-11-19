import {test,expect} from '@playwright/test';

async function ready(page){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=.5&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length),{timeout:30000}).toBeGreaterThan(15);
}
const rigs=page=>page.evaluate(()=>window.__app.people.list.filter(p=>p.knock?.rag?.rd.phase==='sim').map(p=>({id:p.id,mass:p.knock.rag.rd.mass,parts:p.knock.rag.rd.bodies.map(b=>({m:b.m,p:[b.x.x,b.x.y,b.x.z],v:[b.v.x,b.v.y,b.v.z]})),frames:p.knock.rag.rd.stats.frames,ms:p.knock.rag.rd.stats.ms,capped:p.knock.rag.rd.stats.capped})));
for(const kind of ['earthquake','tornado'])test(`${kind}: exposed people physically tumble, pause and restore`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let target;
 await test.step('Given people on actual exposed dry ground',async()=>{
  await ready(page);target=await page.evaluate(()=>{const A=window.__app,p=A.beach.people.find(p=>p.world.y>.8&&p.world.y<5&&!p.path&&p.posture!=='sit');return {id:p.id,x:p.world.x,y:p.world.y,z:p.world.z};});
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption(kind);await page.getByLabel('Target location').selectOption('custom');
  await page.getByLabel('Target X (m)').fill(String(target.x-(kind==='tornado'?18:0)));await page.getByLabel('Target Z (m)').fill(String(target.z));
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill(kind==='tornado'?'120':'2');await page.getByLabel('Radius (m)').fill('110');await page.getByLabel('Duration (s)').fill('90');
  if(kind==='tornado')await page.getByRole('spinbutton',{name:'Speed (m/s)',exact:true}).fill('0');
  await page.getByRole('button',{name:'View target',exact:true}).click();
 });
 await test.step('When I start the event through its controls',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();});
 await test.step('Then actual articulated capsules acquire finite physical motion and real body masses',async()=>{
  await expect.poll(async()=>(await rigs(page)).some(r=>r.frames>5&&r.parts.some(b=>Math.hypot(...b.v)>.5)),{timeout:40000}).toBe(true);
  const physical=await rigs(page);expect(physical.length).toBeGreaterThan(0);expect(physical.length).toBeLessThanOrEqual(8);
  for(const r of physical){expect([35,72]).toContain(r.mass);expect(r.parts.reduce((s,b)=>s+b.m,0)).toBeCloseTo(r.mass,6);expect(r.parts.flatMap(b=>[...b.p,...b.v]).every(Number.isFinite)).toBe(true);}
 });
 await test.step('When I pause simulation, every current capsule pose and velocity stays fixed',async()=>{
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();const before=await rigs(page);await page.waitForTimeout(800);expect(await rigs(page)).toEqual(before);await page.screenshot({path:test.info().outputPath( `tidewater-people-${kind}.png` )});
 });
 await test.step('Then stopping removes the event and restoring returns the affected people to their saved poses',async()=>{
  const saved=await page.evaluate(()=>[...window.__app.disasters.changedPeople].map(([p,s])=>({id:p.id,world:s.world.toArray()})));
  expect(saved.length).toBeGreaterThan(0);await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();await expect(page.getByRole('status',{name:'Disaster simulation'})).toHaveAttribute('data-active','none');
  await page.getByRole('button',{name:'Restore island',exact:true}).click();await expect(page.getByRole('status',{name:'Disaster simulation'})).toHaveAttribute('data-restored','true');await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  const restored=await page.evaluate(ids=>ids.map(id=>{const p=window.__app.people.list.find(p=>p.id===id);return {id,world:p.world.toArray(),knocked:!!p.knock};}),saved.map(s=>s.id));
  for(const p of restored){expect(p.knocked).toBe(false);const original=saved.find(s=>s.id===p.id);expect(Math.hypot(...p.world.map((x,i)=>x-original.world[i]))).toBeLessThan(.5);}
  expect(errors).toEqual([]);
 });
});
