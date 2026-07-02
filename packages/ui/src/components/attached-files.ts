import type { ImageAttachment, FileAttachment } from "../types";

// Anthropic's many-image API path rejects conversations where any image's
// longest edge exceeds 2000px. Downscale at upload time so a single oversized
// screenshot can't permanently break the session.
const MAX_IMAGE_DIM = 2000;

const HEIC_EXT_RE = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /^image\/(heic|heif)(-sequence)?$/i;

// Browsers can't decode HEIC into <img>, and the Anthropic API only accepts
// jpeg/png/gif/webp — so detect HEIC up front and transcode it to PNG.
export function isHeicFile(file: File): boolean {
  if (HEIC_MIME_RE.test(file.type)) return true;
  // macOS Finder drops sometimes report an empty MIME for .heic; fall back to ext.
  return HEIC_EXT_RE.test(file.name);
}

// Files with no MIME (some Electron drops) should still be treated as image
// if the extension says so, otherwise the HEIC filter below would miss them.
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || isHeicFile(file);
}

function readDataUrl(blob: Blob, fileName?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(
        new Error(
          `Failed to read ${fileName ?? "file"}: ${reader.error?.message ?? "unknown error"}`,
        ),
      );
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function convertHeicToPng(file: File): Promise<Blob> {
  // Dynamic import keeps the libheif WASM out of the initial bundle — it is
  // only loaded the first time a user attaches a HEIC.
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "image/png" });
}

async function downscaleIfOversized(
  dataUrl: string,
  mimeType: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  // SVG is vector — no pixel dimension to enforce.
  if (mimeType.includes("svg")) return { dataUrl, mimeType };
  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return { dataUrl, mimeType };
  }
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_IMAGE_DIM) return { dataUrl, mimeType };
  const scale = MAX_IMAGE_DIM / longest;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl, mimeType };
  ctx.drawImage(img, 0, 0, w, h);
  // Re-encode as PNG to preserve transparency and avoid double-lossy JPEG.
  return { dataUrl: canvas.toDataURL("image/png"), mimeType: "image/png" };
}

export async function readImageFile(file: File): Promise<ImageAttachment> {
  let sourceBlob: Blob = file;
  let sourceMime = file.type;
  let displayName = file.name;
  if (isHeicFile(file)) {
    sourceBlob = await convertHeicToPng(file);
    sourceMime = "image/png";
    // Rename so the attachment chip and message bubble surface a sensible name.
    displayName = file.name.replace(HEIC_EXT_RE, ".png");
  }
  const rawDataUrl = await readDataUrl(sourceBlob, file.name);
  const { dataUrl, mimeType } = await downscaleIfOversized(
    rawDataUrl,
    sourceMime,
  );
  return {
    id: crypto.randomUUID(),
    name: displayName,
    dataUrl,
    mimeType,
  };
}

export interface ProcessedFiles {
  images: ImageAttachment[];
  fileAttachments: FileAttachment[];
}

export async function processFiles(
  files: FileList | File[],
): Promise<ProcessedFiles> {
  const all = Array.from(files);
  const imageFiles = all.filter(isImageFile);
  const nonImageFiles = all.filter((f) => !isImageFile(f));

  // settle so one bad HEIC can't drop the others on the floor
  const settled = await Promise.allSettled(imageFiles.map(readImageFile));
  const images: ImageAttachment[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      images.push(r.value);
    } else {
      console.error(
        `[InputBar] failed to process image ${imageFiles[i].name}:`,
        r.reason,
      );
    }
  }
  const fileAttachments: FileAttachment[] = nonImageFiles.map((f) => ({
    id: crypto.randomUUID(),
    name: f.name,
    // Electron exposes the absolute path on File objects in the renderer
    path: (f as File & { path?: string }).path ?? f.name,
  }));

  return { images, fileAttachments };
}
