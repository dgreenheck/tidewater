import { ResolutionGovernor } from './ResolutionGovernor.js';
import { GPU } from './gpu/GPU.js';
import { PerspectiveCamera } from './scene/Camera.js';
import { Scene } from './scene/Scene.js';
import { Timer } from './math/Timer.js';
import { MeshRenderer } from './render/MeshRenderer.js';
import { FrameUniforms } from './render/Frame.js';

// Canvas, device, main camera / scene and the frame loop.
export class Engine {

	constructor( container ) {

		this.container = container;
		this.resolution = new ResolutionGovernor( this ); // Retina (DPR, capped at 2) + the adaptive governor
		this.renderScale = this.resolution.dpr; // canvas pixels per CSS pixel
		this.clock = new Timer();
		this.frame = 0;
		this.onResize = [];

	}

	async init() {

		const canvas = document.createElement( 'canvas' );
		canvas.tabIndex = 0;
		this.container.appendChild( canvas );
		this.canvas = canvas;
		this.domElement = canvas;
		await GPU.init( { canvas } );
		this.meshRenderer = new MeshRenderer();
		this.meshRenderer.syncPipelines = false; // compile in the background (App.precompile waits for them)
		this.camera = new PerspectiveCamera( 62, window.innerWidth / window.innerHeight, 0.06, 60000 );
		this.scene = new Scene();
		window.addEventListener( 'resize', () => this.resize() );
		this.resize();

	}

	setRenderScale( s ) {

		this.renderScale = s;
		this.resize();

	}

	// output (canvas) size in pixels
	get width() {

		return this.canvas.width;

	}

	get height() {

		return this.canvas.height;

	}

	resize() {

		const w = window.innerWidth, h = window.innerHeight;
		const dpr = this.renderScale;
		this.canvas.width = Math.max( 1, Math.floor( w * dpr ) );
		this.canvas.height = Math.max( 1, Math.floor( h * dpr ) );
		this.canvas.style.width = w + 'px';
		this.canvas.style.height = h + 'px';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		FrameUniforms.fields.outputResolution.value.set( this.canvas.width, this.canvas.height );
		for ( const f of this.onResize ) f( w, h );

	}

	// the canvas texture of this frame (render target of the final post pass)
	currentTexture() {

		return GPU.context.getCurrentTexture();

	}

	start( update ) {

		this.running = true;
		const generation = this.generation = (this.generation ?? 0) + 1;
		const loop = async ( t ) => {
			if ( ! this.running || this.generation !== generation ) return;

			this.clock.update( t );
			let dt = this.clock.getDelta();
			this.resolution.update( dt );
			if ( dt > 0.1 ) dt = 0.1;
			this.frame ++;
			// One accepted simulation interval in flight. Awaiting independent
			// worker jobs gives the browser input time without overlapping frames.
			const pending = update( dt, this.clock.getElapsed() );
			this.pendingUpdate = pending?.then ? pending : null;
			if ( this.pendingUpdate ) await this.pendingUpdate;
			this.pendingUpdate = null;
			if ( this.running && this.generation === generation ) this._raf = requestAnimationFrame( loop );

		};

		this._raf = requestAnimationFrame( loop );

	}

	stop() {

		this.running = false;
		this.generation = (this.generation ?? 0) + 1;
		cancelAnimationFrame( this._raf );
		return this.pendingUpdate;

	}

}
