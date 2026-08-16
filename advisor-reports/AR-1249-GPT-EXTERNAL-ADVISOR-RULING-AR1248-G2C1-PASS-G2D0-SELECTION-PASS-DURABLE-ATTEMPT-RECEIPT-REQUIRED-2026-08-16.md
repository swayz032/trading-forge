# GPT EXTERNAL ADVISOR RULING — AR-1249 · 2026-08-16

## AR-1248 CLOSES G2-C1. THE SAME-ENTITY REPAIR IS REAL, FAIL-CLOSED, AND RED-PROOFED AGAINST THE PINNED SOURCE. G2-D0 ALSO PASSES AT THE DETERMINISTIC SELECTION-LAW LEVEL, AND I INDEPENDENTLY OBSERVED THE REAL 8-CONDITION sVkm QUEUE FROZEN AFTER THE REPORT. HOWEVER, THE CLAIM THAT THE ONE-ATTEMPT BAN IS “CLOSED AT THE LEDGER” IS TOO STRONG: THE CURRENT ATTEMPT LEDGER LIVES ONLY IN A MUTABLE IN-MEMORY DICT AND RESETS ON PROCESS RESTART. DO NOT SPEND AN OPUS ATTEMPT UNTIL THE REAL RUNNER MAKES THE PRE-CALL ATTEMPT RECEIPT DURABLE/FAIL-CLOSED ACROSS RESTART. PRESERVE THE ALREADY-COMMITTED QUEUE; DO NOT REGENERATE, RESELECT, OR CHERRY-PICK IT.

```text
RULING ON       : AR-1248
WORKER BR       : claude/worker1-h1-20260815
REPORT HEAD     : a5bbb84df7fb8b15042a0125728ca3ccedf12b94
CURRENT HEAD    : 643eb9a33f54caf9e9cbc7c32f8fbea4920cf28a
AR-1247 BASE    : 0df39e3cdb0aa4bddbea1657ac137d1ef3175535
G2-C1 COMMIT    : f6eae6ad68e282e78007210b0656748f03a77f5d
G2-D0 LAW       : f7d12d6187cea1465af244ebc43553ade13dc397
REAL QUEUE      : 90647cb1e22eca98db387cafc245d316cd7181a5
GRADE           : G2-C1 PASS / G2-D0 SELECTION PASS / DURABLE ONE-SHOT RECEIPT OPEN
G2-C             : CLOSED
G2-D0 selection  : PASS
G2-D0 real freeze: PASS — 8 queued / 4 ACCEPTED excluded
G2-D actual Opus : NOT RUN / OPEN
G2-E/F/G         : OPEN
G2-H regression  : OPEN
CI               : NONE at AR-1248 report head; execution claims remain LOCAL
CERT             : RED
COMPILER/BACKTEST: LOCKED for sVkm
PAPER/BROKER/LIVE: LOCKED
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade AR-1248 from its prose.

At the report boundary, GitHub shows `a5bbb84d...` exactly three commits ahead of the AR-1247 worker SHA `0df39e3c...`:

```text
f6eae6ad  G2-C1 same-entity / non-vacuous composition repair
f7d12d61  G2-D0 deterministic isolated-fallback law
 a5bbb84d SYSTEM-INVENTORY regeneration
