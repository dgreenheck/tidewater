/* tslint:disable */
/* eslint-disable */

export class RallyPhysics {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Each record is centre xyz, half-extents xyz, yaw, surface friction; all wood (piers, boardwalks).
     */
    add_boxes(boxes: Float32Array): void;
    /**
     * Each record is x, z, radius, bottom, top: rocks, posts, piles, trunks.
     */
    add_cylinders(cylinders: Float32Array): void;
    /**
     * A moving platform the game drives (the ferry's vehicle deck, its ramp): boxes in the
     * platform's own frame (centre xyz, half-extents xyz, yaw, friction) on one kinematic body
     * with its centre of mass at its origin. Replaces any platform with the same id.
     */
    add_platform(id: number, boxes: Float32Array): boolean;
    /**
     * As `add_platform`, each record centre xyz, half-extents xyz, yaw, pitch, friction: the
     * box turns by yaw about its Y and then by pitch about its own X (a ramp sloping along Z).
     */
    add_platform_pitched(id: number, boxes: Float32Array): boolean;
    /**
     * Static connection frame without a duplicate collider. IDs share prop namespace.
     */
    add_structure_anchor(id: number, pose: Float32Array): boolean;
    /**
     * Connection parameters: point compliance m/N, angular compliance rad/(N m),
     * force capacity N, moment capacity N m, dissipative relaxation rate s^-1.
     */
    add_structure_joint(id: number, a: number, b: number, anchor: Float32Array, parameters: Float32Array): boolean;
    /**
     * As `add_boxes`, with a surface code per record (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel,
     * 5 wood, 7 wet sand): a terminal's paved lanes read as asphalt, its boardwalks as wood.
     * Records past the end of `surfaces`, or with an unknown code, are wood.
     */
    add_surface_boxes(boxes: Float32Array, surfaces: Uint8Array): void;
    /**
     * Runs the fixed steps owed for `seconds` and returns how many ran.
     */
    advance(seconds: number, throttle: number, brake: number, steer: number, handbrake: number): number;
    /**
     * Equal-and-opposite contact impulse in N s at a world point. This changes
     * both linear and angular momentum; no persistent force is left behind.
     */
    apply_prop_impulse(id: number, value: Float32Array, point: Float32Array): boolean;
    /**
     * Render interpolation. Whole fixed steps run per call, so a display frame can get zero,
     * one or two steps and a car drawn at the latest step judders in proportion to its speed.
     * Returns the pose before the latest step (position xyz, rotation xyzw) and alpha, the
     * unsimulated remainder as a fraction of a step: draw the car at lerp/slerp(previous,
     * snapshot pose, alpha) and it moves evenly whatever the frame times (one step behind).
     */
    blend(): Float32Array;
    /**
     * Rebuild only exported island colliders after structural failure. Terrain, vehicles,
     * dynamic debris and ferry platforms are deliberately kept in the same solver world.
     */
    clear_island_statics(): void;
    /**
     * Exact car rigid-body snapshot: position3, quaternion4, linear3, angular3.
     */
    disaster_car_state(): Float32Array;
    /**
     * Contact-point velocity (m/s) and inverse effective mass (1/kg), including
     * the actual body's rotational inertia. Empty for non-dynamic/invalid bodies.
     */
    disaster_contact(id: number, point: Float32Array, normal: Float32Array): Float32Array;
    /**
     * Actual body positions and linear velocities for relative-fluid loads / observation.
     */
    disaster_motion(): Float32Array;
    /**
     * Ground support from solved upward contact normals, propagated through stacks.
     * Proximity to terrain alone never makes a floating/airborne body supported.
     */
    disaster_supported(): Float32Array;
    constructor();
    /**
     * Number of awake props (loose and breakable).
     */
    prop_count(): number;
    /**
     * Awake props in one Float32Array, PROP_RECORD floats each: id, position xyz, rotation xyzw,
     * then for a loose prop its speed (m/s, linear plus angular at 0.3 m) and 1 if Avian has it
     * asleep (else 0); for a breakable, the fastest thing touching it (m/s) and 2 while untouched,
     * 3 while touched.
     */
    prop_poses(): Float32Array;
    /**
     * Whether a solved solid prop contact opposes the requested horizontal movement.
     * Following lag without contact must never restrain the renderer's walking controller.
     */
    pusher_blocked(dx: number, dz: number): boolean;
    /**
     * The walker's body now (feet xyz), empty when there is none. Only an opposing
     * `pusher_blocked` contact should hold the walking controller within reach of it.
     */
    pusher_position(): Float32Array;
    remove_platform(id: number): void;
    remove_remote(id: number): void;
    remove_structure_anchor(id: number): boolean;
    remove_structure_joint(id: number): boolean;
    reset(x: number, y: number, z: number, yaw: number): void;
    restore_disaster_car(state: Float32Array): boolean;
    /**
     * Switch physical bodies; world collisions and existing tracks remain.
     */
    select_vehicle(kind: number): boolean;
    /**
     * Traction and stability control on (default) or off for drivers who want to slide.
     */
    set_assists(on: boolean): void;
    /**
     * Mechanical damage from the renderer's damage model: engine power left 0..1, steering
     * pull (rad), then per wheel (snapshot order: 0 front -X, 1 front +X, 2 rear -X, 3 rear +X) toe (rad), spring strength
     * left 0..1 and detached (non-zero). Non-finite values are ignored.
     */
    set_damage(engine: number, pull: number, wheels: Float32Array): boolean;
    /**
     * Records: id (-1 = local car), force xyz in N, torque xyz in Nm. Replaces previous
     * loads, so stop cannot leave a stale force. Bad batches are rejected atomically.
     */
    set_disaster_loads(data: Float32Array): boolean;
    /**
     * Air velocity xyz and horizontal current xz, m/s. Invalid batches leave the
     * previous valid fluid sample unchanged; the zero default preserves old callers.
     */
    set_fluid_velocity(air_x: number, air_y: number, air_z: number, current_x: number, current_z: number): boolean;
    /**
     * Sets how many fixed steps one `advance` may run, clamped to 1..=CATCH_UP_MAX_STEPS.
     * SimulationPacing passes DISASTER_MAX_STEPS while a disaster runs, else CATCH_UP_MAX_STEPS.
     */
    set_max_steps(steps: number): void;
    /**
     * The platform's pose and motion for the coming steps: position xyz, rotation xyzw,
     * linear velocity xyz, angular velocity xyz (about its origin). The solver carries it
     * along that motion until the next call.
     */
    set_platform(id: number, state: Float32Array): boolean;
    set_prop_angular_velocity(id: number, value: Float32Array): boolean;
    /**
     * Give a released tree its crown: the stem box (`half`, metres) plus a sphere of radius
     * `crown_radius` centred `crown_y` metres up the body axis. The sphere is the crushed crown
     * that props a fallen top off the ground; without it the trunk lay flat and the crown mesh
     * sank into the terrain (flat frond starbursts and bare trunks). Call before
     * set_prop_mass_properties, which then fixes the declared mass whatever the shape.
     */
    set_prop_crown(id: number, half: Float32Array, crown_y: number, crown_radius: number): boolean;
    /**
     * Override a loose body's measured/assumed mass distribution without changing
     * its collision shape or authored pose. Principal moments are kg m² in the
     * existing body axes; centre is metres from that pose, not a world position.
     * A porous crown can carry mass without becoming a solid collision hull.
     */
    set_prop_mass_properties(id: number, mass: number, principal: Float32Array, centre: Float32Array): boolean;
    set_prop_motion_limits(id: number, angular_damping: number, max_angular_speed: number): boolean;
    /**
     * A breakable that something slow is leaning on turns solid, so a car can nudge a fence
     * without passing through it; back to a sensor when nothing touches it.
     */
    set_prop_solid(id: number, solid: boolean): boolean;
    /**
     * The walker on foot as an upright capsule (feet at y) that pushes props and only props: the
     * car, terrain and scenery never see it. It is a person-sized dynamic body chasing this pose
     * with a clamped force (`drive_pusher`); a jump of more than 1.5 m moves it there outright.
     * `active` false removes it (driving, riding, swimming).
     */
    set_pusher(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, height: number, active: boolean): void;
    /**
     * The detachable RS wing changes the rear aero balance independently of wheel damage.
     */
    set_rear_wing(attached: boolean): void;
    set_roads(segments: Float32Array): boolean;
    /**
     * Terrain material per height texel: 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand.
     */
    set_surface_map(codes: Uint8Array): boolean;
    /**
     * The source is Tidewater's row-major (z then x) texel-centred height grid.
     * Avian passes flattened rows to a column-major matrix; Parry rows are Z.
     * Transpose here, keeping the exact original 1 m vertices and half-texel origin.
     */
    set_terrain(heights: Float32Array, resolution: number, size: number, origin: number): boolean;
    /**
     * The sea surface near the car, fitted by the renderer to wave queries: height at
     * (x0, z0), slope along x and z, and vertical rate (m/s). Non-finite input disables it.
     */
    set_water(height: number, slope_x: number, slope_z: number, x0: number, z0: number, rate: number): void;
    /**
     * Put a prop back to sleep: its body goes, and the renderer keeps the last pose it read.
     */
    sleep_prop(id: number): boolean;
    /**
     * Flat Float32Array, SNAPSHOT_LEN long:
     * 0-2 position, 3-6 rotation xyzw, 7 signed km/h, 8 gear (-1 R, 0 N, 1..), 9 engine rpm,
     * 10 loaded wheel contacts, 11 distance m, 12 mean slide 0..1;
     * 13 + w*4: suspension length, steer angle, wheel surface speed (omega * r), grounded;
     * 29 + w*10: contact point xyz, contact normal xyz, normal load N, slide 0..1,
     *   ground speed m/s, lateral contact speed m/s;
     * 69 throttle applied, 70 service brake, 71 steering angle, 72 handbrake, 73 submerged 0..1,
     * 74 traction or stability control active, 75 ABS active, 76 lateral g, 77 longitudinal g, 78 yaw rate,
     * 79 engine load, 80 shifting, 81 + w slip ratio, 85 + w slip angle, 89 + w surface code
     * (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel, 5 wood/prop, 6 water, 7 wet sand),
     * 93 sea height at the car (-1000 when none), 94 vertical speed, 95 speed through water.
     * Wheel order: 0 front at -X (the driver's right; the model names it WheelFrontL), 1 front
     * at +X, 2 rear at -X, 3 rear at +X.
     */
    snapshot(): Float32Array;
    /**
     * Fifteen values: id, broken, force3 N, moment3 Nm, extension m, angle rad,
     * elastic energy J, fracture loss J, utilization, viscous loss J, geometric-minus-constitutive energy residual J.
     */
    structure_joint_states(): Float32Array;
    /**
     * Hard hits on the body since the last call, each as car-local point xyz, car-local push
     * direction xyz, severity (change in velocity, m/s) and 1 if it hit scenery (0 another car).
     */
    take_impacts(): Float32Array;
    /**
     * Remote owner poses become kinematic bodies in the local collision world.
     * This enables contact without claiming a global server-authoritative solver.
     * The collider is only rebuilt when the remote driver changes vehicle.
     */
    update_remote(id: number, kind: number, state: Float32Array): void;
    /**
     * Wake a prop. `shape` 0 box (dims = half extents), 1 upright cylinder (radius, half height),
     * 2 upright capsule (radius, half height of the straight part); the shape is centred on the
     * pose. `state` is position xyz, rotation xyzw, then optional linear velocity xyz. Mass (kg)
     * sets the density; friction and bounce are per material. A breakable wakes as a static
     * sensor that reports hits instead of a loose body. Waking a prop already awake nudges it
     * out of Avian sleep (the walker is about to touch it) and returns true.
     */
    wake_prop(id: number, shape_kind: number, dims: Float32Array, state: Float32Array, mass: number, friction: number, restitution: number, breakable: boolean): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_rallyphysics_free: (a: number, b: number) => void;
    readonly rallyphysics_add_boxes: (a: number, b: number, c: number) => void;
    readonly rallyphysics_add_cylinders: (a: number, b: number, c: number) => void;
    readonly rallyphysics_add_platform: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_add_platform_pitched: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_add_structure_anchor: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_add_structure_joint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly rallyphysics_add_surface_boxes: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rallyphysics_advance: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly rallyphysics_apply_prop_impulse: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly rallyphysics_blend: (a: number) => [number, number];
    readonly rallyphysics_clear_island_statics: (a: number) => void;
    readonly rallyphysics_disaster_car_state: (a: number) => [number, number];
    readonly rallyphysics_disaster_contact: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly rallyphysics_disaster_motion: (a: number) => [number, number];
    readonly rallyphysics_disaster_supported: (a: number) => [number, number];
    readonly rallyphysics_new: () => number;
    readonly rallyphysics_prop_count: (a: number) => number;
    readonly rallyphysics_prop_poses: (a: number) => [number, number];
    readonly rallyphysics_pusher_blocked: (a: number, b: number, c: number) => number;
    readonly rallyphysics_pusher_position: (a: number) => [number, number];
    readonly rallyphysics_remove_platform: (a: number, b: number) => void;
    readonly rallyphysics_remove_remote: (a: number, b: number) => void;
    readonly rallyphysics_remove_structure_anchor: (a: number, b: number) => number;
    readonly rallyphysics_remove_structure_joint: (a: number, b: number) => number;
    readonly rallyphysics_reset: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rallyphysics_restore_disaster_car: (a: number, b: number, c: number) => number;
    readonly rallyphysics_select_vehicle: (a: number, b: number) => number;
    readonly rallyphysics_set_assists: (a: number, b: number) => void;
    readonly rallyphysics_set_damage: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly rallyphysics_set_disaster_loads: (a: number, b: number, c: number) => number;
    readonly rallyphysics_set_fluid_velocity: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly rallyphysics_set_max_steps: (a: number, b: number) => void;
    readonly rallyphysics_set_platform: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_set_prop_angular_velocity: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_set_prop_crown: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly rallyphysics_set_prop_mass_properties: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly rallyphysics_set_prop_motion_limits: (a: number, b: number, c: number, d: number) => number;
    readonly rallyphysics_set_prop_solid: (a: number, b: number, c: number) => number;
    readonly rallyphysics_set_pusher: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly rallyphysics_set_rear_wing: (a: number, b: number) => void;
    readonly rallyphysics_set_roads: (a: number, b: number, c: number) => number;
    readonly rallyphysics_set_surface_map: (a: number, b: number, c: number) => number;
    readonly rallyphysics_set_terrain: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly rallyphysics_set_water: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly rallyphysics_sleep_prop: (a: number, b: number) => number;
    readonly rallyphysics_snapshot: (a: number) => [number, number];
    readonly rallyphysics_structure_joint_states: (a: number) => [number, number];
    readonly rallyphysics_take_impacts: (a: number) => [number, number];
    readonly rallyphysics_update_remote: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly rallyphysics_wake_prop: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly wasm_bindgen__closure__destroy__h44f5a62f65970bcf: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h5cefeeeb60d29d96: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h460a035e5089bc90: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h5dea0dda19e45b89: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
