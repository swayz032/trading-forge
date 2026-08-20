# GPT EXTERNAL ADVISOR RULING — AR-1372A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Current Worker HEAD inspected:** `006a39d107edad2a4d2381687ae9153a08c146a6`  
**AR-1378 evidence commit:** `a8e0588d684bae90d69826a231660db4746256a4`  
**Accepted GPT-engineering repair candidate:** `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`  
**Prior controlling ruling:** AR-1371A @ `0c2d24fa4d5d94f8bdc4beb4916e8372905a0b47`

## DISPOSITION

**AR-1378 = PASS.**  
**LANE A POST-REPAIR INDEPENDENT RE-ATTACK = PASS.**  
**LANE B POST-REPAIR INDEPENDENT RE-ATTACK = PASS.**  
**GPT-ENGINEERING REPAIR `8acb6b0f...` IS ACCEPTED FOR THE BOUNDED STAGE-3 CALIBRATION PATH.**  
**THE THREE REAL GPT-5.6 SOL SEMANTIC-AUDIT TASKS ARE ACCEPTED AS CORRECTLY EMITTED AND BOUND.**  
**THE NEXT MONEY-PATH ACTION IS THE ACTUAL GPT-5.6 SOL SEMANTIC AUDIT OF THOSE THREE FROZEN CANDIDATES.**

Worker 1 completed exactly the independent certification round required by AR-1371A: it attacked GPT-authored repair bytes at exact SHA `8acb6b0f...` from a separate scratch checkout, preserved honest positive controls, added new bypass attempts rather than merely replaying GPT's own proof suite, and emitted the three real semantic-audit tasks only after both repaired gates survived.

The current Worker tip is one generated `SYSTEM-INVENTORY.md` regeneration commit beyond the AR-1378 evidence commit. No new Factory source, compiler, certifier, guard, broker, PAPER, or live-money mutation appears after AR-1378.

GitHub reports no status checks and no workflow runs for exact current Worker HEAD.

**CI: NONE; tests are local-only evidence plus independent repository inspection.**

---

## 1. INDEPENDENT REPOSITORY VERIFICATION — REPAIR CERTIFICATION

### A. Lane A — consumed-permit / candidate binding

Worker's re-attack script targets the exact repaired module from the isolated `8acb6b0f...` checkout rather than a copied implementation.

The script exercises three distinct authority-laundering attempts:

1. exact AR-1377 candidate rebinding — a v1 request/permit is retained while the frozen candidate is replaced by materially different v2 and only `task.candidate_sha256` is repointed;
2. stale nonce — `task.grade_nonce` changes while the stored request and permit remain stale;
3. self-consistent forged v2 request — candidate/request/request-hash are rebuilt truthfully for v2, but the only consumed permit remains the old v1 request witness.

The code structure is discriminating:

- checks 1 and 2 must be refused by the new independently-derived request equality;
- check 3 must pass the derived-request equality but be refused because no consumed permit exists for the new request hash;
- every check begins from an honest v1 positive path that successfully produces a bound PASS first.

This directly tests both halves of the repaired law instead of merely asserting that one error path fires.

Worker reports all three checks held with exit `0`. The inspected script is consistent with that result and calls the real repaired `cmd_emit_grade`, `cmd_ingest_grade`, `_verify_bound_grade`, and `_build_grade_agent_request` functions.

**Lane A accepted.**

### B. Lane B — generic semantic claim coverage

Worker's Lane-B re-attack targets the exact repaired semantic harness and tests two distinct suffix fields:

1. the original fabricated `higher_timeframe` class;
2. a new fabricated `direction` class using a literal-but-semantically-irrelevant quote.

For each fabricated field it requires:

- the paired claim field appears in `required_claims`;
- omitting that claim from the audit response is refused as incomplete coverage;
- marking the field `NOT_ENTAILED` results in semantic failure.

It also preserves an all-covered clean positive control proving the generic suffix law does not simply brick every candidate.

The Worker disclosed one fixture-construction mistake: its first negative response incorrectly combined overall `PASS` with a `NOT_ENTAILED` claim; the harness correctly rejected that impossible combination. Worker corrected the fixture to overall `FAIL` and reran it. This is evidence of fail-closed behavior, not a repair defect.

One proof-quality nuance is recorded: the corrected `NOT_ENTAILED` fixture also carries a HIGH finding, so the runtime fixture is not a perfect single-variable isolation of the non-entailed reason. This is **not a blocker** because GPT independently inspected the actual harness implementation: every entailment row whose verdict is not `ENTAILED` is itself appended to `fail_closed_reasons` before findings are evaluated. Therefore the non-entailed claim independently blocks semantic PASS even without the HIGH finding.

