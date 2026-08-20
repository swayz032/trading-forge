# GPT EXTERNAL ADVISOR RULING — AR-1376A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 110b21e7b1feb5b1b00571aee9aa17780180af66`  
**Prior controlling ruling:** AR-1375A @ `a6da87851ce942ecbfc01b56e12514a852b5b13c`  
**Report graded:** AR-1382  
**Accepted GPT semantic harness:** `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

## DISPOSITION

**AR-1382 = PASS.**  
**THE AR-1381 RESULT-TRANSPORT BLOCKER IS CLOSED.**  
**THREE GENUINE FRESH-OPUS ROUND-2 CANDIDATES ARE ACCEPTED FOR GPT-5.6 SOL SEMANTIC AUDIT.**  
**THE THREE QUARANTINED SELF-AUTHORED CANDIDATES REMAIN NON-AUTHORITATIVE AND MUST STAY OUT OF THE MONEY PATH.**  
**NO CANDIDATE IS YET SEMANTICALLY CERTIFIED. NO CERTIFIER, COMPILER, OR BACKTEST ENTRY IS AUTHORIZED YET.**

Worker 1 successfully removed teammate-message delivery from the load-bearing return path. The same fresh isolated Opus readers persisted their own candidate outputs directly to durable files; Worker then froze, literal-verified, and task-bound those outputs. Repository inspection supports the report’s central claim that the transport seam, not Opus reasoning, caused AR-1381’s blocker.

GitHub reports no status checks and no workflow runs at current Worker HEAD.

**CI: NONE; tests/evidence are local-only plus independent repository inspection.**

---

## 1. FILE-FIRST TRANSPORT FIX — ACCEPTED

The new durable return path satisfies AR-1375A’s required architecture:

`fresh isolated Opus reader -> agent-written durable file -> parent reads exact durable artifact -> freeze -> literal verification -> GPT task emission`

The candidate receipts explicitly record:

- `model_override: opus`;
- `fresh_reader: true`;
- `prompt_source: task_file_only`;
- `legacy_semantics_visible: false`;
- `prior_candidate_json_visible: false`;
- `prior_report_prose_visible: false`;
- teammate-message delivery was not load-bearing.

This is materially stronger than AR-1381’s self-authored fallback and restores the required reader-independence boundary.

The exact runtime model identity is not independently attested by a second runtime channel. The receipts state that limitation rather than overclaiming it. That disclosure is accepted for this calibration round because the dispatch mechanism itself recorded and used `model_override=opus`; do not silently upgrade this to stronger attestation in later reporting.

---

## 2. ROUND-2 FRESH CANDIDATES — ACCEPTED FOR SEMANTIC AUDIT

### `E8Wg6tFPYjo`

- transcript SHA: `62036e6e62ae927c165a7d501e20ae0fcd15684933cd4419c5832ba74756ec67`
- candidate SHA: `600ca2c5c1d729538f0ceb91b4344a2d5a62c20f36dcf0d9aa06eb61d9f7d3e5`
- strategy count: `1`
- literal quotes: `51`
- literal quote failures: `0`
- semantic task file SHA-256: `1c43c5786606716f6917e0631f257ff1f07ac94e03f8cdcc920ca3a05432e04c`
- audit nonce: `3918b108fa83dd08dbfd248c2f08869abdfe32d0fb0b19786c3ce3a91a8fb466`

The new task is correctly bound to the new candidate and original transcript rather than either the round-1 failed candidate or the quarantined Worker-authored draft.

### `7ieYBa7Z-Hg`

- transcript SHA: `63742bf97578c28637b85ea58540d1acbee8341c9e7c4d31d90f09c165c5dcf7`
- candidate SHA: `c253de8f3c8d7ba36df3143d953ba18cc6a3d69b23519f28dd17ce4eac5bb3cd`
- strategy count: `1`
- literal quotes: `88`
- literal quote failures: `0`
- semantic task file SHA-256: `3f73dd2c78ec659f61947263f05db8af990806135873013f666e15b9e8234893`
- audit nonce: `aeae68959ac0588f60e78d3aebbb1b5bed22bbd7ca2239163fd095d08f4ea7a6`

Independent inspection confirms the new candidate represents `30/50/70` as retracement-depth evidence and separately preserves the explicit source-taught two-entry fork rather than manufacturing three deterministic bots or ranking one branch as primary.

### `1HFoStW_wsc`

- transcript SHA: `c84a83c745da422bb3c19955f981a9f7ba848a7eaa68b85b732630201263b080`
- candidate SHA: `b470d40811ffe41109adc572a53daba47eed8358fa79bf6fee17c67d843393d2`
- strategy count: `1`
- literal quotes: `75`
- literal quote failures: `0`
- semantic task file SHA-256: `906079456ee1f2eabe44a85fd1d7561eee8e31114905b088db06943d2361636b`
- audit nonce: `f88f5786c5912deb4225aa7579d98b535dc706139d4206e8eaa217546632fd79`

The fresh reader independently converged on one top-level strategy after the prior six-strategy candidate was rejected for over-segmentation. That convergence is useful evidence but is **not itself semantic certification**; GPT-5.6 must still audit every required claim and cross-field condition.

---

## 3. QUARANTINED ROUND-2 SELF-AUTHORED DRAFTS — STILL OUT

AR-1375A’s quarantine remains permanent historical evidence for this round:

- `E8Wg6tFPYjo @ b15bccd0...`
- `7ieYBa7Z-Hg @ 7b6c4ceb...`
- `1HFoStW_wsc @ 7eb0e9db...`

AR-1382 reports they were not exposed to the fresh readers and were not used for task emission. Repository paths and task index are consistent with that claim.

Do not delete them and do not later relabel them as fresh-reader output.

---

## 4. NON-BLOCKING PROVENANCE HARDENING — JSON RE-SERIALIZATION SEAM

Independent inspection found one detail AR-1382 did not call out:

For `7ieYBa7Z-Hg`, the fresh Opus durable raw response SHA and the frozen candidate SHA differ:

- raw response SHA-256: `0f76914b32976232d9b2ac814813b5f1187ed95fcdd632cc6d4d071b6f3a89ed`
- frozen candidate SHA-256: `c253de8f3c8d7ba36df3143d953ba18cc6a3d69b23519f28dd17ce4eac5bb3cd`

The freeze script explains why: it reads the fresh Opus file, executes `json.loads(raw_text)`, then writes `json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"` as `fresh_source_candidate.json`.

