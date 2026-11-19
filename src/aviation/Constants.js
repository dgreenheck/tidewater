// Shared physical units/constants are deliberately identical to the world load service.
// Geometry, aerodynamic derivatives and inertias below are declared fictional tuning,
// not performance data for any real aircraft or carrier. See docs/aviation.md.
export { GRAVITY, AIR_DENSITY, SEA_WATER_DENSITY } from '../physics/Loads.js';
export const STEP=1/120;
export const AIRCRAFT=Object.freeze({mass:17000,area:48,span:13.6,chord:3.8,
 inertia:[130000,190000,52000],maxThrust:140000,cl0:0.15,clAlpha:4.3,
 flapLift:0.65,stallAlpha:0.31,cd0:0.026,efficiency:0.8,
 gearK:620000,gearC:90000,gearTravel:0.42,
 gearPoints:[[0,-2,5.3],[-2.65,-2,-1.7],[2.65,-2,-1.7]],
 catapultForce:450000,catapultLength:95,catapultSpeed:78,
 cableMaxForce:650000,cableStroke:115,cableEnergy:65e6,
 maxLandingSink:7.5,maxLandingBank:0.24,maxLandingHeading:0.27});
export const CARRIER=Object.freeze({mass:85000000,length:320,beam:78,hullBeam:40,
 deckY:18,draft:11,waterplane:8500,gmRoll:3.2,gmPitch:170,
 inertia:[7.5e11,7.5e11,2.2e10],damping:[0.2,0.4,0.22],
 launch:[8,2,24],runwayHeading:-0.12217304764,runwayOrigin:[-9,18,-142],
 wires:[30,42,54,66],deckPolygon:[[-27,-160],[27,-160],[36,-135],[36,68],[28,145],[18,160],[-18,160],[-34,110],[-42,35],[-42,-70],[-35,-145]]});
