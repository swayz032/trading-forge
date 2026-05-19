/**
 * Wave 9 Recovery Import (2026-05-17)
 *
 * After Railway redeploy wiped sqlite n8n state (all 29 workflows + creds), this
 * script restores the n8n instance from JSON backups with fresh-snapshot precedence.
 *
 * Pipeline:
 *   Phase A (run prior via wave9-recovery-creds.ts): 8 credentials recreated
 *   Phase B (this script):
 *     - Build workflow set with fresh-snapshot-precedence-by-name
 *     - Sanitize each payload (strip id/active/versionId/etc.)
 *     - Rewrite node credentials.<type>.id using cred-id-map.json
 *     - POST each as inactive; capture old→new id map
 *
 * Reads:
 *   tmp-n8n/cred-id-map.json    (from Phase A)
 *
 * Writes:
 *   tmp-n8n/workflow-id-map.json   ({name, oldId, newId, activeInSource}[])
 *   tmp-n8n/missing-creds-report.json   (nodes with unmapped credential names)
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const BASE = process.env.N8N_BASE_URL || "https://n8n-production-84ff.up.railway.app";
const KEY = process.env.TF_N8N_API_KEY || process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;
if (!KEY) { console.error("Missing TF_N8N_API_KEY in env"); process.exit(1); }

const ROOT = path.resolve(process.cwd());
const TMP = path.join(ROOT, "tmp-n8n");
const GIT_DIR = path.join(ROOT, "workflows", "n8n");

const CRED_MAP_PATH = path.join(TMP, "cred-id-map.json");
const WF_MAP_PATH = path.join(TMP, "workflow-id-map.json");
const MISSING_CREDS_PATH = path.join(TMP, "missing-creds-report.json");

if (!fs.existsSync(CRED_MAP_PATH)) {
  console.error(`Missing ${CRED_MAP_PATH} — run wave9-recovery-creds.ts first.`);
  process.exit(1);
}
const credMap: Record<string, string> = JSON.parse(fs.readFileSync(CRED_MAP_PATH, "utf-8"));

type Source = "fresh-w9" | "fresh-may17" | "git-stale";
interface WorkflowSource {
  file: string;
  fullPath: string;
  name: string;
  source: Source;
  raw: any;
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function unwrap(wf: any): any {
  if (wf && wf.success === true && wf.data && typeof wf.data === "object") return wf.data;
  return wf;
}

function collectSources(): WorkflowSource[] {
  const result: WorkflowSource[] = [];
  const seenNames = new Set<string>();

  // Priority 1: w9-* (4 files, post-Pass-21 incident hour snapshots)
  for (const file of fs.readdirSync(TMP).filter((f) => /^w9-[A-Za-z0-9]+\.json$/.test(f))) {
    const full = path.join(TMP, file);
    const raw = unwrap(readJson(full));
    if (!raw.name) continue;
    if (seenNames.has(raw.name)) continue;
    seenNames.add(raw.name);
    result.push({ file, fullPath: full, name: raw.name, source: "fresh-w9", raw });
  }

  // Priority 2: May 17 04:01 captures (5 files: Nightly, Weekly, 10A, 6D, Macro)
  const may17Files = ["10A.json", "6D.json", "Macro.json", "Nightly.json", "Weekly.json"];
  for (const file of may17Files) {
    const full = path.join(TMP, file);
    if (!fs.existsSync(full)) continue;
    const raw = unwrap(readJson(full));
    if (!raw.name) continue;
    if (seenNames.has(raw.name)) continue;
    seenNames.add(raw.name);
    result.push({ file, fullPath: full, name: raw.name, source: "fresh-may17", raw });
  }

  // Priority 3: workflows/n8n/*.json (stale git copies — skip any name already seen)
  for (const file of fs.readdirSync(GIT_DIR).filter((f) => f.endsWith(".json"))) {
    const full = path.join(GIT_DIR, file);
    const raw = unwrap(readJson(full));
    if (!raw.name) continue;
    if (seenNames.has(raw.name)) continue;
    seenNames.add(raw.name);
    result.push({ file, fullPath: full, name: raw.name, source: "git-stale", raw });
  }

  return result;
}

function rewriteCredIds(nodes: any[], missingReport: any[]): void {
  for (const node of nodes) {
    if (!node.credentials || typeof node.credentials !== "object") continue;
    for (const credType of Object.keys(node.credentials)) {
      const credRef = node.credentials[credType];
      if (!credRef || typeof credRef !== "object") continue;
      const credName = credRef.name;
      if (!credName) continue;
      const newId = credMap[credName];
      if (newId) {
        credRef.id = newId;
      } else {
        missingReport.push({
          workflow: node.__workflowName,
          node: node.name,
          credType,
          credName,
        });
      }
    }
  }
}

function sanitize(wf: any, workflowName: string): any {
  // n8n public POST /workflows accepts: name, nodes, connections, settings, staticData.
  // Strips: id, versionId, meta, pinData, tags, active, createdAt, updatedAt, isArchived,
  // shared, triggerCount.
  const nodes = (wf.nodes ?? []).map((n: any) => ({ ...n, __workflowName: workflowName }));
  return {
    name: wf.name,
    nodes,
    connections: wf.connections ?? {},
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
}

function stripWorkflowMarker(nodes: any[]): void {
  for (const n of nodes) delete n.__workflowName;
}

async function postWorkflow(body: any): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE}/api/v1/workflows`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function main() {
  const sources = collectSources();
  console.log(`Workflow sources resolved: ${sources.length}`);
  for (const s of sources) {
    console.log(`  [${s.source}] ${s.name}  (${s.file})`);
  }
  console.log("");

  const wfIdMap: Array<{ name: string; oldId: string | null; newId: string; activeInSource: boolean; source: Source }> = [];
  const missingReport: any[] = [];
  let posted = 0;
  let failed = 0;

  for (const src of sources) {
    const wf = src.raw;
    const oldId: string | null = wf.id ?? null;
    const activeInSource: boolean = wf.active === true;

    const body = sanitize(wf, src.name);
    rewriteCredIds(body.nodes, missingReport);
    stripWorkflowMarker(body.nodes);

    try {
      const created = await postWorkflow(body);
      wfIdMap.push({ name: src.name, oldId, newId: created.id, activeInSource, source: src.source });
      console.log(`  + [${src.source}] ${src.name}  → ${created.id}`);
      posted++;
    } catch (e: any) {
      console.log(`  x [${src.source}] ${src.name}  — ${e.message?.slice(0, 200)}`);
      failed++;
    }
  }

  fs.writeFileSync(WF_MAP_PATH, JSON.stringify(wfIdMap, null, 2));
  fs.writeFileSync(MISSING_CREDS_PATH, JSON.stringify(missingReport, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  Posted:  ${posted}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${sources.length}`);
  console.log(`  workflow-id-map.json   → ${wfIdMap.length} entries`);
  console.log(`  missing-creds-report.json → ${missingReport.length} unmapped credential refs`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
