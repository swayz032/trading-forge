/**
 * Wave 8 P6 — fix Strategy Gen Loop + Nightly + Weekly broken Ollama cred.
 *
 * Discovery: dead cred ID BLgLWvmLGaJQOYaF appears in 20 nodes across:
 *   - cF1ZuhfdSEev0C4i Strategy Generation Loop (6 nodes)
 *   - ZUq9UufuWh5gZJi2 Nightly Strategy Research Loop (7 nodes)
 *   - hzoWiVeKdhXSI31v Weekly Strategy Hunt (7 nodes)
 * Zero Ollama creds exist on Railway n8n. Must create one pointing at
 * tower Ollama via the tf-relay /__ollama path prefix, then swap all 20
 * node refs.
 *
 * Idempotent: if a cred named "Tower Ollama (relay)" already exists,
 * reuse its ID instead of creating a duplicate.
 */
import "dotenv/config";

const BASE = process.env.N8N_BASE_URL ?? process.env.RAILWAY_N8N_URL!;
const KEY = process.env.TF_N8N_API_KEY ?? process.env.RAILWAY_N8N_API_KEY!;
const RELAY_OLLAMA = "https://tf-relay-production.up.railway.app/__ollama";
const CRED_NAME = "Tower Ollama (relay)";
const DEAD_CRED = "BLgLWvmLGaJQOYaF";

const TARGETS = [
  "cF1ZuhfdSEev0C4i",
  "ZUq9UufuWh5gZJi2",
  "hzoWiVeKdhXSI31v",
];

async function n8n<T>(pathSegment: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${pathSegment}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    throw new Error(`${init?.method ?? "GET"} ${pathSegment}: HTTP ${r.status} ${await r.text()}`);
  }
  return r.json() as Promise<T>;
}

async function getOrCreateOllamaCred(): Promise<string> {
  const list = await n8n<{ data?: Array<{ id: string; name: string; type: string }> }>(
    "/api/v1/credentials",
  );
  const existing = (list.data ?? []).find((c) => c.name === CRED_NAME && c.type === "ollamaApi");
  if (existing) {
    console.log(`[ollama-cred] Reusing existing cred id=${existing.id} name="${existing.name}"`);
    return existing.id;
  }
  const created = await n8n<{ id: string; name: string }>("/api/v1/credentials", {
    method: "POST",
    body: JSON.stringify({
      name: CRED_NAME,
      type: "ollamaApi",
      data: { baseUrl: RELAY_OLLAMA },
    }),
  });
  console.log(`[ollama-cred] Created new cred id=${created.id} name="${created.name}"`);
  return created.id;
}

interface N8nNode {
  name: string;
  type: string;
  credentials?: Record<string, { id: string; name?: string }>;
  parameters?: Record<string, unknown>;
  position?: number[];
  typeVersion?: number;
  disabled?: boolean;
}

interface N8nWorkflow {
  id: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  staticData?: unknown;
}

async function swapWorkflowCreds(wfId: string, newCredId: string): Promise<{ swapped: number; touched: string[] }> {
  const wf = await n8n<N8nWorkflow>(`/api/v1/workflows/${wfId}`);
  let swapped = 0;
  const touched: string[] = [];

  for (const node of wf.nodes) {
    if (!node.credentials) continue;
    for (const [credType, ref] of Object.entries(node.credentials)) {
      if (ref.id === DEAD_CRED && credType === "ollamaApi") {
        node.credentials[credType] = { id: newCredId, name: CRED_NAME };
        swapped += 1;
        touched.push(node.name);
      }
    }
  }

  if (swapped === 0) {
    console.log(`[${wfId}] No dead Ollama refs in "${wf.name}" — nothing to swap.`);
    return { swapped: 0, touched: [] };
  }

  // n8n public-API PUT requires the full workflow PUT body shape.
  // Strip readonly fields per n8n's PUT semantics.
  const putBody: Record<string, unknown> = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
    staticData: wf.staticData ?? null,
  };
  await n8n(`/api/v1/workflows/${wfId}`, {
    method: "PUT",
    body: JSON.stringify(putBody),
  });
  console.log(`[${wfId}] Swapped ${swapped} cred ref(s) in "${wf.name}". Touched nodes: ${touched.join(", ")}`);
  return { swapped, touched };
}

async function main() {
  const credId = await getOrCreateOllamaCred();

  let total = 0;
  for (const id of TARGETS) {
    const r = await swapWorkflowCreds(id, credId);
    total += r.swapped;
  }
  console.log(`\n[wave8-ollama-fix] DONE. Total swaps: ${total}. New cred: ${credId}`);

  // Verification pass
  console.log("\n=== Verification ===");
  let remaining = 0;
  for (const id of TARGETS) {
    const wf = await n8n<N8nWorkflow>(`/api/v1/workflows/${id}`);
    for (const node of wf.nodes) {
      if (!node.credentials) continue;
      for (const [credType, ref] of Object.entries(node.credentials)) {
        if (ref.id === DEAD_CRED) {
          remaining += 1;
          console.log(`  [REMAINING] ${id} node="${node.name}" credType=${credType} credId=${ref.id}`);
        }
      }
    }
  }
  if (remaining === 0) {
    console.log("  ✅ Zero remaining refs to dead cred BLgLWvmLGaJQOYaF.");
  } else {
    console.log(`  ❌ ${remaining} remaining — swap incomplete.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
