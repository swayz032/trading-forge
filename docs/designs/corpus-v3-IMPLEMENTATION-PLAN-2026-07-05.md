# Corpus v3 — Implementation Plan (2026-07-05)

**Design:** `corpus-v3-semantic-role-classification-2026-07-05.md` (operator-approved, Fable-5-reviewed, both
pins locked). **Sequencing (operator-confirmed):** manifest → Gate 2 first → flag-gated classifier build →
shadow re-onboard → Gates 1 & 3 in order → (only if all pass) full flip. Doer≠grader holds: every gate verdict
independently re-computed before certification.

## PINNING MANIFEST (verbatim — checkable, not aspirational; captured 2026-07-05)
The Gate-3 shadow experiment (`v3-shadow-2026-07-05`) pins ALL of the following identical to the
v2-under-`TF_ROLE_DEMOTION_MODE=struct_ctx` control; ONLY `TF_SEMANTIC_ROLE_CLASSIFIER` varies:
- **engine_sha:** `1d350938d872870bf9f205c32ccf0457cd7689f0` (HEAD — corrected engine: DS#17 P&L + directional
  bug fixes + OR-branches + demotion mechanism all in).
- **data_snapshot:** `data_cache/{ES,NQ,CL}/ratio_adj/*.parquet` @ mtime `2026-07-05T13:32`; fingerprints
  ES/5min=6528042 B, NQ/5min=9304434 B, CL/5min=6445136 B (+ the 15min/1hour/daily files at the same snapshot for
  the non-5m concepts). Record the full file-size set in the shadow run's manifest JSON at execution time.
- **battery/rig:** the composition/demotion controlled-run rig (`role-demotion-controlled-run.py` path) — same
  fill model, same measurement instrument as the demotion experiment (deterministic; no RNG in the measurement
  path → seed N/A, but record `seed=deterministic_no_rng` explicitly so it's not an open variable).
- **symbols/timeframes:** MES/MNQ/MCL × the 14 audited-concept timeframes (1m/5m/15m/30m/1h/4h).
- **shadow set (14 concepts):** `75DJN5UVQnw`(S/R,5m) `jlShztsY3oA`(ORB,5m) `c8VLqF0XDR4`(entry,15m)
  `HfZTCZTDfWk`(bias,4h) `FqxEKDxemtI`(BB,5m) `snNkQSyWX4k`(MA-x,5m) `sVkmZklJDHI`(risk,1m) `N7uP9V0Iktc`(EMA,5m)
  `KXWRtV2LOVc`(OB,5m) `m-G1ag77aVc`(disc/prem,30m) `UBvfsImdI2U`(CRT,1h) `NMUd0oX_7Pg`(candle,5m)
  `ktkqq7QsN9Q`(VWAP,15m) `oDLt9zh33LE`(ORB,5m).
- provenance-stamp every shadow row `corpus_version="v3-shadow-2026-07-05"` + `engine_sha=1d35093…`.

## Build steps (STRICT ORDER)
**Step 1 — Gate 2 FIRST (main tree):** extend `scripts/wave26-gemma4-smoke-test.ts` to validate
`entry_conditions[].role` presence + value-domain (`spine|confluence|or_branch|context|trigger|invalidation`).
Land + green on the current v2 baseline BEFORE the classifier exists. Must not break `--parity-only` /
`--legacy-parity`. This is the ruler; cut it before measuring.

**Step 2 — Held-out split (reproducible):** partition the 221 DRI-labeled conditions (`dri-audit-2026-07-05.json`
`full_classification_table_first_pass`) into **rules-design 70% / held-out 30%** via a FIXED deterministic hash
of `condition_id` (no RNG — reproducible; record the split). ONLY the 70% may inform the deterministic pattern lists.

**Step 3 — Classifier build (extraction-100 worktree):** new `src/server/lib/gate-strength.ts` —
`classifyGateStrength(atom)` per the design's hybrid rule order (deterministic clear-cases from the 70% patterns
→ gemma adjudicates margin). `graph-to-engine.ts:76-89` reads gate-strength → role; `contextual → role="context"`
(RETAINED, engine-ignored). Flag `TF_SEMANTIC_ROLE_CLASSIFIER` (default OFF, byte-identical off). Tighten
`atomize-transcript.ts` discourse filter for the clearest context classes (defense-in-depth).

