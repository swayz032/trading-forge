# GPT EXTERNAL ADVISOR RULING — AR-1380A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Prior controlling ruling:** AR-1379A @ `06d4bf0d9ef23d158a03a82bf884048ab3813b0e`  
**Worker report graded:** AR-1388  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**GPT-5.6 V2 audit response commit:** `449336c73f0643e802e25fa69b35794f13b364ec`

## DISPOSITION

**AR-1388 = PASS.**  
**THE AR-1379A V2 SEMANTIC-CONTRACT IDENTITY BINDING IS ACCEPTED FOR THIS CALIBRATION LANE.**  
**THE PREVIOUS F-1 CONTRACT/PROMPT PROVENANCE BLOCKER IS CLOSED.**  
**THE SAME FROZEN E8 ROUND-3 CANDIDATE WAS CORRECTLY RE-EMITTED AS V2; NO NEW OPUS RECONSTRUCTION OCCURRED.**  
**GPT-5.6 SOL HAS NOW EXECUTED THE EXACT V2 E8 SEMANTIC AUDIT. RESULT: FAIL.**  
**NEXT REQUIRED ACTOR: WORKER INGEST + INDEPENDENT CLAUDE CHALLENGE OF THE EXACT GPT RESPONSE.**  
**NO CERTIFIER / COMPILER / BACKTEST AUTHORITY EXISTS YET.**

GitHub exposes no status checks and no workflow runs for the reported Worker HEAD.

**CI: NONE; tests and model-audit evidence are local-only plus independent repository inspection.**

---

## 1. AR-1388 — V2 CONTRACT BINDING PASS

Worker implemented the V2 identity surface additively while preserving V1 historical behavior. Independent grade at repair commit `81abf5cb` returned **Band 7 VERIFIED / PASS WITH FINDINGS** and attacked the actual identity surface rather than only checking prompt substrings.

The first independent grade found four meaningful V2 issues and two low hygiene issues. Worker then closed all six in the same wave:

- F-A: semantic contract human-readable ID is now checked against live `SEMANTIC_CONTRACT_ID`, not merely echoed;
- F-B: ingest now re-renders the expected prompt from the bound task/transcript/candidate, hash-compares it with the on-disk delivered prompt, and records `prompt_sha256` in the receipt;
- F-C: V2 emission refuses to overwrite a non-V2 historical task in the same output directory;
- F-D: the vacuous V1-untouched proof was replaced with a real base-object / AST comparison;
- F-E/F-F: V2 response validation now fails closed cleanly on missing fields and requires strict JSON booleans.

Independent repository inspection of the current Worker code confirms the load-bearing post-grade repairs exist:

1. `build_task_v2()` binds both `semantic_contract_id` and `semantic_contract_sha256` inside the object hashed into `task_sha256`.
2. `render_prompt_v2()` refuses both a contract-hash mismatch and a contract-ID mismatch.
3. `_validate_response_v2()` requires the response to echo the exact V2 task identity and uses strict boolean validation.
4. `ingest_v2()` verifies task hash, candidate hash, transcript hash, live contract hash, live contract ID, and the exact re-rendered prompt bytes before response ingest.
5. the V2 receipt records contract ID/hash and `prompt_sha256`.
6. strict semantic PASS law remains unchanged: every claim ENTAILED, every top-level strategy independent, every required cross-field PASS, and no HIGH/CRITICAL finding.

Worker did not dispatch a second independent grader after implementing the first grader's exact repro-driven fixes. I do **not** require another grader cycle before the present E8 audit because the fixes are narrow, directly inspectable, and each closes the grader's own concrete attack. The mandatory independent Claude challenge on the live E8 semantic result remains the behavioral check.

**Disposition: Lane A CLOSED for this calibration.**

---

## 2. CURRENT E8 V2 TASK IDENTITY — ACCEPTED AND FROZEN

The accepted V2 task is:

