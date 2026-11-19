import { Material, Texture } from '../engine/webgpu.js';
import { Part } from '../world/village/GeoBuilder.js';

// Four crisp, locally drawn signs in one atlas. No remote font/image dependency.
// All signs are geometry-tagged with their owning section for physical fracture.
export function evacuationSignMaterial(elevation,length) {
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
 const c=canvas.getContext('2d');
 const labels=[['TSUNAMI EVACUATION','HIGH GROUND',`${Math.round(length)} m UPHILL  ·  FOLLOW GREEN LIGHTS`],['KEEP CLIMBING','REFUGE AHEAD',`HIGH GROUND  +${Math.round(elevation)} m`],['HIGH-GROUND REFUGE',`+${Math.round(elevation)} m`, 'ASSEMBLY POINT  ·  STAY ABOVE THE FLOOD'],['EVACUATION BRIDGE','CONTINUE UPHILL','NO VEHICLES  ·  KEEP THE WALKWAY CLEAR']];
 for(let i=0;i<4;i++){
  const y=i*256;c.fillStyle='#0b5543';c.fillRect(0,y,1024,256);
  c.strokeStyle='#dff5db';c.lineWidth=6;c.strokeRect(12,y+12,1000,232);
  c.fillStyle='#eaf7df';c.textAlign='left';c.font='700 32px system-ui';c.fillText(labels[i][0],164,y+58);
  c.font='800 58px system-ui';c.fillText(labels[i][1],164,y+133);
  c.font='600 24px system-ui';c.fillText(labels[i][2],164,y+201);
  // Big direction arrow remains recognisable far beyond the text's read distance.
  c.beginPath();c.moveTo(88,y+48);c.lineTo(35,y+107);c.lineTo(64,y+107);c.lineTo(64,y+197);c.lineTo(111,y+197);c.lineTo(111,y+107);c.lineTo(141,y+107);c.closePath();c.fill();
 }
 const pixels=c.getImageData(0,0,1024,1024).data;
 const texture=new Texture({label:'evacuation-signs',width:1024,height:1024,format:'rgba8unorm-srgb',data:new Uint8Array(pixels)});
 return new Material({name:'evacuation-signage',textures:{evacSigns:texture},side:'double',roughness:.7,
  surface:'s.albedo=textureSample(evacSigns,smpLinearClamp,in.uv).rgb;s.emissive=s.albedo*0.16;'});
}

export function signFace(width,height,row) {
 const w=width/2,h=height/2,top=row/4,bottom=(row+1)/4;
 return new Part([-w,-h,0,w,-h,0,w,h,0,-w,h,0],[0,0,1,0,0,1,0,0,1,0,0,1],[0,bottom,1,bottom,1,top,0,top],[0,1,2,0,2,3]);
}
