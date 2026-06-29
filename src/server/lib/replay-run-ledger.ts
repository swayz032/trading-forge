/**
 * REPLAY RUN LEDGER + CORPUS FREEZE — operational governance (NOT representation, NOT protocol).
 *
 * Two artifacts GPT/operator flagged before the first replay campaign, so coverage changes over time stay
 * attributable and replay never becomes a silent moving target:
 *
 *  1. FROZEN CORPUS — the set of videos replay runs against is itself a versioned, hashed artifact. If
 *     coverage moves 68%→81% later, you must be able to tell "better extraction/replay" from "easier corpus."
 *  2. NO SILENT RERUNS — every replay execution gets a unique run_id + a full environment manifest (compiler /
 *     extraction / replay-engine commits + dataset hash + IR version). A re-run after a fix is a NEW record,
 *     never an overwrite. The ledger is APPEND-ONLY: R-...-001 FAILED and R-...-002 PASSED both stay in history.
 *
 * Pure / deterministic / standalone (zero production wiring).
 */

import { createHash } from "crypto";
import type { EvidenceMode } from "./evidence-mode.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// ── Frozen corpus ───────────────────────────────────────────────────────────
export interface CorpusVideo {
  video_id: string;
  transcript_sha: string;       // sha256 of the exact transcript replay graded against
  market: string;               // e.g. "futures" | "forex" | "unspecified"
  instrument: string;           // e.g. "MES" | "EURUSD" | "index_generic"
  timeframe: string;            // e.g. "15m" | "50m"
  educator_family: string;      // strategy family, NOT the channel name (e.g. "opening_range_breakout")
}
export interface CorpusManifest {
  corpus_version: string;       // "1.0-seed" until it reaches the minimum-validation diversity floor
  videos: CorpusVideo[];
  corpus_hash: string;          // hash over the sorted (video_id+transcript_sha) set — the dataset lock
  diversity: { educators: number; families: number; instruments: number };
  meets_minimum: boolean;       // ≥3 educator-families AND ≥2 instruments AND ≥18 videos (minimum-validation-run)
}

/** Freeze a corpus: hash each transcript + the whole set, compute diversity, flag if it meets the minimum. */
export function captureCorpusManifest(version: string, videos: Array<Omit<CorpusVideo, "transcript_sha"> & { transcript: string }>): CorpusManifest {
  const frozen: CorpusVideo[] = videos.map((v) => ({
    video_id: v.video_id, transcript_sha: sha(v.transcript), market: v.market,
    instrument: v.instrument, timeframe: v.timeframe, educator_family: v.educator_family,
  }));
  const corpus_hash = sha(frozen.map((v) => `${v.video_id}:${v.transcript_sha}`).sort().join("|"));
  const families = new Set(frozen.map((v) => v.educator_family)).size;
  const instruments = new Set(frozen.map((v) => v.instrument)).size;
  const educators = new Set(frozen.map((v) => v.video_id)).size; // proxy: distinct videos (channel id not on disk)
  const meets_minimum = families >= 3 && instruments >= 2 && frozen.length >= 18; // per minimum-validation-run.md
  return { corpus_version: version, videos: frozen, corpus_hash, diversity: { educators, families, instruments }, meets_minimum };
}

/** A corpus is unchanged iff the hash matches — a single transcript edit or added/removed video changes it. */
export function corpusUnchanged(before: CorpusManifest, after: CorpusManifest): boolean {
  return before.corpus_hash === after.corpus_hash;
}

// ── Replay run ledger (append-only; no silent reruns) ─────────────────────────
export interface ReplayRunManifest {
  run_id: string;               // unique, e.g. "R-2026-001" (caller-supplied; never reused)
  compiler_commit: string;
  extraction_commit: string;
  replay_engine_commit: string;
  dataset_hash: string;         // = the CorpusManifest.corpus_hash this run graded against
  ir_version: string;           // IR_VERSION at run time (e.g. "1.0")
}
export interface ReplayRunRecord {
  manifest: ReplayRunManifest;
  result: "PASS" | "FAIL" | "INDETERMINATE";
  failure_distribution?: Record<string, number>; // dominantFailureClass output, when FAIL
}

/**
 * Append a run to the ledger. ENFORCES no-silent-rerun: a run_id is never reused, and an existing record is
 * never overwritten — a re-run after a fix MUST carry a new run_id. Throws on a duplicate id (the bug guard).
 */
export function appendRun(ledger: ReplayRunRecord[], record: ReplayRunRecord): ReplayRunRecord[] {
  if (ledger.some((r) => r.manifest.run_id === record.manifest.run_id)) {
    throw new Error(`replay-run-ledger: run_id '${record.manifest.run_id}' already exists — reruns get a NEW id, never an overwrite`);
  }
  return [...ledger, record];
}

/** Two records are comparable only if they ran the SAME corpus; otherwise a coverage delta is confounded. */
export function runsComparable(a: ReplayRunRecord, b: ReplayRunRecord): boolean {
  return a.manifest.dataset_hash === b.manifest.dataset_hash;
}

export type { EvidenceMode };
