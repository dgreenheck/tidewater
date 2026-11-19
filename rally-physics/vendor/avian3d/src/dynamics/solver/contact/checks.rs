//! Opt-in checks against the unmodified two-body kernel. Not compiled into WASM.
use super::*;
use crate::dynamics::solver::{solver_body::SolverBodyFlags, softness_parameters::SoftnessCoefficients};
use std::{hint::black_box, time::Instant};

#[derive(Clone)]
struct Case {
    constraint: ContactConstraint,
    body1: SolverBody,
    body2: SolverBody,
    inertia1: SolverBodyInertia,
    inertia2: SolverBodyInertia,
    present1: bool,
    present2: bool,
    dt: Scalar,
}

struct Rng(u64);
impl Rng {
    fn value(&mut self) -> Scalar {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 40) as u32 as Scalar) / 16777216.0
    }
    fn signed(&mut self, scale: Scalar) -> Scalar { (2.0 * self.value() - 1.0) * scale }
    fn vector(&mut self, scale: Scalar) -> Vector { Vector::new(self.signed(scale), self.signed(scale), self.signed(scale)) }
    fn body(&mut self) -> SolverBody {
        SolverBody {
            linear_velocity: self.vector(70.0), angular_velocity: self.vector(25.0),
            delta_position: self.vector(0.02),
            delta_rotation: Rotation(Quaternion::from_scaled_axis(self.vector(0.08))),
            flags: SolverBodyFlags::empty(),
        }
    }
    fn inertia(&mut self, locked: bool) -> SolverBodyInertia {
        let mut tensor = SymmetricTensor::IDENTITY;
        tensor.m00 = 0.02 + self.value(); tensor.m11 = 0.02 + self.value(); tensor.m22 = 0.02 + self.value();
        tensor.m01 = self.signed(0.002); tensor.m02 = self.signed(0.002); tensor.m12 = self.signed(0.002);
        let axes = if locked { LockedAxes::new().lock_rotation_x().lock_translation_z() } else { LockedAxes::default() };
        SolverBodyInertia::new(0.01 + self.value(), tensor, axes, 0, true)
    }
}

// Modes exercise both fixed endpoint orders, ordinary moving pairs, dominant
// moving pairs with dummy inertia, moving kinematics, and locked-axis bodies.
fn case(seed: u64, mode: usize) -> Case {
    let mut r = Rng(seed.wrapping_add(17));
    let normal = (r.vector(1.0) + Vector::Y * 0.01).normalize();
    let tangent1 = normal.any_orthonormal_vector();
    let tangents = [tangent1, tangent1.cross(normal)];
    let mut body1 = r.body(); let mut body2 = r.body();
    let mut inertia1 = r.inertia(mode == 7); let mut inertia2 = r.inertia(mode == 8);
    let (present1, present2) = (mode != 0, mode != 1);
    if !present1 { body1 = SolverBody::DUMMY; inertia1 = SolverBodyInertia::DUMMY; }
    if !present2 { body2 = SolverBody::DUMMY; inertia2 = SolverBodyInertia::DUMMY; }
    if mode == 3 || mode == 5 { inertia1 = SolverBodyInertia::DUMMY; }
    if mode == 4 || mode == 6 { inertia2 = SolverBodyInertia::DUMMY; }
    if mode == 5 { body1.flags = SolverBodyFlags::IS_KINEMATIC; }
    if mode == 6 { body2.flags = SolverBodyFlags::IS_KINEMATIC; }
    let inv_mass = inertia1.effective_inv_mass() + inertia2.effective_inv_mass();
    let i1 = inertia1.effective_inv_angular_inertia(); let i2 = inertia2.effective_inv_angular_inertia();
    let friction = [0.0, 0.1, 0.8, 2.0][seed as usize % 4];
    let mut points = Vec::new();
    for _ in 0..1 + seed as usize % 4 {
        let anchor1 = r.vector(5.0); let anchor2 = r.vector(5.0);
        let warm = if seed % 3 == 0 { 0.0 } else { r.value() * 8.0 };
        let softness = SoftnessCoefficients { bias: r.value() * 40.0, mass_scale: 0.2 + r.value() * 0.8, impulse_scale: r.value() * 0.4 };
        points.push(ContactConstraintPoint {
            normal_part: ContactNormalPart::generate(inv_mass, &i1, &i2, anchor1, anchor2, normal, Some(warm), softness),
            tangent_part: (friction > 0.0).then(|| ContactTangentPart::generate(inv_mass, &i1, &i2, anchor1, anchor2, tangents, Some(Vector2::new(r.signed(warm * friction), r.signed(warm * friction))))),
            anchor1, anchor2, normal_speed: r.signed(90.0),
            initial_separation: r.signed(0.08) - (anchor2 - anchor1).dot(normal),
        });
    }
    Case {
        constraint: ContactConstraint {
            body1: Entity::PLACEHOLDER, body2: Entity::PLACEHOLDER, relative_dominance: 0,
            friction, restitution: r.value(), tangent_velocity: r.vector(0.3), normal, tangent1,
            points, contact_id: ContactId(0), manifold_index: 0,
        },
        body1, body2, inertia1, inertia2, present1, present2,
        dt: [1.0 / 960.0, 1.0 / 240.0, 1.0 / 120.0, 0.00001][seed as usize % 4],
    }
}

#[inline(never)]
fn solve_original(c: &mut Case, bias: bool) {
    c.constraint.solve(&mut c.body1, &mut c.body2, &c.inertia1, &c.inertia2, c.dt, bias, 20.0);
}
#[inline(never)]
fn solve_candidate(c: &mut Case, bias: bool) {
    c.constraint.solve_with_endpoint_presence(&mut c.body1, &mut c.body2, &c.inertia1, &c.inertia2, c.present1, c.present2, c.dt, bias, 20.0);
}

