# World tools strip and the context-aware HUD

## World tools, panels and HUD chips
Reference: the game's own glass HUD (`src/ui/ui.css` tokens, `.tw-glass`, the brand and mode chips at top left, the right-hand rail). The strip is a game choice: a flat row of every tool, grouped, never folded into a menu, because 56 browser scenarios reach tools by their button name.
Real outcome: a player finds any of the nine tools in one row under the brand, reads which are rides, island systems, emergencies and demos, and opens one with the mouse or with Left, Right, Home, End and Enter. Nothing on the top edge covers a notice.
Source of truth: `src/ui/ui.css` tokens (colour, type, spacing, radii, easing); `Player.mode`, `App.freeCam` and `Rally.active` for the HUD rule in `src/game/HudContext.js`.
Budget: DOM only. No per-frame allocation: `AppUI._syncView` fills two module scratch objects and writes `data-hud-chips` on the root only when the bitmask changes. The strip's fade classes update on scroll and resize events, never per frame.
Detail by distance: not applicable (screen space).
Controls: Left and Right move along the strip, Home and End jump, Enter or Space opens, Escape closes the open panel and returns focus to its tool (README Controls). Every panel still has its own Close button.
Transitions: chips fade over `--tw-fast` (140 ms) and come back with no delay; the open tool gets the aqua highlight and is scrolled into view; the strip's edge fade (28 px) appears only on the side with more tools out of view.
Edges: a tool id with no group lands in Island; groups keep a fixed order whatever order systems register; focus rings are inset so the pill's overflow cannot clip them ; a tsunami warning hides the PIN and the purse unless the boat's fuel gauge is on (CSS in `GameHUD.js`, so the banner's owner never calls into the HUD).
Evidence plan: `test/hud-context.mjs` (eleven contexts, purse, pin and guidance), `test/browser/hud-context.spec.js` (free camera hides and restores the chips; the strip groups and keyboard path), `test/browser/hud-notices.spec.js` (chips hidden under a tsunami warning, rows never overlap at 1440, 960 and 390). Captures at 1440, 768 and 390.

## Model
- `src/ui/WorldTools.js`: registry, groups (`GROUPS`, `GROUP_ORDER`), strip styles, keyboard, scroll fades, panel shell classes.
- `src/game/HudContext.js`: `hudChips( { mode, freeCam, driving } )` returns which of purse, pin and guidance belong on screen.
- `src/ui/AppUI.js` `_syncView`: stamps `data-hud-chips` on the HUD root each time the rule changes.
- `src/game/GameHUD.js` CSS: chip visibility from the stamp and from a visible `.disaster-warning`.
- `src/ui/ui.css` "World-tool panel shell": `.tw-shell` rules every world panel inherits.

## Adopting the shell in a panel
Drop the injected `<style>`. Use a `header` (h2 left, close button right), an `h2`, a `.tw-shell-kicker` eyebrow, `p`, plain `button`s (`.is-primary` for the main one, `.tw-shell-close` for the close), `.tw-shell-row` for a wrapping row of actions or `.tw-shell-grid` for two even columns, `label` rows with the control on the right, `output` for telemetry, `details` for advanced controls and `[role=alert]` for validation. Keep only layout rules the shell does not cover, scoped to the panel's own class. No inline `style=` attributes: they beat the shell. The aviation panel (`src/aviation/AviationPanel.js`) is the worked example: its STYLE keeps its action grid, key table and in-flight instrument card layout, and the instrument card is `.av-hud.tw-glass.tw-shell`.

## Panel size and the cards around it
- A panel is as tall as its content, capped 22 px (12 px under 700 px wide) short of the bottom edge, and scrolls inside that cap (a fixed `bottom` stretched the chairlift glass 40 % past its last line).
- The "Take a car" card (`.rh`, `src/rally/DriveHUD.js`) shares the bottom-left corner with the panel; it is hidden while a panel is open and returns when it closes (it showed through under the tsunami panel).
- The evacuation hint stands clear of the third-person character: `AppUI._syncView` stamps `.tw-root.is-third`, and the hint takes the prompt's column to the right of the character (`.tw-prompt.is-third`), stacked above the prompt. Under 700 px wide it sits under the tools strip instead, and hides while a panel is open .
- Pinned by `test/browser/hud-shell.spec.js` at 1440, 768 and 390 px.

## Evidence
Without the fix, `test/hud-context.mjs` failed 8 of 11 (the rule returned every chip in every context) and the two browser scenarios failed on `toBeHidden` and on the missing groups; `hud-notices.spec.js` failed on the PIN still showing under the warning. All green after.
