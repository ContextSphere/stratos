// Re-exports
export { toolRegistry } from "./registry";
export type {
  InternalToolDescriptor,
  ToolMatchPattern,
  ToolCardBodyProps,
} from "./types";

// Side-effect imports — each file calls toolRegistry.register() on load
import "./descriptors/scheduler.descriptor";
import "./descriptors/preview.descriptor";
import "./descriptors/manager.descriptor";
