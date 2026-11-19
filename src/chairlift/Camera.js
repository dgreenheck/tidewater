import {Vector3} from '../engine/index.js';
import {thinHit} from '../player/ThirdPersonCamera.js';
// A short sphere-like bundle covers the near plane. Recast after interpolation:
// a previously safe camera location can become enclosed by a moving obstacle.
export function safeLiftCamera(app,eye,desired){
 const delta=desired.clone().sub(eye),length=delta.length();if(length<1e-6)return eye.clone();const direction=delta.divideScalar(length),side=new Vector3().crossVectors(direction,new Vector3(0,1,0));if(side.lengthSq()<1e-6)side.set(1,0,0);else side.normalize();const vertical=new Vector3().crossVectors(side,direction).normalize(),cam=app.camera,near=Math.max(.1,cam.near||.1),radius=Math.max(.20,near*Math.tan((cam.fov||60)*Math.PI/360)*Math.hypot(1,cam.aspect||1));
 let distance=length;for(const [x,y]of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){const from=eye.clone().addScaledVector(side,x*radius).addScaledVector(vertical,y*radius);distance=Math.min(distance,cast(app,from,direction,length));}
 return eye.clone().addScaledVector(direction,Math.max(0,distance-(distance<length-1e-7?radius:0)));
}
function cast(app,origin,direction,length){
 let hit=app.colliders?.raycast?.(origin,direction,length)??length;if(app.colliders)hit=thinHit(app.colliders,origin,direction,hit);
 const providers=new Set([...(app.player.groundProviders||[]),...(app.player.cameraObstacles||[])]);for(const provider of providers)if(provider.raycast)hit=Math.min(hit,provider.raycast(origin,direction,hit));
 const terrain=app.terrainData;if(terrain){const count=Math.max(1,Math.ceil(hit/.25));let previous=0;for(let i=1;i<=count;i++){const t=hit*i/count,p=origin.clone().addScaledVector(direction,t);if(p.y<terrain.heightAt(p.x,p.z)+.05){let lo=previous,hi=t;for(let k=0;k<8;k++){const mid=(lo+hi)/2,q=origin.clone().addScaledVector(direction,mid);if(q.y<terrain.heightAt(q.x,q.z)+.05)hi=mid;else lo=mid;}hit=lo;break;}previous=t;}}
 return Math.max(0,hit);
}
