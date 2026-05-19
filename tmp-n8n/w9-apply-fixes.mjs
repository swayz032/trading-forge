// Wave 9 Track W9-1 — close 7 n8n drift violations
// Updates 4 workflows via n8n public REST API PUT.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.TF_N8N_API_KEY;
if (!BASE || !KEY) { console.error("missing env"); process.exit(1); }

async function getWf(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": KEY } });
  if (!r.ok) throw new Error(`GET ${id} -> ${r.status} ${await r.text()}`);
  return await r.json();
}

// n8n public PUT /workflows/:id allows: name, nodes, connections, settings, staticData.
// Sending extra readonly fields like id, active, createdAt etc. will 400.
async function putWf(id, full) {
  const allowed = {
    name: full.name,
    nodes: full.nodes,
    connections: full.connections,
    settings: full.settings,
    staticData: full.staticData ?? null,
  };
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(allowed),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`PUT ${id} -> ${r.status} ${txt}`);
  return JSON.parse(txt);
}

function patchNode(wf, nodeName, mutator) {
  const n = wf.nodes.find((x) => x.name === nodeName);
  if (!n) throw new Error(`node not found: ${nodeName}`);
  mutator(n);
}

// ── Fix 1+2: 5G brave search hardcoded key + missing signal_type ──
async function fix5G() {
  const id = "9poOSNOCuWsJQidZ";
  const wf = await getWf(id);
  patchNode(wf, "Brave Search", (n) => {
    const hp = n.parameters.headerParameters.parameters;
    const tok = hp.find((p) => p.name === "X-Subscription-Token");
    tok.value = "={{ $env.BRAVE_API_KEY }}";
  });
  patchNode(wf, "Post Scout Ideas", (n) => {
    // Original body: {{ JSON.stringify({ ideas: $json.ideas }) }}
    // New body: inject signal_type='strategy_candidate' into each idea.
    n.parameters.jsonBody =
      "={{ JSON.stringify({ ideas: ($json.ideas || []).map(i => Object.assign({}, i, { signal_type: 'strategy_candidate' })) }) }}";
  });
  await putWf(id, wf);
  console.log("5G updated");
}

// ── Fix 3: 5H reddit scout missing signal_type ──
async function fix5H() {
  const id = "PlX9TmXAkIoRRKTO";
  const wf = await getWf(id);
  patchNode(wf, "Post Scout Ideas", (n) => {
    n.parameters.jsonBody =
      "={{ JSON.stringify({ ideas: ($json.ideas || []).map(i => Object.assign({}, i, { signal_type: 'strategy_candidate' })) }) }}";
  });
  await putWf(id, wf);
  console.log("5H updated");
}

// ── Fix 4+5: 3A workflow-backup hardcoded JWTs ──
async function fix3A() {
  const id = "fCwCHrq0zXYtbTox";
  const wf = await getWf(id);
  const fixHdr = (n) => {
    const hp = n.parameters.headerParameters.parameters;
    const tok = hp.find((p) => p.name === "X-N8N-API-KEY");
    tok.value = "={{ $env.TF_N8N_API_KEY }}";
  };
  patchNode(wf, "GET All Workflows", fixHdr);
  patchNode(wf, "Fetch Workflow Detail", fixHdr);
  await putWf(id, wf);
  console.log("3A updated");
}

// ── Fix 6: Nightly Strategy Research Loop single-symbol prompt ──
async function fixNightly() {
  const id = "ZUq9UufuWh5gZJi2";
  const wf = await getWf(id);
  patchNode(wf, "Generate Strategies", (n) => {
    n.parameters.text =
      "The current symbol is {{ $('Detect Market Regime').item.json.symbol || $json.symbol || 'ES' }} and the detected market regime is: {{ $('Detect Market Regime').item.json.regime }} (ADX: {{ $('Detect Market Regime').item.json.adx }}). " +
      "Generate 5 new vectorbt strategies for the configured symbol that are OPTIMIZED for this regime. " +
      "For example, if TRENDING_UP, favor momentum/trend-following strategies. If MEAN_REVERTING, favor mean reversion. If VOLATILE, favor breakout/volatility strategies. " +
      "Output valid Python code + JSON params. Max 5 params each. " +
      "Use only proven edges (mean reversion, momentum, volatility breakout, VWAP, order flow imbalance). " +
      "Return as a JSON array where each element has: strategy_name (string), one_sentence (string), python_code (string), params (object with max 5 keys). " +
      "Output ONLY the JSON array, no markdown, no explanation.";
    n.parameters.options = n.parameters.options || {};
    n.parameters.options.systemMessage =
      "You are an expert quantitative trading strategist for liquid futures markets. " +
      "You design systematic strategies using vectorbt for backtesting. " +
      "You only propose strategies with proven statistical edges. " +
      "You adapt strategy selection to the symbol and market regime supplied by the caller. " +
      "Always output valid, parseable JSON.";
  });
  await putWf(id, wf);
  console.log("Nightly updated");
}

(async () => {
  await fix5G();
  await fix5H();
  await fix3A();
  await fixNightly();
  console.log("All 4 workflows patched.");
})().catch((e) => { console.error(e); process.exit(1); });
