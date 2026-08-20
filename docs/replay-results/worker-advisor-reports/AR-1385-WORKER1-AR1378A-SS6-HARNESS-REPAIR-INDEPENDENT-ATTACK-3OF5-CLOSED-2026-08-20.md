# AR-1385 -- AR-1378A §6 semantic-harness prompt repair, independent attack, 3/5 findings closed same round

RULING : AR-1378A @ 47aeefa916d34c08e8a9c76d6d7f488e2e4fb71f (origin/external-advisor/gpt-rulings), §6 "SEMANTIC AUDITOR PROMPT REPAIR" -- authorized "one bounded semantic-harness prompt repair" to bind role_assignment and its sibling cross-field checks to the reader's own frozen authoring law, after AR-1378A struck two false GPT HIGH findings that rested on an undefined taxonomy.

PIN    : branch claude/worker1-h1-20260815, repair commit 2a60eee740957dd263923b13292770b0023be1bc, grader-response commit 0cfb3bd9, HEAD after both @ 59043cfe (includes two intervening SYSTEM-INVENTORY regen commits, non-load-bearing). Graded blob at grade time: scripts/strategy_factory_gpt56_semantic_audit.py = 00fb20f6691bd7b981d6b94a005046a77c49ed71.

CHANGED: scripts/strategy_factory_gpt56_semantic_audit.py (new tracked file -- prior harness only existed as a frozen detached-worktree pin at 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b, C:\Users\tonio\Projects\wt-lanetest-repair-8acb6b0f); scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py (original 10-case AR-1377 suite, carried forward byte-identical test logic as a regression control); scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1378a_repair_proof.py (new: RED/GREEN prompt-content proof + 4 SS6-required fixtures); scripts/_gpt_strategy_factory_gpt56_semantic_audit_grader_response_proof.py (new: proof for the 3 grader findings closed same-round).

RED    : `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1378a_repair_proof.py` against the OLD harness pin (8acb6b0f) -- rendered prompt for a synthetic candidate contains 0/8 AR-1378A §6 contract markers. This is the exact defect the ruling names: "the accepted GPT semantic prompt merely listed role_assignment as a check name and never supplied this contract."

REPAIR : Added `ROLE_ASSIGNMENT_CONTRACT`, the 8-point law from AR-1378A §6, bound into every rendered `render_prompt()` output. No change to TASK_SCHEMA/RESPONSE_SCHEMA/RECEIPT_SCHEMA, `enumerate_claims()`, or `_validate_response()` -- prompt-text-only, exactly as §6 scopes it. Then dispatched the independent grader (see GRADER below), which returned a bounded PASS with 5 findings; closed the 3 that stay inside the prompt-only scope-lock in the same round (F-2, F-3, novel-attack A1), plus the non-schema half of F-4.

GREEN  : same probe against the repaired harness -- 8/8 markers present. All three proof suites exit 0: `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py` (10/10 original AR-1377 cases, byte-identical test logic, unmodified by the repair), `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1378a_repair_proof.py` (RED/GREEN + 4 SS6 fixtures), `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_grader_response_proof.py` (F-2/F-3/A1/F-4-narrowing).

CONTROL: AST structural diff (comment/whitespace-blind) between the old and new harness confirms all 29 non-`render_prompt` named units are identical -- the change is provably scope-locked. Blank-contract positive control (grader-authored): loading the repaired module with `ROLE_ASSIGNMENT_CONTRACT` emptied reproduces the old harness's behavior on 2 of the grader's 3 mechanical assertions, isolating exactly which properties are contract-dependent vs schema-dependent.

GRADER : dispatched (accuracy-validator, DISPROVE mandate, pinned at commit 2a60eee7/804adb74). FULL VERDICT PRESERVED BELOW, VERBATIM.

<details>
<summary>FULL accuracy-validator report (verbatim)</summary>

# INDEPENDENT ADVERSARIAL GRADE -- AR-1378A §6 SEMANTIC-HARNESS PROMPT REPAIR

## GRADE TARGET

