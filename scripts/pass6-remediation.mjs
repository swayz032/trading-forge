#!/usr/bin/env node
// Pass 6 operator-queue remediation: n8n API ops via Node fetch.
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const N8N_URL = env.N8N_BASE_URL;
const N8N_KEY = env.TF_N8N_API_KEY;
if (!N8N_URL || !N8N_KEY) { console.error("Missing N8N_BASE_URL or TF_N8N_API_KEY"); process.exit(2); }

const ZZ_SINK_ID = "BbCvlV1ARyyvY3NI";
const HEALTH_MONITOR_ID = "DGEk1D478xWJClKD";

async function n8n(method, path, body) {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": N8N_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : {};
}

async function identifyZzSink() {
  const a = await n8n("GET", `/workflows/${ZZ_SINK_ID}`).catch((e) => ({ error: String(e) }));
  const b = await n8n("GET", `/workflows/${HEALTH_MONITOR_ID}`).catch((e) => ({ error: String(e) }));
  console.log(`ZZ candidate ${ZZ_SINK_ID}: name=${a.name ?? a.error} active=${a.active}`);
  console.log(`Other       ${HEALTH_MONITOR_ID}: name=${b.name ?? b.error} active=${b.active}`);
}

async function listActive() {
  const out = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ active: "true", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await n8n("GET", `/workflows?${q.toString()}`);
    out.push(...(page.data || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return out;
}

async function bulkFixErrorWorkflow() {
  const workflows = await listActive();
  const offenders = workflows.filter(
    (w) => w.id !== ZZ_SINK_ID && (w.settings?.errorWorkflow ?? null) !== ZZ_SINK_ID,
  );
  console.log(`Found ${offenders.length} workflows with wrong/missing errorWorkflow`);
  const results = { fixed: [], failed: [] };
  for (const w of offenders) {
    try {
      // n8n PUT requires the full workflow object — fetch then update settings.
      const full = await n8n("GET", `/workflows/${w.id}`);
      const updated = {
        name: full.name,
        nodes: full.nodes,
        connections: full.connections,
        settings: { ...(full.settings || {}), errorWorkflow: ZZ_SINK_ID },
        staticData: full.staticData ?? null,
      };
      await n8n("PUT", `/workflows/${w.id}`, updated);
      results.fixed.push({ id: w.id, name: w.name });
      console.log(`  fixed: ${w.id} (${w.name})`);
    } catch (e) {
      results.failed.push({ id: w.id, name: w.name, error: String(e).slice(0, 200) });
      console.error(`  FAILED: ${w.id} (${w.name}): ${e}`);
    }
  }
  return results;
}

async function addHttpRetry(workflowId) {
  const wf = await n8n("GET", `/workflows/${workflowId}`);
  let changed = 0;
  for (const node of wf.nodes ?? []) {
    if ((node.type === "n8n-nodes-base.httpRequest" || node.type === "n8n-nodes-base.httpRequestV3") &&
        !node.retryOnFail) {
      node.retryOnFail = true;
      node.maxTries = node.maxTries || 3;
      node.waitBetweenTries = node.waitBetweenTries || 2000;
      changed++;
    }
  }
  if (changed === 0) { console.log(`  ${workflowId}: no HTTP nodes needed retry`); return; }
  const updated = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
  await n8n("PUT", `/workflows/${workflowId}`, updated);
  console.log(`  ${workflowId}: enabled retryOnFail on ${changed} HTTP nodes`);
}

async function setWebhookHeaderAuth(workflowId, credentialId, credentialName) {
  const wf = await n8n("GET", `/workflows/${workflowId}`);
  let changed = 0;
  for (const node of wf.nodes ?? []) {
    if (node.type === "n8n-nodes-base.webhook" && !node.parameters?.authentication) {
      node.parameters = node.parameters || {};
      node.parameters.authentication = "headerAuth";
      node.credentials = node.credentials || {};
      node.credentials.httpHeaderAuth = { id: credentialId, name: credentialName };
      changed++;
    }
  }
  if (changed === 0) { console.log(`  ${workflowId}: no webhook trigger needs auth (already protected)`); return; }
  const updated = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
  await n8n("PUT", `/workflows/${workflowId}`, updated);
  console.log(`  ${workflowId}: webhook auth mode -> headerAuth (${changed} node(s))`);
}

const op = process.argv[2];
if (op === "identify") { await identifyZzSink(); }
else if (op === "fix-error-sink") { await bulkFixErrorWorkflow(); }
else if (op === "fix-http-retry") {
  await addHttpRetry("1N8GcmcMKvQH4GRG"); // Strategy Generation Loop
}
else if (op === "fix-webhook-auth") {
  const CRED_ID = "2AVBlPQp9gHMmQ9K";
  const CRED_NAME = "TF webhook header auth";
  await setWebhookHeaderAuth("1N8GcmcMKvQH4GRG", CRED_ID, CRED_NAME);
  await setWebhookHeaderAuth("40q1SdSjUxyZ9Jux", CRED_ID, CRED_NAME);
}
else if (op === "all") {
  console.log("=== identify ZZ sink ==="); await identifyZzSink();
  console.log("\n=== fix-error-sink ==="); await bulkFixErrorWorkflow();
  console.log("\n=== fix-http-retry ==="); await addHttpRetry("1N8GcmcMKvQH4GRG");
  console.log("\n=== fix-webhook-auth ===");
  await setWebhookHeaderAuth("1N8GcmcMKvQH4GRG", env.N8N_WEBHOOK_SECRET);
  await setWebhookHeaderAuth("40q1SdSjUxyZ9Jux", env.N8N_WEBHOOK_SECRET);
}
else {
  console.log("usage: node scripts/pass6-remediation.mjs <identify|fix-error-sink|fix-http-retry|fix-webhook-auth|all>");
  process.exit(1);
}
