//! Loose props (crates, barrels, lobster pots, fence panels) as bodies that exist only while
//! something is near. The renderer keeps every prop dormant with no body at all; its activation
//! bubble wakes the few near the car or the walker here, reads their poses back in one batch and
//! puts them back to sleep (despawns them) once they rest far from everyone. Avian sleeping stays
//! on, so a woken prop that has settled costs nothing either.
use avian3d::dynamics::solver::islands::WakeBody;
use avian3d::prelude::*;
use bevy::prelude::*;
use wasm_bindgen::prelude::*;
use super::RallyPhysics;

/// Collision layer bits. Everything else in the world keeps the default layers (bit 0, all filters).
const DEFAULT_LAYER: u32 = 1;
const PROP_LAYER: u32 = 2;
const PUSHER_LAYER: u32 = 4;
/// The walker's body: a person's mass, and the most their legs can push with (N). A dynamic body
/// driven toward the walker by a clamped force, so it shoves an empty crate but only rocks a full
/// barrel, and the renderer holds the walker back where the body is stopped (`pusher_position`).
const PUSHER_MASS: f32 = 80.0;
const PUSHER_FORCE: f32 = 500.0;
/// Floats per record in `prop_poses`.
pub const PROP_RECORD: usize = 10;

/// A prop body the renderer woke: its id there, and whether it is a breakable (a static sensor
/// until something hits it hard enough, which the renderer then swaps for loose pieces).
#[derive(Component)]
pub struct PropBody { pub id: u32, pub breakable: bool }

/// Where the walker is (body centre) and how fast it walks; `drive_pusher` chases it.
#[derive(Component)]
pub struct Pusher { pub target: Vec3, pub velocity: Vec3, pub half: f32 }

/// Each fixed step, close the gap to the walker within about 0.1 s, but never faster than
/// PUSHER_FORCE can accelerate PUSHER_MASS: what the body cannot move, it stops against.
pub fn drive_pusher(time: Res<Time>, mut pushers: Query<(&Position, &mut LinearVelocity, &Pusher)>) {
    let dt = time.delta_secs();
    for (position, mut velocity, pusher) in &mut pushers {
        let desired = (pusher.velocity + (pusher.target - position.0) / 0.1).clamp_length_max(8.0);
        let v = velocity.0;
        velocity.0 = v + (desired - v).clamp_length_max(PUSHER_FORCE / PUSHER_MASS * dt);
    }
}

#[cfg(test)]
mod mass_distribution_tests {
    use super::*;
    #[test]
    fn declared_mass_distribution_initializes_without_shifting_the_collision_origin() {
        let mut sim=RallyPhysics::new();
        assert!(sim.wake_prop(990,0,&[0.25,6.0,0.25],&[30.0,100.0,20.0,0.0,0.0,0.0,1.0],10.0,0.0,0.0,false));
        assert!(sim.set_prop_mass_properties(990,100.0,&[1500.0,240.0,1500.0],&[0.0,1.2,0.0]));
        assert!(sim.set_disaster_loads(&[990.0,1200.0,981.0,0.0,0.0,240.0,0.0]));
        sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        let entity=sim.props[&990];let world=sim.app.world();
        assert!((world.get::<ComputedMass>(entity).unwrap().value()-100.0).abs()<1e-5);
        assert!((world.get::<ComputedCenterOfMass>(entity).unwrap().0-Vec3::Y*1.2).length()<1e-6);
        assert!((world.get::<ComputedAngularInertia>(entity).unwrap().value().m11-240.0).abs()<1e-4);
        assert!((world.get::<Position>(entity).unwrap().y-100.0).abs()<1e-4);
        assert!((world.get::<LinearVelocity>(entity).unwrap().x-0.1).abs()<1e-4);
        assert!((world.get::<AngularVelocity>(entity).unwrap().y-1.0/120.0).abs()<1e-5);
    }
    #[test]
    fn invalid_or_static_mass_distribution_is_rejected_atomically() {
        let mut sim=RallyPhysics::new();
        assert!(sim.wake_prop(991,0,&[1.0,1.0,1.0],&[30.0,100.0,20.0,0.0,0.0,0.0,1.0],12.0,0.0,0.0,false));
        assert!(!sim.set_prop_mass_properties(991,100.0,&[100.0,1.0,1.0],&[0.0,1.2,0.0]));
        assert!(!sim.set_prop_mass_properties(991,100.0,&[1.0,1.0,1.0],&[0.0,f32::NAN,0.0]));
        sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        assert!((sim.app.world().get::<ComputedMass>(sim.props[&991]).unwrap().value()-12.0).abs()<1e-5);
        assert!(sim.wake_prop(992,0,&[1.0,1.0,1.0],&[30.0,100.0,30.0,0.0,0.0,0.0,1.0],12.0,0.0,0.0,true));
        assert!(!sim.set_prop_mass_properties(992,12.0,&[8.0,8.0,8.0],&[0.0,0.0,0.0]));
    }
}

