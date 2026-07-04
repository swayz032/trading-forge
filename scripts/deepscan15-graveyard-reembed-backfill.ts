/**
 * deepscan15 — graveyard re-embed backfill (2026-07-03)
 *
 * WHY: the 2026-07-03 tower-model consolidation retired the dedicated
 * `nomic-embed-text` embedder (768-dim); the tower now serves ONE model,
 * `gemma4:e4b-it-qat`. gemma is an instruct model whose /api/embeddings output
 * has a DIFFERENT dimensionality than nomic's 768, so every graveyard vector
 * persisted under nomic is NOT cosine-comparable to a fresh gemma candidate
 * embedding — the graveyard idea-dedup gate (`graveyard-gate.ts`) therefore
 * reports "gate INACTIVE / dimension mismatch" and blocks nothing (fail-open,
 * honest — deepscan14 D3). This backfill re-embeds every stored graveyard row
 * under gemma using the SAME OllamaClient.embed path the live gate uses at query
 * time, so stored + candidate vectors are comparable again and the efficiency
 * gate reactivates on the single consolidated model.
 *
 * The gate embeds the CANDIDATE's description string, so this backfill embeds
 * each dead strategy's description (dsl_snapshot.description → fallback name +
 * death_reason) for apples-to-apples cosine.
 *
 * SAFETY: dry-run by default (reports what WOULD change). Pass `--apply` to write.
 * Fails soft if Ollama is unavailable (mirrors the gate's own bypass — never
 * crashes a boot or a batch). Idempotent: re-running re-embeds under the same
 * model to the same vector, so a partial run is safe to resume.
 *
 *   npx tsx scripts/deepscan15-graveyard-reembed-backfill.ts            # dry-run
 *   npx tsx scripts/deepscan15-graveyard-reembed-backfill.ts --apply    # write
 *   npx tsx scripts/deepscan15-graveyard-reembed-backfill.ts --apply --limit 50
 */
import "dotenv/config"; // must precede the db import so DATABASE_URL is set before db/index.ts runs
import { eq } from "drizzle-orm";
import { db } from "../src/server/db/index.js";
import { strategyGraveyard } from "../src/server/db/schema.js";
import { OllamaClient } from "../src/server/services/ollama-client.js";
import { logger } from "../src/server/lib/logger.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit"));
const LIMIT = limitArg ? Number(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1]) : undefined;

/** Build the text embedded for a dead strategy — mirrors the candidate description
 *  the live gate embeds (`graveyard-gate.check(strategyDescription)`). */
function deriveGraveyardText(row: {
  name: string;
  dslSnapshot: unknown;
  deathReason: string | null;
}): string | null {
  const dsl = (row.dslSnapshot ?? {}) as Record<string, unknown>;
  const desc = typeof dsl.description === "string" ? dsl.description.trim() : "";
  if (desc) return desc;
  // Fallback: name + human death reason (still a meaningful, model-comparable text).
  const parts = [row.name, row.deathReason ?? ""].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

async function main() {
  const ollama = new OllamaClient();
  logger.info({ apply: APPLY, limit: LIMIT }, "graveyard re-embed backfill: start");

  const rowsQuery = db
    .select({
      id: strategyGraveyard.id,
      name: strategyGraveyard.name,
      dslSnapshot: strategyGraveyard.dslSnapshot,
      deathReason: strategyGraveyard.deathReason,
      embedding: strategyGraveyard.embedding,
    })
    .from(strategyGraveyard);
  const rows = LIMIT ? await rowsQuery.limit(LIMIT) : await rowsQuery;

  let processed = 0;
  let updated = 0;
  let skippedNoText = 0;
  let embedFailed = 0;
  let oldDim: number | null = null;
  let newDim: number | null = null;

  // Probe Ollama once — if the embedder is down, bail loudly rather than mark
  // every row failed (mirrors the gate's fail-open bypass semantics).
  try {
    const probe = await ollama.embed("healthcheck");
    newDim = probe[0]?.length ?? null;
    logger.info({ model: "gemma4:e4b-it-qat (embed role)", dim: newDim }, "graveyard re-embed: embedder reachable");
  } catch (err) {
    logger.error({ err }, "graveyard re-embed ABORTED — Ollama embedder unreachable (no rows touched)");
    console.log(JSON.stringify({ status: "aborted_embedder_unreachable", processed: 0, updated: 0 }, null, 2));
    process.exit(2);
  }

  for (const row of rows) {
    processed++;
    if (oldDim === null && Array.isArray(row.embedding)) oldDim = (row.embedding as number[]).length;

    const text = deriveGraveyardText(row);
    if (!text) {
      skippedNoText++;
      continue;
    }

    let vec: number[];
    try {
      const out = await ollama.embed(text);
      vec = out[0];
      if (!Array.isArray(vec) || vec.length === 0) throw new Error("empty embedding");
    } catch (err) {
      embedFailed++;
      logger.warn({ id: row.id, err }, "graveyard re-embed: embed failed for row (left unchanged)");
      continue;
    }

    if (APPLY) {
      await db.update(strategyGraveyard).set({ embedding: vec }).where(eq(strategyGraveyard.id, row.id));
      updated++;
    } else {
      updated++; // would-update count in dry-run
    }
  }

  const summary = {
    status: APPLY ? "applied" : "dry_run",
    total_rows: rows.length,
    processed,
    updated: APPLY ? updated : 0,
    would_update: APPLY ? undefined : updated,
    skipped_no_text: skippedNoText,
    embed_failed: embedFailed,
    old_embedding_dim: oldDim,
    new_embedding_dim: newDim,
    note:
      oldDim !== null && newDim !== null && oldDim !== newDim
        ? `dimension change ${oldDim} → ${newDim}: stored vectors were NOT comparable to fresh gemma candidates until this backfill`
        : "no stored embedding found to compare dims (fresh corpus)",
  };
  logger.info(summary, "graveyard re-embed backfill: done");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "graveyard re-embed backfill: fatal");
  process.exit(1);
});
