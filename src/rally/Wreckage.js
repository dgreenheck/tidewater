import { Group, Vector3, Quaternion } from '../engine/index.js';
import { GRAVITY, AIR_DENSITY, quadraticDrag } from '../physics/Loads.js';

// Loose car parts after a crash: a small rigid-body integrator on the island heightfield.
// Panels and lamps tumble, bounce, slide and settle flat on the sand; a lost wheel rolls
// upright, wobbles and falls on its side; anything that lands in the sea bobs and drifts,
// then sinks. Old pieces sink into the ground and go, so the count stays bounded.

const MAX = 36, LIFE = 120, SINK = 2.5;
const _n = new Vector3(), _t = new Vector3(), _axis = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion();
const X = new Vector3( 1, 0, 0 ), Y = new Vector3( 0, 1, 0 ), Z = new Vector3( 0, 0, 1 );

export function makePiece( { position, quaternion = new Quaternion(), velocity = new Vector3(), spin = new Vector3(), rest = 0.05, radius = 0.3, thin = Y, wheel = null, floats = 8, mass = 5, area = null } ) {
	const p = {
		pos: position.clone(), vel: velocity.clone(), q: quaternion.clone(), w: spin.clone(),
		rest, radius, thin: thin.clone(), wheel, floats, mass: Math.max(.05,mass), area: Math.max(0,area ?? Math.PI*radius*radius), age: 0, still: 0, sleep: false, wet: - 1, gone: 0,
	};
	if ( wheel ) {
		wheel.heading = Math.atan2( velocity.x, velocity.z );
		wheel.speed = Math.hypot( velocity.x, velocity.z );
		wheel.roll = 0; wheel.lean = 0; wheel.side = Math.random() < 0.5 ? - 1 : 1;
	}
	return p;
}

function ground( terrain, x, z, normal ) {
	terrain.normalAt( x, z, normal );
	return terrain.heightAt( x, z );
}

// Advance one piece by dt. terrain: { heightAt( x, z ), normalAt( x, z, out ) }.
export function stepPiece( p, dt, terrain, seaLevel = 0, current = null ) {
	p.age += dt;
	if ( p.gone > 0 ) { p.pos.y -= dt * 0.18; p.gone += dt; return; }
	if ( p.sleep ) return;
	const h = ground( terrain, p.pos.x, p.pos.z, _n );
	const water = h < seaLevel - 0.05 && p.pos.y < seaLevel + p.rest;
	if ( water ) {
		if ( p.wet < 0 ) p.wet = p.age;
		const afloat = p.age - p.wet < p.floats;
		// Bob at the surface, drift, then sink slowly to the seabed and stay there.
		if ( afloat ) p.vel.y += ( ( seaLevel - p.rest * 0.4 - p.pos.y ) * 30 - p.vel.y * 6 ) * dt;
		else p.vel.y = Math.max( p.vel.y - GRAVITY * dt * 0.1, - 0.35 );
		const decay=Math.exp(-dt*1.2),ux=current?.ux??0,uz=current?.uz??0;
		p.vel.x=ux+(p.vel.x-ux)*decay;p.vel.z=uz+(p.vel.z-uz)*decay;
		p.w.multiplyScalar( Math.exp( - dt * 2 ) );
		if ( p.wheel ) p.wheel.lean = Math.min( Math.PI / 2, p.wheel.lean + dt );
	} else p.vel.y -= GRAVITY * dt;
	if ( p.wheel ) return stepWheel( p, dt, terrain, h, water, !! current );
	p.pos.addScaledVector( p.vel, dt );
	integrate( p.q, p.w, dt );
	const floor = Math.max( ground( terrain, p.pos.x, p.pos.z, _n ), water ? - Infinity : - Infinity );
	// Contact height: lying flat on its thin axis rests low, on an edge it stands taller.
	_axis.copy( p.thin ).applyQuaternion( p.q );
	const flat = Math.abs( _axis.dot( _n ) );
	const reach = p.rest + ( p.radius - p.rest ) * ( 1 - flat ) * 0.7;
	if ( p.pos.y - reach < floor ) {
		p.pos.y = floor + reach;
		const vn = p.vel.dot( _n );
		if ( vn < 0 ) p.vel.addScaledVector( _n, - vn * 1.3 );
		// Sand friction on the sliding velocity; the tumble dies and the piece tips flat.
		_t.copy( p.vel ).addScaledVector( _n, - p.vel.dot( _n ) );
		p.vel.addScaledVector( _t, - Math.min( 1, dt * 5 ) );
		p.w.multiplyScalar( Math.exp( - dt * 5 ) );
		_q.setFromUnitVectors( _axis, _axis.dot( _n ) < 0 ? _t.copy( _n ).negate() : _n );
		_q2.identity().slerp( _q, Math.min( 1, dt * 3 ) );
		p.q.premultiply( _q2 ).normalize();
		if ( p.vel.lengthSq() < 0.04 && p.w.lengthSq() < 0.09 ) { if ( ( p.still += dt ) > 0.6 ) p.sleep = ! water; } else p.still = 0;
	}
}

