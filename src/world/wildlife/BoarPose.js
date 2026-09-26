import { ShaderModule } from '../../engine/gpu/Shader.js';

// World travel per gait cycle, before adult scale. The shader's stance moves a hoof back by
// this length times its stance fraction; matching CPU phase advance cancels body translation.
// The small launch blend avoids snapping from the neutral stand to an extended first stride.
export function boarCycleLength( stride ) {

	const t = Math.min( 1, Math.max( 0, stride / 0.06 ) );
	return ( 0.45 + 0.75 * stride ) * t * t * ( 3 - 2 * t );

}

// Pose is (phase radians, actual speed / 3.7, rooting amount). No frame.time dependency:
// evaluating the same function with the previous record gives the exact previous articulation.
// Rig: torso -1, legs 0/1 fore right/left, 2/3 hind right/left, head4, tail5, ears6/7.
export const boarPoseModule = new ShaderModule( {

	name: 'boarPose',
	code: /* wgsl */`
fn boarRotateX( p: vec3f, a: f32 ) -> vec3f {
	return vec3f( p.x, p.y * cos( a ) - p.z * sin( a ), p.y * sin( a ) + p.z * cos( a ) );
}
fn boarRotateY( p: vec3f, a: f32 ) -> vec3f {
	return vec3f( p.x * cos( a ) + p.z * sin( a ), p.y, -p.x * sin( a ) + p.z * cos( a ) );
}
fn boarRotateZ( p: vec3f, a: f32 ) -> vec3f {
	return vec3f( p.x * cos( a ) - p.y * sin( a ), p.x * sin( a ) + p.y * cos( a ), p.z );
}
fn boarGaitLength( drive: f32 ) -> f32 {
	return ( 0.45 + 0.75 * drive ) * smoothstep( 0.0, 0.06, drive );
}
// Map a leg section between its rest and solved joints. Longitudinal stretch is permitted
// only by the reach solve; the cross-section retains its width, including at full extension.
fn boarSegment( p: vec3f, a: vec3f, b: vec3f, c: vec3f, d: vec3f ) -> vec3f {
	let restAxis = b.yz - a.yz; let posedAxis = d.yz - c.yz;
	let inv = inverseSqrt( max( dot( restAxis, restAxis ), 0.000001 ) );
	let along = dot( p.yz - a.yz, restAxis ) * inv * inv;
	let across = dot( p.yz - a.yz, vec2f( -restAxis.y, restAxis.x ) ) * inv;
	let side = vec2f( -posedAxis.y, posedAxis.x ) * inverseSqrt( max( dot( posedAxis, posedAxis ), 0.000001 ) );
	let yz = c.yz + posedAxis * along + side * across;
	return vec3f( p.x + c.x - a.x, yz );
}
fn boarPose( rest: vec3f, bone: f32, pose: vec3f, seed: f32 ) -> vec3f {
	let phase = pose.x; let drive = clamp( pose.y, 0.0, 1.0 ); let root = clamp( pose.z, 0.0, 1.0 );
	let gaitWeight = smoothstep( 0.0, 0.06, drive );
	let trot = smoothstep( 0.29, 0.60, drive );
	let slow = phase * 0.43 + seed * 6.283185307;
	// The trunk yields over the supporting limbs. The leg solve compensates this offset,
	// while each supporting hoof stays on y=0 instead of inheriting the body's bounce.
	let bodyY = gaitWeight * ( -0.020 - 0.020 * trot + ( 0.004 + trot * 0.008 ) * sin( phase * 2.0 ) ) - root * 0.009;
	var p = rest;
	if ( bone >= 0.0 && bone < 3.5 ) {
		let front = bone < 1.5;
		let side = select( 1.0, -1.0, bone == 1.0 || bone == 3.0 );
		// At a walk, hind contacts lead their same-side forefoot by a quarter cycle.
		// Increasing speed pairs the opposite fore/hind feet for a diagonal trot.
		var offset = select( 0.0, 0.5, bone == 1.0 );
		if ( !front ) { offset = mix( select( 0.25, 0.75, bone == 3.0 ), select( 0.5, 1.0, bone == 3.0 ), trot ); }
		let cycle = fract( phase / 6.283185307 + offset );
		let stance = mix( 0.70, 0.48, trot );
		let travel = boarGaitLength( drive );
		let reach = travel * stance;
		var footZ = reach * ( 0.5 - cycle / stance );
		var lift = 0.0;
		if ( cycle > stance ) {
			let swing = ( cycle - stance ) / ( 1.0 - stance );
			// Smooth release and touchdown; the central arc clears uneven grass and soil.
			footZ = reach * ( -0.5 + swing * swing * ( 3.0 - 2.0 * swing ) );
			lift = pow( max( sin( swing * 3.141592654 ), 0.0 ), 1.6 ) * mix( 0.068, 0.13, trot ) * gaitWeight;
		}
		let hip = vec3f( side * 0.20, 0.54, select( -0.43, 0.245, front ) );
		let knee = vec3f( side * select( 0.22, 0.218, front ), 0.28, hip.z + select( 0.055, -0.036, front ) );
		let ankle = vec3f( side * 0.22, 0.04, select( -0.418, 0.288, front ) );
		let targetHip = hip + vec3f( 0.0, bodyY, 0.0 );
		let targetAnkle = ankle + vec3f( 0.0, lift, footZ );
		let delta = targetAnkle.yz - targetHip.yz;
		let distance = max( length( delta ), 0.0001 );
		let direction = delta / distance;
		let upperRest = length( knee.yz - hip.yz ); let lowerRest = length( ankle.yz - knee.yz );
		// A little tendon/skin stretch at the furthest reach avoids snapping an IK clamp
		// and keeps the hoof locked. Most of each cycle uses the exact rest bone lengths.
		let stretch = max( 1.0, distance * 1.001 / ( upperRest + lowerRest ) );
		let upper = upperRest * stretch; let lower = lowerRest * stretch;
		let along = ( upper * upper - lower * lower + distance * distance ) / ( 2.0 * distance );
		let bend = sqrt( max( upper * upper - along * along, 0.000001 ) );
		let perpendicular = vec2f( -direction.y, direction.x ) * select( -1.0, 1.0, front );
		let solvedKnee = vec3f( knee.x, targetHip.yz + direction * along + perpendicular * bend );
		let thigh = boarSegment( rest, hip, knee, targetHip, solvedKnee );
		let shin = boarSegment( rest, knee, ankle, solvedKnee, targetAnkle );
		// The cloven hoof is a rigid contact pad: ankle flexion is absorbed above it.
		let hoof = rest + targetAnkle - ankle;
		p = mix( hoof, shin, smoothstep( 0.095, 0.18, rest.y ) );
		p = mix( p, thigh, smoothstep( 0.22, 0.36, rest.y ) );
		return p;
	}
	if ( bone > 4.5 && bone < 5.5 ) {
		let base = vec3f( 0.0, 0.65, -0.64 );
		let flick = pow( max( sin( slow * 0.63 ), 0.0 ), 14.0 );
		let w = 1.0 - smoothstep( -0.84, -0.63, rest.z );
		let yaw = ( sin( slow ) * 0.085 + flick * sin( phase * 3.7 ) * 0.25 ) * w;
		p = base + boarRotateY( boarRotateX( p - base, sin( slow * 0.79 ) * 0.045 * w ), yaw );
	} else {
		if ( bone > 5.5 ) {
			let side = select( -1.0, 1.0, bone < 6.5 );
			let base = vec3f( side * 0.16, 0.70, 0.485 );
			let twitchPhase = slow + side * 1.7;
			let flick = pow( max( sin( twitchPhase ), 0.0 ), 16.0 );
			let angle = sin( slow * 1.3 + side ) * 0.055 + flick * sin( phase * 6.0 + side ) * 0.23;
			p = base + boarRotateY( boarRotateZ( p - base, side * angle ), angle * 0.55 );
		}
		if ( bone < -0.5 ) {
			let rib = smoothstep( 0.30, 0.62, rest.y ) * ( 1.0 - smoothstep( 0.14, 0.44, rest.z ) );
			let breath = sin( slow * 1.2 ) * 0.006 * rib * ( 1.0 - drive * 0.65 );
			p.x *= 1.0 + breath; p.y += breath * 0.32;
		}
		let head = select( smoothstep( 0.23, 0.51, rest.z ), 1.0, bone > 3.5 );
		let neck = vec3f( 0.0, 0.61, 0.35 );
		let sniff = sin( phase * 1.43 + seed * 6.283185307 );
		let pitch = root * ( 0.525 + sniff * 0.019 ) + ( 1.0 - root ) * sin( slow * 1.13 ) * ( 0.012 + drive * 0.018 );
		let yaw = root * sin( slow * 0.83 ) * 0.095 + ( 1.0 - root ) * sin( slow * 0.47 ) * 0.025 * ( 1.0 - drive );
		let nosing = boarRotateY( boarRotateX( p - neck, pitch ), yaw );
		p = mix( p, neck + nosing, head );
	}
	p.y += bodyY;
	return p;
}
`,

} );

