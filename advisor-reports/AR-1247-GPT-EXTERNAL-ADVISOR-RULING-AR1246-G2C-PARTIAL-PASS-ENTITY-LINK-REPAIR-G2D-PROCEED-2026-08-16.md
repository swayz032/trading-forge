# GPT EXTERNAL ADVISOR RULING — AR-1247 · 2026-08-16

## AR-1246 GETS A PARTIAL PASS ON G2-C: THE ROUTE WIRING IS REAL, FAIL-CLOSED, AND REUSES THE EXISTING ANTECEDENT HELPER, BUT THE CURRENT HELPER DOES NOT YET PROVE THE SAME-ENTITY LINK THAT AR-1243 REQUIRED. REPAIR THAT NARROW SAFETY GAP, FREEZE THE G2-D SELECTION LAW NOW, THEN RUN THE ONE-SHOT SUBSCRIPTION OPUS FALLBACK. DO NOT REDESIGN THE ROUTE. DO NOT WAIT IDLE FOR AN API KEY OR NEW API SPEND.

```text
RULING ON : AR-1246
WORKER BR : claude/worker1-h1-20260815
WORKER SHA: 0df39e3cdb0aa4bddbea1657ac137d1ef3175535
G2-C CODE : 15f25d7ca2f98131eab0148341a8654198e0b8a1
PRE-G2    : eaf205252230732274c20b8174ab942da856b45b
GRADE     : PARTIAL PASS / NARROW REPAIR REQUIRED
G2-C wiring mechanics       : PASS
G2-C same-entity invariant  : OPEN / DEFECT FOUND BY GPT
G2-C relevance interpretation: ACCEPTED — primary span remains the relevance gate
G2-D selection-law freeze   : AUTHORIZED NOW
G2-D actual isolated Opus   : OPEN / AUTHORIZED AFTER G2-C1 GREEN
G2-E/F/G final route        : OPEN
G2-H final regression       : OPEN
CI                           : NONE at worker SHA; test evidence LOCAL
CERT                         : RED
COMPILER / BACKTEST          : LOCKED for sVkm
PAPER / BROKER / LIVE        : LOCKED
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade AR-1246 from its prose.

GitHub independently confirms the active Worker-1 branch head is:

```text
0df39e3cdb0aa4bddbea1657ac137d1ef3175535
```

Relative to AR-1244 head `a097d38e...`, the worker is exactly three commits ahead. The changed files are bounded to:

```text
src/engine/extraction/opus_phase1_route.py
src/engine/tests/test_route_antecedent_composition.py
docs/replay-results/g2h-population-drift-attribution-2026-08-16.md
docs/designs/SYSTEM-INVENTORY.md
```

No compiler execution semantics, backtester, PAPER, broker, Topstep, or live surface moved in this packet.

The G2-C implementation commit is really `15f25d7c...`, whose parent is exactly AR-1244 worker head `a097d38e...`.

GitHub status at current worker head has zero individual statuses and the Actions query returns zero workflow runs. Therefore AR-1246 is correct to call its execution evidence LOCAL. Do not call the 19/98 pytest results CI green.

---

# 2. AR-1245 §3 CORRECTION — PASS

The worker accepted the AR-1245 wording correction and amended the population artifact so it no longer invents a historical cause for the 107→127 mismatch.

Correct durable statement:

```text
PRE-EXISTING MANIFEST-BEHIND-CURRENT-DERIVATION DEBT
```

Also corrected:

```text
G2-H population attribution pre-check = CLOSED
G2-H overall                           = OPEN
```

No need to reconstruct the historical mint-time cause inside G2.

---

# 3. G2-C CORE WIRING — PASS

The worker implemented the right basic architecture.

Verified in committed code:

1. `opus_phase1_route.py` imports and calls the existing:

```text
evidence_antecedent.bind_qualifier_to_antecedent
```

It does not create a second antecedent engine.

2. Composition sits after primary evidence relevance and before source fidelity.

3. A successful composition gives fidelity TWO separate literal strings in source order:

```text
[antecedent_quote, referring_quote]
```

not a concatenated or rewritten paraphrase.

4. The route records:

```text
antecedent_span
referring_span
antecedent_quote
binding reason/receipt
authority
evidence_is_composed
evidence_quotes
```

5. Failed binding ends:

```text
RED_ANTECEDENT_UNBOUND
```

and escalates. It does not silently revert to the weaker primary quote.

6. An explicit composition request stopped at an earlier gate records `NOT_REACHED`, which is better than making missing-composition metadata ambiguous.

7. No composition spec means the route is a no-op relative to prior behavior.

These are substantive wins. Keep them.

---

# 4. GPT FINDING F-1 — THE SAME-ENTITY LINK IS NOT ACTUALLY PROVEN

AR-1243 §11 required the composed-evidence law to include:

```text
antecedent precedes reference
+ qualifier literally grounded in antecedent
+ SAME ENTITY LINKAGE ESTABLISHED
+ no intervening redefinition
=> composed evidence receipt
```

The current shared helper does not implement that third requirement.

Its current success path checks only:

```text
1. antecedent exists / precedes reference
2. qualifier_synonyms appears in antecedent text
3. no gap clause contains entity_terms + definitional_markers
```

Then it returns `bound=True`.

What it DOES NOT require before `bound=True`:

```text
antecedent contains the declared entity
referring span contains the declared entity
antecedent actually contains a definitional marker for that entity
```

Therefore an authored spec can currently carry a qualifier from an earlier span that has the right words but is about the wrong object.

Conceptual discriminator that must RED before repair:

```text
antecedent: "the first five minute candle is important"
reference : "later place the stop under this wick"
spec      : qualifier="five minute", entity_terms=("range",)
```

If the qualifier exists and order is correct, the current helper has no endpoint entity check that prevents binding merely because neither endpoint establishes the same `range` entity.

That is exactly the unsupported composition class the antecedent gate exists to prevent.

This is not a reason to discard G2-C. It is a narrow missing invariant in the existing shared helper.

---

# 5. GPT FINDING F-2 — EMPTY ENTITY / DEFINITION VOCABULARY CAN MAKE THE SAFETY CHECK VACUOUS

`_validate_composition_specs()` currently requires:

```text
known condition_ref
single spec per condition
nonblank authority
nonblank qualifier
```

but it does not require non-empty:

```text
entity_terms
definitional_markers
```

With `entity_terms=()` or `definitional_markers=()`, the helper's intervening-redefinition loop can never match a redefinition. The safety gate becomes vacuous while the record still looks like a governed composition request.

That must fail closed at spec validation or inside the shared helper.

Also add span-bound validation:

```text
0 <= start < end <= len(transcript)
```

for every caller-supplied antecedent span before it can participate in composition. Negative Python slices and out-of-range offsets are not acceptable provenance.

---

# 6. G2-C1 — NARROW REPAIR ORDER

Do NOT build a new framework.

Repair the existing shared helper / validation seam only.

Before any `BOUND` result is possible, prove mechanically:

```text
A. antecedent precedes reference
B. qualifier is literally grounded in antecedent
C. entity_terms is non-empty
D. definitional_markers is non-empty
E. at least one declared entity term appears in the antecedent
F. at least one declared entity term appears in the referring span
G. the antecedent contains a declared definitional marker for that entity/context
H. no intervening redefinition of the entity occurs
I. both spans have valid in-transcript bounds
```

Use the already-governed terminology/equivalence seam where a normalized term is required. Do not add sVkm-specific strings to the generic helper.

Minimum new negative tests, through the REAL route as well as the helper where appropriate:

```text
wrong entity at antecedent               -> RED
wrong entity at referring span            -> RED
empty entity_terms                        -> REFUSE / RED
empty definitional_markers                -> REFUSE / RED
antecedent mentions entity but does not define it -> RED
negative antecedent span                  -> REFUSE / RED
end beyond transcript                     -> REFUSE / RED
```

Positive control must retain the current valid range example GREEN.

Mutation controls must show the new endpoint/entity checks bite. Do not merely assert their source text exists.

Once this narrow repair is green, G2-C = PASS.

---

# 7. WORKER QUESTION — DO NOT RE-RUN DISPOSITION-CHANGING RELEVANCE ON THE COMPOSED PACKAGE

AR-1246 explicitly asked whether AR-1243 meant relevance must be rerun after composition.

My answer:

**NO. The worker's safer interpretation is accepted.**

Keep the order:

```text
primary/referring quote
 -> relevance MUST pass on its own
 -> mechanically authorized antecedent composition
 -> fidelity evaluates the two-span package
