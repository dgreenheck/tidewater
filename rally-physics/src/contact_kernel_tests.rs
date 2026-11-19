use avian3d::dynamics::solver::contact::checks;

#[test]
fn stationary_contact_kernel_matches_original_after_every_impulse_pass() { checks::differential(); }

#[test]
fn stationary_contact_kernel_replay_preserves_moving_and_dominant_endpoints() { checks::replay(); }

#[test]
#[ignore = "coordinated CPU timing only"]
fn stationary_contact_kernel_interleaved_benchmark() { checks::benchmark(); }
