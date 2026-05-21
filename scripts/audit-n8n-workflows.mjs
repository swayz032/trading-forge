#!/usr/bin/env node
/**
 * Pass 11 Phase 6 — n8n Drift Detector.
 *
 * Lists active workflows from the n8n REST API and runs five regex/JSON
 * checks against each one:
 *   1. Hardcoded API keys (Brave, Tavily, OpenAI, Parallel, raw n8n JWTs)
 *   2. Single-symbol hardcoding ("ES futures", "specializing in ES",
 *      "E-mini S&P 500") in AI/langchain agent system messages
 *   3. Missing signal_type on POSTs to /scout-ideas* endpoints
 *   4. Dead port-4100 alert endpoints (/alert/* paths only — health
 *      probe to port 4100 is intentional and allowed)
 *   5. Outdated typeVersions (httpRequest < 4.2, scheduleTrigger < 1.2)
 *
 * Allowlist marker: any node whose `notes` field contains
 *   `# n8n-drift-allowed: <reason>`
 * skips the symbol-hardcoding check (use sparingly — symbol-specific
 * fixtures like news_fade_mcl).
 *
 * Output: `tmp-n8n/n8n-drift-report.md`. Exit 1 on any violation,
 * 0 otherwise. Reads N8N_BASE_URL (or N8N_API_URL) and N8N_API_KEY
 * from env.
 *
 * Usage:
 *   N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=... \
 *     node scripts/audit-n8n-workflows.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// override:true so .env wins over stale Windows user-level env vars (e.g. a
// pre-Railway-migration N8N_API_URL=http://localhost:5678 silently shadowed
// .env's Railway URL and produced false-green audits).
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const REPORT_PATH = path.resolve(__dirname, "..", "tmp-n8n", "n8n-drift-report.md");

// ─── API-key drift patterns ─────────────────────────────────────────
// Each pattern matches a literal credential value. Env-var references
// like `{{ $env.BRAVE_API_KEY }}` and `{{$env.TAVILY_API_KEY}}` do NOT
// match these patterns (they don't include the literal prefix bytes).
const API_KEY_PATTERNS = [
  { name: "brave", regex: /BSA[a-zA-Z0-9\-_]{10,}/g },
  { name: "tavily", regex: /tvly-[a-zA-Z0-9\-_]{10,}/g },
  { name: "openai", regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "parallel", regex: /l7Whs[a-zA-Z0-9_]{10,}/g },
  { name: "n8n_jwt", regex: /eyJhbGciOi[a-zA-Z0-9._\-]+/g },
];

// ─── Single-symbol hardcoded prompt phrases ─────────────────────────
const SINGLE_SYMBOL_PHRASES = [
  /\bES futures\b/i,
  /specializing in ES\b/i,
  /\bE-mini S&P 500\b/i,
];

// ─── Allowlist marker ───────────────────────────────────────────────
const ALLOW_MARKER = /#\s*n8n-drift-allowed\s*:\s*([^\n\r]+)/i;

// ─── typeVersion floors ─────────────────────────────────────────────
const TYPE_VERSION_FLOORS = {
  "n8n-nodes-base.httpRequest": 4.2,
  "n8n-nodes-base.scheduleTrigger": 1.2,
};

// ─── Scout endpoints that REQUIRE signal_type ───────────────────────
const SCOUT_PATH_REGEX = /\/scout-ideas(\/strict)?(?:\b|$)/;

// ─── Pass 6 / Track C F-5: enterprise-grade workflow drift checks ───
// ZZ Global Error Sink — every non-ZZ active workflow MUST attach
// settings.errorWorkflow = "DGEk1D478xWJClKD" (0A-health-monitor — the actual
// production error-sink in n8n, verified via API 2026-05-21). CLAUDE.md §2
// historically referenced "BbCvlV1ARyyvY3NI" but that workflow does not exist
// on Railway n8n; the 0A-health-monitor workflow is the de-facto global error
// sink and all 29 active workflows attach to it. The
// "ZZ" prefix on the sink's own name is how we exempt it from the check.
const ZZ_ERROR_WORKFLOW_ID = "DGEk1D478xWJClKD";
const ZZ_NAME_PREFIX = /^ZZ[\s_-]/i;

// SplitInBatches v3: index 0 is the "done" exit, index 1 is the loop body.
// Downstream work wired ONLY to index 0 silently runs zero iterations
// (pinned-fact violation per CLAUDE.md §2b — "Weekly Strategy Hunt"
// regression was caught here). The check enforces: a SplitInBatches v3
// node must have either (a) a populated index-1 array in its outgoing
// connections, OR (b) no index-0 wiring at all (so the operator was forced
// to wire the body to index 1). Empty connections object on the node is
// allowed — that's a deliberately-terminated branch.
const SPLIT_BATCHES_TYPE = "n8n-nodes-base.splitInBatches";

// Webhook trigger nodes must use authentication. n8n exposes this via
// parameters.authentication ∈ { "headerAuth", "basicAuth", "jwtAuth", ... }.
// "none" or empty string fails. The check skips webhooks that act purely
// as internal MCP plumbing (notes contain `# n8n-drift-allowed`).
const WEBHOOK_TYPE = "n8n-nodes-base.webhook";

// External HTTP calls need retry config. We flag httpRequest nodes that
// look outbound (URL host is not localhost / host.docker.internal / 127.*)
// when retryOnFail !== true. An inbound /api/* call on tower relay is
// internal traffic, so we whitelist those host patterns.
const INTERNAL_HOST_PATTERNS = [
  /^https?:\/\/localhost(:|\/|$)/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+/i,
  /^https?:\/\/host\.docker\.internal/i,
  /^=?\{\{\s*\$env\.(TF_BACKEND|RAILWAY_RELAY|RELAY_BACKEND)/i,
];

async function fetchWorkflows(baseUrl, apiKey) {
  const all = [];
  let cursor;
  do {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/workflows`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!res.ok) {
      throw new Error(`n8n API error: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    all.push(...(body.data ?? []));
    cursor = body.nextCursor;
  } while (cursor);
  return all;
}

async function fetchWorkflowDetail(baseUrl, apiKey, id) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/workflows/${id}`;
  const res = await fetch(url, { headers: { "X-N8N-API-KEY": apiKey } });
  if (!res.ok) {
    throw new Error(`n8n API error fetching ${id}: ${res.status}`);
  }
  return await res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────
function getNodeNotes(node) {
  return typeof node?.notes === "string" ? node.notes : "";
}

function isAllowed(node) {
  return ALLOW_MARKER.test(getNodeNotes(node));
}

function nodeStringified(node) {
  return JSON.stringify(node);
}

function findApiKeys(workflowJson) {
  const violations = [];
  const text = JSON.stringify(workflowJson);
  for (const pat of API_KEY_PATTERNS) {
    pat.regex.lastIndex = 0;
    const matches = text.match(pat.regex);
    if (matches && matches.length > 0) {
      // Locate which node(s) carry the value, for actionable output.
      for (const node of workflowJson.nodes ?? []) {
        const ntext = nodeStringified(node);
        pat.regex.lastIndex = 0;
        if (pat.regex.test(ntext)) {
          violations.push({ nodeName: node.name, key: pat.name });
        }
      }
    }
  }
  return violations;
}

function findSingleSymbolPrompts(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    if (isAllowed(node)) continue;
    const type = String(node.type ?? "");
    // Only inspect AI / langchain agent and chat nodes.
    if (!/agent|langchain|chatModel|openAi|chat/i.test(type)) continue;
    const params = node.parameters ?? {};
    const candidates = [
      params.systemMessage,
      params?.options?.systemMessage,
      params.text,
      params.prompt,
      params?.messages?.values && JSON.stringify(params.messages.values),
    ].filter((v) => typeof v === "string");
    for (const text of candidates) {
      for (const phrase of SINGLE_SYMBOL_PHRASES) {
        if (phrase.test(text)) {
          violations.push({
            nodeName: node.name,
            phrase: phrase.source,
            snippet: text.slice(0, 160),
          });
          break;
        }
      }
    }
  }
  return violations;
}

function findScoutMissingSignalType(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    const type = String(node.type ?? "");
    if (!/httpRequest/i.test(type)) continue;
    const params = node.parameters ?? {};
    const url = String(params.url ?? "");
    if (!SCOUT_PATH_REGEX.test(url)) continue;
    // Look at the body the node sends.
    const bodyParts = [
      params.jsonBody,
      params.body,
      JSON.stringify(params.bodyParameters ?? {}),
      JSON.stringify(params.bodyParametersJson ?? {}),
    ]
      .filter((v) => typeof v === "string")
      .join("\n");
    if (!/\bsignal_type\b/.test(bodyParts)) {
      violations.push({ nodeName: node.name, url });
    }
  }
  return violations;
}

function findPort4100AlertRefs(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    const type = String(node.type ?? "");
    if (!/httpRequest/i.test(type)) continue;
    const params = node.parameters ?? {};
    const url = String(params.url ?? "");
    // Allowed: pure port-4100 health/probe URLs without `/alert/` segment.
    // Violation: any 4100 URL whose path begins with /alert/.
    if (/host\.docker\.internal:4100\/alert\//i.test(url)) {
      violations.push({ nodeName: node.name, url });
    }
  }
  return violations;
}

function findOutdatedTypeVersions(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    const type = String(node.type ?? "");
    const floor = TYPE_VERSION_FLOORS[type];
    if (floor === undefined) continue;
    const ver = Number(node.typeVersion ?? 0);
    if (!Number.isFinite(ver) || ver < floor) {
      violations.push({
        nodeName: node.name,
        type,
        version: ver,
        floor,
      });
    }
  }
  return violations;
}

// ─── F-5a: ZZ error sink attached on every active non-ZZ workflow ───
function findMissingErrorWorkflow(workflowJson) {
  const violations = [];
  if (ZZ_NAME_PREFIX.test(workflowJson.name ?? "")) return violations;
  if (workflowJson.id === ZZ_ERROR_WORKFLOW_ID) return violations;
  const attached = workflowJson?.settings?.errorWorkflow;
  if (attached !== ZZ_ERROR_WORKFLOW_ID) {
    violations.push({
      workflowName: workflowJson.name,
      attached: attached ?? null,
      expected: ZZ_ERROR_WORKFLOW_ID,
    });
  }
  return violations;
}

// ─── F-5b: SplitInBatches v3 wired to index 1 (loop), not index 0 ───
function findSplitBatchesMisWired(workflowJson) {
  const violations = [];
  const conns = workflowJson.connections ?? {};
  for (const node of workflowJson.nodes ?? []) {
    if (node.type !== SPLIT_BATCHES_TYPE) continue;
    if ((node.typeVersion ?? 0) < 3) continue;
    const out = conns[node.name]?.main ?? [];
    const idx0 = Array.isArray(out[0]) ? out[0] : [];
    const idx1 = Array.isArray(out[1]) ? out[1] : [];
    if (idx0.length === 0 && idx1.length === 0) continue;
    if (idx1.length === 0) {
      violations.push({
        nodeName: node.name,
        reason: "SplitInBatches v3 loop body wired to index 0 (done) instead of index 1 (loop)",
        idx0_targets: idx0.length,
        idx1_targets: idx1.length,
      });
    }
  }
  return violations;
}

// ─── F-5c: webhook trigger nodes must set authentication ────────────
function findUnauthenticatedWebhooks(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    if (node.type !== WEBHOOK_TYPE) continue;
    if (isAllowed(node)) continue;
    const auth = node.parameters?.authentication;
    if (!auth || auth === "none" || auth === "") {
      violations.push({
        nodeName: node.name,
        authentication: auth ?? null,
        path: node.parameters?.path ?? null,
      });
    }
  }
  return violations;
}

// ─── F-5d: external HTTP calls must have retryOnFail ────────────────
function findHttpMissingRetry(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    const type = String(node.type ?? "");
    if (!/httpRequest/i.test(type)) continue;
    const url = String(node.parameters?.url ?? "");
    if (!url) continue;
    if (INTERNAL_HOST_PATTERNS.some((re) => re.test(url))) continue;
    if (node.retryOnFail === true) continue;
    violations.push({
      nodeName: node.name,
      url,
      retryOnFail: node.retryOnFail ?? false,
    });
  }
  return violations;
}

// ─── Report writer ──────────────────────────────────────────────────
function renderReport(byWorkflow) {
  const lines = [];
  lines.push("# n8n Drift Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  const sections = [
    ["api_keys", "Hardcoded API keys"],
    ["single_symbol", "Single-symbol hardcoded prompts"],
    ["scout_signal_type", "Scout POSTs missing `signal_type`"],
    ["port_4100_alert", "Dead port-4100 /alert/* endpoints"],
    ["typeversion", "Outdated typeVersions"],
    ["error_workflow", "Missing ZZ Global Error Sink attachment"],
    ["split_batches", "SplitInBatches v3 mis-wired (loop body on index 0)"],
    ["webhook_auth", "Webhook trigger missing authentication"],
    ["http_retry", "External HTTP request missing retryOnFail"],
  ];

  let totalViolations = 0;
  for (const [key, title] of sections) {
    lines.push(`## ${title}`);
    let any = false;
    for (const wf of byWorkflow) {
      const v = wf.violations[key];
      if (!v || v.length === 0) continue;
      any = true;
      lines.push(`- **${wf.id}** (${wf.name}):`);
      for (const item of v) {
        lines.push(`  - ${JSON.stringify(item)}`);
        totalViolations += 1;
      }
    }
    if (!any) lines.push("- (none)");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(`- Workflows scanned: ${byWorkflow.length}`);
  lines.push(`- Total violations: ${totalViolations}`);
  lines.push("");
  return { text: lines.join("\n"), totalViolations };
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  // Prefer N8N_BASE_URL (canonical .env Railway URL); fall back to legacy N8N_API_URL.
  const baseUrl = process.env.N8N_BASE_URL ?? process.env.N8N_API_URL ?? process.env.RAILWAY_N8N_URL;
  // Pass 21 (2026-05-12) migrated n8n to Railway with new JWT. Canonical
  // env names are TF_N8N_API_KEY / RAILWAY_N8N_API_KEY. Legacy N8N_API_KEY
  // may still be present with a stale value — prefer the Pass 21 names.
  const apiKey = process.env.TF_N8N_API_KEY ?? process.env.RAILWAY_N8N_API_KEY ?? process.env.N8N_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error(
      "ERROR: N8N_API_URL (or N8N_BASE_URL) and N8N_API_KEY must be set.\n" +
        "Example:\n" +
        "  N8N_API_URL=http://localhost:5678 N8N_API_KEY=... \\\n" +
        "    node scripts/audit-n8n-workflows.mjs",
    );
    process.exit(1);
  }

  console.log(`Listing active workflows from ${baseUrl}…`);
  const list = await fetchWorkflows(baseUrl, apiKey);
  const active = list.filter((w) => w.active && !w.isArchived);
  console.log(`Auditing ${active.length} active workflows…`);

  const byWorkflow = [];
  for (const w of active) {
    const detail = await fetchWorkflowDetail(baseUrl, apiKey, w.id);
    const v = {
      api_keys: findApiKeys(detail),
      single_symbol: findSingleSymbolPrompts(detail),
      scout_signal_type: findScoutMissingSignalType(detail),
      port_4100_alert: findPort4100AlertRefs(detail),
      typeversion: findOutdatedTypeVersions(detail),
      // Pass 6 / Track C F-5 — production-hardening checks
      error_workflow: findMissingErrorWorkflow(detail),
      split_batches: findSplitBatchesMisWired(detail),
      webhook_auth: findUnauthenticatedWebhooks(detail),
      http_retry: findHttpMissingRetry(detail),
    };
    byWorkflow.push({ id: w.id, name: w.name, violations: v });
  }

  const { text, totalViolations } = renderReport(byWorkflow);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, text, "utf-8");
  console.log(`Report → ${REPORT_PATH}`);
  console.log(`Total violations: ${totalViolations}`);

  if (totalViolations > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("audit-n8n-workflows failed:", err);
  process.exit(1);
});
