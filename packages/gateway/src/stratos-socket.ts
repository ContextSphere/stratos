import net from "net";
import readline from "readline";
import { readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function discoverSockPath(): string | undefined {
  try {
    const files = readdirSync(join(homedir(), ".stratos"));
    const sock = files.find((f) => f.startsWith("mcp-") && f.endsWith(".sock"));
    return sock ? join(homedir(), ".stratos", sock) : undefined;
  } catch {
    return undefined;
  }
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { message: string; code: number };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class StratosSocket {
  private sock: net.Socket | null = null;
  private rl: readline.Interface | null = null;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private idCounter = 1;
  private initialized = false;
  private sockPath: string | undefined;

  constructor(sockPath?: string) {
    this.sockPath = sockPath;
  }

  private _openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.sockPath!);
      this.sock = sock;
      const rl = readline.createInterface({ input: sock, crlfDelay: Infinity });
      this.rl = rl;
      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line) as RpcResponse;
          if (msg.id === undefined) return;
          const pending = this.pending.get(msg.id);
          if (!pending) return;
          this.pending.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error)
            pending.reject(new Error(msg.error.message || "RPC error"));
          else pending.resolve(msg.result);
        } catch {
          /* malformed */
        }
      });
      sock.once("connect", resolve);
      sock.once("error", reject);
      sock.on("close", () => {
        this.initialized = false;
        this.sock = null;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("Stratos socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  private async _initialize(): Promise<void> {
    await this._call("initialize", {});
    this.sock!.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    this.initialized = true;
  }

  private _call<T>(
    method: string,
    params: object,
    timeoutMs = 10_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.sock || this.sock.destroyed) {
        reject(new Error("Not connected to Stratos"));
        return;
      }
      const id = this.idCounter++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.sock.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  async managerPost(message: string, callbackUrl: string): Promise<void> {
    if (!this.initialized) await this.ensureConnected();
    const result = await this._call<ToolCallResult>(
      "tools/call",
      { name: "manager_post", arguments: { message, callbackUrl } },
      10_000,
    );
    if (result.isError) {
      const text = result.content
        .map((c) => c.text)
        .join("")
        .trim();
      throw new Error(text || "Manager returned an error");
    }
  }

  async ensureConnected(): Promise<void> {
    if (!this.sock || this.sock.destroyed || !this.initialized) {
      if (!this.sockPath) {
        const found = discoverSockPath();
        if (!found) throw new Error("Stratos is not running — start it first");
        this.sockPath = found;
      }
      await this._openSocket();
      await this._initialize();
    }
  }

  close(): void {
    this.sock?.destroy();
    this.sock = null;
    this.initialized = false;
  }
}
