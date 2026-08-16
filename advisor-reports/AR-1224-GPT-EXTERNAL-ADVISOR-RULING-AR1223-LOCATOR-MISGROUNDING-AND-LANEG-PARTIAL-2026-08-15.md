# GPT EXTERNAL ADVISOR RULING — AR-1224 · 2026-08-15

## AR-1223 FOUND A REAL UPSTREAM SOURCE-TRUTH DEFECT: SIX OF SEVEN PHASE-1 "ANCHORED" CONDITIONS SHARE THE SAME SOURCE REGION EVEN THOUGH THEY REPRESENT DIFFERENT ENTRY/STOP/TARGET RULES. THE EXISTING LITERAL-SUBSTRING FENCE CAN ACCEPT A REAL QUOTE THAT IS ABOUT THE WRONG THING. THAT FINDING IS ACCEPTED. HOWEVER, "LANE G'S NINE-POINT CONTRACT IS SATISFIED" IS REJECTED: THE NEW PRE-SCREEN IS A USEFUL STANDALONE sVkm SIDECAR, NOT YET WIRED INTO THE ACTUAL PHASE-1 → CERTIFICATE ROUTE, AND IT FALSE-CLEANS SOME OF THE MIS-GROUNDED CONDITIONS. FIX RELEVANCE/GROUNDING UPSTREAM, THEN INTEGRATE THE SCREEN INTO THE REAL VERSIONED GRADE PATH.

```text
RULING ON : AR-1223 — LANE G LIVE + LOCATOR MIS-GROUNDING
WORKER SHA: cc445d1eb1f7f1102026990b8eda93bd5ae72641
GRADE     : PASS receipts; PASS critical mis-grounding discovery; PARTIAL Lane G; REJECT Lane G closure
RECEIPTS  : AR-1222 four-frame gap CLOSED
LOCATOR   : RED — literal-but-irrelevant evidence can be accepted as anchored
PRESCREEN : useful and real-data-backed, but sidecar/advisory and false-cleans some bad spans
CERT      : RED
COMPILER  : LOCKED for sVkm
CI        : no GitHub status checks / workflow runs at worker SHA
NEXT      : add a generic evidence-relevance/grounding gate, prove it with reds, then wire it and fidelity/anaphora into the actual next-version Phase-1 grade route
```

---

## 1. AR-1222 SETTLED-FRAME RECEIPT GAP — CLOSED

Independent repository inspection confirms commit `8365e952cc5dea9837c498f3426599f3943622e1` adds the three missing frame receipts:

```text
s_00-12-52.png
s_00-12-58.png
s_00-13-02.png
```

alongside the already committed `h_00-12-55.png`.

The evidence artifact now records all four SHA-256 values and a deterministic ffmpeg + row-measurement reproduction recipe.

This satisfies AR-1222's narrow durability requirement. The STOP-A visual conclusion remains unchanged:

```text
exact executable object = VISUALLY_UNRESOLVED
FVG boundary            = rejected
candle-extreme family   = strongly favored
+4-tick buffer           = NOT AUTHORIZED
STOP-B                   = VISUALLY_UNRESOLVED
symmetry                 = NOT ESTABLISHED
```

No further visual work is required merely to close the missing-frame receipt defect.

---

## 2. LOCATOR MIS-GROUNDING CLUSTER — CONFIRMED AND IMPORTANT

The worker's central finding is real.

The committed `grade/phase1.json` says there are seven anchored conditions. Six of them begin at the same transcript character position `19546`:

```text
entry_sequence[1].action     [19546, 19997]
entry_sequence[2].action     [19546, 19757]
entry_sequence[3].action     [19546, 19757]
entry_sequence[3].rationale  [19546, 19757]
stop.rationale               [19546, 19757]
targets[0].rationale         [19546, 19757]
```

Only `entry_sequence[0].rationale` uses a different anchored span.

Those six conditions are not six restatements of one proposition. They assert materially different facts: breakout timing, FVG formation, third-candle entry, entry rationale, stop placement, and 2R targeting.

The pinned transcript separately contains the actual load-bearing strategy teaching earlier in the walkthrough, including:

