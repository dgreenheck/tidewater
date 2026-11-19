import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck } from './gameTime.js';

async function ready(page,audio=false) {
 await page.route('https://fonts.googleapis.com/**', r => r.fulfill({contentType:'text/css', body:''}));
 const scale=process.env.PW_RENDER_SCALE??'0.5';
 await page.goto(`/?scale=${scale}${audio?'':'&noAudio'}`);
 await expect(page.getByRole('status', {name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();
 await page.getByRole('button', {name:'Skip', exact:true}).click();
 await page.getByRole('button', {name:'Disasters', exact:true}).click();
}
const geometry = page => page.evaluate(()=>window.__app.disasters.structures.records.map(r=>({name:r.name,broken:r.broken,progressive:!!r.progressive,position:[r.center.x,r.center.z],vertices:r.spans.flatMap(s=>Array.from(s.geo.attributes.position.array.slice(s.start*3,s.start*3+9))),colliders:r.colliders.map(c=>[c.solid??null,c.walkable??null,c.yMin??null,c.yMax??null])})));
const physics = page => page.evaluate(()=>Array.from(window.__app.rally.physics.disaster_motion()));
const status = page => page.getByRole('status', {name:'Disaster simulation'});
// Surge 2 m at the village, replayed from one seed through the internal one-shot hook (Disasters.start
// consumes window.__app.disasters.nextSeed for the event and the run's capacity scatter; no UI shows or
// sets it, test/disaster-next-seed.mjs). A tsunami is drawn per event, so without it the run-up, the
// heading and which houses fail change every run.
const TSUNAMI_SEED=7;
// The structures' own exposure rule (src/disasters/Structures.js update: depth > 0.08 m over the footprint
// base and a surface above 0.1 m): a building the water never reached in that sense stands above the run-up.
const WETTED=0.08; // m
// Structures.js activates the member model at utilization (load / scattered anchor capacity) above 0.5.
const ACTIVATES=0.5;

for (const kind of ['Earthquake','Tsunami','Tornado']) test(`${kind}: control, physical effect, pause, stop and restore`, async ({page}) => {
 test.setTimeout(SCENARIO_TIMEOUT_MS);
 // Budgets are game seconds on the disaster clock (test/browser/gameTime.js): the same numbers as the old wall-clock polls.
 const within=async(check,budget,what)=>{const r=await untilGameTimeCheck(page,check,budget);expect(r.value,`${what} within ${budget} game s (waited ${r.elapsed.toFixed(1)} s)`).toBeTruthy();};
 const errors=[];let original;page.on('pageerror', e=>errors.push(e.message));
 // WebGPU reports a WGSL compile or pipeline failure on the console, not as a page error: the disasterFar
 // far-field shader failing to compile would otherwise pass this scenario with no water drawn.
 page.on('console', m=>{if(/WGSL|shader|pipeline|GPUValidation/i.test(m.text())&&m.type()!=='debug')errors.push(m.text());});
 await test.step('Given a fresh island and the disaster controls',async()=>{
  await ready(page);
  await page.getByLabel('Disaster type').selectOption(kind.toLowerCase());
  await page.getByLabel('Target location').selectOption('village');
  if(kind==='Tsunami')await page.getByLabel('Warning lead time (s)').fill('6');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill(kind==='Earthquake'?'1.4':kind==='Tsunami'?'2':'100');
  await page.getByLabel('Radius (m)').fill('180');
  await page.getByLabel('Duration (s)').fill('90');
  await page.getByRole('button',{name:'View target',exact:true}).click();
  original=await geometry(page);
  if(kind==='Tsunami')await page.evaluate(seed=>{window.__app.disasters.nextSeed=seed;},TSUNAMI_SEED);
 });
 await test.step('When I start the configured disaster',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  // Test-side reader, not a driver: the peak water depth over each footprint base and the peak load ratio
  // the structures model saw, every frame of the run.
  if(kind==='Tsunami')await page.evaluate(()=>{const d=window.__app.disasters,f=d.field,rs=d.structures.records,s={};const peak=window.__tsunamiPeaks=rs.map(r=>({base:r.center.y-r.half.y,depth:0,util:0}));const ts=d.bodies.trees,treePeak=window.__treePeaks=ts.map(()=>0);const tick=()=>{for(let i=0;i<rs.length;i++){const r=rs[i],p=r.center;f.sample(p.x,p.y,p.z,s);const depth=s.height>.1?s.height-peak[i].base:0;if(depth>peak[i].depth)peak[i].depth=depth;if(!r.broken&&(r.utilization??0)>peak[i].util)peak[i].util=r.utilization;}for(let i=0;i<ts.length;i++){if((ts[i].load??0)>treePeak[i])treePeak[i]=ts[i].load;}if(window.__tsunamiPeaks===peak)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 });
 if(kind==='Tsunami')await test.step('Then the surge comes ashore: furniture moves, houses above the run-up stand, damage only where the flow passes the material threshold',async()=>{
  const event=()=>page.evaluate(()=>{const e=window.__app.disasters.field.events.get('tsunami');return e&&{seed:e.seed,time:e.time,arrival:e.arrival,launched:!!e.launched,coast:!!e.coastReached};});
  const first=await event();
  expect(first.seed,'the hook fixed the event seed').toBe(TSUNAMI_SEED);
  await within(async()=>(await event()).launched,first.arrival,'the crest launched into the ring');
  // the surge regression: the banner said "Coastal flooding detected" at launch (the source mound on Joey Island's
  // north beach counted). Just after launch the crest is still far out: the banner gives the countdown only.
  const banner=page.getByRole('status',{name:'Tsunami warning'});
  await expect(banner).toContainText('Estimated crest arrival');
  await expect(banner).not.toContainText('Coastal flooding detected');
  // Staged review view (not the action): over the village's shoulder, 45 m up, looking out along the approach
  // ray past the shoreline, so the incoming crest and the beach share the frame (the approach regression: "View
  // target" framed the village with the sea out of shot, and both frames were taken 1 s after launch).
  await page.evaluate(()=>{const A=window.__app,e=A.disasters.field.events.get('tsunami'),a=e.direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);const eye={x:e.x+cx*60-cz*70,z:e.z+cz*60+cx*70},look={x:e.x-cx*160,z:e.z-cz*160};const y=A.terrainData.heightAt(eye.x,eye.z)+45;A.setFreeCam(true);A.camera.position.set(eye.x,y,eye.z);const dx=look.x-eye.x,dy=2-y,dz=look.z-eye.z;A.camera.lookAt(look.x,2,look.z);A.fly.setPose(A.camera.position,Math.atan2(-dx,-dz),Math.asin(dy/Math.hypot(dx,dy,dz)));A.fly.velocity.set(0,0,0);A.cameraCut();});
  await within(async()=>{const e=await event();return e.time>=e.arrival-10;},first.arrival,'10 s before the crest estimate');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-approach.png')});
  await within(async()=>(await event()).coast,first.arrival+30,'the crest reached the coast');
  await within(async()=>{const e=await event();return e.time>=e.arrival+5;},first.arrival+10,'5 s after the crest estimate');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-impact.png')});
  await within(async()=>{const e=await event();return e.time>=e.arrival+40;},first.arrival+60,'40 s of flooding after the arrival estimate');
  await within(async()=>Number(await status(page).getAttribute('data-moved'))>0,30,'loose beach furniture moved');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-flooded.png')});
  const peaks=await page.evaluate(()=>window.__tsunamiPeaks),current=await geometry(page);
  const wetted=peaks.filter(p=>p.depth>WETTED),runUp=Math.max(...wetted.map(p=>p.base+p.depth));
  console.log(`tsunami surge seed ${TSUNAMI_SEED}: run-up ${runUp.toFixed(2)} m, ${wetted.length}/${peaks.length} footprints wetted, ${current.filter(r=>r.broken).length} broken, peak load ratio ${Math.max(...peaks.map(p=>p.util)).toFixed(2)}`);
  expect(wetted.length,'the surge reached some footprints').toBeGreaterThan(0);
  for(let i=0;i<peaks.length;i++){
   if(peaks[i].depth<=WETTED)expect(current[i],`${original[i].name} above the run-up stands untouched`).toEqual(original[i]);
   if(current[i].broken)expect(peaks[i].util,`${original[i].name} failed only past the activation load (depth ${peaks[i].depth.toFixed(2)} m)`).toBeGreaterThan(ACTIVATES);
  }
  // Trees fail on their own rule (src/disasters/Bodies.js update: damage grows only while the root-plate load
  // ratio t.load is above 1; a fallen tree keeps its last ratio), so no tree may fall that never passed 1.
  const trees=await page.evaluate(()=>window.__app.disasters.bodies.trees.map((t,i)=>({fallen:!!t.fallen,peak:window.__treePeaks[i]})));
  console.log(`tsunami surge seed ${TSUNAMI_SEED}: ${trees.filter(t=>t.fallen).length}/${trees.length} trees down, peak tree load ratio ${Math.max(0,...trees.map(t=>t.peak)).toFixed(2)}`);
  for(const [i,t] of trees.entries())if(t.fallen)expect(t.peak,`tree ${i} fell only past its root-plate capacity`).toBeGreaterThan(1);
 });
 await test.step('Then real island objects react and the event has measurable force',async()=>{
  await expect(status(page)).toHaveAttribute('data-active',kind.toLowerCase());
  await within(async()=>Number(await status(page).getAttribute('data-peak-force'))>1,45,'peak force above 1 N');
  await within(async()=>Number(await status(page).getAttribute('data-moved'))>0,60,'an island object moved');
  await within(async()=>Number(await status(page).getAttribute('data-destroyed'))>0,60,'an island object destroyed');
  await within(async()=>{const current=await geometry(page);return current.some((r,i)=>r.broken&&r.vertices.some((v,j)=>Math.abs(v-original[i].vertices[j])>.05)&&(r.progressive?r.colliders.some(c=>c[0]===false||c[2]<-1e8):r.colliders.every(c=>c[0]===false||c[2]<-1e8)));},60,'a broken structure moved its geometry and dropped its colliders');
  // A progressive building (docs/disaster-damage.md) drops only its failed parts' colliders: its standing walls keep
  // theirs (a walker is stopped by them), so it needs one dropped collider, not all of them. Whole-record
  // structures still drop every collider.
  const current=await geometry(page);if(kind!=='Tsunami')for(let i=0;i<original.length;i++)if(Math.hypot(original[i].position[0]-40,original[i].position[1]+115)>420)expect(current[i]).toEqual(original[i]);
  expect((await physics(page)).length).toBeGreaterThan(7);
  // The 25 ms disaster cap slows a loaded frame in either mode: the words must agree with the speed shown.
  const playback=(await status(page).textContent()).match(/Playback ([a-z ]+) · (\d+\.\d\d)× speed/);
  expect(playback,'status names the playback and its speed').not.toBeNull();
  expect(playback[1],`playback at ${playback[2]}× speed`).toBe(Number(playback[2])<1?'slowed under load':'real time');
  if(kind==='Tornado'&&process.env.PW_CAPTURE_MOTION==='1'){
   const sequence=[];for(let frame=0;frame<3;frame++){
    const at=await page.evaluate(()=>({time:window.__app.disasters.field.time,motion:Array.from(window.__app.rally.physics.disaster_motion()),centre:window.__app.disasters.field.center(window.__app.disasters.field.events.get('tornado'))}));sequence.push(at);
    await page.screenshot({path:test.info().outputPath( `tidewater-tornado-motion-${frame}.png` )});
    if(frame<2)await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.time),{timeout:15000}).toBeGreaterThan(at.time+.7);
   }await writeFile(test.info().outputPath( 'tidewater-tornado-motion.json' ),JSON.stringify(sequence,null,2));
   const first=sequence[0].motion,id=first.find((v,i)=>i%7===0&&v>=100000);expect(id).toBeDefined();
   const a=first.indexOf(id),last=sequence[2].motion,b=last.indexOf(id);expect(b).toBeGreaterThanOrEqual(0);expect(Math.hypot(last[b+1]-first[a+1],last[b+2]-first[a+2],last[b+3]-first[a+3])).toBeGreaterThan(.1);
  }
 });
 await test.step('When I pause the simulation then event time and body poses stay fixed',async()=>{
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-paused','true');
  const solved=await physics(page),shape=await geometry(page);
  const before=await status(page).getAttribute('data-pose');
  const t=await status(page).getAttribute('data-time');
  await page.waitForTimeout(process.env.PW_RENDER_SCALE==='1'?1800:600);
  await expect(status(page)).toHaveAttribute('data-pose',before);
  await expect(status(page)).toHaveAttribute('data-time',t);
  expect(await physics(page)).toEqual(solved);expect(await geometry(page)).toEqual(shape);
  await page.screenshot({path:test.info().outputPath( `tidewater-disaster-bdd-${kind.toLowerCase()}${process.env.PW_RENDER_SCALE==='1'?'-full':''}.png` )});
 });
 await test.step('When I resume and stop then forcing ends but damage remains',async()=>{
  await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','none');
  await expect.poll(async()=>Number(await status(page).getAttribute('data-destroyed'))).toBeGreaterThan(0);
 });
 await test.step('When I restore the island then structures, bodies and controls return',async()=>{
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-destroyed','0');
  await expect(status(page)).toHaveAttribute('data-moved','0');
  await expect(status(page)).toHaveAttribute('data-active','none');
  await expect(status(page)).toHaveAttribute('data-restored','true');
  expect(await geometry(page)).toEqual(original);
  expect(errors).toEqual([]);
 });
});

test('Disaster controls validate parameters and support repeat runs', async({page})=>{
 await test.step('Given the disaster panel in a fresh context',async()=>{await ready(page);});
 await test.step('When invalid intensity is entered then starting is prevented',async()=>{
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('9999');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(page.getByRole('alert',{name:'Disaster validation'})).toContainText('Intensity');
  await expect(status(page)).toHaveAttribute('data-active','none');
 });
 await test.step('When a valid short event runs then it ends and can run again',async()=>{
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('0.2');
  await page.getByLabel('Duration (s)').fill('3');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','earthquake');
  await expect(status(page)).toHaveAttribute('data-active','none',{timeout:45000});
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','earthquake');
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
 });
});

test('Tsunami early warning has physical lead time and gesture-created audio respects mute, volume and lifecycle',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given a fresh island with audio enabled and no warning source before a gesture',async()=>{await ready(page,true);await expect(status(page)).toHaveAttribute('data-audio-sources','0');await page.getByLabel('Disaster type').selectOption('tsunami');await page.getByLabel('Target location').selectOption('pier');await page.getByLabel('Warning lead time (s)').fill('6');await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('8');});
 await test.step('When I start a tsunami then a directional warning leads the wave and actual audio starts',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();const warning=page.getByRole('status',{name:'Tsunami warning'});await expect(warning).toContainText('Estimated crest arrival');const heading=await page.evaluate(()=>{const e=window.__app.disasters.field.events.get('tsunami');return {drawn:e.direction,asked:e.requestedDirection};});/* The heading is drawn per event within Field.js AZIMUTH_SPREAD (8 deg) of the requested -90; the banner prints it in whole degrees (it printed the raw float, -82.9...). */expect(heading.asked).toBe(-90);expect(Math.abs(heading.drawn-heading.asked)).toBeLessThanOrEqual(8);await expect(warning).toContainText(`direction ${Math.round(heading.drawn)}°`);expect(Number(await warning.getAttribute('data-countdown'))).toBeGreaterThan(6);await expect(status(page)).toHaveAttribute('data-audio-context','running');await expect(status(page)).toHaveAttribute('data-audio-sources','2');await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0)).toBeGreaterThan(.01);const wave=await page.evaluate(()=>({launched:window.__app.disasters.field.events.get('tsunami').launched,seconds:window.__app.disasters.field.events.get('tsunami').time}));expect(wave.seconds).toBeLessThan(6);expect(wave.launched).toBe(false);});
 await test.step('When I change volume and mute then the actual gain changes',async()=>{await page.getByLabel('Siren volume').fill('70');await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0)).toBeGreaterThan(.1);await page.getByLabel('Mute siren').check();await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??1)).toBeLessThan(.001);await page.getByLabel('Mute siren').uncheck();await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0)).toBeGreaterThan(.1);});
 await test.step('When I use global M then the warning also mutes',async()=>{await page.getByRole('button',{name:'Close disaster controls'}).click();await page.keyboard.press('m');await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??1)).toBeLessThan(.001);await page.keyboard.press('m');await page.getByRole('button',{name:'Disasters',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0)).toBeGreaterThan(.1);});
 await test.step('When M is held while paused then repeated keydown does not toggle mute again',async()=>{
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.getByRole('button',{name:'Close disaster controls'}).click();
  const muted=()=>page.evaluate(()=>window.__app.audio?.muted??window.__app.disasters.globalMuted??false);
  await page.keyboard.down('m');await expect.poll(muted).toBe(true);
  await page.keyboard.down('m');await expect.poll(muted).toBe(true);
  await page.keyboard.up('m');await page.keyboard.press('m');await expect.poll(muted).toBe(false);
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-audio-sources','2');
 });
 await test.step('When I pause, resume, stop and restore then oscillator sources end and restart without accumulation',async()=>{await page.evaluate(()=>{window.__sirenEnded=0;window.__app.disasters.siren.nodes.forEach(o=>o.addEventListener('ended',()=>window.__sirenEnded++));});await page.getByRole('button',{name:'Pause simulation',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','0');await expect.poll(()=>page.evaluate(()=>window.__sirenEnded)).toBe(2);await page.getByRole('button',{name:'Resume simulation',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','2');await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','0');await expect(page.getByRole('status',{name:'Tsunami warning'})).toBeHidden();await page.getByRole('button',{name:'Restore island',exact:true}).click();expect(errors).toEqual([]);});
});

test('Tsunami 3000 m: the wall tops the highest summit',async({page})=>{
 test.skip(process.env.PW_TSUNAMI_MEGA!=='1','opt-in: PW_TSUNAMI_MEGA=1 (about 10 min of a WebGPU slot)');
 test.setTimeout(SCENARIO_TIMEOUT_MS);
 const SUMMIT={x:-64,z:-496,y:297}; // m: the highest 16 m lattice point over the ring (test/tsunami-mega.mjs summit())
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/WGSL|shader|pipeline|GPUValidation/i.test(m.text())&&m.type()!=='debug')errors.push(m.text());});
 await test.step('Given the disaster panel set to a 3000 m tsunami at the village',async()=>{
  await ready(page);
  await page.getByLabel('Disaster type').selectOption('tsunami');
  await page.getByLabel('Target location').selectOption('village');
  await page.getByLabel('Warning lead time (s)').fill('6');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('3000');
  await page.evaluate(seed=>{window.__app.disasters.nextSeed=seed;},2);
 });
 await test.step('When I start it',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();});
 await test.step('Then the wall comes in at full height and water covers the summit',async()=>{
  // Staged review view (not the action): 2.6 km beyond the summit, looking back up the wave's path.
  const stage=()=>page.evaluate(s=>{const A=window.__app;A.setFreeCam(true);A.camera.position.set(s.x+900,s.y+700,s.z-2400);A.camera.lookAt(s.x,s.y+400,s.z+1500);const dx=-900,dy=-300,dz=3900,yaw=Math.atan2(-dx,-dz),pitch=Math.asin(dy/Math.hypot(dx,dy,dz));A.fly.setPose(A.camera.position,yaw,pitch);A.fly.velocity.set(0,0,0);A.cameraCut();},SUMMIT);
  await stage();
  const event=()=>page.evaluate(s=>{const f=window.__app.disasters.field,e=f.events.get('tsunami');return e&&{time:e.time,arrival:e.arrival,launched:!!e.launched,over:f.waterAt(s.x,s.z)-s.y};},SUMMIT);
  const first=await event();
  await untilGameTimeCheck(page,async()=>(await event()).launched,first.arrival);
  await page.screenshot({path:test.info().outputPath('tsunami-mega-approach.png')});
  const topped=await untilGameTimeCheck(page,async()=>(await event()).over>1,first.arrival+20);
  await page.screenshot({path:test.info().outputPath('tsunami-mega-summit.png')});
  const last=await event();
  console.log(`tsunami 3000 m seed 2: ${last.over.toFixed(1)} m of water over the ${SUMMIT.y} m summit at ${last.time.toFixed(1)} s (arrival ${first.arrival.toFixed(1)} s)`);
  expect(topped.value,`water over the summit by ${(first.arrival+20).toFixed(0)} game s`).toBeTruthy();
  expect(errors).toEqual([]);
 });
});
