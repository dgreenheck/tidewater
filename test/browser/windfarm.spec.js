import { test, expect } from '@playwright/test';

// Maintained native Playwright Given/When/Then scenarios. Real product, isolated
// browser contexts and fresh localStorage. Only the external font is mocked.
const total=page=>page.getByRole('status',{name:'Wind farm telemetry',exact:true});
const unit=(page,id='WT-01')=>page.getByRole('status',{name:`${id} telemetry`,exact:true});
const number=async(locator,key)=>Number(await locator.getAttribute(`data-${key}`));
async function ready(page) {
 await page.addInitScript(()=>localStorage.clear());
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=0.5&noAudio');
 await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Skip',exact:true}).click();
 await page.getByRole('button',{name:'Wind farm',exact:true}).click();
}
async function wind(page,speed) {
 const details=page.getByText('Shared island wind',{exact:true});
 if(!await page.getByLabel('Ambient wind (m/s)',{exact:true}).isVisible())await details.click();
 await page.getByLabel('Ambient wind (m/s)',{exact:true}).fill(String(speed));
 await page.getByRole('button',{name:'Apply wind',exact:true}).click();
}

const rotorAngle=page=>page.evaluate(()=>window.__app.windfarm.visuals[0].rotor.rotation.z);
async function wakeProbe(page,point=null) {
 return page.evaluate(point=>{const app=window.__app,t=app.windfarm.turbines[0],f=app.disasters.field;if(!point){const w=f.sampleRaw(t.x,t.baseY+90,t.z,{}),length=Math.hypot(w.wx,w.wz);point={x:t.x+126*w.wx/length,y:t.baseY+90,z:t.z+126*w.wz/length};}const raw=f.sampleRaw(point.x,point.y,point.z,{}),air=f.sample(point.x,point.y,point.z,{});return{point,speed:Math.hypot(air.wx,air.wy,air.wz),rawSpeed:Math.hypot(raw.wx,raw.wy,raw.wz)};},point);
}

