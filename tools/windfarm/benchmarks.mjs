import { TurbineModel } from '../../src/windfarm/TurbineModel.js';
import { REFERENCE as R, SWEPT_AREA, DRIVE_INERTIA, RPM } from '../../src/windfarm/Reference.js';

const hub=speed=>({wx:0,wy:0,wz:-speed/Math.cos(R.tilt),height:0});
const results=[];
for(const speed of [2,3,4,6,8,10,11.4,16,20,24,26]) {
 const t=new TurbineModel();for(let i=0;i<6000;i++)t.advance(.05,hub(speed),hub(0));
 results.push({axialWindMS:speed,availableRotorFluxMW:t.axialPower/1e6,electricalMW:t.electricalPower/1e6,rpm:t.omega/RPM,pitchDeg:t.pitch*180/Math.PI,energyMWh:t.energyJ/3.6e9,rotorEnergyMJ:t.rotorEnergyJ/1e6,energyResidualJ:t.state().energyResidual,towerStressMPa:t.loads.towerStress/1e6,status:t.status});
}
console.log(JSON.stringify({reference:R.source,sweptAreaM2:SWEPT_AREA,driveInertiaKgM2:DRIVE_INERTIA,seconds:300,results},null,2));
