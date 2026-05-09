import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWhatsAppBridge } from "../bridges/StratosProvider";
import type { WhatsAppStatus, ScheduleNotifyMode } from "../bridges/types";

const WA_GREEN = "#25D366";
const WA_GREEN_DARK = "#128C7E";

const E164_RE = /^\+[1-9]\d{7,14}$/;
const LID_RE = /^\d+@lid$/;

function isValidPhone(v: string): boolean {
  const t = v.trim();
  return E164_RE.test(t) || LID_RE.test(t);
}

function WaIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="20" fill={WA_GREEN} />
      <path
        fill="#fff"
        d="M20 8C13.373 8 8 13.373 8 20c0 2.16.578 4.184 1.589 5.924L8 32l6.076-1.589A11.947 11.947 0 0020 32c6.627 0 12-5.373 12-12S26.627 8 20 8zm6.13 16.54c-.264.742-1.557 1.457-2.142 1.517-.548.055-1.062.276-3.58-.745-3.026-1.252-4.964-4.305-5.114-4.503-.15-.199-1.214-1.614-1.214-3.079 0-1.464.765-2.182 1.04-2.481a1.1 1.1 0 01.795-.33c.198 0 .396 0 .57.01.198.011.462-.075.72.548.265.638.897 2.198.975 2.358.079.16.132.348.026.547-.105.199-.158.32-.314.5-.157.178-.33.397-.473.534-.157.149-.32.31-.138.609.183.298.814 1.343 1.747 2.175 1.2.944 2.212 1.237 2.513 1.382.3.145.475.12.65-.073.175-.194.749-.876.95-1.177.2-.3.397-.25.668-.15.27.1 1.718.81 2.013.958.295.148.492.222.566.347.074.124.074.715-.19 1.453z"
      />
    </svg>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: WA_GREEN,
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      {n}
    </span>
  );
}