- video: `E8Wg6tFPYjo`
- candidate SHA-256: `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`
- transcript SHA-256: `62036e6e62ae927c165a7d501e20ae0fcd15684933cd4419c5832ba74756ec67`
- V2 internal task SHA-256: `1b524bd6500238057e2bfa6d835b9dcaf37e8c00d93dd4b9039932cb41786380`
- audit nonce: `f27fb0987d337decb8e5d6434983a75f778718a7699e97b6b628ee1bed438e03`
- semantic contract ID: `AR-1378A-SS6-ROLE-ASSIGNMENT-CONTRACT-V1`
- semantic contract SHA-256: `79b0d960fe9f40d3c93a3f573a32a994a4afbae696dd831b41a11d1aaae4a9de`
- claim count: `73`
- strategy count: `1`

The external index's `semantic_task_sha256=38e2...` is the serialized task-file byte hash. It is not a contradiction with the task object's internal `task_sha256=1b524...` join key.

The prior V1 task remains historical `HOLD / DO-NOT-AUDIT` evidence and was not overwritten.

**Freeze this V2 task/prompt directory now. Do not call `emit-v2` into this directory again.**

Independent inspection found one residual permanent-hardening seam: current `emit_v2()` refuses cross-schema overwrite but can still overwrite a pre-existing **V2** task in the same directory. That does not invalidate the already frozen task above and does not block its current ingest/challenge. For all future V2 emissions, use a new immutable output directory / task identity. Harden same-schema overwrite prevention before broad unattended Factory intake, but do not interrupt the current money path for another infrastructure cycle.

---

## 3. GPT-5.6 SOL ROUND-3 V2 AUDIT — EXECUTED

Exact response artifact:

`advisor-reports/gpt56-semantic-audits-round3-v2/E8Wg6tFPYjo-GPT56-SEMANTIC-AUDIT-RESPONSE-ROUND3-V2-2026-08-20.json`

Committed at:

`449336c73f0643e802e25fa69b35794f13b364ec`

Bound response identity exactly matches the accepted V2 task above.

### Result

**VERDICT: FAIL**

- strategy identity: `s0 = independent_strategy`
- claims: **64 ENTAILED / 9 PARTIAL / 0 NOT_ENTAILED / 0 UNCERTAIN**
- cross-field checks: **3 PASS / 2 FAIL / 1 UNRESOLVED**
- HIGH findings: **2**

The three specific Round-2 hazards targeted by AR-1378A are fixed. This FAIL is caused by newly exposed Round-3 representation problems, not by those old defects recurring.

---

## 4. HIGH FINDING A — ORDERED ENTRY SEQUENCE CROSS-SPLICES OPPOSITE-DIRECTION EXAMPLES

The frozen candidate places these two rows consecutively in one executable `entry_sequence`:

- `entry_sequence[10]`: Fibonacci drawing procedure explicitly scoped to the **NZDUSD buy-side worked example** — start at the low and drag to the high;
- `entry_sequence[11]`: 71% short-position entry explicitly scoped to the **GBP AUD sell-side worked example**.

At the same time, `source_gaps` explicitly says the GBP AUD sell-side Fibonacci anchor points are not narrated.

Therefore the ordered executable sequence effectively says:

`buy-side Fibonacci drawing -> sell-side short entry`

That is not one source-taught generic trigger path. It cross-splices two different worked examples to fill a missing sell-side rule.

Under semantic-contract rule 6, honest disclosure of a source gap is allowed, but it cannot be followed by an executable container that silently bridges the missing rule with the other direction's example.

**Cross-field:** `trigger_vs_source_gaps = FAIL`  
**Severity:** HIGH

Correct future representation, if this finding survives Claude challenge:

- keep the truly common strategy spine direction-neutral;
- keep buy-side and sell-side Fibonacci/entry/stop/target geometry in correctly scoped directional alternatives;
- do not use the buy worked example to fill an unresolved sell-side Fibonacci anchor procedure;
- unresolved source facts remain unresolved until admissible evidence resolves them.

---

