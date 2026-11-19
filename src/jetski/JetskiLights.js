import { Vector3, Quaternion, Color, Mesh, SphereGeometry, CylinderGeometry } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { G } from '../engine/render/Frame.js';

// The ridden ski's lamps, from dusk (the island lamps' ramp, G.night, as the cars' CarLights): a headlamp spot
// under the bow that lights the ski and the rider (one of the eight nearest local-light slots) and the water ahead
// (the sea shades itself: its light pool comes from the same spot through the water material's head* uniforms),
// navigation lights (red port, green starboard) as lenses with a white-hot core halo and a wider coloured glare
// that both keep a least size in pixels at any range, so a ski reads as red, green and white from 200 m and more,
// a white stern light on a short mast above the rocket pod (clear of the pod and the rider from astern), and the
// instrument pod (the dash TFT and LCD bars) glowing brighter. The navigation lights take no light slot: they are
// seen, they light nothing. Positions come from the hull's own vertices (the ski's frame: +x port, +y up, +z
// forward), so they follow the model.
export const SKI_LAMPS = {
	head: 360, headRange: 55, headInner: 10, headOuter: 26, headAim: - 0.08, // spot (degrees; aim in rad, nose down)
	headLens: 18, // emissive on the headlamp lens
	nav: 40, // lens emissive
	halo: 7, haloR: 0.045, haloPx: 4, // core halo: emissive, radius (m), least size (px)
	glare: 1.8, glareR: 0.11, glarePx: 15, glareNear: 12, glareFar: 50, // coloured glare round it: emissive, radius (m), least size (px), faded in over m of range
	mast: 0.34, mastClear: 0.14, // stern light mast: least height above the transom deck (m), clearance over the pod's top (m)
	pod: 3, // the pod's emissive is multiplied by 1 + pod at full night
	pool: 0.75, // the water's light pool: fraction of the headlamp's intensity
};
const RED = new Color( 1.0, 0.04, 0.02 ), GREEN = new Color( 0.03, 1.0, 0.28 ), WHITE = new Color( 1.0, 0.95, 0.85 );
const POD = /display_tft|gauge_lcd/i, SKIP = /rocket|flame|pod_|bell|fin/i, PODPART = /rocket|pod_|bell|fin/i;
const smooth = ( x, a, b ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };
const _v = new Vector3(), _c = new Vector3(), _q = new Quaternion();
// each lamp shows over its own arc of the camera's bearing in the ski's frame (rad, 0 dead ahead, + to port), with a
// few degrees of soft edge: the sidelights from dead ahead to 22.5 deg abaft the beam on their own side (112.5 deg),
// the stern light 67.5 deg either side of dead astern, the headlamp lens over the forward half
const ARC = 1.963, STERN_ARC = 1.178, EDGE = 0.05;
// the lamps in their lighting order (the order of this.lamps), and the share of each one's arc the camera sits in
const LAMP_NAMES = [ 'port', 'star', 'stern', 'head' ];
const inArc = ( a, lo, hi ) => smooth( a, lo - EDGE, lo + EDGE ) * ( 1 - smooth( a, hi - EDGE, hi + EDGE ) );
// red reads darker than green at the same value (its luminance weight is 0.21 against 0.72): the port lamp's halo and glare x RED_LIFT
const RED_LIFT = 2.2;

const glow = ( c, k, halo ) => new Material( { name: halo ? 'skiLampHalo' : 'skiLamp', color: new Color( 0, 0, 0 ), emissive: new Color( c.r * k, c.g * k, c.b * k ), lit: false,
	...( halo ? { transparent: true, blending: 'additive', depthWrite: false, velocityWeight: 0 } : {} ) } );

export class JetskiLights {

