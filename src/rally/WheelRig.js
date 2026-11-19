// Physics order is front then rear, negative X first. A one-piece wheel rolls
// and steers on the same pivot. A detailed hub steers its brake calliper too,
// with only the disc and wheel spinning on the cambered child axle.
import { Euler } from '../engine/index.js';

const NAMES = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];
const angles = new Euler( 0, 0, 0, 'YXZ' );

export function bindWheels( model, profile ) {
	return NAMES.map( name => {
		const carrier = model.pivots.get( name );
		if ( ! carrier ) throw new Error( `Rally model is missing ${ name }` );
		const roll = model.pivots.get( name + 'Roll' );
		// Model origin is the ground plane. The authored loaded tyre radius also
		// sets its vertical offset against the solver's single mean contact radius.
		const radius = roll ? carrier.userData.loadedRadius : profile.radius;
		return { carrier, roll, radius, offset: radius - profile.radius };
	} );
}

export function poseWheel( rig, height, steer, spin ) {
	rig.carrier.position.y = height + rig.offset;
	if ( rig.roll ) {
		rig.carrier.rotation.y = steer;
		rig.roll.rotation.x = spin;
	} else {
		rig.carrier.quaternion.setFromEuler( angles.set( spin, steer, 0, 'YXZ' ) );
	}
}
