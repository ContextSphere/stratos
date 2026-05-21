#!/usr/bin/env node
// Downscale any image >2000px in a Claude Code SDK session JSONL.
// Writes to <path>.fixed alongside the original. Caller can swap.

import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const MAX_DIM = 1800; // headroom under the API's 2000px many-image limit
const path = process.argv[2];
const out = process.argv[3];
if (!path || !out) {
  console.error("usage: fix-images.mjs <input.jsonl> <output.jsonl>");
  process.exit(1);
}

async function downscale(b64) {
  const buf = Buffer.from(b64, "base64");
  const resized = await sharp(buf)
    .resize({
      width: MAX_DIM,
      height: MAX_DIM,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return {
    data: resized.toString("base64"),
    width: meta.width,
    height: meta.height,
    bytes: resized.length,
  };
}

async function visitAndFix(obj, fixes) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) await visitAndFix(item, fixes);
    return;
  }
  if (
    obj.type === "image" &&
    obj.source &&
    obj.source.type === "base64" &&
    typeof obj.source.data === "string"
  ) {
    const meta = await sharp(Buffer.from(obj.source.data, "base64"))
      .metadata()
      .catch(() => null);
    if (meta && (meta.width > 2000 || meta.height > 2000)) {
      const r = await downscale(obj.source.data);
      obj.source.media_type = "image/png";
      obj.source.data = r.data;
      fixes.push({
        before: { w: meta.width, h: meta.height },
        after: { w: r.width, h: r.height, bytes: r.bytes },
      });
    }
  }
  for (const v of Object.values(obj)) {
    await visitAndFix(v, fixes);
  }
}

const lines = readFileSync(path, "utf8").split("\n");
const outLines = [];
const allFixes = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) {
    outLines.push(line);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    outLines.push(line);
    continue;
  }
  const fixes = [];
  await visitAndFix(parsed, fixes);
  if (fixes.length > 0) {
    console.log(`line ${i + 1}: fixed ${fixes.length} image(s)`);
    for (const f of fixes) {
      console.log(
        `  ${f.before.w}x${f.before.h} -> ${f.after.w}x${f.after.h} (${f.after.bytes} bytes)`,
      );
    }
    allFixes.push(...fixes);
  }
  outLines.push(JSON.stringify(parsed));
}

writeFileSync(out, outLines.join("\n"));
console.error(`\nTotal images fixed: ${allFixes.length}`);
console.error(`Output: ${out}`);
