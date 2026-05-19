/**
 * Wave 9 Recovery — Phase C: post-import patches.
 *
 *  1. Re-rewrite credential ids using updated cred-id-map.json (covers aliases
 *     like "Ollama account", "Postgres account", "Railway Postgres (langchain...").
 *  2. Rewrite settings.errorWorkflow to the new 0A-health-monitor id.
 *  3. PUT each modified workflow back to n8n.
 *
 * Reads tmp-n8n/workflow-id-map.json + tmp-n8n/cred-id-map.json.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const BASE = process.env.N8N_BASE_URL || "https://n8n-production-84ff.up.railway.app";
const KEY = process.env.TF_N8N_API_KEY || process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;
if (!KEY) { console.error("Missing TF_N8N_API_KEY"); process.exit(1); }

const TMP = path.resolve("tmp-n8n");
const credMap: Record<string, string> = JSON.parse(fs.readFileSync(path.join(TMP, "cred-id-map.json"), "utf-8"));
const wfMap: Array<{ name: string; newId: string; activeInSource: boolean; source: string }> =
  JSON.parse(fs.readFileSync(path.join(TMP, "workflow-id-map.json"), "utf-8"));

const h = () => ({ "X-N8N-API-KEY": KEY!, "Content-Type": "application/json", Accept: "application/json" });

async function getWf(id: string): Promise<any> {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: h() });
  if (!r.ok) throw new Error(`GET ${id} HTTP ${r.status}: ${await r.text()}`);
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
  const ha = wfMap.find((w) => w.name === "0A-health-monitor");
  if (!ha) { console.error("0A-health-monitor not in workflow-id-map.json"); process.exit(1); }
  const newHealthMonitorId = ha.newId;
  console.log(`New 0A-health-monitor id: ${newHealthMonitorId}\n`);

  let patched = 0;
  let failed = 0;
  const stillMissing: any[] = [];

  for (const entry of wfMap) {
    try {
      const wf = await getWf(entry.newId);
      let changed = false;

      // 1. errorWorkflow rewrite
      if (!wf.settings) wf.settings = {};
      if (wf.settings.errorWorkflow !== newHealthMonitorId) {
        wf.settings.errorWorkflow = newHealthMonitorId;
        changed = true;
      }

      // 2. credential id rewrite (covers aliases added post-import)
      for (const node of wf.nodes ?? []) {
        if (!node.credentials || typeof node.credentials !== "object") continue;
        for (const credType of Object.keys(node.credentials)) {
          const ref = node.credentials[credType];
          if (!ref || typeof ref !== "object" || !ref.name) continue;
          const want = credMap[ref.name];
          if (want && ref.id !== want) {
            ref.id = want;
            changed = true;
          }
          if (!want) {
            stillMissing.push({ workflow: entry.name, node: node.name, credType, credName: ref.name });
          }
        }
      }

      if (changed) {
        await putWf(entry.newId, wf);
        patched++;
        console.log(`  ↻ ${entry.name}`);
      } else {
        console.log(`  = ${entry.name}  (no change)`);
      }
    } catch (e: any) {
      failed++;
      console.log(`  x ${entry.name}  — ${e.message?.slice(0, 200)}`);
    }
  }

  fs.writeFileSync(path.join(TMP, "missing-creds-report.json"), JSON.stringify(stillMissing, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  Patched: ${patched}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Still-missing cred refs: ${stillMissing.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
