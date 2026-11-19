//! Tidewater's vehicle controller.
//!
//! Four sprung wheels find the ground with a ray plus a tyre-shaped cylinder cast
//! (so kerbs, logs and rocks are climbed, not clipped). Each wheel has its own spin
//! state; tyre forces come from combined slip ratio / slip angle on a per-surface
//! curve and share one friction circle. Engine, automatic gearbox, limited-slip
//! drive, anti-roll bars, ABS, traction control and a countersteer assist make it
//! behave like a real car that is still easy on a keyboard. A hull model floats the
//! car on the sea surface that the renderer measures. Nothing here moves the body
//! directly: every effect is a force at a real contact or hull point.
use std::f32::consts::{FRAC_PI_2,TAU};
use avian3d::prelude::*;
use bevy::prelude::*;
use crate::driving::{PlayerCar,input::DriveIntent};
use crate::road::{Grip,PropSurface,RoadSurfaces,Surface,TerrainMaterials,TerrainSurface,WaterPlane,FluidVelocity};
use crate::vehicle::VehicleConfig;

/// Wheel spin sub-steps per 120 Hz force step (720 Hz wheel dynamics).
const SUBSTEPS:usize = 6;
const GRAVITY:f32 = 9.81;
const WATER_DENSITY:f32 = 1025.0;
/// Below this speed slip is measured against a floor, which keeps a parked car still.
const SLIP_FLOOR:f32 = 3.0;
const DRIVELINE_EFFICIENCY:f32 = 0.88;
/// Reverse speed limit, m/s (27 km/h).
const REVERSE_TOP:f32 = 7.5;

#[derive(Clone,Copy,Debug)]
pub struct Wheel {
    pub grounded:bool,
    /// Mount to wheel centre along the suspension axis.
    pub length:f32,
    pub load:f32,
    pub steer:f32,
    /// Wheel spin, rad/s. Its surface speed is `omega * radius`.
    pub omega:f32,
    pub slip_ratio:f32,
    pub slip_angle:f32,
    /// 0 rolling cleanly .. 1 fully sliding, for marks and audio.
    pub slide:f32,
    pub point:Vec3,
    pub normal:Vec3,
    pub ground_speed:f32,
    pub lateral_speed:f32,
    pub surface:Surface,
}
impl Wheel {
    fn new(length:f32)->Self {
        Self { grounded:false,length,load:0.0,steer:0.0,omega:0.0,slip_ratio:0.0,slip_angle:0.0,slide:0.0,
            point:Vec3::ZERO,normal:Vec3::Y,ground_speed:0.0,lateral_speed:0.0,surface:Surface::Sand }
    }
}

#[derive(Component,Clone,Debug)]
pub struct Car {
    pub wheels:[Wheel;4],
    pub steering:f32,
    /// -1 reverse, 1.. forward. Display neutral is derived when parked.
    pub gear:i8,
    pub rpm:f32,
    pub shift_timer:f32,
    /// Throttle as the gearbox sees it (smoothed), and time since the last shift.
    pub shift_throttle:f32, pub since_shift:f32,
    pub throttle:f32, pub brake:f32, pub handbrake:f32,
    pub traction:f32, pub tc_active:bool, pub abs_active:bool, pub esc_active:bool,
    /// Parked with no demand: the brakes hold the car until the driver asks for motion.
    pub hold:bool,
    /// Front-brake hold requested by overlapping pedals at rest on a rear-drive car.
    pub line_lock:bool,
    /// Time stopped with the opposite pedal held, before the gearbox changes direction.
    pub direction_timer:f32,
    pub engine_load:f32,
    pub speed:f32,
    pub distance:f32,
    pub lateral_g:f32, pub longitudinal_g:f32, pub yaw_rate:f32, pub vertical_speed:f32,
    pub submerged:f32, pub water_height:Option<f32>, pub water_speed:f32,
    /// Hits since the renderer last collected them (capped).
    pub impacts:Vec<Impact>,
    last_velocity:Vec3,
}
impl Default for Car { fn default()->Self { Self::new(&VehicleConfig::default()) } }
impl Car {
    pub fn new(config:&VehicleConfig)->Self {
        Self { wheels:[Wheel::new(config.rest);4],steering:0.0,gear:1,rpm:config.idle,shift_timer:0.0,shift_throttle:0.0,since_shift:0.0,
            throttle:0.0,brake:0.0,handbrake:0.0,traction:1.0,tc_active:false,abs_active:false,esc_active:false,hold:false,line_lock:false,direction_timer:0.0,engine_load:0.0,
            speed:0.0,distance:0.0,lateral_g:0.0,longitudinal_g:0.0,yaw_rate:0.0,vertical_speed:0.0,
            submerged:0.0,water_height:None,water_speed:0.0,impacts:Vec::new(),last_velocity:Vec3::ZERO }
    }
    /// Gear shown to the driver: neutral while parked with no demand.
    pub fn display_gear(&self)->i8 {
        if self.gear>0 && self.speed.abs()<0.4 && self.throttle<0.01 { 0 } else { self.gear }
    }
    pub fn grounded(&self)->u8 { self.wheels.iter().filter(|w| w.grounded && w.load>1.0).count() as u8 }
}

