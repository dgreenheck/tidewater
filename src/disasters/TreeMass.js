// Green-wood mass distributions for the authored vegetation. Metres, kg and kg m², y up from the
// stem base. A piece is the part of the tree above `from` (0 = the whole uprooted tree, the
// failure height for a snapped top); the stump below it never becomes a body.
//
// Stem: green density times a bole form factor of the base cylinder. Green wood weighs about 600
// to 1000 kg/m³ at and above fibre saturation (Wood Handbook FPL-GTR-190, ch. 4); declared 850
// for the island broadleaves and 700 for palm stems, whose soft core pulls the mean down. Form
// factor (stem volume over its base cylinder) is 0.4 to 0.5 for broadleaf boles; declared 0.45,
// and 0.8 for the near-columnar palm stem. Crown: 30% of a broadleaf's mass (branches and
// foliage) and 15% of a palm's (fronds and nuts), as an ellipsoid at the authored crown. The crown
// is counted as buoyant wood at the stem's density, so a floating tree's stem floats and its
// crown drags rather than sinking the top end.
// Check: a 12.5 m broadleaf with a 0.4 m base weighs 860 kg here. Chave et al. 2014 (Global
// Change Biology 20: 3177) gives about 640 kg dry for that diameter, height and a 0.6 basic
// density, about 1150 kg green, so this is light but of the right order.
export const GREEN_DENSITY = Object.freeze( { canopy: 850, palms: 700 } ); // kg/m³
const FORM = Object.freeze( { canopy: .45, palms: .8 } );
const CROWN_FRACTION = Object.freeze( { canopy: .30, palms: .15 } );

export function treeMassProperties( record, type = 'canopy', from = 0 ) {
	const kind = type === 'palms' ? 'palms' : 'canopy', palm = kind === 'palms';
	const height = Math.max( 3, record.H || 6 ), scale = record.s || 1, radius = .2 * scale, density = GREEN_DENSITY[ kind ];
	const fullStem = density * FORM[ kind ] * Math.PI * radius * radius * height;
	const crownMass = fullStem * CROWN_FRACTION[ kind ] / ( 1 - CROWN_FRACTION[ kind ] );
	// The piece keeps at least 1 m of stem, so a snap can never leave a crown with no stem.
	const base = Math.min( Math.max( 0, from ), height - 1 ), length = height - base;
	const stemMass = fullStem * length / height, mass = stemMass + crownMass;
	// PlantGeometry: palm fronds span roughly 4.5 m; the canopy reference ellipsoid has its
	// centre at 7.8 m and radii 5.2, 3.7, 5.2 at the nominal 12.5 m height, before instance scale.
	const crownRadius = ( palm ? 4.5 : 5.2 ) * scale, crownHalfHeight = palm ? 1.8 * scale : height * 3.7 / 12.5;
	const crownY = palm ? height - .6 * scale : height * 7.8 / 12.5;
	const stemY = base + length * .5, comY = ( stemMass * stemY + crownMass * crownY ) / mass;
	const transverse = stemMass * ( 3 * radius ** 2 + length ** 2 ) / 12 + stemMass * ( stemY - comY ) ** 2
		+ crownMass * ( crownRadius ** 2 + crownHalfHeight ** 2 ) / 5 + crownMass * ( crownY - comY ) ** 2;
	const axial = stemMass * radius ** 2 / 2 + 2 * crownMass * crownRadius ** 2 / 5;
	return { mass, radius, height, length, base, density, stemMass, crownMass, crownRadius, crownHalfHeight, crownY, stemY, comY,
		volume: mass / density, stemVolume: stemMass / density, crownVolume: crownMass / density,
		centerOfMass: [ 0, comY - stemY, 0 ], principalInertia: [ transverse, axial, transverse ] };
}
