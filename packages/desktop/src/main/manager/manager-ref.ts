/**
 * Module-level ref to the ManagerSession singleton.
 * Exists purely to break the circular import between manager-session.ts
 * (which imports createStratosHandlers) and handlers/manager.ts
 * (which needs to reach the Manager from MCP tools).
 */

// Use an interface so we don't import the class itself.
export interface ManagerLike {
  isActive: boolean;
  /** Route a gateway message into the Manager. Sets the persistent gateway URL for all future turns. */
  sendFromGateway(prompt: string, gatewayUrl: string): Promise<void>;
  interrupt(): Promise<void>;
}

let ref: ManagerLike | null = null;

export function setManagerRef(manager: ManagerLike): void {
  ref = manager;
}

export function getManagerRef(): ManagerLike | null {
  return ref;
}