test('Wind farm: inspect generation, watch the real turbines and operate the rotor brake',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given a fresh island and three working turbines',async()=>{
  await ready(page);
  await expect(page.getByRole('status',{name:/WT-0[123] telemetry/})).toHaveCount(3);
  const clear=await page.evaluate(()=>{const a=window.__app;return a.windfarm.turbines.map(t=>{let margin=Infinity;for(const p of [...a.vegetation.records.trees,...a.vegetation.records.palms]){const r=6*(p.s||1),d=Math.max(0,Math.hypot(p.x-t.x,p.z-t.z)-r);if(d>68)continue;const bottom=t.baseY+90-Math.sqrt(Math.max(0,63**2-Math.max(0,d-5)**2));margin=Math.min(margin,bottom-(p.y+p.H+5*(p.s||1)));}return margin;});});
  for(const margin of clear)expect(margin,'real scattered tree crowns stay clear of the rotor envelope').toBeGreaterThan(0);
  await expect(total(page)).toHaveAttribute('data-dry-foundations','3');
  for(const id of ['WT-01','WT-02','WT-03']){expect(await number(unit(page,id),'ground')).toBeGreaterThan(3);expect(await number(unit(page,id),'hub-height')-await number(unit(page,id),'footing')).toBeCloseTo(90,6);}
  await expect.poll(()=>number(unit(page),'power'),{timeout:90000}).toBeGreaterThan(100000);
 });
 let before,operatingWake;
 await test.step('When I watch the wind farm while it supplies electricity',async()=>{
  await page.getByRole('button',{name:'Watch farm',exact:true}).click();
  await expect(total(page)).toHaveAttribute('data-watch','true');
  before=await number(unit(page),'energy');
 });
 await test.step('Then the energy meter accumulates actual generator work',async()=>{
  await expect.poll(()=>number(unit(page),'energy')).toBeGreaterThan(before+100000);
  await expect.poll(()=>number(unit(page),'rpm')).toBeGreaterThan(6.9);
  const angle=await rotorAngle(page);await expect.poll(async()=>Math.abs(Math.atan2(Math.sin(await rotorAngle(page)-angle),Math.cos(await rotorAngle(page)-angle)))).toBeGreaterThan(.3);
  operatingWake=await wakeProbe(page);expect(operatingWake.speed).toBeLessThan(operatingWake.rawSpeed-.2);
  await page.screenshot({path:test.info().outputPath( 'operating.png' )});
 });
 await test.step('When I inspect the selected turbine then its detailed rotor and nacelle are in view',async()=>{
  await page.getByRole('button',{name:'Inspect turbine',exact:true}).click();
  await expect(total(page)).toHaveAttribute('data-inspected','WT-01');
  await page.screenshot({path:test.info().outputPath( 'turbine-detail.png' )});
 });
 await test.step('When I inspect the grounded footing then its platform and service access are in view',async()=>{
  await page.getByRole('button',{name:'Inspect foundation',exact:true}).click();await expect(total(page)).toHaveAttribute('data-inspected','WT-01 foundation');
  await page.screenshot({path:test.info().outputPath( 'foundation-detail.png' )});
 });
 await test.step('When I engage the selected turbine rotor brake',async()=>{await page.getByRole('checkbox',{name:'Rotor brake',exact:true}).check();});
 await test.step('Then its electrical output disconnects and its rotor physically stops',async()=>{
  await expect(unit(page)).toHaveAttribute('data-power','0');
  const energy=await number(unit(page),'energy');
  await expect.poll(()=>number(unit(page),'rpm'),{timeout:60000}).toBeLessThan(.05);
  expect(await number(unit(page),'energy')).toBe(energy);
  const stopped=await rotorAngle(page);await page.waitForTimeout(400);expect(await rotorAngle(page)).toBeCloseTo(stopped,3);
  await expect.poll(()=>number(unit(page,'WT-02'),'power')).toBeGreaterThan(100000);
 });
 await test.step('When I release its brake and disable the whole farm',async()=>{
  await page.getByRole('checkbox',{name:'Rotor brake',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Farm enabled',exact:true}).uncheck();
 });
 await test.step('Then every turbine is disconnected and reset permits another operating session',async()=>{
  await expect(total(page)).toHaveAttribute('data-power','0');
  await expect.poll(()=>number(unit(page,'WT-02'),'pitch'),{timeout:20000}).toBeGreaterThan(85);
  const featheredWake=await wakeProbe(page,operatingWake.point);expect(featheredWake.speed).toBeGreaterThan(operatingWake.speed+.2);expect(featheredWake.speed).toBeLessThanOrEqual(featheredWake.rawSpeed);
  await page.getByRole('button',{name:'Reset wind farm',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Farm enabled',exact:true})).toBeChecked();
  await expect.poll(()=>number(unit(page),'power'),{timeout:90000}).toBeGreaterThan(100000);
  expect(errors).toEqual([]);
 });
});

test('Wind farm: earthquake loads break actual tower bodies, remove collision proxies and restore cleanly',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given a fresh farm viewed at the selected turbine',async()=>{
  await ready(page);await page.getByRole('button',{name:'Inspect turbine',exact:true}).click();
 });
 await test.step('When I apply an earthquake at its supported foundation using the disaster controls',async()=>{
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByRole('combobox',{name:'Disaster type',exact:true}).selectOption('earthquake');
  await page.getByRole('combobox',{name:'Target location',exact:true}).selectOption('custom');
  await page.getByLabel('Target X (m)',{exact:true}).fill('-440');await page.getByLabel('Target Z (m)',{exact:true}).fill('-660');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('1.2');await page.getByLabel('Radius (m)',{exact:true}).fill('100');
  await page.getByLabel('Duration (s)',{exact:true}).fill('40');await page.getByLabel('Frequency (Hz)',{exact:true}).fill('0.324');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await page.getByRole('button',{name:'Wind farm',exact:true}).click();
 });
 await test.step('Then the selected turbine fails under measured loads and its pieces move through the shared solver',async()=>{
  await expect(unit(page)).toHaveAttribute('data-damaged','true',{timeout:45000});
  await expect(unit(page)).toHaveAttribute('data-power','0');
  await expect.poll(()=>number(total(page),'solid-towers')).toBe(4);
  await expect.poll(()=>number(total(page),'bodies')).toBeGreaterThanOrEqual(6);
  const y=await number(total(page),'fragment-height');
  await expect.poll(async()=>Math.abs(await number(total(page),'fragment-height')-y),{timeout:20000}).toBeGreaterThan(1);
  await page.screenshot({path:test.info().outputPath( 'earthquake.png' )});
 });
 await test.step('When I stop forcing, damage remains until I reset the farm',async()=>{
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  await page.getByRole('button',{name:'Wind farm',exact:true}).click();await expect(unit(page)).toHaveAttribute('data-damaged','true');
  await page.getByRole('button',{name:'Reset wind farm',exact:true}).click();
 });
 await test.step('Then every owned collider and control is restored once and the farm runs again',async()=>{
  await expect(total(page)).toHaveAttribute('data-bodies','0');await expect(total(page)).toHaveAttribute('data-solid-towers','6');
  await expect(total(page)).toHaveAttribute('data-damaged','0');
  await expect.poll(()=>number(unit(page),'power'),{timeout:90000}).toBeGreaterThan(100000);
  expect(errors).toEqual([]);
 });
});

