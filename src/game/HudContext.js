// Which HUD chips belong on screen in each player context (visual and D7, 2026-10-05:
// the card PIN and the cooler stayed up while driving, flying and in the free camera, and the
// evacuation hint kept saying "170 m remaining · Shift + W to run" while the free camera roamed).
// One pure rule, shared by AppUI (which stamps it on the HUD root) and test/hud-context.mjs.
//
//   purse     money and the cooler: on foot, and aboard the fishing boat where fuel and sonar live
//   pin       the ATM card PIN: on foot only, the ATM is reached on foot
//   guidance  the evacuation hint: on foot only, it tells the walking player where to run
//
// The free camera hides all three: the player stands still, so a distance that cannot change
// and a PIN that cannot be typed are noise over the view. A tsunami warning is a CSS rule in
// GameHUD (body:has(.disaster-warning)) so the banner's owner never has to call in here.
import { ON_FOOT } from '../player/Player.js';

// ctx: { mode: Player.mode, freeCam: App.freeCam, driving: Rally.active }. `out` lets the
// per-frame caller (AppUI) reuse one object instead of allocating one every frame.
export function hudChips( { mode, freeCam = false, driving = false }, out = {} ) {

	// the rally car keeps the player in 'walk' while it drives, hence the separate flag
	const onFoot = ON_FOOT.has( mode ) && ! driving && ! freeCam;
	const aboard = mode === 'boat' && ! freeCam;
	out.purse = onFoot || aboard;
	out.pin = onFoot;
	out.guidance = onFoot;
	return out;

}