## 5. HIGH FINDING B — TARGET PRIORITIES CREATE AN UNSOURCED DIRECTIONAL RANKING

Round-3 targets are semantically cleaner than Round 2 because each is scoped to its own worked example:

- sell-side GBP AUD target = low of Fibonacci range;
- buy-side NZDUSD target = high of Fibonacci range.

However the structured rows are assigned:

- sell target `priority: 1`
- buy target `priority: 2`

These are not two sequential targets competing inside the same trade. They are opposite-direction worked-example rules. The source does not teach that the sell-side target outranks the buy-side target.

A deterministic downstream consumer can reasonably interpret `priority: 1` / `priority: 2` as precedence. The ranking is therefore not source-taught.

**Cross-field:** `target_definition_conflicts = FAIL`  
**Severity:** HIGH

If Claude confirms, the future representation must encode the directional conditions explicitly and avoid artificial precedence; co-equal / conditional representation is required unless source evidence actually ranks targets.

---

## 6. NINE ATOMIC QUOTE-BINDING PARTIALS

Strict contract rule 8 remains active: each claim's own attached quote must fully entail that whole attached claim. Facts elsewhere in the transcript do not rescue an under-bound row.

Nine rows are PARTIAL:

1. `instrument_classification` — quote supports broad applicability + forex context, not the whole compound assertion that both worked examples are forex pairs on 15m;
2. `setup[0]` — quote supports applicability + weekly opportunities, not the added 15-minute characterization;
3. `setup[25]` — quote supports copying entry/TP/SL parameter values but stops before the separate execution-platform destination statement;
4. `entry_sequence[0]` — quote supports premium/discount premise but not the added `first checklist item` assertion;
5. `entry_sequence[3]` — quote supports sweep-before-trade but not the added `second checklist item` assertion;
6. `entry_sequence[10]` — quote supports low-to-high Fibonacci drawing but not the full added worked-example/framing rationale;
7. `entry_sequence[11]` — quote supports a short 71% entry but not the full GBP-AUD / fourth-checklist compound claim;
8. `confluences[0]` — quote supports Fib/FVG alignment but not the added assertion that it is the extra confluence omitted from the checklist;
9. `confluences[4]` — quote supports untested relative equal lows but not the added `downside liquidity objective` role in the claim name.

These are mostly representation/binding defects rather than disagreement with the educator's broader transcript. They still block semantic PASS under the frozen law.

---

## 7. DIRECTIONAL SYMMETRY — UNRESOLVED, NOT FABRICATED

`directional_symmetry = UNRESOLVED`.

The source does demonstrate both buy-side and sell-side use, so this is not the old 1HF problem of broad bidirectional framing with only one concrete side. But exact executable geometry is still incomplete in text:

- sell-side Fibonacci anchor procedure is not narrated;
- buy-side stop is narrated only as moving the stop to `that wick`, without a textual definition of that wick's Fibonacci/structural identity.

The candidate correctly records these as source gaps instead of inventing them.

Under contract rule 7 this is **source incompleteness, not fabrication**. It is nevertheless a compile-completeness blocker until admissible evidence resolves it or the compiler can lawfully refuse only the unresolved directional branch.

This is now a strong candidate for a future E8 Visual Intelligence question manifest if Claude confirms the gap. Do not force another text-only reader to invent the missing chart geometry.

---

## 8. REQUIRED WORKER / CLAUDE ACTION NOW

Worker must fetch the **exact** GPT response artifact from commit `449336c73f0643e802e25fa69b35794f13b364ec` and ingest it through the unmodified accepted V2 harness against the frozen V2 task/prompt/candidate.

Expected mechanical status:

`GPT56_SEMANTIC_AUDIT_FAIL`

Expected fail-closed reasons must reconcile to:

- 9 PARTIAL claims;
- `trigger_vs_source_gaps = FAIL`;
- `target_definition_conflicts = FAIL`;
- `directional_symmetry = UNRESOLVED`;
- 2 HIGH findings.

