use crate::audio;
use arboard::{Clipboard, ImageData};
use device_query::{DeviceQuery, DeviceState, Keycode};
use enigo::{Direction, Key, Keyboard};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// How long the target app gets to read the clipboard after the paste keystroke
/// before the user's clipboard comes back. Slow apps (Electron, remote desktop)
/// need a few hundred ms (R14).
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(400);

/// Everything that borrows the clipboard runs under this lock, so a paste never
/// starts while the previous one is still restoring.
static CLIPBOARD_LOCK: Mutex<()> = Mutex::new(());

/// Represents the content that was in the clipboard before we modified it
enum ClipboardContent {
    Text(String),
    Image(ImageData<'static>),
    Empty,
}

/// Save current clipboard content (text or image)
fn save_clipboard_content(clipboard: &mut Clipboard) -> ClipboardContent {
    // Try to get text first
    if let Ok(text) = clipboard.get_text() {
        if !text.is_empty() {
            return ClipboardContent::Text(text);
        }
    }

    // Try to get image
    if let Ok(image) = clipboard.get_image() {
        // Clone the image data to make it 'static
        let owned_image = ImageData {
            width: image.width,
            height: image.height,
            bytes: image.bytes.into_owned().into(),
        };
        return ClipboardContent::Image(owned_image);
    }

    ClipboardContent::Empty
}

/// Holds the user's clipboard while Abe borrows it, and puts it back when
/// dropped, on every path including errors (R5).
struct BorrowedClipboard {
    clipboard: Clipboard,
    original: Option<ClipboardContent>,
    /// Text Abe placed. If the clipboard holds something else by the time we
    /// restore, the user copied in the meantime and we leave it alone.
    placed: Option<String>,
}

impl BorrowedClipboard {
    fn take() -> Result<Self, String> {
        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        let original = save_clipboard_content(&mut clipboard);
        Ok(Self {
            clipboard,
            original: Some(original),
            placed: None,
        })
    }

