# GPT EXTERNAL ADVISOR RULING — AR-1303A

## VERDICT

**AR-1303 = SAFE BLOCK / PASS ON STOP DISCIPLINE.**

The worker correctly stopped **before spending row 1**. No frozen Opus call ran, no attempt receipt was created, no retry occurred, and the frozen experiment remains **8 READY / 0 SPENT**.

The stop exposed two directly execution-blocking seams in the live G2 handshake:

- **F29 — PRE-CALL PERMIT DEADLOCK:** the G2 PreToolUse guard requires the row's frozen `.permit.json` to exist before it will perform its trusted `claim -> dispatch` transition, while the ordinary Worker-1 lane guard categorically self-protects the entire frozen receipt namespace from Worker writes. No sanctioned permit issuer currently bridges those two laws.
- **F30 — POST-CALL RETURN-CAPTURE DEADLOCK:** the durable bridge's success state is `RAW_RETURN_CAPTURED`, which requires the model return to be persisted as the create-only `.raw + .completion` pair after a dispatch. The live Worker hook registration currently contains SessionStart and PreToolUse only; there is no trusted post-Agent hook that can place the actual tool return into the self-protected receipt namespace. Fixing F29 alone would therefore risk spending Opus row 1 and then stranding its answer at `NATIVE_TASK_DISPATCHED`.

A third authority fact follows from those two findings:

- **F31 — REPAIR AUTHORITY:** the live guard settings, Worker guard manifest, guard toolbox, session marker surfaces, and receipt namespace are deliberately self-protected. **Ordinary Worker-1 is not authorized to repair the mechanism that guards Worker-1.** Do not send the same ordinary seat back to edit its own guard until it passes.

This is not a reason to reopen the broad control-plane program. It is one narrow execution-handshake repair caused by the first real attempt to cross the G2 doorway.

---

## 1. INDEPENDENT GITHUB FINDINGS

### Worker source-of-truth tip

Graded Worker-1 tip:

`bba03d7c15bcadf0fb65f84dc21be22253ba502c`

Compared with the previously graded AR-1302 tip:

`7a1f78d9968c93f66b66fdf0b3a77cc1c7a4c7d1`

GitHub shows exactly **one commit ahead** and exactly **one added file**:

`docs/replay-results/worker-advisor-reports/AR-1303-WORKER1-PERMIT-NAMESPACE-CONTRADICTION-2026-08-17.md`

No production code, guard configuration, frozen queue, prompt transport, manifest, or receipt artifact changed in AR-1303.

GitHub exposes no commit-status checks and no workflow runs for this tip. Any worker-local preflights are local evidence, not CI.

### Frozen state independently re-read at the Worker tip

The frozen queue still contains the original eight rows in order, `max_attempts_per_condition = 1`, and:

`"attempts": {}`

The frozen receipt directory contains only:

`README.md`

The native-call manifest still has:

- `queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`
- `call_count = 8`
- all eight `model = opus`
- all eight `subagent_type = general-purpose`
- the same frozen permit paths, prompt hashes, and native-call hashes authorized by AR-1302A.

Prompt transport still reports `row_count = 8` and the reviewed prompt/native-call hashes.

Therefore the authoritative experiment state after AR-1303 is:

**8 READY / 0 SPENT.**

---

## 2. F29 — PRE-CALL PERMIT DEADLOCK IS CONFIRMED

The worker's report is consistent with the actual architecture.

The trusted pre-call transition script explicitly exists to perform:

`CLAIM -> DISPATCH`

before the model call is allowed. It calls the existing durable ledger and bridge law rather than reimplementing receipt semantics. A landed claim remains spent if dispatch then fails.

But the live G2 guard validates an already-existing frozen permit before invoking that transition.

At the same time, the Worker manifest states that the pinned lane boundary's self-protection is evaluated before packet edit scope, and the Worker report measured the expected `SELF_PROTECTED` refusal when it attempted the exact frozen permit path.

The permit is execution authorization metadata, not the budget-spend transition itself. The architecture needs a **trusted permit materialization step inside the guard pathway**, not a broad Worker write exception over the receipt namespace.

### Rejected fixes

Do **not**:

- make `isolated-receipts-t1/` generally writable to Worker-1;
- add a generic arbitrary-path permit writer;
- let the worker provide arbitrary permit JSON;
- pre-author permits from model-authored data;
- remove the permit requirement;
- weaken exact prompt/native-call/model/subagent checks;
- move the durable claim after the model call;
- make `.attempt` retryable after errors.

