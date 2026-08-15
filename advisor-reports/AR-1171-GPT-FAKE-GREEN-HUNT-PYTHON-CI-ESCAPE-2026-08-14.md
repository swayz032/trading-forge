# GPT EXTERNAL ADVISOR RULING — AR-1171

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Type:** GPT FLASHLIGHT / FAKE-GREEN STATIC AUDIT  
**V4 stage:** SUP / CI SAFETY  
**Status:** FINDING CONFIRMED — FUTURE BOUNDED FIX PACKET

## SIMPLE RESULT

GPT found one real CI false-green escape at accepted P0-6 candidate `65a53ea95111a469e2324ba2e9df576f605eca99`.

The main CI can complete successfully even when the **full Python engine test suite fails**, because `.github/workflows/ci.yml` marks the full `pytest src/engine/` step `continue-on-error: true`.

The blocking fast lane does run Python, but only four selected files:

- `test_metric_snapshot.py`
- `test_golden_fixtures.py`
- `test_frankenstein.py`
- `test_cross_engine_parity.py`

Therefore a newly introduced failure in any other Python engine test can be invisible to the blocking fast pytest verdict while the full Python suite failure is tolerated by main CI.

This is not a claim that `65a53ea9` currently fails Python. Codex reported a clean candidate run. The finding is that **future Python regressions are not fail-closed by canonical CI**.

---

## EVIDENCE

### Main CI

`.github/workflows/ci.yml`:

```yaml
- name: Run pytest with coverage
  continue-on-error: true
  timeout-minutes: 25
  run: |
    pytest src/engine/ --cov=src/engine --cov-report=xml --cov-report=html -v --timeout=120 --timeout-method=thread
```

Because the step is advisory, a nonzero pytest result does not fail the `test-python` job solely on this step.

### Fast lane

`.github/workflows/fast.yml` collects pytest only from four selected files and compares that bounded report to the frozen pytest baseline. Its final verdict correctly requires the comparator steps to succeed, but it does not cover the rest of `src/engine/tests/`.

### Comparator

`ci/compare-baseline.mjs` was inspected independently. It is fail-closed on malformed/missing reports and floor breaches. GPT does **not** find a comparator bypass here.

So the defect is not the comparator. The defect is **coverage authority**: the only full Python suite is advisory.

---

## SEVERITY

**HIGH for production launch authority.**

Why:

```text
new Python regression outside 4 fast files
        ↓
fast pytest can stay GREEN
        ↓
full pytest can fail
        ↓
main CI tolerates it
        ↓
workflow may still present overall GREEN
```

That is the exact false-green class this flashlight lane is supposed to remove.

---

# SMALLEST SAFE FIX

Do not redesign CI.

At the first authorized CI-hardening slot after AR-1138 / two-worker activation:

1. Re-run the full Python suite from a clean candidate worktree.
2. If the candidate remains clean, remove `continue-on-error: true` from the main CI `Run pytest with coverage` step.
3. Keep the existing 25-minute collection backstop and 120-second per-test timeout.
4. Rename/comment the step as BLOCKING so intent is explicit.
5. Add one small anti-regression guard that fails if the canonical full-engine pytest step is ever made advisory again.

No Python engine behavior should change in this packet.

---

# REQUIRED RED / GREEN / MUTATION PROOF

## RED proof before fix

Use a disposable branch/worktree only.

Introduce a temporary failing test in a Python test file **not included in the four-file fast pytest set**.

Required observation:

```text
fast bounded pytest surface = does not execute the canary
full pytest = RED
current main CI full-pytest step = advisory / tolerated
```

Delete the canary after proof.

## GREEN after fix

At the fixed candidate:

```bash
pytest src/engine/ --cov=src/engine --cov-report=xml --cov-report=html -v --timeout=120 --timeout-method=thread
```

must exit `0`.

Then the CI workflow must have no `continue-on-error: true` on the canonical full Python test step.

## Mutation control

In a test fixture or disposable copy, reinsert `continue-on-error: true` on that exact canonical step.

The new anti-regression guard must fail.

This proves the guard protects the real workflow contract instead of merely passing beside it.

---

# DO NOT MIX INTO THIS FIX

Do not combine with:

- Python style cleanup;
- mypy cleanup;
- dependency audit cleanup;
- compiler semantic work;
- AR-1138;
- P0-6 live deployment;
- Agent Teams activation;
- Topstep network work.

This is a one-defect CI safety packet.

---

# SECONDARY OBSERVATION — NOT YET AUTHORIZED AS A FIX

The fast workflow also runs `npm run lint:false-success` as `continue-on-error: true`, and the script itself exits nonzero for findings only when called with `--strict`.

That makes the false-success lint intentionally double-advisory today.

GPT is **not** ordering it blocking yet because we have not independently proven the current scanned ops surface is finding-free at `65a53ea9`. The next fake-green audit substep should first determine the current finding count and whether the scanner covers all production-critical ops directories. Only then decide whether to promote `--strict` and remove workflow `continue-on-error`.

---

# ORDERING / GATES

This finding does **not** move ahead of AR-1138.

```text
AR-1138 remains first semantic gate
        ↓
GPT accepts AR-1138
        ↓
two-worker activation receipt accepted
        ↓
CI safety packet may be assigned when disjoint from higher-priority P0-6 live work
```

Worker 2 / Agent Teams / PAPER / broker egress remain gated exactly as in AR-1169 and AR-1170.

## Bottom line

**CONFIRMED:** canonical CI has one real Python false-green escape.

**Prepared smallest fix:** make the already-clean full Python suite blocking and add an anti-regression guard.

**Do not execute before the existing activation gates.**