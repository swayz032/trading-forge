# Extraction Over-Specification Audit (PRE-REGISTERED, 2026-07-05)

**Status:** pre-registered design (operator + GPT, 2026-07-05). Dependent variable = **semantic inflation**,
NOT profitability. No backtest in this audit — market behavior is a SEPARATE, later, conditionally-triggered
experiment.

## Leading hypothesis (evidence-consistent, NOT established)
*The extracted executable representation is systematically more restrictive than the educator's actual
decision process* — extraction converts optional / alternative / contextual cues into mandatory spine
(hard-AND) conditions, so faithful execution over-conjoins and rarely trades.

## Dependent variable — Decision Requirement Inflation (DRI)
Per strategy, reconstruct three layers:
| Layer | Question |
|---|---|
| Transcript | How many conditions does the educator ACTUALLY require before entering? |
| Extracted graph | How many conditions became HARD (spine) requirements? |
| Executed graph | How many are actually evaluated at runtime? |

`DRI = extracted_required_conditions / transcript_required_conditions`.
- DRI ≈ 1 → faithful · DRI > 1 → over-specification · DRI < 1 → under-specification.
Also report: required-count, optional-count, alternative-route-count, sequential-dependency-count,
**hard-conjunction depth** (size of the strict-AND that gates entry).

## Method — ADVERSARIAL evidence accounting (not interpretation)
For EVERY extracted hard (spine-role) condition, the auditor must answer from the transcript span/evidence:
> **"What transcript evidence makes this MANDATORY? Would removing it CONTRADICT the educator?"**

Classify each hard condition into exactly one:
- **JUSTIFIED_MANDATORY** — transcript makes it a required gate ("only enter when…", "must see…", "I need…").
- **OPTIONAL** — educator lists it as a plus/confluence, not a gate ("ideally", "bonus", "helps").
- **ALTERNATIVE** — one of several routes ("or", "either… or…", "any of").
- **CONTEXTUAL** — background/analysis framing, not an entry gate ("the market is…", "generally").
- **UNRESOLVED** — no clear transcript evidence either way (default-suspicious: counts toward candidate inflation but flagged separately).

**Inflation = OPTIONAL + ALTERNATIVE + CONTEXTUAL** conditions promoted to hard spine. Transcript-required =
JUSTIFIED_MANDATORY count. Default to candidate-inflation when evidence is absent (adversarial bias — the
extractor must EARN each hard requirement).

## PRE-REGISTERED thresholds + decision (fixed before looking)
- **SAMPLE FLOOR:** ≥ 12 strategies (distinct concepts) across ≥ 6 families, stratified across timeframes.
  Below floor → INCONCLUSIVE.
- **OVER-SPECIFICATION CONFIRMED** iff: median **DRI ≥ 1.5** AND corpus inflation rate
  (inflated_hard / total_hard) **≥ 0.30** — i.e. extraction demands ≥50% more required conditions than the
  educator, and ≥30% of hard requirements are unjustified.
- **NOT over-specification** iff: median DRI ≤ 1.15 AND inflation rate ≤ 0.10 (extraction is faithful — the
  strategies genuinely are ultra-selective, and the low trade frequency is real, not an artifact).
- **INCONCLUSIVE:** anything between, or below sample floor.
- Decision applied ONCE.

## Follow-on behavioral test (SEPARATE, triggered ONLY if OVER-SPECIFICATION CONFIRMED)
Reduce ONLY the unjustified hard requirements (demote inflated OPTIONAL/CONTEXTUAL to confluence, ALTERNATIVE
to or_branches), byte-identical else, re-run. Pre-registered causal chain if over-specification was dominant:
`DRI ↓ → hard-conjunction depth ↓ → trade frequency ↑ → behavioral diversity ↑ → SDS ↑`.
**Falsifier:** if DRI drops substantially but trade frequency / SDS do NOT move → over-specification is real
but not the dominant behavioral bottleneck → another hypothesis (state-handling / temporal / data) is next.

## Provenance / rigor
- Every classification cites the transcript span (the extraction already stores per-condition evidence spans;
  transcripts available in the extraction artifacts). Evidence accounting, reproducible, not vibes.
- Independent second-pass on a subsample (inter-rater agreement) to bound auditor subjectivity.
- Output: per-strategy DRI + classification table + corpus aggregates → `docs/replay-results/dri-audit-*.json`.

## Scope discipline
Semantic only — NO backtest, NO Sharpe/SDS in this audit. The point is a clean semantic measurement of
whether the extractor inflates requirements, decoupled from noisy market outcomes. Do not conflate the two.
