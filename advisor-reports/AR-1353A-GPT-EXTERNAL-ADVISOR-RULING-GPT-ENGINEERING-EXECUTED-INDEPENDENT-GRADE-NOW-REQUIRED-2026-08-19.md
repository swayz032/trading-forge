# GPT EXTERNAL ADVISOR RULING — AR-1353A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Controlling prior ruling:** AR-1352A  
**Worker-1 base replay SHA:** `74a9dbfc29d9b857df60c6aaeec720de8b14d717`  
**GPT engineering branch:** `external-advisor/gpt-engineering`  
**Exact GPT engineering handoff SHA:** `eb1c2959d91039033a5fe1a2cea77d440bbac73f`  
**Disposition:** **GPT IMPLEMENTATION COMPLETE FOR THE ORDERED NARROW LANE; INDEPENDENT RATIFICATION REQUIRED. STEP 12 REMAINS OPEN UNTIL THE TASK-AUTHORITY REPAIR SURVIVES A FRESH DOER != GRADER ATTACK. THE SEPARATE FACTORY->FAITHFUL-COMPILE->SOURCE_FAITHFUL BRIDGE IS GET-AHEAD NEXT-STAGE WORK AND MUST NOT BECOME AN ARTIFICIAL STEP-12 BLOCKER.**

---

## 1. GPT EXECUTED THE AR-1352A LANE

GPT did not return the AR-1354 task-anchor defect to Worker 1 as prose. It implemented the repair on the isolated GPT engineering branch rooted exactly at Worker-1 replay SHA `74a9dbfc...`.

The engineering branch is nine commits ahead of that Worker base including its durable handoff report. The load-bearing implementation commits before the report are:

```text
f846c8c7cf55f5c1853ac113896c3190b3be911f  initial RED task-anchor proof
9b4b67fc4d83a0b290a45cd2b2ec734f95eb1e74  production fail-closed validator repair
53e0413e11595e5f6a9cb759cad74bc7650cc6d4  expanded task-anchor adversarial proof
4715e394cd15361b9304029adebf1b88cb4ec056  Factory faithful compile handoff
a978aac95933b5b6db3dde3a31fb37bfd10e4763  Factory handoff admission adversarial proof
c9ad262e1da0af7fc3ee61a74bcbe29f3b119224  durable handoff verifier
af01e9ea1bbfacc6850778fb5c9e1e7510de59b4  initial receipt-gated onboarding bridge
ed823335a819b14496bcb12503a57842aa6ce407  onboarding bridge hardening
```

Durable execution/grading handoff:

```text
docs/replay-results/gpt-engineering/GPT-ENGINEERING-AR1352A-EXECUTION-HANDOFF-2026-08-19.md
eb1c2959d91039033a5fe1a2cea77d440bbac73f
```

---

## 2. STEP-12 BLOCKING REPAIR — EXACT STATUS

The AR-1354 F-5 receipt validator previously skipped the locator task-hash join when either the receipt's `batch_task_sha256` or the unit's task-index file was absent.

GPT hardened `scripts/strategy_factory_prep_provenance_inventory.py` so locator authority now requires a complete durable chain:

```text
unit identity
   -> receipt identity
   -> raw-response SHA
   -> receipt task SHA
   -> task-index existence/readability
   -> task-index unit identity
   -> task-index task SHA
   -> receipt/index task-SHA equality
   -> actual emitted task existence
   -> actual task SHA equality
```

Every missing, malformed, or mismatched anchor fails closed.

GPT also expanded `scripts/_gpt_ar1354_missing_task_anchor_red_proof.py` to attack missing/malformed/index-identity/task-file mutation variants instead of only the one Worker-1 escalated mismatch shape.

### Independent ratification required

GPT authored this repair. GPT therefore **does not certify its own work**.

A fresh Claude / `accuracy-validator` must execute and independently attack the exact GPT head.

Minimum blocking commands:

```bash
python scripts/_gpt_ar1354_missing_task_anchor_red_proof.py
python scripts/_ar1353_f5_escalated_attack_proof.py
python scripts/strategy_factory_prep_provenance_inventory.py
```

Required baseline after inventory regeneration:

```text
42 opus_batch
5 none
0 needs_regeneration
```

If the stricter validator exposes a real missing authority anchor, report the exact unit(s). **Do not weaken the check to preserve the old count.**

The independent grader must also plant at least one attack not authored by GPT.

### Step-12 closure law

If this narrow blocking repair survives independent attack and no new retroactive certification defect is found:

```text
STEP 12 MAY CLOSE.
STRATEGY FACTORY MAY RESUME.
```

No additional get-ahead feature below is allowed to delay Step 12 merely because its own next-stage engineering still needs work.

---

## 3. GET-AHEAD WORK — NEXT BLUEPRINT DEPENDENCY IS ALREADY BUILT

In parallel GPT traced the production path ahead of Worker 1 and found:

```text
Strategy Factory certification/disposition
            [missing durable join]
canonical spec producer
 -> generic spec onboarding
 -> SpecConditionStrategy
 -> SOURCE_FAITHFUL backtester
```

The canonical compiler and SOURCE_FAITHFUL runtime already existed. GPT correctly reused them rather than creating a second compiler/backtester.

GPT built the missing Factory-specific admission bridge:

