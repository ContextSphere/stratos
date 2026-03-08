import { nativeImage } from "electron";
import { existsSync } from "fs";
import { join } from "path";

/** Icon bitmap size — 256 for Retina sharpness at dock size */
const ICON_SIZE = 256;

/** Superellipse exponent — Apple's squircle uses ~5 */
const SQUIRCLE_N = 5;

/** How much of the canvas the squircle fills (Apple spec is 80.5% for .icns,
 *  but app.dock.setIcon() bypasses the OS pipeline so we scale up to match) */
const SQUIRCLE_FILL = 0.9;

/** Anti-alias zone width at the squircle edge (fraction of superellipse d-value) */
const AA_START = 0.92;
const AA_WIDTH = 1 - AA_START;

/** Brightness threshold — pixels above this are considered "white" for recoloring */
const BRIGHT_THRESHOLD = 128;

/**
 * Load the app icon with macOS squircle mask baked in.
 * app.dock.setIcon() does NOT get the OS squircle treatment,
 * so we apply it ourselves in bitmap space.
 *
 * For linked worktrees, white pixels are recolored to a
 * deterministic hue so each worktree is visually distinct.
 */
export function generateDockIcon(
  hash: string,
  isLinkedWorktree = false,
): Electron.NativeImage {
  const iconPath = join(__dirname, "../../build/icon.png");
  if (!existsSync(iconPath)) {
    return nativeImage.createEmpty();
  }

  const baseIcon = nativeImage.createFromPath(iconPath).resize({
    width: ICON_SIZE,
    height: ICON_SIZE,
  });
  const bitmap = baseIcon.toBitmap(); // BGRA format

  // Pre-compute worktree accent color (if needed)
  let tr = 0,
    tg = 0,
    tb = 0;
  if (isLinkedWorktree) {
    const hue = 20 + (parseInt(hash.slice(0, 4), 16) % 320);
    [tr, tg, tb] = hslToRgb(hue, 85, 65);
  }

  // Squircle geometry
  const half = (ICON_SIZE * SQUIRCLE_FILL) / 2;
  const center = ICON_SIZE / 2;

  // Single pass: recolor + squircle mask
  for (let py = 0; py < ICON_SIZE; py++) {
    const dy = Math.abs(py - center) / half;
    const dyN = dy * dy * dy * dy * dy; // dy^5

    for (let px = 0; px < ICON_SIZE; px++) {
      const offset = (py * ICON_SIZE + px) * 4;
      const dx = Math.abs(px - center) / half;
      const d = dx * dx * dx * dx * dx + dyN; // superellipse: |dx|^5 + |dy|^5

      if (d > 1) {
        bitmap[offset + 3] = 0;
        continue;
      }
      if (d > AA_START) {
        bitmap[offset + 3] = Math.round(
          bitmap[offset + 3] * (1 - (d - AA_START) / AA_WIDTH),
        );
      }

      // Worktree recoloring: map bright pixels to the accent color
      if (isLinkedWorktree && bitmap[offset + 3] > 0) {
        const brightness =
          (bitmap[offset + 2] + bitmap[offset + 1] + bitmap[offset]) / 3;
        if (brightness > BRIGHT_THRESHOLD) {
          const scale = brightness / 255;
          bitmap[offset] = Math.round(tb * scale);
          bitmap[offset + 1] = Math.round(tg * scale);
          bitmap[offset + 2] = Math.round(tr * scale);
        }
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, {
    width: ICON_SIZE,
    height: ICON_SIZE,
  });
}

/** HSL (h: 0–360, s: 0–100, l: 0–100) to RGB (0–255) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const s1 = s / 100;
  const l1 = l / 100;
  const c = (1 - Math.abs(2 * l1 - 1)) * s1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l1 - c / 2;
  let r1: number, g1: number, b1: number;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}
