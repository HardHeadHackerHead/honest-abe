//! Clipboard shortcuts need a real evdev keymap. Enigo 0.2 dynamically maps
//! characters onto reserved keycodes, which Chromium ignores entirely.
use std::io::Write;
use std::os::fd::AsFd;
use wayland_client::{
    delegate_noop,
    protocol::{wl_registry, wl_seat},
    Connection, Dispatch, QueueHandle,
};
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::{
    zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1,
    zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1,
};
use xkbcommon::xkb;

#[derive(Default)]
struct State {
    manager: Option<ZwpVirtualKeyboardManagerV1>,
    seat: Option<wl_seat::WlSeat>,
}

impl Dispatch<wl_registry::WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        registry: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_registry::Event::Global {
            name, interface, ..
        } = event
        {
            match interface.as_str() {
                "wl_seat" if state.seat.is_none() => {
                    state.seat = Some(registry.bind(name, 1, qh, ()));
                }
                "zwp_virtual_keyboard_manager_v1" => {
                    state.manager = Some(registry.bind(name, 1, qh, ()));
                }
                _ => {}
            }
        }
    }
}

delegate_noop!(State: ignore wl_seat::WlSeat);
delegate_noop!(State: ignore ZwpVirtualKeyboardManagerV1);
delegate_noop!(State: ignore ZwpVirtualKeyboardV1);

fn shortcut_keycode(key: char) -> Result<u32, String> {
    // Linux evdev keycodes, without XKB's +8 offset.
    match key {
        'c' => Ok(46),
        'v' => Ok(47),
        _ => Err("Unsupported clipboard shortcut".to_string()),
    }
}

fn shortcut_keymap() -> Result<xkb::Keymap, String> {
    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    xkb::Keymap::new_from_names(
        &context,
        "evdev",
        "pc105",
        "us",
        "",
        None,
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    )
    .ok_or_else(|| "Failed to build clipboard shortcut keymap".to_string())
}

pub fn send(key: char, shift: bool) -> Result<(), String> {
    let code = shortcut_keycode(key)?;
    let connection = Connection::connect_to_env().map_err(|e| e.to_string())?;
    let mut queue = connection.new_event_queue();
    let qh = queue.handle();
    connection.display().get_registry(&qh, ());
    let mut state = State::default();
    queue.roundtrip(&mut state).map_err(|e| e.to_string())?;
    let manager = state
        .manager
        .as_ref()
        .ok_or("Wayland virtual-keyboard protocol unavailable")?;
    let seat = state.seat.as_ref().ok_or("No Wayland input seat")?;
    let keyboard = manager.create_virtual_keyboard(seat, &qh, ());

    // This is the virtual keyboard's layout, independent of the user's layout.
    let keymap = shortcut_keymap()?;
    let control = keymap.mod_get_index(xkb::MOD_NAME_CTRL);
    let shift_index = keymap.mod_get_index(xkb::MOD_NAME_SHIFT);
    if control >= 32 || shift_index >= 32 {
        return Err("Clipboard shortcut keymap has no Control/Shift modifiers".to_string());
    }
    let mask = (1 << control) | if shift { 1 << shift_index } else { 0 };
    let mut file = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut text = keymap
        .get_as_string(xkb::KEYMAP_FORMAT_TEXT_V1)
        .into_bytes();
    text.push(0); // The protocol includes the terminating NUL in the size.
    file.write_all(&text).map_err(|e| e.to_string())?;
    keyboard.keymap(
        1,
        file.as_fd(),
        text.len().try_into().map_err(|_| "Keymap too large")?,
    );
    queue.roundtrip(&mut state).map_err(|e| e.to_string())?;
    keyboard.modifiers(mask, 0, 0, 0);
    keyboard.key(0, code, 1);
    keyboard.key(1, code, 0);
    keyboard.modifiers(0, 0, 0, 0);
    queue.roundtrip(&mut state).map_err(|e| e.to_string())?;
    keyboard.destroy();
    queue.roundtrip(&mut state).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_keymap_has_the_standard_physical_and_logical_keys() {
        let keymap = shortcut_keymap().unwrap();
        for (key, physical_name) in [('c', "AB03"), ('v', "AB04")] {
            let code = xkb::Keycode::new(shortcut_keycode(key).unwrap() + 8);
            assert_eq!(keymap.key_get_name(code), Some(physical_name));
            let symbols = keymap.key_get_syms_by_level(code, 0, 0);
            assert_eq!(symbols.len(), 1);
            assert_eq!(xkb::keysym_to_utf32(symbols[0]), key as u32);
        }
        assert!(shortcut_keycode('a').is_err());
    }
}
