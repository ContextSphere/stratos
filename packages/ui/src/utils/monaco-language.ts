/**
 * Get Monaco language identifier from file path extension
 * @param filePath - The file path to analyze
 * @returns Monaco language string (e.g., 'typescript', 'python', 'markdown')
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    yml: "yaml",
    yaml: "yaml",
    xml: "xml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    toml: "ini",
    env: "ini",
    txt: "plaintext",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    cs: "csharp",
    r: "r",
    dart: "dart",
    lua: "lua",
    dockerfile: "dockerfile",
  };
  return map[ext] || "plaintext";
}

/**
 * Check if a file is likely binary based on its extension
 * @param filePath - The file path to check
 * @returns true if the file is likely binary
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const binaryExts = new Set([
    // Images
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "ico",
    "svg",
    "webp",
    "tiff",
    "tif",
    // Documents
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    // Archives
    "zip",
    "tar",
    "gz",
    "bz2",
    "rar",
    "7z",
    "xz",
    // Executables
    "exe",
    "dll",
    "so",
    "dylib",
    "app",
    // Fonts
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    // Media
    "mp3",
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "wav",
    "ogg",
    // Other
    "bin",
    "dat",
    "db",
    "sqlite",
  ]);
  return binaryExts.has(ext);
}

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tiff",
  "tif",
]);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

/** Try to extract a data: URL from a Claude SDK tool-result output for an image Read. */
export function extractImageDataUrl(output: string): string | null {
  try {
    const parsed = JSON.parse(output);
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    for (const block of blocks) {
      if (block?.type === "image" && block?.source?.type === "base64") {
        return `data:${block.source.media_type};base64,${block.source.data}`;
      }
    }
  } catch {
    // not JSON — ignore
  }
  return null;
}

/**
 * Count lines in content string
 * @param content - The content to count lines in
 * @returns Number of lines
 */
export function countLines(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}

/**
 * Calculate appropriate editor height based on content
 * @param content - The content to display
 * @param maxLines - Maximum number of lines to show (default 30)
 * @param lineHeight - Height per line in pixels (default 18)
 * @returns Height in pixels
 */
export function calculateEditorHeight(
  content: string,
  maxLines: number = 30,
  lineHeight: number = 18,
): number {
  const lines = countLines(content);
  const clampedLines = Math.min(lines, maxLines);
  const padding = 40; // Top and bottom padding
  return clampedLines * lineHeight + padding;
}

/**
 * Extract file name from file path
 * @param filePath - Full file path
 * @returns File name with extension
 */
export function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

/** Monospace font stack used across all Monaco editor instances. */
export const MONO_FONT_FAMILY =
  "'DM Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";
