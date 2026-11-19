import * as THREE from '../engine/index.js';

// Over-the-shoulder boom for the on-foot modes (walk, swim, the fishing boat's deck, the ferry).
// Each mode first places the camera at the eyes as in first person (so the look, the ship-frame
// stabilisation and W along the view heading are all theirs); this then swings it back along
// the view from a point SHOULDER to the right of the head, and pulls it in against whatever is
// behind: the island's colliders, the terrain and, aboard the ferry, her boxes
// (FerryDeck.boomHit), plus the vertical cylinders (piles, posts, lamps, rocks) and the camera-only
// capsules (Colliders.boom: pier braces and stringers). Rotation is the view's own, with no lag;
// only the pivot height is eased (stairs, jumps, the swim bob). The boom snaps in at once against
// walls and the ground, pulls in quickly (not in one frame) past thin posts and braces while they are
// well clear of the lens (at once when one would sit within BOOM.lens of it), and eases back out.
//
//   boom.apply( player, dt, wheel );   // after the mode set the first-person camera
//   boom.reset();                      // first person / not on foot

// lens: a brace or post nearer the lens than this (m) fills the frame with its hard edge, so the boom comes in at once
export const BOOM = { min: 1.5, max: 8, start: 3.5, shoulder: 0.4, lift: 0.12, pad: 0.25, near: 0.25, lens: 0.9 };
// the swim camera's clearance from the water surface (m): over it at the surface, under it diving
export const WATERLINE = { above: 0.55, below: 0.45 };

const _p = new THREE.Vector3(), _sh = new THREE.Vector3(), _off = new THREE.Vector3(), _dir = new THREE.Vector3(), _s = new THREE.Vector3(), _eye = new THREE.Vector3();

// ray against vertical cylinders (side and top) and capsules; nearest hit before `best`
export function thinHit( C, o, d, best ) {

	for ( const c of C.cylinders || [] ) {

		const ox = o.x - c.x, oz = o.z - c.z, r = c.radius + 0.06;
		const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, q = ox * ox + oz * oz - r * r;
		if ( q <= 0 ) continue; // the pivot is inside it (in plan): nothing to pull in against
		if ( a > 1e-8 ) {

			const h = b * b - a * q;
			if ( h >= 0 ) {

				const t = ( - b - Math.sqrt( h ) ) / a;
				if ( t > 0 && t < best ) {

					const y = o.y + d.y * t;
					if ( y >= c.yMin && y <= c.yMax ) best = t;

				}

			}

		}

		if ( d.y < - 1e-6 && o.y > c.yMax ) {

			const t = ( c.yMax - o.y ) / d.y;
			if ( t < best ) {

				const x = ox + d.x * t, z = oz + d.z * t;
				if ( x * x + z * z <= r * r ) best = t;

			}

		}

	}

	for ( const c of C.boom || [] ) {

		// cheap reject: the ray's box to best against the capsule's box
		const ex = o.x + d.x * best, ey = o.y + d.y * best, ez = o.z + d.z * best;
		if ( Math.max( o.x, ex ) < c.lo.x || Math.min( o.x, ex ) > c.hi.x || Math.max( o.y, ey ) < c.lo.y || Math.min( o.y, ey ) > c.hi.y || Math.max( o.z, ez ) < c.lo.z || Math.min( o.z, ez ) > c.hi.z ) continue;
		const t = capsule( o, d, c.a, c.b, c.radius );
		if ( t > 0 && t < best ) best = t;

	}

	return best;

}

// ray (unit d) against the capsule a -> b, radius r: entry distance or -1
function capsule( o, d, pa, pb, r ) {

	const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
	const oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
	const baba = bax * bax + bay * bay + baz * baz, bard = bax * d.x + bay * d.y + baz * d.z;
	const baoa = bax * oax + bay * oay + baz * oaz, rdoa = d.x * oax + d.y * oay + d.z * oaz;
	const oaoa = oax * oax + oay * oay + oaz * oaz;
	const a = baba - bard * bard;
	let b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
	let h = b * b - a * c;
	if ( h < 0 || a < 1e-9 ) return - 1;
	const t = ( - b - Math.sqrt( h ) ) / a, y = baoa + t * bard;
	if ( y > 0 && y < baba ) return t;
	// the end caps
	const cx = y <= 0 ? oax : o.x - pb.x, cy = y <= 0 ? oay : o.y - pb.y, cz = y <= 0 ? oaz : o.z - pb.z;
	b = d.x * cx + d.y * cy + d.z * cz;
	c = cx * cx + cy * cy + cz * cz - r * r;
	h = b * b - c;
	return h > 0 ? - b - Math.sqrt( h ) : - 1;

}

