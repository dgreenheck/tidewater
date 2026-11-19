//! Bounded external environmental loads, applied by Avian at every 120 Hz force step.
use avian3d::prelude::*;
use avian3d::dynamics::solver::islands::WakeBody;
use bevy::prelude::*;
use wasm_bindgen::prelude::*;
use crate::RallyPhysics;

#[derive(Component)]
pub struct IslandStatic;
#[derive(Component)]
pub struct DisasterLoad;
// ConstantForce/Torque are consumed by Avian after mass properties are initialized.
// Applying Forces from FixedUpdate before Prepare used the default1kg on a new body.
#[wasm_bindgen]
impl RallyPhysics {
    /// Records: id (-1 = local car), force xyz in N, torque xyz in Nm. Replaces previous
    /// loads, so stop cannot leave a stale force. Bad batches are rejected atomically.
    pub fn set_disaster_loads(&mut self, data: &[f32]) -> bool {
        if data.len() % 7 != 0 || data.len() > 512 * 7 || data.iter().any(|v| !v.is_finite()) { return false; }
        let world = self.app.world_mut();
        let previous: Vec<Entity> = world.query_filtered::<Entity, With<DisasterLoad>>().iter(world).collect();
        let mut retained = std::collections::HashSet::with_capacity(data.len() / 7);
        for d in data.chunks_exact(7) {
            let entity = if d[0] == -1.0 { Some(self.car) } else { self.props.get(&(d[0] as u32)).copied() };
            if let Some(entity) = entity {
                if world.get::<RigidBody>(entity) != Some(&RigidBody::Dynamic) { continue; }
                let force = Vec3::new(d[1], d[2], d[3]).clamp_length_max(2.0e6);
                let torque = Vec3::new(d[4], d[5], d[6]).clamp_length_max(2.0e6);
                if force.length_squared() + torque.length_squared() < 1.0e-6 { continue; }
                retained.insert(entity);
                // Avian wakes islands on Changed<ConstantForce/ConstantTorque>.
                // Replacing identical components every render frame therefore
                // prevents settled debris from staying asleep under steady wind.
                // Compare the actual bounded f32 loads, with no new tolerance.
                let force_changed = world.get::<ConstantForce>(entity).is_none_or(|old| old.0 != force);
                let torque_changed = world.get::<ConstantTorque>(entity).is_none_or(|old| old.0 != torque);
                if world.get::<DisasterLoad>(entity).is_none() { world.entity_mut(entity).insert(DisasterLoad); }
                if force_changed { world.entity_mut(entity).insert(ConstantForce(force)); }
                if torque_changed { world.entity_mut(entity).insert(ConstantTorque(torque)); }
                if force_changed || torque_changed { world.commands().queue(WakeBody(entity)); }
            }
        }
        for entity in previous {
            if !retained.contains(&entity) {
                world.entity_mut(entity).remove::<(DisasterLoad,ConstantForce,ConstantTorque)>();
                // Removed components do not match Avian's Changed queries. A
                // sleeping body must react when a balancing load disappears.
                world.commands().queue(WakeBody(entity));
            }
        }
        world.flush();
        true
    }
    pub fn set_prop_motion_limits(&mut self, id: u32, angular_damping: f32, max_angular_speed: f32) -> bool {
        if !angular_damping.is_finite() || angular_damping < 0.0 || !max_angular_speed.is_finite() || max_angular_speed <= 0.0 { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        let world=self.app.world_mut();
        if world.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) { return false; }
        world.entity_mut(entity).insert((AngularDamping(angular_damping), MaxAngularSpeed(max_angular_speed)));
        true
    }
    /// Give a released tree its crown: the stem box (`half`, metres) plus a sphere of radius
    /// `crown_radius` centred `crown_y` metres up the body axis. The sphere is the crushed crown
    /// that props a fallen top off the ground; without it the trunk lay flat and the crown mesh
    /// sank into the terrain (flat frond starbursts and bare trunks). Call before
    /// set_prop_mass_properties, which then fixes the declared mass whatever the shape.
    pub fn set_prop_crown(&mut self, id: u32, half: &[f32], crown_y: f32, crown_radius: f32) -> bool {
        if half.len()!=3 || half.iter().any(|v| !v.is_finite() || *v<=0.0) || !crown_y.is_finite() || !crown_radius.is_finite() || crown_radius<=0.0 { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        let world=self.app.world_mut();
        if world.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) { return false; }
        let collider=Collider::compound(vec![
            (Vec3::ZERO, Quat::IDENTITY, Collider::cuboid(half[0]*2.0, half[1]*2.0, half[2]*2.0)),
            (Vec3::new(0.0, crown_y, 0.0), Quat::IDENTITY, Collider::sphere(crown_radius)),
        ]);
        world.entity_mut(entity).insert(collider);
        world.commands().queue(WakeBody(entity));
        world.flush();
        true
    }
    pub fn set_prop_angular_velocity(&mut self, id: u32, value: &[f32]) -> bool {
        if value.len()!=3 || value.iter().any(|v|!v.is_finite()) { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        self.app.world_mut().entity_mut(entity).insert(AngularVelocity(Vec3::new(value[0],value[1],value[2])));
        true
    }
    /// Contact-point velocity (m/s) and inverse effective mass (1/kg), including
    /// the actual body's rotational inertia. Empty for non-dynamic/invalid bodies.
    pub fn disaster_contact(&self, id: u32, point: &[f32], normal: &[f32]) -> Vec<f32> {
        if point.len()!=3 || normal.len()!=3 || point.iter().chain(normal).any(|v|!v.is_finite()) {return vec![];}
        let Some(entity)=self.props.get(&id).copied() else {return vec![];};let w=self.app.world();
        if w.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) {return vec![];}
        let (Some(p),Some(q),Some(v),Some(a),Some(m),Some(i))=(w.get::<Position>(entity),w.get::<Rotation>(entity),w.get::<LinearVelocity>(entity),w.get::<AngularVelocity>(entity),w.get::<ComputedMass>(entity),w.get::<ComputedAngularInertia>(entity)) else {return vec![];};
        let n=Vec3::new(normal[0],normal[1],normal[2]);if (n.length_squared()-1.0).abs()>0.01 {return vec![];}
        let com=p.0+q.0*w.get::<ComputedCenterOfMass>(entity).map_or(Vec3::ZERO,|c|c.0);
        let r=Vec3::new(point[0],point[1],point[2])-com;let cross=r.cross(n);let inv_i_cross=q.0*(i.inverse()*(q.0.inverse()*cross));
        let at=v.0+a.0.cross(r);vec![at.x,at.y,at.z,m.inverse()+cross.dot(inv_i_cross)]
    }
    /// Equal-and-opposite contact impulse in N s at a world point. This changes
    /// both linear and angular momentum; no persistent force is left behind.
    pub fn apply_prop_impulse(&mut self, id: u32, value: &[f32], point: &[f32]) -> bool {
        if value.len()!=3 || point.len()!=3 || value.iter().chain(point).any(|v|!v.is_finite()) {return false;}
        let j=Vec3::new(value[0],value[1],value[2]);if j.length()>2.0e4{return false;}
        let Some(entity)=self.props.get(&id).copied() else {return false;};let w=self.app.world_mut();
        if w.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) {return false;}
        let (Some(p),Some(q),Some(m),Some(i))=(w.get::<Position>(entity),w.get::<Rotation>(entity),w.get::<ComputedMass>(entity),w.get::<ComputedAngularInertia>(entity)) else {return false;};
        let com=p.0+q.0*w.get::<ComputedCenterOfMass>(entity).map_or(Vec3::ZERO,|c|c.0);let r=Vec3::new(point[0],point[1],point[2])-com;
        let dv=j*m.inverse();let da=q.0*(i.inverse()*(q.0.inverse()*r.cross(j)));
        if let Some(mut v)=w.get_mut::<LinearVelocity>(entity){v.0+=dv;}
        if let Some(mut a)=w.get_mut::<AngularVelocity>(entity){a.0+=da;}
        w.commands().queue(WakeBody(entity));w.flush();true
    }
    /// Actual body positions and linear velocities for relative-fluid loads / observation.
    pub fn disaster_motion(&self) -> Vec<f32> {
        let world = self.app.world();
        let mut out = Vec::with_capacity((self.props.len()+1)*7);
        for (id, entity) in std::iter::once((-1.0,self.car)).chain(self.props.iter().map(|(id,e)|(*id as f32,*e))) {
            if let (Some(p),Some(v)) = (world.get::<Position>(entity),world.get::<LinearVelocity>(entity)) {
                out.extend_from_slice(&[id,p.x,p.y,p.z,v.x,v.y,v.z]);
            }
        }
        out
    }
    /// Exact car rigid-body snapshot: position3, quaternion4, linear3, angular3.
    pub fn disaster_car_state(&self) -> Vec<f32> {
        let world=self.app.world();let p=world.get::<Position>(self.car).unwrap();let q=world.get::<Rotation>(self.car).unwrap();let v=world.get::<LinearVelocity>(self.car).unwrap();let a=world.get::<AngularVelocity>(self.car).unwrap();
        vec![p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,a.x,a.y,a.z]
    }
    pub fn restore_disaster_car(&mut self,state:&[f32]) -> bool {
        if state.len()!=13 || state.iter().any(|v|!v.is_finite()) {return false;}
        let q=Quat::from_xyzw(state[3],state[4],state[5],state[6]);if q.length_squared()<0.01{return false;}
        self.reset(state[0],state[1],state[2],0.0);let q=q.normalize();
        self.app.world_mut().entity_mut(self.car).insert((Transform::from_xyz(state[0],state[1],state[2]).with_rotation(q),Rotation::from(q),LinearVelocity(Vec3::new(state[7],state[8],state[9])),AngularVelocity(Vec3::new(state[10],state[11],state[12]))));
        self.previous=[state[0],state[1],state[2],q.x,q.y,q.z,q.w];true
    }
    /// Ground support from solved upward contact normals, propagated through stacks.
    /// Proximity to terrain alone never makes a floating/airborne body supported.
    pub fn disaster_supported(&self) -> Vec<f32> {
        let world=self.app.world();let graph=world.resource::<ContactGraph>();
        let pairs:Vec<_>=graph.active_pairs().iter().chain(graph.sleeping_pairs()).filter(|p|p.is_touching()).collect();
        let mut supported=std::collections::HashSet::<Entity>::new();
        for pair in &pairs {for e in [pair.body1.unwrap_or(pair.collider1),pair.body2.unwrap_or(pair.collider2)] {if world.get::<RigidBody>(e)!=Some(&RigidBody::Dynamic){supported.insert(e);}}}
        for _ in 0..8 {let count=supported.len();for pair in &pairs {let a=pair.body1.unwrap_or(pair.collider1);let b=pair.body2.unwrap_or(pair.collider2);for m in &pair.manifolds {if m.total_normal_impulse()<=0.0 {continue;}if m.normal.y < -0.3 && supported.contains(&b){supported.insert(a);}if m.normal.y > 0.3 && supported.contains(&a){supported.insert(b);}}}if supported.len()==count{break;}}
        self.supported_connections(&mut supported);
        std::iter::once((-1.0,self.car)).chain(self.props.iter().map(|(id,e)|(*id as f32,*e))).filter_map(|(id,e)|supported.contains(&e).then_some(id)).collect()
    }
    /// Rebuild only exported island colliders after structural failure. Terrain, vehicles,
    /// dynamic debris and ferry platforms are deliberately kept in the same solver world.
    pub fn clear_island_statics(&mut self) {
        let world = self.app.world_mut();
        let entities: Vec<Entity> = world.query_filtered::<Entity, With<IslandStatic>>().iter(world).collect();
        for entity in entities { world.despawn(entity); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn debris(on_ground: bool) -> (RallyPhysics, Entity) {
        let mut sim = RallyPhysics::new();
        assert!(sim.set_terrain(&[0.0;81], 9, 4000.0, -2000.0));
        assert!(sim.wake_prop(51, 0, &[0.5,0.5,0.5],
            &[40.0,if on_ground { 0.5 } else { 100.0 },0.0,0.0,0.0,0.0,1.0],
            10.0, 0.8, 0.0, false));
        let entity = sim.props[&51];
        (sim, entity)
    }
    fn step(sim: &mut RallyPhysics) { sim.advance(1.0/120.0,0.0,0.0,0.0,0.0); }
    fn settle(sim: &mut RallyPhysics, entity: Entity, load: &[f32]) {
        for _ in 0..600 { assert!(sim.set_disaster_loads(load)); step(sim); }
        assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "steady loaded body did not settle");
    }
    // Frozen former setter for valid test inputs, including its force caps and
    // wake behavior. This is also the before case in the optional CPU probe.
    fn replace_loads(sim: &mut RallyPhysics, data: &[f32]) {
        let world = sim.app.world_mut();
        let entities: Vec<Entity> = world.query_filtered::<Entity, With<DisasterLoad>>().iter(world).collect();
        for entity in entities { world.entity_mut(entity).remove::<(DisasterLoad,ConstantForce,ConstantTorque)>(); }
        for d in data.chunks_exact(7) {
            let entity = if d[0] == -1.0 { Some(sim.car) } else { sim.props.get(&(d[0] as u32)).copied() };
            if let Some(entity) = entity {
                if world.get::<RigidBody>(entity) != Some(&RigidBody::Dynamic) { continue; }
                let force = Vec3::new(d[1],d[2],d[3]).clamp_length_max(2.0e6);
                let torque = Vec3::new(d[4],d[5],d[6]).clamp_length_max(2.0e6);
                if force.length_squared()+torque.length_squared()<1.0e-6 { continue; }
                world.entity_mut(entity).insert((DisasterLoad,ConstantForce(force),ConstantTorque(torque)));
                world.commands().queue(WakeBody(entity));
            }
        }
        world.flush();
    }

    #[test]
    fn steady_disaster_load_preserves_sleep_and_resting_contact() {
        let (mut sim, entity) = debris(true);
        let load = [51.0,5.0,0.0,0.0,0.0,0.0,0.0];
        settle(&mut sim, entity, &load);
        let position = sim.app.world().get::<Position>(entity).unwrap().0;
        let rotation = sim.app.world().get::<Rotation>(entity).unwrap().0;
        let velocity = sim.app.world().get::<LinearVelocity>(entity).unwrap().0;
        let spin = sim.app.world().get::<AngularVelocity>(entity).unwrap().0;
        assert!((position.y-0.5).abs()<0.03, "ground contact must still support the crate");
        for _ in 0..240 {
            assert!(sim.set_disaster_loads(&load));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "identical load woke the body");
            step(&mut sim);
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
        }
        let world = sim.app.world();
        assert_eq!(world.get::<Position>(entity).unwrap().0, position);
        assert_eq!(world.get::<Rotation>(entity).unwrap().0, rotation);
        assert_eq!(world.get::<ConstantForce>(entity).unwrap().0, Vec3::X*5.0);
        assert_eq!(world.get::<LinearVelocity>(entity).unwrap().0, velocity);
        assert_eq!(world.get::<AngularVelocity>(entity).unwrap().0, spin);
        assert!(velocity.length()<1e-4 && spin.length()<1e-4);
    }

    #[test]
    fn changed_disaster_force_and_torque_wake_and_move_resting_debris() {
        for torque_only in [false, true] {
            let (mut sim, entity) = debris(true);
            settle(&mut sim, entity, &[51.0,5.0,0.0,0.0,0.0,0.0,0.0]);
            let before = sim.app.world().get::<Position>(entity).unwrap().0;
            let load = if torque_only { [51.0,5.0,0.0,0.0,0.0,150.0,0.0] }
                       else { [51.0,400.0,0.0,0.0,0.0,0.0,0.0] };
            assert!(sim.set_disaster_loads(&load));
            assert!(sim.app.world().get::<Sleeping>(entity).is_none());
            for _ in 0..12 { step(&mut sim); }
            if torque_only {
                assert!(sim.app.world().get::<AngularVelocity>(entity).unwrap().y.abs()>0.1);
            } else {
                assert!(sim.app.world().get::<Position>(entity).unwrap().x-before.x>0.05);
            }
        }
    }

    #[test]
    fn omitted_or_zero_disaster_load_wakes_and_releases_balanced_body() {
        for replacement in [&[][..], &[51.0,0.0,0.0,0.0,0.0,0.0,0.0][..]] {
            let (mut sim, entity) = debris(false);
            settle(&mut sim, entity, &[51.0,0.0,98.1,0.0,0.0,0.0,0.0]);
            let before = sim.app.world().get::<Position>(entity).unwrap().y;
            assert!(sim.set_disaster_loads(replacement));
            assert!(sim.app.world().get::<Sleeping>(entity).is_none());
            assert!(sim.app.world().get::<DisasterLoad>(entity).is_none());
            assert!(sim.app.world().get::<ConstantForce>(entity).is_none());
            assert!(sim.app.world().get::<ConstantTorque>(entity).is_none());
            for _ in 0..12 { step(&mut sim); }
            assert!(sim.app.world().get::<LinearVelocity>(entity).unwrap().y < -0.9);
            assert!(sim.app.world().get::<Position>(entity).unwrap().y < before-0.04);
        }
    }

    #[test]
    fn invalid_disaster_batch_preserves_load_and_sleep_atomically() {
        let (mut sim, entity) = debris(true);
        settle(&mut sim, entity, &[51.0,5.0,0.0,0.0,0.0,0.0,0.0]);
        for invalid in [vec![51.0,0.0], vec![51.0,900.0,0.0,0.0,0.0,0.0,f32::NAN], vec![0.0;513*7]] {
            assert!(!sim.set_disaster_loads(&invalid));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
            assert_eq!(sim.app.world().get::<ConstantForce>(entity).unwrap().0, Vec3::X*5.0);
        }
    }

    #[test]
    fn persistent_disaster_load_matches_replace_each_frame_while_awake() {
        let (mut current, entity) = debris(false);
        let (mut reference, old_entity) = debris(false);
        for frame in 0..240 {
            let load = if frame%13 == 0 { vec![] } else { vec![51.0,
                20.0*(frame as f32*0.23).sin(),4.0,13.0*(frame as f32*0.1).cos(),0.7,-0.3,0.5] };
            assert!(current.set_disaster_loads(&load));
            // Frozen former update mechanism; all forces and solver steps match.
            replace_loads(&mut reference, &load);
            step(&mut current);step(&mut reference);
            let a = current.app.world();let b = reference.app.world();
            assert_eq!(a.get::<Position>(entity).unwrap().0,b.get::<Position>(old_entity).unwrap().0);
            assert_eq!(a.get::<Rotation>(entity).unwrap().0,b.get::<Rotation>(old_entity).unwrap().0);
            assert_eq!(a.get::<LinearVelocity>(entity).unwrap().0,b.get::<LinearVelocity>(old_entity).unwrap().0);
            assert_eq!(a.get::<AngularVelocity>(entity).unwrap().0,b.get::<AngularVelocity>(old_entity).unwrap().0);
        }
    }

    #[test]
    #[ignore = "CPU timing probe; coordinate with browser measurements before running"]
    fn native_persistent_load_benchmark() {
        const COUNT: usize = 128;
        let mut loads = Vec::with_capacity(COUNT*7);
        let mut cases = [RallyPhysics::new(), RallyPhysics::new()];
        for sim in &mut cases {
            assert!(sim.set_terrain(&[0.0;81],9,4000.0,-2000.0));
            sim.reset(500.0,0.5,500.0,0.0);
            for i in 0..COUNT {
                assert!(sim.wake_prop(i as u32,0,&[0.5,0.5,0.5],
                    &[-200.0+(i%16) as f32*3.0,0.5,-100.0+(i/16) as f32*3.0,0.0,0.0,0.0,1.0],
                    10.0,0.8,0.0,false));
            }
        }
        for i in 0..COUNT { loads.extend_from_slice(&[i as f32,5.0,0.0,0.0,0.0,0.0,0.0]); }
        let advance = |sim: &mut RallyPhysics, old: bool| {
            if old { replace_loads(sim,&loads); } else { assert!(sim.set_disaster_loads(&loads)); }
            sim.advance(1.0/60.0,0.0,0.0,0.0,0.0);
        };
        for (index, sim) in cases.iter_mut().enumerate() { for _ in 0..300 { advance(sim,index==0); } }
        let mut rows = [Vec::new(), Vec::new()];
        for round in 0..7 {
            for index in if round%2 == 0 { [0,1] } else { [1,0] } {
                let start = std::time::Instant::now();
                for _ in 0..120 { advance(&mut cases[index],index==0); }
                rows[index].push(start.elapsed().as_secs_f64()*1000.0/120.0);
            }
        }
        let sleeping: Vec<usize> = cases.iter().map(|s|s.props.values().filter(|e|s.app.world().get::<Sleeping>(**e).is_some()).count()).collect();
        assert_eq!(sleeping,[0,COUNT]);
        for sim in &cases { for entity in sim.props.values() {
            assert!((sim.app.world().get::<Position>(*entity).unwrap().y-0.5).abs()<0.03);
        } }
        println!("{{\"bodies\":{COUNT},\"fixedHz\":120,\"substeps\":8,\"beforeMillisecondsPerFrame\":{:?},\"afterMillisecondsPerFrame\":{:?},\"sleepingBeforeAfter\":{:?}}}",rows[0],rows[1],sleeping);
    }
    #[test]
    fn first_force_step_uses_spawned_mass_and_stop_removes_load() {
        let mut sim=RallyPhysics::new();
        assert!(sim.wake_prop(51,0,&[0.5,0.5,0.5],&[-10.0,100.0,0.0,0.0,0.0,0.0,1.0],10.0,0.0,0.0,false));
        assert!(sim.set_disaster_loads(&[51.0,100.0,0.0,0.0,0.0,0.0,0.0]));
        sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        let state=sim.disaster_motion();let body=state.chunks_exact(7).find(|b|b[0]==51.0).unwrap();
        assert!((body[4]-1.0/12.0).abs()<0.002,"first step velocity {}",body[4]);
        let before=body[4];assert!(sim.set_disaster_loads(&[]));sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        let state=sim.disaster_motion();let body=state.chunks_exact(7).find(|b|b[0]==51.0).unwrap();assert!((body[4]-before).abs()<0.001);
    }
}
