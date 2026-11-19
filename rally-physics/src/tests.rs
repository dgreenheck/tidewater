//! Behaviour of the production controller through the real bridge, Avian solver and
//! collision shapes. Bands come from real cars of the same kind, not from the code.
use super::*;
use bevy::ecs::system::SystemState;

const ASPHALT:[f32;6]=[0.0,-2000.0,0.0,2000.0,20.0,0.95];

/// Flat island-sized terrain at height `h`, optionally paved along the z axis.
fn world(kind:u8,paved:bool,h:f32)->RallyPhysics { world_at(kind,paved,h,0.0) }
/// As `world`, starting at `z` along the test strip (the heightfield spans about +/-1777 m).
fn world_at(kind:u8,paved:bool,h:f32,z:f32)->RallyPhysics {
    let mut sim=RallyPhysics::new();
    assert!(sim.set_terrain(&vec![h;81],9,4000.0,-2000.0));
    if paved { assert!(sim.set_roads(&ASPHALT)); }
    if kind!=0 { assert!(sim.select_vehicle(kind),"vehicle {kind} does not exist"); }
    sim.reset(0.0,h+0.5,z,0.0);
    run(&mut sim,3.0,[0.0,0.0,0.0,0.0]);
    sim
}
fn run(sim:&mut RallyPhysics,seconds:f32,input:[f32;4]) {
    for _ in 0..(seconds*120.0).round() as usize { sim.advance(1.0/120.0,input[0],input[1],input[2],input[3]); }
}
fn s(sim:&RallyPhysics)->Vec<f32> { sim.snapshot() }
fn up_y(sim:&RallyPhysics)->f32 { let v=s(sim); (Quat::from_xyzw(v[3],v[4],v[5],v[6])*Vec3::Y).y }
fn heading(sim:&RallyPhysics)->Vec3 { let v=s(sim); Quat::from_xyzw(v[3],v[4],v[5],v[6])*Vec3::Z }
fn loads(sim:&RallyPhysics)->f32 { let v=s(sim); (0..4).map(|w| v[29+w*10+6]).sum() }
/// Seconds of full throttle to reach `kmh`, or None.
fn time_to(sim:&mut RallyPhysics,kmh:f32,limit:f32)->Option<f32> {
    let mut t=0.0;
    while t<limit { run(sim,1.0/120.0,[1.0,0.0,0.0,0.0]); t+=1.0/120.0; if s(sim)[7]>=kmh { return Some(t); } }
    None
}

#[test]
fn snapshot_has_the_documented_length() { assert_eq!(world(0,false,0.0).snapshot().len(),SNAPSHOT_LEN); }

#[test]
fn both_cars_rest_on_four_loaded_springs_without_creeping() {
    for (kind,mass) in [(0,1250.0),(1,2100.0)] {
        let mut sim=world(kind,false,0.0);
        let before=s(&sim);
        assert_eq!(before[10],4.0,"vehicle {kind} contacts");
        assert!((loads(&sim)-mass*9.81).abs()<mass*9.81*0.05,"vehicle {kind} loads {}",loads(&sim));
        assert!(before[1].abs()<0.06,"vehicle {kind} ride height {}",before[1]);
        run(&mut sim,5.0,[0.0;4]);
        let after=s(&sim);
        assert!(Vec2::new(after[0]-before[0],after[2]-before[2]).length()<0.005,"vehicle {kind} crept");
        assert_eq!(after[8],0.0,"a parked car shows neutral");
    }
}

#[test]
fn auto_hold_parks_on_a_ten_percent_grade() {
    let mut sim=RallyPhysics::new();
    // 9 x 9 texels over 200 m: 25 m texels rising 2.5 m each along z.
    let heights:Vec<f32>=(0..9).flat_map(|z| (0..9).map(move |_| z as f32*2.5)).collect();
    assert!(sim.set_terrain(&heights,9,225.0,-112.5));
    sim.reset(0.0,10.5,0.0,0.0);
    run(&mut sim,4.0,[0.0;4]);
    let a=s(&sim); run(&mut sim,6.0,[0.0;4]); let b=s(&sim);
    assert_eq!(b[10],4.0);
    assert!((b[2]-a[2]).abs()<0.05,"rolled {} m on the grade",b[2]-a[2]);
}

#[test]
fn acceleration_matches_real_cars_and_sand_is_slower() {
    let aster=time_to(&mut world(0,true,0.0),100.0,20.0).expect("Aster reaches 100 km/h on asphalt");
    let jeep=time_to(&mut world(1,true,0.0),100.0,20.0).expect("Jeep reaches 100 km/h on asphalt");
    let aster_sand=time_to(&mut world(0,false,0.0),100.0,30.0).unwrap_or(30.0);
    assert!((5.5..8.0).contains(&aster),"Aster 0-100 {aster}s");
    assert!((6.5..10.0).contains(&jeep),"Jeep 0-100 {jeep}s");
    assert!(aster<jeep,"the rally coupe should out-accelerate the 2.1 t Jeep on asphalt");
    assert!(aster_sand>aster*1.2,"sand {aster_sand}s vs asphalt {aster}s");
}

#[test]
fn top_speeds_are_believable() {
    // 45 s at full throttle covers about 2.7 km, so start at the far end of the strip.
    let mut aster=world_at(0,true,0.0,-1700.0); run(&mut aster,45.0,[1.0,0.0,0.0,0.0]);
    let mut jeep=world_at(1,true,0.0,-1700.0); run(&mut jeep,45.0,[1.0,0.0,0.0,0.0]);
    assert!(s(&aster)[10]==4.0 && s(&jeep)[10]==4.0,"left the test strip");
    let (a,j)=(s(&aster),s(&jeep));
    assert!((175.0..236.0).contains(&a[7]),"Aster top speed {}",a[7]);
    assert!((135.0..165.0).contains(&j[7]),"Jeep top speed {}",j[7]);
    assert!(a[8]>=4.0 && j[8]>=4.0,"automatic gearbox reached top gears: {} {}",a[8],j[8]);
    assert!(a[9]<7300.0 && j[9]<5700.0,"rev limiter");
}

#[test]
fn abs_stops_from_100_kmh_straight_and_short() {
    for kind in [0,1] {
        let mut sim=world(kind,true,0.0);
        time_to(&mut sim,100.0,20.0).unwrap();
        let start=s(&sim); let mut saw_abs=false;
        for _ in 0..(8*120) { run(&mut sim,1.0/120.0,[0.0,1.0,0.0,0.0]); saw_abs|=s(&sim)[75]>0.5; if s(&sim)[7]<0.5 { break; } }
        let end=s(&sim);
        let distance=Vec2::new(end[0]-start[0],end[2]-start[2]).length();
        let yaw=heading(&sim).x.atan2(heading(&sim).z).abs();
        assert!(end[7]<0.5,"vehicle {kind} did not stop");
        assert!((28.0..52.0).contains(&distance),"vehicle {kind} stopping distance {distance}");
        assert!(yaw<0.05,"vehicle {kind} swerved {yaw}");
        assert!(saw_abs,"vehicle {kind} never needed ABS");
    }
}