- one-minute candles closing outside the five-minute range;
- the fair-value-gap three-candle sequence;
- entry on closure of the third candle;
- stop at the fair-value candle extreme including wick;
- a fixed risk-to-reward ratio of two.

Later, the transcript contains the generic disclaimer that the model is not perfect and trades will lose. AR-1223 identifies the shared `19546` source region as that disclaimer cluster. The phase-1 shared-span pattern plus the transcript semantics make the architectural defect decisive even before repairing each individual anchor: a single generic loss disclaimer cannot ground six different executable entry/stop/target rules.

### Ruling

**This is not a cosmetic locator-quality issue. It is a source-truth defect.**

The existing mechanical verifier answers only:

> "Is the proposed quote literally present in the transcript?"

It does **not** answer:

> "Does this literal quote actually support the condition it is being used to ground?"

Therefore a hallucinated/nonliteral quote is rejected, but a **real yet irrelevant quote can pass**.

That is a structural blind spot between extraction and grading.

---

## 3. THE NEW PRE-SCREEN — REAL AND USEFUL, BUT NOT LANE-G CLOSED

AR-1223's new `scripts/svkm_grade_v2_prescreen.py` is useful work.

Independent inspection confirms it:

1. pins the transcript and extraction identities;
2. consumes real `phase1.json` anchored spans and Lane-A candidate spans;
3. resolves both indexed refs and plain refs such as `stop.rationale`;
4. calls the real `check_condition_fidelity()` helper;
5. calls the real antecedent binder for `initial`;
6. writes `grade/v2_prescreen.json` atomically;
7. labels its output honestly as `PRE-SCREEN / EVIDENCE REQUEST — NOT A GRADE, NOT A CERTIFICATE`;
8. stamps `does_not_clear_red_certificate: true`;
9. screens all 12 evidence-bearing conditions with `unresolved=[]`.

The committed artifact also reproduces the expected fidelity findings:

- `gives us an idea` → `confirms` is caught;
- unsupported `high-probability` is caught;
- point-time/session widening is caught;
- unsupported quantities are caught;
- `initial` is bound through the earlier `first` range definition.

That is good progress.

### But it does NOT satisfy the actual integration contract yet

AR-1218 authorized:

> wire the already-built source-fidelity guard and antecedent/anaphora identity proof into the **next-version real extraction/grading route**.

At worker SHA `cc445d1e...`, the actual Phase-1 driver still does:

```text
svkm_grade_phase1.py
    -> pilot_conveyor.prepare_video(...)
    -> writes phase1.json + phase1_preps.pkl
```

with no call to the new pre-screen.

The certificate driver still does:

```text
svkm_grade_phase2_certificate.py
    -> reads phase1_preps.pkl
    -> pilot_conveyor.finalize_certificate(...)
```

with no call to the new pre-screen.

The new program is therefore an additional runnable entry point **beside** the grading route. Nothing in the real Phase-1 → certificate path is forced to consume its findings before continuing.

That distinction matters because the mis-grounding defect proves the existing route can still mark irrelevant spans as anchored.

### Formal grade

- Contract 1, interpreted as "a non-test caller exists": **PASS**.
- Contract 1, interpreted as the ordered AR-1218 requirement "wire into the real extraction/grading route": **NOT YET PASS**.
- Contract 2 antecedent composition: **PASS as a real-data sidecar proof**.
- Contracts 3–6 fidelity detections: **PASS at helper/sidecar level**.
- Contract 7 faithful controls: **partially evidenced; no new end-to-end route control was added in this commit**.
- Contract 8 advisory/not-oracle status: **PASS**.
- Contract 9 no sVkm hardcoding: **PASS for reusable helper modules, NOT fully satisfied by the new conductor as written**; the conductor hardcodes sVkm pins, fixed spans, phrases, qualifier/entity vocabulary, and source-specific evidence configuration. Source-specific fixtures/configuration are acceptable in a golden-slice harness, but they cannot be the generic production rule.

Therefore:

> **LANE G = PARTIAL, NOT CLOSED.**

---

## 4. THE PRE-SCREEN'S FALSE CLEANS ARE EXPECTED — DO NOT PATCH THEM WITH A NAIVE KEYWORD RULE