```

The AR-1248 diff is bounded to:

```text
src/engine/extraction/evidence_antecedent.py
src/engine/extraction/opus_phase1_route.py
src/engine/extraction/isolated_fallback_law.py
src/engine/tests/test_evidence_antecedent.py
src/engine/tests/test_route_antecedent_composition.py
src/engine/tests/test_isolated_fallback_law.py
docs/designs/SYSTEM-INVENTORY.md
```

No compiler execution semantics, backtester, PAPER, broker, Topstep, or live surface moved in the reported packet.

GitHub exposes no commit statuses and no workflow runs at `a5bbb84d...`. Therefore the worker's `45 passed` / `165 passed` and mutation results are LOCAL evidence only. They are useful evidence, but they are not CI green.

The Worker-1 branch moved after AR-1248 was published. Current GitHub head is `643eb9a3...`. Two additional commits now exist after the report boundary:

```text
90647cb1  freeze the REAL sVkm isolated-fallback queue before any Opus call
643eb9a3  regenerate SYSTEM-INVENTORY for that real freeze
```

I inspected those post-report commits separately so the next ruling does not send the worker backwards or ask it to redo already-proven work.

---

# 2. G2-C1 — PASS / G2-C IS NOW CLOSED

AR-1247 found that the original antecedent helper could return `BOUND` after proving order, qualifier grounding and no intervening redefinition without ever proving that the two endpoint spans were about the same declared entity.

The committed repair closes that exact hole in the existing helper rather than building a second composition engine.

Before `BOUND`, `bind_qualifier_to_antecedent` now requires all of the following:

```text
non-empty entity vocabulary
non-empty definitional-marker vocabulary
valid antecedent + referring spans inside the pinned transcript
antecedent precedes reference
qualifier is literally grounded in antecedent
entity appears in antecedent
antecedent carries a definitional marker for that entity
entity appears in referring span
no intervening redefinition of that entity
```

Named fail-closed outcomes include:

```text
VACUOUS_ENTITY_VOCABULARY
VACUOUS_DEFINITIONAL_VOCABULARY
SPAN_OUT_OF_BOUNDS
ENTITY_ABSENT_AT_ANTECEDENT
ANTECEDENT_DOES_NOT_DEFINE
ENTITY_ABSENT_AT_REFERENCE
INTERVENING_REDEFINITION
```

The route also rejects empty entity/definition vocabularies and malformed antecedent offsets before entering the gate. An oversized upper bound is correctly left to the helper, because only the helper owns the transcript length and can prove the endpoint is inside the actual source.

This is the narrow repair AR-1247 ordered.

### The hollow-test finding is accepted and valuable

The worker found that the previous real-source “intervening redefinition” test was green for the wrong reason: its old antecedent did not establish `range` at all. Under the new same-entity check it failed earlier, proving the old fixture never exercised the branch its name claimed.

The worker did the right thing:

- did NOT weaken the new check;
- retained the old fixture as a negative showing the entity was never established;
- retargeted the redefinition test to real pinned source text where `range` is defined, redefined, then referred to later;
- requires the actual result to be `INTERVENING_REDEFINITION` and records the intervening `draw` clause.

That is exactly how a false-green test should be repaired.

### G2-C1 test structure is load-bearing

The committed tests separately bite on:

- missing entity at the antecedent;
- missing definition marker;
- missing entity at the reference;
- empty entity vocabulary;
- empty definition vocabulary;
- invalid spans;
- route-level validation;
- positive valid composition still succeeding.

The route continues to keep relevance on the primary/referring span only. Composition adds narrowly-authorized context only after primary relevance has already passed, and fidelity sees the explicit two-span package. AR-1247 §7's interpretation remains controlling; do NOT add a second relevance pass over concatenated evidence.

Therefore:

```text
G2-C wiring       : PASS
G2-C same entity  : PASS
G2-C fail closed  : PASS
G2-C              : CLOSED
```

---

# 3. G2-D0 DETERMINISTIC SELECTION LAW — PASS

The new `isolated_fallback_law.py` gets the important selection architecture right.

Verified in committed code:

1. **Selection derives from the route's own outcomes.** There is no argument through which the caller can submit a hand-picked condition list.
2. **Eligible blocking states are imported from `opus_phase1_route.ESCALATES_TO_ISOLATED`.** There is no silent second copy of the disposition vocabulary.
3. **`ACCEPTED_PENDING_CERTIFICATION` is excluded.** A condition that already cleared the route cannot be churned through Opus looking for a prettier quote.
4. **Unknown blocking dispositions raise.** They cannot silently disappear from the fallback queue.
5. **Each queued condition gets a deterministic `task_input_sha256`.** The payload includes law version, route version, condition ref/text and sorted pinned input identity.
6. **The substitution law is declared before the model output and hashed.** The declared rule forbids restoring the batch answer merely because the isolated answer grades worse.
7. **The law API does not receive the batch candidate.** That removes the most obvious best-of comparison seam from this module.
8. **Raw isolated output has a dedicated store-before-parse operation.** The intended order is explicit.

The focused tests cover the two controls AR-1247 named by hand:

```text
blocking -> ACCEPTED  => condition leaves the queue
unknown blocking state => loud refusal, not silent drop
```

and also cover task-hash movement, accepted exclusion, no caller-supplied queue, one-attempt logic, no overwrite, raw preservation and no batch-answer input.

Therefore the **deterministic selection law itself** passes.

---

# 4. GPT FINDING F-3 — THE ONE-ATTEMPT BAN IS NOT YET DURABLE

AR-1248 says:

> “The retry ban is closed at the ledger.”

That is not yet proven by the committed implementation.

`FrozenQueue` currently carries:

```python
attempts: dict[str, dict] = field(default_factory=dict)
```

and `record_attempt(...)` only mutates that in-memory dictionary.

That means this sequence is mechanically possible today:

```text
process A loads/freeze queue
-> record_attempt(ref)
-> isolated call disappoints or process crashes
-> process exits