#[test]
fn steering_turns_the_driver_way_symmetrically() {
    let mut turns=[0.0f32;2];
    for (i,input) in [1.0f32,-1.0].into_iter().enumerate() {
        let mut sim=world(0,true,0.0);
        time_to(&mut sim,50.0,10.0).unwrap();
        run(&mut sim,1.5,[0.3,0.0,input,0.0]);
        let h=heading(&sim);
        // Driver-right is -X: steering right swings the nose toward -X.
        turns[i]=h.x.atan2(h.z);
        assert!(turns[i]*input < -0.2,"input {input} turned {}",turns[i]);
        assert!(up_y(&sim)>0.95);
    }
    assert!((turns[0]+turns[1]).abs()<0.05,"asymmetric {turns:?}");
}

#[test]
fn full_lock_corners_grip_hard_without_rolling_over() {
    for kind in [0,1] {
        let mut sim=world(kind,true,0.0);
        time_to(&mut sim,60.0,12.0).unwrap();
        let mut peak=0.0f32; let mut lowest=1.0f32;
        for _ in 0..(4*120) { run(&mut sim,1.0/120.0,[0.5,0.0,1.0,0.0]); peak=peak.max(s(&sim)[76].abs()); lowest=lowest.min(up_y(&sim)); }
        assert!(lowest>0.85,"vehicle {kind} rolled: up.y {lowest}");
        assert!((0.55..1.15).contains(&peak),"vehicle {kind} lateral g {peak}");
    }
}

#[test]
fn jeep_slalom_at_speed_stays_upright() {
    let mut sim=world(1,true,0.0);
    time_to(&mut sim,75.0,15.0).unwrap();
    let mut lowest=1.0f32;
    for i in 0..8 { let dir=if i%2==0 {1.0} else {-1.0}; for _ in 0..120 { run(&mut sim,1.0/120.0,[0.6,0.0,dir,0.0]); lowest=lowest.min(up_y(&sim)); } }
    assert!(lowest>0.7,"the Jeep tipped over: up.y {lowest}");
}

#[test]
fn handbrake_locks_the_rear_and_rotates_the_car() {
    let mut sim=world(0,false,0.0);
    time_to(&mut sim,55.0,15.0).unwrap();
    let mut yaw=0.0f32; let mut rear_locked=false;
    for _ in 0..90 { run(&mut sim,1.0/120.0,[0.0,0.0,1.0,1.0]); let v=s(&sim); yaw=yaw.max(v[78].abs()); rear_locked|=v[13+2*4+2].abs()<0.01 && v[13+3*4+2].abs()<0.01; }
    assert!(rear_locked,"rear wheels kept turning under the handbrake");
    assert!(yaw>0.9,"handbrake turn yaw rate {yaw}");
    assert!(up_y(&sim)>0.85);
}

#[test]
fn sand_launch_spins_the_rear_and_traction_control_catches_it() {
    let mut sim=world(0,false,0.0);
    let mut spin=0.0f32; let mut tc=false;
    for _ in 0..120 { run(&mut sim,1.0/120.0,[1.0,0.0,0.0,0.0]); let v=s(&sim); spin=spin.max(v[83]); tc|=v[74]>0.5; }
    assert!(spin>0.08,"no wheelspin on sand: {spin}");
    assert!(tc,"traction control never acted");
    run(&mut sim,6.0,[1.0,0.0,0.0,0.0]);
    assert!(s(&sim)[7]>45.0,"bogged down: {}",s(&sim)[7]);
}

#[test]
fn a_held_brake_stops_the_car_and_pauses_before_a_gentle_reverse() {
    for kind in [0,1] {
        let mut sim=world(kind,false,0.0);
        time_to(&mut sim,35.0,10.0).unwrap();
        let mut stopped_for=0.0f32; let mut stopped=false; let mut fastest_reverse=0.0f32;
        for _ in 0..(10*120) {
            run(&mut sim,1.0/120.0,[0.0,1.0,0.0,0.0]);
            let v=s(&sim);
            if v[7].abs()<1.0 && !stopped { stopped=true; }
            if stopped && v[7].abs()<1.0 && fastest_reverse==0.0 { stopped_for+=1.0/120.0; }
            if v[7]< -1.0 { fastest_reverse=fastest_reverse.max(-v[7]); }
        }
        assert!(stopped,"vehicle {kind} never stopped");
        assert!(stopped_for>0.45,"vehicle {kind} flipped straight into reverse: {stopped_for}s");
        assert!(fastest_reverse>10.0 && fastest_reverse<30.0,"vehicle {kind} reverse speed {fastest_reverse}");
    }
}

#[test]
fn brake_then_reverse_then_forward() {
    let mut sim=world(0,true,0.0);
    run(&mut sim,3.0,[0.0,1.0,0.0,0.0]);
    let v=s(&sim); assert_eq!(v[8],-1.0); assert!(v[7]< -3.0,"reverse speed {}",v[7]);
    run(&mut sim,2.0,[1.0,0.0,0.0,0.0]);
    let v=s(&sim); assert!(v[7]>0.5 && v[8]>=1.0,"forward again: {} gear {}",v[7],v[8]);
}

#[test]
fn airborne_pedals_cannot_propel_or_mark() {
    let mut sim=RallyPhysics::new();
    assert!(sim.select_vehicle(1));
    sim.app.insert_resource(Gravity(Vec3::ZERO));
    sim.reset(0.0,20.0,0.0,0.0);
    run(&mut sim,2.0,[1.0,0.0,1.0,1.0]);
    let v=s(&sim);
    assert!(v[0].abs()<0.001 && v[2].abs()<0.001);
    assert_eq!(v[10],0.0);
    for w in 0..4 { assert_eq!(v[29+w*10+6],0.0); }
}

#[test]
fn deep_water_floats_the_car_upright_and_waves_lift_it() {
    for kind in [0,1] {
        let mut sim=world(kind,false,-8.0);
        sim.set_water(0.0,0.0,0.0,0.0,0.0,0.0);
        sim.reset(0.0,1.0,0.0,0.3);
        run(&mut sim,15.0,[0.0;4]);
        let v=s(&sim);
        assert!((0.12..0.85).contains(&v[73]),"vehicle {kind} submerged {}",v[73]);
        assert!(v[94].abs()<0.15,"vehicle {kind} still bobbing hard {}",v[94]);
        assert!(up_y(&sim)>0.85,"vehicle {kind} capsized");
        assert!(v[10]==0.0,"vehicle {kind} is touching the seabed");
        // A 0.8 m swell with a 4 s period.
        let (mut lo,mut hi)=(f32::MAX,f32::MIN);
        for i in 0..(8*120) {
            let t=i as f32/120.0; let w=std::f32::consts::TAU/4.0;
            sim.set_water(0.4*(w*t).sin(),0.0,0.0,0.0,0.0,0.4*w*(w*t).cos());
            run(&mut sim,1.0/120.0,[0.0;4]);
            if t>3.0 { let y=s(&sim)[1]; lo=lo.min(y); hi=hi.max(y); }
        }
        assert!(hi-lo>0.45,"vehicle {kind} did not ride the swell: {}",hi-lo);
    }
}

