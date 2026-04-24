/**
 * Transport-agnostic handler types shared by the SDK adapter and the stdio
 * socket MCP server.
 */
import type { ZodRawShape, z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type InferShape<T extends ZodRawShape> = {
  [K in keyof T]: z.infer<T[K]>;
};

/**
 * Concrete (monomorphised) HandlerDef — schema is erased to `ZodRawShape`
 * and handler args are widened to the flat zod-parsed result. Collections
 * of handlers (e.g. `HandlerDef[]`) use this shape.
 */
export interface HandlerDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  annotations?: ToolAnnotations;
}

/**
 * Typed-at-definition-site helper. At the call site `defineHandler({ ... })`
 * TypeScript sees the literal `inputSchema` and infers the args shape for
 * the handler body. The returned value is widened to the generic
 * `HandlerDef` so arrays of handlers with different schemas still compose.
 */
export function defineHandler<S extends ZodRawShape>(def: {
  name: string;
  description: string;
  inputSchema: S;
  handler: (args: InferShape<S>) => Promise<ToolResult>;
  annotations?: ToolAnnotations;
}): HandlerDef {
  return def as unknown as HandlerDef;
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}
