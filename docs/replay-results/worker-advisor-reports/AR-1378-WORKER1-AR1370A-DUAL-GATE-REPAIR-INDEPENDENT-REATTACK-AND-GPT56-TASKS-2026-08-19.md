# AR-1378 — WORKER 1 — AR-1370A/AR-1371A independent re-attack of the dual-gate repair: BOTH LANES PASS. Three GPT-5.6 calibration tasks emitted.

**Date:** 2026-08-19
**Worker branch:** `claude/worker1-h1-20260815`
**Pin at start:** `20a1c1781469663f50c0803df0b2992508201a43` (AR-1377 + SYSTEM-INVENTORY regen)
**Rulings followed:** AR-1370A (`c49f4680ee60dd6c9ab52e3054ea5d9c8d155c02`), AR-1371A (`0c2d24fa4d5d94f8bdc4beb4916e8372905a0b47`), both on `origin/external-advisor/gpt-rulings`.
**GPT-engineering repair candidate under attack:** `external-advisor/gpt-engineering @ 8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b` (exactly one commit over prior tip `8d0ee514...`, exactly the 4 authorized files changed — confirmed via `git show --stat`).
**GPT ear (rulings branch):** live, no blind window; picked up AR-1370A and AR-1371A as they landed mid-round.
**Disposition: OPTION B (§8 of AR-1369A / §7 of AR-1370A) — both repaired lanes survived independent attack in the same round; calibration tasks emitted; no genuine blocker fired.**

---

## SCRATCH CHECKOUT

Fresh disposable worktree `C:\Users\tonio\Projects\wt-lanetest-repair-8acb6b0f`, detached HEAD `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b` (== the exact SHA both rulings named). No merge of the GPT-engineering branch into the worker branch. Diff of the repair against prior tip confirmed exactly 4 files touched (`git show 8acb6b0f --stat`): `strategy_factory_opus_bound_grade_compare.py`, `_gpt_opus_bound_grade_compare_proof.py`, `strategy_factory_gpt56_semantic_audit.py`, `_gpt_strategy_factory_gpt56_semantic_audit_proof.py`. No compiler/certifier/backtest/Factory-runtime/guard/bootstrap/queue/receipt/manifest path touched.

## REPAIR-SESSION EVIDENCE (GPT-authored, development-only — not self-certifying)

Read both diffs in full before running anything. Lane A adds `_build_grade_agent_request(...)`, used identically at emission and (re-derived) at verification; `_verify_task_live()` now requires the stored `agent_request` to equal the independently re-derived expected request, not merely self-hash. Lane B's `enumerate_claims()` now walks every `<field>_transcript_quote` sibling generically (not a hardcoded HTF special case), requiring the sibling claim field to exist and emitting `claim_ref` = the claim field, not the quote field. Both diffs match what AR-1370A/AR-1371A prescribed line-for-line. GPT itself disclosed it has no execution shell and claims no runtime result for this candidate — that is exactly why this round exists.

## WORKER-1 INDEPENDENT EVIDENCE (MEASURED HERE, rerun myself, not relayed)

### Baseline GPT proofs, rerun against the repair candidate

```
python scripts/_gpt_opus_bound_grade_compare_proof.py
-> ALL GPT BOUND-GRADE DEVELOPMENT PROOFS PASSED
   includes new regression: "PASS NEGATIVE: AR-1377 stale v1 request/permit cannot certify
   re-frozen v2: grade Agent request no longer matches independently derived binding"

python scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py
-> ALL GPT-5.6 SEMANTIC-AUDIT DEVELOPMENT PROOFS PASSED
   includes new regressions: generic *_transcript_quote coverage (direction + execution_timeframe
   proven, not just HTF); fabricated higher_timeframe now mandatory; omission refused; NOT_ENTAILED
   on it produces semantic_pass=false
```

### Lane A — `scripts/_worker_reattack_lane_a_post_repair.py` (imports the real unmodified repaired module via `importlib`, calls the real `cmd_emit_grade`/`cmd_ingest_grade`/`_verify_bound_grade`)

Three checks, all against the exact repaired gate:

1. **Exact AR-1377 reproducer rerun** (re-freeze v2, repoint only `task.candidate_sha256`, keep the stale v1 `agent_request`/consumed permit) → **REFUSED**: `"grade Agent request no longer matches independently derived candidate/transcript/nonce binding"`.
2. **NEW — stale-nonce swap**: change `task.grade_nonce` only, keep the stale v1 `agent_request`/its hash → **REFUSED**, same reason (the re-derived expected request embeds the new nonce and no longer matches the stored stale request).
3. **NEW — self-forged request, stale permit** (the exact attack class AR-1370A/AR-1371A name explicitly: "alter a request field, self-rehash the task, and attempt to reuse the old consumed permit"): attacker rebuilds a fully self-consistent request+hash for v2 using the real `_build_grade_agent_request` helper — internally truthful — but the only *consumed* permit that exists was issued by a real guard for v1's original request hash → **REFUSED**: `"expected exactly one consumed isolated-grader permit for exact Agent request; found 0"`.

Honest positive path preserved throughout (`SETUP OK: honest bound PASS exists for candidate v1`, used as the setup step every check builds from).

```
python scripts/_worker_reattack_lane_a_post_repair.py
-> {"check_1_held": true, "check_2_held": true, "check_3_held": true, "ALL_HELD": true}
-> LANE A RE-ATTACK VERDICT: GATE HOLDS -- Lane A PASS (post-repair)
EXIT=0
```