| Field | Value |
|---|---|
| Repo | C:\Users\tonio\Projects\wt-claude-worker1-20260815 (linked worktree; git rev-parse --git-common-dir = C:/Users/tonio/Projects/trading-forge/trading-forge/.git) |
| Branch | claude/worker1-h1-20260815 |
| HEAD at grade start | 804adb745622a596d5b01134eae848eaf88bf224 |
| HEAD re-derived at grade end | 804adb745622a596d5b01134eae848eaf88bf224 (unmoved; working tree clean) |
| Repair commit | 2a60eee740957dd263923b13292770b0023be1bc |
| Graded blob (join key) | scripts/strategy_factory_gpt56_semantic_audit.py = 00fb20f6691bd7b981d6b94a005046a77c49ed71, sha256 b50dad6521f28b52e57c057e27881cd1bb2cefb59c58c3bf48769e8c498b3edb |
| Old/defective pin | 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b, blob a76e258cfe526c305e6b318d456189843df6fc9a, sha256 b597d2cb...adba6 |
| Ruling | 47aeefa916d34c08e8a9c76d6d7f488e2e4fb71f on origin/external-advisor/gpt-rulings |
| Doer | Worker-1. Grader: independent, no lineage. |

MEASURED HERE: the graded blob is byte-identical at 2a60eee7 and at HEAD 804adb74. 804adb74 touches only docs/designs/SYSTEM-INVENTORY.md (+45/-42). The worker's characterization of 804adb74 as non-load-bearing is corroborated.

## EXECUTION EVIDENCE

1. Old-harness pin verified through two non-overlapping paths (git object DB vs. frozen-worktree filesystem): `git cat-file blob 8acb6b0f:scripts/strategy_factory_gpt56_semantic_audit.py | sha256sum` -> b597d2cb7fbb7c475a68c760c5f249ce461baead23a4257323790a9c889adba6; sha256sum on the frozen worktree file -> IDENTICAL. Frozen worktree confirmed detached HEAD 8acb6b0f, clean, same --git-common-dir.

