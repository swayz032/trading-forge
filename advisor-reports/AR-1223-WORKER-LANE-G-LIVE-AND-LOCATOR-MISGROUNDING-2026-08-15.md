# WORKER REPORT — AR-1223 · 2026-08-15 · LANE G LIVE + SETTLED-FRAME RECEIPTS

## 🛑 THE FIRST REAL RUN OF THE PRE-SCREEN FOUND SOMETHING BIGGER THAN THE FLAGS: **SIX OF THE SEVEN ANCHORED CONDITIONS ARE BOUND TO THE SAME IRRELEVANT SPAN.**
## Lane G's nine-point contract is satisfied on real data. Settled-frame receipts committed per AR-1222.

```
RULING : AR-1222 (commit the settled-frame receipts; START LANE G IMMEDIATELY) + AR-1218 §6
PIN    : worker head cc445d1eb1f7f1102026990b8eda93bd5ae72641 — pushed, verified
ADDED  : scripts/svkm_grade_v2_prescreen.py   (the real non-test caller)
         grade/v2_prescreen.json              (pre-screen artifact)
         3 settled-check frames + their sha256s
🛑 The frozen AR-1199 red certificate was NOT touched.
```

---

## 1. AR-1222's RECEIPT GAP — CLOSED

You caught that AR-1221 asserted a **four-frame** not-mid-drag check while only the `12:55`
frame was committed. Correct: an unreproducible receipt is an assertion. All four are now
committed with sha256s and the re-measurement recipe:

```
s_00-12-52.png  715869c4…a490      h_00-12-55.png  467de65a…b72a
s_00-12-58.png  afb30815…6cce      s_00-13-02.png  da518008…048c
```

---

## 2. LANE G — LIVE ON REAL DATA

`scripts/svkm_grade_v2_prescreen.py` is the real non-test caller (contract 1). It consumes the
pinned extraction + committed transcript fixture, the anchored spans from `phase1.json`, and the
Lane-A candidate spans, then runs both committed helpers.

```
evidence=12  screened=12  flagged=7  unresolved=[]

confluences[0].description    TIMING_WINDOW_WIDENING   'during' + a point time   (contract 5)
confluences[1].description    UNSUPPORTED_QUANTITY     '1'
entry_sequence[1].rationale   CERTAINTY_INFLATION      'confirms' vs 'gives us an idea'  (3)
entry_sequence[2].rationale   UNSUPPORTED_MODIFIER     'high-probability'                (4)
entry_sequence[1].action      UNSUPPORTED_QUANTITY     '1','5'
entry_sequence[2].action      UNSUPPORTED_QUANTITY     '5'
targets[0].rationale          UNSUPPORTED_QUANTITY     '2'

antecedent: 'initial' BOUND via 'first' — precedes, nothing redefines in between   (contract 2)
```

**Both defects you independently confirmed are flagged.** Faithful conditions return `ok`
(contract 7). Findings are stamped as a **pre-screen / evidence request**, and the artifact
carries `does_not_clear_red_certificate: true` (contract 8). Causal protection is real in code
(contract 6). No source-specific string in either module — their own tests assert it (contract 9).

---

## 3. 🛑 THE FINDING — A LOCATOR **MIS-GROUNDING** CLUSTER

**Six of the seven anchored conditions point at the SAME span, char `19546`:**

> *"I do want to reiterate that this model is not perfect. You are going to lose on this model…"*

`entry_sequence[1].action`, `[2].action`, `[3].action`, `[3].rationale`, `stop.rationale` and
`targets[0].rationale` — **all anchored to one disclaimer** that says nothing about entries,
stops or targets. The real 2R teaching sits at char `14488` (*"a risk-to-reward ratio of two"*)
and was **not** the span chosen.

**This is a worse class than AR-1199's "failed to bind".** Those spans are **literal**, so the
literal-substring fence accepts them — **the anti-hallucination gate cannot catch a quote that is
real but about something else.** It also explains `tier1_classified = 0`: the quotes are about
nothing relevant, so no tier-1 surface fires.

### 3.1 And the honest limit of my own screen

It caught **4 of the 6** — and only because the disclaimer happens to lack the numbers and claims
those conditions assert. `entry_sequence[3].*` and `stop.rationale` came back **`ok`: a FALSE
CLEAN.**

**The detector tests INFLATION, not IRRELEVANCE.** A topical-overlap rule (does the quote share
subject matter with the condition at all?) is the missing check. **I have not built it and I am
not inventing it inside this lane** — it is a new rule and it needs your authorization, not my
initiative at the end of a long run.

---

## 4. MY OWN DEFECT, FOUND AND FIXED MID-RUN

The first version of the driver's ref resolver matched only the indexed form
`entry_sequence[0].action`, so **`stop.rationale` was silently dropped** — a pre-screen reporting
a clean sheet over 11 of 12 conditions while calling it complete. Unresolvable refs are now
printed and counted; the run above shows `unresolved=[]` and `screened=12`.

★ Same shape as the headline problem: **the number reported was not the number checked.**

---

```
STOP   : Lane G's contract is met on real data and the receipt gap is closed.
NEXT   : yours:
         (1) 🛑 THE MIS-GROUNDING CLUSTER (§3). Six conditions on one disclaimer is not a
             tuning issue — the locator's literal fence is structurally blind to a real
             quote about the wrong topic. This now looks like the largest single defect
             between the extraction and a trustworthy grade, and it is upstream of
             everything Lane G screens.
         (2) whether a topical-overlap rule should be added to the detector (§3.1) — my
             screen's false cleans come from exactly that gap;
         (3) the stop-geometry ruling, still open;
         (4) the 40-ID pre-existing failure surface, still unowned;
         (5) two AR number collisions.
         Recommendation: (1). Everything downstream reads those spans.
```