function QrPanel({
  qrUrl,
  onCancel,
  busy,
}: {
  qrUrl: string | null;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col items-center" style={{ gap: 20 }}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <div
          style={{
            width: 220,
            height: 220,
            background: "#fff",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
          }}
        >
          {qrUrl ? (
            <img
              src={qrUrl}
              alt="WhatsApp QR code"
              style={{ width: 200, height: 200, imageRendering: "pixelated" }}
            />
          ) : (
            <div
              style={{
                width: 200,
                height: 200,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  border: `3px solid ${WA_GREEN}`,
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "wa-spin 0.8s linear infinite",
                }}
              />
              <span style={{ fontSize: 12, color: "#666" }}>Generating…</span>
            </div>
          )}
        </div>
        {qrUrl && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#fff",
              borderRadius: "50%",
              padding: 4,
              boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
            }}
          >
            <WaIcon size={36} />
          </div>
        )}
      </div>

      <div className="text-center" style={{ gap: 6 }}>
        <h2
          className="font-bold"
          style={{ fontSize: 20, color: "var(--text)", margin: 0 }}
        >
          Log into WhatsApp
        </h2>
        <p
          className="text-sm"
          style={{ color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}
        >
          Scan the QR code to link Stratos to your WhatsApp account.
        </p>
      </div>

      <div
        className="w-full rounded-xl"
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {[
          <>
            Open <strong>WhatsApp</strong> on your phone
          </>,
          <>
            On iPhone tap <strong>Settings</strong> · On Android tap{" "}
            <strong>Menu ⋮</strong>
          </>,
          <>
            Tap <strong>Linked devices</strong> then{" "}
            <strong>Link a device</strong>
          </>,
          <>Point your phone at this screen to scan the QR code</>,
          <>Keep both apps open while your chats load</>,
        ].map((step, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
          >
            <StepNumber n={i + 1} />
            <span
              className="text-sm"
              style={{ color: "var(--text)", lineHeight: 1.5 }}
            >
              {step}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onCancel}
        disabled={busy}
        className="text-sm"
        style={{
          color: "var(--text-muted)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 6,
          opacity: busy ? 0.5 : 1,
        }}
      >
        Cancel
      </button>

      <style>{`@keyframes wa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
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
        border: `1px solid ${WA_GREEN}33`,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: `${WA_GREEN}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <WaIcon size={28} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-semibold text-sm" style={{ color: "var(--text)" }}>
          WhatsApp Connected
        </div>
        <div className="text-xs" style={{ color: WA_GREEN, marginTop: 2 }}>
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
}: {
  onConnect: () => void;
  busy: boolean;
}) {
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
          background: `${WA_GREEN}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WaIcon size={36} />
      </div>
      <div>
        <div
          className="font-semibold"
          style={{ fontSize: 15, color: "var(--text)" }}
        >
          Connect WhatsApp
        </div>
        <div
          className="text-xs"
          style={{ color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}
        >
          Message your Stratos Manager directly from WhatsApp.
        </div>
      </div>
      <button
        onClick={onConnect}
        disabled={busy}
        className="rounded-xl text-sm font-semibold px-6 py-2.5"
        style={{
          background: busy
            ? "var(--text-muted)"
            : `linear-gradient(135deg, ${WA_GREEN}, ${WA_GREEN_DARK})`,
          color: "#fff",
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "not-allowed" : "pointer",
          border: "none",
          marginTop: 4,
          boxShadow: busy ? "none" : `0 2px 12px ${WA_GREEN}44`,
        }}
      >
        {busy ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

function TrustedPhoneEditor({
  phone,
  onSave,
}: {
  phone: string;
  onSave: (phone: string) => void;
}) {
  const [input, setInput] = useState(phone);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local input in sync when parent state changes (e.g. on mount)
  useEffect(() => {
    setInput(phone);
  }, [phone]);

  function handleSave() {
    const val = input.trim();
    if (!val) {
      // Allow clearing
      onSave("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return;
    }
    if (!isValidPhone(val)) {
      setInputError("Enter a valid E.164 phone (+15551234567) or WhatsApp LID");
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
      setInput(phone);
      setInputError(null);
    }
  }

  function handleInputChange(val: string) {
    setInput(val);
    if (val.trim() && !isValidPhone(val)) {
      setInputError("E.164 phone (+15551234567) or WhatsApp LID (123456@lid)");
    } else {
      setInputError(null);
    }
  }

  const isDirty = input.trim() !== phone.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          ref={inputRef}
          type="tel"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="+15551234567"
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
                ? WA_GREEN
                : "var(--bg-root)",
            color: saved || isDirty ? "#fff" : "var(--text-muted)",
            border: `1px solid ${saved ? "#22c55e" : isDirty ? WA_GREEN : "var(--border)"}`,
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
          Only messages from this number will be forwarded to the Manager.
        </span>
      )}
    </div>
  );
}

export function WhatsAppSettings(): React.ReactElement {
  const bridge = useWhatsAppBridge();
  const [status, setStatus] = useState<WhatsAppStatus>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [trustedPhone, setTrustedPhone] = useState<string>("");
  const [notifyMode, setNotifyMode] =
    useState<ScheduleNotifyMode>("errors-only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    bridge.getState().then((s) => {
      setStatus(s.status);
      setQr(s.qr);
      setTrustedPhone(s.trustedPhone);
      setNotifyMode(s.notifySchedules ?? "errors-only");
    });
    const unStatus = bridge.onStatus(setStatus);
    const unQr = bridge.onQr((q) => setQr(q));
    return () => {
      unStatus();
      unQr();
    };
  }, [bridge]);

  useEffect(() => {
    if (!qr) {
      setQrUrl(null);
      return;
    }
    QRCode.toDataURL(qr, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#000", light: "#fff" },
    })
      .then(setQrUrl)
      .catch(console.error);
  }, [qr]);

  if (!bridge)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        WhatsApp gateway not available.
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

  async function handleTrustedPhoneSave(phone: string) {
    setTrustedPhone(phone);
    await bridge!.saveSettings({ trustedPhone: phone }).catch(console.error);
  }

  async function handleNotifyModeChange(mode: ScheduleNotifyMode) {
    setNotifyMode(mode);
    await bridge!.saveSettings({ notifySchedules: mode }).catch(console.error);
  }

  return (
    <div className="space-y-4">
      {status === "qr" ? (
        <QrPanel qrUrl={qrUrl} onCancel={handleDisconnect} busy={busy} />
      ) : status === "connected" ? (
        <ConnectedPanel onDisconnect={handleDisconnect} busy={busy} />
      ) : (
        <DisconnectedPanel onConnect={handleConnect} busy={busy} />
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

      {/* Trusted phone */}
      <div
        className="rounded-xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Trusted Number
        </label>

        <TrustedPhoneEditor
          phone={trustedPhone}
          onSave={handleTrustedPhoneSave}
        />
      </div>

      {/* Schedule notification default */}
      <div
        className="rounded-xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Schedule notifications
        </label>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          When a scheduled prompt finishes, the Manager wakes up and pings you
          on WhatsApp. Reply on WhatsApp to ask follow-ups. Per-schedule
          settings override this default.
        </p>
        <div className="flex flex-col gap-1.5">
          {(
            [
              ["always", "Always — every run"],
              ["errors-only", "Errors only — only failures"],
              ["never", "Never — silent"],
            ] as Array<[ScheduleNotifyMode, string]>
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-2 cursor-pointer text-sm"
              style={{ color: "var(--text)" }}
            >
              <input
                type="radio"
                name="notify-schedules"
                value={value}
                checked={notifyMode === value}
                onChange={() => handleNotifyModeChange(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
