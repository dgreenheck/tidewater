# Game economy

Money lives in `src/game/GameState.js` and is saved to localStorage after every change.

- **Cash on hand** (`money`, the `$` in the HUD purse): a new game starts with `STARTING_MONEY` ($80). Fish sales at Joe's stand add to it; the chandlery, the Joey Island tackle and gift shops, fuel and the jetski hire spend it.
- **Bank** (`bank`): a new game starts with `STARTING_BANK` ($1,000). Saves from before the bank existed get the $1,000 once on load (a save with a `bank` field keeps its value). `reset()` puts it back to $1,000. The bank balance is shown only on the ATM screen, not in the HUD.

## ATMs (`src/game/Atm.js`)

Two Tidewater Community Bank kiosks, model `public/models/atm.glb` (built by `tools/props/atm_build.py`, Blender 5, about 19k triangles):

- Tidewater: on the sand against the boathouse wall, 4.6 m along from Marta's chandlery counter, facing the beach (`ATM_SITES` in Atm.js).
- Joey Island: on the shop footpath against the tackle shop window, clear of the bin and bench at the party wall, facing the car park (terminal frame x 38.9, z -70.36).

Each has a solid collider (walkers and cars) and a `$` marker on the minimap while it is on the map.

Using one: walk up and press **E** ("Use ATM"; traders' prompts still come first). The screen takes every key while it is open, so movement keys, numbers and game shortcuts go to the ATM.

1. Insert card (E, Enter or click): the card slides into the reader on the model.
2. PIN: 4 masked digits from the number keys or the clickable pad. Backspace or Clear empties the entry, Esc or Cancel ends the session, Enter confirms. The PIN is `GameState.pin`: 4 random digits drawn for each new game (a reset draws a new one) and kept in the save; a save without one gets a new PIN on load. Weak PINs are drawn again (a digit three or more times, such as 0000, or a straight run such as 1234 or 9876). The HUD shows it bottom right, beside the minimap, as a small glass chip ("Card PIN" and the digits). A wrong PIN shows "Incorrect PIN, N tries left". After 3 wrong PINs: "Card retained. Please contact your branch." Every ATM then refuses for `RETAIN_S` (60 s of play), and then the card is returned.
3. Menu: Withdrawal, Balance, Cancel.
4. Withdrawal: $20, $50, $100, $200 or Other amount (typed digits).
5. The card comes back first ("Please take your card"), then the cash: the shutter drops and the notes slide out of the slot on the model, and the screen shows the notes. Taking the cash moves the money (`GameState.withdraw`) and plays the coin sound, and the HUD purse pulses.
6. Receipt: yes shows an on-screen slip with the available balance.

Withdrawal rules (`checkNotes`, `withdraw`, `withdrawMessage` in GameState.js; pinned by `test/game-logic.mjs`):

| Rule | Refusal message |
| --- | --- |
| Whole dollars only | Please enter an amount in whole dollars |
| At least $20 | Minimum withdrawal is $20 |
| Multiple of $10 | Amount must be a multiple of $10 |
| Payable in $20 and $50 notes (so no $30) | Unable to dispense $30. Notes available: $20 and $50 |
| Not more than the balance | Insufficient funds. Available balance $X |
| Not more than $1,000 a game day (`DAILY_LIMIT`) | Exceeds your daily limit of $1,000. $Y left today |

The daily limit counts per game day: Atm.js adds a day each time the clock passes midnight. The tally is kept for the session only, so a reload starts it again.

Headless (no HUD): the machines still stand and block, and E only shows a toast.
