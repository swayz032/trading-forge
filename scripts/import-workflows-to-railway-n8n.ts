/**
 * Pass 21 (2026-05-12) — bulk-import all workflow JSON backups into
 * Railway-hosted n8n via the REST API.
 *
 * Usage:
 *   RAILWAY_N8N_API_KEY=<paste-key> npx tsx scripts/import-workflows-to-railway-n8n.ts            # DRY-RUN (default)
 *   RAILWAY_N8N_API_KEY=<paste-key> npx tsx scripts/import-workflows-to-railway-n8n.ts --apply    # actually PUT/POST
 *
 * F-4 (deep-scan): this script PUTs the local workflow JSON over the LIVE Railway
 * workflow matched by NAME — with no diff, no backup, no confirmation. Any edit an
 * operator made in the n8n UI is silently reverted to whatever the local JSON holds.
 * It now DEFAULTS to a dry-run that prints exactly which live workflows WOULD be
 * overwritten (and warns that live-UI edits to those will be lost); pass `--apply`
 * to perform the real PUT/POST. Mirrors the safe default in
 * scripts/wipe-strategy-bucket-fresh-start.ts.
 *
 * Idempotent — checks for existing workflow with the same name first; updates
 * via PUT if it exists, otherwise POSTs to create.
 *
 * Reads every *.json file under workflows/n8n/ and pushes them to the Railway
 * n8n service. Strips fields the REST API rejects on create (id, createdAt,
 * updatedAt, versionId, activeVersionId, isArchived).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const RAILWAY_URL = "https://n8n-production-84ff.up.railway.app";
const API_KEY = process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;

// F-4: dry-run by DEFAULT — an unguarded PUT reverts live-UI edits silently. Only
// `--apply` performs real writes.
const ARGS = new Set(process.argv.slice(2));
const IS_APPLY = ARGS.has("--apply");
const IS_DRY_RUN = !IS_APPLY;

if (!API_KEY) {
  console.error("ERROR: Set RAILWAY_N8N_API_KEY env var (or N8N_API_KEY).");
  console.error("Generate one at: " + RAILWAY_URL + " → Settings → API → Create API Key");
  process.exit(1);
}

const WORKFLOWS_DIR = path.resolve("workflows/n8n");

function headers() {
  return { "X-N8N-API-KEY": API_KEY!, "Content-Type": "application/json", Accept: "application/json" };
}

function sanitize(wf: any): any {
  // Some backup JSONs use { success, data: { name, nodes, ... } } envelope
  // (export endpoint format). Unwrap if so.
  if (wf && wf.success === true && wf.data && typeof wf.data === "object") {
    wf = wf.data;
  }
  // Fields the REST API rejects or ignores on create/update
  const clean: any = {
    name: wf.name,
    nodes: wf.nodes ?? [],
    connections: wf.connections ?? {},
    settings: wf.settings ?? {},
    staticData: wf.staticData ?? null,
  };
  return clean;
}

async function listExisting(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const res = await fetch(`${RAILWAY_URL}/api/v1/workflows`, { headers: headers() });
  if (!res.ok) throw new Error(`list failed HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json() as any;
  const items = j.data ?? j ?? [];
  for (const w of items) if (w.name && w.id) map.set(w.name, w.id);
  return map;
}

async function createWorkflow(body: any): Promise<{ id: string; name: string }> {
  const res = await fetch(`${RAILWAY_URL}/api/v1/workflows`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST failed HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function updateWorkflow(id: string, body: any): Promise<void> {
  const res = await fetch(`${RAILWAY_URL}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT failed HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

async function main() {
  if (IS_DRY_RUN) {
    console.log("=== DRY-RUN (default) — NOTHING is written to Railway n8n. ===");
    console.log("=== Re-run with --apply to actually PUT/POST. Any live-UI edit to a workflow listed below as WOULD-OVERWRITE will be LOST on --apply. ===\n");
  } else {
    console.log("=== --apply — LIVE WRITE MODE: local JSON will OVERWRITE matching Railway workflows by name; live-UI edits to those workflows are LOST. ===\n");
  }

  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} workflow JSON files in ${WORKFLOWS_DIR}\n`);

  const existing = await listExisting();
  console.log(`Existing workflows on Railway n8n: ${existing.size}\n`);

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf-8");
    let wf: any;
    try { wf = JSON.parse(raw); }
    catch (e: any) { console.log(`  ✗  ${file}  — JSON parse failed: ${e.message}`); failed++; continue; }

    const body = sanitize(wf);
    if (!body.name) { console.log(`  ✗  ${file}  — missing 'name' field`); failed++; continue; }

    try {
      if (existing.has(body.name)) {
        const id = existing.get(body.name)!;
        if (IS_DRY_RUN) {
          console.log(`  ~  ${body.name}  — WOULD OVERWRITE live workflow (id=${id.slice(0, 8)}) — any live-UI edit to it will be LOST`);
        } else {
          await updateWorkflow(id, body);
          console.log(`  ↻  ${body.name}  — updated (id=${id.slice(0, 8)})`);
        }
        updated++;
      } else {
        if (IS_DRY_RUN) {
          console.log(`  ~  ${body.name}  — WOULD CREATE (not present on Railway n8n)`);
        } else {
          const r = await createWorkflow(body);
          console.log(`  +  ${body.name}  — created (id=${(r.id ?? "?").slice(0, 8)})`);
        }
        created++;
      }
    } catch (e: any) {
      console.log(`  ✗  ${body.name}  — ${e.message?.slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\n=== Summary (${IS_DRY_RUN ? "DRY-RUN — no changes made" : "APPLIED"}) ===`);
  console.log(`  ${IS_DRY_RUN ? "Would create" : "Created"}: ${created}`);
  console.log(`  ${IS_DRY_RUN ? "Would overwrite" : "Updated"}: ${updated}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${files.length}`);

  if (IS_DRY_RUN) {
    console.log(`\nDry-run complete — no workflows were written. Re-run with --apply to push these changes.`);
  } else if (failed === 0) {
    console.log(`\n✓ All workflows imported. Activate them via the n8n UI or by setting active=true through the API.`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