/// Mechanical damage set by the renderer's damage model: engine power left (1 healthy),
/// a steering pull (rad), per-wheel toe from bent suspension (rad), spring strength left,
/// and wheels that have come off (their corner then rests on the body).
#[derive(Resource,Clone,Copy,Debug)]
pub struct Damage { pub engine:f32, pub pull:f32, pub toe:[f32;4], pub spring:[f32;4], pub lost:[bool;4], pub wing_lost:bool }
impl Default for Damage { fn default()->Self { Self { engine:1.0, pull:0.0, toe:[0.0;4], spring:[1.0;4], lost:[false;4], wing_lost:false } } }

/// A hit on the body: car-local point and push direction, and its severity as the change
/// in velocity it caused (m/s), so the same crash means the same thing for both cars.
#[derive(Clone,Copy,Debug)]
pub struct Impact { pub point:Vec3, pub direction:Vec3, pub delta_v:f32, pub prop:bool }

/// Driver aids: traction control and stability control (ABS always works).
#[derive(Resource,Clone,Copy,Debug)]
pub struct Assists(pub bool);
impl Default for Assists { fn default()->Self { Self(true) } }

#[derive(Clone,Copy)]
struct Contact { point:Vec3, normal:Vec3, length:f32, entity:Entity }

/// A kinematic body the game moves (the ferry's vehicle deck): cars on it ride along.
#[derive(Component)]
pub struct MovingPlatform;

/// Normalised tyre force: rises to 1 at s = 1, then settles to `tail` by s = 3.
fn curve(s:f32,g:&Grip)->f32 {
    if s<1.0 { 1.0-(1.0-s).powf(g.rise) } else {
        let t=((s-1.0)/2.0).min(1.0);
        1.0-(1.0-g.tail)*t*t*(3.0-2.0*t)
    }
}

/// Combined-slip tyre force in the contact frame: (longitudinal, lateral), plus the
/// normalised slip magnitude. Lateral force opposes lateral contact velocity.
fn tyre(omega:f32,radius:f32,vx:f32,vy:f32,fmax:f32,g:&Grip)->(f32,f32,f32) {
    let floor=vx.abs().max(SLIP_FLOOR);
    let sx=(omega*radius-vx)/floor/g.ratio_peak;
    let sy=(vy/floor)/g.angle_peak;
    let s=(sx*sx+sy*sy).sqrt();
    let per=if s<1e-4 { g.rise } else { curve(s,g)/s };
    (fmax*per*sx,-fmax*per*sy,s)
}

/// Engine torque fraction by rpm: flexible low end, peak torque, gentle fall to redline.
fn torque_curve(rpm:f32,c:&VehicleConfig)->f32 {
    let points=[(0.0,0.5),(c.idle,0.58),(c.peak_rpm*0.5,0.82),(c.peak_rpm,1.0),(c.redline*0.9,0.9),(c.redline,0.78),(c.redline*1.1,0.6)];
    for pair in points.windows(2) {
        let ((r0,t0),(r1,t1))=(pair[0],pair[1]);
        if rpm<=r1 { return t0+(t1-t0)*((rpm-r0)/(r1-r0)).clamp(0.0,1.0); }
    }
    0.6
}

fn smoothstep(e0:f32,e1:f32,x:f32)->f32 { let t=((x-e0)/(e1-e0)).clamp(0.0,1.0); t*t*(3.0-2.0*t) }

