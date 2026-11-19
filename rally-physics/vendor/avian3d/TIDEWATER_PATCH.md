# Tidewater's Avian 0.5.0 patch

This directory vendors the exact Avian 0.5.0 Cargo package used by Tidewater. Retain its MIT and Apache-2.0 license files. This is a local performance patch, not an upstream release.

- Cargo archive SHA-256: `b82608b43397affac139547dfa9beb3208034c53e1a3cfe5d4079db1af362104` (verified against the cached `.crate` archive and the original lockfile).
- Original `src/dynamics/solver/contact/mod.rs` SHA-256: `425a095c46fac096b45e14cd58afa83d0ece39e026c9f4966756f30ae6c319b2`.
- Production changes are in `src/dynamics/solver/contact/mod.rs` and the contact dispatch in `src/dynamics/solver/plugin.rs`. `Cargo.toml` exposes an opt-in differential test module. Cargo cache markers/checksums are omitted because this is a modified path dependency.

The normal and friction solvers still compute and accumulate every constraint impulse. Only applying an exactly zero returned increment is skipped. Negative releases and arbitrarily small nonzero increments remain. Warm start, normal and friction response writes are also omitted when the endpoint has zero inverse mass and inertia. Avian's `InertiaFlags::STATIC` includes dominance-overridden `DUMMY` inertia; this is not permission to remove a body or ignore its velocity. All moving-endpoint velocity reads remain.

The solver dispatch additionally records whether each endpoint exists in the `SolverBody` query, before dominance can replace its inertia. When exactly one endpoint is absent, its query-supplied dummy has identity rotation and zero velocity. A specialized contact kernel omits only that endpoint's identity rotation and zero point-velocity calculations. A present kinematic or dominant moving endpoint always retains the original kernel and velocity reads. The original `solve()` remains unchanged as the fallback and differential reference; zero inertia alone never selects the specialized kernel.

The opt-in `contact-kernel-checks` feature is enabled only by the host's dev dependency. It checks 9,216 fixtures after 147,456 ordered impulse passes and 864 short trajectories including warm start, restitution, moving dominance and kinematics. Finite values agree bit for bit except that signed zero is treated as equivalent. A frozen pre-specialization contact module and hash are kept under the host's `test-reference/` for review. Production WASM excludes the check feature.

Contact generation, manifold points, solver iterations, CCD, restitution, mass properties, material parameters and force limits are unchanged. The host's separate ascending joint-ID connection processing and release compiler settings are documented in `docs/physics-performance.md`; they are outside this vendored patch.

When upgrading Avian, review this diff against the pinned upstream file, retain accumulator updates before the zero test, and verify both the inertia-flag semantics and the query-supplied dummy invariants. Repeat the native contact/replay proof and the maintained Rust, simulation and browser tests. Timing alone is insufficient: compare states, fractures and contact counts on the same workload. Do not carry the patch across an upgrade by blindly replacing the new solver file.
