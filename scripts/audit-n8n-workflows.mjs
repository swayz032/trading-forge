/**
 * Pass 11 Phase 6 — n8n Drift Detector.
 *
 * Lists workflows from the n8n REST API. ACTIVE (non-archived) workflows are
 * run through the nine regex/JSON drift checks below. Separately, any
 * DEACTIVATED-but-not-archived workflow is surfaced as its own violation
 * (`deactivated` section) — a paused production workflow silently drops out of
 * the `active` set and would otherwise make the report read "0 violations"
 * (false-green). Archiving a workflow (isArchived=true) is the explicit
 * "intentionally off" acknowledgement that clears that flag.
 *
 * The nine checks run against each ACTIVE workflow:
 *   1. Hardcoded API keys (Brave, Tavily, OpenAI, Parallel, raw n8n JWTs)
 *   2. Single-symbol hardcoding ("ES futures", "specializing in ES",
 *      "E-mini S&P 500") in AI/langchain agent system messages
 *   3. Missing signal_type on POSTs to /scout-ideas* endpoints
 *   4. Dead port-4100 alert endpoints (/alert/* paths only — health
 *      probe to port 4100 is intentional and allowed)
 *   5. Outdated typeVersions (httpRequest < 4.2, scheduleTrigger < 1.2)
 *   6. Retired Ollama model references (D1, deep-scan #22) — any node that
 *      references a model other than the one served model `gemma4:e4b-it-qat`
 *      (deepseek-r1 / nomic-embed-text / qwen2.5-coder / phi4-mini / gemma4:e2b).
 *
 * Allowlist marker: any node whose `notes` field contains
 *   `# n8n-drift-allowed: <reason>`
 * skips the symbol-hardcoding check (use sparingly — symbol-specific
 * fixtures like news_fade_mcl).
 *
 * Output: `tmp-n8n/n8n-drift-report.md`. Exit 0 = clean, exit 1 = genuine
 * drift found (totalViolations > 0). Reads N8N_BASE_URL (or N8N_API_URL)
 * and N8N_API_KEY from env.
 *
 * EXIT 2 — API UNREACHABLE (fixwave2-scheduler-health-monitoring, 2026-07-17):
 *   Missing env vars, a network failure, or a non-2xx HTTP response while
 *   listing/fetching workflows throws `N8nApiUnreachableError` and exits 2
 *   — NOT 1. This is deliberate: the caller (scheduler.ts `_runN8nDriftAudit`
 *   via `src/server/lib/n8n-drift-audit-classifier.ts`) previously could not
 *   tell "the n8n API was unreachable (stale key / outage)" apart from
 *   "genuine drift was found" because both exited 1 — producing a misleading
 *   CRITICAL "workflows are missing safety configurations" alert during a
 *   pure connectivity failure. Keep `N8N_AUDIT_EXIT_API_UNREACHABLE` in
 *   n8n-drift-audit-classifier.ts in sync with the literal `2` used here.
 *
 * Usage:
 *   N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=... \
 *     node scripts/audit-n8n-workflows.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// override:true so .env wins over stale Windows user-level env vars (e.g. a
// pre-Railway-migration N8N_API_URL=http://localhost:5678 silently shadowed
// .env's Railway URL and produced false-green audits).
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const REPORT_PATH = path.resolve(__dirname, "..", "tmp-n8n", "n8n-drift-report.md");

// ─── API-unreachable error class (fixwave2-scheduler-health-monitoring) ──
// Thrown for missing config / network failure / non-2xx HTTP response —
// anything that means "we never got to evaluate a workflow", as opposed to
// "we evaluated workflows and found drift". main()'s top-level catch checks
// `instanceof` this class to pick exit code 2 vs the generic exit code 1.
export class N8nApiUnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = "N8nApiUnreachableError";
  }
}

/** Keep in sync with N8N_AUDIT_EXIT_API_UNREACHABLE in
 *  src/server/lib/n8n-drift-audit-classifier.ts. */
export const EXIT_API_UNREACHABLE = 2;

