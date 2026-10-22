#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod audio;
mod commands;
mod engine;
mod hotkeys;
mod system_audio;

use device_query::{DeviceQuery, DeviceState, Keycode};
use hotkeys::{hotkey_matches, hotkey_still_held, parse_hotkey_string};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder};

// Platform-specific scroll wheel imports
#[cfg(target_os = "macos")]
use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEventTap, CGEventTapLocation, CGEventTapPlacement, CGEventTapOptions, CGEventType};

#[cfg(target_os = "windows")]
use rdev::{listen, Event, EventType};

// Window state for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// A monitor's area in physical pixels: x, y, width, height
type MonitorRect = (i32, i32, u32, u32);

impl WindowState {
    /// Whether enough of the window's title bar is on some monitor to grab it.
    /// Saved positions can point at a monitor that has since been unplugged (R16).
    fn is_reachable(&self, monitors: &[MonitorRect]) -> bool {
        let (x, y) = (i64::from(self.x), i64::from(self.y));
        let title_bar_right = x + i64::from(self.width);
        let title_bar_bottom = y + 40;
        monitors.iter().any(|&(mx, my, mw, mh)| {
            let (mx, my) = (i64::from(mx), i64::from(my));
            let overlap_w = title_bar_right.min(mx + i64::from(mw)) - x.max(mx);
            let overlap_h = title_bar_bottom.min(my + i64::from(mh)) - y.max(my);
            overlap_w >= 100.min(i64::from(self.width)) && overlap_h >= 20
        })
    }
}

fn get_window_state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|p| p.join("window_state.json"))
}

fn save_window_state(app: &AppHandle, state: &WindowState) {
    if let Some(path) = get_window_state_path(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(state) {
            let _ = fs::write(path, json);
        }
    }
}

fn load_window_state(app: &AppHandle) -> Option<WindowState> {
    let path = get_window_state_path(app)?;
    let json = fs::read_to_string(path).ok()?;
    serde_json::from_str(&json).ok()
}

// Track if hotkeys are currently active (being held)
static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
static PASTE_LAST_HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
static TRANSFORM_HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);

// Flag to disable all hotkey detection (used when recording new hotkeys in settings)
static HOTKEYS_DISABLED: AtomicBool = AtomicBool::new(false);

// Minimum time between two paste-last activations, to prevent double-firing
const PASTE_LAST_COOLDOWN: Duration = Duration::from_millis(500);

// Hotkey configuration storage
lazy_static::lazy_static! {
    static ref HOTKEY_KEYS: RwLock<HashSet<String>> = RwLock::new({
        let mut set = HashSet::new();
        set.insert("Control".to_string());
        set.insert("Alt".to_string());
        set.insert("Space".to_string());
        set
    });
    static ref PASTE_LAST_HOTKEY_KEYS: RwLock<HashSet<String>> = RwLock::new({
        let mut set = HashSet::new();
        set.insert("Control".to_string());
        set.insert("Alt".to_string());
        set.insert("V".to_string());
        set
    });
    static ref TRANSFORM_HOTKEY_KEYS: RwLock<HashSet<String>> = RwLock::new({
        let mut set = HashSet::new();
        set.insert("Control".to_string());
        set.insert("Alt".to_string());
        set.insert("T".to_string());
        set
    });

    // Current wheel event (set by scroll listener, cleared after processing)
    static ref CURRENT_WHEEL_EVENT: RwLock<Option<String>> = RwLock::new(None);
}

// Scroll listener state. The listener thread starts once and is never torn
// down: stopping the macOS event tap leaked a run loop per toggle (R15). While no
// hotkey needs it, it ignores events.
#[cfg(any(target_os = "macos", target_os = "windows"))]
static SCROLL_LISTENER_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static SCROLL_LISTENER_WANTED: AtomicBool = AtomicBool::new(false);

