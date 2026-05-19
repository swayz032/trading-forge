/**
 * Wave 8 P6+P7 — inspect n8n credentials + the 3 affected workflows.
 *
 * 1) List all credentials (sanitized — no secrets) so we can identify any
 *    existing Ollama cred we can reuse.
 * 2) Pull the 3 workflows fresh: cF1ZuhfdSEev0C4i (Strategy Gen Loop) +
 *    ZUq9UufuWh5gZJi2 (Nightly) + hzoWiVeKdhXSI31v (Weekly), enumerate
 *    every node's credentials section to map the surface area precisely.
 */
import "dotenv/config";

const BASE = process.env.N8N_BASE_URL ?? process.env.RAILWAY_N8N_URL!;
const KEY = process.env.TF_N8N_API_KEY ?? process.env.RAILWAY_N8N_API_KEY!;

async function n8n(pathSegment: string) {
  const r = await fetch(`${BASE}${pathSegment}`, {
    headers: { "X-N8N-API-KEY": KEY, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`${pathSegment}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

const TARGETS = [
  { id: "cF1ZuhfdSEev0C4i", label: "Strategy Generation Loop" },
  { id: "ZUq9UufuWh5gZJi2", label: "Nightly Strategy Research Loop" },
  { id: "hzoWiVeKdhXSI31v", label: "Weekly Strategy Hunt" },
];

const DEAD_OLLAMA = "BLgLWvmLGaJQOYaF";
const DEAD_PG = "XDOEjC2s3oL432Lj";
const LIVE_PG = "dIWaoIM08n48oQnd";

async function main() {
  // List ALL credentials. n8n returns sanitized records (no secret values).
  const creds = await n8n("/api/v1/credentials/schema/postgres").catch(() => null);
  console.log("schema check:", creds ? "ok" : "no");
  // Actual credentials endpoint
  const credList: { data?: Array<{ id: string; name: string; type: string }> } =
    await n8n("/api/v1/credentials");
  const all = credList.data ?? [];
  console.log(`\n=== Credentials (${all.length} total) ===`);
  const ollamaCreds = all.filter((c) => c.type.toLowerCase().includes("ollama"));
  const pgCreds = all.filter((c) => c.type.toLowerCase().includes("postgres"));
  console.log("OLLAMA creds:");
  for (const c of ollamaCreds) console.log(`  ${c.id} | ${c.name} | type=${c.type}`);
  console.log("POSTGRES creds:");
  for (const c of pgCreds) console.log(`  ${c.id} | ${c.name} | type=${c.type}`);

  console.log(`\n=== Workflow credential surface ===`);
  for (const t of TARGETS) {
    const wf: { name: string; nodes: Array<{ name: string; type: string; credentials?: Record<string, { id: string; name?: string }> }> } =
      await n8n(`/api/v1/workflows/${t.id}`);
    console.log(`\n--- ${t.label} [${t.id}] = "${wf.name}" ---`);
    for (const node of wf.nodes) {
      if (!node.credentials) continue;
      for (const [credType, ref] of Object.entries(node.credentials)) {
        const tag = ref.id === DEAD_OLLAMA ? " [DEAD-OLLAMA]"
                  : ref.id === DEAD_PG ? " [DEAD-PG]"
                  : ref.id === LIVE_PG ? " [LIVE-PG]"
                  : "";
        console.log(`  node="${node.name}" type=${node.type} credType=${credType} credId=${ref.id}${tag}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