// ─── API-key drift patterns ─────────────────────────────────────────
// Each pattern matches a literal credential value. Env-var references
// like `{{ $env.BRAVE_API_KEY }}` and `{{$env.TAVILY_API_KEY}}` do NOT
// match these patterns (they don't include the literal prefix bytes).
const API_KEY_PATTERNS = [
  { name: "brave", regex: /BSA[a-zA-Z0-9\-_]{10,}/g },
  { name: "tavily", regex: /tvly-[a-zA-Z0-9\-_]{10,}/g },
  // D2 (deep-scan #22): broadened to catch modern OpenAI key formats.
  // The legacy `[a-zA-Z0-9]{20,}` class stopped at the first hyphen, so
  // `sk-proj-...` and `sk-svcacct-...` keys (project / service-account scoped,
  // the 2024+ default) slipped past — the class now allows `-` and `_` which
  // appear inside those key bodies.
  { name: "openai", regex: /sk-[a-zA-Z0-9_-]{20,}/g },
  { name: "parallel", regex: /l7Whs[a-zA-Z0-9_]{10,}/g },
  { name: "n8n_jwt", regex: /eyJhbGciOi[a-zA-Z0-9._\-]+/g },
];

// ─── D1 (deep-scan #22): retired Ollama model drift ─────────────────
// The tower serves EXACTLY ONE local model as of 2026-07-03: `gemma4:e4b-it-qat`
// (CLAUDE.md §15 tower-model consolidation). Every other model was RETIRED and
// is no longer pulled. A workflow node still referencing a retired model routes
// to a model the tower can't serve — a silent drift none of the checks above
// caught, because none inspect ollama `model` fields. Flag any node that
// references one of these retired model names.
const RETIRED_OLLAMA_MODELS = [
  "deepseek-r1",
  "nomic-embed-text",
  "qwen2.5-coder",
  "phi4-mini",
  "gemma4:e2b",
];
// Escape regex metacharacters in each literal name (qwen2.5-coder contains a `.`).
// `gemma4:e2b` does NOT match the served `gemma4:e4b-it-qat` (distinct `e2b`/`e4b`).
const RETIRED_MODEL_PATTERNS = RETIRED_OLLAMA_MODELS.map((name) => ({
  name,
  regex: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
}));

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
// settings.errorWorkflow = the canonical sink workflow ID.
//
// Pass 7 honest empirical state (verified 2026-05-21 via direct REST API):
//   - GET /api/v1/workflows/BbCvlV1ARyyvY3NI -> 404 NOT FOUND
//   - GET /api/v1/workflows/DGEk1D478xWJClKD -> 200, name="0A-health-monitor", active=true
//   - All 29 active workflows have settings.errorWorkflow = DGEk1D478xWJClKD
//
// CLAUDE.md §2 references "BbCvlV1ARyyvY3NI" but that workflow does not
// exist on Railway n8n. Whether it was the historical sink that got
// recreated under a new ID (e.g. during Wave 9 sqlite-wipe recovery), or
// CLAUDE.md was always wrong, the LIVE PRODUCTION REALITY is that
// DGEk1D478xWJClKD is the de-facto sink and 29/29 active workflows
// attach to it.
//
// The Pass 7 brief asked to revert to BbCvlV1ARyyvY3NI as the constant.
// That cannot be done honestly without first either (a) recreating the
// missing workflow, or (b) re-pointing all 29 workflows at a sink that
// returns 404. Either action is a fresh production hazard. We keep the
// constant pointed at the WORKFLOW THAT ACTUALLY EXISTS and document
// the CLAUDE.md drift in the Pass 7 runbook for operator resolution.
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

// Exported for regression coverage (fixwave2-scheduler-health-monitoring,
// 2026-07-17) — proves fetchWorkflows/fetchWorkflowDetail raise
// N8nApiUnreachableError (not a generic Error) on network failure / non-2xx
// response, which is what lets main().catch() pick exit code 2.
export async function fetchWorkflows(baseUrl, apiKey) {
  const all = [];
  let cursor;
  do {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/workflows`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { "X-N8N-API-KEY": apiKey },
      });
    } catch (networkErr) {
      // fetch() itself threw — DNS failure, connection refused, timeout, etc.
      // This is unreachability, never a drift finding.
      throw new N8nApiUnreachableError(`n8n API unreachable listing workflows: ${networkErr.message}`);
    }
    if (!res.ok) {
      // Non-2xx here (401 stale key, 5xx outage) means we never got workflow
      // data to evaluate — NOT that we evaluated it and found a violation.
      throw new N8nApiUnreachableError(`n8n API error: ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    all.push(...(body.data ?? []));
    cursor = body.nextCursor;
  } while (cursor);
  return all;
}

