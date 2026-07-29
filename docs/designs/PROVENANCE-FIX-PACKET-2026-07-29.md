# ONE-LINE PROVENANCE FIX — `ratify-packet` (DOCUMENT ONLY, NOT IMPLEMENTED)

**R-436 · 2026-07-29 · read-only · nothing edited · no flag flipped · no backtest.**
**[MEASURED] `backtests total = 0`.**

---

## 1 — WHAT & WHY NOW

**THE CHANGE, exact:** in `src/engine/spec_execution_preflight.py:94`, remove `"spine"` from
`_MANDATORY_ROLES`.

```diff
- _MANDATORY_ROLES = frozenset({"spine", "invalidation"})
+ _MANDATORY_ROLES = frozenset({"invalidation"})
```

`spine` then falls to `classify_rule_role`'s else-arm → **`UNKNOWN_REQUIREDNESS`**.

**WHY.** **[MEASURED, `graph-to-engine.ts:93`, the producer]** `spine` is the else-arm of
`inAndGroup.has(a.id) ? "confluence" : "spine"` — *"this atom is not in an AND-group."* **Nothing in
that expression reads the source.** Recording it as `MANDATORY` makes the preflight assert *"the
source marked this rule required"* about a topology test — **a fabricated provenance claim, which is
the exact defect `UNKNOWN_REQUIREDNESS` was minted to prevent.**

## 2 — WHY IT IS SAFE — VERIFIED HERE, NOT TAKEN ON TRUST

**[MEASURED, deployed lane `wt-preflight-blockers-20260729` @ `83efd34e`, sha256-identical to
`runtime-production` @ `a6f92822`]**
- `spec_execution_preflight.py:149` — `return rule_class in (MANDATORY, UNKNOWN_REQUIREDNESS)`.
  **Both classes block.**
- **Both non-test call sites gate on `blocks_execution`, not on the class name:**
  `spec_execution_preflight.py:262-263` and the compiler's consumer at
  `spec_condition_compiler.py:637`.

★★★ **So the refusal SET cannot move. Only the recorded `rule_class` changes.**

## 3 — RED-PROOF: THE REFUSAL SET IS IDENTICAL, COMPUTED NOT ASSERTED

**Population `POP-120-LIVE` (all 120 rows), same tree, per-condition set comparison. Key =
`(strategy_id, condition_id, arm)`; plan-level empty-spine refusals included as their own key.**

| | |
|---|---:|
| refusals, **current** `_MANDATORY_ROLES = {spine, invalidation}` | **1368** |
| refusals, **proposed** `_MANDATORY_ROLES = {invalidation}` | **1368** |
| set difference `A − B` | **0** |
| set difference `B − A` | **0** |
| ★★★ **symmetric difference** | ★★★ **0** |
| sets identical | **True** |
| strategies refusing, before / after | **120 / 120**, strategy-set identical **True** |

★★★ **NOT ONE CONDITION CHANGES PASS/FAIL. Your stop condition — *"if even ONE condition changes
pass/fail, STOP"* — does not fire.**

**AND THE POINT OF THE CHANGE, the `rule_class` distribution:**

| class | before | after |
|---|---:|---:|
| `MANDATORY` | 1347 | **921** |
| `UNKNOWN_REQUIREDNESS` | 18 | **444** |

★★ **426 conditions stop claiming the source required them and start recording honestly that we
cannot tell.** ★ That is exactly the `spine` unbindable population (429 `spine` refusals minus the 3
plan-level empty-spine rows, which are not role-classified) — **the arithmetic closes, which is a
second check that the simulation moved the intended rows and nothing else.**

★ **METHOD LIMIT, STATED:** the red-proof drives the *membership decision* over the census's real
binding rows; it does not re-execute `preflight_binding_plan` under a patched frozenset. **A
grader should re-run it by actually editing the frozenset in a scratch copy and diffing the real
`PreflightResult` sets — that is the stronger form and I did not do it, because implementing the
change is forbidden to me here.**

## 4 — TEST TO SHIP WITH THE CHANGE

A test pinning **both halves**, so a later "cleanup" cannot collapse the classes again:
`spine` + unbindable → `rule_class == UNKNOWN_REQUIREDNESS` **AND** `blocks_execution(...) is True`
**AND** the condition appears in `PreflightResult.refusals`. ★★ Plus the discriminator: an
`invalidation` + unbindable still records `MANDATORY` and still refuses — **without it the suite
cannot tell "reclassified correctly" from "reclassified everything."**

## 5 — BLAST RADIUS, ROLLBACK, GRADER

**Blast radius:** the recorded `rule_class` string in `PreflightRefusal` payloads and any log or
ledger reading it. **No gate, threshold, frozen ref or certification consumes `rule_class`
[NOT MEASURED — a grep for downstream consumers of the field is a required pre-implementation step].**
**Rollback:** re-add one frozenset member.
**Classification:** not the irreversible/live-capital class — `backtests total = 0`, no live default,
no frozen ref re-baselined.
★★★ **DOER ≠ GRADER: I am the doer on this packet and I do not grade it. The grader must be a
fresh-context agent that re-derives §3 by patching the frozenset and diffing real
`preflight_binding_plan` output, and independently re-reads `:149` and both call sites.**

## 6 — WHAT THIS IS NOT

★★★ **This is NOT a relaxation and does not touch the standing prohibition.** Nothing that refused
before passes after — **measured, symmetric difference 0.** `_OPTIONAL_CANDIDATE_ROLES` and the
`confluence` fail-closed policy are untouched. `TF_SEMANTIC_ROLE_CLASSIFIER` stays off. **No
classifier rule coverage is expanded — that would burn HOLDOUT-26.**
★★ **It is a truth-in-recording fix: the guard keeps doing exactly what it did, and stops claiming a
reason it never had.**
