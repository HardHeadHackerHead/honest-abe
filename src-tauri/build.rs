// Every command registered in main.rs must be listed here. Each entry generates
// an `allow-<command>` permission. Because an app manifest exists, every app
// command is deny-by-default: a window can only call a command when one of its
// capabilities (capabilities/*.json) grants that permission, and a command left
// out of this list can't be granted to anyone.
const COMMANDS: &[&str] = &[
    // Recording and audio
    "start_recording",
    "stop_recording",
    "get_audio_devices",
    "set_audio_device",
    "get_audio_level",
    "check_voice_detected",
    "set_push_to_talk",
    "reduce_other_apps_volume",
    "restore_other_apps_volume",
    // Keystroke injection and clipboard
    "paste_text",
    "paste_last_transcription",
    "get_selected_text",
    // Hotkeys
    "set_hotkey",
    "set_paste_last_hotkey",
    "set_transform_hotkey",
    "set_hotkeys_enabled",
    // Windows
    "show_overlay",
    "hide_overlay",
    "position_overlay",
    "set_window_size",
    "open_window",
    // History export (native save dialog, writes only to the chosen path)
    "export_history",
    // Updater availability (the updater itself is behind the `updater` feature)
    "is_updater_enabled",
    "needs_desktop_shortcuts",
    // Transcription engine and provider keys
    "get_engine_status",
    "transcribe_recording",
    "transform_text",
    "set_api_key",
    "has_api_key",
    "delete_api_key",
    "test_api_key",
    // Local Whisper models
    "list_local_models",
    "download_local_model",
    "cancel_local_model_download",
    "delete_local_model",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
