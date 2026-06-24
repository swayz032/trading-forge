/**
 * E-RECALL+REPAIR (2026-06-22) — Layer 3: bounded, quote-grounded coverage repair loop.
 *
 * When the depth-aware coverage gate returns coverage_failed (a PRIMARY speaker item is
 * missing or SHALLOW), this loop closes the gap honestly instead of stopping:
 *
 *   while (verdict != pass AND coverage_pct < ACCEPT_PCT AND rounds < MAX_ROUNDS):
 *     targets = (missing[] + shallow[]) speaker items, primary-first, <= MAX_TARGETS
 *     recovered = ONE targeted gemma call: "you missed/under-captured THESE; here is the
 *                 exact transcript quote for each — extract the full rule, quote verbatim"
 *     PURE MERGE (gap-fill only): drop unverified quotes, UNION confluences by name,
 *                 append entry steps not already substring-covered
 *     re-run the DEPTH-AWARE computeCoverageVerdict (pure, free) against the SAME speaker
 *                 items (enumeration is NOT repeated — it's the expensive part)
 *
 * Convergence guarantee: each round only ADDS quote-grounded, depth-passing content, so
 * coverage_pct is monotone non-decreasing; the round counter is hard-bounded. Whatever
 * still fails after MAX_ROUNDS is left for the existing W3.2 quarantine (no library
 * pollution — the operator-confirmed safety layer).
 *
 * Architecture: imports logger from the leaf module (see feedback_helper_logger_import.md).
 * The merge + target-selection are PURE (unit-testable); only the loop calls the LLM.
 */

import { callScoutExtractLlm } from "../services/model-router.js";
import { verifyQuoteInTranscript } from "./transcript-extractor-recall.js";
import {
  computeCoverageVerdict,
  type SpeakerItem,
  type CoverageVerdict,
  type ExtractionSnapshot,
} from "./extraction-coverage-gate.js";
import { logger } from "./logger.js";

// 2026-06-23: GBNF schema locking gemma to the REPAIR output shape. Without it the repair call
// reused the strategies-extractor schema (callScoutExtractLlm default) → gemma returned
// {strategies:[...]} → parsed.recovered_steps was always undefined → repair recovered NOTHING →
// the enumerated named-concept misses (GA box, break block, etc.) were never recovered, so coverage
// never improved. Same root cause + fix as the coverage enumerator.
const REPAIR_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["recovered_steps", "recovered_confluences"],
  properties: {
    recovered_steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "evidence_quote"],
        properties: { action: { type: "string" }, rationale: { type: "string" }, evidence_quote: { type: "string" } },
      },
    },
    recovered_confluences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "evidence_quote"],
        properties: { name: { type: "string" }, description: { type: "string" }, evidence_quote: { type: "string" } },
      },
    },
  },
};

const REPAIR_MAX_ROUNDS = Number(process.env.COVERAGE_REPAIR_MAX_ROUNDS) || 2;
const REPAIR_ACCEPT_PCT = Number(process.env.COVERAGE_REPAIR_ACCEPT_PCT) || 0.95;
const REPAIR_MAX_TARGETS = Number(process.env.COVERAGE_REPAIR_MAX_TARGETS) || 6;

export interface RepairResult {
  /** The repaired extraction (entry_sequence + confluences gap-filled). */
  extraction: ExtractionSnapshot;
  /** Final depth-aware verdict after the loop. */
  verdict: CoverageVerdict;
  /** How many gemma repair calls ran. */
  rounds: number;
  /** Names of speaker items that moved into `covered` across the loop. */
  repaired: string[];
}

export interface RecoveredStep {
  action?: string | null;
  rationale?: string | null;
  evidence_quote?: string | null;
}
export interface RecoveredConfluence {
  name?: string | null;
  description?: string | null;
  evidence_quote?: string | null;
}

// ─── Target selection (PURE) ──────────────────────────────────────────────────

/**
 * Pick the repair targets from a verdict: missing[] + shallow[], PRIMARY items first,
 * deduped, capped. These are the items the targeted recall call will try to recover.
 */
export function selectRepairTargets(
  verdict: CoverageVerdict,
  speakerItems: SpeakerItem[],
  max: number = REPAIR_MAX_TARGETS,
): SpeakerItem[] {
  const wantNames = new Set<string>([...verdict.missing, ...verdict.shallow]);
  const targets = speakerItems.filter((i) => wantNames.has(i.name));
  // primary first, then secondary, then mention
  const rank = (e: SpeakerItem["emphasis_level"]) => (e === "primary" ? 0 : e === "secondary" ? 1 : 2);
  targets.sort((a, b) => rank(a.emphasis_level) - rank(b.emphasis_level));
  return targets.slice(0, max);
}

