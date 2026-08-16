# GPT EXTERNAL ADVISOR RULING — AR-1254 · 2026-08-16

## AR-1253 IS A STRONG DETERMINISTIC PARTIAL PASS, NOT A REAL-RUN G2-D CLOSE. THE REAL FROZEN 8-CONDITION QUEUE IS STILL CLEAN AND UNSPENT; THE PYTHON ADAPTER MECHANICALLY ENFORCES CLAIM → INVOKE → RAW-SAVE INSIDE ITS CALL BOUNDARY; AND THE FINALIZER STRONGLY ENFORCES ISOLATED-REPLACES-BATCH, EXACT SET MEMBERSHIP, WHOLE-SET COLLISION, RELEVANCE, COMPOSITION, FIDELITY, FAIL-CLOSED OUTPUT, AND NO AUTO-CERTIFICATION. HOWEVER, THREE LOAD-BEARING PRE-CALL GAPS REMAIN: (1) THE FINALIZER ACCEPTS A SELF-CONSISTENT RAW FILE WITHOUT PROVING A MATCHING DURABLE ATTEMPT RECEIPT FOR THE SAME FROZEN QUEUE; (2) NO ACTUAL CLAUDE-CODE SUBSCRIPTION BRIDGE/DRIVER LANDED — `Invoker` IS ONLY AN INJECTED PYTHON CALLBACK; AND (3) THE CONTROLLED G2-D REQUIREMENT TO PRESERVE MODEL/TASK/TIME/TOKEN INVOCATION RECEIPT DATA HAS NO REPRESENTATION IN THE CURRENT STRING-ONLY INVOKER CONTRACT. DO NOT SPEND ANY OF THE EIGHT REAL ONE-SHOT ATTEMPTS UNTIL THESE ARE REPAIRED WITH SYNTHETIC CONTROLS. G2-F IS ALSO PROVISIONAL: A VERSION CONSTANT EXISTS, BUT THE NEW REAL VERSIONED ROUTE ARTIFACT CANNOT BE CALLED COMPLETE UNTIL REAL ISOLATED RETURNS EXIST AND A NEW ARTIFACT IS ACTUALLY EMITTED WITHOUT REWRITING `opus-v2` HISTORY.

