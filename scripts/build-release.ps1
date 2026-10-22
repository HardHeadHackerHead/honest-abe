# Build Release Script for Abe (Windows)
# Builds the official Windows installer (with the auto-updater enabled), signs
# it, writes latest.json and uploads both to a draft GitHub release.
#
# Requirements:
#   - Tauri updater key: TAURI_SIGNING_PRIVATE_KEY (or keys\tauri-signing-key)
#     and TAURI_SIGNING_PRIVATE_KEY_PASSWORD (or -Password, or the
#     "TauriSigningKey" entry in Windows Credential Manager, or a prompt).
#   - Optional: QwickCert CLI (qwick) for Authenticode signing. Without it, or
#     with -NoSign, the installer is built unsigned.
#   - Optional: GitHub CLI (gh) for the upload step.

param(
    [string]$Password = "",
    [ValidateSet("", "patch", "minor", "major")]
    [string]$Bump = "",
    [switch]$SkipBuild = $false,
    [switch]$NoSign = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Repo = "HardHeadHackerHead/honest-abe"
$InstallerAsset = "Abe-windows-x64-setup.exe"

# Colors for output (matching macOS script style)
function Write-Cyan { param([string]$msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Green { param([string]$msg) Write-Host $msg -ForegroundColor Green }
function Write-Yellow { param([string]$msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Red { param([string]$msg) Write-Host $msg -ForegroundColor Red }

Write-Cyan "=== Abe Release Builder (Windows) ==="
Write-Host ""

# Ensure cargo / rustc are on PATH. `tauri build` shells out to `cargo metadata`
# which fails with "program not found" if PATH wasn't set up by the parent
# shell (cmd.exe doesn't auto-load ~/.cargo/bin the way some PowerShell profiles do).
function Ensure-OnPath {
    param([string]$Dir)
    if (-not (Test-Path $Dir)) { return $false }
    $existing = ($env:Path -split ';') | Where-Object { $_ -ieq $Dir }
    if (-not $existing) {
        $env:Path = "$Dir;$env:Path"
    }
    return $true
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoCandidates = @(
        (Join-Path $env:USERPROFILE ".cargo\bin"),
        "C:\Users\$env:USERNAME\.cargo\bin"
    ) | Select-Object -Unique

    $found = $false
    foreach ($candidate in $cargoCandidates) {
        if (Test-Path (Join-Path $candidate "cargo.exe")) {
            [void](Ensure-OnPath $candidate)
            Write-Yellow "Added $candidate to PATH for this build"
            $found = $true
            break
        }
    }

    if (-not $found) {
        Write-Red "cargo not found. Install Rust from https://rustup.rs/ then retry."
        exit 1
    }
}

# Sanity-check after the PATH fixup
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Red "cargo still not resolvable after PATH fixup -- aborting."
    exit 1
}

# Change to project root
Set-Location $ProjectRoot

# Get version from tauri.conf.json
$TauriConfPath = Join-Path $ProjectRoot "src-tauri\tauri.conf.json"
$tauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json
$Version = $tauriConf.version

# Bump version if requested
if ($Bump -ne "") {
    $parts = $Version.Split(".")
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($Bump) {
        "major" { $major++; $minor = 0; $patch = 0 }
        "minor" { $minor++; $patch = 0 }
        "patch" { $patch++ }
    }

    $NewVersion = "$major.$minor.$patch"
    Write-Cyan "Bumping version: $Version -> $NewVersion"

    # Update tauri.conf.json
    $tauriConfRaw = Get-Content $TauriConfPath -Raw
    $tauriConfRaw = $tauriConfRaw -replace "`"version`": `"$Version`"", "`"version`": `"$NewVersion`""
    [System.IO.File]::WriteAllText($TauriConfPath, $tauriConfRaw, [System.Text.UTF8Encoding]::new($false))

    # Update package.json
    $PackageJsonPath = Join-Path $ProjectRoot "package.json"
    $pkgRaw = Get-Content $PackageJsonPath -Raw
    $pkgRaw = $pkgRaw -replace "`"version`": `"$Version`"", "`"version`": `"$NewVersion`""
    [System.IO.File]::WriteAllText($PackageJsonPath, $pkgRaw, [System.Text.UTF8Encoding]::new($false))

    # Update Cargo.toml
    $CargoTomlPath = Join-Path $ProjectRoot "src-tauri\Cargo.toml"
    $cargoRaw = Get-Content $CargoTomlPath -Raw
    $cargoRaw = $cargoRaw -replace "version = `"$Version`"", "version = `"$NewVersion`""
    [System.IO.File]::WriteAllText($CargoTomlPath, $cargoRaw, [System.Text.UTF8Encoding]::new($false))

    $Version = $NewVersion
    Write-Green "Version bumped to $Version"
}

Write-Cyan "Building version: $Version"

# Create release directory
$ReleaseDir = Join-Path $ProjectRoot "release\v$Version"
if (Test-Path $ReleaseDir) {
    Remove-Item $ReleaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
Write-Green "Created release directory: $ReleaseDir"

# Load the updater signing key. Official releases must ship updater artifacts,
# so a missing key is fatal.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $PrivateKeyPath = Join-Path $ProjectRoot "keys\tauri-signing-key"
    if (-not (Test-Path $PrivateKeyPath)) {
        Write-Red "No updater signing key. Set TAURI_SIGNING_PRIVATE_KEY or create $PrivateKeyPath."
        exit 1
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $PrivateKeyPath -Raw).Trim()
}

if ($Password -eq "" -and $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $Password = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
}

# Try to get password from Windows Credential Manager (like macOS Keychain)
if ($Password -eq "") {
    # Define the native Windows Credential API
    $sig = @"
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

[DllImport("advapi32.dll", SetLastError = true)]
public static extern bool CredFree(IntPtr cred);

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
}
"@
    try {
        Add-Type -MemberDefinition $sig -Namespace "CredManager" -Name "Api" -ErrorAction SilentlyContinue
    } catch { }

    try {
        $credPtr = [IntPtr]::Zero
        # Type 1 = CRED_TYPE_GENERIC
        if ([CredManager.Api]::CredRead("TauriSigningKey", 1, 0, [ref]$credPtr)) {
            $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [Type][CredManager.Api+CREDENTIAL])
            if ($cred.CredentialBlobSize -gt 0) {
                $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
                Write-Green "Password retrieved from Windows Credential Manager"
            }
            [CredManager.Api]::CredFree($credPtr) | Out-Null
        }
    } catch {
        # Credential Manager retrieval failed, will prompt
    }
}

# If still no password, prompt the user
if ($Password -eq "") {
    Write-Cyan "Password not found in Credential Manager."
    Write-Host "  To store it for future builds, run:"
    Write-Host "  cmdkey /generic:TauriSigningKey /user:tauri /pass:YOUR_PASSWORD"
    Write-Host ""
    $SecurePassword = Read-Host "Enter signing key password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
}

$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password
Write-Green "Updater signing key loaded"

# Authenticode signing with QwickCert is optional: it runs only when qwick is
# installed and -NoSign wasn't passed.
$Sign = $false
if ($NoSign) {
    Write-Yellow "-NoSign: building an unsigned installer"
} elseif (-not (Get-Command qwick -ErrorAction SilentlyContinue)) {
    Write-Yellow "QwickCert CLI (qwick) not found: building an unsigned installer"
} else {
    $Sign = $true
}

if ($Sign) {
    # Check QwickCert auth - pause and let user log in if expired
    # QwickCert writes progress to stderr, so temporarily relax error handling
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    qwick auth whoami 2>$null | Out-Null
    $authExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($authExit -ne 0) {
        Write-Host ""
        Write-Yellow "QwickCert session expired or not logged in."
        Write-Yellow "Please log in now. Run this in another terminal:"
        Write-Host ""
        Write-Host "  qwick auth login" -ForegroundColor White
        Write-Host ""
        Read-Host "Press Enter after logging in to continue"

        $ErrorActionPreference = "Continue"
        qwick auth whoami 2>$null | Out-Null
        $authExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP

        if ($authExit -ne 0) {
            Write-Red "ERROR: Still not authenticated. Aborting."
            exit 1
        }
    }
    Write-Green "QwickCert authenticated"
}

# Release-only config, merged over tauri.conf.json via --config:
#   - createUpdaterArtifacts: the NSIS installer doubles as the updater bundle
#     and gets a .sig next to it.
#   - signCommand: Tauri Authenticode-signs Abe.exe, the uninstaller and the
#     installer itself BEFORE it computes the updater signature, so the .sig
#     matches the signed installer.
$releaseConf = @{
    bundle = @{
        targets = @("nsis")
        createUpdaterArtifacts = $true
    }
}
if ($Sign) {
    $releaseConf.bundle.windows = @{
        # Through cmd /c: qwick is usually an npm shim (qwick.cmd), which Tauri can't launch directly.
        signCommand = @{ cmd = "cmd"; args = @("/c", "qwick", "sign", "--verify", "%1") }
    }
}
$ReleaseConfPath = Join-Path $ReleaseDir "tauri.release.conf.json"
[System.IO.File]::WriteAllText($ReleaseConfPath, ($releaseConf | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))

$BundleDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis"
$installerPath = Join-Path $BundleDir "Abe_${Version}_x64-setup.exe"
$sigPath = "$installerPath.sig"

if (-not $SkipBuild) {
    Write-Cyan "Installing npm dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Red "ERROR: npm install failed"
        exit 1
    }

    # Clean stale bundle output so we never pick up an old artifact
    Remove-Item "$BundleDir\*" -Force -ErrorAction SilentlyContinue

    Write-Cyan "Building Abe with the updater enabled..."
    npx tauri build --features updater --config $ReleaseConfPath
    if ($LASTEXITCODE -ne 0) {
        Write-Red "ERROR: Build/bundle step failed!"
        exit 1
    }
}

if (-not (Test-Path $installerPath)) {
    Write-Red "ERROR: Installer not found: $installerPath"
    exit 1
}
Write-Cyan "Found installer: $installerPath"

if ($Sign) {
    # Tauri signs the copy of Abe.exe it packages, not target\release\Abe.exe, so check
    # the installer and (when 7-Zip is available) the Abe.exe inside it.
    $toCheck = @($installerPath)
    $sevenZip = "C:\Program Files\7-Zip\7z.exe"
    if (Test-Path $sevenZip) {
        $extractDir = Join-Path $ReleaseDir "_verify"
        & $sevenZip x $installerPath "-o$extractDir" -y | Out-Null
        $toCheck += Get-ChildItem $extractDir -Recurse -Filter "Abe.exe" | Select-Object -ExpandProperty FullName
    } else {
        Write-Yellow "7-Zip not found: verifying the installer signature only"
    }
    foreach ($binary in $toCheck) {
        $authSig = Get-AuthenticodeSignature $binary
        if ($authSig.Status -ne "Valid") {
            Write-Red "ERROR: $binary signature is $($authSig.Status)"
            Write-Yellow "Status message: $($authSig.StatusMessage). Run 'qwick doctor' to diagnose."
            exit 1
        }
    }
    if ($extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Green "Authenticode signatures verified (installer and packaged Abe.exe)"
}

# Verify updater signature file exists (required for auto-updates)
if (-not (Test-Path $sigPath)) {
    Write-Red "ERROR: No updater signature found at $sigPath"
    Write-Yellow "TAURI_SIGNING_PRIVATE_KEY was not picked up during the build."
    exit 1
}
$signature = (Get-Content $sigPath -Raw).Trim()
if ($signature -eq "") {
    Write-Red "ERROR: Updater signature is empty!"
    exit 1
}
Write-Green "Updater signature found"

# Copy the installer under its version-less asset name. The website links to
# releases/latest/download/<asset>, so the name must stay stable.
Copy-Item $installerPath (Join-Path $ReleaseDir $InstallerAsset)
Write-Green "Copied installer: $InstallerAsset"

$tag = "v$Version"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$platforms = @{
    "windows-x86_64" = @{
        signature = $signature
        url = "https://github.com/$Repo/releases/download/$tag/$InstallerAsset"
    }
}

# Merge the other platforms from an existing latest.json on this release
# (the macOS/Linux builds may have uploaded theirs first).
$ghExists = Get-Command gh -ErrorAction SilentlyContinue
if ($ghExists) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $existingRaw = gh release download $tag --repo $Repo --pattern "latest.json" --output - 2>$null
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -eq 0 -and $existingRaw) {
        try {
            $existingJson = ($existingRaw -join "`n") | ConvertFrom-Json
            foreach ($platform in $existingJson.platforms.PSObject.Properties) {
                if ($platform.Name -ne "windows-x86_64") {
                    $platforms[$platform.Name] = $platform.Value
                }
            }
            Write-Green "Merged platforms from the existing latest.json"
        } catch {
            Write-Yellow "Existing latest.json is not valid JSON, replacing it"
        }
    } else {
        Write-Yellow "No existing latest.json on $tag - it will only list Windows"
    }
}

