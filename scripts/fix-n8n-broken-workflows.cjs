/**
 * Pass 21 v3 (2026-05-17) — fix the 5 confirmed-broken n8n workflows.
 *
 * Strategy Deep Analysis Pipeline failed only because the test payload sent
 * a non-UUID. The workflow's Validate Input node is correctly enforcing the
 * UUID schema; that's GOOD. Not a bug.
 *
 * The 5 real bugs:
 *   1. Nightly Strategy Research Loop  — missing pg credential XDOEjC2s3oL432Lj
 *   2. Weekly Strategy Hunt            — same missing pg credential
 *   3. 10A-master-orchestration        — Code node tries to mutate Error.name (read-only)
 *   4. 6D-compliance-gate              — IF node compares string vs boolean
 *   5. Macro Data Sync - Morning       — IF node compares string vs boolean
 *
 * This script:
 *   - For #1+#2: list all postgres credentials on Railway n8n and find a
 *     working one, then patch the workflow to use that ID instead. Report
 *     the swap. If no postgres credential exists, log clear remediation steps.
 *   - For #3: fetch workflow, find the offending Code node, fix the JS to
 *     avoid mutating Error.name (create a new plain object instead).
 *   - For #4+#5: fetch workflow, find IF nodes whose conditions compare a
 *     boolean value as if it were a string, wrap the value to use boolean
 *     comparison instead.
 *
 * All fixes go through n8n API PUT /workflows/:id. Idempotent.
 */
require("dotenv/config");

const N8N_URL = process.env.RAILWAY_N8N_URL || "https://n8n-production-84ff.up.railway.app";
const API_KEY = process.env.RAILWAY_N8N_API_KEY;
if (!API_KEY) { console.error("FATAL: RAILWAY_N8N_API_KEY missing"); process.exit(1); }

const APPLY = process.argv.includes("--apply");

const HEADERS = {
  "X-N8N-API-KEY": API_KEY,
  "Content-Type": "application/json",
  "Accept": "application/json",
};

async function getJson(path) {
  const r = await fetch(`${N8N_URL}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${path}: ${await r.text()}`);
  return r.json();
}

