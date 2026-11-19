import { SEA_WATER_DENSITY } from '../../physics/Loads.js';

// Actuated demonstration rig, not a measured biological bite-force model.
export const JAW = Object.freeze( {
 pivot: Object.freeze( { x: 0, y: - 0.063, z: 0.302 } ),
 maxAngle: 0.65, maxSpeed: 2.2, acceleration: 10,
 toothRadius: 0.0025, targetRadius: 0.036, restitution: 0.2, maxImpulse: 0.25,
} );
const clamp = ( n, a, b ) => Math.max( a, Math.min( b, n ) );
const vector = ( x = 0, y = 0, z = 0 ) => ( { x, y, z } );
const sub = ( a, b ) => vector( a.x - b.x, a.y - b.y, a.z - b.z );
const dot = ( a, b ) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = a => Math.hypot( a.x, a.y, a.z );
const lerp = ( a, b, t ) => vector( a.x + ( b.x - a.x ) * t, a.y + ( b.y - a.y ) * t, a.z + ( b.z - a.z ) * t );

// First time of impact against a sphere at the origin. Relative target motion is
// included by subtracting its old/new centre before calling this function.
export function segmentSphereTime( start, end, radius ) {
 const c = dot( start, start ) - radius * radius;
 if ( c <= 0 ) return 0;
 const d = sub( end, start ), a = dot( d, d ), b = 2 * dot( start, d );
 if ( a < 1e-15 ) return null;
 const discriminant = b * b - 4 * a * c;
 if ( discriminant < 0 ) return null;
 const t = ( - b - Math.sqrt( discriminant ) ) / ( 2 * a );
 return t >= 0 && t <= 1 ? t : null;
}

export function jawPoint( p, angle ) {
 const dy = p.y - JAW.pivot.y, dz = p.z - JAW.pivot.z;
 return vector( p.x, JAW.pivot.y + Math.cos( angle ) * dy - Math.sin( angle ) * dz,
  JAW.pivot.z + Math.sin( angle ) * dy + Math.cos( angle ) * dz );
}

// Same YXZ body pose as the renderer: bank, pitch, then heading.
export function sharkPoint( m, p ) {
 const scale = ( m.length || 1.5 ) / 1.5;
 const c = Math.cos( m.bank || 0 ), s = Math.sin( m.bank || 0 );
 const x = ( c * p.x - s * p.y ) * scale, y = ( s * p.x + c * p.y ) * scale, z = p.z * scale;
 const cp = Math.cos( m.pitch || 0 ), sp = Math.sin( m.pitch || 0 );
 const yy = cp * y + sp * z, zz = - sp * y + cp * z;
 return vector( m.x + Math.cos( m.yaw ) * x + Math.sin( m.yaw ) * zz, m.y + yy,
  m.z - Math.sin( m.yaw ) * x + Math.cos( m.yaw ) * zz );
}

// These tooth centres match the front lower row in the authored mesh.
export const BITE_TEETH = Object.freeze( Array.from( { length: 13 }, ( _, i ) => {
 const x = ( i - 6 ) * 0.008;
 return Object.freeze( vector( x, - 0.040 - Math.abs( x ) * 0.06, 0.465 - Math.abs( x ) * 0.65 ) );
} ).concat( [ - 1, 1 ].flatMap( sign => Array.from( { length: 6 }, ( _, i ) => Object.freeze( vector( sign * ( 0.055 + i * 0.006 ), - 0.044 - i * 0.0015, 0.425 - i * 0.009 ) ) ) ) ) );

