# App Icon & Dock Name — Design Notes

## Overview

The Stratos Electron app uses a custom icon and process name in the macOS dock. This required solving several platform-specific issues around icon transparency, sizing, process naming, and dev-mode detection.

## Icon Files

| File                               | Purpose                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/build/icon.png`  | 1024x1024 PNG with transparent background. Used at runtime by `dock-icon.ts` for the dock icon (and hue-shifted variants for linked worktrees). |
| `packages/desktop/build/icon.icns` | macOS icon bundle generated via `iconutil`. Referenced by `electron-builder.yml` for packaged builds.                                           |

### Generating icon.icns from icon.png

```bash
SRC="packages/desktop/build/icon.png"
ICONSET="/tmp/Stratos.iconset"
mkdir -p "$ICONSET"
sips -z 16 16 "$SRC" --out "$ICONSET/icon_16x16.png"
sips -z 32 32 "$SRC" --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32 "$SRC" --out "$ICONSET/icon_32x32.png"
sips -z 64 64 "$SRC" --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128 "$SRC" --out "$ICONSET/icon_128x128.png"
sips -z 256 256 "$SRC" --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256 "$SRC" --out "$ICONSET/icon_256x256.png"
sips -z 512 512 "$SRC" --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512 "$SRC" --out "$ICONSET/icon_512x512.png"
cp "$SRC" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o packages/desktop/build/icon.icns
rm -rf "$ICONSET"
```

## Icon Transparency & Sizing

### Problem: White background in dock

The source icon (`IconAP.png`) had no alpha channel — the background was solid white pixels. macOS dock renders icons on a translucent background, making the white rectangle visible.

### Solution: Flood-fill background removal

Used Python (Pillow + scipy) to:

1. Detect background pixels via flood-fill from image edges using saturation + brightness thresholds (`brightness > 200` and `saturation < 0.08`)
2. Use 8-connectivity flood fill to catch diagonal pixels
3. Feather edges with a 4px alpha gradient using `distance_transform_edt` for smooth anti-aliasing

### Problem: Icon too small / too large in dock

macOS dock icons from other apps (WhatsApp, etc.) fill the icon canvas edge-to-edge because macOS itself applies the rounded-rect mask. Our icon already had its own rounded rect with internal padding, causing a double-margin effect.

### Solution: Crop and scale with 8% margin

After removing the background, crop to the bounding box of non-transparent pixels, then scale to fill a 1024x1024 canvas with 8% margin on each side. This matched the visual size of other dock icons.

- 3% margin = too large (icon bigger than peers)
- 15% margin (original) = too small
- 8% margin = matched other macOS dock icons

## Dock Icon Hue Shifting

`dock-icon.ts` applies a deterministic hue shift to the icon for linked worktrees, making it easy to distinguish multiple dev instances in the dock.

| Worktree type                        | Behavior                                           |
| ------------------------------------ | -------------------------------------------------- |
| Main worktree                        | Original icon (no hue shift)                       |
| Linked worktree (`git worktree add`) | Hue-shifted by hash-derived angle (30-330 degrees) |

Detection: `statSync(join(worktree.root, '.git')).isDirectory()` — in the main worktree `.git` is a directory; in linked worktrees `.git` is a file pointing to the main repo.

## Dock Process Name

### Problem: macOS shows "Electron" in dock tooltip

In dev mode, the app runs from the Electron binary at `node_modules/electron/dist/Electron.app`. macOS derives the dock tooltip from:

1. The `.app` bundle folder name (highest priority)
2. `CFBundleExecutable` in `Info.plist`
3. `CFBundleName` / `CFBundleDisplayName` (lowest priority)

Setting `app.setName()`, patching `CFBundleName`, or adding localized `InfoPlist.strings` were all insufficient — macOS always fell back to the `.app` folder name and executable name.

### Solution: Rename the Electron binary and .app bundle

The `postinstall` script (`scripts/patch-electron-name.sh`) does:

1. Renames `Electron.app` to `Stratos.app`
2. Renames the executable `Electron` to `Stratos`
3. Updates `CFBundleExecutable`, `CFBundleName`, `CFBundleDisplayName` in `Info.plist`
4. Adds localized display name in `en.lproj/InfoPlist.strings`
5. Updates `path.txt` (which the `electron` npm module reads to find the binary)

This runs automatically on `pnpm install` via the `postinstall` script in `packages/desktop/package.json`.

### Caveat: `app.isPackaged` becomes unreliable

Electron determines `app.isPackaged` by checking if the executable name is "Electron". After renaming, `app.isPackaged` returns `true` even in dev mode, which breaks:

- Worktree isolation (skipped in "packaged" mode)
- CDP port setup
- Dev tools auto-open
- Renderer URL loading (file vs dev server)

### Solution: `isDev` based on `ELECTRON_RENDERER_URL`

`electron-vite` sets `ELECTRON_RENDERER_URL` before spawning the Electron process in dev mode. The app now uses:

```typescript
const isDev = !!process.env.ELECTRON_RENDERER_URL || !app.isPackaged;
```

This is used everywhere instead of `app.isPackaged` or `is.dev` from `@electron-toolkit/utils` (which also relies on `app.isPackaged` internally).

## Files Modified

| File                                              | Change                                       |
| ------------------------------------------------- | -------------------------------------------- |
| `packages/desktop/build/icon.png`                 | App icon (transparent, properly sized)       |
| `packages/desktop/build/icon.icns`                | macOS icon bundle                            |
| `packages/desktop/scripts/patch-electron-name.sh` | Postinstall script to rename Electron binary |
| `packages/desktop/package.json`                   | Added `postinstall` script                   |
| `packages/desktop/src/main/dock-icon.ts`          | Skip hue shift for main worktree             |
| `packages/desktop/src/main/index.ts`              | `isDev` detection, linked worktree detection |
