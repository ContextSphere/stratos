import type React from "react";
import type { ToolCall } from "../types";

export type ToolMatchPattern =
  | { type: "exact"; name: string }
  | { type: "prefix"; prefix: string }
  | { type: "mcp-server"; server: string }
  | { type: "predicate"; fn: (name: string) => boolean };

export interface InternalToolDescriptor {
  /** Unique key for this registration. Last write wins on duplicate id. */
  id: string;

  /** One or more patterns identifying which tool names this entry handles. */
  match: ToolMatchPattern | ToolMatchPattern[];

  display: {
    /** Short source label shown in the card header (e.g. "Stratos Scheduler"). */
    sourceLabel: string;
    /** Icon component or icon name string from the app's icon set. */
    icon: React.ComponentType<{ size?: number; className?: string }>;
    /** CSS color used for the left accent border and icon tint. */
    accentColor: string;
  };

  /**
   * Produces the human-readable title for a specific tool call.
   * Falls back to humanizing the short tool name if omitted.
   */
  title?: (toolCall: ToolCall) => string;

  /**
   * Component that renders the card body.
   * If omitted, DefaultBuiltinCardBody is used (humanized key-value input + text output).
   */
  CardBody?: React.ComponentType<ToolCardBodyProps>;

  /**
   * Controls visibility in the thread.
   * "hidden" suppresses high-frequency read-only cards from the thread.
   */
  visibility?:
    | "visible"
    | "hidden"
    | ((toolCall: ToolCall) => "visible" | "hidden");

  /**
   * Whether the body is expanded by default.
   * "auto" expands when status === "running".
   */
  defaultExpanded?: boolean | "auto";
}

export interface ToolCardBodyProps {
  toolCall: ToolCall;
  descriptor: InternalToolDescriptor;
}
