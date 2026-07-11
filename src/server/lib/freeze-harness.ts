/**
 * HARD-FREEZE EVALUATION HARNESS — turn a CONFOUNDED comparison into a CONTROLLED one.
 *
 * The scaling limit hit: the system is now sensitive enough that INFRASTRUCTURE INSTABILITY is
 * indistinguishable from SEMANTIC DISAGREEMENT unless execution conditions are frozen. (A "Gemma missed the
 * confirmation" claim is unprovable while the backend can be stale, drop mid-run, or skew versions.)
 *
 * This harness hash-locks the execution environment and — critically — enforces the ATTRIBUTION ORDER so a
 * semantic claim cannot be made on confounded data:
 *
 *   VERSION_INCONSISTENCY  (manifest drifted)        ─┐ ruled out FIRST
 *   EXECUTION_DROP         (this run failed/degraded) ─┤ ruled out SECOND
 *   ───────────────────────────────────────────────── only then is a semantic verdict allowed:
 *   SPAN_FAILURE           (verbatim phrase present, pipeline produced NO bound node)
 *   INFERENCE_DISAGREEMENT (pipeline has the node but bound/inferred it differently)
 *
 * Pure / deterministic. The runner captures a manifest before AND after a batch; if anything drifted the run
 * is invalid. Requires the backend to expose its running commit (added to /api/health) — nothing impossible.
 */

import { createHash } from "crypto";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface FreezeManifest {
  backend_commit: string;   // /api/health.commit — the running-code identity (was "dev"/unobservable before)
  backend_dirty: boolean;   // uncommitted changes in the running checkout → freeze-invalid
  backend_uptime: number;   // seconds; a DECREASE between before/after = the process restarted mid-run
  model_digest: string;     // ollama model identity (family+size+quant+modified)
  transcript_hashes: Record<string, string>; // sha256 per video id — the dataset lock
}

export function captureManifest(input: {
  backend_commit: string; backend_dirty: boolean; backend_uptime: number; model_digest: string;
  transcripts: Record<string, string>;
}): FreezeManifest {
  const transcript_hashes: Record<string, string> = {};
  for (const [id, text] of Object.entries(input.transcripts)) transcript_hashes[id] = sha256(text);
  return {
    backend_commit: input.backend_commit, backend_dirty: input.backend_dirty,
    backend_uptime: input.backend_uptime, model_digest: input.model_digest, transcript_hashes,
  };
}

export interface DriftCheck { ok: boolean; drift: string[] }
/** A run is FROZEN only if nothing changed between before/after and the code was committed-clean. */
export function verifyNoDrift(before: FreezeManifest, after: FreezeManifest): DriftCheck {
  const drift: string[] = [];
  if (before.backend_commit !== after.backend_commit) drift.push(`backend_commit ${before.backend_commit.slice(0, 8)}→${after.backend_commit.slice(0, 8)}`);
  if (before.backend_commit === "unknown") drift.push("backend_commit unknown (not freeze-observable)");
  if (before.backend_dirty || after.backend_dirty) drift.push("backend code_dirty (uncommitted changes)");
  if (after.backend_uptime < before.backend_uptime) drift.push("backend RESTARTED mid-run (uptime decreased)");
  if (before.model_digest !== after.model_digest) drift.push("model_digest changed");
  for (const id of Object.keys(before.transcript_hashes)) {
    if (before.transcript_hashes[id] !== after.transcript_hashes[id]) drift.push(`transcript ${id} changed`);
  }
  return { ok: drift.length === 0, drift };
}

// ── disagreement classification (the attribution-order enforcer) ────────────────
export type DisagreementType = "AGREE" | "SPAN_FAILURE" | "INFERENCE_DISAGREEMENT" | "EXECUTION_DROP" | "VERSION_INCONSISTENCY";
export interface NodeObservation {
  node: string;
  manual_present: boolean;             // the independent annotator (human) extracted this node
  manual_quote_in_transcript: boolean; // and that quote is verbatim in the transcript (ground truth)
  pipeline_present: boolean;           // the pipeline produced a node here
  pipeline_span_bound: boolean;        // and bound it to a transcript span
  pipeline_execution_ok: boolean;      // this video's pipeline run was clean (NOT coverage_failed/_error/dropped)
}

/**
 * Classify a manual-vs-pipeline disagreement WITHOUT confounding. Order is non-negotiable:
 * version drift → execution drop → only THEN a semantic verdict (span failure / inference disagreement).
 * `versionDrift` comes from verifyNoDrift; pass true to forbid ANY semantic claim for the whole run.
 */
export function classifyDisagreement(obs: NodeObservation, versionDrift: boolean): DisagreementType {
  if (versionDrift) return "VERSION_INCONSISTENCY";          // environment unstable → no semantic claim allowed
  if (!obs.pipeline_execution_ok) return "EXECUTION_DROP";   // runtime artifact, NOT a semantic miss
  if (!obs.manual_present) return "AGREE";                   // annotator didn't extract it either → nothing to compare
  if (obs.pipeline_span_bound) return "AGREE";              // both have it bound → agreement
  // execution clean + no drift + the annotator found it + the pipeline did NOT bind it:
  if (obs.manual_quote_in_transcript) {
    return obs.pipeline_present ? "INFERENCE_DISAGREEMENT"   // pipeline has the node but didn't bind (paraphrase/infer)
                               : "SPAN_FAILURE";              // verbatim phrase present, pipeline produced nothing → real miss
  }
  return "AGREE";
}