	// lights: the app's local lights; water: the sea's WaterMaterial (its head* uniforms), optional
	constructor( lights, water = null ) {

		this.lights = lights;
		this.water = water && water.uniforms && water.uniforms.headPos ? water : null;
		this._hp = [ 0, 0, 0, 0 ]; this._hd = [ 0, 0, 1, 1 ]; this._poolOn = true;
		this.ski = null;
		this.glow = 0;
		const cone = ( deg ) => Math.cos( deg * Math.PI / 180 );
		this.head = lights ? lights.add( { position: new Vector3(), dir: new Vector3(), color: new Color( 1.0, 0.92, 0.8 ), intensity: SKI_LAMPS.head, range: SKI_LAMPS.headRange,
			cosInner: cone( SKI_LAMPS.headInner ), cosOuter: cone( SKI_LAMPS.headOuter ), kind: 'skiHead', enabled: false } ) : null;
		const lens = new SphereGeometry( 0.022, 12, 8 ), halo = new SphereGeometry( SKI_LAMPS.haloR, 12, 8 ), glare = new SphereGeometry( SKI_LAMPS.glareR, 12, 8 );
		const lamp = ( c, k ) => ( { lens: new Mesh( lens, glow( c, k, false ) ), halo: new Mesh( halo, glow( c, SKI_LAMPS.halo, true ) ), glare: new Mesh( glare, glow( c, SKI_LAMPS.glare, true ) ), at: new Vector3() } );
		this.lamps = { port: lamp( RED, SKI_LAMPS.nav ), star: lamp( GREEN, SKI_LAMPS.nav ), stern: lamp( WHITE, SKI_LAMPS.nav ), head: lamp( WHITE, SKI_LAMPS.headLens ) };
		// the stern light's mast: a black anodised pole in a deck socket, the lens in a white housing on top
		const pole = new Material( { name: 'skiMast', color: new Color( 0.03, 0.03, 0.035 ), roughness: 0.35, metalness: 0.8 } );
		const cap = new Material( { name: 'skiMastCap', color: new Color( 0.8, 0.8, 0.78 ), roughness: 0.4 } );
		this.mast = { pole: new Mesh( new CylinderGeometry( 0.009, 0.011, 1, 10 ), pole ), socket: new Mesh( new CylinderGeometry( 0.022, 0.026, 0.03, 12 ), pole ),
			cap: new Mesh( new CylinderGeometry( 0.02, 0.02, 0.012, 12 ), cap ), base: new Vector3(), h: SKI_LAMPS.mast };
		this.headAt = new Vector3();
		this.pods = [];
		this._arcs = { port: 0, star: 0, stern: 0, head: 0 };

	}

	parts() {

		const out = [ this.mast.pole, this.mast.socket, this.mast.cap ];
		for ( const l of Object.values( this.lamps ) ) out.push( l.lens, l.halo, l.glare );
		return out;

	}

