//! Headless Avian host for Tidewater's cars. Tidewater owns rendering; this module
//! owns the bodies, wheel contacts, water and all integration at 120 Hz with eight
//! solver substeps. The vehicle controller is in `controller.rs`.
#[allow(dead_code)] // Rally's gamepad/keyboard reader is unused in the browser
mod driving;
mod vehicle;
mod road;
mod controller;
mod fluid_loads;
mod props;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod contact_kernel_tests;

use avian3d::physics_transform::{PreSolveDeltaPosition, PreSolveDeltaRotation};
use avian3d::prelude::*;
use bevy::{prelude::*, mesh::MeshPlugin, time::TimeUpdateStrategy};
use controller::Car;
use driving::input::DriveIntent;
use road::{PropSurface, RoadSurfaces, Surface, TerrainMaterials, WaterPlane, FluidVelocity};
use vehicle::VehicleConfig;
use std::time::Duration;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

mod disasters;
mod structures;

const DT: f64 = 1.0 / 120.0;
/// Fixed steps one `advance` may run while a disaster is active: 3 x 1/120 s = 25 ms, so the
/// clock keeps real time down to 40 fps. The old 0.1 s clamp let a 10 fps frame run 12 steps of
/// 8 substeps each, which made the next frame slower still (the tornado death spiral, physics
/// 40-77 ms a frame). Below 40 fps SimulationPacing hands every system the same capped interval
/// while a disaster runs, so the game slows together instead of catching up
/// (docs/physics-performance.md). JS sets it with `set_max_steps` from SimulationPacing.
pub const DISASTER_MAX_STEPS: u32 = 3;
pub const CATCH_UP_MAX_STEPS: u32 = 12;
/// Static colliders are merged into one compound per square this many metres on a side.
const STATIC_CELL: f32 = 64.0;
/// Length of `snapshot()`; the layout is documented there.
pub const SNAPSHOT_LEN: usize = 96;

#[wasm_bindgen]
pub struct RallyPhysics {
    app: App,
    car: Entity,
    remainder: f64,
    /// Fixed steps one `advance` may run; see DISASTER_MAX_STEPS and CATCH_UP_MAX_STEPS.
    max_steps: u32,
    /// The car's pose (position xyz, rotation xyzw) before the latest fixed step, for `blend`.
    previous: [f32; 7],
    vehicle: u8,
    remotes: HashMap<u32,(Entity,u8)>,
    platforms: HashMap<u32,Entity>,
    /// Awake props by the renderer's id (props.rs); dormant ones have no body at all.
    props: HashMap<u32,Entity>,
    /// The walker's kinematic capsule while on foot (props.rs).
    pusher: Option<Entity>,
    anchors: HashMap<u32,Entity>,
    connections: std::collections::BTreeMap<u32,structures::Connection>,
}

impl Default for RallyPhysics { fn default() -> Self { Self::new() } }

impl RallyPhysics {
    fn pose(&self) -> [f32; 7] {
        let body = self.app.world().entity(self.car);
        let (p, q) = (body.get::<Position>().unwrap().0, body.get::<Rotation>().unwrap().0);
        [p.x,p.y,p.z,q.x,q.y,q.z,q.w]
    }
}