function stepWheel( p, dt, terrain, h, water, sharedFluid = false ) {
	const wh = p.wheel;
	const lift = wh.radius * Math.cos( wh.lean ) + wh.width * Math.sin( wh.lean );
	const fx = Math.sin( wh.heading ), fz = Math.cos( wh.heading );
	const onGround = ! water && p.pos.y + p.vel.y * dt - lift <= h + 0.02;
	if ( onGround ) {
		if ( p.vel.y < - 2.5 ) p.vel.y *= - 0.3; else p.vel.y = 0;
		p.pos.y = h + lift;
		// Rolls downhill, sand drags it down, and once slow it wobbles and topples.
		const slope = ( terrain.heightAt( p.pos.x + fx * 0.5, p.pos.z + fz * 0.5 ) - terrain.heightAt( p.pos.x - fx * 0.5, p.pos.z - fz * 0.5 ) );
		let lateral = 0;
		if ( sharedFluid ) {
			// Preserve applied momentum. Rolling and cross-wheel sliding are independent
			// components; the old cosmetic path reconstructed velocity and lost all wind.
			wh.speed = p.vel.x * fx + p.vel.z * fz;
			lateral = p.vel.x * fz - p.vel.z * fx;
			lateral *= Math.max(0,1-.6*GRAVITY*dt/Math.max(1e-9,Math.abs(lateral)));
			wh.speed = (wh.speed-GRAVITY*slope*dt/1.5)*Math.exp(-dt*(wh.lean>.05?1.6:.35));
		} else wh.speed = Math.max( 0, wh.speed - GRAVITY * slope * dt ) * Math.exp( - dt * ( wh.lean > 0.05 ? 1.6 : 0.35 ) );
		wh.heading += Math.sin( p.age * 2.3 ) * dt * 0.15 * ( 1 + wh.lean * 4 ) * wh.side;
		if ( Math.abs(wh.speed) < 3.2 || wh.lean > 0 ) wh.lean = Math.min( Math.PI / 2, wh.lean + dt * ( 0.35 + wh.lean * 3.2 ) );
		p.vel.x = fx * wh.speed + fz * lateral; p.vel.z = fz * wh.speed - fx * lateral;
		if ( wh.lean >= Math.PI / 2 && wh.speed < 0.1 && p.vel.y === 0 ) { if ( ( p.still += dt ) > 0.6 ) p.sleep = true; }
	}
	p.pos.addScaledVector( p.vel, dt );
	if ( ! water && p.pos.y < h + lift ) p.pos.y = h + lift;
	wh.roll += ( onGround ? wh.speed / wh.radius : 3 ) * dt;
	p.q.setFromAxisAngle( Y, wh.heading )
		.multiply( _q.setFromAxisAngle( Z, wh.lean * wh.side ) )
		.multiply( _q2.setFromAxisAngle( X, wh.roll ) );
}

function integrate( q, w, dt ) {
	const angle = w.length() * dt;
	if ( angle < 1e-6 ) return;
	_q.setFromAxisAngle( _axis.copy( w ).normalize(), angle );
	q.premultiply( _q ).normalize();
}

