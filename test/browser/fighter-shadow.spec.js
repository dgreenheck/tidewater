import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {decodePNG} from '../png-read.mjs';
const click=(p,name)=>p.getByRole('button',{name,exact:true}).click();
function mean(image,x,y,w,h){let sum=0,count=0;for(let j=Math.floor(y);j<y+h;j++)for(let i=Math.floor(x);i<x+w;i++){if(i<0||j<0||i>=image.width||j>=image.height)continue;const k=(j*image.width+i)*4;sum+=.2126*image.data[k]+.7152*image.data[k+1]+.0722*image.data[k+2];count++;}return sum/count;}
test('Moving fighter keeps stable airframe lighting during an ordinary catapult flight',async({page},info)=>{
 const rows=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given a carrier fighter ready on the catapult',async()=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));await page.goto('/?scale=1&noAudio');await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});await click(page,'Click to explore');await click(page,'Skip');
  await click(page,'Performance');await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();await click(page,'Collapse (H)');
  await click(page,'Aviation');await click(page,'Enter fighter');
 });
 await test.step('When I hold W to launch, pull up to a positive climb and release the pitch control',async()=>{
  await page.keyboard.down('w');await expect.poll(()=>page.evaluate(()=>window.__app.aviation.flight.metrics.speed),{timeout:30000}).toBeGreaterThan(55);await page.keyboard.down('ArrowDown');await expect(page.getByRole('status',{name:'Flight instruments'})).toHaveAttribute('data-phase','airborne',{timeout:30000});
  await expect.poll(()=>page.evaluate(()=>window.__app.aviation.flight.velocity[1]),{timeout:15000,intervals:[30]}).toBeGreaterThan(12);await page.keyboard.up('ArrowDown');await page.keyboard.up('w');await page.waitForTimeout(2500);
 });
 await test.step('Then consecutive rendered airframe surfaces do not alternate between dark and bright',async()=>{
  for(let i=0;i<32;i++){
   const observation=await page.evaluate(()=>{const a=window.__app,f=a.aviation.flight;const p=a.camera.position.clone().set(0,1,-2).applyMatrix4(a.aviation.jetModel.root.matrixWorld).project(a.camera);return {frame:a.engine.frame,phase:f.phase,speed:f.metrics.speed,position:f.position.slice(),q:f.quaternion.slice(),pixel:[(p.x*.5+.5)*innerWidth,(.5-p.y*.5)*innerHeight],render:[a.sceneRenderer.width,a.sceneRenderer.height]};});
   const png=await page.screenshot({path:info.outputPath(`frame-${String(i).padStart(2,'0')}.png`)}),im=decodePNG(png),[x,y]=observation.pixel;
   rows.push({...observation,body:mean(im,x-10,y-18,20,36),sea:mean(im,x+170,y-18,40,36)});await page.waitForTimeout(45);
  }
  const jumps=rows.slice(1).map((r,i)=>Math.abs(r.body-rows[i].body));await writeFile(info.outputPath('lighting-frames.json'),JSON.stringify({rows,jumps,errors},null,2));
  expect(rows.every(r=>r.phase==='airborne'&&r.speed>55)).toBe(true);expect(rows.at(-1).frame-rows[0].frame).toBeGreaterThan(30);expect(Math.max(...jumps),'a steady moving fuselage must not flash across adjacent rendered samples').toBeLessThan(35);expect(errors).toEqual([]);
 });
});
