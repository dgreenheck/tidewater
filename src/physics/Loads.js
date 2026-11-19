// Shared SI force laws. Geometry and coefficients belong to the caller's model.
// Reference air: dry sea-level ISA, 15 C. Seawater density is an assumed average;
// neither is a live thermodynamic model. See docs/physical-model.md for provenance.
export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;
export const SEA_WATER_DENSITY = 1025;

function positive(value, name) {
 if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
 return value;
}
function finite(value) {
 if (!Number.isFinite(value)) throw new RangeError('Physical calculation overflowed its finite range');
 return value;
}
// q = rho v² / 2, Pa. Speed is a magnitude, not a signed velocity component.
export function dynamicPressure(speed, density = AIR_DENSITY) {
 return finite(0.5 * positive(density, 'Density') * positive(speed, 'Speed') ** 2);
}
// F = rho Cd A |u-v| (u-v) / 2, N. Relative velocity is fluid minus body velocity.
// No artificial cap here: the owning solver must explicitly choose a stable time
// step or bounded drag integration, and report any operational envelope limits.
export function quadraticDrag(out, relativeVelocity, { density = AIR_DENSITY, dragCoefficient = 1, area = 1 } = {}) {
 const {x,y,z} = relativeVelocity;
 // Three tests, not [x,y,z].every: this runs per body per frame and the array was garbage (same result).
 if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw new RangeError('Relative velocity must be finite');
 const k = finite(0.5 * positive(density,'Density') * positive(dragCoefficient,'Drag coefficient') * positive(area,'Area') * Math.hypot(x,y,z));
 out.x = finite(k*x); out.y = finite(k*y); out.z = finite(k*z);
 return out;
}
// Archimedes force magnitude, N; direction is opposite gravitational acceleration.
export function buoyancy(displacedVolume, density = SEA_WATER_DENSITY) {
 return finite(positive(density,'Density') * GRAVITY * positive(displacedVolume,'Displaced volume'));
}
export function kineticEnergy(mass, speed) {
 return finite(0.5 * positive(mass,'Mass') * positive(speed,'Speed') ** 2);
}
// Gauge pressure at depth below the local free surface, Pa.
export function hydrostaticPressure(depth, density = SEA_WATER_DENSITY) {
 return finite(positive(density,'Density') * GRAVITY * positive(depth,'Depth'));
}
