# GPT EXTERNAL ADVISOR RULING — AR-1379A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 6deba50ef1f5004c9803a436e4ddfdce79430f4a`  
**Prior controlling ruling:** AR-1378A @ `47aeefa916d34c08e8a9c76d6d7f488e2e4fb71f`  
**Reports graded:** AR-1385, AR-1386, AR-1387

## DISPOSITION

**AR-1385 = PASS AS A BOUNDED HARNESS-REPAIR/INDEPENDENT-ATTACK REPORT, WITH ITS F-1 CRITICAL ESCALATION ACCEPTED.**  
**AR-1386 = PASS. THE 7ie/1HF UNRESOLVED-EVIDENCE MANIFESTS ARE ACCEPTED.**  
**AR-1387 = PASS FOR THE FRESH E8 ROUND-3 CANDIDATE AND WORKER-SIDE TASK PRODUCTION, BUT THE CURRENT V1 SEMANTIC TASK IS HOLD / DO-NOT-AUDIT.**  
**E8 DOES NOT NEED ANOTHER OPUS RECONSTRUCTION. FREEZE THE CURRENT ROUND-3 CANDIDATE SHA `b50729b9...`; ONLY RE-EMIT ITS GPT TASK AFTER THE CONTRACT-BINDING REPAIR.**  
**THE NEXT GPT-5.6 AUDIT MUST NOT RUN AGAINST THE CURRENT V1 TASK BECAUSE THE TASK/RECEIPT CANNOT PROVE WHICH SEMANTIC CONTRACT VERSION GRADED IT.**

The Worker correctly separated a good prompt-text repair from a still-open provenance problem instead of claiming the repair was stronger than the evidence permits. The first real E8 Round-3 candidate is also materially clean at the three targeted Round-2 hazard locations and passed literal verification `73/73` after one preserved punctuation-failure attempt and one clean fresh retry.

GitHub reports no status checks and no workflow runs at current Worker HEAD.

**CI: NONE; tests and model-audit evidence are local-only plus independent repository inspection.**

---

## 1. AR-1385 — PROMPT REPAIR IS REAL, BUT F-1 IS A TRUE LOAD-BEARING BLOCKER

Independent repository inspection confirms the tracked repaired harness now contains the eight-point AR-1378A authoring contract, including:

- `setup[]` may legally carry clearly framed source-grounded non-executable context;
- non-executable material is default-denied outside `setup[]`;
- targets must be actual target destinations/rules, not generic R:R commentary;
- stop must be an actual stop and must not silently substitute invalidation;
- variants record source-grounded alternatives / what differs and are not required to be complete standalone strategies absent stronger authority;
- honest source gaps are not fabrication and are never permission to invent;
- directional symmetry distinguishes broad direction/bias from a complete mirrored executable trigger;
- atomic quote binding remains strict.

The repair is scope-locked to prompt semantics. AR-1385's independent grader found no mutation to claim enumeration, response validation, schemas, or the original AR-1377 invariants; the original regression suite remains intact in test logic.

### Accepted closed findings

- F-2 anti-invention wording drift: CLOSED.
- F-3 variants-exemption conditioning: CLOSED.
- A1 invented-container escape: CLOSED by default-deny language.
- F-4 non-schema half: CLOSED; the prompt now states which three cross-field checks are governed by the new contract and does not pretend all six have new taxonomy rules.

### F-1 — ACCEPTED AS CRITICAL

The current harness still builds `task_sha256` from a task core that contains:

- candidate hash;
- transcript hash;
- nonce;
- auditor/model identity;
- strategy IDs;
- required claims;
- cross-field names;

but **does not contain the semantic authoring-contract hash or exact prompt-contract identity**.

`render_prompt()` inserts `ROLE_ASSIGNMENT_CONTRACT` only after `task_sha256` has already been computed.

Therefore the current E8 Round-3 task can truthfully identify the candidate/transcript/task yet cannot prove whether GPT saw:

- the old defective undefined role taxonomy; or
- the corrected AR-1378A contract.

The external `index.json` records a prompt-file SHA, but that is not an ingest-enforced join key and does not reach the response/receipt identity. It is useful evidence, not sufficient permanent money-path binding.

**RULING: do not execute the controlling GPT-5.6 semantic audit on the current V1 task. Close F-1 first.**

---

## 2. AUTHORIZE ONE BOUNDED CONTRACT-BINDING SCHEMA REPAIR

Worker is authorized to extend the already repaired tracked harness on the Worker branch. Do not restart from the old `8acb6b0...` detached pin and do not redesign semantic policy.

### Required V2 identity binding

The new task must carry, inside the object hashed by `task_sha256`, at minimum:

- `semantic_contract_id`, a stable explicit identifier for the AR-1378A semantic contract version; and
- `semantic_contract_sha256 = sha256(ROLE_ASSIGNMENT_CONTRACT exact UTF-8 bytes)`.

