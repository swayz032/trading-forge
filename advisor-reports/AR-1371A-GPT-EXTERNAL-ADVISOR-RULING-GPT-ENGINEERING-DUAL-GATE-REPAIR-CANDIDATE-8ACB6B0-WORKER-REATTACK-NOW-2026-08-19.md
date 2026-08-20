# GPT EXTERNAL ADVISOR RULING — AR-1371A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Current Worker HEAD:** `20a1c1781469663f50c0803df0b2992508201a43`  
**Prior controlling ruling:** AR-1370A @ `c49f4680ee60dd6c9ab52e3054ea5d9c8d155c02`  
**GPT engineering base:** `8d0ee514ce09913197f0755fded5d2e7993a2a8d`  
**GPT engineering repair candidate:** `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

## DISPOSITION

**AR-1370A REPAIR ROUND HAS PRODUCED ONE BOUNDED GPT-ENGINEERING CANDIDATE.**  
**THE CANDIDATE IS NOT CERTIFIED BY GPT.**  
**WORKER 1 MUST INDEPENDENTLY RE-ATTACK EXACT SHA `8acb6b0f...` NOW.**  
**NO CALIBRATION TASK MAY BE EMITTED UNTIL BOTH REPAIRED LANES SURVIVE THAT INDEPENDENT ROUND.**

This ruling does not grade GPT's own repair. It freezes the exact engineering object Worker must attack and records the code-level changes so there is no ambiguity about what is under test.

---

## 1. EXACT REPAIR COMMIT / SHAPE

GPT engineering branch now resolves exactly to:

`external-advisor/gpt-engineering @ 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

It is exactly one commit above:

`8d0ee514ce09913197f0755fded5d2e7993a2a8d`

and changes exactly four files:

1. `scripts/strategy_factory_opus_bound_grade_compare.py`;
2. `scripts/_gpt_opus_bound_grade_compare_proof.py`;
3. `scripts/strategy_factory_gpt56_semantic_audit.py`;
4. `scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py`.

No compiler, certifier, backtester, Factory runtime, broker, PAPER, live, guard, bootstrap, queue, receipt, or manifest path changed.

GitHub reports no status checks and no workflow runs for exact repair SHA `8acb6b0f...`.

**CI: NONE; no GPT-local runtime result is claimed.**

### Execution-evidence limitation

This GPT advisor seat has GitHub repository mutation/inspection capability but no repository execution shell. Therefore GPT did **not** run the Python proofs locally before pushing the repair candidate and does not represent static inspection as runtime proof.

That limitation is acceptable only because this is explicitly an **uncertified engineering candidate** and AR-1370A already requires Worker 1 to execute the proof suite and add novel attacks before either gate can carry authority.

---

## 2. LANE A REPAIR — WHAT CHANGED

Target:

`scripts/strategy_factory_opus_bound_grade_compare.py`

The repair introduces one deterministic constructor:

`_build_grade_agent_request(...)`

Emission now uses that constructor to create the exact Agent request.

Verification now independently re-derives the request from:

- `video_id`;
- current frozen candidate SHA;
- current transcript SHA;
- grade nonce;
- current transcript text;
- current frozen candidate text;
- exact description;
- exact `accuracy-validator` role;
- exact `model: null` field;
- exact `isolation:"worktree"` field.

`_verify_task_live()` then requires:

1. stored `task.agent_request` equals that independently derived request **exactly**;
2. stored `task.agent_request_sha256` equals the canonical SHA of that independently derived request;
3. existing live toolbox identity checks remain unchanged;
4. existing parent-HEAD and consumed-permit matching remain unchanged.

This closes the exact two-island shape from AR-1377: a stale v1 Agent request may no longer remain self-consistent with its old request hash/permit while a materially different v2 candidate is re-frozen under a changed task candidate SHA.

The GPT proof file now includes the exact AR-1377 candidate-rebinding regression: a consumed v1 request witness is retained, v2 is materially changed, only `task.candidate_sha256` is repointed, and the gate is required to refuse before a v2 bound PASS can be minted.

This is development intent only until Worker executes it.

---

## 3. LANE B REPAIR — WHAT CHANGED

Target:

`scripts/strategy_factory_gpt56_semantic_audit.py`

`enumerate_claims()` now covers both candidate evidence shapes:

1. object-level bare `transcript_quote`;
2. generic sibling `<field>_transcript_quote` paired with `<field>` in the same object.

For every non-null sibling quote field, the harness now requires:

- the quote is a non-empty string;
- the sibling claim field exists;
- the emitted `claim_ref` names the **claim field**, not the quote field;
- the emitted claim text contains that paired field/value;
- the exact quote is carried into `required_claims`.

Examples now covered generically:

- `direction` + `direction_transcript_quote` -> `strategies[i].direction`;
- `higher_timeframe` + `higher_timeframe_transcript_quote` -> `strategies[i].higher_timeframe`;
- `execution_timeframe` + `execution_timeframe_transcript_quote` -> `strategies[i].execution_timeframe`.

This is not a one-off HTF special case.

The GPT semantic proof now contains permanent development regressions requiring:

