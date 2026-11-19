# Joey Island shopping village

A single-storey island shopping strip on the Joey Island terminal flat. Joey only: the same terminal model also stands at Tidewater, and Tidewater has no village.

## Site

- Joey terminal frame (as in `public/ferry/terminal_colliders.json`): +z out to sea, +x to the left looking out to sea, +y up, paving at y 3.2.
- Placed in the world by `WORLD.joeyTerminal`, (-176, 0, 652) at yaw 220 deg. `terminal.toWorld([x, y, z])` maps a point.
- The strip sits on the free flat at x 10.8..47.2, z -98.4..-59.4. The terrain there is flat at y 3.10.
- Building: x 12..46, with shopfronts at z -70 and the back wall at z -60.
- Verandah on posts out to z -74.3. Concrete footpath with bollards along the kerb at z -74.62.
- 24-bay car park at z -94.6..-74.62, with a driveway to the yard road at x 29..36. Its asphalt top is 3.225, level with the terminal yard's asphalt (HARD + 0.025). At 3.2 it sat level with the terminal's own sandy-gravel sheet (`SandyGravel`, a few big triangles over the whole flat), and the two z-fought: whole 1 m steps of beige showed through the bays.
- `JOEY_VILLAGE_SITE` (src/joey/Village.js) drops the ground 0.3 m under the slabs and keeps plants and rocks off the footprint. App applies it next to the terminal sites. Measured at runtime, the heightfield is 2.9 all over the car park and at least 0.43 m under the footpath, so the terrain itself never shows through.
- Joey's copy of `terminal.glb` also lays a scrubby verge 15 mm over the yard paving on this flat. `JoeyVillage.clearVerge()` removes its small faces over the site (79 triangles) from Joey's copy only. Tidewater keeps its verge.

## Model

- Built by `tools/joey/village_build.py`:
  `Blender --background --factory-startup --python tools/joey/village_build.py`
- It writes `public/joey/village.glb` (about 91k triangles) and `public/joey/village_colliders.json`.
- `tools/joey/village_shops.py` holds the fit-outs. The builder runs it in its own namespace at the start of the interiors section.
- Draw calls: `family()` folds every plain material into a few shared `Pal` materials, split by weathering (`WPal`), metalness and roughness. Each piece keeps its colour as a vertex colour (COLOR_0), varied a few per cent per piece. Glows, glass and the `*Pat*` materials stay separate. The model groups are `Shell` and one per shop interior (`InTackle`, `InGifts`, `InCafe`, `InStore`), for 70 primitives in all (was 137 meshes).
- It is authored in the terminal frame. `B()` maps that frame to Blender, and the root turns 180 deg about Z like the terminal's.
- Shops, left to right from the car park:
  - Joey Island Tackle & Bait (x 37..46, trades),
  - Joey Island Gifts (x 28.5..37, trades),
  - Saltbush Cafe (x 20..28.5, dressing),
  - General Store (x 12..20, dressing).
- The two trading shops have open double doors (1.65 m clear) and floors you can walk on. Inside:
  - Tackle:
    - a rod rack of 20 rods, each with a grip, reel seat, tapered blank and four guides, most with a seated spinning reel;
    - a pegboard gondola of carded hard-body lures in blisters and soft-plastic bags on hooks;
    - a counter with a glass reel cabinet, a till, a POS screen, a receipt printer and an EFTPOS terminal;
    - line spools and boxed reels behind the counter, a bait freezer with sliding glass lids over packs of bait, and an aerated live-bait tank;
    - eskies and tackle boxes on the back wall, a fish chart, a bag-limits poster, a mounted mulloway, and a checker vinyl floor.
  - Gifts:
    - open shelf bays of plush joeys, snow globes, stubby holders, mugs, folded tea towels, bucket hats and thongs;
    - a fridge-magnet board, a postcard spinner, hung tea towels, T-shirts on hangers, and a table of towels, stubby holders and island honey;
    - a counter with a till, EFTPOS, a lolly jar and a keyring stand, on a timber board floor.
  - Every shop has 1200 x 600 fluorescent troffers.