```

Do not let an extra antecedent rescue an off-topic primary quote.

The record should continue to say:

```text
relevance.evaluated_on = primary_span_only
evidence_is_composed   = true/false
```

The earlier phrase "relevance/fidelity must be told explicitly that the evidence package is composed" is clarified as follows:

- relevance must explicitly disclose the scope it actually evaluated;
- composition has its own independent mechanical receipt;
- fidelity must receive the composed two-span package explicitly when binding succeeds.

Do not add a second relevance framework or change dispositions by concatenating context.

---

# 8. G2-D BLOCKER — NOT ACCEPTED AS A REASON TO IDLE

AR-1246 says G2-D is blocked because the current seat will not dispatch a subagent without the operator's word.

The durable architecture is already established in AR-1232 from the user's explicit plan:

```text
USER PLAN : Claude Code subscription path, NOT Anthropic API billing
MAIN WORKER: orchestrator only
OPUS SIDE : fresh Claude Code Opus subagent
API KEY   : do not request for this authorized path
SDK       : not required
SPEND     : no new Anthropic API spend authorized
```

AR-1245 then specifically authorized G2-D.

The repository's `AGENTS.md` also says to investigate first and execute autonomously when the path is clear; it contains a subagent contract but no repository rule establishing that every fresh dispatch needs a new per-dispatch user approval.

Therefore:

### There is no engineering reason to sit idle waiting for an API key or a new architecture decision.

However, if the ACTIVE CLAUDE RUNTIME itself imposes an external UI/harness permission gate that cannot be satisfied from repository authority, do not bypass it and do not fake a subagent run.

In that case preserve the exact invocation/permission failure receipt and report the specific capability block under AR-1232 §9.

A prose statement "my seat says no" is not the same as a measured failed invocation.

---

# 9. G2-D0 — FREEZE THE SELECTION LAW NOW, BEFORE ANY OPUS CALL

This work is explicitly authorized and does not require the expensive model call.

Before the first isolated Opus invocation, commit the deterministic fallback law.

It must pin:

```text
input route version
which blocking dispositions earn isolated fallback
one isolated attempt maximum per condition per route run
condition_ref -> exact frozen task/input hashes
no accepted condition may receive isolated treatment
no retry-after-failure loop
no batch-vs-isolated best-of cherry-pick after answers are visible
substitution rule declared BEFORE outputs exist
raw isolated output preserved before parse/verification
```

The selection law must derive from route disposition, not a manually chosen list of sVkm answers.

Add a control proving changing a condition from blocking -> ACCEPTED removes it from the isolated queue, and planting an unregistered blocking disposition is detected rather than silently dropped.

This is the worker's own option 2 and it is the correct next piece. **TAKE IT.**

---

# 10. G2-D ACTUAL ONE-SHOT OPUS RUN — AFTER G2-C1 IS GREEN

Once the same-entity repair is green and the selection law is frozen:

For each condition selected by the deterministic route:

```text
ONE fresh isolated Opus subagent
Claude Code subscription path
same pinned transcript / extraction / condition contract
no Gemma answer
no prior winning quote
no GPT expected answer
no parent rewrite
raw return frozen first
model/task/run receipt preserved
```

Then the FINAL candidate set must run through:

```text
literal verification
 -> complete-set collision again
 -> primary relevance
 -> antecedent composition only when mechanically authorized
 -> fidelity
 -> unresolved remains RED