fn same_number(a: Scalar, b: Scalar) {
    assert!(a.is_finite() && b.is_finite(), "nonfinite result: {a}/{b}");
    // Signed zero carries no changed physical state, but record every other bit.
    assert!(a.to_bits() == b.to_bits() || (a == 0.0 && b == 0.0), "kernel mismatch {a:?}/{b:?}");
}
fn same_vector(a: Vector, b: Vector) { same_number(a.x,b.x); same_number(a.y,b.y); same_number(a.z,b.z); }
fn same(a: &Case, b: &Case) {
    for (x,y) in [(&a.body1,&b.body1),(&a.body2,&b.body2)] {
        same_vector(x.linear_velocity,y.linear_velocity); same_vector(x.angular_velocity,y.angular_velocity);
        same_vector(x.delta_position,y.delta_position);
        for (u,v) in x.delta_rotation.0.to_array().into_iter().zip(y.delta_rotation.0.to_array()) { same_number(u,v); }
        assert_eq!(x.flags,y.flags);
    }
    assert_eq!(a.constraint,b.constraint);
    for (x,y) in a.constraint.points.iter().zip(&b.constraint.points) {
        same_number(x.normal_part.impulse,y.normal_part.impulse);
        same_number(x.normal_part.total_impulse,y.normal_part.total_impulse);
        if let (Some(x),Some(y)) = (&x.tangent_part,&y.tangent_part) {
            same_number(x.impulse.x,y.impulse.x); same_number(x.impulse.y,y.impulse.y);
        }
    }
}

/// Deterministic differential test after every ordered normal/friction pass.
pub fn differential() {
    for seed in 0..1024 {
        for mode in 0..9 {
            let mut a = case(seed,mode); let mut b = a.clone();
            for pass in 0..16 {
                solve_original(&mut a, pass % 2 == 0); solve_candidate(&mut b, pass % 2 == 0);
                same(&a,&b);
            }
        }
    }
    println!("contact differential: 9,216 fixtures, 147,456 ordered solves; all finite states and impulses identical (signed zero equivalent)");
}

/// Short trajectories include original warm starting, restitution, and changing
/// delta rotation between contact solves, as in the real substep schedule.
pub fn replay() {
    for seed in 0..96 {
        for mode in 0..9 {
            let mut a = case(seed,mode); let mut b = a.clone();
            for _ in 0..32 {
                for c in [&mut a,&mut b] {
                    c.constraint.warm_start(&mut c.body1,&mut c.body2,&c.inertia1,&c.inertia2,0.7);
                }
                solve_original(&mut a,true); solve_candidate(&mut b,true); same(&a,&b);
                solve_original(&mut a,false); solve_candidate(&mut b,false); same(&a,&b);
                for c in [&mut a,&mut b] {
                    c.constraint.apply_restitution(&mut c.body1,&mut c.body2,&c.inertia1,&c.inertia2,0.5);
                    for (body,present) in [(&mut c.body1,c.present1),(&mut c.body2,c.present2)] {
                        if present {
                            body.delta_position += body.linear_velocity * c.dt;
                            body.delta_rotation.0 = (Quaternion::from_scaled_axis(body.angular_velocity * c.dt) * body.delta_rotation.0).normalize();
                        }
                    }
                }
                same(&a,&b);
            }
        }
    }
    println!("contact replay: 864 trajectories x 32 substeps; warm-start, bias, relaxation, restitution, and moving endpoints agree");
}

fn timed(initial: &[Case], candidate: bool, batches: usize) -> (f64, u64) {
    let mut cases = initial.to_vec();
    let start = Instant::now();
    for _ in 0..batches {
        // Identical inputs each batch; resets do not allocate. Their cost is
        // included equally, conservatively diluting the measured kernel gain.
        for (c,source) in cases.iter_mut().zip(initial) {
            c.body1.clone_from(&source.body1); c.body2.clone_from(&source.body2);
            c.constraint.points.clone_from(&source.constraint.points);
        }
        for pass in 0..16 {
            for c in &mut cases {
                if candidate { solve_candidate(black_box(c), pass % 2 == 0); }
                else { solve_original(black_box(c), pass % 2 == 0); }
            }
        }
    }
    let ms = start.elapsed().as_secs_f64()*1000.0;
    let checksum = cases.iter().flat_map(|c| c.constraint.points.iter()).fold(0u64,|s,p|s.wrapping_add(p.normal_part.impulse.to_bits() as u64));
    black_box(&cases);
    (ms,checksum)
}

/// Explicitly ignored by ordinary tests. Same process, alternating AB/BA order.
pub fn benchmark() {
    for workload in ["stationary", "mixed", "moving"] {
        let cases:Vec<_> = (0..256).map(|i|case(i,match workload {
            "stationary" => (i as usize/4)%2,
            "mixed" => if (i/4)%4==0 { 2+(i as usize/16)%7 } else { (i as usize/4)%2 },
            _ => 2+(i as usize/4)%7,
        })).collect();
        timed(&cases,false,8); timed(&cases,true,8);
        for round in 0..8 {
            let (before,after) = if round%2==0 {
                (timed(&cases,false,512),timed(&cases,true,512))
            } else {
                let after=timed(&cases,true,512); (timed(&cases,false,512),after)
            };
            assert_eq!(before.1,after.1);
            println!("contact-bench workload={workload} round={round} baseline_ms={:.6} candidate_ms={:.6} ratio={:.6} checksum={}",before.0,after.0,after.0/before.0,before.1);
        }
    }
}
