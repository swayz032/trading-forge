# GPT EXTERNAL ADVISOR RULING — AR-1370A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Current Worker HEAD inspected:** `20a1c1781469663f50c0803df0b2992508201a43`  
**AR-1377 attack/report commit:** `88209ba28a16ff88d2bc95e6732f62893b668085`  
**Current GPT engineering tip:** `8d0ee514ce09913197f0755fded5d2e7993a2a8d`  
**Prior controlling ruling:** AR-1369A @ `283ede6b9468e41cd40f17c218f5cfb76952f54f`

## DISPOSITION

**AR-1377 = PASS AS A BLOCKER REPORT.**  
**LANE A = REAL FALSE GREEN — HIGH/CRITICAL.**  
**LANE B = REAL FALSE GREEN — HIGH.**  
**THE THREE GPT-5.6 CALIBRATION TASKS CORRECTLY REMAIN UNEMITTED.**  
**REPAIR BOTH GATES NOW; DO NOT DETOUR INTO NEW ARCHITECTURE.**

Worker 1 did exactly what the independent-attack round was supposed to do: it broke two GPT-authored load-bearing gates with novel attacks, stopped the affected lanes, preserved the reproducers, and did not weaken or silently repair the gates in the same grading round.

The current Worker tip is two commits beyond AR-1376: AR-1377 adds the two Worker-authored attack scripts plus the report, and the next commit only regenerates `docs/designs/SYSTEM-INVENTORY.md` to account for those new runnable scripts. GPT found no unrelated Factory/source/compiler mutation in that delta.

GitHub reports no status checks and no workflow runs on the exact current Worker tip.

**CI: NONE; the reported proof runs are local/mechanical evidence.**

---

## 1. INDEPENDENT GPT VERIFICATION — LANE A

Target:

`scripts/strategy_factory_opus_bound_grade_compare.py`

Authority baseline remains the Lane-A code at `897655fd3ef0b8324aca346a60c3258ef0943cfd`, byte-identical for the Lane-A files at GPT engineering tip `8d0ee514...`.

The defect is real.

`cmd_emit_grade()` creates an Agent request whose prompt contains the exact candidate SHA, transcript SHA, nonce, transcript text, and candidate text. But `_verify_task_live()` later verifies only:

- frozen candidate receipt SHA == `task.candidate_sha256`;
- live transcript SHA == `task.transcript_sha256`;
- `request_sha256(task.agent_request) == task.agent_request_sha256`;
- role/isolation;
- live toolbox identity.

It does **not** re-derive the expected grade request from the current frozen candidate + task identity and compare that expected request to the request the consumed permit actually authorized.

That leaves two internally self-consistent islands instead of one binding:

1. current candidate/receipt/task candidate SHA;
2. stale Agent request / request SHA / consumed permit.

Worker's attack exploits exactly that seam by grading v1, then re-freezing a materially different v2 and changing only `task.candidate_sha256` while retaining the v1 Agent request and its consumed permit. The gate can mint a new `BOUND_INDEPENDENT_GRADE_PASS` for v2 even though the permitted request named v1.

GPT independently inspected the Worker reproducer. It imports and calls the real unmodified gate functions (`cmd_emit_grade`, `cmd_ingest_grade`, `_verify_bound_grade`) rather than a copy.

### Evidence-quality nuance

The reproducer writes a synthetic consumed-permit fixture matching the same permit shape used by GPT's own development proof; it did not obtain a fresh live guard permit in this attack round. Worker disclosed that limitation. It does **not** invalidate the source-level finding: `_matching_consumed_permits()` ignores any candidate-specific semantics beyond the exact Agent-request hash, and the attack intentionally preserves the exact v1 request hash. A real consumed v1 permit therefore provides the same stale-request witness to the vulnerable gate.

Do not overclaim an unmeasured cross-HEAD replay variant. That remains unproven and is not needed to close this blocker.

---

## 2. INDEPENDENT GPT VERIFICATION — LANE B

Target:

`scripts/strategy_factory_gpt56_semantic_audit.py`

The defect is real.

`enumerate_claims()` currently creates a required semantic-audit row only when a dict contains a key literally named:

`transcript_quote`

But the frozen candidate schema also places source evidence in sibling fields such as:

- `direction` + `direction_transcript_quote`;
- `higher_timeframe` + `higher_timeframe_transcript_quote`;
- `execution_timeframe` + `execution_timeframe_transcript_quote`.

Those are load-bearing claims, but the current enumerator never places them in `required_claims`.

Worker's higher-timeframe attack is therefore valid: a literal quote saying the one-hour chart is merely visible can be attached to a fabricated `higher_timeframe = 1h` rule, survive the upstream literal-substring gate, and add **zero** mandatory semantic-review rows.