pub fn drive_forces(
    time:Res<Time<Fixed>>,
    config:Res<VehicleConfig>,
    intent:Res<DriveIntent>,
    roads:Res<RoadSurfaces>,
    materials:Res<TerrainMaterials>,
    water:Res<WaterPlane>,
    fluid:Res<FluidVelocity>,
    assists:Res<Assists>,
    damage:Res<Damage>,
    terrain:Query<(),With<TerrainSurface>>,
    props:Query<&PropSurface>,
    platforms:Query<(&Position,&LinearVelocity,&AngularVelocity),(With<MovingPlatform>,Without<PlayerCar>)>,
    poses:Query<(Entity,&Position,&Rotation,&ComputedMass,&ComputedAngularInertia,&ComputedCenterOfMass),With<PlayerCar>>,
    mut params:ParamSet<(SpatialQuery,Query<(Forces,&mut Car),With<PlayerCar>>)>,
) {
    let Ok((entity,position,rotation,mass,inertia,com))=poses.single() else { return; };
    let c=&*config;
    let q=rotation.0;
    let up=q*Vec3::Y;
    let forward=q*Vec3::Z;
    let down=Dir3::new(-up).unwrap_or(Dir3::NEG_Y);

    // ---- ground contacts: the ray finds the ground under the hub; the tyre-shaped
    // cast finds kerbs, logs and rock faces ahead of or behind it.
    let mut contacts:[Option<Contact>;4]=[None;4];
    {
        let spatial=params.p0();
        let filter=SpatialQueryFilter::from_excluded_entities([entity]);
        let tyre_shape=Collider::cylinder(c.radius*0.96,c.width*0.8);
        let axle=q*Quat::from_rotation_z(FRAC_PI_2);
        let cast=ShapeCastConfig::from_max_distance(c.extension);
        for (index,mount) in c.mounts.iter().enumerate() {
            let origin=position.0+q**mount;
            let mut best:Option<Contact>=None;
            if let Some(hit)=spatial.cast_ray(origin,down,c.extension+c.radius,true,&filter) {
                if hit.normal.dot(up)>0.3 {
                    best=Some(Contact { point:origin+*down*hit.distance, normal:hit.normal, length:hit.distance-c.radius, entity:hit.entity });
                }
            }
            if let Some(hit)=spatial.cast_shape(&tyre_shape,origin,axle,down,&cast,&filter) {
                let normal=hit.normal1.normalize_or_zero();
                if normal.dot(up)>0.45 && hit.distance<best.map_or(f32::MAX,|b| b.length)-0.01 {
                    best=Some(Contact { point:hit.point1, normal, length:hit.distance, entity:hit.entity });
                }
            }
            contacts[index]=best;
        }
    }

    // A wheel on a moving platform (the ferry's vehicle deck) rides with it: each contact
    // takes the deck's velocity at that point, and the car's own motion (speedo, gearbox,
    // drag, stability control) is measured over the deck under its wheels.
    let deck_at=|contact:&Option<Contact>| contact.and_then(|c| platforms.get(c.entity).ok()
        .map(|(origin,linear,spin)| (linear.0+spin.0.cross(c.point-origin.0),spin.0)));
    let decks:[Option<(Vec3,Vec3)>;4]=[deck_at(&contacts[0]),deck_at(&contacts[1]),deck_at(&contacts[2]),deck_at(&contacts[3])];
    let on_deck=decks.iter().flatten().count();
    let (deck_velocity,deck_spin)=if on_deck==0 { (Vec3::ZERO,Vec3::ZERO) } else {
        let sum=decks.iter().flatten().fold((Vec3::ZERO,Vec3::ZERO),|(v,w),(dv,dw)| (v+*dv,w+*dw));
        (sum.0/on_deck as f32,sum.1/on_deck as f32) };
    let ground_velocity=decks.map(|d| d.map_or(deck_velocity,|(v,_)| v));

    let mut query=params.p1();
    let Ok((mut forces,mut car))=query.single_mut() else { return; };
    let dt=time.delta_secs().max(1e-4);
    let h=dt/SUBSTEPS as f32;
    let velocity=forces.linear_velocity()-deck_velocity;
    let angular=forces.angular_velocity()-deck_spin;
    let speed=velocity.dot(forward);

    // ---- pedals and the automatic gearbox. S brakes, then reverses once stopped;
    // W brakes a reversing car, then selects first.
    let raw_throttle=intent.throttle.clamp(0.0,1.0);
    let raw_brake=intent.brake.clamp(0.0,1.0);
    let handbrake=intent.handbrake.clamp(0.0,1.0);
    // The car first stops, then holds for a moment before reverse (or first) engages, so
    // a held brake pedal never flips straight into a hard launch the other way.
    let to_reverse=car.gear>0 && raw_brake>0.0 && raw_throttle<0.05 && speed<0.6;
    let to_forward=car.gear<0 && raw_throttle>0.0 && speed>-0.6;
    car.direction_timer=if to_reverse || to_forward { car.direction_timer+dt } else { 0.0 };
    if to_reverse && car.direction_timer>0.5 { car.gear=-1; car.shift_timer=0.0; car.direction_timer=0.0; }
    if to_forward && car.direction_timer>0.15 { car.gear=1; car.shift_timer=0.0; car.direction_timer=0.0; }
    let (mut throttle,mut service)=if car.gear<0 { (raw_brake,raw_throttle) } else { (raw_throttle,raw_brake) };
    // Holding the pedal the wrong way brakes first.
    if car.gear>0 && speed< -0.6 { service=service.max(throttle); throttle=0.0; }
    if car.gear<0 && speed>0.6 { service=service.max(throttle); throttle=0.0; }
    // Two deliberate pedals stage a rear-drive launch. Use actual planar travel:
    // a sideways slide must never be mistaken for a stationary car.
    let road_speed=velocity.reject_from_normalized(up).length();
    car.line_lock=c.front_share==0.0 && car.gear>0 && handbrake<0.1 &&
        if car.line_lock { raw_brake>0.5 && raw_throttle>0.25 && road_speed<5.0 }
        else { raw_brake>0.8 && raw_throttle>0.7 && road_speed<1.0 };
    // Auto-hold: once a car without demand has (nearly) stopped, the brakes keep it
    // parked on a slope until the driver presses a pedal again.
    if raw_throttle>0.02 || raw_brake>0.02 { car.hold=false; }
    else if speed.abs()<0.5 { car.hold=true; }
    if car.hold { service=service.max(0.6); }

    let ratio_of=|gear:i8| if gear<0 { -c.reverse*c.final_drive } else { c.gears[(gear.max(1) as usize-1).min(c.gears.len()-1)]*c.final_drive };
    let rpm_per_rad=60.0/TAU;
    let ground_rpm=|gear:i8| (speed/c.radius*ratio_of(gear)*rpm_per_rad).abs();
    car.shift_timer=(car.shift_timer-dt).max(0.0);
    // Like a real automatic, shift on a smoothed throttle and never hunt between gears:
    // feathering the pedal holds the gear; only redline or lugging overrides the settle time.
    car.shift_throttle+=(throttle-car.shift_throttle)*(dt/0.6).min(1.0);
    car.since_shift+=dt;
    let grounded_before=car.grounded();
    if car.gear>0 && car.shift_timer==0.0 && grounded_before>=2 {
        let top=c.gears.len() as i8;
        let settled=car.since_shift>0.9;
        let demand=car.shift_throttle;
        let up_rpm=c.redline*(0.62+0.32*demand);
        let down_rpm=c.redline*(0.30+0.26*demand);
        let rpm_now=ground_rpm(car.gear);
        if car.gear<top && (rpm_now>c.redline*0.97 || (settled && rpm_now>up_rpm)) { car.gear+=1; car.shift_timer=c.shift_time; car.since_shift=0.0; }
        else if car.gear>1 && (rpm_now<c.idle*1.1 || (settled && rpm_now<down_rpm)) && ground_rpm(car.gear-1)<c.redline*0.9 {
            car.gear-=1; car.shift_timer=c.shift_time*0.7; car.since_shift=0.0;
        }
    }
    let ratio=ratio_of(car.gear);

    // ---- driven wheels, engine and clutch
    let share=|i:usize| if c.front_share>0.0 { if i<2 { c.front_share*0.5 } else { (1.0-c.front_share)*0.5 } } else if i<2 { 0.0 } else { 0.5 };
    let driven_omega:f32=(0..4).map(|i| share(i)*car.wheels[i].omega).sum();
    let wheel_rpm=(driven_omega*ratio*rpm_per_rad).abs();
    // Staging uses the engine's torque peak while the clutch takes up. The
    // normal gentle launch rpm can leave sticky rear tyres hooked up and drag
    // the locked fronts along after a bouncing spawn or on an uphill start.
    let launch_rpm=if car.line_lock { c.peak_rpm } else { c.peak_rpm*0.55 };
    let launch=c.idle+(launch_rpm-c.idle)*throttle;
    // The clutch slips below the launch speed, then locks the engine to the wheels.
    let coupled=car.shift_timer==0.0 && handbrake<0.5;
    // Engagement is how firmly the engine is tied to the wheels: slipping at launch it still
    // delivers torque, but adds no inertia and no engine braking.
    let engagement=if !coupled { 0.0 } else if throttle>0.02 { smoothstep(launch*0.8,launch,wheel_rpm) } else { smoothstep(c.idle*0.9,c.idle*1.3,wheel_rpm) };
    let target_rpm=if coupled { wheel_rpm.max(launch) } else { c.idle+(c.redline*0.8-c.idle)*throttle };
    car.rpm+=(target_rpm-car.rpm)*(dt*if wheel_rpm>=launch && coupled { 40.0 } else { 9.0 }).min(1.0);
    car.rpm=car.rpm.clamp(c.idle*0.8,c.redline*1.04);

    // Traction control trims torque while a driven tyre spins past its useful slip.
    let spin=(0..4).filter(|i| share(*i)>0.0 && car.wheels[*i].grounded)
        .map(|i| car.wheels[i].slip_ratio*ratio.signum()/car.wheels[i].surface.grip().ratio_peak)
        .fold(0.0f32,f32::max);
    let over=assists.0 && !car.line_lock && spin>1.4 && handbrake<0.5;
    car.traction=(car.traction+if over { -9.0*dt } else { 2.5*dt }).clamp(0.2,1.0);
    car.tc_active=car.traction<0.97 && throttle>0.05;

    let mut engine_torque=throttle*car.traction*torque_curve(car.rpm,c)*c.peak_torque
        -(1.0-throttle)*c.engine_brake*(car.rpm/c.redline)*engagement;
    // Rev limiter, top-speed governor, and reverse held to a sensible walking-to-jogging pace.
    if wheel_rpm>c.redline || (car.gear>0 && speed>c.top_speed) || (car.gear<0 && speed< -REVERSE_TOP) { engine_torque=engine_torque.min(0.0); }
    if !coupled { engine_torque=0.0; }
    if engine_torque>0.0 { engine_torque*=damage.engine.clamp(0.0,1.0); }
    let axle_torque=engine_torque*ratio*DRIVELINE_EFFICIENCY;
    car.engine_load=(throttle*car.traction).clamp(0.0,1.0)*f32::from(u8::from(coupled));

    // ---- steering: speed-sensitive lock sized to the tyres' useful slip angle, a faster
    // return to centre, and a countersteer assist when the rear steps out.
    let lock=(0.13+c.wheelbase*9.0/speed.abs().max(1.0).powi(2)).min(c.max_steer);
    let rear=q.inverse()*(forces.velocity_at_point(position.0+q*Vec3::new(0.0,0.0,-c.wheelbase*0.5))-deck_velocity);
    let rear_slip=if rear.z>3.0 { rear.x.atan2(rear.z) } else { 0.0 };
    let demand=-intent.steer.clamp(-1.0,1.0);
    // Give back rack travel in the direction of a real countersteer. The old
    // speed cap also capped the correction needed to line up a sliding rear axle.
    let catch=(rear_slip*demand.signum()).max(0.0)*smoothstep(3.0,8.0,speed);
    let manual=demand*(lock+catch).min(c.max_steer);
    // At speed the nose can already be travelling sideways relative to the body.
    // Full keyboard lock beyond peak slip then scrubs the fronts and widens the
    // turn. In assisted driving aim the tyres relative to the front axle's path.
    let guide=if assists.0 && handbrake<0.1 { smoothstep(10.0,24.0,speed) } else { 0.0 };
    let front_point=position.0+q*Vec3::new(0.0,0.0,c.wheelbase*0.5);
    let front_v=q.inverse()*(forces.velocity_at_point(front_point)-deck_velocity);
    let path_angle=front_v.x.atan2(front_v.z.max(1.0));
    let peak=(car.wheels[0].surface.grip().angle_peak+car.wheels[1].surface.grip().angle_peak)*0.5;
    let guided_lock=(peak.atan()+path_angle*demand.signum()).clamp(0.03,c.max_steer);
    let driver=manual+(demand*guided_lock-manual)*guide;
    let assist=if assists.0 && handbrake<0.5 {
        0.6*rear_slip.signum()*(rear_slip.abs()-0.07).max(0.0)*smoothstep(3.0,8.0,speed)
    } else { 0.0 };
    // Driver-right is -X, which is negative yaw.
    let target=(driver+(1.0-guide*demand.abs())*assist.clamp(-0.35,0.35)+damage.pull).clamp(-c.max_steer,c.max_steer);
    // About 0.2 s to full lock at any speed; returning and countersteering are quicker.
    let rate=if target.abs()<car.steering.abs() || target*car.steering<0.0 { (lock/0.12).max(2.5) } else { (lock/0.2).max(1.0) };
    car.steering+=(target-car.steering).clamp(-rate*dt,rate*dt);
    let steering=car.steering;

    // ---- stability control: compare the yaw rate with the one the steering asks for,
    // capped by the grip under the tyres. When the tail swings wider than that, brake the
    // outside front wheel and ease the throttle, as a real ESC does. The handbrake (or
    // switching assists off) leaves the driver to catch slides alone.
    let yaw_rate=angular.dot(up);
    let mut capacity=0.0;
    let mut grounded=false;
    for wheel in &car.wheels {
        if wheel.grounded {
            let grip=wheel.surface.grip();
            capacity+=wheel.load*grip.peak*if grip.loose { c.grip_loose } else { c.grip_road };
            grounded=true;
        }
    }
    let lateral_limit=if grounded { capacity/c.mass } else { 0.8*GRAVITY };
    let yaw_cap=lateral_limit/speed.abs().max(3.0);
    let wanted=(speed*steering.tan()/c.wheelbase).clamp(-yaw_cap,yaw_cap);
    let excess=yaw_rate-wanted;
    let oversteer=if assists.0 && speed>4.0 && handbrake<0.5 && excess*yaw_rate>0.0 { (excess.abs()-0.10-0.12*wanted.abs()).max(0.0) } else { 0.0 };
    let mut esc_brake=[0.0f32;4];
    // Yawing left (positive) puts the outside on the driver's right, which is wheel 0.
    if oversteer>0.0 { esc_brake[if yaw_rate>0.0 { 0 } else { 1 }]=(oversteer*2.5).min(1.0)*c.brake_torque*0.45; }
    let esc_cut=1.0-(oversteer*3.0).min(0.85);
    car.esc_active=oversteer>0.0;

    // ---- suspension loads, with anti-roll bars coupling each axle
    let mut compression=[0.0f32;4];
    for i in 0..4 { if let Some(contact)=contacts[i] { compression[i]=(c.rest-contact.length).max(0.0); } }
    let arb=|i:usize| {
        let (other,k)=match i { 0=>(1,c.arb_front),1=>(0,c.arb_front),2=>(3,c.arb_rear),_=>(2,c.arb_rear) };
        k*(compression[i]-compression[other])
    };
    let corner_weight=c.mass*GRAVITY*0.25;
    car.abs_active=false;
    let water_level=water.height_at(position.0.x,position.0.z);

    for i in 0..4 {
        let mount=c.mounts[i];
        let wheel_steer=if i<2 && steering.abs()>0.001 {
            // Ackermann: the inside wheel follows the tighter circle.
            let radius=c.wheelbase/steering.tan();
            (c.wheelbase/(radius-mount.x)).atan()
        } else { 0.0 }+damage.toe[i];
        let driven=share(i);
        let reflected=c.engine_inertia*ratio*ratio*driven*engagement;
        let inertia=c.wheel_inertia+reflected;
        // Limited-slip coupling pulls each driven wheel toward the driven mean.
        let drive=if driven>0.0 && coupled { axle_torque*driven*if axle_torque*ratio>0.0 { esc_cut } else { 1.0 }+c.diff_lock*(driven_omega-car.wheels[i].omega) } else { 0.0 };
        let service_axle=if car.line_lock && i>=2 { 0.0 } else { service };
        let brake_torque=service_axle*c.brake_torque*(if i<2 { c.brake_front } else { 1.0-c.brake_front })
            +if i>=2 { handbrake*c.handbrake_torque } else { 0.0 }+esc_brake[i];
        let hub=position.0+q*mount;
        let wheel_centre_y=hub.y-c.rest*up.y;
        let wheel_wet=water_level.map_or(0.0,|level| ((level-(wheel_centre_y-c.radius))/(2.0*c.radius)).clamp(0.0,1.0));

        let Some(contact)=contacts[i].filter(|_| !damage.lost[i]) else {
            // Airborne or floating: the wheel spins freely under drive and brakes and
            // cannot push the body, except as a weak paddle when it is under water.
            let mut omega=car.wheels[i].omega;
            omega+=dt*drive/inertia;
            let stop=dt*brake_torque/inertia;
            omega=if omega.abs()<=stop { 0.0 } else { omega-stop*omega.signum() };
            omega*=(-dt*(0.15+wheel_wet*6.0)).exp();
            if wheel_wet>0.0 {
                let flat=(forward-Vec3::Y*forward.y).normalize_or_zero();
                forces.apply_force_at_point(flat*c.paddle*0.25*wheel_wet*(omega*c.radius/8.0).clamp(-1.0,1.0),hub);
            }
            car.wheels[i]=Wheel { steer:wheel_steer,omega,length:c.extension,..Wheel::new(c.extension) };
            continue;
        };

        // Surface under this contact.
        let surface=if water_level.is_some_and(|level| contact.point.y<level-0.05) { Surface::Water }
            else if let Ok(prop)=props.get(contact.entity) { prop.0 }
            else if terrain.get(contact.entity).is_ok() { roads.surface(contact.point.x,contact.point.z).unwrap_or_else(|| materials.at(contact.point.x,contact.point.z)) }
            else { Surface::Rock };
        let grip=surface.grip();

        let point_velocity=forces.velocity_at_point(contact.point)-ground_velocity[i];
        let rate=point_velocity.dot(contact.normal);
        let spring_rate=if i<2 { c.spring_front } else { c.spring_rear }*damage.spring[i].clamp(0.2,1.0);
        let bottom=c.rest-c.travel+0.03;
        let stop=if contact.length<bottom { spring_rate*8.0*(bottom-contact.length) } else { 0.0 };
        let damper=-rate*if rate<0.0 { c.bump } else { c.rebound };
        let load=(compression[i]*spring_rate+stop+damper+arb(i)).clamp(0.0,c.mass*GRAVITY*1.6);
        forces.apply_force_at_point(contact.normal*load,contact.point);

        // Contact frame. Tyre forces act at the suspension roll centre height.
        let wheel_forward=q*(Quat::from_rotation_y(wheel_steer)*Vec3::Z);
        let t_forward=(wheel_forward-contact.normal*wheel_forward.dot(contact.normal)).normalize_or_zero();
        let t_side=contact.normal.cross(t_forward).normalize_or_zero();
        let vx=point_velocity.dot(t_forward);
        let vy=point_velocity.dot(t_side);
        let sensitivity=(1.0-0.08*(load/corner_weight-1.0)).clamp(0.82,1.08);
        // A fast, sliding road tyre develops less friction than one just at
        // breakaway. Blend by actual tread scrub (m/s), leaving peak grip and loose ground intact.
        let scrub=(car.wheels[i].omega*c.radius-vx).hypot(vy);
        let sliding=if surface==Surface::Asphalt { 1.0-0.23*smoothstep(4.0,18.0,scrub) } else { 1.0 };
        let fmax=sliding*grip.peak*(if grip.loose { c.grip_loose } else { c.grip_road })*sensitivity*load;

        // Wheel spin sub-steps: implicit in the tyre's own stiffness, so a light wheel on
        // a stiff tyre stays stable; brakes and ABS act per sub-step.
        let mut omega=car.wheels[i].omega;
        let (mut fx_sum,mut fy_sum,mut s_last)=(0.0,0.0,0.0);
        let rolling=grip.rolling*load*c.radius;
        let mut abs_used=false;
        for _ in 0..SUBSTEPS {
            let (fx,_,_)=tyre(omega,c.radius,vx,vy,fmax,&grip);
            let (fx_eps,_,_)=tyre(omega+0.05,c.radius,vx,vy,fmax,&grip);
            let stiffness=((fx_eps-fx)/0.05).max(0.0);
            let effective=inertia+h*c.radius*stiffness;
            omega+=h*(drive-fx*c.radius-rolling*(omega*c.radius/0.5).tanh())/effective;
            let mut applied=brake_torque;
            // ABS releases a service brake that is about to lock the wheel.
            let kappa=(omega*c.radius-vx)/vx.abs().max(SLIP_FLOOR);
            if service>0.05 && handbrake<0.5 && vx.abs()>3.0 && kappa*vx.signum()< -1.25*grip.ratio_peak {
                applied=brake_torque*0.15; abs_used=true;
            }
            let stop=h*applied/effective;
            omega=if omega.abs()<=stop { 0.0 } else { omega-stop*omega.signum() };
            let (fx,fy,s)=tyre(omega,c.radius,vx,vy,fmax,&grip);
            fx_sum+=fx; fy_sum+=fy; s_last=s;
        }
        car.abs_active|=abs_used;
        let mut fx=fx_sum/SUBSTEPS as f32;
        let mut fy=fy_sum/SUBSTEPS as f32;
        // Never push harder than it takes to stop this corner's contact in one step.
        let corner_mass=load/GRAVITY;
        if omega==0.0 && vx.abs()<0.5 && vy.abs()<0.5 {
            // Static friction: a locked, nearly stopped tyre cancels gravity along the ground
            // and its residual creep, up to its grip, instead of slipping slowly downhill.
            let hold=Vec2::new(-vx*corner_mass/dt*0.9+corner_mass*GRAVITY*t_forward.y,
                -vy*corner_mass/dt*0.9+corner_mass*GRAVITY*t_side.y).clamp_length_max(fmax);
            fx=hold.x; fy=hold.y;
        } else {
            // Never push harder than it takes to stop this corner's contact in one step.
            let stop_x=vx.abs()*corner_mass/dt*0.9;
            let stop_y=vy.abs()*corner_mass/dt*0.9;
            if omega==0.0 { fx=fx.clamp(-stop_x,stop_x); }
            fy=fy.clamp(-stop_y,stop_y);
        }
        // Soft ground ploughs: drag along the contact's travel.
        let travel=Vec2::new(vx,vy);
        let plough=if grip.sink>0.0 && travel.length()>0.05 { -travel.normalize()*grip.sink*0.04*load*(travel.length()/2.0).tanh() } else { Vec2::ZERO };
        let force=t_forward*(fx+plough.x)+t_side*(fy+plough.y);
        // Apply tractive effort at the road, so acceleration pitches the mass
        // about its actual COM. Only the lateral linkage uses the roll centre.
        forces.apply_force_at_point(force,contact.point);
        forces.apply_torque((up*c.roll_centre).cross(t_side*(fy+plough.y)));

        let floor=vx.abs().max(SLIP_FLOOR);
        car.wheels[i]=Wheel { grounded:true,length:contact.length,load,steer:wheel_steer,omega,
            slip_ratio:(omega*c.radius-vx)/floor,slip_angle:vy.atan2(vx.abs().max(0.5)),
            slide:smoothstep(0.9,2.2,s_last),point:contact.point,normal:contact.normal,
            ground_speed:travel.length(),lateral_speed:vy,surface };
    }

    // All drag points use one coupled rigid-body implicit solve. The old explicit
    // 12-point sum overshot the fluid velocity at extreme current and fed rotation
    // back into explosive drag. Coefficients, buoyancy and native contacts remain.
    let world_velocity=forces.linear_velocity();let world_angular=forces.angular_velocity();
    let rotation_matrix=Mat3::from_quat(q);let world_inertia=rotation_matrix*inertia.value()*rotation_matrix.transpose();
    let centre_of_mass=position.0+q*com.0;
    let mut fluid_loads=crate::fluid_loads::FluidLoads::new(mass.value(),world_inertia,world_velocity,world_angular,dt);
    // Air is a WORLD velocity, even while tyre motion is measured over a ferry deck.
    let air=q.inverse()*(world_velocity-fluid.air);
    // Symmetric wing/floor balance at the configured COM is the fixed-aero
    // approximation. Use air-relative speed; reverse flow and flooding lose ground effect.
    if c.aero_load>0.0 && car.submerged<1.0 {
        let downforce=c.aero_load*air.z.max(0.0).powi(2)*(1.0-car.submerged);
        forces.apply_force(-up*downforce);
        if damage.wing_lost {
            // Declared split: losing the wing removes 40% of whole-car downforce
            // at the rear axle. The floor and front aero keep loading the tyres.
            let rear_axle=position.0+q*Vec3::new(0.0,0.0,-c.wheelbase*0.5);
            forces.apply_force_at_point(up*(0.40*downforce),rear_axle);
        }
    }
    let side=0.5*1.225*1.1*c.body.z*c.hull().1;
    let vertical=0.5*1.225*1.1*c.body.x*c.body.z;
    for (axis,coefficient) in [(Vec3::X,side*air.x.abs()),(Vec3::Y,vertical*air.y.abs()),(Vec3::Z,c.drag*air.z.abs())] {
        let direction=q*axis;fluid_loads.point(Vec3::ZERO,direction,coefficient,fluid.air.dot(direction));
    }

    // ---- the hull floats: vertical water columns under the body give buoyancy at the
    // right place (so the car pitches and rolls on waves), drag relative to the moving
    // surface, and the wave's pressure gradient pushes it along the slope.
    car.submerged=0.0; car.water_height=water_level; car.water_speed=0.0;
    if water.active {
        let (bottom,height)=c.hull();
        let (hx,hz)=(c.body.x*0.45,c.body.z*0.45);
        let area=(4.0*hx*hz)/12.0;
        let mut depth_sum=0.0;
        // Each column spans the hull's vertical extent at that point in whatever attitude the
        // car is in: full height upright or capsized, about half the width on its side.
        let tilt=up.y.abs();
        let extent=height*tilt+c.body.x*0.5*(1.0-tilt);
        for ix in 0..3 { for iz in 0..4 {
            let (lx,lz)=(-hx+hx*ix as f32,-hz+2.0*hz*iz as f32/3.0);
            let mid=position.0+q*Vec3::new(lx,bottom+height*0.5,lz);
            let Some(level)=water.height_at(mid.x,mid.z) else { continue; };
            let lower=mid.y-extent*0.5;
            let depth=(level-lower).clamp(0.0,extent);
            if depth<=0.0 { continue; }
            depth_sum+=depth*height/extent.max(0.05);
            let fraction=depth/extent.max(0.05);
            let centre=Vec3::new(mid.x,lower+depth*0.5,mid.z);
            let relative=forces.velocity_at_point(centre)-fluid.current-Vec3::Y*water.rate;
            let buoyancy=WATER_DENSITY*GRAVITY*area*depth*c.displacement;
            let coefficients=Vec3::new(200.0+130.0*relative.x.abs(),500.0+450.0*relative.y.abs(),200.0+130.0*relative.z.abs())*area*fraction;
            let flow=fluid.current+Vec3::Y*water.rate;
            for (axis,coefficient) in [(Vec3::X,coefficients.x),(Vec3::Y,coefficients.y),(Vec3::Z,coefficients.z)] {
                fluid_loads.point(centre-centre_of_mass,axis,coefficient,flow.dot(axis));
            }
            let wave=-Vec3::new(water.slope_x,0.0,water.slope_z)*buoyancy;
            forces.apply_force_at_point(Vec3::Y*buoyancy+wave,centre);
        } }
        car.submerged=(depth_sum/(12.0*height)).clamp(0.0,1.0);
        if car.submerged>0.0 {
            // Water resists spinning the hull about every axis.
            fluid_loads.angular((1800.0*c.mass/1250.0)*car.submerged);
            car.water_speed=Vec2::new(world_velocity.x-fluid.current.x,world_velocity.z-fluid.current.z).length();
        }
    }

    let (fluid_force,fluid_torque)=fluid_loads.solve();
    forces.apply_force(fluid_force);forces.apply_torque(fluid_torque);

    // ---- telemetry
    // Report the driver's pedals; the auto-hold's parking brake is not the driver braking.
    car.throttle=throttle*car.traction; car.brake=if car.hold { 0.0 } else { service }; car.handbrake=handbrake;
    car.speed=speed;
    car.distance+=speed.abs()*dt;
    let acceleration=(velocity-car.last_velocity)/dt;
    let left=q*Vec3::X;
    let blend=(dt*8.0).min(1.0);
    car.longitudinal_g+=(acceleration.dot(forward)/GRAVITY-car.longitudinal_g)*blend;
    car.lateral_g+=(acceleration.dot(left)/GRAVITY-car.lateral_g)*blend;
    car.yaw_rate=angular.dot(up);
    car.vertical_speed=velocity.y;
    car.last_velocity=velocity;
}