export class ThirdPersonCamera {

	constructor() {

		this.want = BOOM.start;  // zoom (scroll wheel), BOOM.min .. BOOM.max
		this.dist = BOOM.start;  // current boom length after collisions
		this.y = null;           // eased pivot height

	}

	reset() {

		this.y = null;
		this.swimOrbit = null;
		this.swimPose = null;
		this.swimPending = false;

	}

	needsSwimFrame( player ) {

		return player.mode === 'swim' && [ ...player.cameraObstacles || [] ].some( o => o.cameraNear?.( player.position, 7 ) );

	}

	apply( player, dt, wheel = 0, { deferSwim = false, currentPose = false } = {} ) {

		const cam = player.camera;
		this.swimPending = false;
		if ( wheel ) this.want = THREE.MathUtils.clamp( this.want * ( 1 + wheel * 0.12 ), BOOM.min, BOOM.max );
		// A floating foil can leave a mathematically clear 25 cm boom while the
		// animated swimmer is below the frame. Choose a comfortable, subject-facing
		// view around a nearby finite obstacle instead of shortening through it.
		if ( this.needsSwimFrame( player ) ) {

			// Player completes this one search after the displayed pose and its
			// contact correction exist. Keep the input eye/heading unchanged here.
			if ( deferSwim ) { this.swimPending = true; return; }
			if ( this.frameSwimmer( player, dt, currentPose ) ) return;

		}
		this.swimOrbit = null;
		this.swimPose = null;
		const pivot = _p.copy( cam.position );
		_eye.copy( pivot );
		if ( this.y === null ) {

			this.y = pivot.y;
			this.dist = this.want;

		}

		this.y += ( pivot.y - this.y ) * ( 1 - Math.exp( - 14 * dt ) );
		this.y = THREE.MathUtils.clamp( this.y, pivot.y - 0.45, pivot.y + 0.45 );
		pivot.y = this.y;

		// the shoulder point first (less of it if a wall is right there), then the boom straight back
		// from it: pulled in tight, the camera still looks past the head, not into the back of it
		_off.set( BOOM.shoulder, BOOM.lift, 0 ).applyQuaternion( cam.quaternion );
		const sl = _off.length();
		_dir.copy( _off ).divideScalar( sl );
		const side = Math.max( 0, Math.min( sl, this.cast( player, pivot, _dir, sl + BOOM.pad ) - BOOM.pad ) );
		const shoulder = _sh.copy( pivot ).addScaledVector( _dir, side );
		_dir.set( 0, 0, 1 ).applyQuaternion( cam.quaternion );
		const hit = this.cast( player, shoulder, _dir, this.want + BOOM.pad );
		const room = Math.max( BOOM.near, Math.min( this.want, hit - BOOM.pad ) );
		if ( room >= this.dist ) this.dist += ( room - this.dist ) * ( 1 - Math.exp( - 2.5 * dt ) );
		else if ( ! this.thin ) this.dist = room;
		else {

			const e = Math.max( room, Math.min( this.hard - BOOM.pad, this.dist + ( room - this.dist ) * ( 1 - Math.exp( - 16 * dt ) ) ) );
			this.dist = e - ( room + BOOM.pad ) < BOOM.lens ? room : e;

		}
		this.dist = Math.max( BOOM.near, this.dist );
		cam.position.copy( shoulder ).addScaledVector( _dir, this.dist );
		// swimming: the lens never straddles the surface (a pale band of water across the view). At the
		// surface it stays WATERLINE.above over the water at his point (the waves between him and the
		// lens take up the rest); diving, once his eyes are well under, it stays WATERLINE.below it.
		if ( player.mode === 'swim' ) {

			const w = player.waterH, under = ! player.floating && pivot.y < w - WATERLINE.below, y0 = cam.position.y;
			cam.position.y = under ? Math.min( cam.position.y, w - WATERLINE.below ) : Math.max( cam.position.y, w + WATERLINE.above );
			// moved off the line the boom was cast along: never up into a brace or post it missed
			if ( Math.abs( cam.position.y - y0 ) > 0.01 ) {

				_off.copy( cam.position ).sub( shoulder );
				const l = _off.length();
				if ( l > 1e-3 ) {

					_off.divideScalar( l );
					const h = this.cast( player, shoulder, _off, l + BOOM.pad );
					if ( h - BOOM.pad < l ) cam.position.copy( shoulder ).addScaledVector( _off, Math.max( BOOM.near, h - BOOM.pad ) );

				}

			}

		}
		// a non-finite boom (the eased pivot height or the length: both ease from their last value, so a NaN
		// would stay for good) never reaches the renderer: this frame from the eyes, the boom set up again
		if ( ! Number.isFinite( cam.position.x + cam.position.y + cam.position.z ) ) {

			if ( ! this.warned ) { this.warned = true; console.warn( 'Third-person camera: non-finite boom, set up again', { y: this.y, dist: this.dist } ); }
			cam.position.copy( _eye );
			this.y = null; this.dist = this.want;
			return;

		}
		// people between the lens and him fade (src/people/Fade.js); the boom stays where it is
		player.people?.occlude?.( cam.position, pivot );

	}

