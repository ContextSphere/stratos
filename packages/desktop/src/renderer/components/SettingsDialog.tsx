import { useState, useEffect } from "react";
import {
  Dialog,
  DialogBody,
  Button,
  WhatsAppSettings,
  TelegramSettings,
} from "@stratosapp/ui";
import type { ElectronAPI } from "../../preload/index";

declare const window: Window & typeof globalThis & { api: ElectronAPI };

type AppTheme = "dark" | "light";

interface ThemeOption {
  id: AppTheme;
  label: string;
  preview: { bg: string; surface: string; border: string; text: string };
}

const THEMES: ThemeOption[] = [
  {
    id: "dark",
    label: "Dark",
    preview: {
      bg: "var(--bg-root)",
      surface: "var(--bg-surface)",
      border: "var(--border)",
      text: "#e0e0e0",
    },
  },
  {
    id: "light",
    label: "Light",
    preview: {
      bg: "#ececec",
      surface: "#ffffff",
      border: "#d0d0d0",
      text: "var(--bg-surface)",
    },
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  theme,
  onThemeChange,
}: Props): React.ReactElement | null {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  useEffect(() => {
    window.api.whatsapp.isEnabled().then(setWhatsappEnabled);
    window.api.telegram.isEnabled().then(setTelegramEnabled);
  }, []);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Settings"
      icon={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-4 h-4 text-white"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      }
      iconGradient="from-gray-500 to-gray-700"
      maxWidth="lg"
    >
      <DialogBody>
        <div className="space-y-6">
          {/* Appearance */}
          <section>
            <h3
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}
            >
              Appearance
            </h3>
            <div className="flex gap-3">
              {THEMES.map((t) => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onThemeChange(t.id)}
                    className={`relative flex flex-col items-center gap-2 rounded-xl p-1 transition-all focus:outline-none ${
                      active
                        ? "ring-2 ring-blue-500"
                        : "ring-1 ring-transparent hover:ring-gray-600"
                    }`}
                  >
                    {/* Mini preview */}
                    <div
                      className="w-24 h-16 rounded-lg overflow-hidden flex"
                      style={{
                        background: t.preview.bg,
                        border: `1px solid ${t.preview.border}`,
                      }}
                    >
                      {/* Sidebar strip */}
                      <div
                        className="w-5 h-full flex-shrink-0"
                        style={{
                          background: t.preview.bg,
                          borderRight: `1px solid ${t.preview.border}`,
                        }}
                      />
                      {/* Content area */}
                      <div className="flex-1 p-1.5 flex flex-col gap-1">
                        <div
                          className="h-1.5 w-8 rounded-full"
                          style={{ background: t.preview.surface }}
                        />
                        <div
                          className="h-1 w-10 rounded-full"
                          style={{
                            background: t.preview.surface,
                            opacity: 0.6,
                          }}
                        />
                        <div className="flex-1" />
                        <div
                          className="h-3 rounded"
                          style={{
                            background: t.preview.surface,
                            border: `1px solid ${t.preview.border}`,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className="text-xs font-medium"
                      style={{
                        color: active ? "#3b82f6" : "var(--text-secondary)",
                      }}
                    >
                      {t.label}
                    </span>
                    {active && (
                      <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center">
                        <svg
                          viewBox="0 0 8 8"
                          className="w-2 h-2 text-white"
                          fill="currentColor"
                        >
                          <path
                            d="M1.5 4l2 2L6.5 2"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* WhatsApp — only shown when ~/.stratos/whatsapp.json exists */}
          {whatsappEnabled && (
            <section>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                WhatsApp
              </h3>
              <WhatsAppSettings />
            </section>
          )}

          {/* Telegram — only shown when ~/.stratos/telegram.json exists */}
          {telegramEnabled && (
            <section>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Telegram
              </h3>
              <TelegramSettings />
            </section>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}