export async function fetchWorkflowDetail(baseUrl, apiKey, id) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/workflows/${id}`;
  let res;
  try {
    res = await fetch(url, { headers: { "X-N8N-API-KEY": apiKey } });
  } catch (networkErr) {
    throw new N8nApiUnreachableError(`n8n API unreachable fetching ${id}: ${networkErr.message}`);
  }
  if (!res.ok) {
    throw new N8nApiUnreachableError(`n8n API error fetching ${id}: ${res.status}`);
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

export function findApiKeys(workflowJson) {
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

// ─── D1: retired Ollama model reference detection ───────────────────
// Exported for regression coverage. Scans each node's serialized JSON for any
// retired model name (covers `model` fields wherever they live — ollama nodes,
// langchain lmChatOllama credentials, HTTP request bodies to /api/generate, etc.).
export function findRetiredModelRefs(workflowJson) {
  const violations = [];
  for (const node of workflowJson.nodes ?? []) {
    const ntext = nodeStringified(node);
    for (const pat of RETIRED_MODEL_PATTERNS) {
      pat.regex.lastIndex = 0;
      if (pat.regex.test(ntext)) {
        violations.push({ nodeName: node.name, model: pat.name });
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

// deep-scan n8n F-2: does any node reachable from `startTargets` connect back to `targetName`?
// A correctly-wired SplitInBatches has index 1 (loop) eventually loop BACK to itself, and index 0 (done)
// terminate. A SWAPPED wiring (loop body on index 0, terminal on index 1) is populated on both indices
// but reverses which one loops — invisible to a bare `idx1.length===0` check.
export function reachesNode(conns, startTargets, targetName, maxDepth = 100) {
  const seen = new Set();
  let frontier = (startTargets ?? []).map((t) => t?.node).filter(Boolean);
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const nodeName of frontier) {
      if (nodeName === targetName) return true;
      if (seen.has(nodeName)) continue;
      seen.add(nodeName);
      for (const branch of conns[nodeName]?.main ?? []) {
        if (Array.isArray(branch)) for (const t of branch) if (t?.node) next.push(t.node);
      }
    }
    frontier = next;
  }
  return false;
}

// ─── F-5b: SplitInBatches v3 wired to index 1 (loop), not index 0 ───
export function findSplitBatchesMisWired(workflowJson) {
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
      continue;
    }
    // deep-scan n8n F-2: catch the SWAPPED case (both indices populated, but reversed). The loop branch
    // (index 1) MUST loop back to this node; the done branch (index 0) must NOT.
    const idx1LoopsBack = reachesNode(conns, idx1, node.name);
    const idx0LoopsBack = reachesNode(conns, idx0, node.name);
    if (!idx1LoopsBack) {
      violations.push({
        nodeName: node.name,
        reason: "SplitInBatches v3 index 1 (loop) does NOT loop back to the node — the loop body never re-invokes it (index 0/1 likely swapped)",
        idx0_targets: idx0.length,
        idx1_targets: idx1.length,
        idx0LoopsBack,
        idx1LoopsBack,
      });
    } else if (idx0LoopsBack) {
      violations.push({
        nodeName: node.name,
        reason: "SplitInBatches v3 index 0 (done) loops back to the node — the terminal branch is wired as the loop (index 0/1 swapped)",
        idx0_targets: idx0.length,
        idx1_targets: idx1.length,
        idx0LoopsBack,
        idx1LoopsBack,
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

// ─── F-3: deactivated-but-not-archived detection ────────────────────
// A DEACTIVATED (paused) workflow is NOT in the `active` set, so the nine drift
// checks above never see it — the report would read "0 violations" while a
// production workflow sits quietly turned off (false-green). Flag every
// deactivated-but-not-archived workflow so a paused workflow is surfaced, not
// hidden. Archiving (isArchived=true) is the explicit "intentionally off"
// acknowledgement that clears the flag. Exported for regression coverage.
export function findDeactivatedWorkflows(list) {
  return (list ?? [])
    .filter((w) => w && w.active === false && !w.isArchived)
    .map((w) => ({
      workflowName: w.name,
      active: false,
      isArchived: false,
      note: "workflow is deactivated (paused) but not archived — was it intentional? Re-activate it, or archive it (isArchived=true) to acknowledge.",
    }));
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
    ["retired_models", "Retired Ollama model references (tower serves only gemma4:e4b-it-qat)"],
    ["single_symbol", "Single-symbol hardcoded prompts"],
    ["scout_signal_type", "Scout POSTs missing `signal_type`"],
    ["port_4100_alert", "Dead port-4100 /alert/* endpoints"],
    ["typeversion", "Outdated typeVersions"],
    ["error_workflow", "Missing ZZ Global Error Sink attachment"],
    ["split_batches", "SplitInBatches v3 mis-wired (loop body on index 0)"],
    ["webhook_auth", "Webhook trigger missing authentication"],
    ["http_retry", "External HTTP request missing retryOnFail"],
    ["deactivated", "Deactivated (paused) but not archived — intentional?"],
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
    // Missing config means we never got to evaluate a single workflow —
    // this is unreachability, not a drift finding. Throw so the shared
    // main().catch() below classifies it consistently with network/HTTP
    // failures raised from fetchWorkflows/fetchWorkflowDetail.
    throw new N8nApiUnreachableError(
      "N8N_API_URL (or N8N_BASE_URL) and N8N_API_KEY must be set. Example:\n" +
        "  N8N_API_URL=http://localhost:5678 N8N_API_KEY=... \\\n" +
        "    node scripts/audit-n8n-workflows.mjs",
    );
  }

  console.log(`Listing workflows from ${baseUrl}…`);
  const list = await fetchWorkflows(baseUrl, apiKey);
  const active = list.filter((w) => w.active && !w.isArchived);
  // F-3 (deep-scan false-green): DEACTIVATED-but-not-archived workflows are NOT in
  // `active`, so the nine drift checks skip them entirely — a silently-paused
  // production workflow would read as "0 violations". Surface them as a distinct
  // violation so a paused workflow is reported, not hidden.
  const deactivated = list.filter((w) => !w.active && !w.isArchived);
  console.log(`Auditing ${active.length} active workflows; ${deactivated.length} deactivated-not-archived flagged…`);

  const byWorkflow = [];
  for (const w of active) {
    const detail = await fetchWorkflowDetail(baseUrl, apiKey, w.id);
    const v = {
      api_keys: findApiKeys(detail),
      retired_models: findRetiredModelRefs(detail),
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

  // F-3: emit one violation per deactivated-but-not-archived workflow. No detail
  // fetch needed — the list row already carries name/active/isArchived. This makes
  // the report non-clean (exit 1) so the scheduler's drift alert fires and the
  // operator sees the paused workflow instead of a false "0 violations".
  for (const w of deactivated) {
    byWorkflow.push({
      id: w.id,
      name: w.name,
      violations: { deactivated: findDeactivatedWorkflows([w]) },
    });
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

// Run the audit only when executed directly (node scripts/audit-n8n-workflows.mjs), NOT when imported by a
// test (deep-scan n8n F-2: the detector functions above are exported for regression coverage — importing them
// must not fire the live audit, which hits the n8n REST API).
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain) {
  main().catch((err) => {
    // fixwave2-scheduler-health-monitoring (2026-07-17): distinguish "could
    // not reach the n8n API" (exit 2) from any other unexpected script
    // failure (exit 1, same as a genuine drift finding — conservative
    // default for a failure mode this script doesn't recognize). See the
    // EXIT 2 header comment above and src/server/lib/n8n-drift-audit-classifier.ts.
    if (err instanceof N8nApiUnreachableError) {
      console.error("audit-n8n-workflows: n8n API unreachable:", err.message);
      process.exit(EXIT_API_UNREACHABLE);
    }
    console.error("audit-n8n-workflows failed:", err);
    process.exit(1);
  });
}