Use a new task schema identity, e.g. `tf-gpt56-semantic-audit-task-v2`, rather than silently changing the meaning of V1.

`render_prompt()` must fail closed unless the task's contract hash equals the live `ROLE_ASSIGNMENT_CONTRACT` hash it is about to render, and the rendered BOUND IDENTITY section must display the contract ID/hash.

### Response and receipt binding

The GPT response must echo the exact `semantic_contract_id` and `semantic_contract_sha256` and response validation must require exact equality with the bound task. Use a V2 response schema rather than silently extending V1 semantics.

The ingest receipt must also record the same contract ID/hash. Use a V2 receipt schema for new tasks.

This creates the deterministic join:

`candidate + transcript + semantic contract -> task_sha256 -> GPT response identity -> ingest receipt`

A response generated against a task with another contract hash must be refused.

### Preserve historical V1 evidence

Do not rewrite Round-1/Round-2/V1 tasks or receipts. They remain historical evidence under their exact frozen hashes. The new tracked harness may either:

1. be V2-only for newly emitted tasks while historical V1 is read through the old pinned harness; or
2. support explicit V1/V2 branches without weakening either.

Prefer the smaller implementation that cannot accidentally reinterpret old V1 artifacts as V2.

---

## 3. F-4 SCHEMA HALF — DO NOT OVERENGINEER IT INTO A BLOCKER

AR-1385 also escalates a possible `contract_points_applied` response field.

**RULING: this is NOT required before the E8 live audit.**

Reason: a model can mechanically echo a contract-point label without actually applying the law, so that field would improve explainability but would not cryptographically prove semantic reasoning. The important deterministic requirement is that the exact contract itself is bound into task/response/receipt identity.

For the first V2 live audit:

- prompt reasons should explicitly cite the applicable contract rule when a contract-governed check is non-PASS;
- the mandatory independent Claude challenge remains the behavioral control on whether GPT actually applied the contract correctly.

If the first V2 live audit shows ambiguity that a structured `contract_points_applied` field would materially resolve, authorize it then. Do not spend another schema cycle now for ceremonial metadata.

---

## 4. F-5 — FIX THE TEST CLAIM, NOT THE GATE

The grader is correct that a static fixture cannot prove how a live GPT-5.6 model will semantically judge a planted role violation. A hand-authored response passed through `_validate_response()` only tests schema/fail-closed mechanics, not model cognition.

Therefore revise the evidence language:

- static fixtures prove prompt contract presence, task/response binding, exact claim coverage, and ingest fail-closed behavior;
- the **first real V2 E8 GPT-5.6 audit + mandatory independent Claude challenge** is the live behavioral test of whether the role contract actually changes auditor judgment correctly.

Do not weaken the strict PASS law.

---

## 5. REQUIRED REPAIR PROOF / ATTACK

Before the V2 E8 task is accepted, independently prove all of the following:

1. **Old defect reproduction:** with nonce/candidate/transcript held fixed, old V1 task identity is unchanged when only prompt-contract text changes.
2. **V2 discrimination:** with nonce/candidate/transcript held fixed, changing one byte of `ROLE_ASSIGNMENT_CONTRACT` changes `semantic_contract_sha256` and therefore changes `task_sha256`.
3. **Render refusal:** task contract hash A + live contract B => prompt rendering fails closed.
4. **Response refusal:** response echoes wrong contract ID/hash => ingest refuses.
5. **Receipt proof:** valid ingest records the exact V2 contract ID/hash.
6. **Role prompt controls remain:** legal non-executable `setup[]` context is permitted; same material outside `setup[]` is forbidden; invalidation-as-stop and R:R-as-target rules remain present.
7. **AR-1377 claim-enumeration controls remain intact**, including every `*_transcript_quote` sibling field.
8. **No weakening of strict PASS law:** every claim ENTAILED, all strategy identities independent, every required cross-field PASS, no HIGH/CRITICAL.

Independent grader/attack is required because this changes load-bearing audit identity.

---

## 6. AR-1387 — E8 ROUND-3 FRESH CANDIDATE ACCEPTED AND FROZEN

The fresh E8 candidate is accepted as the next semantic-audit input at:

`candidate_sha256 = b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`

Measured receipt facts:

- `fresh_reader: true`;
- `prompt_source: task_file_only`;
- legacy semantics not visible;
- prior candidate JSON not visible;
- prior report prose not visible;
- file-first durable delivery;
- distinct from Round-2 candidate;
- one strategy;
- `73` literal quotes;
- `0` literal failures.

Attempt 1's one-character comma insertion was correctly preserved as failed evidence rather than hand-edited. Attempt 2 used a new isolated reader and passed the literal validator. This is acceptable and bounded; there is no unbounded retry-until-green loop.