    /// Put text on the clipboard, kept out of clipboard history and cloud sync
    /// where the platform allows it (R14).
    fn set_transient_text(&mut self, text: &str) -> Result<(), String> {
        let set = self.clipboard.set();
        #[cfg(target_os = "windows")]
        let set = {
            use arboard::SetExtWindows;
            set.exclude_from_history()
                .exclude_from_cloud()
                .exclude_from_monitoring()
        };
        #[cfg(target_os = "macos")]
        let set = {
            use arboard::SetExtApple;
            set.exclude_from_history()
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let set = {
            use arboard::SetExtLinux;
            set.exclude_from_history()
        };
        set.text(text).map_err(|e| e.to_string())?;
        self.placed = Some(text.to_string());
        Ok(())
    }

    fn clear(&mut self) -> Result<(), String> {
        self.clipboard.clear().map_err(|e| e.to_string())
    }

    fn text(&mut self) -> String {
        self.clipboard.get_text().unwrap_or_default()
    }
}

impl Drop for BorrowedClipboard {
    fn drop(&mut self) {
        if let Some(placed) = &self.placed {
            if self.clipboard.get_text().ok().as_deref() != Some(placed.as_str()) {
                return;
            }
        }
        let result = match self.original.take() {
            Some(ClipboardContent::Text(text)) => self.clipboard.set_text(text),
            Some(ClipboardContent::Image(image)) => self.clipboard.set_image(image),
            Some(ClipboardContent::Empty) => self.clipboard.clear(),
            None => Ok(()),
        };
        if let Err(e) = result {
            eprintln!("[Clipboard] Failed to restore the clipboard: {}", e);
        }
    }
}

/// Modifiers that would change the meaning of the synthetic paste/copy keystroke.
/// Control is fine on Windows and Linux, where we press it ourselves.
fn is_interfering_modifier(key: &Keycode) -> bool {
    matches!(
        key,
        Keycode::LShift
            | Keycode::RShift
            | Keycode::LAlt
            | Keycode::RAlt
            | Keycode::LOption
            | Keycode::ROption
            | Keycode::LMeta
            | Keycode::RMeta
            | Keycode::Command
    ) || (cfg!(target_os = "macos") && matches!(key, Keycode::LControl | Keycode::RControl))
}

/// Wait for the user to let go of modifiers still held from a hotkey, so the
/// paste isn't read as Ctrl+Shift+V or Cmd+Option+V (R10). After the timeout,
/// release them synthetically (not possible on macOS, where we paste through
/// System Events).
fn release_modifiers(timeout: Duration) {
    // Use physical key state when available on Wayland; never poll XWayland.
    if crate::desktop::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            let deadline = Instant::now() + timeout;
            while let Some(pressed) = crate::linux_input::pressed_keys() {
                if !pressed
                    .iter()
                    .any(|key| matches!(key.as_str(), "Shift" | "Alt" | "Super" | "Control"))
                {
                    return;
                }
                if Instant::now() >= deadline {
                    // A user may release A while still holding Super. The
                    // Wayland virtual keyboard sends its own complete modifier
                    // mask, so physical modifiers need not abort the output.
                    return;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        thread::sleep(Duration::from_millis(150));
        return;
    }
    let Ok(device_state) = std::panic::catch_unwind(DeviceState::new) else {
        return; // No input monitoring permission
    };
    let deadline = Instant::now() + timeout;
    let held = loop {
        let held: Vec<Keycode> = device_state
            .get_keys()
            .into_iter()
            .filter(is_interfering_modifier)
            .collect();
        if held.is_empty() || Instant::now() >= deadline {
            break held;
        }
        thread::sleep(Duration::from_millis(10));
    };

    #[cfg(not(target_os = "macos"))]
    if !held.is_empty() {
        if let Ok(mut enigo) = crate::desktop::keyboard() {
            for key in held {
                let key = match key {
                    Keycode::LShift | Keycode::RShift => Key::Shift,
                    Keycode::LAlt | Keycode::RAlt | Keycode::LOption | Keycode::ROption => Key::Alt,
                    _ => Key::Meta,
                };
                let _ = enigo.key(key, Direction::Release);
            }
        }
    }
    #[cfg(target_os = "macos")]
    let _ = held;
}

/// Send Cmd+<key> on macOS, Ctrl+<key> elsewhere.
fn send_shortcut(key: char) -> Result<(), String> {
    let shifted = crate::desktop::capture_target().is_some_and(|target| target.shifted_clipboard);
    send_shortcut_with_shift(key, shifted)
}

fn send_shortcut_with_shift(key: char, shift: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if crate::desktop::is_wayland() {
        return crate::wayland_shortcuts::send(key, shift);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = shift;
        // osascript is more reliable than enigo here
        let script = format!(
            "tell application \"System Events\" to keystroke \"{}\" using command down",
            key
        );
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Failed to run osascript: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Keystroke failed: {}", stderr));
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut enigo = crate::desktop::keyboard()?;
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| e.to_string())?;
        if shift {
            enigo
                .key(Key::Shift, Direction::Press)
                .map_err(|e| e.to_string())?;
        }
        let clicked = enigo
            .key(Key::Unicode(key), Direction::Click)
            .map_err(|e| e.to_string());
        if shift {
            enigo
                .key(Key::Shift, Direction::Release)
                .map_err(|e| e.to_string())?;
        }
        // Never leave Control stuck down
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| e.to_string())?;
        clicked
    }
}

/// Paste text through the clipboard, then give the user's clipboard back.
fn paste_via_clipboard(text: &str, modifier_timeout: Duration) -> Result<(), String> {
    let shifted = crate::desktop::capture_target().is_some_and(|target| target.shifted_clipboard);
    let _lock = CLIPBOARD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut clipboard = BorrowedClipboard::take()?;
    clipboard.set_transient_text(text)?;
    release_modifiers(modifier_timeout);
    // Small delay to ensure clipboard is set
    thread::sleep(Duration::from_millis(50));
    send_shortcut_with_shift('v', shifted)?;
    thread::sleep(CLIPBOARD_RESTORE_DELAY);
    Ok(())
    // `clipboard` restores the original here, and also on every error above
}

/// Run blocking work (keystrokes, sleeps, resampling) off the async runtime (R18).
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

pub struct AppState {
    pub paste_target: Mutex<Option<crate::desktop::PasteTarget>>,
    pub is_recording: Mutex<bool>,
    /// The last finished recording, read by the transcription engine
    pub capture: Mutex<Option<Arc<audio::Capture>>>,
    pub push_to_talk: Mutex<bool>, // true = push-to-talk, false = toggle mode
    pub last_transcription: Mutex<Option<String>>, // Store last transcription for re-pasting
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            paste_target: Mutex::new(None),
            is_recording: Mutex::new(false),
            capture: Mutex::new(None),
            push_to_talk: Mutex::new(true), // Default to push-to-talk (the frontend syncs the real value at startup)
            last_transcription: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn start_recording(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let state = app.state::<AppState>();
        // Held for the whole start, so a concurrent start or stop waits for it
        let mut is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;

        if *is_recording {
            return Ok(()); // Already recording
        }

        // Drop the previous recording
        *state.paste_target.lock().map_err(|e| e.to_string())? = crate::desktop::capture_target();
        *state.capture.lock().map_err(|e| e.to_string())? = None;

        // Only mark as recording once the microphone is actually open (R4)
        audio::start_capture()?;
        *is_recording = true;
        Ok(())
    })
    .await
}