	frameSwimmer( player, dt, currentPose = false ) {

		const cam = player.camera, avatar = player.avatar, model = avatar?.model;
		const delta = currentPose ? new THREE.Vector3() : this.swimPose ? player.position.clone().sub( this.swimPose ) : player.velocity?.clone().multiplyScalar( dt ) || new THREE.Vector3();
		if ( delta.length() > 1 ) delta.set( 0, 0, 0 );
		this.swimPose = player.position.clone();
		const landmarks = [];let headAnchor = null;
		// Player supplies the current displayed pose after animation/contact.
		// Standalone pre-pose callers translate their preceding pose by movement;
		// never translate a current pose twice or use a collapsed/stale head.
		if ( model && avatar.visible && ! avatar.headHidden && avatar.view !== 'first' ) {

			model.group.updateMatrixWorld();
			for ( let i = 0; i < model.gltf.nodes.length; i ++ ) {

				if ( ! /(?:Head|Neck|Spine2)$/.test( model.gltf.nodes[ i ].name ) ) continue;
				const point = new THREE.Vector3().fromArray( model.world, i * 16 + 12 ).applyMatrix4( model.group.matrixWorld ).add( delta );
				if ( point.distanceTo( player.position ) < 2.5 ) { landmarks.push( point );if ( /Head$/.test( model.gltf.nodes[ i ].name ) ) headAnchor = point; }

			}

		}
		const posed = landmarks.length >= 2;
		const surface = posed ? this.swimmerSurface( model, delta ) : [];
		if ( ! posed ) landmarks.splice( 0, landmarks.length, player.position.clone().add( new THREE.Vector3( 0, 0.16, 0 ) ), player.position.clone().add( new THREE.Vector3( 0, - 0.12, 0 ) ) );
		headAnchor ||= landmarks[ 0 ];
		const target = new THREE.Vector3();
		for ( const p of landmarks ) target.add( p );
		target.divideScalar( landmarks.length );
		const probes = landmarks.map( p => p.clone() );
		// Only use an upright head envelope while the real pose is unavailable.
		// A swimming head pitches forward; imaginary upright probes can lie on the
		// other side of a foil even when the actual animated skull is wholly clear.
		if ( ! surface.length ) {

			const head = landmarks.reduce( ( a, b ) => a.y > b.y ? a : b );
			probes.push( head.clone().add( new THREE.Vector3( 0, 0.13, 0 ) ) );
			for ( const sign of [ - 1, 1 ] ) probes.push( head.clone().add( new THREE.Vector3( Math.cos( player.yaw ) * sign * 0.1, 0, - Math.sin( player.yaw ) * sign * 0.1 ) ) );

		}
		const under = ! player.floating && target.y < player.waterH - WATERLINE.below;
		// The first visible pose after V can differ from the collapsed head. Treat
		// that view toggle as initial placement, rather than orbiting from a guess.
		const previous = this.swimOrbit && ( ! posed || this.swimOrbit.posed ) ? this.swimOrbit : null, h = Math.max( 0, Math.min( 0.05, dt ) );
		const desiredRadius = THREE.MathUtils.clamp( this.want + 0.5, 4, 6 );
		const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
		const preferred = previous?.angle ?? player.yaw - Math.PI / 12;
		const position = ( angle, radius, height ) => new THREE.Vector3( headAnchor.x + Math.sin( angle ) * radius, under ? Math.min( target.y + height, player.waterH - WATERLINE.below ) : player.waterH + height, headAnchor.z + Math.cos( angle ) * radius );
		const clear = eye => {

			if ( player.terrain && eye.y < player.terrain.heightAt( eye.x, eye.z ) + 0.3 ) return false;
			if ( ! under && eye.y < player.waterH + WATERLINE.above ) return false;
			for ( const point of probes ) {

				const direction = eye.clone().sub( point ), length = direction.length();
				if ( length < 2.5 || this.cast( player, point, direction.divideScalar( length ), length ) < length - 0.035 ) return false;

			}
			// The posed head joint is near the skull base. A foil may hide the face
			// while every joint ray is clear, so check actual skinned head vertices.
			let hidden = 0;
			for ( const point of surface ) {

				const direction = eye.clone().sub( point ), length = direction.length();
				if ( this.cast( player, point, direction.divideScalar( length ), length ) < length - 0.035 && ++ hidden > surface.length * 0.25 ) return false;

			}
			return true;

		};
		const pathClear = ( from, to ) => {

			const d = to.clone().sub( from ), length = d.length();
			return length < 0.001 || this.cast( player, from, d.divideScalar( length ), length + 0.12 ) >= length + 0.1;

		};
		const offsets = [ 0 ];
		for ( let i = 1; i <= 12; i ++ ) offsets.push( i * Math.PI / 12, - i * Math.PI / 12 );
		offsets.unshift( wrap( preferred - player.yaw ) );
		const candidates = [];
		for ( const radius of [ desiredRadius, 4.5, 6 ] ) for ( const height of under ? [ 0.2, - 0.3 ] : [ 0.85, 0.55, 1.3, 2 ] ) for ( const offset of offsets ) {

			const angle = player.yaw + offset;
			candidates.push( { angle, radius, height, score: Math.abs( offset ) * 0.25 + Math.abs( radius - desiredRadius ) * 0.3 + Math.abs( height - 0.85 ) * 0.2 + Math.abs( wrap( angle - preferred ) ) * 2 } );

		}
		candidates.sort( ( a, b ) => a.score - b.score );
		let selected = null;const clearGoals = [];
		for ( const candidate of candidates ) {

			const eye = position( candidate.angle, candidate.radius, candidate.height );
			if ( ! clear( eye ) ) continue;
			clearGoals.push( { ...candidate, eye } );
			if ( previous ) {

				// Follow a connected clear orbit. The input heading remains Player.yaw;
				// neither lookAt nor the chosen side feeds back into movement controls.
				const angle = previous.angle + THREE.MathUtils.clamp( wrap( candidate.angle - previous.angle ), - h * 2.5, h * 2.5 );
				const radius = previous.radius + THREE.MathUtils.clamp( candidate.radius - previous.radius, - h * 4, h * 4 );
				const height = previous.height + THREE.MathUtils.clamp( candidate.height - previous.height, - h * 3, h * 3 );
				const eased = position( angle, radius, height );
				if ( ! clear( eased ) || ! pathClear( previous.eye, eased ) ) continue;
				selected = { angle, radius, height, eye: eased };break;

			}
			selected = { ...candidate, eye };break;

		}
		if ( ! selected && previous && clear( previous.eye ) ) selected = previous;
		if ( ! selected && previous ) {

			// An animated head can briefly cross the foil's edge between two poses.
			// Keep a connected, subject-facing lens while moving toward a clear view;
			// never discard the orbit and snap to the old 25 cm forward boom. This
			// continuation may briefly lose part of the head behind the edge, but
			// the camera itself cannot pass through the sail or a world obstacle.
			for ( const goal of clearGoals ) {

				const movement = goal.eye.clone().sub( previous.eye ), distance = movement.length();
				const eye = previous.eye.clone().addScaledVector( movement, Math.min( 1, h * 6 / Math.max( distance, 1e-6 ) ) );
				if ( ! under ) eye.y = Math.max( eye.y, player.waterH + WATERLINE.above );
				if ( eye.distanceTo( headAnchor ) < 2.5 || player.terrain && eye.y < player.terrain.heightAt( eye.x, eye.z ) + 0.3 || ! pathClear( previous.eye, eye ) ) continue;
				selected = { angle: Math.atan2( eye.x - headAnchor.x, eye.z - headAnchor.z ), radius: Math.hypot( eye.x - headAnchor.x, eye.z - headAnchor.z ), height: under ? eye.y - target.y : eye.y - player.waterH, eye, continuing: true };break;

			}
			if ( ! selected ) selected = { ...previous, continuing: true };

		}
		if ( ! selected ) return false;
		selected.posed = posed;
		this.swimOrbit = selected;
		cam.position.copy( selected.eye );
		cam.lookAt( target );
		this.y = player.position.y + 0.162;
		this.dist = selected.eye.distanceTo( target );
		player.people?.occlude?.( cam.position, target );
		return true;

	}