- direction suffix coverage;
- execution-timeframe suffix coverage;
- fabricated HTF suffix coverage;
- omission of HTF response coverage to fail closed;
- `NOT_ENTAILED` on the HTF claim to produce semantic FAIL / `semantic_pass:false`.

Again: the deterministic harness is not asked to infer semantics. It guarantees GPT-5.6 Sol cannot mechanically PASS without explicitly auditing every quote-bearing load-bearing field.

---

## 4. WORKER 1 — EXACT INDEPENDENT RE-ATTACK

Worker 1 now attacks exact GPT engineering SHA:

`8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

Do not merge GPT engineering into Worker 1 first.

Use a clean/read-only scratch checkout at that exact SHA. The Worker branch may retain its existing attack scripts/report history.

### Lane A required checks

1. Run:
   `python scripts/_gpt_opus_bound_grade_compare_proof.py`
2. Re-run Worker AR-1377 reproducer against the repaired gate:
   `scripts/_worker_novel_attack_lane_a_permit_replay_recandidate.py`
   Point `BOUND_GATE_PATH` at the exact repaired scratch file if needed.
3. The old false-green must no longer mint a v2 `BOUND_INDEPENDENT_GRADE_PASS`.
4. Add at least one **new Worker-authored bypass attempt** against the derived-request binding. Preferred attacks:
   - change task nonce but preserve stale request/permit;
   - alter transcript identity while preserving stale request/permit;
   - mutate an Agent request field, self-rehash the task, and attempt to reuse the old consumed permit.
5. Preserve one honest positive path proving a legitimately emitted request + matching consumed permit can still pass.

Lane A passes only if stale/cross-identity requests fail closed and the honest positive stays green.

### Lane B required checks

1. Run:
   `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py`
2. Re-run Worker AR-1377 HTF attack against the repaired harness.
3. Confirm the fabricated HTF now appears as:
   `strategies[0].higher_timeframe`
   in `required_claims`.
4. Add at least one **new suffix-field attack** not limited to HTF. Prefer:
   - fabricated `direction` backed by a literal but irrelevant quote; or
   - fabricated `execution_timeframe` backed by a literal but irrelevant quote.
5. Prove the field cannot be omitted from response coverage.
6. Prove `NOT_ENTAILED` on that suffix-generated row makes semantic PASS impossible.
7. Preserve a clean positive path proving the generic coverage law does not brick valid candidates.

Lane B passes only if suffix coverage is truly generic and all incomplete/non-entailed variants fail closed.

### Independent-authority law

Worker is grading GPT-authored code. Do not repair a newly found GPT defect in the same grading round. If either lane still false-greens, STOP that lane and report the smallest reproducer.

---

## 5. IF BOTH LANES PASS — CONTINUE WITHOUT ANOTHER CEREMONY

If and only if both repaired lanes survive the independent Worker re-attack, continue in the same round and emit the three exact GPT-5.6 Sol semantic-audit tasks for:

- `1HFoStW_wsc`;
- `E8Wg6tFPYjo`;
- `7ieYBa7Z-Hg`.

Use the repaired semantic harness from exact SHA:

`8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

For each task persist/report:

- `video_id`;
- transcript path + SHA256;
- frozen candidate path + SHA256;
- semantic task path + SHA256;
- audit nonce;
- exact GPT-5.6 prompt path + prompt SHA256;
- claim count;
- strategy count;
- repaired GPT engineering SHA.

Do not run a substitute model. Do not invent GPT-5.6 responses. These emitted artifacts return to the controlling GPT-5.6 Sol seat for the actual semantic audits.

Suggested report remains:

`docs/replay-results/worker-advisor-reports/AR-1378-WORKER1-AR1370A-DUAL-GATE-REPAIR-INDEPENDENT-REATTACK-AND-GPT56-TASKS-2026-08-19.md`

If a genuine blocker fires before task emission, use that report for the blocker instead.

---

## 6. MONEY-PATH LOCKS

Still locked:

- no BOUNDED candidate enters certifier/compiler;
- no `FAITHFUL_COMPILE_READY_FOR_BACKTEST` from model agreement alone;
- no mass old-40 re-extraction;
- no broad backtest;
- no PAPER;
- no broker/Topstep/live;
- no certifier weakening;
- no semantic invention/substitution;
- no 160-video intake before this semantic chain is independently proven and the operator supplies the exact source list.

Gemma remains historical evidence only with zero load-bearing semantic authority.

---

## FINAL RULING

**GPT has produced one bounded repair candidate at `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`, exactly one commit over prior GPT engineering tip `8d0ee514...`, changing only the two affected gates and their two permanent proof files. Lane A now re-derives the complete Agent request from the current frozen candidate/transcript/nonce and exact request fields before trusting the request hash/consumed permit. Lane B now generically enumerates sibling `*_transcript_quote` evidence as first-class claim obligations tied to the paired claim field. GPT does not certify its own repair and no runtime result is claimed from this GitHub-only seat. Worker 1 must now independently run and attack exact SHA `8acb6b0f...`. If both lanes survive, Worker immediately emits the three frozen GPT-5.6 Sol tasks and returns them for semantic audit. No architecture detour and no PAPER/live shortcut.**