```text
Factory projection + locator inventory + source hashes + BOUND clean certificate
        ↓
strategy_factory_faithful_compile_handoff.py
        ↓
canonical produce_spec_artifact_from_record(... certificate=REAL_CERT ...)
        ↓
zero-approximation faithful compile gate
        ↓
.spec.json + hash-bound .factory-handoff.json
        ↓
strategy_factory_verify_handoff.py
        ↓
onboard-factory-faithful-spec.ts
        ↓
existing onboardSpecArtifact service
        ↓
SpecConditionStrategy / SOURCE_FAITHFUL / run_class_backtest
```

The Factory-specific path refuses:

- non-compile-ready Factory dispositions;
- identity-unresolved/multi-strategy units without a durable crosswalk;
- stale extraction/transcript hashes;
- retired/non-authoritative locator state;
- non-clean certificates;
- dry-run certificates;
- `UNBOUND_LEGACY` semantic answers;
- source/certificate identity mismatch;
- uncompiled canonical binding plans;
- nonzero classifier or binding approximation under the `FAITHFUL` handoff headline.

It emits no current survivor because **the current factory has zero real `FAITHFUL_COMPILE_READY_FOR_BACKTEST` rows.** That is correct fail-closed behavior.

---

## 4. CURRENT FACTORY TRUTH — DO NOT FAKE A SURVIVOR

The current committed projection contains:

```text
120 total manifest rows
102 projected
15 identity unresolved
3 out of scope
93 OTHER_MEASURED_REFUSAL
9 EXTRACTION_MISSING_REQUIRED_INFORMATION
15 IDENTITY_MATERIALIZATION_UNRESOLVED
0 FAITHFUL_COMPILE_READY_FOR_BACKTEST
```

Therefore:

```text
REAL BACKTEST SURVIVORS TODAY = 0
```

Do not create a synthetic clean row, relax a certificate, guess a multi-strategy crosswalk, or use generic onboarding to manufacture progress.

The first backtest must wait for a **real** source strategy to survive Factory certification and the canonical faithful compile path.

---

## 5. NEXT-STAGE INDEPENDENT GRADE

The get-ahead bridge should be independently attacked, but it is a separate next-stage bundle.

Minimum proof:

```bash
python scripts/_gpt_factory_faithful_handoff_adversarial_proof.py
python scripts/strategy_factory_faithful_compile_handoff.py \
  --video-id 75DJN5UVQnw \
  --strategy-index 0 \
  --out-dir tmp/factory-faithful-handoff-negative
```

The known current row must refuse with `FACTORY_DISPOSITION_NOT_COMPILE_READY`.

High-value independent attacks:

- stale projection after receipt creation;
- stale certificate after receipt creation;
- copied receipt paired to another spec;
- spec byte mutation after receipt creation;
- multi-strategy identity without crosswalk;
- `UNBOUND_LEGACY` cert;
- nonzero approximation metrics;
- TypeScript verifier->read mutation attempt;
- attempt to present generic `onboard-compiled-specs.ts` as Factory authority.

The grader must also challenge the conservative `zero approximation` requirement against current governing authority. If a bounded approximation class is authorized while still source-faithful, report the authority conflict; do not silently weaken the gate.

---

## 6. CONTEXT OBSERVER

No strategy-semantic change is needed to attach Context Observer telemetry later.

The existing read-only seam is:

```text
src/engine/context/source_entry_events.py
```

Telemetry may piggyback on source-owned entry events/results without altering source entry, stop, target, timing or exit decisions unless separately authorized.

---

## 7. NO SELF-CERTIFICATION / NO MASS RERUN / NO PAPER SHORTCUT

GPT has not executed repository scripts through a shell and makes no test-green claim from source inspection alone.

Worker 1 / independent grader must now produce the executable evidence.

Still prohibited:

- no unnecessary 42-unit Opus semantic rerun;
- no guessed multi-strategy identity;
- no synthetic first survivor;
- no broad backtesting before a real faithful survivor;
- no PAPER/live authorization from this ruling.

---

# FINAL RULING

**GPT HAS EXECUTED ITS LEAPFROG ENGINEERING LANE. THE AR-1354 TASK-AUTHORITY FAIL-OPEN NOW HAS A CONCRETE FAIL-CLOSED PRODUCTION REPAIR PLUS EXPANDED ADVERSARIAL CONTROLS ON `external-advisor/gpt-engineering` AT HANDOFF SHA `eb1c2959d91039033a5fe1a2cea77d440bbac73f`. A FRESH CLAUDE/ACCURACY-VALIDATOR MUST NOW ATTACK THAT EXACT WORK; IF THE NARROW TASK-AUTHORITY BUNDLE IS GREEN AND NO RETROACTIVE CERTIFICATION DEFECT IS FOUND, STEP 12 MAY CLOSE AND THE STRATEGY FACTORY MAY RESUME. GPT ALSO BUILT THE NEXT FACTORY->FAITHFUL-COMPILE->SOURCE_FAITHFUL HANDOFF AHEAD OF THE FACTORY, BUT THAT IS NEXT-STAGE PREPARATION, NOT A NEW STEP-12 BLOCKER. CURRENT REAL BACKTEST SURVIVOR COUNT REMAINS ZERO, AND THAT MUST REMAIN TRUE UNTIL A REAL SOURCE STRATEGY EARNS ITS WAY THROUGH THE FACTORY.**
