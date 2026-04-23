import type { InternalToolDescriptor, ToolMatchPattern } from "./types";

function matchesPattern(pattern: ToolMatchPattern, toolName: string): boolean {
  switch (pattern.type) {
    case "exact":
      return toolName === pattern.name;
    case "prefix":
      return toolName.startsWith(pattern.prefix);
    case "mcp-server": {
      const parts = toolName.split("__");
      return (
        parts.length >= 3 && parts[0] === "mcp" && parts[1] === pattern.server
      );
    }
    case "predicate":
      return pattern.fn(toolName);
  }
}

export class InternalToolRegistry {
  private entries: InternalToolDescriptor[] = [];

  register(descriptor: InternalToolDescriptor): void {
    if (process.env.NODE_ENV === "development") {
      const duplicate = this.entries.find(
        (e) => e.id !== descriptor.id && this._wouldShadow(e, descriptor),
      );
      if (duplicate) {
        console.warn(
          `[InternalToolRegistry] New entry "${descriptor.id}" may shadow existing entry "${duplicate.id}"`,
        );
      }
    }

    const existing = this.entries.findIndex((e) => e.id === descriptor.id);
    if (existing >= 0) {
      this.entries[existing] = descriptor;
    } else {
      this.entries.push(descriptor);
    }
  }

  registerAll(descriptors: InternalToolDescriptor[]): void {
    for (const d of descriptors) this.register(d);
  }

  /** Returns the first descriptor whose patterns match toolName. */
  resolve(toolName: string): InternalToolDescriptor | null {
    for (const entry of this.entries) {
      const patterns = Array.isArray(entry.match) ? entry.match : [entry.match];
      if (patterns.some((p) => matchesPattern(p, toolName))) {
        return entry;
      }
    }
    return null;
  }

  isInternal(toolName: string): boolean {
    return this.resolve(toolName) !== null;
  }

  /** Returns the descriptor registered for a specific MCP server name, if any. */
  getByServerName(serverName: string): InternalToolDescriptor | null {
    for (const entry of this.entries) {
      const patterns = Array.isArray(entry.match) ? entry.match : [entry.match];
      for (const p of patterns) {
        if (p.type === "mcp-server" && p.server === serverName) {
          return entry;
        }
      }
    }
    return null;
  }

  private _wouldShadow(
    existing: InternalToolDescriptor,
    candidate: InternalToolDescriptor,
  ): boolean {
    const existingPatterns = Array.isArray(existing.match)
      ? existing.match
      : [existing.match];
    const candidatePatterns = Array.isArray(candidate.match)
      ? candidate.match
      : [candidate.match];

    // Heuristic: check if any exact/prefix pattern from candidate matches an existing pattern
    for (const cp of candidatePatterns) {
      if (cp.type === "exact") {
        if (existingPatterns.some((ep) => matchesPattern(ep, cp.name))) {
          return true;
        }
      }
    }
    return false;
  }
}

export const toolRegistry = new InternalToolRegistry();
