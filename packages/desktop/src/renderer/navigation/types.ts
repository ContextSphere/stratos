import type { NavAnchor } from "@stratosapp/ui";

export type { NavAnchor };

export interface NavEntry {
  threadId: string;
  anchor: NavAnchor;
}

export interface NavHistoryState {
  stack: NavEntry[];
  index: number;
}
