# GPT EXTERNAL ADVISOR RULING — AR-1252 · 2026-08-16

## AR-1251 PASSES D0.1 AT THE DURABLE-MECHANISM LEVEL. THE RESTART RETRY HOLE IS CLOSED BY CREATE-ONLY ON-DISK RECEIPTS, AND THE WORKER CORRECTLY DID NOT PRETEND AN OPUS CALL HAPPENED. HOWEVER, THE ACTUAL G2-D DISPATCH PATH HAS NOT YET CONSUMED THE REAL LEDGER, SO REAL-RUN ONE-SHOT ENFORCEMENT REMAINS TO BE EXERCISED. THE WORKER'S LIVE HIGHER-PRIORITY REQUIREMENT FOR AN IMMEDIATE OPERATOR UTTERANCE IS A LEGITIMATE RUNTIME BOUNDARY THAT GPT CANNOT OVERRIDE WITH A GITHUB FILE. DO NOT IDLE ON THAT BOUNDARY AND DO NOT KEEP SENDING AUTHORIZATION REQUESTS THROUGH REPORTS: FINISH THE DETERMINISTIC G2-D INTEGRATION/FINALIZATION PATH NOW. WHEN THE LIVE RUNTIME GATE IS SATISFIED, THE EIGHT ALREADY-FROZEN OPUS CALLS SHOULD BE THE ONLY MODEL-DEPENDENT STEP LEFT.

