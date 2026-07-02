/**
 * Shared PDF/Office → per-page JPG renderer used by the preview MCP
 * handler and the files IPC handler. Converts Office docs to PDF via
 * soffice (LibreOffice) the first time, then rasterizes pages via
 * pdftoppm and caches everything in os.tmpdir() keyed by path+size+mtime.
 */
import { promises as fsPromises, createWriteStream } from "fs";
import { basename, extname, join } from "path";
import { tmpdir, homedir } from "os";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { get as httpsGet } from "https";
import { get as httpGet, type IncomingMessage } from "http";
import { pipeline } from "stream/promises";

const execFileAsync = promisify(execFile);

// User-writable install location for the on-demand LibreOffice download.
// Kept outside the app bundle so upgrades don't wipe it.
const STRATOS_BIN_DIR = join(homedir(), ".stratos", "bin");
const MANAGED_LIBREOFFICE_APP = join(STRATOS_BIN_DIR, "LibreOffice.app");
const MANAGED_SOFFICE_PATH = join(
  MANAGED_LIBREOFFICE_APP,
  "Contents/MacOS/soffice",
);

// Error prefixes so the renderer can detect a missing dependency and offer
// the auto-install flow instead of showing a raw message.
export const MISSING_LIBREOFFICE_ERROR = "MISSING_LIBREOFFICE";
export const MISSING_POPPLER_ERROR = "MISSING_POPPLER";

export const PDF_EXTENSIONS = new Set([".pdf"]);
export const OFFICE_EXTENSIONS = new Set([
  ".pptx",
  ".ppt",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".odp",
  ".odt",
  ".ods",
]);

const SOFFICE_ABSOLUTE_PATHS = [
  MANAGED_SOFFICE_PATH,
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
];

