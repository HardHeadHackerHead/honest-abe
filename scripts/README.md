# Abe Release Pipeline

How official Abe releases are built, signed and published.

Building from source does **not** need any of this: `npm install && npm run tauri build`
produces an unsigned app with the auto-updater compiled out.

---

## Build requirements

Local Whisper is compiled in (whisper-rs builds whisper.cpp from source), so every
build needs a C/C++ toolchain, CMake and libclang in addition to Node and Rust:

| Platform | Install |
|---|---|
| Windows | Visual Studio 2022 Build Tools with "Desktop development with C++", [CMake](https://cmake.org/download/), [LLVM](https://github.com/llvm/llvm-project/releases) (for libclang) |
| macOS | Xcode command line tools, `brew install cmake` |
| Linux (Debian/Ubuntu) | `cmake clang libclang-dev libdbus-1-dev pkg-config` plus the usual Tauri packages |

If libclang isn't found, set `LIBCLANG_PATH` (e.g. `C:\Program Files\LLVM\bin`).

**Windows troubleshooting.** If the build fails with `'stdio.h' file not found` (bindgen) or
`could not find any instance of Visual Studio` (CMake), the newest Visual Studio found has
no C++ toolset (common with a partial VS 2026 Build Tools install). Build from an
"x64 Native Tools Command Prompt for VS 2022" (or run `vcvars64.bat` first), then
`cargo clean -p whisper-rs-sys` so the cached failure is rebuilt.

GPU acceleration is optional and off by default. Cargo features `metal` (macOS),
`vulkan` and `cuda` pass through to whisper-rs. Official macOS Apple silicon builds use
`metal`; its shader library is embedded, so it needs no extra entitlements.

---

## Build flavours

| | Source build (default) | Official release |
|---|---|---|
| Command | `npm run tauri build` | `scripts/build-release.ps1`, `scripts/release-macos.sh`, or the `Release` workflow |
| Cargo feature `updater` | off | on (`--features updater`) |
| Cargo feature `metal` | off | on for macOS Apple silicon |
| Updater artifacts (`createUpdaterArtifacts`) | off | on, signed with the Tauri updater key |
| Authenticode / Developer ID | none | QwickCert (Windows, local only) / Developer ID + notarization (macOS) |

Without the `updater` feature the updater and process plugins aren't compiled in,
`is_updater_enabled` returns false, and the update UI stays hidden. Forks therefore
never try to install official binaries.

The updater endpoint and public key live in `src-tauri/tauri.conf.json`
(`plugins.updater`). The endpoint is
`https://github.com/HardHeadHackerHead/honest-abe/releases/latest/download/latest.json`.

---

## Release assets

Asset names carry no version, so `releases/latest/download/<asset>` links stay stable:

| Asset | Platform | Updater bundle (in `latest.json`) |
|---|---|---|
| `Abe-windows-x64-setup.exe` | Windows x64 | the installer itself (`windows-x86_64`) |
| `Abe-macos-arm64.dmg` | macOS Apple silicon | `Abe-macos-arm64.app.tar.gz` (`darwin-aarch64`) |
| `Abe-macos-x64.dmg` | macOS Intel | `Abe-macos-x64.app.tar.gz` (`darwin-x86_64`) |
| `latest.json` | all | updater manifest |

Linux isn't published for 1.0. CI still compiles and tests it on every pull request.

---

## Prerequisites (one-time setup)

1. **Tauri updater key** in `keys/tauri-signing-key` (+ `.pub`)
   - Generate with `npm run release:keys` only if you are starting a new key; the
     public key must match `plugins.updater.pubkey`. Losing the official private key
     strands every installed user from auto-update, so keep it backed up offline.
   - Scripts read `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
     from the environment, falling back to the key file and a stored password:
     - **Windows:** `cmdkey /generic:TauriSigningKey /user:tauri /pass:YOUR_PASSWORD`
     - **macOS:** run `./scripts/release-macos.sh` and press `p` (Keychain)

2. **QwickCert** (optional, Windows Authenticode)
   - Log in: `qwick auth login`, verify: `qwick doctor`
   - If `qwick` isn't installed (or you pass `-NoSign`) the installer is built unsigned.

3. **Apple Developer ID** (macOS signing + notarization)
   - Developer ID Application certificate in the Keychain. The script signs with
     `APPLE_SIGNING_IDENTITY`, or the first Developer ID certificate it finds.
   - Press `a` in the release tool to store the Apple ID, Team ID and app-specific
     password for notarization (exported as `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`).

4. **GitHub CLI**: `gh auth login`

---

## Releasing on Windows

```powershell
npm run release:patch     # bump 1.0.0 -> 1.0.1, build, sign, upload
npm run release:minor     # bump 1.0.0 -> 1.1.0
npm run release:major     # bump 1.0.0 -> 2.0.0
npm run release           # build the current version without bumping
```

Flags: `-NoSign` (skip Authenticode), `-SkipBuild` (repackage/upload an existing build),
`-Password` (updater key password).

What it does:

1. Bumps the version in `tauri.conf.json`, `package.json` and `Cargo.toml`
2. Loads the updater key; checks QwickCert auth when signing
3. Runs `tauri build --features updater` with a release-only config
   (`release/vX.Y.Z/tauri.release.conf.json`) that turns on `createUpdaterArtifacts`
   and, when signing, sets `bundle.windows.signCommand` to `qwick sign`.
   Tauri signs `Abe.exe`, the uninstaller and the installer **before** it computes
   the updater signature, so `Abe_X.Y.Z_x64-setup.exe.sig` matches the signed installer.
4. Verifies the Authenticode signatures and the updater `.sig`
5. Writes `latest.json`, merging any macOS entries already on the release
6. Creates or reuses a draft release and uploads `Abe-windows-x64-setup.exe` + `latest.json`

---

## Releasing on macOS

```bash
./scripts/release-macos.sh
```

Interactive menu; press `5` for a full release (build + notarize + upload). It builds
both `aarch64-apple-darwin` and `x86_64-apple-darwin` with `--features updater`,
makes a polished DMG per architecture with `create-dmg`, notarizes and staples them,
then uploads the DMGs, the per-architecture updater tarballs and a merged `latest.json`.

---

## Releasing from CI

`.github/workflows/release.yml` (manual `workflow_dispatch` with the version) builds
the three targets (Windows x64, macOS arm64, macOS x64) in a matrix, then a single publish
job writes `latest.json` from the three updater signatures and uploads everything to a draft release on the same repo.
Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Optional macOS secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
CI Windows installers are not Authenticode-signed.

---

## Third-party notices

`THIRD_PARTY_NOTICES.md` lists the license of every Rust crate compiled into the app and every
production npm package bundled into the UI, with the license texts. Regenerate it whenever
dependencies change, and before every release:

```bash
npm install
npm run notices
```

It needs only Node and cargo (`cargo metadata`). The Whisper models are MIT-licensed, downloaded at
runtime and not bundled, so they get a note rather than an entry.

---

## Publishing

Releases are created as **drafts**. Review the assets, then publish. The updater reads
`releases/latest`, so nothing reaches users until the draft is published.

You can run the Windows and macOS scripts in either order: each downloads the existing
`latest.json` from the release and merges its own platforms into it.

---

## Version files

| File | Field |
|------|-------|
| `src-tauri/tauri.conf.json` | `version` |
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `version` |

Both scripts update all three.

---

## Scripts reference

| Script | Platform | Description |
|--------|----------|-------------|
| `scripts/build-release.ps1` | Windows | Build, sign (QwickCert + updater key), upload |
| `scripts/release.bat` | Windows | Launcher for the above |
| `scripts/release-macos.sh` | macOS | Interactive menu for the macOS release |
| `scripts/generate-keys.ps1` | Any | Generate a Tauri updater keypair |
| `scripts/generate-nsis-images.mjs` | Any | Regenerate branded NSIS installer images |
| `scripts/resize-icons.mjs` | Any | Regenerate app icons |
| `scripts/third-party-notices.mjs` | Any | Regenerate `THIRD_PARTY_NOTICES.md` (`npm run notices`) |
