#!/bin/bash
# macOS Release Script for Abe
# Interactive menu for building, signing, and publishing

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$PROJECT_DIR/keys"
RELEASE_REPO="HardHeadHackerHead/honest-abe"
KEYCHAIN_SERVICE="abe-tauri-signing"
NOTARIZE_PROFILE="AbeNotarize"
APPLE_KEYCHAIN_SERVICE="abe-apple-notarize"

# Official macOS builds ship one app per architecture.
ARCHES=("aarch64" "x86_64")

# Release-only Tauri config merged over tauri.conf.json: only the .app bundle
# (the DMG is made by create-dmg below) plus the signed updater tarball.
RELEASE_CONF='{"bundle":{"targets":["app"],"createUpdaterArtifacts":true}}'

triple() { echo "$1-apple-darwin"; }
# Local Whisper uses Metal on Apple silicon (the shader library is embedded,
# so no extra entitlements). Intel Macs build CPU-only.
features() { if [ "$1" = "aarch64" ]; then echo "updater,metal"; else echo "updater"; fi; }
asset_arch() { if [ "$1" = "aarch64" ]; then echo "arm64"; else echo "x64"; fi; }
bundle_dir() { echo "$PROJECT_DIR/src-tauri/target/$(triple "$1")/release/bundle"; }
app_path() { echo "$(bundle_dir "$1")/macos/Abe.app"; }
updater_path() { echo "$(bundle_dir "$1")/macos/Abe.app.tar.gz"; }
dmg_path() { echo "$(bundle_dir "$1")/dmg/Abe-macos-$(asset_arch "$1").dmg"; }

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

cd "$PROJECT_DIR"

# Get version
VERSION=$(grep -o '"version": "[^"]*' "$PROJECT_DIR/src-tauri/tauri.conf.json" | head -1 | cut -d'"' -f4)

# Get password from Keychain
load_password() {
    PASSWORD=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "tauri" -w 2>/dev/null) || true
    if [ -n "$PASSWORD" ]; then
        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PASSWORD"
        export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEYS_DIR/tauri-signing-key")"
        return 0
    fi
    return 1
}