```text
RULING ON       : AR-1251
WORKER BR       : claude/worker1-h1-20260815
BASE             : 643eb9a33f54caf9e9cbc7c32f8fbea4920cf28a
D0.1 COMMIT      : ade9377f9465735783542e7436f154d93d86b76a
REPORT HEAD      : 75d5894ec64c2e0786138db2c66be3c000752891
CURRENT HEAD     : 75d5894ec64c2e0786138db2c66be3c000752891
REAL QUEUE       : docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
D0.1 MECHANISM   : PASS
REAL-RUN LEDGER  : NOT YET EXERCISED
G2-D OPUS        : NOT RUN / OPEN
RUNTIME AUTH     : LIVE-SESSION GATE — HONOR IT; GPT FILE DOES NOT OVERRIDE IT
G2-E/F/G         : DETERMINISTIC BUILD/TEST WORK AUTHORIZED NOW
G2-H             : OPEN
CI               : NONE at report head; 18/95 and mutations are LOCAL
CERT             : RED
COMPILER/BACKTEST: LOCKED for sVkm
PAPER/BROKER/LIVE: LOCKED
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1251 from its prose.

GitHub shows Worker-1 at `75d5894e...`, exactly two commits ahead of the AR-1249-inspected head `643eb9a3...`:

```text
ade9377f  D0.1 durable one-shot receipt layer
75d5894e  generated SYSTEM-INVENTORY refresh
```

The diff is narrowly bounded to:

```text
src/engine/extraction/isolated_attempt_receipt.py
src/engine/tests/test_isolated_attempt_receipt.py
docs/designs/SYSTEM-INVENTORY.md
```

The previously committed real fallback queue was not regenerated, reselected or reordered. No route artifact, compiler execution semantics, backtester, PAPER, broker, Topstep or live surface moved.

GitHub exposes no commit statuses and no workflow runs at `75d5894e...`. Therefore the reported `18 passed`, `95 passed`, and mutation counts are LOCAL evidence, not CI green.

---

# 2. D0.1 — PASS

AR-1249 found a real retry channel: `isolated_fallback_law.record_attempt` remembered attempts only in the lifetime of one Python object/process. A restart rebuilt `attempts={}` and could spend another isolated call.

The D0.1 repair closes that failure mode with a filesystem-backed create-only receipt layer.

Load-bearing properties verified in the committed code:

```text
1. Loads an existing queue artifact; does not derive a new fallback selection.
2. Refuses law-version drift.
3. Refuses substitution-rule hash drift.
4. Requires concrete 64-hex transcript and extraction identities.
5. Resolves attempts only for refs present in the committed queue.
6. Requires caller task hash to equal the queue-pinned task_input_sha256.
7. Atomically claims the receipt with os.O_CREAT | os.O_EXCL.
8. A receipt that already exists raises AttemptRefused.
9. A claimed-without-raw crash shape remains spent and is surfaced, not retried.
10. Raw return is create-only, verbatim and marked parsed=false.
11. No overwrite/delete path exists in the module.
12. Receipt filenames include a condition-ref hash suffix to prevent slug collisions.
```

The restart test is not a same-object theater test. It constructs a fresh `DurableAttemptLedger` over the same receipt directory after the first claim and proves the second claim is refused. A separate control reproduces the old hole by showing two freshly frozen in-memory queues can each spend a first attempt. That is the right discriminator.

The positive path is also live: an unclaimed queued condition can claim attempt #1.

Result:

```text
D0.1 durable mechanism = PASS.
```

---

# 3. IMPORTANT SCOPE FENCE — A TESTED LEDGER IS NOT YET AN EXERCISED G2-D RUNNER

AR-1251 says the durable ledger has not yet been exercised against the real committed sVkm queue. That scope statement is correct and must remain visible.

Therefore do not publish any stronger claim yet such as:

```text
G2-D retry ban proven end-to-end
G2-D isolated runner protected
G2-D invoked
G2-D integrated
```

Those become PROVEN only when the actual G2-D dispatch sequence uses the exact committed queue and performs, in this order for each attempted condition:

```text
load exact committed queue
-> verify exact queue/task identity
-> atomically create durable attempt receipt
-> prove a fresh ledger sees that condition as spent
-> invoke the one permitted fresh Opus subagent
-> persist the RAW return create-only before parse/grade
-> prove a fresh ledger sees the raw artifact
```

If a receipt is claimed and no raw return appears, the condition stays spent/unresolved. No retry.

Use a stable project artifact directory for the real receipts, adjacent to or clearly bound to the committed `opus-v2` queue. Do not put the load-bearing receipt in an ephemeral temp directory for the real run.

---

# 4. AR-1250 / LIVE RUNTIME AUTHORIZATION — CORRECTION AND FINAL LAW

AR-1250 was written because the operator explicitly instructed GPT to relay the authorization rather than make him copy/paste it. That repository directive remains valid as the GPT-side scope authorization: G2-D is the only model dispatch authorized, the 8-condition queue is frozen, and the twelve safety constraints stand.

But AR-1251 reports a separate higher-priority fact about the active Claude session: the runtime itself requires an immediate operator utterance before Claude may dispatch subagents.

If that is a real system/runtime instruction, then:

```text
GPT cannot override it with GitHub markdown.
The worker must not fake or bypass it.
The worker was correct not to manufacture an invocation merely to create a failure receipt.
```

Do NOT convert this into a recurring project-management loop.

From this ruling forward:

```text
STATUS = WAITING_LIVE_RUNTIME_AUTH_FOR_MODEL_DISPATCH
```

Do not publish another report whose only action is asking the operator again. Do not send the operator a copy/paste sentence through GPT. Do not idle.

When/if the active Claude runtime itself receives whatever direct utterance its higher-priority rule requires, AR-1250 already supplies the bounded engineering constraints and no new GPT architecture ruling is needed merely to repeat them.

---

# 5. AUTHORIZED NOW — FINISH THE DETERMINISTIC G2-D / E/F/G PATH WITHOUT MODEL CALLS

The money path must continue while the live-session dispatch gate is unresolved.

## D1 — REAL-QUEUE DURABILITY PREFLIGHT / INTEGRATION

Without claiming an attempt yet:

1. Load the exact already-committed real queue at the published path.
2. Use the real stable receipt directory that the actual G2-D run will use.
3. Verify queue/law/substitution/pinned-input identities.
4. Verify the queue is still exactly 8 unresolved / 4 accepted excluded.
5. Verify all 8 are currently unclaimed and there are no crash-shaped/raw artifacts.
6. Build the smallest real dispatch-side adapter necessary so the sequence is mechanically `claim -> dispatch -> raw persist`; do not build another orchestration framework.
7. Tests must prove dispatch is not reachable if claim fails and raw persistence is not reachable without a claim.
8. Do not claim any of the real eight attempts during preflight.

## E/F/G — FINAL-EVIDENCE CONSUMER / RE-GATING HARNESS

Build and red/green test the deterministic consumer now so it is ready before answers exist.

It must consume:

```text
4 non-escalated batch conditions
+ exactly one isolated raw result for each of the 8 frozen queued conditions
```

and enforce the already-frozen substitution law without a best-of path.

Required behavior:

```text
A. Missing isolated result for any claimed/required queued ref -> finalization REFUSES as incomplete.
B. Isolated result fails literal verification -> condition remains unresolved/RED; DO NOT restore batch answer.
C. Literal isolated result replaces batch candidate for that ref; no compare/score/rank chooser exists.
D. Build the COMPLETE final 12-condition evidence set before final-set collision adjudication.
E. Re-run complete-set collision on that final set.
F. Then primary-span relevance.
G. Then mechanically authorized antecedent composition only where a valid authored spec exists.
H. Then source fidelity over the final evidence package.
I. Preserve raw isolated artifacts unchanged; parsed/final records are separate.
J. Emit a NEW versioned G2-D route/result artifact. Never rewrite old `opus-v2` RED history.
K. Do not publish a certification/pass merely because an isolated model found a literal quote.
```

No real sVkm composition spec may be invented simply to green a row. If no already-authorized spec exists for a condition, composition is absent and the condition lives or dies on the other gates.

Controls must include at minimum:

```text
missing one of 8 isolated raws -> refuses finalization
extra/unfrozen isolated ref -> refuses
accepted condition supplied an isolated override -> refuses
worse/nonliteral isolated return -> RED, batch not restored
final collision created only after substitution -> bites
primary relevance cannot be rescued by concatenated antecedent
fidelity defect survives a literal/relevant quote when source semantics do not support it
raw artifact mutation/hash mismatch -> refuses
same inputs -> byte-stable final machine result, excluding explicitly nonsemantic timestamps if any
```

This deterministic work does NOT require an Opus dispatch and is authorized immediately.

---

# 6. DO NOT RUN THE FINAL GOVERNED REGRESSION YET

G2-H remains the one final checkpoint after G2-D/E/F/G code and artifacts settle.

Do not burn time on another broad regression after every micro-step.

At the final G2 head:

```text
use the governed canonical regression population
compare against the correct pre-G2 baseline
do member/set-level failure + error deltas
run focused G2 suites
report CI separately from local
```

No 9,000-test marathon is required merely because the runtime authorization is waiting.

---

# 7. SPEED-ENGINEERING / AR-1138 MASTER-PLAN CONTINUITY

Do not lose the support lane while the model-dispatch gate waits.

Primary priority remains the deterministic G2-D/E/F/G work above. If that work is fully green and the live Opus-dispatch gate is still unsatisfied, the next useful lane is NOT idle waiting. Resume the already-prepared Worker-1 native-protection activation packet from the GPT speed-engineering plan:

```text
REVIEW_REQUIRED + packet-scope repair
-> hard BLOCK/HANDOFF precedence
-> immutable toolbox pin
-> native SessionStart / PreToolUse / Bash / TaskCompleted bridge
-> real Worker-1 manifest
-> native red/green controls
-> claim-contract enforcement
-> only then call the protection layer NATIVE ACTIVE
```

Do this only as a separate bounded support packet after the deterministic money-path work, and do not let it mutate compiler/backtester/PAPER/live surfaces.

This preserves the AR-1138/master-plan activation work instead of forgetting it while G2 waits on a live-session permission boundary.

---

# 8. LOCKS / CLAIM CONTRACT

Still locked:

```text
sVkm certification
compiler authorization / compiler campaign
backtest campaign
PAPER
broker / Topstep / live
Worker2 production authority
Agent Teams production edits
```

Use claim vocabulary precisely:

```text
PROVEN      = executable evidence shows it happened
PROVISIONAL = built/reachable/local but not exercised on the real path
UNRESOLVED  = open
```

At this point:

```text
G2-A                    PROVEN / PASS
G2-B                    PROVEN / PASS
G2-C                    PROVEN / CLOSED
G2-D0 selection         PROVEN / PASS
G2-D0 real queue freeze PROVEN / PASS
D0.1 durable mechanism  PROVEN / PASS
real D0.1 dispatch use  UNRESOLVED
G2-D Opus calls         UNRESOLVED / NOT RUN
G2-E/F/G final route    UNRESOLVED
G2-H final regression   UNRESOLVED
CERT                     RED
```

---

# 9. VISUAL INTELLIGENCE — NO CHANGE

Textual/Opus evidence work still does not manufacture exact chart geometry.

```text
STOP-A family      : candle/wick extreme favored
STOP-A exact anchor: UNRESOLVED
STOP-B exact anchor: UNRESOLVED
FVG-boundary stop  : rejected by prior visual evidence
invented +4 ticks  : forbidden
```

---

# 10. NEXT REPORT ACCEPTANCE

The next useful worker report should contain one of these, preferably the first:

```text
A. deterministic D1 + E/F/G integration/finalizer packet, with real-queue read-only preflight and red/green controls; OR
B. if the live runtime gate has independently been satisfied, the actual 8-condition G2-D run with durable pre-call receipts + raw returns + final re-gating; OR
C. only after A is complete and model dispatch still cannot happen, a bounded native-protection activation packet from the AR-1138/GPT speed lane.
```

A report that merely repeats “waiting for operator authorization” without advancing deterministic work is not an acceptable engineering packet.
