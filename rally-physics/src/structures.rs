//! Compliant material connections between actual contact bodies.
//! Compliance is m/N and rad/(N m). Failure is evaluated after every 120 Hz step.
//! Removed elastic energy is recorded as fracture dissipation; no launch impulse.
use avian3d::prelude::*;
use avian3d::dynamics::solver::islands::WakeBody;
use bevy::prelude::*;
use wasm_bindgen::prelude::*;
use crate::RallyPhysics;

pub(crate) struct Connection {
    entity: Entity, a: Entity, b: Entity, ra: Vec3, rb: Vec3,
    qa: Quat, qb: Quat, linear: f32, angular: f32, force_limit: f32, torque_limit: f32,
    damping: f32, broken: bool, force: Vec3, torque: Vec3, extension: f32, angle: f32,
    energy: f32, numerical_energy: f32, fracture: f32, dissipated: f32, utilization: f32,
}
#[derive(Clone,Copy)]
struct Body {p:Vec3,q:Quat,v:Vec3,w:Vec3,inv_m:f32,inv_i:Mat3}
fn state(world:&World,e:Entity)->Option<Body>{
    let p=world.get::<Position>(e)?.0;let q=world.get::<Rotation>(e)?.0;
    let dynamic=world.get::<RigidBody>(e)==Some(&RigidBody::Dynamic);
    let rot=Mat3::from_quat(q);
    Some(Body{p,q,v:world.get::<LinearVelocity>(e).map_or(Vec3::ZERO,|v|v.0),w:world.get::<AngularVelocity>(e).map_or(Vec3::ZERO,|v|v.0),
        inv_m:if dynamic {world.get::<ComputedMass>(e).map_or(0.0,|m|m.inverse())}else{0.0},
        inv_i:if dynamic {world.get::<ComputedAngularInertia>(e).map_or(Mat3::ZERO,|i|rot*i.inverse()*rot.transpose())}else{Mat3::ZERO}})
}
fn apply(world:&mut World,e:Entity,body:Body,j:Vec3,angular:Vec3){
    if body.inv_m<=0.0{return;}
    if let Some(mut v)=world.get_mut::<LinearVelocity>(e){v.0+=j*body.inv_m;}
    if let Some(mut w)=world.get_mut::<AngularVelocity>(e){w.0+=body.inv_i*angular;}
}
impl RallyPhysics {
    pub(crate) fn supported_connections(&self,supported:&mut std::collections::HashSet<Entity>){
        supported.extend(self.anchors.values().copied());
        for _ in 0..self.connections.len().min(64){let n=supported.len();for c in self.connections.values(){if !c.broken{
            if supported.contains(&c.a){supported.insert(c.b);}if supported.contains(&c.b){supported.insert(c.a);}
        }}if n==supported.len(){break;}}
    }
    pub(crate) fn remove_body_connections(&mut self,e:Entity){
        let ids:Vec<u32>=self.connections.iter().filter_map(|(id,c)|(c.a==e||c.b==e).then_some(*id)).collect();
        for id in ids {self.remove_structure_joint(id);}
    }
    pub(crate) fn update_structure_connections(&mut self,dt:f32){
        let world=self.app.world_mut();
        for c in self.connections.values_mut(){
            if c.broken{continue;}
            let (Some(a),Some(b))=(state(world,c.a),state(world,c.b)) else {continue;};
            let ra=a.q*c.ra;let rb=b.q*c.rb;
            c.extension=(a.p+ra-b.p-rb).length();
            c.angle=((a.q*c.qa).inverse()*(b.q*c.qb)).to_scaled_axis().length();
            let geometric_energy=if c.linear>0.0 {0.5*c.extension*c.extension/c.linear}else{0.0}
                +if c.angular>0.0 {0.5*c.angle*c.angle/c.angular}else{0.0};
            if let Some(f)=world.get::<JointForces>(c.entity){c.force=f.force();c.torque=f.torque();}
            // Constitutive elastic energy recovered from solved reactions. The
            // solver's finite geometric constraint residual is disclosed separately.
            c.energy=0.5*(c.linear*c.force.length_squared()+c.angular*c.torque.length_squared());
            c.numerical_energy=geometric_energy-c.energy;
            c.utilization=c.force.length()/c.force_limit+c.torque.length()/c.torque_limit;
            if c.utilization>1.0 {
                c.broken=true;c.fracture+=c.energy;c.energy=0.0;
                // Removing the constraint enables ordinary contact between its former bodies.
                world.entity_mut(c.entity).remove::<(FixedJoint,JointCollisionDisabled)>();
                world.commands().queue(WakeBody(c.a));world.commands().queue(WakeBody(c.b));
                continue;
            }
            // Physical, equal/opposite velocity relaxation at the actual anchor.
            // Inverse effective mass includes both angular inertias. This impulse
            // cannot increase pair kinetic energy; rate is an assumed s^-1 loss.
            let fraction=1.0-(-c.damping*dt).exp();
            let relative=(b.v+b.w.cross(rb))-(a.v+a.w.cross(ra));let speed=relative.length();
            if speed>1e-7 && fraction>0.0 {
                let n=relative/speed;let ca=ra.cross(n);let cb=rb.cross(n);
                let inv=a.inv_m+b.inv_m+ca.dot(a.inv_i*ca)+cb.dot(b.inv_i*cb);
                if inv>1e-12 {let mag=speed*fraction/inv;let j=n*mag;
                    apply(world,c.a,a,j,ra.cross(j));apply(world,c.b,b,-j,-rb.cross(j));
                    c.dissipated+=mag*speed-0.5*mag*mag*inv;
                }
            }
            let (Some(a),Some(b))=(state(world,c.a),state(world,c.b)) else {continue;};
            let relative=b.w-a.w;let speed=relative.length();
            if speed>1e-7 && fraction>0.0 {let n=relative/speed;let inv=n.dot((a.inv_i+b.inv_i)*n);
                if inv>1e-12 {let mag=speed*fraction/inv;let j=n*mag;
                    apply(world,c.a,a,Vec3::ZERO,j);apply(world,c.b,b,Vec3::ZERO,-j);
                    c.dissipated+=mag*speed-0.5*mag*mag*inv;
                }
            }
        }
        world.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sim()->RallyPhysics{let mut s=RallyPhysics::new();s.app.insert_resource(Gravity(Vec3::ZERO));s.reset(150.0,150.0,150.0,0.0);s}
    fn body(s:&mut RallyPhysics,id:u32,x:f32,half:&[f32],mass:f32){assert!(s.wake_prop(id,0,half,&[x,0.0,0.0,0.0,0.0,0.0,1.0],mass,0.0,0.0,false));}
    fn step(s:&mut RallyPhysics,n:usize){for _ in 0..n{s.advance(1.0/120.0,0.0,0.0,0.0,0.0);}}
    fn joint(s:&RallyPhysics,id:u32)->Vec<f32>{s.structure_joint_states().chunks_exact(15).find(|v|v[0]==id as f32).unwrap().to_vec()}
    #[test]
    fn structural_axial_compliance_and_elastic_work(){
        let mut s=sim();body(&mut s,1,0.0,&[0.1,0.1,0.1],2.0);
        assert!(s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]));
        assert!(s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[0.001,0.000001,1000.0,1000.0,20.0]));
        s.set_disaster_loads(&[1.0,100.0,0.0,0.0,0.0,0.0,0.0]);step(&mut s,1200);
        let j=joint(&s,10);assert!((j[8]-0.1).abs()<0.003,"extension {:?}",j);
        assert!((j[10]-5.0).abs()<0.3,"spring work {:?}",j);
        assert!((Vec3::new(j[2],j[3],j[4]).length()-100.0).abs()<3.0,"reaction {:?}",j);
        assert!(s.disaster_supported().contains(&1.0));
    }
    #[test]
    fn structural_two_link_cantilever_matches_small_angle_beam(){
        let mut s=sim();body(&mut s,1,0.5,&[0.5,0.05,0.05],1.0);body(&mut s,2,1.5,&[0.5,0.05,0.05],1.0);
        s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]);
        // L=2m, EI=1000 N m², tip P=10N: delta=.02666667m, theta=.02rad.
        s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[1e-8,2.0/6000.0,1e6,1e6,12.0]);
        s.add_structure_joint(11,1,2,&[1.0,0.0,0.0],&[1e-8,4.0/3000.0,1e6,1e6,12.0]);
        s.set_disaster_loads(&[2.0,0.0,10.0,0.0,0.0,0.0,5.0]);step(&mut s,2400);
        let b=state(s.app.world(),s.props[&2]).unwrap();let tip=b.p+b.q*Vec3::X*0.5;
        eprintln!("beam tip {:?} q {:?} root {:?} mid {:?}",tip,b.q,joint(&s,10),joint(&s,11));
        assert!((tip.y-0.026666667).abs()<0.0013,"tip {:?}",tip);
        assert!((b.q.to_scaled_axis().z-0.02).abs()<0.001,"rotation {:?}",b.q);
        let root=joint(&s,10);let mid=joint(&s,11);assert!((root[10]+mid[10]-0.5*10.0*0.026666667).abs()<0.008,"constitutive work root {:?} mid {:?}",root,mid);assert!((root[7].abs()-20.0).abs()<1.0,"root moment {:?}",root);
    }
    #[test]
    fn structural_selective_failure_records_strain_without_launch(){
        let mut s=sim();body(&mut s,1,0.0,&[0.1,0.1,0.1],2.0);body(&mut s,2,1.0,&[0.1,0.1,0.1],2.0);
        s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]);
        s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[0.0001,0.001,10000.0,10000.0,3.0]);
        s.add_structure_joint(11,1,2,&[0.5,0.0,0.0],&[0.001,0.001,30.0,10000.0,3.0]);
        s.set_disaster_loads(&[2.0,100.0,0.0,0.0,0.0,0.0,0.0]);
        for _ in 0..240{step(&mut s,1);if joint(&s,11)[1]>0.0{break;}}
        let j=joint(&s,11);assert_eq!(j[1],1.0);assert!(j[11]>0.0);assert_eq!(j[10],0.0);assert_eq!(joint(&s,10)[1],0.0);
        let before=s.disaster_motion();s.update_structure_connections(1.0/120.0);let after=s.disaster_motion();
        let a=before.chunks_exact(7).find(|x|x[0]==2.0).unwrap();let b=after.chunks_exact(7).find(|x|x[0]==2.0).unwrap();assert_eq!(a,b,"broken connection adds no impulse");
        s.sleep_prop(2);assert!(s.structure_joint_states().chunks_exact(15).all(|x|x[0]!=11.0));s.sleep_prop(1);s.remove_structure_anchor(90);assert!(s.structure_joint_states().is_empty());
    }
}
#[wasm_bindgen]
impl RallyPhysics {
    /// Static connection frame without a duplicate collider. IDs share prop namespace.
    pub fn add_structure_anchor(&mut self,id:u32,pose:&[f32])->bool{
        if pose.len()!=7||pose.iter().any(|v|!v.is_finite())||self.props.contains_key(&id)||self.anchors.contains_key(&id){return false;}
        let q=Quat::from_xyzw(pose[3],pose[4],pose[5],pose[6]);if q.length_squared()<0.5{return false;}
        let p=Vec3::new(pose[0],pose[1],pose[2]);let q=q.normalize();
        let e=self.app.world_mut().spawn((RigidBody::Static,Position(p),Rotation(q),Transform::from_translation(p).with_rotation(q))).id();
        self.anchors.insert(id,e);true
    }
    pub fn remove_structure_anchor(&mut self,id:u32)->bool{
        let Some(e)=self.anchors.remove(&id)else{return false;};self.remove_body_connections(e);self.app.world_mut().despawn(e);true
    }
    /// Connection parameters: point compliance m/N, angular compliance rad/(N m),
    /// force capacity N, moment capacity N m, dissipative relaxation rate s^-1.
    pub fn add_structure_joint(&mut self,id:u32,a:u32,b:u32,anchor:&[f32],parameters:&[f32])->bool{
        if self.connections.len()>=512||self.connections.contains_key(&id)||anchor.len()!=3||parameters.len()!=5||anchor.iter().chain(parameters).any(|v|!v.is_finite())
            ||parameters[0]<0.0||parameters[1]<0.0||parameters[2]<=0.0||parameters[3]<=0.0||parameters[4]<0.0||parameters[4]>120.0{return false;}
        let lookup=|id|self.props.get(&id).or_else(||self.anchors.get(&id)).copied();
        let (Some(a),Some(b))=(lookup(a),lookup(b))else{return false;};if a==b{return false;}
        let w=self.app.world();let (Some(sa),Some(sb))=(state(w,a),state(w,b))else{return false;};
        let p=Vec3::new(anchor[0],anchor[1],anchor[2]);let ra=sa.q.inverse()*(p-sa.p);let rb=sb.q.inverse()*(p-sb.p);
        let qa=sa.q.inverse();let qb=sb.q.inverse();
        let joint=FixedJoint::new(a,b).with_local_anchor1(ra).with_local_anchor2(rb).with_local_basis1(qa).with_local_basis2(qb)
            .with_point_compliance(parameters[0]).with_angle_compliance(parameters[1]);
        let entity=self.app.world_mut().spawn((joint,JointForces::new(),JointCollisionDisabled)).id();
        self.connections.insert(id,Connection{entity,a,b,ra,rb,qa,qb,linear:parameters[0],angular:parameters[1],force_limit:parameters[2],torque_limit:parameters[3],damping:parameters[4],broken:false,force:Vec3::ZERO,torque:Vec3::ZERO,extension:0.0,angle:0.0,energy:0.0,numerical_energy:0.0,fracture:0.0,dissipated:0.0,utilization:0.0});true
    }
    pub fn remove_structure_joint(&mut self,id:u32)->bool{
        let Some(c)=self.connections.remove(&id)else{return false;};self.app.world_mut().despawn(c.entity);true
    }
    /// Fifteen values: id, broken, force3 N, moment3 Nm, extension m, angle rad,
    /// elastic energy J, fracture loss J, utilization, viscous loss J, geometric-minus-constitutive energy residual J.
    pub fn structure_joint_states(&self)->Vec<f32>{
        let mut out=Vec::with_capacity(self.connections.len()*15);
        for (id,c)in &self.connections{out.extend_from_slice(&[*id as f32,if c.broken{1.0}else{0.0},c.force.x,c.force.y,c.force.z,c.torque.x,c.torque.y,c.torque.z,c.extension,c.angle,c.energy,c.fracture,c.utilization,c.dissipated,c.numerical_energy]);}out
    }
}