// Windows-only: Mouse buttons currently pressed (tracked via rdev)
#[cfg(target_os = "windows")]
lazy_static::lazy_static! {
    static ref RDEV_MOUSE_BUTTONS_PRESSED: RwLock<HashSet<String>> = RwLock::new(HashSet::new());
}

// Check if any hotkey uses mouse wheel or mouse buttons
#[cfg(target_os = "macos")]
fn any_hotkey_uses_mouse() -> bool {
    let check_mouse = |keys: &HashSet<String>| {
        keys.iter().any(|k| k.starts_with("Wheel") || k.starts_with("Mouse"))
    };

    [&*HOTKEY_KEYS, &*PASTE_LAST_HOTKEY_KEYS, &*TRANSFORM_HOTKEY_KEYS]
        .iter()
        .any(|lock| lock.read().map(|keys| check_mouse(&keys)).unwrap_or(false))
}

// Start rdev listener if needed (platform-specific) - for wheel and mouse button detection
fn update_rdev_listener() {
    // On Windows, always run the rdev listener for reliable mouse button detection
    #[cfg(target_os = "windows")]
    start_scroll_listener();

    // On macOS, only listen while a hotkey uses the wheel (not supported on Linux yet)
    #[cfg(target_os = "macos")]
    {
        let wanted = any_hotkey_uses_mouse();
        SCROLL_LISTENER_WANTED.store(wanted, Ordering::SeqCst);
        if wanted {
            start_scroll_listener();
        }
    }
}

#[cfg(target_os = "macos")]
fn start_scroll_listener() {
    if SCROLL_LISTENER_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }

    thread::spawn(|| {
        // Create event tap for scroll wheel events
        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::ScrollWheel],
            |_proxy, _event_type, event| {
                use core_graphics::event::EventField;
                if !SCROLL_LISTENER_WANTED.load(Ordering::SeqCst) {
                    return None;
                }
                // Trackpads and other precision devices scroll continuously; only
                // discrete wheel clicks count as wheel hotkeys (R8)
                if event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_IS_CONTINUOUS) != 0 {
                    return None;
                }
                let delta_y = event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_1);
                if let Some(wheel_event) = hotkeys::wheel_name(delta_y) {
                    if let Ok(mut current) = CURRENT_WHEEL_EVENT.write() {
                        *current = Some(wheel_event.to_string());
                    }
                }

                None // Don't modify the event
            },
        );

        match tap {
            Ok(tap) => {
                // Get the run loop source from the tap
                let loop_source = tap.mach_port.create_runloop_source(0).expect("Failed to create run loop source");

                // Get the current run loop and add the source
                let run_loop = CFRunLoop::get_current();
                run_loop.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });

                // Enable the tap
                tap.enable();

                // Run the loop (this blocks)
                CFRunLoop::run_current();
            }
            Err(e) => {
                eprintln!("Failed to create scroll event tap: {:?}. Make sure accessibility permissions are granted.", e);
            }
        }

        SCROLL_LISTENER_RUNNING.store(false, Ordering::SeqCst);
    });
}

#[cfg(target_os = "windows")]
fn rdev_button_to_string(button: rdev::Button) -> String {
    match button {
        rdev::Button::Left => "MouseLeft".to_string(),
        rdev::Button::Right => "MouseRight".to_string(),
        rdev::Button::Middle => "MouseMiddle".to_string(),
        // XBUTTON1/XBUTTON2 arrive as Unknown(1)/Unknown(2) (R1)
        rdev::Button::Unknown(n) => hotkeys::xbutton_name(n),
    }
}