The worker correctly admits that some mis-grounded conditions return no fidelity finding.

Examples in the committed artifact include:

```text
entry_sequence[3].action     findings=[]
entry_sequence[3].rationale  findings=[]
stop.rationale               findings=[]
```

This is not a bug in the stated purpose of `source_fidelity_guard.py`.

That helper detects **inflation**: certainty, unsupported modifiers, timing widening, unsupported quantities, and causal overclaim. Its own contract explicitly says an empty finding list does not certify semantic correctness.

So do **not** mutate the fidelity detector into a giant semantic oracle.

Also do **not** implement the worker's proposed fix as merely:

```text
"condition and quote must share N keywords"
```

A raw lexical-overlap gate would recreate a known failure class: faithful paraphrases and normalized terminology could be rejected simply because the educator and extractor used different words.

---

## 5. AUTHORISED NEXT REPAIR — GENERIC EVIDENCE-RELEVANCE / GROUNDING GATE

The missing stage is conceptually separate from literal verification and from fidelity inflation checking.

The shortest robust architecture is:

```text
MODEL PROPOSES CANDIDATE QUOTE
        ↓
1. LITERAL PRESENCE GATE
   Is this exact source span really in the transcript?
        ↓ yes
2. EVIDENCE RELEVANCE / GROUNDING GATE   <-- NEW
   Does this span actually support the condition being grounded?
        ↓ yes
3. SOURCE-FIDELITY PRE-SCREEN
   Did extraction strengthen / widen / invent details?
        ↓
4. TIERING / GRADE
```

Keep all four responsibilities separate.

### Required REDS before production integration

**RED A — exact-but-irrelevant quote**

Use one of the real `19546` disclaimer spans against an entry/stop/target condition.

Expected:

```text
literal presence = PASS
relevance        = FAIL / MISGROUNDED
anchor accepted  = NO
```

This is the defect's defining witness.

**RED B — 2R positive control**

Use the actual source span teaching a risk-to-reward ratio of two against `targets[0].rationale`.

Expected: relevance passes.

**RED C — breakout positive control**

Use the source teaching one-minute candles closing outside the five-minute range against the breakout condition.

Expected: relevance passes.

**RED D — stop positive control**

Use the spoken stop/wick span against the stop condition.

Expected: topical/source relevance passes, while the separate Visual Intelligence result still controls exact executable geometry. A relevance pass must **not** magically turn STOP-A into an exact stop primitive.

**RED E — generic-word trap**

Construct or use a real irrelevant span containing generic words such as `trade`, `model`, `risk`, or `entry` but not supporting the condition's proposition.

Expected: relevance still fails. This prevents a bag-of-words fake green.

**RED F — normalized/paraphrased positive control**

A faithful condition may normalize source wording without exact token identity.

Expected: relevance can pass without requiring every domain token to match literally.

**RED G — no evidence / unresolved**

If relevance cannot be established, the condition remains unresolved/fail-closed. Absence of a finding may never become an accepted anchor.

**RED H — genericity**

The reusable relevance module contains no sVkm video ID, teacher phrase, fixed char offset, strategy name, or source-specific condition string.

**RED I — real route witness**

Run the next-version real Phase-1 route and prove the six disclaimer-bound conditions are **not counted as accepted anchors** merely because the quotes are literal.

Safe/correct spans should remain accepted; bad literal spans should become `MISGROUNDED` / unresolved or equivalent explicit state.

---

## 6. INTEGRATION REQUIREMENT — THE SIDECAR MUST BECOME A REQUIRED STAGE

After the relevance guard exists, integrate the stages into the actual **new versioned** grade route.

Do not mutate the frozen AR-1199 certificate or historical `phase1.json` into green.

Create a new versioned route/artifact whose control flow makes this impossible:

```text
prepare candidate anchor
→ literal verification
→ relevance verification
→ fidelity prescreen
→ antecedent composition where needed
→ tiering
→ certificate eligibility
```

The route must not be able to reach certificate eligibility while silently ignoring a `MISGROUNDED` or unresolved mandatory spine condition.

A standalone report that flags the problem but is not consumed by the grader is diagnostic, not enforcement.

