# GPT ENGINEERING EXECUTION HANDOFF — AR-1352A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Branch:** `external-advisor/gpt-engineering`  
**Base Worker-1 replay SHA:** `74a9dbfc29d9b857df60c6aaeec720de8b14d717`  
**GPT engineering HEAD before this report:** `ed823335a819b14496bcb12503a57842aa6ce407`  
**Authority:** GPT external-advisor ruling AR-1352A + Leapfrog Engineering Operating Model V2  
**Certification posture:** **IMPLEMENTED BY GPT, NOT INDEPENDENTLY RATIFIED. GPT MUST NOT SELF-CERTIFY THIS LOAD-BEARING WORK.**

---

## 1. WHAT GPT EXECUTED

GPT took the narrow AR-1354 F-5 task-authority hardening lane and, in parallel, prebuilt the next Blueprint bridge from a future clean Strategy Factory survivor into the already-existing SOURCE_FAITHFUL runtime/backtest path.

The branch is exactly eight commits ahead of Worker-1 base SHA `74a9dbfc...`, with no Worker history rewritten.

### A. Step-12 blocking lane — locator task-authority fail-closed repair

Commits:

- `f846c8c7cf55f5c1853ac113896c3190b3be911f` — initial permanent RED proof for missing task anchors.
- `9b4b67fc4d83a0b290a45cd2b2ec734f95eb1e74` — production `_validate_receipt` hardening.
- `53e0413e11595e5f6a9cb759cad74bc7650cc6d4` — expanded adversarial proof.

Load-bearing production file:

- `scripts/strategy_factory_prep_provenance_inventory.py`

The hardened receipt validator now fails closed unless ALL durable locator-authority joins exist and agree:

1. receipt exists and parses;
2. receipt `video_id` + `strategy_index` match the unit;
3. receipt `raw_response_sha256` exists and matches this unit's raw response;
4. receipt `batch_task_sha256` exists;
5. this unit's `batch_task_index.json` exists and parses;
6. task-index `video_id` + `strategy_index` match the unit;
7. task-index `task_sha256` exists;
8. task-index task SHA equals receipt task SHA;
9. this unit's actual `batch_task.txt` exists;
10. actual task text re-hashes to the same task SHA.

Missing, malformed, or mismatched authority is a refusal. The success message no longer claims a task check that was skipped. Invocation evidence uses the post-AR-1353 semantics (`invocation_declared`, `invocation_attested`) rather than presenting declaration as independent attestation.

Permanent adversarial proof:

- `scripts/_gpt_ar1354_missing_task_anchor_red_proof.py`

It uses real unit `75DJN5UVQnw__s0` copied into temporary directories and attacks:

- missing receipt task SHA;
- missing task index;
- malformed task index;
- missing task-index task SHA;
- task-index identity rewrite;
- missing actual task;
- mutated actual task;
- plus untouched-real-artifact positive control.

**Important:** these scripts are committed but have NOT been executed by GPT through a repository shell, because this connected GitHub lane exposes repository read/write/status operations rather than a shell runner. No green claim is made from code inspection alone.

---

## 2. CURRENT FACTORY ARTIFACT BASELINE TO PRESERVE

The committed pre-repair inventory artifact currently reports:

```text
total units              47
opus_batch                42
none                       5
needs_regeneration         0
```

The independent re-run after the stricter validator MUST regenerate the inventory and prove those counts remain 42/5/0, or name the exact newly-refused units. Do not weaken the validator to preserve the old count.

The current manifest projection reports:

```text
total manifest rows                120
rows projected                     102
rows identity-unresolved            15
rows out-of-scope                    3
OTHER_MEASURED_REFUSAL              93
EXTRACTION_MISSING_REQUIRED_INFO      9
IDENTITY_MATERIALIZATION_UNRESOLVED  15
FAITHFUL_COMPILE_READY_FOR_BACKTEST   0
```

Therefore there is currently **NO REAL STRATEGY AUTHORIZED FOR BACKTESTING**. That is an honest state, not a failure to be papered over.

No 42-unit semantic regeneration is authorized merely because the validator became stricter. Only a measured authority failure after re-run could justify targeted remediation.

---

## 3. GET-AHEAD LANE — FACTORY -> FAITHFUL COMPILE -> SOURCE_FAITHFUL HANDOFF

This work is intentionally separate from the narrow Step-12 blocking repair. A defect here MUST NOT unnecessarily keep Step 12 open after the task-authority repair independently passes. This is next-stage preparation.

