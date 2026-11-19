import { DisasterWater } from './disasters/Water.js';
import { RagdollPool } from './player/workers/RagdollPool.js';
import { SimulationPacing } from './core/SimulationPacing.js';
import { updateOceanDisplacementBounds } from './ocean/DisplacementBounds.js';
import { Disasters } from './disasters/Disasters.js';
import { Vector3, Euler, Color, MathUtils, Mesh } from './engine/index.js';
import { GPU } from './engine/gpu/GPU.js';
import { SunShadows } from './engine/render/Shadows.js';
import { FrameUniforms } from './engine/render/Frame.js';

import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { CDLOD } from './core/CDLOD.js';
import { G } from './core/Globals.js';
import { Profiler } from './core/Profiler.js';
import { SceneRenderer, LAYERS } from './core/SceneRenderer.js';
import { DEPTH_FORMAT } from './engine/render/SceneRenderer.js';
import { installDebugViews } from './core/DebugViews.js';

import { Atmosphere, SUN_ILLUMINANCE } from './sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from './sky/Sky.js';
import { Clouds } from './sky/Clouds.js';
import { SkyProClouds } from './sky/SkyProClouds.js';
import { Environment } from './sky/Environment.js';

import { TerrainData } from './world/TerrainData.js';
import { CoastalRoute } from './world/CoastalRoute.js';
import { CoastalRoad } from './world/CoastalRoad.js';
import { TerrainGPU } from './world/TerrainGPU.js';
import { Terrain } from './world/Terrain.js';
import { computeShoreField } from './world/ShoreField.js';
import { WORLD } from './world/WorldLayout.js';
import { Colliders } from './world/Colliders.js';
import { Village } from './world/Village.js';
import { Reef } from './world/Reef.js';
import { BoatModel } from './world/BoatModel.js';
import { Rocks } from './world/Rocks.js';
import { Debris } from './world/Debris.js';
import { Wildlife } from './world/wildlife/Wildlife.js';
import { Livestock } from './wildlife/Livestock.js';
import { Whale } from './world/marine/Whale.js';
import { DolphinPod } from './world/marine/Dolphin.js';
import { Sharks } from './world/marine/Sharks.js';
import { addWorldTool } from './ui/WorldTools.js';
import { Aviation } from './aviation/Aviation.js';
import { Glider } from './glider/Glider.js';
import { prepareGliderSite } from './glider/Site.js';
import { prepareChairliftSite } from './chairlift/Route.js';
import { Chairlift } from './chairlift/Chairlift.js';
import { commitGeometryMotion } from './engine/render/GeometryMotion.js';
import { WindFarm } from './windfarm/WindFarm.js';
import { prepareWindFarmSites } from './windfarm/Sites.js';
import { prepareEvacuationRoute } from './evacuation/Route.js';
import { Evacuation } from './evacuation/Evacuation.js';

import { OceanFFT } from './ocean/OceanFFT.js';
import { WaterSurface } from './ocean/WaterSurface.js';
import { WaterMaterial } from './ocean/WaterMaterial.js';
import { createFoamTexture } from './ocean/FoamTexture.js';
import { ShoreWaves } from './ocean/ShoreWaves.js';
import { ShoreSim } from './ocean/ShoreSim.js';
import { Caustics } from './ocean/Caustics.js';
import { installUnderwaterLighting } from './ocean/UnderwaterLighting.js';
import { RefractionPass } from './ocean/RefractionPass.js';
import { installGroundBounce } from './materials/GroundBounce.js';
import { LocalLights, addVillageLights, addBoatLights } from './materials/LocalLights.js';
import { WaterQuery } from './ocean/WaterQuery.js';
import { Breakers } from './ocean/Breakers.js';
import { SurfFoam } from './ocean/SurfFoam.js';
import { Spray } from './fx/Spray.js';
import { SeaDetail } from './ocean/SeaDetail.js';
import { MarineSnow } from './fx/MarineSnow.js';
import { AirMotes } from './fx/AirMotes.js';

import { Underwater, LENS_REACH } from './post/Underwater.js';
import { PostFX } from './post/PostFX.js';
import { AirHaze } from './post/AirHaze.js';
import { FlyCamera } from './player/FlyCamera.js';
import { Player } from './player/Player.js';
import { Cockatoo } from './player/Cockatoo.js';
import { RallyDrive } from './rally/RallyDrive.js';
import { PropPhysics } from './physics/Props.js';
import { Ferry } from './ferry/Ferry.js';
import { People } from './people/People.js';
import { Beach } from './people/Beach.js';
import { Jetskis } from './jetski/Jetski.js';
import { placeJetskiHire } from './world/JetskiHire.js';
import { Terminal, applyTerminalSite, PLACES } from './ferry/Terminal.js';
import { Game } from './game/Game.js';
import { STAND } from './game/FishStand.js';
import { CHANDLERY } from './game/Chandlery.js';
import { DAY_RATE, START_HOUR, advanceClock } from './sky/DayClock.js';
import { JoeyVillage, JOEY_VILLAGE_SITE } from './joey/Village.js';
import { BoatController } from './player/BoatController.js';
import { BoatSpray } from './player/BoatSpray.js';
import { WakeSim } from './ocean/WakeSim.js';
import { Vegetation } from './world/Vegetation.js';
import { SoundScape } from './audio/SoundScape.js';
import { updateCameraVelocity, useStaticVelocity } from './post/CameraVelocity.js';
import { poseScene } from './engine/render/ScenePose.js'; // L6 perf

const _up = new Vector3( 0, 1, 0 );

export class App {

	constructor() {

		this.simulationPacing = new SimulationPacing();
		this.qs = new URLSearchParams( location.search );
		this.settings = {
			timeOfDay: START_HOUR,
			sunAzimuth: 0, // degrees: turns the sun's daily path about the vertical
			// game hours per real second in daylight (deep night runs faster, src/sky/DayClock.js); 0 holds the
			// clock, as the benchmark does
			timeSpeed: this.qs.has( 'bench' ) ? 0 : DAY_RATE,
			exposure: 0.55,
			renderScale: 1, // internal resolution (the temporal upscaler reconstructs the output), Performance tab
		};
		// The driver's shout on bailing out of a car (off with ?noShout).
		this.settings.bailShout = ! this.qs.has( 'noShout' );

	}

