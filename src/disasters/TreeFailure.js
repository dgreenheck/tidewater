// Tree failure under wind, flood and shaking: whether a tree bends, snaps or uproots, where on the
// stem it breaks, and how it falls about its hinge. World metres, y up; forces N; moments N m;
// tilt theta in rad from vertical; time s. Pure functions over plain numbers: no allocation.
//
// Reference: the EF scale damage indicators (Wind Science and Engineering Center 2006, used by the
// US National Weather Service). DI 28 hardwood trees: DOD 3 "uprooted" expected at 91 mph (41 m/s),
// DOD 4 "trunks snapped" at 110 mph (49 m/s). DI 27 softwoods: 91 mph and 104 mph (47 m/s). We take
// 41 m/s uproot and 48 m/s snap for the island broadleaves. Palms are far more wind-firm: sabal and
// coconut palms had the highest survival of any urban trees through Category 3 hurricanes (Duryea
// et al. 2007, Arboriculture & Urban Forestry 33(2): 83-97); declared 52 m/s uproot, 58 m/s snap.
// Each capacity is the moment the tree's own crown drag makes at that expected wind, so the
// uncertain crown drag area cancels and a tree of any size fails at the EF wind on average. Root
// plate and stem capacities scatter independently per event (lognormal, CAPACITY_COV.tree 0.35,
// Nicoll et al. 2006), so the mode a tree takes is whichever gives first.
import { capacityFactor, uniform, CAPACITY_COV, STREAM } from './EventRandom.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, GRAVITY } from '../physics/Loads.js';

export const FAILURE_WIND = Object.freeze( {
	canopy: { uproot: 41, snap: 48 }, // m/s, EF DI 27/28 expected values
	palms: { uproot: 52, snap: 58 }, // m/s, declared from the hurricane survival surveys above
} );
// Porous crowns reconfigure in strong wind: CdA at 20-30 m/s is about 0.3 to 0.5 of the still-air
// value (Vollsinger et al. 2005, Can. J. For. Res. 35: 1238). Declared 0.35 on the crown ellipse.
const CROWN_CD = .35;
const STEM_CD = 1.2; // circular cylinder at high Reynolds number, the stem in flood flow
// Stem taper: top diameter 40% of the base (declared). With a crown load the bending stress
// (hc - z) / d(z)^3 peaks at z = (3 a hc - 1) / (2 a), a = TAPER / H: about 0.3 H for a broadleaf,
// where hurricane-snapped stems commonly break. A near-untapered palm peaks at the base clamp.
const TAPER = Object.freeze( { canopy: .6, palms: .15 } );
// Root plate resistance falls away after the peak and is largely gone by about 20 deg (Coutts
// 1986, Annals of Botany 58: 199-211); torn stem fibres hold for only a few degrees. Declared.
const RESIDUAL_ANGLE = Object.freeze( { uproot: .35, snap: .1 } ); // rad
export const RELEASE_TILT = Math.PI / 3; // rad: a near tree becomes a rigid body past 60 deg
export const CROWN_SUPPORT = .3; // crushed crown props the top this fraction of the crown radius off the ground (declared)

export function crownArea( mass ) { return Math.PI * mass.crownRadius * mass.crownHalfHeight; }

// Horizontal crown drag (N) at speed u (m/s) through the crown, signed.
export function crownForce( mass, u ) { return .5 * AIR_DENSITY * CROWN_CD * crownArea( mass ) * u * Math.abs( u ); }

// Where a broadleaf breaks: the peak-stress height of a tapered stem under a crown load, scattered
// by +-8% of the height for knots and defects, clamped to 15-70% of the height.
export function snapHeight( record, mass, kind, seed, index ) {
	const H = mass.height, a = TAPER[ kind ] / H, hc = mass.crownY;
	const peak = a > 0 ? ( 3 * a * hc - 1 ) / ( 2 * a ) : 0;
	const jitter = ( uniform( seed ?? 0, STREAM.tree, 3 * index + 2 ) - .5 ) * .16 * H;
	return Math.min( .7 * H, Math.max( .15 * H, peak + jitter ) );
}

// Nominal capacities (N m) anchored to the EF winds, and this event's scatter factors.
export function treeCapacity( mass, kind, cut, seed, index, out ) {
	const wind = FAILURE_WIND[ kind ];
	out.uproot = crownForce( mass, wind.uproot ) * mass.crownY * capacityFactor( seed, STREAM.tree, 3 * index, CAPACITY_COV.tree );
	out.snap = crownForce( mass, wind.snap ) * ( mass.crownY - cut ) * capacityFactor( seed, STREAM.tree, 3 * index + 1, CAPACITY_COV.tree );
	return out;
}

// Overturning moment (N m) about height z on the stem of a standing tree, from the field sample s
// at its base: crown drag, stem drag in flood flow (acting at half the wetted depth) and shaking
// (s.shake, m/s², acting on the whole tree at its centre of mass).
export function standingMoment( mass, s, depth, z ) {
	const wind = Math.hypot( s.wx, s.wz ), flow = Math.hypot( s.ux ?? 0, s.uz ?? 0 ), wet = Math.min( depth, mass.height );
	const flood = .5 * SEA_WATER_DENSITY * STEM_CD * 2 * mass.radius * wet * flow * flow;
	return crownForce( mass, wind ) * Math.max( 0, mass.crownY - z ) + flood * Math.max( 0, wet * .5 - z ) + mass.mass * ( s.shake ?? 0 ) * Math.max( 0, mass.comY - z );
}

// One hinge substep for the falling part (mass = the piece's treeMassProperties). The fall plane is
// fixed at failure; u is the wind speed along the fall direction (m/s). Crown drag uses the crown's
// velocity relative to the air, so the same term pushes the tree over and damps its swing. The
// residual root plate or fibre moment fades with tilt. Semi-implicit Euler, h <= 1/120 s.
export function hingeStep( t, mass, u, h ) {
	const lever = mass.crownY - t.cut, arm = mass.comY - t.cut;
	const inertia = t.hingeInertia ??= mass.principalInertia[ 0 ] + mass.mass * arm * arm;
	const relative = u * Math.cos( t.theta ) - lever * t.omega;
	const residual = t.capacity * Math.max( 0, 1 - t.theta / RESIDUAL_ANGLE[ t.mode ] );
	const moment = crownForce( mass, relative ) * lever + mass.mass * GRAVITY * arm * Math.sin( t.theta ) - residual;
	t.omega = Math.max( 0, t.omega + moment / inertia * h );
	t.theta += t.omega * h;
}
