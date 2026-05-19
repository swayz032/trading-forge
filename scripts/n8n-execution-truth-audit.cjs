/**
 * Pass 21 v3 (2026-05-17) — actually prove which n8n workflows work.
 *
 * "Active" status on a workflow ONLY means it's enabled in n8n. It doesn't
 * mean the workflow has ever successfully fired. This script pulls real
 * execution evidence:
 *
 *   For each of 29 workflows:
 *     1. Trigger type (cron / webhook / manual)
 *     2. Last 5 executions: timestamp, status, mode
 *     3. Most recent error message (if any)
 *     4. Days since last run (if any)
 *     5. Verdict: WORKING (recent success), STALE (never run), BROKEN (recent error)
 *
 * Outputs per-workflow truth + summary categories.
 */
require("dotenv/config");

const N8N_URL = process.env.RAILWAY_N8N_URL || "https://n8n-production-84ff.up.railway.app";
const API_KEY = process.env.RAILWAY_N8N_API_KEY;
if (!API_KEY) { console.error("FATAL: RAILWAY_N8N_API_KEY missing"); process.exit(1); }

const HEADERS = { "X-N8N-API-KEY": API_KEY, "Accept": "application/json" };

async function getJson(path) {
  const r = await fetch(`${N8N_URL}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${path}`);
  return r.json();
}

function classifyTrigger(nodes) {
  for (const n of (nodes || [])) {
    if (n.type === "n8n-nodes-base.scheduleTrigger" || n.type === "n8n-nodes-base.cron") return "CRON";
    if (n.type === "n8n-nodes-base.webhook") return "WEBHOOK";
    if (n.type === "n8n-nodes-base.manualTrigger") return "MANUAL";
  }
  return "OTHER";
}

(async () => {
  console.log("Pulling all workflows from Railway n8n...");
  const wfList = (await getJson("/api/v1/workflows?limit=100")).data;
  console.log(`Total workflows on Railway: ${wfList.length}\n`);

  const results = [];
  for (const wf of wfList) {
    const trigger = classifyTrigger(wf.nodes);
    let recent = [];
    try {
      const exec = await getJson(`/api/v1/executions?workflowId=${wf.id}&limit=5`);
      recent = exec.data || [];
    } catch (e) { /* swallow */ }

    let lastRun = null;
    let lastStatus = null;
    let lastError = null;
    if (recent.length > 0) {
      const r0 = recent[0];
      lastRun = r0.startedAt ? new Date(r0.startedAt) : null;
      lastStatus = r0.status;
      if (r0.status === "error" || r0.finished === false) {
        // Pull execution detail for error message
        try {
          const detail = await getJson(`/api/v1/executions/${r0.id}?includeData=true`);
          const rd = detail.data?.resultData;
          if (rd?.runData) {
            for (const [nodeName, runs] of Object.entries(rd.runData)) {
              for (const run of (runs || [])) {
                if (run.error) { lastError = `[${nodeName}] ${run.error.message}`.slice(0, 200); break; }
              }
              if (lastError) break;
            }
          }
        } catch (e) { /* swallow */ }
      }
    }

    let verdict;
    const daysSince = lastRun ? Math.floor((Date.now() - lastRun.getTime()) / 86400000) : null;
    if (!lastRun) verdict = "NEVER_RUN";
    else if (lastStatus === "error" || lastStatus === "crashed") verdict = "BROKEN";
    else if (lastStatus === "success" && daysSince <= 7) verdict = "WORKING";
    else if (lastStatus === "success") verdict = "STALE_BUT_OK";
    else verdict = "UNKNOWN_" + lastStatus;

    results.push({
      name: wf.name,
      id: wf.id,
      active: wf.active,
      trigger,
      lastRun: lastRun ? lastRun.toISOString() : null,
      daysSince,
      lastStatus,
      lastError,
      verdict,
    });
    process.stdout.write(".");
  }
  console.log("\n");

  // ─── Report ─────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════");
  console.log("PER-WORKFLOW TRUTH");
  console.log("══════════════════════════════════════════════════════");
  results.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of results) {
    const symbol = r.verdict === "WORKING" ? "✓" : r.verdict === "BROKEN" ? "✗" : r.verdict === "NEVER_RUN" ? "○" : "?";
    console.log(`${symbol} [${r.verdict.padEnd(14)}] ${r.trigger.padEnd(7)} ${r.name}`);
    if (r.lastRun) console.log(`     last: ${r.lastRun}  (${r.daysSince}d ago)  status=${r.lastStatus}`);
    if (r.lastError) console.log(`     ERROR: ${r.lastError}`);
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("══════════════════════════════════════════════════════");
  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(16)} ${n}`);
  }
  console.log(`\nTotal: ${results.length} workflows`);

  // ─── Webhook test fires ────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("WEBHOOK LIVE TEST FIRES (the 2 webhook-trigger workflows)");
  console.log("══════════════════════════════════════════════════════");
  const webhooks = results.filter((r) => r.trigger === "WEBHOOK");
  for (const wf of webhooks) {
    console.log(`\n${wf.name}`);
    // Find webhook path from workflow nodes
    const full = await getJson(`/api/v1/workflows/${wf.id}`);
    const whNode = full.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
    if (!whNode?.parameters?.path) {
      console.log("  (no webhook path found in workflow)");
      continue;
    }
    const path = whNode.parameters.path;
    const method = whNode.parameters.httpMethod || "GET";
    const url = `${N8N_URL}/webhook/${path}`;
    console.log(`  Trigger URL: ${method} ${url}`);
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ test: "n8n-truth-audit", source: "production-fix" }),
      });
      console.log(`  → HTTP ${r.status}  ${r.statusText}`);
      if (r.status < 400) {
        const body = await r.text();
        console.log(`  body head: ${body.slice(0, 150)}`);
      }
    } catch (e) {
      console.log(`  ERR: ${e.message}`);
    }
  }
})();