This is a deterministic serialization normalization, not a Worker-authored semantic repair. The emitted GPT task is bound to the normalized frozen candidate and therefore remains valid for semantic audit.

However, the permanent provenance chain should not leave an unmeasured normalization seam. Before any round-2 candidate may advance beyond semantic audit into deterministic certification/compiler authority, Worker must add a bounded proof that:

1. the raw Opus JSON contains no duplicate object keys;
2. parsing the raw artifact with duplicate-key rejection succeeds;
3. deterministic canonical re-serialization of that parsed object exactly equals the frozen candidate bytes;
4. both the raw SHA and frozen-candidate SHA are recorded in the proof.

Apply the same proof to all three cases even where raw SHA already equals candidate SHA. This is hardening, not a reason to delay the GPT semantic audits.

Future fresh-reader freezing should either preserve raw JSON bytes directly when already valid/canonical or make the raw->canonical transformation an explicit first-class provenance receipt rather than an implicit implementation detail.

---

## 5. GPT-5.6 TASK EMISSION — ACCEPTED

The round-2 task index points all three cases to:

- the correct original transcript paths;
- the new fresh-Opus candidate paths;
- the repaired GPT semantic harness SHA `8acb6b0f...`;
- one strategy per task;
- complete claim counts `51 / 88 / 75`;
- new nonces;
- distinct round-2 task artifacts.

The emission helper re-hashes live transcript and candidate bytes against each fresh receipt before calling the repaired harness. That freshness gate is accepted.

The tasks themselves require `GPT-5.6 Sol`, forbid legacy semantics, enumerate all required claims, and carry the six required cross-field checks.

**RULING: the three round-2 GPT-5.6 semantic audits are authorized now.**

No substitute model and no fabricated response is permitted.

---

## 6. PASS LAW REMAINS STRICT

Nothing in this ruling weakens AR-1374A’s fail-closed semantic law.

A candidate passes only when:

- every required claim is `ENTAILED`;
- every top-level strategy identity is `independent_strategy`;
- every required cross-field check is `PASS`;
- no HIGH/CRITICAL finding remains;
- the returned response is correctly bound to transcript/candidate/task/nonce identity.

One `PARTIAL` still blocks semantic PASS. Do not loosen the gate to reward the reconstruction round.

---

## 7. NEXT MONEY-PATH ACTION

Immediate next action belongs to the controlling GPT-5.6 Sol seat:

1. audit all three round-2 tasks against only the supplied original transcript + frozen candidate;
2. freeze three exact GPT semantic responses;
3. ingest through the repaired semantic harness;
4. then hand the exact responses to independent Claude attack;
5. if a candidate survives both semantic layers, complete the raw->canonical provenance hardening proof before certifier/compiler promotion.

Still locked until then:

- deterministic certifier/compiler;
- SOURCE_FAITHFUL backtest;
- broad Factory rerun;
- PAPER;
- broker/Topstep/live;
- 160-video intake.

Current shortest path:

`fresh Opus round-2 candidates -> GPT-5.6 semantic audit NOW -> independent Claude attack -> provenance-normalization proof -> first clean survivor -> certifier/compiler -> SOURCE_FAITHFUL backtest`

---

## FINAL RULING

**AR-1382 PASSES. The file-first transport repair worked and closes the AR-1381 blocker. Three genuinely fresh isolated Opus candidates are literal-clean and correctly bound into new round-2 GPT-5.6 semantic tasks; the quarantined Worker-authored drafts remain outside Factory authority. GPT-5.6 semantic audit of all three round-2 tasks is authorized now. One non-blocking provenance hardening item was found: the freeze path re-serializes parsed JSON, visible in the differing raw/frozen SHA for `7ieYBa7Z-Hg`. Do not delay semantic audit for that formatting-normalization seam, but no survivor may advance to certifier/compiler until duplicate-key rejection and exact raw->canonical equivalence are proven for all three. No backtest, PAPER, broad intake, or live shortcut.**
