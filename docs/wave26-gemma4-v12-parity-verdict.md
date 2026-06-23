# Wave 26 Gemma4 v12 Parity Verdict

**Date:** 2026-06-23
**Runner:** Pass 8 Track C
**Script:** `scripts/wave26-gemma4-smoke-test.ts --parity-only`
**Prompt version under test:** `src/agents/transcript-extractor.md` (`<!-- PROMPT_VERSION: 12 -->`)
**Status:** FAIL_NEEDS_OPERATOR_DECISION

---

## Summary

The v12 SPEAKER-VOCABULARY MANDATE (added in Wave 26 Pass I) requires every extracted strategy to include `speaker_concepts` — an array of ≥5 items, each having:
- `role` (closed enum: `indicator | zone | filter | entry_step | stop_anchor | target | model | phase`)
- `verbatim_description` (speaker's exact wording)
- `transcript_quote` (verbatim transcript substring, ≤150 chars)

The parity test **validates the few-shot fixtures** in `src/agents/kb/few-shot/transcript-extractor/` against the v12 spec. None of the four tested fixtures (04, 05, 07, 08) contain `speaker_concepts`. Therefore:

- **v10/v11 check: PASS** (all 4 fixtures pass direction, archetype, entry_sequence, stop_loss_structured, targets, filters)
- **v12 check: FAIL** (all 4 fixtures fail — no `speaker_concepts` present)
- **Overall: FAIL**

---

## Per-Fixture Results

| Fixture | v10 PASS | v11 PASS | v12 PASS | speaker_concepts found | Failure reason |
|---------|----------|----------|----------|------------------------|----------------|
| `04-bounce-off-level-archetype.json` | YES | N/A (not a v11 fixture) | NO | 0 | `speaker_concepts` field missing entirely |
| `05-ict-bias-aligned-continuation-archetype.json` | YES | N/A (not a v11 fixture) | NO | 0 | `speaker_concepts` field missing entirely |
| `07-v11-deep-extraction-sfp-displacement-fvg.json` | YES | YES | NO | 0 | `speaker_concepts` field missing entirely |
| `08-v11-ma-bounce-2step.json` | YES | YES | NO | 0 | `speaker_concepts` field missing entirely |

**Verdict for each fixture:** v12 FAIL

---

## What v12 Requires (Per Prompt)

From `src/agents/transcript-extractor.md` lines 4-48 (`<!-- PROMPT_VERSION: 12 -->`):

```json
"speaker_concepts": [
  {
    "term": "swing failure pattern",
    "role": "entry_step",
    "verbatim_description": "...",
    "transcript_quote": "..."
  }
]
```

Minimum 5 per strategy. Maximum 20. Each `transcript_quote` must be a literal substring of the transcript, ≤150 chars.

---

## Audit Stamp

`prompt.v12_parity_verified` audit write was attempted. Result: **non-fatal failure** (no `DATABASE_URL` in CI environment). When run from a wired server context, the audit row will be written with `status='warn'`.

---

## Root Cause

The four few-shot fixture files were written for v10 (fixtures 04, 05) and v11 (fixtures 07, 08). The v12 `speaker_concepts` field was added to the prompt in Wave 26 Pass I **after** these fixtures were authored. No one has back-filled them.

This is an expected, documented gap — not a bug in the prompt or the extractor.

---

## Operator Decision Required

The CLAUDE.md `Don't` rule states:
> "Don't change transcript_extractor prompt or KB cards without re-running 5-fixture parity test."

The parity test was run. It FAILED on v12. Per Pass 8 Track C mandate:

> "If FAIL: do NOT revert the prompt automatically. Document the failure and recommend operator action."

The prompt (`src/agents/transcript-extractor.md`) is NOT being reverted.

### Recommended Operator Actions (in order of preference)

**Option A — Add `speaker_concepts` to fixtures (recommended):**
Update fixtures 04, 05, 07, 08 to include representative `speaker_concepts` arrays drawn from their existing `transcript_snippet` text. This closes the v12 parity gap and allows the test to PASS on next run.

Example for fixture 07 (`htf_bias_sfp_displacement_fvg_continuation_mes`):
```json
"speaker_concepts": [
  {
    "term": "higher timeframe bias",
    "role": "filter",
    "verbatim_description": "Weekly, daily, and 4-hour all trending in the same direction",
    "transcript_quote": "Weekly. Daily. Four hour. All three need to be trending in the same direction."
  },
  {
    "term": "swing failure pattern",
    "role": "entry_step",
    "verbatim_description": "Price raids a prior swing high or low, the wick goes through, but the candle closes back through the level",
    "transcript_quote": "The wick goes through and takes out everybody's stops. But here's the key — the candle has to CLOSE back through that level."
  },
  {
    "term": "displacement candle",
    "role": "entry_step",
    "verbatim_description": "A large-body candle after the SFP that creates a fair value gap and breaks market structure",
    "transcript_quote": "A large displacement candle that creates a fair value gap and breaks market structure."
  },
  {
    "term": "fair value gap",
    "role": "zone",
    "verbatim_description": "The gap created by the displacement candle that acts as the entry zone",
    "transcript_quote": "I then enter inside that FVG."
  },
  {
    "term": "equal highs and equal lows",
    "role": "target",
    "verbatim_description": "Primary target zones — liquidity magnets where price is drawn",
    "transcript_quote": "The best targets are equal highs and equal lows. They are liquidity magnets."
  }
]
```

**Option B — Accept FAIL as documented technical debt:**
Keep fixtures at v11 without `speaker_concepts`. The test will continue to FAIL on `--parity-only`. The v12 prompt remains live. Operator acknowledges the fixture-backfill is pending work.

**Option C — Create a separate v12 fixture set (08+ range):**
Add one new fixture (e.g., `09-v12-speaker-concepts-canonical.json`) that fully demonstrates the v12 `speaker_concepts` shape. The existing four fixtures remain at v10/v11. The test PASSES when that fixture is included in the static set.

---

## What Was NOT Changed

Per CLAUDE.md `Don't` rule and Pass 8 Track C mandate:
- `src/agents/transcript-extractor.md` was NOT modified
- `src/agents/kb/few-shot/transcript-extractor/*.json` fixture files were NOT modified
- Prompt was NOT reverted to v11

---

## What Was Changed

- `scripts/wave26-gemma4-smoke-test.ts` — updated to include v12 parity checks:
  - Banner updated to "PASS 8 TRACK C — 5-FIXTURE PARITY TEST v12"
  - `ParityFixture.requirements.min_speaker_concepts` field added
  - All 6 `PARITY_FIXTURES` (F1-F6) updated with `min_speaker_concepts: 5`
  - `checkV12SpeakerConcepts()` helper added
  - `runStaticParityTests()` now checks v12 `speaker_concepts` in fixture JSON files
  - `validateParityFixtureOutput()` now checks v12 in live LLM parity path
  - `emitV12ParityAudit()` function added — writes `prompt.v12_parity_verified` audit row (non-fatal on DB unavailability)
  - `--parity-only` path now calls `emitV12ParityAudit()` before exit

---

## Parity Gap Assessment

| Check layer | Status |
|-------------|--------|
| v10 (direction, archetype, confluence) | GREEN — all fixtures pass |
| v11 (entry_sequence, stop_loss_structured, targets, filters) | GREEN — all v11 fixtures pass |
| v12 (speaker_concepts ≥5 with role+verbatim+quote) | RED — fixtures predate v12, no speaker_concepts |
| Live LLM extraction (gemma4:e2b) | NOT TESTED (--parity-only path) |

The v12 prompt is live and instructs Gemma to extract `speaker_concepts`. Whether live LLM extraction actually produces them requires running the full smoke test (requires Ollama + gemma4:e2b running). The static fixture gap documented here is a fixture authoring gap, not a prompt defect.
