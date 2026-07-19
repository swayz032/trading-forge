# WAVE-1 INSTRUMENTATION — trial-counter artifact + passage-ledger format. DESIGN FOR RATIFICATION (2026-07-18)

Per R-036 pin 2 (trial counter), R-036 pin 8 + R-041 §5 (passage ledger — "agent designs the format, advisor ratifies"). Wave 1 is the honestly-labeled PIPELINE-SHAKEDOWN wave (R-041 §3): NO survivor eligibility, every verdict scope-lined `≈0.99 binding-approximation — near-ungated entries; framework-behavior measurement, NOT edge evidence`, but every run STILL feeds the trial counter. These two artifacts are the wave's true deliverables. Proposed here for ratification BEFORE dispatch; nothing built into the battery yet.

## 1. TRIAL-COUNTER ARTIFACT (R-036 pin 2 — "counting from zero, every run forever, an artifact")

**Purpose:** the corpus-wide denominator the luck-correction (DSR / PBO / BIF) consumes. The anti-luck math dies of leaked trials, so EVERY battery run — pass, fail, re-run, shakedown, aborted-with-signature — increments it. It is an ARTIFACT (persistent file), never a memory or a recomputed-on-the-fly number.

**Location (proposed):** `docs/replay-results/h1-battery/trial-counter.json` (single source of truth; append-only log + a monotonic total).

**Schema:**
```json
{
  "artifact": "h1-trial-counter",
  "zero_point": "2026-07-18T..Z",        // stamped once at creation; from zero
  "engine_sha_at_zero": "404a3396",
  "total_trials": <int>,                  // monotonic; == len(runs)
  "runs": [
    {
      "trial_id": <int>,                  // 1-based, dense, never reused
      "wave": "shakedown-1",
      "strategy_ref": "<video>__sN | spec_hash",
      "spec_hash": "<sha256>",
      "engine_sha": "404a3396",
      "outcome": "PASS|FAIL|REJECTED|INDETERMINATE|ABORTED",
      "abort_signature": "<null | e.g. MCL-negative-settle | OOM-requeue>",
      "binding_approximation_rate": <float>,   // travels with EVERY trial (R-040 pin 2iii)
      "survivor_eligible": false,          // HARD false for the shakedown wave (R-041 §3)
      "scope_line": "shakedown; ≈0.99 binding-approx; framework-behavior NOT edge",
      "run_epoch": {"engine_sha": "404a3396", "concurrency": <int>, "batch": "<id>"}
    }
  ]
}
```
**Invariants (test-backed at land):** (a) `total_trials == len(runs)`; (b) `trial_id` dense + monotonic, never reused across resumes (manifest-hygiene law — a resumed run must not double-count or skip); (c) counter increments on the ABORT path too (expected-abort signatures still count — a trial happened); (d) `binding_approximation_rate` present on every run (mechanical scope-line, not remembered); (e) append-only — a re-run appends a NEW trial_id, never mutates a prior one.

## 2. PASSAGE-LEDGER FORMAT (R-036 pin 8 / R-041 §5 — the advisor-led PASSAGE AUDIT)

**Purpose:** prove each gate RECEIVED the case AND FIRED with its inputs visible — the anti-dormant-judge discipline (Law 1: a gate that can't be seen receiving-and-firing is the vacuous class). First passage per gate-class audited fully, then spot-checks. For the shakedown wave the ledger IS the deliverable (the verdicts are framework-measurement, but the LEDGER proves the courtroom works).

**Location (proposed):** `docs/replay-results/h1-battery/passage-ledger.json` (grows per wave).

**Schema — one row per (strategy × gate):**
```json
{
  "artifact": "h1-passage-ledger",
  "wave": "shakedown-1",
  "engine_sha": "404a3396",
  "rows": [
    {
      "strategy_ref": "<video>__sN",
      "spec_hash": "<sha256>",
      "gate": "walk_forward | CPCV | PBO | DSR | monte_carlo_ruin | B14_prop_survival | B15 | compile_fidelity_forensics",
      "received": true,                    // the gate was HANDED this case
      "fired": true,                       // it EVALUATED (not skipped/NOT_EVALUATED)
      "engagement_receipt": {              // inputs VISIBLE — proof it judged, not rubber-stamped
        "inputs_seen": ["<e.g. 200 folds, fold_sharpe[]>"],
        "value": "<the gate's actual output/statistic>",
        "verdict": "PASS|FAIL|NOT_EVALUATED",
        "engaged_features": ["fill_model", "event_calendar", "..."]  // R-036 pin 4 sweep
      },
      "exit_provenance": "<house-default (trader taught none) | trader-taught>",  // F-3 consumer
      "scope_line": "shakedown; ≈0.99 binding-approx; NOT edge evidence",
      "audit_level": "first-passage-full | spot-check"
    }
  ]
}
```
**Rules:** (a) `received=true, fired=false` is an ALARM (a gate got the case but didn't evaluate — dormant-judge); (b) `NOT_EVALUATED` must carry a reason + the missing input named; (c) the FIRST passage of every gate-class is `first-passage-full` (every field populated + inspected); (d) the exit_provenance field is where the F-3 house-default stamp lands — **the ledger is the stamp's consumer** (R-041 §2), so the deferred TS test must land before any ledger row is trusted; (e) `engaged_features` is the R-036 pin-4 engagement sweep, per row, so a dormant default-ON feature can't hide.

## 3. WHY THESE TWO, NOW
R-041 §3 named the shakedown wave's true deliverables exactly: "the passage ledger exercised on real cases, the engagement sweeps live, every judge witnessed receiving-and-firing, the battery ops rhythm proven, the trial counter running from zero." These two artifacts ARE that. They are designed to survive into every future (real-fidelity) wave unchanged — the shakedown just fills them first.

## RATIFICATION ASKS (advisor)
1. Ratify/correct the trial-counter schema + invariants (esp. abort-path counting + resume dedup).
2. Ratify/correct the passage-ledger row format + the gate-class list (is `compile_fidelity_forensics`, R-040 pin 2iv, a ledger gate-class or a separate pre-survivor stage?).
3. Confirm the shakedown scope-line wording is what should travel on every trial + ledger row.
