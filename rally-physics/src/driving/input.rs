use bevy::prelude::*;

/// Normalised driving intent derived from keyboard input.
#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct DriveIntent {
    /// 0.0 (idle) to 1.0 (full throttle)
    pub throttle: f32,
    /// 0.0 (none) to 1.0 (full brake)
    pub brake: f32,
    /// -1.0 (left) to 1.0 (right)
    pub steer: f32,
    /// 0.0 (off) to 1.0 (fully engaged)
    pub handbrake: f32,
}

const STICK_DEADZONE: f32 = 0.16;
const TRIGGER_DEADZONE: f32 = 0.12;

fn apply_deadzone(value: f32, deadzone: f32) -> f32 {
    if value.abs() <= deadzone {
        0.0
    } else {
        let sign = value.signum();
        let scaled = (value.abs() - deadzone) / (1.0 - deadzone);
        sign * scaled.clamp(0.0, 1.0)
    }
}

fn analog_trigger(value: Option<f32>) -> f32 {
    let raw = value.unwrap_or(0.0).clamp(0.0, 1.0);
    if raw <= TRIGGER_DEADZONE {
        0.0
    } else {
        ((raw - TRIGGER_DEADZONE) / (1.0 - TRIGGER_DEADZONE)).clamp(0.0, 1.0)
    }
}

pub fn read_drive_input(
    keys: Res<ButtonInput<KeyCode>>,
    gamepads: Query<&Gamepad>,
    mut intent: ResMut<DriveIntent>,
) {
    let keyboard_throttle: f32 = if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        1.0
    } else {
        0.0
    };

    let keyboard_brake: f32 = if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        1.0
    } else {
        0.0
    };

    let left = keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft);
    let right = keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight);
    let keyboard_steer: f32 = match (left, right) {
        (true, false) => -1.0,
        (false, true) => 1.0,
        _ => 0.0,
    };

    let mut gamepad_throttle: f32 = 0.0;
    let mut gamepad_brake: f32 = 0.0;
    let mut gamepad_steer: f32 = 0.0;
    let mut gamepad_handbrake: f32 = 0.0;

    for gamepad in &gamepads {
        gamepad_throttle =
            gamepad_throttle.max(analog_trigger(gamepad.get(GamepadButton::RightTrigger2)));
        gamepad_brake = gamepad_brake.max(analog_trigger(gamepad.get(GamepadButton::LeftTrigger2)));

        let mut stick_steer = apply_deadzone(
            gamepad.get(GamepadAxis::LeftStickX).unwrap_or(0.0),
            STICK_DEADZONE,
        );

        if gamepad.pressed(GamepadButton::DPadLeft) {
            stick_steer = -1.0;
        } else if gamepad.pressed(GamepadButton::DPadRight) {
            stick_steer = 1.0;
        }

        if stick_steer.abs() > gamepad_steer.abs() {
            gamepad_steer = stick_steer;
        }

        gamepad_handbrake = gamepad_handbrake.max(analog_trigger(gamepad.get(GamepadButton::East)));
    }

    let keyboard_handbrake: f32 = if keys.pressed(KeyCode::Space) {
        1.0
    } else {
        0.0
    };

    let using_keyboard_pedals = keyboard_throttle > 0.0 || keyboard_brake > 0.0;

    intent.throttle = if using_keyboard_pedals {
        keyboard_throttle
    } else {
        gamepad_throttle
    };
    intent.brake = if using_keyboard_pedals {
        keyboard_brake
    } else {
        gamepad_brake
    };

    // Independent pedals permit trail braking; simultaneous pedal pressure must
    // not cancel the brake. Keyboard input takes precedence while either is held.
    intent.steer = if keyboard_steer.abs() > gamepad_steer.abs() {
        keyboard_steer
    } else {
        gamepad_steer
    };
    intent.handbrake = keyboard_handbrake.max(gamepad_handbrake);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simultaneous_pedals_keep_braking_and_right_input_is_positive() {
        let mut app = App::new();
        app.init_resource::<ButtonInput<KeyCode>>()
            .init_resource::<DriveIntent>()
            .add_systems(Update, read_drive_input);
        let mut keys = app.world_mut().resource_mut::<ButtonInput<KeyCode>>();
        keys.press(KeyCode::KeyW);
        keys.press(KeyCode::KeyS);
        keys.press(KeyCode::KeyD);
        app.update();
        let intent = app.world().resource::<DriveIntent>();
        assert_eq!(intent.throttle, 1.0);
        assert_eq!(intent.brake, 1.0);
        assert_eq!(intent.steer, 1.0);
    }
}