load_apple_credentials() {
    local APPLE_ID_VAL=$(security find-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-id" -w 2>/dev/null) || true
    local APPLE_PW_VAL=$(security find-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-password" -w 2>/dev/null) || true
    local APPLE_TEAM_VAL=$(security find-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "team-id" -w 2>/dev/null) || true

    if [ -n "$APPLE_ID_VAL" ] && [ -n "$APPLE_PW_VAL" ] && [ -n "$APPLE_TEAM_VAL" ]; then
        export APPLE_ID="$APPLE_ID_VAL"
        export APPLE_PASSWORD="$APPLE_PW_VAL"
        export APPLE_TEAM_ID="$APPLE_TEAM_VAL"
        return 0
    fi
    return 1
}

# Tauri signs the .app with $APPLE_SIGNING_IDENTITY. If it isn't set, use the
# first Developer ID Application certificate in the keychain.
load_signing_identity() {
    if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
        APPLE_SIGNING_IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
    fi
    if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
        export APPLE_SIGNING_IDENTITY
        return 0
    fi
    return 1
}

save_apple_credentials() {
    echo -e "${CYAN}Set up Apple notarization credentials${NC}"
    echo -e "${YELLOW}These get stored in Keychain and loaded automatically during builds.${NC}"
    echo ""

    echo -n "Apple ID email: "
    read APPLE_ID_INPUT

    echo -n "Apple Team ID: "
    read APPLE_TEAM_INPUT

    echo -e "App-specific password (from appleid.apple.com):"
    read -s APPLE_PW_INPUT
    echo

    if [ -z "$APPLE_ID_INPUT" ] || [ -z "$APPLE_TEAM_INPUT" ] || [ -z "$APPLE_PW_INPUT" ]; then
        echo -e "${RED}Apple ID, Team ID and password are all required.${NC}"
        return 1
    fi

    security delete-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-id" 2>/dev/null || true
    security add-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-id" -w "$APPLE_ID_INPUT"

    security delete-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "team-id" 2>/dev/null || true
    security add-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "team-id" -w "$APPLE_TEAM_INPUT"

    security delete-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-password" 2>/dev/null || true
    security add-generic-password -s "$APPLE_KEYCHAIN_SERVICE" -a "apple-password" -w "$APPLE_PW_INPUT"

    export APPLE_ID="$APPLE_ID_INPUT"
    export APPLE_PASSWORD="$APPLE_PW_INPUT"
    export APPLE_TEAM_ID="$APPLE_TEAM_INPUT"

    # Also create/update the notarytool keychain profile (used by manual notarize + status check)
    echo -e "${CYAN}Updating notarytool keychain profile...${NC}"
    xcrun notarytool store-credentials "$NOTARIZE_PROFILE" \
        --apple-id "$APPLE_ID_INPUT" \
        --team-id "$APPLE_TEAM_INPUT" \
        --password "$APPLE_PW_INPUT" 2>&1

    echo -e "${GREEN}✓ Apple credentials saved to Keychain + notarytool profile!${NC}"
}

save_password() {
    echo -e "${CYAN}Enter your signing key password:${NC}"
    read -s PASSWORD
    echo

    local PASS_LEN=${#PASSWORD}

    if [ "$PASS_LEN" -eq 0 ]; then
        echo -e "${RED}Password cannot be empty.${NC}"
        return 1
    fi

    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "tauri" 2>/dev/null || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "tauri" -w "$PASSWORD"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PASSWORD"
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEYS_DIR/tauri-signing-key")"
    echo -e "${GREEN}Password saved to Keychain! (${PASS_LEN} characters)${NC}"
}

show_menu() {
    clear
    echo -e "${BOLD}${CYAN}"
    echo "╔═══════════════════════════════════════════╗"
    echo "║         Abe macOS Release Tool            ║"
    echo "║              Version $VERSION                 ║"
    echo "╚═══════════════════════════════════════════╝"
    echo -e "${NC}"

    # Status checks
    echo -e "${BOLD}Status:${NC}"

    # Apple Developer ID status
    if security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
        echo -e "  Apple Cert:  ${GREEN}✓ Developer ID installed${NC}"
    else
        echo -e "  Apple Cert:  ${RED}✗ No Developer ID certificate${NC}"
    fi

    # Apple notarization credentials status
    if load_apple_credentials 2>/dev/null; then
        echo -e "  Notarize:    ${GREEN}✓ Apple credentials ready${NC}"
    else
        echo -e "  Notarize:    ${YELLOW}○ Not configured (run 'a' to set up)${NC}"
    fi

    # Tauri signing key status
    if load_password 2>/dev/null; then
        echo -e "  Signing Key: ${GREEN}✓ Ready${NC}"
    else
        echo -e "  Signing Key: ${YELLOW}○ Not configured${NC}"
    fi

    # Build status
    for ARCH in "${ARCHES[@]}"; do
        if [ -f "$(updater_path "$ARCH")" ]; then
            echo -e "  Build $(asset_arch "$ARCH"):   ${GREEN}✓ Available${NC}"
        else
            echo -e "  Build $(asset_arch "$ARCH"):   ${YELLOW}○ Not built${NC}"
        fi
    done

    # gh auth status
    if gh auth status &>/dev/null; then
        echo -e "  GitHub CLI:  ${GREEN}✓ Authenticated${NC}"

        # Draft release status (only check if authenticated)
        DRAFT_STATUS=$(gh release view "v$VERSION" --repo "$RELEASE_REPO" --json isDraft -q '.isDraft' 2>/dev/null) || DRAFT_STATUS=""
        if [ "$DRAFT_STATUS" = "true" ]; then
            echo -e "  Draft v$VERSION: ${GREEN}✓ Ready${NC}"
        elif [ "$DRAFT_STATUS" = "false" ]; then
            echo -e "  Draft v$VERSION: ${CYAN}● Published${NC}"
        else
            echo -e "  Draft v$VERSION: ${YELLOW}○ Not created${NC}"
        fi
    else
        echo -e "  GitHub CLI:  ${YELLOW}○ Not logged in${NC}"
    fi

    echo ""
    echo -e "${BOLD}Actions:${NC}"
    echo ""
    echo "  1) Build app (arm64 + x64: compile + sign + polished DMGs)"
    echo "  2) Rebuild polished DMGs only"
    echo "  3) Notarize DMGs (Apple)"
    echo "  4) Upload to GitHub release"
    echo "  5) Full release (Build + Notarize + Upload)"
    echo ""
    echo "  d) Check/create draft release"
    echo "  s) Check notarization status"
    echo "  a) Set/update Apple notarization credentials"
    echo "  k) Verify signing key setup"
    echo "  p) Set/update Tauri signing password"
    echo "  g) Login to GitHub CLI"
    echo "  v) Change version number"
    echo "  o) Open build folder"
    echo ""
    echo "  q) Quit"
    echo ""
    echo -e "${CYAN}Choose an option:${NC} "
}

do_build() {
    echo -e "${CYAN}Building Tauri app...${NC}"

    if ! load_password; then
        save_password
    fi

    if load_signing_identity; then
        echo -e "${GREEN}✓ Signing as: $APPLE_SIGNING_IDENTITY${NC}"
    else
        echo -e "${YELLOW}No Developer ID certificate found (set APPLE_SIGNING_IDENTITY). The app will be unsigned.${NC}"
    fi

    # Load Apple credentials for automatic notarization during build
    if load_apple_credentials; then
        echo -e "${GREEN}✓ Apple notarization credentials loaded${NC}"
    else
        echo -e "${YELLOW}Apple credentials not found. Tauri will skip notarization.${NC}"
        echo -n "Set up Apple credentials now? (y/n) "
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            save_apple_credentials
        else
            echo -e "${YELLOW}Continuing without notarization...${NC}"
        fi
    fi

    npm install

    for ARCH in "${ARCHES[@]}"; do
        local TRIPLE=$(triple "$ARCH")
        rustup target add "$TRIPLE" >/dev/null 2>&1 || true

        echo -e "${CYAN}Building $TRIPLE...${NC}"
        npx tauri build --target "$TRIPLE" --features "$(features "$ARCH")" --config "$RELEASE_CONF"

        local APP_PATH=$(app_path "$ARCH")
        if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
            echo -e "${CYAN}Verifying Developer ID signature...${NC}"
            if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
                echo -e "${GREEN}✓ $(asset_arch "$ARCH") app signed with Developer ID${NC}"
                codesign -dvv "$APP_PATH" 2>&1 | grep "Authority="
            else
                echo -e "${RED}✗ Signature verification failed for $APP_PATH${NC}"
                return 1
            fi
        fi
    done

    echo -e "${GREEN}Build complete!${NC}"

    # Always create polished DMGs after build
    do_dmg
}

do_dmg() {
    for ARCH in "${ARCHES[@]}"; do
        local APP_PATH=$(app_path "$ARCH")
        local DMG_PATH=$(dmg_path "$ARCH")

        if [ ! -d "$APP_PATH" ]; then
            echo -e "${RED}$APP_PATH not built yet. Run build first.${NC}"
            read -p "Press Enter to continue..."
            return
        fi

        echo -e "${CYAN}Creating polished DMG for $(asset_arch "$ARCH")...${NC}"

        mkdir -p "$(dirname "$DMG_PATH")"
        rm -f "$DMG_PATH"

        # The bundled icon is named after the product (e.g. Abe.icns), not icon.icns
        local VOLICON=$(ls "$APP_PATH/Contents/Resources/"*.icns 2>/dev/null | head -1)

        create-dmg \
          --volname "Abe" \
          ${VOLICON:+--volicon "$VOLICON"} \
          --background "$PROJECT_DIR/src-tauri/dmg-resources/background.png" \
          --window-pos 200 120 \
          --window-size 500 350 \
          --icon-size 80 \
          --icon "Abe.app" 115 160 \
          --app-drop-link 355 155 \
          --hide-extension "Abe.app" \
          --text-size 11 \
          "$DMG_PATH" \
          "$APP_PATH" || true

        if [ ! -f "$DMG_PATH" ]; then
            echo -e "${RED}DMG was not created at $DMG_PATH${NC}"
            read -p "Press Enter to continue..."
            return
        fi

        # Re-sign the polished DMG with Developer ID (create-dmg produces unsigned)
        if load_signing_identity; then
            echo -e "${CYAN}Signing DMG with Developer ID...${NC}"
            codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"
            echo -e "${GREEN}✓ DMG signed${NC}"
        else
            echo -e "${YELLOW}Warning: No Developer ID certificate found, DMG is unsigned${NC}"
        fi

        echo -e "${GREEN}DMG created: $DMG_PATH${NC}"
    done
}

do_notarize() {
    for ARCH in "${ARCHES[@]}"; do
        local DMG_PATH=$(dmg_path "$ARCH")

        if [ ! -f "$DMG_PATH" ]; then
            echo -e "${RED}$DMG_PATH not found. Run build first.${NC}"
            read -p "Press Enter to continue..."
            return
        fi

        # Create a named copy so submissions are identifiable in Apple's history
        local TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
        local SUBMIT_NAME="Abe_v${VERSION}_${TIMESTAMP}_$(asset_arch "$ARCH").dmg"
        local SUBMIT_PATH="$(dirname "$DMG_PATH")/$SUBMIT_NAME"
        cp "$DMG_PATH" "$SUBMIT_PATH"

        echo -e "${CYAN}Submitting as: ${BOLD}$SUBMIT_NAME${NC}"
        echo -e "${YELLOW}This may take 2-10 minutes. Please wait.${NC}"
        echo ""

        if xcrun notarytool submit "$SUBMIT_PATH" \
            --keychain-profile "$NOTARIZE_PROFILE" \
            --wait; then

            rm -f "$SUBMIT_PATH"

            echo ""
            echo -e "${GREEN}✓ Notarization successful!${NC}"

            echo -e "${CYAN}Stapling notarization ticket...${NC}"
            if xcrun stapler staple "$DMG_PATH"; then
                echo -e "${GREEN}✓ Stapled successfully!${NC}"
            else
                echo -e "${RED}✗ Stapling failed (app is still notarized, just not stapled)${NC}"
            fi

            local APP_PATH=$(app_path "$ARCH")
            if [ -d "$APP_PATH" ]; then
                echo -e "${CYAN}Stapling .app bundle...${NC}"
                xcrun stapler staple "$APP_PATH" 2>/dev/null || true
            fi
        else
            rm -f "$SUBMIT_PATH"

            echo ""
            echo -e "${RED}✗ Notarization failed!${NC}"
            echo -e "${YELLOW}Check the log with:${NC}"
            echo "  xcrun notarytool log <submission-id> --keychain-profile $NOTARIZE_PROFILE"
            return 1
        fi
    done
}

do_publish() {
    local STAGE_DIR="$PROJECT_DIR/release/v$VERSION-macos"
    local LATEST_JSON="$STAGE_DIR/latest.json"
    local PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local UPLOAD_FILES=()
    local PLATFORMS_JSON="{}"

    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR"

    # Stage version-less asset names (the website links to releases/latest/download/<asset>)
    for ARCH in "${ARCHES[@]}"; do
        local A=$(asset_arch "$ARCH")
        local UPDATE_BUNDLE=$(updater_path "$ARCH")
        local UPDATE_SIG="$UPDATE_BUNDLE.sig"
        local DMG_PATH=$(dmg_path "$ARCH")

        if [ ! -f "$UPDATE_BUNDLE" ] || [ ! -f "$UPDATE_SIG" ]; then
            echo -e "${RED}Updater bundle or signature missing for $A. Run build first.${NC}"
            read -p "Press Enter to continue..."
            return
        fi

        cp "$UPDATE_BUNDLE" "$STAGE_DIR/Abe-macos-$A.app.tar.gz"
        UPLOAD_FILES+=("$STAGE_DIR/Abe-macos-$A.app.tar.gz")
        if [ -f "$DMG_PATH" ]; then
            cp "$DMG_PATH" "$STAGE_DIR/Abe-macos-$A.dmg"
            UPLOAD_FILES+=("$STAGE_DIR/Abe-macos-$A.dmg")
        else
            echo -e "  ${YELLOW}DMG for $A not found (skipping - run option 2 to create it)${NC}"
        fi

        PLATFORMS_JSON=$(python3 -c "
import json, sys
p = json.loads(sys.argv[1])
p['darwin-$ARCH'] = {
    'signature': open(sys.argv[2]).read().strip(),
    'url': 'https://github.com/$RELEASE_REPO/releases/download/v$VERSION/Abe-macos-$A.app.tar.gz',
}
print(json.dumps(p))
" "$PLATFORMS_JSON" "$UPDATE_SIG")
    done

    if ! gh auth status &>/dev/null; then
        echo -e "${RED}Not logged into GitHub. Run 'g' to login first.${NC}"
        read -p "Press Enter to continue..."
        return
    fi

    # Merge with an existing latest.json to preserve the Windows/Linux entries
    local EXISTING_JSON=""
    if gh release view "v$VERSION" --repo "$RELEASE_REPO" &>/dev/null; then
        echo -e "${CYAN}Checking for existing latest.json to merge...${NC}"
        EXISTING_JSON=$(gh release download "v$VERSION" --repo "$RELEASE_REPO" --pattern "latest.json" --output - 2>/dev/null) || EXISTING_JSON=""
    fi

    python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
except ValueError:
    data = {'platforms': {}}
data['version'] = '$VERSION'
data['notes'] = 'Abe v$VERSION'
data['pub_date'] = '$PUB_DATE'
data.setdefault('platforms', {}).update(json.loads(sys.argv[2]))
json.dump(data, open('$LATEST_JSON', 'w'), indent=2)
print('  Platforms in latest.json:')
for p in data['platforms']:
    print(f'    - {p}')
" "$EXISTING_JSON" "$PLATFORMS_JSON"
    UPLOAD_FILES+=("$LATEST_JSON")

    echo -e "${CYAN}Publishing v$VERSION to GitHub...${NC}"
    echo ""
    echo "Files to upload:"
    for F in "${UPLOAD_FILES[@]}"; do
        echo "  - $(basename "$F")"
    done
    echo ""

    # Auto-create draft release if it doesn't exist
    if ! gh release view "v$VERSION" --repo "$RELEASE_REPO" &>/dev/null; then
        echo -e "${YELLOW}No release found for v$VERSION. Creating draft...${NC}"
        gh release create "v$VERSION" \
            --repo "$RELEASE_REPO" \
            --title "Abe v$VERSION" \
            --notes "Abe v$VERSION" \
            --draft
        echo -e "${GREEN}✓ Draft release created${NC}"
        echo ""
    fi

    # Check if it's a draft
    DRAFT_STATUS=$(gh release view "v$VERSION" --repo "$RELEASE_REPO" --json isDraft -q '.isDraft' 2>/dev/null) || DRAFT_STATUS=""
    if [ "$DRAFT_STATUS" = "true" ]; then
        echo -e "${CYAN}Uploading to draft release v$VERSION...${NC}"
    else
        echo -e "${CYAN}Uploading to release v$VERSION...${NC}"
    fi

    gh release upload "v$VERSION" \
        "${UPLOAD_FILES[@]}" \
        --repo "$RELEASE_REPO" \
        --clobber

    echo ""
    echo -e "${GREEN}=== Upload complete! ===${NC}"
    echo "https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"

    if [ "$DRAFT_STATUS" = "true" ]; then
        echo ""
        echo -e "${YELLOW}Release is a draft. Publish on GitHub when ready.${NC}"
    fi
}

change_version() {
    echo -e "${CYAN}Current version: $VERSION${NC}"
    echo -n "Enter new version: "
    read NEW_VERSION

    if [ -z "$NEW_VERSION" ]; then
        echo "Cancelled."
        return
    fi

    update_version_in_files "$NEW_VERSION"
}

update_version_in_files() {
    local NEW_VERSION="$1"

    # Update all version files
    sed -i '' "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PROJECT_DIR/src-tauri/tauri.conf.json"
    sed -i '' "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PROJECT_DIR/package.json"
    sed -i '' "s/^version = \"$VERSION\"/version = \"$NEW_VERSION\"/" "$PROJECT_DIR/src-tauri/Cargo.toml"

    VERSION="$NEW_VERSION"
    echo -e "${GREEN}Version updated to $NEW_VERSION${NC}"
}

bump_version() {
    # Parse current version (assumes semver: major.minor.patch)
    local MAJOR=$(echo "$VERSION" | cut -d. -f1)
    local MINOR=$(echo "$VERSION" | cut -d. -f2)
    local PATCH=$(echo "$VERSION" | cut -d. -f3)

    # Bump patch version
    PATCH=$((PATCH + 1))

    echo "${MAJOR}.${MINOR}.${PATCH}"
}

check_or_create_draft() {
    if ! gh auth status &>/dev/null; then
        echo -e "${RED}Not logged into GitHub. Run 'g' to login first.${NC}"
        read -p "Press Enter to continue..."
        return
    fi

    echo -e "${CYAN}Checking for draft release v$VERSION...${NC}"

    # Check if a draft release exists for current version
    DRAFT_EXISTS=$(gh release view "v$VERSION" --repo "$RELEASE_REPO" --json isDraft -q '.isDraft' 2>/dev/null) || DRAFT_EXISTS=""

    if [ "$DRAFT_EXISTS" = "true" ]; then
        echo -e "${GREEN}✓ Draft release v$VERSION found!${NC}"
        echo ""
        echo "Draft URL: https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"
        read -p "Press Enter to continue..."
        return
    fi

    # Check if a published release exists for current version
    RELEASE_EXISTS=$(gh release view "v$VERSION" --repo "$RELEASE_REPO" 2>/dev/null) || RELEASE_EXISTS=""

    if [ -n "$RELEASE_EXISTS" ]; then
        echo -e "${YELLOW}Release v$VERSION already exists (published, not draft).${NC}"
        echo ""
        echo -n "Bump version and create new draft? (y/n) "
        read -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Cancelled."
            read -p "Press Enter to continue..."
            return
        fi
    else
        echo -e "${YELLOW}No release found for v$VERSION.${NC}"
        echo ""
        echo -n "Create draft release for v$VERSION? (y/n) "
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Create draft for current version
            create_draft_release "$VERSION"
            read -p "Press Enter to continue..."
            return
        fi

        echo -n "Bump version and create new draft? (y/n) "
        read -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Cancelled."
            read -p "Press Enter to continue..."
            return
        fi
    fi

    # Bump version
    NEW_VERSION=$(bump_version)
    echo -e "${CYAN}Bumping version: $VERSION → $NEW_VERSION${NC}"
    update_version_in_files "$NEW_VERSION"

    # Create draft release
    create_draft_release "$VERSION"

    read -p "Press Enter to continue..."
}

verify_signing_setup() {
    echo -e "${CYAN}Verifying signing key setup...${NC}"
    echo ""

    local ALL_OK=true
    local CAN_TEST_SIGN=true

    # Check if key file exists
    if [ -f "$KEYS_DIR/tauri-signing-key" ]; then
        echo -e "  Key file:     ${GREEN}✓ Found${NC} ($KEYS_DIR/tauri-signing-key)"
    else
        echo -e "  Key file:     ${RED}✗ Not found${NC} ($KEYS_DIR/tauri-signing-key)"
        ALL_OK=false
        CAN_TEST_SIGN=false
    fi

    # Check if public key exists
    if [ -f "$KEYS_DIR/tauri-signing-key.pub" ]; then
        echo -e "  Public key:   ${GREEN}✓ Found${NC}"
    else
        echo -e "  Public key:   ${YELLOW}○ Not found${NC} (optional)"
    fi

    # Check if password is in Keychain
    PASSWORD=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "tauri" -w 2>/dev/null) || PASSWORD=""
    if [ -n "$PASSWORD" ]; then
        echo -e "  Keychain:     ${GREEN}✓ Password stored${NC}"
    else
        echo -e "  Keychain:     ${RED}✗ No password${NC} (run 'p' to set)"
        ALL_OK=false
        CAN_TEST_SIGN=false
    fi

    # Try to verify key format (should start with dW5 for base64 encoded key)
    if [ -f "$KEYS_DIR/tauri-signing-key" ]; then
        KEY_CONTENT=$(cat "$KEYS_DIR/tauri-signing-key" | head -c 3)
        if [ "$KEY_CONTENT" = "dW5" ]; then
            echo -e "  Key format:   ${GREEN}✓ Valid Tauri key${NC}"
        else
            echo -e "  Key format:   ${YELLOW}? Unknown format${NC}"
        fi
    fi

    # Test signing with the key and password
    if [ "$CAN_TEST_SIGN" = true ]; then
        echo -e "  Password:     ${YELLOW}Testing...${NC}"

        # Create a temp file to sign
        TEMP_FILE=$(mktemp)
        echo "test" > "$TEMP_FILE"

        # Load the private key
        PRIVATE_KEY="$(cat "$KEYS_DIR/tauri-signing-key")"

        # Use tauri CLI to sign with explicit flags
        if npx tauri signer sign -k "$PRIVATE_KEY" -p "$PASSWORD" "$TEMP_FILE" 2>/dev/null; then
            # Move cursor up and overwrite the "Testing..." line
            echo -e "\033[1A\033[K  Password:     ${GREEN}✓ Verified (signing works)${NC}"
            rm -f "$TEMP_FILE" "$TEMP_FILE.sig" 2>/dev/null
        else
            echo -e "\033[1A\033[K  Password:     ${RED}✗ Wrong password or corrupted key${NC}"
            ALL_OK=false
            rm -f "$TEMP_FILE" 2>/dev/null
        fi
    fi

    echo ""

    if [ "$ALL_OK" = true ]; then
        echo -e "${GREEN}All checks passed! Ready to build.${NC}"
    else
        echo -e "${RED}Some checks failed. Fix the issues above before building.${NC}"
    fi
}

check_notarization_status() {
    echo -e "${CYAN}Notarization History:${NC}"
    echo ""

    # Show recent submissions
    HISTORY=$(xcrun notarytool history --keychain-profile "$NOTARIZE_PROFILE" 2>&1)

    if echo "$HISTORY" | grep -q "No entries"; then
        echo -e "${YELLOW}No notarization submissions found.${NC}"
        return
    fi

    # Parse submissions into arrays
    local IDS=()
    local NAMES=()
    local DATES=()
    local STATUSES=()

    while IFS= read -r line; do
        if echo "$line" | grep -q "id:"; then
            IDS+=("$(echo "$line" | awk '{print $2}')")
        elif echo "$line" | grep -q "name:"; then
            NAMES+=("$(echo "$line" | awk '{print $2}')")
        elif echo "$line" | grep -q "createdDate:"; then
            DATES+=("$(echo "$line" | awk '{print $2}')")
        elif echo "$line" | grep -q "status:"; then
            STATUSES+=("$(echo "$line" | sed 's/.*status: //')")
        fi
    done <<< "$HISTORY"

    # Display numbered list
    local COUNT=${#IDS[@]}
    for ((i=0; i<COUNT; i++)); do
        local NUM=$((i + 1))
        local STATUS_COLOR="$YELLOW"
        if [ "${STATUSES[$i]}" = "Accepted" ]; then
            STATUS_COLOR="$GREEN"
        elif [ "${STATUSES[$i]}" = "Invalid" ]; then
            STATUS_COLOR="$RED"
        fi

        echo -e "  ${BOLD}$NUM)${NC} ${NAMES[$i]}"
        echo -e "     Date:   ${DATES[$i]}"
        echo -e "     ID:     ${IDS[$i]}"
        echo -e "     Status: ${STATUS_COLOR}${STATUSES[$i]}${NC}"
        echo ""
    done

    # Let user pick
    echo -n "Enter number to inspect (or Enter to skip): "
    read PICK

    if [ -z "$PICK" ]; then
        return
    fi

    local IDX=$((PICK - 1))
    if [ "$IDX" -lt 0 ] || [ "$IDX" -ge "$COUNT" ]; then
        echo -e "${RED}Invalid selection.${NC}"
        return
    fi

    local SELECTED_ID="${IDS[$IDX]}"
    local SELECTED_STATUS="${STATUSES[$IDX]}"

    echo ""
    echo -e "${CYAN}Details for ${IDS[$IDX]}:${NC}"
    xcrun notarytool info "$SELECTED_ID" --keychain-profile "$NOTARIZE_PROFILE" 2>&1

    echo ""
    if [ "$SELECTED_STATUS" = "Accepted" ]; then
        echo -e "${GREEN}✓ Notarization accepted!${NC}"
        echo ""

        echo -n "Staple the .app bundles and DMGs for v$VERSION? (y/n) "
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            for ARCH in "${ARCHES[@]}"; do
                for TARGET in "$(app_path "$ARCH")" "$(dmg_path "$ARCH")"; do
                    if [ -e "$TARGET" ]; then
                        if xcrun stapler staple "$TARGET" 2>/dev/null; then
                            echo -e "${GREEN}✓ Stapled $(basename "$TARGET") ($(asset_arch "$ARCH"))${NC}"
                        else
                            echo -e "${YELLOW}Could not staple $TARGET (may not match this submission)${NC}"
                        fi
                    fi
                done
            done
        fi
    elif [ "$SELECTED_STATUS" = "Invalid" ]; then
        echo -e "${RED}✗ Notarization rejected.${NC}"
        echo ""
        echo -n "View the full error log? (y/n) "
        read -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            xcrun notarytool log "$SELECTED_ID" --keychain-profile "$NOTARIZE_PROFILE" 2>&1
        fi
    elif echo "$SELECTED_STATUS" | grep -q "In Progress"; then
        echo -e "${YELLOW}Still processing. Check back in a few minutes.${NC}"
    fi
}

create_draft_release() {
    local RELEASE_VERSION="$1"

    echo -e "${CYAN}Creating draft release v$RELEASE_VERSION...${NC}"

    gh release create "v$RELEASE_VERSION" \
        --repo "$RELEASE_REPO" \
        --title "Abe v$RELEASE_VERSION" \
        --notes "Abe v$RELEASE_VERSION for macOS" \
        --draft

    echo ""
    echo -e "${GREEN}=== Draft Created! ===${NC}"
    echo "https://github.com/$RELEASE_REPO/releases/tag/v$RELEASE_VERSION"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  1) Build the app (option 1 or 3)"
    echo "  2) Publish to this draft (option 4)"
}

# Main loop
while true; do
    show_menu
    read -n 1 choice
    echo

    case $choice in
        1)
            do_build
            read -p "Press Enter to continue..."
            ;;
        2)
            do_dmg
            read -p "Press Enter to continue..."
            ;;
        3)
            do_notarize
            read -p "Press Enter to continue..."
            ;;
        4)
            do_publish
            read -p "Press Enter to continue..."
            ;;
        5)
            do_build
            do_publish
            read -p "Press Enter to continue..."
            ;;
        d)
            check_or_create_draft
            ;;
        s)
            check_notarization_status
            read -p "Press Enter to continue..."
            ;;
        a)
            save_apple_credentials
            read -p "Press Enter to continue..."
            ;;
        k)
            verify_signing_setup
            read -p "Press Enter to continue..."
            ;;
        p)
            save_password
            read -p "Press Enter to continue..."
            ;;
        g)
            gh auth login
            read -p "Press Enter to continue..."
            ;;
        v)
            change_version
            read -p "Press Enter to continue..."
            ;;
        o)
            open "$PROJECT_DIR/src-tauri/target"
            ;;
        q|Q)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid option"
            sleep 1
            ;;
    esac
done