#[cfg(target_os = "windows")]
fn start_scroll_listener() {
    if SCROLL_LISTENER_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }

    thread::spawn(|| {
        let callback = |event: Event| {
            match event.event_type {
                // Horizontal scrolling has no vertical delta and is ignored (R8)
                EventType::Wheel { delta_x: _, delta_y } => {
                    if let Some(wheel_event) = hotkeys::wheel_name(delta_y) {
                        if let Ok(mut current) = CURRENT_WHEEL_EVENT.write() {
                            *current = Some(wheel_event.to_string());
                        }
                    }
                }
                EventType::ButtonPress(button) => {
                    if let Ok(mut pressed) = RDEV_MOUSE_BUTTONS_PRESSED.write() {
                        pressed.insert(rdev_button_to_string(button));
                    }
                }
                EventType::ButtonRelease(button) => {
                    if let Ok(mut pressed) = RDEV_MOUSE_BUTTONS_PRESSED.write() {
                        pressed.remove(&rdev_button_to_string(button));
                    }
                }
                _ => {}
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("Windows rdev listener failed: {:?}", error);
        }

        SCROLL_LISTENER_RUNNING.store(false, Ordering::SeqCst);
    });
}


// Convert device_query Keycode to our string format
fn keycode_to_string(key: &Keycode) -> String {
    match key {
        // Modifiers (handle all platform variants)
        Keycode::LControl | Keycode::RControl => "Control".to_string(),
        Keycode::LShift | Keycode::RShift => "Shift".to_string(),
        Keycode::LAlt | Keycode::RAlt => "Alt".to_string(),
        Keycode::LOption | Keycode::ROption => "Alt".to_string(), // macOS Option = Alt
        Keycode::LMeta | Keycode::RMeta => "Super".to_string(),
        Keycode::Command => "Super".to_string(), // macOS Command
        // Letters
        Keycode::A => "A".to_string(),
        Keycode::B => "B".to_string(),
        Keycode::C => "C".to_string(),
        Keycode::D => "D".to_string(),
        Keycode::E => "E".to_string(),
        Keycode::F => "F".to_string(),
        Keycode::G => "G".to_string(),
        Keycode::H => "H".to_string(),
        Keycode::I => "I".to_string(),
        Keycode::J => "J".to_string(),
        Keycode::K => "K".to_string(),
        Keycode::L => "L".to_string(),
        Keycode::M => "M".to_string(),
        Keycode::N => "N".to_string(),
        Keycode::O => "O".to_string(),
        Keycode::P => "P".to_string(),
        Keycode::Q => "Q".to_string(),
        Keycode::R => "R".to_string(),
        Keycode::S => "S".to_string(),
        Keycode::T => "T".to_string(),
        Keycode::U => "U".to_string(),
        Keycode::V => "V".to_string(),
        Keycode::W => "W".to_string(),
        Keycode::X => "X".to_string(),
        Keycode::Y => "Y".to_string(),
        Keycode::Z => "Z".to_string(),
        // Numbers
        Keycode::Key0 => "0".to_string(),
        Keycode::Key1 => "1".to_string(),
        Keycode::Key2 => "2".to_string(),
        Keycode::Key3 => "3".to_string(),
        Keycode::Key4 => "4".to_string(),
        Keycode::Key5 => "5".to_string(),
        Keycode::Key6 => "6".to_string(),
        Keycode::Key7 => "7".to_string(),
        Keycode::Key8 => "8".to_string(),
        Keycode::Key9 => "9".to_string(),
        // Function keys
        Keycode::F1 => "F1".to_string(),
        Keycode::F2 => "F2".to_string(),
        Keycode::F3 => "F3".to_string(),
        Keycode::F4 => "F4".to_string(),
        Keycode::F5 => "F5".to_string(),
        Keycode::F6 => "F6".to_string(),
        Keycode::F7 => "F7".to_string(),
        Keycode::F8 => "F8".to_string(),
        Keycode::F9 => "F9".to_string(),
        Keycode::F10 => "F10".to_string(),
        Keycode::F11 => "F11".to_string(),
        Keycode::F12 => "F12".to_string(),
        // Special keys
        Keycode::Space => "Space".to_string(),
        Keycode::Enter => "Return".to_string(),
        Keycode::Escape => "Escape".to_string(),
        Keycode::Backspace => "Backspace".to_string(),
        Keycode::Tab => "Tab".to_string(),
        Keycode::Up => "Up".to_string(),
        Keycode::Down => "Down".to_string(),
        Keycode::Left => "Left".to_string(),
        Keycode::Right => "Right".to_string(),
        Keycode::Delete => "Delete".to_string(),
        Keycode::Home => "Home".to_string(),
        Keycode::End => "End".to_string(),
        Keycode::PageUp => "PageUp".to_string(),
        Keycode::PageDown => "PageDown".to_string(),
        Keycode::Insert => "Insert".to_string(),
        Keycode::CapsLock => "CapsLock".to_string(),
        Keycode::Numpad0 => "Numpad0".to_string(),
        Keycode::Numpad1 => "Numpad1".to_string(),
        Keycode::Numpad2 => "Numpad2".to_string(),
        Keycode::Numpad3 => "Numpad3".to_string(),
        Keycode::Numpad4 => "Numpad4".to_string(),
        Keycode::Numpad5 => "Numpad5".to_string(),
        Keycode::Numpad6 => "Numpad6".to_string(),
        Keycode::Numpad7 => "Numpad7".to_string(),
        Keycode::Numpad8 => "Numpad8".to_string(),
        Keycode::Numpad9 => "Numpad9".to_string(),
        // Symbols
        Keycode::Grave => "`".to_string(),
        Keycode::Minus => "-".to_string(),
        Keycode::Equal => "=".to_string(),
        Keycode::LeftBracket => "[".to_string(),
        Keycode::RightBracket => "]".to_string(),
        Keycode::BackSlash => "\\".to_string(),
        Keycode::Semicolon => ";".to_string(),
        Keycode::Apostrophe => "'".to_string(),
        Keycode::Comma => ",".to_string(),
        Keycode::Dot => ".".to_string(),
        Keycode::Slash => "/".to_string(),
        _ => format!("{:?}", key),
    }
}

