# Porting Tidewater from three.js/TSL to raw WebGPU + WGSL

Branch `webgpu-native`. Goal: no `three` import anywhere in `src/`, same look and behaviour as `main`.
Use the original Three.js shaders and scene as the reference for the WebGPU port.
Don't simplify effects away. If something can't be ported 1:1, write down why in the file.

## Engine (src/engine)

CPU side, three-compatible (`import * as THREE from '../engine/index.js'` works as a stopgap, but prefer
named imports): math (Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Frustum, Ray,
Spherical, MathUtils, CatmullRomCurve3, ShapeUtils, Timer, DataUtils), scene (Object3D, Group, Scene, Mesh,
InstancedMesh, PerspectiveCamera, OrthographicCamera, Layers), geometry (BufferGeometry, all attribute
classes, Plane/Box/Sphere/Cylinder/Cone/Circle/Torus/Lathe/Icosahedron/Tube/RoundedBox geometries,
mergeGeometries/mergeVertices). Cameras use reversed-Z WebGPU projections (depth 1 at near, 0 at far).

GPU side, `src/engine/webgpu.js`:

| three / TSL | engine |
|---|---|
| `renderer`, `renderer.backend.device` | `GPU` singleton: `GPU.device`, `GPU.queue`, `GPU.getEncoder()`, `GPU.submit()` |
| `uniform( v )`, `uniformArray` | `UniformBlock( 'StructName', { name: [ 'vec3f', value ], arr: [ 'vec4f[8]', [...] ] } )`; `block.fields.name.value` is the three-style `{ value }` handle |
| `G.*` (core/Globals.js) | `G` from `render/Frame.js` — same names; in WGSL `frame.sunDir`, `frame.time`, … |
| camera nodes (`cameraPosition`, `cameraProjectionMatrix`, …) | `frame.cameraPos`, `frame.view`, `frame.proj`, `frame.viewProj` (jittered), `frame.viewProjNoJitter`, `frame.prevViewProjNoJitter`, `frame.invViewProj`, `frame.near`, `frame.far`, `frame.resolution` |
| `instancedArray`, `StorageBufferAttribute` | `StorageBuffer( { count, type: 'vec4f' } )` |
| `DataTexture`, `StorageTexture`, `StorageArrayTexture`, `Data3DTexture`, `RenderTarget` | `Texture( { width, height, depth, dimension, format, mips, usage: [ 'sample', 'storage', 'render', 'copySrc', 'copyDst' ], data } )`, `RenderTarget( w, h, { colors, depth } )` |
| `Fn( … )().compute( n )`, `renderer.compute()` | `ComputeKernel( { modules, bindings, code, workgroupSize } )`, `kernel.dispatch( groups )` (records into the frame encoder) |
| TSL helper functions shared between systems | `ShaderModule( { name, deps, code, bindings, uniforms } )` (see below) |
| `NodeMaterial` / `MeshStandardNodeMaterial` / `SceneMaterial` / `MeshBasicNodeMaterial` | `Material( { vertex, surface, output, uniforms, textures, storage, varyings, attributes, … } )` — see the header of `render/Material.js` |
| `positionNode` (local) | `vertex` snippet: `v.position`, `v.normal`, `v.worldOffset`, or `v.useWorld = true; v.worldPos = …` |
| `colorNode`, `roughnessNode`, `normalNode`, `aoNode`, `emissiveNode`, `opacityNode`, `maskNode` | `surface` snippet writing `s.albedo`, `s.roughness`, `s.normal` (world space!), `s.ao`, `s.emissive`, `s.alpha` (+ `alphaTest`) |
| `outputNode`, `mrtNode` | `output` snippet: `r.color`, `r.velocity`, `r.mask` |
| `material.translucencyNode` | `s.translucency` (vec3, multiplied by the light colour) |
| `SceneLighting.directModulation` etc. | `SceneLighting.set( 'directModulation', module )` with `fn hookDirectModulation( P, N ) -> vec3f` — see `render/wgsl/lighting.js` |
| `material.underwaterLighting`, `appliesHillShadow`, `localLightsCheap` | same material options; hooks read them as defines `UNDERWATER_LIGHTING` (0/1/2), `HILL_SHADOW_SELF`, `LOCAL_LIGHTS_CHEAP` |
| `useStaticVelocity( obj )` | `obj.staticVelocity = true` (per object; previous model matrix = current) |
| CSM / `SoftCSMShadowNode` | `SunShadows` (render/Shadows.js); receivers sample `sunShadow( P, N, pixel )` automatically in `shadeSurface` |
| post passes (`rtt`, `pass`, QuadMesh) | `FullscreenPass( { code, bindings, colorFormats } )`, or a compute kernel |
| `renderer.render( scene, camera )` into a target | `meshRenderer.render( scene, { camera, kind: 'color', colorViews, colorFormats, depthView, … } )` |
| `GLTFLoader` + `SkinnedMesh` / `AnimationMixer` | `loadGLB( url )` (engine/loaders/GLTF.js) + `SkinnedModel.create( gltf )` (engine/render/Skinning.js): `model.group`, `model.play( clip, { fade, loop, speed } )`, `model.update( dt )`; GPU skinning in the material vertex hook (attributes `skinIndex` vec4u / `skinWeight` vec4f, joints in a storage buffer with last frame's joints for the motion vectors; a model drawn with no `update()` since its last drawn frame holds on its own, so animation LOD skips and frozen bodies read as still and need no `hold()`), shadows skin the same way |
| async readback (`getArrayBufferAsync`) | `Readback` (ring of staging buffers), `readBuffer` / `readTexture` for one-offs |
| `mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_vec2`, `mx_cell_noise_float`, `hash`, `interleavedGradientNoise`, `vogelDiskSample`, `luminance`, `perturbNormal` | `commonModule` (render/wgsl/common.js): `mx_noise_float3/2`, `mx_fractal_noise_float3`, `mx_worley_noise_vec2_3/2`, `mx_cell_noise_float3/2`, `hash11/21/31/22/33`, `interleavedGradientNoise`, `vogelDiskSample`, `luminance`, `perturbNormalByHeight`, `perturbNormalByMap`, depth helpers `viewDepth`, `worldFromDepth`, `projectToUv` |

Bind groups: group 0 = `frame` + shared samplers (`smpLinearRepeat`, `smpLinearClamp`, `smpLinearMirror`,
`smpAnisoRepeat`, `smpAnisoClamp`, `smpNearestClamp`, `smpNearestRepeat`, `smpShadow`) — use these instead of
per-texture samplers. Group 1 = module + material resources (composed automatically). Group 2 = per-draw.

Velocity convention (sceneRT.textures[1]): xy = uv-space motion, current minus previous (uv y down).

Depth: reversed-Z, `depth32float`, cleared to 0; sky pixels have depth 0. Linear distance: `viewDepth( d )`.

## Shared WGSL between systems: ShaderModule naming

Where a system used to hand other systems TSL functions (`terrainGPU.heightAt( xz )`, `clouds.shadow( xz )`,
`shoreSim.sample( xz )`, …), its instance now exposes `this.module` (a `ShaderModule`) and the WGSL function
is named `<prefix><Method>` with the prefix below. Structs are `<Prefix><Name>`, bindings and uniform blocks
are prefixed the same way (bindings share one namespace per shader). Return a struct where TSL returned an
object (`shore.evaluate` → `fn shoreEvaluate( … ) -> ShoreSample`). Document the module's functions in a
comment at the top of the file.

| instance | prefix | examples |
|---|---|---|
| TerrainGPU | `terrain` | `terrainHeightAt( xz: vec2f ) -> f32`, `terrainSunShadowAt( P: vec3f ) -> f32`, `terrainNormalAt`, `terrainNormalRock`, `terrainShoreSample`, `terrainUvOf` |
| OceanFFT | `ocean` | bindings `oceanDisplacement`, `oceanDerivatives` (texture_2d_array), uniforms `oceanParams` |
| WaterSurface | `waterSurface` | `waterSurfaceCascadeAttenuation( c: i32, depth: f32 ) -> f32`, `waterSurfaceVertex` |
| ShoreWaves | `shore` | `shoreEvaluate`, `shorePhaseAt`, `shoreShape`, `shoreDirAt`, … |
| ShoreSim | `shoreSim` | `shoreSimSample( xz ) -> vec4f`, `shoreSimInside`, `shoreSimUvOf`, `shoreSimSandFoam` |
| SurfFoam | `surfFoam` | `surfFoamShading` |
| Caustics | `caustics` | `causticsSample` |
| SeaDetail | `seaDetail` | `seaDetailSample` |
| WakeSim | `wake` | `wakeDisplacement` |
| WaterQuery | `waterQuery` | `waterQueryCameraState() -> vec4f`, `waterQueryHeightAt( slot: u32 ) -> f32` |
| Spray | `spray` | `sprayEmit…` (GPU emitters used by other kernels) |
| Atmosphere | `atmosphere` | `atmosphereSkyLuminance`, transmittance / sky-view LUT bindings |
| Sky | `sky` | `skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f`, `skyReflectionRadiance` |
| Clouds | `clouds` | `cloudsShadow( xz: vec2f ) -> f32`, `cloudsSample`, `cloudsSampleView` |
| Underwater | `underwater` | |
| LocalLights | `localLights` | installs the `localLights` hook |

If you consume a module owned by another stream that isn't ported yet, call it by the name above and stub it
in your test harness. Keep the constructor signatures and public CPU methods of every class the same, so
App.js ports by changing imports.

## WGSL pitfalls

- Derivatives (`dpdx`, `textureSample` without `Level`) only in uniform control flow: compute them before any
  branch on per-pixel data; inside branches use `textureSampleLevel` / `textureSampleGrad`.
- Uniform arrays need 16-byte element stride: use `vec4f[N]` and index `.x`.
- `queue.writeBuffer` data lands before the whole frame's command buffer: a buffer written twice in a frame
  keeps the last value. Give each pass that needs different values its own block (e.g. `createViewUniforms`).
- `r32float` / `rgba32float` are only filterable when `GPU.hasFloat32Filterable`; prefer `rgba16float` or
  `textureLoad` for 32-bit data.
- Storage textures: `rgba16float`, `rgba32float`, `r32float`, `rgba8unorm`, `r32uint` … are fine; `rg16float`
  as storage is not core WebGPU.
- Keep sampled textures per material under ~16 (the limit we request is 32, but fewer is faster).

## Testing

Headless WebGPU (Dawn): `import './headless.mjs'` first in a test (see `test/engine-smoke.mjs`), then
`GPU.init( { headless: true } )`; write images with `writePNG` and look at them. Compare the native output with the reference shaders at the same camera pose.

### TAA thin-feature lock and particle motion (2026-09-27)

- `src/post/TemporalUpscale.js`: the thin-feature lock (unclipped history on high-contrast pixels) now applies only to surfaces with no motion of their own. `taauCameraMotion()` rebuilds the motion the camera alone would give the opaque surface at the dilated tap (depth -> world with `frame.invViewProj`, reprojected with `viewProjNoJitter` / `prevViewProjNoJitter`). The lock is scaled by `1 - smoothstep(0.25, 1.0, |own motion| px)`, or `smoothstep(0.04, 0.2)` on skinned surfaces. Static wires, masts and wind-swayed foliage keep the lock, because their motion vectors carry only the camera's motion.
- `src/engine/render/MeshShader.js`: the velocity target's `.z` is 1 on skinned meshes (geometry with a `skinIndex` attribute, `DEFORMING_F`) and 0 elsewhere. The late pass blends it premultiplied like `.xy`. Nothing else reads `.z`.
- `VELOCITY_COVERAGE` (material define, set on `Spray`): a blended particle claims the pixel's motion only as it becomes opaque (`smoothstep(0.4, 0.9, alpha)`), not linearly with alpha. Faint spray keeps the hull's or rider's motion under it. The rocket flame (`Jetski.js`, additive cones, `velocityWeight` 1) does not use it.

## Image quality rounds 1 and 2 (2026-09-27)

Round 1 (engine-aa):
- Specular anti-aliasing (`src/engine/render/wgsl/lighting.js`, `specularAntiAlias`): GGX roughness is widened by the screen-space normal variance, so thin highlights stop sparkling as white specks under the TAA jitter.
- Near motion-blur cap (`src/post/MotionBlur.js`): streaks on surfaces close to the camera are capped, so the player and the boat you stand on no longer smear.
- LODFade threshold (`src/materials/LODFade.js`, `bayer4`): interleaved gradient noise moved every frame replaced the Bayer 4x4 on a 16-frame cycle; the TAA kept the regular grid, which read as stippled foliage edges.
- Lens flare toned down.
- Default render scale stays 100% (`App.js` `settings.renderScale = 1`): measured at scale 1 and 0.5 (`engine-aa/b1.log`, `b05.log`, `a1.log`, `a05.log`); half scale leaves the upscaler too little to reconstruct thin features.
- Ruled out as the player flicker (60 still frames on his pixels, full sun): shadows, AO, motion blur, shadow-pose timing and the skinned auto-hold.

Round 2 (engine-aa2):
- Retina: the canvas renders at `devicePixelRatio`, capped at 2 (`src/engine/ResolutionGovernor.js`, created by `Engine`). Settings > Performance > Resolution: Auto (Retina, default), Retina, Standard, kept in localStorage. Auto watches the rAF interval over a 3 s window: a median over 18 ms steps down (DPR 2, 1.5, 1, then render scale 85% and 70%, never above the slider); 12 s of good frames tries one level up, and a level that fails again doubles that wait (no flip-flop). A DPR step resizes the output (the TAA restarts). A scale step goes through `onScale` and keeps the TAA history: the history is at output size, and the previous-depth and cloud-mask copies are read by uv, so they follow the new render size after that frame's resolve (`src/post/TemporalUpscale.js` render()). It used to cut the camera, so every step under the tsunami spike threw the history away (on the tValley forest during a tsunami, a 1 -> 0.75 step restarted the history on the step frame before, and restarts nothing now, either direction). The `?stats` overlay shows the level (`res`).
- Free camera: no motion blur (`MotionBlur.freeCamera`, set by `App.setFreeCam`); the shutter comes back when it ends.
- Player "shadow flicker" (dappled palm, banana and canopy shade, third person): with the idle animation frozen his per-pixel variance falls by about 60%, and with the wind frozen his frame-to-frame change falls by about 30%; turning shadows off makes his pixels noisier, not calmer (direct sun on the moving body). Two candidate fixes were built and rejected on same-run A/B numbers: a world-anchored, still dither in shadow maps (no measurable change on him or the frame), and stepping the shadow sun while the clock runs (helps him, but triples whole-frame static flicker). Numbers: `engine-aa2/ab.log`, `sun.log`, `sun2.log`.