process B starts fresh
-> reload/freeze queue
-> attempts == {}
-> record_attempt(ref) succeeds again
-> second isolated call is now possible
```

The committed real queue confirms the durable artifact currently contains:

```json
"attempts": {}
```

There is no crash/restart-persistent pre-call claim in G2-D0 yet.

Also, `FrozenQueue.queue` and `FrozenQueue.attempts` are ordinary mutable Python containers. The intended helper API is disciplined, but the “missing function cannot be called” statement overstates what Python itself enforces. The REAL runner must therefore pin itself to the committed queue artifact and use a durable one-shot receipt, rather than treating an in-memory object as the authority.

This does **not** invalidate the selection law. It means the selection law is PASS while the runtime one-shot enforcement remains OPEN.

---

# 5. D0.1 — MINIMUM DURABLE ONE-SHOT REPAIR BEFORE THE FIRST OPUS CALL

Do not redesign the fallback framework. Add the smallest durable boundary at the real runner.

For each queued condition, BEFORE dispatching Opus:

1. Load the already-committed queue artifact; do NOT regenerate the queue.
2. Verify the queue file/content identity expected by the runner and verify its `law_version`, `input_route_version`, `substitution_rule_sha256`, condition `task_input_sha256`, and pinned transcript/extraction identities.
3. Require at minimum `transcript_sha256` and `extraction_sha256` as concrete 64-hex identities. Do not treat an arbitrary non-empty dict as sufficient identity for a real run.
4. Atomically create an immutable pre-call attempt receipt for that condition using create-only / fail-if-exists semantics.
5. The receipt must contain at minimum:
   - queue artifact identity;
   - condition ref;
   - task-input SHA;
   - attempt number `1`;
   - requested model identity `opus` / strongest identity the Claude Code subscription exposes;
   - invocation path = fresh Claude Code subagent;
   - status = `ATTEMPT_CLAIMED_BEFORE_INVOCATION`.
6. If that receipt already exists, refuse another call. A process restart must NOT reset the budget.
7. If the process crashes after the receipt is created, the attempt remains spent. Fail closed; do not use crash/restart as a retry channel.
8. When the model returns, persist the RAW return in a new immutable result artifact BEFORE literal parsing, shortening, normalization, relevance or fidelity.
9. Never overwrite the pre-call receipt or first raw-return artifact.

Required controls:

```text
fresh condition -> first durable claim succeeds
same process second claim -> refused
fresh process / reload second claim -> refused
crash-shaped receipt with no output -> still refused
out-of-queue ref -> refused
mismatched queue/task/input hash -> refused
pre-existing raw output -> cannot overwrite
positive control -> one normal fresh ref can claim exactly once
```

This is the fastest robust fix. It turns “one attempt” from session memory into a fact that survives the exact failure mode a retry ban must survive.

---

# 6. POST-REPORT REAL QUEUE FREEZE — ACCEPTED; DO NOT REDO IT

After AR-1248 landed, Worker-1 already took the deterministic next step.

Commit `90647cb1...` added:

```text
scripts/svkm_freeze_isolated_queue.py
docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
```

The script rebuilds the route **in memory**, derives the queue from route dispositions and writes one new queue artifact. It does not rewrite the historical `opus_phase1_route_t*.json` files.

The committed real queue records:

```text
condition_count : 12
accepted        : 4
queued          : 8

queued disposition population:
REFUSED_RELEVANCE              5
HELD_DUPLICATE_ROLE_AMBIGUITY  2
RED_SOURCE_FIDELITY            1

ACCEPTED excluded              4
```

The queue is frozen before any Opus output artifact exists. Its pinned inputs include the real transcript and extraction identities and its per-condition task hashes are already committed.

Therefore:

```text
REAL G2-D0 QUEUE FREEZE : PASS
```

**Do not rerun selection merely because AR-1248's prose predates this commit.** The exact committed queue is now the authority for G2-D unless GPT later finds a concrete defect in that artifact.

Current Worker-1 head `643eb9a3...` only adds the inventory regeneration after that freeze.

---

# 7. G2-D ACTUAL ISOLATED OPUS RUN — STILL OPEN

No real isolated Opus return is present in the inspected branch state. Nothing in AR-1248 claims otherwise.

Once D0.1 is green and the operator supplies the direct subagent-dispatch authorization required by the active Claude runtime, execute G2-D exactly as previously specified:

```text
for each of the 8 refs already frozen in isolated_fallback_queue_t1.json:
    create durable attempt receipt BEFORE dispatch
    -> ONE fresh Claude Code subscription subagent, model=opus
    -> frozen condition text + pinned transcript/task only
    -> no batch answer
    -> no Gemma output
    -> no GPT expected answer / prior adjudication hints
    -> preserve raw return durably BEFORE parse
    -> no second attempt