fn shape(kind: u8, dims: &[f32]) -> Option<(Collider, f32)> {
    if dims.len() < 3 || dims.iter().any(|v| !v.is_finite() || *v <= 0.0) { return None; }
    let (a, b, c) = (dims[0], dims[1], dims[2]);
    match kind {
        0 => Some((Collider::cuboid(a * 2.0, b * 2.0, c * 2.0), 8.0 * a * b * c)),
        1 => Some((Collider::cylinder(a, b * 2.0), std::f32::consts::PI * a * a * b * 2.0)),
        2 => Some((Collider::capsule(a, b * 2.0), std::f32::consts::PI * a * a * (b * 2.0 + a * 4.0 / 3.0))),
        _ => None,
    }
}

#[wasm_bindgen]
impl RallyPhysics {
    /// Wake a prop. `shape` 0 box (dims = half extents), 1 upright cylinder (radius, half height),
    /// 2 upright capsule (radius, half height of the straight part); the shape is centred on the
    /// pose. `state` is position xyz, rotation xyzw, then optional linear velocity xyz. Mass (kg)
    /// sets the density; friction and bounce are per material. A breakable wakes as a static
    /// sensor that reports hits instead of a loose body. Waking a prop already awake nudges it
    /// out of Avian sleep (the walker is about to touch it) and returns true.
    pub fn wake_prop(&mut self, id: u32, shape_kind: u8, dims: &[f32], state: &[f32], mass: f32, friction: f32,
        restitution: f32, breakable: bool) -> bool {
        if let Some(&entity) = self.props.get(&id) {
            let world = self.app.world_mut();
            world.commands().queue(WakeBody(entity));
            world.flush();
            return true;
        }
        if state.len() < 7 || state.iter().any(|v| !v.is_finite()) || !mass.is_finite() || mass <= 0.0 { return false; }
        let Some((collider, volume)) = shape(shape_kind, dims) else { return false; };
        let q = Quat::from_xyzw(state[3], state[4], state[5], state[6]);
        if q.length_squared() < 0.5 { return false; }
        let (p, q) = (Vec3::new(state[0], state[1], state[2]), q.normalize());
        let velocity = if state.len() >= 10 { Vec3::new(state[7], state[8], state[9]) } else { Vec3::ZERO };
        let world = self.app.world_mut();
        let mut body = world.spawn((PropBody { id, breakable }, collider, Transform::from_translation(p).with_rotation(q),
            Position(p), Rotation(q), Friction::new(friction.clamp(0.0, 2.0)), Restitution::new(restitution.clamp(0.0, 1.0)),
            CollisionLayers::from_bits(DEFAULT_LAYER | PROP_LAYER, u32::MAX)));
        if breakable {
            body.insert((RigidBody::Static, Sensor, CollidingEntities::default()));
        } else {
            body.insert((RigidBody::Dynamic, ColliderDensity(mass / volume), LinearVelocity(velocity), AngularVelocity::ZERO));
        }
        let entity = body.id();
        self.props.insert(id, entity);
        true
    }

