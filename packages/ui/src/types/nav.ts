export type NavAnchor =
  | { type: "latest" }
  | { type: "message"; messageId: string };
