// Metres, Y up. This follows a surveyed clear corridor between the village's
// buildings and ends on the natural northern hillside. It never changes terrain.
export const EVACUATION = Object.freeze({x:47,startZ:-108,endZ:-243,width:3.8,tread:.30,maxGrade:.60,deckThickness:.20,refugeZ:-246,refugeWidth:8,refugeDepth:6});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function prepareEvacuationRoute(terrain) {
 if(terrain.evacuationRoute)return terrain.evacuationRoute;
 const C=EVACUATION, length=C.startZ-C.endZ, count=Math.ceil(length/C.tread),run=length/count;
 const footprintHeight=(x,z,halfX,halfZ)=>{
  let high=-Infinity;
  for(let xx=x-halfX;xx<=x+halfX+.01;xx+=.5)for(let zz=z-halfZ;zz<=z+halfZ+.01;zz+=.3)high=Math.max(high,terrain.heightAt(xx,zz));
  return high;
 };
 const refuge={x:C.x,z:C.refugeZ,width:C.refugeWidth,depth:C.refugeDepth};
 refuge.ground=terrain.heightAt(refuge.x,refuge.z);
 refuge.y=footprintHeight(refuge.x,refuge.z,refuge.width/2+.15,refuge.depth/2+.15)+.32;
 const roadZ=-177;
 const roadHeight=footprintHeight(C.x,roadZ,C.width/2,5.5);
 const bridge={startZ:-168,endZ:-186,y:roadHeight+5.6,roadZ,roadHeight};
 const points=[];
 for(let i=0;i<count;i++) {
  const distance=(i+.5)*run,z=C.startZ-distance;
  let y=footprintHeight(C.x,z,C.width/2+.1,run/2)+.30;
  if(z<=bridge.startZ&&z>=bridge.endZ)y=Math.max(y,bridge.y);
  points.push({x:C.x,z,y,ground:terrain.heightAt(C.x,z),distance,run,width:C.width});
 }
 // A generous landing every 18 m. Backward grade limiting lifts the preceding
 // steps instead of letting a terrain outcrop produce an unclimbable riser.
 for(let i=60;i<count-12;i+=60){const end=Math.min(i+6,count),y=Math.max(...points.slice(i,end).map(p=>p.y));for(let j=i;j<end;j++)points[j].y=y;}
 points.at(-1).y=Math.max(points.at(-1).y,refuge.y);
 for(let i=1;i<count;i++)points[i].y=Math.max(points[i].y,points[i-1].y);
 for(let i=count-2;i>=0;i--)points[i].y=Math.max(points[i].y,points[i+1].y-C.maxGrade*run);
 // The final platform is level and meets the last tread without a lip.
 refuge.y=points.at(-1).y;
 const entry={x:C.x,z:C.startZ+.2,y:points[0].y};
 const route={...C,length:length+C.refugeDepth/2,points,entry,refuge,bridge,nominalRunSeconds:(length+C.refugeDepth/2)/6.2,maxRiser:Math.max(...points.slice(1).map((p,i)=>p.y-points[i].y))};
 route.sample=(z)=>points[clamp(Math.floor((C.startZ-z)/run),0,count-1)];
 // Reserve the access from the original spawn, the stair corridor and platform
 // before vegetation/rock scatter. Pads and surrounding terrain remain intact.
 terrain.addClearZone([[51,-73],[57,-73],[50,-111],[43,-111]]);
 terrain.addClearZone([[C.x-3.2,C.startZ+2],[C.x+3.2,C.startZ+2],[C.x+3.2,C.endZ-1],[C.x-3.2,C.endZ-1]]);
 terrain.addClearZone([[C.x-5,C.refugeZ+4],[C.x+5,C.refugeZ+4],[C.x+5,C.refugeZ-4],[C.x-5,C.refugeZ-4]]);
 terrain.evacuationRoute=route;
 return route;
}

// Read the very same local water surface used by the player's buoyancy/current
// path. High ground is a measured elevation, never a player immunity flag.
export function routeObservation(route,player,field,records=[]) {
 const p=player.position,e=field?.events.get('tsunami'),R=route.refuge;
 const entranceDistance=Math.hypot(p.x-route.entry.x,p.z-route.entry.z);
 const inside=Math.abs(p.x-R.x)<R.width/2-.3&&Math.abs(p.z-R.z)<R.depth/2-.2;
 const atRefuge=inside&&Math.abs(p.y-R.y)<.5&&player.mode==='walk';
 const water=field?.waterAt(R.x,R.z)??0;
 return {warning:!!e,remainingWarning:e?Math.max(0,e.warning-e.time):0,coastReached:!!e?.coastReached,atRefuge,
  entranceDistance,progress:clamp(route.startZ-p.z,0,route.length),playerElevation:p.y,playerMode:player.mode,
  playerWaterDepth:Math.max(0,(field?.waterAt(p.x,p.z)??0)-p.y),refugeElevation:R.y,refugeGround:R.ground,
  refugeWaterDepth:Math.max(0,water-R.y),brokenSections:records.filter(r=>r.broken).length,
  remainingDistance:atRefuge?0:p.z>route.startZ?entranceDistance+route.length:Math.hypot(p.x-R.x,p.z-R.z),
  lightMode:e?'warning':'steady',width:route.width,length:route.length};
}
