/**
 * Per-turn Manager images that should be auto-forwarded to any create_session
 * or send_message tool call made by the Manager LLM during the current turn.
 *
 * The Manager LLM sees images visually but cannot regenerate base64 bytes in
 * tool call parameters. ManagerSession.send() stores the user's attached
 * images here before streaming and clears them in its finally block. The
 * unified stratos MCP handlers (used by both the in-process SDK adapter and
 * the Unix-socket server) read from this module-level state as a fallback
 * when the LLM didn't include images explicitly.
 */

type ManagerImage = { dataUrl: string; mimeType: string };

let currentTurnImages: ManagerImage[] = [];

export function setManagerTurnImages(images: ManagerImage[] | undefined): void {
  currentTurnImages = images ?? [];
}

export function getManagerTurnImages(): ManagerImage[] {
  return currentTurnImages;
}

export function clearManagerTurnImages(): void {
  currentTurnImages = [];
}