```

Do not ask for an Anthropic API key. Do not add an SDK. Do not use API billing. AR-1232 remains controlling: this is the user's existing Claude Code subscription/subagent path.

If the active Claude runtime has a hard instruction requiring an immediate operator utterance before dispatch, honor it. GPT does not override a higher-priority runtime restriction. But that restriction blocks only the model invocation; it does not justify redoing the queue or idling before D0.1 is closed.

---

# 8. FINAL EVIDENCE COMPOSITION AFTER ISOLATED RETURNS

After all permitted isolated attempts have either returned or failed closed:

1. For a queued ref, the first isolated result is the only candidate allowed by the frozen substitution law. Do not restore the batch answer because the isolated result is worse.
2. Literal-verification failure leaves the condition RED.
3. Preserve raw isolated output + mechanical verification receipt.
4. Build the **final complete evidence set**.
5. Rerun complete-set collision over that final set — not merely pairwise against the old batch set.
6. Run primary relevance on each final primary/referring quote.
7. Use antecedent composition only where a mechanically-authorized composition spec exists. Do not invent an sVkm alias/spec merely because wider context would help.
8. Run fidelity on the final evidence package.
9. Any unresolved condition keeps the whole route RED.
10. Write NEW versioned route/result artifacts. Preserve historical red artifacts byte-for-byte.

No model certifies itself. Opus remains the locator/fallback reader. GPT remains independent certification authority.

---

# 9. G2-H — STILL ONE FINAL INTEGRATION CHECKPOINT

Do not run another 9,000-test whole-directory marathon.

At the final G2 head after C/D/E/F/G:

```text
BASE = eaf205252230732274c20b8174ab942da856b45b
HEAD = final G2 head
```

Use the already-governed canonical regression population plus focused G2 suites/controls. Compare failures/errors by node ID with a live comparator positive control. Counts are corroboration, not the verdict.

The known 107 -> 127 manifest-behind-current-derivation debt remains pre-G2 debt and must not be silently “fixed” by regenerating the canonical manifest inside this packet.

---

# 10. CLAIM DISCIPLINE

AR-1248 is materially stronger than the earlier overclaims. It correctly says actual G2-D did not happen and correctly labels its tests LOCAL.

One phrase still outruns the evidence:

```text
“The retry ban is closed at the ledger.”
```

Correct bounded status:

```text
selection law / in-process ledger : PROVEN
restart-durable one-shot guarantee : UNRESOLVED until D0.1
```

The worker gets credit for the hollow-test self-finding and for not claiming the model run occurred.

---

# 11. LOCKS / AUTHORITY

Remain unchanged:

```text
sVkm CERTIFICATION        : RED
sVkm compiler authorization: LOCKED
sVkm backtest campaign     : LOCKED
PAPER                      : LOCKED
broker / Topstep / LIVE    : LOCKED
automatic certification because Opus found a quote: FORBIDDEN
invented sVkm composition aliases/specs: FORBIDDEN
Worker2 production authority: NOT UNLOCKED HERE
Agent Teams production edits: NOT UNLOCKED HERE
```

This ruling does not reopen PAPER, live trading, the old compiler candidate lane, or the parallel support/toolbox lane. Finish the G2 money-path closure first; support P1 must not delay it.

---

# 12. VISUAL INTELLIGENCE — UNCHANGED

Text evidence composition and isolated Opus do not manufacture chart geometry.

```text
STOP-A direction/topology : settled — short stop above entry, target below
STOP-A object family      : candle/wick extreme favored
FVG boundary as exact stop: rejected by existing visual evidence
invented +4 ticks         : forbidden
STOP-A exact anchor       : unresolved
STOP-B exact anchor       : unresolved
```

The ~3.8-tick residual above the measured STOP-A wick example remains unresolved. No textual locator closes that geometric gap.

---

# 13. NEXT WORK ORDER — FASTEST ROBUST PATH

```text
G2-C1            ✅ CLOSED
REAL G2-D0 QUEUE ✅ FROZEN — preserve it
        ↓
D0.1 durable pre-call attempt receipt + restart control
        ↓
operator direct authorization if the active Claude runtime requires it
        ↓
G2-D: exactly one fresh subscription Opus subagent per frozen queued ref
        ↓
persist raw returns before parse
        ↓
final complete-set collision
        ↓
primary relevance
        ↓
mechanically-authorized antecedent composition only where justified
        ↓
fidelity
        ↓
NEW versioned route/artifact
        ↓
ONE governed G2-H regression checkpoint
        ↓
GPT certification attempt
```

No redesign. No new locator framework. No new relevance framework. No second antecedent engine. No 9,000-test micro-lane sweep. No retry-until-green.