#[test]
fn wheels_only_paddle_slowly_in_deep_water() {
    let mut sim=world(1,false,-8.0);
    sim.set_water(0.0,0.0,0.0,0.0,0.0,0.0);
    sim.reset(0.0,1.0,0.0,0.0);
    run(&mut sim,6.0,[0.0;4]);
    run(&mut sim,12.0,[1.0,0.0,0.0,0.0]);
    let v=s(&sim);
    let speed=Vec2::new(v[0],v[2]).length()/12.0;
    assert!(v[95]>0.15 && v[95]<2.0,"paddle speed {}",v[95]);
    assert!(speed<2.0,"moved {speed} m/s average");
}

#[test]
fn a_thin_rail_stops_a_fast_car() {
    let mut sim=world(0,true,0.0);
    // 12 cm steel rail across the road, 0.8 m tall.
    sim.add_boxes(&[0.0,0.4,60.0,6.0,0.4,0.06,0.0,0.65]);
    time_to(&mut sim,120.0,25.0);
    let mut furthest=f32::MIN;
    for _ in 0..(4*120) { run(&mut sim,1.0/120.0,[1.0,0.0,0.0,0.0]); furthest=furthest.max(s(&sim)[2]); }
    assert!(furthest<60.0,"tunnelled through the rail: z {furthest}");
}

#[test]
fn tyres_climb_a_log_instead_of_hitting_it() {
    let mut sim=world(1,false,0.0);
    // A 30 cm driftwood log across the track.
    sim.add_boxes(&[0.0,0.15,14.0,5.0,0.15,0.2,0.0,0.65]);
    time_to(&mut sim,25.0,10.0).unwrap();
    run(&mut sim,4.0,[0.4,0.0,0.0,0.0]);
    let v=s(&sim);
    assert!(v[2]>25.0,"stopped at the log: z {}",v[2]);
    assert!(v[7]>12.0,"lost speed on the log: {}",v[7]);
    assert!(up_y(&sim)>0.9 && v[10]==4.0);
}

#[test]
fn tidewater_heightfield_preserves_xz_axes_and_texel_centres() {
    let mut sim = RallyPhysics::new();
    // Asymmetric slope: swapping X/Z cannot accidentally pass.
    let heights: Vec<f32> = (0..5).flat_map(|z| (0..5).map(move |x| x as f32*0.1 + z as f32*0.3)).collect();
    assert!(sim.set_terrain(&heights,5,5.0,-2.5));
    for _ in 0..3 { sim.app.update(); }
    let mut state = SystemState::<SpatialQuery>::new(sim.app.world_mut());
    let spatial = state.get_mut(sim.app.world_mut());
    for (x,z,expected) in [(1.0,-1.0,0.6),(-1.0,1.0,1.0),(-2.0,-2.0,0.0)] {
        let hit = spatial.cast_ray(Vec3::new(x,10.0,z),Dir3::NEG_Y,20.0,true,&SpatialQueryFilter::default()).unwrap();
        assert!((10.0-hit.distance-expected).abs()<0.001,"wrong terrain at {x},{z}: {:?}",hit);
    }
}

#[test]
fn surface_codes_reach_the_contacts() {
    let mut sim=world(0,false,0.0);
    assert!(sim.set_surface_map(&[7u8;81]));
    run(&mut sim,0.5,[0.0;4]);
    for w in 0..4 { assert_eq!(s(&sim)[89+w],7.0); }
    assert!(!sim.set_surface_map(&[0u8;5]));
    assert!(sim.set_roads(&ASPHALT));
    run(&mut sim,0.5,[0.0;4]);
    for w in 0..4 { assert_eq!(s(&sim)[89+w],3.0); }
}

#[test]
#[ignore]
fn trace_full_throttle() {
    let kind=std::env::var("TRACE_KIND").map_or(0,|v| v.parse().unwrap_or(0));
    let mut sim=world_at(kind,true,0.0,-1700.0);
    for t in 0..45 { run(&mut sim,1.0,[1.0,0.0,0.0,0.0]); let v=s(&sim);
        println!("t {t:2} kmh {:6.1} gear {} rpm {:5.0} thr {:.2} load {:.2} tc {} slip {:?} omega*r {:?}",v[7],v[8],v[9],v[69],v[79],v[74],&v[81..85],[v[15],v[19],v[23],v[27]]); }
}

#[test]
fn full_lock_and_throttle_on_sand_does_not_spin_the_car() {
    for kind in [0,1] {
        let mut sim=world(kind,false,0.0);
        time_to(&mut sim,35.0,10.0).unwrap();
        let before=heading(&sim);
        let mut turned=0.0f32; let mut last=before;
        for _ in 0..(3*120) {
            run(&mut sim,1.0/120.0,[1.0,0.0,-1.0,0.0]);
            let h=heading(&sim); turned+=last.cross(h).y.asin(); last=h;
        }
        let v=s(&sim);
        // A steady circle turns steadily; a spin-out snaps round and scrubs off the speed.
        assert!(v[7]>15.0,"vehicle {kind} spun and stalled: {} km/h",v[7]);
        assert!(v[78].abs()<1.6,"vehicle {kind} yaw rate {}",v[78]);
        assert!(turned.abs()>1.0,"vehicle {kind} barely turned: {turned}");
    }
}

#[test]
fn assists_off_lets_the_driver_power_slide() {
    let mut sim=world(0,false,0.0);
    sim.set_assists(false);
    time_to(&mut sim,35.0,10.0).unwrap();
    let mut yaw=0.0f32;
    for _ in 0..(2*120) { run(&mut sim,1.0/120.0,[1.0,0.0,-1.0,0.0]); yaw=yaw.max(s(&sim)[78].abs()); }
    let mut assisted=world(0,false,0.0);
    time_to(&mut assisted,35.0,10.0).unwrap();
    let mut calm=0.0f32;
    for _ in 0..(2*120) { run(&mut assisted,1.0/120.0,[1.0,0.0,-1.0,0.0]); calm=calm.max(s(&assisted)[78].abs()); }
    assert!(yaw>calm,"without assists the rear should step out further: {yaw} vs {calm}");
}