**Step 4 — Gate 1 (held-out 30%, stratified + binomial CI):** `src/server/lib/__tests__/gate-strength.test.ts`.
Overall held-out ≥85%; margin stratum passes iff 95% binomial-CI lower bound > held-out-margin majority-class
baseline; LOW_POWER → does-not-certify (not a failure). Report N + CI on every number.

**Step 5 — Shadow re-onboard + Gate 3 (bidirectional):** re-onboard the 14 concepts into `v3-shadow-2026-07-05`
under the pinned manifest, classifier ON. Backtest vs the `struct_ctx` control. Revival ≥8/9 with flag OFF +
`5m_support_level` spine non-empty; regression clause = zero unexplained deaths (every new death needs a promoted
`spine` condition + transcript-anchored justification). Independently re-verify before certifying.

**Step 6 — Flip (only if Gates 1+2+3 all pass):** `TF_SEMANTIC_ROLE_CLASSIFIER=true` → full-corpus in-place
re-onboard → stamp `corpus_version="v3-2026-07-…"` → full re-baseline (null-cal → Mode A/B). Shadow run is the
certified evidence.

## Non-goals (unchanged): Layer-2 (#26) separate; frozen execution findings not reopened; DRI taxonomy unchanged.

## AMENDMENT to Step 5 mechanism (LOCKED before results, Fable-5 approved 2026-07-05)
**Change:** Step 5 switches from FULL re-onboard (re-atomize all clauses via gemma → graph → classify) to
**FIXED-ATOM role-reassignment**: take each v2 spec's existing `entry_conditions`, run `classifyGateStrength()` on
each, emit v3 with ONLY the `role` field changed. Atoms held identical to v2.
**Rationale (confound removal — the manifest enforcing itself):** gemma re-atomization at temp 0.1 is NOT
run-to-run deterministic, so a re-atomize can produce a DIFFERENT atom set than v2 (a clause flips `is_decision`).
That varies more than the classifier flag → violates the locked manifest ("only `TF_SEMANTIC_ROLE_CLASSIFIER`
varies") and confounds Gate 3's attribution of a revival/death to the role classifier. Fixed-atom isolates the
one variable. The frozen Gate 3 decision rule (≥8/9 revival, zero unexplained deaths) is UNTOUCHED — only the
spec-production mechanism changed to the one that tests the pre-registered hypothesis. Faster too (gemma only on
margin conditions of 14 specs, not 3,558 clauses).

### Implication 1 — TEST = SHIP (chain-of-custody, Fable-5)
Fixed-atom Gate 3 certifies "classifier applied to v2 atoms." Therefore **fixed-atom re-role IS the production
v2→v3 migration mechanism** for the existing 117 strategies (their v2 atoms are already certified, provenance-
stamped work product; re-atomizing adds gemma noise and destroys reproducibility for nothing). v3 = v2 atoms +
classifier-assigned roles. The FULL extraction pipeline with the classifier inline remains the path for NEW videos
going forward, and gets its OWN pre-registered validation when the first post-v3 video onboards — NOT part of this cert.

### Implication 2 — NONDETERMINISM finding, frozen on its own line (Fable-5)
**"Gemma re-atomization at temp 0.1 is not run-to-run deterministic → atom sets are not reproducible artifacts."**
Consequence beyond Gate 3: any provenance claim "this spec is what the pipeline produces from this transcript" is
actually "…on this run"; the architecture's "atomize is the one LLM stage before deterministic graph-compile"
framing inherits this caveat. **Pre-registered future measurement (not now — needs tower, off critical path):**
re-atomize a few videos N times, report atom-set drift rate, so the caveat gets a number instead of a shrug.

### Record
- Killed re-onboard cost ~26 min tower time and nothing else; **no results were peeked at → pre-registration
  uncontaminated.** Partial 1/14 output quarantined to `_killed-reatomize-partial-QUARANTINE/`, out of the shadow namespace.
- **Certification stack UNCHANGED:** Gate 3 (fixed-atom, frozen rule, no relief) ∧ Gate 1′ (multi-rater adjudication
  of role diffs) ∧ path-parity (sync emit path reproduces async Gate 1 on the 221) → flip eligibility.
- Gate 1′ is SHARPER under fixed-atom: every behavioral delta is a role change by construction, so the adjudication
  set = exactly the role diffs on behaviorally-changed strategies, no atom-drift noise to exclude.
