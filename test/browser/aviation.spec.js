import { test, expect } from '@playwright/test';

// Real product, fresh browser context and localStorage per scenario. Only the
// external font request is mocked. UI actions never call application internals.
const instruments = page => page.getByRole('status', { name: 'Flight instruments' });
const number = async (page, key) => Number(await instruments(page).getAttribute(`data-${key}`));
async function ready(page) {
 await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
 await page.goto('/?scale=0.5&noAudio');
 await expect(page.getByRole('status', { name: 'Loading Tidewater' })).toBeHidden({ timeout: 120000 });
 await page.keyboard.press('Enter');
 await page.getByRole('button', { name: 'Skip', exact: true }).click();
 await page.getByRole('button', { name: 'Aviation', exact: true }).click();
}
async function press(page, key) { await page.keyboard.down(key); await page.waitForTimeout(150); await page.keyboard.up(key); }

// The player enters the aircraft and requests a launch through the flight controls.
test('Aviation: walk up to the jet, press E and hold W, and it launches itself and hands over', async ({page}, info) => {
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await test.step('Given a fresh island and the flight deck', async () => {
  await ready(page);
  await page.getByRole('button', { name: 'Walk flight deck', exact: true }).click();
 });
 await test.step('When I walk to the jet, press E and hold W', async () => {
  await page.keyboard.down('w');
  await expect(page.getByText('Fly the jet')).toBeVisible({ timeout: 15000 });
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('walk-up-prompt.png') });
  await page.keyboard.press('e');
  await expect(instruments(page)).toContainText('Hold W to launch');
  await expect.poll(() => number(page, 'contacts')).toBe(3);
  await page.screenshot({ path: info.outputPath('ready-on-catapult.png') });
  await page.keyboard.down('w');
  await expect(instruments(page)).toHaveAttribute('data-phase', 'launching', { timeout: 15000 });
  // the launch runs the engine to full: the throttle readout follows it (a stray comment once froze it at 0%)
  await expect(instruments(page).locator('[data-read=throttle]')).toHaveText('100%');
  await page.screenshot({ path: info.outputPath('catapult.png') });
 });
 await test.step('Then the instruments show airborne above 100 m, gear up and "You have control", with no panel input', async () => {
  await expect(instruments(page)).toContainText('You have control', { timeout: 60000 });
  await page.keyboard.up('w');
  await expect(instruments(page)).toHaveAttribute('data-phase', 'airborne');
  expect(await number(page, 'y')).toBeGreaterThan(100);
  await expect(instruments(page)).toHaveAttribute('data-gear', 'up');
  await page.screenshot({ path: info.outputPath('handover.png') });
 });
 let before;
 await test.step('When I bank right with the Right arrow and pull with the Down arrow', async () => {
  before = await number(page, 'heading');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowDown');
 });
 await test.step('Then the heading changes at least 30 degrees within 6 seconds and no stall is announced', async () => {
  const turned = async () => Math.abs(((await number(page, 'heading') - before + 540) % 360) - 180);
  await expect.poll(async () => { await expect(instruments(page)).not.toContainText('STALL'); return turned(); }, { timeout: 6000, intervals: [250] }).toBeGreaterThan(30);
  await page.screenshot({ path: info.outputPath('turn.png') });
  await page.keyboard.up('ArrowDown');
  expect(errors).toEqual([]);
 });
});

test('Aviation: fly a training approach and catch a wire with the pilot-operated arrestor hook', async ({page}) => {
 await test.step('Given a fresh island and a configured training approach', async () => {
  await ready(page);
  await page.getByRole('button', {name:'Start landing approach',exact:true}).click();
  await expect(instruments(page)).toHaveAttribute('data-phase','airborne');
  await expect(instruments(page)).toHaveAttribute('data-hook','up');
 });
 await test.step('When I lower the hook and continue the approach under flight physics', async () => {
  await press(page,'h');
  await expect(instruments(page)).toHaveAttribute('data-hook','down');
 });
 await test.step('Then the gear touches the moving deck and the wire absorbs the aircraft energy', async () => {
  await expect(instruments(page)).toHaveAttribute('data-phase','arrested',{timeout:60000});
  expect(await number(page,'landing-distance')).toBeGreaterThan(450);
  expect(await number(page,'cable-energy')).toBeGreaterThan(1e6);
  expect(await number(page,'peak-cable-force')).toBeGreaterThan(10000);
  expect(await number(page,'deck-speed')).toBeLessThan(4);
  await page.screenshot({path:test.info().outputPath( 'tidewater-aviation-landing.png' )});
 });
 await test.step('When I reset the aircraft then the reusable launch state returns', async () => {
  await page.getByRole('button',{name:'Reset aircraft',exact:true}).click();
  await expect(instruments(page)).toHaveAttribute('data-phase','ready');
  await expect.poll(()=>number(page,'contacts')).toBe(3);
  expect(await number(page,'deck-speed')).toBeLessThan(1);
 });
});

