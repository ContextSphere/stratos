import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWhatsAppBridge } from "../bridges/StratosProvider";
import type { WhatsAppStatus } from "../bridges/types";

function StatusDot({ status }: { status: WhatsAppStatus }) {
  const color =
    status === "connected"
      ? "#22c55e"
      : status === "qr"
        ? "#eab308"
        : "var(--text-muted)";
  const glow = status === "connected" ? "0 0 6px #22c55e" : undefined;
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: glow,
        flexShrink: 0,
      }}
    />
  );
}

function statusLabel(s: WhatsAppStatus) {
  if (s === "connected") return "Connected";
  if (s === "qr") return "Scan QR to connect";
  return "Disconnected";
}

export function WhatsAppSettings(): React.ReactElement {
  const bridge = useWhatsAppBridge();
  const [status, setStatus] = useState<WhatsAppStatus>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [allowInput, setAllowInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!bridge) return;
    bridge.getState().then((s) => {
      setStatus(s.status);
      setQr(s.qr);
      setAllowInput(s.allowList.join("\n"));
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
    QRCode.toDataURL(qr, { width: 180, margin: 1 })
      .then(setQrUrl)
      .catch(console.error);
  }, [qr]);

  if (!bridge)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        WhatsApp gateway not available.
      </p>
    );

  async function handleToggle() {
    setBusy(true);
    setError(null);
    try {
      if (status === "connected" || status === "qr") {
        await bridge!.disconnect();
      } else {
        const result = await bridge!.connect();
        if (!result.ok) setError(result.error ?? "Failed to connect");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const list = allowInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await bridge!.saveSettings({ allowList: list });
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  const isActive = status === "connected" || status === "qr";

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-sm font-medium">{statusLabel(status)}</span>
        </div>
        <button
          onClick={handleToggle}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: isActive
              ? "var(--red, #ef4444)"
              : "var(--green, #22c55e)",
            color: "#fff",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "…" : isActive ? "Disconnect" : "Connect"}
        </button>
      </div>

      {error && (
        <p
          className="text-xs rounded-lg px-3 py-2"
          style={{
            background: "#3b0000",
            color: "#fca5a5",
            border: "1px solid #ef4444",
          }}
        >
          {error}
        </p>
      )}

      {/* QR code */}
      {qrUrl && (
        <div
          className="flex flex-col items-center gap-2 rounded-xl p-4"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
          }}
        >
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Open WhatsApp → Linked Devices → Link a Device
          </p>
          <img
            src={qrUrl}
            alt="WhatsApp QR"
            style={{
              width: 160,
              height: 160,
              imageRendering: "pixelated",
              background: "#fff",
              borderRadius: 8,
              padding: 4,
            }}
          />
        </div>
      )}

      {/* Allow list */}
      <div className="space-y-1.5">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Allow List
        </label>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          One E.164 phone number per line (e.g. +15551234567). Use{" "}
          <code>*</code> to allow everyone.
        </p>
        <textarea
          value={allowInput}
          onChange={(e) => setAllowInput(e.target.value)}
          rows={4}
          className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-none"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            outline: "none",
          }}
          placeholder={"+15551234567\n+447911123456"}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: "var(--blue, #3b82f6)", color: "#fff" }}
        >
          Save
        </button>
        {saved && (
          <span className="text-xs" style={{ color: "var(--green, #22c55e)" }}>
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
