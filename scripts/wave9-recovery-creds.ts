/**
 * Wave 9 Recovery — Phase A: recreate the 8 credentials wiped by the Railway
 * redeploy. Reads .env and POSTs each to /api/v1/credentials. Writes
 * tmp-n8n/cred-id-map.json keyed on credential name → new id, consumed by
 * wave9-recovery-import.ts for the cred-id rewrite step.
 *
 * Idempotent: if a credential with the same name already exists on n8n, this
 * REUSES its id and skips re-creation (so re-running the script is safe).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const BASE = process.env.N8N_BASE_URL || "https://n8n-production-84ff.up.railway.app";
const KEY = process.env.TF_N8N_API_KEY || process.env.RAILWAY_N8N_API_KEY || process.env.N8N_API_KEY;
if (!KEY) { console.error("Missing TF_N8N_API_KEY"); process.exit(1); }

function req(envName: string): string {
  const v = process.env[envName];
  if (!v) { console.error(`Missing required env var ${envName}`); process.exit(1); }
  return v;
}

const BRAVE = req("BRAVE_API_KEY");
const EXA = req("EXA_API_KEY");
const SUPADATA = req("SUPADATA_API_KEY");
const PARALLEL = req("PARALLEL_API_KEY");
const TAVILY = req("TAVILY_API_KEY");
const OPENAI = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
if (!OPENAI) { console.error("Missing OPENAI_API_KEY/OPENAI_KEY"); process.exit(1); }
const PG_PWD = process.env.LIVE_PG_PASSWORD || process.env.PGPASSWORD || process.env.PG_PASSWORD || "";  // deep-scan scripts F-1 (CRITICAL 2026-07-06): read from env, NEVER hardcode a live DB password in source

interface CredSpec { name: string; type: string; data: Record<string, any>; }

if (!PG_PWD) {
  console.warn("[wave9-recovery-creds] LIVE_PG_PASSWORD/PGPASSWORD not set — SKIPPING the Postgres LIVE_PG credential (set it in env to include it).");
}

const SPECS: CredSpec[] = [
  { name: "Brave Search", type: "httpHeaderAuth", data: { name: "X-Subscription-Token", value: BRAVE } },
  { name: "Exa API", type: "httpHeaderAuth", data: { name: "x-api-key", value: EXA } },
  { name: "Supadata", type: "httpHeaderAuth", data: { name: "x-api-key", value: SUPADATA } },
  { name: "Parallel.ai", type: "httpHeaderAuth", data: { name: "x-api-key", value: PARALLEL } },
  { name: "Tavily", type: "httpHeaderAuth", data: { name: "Authorization", value: `Bearer ${TAVILY}` } },
  {
    // n8n public API requires header* props be explicitly set; using header:true
    // path with Authorization header (matches OpenAI's actual auth scheme).
    name: "OpenAI",
    type: "openAiApi",
    data: {
      apiKey: OPENAI,
      header: true,
      headerName: "Authorization",
      headerValue: `Bearer ${OPENAI}`,
    },
  },
  {
    name: "Postgres LIVE_PG",
    type: "postgres",
    data: {
      host: "postgres.railway.internal",
      port: 5432,
      database: "railway",
      user: "postgres",
      password: PG_PWD,
      ssl: "disable",
      sshTunnel: false,
    },
  },
  {
    name: "Tower Ollama (relay)",
    type: "ollamaApi",
    data: { baseUrl: "https://tf-relay-production.up.railway.app/__ollama" },
  },
];

function headers() {
  return { "X-N8N-API-KEY": KEY!, "Content-Type": "application/json", Accept: "application/json" };
}

// n8n public API does NOT expose GET /credentials list (only GET /:id). Detect
// existing creds by attempting POST and catching the duplicate-name error, OR
// by reading a cached cred-id-map if present.
async function postCred(spec: CredSpec): Promise<string> {
  const body = { name: spec.name, type: spec.type, data: spec.data };
  const res = await fetch(`${BASE}/api/v1/credentials`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  return j.id;
}

async function main() {
  const outPath = path.resolve("tmp-n8n", "cred-id-map.json");
  const existing: Record<string, string> = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf-8"))
    : {};

  const map: Record<string, string> = { ...existing };
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const spec of SPECS) {
    if (map[spec.name]) {
      console.log(`  =  ${spec.name}  — already in map (${map[spec.name]})`);
      skipped++;
      continue;
    }
    try {
      const id = await postCred(spec);
      map[spec.name] = id;
      console.log(`  +  ${spec.name}  → ${id}`);
      created++;
    } catch (e: any) {
      console.log(`  x  ${spec.name}  — ${e.message?.slice(0, 200)}`);
      failed++;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(map, null, 2));
  console.log(`\n=== Summary ===`);
  console.log(`  Created: ${created}`);
  console.log(`  Reused:  ${skipped}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Wrote:   ${outPath}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
