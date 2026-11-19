// Broad-phase cells reference the live island boxes/cylinders. Removed turbine
// sections and disabled disaster structures cannot leave invisible obstacles.
export class GliderCollision{
 constructor(colliders){this.colliders=colliders;this.cells=new Map();this.boxCount=-1;this.cylinderCount=-1;this.refresh();}
 refresh(){const c=this.colliders;if(c.boxes.length===this.boxCount&&c.cylinders.length===this.cylinderCount)return;this.boxCount=c.boxes.length;this.cylinderCount=c.cylinders.length;this.cells.clear();for(const shape of [...c.boxes,...c.cylinders]){const x=shape.center?.x??shape.x,z=shape.center?.z??shape.z,r=shape.radius;for(let ix=Math.floor((x-r)/32);ix<=Math.floor((x+r)/32);ix++)for(let iz=Math.floor((z-r)/32);iz<=Math.floor((z+r)/32);iz++){const key=ix+':'+iz,list=this.cells.get(key)||[];list.push(shape);this.cells.set(key,list);}}}
 at(x,y,z){const list=this.cells.get(Math.floor(x/32)+':'+Math.floor(z/32))||[];for(const c of list){if(c.disasterDisabled)continue;if(c.center){if(!c.solid||y<c.bottom||y>c.top)continue;const dx=x-c.center.x,dz=z-c.center.z;if(Math.abs(dx*c.cos-dz*c.sin)<=c.half.x&&Math.abs(dx*c.sin+dz*c.cos)<=c.half.z)return c.tag||'island structure';}else if(y>=c.yMin&&y<=c.yMax&&Math.hypot(x-c.x,z-c.z)<c.radius)return c.tag||'island structure';}return null;}
}
