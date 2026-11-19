//! Input types shared with Rally. `input.rs` is Rally's unchanged keyboard/gamepad
//! intent module; Tidewater feeds `DriveIntent` from the browser instead.
pub mod input;
use bevy::prelude::*;

#[derive(Component)]
pub struct PlayerCar;
