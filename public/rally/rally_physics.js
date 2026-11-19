/* @ts-self-types="./rally_physics.d.ts" */

export class RallyPhysics {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RallyPhysicsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rallyphysics_free(ptr, 0);
    }
    /**
     * Each record is centre xyz, half-extents xyz, yaw, surface friction; all wood (piers, boardwalks).
     * @param {Float32Array} boxes
     */
    add_boxes(boxes) {
        const ptr0 = passArrayF32ToWasm0(boxes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.rallyphysics_add_boxes(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Each record is x, z, radius, bottom, top: rocks, posts, piles, trunks.
     * @param {Float32Array} cylinders
     */
    add_cylinders(cylinders) {
        const ptr0 = passArrayF32ToWasm0(cylinders, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.rallyphysics_add_cylinders(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * A moving platform the game drives (the ferry's vehicle deck, its ramp): boxes in the
     * platform's own frame (centre xyz, half-extents xyz, yaw, friction) on one kinematic body
     * with its centre of mass at its origin. Replaces any platform with the same id.
     * @param {number} id
     * @param {Float32Array} boxes
     * @returns {boolean}
     */
    add_platform(id, boxes) {
        const ptr0 = passArrayF32ToWasm0(boxes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_add_platform(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * As `add_platform`, each record centre xyz, half-extents xyz, yaw, pitch, friction: the
     * box turns by yaw about its Y and then by pitch about its own X (a ramp sloping along Z).
     * @param {number} id
     * @param {Float32Array} boxes
     * @returns {boolean}
     */
    add_platform_pitched(id, boxes) {
        const ptr0 = passArrayF32ToWasm0(boxes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_add_platform_pitched(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Static connection frame without a duplicate collider. IDs share prop namespace.
     * @param {number} id
     * @param {Float32Array} pose
     * @returns {boolean}
     */
    add_structure_anchor(id, pose) {
        const ptr0 = passArrayF32ToWasm0(pose, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_add_structure_anchor(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Connection parameters: point compliance m/N, angular compliance rad/(N m),
     * force capacity N, moment capacity N m, dissipative relaxation rate s^-1.
     * @param {number} id
     * @param {number} a
     * @param {number} b
     * @param {Float32Array} anchor
     * @param {Float32Array} parameters
     * @returns {boolean}
     */
    add_structure_joint(id, a, b, anchor, parameters) {
        const ptr0 = passArrayF32ToWasm0(anchor, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(parameters, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_add_structure_joint(this.__wbg_ptr, id, a, b, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * As `add_boxes`, with a surface code per record (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel,
     * 5 wood, 7 wet sand): a terminal's paved lanes read as asphalt, its boardwalks as wood.
     * Records past the end of `surfaces`, or with an unknown code, are wood.
     * @param {Float32Array} boxes
     * @param {Uint8Array} surfaces
     */
    add_surface_boxes(boxes, surfaces) {
        const ptr0 = passArrayF32ToWasm0(boxes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(surfaces, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.rallyphysics_add_surface_boxes(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * Runs the fixed steps owed for `seconds` and returns how many ran.
     * @param {number} seconds
     * @param {number} throttle
     * @param {number} brake
     * @param {number} steer
     * @param {number} handbrake
     * @returns {number}
     */
    advance(seconds, throttle, brake, steer, handbrake) {
        const ret = wasm.rallyphysics_advance(this.__wbg_ptr, seconds, throttle, brake, steer, handbrake);
        return ret >>> 0;
    }
    /**
     * Equal-and-opposite contact impulse in N s at a world point. This changes
     * both linear and angular momentum; no persistent force is left behind.
     * @param {number} id
     * @param {Float32Array} value
     * @param {Float32Array} point
     * @returns {boolean}
     */
    apply_prop_impulse(id, value, point) {
        const ptr0 = passArrayF32ToWasm0(value, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(point, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_apply_prop_impulse(this.__wbg_ptr, id, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Render interpolation. Whole fixed steps run per call, so a display frame can get zero,
     * one or two steps and a car drawn at the latest step judders in proportion to its speed.
     * Returns the pose before the latest step (position xyz, rotation xyzw) and alpha, the
     * unsimulated remainder as a fraction of a step: draw the car at lerp/slerp(previous,
     * snapshot pose, alpha) and it moves evenly whatever the frame times (one step behind).
     * @returns {Float32Array}
     */
    blend() {
        const ret = wasm.rallyphysics_blend(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Rebuild only exported island colliders after structural failure. Terrain, vehicles,
     * dynamic debris and ferry platforms are deliberately kept in the same solver world.
     */
    clear_island_statics() {
        wasm.rallyphysics_clear_island_statics(this.__wbg_ptr);
    }
    /**
     * Exact car rigid-body snapshot: position3, quaternion4, linear3, angular3.
     * @returns {Float32Array}
     */
    disaster_car_state() {
        const ret = wasm.rallyphysics_disaster_car_state(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Contact-point velocity (m/s) and inverse effective mass (1/kg), including
     * the actual body's rotational inertia. Empty for non-dynamic/invalid bodies.
     * @param {number} id
     * @param {Float32Array} point
     * @param {Float32Array} normal
     * @returns {Float32Array}
     */
    disaster_contact(id, point, normal) {
        const ptr0 = passArrayF32ToWasm0(point, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(normal, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_disaster_contact(this.__wbg_ptr, id, ptr0, len0, ptr1, len1);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * Actual body positions and linear velocities for relative-fluid loads / observation.
     * @returns {Float32Array}
     */
    disaster_motion() {
        const ret = wasm.rallyphysics_disaster_motion(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Ground support from solved upward contact normals, propagated through stacks.
     * Proximity to terrain alone never makes a floating/airborne body supported.
     * @returns {Float32Array}
     */
    disaster_supported() {
        const ret = wasm.rallyphysics_disaster_supported(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    constructor() {
        const ret = wasm.rallyphysics_new();
        this.__wbg_ptr = ret >>> 0;
        RallyPhysicsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Number of awake props (loose and breakable).
     * @returns {number}
     */
    prop_count() {
        const ret = wasm.rallyphysics_prop_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Awake props in one Float32Array, PROP_RECORD floats each: id, position xyz, rotation xyzw,
     * then for a loose prop its speed (m/s, linear plus angular at 0.3 m) and 1 if Avian has it
     * asleep (else 0); for a breakable, the fastest thing touching it (m/s) and 2 while untouched,
     * 3 while touched.
     * @returns {Float32Array}
     */
    prop_poses() {
        const ret = wasm.rallyphysics_prop_poses(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Whether a solved solid prop contact opposes the requested horizontal movement.
     * Following lag without contact must never restrain the renderer's walking controller.
     * @param {number} dx
     * @param {number} dz
     * @returns {boolean}
     */
    pusher_blocked(dx, dz) {
        const ret = wasm.rallyphysics_pusher_blocked(this.__wbg_ptr, dx, dz);
        return ret !== 0;
    }
    /**
     * The walker's body now (feet xyz), empty when there is none. Only an opposing
     * `pusher_blocked` contact should hold the walking controller within reach of it.
     * @returns {Float32Array}
     */
    pusher_position() {
        const ret = wasm.rallyphysics_pusher_position(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} id
     */
    remove_platform(id) {
        wasm.rallyphysics_remove_platform(this.__wbg_ptr, id);
    }
    /**
     * @param {number} id
     */
    remove_remote(id) {
        wasm.rallyphysics_remove_remote(this.__wbg_ptr, id);
    }
    /**
     * @param {number} id
     * @returns {boolean}
     */
    remove_structure_anchor(id) {
        const ret = wasm.rallyphysics_remove_structure_anchor(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * @param {number} id
     * @returns {boolean}
     */
    remove_structure_joint(id) {
        const ret = wasm.rallyphysics_remove_structure_joint(this.__wbg_ptr, id);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} yaw
     */
    reset(x, y, z, yaw) {
        wasm.rallyphysics_reset(this.__wbg_ptr, x, y, z, yaw);
    }
    /**
     * @param {Float32Array} state
     * @returns {boolean}
     */
    restore_disaster_car(state) {
        const ptr0 = passArrayF32ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_restore_disaster_car(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Switch physical bodies; world collisions and existing tracks remain.
     * @param {number} kind
     * @returns {boolean}
     */
    select_vehicle(kind) {
        const ret = wasm.rallyphysics_select_vehicle(this.__wbg_ptr, kind);
        return ret !== 0;
    }
    /**
     * Traction and stability control on (default) or off for drivers who want to slide.
     * @param {boolean} on
     */
    set_assists(on) {
        wasm.rallyphysics_set_assists(this.__wbg_ptr, on);
    }
    /**
     * Mechanical damage from the renderer's damage model: engine power left 0..1, steering
     * pull (rad), then per wheel (snapshot order: 0 front -X, 1 front +X, 2 rear -X, 3 rear +X) toe (rad), spring strength
     * left 0..1 and detached (non-zero). Non-finite values are ignored.
     * @param {number} engine
     * @param {number} pull
     * @param {Float32Array} wheels
     * @returns {boolean}
     */
    set_damage(engine, pull, wheels) {
        const ptr0 = passArrayF32ToWasm0(wheels, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_damage(this.__wbg_ptr, engine, pull, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Records: id (-1 = local car), force xyz in N, torque xyz in Nm. Replaces previous
     * loads, so stop cannot leave a stale force. Bad batches are rejected atomically.
     * @param {Float32Array} data
     * @returns {boolean}
     */
    set_disaster_loads(data) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_disaster_loads(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Air velocity xyz and horizontal current xz, m/s. Invalid batches leave the
     * previous valid fluid sample unchanged; the zero default preserves old callers.
     * @param {number} air_x
     * @param {number} air_y
     * @param {number} air_z
     * @param {number} current_x
     * @param {number} current_z
     * @returns {boolean}
     */
    set_fluid_velocity(air_x, air_y, air_z, current_x, current_z) {
        const ret = wasm.rallyphysics_set_fluid_velocity(this.__wbg_ptr, air_x, air_y, air_z, current_x, current_z);
        return ret !== 0;
    }
    /**
     * Sets how many fixed steps one `advance` may run, clamped to 1..=CATCH_UP_MAX_STEPS.
     * SimulationPacing passes DISASTER_MAX_STEPS while a disaster runs, else CATCH_UP_MAX_STEPS.
     * @param {number} steps
     */
    set_max_steps(steps) {
        wasm.rallyphysics_set_max_steps(this.__wbg_ptr, steps);
    }
    /**
     * The platform's pose and motion for the coming steps: position xyz, rotation xyzw,
     * linear velocity xyz, angular velocity xyz (about its origin). The solver carries it
     * along that motion until the next call.
     * @param {number} id
     * @param {Float32Array} state
     * @returns {boolean}
     */
    set_platform(id, state) {
        const ptr0 = passArrayF32ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_platform(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {number} id
     * @param {Float32Array} value
     * @returns {boolean}
     */
    set_prop_angular_velocity(id, value) {
        const ptr0 = passArrayF32ToWasm0(value, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_prop_angular_velocity(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Give a released tree its crown: the stem box (`half`, metres) plus a sphere of radius
     * `crown_radius` centred `crown_y` metres up the body axis. The sphere is the crushed crown
     * that props a fallen top off the ground; without it the trunk lay flat and the crown mesh
     * sank into the terrain (flat frond starbursts and bare trunks). Call before
     * set_prop_mass_properties, which then fixes the declared mass whatever the shape.
     * @param {number} id
     * @param {Float32Array} half
     * @param {number} crown_y
     * @param {number} crown_radius
     * @returns {boolean}
     */
    set_prop_crown(id, half, crown_y, crown_radius) {
        const ptr0 = passArrayF32ToWasm0(half, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_prop_crown(this.__wbg_ptr, id, ptr0, len0, crown_y, crown_radius);
        return ret !== 0;
    }
    /**
     * Override a loose body's measured/assumed mass distribution without changing
     * its collision shape or authored pose. Principal moments are kg m² in the
     * existing body axes; centre is metres from that pose, not a world position.
     * A porous crown can carry mass without becoming a solid collision hull.
     * @param {number} id
     * @param {number} mass
     * @param {Float32Array} principal
     * @param {Float32Array} centre
     * @returns {boolean}
     */
    set_prop_mass_properties(id, mass, principal, centre) {
        const ptr0 = passArrayF32ToWasm0(principal, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(centre, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_prop_mass_properties(this.__wbg_ptr, id, mass, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * @param {number} id
     * @param {number} angular_damping
     * @param {number} max_angular_speed
     * @returns {boolean}
     */
    set_prop_motion_limits(id, angular_damping, max_angular_speed) {
        const ret = wasm.rallyphysics_set_prop_motion_limits(this.__wbg_ptr, id, angular_damping, max_angular_speed);
        return ret !== 0;
    }
    /**
     * A breakable that something slow is leaning on turns solid, so a car can nudge a fence
     * without passing through it; back to a sensor when nothing touches it.
     * @param {number} id
     * @param {boolean} solid
     * @returns {boolean}
     */
    set_prop_solid(id, solid) {
        const ret = wasm.rallyphysics_set_prop_solid(this.__wbg_ptr, id, solid);
        return ret !== 0;
    }
    /**
     * The walker on foot as an upright capsule (feet at y) that pushes props and only props: the
     * car, terrain and scenery never see it. It is a person-sized dynamic body chasing this pose
     * with a clamped force (`drive_pusher`); a jump of more than 1.5 m moves it there outright.
     * `active` false removes it (driving, riding, swimming).
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} vx
     * @param {number} vy
     * @param {number} vz
     * @param {number} radius
     * @param {number} height
     * @param {boolean} active
     */
    set_pusher(x, y, z, vx, vy, vz, radius, height, active) {
        wasm.rallyphysics_set_pusher(this.__wbg_ptr, x, y, z, vx, vy, vz, radius, height, active);
    }
    /**
     * The detachable RS wing changes the rear aero balance independently of wheel damage.
     * @param {boolean} attached
     */
    set_rear_wing(attached) {
        wasm.rallyphysics_set_rear_wing(this.__wbg_ptr, attached);
    }
    /**
     * @param {Float32Array} segments
     * @returns {boolean}
     */
    set_roads(segments) {
        const ptr0 = passArrayF32ToWasm0(segments, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_roads(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Terrain material per height texel: 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand.
     * @param {Uint8Array} codes
     * @returns {boolean}
     */
    set_surface_map(codes) {
        const ptr0 = passArray8ToWasm0(codes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_surface_map(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * The source is Tidewater's row-major (z then x) texel-centred height grid.
     * Avian passes flattened rows to a column-major matrix; Parry rows are Z.
     * Transpose here, keeping the exact original 1 m vertices and half-texel origin.
     * @param {Float32Array} heights
     * @param {number} resolution
     * @param {number} size
     * @param {number} origin
     * @returns {boolean}
     */
    set_terrain(heights, resolution, size, origin) {
        const ptr0 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_set_terrain(this.__wbg_ptr, ptr0, len0, resolution, size, origin);
        return ret !== 0;
    }
    /**
     * The sea surface near the car, fitted by the renderer to wave queries: height at
     * (x0, z0), slope along x and z, and vertical rate (m/s). Non-finite input disables it.
     * @param {number} height
     * @param {number} slope_x
     * @param {number} slope_z
     * @param {number} x0
     * @param {number} z0
     * @param {number} rate
     */
    set_water(height, slope_x, slope_z, x0, z0, rate) {
        wasm.rallyphysics_set_water(this.__wbg_ptr, height, slope_x, slope_z, x0, z0, rate);
    }
    /**
     * Put a prop back to sleep: its body goes, and the renderer keeps the last pose it read.
     * @param {number} id
     * @returns {boolean}
     */
    sleep_prop(id) {
        const ret = wasm.rallyphysics_sleep_prop(this.__wbg_ptr, id);
        return ret !== 0;
    }
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
     * @returns {Float32Array}
     */
    snapshot() {
        const ret = wasm.rallyphysics_snapshot(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Fifteen values: id, broken, force3 N, moment3 Nm, extension m, angle rad,
     * elastic energy J, fracture loss J, utilization, viscous loss J, geometric-minus-constitutive energy residual J.
     * @returns {Float32Array}
     */
    structure_joint_states() {
        const ret = wasm.rallyphysics_structure_joint_states(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Hard hits on the body since the last call, each as car-local point xyz, car-local push
     * direction xyz, severity (change in velocity, m/s) and 1 if it hit scenery (0 another car).
     * @returns {Float32Array}
     */
    take_impacts() {
        const ret = wasm.rallyphysics_take_impacts(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Remote owner poses become kinematic bodies in the local collision world.
     * This enables contact without claiming a global server-authoritative solver.
     * The collider is only rebuilt when the remote driver changes vehicle.
     * @param {number} id
     * @param {number} kind
     * @param {Float32Array} state
     */
    update_remote(id, kind, state) {
        const ptr0 = passArrayF32ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.rallyphysics_update_remote(this.__wbg_ptr, id, kind, ptr0, len0);
    }
    /**
     * Wake a prop. `shape` 0 box (dims = half extents), 1 upright cylinder (radius, half height),
     * 2 upright capsule (radius, half height of the straight part); the shape is centred on the
     * pose. `state` is position xyz, rotation xyzw, then optional linear velocity xyz. Mass (kg)
     * sets the density; friction and bounce are per material. A breakable wakes as a static
     * sensor that reports hits instead of a loose body. Waking a prop already awake nudges it
     * out of Avian sleep (the walker is about to touch it) and returns true.
     * @param {number} id
     * @param {number} shape_kind
     * @param {Float32Array} dims
     * @param {Float32Array} state
     * @param {number} mass
     * @param {number} friction
     * @param {number} restitution
     * @param {boolean} breakable
     * @returns {boolean}
     */
    wake_prop(id, shape_kind, dims, state, mass, friction, restitution, breakable) {
        const ptr0 = passArrayF32ToWasm0(dims, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(state, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rallyphysics_wake_prop(this.__wbg_ptr, id, shape_kind, ptr0, len0, ptr1, len1, mass, friction, restitution, breakable);
        return ret !== 0;
    }
}
if (Symbol.dispose) RallyPhysics.prototype[Symbol.dispose] = RallyPhysics.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Window_151fb4790d4514b5: function(arg0) {
            const ret = arg0.Window;
            return ret;
        },
        __wbg_WorkerGlobalScope_eb408faae4074815: function(arg0) {
            const ret = arg0.WorkerGlobalScope;
            return ret;
        },
        __wbg___wbindgen_debug_string_5398f5bb970e0daa: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_3c846841762788c1: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_52709e72fb9f179c: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_395e606bd0ee4427: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_6b5b6b8576d35cb1: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_arrayBuffer_eb8e9ca620af2a19: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_fetch_7b84bc2cce4c9b65: function(arg0, arg1, arg2) {
            const ret = arg0.fetch(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_fetch_e261f234f8b50660: function(arg0, arg1, arg2) {
            const ret = arg0.fetch(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_getRandomValues_3dda8830c2565714: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_instanceof_Response_9b4d9fd451e051b1: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_23e677d2c6843922: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_ea16607d7b61445b: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_5f486cdf45a04d78: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_now_e7c6795a7f81e10f: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_performance_3fcf6e32a7e1ed0a: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_prototypesetcall_d62e5099504357e6: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_queueMicrotask_0c399741342fb10f: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_a082d78ce798393e: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_resolve_ae8d83246e5bcc12: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setTimeout_7f7035ad0b026458: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_f207c857566db248: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_318629ab93a22955: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_stringify_5ae93966a84901ac: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_then_098abe61755d12f6: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_then_9e335f6dd892bc11: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { dtor_idx: 43757, function: Function { arguments: [], shim_idx: 43758, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h44f5a62f65970bcf, wasm_bindgen__convert__closures_____invoke__h5dea0dda19e45b89);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { dtor_idx: 52282, function: Function { arguments: [Externref], shim_idx: 52283, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h5cefeeeb60d29d96, wasm_bindgen__convert__closures_____invoke__h460a035e5089bc90);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rally_physics_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h5dea0dda19e45b89(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__h5dea0dda19e45b89(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h460a035e5089bc90(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h460a035e5089bc90(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

const RallyPhysicsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rallyphysics_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.dtor(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rally_physics_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