### The three targeted Round-2 hazards are actually fixed

Independent inspection confirms:

- the buy-side stop row now states only the source-supported wick placement and no transcript-wide negative claim;
- the Fibonacci drawing step no longer claims to be the unique/only narrated procedure;
- sell-side and buy-side target statements are now scoped to their respective worked examples rather than generalized to an abstract far-side endpoint.

The already accepted trading spine remains materially intact.

### One new item for the live semantic audit to inspect

The Round-3 candidate assigns target `priority: 1` to the GBP/AUD sell-side worked-example target and `priority: 2` to the NZDUSD buy-side worked-example target.

Those targets are direction/worked-example-specific rather than two simultaneously competing destinations, so this is **not pre-judged here as a defect**. But the source does not rank sell-side ahead of buy-side. The V2 GPT audit must explicitly determine whether the numeric priority field is merely schema ordering or an invented semantic ranking. Do not silently normalize it before audit and do not hand-patch the frozen candidate.

### Current V1 task disposition

Current emitted V1 task:

- internal `task_sha256 = d5117ba229c03d15d711db49640d0e7b52ac7ea0eee6b3d53124650fc6a833c9`;
- candidate SHA `b50729b9...`;
- nonce `99378647...`;
- 73 claims;
- prompt file independently hashed in the index.

**Historical status only. DO NOT AUDIT THIS V1 TASK.**

After the V2 contract-binding repair passes independent attack, re-emit from the **same frozen candidate bytes** with a fresh nonce and new V2 task identity. Do not spend another Opus read.

---

## 7. AR-1386 — VISUAL-INTELLIGENCE MANIFESTS ACCEPTED

### `7ieYBa7Z-Hg`

The manifest correctly separates three unresolved questions:

1. whether any true default/top-level stop exists outside the two explicitly taught method-conditional stops, versus whole-POI invalidation only;
2. how conditional targets arbitrate only in the overlap case where more than one source condition is simultaneously true;
3. whether a fully mirrored short-side trigger/trailing implementation is visibly demonstrated.

It does not ask Visual Intelligence to re-decide text facts already settled and does not invent an answer. The source's live-chart/cursor density makes #3 a plausible visual-evidence target.

### `1HFoStW_wsc`

The manifest correctly isolates:

1. which VWAP-touch candle reading, if any, actually satisfies the required price-action confirmation;
2. deterministic long-vs-short trigger mapping;
3. execution timeframe / anchor selection needed for compilation.

The transcript has almost no chart-manipulation language, so the manifest correctly marks visual resolution as lower probability rather than pretending video vision is guaranteed to solve the missing rules.

**Lane C is CLOSED as a question-manifest lane. No Visual Intelligence answer is authorized to be guessed. A future visual pass must cite exact frame/time evidence and may also legitimately return `NOT_SHOWN / UNRESOLVED`.**

---

## 8. NEXT EXECUTION ORDER

### Lane A — blocking, smallest first

1. implement V2 semantic-contract identity binding;
2. run permanent deterministic proof suite;
3. independent adversarial grader attacks the exact repair;
4. if clean, freeze repair commit/blob identity.

### Lane B — immediately after Lane A

1. keep E8 candidate `b50729b9...` frozen unchanged;
2. re-emit a **V2** GPT-5.6 task with fresh nonce from that exact candidate/transcript;
3. return exact V2 task/prompt identity to the GPT-5.6 Sol seat;
4. GPT-5.6 executes the actual semantic audit;
5. Worker ingests exact response;
6. independent Claude challenge is mandatory.

### Lane C — no additional text reconstruction

Keep both unresolved-evidence manifests frozen for the future Visual Intelligence lane. Do not burn another text-only Opus round on 7ie or 1HF.

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
- invented resolution of source gaps;
- auditing E8 against the current unbound V1 Round-3 task.

---

## FINAL RULING

**AR-1385/AR-1386/AR-1387 are accepted as honest, useful work. The semantic role-contract prompt repair is substantively correct and independently attacked, the E8 Round-3 fresh candidate is literal-clean and fixes the three targeted binding hazards, and the 7ie/1HF Visual Intelligence question manifests are well-bounded. However AR-1385's F-1 is a real CRITICAL provenance seam: the current V1 task/response/receipt identity does not bind the repaired semantic contract. Therefore the already-emitted E8 V1 task is HOLD / DO-NOT-AUDIT. Authorize one bounded V2 contract-binding repair, independently attack it, then re-emit a fresh V2 task from the SAME frozen E8 candidate and proceed immediately to GPT-5.6 audit + independent Claude challenge. No new E8 Opus reconstruction is needed. F-4's proposed contract-points response metadata is deferred as non-blocking; the first real V2 audit plus Claude attack is the necessary behavioral test.**