// System audio control for reducing other applications' volume during recording
// Windows: per-app volume via Windows Audio Session API
// macOS: system output volume via osascript (no per-app volume API available)
//
// While ducked, the original volumes are also written to disk. Quit restores them,
// and so does the next startup if Abe crashed or was killed while ducked (R3).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// What Abe turned down and how to undo it
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckState {
    /// Output device the sessions belong to (Windows endpoint id)
    pub device_id: Option<String>,
    /// The volume the sessions were set to
    pub ducked_volume: f32,
    pub sessions: Vec<DuckedSession>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckedSession {
    /// Process id (0 for the macOS system volume)
    pub pid: u32,
    /// Windows session identifier. It survives an app restart, and Windows
    /// remembers per-app volume across restarts, so it finds the app after a crash.
    pub app_id: Option<String>,
    pub original_volume: f32,
}

/// The volume to put back for a session, if any. During a normal restore every
/// ducked process gets its volume back. After a crash (`stale`), pids may have
/// been reused, so a session is only touched when it is still at the ducked
/// level, i.e. nobody changed it since.
pub fn restore_volume_for(
    state: &DuckState,
    pid: u32,
    app_id: Option<&str>,
    current_volume: f32,
    stale: bool,
) -> Option<f32> {
    let session = state.sessions.iter().find(|s| s.pid == pid).or_else(|| {
        if !stale {
            return None;
        }
        let app_id = app_id?;
        state.sessions.iter().find(|s| s.app_id.as_deref() == Some(app_id))
    })?;
    if stale && (current_volume - state.ducked_volume).abs() > 0.01 {
        return None;
    }
    Some(session.original_volume)
}

static STATE_FILE: OnceLock<PathBuf> = OnceLock::new();
static DUCKED: Mutex<Option<DuckState>> = Mutex::new(None);

/// Call once at startup with the app data directory. Restores volumes left
/// ducked by a previous run that didn't exit cleanly.
pub fn init(data_dir: PathBuf) {
    let path = data_dir.join("ducked_volume.json");
    let _ = STATE_FILE.set(path.clone());

    let Ok(json) = fs::read_to_string(&path) else { return };
    match serde_json::from_str::<DuckState>(&json) {
        Ok(stale) => match platform::restore(&stale, true) {
            Ok(()) => remove_state_file(),
            Err(e) => eprintln!("[Audio] Could not restore volumes from the last run: {}", e),
        },
        Err(_) => remove_state_file(),
    }
}

fn write_state_file(state: &DuckState) -> Result<(), String> {
    let Some(path) = STATE_FILE.get() else { return Ok(()) };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("Failed to save ducked volumes: {}", e))
}

fn remove_state_file() {
    if let Some(path) = STATE_FILE.get() {
        let _ = fs::remove_file(path);
    }
}

/// Reduce other apps' volume to `target_volume` (0.0 = mute, 1.0 = full volume)
pub fn reduce_other_apps_volume(target_volume: f32) -> Result<(), String> {
    let mut ducked = DUCKED.lock().unwrap_or_else(|e| e.into_inner());
    if ducked.is_some() {
        return Ok(());
    }

    let state = platform::snapshot(target_volume.clamp(0.0, 1.0))?;
    if state.sessions.is_empty() {
        return Ok(());
    }

    // On disk before anything changes, so a crash right after can be undone.
    // Without that safety net, don't duck at all.
    write_state_file(&state)?;
    *ducked = Some(state);
    if let Some(state) = ducked.as_ref() {
        platform::apply(state)?;
    }
    Ok(())
}

