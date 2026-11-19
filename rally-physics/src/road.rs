use bevy::prelude::*;

/// Marks the island heightfield; its surface comes from the terrain map and roads.
#[derive(Component)]
pub struct TerrainSurface;
/// Surface of an imported static prop (pier boards, rails, logs, walls).
#[derive(Component,Clone,Copy)]
pub struct PropSurface(pub Surface);

/// Surface kinds shared with the renderer (tyre marks, HUD) through the snapshot.
#[derive(Clone,Copy,PartialEq,Eq,Debug,Default)]
#[repr(u8)]
pub enum Surface { #[default] Sand=0, Soil=1, Rock=2, Asphalt=3, Gravel=4, Wood=5, Water=6, WetSand=7 }

/// Tyre/ground behaviour. `peak` is the friction coefficient at the slip peak and
/// `tail` the fraction left when fully sliding (asphalt drops away, sand does not);
/// `rise` shapes the build-up to the peak (initial stiffness). Slip ratio and slip
/// angle peaks set where the maximum occurs; rolling and sink are drag per unit load.
#[derive(Clone,Copy,Debug)]
pub struct Grip { pub peak:f32, pub tail:f32, pub rise:f32, pub ratio_peak:f32, pub angle_peak:f32, pub rolling:f32, pub sink:f32, pub loose:bool }

impl Surface {
    pub fn grip(self)->Grip {
        let g=|peak,tail,rise,ratio_peak,angle_deg:f32,rolling,sink,loose| Grip { peak, tail, rise, ratio_peak, angle_peak:angle_deg.to_radians().tan(), rolling, sink, loose };
        match self {
            // Soft dry sand: modest, late peak that never falls away (sand piles up ahead of a
            // sliding tyre) and heavy rolling drag. Wet sand near the sea is firmer.
            Surface::Sand => g(0.66,1.0,1.7,0.20,13.0,0.040,0.9,true),
            Surface::WetSand => g(0.74,0.94,1.9,0.15,10.0,0.020,0.25,true),
            Surface::Soil => g(0.72,0.90,2.0,0.16,10.0,0.028,0.3,true),
            Surface::Gravel => g(0.76,0.90,2.0,0.16,11.0,0.022,0.2,true),
            Surface::Rock => g(0.92,0.80,2.3,0.11,8.0,0.015,0.0,false),
            Surface::Asphalt => g(1.02,0.76,2.5,0.10,7.0,0.012,0.0,false),
            Surface::Wood => g(0.72,0.78,2.3,0.10,8.0,0.015,0.0,false),
            Surface::Water => g(0.50,1.0,1.6,0.20,14.0,0.050,1.4,true),
        }
    }
    pub fn from_code(code:u8)->Self {
        match code { 1=>Surface::Soil, 2=>Surface::Rock, 3=>Surface::Asphalt, 4=>Surface::Gravel, 5=>Surface::Wood, 6=>Surface::Water, 7=>Surface::WetSand, _=>Surface::Sand }
    }
}

/// Road ribbons as [ax, az, bx, bz, half width, grip]; grip >= 0.9 is asphalt, otherwise gravel.
/// Asphalt wins where a gravel access overlaps the loop.
#[derive(Resource,Default)]
pub struct RoadSurfaces(pub Vec<[f32;6]>);
impl RoadSurfaces {
    pub fn grip(&self,x:f32,z:f32)->Option<f32> {
        let mut result:Option<f32>=None;
        for s in &self.0 {
            if x<s[0].min(s[2])-s[4] || x>s[0].max(s[2])+s[4] || z<s[1].min(s[3])-s[4] || z>s[1].max(s[3])+s[4] {continue;}
            let dx=s[2]-s[0]; let dz=s[3]-s[1]; let l2=dx*dx+dz*dz;
            if l2<0.001 {continue;}
            let t=(((x-s[0])*dx+(z-s[1])*dz)/l2).clamp(0.0,1.0);
            if (x-s[0]-dx*t).powi(2)+(z-s[1]-dz*t).powi(2)<=s[4]*s[4] {
                result=Some(result.unwrap_or(0.0).max(s[5]));
            }
        }
        result
    }
    pub fn surface(&self,x:f32,z:f32)->Option<Surface> {
        self.grip(x,z).map(|grip| if grip>=0.9 { Surface::Asphalt } else { Surface::Gravel })
    }
}

/// Texel-centred terrain material codes (0 dry sand, 1 soil/grass, 2 rock, 7 wet sand),
/// on the same grid as the heightfield.
#[derive(Resource,Default)]
pub struct TerrainMaterials { pub codes:Vec<u8>, pub res:usize, pub origin:f32, pub texel:f32 }
impl TerrainMaterials {
    pub fn at(&self,x:f32,z:f32)->Surface {
        if self.res==0 || self.codes.len()!=self.res*self.res { return Surface::Sand; }
        let cell=|v:f32| (((v-self.origin)/self.texel).floor() as i64).clamp(0,self.res as i64-1) as usize;
        Surface::from_code(self.codes[cell(z)*self.res+cell(x)])
    }
}

/// Local sea surface near the car, fitted by the renderer from GPU wave queries:
/// height at (x0, z0), slope and vertical rate. Inactive on dry land and in tests.
#[derive(Resource,Default,Clone,Copy,Debug)]
pub struct WaterPlane { pub active:bool, pub height:f32, pub slope_x:f32, pub slope_z:f32, pub x0:f32, pub z0:f32, pub rate:f32 }
impl WaterPlane {
    pub fn height_at(&self,x:f32,z:f32)->Option<f32> {
        self.active.then(|| self.height+self.slope_x*(x-self.x0)+self.slope_z*(z-self.z0))
    }
}

/// Uniform sampled air and horizontal-water velocities at the local car, SI m/s.
/// WaterPlane separately supplies height, slope and vertical surface rate.
#[derive(Resource,Default,Clone,Copy,Debug)]
pub struct FluidVelocity { pub air:Vec3, pub current:Vec3 }
