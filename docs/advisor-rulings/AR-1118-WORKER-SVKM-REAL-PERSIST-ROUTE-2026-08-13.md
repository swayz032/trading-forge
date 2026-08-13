# AR-1118 (WORKER) — `SVKM-REAL-PERSIST-ROUTE-1` COMPLETE, READ-ONLY / 🛑 YOUR §3.1 STOP HAS FIRED: THE PYTHON PRODUCER IS NOT ON THE LIVE CHAIN / §3.2 ANSWER IS OUTCOME **B** / AND TWO FURTHER ARROWS ARE MISSING *DOWNSTREAM* OF PERSISTENCE — THE ROLE CARRIER CANNOT REACH THE INSTANCE THAT EXECUTES / NOTHING BUILT / PERFORMANCE BLOCKED

**Seat:** Claude Code, engineering worker
**Date:** 2026-08-13
**Governing ruling:** AR-1117 (`d2551bb6`)
**Pin measured:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939` — the head AR-1117 inspected. No stale-premise gap.
**Nothing was written.** No commit on the engineering branch. This report is the deliverable.

---

## 1. THE HEADLINE, BEFORE THE TABLE

You ordered the route proof *before* the edit precisely so a correct carrier would not be
written into a dead boundary. **It was the right order, and it paid twice.**

1. 🛑 **YOUR §3.1 STOP CONDITION HAS FIRED.**
   `produce_spec_artifact_from_record()` is **NOT on the live chain.** The real production
   compile/persist boundary is **TypeScript** — `spec-onboarding-service.ts` — and it
   invokes **no Python compiler at all.** `[MEASURED HERE]` with positive controls.
   ⇒ **§3.2 resolves to OUTCOME B.**

2. ⚠️ **AND A SECOND FINDING YOU DID NOT ASK FOR, WHICH CHANGES WHAT §9.2 EVEN MEANS.**
   Two arrows are missing **downstream of persistence**. Even if the perfect four-role
   carrier were persisted today, **it could not reach the object that executes.** The
   §9.1 seam this desk closed yesterday is, in production, **unreachable** — its role
   input has no production supplier anywhere in the repo.

   ★★★★★ **`I CLOSED A SEAM AND THE INPUT THAT TURNS IT ON HAS NO PRODUCTION CALLER.
      THAT IS THE SAME DEAD-CODE CLASS AR-1115 §3.3 JUST HAD ME DELETE, ONE LAYER UP.`**

I am not asking you to reopen §9.1. I am telling you what its closure does and does not
buy, because you closed it on my report and **you closed exactly what I proved: the code
is correct and on the production path. I did not prove its input was reachable, and it is
not.**

---

## 2. THE CHAIN, HOP BY HOP — YOUR §3.1 FORMAT

Legend: **REACH** = statically reachable from a SYSTEM-INVENTORY measured entry point
(94 entry points, 624 of 2120 files reachable).

### HOP 1 — certified artifact → the onboarding service

| | |
|---|---|
| file/function | `src/server/services/spec-onboarding-service.ts` — artifact parsed at `:593-596` (`parsed.artifact`) |
| REACH | **LIVE** — server route surface |
| identity across hop | the spec artifact object; `video`, `spec_hash` |
| source-owned fields surviving | the whole `spec` body |
| positive control | `artifact` appears 22×, `specHash` 27×, `compiled_spec` 3× in that file — the grep reaches the right file |
| negative control | see HOP 2 |

### HOP 2 — 🛑 THE COMPILE BOUNDARY. IT IS TYPESCRIPT, AND PYTHON IS NOT CALLED

| | |
|---|---|
| file/function | `spec-onboarding-service.ts:927` assembles `compiled_spec` **in TypeScript** |
| REACH | **LIVE** |
| **the STOP** | `produce_spec_artifact_from_record()` is **absent from this path** |
| positive control | `compiled_spec`/`specHash`/`artifact` all present (HOP 1) — the file is readable and my patterns match it |
| **negative control (the load-bearing one)** | invocation tokens in that file: `spawn` **0**, `execFile` **0**, `child_process` **0**, `produce_spec` **0**. `python` occurs 7× and **all 7 are prose comments** — I read them; `:610` says it outright: *"no-I/O function — safe to call inline here, **no Python subprocess needed**."* |

⭐ **AND THE SCALAR YOU FORBADE TRUST-WRAPPING IS PRODUCED HERE, IN TYPESCRIPT.**
`recoverSpecTimeframe()` — `src/server/lib/spec-timeframe-recovery.ts:231`, called at
`spec-onboarding-service.ts:693`. Its own code, at `:321-322`:

```ts
confidence = execSpine.has(execCandidate) ? (execTfs.size >= 2 ? 0.6 : 0.5) : 0.4;
evidenceParts.push(`exec = lowest execution-grade TF across roles → ...`);
```

**That is a VERBATIM join to the string AR-1109 measured on the persisted sVkm rows** —
*"exec = lowest execution-grade TF across roles"*, `confidence: 0.4`,
`higher_timeframe: null` (hardcoded `null` at `:220`, `:286`, `:331`). I joined on the
evidence string, not on vocabulary.

⇒ **The 0.4 backfill you told me not to trust-wrap is not in the Python producer. It is
the live TypeScript one, and it is what runs today.**

### HOP 3 — persistence

| | |
|---|---|
| file/function | `spec-onboarding-service.ts:1039` — `db.insert(strategies)` |
| REACH | **LIVE** |
| identity | `strategies.id`, `strategies.name`, `config.compiled_spec.spec_hash`; MP-1 candidate identity persisted as **siblings** of `compiled_spec` (`:952` comment is explicit that writing inside it would move the certified hash) |

### HOP 4 — loader

| | |
|---|---|
| file/function | `src/server/routes/backtests.ts:256` selects the row; `:377` reads `stratConfig["compiled_spec"]`; `:388` spreads it into the run config **after** `...config`, so a request body cannot win |
| REACH | **LIVE** |
| source-owned fields surviving | the entire persisted `compiled_spec`, **including anything under `spec`** |

### HOP 5 — Band C dispatch → strategy construction 🛑 **FIRST BROKEN ARROW**

| | |
|---|---|
| file/function | `src/engine/backtester.py:9778` `elif config.get("compiled_spec")` → `from_compiled_spec(...)` at `:9799` |
| REACH | **LIVE** — this is the money path |
| what travels | `compiled_spec`, `symbol`, `timeframe`, `trace`, `strategy_name`, `opening_range_candidate` |
| **what CANNOT travel** | **`source_timeframe_roles` and `opening_range_source_frame` are not parameters of `from_compiled_spec` at all** (signature `:2832-2840`) |

**POSITIVE CONTROL ON THIS ABSENCE, and it is the one that makes it a fact rather than a
failed search:** the *same grep, over the same line range* finds
`opening_range_candidate` **3×** in that factory (`:2839` param, `:2854` docstring,
`:2875` pass-through) and the two role inputs **0×**. A parameter of exactly this shape
is already threaded through that factory — so if the role inputs were there, this grep
would have found them.

### HOP 6 — the SOURCE_FAITHFUL gate (this hop WORKS)

| | |
|---|---|
| file/function | `backtester.py:7537` `_cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)` |
| what it reads | `strategy.spec["source_timeframe_roles"]` — i.e. **the PERSISTED carrier**, `:3279` |
| verdict | ✅ a persisted carrier **would** reach and be validated by this gate |

### HOP 7 — execution 🛑 **SECOND BROKEN ARROW, AND THE TWO CARRIERS ARE NOT THE SAME OBJECT**

| | |
|---|---|
| file/function | `spec_condition_compiler._h_opening_range` → `_resolve_opening_range_source`, which branches on **`self.source_timeframe_roles`** — the **constructor parameter** |
| **the defect** | HOP 6 parses the persisted carrier into a local variable; `_cls_source_timeframe_roles` has **exactly two occurrences** in `backtester.py` (`:7534` init, `:7537` assignment) and **is read by nothing.** It is never handed to the strategy. |
| **so** | the validated persisted fact and the executing instance's roles are **two disconnected channels** |
| **and the frame** | `opening_range_source_frame` has **no producer anywhere in the repo** — nothing constructs a 5m `RoleFrame` outside tests |

**THE MEASUREMENT THAT SETTLES BOTH:** every supplier of either input, repo-wide:

```
grep -rn "source_timeframe_roles=" --include=*.py .   -> 5 hits, ALL in
grep -rn "opening_range_source_frame=" --include=*.py . -> 5 hits, ALL in
        src/engine/tests/test_svkm_role_execution.py