#[test]
fn a_wall_crash_is_reported_at_the_nose_and_scraping_is_not() {
    let mut sim=world(0,true,0.0);
    // Resting and driving on the ground report nothing.
    run(&mut sim,2.0,[1.0,0.0,0.0,0.0]);
    assert!(sim.take_impacts().is_empty(),"ordinary driving reported impacts");
    sim.add_boxes(&[0.0,1.0,40.0,6.0,1.0,0.5,0.0,0.65]);
    run(&mut sim,5.0,[1.0,0.0,0.0,0.0]);
    let hits=sim.take_impacts();
    assert!(!hits.is_empty(),"the wall crash was not reported");
    let worst=hits.chunks_exact(8).fold(&hits[0..8],|a,b| if b[6]>a[6] {b} else {a});
    assert!(worst[2]>1.5,"impact not at the nose: local z {}",worst[2]);
    assert!(worst[5]< -0.7,"push should be backwards: {}",worst[5]);
    assert!(worst[6]>4.0,"severity {}",worst[6]);
    assert_eq!(worst[7],1.0);
    assert!(sim.take_impacts().is_empty(),"impacts are drained");
}

#[test]
fn mechanical_damage_changes_how_the_car_drives() {
    let healthy=time_to(&mut world(0,true,0.0),80.0,20.0).unwrap();
    let mut weak=world(0,true,0.0);
    assert!(weak.set_damage(0.5,0.0,&[0.0;12]));
    let slow=time_to(&mut weak,80.0,30.0).unwrap_or(30.0);
    assert!(slow>healthy*1.4,"half an engine: {slow}s vs {healthy}s");
    // A bent front wheel pulls the car off a straight line with the wheel centred.
    let mut bent=world(0,true,0.0);
    assert!(bent.set_damage(1.0,0.0,&[0.06,0.06,0.0,0.0,1.0,1.0,1.0,1.0,0.0,0.0,0.0,0.0]));
    time_to(&mut bent,60.0,10.0).unwrap();
    run(&mut bent,2.0,[0.3,0.0,0.0,0.0]);
    let h=heading(&bent);
    assert!(h.x.atan2(h.z)>0.1,"toe-out did not pull: {}",h.x.atan2(h.z));
    // A lost wheel drops that corner onto the body.
    let mut lost=world(0,true,0.0);
    assert!(lost.set_damage(1.0,0.0,&[0.0,0.0,0.0,0.0,1.0,1.0,1.0,1.0,1.0,0.0,0.0,0.0]));
    run(&mut lost,2.0,[0.0;4]);
    let v=s(&lost);
    // Resting on the bare corner, the diagonal wheel may unload too.
    assert!(v[10]<=3.0 && v[10]>=2.0,"contacts {}",v[10]);
    assert!(up_y(&lost)<0.995,"the corner did not drop");
    assert!(v[29+6]==0.0,"the missing wheel still carries load");
    assert!(!lost.set_damage(1.0,0.0,&[0.0;3]));
}

#[test]
fn feathered_throttle_does_not_make_the_gearbox_hunt() {
    for kind in [0,1] {
        let mut sim=world(kind,true,0.0);
        let mut shifts=0; let mut gear=s(&sim)[8];
        // 110 ms on, 90 ms off, like a driver easing up to speed on a keyboard.
        for i in 0..(20*120) {
            let on=(i%24)<13;
            run(&mut sim,1.0/120.0,[if on {1.0} else {0.0},0.0,0.0,0.0]);
            let g=s(&sim)[8]; if g!=gear && g>0.0 && gear>0.0 { shifts+=1; } gear=g;
        }
        let v=s(&sim);
        assert!(v[7]>60.0,"vehicle {kind} crawled to {} km/h",v[7]);
        assert!(shifts<=6,"vehicle {kind} hunted through {shifts} shifts");
    }
}

#[test]
fn a_sloping_sea_pushes_a_floating_car_downhill_both_ways() {
    for (slope,sign) in [(0.1f32,-1.0f32),(-0.1,1.0)] {
        let mut sim=world(0,false,-8.0);
        sim.set_water(0.0,0.0,0.0,0.0,0.0,0.0);
        sim.reset(0.0,1.0,0.0,0.0);
        run(&mut sim,8.0,[0.0;4]);
        let start=s(&sim)[0];
        // The surface rises along +x for a positive slope: the pressure gradient pushes to -x.
        sim.set_water(0.0,slope,0.0,start,0.0,0.0);
        run(&mut sim,5.0,[0.0;4]);
        let moved=s(&sim)[0]-start;
        assert!(moved*sign>0.5,"slope {slope}: drifted {moved} m");
    }
}

#[test]
fn a_capsized_car_still_floats() {
    let mut sim=world(0,false,-8.0);
    sim.set_water(0.0,0.0,0.0,0.0,0.0,0.0);
    sim.reset(0.0,1.5,0.0,0.0);
    // Roll it onto its roof in the air.
    let q=Quat::from_rotation_z(std::f32::consts::PI);
    sim.app.world_mut().entity_mut(sim.car).insert((Rotation(q),Transform::from_xyz(0.0,1.5,0.0).with_rotation(q)));
    run(&mut sim,12.0,[0.0;4]);
    let v=s(&sim);
    assert!(v[73]>0.1,"no buoyancy upside down: {}",v[73]);
    assert!(v[1]> -3.0,"sank: y {}",v[1]);
}

#[test]
fn a_car_cocked_on_one_wheel_still_reverses_off() {
    // Blocks up to 60 cm under the front-right wheel cock the car onto a three-legged stance
    // (a rear wheel carries no load), as after a crash against a parked car. Reversing off,
    // traction control must still let the loaded rear wheel drive the car away.
    for block in [0.3f32,0.4,0.5,0.6] {
        let mut sim=world(0,false,0.0);
        sim.add_boxes(&[0.79,block*0.5,1.32,0.45,block*0.5,0.45,0.0,0.65]);
        sim.reset(0.0,block+0.5,0.0,0.0);
        run(&mut sim,2.0,[0.0;4]);
        let before=s(&sim);
        let start=before[2];
        run(&mut sim,4.0,[0.0,1.0,0.0,0.0]);
        let moved=start-s(&sim)[2];
        println!("block {block}: loads {:?} reversed {moved}",(0..4).map(|w| before[29+w*10+6] as i32).collect::<Vec<_>>());
        assert!(moved>8.0,"block {block}: only reversed {moved} m");
    }
}

/// A moving deck like the ferry's vehicle deck: 20 x 60 m, its top at the platform's origin,
/// held 4 m above flat ground.
fn deck(sim:&mut RallyPhysics) { assert!(sim.add_platform(1,&[0.0,-0.5,0.0,10.0,0.5,30.0,0.0,0.8])); }
fn move_deck(sim:&mut RallyPhysics,p:Vec3,yaw:f32,v:Vec3,w:f32) {
    let q=Quat::from_rotation_y(yaw);
    assert!(sim.set_platform(1,&[p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,0.0,w,0.0]));
}
/// Parks the Aster on the deck at `local` (deck frame) with the handbrake on.
fn parked_on_deck(local:Vec3)->RallyPhysics {
    let mut sim=world(0,false,0.0);
    deck(&mut sim);
    move_deck(&mut sim,Vec3::new(0.0,4.0,0.0),0.0,Vec3::ZERO,0.0);
    sim.reset(local.x,4.5,local.z,0.0);
    run(&mut sim,2.0,[0.0,0.0,0.0,1.0]);
    sim
}

