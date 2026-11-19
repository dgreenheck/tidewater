# Simulation verification

Run `npm run test:physics` for the native Rust contact and vehicle tests. Run `npm run test:simulation` for the JavaScript and shipped-WASM checks. The island, vehicles, people and disaster systems share the same terrain and water data in the game and tests.

`npm run test:rally` runs the Playwright scenarios against the local product with a fresh browser context per scenario. The tests exercise entering and leaving vehicles, real controls, world interactions, recovery and visible effects. The full test entry point is `npm test`.

The [physical model](physical-model.md) documents the equations, declared assumptions and bounds. [Physics performance](physics-performance.md) describes controlled timing and the limits of the disaster solver.
