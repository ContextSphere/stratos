# Issue 10: hasAuthCredentials Uses require('fs') Inconsistently

## Problem

`hasAuthCredentials()` in `packages/desktop/src/main/integrations/whatsapp.ipc.ts` (line 94) calls `require("fs").readdirSync(dir)` using CommonJS dynamic require, while the rest of the file uses named ES imports from `"fs"` at the top (lines 3–11). This is inconsistent and prevents tree-shaking; `readdirSync` should simply be added to the existing import list.

## Root Cause

The function was likely added after the initial import block without updating it, resulting in a fallback to `require()`.

## Fix

1. Add `readdirSync` to the named imports from `"fs"` at line 3.
2. Replace `require("fs").readdirSync(dir) as string[]` with `readdirSync(dir)` in `hasAuthCredentials()`.

No logic changes — the behaviour is identical; only the import mechanism changes.

## Files Changed

- `packages/desktop/src/main/integrations/whatsapp.ipc.ts`

---

## Verification

- `pnpm build` passes — no TypeScript errors.
- `pnpm test` passes — no regressions.
- `hasAuthCredentials` still returns `true` when `.json` files exist in the auth dir and `false` otherwise (logic unchanged).