// Convert mouse button index to string
// Note: On macOS, middle button is index 3, not 2
// (Windows reads mouse buttons from rdev instead.)
#[cfg(not(target_os = "windows"))]
fn mouse_button_to_string(button: usize) -> String {
    #[cfg(target_os = "macos")]
    {
        match button {
            0 => "MouseLeft".to_string(),
            1 => "MouseRight".to_string(),
            3 => "MouseMiddle".to_string(),  // macOS reports middle as index 3
            2 => "Mouse4".to_string(),
            4 => "Mouse5".to_string(),
            n => format!("Mouse{}", n + 1),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        match button {
            0 => "MouseLeft".to_string(),
            1 => "MouseRight".to_string(),
            2 => "MouseMiddle".to_string(),
            3 => "Mouse4".to_string(),
            4 => "Mouse5".to_string(),
            n => format!("Mouse{}", n + 1),
        }
    }
}

/// Replace a hotkey. If the old one was held, tell the frontend it was released,
/// or push-to-talk would keep recording with nothing left to stop it (R6).
fn replace_hotkey(
    app: &AppHandle,
    keys: &RwLock<HashSet<String>>,
    active: &AtomicBool,
    release_event: Option<&str>,
    hotkey: &str,
) -> Result<(), String> {
    let new_keys = parse_hotkey_string(hotkey);
    if new_keys.is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    *keys.write().map_err(|e| e.to_string())? = new_keys;

    if active.swap(false, Ordering::SeqCst) {
        if let Some(event) = release_event {
            let _ = app.emit(event, ());
        }
    }

    // Update scroll listener if needed
    update_rdev_listener();
    Ok(())
}

/// Release every held hotkey, emitting the release events the frontend waits for
fn release_active_hotkeys(app: &AppHandle) {
    if HOTKEY_ACTIVE.swap(false, Ordering::SeqCst) {
        let _ = app.emit("hotkey-released", ());
    }
    if TRANSFORM_HOTKEY_ACTIVE.swap(false, Ordering::SeqCst) {
        let _ = app.emit("transform-hotkey-released", ());
    }
    PASTE_LAST_HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
}

#[tauri::command]
async fn set_hotkey(app_handle: AppHandle, hotkey: String) -> Result<(), String> {
    replace_hotkey(&app_handle, &HOTKEY_KEYS, &HOTKEY_ACTIVE, Some("hotkey-released"), &hotkey)
}

#[tauri::command]
async fn set_paste_last_hotkey(app_handle: AppHandle, hotkey: String) -> Result<(), String> {
    replace_hotkey(&app_handle, &PASTE_LAST_HOTKEY_KEYS, &PASTE_LAST_HOTKEY_ACTIVE, None, &hotkey)
}

#[tauri::command]
async fn set_transform_hotkey(app_handle: AppHandle, hotkey: String) -> Result<(), String> {
    replace_hotkey(
        &app_handle,
        &TRANSFORM_HOTKEY_KEYS,
        &TRANSFORM_HOTKEY_ACTIVE,
        Some("transform-hotkey-released"),
        &hotkey,
    )
}

#[tauri::command]
async fn set_hotkeys_enabled(app_handle: AppHandle, enabled: bool) -> Result<(), String> {
    HOTKEYS_DISABLED.store(!enabled, Ordering::SeqCst);

    if !enabled {
        release_active_hotkeys(&app_handle);
    }

    Ok(())
}

// Overlay geometry, in logical pixels. All overlay positions are logical so they
// line up at any display scaling (R17).
const OVERLAY_WIDTH: f64 = 320.0;
const OVERLAY_HEIGHT: f64 = 80.0;
const OVERLAY_BOTTOM_MARGIN: f64 = 40.0;
// Where the draggable pill sits inside the overlay
const PILL_OFFSET_X: f64 = 115.0;
const PILL_OFFSET_Y: f64 = 4.0;

/// Set once the overlay has a position (the default or the user's), so showing
/// it again doesn't throw away a position restored by the frontend.
static OVERLAY_POSITIONED: AtomicBool = AtomicBool::new(false);

fn move_overlays(app_handle: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("overlay") {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
    }
    if let Some(interaction_window) = app_handle.get_webview_window("overlay-interaction") {
        interaction_window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: x + PILL_OFFSET_X,
                y: y + PILL_OFFSET_Y,
            }))
            .map_err(|e| e.to_string())?;
    }
    OVERLAY_POSITIONED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Show the overlay. It goes to the default spot (bottom center of the primary
/// monitor) the first time, or when `reset` is true.
#[tauri::command]
async fn show_overlay(app_handle: AppHandle, reset: Option<bool>) -> Result<(), String> {
    let Some(window) = app_handle.get_webview_window("overlay") else {
        return Ok(());
    };
    if reset.unwrap_or(false) || !OVERLAY_POSITIONED.load(Ordering::SeqCst) {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let scale = monitor.scale_factor();
            let origin = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            let x = (origin.x + size.width / 2.0 - OVERLAY_WIDTH / 2.0).round();
            let y = (origin.y + size.height - OVERLAY_HEIGHT - OVERLAY_BOTTOM_MARGIN).round();
            move_overlays(&app_handle, x, y)?;
        }
    }
    if let Some(interaction_window) = app_handle.get_webview_window("overlay-interaction") {
        let _ = interaction_window.show();
    }
    window.show().map_err(|e| e.to_string())
}

