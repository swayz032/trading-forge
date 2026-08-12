# AR-1031 — WORKER — `MP1-CANDIDATE-INGRESS-1` TRACED, NOT IMPLEMENTED · THE GAP IS ONE HOP, NOT THREE · HANDOFF AT A CLEAN SEAM

```
RULING : AR-1030 (gpt-rulings 0da66d7d) -- R3 5/5 accepted, start MP1 now
PIN    : 3be07ddc  origin/h1-wave4-sealed12-driver  (unchanged; NOTHING was mutated for MP1)
STATE  : MP1 pre-flight TRACE COMPLETE. 0 lines of MP1 code written. No STOP declared.
WHY    : context exhaustion at a clean seam -- see §4. R3-5 is closed and accepted.
```

## 1. WHAT I MEASURED, AND ONE CORRECTION TO MY OWN FIRST READING

⚠️ **I first framed this as "the ingress is absent." That was too broad and I am correcting it before
it becomes a premise.** The **write** side is built. The gap is one specific hop.

**Every claim below is `[MEASURED HERE]` at `3be07ddc`, and every null was control-probed** — a grep
returning nothing proves nothing until a token that MUST match is shown to match in the same file.

### Hop 1 — candidate authority in Python: **BUILT AND HEAVILY PROVEN**
`src/engine/opening_range_candidate_receipt.py` · `opening_range_candidate_persistence.py`.
`25` obligations across `test_mp1_candidate_receipt.py` (12) and `test_mp1_candidate_persistence.py`
(13) — **including exactly the refusal semantics `AR-1030 §5` asks for**: a missing candidate never
becomes a default · a `candidate_id` disagreeing with the receipt refuses · a receipt swapped onto
another persisted identity goes red · editing duration without restamping identity goes red · with no
receipt nothing falls back to the first candidate.

### Hop 2 — persistence into the DB: **BUILT**
`src/server/services/spec-onboarding-service.ts:931-933` writes `execution_candidate_id`,
`execution_candidate_cache_identity` and `execution_candidate_receipt` into the strategy row's
`config`. It mirrors the Python receipt module (`:458`), reads back via
`readPersistedCandidateField(r.config, "execution_candidate_id")` (`:559`), and has real refusal
paths (`refused_candidate_receipt`, `:419`, `:622-643`).

### Hop 3 — `/api/backtests` request construction: **DOES NOT NAME CANDIDATE IDENTITY**
`src/server/routes/backtests.ts` (`574` lines; **positive control: 67 structural matches, so the grep
sees this file**). `candidate_id` · `candidateId` · `execution_candidate` ·
`ExecutionCandidateReceipt` · `parent_spec_hash` — **CONFIRMED ABSENT.**
The route's identity is `strategyId: z.string().uuid()` (`:124`), loaded from `strategies` (`:166`).

⚠️ **BUT IT MAY CARRY THE IDENTITY IMPLICITLY:** `:226` builds
`const fullConfig = { ...config, strategy: resolvedStrategy }`. **If `config` is the persisted row's
config, the `execution_candidate_*` fields ride along by spread — unnamed, unvalidated, and unchecked.**
🛑 **I did NOT finish resolving where `config` originates** (persisted row vs request body). `:155`
destructures `strategy: providedStrategy` **from the request body**, which is precisely the
request-side override shape `AR-1030 §5[1]` and `STOP [4]` care about. **THIS IS THE FIRST THING THE
NEXT SEAT SHOULD MEASURE.**

### Hop 4 — Python backtester ingress: **CONFIRMED ABSENT**
`src/engine/backtester.py` (`459,767` bytes; **positive control: 60 `def ` matches**).
`candidate_id` · `execution_candidate` · `ExecutionCandidateReceipt` — **none present.**

## 2. THEREFORE — THE LOAD-BEARING SHAPE

**Candidate identity is minted, receipted, refused-on-mismatch and persisted — and then nothing
downstream ever checks it again.** The backtester cannot substitute the wrong candidate *maliciously*;
it simply **has no concept of candidate identity at all**, so every guarantee hop 1 proves is dropped
on the floor at hop 3/4.

★★★★★ **`AN IDENTITY THAT IS PROVEN AT MINT AND UNREAD AT USE IS NOT AN IDENTITY — IT IS A COMMENT.`**

⚖️ **I am NOT declaring `STOP [7]`** (large rewrite vs bounded repair). **I have not measured enough to
rule either way**, and declaring a STOP I cannot support would spend a round-trip on my own
uncertainty. What is measured: the repair is **one hop, not three** — hops 1 and 2 exist and are
tested. Whether threading a validated identity through `fullConfig` → the Python ingress is bounded
depends on the `config` provenance question above, which is one file-read away.

## 3. WHAT I DID NOT DO

- **No MP1 code written. No production file touched. `3be07ddc` is unchanged.**
- Did not resolve `config` provenance at `backtests.ts:226` (the single highest-value next read).
- Did not trace how `runBacktest` (`src/server/lib/backtest-caller-scan.ts`) hands config to Python.
- Did not check `EDGE-HTF-PASSTHROUGH-AUTHORITY-1` visibility (`AR-1030 §5[6]`).

## 4. WHY I AM HANDING OFF, AND IT IS THE PERMITTED REASON

`worker-onboarding §5` is explicit that **unstarted is a reason to stay, not to leave** — so I am
naming the distinction. **The batch I was given closed:** `R3-5` `A`–`D`, the canonical arm, the
closeout receipt, all externally accepted at `AR-1030 §1`. **`MP1` is a new unit opened by a ruling
that landed after my work closed.**

**This session has run the full `R3-5` lane plus a `6.3 min` canonical arm and two publish cycles.**
`§4.5` is direct: exhaustion is the most expensive and most dangerous moment to swap, because **a
session near its limit is the one most likely to produce a partial result that reads as complete** —
and `MP1` is a cross-language ingress (Python receipt → TS service → TS route → Python backtester)
where exactly that failure would be invisible. **I am stopping with the trace banked and nothing
half-mutated, rather than starting a four-hop wiring I cannot finish.**

★ **The incoming seat needs nothing from me but this file and `AR-1030 §5`–`§6`.** Start at
`backtests.ts:226`.

## 5. SEAT

Ear armed on this branch all session; **it fired on every real move** (`AR-1028`, `AR-1029`, `AR-1030`
rulings all arrived through it, unprompted). ⚠️ **It dies with this seat — the PROCESS may outlive it,
but DELIVERY does not.** Two orphan ears (`13092`, `26880`) were already polling from dead parents; I
did not arm them and did not kill them. **No sub-agent dispatched; nothing owed; the gap is empty,
verified rather than assumed.**

**A fresh worker session is needed for `MP1`.**
