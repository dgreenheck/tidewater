// One-way spherical grain/droplet drag in SI units. The empirical Cd(Re) law is
// Schiller–Naumann is stated in NASA Ames' spherical-droplet supplement Eq. 4:
// https://www.nas.nasa.gov/assets/nas/pdf/staff/Shariff_K_Making_aircraft_vortices_visible_water_spray_supplemental.pdf
// The Re >= 1000 constant-Cd extension follows OpenFOAM Foundation:
// https://cpp.openfoam.org/v13/SchillerNaumann_8C_source.html
// This is a parcel response model, not an atmospheric or two-way CFD solver.
export const AIR={density:1.225,viscosity:1.81e-5,gravity:9.81};

export function dragRate(diameter,density,relativeSpeed){
 const d=Math.max(1e-7,diameter),rho=Math.max(AIR.density+1,density),speed=Math.max(0,relativeSpeed);
 const re=AIR.density*d*speed/AIR.viscosity;
 // CdRe avoids a division by zero and retains the Stokes limit at zero slip.
 const cdRe=re<1000?24*(1+.15*re**.687):.44*re;
 return .75*AIR.viscosity*cdRe/(rho*d*d);
}

// Frozen-coefficient exponential integration: exact for linear Stokes drag and
// constant carrier velocity, including gravity and displacement. For finite Re,
// the coefficient is reevaluated each <=1/60 s field step. Tiny grains therefore
// cannot explode when their response time is much shorter than a rendered frame.
export function advanceAerosol(parcel,air,dt,gravity=AIR.gravity){
 if(!(dt>0)||!Number.isFinite(dt))return;
 const v=parcel.v,p=parcel.p;
 const k=dragRate(parcel.diameter,parcel.density,Math.hypot(air.x-v.x,air.y-v.y,air.z-v.z));
 const g=-gravity*(1-AIR.density/parcel.density),relax=-Math.expm1(-k*dt),time=relax/k;
 const ex=air.x,ey=air.y+g/k,ez=air.z;
 p.x+=ex*dt+(v.x-ex)*time;p.y+=ey*dt+(v.y-ey)*time;p.z+=ez*dt+(v.z-ez)*time;
 v.x+=(ex-v.x)*relax;v.y+=(ey-v.y)*relax;v.z+=(ez-v.z)*relax;
 parcel.responseTime=1/k;parcel.grainMass=Math.PI/6*parcel.density*parcel.diameter**3;
}

export function parcelRadius(initialRadius,diffusivity,age){
 return Math.sqrt(initialRadius*initialRadius+4*diffusivity*Math.max(0,age));
}
export function parcelOpticalDepth(extinctionArea,radius){
 return extinctionArea/(Math.PI*Math.max(1e-6,radius*radius));
}
