import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainData} from '../src/world/TerrainData.js';
import {Colliders} from '../src/world/Colliders.js';
import {Group,Vector3} from '../src/engine/index.js';
import {buildStation} from '../src/glider/Station.js';
import {LAUNCH,launchPoint,launchLocal} from '../src/glider/Site.js';
const terrainData=new TerrainData(),colliders=new Colliders();
const station=buildStation({terrainData,colliders,scene:new Group(),village:{materials:{wood:{},hard:{},stone:{}}}});

test('authored summit stair rails do not pierce the walking platform floor',()=>{
 const cuts=[];
 for(const mesh of station.group.children){
  const g=mesh.geometry,a=g?.attributes,ix=g?.index?.array;if(!a?.tint||!ix)continue;
  for(let j=0;j<ix.length;j+=3){const ids=[ix[j],ix[j+1],ix[j+2]];
   if(!ids.every(k=>Math.abs(a.tint.array[k*3]-.16)<.001))continue;
   const triangle=ids.map(k=>Array.from(a.position.array.subarray(k*3,k*3+3)));
   for(let k=0;k<3;k++){const p=triangle[k],q=triangle[(k+1)%3];if((p[1]-LAUNCH.y)*(q[1]-LAUNCH.y)>=0)continue;
    const t=(LAUNCH.y-p[1])/(q[1]-p[1]),intersection=p.map((v,j)=>v+(q[j]-v)*t),[cross,along]=launchLocal(intersection);
    if(Math.abs(cross)<6.4&&along>-7.85&&along<-.3)cuts.push([cross,along]);
   }
  }
 }
 assert.equal(cuts.length,0,`${cuts.length} rail triangle edges penetrate the platform walking floor; first ${JSON.stringify(cuts[0])}`);
});
test('summit doorway has a level supported threshold, clear headroom and a real rear guard opening',()=>{
 for(let along=-10;along<=-5.8;along+=.1)for(const cross of [-.55,0,.55]){
  const p=launchPoint(cross,along),floor=colliders.groundHeightAt(p[0],p[2],LAUNCH.y+.05);
  assert.ok(Math.abs(floor-LAUNCH.y)<.02,`threshold is not level/supporting at ${cross},${along}: ${floor}`);
  const feet=new Vector3(p[0],floor,p[2]),before=feet.clone();colliders.resolveCapsule(feet,.3,1.75,.35);
  assert.ok(feet.distanceTo(before)<.02,`doorway blocks an ordinary walking capsule at ${cross},${along}`);
 }
 for(const cross of [-3,3]){const feet=new Vector3(...launchPoint(cross,-8)),before=feet.clone();colliders.resolveCapsule(feet,.3,1.75,.35);assert.ok(feet.distanceTo(before)>.15,'rear platform has a solid guard either side of the doorway');}
});

test('every registered summit structure has finite physical bounds',async()=>{
 const {spanBounds}=await import('../src/disasters/Structures.js');
 for(const record of station.records){const b=spanBounds(record.spans);assert.ok([...b.lo.toArray(),...b.hi.toArray(),...b.center.toArray(),...b.half.toArray()].every(Number.isFinite),`${record.name} has no finite structural geometry`);}
});

// Record the real Builder output: rail rendering cannot be certified by a
// successful walk through colliders that never included those beams.
import {Builder} from '../src/world/village/GeoBuilder.js';
import {CoastalRoute} from '../src/world/CoastalRoute.js';
const clamp01=x=>Math.max(0,Math.min(1,x));
function segmentDistance(a,b,c,d){
 const sub=(x,y)=>x.map((v,i)=>v-y[i]),dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0),u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;
 let s=den>1e-12?clamp01((bb*ee-cc*dd)/den):0,t=cc>1e-12?(bb*s+ee)/cc:0;
 if(t<0){t=0;s=aa>1e-12?clamp01(-dd/aa):0;}else if(t>1){t=1;s=aa>1e-12?clamp01((bb-dd)/aa):0;}
 return Math.hypot(...a.map((n,i)=>n+u[i]*s-c[i]-v[i]*t));
}
test('actual authored stair rail and post surfaces leave the entire hiking capsule lane clear',()=>{
 const beams=[],old=Builder.prototype.beam,t=new TerrainData(),c=new Colliders();let built;
 Builder.prototype.beam=function(key,a,b,w,h,o){if(w<=.13||Math.hypot(b[0]-a[0],b[2]-a[2])<.02)beams.push({a:a.slice(),b:b.slice(),radius:Math.hypot(w,h)/2});return old.call(this,key,a,b,w,h,o);};
 try{built=buildStation({terrainData:t,coastalRoute:new CoastalRoute(t),colliders:c,scene:new Group(),village:{materials:{wood:{},hard:{},stone:{}}}});}finally{Builder.prototype.beam=old;}
 // Wide under-floor girders can meet the approaching foot at a legitimate
 // stair riser. This contract covers handrails, posts and narrow bracing.
 const grid=new Map(),cell=4;
 for(const beam of beams)for(let x=Math.floor((Math.min(beam.a[0],beam.b[0])-beam.radius-.3)/cell);x<=Math.floor((Math.max(beam.a[0],beam.b[0])+beam.radius+.3)/cell);x++)for(let z=Math.floor((Math.min(beam.a[2],beam.b[2])-beam.radius-.3)/cell);z<=Math.floor((Math.max(beam.a[2],beam.b[2])+beam.radius+.3)/cell);z++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(beam);}
 const hits=[];
 for(let i=0;i<built.site.points.length;i++){const p=built.site.points[i],a=[p.x,p.y+.3,p.z],b=[p.x,p.y+1.45,p.z];for(const beam of grid.get(Math.floor(p.x/cell)+','+Math.floor(p.z/cell))||[]){if(Math.max(beam.a[1],beam.b[1])+beam.radius<p.y||Math.min(beam.a[1],beam.b[1])-beam.radius>p.y+1.75)continue;const gap=segmentDistance(a,b,beam.a,beam.b)-beam.radius;if(gap<.3-1e-5)hits.push({i,gap,point:[p.x,p.y,p.z],beam});}}
 assert.equal(hits.length,0,`rendered beams intrude on the hiking body at ${new Set(hits.map(h=>h.i)).size} route points; first ${JSON.stringify(hits[0])}`);
});
