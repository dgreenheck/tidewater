import {Matrix4,Vector3} from '../engine/math/index.js';

const cache=new WeakMap();

// A finite contact envelope measured from the authored head, separate from the
// upright locomotion capsule. The swim pose puts the skull ahead of that capsule.
function envelope(model){
 if(cache.has(model))return cache.get(model);
 const node=model.gltf.nodes.findIndex(n=>/Head$/.test(n.name)),joint=model.skin.joints.indexOf(node),meshNode=model.gltf.nodes.find(n=>n.mesh!==undefined&&n.skin!==undefined);
 if(joint<0||!meshNode)return null;
 const inverseBind=new Matrix4().fromArray(model.skin.inverseBindMatrices,joint*16),points=[];
 for(const primitive of model.gltf.meshes[meshNode.mesh]){
  const a=primitive.attributes,p=a.POSITION.array,j=a.JOINTS_0?.array,w=a.WEIGHTS_0?.array;if(!j||!w)continue;
  for(let i=0;i<p.length/3;i++){
   let sum=0,influence=0;for(let k=0;k<4;k++){sum+=w[i*4+k];if(j[i*4+k]===joint)influence+=w[i*4+k];}
   if(sum>0&&influence/sum>.45)points.push(new Vector3(...p.slice(i*3,i*3+3)).applyMatrix4(inverseBind));
  }
 }
 if(!points.length)return null;
 const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);for(const point of points){min.min(point);max.max(point);}
 const center=min.add(max).multiplyScalar(.5),radius=Math.max(...points.map(point=>point.distanceTo(center))),result={node,center,radius};cache.set(model,result);return result;
}

export function swimmingHeadContact(player,previousFloatPosition=player.position){
 const avatar=player.avatar,model=avatar?.model;
 if(!model?.skin||!model.world||!avatar.visible)return null;
 const shape=envelope(model);if(!shape)return null;
 model.group.updateMatrixWorld();
 const world=new Matrix4().multiplyMatrices(model.group.matrixWorld,new Matrix4().fromArray(model.world,shape.node*16));
 const E=world.elements,scale=Math.max(Math.hypot(E[0],E[1],E[2]),Math.hypot(E[4],E[5],E[6]),Math.hypot(E[8],E[9],E[10]));
 // model.world retains the real skeleton even when first-person rendering
 // collapses only its uploaded skin matrices. Collision keeps the full head.
 if(!Number.isFinite(scale)||scale<.001)return null;
 const previousCenter=shape.center.clone().applyMatrix4(world),radius=shape.radius*scale+.025;
 if(radius<.08||radius>.35||previousCenter.distanceTo(previousFloatPosition)>2.5)return null;
 const center=previousCenter.clone().add(player.position.clone().sub(previousFloatPosition));
 // Player calls this after the real animation pose, including its current turn.
 // It retains the preceding corrected centre for the provider's swept contact.
 return{center,previousCenter,radius};
}
