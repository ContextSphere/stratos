import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PanelCard } from "./shared/PanelCard";
import type { McpServerInfo } from "../bridges/types";

interface MCPServer {
  name: string;
  displayName: string;
  tools: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionTools: string[];
  mcpServers?: McpServerInfo[];
  onToggleServer?: (serverName: string, enabled: boolean) => void;
  onOpenConfig?: (configPath: string) => void;
  onReconnectServer?: (serverName: string) => void;
}

const SCOPE_LABELS: Record<string, string> = {
  project: "project",
  user: "user",
  local: "local",
  claudeai: "claude.ai",
  managed: "managed",
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-emerald-500/70",
  failed: "bg-red-500/70",
  "needs-auth": "bg-yellow-500/70",
  pending: "bg-yellow-500/70",
  disabled: "bg-[var(--text-faint)]",
};

function shortenPath(configPath: string): string {
  const home = typeof window !== "undefined" ? "" : "";
  if (configPath.startsWith("/Users/")) {
    const parts = configPath.split("/");
    // /Users/username/... -> ~/.../
    return "~/" + parts.slice(3).join("/");
  }
  return configPath;
}

export function ToolsPopover({
  isOpen,
  onClose,
  sessionTools,
  mcpServers,
  onToggleServer,
  onOpenConfig,
  onReconnectServer,
}: Props): React.ReactElement | null {
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Build server list from mcpServers if available, otherwise parse from tool names
  const servers = useMemo<
    (MCPServer & {
      status?: string;
      scope?: string;
      configPath?: string;
      configType?: string;
    })[]
  >(() => {
    if (mcpServers && mcpServers.length > 0) {
      return mcpServers
        .map((s) => ({
          name: s.name,
          displayName: s.name
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          tools: s.tools,
          status: s.status,
          scope: s.scope,
          configPath: s.configPath,
          configType: s.configType,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    // Fallback: parse from sessionTools
    const mcpTools = sessionTools.filter((tool) => tool.startsWith("mcp__"));
    const serverMap = new Map<string, string[]>();
    for (const toolName of mcpTools) {
      const parts = toolName.split("__");
      if (parts.length >= 3) {
        const serverName = parts[1];
        const toolShortName = parts.slice(2).join("__");
        if (!serverMap.has(serverName)) serverMap.set(serverName, []);
        serverMap.get(serverName)!.push(toolShortName);
      }
    }
    return Array.from(serverMap.entries()).map(([name, tools]) => ({
      name,
      displayName: name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      tools,
    }));
  }, [sessionTools, mcpServers]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const mcpToolCount = servers.reduce((sum, s) => sum + s.tools.length, 0);
  const builtInCount =
    sessionTools.length -
    sessionTools.filter((t) => t.startsWith("mcp__")).length;

  const closeButton = (
    <button
      onClick={onClose}
      className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Close"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed top-20 right-8 z-30 w-80 max-w-[calc(100vw-2rem)] hidden md:block"
    >
      <PanelCard
        title="Available Tools"
        headerAction={closeButton}
        footer={`${mcpToolCount} MCP · ${builtInCount} built-in · ${sessionTools.length} total`}
      >
        {builtInCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">
              Built-in Claude Code tools
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {builtInCount}
            </span>
          </div>
        )}

        {servers.length === 0 ? (
          <div className="px-4 py-6 text-xs text-[var(--text-muted)] text-center">
            No MCP tools connected
          </div>
        ) : (
          <div>
            {servers.map((server) => {
              const statusColor =
                STATUS_COLORS[server.status ?? "connected"] ??
                STATUS_COLORS.connected;
              const isDisabled = server.status === "disabled";

              return (
                <div
                  key={server.name}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <button
                    onClick={() =>
                      setExpandedServer(
                        expandedServer === server.name ? null : server.name,
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--border)] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${statusColor} flex-shrink-0`}
                      />
                      <span
                        className={`text-xs truncate ${isDisabled ? "text-[var(--text-faint)]" : server.status === "needs-auth" ? "text-yellow-500/80" : server.status === "failed" ? "text-red-400/80" : "text-[var(--text-primary)]"}`}
                      >
                        {server.displayName}
                      </span>
                      {server.scope && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--border)] text-[var(--text-muted)] flex-shrink-0">
                          {SCOPE_LABELS[server.scope] ?? server.scope}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {onToggleServer && (
                        <div
                          role="switch"
                          aria-checked={!isDisabled}
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onToggleServer(server.name, isDisabled);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              e.preventDefault();
                              onToggleServer(server.name, isDisabled);
                            }
                          }}
                          className={`relative w-7 h-4 rounded-full transition-colors cursor-pointer ${isDisabled ? "bg-[var(--border-mid)]" : "bg-emerald-600/50"}`}
                          title={
                            isDisabled ? "Enable server" : "Disable server"
                          }
                        >
                          <span
                            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white/80 transition-transform pointer-events-none ${isDisabled ? "left-0.5" : "left-3.5"}`}
                          />
                        </div>
                      )}
                      <span className="text-xs text-[var(--text-muted)]">
                        {server.tools.length}
                      </span>
                      <svg
                        className={`w-3 h-3 text-[var(--text-muted)] transition-transform duration-150 ${expandedServer === server.name ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>

                  {expandedServer === server.name && (
                    <div className="px-4 pb-2">
                      {server.configPath && (
                        <button
                          onClick={() => onOpenConfig?.(server.configPath!)}
                          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-1.5 truncate block w-full text-left"
                          title={`Open ${server.configPath}`}
                        >
                          {shortenPath(server.configPath)}
                        </button>
                      )}
                      {server.status === "needs-auth" &&
                        onReconnectServer &&
                        server.configType !== "claudeai-proxy" && (
                          <button
                            onClick={() => onReconnectServer(server.name)}
                            className="text-[10px] px-2 py-1 mb-1.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                          >
                            Authenticate
                          </button>
                        )}
                      {server.status === "failed" && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] text-red-400/70">
                            Connection failed
                          </span>
                          {onReconnectServer && (
                            <button
                              onClick={() => onReconnectServer(server.name)}
                              className="text-[10px] px-2 py-0.5 rounded bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-mid)] transition-colors"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        {server.tools.map((tool) => (
                          <div
                            key={tool}
                            className="text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-overlay)] px-2 py-1 rounded truncate"
                            title={tool}
                          >
                            {tool}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer action: open config */}
        {onOpenConfig && (
          <div className="border-t border-[var(--border)] px-4 py-2">
            <button
              onClick={() => {
                // Find a project-scoped config path, or fall back to first available
                const projectServer = servers.find(
                  (s) => s.scope === "project",
                );
                const configPath =
                  projectServer?.configPath ??
                  servers.find((s) => s.configPath)?.configPath;
                if (configPath) onOpenConfig(configPath);
              }}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Configure MCPs
            </button>
          </div>
        )}
      </PanelCard>
    </div>,
    document.body,
  );
}