**Lane B accepted.**

---

## 2. THE THREE REAL GPT-5.6 TASKS ARE MECHANICALLY WELL-BOUND

Worker emitted the tasks using the repaired harness from exact GPT-engineering SHA:

`8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

GPT independently inspected the committed index, the three candidate receipts, the three task identities, and the generated prompts.

### A. `1HFoStW_wsc`

Frozen candidate receipt:

- transcript SHA256: `c84a83c745da422bb3c19955f981a9f7ba848a7eaa68b85b732630201263b080`;
- candidate SHA256: `90a36a75bc1db78cac9b5b0181754488d98fa9406fc1b90d4bba3b876d6d170e`;
- literal quote count: `73`;
- strategy count: `6`.

Emitted semantic task matches the same candidate SHA and transcript SHA, requires model identity `GPT-5.6 Sol`, keeps `legacy_semantics_visible:false`, carries six strategy IDs, and explicitly includes suffix-generated first-class claims such as `strategies[0].direction` and `strategies[0].higher_timeframe`.

Index:

- claim count `73`;
- strategy count `6`;
- audit nonce `52892798d4d79c3940e6e9d057bf3c308a2faac8e31167dd275766946fa6506e`;
- semantic task file SHA256 `0c5188491762980792934f3a02aa6ff7ee76efa1aa447181c005dee3d56da36a`;
- prompt file SHA256 `100f6fc815d1e80e0a602fde8ea15fb839274b6f4e0728c0c1b4d9021b3a3782`.

### B. `E8Wg6tFPYjo`

Frozen candidate receipt:

- transcript SHA256: `62036e6e62ae927c165a7d501e20ae0fcd15684933cd4419c5832ba74756ec67`;
- candidate SHA256: `858cb977600204827918dad8fd531722e454f0c0f348a91fd3b1ed62e9ce0008`;
- literal quote count: `41`;
- strategy count: `1`.

Emitted semantic task matches both frozen hashes, requires `GPT-5.6 Sol`, keeps legacy hidden, and explicitly enumerates `direction`, `higher_timeframe`, and `execution_timeframe` as separate mandatory semantic claims.

Index:

- claim count `41`;
- strategy count `1`;
- audit nonce `c06dc26b1964018a2d056de4659240788bbce62bf7efa1973aa146abd8956985`;
- semantic task file SHA256 `06315e1919fdb877dd2121f9b648fa42fa27a3b5eafc30ce13824af58e145656`;
- prompt file SHA256 `e4022163c65850b858cdc78ae32ec6f766785ab610f29b7d95dc6c2ac756e321`.

### C. `7ieYBa7Z-Hg`

Frozen candidate receipt:

- transcript SHA256: `63742bf97578c28637b85ea58540d1acbee8341c9e7c4d31d90f09c165c5dcf7`;
- candidate SHA256: `2d47ef1f16da7d2bb8b3159b207b35f726cff14bc79dbc405d9529639348cb26`;
- literal quote count: `63`;
- strategy count: `1`.

Emitted semantic task matches both frozen hashes, requires `GPT-5.6 Sol`, keeps legacy hidden, and explicitly enumerates direction / higher-timeframe / execution-timeframe claims.

Index:

- claim count `63`;
- strategy count `1`;
- audit nonce `a8ea7c1dfc61963030b098fa48919b89f27e4aace2e3ac4a5949728321a68a85`;
- semantic task file SHA256 `68b7f99745a0ffdd74dc3dfdc4393df47fa98a4e74f24a1194326a24d29af9c0`;
- prompt file SHA256 `38b208951a844fa431baa2dd9922dd33aa1d850d50618c0cfb22b3354eb52ea4`.

### D. Strong completeness cross-check

The repaired task claim counts equal the earlier literal verifier's frozen quote counts **exactly for all three candidates**:

- `1HFoStW_wsc`: `73 == 73`;
- `E8Wg6tFPYjo`: `41 == 41`;
- `7ieYBa7Z-Hg`: `63 == 63`.

The task strategy counts also equal the frozen candidate-receipt strategy counts exactly:

- `6 == 6`;
- `1 == 1`;
- `1 == 1`.

This is strong independent mechanical evidence that the repaired semantic task generator is no longer silently dropping the sibling `*_transcript_quote` evidence class that caused AR-1377 Lane B.

---

## 3. WHAT HAS ACTUALLY BEEN PROVEN — AND WHAT HAS NOT

The following is now proven strongly enough for the bounded Factory calibration path:

- Guard-V2 is live and closed from the prior round;
- Lane A's bound independent-grade authority path survives the measured stale-request / candidate / nonce / self-rehash attacks;
- Lane B's semantic task builder provides generic quote-field coverage for the measured suffix classes and preserves a positive path;
- the three real frozen candidates have deterministic GPT-5.6 audit tasks bound to their exact candidate/transcript identities.

The following has **NOT** happened yet:

- GPT-5.6 Sol has not yet issued the actual semantic verdicts for the three real candidates;
- Claude has not yet independently attacked those GPT-5.6 verdicts;
- none of the three candidates is semantically certified;
- none may enter deterministic certifier/compiler yet;
- no source-faithful backtest is authorized from this report alone.

Task emission is the doorway to semantic adjudication, not semantic PASS.

---

## 4. NEXT MONEY-PATH ACTION — ACTUAL GPT-5.6 SOL AUDITS

The controlling GPT-5.6 Sol seat now owns exactly three semantic audits, one per frozen task:

1. `1HFoStW_wsc`;
2. `E8Wg6tFPYjo`;
3. `7ieYBa7Z-Hg`.

For each task, GPT-5.6 Sol must grade the frozen candidate only against the original transcript and return the exact bound response schema required by the task.

The audit must independently decide:

- whether every proposed top-level strategy is actually an independent executable strategy rather than a variant/filter/context object;
- whether every required claim is semantically entailed by its cited source span;
- whether any relationship between individually true claims is invented;
- whether audience attribution is correct;
- whether stop/target/management roles are source-faithful;
- whether one-sided rules were silently made symmetric;
- whether source gaps contradict executable claims;
- whether the candidate omitted material taught execution rules.

A literal quote is not enough. `ENTAILED` means the source actually means the attached claim.

No legacy/Gemma semantics may be consulted before these three verdicts freeze.

### After each GPT-5.6 response

Worker/Claude must ingest the exact response through the repaired harness and then perform the independent Claude/accuracy-validator attack required by the semantic-audit contract.

A candidate reaches deterministic certifier/compiler only if:

1. the GPT-5.6 semantic audit is clean PASS;
2. the independent Claude attack is also clean;
3. the exact receipts bind the same frozen transcript/candidate/task/audit identities.

If GPT-5.6 finds a real semantic defect, that candidate fails this calibration attempt honestly. Do not repair the candidate in place and preserve the same identity.

---

## 5. `7ieYBa7Z-Hg` IDENTITY OBSERVATION

The selection/category history labels `7ieYBa7Z-Hg` as a multi-strategy identity control, while the fresh frozen Opus reconstruction contains one proposed strategy.

This is **not** a mechanical task-emission defect. It is exactly the kind of source-identity question the GPT-5.6 semantic stage must resolve from the original transcript.

Do not assume the historical two-index expectation is correct merely because it is historical. Gemma/legacy structure has zero semantic authority here.

GPT-5.6 must answer from transcript meaning alone whether the source teaches one independent strategy, multiple independent strategies, variants, or filters.

---

## 6. FACTORY / MONEY-PATH LOCKS

Still locked until semantic audit + independent challenge complete:

- no BOUNDED candidate enters deterministic certifier/compiler;
- no candidate becomes `FAITHFUL_COMPILE_READY_FOR_BACKTEST` from model agreement alone;
- no mass old-40 re-extraction;
- no broad Factory rerun;
- no broad backtesting;
- no PAPER;
- no broker/Topstep/live;
- no certifier weakening;
- no semantic invention/substitution;
- no new 160-video intake until the permanent transcript-first semantic chain is proven and the operator supplies the exact source list.

Gemma remains historical evidence only with zero load-bearing semantic authority.

---

## FINAL RULING

**AR-1378 PASSES. Worker 1 independently attacked exact GPT repair `8acb6b0f...` rather than trusting GPT's own proofs. Lane A now survives the original candidate-rebinding attack, a stale-nonce attack, and a self-consistent forged-request attempt that lacks the required consumed permit, while preserving an honest positive path. Lane B now forces generic sibling `*_transcript_quote` claims into semantic coverage, survives the original HTF attack plus a new direction-field attack, refuses omitted coverage, and preserves a clean positive path. GPT independently confirms the three emitted real tasks match the exact frozen candidate/transcript identities; their claim counts equal the prior frozen literal-quote counts exactly at 73/41/63 and strategy counts match exactly at 6/1/1. The infrastructure gate repair round is therefore closed for this bounded calibration path. We are now at the actual semantic-understanding step: GPT-5.6 Sol must audit the three real candidates against their original transcripts. No candidate is certified, compilable, backtest-authorized, PAPER-authorized, or live-authorized yet.**