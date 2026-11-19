import {Frustum,Sphere} from '../math/index.js';
import {posed} from './ScenePose.js';

// Reuse static shadow depth, but never reuse a moving caster's old depth. Check
// both old/new world bounds against the LIGHT frusta: an off-screen object can
// still cast onto a visible receiver in another cascade.
export class ShadowCasters {
 constructor(){this.entries=new Map();this.frusta=[];this.frame=0;}
 invalidate(scene,cascades,layerMask){
  const stamp=++this.frame;let changed=0;
  for(let i=0;i<cascades.length;i++)(this.frusta[i]??=new Frustum()).setFromProjectionMatrix(cascades[i].viewProj,undefined,false);
  const dirty=sphere=>{for(let i=0;i<cascades.length;i++)if(!cascades[i].dirty&&(!sphere||!Number.isFinite(sphere.radius)||this.frusta[i].intersectsSphere(sphere)))cascades[i].dirty=true;};
  // App.renderFrame poses the main scene once per frame (ScenePose.js)
  if(!posed(scene))scene.updateMatrixWorld();
  scene.traverseVisible(o=>{
   if(!o.isMesh||!o.castShadow||!o.geometry||!o.material||(o.layers.mask&layerMask)===0)return;
   const g=o.geometry,p=g.attributes.position,data=p?.data??p,inst=o.instanceMatrix,old=this.entries.get(o),matrix=o.matrixWorld.elements;
   const visibility=Array.isArray(o.material)?o.material.map(m=>m&&m.visible!==false?'1':'0').join(''):o.material.visible===false?'0':'1';
   if(!visibility.includes('1')||o.count===0||g.instanceCount===0)return;
   const deform=old&&(old.geometry!==g||old.position!==p||old.version!==data?.version||old.array!==data?.array||old.instances!==inst||old.instanceVersion!==inst?.version||old.instanceArray!==inst?.array||old.geometryCount!==g.instanceCount||old.visibility!==visibility||old.count!==o.count||old.index!==g.index||old.indexVersion!==g.index?.version||old.indexArray!==g.index?.array||old.drawStart!==g.drawRange.start||old.drawCount!==g.drawRange.count);
   const skin=!!g._skinBounds;
   let moved=!old;
   if(old)for(let i=0;i<16;i++)if(matrix[i]!==old.matrix[i]){moved=true;break;}
   if(!moved&&!deform&&!skin){old.stamp=stamp;return;}
   changed++;
   // Dynamic vertex/instance bounds may span a shared batch and become stale.
   // Conservatively refresh all maps for that case rather than cull with a lie.
   if(deform)dirty(null);else if(old)dirty(old.sphere);
   // Joint animation still invalidates every frame. Its conservative world
   // bound is unchanged when the root and geometry are unchanged.
   if(!moved&&!deform){old.stamp=stamp;return;}
   const entry=old??{matrix:matrix.slice(),sphere:null};
   let sphere=null;const unbounded=!!deform||!!old?.unbounded;
   if(!unbounded){
    let local;
    if(o.isInstancedMesh){if(!o.boundingSphere)o.computeBoundingSphere();local=o.boundingSphere;}
    else{if(!g.boundingSphere)g.computeBoundingSphere();local=g.boundingSphere;}
    if(local)sphere=(entry.sphere??new Sphere()).copy(local).applyMatrix4(o.matrixWorld);
   }
   dirty(sphere);
   entry.stamp=stamp;for(let i=0;i<16;i++)entry.matrix[i]=matrix[i];entry.sphere=sphere;
   // Rigid motion reuses the entry and bounds; only a new/deformed caster needs
   // its geometry identity/version snapshot replaced.
   if(!old||deform){
    Object.assign(entry,{geometry:g,position:p,version:data?.version,array:data?.array,instances:inst,instanceVersion:inst?.version,instanceArray:inst?.array,geometryCount:g.instanceCount,visibility,count:o.count,index:g.index,indexVersion:g.index?.version,indexArray:g.index?.array,unbounded,drawStart:g.drawRange.start,drawCount:g.drawRange.count});
    if(!old)this.entries.set(o,entry);
   }
  });
  for(const [o,e]of this.entries)if(e.stamp!==stamp){dirty(e.sphere);this.entries.delete(o);changed++;}
  return changed;
 }
}
