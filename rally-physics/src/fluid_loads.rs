//! Frozen-coefficient, coupled rigid-body drag for the actual held 120 Hz interval.
//! All fluid points share the body's mass and WORLD angular inertia. This is an
//! implicit discretization of the existing drag law, not a velocity/force clamp.
use bevy::prelude::*;

pub(crate) struct FluidLoads {
    mass: [[f64; 6]; 6], system: [[f64; 6]; 6], rhs: [f64; 6],
    twist: [f64; 6], dt: f64,
}
impl FluidLoads {
    pub(crate) fn new(mass:f32, inertia:Mat3, velocity:Vec3, omega:Vec3, dt:f32)->Self {
        let mut m=[[0.0;6];6];let columns=inertia.to_cols_array_2d();
        for i in 0..3 {m[i][i]=mass as f64;for j in 0..3 {m[i+3][j+3]=columns[j][i] as f64;}}
        Self{mass:m,system:m,rhs:[0.0;6],twist:[velocity.x as f64,velocity.y as f64,velocity.z as f64,omega.x as f64,omega.y as f64,omega.z as f64],dt:dt as f64}
    }
    fn row(&mut self,b:[f64;6],coefficient:f32,target:f32){
        let k=self.dt*coefficient as f64;let relative=target as f64-b.iter().zip(self.twist).map(|(a,v)|a*v).sum::<f64>();
        for i in 0..6 {self.rhs[i]+=k*b[i]*relative;for j in 0..6 {self.system[i][j]+=k*b[i]*b[j];}}
    }
    /// A force direction, N/(m/s), and fluid speed along that direction. Offset is
    /// measured from the real COM, so every point includes angular relative flow.
    pub(crate) fn point(&mut self,offset:Vec3,direction:Vec3,coefficient:f32,fluid_speed:f32){
        let r=offset.cross(direction);self.row([direction.x as f64,direction.y as f64,direction.z as f64,r.x as f64,r.y as f64,r.z as f64],coefficient,fluid_speed);
    }
    /// Isotropic rotational resistance, N m/(rad/s), relative to nonrotating water.
    pub(crate) fn angular(&mut self,coefficient:f32){for i in 3..6 {let mut b=[0.0;6];b[i]=1.0;self.row(b,coefficient,0.0);}}
    pub(crate) fn solve(&self)->(Vec3,Vec3){
        let mut l=[[0.0;6];6];let mut y=[0.0;6];let mut delta=[0.0;6];
        // M is positive definite; every nonnegative drag row adds dt*k*b*b'.
        for i in 0..6 {for j in 0..=i {let mut v=self.system[i][j];for k in 0..j {v-=l[i][k]*l[j][k];}l[i][j]=if i==j {v.sqrt()}else{v/l[j][j]};}}
        for i in 0..6 {let mut v=self.rhs[i];for j in 0..i {v-=l[i][j]*y[j];}y[i]=v/l[i][i];}
        for i in (0..6).rev(){let mut v=y[i];for j in i+1..6 {v-=l[j][i]*delta[j];}delta[i]=v/l[i][i];}
        let mut load=[0.0;6];for i in 0..6 {load[i]=self.mass[i].iter().zip(delta).map(|(m,v)|m*v).sum::<f64>()/self.dt;}
        (Vec3::new(load[0] as f32,load[1] as f32,load[2] as f32),Vec3::new(load[3] as f32,load[4] as f32,load[5] as f32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn implicit_single_axis_has_analytical_relaxation(){
        let mut f=FluidLoads::new(10.0,Mat3::IDENTITY,Vec3::X*20.0,Vec3::ZERO,0.1);
        f.point(Vec3::ZERO,Vec3::X,1000.0,0.0);let (force,torque)=f.solve();
        assert!((20.0+force.x*0.1/10.0-20.0/11.0).abs()<1e-5);assert_eq!(torque,Vec3::ZERO);
    }
    #[test]
    fn coupled_points_dissipate_with_rotated_unequal_inertia(){
        for dt in [1.0/120.0,1.0/30.0,0.1] {for angle in [0.0,0.7,1.57] {
            let rotation=Mat3::from_quat(Quat::from_euler(EulerRot::XYZ,angle,-0.6,1.1));
            let inertia=rotation*Mat3::from_diagonal(Vec3::new(1500.0,12.0,650.0))*rotation.transpose();
            let v=Vec3::new(270.0,-180.0,310.0);let w=Vec3::new(50.0,120.0,-60.0);let mut f=FluidLoads::new(1250.0,inertia,v,w,dt);
            for x in [-0.9,0.0,0.9] {for z in [-1.9,-0.6,0.6,1.9] {let r=rotation*Vec3::new(x,-0.4,z);let point_v=v+w.cross(r);for n in [Vec3::X,Vec3::Y,Vec3::Z] {f.point(r,n,200.0+450.0*point_v.dot(n).abs(),0.0);}}}
            f.angular(1800.0);let (force,torque)=f.solve();let dv=force*dt/1250.0;let dw=inertia.inverse()*torque*dt;
            let before=0.5*1250.0*v.length_squared()+0.5*w.dot(inertia*w);let after=0.5*1250.0*(v+dv).length_squared()+0.5*(w+dw).dot(inertia*(w+dw));
            assert!(after>=0.0&&after<before,"dt{dt}, angle{angle}: {before}->{after}");
            let work=force.dot(v+dv*0.5)*dt+torque.dot(w+dw*0.5)*dt;
            assert!((after-before-work).abs()<before*2e-6,"rigid impulse work closure");
        }}
    }
    #[test]
    fn comoving_points_have_exactly_zero_drag(){
        let v=Vec3::new(400.0,0.0,-320.0);let mut f=FluidLoads::new(1250.0,Mat3::IDENTITY,v,Vec3::ZERO,0.1);
        for r in [Vec3::new(1.0,-0.5,2.0),Vec3::new(-1.0,-0.5,-2.0)] {for n in [Vec3::X,Vec3::Y,Vec3::Z] {f.point(r,n,900000.0,v.dot(n));}}
        assert_eq!(f.solve(),(Vec3::ZERO,Vec3::ZERO));
    }
}
