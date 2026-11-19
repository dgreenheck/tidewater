// Output resolution: Retina (the canvas at devicePixelRatio, capped at 2) with an adaptive governor.
//
// Modes (Settings > Performance > Resolution, kept in localStorage):
//   'auto'     Retina when the frame rate holds, stepping down when it does not (the default)
//   'retina'   always min( 2, devicePixelRatio )
//   'standard' always 1 (the canvas in CSS pixels, the browser upscales on a Retina screen)
//
// The governor watches the frame time (the rAF interval) over a rolling window. When its median goes
// over budget (18 ms: the frames no longer fit a 60 Hz vsync) it steps down one level: DPR 2, 1.5,
// 1, then the internal render scales 0.85 and 0.7 (the temporal upscaler reconstructs the output),
// never above the render scale the player chose. After a sustained good stretch it tries one level
// up; if that level drops frames again it comes back down and waits twice as long before the next
// try (backoff), so it never flip-flops. Every step starts a fresh window, and every step resets the
// temporal history (a DPR change resizes the output, which restarts the TAA; a scale change calls
// the bound `onScale` hook, which also cuts the camera).
//
// A step down must earn its reset: if the window after it is still over budget and its median fell by under
// MIN_GAIN, the load is not resolution-bound (a tsunami's CPU solver adds about 12 ms a frame whatever the
// pixel count, ) and the governor holds the level until the frame time recovers. Before this it
// stepped all the way to 70 % render scale in four steps 3 s apart, each clearing the TAA history, and the
// canopy's alpha dither (smoothed only by TAA) went blocky (test/resolution-governor.mjs).

const KEY = 'tidewater.resolution';
const WINDOW = 3.0; // s of frames per decision
const BUDGET_MS = 18.0; // median frame time over this: step down
const GOOD_MS = 17.4; // median at or under this (a held 60 Hz, or faster) counts as a good stretch
const UP_AFTER = 12.0; // s of good stretch before trying one level up
const GRACE = 6.0; // s after start / a mode change before the first decision (shader compiles, streaming)
const MIN_GAIN = 0.1; // share of the median frame time a step down must save to count as resolution-bound

export class ResolutionGovernor {

	constructor( engine ) {

		this.engine = engine;
		this.maxDpr = Math.min( 2, Math.max( 1, window.devicePixelRatio || 1 ) );
		let m = 'auto';
		try { m = localStorage.getItem( KEY ) || 'auto'; } catch { /* storage blocked: default */ }
		this.mode = [ 'auto', 'retina', 'standard' ].includes( m ) ? m : 'auto';
		this.userScale = 1; // the render scale the player chose (the governor never goes above it)
		this.onScale = null; // ( scale ) => apply an internal render scale (bound by the app)
		this.onChange = []; // ( level ) => after every step
		this.levels = this._levels();
		this.index = 0;
		this.samples = [];
		this.t = 0;
		this.hold = GRACE;
		this.good = 0;
		this.backoff = UP_AFTER;
		this.lastUp = - 1; // index we stepped up from (a failed try doubles the backoff)
		this.steps = []; // history: { t, from, to, why, median }
		this.downMedian = 0; // median (ms) that triggered the last step down, while its verdict is pending; 0: none
		this.dpr = this.mode === 'standard' ? 1 : this.maxDpr;
		this.scale = 1;
		this._applied = 1;

	}

	_levels() {

		const out = [];
		for ( const d of [ 2, 1.5, 1 ] ) if ( d <= this.maxDpr + 1e-3 ) out.push( { dpr: d, scale: 1 } );
		if ( ! out.length || out[ 0 ].dpr < this.maxDpr - 1e-3 ) out.unshift( { dpr: this.maxDpr, scale: 1 } );
		for ( const s of [ 0.85, 0.7 ] ) out.push( { dpr: 1, scale: s } );
		return out;

	}

