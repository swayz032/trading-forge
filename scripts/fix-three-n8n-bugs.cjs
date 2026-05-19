/**
 * Pass 21 v3 (2026-05-17) — fix the 3 actual remaining n8n bugs:
 *   1. 10A-master-orchestration "Format Daily Summary" — outer-try wrap
 *   2. 6D-compliance-gate "Any Paper?" — string→boolean IF type
 *   3. Macro Data Sync - Morning "IF Any SIT_OUT" — string→boolean IF type
 *
 * Uses raw n8n PUT /api/v1/workflows/:id (MCP server isn't pointed at Railway).
 */
require("dotenv/config");
const N8N_URL = process.env.RAILWAY_N8N_URL || "https://n8n-production-84ff.up.railway.app";
const API_KEY = process.env.RAILWAY_N8N_API_KEY;
if (!API_KEY) { console.error("FATAL: RAILWAY_N8N_API_KEY missing"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const H = { "X-N8N-API-KEY": API_KEY, "Content-Type": "application/json", "Accept": "application/json" };

const NEW_10A_CODE = `// Pass 21 v3 fix (2026-05-17): outer try wraps every $() lookup to prevent n8n's
// internal NodeOperationError mutation of Error.name (read-only in strict mode).
function safe(name) {
  try {
    const items = $items(name);
    if (!items || items.length === 0) return null;
    return items[0].json || null;
  } catch (e) {
    return null;
  }
}

let healthStatus = 'unknown';
let stratList = [];
let s = {};
try {
  const health = safe('Check System Health') || {};
  const stats = safe('Fetch Pipeline Stats') || {};
  const strategies = safe('Check Strategy Pipeline') || {};
  s = stats.data || stats || {};
  const strats = strategies.data || strategies || [];
  stratList = Array.isArray(strats) ? strats : [];
  healthStatus = health.status || health.error || 'unknown';
} catch (e) {
  healthStatus = 'error: ' + (e && e.message ? e.message : 'unknown');
}

const activeCount = stratList.filter(x => x.lifecycleState === 'ACTIVE' || x.lifecycleState === 'PAPER').length;
const testingCount = stratList.filter(x => x.lifecycleState === 'TESTING').length;
const decayCount = stratList.filter(x => x.lifecycleState === 'DECLINING' || x.decaying).length;

const lines = [
  'System Health: ' + healthStatus,
  'Total Strategies: ' + stratList.length,
  'Active/Paper: ' + activeCount,
  'Testing: ' + testingCount,
  'Declining: ' + decayCount,
  'Ideas sourced: ' + (s.totalIdeas ?? s.ideas ?? 'N/A'),
  'Backtests run: ' + (s.totalBacktests ?? s.backtests ?? 'N/A'),
  'Pass rate: ' + (s.passRate ?? 'N/A')
];

const severity = healthStatus !== 'ok' ? 'warning' : 'info';
return [{ json: { event: 'orchestration:daily-summary', data: { title: 'Daily Pipeline Summary (5 AM ET)', severity, body: lines.join('\\n'), healthStatus, strategyCount: stratList.length, activeCount, testingCount, decayCount } } }];`;

async function getWf(id) {
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${id}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${id}: ${r.status}`);
  return r.json();
}
async function putWf(id, body) {
  const clean = { name: body.name, nodes: body.nodes, connections: body.connections, settings: body.settings || {}, staticData: body.staticData || null };
  const r = await fetch(`${N8N_URL}/api/v1/workflows/${id}`, { method: "PUT", headers: H, body: JSON.stringify(clean) });
  if (!r.ok) throw new Error(`PUT ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function reactivate(id) {
  await fetch(`${N8N_URL}/api/v1/workflows/${id}/activate`, { method: "POST", headers: H });
}

function fixIfNode(node, label) {
  // n8n v2 IF node conditions structure: parameters.conditions.conditions[]
  // Each condition has: id, leftValue, rightValue, operator: {type, operation}
  // The error is rightValue type doesn't match operator.type. We need to either
  // change operator.type to 'boolean' OR ensure rightValue is the string "true"/"false".
  let changes = 0;
  const params = node.parameters || {};
  const c = params.conditions;
  if (!c) return 0;

  // v2 (filter-like) shape
  if (Array.isArray(c.conditions)) {
    for (const cond of c.conditions) {
      const left = cond.leftValue;
      const right = cond.rightValue;
      // If right is boolean (true/false) or left expression resolves to boolean,
      // ensure operator.type === 'boolean'
      const isBoolLiteral = (v) => typeof v === 'boolean' || v === 'true' || v === 'false';
      const opType = cond.operator?.type;
      if (isBoolLiteral(right) && opType !== 'boolean') {
        cond.operator = cond.operator || {};
        cond.operator.type = 'boolean';
        // operation 'equals' for boolean uses 'equals' / 'notEquals' or 'true'/'false'
        if (!cond.operator.operation) cond.operator.operation = 'equals';
        // rightValue should be actual boolean for type:boolean
        cond.rightValue = (right === true || right === 'true');
        changes++;
        console.log(`    ${label}: condition normalized → boolean (rightValue=${cond.rightValue})`);
      }
    }
  }
  // v1 shape (string/boolean buckets)
  if (c.string && Array.isArray(c.string)) {
    const remain = [];
    const bools = c.boolean || [];
    for (const cond of c.string) {
      const v2 = String(cond.value2 ?? '');
      if (v2 === 'true' || v2 === 'false' || cond.value2 === true || cond.value2 === false) {
        bools.push({
          value1: cond.value1,
          value2: cond.value2 === true || v2 === 'true',
          operation: cond.operation === 'notEqual' ? 'notEqual' : 'equal',
        });
        changes++;
        console.log(`    ${label}: v1 string→boolean swap`);
      } else { remain.push(cond); }
    }
    if (changes > 0) {
      c.string = remain;
      c.boolean = bools;
    }
  }
  return changes;
}

(async () => {
  console.log(`MODE: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // ── Fix 10A ─────────────────────────────────────────────────────
  console.log("── 10A-master-orchestration: Format Daily Summary outer-try fix ──");
  const wf10A = await getWf("UhAvoHwWdrgxyAod");
  const codeNode = wf10A.nodes.find((n) => n.name === "Format Daily Summary");
  if (!codeNode) console.log("  node not found");
  else {
    const before = codeNode.parameters.jsCode.length;
    codeNode.parameters.jsCode = NEW_10A_CODE;
    console.log(`  Replaced jsCode (${before} → ${NEW_10A_CODE.length} chars)`);
    if (APPLY) { await putWf("UhAvoHwWdrgxyAod", wf10A); await reactivate("UhAvoHwWdrgxyAod"); console.log("  ✓ saved + reactivated"); }
  }

  // ── Fix 6D ──────────────────────────────────────────────────────
  console.log("\n── 6D-compliance-gate: 'Any Paper?' IF boolean-type fix ──");
  const wf6D = await getWf("hiGZoK75NTUeSfrr");
  const ifNode6D = wf6D.nodes.find((n) => n.name === "Any Paper?");
  if (!ifNode6D) console.log("  node not found");
  else {
    const changes = fixIfNode(ifNode6D, "Any Paper?");
    console.log(`  conditions changed: ${changes}`);
    if (APPLY && changes > 0) { await putWf("hiGZoK75NTUeSfrr", wf6D); await reactivate("hiGZoK75NTUeSfrr"); console.log("  ✓ saved + reactivated"); }
  }

  // ── Fix Macro ───────────────────────────────────────────────────
  console.log("\n── Macro Data Sync - Morning: 'IF Any SIT_OUT' IF boolean-type fix ──");
  const wfMacro = await getWf("wL2GrvUVHvpVL5Pi");
  const ifNodeMacro = wfMacro.nodes.find((n) => n.name === "IF Any SIT_OUT");
  if (!ifNodeMacro) console.log("  node not found");
  else {
    const changes = fixIfNode(ifNodeMacro, "IF Any SIT_OUT");
    console.log(`  conditions changed: ${changes}`);
    if (APPLY && changes > 0) { await putWf("wL2GrvUVHvpVL5Pi", wfMacro); await reactivate("wL2GrvUVHvpVL5Pi"); console.log("  ✓ saved + reactivated"); }
  }

  console.log(`\n${APPLY ? "✓ All patches applied." : "Re-run with --apply to execute."}`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