	swimmerSurface( model, delta ) {

		if ( ! model.jointData || ! model.skin || ! model.gltf.meshes ) return [];
		if ( this.swimSkin?.model !== model ) {

			const node = model.gltf.nodes.findIndex( n => /Head$/.test( n.name ) ), joint = model.skin.joints.indexOf( node );
			const meshNode = model.gltf.nodes.find( n => n.mesh !== undefined && n.skin !== undefined ), vertices = [];
			for ( const primitive of model.gltf.meshes[ meshNode?.mesh ] || [] ) {

				const A = primitive.attributes, p = A.POSITION.array, j = A.JOINTS_0?.array, w = A.WEIGHTS_0?.array;
				if ( ! j || ! w ) continue;
				for ( let i = 0; i < p.length / 3; i ++ ) {

					let sum = 0, influence = 0;
					for ( let k = 0; k < 4; k ++ ) { sum += w[ i * 4 + k ];if ( j[ i * 4 + k ] === joint ) influence += w[ i * 4 + k ]; }
					if ( influence / sum > 0.45 ) vertices.push( { position: Array.from( p.slice( i * 3, i * 3 + 3 ) ), joints: Array.from( j.slice( i * 4, i * 4 + 4 ) ), weights: Array.from( w.slice( i * 4, i * 4 + 4 ), value => value / sum ) } );

				}

			}
			this.swimSkin = { model, vertices: Array.from( { length: Math.min( 24, vertices.length ) }, ( _, i ) => vertices[ Math.floor( i * vertices.length / Math.min( 24, vertices.length ) ) ] ) };

		}
		return this.swimSkin.vertices.map( vertex => {

			const p = new THREE.Vector3(), [ x, y, z ] = vertex.position, D = model.jointData;
			for ( let k = 0; k < 4; k ++ ) {

				const o = vertex.joints[ k ] * 16, w = vertex.weights[ k ];
				p.x += ( D[ o ] * x + D[ o + 4 ] * y + D[ o + 8 ] * z + D[ o + 12 ] ) * w;
				p.y += ( D[ o + 1 ] * x + D[ o + 5 ] * y + D[ o + 9 ] * z + D[ o + 13 ] ) * w;
				p.z += ( D[ o + 2 ] * x + D[ o + 6 ] * y + D[ o + 10 ] * z + D[ o + 14 ] ) * w;

			}
			return p.applyMatrix4( model.group.matrixWorld ).add( delta );

		} );

	}

