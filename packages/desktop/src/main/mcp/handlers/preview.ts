/**
 * Preview handler definitions — 2 tools for controlling the Stratos side preview pane.
 */
import { z } from "zod";
import { promises as fsPromises } from "fs";
import { basename, extname } from "path";
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

export interface PreviewDeps {
  sendToRenderer: (channel: string, data: unknown) => void;
}

export function createPreviewHandlers(deps: PreviewDeps): HandlerDef[] {
  const { sendToRenderer } = deps;
  return [
    defineHandler({
      name: "preview_open_file",
      description:
        "Open a file in the Stratos side preview pane. Markdown files (.md, .markdown) are rendered as formatted text; all other files open in a code editor. Always use absolute file paths.",
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
          sendToRenderer(IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN, {
            content: "",
            title: fileName,
            filePath: args.file_path,
            isImage: true,
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