- The fascia signs use Arial Black at up to 0.54 m, with "JOEY ISLAND" as a tag line over the trade. The "EST. 1961" panel is 0.34 m.
- Grime decals sit at least 15 mm off the faces they stain. At 1 to 3 mm they z-fought, and the back-wall grime band is gone. The runtime damp band darkens the wall feet instead.
- Exterior detail:
  - corrugated main and verandah roofs, a quad gutter, downpipes, rust and grime streaks,
  - a timber-lined verandah with batten lights, parapet signs, hanging signs, window decals, A-frame boards,
  - a raised "EST. 1961" panel, a bench, a slatted bin, cafe tables, an ice chest, a gas swap cage and bike hoops,
  - bays with wheel stops, worn lines, an accessible bay, oil drips, patches, gardens and light poles,
  - out the back: solar panels, whirlybirds, condensers and wheelie bins.
- Materials whose names start with `W` get the runtime weathering snippet in `Village.js` (world-space blotches, grain and a damp band). Ceilings and inside linings carry a warm emissive fill. Without it, the engine's ground bounce turns a ceiling green.
- `Village.js` draws procedural patterns in the terminal frame. The patterns are chosen by material name:
  - `WPatVinyl`: 300 mm checker tiles,
  - `WPatBoards`: staggered timber boards,
  - `WPatPeg`: pegboard holes,
  - `CeilingTile`: an exposed-tee grid.
- Inside the shops, the `Pal` and `Pat` materials swap to an indoor copy. The copy adds a warm fill in proportion to albedo. Without it the sky ambient turns the floors and stock cold blue.
- Interiors, glass and lights do not cast shadows. Only 19 village meshes do (was 135).
- `JoeyVillage.update(camera)` (called from `App`'s frame loop) hides the village and both shopkeepers when the camera is more than 350 m away. None of it draws at Tidewater.
- Colliders, in the terminal frame:
  - `car` boxes: the car park and driveway (asphalt to the car physics),
  - `walk` boxes: the footpath, kerbs and shop floors,
  - `solid` boxes: walls, glazing, fittings, bollards, posts and furniture.
- Stations: `TackleDoor`, `TackleKeeper`, `TackleCounter`, `GiftDoor`, `GiftKeeper`, `GiftCounter`, `Shopfront`, `CarPark`, `Driveway`.

## Runtime

- `src/joey/Village.js` exports `JoeyVillage` (`app.joeyVillage`; `app.village` is Tidewater's own village).
- `App.init` creates it after `joeyTerminal.init()` and before `RallyDrive.init()`. That way its boxes are in `app.colliders` when the car physics reads the static boxes.
- It loads the GLB in the background (`ready`, awaited with the terminals) and adds two `Vendor`s to `app.game.vendors`, with Rocketbox crowd avatars:
  - Dazza (`kind: 'shop'`, `m04.glb`) sells the chandlery's gear levels in the existing shop panel.
  - Bev (`kind: 'gifts'`, `f03.glb`) sells souvenirs in `GameHUD.renderGifts`.
- `Guide.js` gives each keeper his or her own first-visit tip.

## Souvenirs

- `src/game/Souvenirs.js` holds 9 items, each with a stable id, a name, a price and a one-line blurb: stubby holder, fridge magnet, postcard pack, tea towel, snow globe, plush joey, thongs, bucket hat and island honey.
- `GameState.buySouvenir(id)` takes the price, pushes the id onto `state.souvenirs` and saves.
- `state.souvenirs` goes into `toJSON`/`fromJSON`: unknown ids are dropped and older saves load with none. `reset` clears it.
- The inventory panel (I) lists owned souvenirs under "Souvenirs", with a count when there is more than one.
- Node checks are in `test/game-logic.mjs`.
