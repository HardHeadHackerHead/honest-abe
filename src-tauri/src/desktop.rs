//! Desktop input selection. XWayland cannot observe or type into native Wayland apps.
use enigo::{Enigo, Settings};

#[derive(Clone, Debug)]
pub struct PasteTarget {
    #[cfg(target_os = "linux")]
    pub id: u64,
    pub shifted_clipboard: bool,
}

#[cfg(any(target_os = "linux", test))]
fn shifted_clipboard_app(app: &str) -> bool {
    matches!(
        app.to_ascii_lowercase().as_str(),
        "com.mitchellh.ghostty" | "ghostty" | "alacritty" | "kitty" |
        "org.wezfurlong.wezterm" | "org.gnome.terminal" | "gnome-terminal" |
        "org.kde.konsole" | "konsole" | "foot" | "footclient" | "xfce4-terminal" |
        // Neovide needs the mappings in docs/neovide-clipboard.lua. Ctrl+V
        // itself is Vim's literal-next-key command, not clipboard paste.
        "neovide" | "com.neovide.neovide"
    )
}

#[cfg(target_os = "linux")]
fn niri_request(request: serde_json::Value) -> Result<serde_json::Value, String> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::net::UnixStream;
    use std::time::Duration;
    let path = std::env::var_os("NIRI_SOCKET").ok_or("No Niri socket")?;
    let mut stream = UnixStream::connect(path).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| e.to_string())?;
    writeln!(stream, "{request}").map_err(|e| e.to_string())?;
    let mut response = String::new();
    BufReader::new(stream.take(64 * 1024))
        .read_line(&mut response)
        .map_err(|e| e.to_string())?;
    let response: serde_json::Value = serde_json::from_str(&response).map_err(|e| e.to_string())?;
    response
        .get("Ok")
        .cloned()
        .ok_or_else(|| "Niri rejected the focus request".to_string())
}

pub fn capture_target() -> Option<PasteTarget> {
    #[cfg(target_os = "linux")]
    {
        let response = niri_request(serde_json::json!("FocusedWindow")).ok()?;
        let window = response.get("FocusedWindow")?;
        let app = window.get("app_id").and_then(|v| v.as_str()).unwrap_or("");
        if matches!(
            app,
            "Abe" | "abe" | "io.quadslab.abe" | "io.quadslab.abe.dev"
        ) {
            return None;
        }
        Some(PasteTarget {
            id: window.get("id")?.as_u64()?,
            shifted_clipboard: shifted_clipboard_app(app),
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

pub fn focus_target(target: &PasteTarget) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        niri_request(serde_json::json!({"Action": {"FocusWindow": {"id": target.id}}}))?;
        // The compositor processes the focus request asynchronously. Confirm
        // the destination before sending any text; never paste into a fallback.
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(700);
        loop {
            if capture_target().is_some_and(|current| current.id == target.id) {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("The original destination window is no longer available".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = target;
        Ok(())
    }
}

pub fn is_wayland() -> bool {
    cfg!(target_os = "linux")
        && wayland_session(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        )
}

fn wayland_session(session: Option<&str>, display: Option<&str>) -> bool {
    match session {
        Some("wayland") => true,
        Some("x11") => false,
        _ => display.is_some_and(|value| !value.is_empty()),
    }
}

pub fn keyboard() -> Result<Enigo, String> {
    let mut settings = Settings::default();
    if is_wayland() {
        // Enigo 0.2 sends every event to BOTH connections when both succeed.
        // x11rb rejects an empty display name, selecting Wayland exclusively
        // without mutating the process environment or duplicating XWayland input.
        settings.x11_display = Some(String::new());
    } else {
        // Likewise, do not connect to a stale Wayland socket in an X11 session.
        settings.wayland_display = Some(String::new());
    }
    Enigo::new(&settings).map_err(|error| {
        if is_wayland() {
            format!("Wayland typing is unavailable: {error}. Your compositor must support the virtual-keyboard protocol (for example Niri, Sway or Hyprland).")
        } else {
            error.to_string()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_the_session_even_with_xwayland_or_stale_environment() {
        assert!(wayland_session(Some("wayland"), Some("wayland-1")));
        assert!(wayland_session(Some("wayland"), None));
        assert!(wayland_session(None, Some("wayland-1")));
        assert!(!wayland_session(Some("x11"), Some("wayland-1")));
        assert!(!wayland_session(None, Some("")));
        assert!(!wayland_session(None, None));
    }

    #[test]
    fn shifted_clipboard_shortcuts_match_terminals_and_neovide() {
        assert!(shifted_clipboard_app("com.mitchellh.ghostty"));
        assert!(shifted_clipboard_app("Alacritty"));
        assert!(shifted_clipboard_app("neovide"));
        assert!(shifted_clipboard_app("com.neovide.neovide"));
        assert!(!shifted_clipboard_app("org.gnome.TextEditor"));
        assert!(!shifted_clipboard_app(""));
    }
}
