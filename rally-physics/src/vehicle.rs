use avian3d::prelude::*;
use bevy::prelude::*;
use crate::{driving::PlayerCar,controller::Car};

/// Everything that makes one car feel different from another. Units are SI.
/// Geometry (mounts, rest/travel/extension, radius, body boxes) matches the
/// rendered models; the rest is a plausible real-world setup for each car.
#[derive(Resource,Clone,Debug)]
pub struct VehicleConfig {
    pub mass:f32, pub com:f32, pub inertia:Vec3,
    // Centre of mass ahead (+) or behind (-) mid-wheelbase, m: a mid- or rear-engined car carries
    // 57 to 61 % on its rear axle, and a rear-drive launch depends on it (L9 cars, item 7).
    pub com_z:f32,
    pub mounts:[Vec3;4], pub wheelbase:f32,
    // Suspension: zero-force length `rest`, bump travel below it, droop to `extension`.
    pub radius:f32, pub width:f32, pub rest:f32, pub travel:f32, pub extension:f32,
    pub spring_front:f32, pub spring_rear:f32, pub bump:f32, pub rebound:f32,
    pub arb_front:f32, pub arb_rear:f32, pub roll_centre:f32,
    // Tyres: peak friction multiplier on sealed and on loose surfaces, wheel inertia.
    pub grip_road:f32, pub grip_loose:f32, pub wheel_inertia:f32,
    // Engine and driveline.
    pub idle:f32, pub peak_rpm:f32, pub redline:f32, pub peak_torque:f32, pub engine_brake:f32,
    pub engine_inertia:f32, pub gears:Vec<f32>, pub reverse:f32, pub final_drive:f32,
    pub shift_time:f32, pub front_share:f32, pub diff_lock:f32, pub top_speed:f32,
    pub brake_torque:f32, pub brake_front:f32, pub handbrake_torque:f32,
    pub drag:f32, pub max_steer:f32,
    /// Newtons of aerodynamic downforce per (m/s)^2 of forward airspeed.
    pub aero_load:f32,
    // Collision boxes (full sizes) and hull buoyancy.
    pub body:Vec3, pub body_y:f32, pub cabin:Vec3, pub cabin_y:f32, pub cabin_z:f32,
    pub displacement:f32, pub paddle:f32,
}
impl Default for VehicleConfig { fn default()->Self { Self::aster() } }
impl VehicleConfig {
    /// Aster RS: 1970s rally coupe, 1,250 kg, 2.0 litre six, rear drive, road tyres.
    pub fn aster()->Self {
        Self { mass:1250.0,com:0.52,com_z:0.0,inertia:Vec3::new(1550.0,1850.0,600.0),
            mounts:[Vec3::new(-0.79,0.68,1.32),Vec3::new(0.79,0.68,1.32),Vec3::new(-0.79,0.68,-1.32),Vec3::new(0.79,0.68,-1.32)],
            wheelbase:2.64,
            radius:0.34,width:0.235,rest:0.43,travel:0.28,extension:0.49,
            spring_front:38000.0,spring_rear:34000.0,bump:3600.0,rebound:5200.0,
            arb_front:16000.0,arb_rear:7000.0,roll_centre:0.18,
            grip_road:1.0,grip_loose:0.88,wheel_inertia:1.1,
            idle:850.0,peak_rpm:5200.0,redline:7200.0,peak_torque:250.0,engine_brake:55.0,
            engine_inertia:0.16,gears:vec![3.35,2.12,1.48,1.14,0.92],reverse:3.2,final_drive:3.9,
            shift_time:0.16,front_share:0.0,diff_lock:70.0,top_speed:62.0,
            brake_torque:2600.0,brake_front:0.64,handbrake_torque:2400.0,
            drag:0.47,max_steer:0.58,aero_load:0.0,
            body:Vec3::new(1.72,0.48,4.10),body_y:0.64,
            cabin:Vec3::new(1.52,0.55,2.10),cabin_y:1.07,cabin_z:-0.15,
            displacement:0.65,paddle:650.0 }
    }
    /// Lifted black Jeep: 2,100 kg, 5.7 litre V8, full-time 4x4, mud-terrain tyres.
    pub fn jeep()->Self {
        Self { mass:2100.0,com:0.92,com_z:0.0,inertia:Vec3::new(3500.0,4200.0,1600.0),
            mounts:[Vec3::new(-1.02,0.99,1.38),Vec3::new(1.02,0.99,1.38),Vec3::new(-1.02,0.99,-1.38),Vec3::new(1.02,0.99,-1.38)],
            wheelbase:2.76,
            radius:0.47,width:0.38,rest:0.65,travel:0.35,extension:0.77,
            spring_front:44000.0,spring_rear:46000.0,bump:5200.0,rebound:7600.0,
            arb_front:26000.0,arb_rear:21000.0,roll_centre:0.34,
            grip_road:0.92,grip_loose:1.08,wheel_inertia:3.2,
            idle:650.0,peak_rpm:4000.0,redline:5600.0,peak_torque:480.0,engine_brake:95.0,
            engine_inertia:0.28,gears:vec![4.03,2.36,1.53,1.15,0.85],reverse:3.6,final_drive:4.1,
            shift_time:0.24,front_share:0.42,diff_lock:140.0,top_speed:44.5,
            brake_torque:4600.0,brake_front:0.62,handbrake_torque:3600.0,
            drag:0.95,max_steer:0.56,aero_load:0.0,
            body:Vec3::new(1.82,0.46,4.16),body_y:0.98,
            cabin:Vec3::new(1.72,0.93,2.58),cabin_y:1.64,cabin_z:-0.70,
            displacement:0.72,paddle:1100.0 }
    }
    // The cars added for item 7. docs/cars.md gives each reference car with its sources. Real figures:
    // mass, track, wheelbase, tyre radius, gear ratios, final drive, redline, drivetrain. Declared
    // (game choices, held to the real outcome by the tests.rs NEW_CARS bands): spring and damper
    // rates, inertias, collision boxes, and `peak_torque`, set so the shared torque_curve gives the
    // published peak power at the published rpm (it falls to 0.9 at 0.9 x redline, so a flat
    // published torque figure alone undershoots the power). One radius serves all four wheels, so
    // staggered front and rear tyres use their mean. COM sits mid-wheelbase like the other cars.
    // Ride height: mount - rest + static sag (quarter weight / spring rate) = radius. Axle loads
    // follow `com_z` from the published front:rear split: 43:57 (Fulmine, Corsaire), 39:61 (Kestrel),
    // about 40:60 (Sandpiper, engine behind the rear axle).