### What already existed and is reused

GPT independently traced the production path and found the pieces already exist:

- canonical compile producer: `src/engine/extraction/spec_producer.py::produce_spec_artifact_from_record`;
- operator compile wrapper: `src/engine/extraction/compile_certified_record.py`;
- runtime strategy: `src/engine/spec_condition_compiler.py::SpecConditionStrategy`;
- backtest entrypoint: `src/engine/backtester.py::run_class_backtest`;
- source mode: `SOURCE_FAITHFUL`;
- source-owned entry-event / Context Observer seam: `src/engine/context/source_entry_events.py`;
- generic compiled-spec onboarding: `src/server/services/spec-onboarding-service.ts`.

The existing `SOURCE_FAITHFUL` backtester is the correct runtime. GPT did NOT build a replacement backtester.

### Measured missing bridge

The generic operator compile wrapper could compile a record without loading/passing the Strategy Factory certificate. Generic compiled-spec onboarding likewise validates spec/compiler integrity but is not itself Strategy Factory certification authority.

That separation creates an operator-reachability hole: Factory certification/disposition and generic compile reachability existed as separate systems without one durable admission receipt proving they described the same source unit.

### GPT-built fail-closed bridge

#### Commit `4715e394cd15361b9304029adebf1b88cb4ec056`
File:
- `scripts/strategy_factory_faithful_compile_handoff.py`

A unit is admitted only when:

- current Factory projection says exactly `FAITHFUL_COMPILE_READY_FOR_BACKTEST`;
- no identity-unresolved row remains for the video;
- source strategy identity is unique and matches the requested index;
- locator authority is current `opus_batch`, `needs_regeneration=false`;
- current extraction/transcript bytes match the inventory hashes;
- current automatic path has unambiguous one-strategy identity (otherwise crosswalk required, fail closed);
- certificate strategy index matches;
- `pilot_grade == true`;
- no contradictory failed certificate grade;
- `dry_run == false`;
- `provenance_binding.status == BOUND` — historical `UNBOUND_LEGACY` is refused;
- certificate source-video/transcript provenance matches exact current source;
- canonical `compile_binding_plan` compiles;
- classifier and binding approximation rates are both exactly zero for this faithful handoff.

On success it delegates semantics to the canonical producer, passing the REAL certificate and transcript length, then emits:

- the `.spec.json`;
- a sibling `.factory-handoff.json` receipt binding source hashes, certificate hash/state, manifest identity, spec file hash/spec hash/graph hash, runtime class, `SOURCE_FAITHFUL` mode and backtest entrypoint.

The receipt headline status is `FAITHFUL_COMPILE_READY_FOR_BACKTEST`.

**Authority note for independent review:** the zero-approximation requirement is deliberately conservative. The grader must challenge whether current governing authority permits any approximation under a headline called *faithful*. If authority allows a bounded approximation class without semantic substitution, do not silently relax this gate; report the conflict to GPT for a ruling.

#### Commit `a978aac95933b5b6db3dde3a31fb37bfd10e4763`
File:
- `scripts/_gpt_factory_faithful_handoff_adversarial_proof.py`

Admission attacks include:

- real current refusal blocked;
- projection-only laundering blocked;
- fake clean grade still blocked if unbound;
- source-video identity swap blocked;
- transcript mutation blocked;
- extraction mutation blocked;
- multi-strategy ambiguity blocked;
- retired Gemma locator blocked;
- synthetic internally-consistent future clean metadata positive control.

The positive control does NOT relabel or compile the current refused source unit.

#### Commit `c9ad262e1da0af7fc3ee61a74bcbe29f3b119224`
File:
- `scripts/strategy_factory_verify_handoff.py`

Immediately before onboarding/backtest it re-verifies, rather than trusting receipt existence:

- receipt identity digest;
- exact spec file SHA;
- spec identity/spec hash;
- current extraction hash;
- current transcript hash;
- current certificate hash;
- CURRENT Factory admission predicate (so stale receipts die if projection/inventory changes);
- manifest strategy identity;
- runtime `SpecConditionStrategy` + `SOURCE_FAITHFUL` + `run_class_backtest` contract.

#### Commits `af01e9ea...` then `ed823335a819b14496bcb12503a57842aa6ce407`
File:
- `scripts/onboard-factory-faithful-spec.ts`

Thin receipt-gated bridge:

