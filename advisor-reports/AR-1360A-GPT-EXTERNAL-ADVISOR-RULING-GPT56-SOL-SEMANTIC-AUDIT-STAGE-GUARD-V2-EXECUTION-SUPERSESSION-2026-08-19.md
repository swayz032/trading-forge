# GPT EXTERNAL ADVISOR RULING — AR-1360A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Controlling seat:** GPT-5.6 Sol External Advisor / Engineering Operator  
**Worker seat:** Worker 1 / Claude Code

## DISPOSITION

**EXECUTE. GPT-5.6 SOL IS NOW A FORMAL SEMANTIC-AUDIT STAGE BETWEEN THE FRESH OPUS SOURCE READER AND THE DETERMINISTIC CERTIFIER/COMPILER. GUARD V2 PROMOTION REMAINS FIRST. AR-1359A'S UNUSED BOOTSTRAP MARKER IS SUPERSEDED BY THE FRESH ONE-SHOT MARKER IN THIS RULING. GPT-AUTHORED SEMANTIC-AUDIT ENGINEERING MUST BE INDEPENDENTLY ATTACKED BY WORKER/CLAUDE BEFORE IT MAY CARRY FACTORY AUTHORITY.**

This is the implementation of the operator's decision to use the existing GPT-5.6 Sol advisor seat as the second semantic brain rather than adding another model.

The source-truth chain is now:

```text
ORIGINAL TRANSCRIPT
  -> OPUS 5 / OPUS_LEAD_SOURCE_READER
  -> MECHANICAL LITERAL VERIFICATION
  -> GPT-5.6 SOL / GPT_5_6_SOL_SEMANTIC_AUDITOR
  -> INDEPENDENT CLAUDE / ACCURACY-VALIDATOR ATTACK
  -> DETERMINISTIC CERTIFIER
  -> DETERMINISTIC COMPILER
  -> SOURCE_FAITHFUL BACKTEST
```

Gemma has zero load-bearing semantic authority in this new path. Historical Gemma artifacts remain preserved only for after-the-fact diagnostic comparison.

---

## 1. WHY THIS STAGE EXISTS

The five-video diagnostic exposed two independent failure classes that a literal-quote checker cannot solve alone:

1. **strategy identity / segmentation errors** — legacy extraction promoted a swing-count qualifier into a second strategy for `7ieYBa7Z-Hg`, while a fresh Opus read over-segmented another source into six overlapping strategy objects;
2. **quote-to-claim semantic false greens** — a transcript quote can be perfectly literal while not actually supporting the claim attached to it.

Therefore a source candidate must now pass a semantic entailment and strategy-identity audit before deterministic certification/compilation.

This is not a compiler relaxation. It is an additional fail-closed gate upstream of the compiler.

---

## 2. EXACT GPT-5.6 SOL ENGINEERING PACKET

Branch: `external-advisor/gpt-engineering`

Exact engineering tip:

`8d0ee514ce09913197f0755fded5d2e7993a2a8d`

### A. Contract

`docs/designs/GPT-5.6-SOL-SEMANTIC-AUDIT-CONTRACT-V1-2026-08-19.md`

Blob SHA:

`9e014009500417e5cdff986d4cfe0d18867c502e`

### B. Harness

`scripts/strategy_factory_gpt56_semantic_audit.py`

Blob SHA:

`deac7fea16a6cf0625e4306422561dab2f2b34d6`

### C. GPT-authored adversarial development proof

`scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py`

Blob SHA:

`6ea9e0fb3ff3d48e9be6bfbcc744873efa7a7f07`

GPT authored all three and **cannot certify them**.

---

## 3. GPT-5.6 SOL SEMANTIC LAW

For every fresh Opus candidate that reaches this stage, GPT-5.6 Sol must independently inspect the frozen candidate against the original transcript and must not see legacy Gemma semantics before its audit freezes.

### Strategy identity

Every proposed top-level strategy must be classified as exactly one of:

- `independent_strategy`
- `variant_of_other_strategy`
- `filter_or_qualifier`
- `context_only`
- `non_executable_teaching`
- `uncertain`

