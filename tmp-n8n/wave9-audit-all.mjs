// Audit ALL imported workflows (active OR inactive) for W9-1 drift patterns.
// Mirrors scripts/audit-n8n-workflows.mjs but doesn't filter by active flag.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.TF_N8N_API_KEY;

const API_KEY_PATTERNS = [
  { name: "brave", regex: /BSA[a-zA-Z0-9\-_]{10,}/g },
  { name: "tavily", regex: /tvly-[a-zA-Z0-9\-_]{10,}/g },
  { name: "openai", regex: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "parallel", regex: /l7Whs[a-zA-Z0-9_]{10,}/g },
  { name: "n8n_jwt", regex: /eyJhbGciOi[a-zA-Z0-9._\-]+/g },
];
const SINGLE_SYMBOL_PHRASES = [
  /\bES futures\b/i,
  /specializing in ES\b/i,
  /\bE-mini S&P 500\b/i,
];
const SCOUT_PATH_REGEX = /\/scout-ideas(\/strict)?(?:\b|$)/;
const TYPE_VERSION_FLOORS = {
  "n8n-nodes-base.httpRequest": 4.2,
  "n8n-nodes-base.scheduleTrigger": 1.2,
};
const ALLOW_MARKER = /#\s*n8n-drift-allowed\s*:\s*([^\n\r]+)/i;
const isAllowed = (n) => ALLOW_MARKER.test(typeof n?.notes === "string" ? n.notes : "");

async function listAll() {
  const all = [];
  let cursor;
  do {
    const u = new URL(`${BASE}/api/v1/workflows`);
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { "X-N8N-API-KEY": KEY } });
    const j = await r.json();
    all.push(...(j.data ?? []));
    cursor = j.nextCursor;
  } while (cursor);
  return all;
}
async function detail(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": KEY } });
  return r.json();
}

function findApiKeys(wf) {
  const out = [];
  const text = JSON.stringify(wf);
  for (const p of API_KEY_PATTERNS) {
    p.regex.lastIndex = 0;
    if (text.match(p.regex)) {
      for (const node of wf.nodes ?? []) {
        p.regex.lastIndex = 0;
        if (p.regex.test(JSON.stringify(node))) out.push({ node: node.name, key: p.name });
      }
    }
  }
  return out;
}
function findSym(wf) {
  const out = [];
  for (const n of wf.nodes ?? []) {
    if (isAllowed(n)) continue;
    if (!/agent|langchain|chatModel|openAi|chat/i.test(String(n.type ?? ""))) continue;
    const p = n.parameters ?? {};
    const cand = [p.systemMessage, p?.options?.systemMessage, p.text, p.prompt, p?.messages?.values && JSON.stringify(p.messages.values)].filter((v) => typeof v === "string");
    for (const t of cand) for (const ph of SINGLE_SYMBOL_PHRASES) if (ph.test(t)) { out.push({ node: n.name, phrase: ph.source, snippet: t.slice(0, 160) }); break; }
  }
  return out;
}
function findScout(wf) {
  const out = [];
  for (const n of wf.nodes ?? []) {
    if (!/httpRequest/i.test(String(n.type ?? ""))) continue;
    const p = n.parameters ?? {};
    if (!SCOUT_PATH_REGEX.test(String(p.url ?? ""))) continue;
    const bodyParts = [p.jsonBody, p.body, JSON.stringify(p.bodyParameters ?? {}), JSON.stringify(p.bodyParametersJson ?? {})].filter((v) => typeof v === "string").join("\n");
    if (!/\bsignal_type\b/.test(bodyParts)) out.push({ node: n.name, url: p.url });
  }
  return out;
}
function findPort4100(wf) {
  const out = [];
  for (const n of wf.nodes ?? []) {
    if (!/httpRequest/i.test(String(n.type ?? ""))) continue;
    const u = String(n.parameters?.url ?? "");
    if (/host\.docker\.internal:4100\/alert\//i.test(u)) out.push({ node: n.name, url: u });
  }
  return out;
}
function findVer(wf) {
  const out = [];
  for (const n of wf.nodes ?? []) {
    const f = TYPE_VERSION_FLOORS[String(n.type ?? "")];
    if (f === undefined) continue;
    const v = Number(n.typeVersion ?? 0);
    if (!Number.isFinite(v) || v < f) out.push({ node: n.name, type: n.type, version: v, floor: f });
  }
  return out;
}

(async () => {
  const all = (await listAll()).filter((w) => !w.isArchived);
  console.log(`Auditing ALL ${all.length} workflows (active + inactive)…`);
  let total = 0;
  const report = [];
  for (const w of all) {
    const d = await detail(w.id);
    const v = { api_keys: findApiKeys(d), single_symbol: findSym(d), scout_signal_type: findScout(d), port_4100_alert: findPort4100(d), typeversion: findVer(d) };
    const sum = Object.values(v).reduce((a, b) => a + b.length, 0);
    if (sum > 0) { report.push({ id: w.id, name: w.name, active: w.active, v }); total += sum; }
  }
  console.log(`Total violations: ${total}\n`);
  for (const r of report) {
    console.log(`--- ${r.name} (active=${r.active}) ---`);
    for (const k of Object.keys(r.v)) if (r.v[k].length) console.log(`  ${k}: ${JSON.stringify(r.v[k])}`);
  }
  if (total > 0) process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