```

**Zero non-test suppliers of either.** `[MEASURED HERE]`

---

## 3. WHAT THIS MEANS IN PRODUCTION TODAY — STATED PLAINLY

On the live path, `self.source_timeframe_roles` is **always `None`**. Therefore:

- `source_role_driven` is **always False** ⇒ **the AR-1115 §3.1 refusal I landed cannot fire in production.**
- `_resolve_opening_range_source` always takes the **legacy** branch ⇒ the 5m frame selection cannot engage.
- The only production consequence of a persisted carrier today is the HOP-6 **validation gate** — which is exactly the *"gate-consumed, not behavior-consumed"* state AR-1113 §2.4 identified, **still true at the construction layer** even though AR-1114 fixed it at the consumer layer.

**This does not make AR-1116 wrong** — the code is correct, it is on the production path,
and the tests exercise the real handler. **It makes §9.1's closure narrower than the words
suggest**, and you should know that before §9.2 is priced.

⚠️ **I could have caught this in AR-1116 and did not.** I proved the handler was on the
production path and stopped there; I never asked whether its *input* was. That is the
`[instance-not-condition]` shape: I closed the instance and read it as the condition.

---

## 4. PRECEDENT — THIS EXACT HOP WAS BROKEN ONCE BEFORE AND REPAIRED

`src/server/routes/backtests.ts:370` carries a comment about `compiled_spec` itself:

> *"…on it into `from_compiled_spec(...)`. **Both ends existed; only this hop did not**"*

The persisted `compiled_spec` once failed to reach the same factory, and the repair was to
thread it. **The two role inputs are the identical shape, one layer along.** I am not
proposing the fix — that is §3.2/§4 and yours — but the campaign has solved this exact
class here before, and the pattern for a source-owned object crossing this hop already
exists in `opening_range_candidate` / `_proven_candidate`.

---

## 5. ANSWER TO YOUR §3.2 — OUTCOME **B**, WITH ONE COMPLICATION

**B. Another boundary is already the real production compiler:** `spec-onboarding-service.ts`.

**The complication is that the role carrier's four facts are not all TypeScript's to
produce.** The evidence grades (`EXPLICIT` vs `SOURCE_RESOLVED_BY_CONTINUITY`) came from
reading the transcript (AR-1109), and `spec-onboarding-service.ts:413/:488` already states
the boundary in its own words: *"Python remains the candidate semantic authority"* and
*"the taught variants and every duration inside it are Python's authority."*

So the live compiler is TS, but the **semantic authority** for exactly this kind of fact is
already declared to be Python. **Those two facts point in different directions and I am not
resolving that — it is architecture, it is yours, and guessing it is how a campaign quietly
reverses itself.** The honest options I can see:

- **B1** — TS produces the carrier from the artifact, as it already does for the scalar. Fastest; but it puts a source-evidence-graded fact in the layer whose current timeframe logic is the 0.4 heuristic you forbade trusting.
- **B2** — Python produces the carrier offline into the artifact JSON that TS ingests, so TS only transports it. Keeps semantic authority where the code already says it lives; needs the artifact contract extended.
- **B3** — route the live TS boundary through `produce_spec_artifact_from_record()` (your §3.2's second half). Largest change; would also wire the currently-unreachable producer.

**I recommend B2** — it is the only one where no layer produces a fact it is not the
authority for, and it leaves HOP 2 a transport hop. But this is your call, and I have not
started any of them.

---

## 6. 🛑 DISCLOSURES

1. **Nothing was built, edited or committed.** Read-only, as §3.1 ordered.
2. **The HOP-2 null result is control-probed both ways** (§2 HOP 2). I state this because
   an empty grep over the wrong file reads exactly like compliance, and this null is the
   one your STOP condition turns on.
3. **I did not verify the DB row's live contents.** I read the writer, the loader and the
   producer as code. I did not connect to the Railway database to confirm what a real sVkm
   row carries today; AR-1109's `[MEASURED]` reading of `confidence: 0.4` /
   `higher_timeframe: null` is **RELAYED** here, and my contribution is joining it by a
   verbatim evidence string to the function that emits it.
4. **REACH labels for the TS hops are read from the route/service structure, not from
   SYSTEM-INVENTORY's Python import graph.** I did not re-derive a TS reachability graph;
   `[MEASURED]` is claimed for the code I read, not for a TS entry-point closure.
5. **I have not enumerated every possible construction path** — I enumerated non-test
   constructors of `SpecConditionStrategy` (the class def plus the one factory) and every
   supplier of the two inputs. If a construction path exists that does not name either
   symbol, my sweep would miss it. I judge that unlikely and I cannot call it impossible.
6. **Grader not dispatched** — your §6 places it after §9.4.

---

## 7. WHAT I AM ASKING YOU FOR

One decision: **B1 / B2 / B3** (§5), or a fourth I have not seen.

And one ruling I will not make myself: **whether the two missing arrows at HOP 5/7 are part
of §9.2, or a separate unit before it.** They are not persistence — they are transport —
but §9.2's required chain ends at *"→ SOURCE_FAITHFUL role parse"*, which HOP 6 already
satisfies, so a literal reading of §9.2 would leave HOP 7 broken and the money path still
unable to act on the fact.

**I am not blocked on anything else.** Say the word and I execute without a round-trip.

---

## 8. STATUS

| item | status |
|---|---|
| `SVKM-REAL-PERSIST-ROUTE-1` | **COMPLETE — read-only, published here** |
| §3.1 STOP ("producer not on the chain") | 🛑 **FIRED** |
| §3.2 owning boundary | **OUTCOME B** — `spec-onboarding-service.ts` |
| HOP 5 — role inputs reach `from_compiled_spec` | ❌ **BROKEN** (no such parameters) |
| HOP 7 — persisted carrier reaches the executing instance | ❌ **BROKEN** (two disconnected channels) |
| `opening_range_source_frame` production producer | ❌ **NONE EXISTS** |
| §9.1 seam reachable in production | ❌ **NO** — input has zero non-test suppliers |
| §9.2 real persistence | **OPEN — not started, awaiting your §5 decision** |
| §9.3 pairing / §9.4 end-to-end | **OPEN** |
| Independent grade | not dispatched (your §6) |
| Performance | **BLOCKED** |
