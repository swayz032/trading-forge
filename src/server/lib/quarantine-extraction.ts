/**
 * W3.2 (2026-06-22) — Quarantine routing for failed / incomplete extractions.
 *
 * Isolated into a lib helper to avoid a circular import:
 *   routes/agent.ts → services/direct-bucket-graduator.ts → index.ts → routes/agent.ts
 *
 * This module is import-safe: it uses logger from ./logger.js (leaf module)
 * and db from ../db/index.js — neither of which creates a cycle.
 *
 * What it does:
 *   When the W3.2 compilability gate rejects an extraction (missing entry_indicator,
 *   empty params, no confluence factors, coverage_failed, placeholder concept_name, etc.),
 *   the route calls quarantineExtraction() which:
 *     1. Computes a unique quarantine fingerprint via computeQuarantineFingerprintHash —
 *        this KILLS the collision where all "extracted_strategy" failures shared the same
 *        sha256("extracted") bucket hash.
 *     2. UPSERTs into needs_archetype_queue (reuses migration 0162 — no new migration).
 *        speaker_term = "quarantine:<hash>" — unique per source, never collides.
 *     3. Emits an extraction.quarantined audit row for observability.
 *
 * Non-blocking: DB failures are caught and logged. The caller's HTTP response
 * must not depend on this write succeeding.
 *
 * Architecture constraint: MUST import logger from "./logger.js" leaf module,
 * NEVER from "../index.js". See feedback_helper_logger_import.md.
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { sql } from "drizzle-orm";
import { computeQuarantineFingerprintHash } from "../services/strategy-fingerprint.js";
import { logger } from "./logger.js";

export interface QuarantineExtractionOpts {
  concept_name: string;
  source_url: string | null;
  /** Which compilability gate conditions failed (machine-readable codes). */
  missing: string[];
  /** W3.1 coverage verdict — included for operator context in the queue row. */
  coverage_verdict?: { verdict: "pass" | "coverage_failed"; missing?: string[]; coverage_pct?: number } | null;
  /** Human-readable summary of why the extraction was quarantined. */
  reason: string | null;
  correlationId?: string | null;
}

/**
 * Route a failed extraction to the quarantine queue and emit an audit row.
 *
 * Safe to fire-and-forget: catches all errors internally.
 */
export async function quarantineExtraction(opts: QuarantineExtractionOpts): Promise<void> {
  const { concept_name, source_url, missing, coverage_verdict, reason, correlationId } = opts;

  // The unique-per-source quarantine fingerprint kills the collision.
  // computeQuarantineFingerprintHash hashes "quarantine:<video_id>|<canonical_concept>"
  // so two different failed extractions NEVER produce the same hash.
  const quarantineHash = computeQuarantineFingerprintHash({ concept_name, source_url });

  // speaker_term = "quarantine:<hash>" — unique index in needs_archetype_queue.
  // This scopes each failed extraction to its own row instead of collapsing on concept_name.
  const speakerTerm = `quarantine:${quarantineHash}`;

  // verbatim_description carries the full context for operator review
  const verbatimDescription =
    `[QUARANTINED] concept_name="${concept_name}" | missing: ${missing.join(", ")} | ` +
    (reason ?? "compilability gate failed");

  try {
    await db.execute(sql`
      INSERT INTO needs_archetype_queue (
        bucket_id, speaker_term, verbatim_description, transcript_quote, source_url, extraction_count, status
      ) VALUES (
        NULL, ${speakerTerm}, ${verbatimDescription}, ${missing.join(", ")}, ${source_url ?? null}, 1, 'pending'
      )
      ON CONFLICT (speaker_term)
      DO UPDATE SET
        extraction_count = needs_archetype_queue.extraction_count + 1,
        verbatim_description = EXCLUDED.verbatim_description,
        updated_at = NOW()
    `);
  } catch (qErr) {
    logger.warn(
      { err: qErr, concept_name, source_url, speakerTerm },
      "W3.2: needs_archetype_queue quarantine UPSERT failed (non-blocking)",
    );
  }

  // Audit row — non-blocking
  db.insert(auditLog)
    .values({
      action: "extraction.quarantined",
      entityType: "scout_extract",
      entityId: null,
      input: {
        concept_name,
        source_url,
        quarantine_hash: quarantineHash,
        missing,
        coverage_verdict: coverage_verdict ?? null,
      } as Record<string, unknown>,
      result: {
        speaker_term: speakerTerm,
        reason,
      } as Record<string, unknown>,
      status: "info",
      correlationId: correlationId ?? null,
    })
    .catch((auditErr: unknown) =>
      logger.warn(
        { err: auditErr instanceof Error ? auditErr.message : String(auditErr), concept_name, source_url },
        "W3.2: extraction.quarantined audit write failed (non-blocking)",
      ),
    );
}