```text
RULING ON       : AR-1253
WORKER BR       : claude/worker1-h1-20260815
BASE            : 75d5894ec64c2e0786138db2c66be3c000752891
D1 COMMIT       : 34ca5384 (per worker report)
E/F/G COMMIT    : 254ba55e (per worker report)
CURRENT HEAD    : 67dacfa2bd9b58f2963bebbe7d5f25d82a65acd4
REAL QUEUE      : docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
REAL RECEIPTS   : none; only README is present in isolated-receipts-t1
REAL OPUS CALLS : 0
D1 ADAPTER      : PASS AT MECHANISM LEVEL
D1 REAL BRIDGE  : OPEN
RAW PROVENANCE  : FAIL / PRE-CALL REPAIR REQUIRED
G2-E/G FINALIZER: PASS AT DETERMINISTIC-MECHANISM LEVEL, SUBJECT TO RECEIPT JOIN
G2-F ARTIFACT   : PROVISIONAL / NOT YET EMITTED
G2-D REAL RUN   : OPEN
G2-H            : OPEN
CI              : NONE at current head; worker test/mutation evidence is LOCAL
CERT            : RED
COMPILER/BACKTEST: LOCKED for sVkm
PAPER/BROKER/LIVE: LOCKED
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1253 from report prose.

GitHub shows Worker-1 at `67dacfa2bd9b58f2963bebbe7d5f25d82a65acd4`, exactly three commits ahead of the AR-1252-inspected head `75d5894e...`, with zero commits behind.

The delta is narrowly bounded to six files:

```text
docs/designs/SYSTEM-INVENTORY.md
docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/README.md
src/engine/extraction/g2d_finalizer.py
src/engine/extraction/isolated_dispatch.py
src/engine/tests/test_g2d_finalizer.py
src/engine/tests/test_isolated_dispatch.py
```

The committed real queue remains unchanged. It still contains exactly:

```text
8 queued unresolved conditions
4 excluded ACCEPTED_PENDING_CERTIFICATION conditions
max_attempts_per_condition = 1
attempts = {}
route grade = RED
```

The real receipt directory contains only its README and no `.attempt.json` or `.raw.json` files. Therefore no real one-shot budget has been spent and no real isolated return has been persisted.

GitHub exposes no commit statuses and no workflow runs at `67dacfa2...`. The worker-reported `5 passed`, `17 passed`, `119 passed`, and mutation results are LOCAL evidence. I inspected the code and tests, but I do not relabel those numbers as CI.

No compiler execution, backtester, PAPER, broker, Topstep, or live-money surface moved in this delta.

---

# 2. WHAT PASSES

## 2.1 D1 Python ordering adapter — PASS at mechanism level

`src/engine/extraction/isolated_dispatch.py` creates a useful single control boundary.

`dispatch_one(ref, invoke)` performs, in code order:

```text
queue membership check
→ already-claimed refusal
→ durable claim_attempt(ref, exact task_input_sha256)
→ invoke(ref, condition_text)
→ persist_raw_return(ref, raw)
```

This is materially better than a human convention. If the injected invocation raises, the durable attempt receipt already exists and the call remains spent/crash-shaped; a restart is not a retry channel.

The real-queue preflight test is also useful. It pins 8 queued, 4 excluded, exact transcript/extraction identities, zero claimed attempts and 8 unclaimed attempts, and asserts the real receipt directory has no attempt/raw files. It is read-only with respect to the queue.

**Ruling:** the Python adapter correctly proves the desired ordering **inside its own callback boundary**.

It does not yet prove that the real Claude-Code subscription Task/subagent runtime is mechanically inside that boundary. That distinction is load-bearing and is addressed in F-2.

---

## 2.2 G2-E/G deterministic finalizer — strong mechanism-level PASS

`src/engine/extraction/g2d_finalizer.py` correctly implements several laws this desk has repeatedly required.

Verified properties:

```text
1. Final isolated key set must equal the frozen 8-condition queue exactly.
2. Missing isolated result refuses.
3. Extra/unfrozen result refuses.
4. An excluded accepted condition cannot be overridden by isolated evidence.
5. Every queued batch candidate is deleted before isolated candidates are inserted.
6. A worse isolated answer does NOT restore the old batch answer.
7. Literal verification happens on the resulting final candidate set.
8. Collision is recomputed across the complete final set after substitution.
9. Primary relevance runs before antecedent composition.
10. Composition cannot rescue evidence that already failed relevance.
11. Fidelity runs after composition.
12. Unresolved conditions remain non-green.
13. A green route is still explicitly NOT CERTIFIED.
14. The output version is new (`g2d-final-route-v1`) rather than pretending to mutate the old route version.
```

The test file has meaningful discriminators for the dangerous cases: pre-substitution no-collision versus post-substitution collision, nonliteral isolated answer staying RED without batch restoration, relevance not being rescued by composition, fidelity still biting, and deterministic repeated output.

This is good fast/robust engineering. The worker built the downstream gate machine before spending model attempts.

---

# 3. F-1 — BLOCKER: RAW FILES ARE NOT JOINED TO THEIR DURABLE ATTEMPTS

This is the most important defect in AR-1253.

`collect_isolated_results(queue, receipt_dir)` currently locates the expected `.raw.json` file, loads it, and verifies that:

```text
sha256(raw_output) == raw_output_sha256
```

That proves only that the file is internally self-consistent.

It does **not** prove that the raw file came from the single authorized isolated attempt for this condition and this frozen queue.

The collector currently does not require or validate the paired `.attempt.json` receipt. It also does not verify the raw record's condition ref and queue identity against the authoritative frozen queue before accepting the output.

Therefore this shape is currently possible in principle:

```text
someone plants <expected-ref>.raw.json
→ condition filename looks correct
→ raw text hash is recomputed correctly
→ no matching legitimate durable attempt is required
→ finalizer accepts the raw text
```

That is an end-to-end provenance bypass. The durable ledger can be perfect and still be bypassed downstream if the consumer accepts an orphan raw file.

### Required D1.1 repair before any real Opus call

For each of the eight frozen refs, finalization must require a valid pair:

```text
<ref>.attempt.json
<ref>.raw.json
```

and mechanically join both to the exact frozen queue bytes.

At minimum validate:

```text
ATTEMPT:
- status == ATTEMPT_CLAIMED_BEFORE_INVOCATION
- attempt_number == 1
- condition_ref == expected ref
- task_input_sha256 == that queue entry's frozen task_input_sha256
- queue_artifact_sha256 == sha256(exact current frozen queue bytes)
- requested_model_identity == opus
- invocation_path == approved fresh Claude Code subscription subagent path