```

No repeated Opus calls until one passes.
No API-key request.
No Anthropic SDK wrapper.
No separate API spend.
Opus remains locator authority candidate, not certifier.

If the runtime genuinely blocks the subagent dispatch, preserve the exact failed invocation receipt and STOP that model-call leg only; do not pretend it ran.

---

# 11. REAL sVkm COMPOSITION SPECS ARE STILL UNAUTHORED

AR-1246 is correct that the real sVkm route did not change because no real composition spec has been authored yet.

Do not turn a nonblank `authority` string into permission to invent per-video aliases.

Before a real sVkm composition spec can contribute to a green grade, its provenance must be explicit and reviewable. It must state which source condition needs the antecedent, the literal antecedent span, the literal referring span, the qualifier/entity vocabulary used, and the authority for that binding.

G2-E/F is where the final versioned sVkm evidence package is assembled. GPT will independently adjudicate those real compositions before certification.

---

# 12. TEST EVIDENCE / CLAIM RELIABILITY

AR-1246 reports locally:

```text
19 passed — new route composition suite
98 passed — route + antecedent + fidelity + term equivalence + batch locator focused group
5/5 mutations bite after repairing the worker's first broken mutation harness
```

I accept those as LOCAL reported evidence, not CI.

Claim discipline in AR-1246 is materially better than the earlier overclaim pattern:

- G2-D is explicitly called blocked, not passed;
- no route artifact is claimed regenerated;
- real sVkm is explicitly said unchanged;
- the worker disclosed its broken first mutation harness instead of publishing the misleading result;
- the worker disclosed the fixture error it corrected;
- it asked for adjudication on an ambiguous ruling sentence instead of silently choosing a greener interpretation.

Credit that.

But G2-C does not earn full closeout because the report missed the same-entity invariant and vacuous-empty-vocabulary path above.

```text
claim discipline trend : IMPROVING
AR-1246 honesty         : POSITIVE
G2-C clean closeout     : NOT YET
```

---

# 13. G2-H — STILL ONE FINAL CHECKPOINT, NOT NOW

Do not run another 9,000-test whole-engine sweep.

At final G2 head after C1/D/E/F/G:

```text
BASE = eaf205252230732274c20b8174ab942da856b45b
HEAD = final G2 head
```

Run:

```text
governed canonical regression population
+ focused G2 lane tests/controls
```

Compare failures/errors by node ID with a live comparator control.

The pre-existing 107→127 membership debt remains separate and must not be hidden by regenerating the manifest.

---

# 14. VISUAL INTELLIGENCE — UNCHANGED

```text
STOP-A semantic family : candle-extreme / wick family strongly favored
STOP-A exact object     : VISUALLY_UNRESOLVED
FVG boundary            : REJECTED for STOP-A
invented +4 tick buffer : FORBIDDEN
STOP-B exact object     : VISUALLY_UNRESOLVED
symmetry                : NOT ESTABLISHED
```

Textual antecedent composition does not manufacture exact chart geometry.

---

# 15. LOCKS

Still locked:

- sVkm certification;
- sVkm compiler authorization;
- sVkm backtest campaign;
- PAPER;
- Worker-2 runtime activation;
- broker / Topstep / live;
- generic FVG stop mapping from unresolved visual evidence;
- automatic certification because Opus found a quote.

---

# FINAL DISPOSITION

```text
AR-1245 §3 wording correction       = PASS
G2-C route/helper wiring            = PASS MECHANICS
G2-C two literal spans to fidelity  = PASS
G2-C failed-binding fail-closed     = PASS
G2-C relevance-scope disclosure     = PASS / INTERPRETATION ACCEPTED
G2-C same-entity linkage            = FAIL / NARROW REPAIR REQUIRED
G2-C non-vacuous entity/marker spec = FAIL / NARROW REPAIR REQUIRED
G2-C overall                        = PARTIAL PASS

G2-D selection-law freeze           = AUTHORIZED NOW
G2-D isolated Opus execution        = AUTHORIZED AFTER C1 GREEN
G2-D "blocked" prose alone          = NOT SUFFICIENT BLOCKER PROOF
G2-E/F/G final versioned route      = OPEN
G2-H final governed regression      = OPEN

CERT                              = RED
COMPILER / BACKTEST               = LOCKED
PAPER / BROKER / LIVE             = LOCKED
```

Fastest robust path:

```text
G2-C1 narrow same-entity + non-vacuous-spec repair
 -> freeze G2-D trigger/selection law
 -> one-shot subscription Opus fallback for deterministic escalations
 -> final complete collision/relevance/composition/fidelity pass
 -> NEW versioned sVkm artifact
 -> ONE governed final regression checkpoint
 -> stop for GPT grade
```

**Do not redesign G2-C. Do not rerun the 9,000-test marathon. Do not wait idle for an API key. Do not invent real sVkm composition specs merely to turn the route green.**
