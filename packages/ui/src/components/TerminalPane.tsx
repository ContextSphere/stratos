import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "../context/ThemeContext";

interface TerminalPaneProps {
  cwd: string;
}

// window.api is provided by the Electron preload and typed in desktop's env.d.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (): any => (window as any).api;

interface Tab {
  id: string;
  title: string;
}

function makeTab(counter: number): Tab {
  return { id: `tab-${Date.now()}-${counter}`, title: `Terminal ${counter}` };
}

const darkTheme = {
  background: "#0d0d0d",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  selectionInactiveBackground: "#3a5f8a",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#4ec9b0",
  yellow: "#dcdcaa",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#4dc9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#4ec9b0",
  brightYellow: "#dcdcaa",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#4dc9b0",
  brightWhite: "#ffffff",
};

const lightTheme = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  // Explicit blue selection so text is visible against white background
  selectionBackground: "#add6ff",
  selectionInactiveBackground: "#c8dff7",
  black: "#1a1a1a",
  red: "#cd3131",
  green: "#008000",
  yellow: "#795e25",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#d4d4d4",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#008000",
  brightYellow: "#795e25",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#1a1a1a",
};

// A single xterm instance — hidden via CSS when not active so the PTY stays alive
interface TerminalInstanceProps {
  cwd: string;
  active: boolean;
  appTheme: "dark" | "light";
}

function TerminalInstance({
  cwd,
  active,
  appTheme,
}: TerminalInstanceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const cleanupDataListenerRef = useRef<(() => void) | null>(null);

  const xtermTheme = appTheme === "light" ? lightTheme : darkTheme;

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: xtermTheme,
      fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminal.focus();
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Register onData immediately (before terminalCreate resolves) so keystrokes
    // typed right after mount are not silently dropped. Uses ref so we don't
    // need to wait for the async id.
    terminal.onData((data: string) => {
      if (terminalIdRef.current) {
        api().terminalWrite(terminalIdRef.current, data);
      }
    });

    // Paste handler in capture phase — stopPropagation prevents xterm's own
    // textarea paste listener from also firing and writing to PTY a second time.
    // terminal.paste() handles bracketed-paste-mode wrapping automatically.
    const container = containerRef.current;
    const pasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) {
        terminal.paste(text);
      }
    };
    container.addEventListener("paste", pasteHandler, true);

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Cmd+C (or Ctrl+C on non-Mac) with selection → copy, don't send SIGINT
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "c" &&
        terminal.hasSelection()
      ) {
        if (e.type === "keydown") {
          navigator.clipboard.writeText(terminal.getSelection());
        }
        return false;
      }
      // Cmd+V (or Ctrl+V) → handled by the paste event above, not as a keypress
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        return false;
      }
      return true;
    });

    api()
      .terminalCreate(cwd)
      .then((id: string) => {
        terminalIdRef.current = id;

        const cleanup = api().onTerminalData((dataId: string, data: string) => {
          if (dataId === id) terminal.write(data);
        });
        cleanupDataListenerRef.current = cleanup;
      });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (terminalIdRef.current) {
        api().terminalResize(
          terminalIdRef.current,
          terminal.cols,
          terminal.rows,
        );
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("paste", pasteHandler, true);
      cleanupDataListenerRef.current?.();
      if (terminalIdRef.current) api().terminalDestroy(terminalIdRef.current);
      terminal.dispose();
    };
  }, [cwd]);

  // Update theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  // Re-fit and re-focus when becoming visible
  useEffect(() => {
    if (active && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
        if (terminalIdRef.current) {
          api().terminalResize(
            terminalIdRef.current,
            terminalRef.current!.cols,
            terminalRef.current!.rows,
          );
        }
      }, 0);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 p-1"
      style={{
        background: xtermTheme.background,
        display: active ? "block" : "none",
      }}
      onClick={() => terminalRef.current?.focus()}
    />
  );
}

export function TerminalPane({ cwd }: TerminalPaneProps): React.ReactElement {
  const appTheme = useTheme();
  const counterRef = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab(1)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

  const addTab = useCallback(() => {
    counterRef.current += 1;
    const tab = makeTab(counterRef.current);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) return prev; // keep at least one
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)]">
      {/* Tab bar */}
      <div className="flex items-center flex-shrink-0 overflow-x-auto bg-[var(--bg-surface)] border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer flex-shrink-0 border-r border-[var(--border)] select-none ${
              activeTabId === tab.id
                ? "bg-[var(--bg-main)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            }`}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="opacity-50 hover:opacity-100 transition-opacity leading-none"
              >
                <svg
                  className="w-2.5 h-2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="px-2.5 py-1.5 flex-shrink-0 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title="New terminal tab"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>

      {/* Terminal instances — all mounted, only active one visible */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.id}
            cwd={cwd}
            active={tab.id === activeTabId}
            appTheme={appTheme}
          />
        ))}
      </div>
    </div>
  );
}