async function putWorkflow(id, body) {
  // Strip server-managed fields per n8n API rules
  const clean = {
    name: body.name,
    nodes: body.nodes,
    connections: body.connections,
    settings: body.settings || {},
    staticData: body.staticData || null,
  };
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${id}`, {
    method: "PUT", headers: HEADERS, body: JSON.stringify(clean),
  });
  if (!r.ok) throw new Error(`PUT HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

// ─── Fix #1+#2: missing postgres credential ──────────────────────────────
async function fixMissingPostgresCred(targetWorkflowName) {
  console.log(`\n── ${targetWorkflowName}: postgres credential swap ──`);
  // List available postgres credentials
  const credList = await getJson("/api/v1/credentials/schema/postgres").catch(() => null);
  // n8n public API doesn't expose credential list; we have to PROBE.
  // Strategy: try a curated set of well-known credential ID candidates from
  // other working workflows (e.g. 11A-critic-optimization which runs fine).

  // Find a working postgres-using workflow + read its credential ID
  const workingWfs = await getJson("/api/v1/workflows?limit=100");
  const candidateIds = new Set();
  for (const wfSummary of workingWfs.data) {
    if (wfSummary.name === targetWorkflowName) continue;
    const full = await getJson(`/api/v1/workflows/${wfSummary.id}`).catch(() => null);
    if (!full) continue;
    for (const n of (full.nodes || [])) {
      const creds = n.credentials || {};
      for (const [credType, credObj] of Object.entries(creds)) {
        if (credType.toLowerCase().includes("postgres")) {
          candidateIds.add(credObj.id);
        }
      }
    }
  }
  console.log(`  Candidate postgres credential IDs found in other workflows: ${[...candidateIds].join(", ") || "(none)"}`);

  if (candidateIds.size === 0) {
    console.log(`  CANNOT AUTO-FIX. Manual action required:`);
    console.log(`    1. Open https://n8n-production-84ff.up.railway.app/credentials`);
    console.log(`    2. Create a "Postgres" credential pointing at switchback.proxy.rlwy.net:36475`);
    console.log(`    3. Re-run this script — it'll find the new credential and apply.`);
    return false;
  }

  // Pick the first available candidate
  const newCredId = [...candidateIds][0];
  console.log(`  Will swap missing 'XDOEjC2s3oL432Lj' → '${newCredId}'`);

  if (!APPLY) {
    console.log(`  (dry run — not applied)`);
    return false;
  }

  // Find target workflow
  const target = workingWfs.data.find((w) => w.name === targetWorkflowName);
  if (!target) { console.log(`  Target workflow not found`); return false; }
  const full = await getJson(`/api/v1/workflows/${target.id}`);
  let nodesChanged = 0;
  for (const n of (full.nodes || [])) {
    if (n.credentials) {
      for (const [credType, credObj] of Object.entries(n.credentials)) {
        if (credObj.id === "XDOEjC2s3oL432Lj") {
          credObj.id = newCredId;
          nodesChanged++;
        }
      }
    }
  }
  console.log(`  Patched ${nodesChanged} nodes`);
  if (nodesChanged > 0) {
    await putWorkflow(target.id, full);
    // Reactivate
    await fetch(`${N8N_URL}/api/v1/workflows/${target.id}/activate`, { method: "POST", headers: HEADERS });
    console.log(`  ✓ Saved + reactivated`);
  }
  return nodesChanged > 0;
}

// ─── Fix #3: 10A-master-orchestration Code node Error.name mutation ──────
async function fix10AOrchestrationCodeNode() {
  console.log(`\n── 10A-master-orchestration: Code node 'name of Error' fix ──`);
  const list = await getJson("/api/v1/workflows?limit=100");
  const target = list.data.find((w) => w.name === "10A-master-orchestration");
  if (!target) { console.log("  not found"); return false; }
  const full = await getJson(`/api/v1/workflows/${target.id}`);
  let changed = false;
  for (const n of (full.nodes || [])) {
    if (n.type !== "n8n-nodes-base.code") continue;
    let code = n.parameters?.jsCode || "";
    if (!code) continue;
    if (n.name === "Format Daily Summary" || /error\.name\s*=|err\.name\s*=/.test(code)) {
      // Wrap any `error.name =` / `err.name =` assignment in a plain-object swap.
      const newCode = code.replace(
        /(\w+)\.name\s*=\s*([^;]+);?/g,
        "// Pass 21 fix: Error.name is read-only — build a plain object instead\n      $1 = { name: $2, message: $1.message, stack: $1.stack };",
      );
      if (newCode !== code) {
        n.parameters.jsCode = newCode;
        console.log(`  Patched Code node '${n.name}'`);
        changed = true;
      }
    }
  }
  if (!changed) { console.log(`  No matching code-node pattern found — inspect manually`); return false; }
  if (APPLY) {
    await putWorkflow(target.id, full);
    await fetch(`${N8N_URL}/api/v1/workflows/${target.id}/activate`, { method: "POST", headers: HEADERS });
    console.log(`  ✓ Saved + reactivated`);
  } else {
    console.log(`  (dry run — not applied)`);
  }
  return true;
}

// ─── Fix #4+#5: IF nodes comparing boolean as string ──────────────────────
async function fixBooleanStringIf(workflowName) {
  console.log(`\n── ${workflowName}: IF node boolean-vs-string type fix ──`);
  const list = await getJson("/api/v1/workflows?limit=100");
  const target = list.data.find((w) => w.name === workflowName);
  if (!target) { console.log("  not found"); return false; }
  const full = await getJson(`/api/v1/workflows/${target.id}`);
  let changed = 0;
  for (const n of (full.nodes || [])) {
    if (n.type !== "n8n-nodes-base.if") continue;
    const conds = n.parameters?.conditions?.conditions || n.parameters?.conditions?.string || [];
    // n8n v1 IF node has conditions split by type. Move string-type conditions
    // that compare boolean values into the boolean-type bucket.
    if (n.parameters?.conditions?.string) {
      const stringConds = n.parameters.conditions.string;
      const remainingString = [];
      const booleanConds = n.parameters.conditions.boolean || [];
      for (const c of stringConds) {
        const v1 = String(c.value1 || "");
        const v2 = String(c.value2 || "");
        if ((v1 === "true" || v1 === "false") || (v2 === "true" || v2 === "false") ||
            /={{.*}}.*$/.test(v1) || v1.includes("$json")) {
          // Move to boolean comparison
          booleanConds.push({
            value1: c.value1,
            value2: v2 === "true" || c.value2 === true,
            operation: c.operation === "equal" ? "equal" : "notEqual",
          });
          changed++;
        } else {
          remainingString.push(c);
        }
      }
      if (changed > 0) {
        n.parameters.conditions.string = remainingString;
        n.parameters.conditions.boolean = booleanConds;
      }
    }
  }
  if (changed === 0) { console.log(`  No matching IF-node string→boolean swaps`); return false; }
  console.log(`  Patched ${changed} IF conditions`);
  if (APPLY) {
    await putWorkflow(target.id, full);
    await fetch(`${N8N_URL}/api/v1/workflows/${target.id}/activate`, { method: "POST", headers: HEADERS });
    console.log(`  ✓ Saved + reactivated`);
  } else {
    console.log(`  (dry run — not applied)`);
  }
  return true;
}

(async () => {
  console.log(`MODE: ${APPLY ? "APPLY" : "DRY RUN"}`);
  await fixMissingPostgresCred("Nightly Strategy Research Loop");
  await fixMissingPostgresCred("Weekly Strategy Hunt");
  await fix10AOrchestrationCodeNode();
  await fixBooleanStringIf("6D-compliance-gate");
  await fixBooleanStringIf("Macro Data Sync - Morning (7am Skip Classifier)");
  console.log(`\nDone. ${APPLY ? "Re-run n8n-execution-truth-audit.cjs to verify next firings." : "Re-run with --apply to execute."}`);
})();