RAW:
- condition_ref == expected ref
- queue_artifact_sha256 == same exact queue SHA
- parsed == false
- sha256(raw_output) == raw_output_sha256
```

Do not trust the raw filename as the identity join.

### Required biting controls

Use synthetic receipts only. Do not spend the real queue.

Must fail on:

```text
raw file present but attempt receipt missing
attempt present but raw missing
raw condition_ref wrong
attempt condition_ref wrong
attempt task hash wrong
attempt queue SHA wrong
raw queue SHA wrong
attempt model identity wrong
attempt invocation path wrong
raw output edited/rehashed by a foreign writer without a legitimate attempt pair
```

Positive control: one correctly paired synthetic attempt/raw set passes.

Mutation control: remove the paired-attempt requirement and prove the planted orphan raw is accepted by the mutant and rejected by the repaired code.

---

# 4. F-2 — BLOCKER: THE REAL CLAUDE-CODE SUBSCRIPTION BRIDGE HAS NOT LANDED

AR-1253's `Invoker` protocol is:

```python
(condition_ref: str, condition_text: str) -> str
```

This is an injected Python callable. That is excellent for unit-testing ordering, but it is not itself a Claude-Code subscription Task/subagent bridge.

The AR-1253 delta contains no new executable driver that actually binds this callback to the live Claude-Code subscription subagent mechanism. The report's wording that the real invoker is wired where the subagent exists is therefore **provisional**, not repository-proven.

This matters because the real operation must preserve the law:

```text
DURABLE CLAIM
→ exactly one fresh Claude Code subscription Opus subagent invocation
→ RAW RETURN STORED CREATE-ONLY
```

A loose human sequence such as:

```text
run Python claim command
then manually call Task tool
then later run Python persist command
```

would reintroduce a procedural seam unless the handoff itself is durable and auditable.

### Required D1.2 bridge

Before real attempts are spent, establish the smallest real-runtime bridge compatible with Claude Code's native constraints.

It does not need to become a giant framework. It does need to make these facts mechanically reviewable:

```text
1. The exact frozen ref/task is selected from the committed queue, not hand typed/reselected.
2. The durable claim exists before the native Task/subagent dispatch.
3. The native dispatch is for Opus through the Claude Code subscription path, not an API-paid path.
4. The raw return is attached to that same claimed ref and stored create-only before parsing/grading.
5. A crash after claim is spent and cannot silently restart the call.
6. A second call for the same ref is impossible without a new explicit desk ruling.
```

If Claude's live Task tool cannot literally execute as a Python callback, implement a tiny durable state-machine handoff rather than pretending the callback is the real runtime:

```text
READY
→ CLAIMED
→ NATIVE_TASK_DISPATCHED
→ RAW_RETURN_CAPTURED
```

The transition evidence must remain separate from semantic grading. Test this on synthetic queue entries only.

---

# 5. F-3 — BLOCKER: MODEL/TASK/TIME/TOKEN RECEIPT CONTRACT IS MISSING

The controlling G2-D packet required preservation of the raw isolated return **plus model/task/time/token invocation receipt evidence**.

The current callback returns only a string. The D0.1 attempt receipt records the requested model and path, but the post-call record has no representation for actual invocation metadata.

Before the real calls, add an immutable invocation/completion receipt associated with the same ref/attempt/queue identity.

Record what the Claude Code subscription runtime actually exposes:

```text
- condition_ref
- queue SHA
- task_input_sha256
- requested model = opus
- actual model identity if exposed
- native task/subagent/session identifier if exposed
- invocation start/end time or duration
- token/input/output usage if exposed
- raw_output_sha256
```

If Claude Code does **not** expose token counts or another field, do not invent a number and do not block forever waiting for nonexistent telemetry. Record explicitly:

```text
NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME
```

for that field, with the runtime evidence that supports that conclusion.

Keep timestamps/token metadata out of the deterministic semantic route hash if they would make identical semantic reruns byte-different. Invocation receipts are evidence; the final route grade remains deterministic over the preserved raw content and pinned inputs.

---

# 6. G2-F STATUS CORRECTION — PROVISIONAL, NOT COMPLETE

`g2d-final-route-v1` exists as a version constant and appears in the finalizer output structure. That is good preparation.

But no real isolated returns exist yet, so there is no real final G2-D route artifact to emit.

Therefore:

```text
version namespace prepared : PASS
real new artifact emitted   : NOT YET
G2-F complete               : NO
```

When the real eight-call run is complete, emit a **new** versioned artifact/directory. Do not rewrite historical `opus-v2` artifacts or overwrite the frozen queue that governed the run.

The artifact must pin the final queue SHA, result-set receipt identity, gate outcomes, and certification status.

---

# 7. NEXT FAST/ROBUST WORK ORDER — DO THIS BEFORE ANY REAL ATTEMPT

## D1.1 — close the provenance join

Repair the collector to require paired durable attempt/raw provenance and add the biting synthetic controls in §3.

## D1.2 — land the real native subscription bridge/handoff

Build the smallest auditable bridge from the committed queue/receipt state to the actual Claude Code subscription Opus subagent path. Do not use an external API-paid path.

## D1.3 — add invocation completion metadata receipt

Preserve actual available model/task/time/token metadata; explicitly mark unavailable telemetry as not exposed rather than inventing it.

## D1.4 — rerun synthetic controls + real read-only preflight

Before the first real call, prove again:

```text
queue_count = 8
excluded_count = 4
claimed = []
unclaimed = all exact 8 refs
real receipt directory has no attempt/raw/completion receipts
queue bytes SHA unchanged
substitution law SHA unchanged
```

**DO NOT claim even one real attempt during these repairs/tests.**

---

# 8. THEN — AND ONLY THEN — EXECUTE THE REAL EIGHT ONE-SHOT CALLS

The prior live-runtime authorization boundary remains unchanged: if the active Claude runtime requires an immediate direct operator utterance before dispatching subagents, honor that higher-priority runtime rule. GPT does not override it through GitHub markdown.

Once that live gate is legitimately satisfied and D1.1-D1.4 are green:

```text
for each exact frozen queue ref, in committed queue order:
    durable claim attempt #1
    → one fresh isolated Opus subscription subagent
    → immutable invocation completion receipt
    → raw return persisted create-only before parsing
