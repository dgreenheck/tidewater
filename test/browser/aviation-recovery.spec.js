import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {gliderVisibility} from './helpers/glider-visibility.js';
const flightHUD=p=>p.getByRole('status',{name:'Flight instruments'}),gliderHUD=p=>p.getByRole('status',{name:'Glider instruments'});
const click=(page,name)=>page.getByRole('button',{name,exact:true}).click();
async function ready(page,tool){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=1&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});await page.keyboard.press('Enter');await click(page,'Skip');
 await click(page,'Performance');await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();await click(page,'Collapse (H)');await click(page,tool);
}
async function shot(page,testInfo,name){const path=testInfo.outputPath(name+'.png');await page.screenshot({path});const render=await page.evaluate(()=>({width:window.__app.sceneRenderer.width,height:window.__app.sceneRenderer.height,mode:window.__app.engine.resolution.mode}));await writeFile(testInfo.outputPath(name+'.json'),JSON.stringify({output:page.viewportSize(),render},null,2));}
const walker=page=>page.evaluate(()=>{const a=window.__app,p=a.player;return {position:p.position.toArray(),mode:p.mode,grounded:p.grounded,glider:a.glider.active,aviation:a.aviation.active,deck:a.aviation.carrier.local(p.position.toArray()),support:p.groundSupport?.provider?.id??null};});

test('Carrier recovery: leave the parked fighter, walk and jump on the moving flight deck',async({page},testInfo)=>{
 let aircraft,exited;
 await test.step('Given a fresh island pilot in the parked carrier fighter',async()=>{await ready(page,'Aviation');await click(page,'Enter fighter');await expect(flightHUD(page)).toHaveAttribute('data-phase','ready');aircraft=await page.evaluate(()=>window.__app.aviation.flight.position.slice());});
 await test.step('When I leave the fighter with E',async()=>{await page.keyboard.press('e');});
 await test.step('Then I stand beside the jet on the actual carrier deck',async()=>{await expect(flightHUD(page)).toBeHidden();exited=await walker(page);expect(exited.mode).toBe('walk');expect(exited.grounded).toBe(true);expect(Math.hypot(exited.position[0]-aircraft[0],exited.position[2]-aircraft[2])).toBeLessThan(10);expect(exited.deck[1]).toBeCloseTo(18,1);});
 await test.step('When I walk forward and jump using ordinary player keys',async()=>{await page.keyboard.down('w');await page.waitForTimeout(1700);await page.keyboard.up('w');await page.keyboard.press('Space');await expect.poll(async()=>(await walker(page)).grounded).toBe(false);});
 await test.step('Then gravity returns me to the moving deck and walking continues',async()=>{await expect.poll(async()=>(await walker(page)).grounded).toBe(true);const p=await walker(page);expect(p.support).toBe('carrier');expect(p.deck[1]).toBeCloseTo(18,1);expect(Math.hypot(p.deck[0]-exited.deck[0],p.deck[2]-exited.deck[2])).toBeGreaterThan(2);await shot(page,testInfo,'carrier-walk');});
});

test('Carrier recovery: the walking entry puts an ordinary island player on the flight deck',async({page},testInfo)=>{
 await test.step('Given a fresh island and the carrier controls',async()=>{await ready(page,'Aviation');});
 await test.step('When I choose Walk flight deck and walk normally',async()=>{await click(page,'Walk flight deck');await page.keyboard.down('w');await page.waitForTimeout(1300);await page.keyboard.up('w');});
 await test.step('Then I remain a walker supported by the carrier rather than falling through it',async()=>{const s=await walker(page);expect(s.mode).toBe('walk');expect(s.grounded).toBe(true);expect(s.aviation).toBe(false);expect(s.support).toBe('carrier');expect(s.deck[1]).toBeCloseTo(18,1);await shot(page,testInfo,'carrier-entry');});
});