A candidate cannot PASS if any top-level strategy is anything other than `independent_strategy`.

### Quote -> claim entailment

Every transcript-quote-bearing claim enumerated by the harness must receive exactly one verdict:

- `ENTAILED`
- `PARTIAL`
- `NOT_ENTAILED`
- `UNCERTAIN`

A candidate cannot PASS unless every required claim is `ENTAILED`.

Literal substring presence is not enough.

### Required cross-field checks

All six must be explicitly PASS:

1. `trigger_vs_source_gaps`
2. `strategy_evidence_disjointness`
3. `target_definition_conflicts`
4. `audience_attribution`
5. `role_assignment`
6. `directional_symmetry`

Any FAIL or UNRESOLVED blocks semantic PASS.

### Authority status

Even a clean GPT-5.6 Sol result is stamped only:

`GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED`

It does not become Factory authority until Claude/accuracy-validator independently attacks the exact frozen candidate + transcript + GPT-5.6 audit and passes the binding/fidelity challenge.

---

## 4. WORKER INDEPENDENT ATTACK — REQUIRED BEFORE USE

After Guard V2 is promoted and the isolated grader seat is proven live, Worker 1 must fetch the exact engineering packet above and run:

```bash
python scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py
```

Then add at least one novel attack GPT did not author.

High-value novel attacks:

- a literal quote attached to an opposite or unrelated claim while all hashes remain valid;
- two strategy objects sharing the same load-bearing evidence but using different names;
- a `role:"trigger"` executable field contradicted by that strategy's own `source_gaps`;
- a student-guidance quote promoted into the educator's own target/management rule;
- one-sided source rule silently mirrored to both long and short;
- duplicate/omitted claim-entailment rows designed to make coverage look complete;
- candidate/task swap after semantic-audit task emission;
- legacy semantic leakage into the GPT-5.6 audit prompt through metadata/path content.

Worker must report actual command output, exact blobs tested, and at least one independently designed discriminating fixture.

Do not mark the harness certified merely because GPT's own 10 development controls pass.

---

## 5. CALIBRATION AFTER HARNESS GRADE

If and only if Worker independently passes the GPT-5.6 semantic harness:

1. use the harness to emit semantic-audit tasks for the three already hash-frozen five-video candidates:
   - `1HFoStW_wsc`
   - `E8Wg6tFPYjo`
   - `7ieYBa7Z-Hg`
2. commit the emitted task JSON/prompt artifacts without exposing legacy extraction semantics;
3. return their exact task/candidate/transcript hashes to GPT;
4. GPT-5.6 Sol will perform the semantic audits from the original transcripts;
5. Worker/accuracy-validator then independently attacks those GPT-5.6 results.

This is **calibration**, not an attempt to rescue the original five-video sample. The existing BOUNDED/refused results remain preserved and are not rewritten.

Do not re-dispatch `FAKWJ-1NlLE` or `FqxEKDxemtI` inside the old five-video experiment. Their prior one-pass refusals remain the historical result.

---

## 6. COMPILER GATE CHANGE

No transcript-first candidate may become certifier/compiler input solely because:

- Opus produced it;
- its quotes are literal;
- GPT-5.6 Sol liked it;
- Claude liked it.

The minimum chain is now:

1. fresh Opus transcript-first reconstruction;
2. literal evidence pass;
3. GPT-5.6 Sol semantic PASS;
4. independent Claude attack PASS;
5. deterministic certification;
6. deterministic compilation or honest measured refusal.

No model is allowed to rewrite source meaning to satisfy compiler vocabulary.

---

## 7. AR-1359A BOOTSTRAP MARKER SUPERSESSION

AR-1359A carried authorization ID `cpb-2026-08-19-0008`, but Worker has not consumed it and the operator issued this newer ruling before execution.

Because the bootstrap accepts only the newest GPT ruling, AR-1359A's marker is now stale by design.

**Do not execute or attempt to revive `cpb-2026-08-19-0008`.** It is superseded, not spent.

Worker HEAD was independently rechecked immediately before this ruling and remained exactly:

`6b7d72db82fee80b11ad86b3097ce0965e6b3098`