	setMode( m ) {

		if ( ! [ 'auto', 'retina', 'standard' ].includes( m ) ) return;
		this.mode = m;
		try { localStorage.setItem( KEY, m ); } catch { /* not kept */ }
		this.index = 0; this.samples.length = 0; this.hold = GRACE; this.good = 0; this.backoff = UP_AFTER; this.lastUp = - 1; this.downMedian = 0;
		this._apply( m === 'standard' ? { dpr: 1, scale: 1 } : this.levels[ 0 ], 'mode ' + m );

	}

	// the render scale the player chose (Performance > Render scale); re-applies the governor's cap
	setUserScale( s ) {

		this.userScale = s;
		const a = Math.min( s, this.scale );
		this._applied = a;
		if ( a !== s && this.onScale ) this.onScale( a );

	}

	// the level in force: { dpr, scale } where scale is the governor's cap on the render scale
	get level() {

		return { dpr: this.dpr, scale: this.scale };

	}

	get label() {

		const e = this.engine;
		return `${ e.width }×${ e.height } @${ this.dpr.toFixed( this.dpr % 1 ? 2 : 0 ) }x` + ( this.scale < 1 ? ` ${ Math.round( this.scale * 100 ) }%` : '' ) + ( this.mode === 'auto' ? ' auto' : '' );

	}

	_apply( lv, why, median = 0 ) {

		const from = { dpr: this.dpr, scale: this.scale };
		this.dpr = lv.dpr;
		this.scale = lv.scale;
		const s = Math.min( lv.scale, this.userScale );
		const scaleChanged = s !== this._applied;
		this._applied = s;
		this.steps.push( { t: + this.t.toFixed( 2 ), from, to: { dpr: lv.dpr, scale: lv.scale }, why, median: + median.toFixed( 2 ) } );
		if ( this.steps.length > 32 ) this.steps.shift();
		if ( this.engine.renderScale !== lv.dpr ) {

			this.engine.renderScale = lv.dpr;
			this.engine.resize();

		}

		if ( scaleChanged && this.onScale ) this.onScale( s );
		for ( const f of this.onChange ) f( this.level );

	}

	// dt: the real frame interval (s), once per frame
	update( dt ) {

		this.t += dt;
		if ( this.mode !== 'auto' ) return;
		if ( dt > 0.25 ) { this.samples.length = 0; return; } // a stall (tab switch, load): not a verdict
		this.samples.push( dt * 1000 );
		let sum = 0;
		for ( const s of this.samples ) sum += s;
		while ( sum > WINDOW * 1000 && this.samples.length > 1 ) sum -= this.samples.shift();
		if ( this.hold > 0 ) { this.hold -= dt; return; }
		if ( sum < WINDOW * 1000 * 0.95 ) return;
		const sorted = [ ...this.samples ].sort( ( a, b ) => a - b );
		const median = sorted[ sorted.length >> 1 ];
		if ( median > BUDGET_MS && this.index < this.levels.length - 1 ) {

			// the last step down saved under MIN_GAIN: CPU-bound, so another step would only reset the TAA again
			if ( this.downMedian > 0 && median > this.downMedian * ( 1 - MIN_GAIN ) ) {

				this.samples.length = 0;
				this.good = 0;
				return;

			}
			// a level we just stepped up to failed: wait twice as long before trying it again
			if ( this.lastUp === this.index + 1 ) this.backoff = Math.min( this.backoff * 2, 240 );
			this.lastUp = - 1;
			this.index ++;
			this.downMedian = median;
			this._step( 'over budget', median );
			return;

		}

		if ( median <= BUDGET_MS ) this.downMedian = 0; // back in budget: the next over-budget stretch is judged afresh
		if ( median <= GOOD_MS ) this.good += dt; else this.good = 0;
		if ( this.good >= this.backoff && this.index > 0 ) {

			this.lastUp = this.index;
			this.downMedian = 0;
			this.index --;
			this._step( 'headroom', median );

		}

	}

	_step( why, median ) {

		this.samples.length = 0;
		this.good = 0;
		this.hold = 1.0; // let the new size settle (target re-creation) before measuring
		this._apply( this.levels[ this.index ], why, median );

	}

}
