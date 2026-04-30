import { useEffect, useRef, useState } from "react";
import { useTelegramBridge } from "../bridges/StratosProvider";
import type { TelegramStatus } from "../bridges/types";

const TG_BLUE = "#229ED9";
const TG_BLUE_DARK = "#1B7CB3";

const CHAT_ID_RE = /^-?\d{5,}$/;
const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

function isValidChatId(v: string): boolean {
  return CHAT_ID_RE.test(v.trim());
}

function isValidToken(v: string): boolean {
  return BOT_TOKEN_RE.test(v.trim());
}

function TgIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="20" fill={TG_BLUE} />
      <path
        fill="#fff"
        d="M28.51 12.05L25.6 27.1c-.22 1-.81 1.24-1.64.77l-4.53-3.34-2.19 2.1c-.24.24-.45.45-.92.45l.33-4.66 8.48-7.66c.37-.32-.08-.51-.57-.18l-10.48 6.6-4.52-1.41c-.98-.31-1-.98.21-1.45l17.66-6.81c.82-.3 1.54.19 1.27 1.45z"
      />
    </svg>
  );
}

function ConnectedPanel({
  onDisconnect,
  busy,
}: {
  onDisconnect: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="rounded-xl flex items-center gap-4"
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${TG_BLUE}33`,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: `${TG_BLUE}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <TgIcon size={28} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-semibold text-sm" style={{ color: "var(--text)" }}>
          Telegram Connected
        </div>
        <div className="text-xs" style={{ color: TG_BLUE, marginTop: 2 }}>
          ● Active
        </div>
      </div>
      <button
        onClick={onDisconnect}
        disabled={busy}
        className="text-sm font-medium rounded-lg px-3 py-1.5"
        style={{
          background: "#ef444422",
          color: "#ef4444",
          border: "1px solid #ef444433",
          opacity: busy ? 0.5 : 1,
          cursor: busy ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        {busy ? "…" : "Disconnect"}
      </button>
    </div>
  );
}

function DisconnectedPanel({
  onConnect,
  busy,
  status,
  canConnect,
}: {
  onConnect: () => void;
  busy: boolean;
  status: TelegramStatus;
  canConnect: boolean;
}) {
  const subtitle =
    status === "error"
      ? "Connection failed — check the bot token below."
      : status === "connecting"
        ? "Connecting…"
        : canConnect
          ? "Message your Stratos Manager directly from Telegram."
          : "Paste a bot token below, then connect.";

  return (
    <div
      className="rounded-xl flex flex-col items-center text-center"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        padding: "28px 24px",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: `${TG_BLUE}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <TgIcon size={36} />
      </div>
      <div>
        <div
          className="font-semibold"
          style={{ fontSize: 15, color: "var(--text)" }}
        >
          Connect Telegram
        </div>
        <div
          className="text-xs"
          style={{
            color: status === "error" ? "#ef4444" : "var(--text-muted)",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </div>
      </div>
      <button
        onClick={onConnect}
        disabled={busy || !canConnect || status === "connecting"}
        className="rounded-xl text-sm font-semibold px-6 py-2.5"
        style={{
          background:
            busy || !canConnect
              ? "var(--text-muted)"
              : `linear-gradient(135deg, ${TG_BLUE}, ${TG_BLUE_DARK})`,
          color: "#fff",
          opacity: busy || !canConnect ? 0.6 : 1,
          cursor: busy || !canConnect ? "not-allowed" : "pointer",
          border: "none",
          marginTop: 4,
          boxShadow: busy || !canConnect ? "none" : `0 2px 12px ${TG_BLUE}44`,
        }}
      >
        {busy || status === "connecting" ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

function BotTokenEditor({
  isSet,
  onSave,
}: {
  isSet: boolean;
  onSave: (token: string) => void;
}) {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const val = input.trim();
    if (!val) {
      onSave("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return;
    }
    if (!isValidToken(val)) {
      setInputError("Token format: 123456789:ABCdef…");
      return;
    }
    setInputError(null);
    onSave(val);
    setInput("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      setInput("");
      setInputError(null);
    }
  }

  function handleInputChange(val: string) {
    setInput(val);
    if (val.trim() && !isValidToken(val)) {
      setInputError("Token format: 123456789:ABCdef…");
    } else {
      setInputError(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Bot Token
        {isSet && (
          <span
            style={{
              marginLeft: 8,
              color: TG_BLUE,
              textTransform: "none",
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            ● set
          </span>
        )}
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="password"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isSet ? "•••••• (replace existing)" : "123456789:ABCdef…"
          }
          autoComplete="off"
          spellCheck={false}
          className="text-sm font-mono rounded-lg px-3"
          style={{
            flex: 1,
            height: 34,
            background: "var(--bg-root)",
            border: `1px solid ${inputError ? "#ef4444" : "var(--border)"}`,
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          onClick={handleSave}
          disabled={input.trim().length === 0 && !saved}
          className="text-sm font-semibold rounded-lg px-3"
          style={{
            background: saved
              ? "#22c55e"
              : input.trim()
                ? TG_BLUE
                : "var(--bg-root)",
            color: saved || input.trim() ? "#fff" : "var(--text-muted)",
            border: `1px solid ${
              saved ? "#22c55e" : input.trim() ? TG_BLUE : "var(--border)"
            }`,
            cursor: input.trim() ? "pointer" : "default",
            height: 34,
            flexShrink: 0,
            transition: "background 0.2s, color 0.2s",
          }}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {inputError ? (
        <span className="text-xs" style={{ color: "#ef4444" }}>
          {inputError}
        </span>
      ) : (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Get one from @BotFather. Saving a new token replaces the existing one.
        </span>
      )}
    </div>
  );
}

function ChatIdEditor({
  chatId,
  onSave,
}: {
  chatId: string;
  onSave: (id: string) => void;
}) {
  const [input, setInput] = useState(chatId);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(chatId);
  }, [chatId]);

  function handleSave() {
    const val = input.trim();
    if (!val) {
      onSave("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return;
    }
    if (!isValidChatId(val)) {
      setInputError("Numeric chat ID, e.g. 123456789");
      return;
    }
    setInputError(null);
    onSave(val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      setInput(chatId);
      setInputError(null);
    }
  }

  function handleInputChange(val: string) {
    setInput(val);
    if (val.trim() && !isValidChatId(val)) {
      setInputError("Numeric chat ID, e.g. 123456789");
    } else {
      setInputError(null);
    }
  }

  const isDirty = input.trim() !== chatId.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        Trusted Chat ID
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="123456789"
          inputMode="numeric"
          className="text-sm font-mono rounded-lg px-3"
          style={{
            flex: 1,
            height: 34,
            background: "var(--bg-root)",
            border: `1px solid ${inputError ? "#ef4444" : "var(--border)"}`,
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          onClick={handleSave}
          disabled={!isDirty && !saved}
          className="text-sm font-semibold rounded-lg px-3"
          style={{
            background: saved
              ? "#22c55e"
              : isDirty
                ? TG_BLUE
                : "var(--bg-root)",
            color: saved || isDirty ? "#fff" : "var(--text-muted)",
            border: `1px solid ${
              saved ? "#22c55e" : isDirty ? TG_BLUE : "var(--border)"
            }`,
            cursor: isDirty ? "pointer" : "default",
            height: 34,
            flexShrink: 0,
            transition: "background 0.2s, color 0.2s",
          }}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {inputError ? (
        <span className="text-xs" style={{ color: "#ef4444" }}>
          {inputError}
        </span>
      ) : (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Only messages from this chat are forwarded. Send /start to your bot,
          then check the gateway log to find your chat ID.
        </span>
      )}
    </div>
  );
}

export function TelegramSettings(): React.ReactElement {
  const bridge = useTelegramBridge();
  const [status, setStatus] = useState<TelegramStatus>("disconnected");
  const [botTokenSet, setBotTokenSet] = useState(false);
  const [trustedChatId, setTrustedChatId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    bridge.getState().then((s) => {
      setStatus(s.status);
      setBotTokenSet(s.botTokenSet);
      setTrustedChatId(s.trustedChatId);
    });
    const unStatus = bridge.onStatus(setStatus);
    return () => {
      unStatus();
    };
  }, [bridge]);

  if (!bridge)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Telegram gateway not available.
      </p>
    );

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge!.connect();
      if (!result.ok) setError(result.error ?? "Failed to connect");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await bridge!.disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTokenSave(token: string) {
    await bridge!.saveSettings({ botToken: token }).catch(console.error);
    setBotTokenSet(Boolean(token));
  }

  async function handleChatIdSave(chatId: string) {
    setTrustedChatId(chatId);
    await bridge!.saveSettings({ trustedChatId: chatId }).catch(console.error);
  }

  const canConnect = botTokenSet;

  return (
    <div className="space-y-4">
      {status === "connected" ? (
        <ConnectedPanel onDisconnect={handleDisconnect} busy={busy} />
      ) : (
        <DisconnectedPanel
          onConnect={handleConnect}
          busy={busy}
          status={status}
          canConnect={canConnect}
        />
      )}

      {error && (
        <div
          className="text-xs rounded-xl px-4 py-3"
          style={{
            background: "#3b000088",
            color: "#fca5a5",
            border: "1px solid #ef444444",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="rounded-xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <BotTokenEditor isSet={botTokenSet} onSave={handleTokenSave} />
        <ChatIdEditor chatId={trustedChatId} onSave={handleChatIdSave} />
      </div>
    </div>
  );
}
