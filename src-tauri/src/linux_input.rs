//! Query current key state only: no event stream, grabs or keystroke history.
use evdev::Device;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

struct Inputs {
    devices: Vec<Device>,
    scanned: Instant,
}

impl Inputs {
    fn scan() -> Self {
        Self {
            devices: evdev::enumerate()
                .filter_map(|(_, device)| device.supported_keys().map(|_| ()).map(|_| device))
                .take(128)
                .collect(),
            scanned: Instant::now(),
        }
    }
}

pub fn pressed_keys() -> Option<HashSet<String>> {
    static INPUTS: OnceLock<Mutex<Inputs>> = OnceLock::new();
    let mut inputs = INPUTS
        .get_or_init(|| Mutex::new(Inputs::scan()))
        .lock()
        .ok()?;
    if inputs.scanned.elapsed() >= Duration::from_secs(2) {
        *inputs = Inputs::scan();
    }
    if inputs.devices.is_empty() {
        return None;
    }
    let mut pressed = HashSet::new();
    for device in &inputs.devices {
        if let Ok(keys) = device.get_key_state() {
            for key in keys.iter() {
                if let Some(name) = key_name(&format!("{key:?}")) {
                    pressed.insert(name);
                }
            }
        }
    }
    Some(pressed)
}

fn key_name(key: &str) -> Option<String> {
    let name = match key {
        "KEY_LEFTCTRL" | "KEY_RIGHTCTRL" => "Control",
        "KEY_LEFTSHIFT" | "KEY_RIGHTSHIFT" => "Shift",
        "KEY_LEFTALT" | "KEY_RIGHTALT" => "Alt",
        "KEY_LEFTMETA" | "KEY_RIGHTMETA" => "Super",
        "KEY_SPACE" => "Space",
        "KEY_ENTER" | "KEY_KPENTER" => "Return",
        "KEY_ESC" => "Escape",
        "KEY_BACKSPACE" => "Backspace",
        "KEY_TAB" => "Tab",
        "KEY_UP" => "Up",
        "KEY_DOWN" => "Down",
        "KEY_LEFT" => "Left",
        "KEY_RIGHT" => "Right",
        "KEY_DELETE" => "Delete",
        "KEY_INSERT" => "Insert",
        "KEY_HOME" => "Home",
        "KEY_END" => "End",
        "KEY_PAGEUP" => "PageUp",
        "KEY_PAGEDOWN" => "PageDown",
        "KEY_CAPSLOCK" => "CapsLock",
        "KEY_GRAVE" => "`",
        "KEY_MINUS" => "-",
        "KEY_EQUAL" => "=",
        "KEY_LEFTBRACE" => "[",
        "KEY_RIGHTBRACE" => "]",
        "KEY_BACKSLASH" => "\\",
        "KEY_SEMICOLON" => ";",
        "KEY_APOSTROPHE" => "'",
        "KEY_COMMA" => ",",
        "KEY_DOT" => ".",
        "KEY_SLASH" => "/",
        "BTN_LEFT" => "MouseLeft",
        "BTN_MIDDLE" => "MouseMiddle",
        "BTN_RIGHT" => "MouseRight",
        "BTN_SIDE" => "Mouse4",
        "BTN_EXTRA" => "Mouse5",
        _ => {
            let key = key.strip_prefix("KEY_")?;
            if key.len() == 1 && key.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return Some(key.to_string());
            }
            if key
                .strip_prefix('F')
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=24).contains(&n))
            {
                return Some(key.to_string());
            }
            return None;
        }
    };
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "creates a temporary F24 keyboard; requires /dev/uinput access"]
    fn native_key_state_smoke() {
        use evdev::{AttributeSet, KeyCode, KeyEvent};
        let keys = AttributeSet::from_iter([KeyCode::KEY_F24]);
        let mut keyboard = evdev::uinput::VirtualDevice::builder()
            .unwrap()
            .name("Abe disposable hotkey test")
            .with_keys(&keys)
            .unwrap()
            .build()
            .unwrap();
        keyboard
            .emit(&[KeyEvent::new(KeyCode::KEY_F24, 1).into()])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while !pressed_keys().is_some_and(|keys| keys.contains("F24")) {
            assert!(Instant::now() < deadline, "physical key press not detected");
            std::thread::sleep(Duration::from_millis(10));
        }
        keyboard
            .emit(&[KeyEvent::new(KeyCode::KEY_F24, 0).into()])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        while pressed_keys().is_some_and(|keys| keys.contains("F24")) {
            assert!(
                Instant::now() < deadline,
                "physical key release not detected"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn maps_physical_keys_to_the_configured_hotkey_names() {
        for (raw, expected) in [
            ("KEY_LEFTMETA", "Super"),
            ("KEY_A", "A"),
            ("KEY_RIGHTCTRL", "Control"),
            ("KEY_F12", "F12"),
            ("BTN_SIDE", "Mouse4"),
        ] {
            assert_eq!(key_name(raw).as_deref(), Some(expected));
        }
        assert_eq!(key_name("KEY_UNKNOWN"), None);
        assert_eq!(key_name("KEY_F99"), None);
    }
}