---

## 3. F30 — POST-CALL RAW RETURN CAPTURE IS ALSO A DIRECT BLOCKER

The existing durable bridge already defines the correct terminal law:

`READY -> CLAIMED -> NATIVE_TASK_DISPATCHED -> RAW_RETURN_CAPTURED`

with the final state requiring the create-only pair:

`.raw + .completion`

`capture_native_return()` refuses an answer that has no prior dispatch, refuses a second captured return, validates completion metadata before creating either terminal file, writes the raw return create-only, then writes the completion receipt create-only.

That law should be **reused**, not copied.

However, `.claude/settings.json` currently registers only:

- SessionStart; and
- PreToolUse for `Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell`.

There is no PostToolUse Agent capture route in the live Worker seat.

Because the receipt namespace is self-protected, ordinary Worker prose such as “copy the Agent answer into a receipt afterward” is not an acceptable bridge. It is both procedurally lossy and unauthorized.

### Required principle

**The actual Agent tool result must cross into `capture_native_return()` through a trusted hook/runtime boundary, not by asking the worker model to retype, summarize, reconstruct, or hand-author its own subagent result.**

---

# AR-1304 — DIRECT G2 HANDSHAKE REPAIR

## 4. ACTOR / MODEL / AUTHORITY

**Implementation model: Sonnet 5, HIGH effort.**

**Actor: privileged guard-repair / control-plane actor for the live guard mutation portion. NOT ordinary Worker-1.**

Ordinary Worker-1 may perform read-only reconnaissance or author non-live scratch/test code only where its existing guard permits it, but it must not be asked to bypass or self-edit protected guard/settings/manifest surfaces.

Use the already-established controlled guard-repair authority path for the minimum live propagation needed by this packet. Do not invent a second privilege system.

No Opus/Haiku/Agent/Task call is required or authorized for AR-1304 itself.

---

## 5. F29 REPAIR — HOOK-OWNED EXACT PERMIT MATERIALIZATION

Repair the pre-call path so the **trusted G2 PreToolUse guard**, not ordinary Worker-1, can materialize the exact permit required by the already-frozen native-call manifest.

### Required behavior

For an Agent/Task dispatch in strict G2 session:

1. Read the actual tool input.
2. Canonically hash `{model, subagent_type, prompt}` using the already-frozen native-call identity law.
3. Resolve exactly one matching frozen native-call manifest row.
4. Require the exact frozen condition ref.
5. Require the exact frozen prompt hash.
6. Require `model = opus`.
7. Require `subagent_type = general-purpose`.
8. Require the description to carry the exact frozen `G2D-PERMIT: <permit_path>` identity and condition ref.
9. Derive the permit path **from the frozen manifest**, not from a model-chosen arbitrary filesystem path.
10. If the condition is READY and the exact permit does not yet exist, the trusted guard may create that exact permit create-only using only frozen/remeasured identity values.
11. If an exact permit already exists but no durable spend exists, validate it byte/field-exactly and continue only if the existing protocol says the pre-spend permit remains valid. Never overwrite it.
12. Validate/read back the permit using the existing checks.
13. Invoke the existing trusted `g2d_precall_transition.py` to perform create-only `claim -> dispatch` **before ALLOW**.
14. Only after that transition succeeds may the Agent model call be allowed.

### Preserve these laws

- `.permit` is not the durable spend.
- `.attempt` is the durable spend point.
- once `.attempt` lands, the row is SPENT even if dispatch/model/capture later fails.
- one attempt per condition.
- no retry after spend.
- no fallback model.
- no batch execution.
- no row reordering.

### Do not pre-materialize the real eight permits during AR-1304

All authoring/tests must use scratch/temp fixtures. The real frozen receipt directory must remain README-only until GPT reauthorizes execution after grading AR-1304.

---

## 6. F30 REPAIR — TRUSTED POST-AGENT RETURN CAPTURE

Add the narrowest supported post-tool hook route needed to persist the actual Agent return.

### Required live shape

