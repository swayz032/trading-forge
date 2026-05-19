/**
 * Pass 21 (2026-05-12) — activate imported workflows on Railway n8n.
 * Reads the source JSON's `active` field and POSTs /api/v1/workflows/:id/activate
 * for any workflow that should be running.
 *
 * Run AFTER scripts/import-workflows-to-railway-n8n.ts completes successfully.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const RAILWAY_URL = process.env.RAILWAY_N8N_URL || "https://n8n-production-84ff.up.railway.app";
const API_KEY = process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;

if (!API_KEY) {
  console.error("Set RAILWAY_N8N_API_KEY env var.");
  process.exit(1);
}

const WORKFLOWS_DIR = path.resolve("workflows/n8n");

function headers() {
  return { "X-N8N-API-KEY": API_KEY!, "Content-Type": "application/json", Accept: "application/json" };
}

function unwrap(wf: any): any {
  if (wf && wf.success === true && wf.data && typeof wf.data === "object") return wf.data;
  return wf;
}

async function main() {
  const list = await fetch(`${RAILWAY_URL}/api/v1/workflows`, { headers: headers() });
  const j: any = await list.json();
  const items = j.data ?? j ?? [];
  const byName = new Map<string, string>();
  for (const w of items) if (w.name && w.id) byName.set(w.name, w.id);

  let activated = 0;
  let alreadyOn = 0;
  let leftOff = 0;
  let failed = 0;

  for (const file of fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json"))) {
    const wf = unwrap(JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf-8")));
    if (!wf.name) { failed++; continue; }
    const id = byName.get(wf.name);
    if (!id) { console.log(`  ?  ${wf.name}  — not found on Railway`); failed++; continue; }

    if (wf.active === true) {
      try {
        const r = await fetch(`${RAILWAY_URL}/api/v1/workflows/${id}/activate`, {
          method: "POST",
          headers: headers(),
        });
        if (r.ok) {
          activated++;
          console.log(`  ✓  ${wf.name}  — activated`);
        } else {
          const t = await r.text();
          if (/already.*activ/i.test(t) || r.status === 409) {
            alreadyOn++;
            console.log(`  ↺  ${wf.name}  — already active`);
          } else {
            console.log(`  ✗  ${wf.name}  — HTTP ${r.status}: ${t.slice(0, 120)}`);
            failed++;
          }
        }
      } catch (e: any) {
        console.log(`  ✗  ${wf.name}  — ${e.message?.slice(0, 100)}`);
        failed++;
      }
    } else {
      leftOff++;
      console.log(`  -  ${wf.name}  — left inactive (source was inactive)`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Activated:    ${activated}`);
  console.log(`  Already on:   ${alreadyOn}`);
  console.log(`  Left off:     ${leftOff}`);
  console.log(`  Failed:       ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