GPT independently inspected the Worker reproducer. It uses the real `enumerate_claims`, `emit`, `ingest`, response validator, and upstream candidate validator.

### Correct repair boundary

Do **not** try to turn this deterministic harness into a semantic NLP engine. The harness's job is to guarantee **coverage and binding**. GPT-5.6 Sol's job is to decide whether a literal quote actually entails the claim.

The repair must therefore make every quote-bearing load-bearing field impossible to skip.

---

## 3. REPAIR AUTHORITY — ONE SURGICAL GPT-ENGINEERING REPAIR ROUND

The repair belongs on the isolated GPT engineering lane, not mixed into Worker 1's live Factory branch.

Base exactly:

`external-advisor/gpt-engineering @ 8d0ee514ce09913197f0755fded5d2e7993a2a8d`

A dedicated top-level GPT-engineering repair session is authorized to modify only:

1. `scripts/strategy_factory_opus_bound_grade_compare.py`;
2. `scripts/_gpt_opus_bound_grade_compare_proof.py`;
3. `scripts/strategy_factory_gpt56_semantic_audit.py`;
4. `scripts/_gpt_strategy_factory_gpt56_semantic_audit_proof.py`;
5. `docs/designs/GPT-5.6-SOL-SEMANTIC-AUDIT-CONTRACT-V1-2026-08-19.md` only if needed to make the permanent contract wording match the generic quote-field coverage law.

No new architecture module is authorized. No Factory runtime, compiler, certifier, backtester, PAPER, broker, or live-money path is authorized.

If the normal guarded Worker seat refuses writes to an external GPT-engineering worktree, do **not** weaken Guard-V2. Use the same separation principle already proven by the control-plane work: the repair session is a distinct top-level engineering actor/worktree, and Worker 1 remains the later independent attacker/certifier.

### Lane A repair law — derive, do not merely self-hash

Implement one deterministic request-construction law and use it at both emission and verification.

Preferred shape:

- a helper builds the full expected grade Agent request from:
  - `video_id`;
  - frozen candidate SHA;
  - transcript SHA;
  - grade nonce;
  - current transcript text;
  - current frozen candidate bytes/text;
- `cmd_emit_grade()` uses that helper;
- `_verify_task_live()` independently calls the same helper from live/frozen inputs and requires the stored `task.agent_request` to equal the expected request exactly;
- `task.agent_request_sha256` must equal the canonical hash of that independently derived expected request.

The repair must therefore bind at least:

- candidate identity;
- transcript identity;
- nonce;
- candidate text;
- transcript text;
- description;
- role;
- model field;
- isolation;
- request hash;
- consumed permit for that exact request hash.

Keep the existing parent-HEAD and live-toolbox checks. Do not weaken permit matching or convert the guard witness into a self-declared field.

Permanent regression required: the exact AR-1377 class — v1 gets a consumed request witness, v2 is materially re-frozen while the stale v1 request/permit remains — must be refused before a v2 bound PASS can be minted.

### Lane B repair law — generic suffix coverage

`enumerate_claims()` must cover both:

1. the existing object-style bare `transcript_quote`; and
2. every non-empty sibling key matching `*_transcript_quote` whose stem names the attached claim field in that same object.

This must be **generic**, not a hardcoded one-off for `higher_timeframe`.

For example:

- `direction_transcript_quote` must create an obligation for the `direction` field;
- `higher_timeframe_transcript_quote` must create an obligation for `higher_timeframe`;
- `execution_timeframe_transcript_quote` must create an obligation for `execution_timeframe`.

The generated claim row must identify the **claim field**, not merely the quote field, and must carry the exact quote. Preserve unique deterministic `claim_ref` values and do not double-count the same semantic claim.

Permanent regressions required:

- the AR-1377 fabricated `higher_timeframe` must add a mandatory claim row;
- omission of that new row from the audit response must be refused as incomplete coverage;
- an audit response marking that row `NOT_ENTAILED` must produce semantic FAIL / `semantic_pass=false`;
- positive controls must prove `direction_transcript_quote` and `execution_timeframe_transcript_quote` are also enumerated, showing the fix is generic rather than HTF-special-cased.

The deterministic harness is **not** expected to decide that the one-hour quote is semantically wrong on its own. It must guarantee GPT-5.6 cannot return a mechanically complete PASS without addressing the field.

---

## 4. DEVELOPMENT PROOF IN THE REPAIR SESSION

Before pushing the GPT-engineering repair, run:

- the existing Lane-A GPT proof;
- the existing Lane-B GPT proof;
- the new/extended Lane-A regression for AR-1377 candidate rebinding;
- the new/extended Lane-B generic suffix-claim regressions.

The repair actor may use these as development evidence only.

**GPT-authored or GPT-directed repairs do not self-certify.**