	// the live ski changed: move the lenses onto it, take its own copies of the pod materials
	attach( ski ) {

		for ( const p of this.pods ) p.mesh.material = p.shared;
		this.pods = [];
		for ( const o of this.parts() ) o.removeFromParent?.();
		this.ski = ski;
		if ( ! ski ) return;
		const g = ski.group;
		g.updateMatrixWorld( true );
		const inv = g.matrixWorld.clone().invert(), pts = [];
		let podTop = - Infinity;
		g.traverse( ( o ) => {

			if ( ! o.isMesh || ! o.material ) return;
			const nm = ( o.name || '' ) + ' ' + ( o.material.name || '' );
			const pos = o.geometry?.attributes?.position;
			if ( SKIP.test( nm ) ) {

				// the rocket pod's top (the stern light's mast clears it)
				if ( pos && PODPART.test( nm ) && ! /flame/i.test( nm ) ) for ( let i = 0; i < pos.count; i += 3 ) podTop = Math.max( podTop, _v.set( pos.getX( i ), pos.getY( i ), pos.getZ( i ) ).applyMatrix4( o.matrixWorld ).applyMatrix4( inv ).y );
				return;

			}

			if ( POD.test( o.material.name || '' ) ) {

				const copy = o.material.clone();
				copy.name = o.material.name;
				this.pods.push( { mesh: o, shared: o.material, copy, base: o.material.emissive.clone() } );
				o.material = copy;

			}

			if ( ! pos ) return;
			for ( let i = 0; i < pos.count; i += 3 ) pts.push( _v.set( pos.getX( i ), pos.getY( i ), pos.getZ( i ) ).applyMatrix4( o.matrixWorld ).applyMatrix4( inv ).clone() );

		} );
		if ( ! pts.length ) return;
		let z0 = Infinity, z1 = - Infinity;
		for ( const p of pts ) { z0 = Math.min( z0, p.z ); z1 = Math.max( z1, p.z ); }
		// sidelights on the gunwale 0.55 m aft of the bow tip, the headlamp low in the bow's nose, under the deck line
		const band = ( z, dz ) => pts.filter( ( p ) => Math.abs( p.z - z ) < dz );
		const side = band( z1 - 0.55, 0.06 );
		let w = side[ 0 ] || _v.set( 0.35, 0.3, z1 - 0.55 );
		for ( const p of side ) if ( Math.abs( p.x ) > Math.abs( w.x ) ) w = p;
		this.lamps.port.at.set( Math.abs( w.x ) - 0.015, w.y + 0.012, z1 - 0.55 );
		this.lamps.star.at.set( - Math.abs( w.x ) + 0.015, w.y + 0.012, z1 - 0.55 );
		// the stern light: a mast in a socket on the transom deck's centreline, tall enough to clear the pod's top
		let top = - Infinity;
		for ( const p of band( z0 + 0.12, 0.1 ) ) if ( Math.abs( p.x ) < 0.15 ) top = Math.max( top, p.y );
		const deck = isFinite( top ) ? top : 0.4, M = this.mast;
		M.h = Math.max( SKI_LAMPS.mast, ( isFinite( podTop ) ? podTop : deck ) + SKI_LAMPS.mastClear - deck );
		M.base.set( 0, deck, z0 + 0.1 );
		M.socket.position.copy( M.base ).y += 0.012;
		M.pole.position.copy( M.base ).y += M.h / 2;
		M.pole.scale.set( 1, M.h, 1 );
		M.cap.position.copy( M.base ).y += M.h + 0.032;
		this.lamps.stern.at.copy( M.base ).y += M.h + 0.014;
		let nose = - Infinity;
		for ( const p of band( z1 - 0.3, 0.05 ) ) if ( Math.abs( p.x ) < 0.08 ) nose = Math.max( nose, p.y );
		this.lamps.head.at.set( 0, ( isFinite( nose ) ? nose : 0.25 ) - 0.06, z1 - 0.28 );
		this.headAt.copy( this.lamps.head.at ).z += 0.05;
		for ( const l of Object.values( this.lamps ) ) { l.lens.position.copy( l.at ); l.halo.position.copy( l.at ); l.glare.position.copy( l.at ); }
		for ( const o of this.parts() ) { o.visible = false; g.add( o ); }

	}

