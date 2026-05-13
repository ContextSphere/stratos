/**
 * Preview handler definitions — 2 tools for controlling the Stratos side preview pane.
 */
import { z } from "zod";
import { promises as fsPromises } from "fs";
import { basename, dirname, extname, join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { IPC_CHANNELS } from "../../../common/ipc-channels";
import { type HandlerDef, defineHandler, textResult } from "./types";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".tiff",
]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const OFFICE_EXTENSIONS = new Set([
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
      return candidate; // last-resort: rely on PATH
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

export interface PreviewDeps {
  sendToRenderer: (channel: string, data: unknown) => void;
}

export function createPreviewHandlers(deps: PreviewDeps): HandlerDef[] {
  const { sendToRenderer } = deps;
  return [
    defineHandler({
      name: "preview_open_file",
      description:
        "Open a file in the Stratos side preview pane. Markdown files (.md, .markdown) render as formatted text; images (.png, .jpg, .svg, .gif, .webp, .bmp, .ico, .tiff) show in an image viewer; PDFs and Office documents (.pptx, .ppt, .docx, .doc, .xlsx, .xls, .odp, .odt, .ods) render as paginated PDFs (Office formats require LibreOffice/soffice on PATH); all other files open in a code editor. Always use absolute file paths.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the file to preview"),
        title: z
          .string()
          .optional()
          .describe("Optional display title (defaults to the filename)"),
      },
      handler: async (args) => {
        const fileName = args.title ?? basename(args.file_path);
        const ext = extname(args.file_path).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          let imageDataUrl: string;
          try {
            const buf = await fsPromises.readFile(args.file_path);
            const mime =
              ext === ".svg"
                ? "image/svg+xml"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".gif"
                    ? "image/gif"
                    : ext === ".webp"
                      ? "image/webp"
                      : ext === ".bmp"
                        ? "image/bmp"
                        : ext === ".ico"
                          ? "image/x-icon"
                          : ext === ".tiff"
                            ? "image/tiff"
                            : "image/png";
            imageDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return textResult(`Cannot read file: ${msg}`, true);
          }
          sendToRenderer(IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN, {
            content: imageDataUrl,
            title: fileName,
            filePath: args.file_path,
            isImage: true,
          });
          return textResult(`Preview opened: ${args.file_path}`);
        }
        if (PDF_EXTENSIONS.has(ext)) {
          let pages: string[];
          try {
            const stat = await fsPromises.stat(args.file_path);
            const cacheDir = cacheDirFor(args.file_path, stat);
            pages = await renderPdfToPages(args.file_path, cacheDir);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return textResult(`Cannot render PDF: ${msg}`, true);
          }
          sendToRenderer(IPC_CHANNELS.PREVIEW_OPEN_PDF, {
            pages,
            sourcePath: args.file_path,
            title: fileName,
          });
          return textResult(`Preview opened: ${args.file_path}`);
        }
        if (OFFICE_EXTENSIONS.has(ext)) {
          let pages: string[];
          try {
            const pdfPath = await getOrConvertPdf(args.file_path);
            pages = await renderPdfToPages(pdfPath, dirname(pdfPath));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return textResult(`Cannot convert to PDF: ${msg}`, true);
          }
          sendToRenderer(IPC_CHANNELS.PREVIEW_OPEN_PDF, {
            pages,
            sourcePath: args.file_path,
            title: fileName,
          });
          return textResult(`Preview opened: ${args.file_path}`);
        }
        let content: string;
        try {
          content = await fsPromises.readFile(args.file_path, "utf-8");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return textResult(`Cannot read file: ${msg}`, true);
        }
        const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
        sendToRenderer(
          IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
          isMarkdown
            ? { content, title: fileName }
            : { content, title: fileName, filePath: args.file_path },
        );
        return textResult(`Preview opened: ${args.file_path}`);
      },
    }),
    defineHandler({
      name: "preview_close",
      description: "Close the Stratos side preview pane.",
      inputSchema: {},
      handler: async () => {
        sendToRenderer(IPC_CHANNELS.PREVIEW_CLOSE, {});
        return textResult("Preview closed");
      },
    }),
  ];
}