// These cosmetic scraps retain their terrain contacts and bob/sink model. Shared
// air drag is mass/area based; water damping already belongs to stepPiece, so no
// second drag or buoyancy term is introduced here.
function environmentStep(p,dt,terrain,field) {
 const s=field.sample(p.pos.x,p.pos.y,p.pos.z),floor=ground(terrain,p.pos.x,p.pos.z,_n);
 _axis.copy(p.thin).applyQuaternion(p.q);
 const reach=p.wheel?p.wheel.radius*Math.cos(p.wheel.lean)+p.wheel.width*Math.sin(p.wheel.lean):p.rest+(p.radius-p.rest)*(1-Math.abs(_axis.dot(_n)))*.7;
 const wet=floor<s.height-.05&&p.pos.y<s.height+p.rest;
 const supported=!wet&&p.pos.y-reach<=floor+.025&&p.vel.y<=.1;
 const relative={x:s.wx-p.vel.x,y:s.wy-p.vel.y,z:s.wz-p.vel.z},force=quadraticDrag({},relative,{area:p.area,dragCoefficient:1.1});
 const relaxation=1+dt*.5*AIR_DENSITY*1.1*p.area*Math.hypot(relative.x,relative.y,relative.z)/p.mass;
 let ax=force.x/p.mass/relaxation+(supported?s.ax:0),ay=force.y/p.mass/relaxation+(supported?s.ay:0),az=force.z/p.mass/relaxation+(supported?s.az:0);
 // A solid-disc rolling inertia I=.5 m r² increases longitudinal effective
 // mass to1.5m. Lateral impulse remains translation and meets sliding friction.
 if(p.wheel&&supported&&p.wheel.lean<.5){const fx=Math.sin(p.wheel.heading),fz=Math.cos(p.wheel.heading),forward=(ax*fx+az*fz)/3;ax-=forward*fx;az-=forward*fz;}
 // Assumed static friction threshold for already settled cosmetic pieces.
 if(p.sleep&&supported&&Math.hypot(ax,az)<=.4*GRAVITY&&ay<=GRAVITY)return s;
 p.sleep=false;p.vel.x+=ax*dt;p.vel.y+=ay*dt;p.vel.z+=az*dt;return s;
}

const copyState=value=>value?.clone?value.clone():value&&typeof value==='object'?structuredClone(value):value;

export class Wreckage {
	constructor( scene, terrain, seaLevel = () => 0 ) {
		this.scene = scene;
		this.terrain = terrain;
		this.seaLevel = seaLevel;
		this.pieces = [];
	}

	get count() { return this.pieces.filter( p => ! p.gone ).length; }

	// object: an Object3D whose origin is the piece's centre of mass.
	add( object, options ) {
		const piece = makePiece( options );
		piece.object = object;
		object.position.copy( piece.pos ); object.quaternion.copy( piece.q );
		this.scene.add( object );
		this.pieces.push( piece );
		const live = this.pieces.filter( p => ! p.gone );
		if ( live.length > MAX ) live[ 0 ].gone = 1e-3;
		return piece;
	}

	update( dt ) {
		if ( ! this.pieces.length || dt <= 0 ) return;
		const step = Math.min( dt, 0.05 ), sea = this.seaLevel(), field = this.environment?.();
		for ( const p of this.pieces ) {
			if ( ! p.gone && p.age > LIFE ) p.gone = 1e-3;
			const fluid=field&&!p.gone?environmentStep(p,step,this.terrain,field):null;
			stepPiece( p, step, this.terrain, fluid?.height??sea, fluid );
			p.object.position.copy( p.pos );
			p.object.quaternion.copy( p.q );
		}
		for ( let i = this.pieces.length - 1; i >= 0; i -- ) {
			const p = this.pieces[ i ];
			if ( p.gone > SINK || ! Number.isFinite( p.pos.y ) ) { this.scene.remove( p.object ); this.pieces.splice( i, 1 ); }
		}
	}


 captureDisasterState() {
  return this.pieces.map(piece=>({piece,visible:piece.object.visible,state:Object.fromEntries(Object.entries(piece).filter(([key])=>key!=='object').map(([key,value])=>[key,copyState(value)]))}));
 }

 restoreDisasterState(saved) {
  this.clear();for(const {piece,state,visible}of saved??[]){for(const [key,value]of Object.entries(state))piece[key]=copyState(value);piece.object.visible=visible;piece.object.position.copy(piece.pos);piece.object.quaternion.copy(piece.q);this.scene.add(piece.object);this.pieces.push(piece);}
 }

	clear() {
		for ( const p of this.pieces ) this.scene.remove( p.object );
		this.pieces.length = 0;
	}
}

export { Group };