#[test]
fn a_parked_car_rides_a_ferry_deck_as_it_pulls_away() {
    let mut sim=parked_on_deck(Vec3::ZERO);
    let start=s(&sim);
    let (mut z,mut v)=(0.0f32,0.0f32);
    for _ in 0..1200 {
        let dt=1.0/120.0;
        move_deck(&mut sim,Vec3::new(0.0,4.0,z),0.0,Vec3::new(0.0,0.0,v),0.0);
        sim.advance(dt,0.0,0.0,0.0,1.0);
        z+=v*dt; v=(v+1.5*dt).min(8.0);
    }
    let end=s(&sim);
    let slip=(end[2]-z)-start[2];
    assert!(slip.abs()<0.5 && end[1]>3.8, "the parked car moved {slip:.2} m along the deck (height {:.2})",end[1]);
    // The speedo reads speed over the deck, not over the ground.
    assert!(end[7].abs()<3.0, "speedo read {:.1} km/h on a deck doing 29 km/h",end[7]);
}

#[test]
fn a_parked_car_rides_a_ferry_deck_through_a_turn() {
    let mut sim=parked_on_deck(Vec3::new(6.0,0.0,10.0));
    let local=|sim:&RallyPhysics,p:Vec3,yaw:f32| { let v=s(sim); Quat::from_rotation_y(-yaw)*(Vec3::new(v[0],v[1],v[2])-p) };
    let start=local(&sim,Vec3::new(0.0,4.0,0.0),0.0);
    // Like a ferry leaving: easing up to 5 m/s at 1.5 m/s2 while swinging into a 0.08 rad/s turn.
    let (mut p,mut yaw,mut speed,mut w)=(Vec3::new(0.0,4.0,0.0),0.0f32,0.0f32,0.0f32);
    for _ in 0..1200 {
        let dt=1.0/120.0;
        let v=Quat::from_rotation_y(yaw)*Vec3::new(0.0,0.0,speed);
        move_deck(&mut sim,p,yaw,v,w);
        sim.advance(dt,0.0,0.0,0.0,1.0);
        p+=v*dt; yaw+=w*dt;
        speed=(speed+1.5*dt).min(5.0); w=(w+0.02*dt).min(0.08);
    }
    let drift=(local(&sim,p,yaw)-start).length();
    assert!(drift<0.5, "the parked car drifted {drift:.2} m on a deck turning at 0.08 rad/s");
}

#[test]
fn a_car_drives_forward_along_a_moving_ferry_deck() {
    let mut sim=parked_on_deck(Vec3::new(0.0,0.0,-20.0));
    // The deck eases up to 6 m/s with the car parked, then the driver moves off along it.
    let (mut z,mut v)=(0.0f32,0.0f32);
    for k in 0..960 {
        let dt=1.0/120.0;
        move_deck(&mut sim,Vec3::new(0.0,4.0,z),0.0,Vec3::new(0.0,0.0,v),0.0);
        let driving=k>=600;
        sim.advance(dt,if driving { 0.4 } else { 0.0 },0.0,0.0,if driving { 0.0 } else { 1.0 });
        z+=v*dt; v=(v+1.5*dt).min(6.0);
    }
    let end=s(&sim);
    let over_deck=end[2]-z-(-20.0);
    // Three seconds of gentle throttle moves it forward over the deck, at deck-relative speed.
    assert!(over_deck>4.0 && end[1]>3.8, "covered {over_deck:.1} m over the deck");
    assert!(end[7]>5.0 && end[7]<40.0, "speedo {:.1} km/h over the deck",end[7]);
}

#[test]
fn surfaced_boxes_carry_their_own_surface_and_plain_boxes_stay_wood() {
    // A paved slab (asphalt) and, beside it, a plain slab from the old call (wood).
    let mut sim=world(0,false,0.0);
    sim.add_surface_boxes(&[0.0,0.25,0.0,6.0,0.25,8.0,0.0,0.65],&[3]);
    sim.add_boxes(&[20.0,0.25,0.0,6.0,0.25,8.0,0.0,0.65]);
    sim.reset(0.0,1.2,0.0,0.0);
    run(&mut sim,1.0,[0.0;4]);
    for w in 0..4 { assert_eq!(s(&sim)[89+w],3.0,"wheel {w} on the paved slab"); }
    sim.reset(20.0,1.2,0.0,0.0);
    run(&mut sim,1.0,[0.0;4]);
    for w in 0..4 { assert_eq!(s(&sim)[89+w],5.0,"wheel {w} on the plain slab"); }
}

#[test]
fn a_car_climbs_a_pitched_ramp_onto_a_deck_without_a_lip() {
    // The ferry's lowered stern ramp in miniature: a deck whose top is 0.5 m up, and a 7.8 m
    // ramp pitched down from its edge to the ground. The car drives up it and onto the deck.
    let mut sim=world(0,false,0.0);
    let (rise,run_z)=(0.5f32,7.8f32);
    let pitch=(rise/run_z).atan();
    let len=(rise*rise+run_z*run_z).sqrt()+0.6;
    // Top face through (z 0, y rise) and (z -run_z, y 0), extended 0.6 m below the ground at the toe.
    let (cz,cy)=(-(len*0.5)*pitch.cos()+0.0,rise-(len*0.5)*pitch.sin());
    let (nz,ny)=(pitch.sin(),-pitch.cos());
    assert!(sim.add_platform_pitched(1,&[
        0.0,rise-0.15,20.0,5.0,0.15,20.0,0.0,0.0,0.9,
        0.0,cy+ny*0.15,cz+nz*0.15,5.0,0.15,len*0.5,0.0,-pitch,0.9]));
    assert!(sim.set_platform(1,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0]));
    sim.reset(0.0,0.5,-20.0,0.0);
    run(&mut sim,2.0,[0.0;4]);
    let (mut worst,mut off)=(0.0f32,0.0f32);
    for _ in 0..(12.0*120.0) as usize {
        let before=s(&sim);
        sim.advance(1.0/120.0,0.6,0.0,0.0,0.0);
        let after=s(&sim);
        worst=worst.max((after[1]-before[1]).abs());
        // Wholly on the ramp, the body follows its slope (ride height on the flat is about 0).
        if after[2]>-6.0 && after[2]< -1.5 { off=off.max((after[1]-rise*(1.0+after[2]/run_z)).abs()); }
        if after[2]>12.0 { break; }
    }
    let end=s(&sim);
    assert!(end[2]>6.0 && end[1]>rise, "the car should be up on the deck, at z {:.2} y {:.2}",end[2],end[1]);
    assert!(worst<0.05, "a bump of {worst:.3} m in one step on the way up");
    assert!(off<0.06, "the body left the ramp slope by {off:.3} m");
}