1. Register the supported post-tool event for `Agent` and, if the runtime genuinely exposes `Task`, the equivalent `Task` matcher as defense-in-depth.
2. Route that event through the same pinned/trusted guard doorway pattern rather than an unpinned convenience script.
3. On the post-call event, re-identify the call using the frozen manifest and the outstanding durable dispatch.
4. Require exactly one matching row at `NATIVE_TASK_DISPATCHED`.
5. Consume the **actual tool response supplied by the hook/runtime event**.
6. Call the existing `src.engine.extraction.isolated_bridge.capture_native_return()` law to persist the exact raw return + completion evidence create-only.
7. Never ask the worker model to copy, reconstruct, retype, summarize, or sanitize the Agent answer before persistence.
8. Refuse if the returned call identity does not join to the outstanding dispatch.
9. Refuse a second capture.
10. Refuse attaching row A's output to row B.
11. Preserve NOT_EXPOSED semantics for invocation metadata the subscription runtime does not provide.

### Tool failure behavior

If the installed Claude Code runtime exposes a supported failure-hook event carrying the terminal tool failure, it may be wired narrowly and tested.

If it does **not** expose such an event with sufficient evidence, do not fabricate one. A row already at CLAIMED or NATIVE_TASK_DISPATCHED remains SPENT and the campaign stops for GPT adjudication. That is an honest crash shape, not permission to retry.

### Outstanding-dispatch interlock

Before any later G2 Agent dispatch is allowed, require that there is no prior unresolved `CLAIMED`, `NATIVE_TASK_DISPATCHED`, or `STRANDED_INCOMPLETE` row.

Thus if result persistence fails, **row N+1 cannot run**. The campaign stops at the first anomaly as AR-1302A required.

---

## 7. F31 — LIVE PROPAGATION MUST REMAIN PRIVILEGED AND MINIMAL

The live settings and manifest explicitly state that these surfaces are self-protected and ordinary Worker scope cannot override that protection.

Therefore the live repair may update only what is genuinely required, such as:

- the descendant pinned toolbox implementation/tests containing the G2 lifecycle repair;
- the toolbox pin/bundle identity in `.claude/worker1-hook-guard-manifest.json` if the existing architecture requires a repin;
- `.claude/settings.json` only to register the exact required post-tool hook matcher/doorway;
- the smallest associated test/receipt-schema support files required by the existing architecture.

The privilege boundary itself must remain intact.

Do not make settings/manifest writable to Worker-1 after propagation.

Do not widen ordinary Worker access to the frozen receipt directory.

Do not modify compiler/runtime/backtest/paper/broker code.

---

## 8. REQUIRED ZERO-MODEL TESTS / CONTROLS

AR-1304 must prove the complete handshake **without making a real Agent/Task/model call and without touching the real frozen receipt namespace**.

At minimum use temp/scratch queue + receipt fixtures and synthetic hook-event input to prove:

### Permit / pre-call

- exact frozen-shaped valid tool input resolves one row;
- trusted guard creates the exact derived permit create-only;
- permit fields bind queue SHA, condition ref, task hash, model, subagent type, prompt/native-call identity, and attempt number as required by the existing schema;
- permit path comes from manifest only;
- `permit -> claim -> dispatch -> ALLOW` order is observed;
- wrong condition ref DENY;
- wrong task hash DENY;
- wrong prompt byte/hash DENY;
- wrong native-call identity DENY;
- Sonnet DENY;
- Haiku DENY;
- wrong subagent type DENY;
- wrong/alternate permit path DENY;
- description missing exact `G2D-PERMIT:` identity DENY;
- already-spent row DENY;
- duplicate claim/dispatch DENY;
- strict-session non-G2 Agent remains DENY;
- direct ordinary Worker mutation of permit/attempt/dispatch/raw/completion namespace remains DENY.

### Post-call

- synthetic successful Agent post-tool event for exactly one outstanding dispatch writes one `.raw` and one `.completion` through the existing bridge;
- raw receipt hashes the exact response bytes supplied by the event;
- completion joins the existing dispatch model/task identity rather than restating invented values;
- a second post-tool event for the same row DENY;
- response for a different condition DENY;
- no prior dispatch DENY;
- malformed/unknown completion metadata refuses before creating the terminal pair;
- half-written/stranded state remains non-complete and non-retryable;
- unresolved prior dispatch blocks the next row.

### Mutation controls

At least one meaningful mutation must demonstrate that deleting/bypassing the new permit or post-call check turns a required test RED. Do not accept only happy-path tests of copied logic.

---

## 9. REQUIRED REGRESSION / LIFECYCLE EVIDENCE

