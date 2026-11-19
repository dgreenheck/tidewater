// Recorded-engine playback adapted from Swift Parking's GameSound. These are
// real local recordings; engine RPM/load, rather than road speed, drive pitch.
// Tyres add a procedural layer on top: rolling roar and loose-surface crunch that
// follow speed and surface, and a squeal only when a tyre really slides on a hard surface.
// Each car's recording, idle and redline come from Vehicles.js (which test/vehicle-parity.mjs holds
// to rally-physics/src/vehicle.rs).
import { hardTyreSlip } from './TyreSlip.js';
import { VEHICLES } from './Vehicles.js';
// Wheel surface codes from the physics snapshot.
const LOOSE = new Set( [ 0, 1, 4, 7 ] ), HARD = new Set( [ 2, 3, 5 ] );
export class EngineSound {
	constructor( disabled = false ) {
		this.disabled = disabled;
		this.enabled = ! disabled;
		this.buffers = new Map();
		this.loads = new Map();
		this.vehicle = 'aster';
		this.state = disabled ? 'disabled' : 'ready';
		this.request = 0;
	}
	async resume( vehicle ) {
		if ( this.disabled || ! this.enabled ) return;
		this.ctx ||= new ( window.AudioContext || window.webkitAudioContext )();
		await this.ctx.resume();
		this.tyres ||= this.buildTyres();
		this.shout ||= fetch( `${ import.meta.env.BASE_URL }rally/audio/yeet.wav` )
			.then( response => response.arrayBuffer() ).then( data => this.ctx.decodeAudioData( data ) ).catch( () => null );
		if ( this.vehicle === vehicle && this.source ) return;
		this.vehicle = vehicle;
		const request = ++ this.request;
		this.state = 'loading';
		try {
			if ( ! this.loads.has( vehicle ) && ! this.buffers.has( vehicle ) ) this.loads.set( vehicle, ( async () => {
				const response = await fetch( `${ import.meta.env.BASE_URL }rally/audio/${ ( VEHICLES[ vehicle ] || VEHICLES.aster ).sound }` );
				if ( ! response.ok ) throw new Error( 'Engine recording could not load' );
				const buffer = await this.ctx.decodeAudioData( await response.arrayBuffer() );
				this.buffers.set( vehicle, buffer );
			} )().finally( () => this.loads.delete( vehicle ) ) );
			await this.loads.get( vehicle );
			if ( request !== this.request ) return;
			this.source?.stop(); this.source?.disconnect(); this.gain?.disconnect(); this.filter?.disconnect();
			this.source = this.ctx.createBufferSource();
			this.source.buffer = this.buffers.get( vehicle ); this.source.loop = true;
			this.source.playbackRate.value = 0.82;
			this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 1900;
			this.gain = this.ctx.createGain(); this.gain.gain.value = 0;
			this.source.connect( this.filter ).connect( this.gain ).connect( this.ctx.destination );
			this.source.start();
			this.recording = ( VEHICLES[ vehicle ] || VEHICLES.aster ).sound; this.state = 'playing';
		} catch ( error ) { this.state = 'unavailable'; console.warn( 'Rally engine audio:', error.message ); }
	}
	// Two looping noise beds: a low roar/crunch and a narrow squeal band.
	buildTyres() {
		const ctx = this.ctx, length = ctx.sampleRate * 2, buffer = ctx.createBuffer( 1, length, ctx.sampleRate ), data = buffer.getChannelData( 0 );
		let brown = 0;
		for ( let i = 0; i < length; i ++ ) { brown = ( brown + 0.02 * ( Math.random() * 2 - 1 ) ) / 1.02; data[ i ] = brown * 3.5 + ( Math.random() * 2 - 1 ) * 0.15; }
		const bed = ( type, frequency, q ) => {
			const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
			source.playbackRate.value = 0.7 + Math.random() * 0.6;
			const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
			const gain = ctx.createGain(); gain.gain.value = 0;
			source.connect( filter ).connect( gain ).connect( ctx.destination ); source.start();
			return { source, filter, gain };
		};
		return { roar: bed( 'lowpass', 420, 0.7 ), squeal: bed( 'bandpass', 1150, 9 ) };
	}
	toggle( vehicle ) {
		this.enabled = ! this.enabled;
		if ( this.enabled ) this.resume( vehicle );
		return this.enabled;
	}
	update( state, throttle, active, muted, distance = 0 ) {
		if ( ! this.source || ! this.ctx ) return;
		const { idle, redline } = VEHICLES[ this.vehicle ] || VEHICLES.aster;
		const rpm = Math.max( idle, state[ 9 ] || idle );
		const revs = Math.min( 1, ( rpm - idle ) / ( redline - idle ) );
		// Traction control and gear changes cut the engine's load, and the note follows.
		// (the physics' engine load covers reverse too, where the power pedal is S)
		const load = state.length > 80 ? state[ 79 ] * ( state[ 80 ] > 0.5 ? 0.35 : 1 ) : throttle;
		const underwater = state.length > 73 ? Math.min( 1, Math.max( 0, ( state[ 73 ] - 0.2 ) * 2 ) ) : 0;
		const now = this.ctx.currentTime;
		const audible = active && this.enabled && ! muted;
		const falloff = 1 / ( 1 + Math.max( 0, distance - 8 ) * 0.08 );
		this.source.playbackRate.setTargetAtTime( 0.82 + Math.sqrt( revs ) * 0.9, now, 0.10 );
		this.filter.frequency.setTargetAtTime( ( 1800 + load * 2600 + revs * 900 ) * ( 1 - underwater * 0.8 ), now, 0.12 );
		const gain = audible ? ( 0.075 + load * 0.095 + revs * 0.04 ) * falloff * ( 1 - underwater * 0.5 ) : 0;
		this.gain.gain.setTargetAtTime( gain, now, 0.07 );
		this.state = audible ? 'playing' : 'muted';
		if ( ! this.tyres || state.length < 96 ) return;
		// Tyres: average the loaded wheels' surface, ground speed and slide.
		let speed = 0, slide = 0, scrub = 0, loose = 0, hard = 0, grounded = 0;
		for ( let w = 0; w < 4; w ++ ) {
			if ( state[ 13 + w * 4 + 3 ] < 0.5 ) continue;
			grounded ++;
			const code = Math.round( state[ 89 + w ] ), c = 29 + w * 10;
			scrub = Math.max( scrub, hardTyreSlip( state, w ) );
			speed += state[ c + 8 ]; slide = Math.max( slide, HARD.has( code ) ? state[ c + 7 ] : 0 );
			if ( LOOSE.has( code ) ) loose ++; else if ( HARD.has( code ) ) hard ++;
		}
		speed = grounded ? speed / grounded : 0;
		const roll = Math.min( 1, speed / 28 );
		const { roar, squeal } = this.tyres;
		const roarGain = audible && grounded ? roll * ( loose ? 0.11 : 0.05 ) * falloff : 0;
		roar.gain.gain.setTargetAtTime( roarGain, now, 0.08 );
		roar.filter.frequency.setTargetAtTime( loose ? 260 + roll * 520 : 180 + roll * 260, now, 0.1 );
		roar.source.playbackRate.setTargetAtTime( 0.55 + roll * 0.9, now, 0.1 );
		const squealGain = audible && hard ? scrub * 0.12 * falloff : 0;
		squeal.gain.gain.setTargetAtTime( squealGain, now, 0.05 );
		squeal.filter.frequency.setTargetAtTime( 950 + slide * 500 + Math.sin( now * 23 ) * 60, now, 0.05 );
	}
	// The driver's shout on bailing out of the car (one shot, loaded with the engine).
	async yeet( muted ) {
		if ( this.disabled || ! this.enabled || muted || ! this.ctx || ! this.shout ) return;
		const buffer = await this.shout;
		if ( ! buffer ) return;
		const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
		source.buffer = buffer; gain.gain.value = 0.9;
		source.connect( gain ).connect( this.ctx.destination );
		source.start();
		this.yeets = ( this.yeets || 0 ) + 1;
	}
	close() { ++ this.request; this.source?.stop(); this.ctx?.close(); }
}