test('Glider recovery: a push-out launch keeps the wing and suspended pilot visible above the ridge and ramp',async({page},testInfo)=>{
 const observations=[];let start,airCapture=false;
 await test.step('Given the real summit launch and chase camera',async()=>{await ready(page,'Hang glider');await click(page,'Launch glider');start=await page.evaluate(()=>window.__app.glider.flight.time);});
 await test.step('When I push out after four seconds of the ordinary launch',async()=>{
  await expect.poll(()=>page.evaluate(start=>window.__app.glider.flight.time-start,start),{timeout:12000,intervals:[50]}).toBeGreaterThan(4);
  await page.keyboard.down('ArrowDown');
  for(let i=0;i<90;i++){
   const row=await page.evaluate(()=>{const a=window.__app,f=a.glider.flight,eye=a.camera.position.clone(),q=f.quaternion;
    const rotate=([x,y,z])=>{const [qx,qy,qz,qw]=q,ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;return[ix*qw+iw*-qx+iy*-qz-iz*-qy,iy*qw+iw*-qy+iz*-qx-ix*-qz,iz*qw+iw*-qz+ix*-qy-iy*-qx];};
    const probes=[[0,0,0],[0,-.9,0],[-4.8,0,-1],[4.8,0,-1]].map(local=>{const off=rotate(local),p=eye.clone().fromArray(f.position.map((v,k)=>v+off[k])),d=eye.clone().sub(p),length=d.length();let terrain=Infinity;for(let j=1;j<=40;j++){const t=j/40,x=p.x+d.x*t,z=p.z+d.z*t,y=p.y+d.y*t;terrain=Math.min(terrain,y-a.terrainData.heightAt(x,z));}return {terrain,blocked:a.colliders.raycast(p,d.divideScalar(length),length)<length-.03};});
    return {time:f.time,phase:f.phase,eye:eye.toArray(),position:f.position.slice(),clearance:eye.y-a.terrainData.heightAt(eye.x,eye.z),probes};
   });row.visual=await gliderVisibility(page);observations.push(row);if(!airCapture&&row.phase==='airborne'&&row.time-start>8){airCapture=true;await shot(page,testInfo,'push-out-airborne');}if(row.time-start>11)break;await page.waitForTimeout(70);
  }
  await page.keyboard.up('ArrowDown');await writeFile(testInfo.outputPath('camera-observations.json'),JSON.stringify(observations,null,2));
 });
 await test.step('Then the final rendered camera clears terrain and the entire flying subject clears the ramp',async()=>{
  const air=observations.filter(o=>o.phase==='airborne'&&o.time-start>6.8);expect(air.length).toBeGreaterThan(8);expect(Math.max(...air.map(o=>o.visual.boom))).toBeLessThan(23);expect(air.flatMap(o=>o.visual.pilot).filter(p=>p.blocked)).toEqual([]);for(const p of air.flatMap(o=>o.visual.pilot)){expect(p.screen.front).toBe(true);expect(Math.abs(p.screen.x)).toBeLessThan(.9);expect(Math.abs(p.screen.y)).toBeLessThan(.9);}expect(Math.min(...air.map(o=>o.clearance))).toBeGreaterThan(1.8);expect(air.flatMap(o=>o.probes).filter(p=>p.blocked)).toEqual([]);expect(Math.min(...air.flatMap(o=>o.probes.map(p=>p.terrain)))).toBeGreaterThan(.10);await shot(page,testInfo,'push-out-result');
 });
});

test('Glider recovery: a real crash has an honest terminal message and local exit; rejected relaunch preserves walking',async({page},testInfo)=>{
 let impact;
 await test.step('Given the beach practice approach',async()=>{await ready(page,'Hang glider');await click(page,'Practice beach approach');});
 await test.step('When I flare too early and actually hit the ground',async()=>{await page.keyboard.down('Space');await expect(gliderHUD(page)).toHaveAttribute('data-phase','crashed',{timeout:30000});await page.keyboard.up('Space');impact=await page.evaluate(()=>window.__app.glider.flight.position.slice());});
 await test.step('Then the instruments report the impact rather than airborne stall recovery',async()=>{await expect(gliderHUD(page)).toContainText('Ground impact');await expect(gliderHUD(page)).not.toContainText('STALL · pull in');});
 await test.step('When I leave the wreck with X and try Launch glider again',async()=>{await page.keyboard.press('x');await expect(gliderHUD(page)).toBeHidden();const p=await walker(page);expect(p.mode).toBe('walk');expect(Math.hypot(p.position[0]-impact[0],p.position[2]-impact[2])).toBeLessThan(6);await click(page,'Hang glider');await click(page,'Launch glider');});
 await test.step('Then a reset instruction appears without seizing control of the old wreck',async()=>{await expect(page.getByRole('alert',{name:'Glider message'})).toContainText('Reset');expect((await walker(page)).glider).toBe(false);await click(page,'Close glider controls');const before=await walker(page);await page.keyboard.down('w');await page.waitForTimeout(1300);await page.keyboard.up('w');const after=await walker(page);expect(Math.hypot(after.position[0]-before.position[0],after.position[2]-before.position[2])).toBeGreaterThan(1);expect(after.mode).toBe('walk');await shot(page,testInfo,'crash-local-exit');});
 await test.step('When I choose the visible reset then launch again, a new normal ground run begins',async()=>{await click(page,'Hang glider');await click(page,'Reset glider');await click(page,'Launch glider');await expect(gliderHUD(page)).toHaveAttribute('data-phase','running');await expect(gliderHUD(page)).toHaveAttribute('data-phase','airborne',{timeout:30000});});
});

test('Glider recovery: a controlled beach landing can be left on foot beside the wing',async({page},testInfo)=>{
 let landing;
 await test.step('Given a real beach approach in the prevailing wind',async()=>{await ready(page,'Hang glider');await click(page,'Practice beach approach');await expect(gliderHUD(page)).toHaveAttribute('data-phase','airborne');await expect.poll(async()=>Number(await gliderHUD(page).getAttribute('data-agl'))).toBeGreaterThan(5);await expect.poll(async()=>Number(await gliderHUD(page).getAttribute('data-air-time'))).toBeGreaterThan(0);});
 await test.step('When I descend and flare below 1.5 metres',async()=>{await expect.poll(async()=>Number(await gliderHUD(page).getAttribute('data-agl')),{timeout:30000,intervals:[60]}).toBeLessThan(1.5);await page.keyboard.down('Space');await expect(gliderHUD(page)).toHaveAttribute('data-phase','landed',{timeout:15000});await page.keyboard.up('Space');landing=await page.evaluate(()=>window.__app.glider.flight.position.slice());await page.keyboard.press('x');});
 await test.step('Then walking resumes on the sand beside the actual landing',async()=>{await expect(gliderHUD(page)).toBeHidden();const before=await walker(page);expect(before.mode).toBe('walk');expect(before.grounded).toBe(true);expect(Math.hypot(before.position[0]-landing[0],before.position[2]-landing[2])).toBeLessThan(6);await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');const after=await walker(page);expect(Math.hypot(after.position[0]-before.position[0],after.position[2]-before.position[2])).toBeGreaterThan(1);await shot(page,testInfo,'beach-local-exit');});
});