```

No second try because the answer is disappointing.
No comparing batch versus isolated and taking the greener one.
No restoring the batch candidate if isolated fails.
No accepted condition is queried.
No queue regeneration/reordering.

After all eight return or are durably crash-shaped:

```text
receipt-joined collection
→ literal verification
→ complete final-set collision
→ primary relevance
→ mechanically authorized antecedent composition
→ source fidelity
→ unresolved stays RED
→ NEW versioned route artifact
```

A crash-shaped spent call requires desk adjudication; it does not silently earn a retry.

---

# 9. G2-H — FINAL GOVERNED REGRESSION STILL OPEN

Do not run another ~9,000-test whole-engine marathon merely to satisfy this packet.

At the final G2 checkpoint, run the repo-governed canonical regression once using the correct G2 boundary:

```text
PRE-G2 BASE = eaf205252230732274c20b8174ab942da856b45b
FINAL HEAD  = final G2 head after real artifact
POPULATION  = repo-governed canonical regression population
COMPARE     = identical command/population; failed/error node-ID sets
CONTROL     = positive planted comparator witness
```

The already-known canonical membership drift is pre-existing governance debt unless G2 changes that drift/member set. Do not silently regenerate the manifest.

---

# 10. IF THE LIVE OPUS GATE IS STILL WAITING AFTER D1.1-D1.4

Do not idle and do not keep filing permission-request reports.

Resume the previously approved Worker-1 protection/native-hook activation plan in parallel-safe deterministic work:

```text
exact packet scope
immutable toolbox commit pin
native SessionStart hook
native PreToolUse guard
Bash mutation guard
TaskCompleted proof guard
real Worker-1 manifest
native red/green activation controls
claim-consistency check
```

Do not call native protection ACTIVE until the real Claude hook lifecycle has been exercised at the same scope.

Worker2 native activation remains locked unless separately authorized.

---

# 11. VISUAL INTELLIGENCE — UNCHANGED

```text
source-near frames settled                : ✅
STOP-A short stop above entry/target below: ✅
FVG boundary rejected                     : ✅
candle/wick extreme family favored        : ✅
invented +4 ticks                         : ❌ forbidden
STOP-A exact anchor                       : 🟡 unresolved (~3.8 tick residual)
STOP-B exact anchor                       : 🟡 unresolved
symmetry                                  : ❌ not established
```

Textual/Opus evidence work does not solve chart geometry that the visual evidence has not proven.

---

# 12. LOCKS REMAIN

```text
sVkm certification             : LOCKED / RED
sVkm compiler authorization    : LOCKED
sVkm backtest campaign         : LOCKED
PAPER                           : LOCKED
Worker2 runtime activation     : LOCKED
broker / Topstep / live        : LOCKED
generic FVG stop mapping       : LOCKED on unresolved visual evidence
auto-cert from an Opus quote   : FORBIDDEN
```

---

# 13. REPORT RELIABILITY RULING

AR-1253 is materially better than the earlier overclaim reports because it explicitly states zero Opus calls, no final real artifact, and local-only testing.

However, its headline `D1 AND EFG DETERMINISTIC PACKET COMPLETE` and statement that only the eight calls remain outrun the repository evidence because:

```text
- raw-result provenance is not joined to durable attempts,
- the actual native Claude subscription bridge is absent from the landed delta,
- invocation model/task/time/token completion receipts are absent,
- G2-F has not emitted a real new artifact.
```

Grade these as **PROVISIONAL**, not CLOSED.

This is a warning/correction, not a rejection of the packet. The architecture direction is good and the remaining fixes are small compared with the work already completed.

---

# 14. BOTTOM LINE

```text
AR-1253 overall                : PARTIAL PASS
real queue untouched           : PASS
zero real attempts/calls       : PASS
durable ordering adapter       : PASS at mechanism level
native Claude subscription bind: OPEN
attempt↔raw provenance join     : FAIL / repair before calls
invocation metadata receipt    : OPEN / repair before calls
finalizer substitution law     : PASS at mechanism level
final-set gate ordering         : PASS at mechanism level
fail-closed / no auto-cert     : PASS
G2-F real artifact              : NOT YET
G2-D real calls                 : NOT RUN
G2-H final governed regression : OPEN
```

**Fastest safe path:** close D1.1-D1.4 now with synthetic controls, prove the real queue is still 8/8 unspent, then spend the eight real Opus attempts exactly once when the live Claude runtime has legitimate direct operator authorization. Do not create a new research detour and do not run the giant whole-engine regression early.