1. invoke Python handoff verifier;
2. require `VERIFIED_FACTORY_FAITHFUL_HANDOFF` and `SOURCE_FAITHFUL`;
3. re-read the exact spec bytes in TypeScript and re-hash them after verifier return (TOCTOU defense);
4. verify video/spec hash still agree;
5. only then call the existing `onboardSpecArtifact` service;
6. dry-run by default; `--apply` remains explicit.

It intentionally does not duplicate semantic onboarding logic.

---

## 4. EXACT INDEPENDENT VALIDATION ORDER

Fresh Claude / `accuracy-validator` must be doer != GPT author and should attempt to DISPROVE, not ceremonial-pass, the branch.

### BLOCKING STEP-12 BUNDLE

Run from the exact GPT engineering head after fetching it:

```bash
python scripts/_gpt_ar1354_missing_task_anchor_red_proof.py
python scripts/_ar1353_f5_escalated_attack_proof.py
python scripts/strategy_factory_prep_provenance_inventory.py
```

Required result:

```text
GPT task-anchor adversarial proof: GREEN
Worker escalated-attack proof:       GREEN
inventory:                          42 opus_batch / 5 none / 0 needs_regeneration
```

Then independently plant at least one NEW attack GPT did not write. Recommended high-value variants:

- copy receipt + raw + task index + task text from Unit A into Unit B, rewrite only obvious identity fields, and test whether any unbound field remains;
- corrupt task-index JSON after receipt creation;
- replace task text with semantically different same-length bytes;
- remove each required authority anchor one at a time.

If the narrow task-authority repair survives, **Step 12 may close even if the next-stage handoff bundle below finds a defect**, unless that defect proves a retroactive Factory-certification flaw.

### NEXT-STAGE GET-AHEAD BUNDLE

Run:

```bash
python scripts/_gpt_factory_faithful_handoff_adversarial_proof.py
```

Then prove the live current factory refuses a known current row:

```bash
python scripts/strategy_factory_faithful_compile_handoff.py \
  --video-id 75DJN5UVQnw \
  --strategy-index 0 \
  --out-dir tmp/factory-faithful-handoff-negative
```

Expected: nonzero refusal with `FACTORY_DISPOSITION_NOT_COMPILE_READY`. No spec/handoff artifact should be authorized from that current refusal.

Independently attack at least:

- stale projection after receipt creation;
- stale certificate after receipt creation;
- copied receipt paired with another spec;
- spec bytes mutated after receipt creation;
- multi-strategy video with no durable crosswalk;
- `UNBOUND_LEGACY` certificate;
- nonzero approximation metrics;
- TypeScript verifier->read race / altered spec bytes;
- generic onboarding bypass claim: verify the team documents that `onboard-compiled-specs.ts` is generic tooling and does NOT confer Factory authority absent the Factory receipt path.

Run repository-native TypeScript typecheck / the narrow spec-onboarding tests covering the new bridge as appropriate. Do not claim TS green from source inspection.

When a REAL future clean survivor exists, run the Factory compiler and Factory onboarding bridge in **dry-run first**. Do not manufacture a synthetic survivor merely to make the end-to-end path green today.

---

## 5. CONTEXT OBSERVER GET-AHEAD HOOK

The existing source-owned event seam is:

```text
src/engine/context/source_entry_events.py
```

Context Observer telemetry can piggyback on source entry events / backtest outputs without altering strategy decisions, entry gates, stop placement or exit semantics. Any observer integration must remain read-only relative to the source-faithful strategy until separately authorized.

---

## 6. WHAT IS NOT CLAIMED

- GPT does **not** claim the new branch is independently green.
- GPT does **not** claim the committed inventory artifact was regenerated after the stricter validator; the independent run must do that.
- GPT does **not** claim any of the 120 current rows is a backtest survivor.
- GPT does **not** authorize PAPER/live.
- GPT does **not** authorize rerunning all 42 Opus semantic calls.
- GPT does **not** replace the canonical spec producer, onboarding service, runtime strategy or backtester.
- GPT does **not** allow the next-stage handoff preflight to become an artificial Step-12 blocker unless it reveals a retroactive certification defect.

---

# HANDOFF

**Worker 1 / fresh independent grader should now attack the exact GPT engineering head, starting with the narrow Step-12 task-authority repair. If that blocking bundle passes, close Step 12 and resume the Factory. Independently grade the get-ahead Factory->faithful-compile->SOURCE_FAITHFUL bridge as next-stage preparation. Preserve the 42 historical Opus units unless an actual measured authority failure proves a targeted unit must be remediated. Current truthful backtest survivor count remains ZERO.**