// ─── Pure merge (gap-fill only) ───────────────────────────────────────────────

function contentLower(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Merge recovered steps + confluences into the extraction — PURE, gap-fill only.
 *
 *   - Each recovered item is kept ONLY if its evidence_quote verifies in the transcript
 *     (drops fabrication).
 *   - Recovered entry steps are APPENDED unless their action text is already substring-
 *     covered by an existing step (no duplicate steps).
 *   - Recovered confluences are UNIONed by lowercased name (mirrors transcript-chunker).
 *
 * Returns a NEW extraction object (does not mutate the input).
 */
export function mergeRepairResult(
  extraction: ExtractionSnapshot,
  recoveredSteps: RecoveredStep[],
  recoveredConfluences: RecoveredConfluence[],
  transcript: string,
): ExtractionSnapshot {
  const entry_sequence = Array.isArray(extraction.entry_sequence)
    ? [...extraction.entry_sequence]
    : [];
  const confluences = Array.isArray(extraction.confluences) ? [...extraction.confluences] : [];

  // Existing action corpus for dedup.
  const existingActions = entry_sequence
    .map((s) => (typeof s.action === "string" ? contentLower(s.action) : ""))
    .filter((a) => a.length > 0);
  let maxStep = entry_sequence.reduce((m, s) => Math.max(m, typeof s.step === "number" ? s.step : 0), 0);

  for (const rs of recoveredSteps) {
    const action = typeof rs.action === "string" ? rs.action.trim() : "";
    const quote = typeof rs.evidence_quote === "string" ? rs.evidence_quote.trim() : "";
    if (!action || !quote) continue;
    if (!verifyQuoteInTranscript(quote, transcript)) continue; // anti-fabrication
    const al = contentLower(action);
    // skip if an existing step already substring-covers this action (either direction)
    if (existingActions.some((ex) => ex.includes(al) || al.includes(ex))) continue;
    maxStep += 1;
    entry_sequence.push({
      step: maxStep,
      action,
      rationale: (typeof rs.rationale === "string" && rs.rationale.trim()) || quote,
    });
    existingActions.push(al);
  }

  const confByName = new Map<string, { name: string; description: string }>();
  for (const c of confluences) {
    if (c && typeof c.name === "string") confByName.set(c.name.toLowerCase().trim(), c);
  }
  for (const rc of recoveredConfluences) {
    const name = typeof rc.name === "string" ? rc.name.trim() : "";
    const quote = typeof rc.evidence_quote === "string" ? rc.evidence_quote.trim() : "";
    if (!name || !quote) continue;
    if (!verifyQuoteInTranscript(quote, transcript)) continue;
    const key = name.toLowerCase();
    if (confByName.has(key)) continue; // UNION — keep first
    confByName.set(key, {
      name,
      description: (typeof rc.description === "string" && rc.description.trim()) || quote,
    });
  }

  return { ...extraction, entry_sequence, confluences: [...confByName.values()] };
}

// ─── Targeted recall (impure — ONE gemma call) ────────────────────────────────

function buildTargetedRecallPrompt(transcript: string, targets: SpeakerItem[]): string {
  const itemBlock = targets
    .map(
      (t, i) =>
        `${i + 1}. "${t.name}" (${t.emphasis_level}) — speaker quote: "${t.verbatim_quote}"`,
    )
    .join("\n");
  return `You are repairing an incomplete trading-strategy extraction. A first pass MISSED or only name-dropped the following items that the speaker actually TEACHES. For EACH item below, read the transcript and extract the FULL rule/mechanic the speaker describes — how it is constructed and used in the setup — and quote the transcript verbatim as evidence.

## ITEMS TO RECOVER (with the speaker's own quote as a locator)
${itemBlock}

## TRANSCRIPT
\`\`\`
${transcript.slice(0, 16_000)}
\`\`\`

## RULES
1. Only extract what the speaker actually says. Do NOT invent rules.
2. evidence_quote MUST be an exact substring of the transcript above (10-160 chars).
3. Capture the MECHANIC (how to draw/construct/use it), not just the name.
4. recovered_steps = ordered actions for the setup; recovered_confluences = supporting conditions/filters.
5. If you genuinely cannot find an item, omit it (do not fabricate).
6. ★ For EACH item in ITEMS TO RECOVER that you find in the transcript, you MUST emit a
   recovered_confluence whose "name" is the item's name copied VERBATIM (exact characters — this
   is how we confirm the named concept is now captured), with "description" = the mechanic and
   "evidence_quote" = the verbatim transcript substring. You may ALSO emit recovered_steps for
   procedural detail, but the verbatim-named confluence per recovered item is REQUIRED. Do NOT
   rename the concept (e.g. do not turn "break block" into "Candle Anatomy") — copy the name as-is.

Return ONLY valid JSON:
{ "recovered_steps": [ { "action": "...", "rationale": "...", "evidence_quote": "..." } ],
  "recovered_confluences": [ { "name": "...", "description": "...", "evidence_quote": "..." } ] }`;
}

/**
 * One targeted gemma call to recover the missing/shallow items. Returns parsed
 * recovered steps + confluences (unverified — mergeRepairResult does the quote check).
 * @throws never — returns empty arrays on any failure.
 */
export async function runCoverageTargetedRecall(
  transcript: string,
  targets: SpeakerItem[],
): Promise<{ steps: RecoveredStep[]; confluences: RecoveredConfluence[] }> {
  if (targets.length === 0) return { steps: [], confluences: [] };
  const prompt = buildTargetedRecallPrompt(transcript, targets);

  let raw: string | null = null;
  try {
    // opts is the 5th param (after callFn + sleepFn) — pass all four leading args, then opts.
    raw = await callScoutExtractLlm([{ role: "user", content: prompt }], undefined, undefined, undefined, {
      schemaOverride: REPAIR_SCHEMA,
      skipFewShot: true,
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "coverage-repair: targeted recall LLM threw");
    return { steps: [], confluences: [] };
  }
  if (!raw) return { steps: [], confluences: [] };

  let parsed: { recovered_steps?: unknown[]; recovered_confluences?: unknown[] } | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      parsed = JSON.parse(stripped);
    } catch {
      logger.warn({ raw: raw.slice(0, 160) }, "coverage-repair: targeted recall non-JSON");
      return { steps: [], confluences: [] };
    }
  }

  const steps = Array.isArray(parsed?.recovered_steps)
    ? (parsed.recovered_steps as RecoveredStep[])
    : [];
  const confluences = Array.isArray(parsed?.recovered_confluences)
    ? (parsed.recovered_confluences as RecoveredConfluence[])
    : [];
  return { steps, confluences };
}