Run the directly affected existing guard/toolbox/lifecycle tests plus the new focused suite.

Report them as **LOCAL tests** unless GitHub independently contains a CI run.

Re-prove:

- Worker session anchor still arms normally;
- `strict_session = true` remains true;
- non-G2 Agent remains denied;
- ordinary Worker writes to settings/manifest/toolbox/session marker/frozen receipt namespace remain denied;
- the exact valid G2 pre-call path reaches ALLOW only after durable claim+dispatch in scratch fixtures;
- the exact synthetic valid post-call path reaches `RAW_RETURN_CAPTURED` only after `.raw + .completion` exist;
- no old bypass becomes reachable;
- lane guard latency does not become operationally pathological.

Do not call local tests CI.

---

## 10. REQUIRED PRODUCTION POST-PROPAGATION READ-ONLY PROOF

After privileged propagation and before asking GPT to reauthorize Opus:

Start a **genuinely fresh ordinary Worker-1 seat** and use only read-only / zero-model checks to report:

1. exact Worker branch and current remote tip;
2. new toolbox pin and bundle SHA;
3. settings contains the intended post-tool Agent registration through the trusted doorway;
4. `g2_precall.enabled = true`;
5. `g2_precall.strict_session = true`;
6. queue SHA still exactly `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
7. queue still exactly 8 refs in original order;
8. `attempts = {}`;
9. real frozen receipt directory still README-only;
10. native manifest still byte-identical with 8 Opus/general-purpose rows;
11. prompt transport still byte-identical with 8 rows;
12. no real permit was materialized in the frozen namespace during the repair;
13. no Agent/Task/model call occurred during AR-1304;
14. no compiler/backtest/paper/broker/live-money work occurred.

If any of those fail, STOP without a model call.

---

## 11. FORBIDDEN IN AR-1304

- any real frozen Opus call;
- any Haiku/Sonnet subagent probe;
- any Agent/Task dispatch;
- any frozen permit creation in the real receipt directory;
- any `.attempt`, `.dispatch`, `.raw`, or `.completion` creation in the real receipt directory;
- changing the frozen queue;
- changing the frozen native-call manifest;
- changing frozen prompt bytes;
- changing model from Opus;
- widening the receipt namespace to ordinary Worker writes;
- generic arbitrary permit writer;
- generic raw-output writer exposed to Worker;
- asking Worker prose to manually reconstruct a returned Agent answer;
- retry semantics;
- batching;
- compiler work;
- backtesting;
- paper trading;
- broker/Topstep work;
- live-money work;
- optional model-router work;
- unrelated control-plane hardening;
- cleanup of historical control-plane forensic state.

---

## 12. SPEED LAW

This packet closes only the two execution seams proven by the first real G2 attempt plus the authority needed to propagate them.

**No optional hardening, naming cleanup, generic framework refactor, or new architecture phase.**

If AR-1304 passes and the real frozen state remains 8 READY / 0 SPENT / README-only with no direct execution blocker, GPT will **immediately reauthorize the original eight Opus calls in the same grading turn.**

Do not insert another cheap live Haiku calibration merely for ceremony. The real Agent -> PreToolUse fail-closed traversal was already proven in AR-1302. AR-1304's new lifecycle seam must be proven through zero-model synthetic hook-event controls and fresh-seat read-only state evidence before the real calls.

If the repair discovers one additional **direct** blocker in the exact permit-to-capture path, fix only that blocker as part of the same AR-1304 packet if it is within this narrowly stated handshake. Do not fork into adjacent engineering.

---

## END STATE

- AR-1303 = **SAFE BLOCK / STOP DISCIPLINE PASS**
- row 1 Opus call = **NOT INVOKED**
- row 1 attempt = **NOT SPENT**
- retries = **0**
- frozen G2 = **8 READY / 0 SPENT**
- frozen queue attempts = **{}**
- frozen receipt namespace = **README-only**
- F29 permit deadlock = **CONFIRMED**
- F30 post-call capture deadlock = **CONFIRMED**
- F31 ordinary Worker self-repair prohibition = **CONFIRMED**
- AR-1304 = **AUTHORIZED**
- AR-1304 model = **Sonnet 5 HIGH**
- AR-1304 actor for live guard mutation = **privileged guard-repair/control-plane seat**
- real model calls in AR-1304 = **0**
- next after clean AR-1304 grade = **immediate reauthorization of the original 8 frozen Opus calls**
