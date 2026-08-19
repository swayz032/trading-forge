# GPT-5.6 SOL SEMANTIC AUDIT CONTRACT V1

Date: 2026-08-19
Stage: 3 — Strategy Factory
Status: GPT-authored engineering candidate; NOT independently certified

## 1. PURPOSE

This contract closes two source-understanding defects exposed by the five-video Opus transcript-first diagnostic:

1. **strategy identity / segmentation drift** — a filter, qualifier, regime note, or variant may be promoted into a separate strategy, or one strategy may be over-segmented into several overlapping objects;
2. **literal-quote false greens** — a quote can be an exact transcript substring while still failing to entail the claim attached to it.

The deterministic literal verifier remains necessary but is not sufficient. This stage is inserted after fresh Opus source reconstruction and literal verification, and before any candidate may become certifier/compiler authority.

## 2. MODEL ROLES

- **Original transcript** — ultimate semantic source authority.
- **Opus 5 / OPUS_LEAD_SOURCE_READER** — first-pass transcript-first strategy reconstruction.
- **GPT-5.6 Sol / GPT_5_6_SOL_SEMANTIC_AUDITOR** — independent semantic audit of the frozen Opus candidate against the original transcript.
- **Claude / accuracy-validator** — independently attacks GPT-5.6 Sol's audit and the candidate/audit binding.
- **Deterministic certifier/compiler** — only receives a candidate after the semantic audit and independent challenge are both clean.

Gemma-era artifacts have **zero load-bearing authority** in this stage. Legacy extraction is forbidden input until the fresh candidate and semantic audit are both frozen.

## 3. EXECUTION ORDER

```text
ORIGINAL TRANSCRIPT
        ↓
FRESH OPUS 5 SOURCE READER
        ↓
MECHANICAL LITERAL VERIFIER
        ↓
HASH-FROZEN FRESH CANDIDATE
        ↓
GPT-5.6 SOL SEMANTIC AUDIT
        ↓
CLAUDE / ACCURACY-VALIDATOR ATTACK
        ↓
SEMANTICALLY CERTIFIED SOURCE CANDIDATE
        ↓
DETERMINISTIC CERTIFIER
        ↓
DETERMINISTIC COMPILER
        ↓
SOURCE_FAITHFUL BACKTEST
```

No stage may silently repair an earlier model's output and call it the same run.

## 4. GPT-5.6 SOL REQUIRED CHECKS

### 4.1 Strategy identity

For every top-level proposed strategy, classify it as exactly one of:

- `independent_strategy`
- `variant_of_other_strategy`
- `filter_or_qualifier`
- `context_only`
- `non_executable_teaching`
- `uncertain`

A whole-candidate PASS is impossible unless every top-level strategy is independently supported as `independent_strategy` and the proposed strategy boundaries are evidence-disjoint enough to justify separate executable objects.

A filter such as a swing-count requirement, a time/session qualifier, a regime condition, a confluence, a target note, or an entry variation must not become its own strategy merely because it has a literal quote.

### 4.2 Quote → claim semantic entailment

Every load-bearing transcript-quote-bearing claim must be audited for meaning, not substring presence.

Allowed verdicts:

- `ENTAILED`
- `PARTIAL`
- `NOT_ENTAILED`
- `UNCERTAIN`

A whole-candidate PASS requires `ENTAILED` for every load-bearing claim.

Examples of failure classes:

- quote discusses an indicator location while claim says the indicator is optional;
- quote describes context but claim asserts an entry trigger;
- quote describes what the educator tells students, while claim states it is the educator's own execution rule;
- quote describes one side/direction and the claim silently symmetrizes it;
- quote supports a target observation but the claim promotes it into a mandatory target;
- two individually true quotes are linked together by a relationship the source never states.

### 4.3 Cross-field consistency

GPT-5.6 Sol must explicitly evaluate:

1. `trigger_vs_source_gaps` — a field cannot assert an executable trigger while the same strategy declares the trigger undefined;
2. `strategy_evidence_disjointness` — separate strategies must not simply recycle the same load-bearing evidence unless the source explicitly teaches distinct strategy identities;
3. `target_definition_conflicts` — competing target definitions must be reconciled by source evidence or remain an explicit gap;
4. `audience_attribution` — distinguish educator's own method from examples, student guidance, general education, or hypothetical alternatives;
5. `role_assignment` — context/setup/confluence/management/target/stop/trigger fields must carry the role the source actually gives them;
6. `directional_symmetry` — do not mirror a one-sided rule into both directions unless the source supports that symmetry.

Allowed status per check: `PASS`, `FAIL`, `UNRESOLVED`.

Whole-candidate PASS requires all six checks `PASS`.

## 5. FAIL-CLOSED OUTPUT LAW

GPT-5.6 Sol emits one machine-readable semantic audit bound to:

- `video_id`
- candidate SHA256
- transcript SHA256
- audit task SHA256
- random audit nonce
- model role `GPT_5_6_SOL_SEMANTIC_AUDITOR`
- model identity `GPT-5.6 Sol`
- declaration `legacy_semantics_visible:false`

The audit verdict is `PASS` or `FAIL` only.

A PASS is invalid if:

- any required claim is missing from entailment coverage;
- any claim is `PARTIAL`, `NOT_ENTAILED`, or `UNCERTAIN`;
- any proposed strategy is anything other than `independent_strategy`;
- any required cross-field check is not `PASS`;
- any HIGH/CRITICAL blocking finding remains;
- any source quote cited by the audit is not literal transcript evidence;
- candidate/transcript/task identity changed after task emission;
- legacy semantics were visible before the audit froze.

The machine status after GPT-5.6 Sol PASS is still:

`GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED`

It is **not** Factory authority.

## 6. INDEPENDENT CLAUDE CHALLENGE

Claude/accuracy-validator must attack the exact frozen candidate + transcript + GPT-5.6 Sol audit. At minimum it must try to disprove:

- strategy count and boundaries;
- completeness of entailment coverage;
- one quote attached to the wrong claim;
- hidden context→trigger promotion;
- target/stop relationship invention;
- audience attribution;
- contradiction between executable fields and source gaps;
- candidate/audit hash binding;
- any attempt to expose legacy semantics before the semantic decision froze.

GPT cannot certify its own semantic-audit implementation or its own semantic verdict.

## 7. COMPILER BOUNDARY

The deterministic certifier/compiler may consume a transcript-first candidate only after:

1. Opus reconstruction is hash-frozen;
2. literal evidence verification passes;
3. GPT-5.6 Sol semantic audit passes;
4. independent Claude challenge passes;
5. exact receipts bind all stages.

No model may alter the strategy merely to make the compiler accept it. If the certified source meaning is not representable, the compiler must issue an honest measured refusal.

## 8. LEGACY COMPARISON

Legacy Gemma artifacts may be opened only after the fresh source candidate and semantic audit are frozen. Legacy comparison is diagnostic only and cannot alter the fresh candidate.

## 9. RESEARCH / EDGE BOUNDARY

Semantic PASS means only: "this candidate appears to faithfully encode what the educator taught."

It does NOT mean:

- the strategy is profitable;
- the strategy has statistical edge;
- the strategy is safe for PAPER/live;
- the strategy should be promoted.

Only a faithful compile survivor may proceed to `SOURCE_FAITHFUL` backtesting, where trading edge is measured independently.
