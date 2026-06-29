/**
 * sync-knowledge-base.ts — keep Carter's ElevenLabs RAG knowledge base FRESH.
 *
 * Carter already has a working RAG KB (rag.enabled, e5_mistral_7b_instruct). This
 * script SURGICALLY refreshes only the docs that have a repo-file source (CLAUDE.md,
 * AGENTS.md, the System Map, the prop-firm rules) so when those drift, Carter stays
 * current — WITHOUT touching curated KB docs that have no repo source (carter-glossary,
 * EDGE-MECHANISMS). It is name-matched and idempotent.
 *
 * Flow per doc: create text doc → trigger RAG index → repoint the agent's
 * knowledge_base to the new id (preserving every other attached doc + the rag config)
 * → delete the old same-named doc.
 *
 * SAFE BY DEFAULT: dry-run prints the plan and writes nothing. Pass --apply to execute.
 *
 * Run:  npx tsx scripts/carter/sync-knowledge-base.ts            (dry-run)
 *       npx tsx scripts/carter/sync-knowledge-base.ts --apply    (refresh)
 *
 * Never prints the API key. Uses the global fetch (Node ≥ 18).
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KB_BASE = "https://api.elevenlabs.io/v1/convai/knowledge-base";
const AGENTS_BASE = "https://api.elevenlabs.io/v1/convai/agents";
const KB_PREFIX = "carter-kb:";
const EMBEDDING_MODEL = "e5_mistral_7b_instruct"; // must match the agent's rag config

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/carter/ → repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");

// Repo-sourced canonical docs that should track the files. Curated KB docs without a
// repo source (carter-glossary.md, EDGE-MECHANISMS.md) are intentionally NOT listed —
// the sync leaves them untouched.
const CANONICAL: Array<{ kbName: string; relPath: string }> = [
  { kbName: "CLAUDE.md", relPath: "CLAUDE.md" },
  { kbName: "AGENTS.md", relPath: "AGENTS.md" },
  { kbName: "Trading Forge System Map v2.md", relPath: "Trading Forge System Map v2.md" },
  { kbName: "prop-firm-rules-2026-topstep.md", relPath: "docs/prop-firm-rules-2026-topstep.md" },
  { kbName: "prop-firm-rules-2026-mffu.md", relPath: "docs/prop-firm-rules-2026-mffu.md" },
];

const APPLY = process.argv.includes("--apply");

async function kbList(key: string): Promise<Array<{ id: string; name: string; type?: string }>> {
  const r = await fetch(KB_BASE, { headers: { "xi-api-key": key } });
  if (!r.ok) throw new Error(`GET knowledge-base failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { documents?: any[] };
  return (j.documents ?? []).map((d) => ({ id: d.id, name: d.name, type: d.type }));
}

async function createTextDoc(key: string, name: string, text: string): Promise<string> {
  const r = await fetch(`${KB_BASE}/text`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!r.ok) throw new Error(`create text doc ${name} failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { id?: string };
  if (!j.id) throw new Error(`create text doc ${name} returned no id`);
  return j.id;
}

async function ragIndex(key: string, id: string): Promise<void> {
  const r = await fetch(`${KB_BASE}/${id}/rag-index`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL }),
  });
  // 200 = indexing started/queued; non-OK is non-fatal (EL also auto-indexes on use).
  if (!r.ok) console.error(`  ⚠️  rag-index ${id} returned ${r.status} (continuing; EL indexes async)`);
}

async function deleteDoc(key: string, id: string): Promise<void> {
  const r = await fetch(`${KB_BASE}/${id}`, { method: "DELETE", headers: { "xi-api-key": key } });
  if (!r.ok && r.status !== 204) console.error(`  ⚠️  delete ${id} returned ${r.status}`);
}

async function main(): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.CARTER_AGENT_ID;
  if (!key || !agentId) {
    console.error("ELEVENLABS_API_KEY / CARTER_AGENT_ID not set — aborting.");
    process.exit(1);
  }

  // Current agent knowledge_base + rag (preserve everything we don't refresh).
  const agentRes = await fetch(`${AGENTS_BASE}/${agentId}`, { headers: { "xi-api-key": key } });
  if (!agentRes.ok) throw new Error(`GET agent failed: ${agentRes.status}`);
  const agent = (await agentRes.json()) as any;
  const prompt = agent?.conversation_config?.agent?.prompt ?? {};
  const currentKB: Array<{ type: string; name: string; id: string; usage_mode?: string }> =
    Array.isArray(prompt.knowledge_base) ? prompt.knowledge_base : [];

  const existing = await kbList(key);
  const byName = new Map(existing.map((d) => [d.name, d]));

  console.error(`─── Carter KB sync (${APPLY ? "APPLY" : "DRY-RUN"}) ───`);
  const refreshedNames = new Set<string>();
  const newEntries: Array<{ type: string; name: string; id: string; usage_mode: string }> = [];
  const toDelete: string[] = [];

  for (const doc of CANONICAL) {
    const full = `${KB_PREFIX}${doc.kbName}`;
    const path = join(REPO_ROOT, doc.relPath);
    if (!existsSync(path)) {
      console.error(`  SKIP  ${full} — source missing at ${doc.relPath}`);
      continue;
    }
    const bytes = readFileSync(path, "utf8").length;
    const old = byName.get(full);
    refreshedNames.add(full);
    console.error(`  REFRESH ${full}  (${bytes} chars${old ? `, replacing ${old.id}` : ", new"})`);
    if (!APPLY) continue;
    const text = readFileSync(path, "utf8");
    const id = await createTextDoc(key, full, text);
    await ragIndex(key, id);
    newEntries.push({ type: "text", name: full, id, usage_mode: "auto" });
    if (old) toDelete.push(old.id);
  }

  // New attachment list = every current entry whose name we did NOT refresh (preserve
  // curated docs) + the freshly-created entries.
  const preserved = currentKB.filter((e) => !refreshedNames.has(e.name));
  console.error(
    `\n  Preserving ${preserved.length} untouched KB doc(s): ${preserved.map((e) => e.name).join(", ") || "(none)"}`,
  );

  if (!APPLY) {
    console.error("\nDRY-RUN — no writes. Re-run with --apply to refresh.");
    return;
  }

  const nextKB = [...preserved, ...newEntries];
  const patchRes = await fetch(`${AGENTS_BASE}/${agentId}`, {
    method: "PATCH",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: nextKB } } } }),
  });
  if (!patchRes.ok) {
    throw new Error(`PATCH agent knowledge_base failed: ${patchRes.status} ${(await patchRes.text()).slice(0, 300)}`);
  }
  // Only after the agent points at the new docs do we delete the stale ones.
  for (const id of toDelete) await deleteDoc(key, id);

  console.error(
    `\n✅ KB refreshed: ${newEntries.length} docs re-uploaded + indexed, ${preserved.length} preserved, ${toDelete.length} old deleted. agent.knowledge_base now = ${nextKB.length}.`,
  );
}

main().catch((e) => {
  console.error("sync-knowledge-base failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