Then dispatch independent Claude challenge. Claude must independently inspect original transcript + frozen candidate + bound V2 task + exact GPT response and classify:

- each HIGH finding: `CONFIRMED / DISPROVED / PARTIAL-UNRESOLVED`;
- each non-PASS cross-field check;
- all 9 PARTIAL rows, with special attention to whether the atomic law treats the disputed wording as substantive claim content versus harmless scope metadata;
- at least 8-10 ENTAILED positive-control rows across setup, entry, stop, target, and management;
- the V2 contract identity/prompt receipt join after ingest.

Claude must specifically attack two questions rather than accepting GPT framing:

1. Does `entry_sequence` semantically mean an executable ordered sequence such that buy-side step 10 followed by sell-side step 11 is genuinely an invalid cross-splice, or is there stronger schema authority that makes these rows merely an ordered evidence catalog?
2. Does `targets[].priority` carry semantic precedence downstream, or is it defined by stronger authority as non-semantic enumeration? Inspect actual schema/compiler/certifier usage before confirming the HIGH.

If either HIGH is disproved by stronger written/code authority, stop and return the smallest exact disagreement for GPT adjudication. Do not rebuild first.

If the FAIL survives, current candidate SHA remains rejected and the next authoring/evidence move must be based only on confirmed defects.

---

## 9. AR-1388 SIDE ISSUES

### AGENT-LOGS.md guard conflict

Worker disclosed that packet edit scope prevented writing repo-root `AGENT-LOGS.md` and did not bypass the guard.

**RULING:** no guard widening is required merely to satisfy logging ceremony. For a packet whose authorized edit scope rejects `AGENT-LOGS.md`, a durable `docs/replay-results/worker-advisor-reports/...` handoff plus explicit disclosure of the guard rejection satisfies the intent for this session. Do not weaken a load-bearing edit guard to write a log.

Future onboarding can document this exception explicitly so workers do not waste a cycle attempting an unauthorized log write.

### F-G/F-H inherited low-tier laxities

- non-strict `coverage_statement` prose;
- lone-surrogate `sha256_text` crash behavior.

Accepted as nonblocking residual hardening for now. Exact claim coverage is already mechanically enforced independently of `coverage_statement`; lone-surrogate input fails closed rather than producing a false PASS. Do not open another infrastructure packet before the E8 Claude challenge.

---

## 10. MONEY PATH

Current shortest path:

`V2 contract binding CLOSED -> E8 V2 GPT audit COMPLETE: FAIL -> independent Claude challenge NOW -> adjudicate exact remaining defects -> if source-resolvable, fresh candidate identity; if chart-only, Visual Intelligence evidence -> literal clean -> V2 GPT audit -> Claude challenge -> first clean survivor -> deterministic certifier/compiler -> SOURCE_FAITHFUL backtest.`

The Factory still may not advance a failing candidate merely because the remaining defect count is small.

---

## LOCKS

Still forbidden:

- certifier/compiler promotion;
- SOURCE_FAITHFUL backtest;
- broad Factory rerun;
- 160-video intake;
- PAPER;
- broker/Topstep/live;
- candidate hand-patching;
- invented source-gap resolution;
- rewriting/re-emitting the frozen E8 V2 task directory;
- another blind text-only E8 reconstruction before Claude adjudicates the exact V2 FAIL.

---

## FINAL RULING

**AR-1388 PASSES. The V2 semantic-contract/prompt identity chain is now sufficiently bound for the calibration money path, and the exact E8 Round-3 V2 GPT-5.6 audit has been executed. E8 remains one real independent strategy, and its previous three targeted Round-2 defects are repaired, but the Round-3 candidate still FAILS: nine atomic-binding rows are under-bound, one executable entry sequence cross-splices buy-side Fibonacci geometry into a sell-side short entry, target priorities impose an unsourced directional ranking, and full text-only directional geometry remains unresolved. Worker must ingest the exact response and Claude must independently attack these findings before any new reconstruction or Visual Intelligence claim is authorized.**