$latestJson = @{
    version = $Version
    notes = "Abe v$Version"
    pub_date = $pubDate
    platforms = $platforms
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$ReleaseDir\latest.json", $latestJson, [System.Text.UTF8Encoding]::new($false))
Write-Green "Created latest.json"

Write-Host ""
Write-Green "=== Release package ready! ==="
Write-Host ""
Write-Cyan "Files in ${ReleaseDir}:"
Get-ChildItem $ReleaseDir | ForEach-Object {
    Write-Host "  $($_.Name)"
}

# Upload to GitHub using gh CLI
Write-Host ""
if (-not $ghExists) {
    Write-Yellow "GitHub CLI (gh) not installed. Install from: https://cli.github.com/"
    Write-Yellow "Skipping automatic upload."
} else {
    Write-Cyan "Uploading to GitHub..."

    # Check if release exists, create if not
    # gh writes to stderr on "not found" - relax error handling
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    gh release view $tag --repo $Repo 2>$null | Out-Null
    $ghViewExit = $LASTEXITCODE

    if ($ghViewExit -ne 0) {
        Write-Cyan "Creating draft release $tag..."
        gh release create $tag --repo $Repo --title "Abe $tag" --notes "Abe $tag" --draft
        if ($LASTEXITCODE -ne 0) {
            Write-Yellow "Failed to create release. You may need to run: gh auth login"
        }
    } else {
        Write-Green "Release $tag already exists"
    }

    Write-Cyan "Uploading $InstallerAsset..."
    gh release upload $tag "$ReleaseDir\$InstallerAsset" --repo $Repo --clobber
    $ghInstallerExit = $LASTEXITCODE

    Write-Cyan "Uploading latest.json..."
    gh release upload $tag "$ReleaseDir\latest.json" --repo $Repo --clobber
    $ghUploadExit = $LASTEXITCODE

    $ErrorActionPreference = $prevEAP

    if ($ghInstallerExit -eq 0 -and $ghUploadExit -eq 0) {
        Write-Green "Upload complete!"
        Write-Host ""
        Write-Cyan "Release URL:"
        Write-Host "  https://github.com/$Repo/releases/tag/$tag"
    } else {
        Write-Yellow "Some uploads may have failed. Check GitHub manually."
    }
}

Write-Host ""
Write-Cyan "Next steps:"
Write-Host "  1. Review and publish the release on GitHub"
Write-Host ""

# Open release folder
explorer $ReleaseDir
