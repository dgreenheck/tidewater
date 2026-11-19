import {prepareEvacuationRoute} from '../evacuation/Route.js';
// Surveyed against the production 1 m TerrainData grid, seed 7. No height edits.
export const LAUNCH={x:-34,z:-500,y:306.6,yaw:Math.atan2(-.35,-.94),width:14,length:22,grade:-.16};
export const BEACH={x:-92,z:-91,radius:25};
const prepared=new WeakMap();
export function launchPoint(cross=0,along=0,height=0){const c=Math.cos(LAUNCH.yaw),s=Math.sin(LAUNCH.yaw);return[LAUNCH.x+cross*c+along*s,LAUNCH.y+LAUNCH.grade*Math.max(0,along)+height,LAUNCH.z-cross*s+along*c];}
export function launchLocal(p){const dx=p[0]-LAUNCH.x,dz=p[2]-LAUNCH.z,c=Math.cos(LAUNCH.yaw),s=Math.sin(LAUNCH.yaw);return[dx*c-dz*s,dx*s+dz*c];}

// Connect the evacuation refuge to the summit. A* prefers contour
// traverses; a raised timber staircase bridges the remaining crags. Its surface
// is a least-height 0.62-grade majorant of the surveyed terrain, not terraforming.
export function prepareGliderSite(terrain,roads=null){
 if(prepared.has(terrain))return prepared.get(terrain);
 const refuge=prepareEvacuationRoute(terrain).refuge;
 const roadAt=(x,z)=>roads?.closest(x,z,s=>s.path.kind==='asphalt');
 const step=3,minX=-160,minZ=-546,nx=126,nz=102;
 const point=i=>[minX+i%nx*step,minZ+Math.floor(i/nx)*step];
 const index=(x,z)=>Math.round((z-minZ)/step)*nx+Math.round((x-minX)/step);
 const approach=launchPoint(0,-14),from=index(47,-249),to=index(-31,-491),n=nx*nz;
 const h=new Float64Array(n);for(let i=0;i<n;i++){const [x,z]=point(i),road=roadAt(x,z);h[i]=Math.max(terrain.heightAt(x,z)+.25,road&&road.distance<7?road.h+5.8:-Infinity);}
 const dist=new Float64Array(n);dist.fill(Infinity);dist[from]=0;const prev=new Int32Array(n);prev.fill(-1);const closed=new Uint8Array(n),heap=[];
 const target=point(to),heuristic=i=>{const p=point(i);return Math.hypot(p[0]-target[0],p[1]-target[1]);};
 const push=(id,f)=>{let i=heap.length;heap.push({id,f});while(i){const j=(i-1)>>1;if(heap[j].f<=f)break;heap[i]=heap[j];i=j;}heap[i]={id,f};};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first.id;};
 push(from,heuristic(from));while(heap.length){const i=pop();if(closed[i])continue;closed[i]=1;if(i===to)break;const x=i%nx,z=Math.floor(i/nx);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){if((!dx&&!dz)||x+dx<0||x+dx>=nx||z+dz<0||z+dz>=nz)continue;const j=i+dx+dz*nx;if(closed[j]||h[j]<5)continue;const l=step*Math.hypot(dx,dz),grade=Math.abs(h[j]-h[i])/l,cost=dist[i]+l*(1+45*grade**2);if(cost<dist[j]){dist[j]=cost;prev[j]=i;push(j,cost+heuristic(j));}}
 }
 if(prev[to]<0)throw new Error('No dry summit access route');
 let path=[];for(let i=to;i>=0;i=prev[i])path.push(point(i));path.reverse();path[0]=[47,-249];const originalEnd=launchPoint(0,-8);path.push([originalEnd[0],originalEnd[2]]);
 // Remove grid-scale zigzags before forming stairs. Closely spaced reverse
 // corners otherwise let an upper tread cut across the incoming walking lane.
 const simplify=(a)=>{if(a.length<3)return a;const first=a[0],last=a.at(-1),dx=last[0]-first[0],dz=last[1]-first[1],l=dx*dx+dz*dz;let far=0,at=0;for(let i=1;i<a.length-1;i++){const t=Math.max(0,Math.min(1,((a[i][0]-first[0])*dx+(a[i][1]-first[1])*dz)/Math.max(l,1e-9))),d=Math.hypot(a[i][0]-first[0]-t*dx,a[i][1]-first[1]-t*dz);if(d>far){far=d;at=i;}}return far>6?[...simplify(a.slice(0,at+1)).slice(0,-1),...simplify(a.slice(at))]:[first,last];};
 path=simplify(path);
 // Shift only the last switchback to leave a walkable turning landing below
 // the square final flight, instead of an almost reversing diagonal under deck.
 path[path.length-2]=[-46,-488];path[path.length-1]=[approach[0],approach[2]];
 // Keep the final flight square to the platform. The last four metres are a
 // level threshold; simplification must never cut diagonally through its doorway.
 const end=launchPoint(0,-6);path.push([end[0],end[2]]);
 const points=[];let arc=0;
 for(let k=1;k<path.length;k++){const a=path[k-1],b=path[k],l=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.ceil(l/.30);for(let j=k===1?0:1;j<=count;j++){const f=j/count,x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;if(points.length)arc+=Math.hypot(x-points.at(-1).x,z-points.at(-1).z);let ground=-Infinity;for(const dx of [-1.1,0,1.1])for(const dz of [-1.1,0,1.1])ground=Math.max(ground,terrain.heightAt(x+dx,z+dz));const road=roadAt(x,z),bridge=!!road&&road.distance<7;points.push({x,z,y:Math.max(ground+.25,bridge?road.h+5.8:-Infinity),arc,bridge,roadHeight:road?.h});}}
 points[0].y=Math.max(points[0].y,refuge.y);points.at(-1).y=LAUNCH.y;
 // A real level landing surrounds every pronounced bend. Solve the vertical
 // profile as flat landing groups joined by grade-limited stair runs.
 const landings=[];
 for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],vx=b.x-a.x,vz=b.z-a.z,wx=c.x-b.x,wz=c.z-b.z;const cosine=Math.max(-.999,Math.min(1,(vx*wx+vz*wz)/Math.hypot(vx,vz)/Math.hypot(wx,wz)));if(cosine<.98){const reach=1.15*Math.tan(Math.acos(cosine)*.5)+.5;let start=i,end=i;while(start&&b.arc-points[start].arc<reach)start--;while(end<points.length-1&&points[end].arc-b.arc<reach)end++;if(landings.length&&landings.at(-1).end>=start)landings.at(-1).end=end;else landings.push({start,end});}}
 const thresholdStart=points.findIndex(p=>Math.abs(launchLocal([p.x,p.y,p.z])[0])<.01&&launchLocal([p.x,p.y,p.z])[1]>=-10.3&&launchLocal([p.x,p.y,p.z])[1]<=-5.99);
 if(thresholdStart>=0){for(let i=thresholdStart;i<points.length;i++)points[i].y=LAUNCH.y;const tail={start:thresholdStart,end:points.length-1};if(landings.length&&landings.at(-1).end>=tail.start)landings.at(-1).end=tail.end;else landings.push(tail);}
 const runs=[];let at=0,landing=0;while(at<points.length){const flat=landings[landing];if(flat&&at===flat.start){runs.push({...flat,y:Math.max(...points.slice(flat.start,flat.end+1).map(p=>p.y))});at=flat.end+1;landing++;}else{runs.push({start:at,end:at,y:points[at].y});at++;}}
 for(let i=runs.length-2;i>=0;i--)runs[i].y=Math.max(runs[i].y,runs[i+1].y-.62*(points[runs[i+1].start].arc-points[runs[i].end].arc));
 for(let i=1;i<runs.length;i++)runs[i].y=Math.max(runs[i].y,runs[i-1].y-.62*(points[runs[i].start].arc-points[runs[i-1].end].arc));
 for(const run of runs)for(let i=run.start;i<=run.end;i++)points[i].y=run.y;
 if(points[0].y-refuge.y>.40)throw new Error(`Summit stair entrance needs a gentler contour (${points[0].y-refuge.y} m above refuge)`);
 const clear=(x,z,r)=>terrain.addClearZone([[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]]);
 for(let k=0;k<points.length;k+=5)clear(points[k].x,points[k].z,2.2);clear(LAUNCH.x,LAUNCH.z,16);const tip=launchPoint(0,23);clear(tip[0],tip[2],10);clear(BEACH.x,BEACH.z,30);
 let summit=-Infinity;for(let x=-75;x<10;x+=2)for(let z=-540;z<-450;z+=2)summit=Math.max(summit,terrain.heightAt(x,z));
 let maxRise=0,maxGrade=0,maxHeight=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=Math.hypot(b.x-a.x,b.z-a.z);maxRise=Math.max(maxRise,Math.abs(b.y-a.y));maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/d);maxHeight=Math.max(maxHeight,b.y-terrain.heightAt(b.x,b.z));}
 const site={points,landings,refuge,bridges:points.filter(p=>p.bridge),length:arc,width:2.3,summit,maxRise,maxGrade,maxHeight,station:LAUNCH,beach:BEACH};prepared.set(terrain,site);return site;
}
