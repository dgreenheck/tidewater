import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DisasterField} from '../src/disasters/Field.js';
import {TornadoParticles,TornadoVisuals} from '../src/disasters/TornadoVisuals.js';

import {Scene,Vector3} from '../src/engine/index.js';

function field(){const f=new DisasterField(()=>0);f.start('tornado',{x:0,z:0,intensity:90,radius:100,speed:0,duration:90});f.events.get('tornado').time=3;return f;}

test('Visible aerosol parcels are advected by the real vortex, with inward spiral and upward transport',()=>{
 const f=field(),e=f.events.get('tornado'),p=new TornadoParticles(f,{dust:1,flecks:0});p.update(1/60,e);
 const a=p.dust[0],initial={...a.p},r0=Math.hypot(a.p.x,a.p.z);
 let angle=Math.atan2(a.p.z,a.p.x),travel=0;
 for(let i=0;i<120;i++){p.update(1/60,e);const next=Math.atan2(a.p.z,a.p.x);travel+=Math.atan2(Math.sin(next-angle),Math.cos(next-angle));angle=next;}
 assert.ok(a.p.y>initial.y+5,'real updraft must lift the dust');
 assert.ok(Math.hypot(a.p.x,a.p.z)<r0,'radial inflow must draw dust inward');
 assert.ok(Math.abs(travel)>.3,'tangential field must turn the dust, including complete revolutions');
 assert.equal(p.samples,121);assert.ok(Object.values(a.p).every(Number.isFinite));
});

test('Small visible debris uses force/mass and gravity, and reset removes all emission',()=>{
 const f=field(),e=f.events.get('tornado'),p=new TornadoParticles(f,{dust:0,flecks:2});p.update(0,e);
 const [light,heavy]=p.flecks;
 for(const a of [light,heavy]){a.p={x:10,y:2,z:0};a.age=0;a.life=20;a.area=.007;a.v={x:0,y:0,z:0};}
 light.mass=.02;heavy.mass=.5;
 for(let i=0;i<45;i++)p.update(1/60,e);
 assert.ok(light.p.y>heavy.p.y+.5,'equal exposed area responds according to mass');
 assert.ok(light.v.z>heavy.v.z,'tangential momentum is force-integrated, not a prescribed orbit');
 assert.ok(p.samples>0);p.clear();assert.equal(p.event,null);assert.equal(p.snapshot().dust,0);assert.equal(p.snapshot().flecks,0);
});


test('The rendering adapter freezes event motion when paused and clears all parcels on stop',()=>{
 const f=field(),app={scene:new Scene(),camera:{position:new Vector3(0,50,120)},sceneRenderer:{opaqueCopy:{depthTexture:null}}};
 const visual=new TornadoVisuals(app,f);visual.update(.1);visual.update(.1);
 const before=JSON.stringify(visual.snapshot());f.paused=true;visual.update(.1);
 assert.equal(JSON.stringify(visual.snapshot()),before);
 assert.equal(visual.volumeMaterial.uniforms.flow.value.x,3,'density uses the frozen event clock');
 f.stop();visual.update(.1);assert.equal(visual.group.visible,false);assert.equal(visual.stats.dust,0);assert.equal(visual.stats.flecks,0);
});