/// Collects hard hits on the car body from the solver's contact impulses of the last step.
/// Resting and scraping contacts stay below the threshold.
pub fn record_impacts(
    collisions:Collisions,
    config:Res<VehicleConfig>,
    props:Query<(),Or<(With<PropSurface>,With<TerrainSurface>)>>,
    mut cars:Query<(Entity,&Position,&Rotation,&mut Car),With<PlayerCar>>,
) {
    let Ok((entity,position,rotation,mut car))=cars.single_mut() else { return; };
    let inverse=rotation.0.inverse();
    for pair in collisions.collisions_with(entity) {
        let sign=if pair.collider1==entity { -1.0 } else { 1.0 };
        let other=if pair.collider1==entity { pair.collider2 } else { pair.collider1 };
        for manifold in &pair.manifolds {
            let impulse=manifold.total_normal_impulse();
            let delta_v=impulse/config.mass;
            if delta_v<0.8 || manifold.points.is_empty() { continue; }
            let point=manifold.points.iter().map(|p| p.point).sum::<Vec3>()/manifold.points.len() as f32;
            if car.impacts.len()<16 {
                car.impacts.push(Impact { point:inverse*(point-position.0), direction:inverse*(manifold.normal*sign),
                    delta_v, prop:props.get(other).is_ok() });
            }
        }
    }
}