	// distance along dir from o to the first thing in the way (or len); this.thin: a post or brace is
	// nearer than any wall (this.hard)
	cast( player, o, dir, len ) {

		let best = len;
		const C = player.colliders;
		if ( C && C.raycast ) best = Math.min( best, C.raycast( o, dir, best ) );
		if ( player.mode === 'ferry' && player.vessel && player.vessel.boomHit ) best = Math.min( best, player.vessel.boomHit( o, dir, best ) );
		// Dynamic walking supports (including a tilted carrier) own live collision
		// frames that are not present in the static island collider collection.
		for ( const provider of player.groundProviders || [] ) {

			if ( provider.raycast ) best = Math.min( best, provider.raycast( o, dir, best ) );

		}
		for ( const obstacle of player.cameraObstacles || [] ) {

			best = Math.min( best, obstacle.cameraRaycast ? obstacle.cameraRaycast( o, dir, best ) : obstacle.raycast( o, dir, best ) );

		}
		// the terrain: march the boom, then bisect the first crossing (20 cm clearance)
		const T = player.terrain;
		if ( T ) {

			const N = 10;
			let prev = 0;
			for ( let i = 1; i <= N; i ++ ) {

				const t = best * i / N;
				_s.copy( o ).addScaledVector( dir, t );
				if ( _s.y < T.heightAt( _s.x, _s.z ) + 0.2 ) {

					let lo = prev, hi = t;
					for ( let k = 0; k < 5; k ++ ) {

						const mid = ( lo + hi ) / 2;
						_s.copy( o ).addScaledVector( dir, mid );
						if ( _s.y < T.heightAt( _s.x, _s.z ) + 0.2 ) hi = mid;
						else lo = mid;

					}

					best = lo;
					break;

				}

				prev = t;

			}

		}

		this.hard = best;
		const thin = C ? thinHit( C, o, dir, best ) : best;
		this.thin = thin < best;
		return thin;

	}

}