Push one bounded repair commit to `external-advisor/gpt-engineering` and report its exact SHA and changed-path set.

Do not emit the three real calibration tasks from the repair actor.

---

## 5. WORKER 1 — INDEPENDENT RE-ATTACK IMMEDIATELY AFTER REPAIR

After the repair commit is pushed, Worker 1 must independently inspect the exact repair commit and attack it from a clean/read-only scratch checkout.

Do not merge the GPT engineering branch into Worker 1 yet.

Required independent checks:

### Lane A

1. rerun GPT's baseline proof;
2. rerun the AR-1377 candidate-rebinding reproducer against the repaired gate and require it to be refused;
3. add at least one new bypass attempt against the new derived-request binding. High-value options:
   - change task nonce while preserving a stale request;
   - change transcript identity while preserving a stale request;
   - alter a request field and self-rehash the task while attempting to reuse the old consumed permit.

A PASS requires every such stale-request/cross-identity attempt to fail closed while the honest positive path still works.

### Lane B

1. rerun GPT's baseline semantic-harness proof;
2. rerun the AR-1377 higher-timeframe coverage attack and prove the fabricated field now appears in `required_claims`;
3. add at least one new suffix-field attack not limited to HTF — prefer fabricated `direction` or `execution_timeframe` backed by a literal but semantically irrelevant quote;
4. prove response coverage cannot omit that field and a `NOT_ENTAILED` verdict blocks semantic PASS.

A PASS requires generic quote-field coverage, not a special-case patch.

If either repaired lane still produces a real HIGH/CRITICAL false green, STOP that lane and report the smallest reproducer. Do not patch again in the same independent grading round.

---

## 6. IF BOTH REPAIRED LANES PASS — DO NOT STOP; EMIT THE THREE GPT-5.6 TASKS

If and only if both repaired lanes survive Worker 1's independent attacks, continue in the same round and emit the exact GPT-5.6 semantic-audit tasks for the already frozen fresh Opus candidates:

- `1HFoStW_wsc`;
- `E8Wg6tFPYjo`;
- `7ieYBa7Z-Hg`.

Use the **repaired** GPT-5.6 semantic harness from the exact repaired GPT-engineering commit.

For each video persist/report:

- `video_id`;
- transcript path and SHA256;
- frozen candidate path and SHA256;
- semantic task path and SHA256;
- audit nonce;
- exact generated GPT-5.6 prompt path and prompt SHA256;
- claim count and strategy count;
- repaired GPT-engineering commit SHA used to emit it.

Do not run a substitute model. Do not fabricate GPT-5.6 responses. The controlling GPT-5.6 Sol advisor seat will perform those audits after receiving the exact emitted tasks.

---

## 7. WORKER REPORT / STOP LAW

Use one durable report after this combined repair-certification round.

Suggested path:

`docs/replay-results/worker-advisor-reports/AR-1378-WORKER1-AR1370A-DUAL-GATE-REPAIR-INDEPENDENT-REATTACK-AND-GPT56-TASKS-2026-08-19.md`

The report must distinguish:

- repair-session development evidence;
- Worker 1 independent evidence;
- any Agent/subagent evidence;
- deterministic/local test evidence;
- exact GitHub commit identities.

Do not stop merely to announce that the repair commit exists. Continue through independent attack and task emission unless a genuine blocker fires.

---

## 8. FACTORY / MONEY-PATH FREEZES

Still locked:

- no BOUNDED candidate enters certifier/compiler yet;
- no candidate becomes `FAITHFUL_COMPILE_READY_FOR_BACKTEST` from model agreement alone;
- no mass re-extraction of the old 40;
- no broad backtesting;
- no PAPER;
- no broker/Topstep/live;
- no certifier weakening;
- no semantic substitution/invention;
- no new 160-video intake until the permanent transcript-first + GPT-5.6 audit architecture is proven and the operator supplies the exact source list.

Gemma remains zero-authority historical evidence only.

---

## FINAL RULING

**AR-1377 PASSES AS AN ADVERSarial blocker report. Lane A found a real candidate-rebinding authority-laundering seam: the gate validates the current candidate and the stale permitted Agent request independently but never re-derives and cross-binds them. Lane B found a real semantic-coverage seam: the harness requires rows only for bare `transcript_quote` objects and silently omits sibling `*_transcript_quote` claims such as higher timeframe, direction, and execution timeframe. Both GPT-authored gates must be surgically repaired on the isolated GPT engineering lane, with permanent regressions. Then Worker 1 independently re-attacks both repairs. If both survive, Worker immediately emits the three exact repaired GPT-5.6 semantic-audit tasks and returns them to GPT-5.6 Sol. No new architecture detour, no calibration-task emission before both repairs pass, and no PAPER/live shortcut.**