test('Wind farm: validate pitch and wind, latch high-wind shutdown and restart safely',async({page})=>{
 await test.step('Given the working farm inspector',async()=>{await ready(page);await page.getByText('Inspect loads & energy',{exact:true}).click();});
 await test.step('When invalid pitch and wind values are submitted',async()=>{
  await page.getByLabel('Minimum pitch (°)',{exact:true}).fill('120');await page.getByRole('button',{name:'Apply pitch',exact:true}).click();
  await expect(page.getByRole('alert',{name:'Wind farm validation'})).toContainText('0 to 90');
  await page.getByLabel('Minimum pitch (°)',{exact:true}).fill('0');await page.getByRole('button',{name:'Apply pitch',exact:true}).click();
  await wind(page,999);
 });
 await test.step('Then invalid settings do not reach the physical model',async()=>{
  await expect(page.getByRole('alert',{name:'Wind farm validation'})).toContainText('0 to 60');
  expect(await number(unit(page),'wind')).toBeLessThan(60);
 });
 await test.step('When shared wind exceeds the published 25 m/s cut-out speed',async()=>{await wind(page,26);});
 await test.step('Then output stops and a restart request is rejected while wind remains unsafe',async()=>{
  await expect(unit(page)).toHaveAttribute('data-status','high-wind shutdown');
  await expect(unit(page)).toHaveAttribute('data-power','0');
  await page.getByRole('button',{name:'Restart turbine',exact:true}).click();
  await expect(page.getByRole('alert',{name:'Wind farm validation'})).toContainText('below 20 m/s for 5 seconds');
  await expect.poll(()=>number(unit(page),'pitch'),{timeout:30000}).toBeGreaterThan(80);
  await page.screenshot({path:test.info().outputPath( 'high-wind.png' )});
 });
 await test.step('When the wind falls within the hysteresis band it remains latched',async()=>{
  await wind(page,22);await page.getByRole('button',{name:'Restart turbine',exact:true}).click();
  await expect(unit(page)).toHaveAttribute('data-status','high-wind shutdown');
 });
 await test.step('When safe wind returns and I restart after the hold interval',async()=>{
  await wind(page,8);
  await expect.poll(()=>number(unit(page),'wind')).toBeLessThan(20);
  await page.waitForTimeout(6500);
  await page.getByRole('button',{name:'Restart turbine',exact:true}).click();
 });
 await test.step('Then that turbine resumes generating while the other two stay shut down',async()=>{
  await expect.poll(()=>number(unit(page),'power'),{timeout:90000}).toBeGreaterThan(100000);
  await expect(unit(page,'WT-02')).toHaveAttribute('data-status','high-wind shutdown');
  await page.getByRole('checkbox',{name:'Turbine enabled',exact:true}).uncheck();
  await expect(unit(page)).toHaveAttribute('data-status','disabled');
  await expect(unit(page)).toHaveAttribute('data-power','0');
  await page.getByRole('button',{name:'Close wind farm',exact:true}).click();
  await expect(page.getByRole('region',{name:'Wind farm controls'})).toBeHidden();
  await page.getByRole('button',{name:'Wind farm',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Turbine enabled',exact:true})).not.toBeChecked();
 });
});