    /// Fulmine V10: Huracan EVO-class mid-engine supercar. 1,550 kg as road-tested, 5.2 L V10
    /// 470 kW at 8,000 rpm and 600 Nm at 6,500 (published 640 CV), 8,500 rpm redline, 7-speed
    /// dual clutch, rear-biased all-wheel drive, 245/30 R20 and 305/30 R20, 2.62 m wheelbase,
    /// 1.668 / 1.620 m track, 325 km/h.
    pub fn supercar()->Self {
        Self { mass:1550.0,com:0.42,com_z:-0.18,inertia:Vec3::new(1950.0,2350.0,700.0),
            mounts:[Vec3::new(-0.834,0.56,1.31),Vec3::new(0.834,0.56,1.31),Vec3::new(-0.81,0.56,-1.31),Vec3::new(0.81,0.56,-1.31)],
            wheelbase:2.62,
            radius:0.336,width:0.275,rest:0.275,travel:0.14,extension:0.32,
            spring_front:72000.0,spring_rear:78000.0,bump:4800.0,rebound:7400.0,
            arb_front:30000.0,arb_rear:20000.0,roll_centre:0.10,
            grip_road:1.2,grip_loose:0.8,wheel_inertia:1.3,
            idle:1000.0,peak_rpm:6500.0,redline:8500.0,peak_torque:660.0,engine_brake:80.0,
            engine_inertia:0.18,gears:vec![3.13,2.59,1.96,1.57,1.26,1.03,0.87],reverse:2.8,final_drive:3.62,
            shift_time:0.08,front_share:0.35,diff_lock:110.0,top_speed:90.3,
            brake_torque:3900.0,brake_front:0.62,handbrake_torque:2600.0,
            drag:0.50,max_steer:0.55,aero_load:0.0,
            body:Vec3::new(1.90,0.45,4.45),body_y:0.36,
            cabin:Vec3::new(1.45,0.42,1.90),cabin_y:0.86,cabin_z:-0.10,
            displacement:0.55,paddle:600.0 }
    }
    /// Corsaire W16: Chiron-class hypercar. 1,995 kg, 8.0 L quad-turbo W16 1,103 kW at 6,700 rpm
    /// and 1,600 Nm from 2,000 to 6,000, 7-speed dual clutch, all-wheel drive, 285/30 R20 and
    /// 355/25 R21, 2.711 m wheelbase, 1.748 / 1.663 m track, governed at 380 km/h (the maker's
    /// limit outside top-speed mode).
    pub fn hypercar()->Self {
        Self { mass:1995.0,com:0.45,com_z:-0.19,inertia:Vec3::new(2600.0,3100.0,950.0),
            mounts:[Vec3::new(-0.874,0.58,1.355),Vec3::new(0.874,0.58,1.355),Vec3::new(-0.83,0.58,-1.355),Vec3::new(0.83,0.58,-1.355)],
            wheelbase:2.711,
            radius:0.348,width:0.32,rest:0.286,travel:0.14,extension:0.33,
            spring_front:86000.0,spring_rear:94000.0,bump:5600.0,rebound:8600.0,
            arb_front:36000.0,arb_rear:26000.0,roll_centre:0.12,
            grip_road:1.25,grip_loose:0.8,wheel_inertia:1.6,
            idle:900.0,peak_rpm:5000.0,redline:6800.0,peak_torque:1900.0,engine_brake:120.0,
            engine_inertia:0.35,gears:vec![3.25,2.29,1.73,1.32,1.04,0.84,0.69],reverse:3.0,final_drive:3.09,
            shift_time:0.08,front_share:0.4,diff_lock:160.0,top_speed:105.6,
            brake_torque:5400.0,brake_front:0.62,handbrake_torque:3400.0,
            drag:0.49,max_steer:0.52,aero_load:0.0,
            body:Vec3::new(2.00,0.50,4.48),body_y:0.37,
            cabin:Vec3::new(1.55,0.45,1.90),cabin_y:0.92,cabin_z:-0.15,
            displacement:0.6,paddle:700.0 }
    }
    /// Petrel GT (was "Kestrel GT"; renamed so it does not share a name with the KESTREL 07
    /// jet): 911 GT3 (992) class, the road car of the GT3 racing class. 1,450 kg (DIN, PDK), 4.0 L
    /// flat six 375 kW at 8,400 rpm and 470 Nm at 6,100, 9,000 rpm redline, 7-speed PDK
    /// 3.75 2.38 1.72 1.34 1.11 0.96 0.84 on a 4.54 final drive, rear drive, 318 km/h.
    /// Geometry is the drawn car's, public/rally/concept_gt.glb (assets/rally/asset_report.json):
    /// 0.384 m tyre radius, 0.284 m tread, 2.798 m wheelbase, 1.952 / 1.964 m track, 2.236 x 1.149 x
    /// 4.357 m body. It is wider and longer than a 911 (2.457 m wheelbase, 1.601 / 1.553 m track,
    /// 20 / 21 in wheels), so the wheels sit in its arches; `com_z` keeps the 911's 39:61 split on
    /// the longer wheelbase. Mount 0.612 m = radius + rest - static sag (about 0.047 m).
    pub fn gt()->Self {
        Self { mass:1450.0,com:0.46,com_z:-0.308,inertia:Vec3::new(1750.0,2100.0,650.0),
            mounts:[Vec3::new(-0.976,0.612,1.399),Vec3::new(0.976,0.612,1.399),Vec3::new(-0.982,0.612,-1.399),Vec3::new(0.982,0.612,-1.399)],
            wheelbase:2.798,
            radius:0.384,width:0.284,rest:0.275,travel:0.13,extension:0.31,
            spring_front:70000.0,spring_rear:80000.0,bump:4600.0,rebound:7000.0,
            arb_front:28000.0,arb_rear:18000.0,roll_centre:0.10,
            grip_road:1.25,grip_loose:0.8,wheel_inertia:1.3,
            idle:900.0,peak_rpm:6100.0,redline:9000.0,peak_torque:495.0,engine_brake:70.0,
            engine_inertia:0.14,gears:vec![3.75,2.38,1.72,1.34,1.11,0.96,0.84],reverse:3.42,final_drive:4.54,
            shift_time:0.08,front_share:0.0,diff_lock:90.0,top_speed:88.3,
            brake_torque:3900.0,brake_front:0.6,handbrake_torque:2600.0,
            drag:0.44,max_steer:0.55,aero_load:0.0,
            body:Vec3::new(2.20,0.50,4.30),body_y:0.40,
            cabin:Vec3::new(1.60,0.50,2.00),cabin_y:0.90,cabin_z:-0.25,
            displacement:0.55,paddle:600.0 }
    }
    pub fn buggy()->Self {
        Self { mass:620.0,com:0.50,com_z:-0.20,inertia:Vec3::new(480.0,560.0,200.0),
            mounts:[Vec3::new(-0.655,0.70,1.016),Vec3::new(0.655,0.70,1.016),Vec3::new(-0.675,0.70,-1.016),Vec3::new(0.675,0.70,-1.016)],
            wheelbase:2.032,
            radius:0.345,width:0.2,rest:0.44,travel:0.25,extension:0.52,
            spring_front:18000.0,spring_rear:20000.0,bump:1500.0,rebound:2300.0,
            arb_front:5000.0,arb_rear:0.0,roll_centre:0.25,
            grip_road:0.85,grip_loose:1.1,wheel_inertia:1.0,
            idle:900.0,peak_rpm:3400.0,redline:5600.0,peak_torque:147.0,engine_brake:30.0,
            engine_inertia:0.12,gears:vec![3.80,2.06,1.26,0.89],reverse:3.88,final_drive:4.125,
            shift_time:0.3,front_share:0.0,diff_lock:20.0,top_speed:45.0,
            brake_torque:1400.0,brake_front:0.6,handbrake_torque:1000.0,
            drag:0.60,max_steer:0.62,aero_load:0.0,
            body:Vec3::new(1.50,0.40,3.30),body_y:0.50,
            cabin:Vec3::new(1.20,0.60,1.10),cabin_y:1.00,cabin_z:-0.30,
            displacement:0.3,paddle:450.0 }
    }
    /// COSIER 992 GT3 RS. Porsche MY2022 figures and the approved rig's hub coordinates
    /// (metres, +Z forward) are in docs/gt3-rs.md. Use the mean rolling radius for the
    /// four contact rays. The visual rig retains its staggered tyres and factory camber.
    pub fn gt3rs()->Self {
        Self { mass:1450.0,com:0.46,com_z:-0.27,inertia:Vec3::new(1660.0,1980.0,575.0),
            mounts:[Vec3::new(-0.815,0.584,1.2285),Vec3::new(0.815,0.584,1.2285),Vec3::new(-0.791,0.584,-1.2285),Vec3::new(0.791,0.584,-1.2285)],
            wheelbase:2.457,radius:0.359,width:0.305,rest:0.27,travel:0.13,extension:0.31,
            spring_front:69000.0,spring_rear:90000.0,grip_road:1.35,
            idle:900.0,peak_rpm:6300.0,redline:9000.0,peak_torque:510.0,final_drive:4.27,
            // 409 kg-equivalent at 200 km/h (992 RS launch data).
            top_speed:82.22,drag:0.52,aero_load:1.30,
            body:Vec3::new(1.90,0.50,4.55),body_y:0.39,
            cabin:Vec3::new(1.46,0.58,1.97),cabin_y:0.99,cabin_z:-0.13,
            ..Self::gt() }
    }
    /// Kinds the bridge accepts: 0 Aster, 1 Jeep, 2 supercar, 3 hypercar, 4 GT, 5 buggy, 6 GT3 RS.
    pub const COUNT:u8=7;
    pub fn of(kind:u8)->Self {
        match kind { 1=>Self::jeep(), 2=>Self::supercar(), 3=>Self::hypercar(), 4=>Self::gt(), 5=>Self::buggy(), 6=>Self::gt3rs(), _=>Self::aster() }
    }
    /// Rounded boxes let a glancing car slide along walls and rails instead of snagging a corner.
    pub fn collider(&self)->Collider {
        let rounded=|size:Vec3,r:f32| Collider::round_cuboid((size.x-2.0*r).max(0.05),(size.y-2.0*r).max(0.05),(size.z-2.0*r).max(0.05),r);
        Collider::compound(vec![
            (Vec3::new(0.0,self.body_y,0.0),Quat::IDENTITY,rounded(self.body,0.12)),
            (Vec3::new(0.0,self.cabin_y,self.cabin_z),Quat::IDENTITY,rounded(self.cabin,0.14)),
        ])
    }
    /// Lowest point of the body hull above the car origin, and total hull height.
    pub fn hull(&self)->(f32,f32) {
        let bottom=self.body_y-self.body.y*0.5;
        (bottom,(self.cabin_y+self.cabin.y*0.5)-bottom)
    }
}

pub fn bundle(config:&VehicleConfig)->impl Bundle + use<> {
    (PlayerCar,RigidBody::Dynamic,TransformInterpolation,config.collider(),
        Mass(config.mass),CenterOfMass::new(0.0,config.com,config.com_z),AngularInertia::new(config.inertia),
        Friction::new(0.3),Restitution::new(0.08),SleepingDisabled,
        // Thin rails and posts must stop a car at 150 km/h; sweeps only when fast.
        SweptCcd { linear_threshold:6.0, ..SweptCcd::LINEAR },
        Car::new(config))
}