#[tauri::command]
async fn hide_overlay(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    if let Some(interaction_window) = app_handle.get_webview_window("overlay-interaction") {
        let _ = interaction_window.hide();
    }
    Ok(())
}

/// Move the overlay and its draggable pill together. `x`/`y` are the overlay's
/// top-left corner in logical pixels (CSS screen coordinates).
#[tauri::command]
async fn position_overlay(app_handle: AppHandle, x: f64, y: f64) -> Result<(), String> {
    move_overlays(&app_handle, x, y)
}

#[tauri::command]
fn set_window_size(window: tauri::WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: (width as f64).max(80.0),
            height: (height as f64).max(100.0),
        }))
        .map_err(|e| e.to_string())
}

/// Windows the frontend may open on demand. They are declared in tauri.conf.json
/// with `"create": false` so they aren't built at startup.
const ON_DEMAND_WINDOWS: &[&str] = &["history", "garden"];

// Async on purpose: building a webview from a sync command deadlocks on Windows.
#[tauri::command]
async fn open_window(app_handle: AppHandle, label: String) -> Result<(), String> {
    if !ON_DEMAND_WINDOWS.contains(&label.as_str()) {
        return Err(format!("Unknown window: {}", label));
    }

    let window = match app_handle.get_webview_window(&label) {
        Some(window) => window,
        None => {
            let config = app_handle
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == label)
                .cloned()
                .ok_or_else(|| format!("No config for window: {}", label))?;
            WebviewWindowBuilder::from_config(&app_handle, &config)
                .and_then(|builder| builder.build())
                .map_err(|e| e.to_string())?
        }
    };

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The debug console only exists in debug builds. Open it from the tray menu.
#[cfg(debug_assertions)]
fn open_debug_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("debug") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        "debug",
        tauri::WebviewUrl::App("index.html#/debug".into()),
    )
    .title("Debug Console")
    .inner_size(700.0, 500.0)
    .min_inner_size(400.0, 300.0)
    .center()
    .build();
    if let Err(e) = result {
        eprintln!("Failed to open debug window: {}", e);
    }
}

