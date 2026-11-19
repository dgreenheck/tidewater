// Supplementary real-app motion evidence. Maintained acceptance lives in
// test/browser/windfarm.spec.js; this records a short reviewable video as well.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const out=process.env.WINDFARM_CAPTURE_DIR||'test-results/windfarm';
const port=Number(process.env.WINDFARM_CAPTURE_PORT||5211),url=`http://127.0.0.1:${port}`;
await mkdir(out,{recursive:true});
const host=spawn(process.execPath,[path.join(repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:repo,env:{...process.env,TIDEWATER_NO_HMR:'1'},stdio:'pipe'});
let browser;
try {
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;if(host.exitCode!==null)throw new Error('The capture host exited before becoming ready.');await new Promise(r=>setTimeout(r,250));}
 if(!ready)throw new Error('The isolated capture host did not become ready.');
 browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[]),'--disable-background-timer-throttling']});
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out,size:{width:1440,height:900}}});
 const page=await context.newPage(),video=page.video(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.clear());await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto(`${url}/?scale=0.5&noAudio`);await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();await page.getByRole('button',{name:'Wind farm',exact:true}).click();
 const unit=page.getByRole('status',{name:'WT-01 telemetry',exact:true});await expect.poll(async()=>Number(await unit.getAttribute('data-power')),{timeout:90000}).toBeGreaterThan(100000);
 const samples=[];
 const sample=()=>page.evaluate(()=>{const farm=window.__app.windfarm,t=farm.turbines[0],field=window.__app.disasters.field,source=field.sampleRaw(t.x,t.baseY+90,t.z,{}),n=Math.hypot(source.wx,source.wz),point={x:t.x+126*source.wx/n,y:t.baseY+90,z:t.z+126*source.wz/n},air=field.sample(point.x,point.y,point.z,{});return {seconds:t.elapsed,rotorMeshAngle:farm.visuals[0].rotor.rotation.z,physicalAngle:t.angle,rpm:t.state().rpm,aerodynamicTorqueNm:t.aerodynamicTorque,generatorTorqueNm:t.generatorTorque,electricalW:t.electricalPower,energyJ:t.energyJ,rawAirSpeed:Math.hypot(source.wx,source.wy,source.wz),downstreamAirSpeed:Math.hypot(air.wx,air.wy,air.wz)};});
 for(const action of ['Watch farm','Inspect turbine']){await page.getByRole('button',{name:action,exact:true}).click();for(let i=0;i<32;i++){samples.push(await sample());await page.waitForTimeout(250);}}
 await context.close();const rawVideo=await video.path();await browser.close();browser=null;
 if(errors.length)throw new Error(errors.join('\n'));
 if(!samples.some((s,i)=>i>0&&Math.abs(s.rotorMeshAngle-samples[i-1].rotorMeshAngle)>.01)||!samples.every(s=>s.physicalAngle===s.rotorMeshAngle&&s.electricalW>0&&s.downstreamAirSpeed<=s.rawAirSpeed))throw new Error('Recorded motion did not match the physical rotor/shared wake.');
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-sseof','-16','-i',rawVideo,'-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',path.join(out,'windfarm-turning.mp4')],{encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr||'ffmpeg could not create the short motion video.');
 await writeFile(path.join(out,'windfarm-motion.json'),JSON.stringify({video:path.join(out,'windfarm-turning.mp4'),rawVideo,samples},null,2));
 console.log(JSON.stringify({video:path.join(out,'windfarm-turning.mp4'),bytes:(await stat(path.join(out,'windfarm-turning.mp4'))).size,samples:samples.length,energyGainJ:samples.at(-1).energyJ-samples[0].energyJ,initialRPM:samples[0].rpm,finalRPM:samples.at(-1).rpm}));
} finally {if(browser)await browser.close();host.kill('SIGTERM');}
