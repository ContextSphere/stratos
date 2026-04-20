import net from "net";
import {
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from "fs";
import { promises as fsPromises } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../common/ipc-channels";
import { PREVIEW_MCP_SOURCE } from "./preview-mcp-source";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

export function getPreviewMcpPath(): string {
  return join(homedir(), ".stratos", "bin", "stratos-preview-mcp");
}

export function getPreviewSocketPath(instanceHash: string): string {
  return join(homedir(), ".stratos", `preview-${instanceHash}.sock`);
}

export function installPreviewMcp(): void {
  const binDir = join(homedir(), ".stratos", "bin");
  if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });
  writeFileSync(getPreviewMcpPath(), PREVIEW_MCP_SOURCE, "utf-8");
  chmodSync(getPreviewMcpPath(), 0o755);
}

type SendToRenderer = (channel: string, data: unknown) => void;

export function startPreviewSocketServer(
  socketPath: string,
  sendToRenderer: SendToRenderer,
): net.Server {
  try {
    unlinkSync(socketPath);
  } catch {}

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handlePreviewCommand(line, socket, sendToRenderer).catch(() => {
        replySocket(socket, { ok: false, error: "Internal error" });
      });
    });
    socket.on("error", () => {});
  });

  server.listen(socketPath, () => {
    console.log(`[preview-mcp] Socket listening at ${socketPath}`);
  });

  server.on("error", (err) => {
    console.error("[preview-mcp] Socket server error:", err);
  });

  return server;
}

function replySocket(
  socket: net.Socket,
  result: { ok: boolean; error?: string },
): void {
  try {
    socket.write(JSON.stringify(result) + "\n");
    socket.end();
  } catch {}
}

async function handlePreviewCommand(
  line: string,
  socket: net.Socket,
  sendToRenderer: SendToRenderer,
): Promise<void> {
  let cmd: { command: string; path?: string; title?: string };
  try {
    cmd = JSON.parse(line);
  } catch {
    replySocket(socket, { ok: false, error: "Invalid JSON" });
    return;
  }

  if (cmd.command === "close") {
    sendToRenderer(IPC_CHANNELS.PREVIEW_CLOSE, {});
    replySocket(socket, { ok: true });
    return;
  }

  if (cmd.command === "open") {
    const filePath = cmd.path;
    if (!filePath) {
      replySocket(socket, { ok: false, error: "path is required" });
      return;
    }

    let content: string;
    try {
      content = await fsPromises.readFile(filePath, "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      replySocket(socket, { ok: false, error: `Cannot read file: ${msg}` });
      return;
    }

    const fileName = cmd.title ?? basename(filePath);
    const ext = extname(filePath).toLowerCase();
    const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);

    sendToRenderer(
      IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
      isMarkdown
        ? { content, title: fileName }
        : { content, title: fileName, filePath },
    );

    replySocket(socket, { ok: true });
    return;
  }

  replySocket(socket, { ok: false, error: `Unknown command: ${cmd.command}` });
}