    /// Override a loose body's measured/assumed mass distribution without changing
    /// its collision shape or authored pose. Principal moments are kg m² in the
    /// existing body axes; centre is metres from that pose, not a world position.
    /// A porous crown can carry mass without becoming a solid collision hull.
    pub fn set_prop_mass_properties(&mut self, id:u32, mass:f32, principal:&[f32], centre:&[f32]) -> bool {
        if !mass.is_finite() || mass<=0.0 || principal.len()!=3 || centre.len()!=3
            || principal.iter().any(|v|!v.is_finite() || *v<=0.0)
            || centre.iter().any(|v|!v.is_finite()) {return false;}
        // A realizable principal inertia obeys all three triangle inequalities.
        for axis in 0..3 {if principal[axis]>(principal[(axis+1)%3]+principal[(axis+2)%3])*1.00001 {return false;}}
        let Some(&entity)=self.props.get(&id) else {return false;};
        let world=self.app.world_mut();
        if world.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) {return false;}
        world.entity_mut(entity).insert((Mass(mass),AngularInertia::new(Vec3::new(principal[0],principal[1],principal[2])),
            CenterOfMass::new(centre[0],centre[1],centre[2]),NoAutoMass,NoAutoAngularInertia,NoAutoCenterOfMass));
        world.commands().queue(WakeBody(entity));world.flush();true
    }

    /// Put a prop back to sleep: its body goes, and the renderer keeps the last pose it read.
    pub fn sleep_prop(&mut self, id: u32) -> bool {
        let Some(entity) = self.props.remove(&id) else { return false; };
        self.remove_body_connections(entity);
        self.app.world_mut().despawn(entity);
        true
    }

    /// A breakable that something slow is leaning on turns solid, so a car can nudge a fence
    /// without passing through it; back to a sensor when nothing touches it.
    pub fn set_prop_solid(&mut self, id: u32, solid: bool) -> bool {
        let Some(&entity) = self.props.get(&id) else { return false; };
        let mut body = self.app.world_mut().entity_mut(entity);
        if !body.get::<PropBody>().is_some_and(|b| b.breakable) { return false; }
        if solid { body.remove::<Sensor>(); } else { body.insert(Sensor); }
        true
    }

    /// Awake props in one Float32Array, PROP_RECORD floats each: id, position xyz, rotation xyzw,
    /// then for a loose prop its speed (m/s, linear plus angular at 0.3 m) and 1 if Avian has it
    /// asleep (else 0); for a breakable, the fastest thing touching it (m/s) and 2 while untouched,
    /// 3 while touched.
    pub fn prop_poses(&self) -> Vec<f32> {
        let world = self.app.world();
        let mut out = Vec::with_capacity(self.props.len() * PROP_RECORD);
        for &entity in self.props.values() {
            let body = world.entity(entity);
            let (Some(prop), Some(p), Some(q)) = (body.get::<PropBody>(), body.get::<Position>(), body.get::<Rotation>()) else { continue; };
            let (speed, flag) = if prop.breakable {
                let touching = body.get::<CollidingEntities>().map(|c| c.0.iter().copied().collect::<Vec<_>>()).unwrap_or_default();
                let fastest = touching.iter().filter_map(|&e| world.get::<LinearVelocity>(e)).map(|v| v.0.length()).fold(0.0, f32::max);
                (fastest, if touching.is_empty() { 2.0 } else { 3.0 })
            } else {
                let v = body.get::<LinearVelocity>().map_or(0.0, |v| v.0.length());
                let w = body.get::<AngularVelocity>().map_or(0.0, |w| w.0.length());
                (v + w * 0.3, if body.contains::<Sleeping>() { 1.0 } else { 0.0 })
            };
            out.extend([prop.id as f32, p.0.x, p.0.y, p.0.z, q.0.x, q.0.y, q.0.z, q.0.w, speed, flag]);
        }
        out
    }

    /// Number of awake props (loose and breakable).
    pub fn prop_count(&self) -> u32 { self.props.len() as u32 }

    /// The walker on foot as an upright capsule (feet at y) that pushes props and only props: the
    /// car, terrain and scenery never see it. It is a person-sized dynamic body chasing this pose
    /// with a clamped force (`drive_pusher`); a jump of more than 1.5 m moves it there outright.
    /// `active` false removes it (driving, riding, swimming).
    pub fn set_pusher(&mut self, x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32, radius: f32, height: f32, active: bool) {
        let finite = [x, y, z, vx, vy, vz, radius, height].iter().all(|v| v.is_finite());
        if !active || !finite || radius <= 0.0 || height <= radius * 2.0 {
            if let Some(entity) = self.pusher.take() { self.app.world_mut().despawn(entity); }
            return;
        }
        let p = Vec3::new(x, y + height * 0.5, z);
        let world = self.app.world_mut();
        let volume = std::f32::consts::PI * radius * radius * (height - radius * 2.0 + radius * 4.0 / 3.0);
        let entity = *self.pusher.get_or_insert_with(|| world.spawn((RigidBody::Dynamic,
            Collider::capsule(radius, height - radius * 2.0), ColliderDensity(PUSHER_MASS / volume),
            CollisionLayers::from_bits(PUSHER_LAYER, PROP_LAYER), GravityScale(0.0), LockedAxes::ROTATION_LOCKED,
            SleepingDisabled, Position(p), Transform::from_translation(p))).id());
        let velocity = Vec3::new(vx, vy, vz);
        let mut body = world.entity_mut(entity);
        if body.get::<Position>().is_none_or(|q| q.0.distance(p) > 1.5) {
            body.insert((Position(p), Transform::from_translation(p), LinearVelocity(velocity)));
        }
        body.insert(Pusher { target: p, velocity, half: height * 0.5 });
    }

    /// Whether a solved solid prop contact opposes the requested horizontal movement.
    /// Following lag without contact must never restrain the renderer's walking controller.
    pub fn pusher_blocked(&self, dx: f32, dz: f32) -> bool {
        if !dx.is_finite() || !dz.is_finite() { return false; }
        let direction = Vec3::new(dx, 0.0, dz);
        let length = direction.length();
        if length <= 1.0e-6 { return false; }
        let Some(pusher) = self.pusher else { return false; };
        let world = self.app.world();
        let graph = world.resource::<ContactGraph>();
        graph.active_pairs().iter().chain(graph.sleeping_pairs()).any(|pair| {
            if !pair.is_touching() { return false; }
            let a = pair.body1.unwrap_or(pair.collider1);
            let b = pair.body2.unwrap_or(pair.collider2);
            let (other, sign) = if a == pusher { (b, 1.0) }
                else if b == pusher { (a, -1.0) } else { return false; };
            if world.get::<PropBody>(other).is_none() || world.get::<Sensor>(other).is_some()
                || world.get::<Sensor>(pair.collider1).is_some() || world.get::<Sensor>(pair.collider2).is_some() { return false; }
            pair.manifolds.iter().any(|m| m.total_normal_impulse() > 0.0
                && (m.normal * sign).dot(direction) > 0.1 * length)
        })
    }

    /// The walker's body now (feet xyz), empty when there is none. Only an opposing
    /// `pusher_blocked` contact should hold the walking controller within reach of it.
    pub fn pusher_position(&self) -> Vec<f32> {
        let Some(entity) = self.pusher else { return Vec::new(); };
        let body = self.app.world().entity(entity);
        match (body.get::<Position>(), body.get::<Pusher>()) {
            (Some(p), Some(pusher)) => vec![p.0.x, p.0.y - pusher.half, p.0.z],
            _ => Vec::new(),
        }
    }
}
