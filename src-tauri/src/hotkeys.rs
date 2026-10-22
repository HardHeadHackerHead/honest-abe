// Pure hotkey logic shared by the polling loop in main.rs. Key names match the
// frontend's hotkey strings ("Control+Alt+Space", "Mouse4", "WheelUp").

use std::collections::HashSet;

/// Parse "Control+Alt+Space" into its key names.
pub fn parse_hotkey_string(hotkey: &str) -> HashSet<String> {
    hotkey
        .split('+')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Mouse buttons and wheel ticks. Their state comes from a separate listener and
/// can lag or stick, so they only count when the hotkey itself uses them.
fn is_pointer_input(key: &str) -> bool {
    key.starts_with("Mouse") || key.starts_with("Wheel")
}

/// Exact match: every hotkey key is down and no other key is. Ctrl+Shift+V must
/// not fire on Ctrl+Shift+Alt+V (R9). Pointer input outside the hotkey is
/// ignored, so holding a mouse button doesn't block a keyboard shortcut.
pub fn hotkey_matches(pressed: &HashSet<String>, hotkey: &HashSet<String>) -> bool {
    if hotkey.is_empty() || !hotkey.is_subset(pressed) {
        return false;
    }
    pressed
        .iter()
        .all(|key| hotkey.contains(key) || is_pointer_input(key))
}

/// A hotkey that already fired stays held while all of its keys are down, even
/// if the user presses something else in the meantime.
pub fn hotkey_still_held(pressed: &HashSet<String>, hotkey: &HashSet<String>) -> bool {
    !hotkey.is_empty() && hotkey.is_subset(pressed)
}

/// Windows reports the side buttons as XBUTTON1/XBUTTON2, which rdev passes on as
/// `Button::Unknown(1)` and `Button::Unknown(2)`. The browser (and so the hotkey
/// recorder) calls them buttons 3 and 4, saved as "Mouse4" and "Mouse5" (R1).
pub fn xbutton_name(code: u8) -> String {
    match code {
        1 => "Mouse4".to_string(),
        2 => "Mouse5".to_string(),
        n => format!("Mouse{}", u16::from(n) + 3),
    }
}

/// Vertical wheel direction. Horizontal scrolling and zero-delta touchpad events
/// report no vertical movement and must not register as "WheelDown" (R8).
pub fn wheel_name(delta_y: i64) -> Option<&'static str> {
    match delta_y {
        d if d > 0 => Some("WheelUp"),
        d if d < 0 => Some("WheelDown"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_hotkey_strings() {
        assert_eq!(parse_hotkey_string("Control+Alt+Space"), keys(&["Control", "Alt", "Space"]));
        assert_eq!(parse_hotkey_string(" Control + V "), keys(&["Control", "V"]));
        assert!(parse_hotkey_string("").is_empty());
        assert!(parse_hotkey_string("+").is_empty());
    }

    #[test]
    fn matches_exactly() {
        let hotkey = keys(&["Control", "Shift", "V"]);
        assert!(hotkey_matches(&keys(&["Control", "Shift", "V"]), &hotkey));
        assert!(!hotkey_matches(&keys(&["Control", "Shift", "Alt", "V"]), &hotkey));
        assert!(!hotkey_matches(&keys(&["Control", "V"]), &hotkey));
        assert!(!hotkey_matches(&keys(&[]), &hotkey));
        assert!(!hotkey_matches(&keys(&["Control"]), &keys(&[])));
    }

    #[test]
    fn ignores_unrelated_pointer_input() {
        let hotkey = keys(&["Control", "Alt", "Space"]);
        assert!(hotkey_matches(&keys(&["Control", "Alt", "Space", "MouseLeft"]), &hotkey));
        assert!(hotkey_matches(&keys(&["Control", "Alt", "Space", "WheelDown"]), &hotkey));

        let mouse = keys(&["Mouse4"]);
        assert!(hotkey_matches(&keys(&["Mouse4"]), &mouse));
        assert!(hotkey_matches(&keys(&["Mouse4", "MouseLeft"]), &mouse));
        assert!(!hotkey_matches(&keys(&["Mouse4", "Shift"]), &mouse));
        assert!(!hotkey_matches(&keys(&["Mouse5"]), &mouse));
    }

    #[test]
    fn held_tolerates_extra_keys() {
        let hotkey = keys(&["Control", "Alt", "Space"]);
        assert!(hotkey_still_held(&keys(&["Control", "Alt", "Space", "Shift"]), &hotkey));
        assert!(!hotkey_still_held(&keys(&["Control", "Space"]), &hotkey));
        assert!(!hotkey_still_held(&keys(&["Control"]), &keys(&[])));
    }

    #[test]
    fn maps_side_buttons_like_the_browser() {
        assert_eq!(xbutton_name(1), "Mouse4");
        assert_eq!(xbutton_name(2), "Mouse5");
        assert_eq!(xbutton_name(3), "Mouse6");
        assert_eq!(xbutton_name(255), "Mouse258");
    }

    #[test]
    fn wheel_direction() {
        assert_eq!(wheel_name(120), Some("WheelUp"));
        assert_eq!(wheel_name(-1), Some("WheelDown"));
        assert_eq!(wheel_name(0), None);
    }
}
