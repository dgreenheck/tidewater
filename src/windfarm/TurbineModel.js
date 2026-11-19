import { AIR_DENSITY, SEA_WATER_DENSITY, GRAVITY, dynamicPressure, quadraticDrag, buoyancy, kineticEnergy } from '../physics/Loads.js';
import { REFERENCE as R, ASSUMPTIONS as A, DEG, RPM, SWEPT_AREA, DRIVE_INERTIA, ROTOR_INERTIA } from './Reference.js';

export const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const approach = (value,target,limit) => value+clamp(target-value,-limit,limit);
const wrap = a => Math.atan2(Math.sin(a),Math.cos(a));
export function sectionModulus(diameter,thickness) { return Math.PI*(diameter**4-(diameter-2*thickness)**4)/(32*diameter); }

// Peak calibrated to NREL. The shape away from that peak is an explicit smooth
// surrogate, not blade-element momentum / a measured Cp surface. Cp <= 0.482.
export function aerodynamics(omega, axialSpeed, pitch=0) {
 const v=Math.max(0,axialSpeed), lambda=v>1e-9?omega*R.radius/v:0;
 const x=lambda/R.optimalTSR;
 const feather=pitch>=Math.PI/2?0:Math.exp(-pitch/A.pitchAttenuation)*Math.cos(pitch)**2;
 const cp=clamp(R.cpMax*x*Math.exp(1-x)*feather,0,R.cpMax);
 const flux=dynamicPressure(v,AIR_DENSITY)*SWEPT_AREA*v;
 // The analytic Cp/lambda limit is finite at rest: startup torque is physical,
 // while aerodynamic work is still zero at exactly zero rotor speed.
 const torque=dynamicPressure(v,AIR_DENSITY)*SWEPT_AREA*R.radius*R.cpMax/R.optimalTSR*Math.exp(1-x)*feather;
 const ct=A.ctFeathered+(A.ctOperating-A.ctFeathered)*feather;
 return {cp,lambda,flux,torque,ct,thrust:dynamicPressure(v,AIR_DENSITY)*SWEPT_AREA*ct};
}

export function generatorDemand(omega,pitch=0) {
 const highRPM=omega/RPM*R.gearbox;
 if(highRPM<=670)return 0;
 const ratedMechanical=R.rating/R.efficiency;
 let highTorque;
 if(highRPM<871)highTorque=R.generatorK*871**2*(highRPM-670)/(871-670);
 else if(highRPM<1161.963&&pitch<DEG) {
  // Region 2.5 is a linear bridge to rated constant power. Its lower transition
  // is an assumption (1050 rpm), not NREL's induction-slip intersection solver.
  const q2=R.generatorK*highRPM**2;
  highTorque=highRPM<1050?q2:R.generatorK*1050**2+(ratedMechanical/(1161.963*RPM)-R.generatorK*1050**2)*(highRPM-1050)/(1161.963-1050);
 } else highTorque=ratedMechanical/(omega*R.gearbox);
 return clamp(highTorque,0,R.maxGeneratorTorque)*R.gearbox;
}

function automaticPitch(axialSpeed) {
 if(axialSpeed<=0)return 0;
 const wanted=R.rating/R.efficiency;
 if(aerodynamics(R.ratedRPM*RPM,axialSpeed,0).torque*R.ratedRPM*RPM<=wanted)return 0;
 let lo=0,hi=Math.PI/2;
 for(let i=0;i<20;i++) { const mid=(lo+hi)/2; if(aerodynamics(R.ratedRPM*RPM,axialSpeed,mid).torque*R.ratedRPM*RPM>wanted)lo=mid;else hi=mid; }
 return (lo+hi)/2;
}

