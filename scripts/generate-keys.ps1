# Generate Tauri Updater Keys
# Run this ONCE to create your signing keypair

$ErrorActionPreference = "Stop"

Write-Host "=== Tauri Updater Key Generator ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will generate a keypair for signing your app updates." -ForegroundColor Yellow
Write-Host "You will be prompted for a password to protect the private key." -ForegroundColor Yellow
Write-Host ""

# Create keys directory if it doesn't exist
$keysDir = "keys"
if (-not (Test-Path $keysDir)) {
    New-Item -ItemType Directory -Path $keysDir -Force | Out-Null
}

try {
    # Generate keys - write to keys folder
    npx @tauri-apps/cli signer generate -w "$keysDir/tauri-signing-key"

    Write-Host ""
    Write-Host "=== Keys Generated! ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Keys saved to: $keysDir/" -ForegroundColor Yellow
    Write-Host "  - tauri-signing-key (PRIVATE - keep secret!)" -ForegroundColor White
    Write-Host "  - tauri-signing-key.pub (PUBLIC - put in tauri.conf.json)" -ForegroundColor White
    Write-Host ""

    # Read and display the public key
    $pubKeyPath = "$keysDir/tauri-signing-key.pub"
    if (Test-Path $pubKeyPath) {
        $pubKey = Get-Content $pubKeyPath -Raw
        Write-Host "Your PUBLIC KEY:" -ForegroundColor Cyan
        Write-Host $pubKey -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Open src-tauri\tauri.conf.json" -ForegroundColor White
    Write-Host "2. Set plugins.updater.pubkey to the public key above" -ForegroundColor White
    Write-Host "3. Before building releases, set environment variables:" -ForegroundColor White
    Write-Host '   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "keys/tauri-signing-key" -Raw' -ForegroundColor Gray
    Write-Host '   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your password"' -ForegroundColor Gray
    Write-Host ""
    Write-Host "For GitHub Actions:" -ForegroundColor Cyan
    Write-Host "1. Go to your repo Settings > Secrets and variables > Actions" -ForegroundColor White
    Write-Host "2. Add secret: TAURI_SIGNING_PRIVATE_KEY (contents of keys/tauri-signing-key)" -ForegroundColor White
    Write-Host "3. Add secret: TAURI_SIGNING_PRIVATE_KEY_PASSWORD (your password)" -ForegroundColor White
    Write-Host ""
    Write-Host "IMPORTANT: Add 'keys/' to your .gitignore!" -ForegroundColor Red
}
catch {
    Write-Host "Error generating keys: $_" -ForegroundColor Red
    exit 1
}