test('Aviation: a hook-up landing cannot silently award an arrested landing, and rescue returns control', async ({page}) => {
 await test.step('Given a training approach with the hook deliberately left up', async () => {
  await ready(page);
  await page.getByRole('button', {name:'Start landing approach',exact:true}).click();
 });
 await test.step('When I fly past the arresting wires without lowering the hook', async () => {
  await expect.poll(()=>number(page,'landing-distance'),{timeout:60000}).toBeGreaterThan(700);
 });
 await test.step('Then no cable capture or successful landing has been invented', async () => {
  expect(await number(page,'cable-energy')).toBe(0);
  await expect(instruments(page)).not.toHaveAttribute('data-phase','arrested');
  await expect(instruments(page)).toHaveAttribute('data-hook','up');
 });
 await test.step('When I rescue the aircraft and leave aviation then normal island control returns', async () => {
  await page.getByRole('button',{name:'Reset aircraft',exact:true}).click();
  await page.getByRole('button',{name:'Leave aviation',exact:true}).click();
  await expect(instruments(page)).toBeHidden();
  await page.getByRole('button',{name:'Aviation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Enter fighter',exact:true})).toBeVisible();
 });
});

// Selection changes only the inspection camera; the rendered production assets
// and moving sea remain live. These captures are visual QA, not physics proof.
test('Aviation: inspect the flight deck, bridge and fighter through the carrier viewing controls', async ({page}) => {
 await test.step('Given a fresh island and carrier inspection controls', async()=>{await ready(page);});
 for(const [view,label] of [['deck','flight deck'],['bridge','island bridge'],['fighter','fighter airframe']]){
  await test.step(`When I choose the ${label} inspection view`,async()=>{
   await page.getByLabel('Inspection view',{exact:true}).selectOption(view);
   await page.getByRole('button',{name:'Close aviation controls',exact:true}).click();
   await page.waitForTimeout(1000);
  });
  await test.step(`Then I can inspect the rendered ${label} in the live scene`,async()=>{
   await expect(instruments(page)).toBeHidden();
   const distance=await page.evaluate(view=>{const app=window.__app,pose=view==='fighter'?app.aviation.flight.position:app.aviation.carrier.position;return Math.hypot(app.camera.position.x-pose[0],app.camera.position.y-pose[1],app.camera.position.z-pose[2]);},view);
   expect(distance).toBeLessThan(view==='fighter'?25:view==='bridge'?100:150);
   await expect(page.getByRole('button',{name:'Aviation',exact:true})).toBeVisible();
   await page.screenshot({path:test.info().outputPath( `tidewater-aviation-detail-${view}.png` )});
   await page.getByRole('button',{name:'Aviation',exact:true}).click();
   await expect(page.getByLabel('Inspection view',{exact:true})).toHaveValue(view);
  });
 }
});

test('Aviation: repeated disaster restores retain pilot ownership and leave returns to the island', async ({page})=>{
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const state=()=>page.evaluate(()=>{const a=window.__app;return {active:a.aviation.active,pilot:a.aviation.pilot,mode:a.player.mode,free:a.freeCam};});
 await test.step('Given an island already restored from an earlier on-foot earthquake',async()=>{
  await ready(page);await click('Disasters');await page.getByLabel('Disaster type').selectOption('earthquake');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('0.05');await page.getByLabel('Duration (s)').fill('30');await click('Start disaster');
  await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.time)).toBeGreaterThan(.1);await click('Restore island');
  await expect.poll(async()=>(await state()).mode).toBe('walk');
 });
 await test.step('When I enter the fighter and start an earthquake plus tornado at the carrier',async()=>{
  await click('Aviation');await click('Enter fighter');await click('Disasters');
  await page.getByLabel('Disaster type').selectOption('earthquake');await page.getByLabel('Target X (m)').fill('900');await page.getByLabel('Target Z (m)').fill('-950');await click('Start disaster');
  await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target X (m)').fill('900');await page.getByLabel('Target Z (m)').fill('-925');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('80');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');await page.getByLabel('Duration (s)').fill('30');await click('Start disaster');
  await expect.poll(()=>page.evaluate(()=>window.__app.aviation.flight.metrics.windSpeed),{timeout:30000}).toBeGreaterThan(15);
 });
 await test.step('When I restore the island then the captured pilot mode and aircraft ownership agree',async()=>{
  await click('Pause simulation');await click('Restore island');
  await expect.poll(state).toEqual({active:true,pilot:true,mode:'aviation',free:false});
  await expect(instruments(page)).toHaveAttribute('data-phase','ready');
 });
 await test.step('When I operate the restored jet and leave then normal island control returns',async()=>{
  await click('Close disaster controls');await press(page,'g');await expect(instruments(page)).toHaveAttribute('data-gear','up');
  await click('Leave aviation');await expect(instruments(page)).toBeHidden();
  await expect.poll(state).toEqual({active:false,pilot:false,mode:'walk',free:false});
 });
});
