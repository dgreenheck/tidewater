// Northern island sites: unmodified TerrainData(seed=7), metres. Foundations
// bear on land; hub height is 90 m above each local concrete footing.
export const FARM_SITES = Object.freeze([{id:'WT-01',x:-440,z:-660},{id:'WT-02',x:-80,z:-730},{id:'WT-03',x:190,z:-720}]);
export const FOOTING_RADIUS=6.5;
const prepared=new WeakMap();
const circle=(x,z,r,n=24)=>Array.from({length:n},(_,i)=>[x+r*Math.cos(i*2*Math.PI/n),z+r*Math.sin(i*2*Math.PI/n)]);

// Conservative all-yaw rotor envelope, including the 5 m overhang. A tree or
// hill must stay below the lowest possible blade at its radial distance.
export function rotorBottom(site,distance) {
 return site.baseY+90-Math.sqrt(Math.max(0,63**2-Math.max(0,distance-5)**2));
}

export function verifySites(terrain,colliders,sites=FARM_SITES) {
 return sites.map(site=>{
  let terrainMin=Infinity,terrainMax=-Infinity;
  for(let r=0;r<=FOOTING_RADIUS+.001;r+=1.3)for(const [x,z] of circle(site.x,site.z,r,32)) {
   const h=terrain.heightAt(x,z);terrainMin=Math.min(terrainMin,h);terrainMax=Math.max(terrainMax,h);
  }
  if(!Number.isFinite(terrainMin)||terrainMin<=3)throw new Error(`${site.id}: the entire footing must be on dry land above 3 m.`);
  if(terrainMax-terrainMin>4)throw new Error(`${site.id}: the footing crosses terrain too steep for this assumed foundation.`);
  const surveyed={...site,groundY:terrain.heightAt(site.x,site.z),terrainMin,terrainMax,baseY:terrainMax+.45,anchorY:terrainMin-2};
  let rotorClearance=Infinity;
  for(let r=0;r<=68;r+=2)for(const [x,z] of circle(site.x,site.z,r,64))rotorClearance=Math.min(rotorClearance,rotorBottom(surveyed,r)-terrain.heightAt(x,z));
  if(rotorClearance<15)throw new Error(`${site.id}: the blade envelope needs at least 15 m terrain clearance.`);
  for(const c of [...(colliders?.boxes??[]),...(colliders?.cylinders??[])]) {
   const x=c.center?.x??c.x,z=c.center?.z??c.z,r=c.radius??Math.hypot(c.half?.x??0,c.half?.z??0),distance=Math.hypot(x-site.x,z-site.z)-r;
   if(distance<FOOTING_RADIUS+1)throw new Error(`${site.id}: foundation intersects ${c.tag||'an existing collider'}.`);
   const top=c.maxY??c.yMax??(c.center?.y!==undefined?c.center.y+(c.half?.y??0):Infinity);
   if(distance<68&&top>rotorBottom(surveyed,Math.max(0,distance)))throw new Error(`${site.id}: rotor intersects ${c.tag||'an existing collider'}.`);
  }
  for(const other of sites)if(other!==site&&Math.hypot(site.x-other.x,site.z-other.z)<252)throw new Error('Wind turbine spacing must exceed two rotor diameters.');
  return {...surveyed,rotorClearance};
 });
}

// A terrain-following maintenance foot trail. This is not an engineered haul
// road. A* penalises steep slopes and never crosses water or edits height data.
function trail(terrain,start,end) {
 const step=5,minX=-510,minZ=-830,nx=151,nz=121;
 const index=(x,z)=>Math.max(0,Math.min(nz-1,Math.round((z-minZ)/step)))*nx+Math.max(0,Math.min(nx-1,Math.round((x-minX)/step)));
 const point=i=>({x:minX+(i%nx)*step,z:minZ+Math.floor(i/nx)*step});
 const from=index(start[0],start[1]),to=index(end[0],end[1]);
 const heights=new Float64Array(nx*nz);for(let i=0;i<heights.length;i++){const p=point(i);heights[i]=terrain.heightAt(p.x,p.z);}
 const cost=new Float64Array(nx*nz);cost.fill(Infinity);cost[from]=0;
 const prev=new Int32Array(nx*nz);prev.fill(-1);const closed=new Uint8Array(nx*nz),heap=[];
 const goal=point(to),heuristic=i=>{const p=point(i);return Math.hypot(p.x-goal.x,p.z-goal.z);};
 const push=(id,f)=>{let i=heap.length;heap.push({id,f});while(i){const j=(i-1)>>1;if(heap[j].f<=f)break;heap[i]=heap[j];i=j;}heap[i]={id,f};};
 const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first.id;};
 push(from,heuristic(from));
 while(heap.length){const i=pop();if(closed[i])continue;closed[i]=1;if(i===to)break;const ix=i%nx,iz=Math.floor(i/nx);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){if((!dx&&!dz)||ix+dx<0||ix+dx>=nx||iz+dz<0||iz+dz>=nz)continue;const j=i+dx+dz*nx;if(heights[j]<3||closed[j])continue;const length=step*Math.hypot(dx,dz),grade=Math.abs(heights[j]-heights[i])/length,score=cost[i]+length*(1+18*grade**2);if(score<cost[j]){cost[j]=score;prev[j]=i;push(j,score+heuristic(j));}}
 }
 if(prev[to]<0)throw new Error('The wind farm maintenance trail needs a continuous dry route.');
 const points=[];for(let i=to;i>=0;i=prev[i]){const p=point(i);points.push({...p,y:heights[i]});if(i===from)break;}points.reverse();
 points[0]={x:start[0],z:start[1],y:terrain.heightAt(...start)};points[points.length-1]={x:end[0],z:end[1],y:terrain.heightAt(...end)};
 return points;
}

export function prepareWindFarmSites(terrain) {
 if(prepared.has(terrain))return prepared.get(terrain);
 const sites=verifySites(terrain),paths=[trail(terrain,[155,-269],[190,-720]),trail(terrain,[190,-720],[-80,-730]),trail(terrain,[-80,-730],[-440,-660])];
 for(const site of sites) {
  terrain.addClearZone(circle(site.x,site.z,12));
  // Keep tall vegetation out only where a 30 m crown could meet the sweep.
  for(let x=-70;x<=70;x+=10)for(let z=-70;z<=70;z+=10){const d=Math.hypot(x,z);if(d<70&&rotorBottom(site,Math.max(0,d-8))-terrain.heightAt(site.x+x,site.z+z)<32)terrain.addClearZone([[site.x+x-6,site.z+z-6],[site.x+x+6,site.z+z-6],[site.x+x+6,site.z+z+6],[site.x+x-6,site.z+z+6]]);}
 }
 for(const points of paths)for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z),nx=(b.z-a.z)/length*1.7,nz=-(b.x-a.x)/length*1.7;terrain.addClearZone([[a.x+nx,a.z+nz],[b.x+nx,b.z+nz],[b.x-nx,b.z-nz],[a.x-nx,a.z-nz]]);}
 const result={sites,paths};prepared.set(terrain,result);return result;
}
export const preparedWindFarmSites=terrain=>prepared.get(terrain);
