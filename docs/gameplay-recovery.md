# Vehicle and player recovery

Vehicle recovery finds a clear patch of ground using the island heightfield and existing collision world. The driving controls distinguish recovery from repairs. In the water, the player uses the shared water surface and a head-clearance check to move between swimming and walking. Aircraft and hang-glider exits transfer the current velocity into the player's movement state.

See [rally physics](rally-physics.md), [hang gliding](glider.md), [player and water](player-water.md) and [simulation verification](simulation-verification.md) for the subsystem contracts and test entry points.