2. Commit shape (a fact the worker's own account did not state): `git show 2a60eee7 --numstat` shows all three files as pure additions (1248 insertions, 0 deletions); `git cat-file -e 620f1d6a:scripts/strategy_factory_gpt56_semantic_audit.py` is ABSENT in the parent commit. The harness never existed on this branch before. "Unchanged from the prior harness" is therefore only checkable cross-tree against 8acb6b0f, not via git diff on this branch's own history -- narrower evidence base than a normal same-branch modification, though not a defect.

3. Textual diff (path A), old -> new: git diff --no-index -> 58 insertions, 1 deletion, exactly 3 hunks: module docstring addendum; the new ROLE_ASSIGNMENT_CONTRACT constant; and inside render_prompt() an inserted {ROLE_ASSIGNMENT_CONTRACT} plus one reworded line. No whitespace/formatting drift elsewhere.

4. AST structural diff (path B, comment/blank-line/line-number-blind): top-level units old=39 new=40; only positions 0 (module docstring) and 31 (render_prompt) differ; all 29 other named units (TASK_SCHEMA, RESPONSE_SCHEMA, RECEIPT_SCHEMA, REQUIRED_CROSS_CHECKS, enumerate_claims, _validate_response, build_task, ingest, emit, strategy_ids, _literal_or_null, IDENTITY_CLASSES, ENTAILMENT, CHECK_STATUS, PASS_STATUS, FAIL_STATUS, AUDITOR_ROLE, MODEL_IDENTITY, and every helper) are IDENTICAL. (Grader's first run flagged two false positives from its own line-number-based labelling of the __main__ guard; disproved by direct AST-dump comparison and reported as a self-correction.)

5. Original AR-1377 proof suite -- is it a weakened copy? git diff --no-index shows one hunk: a 5-line docstring addendum only. Test logic byte-identical. Grader flagged that the access recipe's phrase "byte-identical" for the whole file was imprecise (316 vs 311 lines) -- the docstring differs, the test logic does not; caption corrected here.

6. Both suites run independently by the grader, exit 0: 10/10 original cases; AR-1378A repair proof RED=0/8 markers old, GREEN=8/8 markers new.

7. Point-by-point entailment, ruling §6 vs ROLE_ASSIGNMENT_CONTRACT (word-for-word): points 1, 2, 3, 4, 7, 8 ENTAILED (several strengthened); point 5 ENTAILED but unconditionally extended beyond the ruling's own conditioning (-> F-3); point 6 PARTIAL, a load-bearing anti-invention clause dropped (-> F-2).

## ATTACKS TRIED THAT DID NOT BREAK IT

Scope breach hidden in whitespace/comments: none (two independent paths). Weakened AR-1377 suite: no. Silent mutation of _validate_response/enumerate_claims/schemas: none (AST-identical). Frozen-worktree tampering: none (object DB and filesystem agree). Rigged RED probe: no, the proof raises if the old pin already contains any marker. Nested-container escape inside variants[]/stop: covered by rule 2 as written (still inside a named forbidden container). Rule 1 read as blanket exemption: explicitly blocked by the contract's closing paragraph. Coverage/literal-quote/PASS-FAIL-consistency regressions: none.

## FINDINGS

### F-1 (CRITICAL): the prompt repair is invisible to every artifact the harness emits
task_sha256 is computed over task_core, which has no prompt/contract field; render_prompt() runs afterward and is never hashed into the task or the receipt. MEASURED with audit_nonce held constant: task_sha256 identical under the OLD and NEW harness for the same candidate (52740ac7...212e3 both), even though prompt length differs 4570 vs 7574 chars. A round-3 receipt is therefore cryptographically indistinguishable from a round-2 receipt produced under the defective prompt. Fix point: scripts/strategy_factory_gpt56_semantic_audit.py build_task() -- add a contract/prompt hash into task_core before task_sha256 is computed. Scope note: this is a TASK_SCHEMA change and exceeds SS6's prompt-only authorization -- flagged for a new GPT ruling, not built here.

### F-2 (MEDIUM, CLOSED THIS ROUND): ruling point 6's anti-invention clause was dropped
Ruling verbatim: "never permission to invent." Repair's first draft carried only "never itself a fabrication finding," a different (auditor-facing, not candidate-facing) proposition. Fixed: rule 6 now reads "...is never itself a fabrication finding -- but it is never permission to invent the missing rule either. An honestly disclosed gap must stay disclosed as a gap, not be silently resolved by the candidate and then credited as if it were still honest." Proven by scripts/_gpt_strategy_factory_gpt56_semantic_audit_grader_response_proof.py (F-2 case).

### F-3 (LOW, CLOSED THIS ROUND): rule 5's completeness exemption was unconditional where the ruling conditioned it
Fixed: appended "UNLESS such a stronger written authority exists, in which case it governs instead." Proven by the grader-response proof (F-3 case).

### F-4 (MEDIUM, PARTIALLY CLOSED): 3 of 6 REQUIRED_CROSS_CHECKS remain ungoverned, and the repair's own wording newly claimed all six are contract-graded
Non-schema half CLOSED this round: the CROSS-FIELD CHECKS section now names exactly which three checks (role_assignment, trigger_vs_source_gaps, directional_symmetry) are contract-governed, and instructs ordinary semantic-consistency grading (no invented taxonomy, no skip) for the other three (strategy_evidence_disjointness, target_definition_conflicts, audience_attribution). Proven by the grader-response proof (F-4 case). Schema half (a response-schema field letting the auditor cite which contract point it applied) NOT built -- exceeds SS6 authorization, flagged for a new ruling.

### F-5 (MEDIUM, NOT FIXED -- ruling-spec defect, not implementation defect): the SS6 "negative fixture: must be caught" tests have no discriminating power beyond a substring check
Grader's blank-contract positive control showed 2 of 3 mechanical properties the SS6 fixtures claim to test were already true under the OLD defective harness -- the fixtures round-trip hand-authored "compliant" responses through schema validation; they do not and cannot exercise GPT-5.6's actual judgment without a live API call. Grader's assessment: "SS6's 'must be caught' bullets are not satisfiable at all without a live model call -- that is a defect in the ruling's test spec." Reported to GPT below, not silently reframed as met.

## NOVEL ATTACK (grader's own, not copied from worker fixtures)

A1 (MEDIUM, CLOSED THIS ROUND): built a candidate with non-executable material parked in an invented container name (strategies[0].management_notes[]) -- neither setup[] nor one of the five originally-named forbidden containers. Confirmed it surfaced as a mandatory claim row (cannot be silently skipped) but escaped rule 2's closed list (no role law applied). Fixed: rule 2 rewritten as default-deny -- "setup[] is the ONLY legal home... this is NOT a closed list: the same material is a role_assignment violation in ANY container other than setup[], named here or not, including an invented or non-standard container name." Proven by the grader-response proof (A1 case: management_notes[0] surfaces as a mandatory claim AND the default-deny language now names it).

Also raised, unmeasured (HYPOTHESIS): the contract carries ~5 anti-false-positive instructions against 1 anti-false-negative instruction -- intentional given the repair's motivation (2 false HIGHs), but on a fail-closed money-path gate this could shift the error mode toward false PASS, the more expensive direction. Flagged as a residual risk to watch on the first real round-3 dispatch, not a finding (no measurement possible without a live model call).

Also checked: is the response's `reason` field sufficient to evidence contract engagement? MEASURED: `reason` is read nowhere in `_validate_response()` (only appears in the prompt's example JSON) and never reaches the receipt. Inert. Confirms F-1's severity -- no artifact anywhere in the pipeline proves the contract was applied, only that a schema-valid response was returned.

## PASS -- independently corroborated
All 8 SS6 contract points present; contract bound into every rendered prompt (single interpolation site + 8/8 markers across 6 self-built candidates); scope-locked to render_prompt() + the new constant (two independent diff paths); TASK/RESPONSE/RECEIPT_SCHEMA and validation logic unchanged (AST-identical, 29/29 units); no regression in coverage/literal-quote/PASS-FAIL invariants (10/10 rerun + independent blank-contract control); RED/GREEN genuine, not rigged; 804adb74 non-load-bearing.

## LIMITATIONS
No live GPT-5.6 call was made -- every claim about actual auditor behavior (including the leniency-asymmetry concern and F-4's default-to-PASS risk) is HYPOTHESIS, and SS6's own test spec cannot close this gap either (F-5). Did not re-verify the 3 round-2 receipts against the new harness (correctly out of scope per the ruling). Did not audit whether AR-1378A's 8 points are themselves correct. Did not verify whether a candidate-shape validator exists upstream of this harness (would lower A1's severity if so) -- unenumerated beyond scripts/. Did not run repo CI gates (system-map:check etc.) -- unenumerated. Did not sweep the repo import-closure for other callers of render_prompt() -- the "every rendered prompt" claim is verified only within this file.

## VERDICT
Band 6, BOUNDED PASS. "Scope-locked to prompt text; schemas/enumeration/validation byte-identical" and "no mechanical invariant regressed" are FULLY SUSTAINED through two non-overlapping verification paths each. "Correctly and completely binds all 8 points" is SUSTAINED WITH TWO NAMED EXCEPTIONS (points 5 and 6 carried meaning drift, both closed this round). Band capped at 6 rather than 7-8 because the repair's only testable property before this round was "a substring is present in a string" -- the actual repaired behavior (auditor judgment) has zero live measurement by construction, and two green suites that would stay green with the contract deleted are the textbook false-confidence shape. Two findings (F-1, and the schema half of F-4) are not shippable without a new GPT ruling; three (F-2, F-3, A1) closed same round.

</details>

FINDINGS: F-2, F-3, A1, and F-4's non-schema half CLOSED same round (proofs above). F-1 (CRITICAL -- no receipt can prove which prompt version graded it) and F-4's schema half (no field lets the auditor cite which contract point it applied) are REAL and NOT fixed -- both require a TASK_SCHEMA/RESPONSE_SCHEMA change that exceeds AR-1378A §6's prompt-only authorization. F-5 (the SS6 "must be caught" negative-fixture tests cannot be satisfied without a live GPT-5.6 call) is a defect in the ruling's own test specification, not an implementation gap -- surfacing it rather than silently reframing the fixtures as having met an unsatisfiable bar.

STOP   : none. Escalating F-1 and F-4's schema half for a scope decision (§below), not blocked on them -- Lane B (E8 round-3 fresh Opus dispatch) does not depend on either.

NEXT   : Lane B -- dispatch one genuinely fresh isolated Opus reader for E8Wg6tFPYjo per AR-1378A §7 Lane B (file-first durable output, corrected non-executable-in-setup[] reminder, E8's three atomic-binding hazards as rejection constraints only). Lane C -- bounded unresolved-evidence manifests for 7ieYBa7Z-Hg and 1HFoStW_wsc per §7 Lane C. Both self-executing per AR-1378A §7 ("Run the following in parallel where non-conflicting"); continuing in this session per worker-execution §11a (a receipt is not a stop).

## Escalation for GPT: F-1 and F-4's schema half need a scope decision

AR-1378A §6 authorized a prompt-only repair. The independent grader found the repair cannot be verified downstream without a schema change (F-1: no hash of the prompt/contract reaches task_sha256 or the receipt, so a round-3 receipt cannot prove it was graded under the repaired prompt vs. the defective one; F-4 schema half: no field lets the auditor name which contract point it applied, so `reason` is inert and unverifiable). Recommend authorizing a small, additive, backward-compatible schema extension (a `contract_sha256` field in task_core, and an optional `contract_points_applied` field in the response schema) in a follow-up bounded packet -- not built here because it exceeds the current authorization.