/// Put back the volumes saved by `reduce_other_apps_volume`. The saved state is
/// only dropped once the restore succeeded, so a failed restore can be retried.
pub fn restore_other_apps_volume() -> Result<(), String> {
    let mut ducked = DUCKED.lock().unwrap_or_else(|e| e.into_inner());
    let Some(state) = ducked.as_ref() else {
        return Ok(());
    };
    platform::restore(state, false)?;
    *ducked = None;
    remove_state_file();
    Ok(())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{restore_volume_for, DuckState, DuckedSession};
    use std::process;
    use windows::{
        core::{Interface, GUID, PCWSTR, PWSTR},
        Win32::{
            Media::Audio::{
                eConsole, eRender, IAudioSessionControl, IAudioSessionControl2,
                IAudioSessionEnumerator, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator,
                ISimpleAudioVolume, MMDeviceEnumerator,
            },
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL,
                COINIT_APARTMENTTHREADED,
            },
        },
    };

    struct Session {
        pid: u32,
        app_id: Option<String>,
        volume: ISimpleAudioVolume,
    }

    /// Copy a COM-allocated string and free it
    unsafe fn take_string(p: PWSTR) -> Option<String> {
        if p.is_null() {
            return None;
        }
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }

    /// The device with this id, or the default output device
    unsafe fn output_device(id: Option<&str>) -> Result<IMMDevice, String> {
        // Commands can run on any thread; COM must be initialized on each
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create device enumerator: {}", e))?;
        if let Some(id) = id {
            let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
            if let Ok(device) = enumerator.GetDevice(PCWSTR(wide.as_ptr())) {
                return Ok(device);
            }
        }
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {}", e))
    }

    /// Audio sessions of other processes (not Abe, not system sounds)
    unsafe fn other_sessions(device: &IMMDevice) -> Result<Vec<Session>, String> {
        let session_manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to get session manager: {}", e))?;
        let session_enumerator: IAudioSessionEnumerator = session_manager
            .GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {}", e))?;
        let session_count = session_enumerator
            .GetCount()
            .map_err(|e| format!("Failed to get session count: {}", e))?;

        let our_pid = process::id();
        let mut sessions = Vec::new();
        for i in 0..session_count {
            let Ok(control) = session_enumerator.GetSession(i) else { continue };
            let control: IAudioSessionControl = control;
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
            let Ok(pid) = control2.GetProcessId() else { continue };
            if pid == our_pid || pid == 0 {
                continue;
            }
            let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
            let app_id = control2.GetSessionIdentifier().ok().and_then(|p| take_string(p));
            sessions.push(Session { pid, app_id, volume });
        }
        Ok(sessions)
    }

    /// Record which sessions are louder than the target, without changing anything
    pub fn snapshot(target_volume: f32) -> Result<DuckState, String> {
        unsafe {
            let device = output_device(None)?;
            let device_id = device.GetId().ok().and_then(|p| take_string(p));
            let sessions = other_sessions(&device)?
                .into_iter()
                .filter_map(|s| {
                    let current = s.volume.GetMasterVolume().ok()?;
                    (current > target_volume).then_some(DuckedSession {
                        pid: s.pid,
                        app_id: s.app_id,
                        original_volume: current,
                    })
                })
                .collect();
            Ok(DuckState { device_id, ducked_volume: target_volume, sessions })
        }
    }

    pub fn apply(state: &DuckState) -> Result<(), String> {
        unsafe {
            let device = output_device(state.device_id.as_deref())?;
            for session in other_sessions(&device)? {
                if state.sessions.iter().any(|s| s.pid == session.pid) {
                    let null_guid: *const GUID = std::ptr::null();
                    let _ = session.volume.SetMasterVolume(state.ducked_volume, null_guid);
                }
            }
            Ok(())
        }
    }

    pub fn restore(state: &DuckState, stale: bool) -> Result<(), String> {
        unsafe {
            let device = output_device(state.device_id.as_deref())?;
            for session in other_sessions(&device)? {
                let Ok(current) = session.volume.GetMasterVolume() else { continue };
                if let Some(original) =
                    restore_volume_for(state, session.pid, session.app_id.as_deref(), current, stale)
                {
                    let null_guid: *const GUID = std::ptr::null();
                    let _ = session.volume.SetMasterVolume(original, null_guid);
                }
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{restore_volume_for, DuckState, DuckedSession};
    use std::process::Command;

    fn output_volume() -> Result<f32, String> {
        // Returns an integer 0-100
        let output = Command::new("osascript")
            .args(["-e", "output volume of (get volume settings)"])
            .output()
            .map_err(|e| format!("Failed to get system volume: {}", e))?;
        if !output.status.success() {
            return Err("osascript failed to get volume".to_string());
        }
        let current = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let percent: f32 = current
            .parse()
            .map_err(|e| format!("Failed to parse volume '{}': {}", current, e))?;
        Ok(percent / 100.0)
    }

    fn set_output_volume(volume: f32) -> Result<(), String> {
        let script = format!("set volume output volume {}", (volume * 100.0).round() as i32);
        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("Failed to set system volume: {}", e))?;
        if !output.status.success() {
            return Err("osascript failed to set volume".to_string());
        }
        Ok(())
    }

    /// macOS has no per-app volume API, so this records the system output volume
    /// (as pid 0) if it is louder than the target.
    pub fn snapshot(target_volume: f32) -> Result<DuckState, String> {
        let current = output_volume()?;
        let sessions = if current > target_volume {
            vec![DuckedSession { pid: 0, app_id: None, original_volume: current }]
        } else {
            Vec::new()
        };
        Ok(DuckState { device_id: None, ducked_volume: target_volume, sessions })
    }

    pub fn apply(state: &DuckState) -> Result<(), String> {
        set_output_volume(state.ducked_volume)
    }

    pub fn restore(state: &DuckState, stale: bool) -> Result<(), String> {
        let current = output_volume()?;
        if let Some(original) = restore_volume_for(state, 0, None, current, stale) {
            set_output_volume(original)?;
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::DuckState;

    pub fn snapshot(target_volume: f32) -> Result<DuckState, String> {
        Ok(DuckState { device_id: None, ducked_volume: target_volume, sessions: Vec::new() })
    }

    pub fn apply(_state: &DuckState) -> Result<(), String> {
        Ok(())
    }

    pub fn restore(_state: &DuckState, _stale: bool) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> DuckState {
        DuckState {
            device_id: Some("{0.0.0.00000000}.{abc}".to_string()),
            ducked_volume: 0.2,
            sessions: vec![
                DuckedSession { pid: 100, app_id: Some("spotify".to_string()), original_volume: 0.8 },
                DuckedSession { pid: 200, app_id: None, original_volume: 1.0 },
            ],
        }
    }

    #[test]
    fn duck_state_round_trips() {
        let json = serde_json::to_string(&state()).unwrap();
        assert!(json.contains("\"deviceId\""));
        assert!(json.contains("\"originalVolume\":0.8"));
        assert_eq!(serde_json::from_str::<DuckState>(&json).unwrap(), state());
    }

    #[test]
    fn restores_by_pid_during_a_run() {
        let s = state();
        assert_eq!(restore_volume_for(&s, 100, None, 0.5, false), Some(0.8));
        assert_eq!(restore_volume_for(&s, 200, None, 0.2, false), Some(1.0));
        assert_eq!(restore_volume_for(&s, 300, Some("spotify"), 0.2, false), None);
    }

    #[test]
    fn stale_restore_only_touches_untouched_sessions() {
        let s = state();
        // Same app restarted under a new pid, still at the ducked level
        assert_eq!(restore_volume_for(&s, 300, Some("spotify"), 0.2, true), Some(0.8));
        // The user changed it since
        assert_eq!(restore_volume_for(&s, 100, Some("spotify"), 0.6, true), None);
        // Unknown app
        assert_eq!(restore_volume_for(&s, 400, Some("other"), 0.2, true), None);
        assert_eq!(restore_volume_for(&s, 400, None, 0.2, true), None);
    }
}
