#!/usr/bin/env node
/**
 * Diagnostic script: spawns codex app-server and tests plan mode notifications.
 *
 * Usage: node scripts/test-codex-plan.mjs [prompt]
 *
 * Sends initialize + initialized handshake, lists collaboration modes,
 * starts a thread with plan mode, and logs ALL notifications received.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PROMPT =
  process.argv[2] || "Come up with a plan to add a hello world endpoint";

// JSON-RPC helpers
let nextId = 1;
function rpcRequest(method, params = {}) {
  return { jsonrpc: "2.0", id: nextId++, method, params };
}
function rpcNotification(method, params = {}) {
  return { jsonrpc: "2.0", method, params };
}

// Spawn codex app-server
const child = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
});

child.stderr.on("data", (d) =>
  process.stderr.write(`[stderr] ${d.toString()}`),
);

const rl = createInterface({ input: child.stdout });
const pending = new Map(); // id -> { resolve }
const notifications = [];

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.log("[raw]", line);
    return;
  }

  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    notifications.push(msg);
    console.log(`[notif] ${msg.method}`, JSON.stringify(msg.params).slice(0, 200));
  }
});

function send(obj) {
  const json = JSON.stringify(obj);
  child.stdin.write(json + "\n");
}

function sendRpc(method, params = {}) {
  const req = rpcRequest(method, params);
  return new Promise((resolve) => {
    pending.set(req.id, { resolve });
    send(req);
  });
}

function sendNotif(method, params = {}) {
  send(rpcNotification(method, params));
}

// Wait for notifications to settle
function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("--- Initialize ---");
  const initResult = await sendRpc("initialize", {
    protocolVersion: "2025-01-01",
    capabilities: { experimentalApi: true },
    clientInfo: { name: "test-codex-plan", version: "0.1.0" },
  });
  console.log("init result:", JSON.stringify(initResult.result, null, 2));

  sendNotif("initialized");
  await waitMs(500);

  console.log("\n--- List collaboration modes ---");
  try {
    const modes = await sendRpc("collaborationMode/list");
    console.log("modes:", JSON.stringify(modes.result, null, 2));
  } catch (e) {
    console.log("collaborationMode/list not supported:", e.message);
  }

  console.log("\n--- List models ---");
  try {
    const models = await sendRpc("model/list", { includeHidden: false });
    const modelList = models.result?.data?.map(m => ({ id: m.id, model: m.model, displayName: m.displayName, isDefault: m.isDefault }));
    console.log("models:", JSON.stringify(modelList, null, 2));
    const defaultModel = models.result?.data?.find(m => m.isDefault);
    if (defaultModel) {
      globalThis.__defaultModel = defaultModel.model || defaultModel.id;
      console.log("Using default model:", globalThis.__defaultModel);
    }
  } catch (e) {
    console.log("model/list error:", e.message);
  }

  console.log("\n--- Start thread ---");
  const threadResult = await sendRpc("thread/start", {
    approvalPolicy: "never",
    sandbox: "read-only",
  });
  const threadId = threadResult.result?.thread?.id;
  console.log("thread id:", threadId);

  console.log(`\n--- Start turn (plan mode) with prompt: "${PROMPT}" ---`);
  const turnResult = await sendRpc("turn/start", {
    threadId,
    input: [{ type: "text", text: PROMPT }],
    collaborationMode: {
      mode: "plan",
      settings: {
        model: globalThis.__defaultModel || "codex-mini-latest",
        reasoning_effort: "medium",
        developer_instructions: null,
      },
    },
  });
  console.log(
    "turn/start result:",
    JSON.stringify(turnResult?.result ?? turnResult, null, 2)?.slice(0, 300),
  );

  // Wait for turn to complete (listen for notifications)
  console.log("\n--- Waiting for notifications (60s timeout) ---");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await waitMs(500);
    // Check if turn completed
    const turnDone = notifications.find(
      (n) => n.method === "turn/completed" || n.method === "turn/errored",
    );
    if (turnDone) {
      console.log("\n--- Turn finished ---");
      break;
    }
  }

  // Summary
  console.log("\n=== NOTIFICATION SUMMARY ===");
  const methodCounts = {};
  for (const n of notifications) {
    methodCounts[n.method] = (methodCounts[n.method] || 0) + 1;
  }
  console.log("Methods received:", methodCounts);

  const planNotifs = notifications.filter(
    (n) =>
      n.method.includes("plan") ||
      n.method.includes("Plan") ||
      n.method === "turn/plan/updated",
  );
  console.log(`Plan-specific notifications: ${planNotifs.length}`);
  for (const n of planNotifs) {
    console.log(`  ${n.method}:`, JSON.stringify(n.params).slice(0, 300));
  }

  const textNotifs = notifications.filter(
    (n) => n.method === "item/agentMessage/delta",
  );
  if (textNotifs.length > 0) {
    const fullText = textNotifs.map((n) => n.params?.delta ?? "").join("");
    console.log(
      `\nAgentMessage text (${fullText.length} chars):\n${fullText.slice(0, 500)}...`,
    );
  }

  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