export class SharkBite {
 constructor() { this.reset(); }
 reset() {
  this.phase = 'idle'; this.active = false; this.result = 'none'; this.angle = 0; this.angularVelocity = 0;
  this.time = 0; this.phaseTime = 0; this.age = 0; this.cycle = 0; this.contactCount = 0; this.lastContact = null;
  const radius = JAW.targetRadius;
  this.target = { id: 'practice-target', visible: false, radius, mass: SEA_WATER_DENSITY * 4 / 3 * Math.PI * radius ** 3,
   position: vector(), previous: vector(), velocity: vector(), compression: 0 };
 }
 start( m, options = {} ) {
  if ( this.active ) return false;
  const p = options.position || sharkPoint( m, vector( 0, - 0.073, 1.30 ) );
  this.target.position = { ...p }; this.target.previous = { ...p }; this.target.velocity = vector();
  this.target.radius = options.radius || JAW.targetRadius;
  this.target.mass = SEA_WATER_DENSITY * 4 / 3 * Math.PI * this.target.radius ** 3;
  this.target.visible = true; this.target.compression = 0;
  this.active = true; this.result = 'pending'; this.phase = 'opening'; this.phaseTime = 0; this.age = 0; this.cycle ++;
  return true;
 }
 cancel() { if ( this.active ) { this.result = 'cancelled'; this.transition( 'recover' ); } }
 transition( phase ) { this.phase = phase; this.phaseTime = 0; }
 state() {
  return { active: this.active, phase: this.phase, result: this.result, angle: this.angle, angularVelocity: this.angularVelocity,
   time: this.time, cycle: this.cycle, contactCount: this.contactCount, targetCount: 1,
   target: { ...this.target, position: { ...this.target.position }, previous: { ...this.target.previous }, velocity: { ...this.target.velocity } },
   lastContact: this.lastContact ? { ...this.lastContact, point: { ...this.lastContact.point }, normal: { ...this.lastContact.normal }, impulse: { ...this.lastContact.impulse }, bodyImpulse: { ...this.lastContact.bodyImpulse } } : null };
 }
 advanceTarget( dt, water = {}, floor = - 30 ) {
  const t = this.target; if ( ! t.visible ) return;
  t.previous = { ...t.position };
  // A weighted rubber practice ball is neutrally buoyant. Exact quadratic drag
  // advects it with the local shared current; no spring secretly guides it to a jaw.
  const flow = vector( water.ux || 0, 0, water.uz || 0 ), relative = sub( t.velocity, flow ), speed = length( relative );
  const k = 0.5 * SEA_WATER_DENSITY * 0.47 * Math.PI * t.radius ** 2 / t.mass;
  const denominator = 1 + k * speed * dt;
  const integral = speed > 1e-8 ? Math.log( denominator ) / ( k * speed ) : dt;
  for ( const key of [ 'x', 'y', 'z' ] ) {
   t.position[ key ] += flow[ key ] * dt + relative[ key ] * integral;
   t.velocity[ key ] = flow[ key ] + relative[ key ] / denominator;
  }
  if ( t.position.y < floor + t.radius ) { t.position.y = floor + t.radius; t.velocity.y = Math.max( 0, t.velocity.y ); }
  t.compression *= Math.exp( - dt * 8 );
 }
 step( dt, m, previousPose = m, bodyMass = 10 ) {
  if ( ! Number.isFinite( dt ) || dt <= 0 ) return null;
  dt = Math.min( dt, 0.05 ); this.time += dt; this.phaseTime += dt; this.age += dt;
  const oldAngle = this.angle;
  if ( this.phase === 'opening' && this.angle > 0.60 ) this.transition( 'open' );
  if ( this.phase === 'open' && length( sub( this.target.position, sharkPoint( m, vector( 0, - 0.073, 0.454 ) ) ) ) < 0.12 ) this.transition( 'closing' );
  if ( this.active && this.result === 'pending' && this.age > 12 ) { this.result = 'miss'; this.transition( 'recover' ); }
  if ( this.phase === 'grip' && this.phaseTime > 0.20 ) this.transition( 'release' );
  if ( this.phase === 'release' && this.phaseTime > 0.45 ) this.transition( 'recover' );
  let goal = [ 'opening', 'open' ].includes( this.phase ) ? JAW.maxAngle : this.phase === 'release' ? 0.45 : 0;
  if ( this.phase === 'grip' ) goal = this.angle;
  const wanted = clamp( ( goal - this.angle ) * 10, - JAW.maxSpeed, JAW.maxSpeed );
  const oldVelocity = this.angularVelocity;
  this.angularVelocity += clamp( wanted - this.angularVelocity, - JAW.acceleration * dt, JAW.acceleration * dt );
  this.angle = clamp( this.angle + ( oldVelocity + this.angularVelocity ) * 0.5 * dt, 0, JAW.maxAngle );
  if ( this.angle === 0 || this.angle === JAW.maxAngle || this.phase === 'grip' ) this.angularVelocity = 0;
  let contact = null;
  if ( this.phase === 'closing' && this.angle < oldAngle ) {
   for ( const tooth of BITE_TEETH ) {
    const a = sharkPoint( previousPose, jawPoint( tooth, oldAngle ) ), b = sharkPoint( m, jawPoint( tooth, this.angle ) );
    const t = this.target, relativeA = sub( a, t.previous ), relativeB = sub( b, t.position );
    const hit = segmentSphereTime( relativeA, relativeB, t.radius + JAW.toothRadius );
    if ( hit === null ) continue;
    const relative = lerp( relativeA, relativeB, hit ), len = length( relative ) || 1;
    const normal = vector( - relative.x / len, - relative.y / len, - relative.z / len );
    const toothVelocity = vector( ( b.x - a.x ) / dt, ( b.y - a.y ) / dt, ( b.z - a.z ) / dt );
    const relativeSpeed = dot( sub( toothVelocity, t.velocity ), normal );
    if ( relativeSpeed <= 0 ) continue;
    const amount = Math.min( JAW.maxImpulse, ( 1 + JAW.restitution ) * relativeSpeed / ( 1 / t.mass + 1 / bodyMass ) );
    const impulse = vector( normal.x * amount, normal.y * amount, normal.z * amount );
    for ( const key of [ 'x', 'y', 'z' ] ) t.velocity[ key ] += impulse[ key ] / t.mass;
    t.compression = Math.min( 0.3, amount * 2 );
    contact = { time: this.time, targetId: t.id, point: lerp( a, b, hit ), normal, impulse,
     bodyImpulse: vector( - impulse.x, - impulse.y, - impulse.z ), relativeSpeed, targetMass: t.mass, bodyMass };
    this.lastContact = contact; this.contactCount ++; this.result = 'hit';
    this.angle = oldAngle + ( this.angle - oldAngle ) * hit; this.angularVelocity = 0;
    this.transition( 'grip' ); break;
   }
   if ( this.angle < 0.015 && ! contact ) { this.result = 'miss'; this.transition( 'recover' ); }
  }
  if ( this.phase === 'recover' && this.angle < 0.005 && Math.abs( this.angularVelocity ) < 0.08 ) {
   this.angle = 0; this.angularVelocity = 0; this.active = false; this.transition( 'idle' );
  }
  if ( this.phase === 'idle' && this.phaseTime > 4 ) this.target.visible = false;
  m.jawAngle = this.angle; m.jawVelocity = this.angularVelocity; m.bitePhase = this.phase;
  return contact;
 }
}
