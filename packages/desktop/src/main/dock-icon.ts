import { nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Load the real app icon and shift its hue by a deterministic amount derived
 * from the worktree hash. Each worktree gets a distinctly colored variant of
 * the icon, making it easy to tell dev instances apart in the dock.
 */
export function generateDockIcon(hash: string): Electron.NativeImage {
  const iconPath = join(__dirname, '../../build/icon.png')
  if (!existsSync(iconPath)) {
    return nativeImage.createEmpty()
  }

  const size = 128
  const baseIcon = nativeImage.createFromPath(iconPath).resize({ width: size, height: size })
  const bitmap = baseIcon.toBitmap() // BGRA format

  // Deterministic hue shift from hash (30–330° to always look different from original)
  const hueShift = 30 + (parseInt(hash.slice(0, 4), 16) % 300)

  // Shift hue of every pixel
  const totalPixels = size * size
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4
    const alpha = bitmap[offset + 3]
    if (alpha === 0) continue // skip transparent pixels

    // BGRA → RGB
    const b = bitmap[offset]
    const g = bitmap[offset + 1]
    const r = bitmap[offset + 2]

    // RGB → HSL
    const [h, s, l] = rgbToHsl(r, g, b)

    // Shift hue, keep saturation and lightness
    const newH = (h + hueShift) % 360

    // HSL → RGB → BGRA
    const [nr, ng, nb] = hslToRgb(newH, s, l)
    bitmap[offset] = nb
    bitmap[offset + 1] = ng
    bitmap[offset + 2] = nr
    // alpha stays unchanged
  }

  return nativeImage.createFromBitmap(bitmap, { width: size, height: size })
}

/** RGB (0–255) to HSL (h: 0–360, s: 0–100, l: 0–100) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255
  const g1 = g / 255
  const b1 = b / 255
  const max = Math.max(r1, g1, b1)
  const min = Math.min(r1, g1, b1)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) * 60
  else if (max === g1) h = ((b1 - r1) / d + 2) * 60
  else h = ((r1 - g1) / d + 4) * 60
  return [h, s * 100, l * 100]
}

/** HSL (h: 0–360, s: 0–100, l: 0–100) to RGB (0–255) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const s1 = s / 100
  const l1 = l / 100
  const c = (1 - Math.abs(2 * l1 - 1)) * s1
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l1 - c / 2
  let r1: number, g1: number, b1: number
  if (h < 60) [r1, g1, b1] = [c, x, 0]
  else if (h < 120) [r1, g1, b1] = [x, c, 0]
  else if (h < 180) [r1, g1, b1] = [0, c, x]
  else if (h < 240) [r1, g1, b1] = [0, x, c]
  else if (h < 300) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ]
}