#[tauri::command]
fn is_updater_enabled() -> bool {
    cfg!(feature = "updater")
}

#[tauri::command]
async fn reduce_other_apps_volume(volume_percent: f32) -> Result<(), String> {
    let target_volume = (volume_percent / 100.0).clamp(0.0, 1.0);
    tauri::async_runtime::spawn_blocking(move || system_audio::reduce_other_apps_volume(target_volume))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_other_apps_volume() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(system_audio::restore_other_apps_volume)
        .await
        .map_err(|e| e.to_string())?
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    #[cfg(debug_assertions)]
    menu.insert(
        &MenuItem::with_id(app, "debug", "Debug Console", true, None::<&str>)?,
        1,
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Abe")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            // Volumes are restored in the RunEvent::Exit handler
            "quit" => app.exit(0),
            #[cfg(debug_assertions)]
            "debug" => open_debug_window(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Polls the keyboard (and mouse) and turns hotkey presses into events
fn run_hotkey_loop(event_handle: AppHandle) {
    println!("[Hotkeys] Starting hotkey detection loop...");

    // Try to create DeviceState - this panics on macOS if no accessibility permissions
    // Retry every 5 seconds until permissions are granted
    let device_state = loop {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(DeviceState::new)) {
            Ok(state) => {
                println!("[Hotkeys] DeviceState initialized successfully");
                let _ = event_handle.emit("hotkey-debug", serde_json::json!({
                    "event": "init",
                    "message": "Accessibility permissions granted - hotkeys enabled!"
                }));
                break state;
            }
            Err(_) => {
                eprintln!("[Hotkeys] Waiting for Accessibility permissions... retrying in 5 seconds");
                let _ = event_handle.emit("hotkey-debug", serde_json::json!({
                    "event": "waiting",
                    "message": "Waiting for Accessibility permissions. Please add this app in System Settings > Privacy & Security > Accessibility. Retrying in 5 seconds..."
                }));
                thread::sleep(Duration::from_secs(5));
            }
        }
    };

    let poll_interval = Duration::from_millis(10); // Poll every 10ms
    let mut keys_detected_ever = false;
    let mut last_paste_last: Option<Instant> = None;
    #[cfg(target_os = "macos")]
    let (started, mut warned_no_keys) = (Instant::now(), false);

    loop {
        thread::sleep(poll_interval);

        // Skip if hotkeys are disabled
        if HOTKEYS_DISABLED.load(Ordering::SeqCst) {
            continue;
        }

        // Get current keyboard state
        let keys: Vec<Keycode> = device_state.get_keys();

        if !keys.is_empty() && !keys_detected_ever {
            keys_detected_ever = true;
            let _ = event_handle.emit("hotkey-debug", serde_json::json!({
                "event": "first_key",
                "message": "First key detected - Accessibility permissions working!"
            }));
        }

        // On macOS no keys at all usually means Input Monitoring isn't granted. Say so once.
        #[cfg(target_os = "macos")]
        if !keys_detected_ever && !warned_no_keys && started.elapsed() > Duration::from_secs(10) {
            warned_no_keys = true;
            println!("[Hotkeys] No keys detected yet. Check Accessibility and Input Monitoring in System Settings.");
            let _ = event_handle.emit("hotkey-debug", serde_json::json!({
                "event": "status",
                "message": "No keys detected yet. Check Accessibility and Input Monitoring permissions."
            }));
        }

        let mut pressed: HashSet<String> = keys.iter().map(keycode_to_string).collect();

        // Get current mouse state (platform-specific)
        #[cfg(target_os = "windows")]
        {
            // Use rdev-tracked mouse state on Windows for reliable detection
            if let Ok(mouse_buttons) = RDEV_MOUSE_BUTTONS_PRESSED.read() {
                for button in mouse_buttons.iter() {
                    pressed.insert(button.clone());
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Use device_query on other platforms
            let mouse = device_state.get_mouse();
            for (idx, &is_pressed) in mouse.button_pressed.iter().enumerate() {
                if is_pressed {
                    pressed.insert(mouse_button_to_string(idx));
                }
            }
        }

        // Add the wheel event from the scroll listener, if any (taking clears it)
        if let Some(wheel) = CURRENT_WHEEL_EVENT.write().ok().and_then(|mut w| w.take()) {
            pressed.insert(wheel);
        }

        // Get hotkey configurations
        let record_hotkey = HOTKEY_KEYS.read().ok().map(|h| h.clone());
        let transform_hotkey = TRANSFORM_HOTKEY_KEYS.read().ok().map(|h| h.clone());
        let paste_last_hotkey = PASTE_LAST_HOTKEY_KEYS.read().ok().map(|h| h.clone());

        let record_active = HOTKEY_ACTIVE.load(Ordering::SeqCst);
        let transform_active = TRANSFORM_HOTKEY_ACTIVE.load(Ordering::SeqCst);

        // Handle TRANSFORM hotkey. It counts as released only once none of its
        // keys are held, so the selection is copied with the modifiers up.
        if let Some(ref transform_hk) = transform_hotkey {
            let any_hotkey_key_pressed = transform_hk.iter().any(|k| pressed.contains(k));

            if hotkey_matches(&pressed, transform_hk) && !transform_active {
                if !record_active {
                    TRANSFORM_HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    let _ = event_handle.emit("transform-hotkey-pressed", ());
                }
            } else if transform_active && !any_hotkey_key_pressed {
                TRANSFORM_HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
                let _ = event_handle.emit("transform-hotkey-released", ());
            }
        }

        // Handle RECORD hotkey
        if let Some(ref record_hk) = record_hotkey {
            if hotkey_matches(&pressed, record_hk) && !record_active {
                if !TRANSFORM_HOTKEY_ACTIVE.load(Ordering::SeqCst) {
                    HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    let _ = event_handle.emit("hotkey-pressed", ());
                }
            } else if record_active && !hotkey_still_held(&pressed, record_hk) {
                HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
                let _ = event_handle.emit("hotkey-released", ());
            }
        }

        // Handle PASTE-LAST hotkey
        if let Some(ref paste_hk) = paste_last_hotkey {
            let paste_last_active = PASTE_LAST_HOTKEY_ACTIVE.load(Ordering::SeqCst);

            if hotkey_matches(&pressed, paste_hk) && !paste_last_active {
                // Monotonic clock: wall-clock jumps can't break the cooldown (R21)
                if last_paste_last.is_none_or(|t| t.elapsed() >= PASTE_LAST_COOLDOWN) {
                    PASTE_LAST_HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    last_paste_last = Some(Instant::now());
                    let _ = event_handle.emit("paste-last-pressed", ());
                }
            } else if paste_last_active && !hotkey_still_held(&pressed, paste_hk) {
                PASTE_LAST_HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
            }
        }
    }
}

/// Put the main window back where it was, unless that spot is no longer on any monitor
fn restore_main_window(app: &tauri::App) {
    let Some(main_window) = app.get_webview_window("main") else { return };
    let Some(state) = load_window_state(app.handle()) else { return };

    let monitors: Vec<MonitorRect> = main_window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
        .collect();
    if state.is_reachable(&monitors) {
        let _ = main_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: state.x,
            y: state.y,
        }));
    }

    let scale = main_window.scale_factor().unwrap_or(1.0);
    let min_w = (80.0 * scale) as u32;
    let min_h = (100.0 * scale) as u32;
    let _ = main_window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: state.width.max(min_w),
        height: state.height.max(min_h),
    }));
}