	async init( onProgress = () => {} ) {

		const qs = this.qs;
		// report a stage, then let the page paint it before the (synchronous) stage work starts
		const progress = async ( p, text, until ) => {

			onProgress( p, text, until );
			if ( typeof requestAnimationFrame === 'function' ) await new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

		};
		await progress( 0.02, 'Starting WebGPU…' );
		const engine = this.engine = new Engine( document.getElementById( 'app' ) );
		await engine.init();
		// systems take `renderer` first as in the three.js version: it is the Engine now (GPU access is global)
		const renderer = engine;
		const { scene, camera } = engine;
		// the near clip plane is the lens: it slices the water surface at the waterline (see Underwater)
		camera.near = 0.1;
		camera.updateProjectionMatrix();
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;

		this.input = new Input( engine.domElement );
		this.fly = new FlyCamera( camera, engine.domElement, this.input );
		// every pose set is a camera cut (free-camera toggle, debug views, scripted poses): see cameraCut
		const setPose = this.fly.setPose.bind( this.fly );
		this.fly.setPose = ( ...args ) => { setPose( ...args ); this.cameraCut(); };
		this.fly.setPose( new Vector3( 20, 6, - 20 ), Math.PI * 0.9, - 0.12 );

		// ---------------------------------------------------------------- sky
		await progress( 0.04, 'Building the atmosphere…' );
		this.atmosphere = new Atmosphere( renderer );
		this.sky = new Sky( this.atmosphere );
		if ( ! qs.has( 'noClouds' ) ) {

			// sky-pro-webgpu's clouds ("Partly cloudy"); ?oldClouds: the previous ones
			this.clouds = qs.has( 'oldClouds' ) ? new Clouds( renderer, this.atmosphere ) : new SkyProClouds( renderer, this.atmosphere );
			if ( this.clouds.ready ) await this.clouds.ready;
			this.sky.clouds = this.clouds;

		}

		// 3 cascades: 0-10 m (~1 cm texels, fine contact detail), 10-60 m, 60-400 m (rough far shadows);
		// contact-hardening filter sized by the sun's disc on the near cascade. Each cascade's depth range
		// is its light margin (200 m) + its extent, which keeps the depth bias small in metres.
		// Shadows come from the opaque and the late (transparent-pass) layers.
		this.csm = this.shadows = new SunShadows( { size: 2048, splits: [ 10, 60, 400 ], lightMargin: 200, normalBias: [ 0.015, 0.06, 0.3 ], bias: 0.00002 } );
		this.shadows.layerMask = ( 1 << LAYERS.OPAQUE ) | ( 1 << LAYERS.TRANSPARENT );

		this.environment = new Environment( renderer, scene, this.sky );

		// ---------------------------------------------------------------- island
		await progress( 0.06, 'Shaping the island…' );
		this.terrainData = new TerrainData();
		// the ferry terminal's dredged berth, reclaimed flat and breakwater: before anything else
		// reads the heights (village pads, roads, plants, shore field, GPU terrain, minimap)
		for ( const place of Object.values( PLACES ) ) applyTerminalSite( this.terrainData, undefined, place );
		applyTerminalSite( this.terrainData, JOEY_VILLAGE_SITE, PLACES.joey ); // ground under the village slabs, kept clear
		this.colliders = new Colliders();
		// the village flattens building pads into the heightmap: build it before any terrain
		// data is derived (shore field, GPU textures, meshes)
		await progress( 0.12, 'Building the village…' );
		this.village = new Village( { scene, terrain: this.terrainData, colliders: this.colliders } );
		this.coastalRoute = new CoastalRoute( this.terrainData );
		prepareEvacuationRoute(this.terrainData);
		prepareWindFarmSites(this.terrainData);
		prepareGliderSite(this.terrainData, this.coastalRoute);
		prepareChairliftSite(this.terrainData, this.coastalRoute);
		this.coastalRoad = new CoastalRoad( scene, this.terrainData, this.coastalRoute, this.colliders );
		if ( ! qs.has( 'noVeg' ) ) {

			await progress( 0.14, 'Planting the island…' );
			this.vegetation = new Vegetation( { scene, terrain: this.terrainData, village: this.village } );
			useStaticVelocity( this.vegetation.group );

		}

		await progress( 0.19, 'Rolling in the swell…' );
		this.shoreField = computeShoreField( this.terrainData, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
		this.terrainGPU = new TerrainGPU( this.terrainData, this.shoreField );
		// terrain and rocks apply the heightfield sun shadow (long hill shadows) in their own lighting
		this.terrain = new Terrain( { scene, terrainData: this.terrainData, terrainGPU: this.terrainGPU, renderer } );
		this.rocks = new Rocks( { scene, terrain: this.terrain, village: this.village, colliders: this.colliders } );
		// driftwood (CC0 photoscans), wrack, pebbles and village clutter
		this.debris = new Debris( { scene, terrain: this.terrain, village: this.village, vegetation: this.vegetation, rocks: this.rocks, colliders: this.colliders } );
		// these apply the heightfield sun shadow in their own lighting model (see UnderwaterLighting)
		this.terrain.mesh.material.appliesHillShadow = true;
		this.rocks.material.appliesHillShadow = true;

		await progress( 0.23, 'Growing the reef…' );
		this.reef = new Reef( { scene, terrain: this.terrainData, shoreField: this.shoreField } );

		this.boat = new BoatModel();
		scene.add( this.boat.group );
		this.boat.group.position.copy( WORLD.boatDock.position );
		this.boat.group.rotation.y = WORLD.boatDock.heading;

		// ---------------------------------------------------------------- ocean
		await progress( 0.3, 'Simulating the ocean…' );
		this.fft = new OceanFFT( renderer );
		if ( this.reef.setOcean ) this.reef.setOcean( this.fft ); // coral / sea fan sway follows the simulated swell
		this.foamTexture = createFoamTexture( renderer );
		this.oceanLOD = new CDLOD( { gridSize: Number( qs.get( 'G' ) || 32 ), leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
		this.surface = new WaterSurface( { fft: this.fft, cdlod: this.oceanLOD, foamTexture: this.foamTexture } );
		this.surface.terrain = this.terrainGPU;
		this.disasterWater = new DisasterWater(this.terrainGPU);
		this.surface.disaster = this.disasterWater;
		this.seaDetail = new SeaDetail();
		this.surface.detail = this.seaDetail;
		this.shore = new ShoreWaves( this.terrainGPU );
		this.surface.shore = this.shore;
		this.caustics = qs.has( 'noCaustics' ) ? null : new Caustics( renderer, this.fft );
		if ( this.caustics ) this.caustics.detail = this.seaDetail;

		if ( ! qs.has( 'noSim' ) ) {

			this.shoreSim = new ShoreSim( renderer, { terrainGPU: this.terrainGPU, shore: this.shore } );
			this.surface.shoreSim = this.shoreSim;
			// WGSL: fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f (x = wetness, y = sand foam)
			this.terrain.wetness = {
				modules: [ this.shoreSim.module ],
				code: /* wgsl */`
fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f {
	let s = shoreSimSample( xz );
	let inside = shoreSimInside( shoreSimUvOf( xz ) );
	// outside the simulated region fall back to a static damp band
	let band = smoothstep( 0.45, 0.0, h );
	// foam left on the sand: the lace the water carried, stranded and popping (ShoreSim.sandFoam)
	return vec2f( max( s.y, band * ( 1.0 - inside ) ), shoreSimSandFoam( xz, s, h ) );
}`,
			};
			this.terrain.finalizeMaterial();
			// surf-zone foam look (whitewater, lace) used by the water shader
			this.surfFoam = new SurfFoam( { shoreSim: this.shoreSim } );
			this.surface.foamShading = ( args ) => this.surfFoam.shading( args );

		}

		// how much of the underwater lighting each group needs (sampler budget, see UnderwaterLighting)
		const underwaterMode = ( root, m ) => root && root.traverse( ( o ) => {

			if ( o.material ) for ( const mat of Array.isArray( o.material ) ? o.material : [ o.material ] ) mat.underwaterLighting = m;

		} );
		underwaterMode( this.village.group, 'lite' );
		underwaterMode( this.boat.group, 'lite' );
		if ( this.vegetation ) underwaterMode( this.vegetation.group, 'none' );

		this.underwaterLighting = installUnderwaterLighting( {
			fft: this.fft, caustics: this.caustics, clouds: this.clouds, terrain: this.terrainGPU,
			shore: this.shore, surface: this.surface, shoreSim: this.shoreSim,
		} );

		// sunlight bounced off the ground (one diffuse bounce, re-baked with the terrain sun shadow)
		installGroundBounce( { terrain: this.terrainGPU, clouds: this.clouds } );
		this.sceneRenderer = new SceneRenderer( engine.meshRenderer, scene, camera );
		// the water's refraction source: the scene below the water only, half resolution
		this.refraction = new RefractionPass( { meshRenderer: engine.meshRenderer, scene, camera, sceneRenderer: this.sceneRenderer, scale: 0.5 } );
		this.sceneRenderer.onBeforeWater = () => this.refraction.render( G.seaLevel.value );
		if ( this.sky.background ) this.sceneRenderer.background = this.sky.background;
		// lanterns, lamp posts, path lights, lit windows, the boat's cabin / navigation lights and the
		// flashlight (L): nearest few packed into one small uniform array each frame
		this.localLights = new LocalLights();
		addVillageLights( this.localLights, this.village );
		addBoatLights( this.localLights, this.boat );
		// rough, large or heavily overdrawn surfaces (ground, rocks, debris, foliage) take the local
		// lights as Lambert only; the village, pier and boat get the full BRDF (glints on wet wood, metal)
		for ( const root of [ this.terrain.mesh, this.rocks.group, this.debris && this.debris.group, this.vegetation && this.vegetation.group ] ) if ( root ) root.traverse( ( o ) => {

			if ( o.material ) for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) m.localLightsCheap = true;

		} );
		// the sea is not drawn inside the boat (its hull volume masks the surface)
		this.sceneRenderer.addHullMask( this.boat.createHullVolumeGeometry(), this.boat.group );
		this.waterMaterial = new WaterMaterial( {
			surface: this.surface, sky: this.sky, sceneCopy: this.sceneRenderer.opaqueCopy, sceneDepthHalf: this.sceneRenderer.opaqueDepthHalf.texture, refraction: this.refraction,
			hullMask: this.sceneRenderer.hullMaskRT.texture, hullMaskActive: this.sceneRenderer.hullMaskActive,
		} );
		this.waterMaterial.clouds = this.clouds;
		this.ocean = new Mesh( this.oceanLOD.geometry, this.waterMaterial );
		this.ocean.frustumCulled = false;
		this.ocean.receiveShadow = true;
		this.ocean.layers.set( LAYERS.WATER );
		// Thin alpha-tested meshes (nets, cloth, wire traps) are drawn in the late pass: the screen-space
		// AO and the refraction copy only see the opaque pass, so they neither smear dark AO halos over
		// what is behind them nor receive the noisy AO of their own strands. The boat's window glass is
		// blended: in the late pass it goes over the water seen through it (drawn earlier it would be
		// painted over by the water).
		this.scene.traverse( ( o ) => {

			if ( o.isMesh && ( o.name === 'village_fabric' || o.name === 'village_nets' || o.name === 'boat-trap' || o.name === 'boat-glass' ) ) o.layers.set( LAYERS.TRANSPARENT );

		} );
		// Terrain and water place their vertices in the vertex shader (CDLOD), so three's default motion
		// vectors (previous frame = raw grid position) are garbage there. Both are still in the world or
		// nearly so: camera-only reprojection of the real world position is what the temporal resolve needs.
		// ( the water material writes its own velocity + waterline mask outputs )
		useStaticVelocity( this.terrain.mesh );
		useStaticVelocity( this.rocks.group );
		scene.add( this.ocean );

		this.query = new WaterQuery( renderer, this.surface );

		this.marineSnow = new MarineSnow( { fft: this.fft, query: this.query } );
		scene.add( this.marineSnow.mesh );

		// ---- surf: plunging lips along the beach + spray particles (the breakers emit on the GPU;
		// spray.emit() / emitAlongPoints() for boat bow spray and splashes)
		this.spray = new Spray( renderer, { query: this.query, terrain: this.terrainGPU, sceneCopy: this.sceneRenderer.opaqueCopy, clouds: this.clouds } );
		scene.add( this.spray.mesh );
		if ( this.reef.setSpray ) this.reef.setSpray( this.spray ); // splashes of leaping fish
		this.breakers = new Breakers( renderer, {
			surface: this.surface, shore: this.shore, terrainData: this.terrainData, sky: this.sky,
			spray: this.spray, clouds: this.clouds,
		} );
		scene.add( this.breakers.mesh );
		// dust, pollen, salt aerosol, seed fluff and gnats drifting around the camera
		this.airMotes = new AirMotes( { terrain: this.terrainGPU, clouds: this.clouds, csm: this.csm, reversedDepth: true } );
		scene.add( this.airMotes.mesh );
		this.boatCtl = new BoatController( { model: this.boat, query: this.query, terrain: this.terrainData, colliders: this.colliders } );
		this.boatSpray = new BoatSpray( { boat: this.boatCtl, spray: this.spray } );
		// humpback cruising the deep water around the island (model fetched from public/models/whale)
		this.whale = new Whale( { scene, terrain: this.terrainData, query: this.query, spray: this.spray } );
		try {

			await this.whale.load();
			if ( this.reef && this.reef.setWhale ) this.reef.setWhale( this.whale ); // escort fish, foam and slick

		} catch ( e ) {

			console.warn( 'whale model failed to load', e );
			this.whale = null;

		}

		// a pod of bottlenose dolphins along the coast; they ride the ferry's and the boat's bow waves
		this.dolphins = new DolphinPod( { scene, terrain: this.terrainData, query: this.query, spray: this.spray, vessels: this } );
		try {

			await this.dolphins.load();

		} catch ( e ) {

			console.warn( 'dolphin model failed to load', e );
			this.dolphins = null;

		}

		// interactive wake around the boat (Kelvin pattern, bow/stern waves, prop wash foam)
		this.wake = new WakeSim( renderer, { terrainGPU: this.terrainGPU, boat: this.boatCtl, colliders: this.colliders } );
		this.surface.wake = this.wake;
		this.player = new Player( { camera, input: this.input, terrain: this.terrainData, colliders: this.colliders, query: this.query, boat: this.boatCtl, reef: this.reef, scene } );
		// birds, beach crabs, sanderlings (after spray / query / boat, which they use)
		this.wildlife = new Wildlife( {
			scene, renderer, terrain: this.terrainData, terrainGPU: this.terrainGPU, shore: this.shore,
			village: this.village, colliders: this.colliders, vegetation: this.vegetation, boat: this.boatCtl, boatModel: this.boat,
			query: this.query, spray: this.spray, csm: this.csm,
		} );
		this.freeCam = qs.has( 'fly' );

		// ---------------------------------------------------------------- post
		await progress( 0.34, 'Preparing the shaders…' );
		this.underwater = new Underwater( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, maskTexture: this.sceneRenderer.waterMaskTexture,
			query: this.query, caustics: this.caustics, fft: this.fft,
		} );
		// the camera's height above the water in the same frame (GPU query): decides the side the surface
		// is seen from where the triangle facing can't be trusted
		this.waterMaterial.cameraWaterHeightNode = this.query.cameraState().x;
		// aerial perspective, marine haze and volumetric sun shafts (post)
		this.haze = qs.has( 'noHaze' ) ? null : new AirHaze( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, underwater: this.underwater, atmosphere: this.atmosphere,
			sky: this.sky, clouds: this.clouds, terrain: this.terrainGPU, csm: this.csm,
		} );
		this.post = new PostFX( renderer, { sceneRenderer: this.sceneRenderer, camera, underwater: this.underwater, clouds: this.clouds, sunDir: this.atmosphere.sunDir, haze: this.haze } );
		G.exposure.value = this.settings.exposure;
		if ( qs.has( 'scale' ) ) this.settings.renderScale = Number( qs.get( 'scale' ) ) || 1;
		this.setRenderScale( this.settings.renderScale );

		// ---------------------------------------------------------------- audio
		// recorded field recordings (public/audio, credits in public/audio/CREDITS.md); ?noAudio turns it off
		this.audio = qs.has( 'noAudio' ) ? null : new SoundScape();
		this.player.audio = this.audio;
		// the fishing game (rod, bites, catch, cooler, fish stand)
		this.game = new Game( this );
		this.cockatoo = new Cockatoo( this, scene ); // the player's pet (src/player/Cockatoo.js)
		// the lanterns at Joe's fish stand and Marta's chandlery (lit from dusk like the village lamps);
		// positions are in each stall's frame (x right, z toward the customer), turned by its yaw
		for ( const [ s, lx, ly, lz ] of [ [ STAND, - 0.9, 1.85, 0.1 ], [ CHANDLERY, - 0.75, 1.58, - 1.45 ] ] ) {

			const c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
			const x = s.x + lx * c + lz * sn, z = s.z - lx * sn + lz * c;
			this.localLights.add( { position: new Vector3( x, this.terrainData.heightAt( s.x, s.z ) + ly, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

		}

		this.boatCtl.onSlam = ( s ) => this.audio && this.audio.hullSlap( s );
		engine.domElement.addEventListener( 'click', () => {

			if ( window.__ui && window.__ui.isPointerOverUI ) return;
			this.input.requestLock();
			if ( this.audio ) this.audio.resume();

		} );

		this.profiler = new Profiler( renderer );
		this.profiler.track( 'fft rows', this.fft.rowKernel );
		this.profiler.track( 'fft columns', this.fft.columnKernel );
		this.profiler.track( 'sky view', this.atmosphere.skyViewKernel );

		this.updateSun();
		installDebugViews( this );
		window.__app = this;
		this.gpu = GPU; // console / test access

		await progress( 0.35, 'Loading Rally cars and physics…' );
		// the terminal's colliders go in before the car physics exports the static boxes
		this.terminal = new Terminal( this );
		await this.terminal.init();
		this.joeyTerminal = new Terminal( this, 'joey' ); // Joey Island's, across the strait
		await this.joeyTerminal.init();
		this.joeyVillage = new JoeyVillage( this, this.joeyTerminal ); // the shopping village on Joey's terminal flat
		await this.joeyVillage.init();
		this.evacuation = new Evacuation(this);
		await this.evacuation.init();
		// loose props and fence panels wake with physics near the car or the walker (src/physics/Props.js)
		this.props = new PropPhysics( this );
		this.props.link( this.colliders );
		this.rally = new RallyDrive( this );
		// placing the car (start, reset, recovery) snaps the chase camera: a cut
		const place = this.rally.place.bind( this.rally );
		this.rally.place = ( spot ) => { place( spot ); this.cameraCut(); };
		await this.rally.init();
		this.props.attach( this.rally.physics );
		this.people = new People( this ); // the townsfolk brains, events and speech bubbles (src/people, docs/people.md)
		this.ferry = new Ferry( this );
		await this.ferry.init();
		this.jetskis = new Jetskis( this ); // rideable jetskis (src/jetski)
		await this.jetskis.init();
		this.player.jetskis = this.jetskis;
		await placeJetskiHire( this ); // the hire stand, dolly and float line by the pier (src/world/JetskiHire.js)
		this.beach = new Beach( this ); // the main beach's people, games and the hire attendant (src/people/Beach.js)
		this.beach.init(); // bodies load in the background
		await Promise.all( [ this.terminal.ready, this.joeyTerminal.ready, this.joeyVillage.ready ] );
		this.disasters = new Disasters(this,this.disasterWater);
		this.windfarm = new WindFarm(this);
		await this.windfarm.init();
		this.aviation = new Aviation(this);
		await this.aviation.init();
		this.player.aviation = this.aviation; // walk-up E prompt at the carrier jet (lane L2)
		this.glider = new Glider(this);
		await this.glider.init();
		this.chairlift = new Chairlift(this).init({connector:true});
		this.livestock = new Livestock(this);
		await this.livestock.init();
		this.rally.refreshIslandColliders();
		this.sharks = new Sharks({scene:this.scene,terrain:this.terrainData,reef:this.reef,query:this.query,vessels:this});
		await this.sharks.load();
		addWorldTool(this,{id:'sharks',label:'Watch sharks',onActivate:()=>this.sharks.watch()});
		addWorldTool(this,{id:'shark-bite',label:'Shark bite demo',onActivate:()=>this.sharks.demonstrateBite()});

		// ---- compile pipelines asynchronously (keeps the page responsive), then prime a few
		// frames behind the loading screen so any remaining first-use stalls happen there
		// stage weights: in the browser the pipeline compile below takes far longer than everything before it
		await progress( 0.36, 'Compiling shaders…', 0.95 );
		await this.precompile();
		await progress( 0.96, 'Warming up…' );
		for ( let i = 0; i < 2; i ++ ) {

			await this.frame( 1 / 60 );
			await GPU.queue.onSubmittedWorkDone();

		}

	}

	// Build every pipeline up front, then wait for the GPU (keeps first-use compiles behind the loading
	// screen). The precompile frame visits every mesh of every pass, hidden or out of view, and the
	// pipelines compile in parallel in the background (GPU.renderPipeline); the refraction pass and
	// the hull mask are forced on so their variants are built too.
	async precompile() {

		const mr = this.engine.meshRenderer;
		const refr = this.refraction.enabled;
		// compute / post pipelines were requested while the systems were built: let them finish first
		// (the frame below would otherwise compile each one again, synchronously); the post chain
		// builds its passes on first use, so build it now
		if ( ! this.post._built ) {

			this.post._build();
			this.post._outW = 0; // as PostFX.beginFrame: size the new targets

		}

		await GPU.pipelinesReady();
		mr.precompiling = true;
		this.refraction.enabled = true;
		const sr = this.sceneRenderer, hm = sr.hullMaskRT;
		if ( sr.hullMasks.length ) mr.render( sr.hullMaskScene, {
			label: 'hull mask', kind: 'color', camera: this.camera, colorViews: [ hm.texture.view() ], colorFormats: hm.formats,
			clearColors: [ [ 0, 0, 0, 0 ] ], depthView: hm.depthTexture.view(), depthFormat: DEPTH_FORMAT, clearDepth: 0, cull: false,
		} );
		try {

			// both water variants: with the hull-mask discard (a hull on screen) and without
			for ( const hull of [ 0, 1 ] ) {

				this.waterMaterial.hullOverride = hull;
				await this.frame( 1 / 60 );

			}

		} catch ( e ) {

			console.warn( 'precompile failed', e );

		}

		this.waterMaterial.hullOverride = null;
		mr.precompiling = false;
		this.refraction.enabled = refr;
		await GPU.pipelinesReady();
		await GPU.queue.onSubmittedWorkDone();

	}

	// ---------------------------------------------------------------- sun / sky

	updateSun() {

		const s = this.settings;
		const dir = sunDirectionFromTime( s.timeOfDay ).applyAxisAngle( _up, MathUtils.degToRad( s.sunAzimuth || 0 ) );
		// the sky is always scattered sunlight, even with the sun below the horizon (twilight)
		this.atmosphere.sunDir.value.copy( dir );
		// below the horizon the moon takes over as the key light
		const night = MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
		G.night.value = night;
		this.sky.starIntensity.value = night;
		const moon = new Vector3( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
		this.sky.moonDir.value.copy( moon );

		// key light: the sun until it is well below the horizon (it gives no direct light in
		// twilight anyway), then the moon
		const light = dir.y > - 0.07 ? dir : moon;
		G.sunDir.value.copy( light );

	}

	applyAtmosphereReadback() {

		const a = this.atmosphere;
		if ( ! a.sunTransmittance ) return;
		const sunTrue = a.sunDir.value;
		const sunUp = sunTrue.y > - 0.07; // same switch as updateSun()
		const T = a.sunTransmittance;
		const horizonFade = MathUtils.smoothstep( sunTrue.y, - 0.03, 0.02 );
		let c;
		if ( sunUp ) c = new Color( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
		else c = new Color( 0.6, 0.7, 1.0 ).multiplyScalar( 0.3 * G.night.value ); // moonlight: enough to read the shore by
		G.sunColor.value.copy( c );
		const irr = a.skyIrradiance;
		const nightAmb = 0.04 * G.night.value; // night sky fill: the shore and the sea stay readable
		G.skyIrradiance.value.setRGB( irr[ 0 ] + nightAmb * 0.6, irr[ 1 ] + nightAmb * 0.7, irr[ 2 ] + nightAmb );
		G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );

	}

	// T: let the day run (about 50 real minutes of daylight, src/sky/DayClock.js) or stop it
	toggleTime() {

		const s = this.settings;
		if ( s.timeSpeed !== 0 ) {

			this._timeSpeed = s.timeSpeed;
			s.timeSpeed = 0;

		} else {

			s.timeSpeed = this._timeSpeed || DAY_RATE;

		}

		if ( this.ui ) {

			this.ui.s.advance = s.timeSpeed !== 0;
			this.ui.ui.refresh();
			this.ui.ui.toast( s.timeSpeed !== 0 ? 'Time running' : 'Time paused' );

		}

	}

	// A camera cut the upscaler's 20 m jump test can miss (a short teleport, a pose set, a lens
	// change): drop its history so the last view does not smear into the new one.
	cameraCut() {

		this.post?.taau?.reset();

	}

	// Free (debug) camera on F; the walker / boat resumes where it was left.
	setFreeCam( on ) {

		if ( this.chairlift?.active ) {
			this.ui?.ui.toast( 'Exit the chairlift at a terminal before changing activities.' );
			return false;
		}

		if ( on && this.aviation?.active ) this.aviation.leave();
		if ( on && this.glider?.active ) this.glider.leave();
		if ( on === this.freeCam ) return;
		this.freeCam = on;
		if ( this.post?.motionBlur ) this.post.motionBlur.freeCamera = on; // no camera blur in the free camera
		this.cameraCut(); // the other camera, maybe another lens
		if ( on ) {

			this.rally?.restoreLens();

			const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
			this.fly.setPose( this.camera.position.clone(), e.y, e.x );
			this.fly.velocity.set( 0, 0, 0 );

		} else if ( this.player.mode !== 'boat' && this.player.mode !== 'deck' && this.player.mode !== 'rally' ) {

			this.dropPlayerAtCamera();

		}

	}

	// Leaving the free camera: the player continues from where the camera is, facing the same way,
	// and falls from there (swimming at once if the camera is under water).
	dropPlayerAtCamera() {

		const p = this.player, c = this.camera.position;
		const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
		p.yaw = e.y;
		p.pitch = MathUtils.clamp( e.x, - 1.5, 1.5 );
		p.velocity.set( 0, 0, 0 );
		const ground = Math.max( this.terrainData.heightAt( c.x, c.z ), this.colliders.groundHeightAt( c.x, c.z, c.y ) );
		const water = this.cameraWaterHeight ?? 0;
		if ( c.y < water ) {

			p.mode = 'swim';
			p.position.set( c.x, Math.max( c.y - 0.16, ground + 0.3 ), c.z );

		} else {

			// drop from where the camera is: gravity brings you down onto the ground or a deck, or into
			// the sea (the walker starts swimming once it is out of its depth)
			p.mode = 'walk';
			p.position.set( c.x, Math.max( c.y - 1.62, ground ), c.z );
			p.grounded = false;

		}

		p.waterH = water;
		p.waterMean = water;

	}

	// ---------------------------------------------------------------- loop

	start() {

		this.ragdollPool = new RagdollPool();
		this.ragdollPool.init();
		this.engine.start( ( dt ) => this.frame( dt ) );

	}

	updateFPS( dt ) {

		const f = this._fps || ( this._fps = { el: document.getElementById( 'fps' ), acc: 0, n: 0, worst: 0 } );
		f.acc += dt;
		f.n ++;
		f.worst = Math.max( f.worst, dt );
		if ( f.acc >= 0.5 ) {

			const fps = f.n / f.acc;
			let text = `${ fps.toFixed( 0 ) } fps · ${ ( 1000 * f.acc / f.n ).toFixed( 1 ) } ms · max ${ ( f.worst * 1000 ).toFixed( 1 ) } ms`;
			if ( this.profiler && this.profiler.enabled ) {

				const p = this.profiler.result;
				text += ` · GPU c ${ p.compute.toFixed( 2 ) } r ${ p.render.toFixed( 2 ) }`;

			}

			if ( f.el ) f.el.textContent = text;
			this.fps = fps;
			f.acc = 0;
			f.n = 0;
			f.worst = 0;

		}

	}

	// Game time: the world clock the frames advance, slowed by warp().
	get gameTime() { return G.time.value; }

	// Bullet time: curve( seconds of unslowed time ) gives the world's time scale, or null
	// once the warp is over.
	warp( curve ) { this.warping = { curve, t: 0 }; }

	warpTime( dt ) {

		const w = this.warping;
		if ( ! w ) return dt;
		w.t += dt;
		const scale = w.curve( w.t );
		if ( scale === null ) { this.warping = null; return dt; }
		return dt * scale;

	}

	frame( dt, wallDt = this.engine.clock.getDelta() || dt ) {

		const t0 = performance.now();
		this.input.beginFrame();
		this.updateFPS( wallDt );
		if ( this.disasters?.paused ) {

			// Settle temporal rendering while every physical state and clock stays frozen.
			GPU.beginFrame();
			FrameUniforms.fields.frameIndex.value = GPU.frame;
			G.dt.value = 0;
			this.renderFrame( 0 );
			this.disasters.refresh(false);
			this.chairlift?.ui?.update(0);
			return;

		}
		const complete = () => {
			const ms = performance.now() - t0;
			this.simulationPacing.observe( ms, accepted, wallDt );
			this.cpuMs = this.cpuMs === undefined ? ms : this.cpuMs * 0.95 + ms * 0.05;
			this.simulationPending = false;
			for ( const change of this.simulationChanges?.splice(0) ?? [] ) change();
		};
		const accepted = this.warpTime( this.simulationPacing.step( dt, !!this.disasters && (this.disasters.field.events.size > 0 || !this.disasters.restored) ) );
		const pending = this._frame( accepted );
		if ( pending?.then ) { this.simulationPending = true; return pending.finally(complete); }
		complete();

	}

	deferSimulationChange( change ) {
		if ( ! this.simulationPending ) return false;
		( this.simulationChanges ??= [] ).push( change );
		return true;
	}

	_frame( dt ) {

		GPU.beginFrame();
		FrameUniforms.fields.frameIndex.value = GPU.frame;
		const s = this.settings;
		G.dt.value = dt;
		G.time.value += dt;
		s.timeOfDay = advanceClock( s.timeOfDay, s.timeSpeed, dt );

		// ---- player / boat (boat physics first so the cameras follow this frame's pose)
		if ( this.input.hit( 'KeyF' ) && ! this.aviation?.pilot && ! this.glider?.active && ! this.chairlift?.active ) this.setFreeCam( ! this.freeCam );
		// (in a car T repairs it instead, see src/rally/DriveHUD.js)
		if ( this.input.hit( 'KeyT' ) && ! this.rally?.active && ! this.aviation?.pilot && ! this.glider?.active && ! this.chairlift?.active ) this.toggleTime();
		// (at the ferry's helm L works her mooring lines instead, see src/ferry/FerryDeck.js)
		if ( this.input.hit( 'KeyL' ) && this.player.mode !== 'ferry-helm' && ! this.aviation?.pilot && ! this.glider?.active && ! this.chairlift?.active ) {

			const on = this.localLights.toggleFlashlight();
			if ( this.ui ) this.ui.ui.toast( on ? 'Flashlight on' : 'Flashlight off' );

		}

		if ( this.input.hit( 'KeyM' ) && this.audio ) {

			this.audio.setMuted( ! this.audio.muted );
			if ( this.ui ) this.ui.ui.toast( this.audio.muted ? 'Sound off' : 'Sound on' );

		}
		this.livestock?.update(dt);
		this.disasters?.before(dt);
		this.boatCtl.update( dt );
		this.boatSpray.update( dt );
		this.jetskis?.update( dt );
		this.wake.update( dt );
		// The ferry first: her deck's pose feeds the car physics as a moving platform.
		const ferryPending = this.ferry?.update( dt );
		if ( ferryPending ) return ferryPending.then( () => this.afterFerry( dt ) );
		return this.afterFerry( dt );
	}

	afterFerry( dt ) {
		if ( this.rally ) this.rally.update( dt );
		this.props?.update( dt );
		this.windfarm?.update( dt );
		this.aviation?.update( dt );
		this.glider?.update( dt );
		this.chairlift?.update( dt );
		if ( ! this.aviation?.active && ! this.glider?.active && ! this.chairlift?.active ) {

			if ( this.freeCam ) this.fly.update( dt );
			else if ( ! this.rally?.active && ! this.rally?.bailout.active ) this.player.update( dt );

		}
		this.aviation?.updateCamera( dt );
		this.glider?.updateCamera( dt );
		// the player's own character (src/player/Avatar.js): hidden in the car and at the helms
		if ( this.chairlift?.active ) this.chairlift.updateAvatar( dt );
		else this.player.updateAvatar( dt, { attached: ! this.freeCam, hidden: !! ( this.rally?.active || this.rally?.bailout.active || this.aviation?.active || this.glider?.active ) } );
		// The seated camera follows this frame's posed head, after pelvis placement.
		this.chairlift?.updateCamera( dt );
		this.game.update( dt );
		this.cockatoo?.update( dt );
		const pending = this.ragdollPool?.prepare( this.beach?.people ?? [], dt, this.disasters?.field );
		if ( pending ) return pending.then( () => this.finishFrame( dt ) );
		this.finishFrame( dt );
	}

	finishFrame( dt ) {
		this.beach?.update( dt );
		this.people?.update( dt );
		this.disasters?.after();
		this.evacuation?.update(dt);
		this.updateSun();

		this.atmosphere.update( dt, this.camera.position.y );
		this.applyAtmosphereReadback();

		// ---- water simulation
		this.fft.update( dt );
		this.seaDetail.update( dt );
		this.query.setCamera( this.camera.position.x, this.camera.position.z );
		this.boatCtl.queueQueries();
		this.query.update();
		if ( this.query.cpuValid ) {

			const h0 = this.query.cpu[ 0 ];
			const h = Number.isFinite( h0 ) ? h0 : ( this.cameraWaterHeight ?? 0 );
			G.cameraUnderwater.value = this.camera.position.y < h - LENS_REACH ? 1 : 0;
			G.cameraWaterHeight.value = h;
			this.cameraWaterHeight = h;

		}

		if ( this.caustics ) this.caustics.update();
		// drawn while any part of the view can be under water (the specks above the surface are dropped)
		this.marineSnow.update( this.camera, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) + LENS_REACH );
		this.airMotes.update( dt, this.camera, this.cameraWaterHeight ?? 0 );
		if ( this.shoreSim ) this.shoreSim.update();
		this.underwaterLighting.update( this.camera );
		this.breakers.update( this.camera );
		this.spray.update();
		if ( this.clouds ) this.clouds.update( dt, this.camera );
		this.environment.update( dt );

		// ---- world
		updateOceanDisplacementBounds( this.oceanLOD, this.disasters?.field.water, this.disasters?.field.outer, this.disasters?.field.farFieldBounds() ); // + tsunami outer ring; + the wall beyond it
		this.oceanLOD.update( this.camera );
		this.terrain.update( this.camera );
		this.rocks.update( this.camera );
		this.debris.update( this.camera );
		this.reef.update( dt, this.camera.position );
		this.village.update( dt );
		this.joeyVillage?.update( this.camera ); // hides the Joey village and its keepers from far off
		if ( this.vegetation ) this.vegetation.update( dt, this.camera );
		if ( this.whale ) this.whale.update( dt, this.camera );
		if ( this.dolphins ) this.dolphins.update( dt, this.camera );
		this.sharks?.update( dt, this.camera );
		this.boat.update( dt );
		this.wildlife.update( dt, this.camera, ( this.freeCam || this.aviation?.active || this.glider?.active || this.chairlift?.active ) ? null : this.player );
		this.localLights.update( this.camera, dt );

		this.renderFrame( dt );

	}

	renderFrame( dt ) {

		G.exposure.value = this.settings.exposure;
		updateCameraVelocity( this.camera );
		this.post.lens.update( dt, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) );
		if ( this.post.flare ) {

			this.post.flare.setDepthHeight( this.sceneRenderer.sceneRT.height );
			this.post.flare.update( this.camera, dt, { aboveWater: this.camera.position.y > ( this.cameraWaterHeight ?? 0 ) - 0.02 } );

		}

		// the post chain sets the TAAU jitter + internal size and writes the camera into the frame
		// uniforms (setFrameCamera); shadows then render with this frame's sun and camera
		this.post.beginFrame();
		this.underwater.updateCamera( this.camera );
		// ---- L6 perf: pose the scene graph once for every pass of this frame (src/engine/render/ScenePose.js).
		// The simulation and the camera are final here; the passes below skip their own whole-scene update.
		poseScene( this.scene );
		// ---- end L6 perf
		this.shadows.render( this.scene, this.engine.meshRenderer, this.shadows.update( this.camera, G.sunDir.value, this.scene ) );
		this.sceneRenderer.render();
		if ( this.post.flare ) this.post.flare.kernel.dispatch( 1 );
		this.post.render();
		this.post.endFrame();
		GPU.submit();
		commitGeometryMotion();
		this.profiler.update( dt );

		this.updateAudio( dt );
		if ( this.ui ) this.ui.update( dt );
		this.input.endFrame();

	}

	// One ambient wind state for waves, foliage and every coupled physics model.
	setAmbientWind( speed, direction ) {

		if ( ! Number.isFinite( speed ) || speed < 0 || speed > 60 ) throw new RangeError( 'Ambient wind must be between 0 and 60 m/s' );
		if ( ! Number.isFinite( direction ) ) throw new RangeError( 'Wind direction must be finite' );
		if ( this.deferSimulationChange( () => this.setAmbientWind( speed, direction ) ) ) return;
		const degrees = ( ( direction % 360 ) + 360 ) % 360;
		this.fft.local.windSpeed = speed;
		this.fft.local.windDirection = degrees;
		this.fft.updateSpectrumUniforms();
		const radians = degrees * Math.PI / 180;
		G.windDir.value.set( Math.cos( radians ), Math.sin( radians ) );
		G.windSpeed.value = speed;
		if ( this.ui ) {

			this.ui.s.wind = speed;
			this.ui.s.windDir = degrees;
			this.ui.ui.refresh();

		}

	}

	// Internal render resolution relative to the output (0.5..1), set by hand: changing it re-creates
	// the scene / post / cloud targets, so nothing adjusts it automatically.
	setRenderScale( v ) {

		const scale = MathUtils.clamp( Math.round( v * 20 ) / 20, 0.5, 1 );
		this.settings.renderScale = scale;
		this.post.setScale( scale );
		if ( this.clouds ) this.clouds.resolutionScale = scale;

	}

	updateAudio( dt ) {

		if ( ! this.audio || ! this.audio.enabled ) return;
		const cam = this.camera;
		const p = cam.position;
		const f = this._af || ( this._af = { fwd: new Vector3(), up: new Vector3() } );
		cam.getWorldDirection( f.fwd );
		f.up.set( 0, 1, 0 ).applyQuaternion( cam.quaternion );
		const h = this.cameraWaterHeight ?? 0;
		const coast = this.terrainData.coastDistance( p.x, p.z ).d;
		this.audio.update( dt, {
			listener: { position: p, forward: f.fwd, up: f.up },
			underwater: p.y < h ? 1 : 0,
			depthBelowSurface: Math.max( 0, h - p.y ),
			surfIntensity: Math.min( 1, this.shore.amplitude.value / 0.6 ),
			distanceToShore: Math.abs( coast ),
			coastDistance: coast,
			waveHeight: this.shore.amplitude.value * 2,
			windSpeed: G.windSpeed.value,
			windDir: G.windDir.value,
			daylight: 1 - G.night.value,
			nearPier: Math.abs( p.x - WORLD.pier.x ) < 12 && p.z > WORLD.pier.zStart - 5 && p.z < WORLD.pier.zEnd + 8,
			boat: {
				active: this.boatCtl.driven, rpm: this.boatCtl.rpm, throttle: this.boatCtl.throttle, speed: this.boatCtl.velocity.length(),
				position: this.boat.group.position, listenerInside: this.player.mode === 'boat' && this.player.camMode === 'first',
			},
			jetski: this.jetskis?.audioState() || null,
		} );

	}

}
