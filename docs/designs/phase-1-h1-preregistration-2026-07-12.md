# Phase 1 (H1) — The Fidelity Instrument — PRE-REGISTRATION (FROZEN 2026-07-12)

> **Law 4 preamble.** This bar is set while the outcome is unknown. Every threshold that carries a prior is labeled a CALIBRATION ESTIMATE (same status as H2's 5%/1% bands), not a law. An ambiguous term found un-pinned later resolves to the STRICTEST reading available at this freeze time — never the convenient one. This document outranks memory. Authored at the doer seat; the sealed set (§3) and the Wave-5 read are the load-bearing independence gates.

Frozen alongside: `extraction-campaign-plan-2026-07-07.md` (Phase-1 brief = the source of this pre-reg's shape), `corpus-v3-gate1-respecification-2026-07-05.md` (the surface-gradient finding this instrument is built to detect), `h2-source-thesis-preregistration-2026-07-07.md` (the DOWNSTREAM read H1 unlocks — its bar is already frozen and is NOT re-opened here).

## §0 — What H1 IS (the three-tier extractor)
A machine that **classifies what it can prove, adjudicates what it can't, and certifies nothing it hasn't proven it can detect.** Per the campaign-plan Phase-1 brief:
- **(a) Tier-1 — deterministic gradient detectors** for the two carrying surface classes the taxonomy specced: **conditional-action** ("ACTION when/if/on TRIGGER") + **exclusion-contrast** ("X, NOT Y"), alongside the already-proven imperative family. High-precision / low-recall by design.
- **(b) Tier-2 — discourse-aware adjudication pass** for narration / probabilistic surfaces the sentence alone cannot classify (the classifier's dying gift: gate-strength can live in the discourse FRAME — fix-lists, disavowals, "here's how to correct it" — not the sentence). Closed taxonomy with a COST-FREE `cannot-determine`; `cannot-determine` routes to tier-3, and that routing RATE is the economics number.
- **(c) Tier-3 — fidelity certificate** per strategy: gate-strength survived BLIND adjudication under the closed taxonomy, control-gated rater, quote-anchored.

## §1 — SUCCESS BAR (FROZEN)
Read at Wave 5, ONCE, against the SEALED fresh set (§3).
- **Fresh set size:** **N ≥ 10** videos. Below N=10 → **LOW_POWER, NO verdict** (not a fudge — a withheld read).
- **QUALITY bar [CALIBRATION ESTIMATE]:** **≥ 60%** of the fresh set reach **certificate-grade extraction** (a per-strategy certificate whose every spine condition classifies at tier-1/2/3 with a quote anchor AND passes all compile-integrity lints — §4).
- **ECONOMICS rider [FROZEN, non-negotiable]:** **mean tier-3 adjudication invocations ≤ 1 per video.** Certificate-grade bought with UNBOUNDED adjudication spend fails the conveyor question BY DEFINITION — the whole point is a machine that scales, not a human-in-loop pipeline wearing a certificate. Quality met + economics missed is a DISTINCT outcome (§2), not a pass.
- **Scope line baked into the verdict (Law 7):** fresh-set-N + taxonomy version + extractor version + engine/snapshot. A per-timeframe or per-channel slice of the result is ANNOTATION-TIER only; the verdict is the aggregate.

## §2 — FAILURE MEANINGS (PRE-WRITTEN, so the result cannot author its own interpretation)
- **Miss on QUALITY** (< 60% cert-grade): iterate under a **pre-committed 2-pass budget** (the same discipline the classifier got — two passes, same rigor, then STOP). Two passes exhausted without clearing → H1's deterministic+discourse design is falsified for this source at this fidelity bar → the finding routes to the campaign-plan's Phase-1 fork.
- **Miss on ECONOMICS ONLY** (quality ≥ 60% BUT mean tier-3 > 1/video): H1 **NARROWS** to "fidelity achievable only at human-in-loop cost" → the pre-written **smaller-library / higher-per-strategy-investment fork.** This changes conveyor ECONOMICS, **NOT validity** — the instrument works; it just doesn't scale cheaply.
- **Neither miss is an H2/source-thesis falsification.** H1 asks "can we build the witness?"; H2 asks "is the witness worth listening to?" Keep them separate (the anti-collapse rule the campaign plan froze for H2's bands).

## §3 — THE SEALED SET (anti-set-shopping, sealed TONIGHT)
A **fresh-context agent** selects the N≥10 videos by the frozen criteria below and **seals the list (IDs + metadata ONLY — NO transcript opened).** Nobody — INCLUDING the doer — reads a transcript until Wave 5. This kills set-shopping accusations permanently: the population is fixed before the instrument that scores it exists.
**Selection criteria (FROZEN — strictest reading):**
1. **Day-trader focus** (intraday; reject swing/position/recap per `feedback_day_trader_only_no_swing`).
2. **Futures-mechanic-compatible** — reject only strategies whose MECHANIC is options-specific (Greeks/strikes/expiry) per `feedback_strategy_mechanic_not_instrument`; instrument-agnostic otherwise.
3. **Strategy-TEACHING** (a speaker teaching an entry/exit mechanic) — NOT critique / news / vlog / podcast / reaction (title-scored per CLAUDE.md §2b; `-3` critique/news/vlog keywords disqualify).
4. **ZERO overlap** with the existing corpus — no video whose ID already appears in any strategy's `config.metadata.source_url`. The agent enumerates the existing corpus source IDs FIRST, then excludes them.
5. English-language; transcript retrievable via the `youtube-transcript` path.
**Seal artifact** (`docs/designs/h1-sealed-fresh-set-2026-07-12.json`): per video — `video_id`, `title`, `channel`, `duration`, `criteria_match` (each of 1-5 → true + one-line why), `selected_at_criteria_version`. Plus a `sealed_sha256` over the sorted ID list. **NO transcript text, NO extracted content.** The seal is the commitment device; opening it early voids the read.

## §4 — CERTIFICATE SCHEMA (FROZEN)
The tier-3 fidelity certificate — one artifact per extracted strategy — carries, for EVERY spine condition:
- `surface_class` (imperative / conditional-action / exclusion-contrast / narration / probabilistic / cannot-determine)
- `classifying_tier` (1 deterministic / 2 discourse / 3 adjudicated)
- `quote_anchor` — the trader's VERBATIM words + `char_span` [start,end] into the full transcript (claim-scoping baked in: the certificate cannot assert a condition it cannot anchor)
- `adjudication_verdict` — present ONLY where `classifying_tier == 3` (blind rater's closed-taxonomy call + control-gate pass)
Plus, per certificate:
- `compile_integrity` — { direction_conflation_lint, unsat_sat_check, or_alternatives_honored, f2_coverage_gate, causality_lint } each pass/fail with the offending anchor on fail
- `provenance` — { source_video_id, full_transcript_sha256, extractor_version, taxonomy_version }
- `scope_line` — corpus + engine + snapshot + effective-N, travels with every downstream citation
A strategy reaches **certificate-grade** iff every spine condition classifies (tier 1/2/3) with an anchor AND all `compile_integrity` lints pass.

## §5 — READ-ONCE + INDEPENDENT VERIFICATION (inherited discipline)
Wave 5: unseal the fresh set → run the full conveyor end-to-end → read against the §1 bar ONCE → **independent fresh-context re-verification (grading-integrity, doer≠grader)** → H1 verdict ∈ { engineerable-at-conveyor-economics / engineerable-at-human-in-loop-cost / not-yet }. Pass → Phase 2 (H2 read under its already-frozen two-read rule). Every certificate from this run is ALSO the pilot population for replacing the legacy 3-provider intake gate.

## §6 — EXECUTION DEPENDENCY (#7 BEFORE #6, registered in the campaign plan)
**Wave 1 (the (b)-cert shakedown — 14-concept demotion fidelity adjudication) runs BEFORE Wave 2 (tier-1 detector build).** Its three outputs are load-bearing: (i) demotion's per-concept fidelity verdict → feeds the (b) cert track; (ii) the certificate machinery's FAILURE-MODE list → design input for the extractor; (iii) real throughput/cost per adjudication → the tier-3 ECONOMICS baseline the §1 rider is judged against. The Wave-2 SPEC may be written in parallel; only the Wave-2 IMPLEMENTATION gates on Wave-1's failure-mode report.

## §7 — ENGAGEMENT-EVIDENCE birthright (Law 1, applied to the new instrument)
Every tier-1 detector, every compile lint, and the tier-2 router ships with **failure-injection fixtures at birth**: it must FIRE on known-positives AND stay SILENT on known-negatives, proven before it is allowed to exist. Four dormancies were bought by shipping features that never fired; the new machine inherits the counter-rule as a condition of existence. Type specimens (from the gate-1 respec): N04/N34 positive fixtures, N06/N28 narration negative fixtures; overfit ratio tracked against the pinned ≤1.85× tripwire; design on the 143-condition set ONLY, validated on the held-out 70.

---
*Frozen 2026-07-12 at the doer seat, BEFORE the sealing agent runs and BEFORE any tier-1 line is written. Vaulted FF to `corpus-v3-gate3-cert-2026-07-06`. The bar exists before anyone can fall in love with what the machine might score.*
