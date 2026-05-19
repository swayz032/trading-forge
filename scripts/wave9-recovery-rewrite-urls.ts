/**
 * Wave 9 Recovery — Phase H: rewrite host.docker.internal:* and localhost:*
 * URLs in LIVE imported workflows to point at the Railway tf-relay public URL.
 *
 * Mirrors logic of scripts/rewrite-workflow-backend-urls.ts but operates on
 * workflows pulled from n8n (not files on disk) and PUTs back via PATCH/PUT.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const BASE = process.env.N8N_BASE_URL || "https://n8n-production-84ff.up.railway.app";
const KEY = process.env.TF_N8N_API_KEY || process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;
const TARGET = process.env.TF_BACKEND_PUBLIC_URL;
if (!KEY) { console.error("Missing TF_N8N_API_KEY"); process.exit(1); }
if (!TARGET) { console.error("Missing TF_BACKEND_PUBLIC_URL"); process.exit(1); }

const N8N_RAILWAY_URL = BASE;
const PATH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https?:\/\/host\.docker\.internal:11434/gi, "/__ollama"],
  [/https?:\/\/localhost:11434/gi, "/__ollama"],
  [/https?:\/\/host\.docker\.internal:4100/gi, "/__oc"],
  [/https?:\/\/localhost:4100/gi, "/__oc"],
  [/https?:\/\/host\.docker\.internal:18789/gi, "/__ocg"],
  [/https?:\/\/localhost:18789/gi, "/__ocg"],
  [/https?:\/\/host\.docker\.internal:4000/g, ""],
  [/http:\/\/localhost:4000/g, ""],
  [/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/gi, ""],
  [/https?:\/\/[a-z0-9-]+\.tailfeba69\.ts\.net/gi, ""],
];
const N8N_SELF_PATTERNS = [
  /https?:\/\/localhost:5678/gi,
  /https?:\/\/host\.docker\.internal:5678/gi,
];

const h = () => ({ "X-N8N-API-KEY": KEY!, "Content-Type": "application/json", Accept: "application/json" });

const wfMap: Array<{ name: string; newId: string }> = JSON.parse(
  fs.readFileSync(path.resolve("tmp-n8n", "workflow-id-map.json"), "utf-8"),
);

function rewriteString(input: string): { out: string; count: number } {
  let out = input;
  let count = 0;
  for (const [pat, prefix] of PATH_REPLACEMENTS) {
    const before = out;
    out = out.replace(pat, TARGET + prefix);
    if (before !== out) count += (before.match(pat) ?? []).length;
  }
  for (const pat of N8N_SELF_PATTERNS) {
    const before = out;
    out = out.replace(pat, N8N_RAILWAY_URL);
    if (before !== out) count += (before.match(pat) ?? []).length;
  }
  return { out, count };
}

async function getWf(id: string): Promise<any> {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: h() });
  if (!r.ok) throw new Error(`GET ${id} HTTP ${r.status}`);
  return r.json();
}

async function putWf(id: string, wf: any): Promise<void> {
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method: "PUT", headers: h(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${id} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function main() {
  let touched = 0;
  let totalRepl = 0;
  for (const entry of wfMap) {
    const wf = await getWf(entry.newId);
    const original = JSON.stringify(wf);
    const { out, count } = rewriteString(original);
    if (count > 0) {
      const parsed = JSON.parse(out);
      await putWf(entry.newId, parsed);
      touched++;
      totalRepl += count;
      console.log(`  ${entry.name}  — ${count} replacements`);
    }
  }
  console.log(`\n=== Summary ===`);
  console.log(`  Workflows touched: ${touched}`);
  console.log(`  Total replacements: ${totalRepl}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
