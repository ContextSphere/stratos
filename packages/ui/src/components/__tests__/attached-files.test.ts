import { describe, it, expect, vi, beforeEach } from "vitest";

// happy-dom's Image never resolves onload/onerror for arbitrary data URLs,
// which would hang downscaleIfOversized. Force a fast onerror so we fall back
// to the original data URL and the test can complete.
beforeEach(() => {
  vi.stubGlobal(
    "Image",
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: ((e?: unknown) => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.(new Error("test stub")));
      }
    },
  );
});

// heic-to ships a libheif WASM that we don't want to load in unit tests —
// stub the dynamic import so the test asserts the conversion wiring, not the
// transcoder itself.
vi.mock("heic-to", () => ({
  heicTo: vi.fn(async ({ blob }: { blob: Blob; type: string }) => {
    // Pretend we transcoded — return a tiny PNG-ish blob whose size differs
    // from the input so the test can verify we used the converted bytes.
    const marker = new Uint8Array([0x89, 0x50, 0x4e, 0x47, blob.size & 0xff]);
    return new Blob([marker], { type: "image/png" });
  }),
}));

import {
  isHeicFile,
  isImageFile,
  processFiles,
  readImageFile,
} from "../attached-files";

function makeFile(name: string, mime: string, size = 16): File {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = i;
  return new File([buf], name, { type: mime });
}

describe("isHeicFile", () => {
  it("matches by lowercase .heic extension", () => {
    expect(isHeicFile(makeFile("photo.heic", ""))).toBe(true);
  });
  it("matches by uppercase .HEIC extension (Camera Roll names)", () => {
    expect(isHeicFile(makeFile("IMG_5995.HEIC", ""))).toBe(true);
  });
  it("matches by .heif extension", () => {
    expect(isHeicFile(makeFile("photo.heif", ""))).toBe(true);
  });
  it("matches by image/heic mime even without extension", () => {
    expect(isHeicFile(makeFile("blob", "image/heic"))).toBe(true);
  });
  it("matches image/heic-sequence (live photos)", () => {
    expect(isHeicFile(makeFile("blob", "image/heic-sequence"))).toBe(true);
  });
  it("does not match png/jpeg", () => {
    expect(isHeicFile(makeFile("photo.png", "image/png"))).toBe(false);
    expect(isHeicFile(makeFile("photo.jpg", "image/jpeg"))).toBe(false);
  });
});

describe("isImageFile", () => {
  it("includes HEIC even when mime is empty", () => {
    expect(isImageFile(makeFile("IMG.HEIC", ""))).toBe(true);
  });
  it("includes normal image mimes", () => {
    expect(isImageFile(makeFile("a.png", "image/png"))).toBe(true);
    expect(isImageFile(makeFile("a.webp", "image/webp"))).toBe(true);
  });
  it("excludes non-images", () => {
    expect(isImageFile(makeFile("doc.pdf", "application/pdf"))).toBe(false);
    expect(isImageFile(makeFile("notes.txt", "text/plain"))).toBe(false);
  });
});

describe("readImageFile", () => {
  it("transcodes HEIC to PNG and renames the file", async () => {
    const heic = makeFile("IMG_2776.heic", "image/heic", 32);
    const att = await readImageFile(heic);
    expect(att.mimeType).toBe("image/png");
    expect(att.name).toBe("IMG_2776.png");
    expect(att.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("renames .HEIC (uppercase) to .png", async () => {
    const heic = makeFile("IMG_5995.HEIC", "");
    const att = await readImageFile(heic);
    expect(att.name).toBe("IMG_5995.png");
    expect(att.mimeType).toBe("image/png");
  });

  it("passes a PNG through unchanged (no transcoding)", async () => {
    const png = makeFile("screenshot.png", "image/png");
    const att = await readImageFile(png);
    expect(att.name).toBe("screenshot.png");
    expect(att.mimeType).toBe("image/png");
  });
});

describe("processFiles", () => {
  it("splits HEIC + PDF into images + fileAttachments correctly", async () => {
    const heic = makeFile("photo.HEIC", "");
    const pdf = makeFile("doc.pdf", "application/pdf");
    const out = await processFiles([heic, pdf]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0].mimeType).toBe("image/png");
    expect(out.images[0].name).toBe("photo.png");
    expect(out.fileAttachments).toHaveLength(1);
    expect(out.fileAttachments[0].name).toBe("doc.pdf");
  });

  it("keeps other images when one HEIC fails to convert", async () => {
    const heicMod = await import("heic-to");
    const heicToMock = vi.mocked(heicMod.heicTo);
    heicToMock.mockImplementationOnce(async () => {
      throw new Error("corrupt HEIC");
    });
    const bad = makeFile("bad.heic", "image/heic");
    const good = makeFile("ok.png", "image/png");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await processFiles([bad, good]);
    errSpy.mockRestore();

    expect(out.images).toHaveLength(1);
    expect(out.images[0].name).toBe("ok.png");
  });
});
