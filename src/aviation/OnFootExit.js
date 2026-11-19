import {Vector3} from '../engine/math/index.js';
import {rotate} from './Math.js';

// Exit next to an aircraft only when actual support or water is nearby. No
// distant ground projection: an in-flight leave is an explicit rescue to entry.
// resumeOnFoot accepts feet coordinates; its swim mode raises them to eye-anchor height.
export function localAircraftExit(app,flight,{sideOffset=2,provider=null,waterAt=null}={}){
 const origin=flight.position,side=rotate(flight.quaternion,[1,0,0]),n=Math.hypot(side[0],side[2])||1;
 const yaw=Math.atan2(-rotate(flight.quaternion,[0,0,1])[0],-rotate(flight.quaternion,[0,0,1])[2]);
 const providers=app.player.groundProviders||new Set(provider?[provider]:[]);
 for(const offset of [sideOffset,-sideOffset,0,sideOffset+2,-sideOffset-2]){
  const p=new Vector3(origin[0]+side[0]/n*offset,origin[1],origin[2]+side[2]/n*offset);
  const water=waterAt?.(p.x,p.z)??app.disasters?.field?.waterAt(p.x,p.z)??0;
  let ground=app.player.groundAt(p.x,p.z,origin[1]+2);
  if(ground>water-1.1&&origin[1]-ground<=5&&ground<=origin[1]+2){
   p.y=ground;app.colliders?.resolveCapsule?.(p,.3,1.75,.4);for(const d of providers)d.resolveCapsule?.(p,.3,1.75,.4);
   ground=app.player.groundAt(p.x,p.z,origin[1]+2);if(!Number.isFinite(ground)||Math.abs(p.y-ground)>2||Math.hypot(p.x-origin[0],p.z-origin[2])>sideOffset+4)continue;
   p.y=ground;let support=null;for(const d of providers){const hit=d.supportAt?.(p,{maxRise:.1,maxDrop:.1});if(hit){support=d;break;}}
   // A planted foot starts at rest relative to its support. Player stores
   // world velocity, including the carrier's translation and angular motion.
   return{position:p.toArray(),velocity:support?support.velocityAt(p.toArray()):[0,0,0],yaw,pitch:0,waterHeight:water,grounded:true,provider:support};
  }
  if(water-ground>1.1&&(flight.phase==='ditched'||Math.abs(origin[1]-water)<4))return{position:[p.x,water-1.52,p.z],velocity:[0,0,0],yaw,pitch:0,waterHeight:water,grounded:false,provider:null};
 }
 return null;
}
export function entryRescue(app,saved){
 const position=saved?.position?.toArray?.()||[54,app.terrainData.heightAt(54,-74),-74];
 const water=app.disasters?.field?.waterAt(position[0],position[2])??0,ground=app.player.groundAt(position[0],position[2],position[1]+2);
 const dry=ground>water-1.1;position[1]=dry?ground:water-1.52;
 return{position,velocity:[0,0,0],yaw:saved?.yaw??0,pitch:saved?.pitch??0,waterHeight:water,grounded:dry,provider:null};
}
