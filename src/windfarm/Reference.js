// NREL/TP-500-38060 (Jonkman et al., 2009), verified from the OSTI full text.
// See docs/windfarm.md for source pages and the deliberately simplified parts.
export const DEG = Math.PI / 180;
export const RPM = Math.PI / 30;
export const REFERENCE = Object.freeze({
 name: 'NREL 5 MW reference', source: 'https://www.osti.gov/servlets/purl/947422',
 rating: 5e6, radius: 63, hubRadius: 1.5, hubHeight: 90, towerHeight: 87.6,
 overhang: 5, tilt: 5 * DEG, precone: 2.5 * DEG,
 cutIn: 3, ratedWind: 11.4, cutOut: 25, minimumRPM: 6.9, ratedRPM: 12.1,
 cpMax: 0.482, optimalTSR: 7.55, efficiency: 0.944, gearbox: 97,
 bladeMass: 17740, bladeFirstMoment: 363231, bladeSecondMoment: 11776047,
 hubMass: 56780, hubInertia: 115926, nacelleMass: 240000,
 generatorInertia: 534.116, towerMass: 347460, towerCM: 38.234,
 towerBaseDiameter: 6, towerTopDiameter: 3.87, towerBaseThickness: 0.027,
 towerTopThickness: 0.019, steelE: 210e9, towerFrequency: 0.324,
 yawRate: 0.3 * DEG, pitchRate: 8 * DEG,
 generatorK: 0.0255764, maxGeneratorTorque: 47402.91,
 generatorTorqueRate: 15000, brakeTorque: 28116.2 * 97, brakeRamp: 0.6,
});
export const SWEPT_AREA = Math.PI * (REFERENCE.radius * Math.cos(REFERENCE.precone)) ** 2;
export const ROTOR_INERTIA = 3 * (REFERENCE.bladeSecondMoment + 2 * REFERENCE.hubRadius * REFERENCE.bladeFirstMoment + REFERENCE.bladeMass * REFERENCE.hubRadius ** 2) * Math.cos(REFERENCE.precone) ** 2 + REFERENCE.hubInertia;
export const DRIVE_INERTIA = ROTOR_INERTIA + REFERENCE.generatorInertia * REFERENCE.gearbox ** 2;
// Model assumptions, not published NREL design capacities or safety logic.
export const ASSUMPTIONS = Object.freeze({
 restartWind: 20, restartHold: 5, overspeedRatio: 1.22,
 pitchAttenuation: 14 * DEG, towerDamping: 0.04,
 steelYield: 355e6, strengthFactor: 1.5, compositeAllowable: 180e6,
 bladeRootSection: 0.16, bladeRootArea: 0.35, bladeThrustLever: 0.64 * 63,
 foundationDiameter: 13, foundationEmbedment: 2,
 foundationMomentCapacity: 320e6, foundationShearCapacity: 8e6,
 foundationUpliftCapacity: 40e6, overloadTime: 2.5,
 towerCd: 0.7, nacelleCd: 1.1, foundationCd: 1.2, nacelleArea: 18,
 ctOperating: 0.8, ctFeathered: 0.04, wakeExpansion: 0.04,
 wakeTurbulence: 0.16, wakeFadeStart: 8*126, wakeDistance: 10*126,
 step: 1 / 120, maxFrame: 0.1,
});
// Radius from hub centre / chord / twist, Table 3-1. End caps are interpolated.
// Symmetric thick airfoil sections are visual approximations, not the DU polars.
export const BLADE_STATIONS = Object.freeze([
 [1.5,3.542,13.308], [2.8667,3.542,13.308], [5.6,3.854,13.308],
 [8.3333,4.167,13.308], [11.75,4.557,13.308], [15.85,4.652,11.480],
 [19.95,4.458,10.162], [24.05,4.249,9.011], [28.15,4.007,7.795],
 [32.25,3.748,6.544], [36.35,3.502,5.361], [40.45,3.256,4.188],
 [44.55,3.010,3.125], [48.65,2.764,2.319], [52.75,2.518,1.526],
 [56.1667,2.313,0.863], [58.9,2.086,0.370], [61.6333,1.419,0.106], [63,0.15,0],
]);