fn main() {
    // single-instance must be registered before any other plugin.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "updater")]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .manage(commands::AppState::default())
        .manage(engine::EngineState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size())
                    {
                        save_window_state(window.app_handle(), &WindowState {
                            x: position.x,
                            y: position.y,
                            width: size.width,
                            height: size.height,
                        });
                    }
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(feature = "updater")]
            app.add_capability(include_str!("../capabilities-runtime/updater.json"))?;

            // Undo volume ducking left over from a run that crashed (R3)
            if let Ok(dir) = handle.path().app_local_data_dir() {
                system_audio::init(dir);
            }
            audio::init(handle.clone());

            build_tray(app)?;
            restore_main_window(app);

            // Start rdev listener for mouse/wheel detection (Windows needs this for reliable mouse buttons)
            update_rdev_listener();

            // Start input polling thread for hotkey detection
            thread::spawn(move || run_hotkey_loop(handle));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::get_audio_devices,
            commands::set_audio_device,
            commands::paste_text,
            commands::paste_last_transcription,
            commands::get_selected_text,
            commands::set_push_to_talk,
            commands::get_audio_level,
            commands::check_voice_detected,
            commands::export_history,
            set_hotkey,
            set_paste_last_hotkey,
            set_transform_hotkey,
            set_hotkeys_enabled,
            show_overlay,
            hide_overlay,
            position_overlay,
            reduce_other_apps_volume,
            restore_other_apps_volume,
            set_window_size,
            open_window,
            is_updater_enabled,
            engine::get_engine_status,
            engine::transcribe_recording,
            engine::transform_text,
            engine::set_api_key,
            engine::has_api_key,
            engine::delete_api_key,
            engine::test_api_key,
            engine::list_local_models,
            engine::download_local_model,
            engine::cancel_local_model_download,
            engine::delete_local_model,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, event| {
        // Tray Quit, app.exit() and OS shutdown all end here: give other apps
        // their volume back (R3)
        if let tauri::RunEvent::Exit = event {
            if let Err(e) = system_audio::restore_other_apps_volume() {
                eprintln!("[Audio] Failed to restore volumes on exit: {}", e);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(x: i32, y: i32) -> WindowState {
        WindowState { x, y, width: 400, height: 600 }
    }

    #[test]
    fn window_on_a_connected_monitor_is_reachable() {
        let monitors = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert!(window(100, 100).is_reachable(&monitors));
        assert!(window(3000, 200).is_reachable(&monitors));
        // Mostly off the right edge, but 120px of title bar is still visible
        assert!(window(4360, 0).is_reachable(&monitors));
    }

    #[test]
    fn window_on_an_unplugged_monitor_is_not() {
        let monitors = [(0, 0, 1920, 1080)];
        assert!(!window(2500, 100).is_reachable(&monitors));
        assert!(!window(100, -500).is_reachable(&monitors));
        assert!(!window(1900, 100).is_reachable(&monitors));
        assert!(!window(100, 100).is_reachable(&[]));
    }
}