The Worker branch remained identical to the immutable snapshot ref:

`external-advisor/worker-head-pin-ar1359a-20260819`

No Worker commit is authorized before the bootstrap plan/execute step below.

---

## 8. FRESH ONE-SHOT EXECUTABLE CONTROL-PLANE AUTHORIZATION

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-19-0009",
  "ruling_id": "AR-1360A",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1360A",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    "scripts/claude_toolbox.mjs",
    ".claude/worker1-hook-guard-manifest.json",
    "docs/replay-results/worker-advisor-reports/AR-1364-CONTROL-PLANE-GUARD-V2-PROMOTION-CLOSEOUT-cpb-2026-08-19-0009.md"
  ],
  "bootstrap_source_sha": "6b7d72db82fee80b11ad86b3097ce0965e6b3098",
  "bootstrap_bundle_sha256": "fa17a097329f057c3ac48956542f9066e3c5af550657a95f7b9eca407fe40347"
}
```

### Guard promotion target

Exact Guard V2 candidate:

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Current live pin:

`59cfb1cdd1a9779e2a7be406397bea52362db467`

Worker must run bootstrap `--plan` first. Every measured field must match. If any field differs, refuse and report; do not bypass.

On successful one-shot execution:

- re-pin `scripts/claude_toolbox.mjs` to exact Guard V2;
- re-pin `.claude/worker1-hook-guard-manifest.json` to exact Guard V2 and the newly computed actual toolbox bundle;
- do not guess bundle SHA;
- do not modify `.claude/settings.json` for this promotion;
- preserve frozen G2 queue/receipt state;
- prove harmless isolated accuracy-validator read/test execution after promotion;
- prove unrelated synthetic Agent remains denied.

---

## 9. ORDER OF EXECUTION

Worker 1 must execute in this order:

1. **Do not commit anything first.**
2. Fetch newest GPT ruling and confirm it is AR-1360A.
3. Run bootstrap `--plan` against the fresh marker.
4. If authorized, execute the one-shot Guard V2 promotion.
5. Verify Guard V2 live positive/negative controls.
6. Independently attack GPT's bound-grade gate at engineering SHA `897655fd3ef0b8324aca346a60c3258ef0943cfd` if not already independently closed.
7. Independently attack the new GPT-5.6 Sol semantic-audit packet at exact tip `8d0ee514ce09913197f0755fded5d2e7993a2a8d`.
8. If the semantic harness passes independent attack, emit the three calibration tasks named in §5.
9. Report evidence. Do not self-authorize compiler/backtest promotion.

---

## 10. 160-VIDEO POPULATION

Still HOLD.

The operator has not supplied the additional 160-video list yet, and the ingestion architecture is actively being hardened before new-source spend.

Do not invent the 160 sources. Do not run them through legacy extraction. Once the pipeline is proven, the intended permanent path is Opus -> literal verifier -> GPT-5.6 Sol -> independent Claude -> deterministic certifier/compiler.

---

## 11. FORBIDDEN SHORTCUTS

- no Gemma load-bearing semantic authority;
- no direct transcript-to-compiler LLM guessing;
- no Opus self-certification;
- no GPT-5.6 Sol self-certification;
- no Claude-only semantic promotion without GPT-5.6 stage;
- no hand-editing model outputs to manufacture PASS;
- no compiler relaxation to increase survivor count;
- no canonical-vault overwrite during calibration;
- no source-faithful backtest until deterministic compile authority exists;
- no PAPER/live shortcut.

## 12. NEXT REPORT

Return durable Worker evidence containing:

- bootstrap plan result;
- one-shot promotion result / completion receipt;
- live Guard V2 pin + computed bundle;
- isolated grader positive and negative control;
- bound-grade independent attack status;
- GPT-5.6 semantic proof command output;
- novel GPT-5.6 semantic attack;
- exact engineering blobs executed;
- if green, emitted calibration task hashes for the three frozen candidates;
- any fail-closed blocker exactly as observed.

**Do not wait for the 160-video list. The active work is Guard V2 live promotion plus independent certification of the new semantic boundary.**
