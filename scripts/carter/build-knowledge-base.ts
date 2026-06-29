/**
 * build-knowledge-base.ts — Carter Wave 1 Task 1.4
 *
 * Uploads Trading Forge docs to the ElevenLabs ConvAI Knowledge Base, computes a
 * RAG index for each "auto" doc, enables RAG on the agent, and attaches every doc
 * to the agent's conversation_config.agent.prompt.knowledge_base[].
 *
 * Usage modes:
 *   - "auto"   — retrieved via RAG when relevant (the big reference docs).
 *   - "prompt" — injected verbatim into the system prompt (the glossary, so Carter
 *                always speaks in plain English without a retrieval round-trip).
 *
 * Idempotent: documents are matched by name (prefix "carter-kb:") — re-running
 * reuses existing KB docs instead of uploading duplicates. The agent attach is a
 * MERGE patch (keeps unrelated prompt fields).
 *
 * Run:  npx tsx scripts/carter/build-knowledge-base.ts
 *
 * Never prints the API key. Uses the global fetch / FormData / Blob (Node ≥ 18).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const API = "https://api.elevenlabs.io/v1/convai";
const RAG_MODEL = "e5_mistral_7b_instruct";
const NAME_PREFIX = "carter-kb:";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

type UsageMode = "auto" | "prompt";

interface KbDoc {
  /** repo-relative path */
  path: string;
  usage_mode: UsageMode;
}

const KB_DOCS: KbDoc[] = [
  { path: "CLAUDE.md", usage_mode: "auto" },
  { path: "AGENTS.md", usage_mode: "auto" },
  { path: "Trading Forge System Map v2.md", usage_mode: "auto" },
  { path: "docs/prop-firm-rules-2026-topstep.md", usage_mode: "auto" },
  { path: "docs/prop-firm-rules-2026-mffu.md", usage_mode: "auto" },
  { path: "EDGE-MECHANISMS.md", usage_mode: "auto" },
  // The glossary rides in the prompt so Carter always has plain-English defs.
  { path: "scripts/carter/carter-glossary.md", usage_mode: "prompt" },
];

function docName(p: string): string {
  return `${NAME_PREFIX}${basename(p)}`;
}

async function listExisting(apiKey: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  // paginate defensively
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${API}/knowledge-base`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { "xi-api-key": apiKey } });
    if (!r.ok) break;
    const data = (await r.json()) as {
      documents?: Array<{ id: string; name: string }>;
      next_cursor?: string | null;
      has_more?: boolean;
    };
    for (const d of data.documents ?? []) out.set(d.name, d.id);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

async function uploadFile(apiKey: string, absPath: string, name: string): Promise<string> {
  const buf = readFileSync(absPath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "text/markdown" }), basename(absPath));
  fd.append("name", name);
  const r = await fetch(`${API}/knowledge-base/file`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
  });
  if (!r.ok) {
    throw new Error(`upload ${name} failed: ${r.status} ${(await r.text()).slice(0, 400)}`);
  }
  const data = (await r.json()) as { id: string; name?: string };
  return data.id;
}

/** Compute a RAG index for an "auto" doc and poll until it's usable. */
async function ensureRagIndex(apiKey: string, docId: string, name: string): Promise<string> {
  // Trigger (idempotent: returns the existing index if already computed).
  const trigger = await fetch(`${API}/knowledge-base/${docId}/rag-index`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: RAG_MODEL }),
  });
  if (!trigger.ok) {
    const t = (await trigger.text()).slice(0, 300);
    console.error(`  ⚠️  rag-index trigger for ${name} → ${trigger.status} ${t}`);
    return "trigger_failed";
  }
  // Poll status.
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/knowledge-base/${docId}/rag-index`, { headers: { "xi-api-key": apiKey } });
    if (r.ok) {
      const data = (await r.json()) as {
        indexes?: Array<{ status?: string; model?: string }>;
        status?: string;
      };
      const idx = data.indexes?.find((x) => x.model === RAG_MODEL) ?? data.indexes?.[0];
      const status = (idx?.status ?? data.status ?? "unknown").toLowerCase();
      if (["succeeded", "complete", "completed", "ready", "done"].includes(status)) return status;
      if (["failed", "error"].includes(status)) return status;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return "timeout";
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.CARTER_AGENT_ID;
  if (!apiKey) { console.error("ELEVENLABS_API_KEY is not set — aborting."); process.exit(1); }
  if (!agentId) { console.error("CARTER_AGENT_ID is not set — aborting."); process.exit(1); }

  const existing = await listExisting(apiKey);
  const attach: Array<{ type: "file"; id: string; name: string; usage_mode: UsageMode }> = [];

  for (const doc of KB_DOCS) {
    const abs = join(REPO_ROOT, doc.path);
    const name = docName(doc.path);
    let id = existing.get(name);
    if (id) {
      console.error(`• reuse  ${name} (${id})`);
    } else {
      id = await uploadFile(apiKey, abs, name);
      console.error(`• upload ${name} (${id})`);
    }
    if (doc.usage_mode === "auto") {
      const status = await ensureRagIndex(apiKey, id, name);
      console.error(`    rag-index: ${status}`);
    }
    attach.push({ type: "file", id, name, usage_mode: doc.usage_mode });
  }

  // GET current agent to MERGE-patch prompt (never blow away unrelated fields).
  const url = `${API}/agents/${agentId}`;
  const getRes = await fetch(url, { headers: { "xi-api-key": apiKey } });
  if (!getRes.ok) { console.error(`GET agent failed: ${getRes.status}`); process.exit(1); }
  const current = (await getRes.json()) as Record<string, any>;
  const conv = current.conversation_config ?? {};
  const agent = conv.agent ?? {};
  const prompt = agent.prompt ?? {};
  const rag = prompt.rag ?? {};

  const patch = {
    conversation_config: {
      ...conv,
      agent: {
        ...agent,
        prompt: {
          ...prompt,
          knowledge_base: attach,
          rag: { ...rag, enabled: true },
        },
      },
    },
  };

  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!patchRes.ok) {
    console.error(`PATCH agent failed: ${patchRes.status} ${(await patchRes.text()).slice(0, 600)}`);
    process.exit(1);
  }
  const updated = (await patchRes.json()) as Record<string, any>;
  const up = updated.conversation_config?.agent?.prompt ?? {};
  console.error("─── Carter KB attached ───");
  console.error(
    JSON.stringify(
      {
        rag_enabled: up.rag?.enabled,
        knowledge_base: (up.knowledge_base ?? []).map((k: any) => ({ name: k.name, usage_mode: k.usage_mode })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("build-knowledge-base failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
