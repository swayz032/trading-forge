#!/usr/bin/env node
/**
 * Pass 7 — n8n REAL fixes (replaces Pass 6's fictional remediation).
 *
 * Pass 6 claimed completion but the live audit revealed:
 *   C-1  Drift-detector ZZ_ERROR_WORKFLOW_ID was inverted by a Pass 6 edit.
 *   C-2  Weekly Strategy Hunt "Batch 3 Strategies" SiB allegedly mis-wired.
 *   C-3  Strategy Generation Loop webhook had authentication="headerAuth" but
 *        credentials field was undefined — auth header never enforced.
 *   C-4  /api/n8n/execution-log endpoint had zero workflow callers (dead code).
 *
 * Live-state findings re-verified by this script before fixing:
 *   C-1  See scripts/audit-n8n-workflows.mjs — comment block explains the
 *        empirical revert (BbCvlV1ARyyvY3NI returns 404; DGEk1D478xWJClKD
 *        is the actual sink all 29 workflows attach to).
 *   C-2  TaRpu6HwVsVB3XgY "Batch 3 Strategies" v3 connections:
 *           main[0] = []
 *           main[1] = [{node: "POST Batch to Backtest Agent", ...}]
 *        Loop body is already on idx1. The Pass 7 brief's claim that it
 *        still has "idx1=0" is contradicted by the live REST API. The
 *        guarded fix below idempotently re-asserts the correct shape and
 *        no-ops when already correct. We do NOT blindly move main[0]→main[1]
 *        as the brief suggested — that would BREAK the currently-correct
 *        wiring (main[0] is empty; nothing to move).
 *   C-3  Strategy Generation Loop (1N8GcmcMKvQH4GRG) and Strategy Deep
 *        Analysis Pipeline (40q1SdSjUxyZ9Jux) both have webhook nodes with
 *        authentication="headerAuth" but credentials=undefined. We bind
 *        credential id 2AVBlPQp9gHMmQ9K ("TF webhook header auth") via PUT.
 *   C-4  Documented in docs/n8n-fixes-pass7-runbook.md — Option B is the
 *        live path (scraper polls Railway n8n API and inserts rows; 31
 *        rows in last 24h verified).
 *
 * Usage:
 *   node scripts/pass7-n8n-real-fixes.mjs <inspect|fix-sib|fix-webhook-auth|verify|all>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envText = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const N8N_URL = env.N8N_BASE_URL;
const N8N_KEY = env.TF_N8N_API_KEY;
if (!N8N_URL || !N8N_KEY) {
  console.error("Missing N8N_BASE_URL or TF_N8N_API_KEY in .env");
  process.exit(2);
}

// Pinned IDs (verified live 2026-05-21).
const WSH_ID = "TaRpu6HwVsVB3XgY";              // Weekly Strategy Hunt
const SGL_ID = "1N8GcmcMKvQH4GRG";              // Strategy Generation Loop
const SDAP_ID = "40q1SdSjUxyZ9Jux";             // Strategy Deep Analysis Pipeline
const WEBHOOK_CRED_ID = "2AVBlPQp9gHMmQ9K";     // TF webhook header auth
const WEBHOOK_CRED_NAME = "TF webhook header auth";
const SIB_NODE_NAME = "Batch 3 Strategies";
const SIB_LOOP_TARGET = "POST Batch to Backtest Agent";

async function n8n(method, p, body) {
  const res = await fetch(`${N8N_URL}/api/v1${p}`, {
    method,
    headers: { "X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : {};
}

function buildPutBody(wf) {
  // n8n strict validator: PUT /workflows/:id requires name + nodes + connections + settings.
  // Anything else (id, active, createdAt, tags, etc.) is read-only and must be omitted.
  return {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
}

// ─── C-2: Weekly Strategy Hunt SiB wiring ──────────────────────────────────
async function inspectSib() {
  const wf = await n8n("GET", `/workflows/${WSH_ID}`);
  const node = wf.nodes.find((n) => n.name === SIB_NODE_NAME);
  const conns = wf.connections[SIB_NODE_NAME];
  console.log(`SiB node: ${node?.name} (type=${node?.type}, tv=${node?.typeVersion})`);
  console.log(`SiB connections:`, JSON.stringify(conns, null, 2));
  const main = conns?.main || [];
  const idx0Targets = main[0] || [];
  const idx1Targets = main[1] || [];
  const idx0HasLoopBody = idx0Targets.some((t) => t.node === SIB_LOOP_TARGET);
  const idx1HasLoopBody = idx1Targets.some((t) => t.node === SIB_LOOP_TARGET);
  console.log(`  idx0 targets: ${idx0Targets.map((t) => t.node).join(", ") || "(empty)"}`);
  console.log(`  idx1 targets: ${idx1Targets.map((t) => t.node).join(", ") || "(empty)"}`);
  console.log(`  loop-body on idx0? ${idx0HasLoopBody}  loop-body on idx1? ${idx1HasLoopBody}`);
  return { wf, conns, idx0HasLoopBody, idx1HasLoopBody };
}

async function fixSib() {
  const { wf, conns, idx0HasLoopBody, idx1HasLoopBody } = await inspectSib();
  if (idx1HasLoopBody && !idx0HasLoopBody) {
    console.log("  [no-op] Batch 3 Strategies already has loop body on idx1; nothing to fix.");
    return;
  }
  if (idx0HasLoopBody && !idx1HasLoopBody) {
    console.log("  [migrate] Moving loop body from idx0 -> idx1...");
    const main = conns.main || [];
    const newMain = [
      (main[0] || []).filter((t) => t.node !== SIB_LOOP_TARGET),
      [...(main[1] || []), ...(main[0] || []).filter((t) => t.node === SIB_LOOP_TARGET)],
    ];
    wf.connections[SIB_NODE_NAME] = { ...conns, main: newMain };
    await n8n("PUT", `/workflows/${WSH_ID}`, buildPutBody(wf));
    console.log("  [migrate] PUT complete; verifying...");
    await inspectSib();
    return;
  }
  console.log("  [ambiguous] both/neither idx has loop body — manual review required.");
}

// ─── C-3: Webhook credential binding ───────────────────────────────────────
async function inspectWebhookAuth(workflowId) {
  const wf = await n8n("GET", `/workflows/${workflowId}`);
  const triggers = wf.nodes.filter((n) => n.type === "n8n-nodes-base.webhook");
  for (const n of triggers) {
    const auth = n.parameters?.authentication ?? "(unset)";
    const creds = n.credentials ?? null;
    const credId = creds?.httpHeaderAuth?.id ?? null;
    console.log(`  ${wf.name} :: ${n.name} :: auth=${auth} credId=${credId ?? "(unset)"}`);
  }
  return { wf, triggers };
}

async function fixWebhookAuth(workflowId) {
  const wf = await n8n("GET", `/workflows/${workflowId}`);
  let changed = 0;
  for (const node of wf.nodes) {
    if (node.type !== "n8n-nodes-base.webhook") continue;
    const auth = node.parameters?.authentication;
    const credId = node.credentials?.httpHeaderAuth?.id;
    // Pass 7 C-3 fix: bind credential when authentication=headerAuth and credentials missing.
    if (auth === "headerAuth" && credId !== WEBHOOK_CRED_ID) {
      node.credentials = node.credentials || {};
      node.credentials.httpHeaderAuth = { id: WEBHOOK_CRED_ID, name: WEBHOOK_CRED_NAME };
      changed += 1;
      console.log(`  [bind] ${wf.name} :: ${node.name} -> credId=${WEBHOOK_CRED_ID}`);
    } else if (!auth || auth === "none") {
      // Also bind for any webhook still on "none" — set both fields.
      node.parameters = node.parameters || {};
      node.parameters.authentication = "headerAuth";
      node.credentials = node.credentials || {};
      node.credentials.httpHeaderAuth = { id: WEBHOOK_CRED_ID, name: WEBHOOK_CRED_NAME };
      changed += 1;
      console.log(`  [set+bind] ${wf.name} :: ${node.name} -> auth=headerAuth credId=${WEBHOOK_CRED_ID}`);
    }
  }
  if (changed === 0) {
    console.log(`  [no-op] ${wf.name}: no webhook needed credential binding.`);
    return;
  }
  await n8n("PUT", `/workflows/${workflowId}`, buildPutBody(wf));
  console.log(`  [PUT] ${wf.name}: ${changed} node(s) updated; verifying...`);
  await inspectWebhookAuth(workflowId);
}

// ─── Top-level dispatch ───────────────────────────────────────────────────
const op = process.argv[2] || "inspect";
try {
  if (op === "inspect") {
    console.log("=== C-2 inspect: WSH Batch 3 Strategies SiB wiring ===");
    await inspectSib();
    console.log("\n=== C-3 inspect: SGL + SDAP webhook auth bindings ===");
    await inspectWebhookAuth(SGL_ID);
    await inspectWebhookAuth(SDAP_ID);
  } else if (op === "fix-sib") {
    await fixSib();
  } else if (op === "fix-webhook-auth") {
    console.log("=== C-3 fix: SGL webhook ===");
    await fixWebhookAuth(SGL_ID);
    console.log("\n=== C-3 fix: SDAP webhook ===");
    await fixWebhookAuth(SDAP_ID);
  } else if (op === "verify") {
    console.log("=== post-fix verification ===");
    await inspectSib();
    await inspectWebhookAuth(SGL_ID);
    await inspectWebhookAuth(SDAP_ID);
  } else if (op === "all") {
    console.log("=== C-2 fix-sib ===");
    await fixSib();
    console.log("\n=== C-3 fix-webhook-auth ===");
    await fixWebhookAuth(SGL_ID);
    await fixWebhookAuth(SDAP_ID);
    console.log("\n=== verify ===");
    await inspectSib();
    await inspectWebhookAuth(SGL_ID);
    await inspectWebhookAuth(SDAP_ID);
  } else {
    console.log("usage: node scripts/pass7-n8n-real-fixes.mjs <inspect|fix-sib|fix-webhook-auth|verify|all>");
    process.exit(1);
  }
} catch (e) {
  console.error("FATAL:", e);
  process.exit(1);
}
