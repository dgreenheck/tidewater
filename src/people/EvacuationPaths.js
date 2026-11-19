// Incremental A* over the actual land/deck collision world. One job is advanced
// at a time, at most 120 expansions per frame. Walking still resolves the real
// capsule each frame, so this plan is never authority over a destroyed surface.
const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
export class EvacuationPaths {
 constructor(walker,entry,water){this.walker=walker;this.entry=entry;this.water=water;this.nodes=new Map();this.edges=new Map();this.origin={x:entry.x,z:entry.z+1.2};this.stats={expansions:0,maxExpansions:0,completed:0};}
 node(ix,iz){const key=ix+','+iz;if(this.nodes.has(key))return this.nodes.get(key);const x=this.origin.x+ix*2,z=this.origin.z+iz*2;let p=null;if(x>=-70&&x<=135&&z>=-110&&z<=45){p=this.walker.navigationPoint(x,z);if(p)p={...p,key,ix,iz};}this.nodes.set(key,p);return p;}
 begin(at){
  const ix=Math.round((at.x-this.origin.x)/2),iz=Math.round((at.z-this.origin.z)/2),near=[];
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const n=this.node(ix+dx,iz+dz);if(n&&this.walker.segment(at,n,{water:this.water}))near.push(n);}
  near.sort((a,b)=>Math.hypot(a.x-at.x,a.z-at.z)-Math.hypot(b.x-at.x,b.z-at.z));
  const n=near[0];if(!n)return {done:true,path:null};
  return {open:[{n,g:0,f:Math.hypot(n.x-this.entry.x,n.z-this.entry.z)}],cost:new Map([[n.key,0]]),parent:new Map(),closed:new Set(),done:false,path:null};
 }
 advance(job){
  if(job.done)return;let expansions=0;
  while(job.open.length&&expansions<120){
   let best=0;for(let i=1;i<job.open.length;i++)if(job.open[i].f<job.open[best].f)best=i;
   const item=job.open.splice(best,1)[0],n=item.n;if(job.closed.has(n.key))continue;job.closed.add(n.key);expansions++;
   if(Math.hypot(n.x-this.entry.x,n.z-this.entry.z)<3&&this.walker.segment(n,this.entry,{water:this.water})){
    const path=[this.entry];let cur=n;while(cur){path.unshift(cur);cur=job.parent.get(cur.key);}job.path=path;job.done=true;break;
   }
   for(const [dx,dz]of DIRS){const q=this.node(n.ix+dx,n.iz+dz);if(!q||job.closed.has(q.key))continue;const key=n.key+'>'+q.key;let valid=this.edges.get(key);if(valid===undefined){valid=this.walker.segment(n,q,{water:this.water});this.edges.set(key,valid);}if(!valid)continue;const g=item.g+Math.hypot(dx,dz)*2+Math.abs(q.y-n.y)*.3;if(g>=(job.cost.get(q.key)??Infinity))continue;job.cost.set(q.key,g);job.parent.set(q.key,n);job.open.push({n:q,g,f:g+Math.hypot(q.x-this.entry.x,q.z-this.entry.z)});}
  }
  this.stats.expansions+=expansions;this.stats.maxExpansions=Math.max(this.stats.maxExpansions,expansions);
  if(!job.open.length||job.closed.size>2400)job.done=true;
  if(job.done)this.stats.completed++;
 }
}