// Props: dormant in the renderer, woken here near the car or the walker (props.rs).
fn upright(x:f32,y:f32,z:f32)->[f32;7] { [x,y,z,0.0,0.0,0.0,1.0] }
fn prop(sim:&RallyPhysics,id:u32)->Vec<f32> {
    sim.prop_poses().chunks_exact(props::PROP_RECORD).find(|r| r[0]==id as f32).expect("prop awake").to_vec()
}
const CRATE:[f32;3]=[0.3,0.2,0.25];

#[test]
fn a_woken_crate_lands_settles_and_sleeps() {
    let mut sim=world(0,false,0.0);
    assert!(sim.wake_prop(7,0,&CRATE,&upright(20.0,2.0,0.0),12.0,0.6,0.2,false));
    run(&mut sim,4.0,[0.0,0.0,0.0,1.0]);
    let r=prop(&sim,7);
    assert!((r[2]-0.2).abs()<0.05,"rests on the ground: y {}",r[2]);
    assert_eq!(r[9],1.0,"Avian has it asleep");
    assert!(sim.sleep_prop(7));
    assert_eq!(sim.prop_count(),0);
}

#[test]
fn the_car_scatters_a_crate_stack_and_keeps_going() {
    let mut sim=world(0,true,0.0);
    for (i,y) in [0.2,0.61,1.02].into_iter().enumerate() {
        assert!(sim.wake_prop(i as u32,0,&CRATE,&upright(0.0,y,30.0),12.0,0.6,0.2,false));
    }
    run(&mut sim,1.0,[0.0,0.0,0.0,1.0]);
    assert!((0..3).all(|i| (prop(&sim,i)[3]-30.0).abs()<0.05),"the stack stands before the hit");
    run(&mut sim,5.0,[1.0,0.0,0.0,0.0]);
    let car=s(&sim);
    assert!(car[2]>35.0,"the car got past: z {}",car[2]);
    assert!(car[7]>25.0,"and kept going: {} km/h",car[7]);
    let moved=(0..3).filter(|&i| { let r=prop(&sim,i); r[1].abs()>0.5 || (r[3]-30.0).abs()>1.0 }).count();
    assert!(moved>=2,"the stack scattered: {moved} of 3 moved");
}

#[test]
fn a_fence_panel_reports_a_fast_hit_without_stopping_the_car() {
    let mut sim=world(0,true,0.0);
    assert!(sim.wake_prop(40,0,&[1.0,0.5,0.05],&upright(0.0,0.5,30.0),20.0,0.6,0.1,true));
    run(&mut sim,1.0,[0.0,0.0,0.0,1.0]);
    assert_eq!(prop(&sim,40)[9],2.0,"untouched while the car waits");
    let mut hit=0.0f32;
    for _ in 0..600 {
        run(&mut sim,1.0/120.0,[1.0,0.0,0.0,0.0]);
        let r=prop(&sim,40);
        if r[9]==3.0 { hit=hit.max(r[8]); }
    }
    assert!(hit>8.0,"the car's speed at the hit: {hit}");
    assert!(s(&sim)[7]>25.0,"a sensor does not stop the car");
}

#[test]
fn the_walker_nudges_a_crate_but_never_the_car() {
    let mut sim=world(0,false,0.0);
    assert!(sim.wake_prop(3,0,&CRATE,&upright(10.0,0.2,0.0),12.0,0.6,0.2,false));
    run(&mut sim,1.0,[0.0,0.0,0.0,1.0]);
    let mut x=9.0;
    for _ in 0..180 {
        sim.set_pusher(x,0.0,0.0,1.4,0.0,0.0,0.3,1.8,true);
        run(&mut sim,1.0/120.0,[0.0,0.0,0.0,1.0]);
        x+=1.4/120.0;
    }
    assert!(prop(&sim,3)[1]>10.5,"pushed along: x {}",prop(&sim,3)[1]);
    let before=s(&sim);
    for _ in 0..60 {
        sim.set_pusher(before[0],0.0,before[2],0.0,0.0,0.0,0.3,1.8,true);
        run(&mut sim,1.0/120.0,[0.0,0.0,0.0,1.0]);
    }
    let after=s(&sim);
    assert!((after[0]-before[0]).abs()<0.02 && (after[2]-before[2]).abs()<0.02,"the capsule inside the car never moves it");
    sim.set_pusher(0.0,0.0,0.0,0.0,0.0,0.0,0.3,1.8,false);
}

/// A person on foot shoves an empty crate but only rocks a full barrel (about 150 kg).
#[test]
fn the_walker_shoves_a_crate_but_cannot_plough_a_full_barrel() {
    let mut sim=world(0,false,0.0);
    let barrel=[0.3,0.45,0.3];
    assert!(sim.wake_prop(5,1,&barrel,&upright(10.0,0.45,0.0),150.0,0.5,0.1,false));
    assert!(sim.wake_prop(6,0,&CRATE,&upright(10.0,0.2,6.0),12.0,0.6,0.2,false));
    run(&mut sim,1.0,[0.0,0.0,0.0,1.0]);
    let walk=|sim:&mut RallyPhysics,z:f32,id:u32,dims:&[f32],shape:u8,mass:f32| {
        let mut x=9.0;
        for _ in 0..360 {
            sim.set_pusher(x,0.0,z,1.4,0.0,0.0,0.3,1.8,true);
            sim.wake_prop(id,shape,dims,&[0.0;7],mass,0.5,0.1,false);
            run(sim,1.0/120.0,[0.0,0.0,0.0,1.0]);
            x+=1.4/120.0;
            // as the renderer does (PropPhysics.pushers): the walker stays within reach of the body
            let b=sim.pusher_position();
            if x-b[0]>0.15 { x=b[0]+0.15; }
        }
    };
    walk(&mut sim,0.0,5,&barrel,1,150.0);
    let b=prop(&sim,5);
    let barrel_moved=((b[1]-10.0).powi(2)+b[3].powi(2)).sqrt();
    assert!(barrel_moved<0.3,"a full barrel only rocks or creeps: moved {barrel_moved} m");
    let body=sim.pusher_position();
    assert!(body[0]<9.8,"the walker's body stops against it: x {}",body[0]);
    walk(&mut sim,6.0,6,&CRATE,0,12.0);
    let c=prop(&sim,6);
    assert!(c[1]-10.0>1.0,"an empty crate is shoved along: moved {} m",c[1]-10.0);
    sim.set_pusher(0.0,0.0,0.0,0.0,0.0,0.0,0.3,1.8,false);
}