	// lit: the ski is ridden (the lamps are on); camera: for the halos' least size
	update( ski, lit, camera ) {

		if ( ski !== this.ski ) this.attach( ski );
		if ( ! ski ) { this.pool( false ); return; }
		const on = this.glow = lit ? smooth( G.night.value, 0.15, 0.75 ) : 0;
		const g = ski.group, show = on > 0.01 && g.visible !== false;
		for ( const p of this.pods ) p.copy.emissive.copy( p.base ).multiplyScalar( 1 + SKI_LAMPS.pod * on );
		this.mast.pole.visible = this.mast.socket.visible = this.mast.cap.visible = show;
		const px = camera ? 2 * Math.tan( ( camera.fov || 60 ) * Math.PI / 360 ) / Math.max( 1, innerHeight ) : 0;
		let brg = 0;
		if ( camera ) { _c.copy( camera.position ).sub( g.position ).applyQuaternion( _q.copy( g.quaternion ).invert() ); brg = Math.atan2( _c.x, _c.z ); }
		// the arcs object and the lamp loop are reused: Object.entries, an arcs literal and an inArc closure a frame left
		// 1.7-2.6 KB of heap (test/frame-garbage.mjs)
		const arcs = this._arcs;
		// the ski's world matrix once a frame, not once per lamp (localToWorld refreshed it four times)
		if ( camera ) g.updateWorldMatrix( true, false );
		arcs.port = inArc( brg, 0, ARC );
		arcs.star = inArc( - brg, 0, ARC );
		arcs.stern = inArc( Math.PI - Math.abs( brg ), - 1, STERN_ARC );
		arcs.head = inArc( Math.abs( brg ), - 1, Math.PI / 2 );
		for ( const name of LAMP_NAMES ) {

			const l = this.lamps[ name ], a = on * arcs[ name ], lift = name === 'port' ? RED_LIFT : 1;
			l.lens.visible = l.halo.visible = show && a > 0.01;
			l.glare.visible = show && a > 0.01 && name !== 'head';
			if ( ! l.lens.visible ) continue;
			const c = name === 'port' ? RED : name === 'star' ? GREEN : WHITE;
			l.lens.material.emissive.copy( c ).multiplyScalar( ( name === 'head' ? SKI_LAMPS.headLens : SKI_LAMPS.nav ) * a );
			// the core halo and the coloured glare never shrink under their least pixel sizes (seen from 200 m and more);
			// the core runs a little white-hot (bloom), the glare stays at a level the tone curve keeps saturated
			const d = camera ? _c.copy( l.at ).applyMatrix4( g.matrixWorld ).distanceTo( camera.position ) : 0;
			l.halo.scale.setScalar( Math.max( 1, SKI_LAMPS.haloPx * 0.5 * px * d / SKI_LAMPS.haloR ) );
			l.halo.material.emissive.copy( c ).lerp( WHITE, 0.25 ).multiplyScalar( SKI_LAMPS.halo * a * lift );
			l.glare.scale.setScalar( Math.max( 1, SKI_LAMPS.glarePx * 0.5 * px * d / SKI_LAMPS.glareR ) );
			// (close by the lens and its core halo read on their own: the glare is for range, not a disc round the lamp)
			l.glare.material.emissive.copy( c ).multiplyScalar( SKI_LAMPS.glare * a * lift * smooth( d, SKI_LAMPS.glareNear, SKI_LAMPS.glareFar ) );

		}

		if ( this.head ) {

			this.head.enabled = show;
			if ( show ) {

				const q = g.quaternion;
				this.head.position.copy( this.headAt ).applyQuaternion( q ).add( g.position );
				this.head.dir.set( 0, Math.sin( SKI_LAMPS.headAim ), Math.cos( SKI_LAMPS.headAim ) ).applyQuaternion( q );

			}

		}

		this.pool( show, on );

	}

	// the water's light pool (WaterMaterial head* uniforms): the headlamp's position and intensity, its aim and
	// the cos of the cone's edge; intensity 0 when off, and the sea skips the term
	pool( show, on = 0 ) {

		const W = this.water;
		if ( ! W || ( ! show && ! this._poolOn ) ) return;
		this._poolOn = show;
		const hp = this._hp, hd = this._hd;
		if ( show && this.head ) {

			hp[ 0 ] = this.head.position.x; hp[ 1 ] = this.head.position.y; hp[ 2 ] = this.head.position.z; hp[ 3 ] = SKI_LAMPS.head * SKI_LAMPS.pool * on;
			hd[ 0 ] = this.head.dir.x; hd[ 1 ] = this.head.dir.y; hd[ 2 ] = this.head.dir.z; hd[ 3 ] = Math.cos( SKI_LAMPS.headOuter * Math.PI / 180 );

		} else hp[ 3 ] = 0;
		W.set( 'headPos', hp );
		W.set( 'headDir', hd );

	}

	debug() {

		const r = ( v ) => v.toArray().map( ( x ) => + x.toFixed( 3 ) );
		return { glow: + this.glow.toFixed( 2 ), head: this.head?.enabled ?? null, pods: this.pods.length, mast: + this.mast.h.toFixed( 3 ), pool: this.water ? + this._hp[ 3 ].toFixed( 1 ) : null,
			at: Object.fromEntries( Object.entries( this.lamps ).map( ( [ k, l ] ) => [ k, r( l.at ) ] ) ) };

	}

}
