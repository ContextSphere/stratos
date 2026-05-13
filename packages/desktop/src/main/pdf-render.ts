/**
 * Shared PDF/Office → per-page JPG renderer used by the preview MCP
 * handler and the files IPC handler. Converts Office docs to PDF via
 * soffice (LibreOffice) the first time, then rasterizes pages via
 * pdftoppm and caches everything in os.tmpdir() keyed by path+size+mtime.
 */
import { promises as fsPromises } from "fs";
import { basename, extname, join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { createHash } from "crypto";

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

const SOFFICE_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
  "soffice",
];

async function findSoffice(): Promise<string | null> {
  for (const candidate of SOFFICE_CANDIDATES) {
    if (candidate.startsWith("/")) {
      try {
        await fsPromises.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    } else {
      return candidate;
    }
  }
  return null;
}

async function convertToPdf(
  sourcePath: string,
  outDir: string,
): Promise<string> {
  const soffice = await findSoffice();
  if (!soffice) {
    throw new Error(
      "LibreOffice (soffice) not found. Install it to preview Office documents.",
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
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "pdftoppm",
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