#[test]
fn extreme_car_fluid_drag_is_passive_in_actual_native_steps() {
    for kind in [0,1] {for current in [250.0,300.0,400.0] {for angle in [0.0,0.7] {
        let mut sim=RallyPhysics::new();sim.select_vehicle(kind);sim.app.insert_resource(Gravity(Vec3::ZERO));
        sim.app.world_mut().resource_mut::<VehicleConfig>().displacement=0.0;
        let u=Vec3::new(current,0.0,-current*0.3);let q=Quat::from_euler(EulerRot::XYZ,angle,0.43,-angle*0.6);
        sim.restore_disaster_car(&[0.0,100.0,0.0,q.x,q.y,q.z,q.w,0.0,0.0,0.0,2.0,-3.0,5.0]);
        sim.set_water(3000.0,0.0,0.0,0.0,0.0,0.0);sim.set_fluid_velocity(u.x,u.y,u.z,u.x,u.z);
        let energy=|s:&RallyPhysics| {let world=s.app.world();let v=world.get::<LinearVelocity>(s.car).unwrap().0-u;let w=world.get::<AngularVelocity>(s.car).unwrap().0;let q=world.get::<Rotation>(s.car).unwrap().0;let m=world.get::<ComputedMass>(s.car).unwrap().value();let local=q.inverse()*w;let inertia=world.get::<ComputedAngularInertia>(s.car).unwrap().value();0.5*m*v.length_squared()+0.5*local.dot(inertia*local)};
        let initial=energy(&sim);let mut old=initial;
        for step in 0..240 {sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);let next=energy(&sim);assert!(next.is_finite()&&next<=old+initial*2e-5,"kind{kind} current{current} angle{angle} step{step}: {old}->{next}");old=next;}
        assert!(old<initial*0.001,"current must entrain the actual native body");
    }}}
}

#[test]
fn car_air_drag_uses_world_velocity_while_riding_a_moving_deck() {
    fn run(speed:f32)->Vec<f32>{
        let mut sim=RallyPhysics::new();
        assert!(sim.add_platform(25,&[0.0,-0.5,0.0,50.0,0.5,50.0,0.0,0.65]));
        sim.reset(0.0,0.5,0.0,0.0);for _ in 0..360 {sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);}
        assert_eq!(sim.snapshot()[10],4.0);
        let mut state=sim.disaster_car_state();state[7]=speed;assert!(sim.restore_disaster_car(&state));
        assert!(sim.set_platform(25,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0,speed,0.0,0.0,0.0,0.0,0.0]));
        sim.set_fluid_velocity(speed,0.0,0.0,0.0,0.0);sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);let mut out=sim.disaster_car_state();out[7]-=speed;out
    }
    let a=run(0.0);let b=run(6.0);for i in 7..13 {assert!((a[i]-b[i]).abs()<2e-6,"co-moving deck/air component{i}: {} vs{}",a[i],b[i]);}
}

#[test]
fn car_water_speed_reports_world_relative_current_over_a_moving_deck() {
    let mut sim=RallyPhysics::new();
    assert!(sim.add_platform(25,&[0.0,-0.5,0.0,50.0,0.5,50.0,0.0,0.65]));
    sim.reset(0.0,0.5,0.0,0.0);for _ in 0..360 {sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);}
    assert_eq!(sim.snapshot()[10],4.0);let mut state=sim.disaster_car_state();state[7]=6.0;assert!(sim.restore_disaster_car(&state));
    assert!(sim.set_platform(25,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0,6.0,0.0,0.0,0.0,0.0,0.0]));
    sim.set_water(0.65,0.0,0.0,0.0,0.0,0.0);sim.set_fluid_velocity(6.0,0.0,0.0,6.0,0.0);
    sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);let out=sim.snapshot();assert!(out[73]>0.0);assert!(out[95].abs()<1e-5,"co-moving car/deck/current water speed {}",out[95]);
}

