import {Vector3,Quaternion} from '../engine/index.js';
import {poseVest} from '../jetski/Vest.js';
// Reuse the loaded character's seated clip, placing its actual posed pelvis on
// the chair cushion. No duplicated character asset or floating standing pose.
const down=new Vector3(0,-1,0),up=new Vector3(0,1,0);
export function chairRotation(chair,out=new Quaternion()){
 return out.setFromUnitVectors(down,new Vector3(chair.n.x,chair.n.y,chair.n.z)).multiply(new Quaternion().setFromAxisAngle(up,Math.atan2(chair.hook.tx,chair.hook.tz)));
}
export class LiftRider{
 constructor(lift){this.lift=lift;this.pelvis=-1;this.head=-1;this.source=null;this.seat=new Vector3();this.eye=new Vector3();this.eyeAvailable=false;this.pelvisError=null;this.poseAvailable=false;}
 update(dt){const l=this.lift,a=l.app.player.avatar;if(!l.active||!a?.model)return;const c=l.transport.chairs[l.chairId],m=a.model,q=chairRotation(c);
  if(this.source!==m){this.source=m;this.pelvis=m.gltf.nodes.findIndex(n=>/pelvis|hips/i.test(n.name));this.head=m.gltf.nodes.findIndex(n=>/(^|[\s_:.])head$/i.test(n.name));}
  const clip=a.rideClips?.has('ski_sit')?'ski_sit':null;this.poseAvailable=!!clip&&this.pelvis>=0;
  const ride={pos:new Vector3(c.hook.x,c.hook.y,c.hook.z),q,w:clip?{[clip]:1}:{},hideHead:l.cameraMode==='seat'},vest=a.vestOn;
  a.update(dt,{show:true,ride,vel:l.app.player.velocity,view:l.cameraMode==='seat'?'first':'third',attached:true,pitch:l.lookPitch,cam:l.app.camera,swim:false});
  // Seated placement must include the GLB ancestor scale already in world[].
  this.seat.set(0,-3.17,-.02).applyQuaternion(q).add(new Vector3(c.hook.x,c.hook.y,c.hook.z));
  if(this.pelvis>=0){const at=this.pelvis*16,pelvis=new Vector3(m.world[at+12],m.world[at+13],m.world[at+14]).applyQuaternion(q);a.group.position.copy(this.seat).sub(pelvis);this.pelvisError=a.group.position.clone().add(pelvis).distanceTo(this.seat);}
  // The seated clip lowers and bends the body. Its eyes cannot be inferred
  // from the walking feet height: that put the lens inside the upper torso.
  // world[] includes the model scale and remains intact when head skin hides.
  this.eyeAvailable=this.head>=0;
  if(this.eyeAvailable){const at=this.head*16;this.eye.set(m.world[at+12],m.world[at+13]+.09,m.world[at+14]).applyQuaternion(q).add(a.group.position);}
  a.vestOn=vest;poseVest(a.vest,m,vest);
 }
}
