// Wave 9 Track W9-1 v2 — close 7 drift violations using name-based lookup.
// Replaces tmp-n8n/w9-apply-fixes.mjs which used hardcoded pre-redeploy ids.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.TF_N8N_API_KEY;
if (!BASE || !KEY) { console.error("missing env"); process.exit(1); }

const wfMap = JSON.parse(fs.readFileSync(path.resolve(__dirname, "workflow-id-map.json"), "utf-8"));
const byName = new Map(wfMap.map((w) => [w.name, w.newId]));

function getId(name) {
  const id = byName.get(name);
  if (!id) throw new Error(`workflow not found in id map: ${name}`);
  return id;
}

async function getWf(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": KEY } });
  if (!r.ok) throw new Error(`GET ${id} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function putWf(id, full) {
  const allowed = {
    name: full.name,
    nodes: full.nodes,
    connections: full.connections,
    settings: full.settings ?? {},
    staticData: full.staticData ?? null,
  };
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(allowed),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`PUT ${id} -> ${r.status} ${txt}`);
}

function patchNode(wf, nodeName, mutator) {
  const n = wf.nodes.find((x) => x.name === nodeName);
  if (!n) throw new Error(`node not found in ${wf.name}: ${nodeName}`);
  mutator(n);
}

async function fix5G() {
  const id = getId("5G-brave-search-scout");
  const wf = await getWf(id);
  patchNode(wf, "Brave Search", (n) => {
    const hp = n.parameters.headerParameters?.parameters ?? [];
    const tok = hp.find((p) => p.name === "X-Subscription-Token");
    if (tok) tok.value = "={{ $env.BRAVE_API_KEY }}";
  });
  patchNode(wf, "Post Scout Ideas", (n) => {
    n.parameters.jsonBody =
      "={{ JSON.stringify({ ideas: ($json.ideas || []).map(i => Object.assign({}, i, { signal_type: 'strategy_candidate' })) }) }}";
  });
  await putWf(id, wf);
  console.log("5G updated");
}

async function fix5H() {
  const id = getId("5H-reddit-scout");
  const wf = await getWf(id);
  patchNode(wf, "Post Scout Ideas", (n) => {
    n.parameters.jsonBody =
      "={{ JSON.stringify({ ideas: ($json.ideas || []).map(i => Object.assign({}, i, { signal_type: 'strategy_candidate' })) }) }}";
  });
  await putWf(id, wf);
  console.log("5H updated");
}

async function fix3A() {
  const id = getId("3A-workflow-backup");
  const wf = await getWf(id);
  const fixHdr = (n) => {
    const hp = n.parameters.headerParameters?.parameters ?? [];
    const tok = hp.find((p) => p.name === "X-N8N-API-KEY" || p.name === "Authorization");
    if (tok) {
      tok.name = "X-N8N-API-KEY";
      tok.value = "={{ $env.TF_N8N_API_KEY }}";
    }
  };
  patchNode(wf, "GET All Workflows", fixHdr);
  patchNode(wf, "Fetch Workflow Detail", fixHdr);
  await putWf(id, wf);
  console.log("3A updated");
}

async function fixNightly() {
  const id = getId("Nightly Strategy Research Loop");
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
