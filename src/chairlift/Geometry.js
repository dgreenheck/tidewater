import {Group,Mesh,Vector3,Quaternion} from '../engine/index.js';
import {Builder} from '../world/village/GeoBuilder.js';
import {structure,STRUCTURES} from '../disasters/Structures.js';
import {LIFT} from './Route.js';
import {launchPoint,launchLocal} from '../glider/Site.js';
import {chairRotation} from './Rider.js';
import {buildLiftTower} from './Towers.js';
const up=new Vector3(0,1,0),down=new Vector3(0,-1,0);
export function buildChairlift(app,site,{connector=false}={}){
 const B=new Builder(),group=new Group(),records=[],wheels=[],yaw=Math.atan2(site.forward.x,site.forward.z);group.name='Summit chairlift';
 const steel=[.15,.24,.27],bright=[.82,.42,.09],wood=[.34,.22,.12],stone=[.29,.32,.30];
 // Bare hot-dip galvanised steel (the bullwheel's rim and spokes, as on real detachable-lift terminals) and the
 // painted drive housing under its hub. The rim was painted teal with orange spokes and, with nothing under the
 // hub, read from the summit as a floating orange and blue ring rather than a machine.
 const galvanised=[.46,.47,.47],drive=[.20,.22,.22];
 const point=(station,along,cross,y=station.floor)=>[station.x+site.forward.x*along+site.right.x*cross,y,station.z+site.forward.z*along+site.right.z*cross];
 const box=(key,p,size,tint)=>B.box(key,...p,...size,{ry:yaw,tint});
 const floor=(p,size)=>{box('wood',p,size,wood);return app.colliders.addBox(new Vector3(...p),new Vector3(size[0]/2,size[1]/2,size[2]/2),yaw,{solid:true,walkable:true,tag:'chairlift-platform'});};
 const beam=(a,b,width=.1,tint=steel)=>B.beam('hard',a,b,width,width,{tint});
 const guard=(station,a,b)=>{for(const h of [.5,1.02])beam(point(station,a[0],a[1],station.floor+h),point(station,b[0],b[1],station.floor+h),.055);const m=[(a[0]+b[0])/2,(a[1]+b[1])/2],size=[Math.abs(a[1]-b[1])+.08,1.05,Math.abs(a[0]-b[0])+.08];app.colliders.addBox(new Vector3(...point(station,m[0],m[1],station.floor+.525)),new Vector3(size[0]/2,size[1]/2,size[2]/2),yaw,{solid:true,walkable:false,tag:'chairlift-guard'});};
 for(const station of site.stations){structure(`Chairlift ${station.name} terminal`,app.colliders,()=>{
   for(let z=-5.85;z<6;z+=.3)floor(point(station,z,0,station.floor-.1),[12,.2,.3]);
   // Open bullwheel terminal: no decorative roof or head bar crosses the
   // steep cable approach. Four grounded legs carry the deck from below.
   for(const along of [-5.5,5.5])for(const cross of [-5.5,5.5]){
    const p=point(station,along,cross);let low=Infinity,high=-Infinity;
    for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const a=(i/8-.5)*.7,c=(j/8-.5)*.7,g=app.terrainData.heightAt(p[0]+site.forward.x*a+site.right.x*c,p[2]+site.forward.z*a+site.right.z*c);low=Math.min(low,g);high=Math.max(high,g);}
    const bottom=low-.25,cap=Math.min(high+.2,station.floor-.1),top=station.floor-.20;
    box('stone',[p[0],(bottom+cap)/2,p[2]],[.7,cap-bottom,.7],stone);app.colliders.addBox(new Vector3(p[0],(bottom+cap)/2,p[2]),new Vector3(.35,(cap-bottom)/2,.35),yaw,{solid:true,tag:'chairlift-footing'});
    if(top>cap+.01){beam([p[0],cap,p[2]],[p[0],top,p[2]],.22);app.colliders.addBox(new Vector3(p[0],(cap+top)/2,p[2]),new Vector3(.11,(top-cap)/2,.11),yaw,{solid:true,tag:'chairlift-post'});}
   }
   for(const c of [-5.5,5.5]){beam(point(station,-5.5,c,station.floor-.26),point(station,5.5,c,station.floor-.26),.22);app.colliders.addBox(new Vector3(...point(station,0,c,station.floor-.26)),new Vector3(.11,.11,5.5),yaw,{solid:true,tag:'chairlift-underframe'});}
   for(const a of [-5.5,5.5]){beam(point(station,a,-5.5,station.floor-.26),point(station,a,5.5,station.floor-.26),.22);app.colliders.addBox(new Vector3(...point(station,a,0,station.floor-.26)),new Vector3(5.5,.11,.11),yaw,{solid:true,tag:'chairlift-underframe'});}
   guard(station,[-6,-6],[6,-6]);guard(station,[6,-6],[6,6]);
   if(station===site.base){guard(station,[-6,-6],[-6,3.4]);guard(station,[-6,6],[6,6]);
    // Real graded access treads connect the boarding deck to the ground.
    const end=point(station,-12,4.7),bottom=app.terrainData.heightAt(end[0],end[2]),rise=Math.max(0,station.floor-bottom),count=Math.max(20,Math.ceil(rise/.16));
    for(let i=0;i<count;i++){const u=(i+.5)/count,y=bottom+rise*(1-u);floor(point(station,-6-6*u,4.7,y-.06),[2.2,.12,6/count+.006]);}site.base.entry={x:end[0],y:bottom,z:end[2]};
   }else{guard(station,[-6,-6],[-6,6]);if(connector){guard(station,[-6,6],[-2.1,6]);guard(station,[.6,6],[6,6]);}else guard(station,[-6,6],[6,6]);}
   for(const cross of [-1.25,1.25]){beam(point(station,0,cross,station.floor),point(station,0,cross,station.cableY-.3),.16);app.colliders.addBox(new Vector3(...point(station,0,cross,(station.floor+station.cableY-.3)/2)),new Vector3(.08,(station.cableY-.3-station.floor)/2,.08),yaw,{solid:true,tag:'chairlift-axle-column'});}
   beam(point(station,0,-1.25,station.cableY-.3),point(station,0,1.25,station.cableY-.3),.16);app.colliders.addBox(new Vector3(...point(station,0,0,station.cableY-.3)),new Vector3(1.25,.08,.08),yaw,{solid:true,tag:'chairlift-axle-head'});
   // Drive under the hub, hung from the axle head beam: the gearbox the bullwheel shaft drops into and the
   // electric motor bolted behind it. Its underside is 3.3 m above the deck, out of reach, so it has no collider.
   const gearTop = station.cableY - .39;
   box( 'hard', point( station, 0, 0, gearTop - .25 ), [ .9, .5, .8 ], drive );
   box( 'hard', point( station, - .85, 0, gearTop - .24 ), [ .46, .42, .9 ], drive );
  },'steel');records.push(STRUCTURES.at(-1));
  const W=new Builder(),wheel=new Group();wheel.name=`${station.name} bullwheel`;wheel.position.set(station.x,station.cableY,station.z);const ring=Array.from({length:49},(_,i)=>new Vector3(Math.sin(i/48*Math.PI*2)*LIFT.laneRadius,0,Math.cos(i/48*Math.PI*2)*LIFT.laneRadius));W.tube('hard',ring,.12,{radial:8,tint:galvanised});for(let i=0;i<10;i++){const t=i/10*Math.PI*2;W.beam('hard',[0,0,0],[Math.sin(t)*LIFT.laneRadius,0,Math.cos(t)*LIFT.laneRadius],.09,.15,{tint:galvanised});}W.cyl('hard',0,-.3,0,.33,.33,.6,{segs:16,tint:steel});for(const [k,batch]of Object.entries(W.batches))wheel.add(new Mesh(batch.build(),app.village.materials[k]));group.add(wheel);wheels.push(wheel);
 }
 for(const [i,t]of site.supports.slice(1,-1).entries()){let plan;structure(`Chairlift tower ${i+1}`,app.colliders,()=>{
   plan=buildLiftTower(B,app.colliders,app.terrainData,site,t,{steel,stone,bright});
  },'steel');const record=STRUCTURES.at(-1);record.tower=plan;records.push(record);}
 if(connector){
  // Only bridge the physical gap, meeting each floor at its outside edge.
  // This avoids a second coplanar floor laid over either existing terminal.
  const exit=site.summit.exit,target=launchPoint(-7,-.5),delta={x:target[0]-exit.x,z:target[2]-exit.z},crossRate=delta.x*site.right.x+delta.z*site.right.z,t=(6-(LIFT.laneRadius+1.6))/crossRate;
  const a={x:exit.x+delta.x*t,y:site.summit.floor,z:exit.z+delta.z*t},b={x:target[0],y:target[1],z:target[2]},length=Math.hypot(b.x-a.x,b.z-a.z),heading=Math.atan2(b.x-a.x,b.z-a.z),right={x:Math.cos(heading),z:-Math.sin(heading)},width=1.8;
  const direction={x:(b.x-a.x)/length,z:(b.z-a.z)/length},rate=direction.x*site.right.x+direction.z*site.right.z,sideRate=right.x*site.right.x+right.z*site.right.z,local=launchLocal([a.x,a.y,a.z])[0],endRate=launchLocal([a.x+direction.x,a.y,a.z+direction.z])[0]-local,endSide=launchLocal([a.x+right.x,a.y,a.z+right.z])[0]-local;
  const edge=(offset,u)=>{const from=-offset*sideRate/rate,to=length-offset*endSide/endRate,d=from+(to-from)*u;return new Vector3(a.x+right.x*offset+direction.x*d,a.y+(b.y-a.y)*u,a.z+right.z*offset+direction.z*d);};
  site.summit.connector={a,b,width,length,gate:{cross:-6.7,along:-.5,width:2}};
  structure('Chairlift summit connector',app.colliders,()=>{
   const count=Math.ceil(length/.3);for(let i=0;i<count;i++){const u=(i+.5)/count,p=[a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u-.08,a.z+(b.z-a.z)*u];B.slab('wood',[edge(-width/2,i/count),edge(-width/2,(i+1)/count),edge(width/2,(i+1)/count),edge(width/2,i/count)],.16,{tint:wood,up});app.colliders.addBox(new Vector3(...p),new Vector3(width/2,.08,length/count/2),heading,{solid:true,walkable:true,tag:'chairlift-connector'});}
   for(const side of [-1,1]){const offset=side*(width/2-.07),p=edge(offset,0).toArray(),q=edge(offset,1).toArray(),railLength=Math.hypot(q[0]-p[0],q[2]-p[2]);
    for(const h of [.5,1.04])beam([p[0],p[1]+h,p[2]],[q[0],q[1]+h,q[2]],.055);
    app.colliders.addBox(new Vector3((p[0]+q[0])/2,(p[1]+q[1])/2+.53,(p[2]+q[2])/2),new Vector3(.04,.53,railLength/2),heading,{solid:true,tag:'chairlift-connector-guard'});
    for(const at of [p,q]){const ground=app.terrainData.heightAt(at[0],at[2]);beam([at[0],ground-.2,at[2]],[at[0],at[1]+1.08,at[2]],.12);app.colliders.addBox(new Vector3(at[0],(ground-.2+at[1]+1.08)/2,at[2]),new Vector3(.06,(at[1]+1.28-ground)/2,.06),heading,{solid:true,tag:'chairlift-connector-post'});}
    beam([p[0],p[1]-.22,p[2]],[q[0],q[1]-.22,q[2]],.18);
   }
  },'timber');records.push(STRUCTURES.at(-1));
 }
 const cable=new Builder(),samples=Array.from({length:Math.ceil(site.length)+1},(_,i)=>{const p=site.sample(site.length*i/Math.ceil(site.length));return new Vector3(p.x,p.y,p.z);});// The haul rope had no material ('rope' is a GeoBuilder batch, not a village material), so it drew
 // in the engine default white. It is the hard material's rope branch (vdata.w = 2 + radius)
 // in its wire variant (village material set 'hardWire'), which keeps a sub-pixel rope continuous (VillageMaterials.js wire AA).
 const ropeRadius=.034;cable.tube('hard',samples,ropeRadius,{radial:6,tint:[.16,.17,.15],data:[0,0,0,2+ropeRadius]});const wire=app.village.materials.hardWire;
 // No rope shadow. The sun's disc is 0.53 deg wide, so a 0.034 m rope has an umbra only 0.034 / tan 0.53 deg
 // = 3.7 m long; the rope runs 4-9 m above the ground, so its real shadow there is a faint 8 cm penumbra.
 // In the shadow map (cascade texels several cm wide) the true rope drew a hard dashed dark line on the
 // grass under the line.
 for(const [,batch]of Object.entries(cable.batches)){const mesh=new Mesh(batch.build(),wire);mesh.name='Continuous haul rope';mesh.castShadow=false;group.add(mesh);}
 for(const [k,batch]of Object.entries(B.batches)){const mesh=new Mesh(batch.build(),app.village.materials[k]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Chairlift '+k;group.add(mesh);}
 const C=new Builder();for(const x of [-.86,.86]){C.beam('hard',[x,-3.3,-.45],[x,-3.3,.5],.07,.07,{tint:steel});C.beam('hard',[x,-3.3,-.40],[x,-2.45,-.4],.055,.055,{tint:steel});}C.beam('hard',[0,0,0],[0,-2.65,-.45],.08,.08,{tint:steel});C.beam('hard',[-.86,-2.65,-.45],[.86,-2.65,-.45],.07,.07,{tint:steel});for(let i=0;i<6;i++)C.box('hard',0,-3.25,-.35+i*.14,1.85,.10,.12,{tint:bright});for(let i=0;i<4;i++)C.box('hard',0,-3.10+i*.17,-.42,1.85,.13,.065,{tint:bright});C.beam('hard',[-.86,-3.85,.52],[.86,-3.85,.52],.06,.06,{tint:steel});for(const x of [-.86,.86])C.beam('hard',[x,-2.9,.4],[x,-3.85,.52],.035,.035,{tint:steel});C.beam('hard',[-.86,-2.8,.5],[.86,-2.8,.5],.045,.045,{tint:steel});
 const prototype=new Mesh(C.batches.hard.build(),app.village.materials.hard);prototype.castShadow=true;prototype.receiveShadow=true;
 const chairs=Array.from({length:LIFT.chairs},(_,i)=>{const mesh=prototype.clone();mesh.name=`Chairlift seat ${i+1}`;group.add(mesh);return mesh;});app.scene.add(group);
 return {group,records,chairs,wheels,connector,update(transport){for(let i=0;i<chairs.length;i++){const c=transport.chairs[i],mesh=chairs[i];mesh.position.set(c.hook.x,c.hook.y,c.hook.z);chairRotation(c,mesh.quaternion);}for(const wheel of wheels)wheel.rotation.y=-transport.motorDistance/LIFT.laneRadius;},triangles:countTriangles(group)};
}

function countTriangles(group){let n=0;group.traverse(m=>{n+=(m.geometry?.index?.count??0)/3;});return n;}