/// Stop capturing and keep the audio in `AppState` for `transcribe_recording`.
/// Only metadata goes back to the webview.
#[tauri::command]
pub async fn stop_recording(app: AppHandle) -> Result<audio::CaptureInfo, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let mut is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;

        if !*is_recording {
            return Ok(audio::CaptureInfo::default()); // Not recording
        }

        *is_recording = false;

        let capture = audio::stop_capture()?;
        let info = audio::CaptureInfo::from(&capture);
        *state.capture.lock().map_err(|e| e.to_string())? = Some(Arc::new(capture));

        Ok(info)
    })
    .await
}

#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<String>, String> {
    blocking(audio::list_devices).await
}

#[tauri::command]
pub async fn set_audio_device(device_name: Option<String>) -> Result<(), String> {
    audio::set_device(device_name)
}

/// What typewriter mode types, in order
#[derive(Debug, PartialEq)]
enum TypewriterStep<'a> {
    Word(&'a str),
    Space,
    Newline,
}

/// Split text into words, single spaces between them and line breaks, so
/// typewriter mode keeps paragraphs instead of collapsing them (R20).
fn typewriter_steps(text: &str) -> Vec<TypewriterStep<'_>> {
    let mut steps = Vec::new();
    for (line_index, line) in text.split('\n').enumerate() {
        if line_index > 0 {
            steps.push(TypewriterStep::Newline);
        }
        for (i, word) in line.split_whitespace().enumerate() {
            if i > 0 {
                steps.push(TypewriterStep::Space);
            }
            steps.push(TypewriterStep::Word(word));
        }
    }
    steps
}