### Lane B — `scripts/_worker_reattack_lane_b_post_repair.py` (imports the real unmodified repaired module, calls the real `emit`/`ingest`/`enumerate_claims`)

1. **Exact AR-1377 HTF reproducer rerun** — `higher_timeframe` now enumerated (`field_ref=strategies[0].higher_timeframe enumerated=True`); omitting its review row from the response → **REFUSED** (`claim entailment coverage incomplete`); an honest response marking it `NOT_ENTAILED` (with verdict correctly flipped to `FAIL`, matching GPT's own PASS/NOT_ENTAILED-incompatibility rule) → `semantic_pass=false`, `status=GPT56_SEMANTIC_AUDIT_FAIL`.
2. **NEW — suffix-field attack not limited to HTF**: fabricated `direction` flip (long→short) backed by a real-but-irrelevant literal quote (`"so you can see it while I talk"`). Enumerated (`field_ref=strategies[0].direction enumerated=True`); omission refused; `NOT_ENTAILED` on it → `semantic_pass=false`. Proves the fix is generic, not an HTF-only patch.
3. **Clean-positive regression control**: a fully honest, fully-covered, all-`ENTAILED` response on an unmodified honest candidate still freezes as `GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED` / `semantic_pass=true` — the generic coverage law does not brick valid candidates.

One self-caught tooling bug during this round, disclosed per doctrine: my first `NOT_ENTAILED` fixture kept the overall response `verdict:"PASS"` while marking a claim `NOT_ENTAILED`; the repaired harness correctly refused that combination outright (it is one of GPT's own existing fixtures — "PASS cannot coexist with NOT_ENTAILED claim"). That was a bug in my test construction, not a gate defect. Fixed by setting `verdict:"FAIL"` (what a genuinely honest auditor would do on finding a real problem) and rerun; the corrected run is what's reported here.

```
python scripts/_worker_reattack_lane_b_post_repair.py
-> {"htf_held": true, "direction_held": true, "clean_positive_held": true, "ALL_HELD": true}
-> LANE B RE-ATTACK VERDICT: GATE HOLDS -- Lane B PASS (post-repair)
EXIT=0
```

**Both lanes PASS. Per AR-1371A §5, continuing in the same round to task emission — no additional STOP.**

---

## THREE GPT-5.6 CALIBRATION TASKS EMITTED

Using the repaired harness at exact SHA `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b` (`scripts/_worker_emit_gpt56_calibration_tasks.py`), against the already-frozen fresh Opus candidates and real transcripts committed on this worker branch. Freshness independently re-verified for all three before emission — live SHA256 of each transcript file and each `fresh_source_candidate.json` recomputed and matched byte-for-byte against `candidate_receipt.json`'s pinned `transcript_sha256`/`candidate_sha256` (all three `FRESH=True`). No substitute model run. No response fabricated — emission only; the audit responses remain for the controlling GPT-5.6 Sol seat.

| video_id | transcript_sha256 | candidate_sha256 | semantic_task_sha256 | audit_nonce | claim_count | strategy_count |
|---|---|---|---|---|---|---|
| `1HFoStW_wsc` | `c84a83c7...` | `90a36a75...` | `0c518849...` | `52892798...` | 73 | 6 |
| `E8Wg6tFPYjo` | `62036e6e...` | `858cb977...` | `06315e19...` | `c06dc26b...` | 41 | 1 |
| `7ieYBa7Z-Hg` | `63742bf9...` | `2d47ef1f...` | `68b7f997...` | `a8ea7c1d...` | 63 | 1 |

Full artifacts (task JSON, prompt `.txt`, index) under `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks/<video_id>/`, index at `.../gpt56-semantic-tasks/index.json`. Each `gpt56_semantic_audit_prompt.txt` is the exact, unmodified artifact `emit()` itself wrote — not reconstructed by this script.

**Observation, not a defect:** `selection.json`'s pre-registered category for `7ieYBa7Z-Hg` is `MULTI_STRATEGY_IDENTITY_CONTROL` ("inventory contains strategy_index 0 and 1 for one transcript... fresh reader must enumerate strategies without inheriting old index assumptions"), but the frozen fresh-Opus candidate for this video enumerates `strategy_count=1`. That divergence from the legacy 2-index assumption is exactly the class of outcome this diagnostic exists to surface, not evidence of a defect in this round's work — flagged here for GPT-5.6 Sol's and GPT's awareness, not adjudicated by Worker 1.

---

## FINDINGS

None against the repair. Both gates hold under every attack attempted, including two genuinely new bypass classes per lane beyond the original AR-1377 reproducers, without regressing the honest positive paths.

## WHAT WAS NOT DONE (freezes honored)

- No merge of `external-advisor/gpt-engineering` into the worker branch.
- No repair of GPT-authored code by Worker 1 (repair was GPT-engineering-lane work, per AR-1370A §3).
- No substitute-model semantic audit; no fabricated GPT-5.6 response.
- No candidate entered certifier/compiler; no broad Factory/backtest/PAPER/live-execution work.
- No 160-video intake.

## NEXT

Per AR-1371A §5: return the three emitted tasks to the controlling GPT-5.6 Sol seat for the actual semantic audits. Worker 1 stops here — the next action (running the real GPT-5.6 audits) belongs to that seat, not this one.

## PEER HANDSHAKE DEVIATION (carried forward from AR-1377, still in force this round)

Worker 2 remains reported closed for this session. Continuing without the worker-onboarding §2b peer HELLO/ACK exchange per operator instruction, disclosed again here rather than silently dropped.