#[wasm_bindgen]
impl RallyPhysics {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut app = App::new();
        app.add_plugins((MinimalPlugins, TransformPlugin, AssetPlugin::default(),
            bevy::scene::ScenePlugin, MeshPlugin, PhysicsPlugins::default()))
            .insert_resource(Time::<Fixed>::from_hz(120.0))
            .insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(DT)))
            .insert_resource(SubstepCount(8))
            .insert_resource(Gravity(Vec3::NEG_Y * 9.81))
            .init_resource::<DriveIntent>()
            .init_resource::<VehicleConfig>()
            .init_resource::<RoadSurfaces>()
            .init_resource::<TerrainMaterials>()
            .init_resource::<WaterPlane>()
            .init_resource::<FluidVelocity>()
            .init_resource::<controller::Assists>()
            .init_resource::<controller::Damage>()
            .add_systems(FixedUpdate, ((controller::record_impacts,controller::drive_forces).chain(), props::drive_pusher));
        let car = app.world_mut().spawn((vehicle::bundle(&VehicleConfig::aster()), Transform::from_xyz(0.0, 100.0, 0.0))).id();
        app.finish();
        app.cleanup();
        app.update();
        Self { app, car, remainder: 0.0, max_steps: CATCH_UP_MAX_STEPS, previous: [0.0,100.0,0.0,0.0,0.0,0.0,1.0], vehicle: 0, remotes: HashMap::new(), platforms: HashMap::new(), props: HashMap::new(), pusher: None, anchors: HashMap::new(), connections: std::collections::BTreeMap::new() }
    }

    /// Switch physical bodies; world collisions and existing tracks remain.
    pub fn select_vehicle(&mut self, kind:u8)->bool {
        // L9 cars: kinds come from VehicleConfig::of (vehicle.rs); was `kind>1` before the item 7 cars.
        if kind>=VehicleConfig::COUNT { return false; }
        let config=VehicleConfig::of(kind);
        self.app.world_mut().despawn(self.car);
        self.car=self.app.world_mut().spawn((vehicle::bundle(&config),Transform::from_xyz(0.0,100.0,0.0))).id();
        self.app.insert_resource(config);
        self.vehicle=kind;
        self.reset(0.0,100.0,0.0,0.0);
        true
    }

    /// Remote owner poses become kinematic bodies in the local collision world.
    /// This enables contact without claiming a global server-authoritative solver.
    /// The collider is only rebuilt when the remote driver changes vehicle.
    pub fn update_remote(&mut self,id:u32,kind:u8,state:&[f32]) {
        if kind>=VehicleConfig::COUNT || state.len()<8 || state[..8].iter().any(|v| !v.is_finite()) { return; }
        let q=Quat::from_xyzw(state[3],state[4],state[5],state[6]);
        if q.length_squared()<0.5 { return; }
        let q=q.normalize();
        let p=Vec3::new(state[0],state[1],state[2]);
        let velocity=q*Vec3::Z*(state[7]/3.6);
        let world=self.app.world_mut();
        let entity=match self.remotes.get(&id) {
            Some(&(entity,old)) if old==kind => entity,
            existing => {
                if let Some(&(entity,_))=existing { world.despawn(entity); }
                let entity=world.spawn((RigidBody::Kinematic,VehicleConfig::of(kind).collider(),Friction::new(0.3),
                    Transform::from_translation(p).with_rotation(q))).id();
                self.remotes.insert(id,(entity,kind));
                entity
            }
        };
        self.app.world_mut().entity_mut(entity).insert((Position(p),Rotation(q),
            Transform::from_translation(p).with_rotation(q),LinearVelocity(velocity),AngularVelocity::ZERO));
    }

    /// A moving platform the game drives (the ferry's vehicle deck, its ramp): boxes in the
    /// platform's own frame (centre xyz, half-extents xyz, yaw, friction) on one kinematic body
    /// with its centre of mass at its origin. Replaces any platform with the same id.
    pub fn add_platform(&mut self, id: u32, boxes: &[f32]) -> bool {
        let pitched: Vec<f32> = boxes.chunks_exact(8).flat_map(|b| [b[0],b[1],b[2],b[3],b[4],b[5],b[6],0.0,b[7]]).collect();
        self.add_platform_pitched(id, &pitched)
    }

    /// As `add_platform`, each record centre xyz, half-extents xyz, yaw, pitch, friction: the
    /// box turns by yaw about its Y and then by pitch about its own X (a ramp sloping along Z).
    pub fn add_platform_pitched(&mut self, id: u32, boxes: &[f32]) -> bool {
        let shapes: Vec<(Vec3, Quat, Collider)> = boxes.chunks_exact(9)
            .filter(|b| b.iter().all(|v| v.is_finite()) && b[3..6].iter().all(|v| *v > 0.0))
            .map(|b| (Vec3::new(b[0], b[1], b[2]), Quat::from_rotation_y(b[6]) * Quat::from_rotation_x(b[7]), Collider::cuboid(b[3]*2.0, b[4]*2.0, b[5]*2.0)))
            .collect();
        if shapes.is_empty() { return false; }
        let friction = boxes[8].clamp(0.0, 2.0);
        self.remove_platform(id);
        let entity = self.app.world_mut().spawn((RigidBody::Kinematic, Collider::compound(shapes), Friction::new(friction),
            PropSurface(Surface::Asphalt), controller::MovingPlatform, CenterOfMass(Vec3::ZERO), NoAutoCenterOfMass,
            Transform::default())).id();
        self.platforms.insert(id, entity);
        true
    }

    /// The platform's pose and motion for the coming steps: position xyz, rotation xyzw,
    /// linear velocity xyz, angular velocity xyz (about its origin). The solver carries it
    /// along that motion until the next call.
    pub fn set_platform(&mut self, id: u32, state: &[f32]) -> bool {
        if state.len() < 13 || state.iter().any(|v| !v.is_finite()) { return false; }
        let Some(&entity) = self.platforms.get(&id) else { return false; };
        let p = Vec3::new(state[0], state[1], state[2]);
        let q = Quat::from_xyzw(state[3], state[4], state[5], state[6]).normalize();
        self.app.world_mut().entity_mut(entity).insert((Position(p), Rotation(q), Transform::from_translation(p).with_rotation(q),
            LinearVelocity(Vec3::new(state[7], state[8], state[9])), AngularVelocity(Vec3::new(state[10], state[11], state[12]))));
        true
    }

    pub fn remove_platform(&mut self, id: u32) {
        if let Some(entity) = self.platforms.remove(&id) { self.app.world_mut().despawn(entity); }
    }

    pub fn remove_remote(&mut self,id:u32) {
        if let Some((entity,_))=self.remotes.remove(&id) { self.app.world_mut().despawn(entity); }
    }

    /// The source is Tidewater's row-major (z then x) texel-centred height grid.
    /// Avian passes flattened rows to a column-major matrix; Parry rows are Z.
    /// Transpose here, keeping the exact original 1 m vertices and half-texel origin.
    pub fn set_terrain(&mut self, heights: &[f32], resolution: usize, size: f32, origin: f32) -> bool {
        if resolution < 2 || heights.len() != resolution * resolution || !size.is_finite() || size <= 0.0
            || !origin.is_finite() || heights.iter().any(|v| !v.is_finite()) { return false; }
        let columns: Vec<Vec<f32>> = (0..resolution).map(|x|
            (0..resolution).map(|z| heights[z * resolution + x]).collect()).collect();
        let extent = size * (resolution - 1) as f32 / resolution as f32;
        let centre = origin + size * 0.5;
        self.app.world_mut().spawn((RigidBody::Static,road::TerrainSurface,
            Collider::heightfield(columns, Vec3::new(extent, 1.0, extent)),
            Friction::new(0.65), Transform::from_xyz(centre, 0.0, centre)));
        self.app.insert_resource(TerrainMaterials { codes: Vec::new(), res: resolution, origin, texel: size / resolution as f32 });
        true
    }

    /// Terrain material per height texel: 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand.
    pub fn set_surface_map(&mut self, codes: &[u8]) -> bool {
        let mut materials=self.app.world_mut().resource_mut::<TerrainMaterials>();
        if materials.res==0 || codes.len()!=materials.res*materials.res { return false; }
        materials.codes=codes.to_vec();
        true
    }

    pub fn set_roads(&mut self,segments:&[f32])->bool {
        if segments.len()%6!=0 || segments.iter().any(|v| !v.is_finite()) {return false;}
        let mut roads=Vec::new();
        for s in segments.chunks_exact(6) {
            if s[4]<=0.0 || s[4]>20.0 || s[5]<0.05 || s[5]>1.25 {return false;}
            roads.push(s.try_into().unwrap());
        }
        self.app.insert_resource(RoadSurfaces(roads)); true
    }

    /// Each record is centre xyz, half-extents xyz, yaw, surface friction; all wood (piers, boardwalks).
    pub fn add_boxes(&mut self, boxes: &[f32]) { self.add_surface_boxes(boxes, &[]); }

    /// As `add_boxes`, with a surface code per record (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel,
    /// 5 wood, 7 wet sand): a terminal's paved lanes read as asphalt, its boardwalks as wood.
    /// Records past the end of `surfaces`, or with an unknown code, are wood.
    pub fn add_surface_boxes(&mut self, boxes: &[f32], surfaces: &[u8]) {
        let mut statics = Vec::new();
        for (i, b) in boxes.chunks_exact(8).enumerate() {
            if b.iter().any(|v| !v.is_finite()) || b[3..6].iter().any(|v| *v <= 0.0) { continue; }
            let code = match surfaces.get(i) { Some(&c @ (0 | 1 | 2 | 3 | 4 | 7)) => c, _ => 5 };
            statics.push((Vec3::new(b[0],b[1],b[2]), Quat::from_rotation_y(b[6]),
                Collider::cuboid(b[3]*2.0, b[4]*2.0, b[5]*2.0), code, b[7]));
        }
        self.spawn_statics(statics);
    }

    /// Static shapes (centre, rotation, collider, surface code, friction), one compound collider per
    /// STATIC_CELL square and surface and friction: the same shapes, surfaces and grip as a body each,
    /// but a few hundred entities instead of 15 000 (the island's trunks), which every fixed step walked.
    fn spawn_statics(&mut self, statics: Vec<(Vec3, Quat, Collider, u8, f32)>) {
        let mut cells: std::collections::BTreeMap<(i32, i32, u8, u32), Vec<(Vec3, Quat, Collider)>> = Default::default();
        for (p, q, collider, code, friction) in statics {
            let key = ((p.x / STATIC_CELL).floor() as i32, (p.z / STATIC_CELL).floor() as i32, code, friction.to_bits());
            cells.entry(key).or_default().push((p, q, collider));
        }
        for ((cx, cz, code, friction), mut shapes) in cells {
            let surface = match code { 0 => Surface::Sand, 1 => Surface::Soil, 2 => Surface::Rock, 3 => Surface::Asphalt,
                4 => Surface::Gravel, 7 => Surface::WetSand, _ => Surface::Wood };
            let (collider, transform) = if shapes.len() == 1 {
                let (p, q, collider) = shapes.pop().unwrap();
                (collider, Transform::from_translation(p).with_rotation(q))
            } else {
                let origin = Vec3::new((cx as f32 + 0.5) * STATIC_CELL, 0.0, (cz as f32 + 0.5) * STATIC_CELL);
                for shape in &mut shapes { shape.0 -= origin; }
                (Collider::compound(shapes), Transform::from_translation(origin))
            };
            self.app.world_mut().spawn((disasters::IslandStatic, RigidBody::Static, collider, Friction::new(f32::from_bits(friction)), PropSurface(surface), transform));
        }
    }

    /// Each record is x, z, radius, bottom, top: rocks, posts, piles, trunks.
    pub fn add_cylinders(&mut self, cylinders: &[f32]) {
        let mut statics = Vec::new();
        for c in cylinders.chunks_exact(5) {
            if c.iter().any(|v| !v.is_finite()) || c[2] <= 0.0 || c[4] <= c[3] { continue; }
            statics.push((Vec3::new(c[0], (c[3]+c[4])*0.5, c[1]), Quat::IDENTITY, Collider::cylinder(c[2], c[4]-c[3]), 2, 0.6));
        }
        self.spawn_statics(statics);
    }

    /// The sea surface near the car, fitted by the renderer to wave queries: height at
    /// (x0, z0), slope along x and z, and vertical rate (m/s). Non-finite input disables it.
    pub fn set_water(&mut self, height:f32, slope_x:f32, slope_z:f32, x0:f32, z0:f32, rate:f32) {
        let finite=[height,slope_x,slope_z,x0,z0,rate].iter().all(|v| v.is_finite());
        self.app.insert_resource(if finite {
            WaterPlane { active:true, height, slope_x:slope_x.clamp(-0.5,0.5), slope_z:slope_z.clamp(-0.5,0.5), x0, z0, rate:rate.clamp(-5.0,5.0) }
        } else { WaterPlane::default() });
    }

    /// Air velocity xyz and horizontal current xz, m/s. Invalid batches leave the
    /// previous valid fluid sample unchanged; the zero default preserves old callers.
    pub fn set_fluid_velocity(&mut self, air_x:f32, air_y:f32, air_z:f32, current_x:f32, current_z:f32) -> bool {
        if [air_x,air_y,air_z,current_x,current_z].iter().any(|v|!v.is_finite()) { return false; }
        self.app.insert_resource(FluidVelocity { air:Vec3::new(air_x,air_y,air_z), current:Vec3::new(current_x,0.0,current_z) });
        true
    }

    /// Mechanical damage from the renderer's damage model: engine power left 0..1, steering
    /// pull (rad), then per wheel (snapshot order: 0 front -X, 1 front +X, 2 rear -X, 3 rear +X) toe (rad), spring strength
    /// left 0..1 and detached (non-zero). Non-finite values are ignored.
    pub fn set_damage(&mut self, engine:f32, pull:f32, wheels:&[f32]) -> bool {
        if wheels.len()!=12 || !engine.is_finite() || !pull.is_finite() || wheels.iter().any(|v| !v.is_finite()) { return false; }
        let wing_lost=self.app.world().resource::<controller::Damage>().wing_lost;
        let mut damage=controller::Damage { wing_lost, engine:engine.clamp(0.0,1.0), pull:pull.clamp(-0.2,0.2), ..default() };
        for w in 0..4 {
            damage.toe[w]=wheels[w].clamp(-0.3,0.3);
            damage.spring[w]=wheels[4+w].clamp(0.2,1.0);
            damage.lost[w]=wheels[8+w]!=0.0;
        }
        self.app.insert_resource(damage);
        true
    }

    /// The detachable RS wing changes the rear aero balance independently of wheel damage.
    pub fn set_rear_wing(&mut self,attached:bool) {
        self.app.world_mut().resource_mut::<controller::Damage>().wing_lost=!attached;
    }

    /// Hard hits on the body since the last call, each as car-local point xyz, car-local push
    /// direction xyz, severity (change in velocity, m/s) and 1 if it hit scenery (0 another car).
    pub fn take_impacts(&mut self) -> Vec<f32> {
        let mut body=self.app.world_mut().entity_mut(self.car);
        let mut car=body.get_mut::<Car>().unwrap();
        car.impacts.drain(..).flat_map(|i| [i.point.x,i.point.y,i.point.z,i.direction.x,i.direction.y,i.direction.z,i.delta_v,if i.prop {1.0} else {0.0}]).collect()
    }

    /// Traction and stability control on (default) or off for drivers who want to slide.
    pub fn set_assists(&mut self, on:bool) { self.app.insert_resource(controller::Assists(on)); }

    pub fn reset(&mut self, x: f32, y: f32, z: f32, yaw: f32) {
        if [x,y,z,yaw].iter().any(|v| !v.is_finite()) { return; }
        let q = Quat::from_rotation_y(yaw);
        let car=Car::new(self.app.world().resource::<VehicleConfig>());
        self.app.world_mut().entity_mut(self.car).insert((
            Transform::from_xyz(x,y,z).with_rotation(q), Position(Vec3::new(x,y,z)), Rotation::from(q),
            LinearVelocity::ZERO, AngularVelocity::ZERO, car,
            PreSolveDeltaPosition::default(), PreSolveDeltaRotation::default()));
        *self.app.world_mut().resource_mut::<DriveIntent>() = DriveIntent::default();
        self.remainder = 0.0;
        // A teleport is not motion: nothing to blend from.
        self.previous = [x,y,z,q.x,q.y,q.z,q.w];
    }

    /// Sets how many fixed steps one `advance` may run, clamped to 1..=CATCH_UP_MAX_STEPS.
    /// SimulationPacing passes DISASTER_MAX_STEPS while a disaster runs, else CATCH_UP_MAX_STEPS.
    pub fn set_max_steps(&mut self, steps: u32) {
        self.max_steps = steps.clamp( 1, CATCH_UP_MAX_STEPS );
    }

    /// Runs the fixed steps owed for `seconds` and returns how many ran.
    pub fn advance(&mut self, seconds: f32, throttle: f32, brake: f32, steer: f32, handbrake: f32) -> u32 {
        if [seconds,throttle,brake,steer,handbrake].iter().any(|v| !v.is_finite()) { return 0; }
        *self.app.world_mut().resource_mut::<DriveIntent>() = DriveIntent {
            throttle: throttle.clamp(0.0,1.0), brake: brake.clamp(0.0,1.0),
            steer: steer.clamp(-1.0,1.0), handbrake: handbrake.clamp(0.0,1.0) };
        self.remainder += (seconds as f64).clamp(0.0,0.1);
        let mut steps = 0;
        while self.remainder >= DT && steps < self.max_steps {
            self.previous = self.pose();
            self.app.update();
            self.update_structure_connections(DT as f32);
            self.remainder -= DT;
            steps += 1;
        }
        // Drop the time the cap left unsimulated and keep only the phase within a step, so the
        // next frame owes nothing and the render blend stays in [0, 1].
        if self.remainder >= DT { self.remainder %= DT; }
        steps
    }

    /// Render interpolation. Whole fixed steps run per call, so a display frame can get zero,
    /// one or two steps and a car drawn at the latest step judders in proportion to its speed.
    /// Returns the pose before the latest step (position xyz, rotation xyzw) and alpha, the
    /// unsimulated remainder as a fraction of a step: draw the car at lerp/slerp(previous,
    /// snapshot pose, alpha) and it moves evenly whatever the frame times (one step behind).
    pub fn blend(&self) -> Vec<f32> {
        let mut result = self.previous.to_vec();
        result.push((self.remainder / DT).clamp(0.0, 1.0) as f32);
        result
    }

    /// Flat Float32Array, SNAPSHOT_LEN long:
    /// 0-2 position, 3-6 rotation xyzw, 7 signed km/h, 8 gear (-1 R, 0 N, 1..), 9 engine rpm,
    /// 10 loaded wheel contacts, 11 distance m, 12 mean slide 0..1;
    /// 13 + w*4: suspension length, steer angle, wheel surface speed (omega * r), grounded;
    /// 29 + w*10: contact point xyz, contact normal xyz, normal load N, slide 0..1,
    ///   ground speed m/s, lateral contact speed m/s;
    /// 69 throttle applied, 70 service brake, 71 steering angle, 72 handbrake, 73 submerged 0..1,
    /// 74 traction or stability control active, 75 ABS active, 76 lateral g, 77 longitudinal g, 78 yaw rate,
    /// 79 engine load, 80 shifting, 81 + w slip ratio, 85 + w slip angle, 89 + w surface code
    /// (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel, 5 wood/prop, 6 water, 7 wet sand),
    /// 93 sea height at the car (-1000 when none), 94 vertical speed, 95 speed through water.
    /// Wheel order: 0 front at -X (the driver's right; the model names it WheelFrontL), 1 front
    /// at +X, 2 rear at -X, 3 rear at +X.
    pub fn snapshot(&self) -> Vec<f32> {
        let body = self.app.world().entity(self.car);
        let p = body.get::<Position>().unwrap().0;
        let q = body.get::<Rotation>().unwrap().0;
        let car = body.get::<Car>().unwrap();
        let config = self.app.world().resource::<VehicleConfig>();
        let slide = car.wheels.iter().map(|w| w.slide).sum::<f32>() * 0.25;
        let mut result = Vec::with_capacity(SNAPSHOT_LEN);
        result.extend([p.x,p.y,p.z,q.x,q.y,q.z,q.w,car.speed*3.6,car.display_gear() as f32,
            car.rpm,car.grounded() as f32,car.distance,slide]);
        for w in &car.wheels {
            result.extend([w.length,w.steer,w.omega*config.radius,if w.grounded {1.0} else {0.0}]);
        }
        for w in &car.wheels {
            result.extend([w.point.x,w.point.y,w.point.z,w.normal.x,w.normal.y,w.normal.z,
                w.load,w.slide,w.ground_speed,w.lateral_speed]);
        }
        let flag=|b:bool| if b {1.0} else {0.0};
        result.extend([car.throttle,car.brake,car.steering,car.handbrake,car.submerged,
            flag(car.tc_active || car.esc_active),flag(car.abs_active),car.lateral_g,car.longitudinal_g,car.yaw_rate,
            car.engine_load,flag(car.shift_timer>0.0)]);
        result.extend(car.wheels.iter().map(|w| w.slip_ratio));
        result.extend(car.wheels.iter().map(|w| w.slip_angle));
        result.extend(car.wheels.iter().map(|w| w.surface as u8 as f32));
        result.extend([car.water_height.unwrap_or(-1000.0),car.vertical_speed,car.water_speed]);
        debug_assert_eq!(result.len(),SNAPSHOT_LEN);
        result
    }
}
