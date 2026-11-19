import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrassMask,GRASS_MASK_TEXEL} from '../src/world/vegetation/Scatter.js';
import {TerrainData} from '../src/world/TerrainData.js';

function fixture(){
 const terrain={size:64,origin:-128,clearZones:[],heightAt:()=>4.5,inClearZone:TerrainData.prototype.inClearZone};
 TerrainData.prototype.addClearZone.call(terrain,[[-113,-107],[-99,-103],[-104,-92],[-118,-96]]);
 const site={terrain,noise:{noise:()=>0},noise2:{noise:()=>0},rock:()=>0,spawnDist:()=>1000,obstacleDist:()=>1000,villageDist:()=>1000,inBay:()=>false,cover:(x,z,out)=>Object.assign(out,{h:4.5,bare:0,path:0,forest:0,sand:0})};
 return {terrain,mask:buildGrassMask(site)};
}
function filtered(mask,terrain,x,z,channel){
 const u=(x-terrain.origin)/GRASS_MASK_TEXEL-.5,v=(z-terrain.origin)/GRASS_MASK_TEXEL-.5,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
 const value=(dx,dz)=>mask.data[((j+dz)*mask.res+i+dx)*4+channel];
 return (value(0,0)*(1-a)+value(1,0)*a)*(1-b)+(value(0,1)*(1-a)+value(1,1)*a)*b;
}
test('Rendered grass density stays zero throughout rotated reserved floors, including filtered edges and a one-metre blade margin',()=>{
 const {terrain,mask}=fixture();let checked=0;
 for(let z=-110;z<=-89;z+=.25)for(let x=-121;x<=-96;x+=.25)if(terrain.inClearZone(x,z,1)){
  for(let c=0;c<4;c++)assert.equal(filtered(mask,terrain,x,z,c),0,`grass crosses reserved floor at ${x},${z}`);
  checked++;
 }
 assert.ok(checked>2000);
});
test('Grass outside the reserved floor margin retains its ordinary meadow density',()=>{
 const {terrain,mask}=fixture();assert.ok(filtered(mask,terrain,-82,-82,1)>100);
 assert.equal(filtered(mask,terrain,-82,-82,0),0);
});