// ─── Bounded repair loop (orchestrator) ───────────────────────────────────────

export async function runCoverageRepairLoop(opts: {
  transcript: string;
  extraction: ExtractionSnapshot;
  speakerItems: SpeakerItem[];
  verdict: CoverageVerdict;
  maxRounds?: number;
  acceptPct?: number;
  onRound?: (round: number, verdict: CoverageVerdict, targets: string[]) => void;
}): Promise<RepairResult> {
  const maxRounds = opts.maxRounds ?? REPAIR_MAX_ROUNDS;
  const acceptPct = opts.acceptPct ?? REPAIR_ACCEPT_PCT;

  let extraction = opts.extraction;
  let verdict = opts.verdict;
  const initialCovered = new Set(verdict.covered);
  let rounds = 0;

  while (
    verdict.verdict !== "pass" &&
    verdict.coverage_pct < acceptPct &&
    rounds < maxRounds
  ) {
    const targets = selectRepairTargets(verdict, opts.speakerItems);
    if (targets.length === 0) break; // nothing addressable

    const recovered = await runCoverageTargetedRecall(opts.transcript, targets);
    if (recovered.steps.length === 0 && recovered.confluences.length === 0) {
      rounds += 1;
      break; // gemma had nothing to add — stop (residual goes to quarantine)
    }

    extraction = mergeRepairResult(
      extraction,
      recovered.steps,
      recovered.confluences,
      opts.transcript,
    );
    // FREE re-verification against the SAME speaker items (no re-enumeration).
    verdict = computeCoverageVerdict(opts.speakerItems, extraction);
    rounds += 1;
    opts.onRound?.(rounds, verdict, targets.map((t) => t.name));
  }

  const repaired = verdict.covered.filter((n) => !initialCovered.has(n));
  return { extraction, verdict, rounds, repaired };
}