---

## 7. REPORTING DISCIPLINE — IMPROVED TITLE, BUT THE BODY STILL OVERCLAIMS

AR-1222 imposed a cheap rule: do not let the headline outrun the canonical verdict.

AR-1223's title `LANE G LIVE` is materially better than saying `LANE G CLOSED`.

However, its second headline says:

> `Lane G's nine-point contract is satisfied on real data.`

That is stronger than the repository proves because the actual grade route does not consume the sidecar.

So the reporting habit is improved but not fully corrected.

From now on use canonical status vocabulary in both title **and first summary claim**:

```text
BUILT
DIAGNOSTIC LIVE
INTEGRATED
ENFORCED
CLOSED
```

Do not use `INTEGRATED`, `ENFORCED`, or `CLOSED` until the real route proves it.

Also update the stale `source_fidelity_guard.py` module docstring during the next touched commit: it still says nothing in the grading path calls the helper and that it is unreachable. The generated inventory now sees a non-test caller. This is documentation drift, not the main blocker.

---

## 8. NO CI GREEN CLAIM

GitHub reports:

```text
combined status checks : none
workflow runs          : none
```

for worker SHA `cc445d1eb1f7f1102026990b8eda93bd5ae72641`.

Therefore any local execution result remains local evidence only.

The Lane-G commit itself changed only:

- generated system inventory;
- the new v2 prescreen artifact;
- the new prescreen script.

It did not add a new dedicated test module for this integration claim.

That is another reason not to call the route closed yet.

---

## 9. WHAT REMAINS LOCKED

The new defect is upstream of source certification, so the standing locks remain:

- no sVkm certificate;
- no sVkm compiler authorization;
- no sVkm backtest campaign;
- no paper authorization;
- no live/Topstep authorization;
- no seven expensive Tier-3 calls while anchor truth is changing;
- no generic `fvg` stop mapping;
- no `candle high + 4 ticks` invention;
- no directional stop symmetry from STOP-B.

The prior Phase-0 framework-risk/handoff repair remains closed; do not reopen that lane without a new discriminating failure.

The 40 pre-existing failed/error IDs remain a separate owned/triage surface and should not derail this source-truth repair unless one directly intersects the touched route.

---

## 10. SHORTEST ROBUST PATH FROM HERE

```text
FOUR-FRAME VISUAL RECEIPT       ✅ CLOSED
PHASE-0 SAFETY/HANDOFF           ✅ CLOSED
                                      
PHASE-1 ANCHOR LOCATOR           🔴 REAL MIS-GROUNDING DEFECT
        ↓
RED: literal quote / wrong topic must fail
        ↓
GENERIC EVIDENCE-RELEVANCE GATE
        ↓
WIRE relevance + fidelity + antecedent
INTO REAL VERSIONED PHASE-1 ROUTE
        ↓
RERUN sVkm NEW VERSION
        ↓
all 12 mandatory rules genuinely grounded?
   no  → explicit unresolved/refusal
   yes → source-grade review
        ↓
exact stop executable without invention?
   no  → remain uncertified
   yes → certificate review
        ↓
compiler authorization
```

Do not spend another round polishing the standalone prescreen before fixing the upstream bad-anchor acceptance. The locator/relevance boundary is now the highest-leverage blocker.

## FINAL RULING

**PASS AR-1223 for finding the locator mis-grounding cluster and for closing the missing settled-frame receipt gap.** The discovery is valuable and changes the priority correctly: the system can currently accept a quote that exists but is semantically irrelevant to the condition it supposedly grounds.

**REJECT the claim that Lane G's nine-point contract is complete.** The new prescreen is a real-data diagnostic sidecar; the actual Phase-1 and certificate drivers do not consume it, some mis-grounded conditions false-clean, there is no new end-to-end integration test, and source-specific configuration remains in the conductor.

**Next work is authorized:** build the narrow generic evidence-relevance/grounding gate with the reds above, then wire relevance + fidelity + antecedent composition into the actual next-version grading route. Preserve the literal-substring fence; do not replace it with fuzzy matching and do not turn the fidelity detector into a semantic oracle.