async function findSoffice(): Promise<string | null> {
  for (const candidate of SOFFICE_ABSOLUTE_PATHS) {
    try {
      await fsPromises.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  // Electron's PATH on macOS GUI launches doesn't include Homebrew dirs, so
  // a bare `spawn("soffice")` fails with ENOENT. Resolve via `which`/`where`
  // and only return a path that actually exists.
  try {
    const finder = process.platform === "win32" ? "where" : "/usr/bin/which";
    const { stdout } = await execFileAsync(finder, ["soffice"]);
    const resolved = stdout.trim().split(/\r?\n/)[0];
    if (resolved) {
      await fsPromises.access(resolved);
      return resolved;
    }
  } catch {
    // not in PATH
  }
  return null;
}

function sofficeInstallHint(): string {
  switch (process.platform) {
    case "darwin":
      return "Install with: brew install --cask libreoffice";
    case "linux":
      return "Install via your package manager (e.g. apt install libreoffice).";
    case "win32":
      return "Download from https://www.libreoffice.org/download/";
    default:
      return "Install LibreOffice from https://www.libreoffice.org/";
  }
}

export async function getLibreOfficeStatus(): Promise<{
  installed: boolean;
  path: string | null;
  canAutoInstall: boolean;
}> {
  const path = await findSoffice();
  return {
    installed: path !== null,
    path,
    // Auto-install is currently only implemented for macOS (DMG mount + copy).
    canAutoInstall: process.platform === "darwin",
  };
}

// Pinned LibreOffice version for auto-install. Bump when the format changes or
// a security update ships. Matches URLs served by the Document Foundation CDN.
const LIBREOFFICE_VERSION = "24.8.4";

function libreOfficeDownloadUrl(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/${arch}/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_${arch}.dmg`;
}

export type LibreOfficeInstallProgress = {
  phase: "downloading" | "extracting" | "installing" | "done";
  bytesDownloaded: number;
  totalBytes: number;
};

function fetchFollowingRedirects(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https:") ? httpsGet : httpGet;
    const req = getter(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        fetchFollowingRedirects(res.headers.location)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Download failed with HTTP ${status}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });
}

async function downloadDmg(
  destPath: string,
  onProgress: (bytesDownloaded: number, totalBytes: number) => void,
): Promise<void> {
  const res = await fetchFollowingRedirects(libreOfficeDownloadUrl());
  const totalBytes = Number(res.headers["content-length"] ?? 0);
  let downloaded = 0;
  res.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    onProgress(downloaded, totalBytes);
  });
  await pipeline(res, createWriteStream(destPath));
}

async function mountDmg(dmgPath: string): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/hdiutil", [
    "attach",
    dmgPath,
    "-nobrowse",
    "-noautoopen",
    "-mountrandom",
    "/tmp",
  ]);
  // Last non-empty line contains the mount point after tabs.
  const mountLine = stdout.trim().split("\n").pop() ?? "";
  const parts = mountLine
    .split("\t")
    .map((p) => p.trim())
    .filter(Boolean);
  const mountPoint = parts[parts.length - 1];
  if (!mountPoint || !mountPoint.startsWith("/")) {
    throw new Error(`Could not parse hdiutil mount output: ${stdout}`);
  }
  return mountPoint;
}

async function detachDmg(mountPoint: string): Promise<void> {
  try {
    await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint, "-quiet"]);
  } catch {
    // Best-effort cleanup — don't fail the install if unmount hiccups.
  }
}

export async function installLibreOffice(
  onProgress: (progress: LibreOfficeInstallProgress) => void,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      `Auto-install for LibreOffice is only supported on macOS. ${sofficeInstallHint()}`,
    );
  }
  await fsPromises.mkdir(STRATOS_BIN_DIR, { recursive: true });
  const dmgPath = join(
    STRATOS_BIN_DIR,
    `libreoffice-${LIBREOFFICE_VERSION}.dmg`,
  );
  onProgress({ phase: "downloading", bytesDownloaded: 0, totalBytes: 0 });
  await downloadDmg(dmgPath, (bytesDownloaded, totalBytes) => {
    onProgress({ phase: "downloading", bytesDownloaded, totalBytes });
  });
  onProgress({ phase: "extracting", bytesDownloaded: 1, totalBytes: 1 });
  const mountPoint = await mountDmg(dmgPath);
  try {
    const sourceApp = join(mountPoint, "LibreOffice.app");
    await fsPromises.access(sourceApp);
    // Replace any prior managed install atomically-ish: remove old, then copy.
    onProgress({ phase: "installing", bytesDownloaded: 1, totalBytes: 1 });
    await fsPromises.rm(MANAGED_LIBREOFFICE_APP, {
      recursive: true,
      force: true,
    });
    await execFileAsync("/bin/cp", ["-R", sourceApp, MANAGED_LIBREOFFICE_APP]);
  } finally {
    await detachDmg(mountPoint);
    await fsPromises.rm(dmgPath, { force: true });
  }
  await fsPromises.access(MANAGED_SOFFICE_PATH);
  onProgress({ phase: "done", bytesDownloaded: 1, totalBytes: 1 });
}

async function convertToPdf(
  sourcePath: string,
  outDir: string,
): Promise<string> {
  const soffice = await findSoffice();
  if (!soffice) {
    throw new Error(
      `${MISSING_LIBREOFFICE_ERROR}: LibreOffice is required to preview Office documents. ${sofficeInstallHint()}`,
    );
  }
  await fsPromises.mkdir(outDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      soffice,
      [
        "--headless",
        "--norestore",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        sourcePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`soffice exited with code ${code}: ${stderr}`));
    });
  });
  const base = basename(sourcePath, extname(sourcePath));
  const pdfPath = join(outDir, `${base}.pdf`);
  await fsPromises.access(pdfPath);
  return pdfPath;
}

function cacheDirFor(
  sourcePath: string,
  stat: { size: number; mtimeMs: number },
): string {
  const key = createHash("sha1")
    .update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), "stratos-pdf-preview", key);
}

async function getOrConvertPdf(sourcePath: string): Promise<string> {
  const stat = await fsPromises.stat(sourcePath);
  const cacheDir = cacheDirFor(sourcePath, stat);
  const base = basename(sourcePath, extname(sourcePath));
  const cachedPdf = join(cacheDir, `${base}.pdf`);
  try {
    await fsPromises.access(cachedPdf);
    return cachedPdf;
  } catch {
    return convertToPdf(sourcePath, cacheDir);
  }
}

const PDFTOPPM_ABSOLUTE_PATHS = [
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/usr/bin/pdftoppm",
];

async function findPdftoppm(): Promise<string | null> {
  for (const candidate of PDFTOPPM_ABSOLUTE_PATHS) {
    try {
      await fsPromises.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  try {
    const finder = process.platform === "win32" ? "where" : "/usr/bin/which";
    const { stdout } = await execFileAsync(finder, ["pdftoppm"]);
    const resolved = stdout.trim().split(/\r?\n/)[0];
    if (resolved) {
      await fsPromises.access(resolved);
      return resolved;
    }
  } catch {
    // not in PATH
  }
  return null;
}

function pdftoppmInstallHint(): string {
  switch (process.platform) {
    case "darwin":
      return "Install with: brew install poppler";
    case "linux":
      return "Install via your package manager (e.g. apt install poppler-utils).";
    case "win32":
      return "Install poppler from https://github.com/oschwartz10612/poppler-windows/releases/";
    default:
      return "Install poppler-utils to enable PDF rasterization.";
  }
}

const PAGE_DPI = 110;

async function renderPdfToPages(
  pdfPath: string,
  cacheDir: string,
): Promise<string[]> {
  await fsPromises.mkdir(cacheDir, { recursive: true });
  const firstPage = join(cacheDir, "page-1.jpg");
  try {
    await fsPromises.access(firstPage);
  } catch {
    const pdftoppm = await findPdftoppm();
    if (!pdftoppm) {
      throw new Error(
        `${MISSING_POPPLER_ERROR}: pdftoppm (poppler) is required to render PDF pages. ${pdftoppmInstallHint()}`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        pdftoppm,
        ["-jpeg", "-r", String(PAGE_DPI), pdfPath, join(cacheDir, "page")],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pdftoppm exited with code ${code}: ${stderr}`));
      });
    });
  }
  const entries = await fsPromises.readdir(cacheDir);
  const pageFiles = entries
    .filter((f) => /^page-\d+\.jpg$/.test(f))
    .sort(
      (a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]),
    );
  const pages: string[] = [];
  for (const f of pageFiles) {
    const buf = await fsPromises.readFile(join(cacheDir, f));
    pages.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
  }
  return pages;
}

export function isPdfOrOfficePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return PDF_EXTENSIONS.has(ext) || OFFICE_EXTENSIONS.has(ext);
}

/**
 * Render any supported file (.pdf or Office formats) as an array of
 * base64 JPG data URLs, one per page. Converts to PDF first if needed.
 */
export async function getPdfPagesForFile(
  sourcePath: string,
): Promise<string[]> {
  const ext = extname(sourcePath).toLowerCase();
  if (PDF_EXTENSIONS.has(ext)) {
    const stat = await fsPromises.stat(sourcePath);
    return renderPdfToPages(sourcePath, cacheDirFor(sourcePath, stat));
  }
  if (OFFICE_EXTENSIONS.has(ext)) {
    const pdfPath = await getOrConvertPdf(sourcePath);
    const stat = await fsPromises.stat(sourcePath);
    return renderPdfToPages(pdfPath, cacheDirFor(sourcePath, stat));
  }
  throw new Error(`Unsupported file type for PDF rendering: ${ext}`);
}
