#!/bin/bash
# Patch the dev Electron binary so macOS shows "Stratos" in the dock instead of "Electron"

TARGET_NAME="Stratos"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Find the Electron .app — may be named Electron.app or something else from a previous patch
ELECTRON_APP=""
for name in Electron AgentPanel Stratos; do
  candidate="$(find "$REPO_ROOT/node_modules" -path "*/electron/dist/${name}.app" -maxdepth 7 -type d 2>/dev/null | head -1)"
  if [ -n "$candidate" ] && [ -d "$candidate" ]; then
    ELECTRON_APP="$candidate"
    break
  fi
done

if [ -z "$ELECTRON_APP" ]; then
  echo "[patch-electron-name] Electron.app not found, skipping"
  exit 0
fi

DIST_DIR="$(dirname "$ELECTRON_APP")"
CURRENT_NAME="$(basename "$ELECTRON_APP" .app)"
PLIST="$ELECTRON_APP/Contents/Info.plist"

# Read current executable name from Info.plist
CURRENT_EXE="$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$PLIST" 2>/dev/null || echo "$CURRENT_NAME")"

# Rename executable
if [ "$CURRENT_EXE" != "$TARGET_NAME" ] && [ -f "$ELECTRON_APP/Contents/MacOS/$CURRENT_EXE" ]; then
  mv "$ELECTRON_APP/Contents/MacOS/$CURRENT_EXE" "$ELECTRON_APP/Contents/MacOS/$TARGET_NAME"
fi

# Patch Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $TARGET_NAME" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleName $TARGET_NAME" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $TARGET_NAME" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSHasLocalizedDisplayName bool true" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :LSHasLocalizedDisplayName true" "$PLIST" 2>/dev/null || true

# Add localized display name
LPROJ="$ELECTRON_APP/Contents/Resources/en.lproj"
mkdir -p "$LPROJ"
cat > "$LPROJ/InfoPlist.strings" << EOF
"CFBundleDisplayName" = "$TARGET_NAME";
"CFBundleName" = "$TARGET_NAME";
EOF

# Rename the .app bundle itself (must be last)
if [ "$CURRENT_NAME" != "$TARGET_NAME" ]; then
  mv "$ELECTRON_APP" "$DIST_DIR/$TARGET_NAME.app"
  ELECTRON_APP="$DIST_DIR/$TARGET_NAME.app"
fi

# Update path.txt so the electron npm module can find the renamed binary
PATH_TXT="$(find "$REPO_ROOT/node_modules" -path "*/electron/path.txt" -maxdepth 7 2>/dev/null | head -1)"
if [ -n "$PATH_TXT" ]; then
  printf '%s' "$TARGET_NAME.app/Contents/MacOS/$TARGET_NAME" > "$PATH_TXT"
fi

echo "[patch-electron-name] Patched → $TARGET_NAME"