export class TurbineModel {
 constructor({id='WT-01',x=0,z=0,groundY=0,terrainMin=groundY,baseY=groundY+.45,anchorY=terrainMin-A.foundationEmbedment,yaw=0,onFailure=null}={}) {
  this.id=id;this.x=x;this.z=z;this.groundY=groundY;this.terrainMin=terrainMin;this.baseY=baseY;this.anchorY=anchorY;this.initialYaw=yaw;this.onFailure=onFailure;
  this.reset();
 }
 reset() {
  Object.assign(this,{enabled:true,farmEnabled:true,brake:false,minimumPitch:0,yaw:this.initialYaw,omega:0,angle:0,pitch:Math.PI/2,pitchIntegral:0,brakeDeployment:1,generatorTorque:0,
   electricalPower:0,availablePower:0,axialPower:0,rotorPower:0,aerodynamicTorque:0,brakeTorque:0,cp:0,ct:0,tsr:0,windSpeed:0,axialSpeed:0,yawError:0,thrust:0,
   energyJ:0,aerodynamicWorkJ:0,generatorWorkJ:0,brakeWorkJ:0,conversionLossJ:0,rotorEnergyJ:0,detachedEnergyJ:0,inertia:DRIVE_INERTIA,elapsed:0,discardedTime:0,
   highWindLatched:false,overspeedLatched:false,safeSeconds:0,damaged:false,failedComponents:[],failureQueue:[],status:'starting',
   deflectionX:0,deflectionZ:0,deflectionVX:0,deflectionVZ:0,peakUtilization:0,
   loads:{},componentDamage:{blade:0,nacelle:0,tower:0,foundation:0}});
 }
 setEnabled(value){this.enabled=!!value;}
 setBrake(value){this.brake=!!value;}
 setMinimumPitch(degrees) {
  if(!Number.isFinite(degrees)||degrees<0||degrees>90)throw new RangeError('Minimum pitch must be 0 to 90 degrees.');
  this.minimumPitch=degrees*DEG;
 }
 restart() {
  if(this.damaged)return 'Repair the turbine before restarting.';
  if(this.highWindLatched||this.overspeedLatched) {
   if(this.windSpeed>=A.restartWind||this.safeSeconds<A.restartHold)return 'Restart needs wind below 20 m/s for 5 seconds.';
   if(this.omega>R.ratedRPM*RPM)return 'Wait for the rotor to slow below rated speed.';
  }
  this.highWindLatched=this.overspeedLatched=false;this.pitchIntegral=0;
  return '';
 }
 advance(dt,hub,base=hub) {
  if(!Number.isFinite(dt)||dt<=0)return;
  for(const sample of [hub,base])for(const key of ['wx','wy','wz','ax','ay','az','height','ux','uz'])if(sample[key]!==undefined&&!Number.isFinite(sample[key]))throw new RangeError(`Invalid environment ${key}`);
  const duration=Math.min(dt,A.maxFrame);this.discardedTime+=Math.max(0,dt-duration);
  const steps=Math.ceil(duration/A.step),h=duration/steps;
  for(let i=0;i<steps;i++)this.step(h,hub,base);
 }
 step(dt,hub,base) {
  const wx=hub.wx||0,wy=hub.wy||0,wz=hub.wz||0;
  this.windSpeed=Math.hypot(wx,wy,wz);
  this.availablePower=dynamicPressure(this.windSpeed)*SWEPT_AREA*this.windSpeed;
  if(this.windSpeed>=R.cutOut)this.highWindLatched=true;
  if(this.omega>R.ratedRPM*RPM*A.overspeedRatio)this.overspeedLatched=true;
  this.safeSeconds=this.windSpeed<A.restartWind?this.safeSeconds+dt:0;
  const desiredYaw=Math.hypot(wx,wz)>0.01?Math.atan2(-wx,-wz):this.yaw;
  if(!this.failedComponents.includes('tower')&&!this.failedComponents.includes('foundation'))this.yaw=wrap(this.yaw+clamp(wrap(desiredYaw-this.yaw),-R.yawRate*dt,R.yawRate*dt));
  this.yawError=wrap(desiredYaw-this.yaw);
  const nx=Math.sin(this.yaw)*Math.cos(R.tilt),ny=Math.sin(R.tilt),nz=Math.cos(this.yaw)*Math.cos(R.tilt);
  const signedAxial=-(wx*nx+wy*ny+wz*nz);
  this.axialSpeed=Math.max(0,signedAxial);
  const active=this.enabled&&this.farmEnabled&&!this.brake&&!this.highWindLatched&&!this.overspeedLatched&&!this.damaged&&this.windSpeed>=R.cutIn;
  const speedError=this.omega-R.ratedRPM*RPM;
  if(active)this.pitchIntegral=clamp(this.pitchIntegral+speedError*dt*0.08,-0.08,0.35);else this.pitchIntegral=0;
  const pitchTarget=active?Math.max(this.minimumPitch,automaticPitch(this.axialSpeed)+Math.max(-0.04,1.1*speedError+this.pitchIntegral)):Math.PI/2;
  this.pitch=approach(this.pitch,clamp(pitchTarget,0,Math.PI/2),R.pitchRate*dt);
  this.brakeDeployment=approach(this.brakeDeployment,active?0:1,dt/R.brakeRamp);
  const aero=aerodynamics(this.omega,this.axialSpeed,this.pitch);
  const rotorAttached=!this.failedComponents.some(x=>['blade','nacelle','tower','foundation'].includes(x));
  this.aerodynamicTorque=rotorAttached?aero.torque:0;
  this.cp=rotorAttached?aero.cp:0;this.tsr=aero.lambda;this.ct=aero.ct;this.axialPower=aero.flux;
  const previousOmega=this.omega;
  const demand=active?generatorDemand(this.omega,this.pitch):0;
  this.generatorTorque=active?approach(this.generatorTorque,demand,R.generatorTorqueRate*R.gearbox*dt):0;
  // Cap work delivered during this step, rather than clipping the output meter.
  const inertia=Math.max(1,this.inertia);
  const noLoadSpeed=this.omega+this.aerodynamicTorque/inertia*dt;
  this.generatorTorque=Math.min(this.generatorTorque,R.rating/(R.efficiency*Math.max(noLoadSpeed,1e-6)));
  const torqueBeforeBrake=this.aerodynamicTorque-this.generatorTorque;
  this.brakeTorque=Math.min(R.brakeTorque*this.brakeDeployment,Math.max(0,inertia*this.omega/dt+torqueBeforeBrake));
  const nextOmega=Math.max(0,this.omega+(torqueBeforeBrake-this.brakeTorque)/inertia*dt);
  const midOmega=(previousOmega+nextOmega)/2;
  const aeroWork=this.aerodynamicTorque*midOmega*dt;
  const generatorWork=this.generatorTorque*midOmega*dt;
  const brakeWork=this.brakeTorque*midOmega*dt;
  this.omega=nextOmega;this.angle=(this.angle+midOmega*dt)%(2*Math.PI);
  this.rotorPower=this.aerodynamicTorque*midOmega;
  this.electricalPower=generatorWork/dt*R.efficiency;
  this.energyJ+=this.electricalPower*dt;this.aerodynamicWorkJ+=aeroWork;this.generatorWorkJ+=generatorWork;this.brakeWorkJ+=brakeWork;this.conversionLossJ+=generatorWork*(1-R.efficiency);
  this.rotorEnergyJ=kineticEnergy(this.inertia,this.omega);
  this.elapsed+=dt;
  this.computeLoads(dt,hub,base,signedAxial,rotorAttached);
  // A fracture occurs at this integration boundary. Work delivered before it
  // remains on the energy meter; fail() disconnects all subsequent generation.
  this.status=this.damaged?'damaged':this.highWindLatched?'high-wind shutdown':this.overspeedLatched?'overspeed shutdown':!this.enabled||!this.farmEnabled?'disabled':this.brake?'braking':this.windSpeed<R.cutIn?'below cut-in':this.electricalPower>1000?'generating':'starting';
 }
 computeLoads(dt,hub,base,signedAxial,rotorAttached) {
  const air={x:hub.wx||0,y:hub.wy||0,z:hub.wz||0};
  const towerAttached=!this.failedComponents.some(x=>x==='tower'||x==='foundation');
  const nacelleAttached=towerAttached&&!this.failedComponents.includes('nacelle');
  const towerAir=quadraticDrag({},air,{dragCoefficient:A.towerCd,area:towerAttached?(R.towerBaseDiameter+R.towerTopDiameter)*0.5*R.towerHeight:0});
  const nacelleAir=quadraticDrag({},air,{dragCoefficient:A.nacelleCd,area:nacelleAttached?A.nacelleArea:0});
  const rotorFraction=nacelleAttached?(this.failedComponents.includes('blade')?2/3:1):0;
  this.thrust=dynamicPressure(Math.abs(signedAxial))*SWEPT_AREA*this.ct*rotorFraction;
  const side=Math.sign(signedAxial)||1;
  const fx=-Math.sin(this.yaw)*Math.cos(R.tilt)*this.thrust*side;
  const fz=-Math.cos(this.yaw)*Math.cos(R.tilt)*this.thrust*side;
  const totalTopMass=nacelleAttached?R.nacelleMass+R.hubMass+(this.failedComponents.includes('blade')?2:3)*R.bladeMass:0;
  const towerMass=towerAttached?R.towerMass:0;
  const massMoment=totalTopMass*R.hubHeight+towerMass*R.towerCM;
  const seismicX=(base.ax||0)*massMoment,seismicZ=(base.az||0)*massMoment;
  const effectiveMass=Math.max(1,totalTopMass+0.236*towerMass);
  const stiffness=effectiveMass*(2*Math.PI*R.towerFrequency)**2;
  const damping=2*A.towerDamping*Math.sqrt(stiffness*effectiveMass);
  if(towerAttached) {
   this.deflectionVX+=((fx+nacelleAir.x+towerAir.x*0.375)/effectiveMass-(base.ax||0)-stiffness*this.deflectionX/effectiveMass-damping*this.deflectionVX/effectiveMass)*dt;
   this.deflectionVZ+=((fz+nacelleAir.z+towerAir.z*0.375)/effectiveMass-(base.az||0)-stiffness*this.deflectionZ/effectiveMass-damping*this.deflectionVZ/effectiveMass)*dt;
   this.deflectionX+=this.deflectionVX*dt;this.deflectionZ+=this.deflectionVZ*dt;
  } else {this.deflectionX=this.deflectionZ=this.deflectionVX=this.deflectionVZ=0;}
  const reactionX=stiffness*this.deflectionX+damping*this.deflectionVX;
  const reactionZ=stiffness*this.deflectionZ+damping*this.deflectionVZ;
  // First-mode internal restoring/damping demand reaches the foundation. The
  // 90 m lever matches static cantilever tip loading; residual terms preserve
  // full distributed-wind and mass-moment static limits omitted by one mode.
  const residualMassMoment=massMoment-effectiveMass*R.hubHeight;
  const mx=reactionX*R.hubHeight+towerAir.x*(R.towerHeight/2-0.375*R.hubHeight)-(base.ax||0)*residualMassMoment;
  const mz=reactionZ*R.hubHeight+towerAir.z*(R.towerHeight/2-0.375*R.hubHeight)-(base.az||0)*residualMassMoment;
  const towerMoment=Math.hypot(mx,mz);
  // Dry land transmits ground acceleration. Water current and buoyancy act
  // only on exposed foundation/tower volume actually reached by flood water.
  // The sloping footing is conservatively wetted from its lowest terrain edge.
  const surface=base.height||0;
  const padWet=clamp(surface-this.terrainMin,0,this.baseY-this.terrainMin);
  const towerWet=towerAttached?clamp(surface-this.baseY,0,R.towerHeight):0;
  const current={x:base.ux||0,y:0,z:base.uz||0};
  const padWater=quadraticDrag({},current,{density:SEA_WATER_DENSITY,dragCoefficient:A.foundationCd,area:A.foundationDiameter*padWet});
  const towerWater=quadraticDrag({},current,{density:SEA_WATER_DENSITY,dragCoefficient:A.foundationCd,area:R.towerBaseDiameter*towerWet});
  const water={x:padWater.x+towerWater.x,z:padWater.z+towerWater.z};
  const shearX=reactionX+towerAir.x*.625-(base.ax||0)*(totalTopMass+towerMass-effectiveMass);
  const shearZ=reactionZ+towerAir.z*.625-(base.az||0)*(totalTopMass+towerMass-effectiveMass);
  const anchorLever=this.baseY-this.anchorY;
  const padLever=this.terrainMin+padWet/2-this.anchorY,towerLever=this.baseY+towerWet/2-this.anchorY;
  const foundationMoment=Math.hypot(mx+shearX*anchorLever+padWater.x*padLever+towerWater.x*towerLever,mz+shearZ*anchorLever+padWater.z*padLever+towerWater.z*towerLever);
  const foundationShear=Math.hypot(shearX+water.x,shearZ+water.z);
  const uplift=buoyancy(Math.PI*((A.foundationDiameter/2)**2*padWet+(R.towerBaseDiameter/2)**2*towerWet));
  const towerArea=Math.PI*(R.towerBaseDiameter**2-(R.towerBaseDiameter-2*R.towerBaseThickness)**2)/4;
  const towerStress=towerMoment/sectionModulus(R.towerBaseDiameter,R.towerBaseThickness)+(totalTopMass+towerMass)*Math.max(0,GRAVITY+(base.ay||0))/towerArea;
  const bladeMoment=this.thrust/(rotorFraction>0?3*rotorFraction:3)*A.bladeThrustLever;
  const bladeStress=bladeMoment/A.bladeRootSection+R.bladeMass*this.omega**2*(R.bladeFirstMoment/R.bladeMass+R.hubRadius)/A.bladeRootArea;
  const utilization={
   blade:bladeStress/A.compositeAllowable,
   nacelle:this.thrust/2.2e6,
   tower:towerStress/(A.steelYield/A.strengthFactor),
   foundation:Math.max(foundationMoment/A.foundationMomentCapacity,foundationShear/A.foundationShearCapacity,uplift/A.foundationUpliftCapacity),
  };
  this.loads={padWet,towerWet,anchorLever,towerMoment,towerStress,bladeMoment,bladeStress,foundationMoment,foundationShear,uplift,waterForce:Math.hypot(water.x,water.z),seismicMoment:Math.hypot(seismicX,seismicZ),modalReaction:Math.hypot(reactionX,reactionZ),modalMoment:Math.hypot(reactionX,reactionZ)*R.hubHeight,towerForce:Math.hypot(towerAir.x,towerAir.z),nacelleForce:Math.hypot(nacelleAir.x,nacelleAir.z),stiffness,damping,effectiveMass,utilization};
  this.peakUtilization=Math.max(this.peakUtilization,...Object.values(utilization));
  for(const part of Object.keys(utilization)) {
   if(this.failedComponents.includes(part))continue;
   this.componentDamage[part]=Math.max(0,this.componentDamage[part]+(utilization[part]>1?(utilization[part]-1):-0.2)*dt);
   if(this.componentDamage[part]>=A.overloadTime) {
    this.fail(part);
   }
  }
 }
 fail(part) {
  if(this.failedComponents.includes(part))return;
  this.failedComponents.push(part);this.failureQueue.push(part);this.damaged=true;
  // Fragment initial angular/linear velocities are sampled before transferring
  // their share of rotational energy out of the attached rotor reservoir.
  this.onFailure?.(part,this);
  const before=this.inertia;
  this.inertia=part==='blade'?Math.max(0,before-(ROTOR_INERTIA-R.hubInertia)/3):0;
  this.detachedEnergyJ+=kineticEnergy(before-this.inertia,this.omega);
  if(this.inertia===0)this.omega=0;
  this.rotorEnergyJ=kineticEnergy(this.inertia,this.omega);
  this.electricalPower=this.generatorTorque=0;
 }
 state() {
  return {id:this.id,x:this.x,z:this.z,groundY:this.groundY,terrainMin:this.terrainMin,baseY:this.baseY,hubY:this.baseY+R.hubHeight,anchorY:this.anchorY,enabled:this.enabled,brake:this.brake,minimumPitch:this.minimumPitch/DEG,status:this.status,rotorAngle:this.angle,rpm:this.omega/RPM,pitch:this.pitch/DEG,yaw:this.yaw/DEG,yawError:this.yawError/DEG,windSpeed:this.windSpeed,axialSpeed:this.axialSpeed,availablePower:this.availablePower,axialPower:this.axialPower,rotorPower:this.rotorPower,electricalPower:this.electricalPower,energyJ:this.energyJ,rotorEnergyJ:this.rotorEnergyJ,detachedEnergyJ:this.detachedEnergyJ,inertia:this.inertia,aerodynamicTorque:this.aerodynamicTorque,generatorTorque:this.generatorTorque,brakeTorque:this.brakeTorque,cp:this.cp,ct:this.ct,tsr:this.tsr,thrust:this.thrust,loads:this.loads,damaged:this.damaged,failedComponents:[...this.failedComponents],safeSeconds:this.safeSeconds,highWindLatched:this.highWindLatched,overspeedLatched:this.overspeedLatched,elapsed:this.elapsed,energyResidual:this.aerodynamicWorkJ-this.generatorWorkJ-this.brakeWorkJ-this.detachedEnergyJ-this.rotorEnergyJ,discardedTime:this.discardedTime,tipDeflection:Math.hypot(this.deflectionX,this.deflectionZ)};
 }
}
