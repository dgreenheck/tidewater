import {Group,Mesh,Vector3} from '../engine/index.js';
import {structure,STRUCTURES} from '../disasters/Structures.js';
import {Builder,tagSpans} from '../world/village/GeoBuilder.js';
import {LAUNCH,BEACH,launchPoint,launchLocal,prepareGliderSite} from './Site.js';
import {stairGeometry,landingPart,landingSlices} from './StairGeometry.js';
export function buildStation(app){
 const records=[],site=prepareGliderSite(app.terrainData,app.coastalRoute),B=new Builder(),group=new Group();group.name='Summit glider station and hiking staircase';
 const wood=[.36,.235,.12],dark=[.16,.115,.065],metal=[.4,.47,.48],orange=[.93,.30,.06];
 const box=(key,p,s,tint=wood,yaw=0)=>B.box(key,...p,...s,{tint,ry:yaw,data:[p[2],.2,0,0]});
 const floor=(p,s,yaw=0)=>{box('wood',p,s,wood,yaw);return app.colliders.addBox(new Vector3(...p),new Vector3(s[0]/2+.001,s[1]/2,s[2]/2+.001),yaw,{walkable:true,solid:true,tag:'glider-stair'});};
 const guard=(cross,along,width,length)=>app.colliders.addBox(new Vector3(...launchPoint(cross,along,.54)),new Vector3(width/2,.54,length/2),LAUNCH.yaw,{walkable:false,solid:true,tag:'glider-guard'});
 const gateAlong=-8,thresholdAlong=-10;
 const atGate=launchPoint(0,thresholdAlong);
 const gateIndex=site.points.findIndex(p=>Math.abs(launchLocal([p.x,p.y,p.z])[0])<.01&&launchLocal([p.x,p.y,p.z])[1]>=thresholdAlong&&launchLocal([p.x,p.y,p.z])[1]<=-5.99);
 const gate={x:atGate[0],y:LAUNCH.y,z:atGate[2]};
 const layout=stairGeometry(site,gateIndex<0?site.points.length-1:gateIndex,gate),rails=new Map(),landings=new Map(layout.landings.map(l=>[l.index,l]));
 for(const rail of layout.rails){if(!rails.has(rail.a.index))rails.set(rail.a.index,[]);rails.get(rail.a.index).push(rail);}
 const beam=(a,b,w=.08,tint=dark)=>B.beam('wood',a,b,w,w,{tint});
 // Merged tread meshes retain individually walkable 0.186 m maximum steps.
 for(let start=0;start<(gateIndex<0?site.points.length-1:gateIndex);start+=24){structure(`Summit staircase ${1+start/24}`,app.colliders,()=>{
 for(let i=start;i<Math.min(start+24,site.points.length-1);i++){
  const a=site.points[i],b=site.points[i+1],dx=b.x-a.x,dz=b.z-a.z,run=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),p=[a.x,a.y-.065,a.z];
  const [cross,along]=launchLocal([a.x,a.y,a.z]),aligned=Math.abs(cross)<.01&&along>-18.1&&along<-5.9;
  // The level threshold owns its floor. Trim the last stair tread at the seam
  // instead of burying an inclined flight below a second solid deck.
  let tread=run+.025,treadP=p;if(aligned){if(along>=thresholdAlong)tread=0;else{const left=along-(run+.025)/2,right=launchLocal([b.x,b.y,b.z])[1]>=thresholdAlong?thresholdAlong:Math.min(along+(run+.025)/2,thresholdAlong);tread=right-left;treadP=launchPoint(0,(left+right)/2,a.y-LAUNCH.y-.065);}}
  if(tread>.002&&!layout.covered.has(i)){floor(treadP,[site.width,.13,tread],yaw);box('hard',[treadP[0],a.y+.003,treadP[2]],[site.width-.08,.006,.027],i%30<2?orange:[.55,.46,.28],yaw);}
  const landing=landings.get(i);
  if(landing){
   B.part('wood',landingPart(landing.polygon,landing.height),0,0,0,{tint:wood});
   for(const slice of landingSlices(landing)){
    for(const p of slice.boxes)app.colliders.addBox(new Vector3(p.center[0],p.center[1]-.065,p.center[2]),new Vector3(p.width/2+.001,.065,slice.length/2+.001),slice.yaw,{walkable:true,solid:true,tag:'glider-stair'});
    for(const p of slice.seams)box('wood',[p.center[0],p.center[1]+.0015,p.center[2]],[p.width,.003,.009],[.25,.165,.085],slice.yaw);
   }
   for(let j=0;j<landing.polygon.length;j++){const a=landing.polygon[j],b=landing.polygon[(j+1)%landing.polygon.length];beam([a.x,landing.height-.26,a.z],[b.x,landing.height-.26,b.z],.18);}
  }
  for(const rail of rails.get(i)||[]){
   const a=rail.a,b=rail.b,source=site.points[Math.min(a.index,site.points.length-1)],ground=source.bridge?a.y-.25:app.terrainData.heightAt(a.x,a.z);
   beam([a.x,ground-.15,a.z],[a.x,a.y+1.02,a.z],.12);box('stone',[a.x,ground,a.z],[.38,.22,.38],[.34,.35,.3]);
   beam([a.x,a.y-.23,a.z],[b.x,b.y-.23,b.z],.16);
   for(const h of [.48,.99])beam([a.x,a.y+h,a.z],[b.x,b.y+h,b.z],.065);
   const run=Math.hypot(b.x-a.x,b.z-a.z),yaw=Math.atan2(b.x-a.x,b.z-a.z);
   app.colliders.addBox(new Vector3((a.x+b.x)/2,(a.y+b.y)/2+.53,(a.z+b.z)/2),new Vector3(.055,.53+Math.abs(b.y-a.y)/2,run/2+.005),yaw,{walkable:false,solid:true,tag:'glider-rail'});
   if(a.y-ground>2)beam([a.x,ground+.3,a.z],[source.x,source.y-.23,source.z],.12);
  }

 }
 });records.push(STRUCTURES.at(-1));}
 // Summit assembly and launching slats, kept separate from the real terrain.
 let windsock;structure('Summit hang-glider launch',app.colliders,()=>{
 // A separately framed 2.3 m doorway fills a real notch in the rear deck.
 // Exact adjoining edges avoid overlapping coplanar planks and buried rails.
 const slats=(from,to,interval,build)=>{const n=Math.ceil((to-from)/interval),length=(to-from)/n;for(let i=0;i<n;i++)build(from+(i+.5)*length,length);};
 const deckStep=30/Math.ceil(30/.28),thresholdEnd=-8+Math.round(2/deckStep)*deckStep;
 slats(-8,22,.28,(along,length)=>{const w=along<1?14:10;if(along<thresholdEnd){const sideWidth=(w-site.width)/2;for(const side of [-1,1])floor(launchPoint(side*(site.width/2+sideWidth/2),along,-.08),[sideWidth,.16,length],LAUNCH.yaw);}else floor(launchPoint(0,along,-.08),[w,.16,length],LAUNCH.yaw);if(along>0&&Math.floor(along)%3===0)box('hard',launchPoint(0,along,.008),[.20,.008,.22],orange,LAUNCH.yaw);});
 // The threshold ends exactly on a plank boundary so there is no double floor.
 slats(thresholdAlong,thresholdEnd,.28,(along,length)=>floor(launchPoint(0,along,-.08),[site.width,.16,length],LAUNCH.yaw));
 for(const side of [-1,1]){const cross=side*site.width*.46;
  beam(launchPoint(cross,thresholdAlong,-.25),launchPoint(cross,thresholdEnd,-.25),.2);
  for(const along of [thresholdAlong,gateAlong]){const p=launchPoint(cross,along),ground=app.terrainData.heightAt(p[0],p[2]);beam([p[0],ground-.25,p[2]],addY(p,1.08),.14);box('stone',[p[0],ground,p[2]],[.45,.25,.45],[.35,.36,.31]);}
  for(const h of [.48,.99])beam(launchPoint(cross,thresholdAlong,h),launchPoint(cross,gateAlong,h),.065);
  const mid=side*(6.7+site.width*.46)/2,width=6.7-site.width*.46;
  for(const h of [.48,.99])beam(launchPoint(cross,gateAlong,h),launchPoint(side*6.7,gateAlong,h),.09);
  guard(mid,gateAlong,width,.10);
  for(const x of [side*3.8,side*6.7]){const p=launchPoint(x,gateAlong),ground=app.terrainData.heightAt(p[0],p[2]);beam([p[0],ground-.25,p[2]],addY(p,1.08),.14);}
 }

 for(const along of [-7,0,8,16,21])for(const side of [-1,1]){const p=launchPoint(side*(along<1?6.7:4.7),along),g=app.terrainData.heightAt(p[0],p[2]);beam([p[0],g-.5,p[2]],addY(p,along<1?1.08:0),.19);box('stone',[p[0],g-.02,p[2]],[.60,.35,.60],[.35,.36,.31]);}
 // The west guard ends at the real chairlift connector; the repaired rear
 // staircase and threshold remain separate from this side entrance.
 for(const side of [-1,1])for(const h of [.5,1.03])beam(launchPoint(side*6.7,-8,h),launchPoint(side*6.7,side<0?-1.6:0,h),.09);
 const connectorPost=launchPoint(-6.7,-1.6);beam(connectorPost,addY(connectorPost,1.08),.14);
 // Benches, equipment locker and a small wind mast give useful scale cues.
 for(const side of [-1,1]){const p=launchPoint(side*5.9,-4,.5);box('wood',p,[.7,.12,2.5],wood,LAUNCH.yaw);for(const along of [-5,-3])box('hard',launchPoint(side*5.9,along,.21),[.1,.42,.1],metal,LAUNCH.yaw);}
 box('hard',launchPoint(5.6,-7,.65),[1.6,1.3,.7],[.11,.23,.26],LAUNCH.yaw);
 const mast=launchPoint(-5.7,-5);beam(mast,addY(mast,5),.065,metal);
 const socket=launchPoint(-5.7,-5,4.8);windsock=new Group();windsock.name='Wind direction streamer';windsock.position.fromArray(socket);// The animated fabric is local to its pivot; exclude it from world-space structural load bounds.
 tagSpans(null,()=>{const S=new Builder();for(let i=0;i<8;i++)S.cyl('hard',0,0,-i*.16,.20-i*.016,.20-(i+1)*.016,.16,{rx:Math.PI/2,segs:12,tint:i%2?orange:[.95,.89,.75]});for(const[k,batch]of Object.entries(S.batches))windsock.add(new Mesh(batch.build(),app.village.materials[k]));group.add(windsock);});
 });const launchRecord=STRUCTURES.at(-1);records.unshift(launchRecord);
 // Beach target corners lie on real sand, with no fake landing surface.
 for(const dx of [-15,15])for(const dz of [-12,12]){const x=BEACH.x+dx,z=BEACH.z+dz,y=app.terrainData.heightAt(x,z);box('hard',[x,y+.32,z],[.08,.64,.08],metal);box('hard',[x+.20,y+.54,z],[.4,.18,.012],orange);}
 for(const[k,batch]of Object.entries(B.batches)){const mesh=new Mesh(batch.build(),app.village.materials[k]);mesh.name='Glider station '+k;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
 app.scene.add(group);return{group,windsock,site,records,launchRecord,railSegments:layout.rails.length,cornerLandings:layout.landings.length,parts:group.children.length,triangles:Object.values(B.batches).reduce((n,b)=>n+b.idx.length/3,0)};
}
const addY=(p,y)=>[p[0],p[1]+y,p[2]];
