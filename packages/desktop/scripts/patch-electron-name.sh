#!/bin/bash
# Patch the dev Electron binary so macOS shows "Stratos" in the dock instead of "Electron".
# Runs on every install; iterates over every electron@X install in node_modules/.pnpm
# so parallel installs of multiple electron versions all get patched.

TARGET_NAME="Stratos"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

patch_app() {
  local ELECTRON_APP="$1"
  local DIST_DIR CURRENT_NAME PLIST CURRENT_EXE LPROJ

  DIST_DIR="$(dirname "$ELECTRON_APP")"
  CURRENT_NAME="$(basename "$ELECTRON_APP" .app)"
  PLIST="$ELECTRON_APP/Contents/Info.plist"

  CURRENT_EXE="$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$PLIST" 2>/dev/null || echo "$CURRENT_NAME")"

  if [ "$CURRENT_EXE" != "$TARGET_NAME" ] && [ -f "$ELECTRON_APP/Contents/MacOS/$CURRENT_EXE" ]; then
    mv "$ELECTRON_APP/Contents/MacOS/$CURRENT_EXE" "$ELECTRON_APP/Contents/MacOS/$TARGET_NAME"
  fi

  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $TARGET_NAME" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $TARGET_NAME" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $TARGET_NAME" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :LSHasLocalizedDisplayName bool true" "$PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :LSHasLocalizedDisplayName true" "$PLIST" 2>/dev/null || true

  LPROJ="$ELECTRON_APP/Contents/Resources/en.lproj"
  mkdir -p "$LPROJ"
  cat > "$LPROJ/InfoPlist.strings" << EOF
"CFBundleDisplayName" = "$TARGET_NAME";
"CFBundleName" = "$TARGET_NAME";
EOF

  if [ "$CURRENT_NAME" != "$TARGET_NAME" ]; then
    mv "$ELECTRON_APP" "$DIST_DIR/$TARGET_NAME.app"
  fi

  # Update path.txt (sibling of dist/) so the electron npm wrapper can spawn
  # the renamed binary. No trailing newline — Electron's CLI reads the file raw.
  local PATH_TXT="$(dirname "$DIST_DIR")/path.txt"
  if [ -f "$PATH_TXT" ]; then
    printf '%s' "$TARGET_NAME.app/Contents/MacOS/$TARGET_NAME" > "$PATH_TXT"
  fi
}

PATCHED=0
while IFS= read -r app; do
  [ -n "$app" ] && [ -d "$app" ] || continue
  patch_app "$app"
  PATCHED=$((PATCHED + 1))
done < <(find "$REPO_ROOT/node_modules" -maxdepth 7 -type d \
  \( -path "*/electron/dist/Electron.app" \
  -o -path "*/electron/dist/AgentPanel.app" \
  -o -path "*/electron/dist/$TARGET_NAME.app" \) 2>/dev/null)

if [ "$PATCHED" -eq 0 ]; then
  echo "[patch-electron-name] Electron.app not found, skipping"
else
  echo "[patch-electron-name] Patched $PATCHED install(s) → $TARGET_NAME"
fi
