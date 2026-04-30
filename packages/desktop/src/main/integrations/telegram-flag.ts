import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let _cached: boolean | null = null;

export function isTelegramEnabled(): boolean {
  if (_cached === null) {
    _cached = existsSync(join(homedir(), ".stratos", "telegram.json"));
  }
  return _cached;
}
