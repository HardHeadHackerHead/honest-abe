# Running Abe on Linux

Abe builds as a native Tauri application. It needs GTK 3, WebKitGTK 4.1, ALSA,
an AppIndicator implementation for its tray menu, and a running desktop session.
Local Whisper runs on the CPU by default; CUDA and PyTorch are not required.

## Build and launch

Install Node.js 20+, stable Rust, and the native dependencies:

```bash
# Arch Linux
sudo pacman -S --needed base-devel webkit2gtk-4.1 libappindicator-gtk3 \
  librsvg patchelf alsa-lib libx11 libxi libxtst dbus pkgconf cmake clang

# Debian / Ubuntu
sudo apt install build-essential libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev \
  libasound2-dev libx11-dev libxi-dev libxtst-dev libdbus-1-dev \
  pkg-config cmake clang libclang-dev

npm ci
npm run tauri:dev
```

If `sharp` tries to compile against a system libvips and fails during `npm ci`,
use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci` to select its prebuilt binary.

To build a standalone executable with its UI embedded:

```bash
npm run tauri -- build --no-bundle
./src-tauri/target/release/Abe
```

For a faster development build without a Vite server, add `--debug`; the
executable is then `src-tauri/target/debug/Abe`. A custom `CARGO_TARGET_DIR`
changes these output paths. For distribution packaging, select the desired
Linux format explicitly, for example `npm run tauri -- build --bundles deb`.
Build packages on the oldest distribution you intend to support.

Start Abe from your desktop session, with its display, D-Bus and audio
environment. Pick a local model or configure your own provider key in setup.
API keys require an unlocked Secret Service implementation, such as GNOME
Keyring or a compatible KWallet configuration. No API key is needed locally.

## X11

The configured keyboard hotkeys, clipboard paste and typewriter output use the
X11 display. Left, middle and right mouse buttons are supported. Wheel and side
button hotkeys are not supported by the current Linux polling backend.

## Wayland

The X11 polling listener is disabled on Wayland: XWayland cannot observe keys
in native Wayland applications. If your account already has read access to
`/dev/input/event*`, Abe queries current physical key state directly. Configured
hotkeys then support both push-to-talk (hold, release to stop) and toggle mode,
including mouse buttons. Abe does not grab devices or retain a keystroke history.
It does not modify device permissions. Hot-plugged devices are refreshed within
two seconds. Do not also bind the same chord to the toggle command below.

Physical key-state detection does not consume keys. Reserve the dictation chord
in your compositor so editors such as Neovide do not receive it or repeat it.
For Niri with native input access, add this to your existing `binds` block:

```kdl
Super+A repeat=false allow-inhibiting=false hotkey-overlay-title="Abe: hold to dictate" {
    spawn "/usr/bin/true";
}
```

This binding only consumes Super+A; Abe still detects its physical press and
release. It does not invoke Abe's toggle action. Change both the compositor
binding and Abe's shortcut setting if you choose a different chord.

When keyboard-device access is unavailable, use the tray's **Start / stop
dictation** action, the recording button, or configure desktop shortcuts to run:

```bash
/absolute/path/to/Abe --toggle-recording
/absolute/path/to/Abe --paste-last
```

Keep Abe running first. These commands send an action to the existing instance
without focusing it, preserving the destination for the paste. If Abe is not
running, they launch the setup window; press the shortcut again after setup.
The toggle command starts on one press and stops on the next, regardless of the
push-to-talk setting. Use non-repeating desktop bindings. The shortcut keys are
configured in the desktop, not Abe's Shortcuts settings, for this fallback mode.
Voice Transform's built-in global hotkey requires native keyboard-device access.

For Niri, add bindings inside your existing `binds` block, substituting the
actual executable path:

```kdl
Ctrl+Alt+Space repeat=false { spawn "/absolute/path/to/Abe" "--toggle-recording"; }
Ctrl+Alt+V repeat=false { spawn "/absolute/path/to/Abe" "--paste-last"; }
```

Native Wayland paste and typewriter output require the virtual-keyboard
protocol. Niri, Sway and Hyprland provide it. Clipboard access uses the
Wayland data-control protocol. Other compositors, including GNOME and KDE,
are not qualified by this implementation; compositor shortcuts alone do not
enable native typing on a compositor without these protocols. History retains
transcriptions if automatic paste fails, so they can still be copied manually.

On Niri, Abe records the destination window at the start of capture and restores
it before pasting. Start Abe with `NIRI_SOCKET` set (as it is when launched from
Niri). If that destination has closed, Abe leaves the transcription in history
and reports a paste error. Known terminal app IDs, including Ghostty, use
Ctrl+Shift+C/V; other applications use Ctrl+C/V. Other compositors currently
paste into the window focused when transcription completes.

Wayland clipboard shortcuts use a standard evdev/XKB keyboard map with real
C/V keycodes. This lets Chromium-based browsers, including Thorium, recognize
the shortcut; Enigo 0.2's temporary character keycodes are ignored by Chromium.

Neovide also uses Ctrl+Shift+V. Load [neovide-clipboard.lua](neovide-clipboard.lua)
from your Neovim config to map that chord to `nvim_paste`, following
[Neovide's documented clipboard integration](https://neovide.dev/faq.html#how-can-i-use-cmd-ccmd-v-to-copy-and-paste).
The snippet is guarded by `vim.g.neovide`, preserving terminal mappings and
Vim's Ctrl+V literal-input / visual-block behavior. Without this integration,
Neovide forwards the shortcut to Vim rather than pasting from the clipboard.

Release the shortcut modifiers before paste completes. Without keyboard-device
access Abe cannot inspect physical modifiers. Releasing the letter while still
holding Super does not abort output: the virtual keyboard supplies the intended
modifier mask for paste or plain typing. The floating recording overlays
are disabled on Wayland because ordinary toplevel windows can steal focus when
shown; the main window and recording sounds still indicate state. Reducing other
applications' volume during recording is currently unimplemented on Linux.

## Verification

```bash
npm run build
npm test
cd src-tauri
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

The ignored `commands::tests::linux_paste_smoke` test exercises native paste
and clipboard restoration. Focus a disposable editor whose text is mirrored
to a file, then set `ABE_SMOKE_RESULT` to that file and run:

```bash
ABE_SMOKE_RESULT=/tmp/abe-editor.txt cargo test --locked linux_paste_smoke -- --ignored --nocapture
```

The editor must start empty. The test pastes `Abe Linux paste test.` and checks
that the editor receives exactly one copy and that the original text clipboard
is restored. It needs access to your real desktop; do not run it against a
window containing work you want to keep.

`cargo test linux_capture_smoke -- --ignored --nocapture` briefly opens the
default microphone, captures 250 ms, resamples and encodes it in memory, then
closes it without saving or sending the audio.

`cargo test native_key_state_smoke -- --ignored --nocapture` creates a temporary
F24-only virtual keyboard and verifies both physical press and release state.
It requires existing `/dev/uinput` and keyboard-device access. The virtual
device is removed when the test finishes. To additionally test destination
restoration during the paste smoke test, set `ABE_SMOKE_OTHER_WINDOW` to a
second disposable Niri window ID; the test switches to it and restores the
original editor before pasting.
Set `ABE_SMOKE_HOLD_SUPER=1` to verify that paste still succeeds while a
temporary virtual keyboard holds Super. This test waits until the physical
modifier guard observes Super before trying to paste.