/// Type text word by word at a specified WPM rate
fn type_text_typewriter(text: &str, words_per_minute: u32) -> Result<(), String> {
    let mut enigo = crate::desktop::keyboard()?;
    if crate::desktop::is_wayland() {
        // Establish an empty modifier mask before plain text, just as the
        // paste path establishes Ctrl (or Ctrl+Shift) explicitly.
        enigo
            .key(Key::Meta, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    // Calculate delay between words based on WPM
    // WPM = words per minute, so delay between words = 60000ms / WPM
    let delay = Duration::from_millis(u64::from(
        60000u32.checked_div(words_per_minute).unwrap_or(200),
    ));

    for step in typewriter_steps(text) {
        match step {
            // Type the entire word at once (much faster than character by character)
            TypewriterStep::Word(word) => enigo.text(word).map_err(|e| e.to_string())?,
            TypewriterStep::Space => {
                enigo.text(" ").map_err(|e| e.to_string())?;
                thread::sleep(delay);
            }
            TypewriterStep::Newline => {
                enigo
                    .key(Key::Return, Direction::Click)
                    .map_err(|e| e.to_string())?;
                thread::sleep(delay);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn paste_text(
    text: String,
    output_mode: Option<String>,
    typing_speed: Option<u32>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Store as last transcription
    {
        let mut last = state.last_transcription.lock().map_err(|e| e.to_string())?;
        *last = Some(text.clone());
    }

    let mode = output_mode.unwrap_or_else(|| "instant".to_string());
    let speed = typing_speed.unwrap_or(1500);
    let target = state
        .paste_target
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let result = blocking(move || {
        if let Some(target) = target {
            crate::desktop::focus_target(&target)?;
        }
        if mode == "typewriter" {
            release_modifiers(Duration::from_millis(500));
            // Small delay to ensure focus is correct
            thread::sleep(Duration::from_millis(50));
            type_text_typewriter(&text, speed)
        } else {
            paste_via_clipboard(&text, Duration::from_millis(500))
        }
    })
    .await;
    if let Err(error) = &result {
        eprintln!("[Paste] Output failed: {error}");
    }
    result
}

#[tauri::command]
pub async fn paste_last_transcription(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let text = state
        .last_transcription
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    match text {
        Some(text) if !text.is_empty() => {
            // This fires on hotkey press: the user is still holding its modifiers
            blocking(move || paste_via_clipboard(&text, Duration::from_millis(1500))).await?;
            Ok(true)
        }
        _ => Ok(false), // No transcription to paste
    }
}

/// Get the currently selected text by simulating Cmd+C (macOS) or Ctrl+C and reading clipboard
/// Returns empty string if no text is selected (does NOT fall back to clipboard content)
#[tauri::command]
pub async fn get_selected_text() -> Result<String, String> {
    blocking(|| {
        let _lock = CLIPBOARD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut clipboard = BorrowedClipboard::take()?;

        // Clear clipboard to detect if copy actually copied something
        clipboard.clear()?;
        release_modifiers(Duration::from_millis(500));
        thread::sleep(Duration::from_millis(50));

        send_shortcut('c')?;

        // Wait for the copy to land (up to 500ms)
        let deadline = Instant::now() + Duration::from_millis(500);
        let mut selected_text = clipboard.text();
        while selected_text.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
            selected_text = clipboard.text();
        }

        // Return the selected text (empty if nothing was selected);
        // `clipboard` puts the user's clipboard back when it goes out of scope
        Ok(selected_text)
    })
    .await
}

#[tauri::command]
pub async fn set_push_to_talk(
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut ptt = state.push_to_talk.lock().map_err(|e| e.to_string())?;
    *ptt = enabled;
    Ok(())
}

#[tauri::command]
pub fn get_audio_level() -> f32 {
    audio::get_audio_level()
}

#[tauri::command]
pub fn check_voice_detected(threshold: f32) -> bool {
    audio::has_voice_detected(threshold)
}

/// Save exported history through a native save dialog. The webview has no
/// filesystem access: the only path ever written is the one the user picks.
/// Returns false if the user cancels.
#[tauri::command]
pub async fn export_history(
    window: tauri::WebviewWindow,
    contents: String,
    file_name: String,
) -> Result<bool, String> {
    blocking(move || {
        let extension = Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("txt")
            .to_string();

        let picked = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(&file_name)
            .add_filter(extension.to_uppercase(), &[extension.as_str()])
            .blocking_save_file();

        let Some(path) = picked else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use TypewriterStep::*;

    /// Focus a disposable editor that mirrors its text to ABE_SMOKE_RESULT.
    /// This exercises the actual clipboard and input backend, not a mock.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a desktop and focused disposable editor; see docs/linux.md"]
    fn linux_paste_smoke() {
        let result_path = std::env::var("ABE_SMOKE_RESULT")
            .expect("set ABE_SMOKE_RESULT to the editor's output file");
        let mut clipboard = Clipboard::new().expect("desktop clipboard");
        let original = clipboard.get_text().ok();
        // Capture the intended destination before the held-modifier setup,
        // whose hotplug rendezvous can take a few seconds on a live desktop.
        let original_target = crate::desktop::capture_target();
        let mut held_modifier = if std::env::var_os("ABE_SMOKE_HOLD_SUPER").is_some() {
            use evdev::{AttributeSet, KeyCode, KeyEvent};
            let keys = AttributeSet::from_iter([KeyCode::KEY_LEFTMETA]);
            let mut keyboard = evdev::uinput::VirtualDevice::builder()
                .unwrap()
                .name("Abe disposable held modifier test")
                .with_keys(&keys)
                .unwrap()
                .build()
                .unwrap();
            keyboard
                .emit(&[KeyEvent::new(KeyCode::KEY_LEFTMETA, 1).into()])
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(4);
            while !crate::linux_input::pressed_keys().is_some_and(|keys| keys.contains("Super")) {
                assert!(
                    Instant::now() < deadline,
                    "held Super was not visible to the paste guard"
                );
                thread::sleep(Duration::from_millis(10));
            }
            Some(keyboard)
        } else {
            None
        };
        if let Ok(id) = std::env::var("ABE_SMOKE_OTHER_WINDOW") {
            let original_target = original_target.expect("capture test destination");
            let other = crate::desktop::PasteTarget {
                id: id.parse().unwrap(),
                shifted_clipboard: false,
            };
            crate::desktop::focus_target(&other).expect("focus disposable distraction");
            assert_ne!(other.id, original_target.id);
            crate::desktop::focus_target(&original_target).expect("restore original destination");
        }
        let paste_result = paste_via_clipboard("Abe Linux paste test.", Duration::from_millis(500));
        if let Some(keyboard) = &mut held_modifier {
            use evdev::{KeyCode, KeyEvent};
            keyboard
                .emit(&[KeyEvent::new(KeyCode::KEY_LEFTMETA, 0).into()])
                .unwrap();
        }
        paste_result.expect("native paste");
        let deadline = Instant::now() + Duration::from_secs(3);
        while std::fs::read_to_string(&result_path).ok().as_deref() != Some("Abe Linux paste test.")
        {
            assert!(
                Instant::now() < deadline,
                "the editor did not receive the paste"
            );
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(
            clipboard.get_text().ok(),
            original,
            "clipboard must be restored"
        );
    }

    #[test]
    fn typewriter_keeps_line_breaks() {
        assert_eq!(
            typewriter_steps("Dear Sam,\n\nThanks  a lot.\r\nBye"),
            vec![
                Word("Dear"),
                Space,
                Word("Sam,"),
                Newline,
                Newline,
                Word("Thanks"),
                Space,
                Word("a"),
                Space,
                Word("lot."),
                Newline,
                Word("Bye"),
            ]
        );
        assert!(typewriter_steps("").is_empty());
        assert_eq!(typewriter_steps("  one  "), vec![Word("one")]);
    }

    #[test]
    fn modifier_filter() {
        assert!(is_interfering_modifier(&Keycode::LShift));
        assert!(is_interfering_modifier(&Keycode::RAlt));
        assert!(is_interfering_modifier(&Keycode::LMeta));
        assert!(!is_interfering_modifier(&Keycode::V));
        assert_eq!(
            is_interfering_modifier(&Keycode::LControl),
            cfg!(target_os = "macos")
        );
    }
}
