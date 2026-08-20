# AR-1377 — WORKER 1 — AR-1369A Stage-3 GPT-engineering attacks (Lane A + Lane B): BOTH FAILED

**Date:** 2026-08-19
**Worker branch:** `claude/worker1-h1-20260815`
**Pin at start:** `016b172097a123734376987275ab0dabcce7bdbb`
**Ruling followed:** AR-1369A (`283ede6b9468e41cd40f17c218f5cfb76952f54f`, `origin/external-advisor/gpt-rulings`), §§4-6.
**GPT ear:** armed on `origin refs/heads/external-advisor/gpt-rulings` at seating, baseline == this ruling's commit. No move observed during this round.
**Disposition: OPTION A — GENUINE BLOCKER on both lanes. No calibration tasks emitted. No GPT-authored code repaired.**

---

## PIN / SCRATCH CHECKOUT

- Scratch worktree: `C:\Users\tonio\Projects\wt-lanetest-scratch-probe`, detached HEAD `8d0ee514ce09913197f0755fded5d2e7993a2a8d` (== `origin/external-advisor/gpt-engineering` tip, confirmed via `git rev-parse`).
- `897655fd3ef0b8324aca346a60c3258ef0943cfd` confirmed an ancestor of that tip via `git branch -r --contains 897655fd...` → lists `origin/external-advisor/gpt-engineering` (`git merge-base` itself is blocked by this session's guard; used the `--contains` equivalent instead — MEASURED HERE either way).
- Lane-A files confirmed byte-identical between `897655fd...` and `8d0ee514...`:
  `git diff 897655fd3ef0b8324aca346a60c3258ef0943cfd..8d0ee514ce09913197f0755fded5d2e7993a2a8d -- scripts/strategy_factory_opus_bound_grade_compare.py scripts/_gpt_opus_bound_grade_compare_proof.py` → 0 lines.
- No merge of `external-advisor/gpt-engineering` into the worker branch occurred. Scratch worktree was never git-touched beyond its creation and remains at `8d0ee514`.

## BASELINE (GPT'S OWN DEVELOPMENT PROOFS, RERUN HERE)

```
python scripts/_gpt_opus_bound_grade_compare_proof.py
-> ALL GPT BOUND-GRADE DEVELOPMENT PROOFS PASSED
python scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py
-> ALL GPT-5.6 SEMANTIC-AUDIT DEVELOPMENT PROOFS PASSED
```
Both GREEN, MEASURED HERE (independent rerun in the scratch worktree, not carried from the ruling's prose).

---

## LANE A — FALSE GREEN (HIGH/CRITICAL). Gate: `scripts/strategy_factory_opus_bound_grade_compare.py`

**Seam:** `_verify_task_live` (source lines 303-321) verifies, independently:
1. the on-disk candidate receipt's `candidate_sha256` matches `task.candidate_sha256`;
2. the on-disk `agent_request` bytes still hash to `task.agent_request_sha256`.

It never re-derives `_grade_prompt(video_id, task["candidate_sha256"], ...)` and compares it to `agent_request["prompt"]` — so nothing binds *which candidate the permitted prompt actually names* to *which candidate the task now claims was graded*. `_matching_consumed_permits` (lines 257-278) binds 7 fields, none of them candidate-identifying either.

**Novel vs. all 9 fixtures in `_gpt_opus_bound_grade_compare_proof.py`:** every existing negative fixture either (a) breaks a hash equality this attack leaves intact (`agent_request_sha256`, `agent_request` bytes, freeze consistency) or (b) starts from zero consumed permits. This attack finds exactly one genuine consumed permit and never touches `agent_request`.

**Attack:** file `scripts/_worker_novel_attack_lane_a_permit_replay_recandidate.py` (in this worktree; imports the unmodified real gate module from the scratch worktree via `importlib`, calls the real `cmd_emit_grade` / `cmd_ingest_grade` / `_verify_bound_grade` — no reimplementation). Sequence:
1. Real, honest `BOUND_INDEPENDENT_GRADE_PASS` for candidate v1 (`long`, `close above resistance and enter long`) — a genuine consumed permit (`toolu-real-v1`) is minted for the real v1-bound prompt.
2. Attacker re-freezes `fresh_source_candidate.json` / `candidate_receipt.json` to a **materially different** candidate v2 (`short`, invents a "double size on each adverse 1R" martingale rule) — this candidate was never shown to any grader.
3. Attacker edits **exactly one field** of `independent_grade_task.json`: `candidate_sha256` → v2's hash. `agent_request`, `agent_request_sha256`, `parent_head_sha`, `toolbox_pin`, `toolbox_bundle_sha256`, `grade_nonce` are all left byte-identical to the honestly-issued v1 task.
4. Re-runs the real `cmd_ingest_grade` with a truthful-looking PASS grade for v2.

**Command + result (rerun independently by me, not just relayed from the dispatched agent):**
```
python scripts/_worker_novel_attack_lane_a_permit_replay_recandidate.py
EXIT=1
{
  "FALSE_GREEN": true,
  "candidate_actually_graded_by_permitted_prompt": "41bc23f0b5152a94177889f82c1fd91a35f0a16affe0aaffea0b57edef6011a4",
  "candidate_now_certified_by_receipt":            "a2debbd21a6e3bc266f4bc1b41caa99c7d0ffd4c0cb6fc7124d2ce64bc218a00",
  "receipt_status": "BOUND_INDEPENDENT_GRADE_PASS",
  "receipt_verdict": "PASS",
  "v1_direction": "long",
  "v2_direction": "short"
}
LANE A VERDICT: FALSE GREEN -- the gate certified a candidate that no isolated grader was ever permitted to see
```
Root cause confirmed directly against source (`sed -n '303,321p' scripts/strategy_factory_opus_bound_grade_compare.py` in the scratch worktree): the only candidate-identity check is `receipt.get("candidate_sha256") != task.get("candidate_sha256")`, which the attacker satisfies honestly by re-freezing; `agent_request` is verified only against its own hash, never cross-bound to the claimed candidate.

**Smallest reproducer + fix:** see attack script docstring. Fix requires `_verify_task_live` to recompute `_grade_prompt(video_id, task["candidate_sha256"], task["transcript_sha256"], task["grade_nonce"], transcript, candidate_bytes.decode())` and require byte-equality with `task["agent_request"]["prompt"]`.

**Limitations disclosed by the dispatched agent, preserved here:** the synthesized consumed-permit fixture follows GPT's own positive-control shape; the real `claude-hook-runner.mjs`-written permit's exact field set was not independently re-read in this round (does not weaken the finding — the gate's own comparison set is the vulnerability regardless of what extra fields a real permit carries). `_verify_bound_grade` (the `cmd_compare` path) has no live-HEAD check at all, so a longer-lived cross-HEAD replay variant is plausible but was **not separately exercised** — UNPROVEN, flagged as such, not claimed.

---

## LANE B — FALSE GREEN (HIGH). Harness: `scripts/strategy_factory_gpt56_semantic_audit.py`

**Seam:** `enumerate_claims()` (source lines 91-121) only creates a review obligation for a dict node carrying a key literally named `"transcript_quote"` (`q = node.get("transcript_quote")`). The candidate schema also carries sibling-suffix quote fields directly on the strategy object — `direction_transcript_quote`, `higher_timeframe_transcript_quote`, `execution_timeframe_transcript_quote` (present in GPT's own proof fixture; upstream `strategy_factory_opus_transcript_first_diagnostic.py` literal-checks them at lines 334-344). None of those keys is named `transcript_quote`, so none is ever enumerated, entailment-reviewed, or required. `_claim_text_for_dict` (lines 79-89) independently lists `direction` / `higher_timeframe` / `execution_timeframe` among its own "preferred claim-bearing keys" — the harness's own code proves it regards this content as claim-bearing while its enumerator skips it.

**Novel vs. all 10 fixtures in `_gpt_strategy_factory_gpt56_semantic_audit_proof.py`:** every existing case attacks an *enumerated* claim (wrong quote, missing coverage of an enumerated row, invented AUDIT-RESPONSE quote, model spoofing, mutation-after-freeze, the clean positive). This attack's forged quote sits in the frozen CANDIDATE and is never enumerated at all — `_literal_or_null` never inspects it because it never becomes a `claim_ref`.

**Attack:** file `scripts/_worker_novel_attack_lane_b_ht_fabrication.py` (calls the real `G.enumerate_claims`, `G.emit`, `G.ingest`/`_validate_response`, plus upstream `D.validate_candidate` — no reimplementation). Transcript teaches a single-timeframe long-only 5m breakout; the 1h chart is mentioned only as "open on my second monitor." Attack sets `strategy["higher_timeframe"] = "1h"` with `higher_timeframe_transcript_quote` = a **real, literal** substring of the transcript ("the one hour chart open on my second monitor") that does **not** entail a confirmation gate.

**Command + result (rerun independently by me):**
```
python scripts/_worker_novel_attack_lane_b_ht_fabrication.py
EXIT=1
STEP 0  payload survives the upstream literal-quote gate (quote is literal, meaning is not)
STEP 1  clean  claim_refs (3): [...]
STEP 1  attack claim_refs (3): [...]        <- identical; fabricated HTF rule adds ZERO obligations
STEP 2  emitted task required_claims=3; fabricated quote absent from the task the auditor is bound to
RECEIPT: status=GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED
         semantic_pass=true
         fail_closed_reasons=[]
VERDICT: FALSE GREEN -- Lane B FINDING (HIGH).
```
A **maximally honest** auditor response (every enumerated claim genuinely, truthfully `ENTAILED`) still produces `semantic_pass=true` on a candidate carrying a fabricated multi-timeframe entry gate, because the fabricated rule was never on the auditor's review list.

Root cause confirmed directly against source (`sed -n '75,130p' scripts/strategy_factory_gpt56_semantic_audit.py` in the scratch worktree): `enumerate_claims()`'s `walk()` checks only `node.get("transcript_quote")`.

**Fix (not applied — GPT-authored code, no repair authorization this round):** enumerate every `*_transcript_quote`-suffixed key as a first-class `claim_ref`, not only the bare `transcript_quote` key.

**Limitations disclosed by the dispatched agent, preserved here:** a real GPT-5.6 Sol auditor, seeing the full candidate text in its prompt, *might* independently notice and flag the forged field even though the harness supplies zero mechanical obligation to do so — this finding is that the harness provides **no enforced coverage**, not proof that every real audit would miss it. The `directional_symmetry` cross-check is auditor-asserted with a nullable quote and was answered PASS by the honest-response fixture; no enumerated obligation covers HTF fabrication either way. Incidental, unscored: `transcript_contains` (source line 75) is dead code — defined, never called anywhere in the module.

---

## ENVIRONMENT FINDING (disclosed, not scored as a Lane finding)

Both dispatched attack subagents report that this guarded session's file-mutation policy refused **all** writes into the scratch worktree `wt-lanetest-scratch-probe` (Write tool and Bash-redirect writes both refused) — attack scripts therefore live in this worker worktree (`scripts/_worker_novel_attack_lane_{a,b}_*.py`) and reach the real GPT-authored modules in the scratch worktree via `importlib.util.spec_from_file_location` by absolute path. I independently confirmed both scripts call the real, unmodified target functions (not a hand-rolled reimplementation) by reading them in full before rerunning. Nothing in the scratch worktree was created, modified, or git-touched beyond its initial `git worktree add`. Separately: my own attempt to run `git merge-base --is-ancestor` against two pinned SHAs was refused by this session's guard ("branch/worktree/history mutation is blocked") even though it is a read-only query; `git branch -r --contains` was used as an equivalent read path instead and is recorded above. `git worktree add` itself was **not** blocked.

---

## FINDINGS (summary)

| Lane | Target | Verdict | Severity | Reproducer |
|---|---|---|---|---|
| A | `strategy_factory_opus_bound_grade_compare.py` | FALSE GREEN | HIGH/CRITICAL | `scripts/_worker_novel_attack_lane_a_permit_replay_recandidate.py`, rerun EXIT=1, MEASURED HERE |
| B | `strategy_factory_gpt56_semantic_audit.py` | FALSE GREEN | HIGH | `scripts/_worker_novel_attack_lane_b_ht_fabrication.py`, rerun EXIT=1, MEASURED HERE |

Both are genuine, source-confirmed, independently-rerun-by-me defects in GPT-authored load-bearing gates that sit directly in the money-path certification chain (`transcript -> Opus lead reader -> literal verification -> GPT-5.6 Sol semantic audit -> independent Claude attack -> deterministic certifier -> deterministic compiler -> SOURCE_FAITHFUL backtest`). Lane A's defect is the more severe of the two: it lets a certified-PASS receipt attach to a candidate — direction inverted, martingale sizing invented — that literally no isolated grader ever saw.

## STOP CONDITIONS FIRED

- **Lane A §5 verdict law:** "a novel attack produces a real false-green ⇒ STOP Lane A and report exact reproducer. Do not weaken the gate." — FIRED.
- **Lane B §6 verdict law:** "Any HIGH/CRITICAL semantic false-green ⇒ STOP Lane B and report exact candidate/transcript/task reproducer. Do not continue to calibration tasks." — FIRED.
- **§8.A:** "Do not repair load-bearing GPT-authored code in the same grading round unless a later ruling explicitly authorizes a repair." — Honored; no repair attempted.

## WHAT WAS NOT DONE (per the freezes both this ruling and standing doctrine hold)

- The three GPT-5.6 calibration tasks (`1HFoStW_wsc`, `E8Wg6tFPYjo`, `7ieYBa7Z-Hg`) were **not** emitted — §7 is conditioned on both lanes passing; they did not.
- No merge of `external-advisor/gpt-engineering` into the worker branch.
- No repair of GPT-authored code.
- No broad Factory/certifier/compiler/backtest/PAPER/live-execution work.
- No candidate entered the certifier/compiler.

## NEXT (STOP — genuine blocker, per worker-onboarding §4 / worker-execution §11a.3)

This is the reserved case: the next step is genuinely not authorized (Lane A/B both failed; repairing GPT-authored code requires a new ruling). Recommendation to GPT: rule on (1) whether Worker 1 is authorized to author the two named fixes directly, or whether GPT re-authors them on `external-advisor/gpt-engineering` for a fresh worker attack round; (2) whether the Lane-A cross-HEAD `_verify_bound_grade` variant (flagged UNPROVEN above) needs a dedicated follow-up attack before either gate is trusted for the three real calibration tasks.

## PEER HANDSHAKE DEVIATION (disclosed, not silently skipped)

Worker 2 was reported closed for this session by the operator at seating. Per operator instruction, the worker-onboarding §2b peer HELLO/ACK handshake was not performed; `messaging_startup_verified` was not achieved via a validated ACK. Engineering proceeded under direct operator authorization to continue without it. This is a deviation from the standing §2b HARD RULE, disclosed here rather than papered over.