/// The cars added for item 7 (docs/cars.md gives each reference car, its figures and sources):
/// (kind, name, mass kg, 0-100 km/h s, top speed km/h, 100-0 km/h stop m, peak lateral g).
/// Each band is the real car's published or road-tested figure widened for a simulator, never a
/// number read back from the config.
type Bands=(u8,&'static str,f32,(f32,f32),(f32,f32),(f32,f32),(f32,f32));
const NEW_CARS:[Bands;4]=[
    // Huracan EVO class: 2.9 s, 325 km/h, 31.9 m (maker); 1.0 to 1.1 g on road-test skidpads.
    (2,"Fulmine V10",1550.0,(2.6,3.6),(300.0,332.0),(28.0,38.0),(0.9,1.35)),
    // Chiron class: 2.4 s, 380 km/h governed outside top-speed mode, 31.3 m (maker).
    (3,"Corsaire W16",1995.0,(2.2,3.2),(355.0,386.0),(28.0,38.0),(0.9,1.35)),
    // 911 GT3 (992) PDK class: 3.4 s, 318 km/h (maker); about 31 m and 1.1 g in road tests.
    (4,"Petrel GT",1450.0,(3.0,4.2),(295.0,325.0),(28.0,38.0),(0.9,1.35)),
    (5,"Sandpiper",620.0,(5.5,9.5),(140.0,166.0),(32.0,55.0),(0.6,1.0)),
];

#[test]
fn new_cars_rest_on_four_loaded_springs() {
    for (kind,name,mass,..) in NEW_CARS {
        let mut sim=world(kind,false,0.0);
        let before=s(&sim);
        assert_eq!(before[10],4.0,"{name} contacts");
        assert!((loads(&sim)-mass*9.81).abs()<mass*9.81*0.05,"{name} spring loads {} N for {} N of car",loads(&sim),mass*9.81);
        assert!(before[1].abs()<0.06,"{name} ride height {} m",before[1]);
        run(&mut sim,5.0,[0.0;4]);
        let after=s(&sim);
        assert!(Vec2::new(after[0]-before[0],after[2]-before[2]).length()<0.005,"{name} crept");
    }
}

#[test]
fn new_cars_reach_100_kmh_like_their_references() {
    for (kind,name,_,band,..) in NEW_CARS {
        let t=time_to(&mut world(kind,true,0.0),100.0,25.0).unwrap_or(25.0);
        eprintln!("{name}: 0-100 km/h {t:.2} s");
        assert!((band.0..band.1).contains(&t),"{name} 0-100 km/h in {t:.2} s, real-car band {band:?}");
    }
}

#[test]
fn new_cars_reach_their_reference_top_speeds() {
    for (kind,name,_,_,band,..) in NEW_CARS {
        // 35 s flat out covers about 3 km in the fastest car; the strip runs 3.4 km from here.
        let mut sim=world_at(kind,true,0.0,-1700.0);
        run(&mut sim,35.0,[1.0,0.0,0.0,0.0]);
        let v=s(&sim);
        eprintln!("{name}: {:.0} km/h after 35 s",v[7]);
        assert_eq!(v[10],4.0,"{name} left the strip at z {} m",v[2]);
        assert!((band.0..band.1).contains(&v[7]),"{name} top speed {:.0} km/h in gear {} at {:.0} rpm, real-car band {band:?}",v[7],v[8],v[9]);
    }
}

#[test]
fn new_cars_stop_from_100_kmh_like_their_references() {
    for (kind,name,_,_,_,band,_) in NEW_CARS {
        let mut sim=world(kind,true,0.0);
        time_to(&mut sim,100.0,25.0).unwrap();
        let start=s(&sim);
        for _ in 0..(8*120) { run(&mut sim,1.0/120.0,[0.0,1.0,0.0,0.0]); if s(&sim)[7]<0.5 { break; } }
        let end=s(&sim);
        let distance=Vec2::new(end[0]-start[0],end[2]-start[2]).length();
        let yaw=heading(&sim).x.atan2(heading(&sim).z).abs();
        eprintln!("{name}: 100-0 km/h {distance:.1} m");
        assert!(end[7]<0.5,"{name} did not stop");
        assert!((band.0..band.1).contains(&distance),"{name} 100-0 km/h in {distance:.1} m, real-car band {band:?}");
        assert!(yaw<0.05,"{name} swerved {yaw} rad");
    }
}

#[test]
fn new_cars_corner_at_their_reference_grip_without_rolling() {
    for (kind,name,..,band) in NEW_CARS {
        let mut sim=world(kind,true,0.0);
        time_to(&mut sim,60.0,12.0).unwrap();
        let mut peak=0.0f32; let mut lowest=1.0f32;
        for _ in 0..(4*120) { run(&mut sim,1.0/120.0,[0.5,0.0,1.0,0.0]); peak=peak.max(s(&sim)[76].abs()); lowest=lowest.min(up_y(&sim)); }
        eprintln!("{name}: peak lateral {peak:.2} g");
        assert!(lowest>0.85,"{name} rolled: up.y {lowest}");
        assert!((band.0..band.1).contains(&peak),"{name} peak lateral {peak:.2} g, real-car band {band:?}");
    }
}

/// A slow frame must not buy a longer one. At 10 fps the old loop ran 12 steps of 1/120 s,
/// each with 8 solver substeps, so the next frame was slower still (the tornado sat at 9 fps
/// with physics at 40-77 ms a frame). The cap drops the excess time instead of owing it.
#[test]
fn a_slow_frame_runs_at_most_three_fixed_steps_and_owes_nothing() {
    let mut sim = world( 0, false, 0.0 );
    // During a disaster SimulationPacing sets the 3-step cap.
    sim.set_max_steps( crate::DISASTER_MAX_STEPS );
    for frame in 0..20 {
        let steps = sim.advance( 0.1, 0.0, 0.0, 0.0, 1.0 );
        assert!( steps <= 3, "frame {frame}: a 100 ms frame ran {steps} fixed steps, cap 3" );
    }
    // The dropped time is not carried: a frame one step long runs one step.
    let steps = sim.advance( 1.0/120.0, 0.0, 0.0, 0.0, 1.0 );
    assert!( steps <= 1, "a 1/120 s frame after a slow run ran {steps} steps: the dropped time was owed" );
    let alpha = *sim.blend().last().unwrap();
    assert!( ( 0.0..=1.0 ).contains( &alpha ), "interpolation alpha {alpha}" );
    // Ordinary frames keep real time: 60 fps runs two steps a frame.
    let total: u32 = ( 0..60 ).map( |_| sim.advance( 1.0/60.0, 0.0, 0.0, 0.0, 1.0 ) ).sum();
    assert!( ( 119..=121 ).contains( &total ), "60 frames at 60 fps ran {total} steps, want 120" );
}

#[test]
fn outside_a_disaster_a_slow_frame_still_catches_up() {
    let mut sim = world( 0, false, 0.0 );
    let steps = sim.advance( 1.0/30.0, 0.0, 0.0, 0.0, 1.0 );
    assert_eq!( steps, 4, "a 1/30 s frame outside a disaster ran {steps} fixed steps, want 4" );
    let total: u32 = ( 0..30 ).map( |_| sim.advance( 1.0/30.0, 0.0, 0.0, 0.0, 1.0 ) ).sum();
    assert!( ( 119..=121 ).contains( &total ), "30 frames at 30 fps ran {total} steps, want 120 (real time)" );
    // The old 0.1 s catch-up stays: a 100 ms hitch runs 12 steps.
    let steps = sim.advance( 0.1, 0.0, 0.0, 0.0, 1.0 );
    assert!( ( 11..=12 ).contains( &steps ), "a 100 ms frame outside a disaster ran {steps} steps, want 12" );
}

/// A released tree (docs/disaster-damage.md): its spin is capped at 2 rad/s whatever kicks it, and
/// its crown sphere holds the top off the ground when it lies down.
#[test]
fn released_tree_spin_is_capped_and_its_crown_props_the_top_off_the_ground() {
    let mut sim=world(0,false,0.0);
    let half=[0.3,6.0,0.3];
    assert!(sim.wake_prop(90,0,&half,&upright(0.0,8.0,30.0),2000.0,0.9,0.05,false));
    assert!(sim.set_prop_crown(90,&half,4.0,1.5));
    assert!(sim.set_prop_motion_limits(90,0.5,2.0));
    assert!(!sim.set_prop_motion_limits(90,f32::NAN,2.0), "non-finite damping is rejected");
    assert!(!sim.set_prop_crown(90,&half,4.0,-1.0), "a negative crown radius is rejected");
    assert!(sim.set_prop_angular_velocity(90,&[0.0,6.0,0.0]));
    sim.advance(1.0/60.0,0.0,0.0,0.0,0.0);
    let pose=sim.prop_poses();
    let i=(0..pose.len()).step_by(10).find(|&i| pose[i]==90.0).expect("tree pose");
    let p=[pose[i+1],pose[i+2],pose[i+3]];
    let centre=sim.disaster_contact(90,&p,&[0.0,1.0,0.0]);
    let rim=sim.disaster_contact(90,&[p[0]+1.0,p[1],p[2]],&[0.0,1.0,0.0]);
    let spin=(rim[2]-centre[2]).abs();
    assert!(spin<=2.0+1e-3, "spin {spin} rad/s after a 6 rad/s kick; cap 2");
    // Lay it down and let it settle: the crown sphere keeps that end 1.5 m up.
    let q=[0.0,0.0,(std::f32::consts::FRAC_PI_4).sin(),(std::f32::consts::FRAC_PI_4).cos()];
    assert!(sim.sleep_prop(90));
    assert!(sim.wake_prop(91,0,&half,&[0.0,2.0,30.0,q[0],q[1],q[2],q[3]],2000.0,0.9,0.05,false));
    assert!(sim.set_prop_crown(91,&half,4.0,1.5));
    for _ in 0..240 { sim.advance(1.0/60.0,0.0,0.0,0.0,0.0); }
    let pose=sim.prop_poses();
    let i=(0..pose.len()).step_by(10).find(|&i| pose[i]==91.0).expect("tree pose");
    let rotation=Quat::from_xyzw(pose[i+4],pose[i+5],pose[i+6],pose[i+7]);
    let crown=Vec3::new(pose[i+1],pose[i+2],pose[i+3])+rotation*Vec3::new(0.0,4.0,0.0);
    assert!(crown.y>=1.4, "crown centre {} m above the ground; the 1.5 m crown holds it up", crown.y);
}
