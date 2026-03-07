#!/bin/bash
# Patch the dev Electron binary so macOS shows "AgentPanel" in the dock instead of "Electron"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ELECTRON_APP="$(find "$REPO_ROOT/node_modules" -path "*/electron/dist/Electron.app" -maxdepth 7 -type d 2>/dev/null | head -1)"

if [ -z "$ELECTRON_APP" ] || [ ! -d "$ELECTRON_APP" ]; then
  echo "[patch-electron-name] Electron.app not found, skipping"
  exit 0
fi

PLIST="$ELECTRON_APP/Contents/Info.plist"

# Patch Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleName AgentPanel" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName AgentPanel" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSHasLocalizedDisplayName bool true" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :LSHasLocalizedDisplayName true" "$PLIST" 2>/dev/null || true

# Add localized display name (macOS dock reads this over the .app folder name)
LPROJ="$ELECTRON_APP/Contents/Resources/en.lproj"
mkdir -p "$LPROJ"
cat > "$LPROJ/InfoPlist.strings" << 'EOF'
"CFBundleDisplayName" = "AgentPanel";
"CFBundleName" = "AgentPanel";
EOF

echo "[patch-electron-name] Patched Electron.app → AgentPanel"
